"""Perlu tindakan: what each role must settle (PRD §13.5).

One list per person, most urgent first. Each row is computed live from the
table where the work waits, so it disappears by itself once the work is done:
nothing here is stored, and nothing needs clearing.

Every row belongs to a role, has a time it should be settled within, and names
the role it goes to once that time has passed. A row past its time is shown
amber to its own role AND to the next one (an SPV's late Faktur reaches Ops HQ,
an Ops HQ item reaches the Ops Head). The times are settings in alert_rules,
editable on Pengingat & flag (§13.5.3).

Scope follows §13.5.1: staff and SPVs see their own hubs, Ops HQ and above see
every hub. Training sites are left out unless the caller picks one, so a
training exercise never lands on a real to-do list.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import auth
import db
from routers import outbound

router = APIRouter(prefix="/api/todo", tags=["perlu tindakan"])

# Who sees what. A superadmin sees Ops HQ's and the Ops Head's lists.
SEES = {
    "staff": {"staff"},
    "hub_operator": {"staff"},
    "supervisor": {"supervisor"},
    "hq": {"hq"},
    "ops_head": {"ops_head"},
    "superadmin": {"hq", "ops_head"},
}


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
    link: str | None = None


class TodoCounts(BaseModel):
    total: int
    overdue: int


class TodoList(BaseModel):
    role: str
    counts: TodoCounts
    items: list[TodoItem]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _rules() -> dict[str, int]:
    rows = await db.fetch_all("SELECT rule_key, value_num FROM alert_rules")
    return {r["rule_key"]: int(r["value_num"]) for r in rows if r["value_num"] is not None}


class _Rows:
    """Collects rows, working out due times and escalation once."""

    def __init__(self, sites: dict[int, dict]):
        self.sites = sites
        self.items: list[dict] = []
        self.now = _now()

    def add(self, kind, role, site_id, title, detail=None, since=None,
            within: timedelta | None = None, then: str | None = None, link=None):
        due = (since + within) if (since and within is not None) else None
        overdue = bool(due and self.now > due)
        site = self.sites.get(site_id) or {}
        self.items.append({
            "kind": kind, "role": role, "then": then if overdue else None,
            "site_id": site_id, "site_code": site.get("code"),
            "title_id": title[0], "title_en": title[1],
            "detail_id": detail[0] if detail else None,
            "detail_en": detail[1] if detail else None,
            "since": str(since) if since else None,
            "due_at": due.isoformat() + "Z" if due else None,
            "overdue": overdue, "link": link,
        })


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


# --------------------------------------------------------------------------
# The rows, by the process they come from
# --------------------------------------------------------------------------

async def _restock(R: _Rows, ids: list[int], rule: dict):
    ph = db.placeholders(ids)
    reps = await db.fetch_all(
        "SELECT id, reference, site_id, status, created_at, raised_at, po_saved_at, sent_at, "
        "       received_at, acknowledged_at "
        f"FROM replenishments WHERE site_id IN ({ph}) "
        "AND status IN ('draft','raised','po','sent','variance_review','variance_signoff')", ids)
    for r in reps:
        ref, sid = r["reference"], r["site_id"]
        link = f"restock-brand.html?id={r['id']}"
        if r["status"] == "draft":
            R.add("restock_draft", "supervisor", sid,
                  (f"Draf restock {ref}: ajukan ke Ops HQ", f"Restock draft {ref}: raise to Ops HQ"),
                  ("Periksa jumlahnya lalu tekan Ajukan ke Ops HQ.", "Check the quantities, then press Raise to Ops HQ."),
                  r["created_at"], timedelta(hours=rule.get("draft_unsent_hours", 4)), "hq", link)
        elif r["status"] == "raised":
            R.add("restock_raised", "hq", sid,
                  (f"{ref} diajukan SPV: buat PO", f"{ref} raised by the SPV: make the PO"),
                  ("Buat PO, unduh Excel, kirim ke merek.", "Make the PO, download the Excel, email the brand."),
                  r["raised_at"] or r["created_at"], timedelta(hours=8), "ops_head", link)
        elif r["status"] == "po":
            R.add("restock_po_unsent", "hq", sid,
                  (f"PO {ref} belum dikirim ke merek", f"PO {ref} not sent to the brand yet"),
                  ("Kirim Excel lewat email, lalu Tandai terkirim.", "Email the Excel, then Mark sent."),
                  r["po_saved_at"], timedelta(hours=8), None, link)
        elif r["status"] == "sent":
            R.add("restock_unconfirmed", "hq", sid,
                  (f"PO {ref}: merek belum konfirmasi", f"PO {ref}: the brand has not confirmed"),
                  ("Catat pengiriman (AWB, Surat Jalan, jumlah) saat merek membalas.",
                   "Record the shipment (AWB, Surat Jalan, quantities) when the brand replies."),
                  r["sent_at"], timedelta(hours=rule.get("sent_unconfirmed_hours", 24)), None, link)
        elif r["status"] == "variance_review":
            R.add("variance_ack", "supervisor", sid,
                  (f"Selisih {ref}: periksa dan ajukan", f"Variance on {ref}: check and submit"),
                  None, r["received_at"], timedelta(hours=rule.get("variance_open_hours", 24)), "hq",
                  f"selisih-restock.html?id={r['id']}")
        elif r["status"] == "variance_signoff":
            R.add("variance_signoff", "hq", sid,
                  (f"Selisih {ref}: setujui", f"Variance on {ref}: approve"),
                  None, r["acknowledged_at"] or r["received_at"],
                  timedelta(hours=rule.get("variance_open_hours", 24)), "ops_head",
                  f"selisih-restock.html?id={r['id']}")

    # Faktur to upload after an inbound (§5.3.8): SPV at once, Ops HQ after 48 h.
    rows = await db.fetch_all(
        "SELECT ir.id, ir.site_id, ir.completed_at, rp.reference FROM inbound_receipts ir "
        "LEFT JOIN replenishments rp ON rp.id = ir.replenishment_id "
        f"WHERE ir.site_id IN ({ph}) AND ir.source_type = 'from_brand' AND ir.status <> 'open' "
        "  AND ir.faktur_uploaded_at IS NULL "
        "  AND (ir.replenishment_id IS NULL OR COALESCE(ir.final_batch, 1) = 1) "
        "  AND ir.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY", ids)
    spv_h, hq_h = rule.get("faktur_spv_hours", 24), rule.get("faktur_hq_hours", 48)
    for r in rows:
        since = r["completed_at"]
        what = r["reference"] or f"#{r['id']}"
        title = (f"Unggah Faktur bertanda tangan: {what}", f"Upload the signed Faktur: {what}")
        link = f"barang-masuk.html?receipt={r['id']}"
        sid = r["site_id"]
        R.add("faktur_upload", "supervisor", sid, title, None, since,
              timedelta(hours=spv_h), None, link)
        if since and R.now > since + timedelta(hours=hq_h):
            R.add("faktur_upload_late", "hq", sid, title,
                  (f"Belum diunggah setelah {hq_h} jam.", f"Not uploaded after {hq_h} hours."),
                  since, timedelta(hours=hq_h), None, link)

    # Extra units received beyond the PO, not raised yet (§4.4.6): SPV, 24 h.
    rows = await db.fetch_all(
        "SELECT rp.id, rp.reference, rp.site_id, rp.received_at, COUNT(*) AS n "
        "FROM replenishments rp JOIN replenishment_lines rl ON rl.replenishment_id = rp.id "
        f"WHERE rp.site_id IN ({ph}) "
        "  AND rp.status IN ('variance_review','variance_signoff','received') "
        "  AND rp.received_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY "
        "  AND COALESCE(rl.qty_received, 0) > COALESCE(rl.qty_confirmed, 0) "
        "  AND NOT EXISTS (SELECT 1 FROM faktur_issues fi WHERE fi.replenishment_id = rp.id "
        "                  AND fi.sku_id = rl.sku_id AND fi.kind = 'extra') "
        "GROUP BY rp.id, rp.reference, rp.site_id, rp.received_at", ids)
    for r in rows:
        R.add("extra_to_raise", "supervisor", r["site_id"],
              (f"Barang lebih di {r['reference']}: ajukan ke Ops HQ",
               f"Extra units on {r['reference']}: raise to Ops HQ"),
              (f"{r['n']} SKU melebihi PO.", f"{r['n']} SKU(s) above the PO."),
              r["received_at"], timedelta(hours=24), "hq", "barang-masuk.html?status=needs_faktur")

    # Differences raised, for Ops HQ to settle with the brand (§4.4.6): 2 days.
    rows = await db.fetch_all(
        "SELECT fi.id, fi.site_id, fi.kind, fi.qty, fi.raised_at, rp.reference, s.name_display "
        "FROM faktur_issues fi LEFT JOIN replenishments rp ON rp.id = fi.replenishment_id "
        "LEFT JOIN skus s ON s.id = fi.sku_id "
        f"WHERE fi.site_id IN ({ph}) AND fi.status = 'open'", ids)
    kinds = {"extra": ("Barang lebih", "Extra units"), "short": ("Barang kurang", "Short units"),
             "damaged": ("Barang rusak", "Damaged units"), "other": ("Selisih Faktur", "Faktur difference")}
    for r in rows:
        k = kinds.get(r["kind"], kinds["other"])
        what = " · ".join(x for x in (r["reference"], r["name_display"]) if x)
        R.add("faktur_issue", "hq", r["site_id"],
              (f"{k[0]}: selesaikan Faktur dengan merek", f"{k[1]}: settle the Faktur with the brand"),
              (what + (f" · {r['qty']} unit" if r["qty"] else ""),
               what + (f" · {r['qty']} units" if r["qty"] else "")),
              r["raised_at"], timedelta(days=2), "ops_head", "barang-masuk.html?status=needs_faktur")

    # Expiry dates to enter from an uploaded Faktur (§4.1 step 7): Ops HQ, 24 h.
    rows = await db.fetch_all(
        "SELECT rp.id, rp.reference, rp.site_id, MIN(fd.uploaded_at) AS since "
        "FROM replenishments rp JOIN faktur_documents fd ON fd.replenishment_id = rp.id "
        f"WHERE rp.site_id IN ({ph}) AND rp.status <> 'cancelled' "
        "  AND NOT EXISTS (SELECT 1 FROM replenishment_lines rl WHERE rl.replenishment_id = rp.id "
        "                  AND rl.expiry_entered_at IS NOT NULL) "
        "GROUP BY rp.id, rp.reference, rp.site_id", ids)
    for r in rows:
        R.add("expiry_entry", "hq", r["site_id"],
              (f"ED dari Faktur {r['reference']}", f"Expiry dates from the Faktur of {r['reference']}"),
              ("Ketik ED per SKU, atau kosongkan jika Faktur tidak mencantumkannya.",
               "Type each SKU's ED, or leave empty when the Faktur lists none."),
              r["since"], timedelta(hours=24), None, f"restock-brand.html?tab=expiry&id={r['id']}")

    # Unknown products from inbound (§2.8): Ops HQ, 24 h.
    rows = await db.fetch_all(
        "SELECT site_id, COUNT(*) AS n, MIN(raised_at) AS since FROM sku_requests "
        f"WHERE site_id IN ({ph}) AND status = 'open' GROUP BY site_id", ids)
    for r in rows:
        R.add("sku_request", "hq", r["site_id"],
              ("Produk tidak dikenal dari barang masuk", "Unknown products from inbound"),
              (f"{r['n']} menunggu jawaban.", f"{r['n']} waiting for an answer."),
              r["since"], timedelta(hours=rule.get("sku_request_open_hours", 24)), None,
              "permintaan-sku.html")


async def _catalogue(R: _Rows, rule: dict):
    """SKUs to complete and menu items without a SKU (§2.2.5, §2.2.6). Not per hub."""
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n, MIN(COALESCE(s.hiryu_created_at, s.created_at)) AS since "
        "FROM skus s JOIN brands b ON b.id = s.brand_id WHERE s.active = 1 AND b.active = 1 "
        "  AND (s.bin_size IS NULL OR s.default_full_threshold IS NULL)")
    if row and row["n"]:
        R.add("sku_complete", "hq", None,
              ("SKU belum lengkap", "SKUs to complete"),
              (f"{row['n']} SKU tanpa ukuran bin atau isi sampai.",
               f"{row['n']} SKU(s) without a bin size or isi sampai."),
              None, None, None, "lengkapi-sku.html")
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM hiryu_items WHERE active = 1 AND sku_id IS NULL")
    if row and row["n"]:
        R.add("item_no_sku", "hq", None,
              ("Item menu Hiryu tanpa SKU", "Hiryu menu items without a SKU"),
              (f"{row['n']} item. Hubungkan di Hiryu (Bundles).",
               f"{row['n']} item(s). Connect them in Hiryu (Bundles)."),
              None, None, None, "menu-hiryu.html")


async def _link(R: _Rows, ids: list[int], rule: dict):
    """Link problems (§9.3, §0.6): the SPV sees their hubs, Ops HQ sees failures."""
    ph = db.placeholders(ids)
    wait = rule.get("link_wait_alert_minutes", 5)
    rows = await db.fetch_all(
        "SELECT site_id, COUNT(*) AS n, MIN(created_at) AS since FROM pos_outbox "
        f"WHERE site_id IN ({ph}) AND status IN ('pending','sending') "
        "  AND created_at <= UTC_TIMESTAMP() - INTERVAL %s MINUTE GROUP BY site_id",
        [*ids, wait])
    for r in rows:
        R.add("link_waiting", "supervisor", r["site_id"],
              ("Pesan ke Hiryu tertahan", "Messages to Hiryu held up"),
              (f"{r['n']} menunggu lebih dari {wait} menit.", f"{r['n']} waiting over {wait} minutes."),
              r["since"], timedelta(minutes=0), "hq", "integrasi.html")
    rows = await db.fetch_all(
        "SELECT site_id, COUNT(*) AS n, MIN(created_at) AS since FROM pos_outbox "
        f"WHERE site_id IN ({ph}) AND status = 'failed' "
        "  AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY GROUP BY site_id", ids)
    for r in rows:
        R.add("link_failed", "hq", r["site_id"],
              ("Pesan ke Hiryu gagal", "Messages to Hiryu failed"),
              (f"{r['n']} gagal. Periksa, lalu Coba lagi atau hubungi Shaun.",
               f"{r['n']} failed. Check, then retry or contact Shaun."),
              r["since"], timedelta(minutes=0), None, "integrasi.html")
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n, MIN(received_at) AS since FROM hiryu_inbound_log "
        "WHERE outcome IN ('refused','problem') AND received_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY")
    if row and row["n"]:
        R.add("link_refused", "hq", None,
              ("Pesan dari Hiryu ditolak", "Messages from Hiryu refused"),
              (f"{row['n']} dalam 24 jam (SKU atau toko tidak dikenal).",
               f"{row['n']} in 24 hours (unknown SKU or store)."),
              row["since"], timedelta(minutes=0), None, "integrasi.html")


@router.get("", response_model=TodoList)
async def todo(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    sites = await _sites_for(user, site_id)
    R = _Rows(sites)
    rule = await _rules()
    ids = list(sites) or [0]
    await _restock(R, ids, rule)
    await _link(R, ids, rule)
    await _floor(R, ids, rule, user)
    if user.at_least("hq"):
        await _catalogue(R, rule)

    mine = SEES.get(user.role, {"staff"})
    items = [i for i in R.items if i["role"] in mine or (i["then"] and i["then"] in mine)]
    # A row seen by the next role is past its time by definition.
    items.sort(key=lambda i: (not i["overdue"], i["due_at"] or "9999", i["since"] or "9999"))
    for i in items:
        i.pop("then", None)
    return {"role": user.role,
            "counts": {"total": len(items), "overdue": sum(1 for i in items if i["overdue"])},
            "items": items}


async def _floor(R: _Rows, ids: list[int], rule: dict, user: auth.User):
    """Staff and SPV rows from the floor (§6.2, §6.4, §7, §8)."""
    ph = db.placeholders(ids)
    start_min = rule.get("pick_start_minutes", 2)
    wait_min = rule.get("handover_wait_minutes", 20)

    # My order to pick: 2 minutes to start, then it goes back to the queue.
    for r in await db.fetch_all(
            "SELECT pt.id, pt.site_id, pt.claimed_at, o.hiryu_short_no, o.external_ref "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'claimed' AND pt.claimed_by = %s "
            "  AND pt.started_at IS NULL", [*ids, user.email]):
        gm = r["hiryu_short_no"] or r["external_ref"]
        R.add("my_pick", "staff", r["site_id"],
              (f"Ambil pesanan {gm}", f"Pick order {gm}"), None, r["claimed_at"],
              timedelta(minutes=start_min), None, "../07-ambil-pesanan.html")

    # Orders at the pack bench (at once), bags waiting for a driver (amber at 20 min).
    for r in await db.fetch_all(
            "SELECT o.site_id, COUNT(*) AS n, MIN(COALESCE(pt.handed_to_pack_at, pt.completed_at)) AS since "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'completed' AND o.status <> 'cancelled' "
            "  AND o.marked_ready_at IS NULL AND o.handed_over_at IS NULL "
            "  AND pt.completed_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY GROUP BY o.site_id", ids):
        R.add("to_pack", "staff", r["site_id"],
              ("Pesanan menunggu dikemas", "Orders waiting to pack"),
              (f"{r['n']} pesanan di meja packing.", f"{r['n']} order(s) at the pack bench."),
              r["since"], timedelta(minutes=0), "supervisor", "../21-pesanan-hub.html")
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(marked_ready_at) AS since FROM orders "
            f"WHERE site_id IN ({ph}) AND marked_ready_at IS NOT NULL AND handed_over_at IS NULL "
            "  AND status <> 'cancelled' AND marked_ready_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY "
            "GROUP BY site_id", ids):
        R.add("await_driver", "staff", r["site_id"],
              ("Tas menunggu driver", "Bags waiting for a driver"),
              (f"{r['n']} tas di rak siap ambil.", f"{r['n']} bag(s) on the ready shelf."),
              r["since"], timedelta(minutes=wait_min), "supervisor", "../21-pesanan-hub.html")

    # Units to put back after a cancel: 2 hours.
    for r in await db.fetch_all(
            "SELECT site_id, SUM(qty - qty_returned) AS n, MIN(created_at) AS since FROM return_tasks "
            f"WHERE site_id IN ({ph}) AND status = 'open' GROUP BY site_id", ids):
        R.add("return_to_shelf", "staff", r["site_id"],
              ("Kembalikan ke rak", "Return to shelf"),
              (f"{int(r['n'] or 0)} unit dari pesanan batal.", f"{int(r['n'] or 0)} unit(s) from cancelled orders."),
              r["since"], timedelta(hours=2), "supervisor", "../18-kembalikan.html")

    # SPV: orders not started or sent back, late orders, missing items today.
    for r in await db.fetch_all(
            "SELECT pt.site_id, o.hiryu_short_no, o.external_ref, pt.claimed_by, pt.claimed_at "
            "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'claimed' AND pt.started_at IS NULL "
            "  AND pt.claimed_at <= UTC_TIMESTAMP() - INTERVAL %s MINUTE", [*ids, start_min]):
        gm = r["hiryu_short_no"] or r["external_ref"]
        R.add("not_started", "supervisor", r["site_id"],
              (f"{gm} belum mulai diambil", f"{gm} not started"),
              (f"Diberikan ke {r['claimed_by']}.", f"Given to {r['claimed_by']}."),
              r["claimed_at"], timedelta(minutes=0), None, "papan-antrean.html")
    for r in await db.fetch_all(
            "SELECT pt.site_id, COUNT(*) AS n, MIN(pt.requeued_at) AS since FROM pick_tasks pt "
            f"WHERE pt.site_id IN ({ph}) AND pt.status = 'ready' AND pt.requeue_count > 0 "
            "GROUP BY pt.site_id", ids):
        R.add("requeued", "supervisor", r["site_id"],
              ("Pesanan kembali ke antrean", "Orders sent back to the queue"),
              (f"{r['n']} tidak dimulai tepat waktu.", f"{r['n']} not started in time."),
              r["since"], timedelta(minutes=0), None, "papan-antrean.html")
    for r in await db.fetch_all(
            "SELECT site_id, COUNT(*) AS n, MIN(promised_at) AS since FROM orders "
            f"WHERE site_id IN ({ph}) AND status NOT IN ('cancelled','packed','handed_over') "
            "  AND marked_ready_at IS NULL AND promised_at < UTC_TIMESTAMP() "
            "  AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY GROUP BY site_id", ids):
        R.add("late_orders", "supervisor", r["site_id"],
              ("Pesanan lewat target siap", "Orders past their ready-by"),
              (f"{r['n']} belum selesai dikemas.", f"{r['n']} not packed yet."),
              r["since"], timedelta(minutes=0), None, "papan-antrean.html")
    day_start = outbound._jakarta_day_start_utc()
    for r in await db.fetch_all(
            "SELECT ps.site_id, ps.created_at, ps.qty_required, ps.qty_found, ps.declared_by, "
            "       s.name_display, u.name AS picker FROM pick_shortfalls ps "
            "JOIN skus s ON s.id = ps.sku_id LEFT JOIN users u ON u.email = ps.declared_by "
            f"WHERE ps.site_id IN ({ph}) AND ps.created_at >= %s ORDER BY ps.created_at",
            [*ids, day_start]):
        who = r["picker"] or r["declared_by"] or "?"
        R.add("missing_item", "supervisor", r["site_id"],
              (f"Barang tidak ada: {r['name_display']}", f"Missing item: {r['name_display']}"),
              (f"Dicatat {who}: ketemu {r['qty_found']} dari {r['qty_required']}.",
               f"Declared by {who}: found {r['qty_found']} of {r['qty_required']}."),
              r["created_at"], None, None, "papan-antrean.html")
