"""M1 — Brand & SKU master, and barcode registration."""
import csv
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

import auth
import common
import db
import ledger
import models
from routers import reminders

router = APIRouter(prefix="/api", tags=["master data"])


@router.get("/brands", response_model=list[models.Brand])
async def list_brands(user: auth.User = Depends(auth.current_user)):
    rows = await db.fetch_all(
        "SELECT id, code, name, identity_mode, active, default_stock_owner "
        "FROM brands ORDER BY name"
    )
    return [dict(r, active=bool(r["active"])) for r in rows]


@router.patch("/brands/{brand_id}", response_model=models.Brand)
async def update_brand(
    brand_id: int, body: models.BrandPatch,
    user: auth.User = Depends(auth.require("hq")),
):
    """Rename a brand or change who owns its stock.

    The owner is stamped on every movement from the next one on; history keeps
    the owner it was written with, which is what an audit needs.
    """
    if body.default_stock_owner is not None and body.default_stock_owner not in ("grab", "brand", "ninja"):
        raise HTTPException(400, "Pemilik stok harus grab, brand atau ninja. / default_stock_owner must be grab, brand or ninja.")
    before = await db.fetch_one("SELECT * FROM brands WHERE id = %s", (brand_id,))
    if not before:
        raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
    sets, params = [], []
    for col in ("name", "default_stock_owner"):
        val = getattr(body, col)
        if val is not None:
            sets.append(f"{col} = %s")
            params.append(val)
    if body.active is not None:
        sets.append("active = %s")
        params.append(1 if body.active else 0)
    if sets:
        async with db.tx() as cur:
            await db.run(cur, "UPDATE brands SET " + ", ".join(sets) + " WHERE id = %s",
                         (*params, brand_id))
            await ledger.audit(cur, actor_email=user.email, entity="brand",
                               entity_id=brand_id, action="update",
                               after=body.model_dump(exclude_none=True))
    row = await db.fetch_one(
        "SELECT id, code, name, identity_mode, active, default_stock_owner "
        "FROM brands WHERE id = %s", (brand_id,))
    return dict(row, active=bool(row["active"]))


@router.post("/brands", response_model=models.Brand, status_code=201)
async def create_brand(
    body: models.BrandIn, user: auth.User = Depends(auth.require("hq"))
):
    if body.identity_mode not in ("sku_barcode", "unit_label"):
        raise HTTPException(400, "Mode identitas harus sku_barcode atau unit_label. / identity_mode must be sku_barcode or unit_label.")
    if body.default_stock_owner not in ("grab", "brand", "ninja"):
        raise HTTPException(400, "Pemilik stok harus grab, brand atau ninja. / default_stock_owner must be grab, brand or ninja.")
    async with db.tx() as cur:
        try:
            bid = await db.run(
                cur,
                "INSERT INTO brands (code, name, identity_mode, default_stock_owner) "
                "VALUES (%s,%s,%s,%s)",
                (body.code, body.name, body.identity_mode, body.default_stock_owner),
            )
        except Exception:
            raise HTTPException(409, f"Kode merek {body.code} sudah ada. / Brand code {body.code} already exists.")
        await ledger.audit(
            cur, actor_email=user.email, entity="brand", entity_id=bid,
            action="create", after=body.model_dump(),
        )
    return {
        "id": bid, "code": body.code, "name": body.name,
        "identity_mode": body.identity_mode, "active": True,
        "default_stock_owner": body.default_stock_owner,
    }


@router.get("/skus", response_model=models.SkuList)
async def list_skus(
    brand_id: int | None = None,
    q: str | None = None,
    site_id: int | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    user: auth.User = Depends(auth.current_user),
):
    where, params = ["s.active = 1"], []
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    if q:
        where.append("(s.name_display LIKE %s OR s.brand_sku_code LIKE %s)")
        params += [f"%{q}%", f"%{q}%"]
    clause = " AND ".join(where)

    total = (await db.fetch_one(
        f"SELECT COUNT(*) AS n FROM skus s WHERE {clause}", params
    ))["n"]
    rows = await db.fetch_all(
        f"SELECT {common.SKU_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
        f"WHERE {clause} ORDER BY s.name_display LIMIT %s OFFSET %s",
        params + [limit, offset],
    )
    return {"skus": [common.sku_dict(r) for r in rows], "total": total}


@router.post("/skus", response_model=models.Sku, status_code=201)
async def create_sku(
    body: models.SkuIn, user: auth.User = Depends(auth.require("hq"))
):
    """Register a SKU once for every hub.

    The thresholds are asked for here, not later: a SKU without a restock point
    never raises a replenishment alert, and nobody goes back to fill 118 of them
    in. Each hub copies them onto its own pick face when the SKU gets a rack there.
    Until Ops HQ sets real numbers, R defaults to 25% of the full level P.
    """
    if body.default_restock_point is None:
        body.default_restock_point = await reminders.default_restock(body.default_full_threshold)
    if body.default_restock_point is None or body.default_restock_point < 0:
        raise HTTPException(422, "Isi batas penuh (P), titik restock otomatis 25% darinya. "
                                 "Atau isi titik restock (R). / Enter the full level P (the "
                                 "restock point defaults to 25% of it) or the restock point R.")
    if (body.default_full_threshold is not None
            and body.default_full_threshold <= body.default_restock_point):
        raise HTTPException(
            422, "Batas penuh harus lebih besar dari batas restock. / The full threshold must "
                 "be above the restock point.")
    if body.default_safety_stock is not None and not (
            0 <= body.default_safety_stock <= body.default_restock_point):
        raise HTTPException(
            422, "Safety stock harus di antara 0 dan titik restock. / Safety stock must be "
                 "between 0 and the restock point.")
    code = (body.brand_sku_code or "").strip()
    name = (body.name_display or "").strip()
    if not code or not name:
        raise HTTPException(422, "Kode SKU dan nama produk wajib diisi. / The SKU code and product name are required.")
    if await db.fetch_one("SELECT id FROM skus WHERE brand_id = %s AND brand_sku_code = %s",
                          (body.brand_id, code)):
        raise HTTPException(409, f"Kode SKU {code} sudah ada untuk merek ini. / SKU code {code} already exists for this brand.")
    brand = await db.fetch_one(
        "SELECT id, identity_mode FROM brands WHERE id = %s", (body.brand_id,)
    )
    if not brand:
        raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
    mode = body.identity_mode or brand["identity_mode"]
    async with db.tx() as cur:
        sku_id = await db.run(
            cur,
            "INSERT INTO skus (brand_id, brand_sku_code, name_display, category, "
            "product_line, unit_size, price_idr, unit_cube_cm3, expiry_tier, "
            "identity_mode, label_placement_note, default_restock_point, "
            "default_full_threshold, default_safety_stock) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.brand_id, code, name, body.category,
             body.product_line, body.unit_size, body.price_idr, body.unit_cube_cm3,
             body.expiry_tier, mode, body.label_placement_note,
             body.default_restock_point, body.default_full_threshold,
             body.default_safety_stock),
        )
        await ledger.audit(cur, actor_email=user.email, entity="sku",
                           entity_id=sku_id, action="create", after=body.model_dump())
    return common.sku_dict(await common.sku_by_id(sku_id))


@router.post("/skus/import", response_model=models.Ok)
async def import_skus(
    brand_id: int = Query(...),
    commit: bool = Query(default=False),
    file: UploadFile = File(...),
    user: auth.User = Depends(auth.require("hq")),
):
    """Bulk import from CSV. Preview by default; pass commit=true to apply.

    Column names are matched loosely rather than pinned to one file's exact
    shape — the Wardah source is an OCR artefact with a trailing formula row and
    no stable SKU-code column, and hard-coding it would contradict G5 (onboarding
    a brand should be configuration, not code).
    """
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))

    def pick(row: dict, *names) -> str | None:
        for key, val in row.items():
            if not key:
                continue
            k = key.strip().lower()
            for n in names:
                if n in k:
                    return (val or "").strip() or None
        return None

    def digits(v):
        if not v:
            return None
        d = re.sub(r"[^0-9]", "", str(v))
        return int(d) if d else None

    parsed, errors = [], []
    for i, row in enumerate(reader, start=2):
        name = pick(row, "product name", "name_display", "nama")
        if not name or name.startswith("="):
            continue  # blank line, or a spreadsheet formula that survived export
        code = pick(row, "sku code", "brand_sku_code", "kode")
        if not code:
            code = re.sub(r"[^A-Za-z0-9]+", "-", name).upper()[:48]
        parsed.append({
            "brand_sku_code": code,
            "name_display": name,
            "category": pick(row, "category", "kategori"),
            "product_line": pick(row, "product line", "line"),
            "unit_size": pick(row, "unit size", "size", "ukuran"),
            "price_idr": digits(pick(row, "price", "harga")),
            "unit_cube_cm3": digits(pick(row, "cube", "cbm", "volume")),
        })

    if not parsed:
        raise HTTPException(400, "Tidak ada baris yang bisa dipakai di file ini. / No usable rows found in the file.")
    if not commit:
        return {"ok": True,
                "message": f"Pratinjau: {len(parsed)} baris siap, {len(errors)} salah. "
                           f"Kirim lagi dengan commit=true untuk impor. / "
                           f"Preview: {len(parsed)} rows ready, {len(errors)} errors. "
                           f"Re-send with commit=true to import."}

    inserted = 0
    async with db.tx() as cur:
        brand = await db.one(cur, "SELECT identity_mode FROM brands WHERE id = %s",
                             (brand_id,))
        if not brand:
            raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
        for p in parsed:
            await db.run(
                cur,
                "INSERT INTO skus (brand_id, brand_sku_code, name_display, category, "
                "product_line, unit_size, price_idr, unit_cube_cm3, identity_mode) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE name_display = VALUES(name_display), "
                "category = VALUES(category), product_line = VALUES(product_line), "
                "unit_size = VALUES(unit_size), price_idr = VALUES(price_idr), "
                "unit_cube_cm3 = VALUES(unit_cube_cm3)",
                (brand_id, p["brand_sku_code"], p["name_display"], p["category"],
                 p["product_line"], p["unit_size"], p["price_idr"],
                 p["unit_cube_cm3"], brand["identity_mode"]),
            )
            inserted += 1
        await ledger.audit(cur, actor_email=user.email, entity="sku", entity_id=None,
                           action="bulk_import", after={"brand_id": brand_id,
                                                        "rows": inserted})
    return {"ok": True, "message": f"{inserted} SKU diimpor. / Imported {inserted} SKUs."}


# --- barcode registration (M1.3) -------------------------------------------

@router.get("/barcodes/check", response_model=models.BarcodeCheck)
async def check_barcode(
    barcode: str,
    sku_id: int,
    user: auth.User = Depends(auth.current_user),
):
    """Live check while a staffer bulk-scans under one locked SKU.

    A repeated scan of the same barcode is the normal case — a carton of 40
    identical units — so it is 'already registered', not an error (M1.3.4).
    """
    existing = await db.fetch_one(
        "SELECT bc.sku_id, s.name_display FROM barcodes bc "
        "JOIN skus s ON s.id = bc.sku_id WHERE bc.barcode = %s",
        (barcode,),
    )
    if not existing:
        return {"barcode": barcode, "state": "new"}
    if existing["sku_id"] == sku_id:
        return {"barcode": barcode, "state": "already_this_sku"}
    return {
        "barcode": barcode,
        "state": "conflict",
        "conflict_sku_id": existing["sku_id"],
        "conflict_sku_name": existing["name_display"],
    }


@router.post("/barcodes/register", response_model=models.BarcodeRegisterResult)
async def register_barcodes(
    body: models.BarcodeRegisterIn,
    user: auth.User = Depends(auth.current_user),
):
    """Bind a batch of scanned barcodes to one pre-selected SKU.

    A barcode may resolve to exactly one SKU — enforced by the unique index, not
    only by this check (M1.3.7).
    """
    sku = await common.sku_by_id(body.sku_id)
    if not sku:
        raise HTTPException(404, "SKU tidak ditemukan. / SKU not found.")

    checks, to_add = [], []
    seen = set()
    for code in body.barcodes:
        code = code.strip()
        if not code or code in seen:
            continue
        seen.add(code)
        chk = await check_barcode(code, body.sku_id, user)
        checks.append(chk)
        if chk["state"] == "new":
            to_add.append(code)

    if not to_add:
        return {"registered": 0, "skipped": len(checks), "checks": checks}

    async with db.tx() as cur:
        for code in to_add:
            await db.run(
                cur,
                "INSERT INTO barcodes (barcode, sku_id, source, registered_by) "
                "VALUES (%s,%s,'manufacturer',%s)",
                (code, body.sku_id, user.email),
            )
        await ledger.audit(
            cur, actor_email=user.email, entity="barcode", entity_id=body.sku_id,
            action="register", after={"sku_id": body.sku_id, "barcodes": to_add},
        )
    return {
        "registered": len(to_add),
        "skipped": len(checks) - len(to_add),
        "checks": checks,
    }


@router.delete("/barcodes/{barcode}", response_model=models.Ok)
async def unbind_barcode(
    barcode: str,
    reason: str = Query(...),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Unbinding DELETEs the row and writes the audit trail (PRD §11)."""
    row = await db.fetch_one(
        "SELECT id, sku_id FROM barcodes WHERE barcode = %s", (barcode,)
    )
    if not row:
        raise HTTPException(404, "Barcode belum terdaftar. / Barcode not registered.")
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM barcodes WHERE id = %s", (row["id"],))
        await ledger.audit(
            cur, actor_email=user.email, entity="barcode", entity_id=row["sku_id"],
            action="unbind", before=dict(row), after={"reason": reason},
        )
    return {"ok": True, "message": f"Barcode {barcode} dilepas. / Barcode {barcode} unbound."}


# --- Produk, tab Merek (canvas 2d) -----------------------------------------------------
#
# The brand is the one catalogue item typed in the WMS; stores, menus and SKUs come
# from Hiryu. One store sells one brand. Each brand sits on a Grab merchant account:
# its own (Grab asks at least 10 SKUs), or Ninja Van's acting as Nemu Mart (for a
# brand with fewer than 10 SKUs). Every role may look; Ops HQ adds and edits.

GRAB_ACCOUNTS = {"own": "Merek sendiri", "ninja": "Ninja Van (Nemu Mart)"}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class CatalogBrandIn(BaseModel):
    name: str = Field(description="Nama merek, the same as in Hiryu and Grab")
    company: str | None = Field(default=None, description="Perusahaan")
    restock_email: str | None = Field(default=None, description="Email kontak restock")
    has_barcodes: bool | None = Field(default=None, description="Kemasan punya barcode")
    grab_account: str | None = Field(default=None, description="own | ninja")


class CatalogBrandPatch(BaseModel):
    name: str | None = None
    company: str | None = None
    restock_email: str | None = None
    has_barcodes: bool | None = None
    grab_account: str | None = None
    active: bool | None = None


class CatalogBrand(BaseModel):
    id: int
    code: str
    name: str
    company: str | None = None
    restock_email: str | None = None
    has_barcodes: bool | None = None
    grab_account: str | None = Field(default=None, description="own | ninja | null")
    grab_account_text: str | None = None
    active: bool
    stores: int = Field(description="Hiryu stores selling this brand")
    store_names: list[str] = Field(default_factory=list)
    skus: int


class CatalogBrandList(BaseModel):
    brands: list[CatalogBrand]
    grab_accounts: dict[str, str]
    can_edit: bool
    note: str


async def _brand_rows(where: str = "1=1", params: tuple = ()) -> list[dict]:
    rows = await db.fetch_all(
        "SELECT b.id, b.code, b.name, b.company, b.restock_email, b.has_barcodes, "
        "       b.grab_account, b.active, "
        "       (SELECT COUNT(*) FROM skus s WHERE s.brand_id = b.id AND s.active = 1) AS skus "
        f"FROM brands b WHERE {where} ORDER BY b.active DESC, b.name", params)
    stores = await db.fetch_all(
        "SELECT brand_id, store_name FROM hiryu_stores WHERE active = 1 ORDER BY store_name")
    by_brand: dict[int, list[str]] = {}
    for st in stores:
        by_brand.setdefault(st["brand_id"], []).append(st["store_name"])
    out = []
    for r in rows:
        names = by_brand.get(r["id"], [])
        out.append({
            "id": r["id"], "code": r["code"], "name": r["name"], "company": r["company"],
            "restock_email": r["restock_email"],
            "has_barcodes": None if r["has_barcodes"] is None else bool(r["has_barcodes"]),
            "grab_account": r["grab_account"],
            "grab_account_text": GRAB_ACCOUNTS.get(r["grab_account"] or ""),
            "active": bool(r["active"]), "stores": len(names), "store_names": names,
            "skus": int(r["skus"] or 0),
        })
    return out


def _check_brand_fields(body) -> None:
    if body.grab_account is not None and body.grab_account not in GRAB_ACCOUNTS:
        raise HTTPException(422, "Akun merchant Grab: own (merek sendiri) atau ninja (Ninja "
                                 "Van, Nemu Mart). / Grab account must be own or ninja.")
    if body.restock_email and not _EMAIL.match(body.restock_email.strip()):
        raise HTTPException(422, "Email kontak restock tidak benar. / The restock e-mail is "
                                 "not valid.")


async def _new_brand_code(name: str) -> str:
    base = re.sub(r"[^A-Z0-9]", "", name.upper())[:8] or "MEREK"
    code, n = base, 1
    while await db.fetch_one("SELECT id FROM brands WHERE code = %s", (code,)):
        n += 1
        code = f"{base[:6]}{n}"
    return code


@router.get("/catalog/brands", response_model=CatalogBrandList, tags=["produk"])
async def catalog_brands(user: auth.User = Depends(auth.current_user)):
    """Merek list: Grab account, barcodes, stores and SKUs per brand."""
    return {"brands": await _brand_rows(), "grab_accounts": GRAB_ACCOUNTS,
            "can_edit": user.at_least("hq"),
            "note": "Tambah merek sebelum tokonya dibuat di Hiryu. Satu toko untuk satu merek. "
                    "Saat toko baru masuk dari Hiryu, WMS bertanya sekali mereknya; akun "
                    "merchant Grab terisi dari merek. / Add the brand before its store is created in Hiryu. "
                    "One store per brand. When a new store arrives from Hiryu, the WMS asks "
                    "for its brand once; the Grab merchant account fills in from the brand."}


@router.post("/catalog/brands", response_model=CatalogBrand, status_code=201, tags=["produk"])
async def catalog_add_brand(body: CatalogBrandIn, user: auth.User = Depends(auth.require("hq"))):
    """Tambah merek. Name and Grab merchant account are required."""
    name = (body.name or "").strip()
    if not name or len(name) > 160:
        raise HTTPException(422, "Nama merek wajib diisi. / The brand name is required.")
    if not body.grab_account:
        raise HTTPException(422, "Pilih akun merchant Grab. / Choose the Grab merchant account.")
    _check_brand_fields(body)
    if await db.fetch_one("SELECT id FROM brands WHERE LOWER(name) = LOWER(%s)", (name,)):
        raise HTTPException(409, f"Merek {name} sudah ada. / Brand {name} already exists.")
    code = await _new_brand_code(name)
    async with db.tx() as cur:
        bid = await db.run(
            cur, "INSERT INTO brands (code, name, identity_mode, default_stock_owner, company, "
                 "restock_email, has_barcodes, grab_account) "
                 "VALUES (%s,%s,'sku_barcode','brand',%s,%s,%s,%s)",
            (code, name, (body.company or "").strip() or None,
             (body.restock_email or "").strip() or None,
             None if body.has_barcodes is None else (1 if body.has_barcodes else 0),
             body.grab_account))
        await ledger.audit(cur, actor_email=user.email, entity="brand", entity_id=bid,
                           action="create", after=body.model_dump())
    return (await _brand_rows("b.id = %s", (bid,)))[0]


@router.patch("/catalog/brands/{brand_id}", response_model=CatalogBrand, tags=["produk"])
async def catalog_edit_brand(brand_id: int, body: CatalogBrandPatch,
                             user: auth.User = Depends(auth.require("hq"))):
    """Change a brand. A new Grab account applies to every store of the brand."""
    before = await db.fetch_one("SELECT * FROM brands WHERE id = %s", (brand_id,))
    if not before:
        raise HTTPException(404, "Merek tidak ditemukan. / Brand not found.")
    _check_brand_fields(body)
    sets, params = [], []
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(422, "Nama merek wajib diisi. / The brand name is required.")
        if await db.fetch_one("SELECT id FROM brands WHERE LOWER(name) = LOWER(%s) AND id <> %s",
                              (name, brand_id)):
            raise HTTPException(409, f"Merek {name} sudah ada. / Brand {name} already exists.")
        data["name"] = name
    for col in ("name", "company", "restock_email", "grab_account"):
        if col in data:
            sets.append(f"{col} = %s")
            v = data[col]
            params.append(v.strip() or None if isinstance(v, str) else v)
    for col in ("has_barcodes", "active"):
        if col in data:
            sets.append(f"{col} = %s")
            params.append(None if data[col] is None else (1 if data[col] else 0))
    if sets:
        async with db.tx() as cur:
            await db.run(cur, "UPDATE brands SET " + ", ".join(sets) + " WHERE id = %s",
                         (*params, brand_id))
            await ledger.audit(cur, actor_email=user.email, entity="brand", entity_id=brand_id,
                               action="update", after=data)
    return (await _brand_rows("b.id = %s", (brand_id,)))[0]
