"""The signed Faktur and the differences raised at receiving (PRD §5.1 steps 8
and 9, §5.3.8, §4.4.6).

After the inbound, staff sign the Surat Jalan and the Faktur and hand the Faktur
to the SPV, who photographs or scans every page and uploads it here. Until then
a completed brand receipt is "waiting for the Faktur" (flagged to the SPV at
24 h, to Ops HQ at 48 h). Ops HQ reads the expiry dates off it (routers/
replenishment.py, *ED dari Faktur*); nobody types a date at the receiving bench.

A Faktur covers the delivery, not a batch: one AWB can be received in several
batches (several receipts), and the upload marks every completed batch of the
same replenishment as done.

If units differ, the SPV raises it to Ops HQ (*Ajukan selisih ke Ops HQ*):
extra units are the new path (they are in stock and belong to the brand; Ops HQ
settles the Faktur with the brand by email and closes the issue with the
outcome); short and damaged units are recorded here for Ops HQ as well, and
still go through the variance approval on the replenishment.

Files live in the app's private bucket (storage.py's client), under their own
`docs/faktur/` prefix, and are streamed back through the API behind the same
sign-in: the browser never gets a bucket URL.
"""
import asyncio
import re
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

import auth
import db
import ledger
import models
import storage

router = APIRouter(prefix="/api", tags=["faktur"])

MAX_BYTES = 10 * 1024 * 1024
MAX_FILES = 12
# Phone cameras may hand over HEIC; it is kept (the download opens it) even
# though not every browser can show it inline.
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
         "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf"}
KEY_RE = re.compile(r"^faktur/\d{1,12}-[0-9a-f]{12}\.(jpg|png|webp|heic|heif|pdf)$")
KINDS = ("extra", "short", "damaged", "other")
KIND_LABEL = {"extra": ("lebih", "extra"), "short": ("kurang", "short"),
              "damaged": ("rusak", "damaged"), "other": ("lainnya", "other")}


# --- storage: the same private bucket as the photos, its own prefix ---------------

async def _put(key: str, data: bytes, ctype: str) -> None:
    bucket = storage._gcs()
    if bucket is not None:
        blob = bucket.blob("docs/" + key)
        await asyncio.to_thread(blob.upload_from_string, data, content_type=ctype)
    else:
        path = storage._LOCAL / "docs" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


async def _load(key: str) -> bytes:
    if not KEY_RE.match(key or ""):
        raise HTTPException(404, "File tidak ditemukan. / File not found.")
    bucket = storage._gcs()
    if bucket is not None:
        blob = bucket.blob("docs/" + key)
        if not await asyncio.to_thread(blob.exists):
            raise HTTPException(404, "File tidak ditemukan. / File not found.")
        return await asyncio.to_thread(blob.download_as_bytes)
    path = storage._LOCAL / "docs" / key
    if not path.is_file():
        raise HTTPException(404, "File tidak ditemukan. / File not found.")
    return path.read_bytes()


def page_out(row: dict) -> dict:
    return {
        "id": row["id"], "receipt_id": row["receipt_id"],
        "replenishment_id": row.get("replenishment_id"),
        "content_type": row["content_type"], "file_name": row.get("file_name"),
        "size_bytes": row.get("size_bytes"), "page_no": row["page_no"],
        "uploaded_by": row["uploaded_by"], "uploaded_at": str(row["uploaded_at"]),
        "url": f"/api/faktur/{row['id']}/file",
    }


async def _receipt(receipt_id: int, user: auth.User) -> dict:
    row = await db.fetch_one("SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,))
    if not row:
        raise HTTPException(404, "Penerimaan tidak ditemukan. / Receipt not found.")
    await auth.assert_site_access(user, row["site_id"])
    return row


async def _pages(receipt: dict) -> dict:
    """The Faktur of the delivery this receipt belongs to (all its batches)."""
    if receipt.get("replenishment_id"):
        rows = await db.fetch_all(
            "SELECT * FROM faktur_documents WHERE receipt_id = %s OR replenishment_id = %s "
            "ORDER BY page_no, id", (receipt["id"], receipt["replenishment_id"]))
    else:
        rows = await db.fetch_all(
            "SELECT * FROM faktur_documents WHERE receipt_id = %s ORDER BY page_no, id",
            (receipt["id"],))
    return {
        "receipt_id": receipt["id"],
        "faktur_uploaded_at": str(receipt["faktur_uploaded_at"])
        if receipt.get("faktur_uploaded_at") else None,
        "faktur_uploaded_by": receipt.get("faktur_uploaded_by"),
        "pages": [page_out(r) for r in rows],
    }


# --- the Faktur -------------------------------------------------------------------

@router.post("/receipts/{receipt_id}/faktur", response_model=models.FakturPageList)
async def upload_faktur(
    receipt_id: int, files: list[UploadFile] = File(...),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """*Unggah Faktur*: every page of the signed Faktur, as photos or a PDF.

    Several files in one go, each up to 10 MB. Uploading again adds pages (a
    page forgotten the first time); the first upload is when the receipt
    stopped waiting.
    """
    receipt = await _receipt(receipt_id, user)
    if receipt["source_type"] != "from_brand":
        raise HTTPException(422, "Faktur hanya untuk kiriman brand. / "
                                 "A Faktur only comes with a brand delivery.")
    if receipt["status"] == "open":
        raise HTTPException(409, "Penerimaan masih berjalan. Selesaikan dulu, lalu unggah "
                                 "Faktur. / The receipt is still open. Finish it, then upload "
                                 "the Faktur.")
    if not files:
        raise HTTPException(422, "Pilih minimal satu foto atau PDF. / "
                                 "Choose at least one photo or PDF.")
    if len(files) > MAX_FILES:
        raise HTTPException(413, f"Paling banyak {MAX_FILES} file sekali unggah. / "
                                 f"At most {MAX_FILES} files per upload.")
    # Read and check every file before storing any, so a bad fifth page does not
    # leave four orphans in the bucket.
    ready = []
    for f in files:
        ctype = (f.content_type or "").split(";")[0].strip().lower()
        ext = TYPES.get(ctype)
        if not ext:
            raise HTTPException(415, f"{f.filename}: Faktur harus foto (JPG, PNG, WEBP, HEIC) "
                                     f"atau PDF. / {f.filename}: the Faktur must be a photo "
                                     "or a PDF.")
        data = await f.read(MAX_BYTES + 1)
        if not data:
            raise HTTPException(400, f"{f.filename}: file kosong. / {f.filename}: empty file.")
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f"{f.filename}: lebih dari 10 MB. / "
                                     f"{f.filename}: over 10 MB.")
        ready.append((data, ctype, ext, (f.filename or "")[:255] or None))

    rep_id = receipt.get("replenishment_id")
    stored = []
    for data, ctype, ext, name in ready:
        key = f"faktur/{receipt_id}-{uuid.uuid4().hex[:12]}.{ext}"
        await _put(key, data, ctype)
        stored.append((key, ctype, name, len(data)))

    async with db.tx() as cur:
        last = await db.one(
            cur, "SELECT COALESCE(MAX(page_no), 0) AS n FROM faktur_documents "
                 "WHERE receipt_id = %s" + (" OR replenishment_id = %s" if rep_id else ""),
            (receipt_id, rep_id) if rep_id else (receipt_id,))
        page = int(last["n"])
        for key, ctype, name, size in stored:
            page += 1
            await db.run(
                cur,
                "INSERT INTO faktur_documents (receipt_id, replenishment_id, site_id, "
                "storage_key, content_type, file_name, size_bytes, page_no, uploaded_by) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (receipt_id, rep_id, receipt["site_id"], key, ctype, name, size, page,
                 user.email))
        # The Faktur covers the whole delivery: every completed batch of it is done.
        if rep_id:
            await db.run(
                cur,
                "UPDATE inbound_receipts SET faktur_uploaded_at = NOW(), faktur_uploaded_by = %s "
                "WHERE faktur_uploaded_at IS NULL AND (id = %s OR "
                "      (replenishment_id = %s AND status <> 'open'))",
                (user.email, receipt_id, rep_id))
        else:
            await db.run(
                cur,
                "UPDATE inbound_receipts SET faktur_uploaded_at = NOW(), faktur_uploaded_by = %s "
                "WHERE faktur_uploaded_at IS NULL AND id = %s", (user.email, receipt_id))
        await ledger.audit(cur, actor_email=user.email, entity="receipt", entity_id=receipt_id,
                           action="faktur_upload",
                           after={"files": len(stored), "replenishment_id": rep_id})
    return await _pages(await db.fetch_one(
        "SELECT * FROM inbound_receipts WHERE id = %s", (receipt_id,)))


@router.get("/receipts/{receipt_id}/faktur", response_model=models.FakturPageList)
async def list_faktur(receipt_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    return await _pages(await _receipt(receipt_id, user))


@router.get("/faktur/{doc_id}/file")
async def faktur_file(doc_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Stream one Faktur file for viewing, behind the same sign-in."""
    doc = await db.fetch_one("SELECT * FROM faktur_documents WHERE id = %s", (doc_id,))
    if not doc:
        raise HTTPException(404, "File tidak ditemukan. / File not found.")
    await auth.assert_site_access(user, doc["site_id"])
    data = await _load(doc["storage_key"])
    name = re.sub(r'[^A-Za-z0-9._ -]', "_", doc.get("file_name") or f"faktur-{doc_id}")
    return Response(content=data, media_type=doc["content_type"],
                    headers={"Content-Disposition": f'inline; filename="{name}"',
                             "Cache-Control": "private, max-age=3600",
                             # Only the whitelisted types above are ever stored;
                             # never let a browser guess another one.
                             "X-Content-Type-Options": "nosniff"})


# --- differences raised to Ops HQ --------------------------------------------------

_ISSUE_SQL = (
    "SELECT fi.*, st.code AS site_code, s.name_display AS sku_name, s.brand_sku_code, "
    "       rp.reference AS replenishment_reference, b.name AS brand_name, "
    "       TIMESTAMPDIFF(HOUR, fi.raised_at, NOW()) AS age_hours "
    "FROM faktur_issues fi JOIN sites st ON st.id = fi.site_id "
    "JOIN inbound_receipts ir ON ir.id = fi.receipt_id "
    "LEFT JOIN brands b ON b.id = ir.brand_id "
    "LEFT JOIN skus s ON s.id = fi.sku_id "
    "LEFT JOIN replenishments rp ON rp.id = fi.replenishment_id ")


def _issue_out(r: dict) -> dict:
    ts = lambda k: str(r[k]) if r.get(k) else None
    return {
        "id": r["id"], "receipt_id": r["receipt_id"],
        "replenishment_id": r.get("replenishment_id"),
        "replenishment_reference": r.get("replenishment_reference"),
        "site_id": r["site_id"], "site_code": r.get("site_code"),
        "brand_name": r.get("brand_name"),
        "sku_id": r.get("sku_id"), "sku_name": r.get("sku_name"),
        "brand_sku_code": r.get("brand_sku_code"),
        "kind": r["kind"], "qty": r.get("qty"), "note": r.get("note"), "status": r["status"],
        "raised_by": r["raised_by"], "raised_at": ts("raised_at"),
        "settled_by": r.get("settled_by"), "settled_at": ts("settled_at"),
        "outcome": r.get("outcome"),
        "age_hours": int(r["age_hours"]) if r.get("age_hours") is not None else None,
    }


async def _issue(issue_id: int) -> dict:
    r = await db.fetch_one(_ISSUE_SQL + "WHERE fi.id = %s", (issue_id,))
    if not r:
        raise HTTPException(404, "Selisih tidak ditemukan. / Difference not found.")
    return _issue_out(r)


@router.post("/receipts/{receipt_id}/issues", response_model=models.FakturIssue,
             status_code=201)
async def raise_issue(
    receipt_id: int, body: models.FakturIssueIn,
    user: auth.User = Depends(auth.require("supervisor")),
):
    """*Ajukan selisih ke Ops HQ*: extra, short, damaged or other, with a note.

    Extra, short and damaged name the SKU and how many; extra and other need a
    note (what the Faktur says, what was agreed with the driver). One open
    issue per receipt, SKU and kind: raise it again after Ops HQ settles it.
    """
    receipt = await _receipt(receipt_id, user)
    if receipt["status"] == "open":
        raise HTTPException(409, "Penerimaan masih berjalan. Selesaikan dulu. / "
                                 "The receipt is still open. Finish it first.")
    kind = (body.kind or "").strip().lower()
    if kind not in KINDS:
        raise HTTPException(422, "Jenis selisih: lebih, kurang, rusak atau lainnya. / "
                                 "Kind: extra, short, damaged or other.")
    note = (body.note or "").strip()[:400] or None
    if kind != "other":
        if not body.sku_id or not body.qty:
            raise HTTPException(422, "Pilih produk dan jumlah unitnya. / "
                                     "Choose the product and how many units.")
    if kind in ("extra", "other") and not note:
        raise HTTPException(422, "Tulis catatan untuk Ops HQ. / Add a note for Ops HQ.")
    if body.sku_id:
        sku = await db.fetch_one("SELECT id, brand_id FROM skus WHERE id = %s", (body.sku_id,))
        if not sku or (receipt.get("brand_id") and sku["brand_id"] != receipt["brand_id"]):
            raise HTTPException(422, "Produk itu bukan dari brand kiriman ini. / "
                                     "That product is not from this delivery's brand.")
    dup = await db.fetch_one(
        "SELECT id FROM faktur_issues WHERE receipt_id = %s AND kind = %s AND status = 'open' "
        "AND COALESCE(sku_id, 0) = %s", (receipt_id, kind, body.sku_id or 0))
    if dup:
        raise HTTPException(409, "Selisih ini sudah diajukan dan belum diselesaikan Ops HQ. / "
                                 "This difference is already raised and not settled yet.")
    async with db.tx() as cur:
        issue_id = await db.run(
            cur,
            "INSERT INTO faktur_issues (receipt_id, replenishment_id, site_id, sku_id, kind, "
            "qty, note, raised_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (receipt_id, receipt.get("replenishment_id"), receipt["site_id"], body.sku_id,
             kind, body.qty, note, user.email))
        await ledger.audit(cur, actor_email=user.email, entity="faktur_issue",
                           entity_id=issue_id, action="raise",
                           after={"receipt_id": receipt_id, "kind": kind,
                                  "sku_id": body.sku_id, "qty": body.qty})
    return await _issue(issue_id)


@router.get("/faktur-issues", response_model=models.FakturIssueList)
async def list_issues(
    status: str = Query(default="open", pattern="^(open|settled|all)$"),
    site_id: int | None = None,
    receipt_id: int | None = None,
    replenishment_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=300),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Open differences first, oldest first: Ops HQ's list to settle, an SPV's
    own hubs' list to follow."""
    where, params = ["1=1"], []
    if status != "all":
        where.append("fi.status = %s")
        params.append(status)
    if site_id:
        await auth.assert_site_access(user, site_id)
        where.append("fi.site_id = %s")
        params.append(site_id)
    elif not user.at_least("hq"):
        where.append("fi.site_id IN (SELECT site_id FROM user_sites WHERE user_id = %s)")
        params.append(user.id)
    if receipt_id:
        where.append("fi.receipt_id = %s")
        params.append(receipt_id)
    if replenishment_id:
        where.append("fi.replenishment_id = %s")
        params.append(replenishment_id)
    rows = await db.fetch_all(
        _ISSUE_SQL + "WHERE " + " AND ".join(where) +
        " ORDER BY (fi.status = 'open') DESC, fi.raised_at ASC, fi.id ASC LIMIT %s",
        (*params, limit))
    return {"issues": [_issue_out(r) for r in rows]}


@router.post("/faktur-issues/{issue_id}/settle", response_model=models.FakturIssue)
async def settle_issue(
    issue_id: int, body: models.FakturSettleIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Ops HQ closes the difference with what was agreed with the brand (for
    extra units: the Faktur revised, or the units sent back, or kept at no
    charge). Nothing moves in stock here: extra units were received into stock
    at the bench, and short or damaged units follow the variance approval."""
    issue = await db.fetch_one("SELECT * FROM faktur_issues WHERE id = %s", (issue_id,))
    if not issue:
        raise HTTPException(404, "Selisih tidak ditemukan. / Difference not found.")
    if issue["status"] != "open":
        raise HTTPException(409, "Selisih ini sudah diselesaikan. / Already settled.")
    outcome = (body.outcome or "").strip()
    if not outcome:
        raise HTTPException(422, "Tulis hasilnya dengan brand. / "
                                 "Write the outcome agreed with the brand.")
    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE faktur_issues SET status = 'settled', settled_by = %s, settled_at = NOW(), "
            "outcome = %s WHERE id = %s AND status = 'open'",
            (user.email, outcome[:400], issue_id))
        await ledger.audit(cur, actor_email=user.email, entity="faktur_issue",
                           entity_id=issue_id, action="settle", after={"outcome": outcome[:400]})
    return await _issue(issue_id)
