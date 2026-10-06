/* barang-masuk.js: receive a brand delivery (canvas section 5, boards 5a to 5j).
 *
 * One page, several steps, chosen by the URL:
 *   (none)                       5a  open the delivery: Ninja reference or brand PO number
 *   ?nopo=<code>                 5i  a number the WMS does not know
 *   ?receipt=<id>                5b  door check (cartons, SPV decision) and what is expected;
 *                                5h  the receipt once finished (Faktur, slip)
 *   ?receipt=<id>&step=scan      5c  scan every unit into temporary bins (5d damaged mode)
 *   ?receipt=<id>&step=manual    5c2 pick a product with no barcode from the list
 *   ?receipt=<id>&step=putaway   5e  the batch to put away; 5f each bin to its rack bin
 *   ?receipt=<id>&step=summary   5g  all received: the three photos, Selesai
 *   ?slip=<id>                   5j  the putaway slip: thermal 80 mm slip (js/print.js),
 *                                    A4 when this device has no thermal printer
 *
 * API (backend/routers/inbound.py, faktur.py): /api/inbound/... and
 * /api/receipts/{id}/faktur. Units in a temporary bin are not stock; the rack
 * scan makes them sellable and tells Hiryu.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const API = () => S.api();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const key = () => 'bm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const n = (v) => S.fmt.n(v);

  /* ---------- page styles that kilat.css has no class for ---------- */
  function styles() {
    if ($('#bm-style')) return;
    const st = document.createElement('style');
    st.id = 'bm-style';
    st.textContent = [
      '.bm-wrap{max-width:720px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:16px}',
      '.bm-wrap--wide{max-width:1200px}',
      '.bm-ref{font-family:var(--mono);font-weight:700;font-size:26px;line-height:1.15;overflow-wrap:anywhere}',
      '.bm-opt{display:flex;gap:12px;align-items:flex-start;text-align:left;width:100%;padding:16px;border-radius:16px;background:var(--surface);border:2px solid var(--rule);font:inherit;color:var(--ink);cursor:pointer}',
      '.bm-opt:hover{border-color:var(--action)}',
      '.bm-opt[aria-pressed="true"]{border-color:var(--action);background:var(--action-bg)}',
      '.bm-opt__title{font-size:17px;font-weight:700;display:block}',
      '.bm-opt__sub{font-size:14px;color:var(--ink-2);display:block;margin-top:2px}',
      '.bm-damage{border:2px solid var(--stop);background:var(--stop-bg)}',
      '.bm-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
      '.bm-steps li{display:flex;gap:10px;align-items:flex-start;font-size:16px;font-weight:600;line-height:1.35}',
      '.bm-num{flex-shrink:0;width:28px;height:28px;border-radius:999px;background:var(--navy);color:#FFF;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}',
      '.bm-num--ok{background:var(--ok)}',
      '.bm-swatch{display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid var(--rule-2,#C9CED6);vertical-align:-2px;margin-right:4px}',
      '.bm-photo{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid var(--rule)}',
      '.bm-photo:first-child{border-top:0}',
      '.bm-photo__text{flex-grow:1;font-weight:600;font-size:15px}',
      '.bm-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}',
      '.bm-drop{border:2px dashed var(--rule-2,#C9CED6);border-radius:14px;padding:20px;text-align:center;color:var(--ink-2)}',
      '.bm-drop.is-over{border-color:var(--action);background:var(--action-bg)}',
      '.bm-pages{display:flex;gap:10px;flex-wrap:wrap}',
      '.bm-page{width:92px;height:120px;border-radius:10px;border:1px solid var(--rule);background:var(--sunk);display:flex;align-items:flex-end;justify-content:center;padding:6px;font-size:13px;font-weight:700;color:var(--ink-2);background-size:cover;background-position:center;text-decoration:none}',
      '.bm-next{border:2px solid var(--action)}',
      '#k-body .k-table td.k-mono{white-space:nowrap}',
      '.bm-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}',
      '@media (min-width:1024px){.bm-cols{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)}}',
      '.bm-mini td,.bm-mini th{padding:8px 10px}',
      '.bm-roll{background:var(--sunk);border-radius:16px;padding:20px 12px;overflow-x:auto;display:flex;justify-content:center}',
      '.bm-roll .njw-slip{padding:4mm;box-shadow:var(--shadow);flex:none}',
      '@media (min-width:768px){.bm-roll .njw-slip{zoom:1.3}}',
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- small builders ---------- */
  const p2 = (id, en) => '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  const btn = (cls, id, en, attrs, ic) => '<button type="button" class="k-btn ' + (cls || '') + '" ' + (attrs || '') + '>' +
    (ic ? icon(ic, 22, 2.2) : '') + p2(id, en) + '</button>';
  const note = (kind, id, en, ic) => '<div class="k-note k-note--' + kind + '">' + icon(ic || (kind === 'caution' || kind === 'stop' ? 'warn' : 'info'), 20) +
    '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span></div>';
  const short = (s) => String(s || '').replace(/^(Labore|Kahf)\s+/i, '');
  const hub = () => S.shortCode((S.site() && S.site().code) || '');

  function go(params, replace) {
    const u = new URL(location.href);
    ['receipt', 'step', 'nopo', 'slip', 'i'].forEach((k) => u.searchParams.delete(k));
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    history[replace ? 'replaceState' : 'pushState'](null, '', u.pathname + u.search);
    S.rerender();
  }
  window.addEventListener('popstate', () => S.rerender());

  function fileInput(accept, multiple, capture) {
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = accept || 'image/*';
    f.className = 'bm-file';
    if (multiple) f.multiple = true;
    if (capture) f.setAttribute('capture', capture);
    document.body.appendChild(f);
    return f;
  }
  function pickFiles(accept, multiple, capture) {
    return new Promise((ok) => {
      const f = fileInput(accept, multiple, capture);
      f.addEventListener('change', () => { const files = Array.from(f.files || []); f.remove(); ok(files); });
      f.click();
    });
  }

  function linePill(l) {
    const e = l.qty_expected;
    switch (l.state) {
      case 'match': return S.pill('ok', 'cocok', 'match');
      case 'short': return S.pill('caution', 'kurang ' + (e - l.qty_received), (e - l.qty_received) + ' short');
      case 'extra': return S.pill('caution', 'lebih ' + (l.qty_received - e), (l.qty_received - e) + ' extra');
      case 'counting': return S.pill('info', 'baru', 'in progress');
      case 'counted': return S.pill('info', 'dihitung', 'counted');
      default: return '<span class="k-muted" ' + biAttr('belum', 'not yet') + '>' + esc(t('belum', 'not yet')) + '</span>';
    }
  }
  const count = (l) => n(l.qty_received) + (l.qty_expected != null ? '/' + n(l.qty_expected) : '');
  const binShort = (code) => String(code || '').replace(/^[A-Z0-9]+-(?=IN-|QR-)/, '');
  function rackWords(code) {
    const m = /([A-Z]+)-(\d+)-(\d+)([TB])?$/.exec(String(code || ''));
    if (!m) return null;
    const pos = m[4] === 'T' ? ['atas', 'top'] : m[4] === 'B' ? ['bawah', 'bottom'] : null;
    return ['Rak ' + m[1] + ', level ' + (+m[2]) + ', bin ' + m[3] + (pos ? ', ' + pos[0] : ''),
      'Rack ' + m[1] + ', level ' + (+m[2]) + ', bin ' + m[3] + (pos ? ', ' + pos[1] : '')];
  }

  async function getReceipt(id) { return API().get('/inbound/receipts/' + id); }

  /* ================= 5a: open the delivery ================= */

  async function home(ctx) {
    S.fullScreen(false);
    S.setSub('Lihat Surat Jalan. Ketik atau pindai nomornya.', 'Look at the Surat Jalan. Type or scan its number.');
    const siteId = S.siteId();
    const [dl, recent] = await Promise.all([
      API().get('/inbound/deliveries' + API().qs({ site_id: siteId })),
      API().get('/inbound/receipts' + API().qs({ site_id: siteId, limit: 30 })),
    ]);
    const row = (d, today) => '<button type="button" class="k-row bm-dl" data-ref="' + esc(d.reference) + '" style="width:100%;text-align:left">' +
      '<span class="k-row__icon">' + icon('truck', 26) + '</span><span class="k-row__text">' +
      '<span class="k-row__title k-mono" style="white-space:nowrap">' + esc(d.reference) + '</span>' +
      '<span class="k-row__sub">' + esc(d.brand_name) + ' · ' + n(d.sku_count) + ' SKU · ' + n(d.units) + ' unit' +
      (d.brand_po_number ? ' · ' + esc(d.brand_po_number) : '') + '</span>' +
      '<span style="margin-top:4px">' + (d.receipt_id ? S.pill('info', 'Sedang diterima', 'Being received')
        : today ? S.pill('ok', 'Tiba hari ini', 'Arrives today')
          : '<span class="k-muted" style="font-size:14px">' + p2('Perkiraan', 'Expected') + ' ' + esc(d.eta_date ? S.fmt.day(d.eta_date) : '-') + '</span>') +
      '</span></span></button>';
    const openNoPo = recent.receipts.filter((r) => r.status === 'open' && r.no_po);
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      '<form class="k-card k-card--pad k-stack" id="bm-open">' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Ninja reference atau No. PO merek', 'Ninja reference or brand PO number') + '></span>' +
        '<input class="k-input k-mono" id="bm-code" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-size:20px">' +
        '<span class="k-field__hint" ' + biAttr('Contoh: RPL-MA5-2609-002 atau PO/PRG/2610/0457', 'For example: RPL-MA5-2609-002 or PO/PRG/2610/0457') + '></span></label>' +
      '</form>' +
      '<div class="k-stack k-stack--tight">' + bis('Kiriman hari ini', 'Deliveries today', 'k-eyebrow') +
        (dl.today.length ? '<div class="k-list">' + dl.today.map((d) => row(d, true)).join('') + '</div>'
          : '<p class="k-caption" ' + biAttr('Tidak ada kiriman yang dijadwalkan hari ini.', 'No delivery is scheduled today.') + '></p>') +
      '</div>' +
      (dl.next.length ? '<div class="k-stack k-stack--tight">' + bis('Berikutnya', 'Next', 'k-eyebrow') +
        '<div class="k-list">' + dl.next.map((d) => row(d, false)).join('') + '</div></div>' : '') +
      (openNoPo.length ? '<div class="k-stack k-stack--tight">' + bis('Tanpa PO, sedang dihitung', 'No PO, being counted', 'k-eyebrow') +
        '<div class="k-list">' + openNoPo.map((r) => '<a class="k-row k-row--caution" href="?receipt=' + r.id + '&step=scan">' +
          '<span class="k-row__icon k-row__icon--caution">' + icon('warn', 26) + '</span><span class="k-row__text">' +
          '<span class="k-row__title k-mono">' + esc(r.no_po_code || ('#' + r.id)) + '</span>' +
          '<span class="k-row__sub">' + esc(r.brand_name || '') + ' · ' + n(r.units) + ' unit</span></span>' +
          '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div></div>' : '') +
      note('info', 'Di pintu: cocokkan jumlah karton dengan Surat Jalan saja. Beda? Panggil SPV. Barang dihitung per unit (pcs) saat dipindai. Jangan tanda tangan dulu.',
        'At the door: only check the carton count against the Surat Jalan. Different? Call the SPV. Goods are counted per unit (pcs) when scanned. Do not sign yet.') +
      '<div class="k-laptop-only k-stack k-stack--tight" style="margin-top:8px">' + bis('Penerimaan terakhir', 'Recent receipts', 'k-eyebrow') + receiptTable(recent.receipts) + '</div>' +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Buka penerimaan', 'Open receipt', 'id="bm-go"', 'arrow') + '</div>' +
      '</div>';
    const code = $('#bm-code', ctx.body);
    $$('.bm-dl', ctx.body).forEach((b) => b.addEventListener('click', () => {
      $$('.bm-dl', ctx.body).forEach((x) => x.classList.remove('bm-next'));
      b.classList.add('bm-next');
      code.value = b.dataset.ref;
    }));
    const submit = async (e) => {
      if (e) e.preventDefault();
      const c = code.value.trim();
      if (!c) { S.toast(['Ketik atau pindai nomornya dulu.', 'Type or scan the number first.'], 'caution'); code.focus(); return; }
      await openByCode(c);
    };
    $('#bm-open', ctx.body).addEventListener('submit', submit);
    $('#bm-go', ctx.body).addEventListener('click', submit);
  }

  function receiptTable(rows) {
    if (!rows.length) return '<p class="k-caption" ' + biAttr('Belum ada penerimaan.', 'No receipts yet.') + '></p>';
    return '<div class="k-tablewrap"><table class="k-table"><thead><tr>' +
      '<th ' + biAttr('Kiriman', 'Delivery') + '></th><th ' + biAttr('Merek', 'Brand') + '></th><th ' + biAttr('Dibuka', 'Opened') + '></th>' +
      '<th class="k-num" ' + biAttr('Unit', 'Units') + '></th><th ' + biAttr('Status', 'Status') + '></th><th></th></tr></thead><tbody>' +
      rows.map((r) => {
        const st = r.status === 'open' ? S.pill('info', 'Sedang diterima', 'Receiving')
          : r.status === 'refused' ? S.pill('stop', 'Ditolak', 'Refused')
            : r.pending_differences ? S.pill('caution', 'Menunggu Ops HQ', 'Waiting for Ops HQ')
              : !r.faktur_uploaded_at ? S.pill('caution', 'Faktur belum diunggah', 'Faktur not uploaded')
                : S.pill('ok', 'Selesai', 'Done');
        return '<tr><td class="k-mono k-strong">' + esc(r.reference || r.no_po_code || ('#' + r.id)) +
          (r.no_po && !r.reference ? ' ' + S.pill('caution', 'Tanpa PO', 'No PO') : '') + '</td>' +
          '<td>' + esc(r.brand_name || '-') + '</td><td>' + esc(S.fmt.dt(r.opened_at)) + '</td>' +
          '<td class="k-num">' + n(r.units) + '</td><td>' + st + '</td>' +
          '<td class="k-table__actions"><a class="k-btn k-btn--sm k-btn--secondary" href="?receipt=' + r.id + '" ' + biAttr('Buka', 'Open') + '></a></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function openByCode(c) {
    const siteId = S.siteId();
    let res;
    try { res = await API().get('/inbound/lookup' + API().qs({ site_id: siteId, code: c })); } catch (e) { S.fail(e); return; }
    const live = res.matches.filter((m) => m.status === 'confirmed' || m.status === 'receiving');
    if (!res.matches.length) { go({ nopo: c }); return; }
    if (!live.length) { S.toast(res.message || ['Kiriman ini sudah diterima.', 'Already received.'], 'caution'); return; }
    let pick = live[0];
    if (live.length > 1) {
      pick = await new Promise((ok) => {
        S.modal({
          title: ['Pilih merek', 'Choose the brand'],
          body: '<p class="k-p" ' + biAttr('Nomor ini dipakai lebih dari satu merek. Lihat merek di Surat Jalan.', 'This number is used by more than one brand. Check the brand on the Surat Jalan.') + '></p>',
          actions: live.map((m) => ({ label: [m.brand_name + ' · ' + m.reference, m.brand_name + ' · ' + m.reference], kind: 'secondary', onClick: () => ok(m) })),
          onClose: () => ok(null),
        });
      });
      if (!pick) return;
    }
    try {
      const r = await API().post('/inbound/receipts', { site_id: siteId, replenishment_id: pick.replenishment_id });
      go({ receipt: r.id });
    } catch (e) { S.fail(e); }
  }

  /* ================= 5i: no PO ================= */

  async function noPo(ctx, code) {
    S.fullScreen(true, { title: ['PO tidak ditemukan', 'PO not found'], onBack: () => go({}) });
    const brands = (await API().get('/brands')).filter((b) => b.active);
    const st = { photo: null, brand: brands.length === 1 ? brands[0].id : null };
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('PO tidak ditemukan', 'PO not found') + '></h2>' +
      '<p class="k-p"><span class="k-mono k-strong">' + esc(code) + '</span> ' +
        p2('tidak ada di WMS. Tetap terima, Ops HQ yang mencocokkan.', 'is not in the WMS. Receive it anyway; Ops HQ will match it.') + '</p></div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('1. Foto Surat Jalan', '1. Photo of the Surat Jalan', 'k-strong') +
        '<div id="bm-sjph"></div></div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('2. Pilih merek', '2. Choose the brand', 'k-strong') +
        '<div class="k-segment" role="group" id="bm-brand">' + brands.map((b) => '<button type="button" data-b="' + b.id + '" aria-pressed="' + (st.brand === b.id) + '">' + esc(b.name) + '</button>').join('') + '</div></div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('3. Hitung karton', '3. Count the cartons', 'k-strong') +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Karton di Surat Jalan', 'Cartons on the Surat Jalan') + '></span><div id="bm-sjc"></div></label></div>' +
      '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + S.pill('caution', 'Segera', 'Urgent') + ' ' +
        p2('Ops HQ diberi tahu sekarang, harus menjawab segera.', 'Ops HQ is told now and must answer at once.') + '</span></div>' +
      note('info', 'Unit dipindai ke bin sementara seperti biasa, tapi belum jadi stok. Baru jadi stok setelah Ops HQ menghubungkan kiriman ini ke permintaan restock.',
        'Units are scanned into temporary bins as usual, but are not stock yet. They become stock once Ops HQ links this delivery to a restock request.') +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Kirim ke Ops HQ, lalu hitung', 'Send to Ops HQ, then count', 'id="bm-send"', 'arrow') + '</div></div>';
    const sjc = S.stepper($('#bm-sjc', ctx.body), { value: 1, min: 0, max: 999 });
    const paintPh = () => {
      $('#bm-sjph', ctx.body).innerHTML = st.photo
        ? '<div class="k-line">' + S.pill('ok', 'Foto diambil', 'Photo taken') + '<button type="button" class="k-linkbtn" id="bm-sjre" ' + biAttr('Ambil ulang', 'Retake') + '></button></div>'
        : btn('k-btn--secondary k-btn--block', 'Foto Surat Jalan', 'Photo of the Surat Jalan', 'id="bm-sjre"', 'camera');
      S.applyLang($('#bm-sjph', ctx.body));
      $('#bm-sjre', ctx.body).addEventListener('click', async () => {
        const f = await pickFiles('image/*', false, 'environment');
        if (f[0]) { st.photo = f[0]; paintPh(); }
      });
    };
    paintPh();
    $$('#bm-brand button', ctx.body).forEach((b) => b.addEventListener('click', () => {
      st.brand = +b.dataset.b;
      $$('#bm-brand button', ctx.body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('#bm-send', ctx.body).addEventListener('click', async (e) => {
      if (!st.photo) { S.toast(['Foto Surat Jalan dulu.', 'Take the Surat Jalan photo first.'], 'caution'); return; }
      if (!st.brand) { S.toast(['Pilih merek.', 'Choose the brand.'], 'caution'); return; }
      const fd = new FormData();
      fd.append('site_id', S.siteId());
      fd.append('brand_id', st.brand);
      fd.append('code', code);
      fd.append('sj_cartons', sjc.get());
      fd.append('photo', st.photo);
      e.currentTarget.disabled = true;
      try {
        const r = await API().form('/inbound/receipts/no-po', fd);
        S.toast(['Ops HQ sudah diberi tahu. Mulai pindai.', 'Ops HQ has been told. Start scanning.'], 'ok');
        go({ receipt: r.id, step: r.can_scan ? 'scan' : '' }, true);
      } catch (err) { S.fail(err); e.currentTarget.disabled = false; }
    });
  }

  /* ================= 5b: door check and what is expected ================= */

  function headHtml(R) {
    return '<div class="k-stack k-stack--tight">' +
      '<span class="k-eyebrow">' + esc(R.brand_name || '') + '</span>' +
      '<span class="bm-ref">' + esc(R.reference || R.no_po_code || ('#' + R.id)) + '</span>' +
      '<span class="k-caption">' + (R.brand_po_number ? p2('No. PO merek', 'Brand PO') + ' <span class="k-mono">' + esc(R.brand_po_number) + '</span> · ' : '') +
        p2('tiba', 'arrived') + ' ' + esc(S.fmt.time(R.opened_at)) +
        (R.no_po && !R.no_po_linked ? ' · ' + S.pill('caution', 'Tanpa PO: menunggu Ops HQ', 'No PO: waiting for Ops HQ') : '') + '</span></div>';
  }

  async function door(ctx, R) {
    S.fullScreen(false);
    S.setSub('Cek karton di pintu, lalu pindai per unit.', 'Check the cartons at the door, then scan per unit.');
    const cs = R.carton_state;
    const started = R.total_received > 0;
    let carton = '';
    if (cs === 'waiting_spv') {
      carton = '<div class="k-card k-card--pad k-card--caution k-stack">' +
        '<span class="k-strong" style="color:var(--caution)">' + icon('warn', 20) + ' ' +
          p2('Surat Jalan: ' + R.sj_cartons + ' karton, dihitung: ' + R.counted_cartons, 'Surat Jalan: ' + R.sj_cartons + ' cartons, counted: ' + R.counted_cartons) + '</span>' +
        '<div class="k-line">' + bis('Keputusan SPV', 'SPV decision', 'k-strong') + ' ' + S.roleChip('supervisor') +
          (S.atLeast('supervisor') ? '' : ' <span class="k-caption" ' + biAttr('Panggil SPV sekarang', 'Call the SPV now') + '></span>') + '</div>' +
        '<div class="k-grid2">' + btn('k-btn--secondary', 'Terima & tulis ulang', 'Accept and rewrite', 'data-cd="accept_rewrite" data-min-role="supervisor"', 'check') +
          btn('k-btn--problem', 'Tolak', 'Refuse', 'data-cd="refuse" data-min-role="supervisor"', 'close') + '</div>' +
        '<span class="k-caption" ' + biAttr('Tulis ulang langsung dilaporkan ke Ops HQ.', 'A rewrite is reported to Ops HQ at once.') + '></span></div>';
    } else if (cs === 'refused') {
      carton = '<div class="k-card k-card--pad k-card--stop">' + bis('Kiriman ditolak SPV. Jangan tanda tangan Surat Jalan.', 'The SPV refused this delivery. Do not sign the Surat Jalan.', 'k-strong') + '</div>';
    } else {
      carton = '<div class="k-card k-card--pad k-stack">' +
        '<div class="k-grid2"><label class="k-field"><span class="k-field__label" ' + biAttr('Karton di Surat Jalan', 'Cartons on the Surat Jalan') + '></span><div id="bm-sj"></div></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Karton dihitung', 'Cartons counted') + '></span><div id="bm-cnt"></div></label></div>' +
        (cs === 'match' ? S.pill('ok', 'Karton cocok', 'Cartons match')
          : cs === 'accepted_rewrite' ? S.pill('ok', 'Diterima SPV, Surat Jalan ditulis ulang. Ops HQ diberi tahu.', 'Accepted by the SPV, Surat Jalan rewritten. Ops HQ told.')
            : btn('k-btn--secondary k-btn--block', 'Cek karton', 'Check cartons', 'id="bm-cc"', 'check')) +
        '<span class="k-caption" ' + biAttr('Cek pintu saja, bukan stok.', 'A door check only, never stock.') + '></span></div>';
    }
    const exp = R.lines.filter((l) => l.qty_expected);
    ctx.body.innerHTML = '<div class="bm-wrap">' + headHtml(R) +
      '<div class="k-stack k-stack--tight">' + bis('Karton dihitung', 'Cartons counted', 'k-eyebrow') + carton + '</div>' +
      (exp.length ? '<div class="k-card k-card--pad k-stack k-stack--tight"><div class="k-line k-line--between">' + bis('Yang diharapkan', 'Expected', 'k-strong') +
        '<span class="k-mono k-strong">' + n(R.total_expected) + ' pcs</span></div>' +
        '<table class="k-table bm-mini"><tbody>' + exp.map((l) => '<tr><td>' + esc(short(l.sku_name)) + '</td><td class="k-num">' + n(l.qty_expected) + '</td></tr>').join('') + '</tbody></table></div>'
        : note('caution', 'Belum ada PO: hitung semua unit. Ops HQ yang mencocokkan.', 'No PO yet: count every unit. Ops HQ will match it.')) +
      (S.atLeast('hq') && R.no_po && !R.no_po_linked ? '<div>' + btn('k-btn--secondary', 'Hubungkan ke permintaan', 'Link to a request', 'id="bm-link" data-min-role="hq"', 'link') + '</div>' : '') +
      '<div class="k-actionbar">' +
        (started ? btn('k-btn--secondary k-btn--lg k-btn--block', 'Taruh di rak', 'Put on the rack', 'id="bm-toput"', 'rack') : '') +
        btn('k-btn--primary k-btn--lg k-btn--block', started ? 'Lanjut pindai' : 'Mulai pindai', started ? 'Continue scanning' : 'Start scanning', 'id="bm-start"' + (R.can_scan ? '' : ' disabled'), 'scan') +
      '</div></div>';
    if ($('#bm-sj', ctx.body)) {
      const a = S.stepper($('#bm-sj', ctx.body), { value: R.sj_cartons != null ? R.sj_cartons : 1, min: 0, max: 999 });
      const b = S.stepper($('#bm-cnt', ctx.body), { value: R.counted_cartons != null ? R.counted_cartons : 1, min: 0, max: 999 });
      if (cs !== 'not_counted') { a.input.disabled = true; b.input.disabled = true; $$('#bm-sj button, #bm-cnt button', ctx.body).forEach((x) => { x.disabled = true; }); }
      const cc = $('#bm-cc', ctx.body);
      if (cc) cc.addEventListener('click', async () => {
        try { await API().post('/inbound/receipts/' + R.id + '/cartons', { sj_cartons: a.get(), counted_cartons: b.get() }); S.rerender(); } catch (e) { S.fail(e); }
      });
    }
    $$('[data-cd]', ctx.body).forEach((b) => b.addEventListener('click', async () => {
      const d = b.dataset.cd;
      if (d === 'refuse' && !(await S.confirm({ title: ['Tolak kiriman?', 'Refuse the delivery?'], text: ['Kiriman ini tidak diterima. Driver membawanya kembali.', 'This delivery is not received. The driver takes it back.'], ok: ['Tolak', 'Refuse'], danger: true }))) return;
      try { await API().post('/inbound/receipts/' + R.id + '/carton-decision', { decision: d }); S.rerender(); } catch (e) { S.fail(e); }
    }));
    $('#bm-start', ctx.body).addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
    const tp = $('#bm-toput', ctx.body);
    if (tp) tp.addEventListener('click', () => go({ receipt: R.id, step: 'putaway' }));
    const lk = $('#bm-link', ctx.body);
    if (lk) lk.addEventListener('click', () => linkDialog(R));
  }

  async function linkDialog(R) {
    const res = await API().get('/inbound/no-po' + API().qs({ site_id: R.site_id, status: 'open' }));
    const me = res.deliveries.find((d) => d.receipt_id === R.id);
    const cands = me ? me.candidates : [];
    S.modal({
      title: ['Hubungkan ke permintaan', 'Link to a request'],
      body: cands.length ? '<div class="k-stack">' + cands.map((c, i) => '<label class="k-check"><input type="radio" name="bm-c" value="' + c.id + '"' + (i ? '' : ' checked') + '> <span class="k-mono">' +
        esc(c.reference) + '</span> ' + (c.brand_po_number ? '· ' + esc(c.brand_po_number) : '') + '</label>').join('') + '</div>'
        : '<p class="k-p" ' + biAttr('Tidak ada permintaan terbuka untuk merek ini di dark store ini.', 'No open request for this brand at this dark store.') + '></p>',
      actions: cands.length ? [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Hubungkan', 'Link'], kind: 'primary', minRole: 'hq', onClick: async (close, b) => {
          const v = $('input[name="bm-c"]:checked', b.closest('.k-modal'));
          await API().post('/inbound/receipts/' + R.id + '/link', { replenishment_id: +v.value });
          S.toast(['Kiriman dihubungkan.', 'Delivery linked.'], 'ok');
          S.rerender();
        },
      }] : [{ label: ['Tutup', 'Close'], kind: 'secondary' }],
    });
  }

  /* ================= 5c, 5d: scan every unit ================= */

  const SCAN = { last: null, damaged: false, pending: null, after: null };

  async function scanStep(ctx, R) {
    S.fullScreen(true, { title: ['Pindai barang', 'Scan the goods'], onBack: () => go({ receipt: R.id }) });
    if (!R.can_scan) { go({ receipt: R.id }, true); return; }
    if (!SCAN.last || SCAN.last.receipt_id !== R.id) {
      const filling = R.loads.filter((l) => l.status === 'filling');
      SCAN.last = filling.length ? filling[filling.length - 1] : null;
    }
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-scan"></div>';
    const host = $('#bm-scan', ctx.body);
    let zone = null;

    function targetHtml() {
      const l = SCAN.last && R.loads.find((x) => x.id === SCAN.last.id);
      if (!l || l.status !== 'filling') {
        return '<div class="k-target"><div class="k-target__text">' + bis('Pindai unit pertama', 'Scan the first unit', 'k-target__label') +
          '<span class="k-target__hint" ' + biAttr('Ambil satu unit dari karton, pindai barcodenya.', 'Take one unit from the carton, scan its barcode.') + '></span></div></div>';
      }
      const line = R.lines.find((x) => x.sku_id === l.sku_id) || {};
      const label = !l.label_scanned ? ['Produk baru: ambil bin kosong, pindai labelnya', 'New product: take an empty bin, scan its label']
        : l.is_extra ? ['Lebih dari yang diharapkan: tunggu Ops HQ', 'Above the expected quantity: waits for Ops HQ'] : ['Masukkan ke bin', 'Put it in bin'];
      return '<div class="k-target' + (l.is_extra ? ' k-target--stop' : '') + '"><div class="k-target__text">' +
        '<span class="k-target__label" ' + biAttr(label[0], label[1]) + '></span>' +
        '<span class="k-target__code k-target__code--md">' + esc(l.bin_code) + '</span>' +
        '<span class="k-target__hint">' + esc(l.bin_code) + ' ' + p2('untuk', 'for') + ' ' + esc(short(l.sku_name || line.sku_name)) +
          ' · <span class="k-mono">' + count(line) + '</span></span></div>' +
        btn('k-btn--secondary k-btn--sm', 'Bin penuh', 'Bin full', 'id="bm-full"') + '</div>';
    }

    function tableHtml() {
      return '<div class="k-tablewrap"><table class="k-table bm-mini"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th ' + biAttr('Bin', 'Bin') + '></th>' +
        '<th class="k-num" ' + biAttr('Unit', 'Units') + '></th><th ' + biAttr('Status', 'Status') + '></th></tr></thead><tbody>' +
        R.lines.map((l) => '<tr' + (SCAN.last && SCAN.last.sku_id === l.sku_id ? ' class="is-selected"' : '') + '><td>' + esc(short(l.sku_name)) +
          (l.qty_damaged ? ' <span class="k-tag" style="color:var(--stop)">' + n(l.qty_damaged) + ' ' + esc(t('rusak', 'damaged')) + '</span>' : '') + '</td>' +
          '<td class="k-mono" style="white-space:nowrap">' + esc(l.bins.map(binShort).join(', ') || '') + '</td>' +
          '<td class="k-num">' + count(l) + '</td><td>' + linePill(l) + '</td></tr>').join('') + '</tbody></table></div>';
    }

    function damageHtml() {
      if (!SCAN.damaged) return '';
      if (SCAN.after) {
        const a = SCAN.after;
        const q = a.place === 'quarantine';
        return '<div class="k-card k-card--pad bm-damage k-stack">' +
          '<span class="k-strong" style="color:var(--stop)">' + esc(short(a.sku_name)) + '</span>' + bis('Lalu:', 'Then:', 'k-strong') +
          '<ol class="bm-steps"><li><span class="bm-num bm-num--ok">' + icon('check', 16, 3) + '</span>' + p2('Unit rusak sudah dipindai', 'The damaged unit is scanned') + '</li>' +
          '<li><span class="bm-num">2</span>' + (q ? p2('Taruh di baki ' + R.quarantine_tray, 'Put it in the tray ' + R.quarantine_tray)
            : p2('Berikan ke driver. Tulis di Surat Jalan: ditolak, rusak.', 'Give it to the driver. Write on the Surat Jalan: refused, damaged.')) + '</li>' +
          '<li><span class="bm-num' + (a.photo_needed ? '' : ' bm-num--ok') + '">' + (a.photo_needed ? '3' : icon('check', 16, 3)) + '</span>' +
            p2('Ambil 1 foto kerusakannya', 'Take 1 photo of the damage') + '</li></ol>' +
          '<span class="k-caption" ' + biAttr('Dua pilihan ini dikirim ke Ops HQ untuk disetujui. Mode rusak mati sendiri setelah produk ini.', 'Both are sent to Ops HQ for approval. Damaged mode switches off by itself after this product.') + '></span>' +
          (a.photo_needed ? btn('k-btn--primary k-btn--lg k-btn--block', 'Ambil foto', 'Take photo', 'id="bm-dph"', 'camera')
            : btn('k-btn--secondary k-btn--block', 'Selesai, mode rusak mati', 'Done, damaged mode off', 'id="bm-doff"', 'check')) + '</div>';
      }
      if (SCAN.pending) {
        return '<div class="k-card k-card--pad bm-damage k-stack">' + bis('Unit rusak ini mau ke mana?', 'Where does this damaged unit go?', 'k-strong') +
          '<button type="button" class="bm-opt" data-dto="quarantine">' + icon('box', 26) + '<span><span class="bm-opt__title">' + p2('Masukkan ke karantina', 'Put in quarantine') +
            ' <span class="k-mono">' + esc(R.quarantine_tray) + '</span></span><span class="bm-opt__sub" ' + biAttr('Baki karantina. Jangan ke rak.', 'The quarantine tray. Not on the rack.') + '></span></span></button>' +
          '<button type="button" class="bm-opt" data-dto="driver">' + icon('truck', 26) + '<span><span class="bm-opt__title" ' + biAttr('Kembalikan ke driver sekarang', 'Back to the driver now') + '></span>' +
            '<span class="bm-opt__sub" ' + biAttr('Unit ikut pulang dengan sopir pengirim. Tulis di Surat Jalan: ditolak, rusak.', 'The unit leaves with the delivery driver. Write on the Surat Jalan: refused, damaged.') + '></span></span></button>' +
          btn('k-btn--ghost k-btn--sm', 'Batal', 'Cancel', 'id="bm-dcancel"') + '</div>';
      }
      return '<div class="k-note k-note--stop">' + icon('warn', 20) + '<span class="k-strong" ' + biAttr('Mode rusak: unit ini tidak jadi stok. Pindai unit yang rusak.', 'Damaged mode: this unit never becomes stock. Scan the damaged unit.') + '></span></div>';
    }

    function paint() {
      const l = SCAN.last && R.loads.find((x) => x.id === SCAN.last.id);
      const needLabel = l && l.status === 'filling' && !l.label_scanned;
      host.innerHTML =
        '<div class="k-line k-line--between"><h2 class="k-h2" ' + biAttr('Pindai barang', 'Scan the goods') + '></h2>' +
          '<span class="k-mono k-strong">' + n(R.total_received) + (R.total_expected != null ? ' / ' + n(R.total_expected) : '') + ' pcs</span></div>' +
        '<span class="k-caption" ' + biAttr('Aturan: 1 produk = 1 bin sementara.', 'Rule: 1 product = 1 temporary bin.') + '></span>' +
        (SCAN.damaged ? '' : targetHtml()) +
        '<div id="bm-zone"></div>' +
        '<div class="k-card k-card--pad k-switchrow' + (SCAN.damaged ? ' bm-damage' : '') + '"><button type="button" class="k-switch--danger" id="bm-dmg" aria-checked="' + SCAN.damaged + '" data-aria-id="Rusak" data-aria-en="Damaged" aria-label="Rusak"></button>' +
          '<span class="k-grow k-strong"' + (SCAN.damaged ? ' style="color:var(--stop)"' : '') + '>' + p2(SCAN.damaged ? 'Rusak nyala' : 'Rusak', SCAN.damaged ? 'Damaged on' : 'Damaged') + '</span></div>' +
        damageHtml() +
        '<button type="button" class="k-linkbtn" id="bm-manual" style="align-self:flex-start">' + p2('Produk tanpa barcode? Pilih dari daftar', 'Product without a barcode? Pick from the list') + '</button>' +
        tableHtml() +
        (R.free_bins ? '<span class="k-caption">' + p2('Produk sama selalu ke bin-nya. Bin kosong tersisa: ' + R.free_bins + '.', 'The same product always goes to its bin. Empty bins left: ' + R.free_bins + '.') + '</span>'
          : '<div class="k-stack k-stack--tight">' + note('caution', 'Semua bin sementara terisi: selesaikan batch ini dulu (taruh di rak).', 'Every temporary bin is taken: finish this batch first (put it on the rack).') +
            '<div>' + btn('k-btn--secondary k-btn--sm', 'Tambah bin sementara', 'Add a temporary bin', 'id="bm-addbin" data-min-role="supervisor"', 'plus') + '</div></div>') +
        '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Selesai batch ini', 'Finish this batch', 'id="bm-batch"', 'rack') +
          btn('k-btn--primary k-btn--lg k-btn--block', 'Semua barang sudah diterima', 'All goods received', 'id="bm-all"', 'check') + '</div>';
      zone = S.scan(onCode, { mount: $('#bm-zone', host), title: needLabel ? ['Pindai label bin, lalu unit', 'Scan the bin label, then the unit'] : ['Pindai barang', 'Scan the item'] });
      S.toggle($('#bm-dmg', host), (on) => { SCAN.damaged = on; SCAN.pending = null; SCAN.after = null; paint(); });
      const bf = $('#bm-full', host);
      if (bf) bf.addEventListener('click', async () => {
        try { await API().post('/inbound/loads/' + SCAN.last.id + '/full', {}); S.toast(['Unit berikutnya dapat bin baru.', 'The next unit gets a new bin.'], 'ok'); await reload(); } catch (e) { S.fail(e); }
      });
      $('#bm-manual', host).addEventListener('click', () => go({ receipt: R.id, step: 'manual' }));
      $('#bm-batch', host).addEventListener('click', async () => {
        try { await API().post('/inbound/receipts/' + R.id + '/batch', {}); go({ receipt: R.id, step: 'putaway' }); } catch (e) { S.fail(e); }
      });
      $('#bm-all', host).addEventListener('click', () => go({ receipt: R.id, step: 'summary' }));
      const ab = $('#bm-addbin', host);
      if (ab) ab.addEventListener('click', () => addBin(reload));
      $$('[data-dto]', host).forEach((b) => b.addEventListener('click', () => countUnit(SCAN.pending, b.dataset.dto)));
      const dc = $('#bm-dcancel', host);
      if (dc) dc.addEventListener('click', () => { SCAN.pending = null; paint(); });
      const dph = $('#bm-dph', host);
      if (dph) dph.addEventListener('click', async () => {
        const f = await pickFiles('image/*', false, 'environment');
        if (!f[0]) return;
        const fd = new FormData();
        fd.append('kind', 'damage'); fd.append('difference_id', SCAN.after.difference_id); fd.append('file', f[0]);
        try {
          await API().form('/inbound/receipts/' + R.id + '/photos', fd);
          S.toast(['Foto disimpan. Mode rusak mati.', 'Photo saved. Damaged mode off.'], 'ok');
          SCAN.damaged = false; SCAN.after = null; await reload();
        } catch (e) { S.fail(e); }
      });
      const doff = $('#bm-doff', host);
      if (doff) doff.addEventListener('click', () => { SCAN.damaged = false; SCAN.after = null; paint(); });
      S.applyLang(host);
      S.lockAll(host);
    }

    async function reload() {
      R = await getReceipt(R.id);
      paint();
    }

    async function countUnit(unit, damageTo) {
      const body = Object.assign({ idempotency_key: key() }, unit);
      if (SCAN.damaged) { body.damaged = true; body.damage_to = damageTo || null; }
      let res;
      try { res = await API().post('/inbound/receipts/' + R.id + '/units', body); }
      catch (e) { S.fail(e); return null; }
      if (!res.accepted) {
        if (res.outcome === 'needs_damage_place') { SCAN.pending = unit; paint(); return res; }
        if (zone) zone.reject(S.pick(res.message));
        S.toast(res.message, res.outcome === 'no_free_bin' ? 'caution' : 'stop');
        if (res.outcome === 'no_free_bin' || res.outcome === 'carton_check') await reload();
        return res;
      }
      if (res.outcome === 'damaged') {
        SCAN.pending = null;
        SCAN.after = { sku_name: res.sku && res.sku.name_display, place: damageTo, difference_id: res.difference_id, photo_needed: res.photo_needed };
      } else {
        SCAN.last = res.load;
        if (res.outcome === 'new_bin' || res.outcome === 'extra_bin') S.toast(res.message, res.outcome === 'extra_bin' ? 'caution' : 'info', 6000);
      }
      await reload();
      if (zone) zone.accept(short(res.sku && res.sku.name_display), S.pick(res.message));
      return res;
    }
    SCAN.count = countUnit;

    async function onCode(code, z) {
      const c = code.trim().toUpperCase();
      if (SCAN.damaged && (SCAN.pending || SCAN.after)) { z.reject(t('Selesaikan unit rusak dulu.', 'Finish the damaged unit first.')); return; }
      const l = SCAN.last && R.loads.find((x) => x.id === SCAN.last.id);
      if (/-(IN)-\d+$/.test(c)) {
        if (!l || l.status !== 'filling') { z.reject(t('Pindai unit dulu, lalu label bin.', 'Scan a unit first, then the bin label.')); return; }
        try {
          await API().post('/inbound/loads/' + l.id + '/bin-label', { code: c });
          z.accept(l.bin_code, t('Label cocok. Masukkan unit ke bin ini.', 'Label matches. Put the units in this bin.'));
          await reload();
        } catch (e) { z.reject(S.pick(e.message)); S.fail(e); }
        return;
      }
      await countUnit({ code: code.trim() });
    }

    paint();
  }

  async function addBin(after) {
    try {
      const r = await API().post('/inbound/temp-bins' + API().qs({ site_id: S.siteId() }), {});
      const nb = r.bins[r.bins.length - 1];
      S.toast([(nb ? nb.code + ' ditambahkan. ' : '') + 'Cetak labelnya di Rak & bin.', (nb ? nb.code + ' added. ' : '') + 'Print its label in Rak & bin.'], 'ok');
      if (after) await after();
    } catch (e) { S.fail(e); }
  }

  /* ================= 5c2: pick a product with no barcode ================= */

  async function manualStep(ctx, R) {
    S.fullScreen(true, { title: ['Pilih produk', 'Pick a product'], onBack: () => go({ receipt: R.id, step: 'scan' }) });
    let list = R.lines.map((l) => ({ sku_id: l.sku_id, sku_name: l.sku_name, has_barcode: l.has_barcode, line: l }));
    if (R.no_po || !list.length) {
      const res = await API().get('/skus' + API().qs({ brand_id: R.brand_id, limit: 200 }));
      const have = new Set(list.map((x) => x.sku_id));
      (res.skus || []).forEach((s) => { if (!have.has(s.id)) list.push({ sku_id: s.id, sku_name: s.name_display, has_barcode: true, line: null }); });
    }
    let sel = null;
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-man"></div>';
    const host = $('#bm-man', ctx.body);
    function paint() {
      host.innerHTML = '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Pilih produk', 'Pick a product') + '></h2>' +
        '<span class="k-caption">' + esc((R.reference || R.no_po_code || '') + ' · ' + (R.brand_name || '')) + '</span></div>' +
        '<p class="k-p k-strong" ' + biAttr('Ketuk produk yang sedang Anda pegang.', 'Tap the product you are holding.') + '></p>' +
        note('caution', 'Hanya untuk produk yang memang tidak punya barcode. Dicatat dan dilihat SPV.', 'Only for products that really have no barcode. Logged and seen by the SPV.') +
        '<div class="k-list">' + list.map((x) => {
          const l = R.lines.find((y) => y.sku_id === x.sku_id);
          const on = sel === x.sku_id;
          return '<div class="k-row' + (on ? ' bm-next' : '') + '" style="flex-wrap:wrap">' +
            '<button type="button" data-sku="' + x.sku_id + '" style="all:unset;cursor:pointer;flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span class="k-row__title">' + esc(short(x.sku_name)) + (x.has_barcode ? '' : ' <span class="k-caption">· ' + esc(t('tidak ada barcode', 'no barcode')) + '</span>') + '</span>' +
            '<span class="k-row__sub k-mono">' + n(l ? l.qty_received : 0) + (l && l.qty_expected != null ? ' ' + esc(t('dari', 'of')) + ' ' + n(l.qty_expected) : '') + '</span></button>' +
            (on ? '<div class="k-line">' + btn('k-btn--secondary', '−1', '−1', 'data-minus aria-label="-1"', 'minus') + btn('k-btn--primary', '+1', '+1', 'data-plus aria-label="+1"', 'plus') + '</div>' : '') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Kembali ke pindai', 'Back to scanning', 'id="bm-back"', 'scan') + '</div>';
      $$('[data-sku]', host).forEach((b) => b.addEventListener('click', () => { sel = +b.dataset.sku; paint(); }));
      const plus = $('[data-plus]', host), minus = $('[data-minus]', host);
      if (plus) plus.addEventListener('click', async () => {
        plus.disabled = true;
        try {
          const r = await API().post('/inbound/receipts/' + R.id + '/units', { sku_id: sel, idempotency_key: key() });
          if (!r.accepted) S.toast(r.message, 'caution');
          else if (r.outcome === 'new_bin' || r.outcome === 'extra_bin') S.toast(r.message, 'info', 6000);
          R = await getReceipt(R.id); paint();
        } catch (e) { S.fail(e); plus.disabled = false; }
      });
      if (minus) minus.addEventListener('click', async () => {
        try { await API().post('/inbound/receipts/' + R.id + '/units/undo', { sku_id: sel, manual_only: true, idempotency_key: key() }); R = await getReceipt(R.id); paint(); }
        catch (e) { S.fail(e); }
      });
      $('#bm-back', host).addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
      S.applyLang(host);
    }
    paint();
  }

  /* ================= 5e, 5f: batch putaway ================= */

  async function putawayStep(ctx, R) {
    S.fullScreen(true, { title: ['Taruh di rak', 'Put on the rack'], onBack: () => go({ receipt: R.id, step: R.status === 'open' ? 'scan' : '' }) });
    let P = await API().get('/inbound/putaway' + API().qs({ site_id: R.site_id, receipt_id: R.id }));
    let idx = S.param('i') != null ? +S.param('i') : null;
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-put"></div>';
    const host = $('#bm-put', ctx.body);
    const total = () => P.items.length;
    const div = () => P.divider;

    function listView() {
      const ready = P.items, held = P.held;
      host.innerHTML = '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Taruh di rak', 'Put on the rack') + '></h2>' +
        '<span class="k-caption">' + p2('Batch ' + (P.batch_no || 1) + ' · ' + ready.length + ' bin untuk ditaruh, ' + held.filter((h) => h.waiting_ops_hq).length + ' tunggu Ops HQ',
          'Batch ' + (P.batch_no || 1) + ' · ' + ready.length + ' bins to put away, ' + held.filter((h) => h.waiting_ops_hq).length + ' wait for Ops HQ') + '</span></div>' +
        (ready.length ? '<p class="k-p" ' + biAttr('Taruh dari atas ke bawah, sesuai jalan di rak.', 'Put away from top to bottom, in walking order.') + '></p>' : '') +
        ready.map((it, i) => i === 0
          ? '<div class="k-card k-card--pad k-card--focus k-stack k-stack--tight">' + bis('Berikutnya', 'Next', 'k-eyebrow') +
            '<div class="k-line k-line--between"><span><span class="k-caption" ' + biAttr('Dari', 'From') + '></span> <span class="k-code k-code--xl">' + esc(it.load.bin_code) + '</span></span>' +
            '<span><span class="k-caption" ' + biAttr('Ke bin', 'To bin') + '></span> <span class="k-code k-code--xl">' + esc(it.to_location_label || '?') + '</span></span></div>' +
            '<span class="k-strong">' + esc(short(it.sku_name)) + ' · ' + n(it.load.qty_to_put) + ' unit</span>' +
            (it.to_location_code ? '' : note('caution', 'Produk ini belum punya bin rak. Panggil SPV (Rak & bin, Perlu bin).', 'This product has no rack bin yet. Call the SPV (Rak & bin, Needs a bin).')) + '</div>'
          : '<div class="k-row"><span class="k-row__text"><span class="k-row__title"><span class="k-mono">' + esc(binShort(it.load.bin_code)) + '</span> → <span class="k-mono">' + esc(it.to_location_label || '?') + '</span></span>' +
            '<span class="k-row__sub">' + esc(short(it.sku_name)) + ' · ' + n(it.load.qty_to_put) + ' unit</span></span></div>').join('') +
        held.map((h) => '<div class="k-row k-row--caution"><span class="k-row__icon k-row__icon--caution">' + icon('warn', 24) + '</span><span class="k-row__text">' +
          '<span class="k-row__title"><span class="k-mono">' + esc(h.load.bin_code) + '</span> · ' + (h.returning ? p2('Retur ke merek', 'Return to the brand') : p2('Tunggu Ops HQ', 'Wait for Ops HQ')) + '</span>' +
          '<span class="k-row__sub">' + esc(short(h.sku_name)) + ' · ' + n(h.load.qty_hold || (h.load.qty - h.load.qty_put)) + ' ' + esc(h.load.is_extra ? t('unit lebih', 'extra units') : t('unit', 'units')) + '</span>' +
          '<span class="k-row__sub k-row__sub--caution" ' + biAttr(h.returning ? 'Siapkan untuk dikembalikan ke merek.' : 'Jangan ditaruh sebelum diputuskan.', h.returning ? 'Ready it for return to the brand.' : 'Do not put away before a decision.') + '></span></span></div>').join('') +
        (!ready.length ? note('ok', 'Tidak ada bin yang perlu ditaruh sekarang.', 'No bin to put away right now.', 'check') : '') +
        (P.free_bins ? '' : note('caution', 'Semua bin sementara terisi: selesaikan batch ini dulu (taruh di rak).', 'Every temporary bin is taken: finish this batch first (put it on the rack).')) +
        '<div class="k-line">' + S.roleChip('supervisor') + btn('k-btn--secondary k-btn--sm', 'Tambah bin sementara', 'Add a temporary bin', 'id="bm-addbin" data-min-role="supervisor"', 'plus') + '</div>' +
        '<div class="k-actionbar">' + (ready.length ? btn('k-btn--primary k-btn--lg k-btn--block', 'Mulai taruh', 'Start putting away', 'id="bm-startput"', 'arrow')
          : btn('k-btn--primary k-btn--lg k-btn--block', R.status === 'open' ? 'Kembali ke pindai' : 'Kembali', R.status === 'open' ? 'Back to scanning' : 'Back', 'id="bm-back"', 'back')) + '</div>';
      const sp = $('#bm-startput', host);
      if (sp) sp.addEventListener('click', () => { idx = 0; itemView(); });
      const bk = $('#bm-back', host);
      if (bk) bk.addEventListener('click', () => go({ receipt: R.id, step: R.status === 'open' ? 'scan' : '' }));
      $('#bm-addbin', host).addEventListener('click', () => addBin(async () => { P = await API().get('/inbound/putaway' + API().qs({ site_id: R.site_id, receipt_id: R.id })); listView(); }));
      S.applyLang(host);
      S.lockAll(host);
    }

    let alt = null;      // after Bin penuh: {code, label, before}
    function itemView() {
      const it = P.items[idx];
      if (!it) { listView(); return; }
      const code = alt ? alt.label : it.to_location_label;
      const words = rackWords(code);
      const d = div();
      host.innerHTML = '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Taruh di rak', 'Put on the rack') + '></h2>' +
        '<span class="k-caption">' + p2((idx + 1) + ' dari ' + total() + ' · dari ', (idx + 1) + ' of ' + total() + ' · from ') + '<span class="k-mono">' + esc(it.load.bin_code) + '</span></span></div>' +
        '<div class="k-target"><div class="k-target__text">' + bis('Ke bin', 'To bin', 'k-target__label') +
          '<span class="k-target__code">' + esc(code || '?') + '</span>' +
          (words ? '<span class="k-target__hint" ' + biAttr(words[0], words[1]) + '></span>' : '') + '</div></div>' +
        '<span class="k-strong" style="font-size:17px">' + esc(it.sku_name) + '</span>' +
        '<ol class="bm-steps">' +
          '<li><span class="bm-num">1</span><span><span class="bm-swatch" style="background:' + esc(d.hex) + '"></span>' +
            p2('Pasang sekat ' + d.colour_id.toLowerCase() + ' (hari ini) di belakang stok lama, kalau ada', 'Put a new ' + d.colour_en.toLowerCase() + ' divider (today) behind the old stock, if any') + '</span></li>' +
          '<li><span class="bm-num">2</span>' + p2('Tulis tanggal ' + d.written + ' di sekat putih', 'Write the date ' + d.written + ' on the white divider') + '</li>' +
          '<li><span class="bm-num">3</span>' + p2('Taruh ' + (alt ? alt.left : it.load.qty_to_put) + ' unit di belakang sekat', 'Put ' + (alt ? alt.left : it.load.qty_to_put) + ' units behind the divider') + '</li></ol>' +
        '<div id="bm-zone"></div>' +
        note('info', 'Setelah pindai, unit bisa dijual dan stok baru dikirim ke Hiryu.', 'After the scan the units are sellable and the new stock goes to Hiryu.') +
        '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Bin penuh', 'Bin full', 'id="bm-rfull"') + '</div>';
      S.scan(async (c, z) => {
        const qty = alt && alt.qtyHere ? alt.qtyHere : null;
        try {
          const r = await API().post('/inbound/loads/' + it.load.id + '/putaway', { location_code: c, qty: qty, idempotency_key: key() });
          z.accept(c, S.pick(r.message));
          S.toast(r.message, 'ok');
          if (r.remaining > 0) {
            if (alt && alt.next) { alt = { label: alt.next.location_label, code: alt.next.location_code, left: r.remaining }; }
            it.load = r.load;
            itemView();
            return;
          }
          alt = null;
          idx += 1;
          if (idx >= P.items.length) {
            P = await API().get('/inbound/putaway' + API().qs({ site_id: R.site_id, receipt_id: R.id }));
            S.toast(['Batch selesai ditaruh. Bin sementara kosong lagi.', 'Batch put away. The temporary bins are free again.'], 'ok');
            if (R.status === 'open') { go({ receipt: R.id, step: 'scan' }, true); return; }
            listView();
            return;
          }
          itemView();
        } catch (e) { z.reject(S.pick(e.message)); S.fail(e); }
      }, { mount: $('#bm-zone', host), title: ['Pindai label bin', 'Scan the bin label'] });
      $('#bm-rfull', host).addEventListener('click', async () => {
        let nx;
        try { nx = await API().post('/inbound/loads/' + it.load.id + '/rack-full', { location_code: alt ? alt.code : it.to_location_code }); }
        catch (e) { S.fail(e); return; }
        const left = alt ? alt.left : it.load.qty_to_put;
        const box = document.createElement('div');
        box.className = 'k-stack';
        box.innerHTML = '<p class="k-p">' + p2('Berapa unit sudah masuk ke ' + (code || '') + ' sebelum penuh?', 'How many units went into ' + (code || '') + ' before it was full?') + '</p><div id="bm-q"></div>' +
          '<p class="k-caption">' + p2('Sisanya ke ' + nx.location_label + '.', 'The rest goes to ' + nx.location_label + '.') + '</p>';
        const q = S.stepper($('#bm-q', box), { value: 0, min: 0, max: Math.max(0, left - 1) });
        S.modal({
          title: ['Bin penuh', 'Bin full'], body: box,
          actions: [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
            label: ['Lanjut', 'Continue'], kind: 'primary', onClick: () => {
              const here = q.get();
              if (here > 0) {
                alt = { label: code, code: alt ? alt.code : it.to_location_code, left: left, qtyHere: here, next: nx };
                S.toast(['Pindai label ' + code + ' untuk ' + here + ' unit itu dulu.', 'Scan the label of ' + code + ' for those ' + here + ' units first.'], 'info', 6000);
              } else {
                alt = { label: nx.location_label, code: nx.location_code, left: left };
              }
              itemView();
            },
          }],
        });
      });
      S.applyLang(host);
    }

    if (idx != null && P.items[idx]) itemView(); else listView();
  }

  /* ================= 5g: summary, three photos, Selesai ================= */

  const PROOF = [
    ['sj_signed', 'Foto Surat Jalan dan Faktur yang sudah ditandatangani', 'Photo of the signed Surat Jalan and Faktur'],
    ['selfie', 'Swafoto penerima', 'Selfie of the receiver'],
    ['sj_driver', 'Foto Surat Jalan dan Faktur bersama driver', 'Photo of the Surat Jalan and Faktur with the driver'],
  ];

  function tallies(R) {
    const out = { match: 0, short: 0, shortNames: [], extra: 0, extraNames: [], damaged: 0, q: 0, d: 0 };
    R.lines.forEach((l) => {
      const e = l.qty_expected || 0;
      if (l.qty_expected != null && l.qty_received === e && e > 0) out.match += 1;
      if (l.qty_expected != null && l.qty_received < e) { out.short += e - l.qty_received; out.shortNames.push(short(l.sku_name)); }
      if (l.qty_expected != null && l.qty_received > e) { out.extra += l.qty_received - e; out.extraNames.push(short(l.sku_name)); }
      out.damaged += l.qty_damaged;
    });
    R.differences.filter((d) => d.kind === 'damaged').forEach((d) => { if (d.place === 'quarantine') out.q += d.qty; else out.d += d.qty; });
    return out;
  }

  async function summaryStep(ctx, R) {
    S.fullScreen(true, { title: ['Ringkasan', 'Summary'], onBack: () => go({ receipt: R.id, step: 'scan' }) });
    const T = tallies(R);
    const extraBins = R.loads.filter((l) => l.is_extra && l.qty_hold).map((l) => l.bin_code);
    const proofDone = PROOF.filter((p) => R.proof_done.includes(p[0])).length;
    const dmgNoPhoto = R.differences.filter((d) => d.kind === 'damaged' && !d.photos);
    const left = 3 - proofDone + dmgNoPhoto.length;
    const hasDiff = T.short || T.extra || T.damaged;
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Ringkasan', 'Summary') + '></h2>' +
        '<span class="k-caption">' + esc((R.reference || R.no_po_code || '') + ' · ' + (R.brand_name || '')) + '</span></div>' +
      '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Semua barang sudah diterima', 'All goods received', 'k-strong') +
        '<span>' + p2('Dipindai ', 'Scanned ') + '<span class="k-mono k-strong">' + n(R.total_received) + '</span>' +
          (R.total_expected != null ? p2(' dari ', ' of ') + '<span class="k-mono">' + n(R.total_expected) + '</span>' : '') + ' unit</span></div>' +
      '<div class="k-kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
        '<div class="k-kpi k-kpi--ok">' + bis('Cocok', 'Match', 'k-kpi__label') + '<span class="k-kpi__num">' + T.match + '</span>' + bis('SKU sesuai PO', 'SKUs as ordered', 'k-kpi__foot') + '</div>' +
        '<div class="k-kpi' + (T.short ? ' k-kpi--caution' : '') + '">' + bis('Kurang', 'Short', 'k-kpi__label') + '<span class="k-kpi__num">' + (T.short ? '−' + T.short : '0') + '</span><span class="k-kpi__foot">' + esc(T.shortNames.join(', ') || '-') + '</span></div>' +
        '<div class="k-kpi' + (T.extra ? ' k-kpi--caution' : '') + '">' + bis('Lebih', 'Extra', 'k-kpi__label') + '<span class="k-kpi__num">' + (T.extra ? '+' + T.extra : '0') + '</span><span class="k-kpi__foot">' + esc(T.extraNames.join(', ') || '-') + '</span></div>' +
        '<div class="k-kpi' + (T.damaged ? ' k-kpi--stop' : '') + '">' + bis('Rusak', 'Damaged', 'k-kpi__label') + '<span class="k-kpi__num">' + T.damaged + '</span><span class="k-kpi__foot">' +
          p2('Karantina ' + T.q + ', driver ' + T.d, 'Quarantine ' + T.q + ', driver ' + T.d) + '</span></div></div>' +
      (hasDiff && R.replenishment_id ? '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + p2('Menunggu persetujuan Ops HQ, belum masuk stok.', 'Waiting for Ops HQ approval, not in stock yet.') +
        (extraBins.length ? ' ' + p2('Lebih ' + T.extra + ' tetap di ' + extraBins.join(', ') + '.', T.extra + ' extra stay in ' + extraBins.join(', ') + '.') : '') + '</span></div>' : '') +
      (R.no_po && !R.no_po_linked ? note('caution', 'Belum jadi stok sampai Ops HQ menghubungkan kiriman ini.', 'Not stock until Ops HQ links this delivery.') : '') +
      '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Tulis selisih di Surat Jalan dan Faktur, lalu tanda tangan', 'Write the differences on the Surat Jalan and the Faktur, then sign', 'k-strong') +
        '<span class="k-caption" ' + biAttr('Sebaiknya SPV yang tanda tangan. Beri sopir 1 salinan Surat Jalan.', 'Ideally the SPV signs. Give the driver 1 copy of the Surat Jalan.') + '></span></div>' +
      '<div class="k-card k-card--pad"><div class="k-line k-line--between" style="margin-bottom:6px">' + bis('Foto wajib sebelum selesai', 'Photos required before finishing', 'k-strong') +
        '<span class="k-mono k-strong">' + proofDone + ' ' + esc(t('dari', 'of')) + ' 3</span></div>' +
        PROOF.map((p) => photoRow(p[0], null, p[1], p[2], R.proof_done.includes(p[0]))).join('') +
        dmgNoPhoto.map((d) => photoRow('damage', d.id, 'Foto kerusakan: ' + short(d.sku_name), 'Damage photo: ' + short(d.sku_name), false)).join('') + '</div>' +
      (left > 0 ? '<span class="k-caption">' + p2('Ambil ' + left + ' foto lagi untuk selesai.', 'Take ' + left + ' more photo' + (left > 1 ? 's' : '') + ' to finish.') + '</span>' : '') +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Selesai', 'Finish', 'id="bm-finish"' + (R.can_finish ? '' : ' disabled'), 'check') +
        btn('k-btn--ghost k-btn--block', 'Kembali ke pindai', 'Back to scanning', 'id="bm-back"') + '</div></div>';
    $$('[data-ph]', ctx.body).forEach((b) => b.addEventListener('click', async () => {
      const f = await pickFiles('image/*', false, b.dataset.ph === 'selfie' ? 'user' : 'environment');
      if (!f[0]) return;
      const fd = new FormData();
      fd.append('kind', b.dataset.ph);
      if (b.dataset.diff) fd.append('difference_id', b.dataset.diff);
      fd.append('file', f[0]);
      try { await API().form('/inbound/receipts/' + R.id + '/photos', fd); S.toast(['Foto disimpan.', 'Photo saved.'], 'ok'); S.rerender(); } catch (e) { S.fail(e); }
    }));
    $('#bm-back', ctx.body).addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
    $('#bm-finish', ctx.body).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await API().post('/inbound/receipts/' + R.id + '/finish', {});
        S.toast(['Penerimaan selesai.', 'Receipt finished.'], 'ok');
        go({ receipt: R.id }, true);
        autoSlip(R.id);
      } catch (err) { S.fail(err); e.currentTarget.disabled = false; }
    });
  }
  const photoRow = (kind, diff, id, en, done) => '<div class="bm-photo"><span class="bm-photo__text" ' + biAttr(id, en) + '></span>' +
    (done ? S.pill('ok', 'Sudah', 'Done') : btn('k-btn--secondary k-btn--sm', 'Ambil', 'Take', 'data-ph="' + kind + '"' + (diff ? ' data-diff="' + diff + '"' : ''), 'camera')) + '</div>';

  /* ================= 5h: the finished receipt ================= */

  const DIFF_WORDS = {
    short: (d) => ['−' + d.qty, '−' + d.qty],
    extra: (d) => ['+' + d.qty + (d.bin_code ? ', di ' + d.bin_code : ''), '+' + d.qty + (d.bin_code ? ', in ' + d.bin_code : '')],
    damaged: (d) => d.place === 'quarantine' ? [d.qty + ' rusak, di karantina ' + (d.bin_code || ''), d.qty + ' damaged, in quarantine ' + (d.bin_code || '')]
      : [d.qty + ' rusak, dikembalikan ke driver', d.qty + ' damaged, back to the driver'],
  };
  const diffPill = (d) => d.status === 'pending' ? S.pill('caution', 'Menunggu persetujuan Ops HQ', 'Waiting for Ops HQ approval')
    : d.decision === 'reject' ? S.pill('info', 'Disetujui: ditolak', 'Approved: rejected')
      : d.decision === 'accept' ? S.pill('ok', 'Disetujui: diterima', 'Approved: accepted') : S.pill('ok', 'Disetujui', 'Approved');

  async function detail(ctx, R) {
    S.fullScreen(false);
    const spv = S.atLeast('supervisor');
    const [fk, slip] = await Promise.all([
      spv && R.status === 'completed' ? API().get('/receipts/' + R.id + '/faktur').catch(() => null) : null,
      spv && R.status === 'completed' ? API().get('/inbound/receipts/' + R.id + '/slip').catch(() => null) : null,
    ]);
    S.setSub('Barang masuk / ' + (R.reference || R.no_po_code || '#' + R.id), 'Inbound / ' + (R.reference || R.no_po_code || '#' + R.id));
    const T = tallies(R);
    const names = slip ? slip.receiver : (R.opened_by || '');
    const cartons = R.counted_cartons != null ? n(R.counted_cartons) + ' karton' + (R.carton_state === 'accepted_rewrite' ? ' (Surat Jalan ' + n(R.sj_cartons) + ', ditulis ulang SPV)' : '') : '';
    const cartonsEn = R.counted_cartons != null ? n(R.counted_cartons) + ' cartons' + (R.carton_state === 'accepted_rewrite' ? ' (Surat Jalan ' + n(R.sj_cartons) + ', rewritten by the SPV)' : '') : '';
    const statusPill = R.status === 'refused' ? S.pill('stop', 'Ditolak', 'Refused')
      : R.faktur_uploaded_at ? S.pill('ok', 'Selesai · Faktur diunggah ' + S.fmt.time(R.faktur_uploaded_at), 'Done · Faktur uploaded ' + S.fmt.time(R.faktur_uploaded_at))
        : S.pill('caution', 'Selesai · Faktur belum diunggah', 'Done · Faktur not uploaded');
    const res = (l) => {
      const bits = [];
      if (l.state === 'match') bits.push(['cocok', 'match']);
      if (l.state === 'short') bits.push(['kurang ' + (l.qty_expected - l.qty_received), (l.qty_expected - l.qty_received) + ' short']);
      if (l.state === 'extra') bits.push(['lebih ' + (l.qty_received - l.qty_expected), (l.qty_received - l.qty_expected) + ' extra']);
      if (l.qty_damaged) bits.push(['rusak ' + l.qty_damaged, l.qty_damaged + ' damaged']);
      return '<span ' + biAttr(bits.map((b) => b[0]).join(', ') || '-', bits.map((b) => b[1]).join(', ') || '-') + '></span>';
    };
    const pages = (fk && fk.pages) || [];
    ctx.body.innerHTML = '<div class="bm-wrap bm-wrap--wide">' +
      '<div class="k-stack k-stack--tight"><div class="k-line" style="flex-wrap:wrap;gap:12px"><span class="bm-ref">' + esc(R.reference || R.no_po_code || ('#' + R.id)) + '</span>' + statusPill + '</div>' +
        '<span class="k-caption">' + esc(R.brand_name || '') + (R.brand_po_number ? ' · ' + esc(t('No. PO merek', 'Brand PO')) + ' ' + esc(R.brand_po_number) : '') +
          (cartons ? ' · <span ' + biAttr(cartons, cartonsEn) + '></span>' : '') +
          (R.first_unit_at ? ' · ' + p2('dipindai ' + S.fmt.time(R.first_unit_at) + ' sampai ' + S.fmt.time(R.last_unit_at) + ' oleh ' + names,
            'scanned ' + S.fmt.time(R.first_unit_at) + ' to ' + S.fmt.time(R.last_unit_at) + ' by ' + names) : '') + '</span></div>' +
      '<div class="bm-cols">' +
        '<div class="k-stack">' +
          '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th class="k-num" ' + biAttr('Harapan', 'Expected') + '></th>' +
            '<th class="k-num" ' + biAttr('Diterima', 'Received') + '></th><th ' + biAttr('Hasil', 'Result') + '></th></tr></thead><tbody>' +
            R.lines.map((l) => '<tr' + (l.state === 'match' && !l.qty_damaged ? '' : ' class="is-caution"') + '><td>' + esc(l.sku_name) + '</td><td class="k-num">' + n(l.qty_expected) + '</td>' +
              '<td class="k-num">' + n(l.qty_received) + '</td><td>' + res(l) + '</td></tr>').join('') +
            '<tr><td class="k-strong" ' + biAttr('Total', 'Total') + '></td><td class="k-num">' + n(R.total_expected) + '</td><td class="k-num k-strong">' + n(R.total_received) + '</td><td>' +
              (R.total_expected != null ? p2(n(R.total_received) + ' dari ' + n(R.total_expected) + ' unit', n(R.total_received) + ' of ' + n(R.total_expected) + ' units') : '') + '</td></tr>' +
          '</tbody></table></div>' +
          (R.differences.length ? '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Selisih', 'Differences', 'k-strong') +
            R.differences.map((d) => { const w = DIFF_WORDS[d.kind](d); return '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px"><span><span class="k-strong">' + esc(short(d.sku_name)) + '</span> <span ' + biAttr(w[0], w[1]) + '></span></span>' + diffPill(d) + '</div>'; }).join('') +
            (R.decide_by ? '<span class="k-caption">' + p2('Masuk stok dan tagihan setelah Ops HQ setuju (batas ' + S.fmt.dt(R.decide_by) + ').', 'Reaches stock and billing after Ops HQ approves (by ' + S.fmt.dt(R.decide_by) + ').') + '</span>' : '') + '</div>' : '') +
          (R.no_po && !R.no_po_linked ? '<div class="k-card k-card--pad k-card--caution k-stack">' + note('caution', 'Kiriman tanpa PO: unit belum jadi stok sampai Ops HQ menghubungkannya ke permintaan restock.', 'Delivery with no PO: the units are not stock until Ops HQ links it to a restock request.') +
            '<div>' + btn('k-btn--primary', 'Hubungkan ke permintaan', 'Link to a request', 'id="bm-link" data-min-role="hq"', 'link') + '</div></div>' : '') +
          (spv && R.photos.length ? '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Foto penerimaan', 'Receiving photos', 'k-strong') +
            '<div class="bm-pages">' + R.photos.map((p) => '<a class="bm-page" target="_blank" rel="noopener" href="' + esc('..' + p.url) + '" style="background-image:url(' + esc('..' + p.url) + ')">' + esc(photoName(p.kind)) + '</a>').join('') + '</div>' +
            '<span class="k-caption" ' + biAttr('Hanya SPV dan Ops HQ yang bisa melihat foto ini.', 'Only the SPV and Ops HQ can see these photos.') + '></span></div>' : '') +
        '</div>' +
        '<div class="k-stack">' +
          (R.status === 'completed' ? '<div class="k-card k-card--pad k-stack">' + bis('Unggah Faktur', 'Upload the Faktur', 'k-h2') +
            '<div class="bm-pages">' + pages.map((p) => '<a class="bm-page" target="_blank" rel="noopener" href="' + esc('..' + p.url) + '"' +
              (/^image\//.test(p.content_type) ? ' style="background-image:url(' + esc('..' + p.url) + ')"' : '') + '>' + esc(t('Hal. ', 'p. ') + p.page_no) + '</a>').join('') +
              (pages.length ? '<button type="button" class="bm-page" id="bm-addpg" style="align-items:center;cursor:pointer">' + icon('plus', 22) + '</button>' : '') + '</div>' +
            '<div class="bm-drop" id="bm-drop">' + icon('upload', 24) + '<div>' + p2('Tarik foto ke sini atau ', 'Drag photos here or ') + '<button type="button" class="k-linkbtn" id="bm-pick" data-min-role="supervisor" ' + biAttr('pilih file', 'choose files') + '></button>. ' +
              p2('Foto semua halaman.', 'Photograph every page.') + '</div></div>' +
            '<span class="k-caption" ' + biAttr('Bisa dari kamera ponsel: buka penerimaan ini di ponsel, tekan Unggah Faktur.', 'From a phone camera too: open this receipt on the phone, press Upload Faktur.') + '></span>' +
            (pages.length ? '<span class="k-caption">' + p2(pages.length + ' halaman disimpan ' + S.fmt.time(fk.faktur_uploaded_at) + ' oleh ' + (fk.faktur_uploaded_by || ''), pages.length + ' pages saved ' + S.fmt.time(fk.faktur_uploaded_at) + ' by ' + (fk.faktur_uploaded_by || '')) + '</span>' : '') +
            '<div class="k-phone-only">' + btn('k-btn--primary k-btn--block', 'Unggah Faktur', 'Upload Faktur', 'id="bm-cam" data-min-role="supervisor"', 'camera') + '</div></div>' : '') +
          (R.status === 'completed' ? '<div class="k-card k-card--pad k-stack k-stack--tight">' +
            '<span class="k-h2">' + p2('Slip putaway', 'Putaway slip') + (slip ? ' <span class="k-mono">' + esc(slip.slip_no) + '</span>' : '') + '</span>' +
            '<span class="k-caption" ' + biAttr('Unit yang diterima sudah di rak. Cetak, SPV tanda tangan, simpan sebagai catatan kepatuhan.', 'The received units are on the rack. Print it, the SPV signs, keep it as the compliance record.') + '></span>' +
            '<div class="k-line">' + btn('k-btn--primary', 'Cetak slip putaway', 'Print putaway slip', 'id="bm-slip" data-min-role="supervisor"', 'print') +
              (R.loads.some((l) => l.qty_to_put > 0) ? btn('k-btn--secondary', 'Taruh di rak', 'Put on the rack', 'id="bm-toput"', 'rack') : '') + '</div></div>' : '') +
        '</div></div>' +
      '<div><a class="k-linkbtn" href="barang-masuk.html">' + icon('back', 18) + p2('Semua penerimaan', 'All receipts') + '</a></div></div>';
    const upload = async (files) => {
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      try { await API().form('/receipts/' + R.id + '/faktur', fd); S.toast(['Faktur disimpan.', 'Faktur saved.'], 'ok'); S.rerender(); } catch (e) { S.fail(e); }
    };
    const pickUp = async (cap) => upload(await pickFiles('image/*,application/pdf', true, cap));
    [['#bm-pick'], ['#bm-addpg'], ['#bm-cam', 'environment']].forEach(([sel, cap]) => { const b = $(sel, ctx.body); if (b) b.addEventListener('click', () => pickUp(cap)); });
    const drop = $('#bm-drop', ctx.body);
    if (drop && spv) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); upload(Array.from(e.dataTransfer.files || [])); });
    }
    const sl = $('#bm-slip', ctx.body);
    if (sl) sl.addEventListener('click', () => window.open('barang-masuk.html?slip=' + R.id, '_blank'));
    const tp = $('#bm-toput', ctx.body);
    if (tp) tp.addEventListener('click', () => go({ receipt: R.id, step: 'putaway' }));
    const lk = $('#bm-link', ctx.body);
    if (lk) lk.addEventListener('click', () => linkDialog(R));
    void T;
  }
  const photoName = (k) => ({ sj_signed: t('SJ ditandatangani', 'Signed SJ'), selfie: t('Swafoto', 'Selfie'), sj_driver: t('SJ + driver', 'SJ + driver'), sj_no_po: t('SJ tanpa PO', 'SJ, no PO'), damage: t('Kerusakan', 'Damage') }[k] || k);

  /* ================= 5j: the putaway slip (thermal) ================= */
  /* Printed on the 80 mm thermal printer at the packing counter (48 characters a
   * line, 32 on 58 mm), the same printer and set up as Hiryu's packing slip; on A4
   * when this device has none (Pengaturan, Printer). Long product names wrap onto
   * the next line: Kahf and Labore names differ only at the end (size, variant).
   * The printed slip is Indonesian, like the other paper records. */

  function slipLines(s, W) {
    const P = NJW.print;
    const L = 10;
    const kv = (k, v) => P.wrap(v || '-', W - L).map((x, i) => (i ? ' '.repeat(L) : (k + ' '.repeat(L)).slice(0, L)) + x);
    const from = P.when(s.received_from), to = P.when(s.received_to);
    const diffText = (x) => {
      if (x.kind === 'extra') return x.sku_name + ': ' + x.qty + ' unit lebih, tetap di ' + (x.bin_code || '') + '.';
      if (x.kind === 'damaged') return x.sku_name + ': ' + x.qty + ' unit rusak, ' + (x.place === 'quarantine' ? 'di karantina ' + (x.bin_code || '') + '.' : 'dikembalikan ke driver, tertulis di Surat Jalan.');
      return x.sku_name + ': kurang ' + x.qty + ' unit dari permintaan.';
    };
    const pend = s.differences.filter((x) => x.status === 'pending');
    const sign = (who, names) => [{ b: P.wrap(who + ': ' + (names || ''), W) }, '', 'Tanda tangan ' + '_'.repeat(W - 13), '', 'Tanggal/jam  ' + '_'.repeat(W - 13), ''];
    const out = [
      P.center('NINJA VAN · SATSET WMS', W),
      { b: P.center('SLIP PUTAWAY', W) },
      { b: P.center(s.slip_no || '', W) },
      P.rule('=', W),
      kv('Dark store', S.shortCode(s.site_code) + ' · ' + (s.site_name || '')),
      kv('Merek', (s.brand_name || '') + (s.brand_legal_name ? ' · ' + s.brand_legal_name : '')),
      kv('Ninja ref', s.reference),
      kv('No. PO', s.brand_po_number),
      kv('Diterima', from.date + ', ' + from.time + (s.received_to ? ' sampai ' + to.time : '') + ' WIB'),
      kv('Penerima', (s.receiver || '-') + (s.sj_signed_by ? ' · Surat Jalan ditandatangani ' + s.sj_signed_by : '')),
      kv('Dicetak', P.when().both),
      P.rule('=', W),
    ];
    if (!s.lines.length) out.push(P.wrap('Belum ada unit yang ditaruh di rak.', W));
    s.lines.forEach((l, i) => {
      if (i) out.push(P.rule('-', W));
      out.push({ b: P.wrap((i + 1) + '. ' + l.sku_name, W, '   ') });
      out.push(P.lr('   Jumlah', n(l.qty) + ' pcs', W, '   '));
      if (l.batch_no) out.push(P.lr('   Batch', l.batch_no, W, '   '));
      out.push(P.lr('   Dari bin sementara', l.from_bin, W, '   '));
      out.push({ b: P.lr('   Ke bin rak', l.to_bin, W, '   ') });
      out.push(P.lr('   Warna sekat', l.divider.colour_id + ', minggu ' + l.divider.week_parity, W, '   '));
    });
    out.push(P.rule('=', W), { b: P.lr('Total ditaruh di rak', n(s.total_put) + ' pcs', W) },
      P.wrap('Bin sementara kosong lagi setelah tiap batch. Satu bin, satu produk.', W));
    if (s.differences.length) {
      out.push(P.rule('-', W), { b: P.wrap('SELISIH' + (pend.length ? ', menunggu persetujuan Ops HQ' : '') + ' (tidak ditaruh di rak)', W) });
      s.differences.forEach((x) => out.push(P.wrap('- ' + diffText(x), W, '  ')));
    }
    if (s.claim_deadline) out.push({ b: P.wrap('Batas klaim ke merek (24 jam): ' + P.when(s.claim_deadline).both + '.', W) });
    out.push(P.rule('=', W), ...sign('Ditaruh oleh (staf)', s.signatures.put_by.join(', ')), ...sign('Diperiksa SPV', s.signatures.spv),
      P.rule('-', W), P.wrap('Slip ini catatan kepatuhan. SPV tanda tangan, lalu simpan bersama Surat Jalan dan Faktur dari kiriman ini.', W));
    return out;
  }
  const printSlip = (s) => NJW.print.thermal(NJW.print.slip(slipLines(s, NJW.print.cols())), { title: 'Slip putaway ' + (s.slip_no || '') });

  /* Auto-print (Pengaturan, Printer): once per receipt on this device, when an SPV
   * finishes the receipt (the slip is SPV and up). */
  async function autoSlip(id) {
    const P = NJW.print;
    if (!P || !P.settings().autoSlip || !S.atLeast('supervisor')) return;
    if (!P.once('putaway-slip-' + id)) return;
    try {
      const s = await API().get('/inbound/receipts/' + id + '/slip');
      await printSlip(s);
      S.toast(['Slip putaway ' + s.slip_no + ' dicetak.', 'Putaway slip ' + s.slip_no + ' printed.'], 'ok');
    } catch (e) {
      S.toast(['Slip putaway tidak tercetak otomatis. Cetak dari tanda terima.', 'The putaway slip did not print by itself. Print it from the receipt.'], 'caution');
    }
  }

  async function slipView(ctx, id) {
    S.fullScreen(true, { title: ['Slip putaway', 'Putaway slip'], onBack: () => go({ receipt: id }) });
    const s = await API().get('/inbound/receipts/' + id + '/slip');
    const P = NJW.print;
    P.previewCss();
    const st = P.settings();
    const where = st.thermal === true
      ? note('info', 'Dicetak di printer thermal ' + st.width + ' mm (' + P.cols() + ' karakter per baris).' + (st.kiosk ? '' : ' Di dialog cetak, pilih printer thermal.'),
        'Prints on the ' + st.width + ' mm thermal printer (' + P.cols() + ' characters a line).' + (st.kiosk ? '' : ' In the print dialog, choose the thermal printer.'))
      : st.thermal === false
        ? note('info', 'Perangkat ini tidak punya printer thermal: slip dicetak di kertas A4.', 'This device has no thermal printer: the slip prints on A4 paper.')
        : '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + p2('Printer belum diatur di perangkat ini, jadi slip dicetak di kertas A4. ', 'No printer is set up on this device yet, so the slip prints on A4 paper. ') +
          '<a class="k-linkbtn" href="pengaturan.html?tab=printer" ' + biAttr('Atur printer', 'Set up the printer') + '></a></span></div>';
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      '<div class="k-line" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
        btn('k-btn--secondary', 'Kembali', 'Back', 'id="bm-sback"', 'back') + btn('k-btn--primary', 'Cetak', 'Print', 'id="bm-print"', 'print') + '</div>' +
      where +
      '<div class="bm-roll" lang="id">' + P.slip(slipLines(s, P.cols())) + '</div></div>';
    $('#bm-print', ctx.body).addEventListener('click', () => printSlip(s));
    $('#bm-sback', ctx.body).addEventListener('click', () => go({ receipt: id }));
  }

  /* ================= router ================= */

  S.page(async function (ctx) {
    styles();
    const slip = S.param('slip'), nopo = S.param('nopo'), rid = S.param('receipt'), step = S.param('step');
    if (slip) return slipView(ctx, slip);
    if (nopo) return noPo(ctx, nopo);
    if (!rid) return home(ctx);
    const R = await getReceipt(rid);
    if (R.status !== 'open') {
      if (step === 'putaway') return putawayStep(ctx, R);
      return detail(ctx, R);
    }
    if (step === 'scan') return scanStep(ctx, R);
    if (step === 'manual') return manualStep(ctx, R);
    if (step === 'putaway') return putawayStep(ctx, R);
    if (step === 'summary') return summaryStep(ctx, R);
    return door(ctx, R);
  });
  S.onSiteChange(() => go({}, true));
})();
