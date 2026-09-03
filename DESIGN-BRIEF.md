# Ninja Kilat WMS — Design Brief

Companion to [PRD.md](PRD.md). Part 1 is the brief. Part 2 is the artboard plan. **Part 3 is a self-contained prompt to paste into Claude Design** — it repeats what it needs so you don't have to send the PRD with it.

---

## Part 1 — The brief

### 1.1 What is being designed

The station-facing web app for a warehouse management system. It sits underneath an existing POS and handles four jobs: receiving stock into baskets, picking orders, counting stock weekly, and configuring what goes where.

It is **not** a dashboard product. Three of the four main flows are a person standing at a rack with a barcode gun in one hand and a lipstick in the other, looking at a screen a metre away. Design for that posture, and the admin screens will follow.

### 1.2 Who uses it

| | |
|---|---|
| **Primary** | Station staff. Predominantly high-school graduates. High turnover — assume the person using this screen started last week. Bahasa Indonesia first language. No warehouse-systems background, no training beyond a ten-minute walkthrough. |
| **Secondary** | Station supervisors — variance review, sign-off, resolving blocked staff. |
| **Tertiary** | Ops admins at HQ — brand onboarding, slotting, cross-site reporting. |

### 1.3 The conditions this is used in

These are not edge cases; they are the normal operating environment and they drive every visual decision.

- A **shared laptop at 1366×768**, propped on a packing bench, viewed from around a metre away while standing.
- A **phone** during the pilot and for spot checks — the same screens at 375 px.
- **Dim light.** Station backrooms are lit for storage, not for reading. Screens get dust and fingerprints.
- **Hands are full.** A barcode gun in one hand, product in the other. Most interactions are a scan, not a tap. Assume the mouse is not being touched.
- **Interruption is constant.** A rider arrives, a call comes in. Every screen must survive being abandoned for four minutes and returned to.
- **Noise.** Audio feedback helps but cannot be the only feedback.

### 1.4 The one governing idea

> **The screen tells you what to scan. You scan it. It turns green or red.**

Every guided flow in this product is that loop. Inbound, pick, opname and labelling differ in what the system does with the scan — never in what the staffer does. A person who learns one flow has learned all four.

Design the loop once, properly, and the product is mostly designed.

### 1.5 Principles

1. **One task per screen, one primary action per screen.** If a screen has two things a person could do next, it is two screens.
2. **The instruction is the biggest thing on the page.** Not the logo, not the nav, not the order number. `SIMPAN DI → UT5-A-3-02` at 48 px+, with everything else quieter.
3. **Photo before name, name before code.** Shade 07 and shade 08 are indistinguishable as text and obvious as images. Product photography is functional here, not decorative — give it real space.
4. **No free text, ever.** Numbers come from steppers and a big keypad. Selection comes from search-as-you-type or a scan. A station staffer should never meet a bare text field.
5. **State is carried three ways at once** — colour, icon and words. Dim screens and colour-blind staff both break a colour-only system.
6. **Errors say what happened and what to do.** Not "Invalid scan." Instead: *"This is Glasting Lip 08. The order wants 07. Put it back and take 07 from the same basket."*
7. **Blocked is a legitimate state.** When the system doesn't know what to do (28 exceptions are deliberately unbuilt), it stops and says *call your supervisor*. Design that screen properly — it will be seen often and it is the product's honesty showing.
8. **Undo is always one tap.** Always visible, never buried, never a confirm dialog for the last scan.

### 1.6 Colour — and the one trap to avoid

**Red must mean "stop, you did something wrong" and nothing else.**

Ninja Van's brand is red. If red is also the button colour, the header colour, the link colour and the accent, then the red error state has no force left. Every warehouse tool that gets this wrong trains its staff to ignore red.

The rule for this product:

- **Red is reserved for failure and blocking.** No button, no link, no accent, no nav item may be red.
- The brand mark may sit in the header in brand red, at small size, as identity only.
- **The primary action colour is a deep, near-neutral blue-black.** It carries buttons, focus rings and selection.
- **Green means accepted**, and appears almost exclusively as scan confirmation.
- **Amber means "recorded, but a human should look"** — foreign item found, over capacity, variance.

Semantic colour is a separate system from brand colour, and semantic wins.

Suggested palette, to be pushed on rather than accepted:

| Role | Light | Dark | Used for |
|---|---|---|---|
| Ground | `#F4F4F2` | `#131416` | Page background |
| Surface | `#FFFFFF` | `#1C1D20` | Cards, panels, scan zone |
| Ink | `#17181A` | `#F0EFEC` | Primary text |
| Ink muted | `#5E6064` | `#A8A7A3` | Labels, secondary |
| Rule | `#DEDDD8` | `#2F3034` | Borders, dividers |
| **Action** | `#1B3A5C` | `#5E9BD1` | Buttons, focus, selection |
| **Accept** | `#127A45` | `#42C182` | Scan accepted, complete |
| **Caution** | `#8A5A05` | `#DCA33F` | Variance, foreign item, over capacity |
| **Stop** | `#C01D22` | `#F2545B` | Wrong item, blocked, error only |
| Brand | `#C01D22` | `#F2545B` | Header mark only. Never interactive. |

Contrast floor is 4.5:1 for everything, and higher for the primary instruction. Both light and dark themes are required — a backroom at night and a bench near a roller door are different rooms.

### 1.7 Typography

Two requirements the subject imposes:

- **Codes must be unambiguous.** Location codes mix letters and digits (`UT5-A-3-02`); Mode B plate codes are ten digits (`NJ 0000041827`). A face where `0`/`O` and `1`/`l`/`I` collide will cause real mis-reads when a staffer reads a code aloud over the phone.
- **It must read at a metre, in Indonesian.** Indonesian words run long (*"Pindai barcode untuk melanjutkan"*), so the face needs to stay legible at width without condensing.

Recommended pairing:

- **IBM Plex Sans** for interface text — humanist, open apertures, holds up small and large, and has proper Indonesian coverage.
- **IBM Plex Mono** for every code, quantity and identifier — location codes, plate codes, SKU codes, counters. Its slashed zero and disambiguated glyphs are the reason to pick it, and using mono for codes also teaches the eye that "mono means this is a code."

Scale, on the 1366×768 target:

| Role | Size | Weight |
|---|---|---|
| Primary instruction (`SIMPAN DI`, `AMBIL`) | 30–34 px | 600 |
| Location / plate code | 48–60 px, mono | 600 |
| Product name | 22–26 px | 500 |
| Body, labels | 16–18 px | 400 |
| Field label / eyebrow | 12–13 px, mono, letterspaced, uppercase | 500 |
| Counter (opname, labelling) | 72–96 px, mono, tabular | 600 |

Minimum tap target 48 × 48 px. Buttons in guided flows should be considerably larger — 64 px tall, full width of their column.

### 1.8 Language

**Design every screen in Bahasa Indonesia.** It is the default and the majority language of the users; designing in English and translating later produces screens that fit English string lengths and break in Indonesian.

Write at roughly a junior-high reading level. Use the words a station staffer already uses, not warehouse vocabulary:

| Say | Not |
|---|---|
| Simpan di | Lokasi putaway |
| Ambil | Pick |
| Hitung stok | Stock opname / cycle count |
| Barang masuk | Inbound receipt |
| Keranjang | Bin / tote |
| Salah barang | Invalid SKU |
| Panggil supervisor | Escalate exception |

Product names, brand names and location codes are never translated. An English toggle sits in the header, one tap, and must be shown in the design.

### 1.9 Components the system needs

Design these once; every screen assembles from them.

- **Scan zone** — the persistent, always-focused input target. It is the most important component in the product. It needs a resting state (waiting for a scan), an accepted state, a rejected state, and a "not connected" state. It should read as a target even though nobody clicks it.
- **Guided task shell** — instruction line, product block (photo + name), the big code, progress (`3 / 7`), undo, and a single primary action. Inbound, pick, opname and labelling are all instances of this.
- **Product block** — photo, full name, size, brand. One object, same proportions everywhere.
- **Code chip** — mono, tabular, for locations and plates. Rack letter and level want emphasis within the code, since that is what a person navigates by.
- **Counter** — the giant number in opname and labelling.
- **Status banner** — accepted / caution / blocked, with icon and text.
- **Basket card** — used in opname lists and the rack map. Carries claim state (*"Sedang dihitung: Rina"*).
- **Rack map** — 7 racks × 5 levels × up to 5 positions, colour-coded, legible on one screen at 1366×768. This is the one genuinely dense view in the product.
- **Big keypad and stepper** — quantity entry.
- **Connection indicator** — persistent, because the app is online-only and a dropped connection blocks work.

### 1.10 What this should not look like

- Not a generic SaaS admin template — sidebar, breadcrumbs, dense tables, 14 px grey text.
- Not a consumer app — no playful illustration, no rounded-everything, no gradients.
- Not a dashboard first. Charts and KPI tiles belong only in the supervisor and admin views, and even there the job is *"is something wrong right now"*, not analytics.

The closest useful reference is **airport and transit signage**: enormous type, ruthless hierarchy, colour used sparingly and semantically, and information legible at speed by someone who is not paying full attention.

---

## Part 2 — Artboard plan

Thirteen screens, grouped by flow. Design at **1366 × 768** unless noted.

**Flow A — Barang Masuk (Inbound), Mode A**
1. **Start receipt** — choose source: from brand, or scan a transfer label. Shows the banner that tells the staffer whether barcodes may need registering.
2. **Scan loop, accepted** — the core screen. Photo, name, `SIMPAN DI → UT5-A-3-02` huge, current basket quantity, running session total, undo.
3. **Unknown barcode** — three large forks: register to a SKU, flag for supervisor, skip.
4. **Create basket inline** — SKU has no home; pick size (pre-selected) and location (pre-selected), two taps, return to the loop.

**Flow B — Label Unit (Mode B)**
5. **Labelling screen** — SKU locked with photo and the sticker placement rule, giant counter, apply-then-scan loop, undo.
6. **Plate already bound** — blocking error naming the SKU the plate belongs to.

**Flow C — Ambil Pesanan (Pick)**
7. **Pick line** — `PERGI KE → UT5-A-3-02`, photo, name, `AMBIL → 2`, progress `3 / 7`.
8. **Wrong item scanned** — full-bleed stop state, both products shown side by side with photos, plain instruction, no override.
9. **Order complete** — summary, hand-off to the POS packing ticket.

**Flow D — Hitung Stok (Opname)**
10. **Basket list** — ordered by pick path, showing which baskets are claimed and by whom.
11. **Counting, blind** — location, photo, name, giant counter, no expected number visible.
12. **Variance revealed** — expected vs counted, the difference, and a single prompt to recount.

**Flow E — Supervisor**
13. **Rack map** — 7 racks, 5 levels, colour-coded free / occupied / over-capacity / needs-count, with a variance summary panel.

Optional if the canvas has room: a **blocked / call-supervisor** state (principle 7), and a **mobile 375 px** version of the pick line screen to prove the layout survives.

Use realistic content throughout — real Wardah SKU names (*Glasting Liquid Lip 07 Rouge Flare*, *UV Shield Airy Smooth Sunscreen SPF 50*), real location codes, Indonesian copy. Never lorem, never "Product Name".

---

## Part 3 — Prompt for Claude Design

Copy everything below the line.

---

Design a warehouse app for Ninja Van's quick-commerce fulfilment operation in Jakarta. Produce a design canvas with the thirteen artboards listed at the end, at 1366 × 768 each.

**Context.** Ninja Van picks and packs cosmetics orders for GrabMart Kilat. Station staff work in a small backroom: seven shelving racks holding one basket per product, 118 products from the brand Wardah — 54 of which are lipstick shades that differ only by a number and a colour name. Staff receive stock into baskets, pick orders, and count stock weekly.

**Who uses it.** High-school graduates, high turnover — assume the person on this screen started last week. Bahasa Indonesia first language, no systems background, ten minutes of training. They stand at a shared laptop on a packing bench, viewed from about a metre away, in dim storage lighting, holding a barcode gun in one hand and a product in the other. They barely touch the mouse. They are interrupted constantly.

**The governing idea.** Every working screen is the same loop: *the screen tells you what to scan, you scan it, it turns green or red.* Receiving, picking, counting and labelling differ only in what the system does with the scan. Someone who learns one has learned all four. Design that loop properly and the product is mostly designed.

**Principles.**
- One task per screen, one primary action per screen.
- The instruction is the biggest thing on the page. A location code like `UT5-A-3-02` should be 48–60 px and readable from a metre away. The logo and navigation are the quietest things on screen.
- Photo before name, before code. Shade 07 and 08 are identical as text and obvious as images, so product photography is functional — give it real space.
- No free text fields anywhere in the staff flows. Numbers come from big steppers and a keypad.
- Every state is carried three ways at once: colour, icon and words.
- Errors say what happened and what to do next, in plain Indonesian: *"Ini Glasting Lip 08. Pesanan minta 07. Kembalikan dan ambil 07 dari keranjang yang sama."* Never "Invalid scan".
- "Blocked — call your supervisor" is a legitimate, frequently-seen state. Design it properly rather than treating it as an edge case.
- Undo is always one tap and always visible.

**Colour — the important constraint.** Ninja Van's brand colour is red, but in this product **red is reserved exclusively for failure and blocking**. No button, link, accent or nav item may be red, or staff will learn to ignore the red error state. The brand mark may appear small in the header as identity only. Use a deep blue-black as the primary action colour, green only for scan-accepted, amber for "recorded but a human should look" (variance, foreign item, over capacity). Semantic colour is a separate system from brand colour and semantic wins. Both light and dark themes; contrast floor 4.5:1; the screen is dim and dusty.

**Typography.** Use IBM Plex Sans for interface text and IBM Plex Mono for every code, quantity and counter. The mono face is chosen for its slashed zero and disambiguated glyphs, because location codes mix letters and digits and staff read them aloud over the phone. Primary instructions 30–34 px, location codes 48–60 px mono, counters 72–96 px mono tabular, body 16–18 px, eyebrow labels 12–13 px mono uppercase letterspaced. Minimum tap target 48 px; primary buttons in guided flows 64 px tall.

**Language.** Design every screen in Bahasa Indonesia, at a junior-high reading level, using warehouse-floor words rather than logistics jargon: *Simpan di* not *Lokasi putaway*, *Ambil* not *Pick*, *Hitung stok* not *Stock opname*, *Keranjang* not *Bin*, *Panggil supervisor* not *Escalate*. Product names and location codes stay untranslated. Show a small EN/ID toggle in the header.

**Reference point.** Airport and transit signage: enormous type, ruthless hierarchy, sparing semantic colour, legible at speed by someone not paying full attention. Explicitly not a generic SaaS admin template with a sidebar, breadcrumbs and 14 px grey tables, and not a playful consumer app.

**Use real content.** Real Wardah product names (*Glasting Liquid Lip 07 Rouge Flare*, 3.5 g, Rp 101.000; *UV Shield Airy Smooth Sunscreen SPF 50*), real location codes (`UT5-A-3-02`, `UT5-C-5-04`), real Indonesian staff names, plausible quantities. Never placeholder text.

**Artboards:**

1. **Mulai Barang Masuk** — start a receipt: choose delivery from the brand, or scan a transfer label from the hub. A banner states whether new barcodes may need registering.
2. **Barang Masuk — scan diterima** — the core screen. Product photo, full name, `SIMPAN DI → UT5-A-3-02` dominant, current quantity in that basket, running session total, undo.
3. **Barcode tidak dikenal** — unknown barcode, three large forks: register it to a product, flag for supervisor, skip.
4. **Buat keranjang baru** — this product has no home yet; choose basket size and location, both pre-selected, two taps, back to the loop.
5. **Label Unit** — for brands with no barcodes, staff stick a unique Ninja label on each item. Product locked on screen with photo and a sticker-placement instruction, giant counter, apply-then-scan loop.
6. **Label sudah terpakai** — blocking error: this label is already on another product. Name that product.
7. **Ambil Pesanan** — pick screen. `PERGI KE → UT5-A-3-02` dominant, photo, name, `AMBIL → 2`, progress `3 / 7`.
8. **Salah barang** — full-bleed stop state. The scanned product and the wanted product side by side with photos, plain instruction, no override button.
9. **Pesanan selesai** — summary and hand-off to the packing station.
10. **Hitung Stok — pilih keranjang** — basket list in walking order, showing which baskets another staffer is already counting and their name.
11. **Hitung Stok — menghitung** — location, photo, product name, a giant counter. The expected number is deliberately hidden.
12. **Hasil hitung** — expected vs counted revealed, the difference emphasised, one prompt to recount.
13. **Peta rak** — supervisor view. Seven racks × five levels × up to five basket positions, colour-coded free / occupied / over-capacity / needs counting, with a variance summary panel. This is the only dense screen in the product; everything else is one task at a time.

If room allows, add a "blocked — call supervisor" state and a 375 px mobile version of artboard 7.
