"""Reports (canvas Section 10): end of day, brand sales, operational, variance.

Every figure is a WMS number, never Hiryu's (Hiryu's stock is lower by the Grab
buffer). Ops HQ downloads the files and emails them by hand; the WMS sends no
email. Files for brands and Grab are Excel in English; the screens stay in
Indonesian. Test orders (UJI, is_test) and cancelled orders are left out of
sales. The 10-minute target counts from Grab's order time to Selesai dikemas.

Periods are in WIB (UTC+7): a week is Monday 00:00 to the next Monday 00:00, a
month the calendar month. Every timestamp in the database is UTC (V13), so the
bounds move back 7 hours before they reach a query. Every report takes a hub
multi-select (``hub_ids=1,2``); none means *Semua hub*.

Where the brand file's figures come from:

* **Units sold** = order_lines.qty_picked of orders not cancelled and not tests,
  placed in the period (placed_at, else created_at).
* **Sales value** = the item's price from Hiryu's order message x item_qty,
  scaled for a line not picked in full; else the latest Hiryu menu price on or
  before the period's end; else skus.price_idr x units.
* **Menu price** = the single's latest price in the hub's own Grab store.
* **Stock at end / Opening** = today's balances minus every movement since that
  moment (the ledger is append-only and balances are its projection).
* **Received** = receipt movements in the period, plus units a quarantine
  decision put on the rack that had never been stock (damaged at inbound, fine
  after all).
* **Returned to brand** = old stock taken off the shelf for a return note, plus
  quarantined units that went back on a note.
* **Written off** = every other unit that left the stock for quarantine in the
  period (decided or still in the tray), net of units a decision put back on
  the rack. So Expected = Opening + Received - Sold - Returned - Written off
  matches the ledger, and Difference = Counted - Expected is the count's
  finding.
* **Counted at month end** = the final number of the month-end full count
  (count_tasks.is_full on the month's last day), per SKU.
"""
import csv
import io
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

import auth
import brand_report_excel as xl
import db
from routers import opname
from routers.opname import WIB, hub_short, iso, names_for, rule_values, table_exists, utcnow, wib_today

router = APIRouter(prefix="/api/reports", tags=["reports"])

MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")
MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
RECEIPT_TYPES = ("receipt_in", "receipt_adjust", "receipt_undo")
REASON_EN = {
    "rusak": "Damaged", "bocor": "Leaking", "kedaluwarsa": "Expired", "produk_salah": "Wrong product",
    "driver_rusak": "Parcel back from the driver, damaged", "kardus_penyok": "Outer box damaged",
    "lainnya": "Other",
}


# --- the period --------------------------------------------------------------------

def period_bounds(period: str, start: date) -> tuple[date, date]:
    """First day and the day after the last, in WIB calendar days."""
    if period == "weekly":
        first = start - timedelta(days=start.weekday())
        return first, first + timedelta(days=7)
    first = start.replace(day=1)
    nxt = (first.replace(year=first.year + 1, month=1) if first.month == 12
           else first.replace(month=first.month + 1))
    return first, nxt


def previous_start(period: str, first: date) -> date:
    return first - timedelta(days=7) if period == "weekly" else (first - timedelta(days=1)).replace(day=1)


def period_label(period: str, first: date, after: date) -> str:
    """'Week 40, 28 Sep to 4 Oct 2026' and 'September 2026'."""
    last = after - timedelta(days=1)
    if period == "weekly":
        y, w, _ = first.isocalendar()
        return f"Week {w}, {first.day} {MON[first.month - 1]} to {last.day} {MON[last.month - 1]} {last.year}"
    return f"{MONTHS[first.month - 1]} {first.year}"


def period_label_id(period: str, first: date, after: date) -> str:
    """'W40, 28 Sep sampai 4 Okt 2026' and 'September 2026', as on the screens."""
    last = after - timedelta(days=1)
    bln = opname.MONTHS_ID
    if period == "weekly":
        w = first.isocalendar()[1]
        return f"W{w}, {first.day} {bln[first.month - 1]} sampai {last.day} {bln[last.month - 1]} {last.year}"
    full = ("Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September",
            "Oktober", "November", "Desember")
    return f"{full[first.month - 1]} {first.year}"


def period_tag(period: str, first: date) -> str:
    """2026-W40 or 2026-09."""
    if period == "weekly":
        y, w, _ = first.isocalendar()
        return f"{y}-W{w:02d}"
    return f"{first:%Y-%m}"


def to_utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day) - WIB


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9 ._-]", "", name or "").strip() or "Report"


def _parse_start(start: str | None) -> date:
    if not start:
        return wib_today()
    try:
        return date.fromisoformat(start[:10] if len(start) > 7 else start + "-01")
    except ValueError:
        raise HTTPException(422, "Tanggal harus YYYY-MM-DD. / The date must be YYYY-MM-DD.")


def _ids(hub_ids: str | None) -> list[int]:
    if not hub_ids:
        return []
    try:
        return sorted({int(x) for x in hub_ids.replace(" ", "").split(",") if x})
    except ValueError:
        raise HTTPException(422, "hub_ids: angka dipisah koma. / hub_ids: comma-separated numbers.")


def _in(ids) -> str:
    return db.placeholders(ids)


def _int(v):
    return None if v is None else int(v)


def _join(codes: list[str]) -> str:
    return codes[0] if len(codes) == 1 else ", ".join(codes[:-1]) + " and " + codes[-1] if codes else "none"


# --- what the database has ------------------------------------------------------------

_COLUMNS: dict[str, set[str]] = {}


async def _columns(table: str) -> set[str]:
    if table not in _COLUMNS:
        rows = await db.fetch_all(
            "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", (table,))
        _COLUMNS[table] = {r["c"] for r in rows}
    return _COLUMNS[table]


def _demo_left_out(alias: str = "o") -> str:
    """A dummy order of Mode demo (is_demo, V27) counts while its hub is in Mode
    demo, so the reports match what the demo showed; once the hub leaves Mode
    demo its dummy orders drop out of every report."""
    return (f"({alias}.is_demo = 1 AND {alias}.site_id NOT IN "
            "(SELECT dm.id FROM sites dm WHERE dm.demo_mode = 1))")


async def _test_filter(alias: str = "o") -> str:
    """Leave out test orders: is_test, UJI orders made in the WMS, and dummy
    orders of a hub no longer in Mode demo."""
    cols = await _columns("orders")
    sql = f"AND {alias}.is_test = 0 "
    if "source" in cols:
        sql += f"AND COALESCE({alias}.source, '') <> 'uji' "
    if "is_demo" in cols:
        sql += f"AND NOT {_demo_left_out(alias)} "
    return sql


async def _brand(brand_id: int) -> dict:
    b = await db.fetch_one("SELECT id, code, name FROM brands WHERE id = %s", (brand_id,))
    if not b:
        raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
    return b


async def _live_hubs(user: auth.User, hub_ids: list[int]) -> list[dict]:
    """The hubs a report covers: the ones picked, or every live dark store the
    person may see (Semua hub)."""
    if hub_ids:
        out = []
        for sid in hub_ids:
            s = await auth.assert_site_access(user, sid)
            out.append({"id": s["id"], "code": s["code"], "name": s["name"]})
        return out
    if user.at_least("hq"):
        return await db.fetch_all("SELECT id, code, name FROM sites WHERE active = 1 AND is_training = 0 "
                                  "AND site_type <> 'hub' ORDER BY code")
    return await db.fetch_all(
        "SELECT s.id, s.code, s.name FROM sites s JOIN user_sites us ON us.site_id = s.id "
        "WHERE us.user_id = %s AND s.active = 1 AND s.is_training = 0 AND s.site_type <> 'hub' "
        "ORDER BY s.code", (user.id,))


async def _brand_hubs(brand_id: int, hubs: list[dict], since_utc: datetime) -> list[dict]:
    """Of the chosen hubs, those that carry the brand and have something to report."""
    if not hubs:
        return []
    ids = [h["id"] for h in hubs]
    rows = await db.fetch_all(
        "SELECT st.id FROM sites st "
        "LEFT JOIN brand_sites bs ON bs.brand_id = %s AND bs.site_id = st.id "
        f"WHERE st.id IN ({_in(ids)}) AND COALESCE(bs.active, 1) = 1 "
        "  AND (EXISTS (SELECT 1 FROM hiryu_stores hs WHERE hs.site_id = st.id AND hs.brand_id = %s) "
        "    OR EXISTS (SELECT 1 FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
        "               WHERE sa.site_id = st.id AND s.brand_id = %s) "
        "    OR EXISTS (SELECT 1 FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
        "               WHERE m.site_id = st.id AND s.brand_id = %s AND m.created_at >= %s))",
        [brand_id] + ids + [brand_id, brand_id, brand_id, since_utc])
    keep = {r["id"] for r in rows}
    return [h for h in hubs if h["id"] in keep]


async def _stock_at(brand_id: int | None, site_ids: list[int], at_utc: datetime) -> dict:
    """{(site_id, sku_id): units} held at a moment: now, less what moved since."""
    out: dict = {}
    if not site_ids:
        return out
    bf = "s.brand_id = %s AND " if brand_id else ""
    bp = [brand_id] if brand_id else []
    for r in await db.fetch_all(
            "SELECT ib.site_id, ib.sku_id, SUM(ib.qty_on_hand) AS q "
            "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
            "JOIN locations l ON l.id = ib.location_id AND l.is_virtual = 0 "
            f"WHERE {bf}ib.site_id IN ({_in(site_ids)}) GROUP BY ib.site_id, ib.sku_id", bp + site_ids):
        out[(r["site_id"], r["sku_id"])] = int(r["q"] or 0)
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, SUM(m.qty_delta) AS q "
            "FROM stock_movements m JOIN skus s ON s.id = m.sku_id "
            "JOIN locations l ON l.id = m.location_id AND l.is_virtual = 0 "
            f"WHERE {bf}m.site_id IN ({_in(site_ids)}) AND m.created_at >= %s "
            "GROUP BY m.site_id, m.sku_id", bp + site_ids + [at_utc]):
        key = (r["site_id"], r["sku_id"])
        out[key] = out.get(key, 0) - int(r["q"] or 0)
    return out


async def _sales(brand_id: int | None, site_ids: list[int], start_utc: datetime, end_utc: datetime,
                 end_day: date):
    """Per (site, sku): units, value and missing-item cancels; per site: orders
    and missing-item cancels."""
    if not site_ids:
        return {}, {}
    ol_cols = await _columns("order_lines")
    o_cols = await _columns("orders")
    price_col = "ol.item_price_idr" if "item_price_idr" in ol_cols else "NULL"
    reason_col = "o.cancel_reason_code" if "cancel_reason_code" in o_cols else "NULL"
    store_col = "o.hiryu_store_no" if "hiryu_store_no" in o_cols else "NULL"
    bf = "s.brand_id = %s AND " if brand_id else ""
    rows = await db.fetch_all(
        "SELECT o.id AS order_id, o.site_id, o.status, " + reason_col + " AS reason_code, "
        "       " + store_col + " AS store_no, "
        "       ol.sku_id, ol.qty_ordered, ol.qty_picked, ol.status AS line_status, "
        "       ol.hiryu_item_id, ol.item_qty, " + price_col + " AS item_price, s.price_idr AS sku_price "
        "FROM orders o JOIN order_lines ol ON ol.order_id = o.id JOIN skus s ON s.id = ol.sku_id "
        f"WHERE {bf}o.site_id IN ({_in(site_ids)}) " + await _test_filter() +
        "  AND o.created_at >= %s AND o.created_at < %s "
        "  AND COALESCE(o.placed_at, o.created_at) >= %s AND COALESCE(o.placed_at, o.created_at) < %s",
        ([brand_id] if brand_id else []) + site_ids +
        [start_utc - timedelta(days=1), end_utc + timedelta(days=1), start_utc, end_utc])

    need = sorted({r["hiryu_item_id"] for r in rows if r["item_price"] is None and r["hiryu_item_id"]})
    p_store = "hiryu_store_no" if "hiryu_store_no" in await _columns("hiryu_item_prices") else "0"
    prices: dict[str, list] = {}
    for i in range(0, len(need), 500):
        part = need[i:i + 500]
        for p in await db.fetch_all(
                "SELECT hiryu_item_id, " + p_store + " AS store_no, price_idr FROM hiryu_item_prices "
                f"WHERE hiryu_item_id IN ({_in(part)}) "
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
            r["order_id"], {"cancelled": r["status"] == "cancelled", "short_skus": set(),
                            "reason": r["reason_code"]})
        if r["line_status"] == "short":
            o["short_skus"].add(r["sku_id"])
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
        acc = lines.setdefault((site, r["sku_id"]), {"units": 0, "value": 0.0, "oos": 0})
        acc["units"] += units
        acc["value"] += value

    figures = {}
    for site, by_order in orders.items():
        oos = 0
        for o in by_order.values():
            if o["cancelled"] and (o["short_skus"] or str(o["reason"]) == "2001"):
                oos += 1
                for sku in o["short_skus"]:
                    acc = lines.setdefault((site, sku), {"units": 0, "value": 0.0, "oos": 0})
                    acc["oos"] += 1
        figures[site] = {"orders": len(by_order), "oos_cancelled": oos}
    return lines, figures


async def _skus(brand_id: int) -> dict[int, dict]:
    rows = await db.fetch_all(
        "SELECT s.id, s.brand_sku_code, s.name_display, s.unit_size, s.price_idr, s.active "
        "FROM skus s WHERE s.brand_id = %s", (brand_id,))
    skus = {r["id"]: dict(r) for r in rows}
    ids = list(skus)
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        for bc in await db.fetch_all(
                f"SELECT sku_id, barcode FROM barcodes WHERE sku_id IN ({_in(part)}) AND source <> 'test' "
                "ORDER BY registered_at, id", part):
            skus[bc["sku_id"]].setdefault("barcode", bc["barcode"])
    return skus


async def _menu_prices(brand_id: int, site_ids: list[int], sku_ids: list[int], end_day: date) -> dict:
    """The single's latest Grab menu price per (site, SKU) on or before the
    period's end, through the hub's own store; (None, sku) when it has none."""
    if not sku_ids:
        return {}
    hi_cols = await _columns("hiryu_items")
    p_cols = await _columns("hiryu_item_prices")
    hi_store = "hi.hiryu_store_no" if "hiryu_store_no" in hi_cols else "0"
    p_store = "p.hiryu_store_no" if "hiryu_store_no" in p_cols else "0"
    stores: dict[int, set] = {}
    if site_ids:
        for st in await db.fetch_all(
                f"SELECT site_id, hiryu_store_no FROM hiryu_stores WHERE brand_id = %s "
                f"AND site_id IN ({_in(site_ids)})", [brand_id] + site_ids):
            stores.setdefault(st["site_id"], set()).add(int(st["hiryu_store_no"]))
    found: dict[int, list] = {}
    for i in range(0, len(sku_ids), 500):
        part = sku_ids[i:i + 500]
        for p in await db.fetch_all(
                "SELECT hi.sku_id, " + hi_store + " AS item_store, " + p_store + " AS price_store, "
                "       p.price_idr FROM hiryu_items hi "
                "JOIN hiryu_item_prices p ON p.hiryu_item_id = hi.hiryu_item_id "
                "  AND (" + p_store + " = " + hi_store + " OR " + p_store + " = 0) "
                f"WHERE hi.sku_id IN ({_in(part)}) AND hi.units_per_sale = 1 AND p.effective_date <= %s "
                "ORDER BY p.effective_date DESC, p.id DESC", part + [end_day]):
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
            out[(site, sku_id)] = int(min(rows, key=lambda p: tier(p, mine))["price_idr"])
    return out


# --- the monthly stock reconciliation ---------------------------------------------------

async def _flows(brand_id: int, site_ids: list[int], start_utc: datetime, end_utc: datetime) -> dict:
    """{(site, sku): {received, returned, written_off}} for the period (see the
    module docstring for the rules)."""
    out: dict = {}

    def acc(key):
        return out.setdefault(key, {"received": 0, "returned": 0, "written_off": 0})

    base = [brand_id] + site_ids + [start_utc, end_utc]
    where = (f"s.brand_id = %s AND m.site_id IN ({_in(site_ids)}) "
             "AND m.created_at >= %s AND m.created_at < %s ")
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, SUM(m.qty_delta) AS q FROM stock_movements m "
            f"JOIN skus s ON s.id = m.sku_id WHERE {where} "
            f"AND m.movement_type IN ({_in(RECEIPT_TYPES)}) GROUP BY m.site_id, m.sku_id",
            base + list(RECEIPT_TYPES)):
        acc((r["site_id"], r["sku_id"]))["received"] += int(r["q"] or 0)
    # Old stock taken off the shelf for a return note (and put back if cancelled).
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, SUM(m.qty_delta) AS q FROM stock_movements m "
            f"JOIN skus s ON s.id = m.sku_id WHERE {where} "
            "AND m.reason_code IN ('return_to_brand','return_cancelled') GROUP BY m.site_id, m.sku_id", base):
        acc((r["site_id"], r["sku_id"]))["returned"] -= int(r["q"] or 0)
    # Units that left a bin for quarantine: returned when they went back on a
    # note, written off otherwise (decided or not yet).
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, q.status, SUM(m.qty_delta) AS q FROM stock_movements m "
            "JOIN skus s ON s.id = m.sku_id "
            "JOIN quarantine_items q ON q.id = m.ref_id AND m.ref_type = 'quarantine_item' "
            f"WHERE {where} AND m.reason_code = 'quarantine' GROUP BY m.site_id, m.sku_id, q.status", base):
        kind = "returned" if r["status"] in ("on_note", "returned") else "written_off"
        acc((r["site_id"], r["sku_id"]))[kind] -= int(r["q"] or 0)
    # Damaged parcels back from the driver left the ledger when picked, and the
    # cancelled order is not in Sold: they count here when reported, unless the
    # SPV put them back on the rack.
    for r in await db.fetch_all(
            "SELECT q.site_id, q.sku_id, q.status, SUM(q.qty) AS n FROM quarantine_items q "
            f"JOIN skus s ON s.id = q.sku_id WHERE s.brand_id = %s AND q.site_id IN ({_in(site_ids)}) "
            "AND q.reported_at >= %s AND q.reported_at < %s AND q.origin = 'driver_return' "
            "AND q.status <> 'back_to_rack' GROUP BY q.site_id, q.sku_id, q.status", base):
        kind = "returned" if r["status"] in ("on_note", "returned") else "written_off"
        acc((r["site_id"], r["sku_id"]))[kind] += int(r["n"] or 0)
    # A quarantine decision put units on the rack (return-to-shelf scan).
    for r in await db.fetch_all(
            "SELECT m.site_id, m.sku_id, q.origin, SUM(m.qty_delta) AS q FROM stock_movements m "
            "JOIN skus s ON s.id = m.sku_id "
            "JOIN quarantine_items q ON q.return_task_id = m.ref_id AND m.ref_type = 'return_task' "
            f"WHERE {where} AND m.movement_type = 'return_in' GROUP BY m.site_id, m.sku_id, q.origin", base):
        a = acc((r["site_id"], r["sku_id"]))
        if r["origin"] in ("inbound", "inbound_rejected"):
            a["received"] += int(r["q"] or 0)
        elif r["origin"] == "hub":
            a["written_off"] -= int(r["q"] or 0)
    return out


async def _counted(brand_id: int, site_ids: list[int], month_last: date) -> tuple[dict, dict]:
    """Per (site, sku): the final month-end full count; per site: when the last
    bin was approved (None while any bin is still open)."""
    rows = await db.fetch_all(
        "SELECT t.site_id, t.sku_id, t.status, t.qty_final, COALESCE(t.approved_at, t.closed_at) AS at "
        "FROM count_tasks t JOIN skus s ON s.id = t.sku_id "
        f"WHERE s.brand_id = %s AND t.site_id IN ({_in(site_ids)}) AND t.is_full = 1 AND t.plan_date = %s",
        [brand_id] + site_ids + [month_last])
    counted: dict = {}
    approved: dict = {}
    for r in rows:
        if r["status"] == "closed" and r["qty_final"] is not None:
            counted[(r["site_id"], r["sku_id"])] = counted.get((r["site_id"], r["sku_id"]), 0) + int(r["qty_final"])
    by_site: dict = {}
    for r in rows:
        by_site.setdefault(r["site_id"], []).append(r)
    for sid, lst in by_site.items():
        approved[sid] = (max(r["at"] for r in lst) if all(r["status"] == "closed" for r in lst) else None)
    return counted, approved


async def _deliveries(brand_id: int, site_ids: list[int], start_utc: datetime, end_utc: datetime,
                      codes: dict) -> list[dict]:
    cols = await _columns("replenishments")
    po = "r.brand_po_number" if "brand_po_number" in cols else "NULL"
    due = "COALESCE(r.po_requested_date, r.eta_date)" if "po_requested_date" in cols else "r.eta_date"
    out = []
    for r in await db.fetch_all(
            "SELECT r.id, r.reference, " + po + " AS po_number, r.site_id, r.received_at, " + due + " AS due, "
            "       SUM(COALESCE(rl.qty_confirmed, rl.qty_requested)) AS ordered, SUM(rl.qty_received) AS recv, "
            "       (SELECT COALESCE(SUM(q.qty),0) FROM quarantine_items q WHERE q.replenishment_id = r.id "
            "         AND q.origin IN ('inbound','inbound_rejected')) AS damaged "
            "FROM replenishments r JOIN replenishment_lines rl ON rl.replenishment_id = r.id "
            f"WHERE r.brand_id = %s AND r.site_id IN ({_in(site_ids)}) "
            "  AND r.received_at >= %s AND r.received_at < %s "
            "GROUP BY r.id, r.reference, r.site_id, r.received_at ORDER BY r.received_at",
            [brand_id] + site_ids + [start_utc, end_utc]):
        got = (r["received_at"] + WIB).date()
        late = (got - r["due"]).days if r["due"] else None
        out.append({"hub": codes[r["site_id"]], "po_number": r["po_number"] or r["reference"],
                    "reference": r["reference"], "date": f"{got.day} {MON[got.month - 1]} {got.year}",
                    "ordered": _int(r["ordered"]), "received": _int(r["recv"]),
                    "damaged": _int(r["damaged"]) or 0,
                    "on_time": None if late is None else ("Yes" if late <= 0 else
                                                          f"{late} day{'s' if late > 1 else ''} late"),
                    "late_days": late})
    return out


async def _returns_list(brand_id: int, site_ids: list[int], start_utc: datetime, end_utc: datetime,
                        codes: dict, old_days: int) -> list[dict]:
    """Returns and write-offs of the month, with the reason and who bears it."""
    out = []
    for r in await db.fetch_all(
            "SELECT rn.site_id, s.brand_sku_code, ln.origin, ln.qty, rn.handed_over_at AS at, q.reason "
            "FROM return_note_lines ln JOIN return_notes rn ON rn.id = ln.note_id "
            "JOIN skus s ON s.id = ln.sku_id LEFT JOIN quarantine_items q ON q.id = ln.quarantine_item_id "
            f"WHERE rn.brand_id = %s AND rn.site_id IN ({_in(site_ids)}) AND rn.status = 'handed_over' "
            "AND rn.handed_over_at >= %s AND rn.handed_over_at < %s ORDER BY rn.handed_over_at",
            [brand_id] + site_ids + [start_utc, end_utc]):
        reason = {"old_stock": f"Old stock (over {old_days} days in the dark store), sent back",
                  "rejected": f"Rejected at inbound ({REASON_EN.get(r['reason'], 'other').lower()}), sent back",
                  }.get(r["origin"], f"{REASON_EN.get(r['reason'], 'Other')}, sent back")
        d = (r["at"] + WIB).date()
        out.append({"hub": codes[r["site_id"]], "sku_code": r["brand_sku_code"], "reason": reason,
                    "date": f"{d.day} {MON[d.month - 1]}", "units": int(r["qty"]), "type": "Return",
                    "_at": r["at"]})
    for r in await db.fetch_all(
            "SELECT q.site_id, s.brand_sku_code, q.origin, q.reason, q.cost_bearer, q.qty, q.status, "
            "       COALESCE(q.hq_at, q.reported_at) AS at FROM quarantine_items q "
            f"JOIN skus s ON s.id = q.sku_id WHERE s.brand_id = %s AND q.site_id IN ({_in(site_ids)}) "
            "AND ((q.status = 'written_off' AND q.hq_at >= %s AND q.hq_at < %s) "
            "  OR (q.status IN ('open','write_off_pending','return_pending','on_note') AND q.in_ledger = 1 "
            "      AND q.reported_at >= %s AND q.reported_at < %s)) ORDER BY at",
            [brand_id] + site_ids + [start_utc, end_utc, start_utc, end_utc]):
        bearer = "Ninja's" if r["cost_bearer"] == "ninja" else "the brand's"
        where = {"hub": "in the dark store", "inbound": "at inbound", "inbound_rejected": "at inbound",
                 "driver_return": "back from the driver"}.get(r["origin"], "")
        reason = f"{REASON_EN.get(r['reason'], 'Other')} {where}, {bearer} cost".replace("  ", " ")
        d = (r["at"] + WIB).date()
        out.append({"hub": codes[r["site_id"]], "sku_code": r["brand_sku_code"], "reason": reason,
                    "date": f"{d.day} {MON[d.month - 1]}", "units": int(r["qty"]),
                    "type": {"written_off": "Write-off", "on_note": "Return, not handed over yet"}.get(
                        r["status"], "In quarantine"),
                    "_at": r["at"]})
    out.sort(key=lambda x: x.pop("_at") or datetime.min)
    return out


# --- brand sales: gathering ------------------------------------------------------------------

async def gather(brand_id: int, period: str, start: date, hubs: list[dict]) -> dict:
    """Everything brand_report_excel.build needs for one brand, period and hub choice."""
    brand = await _brand(brand_id)
    first, after = period_bounds(period, start)
    start_utc, end_utc = to_utc(first), to_utc(after)
    now_utc = utcnow()
    monthly = period == "monthly"
    end_day = after - timedelta(days=1)
    sites = await _brand_hubs(brand_id, hubs, start_utc)
    codes = {s["id"]: hub_short(s["code"]) for s in sites}
    weeks = 1 if not monthly else round((after - first).days / 7, 2)
    data = {
        "brand_name": brand["name"], "monthly": monthly, "weeks": weeks,
        "period_label": period_label(period, first, after),
        "hubs": [codes[s["id"]] for s in sites],
        "made": (now_utc + WIB).strftime("%d %b %Y %H:%M WIB"),
        "skus": [], "reconciliation": [], "deliveries": [], "returns": [],
        "count_approved": None,
        "file_name": f"{_safe(brand['name'])} Sales {period_tag(period, first)}.xlsx",
    }
    if not sites:
        return data
    site_ids = [s["id"] for s in sites]
    stock_end = await _stock_at(brand_id, site_ids, min(end_utc, now_utc))
    lines, _ = await _sales(brand_id, site_ids, start_utc, end_utc, end_day)
    skus = await _skus(brand_id)
    prices = await _menu_prices(brand_id, site_ids, list(skus), end_day)
    slotted = {(r["site_id"], r["sku_id"]) for r in await db.fetch_all(
        "SELECT sa.site_id, sa.sku_id FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
        f"WHERE s.brand_id = %s AND sa.site_id IN ({_in(site_ids)})", [brand_id] + site_ids)}
    order = sorted(skus.items(), key=lambda kv: kv[1]["brand_sku_code"] or "")
    for s in sites:
        for sku_id, sku in order:
            key = (s["id"], sku_id)
            sold = lines.get(key)
            held = stock_end.get(key, 0)
            if not sold and not held and key not in slotted:
                continue
            if not sku["active"] and not sold and not held:
                continue
            data["skus"].append({
                "hub": codes[s["id"]], "sku_code": sku["brand_sku_code"], "barcode": sku.get("barcode"),
                "product": sku["name_display"], "size": sku["unit_size"],
                "menu_price": prices.get(key, prices.get((None, sku_id), sku["price_idr"])),
                "units_sold": sold["units"] if sold else 0,
                "sales_value": round(sold["value"]) if sold else 0,
                "stock_end": held, "oos_cancels": sold["oos"] if sold else 0,
                "sku_id": sku_id, "site_id": s["id"],
            })
    if monthly:
        opening = await _stock_at(brand_id, site_ids, start_utc)
        flows = await _flows(brand_id, site_ids, start_utc, end_utc)
        counted, approved = await _counted(brand_id, site_ids, end_day)
        for row in data["skus"]:
            key = (row["site_id"], row["sku_id"])
            f = flows.get(key, {})
            data["reconciliation"].append({
                "hub": row["hub"], "sku_code": row["sku_code"],
                "product": " ".join(x for x in (row["product"], row["size"]) if x and x not in (row["product"] or "")),
                "opening": opening.get(key, 0), "received": f.get("received", 0),
                "sold": row["units_sold"], "returned": f.get("returned", 0),
                "written_off": f.get("written_off", 0), "counted": counted.get(key),
            })
        ok = [approved.get(sid) for sid in site_ids]
        if ok and all(ok):
            d = (max(ok) + WIB).date()
            data["count_approved"] = f"{d.day} {MON[d.month - 1]} {d.year}"
        rule = await rule_values()
        data["deliveries"] = await _deliveries(brand_id, site_ids, start_utc, end_utc, codes)
        data["returns"] = await _returns_list(brand_id, site_ids, start_utc, end_utc, codes,
                                              rule.get("stock_old_days", 90))
    for row in data["skus"]:
        row.pop("sku_id", None)
        row.pop("site_id", None)
    return data


@router.get("/brand-sales/period")
async def brand_sales_period(
    brand_id: int,
    period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
    start: str | None = None,
    hub_ids: str | None = Query(default=None, description="Comma-separated hub ids; empty = Semua hub"),
    user: auth.User = Depends(auth.require("hq")),
):
    """What a download covers, so the page can say it before the file is made.
    For a month: whether the month-end count is approved (the file waits for it)."""
    brand = await _brand(brand_id)
    first, after = period_bounds(period, _parse_start(start))
    hubs = await _brand_hubs(brand_id, await _live_hubs(user, _ids(hub_ids)), to_utc(first))
    full = await opname.full_count_status([h["id"] for h in hubs], first) if period == "monthly" else None
    return {
        "brand_id": brand_id, "brand_name": brand["name"], "period": period,
        "start": first.isoformat(), "end": (after - timedelta(days=1)).isoformat(),
        "label": period_label(period, first, after), "label_id": period_label_id(period, first, after),
        "hubs": [hub_short(h["code"]) for h in hubs], "hub_ids": [h["id"] for h in hubs],
        "is_current": to_utc(after) > utcnow(),
        "month_end_count": full,
        "file_name": f"{_safe(brand['name'])} Sales {period_tag(period, first)}.xlsx",
        "sheets": ["Sales by SKU"] + (["Stock and deliveries"] if period == "monthly" else []),
    }


@router.get("/brand-sales/preview")
async def brand_sales_preview(
    brand_id: int, period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
    start: str | None = None, hub_ids: str | None = None, limit: int = Query(default=200, ge=1, le=2000),
    user: auth.User = Depends(auth.require("hq")),
):
    """Pratinjau: the Sales by SKU rows as the file will hold them."""
    data = await gather(brand_id, period, _parse_start(start), await _live_hubs(user, _ids(hub_ids)))
    rows = xl.sales_rows(data)
    return {"file_name": data["file_name"], "hubs": data["hubs"], "period_label": data["period_label"],
            "rows": rows[:limit], "total_rows": len(rows), "totals": xl.sales_totals(rows),
            "reconciliation": data["reconciliation"][:limit] if period == "monthly" else None}


@router.get("/brand-sales.xlsx", response_class=Response,
            responses={200: {"content": {xl.CONTENT_TYPE: {}}, "description": "Brand sales, board 10b/10c"}})
async def brand_sales_xlsx(
    brand_id: int, period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
    start: str | None = Query(default=None, description="Any day in the period, YYYY-MM-DD (WIB)"),
    hub_ids: str | None = None, user: auth.User = Depends(auth.require("hq")),
):
    """The weekly (Sales by SKU) or monthly (plus Stock and deliveries) Excel."""
    data = await gather(brand_id, period, _parse_start(start), await _live_hubs(user, _ids(hub_ids)))
    body = xl.build(data)
    await db.execute("INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
                     "VALUES (%s,'report.brand_sales','brands',%s,%s)",
                     (user.email, brand_id, data["file_name"]))
    return Response(content=body, media_type=xl.CONTENT_TYPE,
                    headers={"Content-Disposition": f'attachment; filename="{data["file_name"]}"'})


# --- end of day (10a) ---------------------------------------------------------------------

class EodNoteIn(BaseModel):
    site_id: int
    day: str | None = None
    note: str


async def end_of_day_data(site: dict, day: date) -> dict:
    sid = site["id"]
    start_utc, end_utc = to_utc(day), to_utc(day + timedelta(days=1))
    now = utcnow()
    rule = await rule_values()
    target = rule.get("grab_ready_minutes", 10)
    wait_min = rule.get("handover_wait_minutes", 20)
    o_cols = await _columns("orders")
    reason_col = "o.cancel_reason_code" if "cancel_reason_code" in o_cols else "NULL"
    test_sql = ("(o.is_test = 1" + (" OR COALESCE(o.source,'') = 'uji'" if "source" in o_cols else "")
                + (" OR " + _demo_left_out("o") if "is_demo" in o_cols else "") + ")")
    by_col = "o.hiryu_cancelled_by" if "hiryu_cancelled_by" in o_cols else "NULL"
    orders = await db.fetch_all(
        "SELECT o.id, o.status, o.hiryu_short_no, o.external_ref, " + test_sql + " AS is_test, "
        "       " + reason_col + " AS reason_code, " + by_col + " AS cancelled_by, "
        "       COALESCE(o.placed_at, o.created_at) AS placed, "
        "       o.marked_ready_at, o.handed_over_at, pt.started_at, pt.completed_at, pt.handed_to_pack_at, "
        "       (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.status = 'short') AS shorts "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id "
        "WHERE o.site_id = %s AND o.created_at >= %s AND o.created_at < %s "
        "  AND COALESCE(o.placed_at, o.created_at) >= %s AND COALESCE(o.placed_at, o.created_at) < %s",
        (sid, start_utc - timedelta(days=1), end_utc + timedelta(days=1), start_utc, end_utc))
    packs = {}
    if await table_exists("order_packs") and orders:
        ids = [o["id"] for o in orders]
        for p in await db.fetch_all(f"SELECT order_id, pack_started_at, packed_at FROM order_packs "
                                    f"WHERE order_id IN ({_in(ids)})", ids):
            packs[p["order_id"]] = p
    real = [o for o in orders if not o["is_test"]]
    cancelled = [o for o in real if o["status"] == "cancelled"]
    oos = [o for o in cancelled if o["shorts"] or str(o["reason_code"]) == "2001"]
    by_whom = {}
    for o in cancelled:
        if o not in oos:
            k = o["cancelled_by"] or "other"
            by_whom[k] = by_whom.get(k, 0) + 1
    states = {
        "handed_over": sum(1 for o in real if o["status"] != "cancelled" and o["handed_over_at"]),
        "ready": sum(1 for o in real if o["status"] != "cancelled" and o["marked_ready_at"]
                     and not o["handed_over_at"]),
        "in_progress": sum(1 for o in real if o["status"] != "cancelled" and not o["marked_ready_at"]),
        "cancelled_customer": len(cancelled) - len(oos), "cancelled_missing": len(oos),
        "test": len(orders) - len(real),
        "cancelled_by": by_whom,   # customer | grab | merchant | other (Hiryu's hiryu_cancelled_by)
    }
    ready10 = sum(1 for o in real if o["marked_ready_at"] and o["placed"]
                  and (o["marked_ready_at"] - o["placed"]).total_seconds() <= target * 60)
    picks = [(o["completed_at"] - o["started_at"]).total_seconds() for o in real
             if o["started_at"] and o["completed_at"]]
    packt = []
    for o in real:
        p = packs.get(o["id"])
        a = (p and p["pack_started_at"]) or o["handed_to_pack_at"] or o["completed_at"]
        b = (p and p["packed_at"]) or o["marked_ready_at"]
        if a and b and b >= a:
            packt.append((b - a).total_seconds())
    lines, _ = await _sales(None, [sid], start_utc, end_utc, day)
    sku_rows = []
    if lines:
        ids = sorted({k[1] for k in lines})
        info = {r["id"]: r for r in await db.fetch_all(
            "SELECT s.id, s.brand_sku_code, s.name_display, b.name AS brand_name FROM skus s "
            f"JOIN brands b ON b.id = s.brand_id WHERE s.id IN ({_in(ids)})", ids)}
        for (site_id, sku_id), v in lines.items():
            if not v["units"]:
                continue
            i = info.get(sku_id, {})
            sku_rows.append({"sku_id": sku_id, "sku_code": i.get("brand_sku_code"), "brand": i.get("brand_name"),
                             "product": i.get("name_display"), "units": v["units"], "value": round(v["value"])})
        sku_rows.sort(key=lambda r: (-r["units"], r["product"] or ""))

    problems = []
    for o in oos:
        sf = await db.fetch_one(
            "SELECT ps.qty_required, ps.qty_found, s.name_display FROM pick_shortfalls ps "
            "JOIN pick_tasks pt ON pt.site_id = ps.site_id JOIN pick_lines pl ON pl.id = ps.pick_line_id "
            "AND pl.pick_task_id = pt.id JOIN skus s ON s.id = ps.sku_id WHERE pt.order_id = %s LIMIT 1",
            (o["id"],))
        gm = o["hiryu_short_no"] or o["external_ref"]
        problems.append({"kind": "cancel_missing", "ref": gm,
                         "title_id": f"Batal, barang tidak ada: {gm}",
                         "detail_id": (f"{sf['name_display']} · ketemu {sf['qty_found']} dari {sf['qty_required']}"
                                       if sf else None)})
    q = await db.fetch_all(
        "SELECT tray_code, reason, SUM(qty) AS n FROM quarantine_items WHERE site_id = %s "
        "AND reported_at >= %s AND reported_at < %s GROUP BY tray_code, reason", (sid, start_utc, end_utc))
    if q:
        from routers.quarantine import REASONS as QR
        total = sum(int(r["n"]) for r in q)
        trays = sorted({r["tray_code"] for r in q if r["tray_code"]})
        parts = ", ".join(f"{int(r['n'])} {QR.get(r['reason'], (r['reason'],))[0].lower()}" for r in q)
        problems.append({"kind": "quarantine", "ref": None, "title_id": f"Karantina: {total} unit",
                         "detail_id": " · ".join(x for x in (", ".join(trays), parts) if x)})
    for o in real:
        if o["status"] == "cancelled" or not o["marked_ready_at"]:
            continue
        waited = ((o["handed_over_at"] or min(now, end_utc)) - o["marked_ready_at"]).total_seconds() / 60
        if waited > wait_min:
            gm = o["hiryu_short_no"] or o["external_ref"]
            problems.append({"kind": "late_parcel", "ref": gm, "title_id": f"Paket lewat waktu: {gm}",
                             "detail_id": f"Menunggu driver {int(waited)} menit"})
    note = await db.fetch_one("SELECT * FROM eod_notes WHERE site_id = %s AND day = %s", (sid, day))

    def mmss(xs):
        if not xs:
            return None
        s = int(sum(xs) / len(xs))
        return f"{s // 60:02d}:{s % 60:02d}"

    upto = min(now, end_utc) + WIB
    return {
        "site_id": sid, "site_code": hub_short(site["code"]), "day": str(day),
        "day_label": opname.id_date(day), "counted_until": upto.strftime("%H:%M"),
        "orders": len(real), "states": states, "units_sold": sum(r["units"] for r in sku_rows),
        "ready_10": ready10, "ready_target_minutes": target,
        "avg_pick": mmss(picks), "avg_pack": mmss(packt),
        "problems": problems, "sales": sku_rows,
        "note": ({"text": note["note"], "by": note["written_by"], "by_name": note["written_by_name"],
                  "at": iso(note["written_at"])} if note else None),
    }


@router.get("/end-of-day")
async def end_of_day(site_id: int, day: str | None = None, user: auth.User = Depends(auth.current_user)):
    """Akhir hari: Pesanan hari ini, Masalah hari ini, Penjualan, and the note."""
    site = await auth.assert_site_access(user, site_id)
    return await end_of_day_data(site, _parse_start(day))


@router.put("/end-of-day/note")
async def save_eod_note(body: EodNoteIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Simpan catatan: the note for tomorrow, with name and time."""
    await auth.assert_site_access(user, body.site_id)
    day = _parse_start(body.day)
    name = (await names_for([user.email])).get(user.email)
    await db.execute(
        "INSERT INTO eod_notes (site_id, day, note, written_by, written_by_name) VALUES (%s,%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE note = VALUES(note), written_by = VALUES(written_by), "
        "written_by_name = VALUES(written_by_name), written_at = UTC_TIMESTAMP()",
        (body.site_id, day, body.note.strip(), user.email, name))
    return {"ok": True}


@router.get("/end-of-day.csv", response_class=Response)
async def end_of_day_csv(site_id: int, day: str | None = None, user: auth.User = Depends(auth.current_user)):
    site = await auth.assert_site_access(user, site_id)
    d = await end_of_day_data(site, _parse_start(day))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Dark store", d["site_code"], "Tanggal", d["day"]])
    w.writerow([])
    w.writerow(["Status", "Jumlah"])
    for k, label in (("handed_over", "Diserahkan ke driver"), ("ready", "Siap, menunggu driver"),
                     ("in_progress", "Masih dikerjakan"), ("cancelled_customer", "Batal: pelanggan atau Grab"),
                     ("cancelled_missing", "Batal: barang tidak ada"), ("test", "Pesanan tes")):
        w.writerow([label, d["states"][k]])
    w.writerow(["Unit terjual", d["units_sold"]])
    w.writerow([f"Siap dalam {d['ready_target_minutes']} menit", f"{d['ready_10']} dari {d['orders']}"])
    w.writerow(["Rata-rata ambil", d["avg_pick"] or ""])
    w.writerow(["Rata-rata kemas", d["avg_pack"] or ""])
    w.writerow([])
    w.writerow(["Masalah", "Keterangan"])
    for p in d["problems"]:
        w.writerow([p["title_id"], p["detail_id"] or ""])
    w.writerow([])
    w.writerow(["Kode SKU", "Merek", "Produk", "Unit", "Nilai (Rp)"])
    for r in d["sales"]:
        w.writerow([r["sku_code"], r["brand"], r["product"], r["units"], r["value"]])
    if d["note"]:
        w.writerow([])
        w.writerow(["Catatan untuk besok", d["note"]["text"], d["note"]["by_name"] or d["note"]["by"]])
    name = f"Akhir hari {d['site_code']} {d['day']}.csv"
    return Response(content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# --- operational report (10d) ---------------------------------------------------------------

async def _kpis(site_ids: list[int], first: date, after: date) -> dict:
    start_utc, end_utc = to_utc(first), to_utc(after)
    rule = await rule_values()
    target = rule.get("grab_ready_minutes", 10)
    out = {"orders": 0, "units": 0, "ready_10": 0, "ready_share": None, "avg_pick_s": None,
           "avg_pack_s": None, "oos_cancels": 0, "oos_share": None, "bins_counted": 0, "bins_matched": 0,
           "accuracy": None, "deliveries": 0, "deliveries_on_time": 0, "sales_value": 0}
    if not site_ids:
        return out
    o_cols = await _columns("orders")
    reason_col = "o.cancel_reason_code" if "cancel_reason_code" in o_cols else "NULL"
    pack_join = ("LEFT JOIN order_packs op ON op.order_id = o.id " if await table_exists("order_packs") else "")
    pack_cols = ("op.pack_started_at, op.packed_at" if pack_join else "NULL AS pack_started_at, NULL AS packed_at")
    rows = await db.fetch_all(
        "SELECT o.id, o.status, " + reason_col + " AS reason_code, COALESCE(o.placed_at, o.created_at) AS placed, "
        "       o.marked_ready_at, pt.started_at, pt.completed_at, pt.handed_to_pack_at, " + pack_cols + ", "
        "       (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.status = 'short') AS shorts "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id " + pack_join +
        f"WHERE o.site_id IN ({_in(site_ids)}) " + await _test_filter() +
        "  AND o.created_at >= %s AND o.created_at < %s "
        "  AND COALESCE(o.placed_at, o.created_at) >= %s AND COALESCE(o.placed_at, o.created_at) < %s",
        site_ids + [start_utc - timedelta(days=1), end_utc + timedelta(days=1), start_utc, end_utc])
    out["orders"] = len(rows)
    out["ready_10"] = sum(1 for o in rows if o["marked_ready_at"] and o["placed"]
                          and (o["marked_ready_at"] - o["placed"]).total_seconds() <= target * 60)
    out["ready_share"] = out["ready_10"] / len(rows) if rows else None
    picks = [(o["completed_at"] - o["started_at"]).total_seconds() for o in rows
             if o["started_at"] and o["completed_at"]]
    packs = []
    for o in rows:
        a = o["pack_started_at"] or o["handed_to_pack_at"] or o["completed_at"]
        b = o["packed_at"] or o["marked_ready_at"]
        if a and b and b >= a:
            packs.append((b - a).total_seconds())
    out["avg_pick_s"] = int(sum(picks) / len(picks)) if picks else None
    out["avg_pack_s"] = int(sum(packs) / len(packs)) if packs else None
    out["oos_cancels"] = sum(1 for o in rows if o["status"] == "cancelled"
                             and (o["shorts"] or str(o["reason_code"]) == "2001"))
    out["oos_share"] = out["oos_cancels"] / len(rows) if rows else None
    lines, _ = await _sales(None, site_ids, start_utc, end_utc, after - timedelta(days=1))
    out["units"] = sum(v["units"] for v in lines.values())
    out["sales_value"] = round(sum(v["value"] for v in lines.values()))
    acc = await db.fetch_one(
        "SELECT COUNT(*) AS n, SUM(first_match = 1) AS ok FROM count_tasks "
        f"WHERE site_id IN ({_in(site_ids)}) AND status = 'closed' AND first_match IS NOT NULL "
        "AND closed_at >= %s AND closed_at < %s", site_ids + [start_utc, end_utc])
    out["bins_counted"], out["bins_matched"] = int(acc["n"] or 0), int(acc["ok"] or 0)
    out["accuracy"] = out["bins_matched"] / out["bins_counted"] if out["bins_counted"] else None
    cols = await _columns("replenishments")
    due = "COALESCE(po_requested_date, eta_date)" if "po_requested_date" in cols else "eta_date"
    dl = await db.fetch_all(
        f"SELECT received_at, {due} AS due FROM replenishments WHERE site_id IN ({_in(site_ids)}) "
        "AND received_at >= %s AND received_at < %s", site_ids + [start_utc, end_utc])
    out["deliveries"] = len(dl)
    out["deliveries_on_time"] = sum(1 for d in dl if not d["due"] or (d["received_at"] + WIB).date() <= d["due"])
    return out


async def _cover(site_ids: list[int], first: date, after: date, codes: dict) -> list[dict]:
    """Weeks of stock left per brand and hub: stock on the shelf at the end of the
    period / average sold per week in it."""
    if not site_ids:
        return []
    weeks = max((after - first).days / 7, 1e-9)
    start_utc, end_utc = to_utc(first), to_utc(after)
    stock = await _stock_at(None, site_ids, min(end_utc, utcnow()))
    lines, _ = await _sales(None, site_ids, start_utc, end_utc, after - timedelta(days=1))
    brand_of = {r["id"]: (r["brand_id"], r["brand"]) for r in await db.fetch_all(
        "SELECT s.id, s.brand_id, b.name AS brand FROM skus s JOIN brands b ON b.id = s.brand_id")}
    agg: dict = {}
    for (sid, sku), q in stock.items():
        b = brand_of.get(sku)
        if b:
            agg.setdefault((b, sid), [0, 0])[0] += q
    for (sid, sku), v in lines.items():
        b = brand_of.get(sku)
        if b:
            agg.setdefault((b, sid), [0, 0])[1] += v["units"]
    out = []
    for ((bid, bname), sid), (held, sold) in sorted(agg.items(), key=lambda kv: (kv[0][0][1], codes.get(kv[0][1]))):
        per_week = sold / weeks
        out.append({"brand_id": bid, "brand": bname, "hub": codes.get(sid), "site_id": sid, "stock": held,
                    "sold": sold, "weeks_cover": round(held / per_week, 1) if per_week else None})
    return out


async def operational_data(user: auth.User, period: str, start: date, hub_ids: list[int]) -> dict:
    hubs = await _live_hubs(user, hub_ids)
    ids = [h["id"] for h in hubs]
    codes = {h["id"]: hub_short(h["code"]) for h in hubs}
    first, after = period_bounds(period, start)
    pfirst, pafter = period_bounds(period, previous_start(period, first))
    cur_k = await _kpis(ids, first, after)
    prev_k = await _kpis(ids, pfirst, pafter)
    cov_now = await _cover(ids, first, after, codes)
    cov_prev = {(c["brand_id"], c["site_id"]): c["weeks_cover"] for c in await _cover(ids, pfirst, pafter, codes)}
    for c in cov_now:
        c["weeks_cover_prev"] = cov_prev.get((c["brand_id"], c["site_id"]))
    return {
        "period": period, "start": str(first), "end": str(after - timedelta(days=1)),
        "label": period_label(period, first, after), "label_id": period_label_id(period, first, after),
        "previous_label": period_label(period, pfirst, pafter),
        "previous_label_id": period_label_id(period, pfirst, pafter),
        "hubs": [codes[i] for i in ids], "hub_ids": ids,
        "current": cur_k, "previous": prev_k, "cover": cov_now,
        "file_name": f"Operational report {period_tag(period, first)}"
                     f"{'' if not hub_ids else ' ' + '-'.join(codes[i] for i in ids)}.xlsx",
        "made": (utcnow() + WIB).strftime("%d %b %Y %H:%M WIB"),
    }


@router.get("/operational")
async def operational(period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
                      start: str | None = None, hub_ids: str | None = None,
                      user: auth.User = Depends(auth.require("hq"))):
    """Laporan operasional for Grab and management: each figure next to the
    period before."""
    return await operational_data(user, period, _parse_start(start), _ids(hub_ids))


@router.get("/operational.xlsx", response_class=Response)
async def operational_xlsx(period: str = Query(default="weekly", pattern="^(weekly|monthly)$"),
                           start: str | None = None, hub_ids: str | None = None,
                           user: auth.User = Depends(auth.require("hq"))):
    data = await operational_data(user, period, _parse_start(start), _ids(hub_ids))
    body = xl.build_operational(data)
    await db.execute("INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
                     "VALUES (%s,'report.operational','reports',NULL,%s)", (user.email, data["file_name"]))
    return Response(content=body, media_type=xl.CONTENT_TYPE,
                    headers={"Content-Disposition": f'attachment; filename="{data["file_name"]}"'})


# --- monthly variance and claims (10e) ------------------------------------------------------

CATEGORIES = (
    ("inbound_short", "Inbound short", "Inbound differences"),
    ("inbound_extra", "Inbound extra", "Inbound differences"),
    ("rejected_back", "Rejected at inbound, sent back", "Inbound differences"),
    ("count_short", "Count differences (short)", "Count differences"),
    ("count_extra", "Count differences (extra)", "Count differences"),
    ("damaged_hub", "Damaged in the dark store", "Damage and write-off"),
    ("rejected_written_off", "Rejected at inbound, written off", "Damage and write-off"),
    ("returned", "Returned to brand", "Returns to brand"),
)


class FinaliseIn(BaseModel):
    month: str


async def variance_data(user: auth.User, month: str | None, hub_ids: list[int]) -> dict:
    """Only finalised differences: inbound differences approved by Ops HQ, count
    differences approved by the SPV then reviewed by Ops HQ, write-offs approved
    by Ops HQ, returns signed by the brand's driver. Cost bearers Brand and
    Ninja only."""
    first, after = period_bounds("monthly", _parse_start(month))
    s_utc, e_utc = to_utc(first), to_utc(after)
    hubs = await _live_hubs(user, hub_ids)
    ids = [h["id"] for h in hubs]
    codes = {h["id"]: hub_short(h["code"]) for h in hubs}
    rows: list[dict] = []
    if ids:
        ph = _in(ids)
        # Inbound differences (agent I's inbound_differences, approved). Damaged
        # units and refused extras reach quarantine and are counted from there;
        # damaged units sent straight back with the driver are counted here.
        if await table_exists("inbound_differences"):
            for r in await db.fetch_all(
                    "SELECT d.site_id, d.sku_id, d.kind, d.place, d.decision, d.qty, d.decided_at AS at, "
                    "       d.decided_by, rp.reference FROM inbound_differences d "
                    "LEFT JOIN replenishments rp ON rp.id = d.replenishment_id "
                    f"WHERE d.site_id IN ({ph}) AND d.status = 'approved' AND d.decided_at >= %s "
                    "AND d.decided_at < %s", ids + [s_utc, e_utc]):
                if r["kind"] == "short":
                    cat = "inbound_short"
                elif r["kind"] == "extra" and r["decision"] != "reject":
                    cat = "inbound_extra"
                elif r["kind"] == "damaged" and r["place"] == "driver":
                    cat = "rejected_back"
                else:
                    continue
                rows.append({"cat": cat, "site_id": r["site_id"], "sku_id": r["sku_id"], "units": abs(int(r["qty"])),
                             "bearer": "Brand", "at": r["at"], "ref": r["reference"],
                             "note": {"inbound_short": "Short against the PO",
                                      "inbound_extra": "Extra accepted, billed",
                                      "rejected_back": "Damaged at inbound, back with the driver"}[cat],
                             "approved_by": r["decided_by"], "reviewed_by": r["decided_by"]})
        # Count differences, approved by the SPV and reviewed by Ops HQ.
        for r in await db.fetch_all(
                "SELECT t.site_id, t.sku_id, t.variance, t.approved_by, t.hq_reviewed_by, t.hq_reviewed_at AS at, "
                "       l.code AS loc FROM count_tasks t JOIN locations l ON l.id = t.location_id "
                f"WHERE t.site_id IN ({ph}) AND t.outcome = 'approved' AND t.variance <> 0 "
                "AND t.hq_review = 'reviewed' AND t.approved_at >= %s AND t.approved_at < %s", ids + [s_utc, e_utc]):
            v = int(r["variance"])
            rows.append({"cat": "count_short" if v < 0 else "count_extra", "site_id": r["site_id"],
                         "sku_id": r["sku_id"], "units": abs(v), "bearer": "Ninja", "at": r["at"],
                         "ref": opname.bin_label(r["loc"]), "note": f"Counted {'short' if v < 0 else 'extra'} by {abs(v)}",
                         "approved_by": r["approved_by"], "reviewed_by": r["hq_reviewed_by"]})
        # Write-offs approved by Ops HQ.
        for r in await db.fetch_all(
                "SELECT q.* FROM quarantine_items q "
                f"WHERE q.site_id IN ({ph}) AND q.status = 'written_off' AND q.hq_at >= %s AND q.hq_at < %s",
                ids + [s_utc, e_utc]):
            cat = "rejected_written_off" if r["origin"] in ("inbound", "inbound_rejected") else "damaged_hub"
            note = REASON_EN.get(r["reason"], "Other") + (
                ", Ops HQ claims it from Grab outside the WMS" if r["origin"] == "driver_return" else "")
            rows.append({"cat": cat, "site_id": r["site_id"], "sku_id": r["sku_id"], "units": int(r["qty"]),
                         "bearer": "Ninja" if r["cost_bearer"] == "ninja" else "Brand", "at": r["hq_at"],
                         "ref": r["order_ref"] or r["tray_code"], "note": note,
                         "approved_by": r["decided_by"], "reviewed_by": r["hq_by"]})
        # Returns signed by the brand's driver.
        for r in await db.fetch_all(
                "SELECT rn.site_id, rn.reference, rn.handed_over_at AS at, rn.created_by, rn.handed_over_by, "
                "       ln.sku_id, ln.origin, ln.qty, q.origin AS q_origin, q.cost_bearer, q.reason "
                "FROM return_note_lines ln JOIN return_notes rn ON rn.id = ln.note_id "
                "LEFT JOIN quarantine_items q ON q.id = ln.quarantine_item_id "
                f"WHERE rn.site_id IN ({ph}) AND rn.status = 'handed_over' AND rn.handed_over_at >= %s "
                "AND rn.handed_over_at < %s", ids + [s_utc, e_utc]):
            if ln_origin_is_inbound(r):
                cat, bearer = "rejected_back", "Brand"
            elif r["origin"] == "quarantine" and r["cost_bearer"] == "ninja":
                cat, bearer = "damaged_hub", "Ninja"
            else:
                cat, bearer = "returned", "Brand"
            note = ("Old stock, sent back" if r["origin"] == "old_stock"
                    else f"{REASON_EN.get(r['reason'], 'Other')}, sent back")
            rows.append({"cat": cat, "site_id": r["site_id"], "sku_id": r["sku_id"], "units": int(r["qty"]),
                         "bearer": bearer, "at": r["at"], "ref": r["reference"], "note": note,
                         "approved_by": r["created_by"], "reviewed_by": r["handed_over_by"]})
    # Product, brand and menu price for every row.
    sku_ids = sorted({r["sku_id"] for r in rows if r["sku_id"]})
    info = {}
    if sku_ids:
        info = {r["id"]: r for r in await db.fetch_all(
            "SELECT s.id, s.brand_id, s.brand_sku_code, s.name_display, s.price_idr, b.name AS brand "
            f"FROM skus s JOIN brands b ON b.id = s.brand_id WHERE s.id IN ({_in(sku_ids)})", sku_ids)}
    prices: dict = {}
    for bid in sorted({i["brand_id"] for i in info.values()}):
        prices.update(await _menu_prices(bid, ids, [k for k, v in info.items() if v["brand_id"] == bid],
                                          after - timedelta(days=1)))
    names = await names_for([r["approved_by"] for r in rows] + [r["reviewed_by"] for r in rows])
    for r in rows:
        i = info.get(r["sku_id"], {})
        price = prices.get((r["site_id"], r["sku_id"]), prices.get((None, r["sku_id"]), i.get("price_idr")))
        d = (r["at"] + WIB).date() if r["at"] else None
        r.update({"hub": codes.get(r["site_id"]), "brand": i.get("brand"), "brand_id": i.get("brand_id"),
                  "sku_code": i.get("brand_sku_code"), "product": i.get("name_display"),
                  "price": int(price) if price is not None else None,
                  "value": r["units"] * int(price) if price is not None else None,
                  "date": f"{d.day} {MON[d.month - 1]} {d.year}" if d else None,
                  "approved_name": names.get(r["approved_by"], r["approved_by"]),
                  "reviewed_name": names.get(r["reviewed_by"], r["reviewed_by"]), "status": "Final"})
    rows.sort(key=lambda r: (r["at"] or datetime.min))
    pairs = sorted({(r["hub"], r["brand"]) for r in rows if r["brand"]},
                   key=lambda p: ([codes[i] for i in ids].index(p[0]) if p[0] in codes.values() else 99, p[1]))
    if not pairs:
        brands = await db.fetch_all(
            "SELECT DISTINCT b.name FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
            f"JOIN brands b ON b.id = s.brand_id WHERE sa.site_id IN ({_in(ids) if ids else 'NULL'}) ORDER BY b.name",
            ids) if ids else []
        pairs = [(codes[i], b["name"]) for i in ids for b in brands]
    fin = await db.fetch_one("SELECT * FROM report_finalisations WHERE report_key = 'variance' AND period = %s",
                             (f"{first:%Y-%m}",))
    full = await opname.full_count_status(ids, first)
    fin = fin if fin and fin["finalised_at"] else None
    fd = (fin["finalised_at"] + WIB).date() if fin else None
    ad = None
    if full.get("approved_at"):
        ad = datetime.fromisoformat(full["approved_at"].rstrip("Z")) + WIB
    for r in rows:
        r.pop("at", None)
    return {
        "month": f"{first:%Y-%m}", "label": f"{MONTHS[first.month - 1]} {first.year}",
        "hubs": [codes[i] for i in ids], "hub_ids": ids,
        "brands": sorted({p[1] for p in pairs}),
        "pairs": [{"hub": h, "brand": b} for h, b in pairs],
        "categories": [{"key": k, "name": n, "sheet": s} for k, n, s in CATEGORIES],
        "rows": rows,
        "finalised": ({"by": fin["finalised_by"], "by_name": fin["finalised_by_name"],
                       "at": iso(fin["finalised_at"]),
                       "label": f"{fd.day} {MON[fd.month - 1]} {fd.year}"} if fin else None),
        "count_approved_label": f"{ad.day} {MON[ad.month - 1]} {ad.year}" if ad else None,
        "file_name": f"Variance and claims report {first:%Y-%m}.xlsx",
        "made": (utcnow() + WIB).strftime("%d %b %Y %H:%M WIB"),
    }


def ln_origin_is_inbound(r: dict) -> bool:
    return r["origin"] == "rejected" or r.get("q_origin") in ("inbound", "inbound_rejected")


@router.get("/variance")
async def variance(month: str | None = None, hub_ids: str | None = None,
                   user: auth.User = Depends(auth.require("hq"))):
    """Laporan selisih bulanan: the rows and the summary, as JSON for the page."""
    data = await variance_data(user, month, _ids(hub_ids))
    data["summary"] = xl.variance_summary(data)
    return data


@router.post("/variance/finalise")
async def finalise_variance(body: FinaliseIn, user: auth.User = Depends(auth.require("hq"))):
    """Finalised by Ops HQ: stamps the month's file with the name and date."""
    first, _ = period_bounds("monthly", _parse_start(body.month))
    name = (await names_for([user.email])).get(user.email)
    await db.execute(
        "INSERT INTO report_finalisations (report_key, period, finalised_by, finalised_by_name) "
        "VALUES ('variance', %s, %s, %s) ON DUPLICATE KEY UPDATE finalised_by = VALUES(finalised_by), "
        "finalised_by_name = VALUES(finalised_by_name), finalised_at = UTC_TIMESTAMP()",
        (f"{first:%Y-%m}", user.email, name))
    return {"ok": True}


@router.get("/variance.xlsx", response_class=Response)
async def variance_xlsx(month: str | None = None, hub_ids: str | None = None,
                        user: auth.User = Depends(auth.require("hq"))):
    data = await variance_data(user, month, _ids(hub_ids))
    body = xl.build_variance(data)
    await db.execute("INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
                     "VALUES (%s,'report.variance','reports',NULL,%s)", (user.email, data["file_name"]))
    return Response(content=body, media_type=xl.CONTENT_TYPE,
                    headers={"Content-Disposition": f'attachment; filename="{data["file_name"]}"'})
