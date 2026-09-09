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
`14` blocked (dark), `15` receipt complete.

**Console** — `index` overview, `barang-masuk`, `pesanan`,
`papan-antrean` (pick queue board), `stok`, `hitung-stok`,
`slip-putaway` (archive), `slip-detail` (A4 print),
`label-warna-hari` (label sheet + wall chart), `hub`, `staf`, `produk`,
`simulator-grab`, `mode-latihan`.

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

`css/print.css` owns the slip and the label sheet. Both are A4 at
`@page { margin: 0 }`, with `print-color-adjust: exact` on the colour blocks
so they actually ink. The slip is designed to survive a black-and-white
photocopy: variance rows carry a grey fill *and* an underline, and the day
colour block prints its day name and week letter inside it.
