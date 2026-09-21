"""Photos: product photos uploaded by HQ, and photos a staffer takes of a
product the WMS does not know.

The platform's object-storage bucket is private, so the browser never gets a
bucket URL: photos are written here and served back through GET /api/photos/…
behind the same sign-in as the rest of the app.

Without OBJECT_STORAGE_BUCKET (local dev) photos go to a local folder instead,
so the flow still runs end to end.
"""
import asyncio
import os
import pathlib
import re
import uuid

from fastapi import HTTPException, UploadFile

MAX_BYTES = 8 * 1024 * 1024
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
KEY_RE = re.compile(r"^(sku|request)/[A-Za-z0-9._-]{1,120}$")

_LOCAL = pathlib.Path(os.getenv("PHOTO_DIR", "/tmp/wms-photos"))
_bucket = None


def _gcs():
    global _bucket
    name = os.getenv("OBJECT_STORAGE_BUCKET", "").strip()
    if not name:
        return None
    if _bucket is None:
        from google.cloud import storage  # imported lazily: dev runs without it
        _bucket = storage.Client().bucket(name)
    return _bucket


async def save(prefix: str, file: UploadFile) -> str:
    """Store an uploaded image and return its key, e.g. `sku/42-9f1c.jpg`."""
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = TYPES.get(ctype)
    if not ext:
        raise HTTPException(415, "Foto harus JPG, PNG atau WEBP. / Photo must be JPG, PNG or WEBP.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Foto kosong. / The photo is empty.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Foto lebih dari 8 MB. / The photo is over 8 MB.")

    key = f"{prefix}-{uuid.uuid4().hex[:10]}.{ext}"
    if not KEY_RE.match(key):
        raise HTTPException(400, "Invalid photo key")
    bucket = _gcs()
    if bucket is not None:
        blob = bucket.blob("photos/" + key)
        # The client library is blocking; keep it off the event loop.
        await asyncio.to_thread(blob.upload_from_string, data, content_type=ctype)
    else:
        path = _LOCAL / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return key


async def load(key: str) -> tuple[bytes, str]:
    if not KEY_RE.match(key or ""):
        raise HTTPException(404, "Photo not found")
    ctype = next((t for t, e in TYPES.items() if key.endswith("." + e)), "application/octet-stream")
    bucket = _gcs()
    if bucket is not None:
        blob = bucket.blob("photos/" + key)
        if not await asyncio.to_thread(blob.exists):
            raise HTTPException(404, "Photo not found")
        return await asyncio.to_thread(blob.download_as_bytes), ctype
    path = _LOCAL / key
    if not path.is_file():
        raise HTTPException(404, "Photo not found")
    return path.read_bytes(), ctype
