"""The interim Hiryu bridge (PRD v3.3 §13.2 to §13.6).

Hiryu and the WMS are not linked yet, so people carry the information across:

  * orders come in by pasting the Hiryu order page (read in the browser; only
    the fields below ever reach this router, and nothing about the customer);
  * the SPV types stock back into Hiryu from the stock sheet;
  * Ops HQ keeps two maps: Hiryu menu items -> SKU and units per sale, and
    Hiryu store numbers -> hub and brand.

Hiryu first (PRD §2.12): every tap here records something the person has
already done in Hiryu (Mark ready, a cancel) or reads what Hiryu shows.
"""
import csv
import io
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

import auth
import db
import ledger
import models
from routers import outbound

router = APIRouter(prefix="/api/hiryu", tags=["hiryu"])

OPEN_STATUSES = {"RECEIVED", "ACCEPTED", "PREPARING"}
CANCEL_STATUSES = {"CANCELLED", "REJECTED", "FAILED", "REFUNDED"}
LATE_STATUSES = {"READY_FOR_PICKUP", "PICKED_UP", "DRIVER_ALLOCATED", "DRIVER_ARRIVED",
                 "COLLECTED", "DELIVERED", "BILL_PAID", "COMPLETED"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _audit(actor: str, entity: str, entity_id: int | None, action: str,
                 after: dict | None = None) -> None:
    async with db.tx() as cur:
        await ledger.audit(cur, actor_email=actor, entity=entity, entity_id=entity_id,
                           action=action, after=after)


async def rule(key: str, default: int) -> int:
    row = await db.fetch_one(
        "SELECT enabled, value_num FROM alert_rules WHERE rule_key = %s", (key,))
    if not row or row["value_num"] is None:
        return default
    return int(row["value_num"])


def _utc(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Waktu tidak dikenal: {value} / Not a time: {value}")
    if ts.tzinfo is not None:
        ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
    return ts


# --------------------------------------------------------------------------
# Paste an order (§13.2)
# --------------------------------------------------------------------------

@router.post("/paste", response_model=models.HiryuPasteResult)
async def paste_order(body: models.HiryuPasteIn,
                      user: auth.User = Depends(auth.current_user)):
    """A staffer pasted a Hiryu order page. The browser already dropped everything
    but these fields; the model refuses any other field."""
    await auth.assert_site_access(user, body.site_id)

    # 1. Hiryu's own count must match what was read: an incomplete copy stops here.
    lines_found = len(body.lines)
    units_found = sum(l.qty for l in body.lines)
    if body.declared_lines is not None and body.declared_lines != lines_found:
        raise HTTPException(422, "Salinan tidak lengkap, salin ulang seluruh halaman. / "
                                 "Incomplete copy: copy the whole page again.")
    if body.declared_units is not None and body.declared_units != units_found:
        raise HTTPException(422, "Salinan tidak lengkap, salin ulang seluruh halaman. / "
                                 "Incomplete copy: copy the whole page again.")

    # 2. Which hub and brand: the Hiryu store map.
    store = await db.fetch_one(
        "SELECT hs.*, s.code AS site_code FROM hiryu_stores hs "
        "JOIN sites s ON s.id = hs.site_id WHERE hs.hiryu_store_no = %s AND hs.active = 1",
        (body.store_no,))
    if not store:
        raise HTTPException(422, f"Toko Hiryu #{body.store_no} belum terdaftar. Beri tahu SPV. / "
                                 f"Hiryu store #{body.store_no} is not mapped yet. Tell the SPV.")
    if store["site_id"] != body.site_id:
        raise HTTPException(409, f"Toko ini milik hub lain: {store['site_code']}. / "
                                 f"This store belongs to another hub: {store['site_code']}.")

    status = body.status.upper()
    existing = await db.fetch_one(
        "SELECT o.id, o.status, pt.id AS task_id FROM orders o "
        "LEFT JOIN pick_tasks pt ON pt.order_id = o.id WHERE o.external_ref = %s",
        (body.grab_order_id,))

    # 3. A cancelled order: the same confirmation as the Dibatalkan di Hiryu button.
    if status in CANCEL_STATUSES:
        if not existing:
            return {"action": "none", "order_id": None, "pick_task_id": None,
                    "short_no": body.short_no,
                    "message": "Pesanan ini dibatalkan di Hiryu dan tidak ada di WMS. Tidak perlu apa-apa. / "
                               "Cancelled in Hiryu and not in the WMS: nothing to do."}
        return {"action": "confirm_cancel", "order_id": existing["id"],
                "pick_task_id": existing["task_id"], "short_no": body.short_no,
                "message": "Pesanan ini dibatalkan di Hiryu. Tekan Dibatalkan di Hiryu untuk melepas stoknya. / "
                           "Cancelled in Hiryu: confirm to release its stock."}

    # 4. The same order again: open its pick.
    if existing:
        return {"action": "open", "order_id": existing["id"],
                "pick_task_id": existing["task_id"], "short_no": body.short_no,
                "message": "Pesanan sudah ada. / Order already pasted."}

    # 5. Follow Hiryu's acceptance (§9.2b).
    acceptance = (body.acceptance or "").upper() or None
    if acceptance == "MANUAL" and status == "RECEIVED":
        raise HTTPException(409, "Tekan Accept di Hiryu dulu, lalu salin ulang. / "
                                 "Press Accept in Hiryu first, then copy again.")
    if status in LATE_STATUSES:
        raise HTTPException(409, "Pesanan ini sudah lewat tahap ambil barang. Laporkan ke supervisor. / "
                                 "This order is past picking. Tell the supervisor.")
    if status not in OPEN_STATUSES:
        raise HTTPException(422, f"Status Hiryu tidak dikenal: {status}. / Unknown Hiryu status.")

    # 6. Items -> SKUs. Anything unconnected stops the paste and goes to HQ's list.
    ids = [l.item_id for l in body.lines]
    mapped = {r["hiryu_item_id"]: r for r in await db.fetch_all(
        f"SELECT hiryu_item_id, sku_id, units_per_sale, item_name FROM hiryu_items "
        f"WHERE hiryu_item_id IN ({db.placeholders(ids)})", ids)}
    missing = [l for l in body.lines if not (mapped.get(l.item_id) or {}).get("sku_id")]
    if missing:
        for l in missing:
            await db.execute(
                "INSERT INTO hiryu_items (hiryu_item_id, brand_id, item_name, seen_in_order) "
                "VALUES (%s,%s,%s,1) ON DUPLICATE KEY UPDATE seen_in_order = 1, "
                "item_name = COALESCE(item_name, VALUES(item_name)), "
                "brand_id = COALESCE(brand_id, VALUES(brand_id))",
                (l.item_id, store["brand_id"], (l.item_name or "")[:255] or None))
        names = ", ".join((l.item_name or l.item_id) for l in missing)
        raise HTTPException(422, f"Barang belum dihubungkan, sudah dikirim ke HQ: {names}. / "
                                 f"Items not connected yet, sent to Ops HQ: {names}.")

    # Units per SKU = quantity x units per sale; two items on one SKU add up.
    per_sku: dict[int, int] = {}
    for l in body.lines:
        m = mapped[l.item_id]
        per_sku[m["sku_id"]] = per_sku.get(m["sku_id"], 0) + l.qty * int(m["units_per_sale"] or 1)

    # 7. Ready-by (§9.2, §9.2a).
    placed = _utc(body.order_time) or _now()
    scheduled = _utc(body.scheduled_time)
    if scheduled:
        promised = scheduled - timedelta(minutes=await rule("scheduled_lead_minutes", 20))
    else:
        promised = placed + timedelta(minutes=await rule("grab_ready_minutes", 10))

    order_in = models.OrderIn(
        external_ref=body.grab_order_id, site_id=body.site_id,
        lines=[models.OrderLineIn(sku_id=sid, quantity=q) for sid, q in per_sku.items()],
        channel="grab", delivery_mode="grab_rider",
        placed_at=placed.isoformat() + "Z", promised_at=promised.isoformat() + "Z",
    )
    result = await outbound.receive_order(order_in)
    await db.execute(
        "UPDATE orders SET hiryu_short_no=%s, hiryu_store_no=%s, source=%s, acceptance=%s, "
        "scheduled_at=%s, pasted_by=%s, pasted_at=UTC_TIMESTAMP() WHERE id=%s",
        (body.short_no, body.store_no, body.source, acceptance, scheduled, user.email,
         result["order_id"]))
    # Keep the Hiryu items on the order lines, for the sell-out value later (§5.3).
    for l in body.lines:
        m = mapped[l.item_id]
        await db.execute(
            "UPDATE order_lines SET hiryu_item_id = COALESCE(hiryu_item_id, %s), "
            "item_qty = COALESCE(item_qty, %s) WHERE order_id = %s AND sku_id = %s",
            (l.item_id, l.qty, result["order_id"], m["sku_id"]))
    await _audit(user.email, "order", result["order_id"], "paste",
                              {"short_no": body.short_no, "source": body.source})
    return {"action": "created", "order_id": result["order_id"],
            "pick_task_id": result["pick_task_id"], "short_no": body.short_no,
            "message": result["message"]}


# --------------------------------------------------------------------------
# The taps after the pick: Mark ready, handover, cancel (§10.3 to §10.6)
# --------------------------------------------------------------------------

async def _order_for(order_id: int, user: auth.User) -> dict:
    order = await db.fetch_one(
        "SELECT o.*, pt.id AS task_id, pt.status AS task_status FROM orders o "
        "LEFT JOIN pick_tasks pt ON pt.order_id = o.id WHERE o.id = %s", (order_id,))
    if not order:
        raise HTTPException(404, "Pesanan tidak ditemukan. / Order not found.")
    await auth.assert_site_access(user, order["site_id"])
    return order


@router.post("/orders/{order_id}/marked-ready", response_model=models.HandoverOrder)
async def marked_ready(order_id: int, user: auth.User = Depends(auth.current_user)):
    """Staff pressed Mark ready in Hiryu first; this records it and closes the pick."""
    order = await _order_for(order_id, user)
    if order["status"] == "cancelled":
        raise HTTPException(409, "Pesanan ini dibatalkan. / This order was cancelled.")
    if order["task_id"] and order["task_status"] != "completed":
        await outbound.complete_task(order["task_id"], user)
    await db.execute(
        "UPDATE orders SET marked_ready_by = COALESCE(marked_ready_by, %s), "
        "marked_ready_at = COALESCE(marked_ready_at, UTC_TIMESTAMP()) WHERE id = %s",
        (user.email, order_id))
    return await _handover_row(order_id)


@router.post("/orders/{order_id}/handed-over", response_model=models.HandoverOrder)
async def handed_over(order_id: int, user: auth.User = Depends(auth.current_user)):
    """The Grab driver took the bag: staff matched the GM number with the slip."""
    order = await _order_for(order_id, user)
    if order["status"] == "cancelled":
        raise HTTPException(409, "Pesanan ini dibatalkan: jangan diserahkan. / Cancelled: do not hand over.")
    if not order["marked_ready_at"]:
        raise HTTPException(409, "Tekan Mark ready di Hiryu dulu, lalu Sudah Mark ready di Hiryu. / "
                                 "Mark ready in Hiryu first.")
    await db.execute(
        "UPDATE orders SET handed_over_by = COALESCE(handed_over_by, %s), "
        "handed_over_at = COALESCE(handed_over_at, UTC_TIMESTAMP()) WHERE id = %s",
        (user.email, order_id))
    return await _handover_row(order_id)


@router.post("/orders/{order_id}/cancelled-in-hiryu", response_model=models.Ok)
async def cancelled_in_hiryu(order_id: int, user: auth.User = Depends(auth.current_user)):
    """Hiryu shows CANCELLED (or the SPV cancelled it there for a missing item).
    Release the hold; picked units go to return-to-shelf."""
    order = await _order_for(order_id, user)
    if order["status"] == "cancelled":
        return {"ok": True, "message": "Sudah dibatalkan. / Already cancelled."}
    out = await outbound.cancel_order(order["external_ref"], site_id=order["site_id"])
    await db.execute(
        "UPDATE orders SET cancelled_by=%s, cancelled_at=UTC_TIMESTAMP() WHERE id=%s",
        (user.email, order_id))
    await _audit(user.email, "order", order_id, "cancelled_in_hiryu", {})
    return out


@router.post("/orders/{order_id}/reopen", response_model=models.Ok)
async def reopen(order_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """A cancel pressed by mistake. The cancelled order keeps its history but frees
    its Grab order ID, so the order can be pasted from Hiryu again."""
    order = await _order_for(order_id, user)
    if order["status"] != "cancelled":
        raise HTTPException(409, "Pesanan ini tidak dibatalkan. / This order is not cancelled.")
    await db.execute("UPDATE orders SET external_ref = CONCAT(external_ref, '#void', id) "
                     "WHERE id = %s AND external_ref NOT LIKE '%%#void%%'", (order_id,))
    await _audit(user.email, "order", order_id, "reopen", {})
    return {"ok": True, "message": "Tempel ulang pesanan dari Hiryu. Barang yang sudah diambil tetap di "
                                   "daftar Kembalikan ke rak. / Paste the order from Hiryu again."}


async def _handover_row(order_id: int) -> dict:
    o = await db.fetch_one(
        "SELECT o.id, o.external_ref, o.hiryu_short_no, o.status, o.site_id, o.promised_at, "
        "       o.marked_ready_at, o.handed_over_at, o.created_at, hs.store_name, "
        "       pt.status AS task_status, "
        "       (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE order_id=o.id) AS units, "
        "       (SELECT COALESCE(SUM(qty_ordered),0) FROM order_lines WHERE order_id=o.id) AS units_ordered "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id "
        "LEFT JOIN hiryu_stores hs ON hs.hiryu_store_no = o.hiryu_store_no "
        "WHERE o.id = %s", (order_id,))
    return _handover_dict(o)


def _handover_dict(o: dict) -> dict:
    wait = None
    if o.get("marked_ready_at") and not o.get("handed_over_at"):
        wait = int((_now() - o["marked_ready_at"]).total_seconds())
    return {
        "order_id": o["id"], "grab_order_id": o["external_ref"],
        "short_no": o.get("hiryu_short_no") or o["external_ref"],
        "store_name": o.get("store_name"), "status": o["status"],
        "task_status": o.get("task_status"), "units": int(o.get("units") or 0),
        "units_ordered": int(o.get("units_ordered") or 0),
        "promised_at": str(o["promised_at"]) if o.get("promised_at") else None,
        "marked_ready_at": str(o["marked_ready_at"]) if o.get("marked_ready_at") else None,
        "handed_over_at": str(o["handed_over_at"]) if o.get("handed_over_at") else None,
        "waiting_seconds": wait,
    }


@router.get("/active-orders", response_model=models.HandoverList)
async def active_orders(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Everything at this hub that is not finished: being picked, packed and
    waiting for a driver. Cancelled and handed-over orders drop off."""
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT o.id, o.external_ref, o.hiryu_short_no, o.status, o.site_id, o.promised_at, "
        "       o.marked_ready_at, o.handed_over_at, o.created_at, hs.store_name, "
        "       pt.status AS task_status, "
        "       (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE order_id=o.id) AS units, "
        "       (SELECT COALESCE(SUM(qty_ordered),0) FROM order_lines WHERE order_id=o.id) AS units_ordered "
        "FROM orders o LEFT JOIN pick_tasks pt ON pt.order_id = o.id "
        "LEFT JOIN hiryu_stores hs ON hs.hiryu_store_no = o.hiryu_store_no "
        "WHERE o.site_id = %s AND o.status <> 'cancelled' AND o.handed_over_at IS NULL "
        "  AND o.created_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY "
        "ORDER BY o.marked_ready_at IS NULL, o.marked_ready_at, o.created_at", (site_id,))
    return {"orders": [_handover_dict(r) for r in rows],
            "wait_limit_seconds": 60 * await rule("handover_wait_minutes", 20)}


# --------------------------------------------------------------------------
# A missing item: look elsewhere first (§10.2)
# --------------------------------------------------------------------------

@router.get("/pick-lines/{line_id}/elsewhere", response_model=models.ElsewhereList)
async def elsewhere(line_id: int, user: auth.User = Depends(auth.current_user)):
    """Other places at this hub where the SKU is recorded, free to take."""
    line = await db.fetch_one(
        "SELECT pl.*, pt.site_id FROM pick_lines pl "
        "JOIN pick_tasks pt ON pt.id = pl.pick_task_id WHERE pl.id = %s", (line_id,))
    if not line:
        raise HTTPException(404, "Pick line not found")
    await auth.assert_site_access(user, line["site_id"])
    rows = await db.fetch_all(
        "SELECT ib.location_id, l.code AS location_code, "
        "       ib.qty_on_hand - ib.qty_allocated AS free "
        "FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "WHERE ib.site_id = %s AND ib.sku_id = %s AND l.is_virtual = 0 "
        "  AND ib.location_id <> %s AND ib.qty_on_hand - ib.qty_allocated > 0 "
        "ORDER BY free DESC", (line["site_id"], line["sku_id"], line["location_id"] or 0))
    return {"places": [{"location_id": r["location_id"], "location_code": r["location_code"],
                        "free": int(r["free"])} for r in rows]}


@router.post("/pick-lines/{line_id}/move", response_model=models.Ok)
async def move_line(line_id: int, body: models.MoveLineIn,
                    user: auth.User = Depends(auth.current_user)):
    """Ketemu, lanjut ambil: send the rest of this line to where the stock is."""
    line = await db.fetch_one(
        "SELECT pl.*, pt.site_id, pt.status AS task_status FROM pick_lines pl "
        "JOIN pick_tasks pt ON pt.id = pl.pick_task_id WHERE pl.id = %s", (line_id,))
    if not line:
        raise HTTPException(404, "Pick line not found")
    await auth.assert_site_access(user, line["site_id"])
    if line["status"] != "pending" or line["task_status"] in ("completed", "cancelled"):
        raise HTTPException(409, "Baris ini sudah ditutup. / This line is closed.")
    need = line["qty_required"] - line["qty_picked"]
    async with db.tx() as cur:
        held = outbound._outstanding_allocation(line)
        if held and line["location_id"]:
            await ledger.release(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                                 location_id=line["location_id"], qty=held)
        take = await ledger.allocate(cur, site_id=line["site_id"], sku_id=line["sku_id"],
                                     location_id=body.location_id, qty=need)
        if take < need:
            raise HTTPException(409, "Di sana juga tidak cukup. / Not enough there either.")
        # The line restarts at its new place: what was picked stays counted.
        await db.run(cur, "UPDATE pick_lines SET location_id=%s, qty_allocated=%s WHERE id=%s",
                     (body.location_id, line["qty_picked"] + take, line_id))
    return {"ok": True, "message": "Ambil dari tempat baru. / Pick from the new place."}


# --------------------------------------------------------------------------
# Maps kept by Ops HQ (§13.3)
# --------------------------------------------------------------------------

def _pick(row: dict, *names) -> str | None:
    for key, val in row.items():
        k = (key or "").strip().lower()
        if k in names:
            v = (val or "").strip()
            return v or None
    return None


@router.post("/menu-import", response_model=models.MenuImportResult)
async def menu_import(brand_id: int = Query(...), file: UploadFile = File(...),
                      user: auth.User = Depends(auth.require("hq"))):
    """Hiryu's menu CSV (Menus -> the menu -> Export CSV). Upload it again every
    time the menu changes in Hiryu."""
    brand = await db.fetch_one("SELECT id FROM brands WHERE id = %s", (brand_id,))
    if not brand:
        raise HTTPException(404, "Brand not found")
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames or "item_id" not in [f.strip().lower() for f in reader.fieldnames]:
        raise HTTPException(422, "Ini bukan CSV menu Hiryu (kolom item_id tidak ada). / "
                                 "Not a Hiryu menu CSV: no item_id column.")
    today = _now().date()
    seen, auto, priced = [], 0, 0
    for row in reader:
        item_id = _pick(row, "item_id")
        if not item_id:
            continue
        seen.append(item_id)
        name = _pick(row, "item_name")
        barcode = _pick(row, "barcode")
        status = _pick(row, "available_status")
        await db.execute(
            "INSERT INTO hiryu_items (hiryu_item_id, brand_id, item_name, barcode, "
            "available_status, active, imported_at) VALUES (%s,%s,%s,%s,%s,1,UTC_TIMESTAMP()) "
            "ON DUPLICATE KEY UPDATE brand_id=VALUES(brand_id), item_name=VALUES(item_name), "
            "barcode=VALUES(barcode), available_status=VALUES(available_status), active=1, "
            "imported_at=VALUES(imported_at)",
            (item_id, brand_id, name, barcode, status))
        # A single item whose barcode matches a WMS barcode connects by itself.
        if barcode:
            hit = await db.fetch_one(
                "SELECT b.sku_id FROM barcodes b JOIN skus s ON s.id = b.sku_id "
                "WHERE b.barcode = %s AND s.brand_id = %s", (barcode, brand_id))
            if hit:
                n = await db.execute(
                    "UPDATE hiryu_items SET sku_id=%s, units_per_sale=1, mapped_by='barcode', "
                    "mapped_at=UTC_TIMESTAMP() WHERE hiryu_item_id=%s AND sku_id IS NULL",
                    (hit["sku_id"], item_id))
                auto += 1 if n else 0
        price = _pick(row, "price")
        if price:
            digits = re.sub(r"[^0-9]", "", price.split(".")[0])
            if digits:
                await db.execute(
                    "INSERT INTO hiryu_item_prices (hiryu_item_id, price_idr, effective_date) "
                    "VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE price_idr=VALUES(price_idr)",
                    (item_id, int(digits), today))
                priced += 1
    if not seen:
        raise HTTPException(422, "CSV kosong. / The CSV has no items.")
    # Items no longer on this brand's menu turn inactive.
    await db.execute(
        f"UPDATE hiryu_items SET active = 0 WHERE brand_id = %s "
        f"AND hiryu_item_id NOT IN ({db.placeholders(seen)})", [brand_id, *seen])
    unmapped = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM hiryu_items WHERE brand_id=%s AND active=1 AND sku_id IS NULL",
        (brand_id,))
    return {"items": len(seen), "auto_connected": auto, "priced": priced,
            "needs_connecting": int(unmapped["n"])}


@router.get("/items", response_model=models.HiryuItemList)
async def list_items(brand_id: int | None = None, unmapped: bool = False,
                     user: auth.User = Depends(auth.require("hq"))):
    where, params = ["hi.active = 1"], []
    if brand_id:
        where.append("hi.brand_id = %s"); params.append(brand_id)
    if unmapped:
        where.append("hi.sku_id IS NULL")
    rows = await db.fetch_all(
        "SELECT hi.*, s.brand_sku_code, s.name_display, s.hiryu_sku_code "
        "FROM hiryu_items hi LEFT JOIN skus s ON s.id = hi.sku_id "
        f"WHERE {' AND '.join(where)} ORDER BY hi.sku_id IS NOT NULL, hi.seen_in_order DESC, "
        "hi.item_name LIMIT 1000", params)
    return {"items": [{
        "id": r["id"], "hiryu_item_id": r["hiryu_item_id"], "brand_id": r["brand_id"],
        "item_name": r["item_name"], "barcode": r["barcode"],
        "available_status": r["available_status"], "sku_id": r["sku_id"],
        "units_per_sale": r["units_per_sale"], "seen_in_order": bool(r["seen_in_order"]),
        "sku_code": r["brand_sku_code"], "sku_name": r["name_display"],
        "hiryu_sku_code": r["hiryu_sku_code"], "mapped_by": r["mapped_by"],
    } for r in rows]}


@router.patch("/items/{item_pk}", response_model=models.Ok)
async def map_item(item_pk: int, body: models.HiryuItemMapIn,
                   user: auth.User = Depends(auth.require("hq"))):
    if body.units_per_sale < 1:
        raise HTTPException(422, "Unit per jual minimal 1. / Units per sale must be at least 1.")
    if body.sku_id is not None:
        sku = await db.fetch_one("SELECT id FROM skus WHERE id = %s", (body.sku_id,))
        if not sku:
            raise HTTPException(404, "SKU not found")
    n = await db.execute(
        "UPDATE hiryu_items SET sku_id=%s, units_per_sale=%s, mapped_by=%s, "
        "mapped_at=UTC_TIMESTAMP() WHERE id=%s",
        (body.sku_id, body.units_per_sale, user.email, item_pk))
    if not n:
        raise HTTPException(404, "Item not found")
    return {"ok": True, "message": "Terhubung. / Connected."}


@router.get("/stores", response_model=models.HiryuStoreList)
async def list_stores(user: auth.User = Depends(auth.current_user)):
    rows = await db.fetch_all(
        "SELECT hs.*, s.code AS site_code, b.name AS brand_name FROM hiryu_stores hs "
        "JOIN sites s ON s.id = hs.site_id JOIN brands b ON b.id = hs.brand_id "
        "ORDER BY s.code, b.name")
    return {"stores": [{
        "hiryu_store_no": r["hiryu_store_no"], "store_name": r["store_name"],
        "partner_store_id": r["partner_store_id"], "site_id": r["site_id"],
        "site_code": r["site_code"], "brand_id": r["brand_id"],
        "brand_name": r["brand_name"], "active": bool(r["active"]),
    } for r in rows]}


@router.put("/stores/{store_no}", response_model=models.Ok)
async def put_store(store_no: int, body: models.HiryuStoreIn,
                    user: auth.User = Depends(auth.require("hq"))):
    site = await db.fetch_one("SELECT id FROM sites WHERE id=%s", (body.site_id,))
    brand = await db.fetch_one("SELECT id FROM brands WHERE id=%s", (body.brand_id,))
    if not site or not brand:
        raise HTTPException(404, "Hub atau merek tidak ditemukan. / Hub or brand not found.")
    await db.execute(
        "INSERT INTO hiryu_stores (hiryu_store_no, store_name, partner_store_id, site_id, "
        "brand_id, active, updated_by) VALUES (%s,%s,%s,%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE store_name=VALUES(store_name), "
        "partner_store_id=VALUES(partner_store_id), site_id=VALUES(site_id), "
        "brand_id=VALUES(brand_id), active=VALUES(active), updated_by=VALUES(updated_by)",
        (store_no, body.store_name, body.partner_store_id, body.site_id, body.brand_id,
         1 if body.active else 0, user.email))
    return {"ok": True, "message": "Tersimpan. / Saved."}


# --------------------------------------------------------------------------
# Stock sheet: what the SPV types into Hiryu (§13.4)
# --------------------------------------------------------------------------

@router.get("/stock-sheet", response_model=models.StockSheet)
async def stock_sheet(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Ketik di Hiryu = units on the shelf + units already picked for orders not
    yet marked ready - Grab buffer, never below 0 (§13.4.2)."""
    await auth.assert_site_access(user, site_id)
    default_buffer = await rule("grab_buffer_default", 1)
    stores = await db.fetch_all(
        "SELECT hs.hiryu_store_no, hs.store_name, hs.brand_id, b.name AS brand_name "
        "FROM hiryu_stores hs JOIN brands b ON b.id = hs.brand_id "
        "WHERE hs.site_id = %s AND hs.active = 1 ORDER BY b.name", (site_id,))
    out = []
    for st in stores:
        rows = await db.fetch_all(
            "SELECT s.id AS sku_id, s.brand_sku_code, s.hiryu_sku_code, s.name_display, "
            "       s.grab_buffer, "
            "       (SELECT COALESCE(SUM(ib.qty_on_hand),0) FROM inventory_balances ib "
            "          JOIN locations l ON l.id = ib.location_id "
            "         WHERE ib.site_id = %s AND ib.sku_id = s.id AND l.is_virtual = 0) AS on_shelf, "
            "       (SELECT COALESCE(SUM(pl.qty_picked),0) FROM pick_lines pl "
            "          JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
            "          JOIN orders o ON o.id = pt.order_id "
            "         WHERE pt.site_id = %s AND pl.sku_id = s.id "
            "           AND o.status <> 'cancelled' AND o.marked_ready_at IS NULL "
            # Orders from before the bridge never get a Mark ready; only recent ones count.
            "           AND o.created_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY) AS picked_not_ready, "
            "       (SELECT hss.qty FROM hiryu_stock_sent hss WHERE hss.site_id = %s "
            "          AND hss.sku_id = s.id ORDER BY hss.sent_at DESC, hss.id DESC LIMIT 1) AS last_typed, "
            "       (SELECT hss.sent_at FROM hiryu_stock_sent hss WHERE hss.site_id = %s "
            "          AND hss.sku_id = s.id ORDER BY hss.sent_at DESC, hss.id DESC LIMIT 1) AS last_typed_at "
            "FROM skus s WHERE s.brand_id = %s AND s.active = 1 "
            "  AND EXISTS (SELECT 1 FROM slot_assignments sa WHERE sa.site_id = %s AND sa.sku_id = s.id) "
            "ORDER BY UPPER(COALESCE(s.hiryu_sku_code, s.brand_sku_code))",
            (site_id, site_id, site_id, site_id, st["brand_id"], site_id))
        lines = []
        for r in rows:
            buffer = default_buffer if r["grab_buffer"] is None else int(r["grab_buffer"])
            base = int(r["on_shelf"]) + int(r["picked_not_ready"])
            to_type = max(0, base - buffer)
            last = r["last_typed"]
            lines.append({
                "sku_id": r["sku_id"],
                "hiryu_sku_code": (r["hiryu_sku_code"] or r["brand_sku_code"]).upper(),
                "name": r["name_display"], "on_shelf": int(r["on_shelf"]),
                "picked_not_ready": int(r["picked_not_ready"]), "buffer": buffer,
                "to_type": to_type, "last_typed": None if last is None else int(last),
                "last_typed_at": str(r["last_typed_at"]) if r["last_typed_at"] else None,
                "changed": last is None or int(last) != to_type,
            })
        out.append({"hiryu_store_no": st["hiryu_store_no"], "store_name": st["store_name"],
                    "brand_name": st["brand_name"], "lines": lines})
    return {"site_id": site_id, "stores": out}


@router.post("/stock-sheet/typed", response_model=models.Ok)
async def stock_typed(body: models.StockTypedIn,
                      user: auth.User = Depends(auth.require("supervisor"))):
    """Sudah disimpan di Hiryu: the SPV saved these numbers in Hiryu first."""
    await auth.assert_site_access(user, body.site_id)
    if not body.rows:
        raise HTTPException(422, "Tidak ada baris. / No rows.")
    async with db.tx() as cur:
        for r in body.rows:
            await db.run(cur, "INSERT INTO hiryu_stock_sent (site_id, sku_id, qty, sent_by) "
                              "VALUES (%s,%s,%s,%s)", (body.site_id, r.sku_id, r.qty, user.email))
    return {"ok": True, "message": f"{len(body.rows)} baris dicatat. / {len(body.rows)} rows recorded."}
