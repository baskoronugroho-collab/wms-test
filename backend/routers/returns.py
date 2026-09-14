"""Return to shelf — units from cancelled orders going back on the rack.

Canonical design: when Hiryu cancels (message 2) the WMS releases what was only
allocated, and anything already picked goes to return-to-shelf. A pick removed
those units from the ledger when they were scanned into the tote, so they come
back the same way: one scan per unit at the rack, each scan a `return_in`
movement. Every movement already triggers message 3, so Hiryu hears the stock
come back the moment it is really on the shelf, not before.

Anyone on shift can work this list. The scan is still verified: a unit that is
not the SKU on the task is refused, exactly like a wrong pick.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["returns"])

_SELECT = (
    "SELECT rt.*, s.name_display AS sku_name, s.brand_sku_code, "
    "       l.code AS location_code "
    "FROM return_tasks rt JOIN skus s ON s.id = rt.sku_id "
    "LEFT JOIN locations l ON l.id = rt.location_id "
)


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
    }


async def create_for_cancel(cur, *, order: dict, lines: list[dict]) -> int:
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
        location_id = l.get("location_id")
        if not location_id:
            slot = await common.slot_for(order["site_id"], l["sku_id"])
            location_id = slot["location_id"] if slot else None
        await db.run(
            cur,
            "INSERT INTO return_tasks (site_id, sku_id, order_id, external_ref, "
            "location_id, qty, reason, is_training) "
            "VALUES (%s,%s,%s,%s,%s,%s,'cancelled',%s)",
            (order["site_id"], l["sku_id"], order["id"], order["external_ref"],
             location_id, picked, 1 if order.get("is_training") else 0),
        )
        queued += picked
    return queued


@router.get("/returns", response_model=models.ReturnTaskList)
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


@router.post("/returns/{task_id}/scan", response_model=models.ReturnScanResult)
async def scan_return(
    task_id: int,
    body: models.ReturnScanIn,
    user: auth.User = Depends(auth.current_user),
):
    """One unit back on the shelf. Scan-verified, no override."""
    replayed = await ledger.replay(body.idempotency_key, "return_scan")
    if replayed:
        return replayed

    task = await db.fetch_one(_SELECT + "WHERE rt.id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Return task not found")
    site = await auth.assert_site_access(user, task["site_id"])
    if task["status"] != "open":
        raise HTTPException(409, "Sudah selesai dikembalikan. / Already returned.")
    if not task["location_id"]:
        raise HTTPException(
            409, "Barang ini belum punya rak. Panggil supervisor. / "
                 "This SKU has no rack yet. Call a supervisor.")

    code = body.code.strip()
    plate = None
    sku = await common.sku_by_barcode(code)
    if not sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            sku = {"id": plate["sku_id"]}
    if not sku:
        raise HTTPException(422, "Barcode tidak dikenal. / Unknown barcode.")
    if sku["id"] != task["sku_id"]:
        raise HTTPException(
            409, f"Salah barang. Yang dikembalikan: {task['sku_name']}. / "
                 f"Wrong item. This return is {task['sku_name']}.")
    if plate and plate["state"] != "picked":
        raise HTTPException(
            409, "Label ini tidak sedang di luar rak. / This label is not out of the rack.")

    async with db.tx() as cur:
        # Re-read under lock: two people scanning the same tote must not
        # return more units than the order took.
        locked = await db.one(
            cur, "SELECT qty, qty_returned, status FROM return_tasks "
                 "WHERE id = %s FOR UPDATE", (task_id,))
        if locked["status"] != "open" or locked["qty_returned"] >= locked["qty"]:
            raise HTTPException(409, "Sudah selesai dikembalikan. / Already returned.")

        await ledger.apply(
            cur, site_id=task["site_id"], sku_id=task["sku_id"],
            location_id=task["location_id"], qty_delta=1,
            movement_type="return_in", actor_email=user.email,
            ref_type="return_task", ref_id=task_id,
            plate_id=plate["id"] if plate else None,
            scan_source="plate" if plate else "scan",
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
        task.update(qty_returned=returned, status="done" if done else "open")
        result = {
            "ok": True, "task": _out(task), "done": done,
            "message": ("Selesai. Semua sudah kembali di rak. / Done. All back on the rack."
                        if done else
                        f"{returned} dari {locked['qty']}. / {returned} of {locked['qty']}."),
        }
        await ledger.remember(cur, body.idempotency_key, "return_scan", result)
    return result
