"""Lengkapi data SKU: Ops HQ completes what Hiryu does not hold (PRD §2.2.6, §2.6).

SKUs now arrive from Hiryu with a code, a name and maybe a barcode. Before a hub
can give one a bin and the WMS can ask the brand for it, Ops HQ adds the bin
size, the stock numbers, the Grab buffer and whatever pack data the brand sent.

A SKU is **complete** when its bin size and *isi sampai* are set (§2.6.2). The
condition lives in one place, `INCOMPLETE_SQL`, so the Perlu tindakan list and
this page can never disagree about what is left to do.

Where each number lives (nothing new for the stock numbers; V26 adds the rest):

  isi sampai (P)             skus.default_full_threshold  slot_assignments.full_threshold
  pesan ulang saat sisa (R)  skus.default_restock_point   slot_assignments.restock_point
  batas kritis (S)           skus.default_safety_stock    slot_assignments.safety_stock
  cadangan Grab              skus.grab_buffer (NULL = alert_rules grab_buffer_default)

The SKU's own numbers are what a hub copies when the SKU gets a bin there
(locations.assign_slot). A hub whose numbers still equal the SKU's own ones
"follows" them, so a change here reaches it too; a hub that Ops HQ changed on
its own keeps its numbers, and is edited per hub through the registry's own
update path (registry.set_thresholds), not a second copy of that SQL.

R and S may be entered as a percentage of *isi sampai* (§4.5.3). The percentage
is stored beside the unit number, which every other flow keeps reading, and the
units are worked out again whenever *isi sampai* changes here: rounded up, and
never below 1 unit for R.
"""
import csv
import io
import math
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

import auth
import common
import db
import ledger
import models
from routers import master, racks, registry

router = APIRouter(prefix="/api/sku-complete", tags=["sku complete"])

# The one definition of "still to complete" (§2.6.2). Aliases: s = skus, b = brands.
INCOMPLETE_SQL = "(s.bin_size IS NULL OR s.default_full_threshold IS NULL)"
_BASE_WHERE = "s.active = 1 AND b.active = 1"

_COLS = (
    "s.id, s.brand_id, b.code AS brand_code, b.name AS brand_name, s.brand_sku_code, "
    "s.hiryu_sku_code, s.name_display, s.unit_size, s.category, s.photo_key, "
    "s.unit_cube_cm3, s.bin_size, s.bin_max, s.default_full_threshold, "
    "s.default_restock_point, s.default_restock_pct, s.default_safety_stock, "
    "s.default_safety_pct, s.grab_buffer, s.pack_length_mm, s.pack_width_mm, "
    "s.pack_height_mm, s.pack_weight_g, s.is_liquid, s.is_large_bottle"
)

# API field -> skus column, for the plain fields (the stock numbers are planned
# together in _plan because they depend on each other).
_PLAIN = {
    "brand_sku_code": "brand_sku_code",
    "bin_size": "bin_size",
    "bin_max": "bin_max",
    "grab_buffer": "grab_buffer",
    "pack_length_mm": "pack_length_mm",
    "pack_width_mm": "pack_width_mm",
    "pack_height_mm": "pack_height_mm",
    "pack_weight_g": "pack_weight_g",
    "is_liquid": "is_liquid",
    "is_large_bottle": "is_large_bottle",
}

# Column -> label on screen and in the CSV preview.
_LABEL = {
    "brand_sku_code": "Kode SKU brand",
    "bin_size": "Ukuran bin",
    "bin_max": "Isi maks. per bin",
    "default_full_threshold": "Isi sampai",
    "default_restock_point": "Pesan ulang saat sisa",
    "default_restock_pct": "Pesan ulang saat sisa (%)",
    "default_safety_stock": "Batas kritis",
    "default_safety_pct": "Batas kritis (%)",
    "grab_buffer": "Cadangan Grab",
    "pack_length_mm": "Panjang (mm)",
    "pack_width_mm": "Lebar (mm)",
    "pack_height_mm": "Tinggi (mm)",
    "pack_weight_g": "Berat (g)",
    "is_liquid": "Cair dalam botol",
    "is_large_bottle": "Botol besar",
    "unit_cube_cm3": "Volume unit (cm3)",
    "barcodes": "Barcode baru",
}


# --- settings ----------------------------------------------------------------

async def _rule(key: str) -> dict | None:
    return await db.fetch_one(
        "SELECT enabled, value_num FROM alert_rules WHERE rule_key = %s", (key,))


async def _restock_default_pct() -> int | None:
    """The share of isi sampai R fills in as (§4.5.2); None when switched off."""
    r = await _rule("restock_default_pct")
    if r is not None and not r["enabled"]:
        return None
    return int(r["value_num"]) if r and r["value_num"] else 25


async def _buffer_default() -> int:
    r = await _rule("grab_buffer_default")
    return int(r["value_num"]) if r and r["value_num"] is not None else 1


# --- reading -----------------------------------------------------------------

def _chunks(items: list, n: int = 500):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _suggest_size(r: dict) -> str | None:
    """A starting bin size from what is known about the pack (§2.6: suggested).

    A large bottle goes in a large bin. Otherwise the space model's volume check,
    sized for what one bin must hold. Nothing known, nothing suggested: a guess
    presented as a suggestion is worse than an empty box.
    """
    if r.get("is_large_bottle"):
        return "L"
    if not r.get("unit_cube_cm3"):
        return None
    hold = r.get("bin_max") or r.get("default_full_threshold") or 15
    size, _ = common.recommend_basket(r["unit_cube_cm3"], max(1, int(hold)))
    return size


def _bool(v):
    return None if v is None else bool(v)


def _row(r: dict, barcodes: list[str], hubs: list[dict]) -> dict:
    missing = []
    if not r.get("bin_size"):
        missing.append("bin_size")
    if r.get("default_full_threshold") is None:
        missing.append("fill_to")
    own = (r.get("default_full_threshold"), r.get("default_restock_point"),
           r.get("default_safety_stock"))
    return {
        "id": r["id"], "brand_id": r["brand_id"], "brand_code": r.get("brand_code"),
        "brand_name": r.get("brand_name"), "brand_sku_code": r["brand_sku_code"],
        "hiryu_sku_code": r.get("hiryu_sku_code"), "name_display": r["name_display"],
        "unit_size": r.get("unit_size"), "category": r.get("category"),
        "photo_key": r.get("photo_key"), "barcodes": barcodes,
        "bin_size": r.get("bin_size"), "suggested_bin_size": _suggest_size(r),
        "bin_max": r.get("bin_max"),
        "fill_to": r.get("default_full_threshold"),
        "reorder_at": r.get("default_restock_point"),
        "reorder_pct": r.get("default_restock_pct"),
        "critical_at": r.get("default_safety_stock"),
        "critical_pct": r.get("default_safety_pct"),
        "grab_buffer": r.get("grab_buffer"),
        "pack_length_mm": r.get("pack_length_mm"), "pack_width_mm": r.get("pack_width_mm"),
        "pack_height_mm": r.get("pack_height_mm"), "pack_weight_g": r.get("pack_weight_g"),
        "is_liquid": _bool(r.get("is_liquid")),
        "is_large_bottle": _bool(r.get("is_large_bottle")),
        "complete": not missing, "missing": missing,
        "hubs": [dict(h, follows_default=(h["fill_to"], h["reorder_at"], h["critical_at"]) == own)
                 for h in hubs],
    }


async def _rows(where: list[str], params: list, limit: int = 2000) -> list[dict]:
    rows = await db.fetch_all(
        f"SELECT {_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY {INCOMPLETE_SQL} DESC, b.name, s.name_display LIMIT %s",
        params + [limit],
    )
    ids = [r["id"] for r in rows]
    codes: dict[int, list[str]] = {}
    hubs: dict[int, list[dict]] = {}
    for part in _chunks(ids):
        ph = db.placeholders(part)
        for bc in await db.fetch_all(
                f"SELECT sku_id, barcode FROM barcodes WHERE sku_id IN ({ph}) "
                "ORDER BY registered_at, id", part):
            codes.setdefault(bc["sku_id"], []).append(bc["barcode"])
        for h in await db.fetch_all(
                "SELECT sa.sku_id, sa.site_id, st.code AS site_code, l.code AS location_code, "
                "       sa.full_threshold AS fill_to, sa.restock_point AS reorder_at, "
                "       sa.safety_stock AS critical_at "
                "FROM slot_assignments sa JOIN sites st ON st.id = sa.site_id "
                "LEFT JOIN baskets bk ON bk.id = sa.basket_id "
                "LEFT JOIN locations l ON l.id = bk.location_id "
                f"WHERE sa.slot_role = 'primary' AND sa.sku_id IN ({ph}) "
                "ORDER BY st.is_training, st.code", part):
            sku_id = h.pop("sku_id")
            hubs.setdefault(sku_id, []).append(h)
    return [_row(r, codes.get(r["id"], []), hubs.get(r["id"], [])) for r in rows]


async def _one(sku_id: int) -> dict:
    rows = await _rows(["s.id = %s"], [sku_id], 1)
    if not rows:
        raise HTTPException(404, "SKU tidak ditemukan. / SKU not found.")
    return rows[0]


async def _raw(sku_id: int) -> dict | None:
    return await db.fetch_one(
        f"SELECT {_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
        "WHERE s.id = %s", (sku_id,))


def _filters(brand_id: int | None, status: str, q: str | None) -> tuple[list[str], list]:
    where, params = [_BASE_WHERE], []
    if brand_id:
        where.append("s.brand_id = %s")
        params.append(brand_id)
    if status == "incomplete":
        where.append(INCOMPLETE_SQL)
    elif status == "complete":
        where.append("NOT " + INCOMPLETE_SQL)
    if q:
        like = f"%{q.strip()}%"
        where.append(
            "(s.name_display LIKE %s OR s.brand_sku_code LIKE %s OR s.hiryu_sku_code LIKE %s "
            " OR EXISTS (SELECT 1 FROM barcodes bc WHERE bc.sku_id = s.id AND bc.barcode LIKE %s))")
        params += [like, like, like, like]
    return where, params


@router.get("", response_model=models.SkuCompleteList)
async def list_skus(
    brand_id: int | None = None,
    status: str = Query(default="incomplete", pattern="^(incomplete|complete|all)$"),
    q: str | None = None,
    user: auth.User = Depends(auth.require("hq")),
):
    """SKUs with what Ops HQ fills in; *belum lengkap* first (the default filter)."""
    where, params = _filters(brand_id, status, q)
    rows = await _rows(where, params)
    return {
        "rows": rows, "total": len(rows),
        "incomplete": sum(1 for r in rows if not r["complete"]),
        "bin_sizes": list(racks.SIZES),
        "grab_buffer_default": await _buffer_default(),
        "restock_default_pct": await _restock_default_pct(),
    }


@router.get("/summary", response_model=models.SkuCompleteSummary)
async def summary(user: auth.User = Depends(auth.require("hq"))):
    """How many SKUs are still to complete, for a badge or the to-do list."""
    row = await db.fetch_one(
        f"SELECT COUNT(*) AS total, SUM(CASE WHEN {INCOMPLETE_SQL} THEN 1 ELSE 0 END) AS n "
        f"FROM skus s JOIN brands b ON b.id = s.brand_id WHERE {_BASE_WHERE}")
    return {"incomplete": int(row["n"] or 0), "total": int(row["total"] or 0)}


# --- planning a change --------------------------------------------------------

def _pct_units(fill_to: int, pct: int, floor: int) -> int:
    """A percentage of isi sampai in units, rounded up (§4.5.3)."""
    return max(floor, math.ceil(fill_to * pct / 100))


def _plan(row: dict, ch: dict, default_pct: int | None) -> tuple[dict, list[str]]:
    """Work out the column values a change leads to, and what is wrong with it.

    `ch` holds only the fields being changed (None = clear). Returns the columns
    whose value differs from `row`, and bilingual errors; nothing is written.
    The refusals are the ones §4.5.1 names: numbers that cannot work.
    """
    errs: list[str] = []
    new: dict = {}

    def num(key, lo, label, hi=None):
        v = ch.get(key)
        if v is None:
            return None
        if not isinstance(v, int) or isinstance(v, bool) or v < lo or (hi is not None and v > hi):
            rng = f"{lo} sampai {hi}" if hi is not None else f"{lo} atau lebih"
            rng_en = f"{lo} to {hi}" if hi is not None else f"{lo} or more"
            errs.append(f"{label}: isi angka {rng}. / {label}: enter a number, {rng_en}.")
            return None
        return v

    # Plain fields.
    for key, col in _PLAIN.items():
        if key not in ch:
            continue
        v = ch[key]
        if key == "brand_sku_code":
            v = (v or "").strip()
            if not v or len(v) > 64:
                errs.append("Kode SKU brand wajib diisi, paling panjang 64 karakter. / "
                            "The brand SKU code is required, 64 characters at most.")
                continue
        elif key == "bin_size":
            if v is not None:
                v = str(v).strip().upper()
                if v not in racks.SIZES:
                    errs.append(f"Ukuran bin harus {', '.join(racks.SIZES)}. / "
                                f"Bin size must be {', '.join(racks.SIZES)}.")
                    continue
        elif key in ("is_liquid", "is_large_bottle"):
            v = None if v is None else (1 if v else 0)
        elif key == "bin_max":
            if v is not None and num(key, 1, "Isi maks. per bin") is None:
                continue
        elif key == "grab_buffer":
            if v is not None and num(key, 0, "Cadangan Grab") is None:
                continue
        else:  # pack sizes and weight
            if v is not None and num(key, 1, _LABEL[col]) is None:
                continue
        new[col] = v

    # Pack volume follows the three sizes, so the bin-size suggestion and the
    # capacity estimate other screens use stay true to what was entered.
    dims = ("pack_length_mm", "pack_width_mm", "pack_height_mm")
    if any(d in new for d in dims):
        l, w, h = (new.get(d, row.get(d)) for d in dims)
        if l and w and h:
            new["unit_cube_cm3"] = max(1, math.ceil(l * w * h / 1000))

    # Stock numbers: P first, then R and S from it.
    p = row.get("default_full_threshold")
    if "fill_to" in ch:
        p = ch["fill_to"]
        if p is not None and num("fill_to", 0, "Isi sampai") is None:
            p = row.get("default_full_threshold")
    r_units, r_pct = row.get("default_restock_point"), row.get("default_restock_pct")
    if ch.get("reorder_pct") is not None:
        r_pct = num("reorder_pct", 1, "Pesan ulang saat sisa (%)", 99)
        r_units = None
    elif "reorder_at" in ch:
        r_pct = None
        r_units = ch["reorder_at"]
        if r_units is not None and num("reorder_at", 1, "Pesan ulang saat sisa") is None:
            r_units = row.get("default_restock_point")
    s_units, s_pct = row.get("default_safety_stock"), row.get("default_safety_pct")
    if ch.get("critical_pct") is not None:
        s_pct = num("critical_pct", 0, "Batas kritis (%)", 100)
        s_units = None
    elif "critical_at" in ch:
        s_pct = None
        s_units = ch["critical_at"]
        if s_units is not None and num("critical_at", 0, "Batas kritis") is None:
            s_units = row.get("default_safety_stock")

    if p == 0:
        # Isi sampai 0 = stop asking the brand for it (§2.3.3): no R, no S.
        r_units = s_units = None
    elif p is not None:
        if r_pct is not None:
            # Below 2 there is no whole unit under isi sampai to reorder at.
            r_units = _pct_units(p, r_pct, 1) if p >= 2 else None
        elif r_units is None and p >= 2 and default_pct:
            # Pesan ulang saat sisa fills in as 25% of isi sampai (§2.2.6, §4.5.2).
            r_pct = default_pct
            r_units = _pct_units(p, r_pct, 1)
        if s_pct is not None:
            s_units = _pct_units(p, s_pct, 0)
        if r_units is not None and r_units >= p:
            errs.append(f"Pesan ulang saat sisa ({r_units}) harus di bawah isi sampai ({p}). / "
                        f"Reorder at ({r_units}) must be below fill up to ({p}).")
    else:
        # No isi sampai: a percentage has nothing to be a share of yet.
        if r_pct is not None:
            r_units = None
        if s_pct is not None:
            s_units = None
    if s_units is not None and r_units is not None and s_units > r_units:
        errs.append(f"Batas kritis ({s_units}) tidak boleh di atas pesan ulang saat sisa "
                    f"({r_units}). / The critical level ({s_units}) must not be above reorder "
                    f"at ({r_units}).")

    for col, v in (("default_full_threshold", p), ("default_restock_point", r_units),
                   ("default_restock_pct", r_pct), ("default_safety_stock", s_units),
                   ("default_safety_pct", s_pct)):
        new[col] = v

    changed = {c: v for c, v in new.items() if row.get(c) != v}
    return changed, errs


async def _check_code(row: dict, changed: dict) -> list[str]:
    code = changed.get("brand_sku_code")
    if not code:
        return []
    dup = await db.fetch_one(
        "SELECT id FROM skus WHERE brand_id = %s AND brand_sku_code = %s AND id <> %s",
        (row["brand_id"], code, row["id"]))
    if dup:
        return [f"Kode SKU brand {code} sudah dipakai SKU lain di merek ini. / "
                f"The brand SKU code {code} is already used by another SKU of this brand."]
    return []


async def _check_barcodes(sku_id: int, codes: list[str], user: auth.User) -> tuple[list, list]:
    """New barcodes to add, and refusals. One barcode belongs to one SKU, ever (§2.6)."""
    add, errs, seen = [], [], set()
    for c in codes:
        c = re.sub(r"\s+", "", str(c or ""))
        if not c or c in seen:
            continue
        seen.add(c)
        if not re.fullmatch(r"[0-9A-Za-z-]{4,64}", c):
            errs.append(f"Barcode {c} tidak terbaca. / Barcode {c} is not valid.")
            continue
        chk = await master.check_barcode(c, sku_id, user)
        if chk["state"] == "new":
            add.append(c)
        elif chk["state"] == "conflict":
            errs.append(f"Barcode {c} sudah milik {chk['conflict_sku_name']}. / "
                        f"Barcode {c} already belongs to {chk['conflict_sku_name']}.")
    return add, errs


async def _apply(cur, row: dict, changed: dict, user: auth.User) -> int:
    """Write one SKU's change inside the caller's transaction.

    Returns how many hubs followed the SKU's stock numbers and were moved with
    them. A hub follows when all three of its numbers still equal the SKU's own
    (NULL-safe, so a hub racked before any number was set picks them up now).
    """
    if not changed:
        return 0
    cols = list(changed)
    await db.run(cur, "UPDATE skus SET " + ", ".join(f"{c} = %s" for c in cols) +
                 " WHERE id = %s", [changed[c] for c in cols] + [row["id"]])
    moved = 0
    triple = ("default_full_threshold", "default_restock_point", "default_safety_stock")
    if any(c in changed for c in triple):
        old = [row.get(c) for c in triple]
        new = [changed.get(c, row.get(c)) for c in triple]
        moved = await db.run(
            cur,
            "UPDATE slot_assignments SET full_threshold = %s, restock_point = %s, "
            "safety_stock = %s "
            "WHERE sku_id = %s AND slot_role = 'primary' "
            "  AND full_threshold <=> %s AND restock_point <=> %s AND safety_stock <=> %s",
            new + [row["id"]] + old,
        )
    await ledger.audit(cur, actor_email=user.email, entity="sku", entity_id=row["id"],
                       action="complete",
                       before={c: row.get(c) for c in cols}, after=changed)
    return moved


async def _add_barcodes(sku_id: int, codes: list[str], user: auth.User) -> int:
    if not codes:
        return 0
    res = await master.register_barcodes(
        models.BarcodeRegisterIn(sku_id=sku_id, barcodes=codes), user)
    return int(res["registered"])


# --- saving one SKU -------------------------------------------------------------

@router.patch("/{sku_id}", response_model=models.SkuCompleteSaved)
async def update_sku(
    sku_id: int, body: models.SkuCompleteIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Save what Ops HQ typed on one row. Only the fields sent change."""
    row = await _raw(sku_id)
    if not row:
        raise HTTPException(404, "SKU tidak ditemukan. / SKU not found.")
    ch = {k: getattr(body, k) for k in body.model_fields_set if k != "add_barcodes"}
    changed, errs = _plan(row, ch, await _restock_default_pct())
    errs += await _check_code(row, changed)
    add, bc_errs = await _check_barcodes(sku_id, body.add_barcodes, user)
    errs += bc_errs
    if errs:
        raise HTTPException(422, " ".join(errs))
    async with db.tx() as cur:
        moved = await _apply(cur, row, changed, user)
    added = await _add_barcodes(sku_id, add, user)
    fresh = await _one(sku_id)
    msg = "Tersimpan." if changed or added else "Tidak ada perubahan."
    if moved:
        msg += f" {moved} hub ikut angka baru."
    if fresh["complete"]:
        msg += " SKU lengkap."
    return {"row": fresh, "hubs_updated": moved, "barcodes_added": added, "message": msg}


@router.put("/{sku_id}/hubs/{site_id}", response_model=models.SkuCompleteSaved)
async def update_hub(
    sku_id: int, site_id: int, body: models.SkuHubNumbersIn,
    user: auth.User = Depends(auth.require("hq")),
):
    """Set one hub's own numbers for this SKU, through the registry's update path.

    Percentages become units here, against this hub's isi sampai; the registry
    stores units only. The legacy low threshold is kept when it still fits
    under the new isi sampai, and dropped when it would now be refused.
    """
    await auth.assert_site_access(user, site_id)
    slot = await db.fetch_one(
        "SELECT low_threshold FROM slot_assignments "
        "WHERE site_id = %s AND sku_id = %s AND slot_role = 'primary'", (site_id, sku_id))
    if not slot:
        raise HTTPException(404, "SKU ini belum punya bin di hub ini. / This SKU has no bin "
                                 "at this hub yet.")
    p = body.fill_to
    if p is None or p < 1:
        raise HTTPException(422, "Isi sampai per hub minimal 1. Untuk berhenti restock, isi 0 "
                                 "di angka SKU. / Fill up to at a hub must be 1 or more. To stop "
                                 "restocking, set 0 on the SKU's own numbers.")
    r = _pct_units(p, body.reorder_pct, 1) if body.reorder_pct is not None else body.reorder_at
    s = _pct_units(p, body.critical_pct, 0) if body.critical_pct is not None else body.critical_at
    if r is not None and not (1 <= r < p):
        raise HTTPException(422, f"Pesan ulang saat sisa harus 1 sampai {p - 1}. / "
                                 f"Reorder at must be 1 to {p - 1}.")
    if s is not None and (s < 0 or (r is not None and s > r)):
        raise HTTPException(422, "Batas kritis harus 0 sampai pesan ulang saat sisa. / "
                                 "The critical level must be 0 up to reorder at.")
    low = slot["low_threshold"]
    if low is not None and (low >= p or (r is not None and r < low)):
        low = None
    await registry.set_thresholds(
        sku_id,
        models.RegistryIn(site_id=site_id, full_threshold=p, low_threshold=low,
                          restock_point=r, safety_stock=s),
        user,
    )
    return {"row": await _one(sku_id), "message": "Angka hub tersimpan."}


# --- CSV (§2.6.1) -------------------------------------------------------------------

# Column name -> aliases accepted on upload (compared lower case, spaces and
# dots as underscores). The download writes the first name.
_CSV = [
    ("sku_id", ("sku_id", "id")),
    ("merek", ("merek", "brand")),
    ("kode_hiryu", ("kode_hiryu", "hiryu_sku_code", "kode_sku_di_hiryu")),
    ("kode_brand", ("kode_brand", "brand_sku_code", "kode_sku_brand")),
    ("nama", ("nama", "name", "product")),
    ("ukuran", ("ukuran", "size", "unit_size")),
    ("barcode", ("barcode", "barcodes")),
    ("ukuran_bin", ("ukuran_bin", "bin_size")),
    ("isi_maks_per_bin", ("isi_maks_per_bin", "isi_maks", "bin_max")),
    ("isi_sampai", ("isi_sampai", "fill_to", "fill_up_to")),
    ("pesan_ulang_saat_sisa", ("pesan_ulang_saat_sisa", "pesan_ulang", "reorder_at")),
    ("batas_kritis", ("batas_kritis", "critical_at", "critical")),
    ("cadangan_grab", ("cadangan_grab", "grab_buffer")),
    ("panjang_mm", ("panjang_mm", "length_mm")),
    ("lebar_mm", ("lebar_mm", "width_mm")),
    ("tinggi_mm", ("tinggi_mm", "height_mm")),
    ("berat_g", ("berat_g", "weight_g")),
    ("cair", ("cair", "liquid", "is_liquid")),
    ("botol_besar", ("botol_besar", "large_bottle", "is_large_bottle")),
    ("status", ("status",)),
]
_YES = {"ya", "y", "yes", "1", "true", "benar"}
_NO = {"tidak", "t", "no", "n", "0", "false", "salah"}
# The one cell value that clears a field; an empty cell changes nothing.
_CLEAR = "-"


def _fmt(v, pct=None) -> str:
    if pct is not None:
        return f"{pct}%"
    if v is None:
        return ""
    if isinstance(v, bool):
        return "ya" if v else "tidak"
    return str(v)


@router.get("/export.csv")
async def export_csv(
    brand_id: int | None = None,
    status: str = Query(default="incomplete", pattern="^(incomplete|complete|all)$"),
    q: str | None = None,
    user: auth.User = Depends(auth.require("hq")),
):
    """The rows on screen as a CSV to fill in. Read-only columns are there so a
    person can tell the rows apart; the upload ignores them."""
    where, params = _filters(brand_id, status, q)
    rows = await _rows(where, params, limit=5000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c for c, _ in _CSV])
    for r in rows:
        w.writerow([
            r["id"], r["brand_name"] or r["brand_code"], r["hiryu_sku_code"] or "",
            r["brand_sku_code"], r["name_display"], r["unit_size"] or "",
            " ".join(r["barcodes"]), r["bin_size"] or "", _fmt(r["bin_max"]),
            _fmt(r["fill_to"]), _fmt(r["reorder_at"], r["reorder_pct"]),
            _fmt(r["critical_at"], r["critical_pct"]), _fmt(r["grab_buffer"]),
            _fmt(r["pack_length_mm"]), _fmt(r["pack_width_mm"]), _fmt(r["pack_height_mm"]),
            _fmt(r["pack_weight_g"]), _fmt(r["is_liquid"]), _fmt(r["is_large_bottle"]),
            "lengkap" if r["complete"] else "belum lengkap",
        ])
    # A byte-order mark so Excel opens the file as UTF-8.
    return Response(
        content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=lengkapi-data-sku.csv"},
    )


def _read_csv(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig", errors="replace")
    first = text.splitlines()[0] if text.strip() else ""
    # Excel in an Indonesian locale saves with semicolons.
    delim = ";" if first.count(";") > first.count(",") else ","
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    if not rows:
        return []
    norm = [re.sub(r"[\s.]+", "_", (h or "").strip().lower()).strip("_") for h in rows[0]]
    index = {}
    for name, aliases in _CSV:
        for i, h in enumerate(norm):
            if h in aliases and name not in index:
                index[name] = i
    out = []
    for n, cells in enumerate(rows[1:], start=2):
        if not any((c or "").strip() for c in cells):
            continue
        out.append({"_row": n, **{name: (cells[i].strip() if i < len(cells) else "")
                                  for name, i in index.items()}})
    return out


def _cell_changes(rec: dict) -> tuple[dict, list[str], list[str]]:
    """One CSV row -> (changes for _plan, barcodes to add, errors)."""
    ch, errs = {}, []

    def integer(name, key):
        v = rec.get(name, "")
        if v == "":
            return
        if v == _CLEAR:
            ch[key] = None
            return
        if re.fullmatch(r"\d+", v):
            ch[key] = int(v)
        else:
            errs.append(f"{name}: '{v}' bukan angka. / {name}: '{v}' is not a number.")

    def units_or_pct(name, key, pct_key):
        v = rec.get(name, "").replace(" ", "")
        if v == "":
            return
        if v == _CLEAR:
            ch[key] = None
            return
        m = re.fullmatch(r"(\d+)%", v)
        if m:
            ch[pct_key] = int(m.group(1))
        elif re.fullmatch(r"\d+", v):
            ch[key] = int(v)
        else:
            errs.append(f"{name}: isi unit atau persen, misalnya 4 atau 25%. / {name}: enter "
                        "units or a percentage, e.g. 4 or 25%.")

    def flag(name, key):
        v = rec.get(name, "").lower()
        if v == "":
            return
        if v == _CLEAR:
            ch[key] = None
        elif v in _YES:
            ch[key] = True
        elif v in _NO:
            ch[key] = False
        else:
            errs.append(f"{name}: isi ya atau tidak. / {name}: enter ya or tidak.")

    if rec.get("kode_brand"):
        ch["brand_sku_code"] = rec["kode_brand"]
    if rec.get("ukuran_bin"):
        ch["bin_size"] = None if rec["ukuran_bin"] == _CLEAR else rec["ukuran_bin"]
    integer("isi_maks_per_bin", "bin_max")
    integer("isi_sampai", "fill_to")
    units_or_pct("pesan_ulang_saat_sisa", "reorder_at", "reorder_pct")
    units_or_pct("batas_kritis", "critical_at", "critical_pct")
    v = rec.get("cadangan_grab", "")
    if v.endswith("%"):
        errs.append("cadangan_grab: isi dalam unit. / cadangan_grab: enter units.")
    else:
        integer("cadangan_grab", "grab_buffer")
    integer("panjang_mm", "pack_length_mm")
    integer("lebar_mm", "pack_width_mm")
    integer("tinggi_mm", "pack_height_mm")
    integer("berat_g", "pack_weight_g")
    flag("cair", "is_liquid")
    flag("botol_besar", "is_large_bottle")
    codes = [c for c in re.split(r"[\s;,|]+", rec.get("barcode", "")) if c]
    return ch, codes, errs


def _shown(units, pct) -> str | None:
    """How a number reads in the preview: "25% (4)" for a percentage."""
    if pct is not None:
        return f"{pct}% ({units})" if units is not None else f"{pct}%"
    return None if units is None else _fmt(units)


def _describe(row: dict, changed: dict) -> list[dict]:
    """The preview lines for one SKU: old and new, a percentage with its units."""
    out = []
    pairs = {"default_restock_point": "default_restock_pct",
             "default_safety_stock": "default_safety_pct"}
    for col, pct_col in pairs.items():
        if col in changed or pct_col in changed:
            out.append({
                "field": col, "label": _LABEL[col],
                "old": _shown(row.get(col), row.get(pct_col)),
                "new": _shown(changed.get(col, row.get(col)),
                              changed.get(pct_col, row.get(pct_col))),
            })
    for col, v in changed.items():
        if col in pairs or col in pairs.values():
            continue
        old = row.get(col)
        if col in ("is_liquid", "is_large_bottle"):
            old, v = _bool(old), _bool(v)
        out.append({"field": col, "label": _LABEL.get(col, col),
                    "old": _fmt(old) or None, "new": _fmt(v) or None})
    return out


async def _find(rec: dict) -> dict | None:
    sid = rec.get("sku_id", "")
    if re.fullmatch(r"\d+", sid or ""):
        return await _raw(int(sid))
    code = rec.get("kode_hiryu")
    if code:
        # Hiryu upper-cases codes; the two systems compare without case (§2.12).
        hit = await db.fetch_one(
            f"SELECT {_COLS} FROM skus s JOIN brands b ON b.id = s.brand_id "
            "WHERE UPPER(s.hiryu_sku_code) = UPPER(%s)", (code,))
        if hit:
            return hit
    return None


@router.post("/import", response_model=models.SkuCsvResult)
async def import_csv(
    commit: bool = Query(default=False),
    file: UploadFile = File(...),
    user: auth.User = Depends(auth.require("hq")),
):
    """Upload the filled-in CSV. Preview by default; commit=true saves (§2.6.1).

    An empty cell changes nothing and a single "-" clears the field, so a file
    downloaded, half filled and uploaded back never wipes what was already set.
    Rows with a problem are shown and skipped; the rest are saved together.
    Barcodes are only ever added.
    """
    records = _read_csv(await file.read())
    if not records:
        raise HTTPException(400, "File kosong atau tidak terbaca. / The file is empty or "
                                 "could not be read.")
    default_pct = await _restock_default_pct()
    out, plans = [], []
    for rec in records:
        row = await _find(rec)
        res = {"row_no": rec["_row"], "code": rec.get("kode_hiryu") or rec.get("kode_brand"),
               "name": rec.get("nama"), "changes": [], "errors": []}
        if not row:
            res.update(status="error", errors=[
                "SKU tidak ditemukan: isi sku_id atau kode_hiryu dari file unduhan. / SKU not "
                "found: keep the sku_id or kode_hiryu from the downloaded file."])
            out.append(res)
            continue
        res.update(sku_id=row["id"], code=row.get("hiryu_sku_code") or row["brand_sku_code"],
                   name=row["name_display"])
        ch, codes, errs = _cell_changes(rec)
        changed, plan_errs = _plan(row, ch, default_pct)
        errs += plan_errs + await _check_code(row, changed)
        add, bc_errs = await _check_barcodes(row["id"], codes, user)
        errs += bc_errs
        res["changes"] = _describe(row, changed)
        if add:
            res["changes"].append({"field": "barcodes", "label": _LABEL["barcodes"],
                                   "old": None, "new": " ".join(add)})
        res["errors"] = errs
        res["status"] = "error" if errs else ("change" if res["changes"] else "same")
        out.append(res)
        if not errs and (changed or add):
            plans.append((row, changed, add))

    saved = 0
    if commit and plans:
        async with db.tx() as cur:
            for row, changed, _ in plans:
                await _apply(cur, row, changed, user)
                saved += 1
        for row, _, add in plans:
            if add:
                try:
                    await _add_barcodes(row["id"], add, user)
                except HTTPException:
                    pass  # a barcode taken meanwhile; the preview named it, the row is saved
        await db.execute(
            "INSERT INTO audit_log (actor_email, action, entity, entity_id, after_json) "
            "VALUES (%s,'sku.complete_csv','skus',NULL,%s)",
            (user.email, f"{saved} SKU from {file.filename}"))

    n_change = sum(1 for r in out if r["status"] == "change")
    n_same = sum(1 for r in out if r["status"] == "same")
    n_err = sum(1 for r in out if r["status"] == "error")
    if commit:
        msg = f"{saved} SKU tersimpan." + (f" {n_err} baris dilewati karena ada masalah."
                                           if n_err else "")
    else:
        msg = (f"Pratinjau: {n_change} SKU berubah, {n_same} tetap, {n_err} bermasalah. "
               "Periksa lalu tekan Simpan.")
    return {"committed": bool(commit), "rows": out, "to_change": n_change,
            "unchanged": n_same, "errors": n_err, "saved": saved, "message": msg}
