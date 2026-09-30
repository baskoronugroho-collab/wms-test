"""Reports to the brand: the weekly and monthly sales report (PRD §15.1).

Ops HQ downloads the Excel on *Laporan merek* and emails it to the brand. This
module gathers the figures; brand_report_excel.py draws them in the approved
layout.

Periods are in WIB (UTC+7), the clock the brand and the hubs live by: a week is
Monday 00:00 to the next Monday 00:00 WIB, a month the calendar month. Every
timestamp in the database is UTC (V13), so the bounds are moved back 7 hours
before they reach a query.

Where each figure comes from, and how sure it is:

* **Units sold** = order_lines.qty_picked of orders not cancelled, placed in
  the period (placed_at, or created_at for orders that never carried one).
  qty_picked rather than qty_ordered because it is what left the shelf: it
  matches the ledger's pick_out, so the monthly reconciliation adds up, and an
  order still being picked when the report is made does not count units that
  may yet be cancelled.
* **Sales value** = the item's price from Hiryu's order message
  (order_lines.item_price_idr) x item_qty, scaled by qty_picked / qty_ordered
  for a line not picked in full. Without a message price: the latest
  hiryu_item_prices price for that Hiryu item on or before the period's end,
  the order's own store first, then store 0 (the menu CSV era). Without either
  (lines from before the Hiryu link): skus.price_idr x units.
* **Menu price** = the single's latest price in the hub's own Grab store for
  the brand (hiryu_stores), falling back to store 0, then skus.price_idr.
* **Orders** = distinct orders for the brand's SKUs placed in the period,
  cancelled ones included, so the share cancelled has the right denominator.
  **Cancelled, item out of stock** = cancelled orders with a short line or
  Hiryu's cancel reason 2001 (orders.cancel_reason_code, V23).
* **Stock at end / opening stock** = today's balances minus every movement
  since that moment (the ledger is append-only and balances are its
  projection, ledger.py), so a past period is exact as long as the ledger is.
  The in-transit pseudo-location is left out, as on the stock sheet.
* **Received** = receipt movements in the period (receipt_in, receipt_adjust,
  receipt_undo), net.
* **Returned to brand / written off** = ledger movements with those types or
  reason codes. Neither flow exists yet (quarantine and returns are a later
  build), so these read 0 until they do; count corrections and short picks
  are differences, not write-offs, and stay out.
* **Counted at month end** = the last finished count of each bin in the days
  around the month's end. Empty when there was no count: the Difference is then
  left empty too, rather than showing every unit as missing.
* **Deliveries** = restock requests received in the month (with their PO
  reference and quantities), plus brand deliveries received without one.
"""
import re
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

import auth
import brand_report_excel
import db
import models

router = APIRouter(prefix="/api/reports", tags=["reports"])

WIB = timedelta(hours=7)
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")

# Ledger codes that mean stock left for the brand, or was written off. Matched
# on movement_type or reason_code, whichever the later build uses.
RETURN_CODES = ("return_to_brand", "returned_to_brand", "brand_return")
WRITE_OFF_CODES = ("write_off", "written_off", "damaged", "damaged_in_hub", "expired",
                   "faulty_pack", "leak", "lost")
RECEIPT_TYPES = ("receipt_in", "receipt_adjust", "receipt_undo")


# --- the period --------------------------------------------------------------

def period_bounds(period: str, start: date) -> tuple[date, date]:
    """First day and the day after the last, in WIB calendar days."""
    if period == "weekly":
        first = start - timedelta(days=start.weekday())
        return first, first + timedelta(days=7)
    first = start.replace(day=1)
    nxt = (first.replace(year=first.year + 1, month=1) if first.month == 12
           else first.replace(month=first.month + 1))
    return first, nxt


def period_label(period: str, first: date, after: date) -> str:
    """As in the template: 'Week 41: Monday 5 to Sunday 11 October 2026' and
    'October 2026 (1 to 31 October)'."""
    last = after - timedelta(days=1)
    if period == "weekly":
        week = first.isocalendar()[1]
        if first.year != last.year:
            span = (f"Monday {first.day} {MONTHS[first.month - 1]} {first.year} to "
                    f"Sunday {last.day} {MONTHS[last.month - 1]} {last.year}")
        elif first.month != last.month:
            span = (f"Monday {first.day} {MONTHS[first.month - 1]} to "
                    f"Sunday {last.day} {MONTHS[last.month - 1]} {last.year}")
        else:
            span = f"Monday {first.day} to Sunday {last.day} {MONTHS[last.month - 1]} {last.year}"
        return f"Week {week}: {span}"
    return f"{MONTHS[first.month - 1]} {first.year} (1 to {last.day} {MONTHS[first.month - 1]})"


def reference(period: str, brand_code: str, first: date) -> str:
    """RPT-KHF-2610 for a month, RPT-KHF-2610-W41 for a week (the week's
    Thursday decides its month, as it decides its ISO week)."""
    code = re.sub(r"[^A-Z0-9]", "", (brand_code or "").upper()) or "BRAND"
    if period == "weekly":
        thu = first + timedelta(days=3)
        return f"RPT-{code}-{thu:%y%m}-W{thu.isocalendar()[1]:02d}"
    return f"RPT-{code}-{first:%y%m}"


def file_name(period: str, brand_name: str, first: date) -> str:
    safe = re.sub(r"[^A-Za-z0-9 ._-]", "", brand_name or "Brand").strip() or "Brand"
    if period == "weekly":
        y, w, _ = first.isocalendar()
        return f"Brand Sales Report - {safe} - Weekly - {y}-W{w:02d}.xlsx"
    return f"Brand Sales Report - {safe} - Monthly - {first:%Y-%m}.xlsx"


def to_utc(d: date) -> datetime:
    """WIB midnight of a calendar day, as the naive UTC the database stores."""
    return datetime(d.year, d.month, d.day) - WIB


def short_codes(sites: list[dict]) -> dict[int, str]:
    """MAC-MA5 reads MA5 to a brand; the full code stays when the short one clashes."""
    short = {s["id"]: s["code"].split("-")[-1] for s in sites}
    clash = {v for v in short.values() if list(short.values()).count(v) > 1}
    return {s["id"]: (s["code"] if short[s["id"]] in clash else short[s["id"]]) for s in sites}


# --- what the database has --------------------------------------------------------

_COLUMNS: dict[str, set[str]] = {}


async def _columns(table: str) -> set[str]:
    """Columns a table has, cached per process.

    Some columns this report reads (the message price, the cancel reason) come
    with the Hiryu link's migration. Asking first keeps the report working, with
    its fallbacks, on a database where that has not landed yet.
    """
    if table not in _COLUMNS:
        rows = await db.fetch_all(
            "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", (table,))
        _COLUMNS[table] = {r["c"] for r in rows}
    return _COLUMNS[table]


def _in(ids) -> str:
    return db.placeholders(ids)


async def _brand(brand_id: int) -> dict:
    b = await db.fetch_one("SELECT id, code, name FROM brands WHERE id = %s", (brand_id,))
    if not b:
        raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
    return b


async def _hubs(brand_id: int, since_utc: datetime, include_training: bool) -> list[dict]:
    """Dark stores that carry the brand and have something to report.

    A brand is carried at a hub unless a brand_sites row switches it off there
    (racks.py), which on its own would list every dark store; so a hub is only
    in the report when it has the brand's Grab store, a bin for one of its SKUs,
    or stock movement since the period began.
    """
    training = "" if include_training else "AND st.is_training = 0 "
    return await db.fetch_all(
        "SELECT st.id, st.code, st.name FROM sites st "
        "LEFT JOIN brand_sites bs ON bs.brand_id = %s AND bs.site_id = st.id "
        "WHERE st.site_type <> 'hub' AND COALESCE(bs.active, 1) = 1 " + training +
        "  AND (EXISTS (SELECT 1 FROM hiryu_stores hs WHERE hs.site_id = st.id "
        "               AND hs.brand_id = %s) "
        "    OR EXISTS (SELECT 1 FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
        "               WHERE sa.site_id = st.id AND s.brand_id = %s) "
        "    OR EXISTS (SELECT 1 FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
        "               WHERE m.site_id = st.id AND s.brand_id = %s AND m.created_at >= %s)) "
        "ORDER BY st.is_training, st.code",
        (brand_id, brand_id, brand_id, brand_id, since_utc),
    )


async def _stock_at(brand_id: int, site_ids: list[int], at_utc: datetime) -> dict:
    """{(site_id, sku_id): units} held at a moment: now, less what moved since."""
    out: dict = {}
    for r in await db.fetch_all(
            "SELECT ib.site_id, ib.sku_id, SUM(ib.qty_on_hand) AS q "
            "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
            "JOIN locations l ON l.id = ib.location_id AND l.is_virtual = 0 "
            f"WHERE s.brand_id = %s AND ib.site_id IN ({_in(site_ids)}) "
            "GROUP BY ib.site_id, ib.sku_id", [brand_id] + site_ids):
        out[(r["site_id"], r["sku_id"])] = int(r["q"] or 0)
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, SUM(m.qty_delta) AS q "
            "FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
            "JOIN locations l ON l.id = m.location_id AND l.is_virtual = 0 "
            f"WHERE s.brand_id = %s AND m.site_id IN ({_in(site_ids)}) AND m.created_at >= %s "
            "GROUP BY m.site_id, m.sku_id", [brand_id] + site_ids + [at_utc]):
        key = (r["site_id"], r["sku_id"])
        out[key] = out.get(key, 0) - int(r["q"] or 0)
    return out


async def _sales(brand_id: int, site_ids: list[int], start_utc: datetime, end_utc: datetime,
                 end_day: date, include_training: bool):
    """Per (site, sku): units and value; per site: orders and out-of-stock cancels."""
    ol_cols = await _columns("order_lines")
    o_cols = await _columns("orders")
    price_col = "ol.item_price_idr" if "item_price_idr" in ol_cols else "NULL"
    reason_col = "o.cancel_reason_code" if "cancel_reason_code" in o_cols else "NULL"
    test = "" if include_training else "AND o.is_test = 0 "
    store_col = "o.hiryu_store_no" if "hiryu_store_no" in o_cols else "NULL"
    rows = await db.fetch_all(
        "SELECT o.id AS order_id, o.site_id, o.status, " + reason_col + " AS reason_code, "
        "       " + store_col + " AS store_no, "
        "       ol.sku_id, ol.qty_ordered, ol.qty_picked, ol.status AS line_status, "
        "       ol.hiryu_item_id, ol.item_qty, " + price_col + " AS item_price, "
        "       s.price_idr AS sku_price "
        "FROM orders o JOIN order_lines ol ON ol.order_id = o.id "
        "JOIN skus s ON s.id = ol.sku_id "
        f"WHERE s.brand_id = %s AND o.site_id IN ({_in(site_ids)}) " + test +
        # The index narrows by created_at; the exact test is on the placing time.
        "  AND o.created_at >= %s AND o.created_at < %s "
        "  AND COALESCE(o.placed_at, o.created_at) >= %s "
        "  AND COALESCE(o.placed_at, o.created_at) < %s",
        [brand_id] + site_ids + [start_utc - timedelta(days=1), end_utc + timedelta(days=1),
                                 start_utc, end_utc])

    # Latest menu price per Hiryu item and store, for lines whose message
    # carried none: the order's own store first, then store 0 (the menu CSV
    # era, before menus were per store), then any store.
    need = sorted({r["hiryu_item_id"] for r in rows
                   if r["item_price"] is None and r["hiryu_item_id"]})
    p_store = ("hiryu_store_no" if "hiryu_store_no" in await _columns("hiryu_item_prices")
               else "0")
    prices: dict[str, list] = {}
    for i in range(0, len(need), 500):
        part = need[i:i + 500]
        for p in await db.fetch_all(
                "SELECT hiryu_item_id, " + p_store + " AS store_no, price_idr "
                "FROM hiryu_item_prices "
                f"WHERE hiryu_item_id IN ({_in(part)}) "
                # Prices in force by the period's end first, newest first.
                "ORDER BY hiryu_item_id, effective_date > %s, effective_date DESC, id DESC",
                part + [end_day]):
            prices.setdefault(p["hiryu_item_id"], []).append(p)

    def fallback_price(item_id, store_no):
        found = prices.get(item_id) or []
        for want in (store_no, 0, None):
            for p in found:
                if want is None or (p["store_no"] is not None and int(p["store_no"]) == want):
                    return int(p["price_idr"])
        return None

    lines: dict = {}
    orders: dict = {}
    for r in rows:
        site = r["site_id"]
        o = orders.setdefault(site, {}).setdefault(
            r["order_id"], {"cancelled": r["status"] == "cancelled", "short": False,
                            "reason": r["reason_code"]})
        if r["line_status"] == "short":
            o["short"] = True
        if r["status"] == "cancelled":
            continue
        units = int(r["qty_picked"] or 0)
        ordered = int(r["qty_ordered"] or 0)
        price = (r["item_price"] if r["item_price"] is not None
                 else fallback_price(r["hiryu_item_id"], int(r["store_no"] or 0)))
        if price is not None and ordered > 0:
            qty = r["item_qty"] if r["item_qty"] is not None else ordered
            value = int(price) * int(qty) * units / ordered
        elif r["sku_price"] is not None:
            value = int(r["sku_price"]) * units
        else:
            value = 0
        acc = lines.setdefault((site, r["sku_id"]), {"units": 0, "value": 0.0})
        acc["units"] += units
        acc["value"] += value

    figures = {}
    for site, by_order in orders.items():
        figures[site] = {
            "orders": len(by_order),
            "oos_cancelled": sum(1 for o in by_order.values()
                                 if o["cancelled"] and (o["short"] or str(o["reason"]) == "2001")),
        }
    return lines, figures


async def _skus(brand_id: int) -> dict[int, dict]:
    rows = await db.fetch_all(
        "SELECT s.id, s.brand_sku_code, s.name_display, s.unit_size, s.price_idr, s.active "
        "FROM skus s WHERE s.brand_id = %s", (brand_id,))
    skus = {r["id"]: dict(r) for r in rows}
    if not skus:
        return skus
    ids = list(skus)
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        for bc in await db.fetch_all(
                "SELECT sku_id, barcode FROM barcodes "
                f"WHERE sku_id IN ({_in(part)}) AND source <> 'test' "
                "ORDER BY registered_at, id", part):
            skus[bc["sku_id"]].setdefault("barcode", bc["barcode"])
    return skus


async def _menu_prices(brand_id: int, site_ids: list[int], sku_ids: list[int],
                       end_day: date) -> dict:
    """The single's latest Grab menu price, per (site, SKU), on or before the
    period's end.

    Menus are per store (§2.12), and a hub has one store per brand, so the price
    is looked up through that store: the item in the hub's store priced for that
    store first, then its store-0 price (the menu CSV era), then an item not tied
    to a store, then any store's price. Keyed (site_id, sku_id); (None, sku_id)
    holds the SKU's price when the hub has no store of its own on record.
    """
    hi_cols = await _columns("hiryu_items")
    p_cols = await _columns("hiryu_item_prices")
    hi_store = "hi.hiryu_store_no" if "hiryu_store_no" in hi_cols else "0"
    p_store = "p.hiryu_store_no" if "hiryu_store_no" in p_cols else "0"
    stores: dict[int, set] = {}
    for st in await db.fetch_all(
            "SELECT site_id, hiryu_store_no FROM hiryu_stores "
            f"WHERE brand_id = %s AND site_id IN ({_in(site_ids)})", [brand_id] + site_ids):
        stores.setdefault(st["site_id"], set()).add(int(st["hiryu_store_no"]))
    found: dict[int, list] = {}
    for i in range(0, len(sku_ids), 500):
        part = sku_ids[i:i + 500]
        for p in await db.fetch_all(
                "SELECT hi.sku_id, " + hi_store + " AS item_store, " + p_store + " AS price_store, "
                "       p.price_idr FROM hiryu_items hi "
                "JOIN hiryu_item_prices p ON p.hiryu_item_id = hi.hiryu_item_id "
                "  AND (" + p_store + " = " + hi_store + " OR " + p_store + " = 0) "
                f"WHERE hi.sku_id IN ({_in(part)}) AND hi.units_per_sale = 1 "
                "  AND p.effective_date <= %s "
                "ORDER BY p.effective_date DESC, p.id DESC",
                part + [end_day]):
            found.setdefault(p["sku_id"], []).append(p)

    def tier(p, mine: set) -> int:
        item, price = int(p["item_store"] or 0), int(p["price_store"] or 0)
        if item in mine:
            return 0 if price == item else 1
        return 2 if item == 0 else 3

    out: dict = {}
    for sku_id, rows in found.items():
        for site in list(site_ids) + [None]:
            mine = stores.get(site, set()) if site is not None else set()
            best = min(rows, key=lambda p: tier(p, mine))  # min keeps the newest in a tier
            out[(site, sku_id)] = int(best["price_idr"])
    return out


async def _ledger_sums(brand_id, site_ids, start_utc, end_utc) -> dict:
    """Per site: received, returned to the brand, written off, from the ledger."""
    codes = RETURN_CODES + WRITE_OFF_CODES
    rows = await db.fetch_all(
        "SELECT m.site_id, m.movement_type, m.reason_code, SUM(m.qty_delta) AS q "
        "FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
        f"WHERE s.brand_id = %s AND m.site_id IN ({_in(site_ids)}) "
        "  AND m.created_at >= %s AND m.created_at < %s "
        f"  AND (m.movement_type IN ({_in(RECEIPT_TYPES + codes)}) "
        f"       OR m.reason_code IN ({_in(codes)})) "
        "GROUP BY m.site_id, m.movement_type, m.reason_code",
        [brand_id] + site_ids + [start_utc, end_utc] + list(RECEIPT_TYPES + codes) + list(codes))
    out = {sid: {"received": 0, "returned": 0, "written_off": 0} for sid in site_ids}
    for r in rows:
        q = int(r["q"] or 0)
        acc = out[r["site_id"]]
        kinds = {r["movement_type"], r["reason_code"]}
        if r["movement_type"] in RECEIPT_TYPES:
            acc["received"] += q
        elif kinds & set(RETURN_CODES):
            acc["returned"] += -q
        elif kinds & set(WRITE_OFF_CODES):
            acc["written_off"] += -q
    return out


async def _returns_list(brand_id, site_ids, start_utc, end_utc, hub_code) -> list[dict]:
    codes = RETURN_CODES + WRITE_OFF_CODES
    rows = await db.fetch_all(
        "SELECT m.site_id, s.brand_sku_code, m.movement_type, m.reason_code, "
        "       DATE(m.created_at + INTERVAL 7 HOUR) AS day, SUM(m.qty_delta) AS q "
        "FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
        f"WHERE s.brand_id = %s AND m.site_id IN ({_in(site_ids)}) "
        "  AND m.created_at >= %s AND m.created_at < %s "
        f"  AND (m.movement_type IN ({_in(codes)}) OR m.reason_code IN ({_in(codes)})) "
        "GROUP BY m.site_id, s.brand_sku_code, m.movement_type, m.reason_code, "
        "         DATE(m.created_at + INTERVAL 7 HOUR) "
        "ORDER BY day, m.site_id, s.brand_sku_code",
        [brand_id] + site_ids + [start_utc, end_utc] + list(codes) + list(codes))
    out = []
    for r in rows:
        units = -int(r["q"] or 0)
        if units <= 0:
            continue
        kind = r["reason_code"] if r["reason_code"] in codes else r["movement_type"]
        returned = kind in RETURN_CODES or r["movement_type"] in RETURN_CODES
        reason = ("Returned to brand" if returned else "Written off") + (
            f": {kind.replace('_', ' ')}" if kind and kind not in ("write_off",) + RETURN_CODES
            else "")
        day = r["day"]
        out.append({
            "hub": hub_code[r["site_id"]], "sku_code": r["brand_sku_code"], "reason": reason,
            "units": units, "cost_by": None,
            "date": day.strftime("%d/%m/%Y") if hasattr(day, "strftime") else str(day),
        })
    return out


async def _counted(brand_id, site_ids, month_end_utc) -> dict:
    """Units counted per site at the month-end full count, or nothing.

    The last finished count of each bin from three days before the month ends to
    five days after (the count is approved on the first working days of the
    next month, §15.1). A hub with no such count has no figure.
    """
    rows = await db.fetch_all(
        "SELECT os.site_id, os.basket_id, os.qty_counted, os.finished_at, os.id "
        "FROM opname_sessions os JOIN skus s ON s.id = os.sku_id "
        f"WHERE s.brand_id = %s AND os.site_id IN ({_in(site_ids)}) "
        "  AND os.status = 'finished' AND os.finished_at >= %s AND os.finished_at < %s "
        "ORDER BY os.finished_at, os.id",
        [brand_id] + site_ids + [month_end_utc - timedelta(days=3),
                                 month_end_utc + timedelta(days=5)])
    last: dict = {}
    for r in rows:
        last[(r["site_id"], r["basket_id"])] = int(r["qty_counted"] or 0)
    out: dict = {}
    for (site, _), q in last.items():
        out[site] = out.get(site, 0) + q
    return out


async def _deliveries(brand_id, site_ids, start_utc, end_utc, hub_code) -> list[dict]:
    out = []
    for r in await db.fetch_all(
            "SELECT r.reference, r.site_id, r.awb, r.received_at, "
            "       SUM(rl.qty_requested) AS req, SUM(rl.qty_confirmed) AS sent, "
            "       SUM(rl.qty_received) AS recv "
            "FROM replenishments r JOIN replenishment_lines rl ON rl.replenishment_id = r.id "
            f"WHERE r.brand_id = %s AND r.site_id IN ({_in(site_ids)}) "
            "  AND r.received_at >= %s AND r.received_at < %s "
            "GROUP BY r.id, r.reference, r.site_id, r.awb, r.received_at",
            [brand_id] + site_ids + [start_utc, end_utc]):
        out.append({"when": r["received_at"], "awb": r["awb"], "hub": hub_code[r["site_id"]],
                    "requested": _int(r["req"]), "sent": _int(r["sent"]),
                    "received": _int(r["recv"]), "po_number": r["reference"]})
    ir_cols = await _columns("inbound_receipts")
    awb = "ir.external_reference" if "external_reference" in ir_cols else "NULL"
    for r in await db.fetch_all(
            "SELECT ir.id, ir.site_id, " + awb + " AS awb, ir.completed_at, "
            "       SUM(rl.qty_expected) AS sent, SUM(rl.qty_received) AS recv "
            "FROM inbound_receipts ir JOIN receipt_lines rl ON rl.receipt_id = ir.id "
            "JOIN skus s ON s.id = rl.sku_id "
            f"WHERE s.brand_id = %s AND ir.site_id IN ({_in(site_ids)}) "
            "  AND ir.replenishment_id IS NULL AND ir.source_type = 'from_brand' "
            "  AND ir.completed_at >= %s AND ir.completed_at < %s "
            "GROUP BY ir.id, ir.site_id, ir.completed_at",
            [brand_id] + site_ids + [start_utc, end_utc]):
        out.append({"when": r["completed_at"], "awb": r["awb"], "hub": hub_code[r["site_id"]],
                    "requested": None, "sent": _int(r["sent"]), "received": _int(r["recv"]),
                    "po_number": None})
    out.sort(key=lambda d: d["when"] or datetime.min)
    for d in out:
        w = d.pop("when")
        d["date"] = (w + WIB).strftime("%d/%m/%Y") if w else None
    return out


def _int(v):
    return None if v is None else int(v)


# --- assembling ----------------------------------------------------------------------

async def gather(brand_id: int, period: str, start: date, include_training: bool = False) -> dict:
    """Everything brand_report_excel.build needs, for one brand and period."""
    brand = await _brand(brand_id)
    first, after = period_bounds(period, start)
    start_utc, end_utc = to_utc(first), to_utc(after)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    monthly = period == "monthly"
    end_day = after - timedelta(days=1)

    sites = await _hubs(brand_id, start_utc, include_training)
    codes = short_codes(sites)
    data = {
        "brand_name": brand["name"], "monthly": monthly,
        "period_label": period_label(period, first, after),
        "reference": reference(period, brand["code"], first),
        "made": (now_utc + WIB).strftime("%d/%m/%Y %H:%M WIB"),
        "weeks": 1 if not monthly else round((after - first).days / 7, 2),
        "hubs": [{"code": codes[s["id"]], "label": f"{codes[s['id']]} {s['name']}"}
                 for s in sites],
        "skus": [], "hub_figures": {},
        "reconciliation": [], "deliveries": [], "returns": [],
        "file_name": file_name(period, brand["name"], first),
    }
    if not sites:
        return data
    site_ids = [s["id"] for s in sites]

    # A period still running reports stock as it is now.
    stock_end = await _stock_at(brand_id, site_ids, min(end_utc, now_utc))
    lines, figures = await _sales(brand_id, site_ids, start_utc, end_utc, end_day,
                                  include_training)
    skus = await _skus(brand_id)
    prices = await _menu_prices(brand_id, site_ids, list(skus), end_day)
    slotted = {(r["site_id"], r["sku_id"]) for r in await db.fetch_all(
        "SELECT sa.site_id, sa.sku_id FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
        f"WHERE s.brand_id = %s AND sa.site_id IN ({_in(site_ids)})", [brand_id] + site_ids)}

    for s in sites:
        for sku_id, sku in sorted(skus.items(), key=lambda kv: kv[1]["brand_sku_code"] or ""):
            key = (s["id"], sku_id)
            sold = lines.get(key)
            held = stock_end.get(key, 0)
            # A SKU the hub never carried and never sold is noise to the brand.
            if not sold and not held and key not in slotted:
                continue
            if not sku["active"] and not sold and not held:
                continue
            data["skus"].append({
                "hub": codes[s["id"]], "sku_code": sku["brand_sku_code"],
                "barcode": sku.get("barcode"), "product": sku["name_display"],
                "size": sku["unit_size"],
                "menu_price": prices.get(key, prices.get((None, sku_id), sku["price_idr"])),
                "units_sold": sold["units"] if sold else 0,
                "sales_value": round(sold["value"]) if sold else 0,
                "stock_end": held,
            })
        f = figures.get(s["id"], {"orders": 0, "oos_cancelled": 0})
        data["hub_figures"][codes[s["id"]]] = f

    if monthly:
        opening = await _stock_at(brand_id, site_ids, start_utc)
        sums = await _ledger_sums(brand_id, site_ids, start_utc, end_utc)
        counted = await _counted(brand_id, site_ids, end_utc)
        for s in sites:
            sid = s["id"]
            data["reconciliation"].append({
                "hub": codes[sid],
                "opening": sum(q for (site, _), q in opening.items() if site == sid),
                "received": sums[sid]["received"],
                "returned": sums[sid]["returned"],
                "written_off": sums[sid]["written_off"],
                "counted": counted.get(sid),
            })
        data["deliveries"] = await _deliveries(brand_id, site_ids, start_utc, end_utc, codes)
        data["returns"] = await _returns_list(brand_id, site_ids, start_utc, end_utc, codes)
    return data


def _parse_start(start: str | None) -> date:
    if not start:
        return (datetime.now(timezone.utc) + WIB).date()
    try:
        return date.fromisoformat(start)
    except ValueError:
        raise HTTPException(422, "Tanggal harus YYYY-MM-DD. / The date must be YYYY-MM-DD.")


@router.get("/brand-sales/period", response_model=models.BrandReportPeriod)
async def brand_sales_period(
    brand_id: int,
    period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
    start: str | None = None,
    include_training: bool = False,
    user: auth.User = Depends(auth.require("hq")),
):
    """What a download would cover, so the page can say it before the file is made."""
    brand = await _brand(brand_id)
    first, after = period_bounds(period, _parse_start(start))
    sites = await _hubs(brand_id, to_utc(first), include_training)
    codes = short_codes(sites)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "brand_id": brand_id, "brand_name": brand["name"], "period": period,
        "start": first.isoformat(), "end": (after - timedelta(days=1)).isoformat(),
        "label": period_label(period, first, after),
        "reference": reference(period, brand["code"], first),
        "hubs": [f"{codes[s['id']]} {s['name']}" for s in sites],
        "is_current": to_utc(after) > now_utc,
        "file_name": file_name(period, brand["name"], first),
    }


@router.get(
    "/brand-sales.xlsx",
    response_class=Response,
    responses={200: {"content": {brand_report_excel.CONTENT_TYPE: {}},
                     "description": "The brand sales report (PRD §15.1)"}},
)
async def brand_sales_xlsx(
    brand_id: int,
    period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
    start: str | None = Query(default=None, description="Any day in the period, YYYY-MM-DD (WIB)"),
    include_training: bool = False,
    user: auth.User = Depends(auth.require("hq")),
):
    """The weekly or monthly Excel for one brand, in the approved layout."""
    data = await gather(brand_id, period, _parse_start(start), include_training)
    body = brand_report_excel.build(data)
    await db.execute(
        "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
        "VALUES (%s,'report.brand_sales','brands',%s,%s)",
        (user.email, brand_id, f"{data['reference']} {data['file_name']}"))
    return Response(
        content=body, media_type=brand_report_excel.CONTENT_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{data["file_name"]}"'},
    )
