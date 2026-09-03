# Ninja WMS for GrabMart Kilat — Product Requirements Document

| | |
|---|---|
| **Product** | Ninja Kilat WMS (working name) |
| **Version** | v0.1 — draft for review |
| **Date** | 3 September 2026 |
| **Author** | Baskoro Nugroho |
| **Status** | Draft — open questions in §16 |
| **Platform** | Substrait (Ninja Van internal AI web-app platform) |
| **Pilot brand** | Wardah Official Store — 118 SKUs |
| **Pilot sites** | 3 darkstores wave 1, up to 10 stations at scale, 1 central hub |

---

## 1. Summary

Ninja Van fulfils GrabMart Kilat quick-commerce orders on behalf of brands. Grab owns demand generation and order creation; Ninja owns everything from goods-in to rider handover.

Ninja already runs a **POS system** (Hiryu) connected to the Grab merchant app. It handles multi-brand/multi-store account management, per-SKU stock input, menu listing, store registration, the order ticket queue, the compliance photo, and automatic stock deduction on completed orders. That system works at the scale it was built for: a handful of SKUs a station staffer can hold in their head.

Wardah brings **118 SKUs into a 7.2 m² cooled rack cell per station**, arriving as loose mixed cartons. Other brands of the same size or larger are expected behind it. At that assortment, "which shelf is Glasting Liquid Lip 07 on" stops being answerable from memory, and a manual daily stock count stops being credible.

This WMS is the **complementary physical-inventory layer** underneath the POS. It answers three questions the POS does not:

1. **Where does this unit go?** (inbound → basket → rack location)
2. **Where do I find this unit?** (order → pick path → basket)
3. **Is what we think we have actually there?** (weekly stock opname per basket)

The POS keeps owning Grab connectivity, the order ticket, the receipt, the compliance photo and dispatch. The WMS owns location, putaway, pick guidance, physical counts, and becomes the source of truth for on-hand quantity that it pushes back to the POS.

---

## 2. Context and problem

### 2.1 What exists today

**Hiryu POS**, live in Malaysia on a different commercial model (Ninja is the merchant there; in Indonesia the brand is the merchant and Ninja is the fulfilment partner). It provides:

- Multiple brands across multiple stores on one Grab merchant account
- Per-SKU inventory quantity input
- Item/menu list per store
- New store registration
- Order intake from GrabMart → an open packing ticket per order
- Staff-taken compliance photo attached to the receipt
- Automatic deduction of stock on order completion

Operational learnings inherited from the Malaysia rollout, all of which shape this spec:

- Auto-printed receipt → bag → photo → mark ready
- Each brand-location is a separate Grab merchant
- Hiryu is updated on **inbound only**; sales auto-deduct
- Stock counting is **manual and daily**
- Restock is triggered by a Google Sheet threshold plus a WhatsApp message
- **Grab refunds the customer and charges the merchant by default** — proof of fulfilment is financially load-bearing, not paperwork
- **Inbound discrepancies must be raised within 24 hours or the station bears the loss**

### 2.2 What breaks at Wardah scale

| Pressure | Detail | Source |
|---|---|---|
| **Assortment size** | 118 SKUs. 54 of them are lip shades that differ only by a number and a colour name — *Glasting Liquid Lip 01 Caramel Coat* through *…19 Tawny Silk* and beyond. | `wardah_sku_list.csv` |
| **Look-alike risk** | Picking shade 07 instead of 08 is invisible to the eye and produces a refund plus a merchant charge. | §2.1 |
| **Inbound form** | Believed to arrive as **loose mixed cartons**, not one carton per SKU. Every unit must be decanted and slotted individually: 4–7 h per fortnightly delivery (~4,950 units) or 2–3.5 h weekly (~2,480 units) at 3–5 s per unit. | HANDOFF §16 |
| **Manual counting** | A daily manual count of 118 baskets is not going to happen honestly. Weekly, basket-scoped, scanner-driven is achievable. | HANDOFF §17 |
| **Discrepancy window** | 24 h to raise an inbound gap. Without a timestamped receiving record there is nothing to raise it with. | §2.1 |
| **Expiry** | 11 SKUs are expiry-critical (UV Shield ×7, UV Acne Calming ×2, C-Defense ×2) and need true FEFO. 25 are watch-tier, 72 stable. | HANDOFF §17 |
| **Staff profile** | Predominantly high-school graduates, high turnover, no warehouse-systems background. | Product owner |
| **Multi-brand future** | Other brands of equal or larger SKU count are in the pipeline. Nothing may be hard-coded to Wardah. | Product owner |

### 2.3 Physical environment the WMS must model

Settled in the space model and not re-opened here:

- **Rack**: 1.0 m W × 0.4 m D × 2.0 m H, **5 levels**, 0.40 m level pitch, 0.36 m clear opening, 0.40 m² footprint.
- **7 racks per station**, 33 occupied shelf levels, ~17 SKUs per rack.
- **Three basket sizes only** (five widths were rejected as impractical). All 0.40 m deep, 0.36 m high; width alone sets capacity:

  | Basket | Width | Usable cbm | Per 1 m shelf level |
  |---|---|---|---|
  | Small | 0.20 m | 0.0158 | 5 |
  | Medium | 0.33 m | 0.0261 | 3 |
  | Large | 0.50 m | 0.0396 | 2 |

- **One basket per SKU is a hard rule. Baskets are never shared.** This is the single most important simplification in this document — see §5.5.
- Hair care (3 SKUs, 0.0522 cbm each) exceeds Large and stands on an **open shelf level** with no basket. The model must support a location that is a bare shelf.
- **Level 5 sits at ~2.0 m**, above comfortable pick height. Slow movers go on level 5, fast movers on levels 2–3. A step stool is provided.
- Storage zone 7.2 m² (cooled, 24/7, dedicated) + fulfilment zone 3.3 m² (ambient, shared, active only during work).

### 2.4 Sites

Seven Ninja stations plus one hub are in scope. Names lie; addresses are authoritative.

| Code | Location | Building | Role |
|---|---|---|---|
| MAC-KJR | Kemanggisan, Palmerah | 272 m² | Darkstore — wave 1 candidate |
| MAC-UT5 | Johar Baru, Jakpus | 324 m² | Darkstore — wave 1 candidate |
| MAC-MA5 | Kalibata, Kramat Jati | 350 m² | Darkstore — wave 1 candidate |
| MAC-KD5 | Krukut, Limo, Depok | 376 m² | Darkstore |
| KOI-CP5 | — | 408 m² | Darkstore |
| MAC-CB5 | Cibinong | 540 m² | Darkstore |
| MAC-RBU | New Rawa Lumbu | 550 m² | Darkstore |
| MAC-MAC | Logos Metrolink, Medan Satria, Bekasi | ~10× a station | **Central hub** |

Wardah's 10.5 m² is 1.9–3.9% of any of these buildings. Space is not the constraint.

---

## 3. Goals and non-goals

### 3.1 Goals

- **G1** — A station staffer with no training beyond a 10-minute walkthrough can receive, put away, pick and count 118 SKUs without knowing the product range.
- **G2** — Every physical unit movement is captured by a scan, timestamped, and attributed to a named person.
- **G3** — On-hand quantity per SKU per site is accurate enough that the number pushed to the POS can be listed on Grab without oversell.
- **G4** — Weekly stock opname of a full station completes inside one shift, with a variance report a supervisor can act on.
- **G5** — Onboarding a second brand of 118+ SKUs is configuration, not code.
- **G6** — Full Bahasa Indonesia / English switching, Indonesian default.
- **G7** — Ten concurrent stations and several concurrent staff per station, without two people corrupting each other's counts.

### 3.2 Non-goals for v1

- **NG1** — Replacing the POS. The POS keeps Grab connectivity, the order ticket, the receipt, the compliance photo and dispatch.
- **NG2** — Integrating with any brand's own WMS or ERP. Assume no access.
- **NG3** — Exception handling flows. Deliberately deferred — see §15.
- **NG4** — Demand forecasting, auto-replenishment, purchase orders.
- **NG5** — Route or rider management.
- **NG6** — Offline operation. See §5.2.
- **NG7** — Financial reconciliation, invoicing, consignment settlement.
- **NG8** — Native mobile apps. Responsive web only.

---

## 4. Users

| Persona | Who | Where | Devices | Needs |
|---|---|---|---|---|
| **Station Staff** | High-school graduate, high turnover, Bahasa Indonesia first language, no systems background | Darkstore backroom | Shared laptop + HID scanner; phone during pilot | Told exactly what to do next in one short sentence. Big targets. No free-text. No jargon. |
| **Station Supervisor** | Runs the shift, signs off counts, raises discrepancies | Darkstore | Laptop | Sees variance, approves opname, resolves flagged items |
| **Hub Operator** | Receives brand deliveries at Logos, registers barcodes, breaks bulk, builds station totes | Central hub | Laptop + HID scanner | High-volume registration and bulk scanning |
| **Brand/Ops Admin** | Ninja HQ. Onboards brands, loads SKU masters, defines slotting | Office | Laptop | Bulk import, configuration, cross-site reporting |

**Design consequence of the Station Staff profile.** This is not a preference, it is a constraint that outranks feature richness:

- One task per screen. One primary action per screen.
- Every instruction phrased as an imperative in ≤ 8 words.
- Product identity always shown as **photo + full name + basket location**, never a code alone.
- Colour and icon carry meaning redundantly with text (green tick / red cross / amber warning), because reading is the slow path.
- Numeric entry via large +/− steppers and a numeric keypad, never a bare text field.
- No nested menus deeper than two levels.
- No destructive action without an explicit second confirm.

---

## 5. Key design decisions

These five decisions shape everything downstream. Four were decided with the product owner on 3 Sep 2026; the fifth falls out of the space model.

### 5.1 Identity model — two modes, set per SKU **[DECIDED]**

Not every brand arrives barcoded. The WMS therefore supports **two identity modes**, chosen per SKU (defaulting from a brand-level setting), because a brand may barcode some of its range and not the rest.

| | **Mode A — `sku_barcode`** | **Mode B — `unit_label`** |
|---|---|---|
| **When** | The brand prints a scannable EAN/UPC on the retail item | The brand prints nothing scannable, or the symbol is unreadable |
| **What a scan means** | *"This is a Glasting Lip 07"* — the SKU, not the bottle | *"This is bottle NJ0000041827"* — one specific physical unit |
| **Stock is held as** | A quantity per SKU per location | A set of individually-tracked units, each with a location |
| **Labelling work at inbound** | None | Apply and bind one Ninja label per unit |
| **Opname output** | Quantity variance (expected 55, counted 52, −3) | The exact plates that are missing, by name |
| **FEFO** | Not enforceable by system; physical control only | Enforceable per unit, if expiry is captured at labelling |
| **Pilot brand** | **Wardah** — all 118 SKUs | None yet; the first unbarcoded brand to arrive |

**Mode A — SKU-level barcode plus quantity.** Wardah units carry a manufacturer EAN-13 that is **identical across every unit of the same SKU**. A scan identifies the *SKU*, not the individual bottle, so the WMS holds a quantity per SKU per location and does not serialise. Consequences:

- **Stock opname** is *"count everything in this basket and tell me the number"*, not *"tick off a list of unique barcodes."* Output is a **quantity variance** per basket, not a list of named missing units.
- **Outbound** scanning is a **SKU verification gate**, not a unit consumption event. The scan proves the picker has the right shade in hand; the quantity comes from the order line.
- **FEFO for the 11 expiry-critical SKUs** cannot be enforced at unit level. It is handled physically: a coloured basket label carrying the batch expiry month, plus a monthly sweep. Flagged in §16 as needing an operational owner.

**Mode B — Ninja license plate, one per physical unit.** Where a brand has no barcode system, **the WMS mints a unique label per physical unit** and staff apply it to the item. Every downstream scan then identifies that exact unit. This is the model the original brief described, and under Mode B it works literally: outbound *"marks that specific barcode as outbound from the list of items in storage"*, and opname *"shows a list of barcodes to scan and reports which item is missing."* Full flow in **M1.4**.

**The cost of Mode B is real and belongs in the operating plan, not buried in a spec.** Applying and binding a label runs 4–8 s per unit. On a 4,950-unit fortnightly delivery that is **5.5–11 hours of labelling** on top of the 4–7 hours of decanting already budgeted (HANDOFF §16). Two consequences follow:

- **Mode B labelling should happen at the hub, not at darkstores.** It is the single strongest argument yet for the "break bulk once at Logos" proposal — it moves the heaviest, most error-prone task away from the least-trained hands. A darkstore receiving a labelled transfer just scans.
- **Mode B is a commercial conversation with the brand before it is a build task.** A Ninja sticker goes onto retail packaging the customer will hold. Placement, adhesive, removability and whether it may cover any part of the brand's own artwork or expiry date all need the brand's written agreement. See §16.

**Both modes coexist in one system, and staff must never have to think about which is which.** Every guided flow — inbound, pick, opname — presents the same interaction: *the screen tells you what to scan, you scan it, the screen turns green or red.* The mode changes what the system does with the scan, never what the staffer does.

### 5.2 Connectivity — online-only with graceful retry **[DECIDED]**

Every scan hits the server. No local queue, no offline conflict resolution. If the network drops, the screen blocks with a clear message and an automatic retry, and the staffer waits.

This is a real risk in a cooled, partitioned corner of a warehouse. It is accepted for v1 in exchange for a much simpler build and consistent state across 10 stations. Mitigations:

- Site survey of signal strength at KJR, UT5 and MA5 before go-live — see §16.
- All scan endpoints are idempotent so a retry after an ambiguous timeout cannot double-count.
- The client shows a persistent connection indicator, and warns *before* a task is started if the connection is weak.

If the survey comes back bad, offline-first becomes a phase-2 decision, not a v1 patch.

### 5.3 Scanning hardware — HID scanner primary, camera fallback **[DECIDED]**

**Primary: Bluetooth/USB HID barcode scanner attached to a laptop.** The scanner behaves as a keyboard: it types the barcode digits and presses Enter. The app listens for a fast burst of keystrokes terminated by Enter and treats it as a scan. No camera code, no permissions, sub-second scans, works in dim light, survives the 4,950-unit inbound burst.

**Fallback: phone camera scanning in the browser.** Required for the pilot and for testing before scanners are procured, and useful as a backup when a gun's battery dies. Slower (2–4 s), and weaker on small curved cosmetic packaging.

Both input paths feed the same endpoint. Scan handling requirements:

- Distinguish scanner input from human typing by inter-keystroke timing (< 50 ms between characters ⇒ scanner).
- The scan target field is always focused; a stray click elsewhere must not swallow a scan.
- Audible + visual feedback on every scan: green tone/tick for accepted, red buzz/cross for rejected, with the reason in one line.
- Duplicate-scan protection: the same barcode scanned twice within 300 ms counts once.

### 5.4 Authentication — Google SSO via the Substrait Access tab **[DECIDED]**

The Substrait platform's auth proxy injects `X-Forwarded-Email` and `X-Forwarded-User` into every gated backend request once SSO is enabled. The app therefore ships **no login page and no password storage**.

- Every scan, count and adjustment is attributed to a named Ninja account. This is what makes the 24-hour inbound discrepancy rule and opname disputes actionable.
- Roles are the app's own logic, keyed on the SSO email: a `users` table maps email → role → site(s).
- Trustworthy **only while SSO is enabled** (the proxy strips client-sent values; with SSO off anyone can forge the header). The app must degrade to an explicit anonymous/dev mode when the header is absent, never to an implicit admin.
- The browser never sees the header — the frontend asks `/api/me`.

Requires every station staffer to have a Ninja Google account usable on the shared station device. Flagged in §16.

### 5.5 One basket = one SKU **[FALLS OUT OF THE SPACE MODEL]**

The space model fixes this as a hard operating rule. It collapses an enormous amount of software complexity:

- A location holds exactly one SKU, so "where is this SKU" has one answer per site.
- Opname of a basket is a count of one number, not a reconciliation of a mixed bin.
- Putaway is a lookup, not a slotting decision.
- Pick confirmation needs only a SKU match, not a unit match.

The data model still expresses location and SKU separately (so a future mixed-bin mode is possible), but **v1 enforces the one-SKU-per-basket invariant at the database level** with a unique constraint.

---

## 6. Domain model and glossary

| Term | Definition |
|---|---|
| **Brand** | A merchant whose goods Ninja fulfils. Wardah is the first. Owns a SKU set. |
| **SKU** | A distinct sellable product variant of a brand. *Glasting Liquid Lip 01 Caramel Coat, 3.5 g* is one SKU. Wardah has 118. |
| **Barcode** | An EAN/UPC symbol printed by the brand that resolves to exactly one SKU. A SKU may have more than one (repackaging, regional variants). A barcode may never map to two SKUs. |
| **Identity mode** | Per SKU: `sku_barcode` (Mode A — scan resolves to a SKU) or `unit_label` (Mode B — scan resolves to one physical unit). See §5.1. |
| **Unit** | One physical sellable piece. In Mode A it is counted, not tracked. In Mode B it is a row in the database with its own identity, location and history. |
| **License plate** | A unique Ninja-minted code, one per physical unit, printed on a label and applied to the item. Mode B only. Format `NJ` + 10 digits, Code-128. |
| **Label roll** | A roll or sheet of pre-printed, **anonymous** license plates — sequential codes bound to nothing until a staffer binds them. One roll serves every SKU and every brand. |
| **Bind** | The act of scanning a freshly-applied license plate while a SKU is locked on screen, which permanently attaches that plate to that SKU and brings the unit into stock. |
| **Site** | A physical Ninja location. Either a **Hub** (Logos — receives from brand, breaks bulk, distributes) or a **Darkstore** (a MAC station — receives, stores, picks, hands to rider). |
| **Rack** | A 1.0 × 0.4 × 2.0 m five-level shelving unit. Belongs to a site. Labelled A, B, C… |
| **Level** | One of the 5 shelves on a rack, numbered 1 (bottom) to 5 (top). |
| **Position** | A slot along a level. Capacity depends on basket size: 5 Small, 3 Medium, or 2 Large per 1 m level. |
| **Location** | A `SITE-RACK-LEVEL-POSITION` address, e.g. `UT5-A-3-02`. The atomic storage address. |
| **Basket** | A physical container of Small/Medium/Large size, occupying a location, holding exactly one SKU. Carries a printed label. An **open-shelf** location is a location with no basket (hair care). |
| **Slot assignment** | The binding of one SKU to one basket at one location within one site. |
| **On-hand** | Quantity of a SKU physically present at a location, per the WMS. |
| **Available to sell** | On-hand minus allocated-to-open-orders. This is the number pushed to the POS. |
| **Inbound receipt** | A recorded delivery event at a site: from the brand, or a transfer from the hub. |
| **Transfer** | A hub → darkstore movement. Outbound at the hub, inbound at the darkstore. |
| **Pick task** | The WMS-side instruction set generated from one POS order, sequenced by pick path. |
| **Opname session** | One staffer's count of one basket at one point in time. |
| **Expiry tier** | Critical (11 SKUs), Watch (25), Stable (72). Drives labelling and sweep frequency, not system logic in v1. |

### 6.1 Entity relationships

```
Brand ──< SKU ──< Barcode
                   │
Site ──< Rack ──< Level ──< Location ──< Basket ──1:1── SlotAssignment >── SKU
                                            │
                                      InventoryBalance (site, sku, location, qty)
                                            │
        ┌───────────────────────────────────┼────────────────────────────────┐
        │                                   │                                │
  InboundReceipt ──< ReceiptLine      PickTask ──< PickLine        OpnameSession ──< OpnameCount
        │                                   │                                │
        └──────────────── StockMovement (the immutable ledger) ──────────────┘
```

**`StockMovement` is the ledger and the only thing that may change `InventoryBalance`.** Every receipt, pick, transfer, opname adjustment and correction writes an append-only movement row. Balance is a materialised projection that can always be rebuilt by replaying movements. This is what makes the 24-hour discrepancy rule defensible and makes any "where did this stock go" question answerable.

---

## 7. Location and basket model

### 7.1 Location codes

Format: `{SITE}-{RACK}-{LEVEL}-{POSITION}`

- `UT5-A-3-02` — Johar Baru station, rack A, level 3, second position
- Racks are letters (A…G for 7 racks), levels are 1–5 bottom to top, positions are zero-padded two digits left to right.
- An open-shelf level is addressed as position `00`: `UT5-G-1-00`.

Codes are printed large on the rack upright (rack letter), on the level edge (level number) and on the basket label (full code). A staffer should be able to walk to `UT5-A-3-02` without reading a screen twice.

### 7.2 Basket labels

Every basket carries a printed label. The label is the primary UI for a staffer who cannot read the screen and the product at the same time. It must show, in this priority order:

1. **Product photo** — the largest element. Shade differences are visual.
2. **Full SKU name** in large type — *Glasting Liquid Lip 07 Rouge Flare*
3. **Location code** — `UT5-A-3-02`
4. **Basket barcode** — a Ninja-generated Code-128 encoding the basket ID, so a staffer can scan the basket instead of typing the location
5. **Expiry tier colour band** — red for Critical, amber for Watch, none for Stable
6. **Expiry month**, handwritten in a marked box, for the 11 Critical SKUs only

Labels are generated as a printable A4 sheet from the WMS. Regenerating a label after a slot change is a one-click action.

### 7.3 Basket sizing and slot assignment

The WMS recommends a basket size per SKU from unit cube × units-to-hold, using the space model's formula: `units per SKU = MAX(6, round(sales_per_day × days_of_inventory × (1 + safety)))`, which at the base case (3 units/day, 14 DOI, 30% safety) gives **55 units**.

The recommendation is advisory. An admin may override it, because the physical answer wins.

Slotting rules the WMS applies when suggesting a location:

| Rule | Reason |
|---|---|
| Fast movers on levels 2–3 | Comfortable pick height, most of the walking |
| Slow movers on level 5 | Above shoulder height, needs a step stool |
| SKUs of the same product line kept adjacent | A picker looking for shade 07 sees 06 and 08 either side, which is both a help and a risk — the scan gate covers the risk |
| Critical-expiry SKUs grouped on one level | Makes the monthly sweep one pass, not seven |
| Hair care to open-shelf levels | Exceeds Large basket capacity |

### 7.4 Unit labels (Mode B)

A license plate label is small, dumb and disposable. It carries only what a scanner needs:

1. **The Code-128 symbol**, sized to scan reliably at 10–15 cm from a handheld gun
2. **The plate code in human-readable digits** beneath it — `NJ 0000041827` — so a staffer can read one out over the phone when something goes wrong
3. Nothing else. No SKU name, no logo, no date. The label is printed **before** anyone knows which SKU it will land on, which is exactly what makes one roll serve every brand.

Physical requirements, all of which need brand sign-off (§16):

- **Size** target ≤ 25 × 15 mm, so it fits a 3.5 g lipstick tube without wrapping onto a curve that defeats the scanner.
- **Placement rule per SKU**, configured once and shown on screen during labelling: never over the brand's own barcode, batch code, expiry date, or primary artwork face.
- **Removable adhesive**, so the customer can peel it cleanly, unless the brand agrees otherwise.
- Rolls are consumable stock. The WMS tracks which plate ranges have been issued to which site so a supervisor can see when a station is running low, and so a duplicate range from a printer misfeed is detectable.

## 8. Functional requirements

Seven modules. Each maps to a top-level menu item.

---

### M1 — Brand & SKU Master *(Admin)*

**Purpose.** Onboard a brand and its SKU list, and bind barcodes to SKUs.

#### M1.1 Brand management
- **M1.1.1** Admin can create a brand: name, code, contact, active flag.
- **M1.1.2** Admin can associate a brand with one or more sites. A SKU is only stockable at a site where its brand is active.
- **M1.1.3** Brands are soft-deleted (deactivated), never hard-deleted.

#### M1.2 SKU registration
- **M1.2.1** Admin can create a SKU under a brand with: brand SKU code, full display name, category, product line, unit size, price (Rp), unit cube (cm³), expiry tier, product photo.
- **M1.2.2** Admin can **bulk-import SKUs from CSV**, in the exact column shape of `wardah_sku_list.csv` (`#, Category, Product line, Product name, Unit size, Price, Read confidence, Est. unit cube`). Import is preview-then-confirm; it reports per-row errors and imports nothing on a hard failure.
- **M1.2.3** SKU display name is the string the picker sees. It must match the name shown in the Grab app so a staffer cross-referencing a receipt is not confused.
- **M1.2.4** Product photo is required before a SKU can be slotted. A SKU with no photo is listed as *incomplete* and blocked from slotting. Photos go to object storage.

#### M1.3 Barcode registration — the bulk-scan flow

This is the flow the product owner described: **pre-select the SKU, then scan, then register.**

- **M1.3.1** Staffer (Hub Operator, Supervisor or Admin) opens *Register Barcode*.
- **M1.3.2** Selects **brand**, then **SKU** — via search-as-you-type on name, filtered list by product line, or by scanning an already-known barcode of that SKU.
- **M1.3.3** The screen locks to that SKU and shows photo + full name, large. This is the guard against registering a barcode to the wrong shade.
- **M1.3.4** Staffer scans. Each scan appends to a visible list on screen with a running count. Repeated scans of the same barcode are collapsed to one entry with a count, not rejected — a bulk scan of 40 identical units is the normal case and must not produce 40 errors.
- **M1.3.5** For each *distinct* barcode value the system checks in real time:
  - already registered to **this** SKU → shown grey, "already registered", harmless
  - already registered to a **different** SKU → shown red, **blocked**, with the conflicting SKU name displayed. Resolving this needs a supervisor.
  - not seen before → shown green, ready to register
- **M1.3.6** Staffer presses **Register**. All green entries are bound to the SKU in one transaction, attributed to the staffer with a timestamp.
- **M1.3.7** A SKU may hold multiple barcodes. A barcode may resolve to exactly one SKU — enforced by a unique index, not just by UI.
- **M1.3.8** Supervisor can unbind a barcode, with a reason, recorded in the audit log.

#### M1.4 Mode B — license-plate labelling for brands with no barcodes

Where a brand prints nothing scannable, **the WMS mints a unique label per physical unit** and staff apply it to the item. From that moment the unit has an identity, and every later scan tracks that exact piece.

**Why pre-printed anonymous rolls, not print-on-demand per SKU.** Labels are printed in advance with sequential codes and bound to nothing. A staffer applies a label, then scans it while the SKU is locked on screen, and the scan is what binds plate to SKU. This is deliberate:

- **One roll serves every SKU and every brand.** No per-SKU print runs to produce, sort, store or mix up.
- **The binding scan is a verification step, not overhead.** Print-on-demand would let a staffer apply a "Hair Mask" label to a face wash with nothing to catch it. Under anonymous rolls, the SKU is locked on screen with a photo while the plate is scanned, so the staffer is looking at the product they are naming.
- **It is the same interaction as M1.3 barcode registration** — pre-select the SKU, then scan repeatedly. Staff learn one thing.

##### M1.4.1 Label supply
- **M1.4.1.1** Admin generates a **plate range**: a block of sequential codes (`NJ` + 10 digits, Code-128), reserved to a site, marked `issued`, and exported as a print file for a thermal label printer.
- **M1.4.1.2** A plate exists in the database from the moment it is issued, in state `unbound`. Issuing 5,000 plates creates 5,000 rows.
- **M1.4.1.3** Plate codes are never reused. A duplicate scan of a bound plate during binding is a hard error naming the SKU it already belongs to.
- **M1.4.1.4** The WMS shows remaining unbound plates per site and warns below a configurable threshold, because running out mid-delivery stops the receiving line.

##### M1.4.2 The labelling flow
- **M1.4.2.1** Staffer opens *Label Units*, selects brand then SKU. The screen locks to that SKU: photo large, full name, and the configured **placement rule** for the sticker (*"Belakang botol, jangan tutup tanggal kadaluarsa"*).
- **M1.4.2.2** Staffer peels a label, applies it to the unit, and scans it. One scan per unit.
- **M1.4.2.3** Each scan binds that plate to the locked SKU and shows a running count. The counter is the whole feedback loop: apply, scan, number goes up.
- **M1.4.2.4** Scanning an **already-bound** plate → red, blocking, naming the SKU it belongs to. This catches a label falling off one unit and being stuck on another.
- **M1.4.2.5** Scanning a plate **not issued to this site** → red, blocking. Catches rolls migrating between stations.
- **M1.4.2.6** **Undo last** is always one tap, and unbinds the plate cleanly so the label can be peeled and rebound.
- **M1.4.2.7** For **expiry-critical SKUs**, the flow additionally captures an expiry date once per batch, applied to every unit bound in that session. This is what makes true FEFO possible in Mode B and impossible in Mode A.
- **M1.4.2.8** Binding a plate and putting the unit away are **one action, not two**. The bind resolves the SKU, the SKU resolves the basket, and the screen shows **PUT IN → `UT5-A-3-02`** immediately. The staffer never scans the same unit twice.

##### M1.4.3 Where labelling happens
- **M1.4.3.1** Mode B labelling is **expected at the hub** during break-bulk (§5.1). A darkstore receiving a labelled transfer scans plates that are already bound and does no labelling at all.
- **M1.4.3.2** Darkstore labelling remains supported for direct-from-brand deliveries (M3.1 scenario 2), with the same screens. It is a fallback, not the design point.

##### M1.4.4 Batch binding — an optimisation to evaluate, not a v1 commitment
Because rolls are sequential, a staffer could apply 40 labels then scan only the **first and last**, binding the whole range in two scans instead of forty. That removes most of the 5.5–11 hours. It breaks if any label in the run is discarded, misapplied or skipped, and it removes the per-unit verification that justified anonymous rolls in the first place. Flagged in §16 for a decision after the first real labelling session is timed.

#### M1.5 Acceptance criteria
- Importing the 108-row Wardah CSV creates 108 SKUs with correct categories in one action.
- Registering the same barcode to a second SKU is rejected with the conflicting SKU named.
- A bulk scan of 50 identical units (Mode A) produces one list row showing ×50, not 50 rows.
- Binding 50 plates (Mode B) produces 50 tracked units, each with a location, in one session with no typing.
- Scanning an already-bound plate is blocked and names its current SKU.
- A staffer moving between a Mode A and a Mode B brand sees the same screen shapes and the same scan feedback.

---

### M2 — Location & Basket Configuration *(Admin, Supervisor)*

**Purpose.** Model the physical racking, and bind SKUs to baskets at locations.

#### M2.1 Site and rack setup
- **M2.1.1** Admin creates a site: code, name, address, type (`hub` | `darkstore`), active flag.
- **M2.1.2** Admin creates racks under a site: rack letter, number of levels (default 5), level width in metres (default 1.0). Level count and width are configurable because not every station will get the standard rack.
- **M2.1.3** The WMS generates locations from the rack definition, and derives per-level position capacity from basket sizes placed on it.
- **M2.1.4** A level can be flagged **open shelf**, giving it a single position `00` with no basket and no capacity check.
- **M2.1.5** A **bulk rack generator** creates the standard 7-rack / 5-level layout for a new station in one action, so opening station 8 takes a minute, not an afternoon.

#### M2.2 Slot assignment (pre-selected basket per SKU)
- **M2.2.1** Admin/Supervisor assigns a SKU to a basket at a location: choose SKU → system recommends basket size and suggests a free location per the §7.3 rules → user confirms or overrides.
- **M2.2.2** **One SKU per basket, one basket per location**, both enforced by unique constraint. Attempting to assign a second SKU to an occupied basket is refused with the occupying SKU named.
- **M2.2.3** A SKU may have **only one active slot per site**. Moving it is an explicit *Relocate* action that writes a movement, not an edit.
- **M2.2.4** Assignment screen shows a **visual rack map** — a grid of racks × levels × positions, colour-coded free / occupied / over-capacity — so a supervisor can see the station at a glance rather than reading a table of 118 rows.
- **M2.2.5** Bulk slotting: given a brand and a site, generate a full proposed slot plan for all its SKUs, present it as a reviewable table, apply on confirm. This is how a 118-SKU brand gets slotted at a new station.
- **M2.2.6** Print basket labels for a site, a rack, or a single basket.

#### M2.3 Creating a new basket during inbound

Required by the product owner: putaway must not dead-end when a SKU has no home yet.

- **M2.3.1** When an inbound scan resolves to a SKU with **no slot at this site**, the app offers **Create basket now** inline, without leaving the inbound flow.
- **M2.3.2** The inline flow asks only: basket size (with the recommendation pre-selected) and location (with a suggested free location pre-selected, changeable by scanning a location label or picking from the rack map).
- **M2.3.3** On confirm, the slot is created, the label is queued for printing, and the inbound flow resumes at the same unit. Total interaction: two taps in the common case.
- **M2.3.4** Slots created this way are tagged `created_during_inbound` so a supervisor can review ad-hoc slotting decisions later.

#### M2.4 Acceptance criteria
- Generating a standard station produces 7 racks × 5 levels with correct position capacity.
- Assigning an occupied basket is refused, naming the occupant.
- A SKU with no slot can be given one mid-inbound in ≤ 2 taps and the flow continues.
- The rack map renders 7 racks × 5 levels legibly on a 1366×768 laptop screen.

---

### M3 — Inbound *(Hub Operator, Station Staff)*

**Purpose.** Receive goods, resolve them to SKUs, and direct them to baskets.

#### M3.1 The two triggers

The product owner defined two restocking paths. They differ in **where barcode registration happens**, and that difference drives the whole module.

**Scenario 1 — Brand delivers to the Ninja hub (Logos).**
1. Hub receives loose mixed cartons from the brand.
2. **The hub registers barcodes** (M1.3) for any SKU not yet known.
3. Hub receives units against a receipt, decants, and builds station-ready totes.
4. Hub ships totes to darkstores as a **Transfer** (M4).
5. At the darkstore, **staff only scan** — every barcode is already known. No registration.

**Scenario 2 — Brand delivers directly to a darkstore.**
1. The darkstore receives the cartons.
2. **Darkstore staff must register barcodes themselves** (M1.3), inline in the inbound flow.
3. Then receive and put away as normal.

The app must make the difference obvious. The receiving screen shows a banner: *"Barcodes already registered — just scan"* (transfer) versus *"New barcodes may need registering"* (direct-from-brand).

#### M3.2 Creating a receipt
- **M3.2.1** Staffer starts an inbound: chooses **source type** — `from_brand` or `from_hub_transfer` — and brand. A transfer receipt is opened by scanning the transfer reference from the tote label, which pre-loads the expected contents.
- **M3.2.2** A receipt has a status: `open` → `completed` → (`discrepancy_raised`).
- **M3.2.3** Multiple staff may work the same receipt concurrently. Scans are attributed individually.
- **M3.2.4** A receipt records `received_at`, and the app displays a **24-hour countdown** against the discrepancy-raising deadline once it is completed. This is a direct response to the "raise within 24 h or the station bears the loss" rule.

#### M3.3 The receiving scan loop

The core interaction. Optimised for the 4,950-unit burst.

- **M3.3.1** Staffer scans a unit.
- **M3.3.2** The system resolves barcode → SKU and immediately shows, full width:
  - Product photo, large
  - Full SKU name
  - **PUT IN → `UT5-A-3-02`** in the largest type on the screen, with rack letter and level visually emphasised
  - Current quantity in that basket, and remaining capacity
- **M3.3.3** Quantity capture depends on the SKU's identity mode (§5.1), and the staffer is never asked which mode they are in — the screen simply behaves correctly:
  - **Mode A, scan-each** — one scan = one unit. Slowest, most accurate. Default for the pilot.
  - **Mode A, scan-then-count** — scan once, then enter a quantity on a large numeric keypad with +/− steppers. Much faster on a carton of 24. Default once staff are trained.
  - **Mode B** — one scan = one specific unit, always. There is no quantity to enter, because the count is the number of plates bound. Unlabelled goods arriving in Mode B route into the labelling flow (M1.4.2), which puts them away in the same action.
- **M3.3.4** **Unknown barcode** → the app offers, as three large buttons: *Register to an existing SKU* (M1.3, inline, returns here), *Flag for supervisor*, or *Skip*. It never dead-ends and never asks the staffer to type a barcode.
- **M3.3.5** **No slot for this SKU at this site** → offer *Create basket now* (M2.3).
- **M3.3.6** **Over capacity** → warn, but allow with a reason. Physical reality beats the model; the warning is data for the supervisor, not a block.
- **M3.3.7** A running session total is always visible: units received this session, by SKU.
- **M3.3.8** Undo the last scan, always available, one tap.

#### M3.4 Completing the receipt
- **M3.4.1** On completion the app shows a summary: SKUs touched, units received, any flagged items, session duration.
- **M3.4.2** For a **transfer** receipt, the app shows expected vs received per SKU and highlights variances. This is the discrepancy report.
- **M3.4.3** Completion writes `StockMovement` rows of type `receipt_in` and updates balances.
- **M3.4.4** The updated available-to-sell figure is queued for push to the POS (§9).
- **M3.4.5** Optional: attach photos to the receipt (pallet condition, damaged carton) for the discrepancy claim.

#### M3.5 Acceptance criteria
- A receipt of 500 units across 30 SKUs completes without the staffer typing anything.
- An unknown barcode is registerable inline and the flow resumes at the same unit.
- The putaway location is legible from 1.5 m away.
- Receiving the same physical unit twice via a double-scan within 300 ms counts once.
- A transfer receipt shows expected vs received per SKU on completion.

---

### M4 — Transfer: Hub → Darkstore *(Hub Operator)*

**Purpose.** Move stock from Logos to a station, so that the station-side receive is a pure scan with no registration.

- **M4.1** Hub Operator creates a transfer: destination site, brand, optional target quantities per SKU (from a replenishment suggestion, see M4.6).
- **M4.2** Picking at the hub follows the same guided scan loop as M5 — the hub has its own racks and locations and is modelled as a site like any other.
- **M4.3** On dispatch the transfer is sealed: it gets a reference code, a printable **tote/manifest label** carrying a scannable transfer reference, and its contents are frozen.
- **M4.4** Dispatch writes `transfer_out` movements; hub balance drops. Stock sits in a virtual `in_transit` location owned by the destination site, so it is never invisible.
- **M4.5** At the darkstore, scanning the transfer reference opens a pre-loaded inbound receipt (M3.2.1). Received quantities are compared against dispatched quantities and the variance is the discrepancy report.
- **M4.6** **Replenishment suggestion** (advisory, not automated ordering): for a destination site, list SKUs whose on-hand is below a configurable threshold, with a suggested transfer quantity to bring them to target. This replaces the Google-Sheet-plus-WhatsApp mechanism inherited from Malaysia. It suggests; a human decides.

**Acceptance criteria.** Stock dispatched from the hub and not yet received is visible as in-transit and counted in neither site's available-to-sell. A station receive of a transfer requires zero barcode registration.

---

### M5 — Pick, Pack & Outbound *(Station Staff)*

**Purpose.** Turn a POS order into a guided pick, verify the right SKU leaves the shelf, and decrement stock.

#### M5.1 Order intake
- **M5.1.1** The WMS receives an order from the POS (§9). For v1 a **dummy order generator** stands in — see §9.3.
- **M5.1.2** An order carries: external order reference, site, brand, order lines (SKU + quantity), created timestamp, and a priority/deadline if the POS supplies one.
- **M5.1.3** On receipt, the WMS **allocates** stock: available-to-sell drops immediately, before picking starts, so two concurrent orders cannot both be promised the last unit.
- **M5.1.4** If a line cannot be allocated (insufficient on-hand), the order is accepted but the line is flagged **short**. Short-pick resolution is an exception flow, deferred (§15).

#### M5.2 The pick task
- **M5.2.1** The WMS generates a pick task and **sequences the lines by pick path**: rack letter, then level, then position, so the picker walks the aisle once in one direction.
- **M5.2.2** A picker **claims** a task. A claimed task is invisible to other pickers. Claims expire after a configurable idle timeout and return to the pool.
- **M5.2.3** The pick screen shows **one line at a time**:
  - **GO TO → `UT5-A-3-02`**, largest element, rack letter and level emphasised
  - Product photo, large
  - Full SKU name
  - **TAKE → 2**, the quantity, unmissable
  - Progress: *line 3 of 7*
- **M5.2.4** The picker takes the units and scans, which is the shade-confusion gate — shade 07 versus 08 is caught here and nowhere else:
  - **Mode A** — scan **one** unit to confirm the SKU is right.
  - **Mode B** — scan **every** unit taken. Each plate is checked to be the right SKU *and* to be currently resident in that location, then marked outbound individually. This is the flow the original brief described: the specific barcode leaves the list of items in storage.
- **M5.2.5** **Wrong SKU scanned** → red, loud, blocking. The screen states what was scanned and what was expected, both with photos. The picker cannot advance. No override for staff; a supervisor override is an exception flow (§15).
- **M5.2.6** In Mode A, for quantity > 1 the picker confirms the count on a large stepper after the identity scan. (Scanning each unit is available as a stricter site-level setting.) In Mode B the count is the number of plates scanned and there is nothing to confirm.
- **M5.2.6b** **Mode B plate anomalies** are blocking and named plainly: a plate already outbound, a plate belonging to another site, or a plate the system believes sits in a different basket. Each states what it found and tells the picker to call a supervisor.
- **M5.2.7** Line confirmed → advance automatically to the next line. No "next" button to hunt for.
- **M5.2.8** Task complete → a summary screen, then hand off to the POS packing ticket. The POS keeps ownership of the receipt, the bagging and the compliance photo.

#### M5.3 Stock effects
- **M5.3.1** Confirming a pick line writes a `pick_out` movement and decrements on-hand at that location.
- **M5.3.2** Allocation is released as it converts to a pick.
- **M5.3.3** On task completion the WMS recomputes available-to-sell for every affected SKU and queues the POS push (§9).
- **M5.3.4** **Double-deduction guard.** The POS already auto-deducts on order completion. If both systems deduct, stock halves. §9.1 settles who owns the number; until that is agreed with the Hiryu team it is the highest-severity integration risk in this document.

#### M5.4 Acceptance criteria
- A 7-line order is sequenced so the picker never walks backwards past a rack.
- Scanning the wrong shade blocks the line and shows both products side by side.
- Two pickers cannot claim the same task.
- Two concurrent orders for the last 3 units of a SKU cannot both be fully allocated.

---

### M6 — Stock Opname *(Station Staff, Supervisor)*

**Purpose.** Weekly physical count, basket by basket, with a variance report.

Because one basket holds one SKU (§5.5), a count is always scoped to a single product. What the count *produces* depends on the identity mode:

- **Mode A** — *select a basket, scan everything in it, compare the tally to expected.* The output is a quantity variance.
- **Mode B** — the system holds a list of the exact plates it believes are in that basket. Scanning works down that list and the report names **precisely which units are missing**. This is the flow the original brief described, and in Mode B it is literal.

#### M6.1 Session setup
- **M6.1.1** Supervisor creates an **opname plan** for a site: all baskets, or filtered by rack, by brand, or by expiry tier. A weekly full-station plan is the default.
- **M6.1.2** A plan shows progress: baskets counted, baskets remaining, variances found.
- **M6.1.3** Staffer opens *Stock Opname*, selects a plan, and sees the list of uncounted baskets ordered by pick path.

#### M6.2 Counting a basket
- **M6.2.1** Staffer selects a basket — by scanning the basket label (preferred) or tapping it in the list.
- **M6.2.2** **The basket is claimed for that staffer.** Claimed baskets show as *being counted by [name]* to everyone else and cannot be opened concurrently. This is the direct answer to concurrent staff on one station. Claims expire on a configurable idle timeout.
- **M6.2.3** **Expected quantity is hidden by default.** Showing it invites confirming the number instead of counting it. A supervisor-only setting can reveal it.
- **M6.2.4** The screen shows: basket location, product photo, full SKU name, and a large live counter starting at 0.
- **M6.2.5** Staffer scans each unit. The counter increments. Every scan is validated against what the basket should hold:
  - correct SKU (Mode A) or expected plate (Mode B) → green, counter +1
  - **Mode B, a plate the system expected elsewhere** → green for the count, but recorded as **found out of place**, which is a finding worth as much as a missing one
  - **different SKU scanned** → amber, recorded as a **foreign item** in this basket, not counted toward the expected SKU. Foreign items are a real and common finding, and the system must capture them rather than reject them.
  - unknown barcode or unbound plate → amber, recorded as unidentified
- **M6.2.6** A manual quantity entry is available for baskets where scanning each unit is impractical, tagged `count_method = 'manual'` so it is visible in reporting.
- **M6.2.7** Staffer presses **Finish basket**. Only then does the system reveal expected vs counted and the variance.
- **M6.2.8** On a variance, the staffer is prompted once to **recount**. A confirmed variance proceeds; the recount is recorded.
- **M6.2.9** Finishing releases the claim and moves to the next basket in path order.

#### M6.3 Variance handling and reporting
- **M6.3.1** A session produces per basket: SKU, expected, counted, variance, foreign items, who counted, when, method.
- **M6.3.2** The plan-level report lists every variance sorted by absolute value, and by value in Rupiah using the SKU price. A supervisor triages the top of that list, not all 118.
- **M6.3.3** **Variances do not adjust stock automatically.** A supervisor reviews and approves adjustments, with a reason code (`count_correction`, `damage`, `theft`, `system_error`, `found`). Approval writes an `adjustment` movement.
- **M6.3.4** Approved adjustments trigger a POS push (§9).
- **M6.3.5** Reports export to CSV.
- **M6.3.6** History is retained per basket so a repeatedly-shrinking SKU is visible as a pattern rather than a series of one-off variances.

#### M6.4 Acceptance criteria
- Two staff cannot count the same basket at the same time; the second sees who holds it.
- Expected quantity is not visible before **Finish basket**.
- A foreign SKU scanned into a basket is recorded, not silently rejected.
- A full 118-basket station count is completable within one shift by two staff.
- No stock changes until a supervisor approves.

---

### M7 — Stock Visibility & Admin *(All roles, scoped)*

- **M7.1** **Station dashboard**: on-hand by SKU for this site, sortable, searchable, with location, expiry tier, last counted date, and days since last movement.
- **M7.2** **Find a SKU**: search by name or scan a barcode → returns location, on-hand, and a photo. The single most-used screen after the guided flows.
- **M7.3** **Low-stock view**: SKUs below their reorder threshold, feeding M4.6.
- **M7.4** **Movement history**: per SKU or per location, the immutable ledger, filterable by type, date and person.
- **M7.5** **Cross-site view** (Admin): on-hand by SKU across all sites plus in-transit.
- **M7.6** **User management**: map SSO email → role → site(s).
- **M7.7** **Audit log**: every master-data change, barcode bind/unbind, slot change, adjustment approval, and override, with actor and timestamp.
- **M7.8** **Never-counted / stale-count report**: baskets not counted in N days.

---

### M8 — Training Mode *(All roles)*

**Purpose.** A complete, isolated copy of the warehouse that behaves exactly like the real one and touches nothing real. It serves two audiences that turn out to want the same thing:

- **New staff**, who need to make every mistake once before they make it on live stock. Turnover is high and the training target is 30 minutes to first unassisted pick (§17) — that target needs somewhere to be met.
- **The development team**, who need to build and test all seven modules before the POS integration exists and before a single rack is installed.

This also repairs a flaw in §9.3: a dummy order generator that consumes **real** stock is not a test harness, it is a way to corrupt a live balance. Test orders belong in a training site.

#### M8.1 How isolation works
- **M8.1.1** A site carries an `is_training` flag. A training site is a **full site** — its own racks, levels, locations, baskets, slot assignments, inventory, receipts, orders, pick tasks and opname plans.
- **M8.1.2** Isolation is free, because every query in the system is already scoped by site id (§10.2.5). Training is not a parallel code path; it is a site with a flag, which is why it cannot drift from real behaviour.
- **M8.1.3** **Master data is shared, not copied.** Training uses the real brands, the real SKU names and the real barcodes. A staffer practises finding *Glasting Liquid Lip 07 Rouge Flare*, not "Test Product 3". This is the whole point — the training is only worth anything if the confusable shades are the real confusable shades.

#### M8.2 Guard rails
These are hard rules enforced at the service layer, not conventions:
- **M8.2.1** **A training site never pushes to the POS.** The push is suppressed at the outbound edge, so no route into it can leak.
- **M8.2.2** Training sites are excluded from cross-site reporting, low-stock views and replenishment suggestions unless explicitly asked for.
- **M8.2.3** Transfers may not cross the training boundary in either direction.
- **M8.2.4** All movements at a training site are tagged, so a mis-scoped query is visible in the ledger rather than silent.
- **M8.2.5** **Reset is impossible on a non-training site.** Not discouraged, not permission-gated — refused, on the site flag, in the service.

#### M8.3 Reset and scenarios
- **M8.3.1** **Reset** restores a training site to a known state in one action: stock back to fixture quantities, receipts and orders cleared, opname plans cleared, plates rebound. Deterministic — the same reset always produces the same warehouse.
- **M8.3.2** **Scenarios** are named fixtures a trainer or a developer loads deliberately, each rehearsing one thing that goes wrong:

  | Scenario | What it sets up | Teaches / tests |
  |---|---|---|
  | `clean` | Every basket matches its expected quantity | The happy path, first-day walkthrough |
  | `variance` | Three baskets seeded short, one over | Opname counting and the variance reveal |
  | `short_pick` | An order line whose basket is physically empty | E8, the most expensive real failure |
  | `wrong_shade` | An order for Glasting 07 with 08 sitting in the 07 basket | The pick scan gate, and why it exists |
  | `unknown_barcode` | Goods whose barcode is not registered | Inline registration during inbound |
  | `no_slot` | A SKU with no basket at this site | Create-basket-during-inbound (M2.3) |
  | `mode_b` | An unbarcoded brand with plates to apply | Labelling, binding, plate-level pick and opname |
  | `contention` | Two claimable pick tasks, two claimable baskets | Concurrency (§10.2) with two staff on one station |

- **M8.3.3** A scenario loads in seconds and prints the fixture it created, so a trainer knows what the answer is supposed to be.

#### M8.4 In the interface
- **M8.4.1** Training mode is **impossible to be in by accident**. The whole shell changes: a persistent banner, a distinct edge treatment on every screen, and the site name shown at all times.
- **M8.4.2** Switching in or out is deliberate and never silent.
- **M8.4.3** A staffer's training activity is recorded — flows completed, scans, errors hit — so a supervisor can see who has actually practised and who has clicked past it.
- **M8.4.4** **Printable test barcode sheets.** Because training must work without physical stock, the WMS prints A4 sheets of the real SKU barcodes. A trainee scans the sheet and the system behaves exactly as if they had scanned the product. Sheets are marked as training material so they never end up in a real receiving lane.

#### M8.5 Acceptance criteria
- A reset returns a training site to an identical state every time.
- No action taken in a training site changes any real balance or reaches the POS, verified by an automated test that fails the build.
- The development team can exercise all seven modules end to end with no POS, no scanner and no stock.
- A new staffer can complete a receive, a pick and a count in training before touching the floor.

---

## 9. POS integration

### 9.1 Ownership of the stock number — the open integration decision

Today the POS holds a stock quantity per SKU, is updated on inbound, and auto-deducts on completed orders. If the WMS also deducts on pick, the same sale is subtracted twice.

**Proposed contract, to be agreed with the Hiryu POS team:**

| Concern | Owner |
|---|---|
| Grab connectivity, menu, store registration | **POS** |
| Order ticket, receipt, compliance photo, dispatch | **POS** |
| Physical inventory: location, on-hand, counts, movements | **WMS** |
| The number listed as available on Grab | **WMS computes → POS publishes** |

Under this contract the POS **stops** auto-deducting from its own counter and instead consumes the WMS's available-to-sell. The POS remains the system of record for everything customer-facing; the WMS becomes the system of record for everything physical.

**This requires Hiryu-side change and is not within Ninja WMS's control.** It is flagged in §16 as blocking, with a fallback: if the POS cannot stop deducting, run the WMS in **shadow mode** for the pilot — WMS tracks and reports but does not push, and the two numbers are reconciled daily by hand until the divergence is understood. That is a deliberate pilot posture, not a permanent design.

### 9.2 Interfaces

**Inbound to WMS — order created.** POS calls `POST /api/pos/orders` with external order ref, site code, brand code, and lines of `{sku_code | barcode, quantity}`. Idempotent on the external order ref. The WMS allocates and creates a pick task. A webhook is preferred; a polling fallback is acceptable if Hiryu cannot call out.

**Outbound from WMS — stock changed.** On every balance change the WMS pushes `{site, sku, available_to_sell}` to a POS endpoint. Batched, at most once per SKU per few seconds, with retry and a reconciliation sweep so a missed push self-heals.

**Outbound from WMS — pick complete.** Optional signal to the POS that physical picking is done, so the ticket can advance to packing.

All calls carry a shared secret held in Substrait secrets, never in code.

### 9.3 Dummy order generator (v1 test harness)

Required by the product owner for testing before Hiryu integration exists.

- **9.3.1** An admin screen generates a synthetic order for a chosen site: pick N random SKUs that have stock, random quantities 1–3, submit through the same `POST /api/pos/orders` endpoint the real POS will use.
- **9.3.2** A "generate a realistic burst" button creates several orders at once, to rehearse concurrent picking.
- **9.3.3** Synthetic orders are tagged `is_test = true`, are visually marked throughout the UI, and are excluded from operational reporting.
- **9.3.4** **The generator only targets training sites (M8).** An earlier draft allowed it against any site, which would have had a test order consume real stock and push a wrong number to Grab. Generating against a non-training site is refused by the service, not hidden by a flag.

Building the real integration against the same endpoint the dummy uses means the switch to live Hiryu is configuration, not a rewrite.

---

## 10. Cross-cutting requirements

### 10.1 Internationalisation
- **10.1.1** Full Bahasa Indonesia and English. **Indonesian is the default.**
- **10.1.2** Language toggle always reachable from the header, one tap, persisted per user.
- **10.1.3** No user-facing string is hard-coded. All strings live in resource files, one per locale, so a third language is a file.
- **10.1.4** Product names, brand names and location codes are **never translated**.
- **10.1.5** Indonesian is the source language for UX writing, not a translation of English. A phrase that reads naturally to a Jakarta station staffer beats a literal rendering.
- **10.1.6** Numbers use Indonesian conventions (Rp 101.000). Dates as `DD MMM YYYY`.
- **10.1.7** Copy is written at roughly a junior-high reading level. No warehouse jargon — *"Simpan di"*, not *"Lokasi putaway"*.

### 10.2 Concurrency

Ten stations, several staff per station, all in the same database.

- **10.2.1** **Claims** on pick tasks and opname baskets prevent two people working one unit of work. Claims carry an owner, a timestamp and an idle expiry.
- **10.2.2** Inventory balance updates use a row-level lock or an atomic conditional update. Two concurrent picks against the same location must serialise, never interleave.
- **10.2.3** All scan endpoints are **idempotent**, keyed on a client-generated scan id, so a retry after a timeout cannot double-apply.
- **10.2.4** Allocation is atomic: check-and-reserve in one transaction.
- **10.2.5** Every site's data is scoped by site id on every query. A staffer at UT5 must not be able to see or touch KJR's stock.

### 10.3 Scale

Derived from the space model, not guessed:

| Dimension | v1 | Headroom designed for |
|---|---|---|
| Brands | 1 (Wardah) | 10 |
| SKUs per brand | 118 | 1,000 |
| Sites | 3 → 10 | 30 |
| Baskets per site | ~118 | 500 |
| Units on hand per site | ~6,500 | 50,000 |
| Inbound burst | 4,950 units / fortnight, over 4–7 h | ~0.35 scans/sec sustained |
| Orders per site per day | est. 100–150 | 500 |
| Concurrent users | ~30 | 100 |
| Movement rows per year | ~1.5 M | 20 M |
| Live plate rows, per Mode B brand | ~65,000 (118 × 55 × 10 sites) | 1 M |
| Plate rows per year, Mode B, with turnover | ~1.5 M | 10 M |

**The load is trivial for any modern database.** The risk in this system is not throughput, it is data discipline and interaction design. Engineering effort belongs in the scan loop and the ledger, not in scaling.

The one query that must stay a single-row indexed lookup regardless of table size is **plate resolve at pick and opname**, because it sits inside the 300 ms budget (§10.4.1). Plates in terminal states (`shipped`, `written_off`) older than the retention window are moved to an archive table so the live index stays small.

### 10.4 Performance
- **10.4.1** Barcode resolve → screen update: **< 300 ms p95**. This is the number that decides whether the system is usable at 3–5 s per unit. Everything else is negotiable.
- **10.4.2** Page load on a station laptop over 4G: < 2 s.
- **10.4.3** Rack map with 7 racks renders in < 1 s.
- **10.4.4** Opname variance report for a full station: < 3 s.

### 10.5 Audit and traceability
- **10.5.1** `StockMovement` is append-only. Corrections are new rows, never edits.
- **10.5.2** Every movement carries actor email, timestamp, site, source (`scan` | `manual` | `card` | `system`) and a reason where applicable.
- **10.5.3** Balances are a projection and must be rebuildable from movements. A nightly job verifies projection against ledger and alerts on drift.
- **10.5.4** Retention: movements 3 years, audit log 3 years, photos 1 year.

### 10.6 Accessibility and device
- **10.6.1** Primary target: **shared station laptop, 1366×768**, Chrome.
- **10.6.2** Must also work on a phone browser (pilot scanning, spot checks).
- **10.6.3** Minimum tap target 48×48 px. Body text ≥ 16 px; the primary instruction on any guided screen ≥ 32 px.
- **10.6.4** Contrast ratio ≥ 4.5:1 — station backrooms are dim and screens get dusty.
- **10.6.5** Status never carried by colour alone; always colour + icon + text.
- **10.6.6** Audible feedback on scan accept/reject, with a mute toggle.

---

## 11. Data model

Flyway migrations, MySQL dialect (OceanBase wire). Indicative, not final DDL.

**Three constraints the engine imposes, which changed the design:**

1. **MySQL has no partial indexes.** `UNIQUE(barcode) WHERE active` is Postgres and will not migrate. Uniqueness that should apply only to live rows is instead achieved by keeping **only live rows** in those tables: unbinding a barcode *deletes* it, and relocating a slot *updates* it. History is not lost — it lives in `stock_movements` and `audit_log`, which is where it belonged anyway.
2. **No ENUM, no CHECK, no generated columns.** Status fields are `VARCHAR(32)` validated in the application. Changing an ENUM later is an `ALTER`, and on OceanBase a failed migration blocks every subsequent deploy until it is repaired — so V1 DDL stays conservative on purpose.
3. **No `ON DELETE CASCADE`, and no adding a column and a foreign key in one `ALTER`.** Both are documented OceanBase gotchas. Nothing here is hard-deleted anyway.

```
brands              id, code, name, active, created_at
sites               id, code, name, address, type(hub|darkstore),
                    is_training, active
brand_sites         brand_id, site_id, active

skus                id, brand_id, brand_sku_code, name_display, category,
                    product_line, unit_size, price_idr, unit_cube_cm3,
                    expiry_tier(critical|watch|stable), photo_key,
                    identity_mode(sku_barcode|unit_label),
                    label_placement_note, active
                    UNIQUE(brand_id, brand_sku_code)

barcodes            id, barcode, sku_id, registered_by, registered_at
                    UNIQUE(barcode)   -- Mode A: one barcode, one SKU.
                                      -- Unbind DELETEs the row + writes audit_log.

-- Mode B ------------------------------------------------------------------
plate_ranges        id, site_id, prefix, seq_from, seq_to, issued_by,
                    issued_at, printed_at
unit_plates         id, plate_code, range_id, site_id,
                    state(unbound|in_stock|picked|shipped|written_off),
                    sku_id, location_id, expiry_date, bound_by, bound_at,
                    last_seen_at
                    UNIQUE(plate_code)
                    INDEX(site_id, sku_id, location_id, state)
                    -- sku_id/location_id NULL while unbound
-- ---------------------------------------------------------------------------

racks               id, site_id, code, level_count, level_width_m
levels              id, rack_id, level_no, is_open_shelf
locations           id, level_id, position_no, code   UNIQUE(code)
baskets             id, location_id, size(S|M|L), label_printed_at
                    UNIQUE(location_id)               -- one basket per location

slot_assignments    id, sku_id, site_id, basket_id, created_by,
                    created_during_inbound, updated_at
                    UNIQUE(basket_id)          -- one SKU per basket
                    UNIQUE(site_id, sku_id)    -- one slot per SKU per site
                    -- the row IS the current slot; relocate UPDATEs basket_id
                    -- and writes relocate_out/relocate_in movements

inventory_balances  id, site_id, sku_id, location_id, qty_on_hand,
                    qty_allocated, version, updated_at
                    UNIQUE(site_id, sku_id, location_id)

stock_movements     id, site_id, sku_id, location_id, qty_delta,
                    plate_id,                        -- NULL in Mode A
                    type(receipt_in|transfer_out|transfer_in|pick_out|
                         adjustment|relocate_out|relocate_in|label_bind),
                    ref_type, ref_id, reason_code, actor_email,
                    scan_source(scan|manual|plate|system), created_at
                    -- append only; Mode B writes qty_delta ±1 AND a plate_id,
                    -- so one ledger serves both modes and balances stay
                    -- comparable across brands

inbound_receipts    id, site_id, brand_id, source_type(from_brand|from_hub_transfer),
                    transfer_id, status, opened_by, opened_at, completed_at
receipt_lines       id, receipt_id, sku_id, qty_expected, qty_received, location_id

transfers           id, from_site_id, to_site_id, brand_id, reference,
                    status(draft|dispatched|received), dispatched_at, received_at
transfer_lines      id, transfer_id, sku_id, qty_dispatched, qty_received

orders              id, external_ref, site_id, brand_id, status, is_test,
                    created_at   UNIQUE(external_ref)
order_lines         id, order_id, sku_id, qty_ordered, qty_allocated, qty_picked,
                    status(pending|allocated|short|picked)

pick_tasks          id, order_id, site_id, status, claimed_by, claimed_at,
                    completed_at
pick_lines          id, pick_task_id, order_line_id, sku_id, location_id,
                    sequence_no, qty_required, qty_picked, status

opname_plans        id, site_id, scope_json, status, created_by, created_at
opname_sessions     id, plan_id, basket_id, sku_id, claimed_by, claimed_at,
                    qty_expected, qty_counted, variance, count_method,
                    recounted, status, finished_at
opname_foreign      id, session_id, barcode, sku_id_resolved, qty

users               id, email, name, role(admin|supervisor|staff|hub_operator),
                    default_site_id, active   UNIQUE(email)
user_sites          user_id, site_id

audit_log           id, actor_email, entity, entity_id, action, before_json,
                    after_json, created_at

scan_events         id, idempotency_key, endpoint, response_json, created_at
                    UNIQUE(idempotency_key)
                    -- a replay returns the stored response, never re-applies

-- training (M8) -------------------------------------------------------------
training_fixtures   id, site_id, scenario, payload_json, loaded_by, loaded_at
training_activity   id, site_id, actor_email, flow, event, detail_json,
                    created_at
-- ---------------------------------------------------------------------------
```

**Indexes that matter:** `barcodes(barcode)` — hit on every single scan, must be a single-row lookup. `inventory_balances(site_id, sku_id)`. `stock_movements(site_id, sku_id, created_at)`. `pick_lines(pick_task_id, sequence_no)`.

---

## 12. API surface

All under `/api`, same-origin, per the Substrait routing model.

```
GET    /api/me                             who am I, role, sites
GET    /api/health                         readiness probe (unauthenticated)

# master data
GET    /api/brands
POST   /api/brands
GET    /api/skus?brand&q&site
POST   /api/skus
POST   /api/skus/import                    CSV, preview + confirm
POST   /api/skus/{id}/photo                -> object storage
GET    /api/scan/resolve?code=             THE hot path — returns either a SKU
                                           (Mode A barcode) or a unit (Mode B
                                           plate), so callers scan once and the
                                           server decides what it was
POST   /api/barcodes/register              Mode A: bulk bind to one SKU
DELETE /api/barcodes/{id}                  supervisor, with reason

# mode B — license plates
POST   /api/plates/ranges                  issue + export a print file
GET    /api/plates/stock?site              unbound plates remaining
POST   /api/plates/bind                    idempotent; binds + puts away
POST   /api/plates/{code}/unbind           undo, supervisor beyond the session
GET    /api/plates/{code}                  state, SKU, location, history

# locations
GET    /api/sites
POST   /api/sites/{id}/racks/generate      standard 7-rack layout
GET    /api/sites/{id}/rack-map
POST   /api/slots                          assign SKU -> basket
POST   /api/slots/bulk-plan                propose a full slot plan
POST   /api/slots/{id}/relocate
GET    /api/baskets/{id}/label             printable

# inbound
POST   /api/receipts
POST   /api/receipts/{id}/scan             idempotent
POST   /api/receipts/{id}/complete
GET    /api/receipts/{id}/summary

# transfer
POST   /api/transfers
POST   /api/transfers/{id}/dispatch
GET    /api/transfers/by-reference/{ref}
GET    /api/sites/{id}/replenishment-suggestions

# outbound
POST   /api/pos/orders                     POS + dummy generator both use this
GET    /api/pick-tasks?site&status
POST   /api/pick-tasks/{id}/claim
POST   /api/pick-lines/{id}/confirm        idempotent, scan-verified
POST   /api/pick-tasks/{id}/complete

# opname
POST   /api/opname/plans
GET    /api/opname/plans/{id}/baskets
POST   /api/opname/sessions                claims a basket
POST   /api/opname/sessions/{id}/scan      idempotent
POST   /api/opname/sessions/{id}/finish
GET    /api/opname/plans/{id}/variance-report
POST   /api/opname/adjustments/approve     supervisor

# visibility
GET    /api/inventory?site&brand&q
GET    /api/inventory/find?barcode=
GET    /api/movements?sku&location&from&to

# training (M8) — every route refuses a non-training site
GET    /api/training/scenarios             the fixture library
POST   /api/training/reset                 site -> known state, deterministic
POST   /api/training/load                  site + scenario
POST   /api/training/orders/generate       test orders; training sites only
GET    /api/training/barcode-sheet         printable test barcodes
GET    /api/training/activity?site&who     who has actually practised
```

Every endpoint declares a typed response model, so the OpenAPI spec Substrait harvests carries real field names and types — which is what lets other Ninja teams build against this app through the Substrait API Library.

---

## 13. Technical architecture on Substrait

Against the Substrait upload-mode deploy contract:

| Element | Choice | Why |
|---|---|---|
| **Backend** | Python 3.12 + FastAPI, `cicd/Dockerfile.backend`, `EXPOSE 8000`, `GET /health`, API under `/api` | The scaffold default; typed responses give a self-describing API |
| **Database** | `database: oceanbase` in `substrait.yaml` | Production-grade, HA, nightly platform backups, Database-tab tooling. Stock ledgers are exactly the thing you would be upset to lose. MySQL wire → `asyncmy` driver, `%s` placeholders |
| **Migrations** | Flyway SQL at `backend/resources/db/migration/V*.sql`, MySQL dialect | Contract requirement. No DDL from application code. Watch the OceanBase DDL restrictions |
| **Frontend** | React + Vite + Tailwind, `cicd/Dockerfile.frontend`, served on port 80, calls `/api` relatively | Scaffold default; Tailwind makes the large-target, high-contrast UI cheap to build consistently |
| **Object storage** | `object-storage: {}` | Product photos, receipt condition photos, printable label PDFs. Keys prefixed by brand/site; prefix re-validated on every read, write and sign |
| **Auth** | Google SSO via the portal Access tab; read `X-Forwarded-Email` | No login code, no password storage, attributable scans |
| **Redis** | Not in v1 | Claims and locks are handled by database rows with expiry. Adding `redis: {}` later is a one-line manifest change if claim contention proves it necessary |
| **Kafka** | Not in v1 | The POS push is a small retrying outbox table. Kafka is not warranted at 150 orders/site/day |
| **Secrets** | `backend/.env.example` declares `POS_WEBHOOK_URL`, `POS_SHARED_SECRET # secret`, `ENABLE_TEST_ORDER_GENERATOR` | Platform pre-creates them; real values set in the portal or via `/substrait:env` |

`substrait.yaml`:

```yaml
description: >
  Warehouse management for Ninja Van's GrabMart Kilat fulfilment. Station staff
  receive brand stock, put it away into barcoded baskets on racks, pick guided
  orders from the POS, and run weekly stock counts. Built for multi-brand,
  multi-station quick commerce at 100+ SKUs per brand.

database: oceanbase

services:
  object-storage: {}
```

**Frontend architecture notes**

- A **scan input handler** as a single shared hook. Every scanning screen uses it. It owns focus management, keystroke-timing detection, debounce, and audio feedback. Getting this right once is most of the usability of the product.
- A **guided-task shell** component: one instruction, one big target, progress indicator, undo. M3, M4, M5 and M6 are all instances of it. Building it once keeps the four flows feeling identical to a staffer who learns one and then meets the others.
- i18n via a lightweight provider with JSON resource files, `id.json` and `en.json`.
- No client-side routing state that a page refresh would lose mid-task — a dropped connection or an accidental refresh must resume, not restart.

---

## 14. Release plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Foundations** | Substrait scaffold, schema + migrations, SSO, roles, ledger, idempotency, **M8 training site + reset + scenarios**, i18n shell, scan hook, guided-task shell | A staffer can log in, see Indonesian, and scan into a training site that resets cleanly |
| **P1 — Master data** | M1.1–M1.3 brand/SKU/barcode + CSV import + M2 locations/slots/rack map/labels | 118 Wardah SKUs imported, barcoded, slotted at one site, labels printed |
| **P2 — Inbound** | M3 full flow, both scenarios, inline registration, inline basket creation | A 500-unit receipt completes with no typing and correct balances |
| **P3 — Outbound** | M5 + §9.3 dummy order generator | A dummy order is picked end to end with a wrong-shade scan correctly blocked |
| **P4 — Opname** | M6 including claims, variance, supervisor approval | Two staff count one station concurrently without collision |
| **P5 — Transfer & visibility** | M4, M7 dashboards and reports | Hub → darkstore transfer received with a variance report |
| **P5b — Mode B labelling** | M1.4 plate ranges, labelling flow, plate-aware pick and opname | An unbarcoded SKU is labelled, put away, picked and counted by plate |
| **P6 — POS integration** | Real Hiryu wiring per §9, subject to the §9.1 decision | Live order flows in; stock number agreed and reconciled |
| **P7 — Pilot** | One station, live, alongside existing process | One week, variance under an agreed threshold, staff can work unassisted |

P0–P5 are within Ninja's control. **P6 depends on the Hiryu POS team** and should be scheduled independently rather than blocking the rest.

**P5b is scheduled by brand pipeline, not by engineering readiness.** Wardah is entirely Mode A, so nothing in the pilot needs it. Build it when an unbarcoded brand is actually signed — but design the schema for it in P0 (§11 already does), because retrofitting per-unit identity onto a live ledger is the one change in this document that would be genuinely painful.

---

## 15. Exceptions NOT covered in v1

**Flagged at the product owner's explicit instruction.** These are real operational situations with no designed flow yet. Each needs a decision before, or shortly after, go-live. The system must fail *visibly* — never silently — when it meets one.

### Inbound exceptions
- **E1** Damaged units found on receipt. Where do they go, who is charged, what is the record?
- **E2** Over-receipt — more units arrive than the transfer says.
- **E3** Under-receipt discovered **after** the 24-hour window has closed.
- **E4** Unidentifiable goods: no barcode, no card, staff cannot name it.
- **E5** Wrong brand's goods delivered to a station.
- **E6** Expired or near-expiry stock arriving from the brand.
- **E7** Basket physically full when the system says there is capacity.

### Outbound exceptions
- **E8** **Short pick** — the basket is empty but the system says there is stock. Highest frequency, highest impact. Grab refunds the customer and charges the merchant, so this one has a direct financial consequence.
- **E9** Order cancelled by the customer mid-pick.
- **E10** Order cancelled after picking, before rider handover — putaway of picked stock.
- **E11** Damaged unit discovered during picking.
- **E12** Substitution — is it ever permitted? Assumed no.
- **E13** Supervisor override of a failed identity scan. Deliberately absent in v1 so that the gate cannot be trained around.
- **E14** Partial fulfilment: ship what is available versus cancel the line.
- **E15** Rider does not arrive; order sits packed.

### Opname exceptions
- **E16** Foreign SKU found in a basket — captured (M6.2.5) but its *resolution* is undefined. Where does it go, and which basket gets credited?
- **E17** Persistent negative variance on one SKU — the shrinkage escalation path.
- **E18** Count abandoned mid-basket (shift ends, staffer leaves).
- **E19** Two counts of the same basket disagreeing.
- **E20** Physical stock found in an unassigned location.

### Returns and reverse logistics
- **E21** Grab customer returns. Not modelled at all. Whether returned stock re-enters saleable inventory is a brand-commercial decision, not a system one.
- **E22** Returning stock to the brand — expiry, delisting, contract end.
- **E23** Stock write-off and its accounting treatment.

### Mode B label exceptions
- **E29** Label falls off a unit in the basket. The unit is now invisible to the system and shows as missing at opname; the loose label is a live plate with no product.
- **E30** Label applied to the wrong product — bound under the wrong locked SKU. Only discoverable at pick, when the photo and the item in hand disagree.
- **E31** Label unreadable — smudged, creased around a curve, or covered by the brand's own sticker.
- **E32** Label stock exhausted mid-delivery, with unlabelled goods on the floor and a 24-hour clock running.
- **E33** Duplicate plate codes from a printer misfeed or a reprinted roll.
- **E34** A plate scanned at a site it was never issued to — rolls migrating between stations.
- **E35** Customer-facing objection: the brand or Grab refuses a Ninja sticker on retail packaging after labelling has already started.
- **E36** Unlabelled units discovered in a Mode B basket during opname — they exist physically but have no identity to count.

### System exceptions
- **E24** Network loss mid-task, given the online-only decision (§5.2).
- **E25** POS and WMS disagreeing on stock (§9.1) — reconciliation procedure.
- **E26** Duplicate order reference from the POS.
- **E27** Order arriving for a SKU with no slot at that site.
- **E28** Barcode registered to the wrong SKU and discovered only after picking has begun.

**Design principle for all of the above until they are specified:** the WMS must **stop and flag for a supervisor** rather than guess. A blocked staffer who calls a supervisor is a recoverable situation. A system that quietly guesses corrupts the ledger, and the ledger is the whole point.

---

## 16. Open questions

Ordered by how much they block.

### Blocking
- **Q1 — Who owns the stock number, WMS or POS?** (§9.1) Without agreement the two systems double-deduct. Needs the Hiryu POS team.
- **Q2 — Does Hiryu expose an order webhook, and can it consume a stock push?** If it can only be polled, the WMS needs a poller and the design of §9.2 changes.
- **Q3 — Do Wardah units actually carry a scannable EAN-13, on every SKU?** Mode A for all 118 SKUs (§5.1) assumes yes. **A physical check of a sample carton settles this in ten minutes and should happen before P1.** Any SKU that fails drops to Mode B and inherits its labelling cost, so this check also sizes the labour.
- **Q4 — Do all station staff have Ninja Google accounts usable on a shared device?** The SSO decision (§5.4) depends on it. If not, PIN auth must be built and the estimate grows.

- **Q3b — Will an unbarcoded brand permit a Ninja sticker on its retail packaging?** Mode B (§5.1, M1.4) is a build task only after it is a commercial agreement. Needed: written sign-off on placement, adhesive, removability, and whether the sticker may sit on the primary artwork face. Without it, Mode B is unbuildable and the fallback is a scan-card book that verifies nothing. **This should be settled before the first unbarcoded brand signs, not after.**

### High
- **Q3c — Where does Mode B labelling happen, and who pays for the hours?** §5.1 costs it at 5.5–11 h per 4,950-unit delivery. The recommendation is hub-only during break-bulk. If a brand insists on delivering direct to stations, that labour lands on the least-trained staff and the commercial model should reflect it.
- **Q3d — Is batch range-binding (M1.4.4) acceptable?** It removes most of the labelling hours and most of the verification. Decide after timing one real session, not before.
- **Q5 — Connectivity survey at KJR, UT5, MA5.** Specifically inside the cooled, partitioned storage corner, not at the front desk. Decides whether §5.2 holds.
- **Q6 — Is the "break bulk once at Logos" proposal accepted?** If yes, scenario 1 is the main path and darkstore registration is a rare fallback. If no, every station registers barcodes and M1.3 must be trainable to the least experienced staff.
- **Q7 — Case pack and carton dimensions from Wardah.** Currently assumed 24 for lip/eye, 12 elsewhere. Drives the scan-then-count default quantities.
- **Q8 — Sales per SKU per day, from Grab, split by hub.** The `55 units per SKU` figure that sizes every basket rests on an assumed 3/day.
- **Q9 — Who owns FEFO for the 11 critical SKUs**, given the system cannot enforce it at unit level (§5.1)? Proposed: coloured label + handwritten expiry month + monthly sweep. Needs an operational owner.

### Medium
- **Q10 — Expected order volume per station per day.** §10.3 assumes 100–150. If it is 1,000, pick-path optimisation and batch picking become real requirements rather than nice-to-haves.
- **Q11 — Is batch/wave picking needed** (one picker, several orders in one walk)? Not in v1. Depends on Q10.
- **Q12 — Shelf-life data from Wardah.** The 24–36 month figure is a category norm, not Wardah data.
- **Q13 — Label printer availability** at hub and stations, and format (A4 sheet versus thermal).
- **Q14 — Second brand identity.** Who is it, how many SKUs, when? Confirms the multi-tenant assumptions before they are load-bearing.
- **Q15 — Does the WMS need to record the compliance photo**, or does the POS remain sole owner? Currently assumed POS.
- **Q16 — Lease expiry.** UT5 and KD5 end 30 Nov 2026; KJR ends 6 Dec 2026. Two of three wave-1 stations. Not a WMS question, but it decides where this ships first.

---

## 17. Success metrics

| Metric | Target | Why |
|---|---|---|
| Pick accuracy (right SKU to the bag) | ≥ 99.5% | Shade confusion is the top refund driver |
| Inventory accuracy at weekly opname | ≥ 98% of baskets within ±2 units | Below this, the pushed stock number cannot be trusted |
| Inbound throughput | ≤ 5 s per unit, staff unassisted | Matches the 4–7 h sorting budget for a fortnightly delivery |
| Time to pick a 5-line order | ≤ 3 minutes | Quick commerce; the rider is waiting |
| Full-station opname (118 baskets) | ≤ 1 shift, 2 staff | Below this, weekly counting will not survive contact with reality |
| New staff time to first unassisted pick | ≤ 30 minutes | The turnover reality |
| Scan resolve latency | < 300 ms p95 | The number that decides whether the tool feels fast or feels like an obstacle |
| Time to onboard a new 118-SKU brand at a site | ≤ 1 day | Configuration, not a project |
| Mode B labelling throughput | ≤ 8 s per unit including application | Sets whether a 4,950-unit delivery is an 11-hour job or a two-day one |
| Mode B plate integrity at opname | ≥ 99% of expected plates found or explained | A plate that is neither on a shelf nor shipped is the Mode B failure signature |

---

## 18. Sources

- `Grab Kilat Fulfillment/HANDOFF.md` — §11 rack geometry, §14 station register, §16 loose mixed cartons and Malaysia operational learnings, §17 three-basket standard, one-basket-per-SKU rule, expiry tiering
- `Grab Kilat Fulfillment/wardah_sku_list.csv` — 108 recovered SKUs of 118, categories, prices, unit cubes
- `Wardah x GrabMart Kilat - Ninja Fulfilment/02 Space Model.xlsx` — units-per-SKU formula, basket capacities, space model
- Substrait plugin, `skills/substrait-app/SKILL.md` — deploy contract, engine choice, object storage, SSO identity model
- Product owner decisions, 3 September 2026 — §5.1 through §5.4
