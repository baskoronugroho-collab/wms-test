"""Restock trigger (PRD 5.7 decision 13, and 7.5).

There is no replenishment task any more. When a SKU sits in both its rack and an
overflow slot, the picker is simply sent to whichever holds the older stock
(common.pick_location_for), so nothing ever needs moving between the two.

What remains is restock: is EVERYTHING we hold for this SKU low enough that the
hub should send more? Measured on rack + overflow together.
"""
import db


async def evaluate(site_id: int, sku_id: int, actor: str | None = None) -> dict:
    """Check both thresholds for one SKU and raise tasks as needed.

    Called after any movement that could lower stock at a site. Returns what it
    did, so a caller can surface it without a second query.
    """
    slot = await db.fetch_one(
        "SELECT sa.full_threshold, sa.low_threshold, sa.restock_point, "
        "       bk.location_id AS primary_location_id "
        "FROM slot_assignments sa JOIN baskets bk ON bk.id = sa.basket_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.slot_role = 'primary'",
        (site_id, sku_id),
    )
    if not slot or slot["restock_point"] is None:
        # An unconfigured SKU is not a failure — it simply has no rule yet, and
        # inventing one would fire tasks nobody asked for.
        return {"replenishment": None, "restock": None, "configured": False}

    overflow = await db.fetch_one(
        "SELECT bk.location_id FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.slot_role = 'overflow'",
        (site_id, sku_id),
    )

    async def qty_at(location_id) -> int:
        if not location_id:
            return 0
        row = await db.fetch_one(
            "SELECT qty_on_hand FROM inventory_balances "
            "WHERE site_id=%s AND sku_id=%s AND location_id=%s",
            (site_id, sku_id, location_id),
        )
        return int(row["qty_on_hand"]) if row else 0

    qty_primary = await qty_at(slot["primary_location_id"])
    qty_overflow = await qty_at(overflow["location_id"]) if overflow else 0

    out = {"replenishment": None, "restock": None, "configured": True,
           "qty_primary": qty_primary, "qty_overflow": qty_overflow}

    # --- restock: everything held ----------------------------------------
    total = qty_primary + qty_overflow
    if slot["restock_point"] is not None and total <= slot["restock_point"]:
        existing = await db.fetch_one(
            "SELECT id FROM restock_requests WHERE site_id=%s AND sku_id=%s "
            "AND status = 'open'",
            (site_id, sku_id),
        )
        if not existing:
            target = (slot["full_threshold"] or slot["restock_point"] * 2) * 2
            req_id = await db.execute(
                "INSERT INTO restock_requests (site_id, sku_id, qty_suggested, "
                "raised_by) VALUES (%s,%s,%s,%s)",
                (site_id, sku_id, max(1, target - total), actor),
            )
            out["restock"] = {"request_id": req_id, "qty": max(1, target - total)}
        else:
            out["restock"] = {"request_id": existing["id"], "qty": None}

    return out
