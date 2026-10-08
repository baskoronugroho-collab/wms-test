"""Who picks what: the WMS hands out every order by itself (PRD §6.2, §6.5.4).

Nobody chooses orders and nobody waits for the SPV to hand them out:

  * a picker taps Siap ambil and is READY; a ready picker with no order in
    hand is FREE;
  * the waiting order with the least time left (earliest ready-by) goes to the
    free picker who has been free longest;
  * one order per picker at a time;
  * an order nobody has scanned within `pick_start_minutes` of being given goes
    back to the queue, and its picker is set to off (see `sweep_all`);
  * a scheduled order waits (the Terjadwal lane) until it is due.

Several pods run this at once (every 5 seconds from main, and after every
event that frees a picker or adds an order), so nothing here trusts a read:
the picker row and the task row are both written with compare-and-set updates
inside one transaction, and a lost race rolls both back and tries again.

pick_tasks.claimed_by is the truth about who holds an order. The
picker_presence.current_task_id column is a cache that makes "who is free" one
indexed read; `_repair` fixes it before every round, so an update that missed
it (a crash between two statements, an old code path) costs one sweep, never a
stuck picker.
"""
import logging

import db
import ledger

log = logging.getLogger("wms.assign")

# A phone that has not polled for this long is treated as away: it is not
# given new orders. The phone polls every 3 s; a minute and a half covers a
# screen that dozed off for a moment without handing orders to a dead device.
SEEN_SECONDS = 90

# "pack": at the pack bench and the handover table (board 6j, Di shift). Never
# given an order; set by Saya di meja kemas or by opening the pack screen.
STATES = ("ready", "break", "off", "pack")

# The words the 2-minute rule leaves in a picker's note (see `sweep_all`). The
# phone reads them back through `timed_out` to show why Siap ambil went off.
TIMEOUT_MARK = "belum dimulai dalam"


def timeout_note(label: str, minutes: int) -> str:
    """What the phone says after the 2-minute rule took the order back. Under
    255 characters: picker_presence.note is cut there."""
    return (f"{label} {TIMEOUT_MARK} {minutes} menit. Pesanan kembali ke antrean dan Siap "
            f"ambil dimatikan. / {label} was not started within {minutes} min. It went back "
            "to the queue and Ready to pick was switched off.")


def timed_out(state: str | None, note: str | None) -> bool:
    """The picker is off because the 2-minute rule switched them off."""
    return state == "off" and bool(note) and TIMEOUT_MARK in note


class _Lost(Exception):
    """A compare-and-set lost to another pod; roll back and look again."""


async def rule(key: str, default: int) -> int:
    """A number from alert_rules. Kept here rather than imported from
    routers.hiryu, which imports outbound, which imports this module."""
    row = await db.fetch_one(
        "SELECT value_num FROM alert_rules WHERE rule_key = %s", (key,))
    if not row or row["value_num"] is None:
        return default
    return int(row["value_num"])


async def _audit(actor: str, entity_id: int, action: str, after: dict) -> None:
    async with db.tx() as cur:
        await ledger.audit(cur, actor_email=actor, entity="pick_tasks",
                           entity_id=entity_id, action=action, after=after)


async def order_label(task_id: int) -> str:
    """The GM number people use, or the Grab order ID when there is none."""
    row = await db.fetch_one(
        "SELECT o.hiryu_short_no, o.external_ref FROM pick_tasks pt "
        "JOIN orders o ON o.id = pt.order_id WHERE pt.id = %s", (task_id,))
    if not row:
        return "#" + str(task_id)
    return row["hiryu_short_no"] or row["external_ref"]


# --------------------------------------------------------------------------
# the picker's own row
# --------------------------------------------------------------------------

async def set_state(site_id: int, email: str, state: str, note: str | None = None) -> None:
    """Upsert a picker's state. `since` and `idle_since` move only when the
    state really changes, so tapping Siap ambil twice does not send a picker to
    the back of the line."""
    if state not in STATES:
        raise ValueError(f"Status tidak dikenal: {state}. / Unknown state: {state}.")
    await db.execute(
        "INSERT INTO picker_presence (site_id, user_email, state, since, idle_since, "
        "last_seen_at, note) VALUES (%s,%s,%s,NOW(),NOW(),NOW(),%s) "
        "ON DUPLICATE KEY UPDATE "
        # Evaluated left to right: `state` is still the old value here.
        "since = IF(state = VALUES(state), since, NOW()), "
        "idle_since = IF(state = VALUES(state) AND idle_since IS NOT NULL, idle_since, NOW()), "
        "state = VALUES(state), last_seen_at = NOW(), note = VALUES(note)",
        (site_id, email, state, note))
    if state == "ready":
        # One hub at a time: a picker who moved hubs is not also ready at the old one.
        await db.execute(
            "UPDATE picker_presence SET state = 'off', since = NOW() "
            "WHERE user_email = %s AND site_id <> %s AND state <> 'off'", (email, site_id))


async def seen(site_id: int, email: str) -> None:
    """The phone polled: the picker is at their phone."""
    await db.execute(
        "UPDATE picker_presence SET last_seen_at = NOW() "
        "WHERE site_id = %s AND user_email = %s", (site_id, email))


async def free_picker(site_id: int, email: str | None, task_id: int,
                      note: str | None = None, state: str | None = None, *, cur=None) -> None:
    """The picker no longer holds `task_id` (handed to pack, cancelled, moved,
    returned). They go to the back of the free line; `note` is what their phone
    tells them. Only touches the row if it still points at that task. `cur`:
    inside the caller's transaction, so the change lands with the caller's."""
    if not email:
        return
    sets = ["current_task_id = NULL", "idle_since = NOW()"]
    params: list = []
    if note is not None:
        sets.append("note = %s")
        params.append(note[:255])
    if state:
        sets += ["since = IF(state = %s, since, NOW())", "state = %s"]
        params += [state, state]
    sql = (f"UPDATE picker_presence SET {', '.join(sets)} "
           "WHERE site_id = %s AND user_email = %s "
           "AND (current_task_id = %s OR current_task_id IS NULL)")
    if cur is not None:
        await db.run(cur, sql, (*params, site_id, email, task_id))
    else:
        await db.execute(sql, (*params, site_id, email, task_id))


async def held_task(site_id: int, email: str) -> dict | None:
    """The order this picker holds at this hub, from pick_tasks (the truth)."""
    return await db.fetch_one(
        "SELECT id, order_id, started_at, claimed_at FROM pick_tasks "
        "WHERE site_id = %s AND status = 'claimed' AND claimed_by = %s "
        "ORDER BY claimed_at LIMIT 1", (site_id, email))


# --------------------------------------------------------------------------
# assignment
# --------------------------------------------------------------------------

async def _repair(site_id: int) -> None:
    """Point every picker's cache back at the truth.

    Two plain steps rather than one multi-table UPDATE: each fix is a
    compare-and-set on the value we read, so it cannot undo an assignment
    another pod made in between.
    """
    stale = await db.fetch_all(
        "SELECT pp.user_email, pp.current_task_id FROM picker_presence pp "
        "LEFT JOIN pick_tasks pt ON pt.id = pp.current_task_id "
        "WHERE pp.site_id = %s AND pp.current_task_id IS NOT NULL "
        "  AND (pt.id IS NULL OR pt.status <> 'claimed' OR pt.claimed_by IS NULL "
        "       OR pt.claimed_by <> pp.user_email)", (site_id,))
    for s in stale:
        await db.execute(
            "UPDATE picker_presence SET current_task_id = NULL, idle_since = NOW() "
            "WHERE site_id = %s AND user_email = %s AND current_task_id = %s",
            (site_id, s["user_email"], s["current_task_id"]))


async def _next_task(site_id: int, lead_minutes: int) -> dict | None:
    """Least time left first. A scheduled order joins the queue only when it is
    due: `lead_minutes` before its ready-by, the same working window an
    ordinary Grab order gets from arrival to ready-by (§6.5.2a)."""
    return await db.fetch_one(
        "SELECT pt.id FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "WHERE pt.site_id = %s AND pt.status = 'ready' AND pt.claimed_by IS NULL "
        "  AND o.status <> 'cancelled' "
        "  AND (o.scheduled_at IS NULL OR o.promised_at IS NULL "
        "       OR o.promised_at <= NOW() + INTERVAL %s MINUTE) "
        "ORDER BY o.promised_at IS NULL, o.promised_at, pt.created_at, pt.id LIMIT 1",
        (site_id, lead_minutes))


# A picker whose order was cancelled with units in the basket puts them back
# first (board 6e: "Setelah semua kembali, pesanan berikutnya datang sendiri").
# Bounded by `return_block_minutes`, so a basket nobody empties never strands
# a picker for the rest of the shift.
_RETURN_DUTY = (
    "EXISTS (SELECT 1 FROM pick_tasks r JOIN orders ro ON ro.id = r.order_id "
    "        WHERE r.site_id = pp.site_id AND r.return_by = pp.user_email "
    "          AND r.status = 'cancelled' AND r.basket_released_at IS NULL "
    "          AND ro.cancelled_at >= NOW() - INTERVAL %s MINUTE)"
)


async def return_duty(site_id: int, email: str) -> dict | None:
    """The cancelled order whose basket this picker is emptying, if any."""
    minutes = await rule("return_block_minutes", 30)
    return await db.fetch_one(
        "SELECT r.id AS task_id, r.order_id, r.basket_code, ro.hiryu_short_no, ro.external_ref, "
        "       ro.cancel_reason, ro.cancelled_at, "
        "       (SELECT COALESCE(SUM(rt.qty - rt.qty_returned),0) FROM return_tasks rt "
        "         WHERE rt.order_id = r.order_id AND rt.status = 'open') AS units_left "
        "FROM pick_tasks r JOIN orders ro ON ro.id = r.order_id "
        "WHERE r.site_id = %s AND r.return_by = %s AND r.status = 'cancelled' "
        "  AND r.basket_released_at IS NULL "
        "  AND ro.cancelled_at >= NOW() - INTERVAL %s MINUTE "
        "ORDER BY ro.cancelled_at DESC LIMIT 1", (site_id, email, minutes))


async def _next_picker(site_id: int, exclude: str | None = None) -> dict | None:
    """The free picker who has been free longest, whose phone is still polling,
    and who is not putting a cancelled basket back."""
    minutes = await rule("return_block_minutes", 30)
    return await db.fetch_one(
        "SELECT pp.user_email FROM picker_presence pp "
        "WHERE pp.site_id = %s AND pp.state = 'ready' AND pp.current_task_id IS NULL "
        "  AND pp.last_seen_at >= NOW() - INTERVAL %s SECOND "
        "  AND pp.user_email <> %s "
        "  AND NOT EXISTS (SELECT 1 FROM pick_tasks x WHERE x.site_id = pp.site_id "
        "                  AND x.status = 'claimed' AND x.claimed_by = pp.user_email) "
        f"  AND NOT {_RETURN_DUTY} "
        "ORDER BY pp.idle_since IS NULL, pp.idle_since, pp.user_email LIMIT 1",
        (site_id, SEEN_SECONDS, exclude or "", minutes))


async def give(task_id: int, site_id: int, email: str, *, actor: str = "wms",
               note: str | None = None) -> bool:
    """Hand one waiting order to one free picker. True when it landed.

    The picker row is claimed first (state ready, hands empty), then the task
    (still waiting, still unheld). Either compare-and-set failing means another
    pod got there first: both roll back together.
    """
    try:
        async with db.tx() as cur:
            n = await db.run(
                cur,
                # The note is left alone: an order taken away (cancelled, moved)
                # a moment ago must still be explained on the phone when the
                # next one lands. Handing an order to pack clears it.
                "UPDATE picker_presence SET current_task_id = %s "
                "WHERE site_id = %s AND user_email = %s AND state = 'ready' "
                "AND current_task_id IS NULL", (task_id, site_id, email))
            if n != 1:
                raise _Lost()
            n = await db.run(
                cur,
                "UPDATE pick_tasks SET status = 'claimed', claimed_by = %s, "
                "claimed_at = NOW(), started_at = NULL "
                "WHERE id = %s AND site_id = %s AND status = 'ready' AND claimed_by IS NULL",
                (email, task_id, site_id))
            if n != 1:
                raise _Lost()
            await ledger.audit(cur, actor_email=actor, entity="pick_tasks",
                               entity_id=task_id, action="pick_task.assign",
                               after={"to": email, "note": note})
    except _Lost:
        return False
    return True


async def assign_site(site_id: int) -> int:
    """While an order waits and a picker is free, pair them. Returns how many
    orders were given out. Never raises: it runs after the caller's own work
    has committed, and a failed assignment is retried by the next sweep."""
    given = 0
    try:
        await _repair(site_id)
        lead = await rule("grab_ready_minutes", 10)
        # Bounded: every pass either gives an order or loses a race, and a
        # busy hub never has fifty pickers standing by.
        for _ in range(50):
            task = await _next_task(site_id, lead)
            if not task:
                break
            picker = await _next_picker(site_id)
            if not picker:
                break
            if await give(task["id"], site_id, picker["user_email"]):
                given += 1
    except Exception:
        log.exception("assignment failed at site %s", site_id)
    return given


async def return_to_queue(task_id: int, *, actor: str, note: str,
                          only_unstarted: bool = True,
                          older_than_minutes: int | None = None) -> str | None:
    """Put a held order back in the queue. Returns the picker who held it, or
    None when it was not theirs to lose any more (started, finished, moved).

    Picked units stay counted: they have left the ledger, and the next picker
    resumes at the first line still to pick.
    """
    task = await db.fetch_one(
        "SELECT id, site_id, claimed_by FROM pick_tasks WHERE id = %s", (task_id,))
    if not task or not task["claimed_by"]:
        return None
    where = ["id = %s", "status = 'claimed'", "claimed_by = %s"]
    params: list = [task_id, task["claimed_by"]]
    if only_unstarted:
        where.append("started_at IS NULL")
    if older_than_minutes is not None:
        where.append("claimed_at < NOW() - INTERVAL %s MINUTE")
        params.append(older_than_minutes)
    n = await db.execute(
        "UPDATE pick_tasks SET status = 'ready', claimed_by = NULL, claimed_at = NULL, "
        "started_at = NULL, requeued_at = NOW(), requeue_count = requeue_count + 1, "
        f"reassign_note = %s WHERE {' AND '.join(where)}",
        (note[:255], *params))
    if n != 1:
        return None
    await _audit(actor, task_id, "pick_task.requeue",
                 {"from": task["claimed_by"], "note": note})
    return task["claimed_by"]


async def sweep_all() -> int:
    """Every 5 seconds, at every darkstore: take back orders nobody started in
    time, then give out whatever is waiting. Returns orders given out.

    A picker whose order went back is set to OFF, not left ready (`timeout_note`
    says so on their phone). They did not
    scan for two minutes, so they are most likely not at the phone (asleep,
    in the toilet, phone in a pocket). Left ready, they would be given the next
    order at once and lose that one too, while Grab's clock runs on every order
    in turn. Off takes them out of the line until they tap Siap ambil again,
    and their phone says why.
    """
    total = 0
    try:
        sites = await db.fetch_all(
            "SELECT id FROM sites WHERE active = 1 AND site_type = 'darkstore'")
    except Exception:
        log.exception("assignment sweep could not list sites")
        return 0
    minutes = await rule("pick_start_minutes", 2)
    for site in sites:
        try:
            stale = await db.fetch_all(
                "SELECT id, claimed_by FROM pick_tasks WHERE site_id = %s "
                "AND status = 'claimed' AND started_at IS NULL "
                "AND claimed_at < NOW() - INTERVAL %s MINUTE", (site["id"], minutes))
            for t in stale:
                label = await order_label(t["id"])
                note = timeout_note(label, minutes)
                who = await return_to_queue(
                    t["id"], actor="wms", older_than_minutes=minutes,
                    note=(f"Tidak dimulai dalam {minutes} menit oleh {t['claimed_by']}. / "
                          f"Not started within {minutes} min by {t['claimed_by']}."))
                if who:
                    await free_picker(site["id"], who, t["id"], note=note, state="off")
            total += await assign_site(site["id"])
        except Exception:
            log.exception("assignment sweep failed at site %s", site["id"])
    return total


async def reassign(task_id: int, *, actor: str, reason: str,
                   to_email: str | None = None) -> dict:
    """The SPV moves an order to another picker (§6.2 step 6).

    `to_email` given: that picker, even if on a break (the SPV has asked them in
    person); they are set ready. Not given: the free picker who has waited
    longest, other than the one who holds it now. Returns
    {"from": ..., "to": ...}; raises ValueError with a "Indonesian / English"
    message when it cannot be done.
    """
    task = await db.fetch_one(
        "SELECT pt.id, pt.site_id, pt.status, pt.claimed_by FROM pick_tasks pt "
        "WHERE pt.id = %s", (task_id,))
    if not task:
        raise LookupError("Pesanan tidak ditemukan. / Order not found.")
    if task["status"] not in ("ready", "claimed"):
        raise ValueError("Pesanan ini sudah tidak di tahap ambil barang. / "
                         "This order is past picking.")
    site_id, holder = task["site_id"], task["claimed_by"]

    if to_email:
        to_email = to_email.strip().lower()
        if to_email == (holder or "").lower():
            raise ValueError("Pesanan ini sudah dipegang orang itu. / "
                             "That picker already holds this order.")
        user = await db.fetch_one(
            "SELECT u.email, u.role FROM users u WHERE LOWER(u.email) = %s AND u.active = 1",
            (to_email,))
        if not user:
            raise ValueError("Staf tidak ditemukan. / No such staff member.")
        to_email = user["email"]
        busy = await held_task(site_id, to_email)
        if busy:
            raise ValueError("Picker itu masih memegang pesanan lain. / "
                             "That picker still holds another order.")
    else:
        await _repair(site_id)
        nxt = await _next_picker(site_id, exclude=holder)
        if not nxt:
            raise ValueError("Tidak ada picker lain yang siap. Pilih nama, atau tunggu. / "
                             "No other picker is ready. Choose a name, or wait.")
        to_email = nxt["user_email"]

    label = await order_label(task_id)
    # Out of the old hands first (a compare-and-set on the holder we read), then
    # into the new ones. If the old holder finished it in between, stop.
    if task["status"] == "claimed":
        n = await db.execute(
            "UPDATE pick_tasks SET status = 'ready', claimed_by = NULL, claimed_at = NULL, "
            "started_at = NULL, reassign_note = %s WHERE id = %s AND status = 'claimed' "
            "AND claimed_by = %s", (reason[:255], task_id, holder))
        if n != 1:
            raise ValueError("Pesanan ini baru saja berubah. Muat ulang papan. / "
                             "This order just changed. Reload the board.")
        await free_picker(site_id, holder, task_id, note=(
            f"{label} dipindahkan ke picker lain oleh SPV. / "
            f"{label} was moved to another picker by the SPV."))
    else:
        await db.execute("UPDATE pick_tasks SET reassign_note = %s WHERE id = %s",
                         (reason[:255], task_id))

    # The chosen picker is ready from now, with empty hands.
    await set_state(site_id, to_email, "ready")
    # held_task() said their hands are empty; clear any stale cache to match.
    await db.execute(
        "UPDATE picker_presence SET current_task_id = NULL WHERE site_id = %s "
        "AND user_email = %s AND current_task_id IS NOT NULL", (site_id, to_email))
    ok = await give(task_id, site_id, to_email, actor=actor, note=reason)
    if not ok:
        # Someone else's round gave it out first, or the picker got another
        # order in the same instant. The order is in the queue either way.
        await assign_site(site_id)
        raise ValueError("Pesanan kembali ke antrean dan dibagikan otomatis. / "
                         "The order went back to the queue and was assigned automatically.")
    await _audit(actor, task_id, "pick_task.reassign",
                 {"from": holder, "to": to_email, "reason": reason})
    await assign_site(site_id)
    return {"from": holder, "to": to_email}


# --------------------------------------------------------------------------
# what the SPV sees
# --------------------------------------------------------------------------

async def picker_rows(site_id: int) -> list[dict]:
    """Every picker known at this hub today or holding an order: state, since
    when, whether the phone is still polling, and the order in hand. Pickers
    who have been off since before today drop off the panel."""
    rows = await db.fetch_all(
        "SELECT pp.user_email, pp.state, pp.since, pp.idle_since, pp.note, "
        "       (pp.last_seen_at >= NOW() - INTERVAL %s SECOND) AS online, "
        "       u.name, pt.id AS task_id, pt.claimed_at, pt.started_at, pt.basket_code, "
        "       o.hiryu_short_no, o.external_ref, "
        "       TIMESTAMPDIFF(SECOND, pt.claimed_at, NOW()) AS held_seconds "
        "FROM picker_presence pp "
        "LEFT JOIN users u ON u.email = pp.user_email "
        "LEFT JOIN pick_tasks pt ON pt.site_id = pp.site_id AND pt.status = 'claimed' "
        "     AND pt.claimed_by = pp.user_email "
        "LEFT JOIN orders o ON o.id = pt.order_id "
        "WHERE pp.site_id = %s "
        "  AND (pp.state <> 'off' OR pt.id IS NOT NULL "
        "       OR pp.updated_at >= NOW() - INTERVAL 12 HOUR) "
        "ORDER BY CASE pp.state WHEN 'ready' THEN 0 WHEN 'break' THEN 1 "
        "         WHEN 'pack' THEN 2 ELSE 3 END, "
        "         pp.idle_since, pp.user_email",
        (SEEN_SECONDS, site_id))
    out, seen_emails = [], set()
    for r in rows:
        # The join can repeat a picker who somehow holds two orders; show once.
        if r["user_email"] in seen_emails:
            continue
        seen_emails.add(r["user_email"])
        out.append({
            "email": r["user_email"], "name": r["name"], "state": r["state"],
            "since": str(r["since"]) if r["since"] else None,
            "idle_since": str(r["idle_since"]) if r["idle_since"] else None,
            "phone_online": bool(r["online"]),
            "task_id": r["task_id"],
            "order_ref": (r["hiryu_short_no"] or r["external_ref"]) if r["task_id"] else None,
            "held_seconds": int(r["held_seconds"]) if r["held_seconds"] is not None else None,
            "started": bool(r["started_at"]),
            "basket_code": r["basket_code"] if r["task_id"] else None,
            "note": r["note"],
        })
    return out
