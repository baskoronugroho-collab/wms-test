/* restock.js: Restock ke merek (canvas section 4, boards 4a to 4e).
 *
 * Tabs (restock.html): draft (Draf), raised (Diajukan), po (Permintaan),
 * sent (Terkirim), confirmed (Dikonfirmasi), selisih (Selisih), selesai.
 * ?id=<n> opens one request in its own tab; ?id=<n>&make=1 is *Buat permintaan
 * restock* (4b). A tab with exactly one request shows it straight away (4a).
 *
 * The SPV or Ops HQ makes and edits drafts; only Ops HQ makes the request,
 * downloads the Excel, marks it sent, records the brand's confirmation and
 * approves the differences. API: backend/routers/replenishment.py.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const API = () => S.api();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const n = (v) => S.fmt.n(v);
  const p2 = (id, en) => '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  const btn = (cls, id, en, attrs, ic) => '<button type="button" class="k-btn ' + (cls || '') + '" ' + (attrs || '') + '>' + (ic ? icon(ic, 20, 2.2) : '') + p2(id, en) + '</button>';
  const note = (kind, id, en, ic) => '<div class="k-note k-note--' + kind + '">' + icon(ic || (kind === 'caution' ? 'warn' : 'info'), 20) + '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span></div>';
  const short = (s) => String(s || '').replace(/^(Labore|Kahf)\s+/i, '');
  const TAB_OF = { draft: 'draft', raised: 'raised', po: 'po', sent: 'sent', confirmed: 'confirmed', receiving: 'confirmed', variance_review: 'selisih', variance_signoff: 'selisih', received: 'selesai', cancelled: 'selesai' };
  const STATUS = {
    draft: ['Draf', 'Draft', 'info'], raised: ['Diajukan', 'Raised', 'info'], po: ['Permintaan', 'Request', 'info'],
    sent: ['Terkirim, menunggu merek', 'Sent, waiting for the brand', 'info'], confirmed: ['Dikonfirmasi', 'Confirmed', 'ok'],
    receiving: ['Sedang diterima', 'Being received', 'info'], variance_review: ['Selisih', 'Differences', 'caution'],
    variance_signoff: ['Selisih: menunggu Ops HQ', 'Differences: waiting for Ops HQ', 'caution'], received: ['Selesai', 'Closed', 'ok'], cancelled: ['Dibatalkan', 'Cancelled', 'stop'],
  };
  const statusPill = (s) => { const x = STATUS[s] || [s, s, 'info']; return S.pill(x[2], x[0], x[1]); };
  const who = (e) => String(e || '').split('@')[0].split('.').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const xlsx = (id) => '../api/replenishments/' + id + '/po.xlsx';

  function styles() {
    if ($('#rs-style')) return;
    const st = document.createElement('style');
    st.id = 'rs-style';
    st.textContent = [
      '.rs-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}',
      '.rs-ref{font-family:var(--mono);font-weight:700;font-size:24px;overflow-wrap:anywhere}',
      '.rs-form{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}',
      '@media (min-width:1024px){.rs-form{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.rs-info{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}',
      '@media (min-width:1024px){.rs-info{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.rs-info dt{font-size:13px;color:var(--muted);font-weight:700}.rs-info dd{margin:2px 0 0;font-weight:600}',
      '.rs-qty{width:96px;text-align:right}',
      '#k-body .k-table td.k-mono,.rs-nw{white-space:nowrap}',
      '.rs-missing{color:var(--stop);font-weight:800;font-family:var(--mono)}',
      '.rs-dec{display:flex;gap:6px;flex-wrap:wrap}',
      '.rs-dec .k-btn[aria-pressed="true"]{background:var(--action);color:#FFF}',
      '.rs-foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}',
      '.rs-total{font-family:var(--mono);font-weight:700;font-size:26px}',
      '.rs-chip-due{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:var(--caution-bg);color:var(--caution);font-weight:700;font-size:14px}',
      '.rs-chip-due.is-late{background:var(--stop-bg);color:var(--stop)}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function setParams(p) {
    const u = new URL(location.href);
    ['id', 'make'].forEach((k) => u.searchParams.delete(k));
    Object.entries(p || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    return u;
  }
  function go(p, tab) {
    const u = setParams(p);
    if (tab) u.searchParams.set('tab', tab);
    history.pushState(null, '', u.pathname + u.search);
    S.rerender();
  }
  window.addEventListener('popstate', () => S.rerender());

  async function paintCounts() {
    try {
      const c = await API().get('/replenishments/tabs' + API().qs({ site_id: S.allSites() ? null : S.siteId() }));
      Object.entries(c).forEach(([k, v]) => S.tabCount(k, v || null, k === 'selisih' && v ? 'caution' : null));
    } catch (e) { /* counts are a nicety */ }
  }

  /* ================= lists ================= */

  function listHtml(rows, tab) {
    if (!rows.length) {
      return '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
        bis('Tidak ada di sini', 'Nothing here', 'k-empty__title') +
        bis(tab === 'draft' ? 'Draf dibuka sendiri saat SKU sampai di angka pesan ulang, atau tekan Buat draf.' : 'Permintaan muncul di sini saat sampai di langkah ini.',
          tab === 'draft' ? 'A draft opens by itself when a SKU reaches its reorder number, or press New draft.' : 'Requests show here when they reach this step.', 'k-empty__text') + '</div>';
    }
    const when = (r) => r.decide_by ? S.fmt.dt(r.decide_by) : r.confirmed_at && r.eta_date ? S.fmt.day(r.eta_date) : S.fmt.dt(r.sent_at || r.po_saved_at || r.raised_at || r.created_at);
    return '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr>' +
      '<th ' + biAttr('Ninja reference', 'Ninja reference') + '></th><th ' + biAttr('Merek', 'Brand') + '></th><th ' + biAttr('Dark store', 'Dark store') + '></th>' +
      '<th ' + biAttr('No. PO merek', 'Brand PO') + '></th><th class="k-num">SKU</th><th class="k-num" ' + biAttr('Unit', 'Units') + '></th>' +
      '<th ' + biAttr('Status', 'Status') + '></th><th ' + biAttr('Waktu', 'When') + '></th><th></th></tr></thead><tbody>' +
      rows.map((r) => '<tr' + (r.differences_pending ? ' class="is-caution"' : '') + '><td class="k-mono k-strong">' + (r.reference_is_final ? esc(r.reference) : '<span class="k-muted" ' + biAttr('(draf)', '(draft)') + '></span>') + '</td>' +
        '<td>' + esc(r.brand_name) + '</td><td class="k-mono">' + esc(S.shortCode(r.site_code)) + '</td><td class="k-mono">' + esc(r.brand_po_number || '-') + '</td>' +
        '<td class="k-num">' + n(r.lines.length) + '</td><td class="k-num">' + n(r.total_confirmed || r.total_requested) + '</td>' +
        '<td>' + statusPill(r.status) + '</td><td>' + esc(when(r)) + '</td>' +
        '<td class="k-table__actions"><a class="k-btn k-btn--sm k-btn--secondary" href="?tab=' + (TAB_OF[r.status] || tab) + '&id=' + r.id + '" ' + biAttr('Buka', 'Open') + '></a></td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="k-phone-only"><div class="k-list">' + rows.map((r) => '<a class="k-row' + (r.differences_pending ? ' k-row--caution' : '') + '" href="?tab=' + (TAB_OF[r.status] || tab) + '&id=' + r.id + '">' +
        '<span class="k-row__icon">' + icon('truck', 26) + '</span><span class="k-row__text"><span class="k-row__title">' + esc(r.brand_name + ' · ' + S.shortCode(r.site_code)) + '</span>' +
        '<span class="k-row__sub">' + (r.reference_is_final ? '<span class="k-mono">' + esc(r.reference) + '</span> · ' : '') + n(r.lines.length) + ' SKU · ' + n(r.total_confirmed || r.total_requested) + ' unit</span></span>' +
        '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div></div>';
  }

  /* ================= Buat draf ================= */

  async function newDraft() {
    const brands = (await API().get('/brands')).filter((b) => b.active);
    const box = document.createElement('div');
    box.className = 'k-stack';
    box.innerHTML = '<label class="k-field"><span class="k-field__label" ' + biAttr('Merek', 'Brand') + '></span><select class="k-select" id="rs-nb">' +
      brands.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('') + '</select></label><div id="rs-nl"></div>' +
      (S.atLeast('hq') ? '<label class="k-check"><input type="checkbox" id="rs-all"> <span ' + biAttr('Kiriman pertama: semua SKU merek ini, diisi sampai isi sampai', 'First delivery: every SKU of this brand, filled up to isi sampai') + '></span></label>' : '');
    const lines = $('#rs-nl', box);
    let alerts = [];
    const load = async () => {
      const bid = +$('#rs-nb', box).value;
      alerts = (await API().get('/replenishment/alerts' + API().qs({ site_id: S.siteId(), brand_id: bid }))).alerts;
      lines.innerHTML = alerts.length
        ? '<p class="k-caption" ' + biAttr('SKU yang sampai di angka pesan ulang:', 'SKUs at their reorder number:') + '></p>' +
          alerts.map((a) => '<label class="k-check"><input type="checkbox" data-sku="' + a.sku_id + '" data-q="' + a.qty_suggested + '"' + (a.open_reference ? '' : ' checked') + '> ' +
            esc(short(a.sku_name)) + ' · ' + n(a.qty_suggested) + (a.open_reference ? ' <span class="k-caption">(' + esc(t('sudah diminta', 'already asked')) + ')</span>' : '') + '</label>').join('')
        : '<p class="k-caption" ' + biAttr('Belum ada SKU di angka pesan ulang. Draf dibuat kosong: tambah SKU di draf.', 'No SKU is at its reorder number. Add SKUs in the draft.') + '></p>';
      S.applyLang(lines);
    };
    $('#rs-nb', box).addEventListener('change', load);
    await load();
    S.modal({
      title: ['Buat draf', 'New draft'], body: box,
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Buat draf', 'Create draft'], kind: 'primary', minRole: 'supervisor', onClick: async () => {
          const all = $('#rs-all', box) && $('#rs-all', box).checked;
          let ls = $$('input[data-sku]:checked', box).map((x) => ({ sku_id: +x.dataset.sku, qty_requested: +x.dataset.q }));
          if (!all && !ls.length) {
            const sk = await API().get('/skus' + API().qs({ brand_id: +$('#rs-nb', box).value, limit: 1 }));
            if (!sk.skus.length) { S.toast(['Merek ini belum punya SKU.', 'This brand has no SKU yet.'], 'caution'); return false; }
            ls = [{ sku_id: sk.skus[0].id, qty_requested: 1 }];
          }
          const r = await API().post('/replenishments', { site_id: S.siteId(), brand_id: +$('#rs-nb', box).value, lines: ls, fill_all: !!all });
          go({ id: r.id }, 'draft');
        },
      }],
    });
  }

  /* ================= 4a: draft and raised ================= */

  async function draftView(ctx, r) {
    const hq = S.atLeast('hq');
    const canEdit = r.status === 'draft' ? S.atLeast('supervisor') : hq;
    const rows = r.lines.map((l) => ({ sku_id: l.sku_id, name: l.sku_name, code: l.brand_sku_code, stock: l.stock_now, rp: l.restock_point, fill: l.fill_to, q: l.qty_requested }));
    const atPoint = rows.filter((x) => x.rp != null && x.stock != null && x.stock <= x.rp).length;
    const by = r.auto_created ? ['Dibuat WMS', 'Made by the WMS'] : ['Dibuat ' + who(r.created_by), 'Made by ' + who(r.created_by)];
    ctx.body.innerHTML = '<div class="k-card k-card--pad k-stack" id="rs-d">' +
      '<div class="rs-head"><div class="k-stack k-stack--tight"><div class="k-line"><span class="k-h2">' + esc(r.brand_name + ' · ' + S.shortCode(r.site_code) + ' ' + (r.site_name || '').replace(/^.*?(\b\w+)$/, '$1')) + '</span>' + statusPill(r.status) + '</div>' +
        '<span class="k-caption">' + p2(by[0] + ' ' + S.fmt.day(r.created_at) + ' ' + S.fmt.time(r.created_at), by[1] + ' ' + S.fmt.day(r.created_at) + ' ' + S.fmt.time(r.created_at)) +
          (atPoint ? ' · ' + p2(atPoint + ' SKU sampai di angka pesan ulang', atPoint + ' SKUs at their reorder number') : '') + ' · ' +
          (r.status === 'draft' ? p2('SPV dan Ops HQ bisa mengubah draf ini', 'The SPV and Ops HQ can change this draft')
            : p2('Diajukan ' + who(r.raised_by) + ' ' + S.fmt.time(r.raised_at) + '. Hanya Ops HQ yang bisa mengubah.', 'Raised by ' + who(r.raised_by) + ' ' + S.fmt.time(r.raised_at) + '. Only Ops HQ can change it.')) + '</span></div>' +
        '<div style="text-align:right">' + bis('Total diminta', 'Total requested', 'k-caption') + '<div class="rs-total" id="rs-tot"></div></div></div>' +
      (r.raise_note ? note('info', 'Catatan SPV: ' + r.raise_note, 'SPV note: ' + r.raise_note) : '') +
      '<div class="k-phone-only k-list" id="rs-cards"></div>' +
      '<div class="k-tablewrap k-laptop-only"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th class="k-num" ' + biAttr('Stok', 'Stock') + '></th>' +
        '<th class="k-num" ' + biAttr('Pesan ulang saat sisa', 'Reorder at') + '></th><th class="k-num" ' + biAttr('Isi sampai', 'Fill up to') + '></th>' +
        '<th class="k-num" ' + biAttr('Jumlah diminta', 'Quantity requested') + '></th><th></th></tr></thead><tbody id="rs-rows"></tbody></table></div>' +
      (canEdit ? '<div>' + btn('k-btn--secondary k-btn--sm', 'Tambah SKU', 'Add SKU', 'id="rs-add"', 'plus') + '</div>' : '') +
      (r.status === 'draft' ? '<label class="k-field"><span class="k-field__label" ' + biAttr('Catatan untuk Ops HQ', 'Note for Ops HQ') + '></span>' +
        '<textarea class="k-textarea" id="rs-note" rows="2"' + (canEdit ? '' : ' disabled') + '>' + esc(r.note || '') + '</textarea></label>' : '') +
      '<div class="k-actionbar">' +
        btn('k-btn--ghost', 'Batalkan draf', 'Cancel draft', 'id="rs-cancel" data-min-role="' + (r.status === 'draft' ? 'supervisor' : 'hq') + '"') +
        (canEdit ? btn('k-btn--secondary', 'Simpan', 'Save', 'id="rs-save"') : '') +
        (r.status === 'draft' ? btn(hq ? 'k-btn--secondary' : 'k-btn--primary', 'Ajukan ke Ops HQ', 'Raise to Ops HQ', 'id="rs-raise" data-min-role="supervisor"', 'arrow') : '') +
        btn('k-btn--primary', 'Buat permintaan restock', 'Make the restock request', 'id="rs-make" data-min-role="hq"', 'truck') + '</div></div>';
    const tbody = $('#rs-rows', ctx.body);
    const paint = () => {
      tbody.innerHTML = rows.map((x, i) => '<tr><td><div class="k-cell2"><span class="k-cell2__main">' + esc(x.name) + '</span><span class="k-cell2__sub k-mono">' + esc(x.code || '') + '</span></div></td>' +
        '<td class="k-num"' + (x.rp != null && x.stock != null && x.stock <= x.rp ? ' style="color:var(--caution)"' : '') + '>' + n(x.stock) + '</td><td class="k-num">' + n(x.rp) + '</td><td class="k-num">' + n(x.fill) + '</td>' +
        '<td class="k-num"><input class="k-input k-input--sm k-input--num rs-qty" type="number" min="0" inputmode="numeric" data-i="' + i + '" value="' + x.q + '"' + (canEdit ? '' : ' disabled') +
          ' aria-label="' + esc(t('Jumlah diminta, ', 'Quantity requested, ') + short(x.name)) + '"></td>' +
        '<td class="k-table__actions">' + (canEdit ? '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-del="' + i + '" aria-label="' + esc(t('Hapus', 'Remove')) + '">' + icon('trash', 18) + '</button>' : '') + '</td></tr>').join('');
      $('#rs-tot', ctx.body).textContent = n(rows.reduce((a, x) => a + (+x.q || 0), 0)) + ' unit';
      $('#rs-cards', ctx.body).innerHTML = rows.map((x, i) => '<div class="k-row" style="flex-wrap:wrap"><span class="k-row__text"><span class="k-row__title">' + esc(short(x.name)) + '</span>' +
        '<span class="k-row__sub">' + esc(t('Stok ', 'Stock ') + n(x.stock) + t(' · pesan ulang ', ' · reorder at ') + n(x.rp) + t(' · isi sampai ', ' · fill to ') + n(x.fill)) + '</span></span>' +
        '<input class="k-input k-input--sm k-input--num rs-qty" type="number" min="0" inputmode="numeric" data-i="' + i + '" value="' + x.q + '"' + (canEdit ? '' : ' disabled') +
          ' aria-label="' + esc(t('Jumlah diminta, ', 'Quantity requested, ') + short(x.name)) + '">' +
        (canEdit ? '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-del="' + i + '" aria-label="' + esc(t('Hapus', 'Remove')) + '">' + icon('trash', 18) + '</button>' : '') + '</div>').join('');
      $$('#rs-d .rs-qty', ctx.body).forEach((inp) => inp.addEventListener('input', () => {
        rows[+inp.dataset.i].q = Math.max(0, parseInt(inp.value, 10) || 0);
        $$('#rs-d .rs-qty[data-i="' + inp.dataset.i + '"]', ctx.body).forEach((o) => { if (o !== inp) o.value = inp.value; });
        $('#rs-tot', ctx.body).textContent = n(rows.reduce((a, x) => a + (+x.q || 0), 0)) + ' unit';
      }));
      $$('#rs-d [data-del]', ctx.body).forEach((b) => b.addEventListener('click', () => { rows.splice(+b.dataset.del, 1); paint(); }));
    };
    paint();
    const save = async () => {
      const ls = rows.filter((x) => x.q > 0).map((x) => ({ sku_id: x.sku_id, qty_requested: x.q }));
      const noteEl = $('#rs-note', ctx.body);
      return API().put('/replenishments/' + r.id + '/lines', { lines: ls, note: noteEl ? noteEl.value : null });
    };
    const add = $('#rs-add', ctx.body);
    if (add) add.addEventListener('click', async () => {
      const sk = await API().get('/skus' + API().qs({ brand_id: r.brand_id, limit: 300 }));
      const have = new Set(rows.map((x) => x.sku_id));
      const opts = sk.skus.filter((s) => !have.has(s.id) && s.active !== false);
      const box = document.createElement('div');
      box.className = 'k-stack';
      box.innerHTML = '<label class="k-field"><span class="k-field__label" ' + biAttr('Produk', 'Product') + '></span><select class="k-select" id="rs-as">' +
        opts.map((s) => '<option value="' + s.id + '">' + esc(s.name_display) + '</option>').join('') + '</select></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Jumlah diminta', 'Quantity requested') + '></span><input class="k-input k-input--num" type="number" min="1" id="rs-aq" value="1"></label>';
      S.modal({
        title: ['Tambah SKU', 'Add SKU'], body: box,
        actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, { label: ['Tambah', 'Add'], kind: 'primary', onClick: () => {
          const s = opts.find((o) => o.id === +$('#rs-as', box).value);
          if (!s) return false;
          rows.push({ sku_id: s.id, name: s.name_display, code: s.brand_sku_code, stock: null, rp: null, fill: null, q: Math.max(1, +$('#rs-aq', box).value || 1) });
          paint();
        } }],
      });
    });
    const sv = $('#rs-save', ctx.body);
    if (sv) sv.addEventListener('click', async () => { try { await save(); S.toast(['Draf disimpan.', 'Draft saved.'], 'ok'); S.rerender(); } catch (e) { S.fail(e); } });
    const rz = $('#rs-raise', ctx.body);
    if (rz) rz.addEventListener('click', async () => {
      try {
        await save();
        await API().post('/replenishments/' + r.id + '/raise', { note: $('#rs-note', ctx.body) ? $('#rs-note', ctx.body).value : null });
        S.toast(['Diajukan ke Ops HQ.', 'Raised to Ops HQ.'], 'ok');
        go({ id: r.id }, 'raised');
      } catch (e) { S.fail(e); }
    });
    $('#rs-make', ctx.body).addEventListener('click', async () => {
      try { if (canEdit) await save(); go({ id: r.id, make: 1 }, TAB_OF[r.status]); } catch (e) { S.fail(e); }
    });
    $('#rs-cancel', ctx.body).addEventListener('click', async () => {
      if (!(await S.confirm({ title: ['Batalkan draf?', 'Cancel the draft?'], text: ['Draf ini tidak dikirim ke merek.', 'This draft is not sent to the brand.'], ok: ['Batalkan', 'Cancel it'], danger: true }))) return;
      try { await API().post('/replenishments/' + r.id + '/cancel', {}); go({}, TAB_OF[r.status]); } catch (e) { S.fail(e); }
    });
  }

  /* ================= 4b: Buat permintaan restock ================= */

  async function makeView(ctx, r) {
    const d = await API().get('/replenishments/' + r.id + '/po-header');
    const h = d.header;
    S.setTitle('Buat permintaan restock', 'Make the restock request');
    S.setSub('Tanpa No. PO: merek memberi No. PO-nya saat konfirmasi. Jumlah terkunci setelah disimpan.', 'No PO number: the brand gives its PO number when it confirms. Quantities lock once saved.');
    const back = '<a class="k-linkbtn" href="?tab=' + TAB_OF[r.status] + '&id=' + r.id + '">' + p2('Restock ke merek', 'Restock from brand') + '</a> / ' +
      p2(STATUS[r.status][0], STATUS[r.status][1]) + ' / ' + esc(r.brand_name + ' ' + S.shortCode(r.site_code)) +
      (r.raised_by ? ' · ' + p2('diajukan ' + who(r.raised_by) + ' ' + S.fmt.time(r.raised_at), 'raised by ' + who(r.raised_by) + ' ' + S.fmt.time(r.raised_at)) : '');
    const field = (k, id, en, type, val, attrs) => '<label class="k-field"><span class="k-field__label">' + p2(id, en) + '</span>' +
      '<input class="k-input" data-h="' + k + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"' + (attrs || '') + '></label>';
    const lines = d.lines.map((l) => Object.assign({}, l));
    ctx.actions.innerHTML = btn('k-btn--primary', 'Simpan permintaan', 'Save the request', 'id="rs-savereq" data-min-role="hq"', 'check');
    ctx.body.innerHTML = '<div class="k-caption">' + back + '</div>' +
      '<div class="k-card k-card--pad k-stack">' +
        '<label class="k-field"><span class="k-field__label">' + p2('Ninja reference · internal, dibuat WMS', 'Ninja reference · internal, made by the WMS') + '</span>' +
          '<input class="k-input k-mono" value="' + esc(d.reference_preview) + '" readonly></label>' +
        '<div class="rs-form">' +
          field('po_date', 'PO date', 'PO date', 'date', h.po_date) + field('po_to', 'To (brand)', 'To (brand)', 'text', h.po_to) +
          field('po_brand_contact', 'Brand contact', 'Brand contact', 'text', h.po_brand_contact) + field('po_deliver_to', 'Deliver to', 'Deliver to', 'text', h.po_deliver_to) +
          field('po_requested_date', 'Requested delivery date', 'Requested delivery date', 'date', h.po_requested_date) +
          field('po_receiving_hours', 'Jam terima', 'Receiving hours', 'text', h.po_receiving_hours) +
          field('po_created_by_name', 'Created by (Ops HQ)', 'Created by (Ops HQ)', 'text', h.po_created_by_name) + field('po_note', 'Note', 'Note', 'text', h.po_note) +
        '</div></div>' +
      '<div class="k-card k-card--pad k-stack"><div class="rs-head"><span class="k-h2" id="rs-sum"></span><span class="k-caption" ' +
        biAttr(d.saved ? 'Jumlah terkunci.' : 'Jumlah awal = isi sampai dikurangi stok, atau dari draf.', d.saved ? 'Quantities are locked.' : 'Start = fill up to minus stock, or from the draft.') + '></span></div>' +
        '<div class="k-tablewrap"><table class="k-table"><thead><tr><th>No</th><th ' + biAttr('Produk', 'Product') + '></th><th ' + biAttr('Kode merek', 'Brand code') + '></th>' +
          '<th>Barcode (EAN-13)</th><th class="k-num" ' + biAttr('Stok', 'Stock') + '></th><th class="k-num" ' + biAttr('Isi sampai', 'Fill up to') + '></th><th class="k-num" ' + biAttr('Jumlah', 'Quantity') + '></th></tr></thead><tbody>' +
          lines.map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(l.sku_name) + '</td><td class="k-mono">' + esc(l.brand_sku_code || '') + '</td>' +
            '<td class="k-mono">' + (l.barcode ? esc(l.barcode) : '<span class="rs-missing">MISSING</span> <span class="k-caption" ' + biAttr('diisi merek', 'brand fills') + '></span>') + '</td>' +
            '<td class="k-num">' + n(l.current_stock) + '</td><td class="k-num">' + n(l.fill_to) + '</td>' +
            '<td class="k-num"><input class="k-input k-input--sm k-input--num rs-qty" type="number" min="0" data-i="' + i + '" value="' + (l.qty_requested || 0) + '"' + (d.saved ? ' disabled' : '') +
              ' aria-label="' + esc(t('Jumlah, ', 'Quantity, ') + short(l.sku_name)) + '"></td></tr>').join('') +
        '</tbody></table></div></div>' +
      '<div class="k-actionbar k-phone-only">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Simpan permintaan', 'Save the request', 'id="rs-savereq2" data-min-role="hq"', 'check') + '</div>';
    const sum = () => { $('#rs-sum', ctx.body).innerHTML = p2('Isi permintaan · ' + lines.length + ' SKU · ' + n(lines.reduce((a, l) => a + (+l.qty_requested || 0), 0)) + ' unit', 'Request lines · ' + lines.length + ' SKU · ' + n(lines.reduce((a, l) => a + (+l.qty_requested || 0), 0)) + ' units'); };
    sum();
    $$('.rs-qty', ctx.body).forEach((inp) => inp.addEventListener('input', () => { lines[+inp.dataset.i].qty_requested = Math.max(0, parseInt(inp.value, 10) || 0); sum(); }));
    const save = async () => {
      const body = { lines: lines.map((l) => ({ sku_id: l.sku_id, qty_requested: l.qty_requested, note: l.note })) };
      $$('[data-h]', ctx.body).forEach((x) => { body[x.dataset.h] = x.value || null; });
      try {
        const res = await API().put('/replenishments/' + r.id + '/po', body);
        S.toast(['Permintaan ' + res.reference + ' disimpan.', 'Request ' + res.reference + ' saved.'], 'ok');
        go({ id: r.id }, 'po');
      } catch (e) { S.fail(e); }
    };
    ['#rs-savereq', '#rs-savereq2'].forEach((s) => { const b = $(s, ctx.body) || $(s, ctx.actions); if (b) b.addEventListener('click', save); });
  }

  /* ================= po, sent (4c, 4d), confirmed ================= */

  function infoHtml(r) {
    const h = r.header || {};
    const items = [
      ['Kepada', 'To', (h.po_to || r.brand_name) + (h.po_brand_contact ? ' · ' + h.po_brand_contact : '')],
      ['Dikirim ke', 'Deliver to', (h.po_deliver_to || S.shortCode(r.site_code)) + (h.po_receiving_hours ? ' · terima ' + h.po_receiving_hours : '')],
      ['Tanggal kirim yang diminta', 'Requested delivery date', h.po_requested_date ? S.fmt.day(h.po_requested_date) + ' ' + h.po_requested_date.slice(0, 4) : '-'],
    ];
    if (r.sent_at) items.push(['Terkirim ke merek', 'Sent to the brand', S.fmt.day(r.sent_at) + ' ' + S.fmt.time(r.sent_at) + ' · ' + who(r.sent_by)]);
    if (r.brand_po_number) items.push(['No. PO merek', 'Brand PO number', r.brand_po_number]);
    if (r.eta_date) items.push(['Perkiraan tiba', 'Expected arrival', S.fmt.day(r.eta_date)]);
    return '<dl class="rs-info">' + items.map((x) => '<div><dt ' + biAttr(x[0], x[1]) + '></dt><dd>' + esc(x[2]) + '</dd></div>').join('') + '</dl>';
  }

  function requestView(ctx, r) {
    const hq = S.atLeast('hq');
    const conf = ['confirmed', 'receiving', 'received', 'variance_signoff', 'variance_review'].includes(r.status);
    const recv = ['receiving', 'received', 'variance_signoff', 'variance_review'].includes(r.status);
    ctx.body.innerHTML = '<div class="k-caption"><a class="k-linkbtn" href="?tab=' + TAB_OF[r.status] + '">' + p2('Restock ke merek', 'Restock from brand') + '</a> / ' + p2(STATUS[r.status][0], STATUS[r.status][1]) + ' / Ninja reference</div>' +
      '<div class="k-card k-card--pad k-stack"><div class="rs-head"><div class="k-stack k-stack--tight"><span class="rs-ref">' + esc(r.reference) + '</span>' +
        '<span class="k-caption">' + esc(r.brand_name + ' · ' + S.shortCode(r.site_code)) + '</span></div>' + statusPill(r.status) + '</div>' + infoHtml(r) +
        '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th>Barcode</th><th class="k-num" ' + biAttr('Diminta', 'Requested') + '></th>' +
          (conf ? '<th class="k-num" ' + biAttr('Dikirim merek', 'Brand sends') + '></th>' : '') + (recv ? '<th class="k-num" ' + biAttr('Diterima', 'Received') + '></th>' : '') +
          (r.status === 'received' ? '<th class="k-num" ' + biAttr('Ditagih', 'Billed') + '></th>' : '') + '</tr></thead><tbody>' +
          r.lines.map((l) => '<tr><td>' + esc(l.sku_name) + '</td><td class="k-mono">' + (l.barcode || l.brand_barcode ? esc(l.barcode || l.brand_barcode) : '<span class="rs-missing">MISSING</span>') + '</td>' +
            '<td class="k-num">' + n(l.qty_requested) + '</td>' + (conf ? '<td class="k-num">' + n(l.qty_confirmed) + '</td>' : '') +
            (recv ? '<td class="k-num">' + n(l.qty_received) + '</td>' : '') + (r.status === 'received' ? '<td class="k-num">' + n(l.qty_billed) + '</td>' : '') + '</tr>').join('') +
        '</tbody></table></div>' +
        (r.status === 'received' && r.total_billed != null ? '<div class="rs-foot"><span>' + p2('Total ditagih merek', 'Total billed by the brand') + '</span><span class="rs-total">' + n(r.total_billed) + ' unit</span></div>' : '') +
        (r.brand_claim_note ? note('info', 'Catatan untuk merek: ' + r.brand_claim_note, 'Note for the brand: ' + r.brand_claim_note) : '') +
        (conf && r.brand_po_number && !recv ? note('ok', 'Staf bisa menerima kiriman ini dengan ' + r.reference + ' atau ' + r.brand_po_number + '.', 'Staff can receive this delivery with ' + r.reference + ' or ' + r.brand_po_number + '.', 'check') : '') +
        '<div class="k-actionbar">' +
          (r.status === 'po' || r.status === 'sent' || r.status === 'confirmed' ? btn('k-btn--ghost', 'Batalkan', 'Cancel', 'id="rs-cancel" data-min-role="hq"') : '') +
          (r.status === 'po' ? btn('k-btn--secondary', 'Ubah header', 'Edit header', 'id="rs-edit" data-min-role="hq"', 'edit') : '') +
          '<a class="k-btn k-btn--secondary" href="' + xlsx(r.id) + '" data-min-role="hq">' + icon('download', 20, 2.2) + p2('Unduh permintaan (Excel)', 'Download the request (Excel)') + '</a>' +
          (r.status === 'po' ? btn('k-btn--primary', 'Tandai terkirim', 'Mark sent', 'id="rs-sent" data-min-role="hq"', 'check') : '') +
          (r.status === 'sent' || r.status === 'confirmed' ? btn(r.status === 'sent' ? 'k-btn--primary' : 'k-btn--secondary', r.status === 'sent' ? 'Catat konfirmasi merek' : 'Ubah konfirmasi merek',
            r.status === 'sent' ? 'Record the brand confirmation' : 'Change the brand confirmation', 'id="rs-conf" data-min-role="hq"', 'edit') : '') +
          (DIFF.has(r.status) ? btn('k-btn--primary', 'Selesaikan selisih', 'Settle differences', 'id="rs-diff"', 'arrow') : '') +
        '</div></div>';
    const on = (id, fn) => { const b = $(id, ctx.body); if (b) b.addEventListener('click', fn); };
    on('#rs-edit', () => go({ id: r.id, make: 1 }, 'po'));
    on('#rs-sent', async () => {
      if (!(await S.confirm({ title: ['Tandai terkirim?', 'Mark sent?'], text: ['Excel sudah dikirim lewat email ke merek.', 'The Excel has been emailed to the brand.'], ok: ['Tandai terkirim', 'Mark sent'] }))) return;
      try { await API().post('/replenishments/' + r.id + '/send', {}); go({ id: r.id }, 'sent'); } catch (e) { S.fail(e); }
    });
    on('#rs-conf', () => confirmDrawer(r));
    on('#rs-diff', () => go({ id: r.id }, 'selisih'));
    on('#rs-cancel', async () => {
      if (!(await S.confirm({ title: ['Batalkan permintaan?', 'Cancel the request?'], text: ['Beri tahu merek bahwa permintaan ini batal.', 'Tell the brand this request is cancelled.'], ok: ['Batalkan', 'Cancel it'], danger: true }))) return;
      try { await API().post('/replenishments/' + r.id + '/cancel', {}); go({}, TAB_OF[r.status]); } catch (e) { S.fail(e); }
    });
    void hq;
  }
  const DIFF = new Set(['variance_signoff', 'variance_review']);

  function confirmDrawer(r) {
    const box = document.createElement('div');
    box.className = 'k-stack';
    box.innerHTML = '<p class="k-caption" ' + biAttr('Isi dari email balasan merek. Jumlah sudah terisi dari permintaan, ubah yang beda.', 'Fill in from the brand\'s reply. Quantities start from the request: change what differs.') + '></p>' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('No. PO merek', 'Brand PO number') + '></span><input class="k-input k-mono" id="rs-bpo" value="' + esc(r.brand_po_number || '') + '" placeholder="PO/PRG/2610/0457"></label>' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('Perkiraan tiba', 'Expected arrival') + '></span><input class="k-input" type="date" id="rs-eta" value="' + esc(r.eta_date || (r.header && r.header.po_requested_date) || '') + '"></label>' +
      '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th class="k-num" ' + biAttr('Dikirim merek', 'Brand sends') + '></th><th class="k-num" ' + biAttr('Minta', 'Asked') + '></th></tr></thead><tbody>' +
        r.lines.map((l, i) => '<tr><td>' + esc(short(l.sku_name)) +
          (!l.barcode ? '<label class="k-field" style="margin-top:6px"><span class="k-field__label" ' + biAttr('Barcode dari merek', 'Barcode from the brand') + '></span><input class="k-input k-input--sm k-mono" data-bc="' + i + '" value="' + esc(l.brand_barcode || '') + '"></label>' : '') + '</td>' +
          '<td class="k-num"><input class="k-input k-input--sm k-input--num rs-qty" type="number" min="0" data-c="' + i + '" value="' + (l.qty_confirmed != null ? l.qty_confirmed : l.qty_requested) + '"></td>' +
          '<td class="k-num">' + n(l.qty_requested) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="rs-foot"><span>' + p2('Total dikirim merek', 'Total the brand sends') + '</span><span class="rs-total" id="rs-ctot"></span></div>' +
      '<span class="k-caption">' + p2('No. PO merek lain bisa sama, jadi WMS selalu menyimpannya bersama mereknya (' + r.brand_name + '). Setelah disimpan, staf bisa menerima kiriman ini dengan ' + r.reference + ' atau No. PO merek.',
        'Another brand may use the same PO number, so the WMS always stores it with the brand (' + r.brand_name + '). Once saved, staff can receive this delivery with ' + r.reference + ' or the brand PO number.') + '</span>';
    const tot = () => { $('#rs-ctot', box).textContent = n($$('[data-c]', box).reduce((a, x) => a + (parseInt(x.value, 10) || 0), 0)) + ' unit'; };
    $$('[data-c]', box).forEach((x) => x.addEventListener('input', tot));
    tot();
    S.drawer({
      title: ['Catat konfirmasi merek', 'Record the brand confirmation'], body: box,
      actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Simpan', 'Save'], kind: 'primary', minRole: 'hq', onClick: async () => {
          const lines = r.lines.map((l, i) => ({ sku_id: l.sku_id, qty_confirmed: Math.max(0, parseInt($('[data-c="' + i + '"]', box).value, 10) || 0), brand_barcode: $('[data-bc="' + i + '"]', box) ? $('[data-bc="' + i + '"]', box).value.trim() || null : null }));
          await API().post('/replenishments/' + r.id + '/confirm', { brand_po_number: $('#rs-bpo', box).value.trim(), eta_date: $('#rs-eta', box).value || null, lines });
          S.toast(['Konfirmasi merek disimpan.', 'Brand confirmation saved.'], 'ok');
          go({ id: r.id }, 'confirmed');
        },
      }],
    });
  }

  /* ================= 4e: Selesaikan selisih ================= */

  async function diffView(ctx, r) {
    const D = await API().get('/replenishments/' + r.id + '/differences');
    const hq = S.atLeast('hq') && S.role() !== 'ops_head';
    S.setTitle('Selesaikan selisih', 'Settle differences');
    S.setSub('Ops HQ menyetujui setiap selisih. Ops Head hanya diberi tahu.', 'Ops HQ approves every difference. The Ops Head is only notified.');
    const pick = {};          // row id -> 'approve' | 'accept' | 'reject'
    D.rows.forEach((x) => { if (x.status === 'pending' && x.kind === 'extra') pick[x.id] = null; });
    const billed = {};
    D.lines.forEach((l) => { billed[l.sku_id] = l.qty_billed != null ? l.qty_billed : l.qty_billed_default; });
    const firstRow = {};
    D.rows.forEach((x) => { if (!(x.sku_id in firstRow)) firstRow[x.sku_id] = x.id; });
    const matched = D.lines.filter((l) => l.matched);
    const nSku = new Set(D.rows.map((x) => x.sku_id)).size;
    const due = D.decide_by ? S.fmt.day(D.decide_by) + ' ' + S.fmt.time(D.decide_by) : null;
    const nExtra = D.rows.filter((x) => x.kind === 'extra' && x.decision !== 'accept').reduce((a, x) => a + x.qty, 0);
    const nDmg = D.rows.filter((x) => x.kind === 'damaged').reduce((a, x) => a + x.qty, 0);
    const where = (x) => x.kind === 'short' ? ['Tidak datang dari merek', 'Did not come from the brand']
      : x.kind === 'extra' ? ['Di bin sementara ' + (x.bin_code || '') + ', belum dijual', 'In temporary bin ' + (x.bin_code || '') + ', not sellable']
        : x.place === 'quarantine' ? ['Rusak, di karantina ' + (x.bin_code || '') + ' · ' + x.photos + ' foto', 'Damaged, in quarantine ' + (x.bin_code || '') + ' · ' + x.photos + ' photo']
          : ['Rusak, kembali ke driver (Surat Jalan) · ' + x.photos + ' foto', 'Damaged, back to the driver (Surat Jalan) · ' + x.photos + ' photo'];
    const qtyWords = (x) => x.kind === 'short' ? [x.qty + ' kurang', x.qty + ' short'] : x.kind === 'extra' ? [x.qty + ' lebih', x.qty + ' extra'] : [x.qty + ' ditolak', x.qty + ' rejected'];
    const decided = (x) => x.kind === 'short' ? ['Disetujui: tagih ' + (billed[x.sku_id] != null ? billed[x.sku_id] : ''), 'Approved: bill ' + (billed[x.sku_id] != null ? billed[x.sku_id] : '')]
      : x.decision === 'reject' ? ['Disetujui: ditolak, retur ke merek', 'Approved: rejected, return to the brand'] : x.decision === 'accept' ? ['Disetujui: diterima, taruh di rak', 'Approved: accepted, put on the rack'] : ['Disetujui', 'Approved'];
    const suggestion = () => {
      const bits = [];
      D.rows.filter((x) => x.kind === 'short').forEach((x) => bits.push(short(x.sku_name) + ' ditagih ' + billed[x.sku_id] + '.'));
      D.rows.filter((x) => x.kind === 'extra').forEach((x) => bits.push('Kelebihan ' + x.qty + ' ' + short(x.sku_name) + ' kami ' + ((pick[x.id] || x.decision) === 'accept' ? 'terima.' : 'tolak.')));
      if (nDmg) bits.push(nDmg + ' unit rusak ditolak saat diterima (foto terlampir).');
      if (bits.length) bits.push('Mohon Faktur revisi.');
      return bits.join(' ');
    };

    ctx.body.innerHTML = '<div class="k-caption"><a class="k-linkbtn" href="?tab=selisih">' + p2('Restock ke merek', 'Restock from brand') + '</a> / ' + p2('Selisih', 'Differences') + '</div>' +
      '<div class="k-stack k-stack--tight"><div class="k-line">' + '<span class="k-pill k-pill--caution k-pill--lg">' + p2('Selisih · ' + nSku + ' SKU', 'Differences · ' + nSku + ' SKU') + '</span>' +
        (due && D.rows.some((x) => x.status === 'pending') ? '<span class="rs-chip-due' + (D.overdue ? ' is-late' : '') + '">' + icon('clock', 16) + p2('Putuskan sebelum ' + due, 'Decide before ' + due) + '</span>' : '') +
        '<span class="k-chip k-chip--head">' + icon('bell', 14) + p2('Ops Head diberi tahu', 'Ops Head notified') + '</span></div>' +
        (D.rows.some((x) => x.status === 'pending') ? '<span class="k-caption" ' + biAttr('Lewat 24 jam: baris kuning di Perlu tindakan, Ops Head diberi peringatan. Tidak diputuskan otomatis.', 'After 24 hours: an amber row on To do and an alert to the Ops Head. Nothing is decided automatically.') + '></span>' : '') +
        '<span>' + '<span class="k-mono k-strong">' + esc(D.reference) + '</span> · ' + esc(D.brand_name) + (D.brand_po_number ? ' · ' + p2('No. PO merek', 'Brand PO') + ' <span class="k-mono">' + esc(D.brand_po_number) + '</span>' : '') + ' · ' +
          p2('Ops HQ menyetujui tiap selisih dalam 24 jam setelah barang diterima.', 'Ops HQ approves each difference within 24 hours of receiving.') + '</span>' +
        '<span class="k-caption">' + p2('Diterima ' + (D.received_by || '-') + (D.sj_signed_by ? ', ditandatangani ' + D.sj_signed_by : '') + (D.faktur_uploaded_at ? ', Faktur diunggah ' + S.fmt.dt(D.faktur_uploaded_at) : ', Faktur belum diunggah'),
          'Received by ' + (D.received_by || '-') + (D.sj_signed_by ? ', signed by ' + D.sj_signed_by : '') + (D.faktur_uploaded_at ? ', Faktur uploaded ' + S.fmt.dt(D.faktur_uploaded_at) : ', Faktur not uploaded yet')) + '</span>' +
        '<div class="k-line">' + btn('k-btn--secondary k-btn--sm', 'Faktur (' + D.faktur_pages + ' hal.)', 'Faktur (' + D.faktur_pages + ' p.)', 'id="rs-fk"' + (D.faktur_pages ? '' : ' disabled'), 'eye') +
          btn('k-btn--secondary k-btn--sm', D.receipt_photos + ' foto penerimaan', D.receipt_photos + ' receiving photos', 'data-ph="receipt"' + (D.receipt_photos ? '' : ' disabled'), 'camera') +
          btn('k-btn--secondary k-btn--sm', D.damage_photos + ' foto kerusakan', D.damage_photos + ' damage photos', 'data-ph="damage"' + (D.damage_photos ? '' : ' disabled'), 'camera') + '</div></div>' +
      '<div class="k-card k-card--pad k-stack"><div class="rs-head"><div class="k-stack k-stack--tight">' + bis('Semua selisih kiriman ini', 'Every difference of this delivery', 'k-h2') +
        bis('Kurang, lebih, dan ditolak saat inbound (rusak). Baru masuk stok dan tagihan setelah disetujui.', 'Short, extra, and rejected at inbound (damaged). They reach stock and billing only once approved.', 'k-caption') + '</div>' +
        '<span class="k-strong" id="rs-appr"></span></div>' +
        '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk · keterangan', 'Product · detail') + '></th><th ' + biAttr('Selisih', 'Difference') + '></th>' +
          '<th class="k-num" ' + biAttr('Diminta', 'Requested') + '></th><th class="k-num" ' + biAttr('Datang', 'Arrived') + '></th><th ' + biAttr('Keputusan Ops HQ', 'Ops HQ decision') + '></th>' +
          '<th class="k-num" ' + biAttr('Ditagih', 'Billed') + '></th></tr></thead><tbody id="rs-drows"></tbody></table></div>' +
        (matched.length ? (() => { const list = matched.map((l) => short(l.sku_name) + ' ' + l.qty_received).join(', ');
          return '<span class="k-caption">' + p2(matched.length + ' SKU lain cocok: ' + list + '. Ditagih = diterima.', matched.length + ' other SKUs match: ' + list + '. Billed = received.') + '</span>'; })() : '') +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Catatan untuk merek (dikirim lewat email)', 'Note for the brand (sent by email)') + '></span>' +
          '<textarea class="k-textarea" id="rs-bnote" rows="3"' + (hq ? '' : ' disabled') + '>' + esc(D.brand_claim_note || '') + '</textarea></label>' +
        note('info', 'Setelah disetujui, WMS mencatat selisih ke stok dan tagihan secara otomatis. Lalu SPV dan staf dapat tugas di Perlu tindakan: Retur ke merek, atau Taruh di rak.',
          'Once approved, the WMS records the difference in stock and billing by itself. Then the SPV and staff get a task on To do: Return to the brand, or Put on the rack.') +
        '<div class="rs-foot"><div class="k-stack k-stack--tight"><span>' + p2('Total ditagih merek', 'Total billed by the brand') + ' <span class="rs-total" id="rs-btot"></span></span>' +
          '<span class="k-caption">' + p2('Diminta ' + n(D.total_requested) + ' · datang ' + n(D.total_received) + ' · ditolak ' + (nExtra + nDmg) + ' (' + nExtra + ' lebih, ' + nDmg + ' rusak)',
            'Requested ' + n(D.total_requested) + ' · arrived ' + n(D.total_received) + ' · rejected ' + (nExtra + nDmg) + ' (' + nExtra + ' extra, ' + nDmg + ' damaged)') + '</span></div>' +
          btn('k-btn--primary', 'Simpan keputusan', 'Save decisions', 'id="rs-dsave" data-min-role="hq"', 'check') + '</div></div>';

    const tb = $('#rs-drows', ctx.body);
    const totals = () => {
      const tot = D.lines.reduce((a, l) => a + (+billed[l.sku_id] || 0), 0);
      $('#rs-btot', ctx.body).textContent = n(tot) + ' unit';
      const appr = D.rows.filter((x) => x.status === 'approved' || pick[x.id]).length;
      $('#rs-appr', ctx.body).innerHTML = p2('Disetujui: ' + appr + ' dari ' + D.rows.length, 'Approved: ' + appr + ' of ' + D.rows.length);
    };
    const paint = () => {
      tb.innerHTML = D.rows.map((x) => {
        const w = where(x), q = qtyWords(x);
        const line = D.lines.find((l) => l.sku_id === x.sku_id) || {};
        let dec;
        if (x.status === 'approved') dec = '<span class="k-strong" style="color:var(--ok)">' + icon('check', 16, 2.6) + p2(decided(x)[0], decided(x)[1]) + '</span>';
        else if (x.kind === 'extra') dec = '<div class="rs-dec">' + btn('k-btn--secondary k-btn--sm', 'Tolak kelebihan', 'Reject the extra', 'data-pick="' + x.id + '" data-v="reject" aria-pressed="' + (pick[x.id] === 'reject') + '"' + (hq ? '' : ' disabled')) +
          btn('k-btn--secondary k-btn--sm', 'Terima', 'Accept', 'data-pick="' + x.id + '" data-v="accept" aria-pressed="' + (pick[x.id] === 'accept') + '"' + (hq ? '' : ' disabled')) + '</div>';
        else dec = btn('k-btn--secondary k-btn--sm', 'Setujui', 'Approve', 'data-pick="' + x.id + '" data-v="approve" aria-pressed="' + (pick[x.id] === 'approve') + '"' + (hq ? '' : ' disabled'));
        return '<tr' + (x.status === 'pending' ? (x.overdue ? ' class="is-caution"' : '') : '') + '><td><div class="k-cell2"><span class="k-cell2__main">' + esc(short(x.sku_name)) + '</span>' +
          '<span class="k-cell2__sub">' + p2(w[0], w[1]) + (x.status === 'pending' ? ' ' + S.pill('caution', 'Menunggu persetujuan Ops HQ', 'Waiting for Ops HQ approval') : '') + '</span></div></td>' +
          '<td class="k-strong rs-nw"' + (x.kind === 'damaged' ? ' style="color:var(--stop)"' : ' style="color:var(--caution)"') + '>' + p2(q[0], q[1]) + '</td>' +
          '<td class="k-num">' + n(x.qty_requested) + '</td><td class="k-num">' + n(x.qty_received) + '</td><td>' + dec + '</td>' +
          '<td class="k-num">' + (firstRow[x.sku_id] === x.id ? '<input class="k-input k-input--sm k-input--num rs-qty" type="number" min="0" data-b="' + x.sku_id + '" value="' + (billed[x.sku_id] != null ? billed[x.sku_id] : '') + '"' +
            (hq && D.status !== 'received' ? '' : ' disabled') + ' aria-label="' + esc(t('Ditagih, ', 'Billed, ') + short(x.sku_name)) + '">' : '') + '<span hidden>' + esc(String(line.qty_billed_default)) + '</span></td></tr>';
      }).join('');
      $$('[data-pick]', tb).forEach((b) => b.addEventListener('click', () => {
        const id = +b.dataset.pick;
        pick[id] = pick[id] === b.dataset.v ? null : b.dataset.v;
        const x = D.rows.find((y) => y.id === id);
        if (x && x.kind === 'extra') {
          const line = D.lines.find((l) => l.sku_id === x.sku_id);
          if (line && line.qty_billed == null) billed[x.sku_id] = line.qty_billed_default + (pick[id] === 'accept' ? x.qty : 0);
        }
        paint();
      }));
      $$('[data-b]', tb).forEach((inp) => inp.addEventListener('input', () => { billed[+inp.dataset.b] = Math.max(0, parseInt(inp.value, 10) || 0); totals(); }));
      totals();
    };
    paint();
    const noteEl = $('#rs-bnote', ctx.body);
    if (hq && !noteEl.value) noteEl.value = suggestion();
    $('#rs-dsave', ctx.body).addEventListener('click', async () => {
      const rows = Object.entries(pick).filter(([, v]) => v).map(([id, v]) => ({ id: +id, approve: true, decision: v === 'approve' ? null : v }));
      const bl = D.lines.filter((l) => !l.matched).map((l) => ({ sku_id: l.sku_id, qty_billed: +billed[l.sku_id] || 0 }));
      try {
        const res = await API().post('/replenishments/' + r.id + '/differences/decide', { rows, billed: bl, note_for_brand: noteEl.value });
        S.toast(res.status === 'received' ? ['Semua selisih disetujui. Permintaan ditutup.', 'Every difference approved. The request is closed.'] : ['Keputusan disimpan.', 'Decisions saved.'], 'ok');
        if (res.status === 'received') go({ id: r.id }, 'selesai'); else S.rerender();
      } catch (e) { S.fail(e); }
    });
    const fk = $('#rs-fk', ctx.body);
    if (fk) fk.addEventListener('click', () => S.drawer({
      title: ['Faktur', 'Faktur'],
      body: '<div class="k-stack">' + r.faktur_pages.map((p) => '<a class="k-btn k-btn--secondary" target="_blank" rel="noopener" href="' + esc('..' + p.url) + '">' + icon('eye', 18) + esc(t('Hal. ', 'Page ') + p.page_no) + '</a>').join('') + '</div>',
    }));
    $$('[data-ph]', ctx.body).forEach((b) => b.addEventListener('click', async () => {
      if (!D.receipt_id) return;
      const ph = (await API().get('/inbound/receipts/' + D.receipt_id + '/photos')).filter((p) => (b.dataset.ph === 'damage') === (p.kind === 'damage'));
      S.drawer({
        title: b.dataset.ph === 'damage' ? ['Foto kerusakan', 'Damage photos'] : ['Foto penerimaan', 'Receiving photos'],
        body: '<div class="k-stack">' + ph.map((p) => '<a target="_blank" rel="noopener" href="' + esc('..' + p.url) + '"><img src="' + esc('..' + p.url) + '" alt="' + esc(p.kind) + '" style="width:100%;border-radius:12px"></a>' +
          '<span class="k-caption">' + esc(p.kind + ' · ' + S.fmt.dt(p.uploaded_at) + ' · ' + who(p.uploaded_by)) + '</span>').join('') + '</div>',
      });
    }));
  }

  /* ================= router ================= */

  S.page(async function (ctx) {
    styles();
    S.setTitle('Restock ke merek', 'Restock from brand');
    S.setSub('SPV atau Ops HQ bisa membuat draf. Hanya Ops HQ yang mengirim permintaan ke merek.', 'The SPV or Ops HQ can make a draft. Only Ops HQ sends the request to the brand.');
    paintCounts();
    ctx.actions.innerHTML = btn('k-btn--primary', 'Buat draf', 'New draft', 'id="rs-new" data-min-role="supervisor"', 'plus');
    $('#rs-new', ctx.actions).addEventListener('click', () => newDraft().catch(S.fail));
    const tab = ctx.tab || 'draft';
    let id = S.param('id');
    let r = null;
    if (id) {
      r = await API().get('/replenishments/' + id);
      if ((TAB_OF[r.status] || 'draft') !== tab) {
        history.replaceState(null, '', setParams({}).pathname + setParams({}).search);
        r = null; id = null;
      }
    }
    if (!r) {
      const status = tab === 'selesai' ? 'received' : tab;
      const res = await API().get('/replenishments' + API().qs({ site_id: S.allSites() ? null : S.siteId(), status }));
      if (res.replenishments.length === 1) r = res.replenishments[0];
      else { ctx.body.innerHTML = listHtml(res.replenishments, tab); return; }
    }
    if (S.param('make') && ['draft', 'raised', 'po'].includes(r.status)) return makeView(ctx, r);
    if (r.status === 'draft' || r.status === 'raised') return draftView(ctx, r);
    if (DIFF.has(r.status)) return diffView(ctx, r);
    return requestView(ctx, r);
  });
})();
