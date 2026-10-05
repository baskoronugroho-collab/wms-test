/* produk.js: Produk (canvas boards 2f Lengkapi data SKU, 2d Merek).
 *
 *   tab sku    every SKU with its warehouse data. Only the bin size (Kecil or
 *              Besar) is required; the rest shows "Isi nanti" until filled.
 *              Saved automatically per field. Barcodes by Pindai or Tempel kode.
 *   tab merek  brands with their Grab merchant account; Tambah merek.
 *
 * API: GET /sku-complete?status=&site_id=&brand_id=&q=   PATCH /sku-complete/{id}
 *      POST /sku-complete/{id}/barcodes {barcode, source}
 *      GET|PUT /sku-complete/size-guide   GET /sku-complete/export.csv
 *      POST /sku-complete/import[?commit=true] (file)
 *      GET|POST /catalog/brands   PATCH /catalog/brands/{id}
 * Every role may look; Ops HQ edits (the server checks too).
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  const CSS = `
.pd-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.pd-filters .k-segment{flex-wrap:wrap}
.pd-guide{display:grid;gap:12px;align-items:start;grid-template-columns:minmax(0,1fr)}
@media(min-width:1024px){.pd-guide{grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)}}
.pd-table td{vertical-align:top;padding-top:10px;padding-bottom:10px}
.pd-table th,.pd-table td{padding-left:8px!important;padding-right:8px!important}
.pd-table th:first-child,.pd-table td:first-child{padding-left:16px!important}
.pd-name{font-weight:700;min-width:200px;max-width:280px}
.pd-sub{font-size:13px;color:var(--muted)}
.pd-sub--caution{color:var(--caution);font-weight:700}
.pd-sub--stop{color:var(--stop);font-weight:700}
.pd-bc{font-family:var(--mono);font-weight:700;font-size:13px}
.pd-src{font-size:12px;color:var(--ok);font-weight:700}
.pd-none{font-size:13px;color:var(--caution);font-weight:700}
.pd-seg{display:inline-flex;border-radius:10px;background:var(--sunk);padding:2px;gap:2px}
.pd-seg button{min-height:36px;padding:0 10px;border:0;border-radius:8px;background:transparent;font:inherit;font-weight:700;font-size:13px;color:var(--ink-2);cursor:pointer}
.pd-seg button[aria-pressed="true"]{background:var(--action);color:#fff}
.pd-seg.is-missing{box-shadow:0 0 0 2px var(--stop)}
.pd-seg button:disabled{cursor:default}
.pd-num{width:62px;min-height:38px!important;font-family:var(--mono);font-weight:700;font-size:14px!important;padding:0 8px!important;text-align:right}
.pd-num::placeholder{color:var(--caution);font-family:var(--font);font-weight:700;font-size:12px;text-align:left}
.pd-num.is-saved{box-shadow:0 0 0 2px var(--ok)}
.pd-dims{display:flex;align-items:center;gap:4px;color:var(--muted);font-weight:700}
.pd-dims .pd-num{width:48px}
.pd-card{display:flex;flex-direction:column;gap:10px}
.pd-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pd-fields label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--ink-2)}
.pd-fields .pd-num{width:100%}
.pd-brandtbl td{height:56px}
.pd-radio{display:flex;flex-direction:column;gap:8px}
.pd-radio label{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--rule);border-radius:12px;cursor:pointer;font-weight:600}
.pd-radio input{width:20px;height:20px;accent-color:var(--action);margin-top:1px}
.pd-radio small{display:block;color:var(--muted);font-weight:500}`;
  if (!document.getElementById('pd-css')) {
    const st = document.createElement('style'); st.id = 'pd-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  const SIZE = { KECIL: ['Kecil', 'Small'], BESAR: ['Besar', 'Large'] };
  const ISI_NANTI = () => t('Isi nanti', 'Fill later');
  const FILTERS = [
    ['all', 'Semua', 'All'], ['no_size', 'Tanpa ukuran bin', 'No bin size'],
    ['missing_data', 'Data belum lengkap', 'Data incomplete'], ['needs_bin', 'Perlu bin', 'Need a bin'],
  ];
  const PAGE = 30;

  function bcSource(b) {
    if (b.source === 'scanned') return t('dipindai', 'scanned') + (b.registered_at ? ' ' + S.fmt.time(b.registered_at) : '');
    if (b.source === 'pasted') return t('ditempel', 'pasted');
    if (b.source === 'hiryu') return t('dari Hiryu', 'from Hiryu');
    return t('terdaftar', 'registered');
  }
  function stateLine(r) {
    if (r.state === 'no_size') return '<span class="pd-sub pd-sub--stop">' + esc(r.brand_name || '') + ' · ' + esc(t('Tanpa ukuran bin', 'No bin size')) + '</span>';
    if (r.state === 'missing_data') return '<span class="pd-sub pd-sub--caution">' + esc(r.brand_name || '') + ' · ' +
      esc(t('Belum lengkap: ' + r.missing_data.length + ' data', 'Incomplete: ' + r.missing_data.length + ' items')) + '</span>';
    return '<span class="pd-sub">' + esc(r.brand_name || '') + ' · ' + esc(t('Lengkap', 'Complete')) + '</span>';
  }

  /* ================= tab: SKU (2f) ================= */
  S.tab('sku', async function (ctx) {
    const st = { status: ctx.params.get('filter') || 'all', q: '', brand: '', shown: PAGE, data: null };
    if (!FILTERS.some((f) => f[0] === st.status)) st.status = 'all';
    const canEdit = S.atLeast('hq');
    let brands = [];
    try { brands = (await api().get('/catalog/brands')).brands; } catch (e) { /* the filter just has no brands */ }

    ctx.actions.innerHTML = '<a class="k-btn k-btn--secondary" id="pd-csv-down" href="#">' + icon('download') + bis('Unduh CSV', 'Download CSV') + '</a>' +
      '<button type="button" class="k-btn k-btn--secondary" id="pd-csv-up" data-min-role="hq">' + icon('upload') + bis('Unggah CSV', 'Upload CSV') + '</button>' +
      '<input type="file" id="pd-file" accept=".csv,text/csv" hidden>';
    ctx.body.innerHTML =
      '<div class="pd-guide"><div class="k-stack k-stack--tight"><div class="pd-filters"><div class="k-segment" id="pd-filt" role="group"></div></div>' +
      '<div class="pd-filters"><label class="k-search k-grow">' + icon('search', 18) + '<input class="k-input" id="pd-q" type="search" ' +
        'data-ph-id="Cari nama, kode atau barcode" data-ph-en="Search name, code or barcode" placeholder="Cari nama, kode atau barcode"></label>' +
      '<select class="k-select" id="pd-brand" style="max-width:200px"><option value="">' + esc(t('Semua merek', 'All brands')) + '</option>' +
        brands.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('') + '</select></div>' +
      '<p class="k-caption">' + bis('Hanya ukuran bin yang wajib. Data lain boleh diisi nanti.', 'Only the bin size is required. The rest may be filled later.') +
        ' <b>' + bis('Tersimpan otomatis tiap baris.', 'Saved automatically, row by row.') + '</b></p></div>' +
      '<div class="k-card k-card--pad k-stack k-stack--tight" id="pd-guide"></div></div>' +
      '<div id="pd-rows"><div class="k-loading" ' + biAttr('Memuat produk…', 'Loading products…') + '></div></div>';
    const $ = (s) => ctx.body.querySelector(s);

    ctx.actions.querySelector('#pd-csv-down').addEventListener('click', (e) => {
      e.preventDefault();
      location.href = '/api/sku-complete/export.csv' + api().qs({ status: st.status, q: st.q, brand_id: st.brand, site_id: S.siteId() });
    });
    ctx.actions.querySelector('#pd-csv-up').addEventListener('click', () => ctx.actions.querySelector('#pd-file').click());
    ctx.actions.querySelector('#pd-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) uploadCsv(f, load);
    });

    function paintGuide(g) {
      $('#pd-guide').innerHTML = '<div class="k-line k-line--between"><span class="k-strong">' + bis('Ukuran bin', 'Bin size') + '</span>' +
        '<span class="k-tag">' + esc(g.note) + '</span></div>' +
        '<span><b>' + esc(t('Kecil', 'Kecil')) + '</b> ' + esc(g.kecil_text.replace(/^Kecil: /, '')) + '</span>' +
        '<span><b>' + esc(t('Besar', 'Besar')) + '</b> ' + esc(g.besar_text.replace(/^Besar: /, '')) + '</span>' +
        '<div><button type="button" class="k-linkbtn" id="pd-guide-edit" data-min-role="hq">' + icon('edit', 16) + bis('Ubah batas', 'Change the limits') + '</button></div>';
      $('#pd-guide-edit').addEventListener('click', () => editGuide(g, load));
      S.applyLang($('#pd-guide')); S.lockAll($('#pd-guide'));
    }
    function paintFilters() {
      const c = st.data ? st.data.counts : {};
      $('#pd-filt').innerHTML = FILTERS.map((f) => '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (st.status === f[0]) + '">' +
        '<span ' + biAttr(f[1], f[2]) + '>' + esc(t(f[1], f[2])) + '</span>' + (c[f[0]] != null ? ' (' + c[f[0]] + ')' : '') + '</button>').join('');
    }
    $('#pd-filt').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      st.status = b.dataset.f; st.shown = PAGE;
      const u = new URL(location.href); u.searchParams.set('filter', st.status); history.replaceState(null, '', u.pathname + u.search);
      load();
    });
    let qT = null;
    $('#pd-q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { st.q = $('#pd-q').value.trim(); st.shown = PAGE; load(); }, 300); });
    $('#pd-brand').addEventListener('change', () => { st.brand = $('#pd-brand').value; st.shown = PAGE; load(); });

    async function load() {
      try {
        st.data = await api().get('/sku-complete' + api().qs({ status: st.status, q: st.q, brand_id: st.brand, site_id: S.siteId() }));
      } catch (e) { S.fail(e); return; }
      paintFilters();
      paintGuide(st.data.guide);
      paintRows();
    }
    function paintRows() {
      const rows = st.data.rows.slice(0, st.shown);
      const host = $('#pd-rows');
      if (!st.data.rows.length) {
        host.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
          bis('Tidak ada SKU di sini', 'No SKUs here', 'k-empty__title') + bis('Coba filter lain.', 'Try another filter.', 'k-empty__text') + '</div>';
        S.applyLang(host);
        return;
      }
      const more = st.data.rows.length - rows.length;
      host.innerHTML = (canEdit ? '' : '<div class="k-note k-note--info" style="margin-bottom:12px">' + icon('lock', 18) + bis('Hanya Ops HQ yang bisa mengubah data SKU.', 'Only Ops HQ can change SKU data.') + '</div>') +
        '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table pd-table"><thead><tr>' +
        '<th ' + biAttr('Produk', 'Product') + '></th><th ' + biAttr('Barcode untuk pindai', 'Barcode to scan') + '></th>' +
        '<th><span ' + biAttr('Ukuran bin', 'Bin size') + '></span> <span class="k-tag" style="color:var(--stop);background:var(--stop-bg)" ' + biAttr('Wajib', 'Required') + '></span></th>' +
        '<th ' + biAttr('Isi sampai', 'Fill up to') + '></th><th ' + biAttr('Pesan ulang saat sisa', 'Reorder at') + '></th>' +
        '<th ' + biAttr('Cadangan Grab', 'Grab buffer') + '></th><th ' + biAttr('Kemasan P × L × T mm', 'Pack L × W × H mm') + '></th><th ' + biAttr('Berat g', 'Weight g') + '></th>' +
        '</tr></thead><tbody>' + rows.map((r) => '<tr data-skuid="' + r.id + '">' + rowCells(r) + '</tr>').join('') + '</tbody></table></div></div>' +
        '<div class="k-phone-only k-stack">' + rows.map((r) => '<div class="k-card k-card--pad pd-card" data-skuid="' + r.id + '">' + cardHtml(r) + '</div>').join('') + '</div>' +
        '<div class="k-line k-line--between" style="margin-top:12px;flex-wrap:wrap;gap:8px"><span class="k-caption">' +
        esc(t(rows.length + ' dari ' + st.data.rows.length + ' ditampilkan. Satu barcode hanya untuk satu SKU. Tanpa Isi sampai, SKU tidak dapat saran jumlah di PO.',
          rows.length + ' of ' + st.data.rows.length + ' shown. One barcode belongs to one SKU. Without Fill up to, a SKU gets no suggested quantity on a PO.')) + '</span>' +
        (more > 0 ? '<button type="button" class="k-btn k-btn--secondary k-btn--sm" id="pd-more">' + esc(t('Tampilkan ' + Math.min(more, PAGE) + ' lagi', 'Show ' + Math.min(more, PAGE) + ' more')) + '</button>' : '') + '</div>';
      S.applyLang(host);
      if (!canEdit) host.querySelectorAll('input, .pd-seg button').forEach((el) => { el.disabled = true; });
      const m = host.querySelector('#pd-more');
      if (m) m.addEventListener('click', () => { st.shown += PAGE; paintRows(); });
    }
    function sizeSeg(r) {
      return '<div class="pd-seg' + (r.bin_size ? '' : ' is-missing') + '" role="group" aria-label="' + esc(t('Ukuran bin', 'Bin size')) + '">' +
        ['KECIL', 'BESAR'].map((s) => '<button type="button" data-size="' + s + '" aria-pressed="' + (r.bin_size === s) + '">' + esc(t(SIZE[s][0], SIZE[s][1])) + '</button>').join('') + '</div>' +
        (!r.bin_size ? '<div class="pd-sub pd-sub--stop">' + esc(t('Pilih', 'Choose')) + (r.suggested_bin_size ? ' · ' + esc(t('saran: ', 'suggested: ')) + esc(t(SIZE[r.suggested_bin_size][0], SIZE[r.suggested_bin_size][1])) : '') + '</div>' : '');
    }
    function bcCell(r) {
      if (r.barcodes.length) {
        const b = r.barcodes[0];
        return '<div class="pd-bc">' + esc(b.barcode) + (r.barcodes.length > 1 ? ' <span class="k-muted">+' + (r.barcodes.length - 1) + '</span>' : '') + '</div>' +
          '<div class="pd-src">' + esc(bcSource(b)) + '</div>' +
          (S.atLeast('hq') ? '<button type="button" class="k-linkbtn" data-bc="paste" style="font-size:12px">' + esc(t('Tambah barcode', 'Add a barcode')) + '</button>' : '');
      }
      if (!S.atLeast('hq')) return '<div class="pd-none">' + esc(t('Belum ada barcode', 'No barcode yet')) + '</div>';
      return '<div class="pd-none">' + esc(t('Belum ada barcode', 'No barcode yet')) + '</div><div class="k-line" style="gap:6px;margin-top:4px">' +
        '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-bc="scan">' + icon('scan', 16) + '<span>' + esc(t('Pindai', 'Scan')) + '</span></button>' +
        '<button type="button" class="k-btn k-btn--sm k-btn--ghost" data-bc="paste">' + esc(t('Tempel kode', 'Paste code')) + '</button></div>';
    }
    const num = (r, f, ph) => '<input class="k-input pd-num" type="number" inputmode="numeric" min="0" data-field="' + f + '" value="' + (r[f] == null ? '' : r[f]) + '" placeholder="' + esc(ph || ISI_NANTI()) + '" aria-label="' + esc(f) + '">';
    const bufPh = () => String(st.data.grab_buffer_default);
    function rowCells(r) {
      return '<td><div class="pd-name">' + esc(r.name_display) + '</div>' + stateLine(r) + '</td>' +
        '<td>' + bcCell(r) + '</td><td>' + sizeSeg(r) + '</td>' +
        '<td>' + num(r, 'fill_to') + '</td><td>' + num(r, 'reorder_at') + '</td><td>' + num(r, 'grab_buffer', bufPh()) + '</td>' +
        '<td><div class="pd-dims">' + num(r, 'pack_length_mm', '-') + '×' + num(r, 'pack_width_mm', '-') + '×' + num(r, 'pack_height_mm', '-') + '</div>' +
        (r.missing_data.includes('pack_size') ? '<div class="pd-sub pd-sub--caution">' + esc(ISI_NANTI()) + '</div>' : '') + '</td>' +
        '<td>' + num(r, 'pack_weight_g') + '</td>';
    }
    function cardHtml(r) {
      return '<div><div class="pd-name">' + esc(r.name_display) + '</div>' + stateLine(r) + '</div>' +
        '<div class="k-line k-line--between" style="align-items:flex-start;gap:10px"><div>' + bcCell(r) + '</div><div>' + sizeSeg(r) + '</div></div>' +
        '<div class="pd-fields"><label>' + esc(t('Isi sampai', 'Fill up to')) + num(r, 'fill_to') + '</label>' +
        '<label>' + esc(t('Pesan ulang saat sisa', 'Reorder at')) + num(r, 'reorder_at') + '</label>' +
        '<label>' + esc(t('Cadangan Grab', 'Grab buffer')) + num(r, 'grab_buffer', bufPh()) + '</label>' +
        '<label>' + esc(t('Berat g', 'Weight g')) + num(r, 'pack_weight_g') + '</label></div>' +
        '<label class="pd-fields" style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:var(--ink-2)">' + esc(t('Kemasan P × L × T mm', 'Pack L × W × H mm')) +
        '<div class="pd-dims">' + num(r, 'pack_length_mm', '-') + '×' + num(r, 'pack_width_mm', '-') + '×' + num(r, 'pack_height_mm', '-') + '</div></label>';
    }
    function replaceRow(r) {
      const i = st.data.rows.findIndex((x) => x.id === r.id);
      if (i >= 0) st.data.rows[i] = r;
      ctx.body.querySelectorAll('[data-skuid="' + r.id + '"]').forEach((el) => {
        el.innerHTML = el.tagName === 'TR' ? rowCells(r) : cardHtml(r);
        S.applyLang(el);
      });
    }
    async function patch(id, body, input) {
      try {
        const res = await api().patch('/sku-complete/' + id, body);
        replaceRow(res.row);
        if (input) {
          const again = ctx.body.querySelector('[data-skuid="' + id + '"] [data-field="' + input + '"]');
          if (again) { again.classList.add('is-saved'); setTimeout(() => again.classList.remove('is-saved'), 1200); }
        }
        S.toast(S.pick(res.message), 'ok', 1500);
      } catch (e) { S.fail(e); load(); }
    }
    $('#pd-rows').addEventListener('click', (e) => {
      const host = e.target.closest('[data-skuid]');
      if (!host || !canEdit) return;
      const id = +host.dataset.skuid;
      const sz = e.target.closest('[data-size]');
      if (sz) { patch(id, { bin_size: sz.dataset.size }); return; }
      const bc = e.target.closest('[data-bc]');
      if (bc) barcodeDialog(st.data.rows.find((x) => x.id === id), bc.dataset.bc, replaceRow);
    });
    $('#pd-rows').addEventListener('change', (e) => {
      const inp = e.target.closest('[data-field]');
      const host = e.target.closest('[data-skuid]');
      if (!inp || !host || !canEdit) return;
      const v = inp.value.trim();
      patch(+host.dataset.skuid, { [inp.dataset.field]: v === '' ? null : parseInt(v, 10) }, inp.dataset.field);
    });
    await load();
  });

  function barcodeDialog(r, mode, done) {
    async function save(code, source) {
      const res = await api().post('/sku-complete/' + r.id + '/barcodes', { barcode: code, source });
      done(res.row);
      S.toast(S.pick(res.message), 'ok');
    }
    if (mode === 'scan') {
      const m = S.modal({
        title: ['Pindai barcode', 'Scan the barcode'],
        body: '<div class="k-stack"><p class="k-p"><b>' + esc(r.name_display) + '</b></p><p class="k-caption">' +
          bis('Ambil satu unit dan pindai barcode di kemasannya. Satu barcode hanya untuk satu SKU.', 'Take one unit and scan the barcode on the pack. One barcode belongs to one SKU.') + '</p><div id="pd-zone"></div></div>',
      });
      const z = S.scan(async (code, zz) => {
        try { await save(code, 'scanned'); zz.accept(['Terdaftar', 'Registered'], code); setTimeout(() => m.close(), 700); }
        catch (e) { zz.reject(S.pick(e.message), ''); }
      }, { title: ['Pindai barcode', 'Scan the barcode'], mount: m.body.querySelector('#pd-zone') });
      z.focus();
      return;
    }
    S.modal({
      title: ['Tempel kode', 'Paste the code'],
      body: '<div class="k-stack"><p class="k-p"><b>' + esc(r.name_display) + '</b></p><label class="k-field"><span class="k-field__label" ' + biAttr('Barcode', 'Barcode') + '></span>' +
        '<input class="k-input k-mono" id="pd-paste" autocomplete="off" inputmode="numeric"></label><p class="k-caption">' +
        bis('Satu barcode hanya untuk satu SKU: kode yang sudah dipakai SKU lain ditolak.', 'One barcode belongs to one SKU: a code another SKU uses is refused.') + '</p></div>',
      actions: [{ label: ['Batal', 'Cancel'] }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq', onClick: async (close, b) => {
          const v = b.closest('.k-modal').querySelector('#pd-paste').value.trim();
          if (!v) return false;
          await save(v, 'pasted');
        },
      }],
    });
  }

  function editGuide(g, reload) {
    const f = (k, id, en) => '<label class="k-field"><span class="k-field__label" ' + biAttr(id, en) + '></span><input class="k-input k-input--num" type="number" min="1" data-k="' + k + '" value="' + g[k] + '"></label>';
    S.modal({
      title: ['Batas ukuran bin', 'Bin size limits'],
      body: '<div class="k-stack"><p class="k-caption">' + bis('Kecil: kemasan muat di kotak ini. Besar: lebih besar, atau botol mulai ukuran di bawah.', 'Kecil: the pack fits this box. Besar: larger, or a bottle from the size below.') + '</p>' +
        '<div class="k-grid3">' + f('length_cm', 'Panjang cm', 'Length cm') + f('width_cm', 'Lebar cm', 'Width cm') + f('height_cm', 'Tinggi cm', 'Height cm') + '</div>' +
        f('bottle_ml', 'Botol Besar mulai ml', 'Besar bottle from ml') + '</div>',
      actions: [{ label: ['Batal', 'Cancel'] }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq', onClick: async (close, b) => {
          const body = {};
          b.closest('.k-modal').querySelectorAll('[data-k]').forEach((i) => { body[i.dataset.k] = parseInt(i.value, 10) || null; });
          await api().put('/sku-complete/size-guide', body);
          S.toast(['Batas ukuran bin tersimpan.', 'Bin size limits saved.'], 'ok');
          reload();
        },
      }],
    });
  }

  async function uploadCsv(file, reload) {
    const fd = new FormData();
    fd.append('file', file);
    let res;
    try { res = await api().form('/sku-complete/import', fd); } catch (e) { S.fail(e); return; }
    const rows = res.rows.filter((r) => r.status !== 'same');
    S.modal({
      title: ['Pratinjau CSV', 'CSV preview'], wide: true,
      body: '<div class="k-stack"><p class="k-p">' + esc(S.pick(res.message)) + '</p>' + (rows.length ? '<div class="k-tablewrap"><table class="k-table"><thead><tr><th>' +
        esc(t('Baris', 'Row')) + '</th><th>' + esc(t('Produk', 'Product')) + '</th><th>' + esc(t('Perubahan', 'Changes')) + '</th></tr></thead><tbody>' +
        rows.map((r) => '<tr class="' + (r.status === 'error' ? 'is-stop' : '') + '"><td class="k-num">' + r.row_no + '</td><td>' + esc(r.name || r.code || '') + '</td><td>' +
          (r.errors.length ? '<span style="color:var(--stop)">' + esc(r.errors.map(S.pick).join(' ')) + '</span>'
            : r.changes.map((c) => esc(c.label) + ': ' + esc(c.old || '-') + ' → <b>' + esc(c.new || '-') + '</b>').join('<br>')) + '</td></tr>').join('') +
        '</tbody></table></div>' : '') + '</div>',
      actions: [{ label: ['Batal', 'Cancel'] }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq', onClick: async () => {
          const r = await api().form('/sku-complete/import?commit=true', fd);
          S.toast(S.pick(r.message), 'ok');
          reload();
        },
      }],
    });
  }

  /* ================= tab: Merek (2d) ================= */
  S.tab('merek', async function (ctx) {
    S.setSub('Merek ditambah di WMS. Toko, menu dan SKU datang dari Hiryu.', 'Brands are added in the WMS. Stores, menus and SKUs come from Hiryu.');
    const d = await api().get('/catalog/brands');
    S.tabCount('merek', d.brands.length);
    ctx.actions.innerHTML = '<button type="button" class="k-btn k-btn--primary" id="pd-addbrand" data-min-role="hq">' + icon('plus') + bis('Tambah merek', 'Add brand') + '</button>';
    ctx.actions.querySelector('#pd-addbrand').addEventListener('click', () => brandForm(null, d));
    const acct = (b) => b.grab_account === 'ninja' ? '<span class="k-tag" style="color:var(--ink-2);background:var(--sunk)">Ninja Van</span>'
      : b.grab_account === 'own' ? '<span class="k-tag">' + esc(t('Merek sendiri', 'Own account')) + '</span>' : '<span class="k-muted">-</span>';
    const yes = (v) => v == null ? '<span class="k-muted">-</span>' : esc(v ? t('Ada', 'Yes') : t('Tidak', 'No'));
    const cnt = (n) => n ? esc(String(n)) : '<span class="k-muted">' + esc(t('belum', 'none yet')) + '</span>';
    const editable = S.atLeast('hq');
    ctx.body.innerHTML = '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table pd-brandtbl"><thead><tr><th>' + esc(t('Merek', 'Brand')) + '</th><th>' +
      esc(t('Akun Grab', 'Grab account')) + '</th><th>' + esc(t('Barcode', 'Barcodes')) + '</th><th class="k-num">' + esc(t('Toko', 'Stores')) + '</th><th class="k-num">SKU</th><th></th></tr></thead><tbody>' +
      d.brands.map((b) => '<tr' + (b.active ? '' : ' style="opacity:.6"') + '><td><div class="k-cell2"><span class="k-cell2__main">' + esc(b.name) + '</span>' +
        (b.company ? '<span class="k-cell2__sub">' + esc(b.company) + '</span>' : '') + '</div></td><td>' + acct(b) + '</td><td>' + yes(b.has_barcodes) + '</td>' +
        '<td class="k-num" title="' + esc(b.store_names.join(', ')) + '">' + cnt(b.stores) + '</td><td class="k-num">' + cnt(b.skus) + '</td>' +
        '<td class="k-table__actions">' + (editable ? '<button type="button" class="k-btn k-btn--sm k-btn--ghost" data-edit="' + b.id + '">' + icon('edit', 16) + '<span>' + esc(t('Ubah', 'Edit')) + '</span></button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="k-phone-only k-list">' + d.brands.map((b) => '<div class="k-row"' + (editable ? ' data-edit="' + b.id + '" role="button" tabindex="0"' : '') + '><span class="k-row__text"><span class="k-row__title">' + esc(b.name) + '</span>' +
        '<span class="k-row__sub">' + [b.grab_account === 'ninja' ? 'Ninja Van (Nemu Mart)' : b.grab_account === 'own' ? t('Merek sendiri', 'Own account') : '-',
          b.stores + ' ' + t('toko', 'stores'), b.skus + ' SKU'].map(esc).join(' · ') + '</span></span>' + (editable ? '<span class="k-row__chev">' + icon('chev', 22) + '</span>' : '') + '</div>').join('') + '</div>' +
      (d.brands.length ? '' : '<div class="k-card k-empty"><span class="k-empty__title">' + esc(t('Belum ada merek', 'No brands yet')) + '</span></div>') +
      '<div class="k-note k-note--info">' + icon('info', 20) + '<span>' + esc(d.note) + '</span></div>';
    ctx.body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => brandForm(d.brands.find((x) => x.id === +b.dataset.edit), d)));
  });

  function brandForm(b, d) {
    const v = b || { name: '', company: '', restock_email: '', has_barcodes: null, grab_account: null, active: true };
    const radio = (name, val, id, en, sub) => '<label><input type="radio" name="' + name + '" value="' + val + '"' + (String(v[name]) === String(val) ? ' checked' : '') + '>' +
      '<span><span ' + biAttr(id, en) + '></span>' + (sub ? '<small ' + biAttr(sub[0], sub[1]) + '></small>' : '') + '</span></label>';
    S.drawer({
      title: b ? ['Ubah merek', 'Edit brand'] : ['Tambah merek', 'Add brand'],
      body: '<form class="k-stack" id="pd-bf" autocomplete="off">' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Nama merek · sama dengan di Hiryu dan Grab', 'Brand name · the same as in Hiryu and Grab') + '></span><input class="k-input" name="name" value="' + esc(v.name) + '" required></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Perusahaan', 'Company') + '></span><input class="k-input" name="company" value="' + esc(v.company || '') + '"></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Email kontak restock · PO restock dikirim ke sini', 'Restock contact e-mail · restock POs go here') + '></span><input class="k-input" type="email" name="restock_email" value="' + esc(v.restock_email || '') + '"></label>' +
        '<fieldset class="k-field" style="border:0;padding:0;margin:0"><legend class="k-field__label" ' + biAttr('Apakah kemasan punya barcode?', 'Do the packs carry barcodes?') + '></legend><div class="pd-radio" style="flex-direction:row">' +
          radio('has_barcodes', 'true', 'Ya, ada barcode', 'Yes, barcodes') + radio('has_barcodes', 'false', 'Tidak', 'No') + '</div>' +
          '<span class="k-field__hint" ' + biAttr('Jika Ya, barcode didaftarkan per SKU di Produk.', 'If yes, barcodes are registered per SKU on Produk.') + '></span></fieldset>' +
        '<fieldset class="k-field" style="border:0;padding:0;margin:0"><legend class="k-field__label" ' + biAttr('Akun merchant Grab', 'Grab merchant account') + '></legend><div class="pd-radio">' +
          radio('grab_account', 'own', 'Akun merchant merek sendiri', 'The brand\'s own merchant account') +
          radio('grab_account', 'ninja', 'Akun merchant Ninja Van', 'Ninja Van\'s merchant account', ['Nemu Mart, untuk merek di bawah 10 SKU', 'Nemu Mart, for brands under 10 SKUs']) + '</div></fieldset>' +
        (b ? '<label class="k-check"><input type="checkbox" name="active"' + (v.active ? ' checked' : '') + '><span ' + biAttr('Merek aktif', 'Brand active') + '></span></label>' : '') +
        '</form>',
      actions: [{ label: ['Batal', 'Cancel'] }, {
        label: ['Simpan merek', 'Save brand'], kind: 'primary', minRole: 'hq', onClick: async (close, btn) => {
          const f = btn.closest('.k-drawer').querySelector('#pd-bf');
          const fd = new FormData(f);
          const hb = fd.get('has_barcodes');
          const body = {
            name: (fd.get('name') || '').trim(), company: (fd.get('company') || '').trim() || null,
            restock_email: (fd.get('restock_email') || '').trim() || null,
            has_barcodes: hb == null ? null : hb === 'true', grab_account: fd.get('grab_account') || null,
          };
          if (b) body.active = !!fd.get('active');
          if (!body.name) { S.toast(['Isi nama merek.', 'Enter the brand name.'], 'stop'); return false; }
          if (!body.grab_account) { S.toast(['Pilih akun merchant Grab.', 'Choose the Grab merchant account.'], 'stop'); return false; }
          if (b) await api().patch('/catalog/brands/' + b.id, body); else await api().post('/catalog/brands', body);
          S.toast(['Merek tersimpan.', 'Brand saved.'], 'ok');
          S.rerender();
        },
      }],
    });
  }
})();
