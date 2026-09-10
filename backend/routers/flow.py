"""Replenishment, restock, transfers between sites, and POS outbox health.

These are the four surfaces the v2 operating model added that have no home in the
older routers: moving stock inside a site, moving it between sites, asking the hub
for more, and being able to see whether any of it reached the POS.
"""
import json
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import auth
import common
import db
import ledger
import models

router = APIRouter(prefix="/api", tags=["flow"])


def _age(dt) -> int:
    if not dt:
        return 0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int((datetime.now(timezone.utc) - dt).total_seconds())


# --- replenishment ----------------------------------------------------------

@router.get("/replenishment", response_model=models.ReplenishmentList)
async def list_replenishment(
    site_id: int, user: auth.User = Depends(auth.current_user)
):
    """Open moves from overflow to the pick face, most urgent first.

    A pick face at zero outranks one merely low: the first stops picking, the
    second only threatens to.
    """
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT rt.*, s.name_display, "
        "       lf.code AS from_code, lt.code AS to_code, "
        "       COALESCE(ib.qty_on_hand, 0) AS qty_face "
        "FROM replenishment_tasks rt "
        "JOIN skus s ON s.id = rt.sku_id "
        "LEFT JOIN locations lf ON lf.id = rt.from_location_id "
        "JOIN locations lt ON lt.id = rt.to_location_id "
        "LEFT JOIN inventory_balances ib ON ib.site_id = rt.site_id "
        "     AND ib.sku_id = rt.sku_id AND ib.location_id = rt.to_location_id "
        "WHERE rt.site_id = %s AND rt.status IN ('open','claimed') "
        "ORDER BY COALESCE(ib.qty_on_hand, 0), rt.created_at",
        (site_id,),
    )
    tasks = [{
        "id": r["id"], "site_id": r["site_id"], "sku_id": r["sku_id"],
        "sku_name": r["name_display"], "from_location_code": r["from_code"],
        "to_location_code": r["to_code"], "qty_suggested": r["qty_suggested"],
        "qty_moved": r["qty_moved"], "qty_at_pick_face": int(r["qty_face"] or 0),
        "status": r["status"], "claimed_by": r["claimed_by"],
        "created_at": str(r["created_at"]), "age_seconds": _age(r["created_at"]),
    } for r in rows]
    return {"tasks": tasks, "at_zero": sum(1 for t in tasks if not t["qty_at_pick_face"])}


@router.post("/replenishment/{task_id}/complete", response_model=models.Ok)
async def complete_replenishment(
    task_id: int,
    body: models.ReplenishDoneIn,
    user: auth.User = Depends(auth.current_user),
):
    """Book the physical move: units leave overflow and land on the pick face.

    Two ledger movements, not one. A relocation that wrote a single row would
    lose which location the stock left, and the rack map would be wrong until the
    next count.
    """
    task = await db.fetch_one("SELECT * FROM replenishment_tasks WHERE id = %s",
                              (task_id,))
    if not task:
        raise HTTPException(404, "Replenishment task not found")
    await auth.assert_site_access(user, task["site_id"])
    if task["status"] == "done":
        return {"ok": True, "message": "Already done."}

    qty = max(1, body.qty_moved)
    site = await db.fetch_one("SELECT is_training FROM sites WHERE id = %s",
                              (task["site_id"],))
    async with db.tx() as cur:
        if task["from_location_id"]:
            await ledger.apply(
                cur, site_id=task["site_id"], sku_id=task["sku_id"],
                location_id=task["from_location_id"], qty_delta=-qty,
                movement_type="relocate_out", actor_email=user.email,
                ref_type="replenishment", ref_id=task_id,
                is_training=bool(site["is_training"]),
            )
        await ledger.apply(
            cur, site_id=task["site_id"], sku_id=task["sku_id"],
            location_id=task["to_location_id"], qty_delta=qty,
            movement_type="relocate_in", actor_email=user.email,
            ref_type="replenishment", ref_id=task_id,
            is_training=bool(site["is_training"]),
        )
        await db.run(
            cur,
            "UPDATE replenishment_tasks SET status='done', qty_moved=%s, "
            "completed_at=NOW() WHERE id=%s", (qty, task_id),
        )
    return {"ok": True, "message": f"{qty} unit(s) moved to the pick face."}


# --- restock ----------------------------------------------------------------

@router.get("/restock", response_model=models.RestockList)
async def list_restock(site_id: int, user: auth.User = Depends(auth.current_user)):
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT rr.*, s.name_display FROM restock_requests rr "
        "JOIN skus s ON s.id = rr.sku_id "
        "WHERE rr.site_id = %s AND rr.status IN ('open','sent') "
        "ORDER BY rr.created_at",
        (site_id,),
    )
    return {"requests": [{
        "id": r["id"], "site_id": r["site_id"], "sku_id": r["sku_id"],
        "sku_name": r["name_display"], "qty_suggested": r["qty_suggested"],
        "qty_requested": r["qty_requested"], "status": r["status"],
        "raised_by": r["raised_by"], "created_at": str(r["created_at"]),
    } for r in rows]}


@router.post("/restock/{request_id}/send", response_model=models.Ok)
async def send_restock(
    request_id: int,
    qty: int = Query(...),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """A supervisor confirms the quantity and sends the request to the hub."""
    req = await db.fetch_one("SELECT * FROM restock_requests WHERE id = %s",
                             (request_id,))
    if not req:
        raise HTTPException(404, "Restock request not found")
    await auth.assert_site_access(user, req["site_id"])
    await db.execute(
        "UPDATE restock_requests SET status='sent', qty_requested=%s, "
        "sent_at=NOW() WHERE id=%s", (max(1, qty), request_id),
    )
    return {"ok": True, "message": f"Requested {qty} unit(s) from the hub."}


# --- transfers: hub to darkstore --------------------------------------------

async def _transfer_payload(transfer_id: int) -> dict:
    t = await db.fetch_one(
        "SELECT tr.*, f.code AS from_code, d.code AS to_code FROM transfers tr "
        "JOIN sites f ON f.id = tr.from_site_id JOIN sites d ON d.id = tr.to_site_id "
        "WHERE tr.id = %s", (transfer_id,),
    )
    if not t:
        raise HTTPException(404, "Transfer not found")
    lines = await db.fetch_all(
        "SELECT tl.*, s.name_display FROM transfer_lines tl "
        "JOIN skus s ON s.id = tl.sku_id WHERE tl.transfer_id = %s "
        "ORDER BY s.name_display", (transfer_id,),
    )
    out, sent, recv = [], 0, 0
    for l in lines:
        d, r = int(l["qty_dispatched"] or 0), int(l["qty_received"] or 0)
        sent += d
        recv += r
        out.append({
            "sku_id": l["sku_id"], "sku_name": l["name_display"],
            "qty_dispatched": d, "qty_received": r,
            "variance": (r - d) if t["status"] == "received" else None,
        })
    return {
        "id": t["id"], "reference": t["reference"], "from_site_code": t["from_code"],
        "to_site_code": t["to_code"], "status": t["status"],
        "dispatched_at": str(t["dispatched_at"]) if t["dispatched_at"] else None,
        "received_at": str(t["received_at"]) if t["received_at"] else None,
        "total_dispatched": sent, "total_received": recv,
        "variance": (recv - sent) if t["status"] == "received" else 0,
        "lines": out,
    }


@router.post("/transfers", response_model=models.Transfer, status_code=201)
async def create_transfer(
    body: models.TransferIn, user: auth.User = Depends(auth.current_user)
):
    """Dispatch a tote from the hub to a darkstore.

    The dispatched quantity is what makes the receiving end checkable even when
    the brand sent no manifest — this number is ours, so hop 2 of the chain of
    custody always has an authority (PRD 5.6). Stock leaves the hub's ledger now;
    it enters the darkstore's when someone receives it.
    """
    src = await auth.assert_site_access(user, body.from_site_id)
    dest = await db.fetch_one("SELECT * FROM sites WHERE id = %s", (body.to_site_id,))
    if not dest:
        raise HTTPException(404, "Destination site not found")
    if not body.lines:
        raise HTTPException(422, "A transfer needs at least one line.")

    ref = body.reference or f"TRF-{src['code']}-{datetime.now():%y%m%d%H%M%S}"
    async with db.tx() as cur:
        transfer_id = await db.run(
            cur,
            "INSERT INTO transfers (from_site_id, to_site_id, reference, status, "
            "dispatched_at, dispatched_by, note) "
            "VALUES (%s,%s,%s,'dispatched',NOW(),%s,%s)",
            (body.from_site_id, body.to_site_id, ref, user.email, body.note),
        )
        for line in body.lines:
            qty = max(1, line.quantity)
            slot = await common.slot_for(body.from_site_id, line.sku_id)
            if slot:
                await ledger.apply(
                    cur, site_id=body.from_site_id, sku_id=line.sku_id,
                    location_id=slot["location_id"], qty_delta=-qty,
                    movement_type="transfer_out", actor_email=user.email,
                    ref_type="transfer", ref_id=transfer_id,
                    is_training=bool(src.get("is_training")),
                )
            await db.run(
                cur,
                "INSERT INTO transfer_lines (transfer_id, sku_id, qty_dispatched) "
                "VALUES (%s,%s,%s)", (transfer_id, line.sku_id, qty),
            )
    return await _transfer_payload(transfer_id)


@router.get("/transfers", response_model=models.TransferList)
async def list_transfers(
    site_id: int,
    limit: int = Query(default=30, le=100),
    user: auth.User = Depends(auth.current_user),
):
    """Transfers touching this site, in either direction."""
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT id FROM transfers WHERE from_site_id = %s OR to_site_id = %s "
        "ORDER BY created_at DESC LIMIT %s", (site_id, site_id, limit),
    )
    return {"transfers": [await _transfer_payload(r["id"]) for r in rows]}


# --- POS outbox health ------------------------------------------------------

@router.get("/pos/outbox", response_model=models.OutboxHealth)
async def outbox_health(
    site_id: int | None = None, user: auth.User = Depends(auth.require("supervisor"))
):
    """What the boundary is doing — or, during the pilot, deliberately not doing.

    The most valuable thing on this endpoint is `push_enabled`. A supervisor
    looking at a healthy-looking queue must be able to tell that nothing is being
    sent on purpose, rather than concluding the integration works.
    """
    where, params = "", []
    if site_id:
        await auth.assert_site_access(user, site_id)
        where = " WHERE site_id = %s"
        params.append(site_id)

    rows = await db.fetch_all(
        "SELECT message_type, status, COUNT(*) AS n, MAX(created_at) AS last "
        "FROM pos_outbox" + where + " GROUP BY message_type, status", params,
    )
    lanes: dict[str, dict] = {}
    for r in rows:
        lane = lanes.setdefault(r["message_type"], {
            "message_type": r["message_type"], "pending": 0, "suppressed": 0,
            "sent": 0, "failed": 0, "last_sent_at": None,
        })
        key = r["status"] if r["status"] in ("pending", "suppressed", "sent", "failed") else "pending"
        lane[key] = int(r["n"])
        if r["status"] == "sent" and r["last"]:
            lane["last_sent_at"] = str(r["last"])

    oldest = await db.fetch_one(
        "SELECT MIN(created_at) AS t FROM pos_outbox WHERE status = 'pending'" +
        (" AND site_id = %s" if site_id else ""), params,
    )
    enabled = os.getenv("POS_PUSH_ENABLED", "false").lower() in ("1", "true", "yes")
    return {
        "push_enabled": enabled,
        "lanes": list(lanes.values()),
        "oldest_pending_seconds": _age(oldest["t"]) if oldest and oldest["t"] else None,
        "note": (
            "Live: messages are being delivered to the POS." if enabled else
            "SHADOW MODE — every number is computed and nothing is sent. This is "
            "the pilot posture, not a fault."
        ),
    }


# --- short pick review ------------------------------------------------------

@router.get("/shortfalls", response_model=models.ShortfallList)
async def list_shortfalls(
    site_id: int,
    limit: int = Query(default=50, le=200),
    user: auth.User = Depends(auth.require("supervisor")),
):
    """Declared shortfalls, and who declared them.

    A short pick corrects stock without a signature, so the only control on it is
    that someone reviews these — and that a person declaring them far more often
    than their colleagues is visible (PRD 8.9.5).
    """
    await auth.assert_site_access(user, site_id)
    rows = await db.fetch_all(
        "SELECT ps.*, s.name_display FROM pick_shortfalls ps "
        "JOIN skus s ON s.id = ps.sku_id WHERE ps.site_id = %s "
        "ORDER BY ps.created_at DESC LIMIT %s", (site_id, limit),
    )
    by_person: dict[str, int] = {}
    for r in rows:
        who = r["declared_by"] or "unknown"
        by_person[who] = by_person.get(who, 0) + 1
    return {
        "rows": [{
            "id": r["id"], "pick_line_id": r["pick_line_id"], "sku_id": r["sku_id"],
            "sku_name": r["name_display"], "qty_required": r["qty_required"],
            "qty_found": r["qty_found"], "declared_by": r["declared_by"],
            "status": r["status"], "created_at": str(r["created_at"]),
        } for r in rows],
        "by_person": by_person,
    }
