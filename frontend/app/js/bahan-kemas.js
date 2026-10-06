/* bahan-kemas.js: Bahan kemas (canvas Section 9, boards 9a and 9b).
 *
 * Tabs: stok (9a: usage per order, stock with the minimum tick, use per day,
 * days left, the last 7 days, the need, PR and receipt state; Ops HQ edits
 * items, minimums and usage, adds items and records the PR), terima (9b:
 * packs x pieces per pack, sent to Ops HQ; Ops HQ approves or sends back) and
 * mingguan (the SPV's weekly count, approved by Ops HQ).
 * Consumables are Ninja's own stock and never appear in brand reports.
 *
 * API (backend/routers/consumables.py, /api/consumables):
 *   GET  ?site_id   GET|PUT /settings   POST / (add)   PUT /{id}
 *   POST /{id}/request   GET /requests/open   POST /requests/{id}/pr {pr_number, qty}
 *   POST /{id}/receipts {packs, per_pack}   GET /receipts/pending   POST /receipts/{id}/approve|return|withdraw
 *   POST /counts {site_id, lines}   GET /counts?site_id   POST /counts/{id}/approve|return
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const api = () => S.api();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sp = (id, en) => '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  const btn = (cls, id, en, attrs, ic) => '<button type="button" class="k-btn ' + (cls || '') + '" ' + (attrs || '') + '>' + (ic ? icon(ic, 18, 2.2) : '') + sp(id, en) + '</button>';
  const q = (v) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 2 }));
  const BASIS = [['bag', 'per pesanan kantong', 'per order in a bag'], ['carton', 'per pesanan kardus', 'per order in a carton'],
    ['order', 'per pesanan dikemas', 'per order packed'], ['delivery', 'per kiriman diterima', 'per delivery received'], ['none', 'tidak otomatis', 'not automatic']];
  /* Only Ops HQ sees the pencil icons (board 9a). */
  const pencil = (attrs) => (S.atLeast('hq') ? '<button type="button" class="k-iconbtn bk-pen" ' + attrs + ' data-aria-id="Ubah" data-aria-en="Change" aria-label="' + esc(t('Ubah', 'Change')) + '">' + icon('edit', 15) + '</button>' : '');
  const needHub = (ctx) => {
    if (ctx.siteId) return false;
    ctx.body.innerHTML = '<div class="k-note k-note--info">' + icon('info', 20) + sp('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>';
    return true;
  };

  function styles() {
    if ($('#bk-style')) return;
    const st = document.createElement('style');
    st.id = 'bk-style';
    st.textContent = [
      '.bk-num{font-family:var(--mono);font-weight:700}',
      '.bk-sub{font-size:12px;color:var(--muted)}',
      '.bk-bar{position:relative;height:8px;border-radius:4px;background:var(--sunk);width:110px;margin-top:6px}',
      '.bk-bar__fill{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--action)}',
      '.bk-bar.is-low .bk-bar__fill{background:var(--caution)}',
      '.bk-bar__tick{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink)}',
      '.bk-low{color:var(--caution);font-weight:700;font-size:12px;margin-left:6px}',
      '.bk-spark{display:flex;align-items:flex-end;gap:3px;height:28px}',
      '.bk-spark i{display:block;width:6px;background:#B9C7DD;border-radius:2px 2px 0 0}',
      '.bk-spark i:last-child{background:var(--action)}',
      '.bk-pen{width:28px;height:28px;min-height:28px;padding:0;color:var(--action)}',
      '.bk-req{border:2px solid var(--action);border-radius:var(--r-card);background:var(--surface);padding:14px 18px;display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap}',
      '.bk-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      'tr.is-low td:first-child{box-shadow:inset 4px 0 0 var(--caution)}',
      '.bk-total{font-family:var(--mono);font-size:44px;font-weight:800;line-height:1}',
      '.bk-wrap{max-width:560px}',
      '#k-body .bk-table td{white-space:nowrap}',
      '#k-body .bk-table th,#k-body .bk-table td{padding-left:10px;padding-right:10px}',
      '#k-body .bk-table td.k-table__actions{white-space:normal;min-width:150px}',
      '#k-body .bk-table th{white-space:normal}',
      '#k-body .bk-table td.bk-name{white-space:normal;min-width:130px;max-width:170px}',
      '#k-body .bk-table td.bk-name{font-weight:700}',
      '.bk-step{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function stockCell(x) {
    const mx = Math.max(x.stock, (x.min_qty || 0) * 2.5, 1);
    return '<div><span class="bk-num">' + q(x.stock) + '</span> <span class="bk-sub">' + esc(x.unit) + '</span>' +
      (x.below_min ? '<span class="bk-low" ' + biAttr('di bawah minimum', 'below minimum') + '></span>' : '') +
      '<div class="bk-bar' + (x.below_min ? ' is-low' : '') + '"><span class="bk-bar__fill" style="width:' + Math.min(100, 100 * x.stock / mx) + '%"></span>' +
      (x.min_qty != null ? '<span class="bk-bar__tick" style="left:' + Math.min(99, 100 * x.min_qty / mx) + '%" title="minimum"></span>' : '') + '</div></div>';
  }
  function spark(x) {
    const m = Math.max(...x.use_by_day, 0.0001);
    return '<span class="bk-spark" aria-hidden="true">' + x.use_by_day.map((v) => '<i style="height:' + Math.max(3, Math.round(26 * v / m)) + 'px"></i>').join('') + '</span>';
  }
  function stateCell(x) {
    if (x.request && x.request.kind === 'raised') return '<div style="text-align:right"><span class="k-pill k-pill--caution">' + icon('clock', 14) + sp('Diajukan ke Ops HQ', 'Raised to Ops HQ') + '</span>' +
      '<div class="bk-sub">' + esc(String(x.request.label_id || '').replace(/^Diajukan ke Ops HQ · /, '')) + '</div></div>';
    if (x.request && x.request.kind === 'pr_submitted') return '<div style="text-align:right"><span class="k-pill k-pill--info">' + icon('truck', 14) + sp('PR diajukan', 'PR submitted') + '</span>' +
      '<div class="bk-sub"><span class="k-mono k-strong">' + esc(x.request.pr_number) + '</span> · ' + esc(S.fmt.date(x.request.at).replace(/ \d{4}$/, '')) + '</div></div>';
    if (x.below_min) return btn('k-btn--primary k-btn--sm', 'Ajukan ke Ops HQ', 'Raise to Ops HQ', 'data-raise="' + x.id + '" data-min-role="supervisor"');
    return '<div style="text-align:right">' + S.pill('ok', 'Cukup', 'Enough') + '</div>';
  }

  /* ================= 9a: stock ================= */

  S.tab('stok', async function (ctx) {
    styles();
    if (needHub(ctx)) return;
    const [d, reqs] = await Promise.all([
      api().get('/consumables' + api().qs({ site_id: ctx.siteId })),
      api().get('/consumables/requests/open' + api().qs({ site_id: ctx.siteId })),
    ]);
    const lc = d.last_count;
    const lcText = lc ? [' Hitung mingguan terakhir: ' + S.fmt.day(lc.counted_at) + (lc.status === 'pending' ? ', menunggu persetujuan Ops HQ.' : lc.status === 'returned' ? ', dikembalikan Ops HQ.' : ', disetujui.'),
      ' Last weekly count: ' + S.fmt.day(lc.counted_at) + (lc.status === 'pending' ? ', waiting for Ops HQ.' : lc.status === 'returned' ? ', sent back by Ops HQ.' : ', approved.')] : [' Belum pernah dihitung mingguan.', ' Never counted weekly.'];
    S.setSub('Stok kemasan milik Ninja di ' + d.site_code + '. Pembelian di luar sistem, lewat PR dari Ops HQ.' + lcText[0],
      'Ninja\'s own packing stock at ' + d.site_code + '. Bought outside the system, through a PR from Ops HQ.' + lcText[1]);
    ctx.actions.innerHTML = '<a class="k-btn k-btn--secondary" href="bahan-kemas.html?tab=mingguan">' + sp('Hitung mingguan', 'Weekly count') + '</a>' +
      '<a class="k-btn k-btn--secondary" href="bahan-kemas.html?tab=terima">' + sp('Terima', 'Receive') + '</a>';
    const raised = reqs.requests.filter((r) => r.status === 'raised');
    const reqHtml = raised.map((r) => '<div class="bk-req"><div style="min-width:200px"><div class="k-line" style="gap:8px"><strong ' + biAttr('Permintaan SPV', 'SPV request') + '></strong><span class="k-chip k-chip--hq">Ops HQ</span></div>' +
      '<div class="bk-sub" ' + biAttr('PR dibuat di luar sistem.', 'The PR is made outside the system.') + '></div></div>' +
      '<div class="k-grow" style="min-width:200px"><div class="k-strong">' + esc(r.name) + '</div><div class="bk-sub">' + esc(t('Diajukan ', 'Raised by ') + (r.raised_name || r.raised_by) + ' (SPV) · ' + S.fmt.dt(r.raised_at)) + '</div></div>' +
      '<label class="k-field" style="width:120px"><span class="k-field__label">' + esc(t('Jumlah', 'Quantity') + ' (' + r.unit + ')') + '</span><input class="k-input k-input--num" data-prq="' + r.id + '" type="number" min="0" value="' + (r.qty_suggested != null ? Math.round(r.qty_suggested) : '') + '"></label>' +
      '<label class="k-field" style="width:180px"><span class="k-field__label" ' + biAttr('Nomor PR', 'PR number') + '></span><input class="k-input k-mono" data-prn="' + r.id + '" placeholder="PR-2610-003"></label>' +
      btn('k-btn--primary', 'Ajukan PR', 'Submit the PR', 'data-pr="' + r.id + '" data-min-role="hq"') + '</div>').join('');
    const table = '<div class="k-tablewrap"><table class="k-table bk-table"><thead><tr><th ' + biAttr('Barang', 'Item') + '></th><th ' + biAttr('Pemakaian per pesanan', 'Usage per order') + '></th>' +
      '<th ' + biAttr('Stok', 'Stock') + '></th><th class="k-num" ' + biAttr('Pakai per hari', 'Use per day') + '></th><th class="k-num" ' + biAttr('Sisa', 'Left') + '></th>' +
      '<th class="k-num">Minimum</th><th ' + biAttr('Pakai 7 hari', 'Last 7 days') + '></th><th></th></tr></thead><tbody>' +
      d.items.map((x) => '<tr class="' + (x.below_min ? 'is-caution is-low' : '') + '"><td class="bk-name">' + esc(x.name) + '</td>' +
        '<td><div class="k-line" style="gap:4px"><span class="bk-num">' + q(x.usage_qty) + '</span> <span class="bk-sub">' + esc(x.unit) + '</span>' + pencil('data-edit="' + x.id + '"') + '</div>' +
        '<div class="bk-sub">' + esc(t((BASIS.find((b) => b[0] === x.usage_basis) || BASIS[2])[1], (BASIS.find((b) => b[0] === x.usage_basis) || BASIS[2])[2])) + '</div></td>' +
        '<td>' + stockCell(x) + '</td><td class="k-num">' + q(x.per_day) + '</td>' +
        '<td class="k-num" style="' + (x.below_min ? 'color:var(--caution);font-weight:800' : 'font-weight:700') + '">' + (x.days_left == null ? '-' : esc(x.days_left + ' ' + t('hari', 'days'))) + '</td>' +
        '<td class="k-num"><span class="k-line" style="gap:4px;justify-content:flex-end">' + q(x.min_qty) + pencil('data-edit="' + x.id + '"') + '</span></td>' +
        '<td>' + spark(x) + '</td><td class="k-table__actions">' + stateCell(x) + '</td></tr>').join('') + '</tbody></table></div>';
    const cards = '<div class="k-stack">' + d.items.map((x) => '<div class="k-card k-card--pad' + (x.below_min ? ' k-card--caution' : '') + '"><div class="k-line k-line--between"><strong>' + esc(x.name) + '</strong>' + pencil('data-edit="' + x.id + '"') + '</div>' +
      '<div class="bk-sub">' + esc(t(x.usage_label_id, x.usage_label_en)) + '</div>' + stockCell(x) +
      '<div class="bk-sub" style="margin:6px 0">' + esc(t('Pakai ' + q(x.per_day) + ' per hari · sisa ' + (x.days_left == null ? '-' : x.days_left) + ' hari · minimum ' + q(x.min_qty),
        'Use ' + q(x.per_day) + ' a day · ' + (x.days_left == null ? '-' : x.days_left) + ' days left · minimum ' + q(x.min_qty))) + '</div>' + stateCell(x) + '</div>').join('') + '</div>';
    ctx.body.innerHTML = '<div class="k-stack" id="bk-s">' +
      '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:10px"><span class="k-line" style="gap:6px;flex-wrap:wrap">' + icon('list', 18) +
      '<span>' + esc(t('Dihitung otomatis dari ', 'Deducted automatically from ')) + '<b class="bk-num">' + d.packed_orders_7d + '</b>' + esc(t(' pesanan dikemas 7 hari terakhir', ' orders packed in the last 7 days')) + '</span>' +
      '<span class="bk-sub">' + esc(t('· logika: Ops HQ', '· logic: Ops HQ')) + '</span>' + pencil('data-settings') + '</span>' +
      '<button type="button" class="k-btn k-btn--outline" data-add data-min-role="hq">' + icon('plus', 18) + sp('Tambah bahan kemas', 'Add a consumable') + ' <span class="k-chip k-chip--hq">Ops HQ</span></button></div>' +
      reqHtml + '<div class="k-laptop-only">' + table + '</div><div class="k-phone-only">' + cards + '</div>' +
      '<p class="k-caption">' + esc(t('Minimum = ' + d.settings.min_days + ' hari pada target Grab ' + d.settings.orders_per_month + ' pesanan per bulan per dark store (usulan, bisa diubah Ops HQ). Garis tegak pada batang = minimum. Ikon pensil: hanya Ops HQ yang mengubah minimum, pemakaian per pesanan dan logikanya.',
        'Minimum = ' + d.settings.min_days + ' days at Grab\'s target of ' + d.settings.orders_per_month + ' orders per dark store per month (a proposal Ops HQ can change). The tick on the bar = the minimum. Pencil: only Ops HQ changes minimums, usage per order and the logic.')) + '</p></div>';
    const root = $('#bk-s', ctx.body);
    root.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]'), ra = e.target.closest('[data-raise]'), pr = e.target.closest('[data-pr]');
      if (e.target.closest('[aria-disabled="true"]')) return;
      try {
        if (ed) itemModal(ctx, d.items.find((x) => String(x.id) === ed.dataset.edit));
        else if (e.target.closest('[data-settings]')) settingsModal(d.settings);
        else if (e.target.closest('[data-add]')) itemModal(ctx, null);
        else if (ra) { ra.disabled = true; await api().post('/consumables/' + ra.dataset.raise + '/request', {}); S.toast(['Diajukan ke Ops HQ.', 'Raised to Ops HQ.'], 'ok'); S.rerender(); }
        else if (pr) {
          const num = $('[data-prn="' + pr.dataset.pr + '"]', root).value.trim();
          if (!num) { S.toast(['Isi nomor PR.', 'Enter the PR number.'], 'caution'); return; }
          const qty = $('[data-prq="' + pr.dataset.pr + '"]', root).value;
          await api().post('/consumables/requests/' + pr.dataset.pr + '/pr', { pr_number: num, qty: qty === '' ? null : +qty });
          S.toast(['PR dicatat.', 'PR recorded.'], 'ok');
          S.rerender();
        }
      } catch (err) { S.fail(err); }
    });
  });

  function itemModal(ctx, x) {
    const sugg = x ? x.min_suggested : null;
    S.modal({
      title: x ? ['Ubah ' + x.name, 'Change ' + x.name] : ['Tambah bahan kemas', 'Add a consumable'],
      body: '<div class="k-stack">' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Nama', 'Name') + '></span><input class="k-input" id="bk-name" value="' + esc(x ? x.name : '') + '"></label>' +
        '<div class="k-grid2"><label class="k-field"><span class="k-field__label" ' + biAttr('Satuan', 'Unit') + '></span><input class="k-input" id="bk-unit" value="' + esc(x ? x.unit : 'pcs') + '"></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Isi per pak', 'Pieces per pack') + '></span><input class="k-input k-input--num" id="bk-pack" type="number" min="0" step="any" value="' + (x && x.pack_size != null ? x.pack_size : '') + '"></label></div>' +
        '<div class="k-grid2"><label class="k-field"><span class="k-field__label" ' + biAttr('Pemakaian', 'Usage') + '></span><input class="k-input k-input--num" id="bk-use" type="number" min="0" step="any" value="' + (x ? x.usage_qty : 1) + '"></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Dipakai', 'Used') + '></span><select class="k-select" id="bk-basis">' +
        BASIS.map((b) => '<option value="' + b[0] + '"' + ((x ? x.usage_basis : 'order') === b[0] ? ' selected' : '') + '>' + esc(t(b[1], b[2])) + '</option>').join('') + '</select></label></div>' +
        '<label class="k-field"><span class="k-field__label">Minimum</span><input class="k-input k-input--num" id="bk-min" type="number" min="0" step="any" value="' + (x && x.min_qty != null ? x.min_qty : '') + '">' +
        (sugg ? '<span class="k-field__hint">' + esc(t('Usulan dari target: ' + sugg, 'Proposed from the target: ' + sugg)) + '</span>' : '') + '</label>' +
        (x ? '' : '<label class="k-check"><input type="checkbox" id="bk-all"> <span ' + biAttr('Tambahkan di semua dark store', 'Add at every dark store') + '></span></label>') +
        '<p class="k-caption" ' + biAttr('Dipakai mulai pesanan berikutnya yang dikemas.', 'Used from the next packed order on.') + '></p></div>',
      actions: [].concat(x ? [{ label: ['Nonaktifkan', 'Switch off'], kind: 'ghost', minRole: 'hq', onClick: async () => { await api().put('/consumables/' + x.id, { active: false }); S.rerender(); } }] : [],
        [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
          label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq',
          onClick: async () => {
            const num = (id) => { const v = $(id).value; return v === '' ? null : +v; };
            const body = { name: $('#bk-name').value.trim(), unit: $('#bk-unit').value.trim() || 'pcs', pack_size: num('#bk-pack'),
              usage_basis: $('#bk-basis').value, usage_qty: num('#bk-use') || 0, min_qty: num('#bk-min') };
            if (!body.name) { S.toast(['Isi nama.', 'Enter the name.'], 'caution'); return false; }
            if (x) await api().put('/consumables/' + x.id, body);
            else await api().post('/consumables', Object.assign(body, { site_id: ctx.siteId, all_hubs: $('#bk-all').checked }));
            S.toast(['Disimpan.', 'Saved.'], 'ok');
            S.rerender();
          },
        }]),
    });
  }

  function settingsModal(cfg) {
    S.modal({
      title: ['Logika minimum', 'Minimum logic'],
      body: '<div class="k-stack"><label class="k-field"><span class="k-field__label" ' + biAttr('Target Grab: pesanan per dark store per bulan', 'Grab target: orders per dark store per month') + '></span><input class="k-input k-input--num" id="bk-opm" type="number" min="1" value="' + cfg.orders_per_month + '"></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Minimum = berapa hari pemakaian', 'Minimum = how many days of use') + '></span><input class="k-input k-input--num" id="bk-md" type="number" min="1" value="' + cfg.min_days + '"></label>' +
        '<p class="k-caption" ' + biAttr('Dipakai untuk usulan minimum setiap barang. Minimum yang sudah diisi tidak berubah sendiri.', 'Used for each item\'s proposed minimum. Minimums already set do not change by themselves.') + '></p></div>',
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq',
        onClick: async () => { await api().put('/consumables/settings', { orders_per_month: +$('#bk-opm').value, min_days: +$('#bk-md').value }); S.rerender(); },
      }],
    });
  }

  /* ================= 9b: receive ================= */

  S.tab('terima', async function (ctx) {
    styles();
    S.setSub('Saat kiriman bahan kemas sampai: pilih barang, isi jumlah pak dan isi per pak, kirim ke Ops HQ. Stok baru naik setelah Ops HQ menyetujui.',
      'When consumables arrive: choose the item, enter packs and pieces per pack, send to Ops HQ. The stock rises only after Ops HQ approves.');
    if (needHub(ctx)) return;
    const [d, rc, cnt] = await Promise.all([
      api().get('/consumables' + api().qs({ site_id: ctx.siteId })),
      api().get('/consumables/receipts/pending' + api().qs({ site_id: ctx.siteId })),
      api().get('/consumables/counts' + api().qs({ site_id: ctx.siteId, status: 'pending' })),
    ]);
    if (!d.items.length) { ctx.body.innerHTML = '<div class="k-card k-empty">' + bis('Belum ada bahan kemas di dark store ini.', 'No consumable at this dark store yet.', 'k-empty__title') + '</div>'; return; }
    let item = d.items.find((x) => x.request && x.request.kind === 'pr_submitted') || d.items[0];
    let packs = 1, per = item.last_per_pack || item.pack_size || 1;
    ctx.body.innerHTML = '<div class="k-stack bk-wrap" id="bk-t"></div>';
    const root = $('#bk-t', ctx.body);
    const pending = rc.receipts.filter((r) => r.status === 'pending');
    const back = rc.receipts.filter((r) => r.status === 'returned');
    const waitList = pending.map((r) => esc(r.name + ' · ' + q(r.qty_total) + ' ' + r.unit + ' · ' + t('diterima ', 'received ') + S.fmt.dt(r.entered_at)))
      .concat(cnt.counts.map((c) => esc(t('Hitung mingguan · ', 'Weekly count · ') + S.fmt.day(c.counted_at))));
    function paint() {
      const tot = packs * per;
      const pr = item.request && item.request.kind === 'pr_submitted' ? item.request.pr_number : null;
      root.innerHTML =
        '<div class="k-card k-card--pad k-stack k-stack--tight"><span class="bk-step">1 · ' + esc(t('Barang', 'Item')) + '</span>' +
        '<div class="k-line" style="gap:12px"><span class="k-row__icon">' + icon('box', 24) + '</span><div class="k-grow"><div class="k-strong" style="font-size:17px">' + esc(item.name) + '</div>' +
        (pr ? '<span class="k-pill k-pill--info">' + icon('truck', 14) + esc(t('PR diajukan · ', 'PR submitted · ') + pr) + '</span>' : '') + '</div>' +
        '<button type="button" class="k-linkbtn" id="bk-chg" ' + biAttr('Ganti', 'Change') + '></button></div>' +
        '<select class="k-select" id="bk-item" hidden aria-label="' + esc(t('Ganti barang', 'Change the item')) + '">' + d.items.map((x) => '<option value="' + x.id + '"' + (x.id === item.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
        '<div class="k-card k-card--pad k-stack k-stack--tight"><span class="bk-step">2 · ' + esc(t('Jumlah pak diterima', 'Packs received')) + '</span><div id="bk-packs"></div></div>' +
        '<div class="k-card k-card--pad k-line k-line--between" style="gap:12px"><div><span class="bk-step">3 · ' + esc(t('Isi per pak', 'Pieces per pack')) + '</span>' +
        '<div class="bk-sub" ' + biAttr('Dari penerimaan terakhir. Ubah jika beda.', 'From the last delivery. Change it if different.') + '></div></div>' +
        '<span class="k-line" style="gap:8px"><input class="k-input k-input--num" id="bk-per" type="number" min="0" step="any" style="width:100px;font-size:22px;font-weight:800;text-align:center" value="' + per + '"><span class="k-strong">' + esc(item.unit) + '</span></span></div>' +
        '<div class="k-card k-card--pad"><span class="bk-step" ' + biAttr('Total diterima', 'Total received') + '></span><div class="k-line" style="gap:8px;align-items:baseline"><span class="bk-total">' + q(tot) + '</span><span class="k-strong">' + esc(item.unit) + '</span></div>' +
        '<div>' + esc(t(packs + ' pak × ' + q(per) + ' ' + item.unit + '. Stok sekarang ' + q(item.stock) + ' ' + item.unit + '. Jadi ', packs + ' packs × ' + q(per) + ' ' + item.unit + '. Stock now ' + q(item.stock) + ' ' + item.unit + '. Becomes ')) +
        '<b>' + esc(q(item.stock + tot) + ' ' + item.unit) + '</b>' + esc(t(' setelah Ops HQ menyetujui.', ' after Ops HQ approves.')) + '</div></div>' +
        (back.length ? back.map((r) => '<div class="k-note k-note--stop">' + icon('undo', 20) + '<span>' + esc(t('Dikembalikan Ops HQ: ', 'Sent back by Ops HQ: ') + r.name + ' · ' + q(r.qty_total) + ' ' + r.unit + (r.hq_note ? ' · ' + r.hq_note : '')) +
          ' <button type="button" class="k-linkbtn" data-withdraw="' + r.id + '" ' + biAttr('Hapus dari daftar', 'Remove from the list') + '></button></span></div>').join('') : '') +
        (waitList.length ? '<div class="k-note k-note--caution">' + icon('clock', 20) + '<span><b ' + biAttr('Menunggu persetujuan Ops HQ', 'Waiting for Ops HQ') + '></b><br>' + waitList.join('<br>') + '</span></div>' : '') +
        (pending.length ? '<div class="k-card k-card--pad k-stack k-stack--tight"><strong ' + biAttr('Penerimaan untuk disetujui', 'Receipts to approve') + '></strong>' + pending.map((r) =>
          '<div class="k-line k-line--between" style="border-top:1px solid var(--rule);padding-top:8px;gap:8px;flex-wrap:wrap"><span><b>' + esc(r.name) + '</b> · ' + esc(q(r.packs) + ' × ' + q(r.per_pack) + ' = ' + q(r.qty_total) + ' ' + r.unit) +
          '<span class="bk-sub"> · ' + esc((r.pr_number ? 'PR ' + r.pr_number + (r.pr_qty != null ? ' (' + q(r.pr_qty) + ')' : '') + ' · ' : '') + (r.entered_name || r.entered_by)) + '</span></span><span class="k-line" style="gap:6px">' +
          btn('k-btn--primary k-btn--sm', 'Setujui', 'Approve', 'data-ok="' + r.id + '" data-min-role="hq"', 'check') + btn('k-btn--secondary k-btn--sm', 'Kembalikan', 'Send back', 'data-no="' + r.id + '" data-min-role="hq"') + '</span></div>').join('') + '</div>' : '') +
        '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Kirim ke Ops HQ', 'Send to Ops HQ', 'id="bk-send" data-min-role="supervisor"', 'check') + '</div>';
      S.stepper($('#bk-packs', root), { value: packs, min: 1, max: 999, onChange: (v) => { packs = v; paint(); } });
      $('#bk-per', root).addEventListener('change', (e) => { per = +e.target.value || 0; paint(); });
      $('#bk-chg', root).addEventListener('click', () => { const sel = $('#bk-item', root); sel.hidden = false; sel.focus(); });
      $('#bk-item', root).addEventListener('change', (e) => { item = d.items.find((x) => String(x.id) === e.target.value); per = item.last_per_pack || item.pack_size || 1; paint(); });
      S.applyLang(root);
      S.lockAll(root);
    }
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[aria-disabled="true"]')) return;
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]'), wd = e.target.closest('[data-withdraw]');
      try {
        if (e.target.closest('#bk-send')) {
          if (!(packs > 0 && per > 0)) { S.toast(['Isi jumlah pak dan isi per pak.', 'Enter packs and pieces per pack.'], 'caution'); return; }
          const r = await api().post('/consumables/' + item.id + '/receipts', { packs, per_pack: per });
          S.toast(r.message, 'ok');
          S.rerender();
        } else if (ok) { await api().post('/consumables/receipts/' + ok.dataset.ok + '/approve', {}); S.toast(['Disetujui. Stok naik.', 'Approved. The stock rises.'], 'ok'); S.rerender(); }
        else if (no) sendBack('/consumables/receipts/' + no.dataset.no + '/return');
        else if (wd) { await api().post('/consumables/receipts/' + wd.dataset.withdraw + '/withdraw', {}); S.rerender(); }
      } catch (err) { S.fail(err); }
    });
    paint();
  });

  function sendBack(path) {
    S.modal({
      title: ['Kembalikan ke SPV', 'Send back to the SPV'],
      body: '<label class="k-field"><span class="k-field__label" ' + biAttr('Catatan', 'Note') + '></span><textarea class="k-textarea" id="bk-why" rows="3"></textarea></label>',
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Kembalikan', 'Send back'], kind: 'primary', minRole: 'hq',
        onClick: async () => { await api().post(path, { note: $('#bk-why').value.trim() || null }); S.rerender(); },
      }],
    });
  }

  /* ================= weekly count ================= */

  S.tab('mingguan', async function (ctx) {
    styles();
    S.setSub('Sekali seminggu: hitung setiap barang di rak, ketik jumlahnya, kirim ke Ops HQ. Saat disetujui, angka hitung menggantikan angka sistem.',
      'Once a week: count every item on the shelf, type the number and send it to Ops HQ. When approved, the counted numbers replace the computed ones.');
    if (needHub(ctx)) return;
    const [d, cs] = await Promise.all([
      api().get('/consumables' + api().qs({ site_id: ctx.siteId })),
      api().get('/consumables/counts' + api().qs({ site_id: ctx.siteId })),
    ]);
    const pend = cs.counts.find((c) => c.status === 'pending');
    const last = cs.counts[0];
    ctx.body.innerHTML = '<div class="k-stack bk-wrap" id="bk-m"></div>';
    const root = $('#bk-m', ctx.body);
    if (pend) {
      root.innerHTML = '<div class="k-note k-note--caution">' + icon('clock', 20) + '<span>' + esc(t('Menunggu persetujuan Ops HQ · dihitung ', 'Waiting for Ops HQ · counted by ') + (pend.counted_name || pend.counted_by) + ', ' + S.fmt.dt(pend.counted_at)) + '</span></div>' +
        '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Barang', 'Item') + '></th><th class="k-num" ' + biAttr('Sistem', 'System') + '></th><th class="k-num" ' + biAttr('Dihitung', 'Counted') + '></th><th class="k-num" ' + biAttr('Selisih', 'Difference') + '></th></tr></thead><tbody>' +
        pend.lines.map((l) => '<tr class="' + (l.difference ? 'is-caution' : '') + '"><td class="k-strong">' + esc(l.name) + '</td><td class="k-num">' + q(l.qty_system) + '</td><td class="k-num k-strong">' + q(l.qty_counted) + '</td>' +
          '<td class="k-num" style="' + (l.difference ? 'color:var(--stop);font-weight:800' : '') + '">' + (l.difference > 0 ? '+' : '') + q(l.difference) + '</td></tr>').join('') + '</tbody></table></div>' +
        '<div class="k-line" style="gap:8px;justify-content:flex-end">' + btn('k-btn--secondary', 'Kembalikan', 'Send back', 'data-no="' + pend.id + '" data-min-role="hq"') +
        btn('k-btn--primary', 'Setujui hitungan', 'Approve the count', 'data-ok="' + pend.id + '" data-min-role="hq"', 'check') + '</div>';
    } else {
      root.innerHTML = (last && last.status === 'returned' ? '<div class="k-note k-note--stop">' + icon('undo', 20) + '<span>' + esc(t('Hitungan terakhir dikembalikan Ops HQ', 'The last count was sent back by Ops HQ') + (last.hq_note ? ': ' + last.hq_note : '.')) + '</span></div>' : '') +
        (last && last.status === 'approved' ? '<p class="k-caption">' + esc(t('Terakhir disetujui: ', 'Last approved: ') + S.fmt.day(last.counted_at)) + '</p>' : '') +
        '<div class="k-card" style="padding:4px 0">' + d.items.map((x) => '<label class="k-line k-line--between" style="padding:12px 16px;border-top:1px solid var(--rule);gap:12px"><span><span class="k-strong">' + esc(x.name) + '</span>' +
          '<span class="bk-sub" style="display:block">' + esc(t('Menurut sistem: ', 'System: ') + q(x.stock) + ' ' + x.unit) + '</span></span>' +
          '<span class="k-line" style="gap:6px"><input class="k-input k-input--num" type="number" min="0" step="any" data-cnt="' + x.id + '" style="width:100px;text-align:right"><span class="bk-sub">' + esc(x.unit) + '</span></span></label>').join('') + '</div>' +
        '<p class="k-caption" ' + biAttr('Sistem sudah mengurangi pemakaian per pesanan; hitungan ini menangkap yang terlewat (terbuang, rusak, takaran salah).', 'The system already deducts usage per order; this count catches what it misses (waste, damage, a wrong rate).') + '></p>' +
        '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Kirim ke Ops HQ', 'Send to Ops HQ', 'id="bk-cs" data-min-role="supervisor"', 'check') + '</div>';
    }
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[aria-disabled="true"]')) return;
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
      try {
        if (ok) { await api().post('/consumables/counts/' + ok.dataset.ok + '/approve', {}); S.toast(['Disetujui. Angka hitung jadi stok.', 'Approved. The counts are now the stock.'], 'ok'); S.rerender(); }
        else if (no) sendBack('/consumables/counts/' + no.dataset.no + '/return');
        else if (e.target.closest('#bk-cs')) {
          const inputs = $$('[data-cnt]', root);
          if (inputs.some((i) => i.value === '')) { S.toast(['Isi jumlah setiap barang.', 'Enter every item\'s count.'], 'caution'); return; }
          await api().post('/consumables/counts', { site_id: ctx.siteId, lines: inputs.map((i) => ({ consumable_id: +i.dataset.cnt, qty: +i.value })) });
          S.toast(['Dikirim ke Ops HQ.', 'Sent to Ops HQ.'], 'ok');
          S.rerender();
        }
      } catch (err) { S.fail(err); }
    });
  });
})();
