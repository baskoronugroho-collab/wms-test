"""Queries shared across routers.

Kept in one place because the same three questions — "what SKU is this code?",
"where does this SKU live at this site?", "how much is in that basket?" — are
asked by inbound, picking, opname and labelling alike.
"""
import db

SKU_COLS = (
    "s.id, s.brand_id, s.brand_sku_code, s.name_display, s.category, "
    "s.product_line, s.unit_size, s.price_idr, s.unit_cube_cm3, s.expiry_tier, "
    "s.identity_mode, s.label_placement_note, s.photo_key, b.code AS brand_code"
)


def sku_dict(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "brand_id": row["brand_id"],
        "brand_code": row.get("brand_code"),
        "brand_sku_code": row["brand_sku_code"],
        "name_display": row["name_display"],
        "category": row.get("category"),
        "product_line": row.get("product_line"),
        "unit_size": row.get("unit_size"),
        "price_idr": row.get("price_idr"),
        "unit_cube_cm3": row.get("unit_cube_cm3"),
        "expiry_tier": row.get("expiry_tier") or "stable",
        "identity_mode": row.get("identity_mode") or "sku_barcode",
        "label_placement_note": row.get("label_placement_note"),
        "photo_key": row.get("photo_key"),
    }


async def sku_by_id(sku_id: int) -> dict | None:
    return await db.fetch_one(
        f"SELECT {SKU_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
        "WHERE s.id = %s",
        (sku_id,),
    )


async def sku_by_barcode(code: str) -> dict | None:
    """The hot path. Must stay a single-row indexed lookup (PRD §10.4.1)."""
    return await db.fetch_one(
        f"SELECT {SKU_COLS} FROM barcodes bc "
        "JOIN skus s ON s.id = bc.sku_id JOIN brands b ON b.id = s.brand_id "
        "WHERE bc.barcode = %s",
        (code,),
    )


async def plate_by_code(code: str) -> dict | None:
    return await db.fetch_one(
        "SELECT p.*, s.name_display AS sku_name, l.code AS location_code "
        "FROM unit_plates p "
        "LEFT JOIN skus s ON s.id = p.sku_id "
        "LEFT JOIN locations l ON l.id = p.location_id "
        "WHERE p.plate_code = %s",
        (code,),
    )


async def slot_for(site_id: int, sku_id: int) -> dict | None:
    """Where this SKU lives at this site. One answer, by construction (§5.5)."""
    return await db.fetch_one(
        "SELECT sa.id AS slot_id, sa.basket_id, bk.basket_size, "
        "       l.id AS location_id, l.code AS location_code, "
        "       r.code AS rack_code, lv.level_no "
        "FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "JOIN levels lv ON lv.id = l.level_id "
        "JOIN racks r ON r.id = lv.rack_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s",
        (site_id, sku_id),
    )


async def qty_at(site_id: int, sku_id: int, location_id: int) -> int:
    row = await db.fetch_one(
        "SELECT qty_on_hand FROM inventory_balances "
        "WHERE site_id = %s AND sku_id = %s AND location_id = %s",
        (site_id, sku_id, location_id),
    )
    return int(row["qty_on_hand"]) if row else 0


# Basket capacity in units is a physical question the model only estimates.
# Used to warn, never to block: physical reality beats the model (PRD M3.3.6).
BASKET_CBM = {"S": 0.0158, "M": 0.0261, "L": 0.0396, "OPEN": 0.5}


def capacity_units(basket_size: str, unit_cube_cm3: int | None) -> int | None:
    if not unit_cube_cm3:
        return None
    cbm = BASKET_CBM.get(basket_size or "M", 0.0261)
    return int((cbm * 1_000_000) / max(unit_cube_cm3, 1))


def recommend_basket(unit_cube_cm3: int | None, units_to_hold: int = 55) -> tuple[str, str]:
    """Advisory basket size, from the space model's three standard widths.

    An admin may override it, because the physical answer wins.
    """
    if not unit_cube_cm3:
        return "M", "Ukuran unit belum diketahui — pakai Medium."
    need_cbm = (unit_cube_cm3 * units_to_hold) / 1_000_000
    for size in ("S", "M", "L"):
        if need_cbm <= BASKET_CBM[size]:
            return size, f"{units_to_hold} unit = {need_cbm:.4f} cbm, muat di {size}."
    return "OPEN", (
        f"{units_to_hold} unit = {need_cbm:.4f} cbm — lebih besar dari keranjang "
        "Large. Taruh di rak terbuka."
    )
