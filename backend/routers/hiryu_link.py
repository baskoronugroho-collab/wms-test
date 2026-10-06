"""The Hiryu link, WMS side (PRD §0.6, §2.12, §6.6, §9.4; docs/hiryu-link-v1.md v1.1).

Two routers live here:

  `router`     /api/hiryu/v1   what Hiryu calls: message 1 (order to pick),
                               message 2 (order cancelled), message 6
                               (catalogue) and a ping. Opened as a public path
                               on Substrait (no Google sign-in) and protected by
                               the shared secret in X-Hiryu-Key only.
  `ui_router`  /api/hiryu-link what the app calls, behind Google sign-in: the
                               link's status, the Ops HQ switch, snapshots,
                               retrying failures, the stores and menus Hiryu
                               sent (Menu & toko Hiryu), a new store's brand and
                               Grab merchant account, each store's link (H8),
                               Sinkron ulang dari Hiryu, the Pesan Hiryu log,
                               and test messages for the simulator.

The test endpoints, and the demo ones in routers/demo.py, exist because the SSO
proxy strips X-Forwarded-Email on a public path: once /api/hiryu/v1 is public, a
signed-in browser cannot reach it. They run the very same handler functions, so
a test or a demo order is a test of what Hiryu will hit.

Hiryu first (PRD §2.12): Hiryu owns the order, the customer and the catalogue.
The WMS takes only the fields the contract names; every model here refuses any
other field (extra="forbid") and every text field has a strict pattern, so no
customer name, phone, address, note or payment can ride along (§6.6.1).

Every message in is kept with its exact JSON and the answer in the Pesan Hiryu
log (pos_sender.log_message); the sender does the same for every message out.
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
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
_TEXT = r"^[^<>{}\\\r\n\t]{1,255}$"   # a product, store or address: one plain line
_HHMM = r"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"

REASONS = {"2001": "Item out of stock", "2002": "Store closed", "2003": "Too busy",
           "2004": "Customer requested"}


# --------------------------------------------------------------------------
# Message models (the contract, strictly)
# --------------------------------------------------------------------------

class OosInstruction(BaseModel):
    """The customer's out-of-stock choice for one line (H9)."""
    model_config = ConfigDict(extra="forbid")
    type: Literal["replace", "remove", "cancel_order", "contact_customer"]
    replace_hiryu_item_id: str | None = Field(default=None, pattern=_ITEM_ID)
    replace_sku_code: str | None = Field(default=None, pattern=_SKU_CODE)
    replace_units: int | None = Field(default=None, ge=1, le=999)


class OrderLineMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_item_id: str = Field(pattern=_ITEM_ID)
    item_qty: int = Field(ge=1, le=999)
    sku_code: str = Field(pattern=_SKU_CODE, description="Hiryu SKU code, compared ignoring capitals")
    units: int = Field(ge=1, le=999, description="Item quantity x units per sale, worked out by Hiryu")
    item_price: int | None = Field(default=None, ge=0, le=100_000_000,
                                   description="The item's menu price that day, rupiah")
    oos_instruction: OosInstruction | None = Field(
        ..., description="Required, may be null; null is treated as cancel_order")


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
    """Message 2. The reason is Grab's code, never the customer's words."""
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(pattern=_MSG_ID)
    reason_code: str | None = Field(..., pattern=r"^200[1-4]$",
                                    description="2001 to 2004; required, may be null")
    reason: str | None = Field(default=None, pattern=r"^[A-Za-z0-9 .,:;()'/&_-]{1,160}$")
    cancelled_by: Literal["customer", "grab", "merchant"]
    cancelled_at: str = Field(max_length=40, description="ISO 8601 with a zone")


class OpeningPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")
    open: str = Field(pattern=_HHMM)
    close: str = Field(pattern=_HHMM)


class OpeningHours(BaseModel):
    """One list per weekday, WIB, 24 h; [] = closed that day."""
    model_config = ConfigDict(extra="forbid")
    mon: list[OpeningPeriod] = Field(max_length=6)
    tue: list[OpeningPeriod] = Field(max_length=6)
    wed: list[OpeningPeriod] = Field(max_length=6)
    thu: list[OpeningPeriod] = Field(max_length=6)
    fri: list[OpeningPeriod] = Field(max_length=6)
    sat: list[OpeningPeriod] = Field(max_length=6)
    sun: list[OpeningPeriod] = Field(max_length=6)


class CatalogueDarkStore(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_dark_store_id: int = Field(ge=1, le=99_999_999)
    name: str = Field(pattern=_TEXT, max_length=160)
    address: str = Field(pattern=_TEXT, max_length=255)
    opening_hours: OpeningHours


class CatalogueStore(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_store_id: int = Field(ge=1, le=99_999_999)
    name: str = Field(pattern=_TEXT, max_length=160)
    hiryu_dark_store_id: int = Field(ge=1, le=99_999_999)
    status: str = Field(pattern=r"^(?i:active|inactive)$")
    order_acceptance: str | None = Field(default=None, pattern=r"^[A-Za-z_]{1,16}$")


class CatalogueSku(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sku_code: str = Field(pattern=_SKU_CODE)
    name: str = Field(pattern=_TEXT)
    barcodes: list[str] = Field(default_factory=list, max_length=10)


class CatalogueItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(pattern=_ITEM_ID)
    name: str = Field(pattern=_TEXT)
    sku_code: str | None = Field(..., pattern=_SKU_CODE,
                                 description="Required, may be null: not linked in Bundles yet")
    units_per_sale: int = Field(ge=1, le=99)
    price: int | None = Field(default=None, ge=0, le=100_000_000)
    available: bool


class CatalogueMenu(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_store_id: int = Field(ge=1, le=99_999_999)
    items: list[CatalogueItem] = Field(max_length=3000)


class CatalogueMessage(BaseModel):
    """Message 6: dark stores, stores, SKUs and each store's menu; `full` = the
    whole list; `request_id` answers a Sinkron ulang."""
    model_config = ConfigDict(extra="forbid")
    message_id: str = Field(pattern=_MSG_ID)
    full: bool
    request_id: str | None = Field(default=None, pattern=_MSG_ID)
    dark_stores: list[CatalogueDarkStore] = Field(default_factory=list, max_length=500)
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


def _iso(ts: datetime | None) -> str | None:
    if ts is None:
        return None
    return ts.replace(microsecond=0).isoformat() + "Z"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    """The short trail on Integrasi Hiryu and what flags Ops HQ: outcome
    'refused' (a message refused) or 'problem' (taken, but something in it
    could not be used) shows on Perlu tindakan; 'warning' does not."""
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


def _dump(body: BaseModel) -> dict:
    return body.model_dump(mode="json", exclude_unset=False)


async def _log_in(*, mtype: str, no: int, h: str, body: dict, message_id: str, via: str,
                  status: str, code: int, answer: dict, site_id: int | None,
                  grab_order_id: str | None, trigger: tuple[str, str]) -> None:
    await pos_sender.log_message(
        direction="in", message_type=mtype, message_id=message_id, via=via, status=status,
        body=body, answer=answer, http_status=code, message_no=no, h_ref=h, site_id=site_id,
        grab_order_id=grab_order_id, trigger=trigger)


# --------------------------------------------------------------------------
# Message 1: order to pick
# --------------------------------------------------------------------------

def _oos_plan(line: OrderLineMessage, rep_sku_id: int | None) -> tuple[str | None, str, str | None]:
    """(instruction type as sent, what the floor does, problem). The floor does
    replace, remove or cancel_order; no instruction and contact_customer are
    cancel_order in the pilot; a replacement the WMS cannot use is cancel_order
    and Ops HQ is flagged."""
    ins = line.oos_instruction
    if ins is None:
        return None, "cancel_order", None
    if ins.type == "remove":
        return ins.type, "remove", None
    if ins.type in ("cancel_order", "contact_customer"):
        return ins.type, "cancel_order", None
    if not (ins.replace_hiryu_item_id and ins.replace_sku_code and ins.replace_units):
        return ins.type, "cancel_order", ("Instruksi ganti tidak lengkap / "
                                          "Replace instruction incomplete")
    if rep_sku_id is None:
        code = ins.replace_sku_code.upper()
        return ins.type, "cancel_order", (f"Kode SKU pengganti {code} tidak dikenal / "
                                          f"Unknown replacement SKU code {code}")
    return ins.type, "replace", None


async def _line_ids(order_id: int, result: dict, wanted: list[tuple[int, int]]) -> list[int | None]:
    """The order line created for each message line, in message order.
    receive_order returns `line_ids` when it can; otherwise the lines are
    matched by SKU and units, in the order they were written."""
    ids = result.get("line_ids")
    if isinstance(ids, list) and len(ids) == len(wanted):
        return ids
    rows = await db.fetch_all(
        "SELECT id, sku_id, qty_ordered FROM order_lines WHERE order_id = %s ORDER BY id",
        (order_id,))
    used: set[int] = set()
    out: list[int | None] = []
    for sku_id, units in wanted:
        pick = next((r for r in rows if r["id"] not in used and r["sku_id"] == sku_id
                     and int(r["qty_ordered"]) == units), None)
        if pick is None:
            pick = next((r for r in rows if r["id"] not in used and r["sku_id"] == sku_id), None)
        if pick is not None:
            used.add(pick["id"])
        out.append(pick["id"] if pick else None)
    return out


async def _handle_order(body: OrderMessage, caller: str, is_test: bool,
                        is_demo: bool) -> tuple[int, dict, int | None]:
    gid = body.grab_order_id
    store = await db.fetch_one(
        "SELECT hs.hiryu_store_no, hs.site_id, hs.brand_id, hs.active, hs.hiryu_active "
        "FROM hiryu_stores hs JOIN sites s ON s.id = hs.site_id WHERE hs.hiryu_store_no = %s",
        (body.hiryu_store_id,))
    if not store or not store["active"]:
        if store and store["brand_id"] is None and store["hiryu_active"]:
            msg = (f"Toko Hiryu #{body.hiryu_store_id} menunggu Ops HQ memilih merek dan akun "
                   f"merchant Grab. / Hiryu store #{body.hiryu_store_id} is waiting for Ops HQ "
                   "to pick its brand and Grab merchant account.")
        else:
            msg = (f"Toko Hiryu #{body.hiryu_store_id} tidak dikenal atau tidak aktif. Ops HQ "
                   f"sudah diberi tahu. / Hiryu store #{body.hiryu_store_id} is unknown or "
                   "inactive. Ops HQ has been flagged.")
        await _log("order", body.message_id, "refused", msg, gid, body.hiryu_store_id)
        raise HTTPException(422, msg)

    existing = await db.fetch_one("SELECT id FROM orders WHERE external_ref = %s", (gid,))
    if existing:
        answer = {"order_id": existing["id"], "status": "duplicate"}
        await _log("order", body.message_id, "duplicate", None, gid, body.hiryu_store_id)
        await _remember(body.message_id, "order", 200, answer)
        return 200, answer, store["site_id"]

    # SKU codes -> WMS SKUs, within the store's brand. Every Hiryu line stays
    # its own order line (contract v1.1): its own item, quantity, price and
    # out-of-stock instruction, even when two lines share a SKU.
    resolved: dict[str, int] = {}
    unknown: list[str] = []
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

    # The replacement the customer chose. A code the WMS does not know does not
    # refuse the order: the line becomes cancel_order and Ops HQ is flagged.
    plans = []
    for line in body.lines:
        ins = line.oos_instruction
        rep_id = None
        if ins and ins.type == "replace" and ins.replace_sku_code:
            rep = await _sku_for_code(ins.replace_sku_code, store["brand_id"])
            rep_id = rep["id"] if rep else None
        plans.append((rep_id, *_oos_plan(line, rep_id)))

    # Ready-by (§9.2, decided 5 Oct): the 10 minutes start at Grab's order
    # time; a scheduled order is due its lead before the scheduled time. Grab's
    # estimate is kept for reference only.
    placed = _utc(body.order_time, "order_time")
    scheduled = _utc(body.scheduled_time, "scheduled_time")
    estimated = _utc(body.estimated_ready_time, "estimated_ready_time")
    if scheduled:
        promised = scheduled - timedelta(minutes=await pos_sender.rule("scheduled_lead_minutes", 20))
    else:
        promised = placed + timedelta(minutes=await pos_sender.rule("grab_ready_minutes", 10))

    wanted = [(resolved[l.sku_code.strip().upper()], l.units) for l in body.lines]
    order_in = models.OrderIn(
        external_ref=gid, site_id=store["site_id"],
        lines=[models.OrderLineIn(sku_id=sid, quantity=units) for sid, units in wanted],
        channel="grab", delivery_mode="grab_rider", is_test=is_test,
        placed_at=_iso(placed), promised_at=_iso(promised),
        # Carried in, not written after: receive_order assigns a picker at once,
        # and a scheduled order must wait in its lane until it is due.
        scheduled_at=_iso(scheduled) if scheduled else None,
    )
    try:
        # The GM number, store and source go in with the order, before it is
        # given to a picker.
        result = await outbound.receive_order(order_in, source="link", short_no=body.gm_number,
                                              store_no=body.hiryu_store_id)
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
        return 200, answer, store["site_id"]

    order_id = result["order_id"]
    await db.execute(
        "UPDATE orders SET hiryu_short_no = %s, hiryu_store_no = %s, source = 'link', "
        "acceptance = 'MANUAL', scheduled_at = %s, estimated_ready_at = %s, is_demo = %s "
        "WHERE id = %s",
        (body.gm_number, body.hiryu_store_id, scheduled, estimated, 1 if is_demo else 0,
         order_id))
    ids = await _line_ids(order_id, result, wanted)
    problems = []
    for line, line_id, (rep_id, oos_type, action, problem) in zip(body.lines, ids, plans):
        if line_id is None:
            continue
        ins = line.oos_instruction
        await db.execute(
            "UPDATE order_lines SET hiryu_item_id = %s, item_qty = %s, item_price_idr = %s, "
            "hiryu_sku_code = %s, oos_type = %s, oos_replace_hiryu_item_id = %s, "
            "oos_replace_sku_code = %s, oos_replace_sku_id = %s, oos_replace_units = %s, "
            "oos_effective = %s, oos_problem = %s WHERE id = %s",
            (line.hiryu_item_id, line.item_qty, line.item_price, line.sku_code.strip().upper(),
             oos_type, ins.replace_hiryu_item_id if ins else None,
             (ins.replace_sku_code or "").upper() or None if ins else None,
             rep_id, ins.replace_units if ins else None, action,
             problem[:160] if problem else None, line_id))
        if problem:
            problems.append(f"{body.gm_number} {line.hiryu_item_id}: {problem}")
    for p in problems:
        await _log("order", body.message_id, "problem", p, gid, body.hiryu_store_id)
    await _audit(caller, "order", order_id, "hiryu_link_order",
                 {"grab_order_id": gid, "gm_number": body.gm_number,
                  "hiryu_store_id": body.hiryu_store_id, "test": is_test, "demo": is_demo})

    # A cancel that arrived first is applied now (§0.6.2).
    applied = await _apply_pending_cancel(gid, caller)
    short = int(result.get("short_lines") or 0)
    detail = ("dibatalkan: pembatalan datang lebih dulu / cancelled: the cancel came first"
              if applied else (f"{short} baris kurang stok / {short} line(s) short" if short else None))
    await _log("order", body.message_id, "accepted", detail, gid, body.hiryu_store_id)
    answer = {"order_id": order_id, "status": "accepted"}
    await _remember(body.message_id, "order", 201, answer)
    return 201, answer, store["site_id"]


async def handle_order(body: OrderMessage, caller: str, *, is_test: bool = False,
                       via: str = "hiryu", trigger: tuple[str, str] | None = None
                       ) -> tuple[int, dict]:
    """Create the order and its pick, or answer that it exists. Returns
    (HTTP status, answer). A refusal raises 422 after logging it for Ops HQ.
    `via` is hiryu (Hiryu's call), demo (Buat pesanan dummy) or test (the
    simulator); only the log and the order's demo mark differ."""
    h = "H1 H9" if any(l.oos_instruction is not None for l in body.lines) else "H1"
    trigger = trigger or ("Staf menekan Terima di Hiryu", "Staff pressed Accept in Hiryu")
    common = dict(mtype="order", no=1, h=h, body=_dump(body), message_id=body.message_id,
                  via=via, grab_order_id=body.grab_order_id, trigger=trigger)
    seen = await _replay(body.message_id)
    if seen:
        await _log_in(**common, status=str(seen[1].get("status") or "taken"), code=seen[0],
                      answer=seen[1], site_id=None)
        return seen
    store_site = await db.fetch_one("SELECT site_id FROM hiryu_stores WHERE hiryu_store_no = %s",
                                    (body.hiryu_store_id,))
    try:
        code, answer, site_id = await _handle_order(body, caller, is_test, via == "demo")
    except HTTPException as e:
        await _log_in(**common, status="refused", code=e.status_code, answer={"detail": e.detail},
                      site_id=store_site["site_id"] if store_site else None)
        raise
    await _log_in(**common, status=answer["status"], code=code, answer=answer, site_id=site_id)
    return code, answer


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
                           cancelled_by: str | None, cancelled_at: datetime | None) -> None:
    await outbound.cancel_order(order["external_ref"], site_id=order["site_id"], actor="hiryu",
                                reason=" ".join(x for x in (reason_code, reason) if x) or "hiryu_cancel")
    await db.execute(
        "UPDATE orders SET cancelled_by = 'hiryu', cancelled_at = COALESCE(%s, UTC_TIMESTAMP()), "
        "cancel_reason_code = %s, cancel_reason = %s, hiryu_cancelled_by = %s WHERE id = %s",
        (cancelled_at, reason_code, reason, cancelled_by, order["id"]))


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
            await _cancel_existing(order, pc["reason_code"], pc["reason"], pc.get("cancelled_by"),
                                   pc["cancelled_at"])
            await _audit(caller, "order", order["id"], "hiryu_link_cancel",
                         {"reason_code": pc["reason_code"], "cancelled_by": pc.get("cancelled_by"),
                          "pending": True})
    except Exception:
        await db.execute("UPDATE hiryu_pending_cancels SET applied_at = NULL WHERE id = %s",
                         (pc["id"],))
        raise
    return True


async def _handle_cancel(grab_order_id: str, body: CancelMessage, caller: str,
                         at: datetime | None) -> tuple[int, dict, dict | None]:
    order = await db.fetch_one(
        "SELECT id, site_id, status, external_ref, hiryu_store_no FROM orders "
        "WHERE external_ref = %s", (grab_order_id,))
    reason = body.reason or (REASONS.get(body.reason_code) if body.reason_code else None)
    if order and order["status"] == "cancelled":
        # Cancelled already (by an earlier message 2, or stopped by the WMS
        # after a missing item): keep Hiryu's reason and who cancelled.
        await db.execute(
            "UPDATE orders SET cancel_reason_code = COALESCE(cancel_reason_code, %s), "
            "cancel_reason = COALESCE(cancel_reason, %s), "
            "hiryu_cancelled_by = COALESCE(hiryu_cancelled_by, %s) WHERE id = %s",
            (body.reason_code, reason, body.cancelled_by, order["id"]))
        answer, outcome = {"order_id": order["id"], "status": "already_cancelled"}, "duplicate"
    elif order:
        await _cancel_existing(order, body.reason_code, reason, body.cancelled_by, at)
        await _audit(caller, "order", order["id"], "hiryu_link_cancel",
                     {"reason_code": body.reason_code, "cancelled_by": body.cancelled_by})
        answer, outcome = {"order_id": order["id"], "status": "cancelled"}, "cancelled"
    else:
        # Out of order (§0.6.2): kept until message 1 arrives.
        await db.execute(
            "INSERT INTO hiryu_pending_cancels (grab_order_id, message_id, reason_code, reason, "
            "cancelled_at, cancelled_by) VALUES (%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE "
            "reason_code = COALESCE(reason_code, VALUES(reason_code)), "
            "reason = COALESCE(reason, VALUES(reason)), "
            "cancelled_by = COALESCE(cancelled_by, VALUES(cancelled_by))",
            (grab_order_id, body.message_id, body.reason_code, reason, at, body.cancelled_by))
        answer, outcome = {"order_id": None, "status": "pending"}, "pending_cancel"
        # The order may have landed between the look-up and the insert.
        if await _apply_pending_cancel(grab_order_id, caller):
            got = await db.fetch_one("SELECT id, site_id FROM orders WHERE external_ref = %s",
                                     (grab_order_id,))
            order = got
            answer, outcome = {"order_id": got["id"] if got else None, "status": "cancelled"}, "cancelled"
    words = " ".join(x for x in (body.reason_code, reason, f"({body.cancelled_by})") if x)
    await _log("cancel", body.message_id, outcome, words, grab_order_id,
               order.get("hiryu_store_no") if order else None)
    await _remember(body.message_id, "cancel", 200, answer)
    return 200, answer, order


_CANCEL_WORDS = {
    "customer": ("Pelanggan membatalkan di Grab", "The customer cancelled on Grab"),
    "grab": ("Grab membatalkan pesanan", "Grab cancelled the order"),
    "merchant": ("Merchant membatalkan di Hiryu", "The merchant cancelled in Hiryu"),
}


async def handle_cancel(grab_order_id: str, body: CancelMessage, caller: str, *,
                        via: str = "hiryu", trigger: tuple[str, str] | None = None
                        ) -> tuple[int, dict]:
    if not trigger:
        base = _CANCEL_WORDS[body.cancelled_by]
        code = f" ({body.reason_code})" if body.reason_code else ""
        trigger = (base[0] + code, base[1] + code)
    common = dict(mtype="cancel", no=2, h="H2", body=_dump(body), message_id=body.message_id,
                  via=via, grab_order_id=grab_order_id, trigger=trigger)
    seen = await _replay(body.message_id)
    if seen:
        await _log_in(**common, status=str(seen[1].get("status") or "taken"), code=seen[0],
                      answer=seen[1], site_id=None)
        return seen
    try:
        at = _utc(body.cancelled_at, "cancelled_at")
        code, answer, order = await _handle_cancel(grab_order_id, body, caller, at)
    except HTTPException as e:
        await _log_in(**common, status="refused", code=e.status_code, answer={"detail": e.detail},
                      site_id=None)
        raise
    await _log_in(**common, status=answer["status"], code=code, answer=answer,
                  site_id=order.get("site_id") if order else None)
    return code, answer


@router.post("/orders/{grab_order_id}/cancel", response_model=CancelAnswer)
async def post_cancel(grab_order_id: str, body: CancelMessage,
                      caller: str = Depends(outbound.hiryu_or_admin)):
    """Message 2: the customer, Grab or the merchant cancelled. Releases the
    hold; picked units go to Kembalikan ke rak. A cancel before its order is
    kept."""
    if not re.fullmatch(_ORDER_ID, grab_order_id or ""):
        raise HTTPException(422, "grab_order_id tidak valid / invalid grab_order_id")
    return (await handle_cancel(grab_order_id, body, caller))[1]


# --------------------------------------------------------------------------
# Message 6: catalogue
# --------------------------------------------------------------------------

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


async def _register_barcodes(sku_id: int, code: str, barcodes: list[str], problems: list[str]) -> None:
    """One barcode belongs to one SKU, ever (§2.8)."""
    for bc in barcodes:
        bc = (bc or "").strip()
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


async def _create_sku(code: str, name: str, brand_id: int, barcodes: list[str],
                      problems: list[str]) -> int | None:
    """A SKU code the WMS has not seen becomes a WMS SKU of that brand; Ops HQ
    completes it (Lengkapi data SKU)."""
    if await db.fetch_one("SELECT id FROM skus WHERE brand_id = %s AND UPPER(brand_sku_code) = %s",
                          (brand_id, code)):
        problems.append(f"SKU {code}: kode sudah dipakai SKU lain / code already used by another SKU")
        return None
    brand = await db.fetch_one("SELECT identity_mode FROM brands WHERE id = %s", (brand_id,))
    sku_id = await db.execute(
        "INSERT INTO skus (brand_id, brand_sku_code, name_display, identity_mode, "
        "hiryu_sku_code, hiryu_created_at) VALUES (%s,%s,%s,%s,%s,UTC_TIMESTAMP())",
        (brand_id, code, name[:255], (brand or {}).get("identity_mode") or "sku_barcode", code))
    await db.execute("DELETE FROM hiryu_pending_skus WHERE sku_code = %s", (code,))
    await _register_barcodes(sku_id, code, barcodes, problems)
    return sku_id


async def _sku_from_pending(code: str, brand_id: int, problems: list[str]) -> int | None:
    """A SKU Hiryu sent before its brand was known, created now that a store
    with a brand uses it."""
    row = await db.fetch_one("SELECT name, barcodes_json FROM hiryu_pending_skus WHERE sku_code = %s",
                             (code,))
    if not row:
        return None
    try:
        barcodes = [str(b) for b in json.loads(row["barcodes_json"] or "[]")][:10]
    except ValueError:
        barcodes = []
    return await _create_sku(code, row["name"], brand_id, barcodes, problems)


async def _connect_store_items(store_no: int, brand_id: int, problems: list[str]) -> int:
    """A store just got its brand: its menu items take the brand, and items
    whose SKU code is known (or waiting in hiryu_pending_skus) are connected.
    Returns the items connected."""
    await db.execute("UPDATE hiryu_items SET brand_id = %s WHERE hiryu_store_no = %s",
                     (brand_id, store_no))
    rows = await db.fetch_all(
        "SELECT id, sku_code FROM hiryu_items WHERE hiryu_store_no = %s AND sku_id IS NULL "
        "AND sku_code IS NOT NULL AND sku_code <> ''", (store_no,))
    done = 0
    for r in rows:
        code = r["sku_code"].strip().upper()
        sku = await _sku_for_code(code, brand_id)
        sku_id = sku["id"] if sku else await _sku_from_pending(code, brand_id, problems)
        if sku_id:
            await db.execute("UPDATE hiryu_items SET sku_id = %s WHERE id = %s", (sku_id, r["id"]))
            done += 1
    return done


async def _recompute_store_active(store_nos: list[int]) -> None:
    """`active` = Hiryu says active, a brand is picked, and the dark store is in
    Hiryu's catalogue. Stores at a hub Hiryu dropped stop too."""
    where = "s.hiryu_active = 0"
    params: list = []
    if store_nos:
        where = f"hs.hiryu_store_no IN ({db.placeholders(store_nos)}) OR s.hiryu_active = 0"
        params = list(store_nos)
    await db.execute(
        "UPDATE hiryu_stores hs JOIN sites s ON s.id = hs.site_id "
        "SET hs.active = IF(hs.hiryu_active = 1 AND hs.brand_id IS NOT NULL "
        "                   AND s.hiryu_active = 1, 1, 0) WHERE " + where, params)


async def _handle_catalogue(body: CatalogueMessage, caller: str) -> tuple[int, dict]:
    problems: list[str] = []
    warnings: list[str] = []
    today = daycolor.local_date()

    # 0. Dark stores -> hubs. A new one creates the hub (Baru dari Hiryu) with a
    #    placeholder code; Ops HQ completes it on Hub & mulai operasi and sets
    #    the real code. Later messages change only name, address and hours.
    for ds in body.dark_stores:
        hours = json.dumps(ds.opening_hours.model_dump(mode="json"), separators=(",", ":"))
        site = await db.fetch_one("SELECT id FROM sites WHERE hiryu_dark_store_id = %s",
                                  (ds.hiryu_dark_store_id,))
        if site:
            await db.execute(
                "UPDATE sites SET name = %s, address = %s, opening_hours_json = %s, "
                "hiryu_active = 1 WHERE id = %s",
                (ds.name[:160], ds.address[:255], hours, site["id"]))
            continue
        code = f"HY{ds.hiryu_dark_store_id}"
        if await db.fetch_one("SELECT id FROM sites WHERE code = %s", (code,)):
            problems.append(f"Dark store #{ds.hiryu_dark_store_id}: kode {code} sudah dipakai dark store "
                            f"lain / code {code} already used by another dark store")
            continue
        await db.execute(
            "INSERT INTO sites (code, name, address, site_type, hiryu_dark_store_id, "
            "opening_hours_json, hiryu_received_at) "
            "VALUES (%s,%s,%s,'darkstore',%s,%s,UTC_TIMESTAMP())",
            (code, ds.name[:160], ds.address[:255], ds.hiryu_dark_store_id, hours))
        warnings.append(f"Dark store baru dari Hiryu: {ds.name} (#{ds.hiryu_dark_store_id})")
    if body.full and body.dark_stores:
        listed = [d.hiryu_dark_store_id for d in body.dark_stores]
        await db.execute(
            "UPDATE sites SET hiryu_active = 0 WHERE hiryu_dark_store_id IS NOT NULL "
            f"AND hiryu_dark_store_id NOT IN ({db.placeholders(listed)})", listed)

    # 1. Stores -> hub by dark store. The brand is never sent: a new store
    #    waits for Ops HQ (brand and Grab merchant account) and stays inactive.
    stores_done, touched = 0, []
    for st in body.stores:
        site = await db.fetch_one("SELECT id FROM sites WHERE hiryu_dark_store_id = %s",
                                  (st.hiryu_dark_store_id,))
        if not site:
            problems.append(f"Toko/store #{st.hiryu_store_id}: dark store #{st.hiryu_dark_store_id} "
                            "tidak dikenal / unknown dark store")
            continue
        acceptance = (st.order_acceptance or "").upper() or None
        h_active = 1 if st.status.lower() == "active" else 0
        await db.execute(
            "INSERT INTO hiryu_stores (hiryu_store_no, store_name, site_id, brand_id, active, "
            "updated_by, hiryu_dark_store_id, hiryu_active, order_acceptance, hiryu_received_at) "
            "VALUES (%s,%s,%s,NULL,0,'hiryu',%s,%s,%s,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE "
            "store_name = VALUES(store_name), site_id = VALUES(site_id), "
            "hiryu_dark_store_id = VALUES(hiryu_dark_store_id), "
            "hiryu_active = VALUES(hiryu_active), "
            "order_acceptance = COALESCE(VALUES(order_acceptance), order_acceptance), "
            "hiryu_received_at = COALESCE(hiryu_received_at, VALUES(hiryu_received_at)), "
            "updated_by = 'hiryu'",
            (st.hiryu_store_id, st.name[:160], site["id"], st.hiryu_dark_store_id, h_active,
             acceptance))
        stores_done += 1
        touched.append(st.hiryu_store_id)
        if acceptance and acceptance != "MANUAL":
            warnings.append(f"Toko #{st.hiryu_store_id}: terima {acceptance}, bukan MANUAL / "
                            f"order acceptance {acceptance}, not MANUAL")
    if body.full and body.stores:
        in_msg = [s.hiryu_store_id for s in body.stores]
        await db.execute(
            "UPDATE hiryu_stores SET hiryu_active = 0, active = 0, updated_by = 'hiryu' "
            f"WHERE hiryu_store_no NOT IN ({db.placeholders(in_msg)})", in_msg)
    await _recompute_store_active(touched)

    # Each menu's store and its brand (NULL while Ops HQ has not picked one).
    store_brand: dict[int, int | None] = {}
    for menu in body.menus:
        row = await db.fetch_one("SELECT brand_id FROM hiryu_stores WHERE hiryu_store_no = %s",
                                 (menu.hiryu_store_id,))
        if row:
            store_brand[menu.hiryu_store_id] = row["brand_id"]
    code_brands: dict[str, set] = {}
    waiting_codes: set[str] = set()
    for menu in body.menus:
        b = store_brand.get(menu.hiryu_store_id)
        for it in menu.items:
            if not it.sku_code:
                continue
            c = it.sku_code.strip().upper()
            if b:
                code_brands.setdefault(c, set()).add(b)
            elif menu.hiryu_store_id in store_brand:
                waiting_codes.add(c)

    # 2. SKUs: update the name of a known one, create an unseen one for the
    #    brand of the store whose menu uses it (§2.6). A SKU whose brand is not
    #    known yet waits in hiryu_pending_skus.
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
            updated += 1
            await _register_barcodes(sku["id"], code, s.barcodes, problems)
            continue
        if brand_id is None and code not in waiting_codes:
            brand_id = await _brand_by_prefix(code)
        if brand_id is None:
            await db.execute(
                "INSERT INTO hiryu_pending_skus (sku_code, name, barcodes_json, message_id) "
                "VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE name = VALUES(name), "
                "barcodes_json = VALUES(barcodes_json), message_id = VALUES(message_id)",
                (code, s.name[:255], json.dumps(s.barcodes), body.message_id))
            if code not in waiting_codes:
                problems.append(f"SKU {code}: merek belum diketahui, disimpan sampai menu toko "
                                "yang bermerek memakainya / brand not known yet, kept until a "
                                "menu of a store with a brand uses it")
            continue
        if await _create_sku(code, s.name, brand_id, s.barcodes, problems):
            created += 1

    # 3. Menus: each store's items, their SKU, units per sale and price (§2.12).
    items = 0
    for menu in body.menus:
        if menu.hiryu_store_id not in store_brand:
            problems.append(f"Menu toko/store #{menu.hiryu_store_id}: toko tidak dikenal / unknown store")
            continue
        brand_id = store_brand[menu.hiryu_store_id]
        seen_ids = []
        for it in menu.items:
            code = it.sku_code.strip().upper() if it.sku_code else None
            sku_id = None
            if code and brand_id:
                sku = await _sku_for_code(code, brand_id)
                sku_id = sku["id"] if sku else await _sku_from_pending(code, brand_id, problems)
                if not sku_id:
                    problems.append(f"#{menu.hiryu_store_id} {it.item_id}: kode SKU {code} "
                                    "tidak dikenal / unknown SKU code")
            await db.execute(
                "INSERT INTO hiryu_items (hiryu_store_no, hiryu_item_id, brand_id, item_name, sku_id, "
                "sku_code, units_per_sale, price_idr, available_status, active, imported_at, "
                "mapped_by, mapped_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,1,UTC_TIMESTAMP(),'hiryu',UTC_TIMESTAMP()) "
                "ON DUPLICATE KEY UPDATE brand_id = VALUES(brand_id), item_name = VALUES(item_name), "
                "sku_id = VALUES(sku_id), sku_code = VALUES(sku_code), "
                "units_per_sale = VALUES(units_per_sale), "
                "price_idr = VALUES(price_idr), available_status = VALUES(available_status), "
                "active = 1, imported_at = VALUES(imported_at), mapped_by = 'hiryu', "
                "mapped_at = VALUES(mapped_at)",
                (menu.hiryu_store_id, it.item_id, brand_id, it.name[:255], sku_id, code,
                 it.units_per_sale, it.price, "AVAILABLE" if it.available else "UNAVAILABLE"))
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

    # 4. The answer to a Sinkron ulang.
    if body.request_id:
        await db.execute(
            "UPDATE hiryu_catalogue_requests SET answered_at = UTC_TIMESTAMP(), "
            "answered_message_id = %s WHERE request_id = %s AND answered_at IS NULL",
            (body.message_id, body.request_id))

    answer = {"stores": stores_done, "skus_created": created, "skus_updated": updated,
              "items": items, "problems": problems[:200]}
    summary = (f"{len(body.dark_stores)} dark store, {stores_done} toko, {created} SKU baru, "
               f"{updated} SKU diperbarui, {items} barang")
    await _log("catalogue", body.message_id, "partial" if problems else "accepted",
               summary + (f"; {len(problems)} masalah / problems" if problems else ""))
    for p in problems[:50]:
        await _log("catalogue", body.message_id, "problem", p)
    for w in warnings[:50]:
        await _log("catalogue", body.message_id, "warning", w)
    if created or problems or warnings:
        await _audit(caller, "hiryu_catalogue", None, "catalogue",
                     {"full": body.full, "skus_created": created, "problems": len(problems),
                      "request_id": body.request_id})
    await _remember(body.message_id, "catalogue", 200, answer)
    return 200, answer


async def handle_catalogue(body: CatalogueMessage, caller: str, *, via: str = "hiryu"
                           ) -> tuple[int, dict]:
    """Upsert dark stores, stores, SKUs and each store's menu. What cannot be
    placed is skipped, listed in `problems` and logged for Ops HQ; the rest is
    taken."""
    site_id = None
    if body.request_id:
        req = await db.fetch_one(
            "SELECT site_id FROM hiryu_catalogue_requests WHERE request_id = %s", (body.request_id,))
        site_id = req["site_id"] if req else None
        trigger = (f"Jawaban Sinkron ulang {body.request_id}",
                   f"Answer to Sinkron ulang {body.request_id}")
    elif body.full:
        trigger = ("Katalog penuh dari Hiryu", "Full catalogue from Hiryu")
    else:
        trigger = ("Katalog berubah di Hiryu", "Catalogue changed in Hiryu")
    common = dict(mtype="catalogue", no=6, h="H6", body=_dump(body), message_id=body.message_id,
                  via=via, grab_order_id=None, trigger=trigger, site_id=site_id)
    seen = await _replay(body.message_id)
    if seen:
        await _log_in(**common, status="repeat", code=seen[0], answer=seen[1])
        return seen
    try:
        code, answer = await _handle_catalogue(body, caller)
    except HTTPException as e:
        await _log_in(**common, status="refused", code=e.status_code, answer={"detail": e.detail})
        raise
    await _log_in(**common, status="partial" if answer["problems"] else "taken", code=code,
                  answer=answer)
    return code, answer


@router.post("/catalogue", response_model=CatalogueAnswer)
async def post_catalogue(body: CatalogueMessage, caller: str = Depends(outbound.hiryu_or_admin)):
    """Message 6: dark stores, stores, SKUs and menus, sent by Hiryu when any of
    them change, and in full when the WMS asks (request_id)."""
    return (await handle_catalogue(body, caller))[1]


@router.get("/ping", response_model=Ping)
async def ping(caller: str = Depends(outbound.hiryu_or_admin)):
    """Answers {"ok": true} when the secret is right."""
    return {"ok": True}


# ==========================================================================
# The app side: /api/hiryu-link (behind Google sign-in)
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
    demo_mode: bool = Field(default=False,
                            description="The hub asked for is in Mode demo: messages go to the stand-in")
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
    reason_code: str | None = Field(default="2001", pattern=r"^200[1-4]$")
    reason: str | None = Field(default=None, pattern=r"^[A-Za-z0-9 .,:;()'/&_-]{1,160}$")
    cancelled_by: Literal["customer", "grab", "merchant"] = "merchant"


class TestAnswer(BaseModel):
    http_status: int
    answer: dict


class LinkStore(BaseModel):
    hiryu_store_no: int
    store_name: str
    site_id: int
    site_code: str
    hiryu_dark_store_id: int | None
    brand_id: int | None
    brand_name: str | None
    grab_account: str | None = Field(description="own | ninja | null (not chosen)")
    needs_brand: bool = Field(description="Waiting for Ops HQ: brand or Grab merchant account "
                                          "not chosen yet (board 2e)")
    order_acceptance: str | None
    acceptance_warning: bool = Field(description="Hiryu's order acceptance is not MANUAL")
    hiryu_active: bool
    active: bool
    link_on: bool
    grab_active: bool
    hiryu_received_at: str | None
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
    return max(0, int((_now() - ts).total_seconds()))


@ui_router.get("/status", response_model=LinkStatus)
async def status(site_id: int | None = None,
                 user: auth.User = Depends(auth.require("supervisor"))):
    """Is the pipe working? (§9.3) The SPV checks it at opening: last message
    sent, 0 waiting, 0 failed, and anything waiting more than 5 minutes red."""
    where, params = "", []
    demo = False
    if site_id:
        site = await auth.assert_site_access(user, site_id)
        where, params = " AND site_id = %s", [site_id]
        demo = await pos_sender.is_demo_site(site["id"])
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
        "demo_mode": demo,
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
async def snapshot(site_id: int | None = None, user: auth.User = Depends(auth.require("hq"))):
    """Kirim snapshot penuh: every SKU of every store with its link on (or of
    one hub), worked out at send time."""
    n = await pos_sender.queue_full_snapshot(site_id=site_id)
    await _audit(user.email, "hiryu_link", None, "snapshot", {"rows": n, "site_id": site_id})
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
    code, answer = await handle_order(body, user.email, is_test=True, via="test",
                                      trigger=("Simulator: pesanan uji", "Simulator: test order"))
    return {"http_status": code, "answer": answer}


@ui_router.post("/test-cancel", response_model=TestAnswer)
async def test_cancel(body: TestCancelIn, user: auth.User = Depends(auth.require("hq"))):
    """The simulator's message 2, through the same handler."""
    msg = CancelMessage(message_id=body.message_id, reason_code=body.reason_code,
                        reason=body.reason or (REASONS.get(body.reason_code) if body.reason_code else None),
                        cancelled_by=body.cancelled_by, cancelled_at=_iso(_now()))
    code, answer = await handle_cancel(body.grab_order_id, msg, user.email, via="test",
                                       trigger=("Simulator: pembatalan uji", "Simulator: test cancel"))
    return {"http_status": code, "answer": answer}


@ui_router.get("/catalogue", response_model=LinkCatalogue)
async def catalogue(site_id: int | None = None, store_no: int | None = None,
                    user: auth.User = Depends(auth.current_user)):
    """Menu & toko Hiryu (board 2e): the stores Hiryu sent, with their hub,
    brand, Grab merchant account and link, and one store's menu items with
    their SKU, units per sale and price. A store waiting for Ops HQ has
    needs_brand. Every role may look; changes are Ops HQ's."""
    where, params = "", []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where, params = " WHERE hs.site_id = %s", [site_id]
    stores = await db.fetch_all(
        "SELECT hs.hiryu_store_no, hs.store_name, hs.site_id, s.code AS site_code, "
        "       hs.hiryu_dark_store_id, hs.brand_id, b.name AS brand_name, "
        "       hs.grab_account, hs.order_acceptance, hs.hiryu_active, hs.active, "
        "       hs.link_on, hs.grab_active, hs.hiryu_received_at, hs.updated_by, "
        "       (SELECT COUNT(*) FROM hiryu_items hi WHERE hi.hiryu_store_no = hs.hiryu_store_no "
        "          AND hi.active = 1) AS items, "
        "       (SELECT COUNT(*) FROM hiryu_items hi WHERE hi.hiryu_store_no = hs.hiryu_store_no "
        "          AND hi.active = 1 AND hi.sku_id IS NULL) AS unconnected "
        "FROM hiryu_stores hs JOIN sites s ON s.id = hs.site_id "
        "LEFT JOIN brands b ON b.id = hs.brand_id" + where +
        " ORDER BY (hs.brand_id IS NULL) DESC, hs.active DESC, s.code, b.name, hs.hiryu_store_no",
        params)
    items = []
    if store_no:
        items = await db.fetch_all(
            "SELECT hi.id, hi.hiryu_store_no, hi.hiryu_item_id, hi.item_name, hi.sku_id, "
            "       COALESCE(k.hiryu_sku_code, k.brand_sku_code, hi.sku_code) AS sku_code, "
            "       k.name_display AS sku_name, k.hiryu_created_at, hi.units_per_sale, "
            "       hi.price_idr, hi.available_status, hi.active "
            "FROM hiryu_items hi LEFT JOIN skus k ON k.id = hi.sku_id "
            "WHERE hi.hiryu_store_no = %s "
            "ORDER BY hi.active DESC, hi.sku_id IS NOT NULL, hi.item_name LIMIT 3000", (store_no,))
    week_ago = _now() - timedelta(days=7)
    return {
        "live": await pos_sender.link_live(),
        "stores": [{
            **s,
            "needs_brand": s["brand_id"] is None or not s["grab_account"],
            "acceptance_warning": bool(s["order_acceptance"]) and s["order_acceptance"] != "MANUAL",
            "hiryu_active": bool(s["hiryu_active"]), "active": bool(s["active"]),
            "link_on": bool(s["link_on"]), "grab_active": bool(s["grab_active"]),
            "hiryu_received_at": _iso(s["hiryu_received_at"]),
            "items": int(s["items"] or 0), "unconnected": int(s["unconnected"] or 0),
        } for s in stores],
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


# --- a new store: brand and Grab merchant account (board 2e) -------------------

class StoreAssignIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    brand_id: int = Field(ge=1)
    grab_account: Literal["own", "ninja"] | None = Field(
        default=None, description="own = the brand's own Grab merchant account; ninja = Ninja "
                                  "Van's, acting as Nemu Mart. Omit to take the brand's.")


class StoreAssignAnswer(BaseModel):
    ok: bool
    hiryu_store_no: int
    brand_id: int
    grab_account: str
    active: bool
    items_connected: int
    problems: list[str]
    message: str


@ui_router.post("/stores/{store_no}/assign", response_model=StoreAssignAnswer)
async def assign_store(store_no: int, body: StoreAssignIn,
                       user: auth.User = Depends(auth.require("hq"))):
    """Simpan on the yellow card of Menu & toko Hiryu: Ops HQ picks the brand of
    a store Hiryu sent, and its Grab merchant account. Asked once per store;
    one store sells one brand (no mix and match), one store per brand at each
    hub. The merchant account follows the brand: for a brand that already has
    one it is taken from the brand, and a different choice is refused (change
    it on the brand). The store's menu items are then connected to that
    brand's SKUs."""
    store = await db.fetch_one("SELECT * FROM hiryu_stores WHERE hiryu_store_no = %s", (store_no,))
    if not store:
        raise HTTPException(404, "Toko tidak ditemukan. / Store not found.")
    if store["brand_id"] is not None and store["brand_id"] != body.brand_id:
        raise HTTPException(409, "Merek toko ini sudah dipilih. / This store's brand is already chosen.")
    brand = await db.fetch_one("SELECT id, name, active, grab_account FROM brands "
                               "WHERE id = %s", (body.brand_id,))
    if not brand or not brand["active"]:
        raise HTTPException(422, "Merek tidak ditemukan. / Brand not found.")
    other = await db.fetch_one(
        "SELECT hiryu_store_no, store_name FROM hiryu_stores WHERE site_id = %s AND brand_id = %s "
        "AND hiryu_store_no <> %s AND hiryu_active = 1", (store["site_id"], body.brand_id, store_no))
    if other:
        raise HTTPException(409, f"Dark store ini sudah punya toko {brand['name']}: {other['store_name']} "
                                 f"(#{other['hiryu_store_no']}). Satu toko per merek per dark store. / "
                                 f"This dark store already has a {brand['name']} store. One store per "
                                 "brand per dark store.")
    account = body.grab_account or brand["grab_account"]
    if not account:
        raise HTTPException(422, "Pilih akun merchant Grab. / Choose the Grab merchant account.")
    if brand["grab_account"] and account != brand["grab_account"]:
        raise HTTPException(422, "Akun merchant mengikuti merek, sama untuk semua toko merek itu. "
                                 "Ubah di data merek. / The merchant account follows the brand; "
                                 "change it on the brand.")
    if not brand["grab_account"]:
        await db.execute("UPDATE brands SET grab_account = %s WHERE id = %s "
                         "AND grab_account IS NULL", (account, body.brand_id))
    await db.execute(
        "UPDATE hiryu_stores SET brand_id = %s, grab_account = %s, brand_set_by = %s, "
        "brand_set_at = UTC_TIMESTAMP(), updated_by = %s WHERE hiryu_store_no = %s",
        (body.brand_id, account, user.email, user.email, store_no))
    await db.execute("INSERT IGNORE INTO brand_sites (brand_id, site_id, active) VALUES (%s,%s,1)",
                     (body.brand_id, store["site_id"]))
    problems: list[str] = []
    connected = await _connect_store_items(store_no, body.brand_id, problems)
    await _recompute_store_active([store_no])
    row = await db.fetch_one("SELECT active FROM hiryu_stores WHERE hiryu_store_no = %s", (store_no,))
    await _audit(user.email, "hiryu_store", store_no, "assign_brand",
                 {"brand_id": body.brand_id, "grab_account": account,
                  "items_connected": connected})
    for p in problems[:50]:
        await _log("catalogue", None, "problem", p, None, store_no)
    label = "akun merchant merek sendiri" if account == "own" else "akun merchant Ninja Van (Nemu Mart)"
    return {"ok": True, "hiryu_store_no": store_no, "brand_id": body.brand_id,
            "grab_account": account, "active": bool(row and row["active"]),
            "items_connected": connected, "problems": problems[:200],
            "message": f"{store['store_name']}: {brand['name']}, {label}. / "
                       f"{store['store_name']}: {brand['name']}, "
                       f"{'own merchant account' if account == 'own' else 'Ninja Van merchant account'}."}


class StorePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    link_on: bool | None = Field(default=None, description="The link for this store (H8)")
    grab_active: bool | None = Field(default=None, description="The store is active on Grab")


@ui_router.patch("/stores/{store_no}", response_model=CountAnswer)
async def patch_store(store_no: int, body: StorePatchIn,
                      user: auth.User = Depends(auth.require("hq"))):
    """Ops HQ, with Shaun at switch-on (kick-off step 13): the link for one
    store (H8). On queues that store's full stock at once, so Hiryu starts from
    the WMS number; off stops its stock messages. Also ticks that the store is
    active on Grab (step 15)."""
    store = await db.fetch_one("SELECT * FROM hiryu_stores WHERE hiryu_store_no = %s", (store_no,))
    if not store:
        raise HTTPException(404, "Toko tidak ditemukan. / Store not found.")
    queued = 0
    if body.link_on is not None:
        if body.link_on and not store["active"]:
            raise HTTPException(409, "Toko belum aktif: pilih merek dulu, dan toko harus aktif di "
                                     "Hiryu. / The store is not active yet: pick its brand first, "
                                     "and it must be active in Hiryu.")
        await db.execute(
            "UPDATE hiryu_stores SET link_on = %s, "
            "link_on_at = IF(%s = 1, UTC_TIMESTAMP(), link_on_at) WHERE hiryu_store_no = %s",
            (1 if body.link_on else 0, 1 if body.link_on else 0, store_no))
        if body.link_on and not store["link_on"]:
            queued = await pos_sender.queue_full_snapshot(store_no=store_no)
    if body.grab_active is not None:
        await db.execute("UPDATE hiryu_stores SET grab_active = %s WHERE hiryu_store_no = %s",
                         (1 if body.grab_active else 0, store_no))
    await _audit(user.email, "hiryu_store", store_no, "store_switches",
                 {**body.model_dump(exclude_none=True), "snapshot_rows": queued})
    return {"ok": True, "count": queued,
            "message": (f"Sambungan toko menyala. {queued} baris stok diantrekan. / "
                        f"Store link on. {queued} stock rows queued.") if queued else
                       "Tersimpan. / Saved."}


# --- Sinkron ulang dari Hiryu (catalogue_request) -----------------------------

class ResyncIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: int


class ResyncState(BaseModel):
    site_id: int
    request_id: str | None = None
    requested_by_name: str | None = None
    requested_at: str | None = None
    answered_at: str | None = None
    status: str = Field(description="none | waiting | answered")
    next_allowed_at: str | None = Field(description="UTC; null = may press now")
    can_request_now: bool
    cooldown_minutes: int
    message: str | None = None


async def _resync_state(site_id: int) -> dict:
    minutes = await pos_sender.rule("hiryu_resync_cooldown_minutes", 5) or 5
    last = await db.fetch_one(
        "SELECT request_id, requested_by_name, requested_by, requested_at, answered_at "
        "FROM hiryu_catalogue_requests WHERE site_id = %s ORDER BY id DESC LIMIT 1", (site_id,))
    if not last:
        return {"site_id": site_id, "status": "none", "next_allowed_at": None,
                "can_request_now": True, "cooldown_minutes": minutes}
    nxt = last["requested_at"] + timedelta(minutes=minutes)
    wait = nxt > _now()
    return {"site_id": site_id, "request_id": last["request_id"],
            "requested_by_name": last["requested_by_name"] or last["requested_by"],
            "requested_at": _iso(last["requested_at"]), "answered_at": _iso(last["answered_at"]),
            "status": "answered" if last["answered_at"] else "waiting",
            "next_allowed_at": _iso(nxt) if wait else None, "can_request_now": not wait,
            "cooldown_minutes": minutes}


@ui_router.get("/catalogue-request", response_model=ResyncState)
async def resync_state(site_id: int, user: auth.User = Depends(auth.current_user)):
    """The Sinkron ulang button's state for a hub: the last press, by whom, and
    when it may be pressed again (Bisa lagi 09:45)."""
    await auth.assert_site_access(user, site_id)
    return await _resync_state(site_id)


@ui_router.post("/catalogue-request", response_model=ResyncState)
async def request_catalogue(body: ResyncIn, user: auth.User = Depends(auth.current_user)):
    """Sinkron ulang dari Hiryu: any role, once every 5 minutes per hub, logged
    with the person's name. Queues `catalogue_request` to Hiryu, which answers
    with message 6 (full, same request_id). Too soon: 429, nothing queued."""
    site = await auth.assert_site_access(user, body.site_id)
    state = await _resync_state(body.site_id)
    if not state["can_request_now"]:
        at = datetime.fromisoformat(state["next_allowed_at"].rstrip("Z")).replace(tzinfo=timezone.utc)
        local = at.astimezone(daycolor.WIB).strftime("%H:%M")
        raise HTTPException(429, f"Bisa lagi {local} WIB. / Possible again at {local} WIB.")
    request_id = f"wms-cat-{body.site_id}-{int(time.time())}"
    requested_at = _now()
    async with db.tx() as cur:
        await db.run(
            cur,
            "INSERT INTO hiryu_catalogue_requests (request_id, site_id, requested_by, "
            "requested_by_name, requested_at) VALUES (%s,%s,%s,%s,%s)",
            (request_id, body.site_id, user.email, (user.name or user.email)[:160], requested_at))
        await ledger.enqueue_pos_message(
            cur, message_type="catalogue_request", site_id=body.site_id,
            payload={"request_id": request_id, "requested_at": _iso(requested_at),
                     "requested_by_name": user.name or user.email},
            is_training=bool(site.get("is_training")))
        await ledger.audit(cur, actor_email=user.email, entity="hiryu_link", entity_id=body.site_id,
                           action="catalogue_request", after={"request_id": request_id})
    state = await _resync_state(body.site_id)
    goes = await pos_sender.sending_on() or await pos_sender.is_demo_site(body.site_id)
    state["message"] = ("Permintaan dikirim ke Hiryu. / Request sent to Hiryu." if goes else
                        "Permintaan diantrekan; terkirim saat sambungan menyala. / "
                        "Request queued; it goes when the link is on.")
    return state


# --- Pesan Hiryu: every message in and out ------------------------------------

class LinkMessage(BaseModel):
    id: int
    direction: str = Field(description="in (Hiryu to WMS) | out (WMS to Hiryu)")
    message_no: int | None = Field(description="1 to 6 as on board 11d; null for catalogue_request")
    message_type: str
    h_ref: str | None = Field(description="H number(s) from board 11a, e.g. 'H1 H9'")
    message_id: str
    site_id: int | None
    grab_order_id: str | None
    trigger: str | None
    trigger_en: str | None
    via: str = Field(description="hiryu | demo | test | webhook | standin")
    status: str
    http_status: int | None
    attempts: int
    time: str
    updated_at: str | None
    body: dict | list | None = Field(description="The exact JSON body")
    body_truncated: bool
    answer: dict | list | str | None


class LinkMessages(BaseModel):
    messages: list[LinkMessage]
    last_id: int | None


_BODY_INLINE = 200_000


def _parse(text: str | None):
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


def _message_row(r: dict, full: bool = False) -> dict:
    text = r.get("body_json")
    big = bool(text) and len(text) > _BODY_INLINE and not full
    return {
        "id": r["id"], "direction": r["direction"], "message_no": r["message_no"],
        "message_type": r["message_type"], "h_ref": r["h_ref"], "message_id": r["message_id"],
        "site_id": r["site_id"], "grab_order_id": r["grab_order_id"],
        "trigger": r["trigger_id"], "trigger_en": r["trigger_en"], "via": r["via"],
        "status": r["status"], "http_status": r["http_status"], "attempts": int(r["attempts"] or 1),
        "time": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"]),
        "body": None if big else _parse(text), "body_truncated": big,
        "answer": _parse(r.get("answer_json")),
    }


@ui_router.get("/messages", response_model=LinkMessages)
async def messages(site_id: int | None = None, since: str | None = None,
                   after_id: int | None = None, limit: int = Query(default=100, ge=1, le=500),
                   user: auth.User = Depends(auth.current_user)):
    """Pesan Hiryu: every message in and out, newest first, with its trigger in
    plain words, the H number from 11a, the exact JSON and the answer. With a
    hub, its messages plus the catalogue (which belongs to no hub). `since` (ISO
    time) or `after_id` (the last id seen) fetch only what is new. No customer
    data: the messages carry none."""
    where, params = ["1=1"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("(site_id = %s OR site_id IS NULL)")
        params.append(site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih dark store. / Choose a dark store.")
    if since:
        ts = _utc(since, "since")
        where.append("updated_at >= %s")
        params.append(ts)
    if after_id:
        where.append("id > %s")
        params.append(after_id)
    rows = await db.fetch_all(
        "SELECT * FROM hiryu_message_log WHERE " + " AND ".join(where) +
        " ORDER BY id DESC LIMIT %s", (*params, limit))
    return {"messages": [_message_row(r) for r in rows],
            "last_id": max((r["id"] for r in rows), default=after_id)}


@ui_router.get("/messages/{message_log_id}", response_model=LinkMessage)
async def message_one(message_log_id: int, user: auth.User = Depends(auth.current_user)):
    """One message with its full body (a large catalogue is cut from the list)."""
    r = await db.fetch_one("SELECT * FROM hiryu_message_log WHERE id = %s", (message_log_id,))
    if not r:
        raise HTTPException(404, "Pesan tidak ditemukan. / Message not found.")
    if r["site_id"]:
        await auth.assert_site_access(user, r["site_id"])
    return _message_row(r, full=True)
