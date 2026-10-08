"""Return to shelf: units from cancelled orders going back on the rack.

Canonical design: when Hiryu cancels (message 2) the WMS releases what was only
allocated, and anything already picked goes to return-to-shelf. A pick removed
those units from the ledger when they were scanned into the tote, so they come
back the same way: one scan per unit at the rack, each scan a `return_in`
movement. Every movement already triggers message 3, so Hiryu hears the stock
come back the moment it is really on the shelf, not before.

Anyone on shift can work this list. The scan is still verified: a unit that is
not the SKU on the task is refused, exactly like a wrong pick. From deploy 3
(board 6k) the phone scans the unit, then the bin's label: the bin is checked
before the unit counts as back.

Reasons: cancelled (an order cancelled after picking), uji (a test order after
its handover step), driver_return (fine units from a cancelled parcel the
driver brought back).

Mode manual (V32): while the dark store's scanners are broken, the unit is
chosen by a tap in the list and the bin confirmed with "Sudah dikembalikan ke
bin X" (`scan` with manual, no code). Refused once Mode manual is off; the
movement and the audit are marked manual.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import assign
import auth
import common
import db
import floor
import ledger
import models
from routers import manual_mode

router = APIRouter(prefix="/api", tags=["returns"])

_SELECT = (
    "SELECT rt.*, s.name_display AS sku_name, s.brand_sku_code, s.photo_key, "
    "       l.code AS location_code, l.position_no, r.code AS rack_code, lv.level_no "
    "FROM return_tasks rt JOIN skus s ON s.id = rt.sku_id "
    "LEFT JOIN locations l ON l.id = rt.location_id "
    "LEFT JOIN levels lv ON lv.id = l.level_id "
    "LEFT JOIN racks r ON r.id = lv.rack_id "
)


class ReturnTaskV2(models.ReturnTask):
    order_id: int | None = None
    photo_key: str | None = None
    location_short: str | None = Field(default=None, description="A-3-05")
    location_words: str | None = Field(default=None, description="Rak A, level 3 dari bawah, bin ke-5")


class ReturnTaskListV2(models.ReturnTaskList):
    tasks: list[ReturnTaskV2]


class ReturnScanV2In(models.ReturnScanIn):
    code: str = Field(default="", max_length=64, description="The unit scanned; empty with manual")
    bin_code: str | None = Field(
        default=None, description="The bin label scanned after the unit (board 6k); checked "
                                  "against the task's bin before the unit counts")
    manual: bool = Field(default=False, description="Mode manual: the unit tapped in the list "
                                                    "and the bin confirmed by a tap")


class ReturnScanV2Result(models.ReturnScanResult):
    task: ReturnTaskV2
    basket_freed: str | None = Field(default=None, description="The basket now empty and free")


class UnitCheckIn(BaseModel):
    code: str


class UnitCheckResult(BaseModel):
    ok: bool
    sku_name: str
    location_code: str | None = None
    location_short: str | None = None
    location_words: str | None = None
    message: str


class ReturnGroup(BaseModel):
    order_id: int | None
    label: str | None = Field(description="GM-347, UJI-01, or None for a loose task")
    reason: str
    basket_code: str | None = None
    units: int
    units_returned: int
    tasks: list[ReturnTaskV2]


class ReturnGroupList(BaseModel):
    groups: list[ReturnGroup]
    open_units: int
    manual_mode: bool = Field(default=False, description="The dark store is in Mode manual now")


def _out(row: dict) -> dict:
    created = row.get("created_at")
    age = None
    if created is not None:
        # Naive DATETIMEs in this database are UTC (db.connect pins the session).
        age = int((datetime.now(timezone.utc)
                   - created.replace(tzinfo=timezone.utc)).total_seconds())
    return {
        "id": row["id"], "site_id": row["site_id"], "sku_id": row["sku_id"],
        "sku_name": row["sku_name"], "brand_sku_code": row.get("brand_sku_code"),
        "external_ref": row.get("external_ref"),
        "location_id": row.get("location_id"), "location_code": row.get("location_code"),
        "qty": row["qty"], "qty_returned": row["qty_returned"],
        "reason": row["reason"], "status": row["status"],
        "created_at": str(created) if created else None,
        "age_seconds": age,
        "order_id": row.get("order_id"),
        "photo_key": row.get("photo_key"),
        "location_short": floor.short_bin(row.get("location_code")),
        "location_words": floor.bin_words(row.get("rack_code"), row.get("level_no"),
                                          row.get("position_no"), code=row.get("location_code")),
    }


async def create_one(cur, *, order: dict, sku_id: int, location_id: int | None, qty: int,
                     reason: str) -> int:
    """One return-to-shelf task. Returns its id. Units go back to `location_id`,
    or to the SKU's rack when that is unknown."""
    if not location_id:
        slot = await common.slot_for(order["site_id"], sku_id)
        location_id = slot["location_id"] if slot else None
    return await db.run(
        cur,
        "INSERT INTO return_tasks (site_id, sku_id, order_id, external_ref, "
        "location_id, qty, reason, is_training) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (order["site_id"], sku_id, order["id"],
         order.get("hiryu_short_no") or order["external_ref"],
         location_id, qty, reason, 1 if order.get("is_training") else 0),
    )


async def create_for_cancel(cur, *, order: dict, lines: list[dict],
                            reason: str = "cancelled") -> int:
    """Queue every picked unit of a cancelled order for return. Returns units queued.

    Called inside the cancel transaction, so the order cannot end up cancelled
    with its picked units forgotten. Units go back where they were picked from;
    when that is unknown, to the SKU's rack.
    """
    queued = 0
    for l in lines:
        picked = int(l.get("qty_picked") or 0)
        if picked <= 0:
            continue
        await create_one(cur, order=order, sku_id=l["sku_id"],
                         location_id=l.get("location_id"), qty=picked, reason=reason)
        queued += picked
    return queued


@router.get("/returns", response_model=ReturnTaskListV2)
async def list_returns(
    site_id: int,
    status: str = Query(default="open", pattern="^(open|done|all)$"),
    limit: int = Query(default=100, ge=1, le=500),
    user: auth.User = Depends(auth.current_user),
):
    await auth.assert_site_access(user, site_id)
    where, params = "WHERE rt.site_id = %s", [site_id]
    if status != "all":
        where += " AND rt.status = %s"
        params.append(status)
    # Oldest first: a unit sitting in a tote is stock nobody can sell.
    rows = await db.fetch_all(
        _SELECT + where + " ORDER BY rt.created_at ASC, rt.id ASC LIMIT %s",
        (*params, limit),
    )
    open_count = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM return_tasks WHERE site_id = %s AND status = 'open'",
        (site_id,),
    )
    return {"tasks": [_out(r) for r in rows], "open_count": int(open_count["n"])}


@router.get("/returns/by-order", response_model=ReturnGroupList)
async def returns_by_order(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Kembalikan ke rak (boards 6e, 6k): open returns grouped per order, oldest
    first, with the basket they sit in: "6 unit dari GM-347 yang dibatalkan"."""
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        _SELECT + "WHERE rt.site_id = %s AND rt.status = 'open' "
                  "ORDER BY rt.created_at ASC, rt.order_id, rt.id ASC LIMIT 300", (site_id,))
    baskets = {}
    ids = sorted({r["order_id"] for r in rows if r["order_id"]})
    if ids:
        for b in await db.fetch_all(
                f"SELECT order_id, basket_code FROM pick_tasks WHERE order_id IN "
                f"({db.placeholders(ids)}) AND basket_released_at IS NULL", ids):
            baskets[b["order_id"]] = b["basket_code"]
    groups: dict = {}
    for r in rows:
        key = r["order_id"] or -r["id"]
        g = groups.setdefault(key, {
            "order_id": r["order_id"], "label": r["external_ref"], "reason": r["reason"],
            "basket_code": baskets.get(r["order_id"]), "units": 0, "units_returned": 0,
            "tasks": []})
        g["units"] += int(r["qty"])
        g["units_returned"] += int(r["qty_returned"])
        g["tasks"].append(_out(r))
    out = list(groups.values())
    return {"groups": out,
            "open_units": sum(g["units"] - g["units_returned"] for g in out),
            "manual_mode": await manual_mode.active(site_id)}


async def _unit_sku(code: str) -> tuple[dict | None, dict | None]:
    plate = None
    sku = await common.sku_by_barcode(code)
    if not sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            sku = {"id": plate["sku_id"]}
    return sku, plate


@router.post("/returns/{task_id}/check-unit", response_model=UnitCheckResult)
async def check_unit(task_id: int, body: UnitCheckIn,
                     user: auth.User = Depends(auth.current_user)):
    """Step 1 of board 6k: is this unit the one to return? Changes nothing;
    the unit counts as back when its bin is scanned (`scan` with bin_code)."""
    task = await db.fetch_one(_SELECT + "WHERE rt.id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Tugas kembalikan tidak ditemukan. / Put-back task not found.")
    await auth.assert_site_access(user, task["site_id"])
    sku, _ = await _unit_sku(body.code.strip())
    if not sku:
        raise HTTPException(422, "Barcode tidak dikenal. / Barcode not recognised.")
    if sku["id"] != task["sku_id"]:
        raise HTTPException(
            409, f"Salah barang. Yang dikembalikan: {task['sku_name']}. / "
                 f"Wrong item. This return is {task['sku_name']}.")
    return {"ok": True, "sku_name": task["sku_name"], "location_code": task["location_code"],
            "location_short": floor.short_bin(task["location_code"]),
            "location_words": floor.bin_words(task["rack_code"], task["level_no"],
                                              task["position_no"], code=task["location_code"]),
            "message": "Cocok. Taruh di bin, lalu pindai label bin. / "
                       "Match. Put it in the bin, then scan the bin label."}


async def _free_basket_if_empty(order_id: int | None, site_id: int) -> str | None:
    """A cancelled order's basket is free once all its units are back."""
    if not order_id:
        return None
    left = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM return_tasks WHERE order_id = %s AND status = 'open'",
        (order_id,))
    if left["n"]:
        return None
    task = await db.fetch_one(
        "SELECT pt.id, pt.basket_code FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "WHERE pt.order_id = %s AND o.status = 'cancelled' AND pt.basket_released_at IS NULL",
        (order_id,))
    if not task:
        return None
    n = await db.execute("UPDATE pick_tasks SET basket_released_at = NOW() "
                         "WHERE id = %s AND basket_released_at IS NULL", (task["id"],))
    if n:
        # The picker who was putting it back gets the next order now (6e).
        await assign.assign_site(site_id)
        return task["basket_code"]
    return None


@router.post("/returns/{task_id}/scan", response_model=ReturnScanV2Result)
async def scan_return(
    task_id: int,
    body: ReturnScanV2In,
    user: auth.User = Depends(auth.current_user),
):
    """One unit back on the shelf. Scan-verified, no override. With bin_code
    (board 6k) the bin label must be the task's bin. With manual (Mode manual,
    only while it is on) there is no code: the picker tapped the unit in the
    list and confirmed the bin by a tap (or scanned only the bin)."""
    replayed = await ledger.replay(body.idempotency_key, "return_scan")
    if replayed:
        return replayed

    task = await db.fetch_one(_SELECT + "WHERE rt.id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Tugas kembalikan tidak ditemukan. / Put-back task not found.")
    site = await auth.assert_site_access(user, task["site_id"])
    if task["status"] != "open":
        raise HTTPException(409, "Sudah selesai dikembalikan. / Already returned.")
    if not task["location_id"]:
        raise HTTPException(
            409, "Barang ini belum punya rak. Panggil SPV. / "
                 "This product has no rack yet. Call the SPV.")

    if body.bin_code is not None and not floor.bin_matches(body.bin_code, task["location_code"]):
        short = floor.short_bin(task["location_code"])
        raise HTTPException(409, f"Bin salah. Taruh di {short}, lalu pindai labelnya. / "
                                 f"Wrong bin. Put it in {short}, then scan its label.")

    manual = bool(body.manual)
    if manual and not await manual_mode.active(task["site_id"]):
        raise HTTPException(409, "Mode manual tidak aktif. Pindai barangnya. / "
                                 "Manual mode is off. Scan the item.")
    code = (body.code or "").strip()
    sku, plate = None, None
    if code:
        sku, plate = await _unit_sku(code)
        if not sku:
            raise HTTPException(422, "Barcode tidak dikenal. / Barcode not recognised.")
        if sku["id"] != task["sku_id"]:
            raise HTTPException(
                409, f"Salah barang. Yang dikembalikan: {task['sku_name']}. / "
                     f"Wrong item. This return is {task['sku_name']}.")
        if plate and plate["state"] != "picked":
            raise HTTPException(
                409, "Label ini tidak sedang di luar rak. / This label is not out of the rack.")
    elif not manual:
        raise HTTPException(422, "Pindai barangnya. / Scan the item.")

    async with db.tx() as cur:
        # Re-read under lock: two people scanning the same tote must not
        # return more units than the order took.
        locked = await db.one(
            cur, "SELECT qty, qty_returned, status FROM return_tasks "
                 "WHERE id = %s FOR UPDATE", (task_id,))
        if locked["status"] != "open" or locked["qty_returned"] >= locked["qty"]:
            raise HTTPException(409, "Sudah selesai dikembalikan. / Already returned.")
        if manual and not code and task.get("order_id"):
            # No label scanned: a Mode B unit of this order goes back with the
            # first of the order's labels still out of the rack (the oldest
            # pick first), so its label is on the rack again and can be picked.
            plate = await db.one(
                cur, "SELECT up.id, up.plate_code FROM unit_plates up "
                     "JOIN stock_movements m ON m.plate_id = up.id AND m.ref_type = 'pick_line' "
                     "JOIN pick_lines pl ON pl.id = m.ref_id "
                     "JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
                     "WHERE pt.order_id = %s AND up.sku_id = %s AND up.state = 'picked' "
                     "ORDER BY m.id LIMIT 1 FOR UPDATE", (task["order_id"], task["sku_id"]))

        await ledger.apply(
            cur, site_id=task["site_id"], sku_id=task["sku_id"],
            location_id=task["location_id"], qty_delta=1,
            movement_type="return_in", actor_email=user.email,
            ref_type="return_task", ref_id=task_id,
            plate_id=plate["id"] if plate else None,
            scan_source="manual" if manual else "plate" if plate else "scan",
            is_training=bool(site["is_training"]),
        )
        if plate:
            await db.run(
                cur, "UPDATE unit_plates SET state='in_stock', location_id=%s, "
                     "last_seen_at=NOW() WHERE id = %s",
                (task["location_id"], plate["id"]))

        returned = locked["qty_returned"] + 1
        done = returned >= locked["qty"]
        await db.run(
            cur,
            "UPDATE return_tasks SET qty_returned = %s, status = %s, "
            "done_at = " + ("NOW()" if done else "NULL") + ", done_by = %s WHERE id = %s",
            (returned, "done" if done else "open", user.email if done else None, task_id),
        )
        if manual:
            await ledger.audit(cur, actor_email=user.email, entity="return_tasks", entity_id=task_id,
                               action="return.scan",
                               after={"manual": True, "unit_tapped": not code,
                                      "bin_scanned": body.bin_code is not None,
                                      "plate": plate["plate_code"] if plate else None})
        task.update(qty_returned=returned, status="done" if done else "open")
        result = {
            "ok": True, "task": _out(task), "done": done,
            "message": ("Selesai. Semua sudah kembali di rak. / Done. All back on the rack."
                        if done else
                        f"{returned} dari {locked['qty']}. / {returned} of {locked['qty']}."),
        }
        await ledger.remember(cur, body.idempotency_key, "return_scan", result)
    if done:
        result["basket_freed"] = await _free_basket_if_empty(task.get("order_id"), task["site_id"])
    return result
