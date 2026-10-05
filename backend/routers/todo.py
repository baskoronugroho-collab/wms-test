"""Perlu tindakan: everything that waits for a person, per role (board 1a).

One list per person, most urgent first. Each row is computed live from the
table where the work waits, so it disappears by itself once the work is done:
nothing here is stored, and nothing needs clearing.

Every row belongs to a role, may have a time it should be settled within, and
names the role it goes to once that time has passed. A missed deadline only
turns the row amber, for its own role AND the next one (staff → SPV → Ops HQ →
Ops Head). Nothing is decided automatically. The times are alert_rules settings
Ops HQ edits on Pengaturan, Aturan & waktu.

Scope: staff and SPVs see their own hubs, Ops HQ and above every hub. Training
sites are left out unless the caller picks one.

Adding a row type: write ``async def rows_x(R, ids, rule, user)`` that calls
``R.add(...)`` and decorate it with ``@provider("x")``. A provider that fails
(a table not there yet on this database) is skipped and logged; the list still
loads. Links are relative to frontend/app/.
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import auth
import db
from routers.opname import (full_count_status, hub_short, nth_working_day, table_exists,
                            utcnow, wib_day_start_utc, wib_today, WIB)

router = APIRouter(prefix="/api/todo", tags=["perlu tindakan"])
log = logging.getLogger("wms.todo")

# Whose rows a role sees. A superadmin sees Ops HQ's and the Ops Head's.
SEES = {
    "staff": {"staff"},
    "hub_operator": {"staff"},
    "supervisor": {"supervisor"},
    "hq": {"hq"},
    "ops_head": {"ops_head"},
    "superadmin": {"hq", "ops_head"},
}
# Who a late row goes to when the provider names nobody.
NEXT = {"staff": "supervisor", "supervisor": "hq", "hq": "ops_head", "ops_head": None}


class TodoItem(BaseModel):
    kind: str
    role: str
    site_id: int | None = None
    site_code: str | None = None
    title_id: str
    title_en: str
    detail_id: str | None = None
    detail_en: str | None = None
    since: str | None = None
    due_at: str | None = None
    overdue: bool = False
    escalated: bool = False          # shown to the next role because it is late
    urgent: bool = False             # top of the list (Segera)
    due_id: str | None = None        # lewat 2 jam | 3 jam lagi | hari ini
    due_en: str | None = None
    action_id: str | None = None     # the button: Unggah, Lihat, Putuskan, Periksa, Ajukan
    action_en: str | None = None
    link: str | None = None


class TodoCounts(BaseModel):
    total: int
    overdue: int


class TodoList(BaseModel):
    role: str
    counts: TodoCounts
    items: list[TodoItem]


ACTIONS = {
    "lihat": ("Lihat", "View"), "putuskan": ("Putuskan", "Decide"), "periksa": ("Periksa", "Check"),
    "ajukan": ("Ajukan", "Raise"), "unggah": ("Unggah", "Upload"), "setujui": ("Setujui", "Approve"),
    "tinjau": ("Tinjau", "Review"), "hitung": ("Hitung", "Count"), "taruh": ("Taruh", "Put away"),
    "serahkan": ("Serahkan", "Hand over"), "unduh": ("Unduh", "Download"), "buat": ("Buat", "Make"),
    "kerjakan": ("Kerjakan", "Do it"), "lengkapi": ("Lengkapi", "Complete"),
}


def _span(minutes: float) -> tuple[str, str]:
    m = int(abs(minutes))
    if m < 60:
        return f"{m} menit", f"{m} min"
    h = round(m / 60)
    if h < 48:
        return f"{h} jam", f"{h} h"
    return f"{round(h / 24)} hari", f"{round(h / 24)} days"


class _Rows:
    """Collects rows, working out due times, labels and escalation once."""

    def __init__(self, sites: dict[int, dict]):
        self.sites = sites
        self.items: list[dict] = []
        self.now = utcnow()

    def add(self, kind, role, site_id, title, detail=None, since=None,
            within: timedelta | None = None, then: str | None = "default", link=None,
            action: str | None = "lihat", urgent: bool = False, due: datetime | None = None):
        if due is None and since and within is not None:
            due = since + within
        overdue = bool(due and self.now > due)
        if then == "default":
            then = NEXT.get(role)
        site = self.sites.get(site_id) or {}
        if due:
            mins = (due - self.now).total_seconds() / 60
            sp = _span(mins)
            due_id, due_en = ((f"lewat {sp[0]}", f"{sp[1]} late") if overdue else
                              (f"{sp[0]} lagi", f"{sp[1]} left"))
        elif since and (since + WIB).date() == wib_today():
            due_id, due_en = "hari ini", "today"
        else:
            due_id = due_en = None
        a = ACTIONS.get(action or "", (None, None))
        self.items.append({
            "kind": kind, "role": role, "then": then if overdue else None,
            "site_id": site_id, "site_code": hub_short(site.get("code")) if site else None,
            "title_id": title[0], "title_en": title[1],
            "detail_id": detail[0] if detail else None, "detail_en": detail[1] if detail else None,
            "since": since.isoformat() + "Z" if isinstance(since, datetime) else (str(since) if since else None),
            "due_at": due.isoformat() + "Z" if due else None,
            "overdue": overdue, "escalated": False, "urgent": urgent,
            "due_id": due_id, "due_en": due_en, "action_id": a[0], "action_en": a[1], "link": link,
        })


PROVIDERS: list[tuple[str, object]] = []


def provider(name: str):
    """Register a row provider: async fn(R, ids, rule, user)."""
    def wrap(fn):
        PROVIDERS.append((name, fn))
        return fn
    return wrap


async def _rules() -> dict[str, int]:
    rows = await db.fetch_all("SELECT rule_key, value_num FROM alert_rules")
    return {r["rule_key"]: int(r["value_num"]) for r in rows if r["value_num"] is not None}


async def _sites_for(user: auth.User, site_id: int | None) -> dict[int, dict]:
    if site_id:
        site = await auth.assert_site_access(user, site_id)
        return {site["id"]: site}
    if user.at_least("hq"):
        rows = await db.fetch_all(
            "SELECT id, code, site_type, is_training FROM sites "
            "WHERE active = 1 AND is_training = 0 AND site_type <> 'hub'")
    else:
        rows = await db.fetch_all(
            "SELECT s.id, s.code, s.site_type, s.is_training FROM sites s "
            "JOIN user_sites us ON us.site_id = s.id "
            "WHERE us.user_id = %s AND s.active = 1 AND s.is_training = 0 "
            "  AND s.site_type <> 'hub'", (user.id,))
    return {r["id"]: r for r in rows}


@router.get("", response_model=TodoList)
async def todo(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    sites = await _sites_for(user, site_id)
    R = _Rows(sites)
    rule = await _rules()
    ids = list(sites) or [0]
    for name, fn in PROVIDERS:
        try:
            await fn(R, ids, rule, user)
        except Exception:
            log.exception("todo provider %s failed", name)

    mine = SEES.get(user.role, {"staff"})
    items = []
    for i in R.items:
        if i["role"] in mine:
            items.append(i)
        elif i["then"] and i["then"] in mine:
            items.append(dict(i, escalated=True))
    items.sort(key=lambda i: (not i["urgent"], not i["overdue"], i["due_at"] or "9999", i["since"] or "9999"))
    for i in items:
        i.pop("then", None)
    return {"role": user.role,
            "counts": {"total": len(items), "overdue": sum(1 for i in items if i["overdue"])},
            "items": items}


def _ph(ids):
    return db.placeholders(ids)


def _day_end_utc() -> datetime:
    return wib_day_start_utc(wib_today() + timedelta(days=1))


# ==========================================================================
# Restock and inbound (agent I's tables, V17, V25, V29)
# ==========================================================================

@provider("restock")
async def rows_restock(R: _Rows, ids, rule, user):
    reps = await db.fetch_all(
        "SELECT id, reference, site_id, status, created_at, raised_at, po_saved_at, sent_at "
        f"FROM replenishments WHERE site_id IN ({_ph(ids)}) AND status IN ('draft','raised','po','sent')", ids)
    for r in reps:
        ref, sid = r["reference"], r["site_id"]
        link = f"restock.html?id={r['id']}"
        if r["status"] == "draft":
            for role in ("supervisor", "hq"):
                R.add("restock_draft", role, sid,
                      (f"Draf restock {ref}: periksa dan ajukan", f"Restock draft {ref}: check and raise"),
                      ("SKU di titik pesan ulang.", "SKUs at their reorder point."),
                      r["created_at"], timedelta(hours=rule.get("draft_unsent_hours", 4)),
                      "hq" if role == "supervisor" else "ops_head", link, "periksa")
        elif r["status"] == "raised":
            R.add("restock_raised", "hq", sid,
                  (f"{ref} diajukan SPV: buat permintaan", f"{ref} raised by the SPV: make the request"),
                  None, r["raised_at"] or r["created_at"], timedelta(hours=8), "ops_head", link, "buat")
        elif r["status"] == "po":
            R.add("restock_unsent", "hq", sid,
                  (f"Permintaan {ref} belum dikirim ke merek", f"Request {ref} not sent to the brand yet"),
                  ("Kirim Excel lewat email, lalu Tandai terkirim.", "Email the Excel, then Mark sent."),
                  r["po_saved_at"], timedelta(hours=8), "ops_head", link, "lihat")
        else:
            R.add("restock_unconfirmed", "hq", sid,
                  (f"{ref}: merek belum konfirmasi", f"{ref}: the brand has not confirmed"),
                  ("Catat nomor PO merek dan jumlahnya saat merek membalas.",
                   "Record the brand's PO number and quantities when it replies."),
                  r["sent_at"], timedelta(hours=rule.get("sent_unconfirmed_hours", 24)), "ops_head", link, "lihat")


@provider("inbound")
async def rows_inbound(R: _Rows, ids, rule, user):
    ph = _ph(ids)
    ir = await _cols("inbound_receipts")
    # Cartons on the Surat Jalan differ from the count: the SPV decides now.
    if {"sj_cartons", "counted_cartons", "carton_decision"} <= ir:
        for r in await db.fetch_all(
                "SELECT id, site_id, opened_at, sj_cartons, counted_cartons FROM inbound_receipts "
                f"WHERE site_id IN ({ph}) AND status = 'open' AND sj_cartons IS NOT NULL "
                "AND counted_cartons IS NOT NULL AND sj_cartons <> counted_cartons AND carton_decision IS NULL", ids):
            R.add("carton_mismatch", "supervisor", r["site_id"],
                  ("Jumlah kardus beda dengan Surat Jalan", "Cartons differ from the Surat Jalan"),
                  (f"SJ {r['sj_cartons']}, dihitung {r['counted_cartons']}. Putuskan sekarang.",
                   f"SJ {r['sj_cartons']}, counted {r['counted_cartons']}. Decide now."),
                  r["opened_at"], timedelta(minutes=0), "hq", f"barang-masuk.html?receipt={r['id']}",
                  "putuskan", urgent=True)
    if "carton_seen_at" in ir:
        for r in await db.fetch_all(
                "SELECT id, site_id, carton_decided_at FROM inbound_receipts "
                f"WHERE site_id IN ({ph}) AND carton_decision = 'accept_rewrite' AND carton_seen_at IS NULL", ids):
            R.add("carton_rewritten", "hq", r["site_id"],
                  ("SJ ditulis ulang SPV: periksa", "SJ rewritten by the SPV: check"), None,
                  r["carton_decided_at"], None, None, f"barang-masuk.html?receipt={r['id']}", "periksa")
    # A delivery with no PO: Ops HQ at the top, the Ops Head after N minutes.
    if "no_po" in ir:
        for r in await db.fetch_all(
                "SELECT ir.id, ir.site_id, ir.no_po_code, ir.no_po_raised_at, ir.opened_at, b.name AS brand "
                "FROM inbound_receipts ir LEFT JOIN brands b ON b.id = ir.brand_id "
                f"WHERE ir.site_id IN ({ph}) AND ir.no_po = 1 AND ir.no_po_linked_at IS NULL "
                "AND ir.status <> 'refused'", ids):
            since = r["no_po_raised_at"] or r["opened_at"]
            R.add("no_po", "hq", r["site_id"],
                  (f"Segera: kiriman tanpa PO{(' dari ' + r['brand']) if r['brand'] else ''}",
                   f"Now: a delivery with no PO{(' from ' + r['brand']) if r['brand'] else ''}"),
                  (r["no_po_code"] and f"Kode {r['no_po_code']}. Hubungkan ke permintaan atau tolak.",
                   r["no_po_code"] and f"Code {r['no_po_code']}. Link it to a request or refuse it.")
                  if r["no_po_code"] else None,
                  since, timedelta(minutes=rule.get("no_po_alert_minutes", 30)), "ops_head",
                  f"barang-masuk.html?receipt={r['id']}", "putuskan", urgent=True)
    # Differences of a delivery for Ops HQ (24 h); the Ops Head sees them too.
    if await table_exists("inbound_differences"):
        for r in await db.fetch_all(
                "SELECT d.replenishment_id, rp.reference, d.site_id, COUNT(*) AS n, MIN(d.decide_by) AS due, "
                "       MIN(d.created_at) AS since FROM inbound_differences d "
                "JOIN replenishments rp ON rp.id = d.replenishment_id "
                f"WHERE d.site_id IN ({ph}) AND d.status = 'pending' AND d.qty > 0 AND d.decide_by IS NOT NULL "
                "GROUP BY d.replenishment_id, rp.reference, d.site_id", ids):
            link = f"restock.html?tab=selisih&id={r['replenishment_id']}"
            title = (f"Selisih {r['reference']}: setujui", f"Differences on {r['reference']}: approve")
            detail = (f"{r['n']} baris menunggu.", f"{r['n']} line(s) waiting.")
            R.add("inbound_differences", "hq", r["site_id"], title, detail, r["since"], None, "ops_head",
                  link, "setujui", due=r["due"])
            R.add("inbound_differences_info", "ops_head", r["site_id"], title, detail, r["since"], None, None,
                  link, "lihat", due=r["due"])
    if await table_exists("inbound_bin_loads"):
        for r in await db.fetch_all(
                "SELECT site_id, receipt_id, SUM(qty - qty_put - qty_hold) AS units, COUNT(*) AS bins, "
                "       MIN(batched_at) AS since FROM inbound_bin_loads "
                f"WHERE site_id IN ({ph}) AND status = 'batched' AND qty - qty_put - qty_hold > 0 "
                "GROUP BY site_id, receipt_id", ids):
            for role in ("staff", "supervisor"):
                R.add("putaway", role, r["site_id"], ("Taruh di rak", "Put away"),
                      (f"{int(r['units'])} unit di {r['bins']} bin sementara.",
                       f"{int(r['units'])} unit(s) in {r['bins']} temporary bin(s)."),
                      r["since"], None, None, f"barang-masuk.html?tab=taruh&receipt={r['receipt_id']}", "taruh")
    # Faktur to upload after an inbound: SPV within 24 h, Ops HQ's list after 48 h.
    for r in await db.fetch_all(
            "SELECT ir.id, ir.site_id, ir.completed_at, rp.reference, b.name AS brand FROM inbound_receipts ir "
            "LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id LEFT JOIN brands b ON b.id = ir.brand_id "
            f"WHERE ir.site_id IN ({ph}) AND ir.source_type = 'from_brand' AND ir.status = 'completed' "
            "  AND ir.faktur_uploaded_at IS NULL AND ir.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY", ids):
        since = r["completed_at"]
        what = r["reference"] or f"#{r['id']}"
        title = (f"Unggah Faktur bertanda tangan: {what}", f"Upload the signed Faktur: {what}")
        link = f"barang-masuk.html?receipt={r['id']}"
        brand = r["brand"] or ""
        R.add("faktur_upload", "supervisor", r["site_id"], title,
              (f"Barang masuk selesai · {brand}".strip(" ·"), f"Inbound finished · {brand}".strip(" ·")),
              since, timedelta(hours=rule.get("faktur_spv_hours", 24)), None, link, "unggah")
        hq_h = rule.get("faktur_hq_hours", 48)
        if since and R.now > since + timedelta(hours=hq_h):
            R.add("faktur_upload_late", "hq", r["site_id"], title,
                  (f"Belum diunggah setelah {hq_h} jam.", f"Not uploaded after {hq_h} hours."),
                  since, timedelta(hours=hq_h), "ops_head", link, "lihat")
    for r in await db.fetch_all(
            "SELECT id, site_id, opened_at, opened_by FROM inbound_receipts "
            f"WHERE site_id IN ({ph}) AND status = 'open'", ids):
        for role in ("staff", "supervisor"):
            R.add("receiving_open", role, r["site_id"], ("Barang masuk belum selesai", "Receiving not finished"),
                  None, r["opened_at"], None, None, f"barang-masuk.html?receipt={r['id']}", "kerjakan")
    if await table_exists("inbound_units"):
        for r in await db.fetch_all(
                "SELECT site_id, COUNT(*) AS n, MIN(created_at) AS since FROM inbound_units "
                f"WHERE site_id IN ({ph}) AND method = 'manual' AND qty = 1 "
                "AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY GROUP BY site_id", ids):
            R.add("manual_picks", "supervisor", r["site_id"],
                  ("Produk dipilih manual saat barang masuk", "Products picked by hand at inbound"),
                  (f"{r['n']} unit tanpa pindai dalam 24 jam.", f"{r['n']} unit(s) without a scan in 24 hours."),
                  r["since"], None, None, "barang-masuk.html", "lihat")
    # Unknown products from inbound.
    if await table_exists("sku_requests"):
        for r in await db.fetch_all(
                "SELECT site_id, COUNT(*) AS n, MIN(raised_at) AS since FROM sku_requests "
                f"WHERE site_id IN ({ph}) AND status = 'open' GROUP BY site_id", ids):
            R.add("sku_request", "hq", r["site_id"],
                  ("Produk tidak dikenal dari barang masuk", "Unknown products from inbound"),
                  (f"{r['n']} menunggu jawaban.", f"{r['n']} waiting for an answer."),
                  r["since"], timedelta(hours=rule.get("sku_request_open_hours", 24)), "ops_head",
                  "produk.html?tab=permintaan", "periksa")


_COLS: dict[str, set[str]] = {}


async def _cols(table: str) -> set[str]:
    if table not in _COLS:
        rows = await db.fetch_all("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS "
                                  "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", (table,))
        _COLS[table] = {r["c"] for r in rows}
    return _COLS[table]


# ==========================================================================
# Products, Hiryu stores and the link (agents S and L)
# ==========================================================================

@provider("catalogue")
async def rows_catalogue(R: _Rows, ids, rule, user):
    """Not per hub; Ops HQ and above only."""
    if not user.at_least("hq"):
        return
    try:
        from routers.sku_complete import INCOMPLETE_SQL
    except Exception:
        INCOMPLETE_SQL = "(s.bin_size IS NULL)"
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n, MIN(COALESCE(s.hiryu_created_at, s.created_at)) AS since "
        "FROM skus s JOIN brands b ON b.id = s.brand_id WHERE s.active = 1 AND b.active = 1 AND " + INCOMPLETE_SQL)
    if row and row["n"]:
        R.add("sku_complete", "hq", None, ("SKU belum lengkap", "SKUs to complete"),
              (f"{row['n']} SKU tanpa ukuran bin.", f"{row['n']} SKU(s) without a bin size."),
              row["since"], None, None, "produk.html?filter=belum-lengkap", "lengkapi")
    row = await db.fetch_one("SELECT COUNT(*) AS n FROM hiryu_items WHERE active = 1 AND sku_id IS NULL")
    if row and row["n"]:
        R.add("item_no_sku", "hq", None, ("Item menu Hiryu tanpa SKU", "Hiryu menu items without a SKU"),
              (f"{row['n']} item. Hubungkan di Hiryu (Bundles).", f"{row['n']} item(s). Connect them in Hiryu (Bundles)."),
              None, None, None, "menu-toko-hiryu.html", "lihat")
    hs = await _cols("hiryu_stores")
    if {"hiryu_active", "grab_account"} <= hs:
        row = await db.fetch_one("SELECT COUNT(*) AS n, MIN(updated_at) AS since FROM hiryu_stores "
                                 "WHERE hiryu_active = 1 AND (brand_id IS NULL OR grab_account IS NULL)")
        if row and row["n"]:
            R.add("store_no_brand", "hq", None, ("Toko Hiryu menunggu merek", "Hiryu stores waiting for a brand"),
                  (f"{row['n']} toko: pilih merek dan akun Grab.", f"{row['n']} store(s): choose the brand and Grab account."),
                  row["since"], None, None, "menu-toko-hiryu.html?tab=toko", "lengkapi")
    if "order_acceptance" in hs:
        row = await db.fetch_one("SELECT COUNT(*) AS n FROM hiryu_stores WHERE active = 1 "
                                 "AND COALESCE(order_acceptance, '') <> 'MANUAL'")
        if row and row["n"]:
            R.add("store_not_manual", "hq", None,
                  ("Toko tidak di terima MANUAL", "Stores not on MANUAL acceptance"),
                  (f"{row['n']} toko. Minta Shaun mengubahnya di Hiryu.", f"{row['n']} store(s). Ask Shaun to change it in Hiryu."),
                  None, None, None, "menu-toko-hiryu.html?tab=toko", "periksa")
    if await table_exists("hiryu_pending_skus"):
        row = await db.fetch_one("SELECT COUNT(*) AS n, MIN(received_at) AS since FROM hiryu_pending_skus "
                                 "WHERE received_at < UTC_TIMESTAMP() - INTERVAL 1 DAY")
        if row and row["n"]:
            R.add("pending_skus", "hq", None, ("SKU dari Hiryu belum punya merek", "SKUs from Hiryu without a brand"),
                  (f"{row['n']} SKU lebih dari sehari.", f"{row['n']} SKU(s) over a day old."),
                  row["since"], None, None, "menu-toko-hiryu.html", "periksa")
    st = await _cols("sites")
    if {"hiryu_dark_store_id", "setup_completed_at"} <= st:
        for r in await db.fetch_all("SELECT id, code, name, hiryu_received_at, created_at FROM sites "
                                    "WHERE hiryu_dark_store_id IS NOT NULL AND setup_completed_at IS NULL AND active = 1"):
            R.add("hub_setup", "hq", None, (f"Hub baru dari Hiryu: {r['name']}", f"New hub from Hiryu: {r['name']}"),
                  ("Lengkapi kode hub dan bin khusus.", "Complete the hub code and special bins."),
                  r["hiryu_received_at"] or r["created_at"], None, None, f"pengaturan.html?tab=hub&id={r['id']}",
                  "lengkapi")


@provider("link")
async def rows_link(R: _Rows, ids, rule, user):
    """Link problems: the SPV sees held messages at their hubs, Ops HQ failures."""
    ph = _ph(ids)
    wait = rule.get("link_wait_alert_minutes", 5)
    link = "pengaturan.html?tab=integrasi"
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(created_at) AS since FROM pos_outbox "
            f"WHERE site_id IN ({ph}) AND status IN ('pending','sending') "
            "  AND created_at <= UTC_TIMESTAMP() - INTERVAL %s MINUTE GROUP BY site_id", [*ids, wait]):
        R.add("link_waiting", "supervisor", r["site_id"], ("Pesan ke Hiryu tertahan", "Messages to Hiryu held up"),
              (f"{r['n']} menunggu lebih dari {wait} menit.", f"{r['n']} waiting over {wait} minutes."),
              r["since"], timedelta(minutes=0), "hq", link, "lihat")
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(created_at) AS since FROM pos_outbox "
            f"WHERE site_id IN ({ph}) AND status = 'failed' "
            "  AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY GROUP BY site_id", ids):
        R.add("link_failed", "hq", r["site_id"], ("Pesan ke Hiryu gagal", "Messages to Hiryu failed"),
              (f"{r['n']} gagal. Periksa, lalu Coba lagi atau hubungi Shaun.",
               f"{r['n']} failed. Check, then retry or contact Shaun."),
              r["since"], timedelta(minutes=0), "ops_head", link, "periksa")
    if user.at_least("hq"):
        row = await db.fetch_one(
            "SELECT COUNT(*) AS n, MIN(received_at) AS since FROM hiryu_inbound_log "
            "WHERE outcome IN ('refused','problem') AND received_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY")
        if row and row["n"]:
            R.add("link_refused", "hq", None, ("Pesan dari Hiryu ditolak atau bermasalah",
                                                "Messages from Hiryu refused or with a problem"),
                  (f"{row['n']} dalam 24 jam (SKU, SKU pengganti atau toko tidak dikenal).",
                   f"{row['n']} in 24 hours (unknown SKU, replacement SKU or store)."),
                  row["since"], timedelta(minutes=0), "ops_head", link, "periksa")
    if await table_exists("hiryu_catalogue_requests"):
        for r in await db.fetch_all(
                "SELECT site_id, request_id, requested_at FROM hiryu_catalogue_requests "
                f"WHERE site_id IN ({ph}) AND answered_at IS NULL AND requested_at < UTC_TIMESTAMP() - INTERVAL 10 MINUTE "
                "AND requested_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY", ids):
            R.add("catalogue_unanswered", "hq", r["site_id"],
                  ("Sinkron ulang belum dijawab Hiryu", "Hiryu has not answered a re-sync"),
                  None, r["requested_at"], timedelta(minutes=10), "ops_head", link, "periksa")


# ==========================================================================
# The floor: orders, packing, handover, return to shelf (agent O's tables)
# ==========================================================================

@provider("floor")
async def rows_floor(R: _Rows, ids, rule, user):
    ph = _ph(ids)
    start_min = rule.get("pick_start_minutes", 2)
    wait_min = rule.get("handover_wait_minutes", 20)
    for r in await db.fetch_all(
            "SELECT pt.id, pt.site_id, pt.claimed_at, o.hiryu_short_no, o.external_ref "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'claimed' AND pt.claimed_by = %s "
            "  AND pt.started_at IS NULL", [*ids, user.email]):
        gm = r["hiryu_short_no"] or r["external_ref"]
        R.add("my_pick", "staff", r["site_id"], (f"Ambil pesanan {gm}", f"Pick order {gm}"), None,
              r["claimed_at"], timedelta(minutes=start_min), None, "pesanan.html?tab=ambil", "kerjakan")
    for r in await db.fetch_all(
            "SELECT o.site_id, COUNT(*) AS n, MIN(COALESCE(pt.handed_to_pack_at, pt.completed_at)) AS since "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'completed' AND o.status <> 'cancelled' "
            "  AND o.marked_ready_at IS NULL AND o.handed_over_at IS NULL "
            "  AND pt.completed_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY GROUP BY o.site_id", ids):
        R.add("to_pack", "staff", r["site_id"], ("Pesanan menunggu dikemas", "Orders waiting to pack"),
              (f"{r['n']} pesanan di meja kemas.", f"{r['n']} order(s) at the pack bench."),
              r["since"], timedelta(minutes=rule.get("pack_wait_minutes", 3)), "supervisor",
              "pesanan.html?tab=kemas", "kerjakan")
    for r in await db.fetch_all(
            "SELECT id, site_id, marked_ready_at, hiryu_short_no, external_ref FROM orders "
            f"WHERE site_id IN ({ph}) AND marked_ready_at IS NOT NULL AND handed_over_at IS NULL "
            "  AND status <> 'cancelled' AND marked_ready_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY", ids):
        gm = r["hiryu_short_no"] or r["external_ref"]
        since = r["marked_ready_at"]
        R.add("await_driver", "staff", r["site_id"], (f"Paket menunggu driver: {gm}", f"Parcel waiting for the driver: {gm}"),
              (f"Di rak siap ambil sejak {(since + WIB):%H:%M}.", f"On the ready shelf since {(since + WIB):%H:%M}."),
              since, timedelta(minutes=wait_min), "supervisor", "pesanan.html?tab=serah", "lihat")
    for r in await db.fetch_all(
            "SELECT site_id, reason, SUM(qty - qty_returned) AS n, MIN(created_at) AS since FROM return_tasks "
            f"WHERE site_id IN ({ph}) AND status = 'open' GROUP BY site_id, reason", ids):
        n = int(r["n"] or 0)
        src = (("dari karantina", "from quarantine") if r["reason"] == "quarantine"
               else ("dari pesanan batal", "from cancelled orders"))
        R.add("return_to_shelf", "staff", r["site_id"], ("Kembalikan ke rak", "Return to the rack"),
              (f"{n} unit {src[0]}.", f"{n} unit(s) {src[1]}."),
              r["since"], timedelta(hours=2), "supervisor", "pesanan.html?tab=kembalikan", "kerjakan")
    for r in await db.fetch_all(
            "SELECT pt.site_id, o.hiryu_short_no, o.external_ref, pt.claimed_by, pt.claimed_at "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'claimed' AND pt.started_at IS NULL "
            "  AND pt.claimed_at <= UTC_TIMESTAMP() - INTERVAL %s MINUTE", [*ids, start_min]):
        gm = r["hiryu_short_no"] or r["external_ref"]
        R.add("not_started", "supervisor", r["site_id"], (f"{gm} belum mulai diambil", f"{gm} not started"),
              (f"Diberikan ke {r['claimed_by']}.", f"Given to {r['claimed_by']}."),
              r["claimed_at"], timedelta(minutes=0), None, "pesanan.html?tab=papan", "lihat")
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(promised_at) AS since FROM orders "
            f"WHERE site_id IN ({ph}) AND status NOT IN ('cancelled','packed','handed_over') "
            "  AND marked_ready_at IS NULL AND promised_at < UTC_TIMESTAMP() "
            "  AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY GROUP BY site_id", ids):
        R.add("late_orders", "supervisor", r["site_id"], ("Pesanan lewat target siap", "Orders past their ready-by"),
              (f"{r['n']} belum selesai dikemas.", f"{r['n']} not packed yet."),
              r["since"], timedelta(minutes=0), None, "pesanan.html?tab=papan", "lihat")
    for r in await db.fetch_all(
            "SELECT ps.site_id, ps.created_at, ps.qty_required, ps.qty_found, ps.declared_by, "
            "       s.name_display, u.name AS picker FROM pick_shortfalls ps "
            "JOIN skus s ON s.id = ps.sku_id LEFT JOIN users u ON u.email = ps.declared_by "
            f"WHERE ps.site_id IN ({ph}) AND ps.created_at >= %s ORDER BY ps.created_at",
            [*ids, wib_day_start_utc(wib_today())]):
        who = r["picker"] or r["declared_by"] or "?"
        when = (r["created_at"] + WIB).strftime("%H:%M")
        R.add("missing_item", "supervisor", r["site_id"],
              (f"Barang tidak ada: {r['name_display']}", f"Missing item: {r['name_display']}"),
              (f"{who}, {when} · ketemu {r['qty_found']} dari {r['qty_required']}",
               f"{who}, {when} · found {r['qty_found']} of {r['qty_required']}"),
              r["created_at"], None, None, "pesanan.html?tab=papan", "lihat")


# ==========================================================================
# Counts (Section 8)
# ==========================================================================

@provider("counts")
async def rows_counts(R: _Rows, ids, rule, user):
    from routers import opname
    ph = _ph(ids)
    today = wib_today()
    for sid in ids:
        if sid:
            await opname.ensure_plan(sid, today)
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, SUM(status = 'closed') AS done, MIN(created_at) AS since "
            f"FROM count_tasks WHERE site_id IN ({ph}) AND plan_date = %s GROUP BY site_id", [*ids, today]):
        left = int(r["n"]) - int(r["done"] or 0)
        if left > 0:
            R.add("count_plan", "supervisor", r["site_id"],
                  (f"Rencana hitung hari ini: {r['n']} bin", f"Today's count plan: {r['n']} bin(s)"),
                  ("Dibuat WMS pagi ini · cek petugas tiap bin", "Made by the WMS this morning · check each counter"),
                  r["since"], None, None, "hitung-stok.html?tab=rencana", "lihat", due=_day_end_utc())
    for r in await db.fetch_all(
            "SELECT t.site_id, COUNT(*) AS n, MIN(t.created_at) AS since, "
            "       SUM(t.status = 'recount') AS recounts FROM count_tasks t "
            f"WHERE t.site_id IN ({ph}) AND t.assigned_to = %s AND t.status IN ('pending','recount') "
            "AND t.plan_date >= %s GROUP BY t.site_id", [*ids, user.email, today - timedelta(days=2)]):
        R.add("my_counts", "staff", r["site_id"],
              (f"Hitung stok: {r['n']} bin untuk Anda", f"Stock count: {r['n']} bin(s) for you"),
              (f"{int(r['recounts'])} hitung ulang.", f"{int(r['recounts'])} recount(s).") if r["recounts"] else None,
              r["since"], None, None, "hitung-stok.html", "hitung", due=_day_end_utc())
    h = rule.get("count_approve_hours", 24)
    for r in await db.fetch_all(
            "SELECT t.site_id, COUNT(*) AS n, MIN(a.finished_at) AS since FROM count_tasks t "
            "JOIN count_attempts a ON a.task_id = t.id AND a.status = 'finished' "
            f"WHERE t.site_id IN ({ph}) AND t.status = 'awaiting_spv' GROUP BY t.site_id", ids):
        R.add("count_approve", "supervisor", r["site_id"],
              (f"Hasil hitung menunggu Setujui SPV: {r['n']} bin", f"Count results to approve: {r['n']} bin(s)"),
              ("Setujui SPV mengubah stok dan Hiryu.", "Approval changes the stock and Hiryu."),
              r["since"], timedelta(hours=h), "hq", "hitung-stok.html?tab=hasil", "setujui")
    # The month-end full count, approved by the Nth working day of the next month.
    first_this = today.replace(day=1)
    last_month_end = first_this - timedelta(days=1)
    by = nth_working_day(today.year, today.month, rule.get("count_full_workdays", 3))
    if today <= by + timedelta(days=7):
        for sid in ids:
            if not sid:
                continue
            st = await full_count_status([sid], last_month_end)
            if st["planned"] and not st["approved"]:
                R.add("full_count_due", "supervisor", sid,
                      (f"Hitung penuh {st['date_label']}: setujui semua bin", f"Full count {st['date']}: approve every bin"),
                      (f"{st['closed']} dari {st['planned']} bin selesai. Paling lambat {st['approve_by_label']}.",
                       f"{st['closed']} of {st['planned']} bins done. Due {st['approve_by']}."),
                      None, None, "hq", "hitung-stok.html?tab=hasil", "setujui",
                      due=wib_day_start_utc(by + timedelta(days=1)))
    rh = rule.get("count_review_hours", 72)
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(approved_at) AS since FROM count_tasks "
            f"WHERE site_id IN ({ph}) AND hq_review = 'pending' GROUP BY site_id", ids):
        R.add("count_review", "hq", r["site_id"],
              (f"Tinjau selisih hitung: {r['n']} bin", f"Review count differences: {r['n']} bin(s)"),
              ("Stok sudah berubah; tinjauan untuk laporan selisih bulanan.",
               "The stock has changed; the review feeds the monthly variance report."),
              r["since"], timedelta(hours=rh), "ops_head", "hitung-stok.html?tab=hasil", "tinjau")


# ==========================================================================
# Quarantine and returns (Section 7)
# ==========================================================================

@provider("quarantine")
async def rows_quarantine(R: _Rows, ids, rule, user):
    from routers import quarantine
    try:
        await quarantine.sync_inbound([i for i in ids if i])
    except Exception:
        log.exception("quarantine sync failed")
    ph = _ph(ids)
    dh = rule.get("quarantine_decide_hours", 24)
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(COALESCE(hq_rejected_at, reported_at)) AS since, "
            "       SUM(COALESCE(hq_rejected_at, reported_at) < UTC_TIMESTAMP() - INTERVAL %s HOUR) AS late, "
            "       SUM(hq_rejected_at IS NOT NULL) AS back, MIN(tray_code) AS tray "
            f"FROM quarantine_items WHERE site_id IN ({ph}) AND status = 'open' GROUP BY site_id", [dh, *ids]):
        bits_id = [r["tray"]] if r["tray"] else []
        bits_en = list(bits_id)
        if r["late"]:
            bits_id.append(f"{int(r['late'])} barang lewat {dh} jam")
            bits_en.append(f"{int(r['late'])} past {dh} h")
        if r["back"]:
            bits_id.append(f"{int(r['back'])} dikembalikan Ops HQ")
            bits_en.append(f"{int(r['back'])} sent back by Ops HQ")
        R.add("quarantine_decide", "supervisor", r["site_id"],
              (f"Keputusan karantina: {r['n']} barang", f"Quarantine decisions: {r['n']} item(s)"),
              (" · ".join(bits_id), " · ".join(bits_en)),
              r["since"], timedelta(hours=dh), "hq", "karantina-retur.html?tab=karantina", "putuskan")
    wh = rule.get("writeoff_approve_hours", 24)
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, SUM(qty) AS units, MIN(decided_at) AS since FROM quarantine_items "
            f"WHERE site_id IN ({ph}) AND status = 'write_off_pending' GROUP BY site_id", ids):
        R.add("writeoff_approve", "hq", r["site_id"],
              (f"Persetujuan hapus: {int(r['units'])} unit", f"Write-offs to approve: {int(r['units'])} unit(s)"),
              ("Periksa alasan dan foto. Beban biaya terisi otomatis.",
               "Check the reason and photo. The cost bearer is already set."),
              r["since"], timedelta(hours=wh), "ops_head", "karantina-retur.html?tab=hapus", "setujui")
    for r in await db.fetch_all(
            "SELECT q.site_id, b.name AS brand, s.brand_id, SUM(q.qty) AS units, MIN(q.decided_at) AS since "
            "FROM quarantine_items q JOIN skus s ON s.id = q.sku_id JOIN brands b ON b.id = s.brand_id "
            f"WHERE q.site_id IN ({ph}) AND q.status = 'return_pending' GROUP BY q.site_id, b.name, s.brand_id", ids):
        R.add("return_to_brand", "supervisor", r["site_id"],
              (f"Retur ke merek {r['brand']}: buat nota", f"Return to {r['brand']}: make the note"),
              (f"{int(r['units'])} unit menunggu. Ikut kiriman merek berikutnya.",
               f"{int(r['units'])} unit(s) waiting. They go back with the brand's next delivery."),
              r["since"], None, None, f"karantina-retur.html?tab=retur&brand={r['brand_id']}", "buat")
    old = rule.get("stock_old_days", 90)
    for r in await db.fetch_all(
            "SELECT ib.site_id, COUNT(*) AS n, MIN(ib.stocked_since) AS since FROM inventory_balances ib "
            "JOIN locations l ON l.id = ib.location_id AND l.is_virtual = 0 "
            f"WHERE ib.site_id IN ({ph}) AND ib.qty_on_hand > 0 AND ib.stocked_since IS NOT NULL "
            "AND ib.stocked_since < UTC_TIMESTAMP() - INTERVAL %s DAY GROUP BY ib.site_id", [*ids, old]):
        R.add("old_stock", "supervisor", r["site_id"],
              (f"Stok lama: {r['n']} bin lebih dari {old} hari", f"Old stock: {r['n']} bin(s) over {old} days"),
              ("Cek ED di kemasan; retur jika sisa kurang dari 6 bulan.",
               "Check the ED on the pack; return when under 6 months are left."),
              None, None, None, "karantina-retur.html?tab=retur", "periksa")
    for r in await db.fetch_all(
            "SELECT rn.id, rn.site_id, rn.reference, rn.created_at, b.name AS brand, rp.reference AS delivery, "
            "       rp.status AS dstatus FROM return_notes rn JOIN brands b ON b.id = rn.brand_id "
            "LEFT JOIN replenishments rp ON rp.id = rn.replenishment_id "
            f"WHERE rn.site_id IN ({ph}) AND rn.status = 'open'", ids):
        detail = ((f"Ikut kiriman {r['delivery']}. Pindai setiap unit, driver tanda tangan.",
                   f"Goes with delivery {r['delivery']}. Scan each unit; the driver signs.")
                  if r["delivery"] else ("Serahkan ke driver merek berikutnya.", "Hand over to the brand's next driver."))
        for role in ("staff", "supervisor"):
            R.add("return_handover", role, r["site_id"],
                  (f"Serahkan retur {r['reference']} ({r['brand']})", f"Hand over return {r['reference']} ({r['brand']})"),
                  detail, r["created_at"], None, None, f"karantina-retur.html?tab=serahkan&note={r['id']}",
                  "serahkan")


# ==========================================================================
# Consumables (Section 9)
# ==========================================================================

@provider("consumables")
async def rows_consumables(R: _Rows, ids, rule, user):
    ph = _ph(ids)
    for r in await db.fetch_all(
            "SELECT c.id, c.site_id, c.name, c.unit, c.stock_qty, c.min_qty FROM consumables c "
            f"WHERE c.site_id IN ({ph}) AND c.active = 1 AND c.min_qty IS NOT NULL AND c.stock_qty < c.min_qty "
            "AND NOT EXISTS (SELECT 1 FROM consumable_requests q WHERE q.consumable_id = c.id "
            "                AND q.status IN ('raised','pr_submitted'))", ids):
        f = lambda v: (f"{float(v):g}".replace(".", ","))
        R.add("consumable_below_min", "supervisor", r["site_id"],
              (f"Bahan kemas di bawah minimum: {r['name']}", f"Consumable below minimum: {r['name']}"),
              (f"Sisa {f(r['stock_qty'])} {r['unit']}, minimum {f(r['min_qty'])}",
               f"{f(r['stock_qty'])} {r['unit']} left, minimum {f(r['min_qty'])}"),
              None, None, None, "bahan-kemas.html", "ajukan", due=_day_end_utc())
    ph_h = rule.get("consumable_pr_hours", 24)
    for r in await db.fetch_all(
            "SELECT q.site_id, c.name, q.raised_at FROM consumable_requests q JOIN consumables c ON c.id = q.consumable_id "
            f"WHERE q.site_id IN ({ph}) AND q.status = 'raised'", ids):
        R.add("consumable_pr", "hq", r["site_id"],
              (f"Permintaan bahan kemas: {r['name']}", f"Consumable need: {r['name']}"),
              ("Ajukan PR di luar WMS, lalu catat nomornya.", "Submit the PR outside the WMS, then record its number."),
              r["raised_at"], timedelta(hours=ph_h), "ops_head", "bahan-kemas.html", "ajukan")
    ah = rule.get("consumable_approve_hours", 24)
    for r in await db.fetch_all(
            "SELECT x.site_id, c.name, x.entered_at, x.status, x.hq_note FROM consumable_receipts x "
            "JOIN consumables c ON c.id = x.consumable_id "
            f"WHERE x.site_id IN ({ph}) AND x.status IN ('pending','returned')", ids):
        if r["status"] == "pending":
            R.add("consumable_receipt", "hq", r["site_id"],
                  (f"Bahan kemas diterima: {r['name']}", f"Consumables received: {r['name']}"),
                  ("Cocokkan dengan PR, lalu setujui.", "Check against the PR, then approve."),
                  r["entered_at"], timedelta(hours=ah), "ops_head", "bahan-kemas.html?tab=terima", "setujui")
        else:
            R.add("consumable_receipt_back", "supervisor", r["site_id"],
                  (f"Penerimaan dikembalikan Ops HQ: {r['name']}", f"Receipt sent back by Ops HQ: {r['name']}"),
                  (r["hq_note"], r["hq_note"]) if r["hq_note"] else None,
                  r["entered_at"], None, None, "bahan-kemas.html?tab=terima", "periksa")
    for r in await db.fetch_all(
            "SELECT site_id, status, counted_at, hq_note FROM consumable_counts "
            f"WHERE site_id IN ({ph}) AND status IN ('pending','returned') "
            "AND counted_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY", ids):
        if r["status"] == "pending":
            R.add("consumable_count", "hq", r["site_id"],
                  ("Hitung mingguan bahan kemas: setujui", "Weekly consumables count: approve"),
                  None, r["counted_at"], timedelta(hours=ah), "ops_head", "bahan-kemas.html?tab=mingguan", "setujui")
        else:
            R.add("consumable_count_back", "supervisor", r["site_id"],
                  ("Hitung mingguan dikembalikan Ops HQ", "Weekly count sent back by Ops HQ"),
                  (r["hq_note"], r["hq_note"]) if r["hq_note"] else None,
                  r["counted_at"], None, None, "bahan-kemas.html?tab=mingguan", "hitung")
    days = rule.get("consumable_count_days", 7)
    have = {r["site_id"]: r["at"] for r in await db.fetch_all(
        f"SELECT site_id, MAX(counted_at) AS at FROM consumable_counts WHERE site_id IN ({ph}) "
        "AND status IN ('pending','approved') GROUP BY site_id", ids)}
    with_items = {r["site_id"] for r in await db.fetch_all(
        f"SELECT DISTINCT site_id FROM consumables WHERE site_id IN ({ph}) AND active = 1", ids)}
    for sid in with_items:
        last = have.get(sid)
        if last is None or last < R.now - timedelta(days=days):
            R.add("consumable_count_due", "supervisor", sid,
                  ("Hitung mingguan bahan kemas", "Weekly consumables count"),
                  (("Belum pernah dihitung.", "Never counted.") if last is None else
                   (f"Terakhir {(last + WIB):%d/%m}.", f"Last on {(last + WIB):%d/%m}.")),
                  None, None, None, "bahan-kemas.html?tab=mingguan", "hitung", due=_day_end_utc())


# ==========================================================================
# Reports (Section 10): Ops HQ's weekly and monthly files
# ==========================================================================

@provider("reports")
async def rows_reports(R: _Rows, ids, rule, user):
    if not user.at_least("hq"):
        return
    now_wib = R.now + WIB
    monday = (now_wib - timedelta(days=now_wib.weekday())).replace(hour=10, minute=0, second=0, microsecond=0)
    if now_wib >= monday:
        since_utc = monday - WIB
        got = await db.fetch_one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'report.brand_sales' "
                                 "AND created_at >= %s AND after_json LIKE %s", (since_utc, "%W%"))
        if not got or not got["n"]:
            R.add("report_weekly", "hq", None,
                  ("Laporan mingguan: penjualan merek dan operasional", "Weekly reports: brand sales and operational"),
                  ("Unduh minggu lalu untuk setiap merek, lalu kirim lewat email.",
                   "Download last week for each brand, then email them."),
                  since_utc, timedelta(hours=8), "ops_head", "laporan.html?tab=penjualan", "unduh")
    today = wib_today()
    last_end = today.replace(day=1) - timedelta(days=1)
    st = await full_count_status([i for i in ids if i], last_end)
    if st["approved"] and today.day <= 20:
        by = nth_working_day(today.year, today.month, rule.get("count_full_workdays", 3))
        got = await db.fetch_one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'report.brand_sales' "
                                 "AND created_at >= %s AND after_json LIKE %s",
                                 (wib_day_start_utc(today.replace(day=1)), f"%{last_end:%Y-%m}%"))
        if not got or not got["n"]:
            R.add("report_monthly", "hq", None,
                  (f"Laporan bulanan merek {last_end:%m/%Y}", f"Monthly brand reports {last_end:%Y-%m}"),
                  ("Hitung akhir bulan sudah disetujui. Unduh dan kirim.", "The month-end count is approved. Download and send."),
                  None, None, "ops_head", "laporan.html?tab=penjualan&period=monthly", "unduh",
                  due=wib_day_start_utc(by + timedelta(days=1)))
        fin = await db.fetch_one("SELECT 1 AS x FROM report_finalisations WHERE report_key = 'variance' "
                                 "AND period = %s", (f"{last_end:%Y-%m}",))
        if not fin:
            R.add("variance_finalise", "hq", None,
                  (f"Laporan selisih {last_end:%m/%Y}: finalkan", f"Variance report {last_end:%Y-%m}: finalise"),
                  ("Tinjau selisih yang tersisa, lalu Finalkan.", "Review what is left, then Finalise."),
                  None, None, "ops_head", "laporan.html?tab=selisih", "periksa",
                  due=wib_day_start_utc(by + timedelta(days=1)))
