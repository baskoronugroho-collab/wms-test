# Ninja Kilat WMS — front end (v2)

Static, framework-free. **No build step**: serve `frontend/` and it runs.

    npx serve frontend        # or nginx / S3 / the repo's cicd/Dockerfile.frontend

Two surfaces share one token set:

| | **Station** | **Console** |
|---|---|---|
| Files | `frontend/*.html` | `frontend/console/*.html` |
| Who | Station staff | Supervisors, admins, ops |
| Target | 1366 × 768, degrades to 375 px | ≥ 1280 px, sidebar collapses below |
| Input | Barcode gun, gloves, standing | Mouse, desk, 50 cm |

## Files

    css/tokens.css     Colour, type, spacing, radius, elevation, motion.
                       Full light palette on :root; only changed tokens under
                       [data-theme="dark"]. Both themes are real.
    css/app.css        Station layer: chrome, scan zone, product block, code
                       chip, counter, keypad, banners, basket rows, rack map,
                       day-colour strip, blocked state.
    css/console.css    Console layer: sidebar, page head, KPI cards, toolbar,
                       data table, status pills, bulk bar, pagination, drawer,
                       occupancy bar, training gate, day-colour chips.
    css/print.css      The putaway slip and the day-colour label sheet. A4.
    js/api.js          Every endpoint in one place + formatters + photo swap.
                       This is the thin, mergeable wiring layer.
    js/scan.js         ScanZone — keyboard-wedge capture, always focused,
                       accept / reject / offline, colour + words + optional beep.
    js/app.js          Shell: theme persistence, ID/EN toggle, connection
                       indicator, heartbeat hook, undo stack.
    js/console.js      Search filter, column sort, bulk select, drawer,
                       steppers, training gate, day-colour painter.
    js/rack-map.js     Renders the 7 × 5 × 5 rack map from data.
    assets/products/   placeholder.svg only — see "Product photos" below.

## Screens

**Station** — `index.html` (menu), `01`–`04` inbound, `05`–`06` unit
labelling, `07`–`09` pick, `10`–`12` stock count, `13` rack map,
`14` blocked (dark), `15` receipt complete, `17` short pick,
`18` replenishment (+ `18-…-pindai` destination scan), `19` hub dispatch.

**Console** — `index` overview, `barang-masuk`, `pesanan`,
`papan-antrean` (pick queue board), `transfer`, `stok`,
`stok-perhatian` (replenishment + restock), `hitung-stok`,
`registry` (slotting & thresholds), `slip-putaway` (archive),
`slip-detail` (A4 print), `label-warna-hari` (label sheet + wall chart),
`hub`, `staf`, `produk`, `integrasi` (POS health),
`simulator-grab`, `mode-latihan`.

## v3 — the operating model

Four things changed, and they touch each other:

**The Logos hub runs the same WMS.** It is a second site type. It receives
from the brand, decants, and dispatches sealed totes to the darkstores. It
never picks a customer order and never publishes stock.

*One nav for everyone.* A hub user still sees Pesanan and Papan antrean —
hiding nav items makes the product feel broken in a different way. Instead
the four screens that don't apply explain themselves, driven by
`NJW.HUB_NA` + `NJW.applySiteType(siteType)` in `console.js`. Append
`?site=hub` to any console screen to preview it.

**One pick face per SKU, plus an optional overflow.** Three thresholds:
**full** (start using overflow), **low** (raise a replenishment task) and the
**restock point** (ask the hub). Only full and low measure the pick face — the
restock point measures face *plus* overflow, which is why it can legitimately
exceed what the face holds. **A picker is never sent to overflow**; the rack
map hatches that column and the occupancy figure counts pick faces only.

**Five messages to the POS, and no link to Grab.** The WMS never calls Grab.
`integrasi.html` shows the boundary state at the top of the page rather than
leaving it to be inferred from five cards, so a supervisor can tell "the
warehouse is fine, the POS is down" from "something is wrong here".

**The short pick is designed.** `17-barang-tidak-ada.html`: two taps, no
typing, and the picker carries on with the rest of the order.

### Screens worth reading before you change them

* `registry.html` — three thresholds per SKU is one number too many to read
  as numbers in a table cell, so they render as one `.thbar`: a track from 0
  to face capacity, R/M/P as marks, current stock as the fill. A supervisor
  scans for a fill stopping left of a mark, and for marks in the wrong
  **order** — which is a configuration error. The API rejects low ≥ full
  (422), so those rows are flagged before anyone tries to save. Bulk edit
  defaults to **percent of capacity**, not fixed numbers: S, M and L baskets
  hold different amounts, so applying "12" to 118 SKUs is wrong for most.
* `stok-perhatian.html` — C4 and C5 from the brief, collapsed into two tabs.
  Tab 1 reuses the queue board's card and `NJW.AGE_BANDS`: a pick face at
  zero is the same shape of urgency as a stalled order, and the two screens
  must not drift apart. Tab 2's quantities arrive pre-filled because the job
  is done on WhatsApp today and has to be faster than that.
* `integrasi.html` — `mode` comes from the **server**. A supervisor must
  never be able to make this screen look connected while the boundary is
  deliberately closed; the segmented control is a mockup affordance so both
  states can be reviewed. In shadow mode the WMS-vs-POS drift comparison is
  promoted above the five cards — during the pilot it is the only genuinely
  useful thing on the page, and it is the evidence for the POS conversation.
* `17-barang-tidak-ada.html` — entirely `--caution`. Red would teach that a
  short pick is the picker's fault. It isn't. Expected / found / short read
  as one `.vsrow`, not three stacked blocks: they are the same fact three
  ways, and stacking them pushed "Lanjut ambil barang lain" below the fold.

### `.main--dense`

Two screens stack one block more in the left column than the rest of the
station does — `07` (the FIFO prompt) and `17` (the choice row). On
1366 × 768 that extra block put the primary action below the fold, and **a
picker must never scroll to reach a button.** `.main--dense` tightens the
frame — padding, gaps, counter padding, step buttons 76 px, photo cap — and
never the type: the 32 / 60 / 96 px scale is untouched and every target stays
above the 48 px minimum. Both screens measure exactly 768 px.

### The primary action never lives inside the region that can overflow

`19-gudang-kirim.html` holds more incompressible content than a short
viewport can show — a tote can carry twenty lines, and a real 1366 × 768
laptop has only ~620 px of viewport once browser chrome and the taskbar are
gone. So that screen splits `main` in two:

    <main class="main main--dense main--fit">
      <div class="main__scroll"> …everything… </div>
      <div class="actionbar">  Batalkan · Segel & cetak label  </div>
    </main>

`.main--fit` pins main to `calc(100vh - var(--chrome-h))`; `.main__scroll`
takes the remaining height and **scrolls**; `.actionbar` sits outside it, so
the seal action is visible and clickable at any viewport height.

**Do not put `overflow: hidden` on a container holding a primary action.**
A clipped container renders no scrollbar, ignores the wheel, and is not
hit-testable — `elementFromPoint` returns whatever is underneath. Below the
fold is a nuisance; unreachable is a broken screen. If a region can overflow
it gets `overflow-y: auto`, and anything that must always be reachable goes
in a sibling band outside it.

If you add a block to either column on these screens, re-measure at
1366 × 768 before shipping. Screens `07`, `17` and `19` are all verified at
exactly that size; `18` scrolls by design (it is a worklist and every row
carries its own button).

### The pick queue board

Three lanes — waiting (oldest first), being picked, done today (collapsed).
Cards, not rows: each item has a person, a clock and an action attached.

* **Age is the biggest thing on a card** and it is a live number, never a
  timestamp the reader has to subtract from now. It ticks in place every 15 s
  (whole minutes are all that's displayed) and pauses while the tab is hidden.
* **Ageing escalates by weight, not into red.** `normal` → `is-ageing`
  (3 px amber rule, the word *Menua*) → `is-late` (6 px ochre rule, tinted
  card, larger age, solid *Terlambat*). A late order is urgent, not failed,
  so `--stop` never appears here.
* **Thresholds live in exactly one place** — `NJW.AGE_BANDS` at the top of
  the page script, in seconds. They are **unconfirmed**: 5 / 10 / 15 min
  suggested against the 15-minute delivery promise, to be retuned with ops.
* **Stuck claims** get their own state plus a banner. Releasing another
  person's work opens a confirm dialog that names the holder, the ref and how
  long they've held it — never a silent action.
* **Test orders** are structurally distinct: a hatched amber band across the
  card top and a solid `UJI COBA` badge. Amber, not red — a test order is
  not a fault, but a supervisor confusing one for a real order is an incident.
* **Auto-refresh never reflows under the cursor.** A poll that finds changes
  parks them and shows the `.stagepill`; the board only moves when the
  supervisor clicks it.

Two endpoints are assumed and being added: `age_seconds`, `created_at`,
`claimed_at` and `short_lines` on `GET /api/pick-tasks`, and
`POST /api/pick-tasks/{id}/release`. Prefer the server's `age_seconds` over
deriving it — a tablet with a wrong clock must not mis-band the queue.

> **Two Station screens deliberately omit the shared `.chrome` header:**
> `08-salah-barang` (full-bleed red stop) and the `.blocked` layout in
> `14-terkunci` keeps it but suppresses everything else. Any global script
> must tolerate a missing `.chrome` — that broke once in v1.

## Wiring it up

`js/api.js` holds every call. Each screen carries a small `<script>` at the
bottom with the demo behaviour and the exact endpoint in a comment. Live values
are read into `[data-field="…"]` nodes; regions to re-render are marked
`[data-region="…"]`. Nothing in the markup knows about `fetch`.

    const zone = document.querySelector('.scanzone').__zone;
    zone.onScan(async code => {
      const r = await NJW.api.raw.post('/inbound/scan', { receiptId, barcode: code });
      if (r.status === 'ok')          zone.accept('Diterima', 'Simpan di ' + r.location);
      else if (r.status === 'unknown') location.href = '03-barcode-tidak-dikenal.html';
      else                             zone.reject(r.title, r.instruction);
    });

The app is **online-only**. Start the heartbeat so a dropped connection blocks
work loudly rather than degrading silently:

    NJW.startHeartbeat('/api/health', 15000);

## Product photos — the one real gap

Every `<img>` ships with `placeholder.svg` as its `src` and the SKU key in
`data-photo-key`, so nothing 404s while photos are unsourced. To turn them on:

    NJW.PHOTO_BASE = '/media/skus/';   // then call NJW.paintPhotos() after render

**Spec:** 1:1, at least 800 × 800, product centred on a white ground, no crop
(the CSS uses `object-fit: contain`). Filename is the lowercase SKU code —
`wdh-gll-07.jpg`. For 118 near-identical Wardah shades this image is the
primary disambiguator, so a *wrong* photo is worse than none.

## Rules baked into the CSS — keep them

* **Red is only failure.** `--stop` / `--brand` never appear on a button,
  link, nav item or accent, on either surface. Primary is always `--action`.
  The Console's supporting accent is amber `--accent`; `--caution` was
  re-tuned to a deeper ochre so a warning can't be mistaken for a control.
* **Three-way state.** Every state carries colour **and** an icon **and**
  words. Audio in `scan.js` is additive, never the only signal.
* **No free text in Station flows.** Quantities come from `.step` and
  `.keypad`; the only `<input>` on the Station surface is the invisible scan
  target. Text fields exist on the Console only.
* **The day colour never travels alone.** Colour + day name + **date**, always
  all three. The 7-colour cycle repeats weekly while stock is held ~14 days, so
  a fortnight-old batch wears today's colour; the date and the week letter
  (A/B) are what separate them. The palette contains no red on purpose.
* **Tap targets** ≥ 48 px (`--tap`); Station guided-flow primaries 64 px
  (`--btn-h`). Console controls are 32 px (`--tap-c`) — desk, not floor.
  The hub is calmer than a darkstore and `19` is allowed to be denser, but
  it is still a warehouse floor: the tap targets do not shrink.
* **A picker is never sent to overflow.** Overflow is a different *kind* of
  location, not another status, so the rack map hatches it rather than giving
  it a fifth fill colour — hatching survives a colour-vision deficiency, and
  the legend spells it out.
* **The Station type scale does not shrink.** 32 / 60 / 96 px is sized for
  arm's-length reading.
* **Copy lives in the markup** as `data-id` / `data-en`. Indonesian is the
  default and must not read as translated English. Every new string needs both.
  `app.js` writes `textContent` from `data-id` on load, so **`data-id` is
  the runtime source of truth** — editing the text node alone changes nothing.
* **The training gate fails closed.** If the site's `is_training` can't be
  read, the simulator stays blocked.
* **Wide tables scroll in `.table-scroll`**, never the page body.

## Print

`css/print.css` owns the putaway slip, the day-colour label sheet and the
**tote label**. The tote label deliberately shares the 63 × 38 mm pitch of the
day-colour labels so the hub buys one kind of label stock; the destination is
the biggest thing on it, because a tote in the wrong van is the failure that
label exists to prevent.

`css/print.css` owns the slip and the label sheet. Both are A4 at
`@page { margin: 0 }`, with `print-color-adjust: exact` on the colour blocks
so they actually ink. The slip is designed to survive a black-and-white
photocopy: variance rows carry a grey fill *and* an underline, and the day
colour block prints its day name and week letter inside it.
