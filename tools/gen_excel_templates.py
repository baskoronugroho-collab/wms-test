#!/usr/bin/env python3
"""Excel files the WMS generates (PRD v4.2 §4.1, §4.4.5 and §15.1).

    python tools/gen_excel_templates.py

Writes to docs/templates/:
  - Brand Sales Report - Kahf - Weekly.xlsx
  - Brand Sales Report - Kahf - Monthly.xlsx
  - PO Restock - Kahf - MA5.xlsx      purchase order to the brand, with barcodes

The layouts here are the specification: the WMS export builds the same sheets
from live data. The figures in these files are made up; product names, sizes,
prices and barcodes come from the dev seed (the 25 Sep SKU recheck). Barcodes
starting 299 are test numbers standing in for "no barcode yet".
"""
import io
import math
import pathlib
import re

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "templates"
OUT.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ data
seed = (ROOT / "backend" / "db" / "seed.sql").read_text(encoding="utf-8")
BARCODE = {m[1]: m[0] for m in re.findall(r"\('(\d{8,14})', (\d+), '(?:manufacturer|test)'", seed)}
SKUS = [dict(id=r[0], code=r[1], name=r[2].replace("''", "'"), size=r[3], price=int(r[4]) if r[4] != "NULL" else 0,
             barcode=BARCODE.get(r[0]))
        for r in re.findall(r"\((\d+), 10, '([A-Z]+-\d+)', '((?:[^']|'')*)', [^,]*, [^,]*, '([^']*)', (\d+|NULL)", seed)]
KAHF = SKUS[:14]


def real_barcode(s):
    return s["barcode"] if s["barcode"] and not s["barcode"].startswith("299") else None


def rnd(seed_):
    x = math.sin(seed_ * 9301 + 49297) * 233280
    return x - math.floor(x)


def sold(code, hub, days):
    base = sum(ord(c) for c in code + hub)
    pace = 6 if hub == "MA5" else 4
    return sum(int(rnd(base + d * 17) * pace / 2.2 + (1 if rnd(base + d) > 0.8 else 0)) for d in range(days))


def stock_end(code, hub):
    return max(1, round(15 - rnd(sum(ord(c) for c in code + hub + "s")) * 11))


# ------------------------------------------------------------------ styles
F = "Arial"
INK, MUTED, RED = "1B1D1C", "6B706D", "C0202D"
HEAD_FILL = PatternFill("solid", fgColor="1B1D1C")
TOTAL_FILL = PatternFill("solid", fgColor="F2F4F1")
INPUT_FILL = PatternFill("solid", fgColor="FFF2CC")
thin = Side(style="thin", color="C6CBC5")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
RP = '#,##0;(#,##0);"-"'
QTY = '#,##0;(#,##0);"-"'


def font(**kw):
    return Font(name=F, color=kw.pop("color", INK), **kw)


def title_block(ws, title, rows):
    ws["A1"] = "NINJA VAN"
    ws["A1"].font = font(bold=True, size=9, color=RED)
    ws["A2"] = title
    ws["A2"].font = font(bold=True, size=16)
    r = 4
    for label, value in rows:
        ws.cell(r, 1, label).font = font(size=9, color=MUTED)
        ws.cell(r, 2, value).font = font(size=10, bold=True)
        r += 1
    return r + 1


def header_row(ws, r, headers, widths=None):
    for i, h in enumerate(headers, 1):
        c = ws.cell(r, i, h)
        c.font = font(bold=True, size=9, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
        c.border = BOX
    ws.row_dimensions[r].height = 30
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def cell(ws, r, c, v, fmt=None, bold=False, fill=None, color=INK, align=None):
    x = ws.cell(r, c, v)
    x.font = font(size=10, bold=bold, color=color)
    x.border = BOX
    if fmt:
        x.number_format = fmt
    if fill:
        x.fill = fill
    if align:
        x.alignment = Alignment(horizontal=align, vertical="center")
    return x


def total_row(ws, r, ncols):
    for c in range(1, ncols + 1):
        cell(ws, r, c, None, fill=TOTAL_FILL)


def save(wb, name):
    wb.calculation.fullCalcOnLoad = True
    wb.save(OUT / name)
    return OUT / name


# ------------------------------------------------------------------ brand sales report
def sales_report(period):
    monthly = period == "month"
    days = 31 if monthly else 7
    label = "October 2026 (1 to 31 October)" if monthly else "Week 41: Monday 5 to Sunday 11 October 2026"
    ref = "RPT-KHF-2610" if monthly else "RPT-KHF-2610-W41"
    wb = Workbook()

    # --- per SKU per hub: the data the summary adds up
    ws = wb.active
    ws.title = "Sales by SKU"
    start = title_block(ws, "Sales by SKU · Kahf", [("Period", label), ("Weeks in period", round(days / 7, 2))])
    weeks_cell = "$B$5"
    ws["B5"].number_format = "0.00"
    headers = ["Hub", "SKU code", "Barcode", "Product", "Size", "Menu price (Rp)", "Units sold",
               "Sales value (Rp)", "Stock at end", "Average sold per week", "Weeks of cover", "Notes"]
    header_row(ws, start, headers, [8, 12, 16, 46, 9, 14, 11, 16, 11, 13, 12, 26])
    r = start + 1
    first = r
    for hub in ("MA5", "KJ5"):
        for s in KAHF:
            cell(ws, r, 1, hub)
            cell(ws, r, 2, s["code"])
            b = cell(ws, r, 3, real_barcode(s) or "none yet")
            b.number_format = "@"
            cell(ws, r, 4, s["name"])
            cell(ws, r, 5, s["size"])
            cell(ws, r, 6, s["price"], RP)
            cell(ws, r, 7, sold(s["code"], hub, days), QTY)
            cell(ws, r, 8, f"=F{r}*G{r}", RP)
            cell(ws, r, 9, stock_end(s["code"], hub), QTY)
            cell(ws, r, 10, f"=G{r}/{weeks_cell}", "0.0")
            cell(ws, r, 11, f'=IFERROR(I{r}/J{r},"-")', "0.0")
            cell(ws, r, 12, None)
            r += 1
    last = r - 1
    total_row(ws, r, 12)
    cell(ws, r, 1, "Total", bold=True, fill=TOTAL_FILL)
    cell(ws, r, 7, f"=SUM(G{first}:G{last})", QTY, bold=True, fill=TOTAL_FILL)
    cell(ws, r, 8, f"=SUM(H{first}:H{last})", RP, bold=True, fill=TOTAL_FILL)
    cell(ws, r, 9, f"=SUM(I{first}:I{last})", QTY, bold=True, fill=TOTAL_FILL)
    ws.freeze_panes = ws.cell(start + 1, 5)
    ws.auto_filter.ref = f"A{start}:L{last}"
    P = "'Sales by SKU'!"
    rng = lambda col: f"{P}${col}${first}:${col}${last}"

    # --- summary: formulas over the SKU sheet
    sm = wb.create_sheet("Summary", 0)
    nxt = title_block(sm, "Sales and stock report · Kahf", [
        ("Period", label), ("Hubs", "MA5 Cawang, KJ5 Kemanggisan"), ("Reference", ref),
        ("Made", "04/11/2026 10:00 WIB" if monthly else "12/10/2026 10:00 WIB")])
    header_row(sm, nxt, ["Figure", "MA5", "KJ5", "Total"], [36, 16, 16, 18])
    r = nxt + 1
    rows = {}
    for key, name, a, b, fmt in [
            ("units", "Units sold", f"=SUMIFS({rng('G')},{rng('A')},\"MA5\")", f"=SUMIFS({rng('G')},{rng('A')},\"KJ5\")", QTY),
            ("value", "Sales value (Rp, Grab menu price)", f"=SUMIFS({rng('H')},{rng('A')},\"MA5\")", f"=SUMIFS({rng('H')},{rng('A')},\"KJ5\")", RP),
            ("orders", "Orders", None, None, QTY),
            ("oos", "Orders cancelled: item out of stock", 2 if monthly else 1, 1 if monthly else 0, QTY),
            ("stock", "Stock at end (units)", f"=SUMIFS({rng('I')},{rng('A')},\"MA5\")", f"=SUMIFS({rng('I')},{rng('A')},\"KJ5\")", QTY)]:
        rows[key] = r
        if key == "orders":
            a, b = f"=ROUND(B{rows['units']}/1.6,0)", f"=ROUND(C{rows['units']}/1.6,0)"
        cell(sm, r, 1, name, bold=True)
        cell(sm, r, 2, a, fmt)
        cell(sm, r, 3, b, fmt)
        cell(sm, r, 4, f"=B{r}+C{r}", fmt, bold=True)
        r += 1
    cell(sm, r, 1, "Units per order", bold=True)
    for i, col in enumerate("BCD", 2):
        cell(sm, r, i, f"=IFERROR({col}{rows['units']}/{col}{rows['orders']},0)", "0.0")
    r += 1
    cell(sm, r, 1, "Cancelled for out of stock, % of orders", bold=True)
    for i, col in enumerate("BCD", 2):
        cell(sm, r, i, f"=IFERROR({col}{rows['oos']}/{col}{rows['orders']},0)", "0.0%")
    r += 2
    for n in ("Sales value = Grab menu price on the day of the order × units, before Grab commission and promotions. Cancelled orders are not counted.",
              "A pack of 2 counts as 2 units of its product."):
        sm.cell(r, 1, n).font = font(size=9, color=MUTED, italic=True)
        r += 1

    # --- monthly: stock reconciliation, deliveries, returns and write-offs
    if monthly:
        st = wb.create_sheet("Stock and deliveries")
        nxt = title_block(st, "Stock reconciliation · Kahf", [("Period", label)])
        header_row(st, nxt, ["Hub", "Opening stock", "Received", "Sold", "Returned to brand", "Written off", "Expected",
                             "Counted at month end", "Difference"], [10, 13, 12, 12, 15, 12, 12, 17, 12])
        r = nxt + 1
        for i, hub in enumerate(("MA5", "KJ5")):
            sold_h = sum(sold(s["code"], hub, days) for s in KAHF)
            counted = sum(stock_end(s["code"], hub) for s in KAHF)
            ret, wo, diff = (3, 2, -1) if i == 0 else (1, 1, 0)
            opening = 140 if hub == "MA5" else 110
            received = counted - diff - opening + sold_h + ret + wo
            cell(st, r, 1, hub)
            cell(st, r, 2, opening, QTY)
            cell(st, r, 3, received, QTY)
            cell(st, r, 4, f"=SUMIFS({rng('G')},{rng('A')},\"{hub}\")", QTY)
            cell(st, r, 5, ret, QTY)
            cell(st, r, 6, wo, QTY)
            cell(st, r, 7, f"=B{r}+C{r}-D{r}-E{r}-F{r}", QTY)
            cell(st, r, 8, counted, QTY)
            cell(st, r, 9, f"=H{r}-G{r}", QTY, bold=True)
            r += 1
        r += 1
        st.cell(r, 1, "Deliveries received").font = font(bold=True, size=11)
        r += 1
        header_row(st, r, ["AWB", "Date", "Hub", "Requested (PO)", "Sent (Surat Jalan)", "Received", "Difference", "PO number"])
        r += 1
        for awb, date, hub, ask, sent, recv, po in [
                ("JX2610010231", "03/10/2026", "MA5", 96, 96, 96, "RPL-MA5-2609-03"),
                ("JX2610010877", "10/10/2026", "KJ5", 72, 70, 70, "RPL-KJ5-2610-01"),
                ("JX2610011502", "17/10/2026", "MA5", 84, 84, 86, "RPL-MA5-2610-02")]:
            for c, v in enumerate([awb, date, hub, ask, sent, recv], 1):
                cell(st, r, c, v, QTY if c >= 4 else None)
            cell(st, r, 7, f"=F{r}-E{r}", QTY, bold=True)
            cell(st, r, 8, po)
            r += 1
        r += 1
        st.cell(r, 1, "Returns and write-offs").font = font(bold=True, size=11)
        r += 1
        header_row(st, r, ["Hub", "SKU code", "Reason", "Units", "Cost borne by", "Date"])
        r += 1
        for row in [("MA5", "KHF-0006", "Damaged in the hub", 1, "Ninja", "12/10/2026"),
                    ("MA5", "KHF-0013", "Faulty pack (leak)", 1, "Brand", "20/10/2026"),
                    ("MA5", "KHF-0014", "Returned: expiry near", 3, "Brand", "28/10/2026"),
                    ("KJ5", "KHF-0003", "Faulty pack (leak)", 1, "Brand", "22/10/2026")]:
            for c, v in enumerate(row, 1):
                cell(st, r, c, v, QTY if c == 4 else None)
            r += 1

    for sheet in wb.worksheets:
        sheet.sheet_view.showGridLines = False
    return save(wb, f"Brand Sales Report - Kahf - {'Monthly' if monthly else 'Weekly'}.xlsx")


# ------------------------------------------------------------------ EAN-13 drawing for the PO
L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13_png(code):
    d = [int(c) for c in code]
    bits = "101"
    for i, p in enumerate(PARITY[d[0]]):
        bits += (L if p == "L" else G)[d[i + 1]]
    bits += "01010"
    for i in range(7, 13):
        bits += R[d[i]]
    bits += "101"
    m, h = 2, 46
    img = Image.new("RGB", ((len(bits) + 18) * m, h + 16), "white")
    dr = ImageDraw.Draw(img)
    x = 9 * m
    for i, b in enumerate(bits):
        if b == "1":
            long_bar = i < 3 or 45 <= i < 50 or i >= 92
            dr.rectangle([x, 2, x + m - 1, h + (8 if long_bar else 0)], fill="black")
        x += m
    dr.text((1, h + 2), code[0], fill="black")
    dr.text((13 * m, h + 3), code[1:7], fill="black")
    dr.text((59 * m, h + 3), code[7:], fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


# ------------------------------------------------------------------ PO to the brand
def purchase_order():
    wb = Workbook()
    ws = wb.active
    ws.title = "PO"
    # The WMS fills these header fields; Ops HQ can edit each one on "Buat PO" before downloading (PRD §4.4.5).
    title_block(ws, "Purchase Order · Restock", [
        ("PO number", "RPL-MA5-2610-02"),
        ("PO date", "14/10/2026"),
        ("To (brand)", "Kahf · PT Paragon Technology and Innovation"),
        ("Brand contact", "Restock contact name · email · WhatsApp"),
        ("Deliver to", "Ninja Van Dark Store MA5 Cawang · Jl. Raya Kalibata No. 4, Kramat Jati, Jakarta Timur"),
        ("Requested delivery date", "17/10/2026, receiving 09:00 to 16:00 WIB"),
        ("Created by (Ops HQ)", "Ops HQ name · name@ninjavan.co"),
    ])
    ws["A12"] = ("Please: (1) make sure every unit carries the barcode in the Barcode column; if it differs or is missing, "
                 "write the right barcode in the yellow column. (2) List the expiry date (ED) of each SKU on the Faktur. "
                 "(3) Put this PO number on the Faktur and the Surat Jalan.")
    ws["A12"].font = font(size=10, bold=True, color=RED)
    ws["A12"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A12:L12")
    ws.row_dimensions[12].height = 44
    start = 14
    headers = ["No", "Brand SKU code", "Hiryu SKU code", "Barcode (EAN-13)", "Barcode", "Product", "Size",
               "Current stock", "Fill up to", "Quantity requested (pcs)", "Brand's barcode (fill if different or missing)", "Notes"]
    header_row(ws, start, headers, [5, 14, 14, 17, 26, 46, 9, 10, 10, 13, 24, 22])
    r = start + 1
    first = r
    for i, s in enumerate(KAHF, 1):
        code = real_barcode(s)
        now_ = max(0, stock_end(s["code"], "MA5") - 6)
        cell(ws, r, 1, i, align="center")
        cell(ws, r, 2, s["code"])
        cell(ws, r, 3, s["code"])
        b = cell(ws, r, 4, code or "MISSING", color=INK if code else RED, bold=not code)
        b.number_format = "@"
        cell(ws, r, 5, None)
        cell(ws, r, 6, s["name"])
        cell(ws, r, 7, s["size"])
        cell(ws, r, 8, now_, QTY)
        cell(ws, r, 9, 15, QTY)
        cell(ws, r, 10, f"=MAX(0,I{r}-H{r})", QTY, bold=True)
        k = cell(ws, r, 11, None, fill=INPUT_FILL)
        k.number_format = "@"
        cell(ws, r, 12, None)
        ws.row_dimensions[r].height = 50
        if code:
            img = XLImage(ean13_png(code))
            img.width, img.height = 180, 58
            ws.add_image(img, f"E{r}")
        for c in range(1, 13):
            ws.cell(r, c).alignment = Alignment(vertical="center", wrap_text=c in (6, 12),
                                                horizontal="center" if c == 1 else None)
        r += 1
    last = r - 1
    total_row(ws, r, 12)
    cell(ws, r, 4, f'=COUNTIF(D{first}:D{last},"MISSING")&" SKU without a barcode"', bold=True, fill=TOTAL_FILL, color=RED)
    cell(ws, r, 6, "Total", bold=True, fill=TOTAL_FILL)
    cell(ws, r, 10, f"=SUM(J{first}:J{last})", QTY, bold=True, fill=TOTAL_FILL)
    r += 2
    ws.cell(r, 1, "Yellow cells are for the brand to fill. MISSING means the WMS has no barcode for that SKU yet.").font = font(size=9, color=MUTED)
    r += 2
    for label in ("Created by Ops HQ (name, date)", "Confirmed by the brand (name, date, shipment AWB)"):
        ws.cell(r, 2, label).font = font(size=9, color=MUTED)
        for col in range(2, 7):
            ws.cell(r + 2, col).border = Border(bottom=thin)
        r += 4
    ws.freeze_panes = ws.cell(start + 1, 4)
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    return save(wb, "PO Restock - Kahf - MA5.xlsx")


if __name__ == "__main__":
    for old in OUT.glob("*(contoh).xlsx"):
        try:
            old.unlink()
        except PermissionError:
            print("still open, not removed:", old.name)
    for p in (sales_report("week"), sales_report("month"), purchase_order()):
        print("wrote", p.relative_to(ROOT))
