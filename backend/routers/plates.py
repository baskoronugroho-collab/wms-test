"""M1.4 — Mode B license plates.

Pre-printed anonymous rolls, bound by a scan under a locked SKU. One roll serves
every SKU and every brand; the binding scan is what makes a label going onto the
wrong product catchable (PRD M1.4).
"""
from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["plates (Mode B)"])

LOW_STOCK_THRESHOLD = 200  # running out mid-delivery stops the receiving line


def plate_code(prefix: str, seq: int) -> str:
    return f"{prefix}{seq:010d}"


@router.post("/plates/ranges", response_model=models.PlateRange, status_code=201)
async def issue_range(
    body: models.PlateRangeIn, user: auth.User = Depends(auth.require("supervisor"))
):
    """Mint a block of sequential, unbound plates and materialise them.

    A plate exists from the moment it is issued: issuing 5,000 creates 5,000
    rows, so a scan of any of them is a known object rather than a guess.
    """
    await auth.assert_site_access(user, body.site_id)
    if body.count < 1 or body.count > 20000:
        raise HTTPException(400, "Issue between 1 and 20000 plates at a time.")

    last = await db.fetch_one("SELECT COALESCE(MAX(seq_to), 0) AS m FROM plate_ranges")
    start = int(last["m"]) + 1
    end = start + body.count - 1

    async with db.tx() as cur:
        range_id = await db.run(
            cur,
            "INSERT INTO plate_ranges (site_id, prefix, seq_from, seq_to, issued_by) "
            "VALUES (%s,%s,%s,%s,%s)",
            (body.site_id, body.prefix, start, end, user.email),
        )
        # Batched inserts: 20k single round trips would be silly.
        batch, params = [], []
        for seq in range(start, end + 1):
            batch.append("(%s,%s,%s,'unbound')")
            params += [plate_code(body.prefix, seq), range_id, body.site_id]
            if len(batch) == 500:
                await db.run(
                    cur,
                    "INSERT INTO unit_plates (plate_code, range_id, site_id, state) "
                    "VALUES " + ",".join(batch), params,
                )
                batch, params = [], []
        if batch:
            await db.run(
                cur,
                "INSERT INTO unit_plates (plate_code, range_id, site_id, state) "
                "VALUES " + ",".join(batch), params,
            )
        await ledger.audit(cur, actor_email=user.email, entity="plate_range",
                           entity_id=range_id, action="issue",
                           after={"from": start, "to": end, "site_id": body.site_id})

    return {
        "id": range_id, "site_id": body.site_id, "prefix": body.prefix,
        "seq_from": start, "seq_to": end,
        "codes_sample": [plate_code(body.prefix, s)
                         for s in range(start, min(start + 5, end + 1))],
    }


@router.get("/plates/stock", response_model=models.PlateStock)
async def plate_stock(site_id: int, user: auth.User = Depends(auth.current_user)):
    await auth.assert_site_access(user, site_id)
    row = await db.fetch_one(
        "SELECT SUM(state = 'unbound') AS unbound, SUM(state = 'in_stock') AS in_stock "
        "FROM unit_plates WHERE site_id = %s",
        (site_id,),
    )
    unbound = int(row["unbound"] or 0)
    return {
        "site_id": site_id,
        "unbound": unbound,
        "in_stock": int(row["in_stock"] or 0),
        "low": unbound < LOW_STOCK_THRESHOLD,
    }


@router.post("/plates/bind", response_model=models.PlateBindResult)
async def bind_plate(
    body: models.PlateBindIn, user: auth.User = Depends(auth.current_user)
):
    """Apply-then-scan. Binding and putaway are one action, never two (M1.4.2.8).

    The staffer sticks a label on the item and scans it; the scan resolves the
    SKU, the SKU resolves the basket, and the screen shows where to put it. The
    same unit is never scanned twice.
    """
    replayed = await ledger.replay(body.idempotency_key, "plate_bind")
    if replayed:
        return replayed

    site = await auth.assert_site_access(user, body.site_id)
    sku = await common.sku_by_id(body.sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")
    if sku["identity_mode"] != "unit_label":
        raise HTTPException(
            400,
            f"{sku['name_display']} uses the brand's own barcode. "
            "Labelling is only for products with no barcode.",
        )

    code = body.plate_code.strip()
    plate = await db.fetch_one(
        "SELECT p.*, s.name_display AS sku_name FROM unit_plates p "
        "LEFT JOIN skus s ON s.id = p.sku_id WHERE p.plate_code = %s",
        (code,),
    )
    if not plate:
        return {"accepted": False, "outcome": "unknown_plate", "plate_code": code,
                "message": "Label ini tidak ada di sistem."}
    if plate["site_id"] != body.site_id:
        return {"accepted": False, "outcome": "wrong_site", "plate_code": code,
                "message": "Label ini milik lokasi lain. Jangan dipakai di sini."}
    if plate["state"] != "unbound":
        return {
            "accepted": False, "outcome": "already_bound", "plate_code": code,
            "message": f"Label ini sudah dipakai untuk {plate['sku_name']}.",
        }

    slot = await common.slot_for(body.site_id, body.sku_id)
    if not slot:
        return {"accepted": False, "outcome": "no_slot", "plate_code": code,
                "sku": common.sku_dict(sku),
                "message": f"{sku['name_display']} belum punya keranjang di sini."}

    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE unit_plates SET state='in_stock', sku_id=%s, location_id=%s, "
            "expiry_date=%s, bound_by=%s, bound_at=NOW(), last_seen_at=NOW() "
            "WHERE id = %s AND state = 'unbound'",
            (body.sku_id, slot["location_id"], body.expiry_date, user.email,
             plate["id"]),
        )
        await ledger.apply(
            cur, site_id=body.site_id, sku_id=body.sku_id,
            location_id=slot["location_id"], qty_delta=1,
            movement_type="label_bind", actor_email=user.email,
            plate_id=plate["id"], scan_source="plate", ref_type="plate",
            ref_id=plate["id"], is_training=bool(site["is_training"]),
        )
        count = await db.one(
            cur, "SELECT COUNT(*) AS n FROM unit_plates "
                 "WHERE sku_id=%s AND site_id=%s AND state='in_stock'",
            (body.sku_id, body.site_id),
        )
        result = {
            "accepted": True, "outcome": "bound", "plate_code": code,
            "sku": common.sku_dict(sku), "location_code": slot["location_code"],
            "bound_count": int(count["n"]),
            "message": f"Simpan di {slot['location_code']}.",
        }
        await ledger.remember(cur, body.idempotency_key, "plate_bind", result)
    return result


@router.post("/plates/{code}/unbind", response_model=models.Ok)
async def unbind_plate(
    code: str,
    reason: str = Query(default="undo"),
    user: auth.User = Depends(auth.current_user),
):
    """Undo — peel the label and rebind it cleanly (M1.4.2.6)."""
    plate = await db.fetch_one("SELECT * FROM unit_plates WHERE plate_code = %s", (code,))
    if not plate:
        raise HTTPException(404, "Plate not found")
    if plate["state"] != "in_stock":
        raise HTTPException(409, f"Plate is {plate['state']} and cannot be unbound.")
    site = await auth.assert_site_access(user, plate["site_id"])

    async with db.tx() as cur:
        await ledger.apply(
            cur, site_id=plate["site_id"], sku_id=plate["sku_id"],
            location_id=plate["location_id"], qty_delta=-1,
            movement_type="adjustment", actor_email=user.email,
            plate_id=plate["id"], reason_code=reason, scan_source="plate",
            is_training=bool(site["is_training"]),
        )
        await db.run(
            cur,
            "UPDATE unit_plates SET state='unbound', sku_id=NULL, location_id=NULL, "
            "expiry_date=NULL, bound_by=NULL, bound_at=NULL WHERE id = %s",
            (plate["id"],),
        )
        await ledger.audit(cur, actor_email=user.email, entity="plate",
                           entity_id=plate["id"], action="unbind",
                           before=dict(plate, bound_at=str(plate.get("bound_at"))),
                           after={"reason": reason})
    return {"ok": True, "message": f"{code} dilepas."}


@router.get("/plates/{code}", response_model=models.Plate)
async def get_plate(code: str, user: auth.User = Depends(auth.current_user)):
    plate = await common.plate_by_code(code)
    if not plate:
        raise HTTPException(404, "Plate not found")
    return {
        "plate_code": plate["plate_code"], "state": plate["state"],
        "site_id": plate["site_id"], "sku_id": plate.get("sku_id"),
        "sku_name": plate.get("sku_name"), "location_code": plate.get("location_code"),
        "expiry_date": str(plate["expiry_date"]) if plate.get("expiry_date") else None,
        "bound_at": str(plate["bound_at"]) if plate.get("bound_at") else None,
    }
