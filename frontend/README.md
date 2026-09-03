# Ninja Kilat WMS — front end

Static, framework-free front end for the station app. No build step: serve the
`frontend/` folder and it runs.

    npx serve frontend      # or any static host / nginx / S3

## Files

    css/tokens.css     colour, type, spacing tokens. Light + dark (`[data-theme="dark"]`).
    css/app.css        component layer: chrome, scan zone, product block, code chip,
                       counter, keypad, banners, basket rows, rack map, blocked state.
    js/scan.js         ScanZone — barcode-gun (keyboard wedge) capture, always focused,
                       accept / reject / offline states, audio + visual + text feedback.
    js/app.js          shell: theme persistence, ID/EN toggle, connection indicator,
                       heartbeat hook, undo stack.
    js/rack-map.js     renders the 7 x 5 x 5 rack map from data.
    assets/products/   product photography, named `<sku-lowercase>.jpg`
                       (e.g. wdh-gll-07.jpg). Missing files fall back to placeholder.svg.
    *.html             one page per screen, numbered by flow.

## Screens

| Page | Flow |
|---|---|
| index.html | task menu |
| 01-mulai-barang-masuk · 02-barang-masuk-scan · 03-barcode-tidak-dikenal · 04-buat-keranjang | A — inbound |
| 05-label-unit · 06-label-sudah-terpakai | B — unit labelling |
| 07-ambil-pesanan · 08-salah-barang · 09-pesanan-selesai | C — pick |
| 10-hitung-pilih-keranjang · 11-hitung-menghitung · 12-hasil-hitung | D — stock count |
| 13-peta-rak | E — supervisor |
| 14-terkunci | blocked state (dark theme) |

## Wiring it to the backend

Each guided screen carries a small `<script>` at the bottom with the demo
behaviour and the expected endpoint in a comment. Replace those blocks:

    const zone = document.querySelector('.scanzone').__zone;
    zone.onScan(async code => {
      const r = await fetch('/api/inbound/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId, barcode: code })
      }).then(r => r.json());
      if (r.status === 'ok')       zone.accept('Diterima', 'Simpan di ' + r.location);
      else if (r.status === 'unknown') location.href = '03-barcode-tidak-dikenal.html';
      else                          zone.reject(r.title, r.instruction);
    });

Live values are read from `[data-field="…"]` nodes; regions to re-render are
marked `[data-region="…"]`. The rack map reads `data/racks.json` and falls back
to `NJW.demoRacks()` when that file is absent.

Connection indicator: `NJW.startHeartbeat('/api/health', 15000)` — the app is
online-only, so a dropped connection must block work loudly (see 14-terkunci).

## Rules baked into the CSS — keep them

* **Red is only failure.** `--stop` / `--brand` never appear on a button, link,
  nav item or accent. Primary actions are `--action` (deep blue-black).
* **Three-way state.** Every state carries colour **and** an icon **and** words;
  audio in scan.js is additive, never the only signal.
* **No free text in staff flows.** Quantities come from `.step` and `.keypad`;
  the only `<input>` in the product is the invisible scan target.
* **Tap targets** ≥ 48 px (`--tap`), primary buttons in guided flows 64 px
  (`--btn-h`).
* **Copy lives in the markup** as `data-id` / `data-en`; ID is the default and
  the EN toggle swaps text without touching layout. New strings need both
  attributes.
* Target viewport is 1366 × 768; below 900 px the layout stacks for the 375 px
  phone case.
