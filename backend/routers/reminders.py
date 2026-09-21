"""Reminders and flags: the WMS points at what needs a person, by itself.

Two halves:

* **Automatic replenishment draft.** When everything a hub holds for a SKU falls
  to its restock point R, the WMS drafts the request to the brand on its own:
  one draft per hub and brand, collecting every SKU that crosses R until someone
  sends it. Nothing is sent to Wardah automatically -- a person still checks the
  draft and sends it. It runs after every pick, on a timer, and whenever the
  flags are read.

* **Flags.** Everything overdue or at risk, computed live from the data: stock
  at or below safety stock, drafts not sent, Wardah not confirming, deliveries
  past their ETA, variances waiting, station requests waiting for HQ, SKUs with
  no rack, and (when switched on) slow movers.

Every number is a rule in `alert_rules` that Ops HQ can switch on or off and set
on the Reminders page, so the consignment terms still being agreed (safety
stock, replenishment frequency, slow-mover returns) become settings, not code.
"""
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

import auth
import db
import ledger
import models

router = APIRouter(prefix="/api/reminders", tags=["reminders"])
log = logging.getLogger("wms.reminders")

# key -> (label ID, label EN, unit or None, what the value means)
RULES = {
    "restock_default_pct": ("Titik restock bawaan (R) saat belum diisi = persen dari batas penuh (P)",
                            "Default restock point (R) when none is entered, as a percent of the full level (P)",
                            "%|%"),
    "auto_replenish": ("Buat draf restock otomatis saat stok ≤ R",
                       "Draft a restock request automatically when stock ≤ R", None),
    "safety_breach": ("Tandai kritis saat stok ≤ safety stock",
                      "Flag critical when stock ≤ safety stock", None),
    "draft_unsent_hours": ("Ingatkan draf yang belum dikirim ke brand setelah",
                           "Remind about drafts not sent to the brand after", "jam|hours"),
    "sent_unconfirmed_hours": ("Ingatkan permintaan yang belum dikonfirmasi brand setelah",
                               "Remind about requests the brand has not confirmed after", "jam|hours"),
    "delivery_overdue_days": ("Tandai kiriman yang belum diterima, lewat ETA lebih dari",
                              "Flag deliveries not received, past their ETA by more than", "hari|days"),
    "variance_open_hours": ("Ingatkan selisih yang menunggu SPV atau HQ setelah",
                            "Remind about variances waiting for the SPV or HQ after", "jam|hours"),
    "sku_request_open_hours": ("Ingatkan permintaan SKU dari station yang belum dijawab setelah",
                               "Remind about station SKU requests unanswered after", "jam|hours"),
    "needs_rack_days": ("Tandai SKU yang belum punya rak di hub setelah",
                        "Flag SKUs still without a rack at a hub after", "hari|days"),
    "slow_mover_days": ("Tandai SKU yang tidak terambil sama sekali selama",
                        "Flag SKUs not picked at all for", "hari|days"),
}


async def rules() -> dict[str, dict]:
    rows = await db.fetch_all("SELECT rule_key, enabled, value_num, updated_by, updated_at "
                              "FROM alert_rules")
    have = {r["rule_key"]: r for r in rows}
    out = {}
    for key, (lid, len_, unit) in RULES.items():
        r = have.get(key)
        out[key] = {
            "key": key, "label_id": lid, "label_en": len_,
            "unit_id": unit.split("|")[0] if unit else None,
            "unit_en": unit.split("|")[1] if unit else None,
            "enabled": bool(r["enabled"]) if r else False,
            "value": r["value_num"] if r else None,
            "updated_by": r["updated_by"] if r else None,
            "updated_at": str(r["updated_at"]) if r and r["updated_at"] else None,
        }
    return out


@router.get("/rules", response_model=models.ReminderRuleList)
async def list_rules(user: auth.User = Depends(auth.require("supervisor"))):
    return {"rules": list((await rules()).values())}


@router.put("/rules/{key}", response_model=models.ReminderRule)
async def set_rule(key: str, body: models.ReminderRuleIn,
                   user: auth.User = Depends(auth.require("hq"))):
    if key not in RULES:
        raise HTTPException(404, "Unknown rule")
    has_value = RULES[key][2] is not None
    top = 99 if key == "restock_default_pct" else 365
    if has_value and body.value is not None and not 1 <= body.value <= top:
        raise HTTPException(422, f"Nilai antara 1 dan {top}. / The value must be 1 to {top}.")
    await db.execute(
        "INSERT INTO alert_rules (rule_key, enabled, value_num, updated_by) VALUES (%s,%s,%s,%s) "
        "ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), "
        "value_num = COALESCE(VALUES(value_num), value_num), updated_by = VALUES(updated_by)",
        (key, 1 if body.enabled else 0, body.value if has_value else None, user.email))
    return (await rules())[key]


async def default_restock(full: int | None) -> int | None:
    """R when nobody entered one: a share of the full level P (25% to start).

    A placeholder until Ops HQ sets real numbers; never at or above P.
    """
    if not full or full < 2:
        return None
    rule = await db.fetch_one(
        "SELECT enabled, value_num FROM alert_rules WHERE rule_key = 'restock_default_pct'")
    if rule is not None and not rule["enabled"]:
        return None
    pct = rule["value_num"] if rule and rule["value_num"] else 25
    return min(full - 1, max(1, round(full * pct / 100)))


# --- automatic replenishment draft ------------------------------------------------

async def next_reference(cur, site_id: int, site_code: str) -> str:
    seq = await db.one(cur, "SELECT COUNT(*) AS n FROM replenishments WHERE site_id = %s",
                       (site_id,))
    return f"RPL-{site_code.split('-')[-1]}-{date.today():%y%m}-{int(seq['n']) + 1:03d}"


async def auto_replenish(site_ids: list[int] | None = None,
                         sku_ids: list[int] | None = None) -> int:
    """Draft (or extend) a request for every SKU at or below R with none open.

    Serialised per hub by locking the site row, so two pods, or a pick and the
    timer, can never draft the same SKU twice. Returns the lines added.
    """
    rule = (await rules())["auto_replenish"]
    if not rule["enabled"]:
        return 0
    where, params = ["st.active = 1", "st.site_type <> 'hub'", "st.is_training = 0"], []
    if site_ids:
        where = [f"st.id IN ({db.placeholders(site_ids)})"]
        params += list(site_ids)
    sites = await db.fetch_all("SELECT st.id, st.code FROM sites st WHERE " + " AND ".join(where),
                               params)
    added = 0
    for site in sites:
        try:
            added += await _auto_for_site(site, sku_ids)
        except Exception:  # one hub failing must not stop the others
            log.exception("auto replenishment failed at %s", site["code"])
    return added


async def _auto_for_site(site: dict, sku_ids: list[int] | None) -> int:
    sku_filter, params = "", [site["id"]]
    if sku_ids:
        sku_filter = f" AND sa.sku_id IN ({db.placeholders(sku_ids)})"
        params += list(sku_ids)
    async with db.tx() as cur:
        await db.one(cur, "SELECT id FROM sites WHERE id = %s FOR UPDATE", (site["id"],))
        rows = await db.many(
            cur,
            "SELECT * FROM ("
            "  SELECT sa.sku_id, s.brand_id, sa.restock_point, sa.full_threshold, "
            "         (SELECT COALESCE(SUM(ib.qty_on_hand), 0) FROM inventory_balances ib "
            "           WHERE ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id) AS qty "
            "  FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
            "  WHERE sa.site_id = %s AND sa.slot_role = 'primary' AND s.active = 1 "
            "    AND sa.restock_point IS NOT NULL" + sku_filter +
            "    AND NOT EXISTS (SELECT 1 FROM replenishment_lines rl "
            "        JOIN replenishments rp ON rp.id = rl.replenishment_id "
            "       WHERE rp.site_id = sa.site_id AND rl.sku_id = sa.sku_id "
            "         AND rp.status IN ('draft','sent','confirmed','receiving'))"
            ") x WHERE x.qty <= x.restock_point", params)
        if not rows:
            return 0
        by_brand: dict[int, list[dict]] = {}
        for r in rows:
            by_brand.setdefault(r["brand_id"], []).append(r)
        for brand_id, lines in by_brand.items():
            draft = await db.one(
                cur, "SELECT id FROM replenishments WHERE site_id = %s AND brand_id = %s "
                     "AND status = 'draft' AND auto_created = 1 ORDER BY id DESC LIMIT 1",
                (site["id"], brand_id))
            if draft:
                rep_id = draft["id"]
            else:
                reference = await next_reference(cur, site["id"], site["code"])
                rep_id = await db.run(
                    cur,
                    "INSERT INTO replenishments (reference, site_id, brand_id, note, created_by, "
                    "auto_created) VALUES (%s,%s,%s,%s,%s,1)",
                    (reference, site["id"], brand_id,
                     "Dibuat otomatis: stok turun ke titik restock. Periksa lalu kirim ke brand.",
                     "system"))
            for l in lines:
                target = (l["full_threshold"] or l["restock_point"] * 2) * 2
                await db.run(
                    cur,
                    "INSERT INTO replenishment_lines (replenishment_id, sku_id, qty_requested) "
                    "VALUES (%s,%s,%s) ON DUPLICATE KEY UPDATE replenishment_id = replenishment_id",
                    (rep_id, l["sku_id"], max(1, target - int(l["qty"] or 0))))
            await ledger.audit(cur, actor_email="system", entity="replenishment",
                               entity_id=rep_id, action="auto_draft",
                               after={"skus": [l["sku_id"] for l in lines]})
        return len(rows)


# --- flags ---------------------------------------------------------------------------

def _flag(kind, severity, site, title, detail, link, ref=None, age_hours=None):
    return {"kind": kind, "severity": severity, "site_id": site["id"], "site_code": site["code"],
            "title_id": title[0], "title_en": title[1], "detail_id": detail[0],
            "detail_en": detail[1], "link": link, "ref": ref, "age_hours": age_hours}


async def compute_flags(user: auth.User, site_id: int | None) -> list[dict]:
    if site_id:
        await auth.assert_site_access(user, site_id)
        sites = await db.fetch_all("SELECT id, code FROM sites WHERE id = %s", (site_id,))
    elif user.at_least("hq"):
        sites = await db.fetch_all("SELECT id, code FROM sites WHERE active = 1 "
                                   "AND site_type <> 'hub' AND is_training = 0")
    else:
        sites = await db.fetch_all(
            "SELECT s.id, s.code FROM sites s JOIN user_sites us ON us.site_id = s.id "
            "WHERE us.user_id = %s AND s.active = 1 AND s.site_type <> 'hub'", (user.id,))
    if not sites:
        return []
    ids = [s["id"] for s in sites]
    by_id = {s["id"]: s for s in sites}
    ph = db.placeholders(ids)
    R = await rules()
    val = lambda k: R[k]["value"] or 0
    on = lambda k: R[k]["enabled"]
    out: list[dict] = []

    # Draft first, so what the flags say matches the drafts that exist.
    if not user.viewing_as:
        await auto_replenish(site_ids=ids)

    # stock: out, below safety, below R with nothing asked
    stock = await db.fetch_all(
        "SELECT * FROM ("
        "  SELECT sa.site_id, sa.sku_id, s.name_display, s.brand_sku_code, sa.restock_point, "
        "         sa.safety_stock, "
        "         (SELECT COALESCE(SUM(ib.qty_on_hand), 0) FROM inventory_balances ib "
        "           WHERE ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id) AS qty, "
        "         (SELECT rp.reference FROM replenishment_lines rl "
        "            JOIN replenishments rp ON rp.id = rl.replenishment_id "
        "           WHERE rp.site_id = sa.site_id AND rl.sku_id = sa.sku_id "
        "             AND rp.status IN ('draft','sent','confirmed','receiving') LIMIT 1) AS open_ref "
        "  FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
        f" WHERE sa.site_id IN ({ph}) AND sa.slot_role = 'primary' AND s.active = 1 "
        "    AND sa.restock_point IS NOT NULL"
        ") x WHERE x.qty <= x.restock_point", ids)
    for r in stock:
        site = by_id[r["site_id"]]
        q, name = int(r["qty"] or 0), r["name_display"]
        ask = ((" · diminta di " + r["open_ref"]) if r["open_ref"] else " · belum diminta",
               (" · requested in " + r["open_ref"]) if r["open_ref"] else " · not requested yet")
        safety = r["safety_stock"] if r["safety_stock"] is not None else "—"
        if on("safety_breach") and (q == 0 or (r["safety_stock"] is not None
                                               and q <= r["safety_stock"])):
            title = (("Habis: " if q == 0 else "Di bawah safety stock: ") + name,
                     ("Out of stock: " if q == 0 else "Below safety stock: ") + name)
            detail = (f"Stok {q} · safety {safety} · R {r['restock_point']}" + ask[0],
                      f"Held {q} · safety {safety} · R {r['restock_point']}" + ask[1])
            out.append(_flag("stock_critical", "critical", site, title, detail,
                             "restock-brand.html", r["open_ref"]))
        elif not r["open_ref"]:
            out.append(_flag("below_restock", "warn", site, ("Perlu restock: " + name,
                                                             "Needs restock: " + name),
                             (f"Stok {q} ≤ R {r['restock_point']} · belum ada permintaan",
                              f"Held {q} ≤ R {r['restock_point']} · no request yet"),
                             "restock-brand.html"))

    # replenishment lifecycle
    reps = await db.fetch_all(
        "SELECT id, reference, site_id, status, auto_created, eta_date, "
        "       TIMESTAMPDIFF(HOUR, created_at, NOW()) AS h_created, "
        "       TIMESTAMPDIFF(HOUR, sent_at, NOW()) AS h_sent, "
        "       TIMESTAMPDIFF(HOUR, COALESCE(acknowledged_at, received_at), NOW()) AS h_var, "
        "       DATEDIFF(CURDATE(), COALESCE(eta_date, DATE(confirmed_at))) AS d_late "
        f"FROM replenishments WHERE site_id IN ({ph}) "
        "AND status IN ('draft','sent','confirmed','receiving','variance_review','variance_signoff')", ids)
    for r in reps:
        site = by_id[r["site_id"]]
        ref = r["reference"]
        if r["status"] == "draft":
            late = on("draft_unsent_hours") and (r["h_created"] or 0) >= val("draft_unsent_hours")
            if r["auto_created"] or late:
                out.append(_flag(
                    "draft_unsent", "warn" if late else "info", site,
                    (f"{ref} belum dikirim ke brand", f"{ref} not sent to the brand yet"),
                    (("Draf otomatis · " if r["auto_created"] else "Draf · ") + f"{r['h_created'] or 0} jam",
                     ("Automatic draft · " if r["auto_created"] else "Draft · ") + f"{r['h_created'] or 0} h"),
                    "restock-brand.html", ref, r["h_created"]))
        elif r["status"] == "sent" and on("sent_unconfirmed_hours") \
                and (r["h_sent"] or 0) >= val("sent_unconfirmed_hours"):
            out.append(_flag("sent_unconfirmed", "warn", site,
                             (f"Wardah belum konfirmasi {ref}", f"Wardah has not confirmed {ref}"),
                             (f"Dikirim {r['h_sent']} jam lalu", f"Sent {r['h_sent']} h ago"),
                             "restock-brand.html", ref, r["h_sent"]))
        elif r["status"] in ("confirmed", "receiving") and on("delivery_overdue_days") \
                and (r["d_late"] or 0) > val("delivery_overdue_days"):
            part = r["status"] == "receiving"
            out.append(_flag("delivery_overdue", "warn", site,
                             ((f"Sisa kiriman {ref} belum diterima", f"Rest of {ref} not received yet")
                              if part else (f"Kiriman {ref} terlambat", f"Delivery {ref} is late")),
                             (f"{r['d_late']} hari lewat ETA", f"{r['d_late']} days past ETA"),
                             "restock-brand.html", ref))
        elif r["status"].startswith("variance") and on("variance_open_hours") \
                and (r["h_var"] or 0) >= val("variance_open_hours"):
            who = ("SPV", "the SPV") if r["status"] == "variance_review" else ("Ops HQ", "Ops HQ")
            out.append(_flag("variance_open", "warn", site,
                             (f"Selisih {ref} menunggu {who[0]}", f"Variance {ref} waiting for {who[1]}"),
                             (f"{r['h_var']} jam", f"{r['h_var']} h"),
                             "selisih-restock.html", ref, r["h_var"]))

    # station requests waiting for HQ (HQ's to answer)
    if user.at_least("hq") and on("sku_request_open_hours"):
        reqs = await db.fetch_all(
            "SELECT id, site_id, barcode, TIMESTAMPDIFF(HOUR, raised_at, NOW()) AS h "
            f"FROM sku_requests WHERE site_id IN ({ph}) AND status = 'open' "
            "AND TIMESTAMPDIFF(HOUR, raised_at, NOW()) >= %s", (*ids, val("sku_request_open_hours")))
        for r in reqs:
            out.append(_flag("sku_request_open", "warn", by_id[r["site_id"]],
                             (f"Permintaan SKU #{r['id']} belum dijawab", f"SKU request #{r['id']} unanswered"),
                             (f"Barcode {r['barcode'] or '—'} · {r['h']} jam",
                              f"Barcode {r['barcode'] or '—'} · {r['h']} h"),
                             "permintaan-sku.html", str(r["id"]), r["h"]))

    # registered SKUs still without a rack at a hub
    if on("needs_rack_days"):
        rows = await db.fetch_all(
            "SELECT st.id AS site_id, COUNT(*) AS n FROM skus s JOIN sites st "
            f"  ON st.id IN ({ph}) "
            "LEFT JOIN brand_sites bs ON bs.brand_id = s.brand_id AND bs.site_id = st.id "
            "WHERE s.active = 1 AND COALESCE(bs.active, 1) = 1 "
            "  AND s.created_at <= NOW() - INTERVAL %s DAY "
            "  AND NOT EXISTS (SELECT 1 FROM slot_assignments sa WHERE sa.site_id = st.id "
            "                  AND sa.sku_id = s.id AND sa.slot_role = 'primary') "
            "GROUP BY st.id", (*ids, val("needs_rack_days")))
        for r in rows:
            out.append(_flag("needs_rack", "warn", by_id[r["site_id"]],
                             (f"{r['n']} SKU belum punya rak", f"{r['n']} SKUs have no rack"),
                             (f"Lebih dari {val('needs_rack_days')} hari sejak didaftarkan",
                              f"More than {val('needs_rack_days')} days since registration"),
                             "rak.html#needs"))

    # slow movers: stock held, nothing picked for N days
    if on("slow_mover_days"):
        rows = await db.fetch_all(
            "SELECT * FROM ("
            "  SELECT sa.site_id, s.name_display, "
            "         (SELECT COALESCE(SUM(ib.qty_on_hand),0) FROM inventory_balances ib "
            "           WHERE ib.site_id = sa.site_id AND ib.sku_id = sa.sku_id) AS qty, "
            "         (SELECT MAX(m.created_at) FROM stock_movements m WHERE m.site_id = sa.site_id "
            "           AND m.sku_id = sa.sku_id AND m.movement_type = 'pick_out') AS last_pick, "
            "         (SELECT MIN(m.created_at) FROM stock_movements m WHERE m.site_id = sa.site_id "
            "           AND m.sku_id = sa.sku_id AND m.qty_delta > 0) AS first_in "
            "  FROM slot_assignments sa JOIN skus s ON s.id = sa.sku_id "
            f" WHERE sa.site_id IN ({ph}) AND sa.slot_role = 'primary'"
            ") x WHERE x.qty > 0 AND x.first_in <= NOW() - INTERVAL %s DAY "
            "  AND (x.last_pick IS NULL OR x.last_pick <= NOW() - INTERVAL %s DAY)",
            (*ids, val("slow_mover_days"), val("slow_mover_days")))
        for r in rows:
            out.append(_flag("slow_mover", "info", by_id[r["site_id"]],
                             ("Tidak laku: " + r["name_display"], "Not selling: " + r["name_display"]),
                             (f"{r['qty']} unit, tidak terambil {val('slow_mover_days')} hari",
                              f"{r['qty']} units, not picked for {val('slow_mover_days')} days"),
                             "peta-hub.html"))

    order = {"critical": 0, "warn": 1, "info": 2}
    out.sort(key=lambda f: (order[f["severity"]], f["site_code"], -(f["age_hours"] or 0)))
    return out


@router.get("/flags", response_model=models.FlagList)
async def flags(site_id: int | None = None, user: auth.User = Depends(auth.require("supervisor"))):
    items = await compute_flags(user, site_id)
    counts = {"critical": 0, "warn": 0, "info": 0}
    for f in items:
        counts[f["severity"]] += 1
    return {"flags": items, "counts": counts}
