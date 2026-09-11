"""Slot registry: one pick face, one overflow, three thresholds (PRD §7.5).

The three numbers are what let the system decide on its own after a supervisor
sets them once. Two measure the pick face; only the third counts everything held,
and conflating them is the mistake this module is written to prevent — see
`_validate_thresholds`.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import models

router = APIRouter(prefix="/api/registry", tags=["registry"])


def _validate_thresholds(full, low, restock) -> None:
    """Refuse a configuration that cannot behave sensibly.

    A low threshold at or above full means the pick face is 'low' the moment it
    stops being 'full', so a replenishment task is raised permanently. A restock
    point below low means the hub is asked for stock only after the pick face has
    already run dry. Both are silent failures at runtime, so they are refused at
    the point of entry where a person can still fix them.
    """
    if full is not None and full <= 0:
        raise HTTPException(422, "Full threshold must be more than zero.")
    if low is not None and low < 0:
        raise HTTPException(422, "Low threshold cannot be negative.")
    if full is not None and low is not None and low >= full:
        raise HTTPException(
            422,
            f"Low threshold ({low}) must be below the full threshold ({full}), "
            "or a replenishment task is raised permanently.",
        )
    if restock is not None and low is not None and restock < low:
        raise HTTPException(
            422,
            f"Restock point ({restock}) sits below the low threshold ({low}) — "
            "the hub would only be asked after the pick face has run dry.",
        )


async def _row(site_id: int, sku_id: int) -> dict | None:
    primary = await db.fetch_one(
        "SELECT sa.*, l.code AS location_code, l.id AS location_id "
        "FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.slot_role = 'primary'",
        (site_id, sku_id),
    )
    if not primary:
        return None
    overflow = await db.fetch_one(
        "SELECT l.code AS location_code, l.id AS location_id "
        "FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.slot_role = 'overflow'",
        (site_id, sku_id),
    )
    sku = await common.sku_by_id(sku_id)
    qty_primary = await common.qty_at(site_id, sku_id, primary["location_id"])
    qty_overflow = (
        await common.qty_at(site_id, sku_id, overflow["location_id"]) if overflow else 0
    )
    return {
        "sku_id": sku_id,
        "sku_name": sku["name_display"] if sku else "?",
        "brand_sku_code": sku.get("brand_sku_code") if sku else None,
        "primary_location_id": primary["location_id"],
        "primary_location_code": primary["location_code"],
        "overflow_location_id": overflow["location_id"] if overflow else None,
        "overflow_location_code": overflow["location_code"] if overflow else None,
        "full_threshold": primary["full_threshold"],
        "low_threshold": primary["low_threshold"],
        "restock_point": primary["restock_point"],
        "qty_primary": qty_primary,
        "qty_overflow": qty_overflow,
        "qty_total": qty_primary + qty_overflow,
        # Derived so the console can colour a row without recomputing the rule.
        "needs_replenishment": (
            primary["low_threshold"] is not None
            and qty_primary <= primary["low_threshold"]
            and qty_overflow > 0
        ),
        "needs_restock": (
            primary["restock_point"] is not None
            and (qty_primary + qty_overflow) <= primary["restock_point"]
        ),
        # Two numbers matter now (decision 13): full and restock. low is legacy.
        "configured": primary["full_threshold"] is not None
                      and primary["restock_point"] is not None,
    }


@router.get("", response_model=models.RegistryList)
async def list_registry(
    site_id: int,
    q: str | None = None,
    unconfigured_only: bool = False,
    limit: int = Query(default=200, le=500),
    user: auth.User = Depends(auth.current_user),
):
    """Every SKU with a pick face at this site, with its thresholds and stock."""
    await auth.assert_site_access(user, site_id)
    params: list = [site_id]
    sql = (
        "SELECT DISTINCT sa.sku_id FROM slot_assignments sa "
        "JOIN skus s ON s.id = sa.sku_id "
        "WHERE sa.site_id = %s AND sa.slot_role = 'primary'"
    )
    if q:
        sql += " AND (s.name_display LIKE %s OR s.brand_sku_code LIKE %s)"
        params += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY sa.sku_id LIMIT %s"
    params.append(limit)

    ids = await db.fetch_all(sql, params)
    rows = [r for r in [await _row(site_id, i["sku_id"]) for i in ids] if r]
    if unconfigured_only:
        rows = [r for r in rows if not r["configured"]]
    return {
        "rows": rows,
        "total": len(rows),
        "unconfigured": sum(1 for r in rows if not r["configured"]),
    }


@router.put("/{sku_id}", response_model=models.RegistryRow)
async def set_thresholds(
    sku_id: int,
    body: models.RegistryIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Set the three thresholds for one SKU's pick face."""
    await auth.assert_site_access(user, body.site_id)
    _validate_thresholds(body.full_threshold, body.low_threshold, body.restock_point)

    updated = await db.execute(
        "UPDATE slot_assignments SET full_threshold=%s, low_threshold=%s, "
        "restock_point=%s WHERE site_id=%s AND sku_id=%s AND slot_role='primary'",
        (body.full_threshold, body.low_threshold, body.restock_point,
         body.site_id, sku_id),
    )
    if not updated:
        raise HTTPException(404, "This SKU has no pick face at this site yet.")

    row = await _row(body.site_id, sku_id)
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'registry.thresholds','slot_assignments',%s,%s)",
        (user.email, sku_id,
         f"full={body.full_threshold} low={body.low_threshold} "
         f"restock={body.restock_point}"),
    )
    return row


@router.post("/bulk", response_model=models.Ok)
async def bulk_thresholds(
    body: models.RegistryBulkIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Apply one set of thresholds across many SKUs.

    118 SKUs set one at a time will not happen, and a registry nobody fills in is
    a registry that silently never fires a replenishment.
    """
    await auth.assert_site_access(user, body.site_id)
    _validate_thresholds(body.full_threshold, body.low_threshold, body.restock_point)
    if not body.sku_ids:
        raise HTTPException(422, "Select at least one product.")

    n = 0
    for sku_id in body.sku_ids:
        n += await db.execute(
            "UPDATE slot_assignments SET full_threshold=%s, low_threshold=%s, "
            "restock_point=%s WHERE site_id=%s AND sku_id=%s AND slot_role='primary'",
            (body.full_threshold, body.low_threshold, body.restock_point,
             body.site_id, sku_id),
        )
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'registry.bulk','sites',%s,%s)",
        (user.email, body.site_id, f"{n} SKUs updated"),
    )
    return {"ok": True, "message": f"{n} product(s) updated."}


@router.get("/suggest/{sku_id}", response_model=models.RegistrySuggestion)
async def suggest_thresholds(
    sku_id: int, site_id: int, user: auth.User = Depends(auth.current_user)
):
    """Derive a starting point from the space model.

    A supervisor correcting a suggestion will fill this in; a supervisor facing
    three empty boxes for 118 SKUs will not.
    """
    await auth.assert_site_access(user, site_id)
    sku = await common.sku_by_id(sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")

    size, _ = common.recommend_basket(sku.get("unit_cube_cm3"))
    cap = common.capacity_units(size, sku.get("unit_cube_cm3")) or 55
    # 14 days of cover at ~3 units/day is the space model's working assumption
    # (HANDOFF §11); the pick face holds what fits, and the rest is overflow.
    full = max(1, int(cap * 0.9))
    low = max(1, int(full * 0.25))
    restock = max(low, int(full * 0.5))
    return {
        "sku_id": sku_id, "basket_size": size, "capacity_units": cap,
        "full_threshold": full, "low_threshold": low, "restock_point": restock,
        "reason": (
            f"Basket {size} holds about {cap} units. Full at 90% ({full}), "
            f"replenish at a quarter ({low}), ask the hub at half ({restock})."
        ),
    }
