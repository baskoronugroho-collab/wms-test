"""Stock counts.

Two generations live here:

* ``/api/opname/*``: the old weekly plan, basket by basket. Kept so the old
  station pages keep working until they redirect.
* ``/api/counts/*``: deploy 3 (canvas Section 8, decisions log 5 Oct). The WMS
  makes the plan each morning: bins due under Ops HQ's mandatory cycles, bins
  where a missing item was declared (``bin_count_flags``, written by the
  floor), bins the SPV adds, and once a month every bin. No rotation bins.
  Counting is by scan by default (each unit scanned counts up); a blind count
  is optional and always waits for the SPV. Nobody who counts sees the expected
  number. A first count that differs goes by itself to a second person. The SPV
  approval changes the stock through the ledger (so Hiryu hears it at once);
  Ops HQ reviews every approved difference afterwards, without holding it.
  A bin being counted is locked against picking (``is_bin_locked``).
  Mode manual (V32, routers/manual_mode.py): the count starts by a tap on the
  bin (``manual``), is typed blind and always waits for the SPV; the start and
  the finish are marked manual in the audit log.
"""
import json
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["stock opname"])


@router.post("/opname/plans", response_model=models.OpnamePlan, status_code=201)
async def create_plan(
    body: models.OpnamePlanIn, user: auth.User = Depends(auth.require("supervisor"))
):
    await auth.assert_site_access(user, body.site_id)
    scope = body.model_dump(exclude={"site_id", "name"})
    async with db.tx() as cur:
        plan_id = await db.run(
            cur,
            "INSERT INTO opname_plans (site_id, name, scope_json, created_by) "
            "VALUES (%s,%s,%s,%s)",
            (body.site_id, body.name or "Hitung stok mingguan",
             json.dumps(scope), user.email),
        )
    return await _plan_summary(plan_id)


async def _plan_baskets(plan_id: int) -> list[dict]:
    plan = await db.fetch_one("SELECT * FROM opname_plans WHERE id = %s", (plan_id,))
    if not plan:
        raise HTTPException(404, "Rencana tidak ditemukan. / Plan not found.")
    scope = json.loads(plan["scope_json"] or "{}")

    sql = (
        "SELECT bk.id AS basket_id, l.code AS location_code, r.code AS rack_code, "
        "       lv.level_no, l.position_no, sa.sku_id, s.name_display, s.photo_key, "
        "       os.status AS session_status, os.claimed_by, os.variance "
        "FROM baskets bk "
        "JOIN locations l ON l.id = bk.location_id "
        "JOIN levels lv ON lv.id = l.level_id "
        "JOIN racks r ON r.id = lv.rack_id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id "
        "LEFT JOIN opname_sessions os ON os.basket_id = bk.id AND os.plan_id = %s "
        "WHERE bk.site_id = %s AND sa.id IS NOT NULL"
    )
    params: list = [plan_id, plan["site_id"]]
    if scope.get("rack_codes"):
        sql += " AND r.code IN (" + ",".join(["%s"] * len(scope["rack_codes"])) + ")"
        params += scope["rack_codes"]
    if scope.get("brand_id"):
        sql += " AND s.brand_id = %s"
        params.append(scope["brand_id"])
    if scope.get("expiry_tier"):
        sql += " AND s.expiry_tier = %s"
        params.append(scope["expiry_tier"])
    # Walking order, same as the pick path; in a stack the bottom bin first.
    sql += " ORDER BY r.code, lv.level_no, l.position_no, l.bin_row"
    return await db.fetch_all(sql, params)


async def _plan_summary(plan_id: int) -> dict:
    plan = await db.fetch_one("SELECT * FROM opname_plans WHERE id = %s", (plan_id,))
    if not plan:
        raise HTTPException(404, "Rencana tidak ditemukan. / Plan not found.")
    baskets = await _plan_baskets(plan_id)
    counted = sum(1 for b in baskets if b["session_status"] == "finished")
    variances = sum(1 for b in baskets if (b["variance"] or 0) != 0
                    and b["session_status"] == "finished")
    return {
        "id": plan["id"], "site_id": plan["site_id"], "name": plan["name"],
        "status": plan["status"], "total_baskets": len(baskets),
        "counted": counted, "variances": variances,
        "created_at": str(plan["created_at"]) if plan.get("created_at") else None,
        "created_by": plan.get("created_by"),
        "scope": json.loads(plan["scope_json"] or "{}"),
    }


@router.get("/opname/plans", response_model=models.OpnamePlanList)
async def list_plans(
    site_id: int,
    limit: int = Query(default=20, le=100),
    user: auth.User = Depends(auth.current_user),
):
    """Recent count plans at a site.

    Declared BEFORE /opname/plans/{plan_id}: FastAPI matches in registration
    order, and a literal path registered after a parameterised sibling is
    shadowed by it.
    """
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT id FROM opname_plans WHERE site_id = %s "
        "ORDER BY created_at DESC LIMIT %s", (site_id, limit),
    )
    return {"plans": [await _plan_summary(r["id"]) for r in rows]}


@router.get("/opname/plans/{plan_id}", response_model=models.OpnamePlanDetail)
async def plan_detail(plan_id: int, user: auth.User = Depends(auth.current_user)):
    summary = await _plan_summary(plan_id)
    await auth.assert_site_access(user, summary["site_id"])
    rows = await _plan_baskets(plan_id)
    return {
        "plan": summary,
        "baskets": [{
            "basket_id": r["basket_id"], "location_code": r["location_code"],
            "sku_id": r["sku_id"], "sku_name": r["name_display"],
            "photo_key": r["photo_key"],
            "status": r["session_status"] or "pending",
            "claimed_by": r["claimed_by"], "variance": r["variance"],
        } for r in rows],
    }


@router.post("/opname/sessions", response_model=models.OpnameSession, status_code=201)
async def claim_basket(
    body: models.OpnameSessionIn, user: auth.User = Depends(auth.current_user)
):
    """Claim a basket to count it.

    The UNIQUE(plan_id, basket_id) index is the claim: two staff racing for the
    same basket, exactly one wins, and the loser is told who holds it. This is
    the direct answer to concurrent staff on one station (M6.2.2).

    The expected quantity is deliberately NOT returned. Showing it invites
    confirming the number instead of counting it (M6.2.3).
    """
    plan = await db.fetch_one("SELECT * FROM opname_plans WHERE id = %s",
                             (body.plan_id,))
    if not plan:
        raise HTTPException(404, "Rencana tidak ditemukan. / Plan not found.")
    await auth.assert_site_access(user, plan["site_id"])

    basket = await db.fetch_one(
        "SELECT bk.id, bk.location_id, l.code AS location_code, sa.sku_id, s.name_display, "
        "       s.photo_key, s.identity_mode "
        "FROM baskets bk JOIN locations l ON l.id = bk.location_id "
        "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
        "LEFT JOIN skus s ON s.id = sa.sku_id WHERE bk.id = %s",
        (body.basket_id,),
    )
    if not basket:
        raise HTTPException(404, "Keranjang tidak ditemukan. / Basket not found.")

    existing = await db.fetch_one(
        "SELECT * FROM opname_sessions WHERE plan_id = %s AND basket_id = %s",
        (body.plan_id, body.basket_id),
    )
    if existing:
        if existing["status"] == "finished":
            raise HTTPException(409, "Keranjang ini sudah dihitung. / This basket has already been counted.")
        if existing["claimed_by"] != user.email:
            raise HTTPException(
                409, f"{existing['claimed_by']} sedang menghitung keranjang ini. / "
                    f"{existing['claimed_by']} is counting this basket."
            )
        session_id = existing["id"]
        counted_so_far = int(existing["qty_counted"] or 0)
    else:
        counted_so_far = 0
        # Expected is what the ledger holds at THIS basket's location. The
        # primary slot was used before, so counting an overflow basket compared
        # it against the rack's number.
        expected = await common.qty_at(
            plan["site_id"], basket["sku_id"], basket["location_id"]
        ) if basket["sku_id"] else 0
        async with db.tx() as cur:
            try:
                session_id = await db.run(
                    cur,
                    "INSERT INTO opname_sessions (plan_id, site_id, basket_id, "
                    "sku_id, claimed_by, claimed_at, qty_expected) "
                    "VALUES (%s,%s,%s,%s,%s,NOW(),%s)",
                    (body.plan_id, plan["site_id"], body.basket_id,
                     basket["sku_id"], user.email, expected),
                )
            except Exception:
                raise HTTPException(409, "Orang lain baru saja mengambil keranjang ini. / Someone else just claimed this basket.")

    # No expected plate count either: it is the expected quantity by another
    # name, and a blind count is only blind if nothing on screen knows it.
    return {
        "id": session_id, "plan_id": body.plan_id, "basket_id": body.basket_id,
        "location_code": basket["location_code"], "sku_id": basket["sku_id"],
        "sku_name": basket["name_display"], "photo_key": basket["photo_key"],
        "identity_mode": basket["identity_mode"] or "sku_barcode",
        "qty_counted": counted_so_far, "claimed_by": user.email, "status": "counting",
        "expected_plates": None,
    }


async def _session_at_site(session_id: int, user: auth.User) -> dict:
    session = await db.fetch_one("SELECT * FROM opname_sessions WHERE id = %s",
                                 (session_id,))
    if not session:
        raise HTTPException(404, "Sesi hitung tidak ditemukan. / Count session not found.")
    await auth.assert_site_access(user, session["site_id"])
    return session


@router.post("/opname/sessions/{session_id}/release", response_model=models.Ok)
async def release_basket(session_id: int, user: auth.User = Depends(auth.current_user)):
    """Put a basket back for someone else to count.

    Skipping a basket used to leave it locked to the person who skipped it, so
    nobody else could count it until a supervisor cleared the plan.
    """
    session = await _session_at_site(session_id, user)
    if session["claimed_by"] != user.email and not user.at_least("supervisor"):
        raise HTTPException(409, f"{session['claimed_by']} sedang menghitung keranjang ini. / "
                                 f"{session['claimed_by']} is counting this basket.")
    if session["status"] == "finished":
        raise HTTPException(409, "Keranjang ini sudah dihitung. / This basket is already counted.")
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM opname_foreign WHERE session_id = %s", (session_id,))
        await db.run(cur, "DELETE FROM opname_sessions WHERE id = %s", (session_id,))
    return {"ok": True, "message": "Keranjang dilepas. / Basket released."}


@router.post("/opname/sessions/{session_id}/recount", response_model=models.Ok)
async def request_recount(
    session_id: int, user: auth.User = Depends(auth.require("supervisor"))
):
    """A supervisor sends a finished count back: the basket returns to pending.

    Only before approval. Once approved the adjustment is in the ledger, and a
    count in the next plan is the honest way to revisit it.
    """
    session = await _session_at_site(session_id, user)
    if session.get("approved_at"):
        raise HTTPException(409, "Sudah disetujui. / Already approved.")
    async with db.tx() as cur:
        await db.run(cur, "DELETE FROM opname_foreign WHERE session_id = %s", (session_id,))
        await db.run(cur, "DELETE FROM opname_sessions WHERE id = %s", (session_id,))
        await ledger.audit(cur, actor_email=user.email, entity="opname_session",
                           entity_id=session_id, action="request_recount",
                           after={"variance": session.get("variance"),
                                  "counted_by": session.get("claimed_by")})
    return {"ok": True, "message": "Dikembalikan untuk dihitung ulang. / Sent back for a recount."}


@router.post("/opname/sessions/{session_id}/scan",
             response_model=models.OpnameScanResult)
async def count_scan(
    session_id: int,
    body: models.OpnameScanIn,
    user: auth.User = Depends(auth.current_user),
):
    """Scan a unit into the count.

    A foreign SKU is recorded, not rejected: finding the wrong product in a
    basket is a real and common outcome, and a system that refuses to hear it
    just loses the information (M6.2.5).
    """
    replayed = await ledger.replay(body.idempotency_key, "opname_scan")
    if replayed:
        return replayed

    session = await db.fetch_one(
        "SELECT * FROM opname_sessions WHERE id = %s", (session_id,)
    )
    if not session:
        raise HTTPException(404, "Sesi hitung tidak ditemukan. / Count session not found.")
    if session["status"] == "finished":
        raise HTTPException(409, "Hitungan ini sudah selesai. / This count is already finished.")
    if session["claimed_by"] != user.email:
        raise HTTPException(409, f"{session['claimed_by']} sedang menghitung keranjang ini. / "
                                 f"{session['claimed_by']} is counting this basket.")

    code = body.code.strip()
    scanned = await common.sku_by_barcode(code)
    plate = None
    outcome = "counted"
    message = "Pindaian dicatat. / Scan recorded."

    if not scanned:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            scanned = await common.sku_by_id(plate["sku_id"])

    async with db.tx() as cur:
        if not scanned:
            await db.run(
                cur,
                "INSERT INTO opname_foreign (session_id, scanned_code, qty, note) "
                "VALUES (%s,%s,1,'unidentified')", (session_id, code),
            )
            result = {"accepted": True, "outcome": "unknown",
                      "qty_counted": session["qty_counted"],
                      "message": "Barcode tidak dikenal, dicatat. / Unknown barcode, noted."}
        elif scanned["id"] != session["sku_id"]:
            await db.run(
                cur,
                "INSERT INTO opname_foreign (session_id, scanned_code, "
                "sku_id_resolved, qty, note) VALUES (%s,%s,%s,1,'foreign_item')",
                (session_id, code, scanned["id"]),
            )
            result = {"accepted": True, "outcome": "foreign_item",
                      "qty_counted": session["qty_counted"],
                      "message": f"Barang lain: {scanned['name_display']}, dicatat. / "
                                 f"Another product: {scanned['name_display']}, noted."}
        else:
            counted = session["qty_counted"] + 1
            out_of_place = bool(
                plate and plate["location_id"] and
                plate["location_id"] != (await db.one(
                    cur, "SELECT location_id FROM baskets WHERE id = %s",
                    (session["basket_id"],)
                ) or {}).get("location_id")
            )
            await db.run(
                cur, "UPDATE opname_sessions SET qty_counted = %s WHERE id = %s",
                (counted, session_id),
            )
            if plate:
                await db.run(cur, "UPDATE unit_plates SET last_seen_at = NOW() "
                                  "WHERE id = %s", (plate["id"],))
            result = {
                "accepted": True,
                "outcome": "out_of_place" if out_of_place else "counted",
                "qty_counted": counted,
                "message": ("Tercatat di keranjang lain: dihitung, tapi dicatat. / "
                            "Listed in another basket: counted, but noted."
                            if out_of_place else "Pindaian cocok. / Scan matches."),
            }
        await ledger.remember(cur, body.idempotency_key, "opname_scan", result)
    return result


@router.post("/opname/sessions/{session_id}/finish",
             response_model=models.OpnameFinishResult)
async def finish_session(
    session_id: int,
    body: models.OpnameFinishIn,
    user: auth.User = Depends(auth.current_user),
):
    """Reveal expected vs counted, but a mismatch is recounted first.

    PRD 11.2.5: on a first mismatch the counter is told only that the count does
    not match; the tally resets and they count the basket again. The system
    number is revealed after the second count, whatever it says. Asking for a
    recount AFTER showing the number would defeat the blind count.
    """
    session = await db.fetch_one("SELECT * FROM opname_sessions WHERE id = %s",
                                 (session_id,))
    if not session:
        raise HTTPException(404, "Sesi hitung tidak ditemukan. / Count session not found.")
    if session["claimed_by"] != user.email and not user.at_least("supervisor"):
        raise HTTPException(409, f"{session['claimed_by']} sedang menghitung keranjang ini. / "
                                 f"{session['claimed_by']} is counting this basket.")

    if session["status"] == "finished":
        raise HTTPException(409, "Hitungan ini sudah selesai. / This count is already finished.")
    counted = body.manual_qty if body.manual_qty is not None else session["qty_counted"]
    method = "manual" if body.manual_qty is not None else "scan"
    expected = session["qty_expected"] or 0
    variance = counted - expected

    if variance != 0 and not session["recounted"]:
        async with db.tx() as cur:
            await db.run(
                cur, "UPDATE opname_sessions SET recounted = 1, qty_counted = 0 "
                     "WHERE id = %s", (session_id,))
            await db.run(cur, "DELETE FROM opname_foreign WHERE session_id = %s",
                         (session_id,))
        return {
            "qty_expected": None, "qty_counted": 0, "variance": None,
            "foreign_items": 0, "missing_plates": [], "needs_recount": True,
            "message": "Belum cocok. Hitung ulang sekali lagi dari awal. / "
                       "Not matching yet. Count the basket once more from the start.",
        }

    foreign = (await db.fetch_one(
        "SELECT COUNT(*) AS n FROM opname_foreign WHERE session_id = %s", (session_id,)
    ))["n"]

    missing: list[str] = []
    sku = await common.sku_by_id(session["sku_id"]) if session["sku_id"] else None
    if sku and sku["identity_mode"] == "unit_label" and variance < 0:
        # Mode B can name exactly which units are gone, which is the whole point
        # of a license plate (PRD §5.1).
        rows = await db.fetch_all(
            "SELECT plate_code FROM unit_plates WHERE site_id=%s AND sku_id=%s "
            "AND state='in_stock' AND (last_seen_at IS NULL OR last_seen_at < %s) "
            "LIMIT 50",
            (session["site_id"], session["sku_id"], session["claimed_at"]),
        )
        missing = [r["plate_code"] for r in rows]

    async with db.tx() as cur:
        await db.run(
            cur,
            "UPDATE opname_sessions SET qty_counted=%s, variance=%s, "
            "count_method=%s, status='finished', finished_at=NOW() WHERE id=%s",
            (counted, variance, method, session_id),
        )
    return {
        "qty_expected": expected, "qty_counted": counted, "variance": variance,
        "foreign_items": int(foreign), "missing_plates": missing,
        "needs_recount": False,
        "message": ("Cocok. / Matches." if variance == 0
                    else f"Selisih {variance:+d} setelah dihitung dua kali. Supervisor akan memeriksa. / "
                         f"Difference {variance:+d} after two counts. A supervisor will review it."),
    }


@router.get("/opname/plans/{plan_id}/variance-report",
            response_model=models.VarianceReport)
async def variance_report(plan_id: int, user: auth.User = Depends(auth.current_user)):
    """Sorted by rupiah value, so a supervisor triages the top of the list rather
    than reading all 118 rows (M6.3.2)."""
    plan = await db.fetch_one("SELECT * FROM opname_plans WHERE id = %s", (plan_id,))
    if not plan:
        raise HTTPException(404, "Rencana tidak ditemukan. / Plan not found.")
    await auth.assert_site_access(user, plan["site_id"])

    rows = await db.fetch_all(
        "SELECT os.id AS session_id, os.basket_id, l.code AS location_code, "
        "       os.sku_id, s.name_display, os.recounted, "
        "       os.qty_expected, os.qty_counted, os.variance, os.claimed_by, "
        "       COALESCE(s.price_idr,0) AS price "
        "FROM opname_sessions os "
        "JOIN baskets bk ON bk.id = os.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "LEFT JOIN skus s ON s.id = os.sku_id "
        "WHERE os.plan_id = %s AND os.status='finished' AND os.variance <> 0 "
        "  AND os.approved_at IS NULL "
        "ORDER BY ABS(os.variance * COALESCE(s.price_idr,0)) DESC",
        (plan_id,),
    )
    out = [{
        "session_id": r["session_id"], "recounted": bool(r["recounted"]),
        "basket_id": r["basket_id"], "location_code": r["location_code"],
        "sku_id": r["sku_id"], "sku_name": r["name_display"],
        "qty_expected": r["qty_expected"] or 0, "qty_counted": r["qty_counted"],
        "variance": r["variance"], "value_idr": abs(r["variance"] * int(r["price"])),
        "counted_by": r["claimed_by"],
    } for r in rows]
    return {
        "plan_id": plan_id, "rows": out,
        "total_variance_units": sum(abs(r["variance"]) for r in out),
        "total_variance_idr": sum(r["value_idr"] for r in out),
    }


@router.post("/opname/adjustments/approve", response_model=models.Ok)
async def approve_adjustments(
    body: models.AdjustmentIn, user: auth.User = Depends(auth.require("supervisor"))
):
    """Counting never moves stock by itself. A supervisor reviews and approves,
    and only then does the ledger change (M6.3.3)."""
    applied = 0
    async with db.tx() as cur:
        for sid in body.session_ids:
            # Locked, and skipped once approved: approving twice used to apply
            # the adjustment twice.
            s = await db.one(cur, "SELECT * FROM opname_sessions WHERE id = %s FOR UPDATE",
                             (sid,))
            if not s or s["status"] != "finished" or not s["variance"] or s["approved_at"]:
                continue
            await auth.assert_site_access(user, s["site_id"])
            site = await db.one(cur, "SELECT is_training FROM sites WHERE id = %s",
                                (s["site_id"],))
            loc = await db.one(cur, "SELECT location_id FROM baskets WHERE id = %s",
                               (s["basket_id"],))
            await ledger.apply(
                cur, site_id=s["site_id"], sku_id=s["sku_id"],
                location_id=loc["location_id"], qty_delta=s["variance"],
                movement_type="adjustment", actor_email=user.email,
                reason_code=body.reason_code, ref_type="opname_session", ref_id=sid,
                scan_source="manual", is_training=bool(site["is_training"]),
            )
            await db.run(cur, "UPDATE opname_sessions SET approved_at = NOW(), "
                              "approved_by = %s WHERE id = %s", (user.email, sid))
            await ledger.audit(cur, actor_email=user.email, entity="opname_session",
                               entity_id=sid, action="approve_adjustment",
                               after={"variance": s["variance"],
                                      "reason": body.reason_code})
            applied += 1
    return {"ok": True, "message": f"{applied} penyesuaian diterapkan. / {applied} adjustment(s) applied."}


# =============================================================================
# Deploy 3: /api/counts (canvas Section 8)
# =============================================================================

WIB = timedelta(hours=7)
_TABLES: dict[str, bool] = {}

REASONS = {
    "cycle": ("Siklus wajib", "Mandatory cycle"),
    "missing_item": ("Barang tidak ada saat ambil", "Item missing at picking"),
    "damaged_pick": ("Rusak saat ambil", "Damaged at picking"),
    "spv_added": ("Ditambah SPV", "Added by the SPV"),
    "monthly_full": ("Hitung penuh bulanan", "Monthly full count"),
}
STATUS_LABELS = {
    "pending": ("Belum", "Not yet"),
    "counting": ("Dihitung, bin dikunci", "Counting, bin locked"),
    "recount": ("Hitung ulang", "Recount"),
    "awaiting_spv": ("Menunggu Setujui SPV", "Waiting for the SPV"),
    "closed": ("Selesai", "Done"),
}
MONTHS_ID = ("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
DAYS_ID = ("Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu")


# --- small shared helpers (also used by quarantine, consumables, reports, todo) --

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def wib_today() -> date:
    return (utcnow() + WIB).date()


def wib_day_start_utc(d: date) -> datetime:
    """WIB midnight of a calendar day as the naive UTC the database stores."""
    return datetime(d.year, d.month, d.day) - WIB


def hub_short(site_code: str | None) -> str:
    """MAC-MA5 reads MA5 on every screen and code."""
    return (site_code or "").split("-")[-1]


def bin_label(location_code: str | None, site_code: str | None = None) -> str | None:
    """MA5-A-1-02 reads A-1-02 inside its own hub."""
    if not location_code:
        return location_code
    short = hub_short(site_code) if site_code else location_code.split("-")[0]
    if short and location_code.startswith(short + "-"):
        return location_code[len(short) + 1:]
    return location_code


def iso(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat() + "Z"
    return str(v)


def id_date(d: date) -> str:
    """Kamis 1 Okt."""
    return f"{DAYS_ID[d.weekday()]} {d.day} {MONTHS_ID[d.month - 1]}"


def nth_working_day(year: int, month: int, n: int) -> date:
    """The nth Monday-to-Friday of a month (no public holidays known to the WMS)."""
    d = date(year, month, 1)
    seen = 0
    while True:
        if d.weekday() < 5:
            seen += 1
            if seen >= n:
                return d
        d += timedelta(days=1)


def month_last_day(d: date) -> date:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


async def table_exists(name: str) -> bool:
    """Tables other agents add (bin_count_flags, special_bins, order_packs) may
    not have landed on a database yet; ask once per process."""
    if name not in _TABLES:
        row = await db.fetch_one(
            "SELECT COUNT(*) AS n FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", (name,))
        _TABLES[name] = bool(row and row["n"])
    return _TABLES[name]


async def rule_values() -> dict[str, int]:
    rows = await db.fetch_all("SELECT rule_key, enabled, value_num FROM alert_rules")
    return {r["rule_key"]: int(r["value_num"]) for r in rows if r["value_num"] is not None}


async def names_for(emails) -> dict[str, str]:
    emails = sorted({e for e in emails if e})
    if not emails:
        return {}
    rows = await db.fetch_all(
        f"SELECT email, name FROM users WHERE email IN ({db.placeholders(emails)})", emails)
    return {r["email"]: (r["name"] or r["email"]) for r in rows}


# --- the bin lock, for picking (agent O) -------------------------------------

async def locked_location_ids(site_id: int, cur=None) -> set[int]:
    """Bins being counted right now at a hub: nobody picks from them."""
    sql = ("SELECT DISTINCT location_id FROM count_attempts "
           "WHERE site_id = %s AND status = 'counting'")
    rows = await (db.many(cur, sql, (site_id,)) if cur is not None
                  else db.fetch_all(sql, (site_id,)))
    return {int(r["location_id"]) for r in rows}


async def is_bin_locked(location_id: int, cur=None) -> bool:
    """True from the bin label scan until Selesai hitung (board 8b)."""
    sql = ("SELECT 1 AS x FROM count_attempts WHERE location_id = %s "
           "AND status = 'counting' LIMIT 1")
    row = await (db.one(cur, sql, (location_id,)) if cur is not None
                 else db.fetch_one(sql, (location_id,)))
    return bool(row)


# --- the plan --------------------------------------------------------------------

async def _site(site_id: int) -> dict:
    s = await db.fetch_one("SELECT id, code, name, is_training FROM sites WHERE id = %s",
                           (site_id,))
    if not s:
        raise HTTPException(404, "Dark store tidak ditemukan. / Dark store not found.")
    return s


async def _bins(site_id: int) -> list[dict]:
    """Every racked bin of the hub with the SKU assigned to it."""
    return await db.fetch_all(
        "SELECT l.id AS location_id, l.code AS location_code, sa.sku_id, s.brand_id, "
        "       s.name_display "
        "FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id AND l.is_virtual = 0 "
        "JOIN skus s ON s.id = sa.sku_id "
        "WHERE sa.site_id = %s ORDER BY l.code", (site_id,))


def _period_days(c: dict) -> int:
    return max(1, int(c["every_n"]) * (7 if c["every_unit"] == "week" else 1))


def _cycle_due(c: dict, bins_sorted: list[dict], day: date, last: dict) -> list[dict]:
    """The cycle's bins due on `day`: the bins of one cycle are spread evenly over
    its period (bin i on day i mod P), plus any bin whose last count is older
    than the period (a missed day)."""
    p = _period_days(c)
    d = (day - c["start_date"]).days
    if d < 0:
        return []
    out = []
    for i, b in enumerate(bins_sorted):
        seen = last.get(b["location_id"])
        if d % p == i % p or (seen is not None and (day - seen).days > p):
            out.append(b)
    return out


def _cycle_next(c: dict, n_bins: int, today: date) -> date | None:
    p = _period_days(c)
    if n_bins == 0:
        return None
    for k in range(0, p + 1):
        day = today + timedelta(days=k)
        d = (day - c["start_date"]).days
        if d >= 0 and (n_bins >= p or (d % p) < n_bins):
            return day
    return None


async def _staff(site_id: int) -> list[str]:
    rows = await db.fetch_all(
        "SELECT u.email FROM users u JOIN user_sites us ON us.user_id = u.id "
        "WHERE us.site_id = %s AND u.active = 1 AND u.role IN ('staff','hub_operator') "
        "ORDER BY u.name, u.email", (site_id,))
    return [r["email"] for r in rows]


async def _other_counter(site_id: int, not_these: set[str]) -> str | None:
    """A second person for a recount: a staff member at the hub who has not
    counted this bin, preferring one marked ready on the floor."""
    staff = [e for e in await _staff(site_id) if e not in not_these]
    if not staff:
        return None
    if await table_exists("picker_presence"):
        ready = await db.fetch_all(
            f"SELECT user_email FROM picker_presence WHERE site_id = %s AND state = 'ready' "
            f"AND user_email IN ({db.placeholders(staff)})", [site_id] + staff)
        if ready:
            return ready[0]["user_email"]
    return staff[0]


async def _missing_flags(site_id: int, before_utc: datetime) -> list[dict]:
    """Bins where a missing item was declared (written by the floor, V28)."""
    if await table_exists("bin_count_flags"):
        return await db.fetch_all(
            "SELECT f.id, f.location_id, f.sku_id, f.ref_type, f.ref_id, f.created_at, "
            "       f.reason "
            "FROM bin_count_flags f WHERE f.site_id = %s AND f.status = 'open' "
            "  AND f.created_at < %s ORDER BY f.created_at", (site_id, before_utc))
    # Before V28: the shortfalls of the last day, at the bin they were picked from.
    return await db.fetch_all(
        "SELECT NULL AS id, pl.location_id, ps.sku_id, 'pick_shortfall' AS ref_type, "
        "       ps.id AS ref_id, ps.created_at, 'missing_item' AS reason "
        "FROM pick_shortfalls ps JOIN pick_lines pl ON pl.id = ps.pick_line_id "
        "WHERE ps.site_id = %s AND ps.created_at < %s "
        "  AND ps.created_at >= %s - INTERVAL 1 DAY AND pl.location_id IS NOT NULL",
        (site_id, before_utc, before_utc))


async def _flag_note(f: dict) -> str:
    when = f["created_at"] + WIB if f.get("created_at") else None
    label = None
    if f.get("ref_type") in ("order", "orders") and f.get("ref_id"):
        o = await db.fetch_one("SELECT hiryu_short_no, external_ref FROM orders WHERE id = %s",
                               (f["ref_id"],))
        label = o and (o["hiryu_short_no"] or o["external_ref"])
    elif f.get("ref_type") in ("pick_shortfall", "pick_line", "pick_task") and f.get("ref_id"):
        join = {"pick_shortfall": "JOIN pick_shortfalls x ON x.pick_line_id = pl.id",
                "pick_line": "", "pick_task": ""}[f["ref_type"]]
        where = {"pick_shortfall": "x.id", "pick_line": "pl.id", "pick_task": "pt.id"}[f["ref_type"]]
        o = await db.fetch_one(
            "SELECT o.hiryu_short_no, o.external_ref FROM pick_lines pl "
            "JOIN pick_tasks pt ON pt.id = pl.pick_task_id JOIN orders o ON o.id = pt.order_id "
            f"{join} WHERE {where} = %s LIMIT 1", (f["ref_id"],))
        label = o and (o["hiryu_short_no"] or o["external_ref"])
    parts = [p for p in (label, when and f"{when.day} {MONTHS_ID[when.month - 1]} {when:%H:%M}") if p]
    return " · ".join(parts) or None


async def ensure_plan(site_id: int, day: date | None = None) -> int:
    """Make today's count plan if it is not there yet. Returns the rows added.

    Idempotent (one row per hub, day and bin), so it is safe to call from every
    read of the plan, from Perlu tindakan, and from a morning timer.
    """
    day = day or wib_today()
    if day != wib_today():
        return 0
    bins = await _bins(site_id)
    by_loc = {b["location_id"]: b for b in bins}
    have = {r["location_id"]: r for r in await db.fetch_all(
        "SELECT id, location_id, is_full FROM count_tasks WHERE site_id = %s AND plan_date = %s",
        (site_id, day))}
    last = {r["location_id"]: r["d"] for r in await db.fetch_all(
        "SELECT location_id, MAX(plan_date) AS d FROM count_tasks "
        "WHERE site_id = %s AND status = 'closed' GROUP BY location_id", (site_id,))}

    want: dict[int, dict] = {}

    # Bins where a missing item was declared before today.
    for f in await _missing_flags(site_id, wib_day_start_utc(day)):
        if f["location_id"] in want:
            continue
        want[f["location_id"]] = {
            "sku_id": f["sku_id"] or (by_loc.get(f["location_id"]) or {}).get("sku_id"),
            "reason": f.get("reason") if f.get("reason") in ("missing_item", "damaged_pick")
            else "missing_item",
            "note": await _flag_note(f),
            "ref_type": "bin_count_flag" if f.get("id") else f.get("ref_type"),
            "ref_id": f.get("id") or f.get("ref_id")}

    # Ops HQ's mandatory cycles.
    for c in await db.fetch_all("SELECT * FROM count_cycles WHERE active = 1"):
        if c["scope"] == "sku":
            mine = [b for b in bins if b["sku_id"] == c["sku_id"]]
        else:
            mine = [b for b in bins if b["brand_id"] == c["brand_id"]]
        for b in _cycle_due(c, mine, day, last):
            if b["location_id"] not in want:
                unit = "minggu" if c["every_unit"] == "week" else "hari"
                want[b["location_id"]] = {
                    "sku_id": b["sku_id"], "reason": "cycle",
                    "note": f"setiap {c['every_n']} {unit}", "ref_type": "count_cycle",
                    "ref_id": c["id"]}

    # The monthly full count, on the month's last day.
    full = day == month_last_day(day)
    if full:
        for b in bins:
            want.setdefault(b["location_id"], {"sku_id": b["sku_id"], "reason": "monthly_full",
                                               "note": None, "ref_type": None, "ref_id": None})

    new = [(loc, w) for loc, w in want.items() if loc not in have]
    # No counter yet: the SPV sets who counts each bin (decided 7 Oct); To do reminds them.
    added = 0
    async with db.tx() as cur:
        for loc, w in new:
            added += 1 if await db.run(
                cur,
                "INSERT INTO count_tasks (site_id, plan_date, is_full, location_id, sku_id, reason, "
                " reason_note, reason_ref_type, reason_ref_id, assigned_to, status) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending') "
                "ON DUPLICATE KEY UPDATE count_tasks.id = count_tasks.id",
                (site_id, day, 1 if full else 0, loc, w["sku_id"], w["reason"], w["note"],
                 w["ref_type"], w["ref_id"], None)) else 0
        if full:
            await db.run(cur, "UPDATE count_tasks SET is_full = 1 WHERE site_id = %s "
                              "AND plan_date = %s", (site_id, day))
    return added


async def ensure_plans_all() -> None:
    """For a morning timer in main.py: every live hub's plan for today."""
    for s in await db.fetch_all("SELECT id FROM sites WHERE active = 1 AND is_training = 0 "
                                "AND site_type <> 'hub'"):
        try:
            await ensure_plan(s["id"])
        except Exception:  # one hub's problem must not stop the others
            import logging
            logging.getLogger("wms.counts").exception("count plan failed for site %s", s["id"])


async def add_missing_check(site_id: int, location_id: int, sku_id: int | None,
                            ref_id: int | None) -> int | None:
    """A missing item at picking: the bin is counted the same day, not only on
    tomorrow's plan. Called by outbound after a shortfall (ref_id: the shortfall).

    Puts the bin on today's plan as *missing_item* with no counter, so the SPV's
    *Tetapkan petugas hitung* reminder fires. Idempotent: a bin waiting or being
    counted today keeps its task. A result waiting for the SPV was counted
    against the stock before this write-off, so approving it would adjust the
    bin twice: that task goes back to recount, unassigned, for a fresh count.

    A bin counted and closed earlier today keeps its closed task: reopening it
    would wipe the approved difference and Ops HQ's review, and one bin has one
    task per day. Its open bin_count_flags row (written with the shortfall,
    after the close) puts it on the next plan instead. Returns the task id
    either way; the caller reads the status to know if it is counted today.
    When today's count closes, _close_flags closes the open flag of this bin
    too, so tomorrow's plan does not count it again. Never raises: a bad input
    is logged and gives None."""
    import logging
    log = logging.getLogger("wms.counts")
    try:
        site_id, location_id = int(site_id), int(location_id)
        loc = await db.fetch_one("SELECT id FROM locations WHERE id = %s AND site_id = %s",
                                 (location_id, site_id))
        if not loc:
            log.warning("missing check: location %s is not at site %s", location_id, site_id)
            return None
        await ensure_plan(site_id)
        day = wib_today()
        note = None
        if ref_id:
            try:
                note = await _flag_note({"ref_type": "pick_shortfall", "ref_id": ref_id,
                                         "created_at": utcnow()})
            except Exception:  # the note is a nicety
                note = None
        async with db.tx() as cur:
            t = await db.one(cur, "SELECT * FROM count_tasks WHERE site_id = %s "
                                  "AND plan_date = %s AND location_id = %s FOR UPDATE",
                             (site_id, day, location_id))
            if t and t["status"] in ("pending", "recount", "counting"):
                # A recount takes the expected number again when it finishes,
                # so it already sees this write-off.
                return t["id"]
            if t and t["status"] == "awaiting_spv":
                # Counted before the write-off: a fresh count by someone else.
                await db.run(cur, "UPDATE count_tasks SET status = 'recount', assigned_to = NULL, "
                                  "qty_final = NULL, qty_expected = NULL, "
                                  "reason_note = LEFT(CONCAT_WS(' · ', reason_note, %s), 255) "
                                  "WHERE id = %s",
                             ("hitung lagi, ada barang tidak ada sesudah hitungan", t["id"]))
                await ledger.audit(cur, actor_email="wms", entity="count_task", entity_id=t["id"],
                                   action="missing_check_recount",
                                   before={"status": t["status"], "qty_final": t["qty_final"],
                                           "qty_expected": t["qty_expected"],
                                           "assigned_to": t["assigned_to"]},
                                   after={"status": "recount", "ref_type": "pick_shortfall",
                                          "ref_id": ref_id})
                return t["id"]
            if t:
                # Closed earlier today: left as it is (see above). The open
                # flag takes the bin to the next plan.
                await ledger.audit(cur, actor_email="wms", entity="count_task", entity_id=t["id"],
                                   action="missing_check_next_plan",
                                   after={"location_id": location_id, "sku_id": sku_id,
                                          "ref_type": "pick_shortfall", "ref_id": ref_id,
                                          "outcome": t["outcome"], "hq_review": t["hq_review"]})
                return t["id"]
            else:
                task_id = await db.run(
                    cur, "INSERT INTO count_tasks (site_id, plan_date, location_id, sku_id, reason, "
                         "reason_note, reason_ref_type, reason_ref_id, assigned_to, status) "
                         "VALUES (%s,%s,%s,%s,'missing_item',%s,'pick_shortfall',%s,NULL,'pending')",
                    (site_id, day, location_id, sku_id, note, ref_id))
            await ledger.audit(cur, actor_email="wms", entity="count_task", entity_id=task_id,
                               action="missing_check_added",
                               after={"location_id": location_id, "sku_id": sku_id,
                                      "ref_id": ref_id, "reopened": bool(t)})
        return task_id
    except Exception:
        log.exception("missing check failed: site %s, location %s, sku %s, ref %s",
                      site_id, location_id, sku_id, ref_id)
        return None


async def _close_flags(cur, task: dict, actor: str) -> None:
    if not await table_exists("bin_count_flags"):
        return
    await db.run(cur, "UPDATE bin_count_flags SET status = 'counted', closed_by = %s, "
                      "closed_at = UTC_TIMESTAMP() WHERE location_id = %s AND status = 'open' "
                      "AND created_at <= UTC_TIMESTAMP()", (actor, task["location_id"]))


# --- shapes -----------------------------------------------------------------------

class CountStartIn(BaseModel):
    site_id: int
    bin_code: str = Field(..., description="The bin label as scanned or typed (A-1-02 or MA5-A-1-02)")
    manual: bool = Field(default=False, description="Mode manual: the bin tapped in Bin saya, no label "
                                                    "scan. Only while Mode manual is on; the count is "
                                                    "typed (blind) and waits for the SPV.")


class CountScanIn(BaseModel):
    code: str
    idempotency_key: str | None = None


class CountUndoIn(BaseModel):
    idempotency_key: str | None = None


class CountFinishIn(BaseModel):
    blind_qty: int | None = Field(default=None, ge=0,
                                  description="Hitung tanpa pindai: the number typed. Empty = count by scan.")


class CountAddIn(BaseModel):
    site_id: int
    bin_code: str
    note: str | None = None
    assign_to: str | None = None


class CountAssignIn(BaseModel):
    email: str | None = None


class CountAssignAllIn(BaseModel):
    site_id: int
    email: str


class CountIdsIn(BaseModel):
    task_ids: list[int]
    note: str | None = None


class CountNoteIn(BaseModel):
    note: str | None = None


class CountRecountIn(BaseModel):
    assign_to: str | None = None


class CycleIn(BaseModel):
    scope: str = Field(..., pattern="^(sku|brand)$")
    sku_id: int | None = None
    brand_id: int | None = None
    every_n: int = Field(..., ge=1, le=365)
    every_unit: str = Field(default="day", pattern="^(day|week)$")
    active: bool = True


async def _resolve_bin(site: dict, code: str) -> dict:
    code = (code or "").strip().upper()
    short = hub_short(site["code"])
    full = code if code.startswith(short + "-") else f"{short}-{code}"
    row = await db.fetch_one(
        "SELECT l.id, l.code FROM locations l WHERE l.site_id = %s AND l.code IN (%s, %s)",
        (site["id"], code, full))
    if not row:
        raise HTTPException(404, f"Bin {code} tidak ada di {short}. / Bin {code} is not at {short}.")
    return row


def _task_out(t: dict, site_code: str, names: dict, *, show_expected: bool,
              attempts: list[dict] | None = None, last: date | None = None) -> dict:
    r = REASONS.get(t["reason"], (t["reason"], t["reason"]))
    st = STATUS_LABELS.get(t["status"], (t["status"], t["status"]))
    out = {
        "id": t["id"], "site_id": t["site_id"], "plan_date": str(t["plan_date"]),
        "is_full": bool(t["is_full"]),
        "location_id": t["location_id"], "location_code": t.get("location_code"),
        "bin": bin_label(t.get("location_code"), site_code),
        "sku_id": t["sku_id"], "sku_name": t.get("name_display"), "photo_key": t.get("photo_key"),
        "reason": t["reason"], "reason_id": r[0], "reason_en": r[1], "reason_note": t["reason_note"],
        "last_counted": str(last) if last else None,
        "assigned_to": t["assigned_to"], "assigned_name": names.get(t["assigned_to"]),
        "status": t["status"], "status_id": st[0], "status_en": st[1],
        "outcome": t["outcome"],
        "qty_final": t["qty_final"] if (show_expected or t["status"] == "closed") else None,
        "approved_by": t["approved_by"], "approved_name": names.get(t["approved_by"]),
        "approved_at": iso(t["approved_at"]),
        "hq_review": t["hq_review"], "hq_reviewed_by": t["hq_reviewed_by"],
        "hq_reviewed_name": names.get(t["hq_reviewed_by"]), "hq_reviewed_at": iso(t["hq_reviewed_at"]),
        "hq_note": t["hq_note"],
    }
    if show_expected:
        exp = t["qty_expected"]
        if exp is None and attempts:
            exp = next((a["qty_expected"] for a in reversed(attempts)
                        if a["qty_expected"] is not None), None)
        out["qty_expected"] = exp
        out["variance"] = t["variance"]
        if t["variance"] is None and attempts and exp is not None:
            fin = [a for a in attempts if a["status"] == "finished"]
            if fin:
                out["variance"] = fin[-1]["qty_counted"] - exp
    if attempts is not None:
        out["attempts"] = [{
            "attempt_id": a["id"], "attempt_no": a["attempt_no"], "counted_by": a["counted_by"],
            "started_at": iso(a.get("started_at")),
            "counted_name": names.get(a["counted_by"]), "method": a["method"],
            "status": a["status"],
            "qty_counted": a["qty_counted"] if (show_expected or a["status"] != "counting") else None,
            "finished_at": iso(a["finished_at"]),
        } for a in attempts]
    return out


_TASK_SQL = (
    "SELECT t.*, l.code AS location_code, s.name_display, s.photo_key "
    "FROM count_tasks t JOIN locations l ON l.id = t.location_id "
    "LEFT JOIN skus s ON s.id = t.sku_id ")


async def _attempts_for(task_ids: list[int]) -> dict[int, list[dict]]:
    if not task_ids:
        return {}
    out: dict[int, list[dict]] = {}
    for a in await db.fetch_all(
            f"SELECT * FROM count_attempts WHERE task_id IN ({db.placeholders(task_ids)}) "
            "ORDER BY task_id, attempt_no", task_ids):
        out.setdefault(a["task_id"], []).append(a)
    return out


async def _task(task_id: int, user: auth.User) -> tuple[dict, dict]:
    t = await db.fetch_one(_TASK_SQL + "WHERE t.id = %s", (task_id,))
    if not t:
        raise HTTPException(404, "Tugas hitung tidak ditemukan. / Count task not found.")
    site = await auth.assert_site_access(user, t["site_id"])
    return t, site


# --- the plan and the results (8a, 8c) ------------------------------------------

@router.get("/counts/plan")
async def count_plan(site_id: int, day: str | None = None,
                     user: auth.User = Depends(auth.current_user)):
    """Hitung stok, Rencana hari ini: today's bins with why, who and the status,
    the monthly full count banner and Ops HQ's cycles."""
    site = await auth.assert_site_access(user, site_id)
    d = date.fromisoformat(day) if day else wib_today()
    await ensure_plan(site_id, d)
    rows = await db.fetch_all(_TASK_SQL + "WHERE t.site_id = %s AND t.plan_date = %s "
                              "ORDER BY FIELD(t.status,'counting','recount','pending','awaiting_spv','closed'), "
                              "l.code", (site_id, d))
    last = {r["location_id"]: r["d"] for r in await db.fetch_all(
        "SELECT location_id, MAX(plan_date) AS d FROM count_tasks WHERE site_id = %s "
        "AND status = 'closed' AND plan_date < %s GROUP BY location_id", (site_id, d))}
    attempts = await _attempts_for([r["id"] for r in rows])
    names = await names_for([r["assigned_to"] for r in rows] + [r["approved_by"] for r in rows] +
                            [a["counted_by"] for lst in attempts.values() for a in lst])
    show = user.at_least("supervisor")
    tasks = [_task_out(r, site["code"], names, show_expected=show,
                       attempts=attempts.get(r["id"], []), last=last.get(r["location_id"]))
             for r in rows]
    full = await full_count_status([site_id], d)
    return {
        "site_id": site_id, "site_code": hub_short(site["code"]), "date": str(d),
        "date_label": id_date(d),
        "done": sum(1 for t in rows if t["status"] == "closed"), "total": len(rows),
        "full_count": full, "tasks": tasks,
        "cycles": await _cycles_out(site_id, d),
    }


@router.get("/counts/results")
async def count_results(site_id: int, day: str | None = None, days: int = Query(default=1, ge=1, le=31),
                        user: auth.User = Depends(auth.current_user)):
    """Hitung stok, Hasil: each counted bin with Sistem, Hitung, Hitung ulang,
    Selisih, step 1 Setujui SPV and step 2 Tinjau Ops HQ. Staff do not get the
    expected number."""
    site = await auth.assert_site_access(user, site_id)
    d = date.fromisoformat(day) if day else wib_today()
    rows = await db.fetch_all(
        _TASK_SQL + "WHERE t.site_id = %s AND t.plan_date > %s AND t.plan_date <= %s "
        "AND (t.status IN ('recount','awaiting_spv','closed') "
        "     OR EXISTS (SELECT 1 FROM count_attempts a WHERE a.task_id = t.id AND a.status = 'finished')) "
        "ORDER BY FIELD(t.status,'awaiting_spv','recount','counting','pending','closed'), l.code",
        (site_id, d - timedelta(days=days), d))
    attempts = await _attempts_for([r["id"] for r in rows])
    emails = [r["approved_by"] for r in rows] + [r["hq_reviewed_by"] for r in rows] + \
             [r["assigned_to"] for r in rows] + \
             [a["counted_by"] for lst in attempts.values() for a in lst]
    names = await names_for(emails)
    show = user.at_least("supervisor")
    out = [_task_out(r, site["code"], names, show_expected=show, attempts=attempts.get(r["id"], []))
           for r in rows]
    return {"site_id": site_id, "date": str(d),
            "auto_closed": sum(1 for r in rows if r["outcome"] == "auto_closed"),
            "awaiting_spv": sum(1 for r in rows if r["status"] == "awaiting_spv"),
            "tasks": out}


@router.get("/counts/mine")
async def my_counts(site_id: int, user: auth.User = Depends(auth.current_user)):
    """The phone list: my bins today (and recounts given to me), next first."""
    site = await auth.assert_site_access(user, site_id)
    await ensure_plan(site_id)
    rows = await db.fetch_all(
        _TASK_SQL + "WHERE t.site_id = %s AND t.plan_date <= %s AND t.plan_date >= %s "
        "AND t.assigned_to = %s ORDER BY FIELD(t.status,'counting','recount','pending',"
        "'awaiting_spv','closed'), l.code",
        (site_id, wib_today(), wib_today() - timedelta(days=2), user.email))
    rows = [r for r in rows if r["plan_date"] == wib_today() or r["status"] in ("recount", "counting")]
    open_attempt = await db.fetch_one(
        "SELECT id, task_id FROM count_attempts WHERE site_id = %s AND counted_by = %s "
        "AND status = 'counting' ORDER BY id DESC LIMIT 1", (site_id, user.email))
    return {"site_id": site_id, "total": len(rows),
            "done": sum(1 for r in rows if r["status"] in ("awaiting_spv", "closed")),
            "open_attempt_id": open_attempt["id"] if open_attempt else None,
            "tasks": [_task_out(r, site["code"], {}, show_expected=False) for r in rows]}


async def full_count_status(site_ids: list[int], day: date) -> dict:
    """The month's full count: date, approve-by (Nth working day of the next
    month), bins planned and closed, and when the last one was approved."""
    last = month_last_day(day)
    nxt = last + timedelta(days=1)
    rule = await rule_values()
    by = nth_working_day(nxt.year, nxt.month, rule.get("count_full_workdays", 3))
    row = {"total": 0, "closed": 0, "approved_at": None}
    if site_ids:
        row = await db.fetch_one(
            "SELECT COUNT(*) AS total, SUM(status = 'closed') AS closed, "
            "       MAX(COALESCE(approved_at, closed_at)) AS approved_at "
            f"FROM count_tasks WHERE site_id IN ({db.placeholders(site_ids)}) "
            "AND is_full = 1 AND plan_date = %s", site_ids + [last]) or row
    bins = 0
    if site_ids:
        b = await db.fetch_one(
            "SELECT COUNT(*) AS n FROM slot_assignments sa JOIN baskets bk ON bk.id = sa.basket_id "
            "JOIN locations l ON l.id = bk.location_id AND l.is_virtual = 0 "
            f"WHERE sa.site_id IN ({db.placeholders(site_ids)})", site_ids)
        bins = int(b["n"] or 0)
    total, closed = int(row["total"] or 0), int(row["closed"] or 0)
    return {"date": str(last), "date_label": id_date(last), "approve_by": str(by),
            "approve_by_label": id_date(by), "bins": bins, "planned": total, "closed": closed,
            "approved": total > 0 and closed == total,
            "approved_at": iso(row["approved_at"]) if total > 0 and closed == total else None}


async def _cycles_out(site_id: int | None, today: date) -> list[dict]:
    rows = await db.fetch_all(
        "SELECT c.*, s.name_display, b.name AS brand_name FROM count_cycles c "
        "LEFT JOIN skus s ON s.id = c.sku_id LEFT JOIN brands b ON b.id = c.brand_id "
        "WHERE c.active = 1 ORDER BY c.created_at")
    bins = await _bins(site_id) if site_id else []
    out = []
    for c in rows:
        mine = [b for b in bins if (b["sku_id"] == c["sku_id"] if c["scope"] == "sku"
                                    else b["brand_id"] == c["brand_id"])]
        p = _period_days(c)
        n = len(mine)
        nxt = _cycle_next(c, n, today) if site_id else None
        unit_id = "minggu" if c["every_unit"] == "week" else "hari"
        unit_en = "weeks" if c["every_unit"] == "week" else "days"
        out.append({
            "id": c["id"], "scope": c["scope"], "sku_id": c["sku_id"], "brand_id": c["brand_id"],
            "label": c["name_display"] if c["scope"] == "sku" else f"Semua SKU {c['brand_name']}",
            "every_n": c["every_n"], "every_unit": c["every_unit"],
            "every_id": f"setiap {c['every_n']} {unit_id}", "every_en": f"every {c['every_n']} {unit_en}",
            "start_date": str(c["start_date"]), "bins": n,
            "per_day_min": n // p if n else 0, "per_day_max": -(-n // p) if n else 0,
            "next_date": str(nxt) if nxt else None,
            "next_label": ("hari ini, " + id_date(nxt)) if nxt == today else (id_date(nxt) if nxt else None),
            "created_by": c["created_by"], "updated_by": c["updated_by"],
        })
    return out


# --- SPV: add a bin, assign a counter -------------------------------------------

@router.post("/counts/plan/add", status_code=201)
async def add_bin(body: CountAddIn, user: auth.User = Depends(auth.require("supervisor"))):
    """Tambah bin: the bin joins today's plan as Ditambah SPV."""
    site = await auth.assert_site_access(user, body.site_id)
    loc = await _resolve_bin(site, body.bin_code)
    sa = await db.fetch_one(
        "SELECT sa.sku_id FROM slot_assignments sa JOIN baskets bk ON bk.id = sa.basket_id "
        "WHERE bk.location_id = %s", (loc["id"],))
    when = (utcnow() + WIB).strftime("%H:%M")
    me = (await names_for([user.email])).get(user.email, user.email)
    note = " · ".join(x for x in (me.split(" ")[0], when, (body.note or "").strip()) if x)
    async with db.tx() as cur:
        existing = await db.one(cur, "SELECT id, status FROM count_tasks WHERE site_id = %s "
                                     "AND plan_date = %s AND location_id = %s FOR UPDATE",
                                (body.site_id, wib_today(), loc["id"]))
        if existing and existing["status"] != "closed":
            raise HTTPException(409, "Bin ini sudah ada di rencana hari ini. / This bin is already in today's plan.")
        if existing:
            rv = await db.one(cur, "SELECT hq_review FROM count_tasks WHERE id = %s", (existing["id"],))
            if rv and rv["hq_review"] == "pending":
                raise HTTPException(409, "Bin ini sudah dihitung hari ini dan masih menunggu tinjauan Ops HQ. "
                                         "Tambahkan besok. / This bin was counted today and still waits for "
                                         "Ops HQ's review. Add it tomorrow.")
        if existing:
            # Counted already today: count it again.
            await db.run(cur, "UPDATE count_tasks SET status = 'pending', outcome = NULL, reason = "
                              "'spv_added', reason_note = %s, added_by = %s, assigned_to = %s, "
                              "qty_final = NULL, variance = NULL, closed_at = NULL, approved_by = NULL, "
                              "approved_at = NULL, hq_review = NULL WHERE id = %s",
                         (note, user.email, body.assign_to, existing["id"]))
            task_id = existing["id"]
        else:
            staff = await _staff(body.site_id)
            task_id = await db.run(
                cur, "INSERT INTO count_tasks (site_id, plan_date, location_id, sku_id, reason, "
                     "reason_note, added_by, assigned_to) VALUES (%s,%s,%s,%s,'spv_added',%s,%s,%s)",
                (body.site_id, wib_today(), loc["id"], sa["sku_id"] if sa else None, note,
                 user.email, body.assign_to or (staff[0] if staff else None)))
        await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=task_id,
                           action="spv_added", after={"bin": loc["code"], "note": body.note})
    return {"ok": True, "task_id": task_id,
            "message": f"{bin_label(loc['code'], site['code'])} masuk rencana hari ini. / Added to today's plan."}


@router.put("/counts/tasks/{task_id}/assign")
async def assign_counter(task_id: int, body: CountAssignIn,
                         user: auth.User = Depends(auth.require("supervisor"))):
    """Atur petugas: who counts this bin."""
    t, _ = await _task(task_id, user)
    if t["status"] not in ("pending", "recount"):
        raise HTTPException(409, "Bin ini sedang atau sudah dihitung. / This bin is being or has been counted.")
    if body.email and t["status"] == "recount":
        prior = {a["counted_by"] for a in (await _attempts_for([task_id])).get(task_id, [])}
        if body.email in prior:
            raise HTTPException(409, "Hitung ulang harus oleh orang lain. / A recount is always done by "
                                     "a different person.")
    await db.execute("UPDATE count_tasks SET assigned_to = %s WHERE id = %s", (body.email, task_id))
    return {"ok": True}


@router.put("/counts/plan/assign-unassigned")
async def assign_unassigned(body: CountAssignAllIn,
                            user: auth.User = Depends(auth.require("supervisor"))):
    """Atur petugas untuk semua bin yang belum punya petugas hari ini. A recount
    never goes to someone who already counted that bin; those bins are skipped
    and stay for the SPV to set one by one."""
    await auth.assert_site_access(user, body.site_id)
    today = wib_today()
    rows = await db.fetch_all(
        "SELECT id, status FROM count_tasks WHERE site_id = %s AND plan_date <= %s "
        "AND status IN ('pending','recount') AND assigned_to IS NULL", (body.site_id, today))
    attempts = await _attempts_for([r["id"] for r in rows]) if rows else {}
    done, skipped = 0, 0
    for r in rows:
        prior = {a["counted_by"] for a in attempts.get(r["id"], [])}
        if r["status"] == "recount" and body.email in prior:
            skipped += 1
            continue
        await db.execute("UPDATE count_tasks SET assigned_to = %s WHERE id = %s AND assigned_to IS NULL",
                         (body.email, r["id"]))
        done += 1
    return {"ok": True, "assigned": done, "skipped": skipped}


# --- staff: count a bin (8b) -------------------------------------------------------

async def _attempt(attempt_id: int, user: auth.User) -> dict:
    a = await db.fetch_one("SELECT * FROM count_attempts WHERE id = %s", (attempt_id,))
    if not a:
        raise HTTPException(404, "Hitungan tidak ditemukan. / Count not found.")
    await auth.assert_site_access(user, a["site_id"])
    return a


async def _attempt_view(a: dict, t: dict, site: dict, user: auth.User) -> dict:
    last = await db.fetch_one(
        "SELECT outcome, created_at FROM count_scans WHERE attempt_id = %s AND undone = 0 "
        "ORDER BY id DESC LIMIT 1", (a["id"],))
    mine = await db.fetch_all(
        "SELECT id FROM count_tasks WHERE site_id = %s AND plan_date = %s AND assigned_to = %s "
        "ORDER BY id", (t["site_id"], wib_today(), user.email))
    ids = [r["id"] for r in mine]
    return {
        "attempt_id": a["id"], "task_id": t["id"], "attempt_no": a["attempt_no"],
        "is_recount": a["attempt_no"] > 1, "method": a["method"], "status": a["status"],
        "location_code": t["location_code"], "bin": bin_label(t["location_code"], site["code"]),
        "sku_id": t["sku_id"], "sku_name": t.get("name_display"), "photo_key": t.get("photo_key"),
        "qty_counted": a["qty_counted"], "bin_locked": a["status"] == "counting",
        "last_scan": ({"outcome": last["outcome"], "at": iso(last["created_at"])} if last else None),
        "position": (ids.index(t["id"]) + 1) if t["id"] in ids else None, "of": len(ids) or None,
    }


@router.post("/counts/start", status_code=201)
async def start_count(body: CountStartIn, user: auth.User = Depends(auth.current_user)):
    """Scan the bin label: the count starts and the bin is locked for picking.
    The expected number is never returned. Mode manual (manual=true): the bin is
    tapped instead, the attempt starts as a count without scanning (method
    'blind') and the start is recorded as manual."""
    site = await auth.assert_site_access(user, body.site_id)
    if body.manual:
        from routers import manual_mode
        if not await manual_mode.active(body.site_id):
            raise HTTPException(409, "Mode manual tidak aktif di dark store ini. Pindai label bin. / "
                                     "Manual mode is not on at this dark store. Scan the bin label.")
    await ensure_plan(body.site_id)
    loc = await _resolve_bin(site, body.bin_code)
    async with db.tx() as cur:
        t = await db.one(cur, "SELECT * FROM count_tasks WHERE site_id = %s AND location_id = %s "
                              "AND status IN ('pending','recount','counting') "
                              "ORDER BY plan_date DESC LIMIT 1 FOR UPDATE", (body.site_id, loc["id"]))
        if not t:
            raise HTTPException(404, "Bin ini tidak ada di rencana hitung. Minta SPV menambahkannya. / "
                                     "This bin is not in the count plan. Ask the SPV to add it.")
        if not user.at_least("supervisor") and t["status"] != "counting":
            if not t["assigned_to"]:
                raise HTTPException(409, "SPV belum menetapkan petugas untuk bin ini. / "
                                         "The SPV has not assigned a counter to this bin yet.")
            if t["assigned_to"] != user.email:
                who = (await names_for([t["assigned_to"]])).get(t["assigned_to"]) or t["assigned_to"]
                raise HTTPException(409, f"Bin ini untuk {who}. / This bin is for {who}.")
        attempts = await db.many(cur, "SELECT * FROM count_attempts WHERE task_id = %s "
                                      "ORDER BY attempt_no", (t["id"],))
        live = [a for a in attempts if a["status"] == "counting"]
        if live:
            if live[0]["counted_by"] != user.email:
                who = (await names_for([live[0]["counted_by"]])).get(live[0]["counted_by"])
                raise HTTPException(409, f"{who} sedang menghitung bin ini. / {who} is counting this bin.")
            attempt_id = live[0]["id"]
        else:
            done_by = {a["counted_by"] for a in attempts if a["status"] == "finished"}
            if t["status"] == "recount" and user.email in done_by:
                raise HTTPException(409, "Hitung ulang harus oleh orang lain. / A recount is always done "
                                         "by a different person.")
            no = (max([a["attempt_no"] for a in attempts]) + 1) if attempts else 1
            attempt_id = await db.run(
                cur, "INSERT INTO count_attempts (task_id, site_id, location_id, attempt_no, counted_by, "
                     "method, status) VALUES (%s,%s,%s,%s,%s,%s,'counting')",
                (t["id"], t["site_id"], t["location_id"], no, user.email,
                 "blind" if body.manual else "scan"))
            await db.run(cur, "UPDATE count_tasks SET status = 'counting', assigned_to = %s "
                              "WHERE id = %s", (user.email, t["id"]))
            if body.manual:
                await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=t["id"],
                                   action="count_started_manual",
                                   after={"attempt": no, "bin": loc["code"], "manual": True})
    a = await db.fetch_one("SELECT * FROM count_attempts WHERE id = %s", (attempt_id,))
    t = await db.fetch_one(_TASK_SQL + "WHERE t.id = %s", (a["task_id"],))
    return await _attempt_view(a, t, site, user)


@router.get("/counts/attempts/{attempt_id}")
async def get_attempt(attempt_id: int, user: auth.User = Depends(auth.current_user)):
    a = await _attempt(attempt_id, user)
    t = await db.fetch_one(_TASK_SQL + "WHERE t.id = %s", (a["task_id"],))
    site = await _site(a["site_id"])
    return await _attempt_view(a, t, site, user)


@router.post("/counts/attempts/{attempt_id}/scan")
async def count_unit(attempt_id: int, body: CountScanIn, user: auth.User = Depends(auth.current_user)):
    """One unit scanned: the big number counts up. Another product is noted,
    not counted."""
    replayed = await ledger.replay(body.idempotency_key, "count_scan")
    if replayed:
        return replayed
    a = await _attempt(attempt_id, user)
    if a["status"] != "counting":
        raise HTTPException(409, "Hitungan ini sudah selesai. / This count is finished.")
    if a["counted_by"] != user.email:
        raise HTTPException(409, "Ini hitungan orang lain. / This is someone else's count.")
    t = await db.fetch_one("SELECT sku_id FROM count_tasks WHERE id = %s", (a["task_id"],))
    code = body.code.strip()
    sku = await common.sku_by_barcode(code)
    if not sku:
        plate = await common.plate_by_code(code)
        if plate and plate["sku_id"]:
            sku = {"id": plate["sku_id"], "name_display": plate.get("sku_name")}
    async with db.tx() as cur:
        locked = await db.one(cur, "SELECT qty_counted, status FROM count_attempts WHERE id = %s "
                                   "FOR UPDATE", (attempt_id,))
        if locked["status"] != "counting":
            raise HTTPException(409, "Hitungan ini sudah selesai. / This count is finished.")
        if not sku:
            outcome, msg = "unknown", "Barcode tidak dikenal, dicatat. / Unknown barcode, noted."
        elif t["sku_id"] and sku["id"] != t["sku_id"]:
            outcome = "foreign"
            msg = (f"Barang lain: {sku.get('name_display')}. Dicatat, tidak dihitung. / "
                   f"Another product: {sku.get('name_display')}. Noted, not counted.")
        else:
            outcome, msg = "counted", "Pindaian cocok. / Scan matches."
        await db.run(cur, "INSERT INTO count_scans (attempt_id, code, sku_id, outcome) "
                          "VALUES (%s,%s,%s,%s)", (attempt_id, code, sku["id"] if sku else None, outcome))
        qty = locked["qty_counted"] + (1 if outcome == "counted" else 0)
        if outcome == "counted":
            await db.run(cur, "UPDATE count_attempts SET qty_counted = %s WHERE id = %s",
                         (qty, attempt_id))
        result = {"ok": outcome == "counted", "outcome": outcome, "qty_counted": qty,
                  "message": msg, "at": iso(utcnow())}
        await ledger.remember(cur, body.idempotency_key, "count_scan", result)
    return result


@router.post("/counts/attempts/{attempt_id}/undo")
async def undo_last_scan(attempt_id: int, body: CountUndoIn | None = None,
                         user: auth.User = Depends(auth.current_user)):
    """Batalkan pindaian terakhir. Sent again after a lost connection, the same key
    replays the first answer instead of taking back a second scan."""
    key = body.idempotency_key if body else None
    replayed = await ledger.replay(key, "count_undo")
    if replayed:
        return replayed
    a = await _attempt(attempt_id, user)
    if a["status"] != "counting" or a["counted_by"] != user.email:
        raise HTTPException(409, "Tidak ada hitungan berjalan. / No count in progress.")
    async with db.tx() as cur:
        last = await db.one(cur, "SELECT id, outcome FROM count_scans WHERE attempt_id = %s "
                                 "AND undone = 0 ORDER BY id DESC LIMIT 1 FOR UPDATE", (attempt_id,))
        if not last:
            raise HTTPException(409, "Belum ada pindaian. / Nothing scanned yet.")
        await db.run(cur, "UPDATE count_scans SET undone = 1 WHERE id = %s", (last["id"],))
        if last["outcome"] == "counted":
            await db.run(cur, "UPDATE count_attempts SET qty_counted = GREATEST(0, qty_counted - 1) "
                              "WHERE id = %s", (attempt_id,))
        row = await db.one(cur, "SELECT qty_counted FROM count_attempts WHERE id = %s", (attempt_id,))
        result = {"ok": True, "qty_counted": row["qty_counted"],
                  "message": "Pindaian terakhir dibatalkan. / Last scan undone."}
        await ledger.remember(cur, key, "count_undo", result)
    return result


@router.post("/counts/attempts/{attempt_id}/abandon")
async def abandon_count(attempt_id: int, user: auth.User = Depends(auth.current_user)):
    """Stop without a result: the bin unlocks and goes back to the list."""
    a = await _attempt(attempt_id, user)
    if a["status"] != "counting":
        raise HTTPException(409, "Hitungan ini sudah selesai. / This count is finished.")
    if a["counted_by"] != user.email and not user.at_least("supervisor"):
        raise HTTPException(409, "Ini hitungan orang lain. / This is someone else's count.")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE count_attempts SET status = 'abandoned', finished_at = UTC_TIMESTAMP() "
                          "WHERE id = %s", (attempt_id,))
        await db.run(cur, "UPDATE count_tasks SET status = IF(%s > 1, 'recount', 'pending') "
                          "WHERE id = %s AND status = 'counting'", (a["attempt_no"], a["task_id"]))
        if a["counted_by"] != user.email:
            await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=a["task_id"],
                               action="spv_released",
                               after={"attempt": a["attempt_no"], "counted_by": a["counted_by"]})
    return {"ok": True, "message": "Bin dilepas. / Bin released."}


@router.post("/counts/attempts/{attempt_id}/finish")
async def finish_count(attempt_id: int, body: CountFinishIn,
                       user: auth.User = Depends(auth.current_user)):
    """Selesai hitung. A count by scan that matches closes by itself; a blind
    count waits for the SPV; a first count that differs goes to another person
    for a recount. The expected number is not revealed."""
    a = await _attempt(attempt_id, user)
    if a["counted_by"] != user.email:
        raise HTTPException(409, "Ini hitungan orang lain. / This is someone else's count.")
    from routers import manual_mode
    manual_on = await manual_mode.active(a["site_id"])
    async with db.tx() as cur:
        a = await db.one(cur, "SELECT * FROM count_attempts WHERE id = %s FOR UPDATE", (attempt_id,))
        if a["status"] != "counting":
            raise HTTPException(409, "Hitungan ini sudah selesai. / This count is finished.")
        t = await db.one(cur, "SELECT * FROM count_tasks WHERE id = %s FOR UPDATE", (a["task_id"],))
        method = "blind" if body.blind_qty is not None else "scan"
        counted = body.blind_qty if body.blind_qty is not None else a["qty_counted"]
        # Mode manual: started by a tap (the attempt began as 'blind'), or typed while it is on.
        started_by_tap = a["method"] == "blind"
        manual = started_by_tap or (method == "blind" and manual_on)
        exp_row = await db.one(cur, "SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM inventory_balances "
                                    "WHERE site_id = %s AND location_id = %s AND sku_id = %s",
                               (t["site_id"], t["location_id"], t["sku_id"] or 0))
        expected = int(exp_row["q"] or 0)
        await db.run(cur, "UPDATE count_attempts SET status = 'finished', finished_at = UTC_TIMESTAMP(), "
                          "method = %s, qty_counted = %s, qty_expected = %s WHERE id = %s",
                     (method, counted, expected, attempt_id))
        diff = counted - expected
        first = a["attempt_no"] == 1
        sets = {"qty_expected": expected}
        if first:
            sets["first_match"] = 1 if diff == 0 else 0
        # A count started by a tap (Mode manual) always waits for the SPV.
        if diff == 0 and method == "scan" and not started_by_tap:
            sets.update(status="closed", outcome="auto_closed", qty_final=counted, variance=0,
                        hq_review="not_needed")
            msg = "Cocok. Selesai. / Matches. Done."
            state = "closed"
        elif diff != 0 and first:
            sets.update(status="recount", assigned_to=None)
            msg = ("Hasil dicatat. Bin ini dihitung ulang oleh orang lain. / "
                   "Result saved. Another person will recount this bin.")
            state = "recount"
        else:
            sets.update(status="awaiting_spv", qty_final=counted)
            msg = ("Hasil dicatat, menunggu Setujui SPV. / Result saved, waiting for the SPV.")
            state = "awaiting_spv"
        cols = ", ".join(f"{k} = %s" for k in sets)
        if state == "closed":
            cols += ", closed_at = UTC_TIMESTAMP()"
        await db.run(cur, f"UPDATE count_tasks SET {cols} WHERE id = %s", list(sets.values()) + [t["id"]])
        if state == "closed":
            await _close_flags(cur, t, user.email)
        await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=t["id"],
                           action="count_finished",
                           after={"attempt": a["attempt_no"], "method": method, "counted": counted,
                                  "state": state, "manual": manual,
                                  "started_by_tap": started_by_tap})
    return {"ok": True, "state": state, "method": method, "qty_counted": counted, "message": msg}


# --- SPV: approve or recount (8c) ---------------------------------------------------

async def _approve_one(cur, task_id: int, user: auth.User) -> dict | None:
    t = await db.one(cur, "SELECT * FROM count_tasks WHERE id = %s FOR UPDATE", (task_id,))
    if not t or t["status"] != "awaiting_spv":
        return None
    await auth.assert_site_access(user, t["site_id"])
    last = await db.one(cur, "SELECT * FROM count_attempts WHERE task_id = %s AND status = 'finished' "
                             "ORDER BY attempt_no DESC LIMIT 1", (task_id,))
    if not last:
        return None
    variance = int(last["qty_counted"]) - int(last["qty_expected"] or 0)
    site = await db.one(cur, "SELECT is_training FROM sites WHERE id = %s", (t["site_id"],))
    movement_id = None
    if variance != 0 and t["sku_id"]:
        # The ledger moves the stock and queues the new number for Hiryu at once.
        movement_id = await ledger.apply(
            cur, site_id=t["site_id"], sku_id=t["sku_id"], location_id=t["location_id"],
            qty_delta=variance, movement_type="adjustment", actor_email=user.email,
            ref_type="count_task", ref_id=task_id, reason_code="count",
            scan_source="manual", is_training=bool(site and site["is_training"]))
    await db.run(cur, "UPDATE count_tasks SET status = 'closed', outcome = 'approved', qty_final = %s, "
                      "variance = %s, approved_by = %s, approved_at = UTC_TIMESTAMP(), "
                      "closed_at = UTC_TIMESTAMP(), movement_id = %s, hq_review = %s WHERE id = %s",
                 (last["qty_counted"], variance, user.email, movement_id,
                  "pending" if variance != 0 else "not_needed", task_id))
    await _close_flags(cur, t, user.email)
    await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=task_id,
                       action="spv_approved", after={"variance": variance,
                                                     "counted": last["qty_counted"]})
    return {"task_id": task_id, "variance": variance, "new_qty": last["qty_counted"]}


@router.post("/counts/tasks/{task_id}/approve")
async def approve_count(task_id: int, user: auth.User = Depends(auth.require("supervisor"))):
    """Setujui SPV: the stock changes now and the new number goes to Hiryu."""
    async with db.tx() as cur:
        done = await _approve_one(cur, task_id, user)
    if not done:
        raise HTTPException(409, "Tidak ada hasil yang menunggu persetujuan. / Nothing waiting for approval.")
    return {"ok": True, **done,
            "message": f"Disetujui. Stok dan Hiryu: {done['new_qty']}. / Approved. Stock and Hiryu: {done['new_qty']}."}


@router.post("/counts/approve")
async def approve_counts(body: CountIdsIn, user: auth.User = Depends(auth.require("supervisor"))):
    out = []
    async with db.tx() as cur:
        for tid in body.task_ids:
            done = await _approve_one(cur, tid, user)
            if done:
                out.append(done)
    return {"ok": True, "approved": out, "message": f"{len(out)} bin disetujui. / {len(out)} bin(s) approved."}


@router.post("/counts/tasks/{task_id}/recount")
async def spv_recount(task_id: int, body: CountRecountIn,
                      user: auth.User = Depends(auth.require("supervisor"))):
    """Hitung ulang: the bin goes to another person, who counts without the
    expected number."""
    t, _ = await _task(task_id, user)
    if t["status"] not in ("awaiting_spv", "recount"):
        raise HTTPException(409, "Bin ini tidak menunggu SPV. / This bin is not waiting for the SPV.")
    prior = {a["counted_by"] for a in (await _attempts_for([task_id])).get(task_id, [])}
    who = body.assign_to or await _other_counter(t["site_id"], prior)
    if who in prior:
        raise HTTPException(409, "Hitung ulang harus oleh orang lain. / A recount is always done by "
                                 "a different person.")
    async with db.tx() as cur:
        await db.run(cur, "UPDATE count_tasks SET status = 'recount', assigned_to = %s, qty_final = NULL "
                          "WHERE id = %s", (who, task_id))
        await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=task_id,
                           action="spv_recount", after={"assigned_to": who})
    return {"ok": True, "assigned_to": who}


# --- Ops HQ: review afterwards ------------------------------------------------------

@router.get("/counts/reviews")
async def count_reviews(site_id: int | None = None, status: str = Query(default="pending",
                        pattern="^(pending|reviewed|all)$"), days: int = Query(default=31, ge=1, le=120),
                        user: auth.User = Depends(auth.require("hq"))):
    """Every approved difference at every hub, for Tinjau Ops HQ."""
    where = ["t.outcome = 'approved'", "t.variance <> 0", "t.approved_at >= %s"]
    params: list = [utcnow() - timedelta(days=days)]
    if status != "all":
        where.append("t.hq_review = %s")
        params.append(status)
    if site_id:
        where.append("t.site_id = %s")
        params.append(site_id)
    rows = await db.fetch_all(
        "SELECT t.*, l.code AS location_code, s.name_display, s.photo_key, st.code AS site_code, "
        "       COALESCE(s.price_idr, 0) AS price FROM count_tasks t "
        "JOIN locations l ON l.id = t.location_id JOIN sites st ON st.id = t.site_id "
        "LEFT JOIN skus s ON s.id = t.sku_id WHERE " + " AND ".join(where) +
        " ORDER BY t.approved_at", params)
    attempts = await _attempts_for([r["id"] for r in rows])
    names = await names_for([r["approved_by"] for r in rows] + [r["hq_reviewed_by"] for r in rows] +
                            [a["counted_by"] for lst in attempts.values() for a in lst])
    out = []
    for r in rows:
        o = _task_out(r, r["site_code"], names, show_expected=True, attempts=attempts.get(r["id"], []))
        o["site_code"] = hub_short(r["site_code"])
        o["value_idr"] = abs(int(r["variance"] or 0)) * int(r["price"] or 0)
        out.append(o)
    return {"tasks": out, "pending": sum(1 for r in rows if r["hq_review"] == "pending")}


@router.post("/counts/review")
async def review_counts(body: CountIdsIn, user: auth.User = Depends(auth.require("hq"))):
    """Tinjau Ops HQ: marks approved differences as reviewed. It holds nothing
    back; it makes the difference final for the monthly variance report."""
    if not body.task_ids:
        return {"ok": True, "reviewed": 0}
    async with db.tx() as cur:
        n = await db.run(
            cur, "UPDATE count_tasks SET hq_review = 'reviewed', hq_reviewed_by = %s, "
                 "hq_reviewed_at = UTC_TIMESTAMP(), hq_note = %s "
                 f"WHERE id IN ({db.placeholders(body.task_ids)}) AND hq_review = 'pending'",
            [user.email, body.note] + list(body.task_ids))
        for tid in body.task_ids:
            await ledger.audit(cur, actor_email=user.email, entity="count_task", entity_id=tid,
                               action="hq_reviewed", after={"note": body.note})
    return {"ok": True, "reviewed": n}


@router.post("/counts/tasks/{task_id}/review")
async def review_count(task_id: int, body: CountNoteIn | None = None,
                       user: auth.User = Depends(auth.require("hq"))):
    return await review_counts(CountIdsIn(task_ids=[task_id], note=body.note if body else None), user)


# --- Ops HQ: mandatory cycles -------------------------------------------------------

@router.get("/counts/cycles")
async def list_cycles(site_id: int | None = None, user: auth.User = Depends(auth.current_user)):
    if site_id:
        await auth.assert_site_access(user, site_id)
    return {"cycles": await _cycles_out(site_id, wib_today())}


async def _check_cycle(body: CycleIn):
    if body.scope == "sku":
        if not body.sku_id or not await db.fetch_one("SELECT id FROM skus WHERE id = %s", (body.sku_id,)):
            raise HTTPException(422, "Pilih SKU. / Choose a SKU.")
    else:
        if not body.brand_id or not await db.fetch_one("SELECT id FROM brands WHERE id = %s",
                                                       (body.brand_id,)):
            raise HTTPException(422, "Pilih merek. / Choose a brand.")


@router.post("/counts/cycles", status_code=201)
async def add_cycle(body: CycleIn, user: auth.User = Depends(auth.require("hq"))):
    """Tambah siklus: one SKU or all SKUs of a brand, every x days or x weeks."""
    await _check_cycle(body)
    async with db.tx() as cur:
        cid = await db.run(
            cur, "INSERT INTO count_cycles (scope, sku_id, brand_id, every_n, every_unit, start_date, "
                 "active, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (body.scope, body.sku_id if body.scope == "sku" else None,
             body.brand_id if body.scope == "brand" else None, body.every_n, body.every_unit,
             wib_today(), 1 if body.active else 0, user.email))
        await ledger.audit(cur, actor_email=user.email, entity="count_cycle", entity_id=cid,
                           action="create", after=body.model_dump())
    return {"ok": True, "id": cid}


@router.put("/counts/cycles/{cycle_id}")
async def edit_cycle(cycle_id: int, body: CycleIn, user: auth.User = Depends(auth.require("hq"))):
    """The pencil icon: change the SKU, brand or interval, or switch it off."""
    old = await db.fetch_one("SELECT * FROM count_cycles WHERE id = %s", (cycle_id,))
    if not old:
        raise HTTPException(404, "Siklus tidak ditemukan. / Cycle not found.")
    await _check_cycle(body)
    async with db.tx() as cur:
        await db.run(
            cur, "UPDATE count_cycles SET scope = %s, sku_id = %s, brand_id = %s, every_n = %s, "
                 "every_unit = %s, active = %s, updated_by = %s, updated_at = UTC_TIMESTAMP() "
                 "WHERE id = %s",
            (body.scope, body.sku_id if body.scope == "sku" else None,
             body.brand_id if body.scope == "brand" else None, body.every_n, body.every_unit,
             1 if body.active else 0, user.email, cycle_id))
        await ledger.audit(cur, actor_email=user.email, entity="count_cycle", entity_id=cycle_id,
                           action="update", before=dict(old), after=body.model_dump())
    return {"ok": True}


@router.delete("/counts/cycles/{cycle_id}")
async def remove_cycle(cycle_id: int, user: auth.User = Depends(auth.require("hq"))):
    await db.execute("UPDATE count_cycles SET active = 0, updated_by = %s, updated_at = UTC_TIMESTAMP() "
                     "WHERE id = %s", (user.email, cycle_id))
    return {"ok": True}
