"""M5 / §9 — Order intake from the POS, allocation, and guided picking.

From deploy 2 the WMS gives every order to a picker by itself (PRD §6.2): see
assign.py. This router keeps the order's life on the floor: received, given
out, picked, handed to the pack bench, cancelled, and the SPV's queue board.
Packing and the handover to the driver are in routers/hiryu.py.
"""
import hmac
import os
import random
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

import assign
import auth
import common
import daycolor
import db
import floor
import ledger
import models
import replenish
from routers import returns

router = APIRouter(prefix="/api", tags=["outbound"])


# --- models of deploy 3 (boards 6a to 6k) ------------------------------------
# Kept here, not in models.py (BUILD.md). Each extends the older model, so the
# old pages still read the fields they know.

class PickLineV2(models.PickLine):
    location_short: str | None = Field(default=None, description="A-3-01: the bin without the hub")
    location_words: str | None = Field(
        default=None, description="Rak A, level 3 dari bawah, bin ke-1 (board 6c)")
    order_line_id: int | None = None
    is_replacement: bool = Field(default=False, description="Added by the customer's Ganti dengan")
    replaces_sku_name: str | None = None
    oos_type: str | None = Field(
        default=None, description="The customer's instruction: replace | remove | cancel_order | "
                                  "contact_customer | null (= cancel_order)")
    qty_wanted: int | None = Field(default=None, description="Units the order line asked for")


class ReplacedPair(BaseModel):
    from_sku_name: str
    from_units: int
    to_sku_name: str
    to_units: int


class PickSummary(BaseModel):
    products: int = Field(description="Products (order lines) still in the order")
    units: int = Field(description="Units to pick, after removals and replacements")
    units_picked: int
    units_ordered: int = Field(description="Units Hiryu sent in message 1")
    replaced: list[ReplacedPair] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list, description="Products taken off the order")


class PickTaskV2(models.PickTask):
    lines: list[PickLineV2]
    assigned_at: str | None = Field(default=None, description="Given to this picker (= claimed_at)")
    basket_code: str | None = Field(default=None, description="The outbound basket, once scanned")
    basket_scanned_at: str | None = None
    suggested_basket: str | None = Field(
        default=None, description="A free basket to show as the example label (board 6b)")
    order_time: str | None = Field(default=None, description="Grab's order time (UTC)")
    ready_by: str | None = Field(default=None, description="Order time + grab_ready_minutes")
    work_seconds: int | None = Field(
        default=None, description="Stopwatch: since given to the picker; stops at the hand-off")
    work_stopped: bool = False
    store_name: str | None = None
    order_status: str | None = None
    cancelled_at: str | None = None
    cancel_reason: str | None = None
    is_uji: bool = Field(default=False, description="WMS test order (UJI): never sent to Hiryu")
    is_demo: bool = Field(default=False, description="Demo order from Buat pesanan dummy: DEMO chip")
    pick_start_seconds: int = Field(default=120, description="Start within this or it goes back")
    summary: PickSummary | None = None
    server_time: str | None = None


class BasketIn(BaseModel):
    code: str = Field(min_length=1, max_length=32, description="The scanned or typed basket label")


class BasketRow(BaseModel):
    code: str
    busy: bool
    order_id: int | None = None
    order_label: str | None = None
    stage: str | None = Field(default=None, description="picking | to_pack | cancelled")


class BasketList(BaseModel):
    site_id: int
    baskets: list[BasketRow]
    from_special_bins: bool = Field(
        description="False while special_bins is not set up: any <HUB>-OUT-NN is accepted")


class CheckedBin(BaseModel):
    location_id: int
    qty_found: int = Field(default=0, ge=0)


class ShortPickV2In(models.ShortPickIn):
    checked: list[CheckedBin] = Field(
        default_factory=list,
        description="The other places the picker checked (from /elsewhere) and what was there")


class OosInstruction(BaseModel):
    type: str | None = Field(description="replace | remove | cancel_order | contact_customer | null")
    effective: str = Field(description="What the WMS does: replace | remove | cancel_order")
    replace_sku_id: int | None = None
    replace_sku_name: str | None = None
    replace_sku_code: str | None = None
    replace_units: int | None = None
    replace_location_code: str | None = None
    replace_location_words: str | None = None


class ShortPickV2Result(models.ShortPickResult):
    action: str = Field(description="replaced (replacement to pick) | removed | cancel_order")
    instruction: OosInstruction | None = None
    bins_zeroed: list[str] = Field(default_factory=list, description="Bins set to what was found")
    task: PickTaskV2 | None = Field(default=None, description="The order after the change")


class PickerRowV2(models.PickerRow):
    basket_code: str | None = None


class QueueCardV2(models.PickQueueCard):
    basket_code: str | None = None
    store_name: str | None = None
    is_uji: bool = False
    is_demo: bool = Field(default=False, description="Demo order from Buat pesanan dummy: DEMO chip")
    order_time: str | None = None
    pack_type: str | None = Field(default=None, description="bag | carton | two, once named")
    pack_name: str | None = None
    cancelled_at: str | None = None
    cancel_reason: str | None = None
    pack_wait_amber: bool = False


class QueueLaneV2(BaseModel):
    key: str
    count: int
    cards: list[QueueCardV2]


class QueueBoardV2(models.PickQueueBoard):
    lanes: list[QueueLaneV2]
    pickers: list[PickerRowV2] = Field(default_factory=list)
    tab_counts: dict[str, int] = Field(
        default_factory=dict, description="kemas, serah, kembalikan: the tab badges")
    move_reasons: list[str] = Field(default_factory=list, description="Pindahkan: Alasan")
    can_create_test: bool = Field(default=False, description="SPV and above: Buat pesanan uji")


class OrderRowV2(models.OrderRow):
    short_no: str | None = Field(default=None, description="GM number, or UJI-01")
    is_uji: bool = False
    is_demo: bool = False


class OrderListV2(models.OrderList):
    orders: list[OrderRowV2]


class TestOrderLineIn(BaseModel):
    sku_id: int
    units: int = Field(ge=1, le=99)


class TestOrderIn(BaseModel):
    site_id: int
    hiryu_store_no: int | None = Field(default=None, description="Which store (brand); empty = any")
    products: int | None = Field(default=None, ge=1, le=10, description="Empty = acak (3 to 6)")
    lines: list[TestOrderLineIn] | None = Field(
        default=None, description="Exact lines; overrides products")


class TestOrderResult(BaseModel):
    order_id: int
    label: str = Field(description="UJI-01 ...")
    pick_task_id: int
    products: int
    units: int
    message: str


MOVE_REASONS = [
    "Ponsel picker bermasalah",
    "Picker sakit atau izin",
    "Picker dipanggil ke tugas lain",
    "Lainnya",
]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _suppressed(order: dict, site_training: bool = False) -> bool:
    """Order messages (4, 5) for this order never leave: a training site, or a
    WMS test order (UJI). Demo orders made through the Hiryu handler are not
    UJI and do go out (to the Hiryu stand-in)."""
    return bool(site_training) or (order.get("source") or "") == "uji"


async def _resolve_line_sku(line: models.OrderLineIn) -> dict | None:
    if line.sku_id:
        return await common.sku_by_id(line.sku_id)
    if line.barcode:
        return await common.sku_by_barcode(line.barcode)
    if line.sku_code:
        return await db.fetch_one(
            f"SELECT {common.SKU_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
            "WHERE s.brand_sku_code = %s", (line.sku_code,)
        )
    return None


SLA_MINUTES = {"grab": 10}  # PRD v3.3 §9.2: Hiryu counts an order late after 10 minutes
DEFAULT_OWN_CHANNEL_SLA = 60


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Not an ISO 8601 time: {value}")
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
    return ts


async def _promise(body) -> tuple[datetime | None, datetime]:
    """When this order must be ready, stored as naive UTC like every other time.

    Grab: the 10-minute target starts at Grab's order time (decided 5 Oct), so
    ready-by = order time + `grab_ready_minutes`; with no order time, from now.
    Own channels: 1 hour from when the customer placed it (canonical §5).
    An explicit promised_at from Hiryu always wins.
    """
    now = _now()
    placed = _parse_ts(body.placed_at)
    explicit = _parse_ts(body.promised_at)
    if explicit:
        return placed, explicit
    if body.channel in SLA_MINUTES:
        minutes = await assign.rule("grab_ready_minutes", SLA_MINUTES[body.channel])
        return placed, (placed or now) + timedelta(minutes=minutes)
    return placed, (placed or now) + timedelta(minutes=DEFAULT_OWN_CHANNEL_SLA)


def _outstanding_allocation(line: dict) -> int:
    """What a pick line still holds reserved: its allocation not yet picked."""
    allocated = int(line.get("qty_allocated") or 0)
    return max(0, allocated - min(int(line.get("qty_picked") or 0), allocated))


def _release_for_pick(line: dict, qty: int) -> int:
    """How much of a line's reservation a pick of `qty` more units consumes."""
    allocated = int(line.get("qty_allocated") or 0)
    before = min(int(line.get("qty_picked") or 0), allocated)
    after = min(int(line.get("qty_picked") or 0) + qty, allocated)
    return max(0, after - before)


async def hiryu_or_admin(
    x_hiryu_key: str | None = Header(default=None),
    x_forwarded_email: str | None = Header(default=None),
) -> str:
    """Message 1 comes from Hiryu and nothing else (canonical design).

    Hiryu presents POS_SHARED_SECRET in X-Hiryu-Key -- the only way in once the
    route is exempted from SSO for machine calls. Until then an admin signed in
    through SSO may call it for testing. Everyone else is refused.
    """
    secret = os.getenv("POS_SHARED_SECRET", "")
    if secret and x_hiryu_key and hmac.compare_digest(x_hiryu_key, secret):
        return "hiryu"
    user = await auth.current_user(x_forwarded_email)
    if not user.at_least("hq"):
        raise HTTPException(403, "Only Hiryu may send orders to the WMS.")
    return user.email


@router.post("/pos/orders", response_model=models.OrderAccepted, status_code=201)
async def receive_order_http(
    body: models.OrderIn, caller: str = Depends(hiryu_or_admin)
):
    """Message 1 over HTTP: Hiryu hands the WMS an order to pick."""
    return await receive_order(body)


async def _allocate_parts(cur, site_id: int, sku_id: int, qty: int) -> tuple[list[dict], int]:
    """Reserve `qty` of a SKU across its locations, oldest stock first. Returns
    the pick parts (one per location) and how much was reserved. What cannot be
    reserved still goes on the first location the picker visits: the ledger
    may be wrong, and if the units are there the order ships whole."""
    locations = await common.pick_locations_for(site_id, sku_id)
    parts, remaining = [], qty
    for loc in locations:
        if remaining <= 0:
            break
        take = await ledger.allocate(cur, site_id=site_id, sku_id=sku_id,
                                     location_id=loc["location_id"], qty=remaining)
        if take:
            parts.append({"loc": loc, "required": take, "allocated": take})
            remaining -= take
    if remaining > 0:
        if parts:
            parts[0]["required"] += remaining
        else:
            parts.append({"loc": locations[0] if locations else None,
                          "required": remaining, "allocated": 0})
    return parts, qty - remaining


async def receive_order(body: models.OrderIn, *, source: str | None = None,
                        short_no: str | None = None, store_no: int | None = None,
                        created_by: str | None = None):
    """The POS creates an order here. The dummy generator uses the same endpoint,
    so switching to live Hiryu is configuration rather than a rewrite (§9.3).

    Deliberately unauthenticated at the user level — this is a machine-to-machine
    call. Once §9.1 is settled it is gated by POS_SHARED_SECRET.

    `source`, `short_no`, `store_no` and `created_by` are written with the
    order, before it is given to a picker (WMS test orders, UJI).
    """
    site = None
    if body.site_id:
        site = await db.fetch_one("SELECT * FROM sites WHERE id = %s", (body.site_id,))
    elif body.site_code:
        site = await db.fetch_one("SELECT * FROM sites WHERE code = %s", (body.site_code,))
    if not site:
        raise HTTPException(404, "Site not found")

    existing = await db.fetch_one(
        "SELECT o.id, pt.id AS task_id FROM orders o "
        "LEFT JOIN pick_tasks pt ON pt.order_id = o.id WHERE o.external_ref = %s",
        (body.external_ref,),
    )
    if existing:
        # Idempotent on the external ref: a POS retry must not create a second
        # order or a second allocation (§9.2).
        return {
            "order_id": existing["id"], "external_ref": body.external_ref,
            "pick_task_id": existing["task_id"] or 0, "status": "duplicate",
            "short_lines": 0, "message": "Order already received.",
        }

    resolved = []
    for line in body.lines:
        sku = await _resolve_line_sku(line)
        if not sku:
            raise HTTPException(
                422, f"Could not resolve a SKU for order line {line.model_dump()}"
            )
        resolved.append((sku, max(1, line.quantity)))

    short = 0
    placed, promised = await _promise(body)
    async with db.tx() as cur:
        order_id = await db.run(
            cur,
            "INSERT INTO orders (external_ref, site_id, brand_id, status, is_test, "
            "channel, delivery_mode, placed_at, promised_at, scheduled_at, "
            "source, hiryu_short_no, hiryu_store_no, test_created_by) "
            "VALUES (%s,%s,%s,'received',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.external_ref, site["id"], resolved[0][0]["brand_id"],
             1 if body.is_test else 0, body.channel, body.delivery_mode,
             placed, promised, _parse_ts(body.scheduled_at),
             source, short_no, store_no, created_by),
        )
        task_id = await db.run(
            cur, "INSERT INTO pick_tasks (order_id, site_id, status) "
                 "VALUES (%s,%s,'ready')", (order_id, site["id"]),
        )

        # Allocate each line across locations, oldest stock first: usually all
        # of it from one basket, but when the rack holds 1 and the order wants
        # 2, the second comes from overflow instead of the line going short.
        # One pick line per location, each holding its own reservation.
        pick_rows, line_ids = [], []
        for sku, qty in resolved:
            # If the units are not there after all, the picker declares the
            # line short and the customer's instruction is followed.
            parts, allocated = await _allocate_parts(cur, site["id"], sku["id"], qty)
            status = "allocated" if allocated >= qty else "short"
            if status == "short":
                short += 1
            line_id = await db.run(
                cur,
                "INSERT INTO order_lines (order_id, sku_id, qty_ordered, "
                "qty_allocated, status) VALUES (%s,%s,%s,%s,%s)",
                (order_id, sku["id"], qty, allocated, status),
            )
            line_ids.append(line_id)
            for part in parts:
                pick_rows.append((line_id, sku, part))

        # Sequence by pick path — rack, then level, then position — so the
        # picker walks the aisle once in one direction (M5.2.1).
        pick_rows.sort(key=lambda r: (
            r[2]["loc"]["rack_code"] if r[2]["loc"] else "zzz",
            r[2]["loc"]["level_no"] if r[2]["loc"] else 99,
            r[2]["loc"]["location_code"] if r[2]["loc"] else "",
        ))
        for i, (line_id, sku, part) in enumerate(pick_rows, start=1):
            await db.run(
                cur,
                "INSERT INTO pick_lines (pick_task_id, order_line_id, sku_id, "
                "location_id, sequence_no, qty_required, qty_allocated) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (task_id, line_id, sku["id"],
                 part["loc"]["location_id"] if part["loc"] else None, i,
                 part["required"], part["allocated"]),
            )

    # Given to a ready picker at once (§6.2 step 2), after the commit so the
    # order is there for whoever gets it. A scheduled order waits until due.
    await assign.assign_site(site["id"])

    return {
        "order_id": order_id, "external_ref": body.external_ref,
        "pick_task_id": task_id, "status": "accepted", "short_lines": short,
        # One order line per incoming line, in order (the Hiryu handler keeps
        # each message line's instruction on its own order line).
        "line_ids": line_ids,
        "message": (f"{short} line(s) could not be fully allocated."
                    if short else "Allocated in full."),
    }


def _ts(v) -> str | None:
    return str(v) if v else None


def _secs(since: datetime | None, until: datetime | None = None) -> int | None:
    if since is None:
        return None
    return max(0, int(((until or _now()) - since).total_seconds()))


async def _task_payload(task_id: int) -> dict:
    """One order as the picker's phone shows it (boards 6b to 6f)."""
    task = await db.fetch_one(
        "SELECT pt.*, o.external_ref, o.hiryu_short_no, o.is_test, o.channel, o.delivery_mode, "
        "       o.promised_at, o.placed_at, o.source, o.status AS order_status, "
        "       o.cancelled_at, o.cancel_reason, o.is_demo, hs.store_name "
        "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "LEFT JOIN hiryu_stores hs ON hs.hiryu_store_no = o.hiryu_store_no "
        "WHERE pt.id = %s", (task_id,)
    )
    if not task:
        raise HTTPException(404, "Pick task not found")
    lines = await db.fetch_all(
        "SELECT pl.*, s.name_display, s.photo_key, s.identity_mode, "
        "       s.brand_sku_code, s.unit_size, "
        "       l.code AS location_code, l.position_no, r.code AS rack_code, lv.level_no, "
        "       ib.stocked_since, ol.qty_ordered, ol.replacement_for_line_id, "
        "       rs.name_display AS replaces_sku_name, "
        "       (SELECT sa.slot_role FROM slot_assignments sa "
        "         JOIN baskets bk ON bk.id = sa.basket_id "
        "         WHERE bk.location_id = pl.location_id AND sa.sku_id = pl.sku_id "
        "         LIMIT 1) AS slot_role "
        "FROM pick_lines pl JOIN skus s ON s.id = pl.sku_id "
        "JOIN order_lines ol ON ol.id = pl.order_line_id "
        "LEFT JOIN order_lines rol ON rol.id = ol.replacement_for_line_id "
        "LEFT JOIN skus rs ON rs.id = rol.sku_id "
        "LEFT JOIN inventory_balances ib ON ib.location_id = pl.location_id "
        "      AND ib.sku_id = pl.sku_id "
        "LEFT JOIN locations l ON l.id = pl.location_id "
        "LEFT JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN racks r ON r.id = lv.rack_id "
        "WHERE pl.pick_task_id = %s ORDER BY pl.sequence_no", (task_id,)
    )
    created = task.get("created_at")
    age = _secs(created)
    claimed = task.get("claimed_at")
    stop = task.get("handed_to_pack_at") or task.get("completed_at")
    instructions: dict[int, str | None] = {}
    out_lines = []
    for l in lines:
        olid = l["order_line_id"]
        if olid not in instructions and not l["replacement_for_line_id"]:
            instructions[olid] = (await floor.instruction(olid))["type"]
        out_lines.append({
            "id": l["id"], "sequence_no": l["sequence_no"], "sku_id": l["sku_id"],
            "sku_name": l["name_display"], "photo_key": l["photo_key"],
            "location_id": l["location_id"], "location_code": l["location_code"],
            "location_short": floor.short_bin(l["location_code"]),
            "location_words": floor.bin_words(l["rack_code"], l["level_no"], l["position_no"]),
            "rack_code": l["rack_code"], "level_no": l["level_no"],
            "qty_required": l["qty_required"], "qty_picked": l["qty_picked"],
            "status": l["status"], "identity_mode": l["identity_mode"],
            "brand_sku_code": l["brand_sku_code"], "unit_size": l["unit_size"],
            "slot_role": l["slot_role"],
            # The colour of the batch that has sat longest at this location:
            # the day it went from empty to stocked. Unknown (seeded stock)
            # is None, and the screen then says "take the oldest first".
            "oldest_day_color": (daycolor.for_moment(l["stocked_since"])
                                 if l["stocked_since"] else None),
            "order_line_id": olid,
            "is_replacement": bool(l["replacement_for_line_id"]),
            "replaces_sku_name": l["replaces_sku_name"],
            "oos_type": instructions.get(olid),
            "qty_wanted": l["qty_ordered"],
        })

    # The summary of board 6f: products, units, what was replaced or removed.
    ols = await db.fetch_all(
        "SELECT ol.id, ol.qty_ordered, ol.qty_picked, ol.status, ol.replacement_for_line_id, "
        "       s.name_display, "
        "       (SELECT COALESCE(SUM(pl.qty_required),0) FROM pick_lines pl "
        "         WHERE pl.order_line_id = ol.id) AS to_pick "
        "FROM order_lines ol JOIN skus s ON s.id = ol.sku_id WHERE ol.order_id = %s",
        (task["order_id"],))
    by_id = {o["id"]: o for o in ols}
    replaced_from = {o["replacement_for_line_id"] for o in ols if o["replacement_for_line_id"]}
    replaced = []
    for o in ols:
        if o["replacement_for_line_id"] and o["replacement_for_line_id"] in by_id:
            src = by_id[o["replacement_for_line_id"]]
            replaced.append({"from_sku_name": src["name_display"],
                             "from_units": int(src["qty_ordered"]),
                             "to_sku_name": o["name_display"], "to_units": int(o["to_pick"])})
    removed = [o["name_display"] for o in ols
               if o["status"] == "short" and int(o["to_pick"]) == 0
               and o["id"] not in replaced_from and not o["replacement_for_line_id"]]
    summary = {
        "products": sum(1 for o in ols if int(o["to_pick"]) > 0),
        "units": sum(int(o["to_pick"]) for o in ols),
        "units_picked": sum(int(o["qty_picked"]) for o in ols),
        "units_ordered": sum(int(o["qty_ordered"]) for o in ols
                             if not o["replacement_for_line_id"]),
        "replaced": replaced, "removed": removed,
    }

    basket = task.get("basket_code")
    return {
        "id": task["id"], "order_id": task["order_id"],
        "external_ref": task["external_ref"], "short_no": task.get("hiryu_short_no"),
        "site_id": task["site_id"],
        "status": task["status"], "claimed_by": task["claimed_by"],
        "is_test": bool(task["is_test"]),
        "is_uji": (task.get("source") or "") == "uji",
        "is_demo": bool(task.get("is_demo")),
        "created_at": _ts(created),
        "claimed_at": _ts(claimed), "assigned_at": _ts(claimed),
        "age_seconds": age,
        "channel": task.get("channel"), "delivery_mode": task.get("delivery_mode"),
        "promised_at": _ts(task.get("promised_at")),
        "ready_by": _ts(task.get("promised_at")),
        "order_time": _ts(task.get("placed_at")),
        "started_at": _ts(task.get("started_at")),
        "handed_to_pack_at": _ts(task.get("handed_to_pack_at")),
        "reassign_note": task.get("reassign_note"),
        "basket_code": basket,
        "basket_scanned_at": _ts(task.get("basket_scanned_at")),
        "suggested_basket": (None if basket or task["status"] != "claimed"
                             else await floor.free_basket(task["site_id"])),
        "work_seconds": _secs(claimed, stop) if claimed else None,
        "work_stopped": bool(stop),
        "store_name": task.get("store_name"),
        "order_status": task.get("order_status"),
        "cancelled_at": _ts(task.get("cancelled_at")),
        "cancel_reason": task.get("cancel_reason"),
        "pick_start_seconds": 60 * await assign.rule("pick_start_minutes", 2),
        "summary": summary,
        "server_time": str(datetime.now(timezone.utc)),
        "lines": out_lines,
    }


@router.get("/pick-tasks", response_model=models.PickTaskList)
async def list_tasks(
    site_id: int,
    status: str = Query(default="ready"),
    user: auth.User = Depends(auth.current_user),
):
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT id FROM pick_tasks WHERE site_id = %s AND status = %s "
        "ORDER BY created_at LIMIT 50", (site_id, status),
    )
    return {"tasks": [await _task_payload(r["id"]) for r in rows]}


@router.post("/pick-tasks/{task_id}/claim", response_model=PickTaskV2)
async def claim_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    """Open an order: the one the WMS gave you, or a waiting one you take by hand.

    The phone calls this for the order /api/pickers/me names; for its holder it
    changes nothing (above all not claimed_at, which the 2-minute rule measures
    from), so reopening the screen is free.

    Taking a waiting order by hand stays possible for the paste screen's "pick
    it myself" while paste is still on. The conditional UPDATE is the lock: two
    people racing for one order, exactly one wins. One order per picker: a
    picker already holding one is refused.
    """
    head = await db.fetch_one("SELECT site_id FROM pick_tasks WHERE id = %s", (task_id,))
    if not head:
        raise HTTPException(404, "Pick task not found")
    # Access is checked before the claim is written, not after it.
    await auth.assert_site_access(user, head["site_id"])
    task = await db.fetch_one("SELECT * FROM pick_tasks WHERE id = %s", (task_id,))
    if task["status"] == "cancelled":
        raise HTTPException(409, "Pesanan ini dibatalkan. / This order was cancelled.")
    if task["status"] == "completed":
        raise HTTPException(409, "Pesanan ini sudah selesai diambil. / This order is already picked.")
    if task["status"] == "claimed":
        if task["claimed_by"] != user.email:
            raise HTTPException(
                409, f"{task['claimed_by']} sedang mengambil pesanan ini. / "
                     f"{task['claimed_by']} is picking this order.")
        return await _task_payload(task_id)
    if task["status"] != "ready":
        raise HTTPException(409, "Pesanan ini perlu supervisor. / This order needs a supervisor.")

    other = await assign.held_task(head["site_id"], user.email)
    if other:
        raise HTTPException(
            409, "Selesaikan dulu pesanan yang kamu pegang. / Finish the order you hold first.")
    n = await db.execute(
        "UPDATE pick_tasks SET status='claimed', claimed_by=%s, claimed_at=NOW(), "
        "started_at=NULL WHERE id = %s AND status = 'ready' AND claimed_by IS NULL",
        (user.email, task_id))
    if n != 1:
        raise HTTPException(409, "Pesanan ini baru saja diberikan ke orang lain. / "
                                 "This order was just given to someone else.")
    # Whoever takes an order by hand is picking now: ready, with this in hand,
    # so the assigner neither gives them a second order nor forgets them after.
    await assign.set_state(head["site_id"], user.email, "ready")
    await db.execute(
        "UPDATE picker_presence SET current_task_id = %s WHERE site_id = %s AND user_email = %s",
        (task_id, head["site_id"], user.email))
    return await _task_payload(task_id)


def _assert_holder(line: dict, user: auth.User) -> None:
    """Only the picker holding an order scans for it. An order that went back
    to the queue or to someone else is not yours any more, even with the screen
    still open."""
    status = line["task_status"]
    if status == "cancelled":
        raise HTTPException(409, "Pesanan ini sudah dibatalkan. / This order was cancelled.")
    if status == "completed":
        raise HTTPException(409, "Pesanan ini sudah selesai. / This order is already done.")
    if status != "claimed" or line["claimed_by"] != user.email:
        raise HTTPException(409, "Pesanan ini sudah dipindahkan. / This order was moved.")


async def _lock_and_start(cur, task_id: int, user: auth.User) -> None:
    """Inside the caller's transaction: lock the task, re-check the holder, and
    record the first scan. Raising here rolls the caller's work back."""
    task = await db.one(cur, "SELECT status, claimed_by, started_at FROM pick_tasks "
                             "WHERE id = %s FOR UPDATE", (task_id,))
    _assert_holder({"task_status": task["status"], "claimed_by": task["claimed_by"]}, user)
    if task["started_at"] is None:
        await db.run(cur, "UPDATE pick_tasks SET started_at = NOW() WHERE id = %s", (task_id,))


@router.post("/pick-tasks/{task_id}/basket", response_model=PickTaskV2)
async def scan_basket(task_id: int, body: BasketIn, user: auth.User = Depends(auth.current_user)):
    """Pindai label keranjang (board 6b): the picker takes an empty outbound
    basket and scans it. This starts the order (the 2-minute rule is met) and
    the basket belongs to the order until Selesai dikemas, or until a cancelled
    order's units are back on the rack. Only the holder. Scanning the order's
    own basket again (after Pindahkan) just starts it for the new holder."""
    head = await db.fetch_one("SELECT site_id FROM pick_tasks WHERE id = %s", (task_id,))
    if not head:
        raise HTTPException(404, "Pick task not found")
    site = await auth.assert_site_access(user, head["site_id"])
    try:
        code = await floor.check_basket(site, body.code)
    except ValueError as e:
        raise HTTPException(422, str(e))
    holder = await floor.basket_holder(site["id"], code, exclude_task_id=task_id)
    if holder:
        label = holder["hiryu_short_no"] or holder["external_ref"]
        raise HTTPException(409, f"Keranjang {code} masih berisi {label}. Ambil keranjang kosong. / "
                                 f"Basket {code} still holds {label}. Take an empty basket.")
    async with db.tx() as cur:
        task = await db.one(cur, "SELECT status, claimed_by, basket_code FROM pick_tasks "
                                 "WHERE id = %s FOR UPDATE", (task_id,))
        _assert_holder({"task_status": task["status"], "claimed_by": task["claimed_by"]}, user)
        if task["basket_code"] and task["basket_code"] != code:
            raise HTTPException(
                409, f"Pesanan ini sudah di keranjang {task['basket_code']}. / "
                     f"This order is already in basket {task['basket_code']}.")
        await _lock_and_start(cur, task_id, user)
        await db.run(cur, "UPDATE pick_tasks SET basket_code = %s, "
                          "basket_scanned_at = COALESCE(basket_scanned_at, NOW()), "
                          "basket_released_at = NULL WHERE id = %s", (code, task_id))
        await ledger.audit(cur, actor_email=user.email, entity="pick_tasks", entity_id=task_id,
                           action="pick_task.basket", after={"basket": code})
    return await _task_payload(task_id)


@router.get("/order-baskets", response_model=BasketList)
async def list_baskets(site_id: int, user: auth.User = Depends(auth.current_user)):
    """The hub's outbound baskets and the order in each (busy until packed)."""
    site = await auth.assert_site_access(user, site_id)
    codes = await floor.basket_codes(site_id)
    return {"site_id": site_id, "baskets": await floor.baskets(site_id, site["code"]),
            "from_special_bins": bool(codes)}


@router.post("/pick-tasks/{task_id}/start", response_model=models.Ok)
async def start_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    """The picker is working on this order without having scanned yet: the
    first bin was empty and they opened Barang tidak ada. That counts as
    starting, so the 2-minute rule does not pull the order away while they
    look elsewhere. Only the holder; a no-op once started."""
    head = await db.fetch_one("SELECT site_id FROM pick_tasks WHERE id = %s", (task_id,))
    if not head:
        raise HTTPException(404, "Pick task not found")
    await auth.assert_site_access(user, head["site_id"])
    async with db.tx() as cur:
        await _lock_and_start(cur, task_id, user)
    return {"ok": True, "message": "Dimulai. / Started."}


@router.post("/pick-lines/{line_id}/confirm", response_model=models.PickConfirmResult)
async def confirm_pick(
    line_id: int,
    body: models.PickConfirmIn,
    user: auth.User = Depends(auth.current_user),
):
    """The shade-confusion gate. Shade 07 versus 08 is caught here and nowhere else.

    A wrong scan is blocking, with no staff-level override — an override that
    exists gets used, and then the gate has no value (M5.2.5, and E13 in §15).
    """
    replayed = await ledger.replay(body.idempotency_key, "pick_confirm")
    if replayed:
        return replayed

    line = await db.fetch_one(
        "SELECT pl.*, pt.site_id, pt.status AS task_status, pt.claimed_by, pt.basket_code, "
        "       s.name_display, s.identity_mode, ol.replacement_for_line_id "
        "FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "JOIN order_lines ol ON ol.id = pl.order_line_id "
        "JOIN skus s ON s.id = pl.sku_id WHERE pl.id = %s", (line_id,)
    )
    if not line:
        raise HTTPException(404, "Pick line not found")
    site = await auth.assert_site_access(user, line["site_id"])
    _assert_holder(line, user)
    if not line["basket_code"]:
        # Board 6b: the order starts with an empty basket, scanned first.
        raise HTTPException(409, "Pindai label keranjang dulu. / Scan the basket label first.")

    code = body.code.strip()
    # Any scan, right or wrong, shows the picker is at the rack: the order has
    # started, and the 2-minute rule must not take it away while they sort out
    # a wrong product. A no-op after the first scan.
    await db.execute(
        "UPDATE pick_tasks SET started_at = NOW() WHERE id = %s AND status = 'claimed' "
        "AND claimed_by = %s AND started_at IS NULL", (line["pick_task_id"], user.email))
    scanned_sku = await common.sku_by_barcode(code)
    plate = None

    if not scanned_sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            scanned_sku = await common.sku_by_id(plate["sku_id"])

    if not scanned_sku:
        return {"accepted": False, "outcome": "wrong_sku",
                "expected_sku_name": line["name_display"],
                "message": "Barcode tidak dikenal. Panggil supervisor. / Unknown barcode. Call the supervisor."}

    if scanned_sku["id"] != line["sku_id"]:
        return {
            "accepted": False, "outcome": "wrong_sku",
            "expected_sku_name": line["name_display"],
            "scanned_sku_name": scanned_sku["name_display"],
            "message": (
                f"Ini {scanned_sku['name_display']}. "
                f"Pesanan minta {line['name_display']}. "
                "Kembalikan dan ambil yang benar."
            ),
        }

    # Mode B plate checks: right product, but is this the right unit, here, now?
    if line["identity_mode"] == "unit_label":
        if not plate:
            return {"accepted": False, "outcome": "plate_error",
                    "expected_sku_name": line["name_display"],
                    "message": "Scan label Ninja pada barangnya, bukan barcode lain. / Scan the Ninja label on the item, not another barcode."}
        if plate["state"] != "in_stock":
            return {"accepted": False, "outcome": "plate_error",
                    "expected_sku_name": line["name_display"],
                    "message": f"Label ini statusnya {plate['state']}. Panggil supervisor."}
        if plate["location_id"] != line["location_id"]:
            return {"accepted": False, "outcome": "plate_error",
                    "expected_sku_name": line["name_display"],
                    "message": ("Label ini tercatat di keranjang lain "
                                f"({plate['location_code']}). Panggil supervisor.")}

    qty = 1 if line["identity_mode"] == "unit_label" else max(1, body.qty)
    remaining = line["qty_required"] - line["qty_picked"]
    if qty > remaining:
        qty = remaining
    if qty <= 0:
        raise HTTPException(409, "This line is already picked.")

    async with db.tx() as cur:
        # Still yours, and this scan starts the clock the 2-minute rule reads.
        # Locked, so the sweep cannot hand the order back mid-scan.
        await _lock_and_start(cur, line["pick_task_id"], user)
        await ledger.apply(
            cur, site_id=line["site_id"], sku_id=line["sku_id"],
            location_id=line["location_id"], qty_delta=-qty,
            movement_type="pick_out", actor_email=user.email,
            ref_type="pick_line", ref_id=line_id,
            plate_id=plate["id"] if plate else None,
            scan_source="plate" if plate else "scan",
            is_training=bool(site["is_training"]),
        )
        # Release only what THIS line reserved. Units picked beyond it (the
        # unreserved remainder) must not eat another order's reservation.
        await ledger.release(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                             location_id=line["location_id"],
                             qty=_release_for_pick(line, qty))
        if plate:
            await db.run(cur, "UPDATE unit_plates SET state='picked', "
                              "last_seen_at=NOW() WHERE id = %s", (plate["id"],))

        picked = line["qty_picked"] + qty
        done = picked >= line["qty_required"]
        await db.run(
            cur, "UPDATE pick_lines SET qty_picked=%s, status=%s WHERE id=%s",
            (picked, "picked" if done else "pending", line_id),
        )
        # An order line may have several pick lines (rack and overflow), so it
        # accumulates. MySQL applies SET left to right: `status` sees the new
        # qty_picked.
        await db.run(
            cur, "UPDATE order_lines SET qty_picked = qty_picked + %s, "
                 "status = IF(qty_picked >= qty_ordered, 'picked', status) WHERE id = %s",
            (qty, line["order_line_id"]),
        )
        # The replacement is in the basket: now Hiryu hears it (message 5,
        # replaced), once, and edits the order on Grab by itself.
        if line["replacement_for_line_id"]:
            await _replacement_done(cur, line["order_line_id"], site_training=bool(site["is_training"]),
                                    actor=user.email)

        nxt = await db.one(
            cur,
            "SELECT pl.*, s.name_display, s.photo_key, s.identity_mode, "
            "       l.code AS location_code, r.code AS rack_code, lv.level_no "
            "FROM pick_lines pl JOIN skus s ON s.id = pl.sku_id "
            "LEFT JOIN locations l ON l.id = pl.location_id "
            "LEFT JOIN levels lv ON lv.id = l.level_id "
            "LEFT JOIN racks r ON r.id = lv.rack_id "
            "WHERE pl.pick_task_id = %s AND pl.status = 'pending' AND pl.id <> %s "
            "ORDER BY pl.sequence_no LIMIT 1",
            (line["pick_task_id"], line_id if done else -1),
        )
        task_done = nxt is None and done

        result = {
            "accepted": True, "outcome": "picked",
            "expected_sku_name": line["name_display"],
            "scanned_sku_name": scanned_sku["name_display"],
            "qty_picked": picked, "line_complete": done, "task_complete": task_done,
            "next_line": ({
                "id": nxt["id"], "sequence_no": nxt["sequence_no"],
                "sku_id": nxt["sku_id"], "sku_name": nxt["name_display"],
                "photo_key": nxt["photo_key"], "location_id": nxt["location_id"],
                "location_code": nxt["location_code"], "rack_code": nxt["rack_code"],
                "level_no": nxt["level_no"], "qty_required": nxt["qty_required"],
                "qty_picked": nxt["qty_picked"], "status": nxt["status"],
                "identity_mode": nxt["identity_mode"],
            } if nxt else None),
            "message": ("Sudah diambil. / Picked." if done
                        else f"{picked} dari {line['qty_required']}. / {picked} of {line['qty_required']}."),
        }
        await ledger.remember(cur, body.idempotency_key, "pick_confirm", result)

    # Picking is the main thing that drains a pick face, so it is the natural
    # place to notice the face has run low. Outside the transaction: a
    # replenishment task is not worth failing a completed pick over.
    await replenish.evaluate(line["site_id"], line["sku_id"], user.email)
    return result


@router.post("/pick-tasks/{task_id}/complete", response_model=PickTaskV2)
async def complete_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    """Serahkan ke meja packing: the picker hands the basket to the pack bench.

    This is "Waiting to pack" (§6.11), not "ready": nothing goes to Hiryu from
    here any more. Message 4 (order_ready) is queued when the packer taps
    Selesai dikemas (routers/hiryu.py, `packed`). The picker is free the moment
    this commits and the WMS gives them the next order.
    """
    task = await db.fetch_one("SELECT * FROM pick_tasks WHERE id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Pick task not found")
    await auth.assert_site_access(user, task["site_id"])
    async with db.tx() as cur:
        # Locked and re-checked: a cancel from Hiryu may land at the same moment.
        task = await db.one(cur, "SELECT * FROM pick_tasks WHERE id = %s FOR UPDATE",
                            (task_id,))
        if task["status"] == "completed":
            raise HTTPException(409, "Pesanan ini sudah selesai. / This order is already done.")
        if task["status"] == "cancelled":
            raise HTTPException(409, "Pesanan ini dibatalkan. / This order was cancelled.")
        if (task["status"] == "claimed" and task["claimed_by"] != user.email
                and not user.at_least("supervisor")):
            raise HTTPException(
                409, "Pesanan ini sudah dipindahkan. / This order was moved.")
        open_lines = await db.one(
            cur, "SELECT COUNT(*) AS n FROM pick_lines WHERE pick_task_id = %s "
                 "AND qty_picked < qty_required AND status <> 'short'", (task_id,))
        if open_lines["n"]:
            raise HTTPException(
                409, "Masih ada barang yang belum diambil. / Items are still to be picked.")
        await db.run(cur, "UPDATE pick_tasks SET status='completed', completed_at=NOW(), "
                          "handed_to_pack_at=NOW() WHERE id=%s", (task_id,))
        await db.run(cur, "UPDATE orders SET status='picked' WHERE id=%s AND status <> 'cancelled'",
                     (task["order_id"],))
        # Only the units picked for THIS order leave. The whole site's picked
        # plates used to be marked shipped, including other orders' totes and
        # cancelled units waiting to go back on the shelf.
        await db.run(
            cur,
            "UPDATE unit_plates up "
            "JOIN stock_movements m ON m.plate_id = up.id AND m.ref_type = 'pick_line' "
            "JOIN pick_lines pl ON pl.id = m.ref_id "
            "SET up.state = 'shipped' "
            "WHERE pl.pick_task_id = %s AND up.state = 'picked'", (task_id,))
        await ledger.audit(cur, actor_email=user.email, entity="pick_tasks",
                           entity_id=task_id, action="pick_task.handed_to_pack", after={})

    # An empty note: whatever the phone last had to explain is now old news.
    await assign.free_picker(task["site_id"], task["claimed_by"] or user.email, task_id, note="")
    await assign.assign_site(task["site_id"])
    return await _task_payload(task_id)


# --- the supervisor's queue board -------------------------------------------

# Placeholders until ops confirms them against the Grab delivery promise. They
# are returned to the client rather than hardcoded in CSS so retuning them is a
# config change, not a redeploy of the frontend.
AGE_THRESHOLDS = {"ageing_seconds": 300, "late_seconds": 600}


def _urgency(remaining, window) -> str:
    """Late once the promise has passed; ageing in its final third."""
    if remaining is None:
        return "normal"
    if remaining <= 0:
        return "late"
    if window and remaining <= max(60, int(window) // 3):
        return "ageing"
    return "normal"


def _jakarta_day_start_utc() -> datetime:
    """UTC instant of the current Jakarta midnight.

    The 'done today' lane means today *at the station*, not today in UTC. The
    pods write UTC, so the window has to be converted rather than compared
    against UTC's own date — otherwise the lane empties at 07:00 local instead
    of midnight.
    """
    local_midnight = daycolor.local_now().replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return local_midnight.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/orders", response_model=OrderListV2)
async def list_orders(
    site_id: int,
    status: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: auth.User = Depends(auth.current_user),
):
    """Order history at a site, newest first, in one query.

    The queue board shows what is live; this is everything, cancelled and
    finished included, for a supervisor answering "what happened to order X".
    """
    await auth.assert_site_access(user, site_id)
    where, params = ["o.site_id = %s"], [site_id]
    if status:
        where.append("o.status = %s")
        params.append(status)
    if channel:
        where.append("o.channel = %s")
        params.append(channel)
    clause = " AND ".join(where)
    rows = await db.fetch_all(
        "SELECT o.id, o.external_ref, o.status, o.is_test, o.channel, o.delivery_mode, "
        "       o.created_at, o.placed_at, o.promised_at, o.hiryu_short_no, o.source, o.is_demo, "
        "       pt.id AS pick_task_id, pt.status AS pick_status, pt.claimed_by, "
        "       pt.completed_at, "
        "       (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id) AS line_count, "
        "       (SELECT COALESCE(SUM(ol.qty_ordered),0) FROM order_lines ol "
        "         WHERE ol.order_id = o.id) AS units, "
        "       (SELECT COALESCE(SUM(ol.qty_picked),0) FROM order_lines ol "
        "         WHERE ol.order_id = o.id) AS units_picked, "
        "       (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id "
        "         AND ol.status = 'short') AS short_lines, "
        "       TIMESTAMPDIFF(SECOND, NOW(), o.promised_at) AS remaining_seconds "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id "
        f"WHERE {clause} ORDER BY o.created_at DESC, o.id DESC LIMIT %s OFFSET %s",
        (*params, limit, offset),
    )
    total = await db.fetch_one(f"SELECT COUNT(*) AS n FROM orders o WHERE {clause}",
                               tuple(params))
    ts = lambda v: str(v) if v else None
    return {
        "orders": [{
            "order_id": r["id"], "external_ref": r["external_ref"], "status": r["status"],
            "short_no": r["hiryu_short_no"], "is_uji": (r["source"] or "") == "uji",
            "is_demo": bool(r["is_demo"]),
            "is_test": bool(r["is_test"]), "channel": r["channel"],
            "delivery_mode": r["delivery_mode"], "created_at": ts(r["created_at"]),
            "placed_at": ts(r["placed_at"]), "promised_at": ts(r["promised_at"]),
            "pick_task_id": r["pick_task_id"], "pick_status": r["pick_status"],
            "claimed_by": r["claimed_by"], "completed_at": ts(r["completed_at"]),
            "line_count": int(r["line_count"] or 0), "units": int(r["units"] or 0),
            "units_picked": int(r["units_picked"] or 0),
            "short_lines": int(r["short_lines"] or 0),
            "remaining_seconds": (int(r["remaining_seconds"])
                                  if r["remaining_seconds"] is not None else None),
        } for r in rows],
        "total": int(total["n"]),
    }


@router.get("/pick-tasks/board", response_model=QueueBoardV2)
async def queue_board(
    site_id: int, user: auth.User = Depends(auth.current_user)
):
    """Papan antrean (board 6j): waiting (Terjadwal and UJI included), being
    picked, waiting to pack, waiting for the driver, done today (handed over
    or cancelled today), the people on shift, and the tab badges.

    One aggregate query rather than the per-task fan-out `list_tasks` does: a
    board showing fifty cards would otherwise run a hundred round trips, and
    this is the screen most likely to be left open and refreshing all shift.
    """
    site = await auth.assert_site_access(user, site_id)
    day_start = _jakarta_day_start_utc()
    lead = await assign.rule("grab_ready_minutes", 10)
    pack_wait = 60 * await assign.rule("pack_wait_minutes", 3)

    rows = await db.fetch_all(
        "SELECT pt.id, pt.order_id, pt.status, pt.claimed_by, pt.claimed_at, "
        "       pt.completed_at, pt.created_at, pt.started_at, pt.handed_to_pack_at, "
        "       pt.reassign_note, pt.requeue_count, pt.basket_code, "
        "       o.external_ref, o.hiryu_short_no, o.is_test, o.status AS order_status, "
        "       o.channel, o.delivery_mode, o.promised_at, o.scheduled_at, o.placed_at, "
        "       o.marked_ready_at, o.handed_over_at, o.source, o.cancelled_at, o.cancel_reason, "
        "       o.is_demo, hs.store_name, COALESCE(op.chosen, op.suggested) AS pack_type, "
        "       (o.scheduled_at IS NOT NULL AND o.promised_at IS NOT NULL "
        "        AND o.promised_at > NOW() + INTERVAL %s MINUTE) AS scheduled_hold, "
        "       TIMESTAMPDIFF(SECOND, NOW(), o.promised_at) AS remaining_seconds, "
        "       TIMESTAMPDIFF(SECOND, pt.created_at, o.promised_at) AS window_seconds, "
        "       TIMESTAMPDIFF(SECOND, pt.created_at, NOW()) AS age_seconds, "
        "       TIMESTAMPDIFF(SECOND, pt.claimed_at, NOW()) AS held_seconds, "
        "       TIMESTAMPDIFF(SECOND, COALESCE(pt.handed_to_pack_at, pt.completed_at), NOW()) "
        "         AS pack_wait_seconds, "
        "       TIMESTAMPDIFF(SECOND, o.marked_ready_at, NOW()) AS driver_wait_seconds, "
        "       COUNT(DISTINCT pl.id) AS line_count, "
        "       COALESCE(SUM(pl.qty_required),0) AS total_units, "
        "       COALESCE(SUM(pl.qty_picked),0) AS picked_units, "
        "       COUNT(DISTINCT CASE WHEN ol.status='short' THEN ol.id END) AS short_lines, "
        "       GROUP_CONCAT(DISTINCT r.code SEPARATOR ',') AS racks, "
        "       u.name AS picker_name "
        "FROM pick_tasks pt "
        "JOIN orders o ON o.id = pt.order_id "
        "LEFT JOIN hiryu_stores hs ON hs.hiryu_store_no = o.hiryu_store_no "
        "LEFT JOIN order_packs op ON op.order_id = o.id "
        "LEFT JOIN pick_lines pl ON pl.pick_task_id = pt.id "
        "LEFT JOIN order_lines ol ON ol.id = pl.order_line_id "
        "LEFT JOIN locations l ON l.id = pl.location_id "
        "LEFT JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN racks r ON r.id = lv.rack_id "
        "LEFT JOIN users u ON u.email = pt.claimed_by "
        "WHERE pt.site_id = %s "
        "  AND ((pt.status IN ('ready','claimed','blocked') AND o.status <> 'cancelled') "
        # Picked and not yet with a driver: to pack, or packed and waiting.
        # Two days back at most, so orders from before the handover screen
        # existed (never handed over) do not sit on the board for ever.
        "       OR (pt.status = 'completed' AND o.status <> 'cancelled' "
        "           AND o.handed_over_at IS NULL AND pt.completed_at >= NOW() - INTERVAL 2 DAY) "
        # Done today means handed to the driver, or cancelled, since the
        # station's midnight.
        "       OR (o.handed_over_at IS NOT NULL AND o.handed_over_at >= %s) "
        "       OR (o.status = 'cancelled' AND o.cancelled_at >= %s)) "
        "GROUP BY pt.id, pt.order_id, pt.status, pt.claimed_by, pt.claimed_at, "
        "         pt.completed_at, pt.created_at, pt.started_at, pt.handed_to_pack_at, "
        "         pt.reassign_note, pt.requeue_count, pt.basket_code, o.external_ref, "
        "         o.hiryu_short_no, o.is_test, o.status, o.channel, o.delivery_mode, "
        "         o.promised_at, o.scheduled_at, o.placed_at, o.marked_ready_at, "
        "         o.handed_over_at, o.source, o.cancelled_at, o.cancel_reason, o.is_demo, "
        "         hs.store_name, "
        "         op.chosen, op.suggested, u.name "
        "ORDER BY pt.created_at",
        (lead, site_id, day_start, day_start),
    )

    ts = lambda v: str(v) if v else None
    num = lambda v: int(v) if v is not None else None

    def card(r: dict) -> dict:
        racks = sorted({c for c in (r["racks"] or "").split(",") if c})
        cancelled = r["order_status"] == "cancelled"
        wait = None
        if not cancelled and r["status"] == "completed" and not r["marked_ready_at"]:
            wait = num(r["pack_wait_seconds"])
        elif not cancelled and r["marked_ready_at"] and not r["handed_over_at"]:
            wait = num(r["driver_wait_seconds"])
        pack = r["pack_type"]
        return {
            "id": r["id"], "order_id": r["order_id"],
            "external_ref": r["external_ref"], "short_no": r.get("hiryu_short_no"),
            "status": r["status"], "order_status": r["order_status"],
            "is_test": bool(r["is_test"]),
            "is_uji": (r["source"] or "") == "uji",
            "is_demo": bool(r["is_demo"]),
            "created_at": str(r["created_at"]),
            "claimed_at": ts(r["claimed_at"]),
            "completed_at": ts(r["completed_at"]),
            "started_at": ts(r["started_at"]),
            "handed_to_pack_at": ts(r["handed_to_pack_at"]),
            "packed_at": ts(r["marked_ready_at"]),
            "handed_over_at": ts(r["handed_over_at"]),
            "cancelled_at": ts(r["cancelled_at"]),
            "cancel_reason": r["cancel_reason"],
            "scheduled_at": ts(r["scheduled_at"]),
            "scheduled_hold": bool(r["scheduled_hold"]),
            "order_time": ts(r["placed_at"]),
            "waiting_seconds": wait,
            "pack_wait_amber": bool(wait is not None and r["status"] == "completed"
                                    and not r["marked_ready_at"] and wait >= pack_wait),
            "age_seconds": int(r["age_seconds"] or 0),
            "held_seconds": num(r["held_seconds"]),
            "claimed_by": r["claimed_by"], "claimed_by_name": r["picker_name"],
            "line_count": int(r["line_count"] or 0),
            "total_units": int(r["total_units"] or 0),
            "picked_units": int(r["picked_units"] or 0),
            "short_lines": int(r["short_lines"] or 0),
            "racks": racks,
            "channel": r["channel"] or "grab",
            "delivery_mode": r["delivery_mode"] or "grab_rider",
            "promised_at": ts(r["promised_at"]),
            "remaining_seconds": num(r["remaining_seconds"]),
            "urgency": _urgency(r["remaining_seconds"], r["window_seconds"]),
            "reassign_note": r["reassign_note"],
            "requeue_count": int(r["requeue_count"] or 0),
            "basket_code": r["basket_code"],
            "store_name": r["store_name"],
            "pack_type": pack,
            "pack_name": floor.PACK_NAMES.get(pack) if pack else None,
        }

    cards = [card(r) for r in rows]
    live = [c for c in cards if c["order_status"] != "cancelled"]
    by_left = lambda c: (c["remaining_seconds"] if c["remaining_seconds"] is not None else 10**9)
    waiting = [c for c in live if c["status"] in ("ready", "blocked")]
    lanes_def = (
        # Waiting orders are worked in order of time remaining, not age: with a
        # 10-minute Grab promise and a 1-hour own-channel promise in one room,
        # age would rank a comfortable order level with a late one. Terjadwal
        # (scheduled, not due yet) comes after everything the pickers can have.
        ("waiting", sorted(waiting, key=lambda c: (c["scheduled_hold"], by_left(c)))),
        ("picking", sorted([c for c in live if c["status"] == "claimed"],
                           key=lambda c: -(c["held_seconds"] or 0))),
        ("to_pack", sorted([c for c in live if c["status"] == "completed"
                            and not c["packed_at"] and not c["handed_over_at"]],
                           key=lambda c: c["handed_to_pack_at"] or c["completed_at"] or "")),
        ("to_driver", sorted([c for c in live if c["packed_at"] and not c["handed_over_at"]],
                             key=lambda c: c["packed_at"] or "")),
        ("done_today", sorted([c for c in cards if c["handed_over_at"]
                               or c["order_status"] == "cancelled"],
                              key=lambda c: c["handed_over_at"] or c["cancelled_at"] or "",
                              reverse=True)),
    )
    lanes = [{"key": k, "count": len(m), "cards": m} for k, m in lanes_def]
    counts = {k: len(m) for k, m in lanes_def}

    returns_open = await db.fetch_one(
        "SELECT COUNT(DISTINCT COALESCE(order_id, -id)) AS n FROM return_tasks "
        "WHERE site_id = %s AND status = 'open'", (site_id,))

    live_waiting = [c["age_seconds"] for c in waiting if not c["scheduled_hold"]]
    thresholds = dict(AGE_THRESHOLDS)
    thresholds["pick_start_seconds"] = 60 * await assign.rule("pick_start_minutes", 2)
    thresholds["handover_wait_seconds"] = 60 * await assign.rule("handover_wait_minutes", 20)
    thresholds["pack_wait_seconds"] = pack_wait
    thresholds["grab_ready_seconds"] = 60 * lead
    return {
        "site_id": site_id, "site_code": site["code"],
        # The board renders live clocks; it must tick against the server, not a
        # station laptop whose clock nobody has ever checked.
        "server_time": str(datetime.now(timezone.utc)),
        "lanes": lanes,
        "oldest_waiting_seconds": max(live_waiting) if live_waiting else None,
        "thresholds": thresholds,
        "pickers": await assign.picker_rows(site_id),
        "link_live": bool(await assign.rule("hiryu_link_live", 0)),
        "tab_counts": {"kemas": counts["to_pack"], "serah": counts["to_driver"],
                       "kembalikan": int(returns_open["n"] or 0)},
        "move_reasons": MOVE_REASONS,
        "can_create_test": user.at_least("supervisor"),
    }


@router.post("/pick-tasks/{task_id}/release", response_model=PickTaskV2)
async def release_task(
    task_id: int,
    body: models.ReleaseIn,
    user: auth.User = Depends(auth.current_user),
):
    """Hand a held order back to the queue.

    Anyone may release their own; releasing someone else's needs supervisor,
    because it takes work off a colleague who may simply be walking back from
    the far rack. The order is given out again at once (§6.2), to the free
    picker waiting longest. The SPV's usual tool is Pindahkan (`reassign`),
    which names who gets it.

    Lines already picked keep their progress — the stock has physically moved
    and the ledger says so. The next picker resumes at the first pending line
    rather than starting the order again.
    """
    task = await db.fetch_one("SELECT * FROM pick_tasks WHERE id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Pick task not found")
    await auth.assert_site_access(user, task["site_id"])
    async with db.tx() as cur:
        task = await db.one(
            cur, "SELECT * FROM pick_tasks WHERE id = %s FOR UPDATE", (task_id,)
        )
        if task["status"] == "completed":
            raise HTTPException(409, "Pesanan ini sudah selesai. / This order is already done.")
        if task["status"] != "claimed":
            raise HTTPException(409, "Pesanan ini belum dipegang siapa pun. / Nobody holds this order.")
        if task["claimed_by"] != user.email and not user.at_least("supervisor"):
            raise HTTPException(
                403,
                f"{task['claimed_by']} sedang mengambil pesanan ini. "
                "Minta supervisor untuk melepaskannya. / "
                f"{task['claimed_by']} is picking this order. Ask a supervisor.",
            )

        await db.run(
            cur,
            "UPDATE pick_tasks SET status='ready', claimed_by=NULL, claimed_at=NULL, "
            "started_at=NULL, reassign_note=%s WHERE id = %s",
            ((body.reason or "released")[:255], task_id),
        )
        await ledger.audit(cur, actor_email=user.email, entity="pick_tasks",
                           entity_id=task_id, action="pick_task.release",
                           after={"from": task["claimed_by"],
                                  "reason": body.reason or "no reason given"})

    label = await assign.order_label(task_id)
    await assign.free_picker(task["site_id"], task["claimed_by"], task_id, note=(
        "" if task["claimed_by"] == user.email else
        f"{label} dilepas ke antrean oleh SPV. / {label} was released to the queue by the SPV."))
    await assign.assign_site(task["site_id"])
    return await _task_payload(task_id)


@router.post("/pick-tasks/{task_id}/reassign", response_model=models.ReassignResult)
async def reassign_task(
    task_id: int,
    body: models.ReassignIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Pindahkan (§6.2 step 6): the SPV moves an order to another picker, with a
    reason. Named picker, or the free picker waiting longest. Audited with who
    had it, who has it now and why."""
    task = await db.fetch_one("SELECT site_id FROM pick_tasks WHERE id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Pesanan tidak ditemukan. / Order not found.")
    await auth.assert_site_access(user, task["site_id"])
    if body.to_email:
        target = await db.fetch_one(
            "SELECT u.id, u.role FROM users u WHERE LOWER(u.email) = %s AND u.active = 1",
            (body.to_email.strip().lower(),))
        if not target:
            raise HTTPException(422, "Staf tidak ditemukan. / No such staff member.")
        if target["role"] not in ("hq", "superadmin"):
            member = await db.fetch_one(
                "SELECT 1 AS ok FROM user_sites WHERE user_id = %s AND site_id = %s",
                (target["id"], task["site_id"]))
            if not member:
                raise HTTPException(422, "Staf itu tidak terdaftar di dark store ini. / "
                                         "That person is not at this dark store.")
    try:
        moved = await assign.reassign(task_id, actor=user.email, reason=body.reason.strip(),
                                      to_email=body.to_email or None)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    label = await assign.order_label(task_id)
    return {"ok": True, "task_id": task_id, "from_email": moved["from"],
            "to_email": moved["to"],
            "message": f"{label} dipindahkan ke {moved['to']}. / {label} moved to {moved['to']}."}


# --- a missing item (boards 6d, 6e; contract v1.1 message 5) -------------------

async def _set_bin_to_found(cur, *, site_id: int, sku_id: int, location_id: int, found: int,
                            line_id: int, actor: str, training: bool) -> int | None:
    """The bin holds what the picker found: never more than recorded, never
    raised here (raising is a count's job). The bin goes on the next count.
    Returns the units written off, or None when nothing was recorded there."""
    bal = await db.one(
        cur, "SELECT qty_on_hand FROM inventory_balances "
             "WHERE site_id=%s AND sku_id=%s AND location_id=%s",
        (site_id, sku_id, location_id))
    on_hand = int(bal["qty_on_hand"]) if bal else 0
    write_off = max(0, on_hand - found)
    if write_off:
        await ledger.apply(
            cur, site_id=site_id, sku_id=sku_id, location_id=location_id,
            qty_delta=-write_off, movement_type="adjustment", actor_email=actor,
            reason_code="short_pick", ref_type="pick_line", ref_id=line_id,
            scan_source="manual", is_training=training)
    await floor.flag_bin(cur, site_id=site_id, location_id=location_id, sku_id=sku_id,
                         reason="short_pick", ref_type="pick_line", ref_id=line_id,
                         qty_before=on_hand, qty_found=found, actor=actor)
    return write_off if bal else None


async def _queue_item_short(cur, *, order: dict, order_line: dict, action: str,
                            units_found: int, training: bool, actor: str | None,
                            replace_sku: dict | None = None,
                            replace_units: int | None = None,
                            replace_hiryu_item_id: str | None = None,
                            pick_line_id: int | None = None) -> None:
    """Message 5 for one order line, once: the facts go on the line (V27
    oos_action and friends, which pos_sender builds message 5 from) and the
    outbox row carries the order line id. A UJI order's message never leaves."""
    if order_line.get("oos_action"):
        return
    replace_code = None
    if replace_sku:
        replace_code = (replace_sku.get("hiryu_sku_code") or replace_sku.get("brand_sku_code")
                        or "").strip().upper() or None
    await ledger.enqueue_pos_message(
        cur, message_type="order_short", site_id=order["site_id"],
        order_ref=order["external_ref"], sku_id=order_line["sku_id"],
        is_training=_suppressed(order, training),
        payload={
            "order_ref": order["external_ref"],
            "gm_number": order.get("hiryu_short_no"),
            "sku_id": order_line["sku_id"],
            "order_line_id": order_line["id"],
            "hiryu_item_id": order_line.get("hiryu_item_id"),
            "action": action,
            "units_wanted": int(order_line["qty_ordered"]),
            "units_found": int(units_found),
            "replace_hiryu_item_id": replace_hiryu_item_id if action == "replaced" else None,
            "replace_sku_code": replace_code if action == "replaced" else None,
            "replace_units": replace_units if action == "replaced" else None,
            "pick_line_id": pick_line_id,
        },
    )
    await floor.record_outcome(cur, order_line["id"], action=action,
                               units_wanted=int(order_line["qty_ordered"]),
                               units_found=int(units_found),
                               replace_sku_code=replace_code, replace_units=replace_units)


async def _replacement_done(cur, replacement_line_id: int, *, site_training: bool,
                            actor: str) -> None:
    """The replacement line is fully in the basket: message 5 `replaced` for the
    line it replaces (board 6d: "Perubahan dikirim otomatis ke Hiryu dan Grab")."""
    rep = await db.one(
        cur, "SELECT ol.*, s.hiryu_sku_code, s.brand_sku_code FROM order_lines ol "
             "JOIN skus s ON s.id = ol.sku_id WHERE ol.id = %s", (replacement_line_id,))
    if not rep or not rep["replacement_for_line_id"] or rep["qty_picked"] < rep["qty_ordered"]:
        return
    orig = await db.one(cur, "SELECT * FROM order_lines WHERE id = %s FOR UPDATE",
                        (rep["replacement_for_line_id"],))
    if not orig or orig.get("oos_action"):
        return
    order = await db.one(cur, "SELECT * FROM orders WHERE id = %s", (orig["order_id"],))
    instr = await floor.instruction(orig["id"])
    await _queue_item_short(
        cur, order=order, order_line=orig, action="replaced",
        units_found=int(orig["qty_picked"]), training=site_training, actor=actor,
        replace_sku=rep, replace_units=int(rep["qty_picked"]),
        replace_hiryu_item_id=instr.get("replace_hiryu_item_id") or rep.get("hiryu_item_id"))
    await db.run(cur, "UPDATE pick_shortfalls SET action = 'replaced' "
                      "WHERE order_line_id = %s", (orig["id"],))
    await ledger.audit(cur, actor_email=actor, entity="order", entity_id=orig["order_id"],
                       action="order.line_replaced",
                       after={"order_line_id": orig["id"], "replacement_line_id": rep["id"],
                              "units": int(rep["qty_picked"])})


@router.get("/pick-lines/{line_id}/instruction", response_model=OosInstruction)
async def line_instruction(line_id: int, user: auth.User = Depends(auth.current_user)):
    """The customer's out-of-stock choice for this line (board 6d), with the
    replacement's name and bin, before the picker declares it."""
    line = await db.fetch_one(
        "SELECT pl.order_line_id, pt.site_id, o.brand_id, ol.replacement_for_line_id "
        "FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "JOIN orders o ON o.id = pt.order_id JOIN order_lines ol ON ol.id = pl.order_line_id "
        "WHERE pl.id = %s", (line_id,))
    if not line:
        raise HTTPException(404, "Pick line not found")
    await auth.assert_site_access(user, line["site_id"])
    if line["replacement_for_line_id"]:
        # A missing replacement always cancels the order.
        return {"type": None, "effective": "cancel_order"}
    return await _describe_instruction(await floor.instruction(line["order_line_id"]),
                                       line["site_id"], line["brand_id"])


async def _describe_instruction(instr: dict, site_id: int, brand_id: int | None) -> dict:
    out = {"type": instr["type"], "effective": instr["effective"],
           "replace_sku_code": instr.get("replace_sku_code"),
           "replace_units": instr.get("replace_units")}
    if instr["effective"] == "replace":
        sku = await floor.replacement_sku(instr, brand_id)
        if sku:
            out["replace_sku_id"] = sku["id"]
            out["replace_sku_name"] = sku["name_display"]
            loc = await common.pick_location_for(site_id, sku["id"])
            if loc:
                out["replace_location_code"] = floor.short_bin(loc["location_code"])
                pos = await db.fetch_one("SELECT position_no FROM locations WHERE id = %s",
                                         (loc["location_id"],))
                out["replace_location_words"] = floor.bin_words(
                    loc["rack_code"], loc["level_no"], pos["position_no"] if pos else None)
    return out


@router.post("/pick-lines/{line_id}/short", response_model=ShortPickV2Result)
async def declare_short(
    line_id: int,
    body: ShortPickV2In,
    user: auth.User = Depends(auth.current_user),
):
    """Barang tidak ada (board 6d). The picker looked in the bin and in every
    other place the WMS listed (/elsewhere) and says how many were there.

      1. Every bin checked holds what the picker found (an unsigned write-off,
         decided 30 Sep) and goes on the next count (bin_count_flags); Hiryu
         hears the new stock (message 3) from the ledger.
      2. The WMS follows the customer's instruction from message 1:
         * replace: the line keeps what was found, and the replacement SKU and
           units are added as a pick line at its bin, next in the walk. Message
           5 `replaced` is queued when the replacement is in the basket;
         * remove: the line keeps what was found, message 5 `removed`, go on;
         * cancel_order, contact_customer or no instruction, an unknown
           replacement, or a replacement that is itself missing: message 5
           `cancel_order` and the whole order is cancelled here and now (holds
           released, units already picked to Kembalikan ke rak). Hiryu then
           cancels with 2001 and its message 2 finds it already cancelled.
      3. pick_shortfalls names the picker and keeps what was done, for the SPV
         (Perlu tindakan).

    Found units stay in the order when it goes on (they are scanned as usual);
    when it is cancelled they stay in the bin.
    """
    line = await db.fetch_one(
        "SELECT pl.*, pt.site_id, pt.status AS task_status, pt.claimed_by, "
        "       o.id AS order_id, o.external_ref, o.hiryu_short_no, o.is_test, o.source, "
        "       o.brand_id, ol.qty_ordered, ol.qty_picked AS line_qty_picked, "
        "       ol.replacement_for_line_id, s.name_display "
        "FROM pick_lines pl "
        "JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "JOIN order_lines ol ON ol.id = pl.order_line_id "
        "JOIN orders o ON o.id = ol.order_id "
        "JOIN skus s ON s.id = pl.sku_id "
        "WHERE pl.id = %s",
        (line_id,),
    )
    if not line:
        raise HTTPException(404, "Pick line not found")
    await auth.assert_site_access(user, line["site_id"])
    if line["status"] in ("picked", "short"):
        raise HTTPException(409, "Baris ini sudah ditutup. / This line is already closed.")
    _assert_holder(line, user)

    required = line["qty_required"] - line["qty_picked"]
    found = max(0, min(body.qty_found, required))
    if found >= required:
        raise HTTPException(422, "Kalau barangnya lengkap, pindai seperti biasa. / "
                                 "If it is all there, scan it as usual.")
    missing = required - found
    label = line["hiryu_short_no"] or line["external_ref"]
    site = await db.fetch_one(
        "SELECT is_training, site_type FROM sites WHERE id = %s", (line["site_id"],))
    training = bool(site["is_training"])

    # What the customer chose. A missing replacement cancels the order.
    if line["replacement_for_line_id"]:
        instr = {"type": None, "effective": "cancel_order"}
        reported_line_id = line["replacement_for_line_id"]
    else:
        instr = await floor.instruction(line["order_line_id"])
        reported_line_id = line["order_line_id"]
    action = instr["effective"]
    rsku, rparts_units = None, None
    if action == "replace":
        rsku = await floor.replacement_sku(instr, line["brand_id"])
        rparts_units = instr.get("replace_units")
        if (not rsku or not rparts_units
                or not await common.pick_locations_for(line["site_id"], rsku["id"])):
            # Unknown, or not stocked at this hub: treated as cancel (contract
            # v1.1). Ops HQ sees it in the audit and on pick_shortfalls.
            action = "cancel_order"

    zeroed: list[int] = []
    picked_back = 0
    async with db.tx() as cur:
        await _lock_and_start(cur, line["pick_task_id"], user)

        # 1. Every bin checked holds what was found, and goes on the next count.
        if line["location_id"]:
            await _set_bin_to_found(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                                    location_id=line["location_id"], found=found,
                                    line_id=line_id, actor=user.email, training=training)
            zeroed.append(line["location_id"])
        for c in body.checked:
            if c.location_id in zeroed:
                continue
            loc = await db.one(cur, "SELECT id FROM locations WHERE id = %s AND site_id = %s",
                               (c.location_id, line["site_id"]))
            if not loc:
                continue
            await _set_bin_to_found(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                                    location_id=c.location_id, found=c.qty_found,
                                    line_id=line_id, actor=user.email, training=training)
            zeroed.append(c.location_id)

        order = await db.one(
            cur, "SELECT o.*, s.is_training FROM orders o JOIN sites s ON s.id = o.site_id "
                 "WHERE o.id = %s FOR UPDATE", (line["order_id"],))
        reported = await db.one(cur, "SELECT * FROM order_lines WHERE id = %s FOR UPDATE",
                                (reported_line_id,))
        # Units of the reported line that stay in the order: picked already,
        # found now, and any other part of it still to pick (rack + overflow).
        others = await db.one(
            cur, "SELECT COALESCE(SUM(qty_required - qty_picked),0) AS n FROM pick_lines "
                 "WHERE order_line_id = %s AND id <> %s AND status = 'pending'",
            (reported_line_id, line_id))
        if line["replacement_for_line_id"]:
            units_found = int(reported["qty_picked"])
        else:
            units_found = int(line["line_qty_picked"] or 0) + found + int(others["n"] or 0)

        await db.run(
            cur,
            "INSERT INTO pick_shortfalls (pick_line_id, site_id, sku_id, qty_required, "
            "qty_found, declared_by, order_line_id, action, instruction, replace_sku_id, "
            "replace_units) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE qty_found = VALUES(qty_found), action = VALUES(action)",
            (line_id, line["site_id"], line["sku_id"], required, found, user.email,
             reported_line_id, "replace" if action == "replace" else action,
             instr.get("type"), rsku["id"] if rsku and action == "replace" else None,
             rparts_units if action == "replace" else None))

        if action == "cancel_order":
            await db.run(cur, "UPDATE pick_lines SET status = 'short' WHERE id = %s", (line_id,))
            await db.run(cur, "UPDATE order_lines SET status = 'short' WHERE id = %s",
                         (line["order_line_id"],))
            await _queue_item_short(cur, order=order, order_line=reported, action="cancel_order",
                                    units_found=units_found, training=training, actor=user.email,
                                    pick_line_id=line_id)
            await db.run(cur, "UPDATE orders SET cancel_reason = COALESCE(cancel_reason, %s) "
                              "WHERE id = %s",
                         ("Barang tidak ada, pelanggan memilih batal" if instr.get("type")
                          in ("cancel_order", "contact_customer")
                          else "Barang tidak ada, pengganti juga tidak ada"
                          if line["replacement_for_line_id"]
                          else "Barang tidak ada", order["id"]))
            picked_back = await _cancel_locked(cur, order, actor=user.email, reason="item_short")
        else:
            # The line keeps what was found; the rest of its hold goes back.
            outstanding = _outstanding_allocation(line)
            new_required = line["qty_picked"] + found
            new_alloc = min(int(line.get("qty_allocated") or 0), new_required)
            still_held = max(0, new_alloc - min(line["qty_picked"], new_alloc))
            if line["location_id"] and outstanding > still_held:
                await ledger.release(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                                     location_id=line["location_id"],
                                     qty=outstanding - still_held)
            await db.run(
                cur, "UPDATE pick_lines SET qty_required = %s, qty_allocated = %s, "
                     "status = %s WHERE id = %s",
                (new_required, new_alloc,
                 "pending" if found > 0 else ("picked" if line["qty_picked"] else "short"),
                 line_id))
            await db.run(cur, "UPDATE order_lines SET status = 'short' WHERE id = %s",
                         (line["order_line_id"],))

            if action == "remove":
                await _queue_item_short(cur, order=order, order_line=reported, action="removed",
                                        units_found=units_found, training=training,
                                        actor=user.email,
                                        pick_line_id=line_id)
            else:
                # Ganti dengan: the replacement goes next in the walk.
                parts, allocated = await _allocate_parts(cur, line["site_id"], rsku["id"],
                                                         rparts_units)
                rep_line_id = await db.run(
                    cur,
                    "INSERT INTO order_lines (order_id, sku_id, qty_ordered, qty_allocated, "
                    "status, replacement_for_line_id, hiryu_item_id, hiryu_sku_code) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (order["id"], rsku["id"], rparts_units, allocated,
                     "allocated" if allocated >= rparts_units else "short",
                     line["order_line_id"], instr.get("replace_hiryu_item_id"),
                     (rsku.get("hiryu_sku_code") or rsku.get("brand_sku_code") or "").upper()
                     or None))
                await db.run(
                    cur, "UPDATE pick_lines SET sequence_no = sequence_no + %s "
                         "WHERE pick_task_id = %s AND sequence_no > %s",
                    (len(parts), line["pick_task_id"], line["sequence_no"]))
                for i, part in enumerate(parts, start=1):
                    await db.run(
                        cur,
                        "INSERT INTO pick_lines (pick_task_id, order_line_id, sku_id, "
                        "location_id, sequence_no, qty_required, qty_allocated) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
                        (line["pick_task_id"], rep_line_id, rsku["id"],
                         part["loc"]["location_id"] if part["loc"] else None,
                         line["sequence_no"] + i, part["required"], part["allocated"]))
            await ledger.audit(cur, actor_email=user.email, entity="order", entity_id=order["id"],
                               action="order.item_short",
                               after={"order_line_id": line["order_line_id"], "action": action,
                                      "found": found, "missing": missing,
                                      "replace_sku_id": rsku["id"] if rsku else None})

    cancelled = action == "cancel_order"
    if cancelled:
        # The picker saw it on their own screen; they now put the basket back.
        await assign.free_picker(line["site_id"], user.email, line["pick_task_id"], note="")
        await assign.assign_site(line["site_id"])
    await replenish.evaluate(line["site_id"], line["sku_id"], user.email)

    codes = []
    if zeroed:
        rows = await db.fetch_all(
            f"SELECT id, code FROM locations WHERE id IN ({db.placeholders(zeroed)})", zeroed)
        names = {r["id"]: floor.short_bin(r["code"]) for r in rows}
        codes = [names[z] for z in zeroed if z in names]

    described = (await _describe_instruction(instr, line["site_id"], line["brand_id"])
                 if not line["replacement_for_line_id"] else
                 {"type": None, "effective": "cancel_order"})
    task = await _task_payload(line["pick_task_id"])
    remaining = sum(1 for l in task["lines"] if l["status"] == "pending")
    if cancelled:
        message = (
            f"{label} dibatalkan. Kembalikan {picked_back} unit dari keranjang ke rak. / "
            f"{label} cancelled. Return {picked_back} unit(s) from the basket to the rack."
            if picked_back else
            f"{label} dibatalkan. Tunggu pesanan berikutnya. / "
            f"{label} cancelled. Wait for the next order.")
    elif action == "remove":
        message = ("Dihapus dari pesanan. Perubahan dikirim otomatis ke Hiryu dan Grab. / "
                   "Removed from the order. The change goes to Hiryu and Grab by itself.")
    else:
        message = (f"Ambil pengganti: {rsku['name_display']} ({rparts_units} unit). / "
                   f"Pick the replacement: {rsku['name_display']} ({rparts_units} unit(s)).")
    return {
        "accepted": True,
        "qty_found": found,
        "qty_missing": missing,
        "task_complete": cancelled,
        "lines_remaining": 0 if cancelled else remaining,
        "order_cancelled": cancelled,
        "units_to_return": picked_back,
        "link_live": bool(await assign.rule("hiryu_link_live", 0)),
        "action": "cancel_order" if cancelled else ("removed" if action == "remove" else "replaced"),
        "instruction": described,
        "bins_zeroed": codes,
        "task": task,
        "message": message,
    }


@router.post("/orders/{external_ref}/cancel", response_model=models.Ok)
async def cancel_order_http(external_ref: str, caller: str = Depends(hiryu_or_admin)):
    """Message 2 -- Hiryu tells us the order is cancelled.

    Only Hiryu sends this, for the same reason only Hiryu sends message 1: the
    order lives in Hiryu, and a cancel made anywhere else would leave Hiryu
    promising a customer something the WMS has already dropped.
    """
    return await cancel_order(external_ref, actor=caller)


async def _cancel_locked(cur, order: dict, *, actor: str | None, reason: str | None) -> int:
    """Cancel an order whose row the caller has locked. Returns units queued to
    go back on the shelf.

    Allocated-but-unpicked units are released on the spot, so the stock is
    sellable again at once (and message 3 tells Hiryu). Picked units are in a
    basket or a packed bag, not on a shelf, so they become return-to-shelf
    tasks and re-enter the ledger only when someone scans each one back.
    """
    lines = await db.many(
        cur,
        "SELECT pl.id, pl.sku_id, pl.location_id, pl.qty_picked, "
        "       pl.qty_allocated FROM pick_lines pl "
        "JOIN order_lines ol ON ol.id = pl.order_line_id "
        "WHERE ol.order_id = %s",
        (order["id"],),
    )
    for l in lines:
        outstanding = _outstanding_allocation(l)
        if outstanding > 0 and l["location_id"]:
            await ledger.release(
                cur, site_id=order["site_id"], sku_id=l["sku_id"],
                location_id=l["location_id"], qty=outstanding,
            )
    # Nothing is held any more; zero it so nothing can release it twice.
    await db.run(
        cur,
        "UPDATE pick_lines pl JOIN order_lines ol ON ol.id = pl.order_line_id "
        "SET pl.qty_allocated = LEAST(COALESCE(pl.qty_allocated, 0), pl.qty_picked) "
        "WHERE ol.order_id = %s", (order["id"],))
    picked_back = await returns.create_for_cancel(cur, order=order, lines=lines)

    # The basket: empty means free at once. With units in it, it stays busy
    # until they are all back on the rack (returns.py frees it), and a picker
    # who held the order puts them back before the next order (board 6e).
    task = await db.one(cur, "SELECT id, status, claimed_by FROM pick_tasks WHERE order_id = %s "
                             "FOR UPDATE", (order["id"],))
    if task:
        if not picked_back:
            await db.run(cur, "UPDATE pick_tasks SET basket_released_at = NOW() "
                              "WHERE id = %s AND basket_released_at IS NULL", (task["id"],))
        elif task["status"] == "claimed" and task["claimed_by"]:
            await db.run(cur, "UPDATE pick_tasks SET return_by = %s WHERE id = %s",
                         (task["claimed_by"], task["id"]))

    await db.run(cur, "UPDATE orders SET status='cancelled', "
                      "cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP()), "
                      "cancelled_by = COALESCE(cancelled_by, %s) WHERE id=%s",
                 (actor, order["id"]))
    await db.run(cur, "UPDATE pick_tasks SET status='cancelled' WHERE order_id=%s",
                 (order["id"],))
    await ledger.audit(cur, actor_email=actor, entity="order", entity_id=order["id"],
                       action="order.cancel",
                       after={"reason": reason, "units_to_return": picked_back})
    return picked_back


async def cancel_order(external_ref: str, site_id: int | None = None,
                       actor: str | None = None, reason: str | None = None):
    """Cancel an order, from any state (§6.11, §8.4): message 2 from Hiryu, the
    SPV's Dibatalkan di Hiryu while paste is on, or the training simulator.

    The order row is locked, so a cancel racing Selesai dikemas or a missing
    item is applied once, in one order or the other. A picker holding the
    order is freed (their phone says why) and the WMS gives out the next order.
    A bag already handed to the driver has nothing left here to release.
    """
    head = await db.fetch_one(
        "SELECT id, site_id FROM orders WHERE external_ref = %s", (external_ref,))
    if not head or (site_id is not None and head["site_id"] != site_id):
        raise HTTPException(404, "Order not found")

    async with db.tx() as cur:
        order = await db.one(
            cur,
            "SELECT o.*, s.is_training FROM orders o JOIN sites s ON s.id = o.site_id "
            "WHERE o.id = %s FOR UPDATE", (head["id"],))
        if order["status"] == "cancelled":
            return {"ok": True, "message": "Sudah dibatalkan. / Already cancelled."}
        task = await db.one(
            cur, "SELECT id, status, claimed_by FROM pick_tasks WHERE order_id = %s",
            (order["id"],))
        if order.get("handed_over_at"):
            await db.run(cur, "UPDATE orders SET status='cancelled', "
                              "cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP()), "
                              "cancelled_by = COALESCE(cancelled_by, %s) WHERE id=%s",
                         (actor, order["id"]))
            await ledger.audit(cur, actor_email=actor, entity="order", entity_id=order["id"],
                               action="order.cancel_after_handover", after={"reason": reason})
            return {"ok": True, "message": "Sudah diserahkan ke driver: tidak ada yang "
                                           "dikembalikan ke rak. / Already with the driver: "
                                           "nothing to return to the shelf."}
        picked_back = await _cancel_locked(cur, order, actor=actor, reason=reason)

    if task and task["status"] == "claimed" and task["claimed_by"]:
        label = order.get("hiryu_short_no") or order["external_ref"]
        await assign.free_picker(order["site_id"], task["claimed_by"], task["id"], note=(
            f"{label} dibatalkan. Barang yang sudah diambil: Kembalikan ke rak. / "
            f"{label} was cancelled. Units already picked: return them to the shelf."
            if picked_back else
            f"{label} dibatalkan. / {label} was cancelled."))
    await assign.assign_site(order["site_id"])
    return {
        "ok": True,
        "message": (
            f"Dibatalkan. {picked_back} barang masuk daftar Kembalikan ke rak. / "
            f"Cancelled. {picked_back} picked unit(s) added to the return-to-shelf list."
            if picked_back else
            "Dibatalkan; belum ada yang diambil. / Cancelled; nothing was picked."
        ),
    }


# --- test orders, UJI (board 6j: Buat pesanan uji) ---------------------------

@router.post("/orders/test", response_model=TestOrderResult, status_code=201)
async def create_test_order(body: TestOrderIn,
                            user: auth.User = Depends(auth.require("supervisor"))):
    """Buat pesanan uji: a WMS-only order for training and rehearsal.

    It goes through the floor like any order (picker, basket, pack, handover)
    on real bins, but it is marked UJI (source 'uji', is_test 1): no message
    about it ever reaches Hiryu (outbox suppressed), and reports leave it out.
    Its units come back to the rack after the handover step (Kembalikan ke
    rak), or when it is cancelled. Not the same as agent L's demo orders,
    which do come in through the Hiryu handler.
    """
    site = await auth.assert_site_access(user, body.site_id)
    brand_id = None
    store_no = body.hiryu_store_no
    if store_no is not None:
        store = await db.fetch_one(
            "SELECT brand_id, site_id FROM hiryu_stores WHERE hiryu_store_no = %s", (store_no,))
        if not store or store["site_id"] != site["id"]:
            raise HTTPException(422, "Toko itu bukan di dark store ini. / That store is not at this dark store.")
        brand_id = store["brand_id"]

    if body.lines:
        picks = [(l.sku_id, l.units) for l in body.lines]
    else:
        # Products with free stock at this hub (of the store's brand).
        where = "WHERE ib.site_id = %s AND l.is_virtual = 0 AND sb.location_id IS NULL AND s.active = 1"
        params: list = [site["id"]]
        if brand_id:
            where += " AND s.brand_id = %s"
            params.append(brand_id)
        rows = await db.fetch_all(
            "SELECT s.id, s.brand_id, SUM(ib.qty_on_hand - ib.qty_allocated) AS free "
            "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
            f"JOIN locations l ON l.id = ib.location_id "
            f"LEFT JOIN special_bins sb ON sb.location_id = l.id {where} "
            "GROUP BY s.id, s.brand_id HAVING free > 0", params)
        if not rows:
            raise HTTPException(409, "Tidak ada stok untuk pesanan uji. / No stock for a test order.")
        if not brand_id:
            # One brand per order, like a Hiryu store.
            brand_id = random.choice(sorted({r["brand_id"] for r in rows}))
            rows = [r for r in rows if r["brand_id"] == brand_id]
        n = body.products or random.randint(3, 6)
        chosen = random.sample(rows, min(n, len(rows)))
        target = random.randint(10, 15)
        picks = []
        for i, r in enumerate(chosen):
            left = len(chosen) - i
            share = max(1, round((target - sum(u for _, u in picks)) / left))
            picks.append((r["id"], max(1, min(share, int(r["free"]), 6))))
        if store_no is None:
            st = await db.fetch_one(
                "SELECT hiryu_store_no FROM hiryu_stores WHERE site_id = %s AND brand_id = %s "
                "AND active = 1 ORDER BY hiryu_store_no LIMIT 1", (site["id"], brand_id))
            store_no = st["hiryu_store_no"] if st else None

    day_start = _jakarta_day_start_utc()
    seq = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM orders WHERE site_id = %s AND source = 'uji' "
        "AND created_at >= %s", (site["id"], day_start))
    label = f"UJI-{int(seq['n'] or 0) + 1:02d}"
    ref = (f"UJI-{site['code']}-{daycolor.local_now():%y%m%d}-{label[4:]}-"
           f"{secrets.token_hex(2)}")
    result = await receive_order(
        models.OrderIn(external_ref=ref, site_id=site["id"], is_test=True,
                       channel="grab", delivery_mode="grab_rider",
                       placed_at=_now().isoformat() + "Z",
                       lines=[models.OrderLineIn(sku_id=sid, quantity=u) for sid, u in picks]),
        source="uji", short_no=label, store_no=store_no, created_by=user.email)
    async with db.tx() as cur:
        await ledger.audit(cur, actor_email=user.email, entity="order",
                           entity_id=result["order_id"], action="order.test_created",
                           after={"label": label, "lines": len(picks)})
    return {"order_id": result["order_id"], "label": label,
            "pick_task_id": result["pick_task_id"], "products": len(picks),
            "units": sum(u for _, u in picks),
            "message": f"{label} dibuat. Tidak dikirim ke Hiryu dan Grab. / "
                       f"{label} created. Never sent to Hiryu or Grab."}


@router.post("/orders/{order_id}/test-cancel", response_model=models.Ok)
async def cancel_test_order(order_id: int,
                            user: auth.User = Depends(auth.require("supervisor"))):
    """Batalkan pesanan uji: only a UJI order can be cancelled from the WMS
    (a real order's cancel comes from Hiryu, message 2). Same path as any
    cancel: holds released, picked units to Kembalikan ke rak."""
    order = await db.fetch_one("SELECT id, site_id, external_ref, source FROM orders "
                               "WHERE id = %s", (order_id,))
    if not order:
        raise HTTPException(404, "Pesanan tidak ditemukan. / Order not found.")
    await auth.assert_site_access(user, order["site_id"])
    if (order["source"] or "") != "uji":
        raise HTTPException(409, "Hanya pesanan uji yang dibatalkan dari WMS. / "
                                 "Only a test order is cancelled from the WMS.")
    return await cancel_order(order["external_ref"], site_id=order["site_id"],
                              actor=user.email, reason="test_cancelled")


# Registered last: /pick-tasks/board must match before /pick-tasks/{task_id}.
@router.get("/pick-tasks/{task_id}", response_model=PickTaskV2)
async def get_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    """One order for the phone (boards 6b to 6f): lines with bins and the
    customer's instruction, basket, stopwatch, ready-by and the summary."""
    head = await db.fetch_one("SELECT site_id FROM pick_tasks WHERE id = %s", (task_id,))
    if not head:
        raise HTTPException(404, "Pick task not found")
    await auth.assert_site_access(user, head["site_id"])
    return await _task_payload(task_id)
