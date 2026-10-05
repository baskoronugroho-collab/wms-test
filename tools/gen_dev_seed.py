#!/usr/bin/env python3
"""Generate backend/db/seed.sql: the DEV database for the demo to Shaun.

Substrait applies backend/db/seed.sql to non-production databases after the
Flyway migrations (V1 to V31), as a repeatable migration: on the first deploy,
again whenever this file's output changes, and after a database reset. It is
never applied to production. Nothing here is customer data.

What it builds (canvas DEMO-NUMBERS.md: about 7 orders a day per hub, 10 to 15
units an order, about 15 units per SKU, about Rp 45,000 a unit):

  * hubs MA5 (Cawang, site 4, Hiryu dark store 13) and KJ5 (Kemanggisan, site 2,
    dark store 14) completed, open 08:00 to 22:00, 6 temporary inbound bins, 1
    quarantine tray and 6 outbound baskets each; Mode demo on at MA5. The
    training site (99) is left alone.
  * people at MA5 (Dimas, Ayu, Eko, Rina), at KJ5 (Fajar, Rizky, Sari), Ops HQ
    (Andi) and the Ops Head (Bayu). Existing accounts are never changed.
  * brands Kahf and Labore (PT Paragon) and their 68 + 37 SKUs from the 25 Sep
    recheck lists (../Grab Kilat Fulfillment/*_sku_recheck.csv): bin size by the
    size guide, isi sampai 12 to 24, pesan ulang 25 %, Grab buffer 1. Wardah and
    Kirana are switched off once (not in the pilot).
  * Hiryu stores 902 Kahf - Cawang, 903 Labore - Cawang, 904 Kahf - Kemanggisan,
    905 Labore - Kemanggisan: MANUAL, link on, active on Grab; one menu item per
    SKU per store at a Grab menu price (Rp 29,000 to 89,000).
  * racks A to D per hub: 5 levels, 2 kolom of 3 bins (level 1 Besar, levels 2 to
    5 Kecil), labels printed and checked; every SKU in a bin, and the demo bins
    of DEMO-NUMBERS (A-2-03 and C-1-02, A-3-01, A-4-01, A-2-05, B-1-04).
  * stock through the ledger (stock_movements + inventory_balances); batches
    dated over the last 120 days, so Stok lama has a few bins.
  * one week of history, Mon 28 Sep to Sun 4 Oct 2026: 7 orders a day per hub,
    picked, packed and handed over, 3 missing-item cancels and 1 customer
    cancel; the Kahf delivery received and put away (RPL-MA5-2609-001); the
    Labore request sent and confirmed with the brand's PO number
    (RPL-MA5-2609-002, 6 SKUs, 124 pcs); cycle counts with one difference; two
    quarantine items; consumables counted, used and received; one UJI order
    per hub.

Re-running never duplicates: master rows use natural keys (INSERT IGNORE, or ON
DUPLICATE KEY UPDATE that fills blanks only); history rows hang off the SEED-
order references and the demo people, and the seed deletes and rewrites only
rows it owns. The one-time reset of the first seed's racks and stock is gated
by an audit_log marker (entity dev_seed, action seed_layout_v3), so a later run
never undoes what testers did on the floor.

It also writes docs/dev-test-orders.txt: how to run the demo, and message 1 / 2
bodies for the link.

    python tools/gen_dev_seed.py
"""
import csv
import json
import math
import pathlib
import random
import re
from datetime import date, datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / "Grab Kilat Fulfillment"
OUT = ROOT / "backend" / "db" / "seed.sql"
SAMPLE = ROOT / "docs" / "dev-test-orders.txt"

OLD_SEED = "seed@ninjavan.co"           # owner of the first dev seed's rows
MARK = "seed_layout_v3"
GATE = ("NOT EXISTS (SELECT 1 FROM audit_log WHERE entity = 'dev_seed' "
        f"AND action = '{MARK}')")

BRANDS = [(10, "KHF", "Kahf", "kahf"), (11, "LBR", "Labore", "labore")]
COMPANY = "PT Paragon Technology and Innovation"
RESTOCK_EMAIL = "restock@paragon.example"


def em(k: str) -> str:
    return f"{k}@ninjavan.co"


# key, name, role, default site, sites, Hiryu login made
PEOPLE = [
    ("dimas.pratama", "Dimas Pratama", "staff", 4, [4], 1),
    ("ayu.lestari", "Ayu Lestari", "staff", 4, [4], 1),
    ("eko.prasetyo", "Eko Prasetyo", "staff", 4, [4], 1),
    ("rina.saputri", "Rina Saputri", "supervisor", 4, [4], 1),
    ("andi.pratama", "Andi Pratama", "hq", 4, [2, 4], 1),
    ("bayu.hidayat", "Bayu Hidayat", "ops_head", 4, [2, 4], 0),
    ("sari.wulandari", "Sari Wulandari", "supervisor", 2, [2], 1),
    ("fajar.ramadhan", "Fajar Ramadhan", "staff", 2, [2], 1),
    ("rizky.maulana", "Rizky Maulana", "staff", 2, [2], 1),
]
NAME = {em(k): n for k, n, *_ in PEOPLE}
HQ = em("andi.pratama")

HUBS = [
    dict(site=4, code="MAC-MA5", short="MA5", name="Cawang", dark=13, rack_base=110,
         address="Jl. Raya Kalibata No. 4, Kramat Jati",
         stores={10: (902, "Kahf - Cawang"), 11: (903, "Labore - Cawang")},
         spv=em("rina.saputri"), am=em("dimas.pratama"), pm=em("eko.prasetyo"),
         packer=em("ayu.lestari"),
         counters=[em("dimas.pratama"), em("eko.prasetyo"), em("ayu.lestari")], demo=1),
    dict(site=2, code="MAC-KJ5", short="KJ5", name="Kemanggisan", dark=14, rack_base=100,
         address="Kec. Palmerah, Jakarta Barat",
         stores={10: (904, "Kahf - Kemanggisan"), 11: (905, "Labore - Kemanggisan")},
         spv=em("sari.wulandari"), am=em("fajar.ramadhan"), pm=em("fajar.ramadhan"),
         packer=em("rizky.maulana"), counters=[em("fajar.ramadhan"), em("rizky.maulana")], demo=0),
]
RACKS, LEVELS, POSITIONS = "ABCD", 5, 6
WEEK = [date(2026, 9, 28) + timedelta(days=d) for d in range(7)]
CYCLE_START = WEEK[0]
CYCLE_DAYS = {11: 14, 10: 28}           # Labore every 2 weeks, Kahf every 4 weeks
WIB = timedelta(hours=7)
PRINTED = datetime(2026, 9, 25, 10, 0)

# DEMO-NUMBERS bins. The canvas uses product names the recheck list does not
# have; the nearest real Labore products stand in (docs/dev-test-orders.txt).
DEMO_BINS = {"A-2-03": ("LBR-0001", "primary"),    # GentleBiome Mild Cleanser 100 ml
             "C-1-02": ("LBR-0001", "overflow"),   # its second bin
             "A-3-01": ("LBR-0007", "primary"),    # for "Micellar Water 100 ml"
             "A-4-01": ("LBR-0028", "primary"),    # for "BiomeBright Serum 20 ml"
             "A-2-05": ("LBR-0015", "primary"),    # for "BiomeBarrier Moisturizer 30 ml"
             "B-1-04": ("LBR-0002", "primary")}    # GentleBiome Mild Cleanser 225 ml
STAND_IN = {"LBR-0007": "Micellar Water 100 ml", "LBR-0028": "BiomeBright Serum 20 ml",
            "LBR-0015": "BiomeBarrier Moisturizer 30 ml"}
# The Labore request waiting for its delivery (DEMO-NUMBERS: 6 SKUs, 124 pcs).
LABORE_REQUEST = [("LBR-0001", 24), ("LBR-0007", 22), ("LBR-0028", 20), ("LBR-0015", 20),
                  ("LBR-0002", 16), ("LBR-0005", 22)]
# At MA5 those SKUs were already low on 28 Sep, and the week leaves at least
# the floor in their rack bin, so the replayed GM-358 can be picked.
MA5_OPENING = {"A-2-03": 9, "C-1-02": 6, "A-3-01": 9, "A-4-01": 8, "A-2-05": 8, "B-1-04": 5,
               "LBR-0005": 6}
MA5_FLOOR = {"LBR-0001": 4, "LBR-0007": 4, "LBR-0028": 4, "LBR-0015": 4, "LBR-0002": 3,
             "LBR-0005": 2}
CONSUMABLES = ["Kantong kertas Berkah PBG15", "Kardus Maxellpack CCM-36", "Gulungan label bin",
               "Lakban", "Sekat warna", "Stiker warna hari"]
BAG, CARTON, LABEL, TAPE, DIVIDER, STICKER = CONSUMABLES


# --------------------------------------------------------------------- helpers

def esc(v):
    if v is None or v == "":
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, datetime):
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"
    if isinstance(v, date):
        return "'" + v.isoformat() + "'"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def utc(t):
    """A WIB moment as the UTC literal the database stores (V13)."""
    return "NULL" if t is None else esc(t - WIB)


def wib(d: date, h: int, m: int = 0, s: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, s)


def num(v):
    d = re.sub(r"[^0-9]", "", str(v or "").split("(")[0])
    return int(d) if d else None


def ean13(seed: int) -> str:
    body = "299" + str(seed).zfill(9)
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(body))
    return body + str((10 - total % 10) % 10)


def day_key(t: datetime) -> str:
    return ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[t.weekday()]


def rows_for(stem):
    with open(SRC / f"{stem}_sku_recheck.csv", encoding="utf-8-sig", newline="") as fh:
        data = list(csv.DictReader(fh))
    out = []
    for r in data:
        status = (r.get("Status") or "kept").lower()
        bundle = (r.get("Bundle (Y/N)") or "").upper().startswith("Y")
        barcode = (r.get("Barcode EAN") or "").strip()
        kit = bundle and bool(barcode)
        if (bundle and not kit) or "discontinued" in status or "duplicate" in status:
            continue
        out.append(r)
    return out


class Sql:
    def __init__(self):
        self.lines: list[str] = []
        self.count = 0

    def note(self, text: str):
        self.lines.append("")
        for t in text.strip().splitlines():
            self.lines.append("-- " + t)

    def stmt(self, text: str):
        self.lines.append(text.rstrip().rstrip(";") + ";")
        self.count += 1

    def values(self, head: str, rows: list[str], tail: str = "", n: int = 40):
        for i in range(0, len(rows), n):
            part = rows[i:i + n]
            self.stmt(head + "\n" + ",\n".join(part) + (("\n" + tail) if tail else ""))


def vals(*v) -> str:
    return "  (" + ", ".join(v) + ")"


def in_list(items) -> str:
    return "(" + ", ".join(esc(i) for i in items) + ")"


def order_id(ref: str) -> str:
    return f"(SELECT id FROM orders WHERE external_ref = {esc(ref)})"


def line_id(ref: str, sku_id: int) -> str:
    return (f"(SELECT ol.id FROM order_lines ol JOIN orders o ON o.id = ol.order_id "
            f"WHERE o.external_ref = {esc(ref)} AND ol.sku_id = {sku_id})")


def item_id(store_no: int, s: dict) -> str:
    return f"IDITE2026100{store_no}{s['id']:05d}"


# --------------------------------------------------------------------- SKUs

_ML = re.compile(r"(\d+(?:[.,]\d+)?)\s*ml\b", re.I)


def menu_price(real) -> int:
    """Grab menu price at the demo scale (DEMO-NUMBERS: about Rp 45,000 a unit)."""
    p = real or 140000
    return int(min(89000, max(29000, round((28000 + 0.22 * p) / 500) * 500)))


def load_skus(rng: random.Random) -> list[dict]:
    skus = []
    sku_id = 1000
    for brand_id, code, _name, stem in BRANDS:
        for n, r in enumerate(rows_for(stem), 1):
            sku_id += 1
            name = (r.get("Product name") or "").strip()
            raw_size = (r.get("Unit size") or "").strip()
            size = re.split(r"[;(]", raw_size)[0].strip() or None
            price = num(r.get("Price (Rp)"))
            cube = num(r.get("Est. unit cube incl. carton (cm3)"))
            m = _ML.search(f"{size or ''} {name}")
            ml = float(m.group(1).replace(",", ".")) if m else None
            kit = (r.get("Bundle (Y/N)") or "").upper().startswith("Y")
            besar = bool((ml and ml >= 150) or (cube and cube >= 450))
            bc = (r.get("Barcode EAN") or "").strip()
            bc = bc if re.fullmatch(r"\d{8,14}", bc) else ean13(sku_id)
            in_name = size and size.lower().replace(" ", "") in name.lower().replace(" ", "")
            menu = menu_price(price)
            w = (60000 / menu) ** 1.6 * rng.uniform(0.6, 1.4) * (0.3 if kit else 1.0)
            skus.append(dict(
                id=sku_id, brand_id=brand_id, code=f"{code}-{n:04d}", name=name, size=size,
                price=price, cube=cube, ml=ml, kit=kit, bin="BESAR" if besar else "KECIL",
                barcode=bc, bc_source="test" if bc.startswith("299") else "manufacturer",
                weight=num(r.get("Weight g")), category=r.get("Category"), line=r.get("Product line"),
                menu=menu, w=w, large=1 if (ml or 0) >= 150 else 0,
                item_name=name if in_name or not size else f"{name} {size}"))
    ranked = sorted(skus, key=lambda s: -s["w"])
    for i, s in enumerate(ranked):
        f = i / len(ranked)
        s["fill"] = 24 if f < 0.3 else 22 if f < 0.7 else 18 if f < 0.85 else 12
    by_code = {s["code"]: s for s in skus}
    for code, _ in LABORE_REQUEST:
        by_code[code]["fill"] = 24
    by_code["LBR-0002"]["fill"] = 18
    for s in skus:
        s["reorder"] = max(1, math.ceil(s["fill"] * 0.25))
    return skus


# --------------------------------------------------------------------- layout

def layout(hub: dict, skus: list[dict]) -> dict:
    """Racks A to D, the bins, and which SKU sits where (the same plan at both hubs)."""
    bins = []
    for ri, rc in enumerate(RACKS):
        rack_id = hub["rack_base"] + ri
        for lv in range(1, LEVELS + 1):
            level_id = rack_id * 10 + lv
            for pos in range(1, POSITIONS + 1):
                short = f"{rc}-{lv}-{pos:02d}"
                bins.append(dict(id=level_id * 10 + pos, level_id=level_id, rack_id=rack_id,
                                 rack=rc, lv=lv, pos=pos, kolom=1 if pos <= 3 else 2,
                                 short=short, code=f"{hub['short']}-{short}",
                                 size="BESAR" if lv == 1 else "KECIL"))
    by_short = {b["short"]: b for b in bins}
    by_code = {s["code"]: s for s in skus}
    slots, used, placed = [], set(), set()
    for short, (code, role) in DEMO_BINS.items():
        slots.append((by_code[code], by_short[short], role))
        used.add(short)
        if role == "primary":
            placed.add(code)
    order = [s for s in skus if s["brand_id"] == 11] + [s for s in skus if s["brand_id"] == 10]
    free = {sz: [b for b in bins if b["size"] == sz and b["short"] not in used]
            for sz in ("KECIL", "BESAR")}
    for s in order:
        if s["code"] in placed:
            continue
        pool = free[s["bin"]] or free["BESAR"] or free["KECIL"]
        slots.append((s, pool.pop(0), "primary"))
    return dict(bins=bins, slots=slots, by_short=by_short)


# --------------------------------------------------------------------- the week

class HubSim:
    """One hub's stock, moved in time order so no bin ever goes below 0."""

    def __init__(self, hub, plan, skus):
        self.h, self.plan = hub, plan
        self.qty: dict[int, int] = {}
        self.since: dict[int, datetime | None] = {}
        self.sku_bins: dict[int, list] = {}
        self.bin_sku: dict[int, dict] = {}
        self.openings: list[tuple] = []          # (bin, sku, qty, when, actor)
        for s, b, role in plan["slots"]:
            self.sku_bins.setdefault(s["id"], []).append((b, role))
            self.bin_sku[b["id"]] = s

    def primary(self, sku_id):
        return next(b for b, r in self.sku_bins[sku_id] if r == "primary")

    def at(self, b):
        return self.qty.get(b["id"], 0)

    def move(self, b, n, when):
        before = self.at(b)
        after = before + n
        assert after >= 0, (self.h["short"], b["code"], before, n)
        self.qty[b["id"]] = after
        if before == 0 and after > 0:
            self.since[b["id"]] = when
        elif after == 0:
            self.since[b["id"]] = None


def simulate(skus, plans, rng):
    sims = {h["short"]: HubSim(h, plans[h["short"]], skus) for h in HUBS}
    by_code = {s["code"]: s for s in skus}
    old_ids = {s["id"] for s in sorted(skus, key=lambda s: s["w"])[:7]}   # slow movers: Stok lama
    special = {("MA5", 1, 1): ("missing", 10), ("KJ5", 3, 2): ("missing", 11),
               ("KJ5", 5, 4): ("missing", 10), ("KJ5", 4, 3): ("customer", None)}
    # The products that will be missing: the system shows 3, the bin is empty.
    reserved = {}
    for (short, di, oi), (kind, br) in special.items():
        if kind != "missing":
            continue
        pool = [s for s in sorted(skus, key=lambda s: s["w"])[8:40]
                if s["brand_id"] == br and not s["kit"] and s["code"] not in MA5_FLOOR
                and s["id"] not in {x["id"] for x in reserved.values()}]
        reserved[(short, di, oi)] = rng.choice(pool)
    held = {(k[0], s["id"]) for k, s in reserved.items()}

    # Opening stock: one batch per bin, dated over the last 120 days.
    for short, st in sims.items():
        for s, b, role in st.plan["slots"]:
            if b["short"] == "A-2-03":
                when = datetime(2026, 9, 10, 10, 15)
            elif b["short"] == "C-1-02":
                when = datetime(2026, 9, 21, 14, 5)
            elif s["id"] in old_ids:
                when = datetime(2026, 6, 8, 10) + timedelta(days=rng.randint(0, 22), minutes=rng.randint(0, 300))
            elif rng.random() < 0.2:
                when = datetime(2026, 7, 12, 10) + timedelta(days=rng.randint(0, 45), minutes=rng.randint(0, 300))
            else:
                when = datetime(2026, 9, 1, 10) + timedelta(days=rng.randint(0, 24), minutes=rng.randint(0, 300))
            qty = s["fill"] if role == "primary" else 0
            if (short, s["id"]) in held:
                qty = 3
            if short == "MA5":
                qty = MA5_OPENING.get(b["short"], MA5_OPENING.get(s["code"], qty))
            if qty:
                st.move(b, qty, when)
                st.openings.append((b, s, qty, when, st.h["spv"]))

    events = []          # (time, order, hub, kind, data)
    for short in sims:
        events.append((wib(date(2026, 9, 26), 10, 5), 0, short, "uji", None))
        for d in WEEK:
            events.append((wib(d, 7, 30), 0, short, "counts", d))
    for di, d in enumerate(WEEK):
        for short in sims:
            mins = sorted(rng.sample(range(8 * 60 + 5, 21 * 60 + 40, 5), 7))
            brands = [10, 10, 10, 10, 11, 11, 11] if di % 2 else [10, 10, 10, 10, 10, 11, 11]
            rng.shuffle(brands)
            for oi, (m, br) in enumerate(zip(mins, brands)):
                kind, force = special.get((short, di, oi), ("normal", None))
                events.append((wib(d, m // 60, m % 60, rng.randint(0, 59)), 1, short, kind,
                               (force or br, reserved.get((short, di, oi)))))
    events.append((wib(date(2026, 9, 30), 10, 45), 1, "MA5", "delivery", None))
    events.append((wib(date(2026, 10, 2), 16, 10), 1, "MA5", "quarantine", "KHF-0029"))
    events.append((wib(date(2026, 10, 3), 11, 5), 1, "KJ5", "quarantine", "KHF-0003"))
    events.sort(key=lambda e: (e[0], e[1]))

    orders, counts, flags, quarantine = [], [], [], []
    delivery = None
    missing_skus: dict[str, list] = {"MA5": [], "KJ5": []}
    floors = {by_code[c]["id"]: f for c, f in MA5_FLOOR.items()}
    variance_done = False

    for t0, _o, short, kind, data in events:
        st = sims[short]
        h = st.h

        if kind == "counts":
            d = data
            due = []
            flagged = [f for f in flags if f["hub"] == short and f["closed"] is None]
            for f in flagged:
                due.append((f["bin"], "missing_item", f))
            for brand, p in CYCLE_DAYS.items():
                bins = sorted([b for s, b, _r in st.plan["slots"] if s["brand_id"] == brand],
                              key=lambda b: b["code"])
                k = (d - CYCLE_START).days
                for i, b in enumerate(bins):
                    if k % p == i % p and all(x[0]["id"] != b["id"] for x in due):
                        due.append((b, "cycle", brand))
            for n, (b, reason, ref) in enumerate(due):
                start = t0 + timedelta(minutes=4 * n, seconds=rng.randint(0, 50))
                exp = st.at(b)
                who = h["counters"][n % len(h["counters"])]
                c = dict(hub=short, day=d, bin=b, sku=st.bin_sku[b["id"]], reason=reason,
                         brand=ref if reason == "cycle" else None, expected=exp, counted=exp,
                         counter=who, start=start, end=start + timedelta(seconds=rng.randint(70, 150)))
                if reason == "missing_item":
                    ref["closed"] = c["end"]
                    ref["closed_by"] = who
                if (not variance_done and short == "MA5" and d == date(2026, 10, 2)
                        and reason == "cycle" and ref == 10 and exp >= 3):
                    variance_done = True
                    c["counted"] = exp - 1
                    c["recounter"] = h["counters"][(n + 1) % len(h["counters"])]
                    c["recount_end"] = c["end"] + timedelta(minutes=6)
                    c["approved"] = wib(d, 9, 10)
                    c["reviewed"] = wib(d, 14, 20)
                    st.move(b, -1, c["approved"])
                counts.append(c)
            continue

        if kind == "delivery":
            gone = {s["id"] for s in missing_skus["MA5"]}
            kahf = [s for s in skus if s["brand_id"] == 10 and not s["kit"]]
            low = sorted(kahf, key=lambda s: (st.at(st.primary(s["id"])) / s["fill"], -s["w"]))
            pick = [s for s in low if s["id"] in gone]
            pick += [s for s in low if s["id"] not in gone][:12 - len(pick)]
            lines = []
            for k, s in enumerate(pick):
                b = st.primary(s["id"])
                before = st.at(b)
                q = max(6, math.ceil((s["fill"] - before) / 6) * 6)
                at = t0 + timedelta(minutes=2 * k, seconds=rng.randint(0, 50))
                lines.append(dict(sku=s, qty=q, bin=b, at=at, stock_before=before,
                                  load_bin=f"MA5-IN-{k % 6 + 1:02d}", batch=1 if k < 6 else 2))
                st.move(b, q, at)
            delivery = dict(hub="MA5", lines=lines)
            continue

        if kind == "quarantine":
            s = by_code[data]
            b = st.primary(s["id"])
            assert st.at(b) >= 1
            st.move(b, -1, t0)
            quarantine.append(dict(hub=short, sku=s, bin=b, at=t0))
            continue

        if kind == "uji":
            pool = [s for s in skus if s["brand_id"] == 10 and not s["kit"]
                    and st.at(st.primary(s["id"])) > 4 and st.since[st.primary(s["id"])["id"]] < t0]
            chosen = sorted(rng.sample(pool, 3), key=lambda s: st.primary(s["id"])["code"])
            lines = [dict(sku=s, qty=q, bin=st.primary(s["id"])) for s, q in zip(chosen, (2, 1, 1))]
            o = dict(hub=short, placed=t0, brand=10, store=h["stores"][10][0], lines=lines,
                     kind="uji", ref=f"SEED-UJI-{short}", gm="UJI-01", basket=f"{short}-OUT-01",
                     picker=h["counters"][0], packer=h["packer"])
            o["claimed"] = t0 + timedelta(seconds=30)
            o["started"] = o["claimed"] + timedelta(seconds=20)
            o["completed"] = o["started"] + timedelta(minutes=4)
            o["pack_started"] = o["completed"] + timedelta(seconds=30)
            o["packed"] = o["pack_started"] + timedelta(minutes=2)
            o["handed"] = o["packed"] + timedelta(minutes=1)
            o["returned"] = o["handed"] + timedelta(minutes=12)
            for k, l in enumerate(lines, 1):
                l["seq"] = k
                st.move(l["bin"], -l["qty"], o["started"])
                st.move(l["bin"], l["qty"], o["returned"])
            orders.append(o)
            continue

        # A Grab order.
        br, miss = data
        brand_skus = [s for s in skus if s["brand_id"] == br and (short, s["id"]) not in held
                      and not (kind == "missing" and s["id"] in floors)]

        def room(s):
            floor = floors.get(s["id"], 1) if short == "MA5" else 1
            return st.at(st.primary(s["id"])) - floor

        avail = [s for s in brand_skus if room(s) >= 1]
        n_lines = rng.choices([3, 4, 5, 6], [0.3, 0.35, 0.2, 0.15])[0]
        chosen = []
        if miss:
            # The product the picker cannot find: the system still shows 3 units,
            # the bin is empty (the ledger was wrong).
            chosen.append(miss)
        while avail and len(chosen) < n_lines:
            s = rng.choices(avail, [x["w"] for x in avail])[0]
            chosen.append(s)
            avail.remove(s)
        qty = {s["id"]: 1 for s in chosen}
        if miss:
            qty[miss["id"]] = min(2, st.at(st.primary(miss["id"])))
        for _ in range(rng.randint(10, 15) - sum(qty.values())):
            ok = [s for s in chosen if s is not miss and qty[s["id"]] < min(5, room(s))]
            if not ok:
                break
            s = rng.choices(ok, [x["w"] for x in ok])[0]
            qty[s["id"]] += 1
        chosen.sort(key=lambda s: st.primary(s["id"])["code"])
        lines = [dict(sku=s, qty=qty[s["id"]], bin=st.primary(s["id"]), seq=k)
                 for k, s in enumerate(chosen, 1)]
        for l in lines:
            r = rng.random()
            l["oos"] = None if r < 0.7 else "remove" if r < 0.9 else "contact_customer"
        o = dict(hub=short, placed=t0, brand=br, store=h["stores"][br][0], lines=lines, kind=kind,
                 ref=f"SEED-{short}-{t0:%m%d-%H%M}", basket=f"{short}-OUT-{len(orders) % 6 + 1:02d}",
                 picker=h["am"] if t0.hour < 15 else h["pm"], packer=h["packer"])
        orders.append(o)
        o["claimed"] = t0 + timedelta(seconds=rng.randint(15, 50))
        if kind == "customer":
            o["cancelled"] = o["claimed"] + timedelta(seconds=rng.randint(60, 120))
            continue
        o["started"] = o["claimed"] + timedelta(seconds=rng.randint(10, 40))
        if kind == "missing":
            # Lines before the missing one in the walk are in the basket already;
            # the order is cancelled (customer's instruction) and they go back.
            short_line = next(l for l in lines if l["sku"] is miss)
            short_line["oos"] = "cancel_order"
            o["short"] = short_line
            for l in lines:
                if l["seq"] < short_line["seq"]:
                    l["picked"] = l["qty"]
                    st.move(l["bin"], -l["qty"], o["started"] + timedelta(seconds=30 * l["seq"]))
            o["found_before"] = st.at(short_line["bin"])
            o["cancelled"] = o["started"] + timedelta(seconds=30 * short_line["seq"] + rng.randint(30, 60))
            st.move(short_line["bin"], -o["found_before"], o["cancelled"])
            o["returned"] = o["cancelled"] + timedelta(minutes=rng.randint(8, 15))
            for l in lines:
                if l.get("picked"):
                    st.move(l["bin"], l["picked"], o["returned"])
            missing_skus[short].append(miss)
            flags.append(dict(hub=short, bin=short_line["bin"], sku=miss, order=o,
                              before=o["found_before"], at=o["cancelled"], by=o["picker"], closed=None))
            continue
        slow = rng.random() < 0.06
        o["completed"] = o["started"] + timedelta(seconds=rng.randint(400, 480) if slow else rng.randint(195, 300))
        for l in lines:
            st.move(l["bin"], -l["qty"], o["started"] + timedelta(seconds=30 * l["seq"]))
        o["pack_started"] = o["completed"] + timedelta(seconds=rng.randint(10, 50))
        o["packed"] = o["pack_started"] + timedelta(seconds=rng.randint(115, 185))
        o["handed"] = o["packed"] + timedelta(seconds=rng.randint(120, 660))
        units = sum(l["qty"] for l in lines)
        large = sum(l["qty"] for l in lines if l["sku"]["large"])
        besar = sum(1 for l in lines if l["sku"]["bin"] == "BESAR")
        o["pack"] = "carton" if large >= 2 or (besar >= 2 and units >= 13) else "bag"
        o["large"] = large

    # GM numbers rise across both hubs (Hiryu numbers every store it runs),
    # skipping the two the replayed demo uses.
    n = 296
    for o in sorted((o for o in orders if o["kind"] != "uji"), key=lambda o: o["placed"]):
        n += rng.randint(1, 3)
        while n in (347, 358):
            n += 1
        o["gm"] = f"GM-{n}"
    return sims, orders, delivery, counts, flags, quarantine


# --------------------------------------------------------------------- SQL: master data

def emit_master(sql, skus, plans, orders):
    hours = json.dumps({d: [{"open": "08:00", "close": "22:00"}]
                        for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")},
                       separators=(",", ":"))
    sql.note("1. Hubs: MA5 Cawang (site 4) and KJ5 Kemanggisan (site 2), completed, from Hiryu.\n"
             "A code or dark store number already held by another hub is left alone (unique keys).")
    for h in HUBS:
        sql.stmt(f"UPDATE sites s LEFT JOIN sites x ON x.code = {esc(h['code'])} AND x.id <> s.id\n"
                 f"   SET s.code = {esc(h['code'])}\n"
                 f" WHERE s.id = {h['site']} AND x.id IS NULL")
        sql.stmt(f"UPDATE sites s LEFT JOIN sites x ON x.hiryu_dark_store_id = {h['dark']} AND x.id <> s.id\n"
                 f"   SET s.hiryu_dark_store_id = {h['dark']}\n"
                 f" WHERE s.id = {h['site']} AND x.id IS NULL AND s.hiryu_dark_store_id IS NULL")
        sql.stmt(f"UPDATE sites SET name = {esc(h['name'])}, address = {esc(h['address'])}, "
                 f"site_type = 'darkstore', active = 1,\n"
                 f"       opening_hours_json = {esc(hours)},\n"
                 f"       hiryu_received_at = COALESCE(hiryu_received_at, {utc(datetime(2026, 9, 24, 14, 0))}),\n"
                 f"       setup_completed_at = COALESCE(setup_completed_at, {utc(datetime(2026, 9, 24, 15, 30))}),\n"
                 f"       setup_completed_by = COALESCE(setup_completed_by, {esc(HQ)}),\n"
                 f"       hiryu_active = 1, demo_mode = GREATEST(demo_mode, {h['demo']})\n"
                 f" WHERE id = {h['site']}")

    sql.note("2. Brands. Kahf and Labore (PT Paragon), each on its own Grab merchant account.\n"
             "Wardah and Kirana are not in the pilot: switched off once, not carried at MA5 or KJ5.")
    sql.stmt("INSERT INTO brands (id, code, name, identity_mode, active, default_stock_owner, company, "
             "restock_email, has_barcodes, grab_account) VALUES\n" +
             ",\n".join(vals(str(i), esc(c), esc(nm), "'sku_barcode'", "1", "'brand'", esc(COMPANY),
                             esc(RESTOCK_EMAIL), "1", "'own'") for i, c, nm, _ in BRANDS) +
             "\nON DUPLICATE KEY UPDATE name = VALUES(name), active = 1, "
             "company = COALESCE(brands.company, VALUES(company)), "
             "restock_email = COALESCE(brands.restock_email, VALUES(restock_email)), "
             "has_barcodes = COALESCE(brands.has_barcodes, VALUES(has_barcodes)), "
             "grab_account = COALESCE(brands.grab_account, VALUES(grab_account))")
    sql.stmt(f"UPDATE brands SET active = 0 WHERE id IN (1, 2) AND {GATE}")
    sql.stmt(f"UPDATE brand_sites SET active = 0 WHERE brand_id IN (1, 2) AND site_id IN (2, 4) AND {GATE}")
    sql.stmt("INSERT INTO brand_sites (brand_id, site_id, active) VALUES\n" +
             ",\n".join(vals(str(b), str(s), "1") for b, *_ in BRANDS for s in (2, 4, 99)) +
             "\nON DUPLICATE KEY UPDATE active = 1")

    sql.note("3. People. Accounts that exist already (the owner, admins, testers) are not touched.")
    sql.stmt("INSERT INTO users (email, name, role, default_site_id, locale, active, hiryu_login, "
             "first_login_at) VALUES\n" +
             ",\n".join(vals(esc(em(k)), esc(nm), esc(r), str(ds), "'id'", "1", str(hl),
                             utc(datetime(2026, 9, 25, 9, 0)) if hl else "NULL")
                        for k, nm, r, ds, _s, hl in PEOPLE) +
             "\nON DUPLICATE KEY UPDATE users.id = users.id")
    for k, _n, _r, _ds, sites, _hl in PEOPLE:
        for s in sites:
            sql.stmt(f"INSERT IGNORE INTO user_sites (user_id, site_id) "
                     f"SELECT id, {s} FROM users WHERE email = {esc(em(k))}")

    sql.note("4. SKUs: Kahf 68 and Labore 37 from the 25 Sep recheck lists. The Hiryu SKU code is the\n"
             "brand SKU code. A re-run fills empty fields only, so edits made in the app stay.")
    rows = []
    for s in skus:
        rows.append(f"  ({s['id']}, {s['brand_id']}, {esc(s['code'])}, {esc(s['name'])}, "
                    f"{esc(s['category'])}, {esc(s['line'])}, {esc(s['size'])}, {esc(s['price'])}, "
                    f"{esc(s['cube'])}, 'stable', 'sku_barcode', {esc(s['code'])}, {esc(s['bin'])}, "
                    f"{s['fill']}, {s['reorder']}, 25, 1, {esc(s['weight'])}, "
                    f"{1 if s['ml'] else 0}, {s['large']}, 1)")
    keep = ("name_display", "hiryu_sku_code", "bin_size", "default_full_threshold",
            "default_restock_point", "default_restock_pct", "grab_buffer", "pack_weight_g",
            "is_liquid", "is_large_bottle")
    sql.values("INSERT INTO skus (id, brand_id, brand_sku_code, name_display, category, product_line, "
               "unit_size, price_idr, unit_cube_cm3, expiry_tier, identity_mode, hiryu_sku_code, bin_size, "
               "default_full_threshold, default_restock_point, default_restock_pct, grab_buffer, "
               "pack_weight_g, is_liquid, is_large_bottle, active) VALUES", rows,
               "ON DUPLICATE KEY UPDATE " +
               ", ".join(f"{c} = COALESCE(skus.{c}, VALUES({c}))" for c in keep) +
               ", unit_size = VALUES(unit_size)", n=200)
    sql.stmt("INSERT IGNORE INTO barcodes (barcode, sku_id, source, registered_by) VALUES\n" +
             ",\n".join(f"  ({esc(s['barcode'])}, {s['id']}, '{s['bc_source']}', '{OLD_SEED}')"
                        for s in skus))

    sql.note("5. Hiryu stores 902 to 905 and their menus, one single per SKU. The first seed's test\n"
             "store 901 and its items (IDITE2026092...) were the seed's own and are removed.")
    sql.stmt("DELETE FROM hiryu_item_prices WHERE hiryu_item_id LIKE 'IDITE2026092%'")
    sql.stmt("DELETE FROM hiryu_items WHERE hiryu_item_id LIKE 'IDITE2026092%'")
    sql.stmt("DELETE FROM hiryu_stores WHERE hiryu_store_no = 901 AND partner_store_id = 'TEST-901'")
    store_rows = []
    for h in HUBS:
        for b, (no, name) in h["stores"].items():
            store_rows.append(vals(str(no), esc(name), esc(f"GRAB-{h['short']}-{b}"), str(h["site"]),
                                   str(b), "1", esc(HQ), str(h["dark"]), "1", "'own'", "'MANUAL'",
                                   utc(datetime(2026, 9, 24, 14, 5)), esc(HQ),
                                   utc(datetime(2026, 9, 24, 15, 40)), "1", "1",
                                   utc(datetime(2026, 9, 26, 16, 0))))
    sql.stmt("INSERT INTO hiryu_stores (hiryu_store_no, store_name, partner_store_id, site_id, brand_id, "
             "active, updated_by, hiryu_dark_store_id, hiryu_active, grab_account, order_acceptance, "
             "hiryu_received_at, brand_set_by, brand_set_at, grab_active, link_on, link_on_at) VALUES\n" +
             ",\n".join(store_rows) +
             "\nON DUPLICATE KEY UPDATE store_name = VALUES(store_name), "
             "partner_store_id = VALUES(partner_store_id), site_id = VALUES(site_id), "
             "brand_id = VALUES(brand_id), active = 1, hiryu_dark_store_id = VALUES(hiryu_dark_store_id), "
             "hiryu_active = 1, grab_account = VALUES(grab_account), "
             "order_acceptance = VALUES(order_acceptance), grab_active = 1, link_on = 1, "
             "hiryu_received_at = COALESCE(hiryu_stores.hiryu_received_at, VALUES(hiryu_received_at)), "
             "brand_set_by = COALESCE(hiryu_stores.brand_set_by, VALUES(brand_set_by)), "
             "brand_set_at = COALESCE(hiryu_stores.brand_set_at, VALUES(brand_set_at)), "
             "link_on_at = COALESCE(hiryu_stores.link_on_at, VALUES(link_on_at))")
    seen = {(o["store"], l["sku"]["id"]) for o in orders for l in o["lines"]}
    item_rows, price_rows = [], []
    for h in HUBS:
        for b, (no, _name) in h["stores"].items():
            for s in skus:
                if s["brand_id"] != b:
                    continue
                iid = item_id(no, s)
                item_rows.append(vals(str(no), esc(iid), str(b), esc(s["item_name"]), esc(s["barcode"]),
                                      "'AVAILABLE'", str(s["id"]), "1", str(s["menu"]), "1",
                                      "1" if (no, s["id"]) in seen else "0", esc(s["code"]),
                                      utc(datetime(2026, 9, 24, 14, 5)), esc(HQ),
                                      utc(datetime(2026, 9, 24, 16, 0))))
                price_rows.append(vals(str(no), esc(iid), str(s["menu"]), "'2026-09-01'"))
    sql.values("INSERT INTO hiryu_items (hiryu_store_no, hiryu_item_id, brand_id, item_name, barcode, "
               "available_status, sku_id, units_per_sale, price_idr, active, seen_in_order, sku_code, "
               "imported_at, mapped_by, mapped_at) VALUES", item_rows,
               "ON DUPLICATE KEY UPDATE item_name = VALUES(item_name), sku_id = VALUES(sku_id), "
               "units_per_sale = 1, price_idr = VALUES(price_idr), sku_code = VALUES(sku_code), "
               "seen_in_order = GREATEST(hiryu_items.seen_in_order, VALUES(seen_in_order))", n=110)
    sql.values("INSERT IGNORE INTO hiryu_item_prices (hiryu_store_no, hiryu_item_id, price_idr, "
               "effective_date) VALUES", price_rows, n=110)


def emit_layout(sql, plans, seed_owners):
    sql.note("6. Racks A to D per hub (V30): 5 levels, 2 kolom of 3 bins, level 1 Besar and levels\n"
             "2 to 5 Kecil, labels printed and checked. Ids continue the first seed's (rack 100 + n\n"
             "at KJ5, 110 + n at MA5). Its slots and stock are reset once (gated) and its rack E\n"
             "goes; every bin is then filled again through the ledger below.")
    sql.stmt(f"DELETE FROM slot_assignments WHERE site_id IN (2, 4) AND created_by IN {seed_owners} AND {GATE}")
    sql.stmt(f"DELETE FROM inventory_balances WHERE site_id IN (2, 4) AND sku_id BETWEEN 1001 AND 1199 AND {GATE}")
    e_racks = [104, 114]
    e_levels = [r * 10 + lv for r in e_racks for lv in range(1, 6)]
    e_locs = [lv * 10 + p for lv in e_levels for p in range(1, 6)]
    sql.stmt("DELETE bk FROM baskets bk LEFT JOIN slot_assignments sa ON sa.basket_id = bk.id\n"
             f" WHERE bk.id IN ({', '.join(map(str, e_locs))}) AND sa.id IS NULL")
    sql.stmt("DELETE l FROM locations l LEFT JOIN baskets bk ON bk.location_id = l.id\n"
             "  LEFT JOIN inventory_balances ib ON ib.location_id = l.id\n"
             f" WHERE l.id IN ({', '.join(map(str, e_locs))}) AND bk.id IS NULL AND ib.id IS NULL")
    sql.stmt("DELETE lv FROM levels lv LEFT JOIN locations l ON l.level_id = lv.id\n"
             f" WHERE lv.id IN ({', '.join(map(str, e_levels))}) AND l.id IS NULL")
    sql.stmt("DELETE r FROM racks r LEFT JOIN levels lv ON lv.rack_id = r.id\n"
             f" WHERE r.id IN ({', '.join(map(str, e_racks))}) AND lv.id IS NULL")

    rack_rows, level_rows, loc_rows, basket_rows = [], [], [], []
    for h in HUBS:
        for ri, rc in enumerate(RACKS):
            rid = h["rack_base"] + ri
            rack_rows.append(vals(str(rid), str(h["site"]), esc(rc), str(LEVELS), "1.00", str(ri + 1),
                                  "2", utc(PRINTED), esc(h["spv"]), utc(datetime(2026, 9, 25, 9, 0))))
            for lv in range(1, LEVELS + 1):
                level_rows.append(vals(str(rid * 10 + lv), str(rid), str(lv), "0", "1"))
        for b in plans[h["short"]]["bins"]:
            checked = PRINTED + timedelta(minutes=30 + b["pos"] + b["lv"] * 6)
            loc_rows.append(vals(str(b["id"]), str(b["level_id"]), str(h["site"]), str(b["pos"]), "1",
                                 esc(b["code"]), str(b["kolom"]), "'ok'", esc(b["code"]), utc(checked),
                                 esc(h["counters"][0])))
            basket_rows.append(vals(str(b["id"]), str(b["id"]), str(h["site"]), esc(b["size"]), utc(PRINTED)))
    sql.stmt("INSERT IGNORE INTO racks (id, site_id, code, level_count, level_width_m, sort_order, "
             "kolom_count, labels_printed_at, created_by, created_at) VALUES\n" + ",\n".join(rack_rows))
    sql.stmt("INSERT IGNORE INTO levels (id, rack_id, level_no, is_open_shelf, bin_rows) VALUES\n" +
             ",\n".join(level_rows))
    sql.values("INSERT IGNORE INTO locations (id, level_id, site_id, position_no, bin_row, code, kolom_no, "
               "label_check_state, label_check_scanned, label_checked_at, label_checked_by) VALUES",
               loc_rows, n=120)
    sql.values("INSERT IGNORE INTO baskets (id, location_id, site_id, basket_size, label_printed_at) VALUES",
               basket_rows, n=120)
    sql.note("Bins the first seed made (positions 1 to 5) take the new shape, once.")
    for h in HUBS:
        ids = [h["rack_base"] + i for i in range(len(RACKS))]
        sql.stmt(f"UPDATE racks SET level_count = {LEVELS}, kolom_count = 2, "
                 f"labels_printed_at = COALESCE(labels_printed_at, {utc(PRINTED)}), "
                 f"created_by = COALESCE(created_by, {esc(h['spv'])}), "
                 f"created_at = COALESCE(created_at, {utc(datetime(2026, 9, 25, 9, 0))})\n"
                 f" WHERE id IN ({', '.join(map(str, ids))}) AND {GATE}")
        old = [b for b in plans[h["short"]]["bins"] if b["pos"] <= 5]
        if h["short"] == "KJ5":
            sql.stmt("UPDATE locations SET code = CONCAT('KJ5-', SUBSTRING(code, 5))\n"
                     " WHERE site_id = 2 AND code LIKE 'KJR-%' AND id IN "
                     f"({', '.join(str(b['id']) for b in old)}) AND {GATE}")
        for k in (1, 2):
            part = [b for b in old if b["kolom"] == k]
            sql.stmt(f"UPDATE locations SET kolom_no = {k}, label_check_state = 'ok', "
                     f"label_check_scanned = code, label_checked_at = {utc(PRINTED + timedelta(hours=1))}, "
                     f"label_checked_by = {esc(h['counters'][0])}\n"
                     f" WHERE id IN ({', '.join(str(b['id']) for b in part)}) AND {GATE}")
        for size in ("BESAR", "KECIL"):
            part = [b for b in old if b["size"] == size]
            sql.stmt(f"UPDATE baskets SET basket_size = '{size}', "
                     f"label_printed_at = COALESCE(label_printed_at, {utc(PRINTED)})\n"
                     f" WHERE id IN ({', '.join(str(b['id']) for b in part)}) AND {GATE}")

    sql.note("7. Special bins (V30): <HUB>-IN-01..06, <HUB>-QR-01, <HUB>-OUT-01..06, each with its own\n"
             "locations row (level 0, position = the bin's id), as routers/locations.py makes them.")
    sb_rows = []
    for h in HUBS:
        for kind, n in (("IN", 6), ("QR", 1), ("OUT", 6)):
            for seq in range(1, n + 1):
                sb_rows.append(vals(str(h["site"]), esc(kind), str(seq), esc(f"{h['short']}-{kind}-{seq:02d}"),
                                    "1", utc(PRINTED), esc(HQ), utc(datetime(2026, 9, 24, 15, 30))))
    sql.stmt("INSERT IGNORE INTO special_bins (site_id, kind, seq, code, active, label_printed_at, "
             "created_by, created_at) VALUES\n" + ",\n".join(sb_rows))
    sql.stmt("INSERT INTO locations (level_id, site_id, position_no, bin_row, code)\n"
             "SELECT 0, sb.site_id, sb.id, 1, sb.code FROM special_bins sb\n"
             "  LEFT JOIN locations l ON l.code = sb.code\n"
             " WHERE sb.site_id IN (2, 4) AND l.id IS NULL")
    sql.stmt("UPDATE special_bins sb JOIN locations l ON l.code = sb.code SET sb.location_id = l.id\n"
             " WHERE sb.site_id IN (2, 4) AND sb.location_id IS NULL")
    sql.stmt("UPDATE sites s SET\n"
             "  inbound_bins = (SELECT COUNT(*) FROM special_bins b WHERE b.site_id = s.id AND b.kind = 'IN' AND b.active = 1),\n"
             "  quarantine_trays = (SELECT COUNT(*) FROM special_bins b WHERE b.site_id = s.id AND b.kind = 'QR' AND b.active = 1),\n"
             "  outbound_baskets = (SELECT COUNT(*) FROM special_bins b WHERE b.site_id = s.id AND b.kind = 'OUT' AND b.active = 1)\n"
             " WHERE s.id IN (2, 4)")

    sql.note("8. Every SKU in its bin; Mild Cleanser 100 ml also in its second bin C-1-02 (overflow).")
    slot_rows = []
    for h in HUBS:
        for s, b, role in plans[h["short"]]["slots"]:
            prim = role == "primary"
            slot_rows.append(vals(str(h["site"]), str(s["id"]), str(b["id"]), esc(h["spv"]), "0", esc(role),
                                  str(s["fill"]) if prim else "NULL", str(s["reorder"]) if prim else "NULL",
                                  utc(datetime(2026, 9, 25, 11, 0))))
    sql.values("INSERT IGNORE INTO slot_assignments (site_id, sku_id, basket_id, created_by, "
               "created_during_inbound, slot_role, full_threshold, restock_point, created_at) VALUES",
               slot_rows, n=110)


# --------------------------------------------------------------------- SQL: the week

def emit_orders(sql, orders, personas):
    sql.note("9. The week's orders (Mon 28 Sep to Sun 4 Oct 2026) and one UJI order per hub (26 Sep).\n"
             "Orders are keyed by their SEED- reference; their lines, pick tasks, packs, shortfalls\n"
             "and the seed's own ledger rows (scan_source 'seed') are rewritten on every run.")
    seed_orders = "o.external_ref LIKE 'SEED-%'"
    sql.stmt(f"DELETE FROM bin_count_flags WHERE site_id IN (2, 4) AND raised_by IN {personas}")
    sql.stmt("DELETE ps FROM pick_shortfalls ps JOIN order_lines ol ON ol.id = ps.order_line_id\n"
             f"  JOIN orders o ON o.id = ol.order_id WHERE {seed_orders}")
    sql.stmt(f"DELETE rt FROM return_tasks rt JOIN orders o ON o.id = rt.order_id WHERE {seed_orders}")
    sql.stmt("DELETE pl FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id\n"
             f"  JOIN orders o ON o.id = pt.order_id WHERE {seed_orders}")
    sql.stmt(f"DELETE pt FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id WHERE {seed_orders}")
    sql.stmt(f"DELETE ol FROM order_lines ol JOIN orders o ON o.id = ol.order_id WHERE {seed_orders}")
    sql.stmt(f"DELETE op FROM order_packs op JOIN orders o ON o.id = op.order_id WHERE {seed_orders}")
    sql.stmt("DELETE FROM stock_movements WHERE site_id IN (2, 4) AND scan_source = 'seed'")

    cols = ("external_ref, site_id, brand_id, status, is_test, created_at, channel, delivery_mode, "
            "placed_at, promised_at, hiryu_short_no, hiryu_store_no, source, acceptance, marked_ready_by, "
            "marked_ready_at, handed_over_by, handed_over_at, cancelled_by, cancelled_at, cancel_reason_code, "
            "cancel_reason, estimated_ready_at, hiryu_cancelled_by, is_demo, test_created_by")
    upd = [c.strip() for c in cols.split(",") if c.strip() not in ("external_ref",)]
    rows = []
    for o in orders:
        h = next(x for x in HUBS if x["short"] == o["hub"])
        uji = o["kind"] == "uji"
        status = {"normal": "handed_over", "uji": "handed_over"}.get(o["kind"], "cancelled")
        c_by = c_at = code = reason = h_by = None
        if o["kind"] == "missing":
            c_by, c_at, code, h_by = o["picker"], o["cancelled"], "2001", "merchant"
            reason = "Barang tidak ada, pelanggan memilih batal"
        elif o["kind"] == "customer":
            c_by, c_at, code, h_by, reason = "hiryu", o["cancelled"], "2004", "customer", "Customer requested"
        done = status == "handed_over"
        rows.append(vals(esc(o["ref"]), str(h["site"]), str(o["brand"]), esc(status), "1" if uji else "0",
                         utc(o["placed"]), "'grab'", "'grab_rider'", utc(o["placed"]),
                         utc(o["placed"] + timedelta(minutes=10)), esc(o["gm"]), str(o["store"]),
                         "'uji'" if uji else "'link'", "NULL" if uji else "'MANUAL'",
                         esc(o["packer"]) if done else "NULL", utc(o.get("packed")) if done else "NULL",
                         esc(o["packer"]) if done else "NULL", utc(o.get("handed")) if done else "NULL",
                         esc(c_by), utc(c_at), esc(code), esc(reason),
                         "NULL" if uji else utc(o["placed"] + timedelta(minutes=15)), esc(h_by), "0",
                         esc(h["spv"]) if uji else "NULL"))
    sql.values(f"INSERT INTO orders ({cols}) VALUES", rows,
               "ON DUPLICATE KEY UPDATE " + ", ".join(f"{c} = VALUES({c})" for c in upd), n=50)

    task_rows, line_rows, pick_rows, pack_rows = [], [], [], []
    short_rows, flag_rows, return_rows = [], [], []
    for o in orders:
        h = next(x for x in HUBS if x["short"] == o["hub"])
        ref = o["ref"]
        kind = o["kind"]
        done = kind in ("normal", "uji")
        t_status = "completed" if done else "cancelled"
        started = o.get("started")
        released = o.get("packed") if done else o.get("returned") or o.get("cancelled")
        back = kind == "missing" and any(l.get("picked") for l in o["lines"])
        task_rows.append(vals(order_id(ref), str(h["site"]), esc(t_status), esc(o["picker"]),
                              utc(o["claimed"]), utc(o.get("completed")), utc(o["placed"]), utc(started),
                              utc(o.get("completed")), esc(o["basket"]) if started else "NULL",
                              utc(started), utc(released) if started else "NULL",
                              esc(o["picker"]) if back else "NULL"))
        for l in o["lines"]:
            s = l["sku"]
            is_short = o.get("short") is l
            picked = l["qty"] if done else l.get("picked", 0)
            if picked:
                l_status, p_status = "picked", "picked"
            elif is_short:
                l_status, p_status = "short", "short"
            else:
                l_status, p_status = "allocated", "pending"
            oos = l.get("oos")
            effective = "remove" if oos == "remove" else "cancel_order"
            acted = is_short
            line_rows.append(vals(order_id(ref), str(s["id"]), str(l["qty"]), str(l["qty"]), str(picked),
                                  esc(l_status), "NULL" if kind == "uji" else esc(item_id(o["store"], s)),
                                  str(l["qty"]), str(s["menu"]), esc(s["code"]),
                                  "NULL" if kind == "uji" else esc(oos),
                                  "NULL" if kind == "uji" else esc(effective),
                                  "'cancel_order'" if acted else "NULL", str(l["qty"]) if acted else "NULL",
                                  "0" if acted else "NULL", utc(o["cancelled"]) if acted else "NULL"))
            pick_rows.append(vals(
                f"(SELECT pt.id FROM pick_tasks pt JOIN orders o ON o.id = pt.order_id "
                f"WHERE o.external_ref = {esc(ref)})", line_id(ref, s["id"]), str(s["id"]),
                str(l["bin"]["id"]), str(l["seq"]), str(l["qty"]), str(picked), esc(p_status), str(l["qty"])))
            if is_short:
                pl = (f"(SELECT pl.id FROM pick_lines pl JOIN order_lines ol ON ol.id = pl.order_line_id "
                      f"JOIN orders o ON o.id = ol.order_id WHERE o.external_ref = {esc(ref)} "
                      f"AND pl.sku_id = {s['id']})")
                short_rows.append(vals(pl, str(h["site"]), str(s["id"]), str(l["qty"]), "0", esc(o["picker"]),
                                       "'reviewed'", esc(h["spv"]), utc(o["cancelled"] + timedelta(minutes=20)),
                                       utc(o["cancelled"]), line_id(ref, s["id"]), "'cancel_order'",
                                       "'cancel_order'"))
                flag_rows.append((h, l, o, pl))
            if kind == "uji" or (kind == "missing" and l.get("picked")):
                return_rows.append(vals(str(h["site"]), str(s["id"]), order_id(ref), esc(o["gm"]),
                                        str(l["bin"]["id"]), str(l["qty"]), str(l["qty"]),
                                        "'uji'" if kind == "uji" else "'cancelled'", "'done'", "0",
                                        utc(o["handed"] if kind == "uji" else o["cancelled"]),
                                        utc(o["returned"]), esc(o["picker"])))
        if done:
            units = sum(l["qty"] for l in o["lines"])
            pack = o.get("pack", "bag")
            why = ("Muat di kantong kertas (perkiraan)" if pack == "bag"
                   else "Lebih dari batas kantong kertas (perkiraan)")
            pack_rows.append(vals(order_id(ref), str(h["site"]), esc(pack), esc(why), "1",
                                  str(o.get("large", 0)), esc(pack), utc(o["pack_started"]), esc(o["packer"]),
                                  utc(o["packed"]), esc(o["packer"]), "1", utc(o["completed"])))
            assert units > 0
    sql.values("INSERT INTO pick_tasks (order_id, site_id, status, claimed_by, claimed_at, completed_at, "
               "created_at, started_at, handed_to_pack_at, basket_code, basket_scanned_at, "
               "basket_released_at, return_by) VALUES", task_rows, n=50)
    sql.values("INSERT INTO order_lines (order_id, sku_id, qty_ordered, qty_allocated, qty_picked, status, "
               "hiryu_item_id, item_qty, item_price_idr, hiryu_sku_code, oos_type, oos_effective, oos_action, "
               "oos_units_wanted, oos_units_found, oos_acted_at) VALUES", line_rows, n=60)
    sql.values("INSERT INTO pick_lines (pick_task_id, order_line_id, sku_id, location_id, sequence_no, "
               "qty_required, qty_picked, status, qty_allocated) VALUES", pick_rows, n=60)
    sql.values("INSERT INTO order_packs (order_id, site_id, suggested, suggested_reason, estimated, "
               "large_bottles, chosen, pack_started_at, pack_started_by, packed_at, packed_by, "
               "consumables_booked, created_at) VALUES", pack_rows, n=50)
    sql.stmt("INSERT INTO pick_shortfalls (pick_line_id, site_id, sku_id, qty_required, qty_found, "
             "declared_by, status, reviewed_by, reviewed_at, created_at, order_line_id, action, instruction) "
             "VALUES\n" + ",\n".join(short_rows))
    sql.stmt("INSERT INTO return_tasks (site_id, sku_id, order_id, external_ref, location_id, qty, "
             "qty_returned, reason, status, is_training, created_at, done_at, done_by) VALUES\n" +
             ",\n".join(return_rows))
    return flag_rows


def emit_week(sql, sims, orders, delivery, counts, flags, quarantine, skus, flag_rows, personas):
    sql.note("Bins zeroed by a missing item, counted the next morning.")
    fl = []
    by_order = {id(f["order"]): f for f in flags}
    for h, l, o, pl in flag_rows:
        f = by_order[id(o)]
        fl.append(vals(str(h["site"]), str(l["bin"]["id"]), str(l["sku"]["id"]), "'short_pick'", "'pick_line'",
                       pl, str(f["before"]), "0", esc(o["picker"]), "'counted'", esc(f["closed_by"]),
                       utc(f["closed"]), utc(f["at"])))
    sql.stmt("INSERT INTO bin_count_flags (site_id, location_id, sku_id, reason, ref_type, ref_id, qty_before, "
             "qty_found, raised_by, status, closed_by, closed_at, created_at) VALUES\n" + ",\n".join(fl))

    # ------------------------------------------------------------ restock requests
    sql.note("10. Restock to the brand. RPL-MA5-2609-001 (Kahf) was received and put away on\n"
             "Wed 30 Sep; RPL-MA5-2609-002 (Labore, 6 SKUs, 124 pcs) is sent and confirmed with the\n"
             "brand's PO number and waits for its delivery (the demo receives it). A reference a\n"
             "tester already used is left alone: everything below is tied to rows Andi created.")
    ma5 = sims["MA5"]
    by_code = {s["code"]: s for s in skus}
    hdr = ("reference, site_id, brand_id, status, created_by, created_at, auto_created, po_saved_by, "
           "po_saved_at, sent_by, sent_at, confirmed_by, confirmed_at, brand_po_number, eta_date, po_date, "
           "po_to, po_brand_contact, po_deliver_to, po_receiving_hours, po_requested_date, "
           "po_created_by_name, received_at, brand_note")
    deliver_to = "Ninja Xpress MA5 Cawang, Jl. Raya Kalibata No. 4, Kramat Jati, Jakarta Timur"
    kahf_rows = vals("'RPL-MA5-2609-001'", "4", "10", "'received'", esc(HQ), utc(datetime(2026, 9, 28, 9, 5)),
                     "1", esc(HQ), utc(datetime(2026, 9, 28, 9, 20)), esc(HQ), utc(datetime(2026, 9, 28, 9, 30)),
                     esc(HQ), utc(datetime(2026, 9, 29, 11, 10)), "'PO/KHF/2609/0187'", "'2026-09-30'",
                     "'2026-09-28'", esc(COMPANY), esc(RESTOCK_EMAIL), esc(deliver_to), "'09:00 to 16:00 WIB'",
                     "'2026-09-30'", "'Andi Pratama'", utc(datetime(2026, 9, 30, 10, 40)),
                     "'Kirim Rabu pagi, 4 karton.'")
    lab_rows = vals("'RPL-MA5-2609-002'", "4", "11", "'confirmed'", esc(HQ), utc(datetime(2026, 9, 28, 9, 10)),
                    "1", esc(HQ), utc(datetime(2026, 9, 28, 9, 35)), esc(HQ), utc(datetime(2026, 9, 28, 9, 45)),
                    esc(HQ), utc(datetime(2026, 9, 29, 14, 20)), "'PO/LBR/2609/0412'", "'2026-10-08'",
                    "'2026-09-28'", esc(COMPANY), esc(RESTOCK_EMAIL), esc(deliver_to), "'09:00 to 16:00 WIB'",
                    "'2026-10-01'", "'Andi Pratama'", "NULL",
                    "'Stok gudang Paragon baru masuk, kirim minggu depan.'")
    sql.stmt(f"INSERT IGNORE INTO replenishments ({hdr}) VALUES\n{kahf_rows},\n{lab_rows}")
    mine = lambda ref: f"r.reference = '{ref}' AND r.created_by = {esc(HQ)}"  # noqa: E731
    for l in delivery["lines"]:
        s = l["sku"]
        sql.stmt("INSERT IGNORE INTO replenishment_lines (replenishment_id, sku_id, qty_requested, qty_confirmed, "
                 "qty_received, qty_billed, stock_at_po, fill_to_at_po)\n"
                 f"SELECT r.id, {s['id']}, {l['qty']}, {l['qty']}, {l['qty']}, {l['qty']}, {l['stock_before']}, "
                 f"{s['fill']} FROM replenishments r WHERE {mine('RPL-MA5-2609-001')}")
    for code, q in LABORE_REQUEST:
        s = by_code[code]
        stock = sum(qty for b, sk, qty, _w, _a in ma5.openings if sk["id"] == s["id"])
        sql.stmt("INSERT IGNORE INTO replenishment_lines (replenishment_id, sku_id, qty_requested, qty_confirmed, "
                 "stock_at_po, fill_to_at_po)\n"
                 f"SELECT r.id, {s['id']}, {q}, {q}, {stock}, {s['fill']} FROM replenishments r "
                 f"WHERE {mine('RPL-MA5-2609-002')}")

    sql.note("The Kahf delivery: receipt, the units counted into temporary bins MA5-IN-01..06 in two\n"
             "batches, and the putaway scanned to each rack bin.")
    eko, rina, ayu = em("eko.prasetyo"), em("rina.saputri"), em("ayu.lestari")
    opened, finished = datetime(2026, 9, 30, 10, 5), datetime(2026, 9, 30, 10, 40)
    sql.stmt("INSERT INTO inbound_receipts (site_id, brand_id, source_type, status, opened_by, opened_at, "
             "completed_at, external_reference, replenishment_id, batch_no, final_batch, sj_cartons, "
             "counted_cartons, sj_signed_by, finished_by)\n"
             f"SELECT 4, 10, 'from_brand', 'completed', {esc(eko)}, {utc(opened)}, {utc(finished)}, r.reference, "
             f"r.id, 2, 1, 4, 4, {esc(rina)}, {esc(eko)} FROM replenishments r\n"
             f" WHERE {mine('RPL-MA5-2609-001')}\n"
             "   AND NOT EXISTS (SELECT 1 FROM inbound_receipts x WHERE x.replenishment_id = r.id)")
    rc = (f"FROM inbound_receipts ir JOIN replenishments r ON r.id = ir.replenishment_id "
          f"WHERE {mine('RPL-MA5-2609-001')} AND ir.opened_by = {esc(eko)}")
    sql.stmt(f"UPDATE replenishments r JOIN inbound_receipts ir ON ir.replenishment_id = r.id "
             f"AND ir.opened_by = {esc(eko)}\n   SET r.receipt_id = ir.id WHERE {mine('RPL-MA5-2609-001')}")
    sql.stmt(f"DELETE p FROM inbound_putaways p JOIN inbound_receipts ir ON ir.id = p.receipt_id\n"
             f"  JOIN replenishments r ON r.id = ir.replenishment_id WHERE {mine('RPL-MA5-2609-001')}")
    sql.stmt(f"DELETE bl FROM inbound_bin_loads bl JOIN inbound_receipts ir ON ir.id = bl.receipt_id\n"
             f"  JOIN replenishments r ON r.id = ir.replenishment_id WHERE {mine('RPL-MA5-2609-001')}")
    for k, l in enumerate(delivery["lines"]):
        s, b = l["sku"], l["bin"]
        counted = opened + timedelta(minutes=3 + 3 * k)
        batched = opened + timedelta(minutes=20 if l["batch"] == 1 else 33)
        sql.stmt("INSERT IGNORE INTO receipt_lines (receipt_id, sku_id, qty_expected, qty_received, location_id, "
                 "qty_damaged, qty_manual)\n"
                 f"SELECT ir.id, {s['id']}, {l['qty']}, {l['qty']}, {b['id']}, 0, 0 {rc}")
        sql.stmt("INSERT INTO inbound_bin_loads (site_id, receipt_id, sku_id, bin_code, is_extra, status, qty, "
                 "qty_put, qty_hold, batch_no, label_scanned_at, label_scanned_by, opened_by, created_at, "
                 "batched_at, done_at, done_by)\n"
                 f"SELECT 4, ir.id, {s['id']}, {esc(l['load_bin'])}, 0, 'done', {l['qty']}, {l['qty']}, 0, "
                 f"{l['batch']}, {utc(counted)}, {esc(eko)}, {esc(eko)}, {utc(counted)}, {utc(batched)}, "
                 f"{utc(l['at'])}, {esc(ayu)} {rc}")
        sql.stmt("INSERT INTO inbound_putaways (load_id, receipt_id, site_id, sku_id, location_id, location_code, "
                 "qty, day_color_key, actor_email, created_at)\n"
                 f"SELECT bl.id, bl.receipt_id, 4, {s['id']}, {b['id']}, {esc(b['code'])}, {l['qty']}, "
                 f"{esc(day_key(l['at']))}, {esc(ayu)}, {utc(l['at'])}\n"
                 "  FROM inbound_bin_loads bl JOIN inbound_receipts ir ON ir.id = bl.receipt_id\n"
                 "  JOIN replenishments r ON r.id = ir.replenishment_id\n"
                 f" WHERE {mine('RPL-MA5-2609-001')} AND ir.opened_by = {esc(eko)} AND bl.sku_id = {s['id']}")

    # ------------------------------------------------------------ quarantine
    sql.note("11. Quarantine: a leaking bottle at MA5 waiting for Rina's decision, and a damaged tube at\n"
             "KJ5 that Sari wants written off (waiting for Ops HQ). Keyed by source_ref 'seed' 1 and 2.")
    q_rows = []
    for n, q in enumerate(quarantine, 1):
        h = next(x for x in HUBS if x["short"] == q["hub"])
        s, b = q["sku"], q["bin"]
        if q["hub"] == "MA5":
            reason, note, status, by = "bocor", "Tutup botol retak, isi merembes", "open", em("ayu.lestari")
            dec_by = dec_at = dec_note = None
        else:
            reason, note, status, by = "rusak", "Tube penyok, segel rusak", "write_off_pending", em("fajar.ramadhan")
            dec_by, dec_at, dec_note = h["spv"], q["at"] + timedelta(minutes=25), "Tidak layak jual. Hapus."
        q_rows.append(vals(str(h["site"]), str(s["id"]), "1", "'hub'", esc(reason), esc(note), str(b["id"]),
                           esc(f"{h['short']}-QR-01"), "'ninja'", "'Rusak di hub'", "1", esc(status),
                           esc(dec_by), utc(dec_at), esc(dec_note), "'seed'", str(n), esc(by), utc(q["at"]), "0"))
    sql.stmt("INSERT IGNORE INTO quarantine_items (site_id, sku_id, qty, origin, reason, reason_note, location_id, "
             "tray_code, cost_bearer, bearer_note, in_ledger, status, decided_by, decided_at, decision_note, "
             "source_ref_type, source_ref_id, reported_by, reported_at, is_training) VALUES\n" + ",\n".join(q_rows))

    # ------------------------------------------------------------ counts
    sql.note("12. Counts: Ops HQ's cycles (Labore every 2 weeks, Kahf every 4 weeks from 28 Sep), the\n"
             "week's closed count tasks with one difference at MA5 (approved by Rina, reviewed by\n"
             "Andi), and the missing-item bins counted the next morning.")
    for brand, p in CYCLE_DAYS.items():
        sql.stmt("INSERT INTO count_cycles (scope, brand_id, every_n, every_unit, start_date, active, "
                 "created_by, created_at)\n"
                 f"SELECT 'brand', {brand}, {p // 7}, 'week', '{CYCLE_START}', 1, {esc(HQ)}, "
                 f"{utc(datetime(2026, 9, 26, 15, 0))} FROM DUAL\n"
                 f" WHERE NOT EXISTS (SELECT 1 FROM count_cycles WHERE scope = 'brand' AND brand_id = {brand})")
    t_rows, a_rows = [], []
    for c in counts:
        h = next(x for x in HUBS if x["short"] == c["hub"])
        b, s = c["bin"], c["sku"]
        if c["reason"] == "cycle":
            cyc = (f"(SELECT MIN(id) FROM count_cycles WHERE scope = 'brand' AND brand_id = {c['brand']} "
                   "AND active = 1)")
            note, rtype, rid = f"setiap {CYCLE_DAYS[c['brand']] // 7} minggu", "'count_cycle'", cyc
        else:
            note, rtype, rid = "Barang tidak ada saat diambil", "'bin_count_flag'", "NULL"
        diff = c["counted"] - c["expected"]
        if diff:
            t_rows.append(vals(str(h["site"]), esc(c["day"]), "0", str(b["id"]), str(s["id"]), esc(c["reason"]),
                               esc(note), rtype, rid, esc(c["recounter"]), "'closed'", "'approved'",
                               str(c["expected"]), str(c["counted"]), str(diff), "0", esc(h["spv"]),
                               utc(c["approved"]), "'reviewed'", esc(HQ), utc(c["reviewed"]),
                               "'Selisih 1 unit, dicek bersama SPV. Diterima.'",
                               utc(wib(c["day"], 6, 0)), utc(c["approved"])))
        else:
            t_rows.append(vals(str(h["site"]), esc(c["day"]), "0", str(b["id"]), str(s["id"]), esc(c["reason"]),
                               esc(note), rtype, rid, esc(c["counter"]), "'closed'", "'auto_closed'",
                               str(c["expected"]), str(c["counted"]), "0", "1", "NULL", "NULL", "'not_needed'",
                               "NULL", "NULL", "NULL", utc(wib(c["day"], 6, 0)), utc(c["end"])))
        task = (f"(SELECT id FROM count_tasks WHERE site_id = {h['site']} AND plan_date = {esc(c['day'])} "
                f"AND location_id = {b['id']})")
        a_rows.append(vals(task, str(h["site"]), str(b["id"]), "1", esc(c["counter"]), "'scan'",
                           str(c["counted"]), str(c["expected"]), "'finished'", utc(c["start"]), utc(c["end"])))
        if diff:
            a_rows.append(vals(task, str(h["site"]), str(b["id"]), "2", esc(c["recounter"]), "'scan'",
                               str(c["counted"]), str(c["expected"]), "'finished'",
                               utc(c["end"] + timedelta(minutes=3)), utc(c["recount_end"])))
    sql.values("INSERT IGNORE INTO count_tasks (site_id, plan_date, is_full, location_id, sku_id, reason, "
               "reason_note, reason_ref_type, reason_ref_id, assigned_to, status, outcome, qty_expected, "
               "qty_final, variance, first_match, approved_by, approved_at, hq_review, hq_reviewed_by, "
               "hq_reviewed_at, hq_note, created_at, closed_at) VALUES", t_rows, n=50)
    sql.values("INSERT IGNORE INTO count_attempts (task_id, site_id, location_id, attempt_no, counted_by, method, "
               "qty_counted, qty_expected, status, started_at, finished_at) VALUES", a_rows, n=50)

    # ------------------------------------------------------------ ledger
    sql.note("13. The ledger. Every unit the seed puts on a shelf or takes off is a stock movement\n"
             "(scan_source 'seed'), and the balances below are what these movements add up to.")
    op_rows = []
    for short, st in sims.items():
        h = st.h
        for b, s, qty, when, actor in st.openings:
            op_rows.append(vals(str(h["site"]), str(s["id"]), str(b["id"]), str(qty), "'receipt_in'", "NULL",
                                "NULL", "'opening_stock'", esc(actor), "'seed'", "0", utc(when),
                                esc(day_key(when)), "'brand'"))
    mv = ("INSERT INTO stock_movements (site_id, sku_id, location_id, qty_delta, movement_type, ref_type, "
          "ref_id, reason_code, actor_email, scan_source, is_training, created_at, day_color_key, stock_owner)")
    sql.values(mv + " VALUES", op_rows, n=110)
    sql.stmt(mv + "\nSELECT pt.site_id, pl.sku_id, pl.location_id, -pl.qty_picked, 'pick_out', 'pick_line', pl.id, "
             "NULL, pt.claimed_by, 'seed', 0,\n"
             "       DATE_ADD(pt.started_at, INTERVAL pl.sequence_no * 30 SECOND), NULL, 'brand'\n"
             "  FROM pick_lines pl JOIN pick_tasks pt ON pt.id = pl.pick_task_id\n"
             "  JOIN orders o ON o.id = pt.order_id\n"
             " WHERE o.external_ref LIKE 'SEED-%' AND pl.qty_picked > 0")
    ret_rows = []
    for o in orders:
        h = next(x for x in HUBS if x["short"] == o["hub"])
        for l in o["lines"]:
            if o["kind"] == "uji" or (o["kind"] == "missing" and l.get("picked")):
                rt = (f"(SELECT rt.id FROM return_tasks rt JOIN orders o ON o.id = rt.order_id "
                      f"WHERE o.external_ref = {esc(o['ref'])} AND rt.sku_id = {l['sku']['id']})")
                ret_rows.append(vals(str(h["site"]), str(l["sku"]["id"]), str(l["bin"]["id"]), str(l["qty"]),
                                     "'return_in'", "'return_task'", rt, "NULL", esc(o["picker"]), "'seed'", "0",
                                     utc(o["returned"]), esc(day_key(o["returned"])), "'brand'"))
    sql.stmt(mv + " VALUES\n" + ",\n".join(ret_rows))
    sql.stmt(mv + "\nSELECT f.site_id, f.sku_id, f.location_id, f.qty_found - f.qty_before, 'adjustment', "
             "'pick_line', f.ref_id, 'short_pick', f.raised_by, 'seed', 0, f.created_at, NULL, 'brand'\n"
             f"  FROM bin_count_flags f WHERE f.site_id IN (2, 4) AND f.raised_by IN {personas}\n"
             "   AND f.reason = 'short_pick' AND f.qty_before > f.qty_found")
    sql.stmt(mv + "\nSELECT p.site_id, p.sku_id, p.location_id, p.qty, 'receipt_in', 'receipt', p.receipt_id, "
             "CONCAT('putaway:', p.load_id), p.actor_email, 'seed', 0, p.created_at, p.day_color_key, 'brand'\n"
             "  FROM inbound_putaways p JOIN inbound_receipts ir ON ir.id = p.receipt_id\n"
             "  JOIN replenishments r ON r.id = ir.replenishment_id\n"
             f" WHERE {mine('RPL-MA5-2609-001')}")
    sql.stmt(mv + "\nSELECT q.site_id, q.sku_id, q.location_id, -q.qty, 'adjustment', 'quarantine_item', q.id, "
             "'quarantine', q.reported_by, 'seed', 0, q.reported_at, NULL, 'brand'\n"
             "  FROM quarantine_items q WHERE q.source_ref_type = 'seed' AND q.in_ledger = 1")
    sql.stmt(mv + "\nSELECT t.site_id, t.sku_id, t.location_id, t.variance, 'adjustment', 'count_task', t.id, "
             "'count', t.approved_by, 'seed', 0, t.approved_at, NULL, 'brand'\n"
             f"  FROM count_tasks t WHERE t.site_id IN (2, 4) AND t.approved_by IN {personas} "
             "AND t.variance <> 0")
    sql.stmt("UPDATE inbound_putaways p JOIN stock_movements m ON m.scan_source = 'seed' "
             "AND m.ref_type = 'receipt'\n"
             "   AND m.ref_id = p.receipt_id AND m.reason_code = CONCAT('putaway:', p.load_id)\n"
             "   SET p.movement_id = m.id WHERE p.site_id = 4")
    sql.stmt("UPDATE count_tasks t JOIN stock_movements m ON m.scan_source = 'seed' AND m.ref_type = 'count_task' "
             "AND m.ref_id = t.id\n   SET t.movement_id = m.id WHERE t.site_id IN (2, 4)")

    sql.note("Balances: written once (a row that exists is the floor's, not the seed's).")
    bal_rows = []
    for short, st in sims.items():
        h = st.h
        for s, b, _role in st.plan["slots"]:
            q = st.at(b)
            if q == 0 and not any(x[0]["id"] == b["id"] for x in st.openings):
                continue
            bal_rows.append(vals(str(h["site"]), str(s["id"]), str(b["id"]), str(q), "0", "1",
                                 utc(st.since.get(b["id"])) if q else "NULL", "'brand'"))
    sql.values("INSERT IGNORE INTO inventory_balances (site_id, sku_id, location_id, qty_on_hand, qty_allocated, "
               "version, stocked_since, stock_owner) VALUES", bal_rows, n=110)


def emit_consumables(sql, orders, delivery):
    sql.note("14. Consumables (V31 made the six items per hub): the weekly count on Mon 28 Sep,\n"
             "approved by Andi; what each packed order and the Kahf delivery used; a bag order at\n"
             "MA5 (need, PR, receipt approved). The stock is then the sum of the movements, once.")
    counted = {"MA5": {BAG: 150, CARTON: 20, LABEL: 400, TAPE: 60, DIVIDER: 12, STICKER: 10},
               "KJ5": {BAG: 150, CARTON: 30, LABEL: 300, TAPE: 45, DIVIDER: 10, STICKER: 8}}
    for h in HUBS:
        at, ok = datetime(2026, 9, 28, 7, 45), datetime(2026, 9, 28, 9, 0)
        key = (f"k.site_id = {h['site']} AND k.counted_by = {esc(h['spv'])} AND k.counted_at = {utc(at)}")
        sql.stmt("INSERT INTO consumable_counts (site_id, status, counted_by, counted_at, decided_by, decided_at)\n"
                 f"SELECT {h['site']}, 'approved', {esc(h['spv'])}, {utc(at)}, {esc(HQ)}, {utc(ok)} FROM DUAL\n"
                 f" WHERE NOT EXISTS (SELECT 1 FROM consumable_counts k WHERE {key})")
        case = "CASE c.name " + " ".join(f"WHEN {esc(n)} THEN {v}" for n, v in counted[h["short"]].items()) + " END"
        sql.stmt("INSERT IGNORE INTO consumable_count_lines (count_id, consumable_id, qty_counted, qty_system)\n"
                 f"SELECT k.id, c.id, {case}, 0 FROM consumable_counts k JOIN consumables c ON c.site_id = k.site_id\n"
                 f" WHERE {key} AND c.name IN {in_list(CONSUMABLES)}")
        sql.stmt("INSERT IGNORE INTO consumable_movements (consumable_id, site_id, qty_delta, kind, ref_type, ref_id, "
                 "actor_email, created_at)\n"
                 f"SELECT c.id, c.site_id, {case}, 'count', 'consumable_count', k.id, {esc(HQ)}, {utc(ok)}\n"
                 f"  FROM consumable_counts k JOIN consumables c ON c.site_id = k.site_id\n"
                 f" WHERE {key} AND c.name IN {in_list(CONSUMABLES)}")
    for o in orders:
        if o["kind"] != "normal":
            continue
        h = next(x for x in HUBS if x["short"] == o["hub"])
        use = {LABEL: -1}
        if o["pack"] == "bag":
            use[BAG] = -1
        else:
            use[CARTON], use[TAPE] = -1, -0.6
        case = "CASE c.name " + " ".join(f"WHEN {esc(n)} THEN {v}" for n, v in use.items()) + " END"
        sql.stmt("INSERT IGNORE INTO consumable_movements (consumable_id, site_id, qty_delta, kind, ref_type, ref_id, "
                 "actor_email, created_at)\n"
                 f"SELECT c.id, c.site_id, {case}, 'order', 'order', o.id, {esc(o['packer'])}, {utc(o['packed'])}\n"
                 f"  FROM consumables c JOIN orders o ON o.external_ref = {esc(o['ref'])}\n"
                 f" WHERE c.site_id = {h['site']} AND c.name IN {in_list(use)}")
    last = max(l["at"] for l in delivery["lines"])
    sql.stmt("INSERT IGNORE INTO consumable_movements (consumable_id, site_id, qty_delta, kind, ref_type, ref_id, "
             "actor_email, created_at)\n"
             f"SELECT c.id, c.site_id, -1, 'delivery', 'replenishment', r.id, {esc(em('eko.prasetyo'))}, {utc(last)}\n"
             "  FROM consumables c JOIN replenishments r ON r.reference = 'RPL-MA5-2609-001' "
             f"AND r.created_by = {esc(HQ)}\n"
             f" WHERE c.site_id = 4 AND c.name IN {in_list([DIVIDER, STICKER])}")
    rina = em("rina.saputri")
    raised, pr_at, got, ok = (datetime(2026, 9, 29, 16, 0), datetime(2026, 9, 30, 9, 15),
                              datetime(2026, 10, 2, 13, 30), datetime(2026, 10, 2, 15, 0))
    item = f"c.site_id = 4 AND c.name = {esc(BAG)}"
    sql.stmt("INSERT INTO consumable_requests (consumable_id, site_id, status, qty_suggested, note, raised_by, "
             "raised_at, pr_number, pr_qty, pr_by, pr_at, closed_at)\n"
             f"SELECT c.id, 4, 'closed', 100, 'Kantong untuk 2 minggu', {esc(rina)}, {utc(raised)}, "
             f"'PR-NV-2609-0143', 100, {esc(HQ)}, {utc(pr_at)}, {utc(ok)} FROM consumables c\n"
             f" WHERE {item} AND NOT EXISTS (SELECT 1 FROM consumable_requests q WHERE q.consumable_id = c.id "
             f"AND q.raised_by = {esc(rina)} AND q.raised_at = {utc(raised)})")
    sql.stmt("INSERT INTO consumable_receipts (consumable_id, site_id, request_id, packs, per_pack, qty_total, status, "
             "entered_by, entered_at, decided_by, decided_at)\n"
             f"SELECT c.id, 4, q.id, 2, 50, 100, 'approved', {esc(rina)}, {utc(got)}, {esc(HQ)}, {utc(ok)}\n"
             "  FROM consumables c JOIN consumable_requests q ON q.consumable_id = c.id "
             f"AND q.raised_by = {esc(rina)} AND q.raised_at = {utc(raised)}\n"
             f" WHERE {item} AND NOT EXISTS (SELECT 1 FROM consumable_receipts x WHERE x.request_id = q.id)")
    sql.stmt("INSERT IGNORE INTO consumable_movements (consumable_id, site_id, qty_delta, kind, ref_type, ref_id, "
             "actor_email, created_at)\n"
             f"SELECT x.consumable_id, x.site_id, x.qty_total, 'receipt', 'consumable_receipt', x.id, {esc(HQ)}, "
             f"x.decided_at\n  FROM consumable_receipts x JOIN consumables c ON c.id = x.consumable_id\n"
             f" WHERE {item} AND x.entered_by = {esc(rina)} AND x.entered_at = {utc(got)}")
    sql.stmt("UPDATE consumables c SET c.stock_qty = COALESCE((SELECT SUM(m.qty_delta) FROM consumable_movements m "
             "WHERE m.consumable_id = c.id), 0)\n"
             f" WHERE c.site_id IN (2, 4) AND {GATE}")


def emit_extras(sql):
    sql.note("15. The SPV's note for the morning after the week, and the kick-off steps nobody but a\n"
             "person can tick (devices, training, watching the first orders).")
    sql.stmt("INSERT IGNORE INTO eod_notes (site_id, day, note, written_by, written_by_name, written_at) VALUES\n" +
             vals("4", "'2026-10-04'",
                  esc("Mild Cleanser 100 ml di A-2-03 tinggal sedikit, sisanya di C-1-02. Kiriman Labore "
                      "RPL-MA5-2609-002 sudah dikonfirmasi merek. Satu botol body wash bocor masih di baki "
                      "MA5-QR-01, mohon diputuskan."),
                  esc(em("rina.saputri")), "'Rina Saputri'", utc(datetime(2026, 10, 4, 21, 50))))
    rows = []
    for h in HUBS:
        for step, when in (("a_devices", datetime(2026, 9, 25, 16, 0)), ("a_training", datetime(2026, 9, 26, 15, 0)),
                           ("e_watch", datetime(2026, 9, 28, 12, 0))):
            rows.append(vals(str(h["site"]), esc(step), esc(h["spv"]), esc(NAME[h["spv"]]), utc(when)))
    sql.stmt("INSERT IGNORE INTO hub_kickoff_marks (site_id, step_key, done_by, done_by_name, done_at) VALUES\n" +
             ",\n".join(rows))


# --------------------------------------------------------------------- the doc

def write_doc(skus, by_code, sims, orders, delivery, stats):
    lab = lambda c: by_code[c]  # noqa: E731
    mild100, mild225 = lab("LBR-0001"), lab("LBR-0002")

    def msg_line(store, s, q, ins=None):
        return {"hiryu_item_id": item_id(store, s), "item_qty": q, "sku_code": s["code"], "units": q,
                "item_price": s["menu"], "oos_instruction": ins}

    replace = {"type": "replace", "replace_hiryu_item_id": item_id(903, mild225),
               "replace_sku_code": mild225["code"], "replace_units": 1}
    gm358 = {"message_id": "dev-ord-358", "grab_order_id": "DEV-GM358-0001", "gm_number": "GM-358",
             "hiryu_store_id": 903, "order_time": "2026-10-08T09:41:00+07:00", "scheduled_time": None,
             "estimated_ready_time": None,
             "lines": [msg_line(903, lab("LBR-0007"), 3), msg_line(903, lab("LBR-0028"), 3),
                       msg_line(903, mild100, 3, replace), msg_line(903, lab("LBR-0015"), 3)]}
    gm347 = {"message_id": "dev-ord-347", "grab_order_id": "DEV-GM347-0001", "gm_number": "GM-347",
             "hiryu_store_id": 903, "order_time": "2026-10-08T08:50:00+07:00", "scheduled_time": None,
             "estimated_ready_time": None,
             "lines": [msg_line(903, lab("LBR-0005"), 2), msg_line(903, mild100, 2, {"type": "cancel_order"}),
                       msg_line(903, lab("LBR-0014"), 1)]}
    kahf = [s for s in skus if s["brand_id"] == 10]
    normal = {"message_id": "dev-ord-001", "grab_order_id": "DEV-LINK-000001", "gm_number": "GM-L001",
              "hiryu_store_id": 902, "order_time": "2026-10-08T10:15:00+07:00", "scheduled_time": None,
              "estimated_ready_time": None,
              "lines": [msg_line(902, kahf[0], 2), msg_line(902, kahf[2], 1),
                        msg_line(902, kahf[31], 1, {"type": "remove"})]}
    scheduled = {"message_id": "dev-ord-004", "grab_order_id": "DEV-LINK-000004", "gm_number": "GM-L004",
                 "hiryu_store_id": 904, "order_time": "2026-10-08T10:20:00+07:00",
                 "scheduled_time": "2026-10-08T13:00:00+07:00", "estimated_ready_time": None,
                 "lines": [msg_line(904, kahf[3], 1)]}
    unknown_sku = dict(normal, message_id="dev-ord-005", grab_order_id="DEV-LINK-000005", gm_number="GM-L005",
                       lines=[{"hiryu_item_id": "IDITE20269999999999", "item_qty": 1, "sku_code": "KHF-9999",
                               "units": 1, "item_price": 30000, "oos_instruction": None}])
    unknown_store = dict(normal, message_id="dev-ord-006", grab_order_id="DEV-LINK-000006", gm_number="GM-L006",
                         hiryu_store_id=999)
    cancel = {"message_id": "dev-can-001", "reason_code": "2004", "reason": "Customer requested",
              "cancelled_by": "customer", "cancelled_at": "2026-10-08T10:18:00+07:00"}

    def block(title, body):
        return f"{title}\n{'-' * 72}\n{json.dumps(body, indent=2, ensure_ascii=False)}\n{'-' * 72}"

    ma5 = sims["MA5"]

    def where(code):
        s = by_code[code]
        bins = ma5.sku_bins[s["id"]]
        return ", ".join(f"{b['short']} ({ma5.at(b)} units)" for b, _r in bins)

    lines = [
        "DEV TEST ORDERS AND THE DEMO FOR SHAUN (wms-test, dev environment only)",
        "=" * 72,
        "",
        "Generated by tools/gen_dev_seed.py with backend/db/seed.sql. Edit the generator, not this file.",
        "",
        "WHAT THE DEV SEED HOLDS",
        "-" * 72,
        "Hubs     MA5 Cawang (site 4, Hiryu dark store 13) and KJ5 Kemanggisan (site 2, dark store 14).",
        "         Both completed, open 08:00 to 22:00, bins MA5-IN-01..06, MA5-QR-01, MA5-OUT-01..06",
        "         (KJ5 the same). Mode demo is ON at MA5 only.",
        "People   MA5: Dimas Pratama, Ayu Lestari, Eko Prasetyo (Staf), Rina Saputri (SPV).",
        "         KJ5: Fajar Ramadhan, Rizky Maulana (Staf), Sari Wulandari (SPV).",
        "         Andi Pratama (Ops HQ), Bayu Hidayat (Ops Head). All firstname.lastname@ninjavan.co.",
        "         These accounts are names for the history; nobody signs in with them. Run the demo",
        "         with your own Ninja Van Google account (baskoro.nugroho@ninjavan.co is superadmin).",
        "Stores   902 Kahf - Cawang, 903 Labore - Cawang (MA5); 904 Kahf - Kemanggisan,",
        "         905 Labore - Kemanggisan (KJ5). MANUAL, link on, active on Grab.",
        f"SKUs     Kahf {sum(1 for s in skus if s['brand_id'] == 10)} (KHF-0001..), "
        f"Labore {sum(1 for s in skus if s['brand_id'] == 11)} (LBR-0001..), one menu item each per store.",
        "Racks    A to D at each hub, 5 levels, 2 kolom of 3 bins (A-1-01 to D-5-06).",
        "",
        "The canvas boards use three product names the real Labore list does not have. Stand-ins:",
    ]
    for code, label in STAND_IN.items():
        lines.append(f"  {label:32} -> {code} {by_code[code]['name']}")
    lines += [
        "",
        "Demo bins at MA5 after the seeded week:",
        f"  LBR-0001 Mild Cleanser 100 ml   {where('LBR-0001')}",
        f"  LBR-0007 (Micellar stand-in)    {where('LBR-0007')}",
        f"  LBR-0028 (BiomeBright stand-in) {where('LBR-0028')}",
        f"  LBR-0015 (Moisturizer stand-in) {where('LBR-0015')}",
        f"  LBR-0002 Mild Cleanser 225 ml   {where('LBR-0002')}",
        "",
        "History, Mon 28 Sep to Sun 4 Oct 2026 (Laporan shows it):",
        f"  {stats['orders']} orders ({stats['ma5']} MA5, {stats['kj5']} KJ5), {stats['handed']} handed over,",
        f"  {stats['missing']} cancelled for a missing item, {stats['customer']} cancelled by the customer.",
        f"  {stats['units']} units sold, Rp {stats['value']:,} at menu prices, Kahf {stats['kahf_pct']} % of sales.",
        f"  {stats['ready10']} of {stats['handed']} ready within 10 minutes; average pick {stats['pick']},"
        f" pack {stats['pack']}.",
        f"  Stock now: {stats['stock_ma5']} units at MA5, {stats['stock_kj5']} at KJ5"
        f" (about {stats['avg_stock']} per SKU).",
        "  Restock: RPL-MA5-2609-001 Kahf, received and put away Wed 30 Sep "
        f"({sum(l['qty'] for l in delivery['lines'])} pcs, {len(delivery['lines'])} SKUs).",
        "           RPL-MA5-2609-002 Labore, 6 SKUs, 124 pcs, sent and confirmed, brand PO PO/LBR/2609/0412,",
        "           expected Thu 8 Oct. Receive it on Barang masuk to refill A-2-03.",
        "  Counts:  cycles for Labore (every 2 weeks) and Kahf (every 4 weeks) from 28 Sep, one",
        "           difference at MA5 (approved by Rina, reviewed by Andi).",
        "  Quarantine: 1 leaking bottle at MA5 waiting for the SPV, 1 damaged tube at KJ5 waiting",
        "           for Ops HQ to approve the write-off.",
        "  Consumables: counted 28 Sep, used by every packed order; the MA5 carton stock is below",
        "           its minimum, so Perlu tindakan asks Rina to raise a need.",
        "",
        "HOW TO RUN THE DEMO",
        "-" * 72,
        "1. Sign in with your Ninja Van Google account (SPV of MA5, Ops HQ or above).",
        "2. Pengaturan > Demo: Mode demo is on for MA5. If someone switched it off, switch it on.",
        "   With Mode demo on, messages 3, 4 and 5 go to the built-in Hiryu stand-in and every",
        "   message in and out shows in Pengaturan > Integrasi Hiryu > Pesan Hiryu (exact JSON).",
        "3. Pesanan > Papan antrean (or Ambil): Buat pesanan dummy. Pick the store, the number of",
        "   products and the quantity, or leave them on Acak. Kirim seperti Hiryu sends a full",
        "   message 1 (contract v1.1, message_id demo-...) through the same handler Hiryu calls.",
        "   The GM number is random. The seeded history skips GM-347 and GM-358, so you can name",
        "   the replayed orders after the boards.",
        "4. To pick it yourself, tap Siap ambil on Pesanan > Ambil: the WMS gives the order to the",
        "   ready picker. Scan an empty basket (MA5-OUT-01..06), then each bin and unit.",
        "",
        "Scenario GM-347 (the cancelled order, boards 6e and 6k; 08:50 in the story)",
        "  Buat pesanan dummy: Toko Hiryu Labore - Cawang, Jumlah produk 3, Satu produk tidak ada:",
        f"  {mild100['item_name']} (LBR-0001), Instruksi pelanggan dari Grab: Batalkan.",
        "  The picker walks the bins in rack order. At A-2-03 declare Barang tidak ada, found 0, and",
        "  under Cek juga tempat lain yang tercatat enter 0 for C-1-02 too: both bins go to 0 and on",
        "  the next count (the story's \"Dua bin jadi 0\"). The order is cancelled (message 5,",
        "  cancel_order); units already in the basket go on Pesanan > Kembalikan ke rak. The dialog",
        "  picks the other products at random, so nothing may be in the basket yet. Body L3 below",
        "  is the board version: LBR-0005 at A-1-02 is picked first, so 2 units go back to the rack.",
        "",
        "Scenario GM-358 (the main order, boards 6a to 6d, 6f to 6h, 6j; 09:41 in the story)",
        "  Buat pesanan dummy: Labore - Cawang, Jumlah produk 4, Jumlah per produk 3, Satu produk",
        "  tidak ada: the same Mild Cleanser 100 ml, Instruksi: Ganti, Ganti dengan:",
        f"  {mild225['item_name']} (LBR-0002).",
        "  With both bins at 0 after GM-347, the line arrives short and the picker is sent to",
        "  A-2-03: declare it missing, found 0. The WMS follows the instruction: take 1 unit of the",
        "  225 ml from B-1-04. Selesai ambil, then Kemas: the WMS suggests a paper bag (one large",
        "  bottle fits a bag). Selesai dikemas sends message 4 and Serah ke driver closes the order.",
        "  Message 5 (replaced) is in the Pesan Hiryu log. Run on its own (no GM-347 before it),",
        "  the WMS sends the picker to A-2-03 too: it holds the older batch.",
        "  The dialog chooses the other three products. Body L2 below is the board order: the",
        "  stand-ins for Micellar Water (A-3-01), BiomeBright Serum (A-4-01) and Moisturizer (A-2-05).",
        "",
        "Batalkan dari Hiryu: on a dummy order, the dialog sends message 2 (who and reason).",
        "After the demo: A-2-03 shows the units found; receive RPL-MA5-2609-002 on Barang masuk",
        "(type the brand PO PO/LBR/2609/0412 or the reference) to refill it, as at 13:20 in the story.",
        "",
        "Stock the demo uses at MA5 is real ledger stock: replaying GM-358 several times empties",
        "A-2-03 and C-1-02. Receiving RPL-MA5-2609-002 refills them; a dev database reset restores",
        "the seed.",
        "",
        "HIRYU LINK BY HAND (message 1 and message 2 bodies)",
        "-" * 72,
        "Hiryu's path is public and protected by the shared secret (POS_SHARED_SECRET of the dev app):",
        "  curl -X POST https://<dev host>/api/hiryu/v1/orders -H 'Content-Type: application/json' \\",
        "       -H 'X-Hiryu-Key: <secret>' -d @body.json",
        "An order sent this way is a link order, not a dummy (is_demo 0): it counts in the reports.",
        "Each message_id is used once; change message_id and grab_order_id to send a new order.",
        "",
        block("L1. A normal Kahf order at MA5 (store 902). Expect 201 accepted; again: 200 duplicate.", normal),
        "",
        block("L2. GM-358 exactly as on the boards (store 903). Mild Cleanser 100 ml carries Ganti dengan "
              "Mild Cleanser 225 ml.", gm358),
        "",
        block("L3. GM-347 as on the boards (store 903). Mild Cleanser 100 ml carries Batalkan; LBR-0005 "
              "(A-1-02) is picked before it.", gm347),
        "",
        block("L4. A scheduled Kahf order at KJ5 (store 904): ready-by = scheduled time - 20 min.", scheduled),
        "",
        block("L5. An unknown SKU code. Expect 422 and a red row on Integrasi Hiryu.", unknown_sku),
        "",
        block("L6. An unknown store. Expect 422.", unknown_store),
        "",
        block("C1. Cancel L1: POST /api/hiryu/v1/orders/DEV-LINK-000001/cancel", cancel),
        "",
    ]
    SAMPLE.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --------------------------------------------------------------------- main

def stats_for(skus, sims, orders):
    real = [o for o in orders if o["kind"] != "uji"]
    handed = [o for o in real if o["kind"] == "normal"]
    units = sum(l["qty"] for o in handed for l in o["lines"])
    value = sum(l["qty"] * l["sku"]["menu"] for o in handed for l in o["lines"])
    kahf = sum(l["qty"] * l["sku"]["menu"] for o in handed for l in o["lines"] if o["brand"] == 10)
    picks = [(o["completed"] - o["started"]).total_seconds() for o in handed]
    packs = [(o["packed"] - o["pack_started"]).total_seconds() for o in handed]
    ready = sum(1 for o in handed if (o["packed"] - o["placed"]).total_seconds() <= 600)
    mmss = lambda s: f"{int(s // 60)} min {int(s % 60)} s"  # noqa: E731
    stock = {k: sum(st.qty.values()) for k, st in sims.items()}
    return dict(orders=len(real), ma5=sum(1 for o in real if o["hub"] == "MA5"),
                kj5=sum(1 for o in real if o["hub"] == "KJ5"), handed=len(handed),
                missing=sum(1 for o in real if o["kind"] == "missing"),
                customer=sum(1 for o in real if o["kind"] == "customer"), units=units, value=value,
                kahf_pct=round(100 * kahf / value), ready10=ready, pick=mmss(sum(picks) / len(picks)),
                pack=mmss(sum(packs) / len(packs)), stock_ma5=stock["MA5"], stock_kj5=stock["KJ5"],
                avg_stock=round((stock["MA5"] + stock["KJ5"]) / (2 * len(skus)), 1),
                per_unit=round(value / units))


def main():
    rng = random.Random(20261005)
    skus = load_skus(rng)
    by_code = {s["code"]: s for s in skus}
    plans = {h["short"]: layout(h, skus) for h in HUBS}
    sims, orders, delivery, counts, flags, quarantine = simulate(skus, plans, rng)

    personas = in_list(em(p[0]) for p in PEOPLE)
    seed_owners = in_list([OLD_SEED] + [em(p[0]) for p in PEOPLE])
    sql = Sql()
    sql.lines += [
        "-- GENERATED by tools/gen_dev_seed.py. Do not edit by hand.",
        "-- DEV ONLY: Substrait never applies this file to production.",
        "-- Demo data for Shaun (canvas DEMO-NUMBERS.md): MA5 Cawang and KJ5 Kemanggisan, Kahf and",
        "-- Labore, one week of history (28 Sep to 4 Oct 2026). No customer data. Re-runnable:",
        "-- natural keys; the rows the seed owns are rewritten; the one-time reset of the first",
        f"-- seed's racks and stock is gated by audit_log dev_seed / {MARK}.",
    ]
    emit_master(sql, skus, plans, orders)
    emit_layout(sql, plans, seed_owners)
    flag_rows = emit_orders(sql, orders, personas)
    emit_week(sql, sims, orders, delivery, counts, flags, quarantine, skus, flag_rows, personas)
    emit_consumables(sql, orders, delivery)
    emit_extras(sql)
    sql.note("Done: the marker that keeps the one-time reset from running again.")
    sql.stmt("INSERT INTO audit_log (actor_email, entity, entity_id, action, after_json)\n"
             f"SELECT '{OLD_SEED}', 'dev_seed', 3, '{MARK}', "
             "'{\"note\": \"dev seed for deploy 3: racks, stock and history\"}' FROM DUAL\n"
             f" WHERE {GATE}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(sql.lines) + "\n", encoding="utf-8")
    st = stats_for(skus, sims, orders)
    write_doc(skus, by_code, sims, orders, delivery, st)
    print(f"{OUT.relative_to(ROOT)}: {sql.count} statements; {len(skus)} SKUs "
          f"(Kahf {sum(1 for s in skus if s['brand_id'] == 10)}, Labore {sum(1 for s in skus if s['brand_id'] == 11)}); "
          f"{sum(len(p['bins']) for p in plans.values())} rack bins")
    print(f"week: {st['orders']} orders (MA5 {st['ma5']}, KJ5 {st['kj5']}), {st['handed']} handed over, "
          f"{st['missing']} missing-item cancels, {st['customer']} customer cancel; {st['units']} units, "
          f"Rp {st['value']:,} (Rp {st['per_unit']:,} a unit), Kahf {st['kahf_pct']} %")
    print(f"ready within 10 min {st['ready10']}/{st['handed']}; pick {st['pick']}, pack {st['pack']}; "
          f"stock MA5 {st['stock_ma5']}, KJ5 {st['stock_kj5']} (avg {st['avg_stock']} per SKU)")
    print(f"delivery {sum(l['qty'] for l in delivery['lines'])} pcs / {len(delivery['lines'])} SKUs; "
          f"counts {len(counts)} tasks ({sum(1 for c in counts if c['counted'] != c['expected'])} difference); "
          f"quarantine {len(quarantine)}; {SAMPLE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
