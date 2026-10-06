"""Stok: stock per SKU per hub, with its age (menu Stok).

Age is counted from the inbound date (pseudo aging, decided 5 Oct; ED tracking is
dropped). The oldest batch still on hand is found first in, first out: walking
the SKU's receipts at the hub from the newest back, the receipt where the units
received reach what is on hand now is the oldest batch still held. When the
receipts do not cover the stock (opening stock, a count, a seed), the oldest
`stocked_since` of its locations is used instead. *Stok lama* is a batch older
than the rule `stock_old_days` (Aturan & waktu).

Where the units sit: the rack (pick face and any overflow), a temporary inbound
bin (IN, not put away yet), a quarantine tray (QR, not sellable) or an outbound
basket (OUT, picked). Sellable = rack units minus what orders already hold.
Every role may look.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, Query

import auth
import db
from routers import racks

router = APIRouter(prefix="/api", tags=["stok"])

FLAGS = "^(all|old|low|out|quarantine|no_bin)$"
SORTS = "^(name|age|qty)$"


async def _old_days() -> int | None:
    r = await db.fetch_one("SELECT enabled, value_num FROM alert_rules "
                           "WHERE rule_key = 'stock_old_days'")
    if not r or not r["enabled"] or not r["value_num"]:
        return None
    return int(r["value_num"])


async def _site_rows(site: dict, brand_id: int | None, q: str | None) -> list[dict]:
    sid = site["id"]
    where = ["s.active = 1",
             f"({racks.CARRIED_SQL} OR EXISTS (SELECT 1 FROM inventory_balances ibx "
             "  WHERE ibx.site_id = st.id AND ibx.sku_id = s.id AND ibx.qty_on_hand > 0))"]
    params: list = [sid]
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    if q:
        like = f"%{q.strip()}%"
        where.append("(s.name_display LIKE %s OR s.hiryu_sku_code LIKE %s OR EXISTS "
                     "(SELECT 1 FROM barcodes bq WHERE bq.sku_id = s.id AND bq.barcode LIKE %s))")
        params += [like, like, like]
    skus = await db.fetch_all(
        "SELECT s.id AS sku_id, s.name_display, s.hiryu_sku_code, s.brand_id, "
        "       b.name AS brand_name, s.bin_size, "
        "       sa.full_threshold, sa.restock_point, sa.safety_stock, l.code AS bin_code, "
        "       (SELECT bc.barcode FROM barcodes bc WHERE bc.sku_id = s.id "
        "         ORDER BY bc.registered_at, bc.id LIMIT 1) AS barcode "
        "FROM skus s JOIN brands b ON b.id = s.brand_id JOIN sites st ON st.id = %s "
        "LEFT JOIN slot_assignments sa ON sa.site_id = st.id AND sa.sku_id = s.id "
        "     AND sa.slot_role = 'primary' "
        "LEFT JOIN baskets bk ON bk.id = sa.basket_id "
        "LEFT JOIN locations l ON l.id = bk.location_id "
        "WHERE " + " AND ".join(where) + " ORDER BY b.name, s.name_display", params)
    bal = await db.fetch_all(
        "SELECT ib.sku_id, ib.qty_on_hand, ib.qty_allocated, ib.stocked_since, l.level_id, "
        "       sb.kind FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "LEFT JOIN special_bins sb ON sb.location_id = l.id "
        "WHERE ib.site_id = %s AND ib.qty_on_hand > 0", (sid,))
    receipts = await db.fetch_all(
        "SELECT rl.sku_id, rl.qty_received, COALESCE(ir.completed_at, ir.opened_at) AS at "
        "FROM receipt_lines rl JOIN inbound_receipts ir ON ir.id = rl.receipt_id "
        "WHERE ir.site_id = %s AND rl.qty_received > 0 ORDER BY at DESC", (sid,))
    by_sku: dict[int, dict] = {}
    for b in bal:
        d = by_sku.setdefault(b["sku_id"], {"rack": 0, "alloc": 0, "IN": 0, "QR": 0, "OUT": 0,
                                            "since": []})
        qty = int(b["qty_on_hand"])
        if b["kind"] in ("IN", "QR", "OUT"):
            d[b["kind"]] += qty
        else:
            d["rack"] += qty
            d["alloc"] += int(b["qty_allocated"] or 0)
        if b["stocked_since"]:
            d["since"].append(b["stocked_since"])
    rec: dict[int, list[dict]] = {}
    for r in receipts:
        if r["at"]:
            rec.setdefault(r["sku_id"], []).append(r)
    now = datetime.utcnow()
    out = []
    for s in skus:
        d = by_sku.get(s["sku_id"], {"rack": 0, "alloc": 0, "IN": 0, "QR": 0, "OUT": 0,
                                     "since": []})
        on_hand = d["rack"] + d["IN"] + d["QR"] + d["OUT"]
        oldest, basis = None, None
        if on_hand:
            got = 0
            for r in rec.get(s["sku_id"], []):
                got += int(r["qty_received"])
                oldest = r["at"]
                if got >= on_hand:
                    basis = "inbound"
                    break
            if basis is None:
                if d["since"]:
                    oldest, basis = min(d["since"]), "stocked_since"
                elif oldest is not None:
                    basis = "inbound"
        sellable = max(0, d["rack"] - d["alloc"])
        out.append({
            "site_id": sid, "site_code": site["code"], "sku_id": s["sku_id"],
            "name": s["name_display"], "hiryu_sku_code": s["hiryu_sku_code"],
            "brand_id": s["brand_id"], "brand_name": s["brand_name"], "barcode": s["barcode"],
            "bin_code": racks.short_code(s["bin_code"], site["code"]),
            "bin_size": racks.norm_size(s["bin_size"]),
            "on_hand": on_hand, "in_rack": d["rack"], "in_inbound": d["IN"],
            "in_quarantine": d["QR"], "in_baskets": d["OUT"], "allocated": d["alloc"],
            "sellable": sellable,
            "fill_to": s["full_threshold"], "reorder_at": s["restock_point"],
            "critical_at": s["safety_stock"],
            "oldest_inbound_at": racks.iso(oldest), "age_basis": basis,
            "age_days": (now - oldest).days if oldest else None,
            "last_inbound_at": racks.iso(rec[s["sku_id"]][0]["at"]) if rec.get(s["sku_id"])
            else None,
            "low": s["restock_point"] is not None and sellable <= s["restock_point"],
            "out": sellable == 0,
            "no_bin": s["bin_code"] is None,
        })
    return out


@router.get("/stock")
async def stock(
    site_id: int | None = Query(default=None, description="One hub; empty = every hub the "
                                                           "caller may see (Semua hub)"),
    q: str | None = None,
    brand_id: int | None = None,
    flag: str = Query(default="all", pattern=FLAGS),
    sort: str = Query(default="name", pattern=SORTS),
    user: auth.User = Depends(auth.current_user),
):
    """Stok: one row per SKU per hub with units by place, sellable units, age of
    the oldest batch and the flags (Stok lama, low, out). Filters: q (name, Hiryu
    code, barcode), brand_id, flag = old | low | out | quarantine | no_bin."""
    if site_id is not None:
        sites = [await auth.assert_site_access(user, site_id)]
    else:
        sql = ("SELECT id, code, name FROM sites WHERE active = 1 AND site_type <> 'hub' "
               "AND is_training = 0")
        params: list = []
        if not user.at_least("hq"):
            sql += " AND id IN (SELECT site_id FROM user_sites WHERE user_id = %s)"
            params.append(user.id)
        sites = await db.fetch_all(sql + " ORDER BY code", params)
    old_days = await _old_days()
    rows = []
    for st in sites:
        rows += await _site_rows(st, brand_id, q)
    for r in rows:
        r["stock_old"] = bool(old_days is not None and r["age_days"] is not None
                              and r["age_days"] > old_days)
    counts = {
        "rows": len(rows), "units": sum(r["on_hand"] for r in rows),
        "old": sum(1 for r in rows if r["stock_old"]),
        "low": sum(1 for r in rows if r["low"] and not r["out"]),
        "out": sum(1 for r in rows if r["out"]),
        "quarantine": sum(1 for r in rows if r["in_quarantine"]),
        "no_bin": sum(1 for r in rows if r["no_bin"]),
    }
    if flag == "old":
        rows = [r for r in rows if r["stock_old"]]
    elif flag == "low":
        rows = [r for r in rows if r["low"] and not r["out"]]
    elif flag == "out":
        rows = [r for r in rows if r["out"]]
    elif flag == "quarantine":
        rows = [r for r in rows if r["in_quarantine"]]
    elif flag == "no_bin":
        rows = [r for r in rows if r["no_bin"]]
    if sort == "age":
        rows.sort(key=lambda r: -(r["age_days"] if r["age_days"] is not None else -1))
    elif sort == "qty":
        rows.sort(key=lambda r: r["on_hand"])
    return {
        "sites": [{"id": s["id"], "code": s["code"], "name": s["name"]} for s in sites],
        "rows": rows, "counts": counts, "stock_old_days": old_days,
        "age_note": "Umur dihitung dari tanggal barang masuk (batch tertua yang masih ada).",
    }
