"""M3 — Inbound receiving and putaway."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

import auth
import common
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
        "banner": BANNER.get(row["source_type"], ""),
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
            "outcome": "over_capacity" if over else "put_away",
            "sku": common.sku_dict(sku),
            "location_code": slot["location_code"],
            "location_id": slot["location_id"],
            "qty_in_basket": on_hand,
            "session_total": int(total_row["n"]),
            "message": (
                f"Keranjang penuh ({on_hand} dari kira-kira {cap}). Tetap disimpan."
                if over else f"Simpan di {slot['location_code']}."
            ),
        }
        await ledger.remember(cur, body.idempotency_key, "receipt_scan", result)
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
