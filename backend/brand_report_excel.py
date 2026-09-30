"""The brand sales report as an Excel file (PRD §15.1).

The layout is the approved one in docs/templates/Brand Sales Report - Kahf -
Weekly.xlsx and ... - Monthly.xlsx, which tools/gen_excel_templates.py draws with
made-up figures. This module draws the same sheets from data the caller has
already gathered (routers/reports.py), so the layout can be checked without a
database and the queries can change without touching the look.

English only: the file goes to the brand. The Notes column is left empty for
Ops HQ to fill before sending. Totals, averages, weeks of cover and the summary
stay live formulas over the SKU sheet, as in the template, so a corrected cell
recalculates everything above it.

One deliberate difference from the template: there, sales value is always
=F*G (menu price x units). Here the value comes from each order line (the item's
price on the day of the order, §15.1), which differs from today's menu price x
units when the price changed during the period or a pack is priced below two
singles. The cell keeps the template's =F*G whenever that gives the same
number, and holds the order-line figure where it does not.
"""
import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ------------------------------------------------------------------ styles
# Copied from tools/gen_excel_templates.py: the template is the specification.
F = "Arial"
INK, MUTED, RED = "1B1D1C", "6B706D", "C0202D"
HEAD_FILL = PatternFill("solid", fgColor="1B1D1C")
TOTAL_FILL = PatternFill("solid", fgColor="F2F4F1")
thin = Side(style="thin", color="C6CBC5")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
RP = '#,##0;(#,##0);"-"'
QTY = '#,##0;(#,##0);"-"'

CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _font(**kw):
    return Font(name=F, color=kw.pop("color", INK), **kw)


def _title_block(ws, title, rows):
    ws["A1"] = "NINJA VAN"
    ws["A1"].font = _font(bold=True, size=9, color=RED)
    ws["A2"] = title
    ws["A2"].font = _font(bold=True, size=16)
    r = 4
    for label, value in rows:
        ws.cell(r, 1, label).font = _font(size=9, color=MUTED)
        ws.cell(r, 2, value).font = _font(size=10, bold=True)
        r += 1
    return r + 1


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


def _total_row(ws, r, ncols):
    for c in range(1, ncols + 1):
        _cell(ws, r, c, None, fill=TOTAL_FILL)


def _q(s: str) -> str:
    """A text value inside a formula string."""
    return '"' + str(s).replace('"', '""') + '"'


def build(data: dict) -> bytes:
    """Draw the report and return the .xlsx bytes.

    `data`:
      brand_name, monthly (bool), period_label, reference, made (text),
      weeks (weeks in the period), hubs: [{code, label}],
      skus: [{hub, sku_code, barcode, product, size, menu_price, units_sold,
              sales_value, stock_end}],
      hub_figures: {hub code: {orders, oos_cancelled}},
      and for a monthly report:
      reconciliation: [{hub, opening, received, returned, written_off, counted}],
      deliveries: [{awb, date, hub, requested, sent, received, po_number}],
      returns: [{hub, sku_code, reason, units, cost_by, date}].
    Any figure may be None: the cell is then left empty rather than guessed.
    """
    monthly = bool(data.get("monthly"))
    brand = data["brand_name"]
    label = data["period_label"]
    hubs = data.get("hubs") or []
    wb = Workbook()

    # --- per SKU per hub: the data the summary adds up
    ws = wb.active
    ws.title = "Sales by SKU"
    start = _title_block(ws, f"Sales by SKU · {brand}",
                         [("Period", label), ("Weeks in period", data["weeks"])])
    weeks_cell = "$B$5"
    ws["B5"].number_format = "0.00"
    headers = ["Hub", "SKU code", "Barcode", "Product", "Size", "Menu price (Rp)", "Units sold",
               "Sales value (Rp)", "Stock at end", "Average sold per week", "Weeks of cover", "Notes"]
    _header_row(ws, start, headers, [8, 12, 16, 46, 9, 14, 11, 16, 11, 13, 12, 26])
    r = start + 1
    first = r
    for s in data.get("skus") or []:
        _cell(ws, r, 1, s["hub"])
        _cell(ws, r, 2, s.get("sku_code"))
        b = _cell(ws, r, 3, s.get("barcode") or "none yet")
        b.number_format = "@"
        _cell(ws, r, 4, s.get("product"))
        _cell(ws, r, 5, s.get("size"))
        _cell(ws, r, 6, s.get("menu_price"), RP)
        _cell(ws, r, 7, s.get("units_sold") or 0, QTY)
        price, units, value = s.get("menu_price"), s.get("units_sold") or 0, s.get("sales_value")
        if value is None or (price is not None and price * units == value):
            _cell(ws, r, 8, f"=F{r}*G{r}", RP)
        else:
            _cell(ws, r, 8, value, RP)
        _cell(ws, r, 9, s.get("stock_end"), QTY)
        _cell(ws, r, 10, f"=G{r}/{weeks_cell}", "0.0")
        _cell(ws, r, 11, f'=IFERROR(I{r}/J{r},"-")', "0.0")
        _cell(ws, r, 12, None)
        r += 1
    if r == first:
        # No SKU rows: one empty row keeps every range below valid.
        for c in range(1, 13):
            _cell(ws, r, c, None)
        r += 1
    last = r - 1
    _total_row(ws, r, 12)
    _cell(ws, r, 1, "Total", bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 7, f"=SUM(G{first}:G{last})", QTY, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 8, f"=SUM(H{first}:H{last})", RP, bold=True, fill=TOTAL_FILL)
    _cell(ws, r, 9, f"=SUM(I{first}:I{last})", QTY, bold=True, fill=TOTAL_FILL)
    ws.freeze_panes = ws.cell(start + 1, 5)
    ws.auto_filter.ref = f"A{start}:L{last}"
    P = "'Sales by SKU'!"

    def rng(col):
        return f"{P}${col}${first}:${col}${last}"

    def sumifs(col, hub):
        return f"=SUMIFS({rng(col)},{rng('A')},{_q(hub)})"

    # --- summary: formulas over the SKU sheet, one column per hub, then total
    sm = wb.create_sheet("Summary", 0)
    nxt = _title_block(sm, f"Sales and stock report · {brand}", [
        ("Period", label), ("Hubs", ", ".join(h["label"] for h in hubs) or "none"),
        ("Reference", data["reference"]), ("Made", data["made"])])
    ncols = len(hubs)
    tcol = get_column_letter(ncols + 2)
    hub_cols = [get_column_letter(i + 2) for i in range(ncols)]
    _header_row(sm, nxt, ["Figure"] + [h["code"] for h in hubs] + ["Total"],
                [36] + [16] * ncols + [18])
    figs = data.get("hub_figures") or {}
    r = nxt + 1
    rows = {}
    for key, name, fmt in [
            ("units", "Units sold", QTY),
            ("value", "Sales value (Rp, Grab menu price)", RP),
            ("orders", "Orders", QTY),
            ("oos", "Orders cancelled: item out of stock", QTY),
            ("stock", "Stock at end (units)", QTY)]:
        rows[key] = r
        _cell(sm, r, 1, name, bold=True)
        for i, h in enumerate(hubs):
            if key == "units":
                v = sumifs("G", h["code"])
            elif key == "value":
                v = sumifs("H", h["code"])
            elif key == "stock":
                v = sumifs("I", h["code"])
            elif key == "orders":
                v = (figs.get(h["code"]) or {}).get("orders")
            else:
                v = (figs.get(h["code"]) or {}).get("oos_cancelled")
            _cell(sm, r, i + 2, v, fmt)
        total = "=" + "+".join(f"{c}{r}" for c in hub_cols) if hub_cols else 0
        _cell(sm, r, ncols + 2, total, fmt, bold=True)
        r += 1
    _cell(sm, r, 1, "Units per order", bold=True)
    for i, col in enumerate(hub_cols + [tcol], 2):
        _cell(sm, r, i, f"=IFERROR({col}{rows['units']}/{col}{rows['orders']},0)", "0.0")
    r += 1
    _cell(sm, r, 1, "Cancelled for out of stock, % of orders", bold=True)
    for i, col in enumerate(hub_cols + [tcol], 2):
        _cell(sm, r, i, f"=IFERROR({col}{rows['oos']}/{col}{rows['orders']},0)", "0.0%")
    r += 2
    for n in ("Sales value = Grab menu price on the day of the order × units, before Grab "
              "commission and promotions. Cancelled orders are not counted.",
              "A pack of 2 counts as 2 units of its product."):
        sm.cell(r, 1, n).font = _font(size=9, color=MUTED, italic=True)
        r += 1

    # --- monthly: stock reconciliation, deliveries, returns and write-offs
    if monthly:
        st = wb.create_sheet("Stock and deliveries")
        nxt = _title_block(st, f"Stock reconciliation · {brand}", [("Period", label)])
        _header_row(st, nxt, ["Hub", "Opening stock", "Received", "Sold", "Returned to brand",
                              "Written off", "Expected", "Counted at month end", "Difference"],
                    [10, 13, 12, 12, 15, 12, 12, 17, 12])
        r = nxt + 1
        for rec in data.get("reconciliation") or []:
            hub = rec["hub"]
            _cell(st, r, 1, hub)
            _cell(st, r, 2, rec.get("opening"), QTY)
            _cell(st, r, 3, rec.get("received"), QTY)
            _cell(st, r, 4, sumifs("G", hub), QTY)
            _cell(st, r, 5, rec.get("returned"), QTY)
            _cell(st, r, 6, rec.get("written_off"), QTY)
            _cell(st, r, 7, f"=B{r}+C{r}-D{r}-E{r}-F{r}", QTY)
            counted = rec.get("counted")
            _cell(st, r, 8, counted, QTY)
            # No month-end count on record: no difference, rather than one
            # that reads as if every unit were missing.
            _cell(st, r, 9, f"=H{r}-G{r}" if counted is not None else None, QTY, bold=True)
            r += 1
        r += 1
        st.cell(r, 1, "Deliveries received").font = _font(bold=True, size=11)
        r += 1
        _header_row(st, r, ["AWB", "Date", "Hub", "Requested (PO)", "Sent (Surat Jalan)",
                            "Received", "Difference", "PO number"])
        r += 1
        for d in data.get("deliveries") or []:
            vals = [d.get("awb"), d.get("date"), d.get("hub"), d.get("requested"),
                    d.get("sent"), d.get("received")]
            for c, v in enumerate(vals, 1):
                _cell(st, r, c, v, QTY if c >= 4 else None)
            both = d.get("sent") is not None and d.get("received") is not None
            _cell(st, r, 7, f"=F{r}-E{r}" if both else None, QTY, bold=True)
            _cell(st, r, 8, d.get("po_number"))
            r += 1
        r += 1
        st.cell(r, 1, "Returns and write-offs").font = _font(bold=True, size=11)
        r += 1
        _header_row(st, r, ["Hub", "SKU code", "Reason", "Units", "Cost borne by", "Date"])
        r += 1
        for x in data.get("returns") or []:
            vals = [x.get("hub"), x.get("sku_code"), x.get("reason"), x.get("units"),
                    x.get("cost_by"), x.get("date")]
            for c, v in enumerate(vals, 1):
                _cell(st, r, c, v, QTY if c == 4 else None)
            r += 1

    for sheet in wb.worksheets:
        sheet.sheet_view.showGridLines = False
    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
