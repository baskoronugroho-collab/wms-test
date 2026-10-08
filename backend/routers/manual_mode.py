"""Mode manual (V32): a dark store whose scanners or phone cameras are broken
works without scanning for a while.

Only Ops HQ and up switch it on or off, with a reason, until a set time (by
default the end of the WIB day, at most 3 days ahead). It ends by itself when
that time passes: `active()` switches the flag off the first time it is read
after that. While it is on:

* picking is a tap per unit on the product's photo and name (pick_lines.manual_units);
* inbound counts are typed per product, blind (inbound_receipts.manual_mode);
* stock counts are typed, blind (the existing count without scanning);
* putaway, put back and the quarantine report confirm the bin or product by a
  tap or a choice from a list.

Every manual entry is marked, the SPV sees the state in Perlu tindakan and the
end of day report shows how much was done by hand. Scanning still works for
whoever has a working scanner.

    GET /api/manual-mode?site_id=     the state, any role
    PUT /api/manual-mode              {site_id, on, reason, until}  Ops HQ and up
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import auth
import db
from ledger import audit
from routers.opname import WIB, iso, utcnow, wib_day_start_utc, wib_today

router = APIRouter(prefix="/api/manual-mode", tags=["mode manual"])

MAX_DAYS = 3


class ManualModeIn(BaseModel):
    site_id: int
    on: bool
    reason: str | None = None
    until: str | None = None       # ISO time; none = the end of today (WIB)


def _end_of_today_utc() -> datetime:
    return wib_day_start_utc(wib_today() + timedelta(days=1)) - timedelta(seconds=1)


async def active(site_id: int | None) -> bool:
    """True while the dark store is in Mode manual. Switches it off once its
    end time has passed (the first read after that does it)."""
    if not site_id:
        return False
    row = await db.fetch_one(
        "SELECT manual_mode, manual_mode_until FROM sites WHERE id = %s", (site_id,))
    if not row or not row["manual_mode"]:
        return False
    if row["manual_mode_until"] and row["manual_mode_until"] <= utcnow():
        # Only if it is still the expired session: Ops HQ may have switched it
        # on again a moment ago, and that must not be undone here.
        async with db.tx() as cur:
            n = await db.run(cur, "UPDATE sites SET manual_mode = 0 WHERE id = %s AND manual_mode = 1 "
                                  "AND manual_mode_until <= UTC_TIMESTAMP()", (site_id,))
            if n == 1:
                await audit(cur, actor_email="wms", entity="site", entity_id=site_id,
                            action="manual_mode_ended", after={"why": "time passed"})
        return False
    return True


async def state(site_id: int) -> dict:
    on = await active(site_id)
    row = await db.fetch_one(
        "SELECT s.manual_mode_until, s.manual_mode_since, s.manual_mode_by, s.manual_mode_reason, "
        "       u.name AS by_name FROM sites s LEFT JOIN users u ON u.email = s.manual_mode_by "
        "WHERE s.id = %s", (site_id,))
    return {
        "site_id": site_id, "on": on,
        "until": iso(row["manual_mode_until"]) if on and row else None,
        "since": iso(row["manual_mode_since"]) if on and row else None,
        "by": (row["by_name"] or row["manual_mode_by"]) if on and row else None,
        "reason": row["manual_mode_reason"] if on and row else None,
        "max_days": MAX_DAYS,
    }


@router.get("")
async def get_state(site_id: int = Query(...), user: auth.User = Depends(auth.current_user)):
    await auth.assert_site_access(user, site_id)
    return await state(site_id)


@router.put("")
async def set_state(body: ManualModeIn, user: auth.User = Depends(auth.require("hq"))):
    site = await auth.assert_site_access(user, body.site_id)
    now = utcnow()
    if body.on:
        reason = (body.reason or "").strip()
        if len(reason) < 10:
            raise HTTPException(422, "Tulis alasannya, minimal 10 huruf. / Write the reason, at least 10 characters.")
        until = _end_of_today_utc()
        if body.until:
            try:
                u = datetime.fromisoformat(body.until.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(422, "Waktu selesai tidak dikenal. / The end time is not a valid time.")
            until = (u.replace(tzinfo=None) - (u.utcoffset() or timedelta(0))) if u.tzinfo else u - WIB
        if until <= now:
            raise HTTPException(422, "Waktu selesai sudah lewat. / The end time has already passed.")
        if until > now + timedelta(days=MAX_DAYS):
            raise HTTPException(422, f"Paling lama {MAX_DAYS} hari. Perpanjang lagi nanti kalau perlu. / "
                                     f"At most {MAX_DAYS} days. Extend it later if needed.")
        async with db.tx() as cur:
            await db.run(cur, "UPDATE sites SET manual_mode = 1, manual_mode_until = %s, "
                              "manual_mode_since = COALESCE(IF(manual_mode = 1 AND manual_mode_until > UTC_TIMESTAMP(), "
                              "manual_mode_since, NULL), %s), "
                              "manual_mode_by = %s, manual_mode_reason = %s WHERE id = %s",
                         (until, now, user.email, reason[:255], body.site_id))
            await audit(cur, actor_email=user.email, entity="site", entity_id=body.site_id,
                        action="manual_mode_on", after={"until": until.isoformat(), "reason": reason})
    else:
        async with db.tx() as cur:
            await db.run(cur, "UPDATE sites SET manual_mode = 0 WHERE id = %s", (body.site_id,))
            await audit(cur, actor_email=user.email, entity="site", entity_id=body.site_id,
                        action="manual_mode_off", after={"reason": (body.reason or "").strip() or None})
    out = await state(body.site_id)
    code = site["code"]
    out["message"] = ((f"Mode manual aktif di {code}. Pindai dimatikan. / Manual mode is on at {code}. Scanning is off.")
                      if out["on"] else
                      (f"Mode manual selesai di {code}. Kembali memindai. / Manual mode is off at {code}. Back to scanning."))
    return out


async def day_counts(site_id: int, day=None) -> dict:
    """What was done by hand on a WIB day (today by default): for the end of
    day report and Perlu tindakan."""
    day = day or wib_today()
    start, end = wib_day_start_utc(day), wib_day_start_utc(day + timedelta(days=1))
    picks = await db.fetch_one(
        "SELECT COALESCE(SUM(pl.manual_units), 0) AS units, COUNT(DISTINCT pt.order_id) AS orders "
        "FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "WHERE pt.site_id = %s AND pl.manual_units > 0 AND pt.created_at >= %s AND pt.created_at < %s",
        (site_id, start, end))
    rec = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM inbound_receipts WHERE site_id = %s AND manual_mode = 1 "
        "AND opened_at >= %s AND opened_at < %s", (site_id, start, end))
    return {"pick_units": int(picks["units"] or 0), "pick_orders": int(picks["orders"] or 0),
            "receipts": int(rec["n"] or 0)}
