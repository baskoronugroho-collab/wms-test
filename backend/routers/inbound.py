"""Inbound: receive a brand delivery unit by unit into temporary bins, print the
putaway slips, put every temporary bin away as its own task, and leave every
difference to Ops HQ (canvas section 5, decisions of 1 and 5 Oct 2026, flow
reordered 7 Oct 2026).

  1  Open the delivery by our Ninja reference or the brand's PO number (or tap it
     under *Kiriman hari ini*) and count the cartons. A count that differs from
     the Surat Jalan waits for the SPV: *Terima & tulis ulang* (raised to Ops HQ
     at once) or *Tolak*. A number the WMS does not know is a delivery with no
     PO: photo of the Surat Jalan, brand, cartons, *Kirim ke Ops HQ, lalu hitung*.
  2  Scan every unit, in one go. One product per temporary bin, chosen by the
     WMS: the first unit of a product gets an empty bin, whose label is scanned
     once; the same product keeps going there; *Bin penuh* gives the next one;
     when none is free, new products stop until the SPV adds a bin. A unit above
     the expected quantity goes to a bin of its own and waits for Ops HQ. A
     product with no barcode is picked from the list (logged, seen by the SPV).
     *Rusak*: the unit goes to the quarantine tray or back to the driver, with a
     photo; either way it waits for Ops HQ.
  3  Check the differences (expected against scanned, per product).
  4  Paperwork: write the received quantities on the Surat Jalan / Faktur, sign,
     then the three photos. *Selesai*: the receipt closes, every difference
     (short, extra, damaged) waits for Ops HQ's approval within 24 hours, and
     the temporary bins wait for their putaway slips (status 'full').
  5  The putaway slips are printed, one per temporary bin. *Sudah dicetak*
     (/slips-printed) turns every bin into a putaway task (status 'batched');
     extra units and an unlinked no-PO delivery are held for Ops HQ instead.
  6  Each task: go to the temporary bin, scan the rack bin (wrong bin refused),
     confirm the units. The units are stock, sellable and sent to Hiryu from
     that scan (ledger receipt_in), never before.
  7  The receipt is done when no task is left.

Receipts from before 7 Oct may have bins already 'batched' while still open (the
old *Selesai batch ini*): they stay putaway tasks and can be put away any time.

Units in a temporary bin are not stock: they are counted in inbound_bin_loads
and inbound_units, not in the ledger. Nobody types a date; stock age counts from
the inbound date.

Temporary bins and the quarantine tray are agent S's special bins (table
special_bins, kinds IN and QR). Until that table exists the WMS falls back to
sites.inbound_bins and the codes <HUB>-IN-01.. and <HUB>-QR-01.
"""
import json
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

import auth
import common
import daycolor
import db
import ledger
from routers import faktur, replenishment

router = APIRouter(prefix="/api", tags=["inbound"])

OCCUPYING = ("filling", "full", "batched", "held", "return")
PROOF_KINDS = ("sj_signed", "selfie", "sj_driver")
PHOTO_KINDS = PROOF_KINDS + ("sj_no_po", "damage")
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
               "image/heic": "heic", "image/heif": "heif"}
PHOTO_MAX = 10 * 1024 * 1024
DAMAGE_TO = ("quarantine", "driver")
# The sticker colour names as staff say them (daycolor keeps the hex and the day).
COLOUR_NAME = {"mon": ("Kuning", "Yellow"), "tue": ("Hijau", "Green"), "wed": ("Biru", "Blue"),
               "thu": ("Oranye", "Orange"), "fri": ("Merah", "Red"),
               "sat": ("Merah muda", "Pink"), "sun": ("Putih", "White")}


# --- shapes ------------------------------------------------------------------------

class Delivery(BaseModel):
    replenishment_id: int
    reference: str
    brand_po_number: str | None = None
    brand_id: int
    brand_name: str
    status: str
    sku_count: int
    units: int
    eta_date: str | None = None
    arriving_today: bool = False
    receipt_id: int | None = Field(default=None, description="An open receipt to continue")


class DeliveryList(BaseModel):
    today: list[Delivery]
    next: list[Delivery]
    open_receipts: list[dict] = []


class LookupResult(BaseModel):
    code: str
    matches: list[Delivery]
    found: bool
    message: str | None = None


class OpenIn(BaseModel):
    site_id: int
    replenishment_id: int | None = None
    code: str | None = Field(default=None, description="Ninja reference or brand PO number")
    sj_cartons: int | None = Field(default=None, ge=0)
    counted_cartons: int | None = Field(default=None, ge=0)


class CartonsIn(BaseModel):
    sj_cartons: int = Field(ge=0)
    counted_cartons: int = Field(ge=0)


class CartonDecisionIn(BaseModel):
    decision: str = Field(description="accept_rewrite | refuse")


class LineOut(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    has_barcode: bool = True
    qty_expected: int | None = None
    qty_received: int = 0
    qty_damaged: int = 0
    qty_manual: int = 0
    qty_extra: int = 0
    state: str = Field(description="not_started | counting | match | short | extra | counted")
    bins: list[str] = []


class LoadOut(BaseModel):
    id: int
    receipt_id: int
    sku_id: int
    sku_name: str | None = None
    bin_code: str
    is_extra: bool
    status: str
    qty: int
    qty_put: int
    qty_hold: int
    qty_to_put: int
    batch_no: int | None = None
    label_scanned: bool
    target_location_code: str | None = None


class DifferenceOut(BaseModel):
    id: int
    sku_id: int
    sku_name: str
    kind: str
    place: str
    bin_code: str | None = None
    qty: int
    status: str
    decision: str | None = None
    photos: int = 0
    decide_by: str | None = None


class PhotoOut(BaseModel):
    id: int
    kind: str
    difference_id: int | None = None
    uploaded_by: str
    uploaded_at: str
    url: str


class ReceiptOut(BaseModel):
    id: int
    site_id: int
    site_code: str
    brand_id: int | None = None
    brand_name: str | None = None
    status: str = Field(description="open | completed | refused")
    replenishment_id: int | None = None
    reference: str | None = None
    brand_po_number: str | None = None
    no_po: bool = False
    no_po_code: str | None = None
    no_po_linked: bool = False
    opened_by: str | None = None
    opened_at: str
    first_unit_at: str | None = None
    last_unit_at: str | None = None
    completed_at: str | None = None
    sj_cartons: int | None = None
    counted_cartons: int | None = None
    carton_state: str = Field(description="not_counted | match | waiting_spv | accepted_rewrite "
                                          "| refused")
    carton_decided_by: str | None = None
    can_scan: bool
    lines: list[LineOut]
    loads: list[LoadOut]
    free_bins: int
    temp_bins: int
    quarantine_tray: str
    differences: list[DifferenceOut]
    photos: list[PhotoOut]
    proof_done: list[str]
    can_finish: bool
    finish_blockers: list[str]
    decide_by: str | None = None
    faktur_uploaded_at: str | None = None
    total_expected: int | None = None
    total_received: int = 0
    stage: str = Field(default="scan", description="scan (open) | print (finished, putaway slips "
                                                    "not printed yet) | putaway (tasks left) "
                                                    "| done | refused")
    slip_pending: int = Field(default=0, description="Temporary bins waiting for their slip")
    tasks_open: int = Field(default=0, description="Putaway tasks (temporary bins) left")
    units_to_put: int = 0


class UnitIn(BaseModel):
    code: str | None = Field(default=None, description="Barcode scanned")
    sku_id: int | None = Field(default=None, description="Picked from the list (no barcode)")
    damaged: bool = False
    damage_to: str | None = Field(default=None, description="quarantine | driver")
    idempotency_key: str | None = None


class UnitResult(BaseModel):
    accepted: bool
    outcome: str = Field(description="counted | new_bin | extra_bin | damaged | unknown_barcode "
                                     "| wrong_brand | no_free_bin | needs_damage_place "
                                     "| carton_check")
    message: str
    sku: dict | None = None
    load: LoadOut | None = None
    line: LineOut | None = None
    difference_id: int | None = None
    photo_needed: bool = False
    needs_bin_label: bool = False
    free_bins: int = 0
    total_received: int = 0


class UndoIn(BaseModel):
    sku_id: int | None = None
    manual_only: bool = False
    idempotency_key: str | None = None


class BinLabelIn(BaseModel):
    code: str


class PutawayIn(BaseModel):
    location_code: str = Field(description="The rack bin label scanned")
    qty: int | None = Field(default=None, ge=1, description="Default: everything left to put")
    idempotency_key: str | None = None


class RackFullIn(BaseModel):
    location_code: str | None = Field(default=None, description="The bin that is full")


class PutawayItem(BaseModel):
    load: LoadOut
    sku_name: str
    reference: str | None = None
    to_location_code: str | None = None
    to_location_label: str | None = None
    waiting_ops_hq: bool = False
    returning: bool = False


class PutawayList(BaseModel):
    site_id: int
    items: list[PutawayItem]
    held: list[PutawayItem]
    divider: dict
    free_bins: int
    temp_bins: int
    batch_no: int | None = None


class PutawayResult(BaseModel):
    ok: bool
    put: int
    remaining: int
    load: LoadOut
    location_code: str
    message: str


class FinishIn(BaseModel):
    sj_signed_by: str | None = Field(default=None, description="Email of who signed the SJ; "
                                                               "default the caller")


class LinkIn(BaseModel):
    replenishment_id: int


class TempBin(BaseModel):
    code: str
    occupied: bool
    sku_name: str | None = None
    receipt_id: int | None = None
    status: str | None = None
    qty: int | None = None


class TempBinList(BaseModel):
    site_id: int
    bins: list[TempBin]
    quarantine_tray: str
    free: int


# --- small helpers -----------------------------------------------------------------

def _ts(v) -> str | None:
    return str(v) if v else None


async def _rule(key: str, default: int) -> int:
    r = await db.fetch_one("SELECT enabled, value_num FROM alert_rules WHERE rule_key = %s",
                           (key,))
    return int(r["value_num"]) if r and r["value_num"] is not None else default


async def _site(site_id: int) -> dict:
    return await db.fetch_one("SELECT * FROM sites WHERE id = %s", (site_id,))


async def temp_bin_codes(site: dict) -> list[str]:
    """Agent S's temporary inbound bins of a hub, in order. Fallback until
    special_bins exists: sites.inbound_bins (default rule default_temp_bins)."""
    try:
        rows = await db.fetch_all(
            "SELECT code FROM special_bins WHERE site_id = %s AND kind = 'IN' AND active = 1 "
            "ORDER BY seq, code", (site["id"],))
        if rows:
            return [r["code"] for r in rows]
    except Exception:
        pass
    n = site.get("inbound_bins") or await _rule("default_temp_bins", 6)
    hub = replenishment.hub_code(site["code"])
    return [f"{hub}-IN-{i:02d}" for i in range(1, int(n) + 1)]


async def quarantine_tray(site: dict) -> str:
    try:
        row = await db.fetch_one(
            "SELECT code FROM special_bins WHERE site_id = %s AND kind = 'QR' AND active = 1 "
            "ORDER BY seq, code LIMIT 1", (site["id"],))
        if row:
            return row["code"]
    except Exception:
        pass
    return f"{replenishment.hub_code(site['code'])}-QR-01"


async def _occupied(site_id: int, cur=None) -> dict[str, dict]:
    sql = ("SELECT l.*, s.name_display FROM inbound_bin_loads l JOIN skus s ON s.id = l.sku_id "
           f"WHERE l.site_id = %s AND l.status IN {replenishment._sql_in(OCCUPYING)}")
    rows = await (db.many(cur, sql, (site_id,)) if cur else db.fetch_all(sql, (site_id,)))
    return {r["bin_code"]: r for r in rows}


async def _free_bins(site: dict, cur=None) -> list[str]:
    occ = await _occupied(site["id"], cur)
    return [c for c in await temp_bin_codes(site) if c not in occ]


def _same_code(a: str | None, b: str | None) -> bool:
    return (a or "").strip().upper() == (b or "").strip().upper()


async def _receipt(receipt_id: int, user: auth.User) -> dict:
    row = await db.fetch_one("SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
    if not row:
        raise HTTPException(404, "Penerimaan tidak ditemukan. / Receipt not found.")
    await auth.assert_site_access(user, row["site_id"])
    return row


def carton_state(r: dict) -> str:
    if r.get("status") == "refused" or r.get("carton_decision") == "refuse":
        return "refused"
    if r.get("counted_cartons") is None or r.get("sj_cartons") is None:
        return "not_counted"
    if int(r["counted_cartons"]) == int(r["sj_cartons"]):
        return "match"
    return "accepted_rewrite" if r.get("carton_decision") == "accept_rewrite" else "waiting_spv"


def _can_scan(r: dict) -> bool:
    return r["status"] == "open" and carton_state(r) in ("match", "accepted_rewrite")


def _unlinked(r: dict) -> bool:
    """A no-PO delivery Ops HQ has not linked to a request yet: nothing may go to the rack."""
    return bool(r.get("no_po")) and not r.get("replenishment_id")


def _left(l: dict) -> int:
    return int(l["qty"]) - int(l["qty_put"]) - int(l["qty_hold"])


def _puttable(l: dict, r: dict) -> bool:
    """A temporary bin with units that will go to the rack once its slip is printed."""
    return (l["status"] in ("filling", "full") and not l["is_extra"] and not _unlinked(r)
            and _left(l) > 0)


def _stage(r: dict, loads: list[dict]) -> dict:
    """Where a receipt is in the 7 Oct flow. 'print': finished, slips not printed
    yet; 'putaway': tasks left; 'done': nothing left to put away."""
    tasks = [l for l in loads if l["status"] == "batched" and _left(l) > 0]
    waiting = [l for l in loads if r["status"] == "completed" and _puttable(l, r)]
    if r["status"] == "refused":
        stage = "refused"
    elif r["status"] == "open":
        stage = "scan"
    elif waiting:
        stage = "print"
    elif tasks:
        stage = "putaway"
    else:
        stage = "done"
    return {"stage": stage, "slip_pending": len(waiting), "tasks_open": len(tasks),
            "units_to_put": sum(_left(l) for l in tasks + waiting)}


def _load_out(l: dict, target: str | None = None) -> dict:
    to_put = max(0, int(l["qty"]) - int(l["qty_put"]) - int(l["qty_hold"]))
    return {
        "id": l["id"], "receipt_id": l["receipt_id"], "sku_id": l["sku_id"],
        "sku_name": l.get("name_display"), "bin_code": l["bin_code"],
        "is_extra": bool(l["is_extra"]), "status": l["status"], "qty": int(l["qty"]),
        "qty_put": int(l["qty_put"]), "qty_hold": int(l["qty_hold"]),
        "qty_to_put": to_put if l["status"] in ("batched", "filling", "full") else 0,
        "batch_no": l.get("batch_no"), "label_scanned": bool(l.get("label_scanned_at")),
        "target_location_code": target,
    }


def _line_state(expected, received: int, is_open: bool, no_po: bool) -> str:
    if received == 0:
        return "not_started"
    if no_po and expected is None:
        return "counted"
    e = expected or 0
    if received > e:
        return "extra"
    if received == e:
        return "match"
    return "counting" if is_open else "short"


async def _lines(r: dict) -> list[dict]:
    rows = await db.fetch_all(
        "SELECT rl.*, s.name_display, s.brand_sku_code, "
        "  (SELECT COUNT(*) FROM barcodes b WHERE b.sku_id = rl.sku_id "
        "    AND b.source <> 'test' AND b.barcode NOT LIKE '299%%') AS barcodes "
        "FROM receipt_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.receipt_id = %s ORDER BY s.name_display", (r["id"],))
    loads = await db.fetch_all(
        "SELECT sku_id, bin_code, is_extra, qty_hold FROM inbound_bin_loads "
        "WHERE receipt_id = %s ORDER BY id", (r["id"],))
    bins: dict[int, list[str]] = {}
    extra: dict[int, int] = {}
    for l in loads:
        if l["bin_code"] not in bins.setdefault(l["sku_id"], []):
            bins[l["sku_id"]].append(l["bin_code"])
        extra[l["sku_id"]] = extra.get(l["sku_id"], 0) + int(l["qty_hold"] or 0)
    linked = bool(r.get("replenishment_id"))
    out = []
    for x in rows:
        expected = x["qty_expected"]
        if expected is None and linked:
            expected = 0
        out.append({
            "sku_id": x["sku_id"], "sku_name": x["name_display"],
            "brand_sku_code": x["brand_sku_code"], "has_barcode": int(x["barcodes"]) > 0,
            "qty_expected": expected, "qty_received": int(x["qty_received"]),
            "qty_damaged": int(x.get("qty_damaged") or 0),
            "qty_manual": int(x.get("qty_manual") or 0),
            "qty_extra": extra.get(x["sku_id"], 0),
            "state": _line_state(expected, int(x["qty_received"]), r["status"] == "open",
                                 not linked),
            "bins": bins.get(x["sku_id"], []),
        })
    return out


async def _differences(receipt_id: int) -> list[dict]:
    rows = await db.fetch_all(
        "SELECT d.*, s.name_display, "
        "  (SELECT COUNT(*) FROM inbound_photos p WHERE p.difference_id = d.id) AS photos "
        "FROM inbound_differences d JOIN skus s ON s.id = d.sku_id "
        "WHERE d.receipt_id = %s AND d.qty > 0 ORDER BY d.id", (receipt_id,))
    return [{
        "id": d["id"], "sku_id": d["sku_id"], "sku_name": d["name_display"], "kind": d["kind"],
        "place": d["place"], "bin_code": d.get("bin_code"), "qty": int(d["qty"]),
        "status": d["status"], "decision": d.get("decision"), "photos": int(d["photos"]),
        "decide_by": _ts(d.get("decide_by")),
    } for d in rows]


def _photo_out(p: dict) -> dict:
    return {"id": p["id"], "kind": p["kind"], "difference_id": p.get("difference_id"),
            "uploaded_by": p["uploaded_by"], "uploaded_at": str(p["uploaded_at"]),
            "url": f"/api/inbound/photos/{p['id']}/file"}


async def _target(site_id: int, sku_id: int) -> dict | None:
    """The rack bin a temporary bin goes to: the SKU's pick face (agent S's slot
    registry), or None when the SKU has no rack bin yet (S's *Perlu bin*)."""
    return await common.slot_for(site_id, sku_id)


async def receipt_view(r: dict) -> dict:
    site = await _site(r["site_id"])
    rep = None
    if r.get("replenishment_id"):
        rep = await db.fetch_one("SELECT reference, brand_po_number FROM replenishments "
                                 "WHERE id = %s", (r["replenishment_id"],))
    brand = await db.fetch_one("SELECT name FROM brands WHERE id = %s",
                               (r["brand_id"],)) if r.get("brand_id") else None
    lines = await _lines(r)
    loads = await db.fetch_all(
        "SELECT l.*, s.name_display FROM inbound_bin_loads l JOIN skus s ON s.id = l.sku_id "
        "WHERE l.receipt_id = %s ORDER BY l.id", (r["id"],))
    diffs = await _differences(r["id"])
    photos = await db.fetch_all("SELECT * FROM inbound_photos WHERE receipt_id = %s ORDER BY id",
                                (r["id"],))
    span = await db.fetch_one(
        "SELECT MIN(created_at) AS a, MAX(created_at) AS b FROM inbound_units "
        "WHERE receipt_id = %s", (r["id"],))
    codes = await temp_bin_codes(site)
    occ = await _occupied(site["id"])
    proof = sorted({p["kind"] for p in photos if p["kind"] in PROOF_KINDS})
    blockers = []
    if r["status"] != "open":
        blockers.append("closed")
    for k in PROOF_KINDS:
        if k not in proof:
            blockers.append(f"photo:{k}")
    for d in diffs:
        if d["kind"] == "damaged" and not d["photos"]:
            blockers.append(f"damage_photo:{d['id']}")
    if not any(l["qty_received"] for l in lines):
        blockers.append("nothing_counted")
    expected = [l["qty_expected"] for l in lines if l["qty_expected"] is not None]
    return {
        "id": r["id"], "site_id": r["site_id"], "site_code": site["code"],
        "brand_id": r.get("brand_id"), "brand_name": brand["name"] if brand else None,
        "status": r["status"], "replenishment_id": r.get("replenishment_id"),
        "reference": rep["reference"] if rep else None,
        "brand_po_number": rep["brand_po_number"] if rep else None,
        "no_po": bool(r.get("no_po")), "no_po_code": r.get("no_po_code"),
        "no_po_linked": bool(r.get("no_po_linked_at")),
        "opened_by": r.get("opened_by"), "opened_at": str(r["opened_at"]),
        "first_unit_at": _ts(span["a"]) if span else None,
        "last_unit_at": _ts(span["b"]) if span else None,
        "completed_at": _ts(r.get("completed_at")),
        "sj_cartons": r.get("sj_cartons"), "counted_cartons": r.get("counted_cartons"),
        "carton_state": carton_state(r), "carton_decided_by": r.get("carton_decided_by"),
        "can_scan": _can_scan(r),
        "lines": lines,
        "loads": [_load_out(l) for l in loads],
        "free_bins": len([c for c in codes if c not in occ]), "temp_bins": len(codes),
        "quarantine_tray": await quarantine_tray(site),
        "differences": diffs,
        "photos": [_photo_out(p) for p in photos],
        "proof_done": proof,
        "can_finish": not blockers, "finish_blockers": blockers,
        "decide_by": _ts(r.get("decide_by")),
        "faktur_uploaded_at": _ts(r.get("faktur_uploaded_at")),
        "total_expected": sum(expected) if expected else None,
        "total_received": sum(l["qty_received"] for l in lines),
        **_stage(r, loads),
    }


async def _view(receipt_id: int) -> dict:
    return await receipt_view(await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)))


def _delivery(rp: dict, today, receipt_id=None) -> dict:
    return {
        "replenishment_id": rp["id"], "reference": rp["reference"],
        "brand_po_number": rp.get("brand_po_number"), "brand_id": rp["brand_id"],
        "brand_name": rp["brand_name"], "status": rp["status"],
        "sku_count": int(rp.get("sku_count") or 0), "units": int(rp.get("units") or 0),
        "eta_date": str(rp["eta_date"]) if rp.get("eta_date") else None,
        "arriving_today": bool(rp.get("eta_date") and rp["eta_date"] <= today),
        "receipt_id": receipt_id,
    }


_DELIVERY_SQL = (
    "SELECT rp.*, b.name AS brand_name, "
    "  (SELECT COUNT(*) FROM replenishment_lines rl WHERE rl.replenishment_id = rp.id "
    "     AND rl.qty_confirmed > 0) AS sku_count, "
    "  (SELECT COALESCE(SUM(rl.qty_confirmed), 0) FROM replenishment_lines rl "
    "     WHERE rl.replenishment_id = rp.id) AS units, "
    "  (SELECT ir.id FROM inbound_receipts ir WHERE ir.replenishment_id = rp.id "
    "     AND ir.status = 'open' ORDER BY ir.id DESC LIMIT 1) AS open_receipt_id "
    "FROM replenishments rp JOIN brands b ON b.id = rp.brand_id ")


# --- 1. open the delivery ------------------------------------------------------------

@router.get("/inbound/deliveries", response_model=DeliveryList)
async def deliveries(site_id: int, user: auth.User = Depends(auth.current_user)):
    """*Kiriman hari ini* (board 5a): confirmed deliveries expected today or earlier,
    then the next ones, and receipts still open (no-PO ones too)."""
    await auth.assert_site_access(user, site_id)
    today = daycolor.local_date()
    rows = await db.fetch_all(
        _DELIVERY_SQL + "WHERE rp.site_id = %s AND rp.status IN ('confirmed','receiving') "
        "ORDER BY rp.eta_date IS NULL, rp.eta_date, rp.id", (site_id,))
    items = [_delivery(r, today, r["open_receipt_id"]) for r in rows]
    open_rc = await db.fetch_all(
        "SELECT ir.id, ir.no_po, ir.no_po_code, ir.opened_at, ir.opened_by, b.name AS brand_name, "
        "       rp.reference FROM inbound_receipts ir LEFT JOIN brands b ON b.id = ir.brand_id "
        "LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id "
        "WHERE ir.site_id = %s AND ir.status = 'open' ORDER BY ir.id DESC", (site_id,))
    return {"today": [i for i in items if i["arriving_today"]],
            "next": [i for i in items if not i["arriving_today"]],
            "open_receipts": [dict(o, no_po=bool(o["no_po"]), opened_at=str(o["opened_at"]))
                              for o in open_rc]}


@router.get("/inbound/lookup", response_model=LookupResult)
async def lookup(site_id: int, code: str, user: auth.User = Depends(auth.current_user)):
    """Type or scan the Ninja reference or the brand PO number. No match means
    *PO tidak ditemukan* (board 5i). Several matches (two brands, same PO number):
    the screen asks which brand."""
    await auth.assert_site_access(user, site_id)
    found = await replenishment.find_deliveries(site_id, code)
    today = daycolor.local_date()
    out = []
    for f in found:
        row = await db.fetch_one(_DELIVERY_SQL + "WHERE rp.id = %s", (f["id"],))
        out.append(_delivery(row, today, row["open_receipt_id"]))
    msg = None
    if not out:
        msg = (f"{code.strip()} tidak ada di WMS. Tetap terima, Ops HQ yang mencocokkan. / "
               f"{code.strip()} is not in the WMS. Receive it anyway; Ops HQ will match it.")
    elif all(o["status"] not in replenishment.RECEIVABLE_STATES for o in out):
        # find_deliveries returns received ones only when none is open here.
        refs = ", ".join(o["reference"] for o in out)
        msg = (f"Kiriman ini sudah diterima ({refs}). / "
               f"This delivery was already received ({refs}).")
    return {"code": code.strip(), "matches": out, "found": bool(out), "message": msg}


@router.post("/inbound/receipts", response_model=ReceiptOut, status_code=201)
async def open_receipt(body: OpenIn, user: auth.User = Depends(auth.current_user)):
    """*Buka penerimaan* for a confirmed request (by id, or by a code that matches
    exactly one). Continues the open receipt if someone already started it.
    Cartons may be given here or with /cartons."""
    await auth.assert_site_access(user, body.site_id)
    rep_id = body.replenishment_id
    if not rep_id:
        found = [f for f in await replenishment.find_deliveries(body.site_id, body.code or "")
                 if f["status"] in ("confirmed", "receiving")]
        if not found:
            raise HTTPException(404, "PO tidak ditemukan. / No such delivery.")
        if len(found) > 1:
            raise HTTPException(409, "Nomor ini dipakai lebih dari satu merek: pilih mereknya. / "
                                     "This number matches several brands: choose one.")
        rep_id = found[0]["id"]
    async with db.tx() as cur:
        rep = await db.one(cur, "SELECT * FROM replenishments WHERE id = %s FOR UPDATE",
                           (rep_id,))
        if not rep or rep["site_id"] != body.site_id:
            raise HTTPException(404, "Kiriman tidak ditemukan di dark store ini. / "
                                     "Delivery not found at this dark store.")
        if rep["status"] not in ("confirmed", "receiving"):
            raise HTTPException(409, f"{rep['reference']} belum dikonfirmasi merek atau sudah "
                                     "diterima. / Not confirmed yet, or already received.")
        open_rc = await db.one(cur, "SELECT id FROM inbound_receipts WHERE replenishment_id = %s "
                                    "AND status = 'open' LIMIT 1", (rep_id,))
        if open_rc:
            rid = open_rc["id"]
        else:
            rid = await db.run(
                cur,
                "INSERT INTO inbound_receipts (site_id, brand_id, source_type, opened_by, "
                "replenishment_id, external_reference, batch_no, sj_cartons, counted_cartons) "
                "VALUES (%s,%s,'from_brand',%s,%s,%s,1,%s,%s)",
                (body.site_id, rep["brand_id"], user.email, rep_id, rep["reference"],
                 body.sj_cartons, body.counted_cartons))
            for ln in await db.many(cur, "SELECT sku_id, qty_confirmed FROM replenishment_lines "
                                         "WHERE replenishment_id = %s AND qty_confirmed > 0",
                                    (rep_id,)):
                await db.run(cur, "INSERT INTO receipt_lines (receipt_id, sku_id, qty_expected) "
                                  "VALUES (%s,%s,%s)", (rid, ln["sku_id"], ln["qty_confirmed"]))
            await db.run(cur, "UPDATE replenishments SET status = 'receiving', receipt_id = %s "
                              "WHERE id = %s", (rid, rep_id))
            await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=rid,
                               action="open", after={"replenishment_id": rep_id})
    return await _view(rid)


@router.post("/inbound/receipts/no-po", response_model=ReceiptOut, status_code=201)
async def open_no_po(
    site_id: int = Form(...), brand_id: int = Form(...), code: str = Form(""),
    sj_cartons: int = Form(...), counted_cartons: int | None = Form(None),
    photo: UploadFile = File(...),
    user: auth.User = Depends(auth.current_user),
):
    """*Kirim ke Ops HQ, lalu hitung* (board 5i): the number the WMS does not know,
    a photo of the Surat Jalan, the brand and the cartons. Ops HQ is told at once
    (Perlu tindakan, *Segera*; the Ops Head after 30 minutes). Units are counted
    into temporary bins as usual but are not stock until Ops HQ links it."""
    await auth.assert_site_access(user, site_id)
    brand = await db.fetch_one("SELECT id FROM brands WHERE id = %s", (brand_id,))
    if not brand:
        raise HTTPException(422, "Pilih merek. / Choose the brand.")
    data, ctype, ext = await _read_photo(photo)
    async with db.tx() as cur:
        rid = await db.run(
            cur,
            "INSERT INTO inbound_receipts (site_id, brand_id, source_type, opened_by, "
            "external_reference, batch_no, sj_cartons, counted_cartons, no_po, no_po_code, "
            "no_po_raised_at) VALUES (%s,%s,'from_brand',%s,%s,1,%s,%s,1,%s,NOW())",
            (site_id, brand_id, user.email, (code or "").strip()[:64] or None, sj_cartons,
             counted_cartons if counted_cartons is not None else sj_cartons,
             (code or "").strip()[:64] or None))
        await _store_photo(cur, rid, site_id, "sj_no_po", None, data, ctype, ext, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=rid,
                           action="open_no_po", after={"code": code, "brand_id": brand_id})
    return await _view(rid)


@router.post("/inbound/receipts/{receipt_id}/cartons", response_model=ReceiptOut)
async def cartons(receipt_id: int, body: CartonsIn, user: auth.User = Depends(auth.current_user)):
    """*Karton dihitung*: a door check only, never stock. A count different from the
    Surat Jalan waits for the SPV's decision before scanning starts."""
    r = await _receipt(receipt_id, user)
    if r["status"] != "open":
        raise HTTPException(409, "Penerimaan sudah ditutup. / The receipt is closed.")
    if r.get("carton_decision"):
        raise HTTPException(409, "SPV sudah memutuskan jumlah karton. / "
                                 "The SPV already decided the cartons.")
    await db.execute("UPDATE inbound_receipts SET sj_cartons = %s, counted_cartons = %s "
                     "WHERE id = %s", (body.sj_cartons, body.counted_cartons, receipt_id))
    return await _view(receipt_id)


@router.post("/inbound/receipts/{receipt_id}/carton-decision", response_model=ReceiptOut)
async def carton_decision(receipt_id: int, body: CartonDecisionIn,
                          user: auth.User = Depends(auth.require("supervisor"))):
    """*Keputusan SPV*: *Terima & tulis ulang* (raised to Ops HQ at once: it shows
    on Ops HQ's Perlu tindakan until seen) or *Tolak* (the delivery is refused;
    the request stays confirmed for the brand's next attempt)."""
    r = await _receipt(receipt_id, user)
    decision = (body.decision or "").strip().lower()
    if decision not in ("accept_rewrite", "refuse"):
        raise HTTPException(422, "Pilih Terima & tulis ulang atau Tolak. / "
                                 "Choose accept and rewrite, or refuse.")
    if r["status"] != "open" or carton_state(r) != "waiting_spv":
        raise HTTPException(409, "Tidak ada selisih karton yang menunggu SPV. / "
                                 "No carton difference is waiting for the SPV.")
    if decision == "refuse":
        n = await db.fetch_one("SELECT COUNT(*) AS n FROM inbound_units WHERE receipt_id = %s",
                               (receipt_id,))
        if int(n["n"]):
            raise HTTPException(409, "Unit sudah dipindai: tidak bisa ditolak lagi. / "
                                     "Units were already scanned.")
    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE inbound_receipts SET carton_decision = %s, carton_decided_by = %s, "
            "carton_decided_at = NOW()" + (", status = 'refused', completed_at = NOW()"
                                           if decision == "refuse" else "") +
            " WHERE id = %s", (decision, user.email, receipt_id))
        if decision == "refuse" and r.get("replenishment_id"):
            await db.run(cur, "UPDATE replenishments SET status = 'confirmed', receipt_id = NULL "
                              "WHERE id = %s AND status = 'receiving'", (r["replenishment_id"],))
        await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=receipt_id,
                           action="carton_" + decision,
                           after={"sj": r.get("sj_cartons"), "counted": r.get("counted_cartons")})
    return await _view(receipt_id)


@router.post("/inbound/receipts/{receipt_id}/carton-seen", response_model=ReceiptOut)
async def carton_seen(receipt_id: int, user: auth.User = Depends(auth.require("hq"))):
    """Ops HQ has seen a rewritten Surat Jalan: it leaves Perlu tindakan."""
    await _receipt(receipt_id, user)
    await db.execute("UPDATE inbound_receipts SET carton_seen_by = %s, carton_seen_at = NOW() "
                     "WHERE id = %s AND carton_decision = 'accept_rewrite'",
                     (user.email, receipt_id))
    return await _view(receipt_id)


@router.get("/inbound/receipts/{receipt_id}", response_model=ReceiptOut)
async def get_receipt(receipt_id: int, user: auth.User = Depends(auth.current_user)):
    """Everything the scan, summary and laptop receipt screens show (5b to 5h)."""
    return await receipt_view(await _receipt(receipt_id, user))


@router.get("/inbound/receipts")
async def list_receipts(
    site_id: int,
    status: str = Query(default="all", pattern="^(all|open|completed|refused|needs_faktur)$"),
    limit: int = Query(default=50, ge=1, le=200),
    user: auth.User = Depends(auth.current_user),
):
    """Receipts at a hub, newest first. `needs_faktur`: finished brand deliveries
    whose signed Faktur is not uploaded yet."""
    await auth.assert_site_access(user, site_id)
    where, params = ["ir.site_id = %s"], [site_id]
    if status == "needs_faktur":
        where.append("ir.source_type = 'from_brand' AND ir.status = 'completed' "
                     "AND ir.faktur_uploaded_at IS NULL")
    elif status != "all":
        where.append("ir.status = %s")
        params.append(status)
    rows = await db.fetch_all(
        "SELECT ir.id, ir.status, ir.opened_at, ir.opened_by, ir.completed_at, ir.no_po, "
        "       ir.no_po_code, ir.faktur_uploaded_at, ir.decide_by, rp.reference, "
        "       rp.brand_po_number, b.name AS brand_name, "
        "       (SELECT COALESCE(SUM(rl.qty_received), 0) FROM receipt_lines rl "
        "         WHERE rl.receipt_id = ir.id) AS units, "
        "       (SELECT COUNT(*) FROM inbound_differences d WHERE d.receipt_id = ir.id "
        "         AND d.status = 'pending' AND d.qty > 0) AS pending_differences, "
        "       ir.replenishment_id, "
        "       (SELECT COUNT(*) FROM inbound_bin_loads x WHERE x.receipt_id = ir.id "
        "         AND x.status = 'batched' AND x.qty - x.qty_put - x.qty_hold > 0) AS tasks_open, "
        "       (SELECT COUNT(*) FROM inbound_bin_loads x WHERE x.receipt_id = ir.id "
        "         AND x.status IN ('filling','full') AND x.is_extra = 0 "
        "         AND x.qty - x.qty_put - x.qty_hold > 0) AS slip_bins "
        "FROM inbound_receipts ir LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id "
        "LEFT JOIN brands b ON b.id = ir.brand_id WHERE " + " AND ".join(where) +
        " ORDER BY ir.opened_at DESC, ir.id DESC LIMIT %s", (*params, limit))
    return {"receipts": [{
        "id": r["id"], "status": r["status"], "reference": r["reference"],
        "brand_po_number": r["brand_po_number"], "brand_name": r["brand_name"],
        "no_po": bool(r["no_po"]), "no_po_code": r["no_po_code"],
        "opened_at": _ts(r["opened_at"]), "opened_by": r["opened_by"],
        "completed_at": _ts(r["completed_at"]), "units": int(r["units"] or 0),
        "faktur_uploaded_at": _ts(r["faktur_uploaded_at"]), "decide_by": _ts(r["decide_by"]),
        "pending_differences": int(r["pending_differences"] or 0),
        **_list_stage(r),
    } for r in rows]}


def _list_stage(r: dict) -> dict:
    """The same stage as _stage, from list_receipts' counts."""
    tasks = int(r["tasks_open"] or 0)
    slip = int(r["slip_bins"] or 0) if (r["status"] == "completed" and not _unlinked(r)) else 0
    stage = ("refused" if r["status"] == "refused" else "scan" if r["status"] == "open"
             else "print" if slip else "putaway" if tasks else "done")
    return {"stage": stage, "tasks_open": tasks, "slip_pending": slip}


# --- 2. count every unit into temporary bins -----------------------------------------

async def _allocate_bin(cur, site: dict) -> str | None:
    """The first free temporary bin, with the site row locked so two phones never
    get the same one."""
    await db.one(cur, "SELECT id FROM sites WHERE id = %s FOR UPDATE", (site["id"],))
    free = await _free_bins(site, cur)
    return free[0] if free else None


@router.post("/inbound/receipts/{receipt_id}/units", response_model=UnitResult)
async def count_unit(receipt_id: int, body: UnitIn, user: auth.User = Depends(auth.current_user)):
    """One unit: a scanned barcode, or a product picked from the list (no barcode).
    Never an error for a floor problem: the outcome says what to do.

      counted     into the product's bin
      new_bin     first unit of the product: take the bin named, scan its label
      extra_bin   above the expected quantity: its own bin, waits for Ops HQ
      damaged     *Rusak* on: to the quarantine tray or back to the driver;
                  take a photo (photo_needed) with /photos kind=damage
      no_free_bin every temporary bin is taken: the SPV adds one (Tambah bin sementara)
    """
    replayed = await ledger.replay(body.idempotency_key, "inbound_unit")
    if replayed:
        return replayed
    r = await _receipt(receipt_id, user)
    site = await _site(r["site_id"])
    free_now = len(await _free_bins(site))

    def no(outcome, msg, **kw):
        return dict({"accepted": False, "outcome": outcome, "message": msg,
                     "free_bins": free_now}, **kw)

    if r["status"] != "open":
        raise HTTPException(409, "Penerimaan sudah ditutup. / The receipt is closed.")
    if not _can_scan(r):
        return no("carton_check", "Cek karton dulu: jumlah karton beda menunggu keputusan SPV. / "
                                  "Check the cartons first; a difference waits for the SPV.")
    method = "scan"
    if body.sku_id:
        sku = await common.sku_by_id(body.sku_id)
        method = "manual"
    else:
        code = (body.code or "").strip()
        if not code:
            raise HTTPException(422, "Pindai barcode atau pilih produk. / Scan or pick a product.")
        sku = await common.sku_by_barcode(code)
        if not sku:
            return no("unknown_barcode", "Barcode tidak dikenal. Pilih dari daftar kalau produknya "
                                         "tanpa barcode, atau panggil SPV. / Unknown barcode.")
    if not sku:
        raise HTTPException(404, "Produk tidak ditemukan. / Product not found.")
    if r.get("brand_id") and sku["brand_id"] != r["brand_id"]:
        return no("wrong_brand", f"{sku['name_display']} bukan dari merek kiriman ini. Sisihkan, "
                                 "panggil SPV. / Not from this delivery's brand.",
                  sku=common.sku_dict(sku))
    damage_to = (body.damage_to or "").strip().lower() or None
    if body.damaged and damage_to not in DAMAGE_TO:
        return no("needs_damage_place", "Unit rusak ini mau ke mana: karantina atau kembali ke "
                                        "driver? / Quarantine or back to the driver?",
                  sku=common.sku_dict(sku))
    tray = await quarantine_tray(site)
    linked = bool(r.get("replenishment_id"))

    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE",
                     (receipt_id,))
        line = await db.one(cur, "SELECT * FROM receipt_lines WHERE receipt_id = %s "
                                 "AND sku_id = %s", (receipt_id, sku["id"]))
        if not line:
            await db.run(cur, "INSERT INTO receipt_lines (receipt_id, sku_id, qty_expected) "
                              "VALUES (%s,%s,%s)", (receipt_id, sku["id"], 0 if linked else None))
            line = await db.one(cur, "SELECT * FROM receipt_lines WHERE receipt_id = %s "
                                     "AND sku_id = %s", (receipt_id, sku["id"]))
        result: dict = {"accepted": True, "sku": common.sku_dict(sku)}
        load = None
        diff_id = None
        if body.damaged:
            place = damage_to
            await db.run(
                cur,
                "INSERT INTO inbound_differences (receipt_id, replenishment_id, site_id, sku_id, "
                "kind, place, bin_code, qty, created_by) VALUES (%s,%s,%s,%s,'damaged',%s,%s,1,%s) "
                "ON DUPLICATE KEY UPDATE qty = qty + 1",
                (receipt_id, r.get("replenishment_id"), r["site_id"], sku["id"], place,
                 tray if place == "quarantine" else None, user.email))
            d = await db.one(cur, "SELECT id FROM inbound_differences WHERE receipt_id = %s AND "
                                  "sku_id = %s AND kind = 'damaged' AND place = %s",
                             (receipt_id, sku["id"], place))
            diff_id = d["id"]
            photos = await db.one(cur, "SELECT COUNT(*) AS n FROM inbound_photos "
                                       "WHERE difference_id = %s", (diff_id,))
            result.update(outcome="damaged", difference_id=diff_id,
                          photo_needed=not int(photos["n"]),
                          message=(f"Rusak: taruh di baki {tray}. Jangan ke rak. / Damaged: put it "
                                   f"in the tray {tray}." if place == "quarantine" else
                                   "Rusak: kembalikan ke driver, tulis di Surat Jalan: ditolak, "
                                   "rusak. / Damaged: back to the driver, write it on the SJ."))
        else:
            expected = line["qty_expected"]
            is_extra = linked and int(line["qty_received"]) >= int(expected or 0)
            load = await db.one(
                cur, "SELECT * FROM inbound_bin_loads WHERE receipt_id = %s AND sku_id = %s "
                     "AND is_extra = %s AND status = 'filling' ORDER BY id DESC LIMIT 1 FOR UPDATE",
                (receipt_id, sku["id"], 1 if is_extra else 0))
            outcome = "counted"
            if not load:
                bin_code = await _allocate_bin(cur, site)
                if not bin_code:
                    return no("no_free_bin", "Semua bin sementara terisi. Panggil SPV untuk tambah "
                                             "bin sementara. / Every temporary bin is taken. Ask the "
                                             "SPV to add a temporary bin.", sku=common.sku_dict(sku))
                lid = await db.run(
                    cur,
                    "INSERT INTO inbound_bin_loads (site_id, receipt_id, sku_id, bin_code, "
                    "is_extra, status, opened_by) VALUES (%s,%s,%s,%s,%s,'filling',%s)",
                    (r["site_id"], receipt_id, sku["id"], bin_code, 1 if is_extra else 0,
                     user.email))
                load = await db.one(cur, "SELECT * FROM inbound_bin_loads WHERE id = %s", (lid,))
                outcome = "extra_bin" if is_extra else "new_bin"
            await db.run(cur, "UPDATE inbound_bin_loads SET qty = qty + 1, qty_hold = qty_hold + %s "
                              "WHERE id = %s", (1 if load["is_extra"] else 0, load["id"]))
            load = await db.one(cur, "SELECT l.*, s.name_display FROM inbound_bin_loads l "
                                     "JOIN skus s ON s.id = l.sku_id WHERE l.id = %s",
                                (load["id"],))
            msgs = {
                "new_bin": (f"Produk baru: ambil bin kosong, pindai labelnya. {load['bin_code']} "
                            f"untuk {sku['name_display']}. / New product: take {load['bin_code']}, "
                            "scan its label."),
                "extra_bin": (f"Lebih dari yang diharapkan: taruh di {load['bin_code']}, tunggu "
                              f"Ops HQ. / Above the expected quantity: {load['bin_code']}, waits "
                              "for Ops HQ."),
                "counted": f"Masukkan ke {load['bin_code']}. / Into {load['bin_code']}.",
            }
            result.update(outcome=outcome, message=msgs[outcome],
                          needs_bin_label=not load.get("label_scanned_at"))
        await db.run(
            cur,
            "UPDATE receipt_lines SET qty_received = qty_received + 1, "
            "qty_damaged = qty_damaged + %s, qty_manual = qty_manual + %s "
            "WHERE receipt_id = %s AND sku_id = %s",
            (1 if body.damaged else 0, 1 if method == "manual" else 0, receipt_id, sku["id"]))
        await db.run(
            cur,
            "INSERT INTO inbound_units (receipt_id, site_id, sku_id, load_id, difference_id, qty, "
            "method, damaged, damage_to, code, actor_email) VALUES (%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s)",
            (receipt_id, r["site_id"], sku["id"], load["id"] if load else None, diff_id, method,
             1 if body.damaged else 0, damage_to if body.damaged else None,
             (body.code or "").strip()[:64] or None, user.email))
        tot = await db.one(cur, "SELECT COALESCE(SUM(qty_received), 0) AS n FROM receipt_lines "
                                "WHERE receipt_id = %s", (receipt_id,))
        result["total_received"] = int(tot["n"])
        if load:
            result["load"] = _load_out(load)
        result["free_bins"] = len(await _free_bins(site, cur))
        fresh = dict(r, status="open")
        lines = {x["sku_id"]: x for x in await _lines_cur(cur, fresh)}
        result["line"] = lines.get(sku["id"])
        await ledger.remember(cur, body.idempotency_key, "inbound_unit", result)
    return result


async def _lines_cur(cur, r: dict) -> list[dict]:
    """_lines inside a transaction (reads its own writes)."""
    rows = await db.many(
        cur, "SELECT rl.*, s.name_display, s.brand_sku_code FROM receipt_lines rl "
             "JOIN skus s ON s.id = rl.sku_id WHERE rl.receipt_id = %s", (r["id"],))
    loads = await db.many(cur, "SELECT sku_id, bin_code, qty_hold FROM inbound_bin_loads "
                               "WHERE receipt_id = %s ORDER BY id", (r["id"],))
    linked = bool(r.get("replenishment_id"))
    out = []
    for x in rows:
        mine = [l for l in loads if l["sku_id"] == x["sku_id"]]
        expected = x["qty_expected"] if x["qty_expected"] is not None else (0 if linked else None)
        out.append({
            "sku_id": x["sku_id"], "sku_name": x["name_display"],
            "brand_sku_code": x["brand_sku_code"], "qty_expected": expected,
            "qty_received": int(x["qty_received"]), "qty_damaged": int(x["qty_damaged"] or 0),
            "qty_manual": int(x["qty_manual"] or 0),
            "qty_extra": sum(int(l["qty_hold"] or 0) for l in mine),
            "state": _line_state(expected, int(x["qty_received"]), True, not linked),
            "bins": list(dict.fromkeys(l["bin_code"] for l in mine)),
        })
    return out


@router.post("/inbound/receipts/{receipt_id}/units/undo", response_model=UnitResult)
async def undo_unit(receipt_id: int, body: UndoIn, user: auth.User = Depends(auth.current_user)):
    """Take back your own last unit (a double scan; *-1* on the list pick), while its
    bin has not gone into a batch."""
    replayed = await ledger.replay(body.idempotency_key, "inbound_undo")
    if replayed:
        return replayed
    r = await _receipt(receipt_id, user)
    if r["status"] != "open":
        raise HTTPException(409, "Penerimaan sudah ditutup. / The receipt is closed.")
    site = await _site(r["site_id"])
    where = ["u.receipt_id = %s", "u.actor_email = %s", "u.qty = 1"]
    params: list = [receipt_id, user.email]
    if body.sku_id:
        where.append("u.sku_id = %s")
        params.append(body.sku_id)
    if body.manual_only:
        where.append("u.method = 'manual'")
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE",
                     (receipt_id,))
        last = await db.one(
            cur, "SELECT u.* FROM inbound_units u WHERE " + " AND ".join(where) +
                 " AND NOT EXISTS (SELECT 1 FROM inbound_units x WHERE x.undo_of = u.id) "
                 "ORDER BY u.id DESC LIMIT 1", params)
        if not last:
            raise HTTPException(409, "Tidak ada unit untuk dibatalkan. / Nothing to undo.")
        if last["load_id"]:
            load = await db.one(cur, "SELECT * FROM inbound_bin_loads WHERE id = %s FOR UPDATE",
                                (last["load_id"],))
            if load["status"] not in ("filling", "full"):
                raise HTTPException(409, "Bin ini sudah masuk batch: tidak bisa dibatalkan. / "
                                         "This bin is already in a batch.")
            await db.run(
                cur, "UPDATE inbound_bin_loads SET qty = qty - 1, "
                     "qty_hold = GREATEST(0, qty_hold - %s), "
                     "status = IF(qty = 0, 'done', status), done_at = IF(qty = 0, NOW(), done_at) "
                     "WHERE id = %s", (1 if load["is_extra"] else 0, load["id"]))
        if last["difference_id"]:
            await db.run(cur, "UPDATE inbound_differences SET qty = GREATEST(0, qty - 1) "
                              "WHERE id = %s", (last["difference_id"],))
        await db.run(
            cur,
            "UPDATE receipt_lines SET qty_received = GREATEST(0, qty_received - 1), "
            "qty_damaged = GREATEST(0, qty_damaged - %s), qty_manual = GREATEST(0, qty_manual - %s) "
            "WHERE receipt_id = %s AND sku_id = %s",
            (last["damaged"], 1 if last["method"] == "manual" else 0, receipt_id, last["sku_id"]))
        await db.run(
            cur,
            "INSERT INTO inbound_units (receipt_id, site_id, sku_id, load_id, difference_id, qty, "
            "method, damaged, damage_to, undo_of, actor_email) "
            "VALUES (%s,%s,%s,%s,%s,-1,%s,%s,%s,%s,%s)",
            (receipt_id, r["site_id"], last["sku_id"], last["load_id"], last["difference_id"],
             last["method"], last["damaged"], last["damage_to"], last["id"], user.email))
        tot = await db.one(cur, "SELECT COALESCE(SUM(qty_received), 0) AS n FROM receipt_lines "
                                "WHERE receipt_id = %s", (receipt_id,))
        lines = {x["sku_id"]: x for x in await _lines_cur(cur, r)}
        result = {"accepted": True, "outcome": "counted",
                  "message": "Satu unit dibatalkan. / One unit taken back.",
                  "sku": common.sku_dict(await common.sku_by_id(last["sku_id"])),
                  "line": lines.get(last["sku_id"]), "total_received": int(tot["n"]),
                  "free_bins": len(await _free_bins(site, cur))}
        await ledger.remember(cur, body.idempotency_key, "inbound_undo", result)
    return result


async def _load(load_id: int, user: auth.User) -> dict:
    l = await db.fetch_one("SELECT l.*, s.name_display FROM inbound_bin_loads l "
                           "JOIN skus s ON s.id = l.sku_id WHERE l.id = %s", (load_id,))
    if not l:
        raise HTTPException(404, "Bin sementara tidak ditemukan. / Temporary bin not found.")
    await auth.assert_site_access(user, l["site_id"])
    return l


@router.post("/inbound/loads/{load_id}/bin-label", response_model=LoadOut)
async def scan_bin_label(load_id: int, body: BinLabelIn,
                         user: auth.User = Depends(auth.current_user)):
    """The temporary bin's label, scanned once per product (*pindai labelnya*)."""
    l = await _load(load_id, user)
    if not _same_code(body.code, l["bin_code"]):
        raise HTTPException(409, f"Label salah: ambil {l['bin_code']}. / "
                                 f"Wrong label: take {l['bin_code']}.")
    await db.execute("UPDATE inbound_bin_loads SET label_scanned_at = NOW(), label_scanned_by = %s "
                     "WHERE id = %s", (user.email, load_id))
    return _load_out(await _load(load_id, user))


@router.post("/inbound/loads/{load_id}/full", response_model=LoadOut)
async def bin_full(load_id: int, user: auth.User = Depends(auth.current_user)):
    """*Bin penuh* at receiving: the next unit of this product opens the next free bin."""
    l = await _load(load_id, user)
    if l["status"] != "filling":
        raise HTTPException(409, "Bin ini tidak sedang diisi. / This bin is not being filled.")
    await db.execute("UPDATE inbound_bin_loads SET status = 'full', full_at = NOW() WHERE id = %s",
                     (load_id,))
    return _load_out(await _load(load_id, user))


@router.get("/inbound/temp-bins", response_model=TempBinList)
async def temp_bins(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Every temporary inbound bin of the hub and what is in it."""
    site = await auth.assert_site_access(user, site_id)
    site = await _site(site["id"])
    occ = await _occupied(site_id)
    codes = await temp_bin_codes(site)
    bins = [{"code": c, "occupied": c in occ,
             "sku_name": occ[c]["name_display"] if c in occ else None,
             "receipt_id": occ[c]["receipt_id"] if c in occ else None,
             "status": occ[c]["status"] if c in occ else None,
             "qty": int(occ[c]["qty"]) - int(occ[c]["qty_put"]) if c in occ else None}
            for c in codes]
    return {"site_id": site_id, "bins": bins, "quarantine_tray": await quarantine_tray(site),
            "free": sum(1 for b in bins if not b["occupied"])}


@router.post("/inbound/temp-bins", response_model=TempBinList, status_code=201)
async def add_temp_bin(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """*Tambah bin sementara* (SPV, any time). Uses agent S's
    locations.add_special_bin when it exists, else raises sites.inbound_bins."""
    site = await auth.assert_site_access(user, site_id)
    site = await _site(site["id"])
    from routers import locations
    helper = getattr(locations, "add_special_bin", None)
    async with db.tx() as cur:
        if helper:
            made = await helper(cur, site_id, "IN", user.email)
        else:
            n = len(await temp_bin_codes(site))
            await db.run(cur, "UPDATE sites SET inbound_bins = %s WHERE id = %s", (n + 1, site_id))
            made = {"code": f"{replenishment.hub_code(site['code'])}-IN-{n + 1:02d}"}
        await ledger.audit(cur, actor_email=user.email, entity="site", entity_id=site_id,
                           action="add_temp_bin", after=made)
    return await temp_bins(site_id, user)


# --- 3. putaway slips and putaway tasks ------------------------------------------------

async def _close_batch(cur, r: dict) -> int | None:
    """The putaway slips are printed (*Sudah dicetak*): every bin of the receipt
    still filling or full becomes a putaway task (batched). Extra bins, and every
    bin of a no-PO delivery not linked yet, wait for Ops HQ instead (held)."""
    loads = await db.many(cur, "SELECT * FROM inbound_bin_loads WHERE receipt_id = %s "
                               "AND status IN ('filling','full') FOR UPDATE", (r["id"],))
    if not loads:
        return None
    nb = await db.one(cur, "SELECT COALESCE(MAX(batch_no), 0) AS n FROM inbound_bin_loads "
                           "WHERE receipt_id = %s", (r["id"],))
    batch = int(nb["n"]) + 1
    unlinked = bool(r.get("no_po")) and not r.get("replenishment_id")
    for l in loads:
        if int(l["qty"]) == 0:
            status = "done"
        elif l["is_extra"] or unlinked or int(l["qty"]) - int(l["qty_hold"]) <= 0:
            status = "held"
        else:
            status = "batched"
        await db.run(cur, "UPDATE inbound_bin_loads SET status = %s, batch_no = %s, "
                          "batched_at = NOW() WHERE id = %s", (status, batch, l["id"]))
    return batch


@router.post("/inbound/receipts/{receipt_id}/batch", response_model=PutawayList)
async def close_batch(receipt_id: int, user: auth.User = Depends(auth.current_user)):
    """The old *Selesai batch ini* (putaway in the middle of scanning). The screen no
    longer offers it since 7 Oct; kept so an old open tab does not fail."""
    r = await _receipt(receipt_id, user)
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE",
                     (receipt_id,))
        await _close_batch(cur, r)
    return await putaway_list(r["site_id"], receipt_id, user)


@router.post("/inbound/receipts/{receipt_id}/slips-printed", response_model=PutawayList)
async def slips_printed(receipt_id: int, user: auth.User = Depends(auth.current_user)):
    """*Sudah dicetak*: the putaway slips of a finished receipt are on paper, so
    every temporary bin becomes its own putaway task (*Taruh di rak*, also on
    Perlu tindakan). Anyone receiving may confirm it. Pressing it again changes
    nothing."""
    r = await _receipt(receipt_id, user)
    if r["status"] != "completed":
        raise HTTPException(409, "Selesaikan penerimaan dulu. / Finish the receipt first.")
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE",
                     (receipt_id,))
        batch = await _close_batch(cur, r)
        if batch:
            await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=receipt_id,
                               action="slips_printed", after={"batch_no": batch})
    return await putaway_list(r["site_id"], receipt_id, user)


def _short_code(code: str | None, site_code: str) -> str | None:
    """A-2-03 from MA5-A-2-03: the label as staff read it."""
    if not code:
        return None
    for p in (site_code + "-", replenishment.hub_code(site_code) + "-"):
        if code.upper().startswith(p.upper()):
            return code[len(p):]
    return code


@router.get("/inbound/putaway", response_model=PutawayList)
async def putaway_list(site_id: int, receipt_id: int | None = None,
                       user: auth.User = Depends(auth.current_user)):
    """*Taruh di rak*: the putaway tasks, one per temporary bin, with its product,
    units and rack bin, in walking order; bins waiting for Ops HQ listed apart
    with no rack bin (*Tunggu Ops HQ*). Accepted extras show here too. Without
    receipt_id: every task at the hub (Barang masuk's list)."""
    site = await auth.assert_site_access(user, site_id)
    site = await _site(site["id"])
    where, params = ["l.site_id = %s"], [site_id]
    if receipt_id:
        where.append("l.receipt_id = %s")
        params.append(receipt_id)
    rows = await db.fetch_all(
        "SELECT l.*, s.name_display, COALESCE(rp.reference, ir.no_po_code) AS reference "
        "FROM inbound_bin_loads l JOIN skus s ON s.id = l.sku_id "
        "LEFT JOIN inbound_receipts ir ON ir.id = l.receipt_id "
        "LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id "
        "WHERE " + " AND ".join(where) + " AND l.status IN ('batched','held','return') "
        "ORDER BY l.id", params)
    items, held = [], []
    for l in rows:
        if l["status"] == "batched" and int(l["qty"]) - int(l["qty_put"]) - int(l["qty_hold"]) > 0:
            t = await _target(site_id, l["sku_id"])
            items.append(({
                "load": _load_out(l, t["location_code"] if t else None),
                "sku_name": l["name_display"], "reference": l["reference"],
                "to_location_code": t["location_code"] if t else None,
                "to_location_label": _short_code(t["location_code"], site["code"]) if t else None,
            }, (t["rack_code"], t["level_no"], t["location_code"]) if t else ("~", 0, "")))
        if l["status"] in ("held", "return") or int(l["qty_hold"]) > 0:
            held.append({"load": _load_out(l), "sku_name": l["name_display"],
                         "reference": l["reference"],
                         "waiting_ops_hq": l["status"] != "return",
                         "returning": l["status"] == "return"})
    items.sort(key=lambda x: x[1])
    colour = daycolor.for_moment()
    name = COLOUR_NAME.get(colour["key"], ("", ""))
    codes = await temp_bin_codes(site)
    occ = await _occupied(site_id)
    batch = max([x[0]["load"]["batch_no"] or 0 for x in items] or [0]) or None
    return {"site_id": site_id, "items": [x[0] for x in items], "held": held,
            "divider": dict(colour, colour_id=name[0], colour_en=name[1],
                            written=daycolor.local_date().strftime("%d/%m")),
            "free_bins": len([c for c in codes if c not in occ]), "temp_bins": len(codes),
            "batch_no": batch}


async def _location(site_id: int, code: str) -> dict | None:
    code = (code or "").strip()
    return await db.fetch_one(
        "SELECT l.id, l.code FROM locations l WHERE l.site_id = %s AND (UPPER(l.code) = UPPER(%s) "
        "OR UPPER(l.code) LIKE UPPER(CONCAT('%%-', %s))) ORDER BY (UPPER(l.code) = UPPER(%s)) DESC "
        "LIMIT 1", (site_id, code, code, code))


async def _sku_locations(site_id: int, sku_id: int) -> list[dict]:
    return await common.pick_locations_for(site_id, sku_id)


@router.post("/inbound/loads/{load_id}/putaway", response_model=PutawayResult)
async def put_away(load_id: int, body: PutawayIn, user: auth.User = Depends(auth.current_user)):
    """*Pindai label bin* at the rack: the units become stock in that bin, sellable,
    and the new stock goes to Hiryu (ledger receipt_in, the pos_outbox path).
    The rack bin must be one of the product's bins at this hub."""
    replayed = await ledger.replay(body.idempotency_key, "inbound_putaway")
    if replayed:
        return replayed
    l = await _load(load_id, user)
    if l["status"] != "batched":
        raise HTTPException(409, "Bin ini belum siap ditaruh: cetak slip putaway dulu, atau tunggu "
                                 "Ops HQ. / This bin is not ready to put away: print the putaway "
                                 "slips first, or wait for Ops HQ.")
    site = await _site(l["site_id"])
    loc = await _location(l["site_id"], body.location_code)
    allowed = {x["location_id"] for x in await _sku_locations(l["site_id"], l["sku_id"])}
    target = await _target(l["site_id"], l["sku_id"])
    if not loc or loc["id"] not in allowed:
        want = _short_code(target["location_code"], site["code"]) if target else None
        raise HTTPException(409, f"Bin salah. {l['name_display']} ke {want or 'bin rak (minta SPV)'}. "
                                 f"/ Wrong bin" + (f": this goes to {want}." if want else "."))
    async with db.tx() as cur:
        cur_l = await db.one(cur, "SELECT * FROM inbound_bin_loads WHERE id = %s FOR UPDATE",
                             (load_id,))
        left = int(cur_l["qty"]) - int(cur_l["qty_put"]) - int(cur_l["qty_hold"])
        qty = body.qty or left
        if cur_l["status"] != "batched" or left <= 0:
            raise HTTPException(409, "Bin ini sudah ditaruh. / Already put away.")
        if qty > left:
            raise HTTPException(422, f"Hanya {left} unit tersisa di {cur_l['bin_code']}. / "
                                     f"Only {left} units left.")
        mv = await ledger.apply(
            cur, site_id=l["site_id"], sku_id=l["sku_id"], location_id=loc["id"], qty_delta=qty,
            movement_type="receipt_in", actor_email=user.email, ref_type="receipt",
            ref_id=l["receipt_id"], reason_code=f"putaway:{load_id}",
            is_training=bool(site["is_training"]))
        await db.run(
            cur,
            "INSERT INTO inbound_putaways (load_id, receipt_id, site_id, sku_id, location_id, "
            "location_code, qty, movement_id, day_color_key, actor_email) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (load_id, l["receipt_id"], l["site_id"], l["sku_id"], loc["id"], loc["code"], qty, mv,
             daycolor.for_moment()["key"], user.email))
        await db.run(cur, "UPDATE inbound_bin_loads SET qty_put = qty_put + %s WHERE id = %s",
                     (qty, load_id))
        await _settle_load(cur, load_id, user.email)
        await db.run(cur, "UPDATE receipt_lines SET location_id = %s WHERE receipt_id = %s "
                          "AND sku_id = %s", (loc["id"], l["receipt_id"], l["sku_id"]))
        after = await db.one(cur, "SELECT l.*, s.name_display FROM inbound_bin_loads l "
                                  "JOIN skus s ON s.id = l.sku_id WHERE l.id = %s", (load_id,))
        remaining = int(after["qty"]) - int(after["qty_put"]) - int(after["qty_hold"])
        result = {
            "ok": True, "put": qty, "remaining": remaining, "load": _load_out(after),
            "location_code": loc["code"],
            "message": (f"{qty} unit di {_short_code(loc['code'], site['code'])}: bisa dijual, stok "
                        f"baru dikirim ke Hiryu. / {qty} units in {loc['code']}: sellable, sent to "
                        "Hiryu."),
        }
        await ledger.remember(cur, body.idempotency_key, "inbound_putaway", result)
    return result


async def _settle_load(cur, load_id: int, actor: str) -> None:
    """After a putaway or a decision: an emptied bin is done (free again); a bin with
    only held units left waits (held) or goes back to the brand (return)."""
    l = await db.one(cur, "SELECT * FROM inbound_bin_loads WHERE id = %s", (load_id,))
    left = int(l["qty"]) - int(l["qty_put"])
    if left <= 0:
        await db.run(cur, "UPDATE inbound_bin_loads SET status = 'done', done_at = NOW(), "
                          "done_by = %s WHERE id = %s", (actor, load_id))
    elif left <= int(l["qty_hold"]) and l["status"] == "batched":
        rejected = await db.one(
            cur, "SELECT 1 AS x FROM inbound_differences WHERE receipt_id = %s AND sku_id = %s "
                 "AND kind = 'extra' AND status = 'approved' AND decision = 'reject'",
            (l["receipt_id"], l["sku_id"]))
        await db.run(cur, "UPDATE inbound_bin_loads SET status = %s WHERE id = %s",
                     ("return" if rejected else "held", load_id))


@router.post("/inbound/loads/{load_id}/rack-full")
async def rack_full(load_id: int, body: RackFullIn, user: auth.User = Depends(auth.current_user)):
    """*Bin penuh* at the rack: the product's next bin at this hub (its overflow or
    another of its bins). None: the SPV gives it one (Rak & bin, *Perlu bin*)."""
    l = await _load(load_id, user)
    site = await _site(l["site_id"])
    full = await _location(l["site_id"], body.location_code) if body.location_code else None
    target = await _target(l["site_id"], l["sku_id"])
    skip = {full["id"]} if full else ({target["location_id"]} if target else set())
    for x in await _sku_locations(l["site_id"], l["sku_id"]):
        if x["location_id"] not in skip:
            return {"location_code": x["location_code"],
                    "location_label": _short_code(x["location_code"], site["code"]),
                    "message": f"Taruh sisanya di {_short_code(x['location_code'], site['code'])}. / "
                               f"Put the rest in {x['location_code']}."}
    raise HTTPException(409, "Produk ini tidak punya bin lain. Panggil SPV untuk memberi bin baru "
                             "(Rak & bin, Perlu bin). / No other bin for this product: the SPV "
                             "gives it one.")


async def apply_extra_decision(cur, diff: dict, decision: str, actor: str) -> None:
    """Called by replenishment.decide_differences for an approved extra row.
    accept: the held units may go to the rack (Taruh di rak). reject: they go on
    the return-to-brand list (agent C's Karantina & retur reads status 'return')."""
    loads = await db.many(cur, "SELECT * FROM inbound_bin_loads WHERE receipt_id = %s "
                               "AND sku_id = %s AND qty_hold > 0 FOR UPDATE",
                          (diff["receipt_id"], diff["sku_id"]))
    for l in loads:
        if decision == "accept":
            await db.run(cur, "UPDATE inbound_bin_loads SET qty_hold = 0, "
                              "status = IF(status IN ('held','filling','full'), 'batched', status), "
                              "batched_at = COALESCE(batched_at, NOW()) WHERE id = %s", (l["id"],))
        else:
            only_hold = int(l["qty"]) - int(l["qty_put"]) <= int(l["qty_hold"])
            if only_hold:
                await db.run(cur, "UPDATE inbound_bin_loads SET status = 'return' WHERE id = %s",
                             (l["id"],))


@router.post("/inbound/loads/{load_id}/returned", response_model=LoadOut)
async def returned_to_brand(load_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Rejected extra units left with the brand's driver: the temporary bin is free.
    Agent C's return flow may call this (or set the same columns)."""
    l = await _load(load_id, user)
    if l["status"] != "return":
        raise HTTPException(409, "Bin ini tidak di daftar retur. / Not on the return list.")
    async with db.tx() as cur:
        await mark_returned(cur, load_id, user.email)
    return _load_out(await _load(load_id, user))


async def mark_returned(cur, load_id: int, actor: str) -> None:
    await db.run(cur, "UPDATE inbound_bin_loads SET status = 'done', qty_hold = 0, "
                      "done_at = NOW(), done_by = %s WHERE id = %s AND status = 'return'",
                 (actor, load_id))


# --- photos ----------------------------------------------------------------------

async def _read_photo(f: UploadFile) -> tuple[bytes, str, str]:
    ctype = (f.content_type or "").split(";")[0].strip().lower()
    ext = PHOTO_TYPES.get(ctype)
    if not ext:
        raise HTTPException(415, "Foto harus JPG, PNG, WEBP atau HEIC. / The photo must be an image.")
    data = await f.read(PHOTO_MAX + 1)
    if not data:
        raise HTTPException(400, "Foto kosong. / The photo is empty.")
    if len(data) > PHOTO_MAX:
        raise HTTPException(413, "Foto lebih dari 10 MB. / The photo is over 10 MB.")
    return data, ctype, ext


async def _store_photo(cur, receipt_id, site_id, kind, difference_id, data, ctype, ext,
                       actor) -> int:
    key = f"inbound/{receipt_id}-{uuid.uuid4().hex[:12]}.{ext}"
    await faktur.put_doc(key, data, ctype)
    return await db.run(
        cur,
        "INSERT INTO inbound_photos (receipt_id, site_id, kind, difference_id, storage_key, "
        "content_type, size_bytes, uploaded_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (receipt_id, site_id, kind, difference_id, key, ctype, len(data), actor))


@router.post("/inbound/receipts/{receipt_id}/photos", response_model=PhotoOut, status_code=201)
async def upload_photo(
    receipt_id: int, kind: str = Form(...), difference_id: int | None = Form(None),
    file: UploadFile = File(...), user: auth.User = Depends(auth.current_user),
):
    """A receiving photo: sj_signed, selfie, sj_driver (the three required to finish),
    damage (with the difference_id from the damaged unit), or sj_no_po. Anyone
    receiving may take them; only the SPV and Ops HQ can see them."""
    r = await _receipt(receipt_id, user)
    kind = (kind or "").strip().lower()
    if kind not in PHOTO_KINDS:
        raise HTTPException(422, "Jenis foto tidak dikenal. / Unknown photo kind.")
    if kind == "damage":
        d = await db.fetch_one("SELECT id FROM inbound_differences WHERE id = %s AND receipt_id = %s "
                               "AND kind = 'damaged'", (difference_id or 0, receipt_id))
        if not d:
            raise HTTPException(422, "Foto kerusakan perlu unit rusaknya. / A damage photo needs "
                                     "its damaged unit.")
    else:
        difference_id = None
    data, ctype, ext = await _read_photo(file)
    async with db.tx() as cur:
        pid = await _store_photo(cur, receipt_id, r["site_id"], kind, difference_id, data, ctype,
                                 ext, user.email)
    p = await db.fetch_one("SELECT * FROM inbound_photos WHERE id = %s", (pid,))
    return _photo_out(p)


@router.get("/inbound/receipts/{receipt_id}/photos", response_model=list[PhotoOut])
async def list_photos(receipt_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    await _receipt(receipt_id, user)
    rows = await db.fetch_all("SELECT * FROM inbound_photos WHERE receipt_id = %s ORDER BY id",
                              (receipt_id,))
    return [_photo_out(p) for p in rows]


@router.get("/inbound/photos/{photo_id}/file")
async def photo_file(photo_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Streams a receiving photo, SPV and Ops HQ only."""
    p = await db.fetch_one("SELECT * FROM inbound_photos WHERE id = %s", (photo_id,))
    if not p:
        raise HTTPException(404, "Foto tidak ditemukan. / Photo not found.")
    await auth.assert_site_access(user, p["site_id"])
    data = await faktur.load_doc(p["storage_key"])
    return Response(content=data, media_type=p["content_type"],
                    headers={"Content-Disposition": f'inline; filename="inbound-{photo_id}"',
                             "Cache-Control": "private, max-age=3600",
                             "X-Content-Type-Options": "nosniff"})


# --- 4. end of receiving, differences, linking --------------------------------------

async def _record_differences(cur, r: dict, actor: str) -> int:
    """Short and extra per SKU against the brand's confirmation; damaged rows exist
    already. Sets the decision deadline on every pending row. Returns how many
    differences wait for Ops HQ."""
    rep_id = r.get("replenishment_id")
    if not rep_id:
        return 0
    hours = await _rule("difference_decide_hours", 24)
    lines = await db.many(cur, "SELECT * FROM receipt_lines WHERE receipt_id = %s", (r["id"],))
    holds = {x["sku_id"]: x for x in await db.many(
        cur, "SELECT sku_id, SUM(qty_hold) AS q, GROUP_CONCAT(DISTINCT bin_code) AS bins "
             "FROM inbound_bin_loads WHERE receipt_id = %s AND qty_hold > 0 GROUP BY sku_id",
        (r["id"],))}
    for l in lines:
        expected = int(l["qty_expected"] or 0)
        short = max(0, expected - int(l["qty_received"]))
        if short:
            await db.run(
                cur,
                "INSERT INTO inbound_differences (receipt_id, replenishment_id, site_id, sku_id, "
                "kind, place, qty, created_by) VALUES (%s,%s,%s,%s,'short','none',%s,%s) "
                "ON DUPLICATE KEY UPDATE qty = VALUES(qty)",
                (r["id"], rep_id, r["site_id"], l["sku_id"], short, actor))
        h = holds.get(l["sku_id"])
        if h and int(h["q"] or 0):
            await db.run(
                cur,
                "INSERT INTO inbound_differences (receipt_id, replenishment_id, site_id, sku_id, "
                "kind, place, bin_code, qty, created_by) VALUES (%s,%s,%s,%s,'extra','bin',%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE qty = VALUES(qty), bin_code = VALUES(bin_code)",
                (r["id"], rep_id, r["site_id"], l["sku_id"], (h["bins"] or "")[:48], int(h["q"]),
                 actor))
    await db.run(cur, "UPDATE inbound_differences SET replenishment_id = %s WHERE receipt_id = %s",
                 (rep_id, r["id"]))
    await db.run(cur, "DELETE FROM inbound_differences WHERE receipt_id = %s AND qty = 0 "
                      "AND status = 'pending'", (r["id"],))
    await db.run(cur, "UPDATE inbound_differences SET decide_by = NOW() + INTERVAL %s HOUR "
                      "WHERE receipt_id = %s AND status = 'pending' AND decide_by IS NULL",
                 (hours, r["id"]))
    await db.run(cur, "UPDATE inbound_receipts SET decide_by = NOW() + INTERVAL %s HOUR "
                      "WHERE id = %s AND decide_by IS NULL", (hours, r["id"]))
    n = await db.one(cur, "SELECT COUNT(*) AS n FROM inbound_differences WHERE receipt_id = %s "
                          "AND status = 'pending'", (r["id"],))
    return int(n["n"])


async def _after_finish(cur, r: dict, actor: str) -> None:
    """Copy the counts to the request; with differences it waits for Ops HQ
    (variance_signoff), without any it closes and bills what arrived."""
    rep_id = r.get("replenishment_id")
    if not rep_id:
        return
    await replenishment.close_on_receipt(cur, r)
    pending = await _record_differences(cur, r, actor)
    if pending:
        await db.run(cur, "UPDATE replenishments SET status = 'variance_signoff', "
                          "received_at = COALESCE(received_at, NOW()) WHERE id = %s", (rep_id,))
    else:
        await replenishment.close_billing(cur, rep_id, actor, decided=False)


async def _close_scanning(cur, r: dict) -> None:
    """*Selesai*: no bin is filled any more. Bins with units for the rack wait for
    their putaway slip (status full) and become tasks at *Sudah dicetak*. When no
    bin has anything for the rack (only extras, or a no-PO delivery not linked
    yet) they are settled at once (held or done): there is no slip to print."""
    await db.run(cur, "UPDATE inbound_bin_loads SET status = 'full', "
                      "full_at = COALESCE(full_at, NOW()) WHERE receipt_id = %s "
                      "AND status = 'filling'", (r["id"],))
    loads = await db.many(cur, "SELECT * FROM inbound_bin_loads WHERE receipt_id = %s "
                               "AND status = 'full'", (r["id"],))
    if not any(_puttable(l, r) for l in loads):
        await _close_batch(cur, r)


@router.post("/inbound/receipts/{receipt_id}/finish", response_model=ReceiptOut)
async def finish(receipt_id: int, body: FinishIn | None = None,
                 user: auth.User = Depends(auth.current_user)):
    """*Selesai & cetak slip*: needs the three photos and a photo for every damaged
    product. The bins wait for their putaway slips (/slips-printed makes them
    tasks); differences wait for Ops HQ (24 h)."""
    r = await _receipt(receipt_id, user)
    view = await receipt_view(r)
    if not view["can_finish"]:
        raise HTTPException(409, {"message": "Belum bisa selesai. / Not ready to finish.",
                                  "blockers": view["finish_blockers"]})
    signed = ((body.sj_signed_by if body else None) or user.email).strip()[:255]
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE",
                     (receipt_id,))
        await _close_scanning(cur, r)
        await db.run(
            cur,
            "UPDATE inbound_receipts SET status = 'completed', completed_at = NOW(), "
            "final_batch = 1, finished_by = %s, sj_signed_by = %s WHERE id = %s AND status = 'open'",
            (user.email, signed, receipt_id))
        fresh = await db.one(cur, "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
        await _after_finish(cur, fresh, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=receipt_id,
                           action="finish", after={"sj_signed_by": signed})
    return await _view(receipt_id)


@router.get("/inbound/no-po")
async def no_po_list(site_id: int | None = None,
                     status: str = Query(default="open", pattern="^(open|linked|all)$"),
                     user: auth.User = Depends(auth.require("supervisor"))):
    """Deliveries with no PO, for Ops HQ to link (*Segera*), oldest first, with the
    requests of the same brand and hub it could belong to."""
    where, params = ["ir.no_po = 1"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("ir.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("ir.site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if status == "open":
        where.append("ir.no_po_linked_at IS NULL AND ir.status <> 'refused'")
    elif status == "linked":
        where.append("ir.no_po_linked_at IS NOT NULL")
    rows = await db.fetch_all(
        "SELECT ir.*, st.code AS site_code, b.name AS brand_name, "
        "  TIMESTAMPDIFF(MINUTE, ir.no_po_raised_at, NOW()) AS age_minutes, "
        "  (SELECT COALESCE(SUM(rl.qty_received), 0) FROM receipt_lines rl "
        "    WHERE rl.receipt_id = ir.id) AS units "
        "FROM inbound_receipts ir JOIN sites st ON st.id = ir.site_id "
        "LEFT JOIN brands b ON b.id = ir.brand_id WHERE " + " AND ".join(where) +
        " ORDER BY ir.no_po_raised_at LIMIT 100", params)
    out = []
    for r in rows:
        cands = await db.fetch_all(
            "SELECT id, reference, brand_po_number, status, eta_date FROM replenishments "
            "WHERE site_id = %s AND brand_id = %s AND status IN ('po','sent','confirmed') "
            "ORDER BY id DESC", (r["site_id"], r["brand_id"]))
        out.append({
            "receipt_id": r["id"], "site_id": r["site_id"], "site_code": r["site_code"],
            "brand_id": r["brand_id"], "brand_name": r["brand_name"], "code": r["no_po_code"],
            "sj_cartons": r["sj_cartons"], "status": r["status"], "units": int(r["units"] or 0),
            "raised_at": _ts(r["no_po_raised_at"]), "age_minutes": r["age_minutes"],
            "linked_at": _ts(r["no_po_linked_at"]), "linked_by": r["no_po_linked_by"],
            "candidates": [dict(c, eta_date=_ts(c["eta_date"])) for c in cands],
        })
    return {"deliveries": out}


@router.post("/inbound/receipts/{receipt_id}/link", response_model=ReceiptOut)
async def link_no_po(receipt_id: int, body: LinkIn, user: auth.User = Depends(auth.require("hq"))):
    """Ops HQ links a no-PO delivery to a restock request of the same hub and brand.
    The counted units become puttable (stock from the rack scan); units above the
    request are held as extras. If receiving already finished, the differences
    are recorded now."""
    r = await _receipt(receipt_id, user)
    if not r.get("no_po") or r.get("no_po_linked_at"):
        raise HTTPException(409, "Kiriman ini tidak menunggu dihubungkan. / Not waiting for a link.")
    rep = await db.fetch_one("SELECT * FROM replenishments WHERE id = %s", (body.replenishment_id,))
    if not rep or rep["site_id"] != r["site_id"] or rep["brand_id"] != r["brand_id"]:
        raise HTTPException(422, "Pilih permintaan dari dark store dan merek yang sama. / Choose a request "
                                 "of the same dark store and brand.")
    if rep["status"] not in ("po", "sent", "confirmed"):
        raise HTTPException(409, f"{rep['reference']} sudah {rep['status']}. / already {rep['status']}.")
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM inbound_receipts WHERE id = %s FOR UPDATE", (receipt_id,))
        expected = {x["sku_id"]: int(x["q"] or 0) for x in await db.many(
            cur, "SELECT sku_id, COALESCE(NULLIF(qty_confirmed, 0), qty_requested) AS q "
                 "FROM replenishment_lines WHERE replenishment_id = %s", (rep["id"],))}
        lines = {x["sku_id"]: x for x in await db.many(
            cur, "SELECT * FROM receipt_lines WHERE receipt_id = %s", (receipt_id,))}
        for sku_id, q in expected.items():
            if sku_id in lines:
                await db.run(cur, "UPDATE receipt_lines SET qty_expected = %s WHERE receipt_id = %s "
                                  "AND sku_id = %s", (q, receipt_id, sku_id))
            else:
                await db.run(cur, "INSERT INTO receipt_lines (receipt_id, sku_id, qty_expected) "
                                  "VALUES (%s,%s,%s)", (receipt_id, sku_id, q))
        for sku_id, x in lines.items():
            if sku_id not in expected:
                await db.run(cur, "UPDATE receipt_lines SET qty_expected = 0 WHERE id = %s",
                             (x["id"],))
            good = int(x["qty_received"]) - int(x["qty_damaged"] or 0)
            excess = max(0, good - expected.get(sku_id, 0))
            for l in await db.many(cur, "SELECT * FROM inbound_bin_loads WHERE receipt_id = %s "
                                        "AND sku_id = %s ORDER BY id DESC FOR UPDATE",
                                   (receipt_id, sku_id)):
                hold = min(excess, int(l["qty"]) - int(l["qty_put"]))
                excess -= hold
                status = l["status"]
                if status == "held":
                    # Back to waiting for its putaway slip (7 Oct flow): printing
                    # the slips makes it a task.
                    status = "full" if int(l["qty"]) - hold > 0 else "held"
                await db.run(cur, "UPDATE inbound_bin_loads SET qty_hold = %s, status = %s "
                                  "WHERE id = %s", (hold, status, l["id"]))
        await db.run(
            cur,
            "UPDATE inbound_receipts SET replenishment_id = %s, external_reference = %s, "
            "no_po_linked_by = %s, no_po_linked_at = NOW() WHERE id = %s",
            (rep["id"], rep["reference"], user.email, receipt_id))
        await db.run(cur, "UPDATE inbound_differences SET replenishment_id = %s WHERE receipt_id = %s",
                     (rep["id"], receipt_id))
        await db.run(cur, "UPDATE replenishments SET status = 'receiving', receipt_id = %s "
                          "WHERE id = %s", (receipt_id, rep["id"]))
        fresh = await db.one(cur, "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
        if fresh["status"] == "completed":
            await _after_finish(cur, fresh, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=receipt_id,
                           action="link_no_po", after={"replenishment_id": rep["id"]})
    return await _view(receipt_id)


@router.get("/inbound/manual-picks")
async def manual_picks(site_id: int, days: int = Query(default=7, ge=1, le=90),
                       user: auth.User = Depends(auth.require("supervisor"))):
    """Every unit picked from the list instead of scanned (*dilihat SPV*)."""
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT u.receipt_id, u.sku_id, s.name_display, u.actor_email, rp.reference, "
        "       SUM(u.qty) AS units, MIN(u.created_at) AS first_at, MAX(u.created_at) AS last_at "
        "FROM inbound_units u JOIN skus s ON s.id = u.sku_id "
        "JOIN inbound_receipts ir ON ir.id = u.receipt_id "
        "LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id "
        "WHERE u.site_id = %s AND u.method = 'manual' "
        "  AND u.created_at >= NOW() - INTERVAL %s DAY "
        "GROUP BY u.receipt_id, u.sku_id, s.name_display, u.actor_email, rp.reference "
        "HAVING SUM(u.qty) > 0 ORDER BY last_at DESC", (site_id, days))
    return {"picks": [dict(r, units=int(r["units"]), first_at=_ts(r["first_at"]),
                           last_at=_ts(r["last_at"])) for r in rows]}


# --- the putaway slip (board 5j) ----------------------------------------------------

async def _slip_no(cur, site_code: str, receipt_id: int) -> str:
    row = await db.one(cur, "SELECT slip_no FROM putaway_slips WHERE receipt_id = %s", (receipt_id,))
    if row:
        return row["slip_no"]
    prefix = f"PA-{replenishment.hub_code(site_code)}-{daycolor.local_date():%y%m}-"
    rows = await db.many(cur, "SELECT slip_no FROM putaway_slips WHERE slip_no LIKE %s",
                         (prefix + "%",))
    seq = max([int(x["slip_no"][len(prefix):]) for x in rows
               if x["slip_no"][len(prefix):].isdigit()] or [0])
    return f"{prefix}{seq + 1:03d}"


@router.get("/inbound/receipts/{receipt_id}/slip")
async def putaway_slip(receipt_id: int, user: auth.User = Depends(auth.current_user)):
    """*Cetak slip putaway* (thermal 80 mm, A4 without one). Since 7 Oct staff
    print it too, right after *Selesai*, before anything is on the rack:

      tasks   one slip per temporary bin still to put away: product, units, from
              the temporary bin, to the rack bin, today's divider colour
      held    bins that stay where they are (extras waiting for Ops HQ, returns)
      lines   what is already on the rack (the summary record the SPV signs),
              with the differences waiting for Ops HQ, the 24-hour claim
              deadline and the signature boxes

    The number PA-<hub>-<yymm>-<nnn> is issued on the first print and kept; the
    content is rebuilt on every print so a later putaway (an accepted extra)
    appears."""
    r = await _receipt(receipt_id, user)
    if r["status"] == "open":
        raise HTTPException(409, "Selesaikan penerimaan dulu. / Finish the receipt first.")
    site = await _site(r["site_id"])
    brand = await db.fetch_one("SELECT * FROM brands WHERE id = %s", (r["brand_id"],)) or {}
    rep = await db.fetch_one("SELECT reference, brand_po_number FROM replenishments WHERE id = %s",
                             (r["replenishment_id"],)) if r.get("replenishment_id") else None
    puts = await db.fetch_all(
        "SELECT p.*, l.bin_code, l.batch_no, s.name_display, s.brand_sku_code, "
        "       lv.level_no, rk.code AS rack_code "
        "FROM inbound_putaways p JOIN inbound_bin_loads l ON l.id = p.load_id "
        "JOIN skus s ON s.id = p.sku_id JOIN locations lc ON lc.id = p.location_id "
        "LEFT JOIN levels lv ON lv.id = lc.level_id LEFT JOIN racks rk ON rk.id = lv.rack_id "
        "WHERE p.receipt_id = %s ORDER BY rk.code, lv.level_no, p.location_code, p.id",
        (receipt_id,))
    span = await db.fetch_one("SELECT MIN(created_at) AS a, MAX(created_at) AS b FROM inbound_units "
                              "WHERE receipt_id = %s", (receipt_id,))
    diffs = await _differences(receipt_id)
    loads = await db.fetch_all(
        "SELECT l.*, s.name_display, s.brand_sku_code FROM inbound_bin_loads l "
        "JOIN skus s ON s.id = l.sku_id WHERE l.receipt_id = %s ORDER BY l.id", (receipt_id,))
    today = daycolor.for_moment()
    today_name = COLOUR_NAME.get(today["key"], ("", ""))
    tasks, held = [], []
    for l in loads:
        if (l["status"] == "batched" and _left(l) > 0) or _puttable(l, r):
            t = await _target(r["site_id"], l["sku_id"])
            tasks.append(({
                "load_id": l["id"], "sku_id": l["sku_id"], "sku_name": l["name_display"],
                "brand_sku_code": l["brand_sku_code"], "qty": _left(l),
                "from_bin": l["bin_code"],
                "to_bin": _short_code(t["location_code"], site["code"]) if t else None,
                "to_location_code": t["location_code"] if t else None,
                "divider": {"key": today["key"], "hex": today["hex"], "colour_id": today_name[0],
                            "colour_en": today_name[1], "week_parity": today["week_parity"],
                            "date": today["date"],
                            "written": daycolor.local_date().strftime("%d/%m")},
                "status": l["status"],
            }, (t["rack_code"], t["level_no"], t["location_code"]) if t else ("~", 0, "")))
        elif l["status"] in ("held", "return", "filling", "full") and int(l["qty"]) > int(l["qty_put"]):
            held.append({"load_id": l["id"], "sku_name": l["name_display"], "from_bin": l["bin_code"],
                         "qty": int(l["qty"]) - int(l["qty_put"]), "is_extra": bool(l["is_extra"]),
                         "returning": l["status"] == "return"})
    tasks.sort(key=lambda x: x[1])
    tasks = [dict(x[0], n=i + 1, of=len(tasks)) for i, x in enumerate(tasks)]
    names = await replenishment.user_names(
        [r.get("opened_by"), r.get("sj_signed_by")] + [p["actor_email"] for p in puts])
    spv = None
    if r.get("sj_signed_by"):
        u = await db.fetch_one("SELECT role FROM users WHERE email = %s", (r["sj_signed_by"],))
        if u and auth.rank(u["role"]) >= auth.rank("supervisor"):
            spv = names.get(r["sj_signed_by"])
    lines = []
    for p in puts:
        c = daycolor.for_moment(p["created_at"])
        cn = COLOUR_NAME.get(c["key"], ("", ""))
        lines.append({
            "sku_id": p["sku_id"], "sku_name": p["name_display"],
            "brand_sku_code": p["brand_sku_code"], "qty": int(p["qty"]),
            "batch_no": p["batch_no"], "from_bin": p["bin_code"],
            "to_bin": _short_code(p["location_code"], site["code"]),
            "to_location_code": p["location_code"],
            "divider": {"key": c["key"], "hex": c["hex"], "colour_id": cn[0], "colour_en": cn[1],
                        "week_parity": c["week_parity"], "date": c["date"]},
            "put_by": names.get(p["actor_email"]),
            # The old slip archive's line shape (routers/slips.py, models.PutawaySlipLine).
            "location_code": p["location_code"], "rack_code": p["rack_code"],
            "level_no": p["level_no"], "qty_received": int(p["qty"]),
        })
    colour = daycolor.for_moment(r["opened_at"])
    legal = replenishment._first(brand, "legal_name", "company_name", "principal_name")
    pending = [d for d in diffs if d["status"] == "pending"]
    body = {
        "site_code": site["code"], "site_name": site["name"],
        "brand_name": brand.get("name"), "brand_legal_name": legal,
        "reference": rep["reference"] if rep else r.get("no_po_code"),
        "brand_po_number": rep["brand_po_number"] if rep else None,
        "received_from": _ts(span["a"]) if span and span["a"] else _ts(r["opened_at"]),
        "received_to": _ts(span["b"]) if span else None,
        "receiver": names.get(r.get("opened_by")), "sj_signed_by": names.get(r.get("sj_signed_by")),
        "lines": lines, "total_put": sum(x["qty"] for x in lines),
        "differences": diffs, "pending_differences": len(pending),
        "tasks": tasks, "held": held,
        "claim_deadline": _ts(r.get("decide_by")),
        "signatures": {"put_by": sorted({x["put_by"] for x in lines if x["put_by"]}),
                       "spv": spv},
        # Keys the old slip archive (routers/slips.py) reads back.
        "source_type": r["source_type"], "external_reference": r.get("external_reference"),
        "day_color": colour, "received_by": r.get("opened_by"),
    }
    async with db.tx() as cur:
        slip_no = await _slip_no(cur, site["code"], receipt_id)
        body["slip_no"] = slip_no
        await db.run(
            cur,
            "INSERT INTO putaway_slips (receipt_id, site_id, slip_no, day_color_key, day_color_hex, "
            "day_label_id, week_parity, inbound_date, total_lines, total_units, received_by, "
            "payload_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE total_lines = VALUES(total_lines), "
            "total_units = VALUES(total_units), payload_json = VALUES(payload_json)",
            (receipt_id, r["site_id"], slip_no, colour["key"], colour["hex"], colour["day_id"],
             colour["week_parity"], colour["date"], len(lines), body["total_put"],
             r.get("opened_by") or user.email, json.dumps(body, ensure_ascii=False, default=str)))
    body["printed_at"] = daycolor.local_now().strftime("%Y-%m-%d %H:%M")
    return body


# --- stock age (Stok lama) -------------------------------------------------------------

@router.get("/inbound/old-stock")
async def old_stock(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Bins whose current batch is older than `stock_old_days` (default 90) from its
    inbound date: *Stok lama*. Age comes from inventory_balances.stocked_since, set
    when an empty bin is filled. For agent S's Stok page."""
    await auth.assert_site_access(user, site_id)
    days = await _rule("stock_old_days", 90)
    rows = await db.fetch_all(
        "SELECT ib.sku_id, s.name_display, l.code AS location_code, ib.qty_on_hand, "
        "       ib.stocked_since, DATEDIFF(NOW(), ib.stocked_since) AS age_days "
        "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
        "JOIN locations l ON l.id = ib.location_id "
        "WHERE ib.site_id = %s AND ib.qty_on_hand > 0 AND ib.stocked_since IS NOT NULL "
        "  AND ib.stocked_since < NOW() - INTERVAL %s DAY ORDER BY ib.stocked_since",
        (site_id, days))
    return {"stock_old_days": days,
            "items": [dict(r, stocked_since=_ts(r["stocked_since"]),
                           age_days=int(r["age_days"] or 0)) for r in rows]}

