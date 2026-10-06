/* hitung-stok.js: Hitung stok (canvas Section 8, boards 8a, 8b, 8c).
 *
 * Tabs: rencana (8a: today's plan, the monthly full count, Ops HQ's mandatory
 * cycles; on the phone also "Bin saya" and the bin label scan that starts a
 * count) and hasil (8c: Sistem, Hitung, Hitung ulang, Selisih, then step 1
 * Setujui SPV and step 2 Tinjau Ops HQ). The count itself (8b) opens full
 * screen: scan the bin label, scan every unit, Selesai hitung; blind count is
 * the option. The expected number is never shown to the person counting.
 *
 * API (backend/routers/opname.py, /api/counts):
 *   GET  /counts/plan?site_id   GET /counts/mine?site_id   GET /counts/results?site_id
 *   POST /counts/start {site_id, bin_code}            GET /counts/attempts/{id}
 *   POST /counts/attempts/{id}/scan|undo|abandon|finish {blind_qty?}
 *   POST /counts/plan/add {site_id, bin_code, note}  PUT /counts/tasks/{id}/assign {email}
 *   POST /counts/tasks/{id}/approve|recount|review   POST /counts/review {task_ids}
 *   GET|POST /counts/cycles   PUT|DELETE /counts/cycles/{id}
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
  const first = (name) => String(name || '').split(' ')[0];
  const key = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function styles() {
    if ($('#hs-style')) return;
    const st = document.createElement('style');
    st.id = 'hs-style';
    st.textContent = [
      '.hs-bin{font-family:var(--mono);font-weight:700;font-size:18px;white-space:nowrap}',
      '.hs-top{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}',
      '@media(min-width:1024px){.hs-top{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}',
      '.hs-full{background:var(--action-bg);border-radius:var(--r-card);padding:16px 18px;display:flex;flex-direction:column;gap:6px}',
      '.hs-full__eyebrow{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--action)}',
      '.hs-full__title{font-size:18px;font-weight:800}',
      '.hs-cyc{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--rule)}',
      '.hs-cyc__every{font-weight:800;color:var(--action);white-space:nowrap}',
      '.hs-why{display:inline-flex;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:700;background:var(--action-bg);color:var(--action)}',
      '.hs-why--missing_item{background:var(--caution-bg);color:var(--caution)}',
      '.hs-why--spv_added{background:#EFE7FB;color:#5B3A9A}',
      '.hs-why--monthly_full{background:var(--ok-bg);color:var(--ok)}',
      '.hs-step{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:34px}',
      '.hs-step__no{width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:2px solid var(--rule);color:var(--muted);flex-shrink:0}',
      '.hs-step__no.is-on{background:var(--navy);border-color:var(--navy);color:#fff}',
      '.hs-step__no.is-ok{background:var(--ok);border-color:var(--ok);color:#fff}',
      '.hs-sub{font-size:12px;color:var(--muted)}',
      '.hs-diff{font-family:var(--mono);font-weight:800;color:var(--stop)}',
      '.hs-ok{color:var(--ok);font-weight:700;white-space:nowrap}',
      '.hs-big{font-family:var(--mono);font-size:96px;font-weight:800;line-height:1;text-align:center}',
      '.hs-count{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px}',
      '.hs-bincard{display:flex;flex-direction:column;gap:10px}',
      '.hs-bincode{font-family:var(--mono);font-size:52px;font-weight:700;line-height:1}',
      '.hs-prod{display:flex;align-items:center;gap:12px;border-top:1px solid var(--rule);padding-top:10px}',
      '.hs-thumb{width:56px;height:56px;border-radius:12px;background:var(--sunk);display:flex;align-items:center;justify-content:center;color:var(--muted);flex-shrink:0;overflow:hidden}',
      '.hs-thumb img{width:100%;height:100%;object-fit:cover}',
      '.hs-cnt{font-family:var(--mono);font-weight:800;font-size:16px}',
      '#k-body .hs-table td{vertical-align:middle}',
      '#k-body .hs-table td.k-num .hs-sub,#k-body .hs-table td.k-num .k-strong{font-family:inherit;font-family:var(--font)}',
    ].join('\n');
    document.head.appendChild(st);
  }

  const thumb = (key) => '<span class="hs-thumb">' + (key ? '<img alt="" src="../api/photos/' + esc(key) + '">' : icon('box', 24)) + '</span>';

  function whyChip(tk) {
    const label = { cycle: ['Siklus wajib', 'Mandatory cycle'], missing_item: ['Barang tidak ada kemarin', 'Missing item yesterday'],
      spv_added: ['Ditambah SPV', 'Added by the SPV'], monthly_full: ['Hitung penuh bulanan', 'Monthly full count'] }[tk.reason] || [tk.reason_id, tk.reason_en];
    const extra = tk.reason === 'cycle' && tk.reason_note ? ': ' + tk.reason_note : '';
    const sub = tk.reason === 'cycle' || tk.reason === 'monthly_full'
      ? (tk.last_counted ? t('Terakhir dihitung ', 'Last counted ') + S.fmt.date(tk.last_counted).replace(/ \d{4}$/, '') : t('Belum pernah dihitung', 'Never counted'))
      : (tk.reason_note || '');
    return '<div class="k-stack k-stack--tight" style="gap:3px"><span class="hs-why hs-why--' + esc(tk.reason) + '">' + esc(t(label[0], label[1]) + extra) + '</span>' +
      (sub ? '<span class="hs-sub">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function statusPill(tk) {
    switch (tk.status) {
      case 'counting': return '<span class="k-pill k-pill--info">' + icon('lock', 14, 2.4) + sp('Dihitung · bin dikunci', 'Counting · bin locked') + '</span>';
      case 'recount': return '<span class="k-pill k-pill--caution">' + icon('refresh', 14, 2.4) + sp('Hitung ulang', 'Recount') + '</span>';
      case 'awaiting_spv': return '<span class="k-pill k-pill--caution">' + icon('clock', 14, 2.4) + sp('Menunggu SPV', 'Waiting for the SPV') + '</span>';
      case 'closed': return '<span class="k-pill k-pill--ok">' + icon('check', 14, 2.6) + sp('Selesai', 'Done') + '</span>';
      default: return '<span class="k-pill">' + '<span class="k-pill__dot"></span>' + sp('Belum', 'Not yet') + '</span>';
    }
  }

  /* ================= 8a: the plan ================= */

  S.tab('rencana', async function (ctx) {
    styles();
    S.setTitle('Hitung stok', 'Stock count');
    S.setSub('Rencana dibuat WMS setiap pagi: siklus wajib dari Ops HQ dan bin dengan barang tidak ada kemarin.',
      'The WMS makes the plan every morning: Ops HQ\'s mandatory cycles and bins with a missing item yesterday.');
    if (!ctx.siteId) { ctx.body.innerHTML = '<div class="k-note k-note--info">' + icon('info', 20) + sp('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>'; return; }
    ctx.body.innerHTML = '<div class="k-loading" ' + biAttr('Memuat rencana…', 'Loading the plan…') + '></div>';
    const [plan, mine] = await Promise.all([
      api().get('/counts/plan' + api().qs({ site_id: ctx.siteId })),
      api().get('/counts/mine' + api().qs({ site_id: ctx.siteId })),
    ]);
    if (mine.open_attempt_id) { openCount(ctx, mine.open_attempt_id); return; }
    S.tabCount('rencana', plan.total);
    const pending = plan.tasks.filter((x) => x.status !== 'closed').length;

    ctx.actions.innerHTML = '<span class="k-pill k-pill--ok k-pill--lg">' + esc(t(plan.done + ' dari ' + plan.total + ' selesai', plan.done + ' of ' + plan.total + ' done')) + '</span>' +
      btn('k-btn--secondary', 'Tambah bin', 'Add a bin', 'data-act="add" data-min-role="supervisor"', 'plus');

    const fc = plan.full_count;
    const fullCard = '<div class="hs-full">' +
      '<span class="hs-full__eyebrow">' + icon('clock', 18) + sp('Hitung penuh bulanan', 'Monthly full count') + '</span>' +
      '<span class="hs-full__title">' + esc(fc.date_label + ': ' + t('semua ' + fc.bins + ' bin di ' + plan.site_code, 'all ' + fc.bins + ' bins at ' + plan.site_code)) + '</span>' +
      '<span class="k-p">' + esc(t('Sebulan sekali. Hasil disetujui SPV paling lambat ' + fc.approve_by_label + ' (hari kerja ke-3), sebelum laporan bulanan merek. Ops HQ meninjau selisihnya.',
        'Once a month. The SPV approves the result by ' + fc.approve_by + ' (3rd working day), before the monthly brand report. Ops HQ reviews the differences.')) + '</span>' +
      (fc.planned ? '<span class="k-strong">' + esc(t(fc.closed + ' dari ' + fc.planned + ' bin selesai', fc.closed + ' of ' + fc.planned + ' bins done')) + '</span>' : '') +
      '</div>';
    const cycles = '<div class="k-card k-card--pad"><div class="k-line k-line--between" style="margin-bottom:6px">' +
      '<span class="k-line" style="gap:10px"><strong style="font-size:17px" ' + biAttr('Siklus hitung wajib', 'Mandatory cycle counts') + '></strong><span class="k-chip k-chip--hq">Ops HQ</span></span>' +
      btn('k-btn--secondary k-btn--sm', 'Tambah siklus', 'Add a cycle', 'data-act="cycle-add" data-min-role="hq"', 'plus') + '</div>' +
      (plan.cycles.length ? plan.cycles.map((c) => '<div class="hs-cyc"><div class="k-grow"><div class="k-strong">' + esc(c.label || '-') + '</div>' +
        '<div class="hs-sub">' + esc(c.scope === 'brand'
          ? t(c.bins + ' bin, dibagi rata: ' + (c.per_day_min === c.per_day_max ? c.per_day_max : c.per_day_min + ' atau ' + c.per_day_max) + ' bin per hari',
            c.bins + ' bins, spread evenly: ' + (c.per_day_min === c.per_day_max ? c.per_day_max : c.per_day_min + ' or ' + c.per_day_max) + ' a day')
          : (c.next_label ? t('Berikutnya: ', 'Next: ') + c.next_label : t('Belum ada bin', 'No bin yet'))) + '</div></div>' +
        '<span class="hs-cyc__every" ' + biAttr(c.every_id, c.every_en) + '></span>' +
        (S.atLeast('hq') ? '<button type="button" class="k-iconbtn" data-cycle="' + c.id + '" data-aria-id="Ubah siklus" data-aria-en="Change the cycle" aria-label="' + esc(t('Ubah siklus', 'Change the cycle')) + '">' + icon('edit', 18) + '</button>' : '') + '</div>').join('')
        : '<p class="k-caption" ' + biAttr('Belum ada siklus. Ops HQ menambahkannya.', 'No cycle yet. Ops HQ adds them.') + '></p>') +
      '</div>';

    const table = plan.tasks.length ? '<div class="k-tablewrap"><table class="k-table hs-table"><thead><tr>' +
      '<th>Bin</th><th ' + biAttr('Produk', 'Product') + '></th><th ' + biAttr('Kenapa dihitung', 'Why counted') + '></th>' +
      '<th ' + biAttr('Petugas', 'Counter') + '></th><th>Status</th></tr></thead><tbody>' +
      plan.tasks.map((x) => '<tr class="' + (x.status === 'recount' ? 'is-caution' : '') + '"><td class="hs-bin">' + esc(x.bin) + '</td>' +
        '<td style="max-width:280px">' + esc(x.sku_name || '-') + '</td><td>' + whyChip(x) + '</td>' +
        '<td>' + (x.status === 'pending' || x.status === 'recount'
          ? '<button type="button" class="k-linkbtn" data-assign="' + x.id + '" data-min-role="supervisor">' + esc(x.assigned_name ? first(x.assigned_name) : t('Atur', 'Set')) + '</button>'
          : esc(first(x.assigned_name) || '-')) + '</td><td>' + statusPill(x) + '</td></tr>').join('') +
      '</tbody></table></div>'
      : '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' + bis('Tidak ada bin untuk dihitung hari ini', 'No bin to count today', 'k-empty__title') + '</div>';

    const myRows = mine.tasks.filter((x) => x.status !== 'closed' && x.status !== 'awaiting_spv');
    const phone = '<div class="k-phone-only k-stack">' +
      '<div id="hs-startscan"></div>' +
      bis('Bin saya hari ini', 'My bins today', 'k-eyebrow') +
      (myRows.length ? '<div class="k-list">' + myRows.map((x) => '<a class="k-row' + (x.status === 'recount' ? ' k-row--caution' : '') + '" href="#" data-start="' + esc(x.bin) + '">' +
        '<span class="k-row__icon' + (x.status === 'recount' ? ' k-row__icon--caution' : '') + '">' + icon('count', 26) + '</span>' +
        '<span class="k-row__text"><span class="k-row__title"><span class="k-mono">' + esc(x.bin) + '</span> · ' + esc(x.sku_name || '') + '</span>' +
        '<span class="k-row__sub' + (x.status === 'recount' ? ' k-row__sub--caution' : '') + '">' + esc(x.status === 'recount' ? t('Hitung ulang', 'Recount') : t(x.reason_id, x.reason_en)) + '</span></span>' +
        '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div>'
        : '<p class="k-caption" ' + biAttr('Tidak ada bin untuk Anda saat ini.', 'No bin for you right now.') + '></p>') +
      (S.atLeast('supervisor') ? bis('Rencana dark store', 'Dark store plan', 'k-eyebrow') + '<div class="k-list">' + plan.tasks.map((x) => '<div class="k-row' + (x.status === 'recount' ? ' k-row--caution' : '') + '">' +
        '<span class="k-row__text"><span class="k-row__title"><span class="k-mono">' + esc(x.bin) + '</span> · ' + esc(x.sku_name || '') + '</span>' +
        '<span class="k-row__sub">' + esc(t(x.reason_id, x.reason_en)) + ' · ' + esc(first(x.assigned_name) || '-') + '</span></span>' + statusPill(x) + '</div>').join('') + '</div>' : '') +
      '</div>';

    ctx.body.innerHTML = phone +
      '<div class="k-laptop-only k-stack"><div class="hs-top">' + fullCard + cycles + '</div>' + table +
      '<p class="k-caption">' + esc(t('Siklus wajib: diatur Ops HQ per SKU atau merek; bin satu merek dibagi rata ke setiap hari dalam siklus. Ditambah SPV: lewat Tambah bin. Barang tidak ada kemarin: bin tempat staf menekan Barang tidak ada saat mengambil. Bin yang sedang dihitung tidak dipakai untuk ambil pesanan.',
        'Mandatory cycle: set by Ops HQ per SKU or brand; a brand\'s bins are spread evenly over the cycle. Added by the SPV: through Add a bin. Missing item yesterday: bins where staff pressed Item missing while picking. A bin being counted is not picked from.')) + '</p></div>';

    // Phone: scan a bin label to start counting it.
    const z = S.scan(async (code, zone) => {
      try { await start(ctx, code); } catch (e) { zone.reject(S.pick(e.message)); }
    }, { title: ['Pindai label bin untuk mulai hitung', 'Scan a bin label to start counting'], mount: $('#hs-startscan', ctx.body) });
    void z;
    $$('[data-start]', ctx.body).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); labelStep(ctx, a.dataset.start); }));
    $('[data-act="add"]', ctx.actions).addEventListener('click', () => addBin(ctx));
    $$('[data-cycle]', ctx.body).forEach((b) => b.addEventListener('click', () => cycleModal(ctx, plan.cycles.find((c) => String(c.id) === b.dataset.cycle))));
    const ca = $('[data-act="cycle-add"]', ctx.body);
    if (ca) ca.addEventListener('click', () => cycleModal(ctx, null));
    $$('[data-assign]', ctx.body).forEach((b) => b.addEventListener('click', () => assignModal(ctx, plan.tasks.find((x) => String(x.id) === b.dataset.assign))));
    ctx.every(60000, () => { if (!document.body.classList.contains('is-full') && !$('.k-scrim')) S.rerender(); });
  });

  async function start(ctx, binCode) {
    const a = await api().post('/counts/start', { site_id: ctx.siteId, bin_code: binCode });
    countScreen(ctx, a);
  }
  async function openCount(ctx, attemptId) {
    countScreen(ctx, await api().get('/counts/attempts/' + attemptId));
  }

  /* Tapping a bin from "Bin saya": the label scan confirms the person is at the bin. */
  function labelStep(ctx, bin) {
    S.fullScreen(true, { title: ['Hitung stok', 'Stock count'], onBack: () => { S.fullScreen(false); S.rerender(); } });
    ctx.body.innerHTML = '<div class="k-stack"><div class="k-target"><div class="k-target__text">' +
      '<span class="k-target__label" ' + biAttr('Ke bin', 'To bin') + '></span><span class="k-target__code">' + esc(bin) + '</span>' +
      '<span class="k-target__hint" ' + biAttr('Pindai label bin untuk mulai. Bin dikunci sampai Selesai hitung.', 'Scan the bin label to start. The bin is locked until Done counting.') + '></span></div></div><div id="hs-lbl"></div></div>';
    S.scan(async (code, zone) => {
      const c = String(code).toUpperCase();
      if (!(c === bin || c.endsWith('-' + bin))) { zone.reject(t('Label bin lain: ' + c, 'Another bin label: ' + c)); return; }
      try { await start(ctx, c); } catch (e) { zone.reject(S.pick(e.message)); }
    }, { title: ['Pindai label bin', 'Scan the bin label'], mount: $('#hs-lbl', ctx.body) });
    S.applyLang(ctx.body);
  }

  /* ================= 8b: counting a bin ================= */

  function countScreen(ctx, a) {
    styles();
    S.fullScreen(true, { title: ['Hitung stok', 'Stock count'], onBack: () => leave(ctx, a) });
    ctx.actions.innerHTML = '';
    let blind = false;
    ctx.body.innerHTML = '<div class="k-stack">' +
      '<div class="k-line k-line--between"><span class="k-strong">' + (a.position ? esc(t('Bin ' + a.position + ' dari ' + a.of + ' hari ini', 'Bin ' + a.position + ' of ' + a.of + ' today')) : '') +
      (a.is_recount ? ' ' + S.pill('caution', 'Hitung ulang', 'Recount') : '') + '</span>' + S.pill('ok', 'Label bin cocok', 'Bin label matches') + '</div>' +
      '<div class="k-card k-card--pad hs-bincard"><div class="k-line k-line--between"><span class="k-eyebrow">Bin</span>' +
      '<span class="k-line k-strong" style="gap:6px;color:var(--action)">' + icon('lock', 16) + sp('Bin dikunci', 'Bin locked') + '</span></div>' +
      '<span class="hs-bincode">' + esc(a.bin) + '</span>' +
      '<div class="hs-prod">' + thumb(a.photo_key) + '<strong style="font-size:17px">' + esc(a.sku_name || '-') + '</strong></div></div>' +
      '<div class="k-card hs-count" id="hs-scanbox"><span class="k-eyebrow" ' + biAttr('Unit dipindai', 'Units scanned') + '></span>' +
      '<span class="hs-big" id="hs-n">' + n(a.qty_counted) + '</span>' +
      '<span class="k-strong" id="hs-last" style="color:var(--ok);min-height:20px">' + (a.last_scan ? icon('check', 16, 2.6) + esc(t('Pindaian terakhir cocok · ', 'Last scan matched · ') + S.fmt.time(a.last_scan.at)) : '') + '</span>' +
      '<button type="button" class="k-linkbtn" id="hs-undo" ' + biAttr('Batalkan pindaian terakhir', 'Undo the last scan') + '></button></div>' +
      '<div class="k-card hs-count" id="hs-blindbox" hidden><span class="k-eyebrow" ' + biAttr('Jumlah dihitung (blind)', 'Counted (blind)') + '></span><div id="hs-step"></div>' +
      '<span class="k-caption" ' + biAttr('Hasil blind selalu menunggu Setujui SPV, juga jika cocok.', 'A blind result always waits for the SPV, even when it matches.') + '></span></div>' +
      '<div id="hs-zone"></div>' +
      '<button type="button" class="k-btn k-btn--secondary k-btn--block" id="hs-blind">' + icon('edit', 18) + '<span ' + biAttr('Hitung tanpa pindai (blind)', 'Count without scanning (blind)') + '></span></button>' +
      '<p class="k-caption" style="text-align:center" id="hs-blindcap">' + esc(t('Ketik jumlahnya. Hasil blind selalu menunggu Setujui SPV, juga jika cocok.', 'Type the number. A blind result always waits for the SPV, even when it matches.')) + '</p>' +
      '<button type="button" class="k-linkbtn" id="hs-abandon" style="align-self:center" ' + biAttr('Lepas bin, hitung nanti', 'Release the bin, count later') + '></button>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" id="hs-finish">' + icon('check', 22, 2.4) + '<span ' + biAttr('Selesai hitung', 'Done counting') + '></span></button></div></div>';
    const step = S.stepper($('#hs-step', ctx.body), { value: 0, min: 0, max: 9999, label: ['Jumlah', 'Quantity'] });
    const zone = S.scan(async (code, z) => {
      if (blind) { z.reject(t('Mode blind: ketik jumlahnya.', 'Blind mode: type the number.')); return; }
      try {
        const r = await api().post('/counts/attempts/' + a.attempt_id + '/scan', { code, idempotency_key: key() });
        $('#hs-n', ctx.body).textContent = n(r.qty_counted);
        const last = $('#hs-last', ctx.body);
        if (r.outcome === 'counted') {
          z.accept(t('Cocok', 'Matches'));
          last.style.color = 'var(--ok)';
          last.innerHTML = icon('check', 16, 2.6) + esc(t('Pindaian terakhir cocok · ', 'Last scan matched · ') + S.fmt.time(r.at));
        } else {
          z.reject(S.pick(r.message));
          last.style.color = 'var(--caution)';
          last.innerHTML = icon('warn', 16, 2.4) + esc(S.pick(r.message));
        }
      } catch (e) { z.reject(S.pick(e.message)); }
    }, { title: ['Pindai setiap unit di bin', 'Scan every unit in the bin'], mount: $('#hs-zone', ctx.body) });
    zone.zone.restingState = t('Termasuk yang di belakang. Jumlah di sistem tidak ditampilkan.', 'Including the ones at the back. The system number is not shown.');
    zone.rest();
    $('#hs-undo', ctx.body).addEventListener('click', async () => {
      try { const r = await api().post('/counts/attempts/' + a.attempt_id + '/undo', {}); $('#hs-n', ctx.body).textContent = n(r.qty_counted); S.toast(r.message, 'ok'); }
      catch (e) { S.fail(e); }
    });
    $('#hs-blind', ctx.body).addEventListener('click', () => {
      blind = !blind;
      $('#hs-blindbox', ctx.body).hidden = !blind;
      $('#hs-scanbox', ctx.body).hidden = blind;
      zone.el.hidden = blind;
      $('#hs-blindcap', ctx.body).hidden = blind;
      S.bi($('#hs-blind span', ctx.body), blind ? 'Kembali ke hitung pindai' : 'Hitung tanpa pindai (blind)', blind ? 'Back to counting by scan' : 'Count without scanning (blind)');
      if (blind) step.input.focus();
    });
    $('#hs-abandon', ctx.body).addEventListener('click', () => leave(ctx, a));
    $('#hs-finish', ctx.body).addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      const body = blind ? { blind_qty: step.get() } : {};
      const ok = await S.confirm({
        title: ['Selesai hitung?', 'Done counting?'],
        text: blind ? ['Jumlah yang Anda ketik: ' + step.get() + '. Hasil menunggu Setujui SPV.', 'The number you typed: ' + step.get() + '. The result waits for the SPV.']
          : ['Unit dipindai: ' + $('#hs-n', ctx.body).textContent + '. Sudah termasuk yang di belakang?', 'Units scanned: ' + $('#hs-n', ctx.body).textContent + '. Including the ones at the back?'],
        ok: ['Selesai hitung', 'Done counting'],
      });
      if (!ok) return;
      b.disabled = true;
      try {
        const r = await api().post('/counts/attempts/' + a.attempt_id + '/finish', body);
        S.toast(r.message, r.state === 'closed' ? 'ok' : 'info');
        S.fullScreen(false);
        S.rerender();
      } catch (e) { S.fail(e); b.disabled = false; }
    });
    S.applyLang(ctx.body);
  }

  async function leave(ctx, a) {
    const ok = await S.confirm({ title: ['Lepas bin ini?', 'Release this bin?'], text: ['Hitungan ini dibuang dan bin bisa dipakai ambil lagi. Bin tetap di rencana.', 'This count is dropped and the bin can be picked from again. It stays in the plan.'], ok: ['Lepas bin', 'Release'] });
    if (!ok) return;
    try { await api().post('/counts/attempts/' + a.attempt_id + '/abandon', {}); } catch (e) { S.fail(e); }
    S.fullScreen(false);
    S.rerender();
  }

  /* ================= SPV and Ops HQ dialogs ================= */

  function addBin(ctx) {
    S.modal({
      title: ['Tambah bin ke rencana hari ini', 'Add a bin to today\'s plan'],
      body: '<div class="k-stack"><label class="k-field"><span class="k-field__label">Bin</span><input class="k-input k-mono" id="hs-addbin" placeholder="A-1-02" autocapitalize="characters"></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Kenapa (singkat)', 'Why (short)') + '></span><input class="k-input" id="hs-addnote" data-ph-id="ada unit rusak" data-ph-en="a damaged unit" placeholder="ada unit rusak"></label>' +
        '<p class="k-caption" ' + biAttr('Bin muncul sebagai Ditambah SPV dengan nama dan jam Anda.', 'The bin shows as Added by the SPV with your name and time.') + '></p></div>',
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Tambah bin', 'Add the bin'], kind: 'primary', minRole: 'supervisor',
        onClick: async () => {
          const code = $('#hs-addbin').value.trim();
          if (!code) { S.toast(['Isi kode bin.', 'Enter the bin code.'], 'caution'); return false; }
          const r = await api().post('/counts/plan/add', { site_id: ctx.siteId, bin_code: code, note: $('#hs-addnote').value.trim() || null });
          S.toast(r.message, 'ok');
          S.rerender();
        },
      }],
    });
  }

  async function assignModal(ctx, task) {
    let people = [];
    try { people = (await api().get('/admin/users' + api().qs({ site_id: ctx.siteId }))).users.filter((u) => u.active && (u.role === 'staff' || u.role === 'hub_operator')); }
    catch (e) { S.fail(e); return; }
    const done = (task.attempts || []).map((x) => x.counted_by);
    S.modal({
      title: ['Atur petugas: ' + task.bin, 'Set the counter: ' + task.bin],
      body: '<div class="k-stack"><select class="k-select" id="hs-who">' + people.map((u) => '<option value="' + esc(u.email) + '"' + (u.email === task.assigned_to ? ' selected' : '') + (done.includes(u.email) && task.status === 'recount' ? ' disabled' : '') + '>' +
        esc((u.name || u.email) + (done.includes(u.email) ? t(' (sudah menghitung)', ' (already counted)') : '')) + '</option>').join('') + '</select>' +
        (task.status === 'recount' ? '<p class="k-caption" ' + biAttr('Hitung ulang selalu oleh orang lain.', 'A recount is always done by another person.') + '></p>' : '') + '</div>',
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'supervisor',
        onClick: async () => { await api().put('/counts/tasks/' + task.id + '/assign', { email: $('#hs-who').value }); S.rerender(); },
      }],
    });
  }

  async function cycleModal(ctx, c) {
    let brands = [];
    try { brands = (await api().get('/catalog/brands')).brands.filter((b) => b.active); } catch (e) { /* none */ }
    let scope = c ? c.scope : 'sku', skuId = c ? c.sku_id : null;
    const m = S.modal({
      title: c ? ['Ubah siklus', 'Change the cycle'] : ['Tambah siklus hitung wajib', 'Add a mandatory cycle count'],
      body: '<div class="k-stack">' +
        '<div class="k-segment" id="hs-scope"><button type="button" data-s="sku" aria-pressed="' + (scope === 'sku') + '" ' + biAttr('Satu SKU', 'One SKU') + '></button>' +
        '<button type="button" data-s="brand" aria-pressed="' + (scope === 'brand') + '" ' + biAttr('Semua SKU merek', 'All SKUs of a brand') + '></button></div>' +
        '<div id="hs-skubox" class="k-stack k-stack--tight"><label class="k-field"><span class="k-field__label">SKU</span>' +
        '<input class="k-input" id="hs-skuq" data-ph-id="Cari nama atau kode SKU" data-ph-en="Search name or SKU code" value="' + esc(c && c.scope === 'sku' ? c.label : '') + '"></label><div id="hs-skures" class="k-stack k-stack--tight"></div></div>' +
        '<label class="k-field" id="hs-brandbox"><span class="k-field__label" ' + biAttr('Merek', 'Brand') + '></span><select class="k-select" id="hs-brand">' +
        brands.map((b) => '<option value="' + b.id + '"' + (c && c.brand_id === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>' +
        '<div class="k-line" style="gap:10px"><span class="k-strong" ' + biAttr('Setiap', 'Every') + '></span><input class="k-input k-input--num" id="hs-n" type="number" min="1" max="365" style="width:90px" value="' + (c ? c.every_n : 7) + '">' +
        '<select class="k-select" id="hs-unit" style="width:140px"><option value="day"' + (c && c.every_unit === 'week' ? '' : ' selected') + '>' + esc(t('hari', 'days')) + '</option><option value="week"' + (c && c.every_unit === 'week' ? ' selected' : '') + '>' + esc(t('minggu', 'weeks')) + '</option></select></div>' +
        '<p class="k-caption" ' + biAttr('Bin satu merek dibagi rata ke setiap hari dalam siklus. Binnya masuk rencana harian sendiri.', 'A brand\'s bins are spread evenly over the cycle. They join the daily plan by themselves.') + '></p></div>',
      actions: [].concat(c ? [{ label: ['Hentikan siklus', 'Stop the cycle'], kind: 'ghost', minRole: 'hq', onClick: async () => { await api().del('/counts/cycles/' + c.id); S.rerender(); } }] : [],
        [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
          label: ['Simpan siklus', 'Save the cycle'], kind: 'primary', minRole: 'hq',
          onClick: async () => {
            const body = { scope, sku_id: scope === 'sku' ? skuId : null, brand_id: scope === 'brand' ? +$('#hs-brand').value : null,
              every_n: +$('#hs-n').value, every_unit: $('#hs-unit').value, active: true };
            if (scope === 'sku' && !skuId) { S.toast(['Pilih SKU dari daftar.', 'Choose a SKU from the list.'], 'caution'); return false; }
            if (c) await api().put('/counts/cycles/' + c.id, body); else await api().post('/counts/cycles', body);
            S.toast(['Siklus disimpan.', 'Cycle saved.'], 'ok');
            S.rerender();
          },
        }]),
    });
    const root = m.body;
    const paint = () => {
      $$('#hs-scope button', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === scope)));
      $('#hs-skubox', root).hidden = scope !== 'sku';
      $('#hs-brandbox', root).hidden = scope !== 'brand';
    };
    $$('#hs-scope button', root).forEach((b) => b.addEventListener('click', () => { scope = b.dataset.s; paint(); }));
    let tmr = null;
    $('#hs-skuq', root).addEventListener('input', () => {
      clearTimeout(tmr);
      skuId = null;
      tmr = setTimeout(async () => {
        const q = $('#hs-skuq', root).value.trim();
        if (q.length < 2) { $('#hs-skures', root).innerHTML = ''; return; }
        try {
          const r = await api().get('/skus' + api().qs({ q, limit: 8 }));
          $('#hs-skures', root).innerHTML = r.skus.map((s) => '<button type="button" class="k-btn k-btn--ghost k-btn--sm" style="justify-content:flex-start" data-sku="' + s.id + '">' + esc(s.name_display) + '</button>').join('');
          $$('[data-sku]', root).forEach((b) => b.addEventListener('click', () => { skuId = +b.dataset.sku; $('#hs-skuq', root).value = b.textContent; $('#hs-skures', root).innerHTML = ''; }));
        } catch (e) { S.fail(e); }
      }, 250);
    });
    paint();
  }

  /* ================= 8c: results ================= */

  function stepOne(x) {
    if (x.outcome === 'auto_closed') return '<div class="hs-step"><span class="hs-step__no is-ok">' + icon('check', 13, 3) + '</span><span class="hs-ok">' + sp('Selesai sendiri', 'Closed by itself') + '</span><span class="hs-sub">' + sp('hitung pindai, cocok', 'count by scan, matches') + '</span></div>';
    if (x.outcome === 'approved') return '<div class="hs-step"><span class="hs-step__no is-ok">' + icon('check', 13, 3) + '</span><span class="hs-ok">' + sp('Disetujui SPV', 'Approved by the SPV') + '</span>' +
      '<span class="hs-sub">' + esc(first(x.approved_name) + ' ' + S.fmt.time(x.approved_at) + t(' · stok dan Hiryu: ', ' · stock and Hiryu: ') + n(x.qty_final)) + '</span></div>';
    if (x.status === 'awaiting_spv') return '<div class="hs-step"><span class="hs-step__no is-on">1</span>' +
      btn('k-btn--primary k-btn--sm', 'Setujui SPV', 'Approve', 'data-approve="' + x.id + '" data-min-role="supervisor"', 'check') +
      btn('k-btn--secondary k-btn--sm', 'Hitung ulang', 'Recount', 'data-recount="' + x.id + '" data-min-role="supervisor"') + '</div>';
    if (x.status === 'recount') return '<div class="hs-step"><span class="hs-step__no">1</span><span class="k-pill k-pill--caution">' + icon('refresh', 14, 2.4) + sp('Hitung ulang otomatis', 'Automatic recount') + '</span><span class="hs-sub">' + sp('SPV setelahnya', 'SPV after that') + '</span></div>';
    return '<div class="hs-step"><span class="hs-step__no">1</span><span class="hs-sub">' + sp('Menunggu hitungan', 'Waiting for the count') + '</span></div>';
  }
  function stepTwo(x) {
    if (x.hq_review === 'not_needed') return '<div class="hs-step"><span class="hs-step__no">2</span><span>' + sp('Tinjau Ops HQ: tidak perlu, cocok', 'Ops HQ review: not needed, matches') + '</span></div>';
    if (x.hq_review === 'reviewed') return '<div class="hs-step"><span class="hs-step__no is-ok">' + icon('check', 13, 3) + '</span><span class="hs-ok">' + sp('Ditinjau Ops HQ', 'Reviewed by Ops HQ') + '</span><span class="hs-sub">' + esc(first(x.hq_reviewed_name) + ' ' + S.fmt.dt(x.hq_reviewed_at)) + '</span></div>';
    if (x.hq_review === 'pending') return '<div class="hs-step"><span class="hs-step__no is-on">2</span><span class="k-strong">' + sp('Tinjau Ops HQ', 'Ops HQ review') + '</span>' +
      '<span class="k-pill">' + icon('eye', 14) + sp('Belum ditinjau', 'Not reviewed yet') + '</span>' +
      btn('k-btn--secondary k-btn--sm', 'Tandai ditinjau', 'Mark reviewed', 'data-review="' + x.id + '" data-min-role="hq"') + '</div>';
    return '<div class="hs-step"><span class="hs-step__no">2</span><span>' + sp('Tinjau Ops HQ', 'Ops HQ review') + '</span><span class="hs-sub">' + sp('sesudahnya, tidak menahan stok', 'afterwards, does not hold the stock') + '</span></div>';
  }
  function cntCell(a) {
    if (!a) return '<span class="hs-sub">-</span>';
    return '<div style="text-align:right"><div class="hs-cnt">' + (a.qty_counted == null ? '-' : n(a.qty_counted)) + '</div><div class="hs-sub">' + esc(first(a.counted_name)) + '</div>' +
      (a.method === 'blind' ? '<div class="hs-sub" style="color:var(--caution);font-weight:800">blind</div>' : a.method === 'scan' && a.attempt_no === 1 ? '<div class="hs-sub">' + esc(t('pindai', 'scan')) + '</div>' : '') + '</div>';
  }
  function recountCell(x) {
    const a = (x.attempts || []).filter((y) => y.status === 'finished')[1];
    if (a) return cntCell(a);
    if (x.status === 'recount' || (x.status === 'counting' && (x.attempts || []).length > 1)) return '<div style="text-align:right"><div class="k-strong" style="color:var(--caution)">' + sp('menunggu', 'waiting') + '</div><div class="hs-sub">' + esc(first(x.assigned_name)) + '</div></div>';
    return '<span class="hs-sub">' + sp('tidak perlu', 'not needed') + '</span>';
  }
  function diffCell(x) {
    const fin = (x.attempts || []).filter((y) => y.status === 'finished');
    if (x.variance === 0 || (x.outcome === 'auto_closed')) return '<span class="hs-ok">' + icon('check', 14, 2.6) + sp('Cocok', 'Matches') + '</span>';
    if (x.variance != null && (x.status === 'closed' || x.status === 'awaiting_spv' || fin.length > 1)) return '<span class="hs-diff">' + (x.variance > 0 ? '+' : '') + x.variance + '</span>';
    if (x.status === 'recount') return '<span class="hs-sub">' + sp('belum', 'not yet') + '</span>';
    return x.variance != null && S.atLeast('supervisor') ? '<span class="hs-diff">' + (x.variance > 0 ? '+' : '') + x.variance + '</span>' : '<span class="hs-sub">-</span>';
  }

  S.tab('hasil', async function (ctx) {
    styles();
    S.setTitle('Hitung stok', 'Stock count');
    S.setSub('Setujui hasil per bin. Setujui SPV langsung mengubah stok dan mengirimnya ke Hiryu.', 'Approve each bin\'s result. The SPV approval changes the stock and sends it to Hiryu at once.');
    if (!ctx.siteId) { ctx.body.innerHTML = '<div class="k-note k-note--info">' + icon('info', 20) + sp('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>'; return; }
    const res = await api().get('/counts/results' + api().qs({ site_id: ctx.siteId, days: 3 }));
    const plan = await api().get('/counts/plan' + api().qs({ site_id: ctx.siteId })).catch(() => null);
    S.tabCount('hasil', res.tasks.length);
    const pendingReview = res.tasks.filter((x) => x.hq_review === 'pending').map((x) => x.id);
    ctx.actions.innerHTML = (res.auto_closed ? '<span class="k-pill k-pill--ok k-pill--lg">' + icon('check', 16, 2.6) + esc(t(res.auto_closed + ' bin cocok selesai sendiri', res.auto_closed + ' matching bin(s) closed by themselves')) + '</span>' : '') +
      (pendingReview.length ? btn('k-btn--secondary', 'Tinjau semua (' + pendingReview.length + ')', 'Review all (' + pendingReview.length + ')', 'data-act="review-all" data-min-role="hq"', 'eye') : '');
    const showExp = S.atLeast('supervisor');
    const rows = res.tasks;
    const table = rows.length ? '<div class="k-tablewrap"><table class="k-table hs-table"><thead><tr><th>Bin</th><th ' + biAttr('Produk', 'Product') + '></th>' +
      '<th class="k-num" ' + biAttr('Sistem', 'System') + '></th><th class="k-num" ' + biAttr('Hitung', 'Count') + '></th><th class="k-num" ' + biAttr('Hitung ulang', 'Recount') + '></th>' +
      '<th class="k-num" ' + biAttr('Selisih', 'Difference') + '></th><th ' + biAttr('1 Setujui SPV · 2 Tinjau Ops HQ', '1 SPV approval · 2 Ops HQ review') + '></th></tr></thead><tbody>' +
      rows.map((x) => '<tr class="' + (x.variance ? 'is-caution' : '') + '"><td class="hs-bin">' + esc(x.bin) + '</td><td style="max-width:220px">' + esc(x.sku_name || '-') + '</td>' +
        '<td class="k-num">' + (showExp ? n(x.qty_expected) : '-') + '</td><td class="k-num">' + cntCell((x.attempts || []).filter((y) => y.status === 'finished')[0]) + '</td>' +
        '<td class="k-num">' + recountCell(x) + '</td><td class="k-num">' + diffCell(x) + '</td><td>' + stepOne(x) + stepTwo(x) + '</td></tr>').join('') + '</tbody></table></div>'
      : '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('count', 28) + '</span>' + bis('Belum ada hasil hitung', 'No count results yet', 'k-empty__title') + '</div>';
    const cards = '<div class="k-stack">' + rows.map((x) => '<div class="k-card k-card--pad' + (x.variance ? ' k-card--caution' : '') + '"><div class="k-line k-line--between"><span class="hs-bin">' + esc(x.bin) + '</span>' + diffCell(x) + '</div>' +
      '<div class="k-strong">' + esc(x.sku_name || '-') + '</div><div class="hs-sub">' +
      esc((showExp ? t('Sistem ', 'System ') + n(x.qty_expected) + ' · ' : '') + ((x.attempts || []).filter((y) => y.status === 'finished').map((a) => n(a.qty_counted) + ' ' + first(a.counted_name) + (a.method === 'blind' ? ' (blind)' : '')).join(' · ') || '-')) + '</div>' +
      stepOne(x) + stepTwo(x) + '</div>').join('') + '</div>';
    const fc = plan && plan.full_count;
    ctx.body.innerHTML = '<div class="k-stack" id="hs-res"><div class="k-note k-note--info">' + icon('info', 20) + '<span ' + biAttr('Selisih dan hitung blind perlu Setujui SPV: stok berubah dan Hiryu ikut saat itu juga. Hitung pindai yang cocok selesai sendiri. Ops HQ meninjau setiap selisih sesudahnya, untuk laporan selisih bulanan.',
      'Differences and blind counts need the SPV approval: the stock and Hiryu change at once. A matching count by scan closes by itself. Ops HQ reviews every difference afterwards, for the monthly variance report.') + '></span></div>' +
      '<div class="k-laptop-only">' + table + '</div><div class="k-phone-only">' + cards + '</div>' +
      (fc ? '<div class="k-note k-note--navy">' + icon('clock', 20) + '<span>' + esc(t('Hitung penuh ' + fc.date_label + ' mengisi stok terhitung di laporan bulanan merek. SPV menyetujui paling lambat ' + fc.approve_by_label + '; Ops HQ meninjau selisihnya untuk laporan selisih bulanan.',
        'The full count on ' + fc.date + ' fills the counted stock in the monthly brand report. The SPV approves it by ' + fc.approve_by + '; Ops HQ reviews the differences for the monthly variance report.')) + '</span></div>' : '') + '</div>';
    $('#hs-res', ctx.body).addEventListener('click', async (e) => {
      const ap = e.target.closest('[data-approve]'), rc = e.target.closest('[data-recount]'), rv = e.target.closest('[data-review]');
      try {
        if (ap) { const r = await api().post('/counts/tasks/' + ap.dataset.approve + '/approve', {}); S.toast(r.message, 'ok'); S.rerender(); }
        else if (rc) { await api().post('/counts/tasks/' + rc.dataset.recount + '/recount', {}); S.toast(['Dikirim ke orang lain untuk dihitung ulang.', 'Sent to another person for a recount.'], 'ok'); S.rerender(); }
        else if (rv) { await api().post('/counts/review', { task_ids: [+rv.dataset.review] }); S.rerender(); }
      } catch (err) { S.fail(err); }
    });
    const ra = $('[data-act="review-all"]', ctx.actions);
    if (ra) ra.addEventListener('click', async () => { try { await api().post('/counts/review', { task_ids: pendingReview }); S.rerender(); } catch (e) { S.fail(e); } });
  });
})();
