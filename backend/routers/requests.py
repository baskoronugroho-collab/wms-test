"""Unknown product during inbound -> Ops HQ -> back to the station.

1. A staffer scans a barcode the WMS does not know and cannot find the product in
   the list. They photograph it, count the units, and send a request. The units
   wait in the station's temporary inbound bin and are NOT in the ledger yet.
2. Ops HQ registers the SKU (or matches an existing one), binds the barcode, and
   gives the SKU a rack at that station. Or rejects the request (not ours,
   return it to the brand).
3. The staffer sees the answer, carries the units to the rack, and confirms. The
   units enter the ledger then, against the original receipt when there is one.

Photos for SKUs are uploaded here too, because both paths share the storage.
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

import auth
import common
import db
import ledger
import models
import storage
from routers import locations

router = APIRouter(prefix="/api", tags=["sku requests"])

STATUSES = ("open", "resolved", "rejected", "put_away")


# --- photos -----------------------------------------------------------------

@router.get("/photos/{key:path}")
async def get_photo(key: str, user: auth.User = Depends(auth.current_user)):
    data, ctype = await storage.load(key)
    return Response(content=data, media_type=ctype,
                    headers={"Cache-Control": "private, max-age=86400"})


@router.post("/skus/{sku_id}/photo", response_model=models.Sku)
async def upload_sku_photo(
    sku_id: int, file: UploadFile = File(...),
    user: auth.User = Depends(auth.require("hq")),
):
    """HQ sets a product photo: the picker's main way to tell 118 shades apart."""
    if not await common.sku_by_id(sku_id):
        raise HTTPException(404, "SKU not found")
    key = await storage.save(f"sku/{sku_id}", file)
    async with db.tx() as cur:
        await db.run(cur, "UPDATE skus SET photo_key = %s WHERE id = %s", (key, sku_id))
        await ledger.audit(cur, actor_email=user.email, entity="sku", entity_id=sku_id,
                           action="photo", after={"photo_key": key})
    return common.sku_dict(await common.sku_by_id(sku_id))


# --- requests -----------------------------------------------------------------

async def _payload(request_id: int) -> dict:
    r = await db.fetch_one(
        "SELECT q.*, st.code AS site_code, st.name AS site_name, b.name AS brand_name, "
        "       s.name_display AS sku_name, s.brand_sku_code, l.code AS location_code, "
        "       ir.external_reference AS receipt_reference "
        "FROM sku_requests q "
        "JOIN sites st ON st.id = q.site_id "
        "LEFT JOIN brands b ON b.id = q.brand_id "
        "LEFT JOIN skus s ON s.id = q.sku_id "
        "LEFT JOIN locations l ON l.id = q.location_id "
        "LEFT JOIN inbound_receipts ir ON ir.id = q.receipt_id "
        "WHERE q.id = %s", (request_id,))
    if not r:
        raise HTTPException(404, "Request not found")
    out = {k: r[k] for k in (
        "id", "site_id", "site_code", "site_name", "receipt_id", "receipt_reference",
        "brand_id", "brand_name", "barcode", "qty_counted", "photo_key", "note", "status",
        "raised_by", "sku_id", "sku_name", "brand_sku_code", "location_id",
        "location_code", "resolution_note", "resolved_by", "qty_put_away", "put_away_by")}
    for k in ("raised_at", "resolved_at", "put_away_at"):
        out[k] = str(r[k]) if r[k] else None
    return out


@router.post("/sku-requests", response_model=models.SkuRequest, status_code=201)
async def raise_request(
    site_id: int = Form(...),
    qty_counted: int = Form(...),
    receipt_id: int | None = Form(default=None),
    barcode: str | None = Form(default=None),
    brand_id: int | None = Form(default=None),
    note: str | None = Form(default=None),
    photo: UploadFile | None = File(default=None),
    user: auth.User = Depends(auth.current_user),
):
    """A staffer asks HQ to register a product the WMS does not know."""
    site = await auth.assert_site_access(user, site_id)
    if qty_counted < 1:
        raise HTTPException(422, "Hitung dulu berapa unit. / Count the units first.")
    code = (barcode or "").strip()[:64] or None
    if code and await common.sku_by_barcode(code):
        raise HTTPException(409, "Barcode ini sudah dikenal. Pindai ulang. / This barcode is "
                                 "already known. Scan it again.")
    if receipt_id:
        rc = await db.fetch_one("SELECT site_id FROM inbound_receipts WHERE id = %s",
                                (receipt_id,))
        if not rc or rc["site_id"] != site_id:
            raise HTTPException(409, "That receipt belongs to another station.")
    if code:
        dup = await db.fetch_one(
            "SELECT id FROM sku_requests WHERE site_id = %s AND barcode = %s AND status = 'open'",
            (site_id, code))
        if dup:
            raise HTTPException(
                409, f"Barcode ini sudah dikirim ke HQ (permintaan #{dup['id']}). Tunggu "
                     f"jawabannya. / Already sent to HQ as request #{dup['id']}.")
    photo_key = None
    if photo is not None and photo.filename:
        photo_key = await storage.save(f"request/{site['code']}", photo)
    async with db.tx() as cur:
        rid = await db.run(
            cur,
            "INSERT INTO sku_requests (site_id, receipt_id, brand_id, barcode, qty_counted, "
            "photo_key, note, raised_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (site_id, receipt_id, brand_id, code, qty_counted, photo_key,
             (note or "").strip()[:400] or None, user.email))
        await ledger.audit(cur, actor_email=user.email, entity="sku_request", entity_id=rid,
                           action="raise", after={"barcode": code, "qty": qty_counted})
    return await _payload(rid)


@router.get("/sku-requests", response_model=models.SkuRequestList)
async def list_requests(
    site_id: int | None = None,
    status: str = Query(default="active", pattern="^(active|all|open|resolved|rejected|put_away)$"),
    receipt_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=300),
    user: auth.User = Depends(auth.current_user),
):
    """A station sees its own requests; HQ sees every station's."""
    where, params = ["1=1"], []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("q.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "site_id is required.")
    if receipt_id:
        where.append("q.receipt_id = %s")
        params.append(receipt_id)
    # Counts ignore the status filter, so the tabs always show every lane.
    scope, scope_params = " AND ".join(where), tuple(params)
    if status == "active":
        where.append("q.status IN ('open','resolved')")
    elif status != "all":
        where.append("q.status = %s")
        params.append(status)
    ids = await db.fetch_all(
        "SELECT q.id FROM sku_requests q WHERE " + " AND ".join(where) +
        " ORDER BY FIELD(q.status,'open','resolved','rejected','put_away'), q.raised_at DESC "
        "LIMIT %s", (*params, limit))
    counts = await db.fetch_all(
        "SELECT q.status, COUNT(*) AS n FROM sku_requests q WHERE " + scope +
        " GROUP BY q.status", scope_params)
    return {
        "requests": [await _payload(i["id"]) for i in ids],
        "counts": {c["status"]: int(c["n"]) for c in counts},
    }


@router.post("/sku-requests/{request_id}/resolve", response_model=models.SkuRequest)
async def resolve_request(
    request_id: int, body: models.SkuRequestResolveIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """HQ registers (or matches) the SKU, binds the barcode, and racks it at the
    requesting station, so the staffer's next step is only "carry it there"."""
    req = await db.fetch_one("SELECT * FROM sku_requests WHERE id = %s", (request_id,))
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "open":
        raise HTTPException(409, "Permintaan ini sudah dijawab. / Already answered.")

    sku_id = body.sku_id
    if not sku_id and not body.new_sku:
        raise HTTPException(422, "Pilih SKU yang ada, atau daftarkan SKU baru.")
    if body.new_sku:
        created = await _create_sku(body.new_sku, user)
        sku_id = created["id"]
    sku = await common.sku_by_id(sku_id)
    if not sku:
        raise HTTPException(404, "SKU not found")

    owner = None
    if req["barcode"]:
        owner = await db.fetch_one("SELECT sku_id FROM barcodes WHERE barcode = %s",
                                   (req["barcode"],))
        if owner and owner["sku_id"] != sku_id:
            other = await common.sku_by_id(owner["sku_id"])
            raise HTTPException(409, f"Barcode {req['barcode']} sudah milik "
                                     f"{other['name_display'] if other else 'SKU lain'}.")

    # Rack before barcode: it is the step that can still fail (no free bin), and it
    # should fail before the barcode is bound for good.
    slot = await common.slot_for(req["site_id"], sku_id)
    if not slot:
        await locations.assign_slot(
            models.SlotIn(site_id=req["site_id"], sku_id=sku_id, basket_id=body.basket_id),
            user)
        slot = await common.slot_for(req["site_id"], sku_id)

    # The barcode on the unit becomes this SKU's, unless it already is someone's.
    if req["barcode"] and not owner:
        await db.execute(
            "INSERT INTO barcodes (barcode, sku_id, source, registered_by) "
            "VALUES (%s,%s,'hq_request',%s)", (req["barcode"], sku_id, user.email))

    # A product with no photo yet gets the one the staffer took.
    if req["photo_key"] and not sku.get("photo_key"):
        await db.execute("UPDATE skus SET photo_key = %s WHERE id = %s",
                         (req["photo_key"], sku_id))

    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE sku_requests SET status='resolved', sku_id=%s, location_id=%s, "
            "resolution_note=%s, resolved_by=%s, resolved_at=NOW() WHERE id=%s",
            (sku_id, slot["location_id"], (body.note or "").strip()[:400] or None,
             user.email, request_id))
        await ledger.audit(cur, actor_email=user.email, entity="sku_request",
                           entity_id=request_id, action="resolve",
                           after={"sku_id": sku_id, "location": slot["location_code"]})
    return await _payload(request_id)


@router.post("/sku-requests/{request_id}/reject", response_model=models.SkuRequest)
async def reject_request(
    request_id: int, body: models.SkuRequestRejectIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Not a product we hold: the units go back to the brand, never into stock."""
    req = await db.fetch_one("SELECT status FROM sku_requests WHERE id = %s", (request_id,))
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "open":
        raise HTTPException(409, "Permintaan ini sudah dijawab. / Already answered.")
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(422, "Tulis alasannya untuk staf. / Tell the station why.")
    await db.execute(
        "UPDATE sku_requests SET status='rejected', resolution_note=%s, resolved_by=%s, "
        "resolved_at=NOW() WHERE id=%s", (note[:400], user.email, request_id))
    return await _payload(request_id)


@router.post("/sku-requests/{request_id}/put-away", response_model=models.SkuRequest)
async def put_away_request(
    request_id: int, body: models.SkuRequestPutAwayIn,
    user: auth.User = Depends(auth.current_user),
):
    """The staffer carried the units from the temporary bin to the rack HQ gave."""
    req = await db.fetch_one("SELECT * FROM sku_requests WHERE id = %s", (request_id,))
    if not req:
        raise HTTPException(404, "Request not found")
    site = await auth.assert_site_access(user, req["site_id"])
    if req["status"] == "put_away":
        return await _payload(request_id)
    if req["status"] != "resolved":
        raise HTTPException(409, "HQ belum menjawab permintaan ini. / HQ has not answered yet.")
    qty = body.qty if body.qty is not None else req["qty_counted"]
    if qty < 0:
        raise HTTPException(422, "Jumlah tidak boleh negatif.")

    async with db.tx() as cur:
        locked = await db.one(cur, "SELECT status FROM sku_requests WHERE id = %s FOR UPDATE",
                              (request_id,))
        if locked["status"] != "resolved":
            return await _payload(request_id)
        if qty:
            await ledger.apply(
                cur, site_id=req["site_id"], sku_id=req["sku_id"],
                location_id=req["location_id"], qty_delta=qty, movement_type="receipt_in",
                actor_email=user.email,
                ref_type="receipt" if req["receipt_id"] else "sku_request",
                ref_id=req["receipt_id"] or request_id,
                is_training=bool(site["is_training"]))
            if req["receipt_id"]:
                await db.run(
                    cur,
                    "INSERT INTO receipt_lines (receipt_id, sku_id, qty_received, location_id) "
                    "VALUES (%s,%s,%s,%s) ON DUPLICATE KEY UPDATE "
                    "qty_received = qty_received + %s, location_id = VALUES(location_id)",
                    (req["receipt_id"], req["sku_id"], qty, req["location_id"], qty))
                # HQ may answer after the delivery was closed. Its Surat Jalan
                # then has to learn about these units too.
                receipt = await db.one(cur, "SELECT * FROM inbound_receipts WHERE id = %s",
                                       (req["receipt_id"],))
                if receipt and receipt["status"] != "open":
                    from routers import replenishment
                    await replenishment.close_on_receipt(cur, receipt)
        await db.run(
            cur,
            "UPDATE sku_requests SET status='put_away', qty_put_away=%s, put_away_by=%s, "
            "put_away_at=NOW() WHERE id=%s", (qty, user.email, request_id))
    return await _payload(request_id)


# --- SKU creation shared with the product screen ---------------------------------

async def _create_sku(body: models.SkuIn, user: auth.User) -> dict:
    from routers import master
    return await master.create_sku(body, user)
