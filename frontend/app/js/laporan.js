/* laporan.js: Laporan (canvas Section 10, boards 10a to 10e).
 *
 * Tabs: akhir (10a: end of day per hub: orders by state, today's problems,
 * sales, the SPV's note for tomorrow, CSV), penjualan (10b/10c: the brand's
 * weekly or monthly Excel with a preview; hub multi-select with Semua hub),
 * operasional (10d: the KPIs for Grab and management next to the period
 * before; downloadable), selisih (10e: the monthly variance and claims Excel,
 * Finalised by Ops HQ). Every figure comes from the WMS. Ops HQ downloads and
 * emails the files by hand.
 *
 * API (backend/routers/reports.py, /api/reports):
 *   GET end-of-day?site_id&day   GET end-of-day.csv   PUT end-of-day/note {site_id, day, note}
 *   GET brand-sales/period|preview|.xlsx ?brand_id&period&start&hub_ids
 *   GET operational[.xlsx] ?period&start&hub_ids
 *   GET variance[.xlsx] ?month&hub_ids   POST variance/finalise {month}
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const api = () => S.api();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const n = (v) => S.fmt.n(v);
  const sp = (id, en) => '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  const btn = (cls, id, en, attrs, ic) => '<button type="button" class="k-btn ' + (cls || '') + '" ' + (attrs || '') + '>' + (ic ? icon(ic, 18, 2.2) : '') + sp(id, en) + '</button>';
  const MON_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (x) => String(x).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  function styles() {
    if ($('#lp-style')) return;
    const st = document.createElement('style');
    st.id = 'lp-style';
    st.textContent = [
      '.lp-form{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end}',
      '.lp-form .k-field{margin:0}',
      '.lp-hubs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid var(--rule);padding-top:14px;margin-top:14px}',
      '.lp-chip{min-height:40px;padding:0 16px;border-radius:999px;border:1.5px solid var(--rule);background:var(--surface);font-weight:700;color:var(--ink);display:inline-flex;align-items:center;gap:6px}',
      '.lp-chip[aria-pressed="true"]{border-color:var(--action);background:var(--action-bg);color:var(--action)}',
      '.lp-sub{font-size:13px;color:var(--muted)}',
      '.lp-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}',
      '@media(min-width:1024px){.lp-grid{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}}',
      '.lp-kfoot{display:grid;grid-template-columns:repeat(2,1fr);border-top:1px solid var(--rule)}',
      '@media(min-width:600px){.lp-kfoot{grid-template-columns:repeat(4,1fr)}}',
      '.lp-kfoot div{padding:12px 16px;border-right:1px solid var(--rule)}',
      '.lp-kfoot b{display:block;font-family:var(--mono);font-size:20px}',
      '.lp-prob{display:flex;gap:10px;padding:8px 0}',
      '.lp-prob b{display:block}',
      '.lp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}',
      '.lp-kpi{background:var(--surface);border-radius:var(--r-card);box-shadow:var(--shadow);padding:16px 18px;display:flex;flex-direction:column;gap:6px;min-height:140px}',
      '.lp-kpi__num{font-family:var(--mono);font-size:34px;font-weight:800;line-height:1.1}',
      '.lp-kpi__num small{font-size:18px;font-weight:700;margin-left:6px}',
      '.lp-kpi__foot{margin-top:auto;font-size:12px;color:var(--muted)}',
      '.lp-cover{width:100%;border-collapse:collapse;font-size:13px}.lp-cover td,.lp-cover th{padding:4px 2px;border-bottom:1px solid var(--rule);text-align:left}.lp-cover .k-num{text-align:right;font-family:var(--mono)}',
      '.lp-tag{display:inline-flex;padding:3px 8px;border:1.5px dashed var(--rule);border-radius:8px;font-size:12px;font-weight:700;color:var(--muted)}',
      '#k-body .lp-xl td,#k-body .lp-xl th{font-size:12.5px;padding:8px 8px}',
      '#k-body .lp-xl td.k-mono{white-space:nowrap}',
      '#k-body .lp-xl th{white-space:normal;vertical-align:bottom}',
      '#k-body .lp-xl td.lp-prod{min-width:170px}',
      '@media(max-width:1023.98px){#k-body .lp-hideph{display:none}}',
      '.lp-xl .k-num{white-space:nowrap}',
    ].join('\n');
    document.head.appendChild(st);
  }

  async function download(url, fallback) {
    const headers = {};
    try { const v = localStorage.getItem('njw.viewAs'); if (v) headers['X-View-As'] = v; } catch (e) { /* none */ }
    const res = await fetch('/api' + url, { headers, cache: 'no-store' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) { /* plain */ }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const m = (res.headers.get('Content-Disposition') || '').match(/filename="?([^";]+)"?/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = m ? m[1] : fallback;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* Weeks (Monday to Sunday, ISO numbers) and months to choose from. */
  function isoWeek(d) {
    const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = x.getUTCDay() || 7;
    x.setUTCDate(x.getUTCDate() + 4 - day);
    const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    return Math.ceil(((x - y) / 86400000 + 1) / 7);
  }
  function weeks() {
    const now = new Date();
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const out = [];
    for (let i = 0; i < 10; i++) {
      const a = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7 * i);
      const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
      const w = isoWeek(a);
      const span = [a.getDate() + ' ' + MON_ID[a.getMonth()] + ' sampai ' + b.getDate() + ' ' + MON_ID[b.getMonth()] + ' ' + b.getFullYear(),
        a.getDate() + ' ' + MON_EN[a.getMonth()] + ' to ' + b.getDate() + ' ' + MON_EN[b.getMonth()] + ' ' + b.getFullYear()];
      const pre = i === 0 ? ['Minggu ini: ', 'This week: '] : i === 1 ? ['Minggu lalu: ', 'Last week: '] : ['', ''];
      out.push({ value: ymd(a), id: pre[0] + 'W' + w + ', ' + span[0], en: pre[1] + 'W' + w + ', ' + span[1] });
    }
    return out;
  }
  function months() {
    const now = new Date();
    const out = [];
    for (let i = 0; i < 12; i++) {
      const a = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const pre = i === 0 ? ['Bulan ini: ', 'This month: '] : i === 1 ? ['Bulan lalu: ', 'Last month: '] : ['', ''];
      out.push({ value: ymd(a), id: pre[0] + FULL_ID[a.getMonth()] + ' ' + a.getFullYear(), en: pre[1] + FULL_EN[a.getMonth()] + ' ' + a.getFullYear() });
    }
    return out;
  }
  const options = (list, sel) => list.map((o) => '<option value="' + o.value + '"' + (o.value === sel ? ' selected' : '') + '>' + esc(t(o.id, o.en)) + '</option>').join('');

  /* Pilih hub: Semua hub, one hub or several. Empty set = Semua hub. */
  function hubPicker(host, state, onChange, extra) {
    const sites = S.sites();
    host.innerHTML = '<span class="k-strong" ' + biAttr('Pilih dark store', 'Choose dark stores') + '></span>' +
      '<button type="button" class="lp-chip" data-hub="all">' + sp('Semua dark store', 'All dark stores') + '</button>' +
      sites.map((s) => '<button type="button" class="lp-chip" data-hub="' + s.id + '">' + esc(S.shortCode(s.code)) + '</button>').join('') +
      '<span class="lp-sub" ' + biAttr('Semua dark store, satu atau beberapa', 'All dark stores, one or several') + '></span><span class="k-grow"></span><span class="lp-sub" id="lp-cmp"></span>' + (extra || '');
    const paint = () => $$('[data-hub]', host).forEach((b) => {
      const on = b.dataset.hub === 'all' ? !state.hubs.size : state.hubs.has(+b.dataset.hub);
      b.setAttribute('aria-pressed', String(on));
      const ic = b.querySelector('svg');
      if (on && !ic) b.insertAdjacentHTML('afterbegin', icon('check', 15, 2.6));
      if (!on && ic) ic.remove();
    });
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-hub]');
      if (!b) return;
      if (b.dataset.hub === 'all') state.hubs.clear();
      else {
        const id = +b.dataset.hub;
        if (state.hubs.has(id)) state.hubs.delete(id); else state.hubs.add(id);
        if (state.hubs.size === sites.length) state.hubs.clear();
      }
      paint();
      onChange();
    });
    paint();
  }
  const hubIds = (state) => Array.from(state.hubs).sort().join(',');

  function hqOnly(ctx) {
    if (S.atLeast('hq')) return false;
    ctx.body.insertAdjacentHTML('afterbegin', '<div class="k-note k-note--info">' + icon('lock', 20) + sp('Laporan ini dibuat dan diunduh Ops HQ.', 'Ops HQ makes and downloads this report.') + '</div>');
    return true;
  }

  /* ================= 10a: end of day ================= */

  S.tab('akhir', async function (ctx) {
    styles();
    const sites = S.sites();
    let siteId = ctx.siteId || (sites[0] && sites[0].id);
    let day = ctx.params.get('day') || ymd(new Date());
    let view = 'pesanan';
    ctx.body.innerHTML = '<div class="k-stack" id="lp-a"><div class="k-loading"></div></div>';
    const root = $('#lp-a', ctx.body);
    async function load() {
      const d = await api().get('/reports/end-of-day' + api().qs({ site_id: siteId, day }));
      const dt = new Date(d.day + 'T00:00:00');
      const dayLong = [['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dt.getDay()] + ' ' + dt.getDate() + ' ' + FULL_ID[dt.getMonth()],
        ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()] + ' ' + dt.getDate() + ' ' + FULL_EN[dt.getMonth()]];
      S.setTitle('Akhir hari: ' + d.site_code + ', ' + dayLong[0], 'End of day: ' + d.site_code + ', ' + dayLong[1]);
      S.setSub('Angka dari WMS. Pesanan tes dan pesanan batal tidak masuk penjualan.', 'WMS numbers. Test orders and cancelled orders are not in sales.');
      ctx.actions.innerHTML = (ctx.siteId ? '' : '<select class="k-select" id="lp-site" style="width:auto">' + sites.map((s) => '<option value="' + s.id + '"' + (s.id === siteId ? ' selected' : '') + '>' + esc(S.siteLabel(s)) + '</option>').join('') + '</select>') +
        '<input class="k-input" type="date" id="lp-day" value="' + esc(day) + '" style="width:auto">' +
        btn('k-btn--secondary', 'Unduh CSV', 'Download CSV', 'id="lp-csv"', 'download');
      const st = d.states;
      const row = (kind, id, en, mid, men, v) => '<tr><td>' + S.pill(kind, id, en) + '</td><td class="lp-hideph">' + sp(mid, men) + '</td><td class="k-num k-strong" style="font-size:18px">' + n(v) + '</td></tr>';
      const probIcon = { cancel_missing: ['warn', 'var(--stop)'], quarantine: ['warn', 'var(--caution)'], late_parcel: ['clock', 'var(--caution)'] };
      const probs = (list) => list.length ? list.map((p) => '<div class="lp-prob"><span style="color:' + (probIcon[p.kind] || ['info', 'var(--muted)'])[1] + '">' + icon((probIcon[p.kind] || ['info'])[0], 18) + '</span>' +
        '<span><b style="color:' + (probIcon[p.kind] || ['info', 'var(--ink)'])[1] + '">' + esc(p.title_id) + '</b><span class="lp-sub">' + esc(p.detail_id || '') + '</span></span></div>').join('')
        : '<p class="lp-sub" ' + biAttr('Tidak ada masalah hari ini.', 'No problems today.') + '></p>';
      const statusCard = '<div class="k-card" style="overflow:hidden"><div class="k-line k-line--between" style="padding:16px 18px;gap:12px"><div><strong style="font-size:17px" ' + biAttr('Pesanan hari ini menurut status', 'Today\'s orders by state') + '></strong>' +
        '<div class="lp-sub">' + esc(t('Dihitung sampai ', 'Counted up to ') + d.counted_until) + '</div></div><div style="text-align:right"><div style="font-family:var(--mono);font-size:36px;font-weight:800">' + n(d.orders) + '</div>' +
        '<div class="lp-sub" ' + biAttr('pesanan, tanpa pesanan tes', 'orders, without test orders') + '></div></div></div>' +
        '<table class="k-table"><thead><tr><th>Status</th><th class="lp-hideph" ' + biAttr('Artinya', 'Meaning') + '></th><th class="k-num" ' + biAttr('Jumlah', 'Count') + '></th></tr></thead><tbody>' +
        row('ok', 'Diserahkan ke driver', 'Handed to the driver', 'Paket dicek saat serah terima', 'Parcel checked at handover', st.handed_over) +
        row('caution', 'Siap, menunggu driver', 'Ready, waiting for the driver', 'Di rak siap ambil', 'On the ready shelf', st.ready) +
        row('info', 'Masih dikerjakan', 'Still in progress', 'Sedang diambil atau dikemas', 'Being picked or packed', st.in_progress) +
        row('stop', 'Batal: pelanggan atau Grab', 'Cancelled: customer or Grab', 'Unit sudah kembali ke rak', 'Units back on the rack', st.cancelled_customer) +
        row('stop', 'Batal: barang tidak ada', 'Cancelled: item missing', 'Lihat tab Masalah hari ini', 'See Today\'s problems', st.cancelled_missing) +
        row('', 'Pesanan tes', 'Test orders', 'Tidak dihitung di mana pun', 'Not counted anywhere', st.test) + '</tbody></table>' +
        '<div class="lp-kfoot"><div><b>' + n(d.units_sold) + '</b><span class="lp-sub" ' + biAttr('unit terjual', 'units sold') + '></span></div>' +
        '<div><b>' + esc(t(d.ready_10 + ' dari ' + d.orders, d.ready_10 + ' of ' + d.orders)) + '</b><span class="lp-sub">' + esc(t('siap dalam ' + d.ready_target_minutes + ' menit', 'ready within ' + d.ready_target_minutes + ' min')) + '</span></div>' +
        '<div><b>' + esc(d.avg_pick || '-') + '</b><span class="lp-sub" ' + biAttr('rata-rata ambil', 'average pick') + '></span></div>' +
        '<div><b>' + esc(d.avg_pack || '-') + '</b><span class="lp-sub" ' + biAttr('rata-rata kemas', 'average pack') + '></span></div></div>' +
        // Mode manual (V32): what was done without scanning that day, for the SPV to check.
        (d.manual && (d.manual.pick_units || d.manual.receipts)
          ? '<div class="k-note k-note--caution" style="margin-top:12px">' + icon('warn', 20) + '<span ' +
            biAttr('Tanpa pindai (mode manual): ' + d.manual.pick_units + ' unit di ' + d.manual.pick_orders + ' pesanan, ' + d.manual.receipts + ' penerimaan. SPV memeriksanya.',
              'Without scanning (manual mode): ' + d.manual.pick_units + ' units in ' + d.manual.pick_orders + ' orders, ' + d.manual.receipts + ' receipts. The SPV checks them.') + '></span></div>' : '') +
        '</div>';
      const noteCard = '<div class="k-card k-card--pad k-stack k-stack--tight"><strong style="font-size:17px" ' + biAttr('Catatan untuk besok', 'Note for tomorrow') + '></strong>' +
        '<textarea class="k-textarea" id="lp-note" rows="6">' + esc(d.note ? d.note.text : '') + '</textarea>' +
        '<div class="k-line k-line--between"><span class="lp-sub">' + esc(d.note ? (d.note.by_name || d.note.by) + ', ' + S.fmt.dt(d.note.at) : '') + '</span>' +
        btn('k-btn--primary', 'Simpan catatan', 'Save the note', 'id="lp-savenote" data-min-role="supervisor"') + '</div></div>';
      const probCard = '<div class="k-card k-card--pad"><div class="k-line k-line--between"><strong style="font-size:17px" ' + biAttr('Masalah hari ini', 'Today\'s problems') + '></strong>' +
        (d.problems.length > 3 ? '<button type="button" class="k-linkbtn" data-view="masalah" ' + biAttr('Lihat semua', 'See all') + '></button>' : '') + '</div>' + probs(d.problems.slice(0, 3)) + '</div>';
      const salesTable = d.sales.length ? '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Kode SKU', 'SKU code') + '></th><th ' + biAttr('Merek', 'Brand') + '></th><th ' + biAttr('Produk', 'Product') + '></th>' +
        '<th class="k-num">Unit</th><th class="k-num" ' + biAttr('Nilai', 'Value') + '></th></tr></thead><tbody>' +
        d.sales.map((r) => '<tr><td class="k-mono">' + esc(r.sku_code || '') + '</td><td>' + esc(r.brand || '') + '</td><td>' + esc(r.product || '') + '</td><td class="k-num k-strong">' + n(r.units) + '</td><td class="k-num">' + S.fmt.rp(r.value) + '</td></tr>').join('') +
        '<tr><td></td><td></td><td class="k-strong">Total</td><td class="k-num k-strong">' + n(d.units_sold) + '</td><td class="k-num k-strong">' + S.fmt.rp(d.sales.reduce((a, r) => a + r.value, 0)) + '</td></tr></tbody></table></div>'
        : '<div class="k-card k-empty">' + bis('Belum ada penjualan hari ini.', 'No sales today yet.', 'k-empty__title') + '</div>';
      const seg = '<div class="k-segment" role="group">' + [['pesanan', 'Pesanan hari ini', 'Today\'s orders'], ['masalah', 'Masalah hari ini', 'Today\'s problems'], ['penjualan', 'Penjualan', 'Sales']].map((v) =>
        '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (view === v[0]) + '">' + sp(v[1], v[2]) + (v[0] === 'masalah' && d.problems.length ? ' <span class="k-tab__count k-tab__count--caution">' + d.problems.length + '</span>' : '') + '</button>').join('') + '</div>';
      root.innerHTML = seg + (view === 'pesanan' ? '<div class="lp-grid">' + statusCard + '<div class="k-stack">' + probCard + noteCard + '</div></div>'
        : view === 'masalah' ? '<div class="k-card k-card--pad">' + probs(d.problems) + '</div>' + noteCard
        : salesTable);
      S.applyLang(root); S.applyLang(ctx.actions); S.lockAll(root);
      $('#lp-day', ctx.actions).addEventListener('change', (e) => { day = e.target.value; load().catch(S.fail); });
      const ss = $('#lp-site', ctx.actions);
      if (ss) ss.addEventListener('change', (e) => { siteId = +e.target.value; load().catch(S.fail); });
      $('#lp-csv', ctx.actions).addEventListener('click', () => download('/reports/end-of-day.csv' + api().qs({ site_id: siteId, day }), 'akhir-hari.csv').catch(S.fail));
      const sv = $('#lp-savenote', root);
      if (sv) sv.addEventListener('click', async () => {
        const note = $('#lp-note', root).value.trim();
        if (!note) { S.toast(['Tulis catatan dulu.', 'Write the note first.'], 'caution'); return; }
        try { await api().put('/reports/end-of-day/note', { site_id: siteId, day, note }); S.toast(['Catatan disimpan.', 'Note saved.'], 'ok'); await load(); } catch (e) { S.fail(e); }
      });
    }
    root.addEventListener('click', (e) => { const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; load().catch(S.fail); } });
    if (!siteId) { root.innerHTML = '<div class="k-note k-note--info">' + sp('Belum ada dark store.', 'No dark store yet.') + '</div>'; return; }
    await load();
  });

  /* ================= 10b and 10c: brand sales ================= */

  S.tab('penjualan', async function (ctx) {
    styles();
    S.setTitle('Penjualan merek', 'Brand sales');
    S.setSub('File Excel berbahasa Inggris untuk merek. Unduh, lalu kirim lewat email ke kontak merek.', 'An English Excel file for the brand. Download it, then email it to the brand\'s contacts.');
    if (hqOnly(ctx)) return;
    const brands = (await api().get('/catalog/brands')).brands.filter((b) => b.active);
    const st = { brand: brands[0] && brands[0].id, period: ctx.params.get('period') === 'monthly' ? 'monthly' : 'weekly', start: null, hubs: new Set() };
    const W = weeks(), M = months();
    st.start = st.period === 'weekly' ? W[1].value : M[1].value;
    ctx.body.innerHTML = '<div class="k-card k-card--pad"><div class="lp-form">' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('Merek', 'Brand') + '></span><select class="k-select" id="lp-brand">' + brands.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('') + '</select></label>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Periode', 'Period') + '></span><div class="k-segment" id="lp-per"><button type="button" data-p="weekly" ' + biAttr('Mingguan', 'Weekly') + '></button><button type="button" data-p="monthly" ' + biAttr('Bulanan', 'Monthly') + '></button></div></div>' +
      '<label class="k-field k-grow" style="min-width:240px"><span class="k-field__label" id="lp-plabel"></span><select class="k-select" id="lp-start"></select></label></div>' +
      '<div class="lp-hubs" id="lp-hubs"></div></div>' +
      '<div id="lp-note"></div><div class="k-card" id="lp-prev" style="overflow:hidden"><div class="k-loading"></div></div>' +
      '<p class="k-caption" ' + biAttr('Angka dari WMS. Pesanan tes dan pesanan batal tidak dihitung. Weeks of cover = Stock at end dibagi Avg sold per week.', 'WMS numbers. Test and cancelled orders are not counted. Weeks of cover = Stock at end / Avg sold per week.') + '></p>';
    const root = ctx.body;
    const paintForm = () => {
      $$('#lp-per button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === st.period)));
      S.bi($('#lp-plabel', root), st.period === 'weekly' ? 'Minggu' : 'Bulan', st.period === 'weekly' ? 'Week' : 'Month');
      $('#lp-start', root).innerHTML = options(st.period === 'weekly' ? W : M, st.start);
    };
    let seq = 0;
    async function load() {
      const my = ++seq;
      const qs = api().qs({ brand_id: st.brand, period: st.period, start: st.start, hub_ids: hubIds(st) });
      $('#lp-prev', root).innerHTML = '<div class="k-loading"></div>';
      const [info, pv] = await Promise.all([api().get('/reports/brand-sales/period' + qs), api().get('/reports/brand-sales/preview' + qs)]);
      if (my !== seq) return;
      const fc = info.month_end_count;
      $('#lp-note', root).innerHTML = st.period === 'monthly' ? (fc && fc.approved
        ? '<div class="k-note k-note--ok">' + icon('check', 20) + sp('Hitung akhir bulan sudah disetujui SPV. File berisi sheet Sales by SKU dan Stock and deliveries.', 'The month-end count is approved. The file has the sheets Sales by SKU and Stock and deliveries.') + '</div>'
        : '<div class="k-note k-note--caution">' + icon('clock', 20) + '<span>' + esc(t('Hitung akhir bulan belum disetujui' + (fc ? ' (' + fc.closed + ' dari ' + fc.planned + ' bin, paling lambat ' + fc.approve_by_label + ')' : '') + '. Counted dan Difference masih kosong; tunggu sebelum mengirim ke merek.',
          'The month-end count is not approved yet' + (fc ? ' (' + fc.closed + ' of ' + fc.planned + ' bins, due ' + fc.approve_by + ')' : '') + '. Counted and Difference are still empty; wait before sending it to the brand.')) + '</span></div>') : '';
      const rows = pv.rows;
      const tot = pv.totals;
      $('#lp-prev', root).innerHTML = '<div class="k-line k-line--between" style="padding:14px 18px;gap:10px;flex-wrap:wrap"><strong style="font-size:17px" ' + biAttr('Pratinjau: sheet Sales by SKU', 'Preview: sheet Sales by SKU') + '></strong>' +
        '<span class="lp-sub">' + icon('report', 15) + ' <span class="k-mono k-strong">' + esc(info.file_name) + '</span> · ' + esc(info.sheets.length + ' sheet') + '</span></div>' +
        (rows.length ? '<div class="k-tablewrap" style="box-shadow:none;border-radius:0"><table class="k-table lp-xl"><thead><tr><th>Dark store</th><th>SKU code</th><th>Barcode</th><th>Product</th><th>Size</th><th class="k-num">Menu price</th>' +
          '<th class="k-num">Units sold</th><th class="k-num">Sales value</th><th class="k-num">Stock at end</th><th class="k-num">Avg sold per week</th><th class="k-num">Weeks of cover</th><th>Notes</th></tr></thead><tbody>' +
          rows.map((r) => '<tr><td class="k-strong">' + esc(r.hub) + '</td><td class="k-mono">' + esc(r.sku_code || '') + '</td><td class="k-mono">' + esc(r.barcode || 'none yet') + '</td><td>' + esc(r.product || '') + '</td><td>' + esc(r.size || '') + '</td>' +
            '<td class="k-num">' + n(r.menu_price) + '</td><td class="k-num k-strong">' + n(r.units_sold) + '</td><td class="k-num">' + n(r.sales_value) + '</td><td class="k-num">' + n(r.stock_end) + '</td>' +
            '<td class="k-num">' + n(r.avg_per_week) + '</td><td class="k-num" style="' + (r.weeks_cover != null && r.weeks_cover < 1 ? 'color:var(--caution);font-weight:800' : '') + '">' + (r.weeks_cover == null ? '-' : esc(String(r.weeks_cover))) + '</td>' +
            '<td class="lp-sub">' + esc(r.notes || '') + '</td></tr>').join('') +
          '<tr><td></td><td class="k-strong">Total</td><td></td><td></td><td></td><td></td><td class="k-num k-strong">' + n(tot.units_sold) + '</td><td class="k-num k-strong">' + n(tot.sales_value) + '</td><td class="k-num k-strong">' + n(tot.stock_end) + '</td><td></td><td></td><td></td></tr></tbody></table></div>' +
          (pv.total_rows > rows.length ? '<p class="k-caption" style="padding:8px 18px">' + esc(t('Menampilkan ' + rows.length + ' dari ' + pv.total_rows + ' baris. File berisi semuanya.', 'Showing ' + rows.length + ' of ' + pv.total_rows + ' rows. The file has them all.')) + '</p>' : '')
          : '<div class="k-empty">' + bis('Tidak ada data untuk pilihan ini.', 'No data for this choice.', 'k-empty__title') + '</div>');
      S.applyLang(root);
    }
    const reload = () => load().catch(S.fail);
    $('#lp-brand', root).addEventListener('change', (e) => { st.brand = +e.target.value; reload(); });
    $('#lp-per', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || b.dataset.p === st.period) return;
      st.period = b.dataset.p; st.start = (st.period === 'weekly' ? W : M)[1].value; paintForm(); reload();
    });
    $('#lp-start', root).addEventListener('change', (e) => { st.start = e.target.value; reload(); });
    hubPicker($('#lp-hubs', root), st, reload, btn('k-btn--primary', 'Unduh Excel', 'Download Excel', 'id="lp-dl" data-min-role="hq"', 'download'));
    $('#lp-dl', root).addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await download('/reports/brand-sales.xlsx' + api().qs({ brand_id: st.brand, period: st.period, start: st.start, hub_ids: hubIds(st) }), 'brand-sales.xlsx'); }
      catch (err) { S.fail(err); } finally { b.disabled = false; }
    });
    paintForm();
    if (!st.brand) { $('#lp-prev', root).innerHTML = '<div class="k-empty">' + bis('Belum ada merek.', 'No brand yet.', 'k-empty__title') + '</div>'; return; }
    await load();
  });

  /* ================= 10d: operational report ================= */

  S.tab('operasional', async function (ctx) {
    styles();
    S.setTitle('Laporan operasional', 'Operational report');
    S.setSub('Untuk Grab dan manajemen. Mingguan atau bulanan, semua dark store atau per dark store. Unduh, lalu kirim lewat email.', 'For Grab and management. Weekly or monthly, all dark stores or per dark store. Download it, then email it.');
    if (hqOnly(ctx)) return;
    const W = weeks(), M = months();
    const st = { period: 'weekly', start: W[1].value, hubs: new Set() };
    ctx.body.innerHTML = '<div class="k-card k-card--pad"><div class="lp-form">' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Periode', 'Period') + '></span><div class="k-segment" id="lp-per"><button type="button" data-p="weekly" ' + biAttr('Mingguan', 'Weekly') + '></button><button type="button" data-p="monthly" ' + biAttr('Bulanan', 'Monthly') + '></button></div></div>' +
      '<label class="k-field k-grow" style="min-width:240px"><span class="k-field__label" id="lp-plabel"></span><select class="k-select" id="lp-start"></select></label>' +
      btn('k-btn--primary', 'Unduh', 'Download', 'id="lp-dl" data-min-role="hq"', 'download') + '</div><div class="lp-hubs" id="lp-hubs"></div></div>' +
      '<div id="lp-kpis"><div class="k-loading"></div></div><p class="k-caption" id="lp-cap"></p>';
    const root = ctx.body;
    const paintForm = () => {
      $$('#lp-per button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === st.period)));
      S.bi($('#lp-plabel', root), st.period === 'weekly' ? 'Minggu' : 'Bulan', st.period === 'weekly' ? 'Week' : 'Month');
      $('#lp-start', root).innerHTML = options(st.period === 'weekly' ? W : M, st.start);
    };
    let seq = 0;
    async function load() {
      const my = ++seq;
      const d = await api().get('/reports/operational' + api().qs({ period: st.period, start: st.start, hub_ids: hubIds(st) }));
      if (my !== seq) return;
      const c = d.current, p = d.previous;
      const prevWord = st.period === 'weekly' ? ['Minggu lalu ', 'Last week '] : ['Bulan lalu ', 'Last month '];
      const pct = (v) => (v == null ? '-' : Math.round(v * 100) + '%');
      const mmss = (s) => (s == null ? '-' : S.fmt.dur(s));
      const card = (lid, len, num, prev, fid, fen) => '<div class="lp-kpi"><span class="k-strong" ' + biAttr(lid, len) + '></span><span class="lp-kpi__num">' + num + '</span>' +
        '<span class="lp-sub">' + esc(t(prevWord[0], prevWord[1])) + '<span class="k-mono k-strong">' + esc(prev) + '</span></span><span class="lp-kpi__foot" ' + biAttr(fid, fen) + '></span></div>';
      $('#lp-cmp', root).textContent = t('Dibandingkan dengan ', 'Compared with ') + t(d.previous_label_id, d.previous_label);
      const cover = '<div class="lp-kpi"><span class="k-strong" ' + biAttr('Minggu stok tersisa', 'Weeks of stock left') + '></span><table class="lp-cover"><thead><tr><th ' + biAttr('Merek', 'Brand') + '></th><th class="k-num" ' + biAttr('Ini', 'Now') + '></th><th class="k-num" ' + biAttr('Lalu', 'Before') + '></th></tr></thead><tbody>' +
        (d.cover.length ? d.cover.map((x) => '<tr><td>' + esc(x.brand + ' · ' + x.hub) + '</td><td class="k-num k-strong">' + (x.weeks_cover == null ? '-' : esc(String(x.weeks_cover).replace('.', ','))) + '</td>' +
          '<td class="k-num">' + (x.weeks_cover_prev == null ? '-' : esc(String(x.weeks_cover_prev).replace('.', ','))) + '</td></tr>').join('') : '<tr><td colspan="3" class="lp-sub">-</td></tr>') + '</tbody></table></div>';
      $('#lp-kpis', root).innerHTML = '<div class="lp-cards">' +
        card('Pesanan', 'Orders', n(c.orders), n(p.orders), 'Tanpa pesanan tes · ' + n(c.units) + ' unit', 'Without test orders · ' + n(c.units) + ' units') +
        card('Siap dalam 10 menit', 'Ready within 10 minutes', pct(c.ready_share), pct(p.ready_share), 'Dari jam pesan Grab ke Selesai dikemas', 'From Grab\'s order time to Packed') +
        card('Rata-rata waktu ambil', 'Average pick time', mmss(c.avg_pick_s), mmss(p.avg_pick_s), 'Menit:detik per pesanan', 'Min:sec per order') +
        card('Rata-rata waktu kemas', 'Average pack time', mmss(c.avg_pack_s), mmss(p.avg_pack_s), 'Menit:detik per pesanan', 'Min:sec per order') +
        card('Batal: barang tidak ada', 'Cancelled: item missing', n(c.oos_cancels) + '<small>' + (c.oos_share == null ? '' : esc(S.fmt.pct(c.oos_share * 100))) + '</small>', n(p.oos_cancels) + (p.oos_share == null ? '' : ' · ' + S.fmt.pct(p.oos_share * 100)), 'Jumlah dan bagian dari pesanan', 'Count and share of orders') +
        card('Akurasi stok dari hitung', 'Stock accuracy from counts', pct(c.accuracy), pct(p.accuracy), 'Bin yang cocok saat dihitung', 'Bins matching when counted') +
        card('Kiriman merek tepat waktu', 'Brand deliveries on time', n(c.deliveries_on_time) + '<small>' + esc(t('dari ' + c.deliveries, 'of ' + c.deliveries)) + '</small>', t(p.deliveries_on_time + ' dari ' + p.deliveries, p.deliveries_on_time + ' of ' + p.deliveries), 'Barang masuk pada tanggal PO', 'Received on the PO date') +
        cover + '</div>';
      S.bi($('#lp-cap', root), (d.hubs.length > 1 ? d.hubs.join(' dan ') + ' digabung. ' : '') + 'Angka dari WMS, bukan dari Hiryu. Pesanan tes dan pesanan batal tidak masuk penjualan. Minggu stok tersisa = stok di rak dibagi rata-rata terjual per minggu.',
        (d.hubs.length > 1 ? d.hubs.join(' and ') + ' combined. ' : '') + 'WMS numbers, not Hiryu\'s. Test and cancelled orders are not in sales. Weeks of stock left = stock on the shelf / average sold per week.');
      S.applyLang(root);
    }
    const reload = () => load().catch(S.fail);
    $('#lp-per', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (!b || b.dataset.p === st.period) return;
      st.period = b.dataset.p; st.start = (st.period === 'weekly' ? W : M)[1].value; paintForm(); reload();
    });
    $('#lp-start', root).addEventListener('change', (e) => { st.start = e.target.value; reload(); });
    hubPicker($('#lp-hubs', root), st, reload);
    $('#lp-dl', root).addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await download('/reports/operational.xlsx' + api().qs({ period: st.period, start: st.start, hub_ids: hubIds(st) }), 'operational-report.xlsx'); }
      catch (err) { S.fail(err); } finally { b.disabled = false; }
    });
    paintForm();
    await load();
  });

  /* ================= 10e: monthly variance and claims ================= */

  S.tab('selisih', async function (ctx) {
    styles();
    S.setTitle('Laporan selisih bulanan', 'Monthly variance report');
    S.setSub('Untuk klaim, yang diproses di luar WMS. Hanya selisih yang sudah final: disetujui SPV, lalu ditinjau Ops HQ.', 'For claims, settled outside the WMS. Only final differences: approved by the SPV, then reviewed by Ops HQ.');
    if (hqOnly(ctx)) return;
    const M = months();
    const st = { start: M[1].value, hubs: new Set() };
    ctx.body.innerHTML = '<div class="k-card k-card--pad"><div class="lp-form">' +
      '<label class="k-field k-grow" style="min-width:240px"><span class="k-field__label" ' + biAttr('Bulan', 'Month') + '></span><select class="k-select" id="lp-start">' + options(M, st.start) + '</select></label>' +
      btn('k-btn--secondary', 'Finalkan', 'Finalise', 'id="lp-fin" data-min-role="hq"', 'check') +
      btn('k-btn--primary', 'Unduh Excel', 'Download Excel', 'id="lp-dl" data-min-role="hq"', 'download') + '</div><div class="lp-hubs" id="lp-hubs"></div></div>' +
      '<div id="lp-v"><div class="k-loading"></div></div>';
    const root = ctx.body;
    let seq = 0;
    async function load() {
      const my = ++seq;
      const d = await api().get('/reports/variance' + api().qs({ month: st.start.slice(0, 7), hub_ids: hubIds(st) }));
      if (my !== seq) return;
      const s = d.summary;
      const head = '<tr><th rowspan="2" ' + biAttr('Kategori', 'Category') + '></th><th rowspan="2" ' + biAttr('Beban', 'Borne by') + '></th>' +
        s.pairs.map((p) => '<th colspan="2" style="text-align:center">' + esc(p.hub + ' · ' + p.brand) + '</th>').join('') + '<th colspan="2" style="text-align:center" ' + biAttr('Semua dark store', 'All dark stores') + '></th><th rowspan="2">Status</th></tr>' +
        '<tr>' + s.pairs.concat([null]).map(() => '<th class="k-num">Unit</th><th class="k-num" ' + biAttr('Nilai', 'Value') + '></th>').join('') + '</tr>';
      const body = s.rows.map((r) => '<tr><td class="k-strong">' + esc(r.name) + '</td><td>' + esc(r.bearer === 'Brand' ? t('Merek', 'Brand') : 'Ninja') + '</td>' +
        r.cells.map((c) => '<td class="k-num">' + n(c.units) + '</td><td class="k-num">' + n(c.value) + '</td>').join('') +
        '<td class="k-num k-strong">' + n(r.units) + '</td><td class="k-num k-strong">' + n(r.value) + '</td><td>' + S.pill('ok', 'Final', 'Final') + '</td></tr>').join('') +
        '<tr><td class="k-strong">Total</td><td></td>' + s.pairs.map((p, i) => '<td class="k-num k-strong">' + n(s.rows.reduce((a, r) => a + r.cells[i].units, 0)) + '</td><td class="k-num k-strong">' + n(s.rows.reduce((a, r) => a + r.cells[i].value, 0)) + '</td>').join('') +
        '<td class="k-num k-strong">' + n(s.total_units) + '</td><td class="k-num k-strong">' + n(s.total_value) + '</td><td></td></tr>';
      const fin = d.finalised;
      $('#lp-v', root).innerHTML = '<div class="k-note ' + (fin ? 'k-note--ok' : 'k-note--caution') + '">' + icon(fin ? 'check' : 'clock', 20) + '<span>' +
        esc(fin ? t('Difinalkan Ops HQ ' + fin.label + ' (' + (fin.by_name || fin.by) + ').', 'Finalised by Ops HQ on ' + fin.label + ' (' + (fin.by_name || fin.by) + ').') : t('Belum difinalkan Ops HQ.', 'Not finalised by Ops HQ yet.')) + ' ' +
        esc(d.count_approved_label ? t('Hitung akhir bulan disetujui SPV ' + d.count_approved_label + '.', 'Month-end count approved by the SPV ' + d.count_approved_label + '.') : t('Hitung akhir bulan belum disetujui.', 'The month-end count is not approved yet.')) + '</span></div>' +
        '<div class="k-card" style="overflow:hidden"><div class="k-line k-line--between" style="padding:14px 18px;flex-wrap:wrap;gap:8px"><strong style="font-size:17px">' + esc(t('Ringkasan · ', 'Summary · ') + t(M.find((m) => m.value === st.start).id.replace(/^.*: /, ''), M.find((m) => m.value === st.start).en.replace(/^.*: /, ''))) + '</strong>' +
        '<span class="lp-sub">' + icon('report', 15) + ' <span class="k-mono k-strong">' + esc(d.file_name) + '</span> · ' + esc(t('Ringkasan + 4 sheet rincian · ' + d.rows.length + ' baris', 'Summary + 4 detail sheets · ' + d.rows.length + ' rows')) + '</span></div>' +
        '<div class="k-tablewrap" style="box-shadow:none;border-radius:0"><table class="k-table lp-xl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></div>' +
        '<div class="k-card" style="overflow:hidden"><div style="padding:14px 18px"><strong ' + biAttr('Menurut siapa yang menanggung', 'By who bears the cost') + '></strong></div><table class="k-table lp-xl"><thead><tr><th ' + biAttr('Beban', 'Borne by') + '></th><th class="k-num">Unit</th><th class="k-num" ' + biAttr('Nilai', 'Value') + '></th><th ' + biAttr('Mencakup', 'Covers') + '></th></tr></thead><tbody>' +
        s.by_bearer.map((b) => '<tr><td class="k-strong">' + esc(b.bearer === 'Brand' ? t('Merek', 'Brand') : 'Ninja') + '</td><td class="k-num">' + n(b.units) + '</td><td class="k-num">' + n(b.value) + '</td><td class="lp-sub">' +
          esc(b.bearer === 'Brand' ? t('Kurang dan lebih saat barang masuk, ditolak saat barang masuk, retur ke merek', b.covers) : t('Selisih hitung dan kerusakan setelah barang ditaruh, selama di dark store', b.covers)) + '</td></tr>').join('') +
        '<tr><td class="k-strong">Total</td><td class="k-num k-strong">' + n(s.total_units) + '</td><td class="k-num k-strong">' + n(s.total_value) + '</td><td></td></tr></tbody></table></div>' +
        '<p class="k-caption" ' + biAttr('Nilai = unit × harga menu. Klaim diselesaikan di luar WMS. Kerusakan yang dilaporkan pelanggan setelah serah terima adalah klaim Grab dan tidak ada di file ini.',
          'Value = units × menu price. Claims are settled outside the WMS. Damage a customer reports after handover is a Grab claim and is not in this file.') + '></p>';
      S.applyLang(root);
    }
    const reload = () => load().catch(S.fail);
    $('#lp-start', root).addEventListener('change', (e) => { st.start = e.target.value; reload(); });
    hubPicker($('#lp-hubs', root), st, reload);
    $('#lp-dl', root).addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await download('/reports/variance.xlsx' + api().qs({ month: st.start.slice(0, 7), hub_ids: hubIds(st) }), 'variance.xlsx'); }
      catch (err) { S.fail(err); } finally { b.disabled = false; }
    });
    $('#lp-fin', root).addEventListener('click', async () => {
      const ok = await S.confirm({ title: ['Finalkan laporan selisih?', 'Finalise the variance report?'], text: ['Nama dan tanggal Anda tercetak di file sebagai Finalised by Ops HQ.', 'Your name and the date are printed in the file as Finalised by Ops HQ.'], ok: ['Finalkan', 'Finalise'] });
      if (!ok) return;
      try { await api().post('/reports/variance/finalise', { month: st.start.slice(0, 7) }); S.toast(['Difinalkan.', 'Finalised.'], 'ok'); reload(); } catch (e) { S.fail(e); }
    });
    await load();
  });
})();
