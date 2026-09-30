"""Restock from the brand: threshold alert -> draft -> raised -> PO -> the brand's
AWB -> receive against it -> the signed Faktur -> expiry dates (PRD §4.1, §4.4).

  draft      The WMS drafted it from the alerts (or someone built it by hand).
             The hub's SPV checks the quantities and can change them.
  raised     The SPV raised it to Ops HQ (*Ajukan ke Ops HQ*). The SPV never
             sends anything to the brand (decided 30 Sep).
  po         Ops HQ saved the PO (*Simpan PO*): header checked, quantities
             frozen. The PO Excel can be downloaded from here on.
  sent       Ops HQ emailed the PO to the brand (*Tandai terkirim*).
  confirmed  The brand answered. Ops HQ recorded the AWB, the Surat Jalan number
             and the quantities the brand will really send (*Catat pengiriman*).
  receiving  Staff are receiving it by the AWB in batches.
  variance_review   The delivery was received and at least one SKU differs from
             the brand's confirmation. The hub's SPV acknowledges each difference,
             correcting the count if a recount finds another number.
  variance_signoff  The SPV has submitted. Ops HQ signs the numbers off, or
             sends them back. Signing applies any correction to stock.
  received   Closed. The number billed per SKU is the signed-off count, or the
             received count when nothing differed.
  cancelled

After the delivery the SPV uploads the signed Faktur (routers/faktur.py); Ops
HQ then types each SKU's expiry date from it here (*ED dari Faktur*), or leaves
it empty and the stock is aged from the day it arrived (§5.5).

The alert is computed live from the registry (everything held at a hub is at or
below the SKU's restock point) rather than from stored restock requests, so stock
that arrived by upload or count still raises it.
"""
import calendar
import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

import auth
import common
import daycolor
import db
import ledger
import models
import po_excel
from routers import faktur

router = APIRouter(prefix="/api", tags=["replenishment"])

# Still open to the hub or Ops HQ before anything arrives: cancellable.
OPEN_STATES = ("draft", "raised", "po", "sent", "confirmed")
# A SKU on a request in one of these is "already asked for": no second draft.
ASKING_STATES = ("draft", "raised", "po", "sent", "confirmed", "receiving")
ACTIVE_STATES = ASKING_STATES + ("variance_review", "variance_signoff")
# The PO exists from here on, so the Excel can be downloaded.
PO_STATES = ("po", "sent", "confirmed", "receiving", "variance_review", "variance_signoff",
             "received")

REFERENCE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")
MONTH_RE = re.compile(r"^(\d{4})-(\d{2})$")
DEFAULT_RECEIVING_HOURS = "09:00 to 16:00 WIB"


def _sql_in(states: tuple[str, ...]) -> str:
    return "(" + ",".join(f"'{s}'" for s in states) + ")"


def fill_to(full_threshold: int | None, restock_point: int | None = None) -> int | None:
    """*Isi sampai* (P): what a restock fills a SKU back up to at one hub.

    The registry stores P as slot_assignments.full_threshold ("the full level P"
    on the Reminders page, `reg-p` on Penempatan & batas). With no P yet, twice
    the reorder point stands in so an alert can still suggest a number; with
    neither there is no number, and the WMS does not invent one (§4.9: the
    opening quantities are Ops HQ's decision).
    """
    if full_threshold:
        return int(full_threshold)
    if restock_point:
        return int(restock_point) * 2
    return None


def _ts(v) -> str | None:
    return str(v) if v else None


def _month(d) -> str | None:
    return f"{d.year:04d}-{d.month:02d}" if d else None


async def _payload(rep_id: int) -> dict:
    r = await db.fetch_one(
        "SELECT rp.*, st.code AS site_code, st.name AS site_name, b.name AS brand_name, "
        "       ir.status AS receipt_status "
        "FROM replenishments rp JOIN sites st ON st.id = rp.site_id "
        "JOIN brands b ON b.id = rp.brand_id "
        "LEFT JOIN inbound_receipts ir ON ir.id = rp.receipt_id WHERE rp.id = %s", (rep_id,))
    if not r:
        raise HTTPException(404, "Permintaan restock tidak ditemukan. / Replenishment not found.")
    lines = await db.fetch_all(
        "SELECT rl.*, s.name_display, s.brand_sku_code, s.photo_key "
        "FROM replenishment_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.replenishment_id = %s ORDER BY s.name_display", (rep_id,))
    out_lines = []
    for l in lines:
        confirmed = l["qty_confirmed"]
        received = l["qty_received"]
        final = l["qty_final"]
        counted = final if final is not None else received
        out_lines.append({
            "sku_id": l["sku_id"], "sku_name": l["name_display"],
            "brand_sku_code": l["brand_sku_code"], "photo_key": l["photo_key"],
            "qty_requested": l["qty_requested"], "qty_confirmed": confirmed,
            "qty_received": received,
            "variance": (received - (confirmed or 0)) if received is not None else None,
            "qty_final": final, "final_note": l["final_note"],
            # What both sides bill on once closed.
            "qty_billed": counted if r["status"] == "received" else None,
            "stock_at_po": l.get("stock_at_po"), "fill_to_at_po": l.get("fill_to_at_po"),
            "po_note": l.get("po_note"),
            "expiry_month": _month(l.get("expiry_date")),
            "expiry_entered_at": _ts(l.get("expiry_entered_at")),
        })
    pages = await db.fetch_all(
        "SELECT * FROM faktur_documents WHERE replenishment_id = %s ORDER BY page_no, id",
        (rep_id,))
    issues = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM faktur_issues WHERE replenishment_id = %s "
        "AND status = 'open'", (rep_id,))
    entered = [l["expiry_entered_at"] for l in out_lines if l["expiry_entered_at"]]
    return {
        "id": r["id"], "reference": r["reference"], "site_id": r["site_id"],
        "site_code": r["site_code"], "site_name": r["site_name"],
        "brand_id": r["brand_id"], "brand_name": r["brand_name"], "status": r["status"],
        "awb": r["awb"], "surat_jalan_no": r["surat_jalan_no"],
        "eta_date": str(r["eta_date"]) if r["eta_date"] else None, "note": r["note"],
        "created_by": r["created_by"], "created_at": _ts(r["created_at"]),
        "sent_by": r["sent_by"], "sent_at": _ts(r["sent_at"]),
        "confirmed_by": r["confirmed_by"], "confirmed_at": _ts(r["confirmed_at"]),
        "receipt_id": r["receipt_id"], "receipt_status": r["receipt_status"],
        "received_at": _ts(r["received_at"]),
        "acknowledged_by": r["acknowledged_by"], "acknowledged_at": _ts(r["acknowledged_at"]),
        "signed_off_by": r["signed_off_by"], "signed_off_at": _ts(r["signed_off_at"]),
        "review_note": r["review_note"],
        "auto_created": bool(r.get("auto_created")),
        "batches": int((await db.fetch_one(
            "SELECT COUNT(*) AS n FROM inbound_receipts WHERE replenishment_id = %s",
            (rep_id,)))["n"]),
        "has_variance": any(l["variance"] for l in out_lines),
        "lines": out_lines,
        "total_requested": sum(l["qty_requested"] for l in out_lines),
        "total_confirmed": sum(l["qty_confirmed"] or 0 for l in out_lines),
        "total_received": sum(l["qty_received"] or 0 for l in out_lines),
        "raised_by": r.get("raised_by"), "raised_at": _ts(r.get("raised_at")),
        "raise_note": r.get("raise_note"),
        "po_saved_by": r.get("po_saved_by"), "po_saved_at": _ts(r.get("po_saved_at")),
        "po_header": _header_from_row(r) if r.get("po_saved_at") else None,
        "faktur_uploaded_at": _ts(min(p["uploaded_at"] for p in pages)) if pages else None,
        "faktur_pages": [faktur.page_out(p) for p in pages],
        "expiry_entered_at": max(entered) if entered else None,
        "expiry_due": bool(pages) and not entered and r["status"] != "cancelled",
        "extra_units": sum(max(0, (l["qty_received"] or 0) - (l["qty_confirmed"] or 0))
                           for l in out_lines if l["qty_received"] is not None),
        "open_issues": int(issues["n"]),
    }


async def _get(rep_id: int, *states: str) -> dict:
    row = await db.fetch_one("SELECT * FROM replenishments WHERE id = %s", (rep_id,))
    if not row:
        raise HTTPException(404, "Permintaan restock tidak ditemukan. / Replenishment not found.")
    if states and row["status"] not in states:
        raise HTTPException(
            409, f"{row['reference']} sudah {row['status']}: langkah ini tidak berlaku lagi. / "
                 f"{row['reference']} is already {row['status']}: this step no longer applies.")
    return row


def _need_hq(user: auth.User, what_id: str, what_en: str) -> None:
    # at_least("hq") also lets in every role ranked above Ops HQ (Ops Head, superadmin).
    if not user.at_least("hq"):
        raise HTTPException(403, f"Hanya Ops HQ yang bisa {what_id}. / Only Ops HQ can {what_en}.")


# --- alerts ---------------------------------------------------------------------

@router.get("/replenishment/alerts", response_model=models.ReplenishmentAlertList)
async def alerts(
    site_id: int | None = None,
    brand_id: int | None = None,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Every SKU that has fallen to its restock point: at every hub for Ops HQ,
    at their own hubs for an SPV."""
    where, params = ["st.active = 1", "st.site_type <> 'hub'", "st.is_training = 0"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where[-1] = "1=1"      # an explicit site may be the training site
        where.append("sa.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("sa.site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    # Wrapped rather than HAVING without GROUP BY: that is a MySQL extension,
    # and OceanBase is the engine this runs on.
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
        # Fill back up to isi sampai (§4.4: "a suggested quantity up to isi sampai").
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


# --- the request itself -----------------------------------------------------------

@router.get("/replenishments", response_model=models.BrandReplenishmentList)
async def list_replenishments(
    site_id: int | None = None,
    status: str = Query(default="active",
                        pattern="^(active|arriving|variance|expiry|all|draft|raised|po|sent|"
                                "confirmed|receiving|variance_review|variance_signoff|received|"
                                "cancelled)$"),
    limit: int = Query(default=100, ge=1, le=300),
    user: auth.User = Depends(auth.current_user),
):
    """HQ sees all hubs. A hub sees its own: staff need the confirmed ones to
    know what is on its way.

    `expiry` is Ops HQ's list for *ED dari Faktur*: the Faktur is uploaded and
    no expiry date has been entered yet.
    """
    where, params = ["1=1"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if status == "active":
        where.append(f"status IN {_sql_in(ACTIVE_STATES)}")
    elif status == "arriving":
        # What a station can receive: confirmed, or partly received in batches.
        where.append("status IN ('confirmed','receiving')")
    elif status == "variance":
        where.append("status IN ('variance_review','variance_signoff')")
    elif status == "expiry":
        where.append(
            "status <> 'cancelled' "
            "AND EXISTS (SELECT 1 FROM faktur_documents fd "
            "            WHERE fd.replenishment_id = replenishments.id) "
            "AND NOT EXISTS (SELECT 1 FROM replenishment_lines rl "
            "                WHERE rl.replenishment_id = replenishments.id "
            "                  AND rl.expiry_entered_at IS NOT NULL)")
    elif status != "all":
        where.append("status = %s")
        params.append(status)
    ids = await db.fetch_all(
        "SELECT id FROM replenishments WHERE " + " AND ".join(where) +
        " ORDER BY FIELD(status,'variance_review','variance_signoff','receiving','confirmed',"
        "'sent','po','raised','draft','received','cancelled'), id DESC "
        "LIMIT %s", (*params, limit))
    return {"replenishments": [await _payload(i["id"]) for i in ids]}


@router.get("/replenishments/{rep_id}", response_model=models.Replenishment)
async def get_replenishment(rep_id: int, user: auth.User = Depends(auth.current_user)):
    row = await _get(rep_id)
    await auth.assert_site_access(user, row["site_id"])
    return await _payload(rep_id)


def _clean_lines(lines: list[models.ReplenishmentLineIn], field: str) -> dict[int, int]:
    out: dict[int, int] = {}
    for l in lines:
        qty = getattr(l, field)
        if qty is None:
            continue
        if qty < 0:
            raise HTTPException(422, "Jumlah tidak boleh negatif. / Quantities cannot be negative.")
        out[l.sku_id] = qty
    return out


async def _assert_brand(sku_ids, brand_id: int) -> None:
    ids = list(sku_ids)
    if not ids:
        return
    skus = await db.fetch_all(
        f"SELECT id, brand_id FROM skus WHERE id IN ({db.placeholders(ids)})", ids)
    if len(skus) != len(ids) or any(s["brand_id"] != brand_id for s in skus):
        raise HTTPException(422, "Semua produk harus dari brand yang sama. / "
                                 "Every product must be from the same brand.")


async def _stock_and_fill(site_id: int, sku_ids: list[int]) -> dict[int, dict]:
    """Per SKU at one hub: what is held now and its isi sampai."""
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
        out[n["sku_id"]] = {
            "stock": q.get(n["sku_id"], 0),
            "fill_to": fill_to(n["full_threshold"] or n["default_full_threshold"],
                               n["restock_point"] or n["default_restock_point"]),
        }
    return out


@router.post("/replenishments", response_model=models.Replenishment, status_code=201)
async def create_replenishment(
    body: models.ReplenishmentIn, user: auth.User = Depends(auth.require("supervisor"))
):
    """A draft by hand, from the alerts, or (Ops HQ, `fill_all`) a hub's first
    delivery: every active SKU of the brand, each filled up to its isi sampai.

    A first delivery keeps SKUs with no isi sampai yet at 0, so Ops HQ sees them
    on *Buat PO* and types a number; *Simpan PO* drops any line still at 0.
    """
    site = await auth.assert_site_access(user, body.site_id)
    if body.fill_all:
        _need_hq(user, "membuat permintaan pertama untuk semua SKU",
                 "start a first delivery for every SKU")
        skus = await db.fetch_all(
            "SELECT id FROM skus WHERE brand_id = %s AND active = 1 ORDER BY name_display",
            (body.brand_id,))
        if not skus:
            raise HTTPException(422, "Brand ini belum punya SKU aktif. / "
                                     "This brand has no active SKU yet.")
        nums = await _stock_and_fill(body.site_id, [s["id"] for s in skus])
        lines = {s["id"]: max(0, (nums[s["id"]]["fill_to"] or 0) - nums[s["id"]]["stock"])
                 for s in skus}
    else:
        lines = {k: v for k, v in _clean_lines(body.lines, "qty_requested").items() if v > 0}
        if not lines:
            raise HTTPException(422, "Isi minimal satu produk dengan jumlah. / "
                                     "Add at least one line.")
        await _assert_brand(lines, body.brand_id)

    async with db.tx() as cur:
        seq = await db.one(cur, "SELECT COUNT(*) AS n FROM replenishments WHERE site_id = %s",
                           (body.site_id,))
        reference = f"RPL-{site['code'].split('-')[-1]}-{date.today():%y%m}-{int(seq['n']) + 1:03d}"
        rep_id = await db.run(
            cur,
            "INSERT INTO replenishments (reference, site_id, brand_id, note, created_by) "
            "VALUES (%s,%s,%s,%s,%s)",
            (reference, body.site_id, body.brand_id, (body.note or "").strip()[:400] or None,
             user.email))
        for sku_id, qty in lines.items():
            await db.run(cur, "INSERT INTO replenishment_lines (replenishment_id, sku_id, "
                              "qty_requested) VALUES (%s,%s,%s)", (rep_id, sku_id, qty))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="create",
                           after={"reference": reference, "lines": len(lines),
                                  "fill_all": body.fill_all})
    return await _payload(rep_id)


@router.put("/replenishments/{rep_id}/lines", response_model=models.Replenishment)
async def edit_draft(
    rep_id: int, body: models.ReplenishmentEditIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Change what is asked for: the SPV while it is a draft, Ops HQ also once
    it has been raised. From *Simpan PO* on the quantities are frozen."""
    row = await _get(rep_id, "draft", "raised")
    await auth.assert_site_access(user, row["site_id"])
    if row["status"] == "raised":
        _need_hq(user, "mengubah permintaan yang sudah diajukan",
                 "change a request that has been raised")
    lines = {k: v for k, v in _clean_lines(body.lines, "qty_requested").items() if v > 0}
    if not lines:
        raise HTTPException(422, "Permintaan perlu minimal satu produk. Batalkan saja kalau tidak "
                                 "jadi. / A request needs at least one line. Cancel it instead.")
    await _assert_brand(lines, row["brand_id"])
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM replenishment_lines WHERE replenishment_id = %s",
                     (rep_id,))
        for sku_id, qty in lines.items():
            await db.run(cur, "INSERT INTO replenishment_lines (replenishment_id, sku_id, "
                              "qty_requested) VALUES (%s,%s,%s)", (rep_id, sku_id, qty))
        if body.note is not None:
            await db.run(cur, "UPDATE replenishments SET note = %s WHERE id = %s",
                         (body.note.strip()[:400] or None, rep_id))
    return await _payload(row["id"])


@router.post("/replenishments/{rep_id}/raise", response_model=models.Replenishment)
async def raise_to_hq(
    rep_id: int, body: models.ReplenishmentRaiseIn | None = None,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """*Ajukan ke Ops HQ* (§4.1 step 2): the SPV has checked the draft and hands
    it to Ops HQ, who alone makes the PO and sends it to the brand."""
    row = await _get(rep_id, "draft")
    await auth.assert_site_access(user, row["site_id"])
    n = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM replenishment_lines WHERE replenishment_id = %s "
        "AND qty_requested > 0", (rep_id,))
    if not int(n["n"]):
        raise HTTPException(422, "Isi minimal satu produk dengan jumlah dulu. / "
                                 "Add at least one product with a quantity first.")
    note = ((body.note if body else None) or "").strip()[:400] or None
    async with db.tx() as cur:
        await db.run(cur, "UPDATE replenishments SET status = 'raised', raised_by = %s, "
                          "raised_at = NOW(), raise_note = %s WHERE id = %s",
                     (user.email, note, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="raise", after={"note": note})
    return await _payload(rep_id)


# --- the PO: Ops HQ checks the header and quantities, saves, downloads -----------

def _header_from_row(r: dict) -> dict:
    return {
        "reference": r["reference"],
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
    """What the WMS fills in before Ops HQ edits anything (§4.4.5).

    The brands and sites tables are read with SELECT * so a restock contact or
    a legal name added by a later migration is picked up without a change here;
    today the brands table has neither, so those fields start empty.
    """
    brand = await db.fetch_one("SELECT * FROM brands WHERE id = %s", (r["brand_id"],)) or {}
    site = await db.fetch_one("SELECT * FROM sites WHERE id = %s", (r["site_id"],)) or {}
    legal = _first(brand, "legal_name", "company_name", "principal_name")
    contact = " · ".join(x for x in (
        _first(brand, "restock_contact_name", "restock_contact", "contact_name", "pic_name"),
        _first(brand, "restock_contact_email", "restock_email", "contact_email", "pic_email"),
        _first(brand, "restock_contact_phone", "restock_whatsapp", "contact_phone",
               "contact_whatsapp", "pic_phone"),
    ) if x) or None
    short = (site.get("code") or "").split("-")[-1]
    name = site.get("name") or short
    store = (f"Ninja Van Dark Store {name}" if short and short in name
             else f"Ninja Van Dark Store {short} {name}".strip())
    address = _first(site, "address")
    today = daycolor.local_date()
    return {
        "reference": r["reference"],
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


async def _barcodes(sku_ids: list[int]) -> dict[int, str]:
    """One barcode per SKU for the PO: a manufacturer barcode first.

    Test numbers (source 'test', or the 299 prefix the dev seed uses for "no
    barcode yet") are not a barcode the brand can check, so they count as
    MISSING.
    """
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


async def _po_lines(r: dict) -> list[dict]:
    """The lines as the PO shows them: frozen numbers once saved, live before."""
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
            "barcode": codes.get(x["sku_id"]), "unit_size": x.get("unit_size"),
            "current_stock": int(stock if stock is not None else now.get("stock", 0)),
            "fill_to": fill if fill is not None else now.get("fill_to"),
            "qty_requested": x["qty_requested"], "note": x.get("po_note"),
        })
    return out


@router.get("/replenishments/{rep_id}/po-header", response_model=models.PoDraft)
async def po_header(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Buat PO*: the header filled in and each line with its stock, isi sampai
    and barcode. Before the PO is saved the defaults are fresh; after, what was
    saved."""
    r = await _get(rep_id)
    if r["status"] == "cancelled":
        raise HTTPException(409, f"{r['reference']} sudah dibatalkan. / "
                                 f"{r['reference']} was cancelled.")
    saved = bool(r.get("po_saved_at"))
    header = _header_from_row(r) if saved else await _default_header(r, user)
    return {"replenishment_id": r["id"], "status": r["status"], "saved": saved,
            "header": header, "lines": await _po_lines(r)}


def _parse_day(v: str | None, label_id: str, label_en: str) -> date | None:
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        raise HTTPException(422, f"{label_id}: tanggal tidak valid. / {label_en}: not a valid date.")


def _text(v: str | None, n: int) -> str | None:
    return (v or "").strip()[:n] or None


@router.put("/replenishments/{rep_id}/po", response_model=models.Replenishment)
async def save_po(
    rep_id: int, body: models.PoSaveIn, user: auth.User = Depends(auth.require("hq")),
):
    """*Simpan PO* (§4.1 step 3). From draft or raised: the header and the final
    quantities, and the quantities freeze. Once saved (state po) Ops HQ can
    still correct the header and the line notes until it is sent, but not a
    quantity: the brand may already have the Excel.

    The stock and isi sampai are frozen onto each line with the quantities, so
    the Excel says tomorrow what Ops HQ saw today. The PO number can be edited
    too; it stays unique because receiving finds a delivery by it.
    """
    r = await _get(rep_id, "draft", "raised", "po")
    reference = (body.reference or "").strip().upper()
    if not REFERENCE_RE.match(reference):
        raise HTTPException(422, "Nomor PO: huruf besar, angka dan tanda minus, 3 sampai 32 "
                                 "karakter. / PO number: capitals, digits and hyphens, 3 to 32 "
                                 "characters.")
    if reference != r["reference"]:
        clash = await db.fetch_one(
            "SELECT id FROM replenishments WHERE reference = %s AND id <> %s", (reference, rep_id))
        if clash:
            raise HTTPException(409, f"Nomor PO {reference} sudah dipakai. / "
                                     f"PO number {reference} is already used.")
    po_date = _parse_day(body.po_date, "Tanggal PO", "PO date") or daycolor.local_date()
    requested = _parse_day(body.po_requested_date, "Tanggal kirim", "Requested delivery date")
    if requested and requested < po_date:
        raise HTTPException(422, "Tanggal kirim tidak boleh sebelum tanggal PO. / "
                                 "The requested delivery date cannot be before the PO date.")
    header = (reference, po_date, _text(body.po_to, 255), _text(body.po_brand_contact, 255),
              _text(body.po_deliver_to, 400), _text(body.po_receiving_hours, 64), requested,
              _text(body.po_created_by_name, 255), _text(body.po_note, 400))
    set_header = ("reference = %s, po_date = %s, po_to = %s, po_brand_contact = %s, "
                  "po_deliver_to = %s, po_receiving_hours = %s, po_requested_date = %s, "
                  "po_created_by_name = %s, po_note = %s")

    if r["status"] == "po":
        # Frozen quantities: only the notes on the lines may still change.
        notes = {}
        if body.lines:
            have = {x["sku_id"]: x["qty_requested"] for x in await db.fetch_all(
                "SELECT sku_id, qty_requested FROM replenishment_lines "
                "WHERE replenishment_id = %s", (rep_id,))}
            for l in body.lines:
                if l.qty_requested != have.get(l.sku_id, 0):
                    raise HTTPException(409, "PO sudah disimpan: jumlahnya tidak bisa diubah lagi. "
                                             "Batalkan dan buat baru kalau perlu. / The PO is saved: "
                                             "its quantities cannot change. Cancel it and start "
                                             "again if needed.")
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
                               entity_id=rep_id, action="po_header",
                               after={"reference": reference})
        return await _payload(rep_id)

    if body.lines is None:
        raise HTTPException(422, "Isi jumlah per produk. / Enter the quantity per product.")
    lines = {l.sku_id: (l.qty_requested, _text(l.note, 255))
             for l in body.lines if l.qty_requested > 0}
    if not lines:
        raise HTTPException(422, "PO perlu minimal satu produk dengan jumlah. / "
                                 "A PO needs at least one product with a quantity.")
    await _assert_brand(lines, r["brand_id"])
    nums = await _stock_and_fill(r["site_id"], list(lines))
    async with db.tx() as cur:
        # Nothing is confirmed or received before the PO, so the lines can be rebuilt.
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
            f"UPDATE replenishments SET {set_header}, status = 'po', po_saved_by = %s, "
            "po_saved_at = NOW() WHERE id = %s", (*header, user.email, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="po_save",
                           after={"reference": reference, "lines": len(lines),
                                  "units": sum(q for q, _ in lines.values())})
    return await _payload(rep_id)


@router.get("/replenishments/{rep_id}/po.xlsx")
async def po_xlsx(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Unduh PO (Excel)* (§4.1 step 4): in English, the approved layout, a
    printed EAN-13 per SKU, MISSING where the WMS has no barcode."""
    r = await _get(rep_id, *PO_STATES)
    lines = [{
        "brand_sku_code": l["brand_sku_code"], "hiryu_sku_code": l["hiryu_sku_code"],
        "barcode": l["barcode"], "name": l["sku_name"], "size": l["unit_size"],
        "current_stock": l["current_stock"], "fill_to": l["fill_to"],
        "qty": l["qty_requested"], "note": l["note"],
    } for l in await _po_lines(r) if l["qty_requested"] > 0]
    data = po_excel.build_po_xlsx(_header_from_row(r), lines)
    name = f"PO {r['reference']}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{name}"',
                 "Cache-Control": "no-store"})


@router.post("/replenishments/{rep_id}/send", response_model=models.Replenishment)
async def mark_sent(rep_id: int, user: auth.User = Depends(auth.require("hq"))):
    """*Tandai terkirim* (§4.1 step 5): Ops HQ emailed the PO to the brand."""
    await _get(rep_id, "po")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE replenishments SET status='sent', sent_by=%s, sent_at=NOW() "
                          "WHERE id=%s", (user.email, rep_id))
        # The legacy per-SKU restock requests this answers are no longer open.
        await db.run(
            cur,
            "UPDATE restock_requests rr JOIN replenishment_lines rl ON rl.sku_id = rr.sku_id "
            "JOIN replenishments rp ON rp.id = rl.replenishment_id AND rp.site_id = rr.site_id "
            "SET rr.status = 'sent', rr.qty_requested = rl.qty_requested, rr.sent_at = NOW() "
            "WHERE rp.id = %s AND rr.status = 'open'", (rep_id,))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="send")
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/confirm", response_model=models.Replenishment)
async def confirm(
    rep_id: int, body: models.ReplenishmentConfirmIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """*Catat pengiriman* (§4.1 step 6): the brand's AWB, Surat Jalan number,
    arrival date and what it will really send.

    Can be repeated until the delivery is received, because a brand's first
    answer is not always its last. A SKU the brand adds that was not asked for
    is accepted with nothing requested against it.
    """
    row = await _get(rep_id, "sent", "confirmed")
    awb = (body.awb or "").strip().upper()
    if not awb:
        raise HTTPException(422, "Nomor AWB wajib diisi. / The AWB is required.")
    clash = await db.fetch_one(
        "SELECT reference FROM replenishments WHERE awb = %s AND id <> %s "
        "AND status IN ('sent','confirmed','receiving')", (awb, rep_id))
    if clash:
        raise HTTPException(409, f"AWB {awb} sudah dipakai {clash['reference']}. / "
                                 f"AWB {awb} is already on {clash['reference']}.")
    confirmed = _clean_lines(body.lines, "qty_confirmed")
    if not confirmed:
        raise HTTPException(422, "Isi jumlah yang dikirim brand. / "
                                 "Enter the quantities the brand is sending.")
    await _assert_brand(confirmed, row["brand_id"])

    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE replenishments SET status='confirmed', awb=%s, surat_jalan_no=%s, "
            "eta_date=%s, confirmed_by=%s, confirmed_at=NOW() WHERE id=%s",
            (awb, (body.surat_jalan_no or "").strip()[:64] or None, body.eta_date or None,
             user.email, rep_id))
        await db.run(cur, "UPDATE replenishment_lines SET qty_confirmed = 0 "
                          "WHERE replenishment_id = %s", (rep_id,))
        for sku_id, qty in confirmed.items():
            await db.run(
                cur,
                "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested, "
                "qty_confirmed) VALUES (%s,%s,0,%s) "
                "ON DUPLICATE KEY UPDATE qty_confirmed = VALUES(qty_confirmed)",
                (rep_id, sku_id, qty))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="confirm",
                           after={"awb": awb, "surat_jalan_no": body.surat_jalan_no,
                                  "units": sum(confirmed.values())})
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/cancel", response_model=models.Replenishment)
async def cancel(rep_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """The SPV may drop a draft or a raised request of their hub. From the PO
    on it is Ops HQ's: the brand may already have it."""
    row = await _get(rep_id, *OPEN_STATES)
    await auth.assert_site_access(user, row["site_id"])
    if row["status"] not in ("draft", "raised"):
        _need_hq(user, "membatalkan PO", "cancel a PO")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE replenishments SET status='cancelled' WHERE id=%s", (rep_id,))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="cancel", before={"status": row["status"]})
    return await _payload(rep_id)


# --- expiry dates from the Faktur (§4.1 step 7, §5.5) ------------------------------

def month_end(v: str | None) -> date | None:
    """'2027-03' -> 2027-03-31. The ED on a pack is a month; the product is good
    through the end of it. Empty -> None (aged from the inbound date)."""
    v = (v or "").strip()
    if not v:
        return None
    m = MONTH_RE.match(v)
    if not m or not 1 <= int(m.group(2)) <= 12 or not 2000 <= int(m.group(1)) <= 2100:
        raise HTTPException(422, f"ED '{v}': tulis bulan dan tahun (YYYY-MM). / "
                                 f"ED '{v}': give the month and year (YYYY-MM).")
    y, mo = int(m.group(1)), int(m.group(2))
    return date(y, mo, calendar.monthrange(y, mo)[1])


@router.put("/replenishments/{rep_id}/expiry", response_model=models.Replenishment)
async def enter_expiry(
    rep_id: int, body: models.ExpiryIn, user: auth.User = Depends(auth.require("hq")),
):
    """*ED dari Faktur*: Ops HQ types each SKU's expiry month from the signed
    Faktur the SPV uploaded. Empty means the Faktur lists none, and the stock
    is aged from the day it arrived.

    Only after the Faktur is uploaded: the dates come from that paper, never
    from the receiving bench (§5.3.9). Saving again corrects them. Each date is
    also copied onto the receipt lines of the delivery, the batch record a
    later build picks by.
    """
    row = await _get(rep_id)
    if row["status"] == "cancelled":
        raise HTTPException(409, f"{row['reference']} sudah dibatalkan. / "
                                 f"{row['reference']} was cancelled.")
    has = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM faktur_documents WHERE replenishment_id = %s", (rep_id,))
    if not int(has["n"]):
        raise HTTPException(409, "Faktur belum diunggah SPV. ED diisi dari Faktur yang sudah "
                                 "ditandatangani. / The SPV has not uploaded the Faktur yet; "
                                 "expiry dates come from the signed Faktur.")
    have = {x["sku_id"] for x in await db.fetch_all(
        "SELECT sku_id FROM replenishment_lines WHERE replenishment_id = %s", (rep_id,))}
    dates = {}
    for l in body.lines:
        if l.sku_id not in have:
            raise HTTPException(422, "Produk itu tidak ada di PO ini. / "
                                     "That product is not on this PO.")
        dates[l.sku_id] = month_end(l.expiry_month)
    if not dates:
        raise HTTPException(422, "Tidak ada baris. / No lines given.")
    async with db.tx() as cur:
        for sku_id, d in dates.items():
            await db.run(
                cur,
                "UPDATE replenishment_lines SET expiry_date = %s, expiry_entered_by = %s, "
                "expiry_entered_at = NOW() WHERE replenishment_id = %s AND sku_id = %s",
                (d, user.email, rep_id, sku_id))
            await db.run(
                cur,
                "UPDATE receipt_lines r JOIN inbound_receipts ir ON ir.id = r.receipt_id "
                "SET r.expiry_date = %s WHERE ir.replenishment_id = %s AND r.sku_id = %s",
                (d, rep_id, sku_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="expiry",
                           after={str(k): (str(v) if v else None) for k, v in dates.items()})
    return await _payload(rep_id)


# --- the receiving side, called from inbound ------------------------------------

async def find_by_awb(site_id: int, awb: str) -> dict | None:
    return await db.fetch_one(
        "SELECT * FROM replenishments WHERE site_id = %s AND (awb = %s OR reference = %s) "
        "AND status IN ('confirmed','receiving','variance_review','variance_signoff','received') "
        "ORDER BY id DESC LIMIT 1",
        (site_id, awb.strip().upper(), awb.strip().upper()))


async def close_on_receipt(cur, receipt: dict, final: bool = True) -> None:
    """A batch against a replenishment completed: copy what arrived back.

    One AWB can arrive in several batches (as many SKUs at a time as the hub has
    temporary inbound bins), so what was received is the sum over every
    completed batch. Only the last batch compares with the brand's
    confirmation; until then the request is 'receiving'.
    """
    rep_id = receipt.get("replenishment_id")
    if not rep_id:
        return
    got = ("SELECT r.sku_id, SUM(r.qty_received) AS q FROM receipt_lines r "
           "JOIN inbound_receipts ir ON ir.id = r.receipt_id "
           "WHERE ir.replenishment_id = %s AND ir.status <> 'open' GROUP BY r.sku_id")
    await db.run(
        cur,
        "UPDATE replenishment_lines rl LEFT JOIN (" + got + ") t ON t.sku_id = rl.sku_id "
        "SET rl.qty_received = COALESCE(t.q, 0) "
        "WHERE rl.replenishment_id = %s", (rep_id, rep_id))
    # Something arrived that the brand never confirmed: record it on the request too.
    await db.run(
        cur,
        "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested, "
        "qty_confirmed, qty_received) "
        "SELECT %s, t.sku_id, 0, 0, t.q FROM (" + got + ") t "
        "WHERE t.q > 0 AND NOT EXISTS ("
        "  SELECT 1 FROM replenishment_lines x WHERE x.replenishment_id = %s "
        "  AND x.sku_id = t.sku_id)", (rep_id, rep_id, rep_id))
    rep = await db.one(cur, "SELECT status, signed_off_at FROM replenishments WHERE id = %s "
                            "FOR UPDATE", (rep_id,))
    diff = await db.one(
        cur, "SELECT COUNT(*) AS n FROM replenishment_lines WHERE replenishment_id = %s "
             "AND COALESCE(qty_received, 0) <> COALESCE(qty_confirmed, 0)", (rep_id,))
    if rep["signed_off_at"]:
        # Already signed off; the billed numbers stand. A late put-away after
        # that is stock, not billing, and is not reopened here.
        pass
    elif not final:
        # More of this AWB is still to come in the next batch.
        await db.run(cur, "UPDATE replenishments SET status='receiving' WHERE id=%s", (rep_id,))
        return
    elif int(diff["n"]):
        # Anything different from the brand's confirmation needs the SPV first.
        # A change after the SPV submitted sends it back to them.
        await db.run(
            cur,
            "UPDATE replenishments SET status='variance_review', "
            "received_at=COALESCE(received_at, NOW()), acknowledged_by=NULL, "
            "acknowledged_at=NULL WHERE id=%s", (rep_id,))
    else:
        await db.run(
            cur,
            "UPDATE replenishments SET status='received', "
            "received_at=COALESCE(received_at, NOW()) WHERE id=%s", (rep_id,))
    await db.run(
        cur,
        "UPDATE restock_requests rr JOIN replenishment_lines rl ON rl.sku_id = rr.sku_id "
        "JOIN replenishments rp ON rp.id = rl.replenishment_id AND rp.site_id = rr.site_id "
        "SET rr.status = 'fulfilled' WHERE rp.id = %s AND rr.status IN ('open','sent')",
        (rep_id,))


# --- variance: SPV acknowledges, Ops HQ signs off ----------------------------------

@router.post("/replenishments/{rep_id}/acknowledge", response_model=models.Replenishment)
async def acknowledge_variance(
    rep_id: int, body: models.VarianceAcknowledgeIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """The hub's SPV stands behind a count for every SKU that differs.

    Each differing line needs the SPV's final number and a reason. The number
    may differ from what was scanned -- a recount found a unit in the wrong
    carton -- in which case the stock is corrected when HQ signs off, not now.
    """
    row = await _get(rep_id, "variance_review")
    await auth.assert_site_access(user, row["site_id"])
    lines = await db.fetch_all(
        "SELECT rl.*, s.name_display FROM replenishment_lines rl JOIN skus s ON s.id = rl.sku_id "
        "WHERE rl.replenishment_id = %s", (rep_id,))
    given = {l.sku_id: l for l in body.lines}
    updates = []
    for l in lines:
        received = l["qty_received"] or 0
        confirmed = l["qty_confirmed"] or 0
        g = given.get(l["sku_id"])
        final = g.qty_final if g and g.qty_final is not None else received
        if final < 0:
            raise HTTPException(422, "Jumlah tidak boleh negatif. / Quantities cannot be negative.")
        note = ((g.note if g else None) or "").strip()
        if final != confirmed and not note:
            raise HTTPException(
                422, f"{l['name_display']}: tulis alasan selisih ({final} vs {confirmed} "
                     f"dikonfirmasi brand). / Give a reason for the difference.")
        updates.append((final, note[:255] or None, l["id"]))
    async with db.tx() as cur:
        for final, note, line_id in updates:
            await db.run(cur, "UPDATE replenishment_lines SET qty_final = %s, final_note = %s "
                              "WHERE id = %s", (final, note, line_id))
        await db.run(
            cur,
            "UPDATE replenishments SET status='variance_signoff', acknowledged_by=%s, "
            "acknowledged_at=NOW() WHERE id=%s", (user.email, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="variance_acknowledge",
                           after={"lines": [{"line": u[2], "final": u[0]} for u in updates]})
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/sign-off", response_model=models.Replenishment)
async def sign_off_variance(
    rep_id: int, body: models.VarianceSignOffIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Ops HQ accepts the SPV's numbers. They become the billed quantities, and
    any line the SPV corrected away from the scan is adjusted in stock."""
    row = await _get(rep_id, "variance_signoff")
    site = await db.fetch_one("SELECT is_training FROM sites WHERE id = %s", (row["site_id"],))
    lines = await db.fetch_all(
        "SELECT rl.*, r.location_id FROM replenishment_lines rl "
        "LEFT JOIN receipt_lines r ON r.receipt_id = %s AND r.sku_id = rl.sku_id "
        "WHERE rl.replenishment_id = %s", (row["receipt_id"], rep_id))
    async with db.tx() as cur:
        for l in lines:
            if l["qty_final"] is None:
                continue
            delta = l["qty_final"] - (l["qty_received"] or 0)
            if not delta:
                continue
            location_id = l["location_id"]
            if not location_id:
                slot = await common.slot_for(row["site_id"], l["sku_id"])
                location_id = slot["location_id"] if slot else None
            if not location_id:
                raise HTTPException(409, "Salah satu SKU belum punya rak di hub ini: "
                                         "tempatkan dulu sebelum tanda tangan. / A SKU has no "
                                         "rack at this hub yet: give it one before signing.")
            await ledger.apply(
                cur, site_id=row["site_id"], sku_id=l["sku_id"], location_id=location_id,
                qty_delta=delta, movement_type="receipt_adjust", actor_email=user.email,
                ref_type="replenishment", ref_id=rep_id,
                reason_code=(l["final_note"] or "variance_signoff")[:64],
                scan_source="system", is_training=bool(site and site["is_training"]))
        await db.run(
            cur,
            "UPDATE replenishments SET status='received', signed_off_by=%s, signed_off_at=NOW(), "
            "review_note=COALESCE(%s, review_note) WHERE id=%s",
            (user.email, (body.note or "").strip()[:400] or None, rep_id))
        await ledger.audit(cur, actor_email=user.email, entity="replenishment",
                           entity_id=rep_id, action="variance_sign_off")
    return await _payload(rep_id)


@router.post("/replenishments/{rep_id}/send-back", response_model=models.Replenishment)
async def send_back_variance(
    rep_id: int, body: models.VarianceSignOffIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Ops HQ does not accept the SPV's numbers yet: back to the SPV, with why."""
    await _get(rep_id, "variance_signoff")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(422, "Tulis alasan untuk SPV. / Tell the SPV why.")
    await db.execute(
        "UPDATE replenishments SET status='variance_review', review_note=%s WHERE id=%s",
        (note[:400], rep_id))
    return await _payload(rep_id)
