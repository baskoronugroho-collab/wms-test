# frontend/app: the one app

One app, one menu, every role. Each menu item is one page here: `<page>.html` plus its logic in
`js/<page>.js`. The frame (menu, hub picker, banners, language, sign out) is `shell.js`; the look
is `kilat.css` (tokens and components from the canvas `STYLE.md`). Do not load the old
`css/*.css`, `js/app.js`, `js/wire.js` or `js/console.js` here.

## 1. A page

Every page is this file. Owners normally change only the `init` options; the view lives in
`js/<page>.js`.

```html
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pesanan · SatSet WMS</title>
<meta name="theme-color" content="#13233A">
<link rel="manifest" href="../manifest.json">
<link rel="apple-touch-icon" href="../assets/app/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap">
<link rel="stylesheet" href="kilat.css">
</head>
<body>
<script src="../js/api.js"></script>
<script src="../js/scan.js"></script>
<script src="shell.js"></script>
<script>
NJW.shell.init({
  page: 'pesanan',                       // menu key = file name; also loads js/pesanan.js
  title: ['Pesanan', 'Orders'],          // [Indonesian, English]
  tabs: [                                 // optional; the URL carries ?tab=<id>
    {id: 'ambil', label: ['Ambil', 'Pick']},
    {id: 'kemas', label: ['Kemas', 'Pack']}
  ]
});
</script>
</body>
</html>
```

`init` options: `page` (required), `title`, `sub` (subtitle pair), `tabs`, `allSites: true` (the
hub picker offers "Semua hub"; then `ctx.siteId` is `null`), `script` (another file, or `false`
for none), `fullScreen: true` (start in full screen), `onBack`.

Cache busting: write plain local paths as above. `python tools/stamp_assets.py` (run by the lead
before a deploy) adds `?v=<commit>` to `kilat.css`, `shell.js`, `legacy.js` and every `css/` or
`js/` path. Scripts the shell loads itself (`js/<page>.js`, tab scripts, `panduan/sections.json`)
get the same `?v=` from shell.js's own URL. So: no hand-written `?v=`, no other folders for code.

Anything written inside `<body>` before the scripts is moved into the content area, so a page may
also ship static markup.

## 2. The page script

```js
(function () {
  'use strict';
  const S = NJW.shell, api = NJW.api.raw;
  S.page(async function (ctx) {           // runs after sign-in, and again on every tab change
    // ctx: { me, site, siteId, allSites, tab, body, params, actions, every(ms, fn) }
    const rows = await api.get('/pick-tasks/board' + api.qs({ site_id: ctx.siteId }));
    ctx.body.innerHTML = '<div class="k-card k-card--pad">' + S.bis('Antrean', 'Queue') + '</div>';
    ctx.every(30000, refresh);             // timers stop on the next render
  });
  // or one function per tab: S.tab('ambil', fn); S.tab('kemas', fn);
})();
```

- `ctx.body` is the content area (`#k-body`); with tabs it is emptied before each tab renders.
  `ctx.actions` is the button slot at the right of the page title (laptop) and is emptied too.
- No handler registered (file missing, or no `S.page`/`S.tab` for that tab): the page shows
  "Segera hadir". Pengaturan loads `js/pengaturan-<tab>.js` per tab; each calls
  `S.tab('<tab>', fn)` (tab ids: `hub`, `orang`, `aturan`, `integrasi`, `demo`).
- Errors thrown by a handler become a red toast. Call the API only with `NJW.api.raw`
  (`get/post/put/patch/del/form/qs`); it adds `X-View-As` for a superadmin preview. Never edit
  `js/api.js`.
- Hub change: if the page called `S.onSiteChange(fn)`, fn runs with the new hub; otherwise the page
  reloads. Read the hub with `ctx.siteId` or `S.siteId()`.
- Links between pages: plain relative links, e.g. `pesanan.html?tab=kemas`,
  `restock.html?id=12`. Read params with `ctx.params.get('id')` or `S.param('id')`.

## 3. Language

Indonesian is the default; EN is one tap (stored in `localStorage['njw.lang']`).
Every text node that must switch carries both strings:

```html
<span data-id="Barang tidak ada" data-en="Item missing">Barang tidak ada</span>
<input data-ph-id="Cari produk" data-ph-en="Search products">     <!-- placeholder -->
<button data-aria-id="Tutup" data-aria-en="Close">...</button>    <!-- aria-label -->
```

`data-id` replaces the element's whole text, so put it on a `<span>` inside a button that has an
icon. In JS: `S.bis(id, en, cls?)` returns that span, `S.biAttr(id, en)` the attribute string,
`S.bi(el, id, en)` sets an element, `S.t(id, en)` returns the current string. The shell re-applies
the language after each render; `document` gets an `njw:lang` event on a switch (re-render
anything built from `S.t`). Server messages "Indonesian / English" are split by `S.pick(text)`.
Copy: plain Indonesian, short sentences, no em or en dashes (use a colon, a comma or a full stop),
no customer data.

## 4. Phone and laptop

Below 1024 px: navy 68 px header (menu button, "hub · name · role", page title, Perlu tindakan
bell count) and a full-screen menu sheet. From 1024 px: 248 px sidebar, top bar with the hub
picker, Hiryu link status and the WIB clock. Same pages, same menu. Use `k-phone-only` /
`k-laptop-only` to show a part on one only (e.g. a table on the laptop, `k-row` cards on the
phone). Touch targets are at least 44 px; the main phone action is `k-btn--primary k-btn--lg
k-btn--block` (64 px) inside a `k-actionbar` (sticks to the bottom on the phone).
Scanning steps: `S.fullScreen(true, { title: ['Ambil barang', 'Pick'], onBack })` hides the
menu, tabs and page header and turns the menu button into Back; `S.fullScreen(false)` restores.

## 5. Roles and locks

Ladder (as `backend/auth.py`): `staff` < `hub_operator` < `supervisor` (SPV) < `hq` (Ops HQ) <
`ops_head` < `superadmin`. Everyone sees every page; a control the role may not use is shown
locked. The server still checks every write.

```html
<button class="k-btn k-btn--primary" data-min-role="supervisor"><span data-id="Simpan rak" data-en="Save rack">Simpan rak</span></button>
```

Any `[data-min-role]` inside `ctx.body`, `ctx.actions` or a modal is locked automatically after
render (grey, lock icon, caption "Hanya SPV" / "Hanya Ops HQ" / "Hanya Ops Head"). For controls
built later call `S.lock(el, 'hq')` (returns true when locked) or `S.lockAll(root)`.
`S.atLeast('supervisor')` answers the role check for logic. Dialog buttons take `minRole`.

## 6. Helpers (`NJW.shell`)

| Helper | What it does |
|---|---|
| `init(opts)`, `page(fn)`, `tab(id, fn)`, `ready()` | boot; register views; `ready()` resolves with ctx after sign-in |
| `setTitle(id, en)`, `setSub(id, en)`, `setTab(id)`, `currentTab()`, `tabCount(id, n, 'caution'?)` | page header and tabs |
| `me()`, `role()`, `atLeast(r)`, `roleName(r)`, `roleChip(r)` | the person (`me().sites`, `name`, `role`, `real_role`, `viewing_as`) |
| `site()`, `siteId()`, `allSites()`, `sites()`, `siteLabel(s)`, `shortCode(code)`, `onSiteChange(fn)` | the hub (`MAC-MA5` shows as `MA5`) |
| `setCount(counts)`, `refreshCount(force)` | the Perlu tindakan badge (from `GET /api/todo`) |
| `toast(text or [id,en], 'ok'/'stop'/'caution'/'info')`, `fail(err)` | messages; `fail` shows the server's detail, 401 shows "Masuk dulu" |
| `modal({title, body, actions:[{label, kind, onClick(close), minRole, value}], wide})` | dialog (bottom sheet on the phone); returns `{el, body, close}`; onClick returning `false` keeps it open |
| `drawer({...same})` | side panel on the laptop, full screen on the phone |
| `confirm({title, text, ok, cancel, danger})` | Promise of true/false |
| `scan(handler, {title, mount, camera})` | scan zone: hardware scanner (keyboard wedge, always listening), Kamera button, "Ketik kode". `handler(code, z)`; `z.accept(label, detail)`, `z.reject(label, detail)`, `z.rest()`, `z.focus()`, `z.setTitle(id, en)`, `z.emit(code)` |
| `stopwatch(el, startIso, {lateAfter: seconds, label})` | "Waktu kerja" pill; returns `{stop(), seconds()}` |
| `stepper(el, {value, min, max, step, onChange})` | − n +; returns `{get, set, input}` |
| `toggle(button, onChange)` | switch (`role="switch"`); add class `k-switch--danger` for the damaged toggle; onChange returning `false` reverts |
| `pill(kind, id, en)`, `sysChip(name)`, `icon(name, size)` | status pill, system chip, stroke icon (names in `S.ICON`) |
| `fmt.n`, `fmt.rp`, `fmt.pct`, `fmt.date`, `fmt.day`, `fmt.time`, `fmt.dt`, `fmt.wib`, `fmt.dur(sec)`, `fmt.ago`, `fmt.due` | numbers id-ID, times 24 h in WIB; `due(iso)` gives `[id, en, late]` like "lewat 2 jam" |
| `route(link)` | old console/station link to the new page (needs `legacy.js` on the page) |
| `esc`, `t`, `bi`, `bis`, `biAttr`, `pick`, `applyLang(root)`, `lang()`, `setLang()` | text helpers |

## 7. Classes (`kilat.css`)

- Layout: `k-stack` (`--tight`, `--loose`), `k-line` (`--between`), `k-grow`, `k-grid2`, `k-grid3`,
  `k-phone-only`, `k-laptop-only`, `k-sr`, `k-eyebrow`, `k-h2`, `k-p`, `k-caption`, `k-muted`, `k-mono`.
- Cards: `k-card` + `k-card--pad`, `--focus` (blue 2 px), `--caution`, `--stop`, `--flat`;
  `k-card__head`, `k-card__foot`.
- Buttons: `k-btn` (secondary look by default) + `--primary`, `--secondary`, `--outline`, `--ghost`,
  `--problem` (white, red line: *Barang tidak ada*), `--danger` (destructive confirm only), `--sm`,
  `--lg` (64 px), `--block`; `k-linkbtn`; `k-actionbar`; locked: `is-locked` inside `k-lockwrap`.
- Chips: `k-chip--staff|spv|hq|head` (roles), `k-sys--hiryu|wms|grab|email` (systems), `k-tag`,
  `k-pill` + `--ok|caution|stop|info` with `k-pill__dot` (+ `--lg`), `k-badge`.
- Laptop table: `k-tablewrap` > `table.k-table`; `td.k-num` (right, mono); `tr.is-caution|is-stop|is-selected`;
  `k-cell2` > `k-cell2__main` + `k-cell2__sub`; `k-table__actions`.
- Phone list: `k-list` > `a.k-row` (+ `--caution`, `--stop`) with `k-row__icon` (+ `--caution|stop|ok`),
  `k-row__text` > `k-row__title` + `k-row__sub` (+ `--caution`), `k-row__chev`; tiles `k-tiles` > `k-tile`.
- KPI: `k-kpis` > `k-kpi` (+ `--caution|stop|ok`) > `k-kpi__label`, `k-kpi__num`, `k-kpi__foot`.
- Scanning: `k-target` (+ `--ok|stop`) > `k-target__text` > `k-target__label` ("KE BIN"),
  `k-target__code` (52 px mono; `--md` 40 px), `k-target__hint`; `k-code` (+ `--xl`) for GM numbers;
  `k-dots` > `k-dot` (`is-done`) for units scanned; the scan zone and stopwatch come from the helpers.
- Inputs: `k-field` > `k-field__label` + `k-input|k-select|k-textarea` + `k-field__hint|k-field__err`;
  `k-input--num`, `k-input--sm`; `k-check`; `k-segment`; `k-search`; `k-stepper`; `k-switch`.
- Feedback: `k-empty` (> `k-empty__icon`, `__title`, `__text`), `k-note` (+ `--info|caution|stop|ok|navy`),
  `k-progress` > `k-progress__bar`, `k-banner`, `k-loading`.
- Tokens: `var(--action)`, `--ok`, `--caution`, `--stop` (+ `-bg`), `--ink`, `--ink-2`, `--muted`,
  `--rule`, `--sunk`, `--navy`, `--mono`. Never colour alone: every state also has a word and an icon.

## 8. Placeholder pages

`pesanan`, `barang-masuk`, `hitung-stok`, `stok`, `rak-bin`, `karantina-retur`, `bahan-kemas`,
`restock`, `produk`, `menu-toko-hiryu`, `laporan` are the skeleton in section 1 with only `init`
filled. To build one: create `js/<page>.js` with `S.page(...)` (or `S.tab(...)` per tab), and
change the `init` options in the HTML if you need tabs, `allSites` or a subtitle. `pesanan.html`
already has its tabs: `ambil`, `kemas`, `serah`, `papan`, `kembalikan` (the menu item *Kembalikan
ke rak* opens `pesanan.html?tab=kembalikan`). `pengaturan.html` is the foundation's; its tab files
belong to their owners.

## 9. Old addresses

Every old station page (`frontend/NN-*.html`) and console page (`frontend/console/*.html`) is now a
stub that loads `app/legacy.js`, which sends the browser to the new page and keeps the query string
and hash (`console/restock-brand.html?id=12` opens `app/restock.html?id=12`). `frontend/index.html`
opens `app/`. The old markup is in git (`git show d925210:frontend/<file>`); the old
`js/screens/*.js` are untouched. `frontend/docs/` is untouched.

| Old | New (in `app/`) |
|---|---|
| `index.html`, `14-terkunci`, `console/index`, `console/perlu-tindakan` | `perlu-tindakan.html` |
| `01`..`04`, `15-penerimaan-selesai`, `console/barang-masuk`, `slip-putaway`, `slip-detail` | `barang-masuk.html` |
| `05-label-unit`, `06-label-sudah-terpakai`, `console/produk`, `lengkapi-sku`, `permintaan-sku` | `produk.html` |
| `07-ambil-pesanan`, `08-salah-barang`, `09-pesanan-selesai`, `17-barang-tidak-ada` | `pesanan.html?tab=ambil` |
| `21-pesanan-hub` | `pesanan.html?tab=kemas` |
| `20-tempel-pesanan`, `console/papan-antrean` | `pesanan.html?tab=papan` |
| `18-kembalikan`, `18-kembalikan-pindai` | `pesanan.html?tab=kembalikan` |
| `console/pesanan` | `pesanan.html` |
| `10`, `11`, `12` (count), `console/hitung-stok` | `hitung-stok.html` |
| `13-peta-rak`, `console/rak`, `registry`, `peta-hub`, `label-warna-hari` | `rak-bin.html` |
| `19-gudang-kirim`, `console/stok`, `stok-perhatian`, `transfer` | `stok.html` |
| `console/restock-brand` | `restock.html` |
| `console/selisih-restock` | `restock.html?tab=selisih` |
| `console/menu-hiryu`, `stok-hiryu` | `menu-toko-hiryu.html` |
| `console/laporan-merek` | `laporan.html` |
| `console/hub` | `pengaturan.html?tab=hub` |
| `console/staf` | `pengaturan.html?tab=orang` |
| `console/pengingat` | `pengaturan.html?tab=aturan` |
| `console/integrasi` | `pengaturan.html?tab=integrasi` |
| `console/simulator-grab`, `mode-latihan` | `pengaturan.html?tab=demo` |

Perlu tindakan rows still carry console links (`restock-brand.html?id=…`); the page passes them
through `S.route`, so they open the new pages. New rows may link to app pages directly.

## 10. Panduan

`panduan.html` lists the 11 sections; `panduan.html?s=6` shows one. Content is
`panduan/sections.json` (`sections[].title/intro/who/when/where/steps/rules`, each text as
`{id, en}`; text may contain `<em>` for the exact screen words, nothing else). It was generated from
the canvas working instructions `S01-wi`..`S10-wi`, plus section 11 written from boards 11a/11b.
Edit the JSON to change a step; keep both languages.
