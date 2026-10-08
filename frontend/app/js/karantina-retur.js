/* karantina-retur.js: Karantina & retur (canvas Section 7, boards 7a to 7f).
 *
 * Tabs: karantina (7b, SPV decisions), retur (7d, the return list; with
 * ?note=<id> the A4 return note 7e, printed twice), hapus (7c, Ops HQ approves
 * write-offs, every hub), lapor (7a, report a problem on the phone), serahkan
 * (7f, scan a return note out to the brand's driver; ?note=<id>).
 * The cost bearer is set by the WMS and only shown here. Approving a write-off
 * asks first, with the units, the product and who bears the cost. Return note
 * scans use S.scanKey (replayed by the server after a lost connection).
 * Mode manual (S.manualMode()): *Laporkan masalah* picks the product from a
 * searchable list, the bin from a list and the tray by a tap (manual=true);
 * *Serahkan retur* is one tap per note (/tap-all). *Masih bisa pindai?* shows
 * the scan zones again. Reports carry an idempotency key.
 *
 * API (backend/routers/quarantine.py):
 *   GET  /quarantine?site_id&status   GET /quarantine/trays?site_id   GET /quarantine/lookup?site_id&code
 *   POST /quarantine/report (multipart)   POST /quarantine/decisions {decisions:[{item_id, decision, note}]}
 *   GET  /quarantine/write-offs[?site_id]  POST /quarantine/write-offs/{id}/approve|reject {note}
 *   GET  /returns-to-brand/candidates?site_id&brand_id   POST /returns-to-brand {site_id, brand_id, lines}
 *   GET  /returns-to-brand?site_id&status   GET /returns-to-brand/{id}
 *   POST /returns-to-brand/{id}/printed|scan|tap-all|handover|cancel
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
  const needHub = (ctx) => {
    if (ctx.siteId) return false;
    ctx.body.innerHTML = '<div class="k-note k-note--info">' + icon('info', 20) + sp('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>';
    return true;
  };
  const REASONS = [
    ['rusak', 'Rusak', 'Damaged'], ['bocor', 'Bocor', 'Leaking'], ['kedaluwarsa', 'Kedaluwarsa', 'Expired'],
    ['produk_salah', 'Produk salah', 'Wrong product'], ['driver_rusak', 'Kembali dari driver, rusak', 'Back from the driver, damaged'],
  ];

  function styles() {
    if ($('#kr-style')) return;
    const st = document.createElement('style');
    st.id = 'kr-style';
    st.textContent = [
      '.kr-thumb{width:44px;height:44px;border-radius:10px;background:var(--sunk);display:inline-flex;align-items:center;justify-content:center;color:var(--muted);flex-shrink:0;overflow:hidden}',
      '.kr-thumb img{width:100%;height:100%;object-fit:cover}',
      '.kr-item{display:flex;gap:12px;align-items:center}',
      '.kr-name{font-weight:700;line-height:1.3}',
      '.kr-sub{font-size:13px;color:var(--muted)}',
      '.kr-reason{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:700;background:var(--stop-bg);color:var(--stop);white-space:nowrap}',
      '.kr-age{display:inline-flex;padding:4px 10px;border-radius:999px;font-size:13px;font-weight:700;background:var(--caution-bg);color:var(--caution);white-space:nowrap}',
      '.kr-dec{display:flex;gap:6px;flex-wrap:wrap}',
      '.kr-dec .k-btn{background:var(--surface);border:1.5px solid var(--rule);color:var(--action)}',
      '.kr-dec .k-btn[aria-pressed="true"]{background:var(--action);border-color:var(--action);color:#fff}',
      '.kr-bearer{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--muted);flex-wrap:wrap}',
      '.kr-bearer b{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;background:var(--sunk);color:var(--ink)}',
      '.kr-foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}',
      '.kr-foot>div:first-child{flex:1 1 320px;min-width:0}',
      '.kr-foot>.k-btn,.kr-foot>.k-lockwrap{flex-shrink:0}',
      '.kr-dec .k-btn{min-height:40px;padding:0 12px}',
      '.kr-group td{background:var(--sunk);font-weight:800}',
      '.kr-group .kr-sub{font-weight:600;margin-left:8px}',
      '.kr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.kr-grid .k-btn{min-height:52px;background:var(--surface);border:1.5px solid var(--rule);color:var(--ink)}',
      '.kr-grid .k-btn[aria-pressed="true"]{border-color:var(--action);background:var(--action-bg);color:var(--action)}',
      '.kr-grid .kr-wide{grid-column:1/-1}',
      '.kr-step{font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}',
      '.kr-wrap{max-width:560px}',
      '.kr-ref{font-family:var(--mono);font-weight:700;font-size:24px}',
      '.kr-line{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--rule)}',
      '.kr-line.is-next{background:var(--action-bg)}',
      '.kr-line__n{font-family:var(--mono);font-weight:800;margin-left:auto;white-space:nowrap}',
      '.kr-a4{background:#fff;color:#000;max-width:794px;margin:0 auto;padding:48px 56px;box-shadow:var(--shadow);font-size:14px}',
      '.kr-a4 h1{font-size:28px;margin:4px 0}',
      '.kr-a4 .kr-eyebrow{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}',
      '.kr-a4 .kr-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;border-top:2px solid #000;margin-top:16px;padding-top:16px}',
      '.kr-a4 table{width:100%;border-collapse:collapse;margin-top:16px;border-top:2px solid #000;border-bottom:2px solid #000}',
      '.kr-a4 th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:8px 6px;border-bottom:1px solid #000}',
      '.kr-a4 td{padding:10px 6px;border-bottom:1px solid #000;vertical-align:top}',
      '.kr-a4 .kr-box{width:18px;height:18px;border:1.5px solid #000;display:inline-block}',
      '.kr-a4 .kr-sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}',
      '.kr-a4 .kr-sign div{border:1.5px solid #000;padding:14px 16px;height:170px;display:flex;flex-direction:column;justify-content:space-between}',
      '.kr-a4 .kr-reff{border:1.5px solid #000;padding:6px 10px;font-family:var(--mono);font-weight:700}',
      '@media print{body.k-body *{visibility:hidden}.kr-a4,.kr-a4 *{visibility:visible}.kr-a4{position:absolute;left:0;top:0;box-shadow:none;padding:24px 32px;max-width:none;width:100%}' +
        '.kr-a4.kr-copy2{page-break-before:always;position:static}@page{size:A4;margin:12mm}}',
    ].join('\n');
    document.head.appendChild(st);
  }

  const thumb = (url) => '<span class="kr-thumb">' + (url ? '<img alt="" src="' + esc(url.replace(/^\/api\//, '../api/')) + '">' : icon('camera', 20)) + '</span>';
  const reasonPill = (x) => '<span class="kr-reason" ' + biAttr(x.reason_id, x.reason_en) + '>' + esc(t(x.reason_id, x.reason_en)) + '</span>';
  function itemSub(x) {
    const p = [x.qty + ' unit'];
    if (x.bin) p.push('bin <span class="k-mono">' + esc(x.bin) + '</span>');
    else if (x.where_id) p.push(esc(x.where_id));
    if (x.reason_note) p.push(esc(x.reason_note));
    return p.join(' · ');
  }
  const photoOpen = (x) => (x.photo_url ? ' data-photo="' + esc(x.photo_url.replace(/^\/api\//, '../api/')) + '" style="cursor:zoom-in"' : '');
  function bindPhotos(root) {
    $$('[data-photo]', root).forEach((el) => el.addEventListener('click', () => S.modal({ title: ['Foto', 'Photo'], wide: true, body: '<img alt="" style="width:100%;border-radius:12px" src="' + esc(el.dataset.photo) + '">' })));
  }

  /* ================= 7b: SPV decisions ================= */

  S.tab('karantina', async function (ctx) {
    styles();
    S.setTitle('Karantina', 'Quarantine');
    if (!ctx.params.get('tab') && !S.atLeast('supervisor') && window.matchMedia('(max-width: 1023.98px)').matches) { S.setTab('lapor'); return; }
    const res = await api().get('/quarantine' + api().qs({ site_id: ctx.siteId, status: 'open' }));
    const tray = (res.trays && res.trays[0]) || '';
    S.setSub('Putuskan setiap barang dalam 24 jam. Barang tetap di baki ' + (tray || 'karantina') + ' sampai diputuskan.',
      'Decide each item within 24 hours. It stays in tray ' + (tray || 'quarantine') + ' until decided.');
    S.tabCount('karantina', res.tab_counts.karantina, res.overdue ? 'caution' : null);
    S.tabCount('hapus', res.tab_counts.persetujuan_hapus);
    ctx.actions.innerHTML = (res.overdue ? '<span class="k-pill k-pill--caution k-pill--lg">' + icon('clock', 16) + esc(t(res.overdue + ' lewat waktu', res.overdue + ' past time')) + '</span>' : '') +
      '<span class="k-pill k-pill--info k-pill--lg">' + esc(t(res.items.length + ' barang di baki', res.items.length + ' item(s) in the tray')) + '</span>';
    const multi = !ctx.siteId;
    const chosen = {};
    if (!res.items.length) {
      ctx.body.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' + bis('Baki karantina kosong', 'The quarantine tray is empty', 'k-empty__title') +
        bis('Barang yang dilaporkan rusak, bocor, kedaluwarsa atau salah muncul di sini.', 'Units reported damaged, leaking, expired or wrong show here.', 'k-empty__text') + '</div>';
      return;
    }
    const decBtns = (x) => '<div class="kr-dec" data-item="' + x.id + '">' +
      [['back_to_rack', 'Kembali ke rak', 'Back to rack'], ['return', 'Retur ke merek', 'Return to brand'], ['write_off', 'Hapus stok', 'Write off']].map((d) =>
        '<button type="button" class="k-btn k-btn--sm" data-dec="' + d[0] + '" aria-pressed="false" data-min-role="supervisor">' + sp(d[1], d[2]) + '</button>').join('') + '</div>' +
      '<div class="kr-bearer" data-bearer="' + x.id + '" hidden><span ' + biAttr('Beban biaya', 'Cost borne by') + '></span><b>' + icon('lock', 13) + esc(t(x.cost_bearer_id, x.cost_bearer_en)) + '</b>' +
      '<span>' + esc(t('otomatis: ' + (x.bearer_note_id || '').toLowerCase(), 'automatic: ' + (x.bearer_note_en || '').toLowerCase())) + '</span></div>' +
      (x.sent_back_by_hq ? '<div class="k-note k-note--caution" style="margin-top:8px">' + icon('undo', 18) + '<span>' + esc(t('Ditolak Ops HQ: ', 'Refused by Ops HQ: ') + (x.hq_note || '')) + '</span></div>' : '');
    const reported = (x) => '<div class="kr-name" style="font-weight:600">' + esc(first(x.reported_name) || x.reported_by) + '</div><div class="kr-sub">' + esc(S.fmt.dt(x.reported_at)) + '</div>' +
      (x.due_id ? '<div class="kr-sub" style="font-weight:800;color:' + (x.overdue ? 'var(--caution)' : 'var(--muted)') + '" ' + biAttr(x.due_id, x.due_en) + '>' + esc(t(x.due_id, x.due_en)) + '</div>' : '');
    ctx.body.innerHTML = '<div class="k-stack" id="kr-k">' +
      '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr>' + (multi ? '<th>Dark store</th>' : '') +
      '<th ' + biAttr('Barang dan foto', 'Item and photo') + '></th><th ' + biAttr('Alasan', 'Reason') + '></th><th ' + biAttr('Dilaporkan', 'Reported') + '></th><th ' + biAttr('Keputusan', 'Decision') + '></th></tr></thead><tbody>' +
      res.items.map((x) => '<tr class="' + (x.overdue ? 'is-caution' : '') + '">' + (multi ? '<td class="k-mono k-strong">' + esc(x.site_code) + '</td>' : '') +
        '<td><div class="kr-item"' + photoOpen(x) + '>' + thumb(x.photo_url) + '<div><div class="kr-name">' + esc(x.sku_name) + '</div><div class="kr-sub">' + itemSub(x) + '</div></div></div></td>' +
        '<td>' + reasonPill(x) + '</td><td>' + reported(x) + '</td><td>' + decBtns(x) + '</td></tr>').join('') + '</tbody></table></div></div>' +
      '<div class="k-phone-only k-stack">' + res.items.map((x) => '<div class="k-card k-card--pad' + (x.overdue ? ' k-card--caution' : '') + '"><div class="kr-item"' + photoOpen(x) + '>' + thumb(x.photo_url) +
        '<div class="k-grow"><div class="kr-name">' + esc(x.sku_name) + '</div><div class="kr-sub">' + itemSub(x) + '</div></div></div>' +
        '<div class="k-line" style="margin:8px 0;gap:10px">' + reasonPill(x) + '<span class="kr-sub">' + esc(first(x.reported_name) + ' · ' + S.fmt.dt(x.reported_at)) + '</span>' +
        (x.due_id ? '<span class="kr-sub" style="font-weight:800;color:' + (x.overdue ? 'var(--caution)' : 'var(--muted)') + '">' + esc(t(x.due_id, x.due_en)) + '</span>' : '') + '</div>' + decBtns(x) + '</div>').join('') + '</div>' +
      '<div class="k-card k-card--pad kr-foot"><div><div class="k-strong" id="kr-n"></div><div class="kr-sub" ' + biAttr('Kembali ke rak jadi tugas staf, stok naik saat bin dipindai. Hapus stok menunggu persetujuan Ops HQ. Beban biaya otomatis: rusak di dark store = Ninja, ditolak saat barang masuk = merek.',
        'Back to rack becomes a staff task; the stock rises when the bin is scanned. Write-off waits for Ops HQ. Cost bearer is automatic: damaged in the dark store = Ninja, rejected at inbound = brand.') + '></div></div>' +
      btn('k-btn--primary', 'Simpan keputusan', 'Save decisions', 'id="kr-save" data-min-role="supervisor"') + '</div></div>';
    const root = $('#kr-k', ctx.body);
    const paintN = () => { const c = Object.keys(chosen).length; S.bi($('#kr-n', root), c + ' keputusan dipilih', c + ' decision(s) chosen'); };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dec]');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      const id = b.closest('[data-item]').dataset.item;
      const on = chosen[id] !== b.dataset.dec;
      if (on) chosen[id] = b.dataset.dec; else delete chosen[id];
      $$('[data-item="' + id + '"] [data-dec]', root).forEach((x) => x.setAttribute('aria-pressed', String(on && x.dataset.dec === b.dataset.dec)));
      $$('[data-bearer="' + id + '"]', root).forEach((x) => { x.hidden = chosen[id] !== 'write_off'; });
      paintN();
    });
    bindPhotos(root);
    paintN();
    $('#kr-save', root).addEventListener('click', async (ev) => {
      const decisions = Object.entries(chosen).map(([id, d]) => ({ item_id: +id, decision: d }));
      if (!decisions.length) { S.toast(['Pilih keputusan dulu.', 'Choose a decision first.'], 'caution'); return; }
      ev.currentTarget.disabled = true;
      try { const r = await api().post('/quarantine/decisions', { decisions }); S.toast(r.message, 'ok'); S.rerender(); }
      catch (e) { S.fail(e); ev.currentTarget.disabled = false; }
    });
  });

  /* ================= 7c: Ops HQ write-off approval ================= */

  S.tab('hapus', async function (ctx) {
    styles();
    S.setTitle('Persetujuan hapus stok', 'Write-off approval');
    S.setSub('Periksa alasan dan foto setiap unit yang dihapus dari stok. Beban biaya terisi otomatis.', 'Check the reason and photo of every unit written off. The cost bearer is filled in automatically.');
    const res = await api().get('/quarantine/write-offs' + api().qs({ site_id: ctx.siteId }));
    S.tabCount('hapus', res.brands.reduce((a, g) => a + g.items.length, 0));
    ctx.actions.innerHTML = '<span class="k-pill k-pill--info k-pill--lg">' + esc(t(res.units + ' unit menunggu', res.units + ' unit(s) waiting')) + '</span>';
    if (!res.brands.length) {
      ctx.body.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' + bis('Tidak ada yang menunggu persetujuan', 'Nothing waiting for approval', 'k-empty__title') + '</div>';
      return;
    }
    const acts = (x) => btn('k-btn--primary k-btn--sm', 'Setujui', 'Approve', 'data-ok="' + x.id + '" data-min-role="hq"', 'check') + ' ' + btn('k-btn--secondary k-btn--sm', 'Tolak', 'Refuse', 'data-no="' + x.id + '" data-min-role="hq"');
    const bearer = (x) => '<div class="kr-name">' + esc(t(x.cost_bearer_id, x.cost_bearer_en)) + '</div><div class="kr-sub">' + esc(t(x.bearer_note_id, x.bearer_note_en)) + '</div>';
    const groupHead = (g) => esc(g.brand_name) + '<span class="kr-sub">' + esc(g.units + ' unit') + '</span><span class="kr-sub">' + esc(t('Merek ' + g.brand_units + ' · Ninja ' + g.ninja_units, 'Brand ' + g.brand_units + ' · Ninja ' + g.ninja_units)) + '</span>';
    ctx.body.innerHTML = '<div class="k-stack" id="kr-h"><div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr><th>Dark store</th><th ' + biAttr('Barang dan foto', 'Item and photo') + '></th><th class="k-num" ' + biAttr('Unit', 'Units') + '></th>' +
      '<th ' + biAttr('Alasan', 'Reason') + '></th><th ' + biAttr('Beban', 'Borne by') + '></th><th ' + biAttr('Diajukan', 'Raised') + '></th><th></th></tr></thead><tbody>' +
      res.brands.map((g) => '<tr class="kr-group"><td colspan="7">' + groupHead(g) + '</td></tr>' + g.items.map((x) => '<tr><td class="k-mono k-strong">' + esc(x.site_code) + '</td>' +
        '<td><div class="kr-item"' + photoOpen(x) + '>' + thumb(x.photo_url) + '<div><div class="kr-name">' + esc(x.sku_name) + '</div><div class="kr-sub">' + esc(x.reason_note || x.where_id || '') + '</div></div></div></td>' +
        '<td class="k-num k-strong">' + n(x.qty) + '</td><td>' + reasonPill(x) + '</td><td>' + bearer(x) + '</td>' +
        '<td><div class="kr-name" style="font-weight:600">' + esc(first(x.decided_name) || '-') + '</div><div class="kr-sub">' + esc(S.fmt.dt(x.decided_at)) + '</div></td>' +
        '<td class="k-table__actions" style="white-space:nowrap">' + acts(x) + '</td></tr>').join('')).join('') + '</tbody></table></div></div>' +
      '<div class="k-phone-only k-stack">' + res.brands.map((g) => '<div class="k-eyebrow">' + groupHead(g) + '</div>' + g.items.map((x) => '<div class="k-card k-card--pad"><div class="kr-item"' + photoOpen(x) + '>' + thumb(x.photo_url) +
        '<div class="k-grow"><div class="kr-name">' + esc(x.sku_name) + '</div><div class="kr-sub">' + esc(x.site_code + ' · ' + x.qty + ' unit · ' + (x.reason_note || '')) + '</div></div></div>' +
        '<div class="k-line" style="gap:10px;margin:8px 0">' + reasonPill(x) + bearer(x) + '</div><div class="k-line" style="gap:8px">' + acts(x) + '</div></div>').join('')).join('') + '</div>' +
      '<div class="k-card k-card--pad k-line" style="gap:24px;flex-wrap:wrap"><span class="k-line" style="gap:6px;color:var(--ok)">' + icon('check', 18, 2.6) + '<span><b ' + biAttr('Setujui', 'Approve') + '></b>' +
      esc(t(': unit keluar dari stok, masuk laporan bulanan merek.', ': the units leave the stock and appear in the brand\'s monthly report.')) + '</span></span>' +
      '<span class="k-line" style="gap:6px">' + icon('undo', 18) + '<span><b ' + biAttr('Tolak', 'Refuse') + '></b>' + esc(t(': tetap di baki, kembali ke SPV dengan catatan.', ': stays in the tray, back to the SPV with a note.')) + '</span></span></div></div>';
    const root = $('#kr-h', ctx.body);
    bindPhotos(root);
    root.addEventListener('click', async (e) => {
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
      if (ok && ok.getAttribute('aria-disabled') !== 'true') {
        const x = res.brands.reduce((a, g) => a.concat(g.items), []).find((y) => String(y.id) === ok.dataset.ok);
        if (x && !(await S.confirm({
          title: ['Setujui hapus stok?', 'Approve the write-off?'],
          body: '<div class="k-stack"><div class="kr-item">' + thumb(x.photo_url) + '<div><div class="kr-name">' + esc(x.sku_name) + '</div>' +
            '<div class="kr-sub">' + esc(x.site_code + ' · ' + t(x.reason_id, x.reason_en)) + '</div></div></div>' +
            '<table class="k-table"><tbody><tr><td>' + sp('Unit dihapus', 'Units written off') + '</td><td class="k-num k-strong">' + n(x.qty) + '</td></tr>' +
            '<tr><td>' + sp('Beban biaya', 'Cost borne by') + '</td><td class="k-strong">' + esc(t(x.cost_bearer_id, x.cost_bearer_en)) + '</td></tr></tbody></table>' +
            '<div class="k-note k-note--caution">' + icon('warn', 20) + sp(n(x.qty) + ' unit keluar dari stok untuk selamanya dan masuk laporan bulanan merek.',
              n(x.qty) + ' unit(s) leave the stock for good and appear in the brand\'s monthly report.') + '</div></div>',
          ok: ['Setujui hapus stok', 'Approve the write-off'],
        }))) return;
        ok.disabled = true;
        try { await api().post('/quarantine/write-offs/' + ok.dataset.ok + '/approve', {}); S.toast(['Disetujui. Unit keluar dari stok.', 'Approved. The units leave the stock.'], 'ok'); S.rerender(); }
        catch (err) { S.fail(err); ok.disabled = false; }
      } else if (no && no.getAttribute('aria-disabled') !== 'true') {
        S.modal({
          title: ['Tolak hapus stok', 'Refuse the write-off'],
          body: '<label class="k-field"><span class="k-field__label" ' + biAttr('Catatan untuk SPV', 'Note for the SPV') + '></span><textarea class="k-textarea" id="kr-why" rows="3"></textarea></label>',
          actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
            label: ['Tolak', 'Refuse'], kind: 'primary', minRole: 'hq',
            onClick: async () => {
              const note = $('#kr-why').value.trim();
              if (!note) { S.toast(['Tulis catatan untuk SPV.', 'Write a note for the SPV.'], 'caution'); return false; }
              await api().post('/quarantine/write-offs/' + no.dataset.no + '/reject', { note });
              S.rerender();
            },
          }],
        });
      }
    });
  });

  /* ================= 7d: return to the brand, and 7e: the note ================= */

  S.tab('retur', async function (ctx) {
    styles();
    if (ctx.params.get('note')) { await notePrint(ctx, +ctx.params.get('note')); return; }
    S.setTitle('Retur ke merek', 'Return to the brand');
    S.setSub('Centang barang yang kembali ke merek. Retur ikut kiriman merek berikutnya.', 'Tick the units going back to the brand. Returns go with the brand\'s next delivery.');
    if (needHub(ctx)) return;
    let brands = [];
    try { brands = (await api().get('/catalog/brands')).brands.filter((b) => b.active); } catch (e) { S.fail(e); }
    if (!brands.length) { ctx.body.innerHTML = '<div class="k-card k-empty">' + bis('Belum ada merek.', 'No brand yet.', 'k-empty__title') + '</div>'; return; }
    let brandId = +(ctx.params.get('brand') || brands[0].id);
    if (!brands.some((b) => b.id === brandId)) brandId = brands[0].id;
    ctx.actions.innerHTML = '<label class="k-line" style="gap:10px"><span class="k-muted" ' + biAttr('Merek', 'Brand') + '></span><select class="k-select" id="kr-brand" style="min-width:140px">' +
      brands.map((b) => '<option value="' + b.id + '"' + (b.id === brandId ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>';
    ctx.body.innerHTML = '<div id="kr-r" class="k-stack"><div class="k-loading"></div></div>';
    const root = $('#kr-r', ctx.body);
    $('#kr-brand', ctx.actions).addEventListener('change', (e) => { brandId = +e.target.value; load(); });
    async function load() {
      const [c, notes] = await Promise.all([
        api().get('/returns-to-brand/candidates' + api().qs({ site_id: ctx.siteId, brand_id: brandId })),
        api().get('/returns-to-brand' + api().qs({ site_id: ctx.siteId, status: 'open' })),
      ]);
      const brand = brands.find((b) => b.id === brandId);
      const rows = [];
      const grp = (ic, id, en, subId, subEn, warn) => '<tr class="kr-group"><td></td><td colspan="4"><span class="k-line" style="gap:8px">' + icon(ic, 18) + sp(id, en) +
        '<span class="kr-sub" style="' + (warn ? 'color:var(--caution);font-weight:700' : '') + '" ' + biAttr(subId, subEn) + '></span></span></td></tr>';
      const lineRow = (k, x, loc, why, qty, extra, sub) => '<tr><td style="width:44px"><input type="checkbox" class="kr-cb" data-k="' + k + '" data-qty="' + qty + '" checked style="width:22px;height:22px;accent-color:var(--action)"></td>' +
        '<td><div class="kr-name">' + esc(x) + '</div>' + (sub ? '<div class="kr-sub">' + esc(sub) + '</div>' : '') + '</td><td class="k-mono">' + esc(loc || '-') + '</td><td>' + why + (extra || '') + '</td><td class="k-num k-strong">' + n(qty) + '</td></tr>';
      if (c.from_quarantine.length) {
        rows.push(grp('warn', 'Dari karantina', 'From quarantine', 'Keputusan SPV: Retur ke merek', 'SPV decision: return to the brand'));
        c.from_quarantine.forEach((x) => rows.push(lineRow('q' + x.id, x.sku_name, x.tray_code, reasonPill(x), x.qty)));
      }
      if (c.old_stock.length) {
        rows.push(grp('clock', 'Stok lama (umur lebih dari ' + c.old_stock_days + ' hari sejak masuk)', 'Old stock (over ' + c.old_stock_days + ' days since inbound)',
          'Cek tanggal ED di kemasan sebelum diretur (aturan merek: sisa kurang dari 6 bulan)', 'Check the ED on the pack before returning (brand rule: under 6 months left)', true));
        c.old_stock.forEach((x, i) => rows.push(lineRow('o' + i, x.sku_name, x.bin, '<span class="kr-age">' + esc(x.where_id + ' · ' + x.age_days + ' ' + t('hari', 'days')) + '</span>', x.qty,
          '<div style="margin-top:6px"><input class="k-input k-input--sm" data-ed="o' + i + '" style="width:200px" data-ph-id="ED di kemasan: Jan 2027" data-ph-en="ED on the pack: Jan 2027"></div>')));
      }
      if (c.rejected.length) {
        rows.push(grp('close', 'Kiriman ditolak', 'Refused deliveries', 'Ditolak saat barang masuk, belum pernah jadi stok', 'Refused at inbound, never stock'));
        c.rejected.forEach((x) => rows.push(lineRow('r' + x.id, x.sku_name, x.tray_code, reasonPill(x), x.qty, '', [x.delivery_ref, S.fmt.date(x.reported_at).replace(/ \d{4}$/, '')].filter(Boolean).join(' · '))));
      }
      const notesHtml = notes.notes.length ? '<div class="k-card k-card--pad k-stack k-stack--tight"><strong ' + biAttr('Nota retur terbuka', 'Open return notes') + '></strong>' +
        notes.notes.map((x) => '<div class="k-line k-line--between" style="border-top:1px solid var(--rule);padding-top:8px;flex-wrap:wrap;gap:8px"><span><span class="k-mono k-strong">' + esc(x.reference) + '</span> · ' + esc(x.brand_name) +
          '<span class="kr-sub"> · ' + esc(x.scanned + '/' + x.units + ' unit' + (x.delivery_ref ? t(' · ikut ', ' · with ') + x.delivery_ref : '')) + '</span></span><span class="k-line" style="gap:8px">' +
          '<a class="k-btn k-btn--secondary k-btn--sm" href="karantina-retur.html?tab=retur&note=' + x.id + '">' + icon('print', 16) + sp('Cetak nota', 'Print the note') + '</a>' +
          '<a class="k-btn k-btn--primary k-btn--sm" href="karantina-retur.html?tab=serahkan&note=' + x.id + '">' + sp('Serahkan', 'Hand over') + '</a></span></div>').join('') + '</div>' : '';
      root.innerHTML = (rows.length ? '<div class="k-tablewrap"><table class="k-table"><thead><tr><th></th><th ' + biAttr('Barang', 'Item') + '></th><th ' + biAttr('Lokasi', 'Location') + '></th>' +
        '<th ' + biAttr('Alasan / umur', 'Reason / age') + '></th><th class="k-num" ' + biAttr('Unit', 'Units') + '></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
        '<div class="k-card k-card--pad kr-foot"><div><div class="k-strong" id="kr-sum"></div><div class="kr-sub" id="kr-sum2"></div></div>' +
        btn('k-btn--primary', 'Buat nota retur', 'Make the return note', 'id="kr-make" data-min-role="supervisor"', 'list') + '</div>'
        : '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' + bis('Tidak ada yang perlu diretur ke ' + brand.name, 'Nothing to return to ' + brand.name, 'k-empty__title') + '</div>') + notesHtml;
      S.applyLang(root);
      S.lockAll(root);
      const sum = () => {
        const on = $$('.kr-cb', root).filter((x) => x.checked);
        const by = (p) => on.filter((x) => x.dataset.k[0] === p).reduce((a, x) => a + +x.dataset.qty, 0);
        const tot = by('q') + by('o') + by('r');
        const sm = $('#kr-sum', root);
        if (!sm) return;
        S.bi(sm, tot + ' unit dipilih untuk ' + brand.name, tot + ' unit(s) chosen for ' + brand.name);
        const d = c.next_delivery ? c.next_delivery.reference : null;
        S.bi($('#kr-sum2', root), by('q') + ' dari karantina · ' + by('o') + ' stok lama · ' + by('r') + ' kiriman ditolak' + (d ? ' · ikut kiriman ' + d : ' · ikut kiriman merek berikutnya') + '. Stok lama berhenti dijual saat nota dibuat.',
          by('q') + ' from quarantine · ' + by('o') + ' old stock · ' + by('r') + ' refused' + (d ? ' · with delivery ' + d : ' · with the brand\'s next delivery') + '. Old stock stops selling when the note is made.');
      };
      root.addEventListener('change', (e) => { if (e.target.classList.contains('kr-cb')) sum(); });
      sum();
      const mk = $('#kr-make', root);
      if (mk) mk.addEventListener('click', async () => {
        const lines = [];
        $$('.kr-cb', root).filter((x) => x.checked).forEach((cb) => {
          const k = cb.dataset.k, id = +k.slice(1);
          if (k[0] === 'q') lines.push({ origin: 'quarantine', quarantine_item_id: id });
          else if (k[0] === 'r') lines.push({ origin: 'rejected', quarantine_item_id: id });
          else {
            const o = c.old_stock[id];
            const ed = $('[data-ed="' + k + '"]', root).value.trim();
            lines.push({ origin: 'old_stock', location_id: o.location_id, sku_id: o.sku_id, qty: o.qty, ed_on_pack: ed || null });
          }
        });
        if (!lines.length) { S.toast(['Centang barang dulu.', 'Tick the units first.'], 'caution'); return; }
        const ok = await S.confirm({ title: ['Buat nota retur?', 'Make the return note?'], text: ['Stok lama berhenti dijual sekarang. Cetak nota dua lembar setelah ini.', 'Old stock stops selling now. Print the note twice after this.'], ok: ['Buat nota retur', 'Make the note'] });
        if (!ok) return;
        mk.disabled = true;
        try {
          const r = await api().post('/returns-to-brand', { site_id: ctx.siteId, brand_id: brandId, lines });
          S.toast(t('Nota ' + r.reference + ' dibuat.', 'Note ' + r.reference + ' made.'), 'ok');
          S.go('karantina-retur.html?tab=retur&note=' + r.id);
        } catch (e) { S.fail(e); mk.disabled = false; }
      });
    }
    await load();
  });

  function a4(note, me) {
    const printed = S.fmt.date(new Date().toISOString()).replace(/ \d{4}$/, '') + ' ' + new Date().getFullYear() + ' ' + S.fmt.time(new Date().toISOString());
    return '<div class="kr-eyebrow">Ninja Van Indonesia · SatSet WMS</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px"><div><h1>Nota retur <span style="font-family:var(--mono)">' + esc(note.reference) + '</span></h1>' +
      '<div>Barang yang dikembalikan dari dark store ke merek.</div></div><span class="kr-reff">' + esc(note.reference) + '</span></div>' +
      '<div class="kr-meta">' +
      '<div><div class="kr-eyebrow">Merek</div><b>' + esc(note.brand_name + (note.brand_company ? ' · ' + note.brand_company : '')) + '</b></div>' +
      '<div><div class="kr-eyebrow">Dark store</div><b>' + esc(note.site_code + ' · ' + note.site_name) + '</b></div>' +
      '<div><div class="kr-eyebrow">Tanggal nota</div><b>' + esc(S.fmt.day(note.created_at) + ' ' + new Date(note.created_at.replace(' ', 'T')).getFullYear()) + '</b></div>' +
      '<div><div class="kr-eyebrow">Ikut kiriman</div><b style="font-family:var(--mono)">' + esc(note.delivery_ref || 'Kiriman merek berikutnya') + '</b></div>' +
      '<div><div class="kr-eyebrow">Dibuat oleh</div><b>' + esc((note.created_name || note.created_by) + (note.created_role === 'supervisor' ? ', SPV ' + note.site_code : '')) + '</b></div>' +
      '<div><div class="kr-eyebrow">Jumlah</div><b>' + esc(note.products + ' produk · ' + note.units + ' unit') + '</b></div></div>' +
      '<table><thead><tr><th>No</th><th>Produk</th><th>Asal</th><th>Alasan</th><th style="text-align:right">Unit</th><th style="text-align:center">Cek driver</th></tr></thead><tbody>' +
      note.lines.map((l) => '<tr><td>' + l.no + '</td><td><b>' + esc(l.sku_name) + '</b></td><td>' + esc(l.asal_id) + '</td><td>' + esc(l.reason_id || '') + '</td>' +
        '<td style="text-align:right;font-family:var(--mono);font-weight:700">' + n(l.qty) + '</td><td style="text-align:center"><span class="kr-box"></span></td></tr>').join('') +
      '<tr><td></td><td><b>Total</b></td><td></td><td></td><td style="text-align:right;font-family:var(--mono);font-weight:800">' + n(note.units) + '</td><td></td></tr></tbody></table>' +
      '<div style="margin-top:18px"><b>Catatan</b><ol style="margin:6px 0 0;padding-left:18px;line-height:1.8"><li>Driver menghitung dan mencentang setiap baris sebelum tanda tangan.</li>' +
      '<li>Jumlah yang tidak sama ditulis di baris itu dan diparaf kedua pihak.</li><li>Cetak dua lembar: satu dibawa driver, satu disimpan SPV dark store.</li></ol></div>' +
      '<div class="kr-sign"><div><span class="kr-eyebrow">Diserahkan oleh · Ninja</span><span>Nama: ......................................................<br><br>Tanggal dan jam: ......................................</span></div>' +
      '<div><span class="kr-eyebrow">Diterima oleh · Driver</span><span>Nama: ......................................................<br><br>No. polisi kendaraan: ..............................</span></div></div>' +
      '<div style="display:flex;justify-content:space-between;border-top:1px solid #000;margin-top:20px;padding-top:8px;font-size:12px"><span>Dicetak dari SatSet WMS · ' + esc(printed + ' · ' + ((me && me.name) || '')) + '</span><span>Halaman 1 dari 1</span></div>';
  }

  async function notePrint(ctx, id) {
    const note = await api().get('/returns-to-brand/' + id);
    S.setTitle('Nota retur ' + note.reference, 'Return note ' + note.reference);
    S.setSub('Cetak dua lembar di A4. Simpan bersama barang retur sampai driver merek datang.', 'Print two copies on A4. Keep them with the return units until the brand\'s driver comes.');
    ctx.actions.innerHTML = '<a class="k-btn k-btn--secondary" href="karantina-retur.html?tab=retur">' + icon('back', 18) + sp('Kembali', 'Back') + '</a>' +
      btn('k-btn--primary', 'Cetak nota retur', 'Print the return note', 'id="kr-print"', 'print') +
      (note.status === 'open' ? '<a class="k-btn k-btn--secondary" href="karantina-retur.html?tab=serahkan&note=' + note.id + '">' + sp('Serahkan retur', 'Hand over') + '</a>' : '');
    ctx.body.innerHTML = '<div class="kr-a4">' + a4(note, S.me()) + '</div><div class="kr-a4 kr-copy2" style="display:none">' + a4(note, S.me()) + '</div>';
    $('#kr-print', ctx.actions).addEventListener('click', async () => {
      try { await api().post('/returns-to-brand/' + id + '/printed', {}); } catch (e) { /* printing still goes ahead */ }
      $('.kr-copy2', ctx.body).style.display = '';
      window.print();
      $('.kr-copy2', ctx.body).style.display = 'none';
    });
  }

  /* ================= 7f: hand the return over ================= */

  S.tab('serahkan', async function (ctx) {
    styles();
    S.setTitle('Serahkan retur', 'Hand over a return');
    S.setSub('Saat driver merek datang: pindai setiap unit keluar sesuai nota, lalu driver tanda tangan.', 'When the brand\'s driver comes: scan each unit out against the note, then the driver signs.');
    if (needHub(ctx)) return;
    const noteId = +(ctx.params.get('note') || 0);
    if (!noteId) {
      const notes = (await api().get('/returns-to-brand' + api().qs({ site_id: ctx.siteId, status: 'open' }))).notes;
      ctx.body.innerHTML = notes.length ? '<div class="k-list">' + notes.map((x) => '<a class="k-row" href="karantina-retur.html?tab=serahkan&note=' + x.id + '"><span class="k-row__icon">' + icon('truck', 26) + '</span>' +
        '<span class="k-row__text"><span class="k-row__title"><span class="k-mono">' + esc(x.reference) + '</span> · ' + esc(x.brand_name) + '</span><span class="k-row__sub">' +
        esc(x.scanned + '/' + x.units + ' unit' + (x.delivery_ref ? t(' · ikut ', ' · with ') + x.delivery_ref : '')) + '</span></span><span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div>'
        : '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' + bis('Tidak ada nota retur yang menunggu', 'No return note waiting', 'k-empty__title') + '</div>';
      return;
    }
    let note = await api().get('/returns-to-brand/' + noteId);
    if (note.status !== 'open') {
      ctx.body.innerHTML = '<div class="k-note k-note--ok">' + icon('check', 20) + '<span>' + esc(t('Nota ' + note.reference + ' sudah diserahkan ' + S.fmt.dt(note.handed_over_at) + '.', 'Note ' + note.reference + ' was handed over ' + S.fmt.dt(note.handed_over_at) + '.')) + '</span></div>';
      return;
    }
    S.fullScreen(true, { title: ['Serahkan retur', 'Hand over a return'], onBack: () => { S.fullScreen(false); S.go('karantina-retur.html?tab=serahkan'); } });
    ctx.body.innerHTML = '<div class="k-stack kr-wrap" id="kr-s"></div>';
    const root = $('#kr-s', ctx.body);
    /* Mode manual: the units are counted out by hand in front of the driver and
       confirmed with one tap for the note; *Masih bisa pindai?* shows the scan zone. */
    let showScan = false, tapping = false;
    async function tapAll(b) {
      if (tapping) return;
      const left = note.units - note.scanned;
      const ok = await S.confirm({
        title: ['Semua unit sudah dihitung keluar?', 'Every unit counted out?'],
        text: ['Hitung ' + left + ' unit di depan driver, baris demi baris sesuai nota ' + note.reference + '. Tercatat sebagai Mode manual.',
          'Count ' + left + ' unit(s) in front of the driver, line by line against note ' + note.reference + '. Recorded as manual mode.'],
        ok: ['Sudah dihitung keluar', 'Counted out'],
      });
      if (!ok || tapping) return;
      tapping = true;
      b.disabled = true;
      const sc = 'rtn-tap-' + noteId;
      const k = S.scanKey(sc, 'all');
      try {
        let r;
        try { r = await api().post('/returns-to-brand/' + noteId + '/tap-all', { idempotency_key: k }); S.scanDone(sc); }
        catch (e) { if (!e.network) S.scanDone(sc); throw e; }
        S.toast(r.message, 'ok');
        note = await api().get('/returns-to-brand/' + noteId);
        tapping = false;
        paint();
      } catch (e) { tapping = false; b.disabled = false; S.fail(e); }
    }
    function paint() {
      const left = note.units - note.scanned;
      const nextIdx = note.lines.findIndex((l) => l.qty_scanned < l.qty);
      const taps = S.manualMode() && !showScan;
      root.innerHTML = '<div class="k-card k-card--pad k-stack k-stack--tight"><span class="kr-step">' + esc(t('Nota retur · ', 'Return note · ') + note.brand_name) + '</span>' +
        '<span class="kr-ref">' + esc(note.reference) + '</span><div class="k-line" style="gap:8px;align-items:baseline"><span style="font-family:var(--mono);font-size:44px;font-weight:800">' + n(note.scanned) + '</span>' +
        '<span class="k-strong">' + esc(t('dari ' + note.units + ' unit dipindai keluar', 'of ' + note.units + ' units scanned out')) + '</span></div>' +
        '<div class="k-progress"><div class="k-progress__bar" style="width:' + (note.units ? Math.round(100 * note.scanned / note.units) : 0) + '%"></div></div></div>' +
        (taps ? (left ? '<div class="k-card k-card--pad k-stack k-stack--tight"><div class="k-note k-note--caution">' + icon('warn', 20) +
            sp('Mode manual: hitung setiap unit di depan driver sesuai nota, lalu ketuk sekali untuk nota ini.', 'Manual mode: count each unit in front of the driver against the note, then tap once for this note.') + '</div>' +
            btn('k-btn--primary k-btn--block', 'Semua unit sudah dihitung keluar', 'Every unit counted out', 'id="kr-tapall"', 'check') +
            '<button type="button" class="k-linkbtn" id="kr-scanok" style="align-self:flex-start">' + icon('scan', 16) + sp('Masih bisa pindai?', 'Scanner still works?') + '</button></div>' : '')
          : '<div id="kr-zone"></div>') +
        '<div class="k-card" style="padding:4px 0">' + note.lines.map((l, i) => {
          const done = l.qty_scanned >= l.qty;
          return '<div class="kr-line' + (i === nextIdx ? ' is-next' : '') + '"><span style="color:' + (done ? 'var(--ok)' : 'var(--muted)') + '">' + icon(done ? 'check' : i === nextIdx ? 'chev' : 'count', 18, 2.4) + '</span>' +
            '<span class="' + (i === nextIdx ? 'k-strong' : '') + '">' + esc(l.sku_name) + '</span><span class="kr-line__n" style="color:' + (done ? 'var(--ok)' : 'var(--ink-2)') + '">' + l.qty_scanned + '/' + l.qty + '</span></div>';
        }).join('') + '</div>' +
        '<div class="k-actionbar"><p class="k-caption" style="text-align:center;margin:0">' + esc(left ? (taps ? t('Hitung ' + left + ' unit keluar, lalu driver tanda tangan nota.', 'Count ' + left + ' unit(s) out, then the driver signs the note.')
            : t('Pindai ' + left + ' unit lagi, lalu driver tanda tangan nota.', 'Scan ' + left + ' more, then the driver signs the note.'))
          : t('Semua unit tercatat keluar. Driver mencentang baris dan tanda tangan dua lembar.', 'All units recorded out. The driver ticks the lines and signs both copies.')) + '</p>' +
        '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" id="kr-signed"' + (left ? ' disabled' : '') + '>' + icon('edit', 22) + sp('Driver sudah tanda tangan', 'The driver has signed') + '</button></div>';
      const ta = $('#kr-tapall', root);
      if (ta) ta.addEventListener('click', () => tapAll(ta));
      const so = $('#kr-scanok', root);
      if (so) so.addEventListener('click', () => { showScan = true; paint(); });
      if (!taps) S.scan(async (code, z) => {
        const sc = 'rtn-' + noteId;
        const k = S.scanKey(sc, code);
        try {
          let r;
          try { r = await api().post('/returns-to-brand/' + noteId + '/scan', { code, idempotency_key: k }); S.scanDone(sc); }
          catch (e) { if (!e.network) S.scanDone(sc); throw e; }
          z.accept(S.pick(r.message));
          note = await api().get('/returns-to-brand/' + noteId);
          paint();
        } catch (e) { z.reject(S.pick(e.message)); }
      }, { title: ['Pindai unit berikutnya', 'Scan the next unit'], mount: $('#kr-zone', root) });
      $('#kr-signed', root).addEventListener('click', () => S.modal({
        title: ['Driver sudah tanda tangan', 'The driver has signed'],
        body: '<div class="k-stack"><label class="k-field"><span class="k-field__label" ' + biAttr('Nama driver (boleh kosong)', 'Driver\'s name (optional)') + '></span><input class="k-input" id="kr-dn"></label>' +
          '<label class="k-field"><span class="k-field__label" ' + biAttr('No. polisi kendaraan (boleh kosong)', 'Vehicle plate (optional)') + '></span><input class="k-input k-mono" id="kr-vn" autocapitalize="characters"></label>' +
          '<p class="k-caption" ' + biAttr('Satu lembar dibawa driver, satu disimpan SPV. Unit keluar dari dark store.', 'One copy goes with the driver, one stays with the SPV. The units leave the dark store.') + '></p></div>',
        actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
          label: ['Selesai serahkan', 'Finish the handover'], kind: 'primary',
          onClick: async () => {
            const r = await api().post('/returns-to-brand/' + noteId + '/handover', { driver_name: $('#kr-dn').value.trim() || null, vehicle_no: $('#kr-vn').value.trim() || null });
            S.toast(r.message, 'ok');
            S.fullScreen(false);
            S.go('karantina-retur.html?tab=serahkan');
          },
        }],
      }));
      S.applyLang(root);
    }
    paint();
  });

  /* ================= 7a: report a problem ================= */

  S.tab('lapor', async function (ctx) {
    styles();
    S.setTitle('Laporkan masalah', 'Report a problem');
    S.setSub('Untuk barang rusak, bocor, kedaluwarsa atau salah. Barang langsung tidak dijual di Grab.', 'For a damaged, leaking, expired or wrong product. It stops selling on Grab at once.');
    if (needHub(ctx)) return;
    const trays = (await api().get('/quarantine/trays' + api().qs({ site_id: ctx.siteId }))).trays;
    /* Mode manual: the product from a searchable list, the bin from a list and the
       tray by a tap. *Masih bisa pindai?* (st.scan) brings the scan zones back. */
    const manual = S.manualMode();
    const st = { item: null, qty: 1, bin: null, reason: null, photo: null, photoUrl: null, gm: '', viaList: false, binTapped: false, scan: false, find: '' };
    const fresh = { item: null, qty: 1, bin: null, reason: null, photo: null, photoUrl: null, gm: '', viaList: false, binTapped: false, find: '' };
    ctx.body.innerHTML = '<div class="k-stack kr-wrap" id="kr-l"></div>';
    const root = $('#kr-l', ctx.body);
    let zone = null, busy = false, findTmr = null, findSeq = 0;
    const taps = () => manual && !st.scan;
    async function onCode(code, z) {
      const c = String(code).trim().toUpperCase();
      if (st.item && trays.includes(c)) { await submit(c, z, false); return; }
      if (st.item && /-QR-\d+$/.test(c)) { z.reject(t(c + ' bukan baki dark store ini.', c + ' is not a tray of this dark store.')); return; }
      try {
        const r = await api().get('/quarantine/lookup' + api().qs({ site_id: ctx.siteId, code }));
        st.item = r; st.bin = r.bin; st.qty = 1; st.viaList = false; st.binTapped = false;
        z.accept(r.sku_name);
        paint();
      } catch (e) { z.reject(S.pick(e.message)); }
    }
    /* Mode manual: the product tapped in the list. */
    async function pickSku(id) {
      if (busy) return;
      busy = true;
      try {
        const r = await api().get('/quarantine/lookup' + api().qs({ site_id: ctx.siteId, sku_id: id }));
        st.item = r; st.bin = r.bin; st.qty = 1; st.viaList = true; st.binTapped = false; st.find = '';
      } catch (e) { S.fail(e); }
      busy = false;
      paint();
    }
    /* One report at a time; the idempotency key replays it after a lost connection. */
    async function submit(trayCode, z, tapped) {
      if (busy) { if (z) z.reject(t('Tunggu jawaban sebelumnya.', 'Wait for the last answer.')); return; }
      if (!st.reason) {
        if (z) z.reject(t('Pilih alasan dulu.', 'Choose a reason first.'));
        else S.toast(['Pilih alasan dulu.', 'Choose a reason first.'], 'caution');
        return;
      }
      const fd = new FormData();
      fd.append('site_id', ctx.siteId);
      fd.append('sku_id', st.item.sku_id);
      fd.append('qty', st.qty);
      fd.append('reason', st.reason);
      fd.append('tray_code', trayCode);
      if (st.reason === 'driver_rusak') { if (st.gm) fd.append('order_ref', st.gm); }
      else if (st.bin) fd.append('bin_code', st.bin);
      if (tapped || st.viaList || st.binTapped) fd.append('manual', 'true');
      if (st.photo) fd.append('photo', st.photo);
      const sc = 'qr-rep-' + ctx.siteId;
      fd.append('idempotency_key', S.scanKey(sc, [st.item.sku_id, st.qty, st.reason, st.bin || '', st.gm || '', trayCode].join('|')));
      busy = true;
      $$('[data-tray]', root).forEach((b) => { b.disabled = true; });
      try {
        const r = await api().form('/quarantine/report', fd);
        S.scanDone(sc);
        busy = false;
        if (z) z.accept(trayCode);
        S.toast(r.message, 'ok');
        Object.assign(st, fresh);
        paint();
      } catch (e) {
        if (!e.network) S.scanDone(sc);
        busy = false;
        $$('[data-tray]', root).forEach((b) => { b.disabled = false; });
        if (z) z.reject(S.pick(e.message)); else S.fail(e);
      }
    }
    const scanLink = (id) => '<button type="button" class="k-linkbtn" data-scanok id="' + id + '" style="align-self:flex-start">' + icon('scan', 16) + sp('Masih bisa pindai?', 'Scanner still works?') + '</button>';
    function paint() {
      const it = st.item;
      const card = (no, id, en, body, done) => '<div class="k-card k-card--pad k-stack k-stack--tight"' + (done === false ? ' style="opacity:.55"' : '') + '><span class="kr-step">' + no + ' · ' + esc(t(id, en)) + '</span>' + body + '</div>';
      const binPick = it && taps() && st.reason !== 'driver_rusak' && it.bins.length
        ? '<div class="k-stack k-stack--tight"><span class="kr-sub" ' + biAttr('Dari bin mana? Ketuk binnya.', 'From which bin? Tap the bin.') + '></span><div class="kr-grid">' +
          it.bins.map((b) => '<button type="button" class="k-btn" data-bin="' + esc(b.bin) + '" aria-pressed="' + (b.bin === st.bin) + '"><span class="k-mono k-strong">' + esc(b.bin) + '</span>&nbsp;' +
            '<span class="kr-sub">' + esc(t(b.free + ' bebas', b.free + ' free')) + '</span></button>').join('') + '</div></div>' : '';
      const s1 = it ? '<div class="kr-item"><span class="k-row__icon k-row__icon--ok" style="width:36px;height:36px">' + icon('check', 18, 2.8) + '</span><div class="k-grow"><div class="kr-name" style="font-size:17px">' + esc(it.sku_name) + '</div>' +
        '<div class="kr-sub">' + esc(st.qty + ' unit') + (st.reason === 'driver_rusak' ? '' : st.bin ? ' · ' + esc(t('dari bin ', 'from bin ')) + '<span class="k-mono k-strong">' + esc(st.bin) + '</span>' : ' · ' + esc(t('tanpa stok bebas', 'no free stock'))) + '</div></div>' +
        '<button type="button" class="k-linkbtn" id="kr-chg" ' + biAttr('Ubah', 'Change') + '></button></div>' + binPick
        : taps() ? '<div class="k-stack k-stack--tight"><input class="k-input" id="kr-find" type="search" autocomplete="off" data-ph-id="Cari nama produk" data-ph-en="Search the product name" placeholder="' + esc(t('Cari nama produk', 'Search the product name')) + '" value="' + esc(st.find) + '">' +
          '<div class="k-list" id="kr-res"></div>' + scanLink('kr-scanok1') + '</div>'
          : '<div id="kr-zone1"></div>';
      const s2 = '<div class="kr-grid">' + REASONS.map((r) => '<button type="button" class="k-btn' + (r[0] === 'driver_rusak' ? ' kr-wide' : '') + '" data-r="' + r[0] + '" aria-pressed="' + (st.reason === r[0]) + '">' +
        (st.reason === r[0] ? icon('check', 18, 2.6) : '') + sp(r[1], r[2]) + '</button>').join('') + '</div>' +
        (st.reason === 'driver_rusak' ? '<label class="k-field"><span class="k-field__label" ' + biAttr('Nomor pesanan (GM)', 'Order number (GM)') + '></span><input class="k-input k-mono" id="kr-gm" value="' + esc(st.gm) + '" placeholder="GM-347"></label>' +
          '<p class="k-caption" ' + biAttr('Beban Ninja. Ops HQ klaim ke Grab di luar WMS.', 'Ninja\'s cost. Ops HQ claims it from Grab outside the WMS.') + '></p>' : '');
      const s3 = '<div class="k-line" style="gap:12px">' + '<span class="kr-thumb" style="width:72px;height:72px">' + (st.photoUrl ? '<img alt="" src="' + st.photoUrl + '">' : icon('camera', 26)) + '</span>' +
        '<div class="k-grow">' + (st.photo ? '<span class="k-line" style="gap:6px;color:var(--ok);font-weight:700">' + icon('check', 16, 2.6) + sp('Foto tersimpan', 'Photo saved') + '</span>' : '<span class="kr-sub" ' + biAttr('Foto barang dan kerusakannya.', 'Photograph the unit and the damage.') + '></span>') + '</div>' +
        '<label class="k-btn k-btn--secondary k-btn--sm">' + (st.photo ? sp('Ulangi', 'Retake') : icon('camera', 16) + sp('Ambil foto', 'Take a photo')) +
        '<input type="file" accept="image/*" capture="environment" id="kr-photo" hidden></label></div>';
      const s4 = taps()
        ? '<span class="kr-sub" ' + biAttr('Taruh barang di baki, lalu ketuk bakinya di bawah. Barang langsung tidak dijual di Grab.', 'Put the unit in the tray, then tap the tray below. It stops selling on Grab at once.') + '></span>'
        : '<div class="k-target" style="padding:14px"><div class="k-target__text"><span class="k-target__code k-target__code--md">' + esc(trays[0] || '') + '</span>' +
          '<span class="k-target__hint" ' + biAttr('Taruh barang di baki, lalu pindai label baki. Barang langsung tidak dijual di Grab.', 'Put the unit in the tray, then scan the tray label. It stops selling on Grab at once.') + '></span></div></div>' +
          '<button type="button" class="k-linkbtn" id="kr-typetray" style="align-self:center" ' + biAttr('Ketik kode baki', 'Type the tray code') + '></button>';
      const ready = !!(it && st.reason);
      root.innerHTML = (taps() ? '<div class="k-note k-note--caution">' + icon('warn', 20) + sp('Mode manual: pilih barang dan bin dari daftar, lalu ketuk bakinya. Tercatat sebagai laporan manual.',
          'Manual mode: pick the product and bin from the lists, then tap the tray. Recorded as a manual report.') + '</div>' : '') +
        card(1, it ? (st.viaList ? 'Barang dipilih' : 'Barang dipindai') : taps() ? 'Pilih barang' : 'Pindai barang',
          it ? (st.viaList ? 'Product picked' : 'Unit scanned') : taps() ? 'Pick the product' : 'Scan the unit', s1) +
        card(2, 'Pilih alasan', 'Choose a reason', s2, !!it) + card(3, 'Foto', 'Photo', s3, !!it) +
        card(4, 'Taruh di baki karantina', 'Put it in the quarantine tray', s4, ready) +
        (taps() ? '' : '<div id="kr-zone2" class="k-sr"></div>') +
        '<div class="k-actionbar">' + (taps()
          ? trays.map((c, i) => '<button type="button" class="k-btn ' + (i ? 'k-btn--secondary' : 'k-btn--primary') + ' k-btn--lg k-btn--block" data-tray="' + esc(c) + '"' + (ready ? '' : ' disabled') + '>' +
              icon('check', 22) + sp('Sudah di baki ' + c, 'In tray ' + c) + '</button>').join('')
          : '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" id="kr-go"' + (ready ? '' : ' disabled') + '>' + icon('scan', 22) + sp('Pindai label baki', 'Scan the tray label') + '</button>') + '</div>';
      zone = taps() ? null : S.scan(onCode, { title: it ? ['Pindai label baki', 'Scan the tray label'] : ['Pindai barang yang bermasalah', 'Scan the problem unit'], mount: $(it ? '#kr-zone2' : '#kr-zone1', root) });
      $$('[data-r]', root).forEach((b) => b.addEventListener('click', () => { if (!st.item) return; st.reason = b.dataset.r; paint(); }));
      $$('[data-bin]', root).forEach((b) => b.addEventListener('click', () => { st.bin = b.dataset.bin; st.binTapped = true; paint(); }));
      $$('[data-scanok]', root).forEach((b) => b.addEventListener('click', () => { st.scan = true; paint(); }));
      $$('[data-tray]', root).forEach((b) => b.addEventListener('click', () => { if (st.item && st.reason) submit(b.dataset.tray, null, true); }));
      const gm = $('#kr-gm', root);
      if (gm) gm.addEventListener('input', () => { st.gm = gm.value.trim(); });
      $('#kr-photo', root).addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        st.photo = f;
        if (st.photoUrl) URL.revokeObjectURL(st.photoUrl);
        st.photoUrl = URL.createObjectURL(f);
        paint();
      });
      const chg = $('#kr-chg', root);
      if (chg) chg.addEventListener('click', () => changeItem());
      const go = $('#kr-go', root);
      if (go) go.addEventListener('click', () => {
        if (!st.item || !st.reason) return;
        if (zone && zone.el.querySelector('[data-cam]')) zone.openCamera(); else typeTray();
      });
      const tt = $('#kr-typetray', root);
      if (tt) tt.addEventListener('click', typeTray);
      const find = $('#kr-find', root);
      if (find) {
        find.addEventListener('input', () => { st.find = find.value; clearTimeout(findTmr); findTmr = setTimeout(search, 250); });
        search();
      }
      S.applyLang(root);
    }
    /* Mode manual: the searchable product list (name or brand SKU code). */
    async function search() {
      const res = $('#kr-res', root);
      if (!res) return;
      const q = st.find.trim();
      if (q.length < 2) { res.innerHTML = '<p class="kr-sub" style="padding:4px 0">' + esc(t('Ketik minimal 2 huruf nama produk.', 'Type at least 2 letters of the product name.')) + '</p>'; return; }
      const my = ++findSeq;
      let rows = [];
      try { rows = (await api().get('/skus' + api().qs({ q, site_id: ctx.siteId, limit: 12 }))).skus || []; }
      catch (e) { S.fail(e); return; }
      if (my !== findSeq || !res.isConnected) return;
      res.innerHTML = rows.length ? rows.map((s) => '<button type="button" class="k-row" data-sku="' + s.id + '" style="width:100%;text-align:left">' +
          thumb(s.photo_key ? '/api/photos/' + s.photo_key : null) + '<span class="k-row__text" style="margin-left:10px"><span class="k-row__title">' + esc(s.name_display) + '</span>' +
          (s.unit_size ? '<span class="k-row__sub">' + esc(s.unit_size) + '</span>' : '') + '</span></button>').join('')
        : '<p class="kr-sub" style="padding:4px 0">' + esc(t('Tidak ada produk yang cocok.', 'No matching product.')) + '</p>';
      $$('[data-sku]', res).forEach((b) => b.addEventListener('click', () => pickSku(+b.dataset.sku)));
    }
    function typeTray() {
      if (!st.item || !st.reason) { S.toast(['Pindai barang dan pilih alasan dulu.', 'Scan the unit and choose a reason first.'], 'caution'); return; }
      S.modal({
        title: ['Ketik kode baki', 'Type the tray code'],
        body: '<input class="k-input k-mono" id="kr-tc" value="' + esc(trays[0] || '') + '" autocapitalize="characters">',
        actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, { label: ['Taruh di baki', 'Put in the tray'], kind: 'primary', onClick: async () => { await submit($('#kr-tc').value.trim().toUpperCase(), null, false); } }],
      });
    }
    function changeItem() {
      const it = st.item;
      const m = S.modal({
        title: ['Ubah jumlah atau bin', 'Change the quantity or bin'],
        body: '<div class="k-stack"><div class="k-field"><span class="k-field__label" ' + biAttr('Jumlah unit', 'Units') + '></span><div id="kr-q"></div></div>' +
          (st.reason === 'driver_rusak' ? '' : '<label class="k-field"><span class="k-field__label">Bin</span><select class="k-select" id="kr-b">' + it.bins.map((b) => '<option value="' + esc(b.bin) + '"' + (b.bin === st.bin ? ' selected' : '') + '>' +
            esc(b.bin + ' · ' + t(b.free + ' unit bebas', b.free + ' free')) + '</option>').join('') + '</select></label>') +
          '<button type="button" class="k-linkbtn" id="kr-other" ' + (taps() ? biAttr('Pilih barang lain', 'Pick another product') : biAttr('Pindai barang lain', 'Scan another unit')) + '></button></div>',
        actions: [{ label: ['Simpan', 'Save'], kind: 'primary', onClick: () => {
          st.qty = q.get();
          const b = $('#kr-b');
          if (b && b.value !== st.bin) { st.bin = b.value; st.binTapped = true; }
          paint();
        } }],
      });
      const q = S.stepper($('#kr-q', m.body), { value: st.qty, min: 1, max: 99 });
      $('#kr-other', m.body).addEventListener('click', () => { m.close(); Object.assign(st, { item: null, reason: null, viaList: false, binTapped: false }); paint(); });
    }
    paint();
  });
})();
