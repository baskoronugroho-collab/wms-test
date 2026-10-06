"""Pickers: Siap ambil, Istirahat, and the phone's "what do I do now" (PRD §6.2).

The phone never chooses an order. It says whether its picker is ready, and it
polls /me every few seconds; the WMS (assign.py) decides who gets what and /me
tells the phone. /me is also what keeps a picker "present": a phone that stops
polling is not given new orders.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import assign
import auth
import db
import floor
import models
from routers import outbound

router = APIRouter(prefix="/api/pickers", tags=["pickers"])


class ReturnDuty(BaseModel):
    order_id: int
    order_label: str
    basket_code: str | None = None
    units_left: int
    cancel_reason: str | None = None
    cancelled_at: str | None = None


class PickerMeV2(models.PickerMe):
    """The phone's poll (boards 6a, 6b, 6e)."""
    assigned_at: str | None = Field(default=None, description="When the order was given to me")
    started_at: str | None = None
    basket_code: str | None = None
    ready_by: str | None = Field(default=None, description="Grab order time + 10 min")
    work_seconds: int | None = Field(default=None, description="Stopwatch since assigned")
    products: int | None = None
    units: int | None = None
    store_name: str | None = None
    is_uji: bool = False
    is_demo: bool = Field(default=False, description="Demo order from Buat pesanan dummy: DEMO chip")
    suggested_basket: str | None = Field(default=None, description="A free basket for the example")
    free_baskets: list[str] | None = Field(
        default=None, description="Every free basket now (any of them is right); null when "
                                  "no order is waiting for a basket")
    today_count: int = Field(default=0, description="Hari ini: orders I handed to the bench today")
    pick_start_seconds: int = 120
    return_duty: ReturnDuty | None = Field(
        default=None, description="My cancelled order whose basket I am emptying (board 6e)")


async def _me(site_id: int, email: str) -> dict:
    row = await db.fetch_one(
        "SELECT state, since, note FROM picker_presence WHERE site_id = %s AND user_email = %s",
        (site_id, email))
    task = await db.fetch_one(
        "SELECT pt.id, pt.started_at, pt.claimed_at, pt.basket_code, o.hiryu_short_no, "
        "       o.external_ref, o.promised_at, o.source, o.is_demo, hs.store_name, "
        "       (SELECT COUNT(DISTINCT pl.order_line_id) FROM pick_lines pl "
        "         WHERE pl.pick_task_id = pt.id AND pl.qty_required > 0) AS products, "
        "       (SELECT COALESCE(SUM(pl.qty_required),0) FROM pick_lines pl "
        "         WHERE pl.pick_task_id = pt.id) AS units "
        "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "LEFT JOIN hiryu_stores hs ON hs.hiryu_store_no = o.hiryu_store_no "
        "WHERE pt.site_id = %s AND pt.status = 'claimed' AND pt.claimed_by = %s "
        "ORDER BY pt.claimed_at LIMIT 1", (site_id, email))
    today = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM pick_tasks WHERE site_id = %s AND claimed_by = %s "
        "AND handed_to_pack_at >= %s", (site_id, email, outbound._jakarta_day_start_utc()))
    duty = await assign.return_duty(site_id, email)
    free = (await floor.free_baskets(site_id)) if task and not task["basket_code"] else None
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
        "assigned_at": str(task["claimed_at"]) if task and task["claimed_at"] else None,
        "started_at": str(task["started_at"]) if task and task["started_at"] else None,
        "basket_code": task["basket_code"] if task else None,
        "ready_by": str(task["promised_at"]) if task and task["promised_at"] else None,
        "work_seconds": outbound._secs(task["claimed_at"]) if task and task["claimed_at"] else None,
        "products": int(task["products"] or 0) if task else None,
        "units": int(task["units"] or 0) if task else None,
        "store_name": task["store_name"] if task else None,
        "is_uji": bool(task and (task["source"] or "") == "uji"),
        "is_demo": bool(task and task["is_demo"]),
        "suggested_basket": free[0] if free else None,
        "free_baskets": free,
        "today_count": int(today["n"] or 0),
        "pick_start_seconds": 60 * await assign.rule("pick_start_minutes", 2),
        "return_duty": ({
            "order_id": duty["order_id"],
            "order_label": duty["hiryu_short_no"] or duty["external_ref"],
            "basket_code": duty["basket_code"], "units_left": int(duty["units_left"] or 0),
            "cancel_reason": duty["cancel_reason"],
            "cancelled_at": str(duty["cancelled_at"]) if duty["cancelled_at"] else None,
        } if duty else None),
    }


@router.get("/me", response_model=PickerMeV2)
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


@router.post("/ready", response_model=PickerMeV2)
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


@router.post("/break", response_model=PickerMeV2)
async def take_break(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """Istirahat: new orders go to other pickers, or wait."""
    return await _step_away(body.site_id, user, "break")


@router.post("/off", response_model=PickerMeV2)
async def go_off(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """End of shift: out of the line until the next Siap ambil."""
    return await _step_away(body.site_id, user, "off")


@router.post("/pack", response_model=PickerMeV2)
async def at_pack_bench(body: models.PickerStateIn, user: auth.User = Depends(auth.current_user)):
    """Saya di meja packing: shown as Packer on the queue board (6j) and never
    given an order. Opening a pack or tapping Selesai dikemas also sets it
    for someone who was off."""
    return await _step_away(body.site_id, user, "pack")


@router.get("", response_model=models.PickerList)
@router.get("/", response_model=models.PickerList, include_in_schema=False)
async def list_pickers(site_id: int = Query(...),
                       user: auth.User = Depends(auth.require("supervisor"))):
    """The SPV's view: who is ready, on a break or off, and who holds what."""
    await auth.assert_site_access(user, site_id)
    return {"site_id": site_id, "pickers": await assign.picker_rows(site_id)}
