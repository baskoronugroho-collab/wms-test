"""The report files (canvas Section 10), drawn from data the caller gathered.

* ``build``              brand sales: weekly = one sheet *Sales by SKU* (10b);
                         monthly adds *Stock and deliveries* (10c).
* ``build_operational``  the weekly or monthly operational report for Grab and
                         management (10d).
* ``build_variance``     the monthly variance and claims report: *Summary* plus
                         one sheet per type of difference (10e).

English only: the files go to brands, Grab and management. No expiry dates in
any file. Gathering lives in routers/reports.py, so the layout can be checked
without a database (run this module's builders on made-up data).
"""
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

F = "Arial"
INK, MUTED, RED = "1B1D1C", "6B706D", "C0202D"
HEAD_FILL = PatternFill("solid", fgColor="1B1D1C")
TOTAL_FILL = PatternFill("solid", fgColor="F2F4F1")
GROUP_FILL = PatternFill("solid", fgColor="E6E9EE")
thin = Side(style="thin", color="C6CBC5")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
RP = '#,##0;-#,##0;"-"'
QTY = '#,##0;-#,##0;"0"'
DEC = "0.0"

CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _font(**kw):
    return Font(name=F, color=kw.pop("color", INK), **kw)


def _title(ws, r, text, size=14):
    ws.cell(r, 1, text).font = _font(bold=True, size=size)


def _line(ws, r, text):
    ws.cell(r, 1, text).font = _font(size=9, color=MUTED)


def _header_row(ws, r, headers, widths=None):
    for i, h in enumerate(headers, 1):
        c = ws.cell(r, i, h)
        c.font = _font(bold=True, size=9, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
        c.border = BOX
    ws.row_dimensions[r].height = 30
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def _cell(ws, r, c, v, fmt=None, bold=False, fill=None, color=INK, align=None):
    x = ws.cell(r, c, v)
    x.font = _font(size=10, bold=bold, color=color)
    x.border = BOX
    if fmt:
        x.number_format = fmt
    if fill:
        x.fill = fill
    if align:
        x.alignment = Alignment(horizontal=align, vertical="center")
    return x


def _join(codes) -> str:
    codes = list(codes or [])
    if not codes:
        return "none"
    return codes[0] if len(codes) == 1 else ", ".join(codes[:-1]) + " and " + codes[-1]


def _finish(wb) -> bytes:
    for sheet in wb.worksheets:
        sheet.sheet_view.showGridLines = False
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------- brand sales

def sales_rows(data: dict) -> list[dict]:
    """The Sales by SKU rows with the derived columns, for the file and the
    on-screen preview alike."""
    weeks = data.get("weeks") or 1
    out = []
    for s in data.get("skus") or []:
        units = s.get("units_sold") or 0
        avg = units / weeks if weeks else 0
        held = s.get("stock_end") or 0
        cover = (held / avg) if avg else None
        notes = []
        if cover is not None and cover < 1:
            notes.append("Low cover")
        n = s.get("oos_cancels") or 0
        if n:
            notes.append(f"{n} missing-item cancel{'s' if n > 1 else ''}")
        out.append({**s, "avg_per_week": round(avg, 1), "weeks_cover": None if cover is None else round(cover, 1),
                    "notes": "; ".join(notes) or None})
    return out


def sales_totals(rows: list[dict]) -> dict:
    return {"units_sold": sum(r.get("units_sold") or 0 for r in rows),
            "sales_value": sum(r.get("sales_value") or 0 for r in rows),
            "stock_end": sum(r.get("stock_end") or 0 for r in rows)}


def build(data: dict) -> bytes:
    """`data` (routers/reports.gather):
      brand_name, monthly, weeks, period_label, hubs [codes], made,
      skus: [{hub, sku_code, barcode, product, size, menu_price, units_sold,
              sales_value, stock_end, oos_cancels}],
      monthly only: reconciliation [{hub, sku_code, product, opening, received,
      sold, returned, written_off, counted}], count_approved (text or None),
      deliveries [{hub, po_number, date, ordered, received, damaged, on_time}],
      returns [{hub, sku_code, reason, date, units, type}].
    A None figure leaves its cell empty rather than guessed."""
    brand = data["brand_name"]
    hubs = _join(data.get("hubs"))
    wb = Workbook()
    ws = wb.active
    ws.title = "Sales by SKU"
    _title(ws, 1, f"Sales by SKU: {brand}, {data['period_label']}")
    _line(ws, 2, f"Hubs {hubs}. WMS numbers. Test and cancelled orders are not counted. "
                 f"Made {data.get('made', '')}.")
    ws.cell(3, 1, "Weeks in period").font = _font(size=9, color=MUTED)
    ws.cell(3, 2, data.get("weeks") or 1).number_format = "0.00"
    weeks_cell = "$B$3"
    head = 5
    _header_row(ws, head, ["Hub", "SKU code", "Barcode", "Product", "Size", "Menu price", "Units sold",
                           "Sales value", "Stock at end", "Avg sold per week", "Weeks of cover", "Notes"],
                [7, 16, 16, 44, 9, 12, 10, 14, 11, 12, 11, 26])
    rows = sales_rows(data)
    r = first = head + 1
    for s in rows:
        _cell(ws, r, 1, s["hub"])
        _cell(ws, r, 2, s.get("sku_code"))
        b = _cell(ws, r, 3, s.get("barcode") or "none yet")
        b.number_format = "@"
        _cell(ws, r, 4, s.get("product"))
        _cell(ws, r, 5, s.get("size"))
        _cell(ws, r, 6, s.get("menu_price"), RP)
        _cell(ws, r, 7, s.get("units_sold") or 0, QTY)
        price, units, value = s.get("menu_price"), s.get("units_sold") or 0, s.get("sales_value")
        # =F*G when that is the figure; the order-line value when prices moved.
        _cell(ws, r, 8, f"=F{r}*G{r}" if value is None or (price is not None and price * units == value)
              else value, RP)
        _cell(ws, r, 9, s.get("stock_end"), QTY)
        _cell(ws, r, 10, f"=G{r}/{weeks_cell}", DEC)
        _cell(ws, r, 11, f'=IF(J{r}=0,"",I{r}/J{r})', DEC)
        _cell(ws, r, 12, s.get("notes"))
        r += 1
    if r == first:
        for c in range(1, 13):
            _cell(ws, r, c, None)
        r += 1
    last = r - 1
    for c in range(1, 13):
        _cell(ws, r, c, None, fill=TOTAL_FILL)
    _cell(ws, r, 1, "Total", bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 7, f"=SUM(G{first}:G{last})", QTY, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 8, f"=SUM(H{first}:H{last})", RP, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 9, f"=SUM(I{first}:I{last})", QTY, bold=True, fill=TOTAL_FILL)
    _line(ws, r + 2, "Weeks of cover = Stock at end / Avg sold per week. Sales value = Grab menu price on "
                     "the day of the order x units, before commission and promotions.")
    ws.freeze_panes = ws.cell(head + 1, 5)
    ws.auto_filter.ref = f"A{head}:L{last}"

    if data.get("monthly"):
        _stock_sheet(wb.create_sheet("Stock and deliveries"), data, brand, hubs)
    return _finish(wb)


def _stock_sheet(st, data, brand, hubs):
    _title(st, 1, f"Stock and deliveries: {brand}, {data['period_label']}")
    approved = data.get("count_approved")
    _line(st, 2, f"Hubs {hubs}. WMS numbers. " +
                 (f"Month-end count approved by the SPV {approved}. " if approved
                  else "Month-end count not approved yet: Counted and Difference may be empty. ") +
                 "Test and cancelled orders are not in Sold.")
    head = 3
    _header_row(st, head, ["Hub", "SKU code", "Product", "Opening", "Received", "Sold", "Returned to brand",
                           "Written off", "Expected", "Counted at month end", "Difference"],
                [7, 16, 44, 10, 10, 10, 12, 10, 10, 13, 11])
    r = head + 1
    rec = data.get("reconciliation") or []
    for hub in list(dict.fromkeys(x["hub"] for x in rec)):
        first = r
        rows = [x for x in rec if x["hub"] == hub]
        for x in rows:
            _cell(st, r, 1, hub)
            _cell(st, r, 2, x.get("sku_code"))
            _cell(st, r, 3, x.get("product"))
            for c, k in ((4, "opening"), (5, "received"), (6, "sold"), (7, "returned"), (8, "written_off")):
                _cell(st, r, c, x.get(k) or 0, QTY)
            _cell(st, r, 9, f"=D{r}+E{r}-F{r}-G{r}-H{r}", QTY)
            _cell(st, r, 10, x.get("counted"), QTY)
            _cell(st, r, 11, f"=J{r}-I{r}" if x.get("counted") is not None else None, QTY, bold=True)
            r += 1
        last = r - 1
        all_counted = all(x.get("counted") is not None for x in rows)
        for c in range(1, 12):
            _cell(st, r, c, None, fill=TOTAL_FILL)
        _cell(st, r, 1, hub, bold=True, fill=TOTAL_FILL)
        _cell(st, r, 2, "Total", bold=True, fill=TOTAL_FILL)
        for c in range(4, 10):
            col = get_column_letter(c)
            _cell(st, r, c, f"=SUM({col}{first}:{col}{last})", QTY, bold=True, fill=TOTAL_FILL)
        if all_counted:
            _cell(st, r, 10, f"=SUM(J{first}:J{last})", QTY, bold=True, fill=TOTAL_FILL)
            _cell(st, r, 11, f"=J{r}-I{r}", QTY, bold=True, fill=TOTAL_FILL)
        r += 1
    r += 1
    st.cell(r, 1, "Deliveries").font = _font(bold=True, size=11)
    r += 1
    _header_row(st, r, ["Hub", "PO number", "Delivered on", "Units ordered", "Units received", "Damaged",
                        "On time"])
    r += 1
    for d in data.get("deliveries") or []:
        for c, v in enumerate([d.get("hub"), d.get("po_number"), d.get("date"), d.get("ordered"),
                               d.get("received"), d.get("damaged"), d.get("on_time")], 1):
            _cell(st, r, c, v, QTY if c in (4, 5, 6) else None)
        r += 1
    r += 1
    st.cell(r, 1, "Returns and write-offs").font = _font(bold=True, size=11)
    r += 1
    _header_row(st, r, ["Hub", "SKU code", "Reason", "Date", "Units", "Type"])
    r += 1
    for x in data.get("returns") or []:
        for c, v in enumerate([x.get("hub"), x.get("sku_code"), x.get("reason"), x.get("date"), x.get("units"),
                               x.get("type")], 1):
            _cell(st, r, c, v, QTY if c == 5 else None)
        r += 1
    _line(st, r + 1, "Expected = Opening + Received - Sold - Returned to brand - Written off. "
                     "Difference = Counted - Expected.")
    st.freeze_panes = st.cell(head + 1, 4)


# --------------------------------------------------------------- operational

def _mmss(s):
    if s is None:
        return None
    return f"{int(s) // 60:02d}:{int(s) % 60:02d}"


def _pct(v):
    return None if v is None else v


def build_operational(data: dict) -> bytes:
    """`data` (routers/reports.operational_data): label, previous_label, hubs,
    current and previous {orders, units, sales_value, ready_10, ready_share,
    avg_pick_s, avg_pack_s, oos_cancels, oos_share, bins_counted, bins_matched,
    accuracy, deliveries, deliveries_on_time}, cover [{brand, hub, weeks_cover,
    weeks_cover_prev}], made."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Operational report"
    _title(ws, 1, f"Operational report, {data['label']}")
    _line(ws, 2, f"Hubs {_join(data.get('hubs'))}. WMS numbers, not Hiryu's. Test orders are left out; "
                 "cancelled orders are not in sales. Compared with " + data["previous_label"] + ".")
    _line(ws, 3, "Ready within 10 minutes counts from Grab's order time to Selesai dikemas. "
                 f"Made {data.get('made', '')}.")
    _header_row(ws, 5, ["Figure", "This period", "Previous period", "Note"], [40, 16, 16, 44])
    c, p = data["current"], data["previous"]
    rows = [
        ("Orders (without test orders)", c["orders"], p["orders"], QTY, None),
        ("Units sold", c["units"], p["units"], QTY, None),
        ("Sales value (Rp)", c.get("sales_value"), p.get("sales_value"), RP, "Grab menu price on the order day"),
        ("Orders ready within 10 minutes", c["ready_10"], p["ready_10"], QTY, None),
        ("Ready within 10 minutes, share", _pct(c["ready_share"]), _pct(p["ready_share"]), "0%", None),
        ("Average pick time (min:s)", _mmss(c["avg_pick_s"]), _mmss(p["avg_pick_s"]), None, "Per order"),
        ("Average pack time (min:s)", _mmss(c["avg_pack_s"]), _mmss(p["avg_pack_s"]), None, "Per order"),
        ("Cancelled: item missing", c["oos_cancels"], p["oos_cancels"], QTY, None),
        ("Cancelled: item missing, share of orders", _pct(c["oos_share"]), _pct(p["oos_share"]), "0.0%", None),
        ("Stock accuracy from counts", _pct(c["accuracy"]), _pct(p["accuracy"]), "0%",
         f"Bins matching at the first count: {c['bins_matched']} of {c['bins_counted']}"),
        ("Brand deliveries on time", f"{c['deliveries_on_time']} of {c['deliveries']}",
         f"{p['deliveries_on_time']} of {p['deliveries']}", None, "Received on the requested date"),
    ]
    r = 6
    for name, a, b, fmt, note in rows:
        _cell(ws, r, 1, name, bold=True)
        _cell(ws, r, 2, a, fmt, align="right")
        _cell(ws, r, 3, b, fmt, align="right")
        _cell(ws, r, 4, note)
        r += 1
    r += 1
    ws.cell(r, 1, "Weeks of stock cover").font = _font(bold=True, size=11)
    r += 1
    _header_row(ws, r, ["Brand", "Hub", "This period", "Previous period"])
    r += 1
    for x in data.get("cover") or []:
        _cell(ws, r, 1, x["brand"])
        _cell(ws, r, 2, x["hub"])
        _cell(ws, r, 3, x.get("weeks_cover"), DEC)
        _cell(ws, r, 4, x.get("weeks_cover_prev"), DEC)
        r += 1
    _line(ws, r + 1, "Weeks of stock cover = stock on the shelf / average sold per week.")
    return _finish(wb)


# --------------------------------------------------------------- variance

BEARER_OF = {"inbound_short": "Brand", "inbound_extra": "Brand", "rejected_back": "Brand",
             "count_short": "Ninja", "count_extra": "Ninja", "damaged_hub": "Ninja",
             "rejected_written_off": "Brand", "returned": "Brand"}
COVERS = {"Brand": "Inbound short and extra, units rejected at inbound, returns to brand",
          "Ninja": "Count differences and any damage after putaway, while in the hub"}


def variance_summary(data: dict) -> dict:
    pairs = [(p["hub"], p["brand"]) for p in data.get("pairs") or []]
    rows = data.get("rows") or []
    out_rows = []
    for cat in data["categories"]:
        mine = [r for r in rows if r["cat"] == cat["key"]]
        cells = []
        for hub, brand in pairs:
            sel = [r for r in mine if r["hub"] == hub and r["brand"] == brand]
            cells.append({"hub": hub, "brand": brand, "units": sum(r["units"] for r in sel),
                          "value": sum(r["value"] or 0 for r in sel)})
        out_rows.append({"key": cat["key"], "name": cat["name"], "bearer": BEARER_OF[cat["key"]],
                         "cells": cells, "units": sum(r["units"] for r in mine),
                         "value": sum(r["value"] or 0 for r in mine), "status": "Final"})
    by = []
    for b in ("Brand", "Ninja"):
        sel = [x for x in out_rows if x["bearer"] == b]
        by.append({"bearer": b, "units": sum(x["units"] for x in sel), "value": sum(x["value"] for x in sel),
                   "covers": COVERS[b]})
    return {"pairs": [{"hub": h, "brand": b} for h, b in pairs], "rows": out_rows,
            "total_units": sum(x["units"] for x in out_rows), "total_value": sum(x["value"] for x in out_rows),
            "by_bearer": by}


def build_variance(data: dict) -> bytes:
    """`data` (routers/reports.variance_data): label, hubs, brands, pairs,
    categories [{key, name, sheet}], rows [{cat, hub, brand, date, ref,
    sku_code, product, units, price, value, bearer, note, approved_name,
    reviewed_name, status}], finalised, count_approved_label, made."""
    s = variance_summary(data)
    pairs = s["pairs"]
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    _title(ws, 1, f"Variance and claims report, {data['label']}")
    _line(ws, 2, f"Hubs {_join(data.get('hubs'))}. Brands {_join(data.get('brands'))}. Only differences approved "
                 "by the SPV, then reviewed by Ops HQ. Value at menu price, IDR.")
    fin = data.get("finalised")
    _line(ws, 3, (f"Finalised by Ops HQ on {fin['label']} ({fin.get('by_name') or fin['by']}). " if fin
                  else "Not finalised by Ops HQ yet. ") +
                 (f"Month-end count approved by the SPV {data['count_approved_label']}."
                  if data.get("count_approved_label") else "Month-end count not approved yet."))
    r = 5
    ws.cell(r, 1, "Summary").font = _font(bold=True, size=11)
    col = 3
    for p in pairs + [{"hub": "All hubs", "brand": None}]:
        c = ws.cell(r, col, f"{p['hub']} · {p['brand']}" if p["brand"] else "All hubs")
        c.font = _font(bold=True, size=9)
        c.fill = GROUP_FILL
        ws.merge_cells(start_row=r, start_column=col, end_row=r, end_column=col + 1)
        col += 2
    r += 1
    heads = ["Category", "Cost borne by"] + ["Units", "Value"] * (len(pairs) + 1) + ["Status"]
    _header_row(ws, r, heads, [34, 14] + [9, 13] * (len(pairs) + 1) + [9])
    r += 1
    first = r
    for row in s["rows"]:
        _cell(ws, r, 1, row["name"])
        _cell(ws, r, 2, row["bearer"])
        c = 3
        for cell in row["cells"]:
            _cell(ws, r, c, cell["units"], QTY)
            _cell(ws, r, c + 1, cell["value"], RP)
            c += 2
        _cell(ws, r, c, f"=SUMIF($C$6:${get_column_letter(c - 1)}$6,\"Units\",C{r}:{get_column_letter(c - 1)}{r})",
              QTY, bold=True)
        _cell(ws, r, c + 1, f"=SUMIF($C$6:${get_column_letter(c - 1)}$6,\"Value\",C{r}:{get_column_letter(c - 1)}{r})",
              RP, bold=True)
        _cell(ws, r, c + 2, row["status"])
        r += 1
    last = r - 1
    ncols = 2 + 2 * (len(pairs) + 1) + 1
    for c in range(1, ncols + 1):
        _cell(ws, r, c, None, fill=TOTAL_FILL)
    _cell(ws, r, 1, "Total", bold=True, fill=TOTAL_FILL)
    for c in range(3, ncols):
        L = get_column_letter(c)
        _cell(ws, r, c, f"=SUM({L}{first}:{L}{last})", QTY if (c % 2) else RP, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, ncols, "Final", bold=True, fill=TOTAL_FILL)
    all_u = get_column_letter(ncols - 2)
    all_v = get_column_letter(ncols - 1)
    r += 2
    ws.cell(r, 1, "By who bears the cost").font = _font(bold=True, size=11)
    r += 1
    _header_row(ws, r, ["Cost borne by", "Units", "Value", "What it covers"])
    ws.column_dimensions["D"].width = max(ws.column_dimensions["D"].width or 0, 13)
    r += 1
    b_first = r
    for b in s["by_bearer"]:
        _cell(ws, r, 1, b["bearer"], bold=True)
        _cell(ws, r, 2, f'=SUMIF($B${first}:$B${last},"{b["bearer"]}",${all_u}${first}:${all_u}${last})', QTY)
        _cell(ws, r, 3, f'=SUMIF($B${first}:$B${last},"{b["bearer"]}",${all_v}${first}:${all_v}${last})', RP)
        _cell(ws, r, 4, b["covers"])
        r += 1
    _cell(ws, r, 1, "Total", bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 2, f"=SUM(B{b_first}:B{r - 1})", QTY, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 3, f"=SUM(C{b_first}:C{r - 1})", RP, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 4, None, fill=TOTAL_FILL)
    _line(ws, r + 2, "Value = units x menu price. Claims are settled outside the WMS. Damage reported by a "
                     "customer after handover is a Grab claim and is not in this file.")

    names = {c["key"]: c["name"] for c in data["categories"]}
    for sheet in dict.fromkeys(c["sheet"] for c in data["categories"]):
        sh = wb.create_sheet(sheet)
        keys = [c["key"] for c in data["categories"] if c["sheet"] == sheet]
        _title(sh, 1, f"{sheet}, {data['label']}", size=12)
        _line(sh, 2, "Every row is final: approved, then reviewed by Ops HQ.")
        _header_row(sh, 4, ["Hub", "Brand", "Date", "Category", "Reference", "SKU code", "Product", "Units",
                            "Menu price", "Value", "Cost borne by", "Note", "Approved by", "Reviewed by", "Status"],
                    [7, 10, 12, 30, 20, 16, 40, 8, 11, 12, 11, 36, 18, 18, 8])
        rr = 5
        for x in [x for x in data["rows"] if x["cat"] in keys]:
            vals = [x["hub"], x["brand"], x["date"], names[x["cat"]], x.get("ref"), x.get("sku_code"),
                    x.get("product"), x["units"], x.get("price"), None, x["bearer"], x.get("note"),
                    x.get("approved_name"), x.get("reviewed_name"), x.get("status", "Final")]
            for c, v in enumerate(vals, 1):
                _cell(sh, rr, c, v, QTY if c == 8 else (RP if c == 9 else None))
            _cell(sh, rr, 10, f"=H{rr}*I{rr}" if x.get("price") is not None else None, RP)
            rr += 1
        if rr > 5:
            _cell(sh, rr, 1, "Total", bold=True, fill=TOTAL_FILL)
            _cell(sh, rr, 8, f"=SUM(H5:H{rr - 1})", QTY, bold=True, fill=TOTAL_FILL)
            _cell(sh, rr, 10, f"=SUM(J5:J{rr - 1})", RP, bold=True, fill=TOTAL_FILL)
        sh.freeze_panes = "A5"
    return _finish(wb)
