/* pesanan.js: orders on the floor (canvas Section 6, boards 6a to 6k).
 *
 * Tabs (pesanan.html):
 *   ambil       picker phone: Siap ambil, new order + basket scan, guided pick,
 *               Barang tidak ada with the customer's instruction, Selesai ambil,
 *               and a cancelled order's units back to the rack (6a to 6f)
 *   kemas       pack bench: baskets oldest first, then Kemas GM-xxx (6g, 6h)
 *   serah       handover table: parcels waiting for the driver, cancelled
 *               parcels, and parcels the driver brought back (6i)
 *   papan       SPV queue board: five lanes, Di shift, Pindahkan, Buat pesanan
 *               uji, Buat pesanan dummy in Mode demo (6j)
 *   kembalikan  Kembalikan ke rak: scan the unit, then the bin (6k)
 *
 * API (backend/routers/outbound.py, hiryu.py, returns.py, pickers.py):
 *   GET  /pickers/me, POST /pickers/ready|break
 *   GET  /pick-tasks/{id}, POST /pick-tasks/{id}/basket|start|complete
 *   POST /pick-lines/{id}/confirm|short, GET /pick-lines/{id}/instruction
 *   GET  /hiryu/pick-lines/{id}/elsewhere, POST /hiryu/pick-lines/{id}/move
 *   GET  /hiryu/pack-queue, GET /hiryu/orders/{id}/pack,
 *   POST /hiryu/orders/{id}/pack-start|pack-change|packed|handed-over|back-to-bench
 *   GET  /hiryu/active-orders, GET /hiryu/driver-returns, POST /hiryu/orders/{id}/driver-return
 *   GET  /pick-tasks/board, POST /pick-tasks/{id}/reassign, POST /orders/test,
 *   POST /orders/{id}/test-cancel, GET /orders
 *   GET  /returns/by-order, POST /returns/{id}/check-unit|scan
 *   GET  /demo/settings (agent L), NJW.demoOrder.open(ctx) from js/demo-order.js
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => S.api();
  const qs = (o) => api().qs(o);
  const fmt = S.fmt;

  /* ================= shared ================= */

  const CSS = `
.ps-wrap { width: 100%; max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
.ps-chip { display: inline-flex; align-items: center; font-size: 11px; font-weight: 800; letter-spacing: .04em; padding: 2px 7px; border-radius: 6px; line-height: 1.4; vertical-align: middle; }
.ps-chip--uji { background: #E3E5EA; color: #3C424D; }
.ps-chip--demo { background: #EDE7FB; color: #5B3CC4; }
.ps-gm { font-family: var(--mono); font-weight: 700; font-size: 26px; line-height: 1.1; }
.ps-gm--md { font-size: 20px; }
.ps-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; border-radius: var(--r-card); background: var(--surface); box-shadow: var(--shadow); }
.ps-head__main { flex-grow: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ps-head__sub { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; color: var(--ink-2); flex-wrap: wrap; }
.ps-head__sub b { color: var(--ink); font-family: var(--mono); }
.ps-prog { display: flex; align-items: center; gap: 12px; }
.ps-prog__bar { flex-grow: 1; display: grid; gap: 4px; }
.ps-prog__bar span { height: 8px; border-radius: 999px; background: var(--rule); }
.ps-prog__bar span.is-on { background: var(--action); }
.ps-prog__bar span.is-done { background: var(--ok); }
.ps-photo { width: 72px; height: 72px; flex-shrink: 0; border-radius: 12px; background: var(--sunk); color: var(--muted); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ps-photo img { width: 100%; height: 100%; object-fit: cover; }
.ps-photo--sm { width: 56px; height: 56px; border-radius: 10px; }
.ps-take { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 20px; font-weight: 800; }
.ps-take b { font-family: var(--mono); font-size: 44px; line-height: 1; }
.ps-rack { flex-shrink: 0; color: var(--muted); }
.ps-step { display: flex; align-items: flex-start; gap: 12px; }
.ps-step__no { width: 32px; height: 32px; flex-shrink: 0; border-radius: 999px; background: var(--action); color: #FFFFFF; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.ps-step__no--ok { background: var(--ok); }
.ps-label { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 2px solid var(--ink); border-radius: 8px; font-family: var(--mono); font-size: 22px; font-weight: 700; background: #FFFFFF; }
.ps-big { font-size: 20px; font-weight: 800; line-height: 1.25; }
.ps-ready { display: flex; align-items: center; gap: 12px; }
.ps-wait { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 16px; text-align: center; }
.ps-wait__icon { width: 72px; height: 72px; border-radius: 999px; background: var(--action-bg); color: var(--action); display: flex; align-items: center; justify-content: center; }
.ps-ret { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--rule); }
.ps-ret:first-child { border-top: 0; }
.ps-place { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-top: 1px solid var(--rule); }
.ps-place:first-child { border-top: 0; }
.ps-place__code { font-family: var(--mono); font-size: 24px; font-weight: 700; min-width: 96px; }
/* queue board */
.ps-lanes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
@media (min-width: 1024px) { .ps-lanes { grid-template-columns: repeat(5, minmax(0, 1fr)) 232px; } }
.ps-lane { background: var(--sunk); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
.ps-lane__head { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; color: var(--ink-2); padding: 2px 2px 0; }
.ps-lane__n { min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: var(--surface); font-size: 12px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.ps-lane__empty { font-size: 13px; color: var(--muted); padding: 4px 2px; }
.ps-card { background: var(--surface); border-radius: 12px; padding: 10px 12px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 3px; border: 2px solid transparent; font-size: 14px; }
.ps-card--focus { border-color: var(--action); }
.ps-card--caution { border-color: var(--caution-line); }
.ps-card--stop { border-left: 4px solid var(--stop); }
.ps-card--uji { border: 1.5px dashed var(--muted); box-shadow: none; }
.ps-card .k-pill { white-space: normal; max-width: 100%; }
.ps-card__gm { font-family: var(--mono); font-weight: 700; font-size: 17px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ps-card__sub { color: var(--ink-2); font-weight: 600; }
.ps-card__muted { color: var(--muted); font-size: 13px; }
.ps-mono { font-family: var(--mono); font-weight: 700; white-space: nowrap; }
.ps-shift { background: var(--surface); border-radius: 14px; padding: 12px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 10px; }
.ps-person { display: flex; gap: 10px; align-items: flex-start; }
.ps-avatar { width: 32px; height: 32px; flex-shrink: 0; border-radius: 999px; background: var(--staff-bg); color: var(--staff); font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.ps-opts { display: flex; flex-direction: column; gap: 6px; }
.ps-opt { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--rule); border-radius: 10px; font-weight: 600; cursor: pointer; }
.ps-opt input { width: 20px; height: 20px; accent-color: var(--action); }
.ps-opt.is-off { color: var(--muted); }
/* pack */
.ps-packgrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
@media (min-width: 1024px) { .ps-packgrid { grid-template-columns: minmax(0, 1fr) 400px; gap: 20px; } }
.ps-bench { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
@media (min-width: 1024px) { .ps-bench { grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; } }
.ps-checks { display: flex; flex-direction: column; border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; }
.ps-checks__head, .ps-checkrow { display: grid; grid-template-columns: 56px minmax(0, 1fr) 70px 36px; gap: 12px; align-items: center; padding: 10px 12px; }
.ps-checks__head { background: var(--sunk); font-size: 12px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.ps-checkrow { border-top: 1px solid var(--rule); background: var(--surface); cursor: pointer; }
.ps-checkrow input { width: 24px; height: 24px; accent-color: var(--ok); }
.ps-checkrow.is-checked { background: var(--ok-bg); }
.ps-gmbox { display: flex; align-items: stretch; border: 2px solid var(--rule-2); border-radius: 12px; overflow: hidden; background: var(--surface); }
.ps-gmbox.is-ok { border-color: var(--ok); }
.ps-gmbox.is-bad { border-color: var(--stop); }
.ps-gmbox__pre { display: flex; align-items: center; padding: 0 12px; background: var(--sunk); font-family: var(--mono); font-size: 24px; font-weight: 700; color: var(--ink-2); }
.ps-gmbox input { flex-grow: 1; min-width: 0; width: 100%; border: 0; padding: 10px 12px; font-family: var(--mono); font-size: 28px; font-weight: 700; outline: none; background: transparent; }
.ps-packname { font-size: 24px; font-weight: 800; }
.ps-packicon { width: 56px; height: 56px; flex-shrink: 0; border-radius: 12px; background: var(--action-bg); color: var(--action); display: flex; align-items: center; justify-content: center; }
.ps-basket { font-family: var(--mono); font-size: 22px; font-weight: 700; }
.ps-crumb { display: flex; gap: 8px; font-size: 14px; color: var(--muted); font-weight: 600; flex-wrap: wrap; }
.ps-crumb a { color: var(--action); }
@media (max-width: 1023.98px) { .ps-checks__head, .ps-checkrow { grid-template-columns: 48px minmax(0, 1fr) 54px 32px; gap: 8px; } }
`;
  function style() {
    if (document.getElementById('ps-style')) return;
    const st = document.createElement('style');
    st.id = 'ps-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const say = (m) => S.pick(m);
  const label = (o) => (o && (o.short_no || o.order_label || o.external_ref)) || '-';
  const chips = (o) => (o && o.is_uji ? '<span class="ps-chip ps-chip--uji">UJI</span>' : '') +
    (o && o.is_demo ? '<span class="ps-chip ps-chip--demo">DEMO</span>' : '');
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now() + Math.random().toString(16).slice(2));
  const secsSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - NJW.toDate(iso)) / 1000)) : null);
  const mins = (s) => Math.max(0, Math.round((s || 0) / 60));
  const n = (v) => fmt.n(v);
  const photo = (key, sm) => {
    const url = key && NJW.api.photoUrl ? NJW.api.photoUrl(key) : null;
    return '<span class="ps-photo' + (sm ? ' ps-photo--sm' : '') + '" role="img" ' + biAttrAria('Foto produk', 'Product photo') + '>' +
      (url ? '<img alt="" src="' + esc(url) + '" onerror="this.remove()">' : icon('box', sm ? 24 : 30)) + '</span>';
  };
  function biAttrAria(id, en) { return 'data-aria-id="' + esc(id) + '" data-aria-en="' + esc(en) + '" aria-label="' + esc(t(id, en)) + '"'; }
  const unitsWord = (k) => [k + ' unit', k + (k === 1 ? ' unit' : ' units')];
  const productsWord = (k) => [k + ' produk', k + (k === 1 ? ' product' : ' products')];
  const waitWords = (s) => {
    const m = mins(s);
    if (m < 1) return ['baru saja', 'just now'];
    return [m + ' menit', m + ' min'];
  };
  const PACK = {
    bag: ['Kantong kertas', 'Paper bag', '1 kantong kertas', '1 paper bag'],
    carton: ['Karton', 'Carton', '1 karton', '1 carton'],
    two: ['2 kemasan', 'Two packs', '1 karton dan 1 kantong kertas', '1 carton and 1 paper bag'],
  };

  function paint(el) { S.applyLang(el); S.lockAll(el); return el; }

  function resetFull() { try { S.fullScreen(false); } catch (e) { /* frame not ready */ } }

  /* The tab badges: Kemas, Serah ke driver, Kembalikan ke rak (from the board). */
  async function counts(ctx) {
    if (!ctx.siteId) return null;
    try {
      const b = await api().get('/pick-tasks/board' + qs({ site_id: ctx.siteId }));
      const c = b.tab_counts || {};
      S.tabCount('kemas', c.kemas || null);
      S.tabCount('serah', c.serah || null);
      S.tabCount('kembalikan', c.kembalikan || null, c.kembalikan ? 'caution' : null);
      return b;
    } catch (e) { return null; }
  }

  function needSite(ctx) {
    if (ctx.siteId) return false;
    ctx.body.innerHTML = '<div class="k-card k-empty">' + bis('Pilih satu dark store dulu.', 'Pick one dark store first.', 'k-empty__title') + '</div>';
    return true;
  }

  /* ---------- the ring (a new order, board 6b) ----------
     Browsers only allow sound after a tap; Siap ambil is that tap. A phone that
     stays silent still vibrates, and the screen changes anyway. */
  let AUDIO = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      AUDIO = AUDIO || new AC();
      if (AUDIO.state === 'suspended') AUDIO.resume();
    } catch (e) { /* no sound here */ }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  function ring() {
    try {
      if (!AUDIO) unlockAudio();
      if (AUDIO) {
        const t0 = AUDIO.currentTime;
        [0, 0.28, 0.56].forEach((d) => {
          const o = AUDIO.createOscillator(), g = AUDIO.createGain();
          o.type = 'sine';
          o.frequency.value = d === 0.28 ? 1175 : 880;
          g.gain.setValueAtTime(0.0001, t0 + d);
          g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
          o.connect(g); g.connect(AUDIO.destination);
          o.start(t0 + d); o.stop(t0 + d + 0.24);
        });
      }
    } catch (e) { /* silent is fine */ }
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) { /* no vibration */ }
  }

  /* ---------- Buat pesanan dummy (agent L) and Buat pesanan uji ---------- */

  function shellVersion() {
    const s = document.querySelector('script[src*="shell.js"]');
    const m = s && /[?&]v=([^&]+)/.exec(s.getAttribute('src'));
    return m ? m[1] : '';
  }
  let DEMO_LOADED = null;
  function loadDemoScript() {
    if (NJW.demoOrder) return Promise.resolve(true);
    if (DEMO_LOADED) return DEMO_LOADED;
    DEMO_LOADED = new Promise((ok) => {
      const s = document.createElement('script');
      const v = shellVersion();
      s.src = 'js/demo-order.js' + (v ? '?v=' + v : '');
      s.onload = () => ok(true);
      s.onerror = () => ok(false);
      document.head.appendChild(s);
    });
    return DEMO_LOADED;
  }
  async function demoMode(ctx) {
    if (!ctx.siteId || !S.atLeast('supervisor')) return false;
    try {
      const d = await api().get('/demo/settings' + qs({ site_id: ctx.siteId }));
      return !!(d && d.demo_mode);
    } catch (e) { return false; }
  }
  async function openDemo(ctx, refresh) {
    await loadDemoScript();
    if (NJW.demoOrder && NJW.demoOrder.open) NJW.demoOrder.open({ siteId: ctx.siteId, onDone: refresh || (() => {}) });
    else S.toast(['Dialog pesanan dummy belum tersedia.', 'The dummy order dialog is not available yet.'], 'caution');
  }
  /* Batalkan dari Hiryu on a demo order: agent L sends message 2 the way Hiryu would. */
  async function cancelDemo(externalRef, gm, refresh) {
    await loadDemoScript();
    if (NJW.demoOrder && NJW.demoOrder.cancel) NJW.demoOrder.cancel(externalRef, { gm, onDone: refresh || (() => {}) });
    else S.toast(['Dialog pesanan dummy belum tersedia.', 'The dummy order dialog is not available yet.'], 'caution');
  }
  function demoBtnHtml() {
    return '<button type="button" class="k-btn k-btn--secondary" data-ps-demo data-min-role="supervisor">' + icon('plus') +
      bis('Buat pesanan dummy', 'Create a dummy order') + '</button>';
  }
  function wireDemo(root, ctx, refresh) {
    root.querySelectorAll('[data-ps-demo]').forEach((b) => b.addEventListener('click', () => openDemo(ctx, refresh)));
  }

  async function openTestOrder(ctx, after) {
    let stores = [];
    try {
      const r = await api().get('/hiryu/stores');
      stores = (r.stores || []).filter((s) => s.site_id === ctx.siteId && s.active);
    } catch (e) { /* any store */ }
    const body = document.createElement('div');
    body.className = 'k-stack';
    body.innerHTML =
      '<p class="k-p">' + bis('Pesanan uji hanya ada di WMS, untuk latihan. Tidak dikirim ke Hiryu dan Grab, dan tidak masuk laporan.',
        'A test order exists only in the WMS, for training. It never goes to Hiryu or Grab and never counts in reports.') + '</p>' +
      '<label class="k-field"><span class="k-field__label">' + bis('Toko', 'Store') + '</span>' +
      '<select class="k-select" data-store><option value="">' + esc(t('Toko mana saja', 'Any store')) + '</option>' +
      stores.map((s) => '<option value="' + s.hiryu_store_no + '">' + esc(s.store_name) + '</option>').join('') + '</select></label>' +
      '<div class="k-field"><span class="k-field__label">' + bis('Jumlah produk', 'Number of products') + '</span>' +
      '<div class="k-segment" role="group" data-mode>' +
      '<button type="button" aria-pressed="true" data-v="acak">' + bis('Acak (3 sampai 6)', 'Random (3 to 6)') + '</button>' +
      '<button type="button" aria-pressed="false" data-v="pilih">' + bis('Pilih jumlah', 'Choose') + '</button></div>' +
      '<div data-step hidden style="margin-top:8px"></div></div>';
    const step = S.stepper(body.querySelector('[data-step]'), { value: 4, min: 1, max: 10 });
    body.querySelectorAll('[data-mode] button').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-mode] button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      body.querySelector('[data-step]').hidden = b.dataset.v !== 'pilih';
    }));
    S.modal({
      title: ['Buat pesanan uji', 'Create a test order'], body,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        {
          label: ['Buat pesanan uji', 'Create test order'], kind: 'primary', minRole: 'supervisor',
          onClick: async () => {
            const store = body.querySelector('[data-store]').value;
            const pick = body.querySelector('[data-mode] [aria-pressed="true"]').dataset.v === 'pilih';
            const r = await api().post('/orders/test', {
              site_id: ctx.siteId, hiryu_store_no: store ? +store : null, products: pick ? step.get() : null,
            });
            S.toast(r.message, 'ok');
            if (after) after();
          },
        },
      ],
    });
  }

  /* A small picture of the rack with the bin marked (board 6c). */
  function rackSvg(level, pos) {
    const levels = Math.max(4, level || 0), cols = Math.max(4, pos || 0);
    const W = 64, H = 84, cw = (W - 8) / cols, lh = (H - 8) / levels;
    let out = '<svg class="ps-rack" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>';
    for (let l = 1; l <= levels; l++) {
      for (let c = 1; c <= cols; c++) {
        const x = 4 + (c - 1) * cw, y = H - 4 - l * lh;
        const on = l === level && c === pos;
        out += '<rect x="' + (x + 1).toFixed(1) + '" y="' + (y + 1).toFixed(1) + '" width="' + (cw - 2).toFixed(1) + '" height="' + (lh - 2).toFixed(1) +
          '" rx="1.5" fill="' + (on ? 'var(--action)' : 'var(--sunk)') + '"/>';
      }
    }
    return out + '</svg>';
  }

  const instrWords = (ins) => {
    const ty = ins && (ins.type || null);
    if (ty === 'replace') return ['Ganti dengan', 'Replace with'];
    if (ty === 'remove') return ['Hapus dari pesanan', 'Remove from the order'];
    if (ty === 'cancel_order') return ['Batalkan pesanan', 'Cancel the order'];
    if (ty === 'contact_customer') return ['Hubungi pelanggan (dibatalkan)', 'Contact the customer (cancelled)'];
    return ['Tidak ada instruksi (dibatalkan)', 'No instruction (cancelled)'];
  };

  /* ======================================================================
     Tab: Ambil (phone, boards 6a to 6f)
     ====================================================================== */

  const A = { ctx: null, me: null, sig: null, hold: false, lastTask: null, sw: null, zone: null, demo: false };

  S.tab('ambil', async function (ctx) {
    style();
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    Object.assign(A, { ctx, me: null, sig: null, hold: false, sw: null });
    ctx.body.innerHTML = '<div class="ps-wrap" id="ps-ambil"><div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div></div>';
    A.demo = await demoMode(ctx);
    if (A.demo) {
      ctx.actions.innerHTML = demoBtnHtml();
      wireDemo(ctx.actions, ctx, () => pollMe(true));
      paint(ctx.actions);
    }
    counts(ctx);
    await pollMe(true);
    ctx.every(3000, () => pollMe(false));
    ctx.every(30000, () => counts(ctx));
  });

  const host = () => document.getElementById('ps-ambil');

  async function pollMe(force) {
    if (!host()) return;
    let me;
    try { me = await api().get('/pickers/me' + qs({ site_id: A.ctx.siteId })); }
    catch (e) { if (force) S.fail(e); return; }
    const prev = A.me;
    A.me = me;
    const duty = me.return_duty ? me.return_duty.order_id : null;
    const sig = JSON.stringify([me.state, me.task_id, me.basket_code, duty]);
    if (me.task_id && (!prev || prev.task_id !== me.task_id)) ring();
    if (!force && sig === A.sig) {
      if (!me.task_id && !duty) paintIdleCounts(me);
      return;
    }
    // In the middle of a missing-item step: keep the screen unless the order
    // was taken away (cancelled, moved).
    if (!force && A.hold && prev && prev.task_id === me.task_id && !duty) { A.sig = sig; return; }
    A.sig = sig;
    A.hold = false;
    if (prev && prev.task_id && !me.task_id && !duty && me.note) S.toast(me.note, 'caution');
    await renderAmbil();
  }

  async function renderAmbil() {
    const me = A.me;
    try {
      if (me.return_duty) return await renderDuty(me.return_duty);
      if (!me.task_id) return renderIdle();
      if (!me.basket_code) return renderNew();
      return await renderPick();
    } catch (e) { S.fail(e); }
  }

  function headCard(task, startIso, stopped) {
    return '<div class="ps-head"><div class="ps-head__main">' +
      '<span class="ps-gm">' + esc(label(task)) + ' ' + chips(task) + '</span>' +
      (task.basket_code ? '<span class="ps-head__sub">' + icon('basket', 18) + bis('Keranjang', 'Basket') + ' <b>' + esc(task.basket_code) + '</b></span>' : '') +
      '</div><div data-sw></div></div>';
  }
  function startWatch(root, startIso, stop) {
    const el = root.querySelector('[data-sw]');
    if (!el) return null;
    const w = S.stopwatch(el, startIso || new Date().toISOString());
    if (stop) w.stop();
    return w;
  }

  /* 6a: Siap ambil, or not. */
  function renderIdle() {
    resetFull();
    const me = A.me, h = host();
    const ready = me.state === 'ready';
    h.innerHTML =
      (me.note ? '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + esc(say(me.note)) + '</span></div>' : '') +
      '<div class="k-card k-card--pad"><div class="ps-ready">' +
        '<div class="k-grow"><div class="k-h2">' + bis('Siap ambil', 'Ready to pick') + '</div>' +
        '<div class="k-caption">' + (ready
          ? '<span ' + biAttr('Nyala sejak ' + fmt.time(me.since), 'On since ' + fmt.time(me.since)) + '></span>'
          : me.state === 'break' ? bis('Istirahat. Tidak ada pesanan yang datang.', 'On a break. No order comes to you.')
          : me.state === 'pack' ? bis('Anda tercatat di meja packing.', 'You are at the pack bench.')
          : bis('Mati. Nyalakan saat Anda siap.', 'Off. Switch on when you are ready.')) + '</div></div>' +
        '<button type="button" class="k-switch" id="ps-sw" aria-checked="' + ready + '" ' + biAttrAria('Siap ambil', 'Ready to pick') + '></button>' +
      '</div></div>' +
      (ready
        ? '<div class="k-card ps-wait"><span class="ps-wait__icon">' + icon('bell', 34) + '</span>' +
          bis('Menunggu pesanan.', 'Waiting for an order.', 'ps-big') + bis('Ponsel akan berbunyi.', 'The phone will ring.', 'ps-big') +
          bis('Saat berbunyi, mulai dalam 2 menit.', 'When it rings, start within 2 minutes.', 'k-muted') + '</div>'
        : '<div class="k-card ps-wait"><span class="ps-wait__icon">' + icon('bag', 34) + '</span>' +
          bis('Nyalakan Siap ambil. Pesanan datang sendiri ke ponsel ini.', 'Switch on Siap ambil. Orders come to this phone by themselves.', 'ps-big') + '</div>') +
      '<div class="k-card k-card--pad"><div class="k-line k-line--between"><span class="k-strong">' + bis('Hari ini', 'Today') + '</span>' +
        '<span class="ps-big" data-today></span></div>' +
        '<div class="k-caption" data-queue></div></div>' +
      '<div class="k-actionbar">' + (ready
        ? '<button type="button" class="k-btn k-btn--secondary k-btn--lg k-btn--block" data-break>' + icon('clock', 22) + bis('Istirahat', 'Take a break') + '</button>'
        : '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-ready>' + icon('arrow', 24, 2.2) + bis('Siap ambil pesanan', 'Ready to pick orders') + '</button>') +
      '</div>';
    paintIdleCounts(me);
    S.toggle(h.querySelector('#ps-sw'), (on) => setReady(on));
    const r = h.querySelector('[data-ready]'), b = h.querySelector('[data-break]');
    if (r) r.addEventListener('click', () => setReady(true));
    if (b) b.addEventListener('click', () => setReady(false));
    paint(h);
  }
  function paintIdleCounts(me) {
    const h = host();
    if (!h) return;
    const today = h.querySelector('[data-today]'), q = h.querySelector('[data-queue]');
    if (today) S.bi(today, me.today_count + ' pesanan', me.today_count + (me.today_count === 1 ? ' order' : ' orders'));
    if (q) S.bi(q, 'Antrean: ' + me.waiting_orders + ' pesanan menunggu, ' + me.ready_pickers + ' picker siap.',
      'Queue: ' + me.waiting_orders + ' waiting, ' + me.ready_pickers + ' pickers ready.');
  }
  async function setReady(on) {
    unlockAudio();
    try {
      A.me = await api().post('/pickers/' + (on ? 'ready' : 'break'), { site_id: A.ctx.siteId });
      A.sig = null;
      await pollMe(true);
    } catch (e) { S.fail(e); return false; }
    return true;
  }

  /* 6b: the order came; take an empty basket and scan its label. */
  function renderNew() {
    const me = A.me, h = host();
    S.fullScreen(true, { title: ['Pesanan baru', 'New order'], onBack: () => S.fullScreen(false) });
    // Any free basket is right. Show every free one; an older API gives one example.
    const free = Array.isArray(me.free_baskets) ? me.free_baskets
      : [me.suggested_basket || ((S.shortCode(S.site().code) || 'MA5') + '-OUT-01')];
    const freeHtml = free.length
      ? free.map((c) => '<span class="ps-label">' + icon('basket', 22) + esc(c) + '</span>').join('')
      : bis('Belum ada. Keranjang kosong lagi setelah pesanan selesai dikemas.', 'None yet. A basket is free again once its order is packed.', 'k-strong');
    h.innerHTML =
      '<div class="k-card k-card--focus k-card--pad k-stack k-stack--tight">' +
        bis('Pesanan baru untuk Anda', 'A new order for you', 'k-eyebrow') +
        '<div class="k-line k-line--between" style="align-items:flex-start"><div class="k-stack k-stack--tight">' +
          bis('Nomor pesanan', 'Order number', 'k-caption') +
          '<span class="ps-gm" style="font-size:34px">' + esc(me.order_ref || '-') + ' ' + chips(me) + '</span></div><div data-sw></div></div>' +
        '<span class="ps-big" ' + biAttr(productsWord(me.products || 0)[0] + ' · ' + unitsWord(me.units || 0)[0],
          productsWord(me.products || 0)[1] + ' · ' + unitsWord(me.units || 0)[1]) + '></span>' +
        (me.store_name ? '<span class="k-muted k-strong">' + esc(me.store_name) + '</span>' : '') +
      '</div>' +
      '<div class="k-card k-card--pad k-stack">' +
        '<div class="ps-step"><span class="ps-step__no">1</span><span class="ps-big">' + bis('Ambil keranjang kosong mana saja, pindai labelnya', 'Take any empty basket and scan its label') + '</span></div>' +
        '<div class="k-line" style="gap:12px;flex-wrap:wrap">' + bis('Yang kosong sekarang:', 'Free now:', 'k-caption') +
          freeHtml + '</div>' +
      '</div>' +
      '<div class="k-note k-note--caution">' + icon('clock', 20) + bis('Mulai dalam 2 menit. Kalau tidak, pesanan pindah ke orang lain.',
        'Start within 2 minutes, or the order goes to someone else.') + '</div>' +
      '<div data-scan></div>';
    startWatch(h, me.assigned_at);
    S.scan(async (code, z) => {
      try {
        await api().post('/pick-tasks/' + me.task_id + '/basket', { code });
        z.accept(t('Keranjang ', 'Basket ') + code.toUpperCase());
        A.sig = null;
        await pollMe(true);
      } catch (e) { z.reject(say(e.message)); }
    }, { title: ['Pindai label keranjang', 'Scan the basket label'], mount: h.querySelector('[data-scan]') });
    paint(h);
  }

  function currentLine(task) {
    return task.lines.find((l) => l.status === 'pending' && l.qty_picked < l.qty_required) || null;
  }

  /* 6c: go to the bin, take from the front, scan each unit. */
  async function renderPick() {
    const me = A.me, h = host();
    const task = await api().get('/pick-tasks/' + me.task_id);
    A.lastTask = task;
    const line = currentLine(task);
    if (!line) return renderDone(task);
    S.fullScreen(true, { title: ['Ambil pesanan', 'Pick the order'], onBack: () => S.fullScreen(false) });
    const prods = [];
    task.lines.forEach((l) => { if (l.qty_required > 0 && !prods.includes(l.order_line_id)) prods.push(l.order_line_id); });
    const idx = prods.indexOf(line.order_line_id);
    const doneLines = new Set(task.lines.filter((l) => l.qty_required > 0 && l.qty_picked >= l.qty_required).map((l) => l.order_line_id));
    h.innerHTML = headCard(task) +
      '<div class="ps-prog"><span class="k-strong" style="white-space:nowrap" ' + biAttr('Produk ' + (idx + 1) + ' dari ' + prods.length, 'Product ' + (idx + 1) + ' of ' + prods.length) + '></span>' +
        '<div class="ps-prog__bar" style="grid-template-columns:repeat(' + prods.length + ',minmax(0,1fr))">' +
        prods.map((p, i) => '<span class="' + (i === idx ? 'is-on' : doneLines.has(p) ? 'is-done' : '') + '"></span>').join('') + '</div></div>' +
      '<div class="k-target"><div class="k-target__text">' + bis('Ke bin', 'To bin', 'k-target__label') +
        '<span class="k-target__code">' + esc(line.location_short || line.location_code || '?') + '</span>' +
        (line.location_words ? '<span class="k-target__hint">' + esc(line.location_words) + '</span>' : '') +
        '</div>' + rackSvg(line.level_no, posOf(line)) + '</div>' +
      '<div class="k-card k-card--pad k-stack" id="ps-unit"></div>' +
      '<div data-scan></div>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--problem k-btn--lg k-btn--block" data-missing>' + icon('warn', 22) +
        bis('Barang tidak ada', 'Item missing') + '</button></div>';
    A.sw = startWatch(h, task.assigned_at || task.claimed_at);
    paintUnit(line);
    A.zone = S.scan((code, z) => scanUnit(task, line, code, z), {
      title: ['Pindai unit ke-' + (line.qty_picked + 1), 'Scan unit ' + (line.qty_picked + 1)], mount: h.querySelector('[data-scan]'),
    });
    h.querySelector('[data-missing]').addEventListener('click', () => renderShort(task, line));
    paint(h);
  }
  function posOf(line) {
    const m = /-(\d+)$/.exec(line.location_short || '');
    return m ? +m[1] : null;
  }
  function paintUnit(line) {
    const el = document.getElementById('ps-unit');
    if (!el) return;
    const need = line.qty_required, got = line.qty_picked;
    const dots = need <= 15 ? '<div class="k-dots">' + Array.from({ length: need }, (_, i) =>
      '<span class="k-dot' + (i < got ? ' is-done' : '') + '">' + (i < got ? icon('check', 18, 3) : '') + '</span>').join('') + '</div>' : '';
    el.innerHTML =
      '<div style="display:flex;gap:12px;align-items:center">' + photo(line.photo_key) +
        '<div class="k-stack k-stack--tight">' +
        (line.is_replacement ? '<span class="k-tag k-tag--wrap">' + esc(t('Pengganti', 'Replacement')) + (line.replaces_sku_name ? ' · ' + esc(line.replaces_sku_name) : '') + '</span>' : '') +
        '<span class="k-strong" style="font-size:17px;line-height:1.3">' + esc(line.sku_name) + '</span></div></div>' +
      '<div class="ps-take">' + bis('Ambil', 'Take') + '<b>' + need + '</b>' + bis('unit dari depan', need === 1 ? 'unit from the front' : 'units from the front') + '</div>' +
      bis('Depan: sekat paling depan, barang paling lama.', 'Front: the front divider, the oldest stock.', 'k-muted') +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' + dots +
        '<span class="k-strong" style="color:var(--ok)" ' + biAttr(got + ' dari ' + need + ' sudah dipindai', got + ' of ' + need + ' scanned') + '></span></div>';
    S.applyLang(el);
  }
  async function scanUnit(task, line, code, z) {
    let r;
    try { r = await api().post('/pick-lines/' + line.id + '/confirm', { code, qty: 1, idempotency_key: uid() }); }
    catch (e) { z.reject(say(e.message)); return; }
    if (!r.accepted) {
      z.reject(r.outcome === 'wrong_sku' ? t('Salah barang', 'Wrong item') : say(r.message));
      if (r.outcome === 'wrong_sku' && r.scanned_sku_name) wrongItem(r);
      else S.toast(r.message, 'stop');
      return;
    }
    z.accept(t('Benar', 'Right'), r.scanned_sku_name || '');
    line.qty_picked = r.qty_picked;
    if (r.line_complete || r.task_complete) {
      setTimeout(() => renderPick().catch(S.fail), 350);
    } else {
      paintUnit(line);
      z.setTitle('Pindai unit ke-' + (line.qty_picked + 1), 'Scan unit ' + (line.qty_picked + 1));
    }
  }
  function wrongItem(r) {
    S.modal({
      title: ['Salah barang', 'Wrong item'],
      body: '<div class="k-grid2">' +
        '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' + bis('Yang Anda pindai', 'You scanned', 'k-eyebrow') +
          '<span class="k-strong">' + esc(r.scanned_sku_name) + '</span></div>' +
        '<div class="k-card k-card--focus k-card--pad k-stack k-stack--tight">' + bis('Pesanan minta', 'The order wants', 'k-eyebrow') +
          '<span class="k-strong">' + esc(r.expected_sku_name || '') + '</span></div></div>' +
        '<p class="k-p" style="margin-top:12px">' + bis('Kembalikan ke bin dan ambil yang benar.', 'Put it back and take the right one.') + '</p>',
      actions: [{ label: ['Mengerti', 'Got it'], kind: 'primary' }],
    });
  }

  /* 6d, step 5: not there. How many were there, and the other places. */
  async function renderShort(task, line) {
    A.hold = true;
    const h = host();
    try { await api().post('/pick-tasks/' + task.id + '/start', {}); } catch (e) { /* already started */ }
    let places = [], ins = null;
    try { places = (await api().get('/hiryu/pick-lines/' + line.id + '/elsewhere')).places || []; } catch (e) { /* none */ }
    try { ins = await api().get('/pick-lines/' + line.id + '/instruction'); } catch (e) { ins = { type: null, effective: 'cancel_order' }; }
    const need = line.qty_required - line.qty_picked;
    const here = line.location_short || line.location_code || '?';
    S.fullScreen(true, { title: ['Barang tidak ada', 'Item missing'], onBack: () => { A.hold = false; renderPick().catch(S.fail); } });
    h.innerHTML = headCard(task) +
      '<div class="k-card k-card--pad k-stack">' +
        '<div style="display:flex;gap:12px;align-items:center">' + photo(line.photo_key, true) + '<span class="k-strong">' + esc(line.sku_name) + '</span></div>' +
        '<span class="ps-big">' + bis('Berapa yang ada di bin', 'How many are in bin') + ' <span class="ps-mono" style="white-space:nowrap">' + esc(here) + '</span>?</span>' +
        '<div class="k-line" style="gap:12px;flex-wrap:wrap"><div data-here></div><span class="k-muted" ' +
          biAttr('dari ' + need + ' yang diminta', 'of ' + need + ' wanted') + '></span></div>' +
      '</div>' +
      (places.length
        ? '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          bis('Cek juga tempat lain yang tercatat', 'Check the other places on record', 'k-eyebrow') +
          '<div>' + places.map((p, i) =>
            '<div class="ps-place"><span class="ps-place__code">' + esc(shortBin(p.location_code)) + '</span>' +
            '<span class="k-muted k-grow" ' + biAttr('tercatat ' + p.free, p.free + ' on record') + '></span>' +
            '<div data-place="' + i + '"></div>' +
            '<button type="button" class="k-btn k-btn--secondary k-btn--sm" data-move="' + p.location_id + '">' + bis('Ketemu, ambil di sini', 'Found, pick here') + '</button></div>').join('') +
          '</div></div>'
        : '') +
      '<div class="k-card k-card--pad k-stack k-stack--tight">' +
        '<div class="k-line" style="gap:8px">' + S.sysChip('Grab') + bis('Instruksi pelanggan dari Grab', "Customer's instruction from Grab", 'k-strong') + '</div>' +
        '<span class="ps-big" ' + biAttr(instrWords(ins)[0], instrWords(ins)[1]) + '></span>' +
        (ins.effective === 'replace' && ins.replace_sku_name
          ? '<span class="k-strong">' + esc(ins.replace_sku_name) + ' · ' + esc(t(unitsWord(ins.replace_units || 0)[0], unitsWord(ins.replace_units || 0)[1])) + '</span>' : '') +
        '<span class="k-muted">' + (ins.effective === 'replace'
          ? bis('Setelah dicatat, ambil penggantinya.', 'After recording, pick the replacement.')
          : ins.effective === 'remove'
            ? bis('Barang ini dihapus dari pesanan, lalu lanjut ambil yang lain.', 'This item is removed from the order, then carry on.')
            : bis('Pesanan akan dibatalkan.', 'The order will be cancelled.')) + '</span>' +
      '</div>' +
      '<div class="k-actionbar">' +
        '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-record>' + bis('Catat: tidak ada', 'Record: missing') + '</button>' +
        '<button type="button" class="k-btn k-btn--ghost k-btn--block" data-back>' + bis('Kembali ambil', 'Back to picking') + '</button></div>';
    startWatch(h, task.assigned_at || task.claimed_at);
    const hereStep = S.stepper(h.querySelector('[data-here]'), { value: 0, min: 0, max: Math.max(0, need - 1), label: ['Ditemukan', 'Found'] });
    const placeSteps = places.map((p, i) => S.stepper(h.querySelector('[data-place="' + i + '"]'), { value: 0, min: 0, max: need, label: ['Ditemukan', 'Found'] }));
    h.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api().post('/hiryu/pick-lines/' + line.id + '/move', { location_id: +b.dataset.move });
        S.toast(r.message, 'ok');
        A.hold = false;
        await renderPick();
      } catch (e) { S.fail(e); }
    }));
    h.querySelector('[data-back]').addEventListener('click', () => { A.hold = false; renderPick().catch(S.fail); });
    h.querySelector('[data-record]').addEventListener('click', async (ev) => {
      if (ins.effective === 'cancel_order') {
        const ok = await S.confirm({
          title: ['Batalkan pesanan?', 'Cancel the order?'],
          text: ['Pesanan ' + label(task) + ' akan dibatalkan dan dikirim ke Hiryu.', 'Order ' + label(task) + ' will be cancelled and Hiryu told.'],
          ok: ['Ya, batalkan', 'Yes, cancel'], danger: true,
        });
        if (!ok) return;
      }
      const btn = ev.currentTarget;
      btn.disabled = true;
      const found = { [here]: hereStep.get() };
      const checked = places.map((p, i) => { found[shortBin(p.location_code)] = placeSteps[i].get(); return { location_id: p.location_id, qty_found: placeSteps[i].get() }; });
      try {
        const r = await api().post('/pick-lines/' + line.id + '/short', { qty_found: hereStep.get(), checked });
        await afterShort(r, line, found);
      } catch (e) { S.fail(e); btn.disabled = false; }
    });
    paint(h);
  }
  const shortBin = (code) => {
    const p = String(code || '').split('-');
    return p.length >= 4 ? p.slice(1).join('-') : code;
  };

  async function afterShort(r, line, found) {
    if (r.order_cancelled) {
      A.hold = false;
      if (r.units_to_return) { A.sig = null; await pollMe(true); return; }
      return renderCancelledEmpty(r);
    }
    A.hold = true;
    const h = host(), task = r.task;
    A.lastTask = task;
    const codes = Object.keys(found);
    const allZero = codes.every((c) => !found[c]);
    const binsText = codes.map((c) => found[c] + ' di ' + c).join(' dan ');
    const binsEn = codes.map((c) => found[c] + ' at ' + c).join(' and ');
    const tail = allZero
      ? [codes.length + ' bin jadi 0, masuk hitung stok berikutnya.', codes.length + (codes.length === 1 ? ' bin is now 0' : ' bins are now 0') + ', on the next count.']
      : ['Bin dicatat sesuai yang ditemukan, masuk hitung stok berikutnya.', 'Bins set to what was found, on the next count.'];
    const ins = r.instruction || {};
    const replaced = r.action === 'replaced';
    S.fullScreen(true, { title: ['Ambil pesanan', 'Pick the order'],
      onBack: () => S.fullScreen(false) });
    h.innerHTML = headCard(task) +
      '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
        '<span>' + S.pill('stop', 'Tidak ada: ketemu ' + r.qty_found + ' dari ' + (r.qty_found + r.qty_missing), 'Missing: found ' + r.qty_found + ' of ' + (r.qty_found + r.qty_missing)) + '</span>' +
        '<span class="k-strong" style="font-size:17px">' + esc(line.sku_name) + '</span>' +
        '<span class="k-muted" ' + biAttr(binsText + '. ' + tail[0], binsEn + '. ' + tail[1]) + '></span>' +
      '</div>' +
      '<div class="k-card k-card--pad k-stack">' +
        '<div class="k-line" style="gap:8px">' + S.sysChip('Grab') + bis('Instruksi pelanggan dari Grab', "Customer's instruction from Grab", 'k-strong') + '</div>' +
        (replaced
          ? bis('Ganti dengan', 'Replace with', 'k-eyebrow') + '<span class="ps-big">' + esc(ins.replace_sku_name || '') + '</span>' +
            '<span class="k-strong" ' + biAttr(unitsWord(ins.replace_units || 0)[0], unitsWord(ins.replace_units || 0)[1]) + '></span>' +
            '<div class="k-target"><div class="k-target__text">' + bis('Ke bin', 'To bin', 'k-target__label') +
            '<span class="k-target__code k-target__code--md">' + esc(ins.replace_location_code || '?') + '</span>' +
            (ins.replace_location_words ? '<span class="k-target__hint">' + esc(ins.replace_location_words) + '</span>' : '') + '</div></div>'
          : '<span class="ps-big">' + bis('Hapus dari pesanan', 'Remove from the order') + '</span>') +
        '<div class="k-note k-note--ok">' + icon('check', 20) + bis('Perubahan dikirim otomatis ke Hiryu dan Grab', 'The change goes to Hiryu and Grab by itself') + '</div>' +
      '</div>' +
      '<div class="k-actionbar">' + (replaced
        ? '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-go>' + icon('arrow', 22, 2.2) + bis('Ambil pengganti', 'Pick the replacement') + '</button>' +
          '<button type="button" class="k-btn k-btn--problem k-btn--block" data-none>' + bis('Pengganti juga tidak ada', 'The replacement is missing too') + '</button>'
        : '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-go>' + icon('arrow', 22, 2.2) + bis('Lanjut ambil', 'Carry on picking') + '</button>') +
      '</div>';
    startWatch(h, task.assigned_at || task.claimed_at);
    h.querySelector('[data-go]').addEventListener('click', () => { A.hold = false; renderPick().catch(S.fail); });
    const none = h.querySelector('[data-none]');
    if (none) none.addEventListener('click', async () => {
      const rep = task.lines.find((l) => l.is_replacement && l.status === 'pending');
      if (!rep) { A.hold = false; return renderPick().catch(S.fail); }
      const ok = await S.confirm({
        title: ['Pengganti juga tidak ada?', 'The replacement is missing too?'],
        text: ['Pesanan ' + label(task) + ' dibatalkan dan dikirim ke Hiryu.', 'Order ' + label(task) + ' is cancelled and Hiryu told.'],
        ok: ['Ya, batalkan pesanan', 'Yes, cancel the order'], danger: true,
      });
      if (!ok) return;
      try {
        const r2 = await api().post('/pick-lines/' + rep.id + '/short', { qty_found: 0, checked: [] });
        await afterShort(r2, rep, {});
      } catch (e) { S.fail(e); }
    });
    paint(h);
  }

  function renderCancelledEmpty(r) {
    const h = host();
    S.fullScreen(true, { title: ['Pesanan dibatalkan', 'Order cancelled'], onBack: () => S.fullScreen(false) });
    h.innerHTML = '<div class="k-card k-card--stop k-card--pad k-stack">' + '<span>' + S.pill('stop', 'Dibatalkan', 'Cancelled') + '</span>' +
      '<span class="ps-big">' + esc(say(r.message)) + '</span>' +
      bis('Jangan dikemas. Hiryu sudah diberi tahu.', 'Do not pack it. Hiryu has been told.', 'k-muted') + '</div>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-ok>' + bis('Mengerti', 'Got it') + '</button></div>';
    h.querySelector('[data-ok]').addEventListener('click', () => { A.sig = null; pollMe(true); });
    paint(h);
  }

  /* 6e: cancelled with units in the basket. Put them back before the next order. */
  async function renderDuty(duty) {
    const h = host();
    S.fullScreen(true, { title: ['Ambil pesanan', 'Pick the order'], onBack: () => S.fullScreen(false) });
    let group = null;
    try {
      const g = await api().get('/returns/by-order' + qs({ site_id: A.ctx.siteId }));
      group = (g.groups || []).find((x) => x.order_id === duty.order_id) || null;
    } catch (e) { /* show what we know */ }
    const left = group ? group.units - group.units_returned : duty.units_left;
    const reason = duty.cancel_reason || t('Dibatalkan dari Hiryu', 'Cancelled from Hiryu');
    h.innerHTML =
      '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
        '<span>' + S.pill('stop', 'Dibatalkan', 'Cancelled') + '</span>' +
        '<span class="ps-big" ' + biAttr('Pesanan ' + duty.order_label + ' dibatalkan', 'Order ' + duty.order_label + ' cancelled') + '></span>' +
        '<span class="k-strong">' + esc(t('Alasan: ', 'Reason: ')) + esc(reason) + '</span>' +
        bis('Jangan dikemas. Hiryu sudah diberi tahu.', 'Do not pack it. Hiryu has been told.', 'k-muted') +
      '</div>' +
      '<div class="k-card k-card--pad k-stack k-stack--tight">' +
        '<span class="k-h2" ' + biAttr('Kembalikan ke rak: ' + left + ' unit', 'Put back to the rack: ' + left + (left === 1 ? ' unit' : ' units')) + '></span>' +
        '<div>' + (group ? group.tasks.filter((x) => x.qty > x.qty_returned).map((x) =>
          '<div class="ps-ret"><div class="k-grow k-stack k-stack--tight"><span class="k-strong">' + esc(x.sku_name) + '</span>' +
          '<span class="k-muted" ' + biAttr(unitsWord(x.qty - x.qty_returned)[0], unitsWord(x.qty - x.qty_returned)[1]) + '></span></div>' +
          '<div class="k-stack k-stack--tight" style="align-items:flex-end">' + bis('Ke bin', 'To bin', 'k-caption') +
          '<span class="ps-mono" style="font-size:20px">' + esc(x.location_short || '?') + '</span></div></div>').join('') : '') + '</div>' +
      '</div>' +
      (duty.basket_code ? '<div class="k-note k-note--info">' + icon('basket', 20) + '<span ' + biAttr('Barang ada di keranjang ' + duty.basket_code, 'The units are in basket ' + duty.basket_code) + '></span></div>' : '') +
      bis('Setelah semua kembali, pesanan berikutnya datang sendiri.', 'Once everything is back, the next order comes by itself.', 'k-muted') +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-go>' + icon('undo', 22, 2.2) +
        bis('Kembalikan sekarang', 'Put back now') + '</button></div>';
    h.querySelector('[data-go]').addEventListener('click', () => goReturn(duty.order_id));
    paint(h);
  }
  function goReturn(orderId) {
    const u = new URL(location.href);
    u.searchParams.set('order', orderId);
    u.searchParams.delete('pack');
    history.replaceState(null, '', u.pathname + u.search);
    S.setTab('kembalikan');
  }

  /* 6f: all picked. Take the basket to the pack bench. */
  function renderDone(task) {
    const h = host();
    S.fullScreen(true, { title: ['Selesai ambil', 'Picking done'], onBack: () => S.fullScreen(false) });
    const sm = task.summary || {};
    const rep = (sm.replaced || []).map((x) => x.to_sku_name);
    const repId = rep.length ? ' · ' + rep.length + ' diganti: ' + rep.join(', ') : '';
    const repEn = rep.length ? ' · ' + rep.length + ' replaced: ' + rep.join(', ') : '';
    h.innerHTML =
      '<div class="k-card k-card--pad k-stack" style="border:2px solid var(--ok)">' +
        '<div class="k-line k-line--between"><span class="ps-gm">' + esc(label(task)) + ' ' + chips(task) + '</span>' + S.pill('ok', 'Lengkap', 'Complete') + '</div>' +
        '<span class="ps-big" ' + biAttr(unitsWord(sm.units_picked || 0)[0] + ' · keranjang ' + (task.basket_code || ''), unitsWord(sm.units_picked || 0)[1] + ' · basket ' + (task.basket_code || '')) + '></span>' +
        '<span class="k-muted k-strong" ' + biAttr(productsWord(sm.products || 0)[0] + repId, productsWord(sm.products || 0)[1] + repEn) + '></span>' +
        ((sm.removed || []).length ? '<span class="k-muted" ' + biAttr('Dihapus: ' + sm.removed.join(', '), 'Removed: ' + sm.removed.join(', ')) + '></span>' : '') +
        '<div class="k-line k-line--between"><span class="k-strong">' + bis('Waktu kerja, berhenti', 'Work time, stopped') + '</span><div data-sw></div></div>' +
      '</div>' +
      '<div class="k-card k-card--pad k-stack k-stack--tight"><span class="ps-big" ' +
        biAttr('Taruh keranjang ' + (task.basket_code || '') + ' di meja packing, lalu tekan tombol di bawah.', 'Put basket ' + (task.basket_code || '') + ' on the pack bench, then press the button below.') + '></span>' +
        bis('Pesanan berikutnya datang sendiri.', 'The next order comes by itself.', 'k-muted') + '</div>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-hand>' + icon('arrow', 22, 2.2) +
        bis('Serahkan ke meja packing', 'Hand to the pack bench') + '</button></div>';
    const el = h.querySelector('[data-sw]');
    const w = S.stopwatch(el, task.assigned_at || task.claimed_at, { label: false });
    w.stop();
    h.querySelector('[data-hand]').addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await api().post('/pick-tasks/' + task.id + '/complete', {});
        S.toast(['Keranjang ' + (task.basket_code || '') + ' ada di daftar Kemas.', 'Basket ' + (task.basket_code || '') + ' is on the Pack list.'], 'ok');
        A.sig = null;
        resetFull();
        await pollMe(true);
      } catch (e) { S.fail(e); ev.currentTarget.disabled = false; }
    });
    paint(h);
  }

  /* ======================================================================
     Tab: Kemas (laptop at the pack bench, boards 6g and 6h)
     ====================================================================== */

  S.tab('kemas', async function (ctx) {
    style();
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    const id = ctx.params.get('pack');
    if (id) return packDetail(ctx, +id);
    S.setSub('Keranjang dari picker menunggu di meja packing. Ambil yang paling atas: paling lama menunggu.',
      'Baskets from the pickers wait at the pack bench. Take the top one: it has waited longest.');
    ctx.body.innerHTML = '<div class="ps-bench"><div id="ps-kemas" class="k-stack"><div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div></div>' +
      '<div id="ps-kemas-side" class="k-stack"></div></div>';
    async function load() {
      let q, act;
      try {
        [q, act] = await Promise.all([
          api().get('/hiryu/pack-queue' + qs({ site_id: ctx.siteId })),
          api().get('/hiryu/active-orders' + qs({ site_id: ctx.siteId })),
        ]);
      } catch (e) { S.fail(e); return; }
      const list = document.getElementById('ps-kemas'), side = document.getElementById('ps-kemas-side');
      if (!list) return;
      S.tabCount('kemas', q.baskets.length || null);
      S.tabCount('serah', q.to_driver_count || null);
      const back = (act.orders || []).filter((o) => o.stage === 'cancelled' && !o.marked_ready_at);
      list.innerHTML =
        back.map((o) => '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
          '<div class="k-line k-line--between"><span class="ps-gm ps-gm--md">' + esc(o.short_no) + ' ' + chips(o) + '</span>' + S.pill('stop', 'Dibatalkan', 'Cancelled') + '</div>' +
          '<span class="k-strong" ' + biAttr('Jangan dikemas. Keranjang ' + (o.basket_code || '') + ': kembalikan barangnya ke rak.', 'Do not pack it. Basket ' + (o.basket_code || '') + ': put the units back on the rack.') + '></span>' +
          '<div class="k-line" style="gap:8px;flex-wrap:wrap"><a class="k-btn k-btn--secondary k-btn--sm" href="pesanan.html?tab=kembalikan&order=' + o.order_id + '">' + icon('undo') + bis('Kembalikan ke rak', 'Put back to rack') + '</a>' +
          '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-bench="' + o.order_id + '">' + bis('Sudah dibawa kembali ke meja packing', 'Back at the pack bench') + '</button></div></div>').join('') +
        (q.baskets.length
          ? bis('Paling lama di atas', 'Oldest on top', 'k-eyebrow') + q.baskets.map((b, i) =>
            '<div class="k-card k-card--pad ' + (b.amber ? 'k-card--caution' : i === 0 ? 'k-card--focus' : '') + '">' +
            '<div class="k-line" style="gap:16px;flex-wrap:wrap"><div class="k-grow k-stack k-stack--tight">' +
              '<span class="ps-basket">' + icon('basket', 22) + ' ' + esc(b.basket_code || '-') + '</span>' +
              '<span class="k-line" style="gap:10px;flex-wrap:wrap"><span class="ps-gm ps-gm--md">' + esc(b.short_no) + ' ' + chips(b) + '</span>' +
              (b.amber ? S.pill('caution', 'Menunggu ' + waitWords(b.waiting_seconds)[0], 'Waiting ' + waitWords(b.waiting_seconds)[1])
                : '<span class="k-muted k-strong" ' + biAttr('Menunggu ' + waitWords(b.waiting_seconds)[0], 'Waiting ' + waitWords(b.waiting_seconds)[1]) + '></span>') + '</span>' +
              '<span class="k-muted" ' + biAttr([b.store_name, productsWord(b.products)[0], unitsWord(b.units)[0]].filter(Boolean).join(' · '),
                [b.store_name, productsWord(b.products)[1], unitsWord(b.units)[1]].filter(Boolean).join(' · ')) + '></span></div>' +
            '<a class="k-btn ' + (i === 0 ? 'k-btn--primary' : 'k-btn--secondary') + '" href="pesanan.html?tab=kemas&pack=' + b.order_id + '">' + icon('box') + bis('Kemas', 'Pack') + '</a>' +
            '</div></div>').join('')
          : '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
            bis('Tidak ada keranjang menunggu', 'No basket is waiting', 'k-empty__title') +
            bis('Keranjang muncul di sini saat picker menekan Serahkan ke meja packing.', 'Baskets appear here when a picker taps Hand to the pack bench.', 'k-empty__text') + '</div>');
      list.querySelectorAll('[data-bench]').forEach((b) => b.addEventListener('click', async () => {
        try { await api().post('/hiryu/orders/' + b.dataset.bench + '/back-to-bench', {}); load(); } catch (e) { S.fail(e); }
      }));
      side.innerHTML =
        '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Urutan kerja', 'How to work', 'k-h2') +
          [['Ambil keranjang paling atas.', 'Take the top basket.'],
            ['Kemas dengan kemasan dari WMS, masukkan slip Hiryu.', 'Pack in the pack the WMS names, put the Hiryu slip in.'],
            ['Bawa paket ke rak siap ambil di bawah.', 'Take the parcel to the ready shelf downstairs.']].map((s, i) =>
            '<div class="ps-step"><span class="ps-step__no">' + (i + 1) + '</span><span>' + bis(s[0], s[1]) + '</span></div>').join('') +
        '</div>' +
        '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Bahan kemas di meja', 'Packing supplies at the bench', 'k-h2') +
          ((q.bench_stock || []).length ? (q.bench_stock || []).map((x) => '<div class="k-line k-line--between"><span>' + esc(x.name) + '</span><span class="ps-mono">' + n(x.qty) + '</span></div>').join('')
            : bis('Belum ada data bahan kemas.', 'No supplies data yet.', 'k-muted')) +
          bis('Berkurang sendiri setiap pesanan selesai dikemas.', 'Goes down by itself with every order packed.', 'k-caption') +
        '</div>';
      paint(list); paint(side);
    }
    await load();
    ctx.every(10000, load);
    ctx.every(30000, () => counts(ctx));
  });

  const gmKey = (v) => {
    let s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const p of ['GM', 'UJI']) if (s.startsWith(p)) { s = s.slice(p.length); break; }
    return s.replace(/^0+/, '') || s;
  };

  async function packDetail(ctx, orderId) {
    ctx.body.innerHTML = '<div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div>';
    let d;
    try { d = await api().post('/hiryu/orders/' + orderId + '/pack-start', {}); }
    catch (e) {
      if (e.status === 409) { try { d = await api().get('/hiryu/orders/' + orderId + '/pack'); } catch (e2) { S.fail(e2); return; } }
      else { S.fail(e); return; }
    }
    const checked = new Set();
    const toList = () => {
      const u = new URL(location.href);
      u.searchParams.delete('pack');
      history.replaceState(null, '', u.pathname + u.search);
      S.rerender();
    };
    function draw() {
      S.setTitle('Kemas ' + d.short_no, 'Pack ' + d.short_no);
      S.setSub([d.store_name, productsWord(d.products)[0], unitsWord(d.units)[0], 'dari keranjang ' + (d.basket_code || '-')].filter(Boolean).join(' · '),
        [d.store_name, productsWord(d.products)[1], unitsWord(d.units)[1], 'from basket ' + (d.basket_code || '-')].filter(Boolean).join(' · '));
      const sug = d.suggestion, chosen = d.chosen, changed = chosen !== sug.pack_type;
      const pre = /^UJI/i.test(d.short_no) ? 'UJI-' : 'GM-';
      const cancelled = d.status === 'cancelled';
      const packedAlready = !!d.packed_at;
      const consumable = PACK[chosen] || PACK.bag;
      ctx.body.innerHTML =
        '<div class="ps-crumb"><a href="pesanan.html?tab=kemas" data-list>' + bis('Pesanan', 'Orders') + '</a><span>/</span>' +
          '<a href="pesanan.html?tab=kemas" data-list>' + bis('Kemas', 'Pack') + '</a><span>/</span><span>' + esc(d.short_no) + '</span></div>' +
        '<div class="k-line k-line--between k-phone-only"><span class="ps-gm">' + esc(d.short_no) + ' ' + chips(d) + '</span><div data-sw></div></div>' +
        (chips(d) ? '<div class="k-laptop-only">' + chips(d) + '</div>' : '') +
        (cancelled ? '<div class="k-note k-note--stop">' + icon('warn', 20) + bis('Pesanan ini dibatalkan: jangan dikemas. Kembalikan barangnya ke rak.', 'This order was cancelled: do not pack it. Put the units back on the rack.') + '</div>' : '') +
        '<div class="ps-packgrid">' +
        '<div class="k-card k-card--pad k-stack">' +
          '<div class="k-line k-line--between" style="align-items:flex-start;gap:12px"><div class="k-stack k-stack--tight">' +
            bis('Periksa barang', 'Check the items', 'k-h2') + bis('Cocokkan isi keranjang dengan daftar. Centang tiap baris.', 'Match the basket with the list. Tick each line.', 'k-muted') + '</div>' +
            '<span data-count></span></div>' +
          '<div class="k-note k-note--ok">' + icon('check', 20) + '<span ' + biAttr(
            'Cocok dengan pesanan Hiryu: ' + productsWord(d.products)[0] + ', ' + unitsWord(d.units)[0] + (d.replaced ? ' (' + d.replaced + ' diganti)' : '') + ', semua dipindai saat diambil',
            'Matches the Hiryu order: ' + productsWord(d.products)[1] + ', ' + unitsWord(d.units)[1] + (d.replaced ? ' (' + d.replaced + ' replaced)' : '') + ', all scanned at picking') + '></span></div>' +
          '<div class="ps-checks"><div class="ps-checks__head"><span>' + esc(t('Foto', 'Photo')) + '</span><span>' + esc(t('Produk', 'Product')) + '</span><span>' + esc(t('Jumlah', 'Qty')) + '</span><span>Ok</span></div>' +
          d.lines.map((l, i) => {
            const kg = (l.unit_weight_g / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
            const kgEn = (l.unit_weight_g / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 });
            return '<label class="ps-checkrow" data-row="' + i + '">' + photo(l.photo_key, true) +
              '<span class="k-stack k-stack--tight"><span class="k-strong">' + esc(l.sku_name) + '</span>' +
              '<span class="k-caption" ' + biAttr((l.large_bottle ? 'Botol besar · ' : '') + kg + ' kg per unit' + (l.estimated ? ' (perkiraan)' : ''),
                (l.large_bottle ? 'Large bottle · ' : '') + kgEn + ' kg per unit' + (l.estimated ? ' (estimate)' : '')) + '></span>' +
              (l.is_replacement ? '<span class="k-tag k-tag--wrap" ' + biAttr('Pengganti ' + (l.replaces_sku_name || '') + (l.replaces_units ? ' · ' + l.replaces_units : ''),
                'Replaces ' + (l.replaces_sku_name || '') + (l.replaces_units ? ' · ' + l.replaces_units : '')) + '></span>' : '') + '</span>' +
              '<span class="k-strong"><span class="ps-mono" style="font-size:20px">' + l.units + '</span> unit</span>' +
              '<input type="checkbox" ' + biAttrAria(l.sku_name + ' cocok', l.sku_name + ' matches') + '></label>';
          }).join('') + '</div>' +
          bis('Data pelanggan tidak masuk ke WMS.', 'Customer data never reaches the WMS.', 'k-caption') +
        '</div>' +
        '<div class="k-stack">' +
          '<div class="k-card k-card--pad k-stack">' +
            '<div class="k-line" style="gap:14px"><span class="ps-packicon">' + icon(chosen === 'bag' ? 'bag' : 'box', 30) + '</span>' +
              '<span class="k-grow k-stack k-stack--tight">' + bis('Kemasan', 'Pack', 'k-caption') +
              '<span class="ps-packname" ' + biAttr(PACK[chosen][0], PACK[chosen][1]) + '></span></span>' +
              (changed ? S.pill('caution', 'Diganti', 'Changed') : S.pill('info', 'Dipilih WMS', 'Chosen by the WMS')) + '</div>' +
            '<div class="k-note">' + '<span ' + biAttr(sug.reason + (sug.estimated ? ' (perkiraan)' : ''), sug.reason_en + (sug.estimated ? ' (estimate)' : '')) + '></span></div>' +
            (changed ? '<div class="k-caption" ' + biAttr('WMS memilih ' + PACK[sug.pack_type][0] + '. Alasan ganti: ' + (d.change_reason || '-'),
              'The WMS chose ' + PACK[sug.pack_type][1] + '. Reason: ' + (d.change_reason || '-')) + '></div>' : '') +
            (sug.split && chosen === 'two' ? '<div class="k-caption">' + splitText(sug.split, d.lines) + '</div>' : '') +
            '<button type="button" class="k-btn k-btn--secondary k-btn--sm" data-change style="align-self:flex-start">' + icon('edit') + bis('Ganti kemasan', 'Change the pack') + '</button>' +
          '</div>' +
          '<div class="k-note k-note--info">' + icon('info', 20) + bis('Masukkan slip Hiryu, nomor GM terlihat.', 'Put the Hiryu slip in with the GM number showing.') + '</div>' +
          '<div class="k-card k-card--focus k-card--pad k-stack">' +
            '<label class="k-stack k-stack--tight" for="ps-gm-in"><span class="k-h2">' + bis('Ketik nomor GM', 'Type the GM number') + '</span>' +
              bis('Lihat nomor di slip Hiryu.', 'Read it off the Hiryu slip.', 'k-muted') + '</label>' +
            '<div class="ps-gmbox" data-gmbox><span class="ps-gmbox__pre">' + pre + '</span>' +
              '<input id="ps-gm-in" inputmode="numeric" autocomplete="off" spellcheck="false"></div>' +
            '<span class="k-strong" data-match></span>' +
            '<span class="k-caption" ' + biAttr('WMS mencocokkan nomor GM dengan keranjang ' + (d.basket_code || ''), 'The WMS checks the GM number against basket ' + (d.basket_code || '')) + '></span>' +
          '</div>' +
          '<div class="k-actionbar" style="flex-direction:column;align-items:stretch">' +
            '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-done>' + icon('check', 22, 2.4) + bis('Selesai dikemas', 'Packed') + '</button>' +
            '<span class="k-caption" ' + (d.is_uji
              ? biAttr('Pesanan uji: tidak dikirim ke Hiryu. ' + consumable[2] + ' keluar dari stok bahan kemas.', 'Test order: nothing goes to Hiryu. ' + consumable[3] + ' comes off the supplies stock.')
              : biAttr('Setelah ini Hiryu menandai pesanan siap di Grab, dan ' + consumable[2] + ' keluar dari stok bahan kemas.',
                'Then Hiryu marks the order ready on Grab, and ' + consumable[3] + ' comes off the supplies stock.')) + '></span>' +
          '</div>' +
        '</div></div>';
      ctx.actions.innerHTML = '<div data-sw class="k-laptop-only"></div>';
      [ctx.body.querySelector('[data-sw]'), ctx.actions.querySelector('[data-sw]')].forEach((el) => {
        if (!el) return;
        const w = S.stopwatch(el, d.pack_started_at);
        if (packedAlready) w.stop();
      });
      const rows = ctx.body.querySelectorAll('[data-row]');
      const input = ctx.body.querySelector('#ps-gm-in'), box = ctx.body.querySelector('[data-gmbox]');
      const match = ctx.body.querySelector('[data-match]'), done = ctx.body.querySelector('[data-done]');
      const countEl = ctx.body.querySelector('[data-count]');
      function update() {
        rows.forEach((r, i) => { const c = r.querySelector('input').checked; r.classList.toggle('is-checked', c); if (c) checked.add(i); else checked.delete(i); });
        const all = checked.size === d.lines.length;
        countEl.innerHTML = S.pill(all ? 'ok' : 'info', checked.size + ' dari ' + d.lines.length + ' cocok', checked.size + ' of ' + d.lines.length + ' match');
        const v = input.value.trim();
        const ok = v && gmKey(v) === gmKey(d.short_no);
        box.classList.toggle('is-ok', !!ok);
        box.classList.toggle('is-bad', !!v && !ok);
        if (!v) match.innerHTML = '';
        else match.innerHTML = ok ? '<span style="color:var(--ok)">' + icon('check', 18, 2.6) + ' ' + bis('Cocok dengan pesanan ini', 'Matches this order') + '</span>'
          : '<span style="color:var(--stop)">' + icon('warn', 18) + ' ' + bis('Nomor tidak sama. Cek slipnya.', 'The number does not match. Check the slip.') + '</span>';
        done.disabled = cancelled || packedAlready || !all || !ok;
      }
      rows.forEach((r) => r.querySelector('input').addEventListener('change', update));
      input.addEventListener('input', update);
      update();
      ctx.body.querySelectorAll('[data-list]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); toList(); }));
      ctx.body.querySelector('[data-change]').addEventListener('click', () => changePack(d, (nd) => { d = nd; draw(); }));
      done.addEventListener('click', async () => {
        done.disabled = true;
        try {
          await api().post('/hiryu/orders/' + d.order_id + '/packed', { gm_number: pre + input.value.trim().replace(/^(GM|UJI)-?/i, ''), basket_code: d.basket_code });
          S.toast([d.short_no + ' selesai dikemas. Bawa paket ke rak siap ambil di bawah.', d.short_no + ' packed. Take the parcel to the ready shelf downstairs.'], 'ok');
          toList();
        } catch (e) { S.fail(e); update(); }
      });
      paint(ctx.body);
      if (!cancelled) input.focus();
    }
    draw();
  }
  function splitText(split, lines) {
    const name = (id) => { const l = lines.find((x) => x.sku_id === id); return l ? l.sku_name : '#' + id; };
    const part = (arr) => arr.map((x) => x.units + ' × ' + name(x.sku_id)).join(', ');
    return '<span ' + biAttr('Karton: ' + part(split.carton) + '. Kantong: ' + part(split.bag) + '.', 'Carton: ' + part(split.carton) + '. Bag: ' + part(split.bag) + '.') + '></span>';
  }
  function changePack(d, after) {
    const body = document.createElement('div');
    body.className = 'k-stack';
    body.innerHTML =
      '<div class="ps-opts">' + ['bag', 'carton', 'two'].map((k) =>
        '<label class="ps-opt"><input type="radio" name="ps-pack" value="' + k + '"' + (d.chosen === k ? ' checked' : '') + '>' +
        '<span class="k-grow">' + bis(PACK[k][0], PACK[k][1]) + '</span>' + (d.suggestion.pack_type === k ? S.pill('info', 'Dipilih WMS', 'WMS choice') : '') + '</label>').join('') + '</div>' +
      '<label class="k-field"><span class="k-field__label">' + bis('Alasan', 'Reason') + '</span><select class="k-select" data-reason>' +
        (d.change_reasons || []).map((r) => '<option>' + esc(r) + '</option>').join('') + '</select></label>' +
      '<label class="k-field" data-otherwrap hidden><span class="k-field__label">' + bis('Tulis alasannya', 'Write the reason') + '</span><input class="k-input" data-other maxlength="200"></label>';
    const sel = body.querySelector('[data-reason]');
    sel.addEventListener('change', () => { body.querySelector('[data-otherwrap]').hidden = sel.value !== 'Lainnya'; });
    S.modal({
      title: ['Ganti kemasan', 'Change the pack'], body,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        {
          label: ['Simpan', 'Save'], kind: 'primary',
          onClick: async () => {
            const k = body.querySelector('input[name="ps-pack"]:checked').value;
            let reason = sel.value;
            if (reason === 'Lainnya') reason = (body.querySelector('[data-other]').value || '').trim();
            if (reason.length < 3) { S.toast(['Tulis alasannya.', 'Write the reason.'], 'caution'); return false; }
            const nd = await api().post('/hiryu/orders/' + d.order_id + '/pack-change', { pack_type: k, reason });
            after(nd);
          },
        },
      ],
    });
  }

  /* ======================================================================
     Tab: Serah ke driver (board 6i)
     ====================================================================== */

  S.tab('serah', async function (ctx) {
    style();
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    S.setSub('Tanya nomor pesanan ke driver, cocokkan nomor GM.', "Ask the driver for the order number and match the GM number.");
    ctx.body.innerHTML = '<div class="ps-wrap" style="max-width:880px">' +
      '<label class="k-search"><span class="k-sr">GM</span>' + icon('search', 20) + '<input class="k-input" data-find inputmode="numeric" ' +
        'data-ph-id="Cari nomor GM" data-ph-en="Find the GM number" placeholder="' + esc(t('Cari nomor GM', 'Find the GM number')) + '"></label>' +
      '<div id="ps-serah" class="k-stack"><div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div></div>' +
      '<div id="ps-drv" class="k-stack"></div></div>';
    let last = null;
    const find = ctx.body.querySelector('[data-find]');
    find.addEventListener('input', () => draw());
    async function load() {
      try {
        const [a, dr] = await Promise.all([
          api().get('/hiryu/active-orders' + qs({ site_id: ctx.siteId })),
          api().get('/hiryu/driver-returns' + qs({ site_id: ctx.siteId })).catch(() => ({ orders: [] })),
        ]);
        last = { a, dr };
        draw();
      } catch (e) { S.fail(e); }
    }
    function draw() {
      const el = document.getElementById('ps-serah'), drv = document.getElementById('ps-drv');
      if (!el || !last) return;
      const limitMin = Math.round(last.a.wait_limit_seconds / 60);
      const f = gmKey(find.value);
      const match = (o) => !f || gmKey(o.short_no).includes(f);
      const ready = last.a.orders.filter((o) => o.stage === 'to_driver').filter(match);
      const red = last.a.orders.filter((o) => o.stage === 'cancelled' && o.marked_ready_at).filter(match);
      S.tabCount('serah', last.a.orders.filter((o) => o.stage === 'to_driver').length || null);
      el.innerHTML =
        red.map((o) => '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
          '<div class="k-line k-line--between"><span class="ps-gm">' + esc(o.short_no) + ' ' + chips(o) + '</span>' + S.pill('stop', 'Dibatalkan', 'Cancelled') + '</div>' +
          bis('Jangan diserahkan. Bawa kembali ke meja packing di atas.', 'Do not hand it over. Take it back upstairs to the pack bench.', 'k-strong') +
          '<button type="button" class="k-btn k-btn--secondary k-btn--block" data-bench="' + o.order_id + '">' + icon('undo') + bis('Sudah dibawa kembali ke meja packing', 'Taken back to the pack bench') + '</button></div>').join('') +
        ready.map((o) => {
          const long = o.over_limit;
          const w = waitWords(o.waiting_seconds);
          const pack = o.pack_type ? (o.pack_type === 'two' ? ['2 kemasan', 'two packs'] : [PACK[o.pack_type][2], PACK[o.pack_type][3]]) : null;
          return '<div class="k-card k-card--pad k-stack k-stack--tight' + (long ? ' k-card--caution' : '') + '">' +
            '<div class="k-line k-line--between" style="gap:10px;flex-wrap:wrap"><span class="ps-gm" style="font-size:30px">' + esc(o.short_no) + ' ' + chips(o) + '</span>' +
            (long ? S.pill('caution', 'Lama · ' + w[0], 'Long · ' + w[1]) : S.pill('info', 'Menunggu ' + w[0], 'Waiting ' + w[1])) + '</div>' +
            '<span class="k-muted k-strong" ' + biAttr([pack ? pack[0] : null, o.store_name].filter(Boolean).join(' · '), [pack ? pack[1] : null, o.store_name].filter(Boolean).join(' · ')) + '></span>' +
            '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-hand="' + o.order_id + '" data-gm="' + esc(o.short_no) + '">' + icon('check', 22, 2.4) +
              bis('Sudah diambil driver', 'Collected by the driver') + '</button></div>';
        }).join('') +
        (!ready.length ? '<div class="k-card k-empty"><span class="k-empty__icon k-empty__icon--muted">' + icon('bag', 28) + '</span>' +
          (f ? bis('Tidak ada paket dengan nomor itu.', 'No parcel with that number.', 'k-empty__title')
            : bis('Tidak ada paket lain di rak siap ambil.', 'No other parcel on the ready shelf.', 'k-empty__title')) + '</div>' : '') +
        '<span class="k-caption" ' + biAttr('Kuning: paket menunggu lebih dari ' + limitMin + ' menit.', 'Amber: a parcel waiting more than ' + limitMin + ' minutes.') + '></span>';
      el.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', async () => {
        const gm = b.dataset.gm;
        const ok = await S.confirm({
          title: ['Sudah diambil driver?', 'Collected by the driver?'],
          text: ['Driver menyebut ' + gm + ' dan nomornya sama dengan slip.', 'The driver said ' + gm + ' and it matches the slip.'],
          ok: ['Ya, sudah diambil driver', 'Yes, the driver has it'],
        });
        if (!ok) return;
        try { await api().post('/hiryu/orders/' + b.dataset.hand + '/handed-over', {}); S.toast([gm + ' diserahkan ke driver.', gm + ' handed to the driver.'], 'ok'); load(); }
        catch (e) { S.fail(e); }
      }));
      el.querySelectorAll('[data-bench]').forEach((b) => b.addEventListener('click', async () => {
        try { await api().post('/hiryu/orders/' + b.dataset.bench + '/back-to-bench', {}); load(); } catch (e) { S.fail(e); }
      }));
      const dro = last.dr.orders || [];
      drv.innerHTML = dro.length ? bis('Paket batal yang dibawa kembali driver', 'Cancelled parcels the driver brings back', 'k-eyebrow') +
        dro.map((o) => '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          '<div class="k-line k-line--between"><span class="ps-gm ps-gm--md">' + esc(o.short_no) + '</span>' + S.pill('stop', 'Dibatalkan', 'Cancelled') + '</div>' +
          '<span class="k-muted" ' + biAttr('Dibatalkan ' + fmt.time(o.cancelled_at) + ' setelah diambil driver ' + fmt.time(o.handed_over_at) + '.',
            'Cancelled ' + fmt.time(o.cancelled_at) + ' after the driver took it at ' + fmt.time(o.handed_over_at) + '.') + '></span>' +
          '<button type="button" class="k-btn k-btn--secondary" data-check="' + o.order_id + '">' + icon('box') + bis('Cek paket yang kembali', 'Check the parcel that came back') + '</button></div>').join('') : '';
      drv.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => {
        const o = dro.find((x) => String(x.order_id) === b.dataset.check);
        driverReturn(o, load);
      }));
      paint(el); paint(drv);
    }
    await load();
    ctx.every(10000, load);
    ctx.every(30000, () => counts(ctx));
  });

  function driverReturn(o, after) {
    const body = document.createElement('div');
    body.className = 'k-stack';
    body.innerHTML = '<p class="k-p">' + bis('Buka paketnya. Hitung unit yang baik dan yang rusak. Yang baik kembali ke rak, yang rusak ke karantina (biaya Ninja).',
      'Open the parcel. Count the good and the damaged units. Good units go back to the rack, damaged ones to quarantine (Ninja cost).') + '</p>' +
      o.lines.map((l, i) => '<div class="k-card k-card--flat k-card--pad k-stack k-stack--tight"><span class="k-strong">' + esc(l.sku_name) + '</span>' +
        '<span class="k-caption" ' + biAttr('Dikirim ' + l.units + ' unit', l.units + ' sent') + '></span>' +
        '<div class="k-line" style="gap:16px;flex-wrap:wrap"><div class="k-stack k-stack--tight">' + bis('Baik', 'Good', 'k-caption') + '<div data-ok="' + i + '"></div></div>' +
        '<div class="k-stack k-stack--tight">' + bis('Rusak', 'Damaged', 'k-caption') + '<div data-bad="' + i + '"></div></div></div></div>').join('') +
      '<label class="k-field"><span class="k-field__label">' + bis('Catatan (boleh kosong)', 'Note (optional)') + '</span><input class="k-input" data-note maxlength="255"></label>';
    const steps = o.lines.map((l, i) => ({
      ok: S.stepper(body.querySelector('[data-ok="' + i + '"]'), { value: l.units, min: 0, max: l.units }),
      bad: S.stepper(body.querySelector('[data-bad="' + i + '"]'), { value: 0, min: 0, max: l.units }),
    }));
    S.modal({
      title: ['Paket kembali: ' + o.short_no, 'Parcel back: ' + o.short_no], body,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        {
          label: ['Simpan hasil cek', 'Save the check'], kind: 'primary',
          onClick: async () => {
            const lines = o.lines.map((l, i) => ({ sku_id: l.sku_id, qty_ok: steps[i].ok.get(), qty_damaged: steps[i].bad.get() }));
            if (lines.some((x, i) => x.qty_ok + x.qty_damaged > o.lines[i].units)) {
              S.toast(['Lebih banyak dari yang dikirim.', 'More than was sent.'], 'caution'); return false;
            }
            const r = await api().post('/hiryu/orders/' + o.order_id + '/driver-return', { lines, note: body.querySelector('[data-note]').value || null });
            S.toast(r.message, r.quarantine_booked ? 'ok' : 'caution');
            after();
          },
        },
      ],
    });
  }

  /* ======================================================================
     Tab: Papan antrean (SPV laptop, board 6j)
     ====================================================================== */

  S.tab('papan', async function (ctx) {
    style();
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    const code = S.shortCode(S.site().code);
    S.setSub('Semua pesanan hari ini di ' + code + '. Pesanan baru langsung diberikan ke picker yang siap paling lama.',
      "Today's orders at " + code + '. A new order goes straight to the picker who has been ready longest.');
    const demo = await demoMode(ctx);
    const btns = (demo ? demoBtnHtml() : '') +
      '<button type="button" class="k-btn k-btn--primary" data-uji data-min-role="supervisor">' + icon('plus') + bis('Buat pesanan uji', 'Create a test order') + '</button>';
    ctx.actions.innerHTML = btns;
    ctx.body.innerHTML = '<div id="ps-board"><div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div></div>';
    [ctx.actions, ctx.body].forEach((root) => {
      root.querySelectorAll('[data-uji]').forEach((b) => b.addEventListener('click', () => openTestOrder(ctx, load)));
      wireDemo(root, ctx, () => load());
    });
    let board = null, skew = 0;
    async function load() {
      try { board = await api().get('/pick-tasks/board' + qs({ site_id: ctx.siteId })); }
      catch (e) { S.fail(e); return; }
      skew = Date.now() - NJW.toDate(board.server_time).getTime();
      const c = board.tab_counts || {};
      S.tabCount('kemas', c.kemas || null);
      S.tabCount('serah', c.serah || null);
      S.tabCount('kembalikan', c.kembalikan || null, c.kembalikan ? 'caution' : null);
      draw();
    }
    const since = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - skew - NJW.toDate(iso)) / 1000)) : 0);
    const first = (name) => String(name || '').split(/[\s@.]/)[0] || name;
    const initials = (name) => String(name || '?').split(/[\s@.]/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
    function card(c, lane) {
      const gm = '<span class="ps-card__gm">' + esc(label(c)) + ' ' + chips(c) + '</span>';
      const store = c.store_name ? '<span class="ps-card__muted">' + esc(c.store_name) + '</span>' : '';
      const uji = (c.is_uji && lane !== 'done_today' && S.atLeast('supervisor')
        ? '<button type="button" class="k-linkbtn" style="align-self:flex-start;font-size:13px" data-ujicancel="' + c.order_id + '">' + esc(t('Batalkan uji', 'Cancel test')) + '</button>' : '') +
        (c.is_demo && lane !== 'done_today' && S.atLeast('supervisor')
          ? '<button type="button" class="k-linkbtn" style="align-self:flex-start;font-size:13px" data-democancel="' + esc(c.external_ref) + '" data-gm="' + esc(label(c)) + '">' +
            esc(t('Batalkan dari Hiryu', 'Cancel from Hiryu')) + '</button>' : '');
      if (lane === 'waiting' && c.is_uji) {
        return '<div class="ps-card ps-card--uji">' + '<span class="ps-chip ps-chip--uji" style="align-self:flex-start">UJI</span>' +
          '<span class="ps-card__gm">' + esc(label(c)) + '</span>' +
          '<span class="ps-card__sub" ' + biAttr('Dibuat ' + fmt.time(c.created_at), 'Created ' + fmt.time(c.created_at)) + '></span>' +
          '<span class="ps-card__muted" ' + biAttr('Tidak ke Hiryu dan Grab', 'Never to Hiryu or Grab') + '></span>' + uji + '</div>';
      }
      if (lane === 'waiting') {
        if (c.scheduled_hold) return '<div class="ps-card">' + gm + '<span class="ps-card__sub" ' + biAttr('Untuk ' + fmt.time(c.scheduled_at), 'For ' + fmt.time(c.scheduled_at)) + '></span>' + store + '</div>';
        const late = c.urgency === 'late';
        return '<div class="ps-card' + (late ? ' ps-card--caution' : '') + '">' + gm +
          '<span class="ps-card__sub" ' + biAttr('Masuk ' + fmt.time(c.order_time || c.created_at) + ' · siap ' + fmt.time(c.promised_at),
            'In ' + fmt.time(c.order_time || c.created_at) + ' · ready ' + fmt.time(c.promised_at)) + '></span>' + store + uji + '</div>';
      }
      if (lane === 'picking') {
        const notStarted = !c.started_at;
        return '<div class="ps-card ps-card--focus">' + gm +
          '<span class="ps-card__sub">' + esc(first(c.claimed_by_name || c.claimed_by)) + ' · <span class="ps-mono" data-since="' + esc(c.claimed_at || '') + '">' + fmt.dur(since(c.claimed_at)) + '</span></span>' +
          (c.basket_code ? '<span class="ps-card__muted ps-mono">' + esc(c.basket_code) + '</span>'
            : notStarted ? '<span class="ps-card__muted" ' + biAttr('Belum mulai', 'Not started') + '></span>' : '') +
          '<button type="button" class="k-btn k-btn--primary k-btn--sm" data-move="' + c.id + '" data-min-role="supervisor">' + bis('Pindahkan', 'Move') + '</button>' + uji + '</div>';
      }
      if (lane === 'to_pack') {
        const w = waitWords(c.waiting_seconds);
        return '<div class="ps-card' + (c.pack_wait_amber ? ' ps-card--caution' : '') + '">' + gm +
          '<span class="ps-card__sub" ' + biAttr((c.basket_code || '-') + ' · ' + w[0], (c.basket_code || '-') + ' · ' + w[1]) + '></span>' + store + uji + '</div>';
      }
      if (lane === 'to_driver') {
        const s = c.waiting_seconds || 0, long = s >= board.thresholds.handover_wait_seconds;
        const w = [mins(s) + ' mnt', mins(s) + ' min'];
        const pack = c.pack_type ? (c.pack_type === 'two' ? ['2 kemasan', 'two packs'] : [PACK[c.pack_type][2], PACK[c.pack_type][3]]) : null;
        return '<div class="ps-card' + (long ? ' ps-card--caution' : '') + '">' + gm +
          (long ? '<span>' + S.pill('caution', 'Lama · ' + w[0], 'Long · ' + w[1]) + '</span>'
            : '<span class="ps-card__sub" ' + biAttr('Menunggu ' + w[0], 'Waiting ' + w[1]) + '></span>') +
          (pack ? '<span class="ps-card__muted" ' + biAttr(pack[0], pack[1]) + '></span>' : '') + uji + '</div>';
      }
      const cancelled = c.order_status === 'cancelled';
      return '<div class="ps-card' + (cancelled ? ' ps-card--stop' : '') + '">' + gm +
        (cancelled ? '<span class="ps-card__sub" style="color:var(--stop)" ' + biAttr('Dibatalkan ' + fmt.time(c.cancelled_at), 'Cancelled ' + fmt.time(c.cancelled_at)) + '></span>'
          : '<span class="ps-card__sub" ' + biAttr('Diambil ' + fmt.time(c.handed_over_at), 'Collected ' + fmt.time(c.handed_over_at)) + '></span>') + '</div>';
    }
    function lane(title, key, cards, extra) {
      return '<div class="ps-lane"><div class="ps-lane__head">' + bis(title[0], title[1]) + '<span class="ps-lane__n">' + cards.length + '</span></div>' +
        (cards.length ? cards.map((c) => card(c, key)).join('') : '<span class="ps-lane__empty">' + esc(t('Kosong', 'Empty')) + '</span>') + (extra || '') + '</div>';
    }
    function person(p) {
      let pill, sub;
      if (p.task_id) {
        pill = S.pill('info', 'Mengambil', 'Picking');
        sub = '<span class="ps-card__muted">' + esc(p.order_ref || '') + ' · <span class="ps-mono" data-since-held="' + (p.held_seconds || 0) + '">' + fmt.dur(p.held_seconds || 0) + '</span></span>';
      } else if (p.state === 'ready') {
        pill = S.pill('ok', 'Siap', 'Ready');
        sub = '<span class="ps-card__muted" ' + biAttr('sejak ' + fmt.time(p.idle_since || p.since), 'since ' + fmt.time(p.idle_since || p.since)) + '></span>';
      } else if (p.state === 'break') {
        pill = '<span class="k-pill"><span class="k-pill__dot"></span>' + bis('Istirahat', 'Break') + '</span>';
        sub = '<span class="ps-card__muted" ' + biAttr('sejak ' + fmt.time(p.since), 'since ' + fmt.time(p.since)) + '></span>';
      } else if (p.state === 'pack') {
        pill = S.pill('info', 'Packer', 'Packer');
        sub = '<span class="ps-card__muted" ' + biAttr('Meja packing · serah ke driver', 'Pack bench · handover') + '></span>';
      } else {
        pill = '<span class="k-pill"><span class="k-pill__dot"></span>' + bis('Tidak aktif', 'Off') + '</span>';
        sub = '';
      }
      const offline = !p.phone_online && p.state !== 'off' && p.state !== 'pack'
        ? '<span class="ps-card__muted" style="color:var(--caution)" ' + biAttr('Ponsel tidak aktif', 'Phone not active') + '></span>' : '';
      return '<div class="ps-person"><span class="ps-avatar">' + esc(initials(p.name || p.email)) + '</span>' +
        '<span class="k-stack k-stack--tight"><span class="k-strong">' + esc(first(p.name || p.email)) + '</span>' + pill + sub + offline + '</span></div>';
    }
    function draw() {
      const el = document.getElementById('ps-board');
      if (!el || !board) return;
      const L = {};
      board.lanes.forEach((x) => { L[x.key] = x.cards; });
      const waiting = L.waiting || [];
      const now = waiting.filter((c) => !c.scheduled_hold), sched = waiting.filter((c) => c.scheduled_hold);
      const done = L.done_today || [];
      const onShift = board.pickers.filter((p) => p.state !== 'off' || p.task_id);
      el.innerHTML = '<div class="ps-lanes">' +
        '<div class="ps-lane"><div class="ps-lane__head">' + bis('Menunggu', 'Waiting') + '<span class="ps-lane__n">' + now.length + '</span></div>' +
          (now.length ? now.map((c) => card(c, 'waiting')).join('') : '<span class="ps-lane__empty">' + esc(t('Kosong', 'Empty')) + '</span>') +
          '<div class="ps-lane__head" style="margin-top:6px">' + icon('clock', 16) + bis('Terjadwal', 'Scheduled') + '<span class="ps-lane__n">' + sched.length + '</span></div>' +
          sched.map((c) => card(c, 'waiting')).join('') + '</div>' +
        lane(['Sedang diambil', 'Being picked'], 'picking', L.picking || []) +
        lane(['Menunggu dikemas', 'Waiting to pack'], 'to_pack', L.to_pack || []) +
        lane(['Menunggu driver', 'Waiting for the driver'], 'to_driver', L.to_driver || []) +
        lane(['Selesai hari ini', 'Done today'], 'done_today', done.slice(0, 6),
          '<button type="button" class="k-linkbtn" style="align-self:flex-start" data-all>' + esc(t('Lihat semua', 'See all')) + '</button>') +
        '<div class="ps-shift"><div class="k-line k-line--between">' + bis('Di shift', 'On shift', 'k-strong') +
          '<span class="k-muted" ' + biAttr(onShift.length + ' orang', onShift.length + (onShift.length === 1 ? ' person' : ' people')) + '></span></div>' +
          (onShift.length ? onShift.map(person).join('') : '<span class="k-muted">' + esc(t('Belum ada yang siap.', 'Nobody is ready yet.')) + '</span>') + '</div>' +
        '</div>';
      el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
        const c = (L.picking || []).find((x) => String(x.id) === b.dataset.move);
        moveOrder(c, board, load);
      }));
      el.querySelectorAll('[data-ujicancel]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await S.confirm({ title: ['Batalkan pesanan uji?', 'Cancel the test order?'], ok: ['Ya, batalkan', 'Yes, cancel'], danger: true,
          text: ['Barang yang sudah diambil masuk daftar Kembalikan ke rak.', 'Units already picked go on the Put back list.'] });
        if (!ok) return;
        try { const r = await api().post('/orders/' + b.dataset.ujicancel + '/test-cancel', {}); S.toast(r.message, 'ok'); load(); } catch (e) { S.fail(e); }
      }));
      el.querySelectorAll('[data-democancel]').forEach((b) => b.addEventListener('click', () => cancelDemo(b.dataset.democancel, b.dataset.gm, load)));
      el.querySelector('[data-all]').addEventListener('click', () => allOrders(ctx));
      paint(el);
    }
    function tick() {
      document.querySelectorAll('#ps-board [data-since]').forEach((x) => { if (x.dataset.since) x.textContent = fmt.dur(since(x.dataset.since)); });
    }
    await load();
    ctx.every(10000, load);
    ctx.every(1000, tick);
  });

  function moveOrder(c, board, after) {
    if (!c) return;
    const holder = (c.claimed_by || '').toLowerCase();
    const people = board.pickers.filter((p) => (p.email || '').toLowerCase() !== holder);
    const body = document.createElement('div');
    body.className = 'k-stack';
    const stateWords = (p) => p.task_id ? ['memegang ' + (p.order_ref || ''), 'holding ' + (p.order_ref || '')]
      : p.state === 'ready' ? ['siap', 'ready'] : p.state === 'break' ? ['istirahat sejak ' + fmt.time(p.since), 'on a break since ' + fmt.time(p.since)]
        : p.state === 'pack' ? ['packer', 'packer'] : ['tidak aktif', 'off'];
    body.innerHTML =
      '<p class="k-p" ' + biAttr('Sekarang: ' + (c.claimed_by_name || c.claimed_by || '-') + ' · ' + fmt.dur(c.held_seconds || 0) + (c.basket_code ? ' · ' + c.basket_code : ''),
        'Now: ' + (c.claimed_by_name || c.claimed_by || '-') + ' · ' + fmt.dur(c.held_seconds || 0) + (c.basket_code ? ' · ' + c.basket_code : '')) + '></p>' +
      '<div class="k-field"><span class="k-field__label">' + bis('Ke picker', 'To picker') + '</span><div class="ps-opts">' +
        '<label class="ps-opt"><input type="radio" name="ps-to" value="" checked><span>' + bis('Picker siap paling lama', 'The picker ready longest') + '</span></label>' +
        people.map((p) => '<label class="ps-opt' + (p.task_id ? ' is-off' : '') + '"><input type="radio" name="ps-to" value="' + esc(p.email) + '"' + (p.task_id ? ' disabled' : '') + '>' +
          '<span><span class="k-strong">' + esc(p.name || p.email) + '</span> · <span ' + biAttr(stateWords(p)[0], stateWords(p)[1]) + '></span></span></label>').join('') +
      '</div></div>' +
      '<div class="k-field"><span class="k-field__label">' + bis('Alasan', 'Reason') + '</span><div class="ps-opts">' +
        (board.move_reasons || []).map((r, i) => '<label class="ps-opt"><input type="radio" name="ps-why" value="' + esc(r) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(r) + '</span></label>').join('') +
      '</div></div>' +
      '<label class="k-field" data-otherwrap hidden><span class="k-field__label">' + bis('Tulis alasannya', 'Write the reason') + '</span><input class="k-input" data-other maxlength="200"></label>' +
      '<p class="k-caption">' + bis('Keranjang ikut pindah bersama pesanan.', 'The basket goes with the order.') + '</p>';
    body.querySelectorAll('input[name="ps-why"]').forEach((r) => r.addEventListener('change', () => {
      body.querySelector('[data-otherwrap]').hidden = r.value !== 'Lainnya' || !r.checked;
    }));
    S.modal({
      title: ['Pindahkan ' + label(c), 'Move ' + label(c)], body,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        {
          label: ['Pindahkan', 'Move'], kind: 'primary', minRole: 'supervisor',
          onClick: async () => {
            const to = body.querySelector('input[name="ps-to"]:checked').value;
            let reason = body.querySelector('input[name="ps-why"]:checked').value;
            if (reason === 'Lainnya') reason = (body.querySelector('[data-other]').value || '').trim();
            if (reason.length < 3) { S.toast(['Tulis alasannya.', 'Write the reason.'], 'caution'); return false; }
            const r = await api().post('/pick-tasks/' + c.id + '/reassign', { to_email: to || null, reason });
            S.toast(r.message, 'ok');
            after();
          },
        },
      ],
    });
  }

  async function allOrders(ctx) {
    let r;
    try { r = await api().get('/orders' + qs({ site_id: ctx.siteId, limit: 100 })); } catch (e) { S.fail(e); return; }
    const st = {
      received: ['Menunggu', 'Waiting'], picked: ['Menunggu dikemas', 'To pack'], packed: ['Menunggu driver', 'To the driver'],
      handed_over: ['Diambil driver', 'Collected'], cancelled: ['Dibatalkan', 'Cancelled'],
    };
    S.drawer({
      title: ['Semua pesanan', 'All orders'], wide: true,
      body: '<div class="k-tablewrap"><table class="k-table"><thead><tr><th>GM</th><th ' + biAttr('Masuk', 'In') + '></th><th ' + biAttr('Status', 'Status') + '></th><th class="k-num" ' + biAttr('Unit', 'Units') + '></th></tr></thead><tbody>' +
        r.orders.map((o) => '<tr' + (o.status === 'cancelled' ? ' class="is-stop"' : '') + '><td><span class="ps-card__gm">' + esc(o.short_no || o.external_ref) + ' ' + chips(o) + '</span></td>' +
          '<td>' + esc(fmt.dt(o.created_at)) + '</td><td ' + biAttr((st[o.status] || [o.status, o.status])[0], (st[o.status] || [o.status, o.status])[1]) + '></td>' +
          '<td class="k-num">' + n(o.units) + '</td></tr>').join('') + '</tbody></table></div>',
    });
  }

  /* ======================================================================
     Tab: Kembalikan ke rak (board 6k): scan the unit, then the bin.
     ====================================================================== */

  S.tab('kembalikan', async function (ctx) {
    style();
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    const orderParam = ctx.params.get('order');
    S.setSub('Barang dari pesanan yang dibatalkan kembali ke rak, satu per satu.', 'Units from cancelled orders go back on the rack, one at a time.');
    ctx.body.innerHTML = '<div class="ps-wrap" style="max-width:960px" id="ps-kemb"><div class="k-loading">' + bis('Memuat…', 'Loading…') + '</div></div>';
    let data;
    async function load() {
      try { data = await api().get('/returns/by-order' + qs({ site_id: ctx.siteId })); } catch (e) { S.fail(e); return null; }
      S.tabCount('kembalikan', data.groups.length || null, data.groups.length ? 'caution' : null);
      return data;
    }
    if (!(await load())) return;
    const rtParam = ctx.params.get('rt');
    if (orderParam || rtParam) {
      const g = orderParam ? data.groups.find((x) => String(x.order_id) === orderParam)
        : data.groups.find((x) => x.tasks.some((y) => String(y.id) === rtParam));
      if (g) return returnFlow(ctx, g, load);
    }
    listReturns(ctx, data);
    ctx.every(15000, async () => { if (!document.body.classList.contains('is-full') && await load()) listReturns(ctx, data); });
  });

  const reasonWords = (g) => g.reason === 'uji' ? ['dari pesanan uji', 'from the test order']
    : g.reason === 'driver_return' ? ['kembali dari driver', 'back from the driver']
      : g.reason === 'quarantine' ? ['dari karantina', 'from quarantine'] : ['yang dibatalkan', 'that was cancelled'];
  const reasonPill = (g) => g.reason === 'driver_return' ? S.pill('info', 'Kembali dari driver', 'Back from the driver')
    : g.reason === 'uji' ? S.pill('info', 'Pesanan uji', 'Test order')
      : g.reason === 'quarantine' ? S.pill('ok', 'Dari karantina', 'From quarantine') : S.pill('stop', 'Dibatalkan', 'Cancelled');
  const groupTitle = (g) => {
    const left = g.units - g.units_returned, r = reasonWords(g);
    if (!g.order_id || g.reason === 'quarantine') return [left + ' unit ' + r[0], left + (left === 1 ? ' unit ' : ' units ') + r[1]];
    return [left + ' unit dari ' + (g.label || '-') + ' ' + r[0], left + (left === 1 ? ' unit' : ' units') + ' from ' + (g.label || '-') + ' ' + r[1]];
  };

  function listReturns(ctx, data) {
    const h = document.getElementById('ps-kemb');
    if (!h) return;
    const href = (g) => 'pesanan.html?tab=kembalikan' + (g.order_id ? '&order=' + g.order_id : '&rt=' + g.tasks[0].id);
    if (!data.groups.length) {
      h.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
        bis('Tidak ada barang untuk dikembalikan', 'Nothing to put back', 'k-empty__title') +
        bis('Barang dari pesanan yang dibatalkan muncul di sini.', 'Units from cancelled orders appear here.', 'k-empty__text') + '</div>';
      paint(h); return;
    }
    h.innerHTML =
      '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr>' +
        '<th ' + biAttr('Pesanan', 'Order') + '></th><th ' + biAttr('Alasan', 'Reason') + '></th><th ' + biAttr('Keranjang', 'Basket') + '></th>' +
        '<th ' + biAttr('Produk', 'Products') + '></th><th class="k-num" ' + biAttr('Unit sisa', 'Units left') + '></th><th></th></tr></thead><tbody>' +
        data.groups.map((g) => '<tr><td class="k-mono k-strong">' + esc(g.label || '-') + '</td>' +
          '<td>' + reasonPill(g) + '</td>' +
          '<td class="k-mono">' + esc(g.basket_code || '-') + '</td>' +
          '<td>' + esc(g.tasks.map((x) => x.sku_name).join(', ')) + '</td>' +
          '<td class="k-num">' + (g.units - g.units_returned) + '</td>' +
          '<td class="k-table__actions"><a class="k-btn k-btn--primary k-btn--sm" href="' + href(g) + '">' + bis('Kembalikan', 'Put back') + '</a></td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="k-phone-only k-list">' + data.groups.map((g) => {
        const tt = groupTitle(g);
        const red = g.reason === 'cancelled';
        return '<a class="k-row' + (red ? ' k-row--stop' : '') + '" href="' + href(g) + '"><span class="k-row__icon' + (red ? ' k-row__icon--stop' : '') + '">' + icon('undo', 26) + '</span>' +
          '<span class="k-row__text"><span class="k-row__title" ' + biAttr(tt[0], tt[1]) + '></span>' +
          '<span class="k-row__sub">' + (g.basket_code ? esc(t('Keranjang ', 'Basket ') + g.basket_code) + ' · ' : '') + esc(g.tasks.length + ' ' + t('produk', 'products')) + '</span></span>' +
          '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>';
      }).join('') + '</div>';
    paint(h);
  }

  function returnFlow(ctx, group, reload) {
    const h = document.getElementById('ps-kemb');
    let g = group, step = 'unit', unitCode = null, freed = null;
    const exit = () => {
      const u = new URL(location.href);
      u.searchParams.delete('order');
      u.searchParams.delete('rt');
      history.replaceState(null, '', u.pathname + u.search);
      resetFull();
      S.rerender();
    };
    S.fullScreen(true, { title: ['Kembalikan ke rak', 'Put back to rack'], onBack: exit });
    const queue = () => g.tasks.filter((x) => x.qty > x.qty_returned && x.status === 'open');
    function draw() {
      const q = queue();
      const total = g.units, done = g.units_returned;
      if (!q.length) {
        h.innerHTML = '<div class="k-card k-card--pad k-stack" style="border:2px solid var(--ok)">' + S.pill('ok', 'Selesai', 'Done') +
          '<span class="ps-big">' + bis('Semua sudah kembali di rak.', 'Everything is back on the rack.') + '</span>' +
          (freed ? '<span class="k-muted" ' + biAttr('Keranjang ' + freed + ' kosong dan bisa dipakai lagi.', 'Basket ' + freed + ' is empty and free again.') + '></span>' : '') + '</div>' +
          '<div class="k-actionbar"><a class="k-btn k-btn--primary k-btn--lg k-btn--block" href="pesanan.html?tab=ambil">' + icon('bag', 22) + bis('Kembali ke Ambil pesanan', 'Back to picking') + '</a>' +
          '<button type="button" class="k-btn k-btn--ghost k-btn--block" data-exit>' + bis('Daftar Kembalikan ke rak', 'Put back list') + '</button></div>';
        h.querySelector('[data-exit]').addEventListener('click', exit);
        paint(h); return;
      }
      const cur = q[0];
      const later = [];
      const restHere = cur.qty - cur.qty_returned - 1;
      if (restHere > 0) later.push([restHere + ' unit lagi ke ' + (cur.location_short || '?'), restHere + ' more to ' + (cur.location_short || '?')]);
      q.slice(1).forEach((x) => later.push([(x.qty - x.qty_returned) + ' unit ' + x.sku_name + ' ke ' + (x.location_short || '?'), (x.qty - x.qty_returned) + ' × ' + x.sku_name + ' to ' + (x.location_short || '?')]));
      const tt = groupTitle(g);
      h.innerHTML =
        '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          '<span>' + reasonPill(g) + '</span>' +
          '<span class="ps-big" ' + biAttr(tt[0], tt[1]) + '></span>' +
          '<div class="ps-prog"><span class="k-strong" style="white-space:nowrap" ' + biAttr('Unit ' + (done + 1) + ' dari ' + total, 'Unit ' + (done + 1) + ' of ' + total) + '></span>' +
          '<div class="k-progress k-grow"><div class="k-progress__bar" style="width:' + Math.round(100 * done / Math.max(1, total)) + '%"></div></div></div>' +
        '</div>' +
        '<div class="k-card k-card--pad k-stack k-stack--tight' + (step === 'bin' ? '' : ' k-card--focus') + '">' +
          '<div class="ps-step"><span class="ps-step__no' + (step === 'bin' ? ' ps-step__no--ok' : '') + '">' + (step === 'bin' ? icon('check', 18, 3) : '1') + '</span>' +
          '<span class="k-stack k-stack--tight"><span class="k-strong" ' + (step === 'bin' ? biAttr('Barang dipindai · cocok', 'Item scanned · matches') : biAttr('Pindai barangnya', 'Scan the item')) + '></span>' +
          '<span class="ps-big">' + esc(cur.sku_name) + '</span></span></div></div>' +
        (cur.location_code
          ? '<div class="k-target' + (step === 'bin' ? '' : '') + '" style="' + (step === 'bin' ? '' : 'opacity:.6') + '"><div class="k-target__text">' + bis('2. Ke bin', '2. To bin', 'k-target__label') +
            '<span class="k-target__code">' + esc(cur.location_short || cur.location_code) + '</span>' +
            (cur.location_words ? '<span class="k-target__hint">' + esc(cur.location_words) + '</span>' : '') +
            '<span class="k-target__hint">' + bis('Taruh barang di bin ini, lalu pindai label bin.', 'Put the item in this bin, then scan the bin label.') + '</span></div></div>'
          : '<div class="k-note k-note--stop">' + icon('warn', 20) + bis('Barang ini belum punya rak. Panggil supervisor.', 'This item has no rack yet. Call a supervisor.') + '</div>') +
        '<div data-scan></div>' +
        (later.length ? '<span class="k-muted" ' + biAttr('Berikutnya: ' + later.map((x) => x[0]).join(', lalu '), 'Next: ' + later.map((x) => x[1]).join(', then ')) + '></span>' : '');
      S.scan(async (code, z) => {
        try {
          if (step === 'unit') {
            await api().post('/returns/' + cur.id + '/check-unit', { code });
            z.accept(t('Cocok', 'Match'));
            unitCode = code; step = 'bin';
            setTimeout(draw, 300);
          } else {
            const r = await api().post('/returns/' + cur.id + '/scan', { code: unitCode, bin_code: code, idempotency_key: uid() });
            z.accept(t('Kembali di rak', 'Back on the rack'));
            if (r.basket_freed) freed = r.basket_freed;
            cur.qty_returned = r.task.qty_returned;
            cur.status = r.task.status;
            g.units_returned += 1;
            step = 'unit'; unitCode = null;
            setTimeout(draw, 300);
          }
        } catch (e) { z.reject(say(e.message)); }
      }, {
        title: step === 'unit' ? ['Pindai barang', 'Scan the item'] : ['Pindai label bin ' + (cur.location_short || ''), 'Scan bin label ' + (cur.location_short || '')],
        mount: h.querySelector('[data-scan]'),
      });
      paint(h);
    }
    draw();
  }
})();
