# Ninja Kilat WMS — design brief v3

**For:** Claude Design
**Builds on:** `DESIGN-BRIEF-V2.md` and the v2 design you delivered — **the token system,
both surfaces, and all 30 existing screens stay exactly as they are.**
**Date:** 10 September 2026

---

## 0. What this brief is, and is not

This is **additive**. Nothing in the v2 design system changes: same tokens, same two
surfaces (Station / Console), same rules, same faces, same `js/api.js` wiring contract.
You do not need to revisit anything you have already built.

What changed is the *operating model*, and it needs **eight new screens plus four edits**
to existing ones. Everything below is either new surface or a named change to a specific
file.

The reference for the whole model is the flow document:
**https://claude.ai/code/artifact/fc57e904-9037-4d5f-ada0-b06feafa2999** — read Diagram 1
first, it defines the boundary everything else sits inside.

---

## 1. The four changes to the operating model

**1. The Logos hub now runs the same WMS.** It is a second site type. It receives from the
brand, decants, and *dispatches* sealed totes to darkstores. It does not pick customer
orders, has no pick queue, and never publishes stock. A hub user should never see the
order screens at all.

**2. Every SKU has one pick face and an optional overflow.** A supervisor assigns the
primary rack once and sets three thresholds: **full** (start using overflow), **low**
(raise a replenishment task), and **restock point** (ask the hub for more). Only the
first two measure the pick face. A picker is **never** sent to overflow.

**3. Five messages to the POS, and no link to Grab.** The WMS never calls Grab. This
matters to design because two screens now show *integration state* — whether a message
was delivered — and staff must be able to tell "the warehouse is fine, the POS is down"
from "something is wrong here".

**4. The short pick is designed.** Two taps, no typing, and the picker carries on with
the rest of the order.

---

## 2. New screens — Station surface

### S1 · Short pick (`17-barang-tidak-ada.html`)

The most consequential new screen in the product. Reached from the pick screen's
existing *"Barang tidak ada di keranjang"* button, which is currently inert.

- **Two taps maximum.** *Tidak ada sama sekali* is one button. *Cuma ada sebagian* opens
  a stepper — reuse the `.step` / `.counter` component from the count screen; do **not**
  introduce a text field.
- The screen must make clear the picker **continues with the rest of the order** —
  this is not the end of the task. The primary action after declaring is *Lanjut ambil
  barang lain*, not *Selesai*.
- It is **not a failure screen.** The picker did nothing wrong; the stock was missing.
  Use `--caution`, not `--stop`. Red is for *you have the wrong item in your hand* — a
  distinction the staff will learn from consistency alone.
- Show what the order expected versus what they found, in the large type the station
  scale uses.

### S2 · Replenishment task (`18-isi-ulang.html`)

A worklist, not a guided flow. Rows of *move N units from overflow X to rack Y*, ordered
by urgency (a pick face at zero outranks one merely low).

- Each row: SKU with photo, from-location, to-location, how many to move, and how long
  the pick face has been below threshold.
- A row is completed by scanning at the destination, so this screen hands off to a
  simple scan confirmation rather than a checkbox.
- Include an empty state — most days this list is short or empty, and an empty state
  that looks broken will get ignored when it matters.

### S3 · Hub receive & dispatch (`19-gudang-kirim.html`)

Station staff never see this; hub staff live in it. Two halves:

- **Receive** — reuses the existing inbound flow entirely. No new design needed beyond
  routing.
- **Dispatch** — build a tote: choose destination darkstore, scan units in, seal, print
  a tote label. The tote label is a **printed artefact** and needs the same care as the
  putaway slip: destination in large type, tote reference in mono, unit count, date.

The hub is a calmer environment than a darkstore — no fifteen-minute clock — so this can
be denser than the station guided flows. But it is still a warehouse floor: gloves,
standing, a scanner. Keep the tap targets.

---

## 3. New screens — Console surface

### C1 · Slot registry (`console/registry.html`)

**The most important new console screen.** A supervisor sets, per SKU: primary location,
overflow location (optional), and the three thresholds. 118 rows for Wardah alone, so
this is a dense table with search and filter — the same treatment as `produk.html`.

Design problems worth solving properly:

- **Three numbers is one too many to grasp in a table cell.** Consider a single visual —
  a horizontal bar showing restock point / low / full against current stock — so a
  supervisor can see at a glance which SKUs are mis-set. A SKU whose low threshold sits
  above its full threshold is a configuration error and should be impossible to save.
- **Bulk edit matters.** Setting 118 SKUs one at a time will not happen. Multi-select
  with "apply these thresholds to selection" is the difference between this screen being
  used and being abandoned.
- Show a **derived default** from the space model so a supervisor is correcting a
  suggestion rather than inventing three numbers from nothing.

### C2 · Transfers (`console/transfer.html`)

The Logos → darkstore hop, from the console side. A table of transfers with status
(draft / dispatched / received), quantities sent versus received, and the variance if
any. A received transfer with a variance is the row that matters — it should be
impossible to miss, and it carries a 24-hour clock like the putaway slip does.

### C3 · Integration health (`console/integrasi.html`)

New surface, and it needs care because it shows a system nobody at Ninja Van has agreed
to build yet.

- **Five message types**, each with: last sent, queue depth, failures, and whether the
  boundary is currently **on or off** (shadow mode).
- **Shadow mode must be unmissable.** During the pilot the WMS computes every number and
  sends nothing. A supervisor looking at this screen must not conclude the integration is
  working when it is deliberately disconnected. Use the same treatment weight as the
  training banner.
- The most useful thing this screen can show is **the number we would have sent versus
  what the POS currently holds** — that comparison is the evidence for the conversation
  with the POS team, so give it room rather than burying it in a queue table.

### C4 · Replenishment overview (`console/isi-ulang.html`)

The supervisor's view of S2: which pick faces are low, which are at zero, how long they
have been that way, and whether anyone has claimed the task. Reuse the queue board's card
and ageing language — a pick face at zero has the same shape of urgency as a stalled
order, and staff should not have to learn two visual systems for the same idea.

### C5 · Restock requests (`console/restock.html`)

When primary + overflow drop below the restock point, the WMS raises a request to the
hub. This screen lists them, lets a supervisor confirm or adjust the quantity, and sends
it. Malaysia does this today with a spreadsheet and WhatsApp — the screen should feel at
least as fast as that, or people will keep using WhatsApp.

---

## 4. Edits to existing screens

| File | Change |
|---|---|
| `07-ambil-pesanan.html` | The *"Barang tidak ada di keranjang"* button now routes to **S1**. Add a **day-colour prompt** — *"ambil warna Rabu dulu"* — near the basket code. The system knows which colours are in that basket; it cannot enforce FIFO, but it can stop it being a memory test. |
| `console/index.html` | Add two KPI tiles: pick faces below threshold, and open restock requests. The four existing tiles are wired and correct. |
| `console/hub.html` | Site rows now carry a **type** (hub / darkstore). A hub shows no pick or publish state — those columns are meaningless for it and showing them empty implies breakage. |
| `13-peta-rak.html` | Mark overflow locations distinctly from pick faces. A picker looking at the rack map must be able to tell at a glance which baskets they will ever be sent to. |

---

## 5. Constraints, unchanged from v2 — repeated because they are load-bearing

- **Red is only failure.** Not for late, not for low stock, not for a short pick.
- **Every state carries colour and words**, never colour alone.
- **No free text in Station flows.** Steppers and keypads only; the sole `<input>` is the
  invisible scan target.
- **Bilingual**, `data-id` / `data-en` on every string. Indonesian is the working
  language and must not read as translated English.
- **Both themes real.** Light and dark.
- **No build step.** Framework-free static HTML/CSS/JS, wired by a thin `js/wire.js`.
  Keep `data-field` / `data-region` hooks on everything dynamic.
- **Station type scale does not shrink.** 32 / 60 / 96 px is sized for arm's length.

---

## 6. One thing to watch

Every screen in §3 is a **console** screen, and the console is now where the product's
complexity lives. That is the right place for it — but it means a supervisor's day is
spread across nine screens where it used to be four.

If you see a way to collapse C4 and C5 into one *"stock needs attention"* surface, or to
fold the registry's thresholds into `produk.html` rather than a separate screen, that is
worth proposing. The brief above is a list of jobs to be done, not a mandated screen
count.

---

## 7. Deliver as before

`.dc.html` artboards plus a real `frontend/` folder. Keep the existing file and class
vocabulary — the wiring layer builds cards and rows from your classes, so a class that
exists in the mockup but not the stylesheet renders as unstyled markup at runtime. That
has bitten twice; naming things exactly as you style them is what prevents it.
