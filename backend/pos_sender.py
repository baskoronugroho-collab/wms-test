"""The sender for the Hiryu link: messages 3, 4, 5 and the catalogue request
(PRD §0.6, §9.4; docs/hiryu-link-v1.md v1.1).

The floor code only ever QUEUES: ledger.enqueue_pos_push after every stock
change, ledger.enqueue_pos_message at Selesai dikemas and at Barang tidak ada,
and routers/hiryu_link.py for Sinkron ulang dari Hiryu. This module is the one
place that reads the queue and talks to Hiryu, so the rules of the contract
live here and nowhere else:

  * one message per call, POSTed to POS_WEBHOOK_URL with X-Hiryu-Key and
    Idempotency-Key = message_id;
  * order messages ahead of stock messages (send_priority, then id);
  * a stock number is worked out when it is SENT, not when it was queued, and
    a burst of queued rows for one SKU goes as one number (§9.4.3);
  * stock goes only for a store whose link is on (hiryu_stores.link_on, H8);
  * retries with a growing wait (10 s, 30 s, 1 min, 2 min, 5 min, then every
    10 min) until Hiryu answers 2xx; a 4xx other than 408 and 429 stops and
    shows as failed on Integrasi Hiryu;
  * the training site never sends (rows are suppressed at enqueue, and again
    here, because a rule enforced twice at the edge cannot leak).

Mode demo (sites.demo_mode): a hub in demo sends to the built-in Hiryu
stand-in instead of POS_WEBHOOK_URL, even when no address or secret is set and
the link switch is off. The stand-in is a sink inside the WMS: it records the
call in the Pesan Hiryu log (hiryu_message_log) and answers 200. No HTTP call is
made to ourselves. After an item_short with action cancel_order it answers the
way Hiryu will, with message 2 (cancelled_by merchant, 2001).

Every message in and out is kept in hiryu_message_log with its exact JSON
(`log_message`), which is what Pengaturan, Integrasi Hiryu shows as Pesan Hiryu.

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
    "catalogue_request": "catalogue_request",
}

# Message number on 11d (the catalogue request has none: it asks for 6).
MESSAGE_NO = {"stock_level": 3, "order_ready": 4, "order_short": 5, "catalogue_request": None}

STALE_CLAIM_SECONDS = 60
HTTP_TIMEOUT = 8.0
MAX_LOGGED_BODY = 8_000_000


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


async def demo_site_ids() -> list[int]:
    rows = await db.fetch_all("SELECT id FROM sites WHERE demo_mode = 1 AND is_training = 0")
    return [int(r["id"]) for r in rows]


async def is_demo_site(site_id: int | None) -> bool:
    if not site_id:
        return False
    row = await db.fetch_one("SELECT demo_mode FROM sites WHERE id = %s", (site_id,))
    return bool(row and row["demo_mode"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(ts: datetime | None) -> str | None:
    """Naive UTC (how every DATETIME here is stored) -> ISO 8601 with Z."""
    if ts is None:
        return None
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
    return ts.replace(microsecond=0).isoformat() + "Z"


def dumps(body) -> str:
    """The one JSON encoding used for what is sent and what is logged, so the
    log shows the exact bytes."""
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=str)


# --------------------------------------------------------------------------
# The Pesan Hiryu log
# --------------------------------------------------------------------------

async def log_message(*, direction: str, message_type: str, message_id: str, via: str,
                      status: str, body=None, answer=None, http_status: int | None = None,
                      message_no: int | None = None, h_ref: str | None = None,
                      site_id: int | None = None, grab_order_id: str | None = None,
                      trigger: tuple[str, str] | None = None,
                      outbox_id: int | None = None) -> None:
    """Keep one message in or out, with its exact JSON and the answer. A retry
    or a repeat of the same message ID updates the row and counts the attempt.
    Never raises: a log that cannot be written must not stop an order."""
    try:
        text = body if isinstance(body, str) or body is None else dumps(body)
        if text and len(text) > MAX_LOGGED_BODY:
            text = text[:MAX_LOGGED_BODY]
        ans = answer if isinstance(answer, str) or answer is None else dumps(answer)
        trig = trigger or (None, None)
        await db.execute(
            "INSERT INTO hiryu_message_log (direction, message_no, message_type, h_ref, "
            "  message_id, site_id, grab_order_id, trigger_id, trigger_en, via, status, "
            "  http_status, attempts, outbox_id, body_json, answer_json) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE status = VALUES(status), http_status = VALUES(http_status), "
            "  attempts = attempts + 1, via = VALUES(via), "
            "  body_json = COALESCE(VALUES(body_json), body_json), "
            "  answer_json = COALESCE(VALUES(answer_json), answer_json), "
            "  site_id = COALESCE(site_id, VALUES(site_id)), "
            "  grab_order_id = COALESCE(grab_order_id, VALUES(grab_order_id))",
            (direction, message_no, message_type, h_ref, message_id[:96], site_id,
             grab_order_id, (trig[0] or "")[:255] or None, (trig[1] or "")[:255] or None,
             via, status, http_status, outbox_id, text, (ans or "")[:60000] or None))
    except Exception:
        log.exception("could not write the Pesan Hiryu log for %s", message_id)


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


_MOVE_WORDS = {
    "receipt_in": ("Barang masuk ditaruh di bin", "Delivery put away"),
    "pick_out": ("Barang diambil untuk pesanan", "Units picked for an order"),
    "return_in": ("Barang dikembalikan ke rak", "Units returned to the rack"),
    "relocate_in": ("Barang dipindah antar bin", "Units moved between bins"),
    "relocate_out": ("Barang dipindah antar bin", "Units moved between bins"),
    "transfer_out": ("Barang keluar dari dark store", "Units left the dark store"),
    "receipt_adjust": ("Koreksi barang masuk", "Delivery corrected"),
    "receipt_undo": ("Koreksi barang masuk", "Delivery corrected"),
}


def _payload(row: dict) -> dict:
    try:
        value = json.loads(row.get("payload_json") or "{}")
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


async def _stock_trigger(row: dict, snapshot: bool) -> tuple[str, str]:
    """What moved the stock, in plain words, from the ledger row written with
    the queued row. A hold or a release writes no ledger row."""
    if snapshot:
        return ("Snapshot stok penuh (sambungan dinyalakan atau 03:00 WIB)",
                "Full stock snapshot (switch-on or 03:00 WIB)")
    created = row.get("created_at")
    mv = None
    if created:
        mv = await db.fetch_one(
            "SELECT movement_type, reason_code FROM stock_movements "
            "WHERE site_id = %s AND sku_id = %s AND created_at BETWEEN %s AND %s "
            "ORDER BY id DESC LIMIT 1",
            (row["site_id"], row["sku_id"], created - timedelta(seconds=5),
             created + timedelta(seconds=1)))
    if not mv:
        return ("Stok ditahan atau dilepas untuk pesanan", "Units held or released for an order")
    if mv["movement_type"] == "adjustment":
        reason = (mv["reason_code"] or "").lower()
        if reason == "short_pick":
            return ("Barang tidak ada: bin disetel ke yang ditemukan",
                    "Missing item: bin set to what was found")
        if "count" in reason or "opname" in reason:
            return ("Hitung stok disetujui", "Count approved")
        if "quarantine" in reason or "write" in reason:
            return ("Karantina atau dihapusbukukan", "Quarantine or write-off")
        return ("Koreksi stok", "Stock corrected")
    return _MOVE_WORDS.get(mv["movement_type"], ("Stok berubah", "Stock changed"))


async def _build_stock(row: dict) -> tuple[list[tuple[str, dict]], int, dict]:
    sku = await db.fetch_one(
        "SELECT id, brand_id, hiryu_sku_code, grab_buffer FROM skus WHERE id = %s",
        (row["sku_id"],))
    if not sku:
        raise Suppress("SKU tidak ada / SKU not found")
    if not (sku["hiryu_sku_code"] or "").strip():
        raise Suppress("SKU belum punya kode Hiryu / SKU has no Hiryu SKU code")
    stores = await db.fetch_all(
        "SELECT hiryu_store_no FROM hiryu_stores "
        "WHERE site_id = %s AND brand_id = %s AND active = 1 AND link_on = 1 "
        "ORDER BY hiryu_store_no",
        (row["site_id"], sku["brand_id"]))
    if not stores:
        raise Suppress("Tidak ada toko Hiryu aktif dengan sambungan menyala untuk merek ini "
                       "di dark store ini / No active Hiryu store with its link on for this brand "
                       "at this dark store")

    # A snapshot row, or any pending snapshot row this one answers, makes the
    # message part of the snapshot (is_snapshot, message 3).
    snapshot = bool(_payload(row).get("snapshot"))
    if not snapshot:
        other = await db.fetch_one(
            "SELECT COUNT(*) AS n FROM pos_outbox WHERE site_id = %s AND sku_id = %s "
            "AND message_type = 'stock_level' AND status = 'pending' AND id <> %s "
            "AND payload_json LIKE %s",
            (row["site_id"], row["sku_id"], row["id"], '%"snapshot"%'))
        snapshot = bool(other and other["n"])

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
    # Hiryu already has this number (a pick of reserved stock changes nothing it
    # sells): skip the repeat. A snapshot always sends.
    if not snapshot:
        last = await db.fetch_one(
            "SELECT available FROM pos_outbox WHERE site_id = %s AND sku_id = %s "
            "AND message_type = 'stock_level' AND status = 'sent' AND merged_into IS NULL "
            "AND available IS NOT NULL AND id <> %s ORDER BY sent_at DESC, id DESC LIMIT 1",
            (row["site_id"], row["sku_id"], row["id"]))
        if last and int(last["available"]) == avail:
            raise Suppress(f"Angka sama dengan pesan terakhir ({avail}) / "
                           f"Same number as the last message ({avail})")
    as_of = _iso(_utcnow())
    code = sku["hiryu_sku_code"].strip().upper()
    # One hub has one Hiryu store per brand, so this is one message; should a
    # brand ever have two stores at a hub, each gets its own message ID.
    out = []
    for st in stores:
        mid = f"wms-{row['id']}" if len(stores) == 1 else f"wms-{row['id']}-{st['hiryu_store_no']}"
        out.append((mid, {"hiryu_store_id": int(st["hiryu_store_no"]), "sku_code": code,
                          "available": avail, "as_of": as_of, "is_snapshot": snapshot}))
    meta = {"h": "H3", "trigger": await _stock_trigger(row, snapshot)}
    return out, avail, meta


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


async def _build_ready(row: dict) -> tuple[list[tuple[str, dict]], dict]:
    order = await _link_order(row["order_ref"])
    if order["status"] == "cancelled":
        raise Suppress("Pesanan sudah dibatalkan / Order already cancelled")
    gm = order["hiryu_short_no"]
    data = {
        "grab_order_id": order["external_ref"],
        "gm_number": gm,
        # Selesai dikemas stamps marked_ready_at; older rows fall back.
        "packed_at": (_iso(order["marked_ready_at"]) or _iso(order["completed_at"])
                      or _iso(row["created_at"])),
    }
    meta = {"h": "H4", "grab_order_id": order["external_ref"],
            "trigger": (f"Packer menekan Selesai dikemas ({gm})",
                        f"The packer tapped Selesai dikemas ({gm})")}
    return [(f"wms-{row['id']}", data)], meta


_ACTION_WORDS = {
    "replaced": ("diganti sesuai instruksi pelanggan", "replaced as the customer chose"),
    "removed": ("dihapus dari pesanan", "removed from the order"),
    "cancel_order": ("pesanan dibatalkan", "order cancelled"),
}


async def _build_short(row: dict) -> tuple[list[tuple[str, dict]], dict]:
    """Message 5, one per order line that changed (contract v1.1).

    The facts come from the order line (V27), written by the pick flow
    (floor.record_outcome): oos_action (replaced | removed | cancel_order),
    oos_units_wanted, oos_units_found, oos_done_replace_sku_code and
    oos_done_replace_units; the queued payload carries the same facts and is
    used where a column is empty. The row is queued with payload
    {"order_line_id": id, ...}. The line's Hiryu item, SKU code and the
    customer's replacement come from message 1, kept on the same line. An older
    row (no order_line_id) is worked out from the SKU and counts as
    cancel_order.
    """
    order = await _link_order(row["order_ref"])
    queued = _payload(row)
    line_id = queued.get("order_line_id")
    if isinstance(line_id, int):
        line = await db.fetch_one(
            "SELECT ol.*, s.hiryu_sku_code AS sku_hiryu_code, s.brand_sku_code "
            "FROM order_lines ol JOIN skus s ON s.id = ol.sku_id "
            "WHERE ol.id = %s AND ol.order_id = %s", (line_id, order["id"]))
    else:
        if not row["sku_id"]:
            raise Suppress("Pesan kurang tanpa baris atau SKU / Item short without a line or SKU")
        line = await db.fetch_one(
            "SELECT ol.*, s.hiryu_sku_code AS sku_hiryu_code, s.brand_sku_code "
            "FROM order_lines ol JOIN skus s ON s.id = ol.sku_id "
            "WHERE ol.order_id = %s AND ol.sku_id = %s ORDER BY ol.id LIMIT 1",
            (order["id"], row["sku_id"]))
    if not line:
        raise Suppress("Baris tidak ada di pesanan / Line not on the order")
    code = (line.get("hiryu_sku_code") or line.get("sku_hiryu_code") or "").strip().upper()
    item_id = line.get("hiryu_item_id") or queued.get("hiryu_item_id")
    if not code or not item_id:
        raise Suppress("Baris tanpa item atau kode SKU Hiryu / Line has no Hiryu item or SKU code")

    def num(*values):
        for v in values:
            if isinstance(v, int) and not isinstance(v, bool):
                return v
        return None

    def text(*values):
        for v in values:
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    action = text(line.get("oos_action"), queued.get("action")) or "cancel_order"
    if action not in ("replaced", "removed", "cancel_order"):
        action = "cancel_order"
    wanted = num(line.get("oos_units_wanted"), queued.get("units_wanted"),
                 line.get("qty_ordered")) or 0
    found = num(line.get("oos_units_found"), queued.get("units_found"),
                line.get("qty_picked")) or 0
    data = {
        "grab_order_id": order["external_ref"],
        "gm_number": order["hiryu_short_no"],
        "hiryu_item_id": item_id,
        "sku_code": code,
        "action": action,
        "units_wanted": int(wanted),
        "units_found": int(found),
        "replace_hiryu_item_id": None,
        "replace_sku_code": None,
        "replace_units": None,
    }
    if action == "replaced":
        data["replace_hiryu_item_id"] = text(line.get("oos_replace_hiryu_item_id"),
                                             queued.get("replace_hiryu_item_id"))
        rep_code = text(line.get("oos_done_replace_sku_code"), queued.get("replace_sku_code"),
                        line.get("oos_replace_sku_code"))
        data["replace_sku_code"] = rep_code.upper() if rep_code else None
        data["replace_units"] = num(line.get("oos_done_replace_units"), queued.get("replace_units"),
                                    line.get("oos_replace_units"))
    gm = order["hiryu_short_no"]
    words = _ACTION_WORDS[action]
    meta = {"h": "H5 H10" if action in ("replaced", "removed") else "H5",
            "grab_order_id": order["external_ref"],
            "trigger": (f"Barang tidak ada di {gm} ({item_id}): {words[0]}",
                        f"Item missing on {gm} ({item_id}): {words[1]}")}
    return [(f"wms-{row['id']}", data)], meta


async def _build_catalogue_request(row: dict) -> tuple[list[tuple[str, dict]], dict]:
    queued = _payload(row)
    if not queued.get("request_id"):
        raise Suppress("Permintaan katalog tanpa request_id / Catalogue request without request_id")
    who = queued.get("requested_by_name") or "?"
    data = {"request_id": queued["request_id"],
            "requested_at": queued.get("requested_at") or _iso(row["created_at"])}
    meta = {"h": "H6",
            "trigger": (f"Sinkron ulang dari Hiryu ditekan oleh {who}",
                        f"Sinkron ulang dari Hiryu pressed by {who}")}
    return [(f"wms-{row['id']}", data)], meta


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------

def _permanent(status: int) -> bool:
    return 400 <= status < 500 and status not in (408, 429)


def envelope(message_id: str, mtype: str, data: dict) -> dict:
    return {"message_id": message_id, "type": CONTRACT_TYPE.get(mtype, mtype),
            "sent_at": _iso(_utcnow()), "data": data}


async def _post(client: httpx.AsyncClient, body: dict) -> tuple[str, str | None, int | None, str | None]:
    """One call to Hiryu. Returns (outcome 'ok' | 'retry' | 'fail', error,
    HTTP status, answer text)."""
    try:
        r = await client.post(
            webhook_url(), content=dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Hiryu-Key": shared_secret(),
                     "Idempotency-Key": body["message_id"]})
    except httpx.HTTPError as e:
        return "retry", f"{type(e).__name__}: {e}"[:400], None, None
    text = r.text[:2000]
    # 409 = Hiryu took it before: the contract's "duplicate, no change".
    if 200 <= r.status_code < 300 or r.status_code == 409:
        return "ok", None, r.status_code, text
    detail = f"HTTP {r.status_code}: {r.text[:300]}"
    return ("fail" if _permanent(r.status_code) else "retry"), detail, r.status_code, text


async def _standin(row: dict, body: dict) -> tuple[str, str | None, int | None, str | None]:
    """The built-in Hiryu stand-in (Mode demo): takes the message, answers 200.
    Recording happens in the caller, like for a real call."""
    return "ok", None, 200, dumps({"ok": True, "standin": True})


def _plain(text, fallback: str = "-") -> str:
    """One plain line the contract accepts (no <>{}\\, tabs or line breaks)."""
    s = " ".join(str(text or "").replace("\\", "/").translate(
        {ord(c): None for c in "<>{}"}).split())
    return s[:255] or fallback


async def _standin_catalogue(row: dict, data: dict) -> None:
    """Sinkron ulang in Mode demo: the stand-in answers like Hiryu, with a full
    message 6 carrying the same request_id. It sends back what the WMS already
    holds (dark stores, stores, SKUs, menus), so nothing changes but the request
    is answered and the exact JSON shows in Pesan Hiryu."""
    from routers import hiryu_link   # here, not at the top: hiryu_link imports this module
    closed = {d: [] for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}
    sites = await db.fetch_all(
        "SELECT hiryu_dark_store_id, name, address, opening_hours_json FROM sites "
        "WHERE hiryu_dark_store_id IS NOT NULL AND hiryu_active = 1 ORDER BY hiryu_dark_store_id")
    dark_stores = []
    for s in sites:
        try:
            hours = json.loads(s["opening_hours_json"]) if s["opening_hours_json"] else closed
        except ValueError:
            hours = closed
        dark_stores.append({"hiryu_dark_store_id": int(s["hiryu_dark_store_id"]),
                            "name": _plain(s["name"]), "address": _plain(s["address"]),
                            "opening_hours": hours})
    listed = {d["hiryu_dark_store_id"] for d in dark_stores}
    stores = [{"hiryu_store_id": int(r["hiryu_store_no"]), "name": _plain(r["store_name"]),
               "hiryu_dark_store_id": int(r["hiryu_dark_store_id"]),
               "status": "active" if r["hiryu_active"] else "inactive",
               "order_acceptance": r["order_acceptance"] or "MANUAL"}
              for r in await db.fetch_all(
                  "SELECT hiryu_store_no, store_name, hiryu_dark_store_id, hiryu_active, "
                  "order_acceptance FROM hiryu_stores WHERE hiryu_dark_store_id IS NOT NULL "
                  "ORDER BY hiryu_store_no")
              if int(r["hiryu_dark_store_id"]) in listed]
    menus = {s["hiryu_store_id"]: [] for s in stores}
    codes: dict[str, int | None] = {}
    for it in await db.fetch_all(
            "SELECT i.hiryu_store_no, i.hiryu_item_id, i.item_name, i.sku_code, i.sku_id, "
            "i.units_per_sale, i.price_idr, i.available_status FROM hiryu_items i "
            "WHERE i.active = 1 ORDER BY i.hiryu_store_no, i.hiryu_item_id"):
        if it["hiryu_store_no"] not in menus:
            continue
        code = (it["sku_code"] or "").strip().upper() or None
        if code:
            codes.setdefault(code, it["sku_id"])
        menus[it["hiryu_store_no"]].append({
            "item_id": it["hiryu_item_id"], "name": _plain(it["item_name"]), "sku_code": code,
            "units_per_sale": int(it["units_per_sale"] or 1),
            "price": None if it["price_idr"] is None else int(it["price_idr"]),
            "available": (it["available_status"] or "AVAILABLE").upper() == "AVAILABLE"})
    skus = []
    for code, sku_id in sorted(codes.items()):
        sku = await db.fetch_one(
            "SELECT id, name_display FROM skus WHERE id = %s", (sku_id,)) if sku_id else None
        if not sku:
            sku = await db.fetch_one(
                "SELECT id, name_display FROM skus WHERE hiryu_sku_code = %s LIMIT 1", (code,))
        if not sku:
            continue
        bars = [r["barcode"] for r in await db.fetch_all(
            "SELECT barcode FROM barcodes WHERE sku_id = %s ORDER BY barcode LIMIT 10", (sku["id"],))]
        skus.append({"sku_code": code, "name": _plain(sku["name_display"]), "barcodes": bars})
    try:
        msg = hiryu_link.CatalogueMessage(
            message_id=f"demo-cat-{row['id']}", full=True, request_id=data["request_id"],
            dark_stores=dark_stores, stores=stores, skus=skus,
            menus=[{"hiryu_store_id": k, "items": v} for k, v in menus.items()])
        await hiryu_link.handle_catalogue(msg, "demo:hiryu-standin", via="demo")
    except Exception:
        log.exception("stand-in message 6 for outbox row %s failed", row["id"])


async def _standin_reacts(row: dict, mtype: str, data: dict) -> None:
    """What Hiryu does next, played by the stand-in: after item_short with
    cancel_order it cancels on Grab with 2001 and sends message 2 back
    (cancelled_by merchant); after a catalogue_request it answers with a full
    message 6. Through the very same handlers Hiryu's calls run."""
    if mtype == "catalogue_request":
        await _standin_catalogue(row, data)
        return
    if mtype != "order_short" or data.get("action") != "cancel_order":
        return
    from routers import hiryu_link   # here, not at the top: hiryu_link imports this module
    try:
        msg = hiryu_link.CancelMessage(
            message_id=f"demo-can-auto-{row['id']}", reason_code="2001",
            reason="Item out of stock", cancelled_by="merchant",
            cancelled_at=_iso(_utcnow()))
        await hiryu_link.handle_cancel(data["grab_order_id"], msg, "demo:hiryu-standin",
                                       via="demo",
                                       trigger=("Stand-in Hiryu membatalkan dengan 2001 setelah "
                                                "barang tidak ada",
                                                "Hiryu stand-in cancels with 2001 after the "
                                                "missing item"))
    except Exception:
        log.exception("stand-in message 2 for outbox row %s failed", row["id"])


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


_LOG_STATUS = {"ok": "sent", "retry": "retrying", "fail": "failed"}


async def send_due(batch: int = 20) -> int:
    """Send up to `batch` due rows. Returns how many rows were handled.

    Real sending needs POS_PUSH_ENABLED, a webhook URL, the secret and the
    link switch; while any is off the rows stay pending (shadow mode on
    Integrasi Hiryu). Rows of a hub in Mode demo go to the stand-in whatever
    those switches say.
    """
    if not db.ready():
        return 0
    live = await sending_on()
    demo = await demo_site_ids()
    if not live and not demo:
        return 0
    where, params = "", []
    if not live:
        where = f" AND o.site_id IN ({db.placeholders(demo)})"
        params = list(demo)
    rows = await db.fetch_all(
        "SELECT o.id, o.site_id, o.sku_id, o.message_type, o.order_ref, o.attempts, "
        "       o.created_at, o.payload_json, s.site_type, s.is_training, s.demo_mode "
        "FROM pos_outbox o LEFT JOIN sites s ON s.id = o.site_id "
        "WHERE o.status = 'pending' "
        "  AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= UTC_TIMESTAMP())" + where +
        " ORDER BY o.send_priority, o.id LIMIT %s", (*params, batch))
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
            in_demo = bool(row["demo_mode"])
            try:
                if row["is_training"] or (row["site_type"] or "darkstore") != "darkstore":
                    raise Suppress("Lokasi latihan atau hub tidak pernah mengirim / "
                                   "Training site or hub never sends")
                available = None
                mtype = row["message_type"]
                if mtype == "stock_level":
                    messages, available, meta = await _build_stock(row)
                elif mtype == "order_ready":
                    messages, meta = await _build_ready(row)
                elif mtype == "order_short":
                    messages, meta = await _build_short(row)
                elif mtype == "catalogue_request":
                    messages, meta = await _build_catalogue_request(row)
                else:
                    raise Suppress(f"Jenis pesan tidak dikenal / Unknown message type: {mtype}")
                outcome, error = "ok", None
                for mid, data in messages:
                    body = envelope(mid, mtype, data)
                    if in_demo:
                        o, e, code, answer = await _standin(row, body)
                    else:
                        o, e, code, answer = await _post(client, body)
                    await log_message(
                        direction="out", message_type=CONTRACT_TYPE.get(mtype, mtype),
                        message_id=mid, via="standin" if in_demo else "webhook",
                        status=_LOG_STATUS[o], body=body, answer=answer or e,
                        http_status=code, message_no=MESSAGE_NO.get(mtype),
                        h_ref=meta.get("h"), site_id=row["site_id"],
                        grab_order_id=meta.get("grab_order_id"), trigger=meta.get("trigger"),
                        outbox_id=row["id"])
                    if o != "ok":
                        # A permanent refusal of any part wins over a retry.
                        if outcome != "fail":
                            outcome, error = o, e
                await _finish(row["id"], outcome, error, int(row["attempts"] or 0), available)
                if in_demo and outcome == "ok":
                    for _mid, data in messages:
                        await _standin_reacts(row, mtype, data)
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

async def queue_full_snapshot(site_id: int | None = None, store_no: int | None = None) -> int:
    """One stock_level row per SKU per live darkstore that has an active Hiryu
    store with its link on for the SKU's brand: every SKU slotted there, and
    every SKU on that store's menu (so a menu SKU with no bin is told 0). The
    number itself is worked out at send time. `site_id` or `store_no` limit it
    to one hub or one store (switching one store's link on, H8). Returns the
    rows queued."""
    store_where, params = "", []
    if store_no is not None:
        store_where, params = " AND hs.hiryu_store_no = %s", [store_no]
    site_where = ""
    if site_id is not None:
        site_where = " AND st.id = %s"
    return await db.execute(
        "INSERT INTO pos_outbox (site_id, sku_id, available, status, message_type, "
        "                        send_priority, payload_json) "
        "SELECT x.site_id, x.sku_id, NULL, 'pending', 'stock_level', 5, '{\"snapshot\": true}' "
        "FROM ("
        "  SELECT sa.site_id, sa.sku_id FROM slot_assignments sa "
        "    JOIN skus k ON k.id = sa.sku_id "
        "    JOIN hiryu_stores hs ON hs.site_id = sa.site_id AND hs.brand_id = k.brand_id "
        "         AND hs.active = 1 AND hs.link_on = 1" + store_where +
        "  UNION "
        "  SELECT hs.site_id, hi.sku_id FROM hiryu_items hi "
        "    JOIN hiryu_stores hs ON hs.hiryu_store_no = hi.hiryu_store_no AND hs.active = 1 "
        "         AND hs.link_on = 1" + store_where +
        "   WHERE hi.active = 1 AND hi.sku_id IS NOT NULL"
        ") x JOIN sites st ON st.id = x.site_id "
        "WHERE st.site_type = 'darkstore' AND st.is_training = 0 AND st.active = 1" + site_where,
        (*params, *params, *([site_id] if site_id is not None else [])))


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
