"""Pickers: Siap ambil, Istirahat, and the phone's "what do I do now" (PRD §6.2).

The phone never chooses an order. It says whether its picker is ready, and it
polls /me every few seconds; the WMS (assign.py) decides who gets what and /me
tells the phone. /me is also what keeps a picker "present": a phone that stops
polling is not given new orders.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import assign
import auth
import db
import models

router = APIRouter(prefix="/api/pickers", tags=["pickers"])


async def _me(site_id: int, email: str) -> dict:
    row = await db.fetch_one(
        "SELECT state, since, note FROM picker_presence WHERE site_id = %s AND user_email = %s",
        (site_id, email))
    task = await db.fetch_one(
        "SELECT pt.id, pt.started_at, o.hiryu_short_no, o.external_ref "
        "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "WHERE pt.site_id = %s AND pt.status = 'claimed' AND pt.claimed_by = %s "
        "ORDER BY pt.claimed_at LIMIT 1", (site_id, email))
    counts = await db.fetch_one(
        "SELECT "
        " (SELECT COUNT(*) FROM pick_tasks WHERE site_id = %s AND status = 'ready') AS waiting, "
        " (SELECT COUNT(*) FROM picker_presence WHERE site_id = %s AND state = 'ready') AS ready",
        (site_id, site_id))
    return {
        "site_id": site_id,
        "state": row["state"] if row else "off",
        "since": str(row["since"]) if row and row["since"] else None,
        "task_id": task["id"] if task else None,
        "order_ref": (task["hiryu_short_no"] or task["external_ref"]) if task else None,
        "started": bool(task and task["started_at"]),
        "note": row["note"] if row else None,
        "waiting_orders": int(counts["waiting"] or 0),
        "ready_pickers": int(counts["ready"] or 0),
        "server_time": str(datetime.now(timezone.utc)),
    }


@router.get("/me", response_model=models.PickerMe)
async def me(site_id: int = Query(...), user: auth.User = Depends(auth.current_user)):
    """The phone's poll, every 3 s: my state and the order the WMS gave me.

    Each poll marks the picker present, and a ready picker with empty hands
    triggers a round of assignment, so an order reaches a phone that has just
    woken up within one poll instead of waiting for the 5-second sweep.
    """
    await auth.assert_site_access(user, site_id)
    await assign.seen(site_id, user.email)
    state = await db.fetch_one(
        "SELECT state FROM picker_presence WHERE site_id = %s AND user_email = %s",
        (site_id, user.email))
    if state and state["state"] == "ready" and not await assign.held_task(site_id, user.email):
        await assign.assign_site(site_id)
    return await _me(site_id, user.email)


@router.post("/ready", response_model=models.PickerMe)
async def ready(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """Siap ambil: at the start of the shift and after each break."""
    await auth.assert_site_access(user, body.site_id)
    await assign.set_state(body.site_id, user.email, "ready")
    await assign.assign_site(body.site_id)
    return await _me(body.site_id, user.email)


async def _step_away(site_id: int, user: auth.User, state: str) -> dict:
    """Istirahat or off. An order in hand that has not been started goes back
    to the queue for someone else; one already started must be finished (or
    moved by the SPV) first, or its basket would be stranded half-picked."""
    await auth.assert_site_access(user, site_id)
    held = await assign.held_task(site_id, user.email)
    if held:
        label = await assign.order_label(held["id"])
        if held["started_at"]:
            raise HTTPException(
                409, f"Selesaikan dulu {label}, lalu istirahat. / Finish {label} first, then take a break.")
        who = await assign.return_to_queue(held["id"], actor=user.email,
                                           note=f"{user.email} stepped away before starting")
        if not who:
            # The first scan landed in the same instant: it is being picked now.
            raise HTTPException(
                409, f"Selesaikan dulu {label}, lalu istirahat. / Finish {label} first, then take a break.")
        await assign.free_picker(site_id, user.email, held["id"])
    await assign.set_state(site_id, user.email, state)
    await assign.assign_site(site_id)
    return await _me(site_id, user.email)


@router.post("/break", response_model=models.PickerMe)
async def take_break(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """Istirahat: new orders go to other pickers, or wait."""
    return await _step_away(body.site_id, user, "break")


@router.post("/off", response_model=models.PickerMe)
async def go_off(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """End of shift: out of the line until the next Siap ambil."""
    return await _step_away(body.site_id, user, "off")


@router.get("", response_model=models.PickerList)
@router.get("/", response_model=models.PickerList, include_in_schema=False)
async def list_pickers(site_id: int = Query(...),
                       user: auth.User = Depends(auth.require("supervisor"))):
    """The SPV's view: who is ready, on a break or off, and who holds what."""
    await auth.assert_site_access(user, site_id)
    return {"site_id": site_id, "pickers": await assign.picker_rows(site_id)}
