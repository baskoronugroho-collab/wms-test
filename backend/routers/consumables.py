"""Consumables: Ninja's own packing stock per hub (canvas Section 9).

Paper bags, cartons, tape, bin labels, dividers and day stickers. Not a brand's
stock and never in a brand report.

* **Usage per order**, set by Ops HQ per item: per order packed in a bag, per
  order packed in a carton, per order packed, or per delivery received. The
  WMS deducts it by itself: agent O calls ``deduct_for_order`` at Selesai
  dikemas (an order packed as two packs takes a bag and a carton), agent I
  calls ``deduct_for_delivery`` when a delivery is received. Each order or
  delivery books once.
* **Minimum** = N days of use (14) at Grab's target (200 orders per hub per
  month). The figure on each item is a proposal Ops HQ can change.
* **Need → PR → receipt**: the SPV raises a need (Ajukan ke Ops HQ); Ops HQ
  submits the PR outside the WMS and records its number; the SPV enters what
  arrived (packs x pieces per pack); Ops HQ approves, and only then the stock
  goes up.
* **Weekly count** by the SPV; when Ops HQ approves, the counted numbers
  replace the computed ones and the difference is kept per item.
"""
import math
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import auth
import db
import ledger
from routers.opname import MONTHS_ID, WIB, hub_short, iso, names_for, rule_values, wib_today

router = APIRouter(prefix="/api/consumables", tags=["consumables"])

BASIS = {
    "bag": ("per pesanan kantong", "per order packed in a bag"),
    "carton": ("per pesanan kardus", "per order packed in a carton"),
    "order": ("per pesanan dikemas", "per order packed"),
    "delivery": ("per kiriman diterima", "per delivery received"),
    "none": ("tidak otomatis", "not automatic"),
}
# Shares of orders by pack, used only to propose a minimum before the hub has
# history of its own (board 9, "Open for review": about 85% bag, 15% carton).
DEFAULT_SHARE = {"bag": 0.85, "carton": 0.15, "order": 1.0}
DELIVERIES_PER_WEEK = 2


def _num(v) -> float:
    return float(v or 0)


def _fmt(v) -> str:
    """0,6 and 240, as on the boards."""
    f = _num(v)
    return (f"{f:.1f}".replace(".", ",") if f != int(f) else str(int(f)))


# --- the helpers other agents call -------------------------------------------------

async def _book(cur, *, item: dict, qty: float, kind: str, ref_type: str, ref_id: int,
                actor_email: str | None) -> bool:
    """One movement, once per (item, kind, ref). Returns False when it was booked before."""
    if qty == 0:
        return False
    if await db.one(cur, "SELECT id FROM consumable_movements WHERE consumable_id = %s AND kind = %s "
                         "AND ref_type = %s AND ref_id = %s", (item["id"], kind, ref_type, ref_id)):
        return False
    # The unique key still guards a race; ON DUPLICATE keeps the caller's
    # transaction (packing an order) from failing on it.
    await cur.execute(
        "INSERT INTO consumable_movements (consumable_id, site_id, qty_delta, kind, ref_type, ref_id, "
        "actor_email) VALUES (%s,%s,%s,%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE consumable_movements.id = consumable_movements.id",
        (item["id"], item["site_id"], Decimal(str(qty)), kind, ref_type, ref_id, actor_email))
    if cur.rowcount != 1:
        return False
    await db.run(cur, "UPDATE consumables SET stock_qty = stock_qty + %s WHERE id = %s",
                 (Decimal(str(qty)), item["id"]))
    return True


async def deduct_for_order(cur, *, site_id: int, order_id: int, pack: str | None = None,
                           bags: int | None = None, cartons: int | None = None,
                           actor_email: str | None = None) -> int:
    """Agent O, at Selesai dikemas, inside its own transaction.

    pack: 'bag' | 'carton' | 'two' (order_packs.chosen; 'two' = a bag and a
    carton), or give bags / cartons directly. Returns the items booked; calling
    again for the same order books nothing."""
    if bags is None and cartons is None:
        bags = 1 if pack in ("bag", "two", None) else 0
        cartons = 1 if pack in ("carton", "two") else 0
    bags, cartons = int(bags or 0), int(cartons or 0)
    n = 0
    for item in await db.many(cur, "SELECT id, site_id, usage_basis, usage_qty FROM consumables "
                                   "WHERE site_id = %s AND active = 1", (site_id,)):
        per = _num(item["usage_qty"])
        qty = {"bag": bags * per, "carton": cartons * per, "order": per}.get(item["usage_basis"], 0)
        if qty and await _book(cur, item=item, qty=-qty, kind="order", ref_type="order",
                               ref_id=order_id, actor_email=actor_email):
            n += 1
    return n


async def deduct_for_delivery(cur, *, site_id: int, ref_id: int, ref_type: str = "replenishment",
                              actor_email: str | None = None) -> int:
    """Agent I, when a brand delivery is received (one per delivery: pass the
    replenishment id, or ref_type='receipt' and the receipt id for a delivery
    with no request). Dividers and day stickers come off here."""
    n = 0
    for item in await db.many(cur, "SELECT id, site_id, usage_basis, usage_qty FROM consumables "
                                   "WHERE site_id = %s AND active = 1 AND usage_basis = 'delivery'",
                              (site_id,)):
        if await _book(cur, item=item, qty=-_num(item["usage_qty"]), kind="delivery", ref_type=ref_type,
                       ref_id=ref_id, actor_email=actor_email):
            n += 1
    return n


# --- shapes ----------------------------------------------------------------------------

class ItemIn(BaseModel):
    site_id: int | None = None
    all_hubs: bool = Field(default=False, description="Add the item at every live hub")
    name: str = Field(..., min_length=1, max_length=160)
    unit: str = Field(default="pcs", max_length=16)
    pack_size: float | None = Field(default=None, ge=0)
    usage_basis: str = Field(default="order", pattern="^(bag|carton|order|delivery|none)$")
    usage_qty: float = Field(default=1, ge=0)
    min_qty: float | None = Field(default=None, ge=0)


class ItemEdit(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    unit: str | None = Field(default=None, max_length=16)
    pack_size: float | None = Field(default=None, ge=0)
    usage_basis: str | None = Field(default=None, pattern="^(bag|carton|order|delivery|none)$")
    usage_qty: float | None = Field(default=None, ge=0)
    min_qty: float | None = Field(default=None, ge=0)
    active: bool | None = None


class SettingsIn(BaseModel):
    orders_per_month: int = Field(..., ge=1, le=100000)
    min_days: int = Field(..., ge=1, le=365)


class RequestIn(BaseModel):
    note: str | None = None


class PrIn(BaseModel):
    pr_number: str = Field(..., min_length=1, max_length=64)
    qty: float | None = Field(default=None, ge=0)


class ReceiptIn(BaseModel):
    packs: float = Field(..., gt=0)
    per_pack: float = Field(..., gt=0)
    request_id: int | None = None


class CountLineIn(BaseModel):
    consumable_id: int
    qty: float = Field(..., ge=0)


class CountIn(BaseModel):
    site_id: int
    lines: list[CountLineIn]


class NoteIn(BaseModel):
    note: str | None = None


# --- reading ----------------------------------------------------------------------------

async def _settings() -> dict:
    r = await rule_values()
    return {"orders_per_month": r.get("consumable_orders_month", 200),
            "min_days": r.get("consumable_min_days", 14),
            "count_days": r.get("consumable_count_days", 7)}


def _short_when(dt) -> str | None:
    if not dt:
        return None
    w = dt + WIB
    return f"{w.day} {MONTHS_ID[w.month - 1]} {w:%H:%M}"


async def _shares(site_id: int) -> dict:
    """Bag and carton shares from the hub's own packs of the last 30 days."""
    try:
        row = await db.fetch_one(
            "SELECT SUM(chosen IN ('bag','two')) AS bag, SUM(chosen IN ('carton','two')) AS carton, "
            "COUNT(*) AS n FROM order_packs WHERE site_id = %s AND packed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY",
            (site_id,))
    except Exception:  # order_packs arrives with V28
        row = None
    if row and row["n"] and int(row["n"]) >= 20:
        n = int(row["n"])
        return {"bag": int(row["bag"] or 0) / n, "carton": int(row["carton"] or 0) / n, "order": 1.0}
    return dict(DEFAULT_SHARE)


@router.get("")
async def list_items(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Bahan kemas (9a): per item the usage per order, stock, use per day, days
    left, the minimum, and where its need, PR and receipt stand."""
    site = await auth.assert_site_access(user, site_id)
    cfg = await _settings()
    items = await db.fetch_all("SELECT * FROM consumables WHERE site_id = %s AND active = 1 "
                               "ORDER BY sort_order, name", (site_id,))
    use7 = {r["consumable_id"]: -_num(r["q"]) for r in await db.fetch_all(
        "SELECT consumable_id, SUM(qty_delta) AS q FROM consumable_movements WHERE site_id = %s "
        "AND kind IN ('order','delivery') AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY "
        "GROUP BY consumable_id", (site_id,))}
    days7 = {}
    for r in await db.fetch_all(
            "SELECT consumable_id, DATE(created_at + INTERVAL 7 HOUR) AS d, SUM(qty_delta) AS q "
            "FROM consumable_movements WHERE site_id = %s AND kind IN ('order','delivery') "
            "AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY "
            "GROUP BY consumable_id, DATE(created_at + INTERVAL 7 HOUR)", (site_id,)):
        days7.setdefault(r["consumable_id"], {})[str(r["d"])] = -_num(r["q"])
    today = wib_today()
    day_keys = [str(today - timedelta(days=i)) for i in range(6, -1, -1)]
    packed = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM orders WHERE site_id = %s AND marked_ready_at >= UTC_TIMESTAMP() - "
        "INTERVAL 7 DAY", (site_id,))
    reqs = {}
    for r in await db.fetch_all("SELECT * FROM consumable_requests WHERE site_id = %s AND status IN "
                                "('raised','pr_submitted') ORDER BY raised_at", (site_id,)):
        reqs.setdefault(r["consumable_id"], r)
    rcpts: dict = {}
    for r in await db.fetch_all("SELECT * FROM consumable_receipts WHERE site_id = %s AND status IN "
                                "('pending','returned') ORDER BY entered_at", (site_id,)):
        rcpts.setdefault(r["consumable_id"], []).append(r)
    last_pp = {r["consumable_id"]: r["per_pack"] for r in await db.fetch_all(
        "SELECT r.consumable_id, r.per_pack FROM consumable_receipts r JOIN ("
        "  SELECT consumable_id, MAX(id) AS id FROM consumable_receipts WHERE site_id = %s "
        "  AND status = 'approved' GROUP BY consumable_id) x ON x.id = r.id", (site_id,))}
    names = await names_for([r["raised_by"] for r in reqs.values()] + [r["pr_by"] for r in reqs.values()] +
                            [x["entered_by"] for lst in rcpts.values() for x in lst])
    shares = await _shares(site_id)
    per_day_target = cfg["orders_per_month"] / 30.0
    out = []
    for it in items:
        basis = it["usage_basis"]
        per = _num(it["usage_qty"])
        if basis == "delivery":
            target_day = per * DELIVERIES_PER_WEEK / 7.0
        else:
            target_day = per * per_day_target * shares.get(basis, 0)
        actual_day = use7.get(it["id"], 0) / 7.0
        day_use = actual_day if actual_day > 0 else target_day
        stock = _num(it["stock_qty"])
        mn = _num(it["min_qty"]) if it["min_qty"] is not None else None
        suggested = math.ceil(target_day * cfg["min_days"]) if target_day else 0
        req = reqs.get(it["id"])
        state = None
        if req and req["status"] == "raised":
            state = {"kind": "raised", "id": req["id"], "by": req["raised_by"],
                     "by_name": names.get(req["raised_by"]), "at": iso(req["raised_at"]),
                     "label_id": f"Diajukan ke Ops HQ · {names.get(req['raised_by'], req['raised_by'])} · "
                                 f"{_short_when(req['raised_at'])}"}
        elif req:
            state = {"kind": "pr_submitted", "id": req["id"], "pr_number": req["pr_number"],
                     "pr_qty": _num(req["pr_qty"]) if req["pr_qty"] is not None else None,
                     "by": req["pr_by"], "at": iso(req["pr_at"]),
                     "label_id": f"PR diajukan · {req['pr_number']} · {_short_when(req['pr_at'])}"}
        out.append({
            "id": it["id"], "name": it["name"], "unit": it["unit"],
            "pack_size": _num(it["pack_size"]) if it["pack_size"] is not None else None,
            "last_per_pack": _num(last_pp[it["id"]]) if it["id"] in last_pp else
            (_num(it["pack_size"]) if it["pack_size"] is not None else None),
            "usage_basis": basis, "usage_qty": per,
            "usage_label_id": f"{_fmt(per)} {it['unit']} {BASIS[basis][0]}",
            "usage_label_en": f"{_fmt(per)} {it['unit']} {BASIS[basis][1]}",
            "stock": stock, "per_day": round(day_use, 2), "per_day_actual": round(actual_day, 2),
            "per_day_target": round(target_day, 2), "used_7d": round(use7.get(it["id"], 0), 2),
            "use_by_day": [round(days7.get(it["id"], {}).get(k, 0), 2) for k in day_keys],
            "days_left": (int(stock / day_use) if day_use > 0 and stock > 0 else (0 if day_use > 0 else None)),
            "min_qty": mn, "min_suggested": suggested,
            "below_min": mn is not None and stock < mn,
            "request": state,
            "receipts": [{"id": x["id"], "status": x["status"], "packs": _num(x["packs"]),
                          "per_pack": _num(x["per_pack"]), "qty_total": _num(x["qty_total"]),
                          "entered_by": x["entered_by"], "entered_name": names.get(x["entered_by"]),
                          "entered_at": iso(x["entered_at"]), "hq_note": x["hq_note"]}
                         for x in rcpts.get(it["id"], [])],
        })
    last_count = await db.fetch_one(
        "SELECT id, status, counted_by, counted_at, decided_at FROM consumable_counts WHERE site_id = %s "
        "ORDER BY counted_at DESC LIMIT 1", (site_id,))
    return {
        "site_id": site_id, "site_code": hub_short(site["code"]),
        "packed_orders_7d": int(packed["n"] or 0), "settings": cfg, "shares": shares,
        "last_count": ({"id": last_count["id"], "status": last_count["status"],
                        "counted_by": last_count["counted_by"], "counted_at": iso(last_count["counted_at"]),
                        "decided_at": iso(last_count["decided_at"])} if last_count else None),
        "items": out,
    }


@router.get("/settings")
async def get_settings(user: auth.User = Depends(auth.current_user)):
    return await _settings()


@router.put("/settings")
async def set_settings(body: SettingsIn, user: auth.User = Depends(auth.require("hq"))):
    """Grab's target and the days of use behind every minimum."""
    for key, val in (("consumable_orders_month", body.orders_per_month),
                     ("consumable_min_days", body.min_days)):
        await db.execute(
            "INSERT INTO alert_rules (rule_key, enabled, value_num, updated_by) VALUES (%s,1,%s,%s) "
            "ON DUPLICATE KEY UPDATE value_num = VALUES(value_num), updated_by = VALUES(updated_by)",
            (key, val, user.email))
    return await _settings()


# --- Ops HQ: items ----------------------------------------------------------------------

@router.post("", status_code=201)
async def add_item(body: ItemIn, user: auth.User = Depends(auth.require("hq"))):
    """Tambah bahan kemas (Ops HQ only)."""
    if body.all_hubs:
        sites = [r["id"] for r in await db.fetch_all(
            "SELECT id FROM sites WHERE active = 1 AND is_training = 0 AND site_type <> 'hub'")]
    elif body.site_id:
        await auth.assert_site_access(user, body.site_id)
        sites = [body.site_id]
    else:
        raise HTTPException(422, "Pilih hub. / Choose a hub.")
    ids = []
    async with db.tx() as cur:
        for sid in sites:
            if await db.one(cur, "SELECT id FROM consumables WHERE site_id = %s AND name = %s",
                            (sid, body.name.strip())):
                continue
            order = await db.one(cur, "SELECT COALESCE(MAX(sort_order),0) + 1 AS n FROM consumables "
                                      "WHERE site_id = %s", (sid,))
            ids.append(await db.run(
                cur, "INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, "
                     "min_qty, sort_order, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (sid, body.name.strip(), body.unit, body.pack_size, body.usage_basis, body.usage_qty,
                 body.min_qty, order["n"], user.email)))
        await ledger.audit(cur, actor_email=user.email, entity="consumable", entity_id=ids[0] if ids else None,
                           action="create", after=body.model_dump())
    if not ids:
        raise HTTPException(409, "Bahan kemas ini sudah ada. / This item already exists.")
    return {"ok": True, "ids": ids}


@router.put("/{item_id}")
async def edit_item(item_id: int, body: ItemEdit, user: auth.User = Depends(auth.require("hq"))):
    """The pencil icon: minimum, usage per order, its basis, name, pack size.
    Used from the next packed order on."""
    old = await db.fetch_one("SELECT * FROM consumables WHERE id = %s", (item_id,))
    if not old:
        raise HTTPException(404, "Bahan kemas tidak ditemukan. / Item not found.")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not changes:
        return {"ok": True}
    if "active" in changes:
        changes["active"] = 1 if changes["active"] else 0
    cols = ", ".join(f"{k} = %s" for k in changes)
    async with db.tx() as cur:
        await db.run(cur, f"UPDATE consumables SET {cols}, updated_by = %s, updated_at = UTC_TIMESTAMP() "
                          "WHERE id = %s", list(changes.values()) + [user.email, item_id])
        await ledger.audit(cur, actor_email=user.email, entity="consumable", entity_id=item_id,
                           action="update", before={k: old[k] for k in changes}, after=changes)
    return {"ok": True}


# --- need → PR ----------------------------------------------------------------------------

@router.post("/{item_id}/request", status_code=201)
async def raise_need(item_id: int, body: RequestIn | None = None,
                     user: auth.User = Depends(auth.require("supervisor"))):
    """Ajukan ke Ops HQ. The SPV only raises the need; the SPV cannot buy."""
    it = await db.fetch_one("SELECT * FROM consumables WHERE id = %s", (item_id,))
    if not it:
        raise HTTPException(404, "Bahan kemas tidak ditemukan. / Item not found.")
    await auth.assert_site_access(user, it["site_id"])
    if await db.fetch_one("SELECT id FROM consumable_requests WHERE consumable_id = %s AND status IN "
                          "('raised','pr_submitted')", (item_id,)):
        raise HTTPException(409, "Sudah diajukan. / Already raised.")
    cfg = await _settings()
    shares = await _shares(it["site_id"])
    per = _num(it["usage_qty"])
    day = (per * DELIVERIES_PER_WEEK / 7.0 if it["usage_basis"] == "delivery"
           else per * cfg["orders_per_month"] / 30.0 * shares.get(it["usage_basis"], 0))
    # A proposal for Ops HQ: back to the minimum plus another N days of use.
    suggest = max(0.0, _num(it["min_qty"]) + day * cfg["min_days"] - _num(it["stock_qty"]))
    if it["pack_size"]:
        suggest = math.ceil(suggest / _num(it["pack_size"])) * _num(it["pack_size"])
    rid = await db.execute(
        "INSERT INTO consumable_requests (consumable_id, site_id, qty_suggested, note, raised_by) "
        "VALUES (%s,%s,%s,%s,%s)", (item_id, it["site_id"], Decimal(str(round(suggest, 3))),
                                    body.note if body else None, user.email))
    return {"ok": True, "id": rid, "qty_suggested": suggest}


@router.get("/requests/open")
async def open_requests(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    """Permintaan SPV: needs waiting for a PR, every hub for Ops HQ."""
    if site_id:
        await auth.assert_site_access(user, site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih hub. / Choose a hub.")
    rows = await db.fetch_all(
        "SELECT r.*, c.name, c.unit, st.code AS site_code FROM consumable_requests r "
        "JOIN consumables c ON c.id = r.consumable_id JOIN sites st ON st.id = r.site_id "
        "WHERE r.status IN ('raised','pr_submitted')" + (" AND r.site_id = %s" if site_id else "") +
        " ORDER BY r.raised_at", (site_id,) if site_id else ())
    names = await names_for([r["raised_by"] for r in rows] + [r["pr_by"] for r in rows])
    return {"requests": [{
        "id": r["id"], "consumable_id": r["consumable_id"], "name": r["name"], "unit": r["unit"],
        "site_id": r["site_id"], "site_code": hub_short(r["site_code"]), "status": r["status"],
        "qty_suggested": _num(r["qty_suggested"]) if r["qty_suggested"] is not None else None,
        "note": r["note"], "raised_by": r["raised_by"], "raised_name": names.get(r["raised_by"]),
        "raised_at": iso(r["raised_at"]), "pr_number": r["pr_number"],
        "pr_qty": _num(r["pr_qty"]) if r["pr_qty"] is not None else None,
        "pr_by": r["pr_by"], "pr_at": iso(r["pr_at"]),
    } for r in rows]}


@router.post("/requests/{request_id}/pr")
async def submit_pr(request_id: int, body: PrIn, user: auth.User = Depends(auth.require("hq"))):
    """Ajukan PR: Ops HQ records the PR it submitted outside the WMS."""
    r = await db.fetch_one("SELECT * FROM consumable_requests WHERE id = %s", (request_id,))
    if not r or r["status"] != "raised":
        raise HTTPException(409, "Permintaan ini tidak menunggu PR. / This need is not waiting for a PR.")
    await db.execute("UPDATE consumable_requests SET status = 'pr_submitted', pr_number = %s, pr_qty = %s, "
                     "pr_by = %s, pr_at = UTC_TIMESTAMP() WHERE id = %s",
                     (body.pr_number.strip(), body.qty if body.qty is not None else r["qty_suggested"],
                      user.email, request_id))
    return {"ok": True}


@router.post("/requests/{request_id}/cancel")
async def cancel_request(request_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    r = await db.fetch_one("SELECT * FROM consumable_requests WHERE id = %s", (request_id,))
    if not r or r["status"] not in ("raised", "pr_submitted"):
        raise HTTPException(409, "Sudah ditutup. / Already closed.")
    await auth.assert_site_access(user, r["site_id"])
    await db.execute("UPDATE consumable_requests SET status = 'cancelled', closed_at = UTC_TIMESTAMP() "
                     "WHERE id = %s", (request_id,))
    return {"ok": True}


# --- receipts (9b) -------------------------------------------------------------------------

@router.post("/{item_id}/receipts", status_code=201)
async def enter_receipt(item_id: int, body: ReceiptIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Terima: packs and pieces per pack. The stock does not change until Ops HQ
    approves."""
    it = await db.fetch_one("SELECT * FROM consumables WHERE id = %s", (item_id,))
    if not it:
        raise HTTPException(404, "Bahan kemas tidak ditemukan. / Item not found.")
    await auth.assert_site_access(user, it["site_id"])
    req_id = body.request_id
    if req_id is None:
        r = await db.fetch_one("SELECT id FROM consumable_requests WHERE consumable_id = %s AND status = "
                               "'pr_submitted' ORDER BY pr_at LIMIT 1", (item_id,))
        req_id = r["id"] if r else None
    total = Decimal(str(body.packs)) * Decimal(str(body.per_pack))
    rid = await db.execute(
        "INSERT INTO consumable_receipts (consumable_id, site_id, request_id, packs, per_pack, qty_total, "
        "entered_by) VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (item_id, it["site_id"], req_id, Decimal(str(body.packs)), Decimal(str(body.per_pack)), total,
         user.email))
    stock = _num(it["stock_qty"])
    return {"ok": True, "id": rid, "qty_total": float(total), "stock_now": stock,
            "stock_after": stock + float(total),
            "message": f"Total diterima {_fmt(total)} {it['unit']}. Menunggu persetujuan Ops HQ. / "
                       f"{_fmt(total)} {it['unit']} received. Waiting for Ops HQ."}


@router.get("/receipts/pending")
async def pending_receipts(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    if site_id:
        await auth.assert_site_access(user, site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih hub. / Choose a hub.")
    rows = await db.fetch_all(
        "SELECT x.*, c.name, c.unit, c.stock_qty, st.code AS site_code, r.pr_number, r.pr_qty "
        "FROM consumable_receipts x JOIN consumables c ON c.id = x.consumable_id "
        "JOIN sites st ON st.id = x.site_id LEFT JOIN consumable_requests r ON r.id = x.request_id "
        "WHERE x.status IN ('pending','returned')" + (" AND x.site_id = %s" if site_id else "") +
        " ORDER BY x.entered_at", (site_id,) if site_id else ())
    names = await names_for([r["entered_by"] for r in rows])
    return {"receipts": [{
        "id": r["id"], "consumable_id": r["consumable_id"], "name": r["name"], "unit": r["unit"],
        "site_id": r["site_id"], "site_code": hub_short(r["site_code"]), "status": r["status"],
        "packs": _num(r["packs"]), "per_pack": _num(r["per_pack"]), "qty_total": _num(r["qty_total"]),
        "stock_now": _num(r["stock_qty"]), "pr_number": r["pr_number"],
        "pr_qty": _num(r["pr_qty"]) if r["pr_qty"] is not None else None,
        "entered_by": r["entered_by"], "entered_name": names.get(r["entered_by"]),
        "entered_at": iso(r["entered_at"]), "hq_note": r["hq_note"],
    } for r in rows]}


@router.post("/receipts/{receipt_id}/approve")
async def approve_receipt(receipt_id: int, user: auth.User = Depends(auth.require("hq"))):
    """Ops HQ checks the amount against the PR: the stock goes up and the PR clears."""
    async with db.tx() as cur:
        r = await db.one(cur, "SELECT * FROM consumable_receipts WHERE id = %s FOR UPDATE", (receipt_id,))
        if not r or r["status"] != "pending":
            raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
        item = await db.one(cur, "SELECT id, site_id FROM consumables WHERE id = %s", (r["consumable_id"],))
        await _book(cur, item=item, qty=_num(r["qty_total"]), kind="receipt", ref_type="consumable_receipt",
                    ref_id=receipt_id, actor_email=user.email)
        await db.run(cur, "UPDATE consumable_receipts SET status = 'approved', decided_by = %s, "
                          "decided_at = UTC_TIMESTAMP() WHERE id = %s", (user.email, receipt_id))
        if r["request_id"]:
            await db.run(cur, "UPDATE consumable_requests SET status = 'closed', closed_at = UTC_TIMESTAMP() "
                              "WHERE id = %s AND status IN ('raised','pr_submitted')", (r["request_id"],))
    return {"ok": True}


@router.post("/receipts/{receipt_id}/return")
async def return_receipt(receipt_id: int, body: NoteIn, user: auth.User = Depends(auth.require("hq"))):
    """The amount is wrong: back to the SPV with a note. The SPV enters it again."""
    r = await db.fetch_one("SELECT status FROM consumable_receipts WHERE id = %s", (receipt_id,))
    if not r or r["status"] != "pending":
        raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
    await db.execute("UPDATE consumable_receipts SET status = 'returned', decided_by = %s, "
                     "decided_at = UTC_TIMESTAMP(), hq_note = %s WHERE id = %s",
                     (user.email, body.note, receipt_id))
    return {"ok": True}


@router.post("/receipts/{receipt_id}/withdraw")
async def withdraw_receipt(receipt_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """The SPV clears a receipt Ops HQ sent back, after entering it again."""
    r = await db.fetch_one("SELECT site_id, status FROM consumable_receipts WHERE id = %s", (receipt_id,))
    if not r or r["status"] not in ("pending", "returned"):
        raise HTTPException(409, "Sudah diputuskan. / Already decided.")
    await auth.assert_site_access(user, r["site_id"])
    await db.execute("UPDATE consumable_receipts SET status = 'withdrawn' WHERE id = %s", (receipt_id,))
    return {"ok": True}


# --- weekly count ------------------------------------------------------------------------

@router.post("/counts", status_code=201)
async def submit_count(body: CountIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Hitung mingguan: every item on the shelf, sent to Ops HQ."""
    await auth.assert_site_access(user, body.site_id)
    if not body.lines:
        raise HTTPException(422, "Isi jumlah setiap barang. / Enter every item's count.")
    async with db.tx() as cur:
        if await db.one(cur, "SELECT id FROM consumable_counts WHERE site_id = %s AND status = 'pending'",
                        (body.site_id,)):
            raise HTTPException(409, "Hitung mingguan sebelumnya masih menunggu Ops HQ. / The previous weekly "
                                     "count is still waiting for Ops HQ.")
        cid = await db.run(cur, "INSERT INTO consumable_counts (site_id, counted_by) VALUES (%s,%s)",
                           (body.site_id, user.email))
        for ln in body.lines:
            it = await db.one(cur, "SELECT stock_qty FROM consumables WHERE id = %s AND site_id = %s",
                              (ln.consumable_id, body.site_id))
            if not it:
                raise HTTPException(422, "Barang tidak dikenal di hub ini. / Unknown item at this hub.")
            await db.run(cur, "INSERT INTO consumable_count_lines (count_id, consumable_id, qty_counted, "
                              "qty_system) VALUES (%s,%s,%s,%s)",
                         (cid, ln.consumable_id, Decimal(str(ln.qty)), it["stock_qty"]))
    return {"ok": True, "id": cid}


async def _count_out(c: dict) -> dict:
    lines = await db.fetch_all(
        "SELECT l.*, c.name, c.unit, c.stock_qty FROM consumable_count_lines l "
        "JOIN consumables c ON c.id = l.consumable_id WHERE l.count_id = %s ORDER BY c.sort_order", (c["id"],))
    names = await names_for([c["counted_by"], c["decided_by"]])
    return {"id": c["id"], "site_id": c["site_id"], "site_code": hub_short(c.get("site_code")),
            "status": c["status"],
            "counted_by": c["counted_by"], "counted_name": names.get(c["counted_by"]),
            "counted_at": iso(c["counted_at"]), "decided_by": c["decided_by"],
            "decided_name": names.get(c["decided_by"]), "decided_at": iso(c["decided_at"]),
            "hq_note": c["hq_note"],
            "lines": [{"consumable_id": l["consumable_id"], "name": l["name"], "unit": l["unit"],
                       "qty_counted": _num(l["qty_counted"]), "qty_system": _num(l["qty_system"]),
                       "difference": _num(l["qty_counted"]) - _num(l["qty_system"]),
                       "stock_now": _num(l["stock_qty"])} for l in lines]}


@router.get("/counts")
async def list_counts(site_id: int | None = None, status: str = Query(default="all", pattern="^(pending|all)$"),
                      user: auth.User = Depends(auth.current_user)):
    if site_id:
        await auth.assert_site_access(user, site_id)
    elif not user.at_least("hq"):
        raise HTTPException(422, "Pilih hub. / Choose a hub.")
    where, params = [], []
    if site_id:
        where.append("k.site_id = %s")
        params.append(site_id)
    if status == "pending":
        where.append("k.status = 'pending'")
    rows = await db.fetch_all(
        "SELECT k.*, st.code AS site_code FROM consumable_counts k JOIN sites st ON st.id = k.site_id " +
        ("WHERE " + " AND ".join(where) if where else "") + " ORDER BY k.counted_at DESC LIMIT 20", params)
    return {"counts": [await _count_out(r) for r in rows]}


@router.post("/counts/{count_id}/approve")
async def approve_count(count_id: int, user: auth.User = Depends(auth.require("hq"))):
    """The counted numbers replace the computed ones. Use booked since the count
    still comes off, so each item moves by (counted - computed at the count)."""
    async with db.tx() as cur:
        c = await db.one(cur, "SELECT * FROM consumable_counts WHERE id = %s FOR UPDATE", (count_id,))
        if not c or c["status"] != "pending":
            raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
        for l in await db.many(cur, "SELECT * FROM consumable_count_lines WHERE count_id = %s", (count_id,)):
            item = await db.one(cur, "SELECT id, site_id FROM consumables WHERE id = %s", (l["consumable_id"],))
            await _book(cur, item=item, qty=_num(l["qty_counted"]) - _num(l["qty_system"]), kind="count",
                        ref_type="consumable_count", ref_id=count_id, actor_email=user.email)
        await db.run(cur, "UPDATE consumable_counts SET status = 'approved', decided_by = %s, "
                          "decided_at = UTC_TIMESTAMP() WHERE id = %s", (user.email, count_id))
    return {"ok": True}


@router.post("/counts/{count_id}/return")
async def return_count(count_id: int, body: NoteIn, user: auth.User = Depends(auth.require("hq"))):
    c = await db.fetch_one("SELECT status FROM consumable_counts WHERE id = %s", (count_id,))
    if not c or c["status"] != "pending":
        raise HTTPException(409, "Tidak menunggu persetujuan. / Not waiting for approval.")
    await db.execute("UPDATE consumable_counts SET status = 'returned', decided_by = %s, "
                     "decided_at = UTC_TIMESTAMP(), hq_note = %s WHERE id = %s", (user.email, body.note, count_id))
    return {"ok": True}


async def due_counts(site_ids: list[int]) -> dict[int, object]:
    """Per hub: when the weekly count was last sent (None = never). For todo."""
    if not site_ids:
        return {}
    rows = await db.fetch_all(
        f"SELECT site_id, MAX(counted_at) AS at FROM consumable_counts WHERE site_id IN "
        f"({db.placeholders(site_ids)}) AND status IN ('pending','approved') GROUP BY site_id", site_ids)
    have = {r["site_id"]: r["at"] for r in rows}
    return {sid: have.get(sid) for sid in site_ids}
