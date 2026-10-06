/* pengaturan-demo.js: Pengaturan, Demo (BUILD.md, Demo toggle).
 *
 * Mode demo per hub, SPV and above:
 *   GET /api/demo/settings?site_id=      {demo_mode, can_edit}
 *   PUT /api/demo/settings               {site_id, demo_mode}
 * When on, Buat pesanan dummy (js/demo-order.js) makes orders exactly like
 * Hiryu's message 1, and messages 3, 4 and 5 of this hub go to the built-in
 * Hiryu stand-in, so Pesan Hiryu shows the whole conversation.
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
    [['Tekan Buat pesanan dummy (di sini, atau di Pesanan: Papan antrean dan Ambil).', 'Press Buat pesanan dummy (here, or in Orders: Queue board and Pick).'], 'H1'],
    [['Pesanan masuk seperti pesan 1 dari Hiryu, dengan instruksi pelanggan bila ada barang yang tidak ada.', 'The order comes in like Hiryu\'s message 1, with the customer\'s instruction when an item is missing.'], 'H9'],
    [['Ambil, kemas dan serahkan seperti biasa. Pesan 3, 4 dan 5 dikirim ke stand-in Hiryu.', 'Pick, pack and hand over as usual. Messages 3, 4 and 5 go to the Hiryu stand-in.'], 'H3 H4 H5'],
    [['Lihat semuanya di Integrasi Hiryu, Pesan Hiryu: pemicu, nomor H dan JSON persis.', 'Watch it all under Hiryu integration, Hiryu messages: trigger, H number and exact JSON.'], null],
  ];

  function html(st) {
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
      '<div class="k-card k-card--pad k-stack"><span class="k-eyebrow" ' + biAttr('Alur demo', 'Demo flow') + '></span><ol class="k-stack" style="margin:0;padding-left:22px">' +
      STEPS.map((x) => '<li>' + span(x[0]) + (x[1] ? ' ' + x[1].split(' ').map((h) => '<span class="k-tag">' + esc(h) + '</span>').join(' ') : '') + '</li>').join('') +
      '</ol></div>' +
      '<div class="k-note">' + icon('info') + span(['Beda dengan Buat pesanan uji (UJI): pesanan uji hanya untuk latihan, tidak pernah ke Hiryu, juga tidak ke stand-in. Pesanan dummy ditandai demo.',
        'Not the same as Buat pesanan uji (UJI): a test order is for training only and never reaches Hiryu, not even the stand-in. Dummy orders are marked demo.']) + '</div>' +
      '</div>';
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
    function paint() {
      body.innerHTML = html(st);
      const sw = body.querySelector('[data-demo]');
      S.lockAll(body);
      if (sw && !sw.closest('.k-lockwrap')) S.toggle(sw, async (on) => {
        const r = await api().put('/demo/settings', { site_id: S.siteId(), demo_mode: on });
        st = Object.assign(st, r);
        S.toast(r.message || (on ? ['Mode demo menyala.', 'Mode demo on.'] : ['Mode demo mati.', 'Mode demo off.']), 'ok');
        paint();
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
