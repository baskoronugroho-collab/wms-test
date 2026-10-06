"""Mode demo (BUILD.md, Demo toggle): show Shaun the Hiryu link end to end
before Hiryu sends anything.

Per hub, Pengaturan, Demo (SPV and above) switches Mode demo on. Then:

  * Buat pesanan dummy builds a realistic message 1 (contract v1.1) from that
    hub's Hiryu stores and menu items, `message_id` "demo-...", and passes it
    through the very handler Hiryu's POST /api/hiryu/v1/orders runs;
  * Batalkan dari Hiryu on a demo order sends message 2 the same way;
  * messages 3, 4 and 5 for that hub go to the built-in Hiryu stand-in
    (pos_sender), which records them and answers 200;
  * everything in and out shows in the Pesan Hiryu log
    (GET /api/hiryu-link/messages).

A demo order is a Hiryu order in every way except that it is marked
orders.is_demo. It is not a WMS test order (UJI, is_test): those are training
only and never reach Hiryu, real or stand-in. No customer data is made up: the
contract carries none.
"""
import random
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import auth
import daycolor
import db
import ledger
from routers import hiryu_link

router = APIRouter(prefix="/api/demo", tags=["demo"])

_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class DemoSettings(BaseModel):
    site_id: int
    site_code: str
    demo_mode: bool
    can_edit: bool = Field(description="SPV and above may switch it")
    message: str | None = None


class DemoSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: int
    demo_mode: bool


class DemoItem(BaseModel):
    hiryu_item_id: str
    name: str | None
    sku_code: str
    units_per_sale: int
    price: int | None
    available: bool
    stock: int = Field(description="Units on the shelf not held for an order")


class DemoStore(BaseModel):
    hiryu_store_id: int
    name: str
    brand_name: str | None
    items: list[DemoItem]


class DemoStores(BaseModel):
    site_id: int
    demo_mode: bool
    stores: list[DemoStore]


class DemoMissing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["replace", "remove", "cancel_order", "contact_customer"] = Field(
        description="Ganti / Hapus / Batalkan / Hubungi")
    hiryu_item_id: str | None = Field(default=None, description="Which line; null = any")
    replace_hiryu_item_id: str | None = Field(default=None,
                                              description="For replace; null = any item in stock")


class DemoOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: int
    hiryu_store_id: int | None = Field(default=None, description="null = any active store at the hub")
    lines: int | None = Field(default=None, ge=1, le=20, description="Products; null = acak (3 to 6)")
    item_qty: int | None = Field(default=None, ge=1, le=10,
                                 description="Quantity per product; null = acak (1 to 3)")
    missing: DemoMissing | None = Field(default=None,
                                        description="One line the picker will find missing, "
                                                    "with the customer's instruction")
    scheduled_in_minutes: int | None = Field(default=None, ge=25, le=1440,
                                             description="A scheduled order, due in N minutes")


class DemoMissingLine(BaseModel):
    hiryu_item_id: str
    name: str | None
    sku_code: str
    instruction: str
    replace_hiryu_item_id: str | None = None
    replace_name: str | None = None


class DemoOrderAnswer(BaseModel):
    http_status: int
    answer: dict
    grab_order_id: str
    gm_number: str
    message: dict = Field(description="The exact message 1 passed to the handler")
    missing_line: DemoMissingLine | None
    text: str


class DemoCancelIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cancelled_by: Literal["customer", "grab", "merchant"] = "customer"
    reason_code: str | None = Field(default="2004", pattern=r"^200[1-4]$")


class DemoCancelAnswer(BaseModel):
    http_status: int
    answer: dict
    message: dict = Field(description="The exact message 2 passed to the handler")


async def _site(user: auth.User, site_id: int) -> dict:
    site = await auth.assert_site_access(user, site_id)
    row = await db.fetch_one("SELECT demo_mode FROM sites WHERE id = %s", (site_id,))
    site["demo_mode"] = bool(row and row["demo_mode"])
    return site


@router.get("/settings", response_model=DemoSettings)
async def get_settings(site_id: int, user: auth.User = Depends(auth.current_user)):
    """Is the hub in Mode demo? Every role may ask (Pesanan shows Buat pesanan
    dummy to SPV and above only when it is on)."""
    site = await _site(user, site_id)
    return {"site_id": site_id, "site_code": site["code"], "demo_mode": site["demo_mode"],
            "can_edit": user.at_least("supervisor")}


@router.put("/settings", response_model=DemoSettings)
async def put_settings(body: DemoSettingsIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Mode demo on or off for one hub (SPV and above, at their own hubs). On:
    messages 3 to 5 of this hub go to the Hiryu stand-in, not to Hiryu."""
    site = await _site(user, body.site_id)
    if site["is_training"] or site["site_type"] != "darkstore":
        raise HTTPException(422, "Mode demo hanya untuk dark store, bukan lokasi latihan. / "
                                 "Mode demo is for a dark store, not the training site.")
    await db.execute("UPDATE sites SET demo_mode = %s WHERE id = %s",
                     (1 if body.demo_mode else 0, body.site_id))
    async with db.tx() as cur:
        await ledger.audit(cur, actor_email=user.email, entity="site", entity_id=body.site_id,
                           action="demo_on" if body.demo_mode else "demo_off",
                           after={"demo_mode": body.demo_mode})
    return {"site_id": body.site_id, "site_code": site["code"], "demo_mode": body.demo_mode,
            "can_edit": True,
            "message": ("Mode demo menyala: pesan ke Hiryu masuk ke stand-in. / Mode demo on: "
                        "messages to Hiryu go to the stand-in.") if body.demo_mode else
                       ("Mode demo mati. / Mode demo off.")}


async def _stores_with_items(site_id: int, store_no: int | None = None) -> list[dict]:
    where, params = "", [site_id]
    if store_no is not None:
        where, params = " AND hs.hiryu_store_no = %s", [site_id, store_no]
    stores = await db.fetch_all(
        "SELECT hs.hiryu_store_no, hs.store_name, hs.brand_id, b.name AS brand_name "
        "FROM hiryu_stores hs LEFT JOIN brands b ON b.id = hs.brand_id "
        "WHERE hs.site_id = %s AND hs.active = 1" + where + " ORDER BY hs.hiryu_store_no", params)
    if not stores:
        return []
    stock_rows = await db.fetch_all(
        "SELECT ib.sku_id, COALESCE(SUM(GREATEST(0, ib.qty_on_hand - ib.qty_allocated)), 0) AS n "
        "FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "WHERE ib.site_id = %s AND l.is_virtual = 0 GROUP BY ib.sku_id", (site_id,))
    stock = {r["sku_id"]: int(r["n"]) for r in stock_rows}
    nos = [s["hiryu_store_no"] for s in stores]
    items = await db.fetch_all(
        "SELECT hi.hiryu_store_no, hi.hiryu_item_id, hi.item_name, hi.sku_id, hi.units_per_sale, "
        "       hi.price_idr, hi.available_status, "
        "       COALESCE(NULLIF(k.hiryu_sku_code, ''), hi.sku_code, k.brand_sku_code) AS sku_code "
        "FROM hiryu_items hi JOIN skus k ON k.id = hi.sku_id "
        f"WHERE hi.hiryu_store_no IN ({db.placeholders(nos)}) AND hi.active = 1 "
        "ORDER BY hi.item_name", nos)
    by_store: dict[int, list] = {}
    for i in items:
        by_store.setdefault(i["hiryu_store_no"], []).append({
            "hiryu_item_id": i["hiryu_item_id"], "name": i["item_name"],
            "sku_code": (i["sku_code"] or "").upper(), "sku_id": i["sku_id"],
            "units_per_sale": int(i["units_per_sale"] or 1),
            "price": int(i["price_idr"]) if i["price_idr"] is not None else None,
            "available": (i["available_status"] or "AVAILABLE").upper() == "AVAILABLE",
            "stock": stock.get(i["sku_id"], 0),
        })
    return [{"hiryu_store_id": s["hiryu_store_no"], "name": s["store_name"],
             "brand_name": s["brand_name"], "items": by_store.get(s["hiryu_store_no"], [])}
            for s in stores]


@router.get("/stores", response_model=DemoStores)
async def demo_stores(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """What the Buat pesanan dummy dialog offers: the hub's active Hiryu stores
    and their menu items, with the stock on the shelf."""
    site = await _site(user, site_id)
    return {"site_id": site_id, "demo_mode": site["demo_mode"],
            "stores": await _stores_with_items(site_id)}


def _grab_order_id() -> str:
    return "A-" + "".join(secrets.choice(_ID_CHARS) for _ in range(10))


async def _gm_number(site_id: int) -> str:
    used = await db.fetch_all(
        "SELECT hiryu_short_no FROM orders WHERE site_id = %s AND hiryu_short_no IS NOT NULL "
        "AND created_at >= UTC_TIMESTAMP() - INTERVAL 2 DAY", (site_id,))
    taken = {r["hiryu_short_no"] for r in used}
    for _ in range(50):
        gm = f"GM-{random.randint(100, 999)}"
        if gm not in taken:
            return gm
    return f"GM-{random.randint(1000, 9999)}"


def _wib_now() -> str:
    return datetime.now(daycolor.WIB).replace(microsecond=0).isoformat()


@router.post("/orders", response_model=DemoOrderAnswer)
async def demo_order(body: DemoOrderIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Buat pesanan dummy: a full message 1 (contract v1.1, message_id
    "demo-...") from the hub's Hiryu store and menu, through the same handler
    as POST /api/hiryu/v1/orders. Products in stock come first so the order can
    be picked; one line can be the missing one, carrying the customer's
    instruction (Ganti, Hapus, Batalkan, Hubungi). The other lines carry no
    instruction (null, handled as cancel_order). A refusal is returned as the
    handler's answer, as Hiryu would see it."""
    site = await _site(user, body.site_id)
    if not site["demo_mode"]:
        raise HTTPException(409, "Mode demo belum menyala untuk dark store ini (Pengaturan, Demo). / "
                                 "Mode demo is not on for this dark store (Pengaturan, Demo).")
    stores = await _stores_with_items(body.site_id, body.hiryu_store_id)
    stores = [s for s in stores if any(i["available"] for i in s["items"])]
    if not stores:
        raise HTTPException(422, "Tidak ada toko Hiryu aktif dengan menu di dark store ini. / "
                                 "No active Hiryu store with a menu at this dark store.")
    store = stores[0] if body.hiryu_store_id else random.choice(stores)
    menu = [i for i in store["items"] if i["available"]]
    n_lines = body.lines or random.randint(3, 6)
    qty_of = (lambda: body.item_qty) if body.item_qty else (lambda: random.randint(1, 3))

    # In stock first, one line per SKU, so the order can be picked as it is.
    random.shuffle(menu)
    menu.sort(key=lambda i: i["stock"] <= 0)
    chosen, skus = [], set()
    forced = body.missing.hiryu_item_id if body.missing else None
    if forced:
        hit = next((i for i in menu if i["hiryu_item_id"] == forced), None)
        if not hit:
            raise HTTPException(422, f"Item {forced} tidak ada di menu toko ini. / "
                                     f"Item {forced} is not on this store's menu.")
        chosen.append(hit)
        skus.add(hit["sku_id"])
    for item in menu:
        if len(chosen) >= n_lines:
            break
        if item["sku_id"] in skus:
            continue
        chosen.append(item)
        skus.add(item["sku_id"])

    lines = []
    for item in chosen:
        q = qty_of()
        if item["stock"] > 0:
            q = max(1, min(q, item["stock"] // max(1, item["units_per_sale"]) or 1))
        lines.append({
            "hiryu_item_id": item["hiryu_item_id"], "item_qty": q, "sku_code": item["sku_code"],
            "units": q * item["units_per_sale"], "item_price": item["price"],
            "oos_instruction": None,
        })

    missing_line = None
    if body.missing:
        idx = 0 if forced else random.randrange(len(lines))
        target, item = lines[idx], chosen[idx]
        ins = {"type": body.missing.type}
        rep = None
        if body.missing.type == "replace":
            pool = [i for i in menu if i["sku_id"] != item["sku_id"] and i["stock"] > 0]
            if body.missing.replace_hiryu_item_id:
                rep = next((i for i in store["items"]
                            if i["hiryu_item_id"] == body.missing.replace_hiryu_item_id), None)
                if not rep:
                    raise HTTPException(422, "Item pengganti tidak ada di menu toko ini. / "
                                             "The replacement is not on this store's menu.")
            elif pool:
                rep = random.choice(pool)
            else:
                raise HTTPException(422, "Tidak ada produk pengganti dengan stok. / "
                                         "No replacement product in stock.")
            ins.update({"replace_hiryu_item_id": rep["hiryu_item_id"],
                        "replace_sku_code": rep["sku_code"],
                        "replace_units": rep["units_per_sale"]})
        target["oos_instruction"] = ins
        missing_line = {"hiryu_item_id": item["hiryu_item_id"], "name": item["name"],
                        "sku_code": item["sku_code"], "instruction": body.missing.type,
                        "replace_hiryu_item_id": rep["hiryu_item_id"] if rep else None,
                        "replace_name": rep["name"] if rep else None}

    gid = _grab_order_id()
    gm = await _gm_number(body.site_id)
    scheduled = None
    if body.scheduled_in_minutes:
        scheduled = (datetime.now(daycolor.WIB) + timedelta(minutes=body.scheduled_in_minutes)
                     ).replace(microsecond=0).isoformat()
    message = {
        "message_id": f"demo-ord-{secrets.token_hex(4)}",
        "grab_order_id": gid, "gm_number": gm, "hiryu_store_id": store["hiryu_store_id"],
        "order_time": _wib_now(), "scheduled_time": scheduled, "estimated_ready_time": None,
        "lines": lines,
    }
    parsed = hiryu_link.OrderMessage.model_validate(message)
    who = user.name or user.email
    try:
        code, answer = await hiryu_link.handle_order(
            parsed, f"demo:{user.email}", via="demo",
            trigger=(f"Pesanan dummy dibuat oleh {who} (Mode demo)",
                     f"Dummy order made by {who} (Mode demo)"))
    except HTTPException as e:
        code, answer = e.status_code, {"detail": e.detail}
    units = sum(l["units"] for l in lines)
    text = (f"{gm}: {len(lines)} produk, {units} unit, {store['name']}. / "
            f"{gm}: {len(lines)} products, {units} units, {store['name']}.")
    return {"http_status": code, "answer": answer, "grab_order_id": gid, "gm_number": gm,
            "message": message, "missing_line": missing_line, "text": text}


@router.post("/orders/{grab_order_id}/cancel", response_model=DemoCancelAnswer)
async def demo_cancel(grab_order_id: str, body: DemoCancelIn,
                      user: auth.User = Depends(auth.require("supervisor"))):
    """Batalkan dari Hiryu on a demo order: message 2 through the same handler
    as POST /api/hiryu/v1/orders/{grab_order_id}/cancel."""
    order = await db.fetch_one(
        "SELECT id, site_id, is_demo FROM orders WHERE external_ref = %s", (grab_order_id,))
    if not order:
        raise HTTPException(404, "Pesanan tidak ditemukan. / Order not found.")
    await auth.assert_site_access(user, order["site_id"])
    if not order["is_demo"]:
        raise HTTPException(409, "Hanya pesanan dummy yang bisa dibatalkan dari sini. / "
                                 "Only a dummy order can be cancelled here.")
    message = {
        "message_id": f"demo-can-{secrets.token_hex(4)}",
        "reason_code": body.reason_code,
        "reason": hiryu_link.REASONS.get(body.reason_code) if body.reason_code else None,
        "cancelled_by": body.cancelled_by,
        "cancelled_at": _wib_now(),
    }
    parsed = hiryu_link.CancelMessage.model_validate(message)
    who = user.name or user.email
    try:
        code, answer = await hiryu_link.handle_cancel(
            grab_order_id, parsed, f"demo:{user.email}", via="demo",
            trigger=(f"Batalkan dari Hiryu ditekan oleh {who} (Mode demo, {body.cancelled_by})",
                     f"Batalkan dari Hiryu pressed by {who} (Mode demo, {body.cancelled_by})"))
    except HTTPException as e:
        code, answer = e.status_code, {"detail": e.detail}
    return {"http_status": code, "answer": answer, "message": message}

