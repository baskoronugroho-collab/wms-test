"""M8 — Training mode.

A full, isolated copy of the warehouse that behaves exactly like the real one and
touches nothing real. Serves new staff and the development team equally.

Every route here calls `auth.assert_training_site`, which refuses on the site's
own flag. Reset on a live station is impossible, not merely discouraged (M8.2.5).
"""
import json
import random
import uuid

from fastapi import APIRouter, Depends, Query

import auth
import db
import ledger
import models
from routers import outbound

router = APIRouter(prefix="/api/training", tags=["training"])

BASE_QTY = 55  # the space model's base case: max(6, 3/day x 14 DOI x 1.3)

SCENARIOS = [
    {"key": "clean", "name_id": "Semua rapi", "name_en": "Everything matches",
     "teaches": "The happy path. First-day walkthrough."},
    {"key": "variance", "name_id": "Selisih stok", "name_en": "Count variances",
     "teaches": "Opname counting and the variance reveal."},
    {"key": "short_pick", "name_id": "Keranjang kosong", "name_en": "Empty basket",
     "teaches": "E8 — the most expensive real failure."},
    {"key": "wrong_shade", "name_id": "Salah warna", "name_en": "Wrong shade in basket",
     "teaches": "The pick scan gate, and why it exists."},
    {"key": "unknown_barcode", "name_id": "Barcode baru", "name_en": "Unregistered barcode",
     "teaches": "Inline barcode registration during inbound."},
    {"key": "no_slot", "name_id": "Belum ada keranjang", "name_en": "SKU with no basket",
     "teaches": "Creating a basket mid-inbound (M2.3)."},
    {"key": "mode_b", "name_id": "Barang tanpa barcode", "name_en": "Unbarcoded brand",
     "teaches": "Labelling, binding, plate-level pick and opname."},
    {"key": "contention", "name_id": "Dua orang sekaligus", "name_en": "Two staff at once",
     "teaches": "Claims and concurrency with two people on one station."},
]


@router.get("/scenarios", response_model=models.ScenarioList)
async def list_scenarios(user: auth.User = Depends(auth.current_user)):
    return {"scenarios": SCENARIOS}


async def _wipe(cur, site_id: int) -> None:
    """Clear transactional state. Master data and racking survive."""
    await db.run(cur, "DELETE FROM opname_foreign WHERE session_id IN "
                      "(SELECT id FROM opname_sessions WHERE site_id = %s)", (site_id,))
    await db.run(cur, "DELETE FROM opname_sessions WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM opname_plans WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM pick_lines WHERE pick_task_id IN "
                      "(SELECT id FROM pick_tasks WHERE site_id = %s)", (site_id,))
    await db.run(cur, "DELETE FROM pick_tasks WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM order_lines WHERE order_id IN "
                      "(SELECT id FROM orders WHERE site_id = %s)", (site_id,))
    await db.run(cur, "DELETE FROM orders WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM receipt_lines WHERE receipt_id IN "
                      "(SELECT id FROM inbound_receipts WHERE site_id = %s)", (site_id,))
    await db.run(cur, "DELETE FROM inbound_receipts WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM stock_movements WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM pos_outbox WHERE site_id = %s", (site_id,))
    await db.run(cur, "UPDATE unit_plates SET state='unbound', sku_id=NULL, "
                      "location_id=NULL, expiry_date=NULL, bound_by=NULL, "
                      "bound_at=NULL, last_seen_at=NULL WHERE site_id = %s", (site_id,))
    await db.run(cur, "DELETE FROM inventory_balances WHERE site_id = %s", (site_id,))


async def _restock(cur, site_id: int) -> int:
    """Every slotted SKU back to the base quantity. Deterministic."""
    slots = await db.many(
        cur,
        "SELECT sa.sku_id, bk.location_id FROM slot_assignments sa "
        "JOIN baskets bk ON bk.id = sa.basket_id WHERE sa.site_id = %s "
        "ORDER BY sa.sku_id", (site_id,),
    )
    for s in slots:
        await db.run(
            cur,
            "INSERT INTO inventory_balances (site_id, sku_id, location_id, "
            "qty_on_hand, version) VALUES (%s,%s,%s,%s,1) "
            "ON DUPLICATE KEY UPDATE qty_on_hand = %s, qty_allocated = 0",
            (site_id, s["sku_id"], s["location_id"], BASE_QTY, BASE_QTY),
        )
    return len(slots)


@router.post("/reset", response_model=models.TrainingResult)
async def reset(
    body: models.TrainingActionIn, user: auth.User = Depends(auth.current_user)
):
    """Back to a known state. The same reset always produces the same warehouse."""
    site = await auth.assert_training_site(body.site_id)
    async with db.tx() as cur:
        await _wipe(cur, body.site_id)
        n = await _restock(cur, body.site_id)
        await db.run(cur, "INSERT INTO training_fixtures (site_id, scenario, "
                          "payload_json, loaded_by) VALUES (%s,'reset',%s,%s)",
                     (body.site_id, json.dumps({"slots": n, "qty": BASE_QTY}),
                      user.email))
    return {
        "ok": True, "site_code": site["code"], "scenario": "reset",
        "fixture": {"baskets_restocked": n, "qty_each": BASE_QTY},
        "message": f"{site['code']} direset: {n} keranjang, {BASE_QTY} unit each.",
    }


@router.post("/load", response_model=models.TrainingResult)
async def load_scenario(
    body: models.TrainingActionIn, user: auth.User = Depends(auth.current_user)
):
    """Load a named fixture, and print what it created — so a trainer knows what
    the right answer is supposed to be (M8.3.3)."""
    site = await auth.assert_training_site(body.site_id)
    site_id = body.site_id
    scenario = body.scenario
    if scenario not in {s["key"] for s in SCENARIOS}:
        scenario = "clean"

    fixture: dict = {}
    async with db.tx() as cur:
        await _wipe(cur, site_id)
        await _restock(cur, site_id)

        slots = await db.many(
            cur,
            "SELECT sa.sku_id, bk.location_id, l.code AS location_code, "
            "       s.name_display FROM slot_assignments sa "
            "JOIN baskets bk ON bk.id = sa.basket_id "
            "JOIN locations l ON l.id = bk.location_id "
            "JOIN skus s ON s.id = sa.sku_id "
            "WHERE sa.site_id = %s ORDER BY sa.sku_id", (site_id,),
        )

        if scenario == "variance":
            # Three short, one over — deliberately, so the count finds them.
            targets = [(slots[2], -3), (slots[7], -1), (slots[15], -5), (slots[20], 2)]
            fixture["seeded_variances"] = []
            for slot, delta in targets:
                await db.run(
                    cur, "UPDATE inventory_balances SET qty_on_hand = qty_on_hand - %s "
                         "WHERE site_id=%s AND sku_id=%s AND location_id=%s",
                    (-delta if delta < 0 else -delta, site_id, slot["sku_id"],
                     slot["location_id"]),
                )
                fixture["seeded_variances"].append({
                    "location": slot["location_code"], "sku": slot["name_display"],
                    "physical_minus_system": delta,
                })
            fixture["note"] = ("System now believes MORE (or less) than the shelf "
                               "holds. Counting should find exactly these.")

        elif scenario == "short_pick":
            slot = slots[4]
            await db.run(cur, "UPDATE inventory_balances SET qty_on_hand = 0 "
                              "WHERE site_id=%s AND sku_id=%s AND location_id=%s",
                         (site_id, slot["sku_id"], slot["location_id"]))
            fixture["empty_basket"] = {"location": slot["location_code"],
                                       "sku": slot["name_display"]}
            fixture["note"] = "Order this SKU and the picker will find nothing there."

        elif scenario == "wrong_shade":
            a, b = slots[0], slots[1]
            fixture["swap"] = {
                "put_physically_in": a["location_code"],
                "the_product_from": b["location_code"],
                "expected_name": a["name_display"],
                "actual_name": b["name_display"],
            }
            fixture["note"] = ("Physically place the wrong shade in the first "
                               "basket. The pick scan must block it.")

        elif scenario == "no_slot":
            slot = slots[-1]
            await db.run(cur, "DELETE FROM inventory_balances WHERE site_id=%s "
                              "AND sku_id=%s", (site_id, slot["sku_id"]))
            await db.run(cur, "DELETE FROM slot_assignments WHERE site_id=%s "
                              "AND sku_id=%s", (site_id, slot["sku_id"]))
            fixture["unslotted_sku"] = slot["name_display"]
            fixture["note"] = "Receive this SKU and the app must offer a new basket."

        elif scenario == "unknown_barcode":
            fixture["unknown_barcode"] = "2999999999994"
            fixture["note"] = ("Scan this at inbound. It resolves to nothing and "
                               "must offer registration, not an error.")

        elif scenario == "mode_b":
            mode_b_skus = await db.many(
                cur, "SELECT id, name_display FROM skus WHERE identity_mode='unit_label' "
                     "AND active=1 ORDER BY id", (),
            )
            free = await db.many(
                cur,
                "SELECT bk.id AS basket_id, l.code FROM baskets bk "
                "JOIN locations l ON l.id = bk.location_id "
                "LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id "
                "WHERE bk.site_id = %s AND sa.id IS NULL ORDER BY l.code LIMIT 5",
                (site_id,),
            )
            fixture["skus"] = []
            for sku, basket in zip(mode_b_skus, free):
                await db.run(
                    cur, "INSERT INTO slot_assignments (site_id, sku_id, basket_id, "
                         "created_by) VALUES (%s,%s,%s,%s)",
                    (site_id, sku["id"], basket["basket_id"], user.email),
                )
                fixture["skus"].append({"sku": sku["name_display"],
                                        "basket": basket["code"]})
            plates = await db.one(
                cur, "SELECT COUNT(*) AS n FROM unit_plates WHERE site_id=%s "
                     "AND state='unbound'", (site_id,),
            )
            fixture["unbound_plates"] = int(plates["n"])
            fixture["note"] = ("Label these products one unit at a time. If there "
                               "are no plates, issue a range first.")

        elif scenario == "contention":
            fixture["note"] = ("Two orders and an opname plan are ready. Open the "
                               "app on two devices and try to claim the same work.")

        await db.run(cur, "INSERT INTO training_fixtures (site_id, scenario, "
                          "payload_json, loaded_by) VALUES (%s,%s,%s,%s)",
                     (site_id, scenario, json.dumps(fixture), user.email))

    if scenario in ("short_pick", "contention", "wrong_shade"):
        n = 2 if scenario == "contention" else 1
        made = await generate_orders(
            models.GenerateOrdersIn(site_id=site_id, count=n), user
        )
        fixture["orders"] = made["created"]

    return {"ok": True, "site_code": site["code"], "scenario": scenario,
            "fixture": fixture, "message": f"Skenario '{scenario}' siap."}


@router.post("/orders/generate", response_model=models.GeneratedOrders)
async def generate_orders(
    body: models.GenerateOrdersIn, user: auth.User = Depends(auth.current_user)
):
    """Test orders, through the same endpoint the real POS will use.

    Training sites only. An earlier draft allowed this against any site, which
    would have had a test order consume real stock and push a wrong number to
    Grab (PRD §9.3.4).
    """
    site = await auth.assert_training_site(body.site_id)
    slotted = await db.fetch_all(
        "SELECT sa.sku_id FROM slot_assignments sa "
        "JOIN inventory_balances ib ON ib.sku_id = sa.sku_id "
        "  AND ib.site_id = sa.site_id "
        "WHERE sa.site_id = %s AND ib.qty_on_hand > 0", (body.site_id,),
    )
    if not slotted:
        return {"created": [], "message": "No stock to order. Reset the site first."}

    created = []
    for _ in range(max(1, body.count)):
        n_lines = random.randint(1, max(1, min(body.max_lines, len(slotted))))
        picks = random.sample(slotted, n_lines)
        ref = f"TEST-{uuid.uuid4().hex[:10].upper()}"
        await outbound.receive_order(models.OrderIn(
            external_ref=ref, site_id=body.site_id, is_test=True,
            lines=[models.OrderLineIn(sku_id=p["sku_id"],
                                      quantity=random.randint(1, 3)) for p in picks],
        ))
        created.append(ref)
    return {"created": created,
            "message": f"{len(created)} test order(s) at {site['code']}."}


@router.get("/barcode-sheet", response_model=models.BarcodeSheet)
async def barcode_sheet(
    site_id: int,
    limit: int = Query(default=120, le=500),
    user: auth.User = Depends(auth.current_user),
):
    """Printable test barcodes, so training works with no physical stock (M8.4.4)."""
    site = await auth.assert_training_site(site_id)
    rows = await db.fetch_all(
        "SELECT s.id, s.name_display, bc.barcode, l.code AS location_code "
        "FROM slot_assignments sa "
        "JOIN skus s ON s.id = sa.sku_id "
        "JOIN baskets bk ON bk.id = sa.basket_id "
        "JOIN locations l ON l.id = bk.location_id "
        "LEFT JOIN barcodes bc ON bc.sku_id = s.id "
        "WHERE sa.site_id = %s AND bc.barcode IS NOT NULL "
        "ORDER BY l.code LIMIT %s", (site_id, limit),
    )
    return {
        "site_code": site["code"],
        "rows": [{"sku_id": r["id"], "sku_name": r["name_display"],
                  "barcode": r["barcode"], "location_code": r["location_code"]}
                 for r in rows],
        "note": "BAHAN LATIHAN — jangan dipakai di jalur penerimaan asli.",
    }


@router.get("/activity", response_model=models.ActivityReport)
async def activity(
    site_id: int,
    actor: str | None = None,
    user: auth.User = Depends(auth.current_user),
):
    """Who has actually practised, and who has clicked past it (M8.4.3)."""
    await auth.assert_training_site(site_id)
    sql = ("SELECT actor_email, flow, event, created_at FROM training_activity "
           "WHERE site_id = %s")
    params: list = [site_id]
    if actor:
        sql += " AND actor_email = %s"
        params.append(actor)
    rows = await db.fetch_all(sql + " ORDER BY created_at DESC LIMIT 200", params)
    return {"rows": [{"actor_email": r["actor_email"], "flow": r["flow"],
                      "event": r["event"], "created_at": str(r["created_at"])}
                     for r in rows]}
