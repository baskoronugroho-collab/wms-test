"""M5 / §9 — Order intake from the POS, allocation, and guided picking."""
from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["outbound"])


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


@router.post("/pos/orders", response_model=models.OrderAccepted, status_code=201)
async def receive_order(body: models.OrderIn):
    """The POS creates an order here. The dummy generator uses the same endpoint,
    so switching to live Hiryu is configuration rather than a rewrite (§9.3).

    Deliberately unauthenticated at the user level — this is a machine-to-machine
    call. Once §9.1 is settled it is gated by POS_SHARED_SECRET.
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
    async with db.tx() as cur:
        order_id = await db.run(
            cur,
            "INSERT INTO orders (external_ref, site_id, brand_id, status, is_test) "
            "VALUES (%s,%s,%s,'received',%s)",
            (body.external_ref, site["id"], resolved[0][0]["brand_id"],
             1 if body.is_test else 0),
        )
        task_id = await db.run(
            cur, "INSERT INTO pick_tasks (order_id, site_id, status) "
                 "VALUES (%s,%s,'ready')", (order_id, site["id"]),
        )

        # Sequence by pick path — rack, then level, then position — so the
        # picker walks the aisle once in one direction (M5.2.1).
        seq_rows = []
        for sku, qty in resolved:
            slot = await common.slot_for(site["id"], sku["id"])
            seq_rows.append((sku, qty, slot))
        seq_rows.sort(key=lambda r: (
            r[2]["rack_code"] if r[2] else "zzz",
            r[2]["level_no"] if r[2] else 99,
            r[2]["location_code"] if r[2] else "",
        ))

        for i, (sku, qty, slot) in enumerate(seq_rows, start=1):
            allocated = 0
            if slot:
                allocated = await ledger.allocate(
                    cur, site_id=site["id"], sku_id=sku["id"],
                    location_id=slot["location_id"], qty=qty,
                )
            status = "allocated" if allocated >= qty else "short"
            if status == "short":
                short += 1
            line_id = await db.run(
                cur,
                "INSERT INTO order_lines (order_id, sku_id, qty_ordered, "
                "qty_allocated, status) VALUES (%s,%s,%s,%s,%s)",
                (order_id, sku["id"], qty, allocated, status),
            )
            await db.run(
                cur,
                "INSERT INTO pick_lines (pick_task_id, order_line_id, sku_id, "
                "location_id, sequence_no, qty_required) VALUES (%s,%s,%s,%s,%s,%s)",
                (task_id, line_id, sku["id"],
                 slot["location_id"] if slot else None, i, qty),
            )

    return {
        "order_id": order_id, "external_ref": body.external_ref,
        "pick_task_id": task_id, "status": "accepted", "short_lines": short,
        "message": (f"{short} line(s) could not be fully allocated."
                    if short else "Allocated in full."),
    }


async def _task_payload(task_id: int) -> dict:
    task = await db.fetch_one(
        "SELECT pt.*, o.external_ref, o.is_test FROM pick_tasks pt "
        "JOIN orders o ON o.id = pt.order_id WHERE pt.id = %s", (task_id,)
    )
    if not task:
        raise HTTPException(404, "Pick task not found")
    lines = await db.fetch_all(
        "SELECT pl.*, s.name_display, s.photo_key, s.identity_mode, "
        "       l.code AS location_code, r.code AS rack_code, lv.level_no "
        "FROM pick_lines pl JOIN skus s ON s.id = pl.sku_id "
        "LEFT JOIN locations l ON l.id = pl.location_id "
        "LEFT JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN racks r ON r.id = lv.rack_id "
        "WHERE pl.pick_task_id = %s ORDER BY pl.sequence_no", (task_id,)
    )
    return {
        "id": task["id"], "order_id": task["order_id"],
        "external_ref": task["external_ref"], "site_id": task["site_id"],
        "status": task["status"], "claimed_by": task["claimed_by"],
        "is_test": bool(task["is_test"]),
        "lines": [{
            "id": l["id"], "sequence_no": l["sequence_no"], "sku_id": l["sku_id"],
            "sku_name": l["name_display"], "photo_key": l["photo_key"],
            "location_id": l["location_id"], "location_code": l["location_code"],
            "rack_code": l["rack_code"], "level_no": l["level_no"],
            "qty_required": l["qty_required"], "qty_picked": l["qty_picked"],
            "status": l["status"], "identity_mode": l["identity_mode"],
        } for l in lines],
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


@router.post("/pick-tasks/{task_id}/claim", response_model=models.PickTask)
async def claim_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    """A claimed task is invisible to other pickers (M5.2.2).

    The conditional UPDATE is the lock: two pickers racing for the same task,
    exactly one wins, decided by the database rather than by timing.
    """
    async with db.tx() as cur:
        task = await db.one(cur, "SELECT * FROM pick_tasks WHERE id = %s FOR UPDATE",
                            (task_id,))
        if not task:
            raise HTTPException(404, "Pick task not found")
        if task["status"] == "claimed" and task["claimed_by"] != user.email:
            raise HTTPException(
                409, f"{task['claimed_by']} is already picking this order."
            )
        if task["status"] == "completed":
            raise HTTPException(409, "This order is already picked.")
        await db.run(
            cur,
            "UPDATE pick_tasks SET status='claimed', claimed_by=%s, claimed_at=NOW() "
            "WHERE id = %s", (user.email, task_id),
        )
    await auth.assert_site_access(user, task["site_id"])
    return await _task_payload(task_id)


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
        "SELECT pl.*, pt.site_id, pt.status AS task_status, pt.claimed_by, "
        "       s.name_display, s.identity_mode "
        "FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "JOIN skus s ON s.id = pl.sku_id WHERE pl.id = %s", (line_id,)
    )
    if not line:
        raise HTTPException(404, "Pick line not found")
    site = await auth.assert_site_access(user, line["site_id"])
    if line["claimed_by"] and line["claimed_by"] != user.email:
        raise HTTPException(409, f"{line['claimed_by']} is picking this order.")

    code = body.code.strip()
    scanned_sku = await common.sku_by_barcode(code)
    plate = None

    if not scanned_sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            scanned_sku = await common.sku_by_id(plate["sku_id"])

    if not scanned_sku:
        return {"accepted": False, "outcome": "wrong_sku",
                "expected_sku_name": line["name_display"],
                "message": "Barcode tidak dikenal. Panggil supervisor."}

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
                    "message": "Scan label Ninja pada barangnya, bukan barcode lain."}
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
        await ledger.apply(
            cur, site_id=line["site_id"], sku_id=line["sku_id"],
            location_id=line["location_id"], qty_delta=-qty,
            movement_type="pick_out", actor_email=user.email,
            ref_type="pick_line", ref_id=line_id,
            plate_id=plate["id"] if plate else None,
            scan_source="plate" if plate else "scan",
            is_training=bool(site["is_training"]),
        )
        await ledger.release(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                             location_id=line["location_id"], qty=qty)
        if plate:
            await db.run(cur, "UPDATE unit_plates SET state='picked', "
                              "last_seen_at=NOW() WHERE id = %s", (plate["id"],))

        picked = line["qty_picked"] + qty
        done = picked >= line["qty_required"]
        await db.run(
            cur, "UPDATE pick_lines SET qty_picked=%s, status=%s WHERE id=%s",
            (picked, "picked" if done else "pending", line_id),
        )
        await db.run(
            cur, "UPDATE order_lines SET qty_picked=%s, status=%s WHERE id=%s",
            (picked, "picked" if done else "allocated", line["order_line_id"]),
        )

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
            "message": "Sudah diambil." if done else f"{picked} dari {line['qty_required']}.",
        }
        await ledger.remember(cur, body.idempotency_key, "pick_confirm", result)
    return result


@router.post("/pick-tasks/{task_id}/complete", response_model=models.PickTask)
async def complete_task(task_id: int, user: auth.User = Depends(auth.current_user)):
    task = await db.fetch_one("SELECT * FROM pick_tasks WHERE id = %s", (task_id,))
    if not task:
        raise HTTPException(404, "Pick task not found")
    await auth.assert_site_access(user, task["site_id"])
    async with db.tx() as cur:
        await db.run(cur, "UPDATE pick_tasks SET status='completed', "
                          "completed_at=NOW() WHERE id=%s", (task_id,))
        await db.run(cur, "UPDATE orders SET status='picked' WHERE id=%s",
                     (task["order_id"],))
        await db.run(cur, "UPDATE unit_plates SET state='shipped' "
                          "WHERE state='picked' AND site_id=%s", (task["site_id"],))
    return await _task_payload(task_id)
