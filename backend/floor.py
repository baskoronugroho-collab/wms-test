"""Helpers for orders on the floor (canvas Section 6): outbound baskets, the
customer's out-of-stock instruction, the packaging rule, the next-count list,
and the bridges to other agents' tables (consumables, quarantine).

Owned by the orders-floor agent. Everything another agent owns is reached
through one function here, so a name that changes changes in one place:

  * special_bins (agent S, V30): basket codes, kind 'OUT'. Until the table
    exists (or has no OUT rows for the hub) any code shaped <HUB>-OUT-NN is
    accepted.
  * order_lines (agent L, V27): the customer's instruction from message 1
    (oos_type, oos_replace_*, oos_effective = what the WMS does, resolved by
    L) is read; what the floor did is written to oos_action, oos_units_wanted,
    oos_units_found, oos_done_replace_sku_code, oos_done_replace_units and
    oos_acted_at. A replacement line points back through
    replacement_for_line_id (V28). pos_sender builds message 5 from those.
  * consumables (agent C, V31): `routers.consumables.deduct_for_order(...)`
    at Selesai dikemas; the bench stock is read from `consumables`.
  * quarantine (agent C, V31): `routers.quarantine.add_driver_return(...)`.
"""
import importlib
import logging
import math
import re

import db

log = logging.getLogger("wms.floor")


# --------------------------------------------------------------------------
# schema probes (positive answers cached per process)
# --------------------------------------------------------------------------

_TABLES: dict[str, bool] = {}
_COLUMNS: dict[tuple[str, str], bool] = {}


async def has_table(table: str) -> bool:
    if _TABLES.get(table):
        return True
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s", (table,))
    found = bool(row and row["n"])
    if found:
        _TABLES[table] = True
    return found


async def has_column(table: str, column: str) -> bool:
    key = (table, column)
    if _COLUMNS.get(key):
        return True
    row = await db.fetch_one(
        "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = %s AND COLUMN_NAME = %s", (table, column))
    found = bool(row and row["n"])
    if found:
        _COLUMNS[key] = True
    return found


async def rule(key: str, default: int) -> int:
    row = await db.fetch_one("SELECT value_num FROM alert_rules WHERE rule_key = %s", (key,))
    if not row or row["value_num"] is None:
        return default
    return int(row["value_num"])


# --------------------------------------------------------------------------
# words for places
# --------------------------------------------------------------------------

def short_bin(code: str | None) -> str | None:
    """MA5-A-3-01 -> A-3-01: people read the bin without the hub code."""
    if not code:
        return code
    parts = code.split("-")
    if len(parts) >= 4:
        return "-".join(parts[1:])
    return code


# A stacked bin's code ends in its place in the stack: A-2-03B (bottom),
# A-2-03M (middle, three high), A-2-03T (top). A single bin ends in a digit.
_STACK_CODE = re.compile(r"^(?:[A-Z0-9]+-)?[A-Z0-9]{1,4}-\d+-\d+([BMT])$")
_STACK_WORDS = {"B": ("bawah", "bottom"), "M": ("tengah", "middle"), "T": ("atas", "top")}


def stack_words(code: str | None) -> tuple[str, str] | None:
    """('bawah', 'bottom') for MA5-A-2-03B or A-2-03B; None for a single bin."""
    m = _STACK_CODE.match(re.sub(r"\s+", "", code or "").upper())
    return _STACK_WORDS[m.group(1)] if m else None


def bin_words(rack_code: str | None, level_no: int | None, position_no: int | None,
              code: str | None = None) -> str | None:
    """Rak A, level 3 dari bawah, bin ke-1 (board 6c).

    With the bin's code, a stacked bin also says which one of its stack:
    Rak A, level 2 dari bawah, bin ke-3, yang bawah di tumpukan. Callers that sort by
    the code walk a stack bottom first (03B, 03M, 03T sort in that order).
    """
    if not rack_code:
        return None
    rack = rack_code.split("-")[-1]
    out = f"Rak {rack}"
    if level_no:
        out += f", level {level_no} dari bawah"
    if position_no:
        out += f", bin ke-{position_no}"
    word = stack_words(code)
    if word:
        out += f", yang {word[0]} di tumpukan"
    return out


def bin_matches(typed: str | None, code: str | None) -> bool:
    """A scanned or typed bin label against the bin's code, with or without
    the hub prefix and ignoring case and spaces."""
    if not typed or not code:
        return False
    t = re.sub(r"\s+", "", typed).upper()
    c = code.upper()
    return t == c or t == (short_bin(c) or "") or c.endswith("-" + t)


# --------------------------------------------------------------------------
# outbound baskets (decisions 5 Oct: MA5-OUT-01 and so on)
# --------------------------------------------------------------------------

async def basket_codes(site_id: int) -> list[str] | None:
    """The hub's outbound baskets from agent S's special_bins, in order.
    None when the table does not exist yet (any <HUB>-OUT-NN is accepted)."""
    if not await has_table("special_bins"):
        return None
    try:
        rows = await db.fetch_all(
            "SELECT code FROM special_bins WHERE site_id = %s AND kind = 'OUT' AND active = 1 "
            "ORDER BY seq, code", (site_id,))
    except Exception:
        log.exception("special_bins could not be read")
        return None
    return [r["code"].upper() for r in rows]


async def check_basket(site: dict, code: str) -> str:
    """The basket code, cleaned, or ValueError 'Indonesian / English'."""
    clean = re.sub(r"\s+", "", code or "").upper()
    if not clean:
        raise ValueError("Pindai label keranjang. / Scan the basket label.")
    known = await basket_codes(site["id"])
    if known is not None and known:
        if clean not in known:
            raise ValueError(f"{clean} bukan keranjang pesanan di {site['code']}. / "
                             f"{clean} is not an order basket at {site['code']}.")
        return clean
    if not re.fullmatch(rf"{re.escape(site['code'].upper())}-OUT-\d{{2,3}}", clean):
        raise ValueError(f"Ini bukan label keranjang pesanan ({site['code']}-OUT-01). / "
                         f"Not an order basket label ({site['code']}-OUT-01).")
    return clean


async def basket_holder(site_id: int, code: str, exclude_task_id: int | None = None) -> dict | None:
    """The order still in this basket, or None when it is free. A basket is
    busy from its scan until Selesai dikemas, or until a cancelled order's
    units are all back on the rack."""
    return await db.fetch_one(
        "SELECT pt.id AS task_id, pt.order_id, pt.status, o.hiryu_short_no, o.external_ref "
        "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "WHERE pt.site_id = %s AND pt.basket_code = %s AND pt.basket_released_at IS NULL "
        "  AND pt.id <> %s ORDER BY pt.id DESC LIMIT 1",
        (site_id, code, exclude_task_id or 0))


async def baskets(site_id: int, site_code: str) -> list[dict]:
    """Every outbound basket at the hub with what is in it."""
    busy = await db.fetch_all(
        "SELECT pt.basket_code, pt.id AS task_id, pt.order_id, pt.status, pt.claimed_by, "
        "       o.hiryu_short_no, o.external_ref, o.status AS order_status "
        "FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
        "WHERE pt.site_id = %s AND pt.basket_code IS NOT NULL "
        "  AND pt.basket_released_at IS NULL", (site_id,))
    by_code = {b["basket_code"]: b for b in busy}
    codes = await basket_codes(site_id)
    if not codes:
        codes = sorted(by_code)
    out = []
    for c in codes:
        b = by_code.get(c)
        out.append({
            "code": c, "busy": bool(b),
            "order_id": b["order_id"] if b else None,
            "order_label": (b["hiryu_short_no"] or b["external_ref"]) if b else None,
            "stage": (("cancelled" if b["order_status"] == "cancelled" else
                       "to_pack" if b["status"] == "completed" else "picking") if b else None),
        })
    return out


async def free_basket(site_id: int) -> str | None:
    """A free basket to name as the example on board 6b."""
    free = await free_baskets(site_id)
    return free[0] if free else None


async def free_baskets(site_id: int) -> list[str]:
    """Every free outbound basket, in order: any of them is right on board 6b."""
    return [b["code"] for b in await baskets(site_id, "") if not b["busy"]]


# --------------------------------------------------------------------------
# Mode manual (V32): units confirmed by a tap instead of a scan
# --------------------------------------------------------------------------

async def fifo_plate(cur, *, site_id: int, sku_id: int, location_id: int) -> dict | None:
    """Mode B in Mode manual: the label a scan would be accepted for first,
    the oldest in_stock label of this product in this bin (FIFO), locked. The
    tap counts as a scan of that label. None when the bin has no label on
    record."""
    return await db.one(
        cur, "SELECT id, plate_code, sku_id FROM unit_plates "
             "WHERE site_id = %s AND sku_id = %s AND location_id = %s AND state = 'in_stock' "
             "ORDER BY bound_at IS NULL, bound_at, id LIMIT 1 FOR UPDATE",
        (site_id, sku_id, location_id))


async def manual_units(order_id: int) -> dict[int, int]:
    """Units picked by a tap per order line of an order (only lines with any)."""
    rows = await db.fetch_all(
        "SELECT pl.order_line_id, SUM(pl.manual_units) AS n FROM pick_lines pl "
        "JOIN pick_tasks pt ON pt.id = pl.pick_task_id "
        "WHERE pt.order_id = %s AND pl.manual_units > 0 GROUP BY pl.order_line_id", (order_id,))
    return {r["order_line_id"]: int(r["n"]) for r in rows}


# --------------------------------------------------------------------------
# the customer's out-of-stock instruction (contract v1.1, message 1 and 5)
# --------------------------------------------------------------------------

INSTRUCTION_TYPES = ("replace", "remove", "cancel_order", "contact_customer")
_PLANS = {"replace": "replace", "remove": "remove", "cancel_order": "cancel_order"}


async def instruction(order_line_id: int) -> dict:
    """The line's instruction from message 1 (V27 columns): {type, effective,
    replace_*}. `effective` is what the WMS does: oos_effective, resolved by
    agent L at intake (null, contact_customer or an unusable replacement are
    cancel_order). A line from before V27 derives it the same way."""
    raw = await db.fetch_one(
        "SELECT oos_type, oos_effective, oos_problem, oos_replace_hiryu_item_id, "
        "       oos_replace_sku_code, oos_replace_sku_id, oos_replace_units "
        "FROM order_lines WHERE id = %s", (order_line_id,)) or {}
    itype = (raw.get("oos_type") or "").strip().lower() or None
    if itype not in INSTRUCTION_TYPES:
        itype = None
    plan = _PLANS.get((raw.get("oos_effective") or "").strip().lower())
    effective = plan or (itype if itype in ("replace", "remove") else "cancel_order")
    units = raw.get("oos_replace_units")
    return {
        "type": itype,
        "effective": effective,
        "problem": raw.get("oos_problem"),
        "replace_hiryu_item_id": raw.get("oos_replace_hiryu_item_id"),
        "replace_sku_code": (raw.get("oos_replace_sku_code") or "").strip().upper() or None,
        "replace_units": int(units) if units else None,
        "replace_sku_id": raw.get("oos_replace_sku_id"),
    }


async def replacement_sku(instr: dict, brand_id: int | None) -> dict | None:
    """The replacement SKU named by the instruction, or None if unknown."""
    cols = "id, name_display, brand_id, hiryu_sku_code, brand_sku_code"
    if instr.get("replace_sku_id"):
        return await db.fetch_one(f"SELECT {cols} FROM skus WHERE id = %s",
                                  (instr["replace_sku_id"],))
    code = instr.get("replace_sku_code")
    if not code:
        return None
    return await db.fetch_one(
        f"SELECT {cols} FROM skus "
        "WHERE UPPER(COALESCE(hiryu_sku_code, '')) = %s OR UPPER(brand_sku_code) = %s "
        "ORDER BY brand_id = %s DESC, UPPER(COALESCE(hiryu_sku_code, '')) = %s DESC, id LIMIT 1",
        (code, code, brand_id or 0, code))


async def record_outcome(cur, order_line_id: int, *, action: str, units_wanted: int,
                         units_found: int, replace_sku_code: str | None = None,
                         replace_units: int | None = None) -> None:
    """What the floor did with a missing line, on agent L's V27 columns.
    action: replaced | removed | cancel_order. Once set, oos_action also
    guards message 5 from being queued twice for the line."""
    await db.run(
        cur,
        "UPDATE order_lines SET oos_action = %s, oos_units_wanted = %s, "
        "oos_units_found = %s, oos_done_replace_sku_code = %s, oos_done_replace_units = %s, "
        "oos_acted_at = UTC_TIMESTAMP() WHERE id = %s",
        (action, units_wanted, units_found,
         replace_sku_code if action == "replaced" else None,
         replace_units if action == "replaced" else None, order_line_id))


# --------------------------------------------------------------------------
# the next count (agent C reads bin_count_flags)
# --------------------------------------------------------------------------

async def flag_bin(cur, *, site_id: int, location_id: int, sku_id: int | None, reason: str,
                   ref_type: str | None, ref_id: int | None, qty_before: int | None,
                   qty_found: int | None, actor: str | None) -> None:
    """Put a bin on the next count, once while it is open."""
    open_row = await db.one(
        cur, "SELECT id FROM bin_count_flags WHERE location_id = %s AND status = 'open' "
             "AND (sku_id = %s OR (sku_id IS NULL AND %s IS NULL)) LIMIT 1",
        (location_id, sku_id, sku_id))
    if open_row:
        await db.run(cur, "UPDATE bin_count_flags SET qty_found = %s, ref_type = %s, ref_id = %s "
                          "WHERE id = %s", (qty_found, ref_type, ref_id, open_row["id"]))
        return
    await db.run(
        cur,
        "INSERT INTO bin_count_flags (site_id, location_id, sku_id, reason, ref_type, ref_id, "
        "qty_before, qty_found, raised_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (site_id, location_id, sku_id, reason, ref_type, ref_id, qty_before, qty_found, actor))


# --------------------------------------------------------------------------
# bridges to agent C (consumables, quarantine)
# --------------------------------------------------------------------------

def _helper(module: str, name: str):
    try:
        mod = importlib.import_module(f"routers.{module}")
    except Exception:
        log.exception("routers.%s could not be imported", module)
        return None
    return getattr(mod, name, None)


async def book_consumables(cur, *, site_id: int, order_id: int, pack_type: str,
                           actor: str) -> bool:
    """Take the pack's consumables off the hub's stock at Selesai dikemas
    (S09). True when agent C's helper booked them in this transaction. Never
    fails the packing: a booking problem leaves order_packs.consumables_booked
    at 0 for the weekly count to catch."""
    fn = _helper("consumables", "deduct_for_order")
    if not fn:
        return False
    try:
        await fn(cur, site_id=site_id, order_id=order_id, pack=pack_type, actor_email=actor)
    except Exception:
        log.exception("consumables not booked for order %s", order_id)
        return False
    return True


async def bench_stock(site_id: int) -> list[dict]:
    """Bahan kemas di meja (board 6g): the bag and carton stock at the hub."""
    if not await has_table("consumables"):
        return []
    rows = await db.fetch_all(
        "SELECT name, stock_qty, unit FROM consumables WHERE site_id = %s AND active = 1 "
        "AND usage_basis IN ('bag', 'carton') ORDER BY usage_basis = 'carton', sort_order, name",
        (site_id,))
    out = []
    for r in rows:
        q = float(r["stock_qty"] or 0)
        out.append({"name": r["name"], "qty": int(q) if q.is_integer() else q, "unit": r["unit"]})
    return out


async def quarantine_trays(site_id: int) -> list[str]:
    """The hub's quarantine trays (agent C's helper), or <HUB>-QR-01."""
    fn = _helper("quarantine", "trays")
    if fn:
        return await fn(site_id)
    site = await db.fetch_one("SELECT code FROM sites WHERE id = %s", (site_id,))
    return [f"{str(site['code'] if site else '').split('-')[-1]}-QR-01"]


async def damaged_to_quarantine(cur, *, site_id: int, sku_id: int, location_id: int,
                                reason: str, actor: str, tray_code: str,
                                photo_key: str | None, note: str | None,
                                in_ledger: bool, is_training: bool) -> int | None:
    """Barang rusak (board 6c): a unit the picker found damaged in its bin goes
    to the quarantine tray. Cost Ninja, the SPV decides (7b).

    in_ledger: the bin has a free unit on record, so it leaves the stock now
    (agent C's report_in_hub: an `adjustment`, reason quarantine, and Hiryu
    hears the lower number). Not in_ledger: the record already had no free unit
    there, so only the quarantine row is written and the caller puts the bin
    on the next count. Returns the quarantine id, or None when agent C's
    helper is missing (nothing is written then)."""
    if in_ledger:
        fn = _helper("quarantine", "report_in_hub")
        if not fn:
            return None
        return await fn(cur, site_id=site_id, sku_id=sku_id, location_id=location_id, qty=1,
                        reason=reason, actor_email=actor, reason_note=note,
                        tray_code=tray_code, photo_key=photo_key, is_training=is_training)
    fn = _helper("quarantine", "_insert")
    if not fn:
        return None
    return await fn(cur, site_id=site_id, sku_id=sku_id, qty=1, origin="hub", reason=reason,
                    actor_email=actor, reason_note=note, location_id=location_id,
                    tray_code=tray_code, photo_key=photo_key, in_ledger=0,
                    is_training=is_training)


async def to_quarantine(cur, *, site_id: int, sku_id: int, qty: int, order: dict,
                        actor: str) -> int | None:
    """Damaged units back from the driver into quarantine: reason "Kembali dari
    driver, rusak", cost Ninja (agent C's helper sets both). Returns the
    quarantine row id, or None when the helper is missing (driver_returns then
    keeps the units still to book)."""
    fn = _helper("quarantine", "add_driver_return")
    if not fn:
        return None
    return await fn(cur, site_id=site_id, sku_id=sku_id, qty=qty, actor_email=actor,
                    order_id=order["id"],
                    order_ref=order.get("hiryu_short_no") or order.get("external_ref"),
                    is_training=bool(order.get("is_training")))


# --------------------------------------------------------------------------
# the packaging rule (PRD §6.10, board 6h)
# --------------------------------------------------------------------------

PACK_NAMES = {"bag": "Kantong kertas", "carton": "Karton", "two": "2 kemasan"}
PACK_NAMES_EN = {"bag": "Paper bag", "carton": "Carton", "two": "Two packs"}
PACK_TYPES = tuple(PACK_NAMES)

# Default when a SKU has no pack data and no content (§6.10.2: category default).
_DEFAULT = {"volume_ml": 200, "weight_g": 180, "longest_mm": 0}


def content_of(unit_size: str | None) -> tuple[float | None, str | None]:
    """'100 ml' -> (100, 'ml'); '1,5 L' -> (1500, 'ml'); '30 g' -> (30, 'g')."""
    if not unit_size:
        return None, None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(ml|l|g|gr|gram|kg)\b", unit_size.lower())
    if not m:
        return None, None
    n = float(m.group(1).replace(",", "."))
    u = m.group(2)
    if u == "l":
        return n * 1000, "ml"
    if u == "kg":
        return n * 1000, "g"
    if u in ("gr", "gram"):
        return n, "g"
    return n, u


def unit_pack(sku: dict, large_ml: int) -> dict:
    """One unit's volume (ml), weight (g), longest side (mm) and whether it is a
    large bottle, from the SKU's pack data or the §6.10.2 fallbacks."""
    estimated = False
    dims = [sku.get("pack_length_mm"), sku.get("pack_width_mm"), sku.get("pack_height_mm")]
    amount, unit = content_of(sku.get("unit_size"))
    name = (sku.get("name_display") or "").lower()
    glass = "kaca" in name or "glass" in name

    if all(dims):
        volume = dims[0] * dims[1] * dims[2] / 1000.0
        longest = max(dims)
    else:
        estimated = True
        longest = max([d for d in dims if d] or [0])
        if sku.get("unit_cube_cm3"):
            volume = float(sku["unit_cube_cm3"])
        elif amount:
            volume = amount * 1.3
        else:
            volume = _DEFAULT["volume_ml"]

    if sku.get("pack_weight_g"):
        weight = float(sku["pack_weight_g"])
    else:
        estimated = True
        weight = amount * (1.6 if glass else 1.2) if amount else _DEFAULT["weight_g"]

    if sku.get("is_large_bottle") is not None:
        large = bool(sku["is_large_bottle"])
    else:
        liquid = sku.get("is_liquid")
        large = bool(amount and unit == "ml" and amount >= large_ml and liquid is not False
                     and liquid != 0)
    return {"volume_ml": volume, "weight_g": weight, "longest_mm": longest,
            "large": large, "content_ml": amount if unit == "ml" else None,
            "estimated": estimated}


async def pack_rules() -> dict:
    return {
        "bag_volume_ml": await rule("pack_bag_volume_ml", 3900),
        "bag_weight_g": await rule("pack_bag_weight_g", 3000),
        "bag_longest_mm": await rule("pack_bag_longest_mm", 270),
        "bag_max_large": await rule("pack_bag_max_large", 1),
        "carton_volume_ml": await rule("pack_carton_volume_ml", 4000),
        "carton_weight_g": await rule("pack_carton_weight_g", 5000),
        "carton_longest_mm": await rule("pack_carton_longest_mm", 250),
        "large_ml": await rule("pack_large_bottle_ml", 150),
    }


def _num(v: float, digits: int = 1) -> str:
    """Indonesian decimal comma: 1.3 -> '1,3'."""
    return f"{v:.{digits}f}".replace(".", ",")


def suggest(lines: list[dict], r: dict) -> dict:
    """Name the pack for an order. `lines`: SKU rows (pack columns, unit_size,
    name_display, id) with `units`. First line that fits wins (§6.10.1)."""
    V = G = 0.0
    L = 0
    N = 0
    estimated = False
    units: list[dict] = []
    large_sizes: list[float] = []
    for ln in lines:
        n = int(ln.get("units") or 0)
        if n <= 0:
            continue
        u = unit_pack(ln, r["large_ml"])
        estimated = estimated or u["estimated"]
        V += u["volume_ml"] * n
        G += u["weight_g"] * n
        L = max(L, int(u["longest_mm"] or 0))
        if u["large"]:
            N += n
            if u["content_ml"]:
                large_sizes.append(u["content_ml"])
        for _ in range(n):
            units.append({"sku_id": ln.get("id") or ln.get("sku_id"), **u})

    facts = f"{_num(V / 1000)} L · {_num(G / 1000)} kg"
    facts_en = f"{V / 1000:.1f} L · {G / 1000:.1f} kg"
    size = f" ({int(max(large_sizes))} ml)" if large_sizes else ""
    bag_fails, bag_fails_en = [], []
    if N > r["bag_max_large"]:
        bag_fails.append(f"{N} botol besar{size}" if N > 1 else f"ada botol besar{size}")
        bag_fails_en.append(f"{N} large bottles" if N > 1 else "a large bottle")
    if V > r["bag_volume_ml"]:
        bag_fails.append(f"lebih dari {_num(r['bag_volume_ml'] / 1000)} L")
        bag_fails_en.append(f"over {r['bag_volume_ml'] / 1000:.1f} L")
    if G > r["bag_weight_g"]:
        bag_fails.append(f"lebih dari {_num(r['bag_weight_g'] / 1000)} kg")
        bag_fails_en.append(f"over {r['bag_weight_g'] / 1000:.1f} kg")
    if L > r["bag_longest_mm"]:
        bag_fails.append(f"barang lebih panjang dari {r['bag_longest_mm'] // 10} cm")
        bag_fails_en.append(f"an item longer than {r['bag_longest_mm'] // 10} cm")

    split = None
    if not bag_fails:
        kind = "bag"
        lead = (f"{N} botol besar{size}" if N else "tanpa botol besar")
        lead_en = (f"{N} large bottle" if N else "no large bottle")
        reason, reason_en = f"{lead} · {facts}", f"{lead_en} · {facts_en}"
    elif V <= r["carton_volume_ml"] and G <= r["carton_weight_g"] and L <= r["carton_longest_mm"]:
        kind = "carton"
        reason = f"{', '.join(bag_fails)} · {facts}"
        reason_en = f"{', '.join(bag_fails_en)} · {facts_en}"
    else:
        kind = "two"
        reason = f"terlalu besar untuk satu karton · {facts}"
        reason_en = f"too big for one carton · {facts_en}"
        # Heavy and large items into the carton first, the rest into the bag.
        units.sort(key=lambda u: (not u["large"], -u["weight_g"], -u["volume_ml"]))
        cv = cg = 0.0
        carton, bag = {}, {}
        for u in units:
            fits = (cv + u["volume_ml"] <= r["carton_volume_ml"]
                    and cg + u["weight_g"] <= r["carton_weight_g"]
                    and (u["longest_mm"] or 0) <= r["carton_longest_mm"])
            target = carton if fits else bag
            if fits:
                cv += u["volume_ml"]
                cg += u["weight_g"]
            target[u["sku_id"]] = target.get(u["sku_id"], 0) + 1
        split = {"carton": [{"sku_id": k, "units": v} for k, v in carton.items()],
                 "bag": [{"sku_id": k, "units": v} for k, v in bag.items()]}

    return {
        "pack_type": kind, "name": PACK_NAMES[kind], "name_en": PACK_NAMES_EN[kind],
        "reason": "Kenapa: " + reason, "reason_en": "Why: " + reason_en,
        "volume_ml": int(math.ceil(V)), "weight_g": int(math.ceil(G)),
        "longest_mm": L or None, "large_bottles": N, "estimated": estimated,
        "split": split,
    }
