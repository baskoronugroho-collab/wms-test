"""Replenishment and restock triggers (PRD §7.5).

Two different questions that look alike and must never share a threshold:

  * **Replenish** — is the *pick face* low, and is there stock in overflow to
    move? Measured on the primary location alone.
  * **Restock** — is *everything we hold* low, so the hub should send more?
    Measured on primary + overflow.

Using a total for the first is the failure this module exists to prevent: a pick
face at zero with a full overflow still totals healthy, and the picker walks up
to a bare rack.
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
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.role = 'primary'",
        (site_id, sku_id),
    )
    if not slot or slot["low_threshold"] is None:
        # An unconfigured SKU is not a failure — it simply has no rule yet, and
        # inventing one would fire tasks nobody asked for.
        return {"replenishment": None, "restock": None, "configured": False}

    overflow = await db.fetch_one(
        "SELECT bk.location_id FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.role = 'overflow'",
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

    # --- replenish: pick face only ---------------------------------------
    if qty_primary <= slot["low_threshold"] and qty_overflow > 0:
        existing = await db.fetch_one(
            "SELECT id FROM replenishment_tasks WHERE site_id=%s AND sku_id=%s "
            "AND status IN ('open','claimed')",
            (site_id, sku_id),
        )
        if not existing:
            # Move enough to refill the pick face, but never more than overflow
            # holds. The database cannot express "unique while open", so the
            # guard above is the enforcement.
            want = (slot["full_threshold"] or slot["low_threshold"] * 4) - qty_primary
            move = max(1, min(want, qty_overflow))
            task_id = await db.execute(
                "INSERT INTO replenishment_tasks (site_id, sku_id, from_location_id, "
                "to_location_id, qty_suggested) VALUES (%s,%s,%s,%s,%s)",
                (site_id, sku_id, overflow["location_id"],
                 slot["primary_location_id"], move),
            )
            out["replenishment"] = {"task_id": task_id, "qty": move}
        else:
            out["replenishment"] = {"task_id": existing["id"], "qty": None}

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
