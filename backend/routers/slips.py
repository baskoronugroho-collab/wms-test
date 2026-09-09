"""Putaway slips and the day-colour legend.

A finished receipt produces one slip: what arrived, where each SKU was put, and
which colour the batch was labelled with. It is issued once and thereafter only
reprinted, because a supervisor settling a discrepancy needs the document the
staffer actually worked from — not a fresh render against master data that has
moved since.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import daycolor
import db
import models

router = APIRouter(prefix="/api", tags=["slips"])


@router.get("/day-colors", response_model=models.DayColorLegend)
async def day_colors(user: auth.User = Depends(auth.current_user)):
    """Today's batch colour, plus the week, for the label screen and the wall."""
    return {
        "today": daycolor.for_moment(),
        "week": daycolor.legend(),
        "note": (
            "Warna menandai HARI barang masuk. Selalu tulis tanggalnya juga — "
            "warna berulang tiap 7 hari, sedangkan stok disimpan sampai 14 hari."
        ),
    }


async def _build_payload(receipt: dict) -> dict:
    """Assemble the slip body from live data. Called once, at issue."""
    site = await db.fetch_one(
        "SELECT id, code, name FROM sites WHERE id = %s", (receipt["site_id"],)
    )
    lines = await db.fetch_all(
        "SELECT rl.sku_id, rl.qty_expected, rl.qty_received, "
        "       s.name_display, s.brand_sku_code, "
        "       l.code AS location_code, r.code AS rack_code, lv.level_no "
        "FROM receipt_lines rl "
        "JOIN skus s ON s.id = rl.sku_id "
        "LEFT JOIN locations l ON l.id = rl.location_id "
        "LEFT JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN racks r ON r.id = lv.rack_id "
        "WHERE rl.receipt_id = %s "
        # Walking order, so the slip reads the way the aisle is walked.
        "ORDER BY r.code, lv.level_no, l.code",
        (receipt["id"],),
    )
    out = []
    for l in lines:
        exp = l["qty_expected"]
        out.append({
            "sku_id": l["sku_id"],
            "sku_name": l["name_display"],
            "brand_sku_code": l["brand_sku_code"],
            "location_code": l["location_code"],
            "rack_code": l["rack_code"],
            "level_no": l["level_no"],
            "qty_received": l["qty_received"],
            "qty_expected": exp,
            "variance": (l["qty_received"] - exp) if exp is not None else None,
        })
    return {"site_code": site["code"] if site else "?", "lines": out}


async def _issue(receipt: dict, actor: str) -> dict:
    """Create the slip row, or return the one already issued for this receipt."""
    existing = await db.fetch_one(
        "SELECT * FROM putaway_slips WHERE receipt_id = %s", (receipt["id"],)
    )
    if existing:
        return existing

    payload = await _build_payload(receipt)
    # The colour follows the day the stock physically arrived — when the receipt
    # was opened — not when someone got round to closing it. A delivery worked
    # past midnight keeps the colour its cartons were labelled with.
    colour = daycolor.for_moment(receipt.get("opened_at"))
    total_units = sum(l["qty_received"] for l in payload["lines"])
    slip_no = f"PA-{payload['site_code']}-{receipt['id']:06d}"

    body = {
        "slip_no": slip_no,
        "receipt_id": receipt["id"],
        "site_id": receipt["site_id"],
        "site_code": payload["site_code"],
        "source_type": receipt["source_type"],
        "day_color": colour,
        "received_by": receipt.get("opened_by") or actor,
        "lines": payload["lines"],
    }

    await db.execute(
        "INSERT INTO putaway_slips (receipt_id, site_id, slip_no, day_color_key, "
        "day_color_hex, day_label_id, week_parity, inbound_date, total_lines, "
        "total_units, received_by, payload_json) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        # Two staffers closing the same receipt at once must not each mint a
        # slip; the unique key decides, and both then read the winner back.
        "ON DUPLICATE KEY UPDATE putaway_slips.id = putaway_slips.id",
        (receipt["id"], receipt["site_id"], slip_no, colour["key"], colour["hex"],
         colour["day_id"], colour["week_parity"], colour["date"],
         len(payload["lines"]), total_units,
         receipt.get("opened_by") or actor, json.dumps(body, ensure_ascii=False)),
    )
    return await db.fetch_one(
        "SELECT * FROM putaway_slips WHERE receipt_id = %s", (receipt["id"],)
    )


def _hydrate(row: dict) -> dict:
    body = json.loads(row["payload_json"])
    created = str(row["created_at"])
    deadline = None
    if row["created_at"]:
        # The 24-hour discrepancy window, restated on the slip because that is
        # where a supervisor will look for it.
        from datetime import timedelta
        deadline = str(row["created_at"] + timedelta(hours=24))
    return {
        "id": row["id"],
        "slip_no": row["slip_no"],
        "receipt_id": row["receipt_id"],
        "site_id": row["site_id"],
        "site_code": body.get("site_code", ""),
        "source_type": body.get("source_type", ""),
        "inbound_date": str(row["inbound_date"]),
        "day_color": body["day_color"],
        "received_by": row["received_by"],
        "total_lines": row["total_lines"],
        "total_units": row["total_units"],
        "lines": body["lines"],
        "created_at": created,
        "discrepancy_deadline": deadline,
    }


@router.get("/receipts/{receipt_id}/putaway-slip", response_model=models.PutawaySlip)
async def receipt_slip(
    receipt_id: int, user: auth.User = Depends(auth.current_user)
):
    """The slip for a receipt, issuing it on first request after completion."""
    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)
    )
    if not receipt:
        raise HTTPException(404, "Receipt not found")
    await auth.assert_site_access(user, receipt["site_id"])
    if receipt["status"] == "open":
        raise HTTPException(
            409, "Selesaikan penerimaan dulu sebelum mencetak slip."
        )
    row = await _issue(receipt, user.email)
    return _hydrate(row)


@router.get("/putaway-slips", response_model=models.PutawaySlipList)
async def list_slips(
    site_id: int,
    limit: int = Query(default=50, le=200),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """The supervisor's archive: every slip this site has issued, newest first."""
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT ps.*, s.code AS site_code FROM putaway_slips ps "
        "JOIN sites s ON s.id = ps.site_id "
        "WHERE ps.site_id = %s ORDER BY ps.created_at DESC LIMIT %s",
        (site_id, limit),
    )
    total = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM putaway_slips WHERE site_id = %s", (site_id,)
    )
    return {
        "slips": [{
            "id": r["id"], "slip_no": r["slip_no"], "receipt_id": r["receipt_id"],
            "site_code": r["site_code"], "inbound_date": str(r["inbound_date"]),
            "day_color_hex": r["day_color_hex"], "day_label": r["day_label_id"],
            "total_lines": r["total_lines"], "total_units": r["total_units"],
            "received_by": r["received_by"], "created_at": str(r["created_at"]),
        } for r in rows],
        "total": total["n"] if total else 0,
    }


@router.get("/putaway-slips/{slip_id}", response_model=models.PutawaySlip)
async def get_slip(slip_id: int, user: auth.User = Depends(auth.current_user)):
    row = await db.fetch_one("SELECT * FROM putaway_slips WHERE id = %s", (slip_id,))
    if not row:
        raise HTTPException(404, "Slip not found")
    await auth.assert_site_access(user, row["site_id"])
    return _hydrate(row)
