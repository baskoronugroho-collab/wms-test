"""Restock request to the brand (canvas section 4, decisions of 1 and 5 Oct 2026).

  draft      The WMS opened it from the reorder numbers, or the SPV or Ops HQ made
             it (*Buat draf*). Its reference is provisional (DRAF-...).
  raised     The SPV raised it to Ops HQ (*Ajukan ke Ops HQ*). A draft made by
             Ops HQ may skip this.
  po         Ops HQ made the request (*Buat permintaan restock*, *Simpan
             permintaan*): the Ninja reference RPL-<hub>-<yymm>-<nnn> is minted
             (yymm = the month the request is made) and the quantities freeze.
             Tab *Permintaan*. The Excel can be downloaded from here on.
  sent       Ops HQ emailed it to the brand (*Tandai terkirim*). Tab *Terkirim*.
  confirmed  Ops HQ recorded the brand's answer (*Catat konfirmasi merek*): the
             brand's own PO number (stored with the brand: two brands may use the
             same number), the expected date and what the brand will send per SKU.
             Tab *Dikonfirmasi*. Staff open the delivery with either number.
  receiving  A receipt is open against it (routers/inbound.py).
  variance_signoff  Received; at least one difference (short, extra, damaged)
             waits for Ops HQ's approval within 24 hours (*Selesaikan selisih*).
             Tab *Selisih*. Nothing is decided automatically when the time passes.
  received   Closed. qty_billed per SKU is what the brand bills.
  cancelled

ED tracking is dropped (5 Oct): nothing here asks for an expiry date any more;
stock age counts from the inbound date. The old expiry columns stay unused.

The reorder alert is computed live from the registry, as before.
"""
import re
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

import auth
import daycolor
import db
import ledger
import models
import po_excel
from routers import faktur

router = APIRouter(prefix="/api", tags=["restock"])

# Still open before anything arrives: cancellable.
OPEN_STATES = ("draft", "raised", "po", "sent", "confirmed")
# A SKU on a request in one of these is "already asked for": no second draft.
ASKING_STATES = ("draft", "raised", "po", "sent", "confirmed", "receiving")
# variance_review is a state of the old flow (SPV acknowledged first); old rows
# in it are shown with the differences.
DIFF_STATES = ("variance_review", "variance_signoff")
ACTIVE_STATES = ASKING_STATES + DIFF_STATES
REQUEST_STATES = ("po", "sent", "confirmed", "receiving") + DIFF_STATES + ("received",)
# Tabs on Restock ke merek (board 4a), in order.
TABS = {
    "draft": ("draft",),
    "raised": ("raised",),
    "po": ("po",),
    "sent": ("sent",),
    "confirmed": ("confirmed", "receiving"),
    "selisih": DIFF_STATES,
}

BRAND_PO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/._ -]{0,63}$")
BARCODE_RE = re.compile(r"^[0-9A-Za-z-]{4,64}$")
DEFAULT_RECEIVING_HOURS = "09:00 to 16:00 WIB"


# --- shapes ------------------------------------------------------------------------

class RestockLine(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    hiryu_sku_code: str | None = None
    unit_size: str | None = None
    photo_key: str | None = None
    barcode: str | None = Field(default=None, description="Null = MISSING on the request")
    brand_barcode: str | None = Field(default=None, description="Written by the brand")
    stock_now: int | None = Field(default=None, description="Live, while draft or raised")
    restock_point: int | None = Field(default=None, description="Pesan ulang saat sisa")
    fill_to: int | None = Field(default=None, description="Isi sampai")
    stock_at_po: int | None = None
    fill_to_at_po: int | None = None
    qty_requested: int
    qty_confirmed: int | None = None
    qty_received: int | None = Field(default=None, description="Every unit counted, damaged too")
    qty_damaged: int | None = None
    variance: int | None = Field(default=None, description="Received minus confirmed")
    qty_billed: int | None = Field(default=None, description="Set once every difference is approved")
    po_note: str | None = None


class RequestHeader(BaseModel):
    reference: str | None = Field(default=None, description="Ninja reference, read-only")
    brand_po_number: str | None = None
    po_date: str | None = Field(default=None, description="YYYY-MM-DD")
    po_to: str | None = None
    po_brand_contact: str | None = None
    po_deliver_to: str | None = None
    po_receiving_hours: str | None = None
    po_requested_date: str | None = Field(default=None, description="YYYY-MM-DD")
    po_created_by_name: str | None = None
    po_note: str | None = None


class Restock(BaseModel):
    id: int
    reference: str
    reference_is_final: bool = Field(description="False while it is a draft reference")
    site_id: int
    site_code: str
    site_name: str
    brand_id: int
    brand_name: str
    status: str
    tab: str | None = None
    brand_po_number: str | None = None
    eta_date: str | None = None
    note: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    auto_created: bool = False
    raised_by: str | None = None
    raised_at: str | None = None
    raise_note: str | None = None
    po_saved_by: str | None = None
    po_saved_at: str | None = None
    header: RequestHeader | None = None
    sent_by: str | None = None
    sent_at: str | None = None
    confirmed_by: str | None = None
    confirmed_at: str | None = None
    brand_note: str | None = None
    receipt_id: int | None = None
    receipt_status: str | None = None
    received_at: str | None = None
    decided_by: str | None = None
    decided_at: str | None = None
    brand_claim_note: str | None = None
    lines: list[RestockLine]
    total_requested: int
    total_confirmed: int
    total_received: int
    total_billed: int | None = None
    missing_barcodes: int = 0
    differences_pending: int = 0
    decide_by: str | None = None
    faktur_pages: list[models.FakturPage] = []


class RestockList(BaseModel):
    replenishments: list[Restock]


class TabCounts(BaseModel):
    draft: int = 0
    raised: int = 0
    po: int = 0
    sent: int = 0
    confirmed: int = 0
    selisih: int = 0


class DraftLineIn(BaseModel):
    sku_id: int
    qty_requested: int = Field(ge=0)


class DraftIn(BaseModel):
    site_id: int
    brand_id: int
    lines: list[DraftLineIn] = []
    note: str | None = None
    fill_all: bool = Field(default=False, description="Ops HQ: every active SKU of the brand, "
                                                      "filled up to isi sampai")


class DraftEditIn(BaseModel):
    lines: list[DraftLineIn]
    note: str | None = None


class RaiseIn(BaseModel):
    note: str | None = None


class RequestLineIn(BaseModel):
    sku_id: int
    qty_requested: int = Field(ge=0)
    note: str | None = None


class RequestSaveIn(BaseModel):
    po_date: str | None = None
    po_to: str | None = None
    po_brand_contact: str | None = None
    po_deliver_to: str | None = None
    po_receiving_hours: str | None = None
    po_requested_date: str | None = None
    po_created_by_name: str | None = None
    po_note: str | None = None
    lines: list[RequestLineIn] | None = Field(
        default=None, description="Required from draft or raised; once saved only the header "
                                  "and line notes can change")


class RequestLine(BaseModel):
    sku_id: int
    sku_name: str
    brand_sku_code: str | None = None
    hiryu_sku_code: str | None = None
    barcode: str | None = None
    unit_size: str | None = None
    current_stock: int
    fill_to: int | None = None
    qty_requested: int
    note: str | None = None


class RequestDraft(BaseModel):
    replenishment_id: int
    status: str
    saved: bool
    reference_preview: str = Field(description="What the Ninja reference will be if saved now")
    header: RequestHeader
    lines: list[RequestLine]


class ConfirmLineIn(BaseModel):
    sku_id: int
    qty_confirmed: int = Field(ge=0)
    brand_barcode: str | None = None


class ConfirmIn(BaseModel):
    brand_po_number: str
    eta_date: str | None = Field(default=None, description="Perkiraan tiba, YYYY-MM-DD")
    lines: list[ConfirmLineIn]
    note: str | None = None


class DifferenceRow(BaseModel):
    id: int
    receipt_id: int
    sku_id: int
    sku_name: str
    kind: str = Field(description="short | extra | damaged")
    place: str = Field(description="damaged: quarantine | driver; extra: bin; short: none")
    bin_code: str | None = None
    qty: int
    qty_requested: int | None = None
    qty_confirmed: int | None = None
    qty_received: int | None = None
    status: str = Field(description="pending | approved")
    decision: str | None = Field(default=None, description="extra: accept | reject; else approve")
    photos: int = 0
    decide_by: str | None = None
    overdue: bool = False
    decided_by: str | None = None
    decided_at: str | None = None


class BilledLine(BaseModel):
    sku_id: int
    sku_name: str
    qty_requested: int
    qty_confirmed: int | None = None
    qty_received: int
    qty_billed_default: int
    qty_billed: int | None = None
    matched: bool


class Differences(BaseModel):
    replenishment_id: int
    reference: str
    brand_name: str
    brand_po_number: str | None = None
    site_code: str
    status: str
    receipt_id: int | None = None
    received_by: str | None = None
    sj_signed_by: str | None = None
    faktur_uploaded_at: str | None = None
    faktur_pages: int = 0
    receipt_photos: int = 0
    damage_photos: int = 0
    decide_by: str | None = None
    overdue: bool = False
    ops_head_notified: bool = True
    rows: list[DifferenceRow]
    approved: int
    lines: list[BilledLine]
    total_requested: int
    total_received: int
    total_rejected: int
    total_billed: int
    brand_claim_note: str | None = None


class DecideRowIn(BaseModel):
    id: int
    approve: bool = True
    decision: str | None = Field(default=None, description="extra rows: accept | reject")


class BilledIn(BaseModel):
    sku_id: int
    qty_billed: int = Field(ge=0)


class DecideIn(BaseModel):
    rows: list[DecideRowIn] = []
    billed: list[BilledIn] = []
    note_for_brand: str | None = None


# --- helpers -----------------------------------------------------------------------

def _sql_in(states: tuple[str, ...]) -> str:
    return "(" + ",".join(f"'{s}'" for s in states) + ")"


def _ts(v) -> str | None:
    return str(v) if v else None


def hub_code(site_code: str | None) -> str:
    return (site_code or "").split("-")[-1]


def fill_to(full_threshold: int | None, restock_point: int | None = None) -> int | None:
    """*Isi sampai*: slot_assignments.full_threshold, or twice the reorder point
    when it is not set yet; None when neither exists (the WMS does not invent one)."""
    if full_threshold:
        return int(full_threshold)
    if restock_point:
        return int(restock_point) * 2
    return None


def draft_reference(site_code: str) -> str:
    """A draft has no Ninja reference yet: that is minted when Ops HQ makes the
    request. The column is unique, so a draft carries this placeholder.
    reminders.auto_replenish should use this too (see the report)."""
    return f"DRAF-{hub_code(site_code)}-{uuid.uuid4().hex[:8].upper()}"


async def mint_reference(cur, site_id: int) -> str:
    """RPL-<hub>-<yymm>-<nnn>: yymm is the Jakarta month the request is made, nnn
    counts that hub's requests in that month. The site row is locked so two Ops
    HQ saves at once cannot take the same number."""
    site = await db.one(cur, "SELECT code FROM sites WHERE id = %s FOR UPDATE", (site_id,))
    prefix = f"RPL-{hub_code(site['code'])}-{daycolor.local_date():%y%m}-"
    rows = await db.many(cur, "SELECT reference FROM replenishments WHERE reference LIKE %s",
                         (prefix + "%",))
    seq = 0
    for r in rows:
        tail = r["reference"][len(prefix):]
        if tail.isdigit():
            seq = max(seq, int(tail))
    return f"{prefix}{seq + 1:03d}"


async def _preview_reference(site_id: int) -> str:
    site = await db.fetch_one("SELECT code FROM sites WHERE id = %s", (site_id,))
    prefix = f"RPL-{hub_code(site['code'])}-{daycolor.local_date():%y%m}-"
    rows = await db.fetch_all("SELECT reference FROM replenishments WHERE reference LIKE %s",
                              (prefix + "%",))
    seq = max([int(r["reference"][len(prefix):]) for r in rows
               if r["reference"][len(prefix):].isdigit()] or [0])
    return f"{prefix}{seq + 1:03d}"


def _need_hq(user: auth.User, what_id: str, what_en: str) -> None:
    if not user.at_least("hq"):
        raise HTTPException(403, f"Hanya Ops HQ yang bisa {what_id}. / Only Ops HQ can {what_en}.")


async def _get(rep_id: int, *states: str) -> dict:
    row = await db.fetch_one("SELECT * FROM replenishments WHERE id = %s", (rep_id,))
    if not row:
        raise HTTPException(404, "Permintaan restock tidak ditemukan. / Restock request not found.")
    if states and row["status"] not in states:
        raise HTTPException(
            409, f"{row['reference']} sudah {row['status']}: langkah ini tidak berlaku lagi. / "
                 f"{row['reference']} is already {row['status']}: this step no longer applies.")
    return row


async def _barcodes(sku_ids: list[int]) -> dict[int, str]:
    """One barcode per SKU for the request, a manufacturer barcode first. Test
    numbers (source 'test', or the 299 prefix of the dev seed) count as MISSING."""
    if not sku_ids:
        return {}
    rows = await db.fetch_all(
        f"SELECT sku_id, barcode, source FROM barcodes WHERE sku_id IN "
        f"({db.placeholders(sku_ids)}) ORDER BY (source = 'manufacturer') DESC, id", sku_ids)
    out: dict[int, str] = {}
    for b in rows:
        code = (b["barcode"] or "").strip()
        if b["source"] == "test" or code.startswith("299") or not code:
            continue
        out.setdefault(b["sku_id"], code)
    return out


async def _stock_and_fill(site_id: int, sku_ids: list[int]) -> dict[int, dict]:
    """Per SKU at one hub: stock held now, pesan ulang saat sisa and isi sampai."""
    if not sku_ids:
        return {}
    ph = db.placeholders(sku_ids)
    held = await db.fetch_all(
        f"SELECT sku_id, COALESCE(SUM(qty_on_hand), 0) AS q FROM inventory_balances "
        f"WHERE site_id = %s AND sku_id IN ({ph}) GROUP BY sku_id", (site_id, *sku_ids))
    nums = await db.fetch_all(
        f"SELECT s.id AS sku_id, sa.full_threshold, sa.restock_point, "
        f"       s.default_full_threshold, s.default_restock_point "
        f"FROM skus s LEFT JOIN slot_assignments sa ON sa.sku_id = s.id "
        f"     AND sa.site_id = %s AND sa.slot_role = 'primary' "
        f"WHERE s.id IN ({ph})", (site_id, *sku_ids))
    q = {h["sku_id"]: int(h["q"] or 0) for h in held}
    out = {}
    for n in nums:
        rp = n["restock_point"] or n["default_restock_point"]
        out[n["sku_id"]] = {
            "stock": q.get(n["sku_id"], 0),
            "restock_point": int(rp) if rp is not None else None,
            "fill_to": fill_to(n["full_threshold"] or n["default_full_threshold"], rp),
        }
    return out


def _header_from_row(r: dict) -> dict:
    return {
        "reference": r["reference"] if r.get("po_saved_at") else None,
        "brand_po_number": r.get("brand_po_number"),
        "po_date": str(r["po_date"]) if r.get("po_date") else None,
        "po_to": r.get("po_to"), "po_brand_contact": r.get("po_brand_contact"),
        "po_deliver_to": r.get("po_deliver_to"),
        "po_receiving_hours": r.get("po_receiving_hours"),
        "po_requested_date": str(r["po_requested_date"]) if r.get("po_requested_date") else None,
        "po_created_by_name": r.get("po_created_by_name"), "po_note": r.get("po_note"),
    }


def _first(row: dict, *keys: str) -> str | None:
    for k in keys:
        v = row.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return None


async def _default_header(r: dict, user: auth.User) -> dict:
    """What the WMS fills in before Ops HQ edits anything (board 4b). brands and
    sites are read with SELECT * so a legal name or contact added by a later
    migration is picked up without a change here."""
    brand = await db.fetch_one("SELECT * FROM brands WHERE id = %s", (r["brand_id"],)) or {}
    site = await db.fetch_one("SELECT * FROM sites WHERE id = %s", (r["site_id"],)) or {}
    legal = _first(brand, "legal_name", "company_name", "principal_name")
    contact = " · ".join(x for x in (
        _first(brand, "restock_contact_name", "restock_contact", "contact_name", "pic_name"),
        _first(brand, "restock_contact_email", "restock_email", "contact_email", "pic_email"),
        _first(brand, "restock_contact_phone", "restock_whatsapp", "contact_phone",
               "contact_whatsapp", "pic_phone"),
    ) if x) or None
    short = hub_code(site.get("code"))
    name = site.get("name") or short
    store = (f"Ninja Van Dark Store {name}" if short and short in name
             else f"Ninja Van Dark Store {short} {name}".strip())
    address = _first(site, "address")
    today = daycolor.local_date()
    return {
        "reference": None,
        "brand_po_number": None,
        "po_date": str(today),
        "po_to": f"{brand.get('name')} · {legal}" if legal else brand.get("name"),
        "po_brand_contact": contact,
        "po_deliver_to": f"{store} · {address}" if address else store,
        "po_receiving_hours": _first(site, "receiving_hours") or DEFAULT_RECEIVING_HOURS,
        "po_requested_date": str(today + timedelta(days=3)),
        "po_created_by_name": (f"{user.name} · {user.email}" if user.name != user.email
                               else user.email),
        "po_note": None,
    }


def _tab(status: str) -> str | None:
    for k, v in TABS.items():
        if status in v:
            return k
    return None


async def _payload(rep_id: int) -> dict:
    r = await db.fetch_one(
        "SELECT rp.*, st.code AS site_code, st.name AS site_name, b.name AS brand_name, "
        "       ir.status AS receipt_status "
        "FROM replenishments rp JOIN sites st ON st.id = rp.site_id "
        "JOIN brands b ON b.id = rp.brand_id "
        "LEFT JOIN inbound_receipts ir ON ir.id = rp.receipt_id WHERE rp.id = %s", (rep_id,))
    if not r:
        raise HTTPException(404, "Permintaan restock tidak ditemukan. / Restock request not found.")
    lines = await db.fetch_all(
        "SELECT rl.*, s.name_display, s.brand_sku_code, s.hiryu_sku_code, s.unit_size, "
        "       s.photo_key, "
        "       (SELECT COALESCE(SUM(x.qty_damaged), 0) FROM receipt_lines x "
        "          JOIN inbound_receipts ir ON ir.id = x.receipt_id "
        "         WHERE ir.replenishment_id = rl.replenishment_id AND x.sku_id = rl.sku_id "
        "           AND ir.status <> 'refused') AS qty_damaged "
        "FROM replenishment_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.replenishment_id = %s ORDER BY s.name_display", (rep_id,))
    ids = [l["sku_id"] for l in lines]
    codes = await _barcodes(ids)
    live = (await _stock_and_fill(r["site_id"], ids)
            if r["status"] in ("draft", "raised") else {})
    closed = r["status"] == "received"
    out_lines = []
    for l in lines:
        now = live.get(l["sku_id"], {})
        received = l["qty_received"]
        out_lines.append({
            "sku_id": l["sku_id"], "sku_name": l["name_display"],
            "brand_sku_code": l["brand_sku_code"], "hiryu_sku_code": l.get("hiryu_sku_code"),
            "unit_size": l.get("unit_size"), "photo_key": l["photo_key"],
            "barcode": codes.get(l["sku_id"]), "brand_barcode": l.get("brand_barcode"),
            "stock_now": now.get("stock"), "restock_point": now.get("restock_point"),
            "fill_to": now.get("fill_to"),
            "stock_at_po": l.get("stock_at_po"), "fill_to_at_po": l.get("fill_to_at_po"),
            "qty_requested": l["qty_requested"], "qty_confirmed": l["qty_confirmed"],
            "qty_received": received,
            "qty_damaged": int(l["qty_damaged"] or 0) if received is not None else None,
            "variance": (received - (l["qty_confirmed"] or 0)) if received is not None else None,
            "qty_billed": l.get("qty_billed") if closed else None,
            "po_note": l.get("po_note"),
        })
    pages = await db.fetch_all(
        "SELECT * FROM faktur_documents WHERE replenishment_id = %s ORDER BY page_no, id",
        (rep_id,))
    diff = await db.fetch_one(
        "SELECT COUNT(*) AS n, MIN(decide_by) AS due FROM inbound_differences "
        "WHERE replenishment_id = %s AND status = 'pending'", (rep_id,))
    return {
        "id": r["id"], "reference": r["reference"],
        "reference_is_final": bool(r.get("po_saved_at")),
        "site_id": r["site_id"], "site_code": r["site_code"], "site_name": r["site_name"],
        "brand_id": r["brand_id"], "brand_name": r["brand_name"], "status": r["status"],
        "tab": _tab(r["status"]),
        "brand_po_number": r.get("brand_po_number"),
        "eta_date": str(r["eta_date"]) if r["eta_date"] else None, "note": r["note"],
        "created_by": r["created_by"], "created_at": _ts(r["created_at"]),
        "auto_created": bool(r.get("auto_created")),
        "raised_by": r.get("raised_by"), "raised_at": _ts(r.get("raised_at")),
        "raise_note": r.get("raise_note"),
        "po_saved_by": r.get("po_saved_by"), "po_saved_at": _ts(r.get("po_saved_at")),
        "header": _header_from_row(r) if r.get("po_saved_at") else None,
        "sent_by": r["sent_by"], "sent_at": _ts(r["sent_at"]),
        "confirmed_by": r["confirmed_by"], "confirmed_at": _ts(r["confirmed_at"]),
        "brand_note": r.get("brand_note"),
        "receipt_id": r["receipt_id"], "receipt_status": r["receipt_status"],
        "received_at": _ts(r["received_at"]),
        "decided_by": r.get("signed_off_by"), "decided_at": _ts(r.get("signed_off_at")),
        "brand_claim_note": r.get("brand_claim_note"),
        "lines": out_lines,
        "total_requested": sum(l["qty_requested"] for l in out_lines),
        "total_confirmed": sum(l["qty_confirmed"] or 0 for l in out_lines),
        "total_received": sum(l["qty_received"] or 0 for l in out_lines),
        "total_billed": (sum(l["qty_billed"] or 0 for l in out_lines) if closed else None),
        "missing_barcodes": sum(1 for l in out_lines
                                if not l["barcode"] and not l["brand_barcode"]),
        "differences_pending": int(diff["n"] or 0) if diff else 0,
        "decide_by": _ts(diff["due"]) if diff else None,
        "faktur_pages": [faktur.page_out(p) for p in pages],
    }


async def _assert_brand(sku_ids, brand_id: int) -> None:
    ids = list(sku_ids)
    if not ids:
        return
    skus = await db.fetch_all(
        f"SELECT id, brand_id FROM skus WHERE id IN ({db.placeholders(ids)})", ids)
    if len(skus) != len(ids) or any(s["brand_id"] != brand_id for s in skus):
        raise HTTPException(422, "Semua produk harus dari merek yang sama. / "
                                 "Every product must be from the same brand.")


def _parse_day(v: str | None, label_id: str, label_en: str) -> date | None:
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        raise HTTPException(422, f"{label_id}: tanggal tidak valid. / {label_en}: not a valid date.")


def _text(v: str | None, n: int) -> str | None:
    return (v or "").strip()[:n] or None


# --- alerts ------------------------------------------------------------------------

@router.get("/replenishment/alerts", response_model=models.ReplenishmentAlertList)
async def alerts(
    site_id: int | None = None,
    brand_id: int | None = None,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Every SKU at or below its pesan ulang saat sisa: every hub for Ops HQ, own
    hubs for an SPV."""
    where, params = ["st.active = 1", "st.site_type <> 'hub'", "st.is_training = 0"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where[-1] = "1=1"
        where.append("sa.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("sa.site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    rows = await db.fetch_all(
        "SELECT * FROM ("
        "  SELECT sa.site_id, st.code AS site_code, s.id AS sku_id, s.brand_id, "
        "         b.name AS brand_name, s.name_display, s.brand_sku_code, "
        "         sa.restock_point, sa.full_threshold, sa.safety_stock, "
        "         (SELECT COALESCE(SUM(ib.qty_on_hand), 0) FROM inventory_balances ib "
        "           WHERE ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id) AS qty_total, "
        "         (SELECT rp.reference FROM replenishment_lines rl "
        "            JOIN replenishments rp ON rp.id = rl.replenishment_id "
        "           WHERE rp.site_id = sa.site_id AND rl.sku_id = sa.sku_id "
        f"            AND rp.status IN {_sql_in(ASKING_STATES)} "
        "           ORDER BY rp.id DESC LIMIT 1) AS open_reference "
        "  FROM slot_assignments sa "
        "  JOIN sites st ON st.id = sa.site_id "
        "  JOIN skus s ON s.id = sa.sku_id JOIN brands b ON b.id = s.brand_id "
        "  WHERE sa.slot_role = 'primary' AND sa.restock_point IS NOT NULL AND s.active = 1 "
        "    AND " + " AND ".join(where) +
        ") x WHERE x.qty_total <= x.restock_point "
        "ORDER BY x.site_code, x.qty_total / GREATEST(x.restock_point, 1), x.name_display",
        params,
    )
    out = []
    for r in rows:
        total = int(r["qty_total"] or 0)
        target = fill_to(r["full_threshold"], r["restock_point"])
        out.append({
            "site_id": r["site_id"], "site_code": r["site_code"], "sku_id": r["sku_id"],
            "brand_id": r["brand_id"], "brand_name": r["brand_name"],
            "sku_name": r["name_display"], "brand_sku_code": r["brand_sku_code"],
            "qty_total": total, "restock_point": r["restock_point"],
            "full_threshold": r["full_threshold"],
            "qty_suggested": max(1, (target or 0) - total),
            "safety_stock": r["safety_stock"],
            "below_safety": r["safety_stock"] is not None and total <= r["safety_stock"],
            "open_reference": r["open_reference"],
        })
    return {"alerts": out}


# --- lists -------------------------------------------------------------------------

def _scope(user: auth.User, site_id: int | None, where: list, params: list) -> None:
    if site_id:
        where.append("site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)


@router.get("/replenishments", response_model=RestockList)
async def list_replenishments(
    site_id: int | None = None,
    status: str = Query(default="active",
                        pattern="^(active|arriving|draft|raised|po|sent|confirmed|selisih|"
                                "received|cancelled|all)$"),
    brand_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=300),
    user: auth.User = Depends(auth.current_user),
):
    """The tabs of Restock ke merek: draft, raised (Diajukan), po (Permintaan), sent
    (Terkirim), confirmed (Dikonfirmasi, also being received), selisih. `arriving`
    is what a hub can receive (confirmed or receiving). Ops HQ sees every hub."""
    if site_id:
        await auth.assert_site_access(user, site_id)
    where, params = ["1=1"], []
    _scope(user, site_id, where, params)
    if brand_id:
        where.append("brand_id = %s")
        params.append(brand_id)
    if status == "active":
        where.append(f"status IN {_sql_in(ACTIVE_STATES)}")
    elif status == "arriving":
        where.append("status IN ('confirmed','receiving')")
    elif status in TABS:
        where.append(f"status IN {_sql_in(TABS[status])}")
    elif status != "all":
        where.append("status = %s")
        params.append(status)
    ids = await db.fetch_all(
        "SELECT id FROM replenishments WHERE " + " AND ".join(where) +
        " ORDER BY FIELD(status,'variance_signoff','variance_review','receiving','confirmed',"
        "'sent','po','raised','draft','received','cancelled'), id DESC LIMIT %s",
        (*params, limit))
    return {"replenishments": [await _payload(i["id"]) for i in ids]}


@router.get("/replenishments/tabs", response_model=TabCounts)
async def tab_counts(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    """The number on each tab chip (board 4a)."""
    if site_id:
        await auth.assert_site_access(user, site_id)
    where, params = ["1=1"], []
    _scope(user, site_id, where, params)
    rows = await db.fetch_all(
        "SELECT status, COUNT(*) AS n FROM replenishments WHERE " + " AND ".join(where) +
        " GROUP BY status", params)
    by = {r["status"]: int(r["n"]) for r in rows}
    return {k: sum(by.get(s, 0) for s in v) for k, v in TABS.items()}


@router.get("/replenishments/{rep_id}", response_model=Restock)
async def get_replenishment(rep_id: int, user: auth.User = Depends(auth.current_user)):
    row = await _get(rep_id)
    await auth.assert_site_access(user, row["site_id"])
    return await _payload(rep_id)


# --- draft and raise (steps 1, 2) ----------------------------------------------------

@router.post("/replenishments", response_model=Restock, status_code=201)
async def create_draft(body: DraftIn, user: auth.User = Depends(auth.require("supervisor"))):
    """*Buat draf*: the SPV or Ops HQ. `fill_all` (Ops HQ) is a hub's first delivery:
    every active SKU of the brand, filled up to isi sampai."""
    site = await auth.assert_site_access(user, body.site_id)
    if body.fill_all:
        _need_hq(user, "membuat permintaan pertama untuk semua SKU",
                 "start a first delivery for every SKU")
        skus = await db.fetch_all(
            "SELECT id FROM skus WHERE brand_id = %s AND active = 1 ORDER BY name_display",
            (body.brand_id,))
        if not skus:
            raise HTTPException(422, "Merek ini belum punya SKU aktif. / "
                                     "This brand has no active SKU yet.")
        nums = await _stock_and_fill(body.site_id, [s["id"] for s in skus])
        lines = {s["id"]: max(0, (nums[s["id"]]["fill_to"] or 0) - nums[s["id"]]["stock"])
                 for s in skus}
    else:
        lines = {l.sku_id: l.qty_requested for l in body.lines if l.qty_requested > 0}
        if not lines:
            raise HTTPException(422, "Isi minimal satu produk dengan jumlah. / "
                                     "Add at least one line.")
        await _assert_brand(lines, body.brand_id)
    async with db.tx() as cur:
        rep_id = await db.run(
            cur,
            "INSERT INTO replenishments (reference, site_id, brand_id, note, created_by) "
            "VALUES (%s,%s,%s,%s,%s)",
            (draft_reference(site["code"]), body.site_id, body.brand_id,
             _text(body.note, 400), user.email))
        for sku_id, qty in lines.items():
            await db.run(cur, "INSERT INTO replenishment_lines (replenishment_id, sku_id, "
                              "qty_requested) VALUES (%s,%s,%s)", (rep_id, sku_id, qty))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="draft",
                           after={"lines": len(lines), "fill_all": body.fill_all})
    return await _payload(rep_id)


@router.put("/replenishments/{rep_id}/lines", response_model=Restock)
async def edit_draft(rep_id: int, body: DraftEditIn,
                     user: auth.User = Depends(auth.require("supervisor"))):
    """Change *Jumlah diminta*, *Tambah SKU*, remove a SKU: the SPV or Ops HQ on a
    draft, Ops HQ once raised. Frozen from *Simpan permintaan* on."""
    row = await _get(rep_id, "draft", "raised")
    await auth.assert_site_access(user, row["site_id"])
    if row["status"] == "raised":
        _need_hq(user, "mengubah draf yang sudah diajukan", "change a raised draft")
    lines = {l.sku_id: l.qty_requested for l in body.lines if l.qty_requested > 0}
    if not lines:
        raise HTTPException(422, "Draf perlu minimal satu produk. Batalkan saja kalau tidak "
                                 "jadi. / A draft needs at least one line. Cancel it instead.")
    await _assert_brand(lines, row["brand_id"])
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM replenishment_lines WHERE replenishment_id = %s",
                     (rep_id,))
        for sku_id, qty in lines.items():
            await db.run(cur, "INSERT INTO replenishment_lines (replenishment_id, sku_id, "
                              "qty_requested) VALUES (%s,%s,%s)", (rep_id, sku_id, qty))
        if body.note is not None:
            await db.run(cur, "UPDATE replenishments SET note = %s WHERE id = %s",
                         (_text(body.note, 400), rep_id))
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/raise", response_model=Restock)
async def raise_to_hq(rep_id: int, body: RaiseIn | None = None,
                      user: auth.User = Depends(auth.require("supervisor"))):
    """*Ajukan ke Ops HQ*, with an optional note for Ops HQ."""
    row = await _get(rep_id, "draft")
    await auth.assert_site_access(user, row["site_id"])
    n = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM replenishment_lines WHERE replenishment_id = %s "
        "AND qty_requested > 0", (rep_id,))
    if not int(n["n"]):
        raise HTTPException(422, "Isi minimal satu produk dengan jumlah dulu. / "
                                 "Add at least one product with a quantity first.")
    note = _text(body.note if body else None, 400)
    async with db.tx() as cur:
        await db.run(cur, "UPDATE replenishments SET status = 'raised', raised_by = %s, "
                          "raised_at = NOW(), raise_note = %s WHERE id = %s",
                     (user.email, note, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="raise", after={"note": note})
    return await _payload(rep_id)


# --- the request: Ops HQ makes it, downloads it, sends it (steps 3, 4) ---------------

async def _request_lines(r: dict) -> list[dict]:
    """The lines as the request shows them: frozen numbers once saved, live before."""
    rows = await db.fetch_all(
        "SELECT rl.*, s.name_display, s.brand_sku_code, s.hiryu_sku_code, s.unit_size "
        "FROM replenishment_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.replenishment_id = %s ORDER BY s.name_display", (r["id"],))
    ids = [x["sku_id"] for x in rows]
    codes = await _barcodes(ids)
    live = {} if r.get("po_saved_at") else await _stock_and_fill(r["site_id"], ids)
    out = []
    for x in rows:
        now = live.get(x["sku_id"], {})
        stock = x.get("stock_at_po")
        fill = x.get("fill_to_at_po")
        out.append({
            "sku_id": x["sku_id"], "sku_name": x["name_display"],
            "brand_sku_code": x["brand_sku_code"], "hiryu_sku_code": x.get("hiryu_sku_code"),
            "barcode": codes.get(x["sku_id"]) or x.get("brand_barcode"),
            "unit_size": x.get("unit_size"),
            "current_stock": int(stock if stock is not None else now.get("stock", 0)),
            "fill_to": fill if fill is not None else now.get("fill_to"),
            "qty_requested": x["qty_requested"], "note": x.get("po_note"),
        })
    return out


@router.get("/replenishments/{rep_id}/po-header", response_model=RequestDraft)
async def request_draft(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Buat permintaan restock* (board 4b): the header filled in, each line with its
    stock, isi sampai and barcode, and the Ninja reference it will get. Each
    quantity starts at isi sampai minus stock when the draft has none."""
    r = await _get(rep_id)
    if r["status"] == "cancelled":
        raise HTTPException(409, f"{r['reference']} sudah dibatalkan. / was cancelled.")
    saved = bool(r.get("po_saved_at"))
    header = _header_from_row(r) if saved else await _default_header(r, user)
    return {"replenishment_id": r["id"], "status": r["status"], "saved": saved,
            "reference_preview": r["reference"] if saved else await _preview_reference(
                r["site_id"]),
            "header": header, "lines": await _request_lines(r)}


@router.put("/replenishments/{rep_id}/po", response_model=Restock)
async def save_request(rep_id: int, body: RequestSaveIn,
                       user: auth.User = Depends(auth.require("hq"))):
    """*Simpan permintaan*. From draft or raised: the Ninja reference is minted, the
    header saved, the quantities frozen with the stock and isi sampai of the
    moment. Once saved (state po) Ops HQ may still correct the header and line
    notes until it is sent, never a quantity or the reference."""
    r = await _get(rep_id, "draft", "raised", "po")
    po_date = _parse_day(body.po_date, "Tanggal", "PO date") or daycolor.local_date()
    requested = _parse_day(body.po_requested_date, "Tanggal kirim", "Requested delivery date")
    if requested and requested < po_date:
        raise HTTPException(422, "Tanggal kirim tidak boleh sebelum tanggal permintaan. / "
                                 "The requested delivery date cannot be before the request date.")
    header = (po_date, _text(body.po_to, 255), _text(body.po_brand_contact, 255),
              _text(body.po_deliver_to, 400), _text(body.po_receiving_hours, 64), requested,
              _text(body.po_created_by_name, 255), _text(body.po_note, 400))
    set_header = ("po_date = %s, po_to = %s, po_brand_contact = %s, po_deliver_to = %s, "
                  "po_receiving_hours = %s, po_requested_date = %s, po_created_by_name = %s, "
                  "po_note = %s")

    if r["status"] == "po":
        notes = {}
        if body.lines:
            have = {x["sku_id"]: x["qty_requested"] for x in await db.fetch_all(
                "SELECT sku_id, qty_requested FROM replenishment_lines "
                "WHERE replenishment_id = %s", (rep_id,))}
            for l in body.lines:
                if l.qty_requested != have.get(l.sku_id, 0):
                    raise HTTPException(409, "Permintaan sudah disimpan: jumlahnya tidak bisa "
                                             "diubah lagi. Batalkan dan buat baru kalau perlu. / "
                                             "The request is saved: its quantities cannot change.")
                if l.sku_id in have:
                    notes[l.sku_id] = _text(l.note, 255)
        async with db.tx() as cur:
            await db.run(cur, f"UPDATE replenishments SET {set_header} WHERE id = %s",
                         (*header, rep_id))
            for sku_id, note in notes.items():
                await db.run(cur, "UPDATE replenishment_lines SET po_note = %s "
                                  "WHERE replenishment_id = %s AND sku_id = %s",
                             (note, rep_id, sku_id))
            await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                               entity_id=rep_id, action="request_header")
        return await _payload(rep_id)

    if body.lines is None:
        raise HTTPException(422, "Isi jumlah per produk. / Enter the quantity per product.")
    lines = {l.sku_id: (l.qty_requested, _text(l.note, 255))
             for l in body.lines if l.qty_requested > 0}
    if not lines:
        raise HTTPException(422, "Permintaan perlu minimal satu produk dengan jumlah. / "
                                 "A request needs at least one product with a quantity.")
    await _assert_brand(lines, r["brand_id"])
    nums = await _stock_and_fill(r["site_id"], list(lines))
    async with db.tx() as cur:
        reference = await mint_reference(cur, r["site_id"])
        await db.run(cur, "DELETE FROM replenishment_lines WHERE replenishment_id = %s",
                     (rep_id,))
        for sku_id, (qty, note) in lines.items():
            n = nums.get(sku_id, {})
            await db.run(
                cur,
                "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested, "
                "stock_at_po, fill_to_at_po, po_note) VALUES (%s,%s,%s,%s,%s,%s)",
                (rep_id, sku_id, qty, n.get("stock", 0), n.get("fill_to"), note))
        await db.run(
            cur,
            f"UPDATE replenishments SET {set_header}, reference = %s, status = 'po', "
            "po_saved_by = %s, po_saved_at = NOW() WHERE id = %s",
            (*header, reference, user.email, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="request_save",
                           before={"reference": r["reference"]},
                           after={"reference": reference, "lines": len(lines),
                                  "units": sum(q for q, _ in lines.values())})
    return await _payload(rep_id)


@router.get("/replenishments/{rep_id}/po.xlsx")
async def request_xlsx(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Unduh permintaan (Excel)* (board 4c): English, the agreed template with the
    Ninja reference, a yellow Brand PO number row and a drawn EAN-13 per SKU."""
    r = await _get(rep_id, *REQUEST_STATES)
    brand = await db.fetch_one("SELECT name FROM brands WHERE id = %s", (r["brand_id"],))
    site = await db.fetch_one("SELECT code FROM sites WHERE id = %s", (r["site_id"],))
    lines = [{
        "brand_sku_code": l["brand_sku_code"], "hiryu_sku_code": l["hiryu_sku_code"],
        "barcode": l["barcode"], "name": l["sku_name"], "size": l["unit_size"],
        "current_stock": l["current_stock"], "fill_to": l["fill_to"],
        "qty": l["qty_requested"], "note": l["note"],
    } for l in await _request_lines(r) if l["qty_requested"] > 0]
    header = dict(_header_from_row(r), reference=r["reference"])
    data = po_excel.build_po_xlsx(header, lines)
    safe = re.sub(r"[^A-Za-z0-9 ._-]", "", f"PO Restock - {brand['name']} - "
                                            f"{hub_code(site['code'])} - {r['reference']}")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{safe}.xlsx"',
                 "Cache-Control": "no-store"})


@router.post("/replenishments/{rep_id}/send", response_model=Restock)
async def mark_sent(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Tandai terkirim*: Ops HQ emailed the request to the brand."""
    await _get(rep_id, "po")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE replenishments SET status='sent', sent_by=%s, sent_at=NOW() "
                          "WHERE id=%s", (user.email, rep_id))
        await db.run(
            cur,
            "UPDATE restock_requests rr JOIN replenishment_lines rl ON rl.sku_id = rr.sku_id "
            "JOIN replenishments rp ON rp.id = rl.replenishment_id AND rp.site_id = rr.site_id "
            "SET rr.status = 'sent', rr.qty_requested = rl.qty_requested, rr.sent_at = NOW() "
            "WHERE rp.id = %s AND rr.status = 'open'", (rep_id,))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="send")
    return await _payload(rep_id)


# --- the brand's confirmation (step 5) ------------------------------------------------

@router.post("/replenishments/{rep_id}/confirm", response_model=Restock)
async def confirm(rep_id: int, body: ConfirmIn, user: auth.User = Depends(auth.require("hq"))):
    """*Catat konfirmasi merek*: the brand's PO number, *Perkiraan tiba* and what the
    brand will really send per SKU (prefilled with the request on screen). A
    barcode the brand wrote for a MISSING one is registered to that SKU.

    The brand PO number is unique only within the brand. Can be repeated until a
    receipt is opened, because a brand's first answer is not always its last."""
    row = await _get(rep_id, "sent", "confirmed")
    po = (body.brand_po_number or "").strip()
    if not BRAND_PO_RE.match(po):
        raise HTTPException(422, "Isi No. PO merek: huruf, angka dan tanda garis miring, titik, "
                                 "minus atau garis bawah, sampai 64 tanda. / Enter the brand's PO "
                                 "number: letters, digits and slash, dot, dash or underscore, up to 64.")
    clash = await db.fetch_one(
        "SELECT reference FROM replenishments WHERE brand_id = %s AND UPPER(brand_po_number) "
        "= UPPER(%s) AND id <> %s AND status <> 'cancelled'", (row["brand_id"], po, rep_id))
    if clash:
        raise HTTPException(409, f"No. PO merek {po} sudah tercatat di {clash['reference']} untuk "
                                 f"merek ini. / Brand PO {po} is already on {clash['reference']}.")
    eta = _parse_day(body.eta_date, "Perkiraan tiba", "Expected arrival")
    confirmed = {l.sku_id: l for l in body.lines}
    if not confirmed or not any(l.qty_confirmed > 0 for l in body.lines):
        raise HTTPException(422, "Isi jumlah yang dikirim merek. / "
                                 "Enter the quantities the brand is sending.")
    await _assert_brand(confirmed, row["brand_id"])
    barcodes = {}
    for sku_id, l in confirmed.items():
        code = (l.brand_barcode or "").strip()
        if not code:
            continue
        if not BARCODE_RE.match(code):
            raise HTTPException(422, f"Barcode dari merek '{code}' tidak valid. / "
                                     f"The brand's barcode '{code}' is not valid.")
        owner = await db.fetch_one("SELECT sku_id FROM barcodes WHERE barcode = %s", (code,))
        if owner and owner["sku_id"] != sku_id:
            raise HTTPException(409, f"Barcode {code} sudah dipakai produk lain. / "
                                     f"Barcode {code} already belongs to another product.")
        barcodes[sku_id] = (code, bool(owner))
    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE replenishments SET status='confirmed', brand_po_number=%s, eta_date=%s, "
            "brand_note=%s, confirmed_by=%s, confirmed_at=NOW() WHERE id=%s",
            (po, eta, _text(body.note, 400), user.email, rep_id))
        await db.run(cur, "UPDATE replenishment_lines SET qty_confirmed = 0 "
                          "WHERE replenishment_id = %s", (rep_id,))
        for sku_id, l in confirmed.items():
            code = barcodes.get(sku_id, (None, False))[0]
            await db.run(
                cur,
                "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested, "
                "qty_confirmed, brand_barcode) VALUES (%s,%s,0,%s,%s) "
                "ON DUPLICATE KEY UPDATE qty_confirmed = VALUES(qty_confirmed), "
                "brand_barcode = COALESCE(VALUES(brand_barcode), brand_barcode)",
                (rep_id, sku_id, l.qty_confirmed, code))
        for sku_id, (code, exists) in barcodes.items():
            if not exists:
                await db.run(cur, "INSERT INTO barcodes (barcode, sku_id, source, registered_by) "
                                  "VALUES (%s,%s,'brand',%s)", (code, sku_id, user.email))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="confirm",
                           after={"brand_po_number": po, "eta": str(eta) if eta else None,
                                  "units": sum(l.qty_confirmed for l in body.lines),
                                  "barcodes": {str(k): v[0] for k, v in barcodes.items()}})
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/cancel", response_model=Restock)
async def cancel(rep_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """The SPV may drop a draft or a raised draft of their hub. From the request
    on it is Ops HQ's: the brand may already have it."""
    row = await _get(rep_id, *OPEN_STATES)
    await auth.assert_site_access(user, row["site_id"])
    if row["status"] not in ("draft", "raised"):
        _need_hq(user, "membatalkan permintaan", "cancel a request")
    async with db.tx() as cur:
        await mark_cancelled(cur, row, user.email)
    return await _payload(rep_id)


async def mark_cancelled(cur, row: dict, actor: str, after: dict | None = None) -> None:
    """Cancel a request nothing has arrived for yet: the Batalkan button above,
    or a new demo delivery replacing an older one (routers/demo.py). It leaves
    every open list and Barang masuk's Kiriman hari ini."""
    await db.run(cur, "UPDATE replenishments SET status='cancelled' WHERE id=%s", (row["id"],))
    await ledger.audit(cur, actor_email=actor, entity="replenishment", entity_id=row["id"],
                       action="cancel", before={"status": row["status"]}, after=after)


# --- differences: Ops HQ approves within 24 hours (step 7) ----------------------------

async def billed_defaults(rep_id: int, cur=None) -> dict[int, int]:
    """What the brand bills per SKU unless Ops HQ types another number: every unit
    counted, less damaged units (rejected at inbound) and extras Ops HQ rejected
    (or has not accepted yet)."""
    sql = ("SELECT rl.sku_id, COALESCE(rl.qty_received, 0) AS received, "
           "  (SELECT COALESCE(SUM(d.qty), 0) FROM inbound_differences d "
           "    WHERE d.replenishment_id = rl.replenishment_id AND d.sku_id = rl.sku_id "
           "      AND (d.kind = 'damaged' OR (d.kind = 'extra' "
           "           AND COALESCE(d.decision, '') <> 'accept'))) AS rejected "
           "FROM replenishment_lines rl WHERE rl.replenishment_id = %s")
    rows = await (db.many(cur, sql, (rep_id,)) if cur else db.fetch_all(sql, (rep_id,)))
    return {r["sku_id"]: max(0, int(r["received"]) - int(r["rejected"] or 0)) for r in rows}


def _overdue(due) -> bool:
    from datetime import datetime, timezone
    return bool(due and datetime.now(timezone.utc).replace(tzinfo=None) > due)


@router.get("/replenishments/{rep_id}/differences", response_model=Differences)
async def differences(rep_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """*Selesaikan selisih* (board 4e): every difference of the delivery (short,
    extra, rejected at inbound as damaged), the billed number per SKU, and what
    was received with the photos."""
    r = await _get(rep_id)
    await auth.assert_site_access(user, r["site_id"])
    head = await db.fetch_one(
        "SELECT st.code AS site_code, b.name AS brand_name FROM sites st, brands b "
        "WHERE st.id = %s AND b.id = %s", (r["site_id"], r["brand_id"]))
    receipt = await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE replenishment_id = %s AND status <> 'refused' "
        "ORDER BY id DESC LIMIT 1", (rep_id,))
    rows = await db.fetch_all(
        "SELECT d.*, s.name_display, rl.qty_requested, rl.qty_confirmed, rl.qty_received, "
        "  (SELECT COUNT(*) FROM inbound_photos p WHERE p.difference_id = d.id) AS photos "
        "FROM inbound_differences d JOIN skus s ON s.id = d.sku_id "
        "LEFT JOIN replenishment_lines rl ON rl.replenishment_id = d.replenishment_id "
        "     AND rl.sku_id = d.sku_id "
        "WHERE d.replenishment_id = %s AND d.qty > 0 "
        "ORDER BY FIELD(d.kind,'short','extra','damaged'), s.name_display", (rep_id,))
    lines = await db.fetch_all(
        "SELECT rl.*, s.name_display FROM replenishment_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.replenishment_id = %s ORDER BY s.name_display", (rep_id,))
    defaults = await billed_defaults(rep_id)
    with_diff = {x["sku_id"] for x in rows}
    out_lines = []
    for l in lines:
        d = defaults.get(l["sku_id"], 0)
        out_lines.append({
            "sku_id": l["sku_id"], "sku_name": l["name_display"],
            "qty_requested": l["qty_requested"], "qty_confirmed": l["qty_confirmed"],
            "qty_received": int(l["qty_received"] or 0), "qty_billed_default": d,
            "qty_billed": l.get("qty_billed"), "matched": l["sku_id"] not in with_diff,
        })
    photos = {"receipt": 0, "damage": 0}
    pages = 0
    if receipt:
        for p in await db.fetch_all(
                "SELECT kind, COUNT(*) AS n FROM inbound_photos WHERE receipt_id = %s "
                "GROUP BY kind", (receipt["id"],)):
            key = "damage" if p["kind"] == "damage" else "receipt"
            photos[key] += int(p["n"])
        pg = await db.fetch_one("SELECT COUNT(*) AS n FROM faktur_documents "
                                "WHERE replenishment_id = %s OR receipt_id = %s",
                                (rep_id, receipt["id"]))
        pages = int(pg["n"])
    due = min([x["decide_by"] for x in rows if x["status"] == "pending" and x["decide_by"]]
              or [None]) if rows else None
    names = await user_names([receipt.get("opened_by"), receipt.get("sj_signed_by")]
                             if receipt else [])
    rejected = sum(int(x["qty"]) for x in rows
                   if x["kind"] == "damaged"
                   or (x["kind"] == "extra" and x.get("decision") != "accept"))
    return {
        "replenishment_id": rep_id, "reference": r["reference"],
        "brand_name": head["brand_name"], "brand_po_number": r.get("brand_po_number"),
        "site_code": head["site_code"], "status": r["status"],
        "receipt_id": receipt["id"] if receipt else None,
        "received_by": names.get(receipt.get("opened_by")) if receipt else None,
        "sj_signed_by": names.get(receipt.get("sj_signed_by")) if receipt else None,
        "faktur_uploaded_at": _ts(receipt.get("faktur_uploaded_at")) if receipt else None,
        "faktur_pages": pages, "receipt_photos": photos["receipt"],
        "damage_photos": photos["damage"],
        "decide_by": _ts(due), "overdue": _overdue(due),
        "rows": [{
            "id": x["id"], "receipt_id": x["receipt_id"], "sku_id": x["sku_id"],
            "sku_name": x["name_display"], "kind": x["kind"], "place": x["place"],
            "bin_code": x.get("bin_code"), "qty": int(x["qty"]),
            "qty_requested": x["qty_requested"], "qty_confirmed": x["qty_confirmed"],
            "qty_received": x["qty_received"], "status": x["status"],
            "decision": x.get("decision"), "photos": int(x["photos"] or 0),
            "decide_by": _ts(x.get("decide_by")),
            "overdue": x["status"] == "pending" and _overdue(x.get("decide_by")),
            "decided_by": x.get("decided_by"), "decided_at": _ts(x.get("decided_at")),
        } for x in rows],
        "approved": sum(1 for x in rows if x["status"] == "approved"),
        "lines": out_lines,
        "total_requested": sum(l["qty_requested"] for l in out_lines),
        "total_received": sum(l["qty_received"] for l in out_lines),
        "total_rejected": rejected,
        "total_billed": sum(l["qty_billed"] if l["qty_billed"] is not None
                            else l["qty_billed_default"] for l in out_lines),
        "brand_claim_note": r.get("brand_claim_note"),
    }


@router.post("/replenishments/{rep_id}/differences/decide", response_model=Differences)
async def decide_differences(rep_id: int, body: DecideIn,
                             user: auth.User = Depends(auth.require("hq"))):
    """*Simpan keputusan*: Ops HQ approves rows (an extra row needs *Terima* or
    *Tolak kelebihan*), may type the billed number per SKU (*Ditagih*) and a note
    for the brand. Approved rows act at once:

      extra accept   the units in the temporary bin go on *Taruh di rak*
      extra reject   the bin goes on the return-to-brand list (Karantina & retur)
      short, damaged recorded; the damaged units stay where they are (quarantine
                     tray, or already back with the driver)

    When every row is approved the request closes: qty_billed is set per SKU and
    the status becomes received. Approval is never automatic."""
    from routers import inbound   # inbound imports this module at load time
    if user.role == "ops_head":
        raise HTTPException(403, "Ops Head diberi tahu, tidak menyetujui: Ops HQ yang memutuskan. / "
                                 "The Ops Head is notified; Ops HQ decides.")
    await _get(rep_id, *DIFF_STATES)
    rows = {x["id"]: x for x in await db.fetch_all(
        "SELECT * FROM inbound_differences WHERE replenishment_id = %s", (rep_id,))}
    todo = []
    for d in body.rows:
        x = rows.get(d.id)
        if not x:
            raise HTTPException(404, f"Selisih #{d.id} bukan dari permintaan ini. / "
                                     f"Difference #{d.id} is not on this request.")
        if not d.approve or x["status"] == "approved":
            continue
        decision = "approve"
        if x["kind"] == "extra":
            decision = (d.decision or "").strip().lower()
            if decision not in ("accept", "reject"):
                raise HTTPException(422, "Kelebihan: pilih Terima atau Tolak kelebihan. / "
                                         "Extra units: choose accept or reject.")
        todo.append((x, decision))
    have = {l["sku_id"] for l in await db.fetch_all(
        "SELECT sku_id FROM replenishment_lines WHERE replenishment_id = %s", (rep_id,))}
    for b in body.billed:
        if b.sku_id not in have:
            raise HTTPException(422, "Produk itu tidak ada di permintaan ini. / "
                                     "That product is not on this request.")
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM replenishments WHERE id = %s FOR UPDATE", (rep_id,))
        for x, decision in todo:
            await db.run(
                cur,
                "UPDATE inbound_differences SET status = 'approved', decision = %s, "
                "decided_by = %s, decided_at = NOW() WHERE id = %s AND status = 'pending'",
                (decision, user.email, x["id"]))
            if x["kind"] == "extra":
                await inbound.apply_extra_decision(cur, x, decision, user.email)
        for b in body.billed:
            await db.run(cur, "UPDATE replenishment_lines SET qty_billed = %s "
                              "WHERE replenishment_id = %s AND sku_id = %s",
                         (b.qty_billed, rep_id, b.sku_id))
        if body.note_for_brand is not None:
            await db.run(cur, "UPDATE replenishments SET brand_claim_note = %s WHERE id = %s",
                         (_text(body.note_for_brand, 1000), rep_id))
        left = await db.one(
            cur, "SELECT COUNT(*) AS n FROM inbound_differences WHERE replenishment_id = %s "
                 "AND status = 'pending' AND qty > 0", (rep_id,))
        if not int(left["n"]):
            await close_billing(cur, rep_id, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="differences_decide",
                           after={"rows": [{"id": x["id"], "decision": d} for x, d in todo],
                                  "billed": {str(b.sku_id): b.qty_billed for b in body.billed}})
    return await differences(rep_id, user)


async def close_billing(cur, rep_id: int, actor: str, decided: bool = True) -> None:
    """Every difference approved (or none at all): the billed number per SKU is what
    Ops HQ typed, else the default, and the request is received. `decided` is
    False when nothing differed: then nobody signed anything off."""
    defaults = await billed_defaults(rep_id, cur)
    for sku_id, qty in defaults.items():
        await db.run(cur, "UPDATE replenishment_lines SET qty_billed = COALESCE(qty_billed, %s) "
                          "WHERE replenishment_id = %s AND sku_id = %s", (qty, rep_id, sku_id))
    await db.run(
        cur,
        "UPDATE replenishments SET status = 'received', received_at = COALESCE(received_at, "
        "NOW()), signed_off_by = %s, signed_off_at = IF(%s, NOW(), NULL) WHERE id = %s",
        (actor if decided else None, 1 if decided else 0, rep_id))
    await db.run(
        cur,
        "UPDATE restock_requests rr JOIN replenishment_lines rl ON rl.sku_id = rr.sku_id "
        "JOIN replenishments rp ON rp.id = rl.replenishment_id AND rp.site_id = rr.site_id "
        "SET rr.status = 'fulfilled' WHERE rp.id = %s AND rr.status IN ('open','sent')",
        (rep_id,))


# --- called from inbound ------------------------------------------------------------

async def user_names(emails) -> dict[str, str]:
    emails = [e for e in set(emails or []) if e]
    if not emails:
        return {}
    rows = await db.fetch_all(
        f"SELECT email, name FROM users WHERE email IN ({db.placeholders(emails)})", emails)
    out = {e: e for e in emails}
    out.update({r["email"]: r["name"] or r["email"] for r in rows})
    return out


RECEIVABLE_STATES = ("confirmed", "receiving")


async def find_deliveries(site_id: int, code: str) -> list[dict]:
    """Open a delivery by our Ninja reference or the brand's PO number (board 5a).

    A brand PO number can repeat: two brands may use the same number, and one
    brand may reuse it once an earlier request is received or cancelled (the
    demo delivery PO/LBR/DEMO is made again for every rehearsal). So the
    deliveries still to receive (confirmed or receiving) at this dark store come
    first, and when there is one, only those are returned: one per brand
    normally, and the screen asks which brand when there are more. Received
    ones are returned only when nothing is open, newest first and one per
    brand, so the screen can say it was already received."""
    code = (code or "").strip()
    if not code:
        return []
    rows = await db.fetch_all(
        "SELECT rp.*, b.name AS brand_name FROM replenishments rp "
        "JOIN brands b ON b.id = rp.brand_id "
        "WHERE rp.site_id = %s AND (rp.reference = %s OR UPPER(rp.brand_po_number) = UPPER(%s)) "
        "AND rp.status IN ('confirmed','receiving','variance_review','variance_signoff',"
        "'received') "
        f"ORDER BY rp.status IN {_sql_in(RECEIVABLE_STATES)} DESC, rp.id DESC LIMIT 20",
        (site_id, code.upper(), code))
    live = [r for r in rows if r["status"] in RECEIVABLE_STATES]
    if live:
        return live[:5]
    out, brands = [], set()
    for r in rows:
        if r["brand_id"] not in brands:
            brands.add(r["brand_id"])
            out.append(r)
    return out[:5]


async def close_on_receipt(cur, receipt: dict, final: bool = True) -> None:
    """Copy what was counted on the receipts of a request back to its lines (every
    unit counted, damaged too). Status is moved by routers/inbound.py when the
    receipt finishes; `final` is kept for old callers (routers/requests.py)."""
    rep_id = receipt.get("replenishment_id")
    if not rep_id:
        return
    got = ("SELECT r.sku_id, SUM(r.qty_received) AS q FROM receipt_lines r "
           "JOIN inbound_receipts ir ON ir.id = r.receipt_id "
           "WHERE ir.replenishment_id = %s AND ir.status NOT IN ('open','refused') "
           "GROUP BY r.sku_id")
    await db.run(
        cur,
        "UPDATE replenishment_lines rl LEFT JOIN (" + got + ") t ON t.sku_id = rl.sku_id "
        "SET rl.qty_received = COALESCE(t.q, 0) "
        "WHERE rl.replenishment_id = %s", (rep_id, rep_id))
    await db.run(
        cur,
        "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested, "
        "qty_confirmed, qty_received) "
        "SELECT %s, t.sku_id, 0, 0, t.q FROM (" + got + ") t "
        "WHERE t.q > 0 AND NOT EXISTS ("
        "  SELECT 1 FROM replenishment_lines x WHERE x.replenishment_id = %s "
        "  AND x.sku_id = t.sku_id)", (rep_id, rep_id, rep_id))
