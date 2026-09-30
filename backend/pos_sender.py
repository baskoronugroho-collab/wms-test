"""The sender for the Hiryu link: messages 3, 4 and 5 (PRD §0.6, §9.4).

The floor code only ever QUEUES: ledger.enqueue_pos_push after every stock
change, ledger.enqueue_pos_message at Selesai dikemas and at Barang tidak ada.
This module is the one place that reads the queue and talks to Hiryu, so the
rules of the contract (docs/hiryu-link-v1.md) live here and nowhere else:

  * one message per call, POSTed to POS_WEBHOOK_URL with X-Hiryu-Key and
    Idempotency-Key = message_id;
  * order messages ahead of stock messages (send_priority, then id);
  * a stock number is worked out when it is SENT, not when it was queued, and
    a burst of queued rows for one SKU goes as one number (§9.4.3);
  * retries with a growing wait (10 s, 30 s, 1 min, 2 min, 5 min, then every
    10 min) until Hiryu answers 2xx; a 4xx other than 408 and 429 stops and
    shows as failed on Integrasi Hiryu;
  * the training site never sends (rows are suppressed at enqueue, and again
    here, because a rule enforced twice at the edge cannot leak).

Several pods run this. A row is claimed with a conditional UPDATE
(pending -> sending) and only the pod whose UPDATE changed the row sends it; a
claim older than a minute belongs to a pod that died and goes back to pending.

main.py calls `loop_tick()` every 5 seconds. It sends what is due and, once a
day after 03:00 WIB, queues the full stock snapshot (§9.4.4).
"""
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone

import httpx

import daycolor
import db

log = logging.getLogger("wms.pos_sender")

# The contract's retry schedule, in seconds, by attempt number (1-based).
BACKOFF = (10, 30, 60, 120, 300, 600)

# The outbox names message 5 `order_short` (the floor's word); the contract
# names it `item_short` (Hiryu's). Mapped here, at the edge.
CONTRACT_TYPE = {
    "stock_level": "stock_level",
    "order_ready": "order_ready",
    "order_short": "item_short",
}

STALE_CLAIM_SECONDS = 60
HTTP_TIMEOUT = 8.0


# --------------------------------------------------------------------------
# Switches
# --------------------------------------------------------------------------

def push_enabled() -> bool:
    return os.getenv("POS_PUSH_ENABLED", "false").strip().lower() in ("1", "true", "yes")


def webhook_url() -> str:
    return os.getenv("POS_WEBHOOK_URL", "").strip()


def shared_secret() -> str:
    return os.getenv("POS_SHARED_SECRET", "").strip()


async def rule(key: str, default: int | None) -> int | None:
    row = await db.fetch_one(
        "SELECT value_num FROM alert_rules WHERE rule_key = %s", (key,))
    if not row or row["value_num"] is None:
        return default
    return int(row["value_num"])


async def link_live() -> bool:
    """The Ops HQ switch Sambungan Hiryu aktif (alert_rules hiryu_link_live).

    Sending needs it as well as POS_PUSH_ENABLED: with the link off, orders come
    by paste and the SPV types stock into Hiryu, and a number from the WMS would
    fight the one she typed.
    """
    return (await rule("hiryu_link_live", 0)) == 1


async def sending_on() -> bool:
    return (push_enabled() and bool(webhook_url()) and bool(shared_secret())
            and await link_live())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(ts: datetime | None) -> str | None:
    """Naive UTC (how every DATETIME here is stored) -> ISO 8601 with Z."""
    if ts is None:
        return None
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
    return ts.replace(microsecond=0).isoformat() + "Z"


# --------------------------------------------------------------------------
# Available to sell (§9.4.2, §9.5)
# --------------------------------------------------------------------------

async def available_now(site_id: int, sku_id: int, grab_buffer: int | None = None) -> int:
    """On the shelf, minus held for orders not yet picked, minus the Grab buffer,
    never below 0.

    On the shelf = real (non-virtual) locations only. Units waiting in a
    temporary inbound bin are not in the ledger at all until put away
    (routers/requests.py), and picked units have already left the balance, so
    neither is counted. qty_allocated is exactly "held, not yet picked": the
    pick releases it. Quarantine has no location of its own yet; when it gets
    one, exclude it here.
    """
    row = await db.fetch_one(
        "SELECT COALESCE(SUM(GREATEST(0, ib.qty_on_hand - ib.qty_allocated)), 0) AS avail "
        "FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "WHERE ib.site_id = %s AND ib.sku_id = %s AND l.is_virtual = 0",
        (site_id, sku_id))
    base = int(row["avail"]) if row else 0
    if grab_buffer is None:
        grab_buffer = await rule("grab_buffer_default", 1) or 0
    return max(0, base - max(0, int(grab_buffer)))


# --------------------------------------------------------------------------
# Building the messages
# --------------------------------------------------------------------------

class Suppress(Exception):
    """This row must never be sent; the reason is kept in last_error."""


async def _build_stock(row: dict) -> tuple[list[tuple[str, dict]], int]:
    sku = await db.fetch_one(
        "SELECT id, brand_id, hiryu_sku_code, grab_buffer FROM skus WHERE id = %s",
        (row["sku_id"],))
    if not sku:
        raise Suppress("SKU tidak ada / SKU not found")
    if not (sku["hiryu_sku_code"] or "").strip():
        raise Suppress("SKU belum punya kode Hiryu / SKU has no Hiryu SKU code")
    stores = await db.fetch_all(
        "SELECT hiryu_store_no FROM hiryu_stores "
        "WHERE site_id = %s AND brand_id = %s AND active = 1 ORDER BY hiryu_store_no",
        (row["site_id"], sku["brand_id"]))
    if not stores:
        raise Suppress("Tidak ada toko Hiryu aktif untuk merek ini di hub ini / "
                       "No active Hiryu store for this brand at this hub")

    # Every pending row for this hub and SKU is answered by the number worked
    # out now; they point at this row instead of each sending a stale figure.
    await db.execute(
        "UPDATE pos_outbox SET status = 'sent', sent_at = UTC_TIMESTAMP(), merged_into = %s "
        "WHERE site_id = %s AND sku_id = %s AND message_type = 'stock_level' "
        "  AND status = 'pending' AND id <> %s",
        (row["id"], row["site_id"], row["sku_id"], row["id"]))

    grab_buffer = sku["grab_buffer"]
    avail = await available_now(row["site_id"], row["sku_id"],
                                None if grab_buffer is None else int(grab_buffer))
    as_of = _iso(_utcnow())
    code = sku["hiryu_sku_code"].strip().upper()
    # One hub has one Hiryu store per brand, so this is one message; should a
    # brand ever have two stores at a hub, each gets its own message ID.
    out = []
    for st in stores:
        mid = f"wms-{row['id']}" if len(stores) == 1 else f"wms-{row['id']}-{st['hiryu_store_no']}"
        out.append((mid, {"hiryu_store_id": int(st["hiryu_store_no"]), "sku_code": code,
                          "available": avail, "as_of": as_of}))
    return out, avail


async def _link_order(order_ref: str | None) -> dict:
    if not order_ref:
        raise Suppress("Pesan tanpa nomor pesanan / Message has no order reference")
    order = await db.fetch_one(
        "SELECT o.id, o.external_ref, o.hiryu_short_no, o.source, o.status, "
        "       o.marked_ready_at, pt.completed_at "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id "
        "WHERE o.external_ref = %s", (order_ref,))
    if not order:
        raise Suppress("Pesanan tidak ada di WMS / Order not found")
    # Only an order that came by message 1 is Hiryu's to be told about. A pasted
    # order (the interim bridge) was marked ready in Hiryu by staff, and its
    # messages queued in shadow mode must not reach Hiryu days later.
    if (order["source"] or "") != "link":
        raise Suppress("Pesanan dari tempel, bukan dari sambungan / Pasted order, not from the link")
    return order


async def _build_ready(row: dict) -> list[tuple[str, dict]]:
    order = await _link_order(row["order_ref"])
    if order["status"] == "cancelled":
        raise Suppress("Pesanan sudah dibatalkan / Order already cancelled")
    return [(f"wms-{row['id']}", {
        "grab_order_id": order["external_ref"],
        "gm_number": order["hiryu_short_no"],
        # Selesai dikemas stamps marked_ready_at; older rows fall back.
        "packed_at": (_iso(order["marked_ready_at"]) or _iso(order["completed_at"])
                      or _iso(row["created_at"])),
    })]


async def _build_short(row: dict) -> list[tuple[str, dict]]:
    """Units wanted and found are facts of the moment the picker declared the
    line short, and the floor now queues them (units_wanted, units_found for
    the whole order line). An older row without them is worked out from the
    order lines. Everything else comes from the database, never the payload."""
    order = await _link_order(row["order_ref"])
    if not row["sku_id"]:
        raise Suppress("Pesan kurang tanpa SKU / Item short without a SKU")
    line = await db.fetch_one(
        "SELECT s.hiryu_sku_code, COALESCE(SUM(ol.qty_ordered),0) AS wanted, "
        "       COALESCE(SUM(ol.qty_picked),0) AS found "
        "FROM order_lines ol JOIN skus s ON s.id = ol.sku_id "
        "WHERE ol.order_id = %s AND ol.sku_id = %s GROUP BY s.hiryu_sku_code",
        (order["id"], row["sku_id"]))
    if not line or not (line["hiryu_sku_code"] or "").strip():
        raise Suppress("SKU tidak ada di pesanan atau tanpa kode Hiryu / "
                       "SKU not on the order or has no Hiryu code")
    try:
        queued = json.loads(row.get("payload_json") or "{}")
    except ValueError:
        queued = {}
    wanted = queued.get("units_wanted")
    found = queued.get("units_found")
    if not isinstance(wanted, int) or not isinstance(found, int):
        wanted, found = int(line["wanted"]), int(line["found"])
    return [(f"wms-{row['id']}", {
        "grab_order_id": order["external_ref"],
        "gm_number": order["hiryu_short_no"],
        "sku_code": line["hiryu_sku_code"].strip().upper(),
        "units_wanted": int(wanted),
        "units_found": int(found),
    })]


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------

def _permanent(status: int) -> bool:
    return 400 <= status < 500 and status not in (408, 429)


async def _post(client: httpx.AsyncClient, message_id: str, mtype: str, data: dict) -> tuple[str, str | None]:
    """One call. Returns ('ok' | 'retry' | 'fail', error)."""
    body = {"message_id": message_id, "type": CONTRACT_TYPE.get(mtype, mtype),
            "sent_at": _iso(_utcnow()), "data": data}
    try:
        r = await client.post(
            webhook_url(), json=body,
            headers={"X-Hiryu-Key": shared_secret(), "Idempotency-Key": message_id})
    except httpx.HTTPError as e:
        return "retry", f"{type(e).__name__}: {e}"[:400]
    # 409 = Hiryu took it before: the contract's "duplicate, no change".
    if 200 <= r.status_code < 300 or r.status_code == 409:
        return "ok", None
    detail = f"HTTP {r.status_code}: {r.text[:300]}"
    return ("fail" if _permanent(r.status_code) else "retry"), detail


async def _finish(row_id: int, outcome: str, error: str | None, attempts: int,
                  available: int | None = None) -> None:
    if outcome == "ok":
        await db.execute(
            "UPDATE pos_outbox SET status = 'sent', sent_at = UTC_TIMESTAMP(), "
            "attempts = attempts + 1, last_error = NULL, claimed_at = NULL, "
            "next_attempt_at = NULL, available = COALESCE(%s, available) WHERE id = %s",
            (available, row_id))
    elif outcome == "fail":
        await db.execute(
            "UPDATE pos_outbox SET status = 'failed', attempts = attempts + 1, "
            "last_error = %s, claimed_at = NULL WHERE id = %s", (error, row_id))
    else:
        wait = BACKOFF[min(attempts, len(BACKOFF) - 1)]
        await db.execute(
            "UPDATE pos_outbox SET status = 'pending', attempts = attempts + 1, "
            "last_error = %s, claimed_at = NULL, "
            "next_attempt_at = UTC_TIMESTAMP() + INTERVAL %s SECOND WHERE id = %s",
            (error, wait, row_id))


async def _suppress(row_id: int, reason: str) -> None:
    await db.execute(
        "UPDATE pos_outbox SET status = 'suppressed', last_error = %s, claimed_at = NULL "
        "WHERE id = %s", (reason[:400], row_id))


async def reset_stale_claims() -> int:
    return await db.execute(
        "UPDATE pos_outbox SET status = 'pending', claimed_at = NULL "
        "WHERE status = 'sending' AND claimed_at < UTC_TIMESTAMP() - INTERVAL %s SECOND",
        (STALE_CLAIM_SECONDS,))


async def send_due(batch: int = 20) -> int:
    """Send up to `batch` due rows. Returns how many rows were handled.

    Does nothing while sending is off (POS_PUSH_ENABLED not true, no webhook URL
    or secret, or the link switched off): the rows stay pending, which is what
    Integrasi Hiryu shows as shadow mode.
    """
    if not db.ready() or not await sending_on():
        return 0
    rows = await db.fetch_all(
        "SELECT o.id, o.site_id, o.sku_id, o.message_type, o.order_ref, o.attempts, "
        "       o.created_at, o.payload_json, s.site_type, s.is_training "
        "FROM pos_outbox o LEFT JOIN sites s ON s.id = o.site_id "
        "WHERE o.status = 'pending' "
        "  AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= UTC_TIMESTAMP()) "
        "ORDER BY o.send_priority, o.id LIMIT %s", (batch,))
    if not rows:
        return 0
    handled = 0
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        for row in rows:
            claimed = await db.execute(
                "UPDATE pos_outbox SET status = 'sending', claimed_at = UTC_TIMESTAMP() "
                "WHERE id = %s AND status = 'pending'", (row["id"],))
            if not claimed:
                continue   # another pod has it, or it was merged a moment ago
            handled += 1
            try:
                if row["is_training"] or (row["site_type"] or "darkstore") != "darkstore":
                    raise Suppress("Lokasi latihan atau hub tidak pernah mengirim / "
                                   "Training site or hub never sends")
                available = None
                mtype = row["message_type"]
                if mtype == "stock_level":
                    messages, available = await _build_stock(row)
                elif mtype == "order_ready":
                    messages = await _build_ready(row)
                elif mtype == "order_short":
                    messages = await _build_short(row)
                else:
                    raise Suppress(f"Jenis pesan tidak dikenal / Unknown message type: {mtype}")
                outcome, error = "ok", None
                for mid, data in messages:
                    o, e = await _post(client, mid, mtype, data)
                    if o != "ok":
                        # A permanent refusal of any part wins over a retry.
                        if outcome != "fail":
                            outcome, error = o, e
                await _finish(row["id"], outcome, error, int(row["attempts"] or 0), available)
            except Suppress as s:
                await _suppress(row["id"], str(s))
            except Exception as e:   # never leave a row stuck in 'sending'
                log.exception("sending outbox row %s failed", row["id"])
                await _finish(row["id"], "retry", f"WMS: {type(e).__name__}: {e}"[:400],
                              int(row["attempts"] or 0))
    return handled


# --------------------------------------------------------------------------
# Full snapshot (§9.4.4) and the 5-second tick
# --------------------------------------------------------------------------

async def queue_full_snapshot() -> int:
    """One stock_level row per SKU per live darkstore that has an active Hiryu
    store for the SKU's brand: every SKU slotted there, and every SKU on that
    store's menu (so a menu SKU with no bin is told 0). The number itself is
    worked out at send time. Returns the rows queued."""
    return await db.execute(
        "INSERT INTO pos_outbox (site_id, sku_id, available, status, message_type, "
        "                        send_priority, payload_json) "
        "SELECT x.site_id, x.sku_id, NULL, 'pending', 'stock_level', 5, '{\"snapshot\": true}' "
        "FROM ("
        "  SELECT sa.site_id, sa.sku_id FROM slot_assignments sa "
        "    JOIN skus k ON k.id = sa.sku_id "
        "    JOIN hiryu_stores hs ON hs.site_id = sa.site_id AND hs.brand_id = k.brand_id "
        "         AND hs.active = 1 "
        "  UNION "
        "  SELECT hs.site_id, hi.sku_id FROM hiryu_items hi "
        "    JOIN hiryu_stores hs ON hs.hiryu_store_no = hi.hiryu_store_no AND hs.active = 1 "
        "   WHERE hi.active = 1 AND hi.sku_id IS NOT NULL"
        ") x JOIN sites st ON st.id = x.site_id "
        "WHERE st.site_type = 'darkstore' AND st.is_training = 0 AND st.active = 1")


async def nightly_snapshot_due(now: datetime | None = None) -> bool:
    """True, once per WIB day, from 03:00 WIB. Several pods may ask; the
    compare-and-set on alert_rules lets exactly one of them win."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    local = now.astimezone(daycolor.WIB)
    if local.hour < 3 or not await link_live():
        return False
    day = int(local.strftime("%Y%m%d"))
    won = await db.execute(
        "UPDATE alert_rules SET value_num = %s, updated_by = 'pos_sender' "
        "WHERE rule_key = 'hiryu_snapshot_last_day' AND (value_num IS NULL OR value_num <> %s)",
        (day, day))
    return bool(won)


async def loop_tick(now: datetime | None = None) -> None:
    """What main.py runs every 5 seconds: free dead claims, queue the nightly
    snapshot when it is due, then send for up to ~4 seconds."""
    if not db.ready():
        return
    await reset_stale_claims()
    if await nightly_snapshot_due(now):
        n = await queue_full_snapshot()
        log.info("nightly Hiryu stock snapshot queued: %s rows", n)
    started = time.monotonic()
    while time.monotonic() - started < 4.0:
        if await send_due(20) < 20:
            break

