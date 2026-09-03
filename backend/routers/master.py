"""M1 — Brand & SKU master, and barcode registration."""
import csv
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["master data"])


@router.get("/brands", response_model=list[models.Brand])
async def list_brands(user: auth.User = Depends(auth.current_user)):
    rows = await db.fetch_all(
        "SELECT id, code, name, identity_mode, active FROM brands ORDER BY name"
    )
    return [dict(r, active=bool(r["active"])) for r in rows]


@router.post("/brands", response_model=models.Brand, status_code=201)
async def create_brand(
    body: models.BrandIn, user: auth.User = Depends(auth.require("admin"))
):
    if body.identity_mode not in ("sku_barcode", "unit_label"):
        raise HTTPException(400, "identity_mode must be sku_barcode or unit_label")
    async with db.tx() as cur:
        try:
            bid = await db.run(
                cur,
                "INSERT INTO brands (code, name, identity_mode) VALUES (%s,%s,%s)",
                (body.code, body.name, body.identity_mode),
            )
        except Exception:
            raise HTTPException(409, f"Brand code {body.code} already exists")
        await ledger.audit(
            cur, actor_email=user.email, entity="brand", entity_id=bid,
            action="create", after=body.model_dump(),
        )
    return {
        "id": bid, "code": body.code, "name": body.name,
        "identity_mode": body.identity_mode, "active": True,
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
    body: models.SkuIn, user: auth.User = Depends(auth.require("admin"))
):
    brand = await db.fetch_one(
        "SELECT id, identity_mode FROM brands WHERE id = %s", (body.brand_id,)
    )
    if not brand:
        raise HTTPException(404, "Brand not found")
    mode = body.identity_mode or brand["identity_mode"]
    async with db.tx() as cur:
        sku_id = await db.run(
            cur,
            "INSERT INTO skus (brand_id, brand_sku_code, name_display, category, "
            "product_line, unit_size, price_idr, unit_cube_cm3, expiry_tier, "
            "identity_mode, label_placement_note) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.brand_id, body.brand_sku_code, body.name_display, body.category,
             body.product_line, body.unit_size, body.price_idr, body.unit_cube_cm3,
             body.expiry_tier, mode, body.label_placement_note),
        )
        await ledger.audit(cur, actor_email=user.email, entity="sku",
                           entity_id=sku_id, action="create", after=body.model_dump())
    return common.sku_dict(await common.sku_by_id(sku_id))


@router.post("/skus/import", response_model=models.Ok)
async def import_skus(
    brand_id: int = Query(...),
    commit: bool = Query(default=False),
    file: UploadFile = File(...),
    user: auth.User = Depends(auth.require("admin")),
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
        raise HTTPException(400, "No usable rows found in the file.")
    if not commit:
        return {"ok": True,
                "message": f"Preview: {len(parsed)} rows ready, {len(errors)} errors. "
                           f"Re-send with commit=true to import."}

    inserted = 0
    async with db.tx() as cur:
        brand = await db.one(cur, "SELECT identity_mode FROM brands WHERE id = %s",
                             (brand_id,))
        if not brand:
            raise HTTPException(404, "Brand not found")
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
    return {"ok": True, "message": f"Imported {inserted} SKUs."}


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
        raise HTTPException(404, "SKU not found")

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
        raise HTTPException(404, "Barcode not registered")
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM barcodes WHERE id = %s", (row["id"],))
        await ledger.audit(
            cur, actor_email=user.email, entity="barcode", entity_id=row["sku_id"],
            action="unbind", before=dict(row), after={"reason": reason},
        )
    return {"ok": True, "message": f"{barcode} unbound."}
