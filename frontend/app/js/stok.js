/* stok.js: Stok, stock per SKU per hub with its age.
 *
 *   GET /api/stock?site_id=&q=&brand_id=&flag=all|old|low|out|quarantine|no_bin&sort=name|age|qty
 *
 * Age counts from the inbound date of the oldest batch still held (pseudo
 * aging, decided 5 Oct). "Stok lama" is a batch older than the rule
 * stock_old_days on Aturan & waktu. The hub picker offers "Semua hub".
 * Read only, every role. Ops HQ also has "Kirim ulang semua angka stok ke
 * Hiryu" at the title (POST /api/hiryu-link/snapshot?site_id=).
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  const FLAGS = [
    ['all', 'Semua', 'All'], ['old', 'Stok lama', 'Old stock'], ['low', 'Hampir habis', 'Running low'],
    ['out', 'Habis', 'Out'], ['quarantine', 'Di karantina', 'In quarantine'], ['no_bin', 'Tanpa bin', 'No bin'],
  ];
  const SORTS = [['name', 'Nama', 'Name'], ['age', 'Paling lama', 'Oldest first'], ['qty', 'Paling sedikit', 'Fewest first']];

  if (!document.getElementById('sk-css')) {
    const st = document.createElement('style');
    st.id = 'sk-css';
    st.textContent = '.sk-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.sk-bar .k-segment{flex-wrap:wrap}' +
      '.sk-name{font-weight:700;max-width:320px}.sk-sub{font-size:13px;color:var(--muted)}.sk-age{font-family:var(--mono);font-weight:700}';
    document.head.appendChild(st);
  }

  /* Kirim ulang semua angka stok ke Hiryu (Ops HQ): the full stock snapshot,
     every SKU of every store with its link on, at the chosen dark store or at
     all of them. The WMS also does it every night at 03:00 WIB. */
  function hiryuResend(ctx) {
    if (!ctx.actions) return;
    ctx.actions.innerHTML = '<button type="button" class="k-btn k-btn--secondary" id="sk-hiryu" data-min-role="hq">' + icon('upload', 18) +
      bis('Kirim ulang semua angka stok ke Hiryu', 'Send every stock number to Hiryu again') + '</button>';
    ctx.actions.querySelector('#sk-hiryu').addEventListener('click', async () => {
      const site = S.site();
      const where = S.siteId() && site ? [S.shortCode(site.code) + ' saja', S.shortCode(site.code) + ' only'] : ['semua dark store', 'every dark store'];
      const ok = await S.confirm({
        title: ['Kirim ulang semua angka stok ke Hiryu?', 'Send every stock number to Hiryu again?'],
        text: ['Hiryu menerima lagi angka yang bisa dijual untuk setiap produk, dihitung sekarang, untuk ' + where[0] + '. Pakai ini setelah koreksi stok yang besar (misalnya hasil hitung stok), atau bila Hiryu bilang angkanya terlihat salah. Tidak perlu setiap hari: WMS sudah mengirim semua angka tiap malam pukul 03:00 WIB.',
          'Hiryu gets the number it can sell for every product again, worked out now, for ' + where[1] + '. Use it after a big stock correction (for example a count), or when Hiryu says its numbers look wrong. Not needed every day: the WMS already sends every number each night at 03:00 WIB.'],
        ok: ['Ya, kirim ulang', 'Yes, send again'],
      });
      if (!ok) return;
      try { const r = await api().post('/hiryu-link/snapshot' + api().qs({ site_id: S.siteId() })); S.toast(r.message, 'ok'); }
      catch (e) { S.fail(e); }
    });
  }

  S.page(async function (ctx) {
    const st = { flag: ctx.params.get('flag') || 'all', sort: 'name', q: '', brand: '', data: null };
    if (!FLAGS.some((f) => f[0] === st.flag)) st.flag = 'all';
    let brands = [];
    try { brands = (await api().get('/catalog/brands')).brands; } catch (e) { /* no brand filter */ }
    ctx.body.innerHTML = '<div class="k-kpis" id="sk-kpis"></div>' +
      '<div class="sk-bar"><div class="k-segment" id="sk-flags" role="group"></div></div>' +
      '<div class="sk-bar"><label class="k-search k-grow">' + icon('search', 18) + '<input class="k-input" id="sk-q" type="search" data-ph-id="Cari nama, kode Hiryu atau barcode" data-ph-en="Search name, Hiryu code or barcode" placeholder="Cari nama, kode Hiryu atau barcode"></label>' +
      '<select class="k-select" id="sk-brand" style="max-width:200px"><option value="">' + esc(t('Semua merek', 'All brands')) + '</option>' + brands.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('') + '</select>' +
      '<select class="k-select" id="sk-sort" style="max-width:200px">' + SORTS.map((s) => '<option value="' + s[0] + '">' + esc(t(s[1], s[2])) + '</option>').join('') + '</select></div>' +
      '<div id="sk-rows"><div class="k-loading" ' + biAttr('Memuat stok…', 'Loading stock…') + '></div></div>';
    const $ = (s) => ctx.body.querySelector(s);
    hiryuResend(ctx);

    function paintFlags() {
      const c = st.data ? st.data.counts : {};
      const n = { all: c.rows, old: c.old, low: c.low, out: c.out, quarantine: c.quarantine, no_bin: c.no_bin };
      $('#sk-flags').innerHTML = FLAGS.map((f) => '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (st.flag === f[0]) + '"><span ' + biAttr(f[1], f[2]) + '>' + esc(t(f[1], f[2])) + '</span>' +
        (n[f[0]] != null ? ' (' + n[f[0]] + ')' : '') + '</button>').join('');
    }
    function paintKpis() {
      const c = st.data.counts;
      const k = (id, en, v, kind, foot) => '<div class="k-kpi' + (kind ? ' k-kpi--' + kind : '') + '">' + bis(id, en, 'k-kpi__label') + '<span class="k-kpi__num">' + S.fmt.n(v) + '</span>' + (foot ? '<span class="k-kpi__foot">' + foot + '</span>' : '') + '</div>';
      $('#sk-kpis').innerHTML = k('Unit di dark store', 'Units held', c.units) + k('Produk', 'Products', c.rows) +
        k('Stok lama', 'Old stock', c.old, c.old ? 'caution' : null, st.data.stock_old_days ? esc(t('lebih dari ' + st.data.stock_old_days + ' hari', 'over ' + st.data.stock_old_days + ' days')) : esc(t('aturan mati', 'rule off'))) +
        k('Hampir habis', 'Running low', c.low, c.low ? 'caution' : null) + k('Habis', 'Out', c.out, c.out ? 'stop' : null);
    }
    function flagsOf(r) {
      const p = [];
      if (r.stock_old) p.push(S.pill('caution', 'Stok lama', 'Old stock'));
      if (r.out) p.push(S.pill('stop', 'Habis', 'Out'));
      else if (r.low) p.push(S.pill('caution', 'Hampir habis', 'Running low'));
      if (r.in_quarantine) p.push(S.pill('info', r.in_quarantine + ' karantina', r.in_quarantine + ' in quarantine'));
      if (r.no_bin) p.push(S.pill('', 'Tanpa bin', 'No bin'));
      return p.join(' ');
    }
    const age = (r) => r.age_days == null ? '<span class="k-muted">-</span>' : '<span class="sk-age"' + (r.stock_old ? ' style="color:var(--caution)"' : '') + '>' + r.age_days + '</span> <span class="k-muted">' + esc(t('hari', 'days')) + '</span>';
    function paintRows() {
      const rows = st.data.rows;
      const multi = st.data.sites.length > 1;
      const host = $('#sk-rows');
      if (!rows.length) {
        host.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('box', 28) + '</span>' + bis('Tidak ada produk di sini', 'No products here', 'k-empty__title') + '</div>';
        S.applyLang(host);
        return;
      }
      host.innerHTML = '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr>' +
        '<th ' + biAttr('Produk', 'Product') + '></th>' + (multi ? '<th>Dark store</th>' : '') + '<th>Bin</th>' +
        '<th class="k-num" ' + biAttr('Di rak', 'In rack') + '></th><th class="k-num" ' + biAttr('Masuk sementara', 'Inbound bins') + '></th>' +
        '<th class="k-num" ' + biAttr('Karantina', 'Quarantine') + '></th><th class="k-num" ' + biAttr('Di keranjang', 'In baskets') + '></th>' +
        '<th class="k-num" ' + biAttr('Bisa dijual', 'Sellable') + '></th><th ' + biAttr('Umur', 'Age') + '></th><th ' + biAttr('Masuk terakhir', 'Last inbound') + '></th><th></th></tr></thead><tbody>' +
        rows.map((r) => '<tr class="' + (r.out ? 'is-stop' : r.stock_old || r.low ? 'is-caution' : '') + '">' +
          '<td><div class="sk-name">' + esc(r.name) + '</div><div class="sk-sub">' + esc([r.brand_name, r.barcode].filter(Boolean).join(' · ')) + '</div></td>' +
          (multi ? '<td class="k-mono k-strong">' + esc(S.shortCode(r.site_code)) + '</td>' : '') +
          '<td class="k-mono k-nowrap">' + esc(r.bin_code || '-') + '</td>' +
          '<td class="k-num">' + S.fmt.n(r.in_rack) + '</td><td class="k-num">' + S.fmt.n(r.in_inbound) + '</td><td class="k-num">' + S.fmt.n(r.in_quarantine) + '</td>' +
          '<td class="k-num">' + S.fmt.n(r.in_baskets) + '</td><td class="k-num k-strong">' + S.fmt.n(r.sellable) + '</td>' +
          '<td class="k-nowrap">' + age(r) + '</td><td class="k-nowrap">' + (r.last_inbound_at ? esc(S.fmt.date(r.last_inbound_at)) : '<span class="k-muted">-</span>') + '</td>' +
          '<td>' + flagsOf(r) + '</td></tr>').join('') + '</tbody></table></div></div>' +
        '<div class="k-phone-only k-list">' + rows.map((r) => '<div class="k-row' + (r.out ? ' k-row--stop' : r.stock_old || r.low ? ' k-row--caution' : '') + '">' +
          '<span class="k-row__text"><span class="k-row__title">' + esc(r.name) + '</span>' +
          '<span class="k-row__sub">' + esc([multi ? S.shortCode(r.site_code) : null, r.bin_code, t('bisa dijual ', 'sellable ') + r.sellable, r.age_days != null ? r.age_days + ' ' + t('hari', 'days') : null].filter((x) => x != null && x !== '').join(' · ')) + '</span>' +
          '<span class="rb-pills" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">' + flagsOf(r) + '</span></span>' +
          '<span style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.1"><span class="k-mono k-strong" style="font-size:22px">' + S.fmt.n(r.on_hand) + '</span>' +
          '<span class="k-muted" style="font-size:12px">' + esc(t('unit total', 'units in all')) + '</span></span></div>').join('') + '</div>' +
        '<p class="k-caption" style="margin-top:8px">' + esc(S.pick(st.data.age_note)) + '</p>';
      S.applyLang(host);
    }
    async function load() {
      try {
        st.data = await api().get('/stock' + api().qs({ site_id: S.siteId(), q: st.q, brand_id: st.brand, flag: st.flag, sort: st.sort }));
      } catch (e) { S.fail(e); return; }
      paintFlags(); paintKpis(); paintRows();
      S.applyLang(ctx.body);
    }
    $('#sk-flags').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      st.flag = b.dataset.f;
      load();
    });
    let qT = null;
    $('#sk-q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { st.q = $('#sk-q').value.trim(); load(); }, 300); });
    $('#sk-brand').addEventListener('change', () => { st.brand = $('#sk-brand').value; load(); });
    $('#sk-sort').addEventListener('change', () => { st.sort = $('#sk-sort').value; load(); });
    S.onSiteChange(load);
    await load();
  });
})();
