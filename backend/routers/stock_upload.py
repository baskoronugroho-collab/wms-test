"""Alur A, Option C — bulk stock upload from a CSV.

All-or-nothing per file (this matches the workflow's stated rule): every row
is validated first, and only if every row passes does the batch commit, using
the same ledger/slot machinery normal receiving uses (ledger.apply,
common.slot_for) so uploaded stock behaves exactly like a normal receipt.

Validation, per row of Hub name | barcode | brand | Product Name | input date
| LOCATION:
  - Hub name must match a site code.
  - brand + Product Name must match a row in product_default_locations (the
    brand/product/default-location master data) — this is what "not in the
    back end master data" refers to.
  - barcode must not already be registered in `barcodes` — one barcode is one
    physical/product identity, so a repeat would corrupt stock opname.
  - LOCATION, if given, must be a real location code at that site; if blank,
    the SKU's default location from product_default_locations is used.
"""
import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["stock upload"])

TEMPLATE_CSV = (
    "Hub name,barcode,brand,Product Name,input date,LOCATION\r\n"
    "MAC-UT5,2990000009001,Wardah Official Store,"
    "Glasting Liquid Lip 01 Caramel Coat,2026-09-04,\r\n"
)


@router.get("/stock-uploads/template")
async def download_template(user: auth.User = Depends(auth.current_user)):
    from fastapi.responses import Response
    return Response(
        content=TEMPLATE_CSV, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=stock-upload-template.csv"},
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


async def _validate_row(row_no: int, raw: dict) -> tuple[dict | None, str | None]:
    hub_name = _pick(raw, "hub name", "hub")
    barcode = _pick(raw, "barcode")
    brand_name = _pick(raw, "brand")
    product_name = _pick(raw, "product name", "product")
    input_date = _pick(raw, "input date", "date")
    location_raw = _pick(raw, "location")

    if not hub_name:
        return None, f"Baris {row_no}: Hub name kosong."
    if not barcode:
        return None, f"Baris {row_no}: barcode kosong."
    if not brand_name:
        return None, f"Baris {row_no}: brand kosong."
    if not product_name:
        return None, f"Baris {row_no}: Product Name kosong."

    site = await db.fetch_one(
        "SELECT id, code FROM sites WHERE code = %s AND active = 1", (hub_name,)
    )
    if not site:
        return None, f"Baris {row_no}: Hub '{hub_name}' tidak dikenal."

    existing_barcode = await db.fetch_one(
        "SELECT sku_id FROM barcodes WHERE barcode = %s", (barcode,)
    )
    if existing_barcode:
        return None, f"Baris {row_no}: barcode {barcode} sudah ada di data stok."

    brand = await db.fetch_one(
        "SELECT id, name FROM brands WHERE name = %s", (brand_name,)
    )
    if not brand:
        return None, f"Baris {row_no}: brand '{brand_name}' tidak ada di data induk."

    master = await db.fetch_one(
        "SELECT pdl.sku_id, pdl.default_location_code, s.name_display "
        "FROM product_default_locations pdl JOIN skus s ON s.id = pdl.sku_id "
        "WHERE pdl.brand_id = %s AND s.name_display = %s",
        (brand["id"], product_name),
    )
    if not master:
        return None, (
            f"Baris {row_no}: produk '{product_name}' ({brand_name}) "
            "tidak ada di data induk."
        )

    location_code = location_raw or master["default_location_code"]
    location = await db.fetch_one(
        "SELECT id, code FROM locations WHERE site_id = %s AND code = %s",
        (site["id"], location_code),
    )
    if not location:
        return None, f"Baris {row_no}: lokasi '{location_code}' tidak ditemukan di {hub_name}."

    return {
        "site_id": site["id"],
        "sku_id": master["sku_id"],
        "location_id": location["id"],
        "barcode": barcode,
        "input_date_raw": input_date,
        "location_was_blank": not bool(location_raw),
    }, None


@router.post("/stock-uploads", response_model=models.StockUploadResult)
async def upload_stock(
    file: UploadFile = File(...),
    user: auth.User = Depends(auth.current_user),
):
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    rows = list(reader)
    if not rows:
        raise HTTPException(400, "File kosong atau tidak terbaca.")

    parsed, errors = [], []
    seen_barcodes: set[str] = set()
    for i, raw_row in enumerate(rows, start=2):
        clean, err = await _validate_row(i, raw_row)
        if err:
            errors.append({"row_no": i, "message": err})
            continue
        if clean["barcode"] in seen_barcodes:
            errors.append({"row_no": i, "message": f"Baris {i}: barcode {clean['barcode']} duplikat di file ini."})
            continue
        seen_barcodes.add(clean["barcode"])
        parsed.append((i, clean))

    if errors:
        return {
            "ok": False, "upload_id": None, "rows_total": len(rows),
            "rows_committed": 0, "errors": errors,
            "message": f"Upload gagal: {len(errors)} baris bermasalah. Tidak ada yang disimpan.",
        }

    # Every row also needs write access to its site.
    for _, clean in parsed:
        await auth.assert_site_access(user, clean["site_id"])

    async with db.tx() as cur:
        upload_id = await db.run(
            cur,
            "INSERT INTO stock_uploads (filename, uploaded_by, row_count) VALUES (%s,%s,%s)",
            (file.filename, user.email, len(parsed)),
        )
        for row_no, clean in parsed:
            await db.run(
                cur,
                "INSERT INTO barcodes (barcode, sku_id, source, registered_by) "
                "VALUES (%s,%s,'bulk_upload',%s)",
                (clean["barcode"], clean["sku_id"], user.email),
            )

            slot = await common.slot_for(clean["site_id"], clean["sku_id"])
            if slot:
                location_id = slot["location_id"]
            else:
                basket = await db.one(
                    cur, "SELECT id FROM baskets WHERE location_id = %s",
                    (clean["location_id"],),
                )
                if not basket:
                    basket_id = await db.run(
                        cur,
                        "INSERT INTO baskets (location_id, site_id, basket_size) "
                        "VALUES (%s,%s,'M')",
                        (clean["location_id"], clean["site_id"]),
                    )
                else:
                    basket_id = basket["id"]
                await db.run(
                    cur,
                    "INSERT INTO slot_assignments "
                    "(site_id, sku_id, basket_id, created_by, created_during_inbound) "
                    "VALUES (%s,%s,%s,%s,1)",
                    (clean["site_id"], clean["sku_id"], basket_id, user.email),
                )
                location_id = clean["location_id"]

            site = await db.one(cur, "SELECT is_training FROM sites WHERE id = %s",
                                 (clean["site_id"],))
            await ledger.apply(
                cur, site_id=clean["site_id"], sku_id=clean["sku_id"],
                location_id=location_id, qty_delta=1, movement_type="receipt_in",
                actor_email=user.email, ref_type="stock_upload", ref_id=upload_id,
                scan_source="manual", is_training=bool(site["is_training"]),
            )

            await db.run(
                cur,
                "INSERT INTO stock_upload_rows "
                "(upload_id, row_no, site_id, sku_id, location_id, barcode, "
                " input_date_raw, location_was_blank) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (upload_id, row_no, clean["site_id"], clean["sku_id"], location_id,
                 clean["barcode"], clean["input_date_raw"], clean["location_was_blank"]),
            )
        await ledger.audit(
            cur, actor_email=user.email, entity="stock_upload", entity_id=upload_id,
            action="bulk_upload", after={"rows": len(parsed), "filename": file.filename},
        )

    return {
        "ok": True, "upload_id": upload_id, "rows_total": len(rows),
        "rows_committed": len(parsed), "errors": [],
        "message": f"Berhasil: {len(parsed)} baris disimpan.",
    }


@router.get("/stock-uploads", response_model=models.StockUploadBatchList)
async def list_uploads(user: auth.User = Depends(auth.current_user)):
    rows = await db.fetch_all(
        "SELECT id, filename, uploaded_by, row_count, created_at FROM stock_uploads "
        "ORDER BY created_at DESC LIMIT 200"
    )
    return {"uploads": [dict(r, created_at=str(r["created_at"])) for r in rows]}


@router.get("/stock-uploads/items", response_model=models.StockUploadItemList)
async def list_uploaded_items(
    site_id: int | None = None,
    upload_id: int | None = None,
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    user: auth.User = Depends(auth.current_user),
):
    where, params = ["1=1"], []
    if site_id:
        where.append("sur.site_id = %s")
        params.append(site_id)
    if upload_id:
        where.append("sur.upload_id = %s")
        params.append(upload_id)
    clause = " AND ".join(where)

    total = (await db.fetch_one(
        f"SELECT COUNT(*) AS n FROM stock_upload_rows sur WHERE {clause}", params
    ))["n"]
    rows = await db.fetch_all(
        f"SELECT sur.id, sur.upload_id, sur.row_no, si.code AS site_code, "
        "sur.barcode, b.name AS brand_name, s.name_display AS sku_name, "
        "l.code AS location_code, sur.location_was_blank, sur.input_date_raw, "
        "su.uploaded_by, sur.created_at "
        "FROM stock_upload_rows sur "
        "JOIN sites si ON si.id = sur.site_id "
        "JOIN skus s ON s.id = sur.sku_id "
        "JOIN brands b ON b.id = s.brand_id "
        "JOIN locations l ON l.id = sur.location_id "
        "JOIN stock_uploads su ON su.id = sur.upload_id "
        f"WHERE {clause} ORDER BY sur.created_at DESC LIMIT %s OFFSET %s",
        params + [limit, offset],
    )
    return {
        "items": [dict(r, created_at=str(r["created_at"]),
                        location_was_blank=bool(r["location_was_blank"])) for r in rows],
        "total": total,
    }
