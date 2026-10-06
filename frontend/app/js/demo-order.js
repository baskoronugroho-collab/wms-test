/* demo-order.js: the "Buat pesanan dummy" dialog and "Batalkan dari Hiryu"
 * for Mode demo (BUILD.md, Demo toggle). Shared by Pesanan (agent O) and
 * Pengaturan, Demo.
 *
 *   NJW.demoOrder.open({ siteId, onDone })        -> Promise<result | null>
 *   NJW.demoOrder.cancel(grabOrderId, { gm, onDone }) -> Promise<result | null>
 *
 * open() asks for the Hiryu store, the number of products (or acak), the
 * quantity per product (or acak), optionally one product the picker will find
 * missing with the customer's instruction (Ganti / Hapus / Batalkan / Hubungi),
 * and optionally a scheduled time. It calls POST /api/demo/orders, which
 * builds a full message 1 (contract v1.1) and passes it through the very
 * handler Hiryu calls. The result shows the GM number, what to do at the
 * missing line, and the exact JSON sent.
 *
 * cancel() sends message 2 (POST /api/demo/orders/{grab_order_id}/cancel).
 *
 * Load it with <script src="js/demo-order.js"></script> after shell.js, or
 * lazily (as pengaturan-demo.js does) by adding that script tag on demand.
 */
(function () {
  'use strict';
  window.NJW = window.NJW || {};
  const S = () => NJW.shell;
  const api = () => NJW.shell.api();

  const CSS = `
  .dm-form { display:grid; gap:16px; }
  .dm-seg { display:flex; flex-wrap:wrap; gap:6px; }
  .dm-seg button { min-height:44px; padding:0 14px; border:2px solid var(--rule); border-radius:12px; background:var(--surface); font-weight:700; color:var(--ink-2); }
  .dm-seg button[aria-pressed="true"] { border-color:var(--action); background:var(--action-bg); color:var(--action); }
  .dm-ins { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  @media (min-width:640px) { .dm-ins { grid-template-columns:repeat(4,minmax(0,1fr)); } }
  .dm-ins button { min-height:64px; padding:8px 10px; border:2px solid var(--rule); border-radius:12px; background:var(--surface); display:flex; flex-direction:column; align-items:flex-start; gap:2px; text-align:left; }
  .dm-ins button b { font-size:15px; color:var(--ink); }
  .dm-ins button small { font-size:12px; color:var(--muted); font-weight:600; }
  .dm-ins button[aria-pressed="true"] { border-color:var(--action); background:var(--action-bg); }
  .dm-sub { display:grid; gap:12px; padding:12px 14px; border-radius:12px; background:var(--ground); }
  .dm-gm { font-family:var(--mono); font-weight:700; font-size:40px; letter-spacing:.02em; color:var(--ink); line-height:1; }
  .dm-json { margin:0; max-height:320px; overflow:auto; background:var(--navy); color:#DCE3EC; border-radius:12px; padding:14px 16px; font:500 12.5px/1.55 var(--mono); white-space:pre; }
  .dm-json .k { color:#9CC3FF; } .dm-json .s { color:#A8E6B5; } .dm-json .n { color:#FFD08A; } .dm-json .b { color:#F5A3C7; }
  details.dm-details summary { cursor:pointer; font-weight:700; color:var(--action); min-height:36px; display:flex; align-items:center; }
  `;
  function style() {
    if (document.getElementById('dm-css')) return;
    const s = document.createElement('style');
    s.id = 'dm-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* JSON with colours, escaped. */
  function jsonHtml(v) {
    const text = JSON.stringify(v, null, 2) || '';
    const esc = S().esc;
    return esc(text).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (m, str, colon, lit, num) => {
      if (str) return '<span class="' + (colon ? 'k' : 's') + '">' + str + '</span>' + (colon || '');
      if (lit) return '<span class="b">' + lit + '</span>';
      return '<span class="n">' + num + '</span>';
    });
  }

  const INS = [
    ['replace', ['Ganti', 'Replace'], ['dengan produk lain', 'with another product']],
    ['remove', ['Hapus', 'Remove'], ['dari pesanan', 'from the order']],
    ['cancel_order', ['Batalkan', 'Cancel'], ['seluruh pesanan', 'the whole order']],
    ['contact_customer', ['Hubungi', 'Contact'], ['pelanggan (= batal)', 'customer (= cancel)']],
  ];
  const insLabel = (k) => (INS.find((x) => x[0] === k) || [k, [k, k]])[1];

  function seg(name, opts, value) {
    const S_ = S();
    return '<div class="dm-seg" role="group" data-seg="' + name + '">' + opts.map((o) =>
      '<button type="button" data-v="' + S_.esc(String(o[0])) + '" aria-pressed="' + (String(o[0]) === String(value)) + '" ' +
      S_.biAttr(o[1][0], o[1][1]) + '>' + S_.esc(S_.t(o[1][0], o[1][1])) + '</button>').join('') + '</div>';
  }
  function segValue(root, name) {
    const b = root.querySelector('[data-seg="' + name + '"] [aria-pressed="true"]');
    return b ? b.dataset.v : null;
  }
  function wireSeg(root, onChange) {
    root.querySelectorAll('.dm-seg').forEach((g) => g.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (onChange) onChange(g.dataset.seg, b.dataset.v);
    }));
  }

  async function open(o) {
    o = o || {};
    style();
    const sh = S();
    const { esc, biAttr, bis, icon, t } = sh;
    const siteId = o.siteId || sh.siteId();
    if (!siteId) { sh.toast(['Pilih satu dark store dulu.', 'Choose one dark store first.'], 'caution'); return null; }
    let data;
    try { data = await api().get('/demo/stores' + api().qs({ site_id: siteId })); }
    catch (e) { sh.fail(e); return null; }
    if (!data.demo_mode) {
      sh.toast(['Mode demo belum menyala untuk dark store ini (Pengaturan, Demo).', 'Mode demo is not on for this dark store (Settings, Demo).'], 'caution');
      return null;
    }
    const stores = (data.stores || []).filter((s) => (s.items || []).some((i) => i.available));
    if (!stores.length) {
      sh.toast(['Tidak ada toko Hiryu aktif dengan menu di dark store ini.', 'No active Hiryu store with a menu at this dark store.'], 'caution');
      return null;
    }

    const box = document.createElement('div');
    box.className = 'dm-form';
    box.innerHTML =
      '<div class="k-note k-note--info">' + icon('info') + bis('Pesanan dibuat persis seperti pesan 1 dari Hiryu dan masuk lewat jalur yang sama. Tidak ada data pelanggan.',
        'The order is made exactly like Hiryu\'s message 1 and comes in the same way. No customer data.') + '</div>' +
      '<div class="k-field"><label class="k-field__label" for="dm-store" ' + biAttr('Toko Hiryu', 'Hiryu store') + '></label>' +
      '<select id="dm-store" class="k-select"><option value="">' + esc(t('Acak', 'Random')) + '</option>' +
      stores.map((s) => '<option value="' + s.hiryu_store_id + '">' + esc(s.name) + ' (#' + s.hiryu_store_id + ')</option>').join('') + '</select></div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Jumlah produk', 'Number of products') + '></span>' +
      seg('lines', [['', ['Acak (3 sampai 6)', 'Random (3 to 6)']], [1, ['1', '1']], [2, ['2', '2']], [3, ['3', '3']], [4, ['4', '4']], [5, ['5', '5']], [6, ['6', '6']]], '') + '</div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Jumlah per produk', 'Quantity per product') + '></span>' +
      seg('qty', [['', ['Acak (1 sampai 3)', 'Random (1 to 3)']], [1, ['1', '1']], [2, ['2', '2']], [3, ['3', '3']], [4, ['4', '4']]], '') +
      '<span class="k-field__hint" ' + biAttr('Unit = jumlah × unit per jual (misalnya paket isi 2).', 'Units = quantity × units per sale (for example a 2-pack).') + '></span></div>' +
      '<div class="k-switchrow"><button type="button" class="k-switch" id="dm-miss" aria-checked="false" ' + 'data-aria-id="Satu produk tidak ada" data-aria-en="One product missing" aria-label="Satu produk tidak ada"></button>' +
      '<div class="k-stack k-stack--tight">' + bis('Satu produk tidak ada', 'One product missing', 'k-strong') +
      bis('Pemetik akan menekan Barang tidak ada; WMS menjalankan instruksi pelanggan dan mengirim pesan 5.', 'The picker presses Item missing; the WMS follows the customer\'s instruction and sends message 5.', 'k-caption') + '</div></div>' +
      '<div class="dm-sub" id="dm-misswrap" hidden>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Instruksi pelanggan dari Grab', 'The customer\'s instruction from Grab') + '></span>' +
      '<div class="dm-ins" data-ins>' + INS.map((x, i) => '<button type="button" data-v="' + x[0] + '" aria-pressed="' + (i === 0) + '"><b ' + biAttr(x[1][0], x[1][1]) + '></b><small ' + biAttr(x[2][0], x[2][1]) + '></small></button>').join('') + '</div></div>' +
      '<div class="k-field"><label class="k-field__label" for="dm-item" ' + biAttr('Produk yang tidak ada', 'The missing product') + '></label><select id="dm-item" class="k-select"></select></div>' +
      '<div class="k-field" id="dm-repwrap"><label class="k-field__label" for="dm-rep" ' + biAttr('Ganti dengan', 'Replace with') + '></label><select id="dm-rep" class="k-select"></select></div>' +
      '</div>' +
      '<div class="k-switchrow"><button type="button" class="k-switch" id="dm-sched" aria-checked="false" data-aria-id="Pesanan terjadwal" data-aria-en="Scheduled order" aria-label="Pesanan terjadwal"></button>' +
      '<div class="k-stack k-stack--tight">' + bis('Pesanan terjadwal', 'Scheduled order', 'k-strong') +
      bis('Menunggu di Terjadwal, lalu ke pemetik 20 menit sebelum waktunya.', 'Waits in Scheduled, then goes to a picker 20 minutes before.', 'k-caption') + '</div></div>' +
      '<div class="dm-sub" id="dm-schedwrap" hidden><div class="k-field"><span class="k-field__label" ' + biAttr('Waktu kirim', 'Delivery time') + '></span>' +
      seg('sched', [[30, ['30 menit lagi', 'in 30 min']], [60, ['1 jam lagi', 'in 1 hour']], [120, ['2 jam lagi', 'in 2 hours']]], 30) + '</div></div>';

    const $ = (q) => box.querySelector(q);
    const itemsOf = () => {
      const v = $('#dm-store').value;
      const list = v ? stores.filter((s) => String(s.hiryu_store_id) === v) : stores;
      return list.length === 1 ? list[0].items.filter((i) => i.available) : [];
    };
    const ins = () => { const b = box.querySelector('[data-ins] [aria-pressed="true"]'); return b ? b.dataset.v : 'replace'; };
    function fillItems() {
      const items = itemsOf();
      const opt = (i) => '<option value="' + esc(i.hiryu_item_id) + '">' + esc(i.name || i.hiryu_item_id) + (i.stock > 0 ? '' : ' · ' + esc(t('stok 0', 'stock 0'))) + '</option>';
      $('#dm-item').innerHTML = '<option value="">' + esc(t('Acak', 'Random')) + '</option>' + items.map(opt).join('');
      $('#dm-rep').innerHTML = '<option value="">' + esc(t('Acak, yang ada stoknya', 'Random, one in stock')) + '</option>' + items.filter((i) => i.stock > 0).map(opt).join('');
      $('#dm-item').disabled = !items.length;
      $('#dm-rep').disabled = !items.length;
      $('#dm-repwrap').hidden = ins() !== 'replace';
    }
    $('#dm-store').addEventListener('change', fillItems);
    box.querySelector('[data-ins]').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      box.querySelectorAll('[data-ins] button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#dm-repwrap').hidden = ins() !== 'replace';
    });
    sh.toggle($('#dm-miss'), (on) => { $('#dm-misswrap').hidden = !on; });
    sh.toggle($('#dm-sched'), (on) => { $('#dm-schedwrap').hidden = !on; });
    wireSeg(box);
    fillItems();

    return new Promise((resolve) => {
      let result = null;
      const m = sh.modal({
        title: ['Buat pesanan dummy', 'Make a dummy order'], body: box, wide: true,
        onClose: () => resolve(result),
        actions: [
          { label: ['Batal', 'Cancel'], kind: 'secondary' },
          { label: ['Kirim seperti Hiryu', 'Send as Hiryu'], kind: 'primary', minRole: 'supervisor', onClick: async (close, btn) => {
            const store = $('#dm-store').value;
            const lines = segValue(box, 'lines');
            const qty = segValue(box, 'qty');
            const missOn = $('#dm-miss').getAttribute('aria-checked') === 'true';
            const schedOn = $('#dm-sched').getAttribute('aria-checked') === 'true';
            const body = {
              site_id: siteId,
              hiryu_store_id: store ? +store : null,
              lines: lines ? +lines : null,
              item_qty: qty ? +qty : null,
              missing: missOn ? {
                type: ins(),
                hiryu_item_id: $('#dm-item').value || null,
                replace_hiryu_item_id: ins() === 'replace' ? ($('#dm-rep').value || null) : null,
              } : null,
              scheduled_in_minutes: schedOn ? +(segValue(box, 'sched') || 30) : null,
            };
            const res = await api().post('/demo/orders', body);
            result = res;
            showResult(m, res);
            if (o.onDone) try { o.onDone(res); } catch (e) { /* caller */ }
            btn.remove();
            return false;
          } },
        ],
      });
    });
  }

  function showResult(m, res) {
    const sh = S();
    const { esc, biAttr, bis, icon, t } = sh;
    const ok = res.http_status === 201 || res.http_status === 200;
    const dup = res.answer && res.answer.status === 'duplicate';
    const ml = res.missing_line;
    let missHtml = '';
    if (ml) {
      const word = insLabel(ml.instruction);
      missHtml = '<div class="k-note k-note--caution">' + icon('warn') + '<div class="k-stack k-stack--tight">' +
        '<span class="k-strong">' + esc(t('Produk yang tidak ada: ', 'Missing product: ')) + esc(ml.name || ml.hiryu_item_id) + '</span>' +
        '<span>' + esc(t('Saat mengambil, tekan Barang tidak ada di produk ini. Instruksi pelanggan: ', 'When picking, press Item missing on this product. Customer\'s instruction: ')) +
        '<b>' + esc(t(word[0], word[1])) + '</b>' + (ml.replace_name ? esc(t(' dengan ', ' with ')) + '<b>' + esc(ml.replace_name) + '</b>' : '') + '.</span></div></div>';
    }
    const p = /^(.{6,}?) \/ (.{6,})$/.exec(res.text || '') || [null, res.text, res.text];
    m.body.innerHTML = '<div class="k-stack">' +
      (ok
        ? '<div class="k-note k-note--ok">' + icon('check') + '<span>' + esc(dup ? t('Pesanan ini sudah ada (duplikat).', 'This order exists already (duplicate).') :
          t('Pesanan masuk ke WMS. Muncul di antrean dan diberikan ke pemetik.', 'The order is in the WMS. It shows on the queue and goes to a picker.')) + '</span></div>'
        : '<div class="k-note k-note--stop">' + icon('warn') + '<span>' + esc(t('Ditolak oleh penerima: ', 'Refused by the receiver: ')) +
          esc(sh.pick((res.answer && res.answer.detail) || '')) + '</span></div>') +
      '<div class="k-line" style="gap:16px;flex-wrap:wrap"><span class="dm-gm">' + esc(res.gm_number) + '</span>' +
      '<div class="k-stack k-stack--tight"><span class="k-strong">' + esc(t(p[1], p[2])) + '</span>' +
      '<span class="k-caption k-mono">' + esc(res.grab_order_id) + ' · HTTP ' + esc(String(res.http_status)) + '</span></div></div>' +
      missHtml +
      '<details class="dm-details"><summary ' + biAttr('Pesan 1 yang dikirim (JSON persis)', 'Message 1 as sent (exact JSON)') + '></summary>' +
      '<pre class="dm-json">' + jsonHtml(res.message) + '</pre>' +
      '<div class="k-caption" style="margin:8px 0 4px">' + esc(t('Jawaban', 'Answer')) + '</div><pre class="dm-json">' + jsonHtml(res.answer) + '</pre></details>' +
      '<span class="k-caption">' + bis('Semua pesan masuk dan keluar ada di Pengaturan, Integrasi Hiryu, Pesan Hiryu.', 'Every message in and out is under Settings, Hiryu integration, Hiryu messages.') +
      ' <a href="pengaturan.html?tab=integrasi" ' + biAttr('Buka', 'Open') + '></a></span></div>';
    sh.applyLang(m.body);
    const foot = m.el.querySelector('.k-modal__foot');
    const first = foot && foot.querySelector('.k-btn');
    if (first) { const sp = first.querySelector('span'); sp.dataset.id = 'Tutup'; sp.dataset.en = 'Close'; sp.textContent = t('Tutup', 'Close'); }
  }

  async function cancel(grabOrderId, o) {
    o = o || {};
    style();
    const sh = S();
    const { biAttr, bis, esc, t } = sh;
    const box = document.createElement('div');
    box.className = 'dm-form';
    box.innerHTML = '<p class="k-p" style="margin:0">' + esc(t('Hiryu mengirim pesan 2 untuk ', 'Hiryu sends message 2 for ')) + '<b class="k-mono">' + esc(o.gm || grabOrderId) + '</b>. ' +
      bis('Kunci di WMS dilepas; barang yang sudah diambil masuk Kembalikan ke rak.', 'Holds in the WMS are released; picked units go to Put back to rack.') + '</p>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Dibatalkan oleh', 'Cancelled by') + '></span>' +
      seg('by', [['customer', ['Pelanggan', 'Customer']], ['grab', ['Grab', 'Grab']], ['merchant', ['Merchant', 'Merchant']]], 'customer') + '</div>' +
      '<div class="k-field"><label class="k-field__label" for="dm-code" ' + biAttr('Alasan', 'Reason') + '></label><select id="dm-code" class="k-select">' +
      [['2004', 'Customer requested'], ['2001', 'Item out of stock'], ['2002', 'Store closed'], ['2003', 'Too busy'], ['', t('Tanpa alasan (null)', 'No reason (null)')]]
        .map((x) => '<option value="' + x[0] + '">' + (x[0] ? x[0] + ' ' : '') + esc(x[1]) + '</option>').join('') + '</select></div>';
    wireSeg(box, (name, v) => {
      if (name !== 'by') return;
      box.querySelector('#dm-code').value = v === 'customer' ? '2004' : v === 'merchant' ? '2001' : '2002';
    });
    return new Promise((resolve) => {
      let result = null;
      sh.modal({
        title: ['Batalkan dari Hiryu', 'Cancel from Hiryu'], body: box,
        onClose: () => resolve(result),
        actions: [
          { label: ['Tutup', 'Close'], kind: 'secondary' },
          { label: ['Kirim pembatalan', 'Send the cancel'], kind: 'danger', minRole: 'supervisor', onClick: async () => {
            const code = box.querySelector('#dm-code').value;
            const res = await api().post('/demo/orders/' + encodeURIComponent(grabOrderId) + '/cancel',
              { cancelled_by: segValue(box, 'by') || 'customer', reason_code: code || null });
            result = res;
            const st = res.answer && res.answer.status;
            if (res.http_status >= 300) sh.toast(sh.pick((res.answer && res.answer.detail) || 'Ditolak / Refused'), 'stop');
            else sh.toast(st === 'already_cancelled' ? ['Pesanan sudah dibatalkan sebelumnya.', 'The order was already cancelled.'] :
              ['Pembatalan dikirim. Pesanan jadi merah.', 'Cancel sent. The order turns red.'], 'ok');
            if (o.onDone) try { o.onDone(res); } catch (e) { /* caller */ }
          } },
        ],
      });
    });
  }

  NJW.demoOrder = { open, cancel, jsonHtml };

})();

