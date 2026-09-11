# Ninja Kilat WMS — Product Requirements Document

| | |
|---|---|
| **Product** | Ninja Kilat WMS |
| **Version** | v2.0 — consolidated decisions |
| **Date** | 11 September 2026 |
| **Owner** | Baskoro Nugroho |
| **Status** | Decisions locked for build · open items in §17 |
| **Supersedes** | v0.1 of 3 September and its patches — archived at `docs/archive/PRD-v1.md` |
| **Platform** | Substrait · FastAPI · OceanBase · static frontend |
| **Live** | wms-test.ninjavan.apps.substrait.build |
| **Pilot** | Wardah — 118 SKUs · second brand within 3 months |
| **Scale** | 10–30 stations within 6 months |

---

## 1. Summary

Ninja Van fulfils quick-commerce orders for brands. For the **GrabMart Kilat** channel, Grab owns demand, order creation and delivery; Ninja owns the warehouse. Ninja is also starting to offer **quick-commerce-as-a-service**, taking orders directly from a brand's own channels — **WhatsApp first** — and delivering them with Ninja's own dedicated riders.

Ninja already runs a **POS** (Hiryu) connected to the Grab merchant app. It manages brands, stores and menus, takes Grab orders, prints receipts, holds the compliance photo, and deducts stock when an order completes. It works at small scale but has no racking registry, and listing stock SKU by SKU does not survive a brand the size of Wardah.

This **WMS** is the physical layer underneath. It answers four questions the POS cannot:

1. **Where does this unit go?** — inbound, putaway, rack and basket
2. **Where do I find it?** — the location a picker is sent to
3. **Is it actually there?** — scan-verified picking and weekly counts
4. **What arrived versus what was promised?** — every hop checked against the one before

The WMS never talks to Grab. It exchanges exactly **five messages** with whatever sits in front of the customer — the POS for Grab, a channel adapter for WhatsApp — and nothing else crosses that line.

---

## 2. Principles and non-negotiables

These hold across every section below. A change request that breaks one of them needs to argue against it explicitly.

- **2.1** **The WMS never talks to Grab.** The POS does. The WMS–POS interaction stays at five messages (§12).
- **2.2** **One writer per event.** The POS deducts sales, as it does today. The WMS records receipts, moves and corrections. The same unit is never subtracted by both.
- **2.3** **Every stock movement is scanned.** Picking has a scan gate with no staff-level override — an override that exists gets used, and then the gate is worthless.
- **2.4** **The ledger is append-only.** Balances are a projection of movements; negative stock is refused by construction; every scan is idempotent so a retry never double-counts.
- **2.5** **Red means failure and nothing else.** Every state carries colour *and* an icon *and* words. Staff are often high-school graduates on shared devices; the UI must be safe on day one.
- **2.6** **No free text on the warehouse floor.** Quantities come from steppers and keypads; the only input is the scan target.
- **2.7** **Bilingual.** Indonesian by default, English one tap away, on every string.
- **2.8** **Online-only, loudly.** A dropped connection blocks work visibly. A short buffer may hold scans across a blip (§15), but the system never silently degrades.
- **2.9** **Training can never touch real stock.** The training site is isolated and never reaches the POS or a channel.

---

## 3. Users, roles and surfaces

| Role | Where | Does |
|---|---|---|
| **Station staff** | Darkstore floor | Receive, put away, pick, pack, count |
| **Hub operator** | Logos / CWH | Receive from suppliers, decant, register identity, dispatch, crossdock |
| **Supervisor** | Station or hub | Exceptions only: discrepancies, stuck claims, count sign-off, rack assignment |
| **Admin** | Ninja ops | Staff, sites, racks, SKUs, configuration |

### 3.1 Two surfaces **[DECIDED]**

- **3.1.1** **Station** — large type (32 / 60 / 96 px), 64 px primary buttons, one decision per screen, a scan zone that always holds focus. Built for arm's length and a scanner gun.
- **3.1.2** **Console** — a dense desk interface with sidebar, tables, filters and a queue board. Supervisors and admins **land on the console** when they open the app; staff land on the station.
- **3.1.3** Devices are a **laptop or tablet with a USB/Bluetooth scanner gun**, sometimes an **Android phone**. Every scan screen therefore offers **camera scanning as a fallback**.
- **3.1.4** Both surfaces share one token system, both light and dark themes are real, and there is **no build step** — static HTML/CSS/JS wired by one thin layer.

---

## 4. Sites and the chain of custody

### 4.1 Two site types, one system **[DECIDED]**

The central warehouse (**CWH**, currently Logos Metrolink) runs the **same WMS** as the darkstores. That gives every hop exactly one authority for the expected quantity:

**Supplier → CWH** (expected = the supplier's reference, *if one exists*) → **CWH → darkstore** (expected = the CWH's dispatch, always) → shelf.

Even when a supplier sends no manifest, the second hop is always checkable, because the WMS produced the number itself. The chain is blind only at the very first hop.

- **4.1.1** **A CWH never publishes stock.** It is a warehouse, not a store. Only darkstores send stock levels (message 3). Enforced at the outbox edge on `site_type`.
- **4.1.2** A CWH does not pick customer orders, run a pick queue or publish stock. It receives, decants, registers identity, stores, crossdocks and dispatches.
- **4.1.3** **Each hop raises its own discrepancy.** The CWH raises shortfalls against the supplier; the darkstore raises them against the CWH. Both have **24 hours** from receipt, after which the station bears the loss.

### 4.2 Physical layout

- **4.2.1** A standard darkstore holds **7 racks × 5 levels × 5 positions = 175 slots** (rack 1.0 W × 0.4 D × 2.0 H m).
- **4.2.2** Locations read `SITE-RACK-LEVEL-POSITION`, e.g. `UT5-A-3-02`. Rack and level are what a person navigates by and are always visually accented.
- **4.2.3** **One basket holds one SKU.** Never two.
- **4.2.4** Baskets come in three widths — S 0.20 m, M 0.33 m, L 0.50 m. Anything larger than L goes on an open shelf level.
- **4.2.5** Inside a basket, **coloured dividers** separate each arrival (§7.4). The WMS does not model dividers.

---

## 5. Restock types

### 5.1 Four types, two axes **[DECIDED]**

| | **Store at CWH** | **Crossdock at CWH** | **Direct to darkstore** |
|---|---|---|---|
| **From supplier** | 1 · CWH stores, distributes later | 2 · passes through the CWH | 3 · supplier delivers to the darkstore |
| **From CWH** | — | — | 4 · the distribution leg of type 1 |

- **5.1.1** Every restock carries an **inbound reference** with expected quantities per SKU (§7.1), whichever the source.
- **5.1.2** **Crossdock** stock is received at the CWH but never put away. It sits in a **staging location** and must leave within a maximum dwell — **7 days, placeholder** — after which it is flagged. Without that rule crossdock silently becomes storage.
- **5.1.3** Type 4 is the same transfer mechanism in every case: the CWH dispatches with a quantity; the darkstore receives against it.

### 5.2 Restock requests

- **5.2.1** When everything a darkstore holds for a SKU — rack plus overflow — falls to its **restock point** (§8.3), the WMS raises a restock request to the CWH.
- **5.2.2** A supervisor confirms or adjusts the quantity and sends it. This formalises what Malaysia does today with a spreadsheet and WhatsApp.

---

## 6. Product identity

### 6.1 Two identity modes **[DECIDED]**

| | **Mode A — brand barcode** | **Mode B — Ninja license plate** |
|---|---|---|
| When | The brand prints a scannable barcode | The brand prints none, or it is unreadable |
| A scan means | "This is Glasting Lip 07" — the SKU | "This is unit NJ0000041827" — one physical unit |
| Stock is held as | A quantity per SKU per location | Individually tracked units |
| Pilot | **Wardah, all 118 SKUs** | None yet |

- **6.1.1** One barcode maps to exactly one SKU, ever. A SKU may carry several barcodes.
- **6.1.2** Mode B labels are pre-printed anonymous rolls; a plate is **bound** to a SKU by scanning it while that SKU is selected on screen. This needs brand sign-off on placement before use.

### 6.2 Registering barcodes

- **6.2.1** The staffer **selects the SKU first**, then scans units in bulk; each unrecognised barcode is bound to that SKU.
- **6.2.2** Registration happens where the stock first arrives: at the **CWH** for types 1 and 2, at the **darkstore** for type 3. Downstream sites only scan.
- **6.2.3** An unknown barcode during inbound opens a two-tap register fork, never a dead end.

### 6.3 SKU onboarding

- **6.3.1** An admin registers each SKU with brand, name, size, unit cube and category.
- **6.3.2** An admin uploads a **product photo** during onboarding. It is **optional for go-live**; a placeholder shows until it exists. Spec: 1:1, at least 800 × 800, product centred on white, filename the lowercase SKU code. For 118 near-identical shades the photo is the primary disambiguator on the pick and wrong-item screens.
- **6.3.3** **A new SKU without a rack at a site appears on the supervisor's "needs a rack" list** until someone assigns one (§8.2). A SKU with no pick face can be received but never picked.

---

## 7. Inbound

### 7.1 Inbound reference **[DECIDED]**

- **7.1.1** Before stock arrives, an **inbound reference** is registered: a reference number, the source (supplier, CWH dispatch or crossdock) and the expected quantity per SKU.
- **7.1.2** During inbound scanning the screen shows progress live — **"48 of 60 scanned"** — so a shortfall is visible while the driver is still on site, not after they have gone.
- **7.1.3** **Planned inbound** runs against a reference. **Discovery inbound** — no reference exists — is still allowed: staff scan and the WMS assigns locations as it goes, but no variance can be computed.
- **7.1.4** The existing **bulk CSV stock upload** and the optional **AWB field** converge into this: a CSV becomes one way to create an inbound reference, not a parallel route into the ledger.

### 7.2 Receiving and putaway

- **7.2.1** Each scan identifies the SKU and the screen names the destination location in large type.
- **7.2.2** **New stock always goes to the SKU's assigned rack first.** Only when the rack is at its **full threshold** does it go to the overflow slot (§8.3).
- **7.2.3** No basket yet for this SKU → the WMS suggests a free slot and the staffer confirms it.
- **7.2.4** Stock is **sellable from the putaway scan**. Nothing waits for a signature.

### 7.3 Putaway list

- **7.3.1** When a receipt is completed, the WMS issues a **putaway list**: what arrived, where each SKU went, the day colour, and the discrepancy deadline.
- **7.3.2** It is a **frozen snapshot** — if a SKU is renamed or a basket moved later, the list still says what staff were told at the time. It is evidence under the 24-hour rule.
- **7.3.3** A supervisor **signs it for compliance**. The signature records; it does not gate the sale.

### 7.4 Day colours and FIFO **[DECIDED]**

Stock is held as a quantity, so the system cannot tell which identical lipstick arrived first. A sticker keyed to the weekday of arrival does.

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|
| Senin `#F2C300` | Selasa `#1E8E3E` | Rabu `#1A73C8` | Kamis `#E8710A` | Jumat `#7B3FA0` | Sabtu `#D6336C` | Minggu `#5E6064` |

- **7.4.1** Each arrival goes behind its **own coloured divider** in the basket. Divider placement is a human action; the WMS does not track dividers or their count.
- **7.4.2** **The colour never travels alone.** Every label carries the day name, the date and the week letter (A/B): the cycle repeats weekly while stock is held up to ~14 days, so a fortnight-old batch wears today's colour.
- **7.4.3** No red in the palette — red means failure everywhere else in this product.
- **7.4.4** The day is computed in **Jakarta time (UTC+7)**. Without this, every delivery received after 5 pm local would be labelled with tomorrow's colour.
- **7.4.5** **No expiry dates are recorded.** The inbound date on the label is the only FIFO signal, including for the eleven sunscreen and vitamin-C SKUs.

---

## 8. Storage and the slot registry

### 8.1 What a supervisor sets

The registry is where rack logic lives. For each SKU at each site a supervisor sets:

- **8.1.1** The **assigned rack location** — the SKU's pick face.
- **8.1.2** An optional **overflow location** for surplus.
- **8.1.3** Two thresholds (§8.3).

### 8.2 Slotting **[DECIDED]**

- **8.2.1** **Supervisors assign racks manually, grouped by brand and category**, which is easier for new staff to learn. The WMS's suggestion follows the same grouping; there is no automatic velocity slotting.
- **8.2.2** The suggestion prefers comfortable pick height (level 3, then 2, 4, 1, with 5 last — it sits at ~2.0 m and needs a step stool).
- **8.2.3** Default thresholds come from the space model; supervisors accept them at go-live and tune over the first month. Bulk edit applies one set to many SKUs.

### 8.3 Two thresholds **[DECIDED]**

| Threshold | Measured on | Triggers |
|---|---|---|
| **Full** | The assigned rack | New stock spills to overflow |
| **Restock point** | Rack + overflow together | A restock request to the CWH (§5.2) |

- **8.3.1** The registry refuses configurations that cannot work — e.g. a restock point below zero or a full threshold of zero — at the point of entry, where a person can still fix them.

### 8.4 Where the picker is sent **[DECIDED]**

When a SKU sits in both its rack and an overflow slot, **the picker goes to whichever holds the older stock.**

- **8.4.1** The WMS knows one thing per location: **when its current stock arrived** — set when the location goes from empty to stocked, cleared when it empties.
- **8.4.2** Typical case: the rack holds Monday stock and a Wednesday delivery overflows → the rack is picked first.
- **8.4.3** The other case: the rack is emptied and refilled on Friday while overflow still holds Wednesday → overflow is picked first. The older batch wins wherever it is.
- **8.4.4** Stock of unknown arrival time (seeded, uploaded) is treated as oldest — picking it first is the safe FIFO error.
- **8.4.5** **There is no replenishment task.** Nothing is ever moved from overflow to the rack; the picker simply follows the oldest stock.
- **8.4.6** Within the chosen basket, FIFO is the coloured divider, chosen by eye. The screen says **"take from the oldest divider"** and never names a colour — the WMS doesn't know which dividers still hold stock, and a wrong instruction is worse than none.

---

## 9. Orders and channels

### 9.1 Where orders come from **[DECIDED]**

| Channel | Order reaches the WMS via | Delivery | Promise |
|---|---|---|---|
| **GrabMart Kilat** | Customer → Grab (assigns rider) → POS → WMS | Grab rider | **15 min from when the order reaches the POS** |
| **WhatsApp** (first QCaaS channel) | Customer → WhatsApp → channel adapter → WMS | Ninja dedicated rider | **1 hour from when the customer places the order** |
| Brand website, Instagram | Later, same pattern as WhatsApp | Ninja rider | 1 hour |

- **9.1.1** Every order carries **`channel`**, **`delivery_mode`** (`grab_rider` / `ninja_rider`) and **`promised_at`**.
- **9.1.2** For Grab, `promised_at` = received + 15 min. The rider is already assigned when the order arrives, so the clock is genuinely running.
- **9.1.3** For Ninja riders, `promised_at` = the customer's order time + 60 min, so the channel must send the time the order was placed.
- **9.1.4** Stock is **allocated at intake**, so two orders can never be promised the last unit.

### 9.2 The pick queue

- **9.2.1** A board in three lanes — waiting, being picked, done today — with each order as a card showing age, lines, units, the racks it touches, and the picker.
- **9.2.2** **Sorted and coloured by time remaining against `promised_at`, not by age.** With two promises in one room, a Ninja order 20 minutes old is comfortable and a Grab order 20 minutes old is a crisis; age would rank them level.
- **9.2.3** A claim held too long is flagged, and a supervisor can **release it back to the queue** through a confirmation that names the holder. Picked lines keep their progress.
- **9.2.4** Test orders are marked unmistakably.
- **9.2.5** The board never reflows under the cursor; changes wait behind a "load changes" pill.

---

## 10. Picking and packing

### 10.1 Guided pick

- **10.1.1** The picker is sent to **one location at a time**, in aisle order, with the location code, the product photo and the quantity.
- **10.1.2** Each unit taken is **scanned**. A wrong shade triggers a **full-screen stop** showing both products side by side. There is no override.
- **10.1.3** Pick batching is **deferred**. Revisit when a station sustains more than ~15 orders an hour per picker; below that the sorting risk outweighs the walk saved.

### 10.2 Short pick **[DECIDED]**

When stock the system expects is not there:

- **10.2.1** **Two taps, no typing** — *item is not here* → *none at all*, or a stepper for how many were found.
- **10.2.2** The picker carries on with the rest of the order.
- **10.2.3** In one transaction the WMS releases the allocation, corrects on-hand to what was found, sends **message 5**, and raises a supervisor exception naming the staffer.
- **10.2.4** **The correction is deliberately unsigned** — every other adjustment needs a supervisor, but waiting here keeps selling stock that doesn't exist. The cost is that a staffer can zero a SKU in two taps, so declarations per person are visible to supervisors.
- **10.2.5** **No substitution.** The WMS reports; the POS or channel decides whether to refund, cancel or offer an alternative.

### 10.3 Pack and hand over **[DECIDED]**

- **10.3.1** The **pack scan** marks the order ready and sends **message 4**. There is no separate double scan.
- **10.3.2** For Grab, the POS prints the receipt and tells Grab. For Ninja riders, the channel adapter books the rider and messages the customer.
- **10.3.3** The WMS owns **pack → handover → timestamp** only. It does not assign drivers, plan routes or track deliveries.

### 10.4 Cancellation

- **10.4.1** **Message 2** releases allocations so the stock is sellable again.
- **10.4.2** Units already picked go to a **return-to-shelf queue**. **Any staff member** can take a return task; they scan the units back to the location the WMS names, and the stock re-publishes.

---

## 11. Stock count

### 11.1 Cadence **[DECIDED]**

- **11.1.1** **ABC tiers from day one.** A = the top 20% of SKUs by units picked over the last four weeks, counted **weekly**. B and C are counted **monthly**. New SKUs start as A until they have history.
- **11.1.2** At 118 SKUs this is roughly 2,600 unit scans a week per station (≈1.5 hours), about half of counting everything weekly.

### 11.2 How a basket is counted **[DECIDED]**

- **11.2.1** The staffer selects a basket; it is **locked** to them so two people never count the same basket.
- **11.2.2** They **scan every unit**. A keypad remains only as a fallback for an unreadable barcode.
- **11.2.3** The system quantity is **hidden** throughout.
- **11.2.4** **Zero tolerance** — any difference flags.
- **11.2.5** On a mismatch the staffer **recounts once before the system number is revealed**. Only then is the variance shown.

### 11.3 Sign-off

- **11.3.1** **Counting never moves stock by itself.** A supervisor reviews the variance, picks a reason, and approves; only then does the ledger change and the new level publish.
- **11.3.2** A count is accurate only if quantity *and* location match with no transaction open against the basket.

---

## 12. Integration: the five messages

### 12.1 The contract **[DECIDED]**

| # | Message | Direction | Fires when | Shape |
|---|---|---|---|---|
| 1 | **Order to pick** | Sender → WMS | Grab order reaches the POS, or a channel order is paid | Order ref, site, lines, channel, delivery mode, promised time |
| 2 | **Order cancelled** | Sender → WMS | Customer or Grab cancels | Order ref |
| 3 | **Stock level** | WMS → sender | Putaway, return to shelf, signed variance, short-pick correction | **Absolute** quantity per SKU per darkstore |
| 4 | **Order ready** | WMS → sender | Pack scan | Order ref, timestamp |
| 5 | **Order short** | WMS → sender | Picker declares a shortfall | Order ref, line, found *n* of *m* |

"Sender" is the POS for Grab and the channel adapter for WhatsApp. The WMS does not change when a channel is added.

### 12.2 Rules

- **12.2.1** **Absolute quantities, never deltas.** A lost delta is wrong forever; a lost snapshot is corrected by the next.
- **12.2.2** **Every message is idempotent.** Stock keyed on site + SKU; order events on reference + event.
- **12.2.3** **Durable outbox, never a direct call.** If the receiver is down, a putaway still completes and the message waits.
- **12.2.4** **Two lanes.** Order events (4, 5) jump ahead of stock syncs.
- **12.2.5** **Darkstores only** send message 3, and **training sites send nothing**, both enforced at the single outbound edge.
- **12.2.6** **Message 3 is never sent for a sale.** Picks deduct in the WMS's own ledger, but the sale deduction the customer-facing system sees is its own (§2.2).
- **12.2.7** **Oversell buffer: 0** — the exact count is published. It is a per-site setting, so it can change without a deploy.
- **12.2.8** **Message 1 is authenticated** with a shared secret before any external caller is given the endpoint.

### 12.3 POS sync is deferred **[DECIDED]**

- **12.3.1** The contract stands, but the POS team is **not being approached yet**. The WMS runs in **shadow mode**: it computes and queues every message and sends nothing to the POS.
- **12.3.2** The integration is proven first on the **WhatsApp channel**, which Ninja builds and controls end to end.

---

## 13. WhatsApp channel (QC-as-a-service)

### 13.1 How a WhatsApp sale reaches the WMS **[DECIDED]**

WhatsApp never talks to the WMS. A **channel adapter** in between does, speaking the same five messages as the POS.

1. The customer browses the brand's **WhatsApp catalog** and sends a structured order message.
2. The adapter holds the cart, captures the address and decides **which darkstore** serves it.
3. The adapter sends a **payment link**. Nothing reaches the WMS until payment is confirmed.
4. On payment, the adapter sends **message 1**. The WMS allocates, queues and guides the pick.
5. On **message 4**, the adapter books a Ninja rider and tells the customer the order is on its way.
6. On **message 5**, the adapter asks the customer — send what we have, or refund? — which is better than Grab's automatic refund.

### 13.2 Ownership

| Adapter owns | WMS owns |
|---|---|
| Conversation state, cart, timeouts | Allocation, pick, pack, handover |
| Catalog product → WMS SKU mapping | Stock and location |
| Address → darkstore routing | Nothing about the customer |
| Payment, never visible to the WMS | |
| Rider booking and customer messages | |
| Hiding out-of-stock items, from message 3 | |

### 13.3 Build order

- **13.3.1** **A WhatsApp simulator first**, on the training site — type a customer order, choose an address, "pay", and watch it become a pick task and come back as ready. It proves routing, the 1-hour promise and messages 1, 4 and 5 before Meta business verification, which takes weeks.
- **13.3.2** Then the real adapter: Meta webhook, catalog, payment callback and rider booking in front of code already proven.

---

## 14. Admin, access and training

### 14.1 Access

- **14.1.1** Sign-in is **Google SSO** through the Substrait proxy; the app stores no passwords.
- **14.1.2** Roles: **admin, supervisor, hub operator, staff**. An admin cannot deactivate their own account or change their own role.
- **14.1.3** Any **@ninjavan.co** account is auto-provisioned as staff **on the training site only**. This stays on through the pilot; **at go-live, the staff admin screen takes over and auto-provision is switched off.**

### 14.2 Admin screens

- **14.2.1** Staff and roles, sites (CWH / darkstore), racks (generate a layout or add one rack), SKUs and barcodes, photos, the slot registry.

### 14.3 Training mode

- **14.3.1** An isolated training site with a permanent banner, one-tap reset, scripted scenarios, test barcodes that work without a scanner or stock, and simulators for Grab and WhatsApp orders.
- **14.3.2** Training never reaches the POS or a channel, enforced where messages leave the system.

---

## 15. Service targets and scale

### 15.1 Service targets **[DECIDED]**

| Measure | Definition | Target |
|---|---|---|
| On-time dispatch | Orders ready before `promised_at` | **95%** |
| Pick and pack time | Order received → ready (Grab) | **< 5 min** |
| Out-of-stock rate | Order lines short | **< 3%** |
| Count accuracy | Baskets counted with zero variance | **98%** |
| Pick accuracy | Lines picked without a wrong-item stop | 99.5%+ (tracked) |

Industry reference: manual picking runs 1–3% errors; scan-verified picking 0.1–0.3%.

### 15.2 Scale requirements

The second brand arrives within three months and the network grows to 10–30 stations within six. Everything below must be in place before the second brand onboards.

- **15.2.1** Every list is **paginated** and served by a single query — no per-row lookups.
- **15.2.2** A **network view** across stations: which is behind, which has a stuck claim, which is under-counted.
- **15.2.3** Screens that watch live state **update by push**, not by polling every few seconds per tab.
- **15.2.4** The console sidebar is **trimmed by role and site type** — a CWH has no pick queue to show.
- **15.2.5** A short **client-side scan buffer** holds scans across a Wi-Fi blip and replays them on reconnect; idempotency keys make that safe. Beyond a few seconds the screen still blocks loudly.

### 15.3 Platform

- **15.3.1** Substrait, deployed from the GitHub `main` branch. OceanBase with Flyway migrations; every migration written to be safely re-runnable from a partial state.
- **15.3.2** Asset URLs carry a version so a deploy is never served stale CSS; unknown paths return 404.
- **15.3.3** Security scan findings (Semgrep, Trivy) are reviewed before go-live.

---

## 16. Build status

As of 11 September 2026. "Verified" means driven against the live database this month.

| Area | Backend | Screens | Notes |
|---|---|---|---|
| Ledger, idempotency, audit | Verified | — | No automated tests yet |
| Inbound receive, putaway, unknown-barcode, new basket | Verified | **Live** (01, 02) | AWB field present |
| Putaway list, day colours | Verified | Needs wiring | |
| Barcode registration, license plates | Built | Needs wiring | Mode B untested at volume |
| Slot registry, overflow, oldest-location picking | Verified | Needs wiring | Registry still accepts a legacy low threshold |
| Restock requests, transfers | Built | Needs wiring | |
| Order intake, allocation, guided pick, wrong-item stop | Verified | Needs wiring | Message 1 not yet authenticated |
| Pick queue, stuck-claim release | Verified | Needs wiring | Sorts by age, not time remaining |
| Short pick, cancel | Verified | Needs wiring | Picked units on cancel not yet returned |
| Stock count, sign-off | Verified | Needs wiring | Reveals before recount; keypad-only |
| Admin, training, Grab simulator | Verified | Needs wiring | |
| Outbox | Queues | — | **Nothing sends yet**; queues every movement including picks |
| Replenishment tasks | Built | Designed | **Superseded by §8.4 — remove** |
| Inbound reference, crossdock | — | — | Decided, not built |
| `promised_at`, channel, delivery mode | — | — | Decided, not built |
| Return-to-shelf, ABC schedule, scan counting | — | — | Decided, not built |
| Camera scanning, scan buffer, photo upload | — | — | Decided, not built |
| KPIs, network view, pagination | — | — | Decided, not built |
| WhatsApp simulator and adapter | — | — | Decided, not built |

**Only 2 of 38 designed screens are wired to live data.** The design v3 drop overwrote the wiring on the rest. The backend behind them is intact; restoring the screens is the first item in §19.

---

## 17. Open questions

- **Q1** — Does Ninja already have a **WhatsApp Business account** and verified number, or does that start from zero?
- **Q2** — Which **payment provider** for WhatsApp orders — Midtrans, Xendit, bank transfer?
- **Q3** — For the WhatsApp test, is it **one darkstore serving one area**, so address routing can wait?
- **Q4** — **Crossdock dwell**: 7 days is a placeholder. Confirm the real limit.
- **Q5** — How full does a basket get before it should spill? Sets the **default full threshold** for 118 SKUs.
- **Q6** — **For the POS sync, when it resumes:** how the POS applies an absolute stock level without re-deducting orders the WMS has already picked. Deferred with the POS conversation.
- **Q7** — **Exceptions still undesigned:** damaged or written-off stock, customer returns, and units found after being written off by a short pick.
- **Q8** — Who reviews the **Semgrep and Trivy findings** before go-live?

---

## 18. Not doing, and why

| Not doing | Why |
|---|---|
| Any WMS link to Grab | The POS owns Grab; a second link means two systems disagreeing about one order |
| Modelling dividers in the WMS | FIFO inside a basket is a human action guided by colour |
| Expiry dates and FEFO | Decided against; inbound date on the label is enough for 24–36 month shelf life |
| Automatic velocity slotting | Supervisors assign by brand and category, which new staff learn faster |
| Substitution in the WMS | The POS or channel owns the customer and decides |
| Replenishment tasks | The picker follows the oldest stock instead (§8.4) |
| An oversell buffer by default | Exact counts with scan-verified picking and zero-tolerance counts; the setting exists if needed |
| Double scan at pack | The pack scan is the ready signal |
| Pick batching, for now | Pays off only above ~15 orders an hour per picker |
| Delivery management | The WMS owns handover; routing and riders live elsewhere |
| POS sync, for now | Deferred; WhatsApp proves the contract first |

---

## 19. Roadmap

The second brand arrives within three months, so phases 0–5 fit inside that window.

**Phase 0 — make it clickable.** Re-attach the 16 screens that already have working logic; write handlers for the 20 that don't. Supervisors and admins land on the console; sidebar keeps its scroll position; the AWB field moves into the v3 design; replenishment is removed from screens and API.

**Phase 1 — make it trustworthy.** Automated tests on the ledger's rules. Authenticate message 1. Build the outbox sender, pointed at the WhatsApp simulator first. Restrict message 3 to non-sale movements. Recount before reveal. Lock a receipt against concurrent scanning.

**Phase 2 — the decided model.** `promised_at`, channel and delivery mode; the queue sorted by time remaining. Return-to-shelf queue. Scan counting with the ABC schedule. The "needs a rack" list. Photo upload. Camera scanning. The scan buffer. KPIs.

**Phase 3 — inbound.** Inbound references with live progress, the CSV upload converged into them, crossdock staging with its dwell rule.

**Phase 4 — WhatsApp.** The simulator on the training site, then the real adapter.

**Phase 5 — before the second brand.** Pagination, single-query lists, the network view, push updates, role-trimmed navigation.

**Later.** POS sync; pick batching when volume justifies it.

---

## Appendix A. Glossary

| Term | Meaning |
|---|---|
| **CWH** | Central warehouse — currently Logos Metrolink. Stores, crossdocks and distributes to darkstores |
| **Darkstore** | A station that holds stock and fulfils customer orders |
| **Rack / pick face** | The location a SKU is assigned to; where pickers normally go |
| **Overflow** | A second location that takes surplus when the rack is full |
| **Divider** | A physical separator in a basket, one per arrival, coloured by day |
| **Day colour** | The sticker colour for the weekday stock arrived, always with day name and date |
| **Inbound reference** | A registered expected delivery: reference, source, quantity per SKU |
| **Crossdock** | Stock received at the CWH and passed straight through without being put away |
| **Putaway list** | The frozen record of what a receipt put where, signed for compliance |
| **Allocation** | Reserving stock for an order at intake so it can't be promised twice |
| **Short pick** | The picker finds fewer units than the order needs |
| **`promised_at`** | The time an order must be ready by; drives the queue |
| **Mode A / Mode B** | Brand-barcode identity versus Ninja license-plate identity |
| **Shadow mode** | The WMS computes every outbound message and sends none |
| **Training site** | An isolated site for learning and testing that never reaches real systems |

Companion documents: the **Kilat Fulfilment Flow** (process and swimlane diagrams) and the **Kilat WMS Audit** (research and gap analysis).
