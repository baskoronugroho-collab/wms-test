"""M2 — Sites, racks, baskets and slot assignment."""
from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models
from routers import racks, reminders

router = APIRouter(prefix="/api", tags=["locations"])


@router.get("/sites", response_model=list[models.Site])
async def list_sites(
    include_training: bool = Query(default=True),
    user: auth.User = Depends(auth.current_user),
):
    sql = ("SELECT id, code, name, address, site_type, is_training, active "
           "FROM sites WHERE active = 1")
    params: list = []
    if not include_training:
        sql += " AND is_training = 0"
    if not user.at_least("hq"):
        sql += (" AND id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    rows = await db.fetch_all(sql + " ORDER BY is_training, code", params)
    return [dict(r, is_training=bool(r["is_training"]), active=bool(r["active"]))
            for r in rows]


@router.get("/sites/destinations", response_model=list[models.Site])
async def dispatch_destinations(
    from_site_id: int, user: auth.User = Depends(auth.current_user)
):
    """Every darkstore a hub may send a tote to.

    GET /sites lists only a person's own sites, which is right everywhere except
    here: a hub operator dispatches to stations they never work at. Training
    stays with training, so practice totes never land at a real station.
    """
    src = await auth.assert_site_access(user, from_site_id)
    rows = await db.fetch_all(
        "SELECT id, code, name, address, site_type, is_training, active FROM sites "
        "WHERE active = 1 AND site_type = 'darkstore' AND id <> %s AND is_training = %s "
        "ORDER BY code",
        (from_site_id, 1 if src["is_training"] else 0),
    )
    return [dict(r, is_training=bool(r["is_training"]), active=bool(r["active"]))
            for r in rows]


@router.post("/sites", response_model=models.Site, status_code=201)
async def create_site(
    body: models.SiteIn, user: auth.User = Depends(auth.require("hq"))
):
    async with db.tx() as cur:
        try:
            sid = await db.run(
                cur,
                "INSERT INTO sites (code, name, address, site_type, is_training) "
                "VALUES (%s,%s,%s,%s,%s)",
                (body.code, body.name, body.address, body.site_type,
                 1 if body.is_training else 0),
            )
        except Exception:
            raise HTTPException(409, f"Site code {body.code} already exists")
        await ledger.audit(cur, actor_email=user.email, entity="site",
                           entity_id=sid, action="create", after=body.model_dump())
    return dict(body.model_dump(), id=sid, active=True)


@router.post("/sites/{site_id}/racks/generate", response_model=models.Ok)
async def generate_racks(
    site_id: int,
    body: models.GenerateRacksIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Build the standard layout in one action, so opening station 8 takes a
    minute rather than an afternoon (M2.1.5)."""
    site = await auth.assert_site_access(user, site_id)
    if body.bin_rows not in (1, 2):
        raise HTTPException(422, "1 atau 2 bin per posisi.")
    existing = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM racks WHERE site_id = %s", (site_id,)
    )
    if existing["n"]:
        raise HTTPException(
            409, f"{site['code']} already has {existing['n']} racks. "
                 "Remove them first, or add racks individually."
        )

    made = {"racks": 0, "locations": 0, "baskets": 0}
    async with db.tx() as cur:
        for order, rc in enumerate(body.rack_codes, start=1):
            rack_id = await db.run(
                cur,
                "INSERT INTO racks (site_id, code, level_count, sort_order) "
                "VALUES (%s,%s,%s,%s)",
                (site_id, rc, body.level_count, order),
            )
            made["racks"] += 1
            for ln in range(1, body.level_count + 1):
                is_open = 1 if f"{rc}{ln}" in body.open_shelf_levels else 0
                level_id = await db.run(
                    cur,
                    "INSERT INTO levels (rack_id, level_no, is_open_shelf) "
                    "VALUES (%s,%s,%s)",
                    (rack_id, ln, is_open),
                )
                positions = [0] if is_open else range(1, body.positions_per_level + 1)
                rows = 1 if is_open else body.bin_rows
                if rows == 2:
                    await db.run(cur, "UPDATE levels SET bin_rows = 2 WHERE id = %s", (level_id,))
                for p in positions:
                    for row in range(1, rows + 1):
                        await racks.add_bin_row(
                            cur, site_id=site_id, site_code=site["code"], rack_code=rc,
                            level_id=level_id, level_no=ln, position=p, row=row,
                            size="OPEN" if is_open else body.basket_size, rows=rows)
                        made["locations"] += 1
                        made["baskets"] += 1
        await ledger.audit(cur, actor_email=user.email, entity="site",
                           entity_id=site_id, action="generate_racks", after=made)
    return {"ok": True,
            "message": f"{made['racks']} racks, {made['baskets']} baskets created."}


@router.get("/sites/{site_id}/rack-map", response_model=models.RackMap)
async def rack_map(site_id: int, user: auth.User = Depends(auth.current_user)):
    """The one dense screen in the product: the whole station at a glance."""
    site = await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT r.id AS rack_id, r.code AS rack_code, r.sort_order, "
        "       lv.id AS level_id, lv.level_no, lv.is_open_shelf, "
        "       l.id AS location_id, l.code AS location_code, l.position_no, "
        "       bk.id AS basket_id, bk.basket_size, "
        "       sa.sku_id, s.name_display AS sku_name, s.expiry_tier, "
        "       COALESCE(ib.qty_on_hand, 0) AS qty_on_hand "
        "FROM racks r "
        "JOIN levels lv ON lv.rack_id = r.id "
        "JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id "
        "LEFT JOIN inventory_balances ib "
        "       ON ib.location_id = l.id AND ib.sku_id = sa.sku_id "
        "WHERE r.site_id = %s "
        "ORDER BY r.sort_order, r.code, lv.level_no, l.position_no",
        (site_id,),
    )

    racks: dict[int, dict] = {}
    slotted = free = 0
    for r in rows:
        rack = racks.setdefault(
            r["rack_id"], {"rack_id": r["rack_id"], "code": r["rack_code"], "levels": {}}
        )
        level = rack["levels"].setdefault(
            r["level_id"],
            {"level_id": r["level_id"], "level_no": r["level_no"],
             "is_open_shelf": bool(r["is_open_shelf"]), "positions": []},
        )
        if r["sku_id"]:
            state = "occupied"
            slotted += 1
        elif r["basket_id"]:
            state = "empty_slot"
            free += 1
        else:
            state = "free"
            free += 1
        level["positions"].append({
            "location_id": r["location_id"], "code": r["location_code"],
            "position_no": r["position_no"], "basket_id": r["basket_id"],
            "basket_size": r["basket_size"], "sku_id": r["sku_id"],
            "sku_name": r["sku_name"], "expiry_tier": r["expiry_tier"],
            "qty_on_hand": int(r["qty_on_hand"] or 0), "state": state,
        })

    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"],
                 "site_type": site["site_type"], "is_training": bool(site["is_training"])},
        "racks": [
            {"rack_id": rk["rack_id"], "code": rk["code"],
             "levels": list(rk["levels"].values())}
            for rk in racks.values()
        ],
        "slotted": slotted,
        "free": free,
    }


@router.get("/slots/suggest", response_model=models.SlotSuggestion)
async def suggest_slot(
    site_id: int,
    sku_id: int,
    user: auth.User = Depends(auth.current_user),
):
    """Recommend a basket size and a free location.

    Slotting rules (PRD §7.3): fast movers to levels 2-3, slow movers to level 5
    which sits at ~2.0 m and needs a step stool.
    """
    await auth.assert_site_access(user, site_id)
    sku = await common.sku_by_id(sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")

    size, reason = common.recommend_basket(sku.get("unit_cube_cm3"))
    free = await db.fetch_one(
        "SELECT bk.id AS basket_id, l.id AS location_id, l.code "
        "FROM baskets bk "
        "JOIN locations l ON l.id = bk.location_id "
        "JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "WHERE bk.site_id = %s AND sa.id IS NULL "
        # prefer comfortable pick height, then bottom, then the top shelf last
        "ORDER BY CASE lv.level_no WHEN 3 THEN 0 WHEN 2 THEN 1 WHEN 4 THEN 2 "
        "         WHEN 1 THEN 3 ELSE 4 END, l.code LIMIT 1",
        (site_id,),
    )
    return {
        "recommended_size": size,
        "reason": reason,
        "location_id": free["location_id"] if free else None,
        "location_code": free["code"] if free else None,
    }


@router.post("/slots", response_model=models.Slot, status_code=201)
async def assign_slot(
    body: models.SlotIn, user: auth.User = Depends(auth.current_user)
):
    """Bind a SKU to a basket. One SKU per basket, one slot per SKU per site —
    both enforced by unique constraint, not only by this check (M2.2.2).

    Racking a SKU is an SPV decision. Staff may do it only from the inbound flow,
    for a known SKU that arrived at a hub where it has no rack yet — the audit
    row marks it, so the SPV can move it later.
    """
    if not user.at_least("supervisor") and not body.created_during_inbound:
        raise HTTPException(403, "Menempatkan SKU ke rak perlu role SPV. / Racking a SKU "
                                 "needs the supervisor role.")
    await auth.assert_site_access(user, body.site_id)
    sku = await common.sku_by_id(body.sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")

    basket_id = body.basket_id
    if basket_id is None:
        suggestion = await suggest_slot(body.site_id, body.sku_id, user)
        if not suggestion["location_id"]:
            raise HTTPException(409, "No free basket at this site.")
        row = await db.fetch_one(
            "SELECT id FROM baskets WHERE location_id = %s", (suggestion["location_id"],)
        )
        basket_id = row["id"]

    occupied = await db.fetch_one(
        "SELECT s.name_display FROM slot_assignments sa "
        "JOIN skus s ON s.id = sa.sku_id WHERE sa.basket_id = %s",
        (basket_id,),
    )
    if occupied:
        raise HTTPException(
            409, f"That basket already holds {occupied['name_display']}."
        )
    role = body.slot_role if body.slot_role in ("primary", "overflow") else "primary"
    # A SKU may hold one pick face AND one overflow — that is the whole point of
    # the role. What it may not do is hold two of either (PRD 7.5).
    same_role = await db.fetch_one(
        "SELECT l.code FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "WHERE sa.site_id = %s AND sa.sku_id = %s AND sa.slot_role = %s",
        (body.site_id, body.sku_id, role),
    )
    if same_role:
        raise HTTPException(
            409,
            f"{sku['name_display']} already has a {role} basket at "
            f"{same_role['code']}. Use relocate to move it.",
        )
    if role == "overflow":
        primary = await db.fetch_one(
            "SELECT id FROM slot_assignments WHERE site_id = %s AND sku_id = %s "
            "AND slot_role = 'primary'",
            (body.site_id, body.sku_id),
        )
        if not primary:
            raise HTTPException(
                409,
                "Give this product a pick face before an overflow — overflow only "
                "ever feeds a primary rack.",
            )

    # A new pick face starts from the thresholds HQ set when registering the SKU;
    # the hub can override its own copy in the registry.
    full = sku.get("default_full_threshold") if role == "primary" else None
    restock = sku.get("default_restock_point") if role == "primary" else None
    if restock is None and full:
        restock = await reminders.default_restock(full)
    safety = sku.get("default_safety_stock") if role == "primary" else None
    async with db.tx() as cur:
        slot_id = await db.run(
            cur,
            "INSERT INTO slot_assignments (site_id, sku_id, basket_id, created_by, "
            "created_during_inbound, slot_role, full_threshold, restock_point, safety_stock) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.site_id, body.sku_id, basket_id, user.email,
             1 if body.created_during_inbound else 0, role, full, restock, safety),
        )
        await ledger.audit(cur, actor_email=user.email, entity="slot",
                           entity_id=slot_id, action="assign",
                           after={"site_id": body.site_id, "sku_id": body.sku_id,
                                  "basket_id": basket_id})
    slot = await common.slot_for(body.site_id, body.sku_id)
    return {
        "id": slot_id, "site_id": body.site_id, "sku_id": body.sku_id,
        "sku_name": sku["name_display"], "basket_id": slot["basket_id"],
        "location_id": slot["location_id"], "location_code": slot["location_code"],
        "basket_size": slot["basket_size"],
    }


@router.post("/slots/{slot_id}/relocate", response_model=models.Slot)
async def relocate_slot(
    slot_id: int,
    basket_id: int = Query(...),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Moving a SKU is an explicit action that writes movements, not an edit
    (M2.2.3). Stock follows the SKU to the new basket."""
    slot = await db.fetch_one(
        "SELECT sa.*, bk.location_id FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id WHERE sa.id = %s",
        (slot_id,),
    )
    if not slot:
        raise HTTPException(404, "Slot not found")
    await auth.assert_site_access(user, slot["site_id"])

    target = await db.fetch_one(
        "SELECT bk.id, bk.location_id, l.code FROM baskets bk "
        "JOIN locations l ON l.id = bk.location_id WHERE bk.id = %s", (basket_id,)
    )
    if not target:
        raise HTTPException(404, "Target basket not found")
    if await db.fetch_one("SELECT 1 AS x FROM slot_assignments WHERE basket_id = %s",
                          (basket_id,)):
        raise HTTPException(409, "Target basket is already occupied.")

    qty = await common.qty_at(slot["site_id"], slot["sku_id"], slot["location_id"])
    async with db.tx() as cur:
        if qty:
            await ledger.apply(
                cur, site_id=slot["site_id"], sku_id=slot["sku_id"],
                location_id=slot["location_id"], qty_delta=-qty,
                movement_type="relocate_out", actor_email=user.email,
                ref_type="slot", ref_id=slot_id, scan_source="system",
            )
            await ledger.apply(
                cur, site_id=slot["site_id"], sku_id=slot["sku_id"],
                location_id=target["location_id"], qty_delta=qty,
                movement_type="relocate_in", actor_email=user.email,
                ref_type="slot", ref_id=slot_id, scan_source="system",
            )
        await db.run(cur, "UPDATE slot_assignments SET basket_id = %s WHERE id = %s",
                     (basket_id, slot_id))
        await db.run(cur, "UPDATE unit_plates SET location_id = %s "
                          "WHERE site_id = %s AND sku_id = %s AND state = 'in_stock'",
                     (target["location_id"], slot["site_id"], slot["sku_id"]))
        await ledger.audit(cur, actor_email=user.email, entity="slot",
                           entity_id=slot_id, action="relocate",
                           before={"basket_id": slot["basket_id"]},
                           after={"basket_id": basket_id, "moved_units": qty})

    sku = await common.sku_by_id(slot["sku_id"])
    new = await common.slot_for(slot["site_id"], slot["sku_id"])
    return {
        "id": slot_id, "site_id": slot["site_id"], "sku_id": slot["sku_id"],
        "sku_name": sku["name_display"], "basket_id": basket_id,
        "location_id": new["location_id"], "location_code": new["location_code"],
        "basket_size": new["basket_size"],
    }


@router.post("/sites/{site_id}/racks", response_model=models.Ok, status_code=201)
async def add_rack(
    site_id: int,
    body: models.AddRackIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Add one rack to a site that already has some.

    generate_racks refuses to run twice and tells the reader to "add racks
    individually" -- which had no endpoint behind it. A station that fills up,
    or one that needs somewhere to put overflow, has to be able to grow by one
    rack without tearing down the layout it already has.
    """
    site = await auth.assert_site_access(user, site_id)
    if body.bin_rows not in (1, 2):
        raise HTTPException(422, "1 atau 2 bin per posisi.")
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(422, "A rack needs a code.")

    clash = await db.fetch_one(
        "SELECT id FROM racks WHERE site_id = %s AND code = %s", (site_id, code)
    )
    if clash:
        raise HTTPException(409, f"{site['code']} already has a rack {code}.")

    order_row = await db.fetch_one(
        "SELECT COALESCE(MAX(sort_order), 0) AS n FROM racks WHERE site_id = %s",
        (site_id,),
    )
    made = {"locations": 0, "baskets": 0}
    async with db.tx() as cur:
        rack_id = await db.run(
            cur,
            "INSERT INTO racks (site_id, code, level_count, sort_order) "
            "VALUES (%s,%s,%s,%s)",
            (site_id, code, body.level_count, int(order_row["n"]) + 1),
        )
        for ln in range(1, body.level_count + 1):
            level_id = await db.run(
                cur,
                "INSERT INTO levels (rack_id, level_no, is_open_shelf, bin_rows) "
                "VALUES (%s,%s,0,%s)",
                (rack_id, ln, body.bin_rows),
            )
            for p in range(1, body.positions_per_level + 1):
                for row in range(1, body.bin_rows + 1):
                    await racks.add_bin_row(
                        cur, site_id=site_id, site_code=site["code"], rack_code=code,
                        level_id=level_id, level_no=ln, position=p, row=row,
                        size=body.basket_size, rows=body.bin_rows)
                    made["locations"] += 1
                    made["baskets"] += 1
        await ledger.audit(cur, actor_email=user.email, entity="site",
                           entity_id=site_id, action="add_rack",
                           after={"code": code, **made})
    return {"ok": True,
            "message": f"Rack {code} added with {made['baskets']} baskets."}
