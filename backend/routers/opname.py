"""M6 — Stock opname: weekly physical counting, basket by basket."""
import json

from fastapi import APIRouter, Depends, HTTPException, Query

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
        raise HTTPException(404, "Plan not found")
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
    # Walking order, same as the pick path.
    sql += " ORDER BY r.code, lv.level_no, l.position_no"
    return await db.fetch_all(sql, params)


async def _plan_summary(plan_id: int) -> dict:
    plan = await db.fetch_one("SELECT * FROM opname_plans WHERE id = %s", (plan_id,))
    if not plan:
        raise HTTPException(404, "Plan not found")
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
        raise HTTPException(404, "Plan not found")
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
        raise HTTPException(404, "Basket not found")

    existing = await db.fetch_one(
        "SELECT * FROM opname_sessions WHERE plan_id = %s AND basket_id = %s",
        (body.plan_id, body.basket_id),
    )
    if existing:
        if existing["status"] == "finished":
            raise HTTPException(409, "This basket has already been counted.")
        if existing["claimed_by"] != user.email:
            raise HTTPException(
                409, f"{existing['claimed_by']} is counting this basket."
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
                raise HTTPException(409, "Someone else just claimed this basket.")

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
        raise HTTPException(404, "Session not found")
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
        raise HTTPException(409, f"{session['claimed_by']} is counting this basket.")
    if session["status"] == "finished":
        raise HTTPException(409, "This basket is already counted.")
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

    A foreign SKU is recorded, not rejected — finding the wrong product in a
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
        raise HTTPException(404, "Session not found")
    if session["status"] == "finished":
        raise HTTPException(409, "This count is already finished.")
    if session["claimed_by"] != user.email:
        raise HTTPException(409, f"{session['claimed_by']} is counting this basket.")

    code = body.code.strip()
    scanned = await common.sku_by_barcode(code)
    plate = None
    outcome = "counted"
    message = "OK."

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
                      "message": "Barcode tidak dikenal — dicatat."}
        elif scanned["id"] != session["sku_id"]:
            await db.run(
                cur,
                "INSERT INTO opname_foreign (session_id, scanned_code, "
                "sku_id_resolved, qty, note) VALUES (%s,%s,%s,1,'foreign_item')",
                (session_id, code, scanned["id"]),
            )
            result = {"accepted": True, "outcome": "foreign_item",
                      "qty_counted": session["qty_counted"],
                      "message": f"Barang lain: {scanned['name_display']} — dicatat."}
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
                "message": ("Tercatat di keranjang lain — dihitung, tapi dicatat."
                            if out_of_place else "OK."),
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
    """Reveal expected vs counted — but a mismatch is recounted first.

    PRD 11.2.5: on a first mismatch the counter is told only that the count does
    not match; the tally resets and they count the basket again. The system
    number is revealed after the second count, whatever it says. Asking for a
    recount AFTER showing the number would defeat the blind count.
    """
    session = await db.fetch_one("SELECT * FROM opname_sessions WHERE id = %s",
                                 (session_id,))
    if not session:
        raise HTTPException(404, "Session not found")
    if session["claimed_by"] != user.email and not user.at_least("supervisor"):
        raise HTTPException(409, f"{session['claimed_by']} is counting this basket.")

    if session["status"] == "finished":
        raise HTTPException(409, "This count is already finished.")
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
        raise HTTPException(404, "Plan not found")
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
    return {"ok": True, "message": f"{applied} adjustment(s) applied."}
