"""The sender for the Hiryu link: messages 3, 4, 5 and the catalogue pull
(PRD §0.6, §9.4; docs/hiryu-link-v1.md v1.2).

The floor code only ever QUEUES: ledger.enqueue_pos_push after every stock
change, ledger.enqueue_pos_message at Selesai dikemas and at Barang tidak ada.
This module is the one place that reads the queue and talks to Hiryu, so the
rules of the contract live here and nowhere else:

  * one message per call, POSTed to POS_WEBHOOK_URL with X-Hiryu-Key and
    Idempotency-Key = message_id;
  * order messages ahead of stock messages (send_priority, then id);
  * a stock number is worked out when it is SENT, not when it was queued, and
    a burst of queued rows for one SKU goes as one number (§9.4.3);
  * stock goes to every active Hiryu store (hiryu_stores.active: Hiryu says
    active, a brand is picked, the dark store is in Hiryu's catalogue; H8).
    There is no switch per store: hiryu_stores.link_on is no longer read;
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

The catalogue pull (Sinkron ulang dari Hiryu, `pull_catalogue`) is not
queued: the button's request calls GET POS_CATALOGUE_URL and waits up to 20 s
for the full message 6, which goes through the same handler as Hiryu's own
POST. It replaced the queued `catalogue_request` (6 Oct); old rows of that type
stay readable in the log and a pending one is suppressed, never sent.

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
from urllib.parse import urlsplit

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

# Message number on 11d.
MESSAGE_NO = {"stock_level": 3, "order_ready": 4, "order_short": 5}

# Outbox types no longer sent. A row still pending is suppressed with this
# reason; sent rows and their log entries stay readable.
RETIRED_TYPES = {
    "catalogue_request": ("Diganti tarik katalog (GET POS_CATALOGUE_URL) / "
                          "Replaced by the catalogue pull (GET POS_CATALOGUE_URL)"),
}

# The catalogue pull in the Pesan Hiryu log (no message number: its answer is 6).
PULL_TYPE = "catalogue_pull"
CATALOGUE_TIMEOUT = 20.0

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


def catalogue_url() -> str:
    """Hiryu's read-only catalogue address. POS_CATALOGUE_URL; when empty, the
    origin of POS_WEBHOOK_URL + /catalogue (https://hiryu.example/wms/hook ->
    https://hiryu.example/catalogue). Empty when neither gives an address."""
    url = os.getenv("POS_CATALOGUE_URL", "").strip()
    if url:
        return url
    hook = urlsplit(webhook_url())
    if hook.scheme not in ("http", "https") or not hook.netloc:
        return ""
    return f"{hook.scheme}://{hook.netloc}/catalogue"


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

async def available_now(site_id: int, sku_id: int) -> int:
    """On the rack, minus held for orders not yet picked, never below 0.

    The same number as Stok's "Bisa dijual" (routers/stok.py): real rack bins
    only. Units in a special bin are left out: a temporary inbound bin (IN, not
    put away yet), the quarantine tray (QR, not sellable) and an outbound
    basket (OUT, already picked). qty_allocated is exactly "held, not yet
    picked": the pick releases it.
    """
    row = await db.fetch_one(
        "SELECT COALESCE(SUM(ib.qty_on_hand), 0) AS rack, COALESCE(SUM(ib.qty_allocated), 0) AS held "
        "FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "LEFT JOIN special_bins sb ON sb.location_id = l.id "
        "WHERE ib.site_id = %s AND ib.sku_id = %s AND l.is_virtual = 0 AND sb.location_id IS NULL",
        (site_id, sku_id))
    if not row:
        return 0
    return max(0, int(row["rack"] or 0) - int(row["held"] or 0))


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
        "SELECT id, brand_id, hiryu_sku_code FROM skus WHERE id = %s",
        (row["sku_id"],))
    if not sku:
        raise Suppress("SKU tidak ada / SKU not found")
    if not (sku["hiryu_sku_code"] or "").strip():
        raise Suppress("SKU belum punya kode Hiryu / SKU has no Hiryu SKU code")
    stores = await db.fetch_all(
        "SELECT hiryu_store_no FROM hiryu_stores "
        "WHERE site_id = %s AND brand_id = %s AND active = 1 "
        "ORDER BY hiryu_store_no",
        (row["site_id"], sku["brand_id"]))
    if not stores:
        raise Suppress("Tidak ada toko Hiryu aktif untuk merek ini di dark store ini / "
                       "No active Hiryu store for this brand at this dark store")

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

    avail = await available_now(row["site_id"], row["sku_id"])
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


async def standin_catalogue_body(message_id: str) -> dict:
    """The Hiryu stand-in's answer to a catalogue pull (Mode demo): a full
    message 6 of what the WMS already holds (dark stores, stores, SKUs, menus),
    so nothing changes but the exact JSON shows in Pesan Hiryu."""
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
    return {"message_id": message_id, "full": True, "request_id": None,
            "dark_stores": dark_stores, "stores": stores, "skus": skus,
            "menus": [{"hiryu_store_id": k, "items": v} for k, v in menus.items()]}


async def _standin_reacts(row: dict, mtype: str, data: dict) -> None:
    """What Hiryu does next, played by the stand-in: after item_short with
    cancel_order it cancels on Grab with 2001 and sends message 2 back
    (cancelled_by merchant), through the very same handler Hiryu's call runs.
    (The catalogue pull is answered in pull_catalogue, not here.)"""
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
                elif mtype in RETIRED_TYPES:
                    raise Suppress(RETIRED_TYPES[mtype])
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
# The catalogue pull (Sinkron ulang dari Hiryu)
# --------------------------------------------------------------------------

def _pull_http_reason(code: int) -> str:
    if code in (401, 403):
        return (f"Hiryu menolak kunci X-Hiryu-Key (HTTP {code}) / "
                f"Hiryu refused the X-Hiryu-Key (HTTP {code})")
    if code == 404:
        return ("Alamat katalog Hiryu tidak ditemukan (HTTP 404) / "
                "Hiryu's catalogue address was not found (HTTP 404)")
    if code >= 500:
        return f"Hiryu sedang bermasalah (HTTP {code}) / Hiryu has a problem (HTTP {code})"
    return f"Hiryu menjawab HTTP {code}, bukan 200 / Hiryu answered HTTP {code}, not 200"


async def _set_log(direction: str, message_id: str, *, status: str, http_status: int | None,
                   answer) -> None:
    """Finish a row log_message wrote, without counting another attempt."""
    try:
        text = answer if isinstance(answer, str) or answer is None else dumps(answer)
        await db.execute(
            "UPDATE hiryu_message_log SET status = %s, http_status = %s, answer_json = %s "
            "WHERE direction = %s AND message_id = %s",
            (status, http_status, (text or "")[:60000] or None, direction, message_id[:96]))
    except Exception:
        log.exception("could not finish the Pesan Hiryu log for %s", message_id)


async def _fetch_catalogue(url: str, request_id: str) -> tuple[int, str]:
    async with httpx.AsyncClient(timeout=CATALOGUE_TIMEOUT) as client:
        r = await client.get(url, params={"request_id": request_id},
                             headers={"X-Hiryu-Key": shared_secret(), "Accept": "application/json"})
        return r.status_code, r.text


async def pull_catalogue(*, request_id: str, site_id: int, who: str, demo: bool) -> dict:
    """Sinkron ulang dari Hiryu: GET Hiryu's catalogue address (catalogue_url)
    with X-Hiryu-Key and ?request_id=, and run the answer, the full message 6,
    through hiryu_link.handle_catalogue (via "pull"; "demo" when the stand-in
    answers). Waits at most CATALOGUE_TIMEOUT seconds in all. Works without
    POS_PUSH_ENABLED and Sambungan Hiryu aktif: the catalogue comes before
    switch-on. Never raises.

    The Pesan Hiryu log gets the request out (catalogue_pull, H6) first, then
    message 6 in. Returns {"ok", "reason" ('Indonesian / English' or None),
    "http_status", "answer" (message 6's answer when ok)}."""
    import asyncio
    from fastapi import HTTPException
    from pydantic import ValidationError
    from routers import hiryu_link   # here, not at the top: hiryu_link imports this module

    url = catalogue_url()
    via_out, via_in = ("standin", "demo") if demo else ("pull", "pull")
    trigger = (f"Sinkron ulang dari Hiryu ditekan oleh {who}",
               f"Sinkron ulang dari Hiryu pressed by {who}")
    request = {"method": "GET", "url": "Hiryu stand-in (Mode demo)" if demo else (url or None),
               "query": {"request_id": request_id}}
    await log_message(direction="out", message_type=PULL_TYPE, message_id=request_id, via=via_out,
                      status="sending", body=request, h_ref="H6", site_id=site_id,
                      trigger=trigger)

    async def done(ok: bool, reason: str | None = None, code: int | None = None, answer=None):
        await _set_log("out", request_id, status="sent" if ok else "failed", http_status=code,
                       answer=answer if ok else {"reason": reason, "answer": answer})
        return {"ok": ok, "reason": reason, "http_status": code, "answer": answer if ok else None}

    async def refuse_in(payload, mid: str | None, detail) -> None:
        await log_message(direction="in", message_type="catalogue",
                          message_id=(mid or f"{request_id}-answer")[:96], via=via_in,
                          status="refused", body=payload, answer={"detail": detail},
                          http_status=422, message_no=6, h_ref="H6", site_id=site_id,
                          trigger=(f"Jawaban Sinkron ulang {request_id}",
                                   f"Answer to Sinkron ulang {request_id}"))

    code = 200
    if demo:
        try:
            payload = await standin_catalogue_body(f"demo-cat-{request_id}"[:96])
        except Exception:
            log.exception("the stand-in could not build the catalogue for %s", request_id)
            return await done(False, "Stand-in Hiryu tidak bisa membuat katalog / "
                                     "The Hiryu stand-in could not build the catalogue")
    else:
        if not url:
            return await done(False, "Alamat katalog Hiryu belum diisi (POS_CATALOGUE_URL atau "
                                     "POS_WEBHOOK_URL) / Hiryu's catalogue address is not set "
                                     "(POS_CATALOGUE_URL or POS_WEBHOOK_URL)")
        if not shared_secret():
            return await done(False, "Kunci POS_SHARED_SECRET belum diisi / "
                                     "The POS_SHARED_SECRET key is not set")
        secs = int(CATALOGUE_TIMEOUT)
        try:
            code, text = await asyncio.wait_for(_fetch_catalogue(url, request_id), CATALOGUE_TIMEOUT)
        except (asyncio.TimeoutError, httpx.TimeoutException):
            return await done(False, f"Hiryu tidak menjawab dalam {secs} detik / "
                                     f"Hiryu did not answer within {secs} seconds")
        except httpx.HTTPError as e:
            return await done(False, f"Tidak bisa menghubungi Hiryu ({type(e).__name__}) / "
                                     f"Could not reach Hiryu ({type(e).__name__})")
        if code != 200:
            return await done(False, _pull_http_reason(code), code, text[:300] or None)
        try:
            payload = json.loads(text)
        except ValueError:
            return await done(False, "Jawaban Hiryu bukan JSON / Hiryu's answer is not JSON",
                              code, text[:300] or None)

    mid = payload.get("message_id") if isinstance(payload, dict) else None
    mid = mid if isinstance(mid, str) else None
    try:
        msg = hiryu_link.CatalogueMessage.model_validate(payload)
    except ValidationError as e:
        errors = [{k: v for k, v in er.items() if k != "input"}
                  for er in e.errors(include_url=False)]
        first = errors[0] if errors else {}
        where = ".".join(str(x) for x in first.get("loc", ())) or "-"
        what = str(first.get("msg", ""))[:120]
        await refuse_in(payload, mid, errors[:20])
        return await done(False, f"Jawaban Hiryu tidak sesuai pesan 6 ({where}: {what}) / "
                                 f"Hiryu's answer does not fit message 6 ({where}: {what})", code)
    if not msg.full:
        await refuse_in(payload, mid, "full harus true / full must be true")
        return await done(False, "Jawaban Hiryu bukan daftar lengkap (full false) / "
                                 "Hiryu's answer is not the whole list (full false)", code)

    # The answer belongs to this request whatever Hiryu put in request_id.
    msg = msg.model_copy(update={"request_id": request_id})
    try:
        _status, answer = await hiryu_link.handle_catalogue(
            msg, "demo:hiryu-standin" if demo else "hiryu:pull", via=via_in)
    except HTTPException as e:
        return await done(False, f"WMS menolak katalog (HTTP {e.status_code}) / "
                                 f"The WMS refused the catalogue (HTTP {e.status_code})", code)
    except Exception:
        log.exception("handling the pulled catalogue %s failed", request_id)
        return await done(False, "WMS gagal memproses katalog / The WMS could not process the "
                                 "catalogue", code)
    # A message_id Hiryu used before is answered from memory and changes
    # nothing; the request is still answered.
    await db.execute(
        "UPDATE hiryu_catalogue_requests SET answered_at = COALESCE(answered_at, UTC_TIMESTAMP()), "
        "answered_message_id = COALESCE(answered_message_id, %s) WHERE request_id = %s",
        (msg.message_id, request_id))
    return await done(True, None, code, {"message_id": msg.message_id, **answer})


# --------------------------------------------------------------------------
# Full snapshot (§9.4.4) and the 5-second tick
# --------------------------------------------------------------------------

async def queue_full_snapshot(site_id: int | None = None, store_no: int | None = None) -> int:
    """One stock_level row per SKU per live darkstore that has an active Hiryu
    store for the SKU's brand: every SKU slotted there, and every SKU on that
    store's menu (so a menu SKU with no bin is told 0). The number itself is
    worked out at send time. `site_id` or `store_no` limit it to one hub or one
    store (a store that just became active, H8). Returns the rows queued."""
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
        "         AND hs.active = 1" + store_where +
        "  UNION "
        "  SELECT hs.site_id, hi.sku_id FROM hiryu_items hi "
        "    JOIN hiryu_stores hs ON hs.hiryu_store_no = hi.hiryu_store_no AND hs.active = 1" + store_where +
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
