"""Rack layout: see a hub rack by rack, open one to its levels and bins, and
grow or trim it without rebuilding the station.

A rack is levels; a level is bins (a location plus the basket on it). Every
layout write is SPV or above, scoped to the hub. A bin can only be removed while
it has never held stock: a location that appears in the ledger is history, and
deleting it would orphan the movements that explain where stock went.

The "needs a rack" queue lives here too. A SKU is registered once by HQ, but its
rack is per hub: every hub that carries the brand sees the SKU until someone
gives it a pick face there.
"""
from fastapi import APIRouter, Depends, HTTPException

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["racks"])

SIZES = ("S", "M", "L", "OPEN")


def _prefix(site_code: str) -> str:
    return site_code.split("-")[-1]


def bin_code(site_code: str, rack_code: str, level_no: int, position: int,
             row: int = 1, rows: int = 1) -> str:
    """UT5-A-3-02 on a level with one bin per position.

    With two bins stacked at a position the code says which one: UT5-A-3-02B
    for the Bottom bin (row 1) and UT5-A-3-02T for the Top bin (row 2).
    """
    base = f"{_prefix(site_code)}-{rack_code}-{level_no}-{position:02d}"
    if rows < 2:
        return base
    return base + ("T" if row == 2 else "B")


async def _rack(rack_id: int) -> dict:
    rack = await db.fetch_one(
        "SELECT r.*, s.code AS site_code FROM racks r JOIN sites s ON s.id = r.site_id "
        "WHERE r.id = %s", (rack_id,))
    if not rack:
        raise HTTPException(404, "Rack not found")
    return rack


@router.get("/sites/{site_id}/racks", response_model=models.RackSummaryList)
async def list_racks(site_id: int, user: auth.User = Depends(auth.current_user)):
    """The whole hub, one card per rack: levels, bins per level, how full."""
    site = await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT r.id AS rack_id, r.code, r.sort_order, lv.level_no, "
        "       COUNT(l.id) AS bins, "
        "       SUM(CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END) AS occupied, "
        "       COALESCE(SUM(ib.qty_on_hand), 0) AS units "
        "FROM racks r "
        "LEFT JOIN levels lv ON lv.rack_id = r.id "
        "LEFT JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN inventory_balances ib ON ib.location_id = l.id AND ib.sku_id = sa.sku_id "
        "WHERE r.site_id = %s "
        "GROUP BY r.id, r.code, r.sort_order, lv.level_no "
        "ORDER BY r.sort_order, r.code, lv.level_no",
        (site_id,),
    )
    racks: dict[int, dict] = {}
    for r in rows:
        rk = racks.setdefault(r["rack_id"], {
            "rack_id": r["rack_id"], "code": r["code"], "levels": 0, "bins": 0,
            "occupied": 0, "units": 0, "bins_per_level": [],
        })
        if r["level_no"] is None:
            continue
        rk["levels"] += 1
        rk["bins"] += int(r["bins"] or 0)
        rk["occupied"] += int(r["occupied"] or 0)
        rk["units"] += int(r["units"] or 0)
        rk["bins_per_level"].append(int(r["bins"] or 0))
    waiting = await _needs_rack(site_id, count_only=True)
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"],
                 "site_type": site["site_type"], "is_training": bool(site["is_training"])},
        "racks": list(racks.values()),
        "needs_rack": waiting,
        "inbound_bins": site.get("inbound_bins"),
    }


@router.put("/sites/{site_id}/inbound-bins", response_model=models.Ok)
async def set_inbound_bins(
    site_id: int, body: models.InboundBinsIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """How many temporary inbound bins the hub has.

    One bin holds one SKU while a delivery is received, so this is how many
    different SKUs one inbound batch can take. Empty = not limited.
    """
    await auth.assert_site_access(user, site_id)
    n = body.inbound_bins
    if n is not None and not 1 <= n <= 200:
        raise HTTPException(422, "Isi 1 sampai 200, atau kosongkan. / Enter 1 to 200, or leave empty.")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE sites SET inbound_bins = %s WHERE id = %s", (n, site_id))
        await ledger.audit(cur, actor_email=user.email, entity="site", entity_id=site_id,
                           action="inbound_bins", after={"inbound_bins": n})
    return {"ok": True, "message": (f"{n} bin inbound sementara." if n
                                    else "Bin inbound sementara tidak dibatasi.")}


@router.get("/racks/{rack_id}", response_model=models.RackDetail)
async def rack_detail(rack_id: int, user: auth.User = Depends(auth.current_user)):
    """One rack, level by level, every bin with what it holds."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    rows = await db.fetch_all(
        "SELECT lv.id AS level_id, lv.level_no, lv.is_open_shelf, "
        "       lv.bin_rows, l.id AS location_id, l.code, l.position_no, l.bin_row, "
        "       bk.id AS basket_id, bk.basket_size, "
        "       sa.sku_id, sa.slot_role, s.name_display AS sku_name, s.brand_sku_code, "
        "       COALESCE(ib.qty_on_hand, 0) AS qty_on_hand, "
        "       EXISTS (SELECT 1 FROM stock_movements m WHERE m.location_id = l.id) AS used "
        "FROM levels lv "
        "LEFT JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id "
        "LEFT JOIN inventory_balances ib ON ib.location_id = l.id AND ib.sku_id = sa.sku_id "
        "WHERE lv.rack_id = %s "
        "ORDER BY lv.level_no, l.position_no, l.bin_row",
        (rack_id,),
    )
    levels: dict[int, dict] = {}
    bins = occupied = 0
    for r in rows:
        lv = levels.setdefault(r["level_id"], {
            "level_id": r["level_id"], "level_no": r["level_no"],
            "is_open_shelf": bool(r["is_open_shelf"]), "bin_rows": int(r["bin_rows"] or 1),
            "bins": [],
        })
        if r["location_id"] is None:
            continue
        bins += 1
        if r["sku_id"]:
            occupied += 1
        lv["bins"].append({
            "location_id": r["location_id"], "code": r["code"],
            "position_no": r["position_no"], "bin_row": int(r["bin_row"] or 1),
            "basket_id": r["basket_id"],
            "basket_size": r["basket_size"], "sku_id": r["sku_id"],
            "sku_name": r["sku_name"], "brand_sku_code": r["brand_sku_code"],
            "slot_role": r["slot_role"], "qty_on_hand": int(r["qty_on_hand"] or 0),
            "removable": not r["sku_id"] and not int(r["used"] or 0),
        })
    out_levels = list(levels.values())
    top = out_levels[-1] if out_levels else None
    for lv in out_levels:
        lv["removable"] = (lv is top and all(b["removable"] for b in lv["bins"]))
    return {
        "rack": {"rack_id": rack["id"], "code": rack["code"], "site_id": rack["site_id"],
                 "site_code": rack["site_code"], "levels": len(out_levels),
                 "bins": bins, "occupied": occupied},
        # Top level first: the screen reads like the rack standing in front of you.
        "levels": list(reversed(out_levels)),
    }


async def add_bin_row(cur, *, site_id: int, site_code: str, rack_code: str,
                      level_id: int, level_no: int, position: int, row: int,
                      size: str, rows: int = 1) -> int:
    loc_id = await db.run(
        cur,
        "INSERT INTO locations (level_id, site_id, position_no, bin_row, code) "
        "VALUES (%s,%s,%s,%s,%s)",
        (level_id, site_id, position, row,
         bin_code(site_code, rack_code, level_no, position, row, rows)),
    )
    await db.run(
        cur, "INSERT INTO baskets (location_id, site_id, basket_size) VALUES (%s,%s,%s)",
        (loc_id, site_id, size),
    )
    return loc_id


async def _add_bins(cur, *, site_id: int, site_code: str, rack_code: str,
                    level_id: int, level_no: int, start: int, count: int,
                    size: str, rows: int = 1) -> int:
    """`count` positions, each with `rows` bins (1, or 2 stacked: Bottom and Top)."""
    for p in range(start, start + count):
        for row in range(1, rows + 1):
            await add_bin_row(cur, site_id=site_id, site_code=site_code, rack_code=rack_code,
                              level_id=level_id, level_no=level_no, position=p, row=row,
                              size=size, rows=rows)
    return count * rows


def _rows(n: int) -> int:
    if n not in (1, 2):
        raise HTTPException(422, "Satu tingkat memuat 1 atau 2 bin per posisi. / "
                                 "A level holds 1 or 2 bins per position.")
    return n


def _size(size: str) -> str:
    s = (size or "M").upper()
    if s not in SIZES:
        raise HTTPException(422, "Basket size must be S, M, L or OPEN.")
    return s


@router.post("/racks/{rack_id}/levels", response_model=models.Ok, status_code=201)
async def add_level(
    rack_id: int, body: models.AddLevelIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Put a new level on top of a rack."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    if not 1 <= body.bins <= 30:
        raise HTTPException(422, "A level holds 1 to 30 bins.")
    size = "OPEN" if body.open_shelf else _size(body.basket_size)
    rows = 1 if body.open_shelf else _rows(body.bin_rows)
    top = await db.fetch_one(
        "SELECT COALESCE(MAX(level_no), 0) AS n FROM levels WHERE rack_id = %s", (rack_id,))
    level_no = int(top["n"]) + 1
    async with db.tx() as cur:
        level_id = await db.run(
            cur, "INSERT INTO levels (rack_id, level_no, is_open_shelf, bin_rows) "
                 "VALUES (%s,%s,%s,%s)",
            (rack_id, level_no, 1 if body.open_shelf else 0, rows))
        await _add_bins(cur, site_id=rack["site_id"], site_code=rack["site_code"],
                        rack_code=rack["code"], level_id=level_id, level_no=level_no,
                        start=1, count=body.bins, size=size, rows=rows)
        await db.run(cur, "UPDATE racks SET level_count = %s WHERE id = %s",
                     (level_no, rack_id))
        await ledger.audit(cur, actor_email=user.email, entity="rack", entity_id=rack_id,
                           action="add_level",
                           after={"level_no": level_no, "bins": body.bins, "size": size})
    return {"ok": True, "message": f"Rak {rack['code']} tingkat {level_no}: {body.bins} bin."}


@router.post("/levels/{level_id}/bins", response_model=models.Ok, status_code=201)
async def add_bins(
    level_id: int, body: models.AddBinsIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Add bins to the end of a level."""
    level = await db.fetch_one(
        "SELECT lv.*, r.code AS rack_code, r.site_id, s.code AS site_code "
        "FROM levels lv JOIN racks r ON r.id = lv.rack_id JOIN sites s ON s.id = r.site_id "
        "WHERE lv.id = %s", (level_id,))
    if not level:
        raise HTTPException(404, "Level not found")
    await auth.assert_site_access(user, level["site_id"])
    if not 1 <= body.count <= 30:
        raise HTTPException(422, "Add 1 to 30 bins at a time.")
    size = "OPEN" if level["is_open_shelf"] else _size(body.basket_size)
    last = await db.fetch_one(
        "SELECT COALESCE(MAX(position_no), 0) AS n FROM locations WHERE level_id = %s",
        (level_id,))
    start = int(last["n"]) + 1
    async with db.tx() as cur:
        await _add_bins(cur, site_id=level["site_id"], site_code=level["site_code"],
                        rack_code=level["rack_code"], level_id=level_id,
                        level_no=level["level_no"], start=start, count=body.count, size=size,
                        rows=int(level["bin_rows"] or 1))
        await ledger.audit(cur, actor_email=user.email, entity="level", entity_id=level_id,
                           action="add_bins", after={"count": body.count, "size": size})
    return {"ok": True,
            "message": f"{body.count} bin ditambahkan di {level['rack_code']}-{level['level_no']}."}


@router.put("/levels/{level_id}/bin-rows", response_model=models.Ok)
async def set_bin_rows(
    level_id: int, body: models.BinRowsIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Stack a second bin on every position of a level, or take it away.

    Two bins: the bin already there becomes the Bottom (...B) and a Top (...T) is
    added above it. Back to one: the Top bins are removed -- refused while any
    holds a SKU or ever held stock -- and the Bottom bins get their plain code
    back. Bins are referenced by id everywhere, so a new code loses nothing.
    """
    level = await db.fetch_one(
        "SELECT lv.*, r.code AS rack_code, r.site_id, s.code AS site_code "
        "FROM levels lv JOIN racks r ON r.id = lv.rack_id JOIN sites s ON s.id = r.site_id "
        "WHERE lv.id = %s", (level_id,))
    if not level:
        raise HTTPException(404, "Level not found")
    await auth.assert_site_access(user, level["site_id"])
    rows = _rows(body.bin_rows)
    if level["is_open_shelf"] and rows == 2:
        raise HTTPException(422, "Rak terbuka tidak memakai bin bertumpuk. / "
                                 "Open shelves do not take stacked bins.")
    positions = await db.fetch_all(
        "SELECT position_no, MAX(bin_row) AS max_row, MIN(bk.basket_size) AS size "
        "FROM locations l LEFT JOIN baskets bk ON bk.location_id = l.id "
        "WHERE l.level_id = %s GROUP BY position_no ORDER BY position_no", (level_id,))
    b_bins = await db.fetch_all(
        "SELECT id FROM locations WHERE level_id = %s AND bin_row = 2", (level_id,))
    if rows == 1:
        for b in b_bins:
            await _assert_unused(b["id"])
    bottoms = await db.fetch_all(
        "SELECT id, position_no FROM locations WHERE level_id = %s AND bin_row = 1", (level_id,))
    async with db.tx() as cur:
        if rows == 1:
            for b in b_bins:
                await db.run(cur, "DELETE FROM baskets WHERE location_id = %s", (b["id"],))
                await db.run(cur, "DELETE FROM locations WHERE id = %s", (b["id"],))
        # The bin already at each position becomes the Bottom one (...B), or plain again.
        for b in bottoms:
            if b["position_no"]:
                await db.run(cur, "UPDATE locations SET code = %s WHERE id = %s",
                             (bin_code(level["site_code"], level["rack_code"], level["level_no"],
                                       b["position_no"], 1, rows), b["id"]))
        if rows == 2:
            for p in positions:
                if int(p["max_row"] or 1) < 2:
                    await add_bin_row(cur, site_id=level["site_id"], site_code=level["site_code"],
                                      rack_code=level["rack_code"], level_id=level_id,
                                      level_no=level["level_no"], position=p["position_no"],
                                      row=2, size=p["size"] or "M", rows=2)
        await db.run(cur, "UPDATE levels SET bin_rows = %s WHERE id = %s", (rows, level_id))
        await ledger.audit(cur, actor_email=user.email, entity="level", entity_id=level_id,
                           action="bin_rows", after={"bin_rows": rows})
    return {"ok": True, "message": (
        f"{level['rack_code']}-{level['level_no']}: " +
        ("2 bin bertumpuk per posisi: atas (T) dan bawah (B)." if rows == 2
         else "1 bin per posisi."))}


async def _assert_unused(location_id: int) -> dict:
    loc = await db.fetch_one(
        "SELECT l.*, bk.id AS basket_id FROM locations l "
        "LEFT JOIN baskets bk ON bk.location_id = l.id WHERE l.id = %s", (location_id,))
    if not loc:
        raise HTTPException(404, "Bin not found")
    if loc["basket_id"] and await db.fetch_one(
            "SELECT 1 AS x FROM slot_assignments WHERE basket_id = %s", (loc["basket_id"],)):
        raise HTTPException(409, f"{loc['code']} masih dipakai produk. Pindahkan dulu.")
    if await db.fetch_one("SELECT 1 AS x FROM stock_movements WHERE location_id = %s LIMIT 1",
                          (location_id,)):
        raise HTTPException(
            409, f"{loc['code']} pernah menyimpan stok, jadi riwayatnya harus tetap ada. "
                 "Bin ini tidak bisa dihapus.")
    return loc


@router.delete("/locations/{location_id}", response_model=models.Ok)
async def remove_bin(location_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Remove a bin that was never used."""
    loc = await _assert_unused(location_id)
    await auth.assert_site_access(user, loc["site_id"])
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM baskets WHERE location_id = %s", (location_id,))
        await db.run(cur, "DELETE FROM locations WHERE id = %s", (location_id,))
        await ledger.audit(cur, actor_email=user.email, entity="location",
                           entity_id=location_id, action="remove_bin",
                           before={"code": loc["code"]})
    return {"ok": True, "message": f"Bin {loc['code']} dihapus."}


@router.delete("/levels/{level_id}", response_model=models.Ok)
async def remove_level(level_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Remove the top level of a rack, if none of its bins was ever used."""
    level = await db.fetch_one(
        "SELECT lv.*, r.code AS rack_code, r.site_id FROM levels lv "
        "JOIN racks r ON r.id = lv.rack_id WHERE lv.id = %s", (level_id,))
    if not level:
        raise HTTPException(404, "Level not found")
    await auth.assert_site_access(user, level["site_id"])
    top = await db.fetch_one("SELECT MAX(level_no) AS n FROM levels WHERE rack_id = %s",
                             (level["rack_id"],))
    if level["level_no"] != top["n"]:
        raise HTTPException(409, "Hanya tingkat paling atas yang bisa dihapus.")
    locs = await db.fetch_all("SELECT id FROM locations WHERE level_id = %s", (level_id,))
    for l in locs:
        await _assert_unused(l["id"])
    async with db.tx() as cur:
        for l in locs:
            await db.run(cur, "DELETE FROM baskets WHERE location_id = %s", (l["id"],))
            await db.run(cur, "DELETE FROM locations WHERE id = %s", (l["id"],))
        await db.run(cur, "DELETE FROM levels WHERE id = %s", (level_id,))
        await db.run(cur, "UPDATE racks SET level_count = GREATEST(level_count - 1, 0) "
                          "WHERE id = %s", (level["rack_id"],))
        await ledger.audit(cur, actor_email=user.email, entity="level", entity_id=level_id,
                           action="remove_level",
                           before={"rack": level["rack_code"], "level_no": level["level_no"]})
    return {"ok": True,
            "message": f"Tingkat {level['level_no']} rak {level['rack_code']} dihapus."}


@router.patch("/baskets/{basket_id}", response_model=models.Ok)
async def set_basket_size(
    basket_id: int, body: models.BasketPatch,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Record a basket swapped for another size."""
    bk = await db.fetch_one(
        "SELECT bk.*, l.code FROM baskets bk JOIN locations l ON l.id = bk.location_id "
        "WHERE bk.id = %s", (basket_id,))
    if not bk:
        raise HTTPException(404, "Basket not found")
    await auth.assert_site_access(user, bk["site_id"])
    size = _size(body.basket_size)
    await db.execute("UPDATE baskets SET basket_size = %s WHERE id = %s", (size, basket_id))
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'basket.size','baskets',%s,%s)", (user.email, basket_id, size))
    return {"ok": True, "message": f"{bk['code']}: keranjang {size}."}


# --- needs a rack -------------------------------------------------------------

async def _needs_rack(site_id: int, count_only: bool = False):
    # A brand is carried at a hub unless a brand_sites row switches it off there.
    base = (
        "FROM skus s JOIN brands b ON b.id = s.brand_id "
        "JOIN sites st ON st.id = %s "
        "LEFT JOIN brand_sites bs ON bs.brand_id = b.id AND bs.site_id = st.id "
        "WHERE s.active = 1 AND b.active = 1 AND st.site_type <> 'hub' "
        "  AND COALESCE(bs.active, 1) = 1 "
        "  AND NOT EXISTS (SELECT 1 FROM slot_assignments sa WHERE sa.site_id = st.id "
        "                  AND sa.sku_id = s.id AND sa.slot_role = 'primary') "
    )
    if count_only:
        row = await db.fetch_one("SELECT COUNT(*) AS n " + base, (site_id,))
        return int(row["n"])
    return await db.fetch_all(
        f"SELECT {common.SKU_COLS}, s.default_restock_point, s.default_full_threshold, "
        "       s.created_at " + base + "ORDER BY s.created_at DESC, s.name_display LIMIT 500",
        (site_id,),
    )


@router.get("/sites/{site_id}/needs-rack", response_model=models.NeedsRackList)
async def needs_rack(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Registered SKUs this hub carries that have no pick face here yet."""
    await auth.assert_site_access(user, site_id)
    rows = await _needs_rack(site_id)
    out = []
    for r in rows:
        size, _ = common.recommend_basket(r.get("unit_cube_cm3"))
        out.append(dict(common.sku_dict(r), recommended_size=size,
                        default_restock_point=r["default_restock_point"],
                        default_full_threshold=r["default_full_threshold"],
                        created_at=str(r["created_at"])))
    return {"skus": out, "total": len(out)}


@router.get("/skus/{sku_id}/racks", response_model=models.SkuRackList)
async def sku_racks(sku_id: int, user: auth.User = Depends(auth.require("hq"))):
    """Where one SKU lives, hub by hub — and which hubs still need to rack it."""
    if not await common.sku_by_id(sku_id):
        raise HTTPException(404, "SKU not found")
    rows = await db.fetch_all(
        "SELECT st.id AS site_id, st.code AS site_code, st.name AS site_name, "
        "       st.is_training, l.code AS location_code, sa.restock_point, "
        "       sa.full_threshold "
        "FROM sites st "
        "JOIN skus s ON s.id = %s "
        "LEFT JOIN brand_sites bs ON bs.brand_id = s.brand_id AND bs.site_id = st.id "
        "LEFT JOIN slot_assignments sa ON sa.site_id = st.id AND sa.sku_id = s.id "
        "     AND sa.slot_role = 'primary' "
        "LEFT JOIN baskets bk ON bk.id = sa.basket_id "
        "LEFT JOIN locations l ON l.id = bk.location_id "
        "WHERE st.active = 1 AND st.site_type <> 'hub' AND COALESCE(bs.active, 1) = 1 "
        "ORDER BY st.is_training, st.code",
        (sku_id,),
    )
    return {"sites": [dict(r, is_training=bool(r["is_training"])) for r in rows]}


# --- Ops HQ: every hub at a glance, and one hub's layout map -----------------------

def _bin_status(sku_id, qty_total, restock_point, safety_stock=None) -> str:
    if not sku_id:
        return "empty"
    if restock_point is None:
        return "unset"
    if not qty_total:
        return "out"
    if safety_stock is not None and qty_total <= safety_stock:
        return "critical"
    if qty_total <= restock_point:
        return "low"
    return "ok"


@router.get("/hq/hubs", response_model=models.HubOverviewList)
async def hub_overview(user: auth.User = Depends(auth.require("hq"))):
    """Rack availability and stock health for every hub, one row each."""
    sites = await db.fetch_all(
        "SELECT id, code, name, site_type, is_training FROM sites "
        "WHERE active = 1 AND site_type <> 'hub' ORDER BY is_training, code")
    out = []
    for s in sites:
        bins = await db.fetch_one(
            "SELECT COUNT(DISTINCT r.id) AS racks, COUNT(l.id) AS bins, "
            "       SUM(CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END) AS used "
            "FROM racks r JOIN levels lv ON lv.rack_id = r.id "
            "JOIN locations l ON l.level_id = lv.id "
            "LEFT JOIN baskets bk ON bk.location_id = l.id "
            "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
            "WHERE r.site_id = %s", (s["id"],))
        stock = await db.fetch_one(
            "SELECT COUNT(*) AS skus, "
            "       SUM(CASE WHEN x.restock_point IS NULL THEN 1 ELSE 0 END) AS unset_n, "
            "       SUM(CASE WHEN x.restock_point IS NOT NULL AND x.qty = 0 THEN 1 ELSE 0 END) AS out_n, "
            "       SUM(CASE WHEN x.restock_point IS NOT NULL AND x.qty > 0 "
            "                 AND x.qty <= x.restock_point THEN 1 ELSE 0 END) AS low_n, "
            "       SUM(CASE WHEN x.safety_stock IS NOT NULL AND x.qty > 0 "
            "                 AND x.qty <= x.safety_stock THEN 1 ELSE 0 END) AS crit_n, "
            "       COALESCE(SUM(x.qty), 0) AS units "
            "FROM (SELECT sa.sku_id, sa.restock_point, sa.safety_stock, "
            "             (SELECT COALESCE(SUM(ib.qty_on_hand), 0) FROM inventory_balances ib "
            "               WHERE ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id) AS qty "
            "        FROM slot_assignments sa "
            "       WHERE sa.site_id = %s AND sa.slot_role = 'primary') x", (s["id"],))
        flow = await db.fetch_one(
            "SELECT SUM(CASE WHEN status IN ('confirmed','receiving') THEN 1 ELSE 0 END) AS incoming, "
            "       SUM(CASE WHEN status IN ('variance_review','variance_signoff') THEN 1 ELSE 0 END) "
            "         AS variance "
            "FROM replenishments WHERE site_id = %s", (s["id"],))
        total = int(bins["bins"] or 0)
        used = int(bins["used"] or 0)
        out.append({
            "site_id": s["id"], "site_code": s["code"], "site_name": s["name"],
            "is_training": bool(s["is_training"]),
            "racks": int(bins["racks"] or 0), "bins": total, "bins_used": used,
            "bins_free": total - used,
            "needs_rack": await _needs_rack(s["id"], count_only=True),
            "skus_racked": int(stock["skus"] or 0), "units": int(stock["units"] or 0),
            "skus_low": int(stock["low_n"] or 0), "skus_out": int(stock["out_n"] or 0),
            "skus_critical": int(stock["crit_n"] or 0),
            "skus_unset": int(stock["unset_n"] or 0),
            "deliveries_incoming": int(flow["incoming"] or 0),
            "variances_open": int(flow["variance"] or 0),
        })
    return {"hubs": out}


@router.get("/sites/{site_id}/layout", response_model=models.LayoutMap)
async def layout_map(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Every rack of a hub, every bin, with what it holds and how healthy that
    SKU's stock is at the hub (rack + overflow against its restock point)."""
    site = await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT r.id AS rack_id, r.code AS rack_code, lv.id AS level_id, lv.level_no, "
        "       l.id AS location_id, l.code, l.position_no, l.bin_row, lv.bin_rows, "
        "       bk.id AS basket_id, bk.basket_size, "
        "       sa.sku_id, sa.slot_role, s.name_display, s.brand_sku_code, s.photo_key, "
        "       COALESCE(ib.qty_on_hand, 0) AS qty_here, t.qty_total, "
        "       p.restock_point, p.full_threshold, p.safety_stock "
        "FROM racks r "
        "JOIN levels lv ON lv.rack_id = r.id "
        "JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id "
        "LEFT JOIN inventory_balances ib ON ib.location_id = l.id AND ib.sku_id = sa.sku_id "
        "LEFT JOIN (SELECT sku_id, SUM(qty_on_hand) AS qty_total FROM inventory_balances "
        "            WHERE site_id = %s GROUP BY sku_id) t ON t.sku_id = sa.sku_id "
        "LEFT JOIN slot_assignments p ON p.site_id = r.site_id AND p.sku_id = sa.sku_id "
        "     AND p.slot_role = 'primary' "
        "WHERE r.site_id = %s "
        "ORDER BY r.sort_order, r.code, lv.level_no DESC, l.position_no, l.bin_row",
        (site_id, site_id))
    racks: dict[int, dict] = {}
    counts = {"empty": 0, "ok": 0, "low": 0, "critical": 0, "out": 0, "unset": 0}
    for r in rows:
        rk = racks.setdefault(r["rack_id"], {"rack_id": r["rack_id"], "code": r["rack_code"],
                                             "levels": {}})
        lv = rk["levels"].setdefault(r["level_id"], {"level_id": r["level_id"],
                                                     "level_no": r["level_no"],
                                                     "bin_rows": int(r["bin_rows"] or 1),
                                                     "bins": []})
        qty_total = int(r["qty_total"] or 0)
        status = _bin_status(r["sku_id"], qty_total, r["restock_point"], r["safety_stock"])
        counts[status] += 1
        lv["bins"].append({
            "location_id": r["location_id"], "code": r["code"], "position_no": r["position_no"],
            "bin_row": int(r["bin_row"] or 1),
            "basket_id": r["basket_id"], "basket_size": r["basket_size"],
            "sku_id": r["sku_id"], "sku_name": r["name_display"],
            "brand_sku_code": r["brand_sku_code"], "photo_key": r["photo_key"],
            "slot_role": r["slot_role"], "qty_here": int(r["qty_here"] or 0),
            "qty_total": qty_total if r["sku_id"] else 0,
            "restock_point": r["restock_point"], "full_threshold": r["full_threshold"],
            "safety_stock": r["safety_stock"], "status": status,
        })
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"],
                 "site_type": site["site_type"], "is_training": bool(site["is_training"])},
        "racks": [{"rack_id": rk["rack_id"], "code": rk["code"],
                   "levels": list(rk["levels"].values())} for rk in racks.values()],
        "counts": counts,
        "needs_rack": await _needs_rack(site_id, count_only=True),
    }
