# Feature gap research — Ninja Kilat WMS

| | |
|---|---|
| **Reviewed** | `PRD.md` v0.1 (3 Sep 2026), complete |
| **Against** | `Grab Kilat Fulfillment/HANDOFF.md` §10, §11, §14, §16, §17; `wardah_sku_list.csv`; `substrait-app/SKILL.md` |
| **Date** | 3 September 2026 |
| **Scope** | Additive only — nothing already in §8 M1–M7, §9, §10 is restated |

---

## How to read this

The draft is a good PRD. It has a real domain model, a real ledger, and the two decisions
that matter most (§5.1 SKU-level identity, §5.5 one basket = one SKU) are correct and
correctly argued. The gaps below are not "the PRD is thin." They cluster in four places:

1. **Money.** The sources name two specific financial exposures — Grab refunds the customer
   and charges the merchant by default, and inbound discrepancies unraised in 24 h are borne
   by the station (HANDOFF §16; PRD §2.1). The draft acknowledges both in prose and turns
   neither into a working mechanism. The 24-hour countdown (M3.2.4) is a number on a screen.
2. **Day 2.** Every module is a launch module. There is no operational steady state — no
   daily rhythm, no drift correction, no re-slotting once velocity is known, no supervisor
   inbox to catch the things §15 says the system will stop and flag.
3. **The staffer's first hour.** G1 and §17 both set training targets. No feature delivers
   or measures either, and §9.3.4 disables the only sandbox in production.
4. **Anything that leaves the browser.** No notification, no alert, no export that a human
   who is not currently looking at the app will ever see. Malaysia's mechanism was a
   WhatsApp message; the draft removed the Google Sheet (M4.6) and did not replace the
   message.

Fifteen proposals follow, ranked. Then a section on what the draft gets **wrong**, and a
short section on real-WMS features that would be **wrong to build here** — which is as much
of the answer as the additions.

---

# Part 1 — Proposals

Ranked by (financial or operational exposure prevented) ÷ (build cost). Cost is S ≈ days,
M ≈ 1–2 weeks, L ≈ a month, for one engineer on the existing scaffold.

---

## 1. Zero-on-Empty — the short-pick capture button

**What.** A single, always-visible control on the pick screen (M5.2.3): *"Keranjang kosong"*
— basket empty. One tap writes an `adjustment` movement zeroing that location, immediately
recomputes and pushes available-to-sell so Grab stops selling the SKU within seconds, marks
the order line short, and raises an exception (proposal 6). No supervisor needed to stop the
bleeding; the supervisor's job is the reason code afterwards.

**Objectives.** G3 (the published number stops being a lie the moment reality contradicts
it), G2 (the discovery is timestamped and attributed), G4 (the variance is captured at the
moment of discovery rather than waiting for Sunday's count).

**Evidence.** PRD §15 E8, verbatim: *"Short pick — the basket is empty but the system says
there is stock. Highest frequency, highest impact. Grab refunds the customer and charges
the merchant, so this one has a direct financial consequence."* HANDOFF §16 confirms the
charge-back default. The draft names its own highest-frequency, highest-impact event and
defers it.

**Why the draft does not cover it.** M5.1.4 flags a line short at **allocation** time —
i.e. when the WMS's own number already says there is not enough. The case that matters is
the opposite: the WMS says 4, the basket has 0. M5 has no control for that. §15 NG3 defers
the whole exception class, so the picker's only exits are to walk away from a claimed task
(M5.2.2, which times out and re-offers the same impossible line to the next picker) or to
scan something. Meanwhile the phantom stock stays published and the next order oversells
the same SKU again. One empty basket produces a cascade of refunds, not one.

**Cost.** **S, v1.** The adjustment movement, the reason code, and the push all already
exist in §11 / §9.2. This is a button, an endpoint, and a reason code.

**Cost of omitting.** Each empty basket keeps selling until the weekly opname finds it — up
to seven days of refunds plus merchant charges on the same SKU, plus a picker who learns
that the correct response to an empty basket is to close the laptop. This is the single
cheapest refund-prevention feature in the document.

---

## 2. Publish policy engine — buffer, unmanaged-SKU guard, cutover gate

**What.** Interpose a policy layer between `available_to_sell` and the §9.2 push, with three
rules:
- **Confidence buffer.** Withhold N units (per-SKU, defaulting from a site-level rule) from
  the published figure for SKUs that are high-velocity, had a negative variance at the last
  count, or have a stale count. A SKU with 4 on hand and a history of −3 publishes 1.
- **Never publish a zero for an unmanaged SKU.** A SKU with no slot at that site, or a brand
  not yet marked live at that site, is *omitted* from the push, not sent as 0.
- **Publish gate.** A brand-site is not published at all until slot plan applied, labels
  printed, and one baseline count completed. Gate is explicit and supervisor-released.
- **Quiet during receipt.** Suppress per-SKU pushes while an inbound receipt is open;
  publish once on completion (M3.4.3).

**Objectives.** G3 directly — it is the only proposal here that acts on "accurate *enough*
to publish without oversell." G5 (the gate is what makes brand #2 a configuration step).

**Evidence.** HANDOFF §16, Malaysia: *"API cutover overwrites the whole Grab menu, so timing
matters."* A raw push of every balance change during a 4,950-unit receipt is exactly that
hazard repeated 118 times. PRD §17 sets the accuracy bar at *"≥ 98% of baskets within ±2
units"* — which, stated plainly, is a design tolerance of up to 2 units of oversell exposure
per basket, published to Grab, unbuffered. HANDOFF §16 on the refund default makes each of
those units cost money.

**Why the draft does not cover it.** §6 glossary defines available-to-sell as exactly
`on-hand minus allocated-to-open-orders` and §9.2 pushes that number raw on *"every balance
change."* There is no policy layer, no buffer, no concept of confidence, and no guard on
what a zero means to a menu that Grab overwrites wholesale.

**Cost.** **S–M, v1.** Buffer + omission rules are a function over the existing push. The
gate is a status column and a screen.

**Cost of omitting.** Oversell is not a rounding error in quick commerce — it is a refund, a
merchant charge and a Grab-side quality score. And a bad first push at cutover can blank the
Grab menu for a brand, which is a commercial incident, not a bug.

---

## 3. Expected inbound + the 24-hour discrepancy claim pack

**What.** Two halves.
- **Expected inbound.** Before or during a `from_brand` receipt, capture what was *promised*:
  a packing list uploaded as CSV, keyed manually against SKUs, or photographed and typed in
  by the hub. This populates `receipt_lines.qty_expected` — a column §11 already declares and
  M3 never fills for brand deliveries.
- **Claim pack.** On completion of any receipt with a variance, one action generates a
  discrepancy claim: expected vs received per SKU, unit and Rupiah value, receipt photos
  (M3.4.5), timestamps, named receiver, the barcode-level scan trail, and the deadline. Held
  in a state machine `draft → raised → acknowledged → resolved`, with the 24 h clock as a
  first-class field that drives alerting (proposal 7) rather than a countdown widget.

**Objectives.** G2 (the scan record becomes an evidentiary artefact, which is what §5.4 says
attribution is *for*), G3.

**Evidence.** PRD §2.1 and HANDOFF §16: *"inbound discrepancies must be raised within 24 h or
the station bears the loss."* PRD §2.2, row *Discrepancy window*: *"24 h to raise an inbound
gap. Without a timestamped receiving record there is nothing to raise it with."* HANDOFF §16
also anticipates the artefact: the two asks that would remove the sorting problem are *"one
SKU per carton... or failing that a packing list per carton."* If Wardah supplies a packing
list, the WMS must be able to eat it.

**Why the draft does not cover it.** M3.4.2 produces an expected-vs-received report **only
for transfer receipts**, where the expectation comes from `transfer_lines.qty_dispatched`
(M4.3). For `from_brand` receipts — the ones where the 24 h rule and the money actually live,
because the hub's counterparty is Wardah, not Ninja — there is no expectation at all. The
system can therefore report what it counted but cannot say anything was missing. M3.2.4's
countdown counts down to a deadline against a claim that does not exist. And nothing
persists the claim: §11 has `inbound_receipts.status = discrepancy_raised` as a terminal
state with no lines, no evidence, no owner and no resolution.

**Cost.** **M, v1.** The receipt-line expectation is small; the claim state machine, PDF/CSV
assembly from object storage and the deadline field are the bulk.

**Cost of omitting.** The station bears every inbound loss, by default, forever — which for
a consignment model on ~Rp 400–500 m of stock per station (HANDOFF §12) is the largest single
uncontrolled exposure in the operation. This is the gap most worth arguing for.

---

## 4. Two-scan putaway — confirm the destination basket

**What.** In the M3.3 receiving loop, after the SKU resolves and the screen says
`PUT IN → UT5-A-3-02`, require a scan of the **basket label barcode** before the quantity is
committed. Wrong basket → red block, naming both the basket scanned and the basket expected,
with both product photos. One scan per *drop*, not per unit: in scan-then-count mode a carton
of 24 costs one extra scan, ~2 seconds.

**Objectives.** G3, G1 (the confirmation is the instruction — no reading a code off a screen
and matching it to a shelf), G2.

**Evidence.** PRD §7.2 item 4 already specifies the basket barcode and its purpose: *"a
Ninja-generated Code-128 encoding the basket ID, so a staffer can scan the basket instead of
typing the location."* §7.3 slotting rule: *"SKUs of the same product line kept adjacent — a
picker looking for shade 07 sees 06 and 08 either side, which is both a help and a risk — the
scan gate covers the risk."* `wardah_sku_list.csv` shows the adjacency at issue is 21
consecutive Glasting Liquid Lip shades, 8 Lip Tint Moist Dew, 7 Exclusive Matte, 7 Blur-Ink,
7 EyeXpert, 7 UV Shield — six runs where neighbouring baskets are visually indistinguishable.

**Why the draft does not cover it.** The scan gate the draft relies on exists **only on
pick** (M5.2.4). M3.3.2 shows the putaway location and then M3.3.3 takes a quantity — there
is no verification that the units went where the screen said. The basket barcode is printed
(§7.2), used to *select* a basket in opname (M6.2.1), and never used to *verify* a
destination anywhere. So the most common physical error in a shade-dense rack — dropping 24
units of shade 07 into the 06 basket next door — is invisible until the weekly count, at
which point M6 reports a clean +24/−24 pair and a week of wrong shades has already shipped.
The scan gate does not "cover the risk"; it covers one third of it.

**Cost.** **S, v1.** The scan hook, the basket-barcode resolver and the block screen all
exist. This is wiring plus one state in the receiving loop.

**Cost of omitting.** A mis-slot poisons every downstream flow simultaneously: picks are
wrong, opname variance is doubled and mutually cancelling, and the ledger looks healthy.
It is the failure mode most likely to make the whole system look untrustworthy in week two.

---

## 5. Training mode — sandbox site, first-run walkthrough, competency checklist

**What.** Three parts, one feature.
- **Sandbox site.** A per-brand `is_training` site with the real SKU master, real photos, real
  barcodes and a synthetic rack layout. Every flow (receive, putaway, pick, count) runs
  against it identically. Movements are written to the sandbox site and excluded from all
  reporting and every POS push. A staffer scans real Wardah units off a practice tray.
- **First-run walkthrough.** The first time a user opens each module, a 4–6 step overlay in
  Bahasa Indonesia showing the one thing that screen does. Skippable, re-openable from a
  persistent *"Bagaimana caranya?"* button on every guided screen.
- **Competency checklist.** A supervisor-visible per-user card: has completed a practice
  receipt, a practice pick including a deliberately-wrong-shade scan, a practice count.
  Optionally gate the live pick flow on it. New users' first N live tasks are tagged for
  supervisor review.

**Objectives.** G1 above all — it is the only proposal that directly builds the objective
rather than assuming it. G7 (a new staffer practising cannot corrupt a live station's data).

**Evidence.** PRD §2.2, staff profile: *"Predominantly high-school graduates, high turnover,
no warehouse-systems background."* §4 persona, same. §3.1 G1 asserts a 10-minute walkthrough
suffices. §17 sets *"New staff time to first unassisted pick ≤ 30 minutes."*

**Why the draft does not cover it.** §4 lists excellent *design consequences* (one task per
screen, ≤ 8-word imperatives, photo + name + location) — those reduce the training a staffer
needs, they do not provide any. There is no training artefact anywhere in §8. The only
non-live data path in the document is the §9.3 dummy order generator, and it is (a) an admin
screen for testing the POS integration, not a staff flow, (b) it consumes **real** stock at a
**real** site — it only fakes the order, so practice picking depletes live inventory, and (c)
§9.3.4 disables it in production by environment flag. So the one sandbox-ish thing in the PRD
is explicitly unavailable at the exact moment a new staffer needs it. §17's 30-minute metric
has no mechanism and no way to be measured.

**Cost.** **M, v1.** The sandbox is a site row plus an exclusion predicate on reporting and
push — the guided-task shell (§13) makes the flows free. The walkthrough is a small overlay
component. The checklist is a table.

**Cost of omitting.** With high turnover, every new hire's first week is spent learning on
live stock, and every mistake is a real ledger entry a supervisor must unpick. The system's
correctness depends on staff who will be replaced continuously; a WMS that cannot be
practised on will be worked around.

---

## 6. Exception queue and live operations board

**What.** The supervisor's home screen, in two layers.
- **Exception queue.** The destination for every "stop and flag for a supervisor" the draft
  promises in §15. A typed, assignable, resolvable inbox: unknown barcode flagged at inbound
  (M3.3.4), over-capacity warning (M3.3.6), blocked barcode conflict (M1.3.5), zero-on-empty
  (proposal 1), foreign item found (M6.2.5), abandoned opname session (E18), pending
  discrepancy claim (proposal 3), pick task blocked on a wrong-SKU scan (M5.2.5). Each item:
  what, where, who, when, age, and the actions available.
- **Live board.** One screen showing all sites a supervisor owns: open pick tasks with age
  against a target (§17: ≤ 3 min for 5 lines), unclaimed tasks, staff currently blocked,
  receipts with a running 24 h clock, baskets not counted in N days, scan-failure and latency
  telemetry per site (which also gives §5.2's connectivity risk a real data source instead of
  a one-off survey), and a throughput tab: units/hour per person per task type, opname
  baskets/hour, `scan_source` mix, manual-count percentage.

**Objectives.** G4 (a variance report is only actionable if someone is looking at a place
where it appears), G7 (multi-station is the *supervisor's* problem, not just a locking
problem), G2 (attribution finally has a consumer).

**Evidence.** PRD §4 defines the Station Supervisor as the person who *"sees variance,
approves opname, resolves flagged items"* — resolves flagged items, from a place the PRD
never builds. §15 closing principle: *"the WMS must stop and flag for a supervisor rather
than guess."* M3.3.4 offers *"Flag for supervisor"* as one of three large buttons with no
described destination. HANDOFF §12: workload is *"8.2 operator-hours/day — one dedicated
person, second body only in the peak hour"* — so the supervisor is running several stations
remotely and is not standing behind the picker.

**Why the draft does not cover it.** M7 is seven *inventory* views — on-hand, find-a-SKU,
low stock, movement history, cross-site, users, audit, stale counts. Every one answers "what
is the stock?" None answers "what is going wrong right now?" There is no queue, no age, no
SLA, no assignment, no resolution state, and the word *exception* appears in §8 exactly once,
as an unrouted button label. §17's operational targets (pick time, inbound seconds per unit,
opname per shift) have no reporting home at all.

**Cost.** **M, v1** for the exception queue; the throughput tab can be **v1.1**.

**Cost of omitting.** Every deferred exception in §15 lands on a supervisor with no inbox,
which means it lands on WhatsApp — the exact informal mechanism (HANDOFF §16) this system
exists to replace. And the answer to "how does someone running three stations know something
is wrong before it becomes a refund" is, today, *they don't*.

---

## 7. Escalation and notification service

**What.** A small outbox that sends things to people who are not looking at the app: the 24 h
discrepancy deadline at T−12 h / T−4 h to supervisor + ops admin; a pick task unclaimed past
N minutes; a station gone silent during opening hours; the daily replenishment suggestion
(M4.6) as a morning digest; the weekly opname variance summary; expiry sweep due (proposal 9).
Channels: email first (free — every user is a Google account under §5.4), plus a generic
outbound webhook so a WhatsApp/Slack relay can be attached later without WMS changes.

**Objectives.** G4, G3, G7.

**Evidence.** HANDOFF §16, Malaysia: *"restock via Google Sheet trigger levels + WhatsApp."*
PRD M4.6 explicitly replaces the Google Sheet — *"This replaces the Google-Sheet-plus-WhatsApp
mechanism inherited from Malaysia"* — but replaces only the *threshold calculation*. The
WhatsApp half, the part that actually reaches a human, is deleted and not replaced. PRD §2.1
and §2.2 on the 24 h rule.

**Why the draft does not cover it.** M3.2.4's countdown is rendered inside the receipt screen.
A receipt completed at 17:00 by a staffer who then goes home is a clock nobody watches until
the loss is already taken. The word *notification* does not appear in the PRD; the only
alerting mechanism specified anywhere is §10.5.3's nightly ledger-drift alert, whose recipient
is undefined. M7.3 low-stock and M7.8 stale-count are pull-only screens: they require someone
to already suspect the problem.

**Cost.** **S–M, v1.** A `notifications` outbox table, a scheduled worker, SMTP or a webhook
POST. Substrait supports scheduled work in-process; §13 already accepts an outbox pattern for
the POS push, so this is the same shape.

**Cost of omitting.** Every time-critical rule in the system degrades to "hope someone opens
the right screen." The 24 h rule in particular is unenforceable without a push.

---

## 8. Order evidence pack — the chargeback defence

**What.** For any order, a single assembled record: the POS external reference, each line's
SKU with photo, the location picked from, the exact barcode scanned, the scan timestamp to
the second, the named picker, the pick task duration, and the `scan_source`. Exportable as a
one-page PDF/CSV. Searchable by external order reference — because that is the only key Grab
will quote in a dispute.

**Objectives.** G2 — this is the *purpose* of G2 made concrete; attribution that is never
assembled into an artefact is just data.

**Evidence.** HANDOFF §16: *"two-photo proof-of-fulfilment app because Grab refunds the
customer and charges the merchant by default."* PRD §2.1 restates it and adds: *"proof of
fulfilment is financially load-bearing, not paperwork."* The POS holds the compliance photo
of the sealed bag; the WMS holds the only evidence of **what was actually in it** — a
scan-verified SKU identity at a timestamp by a named person. That is a stronger artefact than
a photo of a closed bag, and only the WMS has it.

**Why the draft does not cover it.** §16 Q15 assumes the POS remains sole owner of the
compliance photo, and stops there — it never asks what the WMS's own evidence is worth. M7.4
movement history is queryable per SKU and per location, not per order; §12's API has no
order-scoped evidence endpoint. So when Grab charges back order `GM-8813`, the supervisor's
route to the evidence is to know the SKU, guess the time window, and read a ledger.

**Cost.** **S, v1.** Pure read-side assembly over `pick_lines`, `stock_movements`, `orders`
and `scan_events`, all of which §11 already stores. Value per unit of effort is high.

**Cost of omitting.** Ninja loses disputes it should win, and the case for the WMS's ROI
(which is largely refund avoidance) cannot be evidenced.

---

## 9. Basket expiry register and monthly sweep

**What.** Make expiry a data field rather than handwriting.
- On receipt of a SKU whose tier is Critical or Watch, prompt for **one** date — the earliest
  expiry month present in this delivery — recorded against the basket (not the unit). Two
  taps, month/year picker, only for 36 of 118 SKUs, and in practice only the 11.
- Print the recorded month on the label (replacing the handwritten box) so a reprint cannot
  destroy it.
- A **monthly sweep task**: a generated checklist of the 11 Critical baskets, guided in path
  order, each asking "what is the earliest date in this basket now?" — same shape as an
  opname session, reusing M6's shell.
- Alerts at configurable horizons (e.g. 120 / 60 days) via proposal 7, and a *do not publish
  / block pick* flag once a basket's recorded date passes.

**Objectives.** G3, G4, G6, G2.

**Evidence.** HANDOFF §17: *"Critical, 11 SKUs: UV Shield (7), UV Acne Calming (2), C-Defense
vitamin C (2). Coloured basket label with expiry month, true FEFO, monthly sweep."* And the
governing rule: *"receive-date FIFO on everything, date-checked FEFO on the 11 only. Do not
ask a station to date-check 118 baskets."* HANDOFF §6 item 5: *"Cosmetics have real shelf-life
exposure and sunscreen in particular is date-sensitive."* Note also from `wardah_sku_list.csv`
that the 7 UV Shield SKUs are simultaneously the entire Critical tier's largest family **and**
a 7-way look-alike run at Rp 39.500–89.000 — the one place where mis-pick risk and expiry
risk sit in the same seven adjacent baskets.

**Why the draft does not cover it.** §5.1 concludes FEFO *"is handled by a physical control
instead"* and §6 glossary states expiry tier *"drives labelling and sweep frequency, not
system logic in v1."* But no sweep is scheduled anywhere in §8 — "sweep frequency" is
asserted and never implemented — and §7.2 item 6 makes the only expiry data in the entire
system a **handwritten** month on a label that §7.2 also says can be regenerated in one click.
Reprint a label after a relocate and the date is gone with no record it ever existed. §16 Q9
correctly identifies that FEFO has no owner and then leaves it there. The basket-level date
proposed here is fully compatible with §5.1's no-serialisation decision — it does not require
unit tracking, only one date per basket per delivery.

**Cost.** **S–M, v1.** One nullable column on the basket/slot, one prompt in the receipt
loop, one generated task reusing M6, one alert rule.

**Cost of omitting.** Expired sunscreen ships to a customer — a product-safety and brand
incident, not a refund — or Wardah takes an unrecorded write-off on consignment stock and
Ninja has no record of when it arrived or when it was last checked.

---

## 10. Trigger-driven daily cycle-count queue

**What.** Alongside the weekly full opname, a short daily queue of 5–10 baskets seeded by
signals rather than by schedule: a basket that hit zero-on-empty (proposal 1), a negative
variance at the last count, an over-capacity override (M3.3.6), a foreign item found (M6.2.5),
a basket with sales but no movement recorded, a top-velocity SKU on a rolling cadence, and
anything unmoved for N days. Ten minutes at shift start, same M6 flow, same blind-count rules.

**Objectives.** G3, G4 (it reduces what the weekly count has to catch, and makes the weekly
count's variance list shorter and more meaningful).

**Evidence.** PRD §2.2: *"A daily manual count of 118 baskets is not going to happen honestly.
Weekly, basket-scoped, scanner-driven is achievable."* Agreed — but a weekly cadence means the
average error lives 3.5 days before discovery, and every one of those days is published to
Grab. PRD M6.3.6 already stores exactly the signal this needs: *"History is retained per
basket so a repeatedly-shrinking SKU is visible as a pattern."* Nothing consumes it.

**Why the draft does not cover it.** M6.1.1 opname plans are **manually created** by a
supervisor and scoped only by *"rack, brand, or expiry tier"* — there is no trigger, no
priority, no risk weighting. M7.8's stale-count report is a passive list with no task
attached. So the system knows which baskets are suspicious and never asks anyone to look at
them.

**Cost.** **M, v1.1.** The counting flow is M6 unchanged; the work is the trigger rules and
the queue.

**Cost of omitting.** Accuracy is a sawtooth that resets weekly. In a 30-minute-promise
business, a three-day-old error is many refunds.

---

## 11. Brand onboarding readiness — flexible import, photo capture, completeness board

**What.** Three components that together make G5 real.
- **Column-mapped CSV import.** Upload any CSV; map its columns to WMS fields in the UI; save
  the mapping as a named profile per brand. Replaces the fixed-shape importer.
- **Bulk photo capture.** A phone flow: scan barcode (or pick from the not-yet-photographed
  list) → camera → shoot → attach → auto-advance to the next SKU. 118 photos in one bench
  session, straight to object storage.
- **Readiness board.** One screen per brand-site: *118 SKUs imported · 94 have a photo ·
  61 have a registered barcode · 0 slotted · 0 labels printed · not published.* Each number
  is a link into the flow that fixes it. This is also the gate released in proposal 2.

**Objectives.** G5 directly, G1 (photos are the primary identity cue in §4 and §7.2 — a
missing photo is a mis-pick), G6.

**Evidence.** §3.1 G5: *"Onboarding a second brand of 118+ SKUs is configuration, not code."*
§17: *"Time to onboard a new 118-SKU brand at a site ≤ 1 day."* M1.2.4 makes a photo a hard
precondition: *"A SKU with no photo is listed as incomplete and blocked from slotting."*

**Why the draft does not cover it.** M1.2.2 specifies import *"in the exact column shape of
`wardah_sku_list.csv`"* — that is code shaped to one brand's file, and it contradicts G5 in
the same document. Worse, that file is an OCR artefact, not a master: HANDOFF §2 says names
were *"read off a phone screen, not pulled from a master"* and *"no unit dimensions were
available anywhere"*; it holds 108 of 118 rows; it carries a stray spreadsheet formula row
(`=COUNTA(D5:D112)` / `=ROUND(AVERAGE(H5:H112),0)`), an embedded comma inside a quoted product
name (*Exclusive Matte Lip Cream 07 Hello, Ruby*), approximate sizes prefixed `~`, **no
barcode column and no brand SKU code** — yet §11 declares `UNIQUE(brand_id, brand_sku_code)`.
Brand #2 will not send this shape, and neither will Wardah once a real master arrives.
Separately, M1.2.4 requires 118 photos and §8 contains no flow to obtain even one; the implied
path is an admin hand-uploading files matched by name, which is the actual bottleneck in the
one-day target. And nothing anywhere reports onboarding completeness.

**Cost.** **M, v1** for photo capture and the readiness board (both are on the critical path
to Wardah go-live); **v1.1** for column mapping, which only bites at brand #2.

**Cost of omitting.** The second brand is a project, not a configuration — which is the
explicit failure of G5 — and Wardah's own launch stalls on 118 photographs nobody owns.

---

## 12. Reverse putaway — cancelled orders and returns to stock

**What.** A guided flow that is the receiving loop with a different movement type: scan the
bag or the order reference, scan each unit, the screen says `PUT BACK → UT5-A-3-02`, confirm
the destination basket (proposal 4), balances restore, a `return_in` movement is written with
a reason (`order_cancelled`, `rider_no_show`, `customer_return`). Damaged units route to a
quarantine location instead.

**Objectives.** G3, G2.

**Evidence.** PRD §15 E9, E10, E11, E15, E21 — five deferred exceptions, all of which end
with physical units sitting on a bench with no system home. E10 is named precisely: *"Order
cancelled after picking, before rider handover — putaway of picked stock."* HANDOFF §16 notes
riders routinely cannot find stations (*"GPS off by up to 3.5 km, location set by Grab and
only fixable by Grab"*), which makes E15 — order picked, rider never arrives — a routine
event, not an edge case.

**Why the draft does not cover it.** §11's `stock_movements.type` enum has no inbound type
for returned goods at all: `receipt_in | transfer_out | transfer_in | pick_out | adjustment |
relocate_out | relocate_in`. A cancelled order therefore has to be corrected as a supervisor
`adjustment` with a free reason code, which is untraceable to the order and indistinguishable
from a count correction. NG3 defers the flow; the schema forecloses even the workaround being
legible.

**Cost.** **S, v1.1.** The receive loop with a different reason and a quarantine location.

**Cost of omitting.** Picked-and-cancelled stock becomes phantom shortage, which produces the
next zero-on-empty, which produces the next refund. It is a self-feeding loop, and it starts
on day 1 of live orders.

---

## 13. Velocity-driven re-slot proposal

**What.** A periodic (monthly) advisory job that reads the movement ledger, ranks SKUs by pick
frequency, and proposes a diff: *"move these 9 baskets"* — fast movers down to levels 2–3,
slow movers up to level 5, Critical-expiry SKUs consolidated onto one level, and confusable
neighbours separated. Presented as a reviewable table (the same shape as M2.2.5), applied on
confirm through the existing Relocate action, with labels reprinted automatically.

**Objectives.** G4, G1 (a shorter, lower reach for the SKUs touched most), G3 (fewer reaches
above shoulder height on a step stool is fewer dropped and mis-shelved units).

**Evidence.** PRD §7.3 states the rules as fact — *"Fast movers on levels 2–3 / Slow movers on
level 5"* — and HANDOFF §11 is where they come from: *"Level 5 sits at ~2.0 m, above
comfortable pick height. Slow shades on level 5, fast movers on levels 2–3, step stool
provided."* But HANDOFF §4 finding 2 and §16 Q8 both say the velocity input does not exist:
*"Sales per SKU per day — pure guess — get this from Grab."*

**Why the draft does not cover it.** §7.3's slotting rules have **no data source at slotting
time**. M2.2.5's bulk slot plan runs on day 0, before a single sale, so "fast mover" is
undefined and the plan will fall out in CSV order — which for `wardah_sku_list.csv` means
Glasting 01 through 21 laid out in one contiguous run, precisely the adjacency §7.3 flags as
a risk. M2.2.3 provides Relocate as a manual, one-SKU-at-a-time action; nothing ever revisits
the plan. The rules are written as if velocity were known and are inert until something
computes it. This is the clearest example of the draft's day-2 blind spot.

**Cost.** **S–M, v1.1.** A ranking query over `stock_movements`, a diff view, and reuse of
Relocate + label printing.

**Cost of omitting.** The initial slot plan is frozen forever, made without the one input that
determines whether it is any good, and the ergonomics rule the space model went to some
trouble to establish never actually applies to anything.

---

## 14. Cold-chain condition log

**What.** A daily one-number entry per site (temperature, optionally RH), 5 seconds at shift
open, with an out-of-range flag and an alert; or a webhook endpoint so a cheap logger can post
readings automatically. Reportable as a date-ranged chart per site, exportable.

**Objectives.** G2 (site-level attribution and timestamping, which is what makes a log
evidentiary), G4.

**Evidence.** HANDOFF §10, verbatim and unambiguous: *"Pitch the cooled room as a
differentiator: a bare dark-store shelf in Jakarta is open ambient, and the temperature log is
Ninja's defence in any consignment shrinkage dispute."* Same section: *"105 of 118 SKUs need
temperature control (lip 59 and sun care 9 are the acute ones)"*, against a Jakarta ruko at
30–38 °C and a cosmetic limit of ~27 °C. HANDOFF §11 specifies the ½ PK inverter and the
24–25 °C set point. HANDOFF §6 item 5 asks *"who owns shrinkage"* under consignment.

**Why the draft does not cover it.** PRD §2.3 models the cooled zone as a *physical* fact
("Storage zone 7.2 m², cooled, 24/7, dedicated") and then never records anything about it.
The word *temperature* does not appear in the PRD. The source document names the log as the
commercial defence and the draft did not turn it into a feature — the clearest single case of
a HANDOFF finding not carried across.

**Cost.** **S, v1.1.** One table, one input, one chart, one alert rule.

**Cost of omitting.** In a heat-damage or shrinkage dispute with Wardah, the defence HANDOFF
explicitly identified does not exist. Also, an AC failure over a weekend goes unnoticed until
someone opens the door on Monday.

---

## 15. Consignment stock statement for the brand

**What.** A scoped, read-only `brand_viewer` role (SSO email → brand, no site write access)
plus a scheduled statement: on-hand by SKU by site, period movements, opname variance summary,
expiry ages for the Critical tier, and stock at cost/retail. Delivered as a portal view and a
weekly CSV/PDF via proposal 7.

**Objectives.** G5 (a brand-scoped reporting surface is part of what makes brand #2
configuration), G2, G3.

**Evidence.** HANDOFF §1: *"The commercial model is consignment — Wardah owns the inventory
sitting in Grab's hubs."* HANDOFF §6 item 5 asks *"at what point does title transfer, who owns
shrinkage, and how is expiry handled?"* The stock owner will ask for its position, weekly,
forever.

**Why the draft does not cover it.** §4 defines four personas, all Ninja-internal. M7.5's
cross-site view is Admin-only. §11's `users.role` enum is
`admin | supervisor | staff | hub_operator` with no external role. NG7 excludes financial
reconciliation and settlement, which is right — but a *stock statement* is not settlement, and
without it the answer to Wardah is a manual CSV export from M6.3.5 every week, by hand,
forever.

**Cost.** **M, v1.2.** Mostly access-scoping and report assembly; the sensitivity is external
identities under §5.4's SSO model, which needs a decision.

**Cost of omitting.** A recurring manual reporting burden on ops, and a weaker commercial
position — the visibility is a differentiator against a bare Grab dark-store shelf, in exactly
the way HANDOFF §10 argues the cooled room is.

---

# Part 2 — What the draft gets wrong

Listed in descending order of how much it would cost to leave as written.

### W1. The look-alike adjacency rule is backwards, and the mitigation named for it does not exist on two of three flows

§7.3: *"SKUs of the same product line kept adjacent — a picker looking for shade 07 sees 06
and 08 either side, which is both a help and a risk — the scan gate covers the risk."*

Two problems. First, the scan gate exists **only on pick** (M5.2.4). Putaway (M3.3) has no
destination verification and opname (M6.2.5) catches a mis-slot only after it has been wrong
for up to a week. The risk is mitigated on one of the three flows that create it. Second, the
rule as stated *maximises* the probability that a mis-reach lands on a confusable: with 21
Glasting shades in one run, every basket has a near-identical neighbour on both sides.

Recommend: keep the product **line** on one rack for findability, but break the numeric
sequence across levels so shade 07's physical neighbours are 02 and 14, not 06 and 08 — and
build proposal 4. The "help" the rule buys is minimal once the system tells the picker the
exact location; the risk is not.

### W2. The only expiry data in the system is handwriting on a reprintable label

§7.2 item 6 puts the expiry month for the 11 Critical SKUs in *"a marked box, handwritten"*,
and the same section says *"regenerating a label after a slot change is a one-click action."*
Reprinting silently destroys the only expiry record. Meanwhile §6 states the expiry tier
*"drives labelling and sweep frequency, not system logic in v1"* while no sweep is scheduled
anywhere in §8, §17 has no expiry metric, and §16 Q9 assigns no owner. Net effect: for the
one product family where date exposure is real (7 sunscreens), expiry is unrecorded,
unscheduled, unowned and unmeasured. Proposal 9 fixes this within the §5.1 no-serialisation
constraint.

### W3. Deferring the whole exception class (NG3 / §15) is wrong for E8 and E10 specifically

The general instinct is right — most of E1–E28 genuinely can wait. But two of them are not
exceptions, they are **daily events**: E8 (basket empty when the system says stock) and E10
(order cancelled after picking). The draft says so itself about E8: *"Highest frequency,
highest impact."* A v1 that defers its own highest-frequency event ships knowing it will fail
several times a shift. Both have cheap answers (proposals 1 and 12). Additionally, §15's
governing principle — *"stop and flag for a supervisor"* — is specified with no place for the
flag to land (proposal 6). "Stop and flag" without an inbox is "stop and shout."

### W4. The CSV importer is specified to the shape of a defective one-off file, and that contradicts G5

M1.2.2: import *"in the exact column shape of `wardah_sku_list.csv`."* That file is an OCR
reconstruction (HANDOFF §2), contains 108 of 118 SKUs, carries a spreadsheet total row with
live formulas, has an embedded comma inside a quoted name, uses `~`-prefixed approximate
sizes, and — decisively — has **no barcode column and no brand SKU code**, while §11 declares
`skus UNIQUE(brand_id, brand_sku_code)`. As specified, the importer cannot populate its own
unique key from its own named source file. Build column mapping (proposal 11), and treat this
CSV as one test fixture, not the contract.

### W5. The recount in M6.2.8 is not blind, which defeats M6.2.3

M6.2.3 hides expected quantity, correctly: *"Showing it invites confirming the number instead
of counting it."* But M6.2.7 reveals expected vs counted on **Finish basket**, and only then
does M6.2.8 prompt for a recount. The staffer now knows the target before recounting. The
recount will match the expectation, the variance will disappear, and the blind-count discipline
established two clauses earlier is undone at the one moment it matters most. Fix: keep the
recount blind — on variance, re-prompt to count again *without* revealing anything, and reveal
only after the second count. Reveal the first count's number in the supervisor's report, not
on the staffer's screen.

### W6. `E13 absent` + `E28` is an unbreakable deadlock

M5.2.5 correctly refuses a staff override on a wrong-SKU scan, and §15 E13 deliberately omits
even a supervisor override *"so that the gate cannot be trained around."* Sound. But E28 —
*"barcode registered to the wrong SKU and discovered only after picking has begun"* — is also
deferred, and the two together mean a single mis-bound barcode blocks **every pick of that SKU
at that site, permanently**, with no in-app path forward. Every affected order fails and Grab
refunds. Provide a path that is not an override of the gate: a *"this barcode is wrong"*
report on the block screen that routes to the exception queue and lets a supervisor unbind and
rebind (M1.3.8 already exists) in under a minute. Keep the gate unoverridable; make the data
fixable.

### W7. §9.2's push cadence is hostile to a system that overwrites the whole Grab menu

*"On every balance change the WMS pushes... batched, at most once per SKU per few seconds."*
During the 4,950-unit inbound burst that is 118 SKUs churning for hours, against a POS whose
Malaysia learning is *"API cutover overwrites the whole Grab menu, so timing matters"*
(HANDOFF §16). Suppress pushes while a receipt is open; publish once on completion. Covered
in proposal 2.

### W8. §16 Q5 (connectivity) is sequenced after the work that depends on it

§5.2 accepts online-only and mitigates it with a site survey, but §14 schedules P2 (the whole
inbound scan loop, designed around a 4,950-unit uninterrupted burst) well before pilot. If the
survey comes back bad — inside a partitioned, cooled, metal-racked rear corner of a ground
floor (HANDOFF §11), which is a plausible outcome — P2's design is invalidated after it is
built, and §5.2's own escape hatch says offline-first would then be *"a phase-2 decision, not
a v1 patch."* Move Q5 to a P0 exit criterion. It costs an afternoon and a phone. Also, the
board's per-site scan-latency telemetry (proposal 6) turns a one-off survey into continuous
evidence.

### W9. Site codes are load-bearing and the source documents have already renamed them twice

§7.1 embeds the site code in every location address (`UT5-A-3-02`) and every printed basket
label. HANDOFF §14 renamed KJ5 → KJR, KM5 → RBU and CP5 → KOI-CP5 against the contract
register; HANDOFF §16 then records the user's canonical list reverting to KJ5 and KM5. PRD
§2.4 currently mixes both generations (KJR and RBU alongside MAC-MAC). A rename after labels
are printed means reprinting every basket label at that station. Make the site **code**
immutable once locations exist, carry a separate mutable display name, and note in §7.1 that
the label prints the code, not the name.

### W10. Two smaller ones

- **M5.2.6** verifies identity by scanning **one** unit for a line of quantity > 1. On a
  confusable run this means unit 2 is unverified. Given HANDOFF §12 puts the average order at
  1.8 units, mandating scan-each on pick costs almost nothing and closes the hole — make
  scan-each the default rather than "available as a stricter site-level setting."
- **§17's onboarding metric** (*"new 118-SKU brand at a site ≤ 1 day"*) is unreachable while
  M1.2.4 blocks slotting on 118 photographs with no capture flow. Either build proposal 11's
  photo mode or restate the metric.

### What the draft gets conspicuously right — keep these

- **§5.1** rejecting per-unit license plates. Correct for a 118-SKU, ~5,000-unit, 3–5 s/unit
  operation, and the reasoning is sound.
- **§5.5** one basket = one SKU, enforced by unique constraint. The single best decision in the
  document; most of the proposals above are cheap *because* of it.
- **§6.1** `StockMovement` as an append-only ledger with balances as a rebuildable projection.
- **§10.2.3** idempotent scan endpoints keyed on a client-generated scan id.
- **M6.2.3** blind counting (subject to W5).
- **§9.3** building the dummy generator against the same endpoint the real POS will use.

---

# Part 3 — Real-WMS features that would be wrong here

Naming these is part of the answer. All are standard in larger operations and all are a poor
fit for a 118-SKU, 7-rack, 7.2 m² cell picking 1.8 units per order.

| Feature | Why not here |
|---|---|
| **Wave / batch / cluster picking** | §16 Q11 defers it pending order volume; it should be **rejected**, not deferred. The pick face is 4.0 m × 1.8 m (HANDOFF §11) — the "walk" a wave would consolidate is about three metres. Batching adds order latency against a 30-minute promise for a saving of seconds. Even at 500 orders/day this stays wrong. |
| **Put-to-light / pick-to-light** | Hardware per location × 118 locations × 10 stations, to replace a screen that already shows one location in 32 px type. The economics do not survive contact with a Rp 13–26 jt cooled room as the comparison capex. |
| **Voice picking** | Same conclusion, plus it is a headset per staffer in a high-turnover workforce and a second interaction model to train. |
| **Unit-level serialisation / license plates** | Already correctly rejected in §5.1. Do not revisit for FEFO — proposal 9's basket-level date gets ~90% of the benefit for ~2% of the cost. |
| **A slotting optimisation engine** | 118 SKUs across 33 shelf levels is a problem a supervisor solves by looking at the rack map (M2.2.4). Proposal 13's ranked diff is the right depth; a solver is not. |
| **Full offline-first with client-side conflict resolution** | §5.2's reasoning holds. Fix connectivity (W8) rather than building a distributed system for ten laptops. |
| **Dock, yard, appointment scheduling, LPN/pallet hierarchy** | There is one inbound pallet position (HANDOFF §12) and a fortnightly or weekly delivery. |
| **Demand forecasting / auto-replenishment** | Correctly excluded as NG4. M4.6's advisory suggestion is the right ceiling, particularly while HANDOFF §16 Q8 says the velocity input is still a guess. |
| **Multi-step kitting / bundling / value-add services** | No evidence of bundle SKUs in `wardah_sku_list.csv` or in any source. If Grab later sells bundles, that is a POS-side composition, not a WMS assembly flow. |
| **Task interleaving across work types** | A real gain at 50,000 SKUs with travel time to amortise. Here it would trade the draft's best property — one task per screen, one action per screen (§4) — for nothing. |

---

## Suggested sequencing

Two things change in the release plan (§14) if these are accepted:

- **Into P0:** Q5 connectivity survey as an exit criterion (W8).
- **Into P2 (inbound):** proposals 3 (expected inbound + claim pack), 4 (two-scan putaway),
  9 (expiry register), 11 (photo capture + readiness board).
- **Into P3 (outbound):** proposals 1 (zero-on-empty), 2 (publish policy), 8 (order evidence).
- **Into P4/P5:** proposals 5 (training), 6 (exception queue + board), 7 (notifications) —
  though 5 and 6 arguably belong earlier, since P7's pilot cannot be run honestly without
  either.
- **v1.1, after the pilot has produced movement history:** 10 (cycle-count queue),
  12 (reverse putaway), 13 (re-slot), 14 (temperature log).
- **v1.2:** 15 (brand statement).

Everything above fits the Substrait contract: FastAPI endpoints under `/api`, Flyway
migrations on OceanBase, object storage for photos, claim packs and evidence PDFs, Google SSO
for the new `brand_viewer` role. Only proposal 7 adds a new dependency — outbound email or a
webhook — and needs one `# secret` entry in `backend/.env.example`. Nothing here requires
Redis, Kafka, or a change to `database: oceanbase`.
