# Ninja Kilat WMS — design brief v2

**For:** Claude Design
**Supersedes:** `DESIGN-BRIEF.md` (v1, which produced the 14 screens now in `frontend/`)
**Date:** 9 September 2026

---

## 0. Read this first: the brief is for TWO products, not one

The reference that prompted this revamp is a modern SaaS admin console — sidebar
nav, KPI cards, a dense sortable table, status pills, filter/sort/export toolbar,
bulk-select action bar, pagination. It is a good target and we should build it.

**But it is the right pattern for only half of this app, and the wrong pattern for
the other half — the half that matters most.**

| | **Console** | **Station** |
|---|---|---|
| Who | Supervisors, admins, ops leads | Station staff |
| Where | A desk, a real screen, a mouse | The warehouse floor, standing |
| Holding | Nothing | A barcode gun, sometimes gloves |
| Distance to screen | 50 cm | An arm's length or more |
| Session | Minutes, exploring | 3 seconds, one decision |
| Volume | Occasional | ~4,950 units per delivery |
| Reference applies? | **Yes — build exactly this** | **No — see §2** |

A staffer scanning 4,950 units does not need a sidebar, a filter bar, or a 14 px
table. They need one instruction the size of a fist, a scan target, and a colour
they can read across the room. Shrinking that into the reference's density would
make the product slower and more error-prone, and the errors are expensive:
**Grab refunds the customer and charges the merchant by default**, and an inbound
discrepancy not raised within 24 hours is borne by the station.

So: **build the Console to look like the reference. Modernise the Station's
finish without touching its ergonomics.** §2 and §3 say exactly what that means.

If you only have appetite for one, do the **Console** — it is entirely new
surface (the four features below have no screens at all yet), while the Station
screens already work.

---

## 1. What the product is

Ninja Van runs fulfilment for brands selling on GrabMart Kilat (quick commerce,
~15 minute delivery). Grab owns demand and order creation; Ninja owns the
warehouse. This WMS is the warehouse side.

- **Pilot brand: Wardah** — 118 cosmetics SKUs, many near-identical shades
  ("Glasting Liquid Lip 07 Rouge Flare" vs "08 Coral Dust"). Shade confusion is
  the single most common error and the design must fight it everywhere.
- **~10 stations**, each ~7.2 m² of storage: 7 racks × 5 levels × 5 positions.
  One basket holds exactly one SKU. Locations read `UT5-A-3-02` =
  site-rack-level-position.
- **Staff are typically high-school graduates**, on shared station devices, and
  turn over. Indonesian is the default language; English is one tap away.
- Live at `https://wms-test.ninjavan.apps.substrait.build`.

**Non-negotiable constraint:** the app is online-only. A dropped connection must
block work loudly, not degrade silently.

---

## 2. Station — evolve, do not replace

The 14 existing screens in `frontend/` (`index.html`, `01-`…`16-`) are
ergonomically right. They look dated because of *finish*, not *structure*.

### Keep, without exception

These are not stylistic preferences; each is load-bearing.

1. **Red is only failure.** `--stop` red never appears on a button, link, nav
   item, or accent. Primary actions are `--action` (deep blue-black). A red
   thing on screen means *stop*, always.
2. **Three-way state.** Every state carries colour **and** an icon **and**
   words. Audio is additive, never the only signal. This is what makes the app
   work for the ~8% of men with a colour-vision deficiency, and in a noisy room.
3. **No free text in staff flows.** Quantities come from a stepper and a keypad.
   The only `<input>` in the whole Station surface is the invisible scan target.
4. **Tap targets ≥ 48 px**; primary buttons in guided flows 64 px.
5. **Copy lives in the markup** as `data-id` / `data-en`. ID is default; the EN
   toggle swaps text without touching layout. Every new string needs both.
6. **One decision per screen.** No screen asks two questions.
7. **The scan zone is always focused** and reclaims focus aggressively. A
   barcode gun is a keyboard that types fast and hits Enter.

### Change — this is the "modern" gap

The current tokens are flat and sharp in a way that reads as 2012:

| Token | Now | Move to | Why |
|---|---|---|---|
| `--radius` | `2px` | `10px` (cards, panels), `8px` (buttons), `6px` (chips) | The single biggest "dated" signal |
| Elevation | none | a 2-step soft shadow scale | Cards should sit *on* the ground, not be drawn on it |
| `--ground` | `#F4F4F2` | a cooler, cleaner off-white | Currently slightly yellow, reads dingy |
| Type | IBM Plex Sans | keep, or move to Inter / Geist | Plex Mono is excellent for codes — **keep the mono** |
| Spacing | 6-step | keep, but increase breathing room in cards | Density is currently too tight for the surface area available |
| Motion | none | 120–160 ms ease on state change; a scale/flash on scan accept | Feedback currently snaps; it should *land* |
| Borders | 1–2 px everywhere | fewer borders, more shadow + ground contrast | Border-heavy is the other dated signal |

**Scale stays as it is.** `--fs-instr: 32px`, `--fs-code: 60px`,
`--fs-counter: 96px` are correct for arm's-length reading. Do not shrink them to
look tidier. The screenshot's 14 px table type is right for a desk and wrong
here.

---

## 3. Console — build this, to the reference

New surface. Follow the reference image closely: persistent left sidebar,
content area with a page title row, a KPI stat-card row, a toolbar
(filter / sort / view / export / primary action), a dense data table with status
pills, and pagination. Rounded corners, soft shadows, generous white space, one
accent colour.

**Accent:** Ninja red is reserved for failure, so the Console's accent must be
something else. Use `--action` (deep blue-black) as the primary and pick one
supporting accent that is **not** red. The reference's orange is close to our
`--caution`; if you use an orange accent, retune `--caution` so a warning is
still distinguishable from a button.

**Sidebar sections** (this is the real IA):

```
NINJA KILAT WMS
  ⌂  Ringkasan            Dashboard
MASUK & KELUAR
  ↓  Barang masuk         Inbound receipts + putaway slips
  ↑  Pesanan              Orders and pick tasks
  ⧉  Stok                 Inventory by SKU / location
  ✓  Hitung stok          Opname plans and variance
CETAK
  ▤  Slip putaway         Slip archive          ← NEW
  ▦  Label & warna hari   Label printing        ← NEW
PENGATURAN
  ⌂  Hub                  Sites + rack settings ← NEW
  ⚇  Staf                 Staff emails + roles  ← NEW
  ▣  Produk (SKU)         SKUs + barcodes       ← NEW
UJI COBA
  ⚙  Simulator Grab       Test order creation   ← NEW
  ⚑  Mode latihan         Training reset/scenarios
```

Everything marked NEW has a working API and **no screen at all** — that is the
bulk of this brief.

---

## 4. The four new features — what to design

All four have live, deployed endpoints. Shapes are in `openapi.json` at the repo
root; base path `/api`.

### 4.1 Admin (`Pengaturan`) — three screens

**Staf** — `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}`.
Table: email, name, role, sites, active. Row actions: edit role, assign sites,
deactivate. "Add staff" opens a panel with email, name, role
(`admin`/`supervisor`/`hub_operator`/`staff`), default site, and a multi-select
of sites.

> Two rules the UI must express, because the API enforces them and a silent 422
> is a bad experience: **you cannot deactivate your own account**, and **you
> cannot change your own role.** Grey those controls out on your own row with a
> tooltip saying why, rather than letting the click fail.

**Hub** — `GET /api/admin/sites`, `PATCH /api/admin/sites/{id}`.
Card or table per site: code, name, address, type, active, staff count, and a
**rack summary** (per rack: levels, positions per level, locations, occupied).
Show occupancy as a bar — "168 / 175 locations used" is the number a supervisor
acts on. Training sites need a persistent, unmissable marker.

**Produk (SKU)** — `GET/POST /api/skus`, `POST /api/skus/import`,
`POST /api/barcodes/register`, `GET /api/barcodes/check`.
The reference's product table is almost exactly this. Columns: photo, name,
brand, size, SKU code, identity mode, barcode count, basket size, expiry tier.
118 rows for Wardah alone, so **search, filter by brand/category, and pagination
are required, not optional**. This is the one screen where the reference's
density is precisely right.

### 4.2 Putaway slip — two screens

A finished receipt issues one slip: what arrived, where each SKU went, and the
batch colour. It is a **document of record** — a supervisor reads it weeks later
to settle a discrepancy, and there is a **24-hour window** to raise an inbound
discrepancy before the station bears the loss.

- **`Slip putaway` (archive)** — `GET /api/putaway-slips?site_id=`. Table: slip
  no, date, day-colour swatch, lines, units, received by. Newest first.
- **Slip detail / print view** — `GET /api/putaway-slips/{id}` or
  `GET /api/receipts/{id}/putaway-slip`. This one needs a **real print
  stylesheet** — it gets printed and physically filed. A4, black on white, the
  day colour as a solid printed block (not a thin border — cheap printers lose
  thin colour), the location code in mono at size, a signature line, and the
  discrepancy deadline stated in words. It should be legible photocopied.

The slip screen should appear automatically when a staffer finishes a receipt —
that is the moment it is needed. On the Station surface, that means a large
"Cetak slip" as the primary action on the completion screen.

### 4.3 Day-colour FIFO coding — one screen, plus a system-wide element

Staff cannot tell which identical lipstick arrived first. Stock is tracked as a
quantity, not per-unit, so **FIFO has to be carried by something physical**: a
coloured label keyed to the weekday the stock arrived.

`GET /api/day-colors` returns today's colour and the week.

```
Senin   #F2C300   Selasa  #1E8E3E   Rabu    #1A73C8   Kamis   #E8710A
Jumat   #7B3FA0   Sabtu   #D6336C   Minggu  #5E6064
```

Design needed:

1. **A "today's colour" element** shown on every inbound screen — big, obvious,
   and carrying the colour, the day name, *and* the date. Never colour alone.
2. **A label sheet to print** (`Label & warna hari`): a page of labels in
   today's colour, each showing the colour block, the day name, the date, and
   the week letter. Must print correctly on a domestic colour printer, and
   **must still work photocopied in black and white** — so the day name and date
   carry the meaning; the colour only accelerates it.
3. **A wall chart** of the full week, for pinning up at the station.

> **Flag this to the client in the design, do not silently paper over it.** A
> 7-colour cycle repeats weekly, but stock is held ~14 days. A fortnight-old
> batch wears *the same colour as today's*. The API therefore also returns
> `week_parity` (A/B) and the date on every payload. The design must show the
> **date** alongside the colour everywhere, and should show the week letter on
> the printed label. Colour alone is a FIFO bug waiting to happen.

Note the palette deliberately contains **no red** — red means failure everywhere
else in this app, and a Wednesday delivery is not a failure. It is also chosen
to stay separable under common red-green colour blindness, but that is a
mitigation, not a guarantee: this is exactly why the day name and date are
mandatory companions.

### 4.4 Grab order simulator — one screen

`POST /api/training/orders/generate` (N random orders),
`POST /api/training/orders/compose` (specific SKUs and quantities),
`GET /api/training/orders?site_id=` (recent, with status).

Two panels: *generate random* (count) and *compose one* (SKU picker with search,
quantity steppers, add line). Below, a live table of recent test orders — ref,
lines, qty, status, pick status, short lines — with a link into the pick task.

> **Training sites only, and the UI must make that unmissable.** A test order
> against a live site would consume real stock and push a wrong number to Grab.
> The API refuses it; the design should never let a user get as far as the
> refusal. If the current site is live, show the screen disabled with an
> explanation and a site switcher, not an error after the click.

---

## 5. Cross-cutting requirements

**Bilingual.** Every string needs `data-id` and `data-en`. Indonesian is the
default and must not read as translated English — it is the working language,
and it should sound like an instruction from a colleague, not a system message.

**Themes.** Light and dark, both real. Dark is for the backroom at night; light
for a bench by an open roller door in daylight. Define the full light palette on
`:root`, redefine only the changed tokens under `[data-theme="dark"]`.

**Responsive.** Station targets 1366 × 768 and must degrade to a 375 px phone.
Console targets ≥ 1280 px; below that, collapse the sidebar to icons. Wide
tables scroll inside their own container — the page body never scrolls
sideways.

**No build step.** The current frontend is framework-free static HTML/CSS/JS
served by nginx, wired by one `js/wire.js`. Keep it that way unless there is a
strong reason not to: it deploys as static files and has no toolchain to rot.
If you introduce a framework, say so explicitly — it changes the Dockerfile.

**Deliver as** `.dc.html` artboards plus a real `frontend/` folder, the way v1
did — that worked well. Keep `data-field` / `data-region` hooks on anything
dynamic so the wiring layer stays a thin, mergeable file.

---

## 6. What v1 got right (keep the thinking)

- The scan zone as a large, always-focused, colour-and-words state machine.
- Location codes in mono with the **rack and level accented** — that is what a
  person navigates by.
- The wrong-item stop screen: full-bleed red, two product photos side by side,
  `≠` between them. It is the single best screen in the app.
- Counting deliberately hides the system quantity until after the count.
- The blocked/offline screen being genuinely obstructive.

## 7. What v1 got wrong

- **Sharp corners, no elevation, border-heavy.** The dated look, in three words.
- **No admin surface at all** — hence this brief.
- **No print design.** The slip and the labels are printed artefacts and were
  never designed as such.
- **Product photos were never sourced.** Every screen falls back to
  `placeholder.svg`. For 118 near-identical shades, the photo is the primary
  disambiguator and its absence is a real defect. Design should assume photos
  exist and specify the crop, aspect and fallback.
- **Two screens shipped with no `.chrome` header** (`08-salah-barang`,
  `14-terkunci`), which broke a global script that assumed one. If a screen
  deliberately omits shared furniture, say so in the handoff.
- The home screen's counts were hardcoded in the mockup, which hid that they
  needed an API until wiring. Mark every dynamic value.
