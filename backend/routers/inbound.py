"""M3 — Inbound receiving and putaway."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import daycolor
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["inbound"])

# The Malaysia rollout's hardest-won rule: an inbound discrepancy must be raised
# within 24 hours or the station bears the loss (PRD §2.1).
DISCREPANCY_WINDOW = timedelta(hours=24)

BANNER = {
    "from_hub_transfer": "Barcode sudah terdaftar — tinggal scan.",
    "from_brand": "Barcode baru mungkin perlu didaftarkan dulu.",
}


def _receipt_out(row: dict) -> dict:
    return {
        "id": row["id"], "site_id": row["site_id"], "brand_id": row.get("brand_id"),
        "source_type": row["source_type"], "status": row["status"],
        "opened_by": row.get("opened_by"), "opened_at": str(row["opened_at"]),
        "completed_at": str(row["completed_at"]) if row.get("completed_at") else None,
        "external_reference": row.get("external_reference"),
        "banner": BANNER.get(row["source_type"], ""),
        # The sticker colour follows the day the delivery arrived (the receipt
        # opened), computed here so no screen re-implements the Jakarta rule.
        "day_color": daycolor.for_moment(row["opened_at"]),
    }


@router.get("/receipts", response_model=models.ReceiptList)
async def list_receipts(
    site_id: int,
    status: str = Query(default="all", pattern="^(all|open|completed|discrepancy_raised)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: auth.User = Depends(auth.current_user),
):
    """Every receipt at a site, newest first, open ones included.

    The slip archive only knows completed receipts; a supervisor also needs to
    see the delivery still being scanned, and by whom.
    """
    await auth.assert_site_access(user, site_id)
    where, params = "WHERE ir.site_id = %s", [site_id]
    if status != "all":
        where += " AND ir.status = %s"
        params.append(status)
    rows = await db.fetch_all(
        "SELECT ir.*, ps.id AS slip_id, "
        "       (SELECT COUNT(*) FROM receipt_lines rl WHERE rl.receipt_id = ir.id) AS line_count, "
        "       (SELECT COALESCE(SUM(rl.qty_received),0) FROM receipt_lines rl "
        "         WHERE rl.receipt_id = ir.id) AS units "
        "FROM inbound_receipts ir "
        "LEFT JOIN putaway_slips ps ON ps.receipt_id = ir.id "
        + where + " ORDER BY ir.opened_at DESC, ir.id DESC LIMIT %s OFFSET %s",
        (*params, limit, offset),
    )
    total = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM inbound_receipts ir " + where, tuple(params))
    return {
        "receipts": [dict(_receipt_out(r), line_count=int(r["line_count"] or 0),
                          units=int(r["units"] or 0), slip_id=r["slip_id"])
                     for r in rows],
        "total": int(total["n"]),
    }


@router.post("/receipts", response_model=models.Receipt, status_code=201)
async def open_receipt(
    body: models.ReceiptIn, user: auth.User = Depends(auth.current_user)
):
    await auth.assert_site_access(user, body.site_id)
    transfer_id = None

    if body.source_type == "from_hub_transfer":
        if not body.transfer_reference:
            raise HTTPException(400, "Scan the transfer label to open this receipt.")
        tr = await db.fetch_one(
            "SELECT id, to_site_id, status FROM transfers WHERE reference = %s",
            (body.transfer_reference,),
        )
        if not tr:
            raise HTTPException(404, "Transfer not found.")
        if tr["to_site_id"] != body.site_id:
            raise HTTPException(409, "That transfer is addressed to another station.")
        transfer_id = tr["id"]

    async with db.tx() as cur:
        rid = await db.run(
            cur,
            "INSERT INTO inbound_receipts (site_id, brand_id, source_type, "
            "transfer_id, opened_by) VALUES (%s,%s,%s,%s,%s)",
            (body.site_id, body.brand_id, body.source_type, transfer_id, user.email),
        )
        # A transfer receipt arrives with an expectation, so variance is
        # computable the moment it is completed.
        if transfer_id:
            lines = await db.many(
                cur, "SELECT sku_id, qty_dispatched FROM transfer_lines "
                     "WHERE transfer_id = %s", (transfer_id,)
            )
            for ln in lines:
                await db.run(
                    cur,
                    "INSERT INTO receipt_lines (receipt_id, sku_id, qty_expected) "
                    "VALUES (%s,%s,%s)",
                    (rid, ln["sku_id"], ln["qty_dispatched"]),
                )
    row = await db.fetch_one("SELECT * FROM inbound_receipts WHERE id = %s", (rid,))
    return _receipt_out(row)


@router.patch("/receipts/{receipt_id}", response_model=models.Receipt)
async def update_receipt(
    receipt_id: int, body: models.ReceiptPatch,
    user: auth.User = Depends(auth.current_user),
):
    """Attach an AWB/reference number a brand happened to supply.

    Optional and free-text — there is no known-good list to validate against
    yet (M3 addendum). It carries no expected-quantity behaviour of its own;
    it is only recorded for the summary/slip so it can be searched later.
    """
    receipt = await db.fetch_one(
        "SELECT site_id FROM inbound_receipts WHERE id = %s", (receipt_id,)
    )
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    await auth.assert_site_access(user, receipt["site_id"])

    await db.execute(
        "UPDATE inbound_receipts SET external_reference = %s WHERE id = %s",
        (body.external_reference, receipt_id),
    )
    row = await db.fetch_one("SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
    return _receipt_out(row)


@router.post("/receipts/{receipt_id}/scan", response_model=models.ReceiptScanResult)
async def scan_into_receipt(
    receipt_id: int,
    body: models.ReceiptScanIn,
    user: auth.User = Depends(auth.current_user),
):
    """The receiving scan loop — the core interaction, tuned for the burst.

    Never dead-ends: an unknown barcode or a SKU with no basket both return an
    outcome the UI can offer a way out of, rather than an error (M3.3.4/5).
    """
    replayed = await ledger.replay(body.idempotency_key, "receipt_scan")
    if replayed:
        return replayed

    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)
    )
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt["status"] != "open":
        raise HTTPException(409, "This receipt is already completed.")
    site = await auth.assert_site_access(user, receipt["site_id"])
    site_id = receipt["site_id"]

    code = body.code.strip()
    sku = await common.sku_by_barcode(code)

    if not sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            # A pre-labelled unit arriving from the hub: bind is already done.
            sku = await common.sku_by_id(plate["sku_id"])
        elif plate:
            return {"accepted": False, "outcome": "unknown_barcode",
                    "session_total": 0,
                    "message": "Label belum dipakai. Daftarkan dulu di menu Label Unit."}
        else:
            return {"accepted": False, "outcome": "unknown_barcode",
                    "session_total": 0,
                    "message": "Barcode tidak dikenal. Daftarkan, atau lapor supervisor."}

    slot = await common.slot_for(site_id, sku["id"])
    if not slot:
        return {
            "accepted": False, "outcome": "no_slot",
            "sku": common.sku_dict(sku), "session_total": 0,
            "message": f"{sku['name_display']} belum punya keranjang di sini. Buat sekarang?",
        }

    # Once the pick face is at its full threshold, surplus goes to overflow —
    # this is the only path by which stock ever gets INTO overflow, and without
    # it the whole replenishment cycle has an empty source (PRD 7.5). The pick
    # face is still preferred whenever it has room, so the common case is
    # unchanged and the staffer is only ever sent to a second rack when the
    # first genuinely cannot take more.
    routed_to_overflow = False
    reg = await db.fetch_one(
        "SELECT full_threshold FROM slot_assignments "
        "WHERE site_id = %s AND sku_id = %s AND slot_role = 'primary'",
        (site_id, sku["id"]),
    )
    if reg and reg["full_threshold"]:
        at_face = await common.qty_at(site_id, sku["id"], slot["location_id"])
        if at_face >= reg["full_threshold"]:
            overflow = await common.slot_for_role(site_id, sku["id"], "overflow")
            if overflow:
                slot = overflow
                routed_to_overflow = True

    qty = max(1, body.qty)
    async with db.tx() as cur:
        await ledger.apply(
            cur, site_id=site_id, sku_id=sku["id"], location_id=slot["location_id"],
            qty_delta=qty, movement_type="receipt_in", actor_email=user.email,
            ref_type="receipt", ref_id=receipt_id,
            is_training=bool(site["is_training"]),
        )
        await db.run(
            cur,
            "INSERT INTO receipt_lines (receipt_id, sku_id, qty_received, location_id) "
            "VALUES (%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE qty_received = qty_received + %s, "
            "location_id = VALUES(location_id)",
            (receipt_id, sku["id"], qty, slot["location_id"], qty),
        )
        total_row = await db.one(
            cur, "SELECT COALESCE(SUM(qty_received),0) AS n FROM receipt_lines "
                 "WHERE receipt_id = %s", (receipt_id,)
        )
        in_basket = await db.one(
            cur, "SELECT qty_on_hand FROM inventory_balances "
                 "WHERE site_id=%s AND sku_id=%s AND location_id=%s",
            (site_id, sku["id"], slot["location_id"]),
        )

        cap = common.capacity_units(slot["basket_size"], sku.get("unit_cube_cm3"))
        on_hand = int(in_basket["qty_on_hand"]) if in_basket else qty
        over = bool(cap and on_hand > cap)

        result = {
            "accepted": True,
            "outcome": ("overflow" if routed_to_overflow
                        else "over_capacity" if over else "put_away"),
            "sku": common.sku_dict(sku),
            "location_code": slot["location_code"],
            "location_id": slot["location_id"],
            "qty_in_basket": on_hand,
            "session_total": int(total_row["n"]),
            "message": (
                f"Rak utama penuh — simpan di rak cadangan {slot['location_code']}."
                if routed_to_overflow else
                f"Keranjang penuh ({on_hand} dari kira-kira {cap}). Tetap disimpan."
                if over else f"Simpan di {slot['location_code']}."
            ),
        }
        await ledger.remember(cur, body.idempotency_key, "receipt_scan", result)
    return result


@router.post("/receipts/{receipt_id}/scan/undo", response_model=models.ReceiptUndoResult)
async def undo_receipt_scan(
    receipt_id: int,
    body: models.ReceiptUndoIn,
    user: auth.User = Depends(auth.current_user),
):
    """Take back this person's last scan on an open receipt.

    A double-fire from the gun, or a unit scanned then set aside as damaged,
    otherwise sits in stock until the next count. Only your own scans, only the
    last one, only while the receipt is open: past that it is an adjustment,
    which a supervisor signs.
    """
    replayed = await ledger.replay(body.idempotency_key, "receipt_undo")
    if replayed:
        return replayed
    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    if receipt["status"] != "open":
        raise HTTPException(409, "Penerimaan sudah selesai. / This receipt is already closed.")
    site = await auth.assert_site_access(user, receipt["site_id"])

    async with db.tx() as cur:
        last = await db.one(
            cur,
            "SELECT m.id, m.sku_id, m.location_id, m.qty_delta, s.name_display "
            "FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
            "WHERE m.ref_type = 'receipt' AND m.ref_id = %s "
            "  AND m.movement_type = 'receipt_in' AND m.actor_email = %s "
            "  AND NOT EXISTS (SELECT 1 FROM stock_movements u "
            "                  WHERE u.movement_type = 'receipt_undo' "
            "                    AND u.reason_code = CONCAT('undo:', m.id)) "
            "ORDER BY m.id DESC LIMIT 1 FOR UPDATE",
            (receipt_id, user.email),
        )
        if not last:
            raise HTTPException(409, "Tidak ada pindaian untuk dibatalkan. / Nothing to undo.")
        qty = int(last["qty_delta"])
        await ledger.apply(
            cur, site_id=receipt["site_id"], sku_id=last["sku_id"],
            location_id=last["location_id"], qty_delta=-qty,
            movement_type="receipt_undo", actor_email=user.email,
            ref_type="receipt", ref_id=receipt_id,
            reason_code=f"undo:{last['id']}",
            is_training=bool(site["is_training"]),
        )
        await db.run(
            cur, "UPDATE receipt_lines SET qty_received = GREATEST(0, qty_received - %s) "
                 "WHERE receipt_id = %s AND sku_id = %s",
            (qty, receipt_id, last["sku_id"]))
        await db.run(
            cur, "DELETE FROM receipt_lines WHERE receipt_id = %s AND sku_id = %s "
                 "AND qty_received = 0 AND qty_expected IS NULL",
            (receipt_id, last["sku_id"]))
        total = await db.one(
            cur, "SELECT COALESCE(SUM(qty_received),0) AS n FROM receipt_lines "
                 "WHERE receipt_id = %s", (receipt_id,))
        result = {
            "ok": True, "sku_name": last["name_display"], "qty": qty,
            "session_total": int(total["n"]),
            "message": f"Dibatalkan: {qty} × {last['name_display']}. / "
                       f"Undone: {qty} × {last['name_display']}.",
        }
        await ledger.remember(cur, body.idempotency_key, "receipt_undo", result)
    return result


@router.post("/receipts/{receipt_id}/complete", response_model=models.ReceiptSummary)
async def complete_receipt(
    receipt_id: int, user: auth.User = Depends(auth.current_user)
):
    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)
    )
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    await auth.assert_site_access(user, receipt["site_id"])

    if receipt["status"] == "open":
        async with db.tx() as cur:
            await db.run(
                cur,
                "UPDATE inbound_receipts SET status='completed', completed_at=NOW() "
                "WHERE id = %s", (receipt_id,),
            )
            if receipt["transfer_id"]:
                await db.run(
                    cur,
                    "UPDATE transfer_lines tl "
                    "JOIN receipt_lines rl ON rl.sku_id = tl.sku_id "
                    "SET tl.qty_received = rl.qty_received "
                    "WHERE tl.transfer_id = %s AND rl.receipt_id = %s",
                    (receipt["transfer_id"], receipt_id),
                )
                await db.run(
                    cur,
                    "UPDATE transfers SET status='received', received_at=NOW() "
                    "WHERE id = %s", (receipt["transfer_id"],),
                )
        receipt = await db.fetch_one(
            "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)
        )

    return await receipt_summary(receipt_id, user)


@router.get("/receipts/{receipt_id}/summary", response_model=models.ReceiptSummary)
async def receipt_summary(
    receipt_id: int, user: auth.User = Depends(auth.current_user)
):
    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)
    )
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    await auth.assert_site_access(user, receipt["site_id"])

    lines = await db.fetch_all(
        "SELECT rl.sku_id, s.name_display, rl.qty_expected, rl.qty_received "
        "FROM receipt_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.receipt_id = %s ORDER BY s.name_display",
        (receipt_id,),
    )
    out = [{
        "sku_id": l["sku_id"], "sku_name": l["name_display"],
        "qty_expected": l["qty_expected"], "qty_received": l["qty_received"],
        "variance": (l["qty_received"] - l["qty_expected"])
                    if l["qty_expected"] is not None else None,
    } for l in lines]

    deadline = None
    if receipt.get("completed_at"):
        deadline = str(receipt["completed_at"] + DISCREPANCY_WINDOW)

    return {
        "receipt": _receipt_out(receipt),
        "lines": out,
        "total_units": sum(l["qty_received"] for l in lines),
        "discrepancy_deadline": deadline,
    }
