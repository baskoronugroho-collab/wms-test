"""The scan resolver — one endpoint for both identity modes.

The client scans and the server decides what it was looking at. A staffer moving
between a barcoded brand and an unbarcoded one sees the same screens and does the
same thing; only the server behaves differently (PRD §5.1).
"""
from fastapi import APIRouter, Depends, Query

import auth
import common
import models

router = APIRouter(prefix="/api", tags=["scanning"])


@router.get("/scan/resolve", response_model=models.ScanResolved)
async def resolve(
    code: str = Query(..., description="Whatever the scanner produced"),
    site_id: int | None = Query(default=None),
    user: auth.User = Depends(auth.current_user),
):
    code = code.strip()

    # Mode A: a brand's own barcode resolves to a SKU.
    sku = await common.sku_by_barcode(code)
    if sku:
        out = {
            "found": True, "kind": "sku_barcode", "code": code,
            "sku": common.sku_dict(sku),
        }
        if site_id:
            slot = await common.slot_for(site_id, sku["id"])
            if slot:
                out["slot_location_id"] = slot["location_id"]
                out["slot_location_code"] = slot["location_code"]
                out["qty_on_hand"] = await common.qty_at(
                    site_id, sku["id"], slot["location_id"]
                )
            else:
                out["message"] = "Barang ini belum punya keranjang di lokasi ini."
        return out

    # Mode B: a Ninja license plate resolves to one physical unit.
    plate = await common.plate_by_code(code)
    if plate:
        sku_row = await common.sku_by_id(plate["sku_id"]) if plate["sku_id"] else None
        return {
            "found": True, "kind": "unit_plate", "code": code,
            "sku": common.sku_dict(sku_row),
            "plate_code": plate["plate_code"],
            "plate_state": plate["state"],
            "slot_location_id": plate["location_id"],
            "slot_location_code": plate["location_code"],
            "message": (
                "Label ini belum dipakai." if plate["state"] == "unbound" else None
            ),
        }

    return {
        "found": False, "kind": "unknown", "code": code,
        "message": "Barcode tidak dikenal.",
    }
