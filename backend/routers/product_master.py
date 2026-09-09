"""Admin Page — superadmin curation of the brand/product master data
(product_default_locations) that bulk stock upload cross-checks against.

Deliberately separate from the Alur flow cards and gated to the admin role:
this data feeds every future stock upload, so only an admin curates it.

No location here: a location code embeds its hub's own prefix
(TRN-A-1-01, UT5-A-3-02, ...), so a single "default" per product can never be
valid across multiple hubs. LOCATION is a required column on stock upload
instead — this table only confirms a brand + product name pair is real.

There is nothing to edit, either — brand and product name live on the shared
`skus`/`brands` tables that every other flow (receiving, picking, opname)
also reads, so renaming a SKU from here would rename it everywhere. To fix a
wrong brand/product, delete the row and re-upload it.
"""
import csv
import io
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

import auth
import db
import ledger
import models

router = APIRouter(prefix="/api/admin/product-master", tags=["admin master data"])

TEMPLATE_CSV = (
    "brand,product name\r\n"
    "Wardah Official Store,Glasting Liquid Lip 01 Caramel Coat\r\n"
)


@router.get("/template")
async def download_template(user: auth.User = Depends(auth.require("admin"))):
    return Response(
        content=TEMPLATE_CSV, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=product-master-template.csv"},
    )


def _pick(row: dict, *names) -> str | None:
    for key, val in row.items():
        if not key:
            continue
        k = key.strip().lower()
        for n in names:
            if n in k:
                return (val or "").strip() or None
    return None


@router.post("/import", response_model=models.ProductMasterImportResult)
async def import_master(
    file: UploadFile = File(...),
    user: auth.User = Depends(auth.require("admin")),
):
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "File kosong atau tidak terbaca.")

    results, ok_count = [], 0
    async with db.tx() as cur:
        for i, raw_row in enumerate(rows, start=2):
            brand_name = _pick(raw_row, "brand")
            product_name = _pick(raw_row, "product name", "product")

            if not brand_name or not product_name:
                results.append({"row_no": i, "ok": False,
                                 "message": "brand atau product name kosong."})
                continue

            brand = await db.one(cur, "SELECT id FROM brands WHERE name = %s", (brand_name,))
            if not brand:
                code = re.sub(r"[^A-Za-z0-9]+", "-", brand_name).upper()[:32]
                brand_id = await db.run(
                    cur, "INSERT INTO brands (code, name) VALUES (%s,%s)",
                    (code, brand_name),
                )
            else:
                brand_id = brand["id"]

            sku = await db.one(
                cur, "SELECT id FROM skus WHERE brand_id = %s AND name_display = %s",
                (brand_id, product_name),
            )
            if not sku:
                sku_code = re.sub(r"[^A-Za-z0-9]+", "-", product_name).upper()[:48]
                sku_id = await db.run(
                    cur,
                    "INSERT INTO skus (brand_id, brand_sku_code, name_display) "
                    "VALUES (%s,%s,%s)",
                    (brand_id, sku_code, product_name),
                )
            else:
                sku_id = sku["id"]

            await db.run(
                cur,
                "INSERT INTO product_default_locations (brand_id, sku_id) "
                "VALUES (%s,%s) ON DUPLICATE KEY UPDATE sku_id = VALUES(sku_id)",
                (brand_id, sku_id),
            )
            results.append({"row_no": i, "ok": True, "message": "Tersimpan."})
            ok_count += 1

        await ledger.audit(
            cur, actor_email=user.email, entity="product_default_location", entity_id=None,
            action="bulk_import", after={"rows": ok_count, "filename": file.filename},
        )

    return {
        "rows_total": len(rows), "rows_saved": ok_count,
        "results": results,
        "message": f"{ok_count} dari {len(rows)} baris tersimpan.",
    }


@router.get("", response_model=models.ProductMasterList)
async def list_master(
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    user: auth.User = Depends(auth.require("admin")),
):
    where, params = ["1=1"], []
    if q:
        where.append("(b.name LIKE %s OR s.name_display LIKE %s)")
        params += [f"%{q}%", f"%{q}%"]
    clause = " AND ".join(where)

    total = (await db.fetch_one(
        f"SELECT COUNT(*) AS n FROM product_default_locations pdl "
        f"JOIN brands b ON b.id = pdl.brand_id JOIN skus s ON s.id = pdl.sku_id "
        f"WHERE {clause}", params,
    ))["n"]
    rows = await db.fetch_all(
        f"SELECT pdl.id, b.name AS brand_name, s.name_display AS product_name, "
        "pdl.created_at "
        "FROM product_default_locations pdl "
        "JOIN brands b ON b.id = pdl.brand_id JOIN skus s ON s.id = pdl.sku_id "
        f"WHERE {clause} ORDER BY b.name, s.name_display LIMIT %s OFFSET %s",
        params + [limit, offset],
    )
    return {
        "items": [dict(r, created_at=str(r["created_at"])) for r in rows],
        "total": total,
    }


@router.get("/export")
async def export_master(user: auth.User = Depends(auth.require("admin"))):
    rows = await db.fetch_all(
        "SELECT b.name AS brand_name, s.name_display AS product_name "
        "FROM product_default_locations pdl "
        "JOIN brands b ON b.id = pdl.brand_id JOIN skus s ON s.id = pdl.sku_id "
        "ORDER BY b.name, s.name_display"
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["brand", "product name"])
    for r in rows:
        w.writerow([r["brand_name"], r["product_name"]])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=product-master.csv"},
    )


@router.post("/delete", response_model=models.Ok)
async def delete_master(
    body: models.ProductMasterDeleteIn,
    user: auth.User = Depends(auth.require("admin")),
):
    if not body.ids:
        raise HTTPException(400, "Pilih minimal satu baris.")
    async with db.tx() as cur:
        await db.run(
            cur, f"DELETE FROM product_default_locations WHERE id IN ({db.placeholders(body.ids)})",
            body.ids,
        )
        await ledger.audit(
            cur, actor_email=user.email, entity="product_default_location", entity_id=None,
            action="bulk_delete", after={"ids": body.ids},
        )
    return {"ok": True, "message": f"{len(body.ids)} baris dihapus."}
