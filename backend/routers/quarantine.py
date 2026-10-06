"""Quarantine, write-off and returns to the brand (canvas Section 7).

One path for every unit that cannot be sold, and one way to send stock back to
the brand.

* **Report a problem** (7a). Anyone scans the unit, picks a reason, takes a
  photo and scans the quarantine tray (<HUB>-QR-NN, agent S's special_bins).
  A unit found in a bin leaves the stock ledger at once (reason 'quarantine'),
  so Hiryu gets the lower number on the next message 3.
* **Other ways in**, called by other agents inside their own transaction:
  ``add_from_inbound`` (agent I: damaged at inbound, or refused at inbound),
  ``add_driver_return`` (agent O: a cancelled parcel the driver brought back
  damaged). Neither was ever (again) stock, so neither touches the ledger.
* **SPV decision** (7b) within 24 hours: back to the rack (a return-to-shelf
  task; the unit is sellable again when staff scan the bin), return to the
  brand, or write off (waits for Ops HQ, 7c).
* **Cost bearer**: set by the WMS from where the unit came from, never chosen.
  In the hub after putaway = Ninja; at inbound = the brand; back from the
  driver damaged = Ninja, and Ops HQ claims it from Grab outside the WMS.
* **Return to the brand** (7d to 7f): from quarantine, old stock (age counted
  from the inbound date, no expiry dates), and refused deliveries; a return
  note RTR-<HUB>-yymm-NNN linked to the brand's next delivery; staff scan each
  unit out and the brand's driver signs.

Nothing leaves the stock without an Ops HQ approval (write-off) or a return
note signed by the brand's driver. Damage a customer reports after handover is
a Grab claim and never reaches the WMS.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

import auth
import common
import db
import ledger
import storage
from routers.opname import (MONTHS_ID, bin_label, hub_short, id_date, iso, names_for, rule_values,
                            table_exists, utcnow, wib_today, WIB)

router = APIRouter(prefix="/api", tags=["quarantine and returns"])

REASONS = {
    "rusak": ("Rusak", "Damaged"),
    "bocor": ("Bocor", "Leaking"),
    "kedaluwarsa": ("Kedaluwarsa", "Expired"),
    "produk_salah": ("Produk salah", "Wrong product"),
    "driver_rusak": ("Kembali dari driver, rusak", "Back from the driver, damaged"),
    "kardus_penyok": ("Kardus luar penyok", "Outer box damaged"),
    "lainnya": ("Lainnya", "Other"),
}
# What staff choose on the phone (7a). The rest come from inbound and the driver.
HUB_REASONS = ("rusak", "bocor", "kedaluwarsa", "produk_salah")

ORIGINS = {
    "hub": ("ninja", "Rusak di dark store", "Damaged in the dark store"),
    "inbound": ("brand", "Ditolak saat masuk", "Rejected at inbound"),
    "inbound_rejected": ("brand", "Ditolak saat masuk", "Rejected at inbound"),
    "driver_return": ("ninja", "Ops HQ klaim ke Grab di luar WMS",
                      "Ops HQ claims it from Grab outside the WMS"),
}
BEARER = {"ninja": ("Ninja", "Ninja"), "brand": ("Merek", "Brand")}
DECISIONS = ("back_to_rack", "return", "write_off")
STATUS = {
    "open": ("Menunggu keputusan SPV", "Waiting for the SPV"),
    "back_to_rack": ("Kembali ke rak", "Back to the rack"),
    "return_pending": ("Retur ke merek", "Return to the brand"),
    "on_note": ("Di nota retur", "On a return note"),
    "returned": ("Sudah diretur", "Returned"),
    "write_off_pending": ("Menunggu persetujuan Ops HQ", "Waiting for Ops HQ"),
    "written_off": ("Dihapus", "Written off"),
}


# --- trays ------------------------------------------------------------------------

async def trays(site_id: int, cur=None) -> list[str]:
    """The hub's quarantine trays (agent S's special_bins kind 'QR'), or
    <HUB>-QR-01 while that table is not there or holds none."""
    rows = []
    if await table_exists("special_bins"):
        sql = ("SELECT code FROM special_bins WHERE site_id = %s AND kind = 'QR' AND active = 1 "
               "ORDER BY seq")
        rows = await (db.many(cur, sql, (site_id,)) if cur is not None else db.fetch_all(sql, (site_id,)))
    if rows:
        return [r["code"] for r in rows]
    sql = "SELECT code FROM sites WHERE id = %s"
    site = await (db.one(cur, sql, (site_id,)) if cur is not None else db.fetch_one(sql, (site_id,)))
    return [f"{hub_short(site['code'] if site else '')}-QR-01"]


async def _tray(site_id: int, code: str | None, cur=None, strict: bool = False) -> str:
    known = await trays(site_id, cur)
    if not code:
        return known[0]
    code = code.strip().upper()
    if code in known:
        return code
    if strict:
        raise HTTPException(422, f"{code} bukan baki karantina dark store ini. Pindai {known[0]}. / "
                                 f"{code} is not a quarantine tray of this dark store. Scan {known[0]}.")
    return code


# --- the helpers other agents call ---------------------------------------------------

async def _insert(cur, *, site_id, sku_id, qty, origin, reason, actor_email, status="open",
                  reason_note=None, location_id=None, tray_code=None, photo_key=None,
                  in_ledger=0, receipt_id=None, replenishment_id=None, order_id=None,
                  order_ref=None, is_training=False) -> int:
    if qty <= 0:
        raise HTTPException(422, "Jumlah harus lebih dari 0. / The quantity must be above 0.")
    if reason not in REASONS:
        reason = "lainnya"
    bearer, note_id, _ = ORIGINS[origin]
    item_id = await db.run(
        cur,
        "INSERT INTO quarantine_items (site_id, sku_id, qty, origin, reason, reason_note, location_id, "
        " tray_code, photo_key, cost_bearer, bearer_note, in_ledger, status, receipt_id, "
        " replenishment_id, order_id, order_ref, reported_by, is_training) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (site_id, sku_id, qty, origin, reason, reason_note, location_id,
         await _tray(site_id, tray_code, cur), photo_key, bearer, note_id, in_ledger, status,
         receipt_id, replenishment_id, order_id, order_ref, actor_email, 1 if is_training else 0))
    await ledger.audit(cur, actor_email=actor_email, entity="quarantine_item", entity_id=item_id,
                       action="reported", after={"origin": origin, "reason": reason, "qty": qty,
                                                 "sku_id": sku_id})
    return item_id


async def report_in_hub(cur, *, site_id: int, sku_id: int, location_id: int, qty: int, reason: str,
                        actor_email: str, reason_note: str | None = None, tray_code: str | None = None,
                        photo_key: str | None = None, is_training: bool = False) -> int:
    """A unit found unsellable in a bin (after putaway): it leaves the stock now
    and Hiryu hears the lower number. Cost: Ninja. Returns the quarantine id.

    Agent O may call this too (a picker finding a broken unit)."""
    bal = await db.one(cur, "SELECT qty_on_hand, qty_allocated FROM inventory_balances "
                            "WHERE site_id = %s AND sku_id = %s AND location_id = %s FOR UPDATE",
                       (site_id, sku_id, location_id))
    free = int(bal["qty_on_hand"]) - int(bal["qty_allocated"]) if bal else 0
    if free < qty:
        raise HTTPException(409, f"Di bin ini hanya {max(free, 0)} unit yang bisa dipindah ke karantina. / "
                                 f"Only {max(free, 0)} unit(s) in this bin can go to quarantine.")
    item_id = await _insert(cur, site_id=site_id, sku_id=sku_id, qty=qty, origin="hub", reason=reason,
                            actor_email=actor_email, reason_note=reason_note, location_id=location_id,
                            tray_code=tray_code, photo_key=photo_key, in_ledger=1,
                            is_training=is_training)
    await ledger.apply(cur, site_id=site_id, sku_id=sku_id, location_id=location_id, qty_delta=-qty,
                       movement_type="adjustment", actor_email=actor_email, ref_type="quarantine_item",
                       ref_id=item_id, reason_code="quarantine", scan_source="scan",
                       is_training=is_training)
    return item_id


async def add_from_inbound(cur, *, site_id: int, sku_id: int, qty: int, reason: str, actor_email: str,
                           rejected: bool = False, receipt_id: int | None = None,
                           replenishment_id: int | None = None, reason_note: str | None = None,
                           tray_code: str | None = None, photo_key: str | None = None,
                           is_training: bool = False) -> int:
    """Agent I, at receiving. The units never became stock, so no ledger.

    rejected=False: damaged at inbound, into the tray for the SPV's decision
    (board 7b, "rusak saat barang masuk"). rejected=True: refused at inbound,
    straight onto the brand's return list as Kiriman ditolak (7d). Cost: brand.
    Pass the replenishment_id so the monthly file counts it as Damaged on that
    delivery."""
    return await _insert(cur, site_id=site_id, sku_id=sku_id, qty=qty,
                         origin="inbound_rejected" if rejected else "inbound", reason=reason,
                         actor_email=actor_email, status="return_pending" if rejected else "open",
                         reason_note=reason_note, tray_code=tray_code, photo_key=photo_key,
                         receipt_id=receipt_id, replenishment_id=replenishment_id,
                         is_training=is_training)


async def add_driver_return(cur, *, site_id: int, sku_id: int, qty: int, actor_email: str,
                            order_id: int | None = None, order_ref: str | None = None,
                            reason_note: str | None = None, tray_code: str | None = None,
                            photo_key: str | None = None, is_training: bool = False) -> int:
    """Agent O: a cancelled parcel the driver brought back, damaged units only
    (fine units go to return-to-shelf). The units left the ledger when they were
    picked, so no ledger here. Reason 'Kembali dari driver, rusak', cost Ninja,
    note "Ops HQ klaim ke Grab di luar WMS". Store the id in
    driver_returns.quarantine_ref."""
    return await _insert(cur, site_id=site_id, sku_id=sku_id, qty=qty, origin="driver_return",
                         reason="driver_rusak", actor_email=actor_email, reason_note=reason_note,
                         tray_code=tray_code, photo_key=photo_key, order_id=order_id,
                         order_ref=order_ref, is_training=is_training)


# --- what other modules already hold -------------------------------------------------

async def sync_inbound(site_ids: list[int] | None = None) -> int:
    """Take in what inbound (agent I) parks for quarantine without calling the
    helpers: damaged units it put in the tray (inbound_differences kind
    'damaged', place 'quarantine') and extra units Ops HQ rejected
    (inbound_bin_loads status 'return'). Idempotent; cheap enough to run on
    every read of the lists. Returns the rows added."""
    added = 0
    scope = ""
    params: list = []
    if site_ids:
        scope = f" AND x.site_id IN ({db.placeholders(site_ids)})"
        params = list(site_ids)
    if await table_exists("inbound_differences"):
        photo = ("(SELECT MIN(p.id) FROM inbound_photos p WHERE p.difference_id = x.id)"
                 if await table_exists("inbound_photos") else "NULL")
        rows = await db.fetch_all(
            "SELECT x.id, x.site_id, x.sku_id, x.qty, x.bin_code, x.note, x.receipt_id, x.replenishment_id, "
            "       x.created_by, x.created_at, " + photo + " AS photo_id "
            "FROM inbound_differences x WHERE x.kind = 'damaged' AND x.place = 'quarantine' AND x.qty > 0 "
            "AND NOT EXISTS (SELECT 1 FROM quarantine_items q WHERE q.source_ref_type = 'inbound_difference' "
            "                AND q.source_ref_id = x.id)" + scope, params)
        for r in rows:
            async with db.tx() as cur:
                added += 1 if await db.run(
                    cur, "INSERT INTO quarantine_items (site_id, sku_id, qty, origin, reason, reason_note, "
                         "tray_code, photo_key, cost_bearer, bearer_note, status, receipt_id, replenishment_id, "
                         "source_ref_type, source_ref_id, reported_by, reported_at) "
                         "VALUES (%s,%s,%s,'inbound','rusak',%s,%s,%s,'brand',%s,'open',%s,%s,"
                         "'inbound_difference',%s,%s,%s) "
                         "ON DUPLICATE KEY UPDATE quarantine_items.id = quarantine_items.id",
                    (r["site_id"], r["sku_id"], r["qty"], r["note"], r["bin_code"],
                     f"inbound_photo:{r['photo_id']}" if r["photo_id"] else None, ORIGINS["inbound"][1],
                     r["receipt_id"], r["replenishment_id"], r["id"], r["created_by"] or "inbound",
                     r["created_at"])) else 0
        # A quantity corrected at inbound while the unit still waits for the SPV.
        await db.execute(
            "UPDATE quarantine_items q JOIN inbound_differences x ON x.id = q.source_ref_id "
            "SET q.qty = x.qty WHERE q.source_ref_type = 'inbound_difference' AND q.status = 'open' "
            "AND x.qty > 0 AND q.qty <> x.qty")
    if await table_exists("inbound_bin_loads"):
        rows = await db.fetch_all(
            "SELECT x.id, x.site_id, x.sku_id, x.bin_code, x.receipt_id, x.created_at, x.opened_by, "
            "       GREATEST(x.qty_hold, x.qty - x.qty_put) AS n, ir.replenishment_id "
            "FROM inbound_bin_loads x LEFT JOIN inbound_receipts ir ON ir.id = x.receipt_id "
            "WHERE x.status = 'return' AND NOT EXISTS (SELECT 1 FROM quarantine_items q "
            "  WHERE q.source_ref_type = 'inbound_bin_load' AND q.source_ref_id = x.id)" + scope, params)
        for r in rows:
            if int(r["n"] or 0) <= 0:
                continue
            async with db.tx() as cur:
                added += 1 if await db.run(
                    cur, "INSERT INTO quarantine_items (site_id, sku_id, qty, origin, reason, reason_note, "
                         "tray_code, cost_bearer, bearer_note, status, receipt_id, replenishment_id, "
                         "source_ref_type, source_ref_id, reported_by) "
                         "VALUES (%s,%s,%s,'inbound_rejected','lainnya','Barang lebih, ditolak Ops HQ',%s,"
                         "'brand',%s,'return_pending',%s,%s,'inbound_bin_load',%s,%s) "
                         "ON DUPLICATE KEY UPDATE quarantine_items.id = quarantine_items.id",
                    (r["site_id"], r["sku_id"], int(r["n"]), r["bin_code"], ORIGINS["inbound_rejected"][1],
                     r["receipt_id"], r["replenishment_id"], r["id"], r["opened_by"] or "inbound")) else 0
    if await table_exists("driver_returns"):
        # Damaged units of a parcel the driver brought back, when the floor did
        # not book them here itself (driver_returns.quarantine_ref is ours).
        rows = await db.fetch_all(
            "SELECT x.id, x.site_id, x.sku_id, x.qty_damaged, x.order_id, x.note, x.checked_by, x.checked_at, "
            "       o.hiryu_short_no, o.external_ref FROM driver_returns x "
            "LEFT JOIN orders o ON o.id = x.order_id "
            "WHERE x.qty_damaged > 0 AND x.quarantine_ref IS NULL" + scope, params)
        for r in rows:
            async with db.tx() as cur:
                if await db.one(cur, "SELECT id FROM quarantine_items WHERE source_ref_type = 'driver_return' "
                                     "AND source_ref_id = %s", (r["id"],)):
                    continue
                qid = await add_driver_return(cur, site_id=r["site_id"], sku_id=r["sku_id"], qty=r["qty_damaged"],
                                              actor_email=r["checked_by"], order_id=r["order_id"],
                                              order_ref=r["hiryu_short_no"] or r["external_ref"],
                                              reason_note=r["note"])
                await db.run(cur, "UPDATE quarantine_items SET source_ref_type = 'driver_return', "
                                  "source_ref_id = %s, reported_at = %s WHERE id = %s",
                             (r["id"], r["checked_at"], qid))
                await db.run(cur, "UPDATE driver_returns SET quarantine_ref = %s WHERE id = %s "
                                  "AND quarantine_ref IS NULL", (qid, r["id"]))
                added += 1
    return added


async def _release_inbound_loads(cur, note_id: int, actor: str) -> None:
    """Rejected extras handed back to the brand: free their temporary bin."""
    loads = await db.many(cur, "SELECT source_ref_id FROM quarantine_items WHERE return_note_id = %s "
                               "AND source_ref_type = 'inbound_bin_load'", (note_id,))
    if not loads:
        return
    from routers import inbound  # agent I's module; imported late to keep startup order free
    for ld in loads:
        await inbound.mark_returned(cur, ld["source_ref_id"], actor)


# --- shapes ----------------------------------------------------------------------------

class DecisionIn(BaseModel):
    item_id: int
    decision: str = Field(..., pattern="^(back_to_rack|return|write_off)$")
    note: str | None = None


class DecisionsIn(BaseModel):
    decisions: list[DecisionIn]


class HqNoteIn(BaseModel):
    note: str | None = None


class ReturnLineIn(BaseModel):
    origin: str = Field(..., pattern="^(quarantine|old_stock|rejected)$")
    quarantine_item_id: int | None = None
    location_id: int | None = None
    sku_id: int | None = None
    qty: int | None = Field(default=None, ge=1)
    ed_on_pack: str | None = Field(default=None, max_length=32,
                                   description="What the SPV read on the pack, e.g. Jan 2027")


class ReturnNoteIn(BaseModel):
    site_id: int
    brand_id: int
    lines: list[ReturnLineIn]
    replenishment_id: int | None = None
    note: str | None = None


class ReturnScanIn(BaseModel):
    code: str
    idempotency_key: str | None = None


class HandoverIn(BaseModel):
    driver_name: str | None = None
    vehicle_no: str | None = None


# --- reading ------------------------------------------------------------------------

_ITEM_SQL = (
    "SELECT q.*, s.name_display, s.brand_sku_code, s.brand_id, s.price_idr, b.name AS brand_name, "
    "       l.code AS location_code, st.code AS site_code "
    "FROM quarantine_items q JOIN skus s ON s.id = q.sku_id JOIN brands b ON b.id = s.brand_id "
    "JOIN sites st ON st.id = q.site_id LEFT JOIN locations l ON l.id = q.location_id ")


def _photo_url(key: str | None) -> str | None:
    if not key:
        return None
    if key.startswith("inbound_photo:"):
        return f"/api/inbound/photos/{key.split(':', 1)[1]}/file"
    return f"/api/photos/{key}"


def _item_out(q: dict, names: dict, rule: dict) -> dict:
    now = utcnow()
    since = q["hq_rejected_at"] or q["reported_at"]
    due = since + timedelta(hours=rule.get("quarantine_decide_hours", 24)) if since else None
    if q["status"] == "write_off_pending" and q["decided_at"]:
        due = q["decided_at"] + timedelta(hours=rule.get("writeoff_approve_hours", 24))
    waiting = q["status"] in ("open", "write_off_pending")
    over = bool(waiting and due and now > due)
    hours = None
    if waiting and due:
        hours = round(abs((due - now).total_seconds()) / 3600)
    r = REASONS.get(q["reason"], (q["reason"], q["reason"]))
    b = BEARER.get(q["cost_bearer"], (q["cost_bearer"], q["cost_bearer"]))
    o = ORIGINS.get(q["origin"])
    where_id = {"hub": f"bin {bin_label(q.get('location_code'), q.get('site_code'))}",
                "inbound": "rusak saat barang masuk", "inbound_rejected": "ditolak saat barang masuk",
                "driver_return": f"kembali dari driver{(' · ' + q['order_ref']) if q['order_ref'] else ''}"
                }.get(q["origin"])
    return {
        "id": q["id"], "site_id": q["site_id"], "site_code": hub_short(q.get("site_code")),
        "sku_id": q["sku_id"], "sku_name": q.get("name_display"), "sku_code": q.get("brand_sku_code"),
        "brand_id": q.get("brand_id"), "brand_name": q.get("brand_name"),
        "qty": q["qty"], "origin": q["origin"], "where_id": where_id,
        "reason": q["reason"], "reason_id": r[0], "reason_en": r[1], "reason_note": q["reason_note"],
        "bin": bin_label(q.get("location_code"), q.get("site_code")), "tray_code": q["tray_code"],
        "photo_key": q["photo_key"],
        "photo_url": _photo_url(q["photo_key"]),
        "cost_bearer": q["cost_bearer"], "cost_bearer_id": b[0], "cost_bearer_en": b[1],
        "bearer_note_id": o[1] if o else q["bearer_note"], "bearer_note_en": o[2] if o else None,
        "status": q["status"], "status_id": STATUS.get(q["status"], ("", ""))[0],
        "status_en": STATUS.get(q["status"], ("", ""))[1],
        "reported_by": q["reported_by"], "reported_name": names.get(q["reported_by"]),
        "reported_at": iso(q["reported_at"]),
        "decided_by": q["decided_by"], "decided_name": names.get(q["decided_by"]),
        "decided_at": iso(q["decided_at"]), "decision_note": q["decision_note"],
        "hq_by": q["hq_by"], "hq_name": names.get(q["hq_by"]), "hq_at": iso(q["hq_at"]),
        "hq_note": q["hq_note"], "sent_back_by_hq": bool(q["hq_rejected_at"]) and q["status"] == "open",
        "due_at": iso(due) if waiting else None, "overdue": over,
        "due_id": (f"Lewat {hours} jam" if over else f"{hours} jam lagi") if hours is not None else None,
        "due_en": (f"{hours} h late" if over else f"{hours} h left") if hours is not None else None,
        "order_ref": q["order_ref"], "replenishment_id": q["replenishment_id"],
        "return_note_id": q["return_note_id"], "return_task_id": q["return_task_id"],
        "value_idr": int(q["qty"]) * int(q.get("price_idr") or 0),
    }


@router.get("/quarantine/reasons")
async def quarantine_reasons(user: auth.User = Depends(auth.current_user)):
    return {"reasons": [{"code": k, "id": v[0], "en": v[1], "on_phone": k in HUB_REASONS}
                        for k, v in REASONS.items()]}


@router.get("/quarantine/trays")
async def quarantine_trays(site_id: int, user: auth.User = Depends(auth.current_user)):
    await auth.assert_site_access(user, site_id)
    return {"trays": await trays(site_id)}


@router.get("/quarantine")
async def list_quarantine(site_id: int | None = None,
                          status: str = Query(default="open", pattern="^(open|decided|all)$"),
                          user: auth.User = Depends(auth.current_user)):
    """Karantina (7b): units in the tray waiting for the SPV, oldest first, each
    with its deadline. 'decided' adds the ones decided in the last 7 days."""
    await sync_inbound([site_id] if site_id else None)
    where, params = [], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("q.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih dark store. / Choose a dark store.")
    if status == "open":
        where.append("q.status = 'open'")
    elif status == "decided":
        where.append("q.status <> 'open' AND q.decided_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY")
    rows = await db.fetch_all(_ITEM_SQL + ("WHERE " + " AND ".join(where) if where else "") +
                              " ORDER BY q.reported_at, q.id", params)
    names = await names_for([r["reported_by"] for r in rows] + [r["decided_by"] for r in rows] +
                            [r["hq_by"] for r in rows])
    rule = await rule_values()
    items = [_item_out(r, names, rule) for r in rows]
    counts = await db.fetch_one(
        "SELECT SUM(status = 'open') AS open_n, SUM(status = 'write_off_pending') AS wo "
        "FROM quarantine_items" + (" WHERE site_id = %s" if site_id else ""),
        (site_id,) if site_id else ())
    return {"items": items, "in_tray": sum(i["qty"] for i in items if i["status"] == "open"),
            "overdue": sum(1 for i in items if i["overdue"]),
            "trays": await trays(site_id) if site_id else [],
            "tab_counts": {"karantina": int(counts["open_n"] or 0),
                           "persetujuan_hapus": int(counts["wo"] or 0)}}


# --- report a problem (7a) ----------------------------------------------------------

async def _sku_from_code(code: str) -> dict | None:
    sku = await common.sku_by_barcode(code.strip())
    if not sku:
        plate = await common.plate_by_code(code.strip())
        if plate and plate["sku_id"]:
            sku = await common.sku_by_id(plate["sku_id"])
    return sku


@router.get("/quarantine/lookup")
async def lookup_unit(site_id: int, code: str, user: auth.User = Depends(auth.current_user)):
    """Step 1 of Laporkan masalah: the product scanned and the bins it can come
    from (free units), the first one proposed."""
    site = await auth.assert_site_access(user, site_id)
    sku = await _sku_from_code(code)
    if not sku:
        raise HTTPException(422, "Barcode tidak dikenal. / Unknown barcode.")
    places = await common.pick_locations_for(site_id, sku["id"])
    bins = [{"location_id": p["location_id"], "bin": bin_label(p["location_code"], site["code"]),
             "free": int(p["available"] or 0)} for p in places]
    return {"sku_id": sku["id"], "sku_name": sku["name_display"], "photo_key": sku.get("photo_key"),
            "bins": bins, "bin": next((b["bin"] for b in bins if b["free"] > 0), None)}


@router.post("/quarantine/report", status_code=201)
async def report_problem(
    site_id: int = Form(...),
    code: str | None = Form(default=None, description="The unit's barcode as scanned"),
    sku_id: int | None = Form(default=None),
    bin_code: str | None = Form(default=None, description="The bin it came from; empty = the SKU's bin"),
    qty: int = Form(default=1, ge=1),
    reason: str = Form(...),
    note: str | None = Form(default=None),
    tray_code: str | None = Form(default=None, description="The tray label scanned (MA5-QR-01)"),
    order_ref: str | None = Form(default=None, description="Reason driver_rusak: the GM number"),
    photo: UploadFile | None = File(default=None),
    user: auth.User = Depends(auth.current_user),
):
    """Laporkan masalah: the unit leaves sellable stock at once, Hiryu gets the
    lower number, and the SPV gets it to decide. Reason driver_rusak (a parcel
    the driver brought back damaged) takes no bin: those units left the stock
    when they were picked."""
    site = await auth.assert_site_access(user, site_id)
    if reason not in HUB_REASONS + ("driver_rusak",):
        raise HTTPException(422, "Pilih alasan: Rusak, Bocor, Kedaluwarsa, Produk salah atau Kembali dari "
                                 "driver. / Choose a reason.")
    sku = await _sku_from_code(code) if code else (await common.sku_by_id(sku_id) if sku_id else None)
    if not sku:
        raise HTTPException(422, "Barcode tidak dikenal. / Unknown barcode.")
    if reason == "driver_rusak":
        tray = await _tray(site_id, tray_code, strict=bool(tray_code))
        photo_key = await storage.save(f"request/qr-{hub_short(site['code'])}", photo) if photo else None
        order = None
        if order_ref:
            order = await db.fetch_one("SELECT id, hiryu_short_no, external_ref FROM orders WHERE site_id = %s "
                                       "AND (hiryu_short_no = %s OR external_ref = %s) ORDER BY id DESC LIMIT 1",
                                       (site_id, order_ref.strip(), order_ref.strip()))
        async with db.tx() as cur:
            item_id = await add_driver_return(cur, site_id=site_id, sku_id=sku["id"], qty=qty,
                                              actor_email=user.email, order_id=order["id"] if order else None,
                                              order_ref=(order and (order["hiryu_short_no"] or order["external_ref"]))
                                              or (order_ref or None), reason_note=note, tray_code=tray,
                                              photo_key=photo_key, is_training=bool(site["is_training"]))
        return {"ok": True, "item_id": item_id, "tray_code": tray, "sku_name": sku["name_display"],
                "message": f"Di baki {tray}. Beban Ninja; Ops HQ klaim ke Grab di luar WMS. / In tray {tray}. "
                           "Ninja's cost; Ops HQ claims it from Grab outside the WMS."}
    if bin_code:
        short = hub_short(site["code"])
        c = bin_code.strip().upper()
        loc = await db.fetch_one("SELECT id FROM locations WHERE site_id = %s AND code IN (%s, %s)",
                                 (site_id, c, c if c.startswith(short + "-") else f"{short}-{c}"))
        if not loc:
            raise HTTPException(404, f"Bin {c} tidak ditemukan. / Bin {c} not found.")
        location_id = loc["id"]
    else:
        places = [p for p in await common.pick_locations_for(site_id, sku["id"])
                  if int(p["available"] or 0) >= qty]
        if not places:
            raise HTTPException(409, "Tidak ada stok bebas untuk barang ini. Pindai bin asalnya. / "
                                     "No free stock of this product. Scan the bin it came from.")
        location_id = places[0]["location_id"]
    tray = await _tray(site_id, tray_code, strict=bool(tray_code))
    photo_key = await storage.save(f"request/qr-{hub_short(site['code'])}", photo) if photo else None
    async with db.tx() as cur:
        item_id = await report_in_hub(cur, site_id=site_id, sku_id=sku["id"], location_id=location_id,
                                      qty=qty, reason=reason, actor_email=user.email, reason_note=note,
                                      tray_code=tray, photo_key=photo_key,
                                      is_training=bool(site["is_training"]))
    return {"ok": True, "item_id": item_id, "tray_code": tray, "sku_name": sku["name_display"],
            "message": f"Di baki {tray}. Barang langsung tidak dijual di Grab. / In tray {tray}. "
                       "No longer sold on Grab."}


# --- SPV decisions (7b) -----------------------------------------------------------------

@router.post("/quarantine/decisions")
async def decide(body: DecisionsIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Simpan keputusan. Back to the rack becomes a staff task (the stock rises
    when the bin is scanned); return puts it on the brand's list; write-off
    waits for Ops HQ. The cost bearer is already set."""
    done = []
    async with db.tx() as cur:
        for d in body.decisions:
            q = await db.one(cur, "SELECT * FROM quarantine_items WHERE id = %s FOR UPDATE", (d.item_id,))
            if not q or q["status"] not in ("open", "return_pending"):
                continue
            await auth.assert_site_access(user, q["site_id"])
            status = {"back_to_rack": "back_to_rack", "return": "return_pending",
                      "write_off": "write_off_pending"}[d.decision]
            task_id = None
            if d.decision == "back_to_rack":
                loc = q["location_id"]
                if not loc:
                    slot = await common.slot_for(q["site_id"], q["sku_id"])
                    loc = slot["location_id"] if slot else None
                if not loc:
                    raise HTTPException(409, "Barang ini belum punya bin. Atur di Rak & bin dulu. / "
                                             "This product has no bin yet. Set one on Rak & bin first.")
                # The return-to-shelf list (Pesanan, Kembalikan ke rak) does the
                # scan and the ledger, exactly like a cancelled order's units.
                task_id = await db.run(
                    cur, "INSERT INTO return_tasks (site_id, sku_id, order_id, external_ref, location_id, "
                         "qty, reason, is_training) VALUES (%s,%s,NULL,%s,%s,%s,'quarantine',%s)",
                    (q["site_id"], q["sku_id"], q["tray_code"], loc, q["qty"], q["is_training"]))
            await db.run(cur, "UPDATE quarantine_items SET status = %s, decided_by = %s, "
                              "decided_at = UTC_TIMESTAMP(), decision_note = %s, return_task_id = %s, "
                              "closed_at = IF(%s = 'back_to_rack', UTC_TIMESTAMP(), NULL) WHERE id = %s",
                         (status, user.email, d.note, task_id, status, q["id"]))
            await ledger.audit(cur, actor_email=user.email, entity="quarantine_item", entity_id=q["id"],
                               action="spv_decision", after={"decision": d.decision, "note": d.note})
            done.append({"item_id": q["id"], "status": status, "return_task_id": task_id})
    return {"ok": True, "decided": done,
            "message": f"{len(done)} keputusan disimpan. / {len(done)} decision(s) saved."}


# --- Ops HQ: write-offs (7c) ----------------------------------------------------------

@router.get("/quarantine/write-offs")
async def write_offs(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    """Persetujuan hapus: one list for every hub (or one), grouped by brand with
    the units per cost bearer. Everyone may look; only Ops HQ decides."""
    where, params = ["q.status = 'write_off_pending'"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("q.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih dark store. / Choose a dark store.")
    rows = await db.fetch_all(_ITEM_SQL + "WHERE " + " AND ".join(where) +
                              " ORDER BY b.name, q.decided_at", params)
    names = await names_for([r["reported_by"] for r in rows] + [r["decided_by"] for r in rows])
    rule = await rule_values()
    groups: dict = {}
    for r in rows:
        g = groups.setdefault(r["brand_id"], {"brand_id": r["brand_id"], "brand_name": r["brand_name"],
                                              "units": 0, "brand_units": 0, "ninja_units": 0, "items": []})
        g["units"] += r["qty"]
        g["brand_units" if r["cost_bearer"] == "brand" else "ninja_units"] += r["qty"]
        g["items"].append(_item_out(r, names, rule))
    return {"units": sum(g["units"] for g in groups.values()), "brands": list(groups.values())}


@router.post("/quarantine/write-offs/{item_id}/approve")
async def approve_write_off(item_id: int, body: HqNoteIn | None = None,
                            user: auth.User = Depends(auth.require("hq"))):
    """Setujui: the units leave for good and appear in the brand's monthly report
    with reason and cost bearer."""
    async with db.tx() as cur:
        q = await db.one(cur, "SELECT * FROM quarantine_items WHERE id = %s FOR UPDATE", (item_id,))
        if not q or q["status"] != "write_off_pending":
            raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
        await db.run(cur, "UPDATE quarantine_items SET status = 'written_off', hq_by = %s, "
                          "hq_at = UTC_TIMESTAMP(), hq_note = %s, closed_at = UTC_TIMESTAMP() WHERE id = %s",
                     (user.email, body.note if body else None, item_id))
        await ledger.audit(cur, actor_email=user.email, entity="quarantine_item", entity_id=item_id,
                           action="write_off_approved", after={"qty": q["qty"], "bearer": q["cost_bearer"]})
    return {"ok": True}


@router.post("/quarantine/write-offs/{item_id}/reject")
async def reject_write_off(item_id: int, body: HqNoteIn,
                           user: auth.User = Depends(auth.require("hq"))):
    """Tolak: the unit stays in the tray and goes back to the SPV with a note."""
    if not (body.note or "").strip():
        raise HTTPException(422, "Tulis catatan untuk SPV. / Write a note for the SPV.")
    async with db.tx() as cur:
        q = await db.one(cur, "SELECT * FROM quarantine_items WHERE id = %s FOR UPDATE", (item_id,))
        if not q or q["status"] != "write_off_pending":
            raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
        await db.run(cur, "UPDATE quarantine_items SET status = 'open', hq_by = %s, hq_at = UTC_TIMESTAMP(), "
                          "hq_note = %s, hq_rejected_at = UTC_TIMESTAMP() WHERE id = %s",
                     (user.email, body.note.strip(), item_id))
        await ledger.audit(cur, actor_email=user.email, entity="quarantine_item", entity_id=item_id,
                           action="write_off_rejected", after={"note": body.note})
    return {"ok": True}


# --- returns to the brand (7d to 7f) ---------------------------------------------------

async def _next_delivery(site_id: int, brand_id: int, cur=None) -> dict | None:
    sql = ("SELECT id, reference, status, eta_date FROM replenishments WHERE site_id = %s AND brand_id = %s "
           "AND status NOT IN ('draft','received','cancelled','variance_review','variance_signoff') "
           "ORDER BY COALESCE(eta_date, DATE(created_at)), id LIMIT 1")
    return await (db.one(cur, sql, (site_id, brand_id)) if cur is not None
                  else db.fetch_one(sql, (site_id, brand_id)))


async def _old_stock(site_id: int, brand_id: int, days: int) -> list[dict]:
    """Batches still on the shelf whose age, counted from the inbound date of the
    batch at that bin, is over the limit. No expiry dates are kept."""
    rows = await db.fetch_all(
        "SELECT ib.location_id, ib.sku_id, ib.stocked_since, ib.qty_on_hand, ib.qty_allocated, "
        "       l.code AS location_code, s.name_display, s.brand_sku_code, st.code AS site_code "
        "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
        "JOIN locations l ON l.id = ib.location_id AND l.is_virtual = 0 "
        "JOIN sites st ON st.id = ib.site_id "
        "WHERE ib.site_id = %s AND s.brand_id = %s AND ib.qty_on_hand > 0 "
        "  AND ib.stocked_since IS NOT NULL AND ib.stocked_since < UTC_TIMESTAMP() - INTERVAL %s DAY "
        "ORDER BY ib.stocked_since", (site_id, brand_id, days))
    out = []
    for r in rows:
        free = int(r["qty_on_hand"]) - int(r["qty_allocated"])
        if free <= 0:
            continue
        since = r["stocked_since"] + WIB
        out.append({"origin": "old_stock", "location_id": r["location_id"], "sku_id": r["sku_id"],
                    "sku_name": r["name_display"], "sku_code": r["brand_sku_code"],
                    "bin": bin_label(r["location_code"], r["site_code"]), "qty": free,
                    "inbound_date": str(since.date()),
                    "age_days": (utcnow() + WIB - since).days,
                    "where_id": f"Masuk {since.day} {MONTHS_ID[since.month - 1]}"})
    return out


@router.get("/returns-to-brand/candidates")
async def return_candidates(site_id: int, brand_id: int, user: auth.User = Depends(auth.current_user)):
    """Retur ke merek (7d): the three groups for one brand, and the delivery the
    return goes back with."""
    await auth.assert_site_access(user, site_id)
    await sync_inbound([site_id])
    rule = await rule_values()
    days = rule.get("stock_old_days", 90)
    rows = await db.fetch_all(_ITEM_SQL + "WHERE q.site_id = %s AND s.brand_id = %s "
                              "AND q.status = 'return_pending' ORDER BY q.reported_at", (site_id, brand_id))
    names = await names_for([r["reported_by"] for r in rows] + [r["decided_by"] for r in rows])
    items = [_item_out(r, names, rule) for r in rows]
    rej_info = {}
    rep_ids = sorted({r["replenishment_id"] for r in rows if r["replenishment_id"]})
    if rep_ids:
        for p in await db.fetch_all(
                f"SELECT id, reference, received_at FROM replenishments WHERE id IN ({db.placeholders(rep_ids)})",
                rep_ids):
            rej_info[p["id"]] = p
    for i in items:
        p = rej_info.get(i["replenishment_id"])
        i["delivery_ref"] = p["reference"] if p else None
    nxt = await _next_delivery(site_id, brand_id)
    return {
        "site_id": site_id, "brand_id": brand_id, "old_stock_days": days,
        "from_quarantine": [i for i in items if i["origin"] not in ("inbound_rejected",)],
        "old_stock": await _old_stock(site_id, brand_id, days),
        "rejected": [i for i in items if i["origin"] == "inbound_rejected"],
        "next_delivery": ({"id": nxt["id"], "reference": nxt["reference"],
                           "eta_date": str(nxt["eta_date"]) if nxt["eta_date"] else None} if nxt else None),
    }


async def _note_reference(cur, site: dict) -> str:
    prefix = f"RTR-{hub_short(site['code'])}-{wib_today():%y%m}-"
    row = await db.one(cur, "SELECT COUNT(*) AS n FROM return_notes WHERE reference LIKE %s",
                       (prefix + "%",))
    return f"{prefix}{int(row['n']) + 1:03d}"


@router.post("/returns-to-brand", status_code=201)
async def create_return_note(body: ReturnNoteIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Buat nota retur. Shelf units stop selling now (they leave the stock
    ledger); quarantine and refused units are already out of it."""
    site = await auth.assert_site_access(user, body.site_id)
    if not body.lines:
        raise HTTPException(422, "Centang barang yang diretur. / Tick the units to return.")
    async with db.tx() as cur:
        nxt = None
        if body.replenishment_id:
            nxt = await db.one(cur, "SELECT id FROM replenishments WHERE id = %s AND site_id = %s "
                                    "AND brand_id = %s", (body.replenishment_id, body.site_id, body.brand_id))
        else:
            nxt = await _next_delivery(body.site_id, body.brand_id, cur)
        ref = await _note_reference(cur, site)
        note_id = await db.run(
            cur, "INSERT INTO return_notes (site_id, brand_id, reference, replenishment_id, note, created_by) "
                 "VALUES (%s,%s,%s,%s,%s,%s)",
            (body.site_id, body.brand_id, ref, nxt["id"] if nxt else None, body.note, user.email))
        for ln in body.lines:
            if ln.origin in ("quarantine", "rejected"):
                q = await db.one(cur, "SELECT q.*, s.brand_id FROM quarantine_items q JOIN skus s ON s.id = q.sku_id "
                                      "WHERE q.id = %s FOR UPDATE", (ln.quarantine_item_id or 0,))
                if (not q or q["status"] != "return_pending" or q["site_id"] != body.site_id
                        or q["brand_id"] != body.brand_id):
                    raise HTTPException(409, "Barang karantina ini tidak bisa diretur. / "
                                             "This quarantined unit cannot be returned.")
                r = REASONS.get(q["reason"], (q["reason"],))[0]
                if q["reason_note"]:
                    r = f"{r} ({q['reason_note']})"
                await db.run(cur, "INSERT INTO return_note_lines (note_id, sku_id, origin, quarantine_item_id, "
                                  "qty, reason_text, ed_on_pack) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                             (note_id, q["sku_id"], "rejected" if q["origin"] == "inbound_rejected"
                              else "quarantine", q["id"], q["qty"], r, ln.ed_on_pack))
                await db.run(cur, "UPDATE quarantine_items SET status = 'on_note', return_note_id = %s "
                                  "WHERE id = %s", (note_id, q["id"]))
            else:
                if not (ln.location_id and ln.sku_id and ln.qty):
                    raise HTTPException(422, "Stok lama perlu bin, SKU dan jumlah. / Old stock needs the bin, "
                                             "SKU and quantity.")
                bal = await db.one(cur, "SELECT ib.qty_on_hand, ib.qty_allocated, ib.stocked_since, s.brand_id "
                                        "FROM inventory_balances ib JOIN skus s ON s.id = ib.sku_id "
                                        "WHERE ib.site_id = %s AND ib.sku_id = %s AND ib.location_id = %s "
                                        "FOR UPDATE", (body.site_id, ln.sku_id, ln.location_id))
                if not bal or bal["brand_id"] != body.brand_id or \
                        int(bal["qty_on_hand"]) - int(bal["qty_allocated"]) < ln.qty:
                    raise HTTPException(409, "Stok di bin ini tidak cukup untuk diretur. / "
                                             "Not enough stock in this bin to return.")
                line_id = await db.run(
                    cur, "INSERT INTO return_note_lines (note_id, sku_id, origin, location_id, stocked_since, "
                         "qty, reason_text, ed_on_pack) VALUES (%s,%s,'old_stock',%s,%s,%s,%s,%s)",
                    (note_id, ln.sku_id, ln.location_id, bal["stocked_since"], ln.qty,
                     "Stok lama" + (f", ED di kemasan {ln.ed_on_pack}" if ln.ed_on_pack else ""),
                     ln.ed_on_pack))
                mv = await ledger.apply(cur, site_id=body.site_id, sku_id=ln.sku_id,
                                        location_id=ln.location_id, qty_delta=-ln.qty,
                                        movement_type="adjustment", actor_email=user.email,
                                        ref_type="return_note_line", ref_id=line_id,
                                        reason_code="return_to_brand", scan_source="manual",
                                        is_training=bool(site["is_training"]))
                await db.run(cur, "UPDATE return_note_lines SET movement_id = %s WHERE id = %s", (mv, line_id))
        await ledger.audit(cur, actor_email=user.email, entity="return_note", entity_id=note_id,
                           action="create", after={"reference": ref, "lines": len(body.lines)})
    return {"ok": True, "id": note_id, "reference": ref,
            "delivery_ref": None if not nxt else (await db.fetch_one(
                "SELECT reference FROM replenishments WHERE id = %s", (nxt["id"],)))["reference"]}


async def _note(note_id: int, user: auth.User) -> dict:
    n = await db.fetch_one(
        "SELECT rn.*, b.name AS brand_name, st.code AS site_code, st.name AS site_name, "
        "       rp.reference AS delivery_ref, rp.status AS delivery_status "
        "FROM return_notes rn JOIN brands b ON b.id = rn.brand_id JOIN sites st ON st.id = rn.site_id "
        "LEFT JOIN replenishments rp ON rp.id = rn.replenishment_id WHERE rn.id = %s", (note_id,))
    if not n:
        raise HTTPException(404, "Nota retur tidak ditemukan. / Return note not found.")
    await auth.assert_site_access(user, n["site_id"])
    return n


async def _note_out(n: dict) -> dict:
    lines = await db.fetch_all(
        "SELECT ln.*, s.name_display, s.brand_sku_code, l.code AS location_code, q.reported_at, "
        "       q.origin AS q_origin FROM return_note_lines ln JOIN skus s ON s.id = ln.sku_id "
        "LEFT JOIN locations l ON l.id = ln.location_id "
        "LEFT JOIN quarantine_items q ON q.id = ln.quarantine_item_id "
        "WHERE ln.note_id = %s ORDER BY FIELD(ln.origin,'quarantine','old_stock','rejected'), ln.id",
        (n["id"],))
    company = None
    if "company" in {c["c"] for c in await db.fetch_all(
            "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_NAME = 'brands'")}:
        row = await db.fetch_one("SELECT company FROM brands WHERE id = %s", (n["brand_id"],))
        company = row and row["company"]
    names = await names_for([n["created_by"], n["handed_over_by"]])
    creator_role = await db.fetch_one("SELECT role FROM users WHERE email = %s", (n["created_by"],))
    out_lines = []
    for i, ln in enumerate(lines, 1):
        if ln["origin"] == "old_stock":
            d = ln["stocked_since"] + WIB if ln["stocked_since"] else None
            asal = f"Rak {bin_label(ln['location_code'], n['site_code'])}" + (
                f", masuk {d.day} {MONTHS_ID[d.month - 1]}"
                if d else "")
        elif ln["origin"] == "rejected":
            d = ln["reported_at"] + WIB if ln["reported_at"] else None
            asal = "Kiriman ditolak" + (f", {d.day} {MONTHS_ID[d.month - 1]}" if d else "")
        else:
            asal = "Karantina"
        out_lines.append({"no": i, "id": ln["id"], "sku_id": ln["sku_id"], "sku_name": ln["name_display"],
                          "sku_code": ln["brand_sku_code"], "origin": ln["origin"], "asal_id": asal,
                          "reason_id": ln["reason_text"], "ed_on_pack": ln["ed_on_pack"],
                          "qty": ln["qty"], "qty_scanned": ln["qty_scanned"]})
    created = n["created_at"] + WIB
    return {
        "id": n["id"], "reference": n["reference"], "status": n["status"],
        "site_id": n["site_id"], "site_code": hub_short(n["site_code"]), "site_name": n["site_name"],
        "brand_id": n["brand_id"], "brand_name": n["brand_name"], "brand_company": company,
        "delivery_id": n["replenishment_id"], "delivery_ref": n["delivery_ref"],
        "delivery_status": n["delivery_status"],
        "created_by": n["created_by"], "created_name": names.get(n["created_by"]),
        "created_role": creator_role["role"] if creator_role else None,
        "created_at": iso(n["created_at"]), "date_label": id_date(created.date()),
        "products": len({ln["sku_id"] for ln in lines}),
        "units": sum(ln["qty"] for ln in lines), "scanned": sum(ln["qty_scanned"] for ln in lines),
        "printed_at": iso(n["printed_at"]),
        "handed_over_by": n["handed_over_by"], "handed_over_name": names.get(n["handed_over_by"]),
        "handed_over_at": iso(n["handed_over_at"]), "driver_name": n["driver_name"],
        "vehicle_no": n["vehicle_no"], "note": n["note"], "lines": out_lines,
    }


@router.get("/returns-to-brand")
async def list_return_notes(site_id: int, status: str = Query(default="open", pattern="^(open|handed_over|all)$"),
                            user: auth.User = Depends(auth.current_user)):
    await auth.assert_site_access(user, site_id)
    where = "WHERE rn.site_id = %s" + ("" if status == "all" else " AND rn.status = %s")
    params = (site_id,) if status == "all" else (site_id, status)
    rows = await db.fetch_all(
        "SELECT rn.id, rn.reference, rn.status, rn.created_at, rn.handed_over_at, b.name AS brand_name, "
        "       rp.reference AS delivery_ref, rp.status AS delivery_status, "
        "       (SELECT SUM(qty) FROM return_note_lines WHERE note_id = rn.id) AS units, "
        "       (SELECT SUM(qty_scanned) FROM return_note_lines WHERE note_id = rn.id) AS scanned "
        "FROM return_notes rn JOIN brands b ON b.id = rn.brand_id "
        "LEFT JOIN replenishments rp ON rp.id = rn.replenishment_id " + where +
        " ORDER BY rn.created_at DESC LIMIT 100", params)
    return {"notes": [{"id": r["id"], "reference": r["reference"], "status": r["status"],
                       "brand_name": r["brand_name"], "delivery_ref": r["delivery_ref"],
                       "delivery_status": r["delivery_status"], "units": int(r["units"] or 0),
                       "scanned": int(r["scanned"] or 0), "created_at": iso(r["created_at"]),
                       "handed_over_at": iso(r["handed_over_at"])} for r in rows]}


@router.get("/returns-to-brand/{note_id}")
async def return_note(note_id: int, user: auth.User = Depends(auth.current_user)):
    """The note for printing (7e, A4, two copies) and for scanning out (7f)."""
    return await _note_out(await _note(note_id, user))


@router.post("/returns-to-brand/{note_id}/printed")
async def mark_printed(note_id: int, user: auth.User = Depends(auth.current_user)):
    await _note(note_id, user)
    await db.execute("UPDATE return_notes SET printed_at = COALESCE(printed_at, UTC_TIMESTAMP()) "
                     "WHERE id = %s", (note_id,))
    return {"ok": True}


@router.post("/returns-to-brand/{note_id}/scan")
async def scan_return_unit(note_id: int, body: ReturnScanIn, user: auth.User = Depends(auth.current_user)):
    """Serahkan retur: one unit scanned out against the note."""
    replayed = await ledger.replay(body.idempotency_key, "return_note_scan")
    if replayed:
        return replayed
    n = await _note(note_id, user)
    if n["status"] != "open":
        raise HTTPException(409, "Nota ini sudah diserahkan atau dibatalkan. / This note is closed.")
    sku = await common.sku_by_barcode(body.code.strip())
    if not sku:
        plate = await common.plate_by_code(body.code.strip())
        if plate and plate["sku_id"]:
            sku = {"id": plate["sku_id"], "name_display": plate.get("sku_name")}
    if not sku:
        raise HTTPException(422, "Barcode tidak dikenal. / Unknown barcode.")
    async with db.tx() as cur:
        ln = await db.one(cur, "SELECT id, qty, qty_scanned FROM return_note_lines WHERE note_id = %s "
                               "AND sku_id = %s AND qty_scanned < qty ORDER BY id LIMIT 1 FOR UPDATE",
                          (note_id, sku["id"]))
        if not ln:
            raise HTTPException(409, f"{sku.get('name_display')} tidak ada di nota ini atau sudah lengkap. / "
                                     "Not on this note, or already complete.")
        await db.run(cur, "UPDATE return_note_lines SET qty_scanned = qty_scanned + 1 WHERE id = %s",
                     (ln["id"],))
        tot = await db.one(cur, "SELECT SUM(qty) AS q, SUM(qty_scanned) AS s FROM return_note_lines "
                                "WHERE note_id = %s", (note_id,))
        left = int(tot["q"]) - int(tot["s"])
        result = {"ok": True, "line_id": ln["id"], "line_scanned": ln["qty_scanned"] + 1,
                  "line_qty": ln["qty"], "scanned": int(tot["s"]), "units": int(tot["q"]),
                  "all_scanned": left == 0,
                  "message": ("Semua unit dipindai. Driver tanda tangan nota. / All units scanned. "
                              "The driver signs the note.") if left == 0 else
                             f"Pindai {left} unit lagi. / Scan {left} more."}
        await ledger.remember(cur, body.idempotency_key, "return_note_scan", result)
    return result


@router.post("/returns-to-brand/{note_id}/handover")
async def hand_over(note_id: int, body: HandoverIn | None = None,
                    user: auth.User = Depends(auth.current_user)):
    """Driver sudah tanda tangan: the units leave the hub for good."""
    n = await _note(note_id, user)
    async with db.tx() as cur:
        locked = await db.one(cur, "SELECT status FROM return_notes WHERE id = %s FOR UPDATE", (note_id,))
        if locked["status"] != "open":
            raise HTTPException(409, "Nota ini sudah diserahkan atau dibatalkan. / This note is closed.")
        tot = await db.one(cur, "SELECT SUM(qty) AS q, SUM(qty_scanned) AS s FROM return_note_lines "
                                "WHERE note_id = %s", (note_id,))
        if int(tot["s"] or 0) < int(tot["q"] or 0):
            raise HTTPException(409, f"Baru {int(tot['s'] or 0)} dari {int(tot['q'] or 0)} unit dipindai. / "
                                     "Scan every unit first.")
        await db.run(cur, "UPDATE return_notes SET status = 'handed_over', handed_over_by = %s, "
                          "handed_over_at = UTC_TIMESTAMP(), driver_name = %s, vehicle_no = %s WHERE id = %s",
                     (user.email, body.driver_name if body else None, body.vehicle_no if body else None,
                      note_id))
        await _release_inbound_loads(cur, note_id, user.email)
        await db.run(cur, "UPDATE quarantine_items SET status = 'returned', closed_at = UTC_TIMESTAMP() "
                          "WHERE return_note_id = %s AND status = 'on_note'", (note_id,))
        await ledger.audit(cur, actor_email=user.email, entity="return_note", entity_id=note_id,
                           action="handed_over", after={"reference": n["reference"]})
    return {"ok": True, "message": "Retur diserahkan. Satu lembar dibawa driver, satu disimpan SPV. / "
                                   "Handed over. One copy goes with the driver, one stays with the SPV."}


@router.post("/returns-to-brand/{note_id}/cancel")
async def cancel_note(note_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Cancel an open note: shelf units go back on sale at their bin, quarantine
    and refused units back onto the return list."""
    n = await _note(note_id, user)
    site = await auth.assert_site_access(user, n["site_id"])
    async with db.tx() as cur:
        locked = await db.one(cur, "SELECT status FROM return_notes WHERE id = %s FOR UPDATE", (note_id,))
        if locked["status"] != "open":
            raise HTTPException(409, "Nota ini sudah ditutup. / This note is closed.")
        for ln in await db.many(cur, "SELECT * FROM return_note_lines WHERE note_id = %s "
                                     "AND origin = 'old_stock'", (note_id,)):
            await ledger.apply(cur, site_id=n["site_id"], sku_id=ln["sku_id"], location_id=ln["location_id"],
                               qty_delta=ln["qty"], movement_type="adjustment", actor_email=user.email,
                               ref_type="return_note_line", ref_id=ln["id"], reason_code="return_cancelled",
                               scan_source="manual", is_training=bool(site["is_training"]))
        await db.run(cur, "UPDATE quarantine_items SET status = 'return_pending', return_note_id = NULL "
                          "WHERE return_note_id = %s AND status = 'on_note'", (note_id,))
        await db.run(cur, "UPDATE return_notes SET status = 'cancelled', cancelled_by = %s, "
                          "cancelled_at = UTC_TIMESTAMP() WHERE id = %s", (user.email, note_id))
    return {"ok": True}
