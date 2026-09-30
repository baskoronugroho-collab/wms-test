"""The Hiryu link, WMS side (PRD §0.6, §2.12, §6.6, §9.4; docs/hiryu-link-v1.md).

Two routers live here:

  `router`     /api/hiryu/v1   what Hiryu calls: message 1 (order to pick),
                               message 2 (order cancelled), message 6
                               (catalogue) and a ping. Opened as a public path
                               on Substrait (no Google sign-in) and protected by
                               the shared secret in X-Hiryu-Key only.
  `ui_router`  /api/hiryu-link what the console calls, behind Google sign-in:
                               the link's status, the Ops HQ switch, a full
                               snapshot, retrying failures, the catalogue Hiryu
                               sent, and test messages for the simulator.

The test endpoints exist because the SSO proxy strips X-Forwarded-Email on a
public path: once /api/hiryu/v1 is public, a signed-in browser cannot reach it
as Ops HQ. They run the very same handler functions, so a test through the
simulator is a test of what Hiryu will hit.

Hiryu first (PRD §2.12): Hiryu owns the order, the customer and the catalogue.
The WMS takes only the fields the contract names; every model here refuses any
other field (extra="forbid") and every text field has a strict pattern, so no
customer name, phone, address, note or payment can ride along (§6.6.1).
"""
import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

import auth
import daycolor
import db
import ledger
import models
import pos_sender
from routers import outbound

router = APIRouter(prefix="/api/hiryu/v1", tags=["hiryu link"])
ui_router = APIRouter(prefix="/api/hiryu-link", tags=["hiryu link"])

_MSG_ID = r"^[A-Za-z0-9._:-]{1,96}$"
_ORDER_ID = r"^[A-Za-z0-9._:-]{1,64}$"
_SKU_CODE = r"^[A-Za-z0-9._/+-]{1,64}$"
_ITEM_ID = r"^[A-Za-z0-9._#:/-]{1,64}$"
_TEXT = r"^[^<>{}\\\r\n\t]{1,255}$"   # a product or store name: one plain line


# --------------------------------------------------------------------------
# Message models (the contract, strictly)
# --------------------------------------------------------------------------

class OrderLineMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sku_code: str = Field(pattern=_SKU_CODE, description="Hiryu SKU code, compared ignoring capitals")
    units: int = Field(ge=1, le=999, description="Item quantity x units per sale, worked out by Hiryu")
    hiryu_item_id: str = Field(pattern=_ITEM_ID)
    item_qty: int = Field(ge=1, le=999)
    item_price: int | None = Field(default=None, ge=0, le=100_000_000,
                                   description="The item's menu price that day, rupiah")


class OrderMessage(BaseModel):
    """Message 1: sent the moment staff press Accept in Hiryu."""
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(pattern=_MSG_ID)
    grab_order_id: str = Field(pattern=_ORDER_ID)
    gm_number: str = Field(pattern=r"^GM-[A-Za-z0-9]{1,16}$")
    hiryu_store_id: int = Field(ge=1, le=99_999_999)
    order_time: str = Field(max_length=40, description="ISO 8601 with a zone")
    scheduled_time: str | None = Field(default=None, max_length=40)
    estimated_ready_time: str | None = Field(default=None, max_length=40)
    lines: list[OrderLineMessage] = Field(min_length=1, max_length=100)


class CancelMessage(BaseModel):
    """Message 2. The reason is Grab's (e.g. 2001 Item out of stock), never the
    customer's words, so it is held to a short plain line."""
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(pattern=_MSG_ID)
    reason_code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,16}$")
    reason: str | None = Field(default=None, pattern=r"^[A-Za-z0-9 .,:;()'/&_-]{1,160}$")
    cancelled_at: str | None = Field(default=None, max_length=40)


class CatalogueStore(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_store_id: int = Field(ge=1, le=99_999_999)
    name: str = Field(pattern=_TEXT, max_length=160)
    dark_store: str = Field(pattern=r"^[A-Za-z0-9_-]{1,32}$", description="WMS hub code")
    brand: str = Field(pattern=r"^[A-Za-z0-9 &._-]{1,64}$", description="WMS brand code")
    status: str = Field(default="active", pattern=r"^(?i:active|inactive)$")


class CatalogueSku(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sku_code: str = Field(pattern=_SKU_CODE)
    name: str = Field(pattern=_TEXT)
    barcodes: list[str] = Field(default_factory=list, max_length=10)


class CatalogueItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(pattern=_ITEM_ID)
    name: str = Field(pattern=_TEXT)
    sku_code: str | None = Field(default=None, pattern=_SKU_CODE,
                                 description="Empty when the item is not counted in Hiryu")
    units_per_sale: int = Field(default=1, ge=1, le=99)
    price: int | None = Field(default=None, ge=0, le=100_000_000)
    available: bool = True


class CatalogueMenu(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_store_id: int = Field(ge=1, le=99_999_999)
    items: list[CatalogueItem] = Field(default_factory=list, max_length=3000)


class CatalogueMessage(BaseModel):
    """Message 6: stores, SKUs and each store's menu; `full` = the whole list."""
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(pattern=_MSG_ID)
    full: bool = False
    stores: list[CatalogueStore] = Field(default_factory=list, max_length=500)
    skus: list[CatalogueSku] = Field(default_factory=list, max_length=10000)
    menus: list[CatalogueMenu] = Field(default_factory=list, max_length=500)


class OrderAnswer(BaseModel):
    order_id: int | None = None
    status: str = Field(description="accepted | duplicate")


class CancelAnswer(BaseModel):
    order_id: int | None = None
    status: str = Field(description="cancelled | already_cancelled | pending")


class CatalogueAnswer(BaseModel):
    stores: int
    skus_created: int
    skus_updated: int
    items: int
    problems: list[str]


class Ping(BaseModel):
    ok: bool


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def _utc(value: str | None, name: str) -> datetime | None:
    """ISO 8601 with a zone -> naive UTC, like every DATETIME in this database.
    A time without a zone is refused: the contract says every time carries one,
    and guessing WIB or UTC would move a ready-by by seven hours."""
    if value is None or value == "":
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"{name}: waktu tidak dikenal / not an ISO 8601 time")
    if ts.tzinfo is None:
        raise HTTPException(422, f"{name}: waktu tanpa zona / time has no zone")
    return ts.astimezone(timezone.utc).replace(tzinfo=None)


def _iso(ts: datetime) -> str:
    return ts.replace(microsecond=0).isoformat() + "Z"


async def _replay(message_id: str) -> tuple[int, dict] | None:
    row = await db.fetch_one(
        "SELECT status_code, response_json FROM hiryu_inbound_messages WHERE message_id = %s",
        (message_id,))
    if not row:
        return None
    return int(row["status_code"]), json.loads(row["response_json"] or "{}")


async def _remember(message_id: str, mtype: str, code: int, answer: dict) -> None:
    await db.execute(
        "INSERT IGNORE INTO hiryu_inbound_messages (message_id, message_type, status_code, "
        "response_json) VALUES (%s,%s,%s,%s)",
        (message_id, mtype, code, json.dumps(answer, default=str)))


async def _log(mtype: str, message_id: str | None, outcome: str, detail: str | None = None,
               grab_order_id: str | None = None, store_no: int | None = None) -> None:
    await db.execute(
        "INSERT INTO hiryu_inbound_log (message_type, message_id, grab_order_id, "
        "hiryu_store_no, outcome, detail) VALUES (%s,%s,%s,%s,%s,%s)",
        (mtype, message_id, grab_order_id, store_no, outcome, (detail or "")[:400] or None))


async def _audit(actor: str, entity: str, entity_id: int | None, action: str,
                 after: dict | None = None) -> None:
    async with db.tx() as cur:
        await ledger.audit(cur, actor_email=actor, entity=entity, entity_id=entity_id,
                           action=action, after=after)


async def _sku_for_code(code: str, brand_id: int | None) -> dict | None:
    """A Hiryu SKU code -> WMS SKU, ignoring capitals (§0.6.2).

    The Hiryu code first; a SKU with no Hiryu code yet may still match on its
    brand SKU code (the seed and older SKUs use the same code for both). Without
    a brand, only an unambiguous match counts.
    """
    code = code.strip().upper()
    where, params = "", [code]
    if brand_id is not None:
        where, params = " AND brand_id = %s", [code, brand_id]
    rows = await db.fetch_all(
        "SELECT id, brand_id FROM skus WHERE UPPER(hiryu_sku_code) = %s" + where +
        " ORDER BY active DESC, id LIMIT 2", params)
    if not rows:
        rows = await db.fetch_all(
            "SELECT id, brand_id FROM skus WHERE UPPER(brand_sku_code) = %s "
            "AND (hiryu_sku_code IS NULL OR hiryu_sku_code = '')" + where +
            " ORDER BY active DESC, id LIMIT 2", params)
    if not rows:
        return None
    if brand_id is None and len({r["brand_id"] for r in rows}) > 1:
        return None
    return rows[0]


# --------------------------------------------------------------------------
# Message 1: order to pick
# --------------------------------------------------------------------------

async def handle_order(body: OrderMessage, caller: str, *, is_test: bool = False) -> tuple[int, dict]:
    """Create the order and its pick, or answer that it exists. Returns
    (HTTP status, answer). A refusal raises 422 after logging it for Ops HQ."""
    seen = await _replay(body.message_id)
    if seen:
        return seen
    gid = body.grab_order_id

    store = await db.fetch_one(
        "SELECT hs.hiryu_store_no, hs.site_id, hs.brand_id FROM hiryu_stores hs "
        "JOIN sites s ON s.id = hs.site_id WHERE hs.hiryu_store_no = %s AND hs.active = 1",
        (body.hiryu_store_id,))
    if not store:
        msg = (f"Toko Hiryu #{body.hiryu_store_id} tidak dikenal atau tidak aktif. Ops HQ sudah "
               f"diberi tahu. / Hiryu store #{body.hiryu_store_id} is unknown or inactive. "
               "Ops HQ has been flagged.")
        await _log("order", body.message_id, "refused", msg, gid, body.hiryu_store_id)
        raise HTTPException(422, msg)

    existing = await db.fetch_one("SELECT id FROM orders WHERE external_ref = %s", (gid,))
    if existing:
        answer = {"order_id": existing["id"], "status": "duplicate"}
        await _log("order", body.message_id, "duplicate", None, gid, body.hiryu_store_id)
        await _remember(body.message_id, "order", 200, answer)
        return 200, answer

    # SKU codes -> WMS SKUs, within the store's brand.
    resolved: dict[str, int] = {}
    unknown = []
    for line in body.lines:
        code = line.sku_code.strip().upper()
        if code in resolved or code in unknown:
            continue
        sku = await _sku_for_code(code, store["brand_id"])
        if sku:
            resolved[code] = sku["id"]
        else:
            unknown.append(code)
    if unknown:
        codes = ", ".join(unknown)
        msg = (f"Kode SKU tidak dikenal: {codes}. Ops HQ sudah diberi tahu. / "
               f"Unknown SKU code: {codes}. Ops HQ has been flagged.")
        await _log("order", body.message_id, "refused", msg, gid, body.hiryu_store_id)
        raise HTTPException(422, msg)

    # One order line per SKU. Several items on one SKU (a single and a 2-pack)
    # add up their units and item quantities; the first item ID is kept. The
    # price stored is weighted by item quantity, so item_qty x item_price_idr is
    # still the line's sale value for the brand report (§15.1).
    per_sku: dict[int, dict] = {}
    for line in body.lines:
        sid = resolved[line.sku_code.strip().upper()]
        agg = per_sku.setdefault(sid, {"units": 0, "item_qty": 0, "item_id": line.hiryu_item_id,
                                       "value": 0, "priced_qty": 0})
        agg["units"] += line.units
        agg["item_qty"] += line.item_qty
        if line.item_price is not None:
            agg["value"] += line.item_qty * line.item_price
            agg["priced_qty"] += line.item_qty

    # Ready-by (§9.2): Grab's estimate when Hiryu has it; else scheduled time
    # minus the lead; else order time plus the Grab window.
    placed = _utc(body.order_time, "order_time")
    scheduled = _utc(body.scheduled_time, "scheduled_time")
    estimated = _utc(body.estimated_ready_time, "estimated_ready_time")
    if estimated:
        promised = estimated
    elif scheduled:
        promised = scheduled - timedelta(minutes=await pos_sender.rule("scheduled_lead_minutes", 20))
    else:
        promised = placed + timedelta(minutes=await pos_sender.rule("grab_ready_minutes", 10))

    order_in = models.OrderIn(
        external_ref=gid, site_id=store["site_id"],
        lines=[models.OrderLineIn(sku_id=sid, quantity=a["units"]) for sid, a in per_sku.items()],
        channel="grab", delivery_mode="grab_rider", is_test=is_test,
        placed_at=_iso(placed), promised_at=_iso(promised),
        # Carried in, not written after: receive_order assigns a picker at once,
        # and a scheduled order must wait in its lane until it is due.
        scheduled_at=_iso(scheduled) if scheduled else None,
    )
    try:
        result = await outbound.receive_order(order_in)
    except HTTPException:
        raise
    except Exception:
        # Two copies of one message at the same moment: the unique key on the
        # Grab order ID lets one in, and the other is a duplicate.
        again = await db.fetch_one("SELECT id FROM orders WHERE external_ref = %s", (gid,))
        if not again:
            raise
        result = {"order_id": again["id"], "status": "duplicate"}
    if result.get("status") == "duplicate":
        answer = {"order_id": result["order_id"], "status": "duplicate"}
        await _log("order", body.message_id, "duplicate", None, gid, body.hiryu_store_id)
        await _remember(body.message_id, "order", 200, answer)
        return 200, answer

    order_id = result["order_id"]
    await db.execute(
        "UPDATE orders SET hiryu_short_no = %s, hiryu_store_no = %s, source = 'link', "
        "acceptance = 'MANUAL', scheduled_at = %s WHERE id = %s",
        (body.gm_number, body.hiryu_store_id, scheduled, order_id))
    for sid, a in per_sku.items():
        price = round(a["value"] / a["priced_qty"]) if a["priced_qty"] else None
        await db.execute(
            "UPDATE order_lines SET hiryu_item_id = %s, item_qty = %s, item_price_idr = %s "
            "WHERE order_id = %s AND sku_id = %s",
            (a["item_id"], a["item_qty"], price, order_id, sid))
    await _audit(caller, "order", order_id, "hiryu_link_order",
                 {"grab_order_id": gid, "gm_number": body.gm_number,
                  "hiryu_store_id": body.hiryu_store_id, "test": is_test})

    # A cancel that arrived first is applied now (§0.6.2).
    applied = await _apply_pending_cancel(gid, caller)
    short = int(result.get("short_lines") or 0)
    detail = ("dibatalkan: pembatalan datang lebih dulu / cancelled: the cancel came first"
              if applied else (f"{short} baris kurang stok / {short} line(s) short" if short else None))
    await _log("order", body.message_id, "accepted", detail, gid, body.hiryu_store_id)
    answer = {"order_id": order_id, "status": "accepted"}
    await _remember(body.message_id, "order", 201, answer)
    return 201, answer


@router.post("/orders", response_model=OrderAnswer, status_code=201,
             responses={200: {"description": "Duplicate: the order was received before"},
                        422: {"description": "Refused: unknown store or SKU code; do not retry"}})
async def post_order(body: OrderMessage, response: Response,
                     caller: str = Depends(outbound.hiryu_or_admin)):
    """Message 1: an order to pick, the moment staff press Accept in Hiryu."""
    code, answer = await handle_order(body, caller)
    response.status_code = code
    return answer


# --------------------------------------------------------------------------
# Message 2: order cancelled
# --------------------------------------------------------------------------

async def _cancel_existing(order: dict, reason_code: str | None, reason: str | None,
                           cancelled_at: datetime | None) -> None:
    await outbound.cancel_order(order["external_ref"], site_id=order["site_id"], actor="hiryu",
                                reason=" ".join(x for x in (reason_code, reason) if x) or "hiryu_cancel")
    await db.execute(
        "UPDATE orders SET cancelled_by = 'hiryu', cancelled_at = COALESCE(%s, UTC_TIMESTAMP()), "
        "cancel_reason_code = %s, cancel_reason = %s WHERE id = %s",
        (cancelled_at, reason_code, reason, order["id"]))


async def _apply_pending_cancel(grab_order_id: str, caller: str) -> bool:
    pc = await db.fetch_one(
        "SELECT * FROM hiryu_pending_cancels WHERE grab_order_id = %s AND applied_at IS NULL",
        (grab_order_id,))
    if not pc:
        return False
    order = await db.fetch_one(
        "SELECT id, site_id, status, external_ref FROM orders WHERE external_ref = %s",
        (grab_order_id,))
    if not order:
        return False
    # Claim it, so two pods never cancel (and release stock) twice.
    won = await db.execute(
        "UPDATE hiryu_pending_cancels SET applied_at = UTC_TIMESTAMP() "
        "WHERE id = %s AND applied_at IS NULL", (pc["id"],))
    if not won:
        return False
    try:
        if order["status"] != "cancelled":
            await _cancel_existing(order, pc["reason_code"], pc["reason"], pc["cancelled_at"])
            await _audit(caller, "order", order["id"], "hiryu_link_cancel",
                         {"reason_code": pc["reason_code"], "pending": True})
    except Exception:
        await db.execute("UPDATE hiryu_pending_cancels SET applied_at = NULL WHERE id = %s",
                         (pc["id"],))
        raise
    return True


async def handle_cancel(grab_order_id: str, body: CancelMessage, caller: str) -> tuple[int, dict]:
    seen = await _replay(body.message_id)
    if seen:
        return seen
    at = _utc(body.cancelled_at, "cancelled_at")
    order = await db.fetch_one(
        "SELECT id, site_id, status, external_ref, hiryu_store_no FROM orders "
        "WHERE external_ref = %s", (grab_order_id,))
    if order and order["status"] == "cancelled":
        # Cancelled already (by an earlier message 2, or stopped by the WMS
        # after a missing item): keep Hiryu's reason if none was recorded.
        await db.execute(
            "UPDATE orders SET cancel_reason_code = COALESCE(cancel_reason_code, %s), "
            "cancel_reason = COALESCE(cancel_reason, %s) WHERE id = %s",
            (body.reason_code, body.reason, order["id"]))
        answer, outcome = {"order_id": order["id"], "status": "already_cancelled"}, "duplicate"
    elif order:
        await _cancel_existing(order, body.reason_code, body.reason, at)
        await _audit(caller, "order", order["id"], "hiryu_link_cancel",
                     {"reason_code": body.reason_code})
        answer, outcome = {"order_id": order["id"], "status": "cancelled"}, "cancelled"
    else:
        # Out of order (§0.6.2): kept until message 1 arrives.
        await db.execute(
            "INSERT INTO hiryu_pending_cancels (grab_order_id, message_id, reason_code, reason, "
            "cancelled_at) VALUES (%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE "
            "reason_code = COALESCE(reason_code, VALUES(reason_code)), "
            "reason = COALESCE(reason, VALUES(reason))",
            (grab_order_id, body.message_id, body.reason_code, body.reason, at))
        answer, outcome = {"order_id": None, "status": "pending"}, "pending_cancel"
        # The order may have landed between the look-up and the insert.
        if await _apply_pending_cancel(grab_order_id, caller):
            got = await db.fetch_one("SELECT id FROM orders WHERE external_ref = %s", (grab_order_id,))
            answer, outcome = {"order_id": got["id"] if got else None, "status": "cancelled"}, "cancelled"
    reason = " ".join(x for x in (body.reason_code, body.reason) if x) or None
    await _log("cancel", body.message_id, outcome, reason, grab_order_id,
               order["hiryu_store_no"] if order else None)
    await _remember(body.message_id, "cancel", 200, answer)
    return 200, answer


@router.post("/orders/{grab_order_id}/cancel", response_model=CancelAnswer)
async def post_cancel(grab_order_id: str, body: CancelMessage,
                      caller: str = Depends(outbound.hiryu_or_admin)):
    """Message 2: the customer, Grab or Hiryu cancelled. Releases the hold;
    picked units go to Kembalikan ke rak. A cancel before its order is kept."""
    if not re.fullmatch(_ORDER_ID, grab_order_id or ""):
        raise HTTPException(422, "grab_order_id tidak valid / invalid grab_order_id")
    return (await handle_cancel(grab_order_id, body, caller))[1]


# --------------------------------------------------------------------------
# Message 6: catalogue
# --------------------------------------------------------------------------

async def _site_for(dark_store: str) -> int | None:
    """The WMS hub for Hiryu's dark store: the site code itself (MAC-MA5), or the
    part after the prefix (MA5), when that names one darkstore only."""
    code = dark_store.strip().upper()
    row = await db.fetch_one("SELECT id FROM sites WHERE UPPER(code) = %s", (code,))
    if row:
        return row["id"]
    rows = await db.fetch_all(
        "SELECT id FROM sites WHERE UPPER(code) LIKE %s AND site_type = 'darkstore' LIMIT 2",
        ("%-" + code,))
    return rows[0]["id"] if len(rows) == 1 else None


async def _brand_for(code: str) -> int | None:
    """The WMS brand for Hiryu's brand: its code (KHF), else its name (Kahf)."""
    c = code.strip().upper()
    row = await db.fetch_one("SELECT id FROM brands WHERE UPPER(code) = %s", (c,))
    if not row:
        row = await db.fetch_one("SELECT id FROM brands WHERE UPPER(name) = %s", (c,))
    return row["id"] if row else None


async def _brand_by_prefix(sku_code: str) -> int | None:
    """A SKU nobody's menu mentions: its brand from the code's prefix (KHF-...),
    matched to a brand code or to the prefix of that brand's other SKUs."""
    prefix = sku_code.strip().upper().split("-")[0]
    if not prefix or prefix == sku_code.strip().upper():
        return None
    row = await db.fetch_one("SELECT id FROM brands WHERE UPPER(code) = %s", (prefix,))
    if row:
        return row["id"]
    rows = await db.fetch_all(
        "SELECT DISTINCT brand_id FROM skus WHERE UPPER(hiryu_sku_code) LIKE %s LIMIT 2",
        (prefix + "-%",))
    return rows[0]["brand_id"] if len(rows) == 1 else None


async def handle_catalogue(body: CatalogueMessage, caller: str) -> tuple[int, dict]:
    """Upsert stores, SKUs and each store's menu. What cannot be placed (an
    unknown hub or brand, a SKU with no brand, a barcode on another SKU) is
    skipped, listed in `problems` and logged for Ops HQ; the rest is taken."""
    seen = await _replay(body.message_id)
    if seen:
        return seen
    problems: list[str] = []
    today = daycolor.local_date()

    # 1. Stores -> hub and brand.
    stores_done, listed = 0, []
    for st in body.stores:
        site_id = await _site_for(st.dark_store)
        brand_id = await _brand_for(st.brand)
        if not site_id or not brand_id:
            what = []
            if not site_id:
                what.append(f"hub {st.dark_store}")
            if not brand_id:
                what.append(f"merek/brand {st.brand}")
            problems.append(f"Toko/store #{st.hiryu_store_id}: tidak dikenal / unknown " + ", ".join(what))
            continue
        await db.execute(
            "INSERT INTO hiryu_stores (hiryu_store_no, store_name, site_id, brand_id, active, "
            "updated_by) VALUES (%s,%s,%s,%s,%s,'hiryu') ON DUPLICATE KEY UPDATE "
            "store_name = VALUES(store_name), site_id = VALUES(site_id), "
            "brand_id = VALUES(brand_id), active = VALUES(active), updated_by = 'hiryu'",
            (st.hiryu_store_id, st.name[:160], site_id, brand_id,
             1 if st.status.lower() == "active" else 0))
        stores_done += 1
        listed.append(st.hiryu_store_id)
    if body.full and body.stores:
        await db.execute(
            f"UPDATE hiryu_stores SET active = 0, updated_by = 'hiryu' "
            f"WHERE hiryu_store_no NOT IN ({db.placeholders(listed or [0])})", listed or [0])

    # Each menu's store brand, known now that the stores are in.
    store_brand: dict[int, int] = {}
    for menu in body.menus:
        row = await db.fetch_one("SELECT brand_id FROM hiryu_stores WHERE hiryu_store_no = %s",
                                 (menu.hiryu_store_id,))
        if row:
            store_brand[menu.hiryu_store_id] = row["brand_id"]
    code_brands: dict[str, set] = {}
    for menu in body.menus:
        b = store_brand.get(menu.hiryu_store_id)
        for it in menu.items:
            if b and it.sku_code:
                code_brands.setdefault(it.sku_code.strip().upper(), set()).add(b)

    # 2. SKUs: update the name of a known one, create an unseen one (§2.6).
    created = updated = 0
    for s in body.skus:
        code = s.sku_code.strip().upper()
        brands = code_brands.get(code) or set()
        brand_id = next(iter(brands)) if len(brands) == 1 else None
        sku = await _sku_for_code(code, brand_id)
        if sku:
            await db.execute(
                "UPDATE skus SET name_display = %s, "
                "hiryu_sku_code = COALESCE(NULLIF(hiryu_sku_code, ''), %s) WHERE id = %s",
                (s.name[:255], code, sku["id"]))
            sku_id = sku["id"]
            updated += 1
        else:
            if brand_id is None:
                brand_id = await _brand_by_prefix(code)
            if brand_id is None:
                problems.append(f"SKU {code}: merek tidak diketahui / brand unknown")
                continue
            if await db.fetch_one("SELECT id FROM skus WHERE brand_id = %s AND UPPER(brand_sku_code) = %s",
                                  (brand_id, code)):
                problems.append(f"SKU {code}: kode sudah dipakai SKU lain / code already used by another SKU")
                continue
            brand = await db.fetch_one("SELECT identity_mode FROM brands WHERE id = %s", (brand_id,))
            sku_id = await db.execute(
                "INSERT INTO skus (brand_id, brand_sku_code, name_display, identity_mode, "
                "hiryu_sku_code, hiryu_created_at) VALUES (%s,%s,%s,%s,%s,UTC_TIMESTAMP())",
                (brand_id, code, s.name[:255],
                 (brand or {}).get("identity_mode") or "sku_barcode", code))
            created += 1
        # Barcodes: one barcode belongs to one SKU, ever (§2.8).
        for bc in s.barcodes:
            bc = bc.strip()
            if not bc or len(bc) > 64 or not bc.isalnum():
                problems.append(f"SKU {code}: barcode tidak valid / invalid barcode")
                continue
            owner = await db.fetch_one("SELECT sku_id FROM barcodes WHERE barcode = %s", (bc,))
            if not owner:
                await db.execute(
                    "INSERT IGNORE INTO barcodes (barcode, sku_id, source, registered_by) "
                    "VALUES (%s,%s,'hiryu','hiryu')", (bc, sku_id))
            elif owner["sku_id"] != sku_id:
                problems.append(f"SKU {code}: barcode {bc} milik SKU lain / belongs to another SKU")

    # 3. Menus: each store's items, their SKU, units per sale and price (§2.12).
    items = 0
    for menu in body.menus:
        brand_id = store_brand.get(menu.hiryu_store_id)
        if brand_id is None:
            problems.append(f"Menu toko/store #{menu.hiryu_store_id}: toko tidak dikenal / unknown store")
            continue
        seen_ids = []
        for it in menu.items:
            sku_id = None
            if it.sku_code:
                sku = await _sku_for_code(it.sku_code, brand_id)
                if sku:
                    sku_id = sku["id"]
                else:
                    problems.append(f"#{menu.hiryu_store_id} {it.item_id}: kode SKU {it.sku_code.upper()} "
                                    "tidak dikenal / unknown SKU code")
            await db.execute(
                "INSERT INTO hiryu_items (hiryu_store_no, hiryu_item_id, brand_id, item_name, sku_id, "
                "units_per_sale, price_idr, available_status, active, imported_at, mapped_by, mapped_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,UTC_TIMESTAMP(),'hiryu',UTC_TIMESTAMP()) "
                "ON DUPLICATE KEY UPDATE brand_id = VALUES(brand_id), item_name = VALUES(item_name), "
                "sku_id = VALUES(sku_id), units_per_sale = VALUES(units_per_sale), "
                "price_idr = VALUES(price_idr), available_status = VALUES(available_status), "
                "active = 1, imported_at = VALUES(imported_at), mapped_by = 'hiryu', "
                "mapped_at = VALUES(mapped_at)",
                (menu.hiryu_store_id, it.item_id, brand_id, it.name[:255], sku_id, it.units_per_sale,
                 it.price, "AVAILABLE" if it.available else "UNAVAILABLE"))
            if it.price is not None:
                await db.execute(
                    "INSERT INTO hiryu_item_prices (hiryu_store_no, hiryu_item_id, price_idr, "
                    "effective_date) VALUES (%s,%s,%s,%s) "
                    "ON DUPLICATE KEY UPDATE price_idr = VALUES(price_idr)",
                    (menu.hiryu_store_id, it.item_id, it.price, today))
            seen_ids.append(it.item_id)
            items += 1
        if body.full:
            await db.execute(
                f"UPDATE hiryu_items SET active = 0 WHERE hiryu_store_no = %s "
                f"AND hiryu_item_id NOT IN ({db.placeholders(seen_ids or [''])})",
                [menu.hiryu_store_id, *(seen_ids or [""])])
    if body.full and body.menus:
        # A store with no menu in a full list sells nothing.
        stores_in = [m.hiryu_store_id for m in body.menus]
        await db.execute(
            f"UPDATE hiryu_items SET active = 0 WHERE hiryu_store_no > 0 "
            f"AND hiryu_store_no NOT IN ({db.placeholders(stores_in)})", stores_in)

    answer = {"stores": stores_done, "skus_created": created, "skus_updated": updated,
              "items": items, "problems": problems[:200]}
    summary = f"{stores_done} toko, {created} SKU baru, {updated} SKU diperbarui, {items} barang"
    await _log("catalogue", body.message_id, "partial" if problems else "accepted",
               summary + (f"; {len(problems)} masalah / problems" if problems else ""))
    for p in problems[:50]:
        await _log("catalogue", body.message_id, "problem", p)
    if created or problems:
        await _audit(caller, "hiryu_catalogue", None, "catalogue",
                     {"full": body.full, "skus_created": created, "problems": len(problems)})
    await _remember(body.message_id, "catalogue", 200, answer)
    return 200, answer


@router.post("/catalogue", response_model=CatalogueAnswer)
async def post_catalogue(body: CatalogueMessage, caller: str = Depends(outbound.hiryu_or_admin)):
    """Message 6: stores, SKUs and menus, sent by Hiryu when any of them change."""
    return (await handle_catalogue(body, caller))[1]


@router.get("/ping", response_model=Ping)
async def ping(caller: str = Depends(outbound.hiryu_or_admin)):
    """Answers {"ok": true} when the secret is right."""
    return {"ok": True}


# ==========================================================================
# The console side: /api/hiryu-link (behind Google sign-in)
# ==========================================================================

class LinkLane(BaseModel):
    message_type: str
    contract_type: str
    pending: int = 0
    sending: int = 0
    failed: int = 0
    suppressed: int = 0
    sent: int = 0
    oldest_pending_seconds: int | None = None
    last_sent_at: str | None = None


class LinkFailure(BaseModel):
    id: int
    message_type: str
    site_id: int | None
    order_ref: str | None
    attempts: int
    last_error: str | None
    created_at: str | None


class InboundRow(BaseModel):
    id: int
    message_type: str
    message_id: str | None
    grab_order_id: str | None
    hiryu_store_no: int | None
    outcome: str
    detail: str | None
    received_at: str


class LinkStatus(BaseModel):
    live: bool = Field(description="Sambungan Hiryu aktif (Ops HQ switch)")
    push_enabled: bool = Field(description="POS_PUSH_ENABLED")
    webhook_configured: bool
    secret_configured: bool
    sending: bool = Field(description="All four on: messages 3 to 5 are being delivered")
    wait_alert_minutes: int
    lanes: list[LinkLane]
    oldest_pending_seconds: int | None
    last_sent_at: str | None
    failures: list[LinkFailure]
    refused_24h: int
    inbound: list[InboundRow]


class LiveIn(BaseModel):
    live: bool


class CountAnswer(BaseModel):
    ok: bool
    count: int
    message: str


class TestCancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    grab_order_id: str = Field(pattern=_ORDER_ID)
    message_id: str = Field(pattern=_MSG_ID)
    reason_code: str | None = Field(default="2001", pattern=r"^[A-Za-z0-9_-]{1,16}$")
    reason: str | None = Field(default="Item out of stock", pattern=r"^[A-Za-z0-9 .,:;()'/&_-]{1,160}$")


class TestAnswer(BaseModel):
    http_status: int
    answer: dict


class LinkStore(BaseModel):
    hiryu_store_no: int
    store_name: str
    site_id: int
    site_code: str
    brand_id: int
    brand_name: str
    active: bool
    updated_by: str | None
    items: int
    unconnected: int


class LinkItem(BaseModel):
    id: int
    hiryu_store_no: int
    hiryu_item_id: str
    item_name: str | None
    sku_id: int | None
    sku_code: str | None
    sku_name: str | None
    sku_new: bool
    units_per_sale: int
    price_idr: int | None
    available_status: str | None
    active: bool


class LinkCatalogue(BaseModel):
    live: bool
    stores: list[LinkStore]
    items: list[LinkItem]


def _ago(ts) -> int | None:
    if not ts:
        return None
    return max(0, int((datetime.now(timezone.utc).replace(tzinfo=None) - ts).total_seconds()))


@ui_router.get("/status", response_model=LinkStatus)
async def status(site_id: int | None = None,
                 user: auth.User = Depends(auth.require("supervisor"))):
    """Is the pipe working? (§9.3) The SPV checks it at opening: last message
    sent, 0 waiting, 0 failed, and anything waiting more than 5 minutes red."""
    where, params = "", []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where, params = " AND site_id = %s", [site_id]
    rows = await db.fetch_all(
        "SELECT message_type, status, COUNT(*) AS n, MIN(created_at) AS oldest, "
        "       MAX(sent_at) AS last_sent FROM pos_outbox WHERE 1=1" + where +
        " GROUP BY message_type, status", params)
    lanes: dict[str, dict] = {t: {"message_type": t, "contract_type": c}
                              for t, c in pos_sender.CONTRACT_TYPE.items()}
    for r in rows:
        lane = lanes.setdefault(r["message_type"], {"message_type": r["message_type"],
                                                    "contract_type": r["message_type"]})
        st = r["status"] if r["status"] in ("pending", "sending", "failed", "suppressed", "sent") else "pending"
        lane[st] = lane.get(st, 0) + int(r["n"])
        if st in ("pending", "sending") and r["oldest"]:
            age = _ago(r["oldest"])
            lane["oldest_pending_seconds"] = max(lane.get("oldest_pending_seconds") or 0, age)
        if st == "sent" and r["last_sent"]:
            lane["last_sent_at"] = str(r["last_sent"])
    lane_list = list(lanes.values())
    ages = [l.get("oldest_pending_seconds") for l in lane_list if l.get("oldest_pending_seconds") is not None]
    sent = [l.get("last_sent_at") for l in lane_list if l.get("last_sent_at")]
    fails = await db.fetch_all(
        "SELECT id, message_type, site_id, order_ref, attempts, last_error, created_at "
        "FROM pos_outbox WHERE status = 'failed'" + where + " ORDER BY id DESC LIMIT 20", params)
    inbound = await db.fetch_all(
        "SELECT id, message_type, message_id, grab_order_id, hiryu_store_no, outcome, detail, "
        "received_at FROM hiryu_inbound_log ORDER BY id DESC LIMIT 40")
    refused = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM hiryu_inbound_log WHERE outcome IN ('refused','problem') "
        "AND received_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY")
    live = await pos_sender.link_live()
    return {
        "live": live, "push_enabled": pos_sender.push_enabled(),
        "webhook_configured": bool(pos_sender.webhook_url()),
        "secret_configured": bool(pos_sender.shared_secret()),
        "sending": await pos_sender.sending_on(),
        "wait_alert_minutes": await pos_sender.rule("link_wait_alert_minutes", 5) or 5,
        "lanes": lane_list,
        "oldest_pending_seconds": max(ages) if ages else None,
        "last_sent_at": max(sent) if sent else None,
        "failures": [{**f, "created_at": str(f["created_at"]) if f["created_at"] else None}
                     for f in fails],
        "refused_24h": int(refused["n"]) if refused else 0,
        "inbound": [{**r, "received_at": str(r["received_at"])} for r in inbound],
    }


@ui_router.post("/live", response_model=models.Ok)
async def set_live(body: LiveIn, user: auth.User = Depends(auth.require("hq"))):
    """Sambungan Hiryu aktif. On: orders come only from message 1, the paste
    screen and the stock sheet are off, and a full stock snapshot is queued so
    Hiryu starts from the WMS number (§0.6.4 item 6). Off: back to paste and
    typing, and nothing is sent."""
    await db.execute(
        "INSERT INTO alert_rules (rule_key, enabled, value_num, updated_by) "
        "VALUES ('hiryu_link_live', 1, %s, %s) ON DUPLICATE KEY UPDATE "
        "value_num = VALUES(value_num), updated_by = VALUES(updated_by)",
        (1 if body.live else 0, user.email))
    queued = await pos_sender.queue_full_snapshot() if body.live else 0
    await _audit(user.email, "hiryu_link", None, "live_on" if body.live else "live_off",
                 {"live": body.live, "snapshot_rows": queued})
    if body.live:
        return {"ok": True, "message": f"Sambungan aktif. Snapshot stok penuh diantrekan ({queued} baris). / "
                                       f"Link on. Full stock snapshot queued ({queued} rows)."}
    return {"ok": True, "message": "Sambungan mati: pesanan lewat tempel, stok diketik. / "
                                   "Link off: orders by paste, stock typed."}


@ui_router.post("/snapshot", response_model=CountAnswer)
async def snapshot(user: auth.User = Depends(auth.require("hq"))):
    """Kirim snapshot penuh: every SKU of every store, worked out at send time."""
    n = await pos_sender.queue_full_snapshot()
    await _audit(user.email, "hiryu_link", None, "snapshot", {"rows": n})
    return {"ok": True, "count": n,
            "message": f"{n} baris stok diantrekan. / {n} stock rows queued."}


@ui_router.post("/retry-failed", response_model=CountAnswer)
async def retry_failed(site_id: int | None = None, user: auth.User = Depends(auth.require("hq"))):
    """Coba lagi yang gagal: failed rows go back to the queue, from the first wait."""
    where, params = "", []
    if site_id:
        where, params = " AND site_id = %s", [site_id]
    n = await db.execute(
        "UPDATE pos_outbox SET status = 'pending', attempts = 0, next_attempt_at = NULL, "
        "last_error = NULL, claimed_at = NULL WHERE status = 'failed'" + where, params)
    await _audit(user.email, "hiryu_link", None, "retry_failed", {"rows": n, "site_id": site_id})
    return {"ok": True, "count": n,
            "message": f"{n} pesan dicoba lagi. / {n} messages retried."}


@ui_router.post("/test-order", response_model=TestAnswer)
async def test_order(body: OrderMessage, user: auth.User = Depends(auth.require("hq"))):
    """The simulator's message 1, through the same handler Hiryu's call runs.
    The order is marked as a test order."""
    code, answer = await handle_order(body, user.email, is_test=True)
    return {"http_status": code, "answer": answer}


@ui_router.post("/test-cancel", response_model=TestAnswer)
async def test_cancel(body: TestCancelIn, user: auth.User = Depends(auth.require("hq"))):
    """The simulator's message 2, through the same handler."""
    msg = CancelMessage(message_id=body.message_id, reason_code=body.reason_code,
                        reason=body.reason, cancelled_at=_iso(datetime.now(timezone.utc)
                                                              .replace(tzinfo=None)))
    code, answer = await handle_cancel(body.grab_order_id, msg, user.email)
    return {"http_status": code, "answer": answer}


@ui_router.get("/catalogue", response_model=LinkCatalogue)
async def catalogue(store_no: int | None = None, user: auth.User = Depends(auth.require("hq"))):
    """What Hiryu sent (§2.2.5): the stores, and one store's menu items with
    their SKU, units per sale and price. Items without a SKU come first."""
    stores = await db.fetch_all(
        "SELECT hs.hiryu_store_no, hs.store_name, hs.site_id, s.code AS site_code, hs.brand_id, "
        "       b.name AS brand_name, hs.active, hs.updated_by, "
        "       (SELECT COUNT(*) FROM hiryu_items hi WHERE hi.hiryu_store_no = hs.hiryu_store_no "
        "          AND hi.active = 1) AS items, "
        "       (SELECT COUNT(*) FROM hiryu_items hi WHERE hi.hiryu_store_no = hs.hiryu_store_no "
        "          AND hi.active = 1 AND hi.sku_id IS NULL) AS unconnected "
        "FROM hiryu_stores hs JOIN sites s ON s.id = hs.site_id JOIN brands b ON b.id = hs.brand_id "
        "ORDER BY hs.active DESC, s.code, b.name, hs.hiryu_store_no")
    items = []
    if store_no:
        items = await db.fetch_all(
            "SELECT hi.id, hi.hiryu_store_no, hi.hiryu_item_id, hi.item_name, hi.sku_id, "
            "       COALESCE(k.hiryu_sku_code, k.brand_sku_code) AS sku_code, "
            "       k.name_display AS sku_name, k.hiryu_created_at, hi.units_per_sale, "
            "       hi.price_idr, hi.available_status, hi.active "
            "FROM hiryu_items hi LEFT JOIN skus k ON k.id = hi.sku_id "
            "WHERE hi.hiryu_store_no = %s "
            "ORDER BY hi.active DESC, hi.sku_id IS NOT NULL, hi.item_name LIMIT 3000", (store_no,))
    week_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    return {
        "live": await pos_sender.link_live(),
        "stores": [{**s, "active": bool(s["active"]), "items": int(s["items"] or 0),
                    "unconnected": int(s["unconnected"] or 0)} for s in stores],
        "items": [{
            "id": i["id"], "hiryu_store_no": i["hiryu_store_no"],
            "hiryu_item_id": i["hiryu_item_id"], "item_name": i["item_name"],
            "sku_id": i["sku_id"], "sku_code": (i["sku_code"] or "").upper() or None,
            "sku_name": i["sku_name"],
            "sku_new": bool(i["hiryu_created_at"] and i["hiryu_created_at"] >= week_ago),
            "units_per_sale": int(i["units_per_sale"] or 1),
            "price_idr": int(i["price_idr"]) if i["price_idr"] is not None else None,
            "available_status": i["available_status"], "active": bool(i["active"]),
        } for i in items],
    }
