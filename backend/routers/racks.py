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
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["racks"])

# Two bin sizes only (decided 1 Oct): Kecil fits a 15 x 10 x 20 cm box, Besar is
# anything larger or a bottle of 150 ml or more. The limits are settings
# (alert_rules bin_kecil_*, bin_besar_bottle_ml), shown on Produk.
SIZES = ("KECIL", "BESAR")
SIZE_LABEL = {"KECIL": "Kecil", "BESAR": "Besar"}
# Older names still accepted on input, so a stale client never writes a third size.
_SIZE_ALIASES = {"KECIL": "KECIL", "K": "KECIL", "S": "KECIL", "SMALL": "KECIL",
                 "BESAR": "BESAR", "B": "BESAR", "M": "BESAR", "L": "BESAR",
                 "LARGE": "BESAR", "OPEN": "BESAR"}


def norm_size(size) -> str | None:
    """KECIL | BESAR from anything a person or an old client sends; None if unknown."""
    return _SIZE_ALIASES.get(str(size or "").strip().upper())


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
                      size: str, rows: int = 1, kolom_no: int | None = 1) -> int:
    loc_id = await db.run(
        cur,
        "INSERT INTO locations (level_id, site_id, position_no, bin_row, code, kolom_no) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (level_id, site_id, position, row,
         bin_code(site_code, rack_code, level_no, position, row, rows), kolom_no),
    )
    await db.run(
        cur, "INSERT INTO baskets (location_id, site_id, basket_size) VALUES (%s,%s,%s)",
        (loc_id, site_id, norm_size(size) or "BESAR"),
    )
    return loc_id


async def _add_bins(cur, *, site_id: int, site_code: str, rack_code: str,
                    level_id: int, level_no: int, start: int, count: int,
                    size: str, rows: int = 1, kolom_no: int | None = 1) -> int:
    """`count` positions, each with `rows` bins (1, or 2 stacked: Bottom and Top)."""
    for p in range(start, start + count):
        for row in range(1, rows + 1):
            await add_bin_row(cur, site_id=site_id, site_code=site_code, rack_code=rack_code,
                              level_id=level_id, level_no=level_no, position=p, row=row,
                              size=size, rows=rows, kolom_no=kolom_no)
    return count * rows


def _rows(n: int) -> int:
    if n not in (1, 2):
        raise HTTPException(422, "Satu tingkat memuat 1 atau 2 bin per posisi. / "
                                 "A level holds 1 or 2 bins per position.")
    return n


def _size(size: str) -> str:
    s = norm_size(size or "BESAR")
    if s is None:
        raise HTTPException(422, "Ukuran bin harus Kecil atau Besar. / Bin size must be "
                                 "Kecil or Besar.")
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
    size = _size(body.basket_size)
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
    size = _size(body.basket_size)
    last = await db.fetch_one(
        "SELECT COALESCE(MAX(position_no), 0) AS n, COALESCE(MAX(kolom_no), 1) AS k "
        "FROM locations WHERE level_id = %s",
        (level_id,))
    start = int(last["n"]) + 1
    async with db.tx() as cur:
        await _add_bins(cur, site_id=level["site_id"], site_code=level["site_code"],
                        rack_code=level["rack_code"], level_id=level_id,
                        level_no=level["level_no"], start=start, count=body.count, size=size,
                        rows=int(level["bin_rows"] or 1), kolom_no=int(last["k"]))
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
                                      row=2, size=p["size"] or "BESAR", rows=2)
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
    return {"ok": True, "message": f"{bk['code']}: bin {SIZE_LABEL[size]}."}


# --- needs a rack -------------------------------------------------------------

# A brand is sold at a hub when one of its Hiryu stores sits at that hub, or when
# a brand_sites row switches it on there (hubs set up before the link).
CARRIED_SQL = (
    "(EXISTS (SELECT 1 FROM hiryu_stores hs WHERE hs.site_id = st.id AND hs.brand_id = b.id "
    "         AND hs.active = 1) "
    " OR EXISTS (SELECT 1 FROM brand_sites bs WHERE bs.site_id = st.id AND bs.brand_id = b.id "
    "            AND bs.active = 1))"
)


def needs_bin_from(where_extra: str = "") -> str:
    """FROM/WHERE for SKUs that need a bin at hub %s (canvas 3e).

    A SKU needs a bin at a hub when it is sold there, has its bin size (the one
    required field, canvas 2f) and has no pick face there yet. Aliases: s, b, st.
    """
    return (
        "FROM skus s JOIN brands b ON b.id = s.brand_id "
        "JOIN sites st ON st.id = %s "
        "WHERE s.active = 1 AND b.active = 1 AND st.site_type <> 'hub' "
        f"  AND {CARRIED_SQL} "
        "  AND s.bin_size IS NOT NULL "
        "  AND NOT EXISTS (SELECT 1 FROM slot_assignments sa WHERE sa.site_id = st.id "
        "                  AND sa.sku_id = s.id AND sa.slot_role = 'primary') " + where_extra
    )


async def _needs_rack(site_id: int, count_only: bool = False):
    base = needs_bin_from()
    if count_only:
        row = await db.fetch_one("SELECT COUNT(*) AS n " + base, (site_id,))
        return int(row["n"])
    return await db.fetch_all(
        f"SELECT {common.SKU_COLS}, s.default_restock_point, s.default_full_threshold, "
        "       s.created_at, s.bin_size " + base +
        "ORDER BY s.created_at DESC, s.name_display LIMIT 500",
        (site_id,),
    )


@router.get("/sites/{site_id}/needs-rack", response_model=models.NeedsRackList)
async def needs_rack(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Registered SKUs this hub carries that have no pick face here yet."""
    await auth.assert_site_access(user, site_id)
    rows = await _needs_rack(site_id)
    out = []
    for r in rows:
        out.append(dict(common.sku_dict(r), recommended_size=r.get("bin_size") or "BESAR",
                        default_restock_point=r["default_restock_point"],
                        default_full_threshold=r["default_full_threshold"],
                        created_at=str(r["created_at"])))
    return {"skus": out, "total": len(out)}


@router.get("/skus/{sku_id}/racks", response_model=models.SkuRackList)
async def sku_racks(sku_id: int, user: auth.User = Depends(auth.current_user)):
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
async def hub_overview(user: auth.User = Depends(auth.current_user)):
    """Rack availability and stock health for every hub, one row each.

    Everyone may look (every role sees every menu); below Ops HQ only one's own hubs.
    """
    sites = await db.fetch_all(
        "SELECT id, code, name, site_type, is_training FROM sites "
        "WHERE active = 1 AND site_type <> 'hub' ORDER BY is_training, code")
    if not user.at_least("hq"):
        mine = {int(r["site_id"]) for r in await db.fetch_all(
            "SELECT site_id FROM user_sites WHERE user_id = %s", (user.id,))}
        sites = [s for s in sites if int(s["id"]) in mine]
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
async def layout_map(site_id: int, user: auth.User = Depends(auth.current_user)):
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


# =============================================================================
# Deploy 3: Rak & bin (canvas 3a to 3e)
# =============================================================================
#
# A rack has levels (1 = the bottom shelf). Each level is split into kolom (the
# part of the rack between two uprights; never "bay"), and each kolom holds bins,
# every bin with its own size, Kecil or Besar. Bin codes run per level from left
# to right across the whole rack, ignoring kolom: with two kolom of 3 bins,
# level 2 of rack A is A-2-01 to A-2-06. The stored code carries the hub
# (MA5-A-2-01, unique across hubs, and what the label's barcode holds); screens
# show the short code (A-2-01) and the label shows the kolom on a small line.

_BULAN = ("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
          "September", "Oktober", "November", "Desember")
_ORDINAL = ("pertama", "kedua", "ketiga", "keempat", "kelima", "keenam", "ketujuh",
            "kedelapan", "kesembilan", "kesepuluh")
_RACK_CODE = re.compile(r"^[A-Z0-9]{1,4}$")
MAX_LEVELS, MAX_KOLOM, MAX_PER_KOLOM, MAX_PER_LEVEL = 10, 10, 20, 40
LABELS_PER_PAGE = 12
# Suggested level for a new bin: waist height first (canvas 3e).
LEVEL_PREFERENCE = (3, 2, 4, 1, 5)

LABEL_TOP_NOTE = ("Kertas A4 biasa, printer apa saja. Tempel tiap label di depan bin, kiri "
                  "bawah. Strip level di balok depan, paling kiri.")
LABEL_CUT_NOTE = ("Cetak di kertas A4 biasa. Gunting di garis putus-putus, tempel dengan "
                  "selotip bening menutupi seluruh label.")
LABEL_FOOTER = "Kilat WMS · Rak & bin · Cetak label"
LABEL_LOST_NOTE = "Label hilang? Cetak ulang dari bin itu di Rak & bin."

SPECIAL_TEXT = {
    "IN": ("Bin barang masuk sementara",
           "Barang dari truk menunggu di sini sampai disimpan ke rak."),
    "QR": ("Baki karantina (QR)", "Barang rusak atau ditahan, sampai SPV memutuskan."),
    "OUT": ("Keranjang pesanan",
            "Satu keranjang untuk satu pesanan saat diambil. Label di sisi keranjang."),
}


def wib_now() -> datetime:
    return datetime.utcnow() + timedelta(hours=7)


def wib_date_text(dt: datetime | None = None) -> str:
    """28 Mei 2026, for a WIB moment (default: now)."""
    d = dt or wib_now()
    return f"{d.day} {_BULAN[d.month - 1]} {d.year}"


def iso(v) -> str | None:
    """A stored UTC DATETIME as ISO 8601 with Z, for the browser to show in WIB."""
    if not v:
        return None
    return v.isoformat() + "Z" if isinstance(v, datetime) else str(v)


def short_code(code: str | None, site_code: str) -> str | None:
    """MA5-A-2-03 -> A-2-03. Special bins (MA5-IN-01) keep the hub."""
    if not code:
        return code
    p = _prefix(site_code) + "-"
    if code.startswith(p) and code.count("-") >= 3:
        return code[len(p):]
    return code


def ordinal_id(n: int) -> str:
    return _ORDINAL[n - 1] if 1 <= n <= len(_ORDINAL) else f"ke-{n}"


def size_label(size: str | None) -> str | None:
    s = norm_size(size)
    return SIZE_LABEL.get(s) if s else None


def _levels_text(nos: list[int]) -> str:
    nos = [str(n) for n in nos]
    if len(nos) == 1:
        return f"level {nos[0]}"
    return "level " + ", ".join(nos[:-1]) + " dan " + nos[-1]


def level_size_text(sizes: list[str]) -> str:
    """Kecil | Besar | campur, for a level's heading."""
    have = set(sizes)
    if len(have) == 1:
        return SIZE_LABEL[next(iter(have))]
    return "campur"


def strip_text(bins: list[dict]) -> str:
    """'A-5-01 sampai A-5-06 · bin Kecil, kecuali A-5-03 Besar' for a level strip."""
    if not bins:
        return ""
    head = f"{bins[0]['short_code']} sampai {bins[-1]['short_code']}" if len(bins) > 1 \
        else bins[0]["short_code"]
    sizes = [b["size"] for b in bins]
    kecil = sizes.count("KECIL")
    major = "KECIL" if kecil * 2 >= len(sizes) else "BESAR"
    other = [b for b in bins if b["size"] != major]
    if not other:
        return f"{head} · bin {SIZE_LABEL[major]}"
    if len(other) <= 3:
        codes = ", ".join(b["short_code"] for b in other)
        return f"{head} · bin {SIZE_LABEL[major]}, kecuali {codes} {SIZE_LABEL[other[0]['size']]}"
    return f"{head} · bin Kecil dan Besar campur"


# --- request models (kept here, not in models.py) ------------------------------

class RackLevelIn(BaseModel):
    level_no: int = Field(description="1 = the bottom shelf")
    columns: list[list[str]] = Field(
        description="One list per kolom, left to right; each lists its bins left to right "
                    "as KECIL or BESAR")


class RackBuildIn(BaseModel):
    code: str = Field(description="Nama rak, e.g. A")
    kolom_count: int = Field(description="Kolom per level, 1 to 10")
    levels: list[RackLevelIn]


class BinSizeIn(BaseModel):
    size: str = Field(description="KECIL | BESAR")


class LabelCheckIn(BaseModel):
    location_id: int = Field(description="The bin the phone asked for")
    scanned: str = Field(description="What the scanner read, or the code typed")


class SpecialCountIn(BaseModel):
    count: int


class AssignBinIn(BaseModel):
    location_id: int


# --- planning a rack --------------------------------------------------------------

def plan_rack(site_code: str, body: RackBuildIn) -> dict:
    """Codes, sizes and counts of a rack as entered; nothing is written."""
    code = (body.code or "").strip().upper()
    if not _RACK_CODE.match(code):
        raise HTTPException(422, "Nama rak: 1 sampai 4 huruf atau angka, misalnya A. / "
                                 "Rack name: 1 to 4 letters or digits, e.g. A.")
    if code in ("IN", "QR", "OUT"):
        raise HTTPException(422, "IN, QR dan OUT dipakai bin khusus. Pilih nama lain. / "
                                 "IN, QR and OUT belong to special bins.")
    k = body.kolom_count
    if not 1 <= k <= MAX_KOLOM:
        raise HTTPException(422, f"Kolom per level: 1 sampai {MAX_KOLOM}. / "
                                 f"Kolom per level: 1 to {MAX_KOLOM}.")
    levels = sorted(body.levels, key=lambda lv: lv.level_no)
    if not 1 <= len(levels) <= MAX_LEVELS:
        raise HTTPException(422, f"Jumlah level: 1 sampai {MAX_LEVELS}. / "
                                 f"Levels: 1 to {MAX_LEVELS}.")
    if [lv.level_no for lv in levels] != list(range(1, len(levels) + 1)):
        raise HTTPException(422, "Level dihitung 1, 2, 3 dan seterusnya dari bawah. / "
                                 "Levels are numbered 1, 2, 3 and so on from the bottom.")
    bins, out_levels = [], []
    for lv in levels:
        if len(lv.columns) != k:
            raise HTTPException(422, f"Level {lv.level_no} harus punya {k} kolom. / "
                                     f"Level {lv.level_no} must have {k} kolom.")
        idx, lv_bins = 0, []
        for kolom_no, col in enumerate(lv.columns, start=1):
            if len(col) > MAX_PER_KOLOM:
                raise HTTPException(422, f"Paling banyak {MAX_PER_KOLOM} bin per kolom. / "
                                         f"At most {MAX_PER_KOLOM} bins per kolom.")
            for raw in col:
                size = norm_size(raw)
                if size is None:
                    raise HTTPException(422, "Ukuran bin harus Kecil atau Besar. / "
                                             "Bin size must be Kecil or Besar.")
                idx += 1
                full = bin_code(site_code, code, lv.level_no, idx)
                b = {"level_no": lv.level_no, "index": idx, "kolom_no": kolom_no,
                     "size": size, "code": full, "short_code": short_code(full, site_code)}
                lv_bins.append(b)
        if not 1 <= idx <= MAX_PER_LEVEL:
            raise HTTPException(422, f"Level {lv.level_no}: 1 sampai {MAX_PER_LEVEL} bin. / "
                                     f"Level {lv.level_no}: 1 to {MAX_PER_LEVEL} bins.")
        bins += lv_bins
        out_levels.append({"level_no": lv.level_no, "bins": idx,
                           "kecil": sum(1 for b in lv_bins if b["size"] == "KECIL"),
                           "besar": sum(1 for b in lv_bins if b["size"] == "BESAR"),
                           "size_text": level_size_text([b["size"] for b in lv_bins]),
                           "strip_text": strip_text(lv_bins)})
    kecil = sum(1 for b in bins if b["size"] == "KECIL")
    first, last = bins[0]["short_code"], bins[-1]["short_code"]
    return {
        "code": code, "kolom_count": k, "levels": out_levels, "bins": bins,
        "total": len(bins), "kecil": kecil, "besar": len(bins) - kecil,
        "first": first, "last": last,
        "summary": f"{len(bins)} bin, {first} sampai {last} · {kecil} Kecil, "
                   f"{len(bins) - kecil} Besar",
    }


async def _site_ready(user: auth.User, site_id: int) -> dict:
    site = await auth.assert_site_access(user, site_id)
    row = await db.fetch_one("SELECT hiryu_dark_store_id, setup_completed_at FROM sites "
                             "WHERE id = %s", (site_id,))
    if row and row["hiryu_dark_store_id"] is not None and row["setup_completed_at"] is None:
        raise HTTPException(409, "Lengkapi hub dulu di Pengaturan, Hub & mulai operasi. / "
                                 "Complete the hub first (Settings, Hub).")
    return site


async def _codes_taken(codes: list[str], rack_id: int | None = None) -> list[str]:
    taken = []
    for part in [codes[i:i + 200] for i in range(0, len(codes), 200)]:
        sql = f"SELECT l.code FROM locations l WHERE l.code IN ({db.placeholders(part)})"
        params = list(part)
        if rack_id is not None:
            sql += (" AND l.id NOT IN (SELECT l2.id FROM locations l2 "
                    "JOIN levels lv2 ON lv2.id = l2.level_id WHERE lv2.rack_id = %s)")
            params.append(rack_id)
        taken += [r["code"] for r in await db.fetch_all(sql, params)]
    return taken


async def _write_layout(cur, site: dict, rack_id: int, plan: dict) -> None:
    by_level: dict[int, list[dict]] = {}
    for b in plan["bins"]:
        by_level.setdefault(b["level_no"], []).append(b)
    for level_no, lv_bins in sorted(by_level.items()):
        level_id = await db.run(
            cur, "INSERT INTO levels (rack_id, level_no, is_open_shelf, bin_rows) "
                 "VALUES (%s,%s,0,1)", (rack_id, level_no))
        for b in lv_bins:
            await add_bin_row(cur, site_id=site["id"], site_code=site["code"],
                              rack_code=plan["code"], level_id=level_id, level_no=level_no,
                              position=b["index"], row=1, size=b["size"], rows=1,
                              kolom_no=b["kolom_no"])


@router.post("/sites/{site_id}/racks/preview", tags=["rak & bin"])
async def preview_rack(site_id: int, body: RackBuildIn,
                       user: auth.User = Depends(auth.current_user)):
    """What Simpan rak would make: every bin code and size, and the counts line
    (canvas 3a, *Hasil: 30 bin, A-1-01 sampai A-5-06 · 17 Kecil, 13 Besar*)."""
    site = await auth.assert_site_access(user, site_id)
    return plan_rack(site["code"], body)


@router.post("/sites/{site_id}/racks/build", status_code=201, tags=["rak & bin"])
async def build_rack(site_id: int, body: RackBuildIn,
                     user: auth.User = Depends(auth.require("supervisor"))):
    """Simpan rak: register a rack exactly as it stands. Racks can be added any time;
    the new free bins are offered in Perlu bin straight away."""
    site = await _site_ready(user, site_id)
    plan = plan_rack(site["code"], body)
    if await db.fetch_one("SELECT id FROM racks WHERE site_id = %s AND code = %s",
                          (site_id, plan["code"])):
        raise HTTPException(409, f"Rak {plan['code']} sudah ada di {site['code']}. / "
                                 f"Rack {plan['code']} already exists.")
    taken = await _codes_taken([b["code"] for b in plan["bins"]])
    if taken:
        raise HTTPException(409, f"Kode {taken[0]} sudah dipakai. / Code {taken[0]} is taken.")
    async with db.tx() as cur:
        order = await db.one(cur, "SELECT COALESCE(MAX(sort_order), 0) AS n FROM racks "
                                  "WHERE site_id = %s", (site_id,))
        rack_id = await db.run(
            cur, "INSERT INTO racks (site_id, code, level_count, kolom_count, sort_order, "
                 "created_by, created_at) VALUES (%s,%s,%s,%s,%s,%s,NOW())",
            (site_id, plan["code"], len(plan["levels"]), plan["kolom_count"],
             int(order["n"]) + 1, user.email))
        await _write_layout(cur, site, rack_id, plan)
        await ledger.audit(cur, actor_email=user.email, entity="rack", entity_id=rack_id,
                           action="build", after={"code": plan["code"], "bins": plan["total"],
                                                  "kecil": plan["kecil"],
                                                  "besar": plan["besar"]})
    return {"ok": True, "rack_id": rack_id, "summary": plan["summary"],
            "message": f"Rak {plan['code']} tersimpan: {plan['summary']}."}


async def _rack_used(rack_id: int) -> list[str]:
    rows = await db.fetch_all(
        "SELECT l.code FROM levels lv JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "WHERE lv.rack_id = %s AND (EXISTS (SELECT 1 FROM slot_assignments sa "
        "      WHERE sa.basket_id = bk.id) "
        "  OR EXISTS (SELECT 1 FROM stock_movements m WHERE m.location_id = l.id)) "
        "ORDER BY lv.level_no, l.position_no LIMIT 5", (rack_id,))
    return [r["code"] for r in rows]


async def _drop_layout(cur, rack_id: int) -> None:
    await db.run(cur, "DELETE bk FROM baskets bk JOIN locations l ON l.id = bk.location_id "
                      "JOIN levels lv ON lv.id = l.level_id WHERE lv.rack_id = %s", (rack_id,))
    await db.run(cur, "DELETE l FROM locations l JOIN levels lv ON lv.id = l.level_id "
                      "WHERE lv.rack_id = %s", (rack_id,))
    await db.run(cur, "DELETE FROM levels WHERE rack_id = %s", (rack_id,))


@router.put("/racks/{rack_id}/build", tags=["rak & bin"])
async def rebuild_rack(rack_id: int, body: RackBuildIn,
                       user: auth.User = Depends(auth.require("supervisor"))):
    """Change a rack's layout, while none of its bins was ever used. A rack in
    use is changed bin by bin (size) or by adding bins and levels."""
    rack = await _rack(rack_id)
    site = await _site_ready(user, rack["site_id"])
    used = await _rack_used(rack_id)
    if used:
        raise HTTPException(409, f"Rak {rack['code']} sudah dipakai ({', '.join(used)}). "
                                 "Ubah ukuran per bin, atau tambah bin. / The rack is in use.")
    plan = plan_rack(site["code"], body)
    if plan["code"] != rack["code"] and await db.fetch_one(
            "SELECT id FROM racks WHERE site_id = %s AND code = %s",
            (rack["site_id"], plan["code"])):
        raise HTTPException(409, f"Rak {plan['code']} sudah ada. / Rack {plan['code']} exists.")
    taken = await _codes_taken([b["code"] for b in plan["bins"]], rack_id)
    if taken:
        raise HTTPException(409, f"Kode {taken[0]} sudah dipakai. / Code {taken[0]} is taken.")
    async with db.tx() as cur:
        await _drop_layout(cur, rack_id)
        await db.run(cur, "UPDATE racks SET code = %s, level_count = %s, kolom_count = %s, "
                          "labels_printed_at = NULL WHERE id = %s",
                     (plan["code"], len(plan["levels"]), plan["kolom_count"], rack_id))
        await _write_layout(cur, site, rack_id, plan)
        await ledger.audit(cur, actor_email=user.email, entity="rack", entity_id=rack_id,
                           action="rebuild", after={"code": plan["code"], "bins": plan["total"]})
    return {"ok": True, "rack_id": rack_id, "summary": plan["summary"],
            "message": f"Rak {plan['code']} diubah: {plan['summary']}. Cetak label lagi."}


@router.delete("/racks/{rack_id}", response_model=models.Ok, tags=["rak & bin"])
async def delete_rack(rack_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Remove a rack none of whose bins was ever used."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    used = await _rack_used(rack_id)
    if used:
        raise HTTPException(409, f"Rak {rack['code']} sudah dipakai ({', '.join(used)}), jadi "
                                 "riwayatnya harus tetap ada. / The rack is in use.")
    async with db.tx() as cur:
        await _drop_layout(cur, rack_id)
        await db.run(cur, "DELETE FROM racks WHERE id = %s", (rack_id,))
        await ledger.audit(cur, actor_email=user.email, entity="rack", entity_id=rack_id,
                           action="delete", before={"code": rack["code"]})
    return {"ok": True, "message": f"Rak {rack['code']} dihapus."}


@router.patch("/locations/{location_id}/size", response_model=models.Ok, tags=["rak & bin"])
async def set_bin_size(location_id: int, body: BinSizeIn,
                       user: auth.User = Depends(auth.require("supervisor"))):
    """Switch one bin between Kecil and Besar (the bin was swapped on the rack)."""
    size = _size(body.size)
    loc = await db.fetch_one(
        "SELECT l.id, l.code, l.site_id, bk.id AS basket_id, s.bin_size, s.name_display "
        "FROM locations l LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id WHERE l.id = %s", (location_id,))
    if not loc or not loc["basket_id"]:
        raise HTTPException(404, "Bin tidak ditemukan. / Bin not found.")
    await auth.assert_site_access(user, loc["site_id"])
    if loc["bin_size"] and norm_size(loc["bin_size"]) != size:
        raise HTTPException(409, f"{loc['code']} berisi {loc['name_display']} yang perlu bin "
                                 f"{size_label(loc['bin_size'])}. Pindahkan dulu. / The bin holds "
                                 "a product of the other size.")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE baskets SET basket_size = %s WHERE id = %s",
                     (size, loc["basket_id"]))
        await ledger.audit(cur, actor_email=user.email, entity="location",
                           entity_id=location_id, action="size", after={"size": size})
    return {"ok": True, "message": f"{loc['code']}: bin {SIZE_LABEL[size]}."}


# --- reading a rack ----------------------------------------------------------------

async def rack_bins(rack_id: int) -> tuple[dict, list[dict]]:
    """A rack and every bin on it, bottom level first, left to right."""
    rack = await _rack(rack_id)
    rows = await db.fetch_all(
        "SELECT lv.id AS level_id, lv.level_no, l.id AS location_id, l.code, l.position_no, "
        "       l.kolom_no, l.label_check_state, l.label_check_scanned, l.label_checked_at, "
        "       l.label_checked_by, bk.id AS basket_id, bk.basket_size, bk.label_printed_at, "
        "       sa.sku_id, sa.slot_role, s.name_display AS sku_name, s.bin_size AS sku_bin_size, "
        "       COALESCE(ib.qty_on_hand, 0) AS qty_on_hand, "
        "       EXISTS (SELECT 1 FROM stock_movements m WHERE m.location_id = l.id) AS used "
        "FROM levels lv "
        "JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id "
        "LEFT JOIN inventory_balances ib ON ib.location_id = l.id AND ib.sku_id = sa.sku_id "
        "WHERE lv.rack_id = %s ORDER BY lv.level_no, l.position_no, l.bin_row", (rack_id,))
    bins = []
    for r in rows:
        bins.append({
            "location_id": r["location_id"], "basket_id": r["basket_id"],
            "level_id": r["level_id"], "level_no": r["level_no"],
            "index": r["position_no"], "kolom_no": r["kolom_no"] or 1,
            "code": r["code"], "short_code": short_code(r["code"], rack["site_code"]),
            "size": norm_size(r["basket_size"]) or "BESAR",
            "sku_id": r["sku_id"], "sku_name": r["sku_name"], "slot_role": r["slot_role"],
            "qty_on_hand": int(r["qty_on_hand"] or 0),
            "occupied": bool(r["sku_id"]),
            "removable": not r["sku_id"] and not int(r["used"] or 0),
            "label_printed_at": iso(r["label_printed_at"]),
            "label_check": r["label_check_state"],
            "label_check_scanned": short_code(r["label_check_scanned"], rack["site_code"]),
            "label_checked_at": iso(r["label_checked_at"]),
        })
    return rack, bins


def _group_levels(bins: list[dict], kolom_count: int) -> list[dict]:
    levels: dict[int, dict] = {}
    for b in bins:
        lv = levels.setdefault(b["level_no"], {"level_id": b["level_id"],
                                               "level_no": b["level_no"], "bins": []})
        lv["bins"].append(b)
    out = []
    for lv in sorted(levels.values(), key=lambda x: x["level_no"]):
        k = max([kolom_count] + [b["kolom_no"] for b in lv["bins"]])
        cols = [[] for _ in range(k)]
        for b in lv["bins"]:
            cols[b["kolom_no"] - 1].append(b)
        sizes = [b["size"] for b in lv["bins"]]
        out.append(dict(lv, size_text=level_size_text(sizes) if sizes else None,
                        strip_text=strip_text(lv["bins"]),
                        columns=[[b["size"] for b in c] for c in cols],
                        kolom=[{"kolom_no": i + 1, "bins": c} for i, c in enumerate(cols)]))
    return out


@router.get("/sites/{site_id}/rak", tags=["rak & bin"])
async def rak_overview(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Rak & bin, tab Rak: every rack of the hub with its bins and labels, and
    the counts on the tabs (Rak, Bin khusus, Perlu bin). Every role may look."""
    site = await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT r.id AS rack_id, r.code, r.sort_order, r.kolom_count, r.labels_printed_at, "
        "       lv.level_no, l.id AS location_id, bk.basket_size, l.label_check_state, "
        "       (SELECT COUNT(*) FROM slot_assignments sa WHERE sa.basket_id = bk.id) AS slots "
        "FROM racks r LEFT JOIN levels lv ON lv.rack_id = r.id "
        "LEFT JOIN locations l ON l.level_id = lv.id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "WHERE r.site_id = %s ORDER BY r.sort_order, r.code, lv.level_no", (site_id,))
    racks_out: dict[int, dict] = {}
    for r in rows:
        rk = racks_out.setdefault(r["rack_id"], {
            "rack_id": r["rack_id"], "code": r["code"], "kolom_count": r["kolom_count"] or 1,
            "levels": set(), "bins": 0, "kecil": 0, "besar": 0, "used": 0,
            "free_kecil": 0, "free_besar": 0, "labels_printed_at": iso(r["labels_printed_at"]),
            "label_ok": 0, "label_wrong": 0})
        if r["location_id"] is None:
            continue
        rk["levels"].add(r["level_no"])
        size = norm_size(r["basket_size"]) or "BESAR"
        rk["bins"] += 1
        rk["kecil" if size == "KECIL" else "besar"] += 1
        if int(r["slots"] or 0):
            rk["used"] += 1
        else:
            rk["free_kecil" if size == "KECIL" else "free_besar"] += 1
        if r["label_check_state"] == "ok":
            rk["label_ok"] += 1
        elif r["label_check_state"] == "wrong":
            rk["label_wrong"] += 1
    racks_list = []
    for rk in racks_out.values():
        rk["levels"] = len(rk["levels"])
        rk["free"] = rk["bins"] - rk["used"]
        rk["labels_checked"] = rk["bins"] > 0 and rk["label_ok"] == rk["bins"]
        racks_list.append(rk)
    special = await locations_special_summary(site_id)
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"]},
        "racks": racks_list,
        "totals": {
            "racks": len(racks_list), "bins": sum(r["bins"] for r in racks_list),
            "free_kecil": sum(r["free_kecil"] for r in racks_list),
            "free_besar": sum(r["free_besar"] for r in racks_list),
        },
        "needs_bin": await _needs_rack(site_id, count_only=True),
        "special": special,
    }


@router.get("/racks/{rack_id}/layout", tags=["rak & bin"])
async def rack_layout(rack_id: int, user: auth.User = Depends(auth.current_user)):
    """One rack as the builder and the rack picture show it: levels bottom first,
    each with its kolom and bins, and `columns` (sizes only) to edit it again."""
    rack, bins = await rack_bins(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    kecil = sum(1 for b in bins if b["size"] == "KECIL")
    return {
        "rack": {"rack_id": rack["id"], "code": rack["code"], "site_id": rack["site_id"],
                 "site_code": rack["site_code"], "kolom_count": rack.get("kolom_count") or 1,
                 "levels": len({b["level_no"] for b in bins}), "bins": len(bins),
                 "kecil": kecil, "besar": len(bins) - kecil,
                 "used": sum(1 for b in bins if b["occupied"]),
                 "labels_printed_at": iso(rack.get("labels_printed_at")),
                 "in_use": any(not b["removable"] for b in bins),
                 "summary": (f"{len(bins)} bin, {bins[0]['short_code']} sampai "
                             f"{bins[-1]['short_code']} · {kecil} Kecil, {len(bins) - kecil} Besar"
                             if bins else "0 bin")},
        "levels": _group_levels(bins, rack.get("kolom_count") or 1),
    }


# --- labels (canvas 3b) ---------------------------------------------------------------

def _bin_label(b: dict, hub: str) -> dict:
    return {"location_id": b["location_id"], "code": b["short_code"], "barcode": b["code"],
            "kolom_no": b["kolom_no"], "kolom_text": f"Kolom {b['kolom_no']}",
            "level_no": b["level_no"], "size": b["size"], "size_label": SIZE_LABEL[b["size"]],
            "line": f"{hub} · Level {b['level_no']} · bin {SIZE_LABEL[b['size']]}"}


def _paginate(levels: list[dict]) -> list[list[tuple[int, list[dict]]]]:
    """Whole levels per page while they fit, LABELS_PER_PAGE bin labels a page."""
    pages, cur, n = [], [], 0
    for lv in levels:
        chunk = lv["bins"]
        if n and n + len(chunk) > LABELS_PER_PAGE:
            pages.append(cur)
            cur, n = [], 0
        while chunk:
            room = LABELS_PER_PAGE - n
            cur.append((lv["level_no"], chunk[:room]))
            n += len(chunk[:room])
            chunk = chunk[room:]
            if chunk:
                pages.append(cur)
                cur, n = [], 0
    if cur:
        pages.append(cur)
    return pages or [[]]


@router.get("/racks/{rack_id}/labels", tags=["rak & bin"])
async def rack_labels(rack_id: int, user: auth.User = Depends(auth.current_user)):
    """The A4 label sheets of one rack: page 1 has the rack header label and one
    strip per level, then 12 bin labels a page, whole levels where they fit.
    Cut lines and the footer are drawn by the page; the copy is here."""
    rack, bins = await rack_bins(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    hub = _prefix(rack["site_code"])
    levels = _group_levels(bins, rack.get("kolom_count") or 1)
    strips = [{"level_no": lv["level_no"], "title": f"LEVEL {lv['level_no']}",
               "text": lv["strip_text"], "rack_text": f"RAK {rack['code']} · {hub}"}
              for lv in reversed(levels)]
    pages = []
    groups = _paginate(levels)
    for i, group in enumerate(groups, start=1):
        labels = [_bin_label(b, hub) for _, chunk in group for b in chunk]
        nos = sorted({no for no, _ in group})
        contents = []
        if i == 1:
            contents += ["1 label kepala rak",
                         f"{len(levels)} strip level (level 1 sampai {len(levels)})"
                         if len(levels) > 1 else "1 strip level"]
        if labels:
            contents.append(f"{len(labels)} label bin: " +
                            " dan ".join(f"level {n}" for n in nos))
        pages.append({"page_no": i, "rack_label": i == 1, "level_strips": i == 1,
                      "levels": nos, "levels_text": _levels_text(nos) if nos else "",
                      "contents": contents, "bin_labels": labels})
    later = [f"Halaman {p['page_no']}: {p['levels_text']}." for p in pages[1:] if p["levels"]]
    return {
        "rack": {"rack_id": rack["id"], "code": rack["code"], "site_code": rack["site_code"],
                 "hub": hub, "bins": len(bins), "levels": len(levels)},
        "title": f"Label rak {rack['code']}, A4",
        "subtitle": f"Rak {rack['code']} · {hub} · dicetak {wib_date_text()}",
        "paper": "A4", "top_note": LABEL_TOP_NOTE, "cut_note": LABEL_CUT_NOTE,
        "footer": LABEL_FOOTER, "lost_note": LABEL_LOST_NOTE,
        "check_note": "Setelah ditempel, staf memindai semua label sekali (Cek label).",
        "rack_label": {"title": f"RAK {rack['code']}", "hub": hub,
                       "note": "Label kepala rak · tempel di tiang kiri, setinggi mata"},
        "level_strips": strips, "pages": pages, "page_count": len(pages),
        "later_pages_text": " ".join(later),
        "labels_printed_at": iso(rack.get("labels_printed_at")),
    }


@router.post("/racks/{rack_id}/labels/printed", response_model=models.Ok, tags=["rak & bin"])
async def rack_labels_printed(rack_id: int, user: auth.User = Depends(auth.current_user)):
    """Record that the rack's sheets were printed (after the browser's print)."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    async with db.tx() as cur:
        await db.run(cur, "UPDATE racks SET labels_printed_at = NOW() WHERE id = %s", (rack_id,))
        await db.run(cur, "UPDATE baskets bk JOIN locations l ON l.id = bk.location_id "
                          "JOIN levels lv ON lv.id = l.level_id SET bk.label_printed_at = NOW() "
                          "WHERE lv.rack_id = %s", (rack_id,))
        await ledger.audit(cur, actor_email=user.email, entity="rack", entity_id=rack_id,
                           action="labels_printed")
    return {"ok": True, "message": f"Label rak {rack['code']} dicetak."}


async def _location_label(location_id: int, user: auth.User) -> dict:
    loc = await db.fetch_one(
        "SELECT l.id, l.code, l.site_id, l.level_id, l.position_no, l.kolom_no, lv.level_no, "
        "       bk.basket_size, s.code AS site_code, sb.kind AS special_kind "
        "FROM locations l JOIN sites s ON s.id = l.site_id "
        "LEFT JOIN levels lv ON lv.id = l.level_id "
        "LEFT JOIN baskets bk ON bk.location_id = l.id "
        "LEFT JOIN special_bins sb ON sb.location_id = l.id WHERE l.id = %s", (location_id,))
    if not loc:
        raise HTTPException(404, "Bin tidak ditemukan. / Bin not found.")
    await auth.assert_site_access(user, loc["site_id"])
    hub = _prefix(loc["site_code"])
    if loc["special_kind"]:
        return dict(special_label(loc["code"], loc["special_kind"], hub), location_id=loc["id"])
    b = {"location_id": loc["id"], "code": loc["code"],
         "short_code": short_code(loc["code"], loc["site_code"]),
         "kolom_no": loc["kolom_no"] or 1, "level_no": loc["level_no"],
         "size": norm_size(loc["basket_size"]) or "BESAR"}
    return _bin_label(b, hub)


@router.get("/locations/{location_id}/label", tags=["rak & bin"])
async def location_label(location_id: int, user: auth.User = Depends(auth.current_user)):
    """One bin's label (rack bin or special bin), for a reprint."""
    return {"label": await _location_label(location_id, user), "cut_note": LABEL_CUT_NOTE,
            "footer": LABEL_FOOTER}


@router.post("/locations/{location_id}/reprint", tags=["rak & bin"])
async def reprint_label(location_id: int, user: auth.User = Depends(auth.current_user)):
    """Cetak ulang: a lost, torn or wrongly taped label. The bin goes back to
    "not checked", so Cek label asks for it again."""
    label = await _location_label(location_id, user)
    async with db.tx() as cur:
        await db.run(cur, "UPDATE baskets SET label_printed_at = NOW() WHERE location_id = %s",
                     (location_id,))
        await db.run(cur, "UPDATE special_bins SET label_printed_at = NOW() "
                          "WHERE location_id = %s", (location_id,))
        await db.run(cur, "UPDATE locations SET label_check_state = NULL, "
                          "label_check_scanned = NULL, label_checked_at = NULL, "
                          "label_checked_by = NULL WHERE id = %s", (location_id,))
        await ledger.audit(cur, actor_email=user.email, entity="location",
                           entity_id=location_id, action="label_reprint")
    return {"label": label, "cut_note": LABEL_CUT_NOTE, "footer": LABEL_FOOTER,
            "message": f"Label {label['code']} siap dicetak ulang."}


# --- Cek label (canvas 3c) ------------------------------------------------------------

async def resolve_bin_code(scanned: str, site_code: str | None = None) -> dict | None:
    """A scanned or typed bin code -> its location. Takes the full code (MA5-A-2-03,
    what the barcode holds) or, with the hub known, the short one (A-2-03)."""
    c = "".join((scanned or "").split()).upper()
    if not c:
        return None
    sql = ("SELECT l.id, l.code, l.site_id, l.level_id, s.code AS site_code FROM locations l "
           "JOIN sites s ON s.id = l.site_id WHERE l.code = %s")
    row = await db.fetch_one(sql, (c,))
    if not row and site_code:
        row = await db.fetch_one(sql, (f"{_prefix(site_code)}-{c}",))
    return row


async def _check_state(rack_id: int) -> dict:
    rack, bins = await rack_bins(rack_id)
    ok = [b for b in bins if b["label_check"] == "ok"]
    wrong = [b for b in bins if b["label_check"] == "wrong"]
    pending = [b for b in bins if not b["label_check"]]
    nxt = pending[0] if pending else None
    recent = sorted([b for b in bins if b["label_checked_at"]],
                    key=lambda b: b["label_checked_at"], reverse=True)[:5]
    return {
        "rack": {"rack_id": rack["id"], "code": rack["code"], "site_id": rack["site_id"],
                 "site_code": rack["site_code"]},
        "total": len(bins), "checked": len(ok) + len(wrong), "ok": len(ok),
        "wrong": len(wrong), "done": bool(bins) and len(ok) == len(bins),
        "next": ({"location_id": nxt["location_id"], "code": nxt["short_code"],
                  "level_no": nxt["level_no"], "index": nxt["index"],
                  "kolom_no": nxt["kolom_no"],
                  "hint": (f"Level {nxt['level_no']}, bin {ordinal_id(nxt['index'])} dari kiri. "
                           "Label di depan bin, kiri bawah.")} if nxt else None),
        "to_fix": [{"location_id": b["location_id"], "code": b["short_code"],
                    "belongs_to": b["label_check_scanned"],
                    "message": f"Label ini milik {b['label_check_scanned']}, bukan "
                               f"{b['short_code']}",
                    "action": "Sobek label yang salah. Tempel label baru, lalu pindai lagi."}
                   for b in wrong],
        "recent": [{"location_id": b["location_id"], "code": b["short_code"],
                    "result": "cocok" if b["label_check"] == "ok" else "salah",
                    "at": b["label_checked_at"]} for b in recent],
    }


@router.get("/racks/{rack_id}/label-check", tags=["rak & bin"])
async def label_check(rack_id: int, user: auth.User = Depends(auth.current_user)):
    """Where Cek label stands for a rack: the next bin to scan (level 1 first, left
    to right), what is wrong, and the last ones checked."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    return await _check_state(rack_id)


@router.post("/racks/{rack_id}/label-check", tags=["rak & bin"])
async def label_check_scan(rack_id: int, body: LabelCheckIn,
                           user: auth.User = Depends(auth.current_user)):
    """One scan on Cek label. Cocok when the label is the bin's own; otherwise the
    WMS says which bin the label belongs to. Any role may check labels."""
    rack = await _rack(rack_id)
    await auth.assert_site_access(user, rack["site_id"])
    expected = await db.fetch_one(
        "SELECT l.id, l.code FROM locations l JOIN levels lv ON lv.id = l.level_id "
        "WHERE l.id = %s AND lv.rack_id = %s", (body.location_id, rack_id))
    if not expected:
        raise HTTPException(404, "Bin ini bukan bagian dari rak ini. / Not a bin of this rack.")
    found = await resolve_bin_code(body.scanned, rack["site_code"])
    exp_short = short_code(expected["code"], rack["site_code"])
    if not found:
        raise HTTPException(422, f"Kode {body.scanned.strip()} tidak dikenal. Pindai label bin "
                                 "lagi. / Unknown code, scan the bin label again.")
    if found["id"] == expected["id"]:
        state, scanned, result = "ok", None, "cocok"
        message = f"Cocok: {exp_short}."
    else:
        state, scanned, result = "wrong", found["code"], "salah"
        belongs = short_code(found["code"], rack["site_code"])
        if found["site_id"] != rack["site_id"]:
            belongs = found["code"]
        message = f"Label ini milik {belongs}, bukan {exp_short}."
    await db.execute(
        "UPDATE locations SET label_check_state = %s, label_check_scanned = %s, "
        "label_checked_at = NOW(), label_checked_by = %s WHERE id = %s",
        (state, scanned, user.email, expected["id"]))
    return {"result": result, "message": message, "expected_code": exp_short,
            "belongs_to": short_code(scanned, rack["site_code"]) if scanned else None,
            "progress": await _check_state(rack_id)}


# --- special bins (canvas 3d) ---------------------------------------------------------

def special_label(code: str, kind: str, hub: str) -> dict:
    return {"code": code, "barcode": code, "kind": kind, "title": SPECIAL_TEXT[kind][0],
            "line": f"{hub} · {SPECIAL_TEXT[kind][0]}"}


async def locations_special_summary(site_id: int) -> list[dict]:
    from routers import locations
    rows = await locations.special_bins_of(site_id)
    out = []
    for kind in ("IN", "QR", "OUT"):
        mine = [r for r in rows if r["kind"] == kind]
        printed = [r["label_printed_at"] for r in mine if r["label_printed_at"]]
        all_printed = bool(mine) and len(printed) == len(mine)
        out.append({"kind": kind, "count": len(mine),
                    "first": mine[0]["code"] if mine else None,
                    "last": mine[-1]["code"] if mine else None,
                    "labels_printed": all_printed,
                    "label_printed_at": iso(max(printed)) if all_printed else None})
    return out


@router.get("/sites/{site_id}/special-bins", tags=["rak & bin"])
async def special_bins(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Bin khusus: the three cards (temporary inbound bins, quarantine trays,
    outbound baskets) with every code and whether its label was printed."""
    from routers import locations
    site = await auth.assert_site_access(user, site_id)
    meta = await db.fetch_one("SELECT hiryu_dark_store_id, setup_completed_at FROM sites "
                              "WHERE id = %s", (site_id,))
    rows = await locations.special_bins_of(site_id)
    cards = []
    for kind in ("IN", "QR", "OUT"):
        mine = [r for r in rows if r["kind"] == kind]
        printed = [r["label_printed_at"] for r in mine if r["label_printed_at"]]
        all_printed = bool(mine) and len(printed) == len(mine)
        cards.append({
            "kind": kind, "title": SPECIAL_TEXT[kind][0], "purpose": SPECIAL_TEXT[kind][1],
            "count": len(mine), "min": locations.SPECIAL_MIN[kind],
            "bins": [{"id": r["id"], "code": r["code"], "seq": r["seq"],
                      "location_id": r["location_id"],
                      "label_printed_at": iso(r["label_printed_at"])} for r in mine],
            "labels_printed": all_printed,
            "label_printed_at": iso(max(printed)) if all_printed else None,
            "label_printed_text": (f"Label dicetak {wib_date_text(max(printed) + timedelta(hours=7))}"
                                   if all_printed else "Label belum dicetak"),
            "note": ("Bisa ditambah kapan saja, label langsung dicetak." if kind == "IN"
                     else "Minimal 1. Setiap hub punya baki karantina." if kind == "QR" else None),
        })
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"]},
        "hub_ready": not (meta and meta["hiryu_dark_store_id"] is not None
                          and meta["setup_completed_at"] is None),
        "cards": cards,
        "rule": "Jumlah bisa ditambah kapan saja. Mengurangi hanya bisa bila bin atau "
                "keranjang terakhir kosong.",
    }


@router.put("/sites/{site_id}/special-bins/{kind}", tags=["rak & bin"])
async def set_special_count(site_id: int, kind: str, body: SpecialCountIn,
                            user: auth.User = Depends(auth.require("supervisor"))):
    """Set how many of a kind the hub has. Up any time; down only while the last
    one is empty (one at a time from the end)."""
    from routers import locations
    await _site_ready(user, site_id)
    kind = locations._special_kind(kind)
    want = body.count
    if not locations.SPECIAL_MIN[kind] <= want <= locations.SPECIAL_MAX:
        raise HTTPException(422, f"Jumlah {locations.SPECIAL_MIN[kind]} sampai "
                                 f"{locations.SPECIAL_MAX}. / Count out of range.")
    have = len(await locations.special_bins_of(site_id, kind))
    added, removed = [], []
    if want > have:
        async with db.tx() as cur:
            for _ in range(want - have):
                added.append(await locations.add_special_bin(cur, site_id, kind, user.email))
    while have > want:
        removed.append(await locations.remove_last_special_bin(site_id, kind, user.email))
        have -= 1
    msg = f"{SPECIAL_TEXT[kind][0]}: {want}."
    if added:
        msg += f" Baru: {added[0]['code']}" + (f" sampai {added[-1]['code']}" if len(added) > 1
                                                else "") + ". Cetak labelnya."
    return {"ok": True, "message": msg, "added": added, "removed": removed}


@router.post("/sites/{site_id}/special-bins/{kind}/add", tags=["rak & bin"])
async def add_one_special(site_id: int, kind: str,
                          user: auth.User = Depends(auth.require("supervisor"))):
    """Tambah bin sementara (and the same for the other kinds): one more, its
    label returned to print at once and recorded as printed."""
    from routers import locations
    site = await _site_ready(user, site_id)
    async with db.tx() as cur:
        b = await locations.add_special_bin(cur, site_id, kind, user.email)
        await db.run(cur, "UPDATE special_bins SET label_printed_at = NOW() WHERE id = %s",
                     (b["id"],))
    return {"ok": True, "bin": b,
            "label": dict(special_label(b["code"], b["kind"], _prefix(site["code"])),
                          location_id=b["location_id"]),
            "message": f"{b['code']} ditambahkan. Labelnya dicetak sekarang."}


@router.get("/sites/{site_id}/special-bins/labels", tags=["rak & bin"])
async def special_labels(site_id: int, kind: str | None = None,
                         user: auth.User = Depends(auth.current_user)):
    """Labels of the special bins (one kind, or all), for one A4 sheet."""
    from routers import locations
    site = await auth.assert_site_access(user, site_id)
    hub = _prefix(site["code"])
    rows = await locations.special_bins_of(site_id, kind)
    return {"title": f"Label bin khusus {hub}", "subtitle": f"{hub} · dicetak {wib_date_text()}",
            "cut_note": LABEL_CUT_NOTE, "footer": LABEL_FOOTER, "lost_note": LABEL_LOST_NOTE,
            "labels": [dict(special_label(r["code"], r["kind"], hub), id=r["id"],
                            location_id=r["location_id"]) for r in rows]}


@router.post("/sites/{site_id}/special-bins/printed", response_model=models.Ok,
             tags=["rak & bin"])
async def special_labels_printed(site_id: int, kind: str | None = None,
                                 user: auth.User = Depends(auth.current_user)):
    """Record that the special bins' labels (one kind, or all) were printed."""
    from routers import locations
    await auth.assert_site_access(user, site_id)
    sql = "UPDATE special_bins SET label_printed_at = NOW() WHERE site_id = %s AND active = 1"
    params: list = [site_id]
    if kind:
        sql += " AND kind = %s"
        params.append(locations._special_kind(kind))
    await db.execute(sql, params)
    return {"ok": True, "message": "Label dicetak."}


@router.get("/special-bins/resolve", tags=["rak & bin"])
async def resolve_special(code: str, site_id: int | None = None, kind: str | None = None,
                          user: auth.User = Depends(auth.current_user)):
    """A scanned special-bin code -> the bin (inbound, packing and quarantine screens)."""
    from routers import locations
    b = await locations.special_bin_by_code(code, site_id)
    if not b or not b["active"] or (kind and b["kind"] != kind.strip().upper()):
        raise HTTPException(404, f"{code.strip().upper()} bukan bin khusus yang aktif di sini. / "
                                 "Not an active special bin here.")
    await auth.assert_site_access(user, b["site_id"])
    return dict(b, label_printed_at=iso(b["label_printed_at"]))


# --- Perlu bin (canvas 3e) -------------------------------------------------------------

def _level_rank(level_no: int) -> int:
    return LEVEL_PREFERENCE.index(level_no) if level_no in LEVEL_PREFERENCE \
        else len(LEVEL_PREFERENCE) + level_no


async def _free_bins(site_id: int, size: str) -> list[dict]:
    """Free rack bins of one size at a hub, best first: level 3, 2, 4, 1, 5."""
    rows = await db.fetch_all(
        "SELECT l.id AS location_id, l.code, l.position_no, l.kolom_no, lv.level_no, "
        "       r.id AS rack_id, r.code AS rack_code, r.sort_order, bk.basket_size "
        "FROM racks r JOIN levels lv ON lv.rack_id = r.id "
        "JOIN locations l ON l.level_id = lv.id JOIN baskets bk ON bk.location_id = l.id "
        "WHERE r.site_id = %s "
        "  AND NOT EXISTS (SELECT 1 FROM slot_assignments sa WHERE sa.basket_id = bk.id)",
        (site_id,))
    rows = [r for r in rows if (norm_size(r["basket_size"]) or "BESAR") == size]
    rows.sort(key=lambda r: (_level_rank(r["level_no"]), r["sort_order"], r["rack_code"],
                             r["position_no"]))
    return rows


@router.get("/sites/{site_id}/needs-bin", tags=["rak & bin"])
async def needs_bin(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Perlu bin: SKUs sold at this hub that have a bin size and no bin here yet,
    with how many free bins of each size the racks still have."""
    site = await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT s.id, s.name_display, s.bin_size, b.name AS brand_name, "
        "       (SELECT bc.barcode FROM barcodes bc WHERE bc.sku_id = s.id "
        "         ORDER BY bc.registered_at, bc.id LIMIT 1) AS barcode " +
        needs_bin_from() + "ORDER BY b.name, s.name_display LIMIT 1000", (site_id,))
    free_k = len(await _free_bins(site_id, "KECIL"))
    free_b = len(await _free_bins(site_id, "BESAR"))
    return {
        "site": {"id": site["id"], "code": site["code"], "name": site["name"]},
        "skus": [{"sku_id": r["id"], "name": r["name_display"], "brand_name": r["brand_name"],
                  "barcode": r["barcode"], "bin_size": norm_size(r["bin_size"]),
                  "bin_size_label": size_label(r["bin_size"])} for r in rows],
        "total": len(rows),
        "free": {"KECIL": free_k, "BESAR": free_b},
        "note": "Satu produk per bin. Pilih bin kosong dengan ukuran yang sama.",
    }


@router.get("/sites/{site_id}/needs-bin/{sku_id}/options", tags=["rak & bin"])
async def needs_bin_options(site_id: int, sku_id: int, rack_id: int | None = None,
                            user: auth.User = Depends(auth.current_user)):
    """The rack picture for one SKU: every bin of the rack with its state
    (dipakai, kosong of the right size = cocok, kosong of the other size) and one
    marked disarankan. Without rack_id, the rack of the best free bin."""
    await auth.assert_site_access(user, site_id)
    sku = await db.fetch_one("SELECT id, name_display, bin_size FROM skus WHERE id = %s",
                             (sku_id,))
    if not sku:
        raise HTTPException(404, "SKU tidak ditemukan. / SKU not found.")
    size = norm_size(sku["bin_size"])
    if not size:
        raise HTTPException(409, "Isi ukuran bin produk ini dulu di Produk. / Set the "
                                 "product's bin size first.")
    free = await _free_bins(site_id, size)
    best = free[0] if free else None
    racks_rows = await db.fetch_all(
        "SELECT id, code FROM racks WHERE site_id = %s ORDER BY sort_order, code", (site_id,))
    per_rack = {r["id"]: 0 for r in racks_rows}
    for f in free:
        per_rack[f["rack_id"]] = per_rack.get(f["rack_id"], 0) + 1
    rid = rack_id or (best["rack_id"] if best else (racks_rows[0]["id"] if racks_rows else None))
    picture = None
    suggested = suggested_code = None
    if rid:
        rack, bins = await rack_bins(rid)
        if rack["site_id"] != site_id:
            raise HTTPException(404, "Rak bukan di hub ini. / Not a rack of this hub.")
        free_here = [f for f in free if f["rack_id"] == rid]
        suggested = free_here[0]["location_id"] if free_here else None
        suggested_code = short_code(free_here[0]["code"], rack["site_code"]) if free_here else None
        for b in bins:
            if b["occupied"]:
                b["state"] = "dipakai"
            elif b["location_id"] == suggested:
                b["state"] = "disarankan"
            elif b["size"] == size:
                b["state"] = "cocok"
            else:
                b["state"] = "lain"
        levels = _group_levels(bins, rack.get("kolom_count") or 1)
        picture = {"rack_id": rack["id"], "code": rack["code"],
                   "levels": list(reversed(levels))}
    return {
        "sku": {"sku_id": sku["id"], "name": sku["name_display"], "bin_size": size,
                "bin_size_label": SIZE_LABEL[size]},
        "racks": [{"rack_id": r["id"], "code": r["code"], "free_matching": per_rack.get(r["id"], 0)}
                  for r in racks_rows],
        "rack": picture,
        "suggested": ({"location_id": suggested, "code": suggested_code}
                      if suggested else None),
        "best_overall": ({"location_id": best["location_id"], "rack_code": best["rack_code"],
                          "code": best["code"]} if best else None),
        "order_note": ("Urutan saran: level 3 dulu, lalu 2, 4, 1, 5 (setinggi pinggang lebih "
                       "cepat diambil)."),
        "legend": "Biru: kosong, ukuran cocok. Dipakai: sudah ada produk.",
    }


@router.post("/sites/{site_id}/needs-bin/{sku_id}", tags=["rak & bin"])
async def assign_needed_bin(site_id: int, sku_id: int, body: AssignBinIn,
                            user: auth.User = Depends(auth.require("supervisor"))):
    """Simpan di A-3-02: give the SKU this free bin of its size as its pick face."""
    from routers import locations
    site = await auth.assert_site_access(user, site_id)
    sku = await db.fetch_one("SELECT id, name_display, bin_size FROM skus WHERE id = %s",
                             (sku_id,))
    if not sku:
        raise HTTPException(404, "SKU tidak ditemukan. / SKU not found.")
    size = norm_size(sku["bin_size"])
    if not size:
        raise HTTPException(409, "Isi ukuran bin produk ini dulu di Produk. / Set the "
                                 "product's bin size first.")
    loc = await db.fetch_one(
        "SELECT l.id, l.code, l.site_id, bk.id AS basket_id, bk.basket_size "
        "FROM locations l JOIN levels lv ON lv.id = l.level_id "
        "JOIN baskets bk ON bk.location_id = l.id WHERE l.id = %s", (body.location_id,))
    if not loc or loc["site_id"] != site_id:
        raise HTTPException(404, "Bin rak tidak ditemukan di hub ini. / Rack bin not found here.")
    bin_size = norm_size(loc["basket_size"]) or "BESAR"
    short = short_code(loc["code"], site["code"])
    if bin_size != size:
        raise HTTPException(409, f"{short} adalah bin {SIZE_LABEL[bin_size]}; produk ini perlu "
                                 f"bin {SIZE_LABEL[size]}. / Size does not match.")
    slot = await locations.assign_slot(
        models.SlotIn(site_id=site_id, sku_id=sku_id, basket_id=loc["basket_id"],
                      slot_role="primary"), user)
    return {"ok": True, "slot": slot, "code": short,
            "message": f"{sku['name_display']} disimpan di {short}.",
            "needs_bin": await _needs_rack(site_id, count_only=True)}
