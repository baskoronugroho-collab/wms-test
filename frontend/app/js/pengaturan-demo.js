/* pengaturan-demo.js: Pengaturan, Demo (BUILD.md, Demo toggle).
 *
 * Mode demo per hub, SPV and above:
 *   GET /api/demo/settings?site_id=      {demo_mode, can_edit}
 *   PUT /api/demo/settings               {site_id, demo_mode}
 * When on, Buat pesanan dummy (js/demo-order.js) makes orders exactly like
 * Hiryu's message 1, and messages 3, 4 and 5 of this hub go to the built-in
 * Hiryu stand-in, so Pesan Hiryu shows the whole conversation.
 *
 * Reset stok demo (SPV and above, Mode demo on):
 *   GET  /api/demo/reset-stock?site_id=  what it will change, and what refuses it
 *   POST /api/demo/reset-stock           {site_id}: the preset products back to
 *        their seed level, as stock corrections through the ledger
 *
 * Kiriman demo baru (SPV and above, Mode demo on), for the inbound part:
 *   GET  /api/demo/delivery?site_id=     the latest demo delivery, and what refuses a new one
 *   POST /api/demo/delivery              {site_id}: a fresh Labore restock request, already
 *        confirmed, brand PO PO/LBR/DEMO, arriving today; an earlier one not received
 *        yet is cancelled, one being received refuses it
 *
 * Contoh: produk tanpa bin (SPV and above, Mode demo on), to rehearse Rak & bin, Perlu bin:
 *   GET  /api/demo/needs-bin?site_id=       the current example, or none
 *   POST /api/demo/needs-bin                {site_id}: Siapkan contoh, a real product taken off its bin
 *   POST /api/demo/needs-bin/reset          {site_id}: Kembalikan seperti semula
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, icon, t } = S;
  const api = () => S.api();
  const span = (p, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + ' ' + biAttr(p[0], p[1]) + '>' + esc(t(p[0], p[1])) + '</span>';

  /* js/demo-order.js on demand, with the same ?v= as shell.js. */
  function loadDemoOrder() {
    if (NJW.demoOrder) return Promise.resolve(NJW.demoOrder);
    return new Promise((ok, bad) => {
      const sh = document.querySelector('script[src*="shell.js"]');
      const v = sh ? (sh.getAttribute('src').split('?')[1] || '') : '';
      const s = document.createElement('script');
      s.src = 'js/demo-order.js' + (v ? '?' + v : '');
      s.onload = () => ok(NJW.demoOrder);
      s.onerror = () => bad(new Error('js/demo-order.js'));
      document.body.appendChild(s);
    });
  }

  const STEPS = [
    [['Nyalakan Mode demo untuk dark store ini.', 'Switch Mode demo on for this dark store.'], null],
    [['Tekan Buat pesanan dummy (di sini, atau di Pesanan: Papan antrean dan Ambil).', 'Press Make a dummy order (here, or in Orders: Queue board and Pick).'], 'H1'],
    [['Pesanan masuk seperti pesan 1 dari Hiryu, dengan instruksi pelanggan bila ada barang yang tidak ada.', 'The order comes in like Hiryu\'s message 1, with the customer\'s instruction when an item is missing.'], 'H9'],
    [['Ambil, kemas dan serahkan seperti biasa. Pesan 3, 4 dan 5 dikirim ke stand-in Hiryu.', 'Pick, pack and hand over as usual. Messages 3, 4 and 5 go to the Hiryu stand-in.'], 'H3 H4 H5'],
    [['Lihat semuanya di Integrasi Hiryu, Pesan Hiryu: pemicu, nomor H dan JSON persis.', 'Watch it all under Hiryu integration, Hiryu messages: trigger, H number and exact JSON.'], null],
  ];

  /* Kiriman demo: a fresh confirmed Labore delivery for Inbound. */
  const DV_STATUS = {
    draft: ['Draf', 'Draft', 'info'], raised: ['Diajukan', 'Raised', 'info'], po: ['Permintaan', 'Request', 'info'],
    sent: ['Terkirim, menunggu merek', 'Sent, waiting for the brand', 'info'],
    confirmed: ['Dikonfirmasi, siap diterima', 'Confirmed, ready to receive', 'ok'],
    receiving: ['Sedang diterima', 'Being received', 'info'],
    variance_review: ['Selisih', 'Differences', 'caution'],
    variance_signoff: ['Diterima, selisih menunggu Ops HQ', 'Received, differences waiting for Ops HQ', 'caution'],
    received: ['Sudah diterima', 'Received', 'ok'], cancelled: ['Dibatalkan', 'Cancelled', 'stop'],
  };
  const REPLACEABLE = ['draft', 'raised', 'po', 'sent', 'confirmed'];

  function deliveryCard(st, dv) {
    const on = !!st.demo_mode;
    const po = (dv && dv.brand_po_number) || 'PO/LBR/DEMO';
    const planned = (dv && dv.planned) || [];
    const units = planned.reduce((a, l) => a + (l.qty_confirmed || 0), 0);
    const plan = planned.map((l) => l.sku_code + ' x' + l.qty_confirmed).join(', ');
    const d = dv && dv.delivery;
    /* "Mode demo is not on" is already said under the button. */
    const problems = ((dv && dv.problems) || []).filter((x) => on || x.indexOf('Mode demo') !== 0);
    const stp = d ? (DV_STATUS[d.status] || [d.status, d.status, 'info']) : null;
    const lineRow = (l) => '<tr><td><div class="k-cell2"><span class="k-cell2__main k-mono">' + esc(l.sku_code) + '</span>' +
      '<span class="k-cell2__sub">' + esc(l.name || '') + '</span></div></td>' +
      '<td class="k-num">' + l.qty_confirmed + '</td><td class="k-num">' + (l.qty_received == null ? '-' : l.qty_received) + '</td></tr>';
    const current = d
      ? '<div class="k-stack k-stack--tight" style="margin-top:4px"><span class="k-eyebrow" ' + biAttr('Kiriman demo sekarang', 'Current demo delivery') + '></span>' +
        '<div class="k-line" style="gap:10px;flex-wrap:wrap;align-items:center">' +
        '<span class="k-mono k-strong">' + esc(d.reference) + '</span>' +
        '<span class="k-tag k-mono">' + esc(d.brand_po_number) + '</span>' + S.pill(stp[2], stp[0], stp[1]) +
        (d.eta_date ? '<span class="k-caption">' + span(['Tiba ' + S.fmt.date(d.eta_date), 'Arriving ' + S.fmt.date(d.eta_date)]) + '</span>' : '') + '</div>' +
        '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th>' +
        '<th class="k-num" ' + biAttr('Dikonfirmasi', 'Confirmed') + '></th><th class="k-num" ' + biAttr('Diterima', 'Received') + '></th></tr></thead><tbody>' +
        d.lines.map(lineRow).join('') +
        '<tr><td class="k-strong">' + span(['Jumlah', 'Total']) + '</td><td class="k-num k-strong">' + d.units + '</td><td></td></tr>' +
        '</tbody></table></div></div>'
      : '<span class="k-caption">' + span(['Belum ada kiriman demo di dark store ini.', 'No demo delivery at this dark store yet.']) + '</span>';
    return '<div class="k-card k-card--pad k-stack">' +
      '<span class="k-h2" style="font-size:18px">' + span(['Kiriman demo', 'Demo delivery']) + '</span>' +
      '<p class="k-p" style="margin:0">' + span([
        'Membuat permintaan restock Labore baru di dark store ini yang sudah dikonfirmasi merek, dengan No. PO merek ' + po + ' dan tiba hari ini, supaya setiap latihan punya kiriman untuk diterima. Terima di Barang masuk dengan mengetik atau memindai nomor itu. Kiriman demo sebelumnya yang belum diterima dibatalkan.',
        'Makes a new Labore restock request at this dark store, already confirmed by the brand, with brand PO ' + po + ' and arriving today, so every rehearsal has a delivery to receive. Receive it in Inbound by typing or scanning that number. An earlier demo delivery not received yet is cancelled.']) + '</p>' +
      (plan ? '<span class="k-caption">' + span(['Isi: ' + plan + ' (' + units + ' unit). Tidak ada pesan ke Hiryu.', 'Lines: ' + plan + ' (' + units + ' units). No message to Hiryu.']) + '</span>' : '') +
      problems.map((x) => '<div class="k-note k-note--caution">' + icon('warn') + '<span>' + esc(S.pick(x)) + '</span></div>').join('') +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="k-btn k-btn--secondary" data-delivery data-min-role="supervisor"' + (on && dv && dv.can_create ? '' : ' disabled') + '>' + icon('plus') + span(['Kiriman demo baru', 'New demo delivery']) + '</button>' +
      '<a class="k-btn k-btn--secondary" href="barang-masuk.html">' + icon('inbound') + span(['Buka Barang masuk', 'Open Inbound']) + '</a>' +
      (on ? '' : '<span class="k-caption">' + span(['Nyalakan Mode demo dulu.', 'Switch Mode demo on first.']) + '</span>') + '</div>' +
      current + '</div>';
  }

  /* Contoh: produk tanpa bin. A real product is taken off its bin so it shows in Rak & bin,
   * Perlu bin; the trainer gives it a bin again and prints the bin label. */
  function needsBinCard(st, nb) {
    const on = !!st.demo_mode;
    const ex = nb && nb.example;
    const sizeP = ex ? (ex.bin_size === 'KECIL' ? ['Kecil', 'Small'] : ['Besar', 'Large']) : null;
    const prod = ex ? (ex.name || ex.sku_code) + ' (' + ex.sku_code + ')' : null;
    const steps = [
      ['Buka Rak & bin, tab Perlu bin.', 'Open Racks & bins, tab Need a bin.'],
      [prod ? 'Pilih produk ' + prod + '.' : 'Pilih produk contoh.', prod ? 'Pick the product ' + prod + '.' : 'Pick the example product.'],
      [sizeP ? 'Pilih bin kosong ukuran ' + sizeP[0] + ', tekan Simpan di.' : 'Pilih bin kosong seukuran produknya, tekan Simpan di.',
        sizeP ? 'Pick an empty bin of size ' + sizeP[1] + ', press Save at.' : 'Pick an empty bin of the product\'s size, press Save at.'],
      ['Cetak label bin kalau perlu.', 'Print the bin label if needed.'],
    ];
    const problems = ((nb && nb.problems) || []).filter((x) => on || x.indexOf('Mode demo') !== 0);
    const current = ex
      ? '<div class="k-stack k-stack--tight" style="margin-top:4px"><span class="k-eyebrow" ' + biAttr('Contoh sekarang', 'Current example') + '></span>' +
        '<div class="k-line" style="gap:10px;flex-wrap:wrap;align-items:center">' +
        '<span class="k-strong">' + esc(ex.name || ex.sku_code) + '</span>' +
        '<span class="k-tag k-mono">' + esc(ex.sku_code) + '</span>' +
        '<span class="k-tag">' + span(['Bin ' + sizeP[0], sizeP[1] + ' bin']) + '</span>' +
        (ex.waiting ? S.pill('caution', 'Di Perlu bin', 'In Need a bin')
          : S.pill('ok', 'Sudah punya bin ' + ex.current_bin, 'Has a bin: ' + ex.current_bin)) + '</div>' +
        '<span class="k-caption">' + span([
          'Tadinya di bin ' + ex.original_bin + (ex.original_bin_free ? ' (kosong sekarang)' : ' (sudah dipakai)') +
            (ex.units_cleared ? '. ' + ex.units_cleared + ' unit stoknya dikosongkan dan kembali saat Kembalikan seperti semula.' : '.'),
          'It was in bin ' + ex.original_bin + (ex.original_bin_free ? ' (free now)' : ' (in use now)') +
            (ex.units_cleared ? '. Its ' + ex.units_cleared + ' units of stock were emptied and come back with Put it back as it was.' : '.')]) + '</span></div>'
      : '<span class="k-caption">' + span(['Belum ada contoh di dark store ini.', 'No example at this dark store yet.']) + '</span>';
    return '<div class="k-card k-card--pad k-stack">' +
      '<span class="k-h2" style="font-size:18px">' + span(['Contoh: produk tanpa bin', 'Example: a product without a bin']) + '</span>' +
      '<p class="k-p" style="margin:0">' + span([
        'Melepas satu produk asli dari Hiryu dari binnya, supaya muncul di Rak & bin, tab Perlu bin. Lalu kamu memberinya bin lagi, bin yang sama atau yang lain. Stok produk itu dikosongkan dulu (dicatat sebagai koreksi stok).',
        'Takes one real Hiryu product off its bin, so it shows in Racks & bins, tab Need a bin. Then you give it a bin again, the same one or another. Its stock is emptied first (recorded as a stock correction).']) + '</p>' +
      '<ol class="k-stack" style="margin:0;padding-left:22px">' + steps.map((x) => '<li>' + span(x) + '</li>').join('') + '</ol>' +
      problems.map((x) => '<div class="k-note k-note--caution">' + icon('warn') + '<span>' + esc(S.pick(x)) + '</span></div>').join('') +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="k-btn k-btn--secondary" data-nb-setup data-min-role="supervisor"' + (on && nb && nb.can_setup ? '' : ' disabled') + '>' + icon('plus') + span(['Siapkan contoh', 'Set up the example']) + '</button>' +
      '<button type="button" class="k-btn k-btn--secondary" data-nb-reset data-min-role="supervisor"' + (on && nb && nb.can_reset ? '' : ' disabled') + '>' + icon('count') + span(['Kembalikan seperti semula', 'Put it back as it was']) + '</button>' +
      '<a class="k-btn k-btn--secondary" href="rak-bin.html?tab=perlu">' + icon('grid') + span(['Buka Perlu bin', 'Open Need a bin']) + '</a>' +
      (on ? '' : '<span class="k-caption">' + span(['Nyalakan Mode demo dulu.', 'Switch Mode demo on first.']) + '</span>') + '</div>' +
      current + '</div>';
  }

  async function loadNeedsBin() {
    if (!S.atLeast('supervisor')) return null;
    try { return await api().get('/demo/needs-bin' + api().qs({ site_id: S.siteId() })); }
    catch (e) { return null; }
  }

  async function newDelivery(dv) {
    const d = dv && dv.delivery;
    if (d && REPLACEABLE.indexOf(d.status) >= 0) {
      const ok = await S.confirm({
        title: ['Kiriman demo baru', 'New demo delivery'],
        text: [d.reference + ' belum diterima. Kiriman itu dibatalkan dan diganti kiriman demo baru.',
          d.reference + ' has not been received. It is cancelled and replaced by a new demo delivery.'],
        ok: ['Kiriman demo baru', 'New demo delivery'],
      });
      if (!ok) return null;
    }
    const r = await api().post('/demo/delivery', { site_id: S.siteId() });
    S.toast(r.message || ['Kiriman demo siap diterima.', 'Demo delivery ready to receive.'], 'ok');
    return r;
  }

  async function loadDelivery() {
    if (!S.atLeast('supervisor')) return null;
    try { return await api().get('/demo/delivery' + api().qs({ site_id: S.siteId() })); }
    catch (e) { return null; }
  }

  function html(st, dv, nb) {
    const on = !!st.demo_mode;
    return '<div class="k-stack k-stack--loose">' +
      '<div class="k-card k-card--pad k-stack' + (on ? ' k-card--focus' : '') + '">' +
      '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:12px">' +
      '<div class="k-stack k-stack--tight"><span class="k-eyebrow">Dark store ' + esc(S.shortCode(st.site_code)) + '</span>' +
      '<span class="k-h2" style="font-size:22px">' + span(['Mode demo', 'Mode demo']) + '</span></div>' +
      '<div class="k-switchrow"><button type="button" class="k-switch" data-demo aria-checked="' + on + '" data-min-role="supervisor" ' +
      'data-aria-id="Mode demo" data-aria-en="Mode demo" aria-label="Mode demo"></button>' +
      (on ? S.pill('ok', 'Menyala', 'On') : S.pill('', 'Mati', 'Off')) + '</div></div>' +
      '<p class="k-p" style="margin:0">' + span(['Untuk menunjukkan sambungan Hiryu dari awal sampai akhir sebelum Hiryu mengirim apa pun. Pesanan dummy masuk lewat jalur yang sama dengan pesanan Hiryu, dan semua pesan keluar diterima stand-in di dalam WMS.',
        'To show the Hiryu link end to end before Hiryu sends anything. Dummy orders come in the same way as Hiryu\'s orders, and every message out is taken by a stand-in inside the WMS.']) + '</p>' +
      (on
        ? '<div class="k-note k-note--caution">' + icon('warn') + span(['Selama menyala, pesan 3, 4 dan 5 dark store ini tidak sampai ke Hiryu yang asli. Matikan setelah demo.',
          'While on, this dark store\'s messages 3, 4 and 5 do not reach the real Hiryu. Switch it off after the demo.']) + '</div>'
        : '') +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="k-btn k-btn--primary" data-make data-min-role="supervisor"' + (on ? '' : ' disabled') + '>' + icon('plus') + span(['Buat pesanan dummy', 'Make a dummy order']) + '</button>' +
      '<a class="k-btn k-btn--secondary" href="pengaturan.html?tab=integrasi">' + icon('list') + span(['Lihat Pesan Hiryu', 'See Hiryu messages']) + '</a>' +
      '<a class="k-btn k-btn--secondary" href="pesanan.html?tab=papan">' + icon('grid') + span(['Papan antrean', 'Queue board']) + '</a></div></div>' +
      '<div class="k-card k-card--pad k-stack">' +
      '<span class="k-h2" style="font-size:18px">' + span(['Reset stok demo', 'Reset demo stock']) + '</span>' +
      '<p class="k-p" style="margin:0">' + span(['Mengembalikan produk keempat preset (termasuk pengganti) ke jumlah awal di bin raknya, supaya latihan berikutnya sama. Dicatat sebagai koreksi stok dengan alasan Reset demo, dan stok baru dikirim ke Hiryu.',
        'Puts the products of the four presets (the replacement too) back to their starting number in their rack bins, so the next rehearsal is the same. Recorded as stock corrections with reason Reset demo, and the new stock goes to Hiryu.']) + '</p>' +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' +
      '<button type="button" class="k-btn k-btn--secondary" data-reset data-min-role="supervisor"' + (on ? '' : ' disabled') + '>' + icon('count') + span(['Reset stok demo', 'Reset demo stock']) + '</button>' +
      (on ? '' : '<span class="k-caption">' + span(['Nyalakan Mode demo dulu.', 'Switch Mode demo on first.']) + '</span>') + '</div></div>' +
      deliveryCard(st, dv) +
      needsBinCard(st, nb) +
      '<div class="k-card k-card--pad k-stack"><span class="k-eyebrow" ' + biAttr('Alur demo', 'Demo flow') + '></span><ol class="k-stack" style="margin:0;padding-left:22px">' +
      STEPS.map((x) => '<li>' + span(x[0]) + (x[1] ? ' ' + x[1].split(' ').map((h) => '<span class="k-tag">' + esc(h) + '</span>').join(' ') : '') + '</li>').join('') +
      '</ol></div>' +
      '<div class="k-note">' + icon('info') + span(['Beda dengan Buat pesanan uji (UJI): pesanan uji hanya untuk latihan, tidak pernah ke Hiryu, juga tidak ke stand-in. Pesanan dummy ditandai demo.',
        'Not the same as Create a test order (UJI): a test order is for training only and never reaches Hiryu, not even the stand-in. Dummy orders are marked demo.']) + '</div>' +
      '</div>';
  }

  /* Reset stok demo: show every bin, now and after, then confirm. */
  const RS_CSS = '.dr-table td.m,.dr-table th.m{text-align:right;font-family:var(--mono);white-space:nowrap}.dr-table td.d{font-family:var(--mono);font-weight:700;text-align:right}';
  async function resetStock() {
    if (!document.getElementById('dr-css')) {
      const st = document.createElement('style');
      st.id = 'dr-css';
      st.textContent = RS_CSS;
      document.head.appendChild(st);
    }
    const siteId = S.siteId();
    const plan = await api().get('/demo/reset-stock' + api().qs({ site_id: siteId }));
    const rows = plan.rows || [];
    const changing = rows.filter((r) => r.change);
    const note = (kind, ic, text) => '<div class="k-note k-note--' + kind + '">' + icon(ic) + '<span>' + esc(S.pick(text)) + '</span></div>';
    const box = document.createElement('div');
    box.className = 'k-stack';
    box.innerHTML =
      (plan.problems || []).map((x) => note('stop', 'warn', x)).join('') +
      (plan.notes || []).map((x) => note('caution', 'info', x)).join('') +
      (!(plan.problems || []).length
        ? '<p class="k-p" style="margin:0">' + (changing.length
          ? span(['Bin di bawah ini diubah ke jumlah awalnya. Bin yang sudah sesuai tidak diubah.', 'The bins below go back to their starting number. Bins that already match are left as they are.'])
          : span(['Semua bin sudah sesuai. Tidak ada yang diubah.', 'Every bin already matches. Nothing to change.'])) + '</p>' : '') +
      '<div class="k-tablewrap"><table class="k-table dr-table"><thead><tr>' +
      '<th ' + biAttr('Produk', 'Product') + '></th><th>Bin</th><th class="m" ' + biAttr('Sekarang', 'Now') + '></th>' +
      '<th class="m" ' + biAttr('Sesudah', 'After') + '></th><th class="m" ' + biAttr('Ubah', 'Change') + '></th></tr></thead><tbody>' +
      rows.map((r) => '<tr' + (r.change ? ' class="is-selected"' : '') + '><td><div class="k-cell2"><span class="k-cell2__main">' + esc(r.sku_code) + '</span>' +
        '<span class="k-cell2__sub">' + esc(r.name || '') + '</span></div></td>' +
        '<td class="k-mono">' + esc(r.bin) + (r.role === 'primary' ? '' : ' <span class="k-tag">' + esc(t('cadangan', 'overflow')) + '</span>') + '</td>' +
        '<td class="m">' + r.now + '</td><td class="m">' + r.target + (r.seed_level ? '' : ' *') + '</td>' +
        '<td class="d">' + (r.change ? (r.change > 0 ? '+' : '') + r.change : '-') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      (rows.some((r) => !r.seed_level) ? '<span class="k-caption">' + span(['* Tidak ada di data awal: diisi 12.', '* Not in the starting data: set to 12.']) + '</span>' : '');
    const m = S.modal({
      title: ['Reset stok demo', 'Reset demo stock'], body: box, wide: true,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        { label: ['Reset stok', 'Reset stock'], kind: 'primary', minRole: 'supervisor', onClick: async () => {
          const r = await api().post('/demo/reset-stock', { site_id: siteId });
          S.toast(r.message || ['Stok demo direset.', 'Demo stock reset.'], 'ok');
        } },
      ],
    });
    const go = m.el.querySelector('.k-modal__foot .k-btn--primary');
    if (go && (!plan.can_reset || !changing.length)) go.disabled = true;
  }

  let HOOKED = false;
  S.tab('demo', async function (ctx) {
    const body = ctx.body;
    if (!HOOKED) {
      HOOKED = true;
      S.onSiteChange(() => { if (S.currentTab() === 'demo') S.rerender(); });
    }
    if (!S.siteId()) {
      body.innerHTML = '<div class="k-card k-card--pad">' + span(['Pilih satu dark store untuk Mode demo.', 'Choose one dark store for Mode demo.']) + '</div>';
      return;
    }
    let st = await api().get('/demo/settings' + api().qs({ site_id: S.siteId() }));
    let dv = await loadDelivery();
    let nb = await loadNeedsBin();
    function paint() {
      body.innerHTML = html(st, dv, nb);
      const sw = body.querySelector('[data-demo]');
      S.lockAll(body);
      if (sw && !sw.closest('.k-lockwrap')) S.toggle(sw, async (on) => {
        const r = await api().put('/demo/settings', { site_id: S.siteId(), demo_mode: on });
        st = Object.assign(st, r);
        S.toast(r.message || (on ? ['Mode demo menyala.', 'Mode demo on.'] : ['Mode demo mati.', 'Mode demo off.']), 'ok');
        dv = await loadDelivery();
        nb = await loadNeedsBin();
        paint();
      });
      const rs = body.querySelector('[data-reset]');
      if (rs) rs.addEventListener('click', () => resetStock().catch(S.fail));
      const nd = body.querySelector('[data-delivery]');
      if (nd) nd.addEventListener('click', async () => {
        nd.disabled = true;
        try {
          const r = await newDelivery(dv);
          if (r) { dv = r; paint(); return; }
        } catch (e) {
          S.fail(e);
          dv = await loadDelivery();
          paint();
          return;
        }
        nd.disabled = false;
      });
      [['[data-nb-setup]', '/demo/needs-bin', ['Contoh siap.', 'Example ready.']],
        ['[data-nb-reset]', '/demo/needs-bin/reset', ['Contoh dikembalikan.', 'Example put back.']]].forEach((x) => {
        const b = body.querySelector(x[0]);
        if (b) b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const r = await api().post(x[1], { site_id: S.siteId() });
            S.toast(r.message || x[2], 'ok');
            nb = r;
          } catch (e) {
            S.fail(e);
            nb = await loadNeedsBin();
          }
          paint();
        });
      });
      const mk = body.querySelector('[data-make]');
      if (mk) mk.addEventListener('click', async () => {
        try { const d = await loadDemoOrder(); await d.open({ siteId: S.siteId() }); }
        catch (e) { S.fail(e); }
      });
      S.applyLang(body);
    }
    paint();
  });
})();
