"""M7 — Stock visibility, find-a-SKU, and the movement ledger."""
from fastapi import APIRouter, Depends, Query

import auth
import common
import db
import models

router = APIRouter(prefix="/api", tags=["inventory"])


@router.get("/inventory", response_model=models.InventoryList)
async def inventory(
    site_id: int,
    brand_id: int | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
    offset: int = Query(default=0, ge=0),
    user: auth.User = Depends(auth.current_user),
):
    await auth.assert_site_access(user, site_id)
    where = ["ib.site_id = %s"]
    params: list = [site_id]
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    if q:
        where.append("s.name_display LIKE %s")
        params.append(f"%{q}%")
    clause = " AND ".join(where)

    rows = await db.fetch_all(
        "SELECT s.id, s.name_display, s.expiry_tier, b.code AS brand_code, "
        "       l.code AS location_code, ib.qty_on_hand, ib.qty_allocated, "
        "       ib.stock_owner, ib.stocked_since, "
        "       (SELECT MAX(os.finished_at) FROM opname_sessions os "
        "         WHERE os.sku_id = s.id AND os.site_id = ib.site_id) AS last_counted "
        "FROM inventory_balances ib "
        "JOIN skus s ON s.id = ib.sku_id "
        "JOIN brands b ON b.id = s.brand_id "
        "LEFT JOIN locations l ON l.id = ib.location_id "
        f"WHERE {clause} ORDER BY s.name_display, l.code LIMIT %s OFFSET %s",
        params + [limit, offset],
    )
    total = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
        f"WHERE {clause}", params)
    out = [{
        "sku_id": r["id"], "sku_name": r["name_display"], "brand_code": r["brand_code"],
        "location_code": r["location_code"], "qty_on_hand": r["qty_on_hand"],
        "qty_allocated": r["qty_allocated"],
        "available": max(0, r["qty_on_hand"] - r["qty_allocated"]),
        "expiry_tier": r["expiry_tier"],
        "last_counted_at": str(r["last_counted"]) if r["last_counted"] else None,
        "stock_owner": r["stock_owner"],
        "stocked_since": str(r["stocked_since"]) if r["stocked_since"] else None,
    } for r in rows]
    return {"rows": out, "total": int(total["n"])}


@router.get("/inventory/find", response_model=models.ScanResolved)
async def find(
    code: str,
    site_id: int,
    user: auth.User = Depends(auth.current_user),
):
    """Scan or type anything and be told where it is. After the guided flows,
    the most-used screen in the product (M7.2)."""
    await auth.assert_site_access(user, site_id)
    from routers.scan import resolve
    return await resolve(code=code, site_id=site_id, user=user)


@router.get("/inventory/low-stock", response_model=models.InventoryList)
async def low_stock(
    site_id: int,
    threshold: int | None = Query(default=None),
    user: auth.User = Depends(auth.current_user),
):
    """SKUs running low, one row per SKU — rack and overflow together.

    Low is measured on everything the station holds for the SKU, the same way
    the restock point is: stock in overflow is stock. Without `threshold`, each
    SKU is compared with its own restock point (10 when none is set). A SKU with
    a rack but no stock at all is listed at zero rather than missing.
    It suggests; a supervisor decides whether to ask the hub.
    """
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT s.id, s.name_display, s.expiry_tier, b.code AS brand_code, "
        "       l.code AS location_code, sa.restock_point, "
        "       COALESCE(SUM(ib.qty_on_hand), 0) AS on_hand, "
        "       COALESCE(SUM(ib.qty_allocated), 0) AS allocated, "
        "       MAX(ib.stock_owner) AS stock_owner "
        "FROM slot_assignments sa "
        "JOIN skus s ON s.id = sa.sku_id JOIN brands b ON b.id = s.brand_id "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "LEFT JOIN inventory_balances ib ON ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id "
        "WHERE sa.site_id = %s AND sa.slot_role = 'primary' "
        "GROUP BY s.id, s.name_display, s.expiry_tier, b.code, l.code, sa.restock_point "
        "HAVING COALESCE(SUM(ib.qty_on_hand), 0) - COALESCE(SUM(ib.qty_allocated), 0) "
        "       <= COALESCE(%s, sa.restock_point, 10) "
        "ORDER BY COALESCE(SUM(ib.qty_on_hand), 0) - COALESCE(SUM(ib.qty_allocated), 0) ASC, "
        "         s.name_display",
        (site_id, threshold),
    )
    out = [{
        "sku_id": r["id"], "sku_name": r["name_display"], "brand_code": r["brand_code"],
        "location_code": r["location_code"], "qty_on_hand": int(r["on_hand"]),
        "qty_allocated": int(r["allocated"]),
        "available": max(0, int(r["on_hand"]) - int(r["allocated"])),
        "expiry_tier": r["expiry_tier"], "last_counted_at": None,
        "stock_owner": r["stock_owner"], "restock_point": r["restock_point"],
    } for r in rows]
    return {"rows": out, "total": len(out)}


@router.get("/movements", response_model=models.MovementList)
async def movements(
    site_id: int,
    sku_id: int | None = None,
    location_id: int | None = None,
    limit: int = Query(default=100, le=500),
    user: auth.User = Depends(auth.current_user),
):
    """The immutable ledger. Answers 'where did this stock go'."""
    await auth.assert_site_access(user, site_id)
    where = ["m.site_id = %s"]
    params: list = [site_id]
    if sku_id:
        where.append("m.sku_id = %s")
        params.append(sku_id)
    if location_id:
        where.append("m.location_id = %s")
        params.append(location_id)

    rows = await db.fetch_all(
        "SELECT m.id, m.created_at, m.sku_id, s.name_display, l.code AS location_code, "
        "       m.qty_delta, m.movement_type, m.reason_code, m.actor_email, "
        "       p.plate_code "
        "FROM stock_movements m "
        "LEFT JOIN skus s ON s.id = m.sku_id "
        "LEFT JOIN locations l ON l.id = m.location_id "
        "LEFT JOIN unit_plates p ON p.id = m.plate_id "
        f"WHERE {' AND '.join(where)} ORDER BY m.id DESC LIMIT %s",
        params + [limit],
    )
    return {"movements": [{
        "id": r["id"], "created_at": str(r["created_at"]), "sku_id": r["sku_id"],
        "sku_name": r["name_display"], "location_code": r["location_code"],
        "qty_delta": r["qty_delta"], "movement_type": r["movement_type"],
        "reason_code": r["reason_code"], "actor_email": r["actor_email"],
        "plate_code": r["plate_code"],
    } for r in rows]}
