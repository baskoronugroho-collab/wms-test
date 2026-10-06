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

For a repeatable demo (the live demo to Shaun) there are four presets with
fixed products (GET /api/demo/presets shows each product's barcode, likely bin
and stock), and Reset stok demo puts those products back to their dev-seed
level in their rack bins, as audited stock corrections through the ledger.

A missing line at 0 stock: receive_order still gives it a pick line at the
SKU's bin (common.pick_locations_for falls back to the slots, primary first
when none is stocked), unallocated, so the picker goes there and presses
Barang tidak ada as usual. Nothing in the order handler needs changing.
"""
import random
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import auth
import common
import daycolor
import db
import floor
import ledger
from routers import hiryu_link, opname

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


class DemoLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hiryu_item_id: str
    item_qty: int = Field(ge=1, le=20)


class DemoOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: int
    preset: Literal["A", "B", "C", "D"] | None = Field(
        default=None, description="A preset from GET /api/demo/presets: store, items and "
                                  "missing line come from it (the fields below are ignored, "
                                  "except scheduled_in_minutes)")
    hiryu_store_id: int | None = Field(default=None, description="null = any active store at the hub")
    items: list[DemoLineIn] | None = Field(
        default=None, min_length=1, max_length=20,
        description="Exact products and quantities, in this order; when given, lines and "
                    "item_qty are ignored")
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
    preset: str | None = None
    message: dict = Field(description="The exact message 1 passed to the handler")
    missing_line: DemoMissingLine | None
    text: str


class Bilingual(BaseModel):
    id: str
    en: str


class PresetItem(BaseModel):
    hiryu_item_id: str
    name: str | None
    sku_code: str = Field(description="The brand SKU code (LBR-0001)")
    barcode: str | None = Field(description="The first barcode registered for the SKU")
    bin: str | None = Field(description="Where the pick will most likely go now: the first "
                                        "place the order handler would use (A-2-03)")
    primary_bin: str | None = Field(description="The SKU's primary rack bin")
    stock: int = Field(description="Sellable units at the dark store (rack bins, not held)")
    item_qty: int
    units: int = Field(description="item_qty x units per sale")
    missing: bool = Field(default=False, description="The picker presses Barang tidak ada here")
    available: bool = True


class PresetMissing(BaseModel):
    type: Literal["replace", "remove", "cancel_order", "contact_customer"]
    hiryu_item_id: str
    replace: PresetItem | None = Field(default=None, description="The replacement, for replace")


class Preset(BaseModel):
    key: str
    title: Bilingual
    description: Bilingual
    ok: bool
    reason: str | None = Field(default=None, description="Why it cannot run here "
                                                         "(Indonesian / English)")
    hiryu_store_id: int | None = None
    store_name: str | None = None
    items: list[PresetItem] = Field(default_factory=list)
    missing: PresetMissing | None = None


class Presets(BaseModel):
    site_id: int
    demo_mode: bool
    presets: list[Preset]


class ResetRow(BaseModel):
    sku_id: int
    sku_code: str
    name: str | None
    bin: str
    role: str = Field(description="primary or overflow")
    now: int = Field(description="Units on hand in the bin now")
    target: int = Field(description="Units after the reset")
    change: int
    seed_level: bool = Field(description="False: not in the dev seed, the default 12 is used")


class ResetBlock(BaseModel):
    gm_number: str
    grab_order_id: str
    status: str


class ResetPlan(BaseModel):
    site_id: int
    demo_mode: bool
    can_reset: bool
    rows: list[ResetRow]
    blocked_by: list[ResetBlock] = Field(default_factory=list,
                                         description="Open demo orders holding these SKUs")
    problems: list[str] = Field(default_factory=list, description="Indonesian / English")
    notes: list[str] = Field(default_factory=list, description="Indonesian / English")
    message: str | None = None


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_id: int


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
        "SELECT hs.hiryu_store_no, hs.store_name, hs.brand_id, b.name AS brand_name, "
        "       b.code AS brand_code "
        "FROM hiryu_stores hs LEFT JOIN brands b ON b.id = hs.brand_id "
        "WHERE hs.site_id = %s AND hs.active = 1" + where + " ORDER BY hs.hiryu_store_no", params)
    if not stores:
        return []
    stock_rows = await db.fetch_all(
        "SELECT ib.sku_id, GREATEST(0, SUM(ib.qty_on_hand) - SUM(ib.qty_allocated)) AS n "
        "FROM inventory_balances ib JOIN locations l ON l.id = ib.location_id "
        "LEFT JOIN special_bins sb ON sb.location_id = l.id "
        "WHERE ib.site_id = %s AND l.is_virtual = 0 AND sb.location_id IS NULL "
        "GROUP BY ib.sku_id", (site_id,))
    stock = {r["sku_id"]: int(r["n"]) for r in stock_rows}
    nos = [s["hiryu_store_no"] for s in stores]
    items = await db.fetch_all(
        "SELECT hi.hiryu_store_no, hi.hiryu_item_id, hi.item_name, hi.sku_id, hi.units_per_sale, "
        "       hi.price_idr, hi.available_status, "
        "       COALESCE(NULLIF(k.hiryu_sku_code, ''), hi.sku_code, k.brand_sku_code) AS sku_code, "
        "       k.brand_sku_code "
        "FROM hiryu_items hi JOIN skus k ON k.id = hi.sku_id "
        f"WHERE hi.hiryu_store_no IN ({db.placeholders(nos)}) AND hi.active = 1 "
        "ORDER BY hi.item_name", nos)
    by_store: dict[int, list] = {}
    for i in items:
        by_store.setdefault(i["hiryu_store_no"], []).append({
            "hiryu_item_id": i["hiryu_item_id"], "name": i["item_name"],
            "sku_code": (i["sku_code"] or "").upper(), "sku_id": i["sku_id"],
            "brand_sku_code": (i["brand_sku_code"] or "").upper(),
            "units_per_sale": int(i["units_per_sale"] or 1),
            "price": int(i["price_idr"]) if i["price_idr"] is not None else None,
            "available": (i["available_status"] or "AVAILABLE").upper() == "AVAILABLE",
            "stock": stock.get(i["sku_id"], 0),
        })
    return [{"hiryu_store_id": s["hiryu_store_no"], "name": s["store_name"],
             "brand_name": s["brand_name"], "brand_code": (s["brand_code"] or "").upper(),
             "items": by_store.get(s["hiryu_store_no"], [])}
            for s in stores]


@router.get("/stores", response_model=DemoStores)
async def demo_stores(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """What the Buat pesanan dummy dialog offers: the hub's active Hiryu stores
    and their menu items, with the stock on the shelf."""
    site = await _site(user, site_id)
    return {"site_id": site_id, "demo_mode": site["demo_mode"],
            "stores": await _stores_with_items(site_id)}


# --------------------------------------------------------------------------
# Presets: the same products every time (the live demo to Shaun)
# --------------------------------------------------------------------------

# By brand code and brand SKU code; the store is the dark store's active Hiryu
# store of that brand (at MA5: 902 Kahf - Cawang, 903 Labore - Cawang). The
# products were chosen for plenty of rack stock at MA5 in the dev seed
# (tools/gen_dev_seed.py), all in rack A or B for a short walk; LBR-0001 is the
# product of the boards' GM-347 and GM-358.
PRESETS = [
    dict(key="A", brand="LBR",
         title=("Pesanan dengan pengganti", "Order with a replacement"),
         say=("Mild Cleanser 100 ml tidak ada; pelanggan memilih ganti dengan 225 ml (1 unit).",
              "Mild Cleanser 100 ml is missing; the customer chose the 225 ml (1 unit) instead."),
         items=[("LBR-0001", 3), ("LBR-0008", 3), ("LBR-0016", 3), ("LBR-0019", 3)],
         missing=("LBR-0001", "replace", "LBR-0002")),
    dict(key="B", brand="KHF",
         title=("Pesanan, semua ada", "Order, everything in stock"),
         say=("Ambil, kemas dan serahkan seperti biasa.", "Pick, pack and hand over as usual."),
         items=[("KHF-0005", 2), ("KHF-0007", 2), ("KHF-0062", 2)], missing=None),
    dict(key="C", brand="KHF",
         title=("Pelanggan membatalkan di Grab", "Customer cancels on Grab"),
         say=("Batalkan dari Hiryu di Papan antrean sebelum diambil.",
              "Cancel it from Hiryu on the queue board before picking."),
         items=[("KHF-0006", 1), ("KHF-0010", 1)], missing=None),
    dict(key="D", brand="LBR",
         title=("Barang tidak ada, pelanggan memilih batal", "Missing item, customer chose Cancel"),
         say=("Mild Cleanser 100 ml tidak ada; seluruh pesanan dibatalkan.",
              "Mild Cleanser 100 ml is missing; the whole order is cancelled."),
         items=[("LBR-0001", 2), ("LBR-0018", 2)], missing=("LBR-0001", "cancel_order", None)),
]
PRESET_KEYS = [p["key"] for p in PRESETS]

# The dev seed's opening level per bin (tools/gen_dev_seed.py, rng 20261005),
# by dark store short code, brand SKU code and bin. Reset stok demo puts each
# preset product back to these; a primary bin not listed gets RESET_DEFAULT.
SEED_LEVELS = {
    "MA5": {"LBR-0001": {"A-2-03": 9, "C-1-02": 6}, "LBR-0002": {"B-1-04": 5},
            "LBR-0008": {"A-2-04": 22}, "LBR-0016": {"A-4-02": 24}, "LBR-0018": {"A-4-04": 24},
            "LBR-0019": {"A-4-05": 22}, "KHF-0005": {"B-4-01": 22}, "KHF-0006": {"B-4-02": 22},
            "KHF-0007": {"B-4-03": 22}, "KHF-0010": {"B-4-06": 24}, "KHF-0062": {"D-4-04": 24}},
    "KJ5": {"LBR-0001": {"A-2-03": 24, "C-1-02": 0}, "LBR-0002": {"B-1-04": 18},
            "LBR-0008": {"A-2-04": 22}, "LBR-0016": {"A-4-02": 24}, "LBR-0018": {"A-4-04": 24},
            "LBR-0019": {"A-4-05": 22}, "KHF-0005": {"B-4-01": 22}, "KHF-0006": {"B-4-02": 22},
            "KHF-0007": {"B-4-03": 22}, "KHF-0010": {"B-4-06": 24}, "KHF-0062": {"D-4-04": 24}},
}
RESET_DEFAULT = 12
RESET_REASON = "demo_reset"


def _preset_codes() -> list[str]:
    """Every brand SKU code the presets use, replacements included."""
    out: list[str] = []
    for p in PRESETS:
        codes = [c for c, _ in p["items"]]
        if p["missing"] and p["missing"][2]:
            codes.append(p["missing"][2])
        out += [c for c in codes if c not in out]
    return out


def _hub_short(site: dict) -> str:
    return (site.get("code") or "").upper().split("-")[-1]


async def _sku_facts(site_id: int, sku_ids: list[int]) -> dict[int, dict]:
    """First registered barcode, primary bin and the bin a pick would go to now."""
    if not sku_ids:
        return {}
    ph = db.placeholders(sku_ids)
    bcs = await db.fetch_all(
        "SELECT b.sku_id, b.barcode FROM barcodes b JOIN ("
        f"  SELECT sku_id, MIN(id) AS id FROM barcodes WHERE sku_id IN ({ph}) GROUP BY sku_id"
        ") f ON f.id = b.id", sku_ids)
    barcode = {r["sku_id"]: r["barcode"] for r in bcs}
    out = {}
    for sid in sku_ids:
        places = await common.pick_locations_for(site_id, sid)
        primary = next((p for p in places if p["slot_role"] == "primary"), None)
        out[sid] = {"barcode": barcode.get(sid),
                    "bin": floor.short_bin(places[0]["location_code"]) if places else None,
                    "primary_bin": floor.short_bin(primary["location_code"]) if primary else None}
    return out


async def _presets(site: dict) -> list[dict]:
    """The presets resolved at this dark store: store, menu items, facts. A
    preset whose store or items are not here is returned with ok False and the
    reason."""
    stores = await _stores_with_items(site["id"])
    by_brand: dict[str, dict] = {}
    for s in stores:
        by_brand.setdefault(s["brand_code"], s)
    sku_ids = {i["sku_id"] for s in stores for i in s["items"]
               if i["brand_sku_code"] in _preset_codes()}
    facts = await _sku_facts(site["id"], sorted(sku_ids))

    def item(menu_item: dict, qty: int, missing: bool = False) -> dict:
        f = facts.get(menu_item["sku_id"], {})
        return {"hiryu_item_id": menu_item["hiryu_item_id"], "name": menu_item["name"],
                "sku_code": menu_item["brand_sku_code"] or menu_item["sku_code"],
                "barcode": f.get("barcode"), "bin": f.get("bin"),
                "primary_bin": f.get("primary_bin"), "stock": menu_item["stock"],
                "item_qty": qty, "units": qty * menu_item["units_per_sale"],
                "missing": missing, "available": menu_item["available"]}

    out = []
    for p in PRESETS:
        store = by_brand.get(p["brand"])
        n = len(p["items"])
        qty = p["items"][0][1]
        res = {"key": p["key"], "title": {"id": p["title"][0], "en": p["title"][1]},
               "ok": False, "reason": None, "items": [], "missing": None,
               "hiryu_store_id": store["hiryu_store_id"] if store else None,
               "store_name": store["name"] if store else None}
        where = store["name"] if store else p["brand"]
        res["description"] = {
            "id": f"{where}. {n} produk, {qty} unit per produk. {p['say'][0]}",
            "en": f"{where}. {n} products, {qty} unit{'s' if qty > 1 else ''} each. {p['say'][1]}"}
        out.append(res)
        if not store:
            brand = "Labore" if p["brand"] == "LBR" else "Kahf" if p["brand"] == "KHF" else p["brand"]
            res["reason"] = (f"Tidak ada toko Hiryu {brand} yang aktif di dark store ini. / "
                             f"No active {brand} Hiryu store at this dark store.")
            continue
        menu = {i["brand_sku_code"]: i for i in store["items"]}
        need = [c for c, _ in p["items"]] + ([p["missing"][2]] if p["missing"] and p["missing"][2] else [])
        absent = [c for c in need if c not in menu]
        if absent:
            codes = ", ".join(absent)
            res["reason"] = (f"{codes} tidak ada di menu {store['name']}. / "
                             f"{codes} is not on the {store['name']} menu.")
            continue
        miss_code = p["missing"][0] if p["missing"] else None
        res["items"] = [item(menu[c], q, c == miss_code) for c, q in p["items"]]
        if p["missing"]:
            code, mtype, rep = p["missing"]
            res["missing"] = {"type": mtype, "hiryu_item_id": menu[code]["hiryu_item_id"],
                              "replace": item(menu[rep], 1) if rep else None}
        res["ok"] = True
    return out


@router.get("/presets", response_model=Presets)
async def demo_presets(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """The four demo presets at this dark store, with exactly what will be
    scanned: each product's name, brand SKU code, first barcode, the bin the
    pick will most likely go to (and its primary bin), sellable stock and
    quantity. The missing product is marked; for A the replacement is listed."""
    site = await _site(user, site_id)
    return {"site_id": site_id, "demo_mode": site["demo_mode"], "presets": await _presets(site)}


# --------------------------------------------------------------------------
# Reset stok demo
# --------------------------------------------------------------------------

async def _reset_plan(site: dict) -> dict:
    """What Reset stok demo would change: every bin of every preset product
    (its primary bin, and its other slot when the seed has a level for it),
    from now to the seed level, plus what refuses it."""
    hub = _hub_short(site)
    levels = SEED_LEVELS.get(hub, {})
    codes = _preset_codes()
    skus = await db.fetch_all(
        f"SELECT id, brand_sku_code, name_display FROM skus WHERE UPPER(brand_sku_code) IN "
        f"({db.placeholders(codes)})", codes)
    by_id = {s["id"]: s for s in skus}
    notes, problems = [], []
    found = {(s["brand_sku_code"] or "").upper() for s in skus}
    for c in codes:
        if c not in found:
            notes.append(f"{c} tidak dikenal di WMS, dilewati. / {c} is not known in the WMS, skipped.")
    rows = []
    if by_id:
        ids = list(by_id)
        slots = await db.fetch_all(
            "SELECT sa.sku_id, sa.slot_role, l.id AS location_id, l.code AS location_code, "
            "       COALESCE(ib.qty_on_hand, 0) AS on_hand, COALESCE(ib.qty_allocated, 0) AS held "
            "FROM slot_assignments sa JOIN baskets bk ON bk.id = sa.basket_id "
            "JOIN locations l ON l.id = bk.location_id "
            "LEFT JOIN inventory_balances ib ON ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id "
            "     AND ib.location_id = l.id "
            f"WHERE sa.site_id = %s AND sa.sku_id IN ({db.placeholders(ids)}) "
            "ORDER BY sa.sku_id, sa.slot_role = 'primary' DESC, l.code", [site["id"], *ids])
        with_primary = set()
        for s in slots:
            sku = by_id[s["sku_id"]]
            code = (sku["brand_sku_code"] or "").upper()
            short = floor.short_bin(s["location_code"])
            seed = levels.get(code, {}).get(short)
            if s["slot_role"] == "primary":
                with_primary.add(s["sku_id"])
                target = seed if seed is not None else RESET_DEFAULT
            elif seed is not None:
                target = seed
            else:
                continue
            now = int(s["on_hand"])
            if int(s["held"]) > target:
                problems.append(f"{short}: {int(s['held'])} unit {code} masih dipegang pesanan. / "
                                f"{short}: {int(s['held'])} unit(s) of {code} still held by orders.")
            rows.append({"sku_id": s["sku_id"], "sku_code": code, "name": sku["name_display"],
                         "bin": short, "role": s["slot_role"], "location_id": s["location_id"],
                         "now": now, "target": target, "change": target - now,
                         "seed_level": seed is not None})
        for sid, sku in by_id.items():
            if sid not in with_primary:
                c = (sku["brand_sku_code"] or "").upper()
                notes.append(f"{c} belum punya bin utama di dark store ini, dilewati. / "
                             f"{c} has no primary bin at this dark store, skipped.")
    blocked = []
    if by_id:
        ids = list(by_id)
        open_orders = await db.fetch_all(
            "SELECT DISTINCT o.id, o.hiryu_short_no, o.external_ref, o.status FROM orders o "
            "JOIN order_lines ol ON ol.order_id = o.id "
            "WHERE o.site_id = %s AND o.is_demo = 1 AND o.handed_over_at IS NULL "
            "  AND o.status NOT IN ('handed_over', 'cancelled') "
            f"  AND ol.sku_id IN ({db.placeholders(ids)}) ORDER BY o.id", [site["id"], *ids])
        blocked = [{"gm_number": o["hiryu_short_no"] or o["external_ref"],
                    "grab_order_id": o["external_ref"], "status": o["status"]} for o in open_orders]
        back = await db.fetch_all(
            "SELECT rt.sku_id, SUM(rt.qty - rt.qty_returned) AS n, "
            "       GROUP_CONCAT(DISTINCT COALESCE(o.hiryu_short_no, rt.external_ref)) AS gms "
            "FROM return_tasks rt LEFT JOIN orders o ON o.id = rt.order_id "
            "WHERE rt.site_id = %s AND rt.status = 'open' "
            f"  AND rt.sku_id IN ({db.placeholders(ids)}) GROUP BY rt.sku_id",
            [site["id"], *ids])
        for b in back:
            if int(b["n"] or 0) > 0:
                c = (by_id[b["sku_id"]]["brand_sku_code"] or "").upper()
                notes.append(f"{int(b['n'])} unit {c} dari {b['gms']} masih menunggu Kembalikan ke "
                             f"rak; setelah reset, unit itu menambah stok bin. / {int(b['n'])} unit(s) "
                             f"of {c} from {b['gms']} still wait for Put back to rack; after the "
                             "reset they add to the bin.")
    if blocked:
        gms = ", ".join(b["gm_number"] for b in blocked)
        problems.insert(0, f"Pesanan demo yang masih terbuka memegang produk ini: {gms}. Serahkan "
                           f"atau batalkan dulu. / Open demo orders still hold these products: "
                           f"{gms}. Hand them over or cancel them first.")
    if not site["demo_mode"]:
        problems.insert(0, "Mode demo belum menyala untuk dark store ini. / "
                           "Mode demo is not on for this dark store.")
    return {"site_id": site["id"], "demo_mode": site["demo_mode"],
            "can_reset": not problems and bool(rows), "rows": rows, "blocked_by": blocked,
            "problems": problems, "notes": notes}


@router.get("/reset-stock", response_model=ResetPlan)
async def reset_stock_plan(site_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Reset stok demo, step 1: what it will change (every bin, now and after)
    and whatever refuses it, before the SPV confirms."""
    site = await _site(user, site_id)
    return await _reset_plan(site)


@router.post("/reset-stock", response_model=ResetPlan)
async def reset_stock(body: ResetIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Reset stok demo (SPV and above, only in Mode demo): every preset product,
    the replacement included, back to its dev-seed level in its primary rack
    bin (12 when the seed has none), and its other slot (C-1-02 for LBR-0001)
    back to the seed level. Each change is a stock correction through the
    ledger (movement adjustment, reason demo_reset), so the ledger stays the
    source and a stock message 3 is queued for Hiryu, like a count correction;
    the bins' open count flags are closed as a count would. Refused while an
    open demo order (not handed over, not cancelled) holds any of these SKUs."""
    site = await _site(user, body.site_id)
    if not site["demo_mode"]:
        raise HTTPException(409, "Mode demo belum menyala untuk dark store ini (Pengaturan, Demo). / "
                                 "Mode demo is not on for this dark store (Settings, Demo).")
    plan = await _reset_plan(site)
    if plan["problems"]:
        halves = [p.split(" / ", 1) for p in plan["problems"]]
        raise HTTPException(409, " ".join(h[0] for h in halves) + " / " +
                                 " ".join(h[-1] for h in halves))
    done = []
    async with db.tx() as cur:
        # Primary bins first: refilled from empty in the same moment as an
        # overflow, the primary is the one the picker is sent to.
        for r in sorted(plan["rows"], key=lambda r: r["role"] != "primary"):
            bal = await db.one(
                cur, "SELECT qty_on_hand, qty_allocated FROM inventory_balances "
                     "WHERE site_id = %s AND sku_id = %s AND location_id = %s FOR UPDATE",
                (site["id"], r["sku_id"], r["location_id"]))
            now = int(bal["qty_on_hand"]) if bal else 0
            if bal and int(bal["qty_allocated"]) > r["target"]:
                raise HTTPException(409, f"{r['bin']}: unit {r['sku_code']} baru saja dipegang "
                                         f"pesanan. Coba lagi. / {r['bin']}: units of "
                                         f"{r['sku_code']} were just taken by an order. Try again.")
            change = r["target"] - now
            if change:
                await ledger.apply(
                    cur, site_id=site["id"], sku_id=r["sku_id"], location_id=r["location_id"],
                    qty_delta=change, movement_type="adjustment", actor_email=user.email,
                    ref_type="demo_reset", ref_id=site["id"], reason_code=RESET_REASON,
                    scan_source="manual", is_training=bool(site.get("is_training")))
            await opname._close_flags(cur, {"location_id": r["location_id"]}, user.email)
            done.append({**r, "now": now, "change": change})
        await ledger.audit(
            cur, actor_email=user.email, entity="site", entity_id=site["id"],
            action="demo_reset_stock",
            before={r["bin"]: {"sku": r["sku_code"], "qty": r["now"]} for r in done},
            after={"reason": "Reset demo",
                   "bins": {r["bin"]: {"sku": r["sku_code"], "qty": r["target"]} for r in done}})
    moved = [r for r in done if r["change"]]
    units = sum(r["change"] for r in moved)
    plan.update(rows=done, can_reset=False,
                message=(f"Stok demo direset: {len(moved)} bin diubah ({units:+d} unit). / "
                         f"Demo stock reset: {len(moved)} bin(s) changed ({units:+d} units)."
                         if moved else
                         "Stok demo sudah sesuai, tidak ada yang diubah. / "
                         "Demo stock already matches, nothing changed."))
    return plan


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
    handler's answer, as Hiryu would see it.

    `preset` (A to D, GET /api/demo/presets) or `items` fix the products and
    quantities; then nothing is left to chance and stock is not checked, so a
    preset's missing line is sent even at 0 stock (its pick line still goes to
    the SKU's bin)."""
    site = await _site(user, body.site_id)
    if not site["demo_mode"]:
        raise HTTPException(409, "Mode demo belum menyala untuk dark store ini (Pengaturan, Demo). / "
                                 "Mode demo is not on for this dark store (Pengaturan, Demo).")
    store_no, items, missing = body.hiryu_store_id, body.items, body.missing
    if body.preset:
        p = next(x for x in await _presets(site) if x["key"] == body.preset)
        if not p["ok"]:
            why = (p["reason"] or "").split(" / ", 1)
            raise HTTPException(422, f"Preset {body.preset}: {why[0]} / Preset {body.preset}: {why[-1]}")
        store_no = p["hiryu_store_id"]
        items = [DemoLineIn(hiryu_item_id=i["hiryu_item_id"], item_qty=i["item_qty"])
                 for i in p["items"]]
        m = p["missing"]
        missing = DemoMissing(
            type=m["type"], hiryu_item_id=m["hiryu_item_id"],
            replace_hiryu_item_id=m["replace"]["hiryu_item_id"] if m["replace"] else None
        ) if m else None

    stores = await _stores_with_items(body.site_id, store_no)
    if items and store_no is None:
        # The store whose menu has every item asked for.
        want = {i.hiryu_item_id for i in items}
        stores = [s for s in stores if want <= {i["hiryu_item_id"] for i in s["items"]}]
    elif not items:
        stores = [s for s in stores if any(i["available"] for i in s["items"])]
    if not stores:
        raise HTTPException(422, "Tidak ada toko Hiryu aktif dengan menu itu di dark store ini. / "
                                 "No active Hiryu store with that menu at this dark store.")
    store = stores[0] if store_no or items else random.choice(stores)
    forced = missing.hiryu_item_id if missing else None

    if items:
        # Exactly these products and quantities, in this order, whatever the
        # stock: a line at 0 still gets its bin, where the picker finds it missing.
        on_menu = {i["hiryu_item_id"]: i for i in store["items"]}
        absent = [i.hiryu_item_id for i in items if i.hiryu_item_id not in on_menu]
        if absent:
            raise HTTPException(422, f"Tidak ada di menu {store['name']}: {', '.join(absent)}. / "
                                     f"Not on the {store['name']} menu: {', '.join(absent)}.")
        if forced and forced not in {i.hiryu_item_id for i in items}:
            raise HTTPException(422, f"Item {forced} bukan bagian dari pesanan ini. / "
                                     f"Item {forced} is not one of this order's items.")
        chosen = [on_menu[i.hiryu_item_id] for i in items]
        qtys = [i.item_qty for i in items]
        menu = [i for i in store["items"] if i["available"]]
    else:
        menu = [i for i in store["items"] if i["available"]]
        n_lines = body.lines or random.randint(3, 6)
        # In stock first, one line per SKU, so the order can be picked as it is.
        # The forced missing line is kept whatever its stock (0 included).
        random.shuffle(menu)
        menu.sort(key=lambda i: i["stock"] <= 0)
        chosen, skus = [], set()
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
        qtys = []
        for item in chosen:
            q = body.item_qty or random.randint(1, 3)
            if item["stock"] > 0:
                q = max(1, min(q, item["stock"] // max(1, item["units_per_sale"]) or 1))
            qtys.append(q)

    lines = [{
        "hiryu_item_id": item["hiryu_item_id"], "item_qty": q, "sku_code": item["sku_code"],
        "units": q * item["units_per_sale"], "item_price": item["price"],
        "oos_instruction": None,
    } for item, q in zip(chosen, qtys)]

    missing_line = None
    if missing:
        if forced:
            idx = next(k for k, i in enumerate(chosen) if i["hiryu_item_id"] == forced)
        else:
            idx = random.randrange(len(lines))
        target, item = lines[idx], chosen[idx]
        ins = {"type": missing.type}
        rep = None
        if missing.type == "replace":
            pool = [i for i in menu if i["sku_id"] != item["sku_id"] and i["stock"] > 0]
            if missing.replace_hiryu_item_id:
                rep = next((i for i in store["items"]
                            if i["hiryu_item_id"] == missing.replace_hiryu_item_id), None)
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
                        "sku_code": item["sku_code"], "instruction": missing.type,
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
            "preset": body.preset, "message": message, "missing_line": missing_line,
            "text": text}


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

