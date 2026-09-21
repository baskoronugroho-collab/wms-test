"""Replenishment to the brand: threshold alert -> request -> Wardah's AWB ->
receive against it.

  draft      HQ built it, from the alerts or by hand, and can still edit it.
  sent       HQ sent it to Wardah outside the system (WhatsApp / email).
  confirmed  Wardah answered. HQ recorded the AWB, the Surat Jalan number and
             the quantities Wardah will actually send.
  variance_review   The delivery was received by its AWB and at least one SKU
             differs from Wardah's confirmation. The hub's SPV acknowledges
             each difference, correcting the count if a recount finds another
             number.
  variance_signoff  The SPV has submitted. Ops HQ signs the numbers off, or
             sends them back. Signing applies any correction to stock.
  received   Closed. The number billed per SKU is the signed-off count, or the
             received count when nothing differed -- the same number on
             Wardah's side and Ninja's.
  cancelled

The alert is computed live from the registry (everything held at a hub is at or
below the SKU's restock point) rather than from stored restock requests, so stock
that arrived by upload or count still raises it.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["replenishment"])

OPEN_STATES = ("draft", "sent", "confirmed")
ACTIVE_STATES = ("draft", "sent", "confirmed", "variance_review", "variance_signoff")


async def _payload(rep_id: int) -> dict:
    r = await db.fetch_one(
        "SELECT rp.*, st.code AS site_code, st.name AS site_name, b.name AS brand_name, "
        "       ir.status AS receipt_status "
        "FROM replenishments rp JOIN sites st ON st.id = rp.site_id "
        "JOIN brands b ON b.id = rp.brand_id "
        "LEFT JOIN inbound_receipts ir ON ir.id = rp.receipt_id WHERE rp.id = %s", (rep_id,))
    if not r:
        raise HTTPException(404, "Replenishment not found")
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
        })
    ts = lambda k: str(r[k]) if r[k] else None
    return {
        "id": r["id"], "reference": r["reference"], "site_id": r["site_id"],
        "site_code": r["site_code"], "site_name": r["site_name"],
        "brand_id": r["brand_id"], "brand_name": r["brand_name"], "status": r["status"],
        "awb": r["awb"], "surat_jalan_no": r["surat_jalan_no"],
        "eta_date": str(r["eta_date"]) if r["eta_date"] else None, "note": r["note"],
        "created_by": r["created_by"], "created_at": ts("created_at"),
        "sent_by": r["sent_by"], "sent_at": ts("sent_at"),
        "confirmed_by": r["confirmed_by"], "confirmed_at": ts("confirmed_at"),
        "receipt_id": r["receipt_id"], "receipt_status": r["receipt_status"],
        "received_at": ts("received_at"),
        "acknowledged_by": r["acknowledged_by"], "acknowledged_at": ts("acknowledged_at"),
        "signed_off_by": r["signed_off_by"], "signed_off_at": ts("signed_off_at"),
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
    }


async def _get(rep_id: int, *states: str) -> dict:
    row = await db.fetch_one("SELECT * FROM replenishments WHERE id = %s", (rep_id,))
    if not row:
        raise HTTPException(404, "Replenishment not found")
    if states and row["status"] not in states:
        raise HTTPException(
            409, f"{row['reference']} sudah {row['status']} — langkah ini tidak berlaku lagi.")
    return row


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
        "             AND rp.status IN ('draft','sent','confirmed') "
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
        # Fill back to the full threshold of the pick face plus as much again for
        # overflow, the same target the restock trigger has always used.
        target = (r["full_threshold"] or r["restock_point"] * 2) * 2
        out.append({
            "site_id": r["site_id"], "site_code": r["site_code"], "sku_id": r["sku_id"],
            "brand_id": r["brand_id"], "brand_name": r["brand_name"],
            "sku_name": r["name_display"], "brand_sku_code": r["brand_sku_code"],
            "qty_total": total, "restock_point": r["restock_point"],
            "full_threshold": r["full_threshold"],
            "qty_suggested": max(1, target - total),
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
                        pattern="^(active|arriving|variance|all|draft|sent|confirmed|receiving|"
                                "variance_review|variance_signoff|received|cancelled)$"),
    limit: int = Query(default=100, ge=1, le=300),
    user: auth.User = Depends(auth.current_user),
):
    """HQ sees all hubs. A hub sees its own — staff need the confirmed ones to
    know what is on its way."""
    where, params = ["1=1"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if status == "active":
        where.append("status IN ('draft','sent','confirmed','receiving','variance_review',"
                     "'variance_signoff')")
    elif status == "arriving":
        # What a station can receive: confirmed, or partly received in batches.
        where.append("status IN ('confirmed','receiving')")
    elif status == "variance":
        where.append("status IN ('variance_review','variance_signoff')")
    elif status != "all":
        where.append("status = %s")
        params.append(status)
    ids = await db.fetch_all(
        "SELECT id FROM replenishments WHERE " + " AND ".join(where) +
        " ORDER BY FIELD(status,'variance_review','variance_signoff','receiving','confirmed','sent','draft',"
        "'received','cancelled'), id DESC "
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
            raise HTTPException(422, "Jumlah tidak boleh negatif.")
        out[l.sku_id] = qty
    return out


@router.post("/replenishments", response_model=models.Replenishment, status_code=201)
async def create_replenishment(
    body: models.ReplenishmentIn, user: auth.User = Depends(auth.require("supervisor"))
):
    site = await auth.assert_site_access(user, body.site_id)
    lines = {k: v for k, v in _clean_lines(body.lines, "qty_requested").items() if v > 0}
    if not lines:
        raise HTTPException(422, "Isi minimal satu produk dengan jumlah. / Add at least one line.")
    skus = await db.fetch_all(
        f"SELECT id, brand_id FROM skus WHERE id IN ({db.placeholders(lines)})", list(lines))
    if len(skus) != len(lines) or any(s["brand_id"] != body.brand_id for s in skus):
        raise HTTPException(422, "Semua produk harus dari brand yang sama.")

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
                           after={"reference": reference, "lines": len(lines)})
    return await _payload(rep_id)


@router.put("/replenishments/{rep_id}/lines", response_model=models.Replenishment)
async def edit_draft(
    rep_id: int, body: models.ReplenishmentEditIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Change what is asked for, while it is still a draft."""
    row = await _get(rep_id, "draft")
    await auth.assert_site_access(user, row["site_id"])
    lines = {k: v for k, v in _clean_lines(body.lines, "qty_requested").items() if v > 0}
    if not lines:
        raise HTTPException(422, "A request needs at least one line. Cancel it instead.")
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


@router.post("/replenishments/{rep_id}/send", response_model=models.Replenishment)
async def mark_sent(rep_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """The request was sent to the brand (by hand, outside the WMS)."""
    row = await _get(rep_id, "draft")
    await auth.assert_site_access(user, row["site_id"])
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
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Record Wardah's answer: AWB, Surat Jalan number and what they will send.

    Can be repeated until the delivery is received, because a brand's first
    answer is not always its last. A SKU Wardah adds that was not asked for is
    accepted with nothing requested against it.
    """
    row = await _get(rep_id, "sent", "confirmed")
    await auth.assert_site_access(user, row["site_id"])
    awb = (body.awb or "").strip().upper()
    if not awb:
        raise HTTPException(422, "Nomor AWB wajib diisi. / The AWB is required.")
    clash = await db.fetch_one(
        "SELECT reference FROM replenishments WHERE awb = %s AND id <> %s "
        "AND status IN ('sent','confirmed')", (awb, rep_id))
    if clash:
        raise HTTPException(409, f"AWB {awb} sudah dipakai {clash['reference']}.")
    confirmed = _clean_lines(body.lines, "qty_confirmed")
    if not confirmed:
        raise HTTPException(422, "Isi jumlah yang dikonfirmasi Wardah. / Enter the confirmed quantities.")
    if confirmed:
        skus = await db.fetch_all(
            f"SELECT id, brand_id FROM skus WHERE id IN ({db.placeholders(confirmed)})",
            list(confirmed))
        if len(skus) != len(confirmed) or any(s["brand_id"] != row["brand_id"] for s in skus):
            raise HTTPException(422, "Semua produk harus dari brand yang sama.")

    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE replenishments SET status='confirmed', awb=%s, surat_jalan_no=%s, "
            "eta_date=%s, confirmed_by=%s, confirmed_at=NOW() WHERE id=%s",
            (awb, (body.surat_jalan_no or "").strip()[:64] or None, body.eta_date,
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
    row = await _get(rep_id, *OPEN_STATES)
    await auth.assert_site_access(user, row["site_id"])
    await db.execute("UPDATE replenishments SET status='cancelled' WHERE id=%s", (rep_id,))
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
    completed batch. Only the last batch compares with Wardah's confirmation;
    until then the request is 'receiving'.
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
    # Something arrived that Wardah never confirmed: record it on the request too.
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
        # Anything different from Wardah's confirmation needs the SPV first. A
        # change after the SPV submitted sends it back to them.
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
            raise HTTPException(422, "Jumlah tidak boleh negatif.")
        note = ((g.note if g else None) or "").strip()
        if final != confirmed and not note:
            raise HTTPException(
                422, f"{l['name_display']}: tulis alasan selisih ({final} vs {confirmed} "
                     f"dikonfirmasi Wardah). / Give a reason for the difference.")
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
                raise HTTPException(409, "Salah satu SKU belum punya rak di hub ini — "
                                         "tempatkan dulu sebelum tanda tangan.")
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
