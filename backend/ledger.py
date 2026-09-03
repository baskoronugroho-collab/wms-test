"""The stock ledger — the one place inventory is allowed to change.

Two rules the rest of the codebase depends on (PRD §6.1, §10.5):

  1. `stock_movements` is append-only, and `inventory_balances` is a projection
     of it. Every balance change writes a movement in the same transaction, so
     the projection can always be rebuilt by replaying the ledger.
  2. Nothing outside this module writes to `inventory_balances`. If you find
     yourself wanting to, you want `apply()`.

Every function here takes an open transactional cursor. That is deliberate:
a balance update and its ledger row must land together or not at all.
"""
import json
from typing import Literal

from fastapi import HTTPException

import db

MovementType = Literal[
    "receipt_in",
    "transfer_out",
    "transfer_in",
    "pick_out",
    "adjustment",
    "relocate_out",
    "relocate_in",
    "label_bind",
]

# Movement types that may drive a balance negative are none of them; a negative
# balance is always a bug or a bad exception path, so we refuse and surface it.
_ALLOW_NEGATIVE: set[str] = set()


async def apply(
    cur,
    *,
    site_id: int,
    sku_id: int,
    location_id: int | None,
    qty_delta: int,
    movement_type: str,
    actor_email: str | None = None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    reason_code: str | None = None,
    plate_id: int | None = None,
    scan_source: str = "scan",
    is_training: bool = False,
) -> int:
    """Move stock and record why. Returns the movement id.

    Must be called inside `db.tx()`. Locks the balance row before reading it so
    two concurrent picks against the same basket serialise rather than
    interleave (PRD §10.2.2).
    """
    if qty_delta == 0:
        raise ValueError("A movement with no quantity is not a movement")

    if location_id is not None:
        existing = await db.one(
            cur,
            "SELECT id, qty_on_hand, qty_allocated FROM inventory_balances "
            "WHERE site_id = %s AND sku_id = %s AND location_id = %s FOR UPDATE",
            (site_id, sku_id, location_id),
        )

        if existing is None:
            if qty_delta < 0:
                raise HTTPException(
                    status_code=409,
                    detail="No stock recorded at this location.",
                )
            await db.run(
                cur,
                "INSERT INTO inventory_balances "
                "(site_id, sku_id, location_id, qty_on_hand, version) "
                "VALUES (%s, %s, %s, %s, 1)",
                (site_id, sku_id, location_id, qty_delta),
            )
        else:
            new_qty = existing["qty_on_hand"] + qty_delta
            if new_qty < 0 and movement_type not in _ALLOW_NEGATIVE:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Not enough stock: {existing['qty_on_hand']} on hand, "
                        f"tried to remove {abs(qty_delta)}."
                    ),
                )
            await db.run(
                cur,
                "UPDATE inventory_balances "
                "SET qty_on_hand = %s, version = version + 1 WHERE id = %s",
                (new_qty, existing["id"]),
            )

    movement_id = await db.run(
        cur,
        "INSERT INTO stock_movements "
        "(site_id, sku_id, location_id, plate_id, qty_delta, movement_type, "
        " ref_type, ref_id, reason_code, actor_email, scan_source, is_training) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            site_id, sku_id, location_id, plate_id, qty_delta, movement_type,
            ref_type, ref_id, reason_code, actor_email, scan_source,
            1 if is_training else 0,
        ),
    )

    await enqueue_pos_push(cur, site_id=site_id, sku_id=sku_id, is_training=is_training)
    return movement_id


async def allocate(
    cur, *, site_id: int, sku_id: int, location_id: int, qty: int
) -> int:
    """Reserve stock against an order line. Returns how much was actually held.

    Allocation happens on order intake, before picking starts, so two concurrent
    orders cannot both be promised the last unit (PRD §5.1 / M5.1.3).
    """
    row = await db.one(
        cur,
        "SELECT id, qty_on_hand, qty_allocated FROM inventory_balances "
        "WHERE site_id = %s AND sku_id = %s AND location_id = %s FOR UPDATE",
        (site_id, sku_id, location_id),
    )
    if not row:
        return 0
    available = row["qty_on_hand"] - row["qty_allocated"]
    take = max(0, min(qty, available))
    if take:
        await db.run(
            cur,
            "UPDATE inventory_balances SET qty_allocated = qty_allocated + %s, "
            "version = version + 1 WHERE id = %s",
            (take, row["id"]),
        )
    return take


async def release(
    cur, *, site_id: int, sku_id: int, location_id: int, qty: int
) -> None:
    """Give an allocation back — the pick consumed it, or the order was cancelled."""
    if qty <= 0:
        return
    await db.run(
        cur,
        "UPDATE inventory_balances "
        "SET qty_allocated = GREATEST(0, qty_allocated - %s), version = version + 1 "
        "WHERE site_id = %s AND sku_id = %s AND location_id = %s",
        (qty, site_id, sku_id, location_id),
    )


async def available_to_sell(cur, *, site_id: int, sku_id: int) -> int:
    """What the POS may publish to Grab: on hand, minus what is already promised.

    NOTE: this is the raw figure. §9.1 is unresolved and the research pass flagged
    that publishing it unbuffered, against a ±2-unit counting tolerance, is an
    oversell waiting to happen. A confidence buffer belongs here once the policy
    is agreed — deliberately not invented in this commit.
    """
    row = await db.one(
        cur,
        "SELECT COALESCE(SUM(GREATEST(0, qty_on_hand - qty_allocated)), 0) AS avail "
        "FROM inventory_balances WHERE site_id = %s AND sku_id = %s",
        (site_id, sku_id),
    )
    return int(row["avail"]) if row else 0


async def enqueue_pos_push(cur, *, site_id: int, sku_id: int, is_training: bool) -> None:
    """Queue an available-to-sell push for the POS.

    A training site NEVER reaches the POS (PRD M8.2.1). The suppression is here,
    at the single outbound edge, so no route into it can leak — rather than at
    each of the dozen call sites that move stock.
    """
    avail = await available_to_sell(cur, site_id=site_id, sku_id=sku_id)
    status = "suppressed" if is_training else "pending"
    await db.run(
        cur,
        "INSERT INTO pos_outbox (site_id, sku_id, available, status) "
        "VALUES (%s, %s, %s, %s)",
        (site_id, sku_id, avail, status),
    )


async def audit(
    cur,
    *,
    actor_email: str | None,
    entity: str,
    entity_id: int | None,
    action: str,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    await db.run(
        cur,
        "INSERT INTO audit_log (actor_email, entity, entity_id, action, "
        "before_json, after_json) VALUES (%s,%s,%s,%s,%s,%s)",
        (
            actor_email,
            entity,
            entity_id,
            action,
            json.dumps(before, default=str) if before else None,
            json.dumps(after, default=str) if after else None,
        ),
    )


# --- idempotency ------------------------------------------------------------

async def replay(key: str | None, endpoint: str) -> dict | None:
    """Return the stored response for an already-seen scan, if any.

    The app is online-only (PRD §5.2), so a retry after an ambiguous timeout is
    the normal recovery path. Without this, that retry double-counts.
    """
    if not key:
        return None
    row = await db.fetch_one(
        "SELECT response_json FROM scan_events WHERE idempotency_key = %s", (key,)
    )
    if row and row["response_json"]:
        return json.loads(row["response_json"])
    return None


async def remember(cur, key: str | None, endpoint: str, response: dict) -> None:
    if not key:
        return
    await db.run(
        cur,
        "INSERT INTO scan_events (idempotency_key, endpoint, response_json) "
        "VALUES (%s, %s, %s)",
        (key, endpoint, json.dumps(response, default=str)),
    )
