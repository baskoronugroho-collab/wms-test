/* pesanan.js: orders on the floor (canvas Section 6, boards 6a to 6k).
 *
 * Tabs (pesanan.html):
 *   ambil       picker phone: Siap ambil (screen kept on), new order + basket
 *               scan with the 2-minute countdown, guided pick with the ready-by
 *               time, Barang tidak ada with the customer's instruction, Barang
 *               rusak, Selesai ambil, and a cancelled order's units back to
 *               the rack (6a to 6f)
 *   kemas       pack bench: baskets oldest first, then Kemas GM-xxx (6g, 6h)
 *   serah       handover table: parcels waiting for the driver, cancelled
 *               parcels, and parcels the driver brought back (6i)
 *   papan       SPV queue board: five lanes, Di shift, Pindahkan, Buat pesanan
 *               uji, Buat pesanan dummy in Mode demo (6j)
 *   kembalikan  Kembalikan ke rak: scan the unit, then the bin (6k)
 *
 * Mode manual (V32, the dark store's scanners are broken): the basket, each
 * unit, the damaged unit and its tray, and the put back are confirmed by a
 * tap, still one unit at a time; the scan zone stays folded under "Masih bisa
 * pindai?". The pack screen and the queue board show what was picked by hand.
 *
 * API (backend/routers/outbound.py, hiryu.py, returns.py, pickers.py):
 *   GET  /pickers/me, POST /pickers/ready|break
 *   GET  /pick-tasks/{id}, POST /pick-tasks/{id}/basket|start|complete
 *   POST /pick-lines/{id}/confirm|short|damaged, GET /pick-lines/{id}/instruction
 *   GET  /quarantine/trays, GET /quarantine/lookup (Barang rusak, read only)
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
.ps-chip--manual { background: var(--caution-bg); color: var(--ink); }
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
.ps-photo--xl { width: 128px; height: 128px; border-radius: 16px; }
/* Mode manual: the tap is the main action, the scan zone folds away */
.ps-tap { height: auto; min-height: 72px; font-size: 20px; white-space: normal; }
.ps-taps { display: flex; flex-wrap: wrap; gap: 10px; }
.ps-taps .k-btn { font-family: var(--mono); font-size: 20px; }
.ps-alt > summary { list-style: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; cursor: pointer; }
.ps-alt > summary::-webkit-details-marker { display: none; }
.ps-retpick { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 10px 12px; border: 2px solid var(--rule); border-radius: 12px; background: var(--surface); text-align: left; font: inherit; color: inherit; cursor: pointer; }
.ps-retpick:hover { border-color: var(--action); }
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
.ps-all { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 10px 12px; border: 2px solid var(--ok); border-radius: 12px; font-size: 17px; font-weight: 800; cursor: pointer; background: var(--surface); }
.ps-all input { width: 24px; height: 24px; accent-color: var(--ok); }
.ps-all.is-checked { background: var(--ok-bg); }
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
  const secsSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - NJW.toDate(iso)) / 1000)) : null);
  const mins = (s) => Math.max(0, Math.round((s || 0) / 60));
  const n = (v) => fmt.n(v);
  /* size: true = small, 'xl' = the big photo of Mode manual. */
  const photo = (key, sm) => {
    const url = key && NJW.api.photoUrl ? NJW.api.photoUrl(key) : null;
    return '<span class="ps-photo' + (sm === 'xl' ? ' ps-photo--xl' : sm ? ' ps-photo--sm' : '') + '" role="img" ' + biAttrAria('Foto produk', 'Product photo') + '>' +
      (url ? '<img alt="" src="' + esc(url) + '" onerror="this.remove()">' : icon('box', sm === 'xl' ? 44 : sm ? 24 : 30)) + '</span>';
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

  function paint(el) { tickClocks(); S.applyLang(el); S.lockAll(el); return el; }

  /* ---------- Mode manual (V32) ----------
     The dark store's scanners or cameras are broken: every unit is still
     confirmed one at a time, by a tap after matching it to the photo, and the
     server marks it. The picker's poll says live whether it is on (a switch
     needs no reload); before the first poll the hub from the shell answers. */
  const manualOn = () => (A.me && typeof A.me.manual_mode === 'boolean' ? A.me.manual_mode : S.manualMode());
  const MANUAL_COPY = ['Mode manual: konfirmasi setiap unit dengan ketuk. Pastikan produknya sama dengan foto.',
    'Manual mode: confirm each unit with a tap. Make sure the product matches the photo.'];
  /* "Masih bisa pindai?": the scan zone folded under a link, for whoever still
     has a working scanner. S.scan mounts in its [data-scan] as usual. */
  const scanAltHtml = () => '<details class="ps-alt"><summary class="k-linkbtn">' + icon('scan', 18) +
    bis('Masih bisa pindai?', 'Scanner still works?') + '</summary><div data-scan style="margin-top:8px"></div></details>';
  const tapBtnHtml = () => '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block ps-tap" data-tap>' +
    icon('check', 26, 2.6) + bis('Sudah ambil 1 unit', 'Took 1 unit') + '</button>';

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

  /* ---------- the screen stays on while Siap ambil (board 6a) ----------
     A phone whose screen goes dark stops polling: it does not ring and gets no
     order. The wake lock keeps the screen on. The browser drops it when the
     page is hidden, so it is asked for again when the page shows. No wake lock
     (older phone) or refused: the idle screen asks the picker to keep it on. */
  const WAKE = { lock: null, want: false, failed: false, busy: false };
  async function wake(on) {
    WAKE.want = !!on;
    if (!on) {
      const l = WAKE.lock;
      WAKE.lock = null;
      if (l) { try { await l.release(); } catch (e) { /* already gone */ } }
      paintWakeNote();
      return;
    }
    if (WAKE.lock || WAKE.busy || document.visibilityState !== 'visible') return;
    if (!navigator.wakeLock || !navigator.wakeLock.request) { WAKE.failed = true; paintWakeNote(); return; }
    WAKE.busy = true;
    try {
      const l = await navigator.wakeLock.request('screen');
      if (!WAKE.want) l.release().catch(() => {});
      else {
        WAKE.lock = l;
        WAKE.failed = false;
        l.addEventListener('release', () => { if (WAKE.lock === l) WAKE.lock = null; });
      }
    } catch (e) { WAKE.failed = true; }
    finally { WAKE.busy = false; }
    paintWakeNote();
  }
  function paintWakeNote() {
    const el = document.querySelector('#ps-ambil [data-wake]');
    if (el) el.hidden = !(WAKE.want && WAKE.failed);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!document.getElementById('ps-ambil')) { wake(false); return; }
    if (WAKE.want) wake(true);
    // Back on the screen: ask the server now, not at the next poll. A picker
    // the 2-minute rule switched off sees why at once.
    if (A.me) pollMe(false);
  });

  /* ---------- clocks against the server ----------
     The 2-minute start and the 10-minute ready-by tick on the server's clock,
     not the phone's. Every page answer that carries server_time resets it. */
  let SKEW = 0;
  const syncClock = (iso) => { if (iso) SKEW = Date.now() - NJW.toDate(iso).getTime(); };
  const serverNow = () => Date.now() - SKEW;
  const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const startByHtml = (assignedIso, secs) => (assignedIso
    ? '<span data-startby="' + (NJW.toDate(assignedIso).getTime() + 1000 * (secs || 120)) + '"></span>' : '');
  const readyByHtml = (iso) => (iso ? '<span data-readyby="' + esc(iso) + '"></span>' : '');
  function setPill(el, html) {
    if (el._ps === html) return;
    el._ps = html;
    el.innerHTML = html;
  }
  /* "Mulai dalam 1:32": amber at 30 seconds. "Siap paling lambat 10:42": amber
     at 3 minutes left, red once passed. Each also has its word, not colour alone. */
  function tickClocks() {
    document.querySelectorAll('[data-startby]').forEach((el) => {
      const left = Math.max(0, Math.ceil((+el.dataset.startby - serverNow()) / 1000));
      setPill(el, left > 0
        ? S.pill(left <= 30 ? 'caution' : 'info', 'Mulai dalam ' + mmss(left), 'Start within ' + mmss(left))
        : S.pill('stop', 'Waktu mulai habis', 'Start time is up'));
    });
    document.querySelectorAll('[data-readyby]').forEach((el) => {
      const iso = el.dataset.readyby, hm = fmt.time(iso);
      const left = Math.round((NJW.toDate(iso).getTime() - serverNow()) / 1000);
      const m = Math.max(1, Math.ceil(left / 60));
      setPill(el, left < 0 ? S.pill('stop', 'Lewat: siap paling lambat ' + hm, 'Late: ready by ' + hm)
        : left <= 180 ? S.pill('caution', 'Siap paling lambat ' + hm + ' · sisa ' + m + ' mnt', 'Ready by ' + hm + ' · ' + m + ' min left')
          : S.pill('info', 'Siap paling lambat ' + hm, 'Ready by ' + hm));
    });
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
  /* The small rack picture beside "Ke bin": the bin's level and place lit up.
     A stacked bin (code ends in B, M or T: A-2-03B) is drawn as boxes on top of
     each other in its place, the right one lit, with "Bin bawah" (or tengah,
     atas) written under the picture. */
  const STACK_WORDS = { B: ['Bin bawah', 'Bottom bin'], M: ['Bin tengah', 'Middle bin'], T: ['Bin atas', 'Top bin'] };
  function rackSvg(level, pos, stack) {
    const levels = Math.max(4, level || 0), cols = Math.max(4, pos || 0);
    const W = 64, H = 84, cw = (W - 8) / cols, lh = (H - 8) / levels;
    let out = '<svg class="ps-rack" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>';
    const box = (x, y, w, h, fill) => '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + fill + '"/>';
    for (let l = 1; l <= levels; l++) {
      for (let c = 1; c <= cols; c++) {
        const x = 4 + (c - 1) * cw, y = H - 4 - l * lh;
        const on = l === level && c === pos;
        if (on && stack) {
          // Two high (B, T) unless the code says middle; bottom box at the bottom.
          const n = stack === 'M' ? 3 : 2, at = stack === 'B' ? 0 : stack === 'M' ? 1 : n - 1;
          const sh = (lh - 2 - (n - 1)) / n;
          for (let i = 0; i < n; i++) {
            out += box(x + 1, y + 1 + (n - 1 - i) * (sh + 1), cw - 2, sh, i === at ? 'var(--action)' : 'var(--rule)');
          }
        } else {
          out += box(x + 1, y + 1, cw - 2, lh - 2, on ? 'var(--action)' : 'var(--sunk)');
        }
      }
    }
    out += '</svg>';
    if (!stack) return out;
    return '<span style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0">' + out +
      '<span style="font-size:12px;font-weight:800;color:var(--action);text-align:center;max-width:84px;line-height:1.2">' + bis(STACK_WORDS[stack][0], STACK_WORDS[stack][1]) + '</span></span>';
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
    ctx.every(1000, tickClocks);
  });

  const host = () => document.getElementById('ps-ambil');

  async function pollMe(force) {
    if (!host()) return;
    let me;
    try { me = await api().get('/pickers/me' + qs({ site_id: A.ctx.siteId })); }
    catch (e) { if (force) S.fail(e); return; }
    const prev = A.me;
    A.me = me;
    syncClock(me.server_time);
    if (typeof me.manual_mode === 'boolean' && S.setManualMode) S.setManualMode(me.manual_mode, me.manual_mode_until);
    wake(me.state === 'ready');
    const duty = me.return_duty ? me.return_duty.order_id : null;
    // Mode manual switching on or off redraws the screen (taps or scans).
    const sig = JSON.stringify([me.state, me.task_id, me.basket_code, !!me.started_at, duty, !!me.timed_out, !!me.manual_mode]);
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
      // No basket yet, or an order another picker stopped or the SPV moved
      // (its basket stays with it): scan the basket first, that starts it.
      if (!me.basket_code || !me.started_at) return renderNew();
      return await renderPick();
    } catch (e) { S.fail(e); }
  }

  /* The order's head on every picking screen: GM, basket, the 10-minute
     target ("Siap paling lambat") and the stopwatch. */
  function headCard(task) {
    syncClock(task.server_time);
    return '<div class="ps-head"><div class="ps-head__main">' +
      '<span class="ps-gm">' + esc(label(task)) + ' ' + chips(task) + '</span>' +
      (task.basket_code ? '<span class="ps-head__sub">' + icon('basket', 18) + bis('Keranjang', 'Basket') + ' <b>' + esc(task.basket_code) + '</b></span>' : '') +
      (task.order_status !== 'cancelled' ? readyByHtml(task.ready_by) : '') +
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
    const startMin = Math.max(1, Math.round((me.pick_start_seconds || 120) / 60));
    // Switched off by the 2-minute rule: say so plainly, with the way back on.
    const timedOut = !ready && me.timed_out;
    h.innerHTML =
      (timedOut
        ? '<div class="k-card k-card--stop k-card--pad k-stack">' +
          '<span>' + S.pill('stop', 'Siap ambil dimatikan', 'Ready to pick switched off') + '</span>' +
          '<span class="ps-big">' + esc(say(me.note)) + '</span>' +
          bis('Pesanan harus dimulai dalam ' + startMin + ' menit setelah ponsel berbunyi. Nyalakan lagi kalau Anda sudah siap.',
            'An order must be started within ' + startMin + ' min of the ring. Switch on again when you are ready.', 'k-muted') +
          '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-ready>' + icon('arrow', 24, 2.2) +
            bis('Nyalakan Siap ambil lagi', 'Switch Ready to pick back on') + '</button></div>'
        : me.note ? '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + esc(say(me.note)) + '</span></div>' : '') +
      (manualOn() ? '<div class="k-note k-note--stop">' + icon('warn', 20) + bis(MANUAL_COPY[0], MANUAL_COPY[1]) + '</div>' : '') +
      '<div class="k-card k-card--pad"><div class="ps-ready">' +
        '<div class="k-grow"><div class="k-h2">' + bis('Siap ambil', 'Ready to pick') + '</div>' +
        '<div class="k-caption">' + (ready
          ? '<span ' + biAttr('Nyala sejak ' + fmt.time(me.since), 'On since ' + fmt.time(me.since)) + '></span>'
          : me.state === 'break' ? bis('Istirahat. Tidak ada pesanan yang datang.', 'On a break. No order comes to you.')
          : me.state === 'pack' ? bis('Anda tercatat di meja kemas.', 'You are at the pack bench.')
          : bis('Mati. Nyalakan saat Anda siap.', 'Off. Switch on when you are ready.')) + '</div></div>' +
        '<button type="button" class="k-switch" id="ps-sw" aria-checked="' + ready + '" ' + biAttrAria('Siap ambil', 'Ready to pick') + '></button>' +
      '</div></div>' +
      (ready
        ? '<div class="k-note k-note--caution" data-wake hidden>' + icon('warn', 20) +
            bis('Biarkan layar tetap menyala. Pesanan hanya berbunyi saat layar menyala.', 'Keep the screen on. Orders only ring while the screen is on.') + '</div>' +
          '<div class="k-card ps-wait"><span class="ps-wait__icon">' + icon('bell', 34) + '</span>' +
          bis('Menunggu pesanan.', 'Waiting for an order.', 'ps-big') +
          bis('Ponsel berbunyi saat pesanan datang. Layar harus tetap menyala.', 'The phone rings when an order comes. The screen must stay on.', 'ps-big') +
          bis('Saat berbunyi, mulai dalam ' + startMin + ' menit.', 'When it rings, start within ' + startMin + ' min.', 'k-muted') + '</div>'
        : '<div class="k-card ps-wait"><span class="ps-wait__icon">' + icon('bag', 34) + '</span>' +
          bis('Nyalakan Siap ambil. Pesanan datang sendiri ke ponsel ini.', 'Switch on Ready to pick. Orders come to this phone by themselves.', 'ps-big') + '</div>') +
      '<div class="k-card k-card--pad"><div class="k-line k-line--between"><span class="k-strong">' + bis('Hari ini', 'Today') + '</span>' +
        '<span class="ps-big" data-today></span></div>' +
        '<div class="k-caption" data-queue></div></div>' +
      '<div class="k-actionbar">' + (ready
        ? '<button type="button" class="k-btn k-btn--secondary k-btn--lg k-btn--block" data-break>' + icon('clock', 22) + bis('Istirahat', 'Take a break') + '</button>'
        : '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-ready>' + icon('arrow', 24, 2.2) + bis('Siap ambil pesanan', 'Ready to pick orders') + '</button>') +
      '</div>';
    paintIdleCounts(me);
    S.toggle(h.querySelector('#ps-sw'), (on) => setReady(on));
    const b = h.querySelector('[data-break]');
    h.querySelectorAll('[data-ready]').forEach((r) => r.addEventListener('click', () => setReady(true)));
    if (b) b.addEventListener('click', () => setReady(false));
    paint(h);
    paintWakeNote();
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
    } catch (e) {
      // Istirahat with a started order in hand: offer to stop it instead.
      if (!on && e.status === 409 && A.me && A.me.task_id) { stopOrder(A.lastTask).catch(S.fail); return false; }
      S.fail(e);
      return false;
    }
    return true;
  }

  /* 6b: the order came; take an empty basket and scan its label. In Mode
     manual the picker taps the basket they took instead. */
  function renderNew() {
    const me = A.me, h = host();
    const startMin = Math.max(1, Math.round((me.pick_start_seconds || 120) / 60));
    // Resumed: the order already has its basket, with units in it. Take that
    // basket, not an empty one.
    const resume = !!me.basket_code;
    const manual = manualOn();
    S.fullScreen(true, { title: resume ? ['Lanjutkan pesanan', 'Carry on an order'] : ['Pesanan baru', 'New order'], onBack: () => S.fullScreen(false) });
    // Any free basket is right. Show every free one; an older API gives one example.
    const free = Array.isArray(me.free_baskets) ? me.free_baskets
      : [me.suggested_basket || ((S.shortCode(S.site().code) || 'MA5') + '-OUT-01')];
    const freeHtml = free.length
      ? (manual
        ? '<div class="ps-taps">' + free.map((c) => '<button type="button" class="k-btn k-btn--secondary k-btn--lg" data-basket="' + esc(c) + '">' +
            icon('basket', 22) + esc(c) + '</button>').join('') + '</div>'
        : free.map((c) => '<span class="ps-label">' + icon('basket', 22) + esc(c) + '</span>').join(''))
      : bis('Belum ada. Keranjang kosong lagi setelah pesanan selesai dikemas.', 'None yet. A basket is free again once its order is packed.', 'k-strong');
    h.innerHTML =
      '<div class="k-card k-card--focus k-card--pad k-stack k-stack--tight">' +
        (resume ? bis('Pesanan ini dilanjutkan dari picker lain', 'You carry on an order another picker started', 'k-eyebrow')
          : bis('Pesanan baru untuk Anda', 'A new order for you', 'k-eyebrow')) +
        '<div class="k-line k-line--between" style="align-items:flex-start"><div class="k-stack k-stack--tight">' +
          bis('Nomor pesanan', 'Order number', 'k-caption') +
          '<span class="ps-gm" style="font-size:34px">' + esc(me.order_ref || '-') + ' ' + chips(me) + '</span></div><div data-sw></div></div>' +
        '<span class="ps-big" ' + biAttr(productsWord(me.products || 0)[0] + ' · ' + unitsWord(me.units || 0)[0],
          productsWord(me.products || 0)[1] + ' · ' + unitsWord(me.units || 0)[1]) + '></span>' +
        (me.store_name ? '<span class="k-muted k-strong">' + esc(me.store_name) + '</span>' : '') +
        startByHtml(me.assigned_at, me.pick_start_seconds) +
      '</div>' + stopBtnHtml() +
      (resume
        ? '<div class="k-card k-card--pad k-stack">' +
            '<div class="ps-step"><span class="ps-step__no">1</span><span class="ps-big">' +
              (manual
                ? bis('Ambil keranjang pesanan ini dari meja kemas, atau dari picker sebelumnya. Lalu ketuk tombol di bawah.',
                  "Take this order's basket from the pack bench, or from the picker before you. Then tap the button below.")
                : bis('Ambil keranjang pesanan ini dari meja kemas, atau dari picker sebelumnya. Pindai labelnya.',
                  "Take this order's basket from the pack bench, or from the picker before you. Scan its label.")) + '</span></div>' +
            (manual
              ? '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block ps-tap" data-basket="' + esc(me.basket_code) + '">' + icon('basket', 24) +
                bis('Keranjang ' + me.basket_code + ' sudah di tangan', 'I have basket ' + me.basket_code) + '</button>'
              : '<div class="k-line" style="gap:12px;flex-wrap:wrap"><span class="ps-label">' + icon('basket', 22) + esc(me.basket_code) + '</span></div>') +
            bis('Jangan ambil keranjang kosong: barang yang sudah diambil ada di keranjang ini. Lanjutkan dari barang yang belum diambil.',
              'Do not take an empty basket: the units already picked are in this one. Carry on from what is still to pick.', 'k-muted') +
          '</div>'
        : '<div class="k-card k-card--pad k-stack">' +
            '<div class="ps-step"><span class="ps-step__no">1</span><span class="ps-big">' +
              (manual ? bis('Ambil keranjang kosong mana saja, lalu ketuk labelnya di bawah', 'Take any empty basket, then tap its label below')
                : bis('Ambil keranjang kosong mana saja, pindai labelnya', 'Take any empty basket and scan its label')) + '</span></div>' +
            '<div class="k-line" style="gap:12px;flex-wrap:wrap">' + bis('Yang kosong sekarang:', 'Free now:', 'k-caption') +
              freeHtml + '</div>' +
          '</div>') +
      '<div class="k-note k-note--caution">' + icon('clock', 20) +
        (manual
          ? bis('Pilih keranjang dalam ' + startMin + ' menit. Kalau tidak, pesanan pindah ke orang lain dan Siap ambil Anda mati.',
            'Choose a basket within ' + startMin + ' min, or the order goes to someone else and your Ready to pick goes off.')
          : bis('Pindai keranjang dalam ' + startMin + ' menit. Kalau tidak, pesanan pindah ke orang lain dan Siap ambil Anda mati.',
            'Scan a basket within ' + startMin + ' min, or the order goes to someone else and your Ready to pick goes off.')) + '</div>' +
      (manual ? scanAltHtml() : '<div data-scan></div>');
    startWatch(h, me.assigned_at);
    wireStop(h, null);
    // Mode manual: the basket in hand is tapped. One request at a time; the
    // server marks it manual and refuses it once Mode manual is off.
    h.querySelectorAll('[data-basket]').forEach((b) => b.addEventListener('click', async () => {
      const all = h.querySelectorAll('[data-basket]');
      if (b.disabled) return;
      all.forEach((x) => { x.disabled = true; });
      try {
        await api().post('/pick-tasks/' + me.task_id + '/basket', { code: b.dataset.basket, manual: true });
        S.toast(['Keranjang ' + b.dataset.basket, 'Basket ' + b.dataset.basket], 'ok');
        A.sig = null;
        await pollMe(true);
      } catch (e) {
        all.forEach((x) => { x.disabled = false; });
        S.fail(e);
        // Mode manual may have ended: the poll redraws the screen for scanning.
        if (!e.network) pollMe(false);
      }
    }));
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

  /* 6c: go to the bin, take from the front, scan each unit. In Mode manual:
     one tap on "Sudah ambil 1 unit" per unit, the scan zone folded away. */
  async function renderPick() {
    const me = A.me, h = host();
    const task = await api().get('/pick-tasks/' + me.task_id);
    A.lastTask = task;
    const line = currentLine(task);
    if (!line) return renderDone(task);
    const manual = manualOn();
    S.fullScreen(true, { title: ['Ambil pesanan', 'Pick the order'], onBack: () => S.fullScreen(false) });
    const prods = [];
    task.lines.forEach((l) => { if (l.qty_required > 0 && !prods.includes(l.order_line_id)) prods.push(l.order_line_id); });
    const idx = prods.indexOf(line.order_line_id);
    const doneLines = new Set(task.lines.filter((l) => l.qty_required > 0 && l.qty_picked >= l.qty_required).map((l) => l.order_line_id));
    h.innerHTML = headCard(task) + stopBtnHtml() +
      '<div class="ps-prog"><span class="k-strong" style="white-space:nowrap" ' + biAttr('Produk ' + (idx + 1) + ' dari ' + prods.length, 'Product ' + (idx + 1) + ' of ' + prods.length) + '></span>' +
        '<div class="ps-prog__bar" style="grid-template-columns:repeat(' + prods.length + ',minmax(0,1fr))">' +
        prods.map((p, i) => '<span class="' + (i === idx ? 'is-on' : doneLines.has(p) ? 'is-done' : '') + '"></span>').join('') + '</div></div>' +
      '<div class="k-target"><div class="k-target__text">' + bis('Ke bin', 'To bin', 'k-target__label') +
        '<span class="k-target__code">' + esc(line.location_short || line.location_code || '?') + '</span>' +
        (line.location_words ? '<span class="k-target__hint">' + esc(line.location_words) + '</span>' : '') +
        '</div>' + rackSvg(line.level_no, posOf(line), stackOf(line)) + '</div>' +
      '<div class="k-card k-card--pad k-stack" id="ps-unit"></div>' +
      '<div data-wrong></div>' +
      (manual ? scanAltHtml() : '<div data-scan></div>') +
      // Two problems side by side; the labels may wrap on a narrow phone.
      '<div class="k-actionbar"><div class="k-grid2">' +
        '<button type="button" class="k-btn k-btn--problem k-btn--lg k-btn--block" style="white-space:normal;padding:0 10px" data-missing>' + icon('warn', 22) +
          bis('Barang tidak ada', 'Item missing') + '</button>' +
        '<button type="button" class="k-btn k-btn--problem k-btn--lg k-btn--block" style="white-space:normal;padding:0 10px" data-damaged>' + icon('box', 22) +
          bis('Barang rusak', 'Item damaged') + '</button></div></div>';
    A.sw = startWatch(h, task.assigned_at || task.claimed_at);
    A.tapUnit = (btn) => tapUnit(task, line, btn);
    paintUnit(line);
    A.zone = S.scan((code, z) => scanUnit(task, line, code, z), {
      title: ['Pindai unit ke-' + (line.qty_picked + 1), 'Scan unit ' + (line.qty_picked + 1)], mount: h.querySelector('[data-scan]'),
    });
    h.querySelector('[data-missing]').addEventListener('click', () => renderShort(task, line));
    h.querySelector('[data-damaged]').addEventListener('click', () => renderDamaged(task, line));
    wireStop(h, task);
    paint(h);
  }
  function posOf(line) {
    const m = /-(\d+)[BMT]?$/.exec(line.location_short || '');
    return m ? +m[1] : null;
  }
  /* B, M or T when the bin is one of a stack (A-2-03B), else null. */
  function stackOf(line) {
    const m = /-\d+-\d+([BMT])$/.exec(line.location_short || line.location_code || '');
    return m ? m[1] : null;
  }
  function paintUnit(line) {
    const el = document.getElementById('ps-unit');
    if (!el) return;
    const need = line.qty_required, got = line.qty_picked;
    const dots = need <= 15 ? '<div class="k-dots">' + Array.from({ length: need }, (_, i) =>
      '<span class="k-dot' + (i < got ? ' is-done' : '') + '">' + (i < got ? icon('check', 18, 3) : '') + '</span>').join('') + '</div>' : '';
    if (manualOn()) {
      // Mode manual: the photo, name and size big, then one tap per unit.
      el.innerHTML =
        '<div style="display:flex;gap:14px;align-items:center">' + photo(line.photo_key, 'xl') +
          '<div class="k-stack k-stack--tight">' +
          (line.is_replacement ? '<span class="k-tag k-tag--wrap">' + esc(t('Pengganti', 'Replacement')) + (line.replaces_sku_name ? ' · ' + esc(line.replaces_sku_name) : '') + '</span>' : '') +
          '<span class="k-strong" style="font-size:20px;line-height:1.3">' + esc(line.sku_name) + '</span>' +
          (line.unit_size ? '<span class="ps-big">' + esc(line.unit_size) + '</span>' : '') + '</div></div>' +
        '<div class="ps-take">' + bis('Ambil', 'Take') + '<b>' + need + '</b>' + bis('unit dari depan', need === 1 ? 'unit from the front' : 'units from the front') + '</div>' +
        bis('Pastikan produknya sama dengan foto, lalu ketuk sekali untuk setiap unit.', 'Make sure the product matches the photo, then tap once for each unit.', 'k-muted') +
        '<div class="k-line" style="gap:10px;flex-wrap:wrap">' + dots +
          '<span class="k-strong" style="color:var(--ok)" ' + biAttr(got + ' dari ' + need, got + ' of ' + need) + '></span></div>' +
        tapBtnHtml();
      const b = el.querySelector('[data-tap]');
      b.addEventListener('click', () => { if (A.tapUnit) A.tapUnit(b); });
      S.applyLang(el);
      return;
    }
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
  const UNKNOWN_HINT = ['Coba pindai barcode di kemasan satuan, bukan di kardus. Kalau tetap tidak bisa, panggil SPV.',
    'Try the barcode on the single item, not the outer box. If it still fails, call the SPV.'];
  /* One unit through the pick confirm (the pick screen and Barang tidak ada
     both use it). Returns the answer when the unit counted, else null after
     showing why in the scan zone. One key per scan until the server answers:
     a scan whose answer was lost is sent again with the same key, and the
     server replays it. */
  async function confirmScan(line, code, z) {
    let r;
    const sc = 'pick-' + line.id;
    const k = S.scanKey(sc, code);
    try {
      r = await api().post('/pick-lines/' + line.id + '/confirm', { code, qty: 1, idempotency_key: k });
      S.scanDone(sc);
    } catch (e) {
      if (!e.network) S.scanDone(sc);
      z.reject(say(e.message));
      return null;
    }
    wrongItem(null);
    if (!r.accepted) {
      if (r.outcome === 'unknown_code') {
        z.reject(t('Barcode tidak dikenal', 'Barcode not recognised'), t(UNKNOWN_HINT[0], UNKNOWN_HINT[1]));
      } else if (r.outcome === 'wrong_sku' && r.scanned_sku_name) {
        z.reject(t('Salah barang', 'Wrong item'), t('Kembalikan ke bin dan ambil yang benar.', 'Put it back and take the right one.'));
        wrongItem(r);
      } else {
        z.reject(say(r.message));
        S.toast(r.message, 'stop');
      }
      return null;
    }
    line.qty_picked = r.qty_picked;
    return r;
  }
  async function scanUnit(task, line, code, z) {
    const r = await confirmScan(line, code, z);
    if (!r) return;
    z.accept(t('Benar', 'Right'), r.scanned_sku_name || '');
    if (r.line_complete || r.task_complete) {
      setTimeout(() => renderPick().catch(S.fail), 350);
    } else {
      paintUnit(line);
      z.setTitle('Pindai unit ke-' + (line.qty_picked + 1), 'Scan unit ' + (line.qty_picked + 1));
    }
  }
  /* Mode manual: one tap books one unit through the same confirm, with
     manual: true and no code. The button stays off until the answer, so taps
     never overlap. One key per tap until the server answers (S.scanKey, code
     'tap'): a tap whose answer was lost is sent again with the same key and
     the server replays it instead of booking a second unit. Returns the answer
     when the unit counted, else null after saying why. */
  async function confirmTap(line, btn) {
    if (!btn || btn.disabled) return null;
    btn.disabled = true;
    const sc = 'pick-tap-' + line.id;
    const k = S.scanKey(sc, 'tap');
    let r;
    try {
      r = await api().post('/pick-lines/' + line.id + '/confirm', { manual: true, qty: 1, idempotency_key: k });
      S.scanDone(sc);
    } catch (e) {
      if (!e.network) S.scanDone(sc);
      btn.disabled = false;
      S.fail(e);
      // Mode manual may have ended: the poll redraws the screen for scanning.
      if (!e.network) pollMe(false);
      return null;
    }
    wrongItem(null);
    if (!r.accepted) {
      btn.disabled = false;
      S.toast(r.message, 'stop');
      return null;
    }
    line.qty_picked = r.qty_picked;
    // A finished line stays off until the next screen draws.
    if (!r.line_complete && !r.task_complete) btn.disabled = false;
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* no vibration */ }
    return r;
  }
  async function tapUnit(task, line, btn) {
    const r = await confirmTap(line, btn);
    if (!r) return;
    if (r.line_complete || r.task_complete) {
      S.toast(['Lengkap: ' + line.sku_name, 'Complete: ' + line.sku_name], 'ok');
      setTimeout(() => renderPick().catch(S.fail), 350);
    } else {
      paintUnit(line);
      if (A.zone) A.zone.setTitle('Pindai unit ke-' + (line.qty_picked + 1), 'Scan unit ' + (line.qty_picked + 1));
    }
  }
  /* Salah barang, inline above the scan zone: what was scanned next to what
     the order wants. It stays until the next scan. */
  function wrongItem(r) {
    const el = document.querySelector('#ps-ambil [data-wrong]');
    if (!el) return;
    if (!r) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="k-grid2">' +
        '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' + bis('Yang Anda pindai', 'You scanned', 'k-eyebrow') +
          '<span class="k-strong">' + esc(r.scanned_sku_name) + '</span></div>' +
        '<div class="k-card k-card--focus k-card--pad k-stack k-stack--tight">' + bis('Pesanan minta', 'The order wants', 'k-eyebrow') +
          '<span class="k-strong">' + esc(r.expected_sku_name || '') + '</span></div></div>';
    S.applyLang(el);
  }

  /* 6d, step 5: not there. How many were there, and the other places. */
  /* 6d, step 5: not all there. Every unit that is in the bin is scanned (a
     normal pick, it goes in the basket); no typed counts. Each other place on
     record is either "Ketemu, ambil di sini" or "Kosong, sudah dicek" before
     the rest can be recorded as missing. In Mode manual each unit found in
     the bin is the same tap as on the pick screen. */
  async function renderShort(task, line) {
    A.hold = true;
    const h = host();
    try { await api().post('/pick-tasks/' + task.id + '/start', {}); } catch (e) { /* already started */ }
    let places = [], ins = null;
    try { places = (await api().get('/hiryu/pick-lines/' + line.id + '/elsewhere')).places || []; } catch (e) { /* none */ }
    try { ins = await api().get('/pick-lines/' + line.id + '/instruction'); } catch (e) { ins = { type: null, effective: 'cancel_order' }; }
    const need = line.qty_required - line.qty_picked;
    const here = line.location_short || line.location_code || '?';
    const empty = new Set();
    const manual = manualOn();
    let scanned = 0;
    S.fullScreen(true, { title: ['Barang tidak ada', 'Item missing'], onBack: () => { A.hold = false; renderPick().catch(S.fail); } });
    h.innerHTML = headCard(task) + stopBtnHtml() +
      '<div class="k-card k-card--pad k-stack">' +
        '<div style="display:flex;gap:12px;align-items:center">' + photo(line.photo_key, manual ? 'xl' : true) +
          '<span class="k-stack k-stack--tight"><span class="k-strong">' + esc(line.sku_name) + '</span>' +
          (manual && line.unit_size ? '<span class="k-strong k-muted">' + esc(line.unit_size) + '</span>' : '') + '</span></div>' +
        (manual
          ? '<span class="ps-big" ' + biAttr('Ketuk sekali untuk setiap unit yang ada di bin ' + here, 'Tap once for each unit that is in bin ' + here) + '></span>'
          : '<span class="ps-big" ' + biAttr('Pindai unit yang ada di bin ' + here, 'Scan the units that are in bin ' + here) + '></span>') +
        bis('Setiap unit yang ketemu masuk keranjang. Tidak ada lagi? Catat di bawah.', 'Every unit you find goes in the basket. No more? Record it below.', 'k-muted') +
        '<span data-found></span>' +
        (manual ? tapBtnHtml() : '') +
      '</div>' +
      '<div data-wrong></div>' +
      (manual ? scanAltHtml() : '<div data-scan></div>') +
      (places.length
        ? '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          bis('Cek juga tempat lain yang tercatat', 'Check the other places on record', 'k-eyebrow') +
          '<div>' + places.map((p) =>
            '<div class="ps-place"><span class="ps-place__code">' + esc(shortBin(p.location_code)) + '</span>' +
            '<span class="k-muted k-grow" ' + biAttr('tercatat ' + p.free, p.free + ' on record') + '></span>' +
            '<button type="button" class="k-btn k-btn--secondary k-btn--sm" data-move="' + p.location_id + '">' + bis('Ketemu, ambil di sini', 'Found, pick here') + '</button>' +
            '<button type="button" class="k-btn k-btn--outline k-btn--sm" data-empty="' + p.location_id + '" aria-pressed="false">' + bis('Kosong, sudah dicek', 'Empty, checked') + '</button></div>').join('') +
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
        '<span class="k-caption" data-why hidden>' + bis('Cek dulu semua tempat lain.', 'Check every other place first.') + '</span>' +
        '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-record>' + bis('Catat: tidak ada', 'Record: missing') + '</button>' +
        '<button type="button" class="k-btn k-btn--ghost k-btn--block" data-back>' + bis('Kembali ambil', 'Back to picking') + '</button></div>';
    startWatch(h, task.assigned_at || task.claimed_at);
    wireStop(h, task);
    const rec = h.querySelector('[data-record]'), why = h.querySelector('[data-why]'), foundEl = h.querySelector('[data-found]');
    function update() {
      // "Ketemu 1 dari 3": units scanned here of what was still wanted.
      foundEl.innerHTML = S.pill(scanned ? 'ok' : 'info', 'Ketemu ' + scanned + ' dari ' + need, 'Found ' + scanned + ' of ' + need);
      const open = places.filter((p) => !empty.has(p.location_id)).length;
      rec.disabled = open > 0;
      why.hidden = open === 0;
      h.querySelectorAll('[data-empty]').forEach((b) => {
        const on = empty.has(+b.dataset.empty);
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('k-btn--secondary', on);
        b.classList.toggle('k-btn--outline', !on);
      });
    }
    // A unit found in the bin, scanned or tapped.
    function found(r) {
      scanned += 1;
      update();
      // Everything wanted was there after all: no shortfall, carry on.
      if (r.line_complete || r.task_complete) {
        S.toast(['Lengkap. Lanjut ambil.', 'Complete. Carry on picking.'], 'ok');
        A.hold = false;
        setTimeout(() => renderPick().catch(S.fail), 350);
      }
    }
    S.scan(async (code, z) => {
      const r = await confirmScan(line, code, z);
      if (!r) return;
      z.accept(t('Ketemu', 'Found'), r.scanned_sku_name || '');
      found(r);
    }, { title: ['Pindai unit yang ada di bin ' + here, 'Scan the units that are in bin ' + here], mount: h.querySelector('[data-scan]') });
    const tap = h.querySelector('[data-tap]');
    if (tap) tap.addEventListener('click', async () => {
      const r = await confirmTap(line, tap);
      if (r) found(r);
    });
    h.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r = await api().post('/hiryu/pick-lines/' + line.id + '/move', { location_id: +b.dataset.move });
        S.toast(r.message, 'ok');
        A.hold = false;
        await renderPick();
      } catch (e) { S.fail(e); }
    }));
    h.querySelectorAll('[data-empty]').forEach((b) => b.addEventListener('click', () => {
      const id = +b.dataset.empty;
      if (empty.has(id)) empty.delete(id); else empty.add(id);
      update();
    }));
    h.querySelector('[data-back]').addEventListener('click', () => { A.hold = false; renderPick().catch(S.fail); });
    rec.addEventListener('click', async () => {
      if (ins.effective === 'cancel_order') {
        const ok = await S.confirm({
          title: ['Batalkan pesanan?', 'Cancel the order?'],
          text: ['Pesanan ' + label(task) + ' akan dibatalkan dan dikirim ke Hiryu.', 'Order ' + label(task) + ' will be cancelled and Hiryu told.'],
          ok: ['Ya, batalkan', 'Yes, cancel'], danger: true,
        });
        if (!ok) return;
      }
      rec.disabled = true;
      // The scanned units are already picked: the bin holds 0 of the rest,
      // and so does every other place marked empty.
      const found = { [here]: 0 };
      const checked = places.filter((p) => empty.has(p.location_id)).map((p) => {
        found[shortBin(p.location_code)] = 0;
        return { location_id: p.location_id, qty_found: 0 };
      });
      try {
        const r = await api().post('/pick-lines/' + line.id + '/short', { qty_found: 0, checked });
        await afterShort(r, line, found, false, scanned);
      } catch (e) { S.fail(e); update(); }
    });
    update();
    paint(h);
  }
  const shortBin = (code) => {
    const p = String(code || '').split('-');
    return p.length >= 4 ? p.slice(1).join('-') : code;
  };

  /* damaged: from Barang rusak, when no good unit is left anywhere. The bins
     were right, so there is nothing about bins to say. */
  async function afterShort(r, line, found, damaged, scanned) {
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
    const today = r.bins_today || [];
    // Same-day check: the bin is on today's count plan when the server put it there.
    const tail = today.length
      ? ['Bin ' + today.join(', ') + ' masuk hitung stok hari ini; SPV menetapkan penghitungnya.',
        'Bin ' + today.join(', ') + " is on today's stock count; the SPV assigns the counter."]
      : allZero
        ? [codes.length + ' bin jadi 0, masuk hitung stok berikutnya.', codes.length + (codes.length === 1 ? ' bin is now 0' : ' bins are now 0') + ', on the next count.']
        : ['Bin dicatat sesuai yang ditemukan, masuk hitung stok berikutnya.', 'Bins set to what was found, on the next count.'];
    // Units scanned on the missing screen count as found.
    const got = scanned == null ? r.qty_found : scanned + r.qty_found;
    const ins = r.instruction || {};
    const replaced = r.action === 'replaced';
    S.fullScreen(true, { title: ['Ambil pesanan', 'Pick the order'],
      onBack: () => S.fullScreen(false) });
    h.innerHTML = headCard(task) +
      '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
        (damaged
          ? '<span>' + S.pill('stop', 'Rusak: tidak ada unit lain yang baik', 'Damaged: no other good unit') + '</span>' +
            '<span class="k-strong" style="font-size:17px">' + esc(line.sku_name) + '</span>' +
            bis('Unit rusak sudah di baki karantina. Stok baik untuk produk ini habis di dark store.',
              'The damaged unit is in the quarantine tray. No good stock of this product is left in the dark store.', 'k-muted')
          : '<span>' + S.pill('stop', 'Tidak ada: ketemu ' + got + ' dari ' + (got + r.qty_missing), 'Missing: found ' + got + ' of ' + (got + r.qty_missing)) + '</span>' +
            '<span class="k-strong" style="font-size:17px">' + esc(line.sku_name) + '</span>' +
            '<span class="k-muted" ' + biAttr(binsText + '. ' + tail[0], binsEn + '. ' + tail[1]) + '></span>') +
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

  /* 6c, Barang rusak: the unit is there but damaged or leaking. Scan it, say
     why, a photo if there is time, put it in the quarantine tray and scan the
     tray label. The WMS then holds a good unit: from the same bin, from
     another bin, or the customer's instruction when none is left. In Mode
     manual the damaged unit is confirmed by a tap ("Unit rusak ini dari bin
     X") and the tray is tapped from the list; the server marks it manual. */
  async function renderDamaged(task, line) {
    A.hold = true;
    const h = host();
    let trays = [];
    try { trays = (await api().get('/quarantine/trays' + qs({ site_id: A.ctx.siteId }))).trays || []; } catch (e) { /* the server names it on a wrong scan */ }
    const tray = trays[0] || '';
    const manual = manualOn();
    const here = line.location_short || line.location_code || '?';
    // unit: the scanned code; tapped: confirmed by a tap instead (Mode manual).
    const st = { unit: null, tapped: false, reason: 'rusak', photo: null, photoUrl: null, busy: false };
    const back = () => { A.hold = false; renderPick().catch(S.fail); };
    S.fullScreen(true, { title: ['Barang rusak', 'Item damaged'], onBack: back });
    const stepCard = (no, title, done, on, body) =>
      '<div class="k-card k-card--pad k-stack k-stack--tight"' + (on ? '' : ' style="opacity:.55"') + '>' +
        '<div class="ps-step"><span class="ps-step__no' + (done ? ' ps-step__no--ok' : '') + '">' + (done ? icon('check', 18, 3) : no) + '</span>' +
        '<span class="k-strong" style="align-self:center">' + bis(title[0], title[1]) + '</span></div>' + (body || '') + '</div>';
    function draw() {
      const on = !!st.unit || st.tapped;
      const step1 = on
        ? (st.tapped ? ['Unit rusak dari bin ' + here, 'Damaged unit from bin ' + here] : ['Unit rusak dipindai', 'Damaged unit scanned'])
        : manual ? ['Pastikan unit rusak sama dengan foto', 'Make sure the damaged unit matches the photo'] : ['Pindai unit yang rusak', 'Scan the damaged unit'];
      h.innerHTML = headCard(task) +
        '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          '<div style="display:flex;gap:12px;align-items:center">' + photo(line.photo_key, manual && !on ? 'xl' : true) +
            '<span class="k-stack k-stack--tight"><span class="k-strong">' + esc(line.sku_name) + '</span>' +
            (manual && line.unit_size ? '<span class="k-strong k-muted">' + esc(line.unit_size) + '</span>' : '') + '</span></div>' +
          bis('Unit ada tapi rusak atau bocor? Jangan masukkan ke keranjang.', 'The unit is there but damaged or leaking? Keep it out of the basket.', 'k-muted') +
        '</div>' +
        stepCard(1, step1, on, true,
          on ? '' : manual
            ? '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block ps-tap" data-unit-tap>' + icon('check', 24, 2.4) +
              bis('Unit rusak ini dari bin ' + here, 'This damaged unit is from bin ' + here) + '</button>' + scanAltHtml()
            : '<div data-scan></div>') +
        stepCard(2, ['Kenapa?', 'Why?'], false, on,
          '<div class="k-segment" role="group">' + [['rusak', 'Rusak', 'Damaged'], ['bocor', 'Bocor', 'Leaking']].map((x) =>
            '<button type="button" data-reason="' + x[0] + '" aria-pressed="' + (st.reason === x[0]) + '"' + (on ? '' : ' disabled') + '>' + bis(x[1], x[2]) + '</button>').join('') + '</div>') +
        stepCard(3, ['Foto, kalau sempat', 'Photo, if there is time'], !!st.photo, on,
          '<div class="k-line" style="gap:12px">' + (st.photoUrl ? '<span class="ps-photo ps-photo--sm"><img alt="" src="' + esc(st.photoUrl) + '"></span>' : '') +
          '<label class="k-btn k-btn--secondary k-btn--sm"' + (on ? '' : ' aria-disabled="true"') + '>' + icon('camera', 16) +
            (st.photo ? bis('Ulangi foto', 'Retake') : bis('Ambil foto', 'Take a photo')) +
            '<input type="file" accept="image/*" capture="environment" data-photo hidden' + (on ? '' : ' disabled') + '></label></div>') +
        stepCard(4, ['Taruh di baki karantina', 'Put it in the quarantine tray'], false, on,
          (manual
            // Mode manual: tap the tray the unit went into; the tap books it.
            ? bis('Taruh unit di baki, lalu ketuk bakinya. Unit langsung tidak dijual di Grab.',
                'Put the unit in the tray, then tap that tray. It stops selling on Grab at once.', 'k-muted') +
              (trays.length
                ? '<div class="ps-taps">' + trays.map((c) => '<button type="button" class="k-btn k-btn--secondary k-btn--lg" data-tray="' + esc(c) + '"' +
                    (on ? '' : ' disabled') + '>' + icon('box', 22) + esc(c) + '</button>').join('') + '</div>'
                : bis('Daftar baki tidak termuat. Pindai label baki di bawah.', 'The tray list did not load. Scan the tray label below.', 'k-strong')) +
              (on ? scanAltHtml() : '')
            : '<div class="k-target" style="padding:14px"><div class="k-target__text">' + bis('Ke baki', 'To tray', 'k-target__label') +
              '<span class="k-target__code k-target__code--md">' + esc(tray || '?') + '</span>' +
              bis('Taruh unit di baki, lalu pindai label baki. Unit langsung tidak dijual di Grab.',
                'Put the unit in the tray, then scan the tray label. It stops selling on Grab at once.', 'k-target__hint') + '</div></div>' +
              (on ? '<div data-scan></div>' : ''))) +
        '<div class="k-actionbar"><button type="button" class="k-btn k-btn--ghost k-btn--block" data-back>' + bis('Kembali ambil', 'Back to picking') + '</button></div>';
      startWatch(h, task.assigned_at || task.claimed_at);
      S.scan(on ? onTray : onUnit, {
        title: on ? ['Pindai label baki ' + tray, 'Scan tray label ' + tray] : ['Pindai unit yang rusak', 'Scan the damaged unit'],
        mount: h.querySelector('[data-scan]'),
      });
      h.querySelectorAll('[data-reason]').forEach((b) => b.addEventListener('click', () => { st.reason = b.dataset.reason; draw(); }));
      const ut = h.querySelector('[data-unit-tap]');
      // Step 1 by a tap: nothing is booked yet, the tray tap books it.
      if (ut) ut.addEventListener('click', () => { st.tapped = true; st.unit = null; draw(); });
      h.querySelectorAll('[data-tray]').forEach((b) => b.addEventListener('click', () => onTrayTap(b)));
      const ph = h.querySelector('[data-photo]');
      if (ph) ph.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        st.photo = f;
        try { st.photoUrl = URL.createObjectURL(f); } catch (err) { st.photoUrl = null; }
        draw();
      });
      h.querySelector('[data-back]').addEventListener('click', back);
      paint(h);
    }
    // Step 1: the unit in hand must be this product (read only, nothing is booked yet).
    async function onUnit(code, z) {
      let r;
      try { r = await api().get('/quarantine/lookup' + qs({ site_id: A.ctx.siteId, code })); }
      catch (e) {
        if (e.status === 422) z.reject(t('Barcode tidak dikenal', 'Barcode not recognised'), t(UNKNOWN_HINT[0], UNKNOWN_HINT[1]));
        else z.reject(say(e.message));
        return;
      }
      if (r.sku_id !== line.sku_id) {
        z.reject(t('Salah barang', 'Wrong item'), t('Ini ' + r.sku_name + '. Pindai ' + line.sku_name + ' yang rusak.',
          'This is ' + r.sku_name + '. Scan the damaged ' + line.sku_name + '.'));
        return;
      }
      z.accept(t('Cocok', 'Match'));
      st.unit = code;
      setTimeout(draw, 300);
    }
    // Step 4: the tray label (or, in Mode manual, the tray tap) books it.
    // One key until the server answers; a tapped unit has the code 'tap'.
    async function sendDamaged(trayCode, manualTap) {
      const sc = 'damaged-' + line.id;
      const k = S.scanKey(sc, (st.unit || 'tap') + '|' + trayCode);
      const fd = new FormData();
      if (st.unit) fd.append('code', st.unit);
      fd.append('tray_code', trayCode);
      fd.append('reason', st.reason);
      fd.append('idempotency_key', k);
      if (manualTap || st.tapped) fd.append('manual', 'true');
      if (st.photo) fd.append('photo', st.photo);
      try {
        const r = await api().form('/pick-lines/' + line.id + '/damaged', fd);
        S.scanDone(sc);
        return r;
      } catch (e) {
        if (!e.network) S.scanDone(sc);
        throw e;
      }
    }
    async function onTray(code, z) {
      if (st.busy) return;
      st.busy = true;
      let r;
      try { r = await sendDamaged(code, false); }
      catch (e) {
        st.busy = false;
        z.reject(say(e.message));
        return;
      }
      z.accept(t('Di baki karantina', 'In the quarantine tray'));
      setTimeout(() => afterDamaged(r, line).catch(S.fail), 300);
    }
    // Every tray button stays off until the answer: one booking at a time.
    async function onTrayTap(btn) {
      if (st.busy || btn.disabled) return;
      st.busy = true;
      const all = h.querySelectorAll('[data-tray]');
      all.forEach((x) => { x.disabled = true; });
      let r;
      try { r = await sendDamaged(btn.dataset.tray, true); }
      catch (e) {
        st.busy = false;
        all.forEach((x) => { x.disabled = false; });
        S.fail(e);
        return;
      }
      S.toast(['Di baki karantina ' + btn.dataset.tray, 'In quarantine tray ' + btn.dataset.tray], 'ok');
      afterDamaged(r, line).catch(S.fail);
    }
    draw();
  }

  async function afterDamaged(r, line) {
    if (r.outcome === 'short' && r.short) return afterShort(r.short, line, {}, true);
    if (r.outcome !== 'other_bin') {
      // Same bin: straight back to scanning.
      S.toast(r.message, 'ok');
      A.hold = false;
      return renderPick();
    }
    const h = host(), task = r.task;
    A.lastTask = task;
    h.innerHTML = headCard(task) +
      '<div class="k-card k-card--pad k-stack k-stack--tight">' +
        '<span>' + S.pill('ok', 'Di karantina', 'In quarantine') + '</span>' +
        '<span class="k-strong" style="font-size:17px">' + esc(line.sku_name) + '</span>' +
        '<span class="k-muted" ' + biAttr('Unit rusak ada di baki ' + r.tray_code + '. Bin ini tidak punya unit baik lagi.',
          'The damaged unit is in tray ' + r.tray_code + '. This bin has no other good unit.') + '></span>' +
      '</div>' +
      '<div class="k-target"><div class="k-target__text">' + bis('Ambil pengganti di bin', 'Take a good one from bin', 'k-target__label') +
        '<span class="k-target__code">' + esc(r.location_short || '?') + '</span>' +
        (r.location_words ? '<span class="k-target__hint">' + esc(r.location_words) + '</span>' : '') + '</div></div>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-go>' + icon('arrow', 22, 2.2) +
        bis('Lanjut ambil', 'Carry on picking') + '</button></div>';
    startWatch(h, task.assigned_at || task.claimed_at);
    h.querySelector('[data-go]').addEventListener('click', () => { A.hold = false; renderPick().catch(S.fail); });
    paint(h);
  }

  /* Berhenti ambil pesanan ini: the picker stops the order they hold, also
     after the first scan. A reason is required. Units already in the basket
     stay with the order: the basket goes to the pack bench and the next
     picker carries on from it. Afterwards the picker is on Istirahat, so the
     same order does not come straight back. */
  const STOP_REASONS = [
    ['Dipanggil SPV atau ada tugas lain', 'Called by the SPV or another task'],
    ['HP atau baterai bermasalah', 'Phone or battery problem'],
    ['Sakit atau darurat', 'Ill or an emergency'],
    ['Lainnya', 'Other'],
  ];
  const stopBtnHtml = () => '<button type="button" class="k-btn k-btn--ghost k-btn--sm" style="align-self:flex-end" data-stop>' +
    icon('close', 16) + bis('Berhenti ambil pesanan ini', 'Stop picking this order') + '</button>';
  function wireStop(root, task) {
    const b = root.querySelector('[data-stop]');
    if (b) b.addEventListener('click', () => stopOrder(task).catch(S.fail));
  }
  async function stopOrder(task) {
    const me = A.me;
    if (!me || !me.task_id) return;
    if (!task || task.id !== me.task_id) {
      try { task = await api().get('/pick-tasks/' + me.task_id); } catch (e) { task = null; }
    }
    const gm = (task && label(task)) || me.order_ref || '-';
    const basket = (task && task.basket_code) || me.basket_code || null;
    const units = task ? task.lines.reduce((a, l) => a + (l.qty_picked || 0), 0) : 0;
    const what = units && basket
      ? ['Taruh keranjang ' + basket + ' di meja kemas dan beri tahu SPV. Picker berikutnya melanjutkan dari barang yang belum diambil.',
        'Put basket ' + basket + ' on the pack bench and tell the SPV. The next picker carries on from what is still to pick.']
      : basket
        ? ['Keranjang ' + basket + ' masih kosong: kembalikan ke tempat keranjang. Pesanan kembali ke antrean.',
          'Basket ' + basket + ' is still empty: put it back with the baskets. The order goes back to the queue.']
        : ['Belum ada yang dipindai. Pesanan kembali ke antrean.', 'Nothing was scanned yet. The order goes back to the queue.'];
    const body = document.createElement('div');
    body.className = 'k-stack';
    body.innerHTML =
      '<div class="k-note' + (units ? ' k-note--caution' : '') + '">' + icon(units ? 'basket' : 'info', 20) + bis(what[0], what[1]) + '</div>' +
      '<div class="k-field"><span class="k-field__label">' + bis('Kenapa berhenti?', 'Why do you stop?') + '</span><div class="ps-opts">' +
        STOP_REASONS.map((r, i) => '<label class="ps-opt"><input type="radio" name="ps-stop" value="' + i + '"><span>' + bis(r[0], r[1]) + '</span></label>').join('') +
      '</div></div>' +
      '<label class="k-field" data-otherwrap hidden><span class="k-field__label">' + bis('Tulis alasannya', 'Write the reason') + '</span>' +
        '<input class="k-input" data-other maxlength="120"><span class="k-field__hint">' + bis('Paling sedikit 5 huruf.', 'At least 5 characters.') + '</span></label>' +
      '<p class="k-caption">' + bis('Setelah ini Anda istirahat. Nyalakan Siap ambil saat siap lagi.', 'After this you are on a break. Switch on Ready to pick when you are ready again.') + '</p>';
    body.querySelectorAll('input[name="ps-stop"]').forEach((r) => r.addEventListener('change', () => {
      body.querySelector('[data-otherwrap]').hidden = r.value !== String(STOP_REASONS.length - 1) || !r.checked;
    }));
    S.modal({
      title: ['Berhenti ambil ' + gm + '?', 'Stop picking ' + gm + '?'], body,
      actions: [
        { label: ['Lanjut ambil', 'Keep picking'], kind: 'secondary' },
        {
          label: ['Ya, berhenti', 'Yes, stop'], kind: 'primary',
          onClick: async () => {
            const sel = body.querySelector('input[name="ps-stop"]:checked');
            if (!sel) { S.toast(['Pilih alasannya.', 'Choose a reason.'], 'caution'); return false; }
            let reason = STOP_REASONS[+sel.value][0];
            if (+sel.value === STOP_REASONS.length - 1) {
              reason = (body.querySelector('[data-other]').value || '').trim();
              if (reason.length < 5) { S.toast(['Tulis alasannya, paling sedikit 5 huruf.', 'Write the reason, at least 5 characters.'], 'caution'); return false; }
            }
            await api().post('/pick-tasks/' + me.task_id + '/release', { reason });
            S.toast([gm + ' kembali ke antrean.', gm + ' went back to the queue.'], 'ok');
            A.hold = false;
            A.sig = null;
            resetFull();
            await pollMe(true);
          },
        },
      ],
    });
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
        biAttr('Taruh keranjang ' + (task.basket_code || '') + ' di meja kemas, lalu tekan tombol di bawah.', 'Put basket ' + (task.basket_code || '') + ' on the pack bench, then press the button below.') + '></span>' +
        bis('Pesanan berikutnya datang sendiri.', 'The next order comes by itself.', 'k-muted') + '</div>' +
      '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-hand>' + icon('arrow', 22, 2.2) +
        bis('Serahkan ke meja kemas', 'Hand to the pack bench') + '</button></div>';
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
    wake(false);
    S.setTitle('Pesanan', 'Orders');
    resetFull();
    if (needSite(ctx)) return;
    const id = ctx.params.get('pack');
    if (id) return packDetail(ctx, +id);
    S.setSub('Keranjang dari picker menunggu di meja kemas. Ambil yang paling atas: paling lama menunggu.',
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
          '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-bench="' + o.order_id + '">' + bis('Sudah dibawa kembali ke meja kemas', 'Back at the pack bench') + '</button></div></div>').join('') +
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
            bis('Keranjang muncul di sini saat picker menekan Serahkan ke meja kemas.', 'Baskets appear here when a picker taps Hand to the pack bench.', 'k-empty__text') + '</div>');
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
    ctx.every(1000, tickClocks);
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
      // The 10-minute target shows while the order is still to pack.
      const live = !cancelled && !packedAlready;
      // Units picked by a tap in Mode manual: no scan checked them, so the
      // packer checks those lines one by one with extra care.
      const manualN = d.manual_units || 0;
      // One tick for all lines, only when nothing was replaced, removed or
      // changed, and every unit was scanned.
      const plain = !d.has_changes && !d.lines.some((l) => l.is_replacement) && !manualN;
      syncClock(d.server_time);
      const consumable = PACK[chosen] || PACK.bag;
      ctx.body.innerHTML =
        '<div class="ps-crumb"><a href="pesanan.html?tab=kemas" data-list>' + bis('Pesanan', 'Orders') + '</a><span>/</span>' +
          '<a href="pesanan.html?tab=kemas" data-list>' + bis('Kemas', 'Pack') + '</a><span>/</span><span>' + esc(d.short_no) + '</span></div>' +
        '<div class="k-line k-line--between k-phone-only"><span class="ps-gm">' + esc(d.short_no) + ' ' + chips(d) + '</span><div data-sw></div></div>' +
        (live ? '<div class="k-phone-only">' + readyByHtml(d.ready_by) + '</div>' : '') +
        (chips(d) ? '<div class="k-laptop-only">' + chips(d) + '</div>' : '') +
        (cancelled ? '<div class="k-note k-note--stop">' + icon('warn', 20) + bis('Pesanan ini dibatalkan: jangan dikemas. Kembalikan barangnya ke rak.', 'This order was cancelled: do not pack it. Put the units back on the rack.') + '</div>' : '') +
        '<div class="ps-packgrid">' +
        '<div class="k-card k-card--pad k-stack">' +
          '<div class="k-line k-line--between" style="align-items:flex-start;gap:12px"><div class="k-stack k-stack--tight">' +
            bis('Periksa barang', 'Check the items', 'k-h2') + bis('Cocokkan isi keranjang dengan daftar. Centang tiap baris.', 'Match the basket with the list. Tick each line.', 'k-muted') + '</div>' +
            '<span data-count></span></div>' +
          '<div class="k-note k-note--ok">' + icon('check', 20) + '<span ' + biAttr(
            'Cocok dengan pesanan Hiryu: ' + productsWord(d.products)[0] + ', ' + unitsWord(d.units)[0] + (d.replaced ? ' (' + d.replaced + ' diganti)' : '') + (manualN ? '' : ', semua dipindai saat diambil'),
            'Matches the Hiryu order: ' + productsWord(d.products)[1] + ', ' + unitsWord(d.units)[1] + (d.replaced ? ' (' + d.replaced + ' replaced)' : '') + (manualN ? '' : ', all scanned at picking')) + '></span></div>' +
          (manualN ? '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span ' + biAttr(
            'Diambil tanpa pindai: ' + manualN + ' unit. Cocokkan barang ini dengan foto dengan teliti.',
            'Picked without scanning: ' + manualN + (manualN === 1 ? ' unit' : ' units') + '. Check these items against the photo with extra care.') + '></span></div>' : '') +
          (plain && !cancelled ? '<label class="ps-all" data-allrow><input type="checkbox" data-all ' + biAttrAria('Semua cocok', 'All match') + '>' +
            bis('Semua cocok', 'All match') + '</label>' : '') +
          '<div class="ps-checks"><div class="ps-checks__head"><span>' + esc(t('Foto', 'Photo')) + '</span><span>' + esc(t('Produk', 'Product')) + '</span><span>' + esc(t('Jumlah', 'Qty')) + '</span><span>OK</span></div>' +
          d.lines.map((l, i) => {
            const kg = (l.unit_weight_g / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
            const kgEn = (l.unit_weight_g / 1000).toLocaleString('en-GB', { maximumFractionDigits: 2 });
            return '<label class="ps-checkrow" data-row="' + i + '">' + photo(l.photo_key, true) +
              '<span class="k-stack k-stack--tight"><span class="k-strong">' + esc(l.sku_name) + '</span>' +
              '<span class="k-caption" ' + biAttr((l.large_bottle ? 'Botol besar · ' : '') + kg + ' kg per unit' + (l.estimated ? ' (perkiraan)' : ''),
                (l.large_bottle ? 'Large bottle · ' : '') + kgEn + ' kg per unit' + (l.estimated ? ' (estimate)' : '')) + '></span>' +
              (l.is_replacement ? '<span class="k-tag k-tag--wrap" ' + biAttr('Pengganti ' + (l.replaces_sku_name || '') + (l.replaces_units ? ' · ' + l.replaces_units : ''),
                'Replaces ' + (l.replaces_sku_name || '') + (l.replaces_units ? ' · ' + l.replaces_units : '')) + '></span>' : '') +
              (l.manual_units ? '<span class="ps-chip ps-chip--manual" style="align-self:flex-start" ' + biAttr('Tanpa pindai: ' + l.manual_units + ' unit',
                'Not scanned: ' + l.manual_units + (l.manual_units === 1 ? ' unit' : ' units')) + '></span>' : '') + '</span>' +
              '<span class="k-strong"><span class="ps-mono" style="font-size:20px">' + l.units + '</span> ' + esc(t('unit', l.units === 1 ? 'unit' : 'units')) + '</span>' +
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
      ctx.actions.innerHTML = (live ? '<div class="k-laptop-only" style="align-self:center">' + readyByHtml(d.ready_by) + '</div>' : '') +
        '<div data-sw class="k-laptop-only"></div>';
      [ctx.body.querySelector('[data-sw]'), ctx.actions.querySelector('[data-sw]')].forEach((el) => {
        if (!el) return;
        const w = S.stopwatch(el, d.pack_started_at);
        if (packedAlready) w.stop();
      });
      const rows = ctx.body.querySelectorAll('[data-row]');
      const input = ctx.body.querySelector('#ps-gm-in'), box = ctx.body.querySelector('[data-gmbox]');
      const match = ctx.body.querySelector('[data-match]'), done = ctx.body.querySelector('[data-done]');
      const countEl = ctx.body.querySelector('[data-count]');
      const allBox = ctx.body.querySelector('[data-all]');
      function update() {
        rows.forEach((r, i) => { const c = r.querySelector('input').checked; r.classList.toggle('is-checked', c); if (c) checked.add(i); else checked.delete(i); });
        const all = checked.size === d.lines.length;
        if (allBox) { allBox.checked = all; allBox.closest('[data-allrow]').classList.toggle('is-checked', all); }
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
      // Semua cocok ticks (or clears) every line; each line's tick still works.
      if (allBox) allBox.addEventListener('change', () => { rows.forEach((r) => { r.querySelector('input').checked = allBox.checked; }); update(); });
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
    wake(false);
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
          bis('Jangan diserahkan. Bawa kembali ke meja kemas di atas.', 'Do not hand it over. Take it back upstairs to the pack bench.', 'k-strong') +
          '<button type="button" class="k-btn k-btn--secondary k-btn--block" data-bench="' + o.order_id + '">' + icon('undo') + bis('Sudah dibawa kembali ke meja kemas', 'Taken back to the pack bench') + '</button></div>').join('') +
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
    wake(false);
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
    // Why the order last changed hands ("Dilepas oleh Rina: HP bermasalah").
    // Server notes are "Indonesian / English"; older ones are one language.
    const handNote = (c) => {
      if (!c.reassign_note) return '';
      const m = /^(.{6,}?) \/ (.{6,})$/.exec(c.reassign_note);
      return '<span class="ps-card__muted" ' + biAttr(m ? m[1] : c.reassign_note, m ? m[2] : c.reassign_note) + '></span>';
    };
    function card(c, lane) {
      // Manual: at least one unit of this order was picked by a tap (Mode manual).
      const gm = '<span class="ps-card__gm">' + esc(label(c)) + ' ' + chips(c) +
        (c.manual_units ? '<span class="ps-chip ps-chip--manual" ' + biAttr('Manual', 'Manual') + '>Manual</span>' : '') + '</span>';
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
            'In ' + fmt.time(c.order_time || c.created_at) + ' · ready ' + fmt.time(c.promised_at)) + '></span>' + store + handNote(c) + uji + '</div>';
      }
      if (lane === 'picking') {
        const notStarted = !c.started_at;
        return '<div class="ps-card ps-card--focus">' + gm +
          '<span class="ps-card__sub">' + esc(first(c.claimed_by_name || c.claimed_by)) + ' · <span class="ps-mono" data-since="' + esc(c.claimed_at || '') + '">' + fmt.dur(since(c.claimed_at)) + '</span></span>' +
          (c.basket_code ? '<span class="ps-card__muted ps-mono">' + esc(c.basket_code) + '</span>'
            : notStarted ? '<span class="ps-card__muted" ' + biAttr('Belum mulai', 'Not started') + '></span>' : '') +
          (c.requeue_count ? handNote(c) : '') +
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
        pill = S.pill('info', 'Di meja kemas', 'At the pack bench');
        sub = '<span class="ps-card__muted" ' + biAttr('Meja kemas · serah ke driver', 'Pack bench · handover') + '></span>';
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
        : p.state === 'pack' ? ['di meja kemas', 'at the pack bench'] : ['tidak aktif', 'off'];
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
    wake(false);
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
      // Mode manual from the list's answer (live), else the hub in the shell.
      if (g) return returnFlow(ctx, g, load, () => (data && typeof data.manual_mode === 'boolean' ? data.manual_mode : S.manualMode()));
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

  /* manualOn: Mode manual (V32) is on. Then the unit is chosen by a tap in
     the list of what is still to put back, and the bin is confirmed with
     "Sudah dikembalikan ke bin X"; the scan zone stays folded for whoever can
     still scan (the unit in the list step, the bin label in the bin step). */
  function returnFlow(ctx, group, reload, manualOn) {
    const h = document.getElementById('ps-kemb');
    // chosen: the task whose unit was tapped (Mode manual), until it is back.
    let g = group, step = 'unit', unitCode = null, freed = null, chosen = null;
    const exit = () => {
      const u = new URL(location.href);
      u.searchParams.delete('order');
      u.searchParams.delete('rt');
      history.replaceState(null, '', u.pathname + u.search);
      resetFull();
      S.rerender();
    };
    S.fullScreen(true, { title: ['Kembalikan ke rak', 'Put back to rack'], onBack: exit });
    // Units skipped because their product has no bin yet go to the end of the
    // line. They stay on the list for the SPV; the rest carry on.
    const skipped = new Set();
    const queue = () => {
      const open = g.tasks.filter((x) => x.qty > x.qty_returned && x.status === 'open');
      return open.filter((x) => !skipped.has(x.id)).concat(open.filter((x) => skipped.has(x.id)));
    };
    // One unit is back: count it and go to the next.
    function booked(cur, r) {
      if (r.basket_freed) freed = r.basket_freed;
      cur.qty_returned = r.task.qty_returned;
      cur.status = r.task.status;
      g.units_returned += 1;
      step = 'unit'; unitCode = null; chosen = null;
    }
    function draw() {
      const q = queue();
      const total = g.units, done = g.units_returned;
      const manual = manualOn();
      if (!q.length) {
        h.innerHTML = '<div class="k-card k-card--pad k-stack" style="border:2px solid var(--ok)">' + S.pill('ok', 'Selesai', 'Done') +
          '<span class="ps-big">' + bis('Semua sudah kembali di rak.', 'Everything is back on the rack.') + '</span>' +
          (freed ? '<span class="k-muted" ' + biAttr('Keranjang ' + freed + ' kosong dan bisa dipakai lagi.', 'Basket ' + freed + ' is empty and free again.') + '></span>' : '') + '</div>' +
          '<div class="k-actionbar"><a class="k-btn k-btn--primary k-btn--lg k-btn--block" href="pesanan.html?tab=ambil">' + icon('bag', 22) + bis('Kembali ke Ambil pesanan', 'Back to picking') + '</a>' +
          '<button type="button" class="k-btn k-btn--ghost k-btn--block" data-exit>' + bis('Daftar Kembalikan ke rak', 'Put back list') + '</button></div>';
        h.querySelector('[data-exit]').addEventListener('click', exit);
        paint(h); return;
      }
      const tt = groupTitle(g);
      const headHtml =
        '<div class="k-card k-card--pad k-stack k-stack--tight">' +
          '<span>' + reasonPill(g) + '</span>' +
          '<span class="ps-big" ' + biAttr(tt[0], tt[1]) + '></span>' +
          '<div class="ps-prog"><span class="k-strong" style="white-space:nowrap" ' + biAttr('Unit ' + (done + 1) + ' dari ' + total, 'Unit ' + (done + 1) + ' of ' + total) + '></span>' +
          '<div class="k-progress k-grow"><div class="k-progress__bar" style="width:' + Math.round(100 * done / Math.max(1, total)) + '%"></div></div></div>' +
        '</div>';
      if (manual && step === 'unit') return drawPickUnit(q, headHtml);
      const cur = (chosen && q.find((x) => x.id === chosen)) || q[0];
      const later = [];
      const restHere = cur.qty - cur.qty_returned - 1;
      if (restHere > 0) later.push([restHere + ' unit lagi ke ' + (cur.location_short || '?'), restHere + ' more to ' + (cur.location_short || '?')]);
      q.filter((x) => x !== cur).forEach((x) => later.push([(x.qty - x.qty_returned) + ' unit ' + x.sku_name + ' ke ' + (x.location_short || '?'), (x.qty - x.qty_returned) + ' × ' + x.sku_name + ' to ' + (x.location_short || '?')]));
      const bin = cur.location_short || cur.location_code;
      h.innerHTML = headHtml +
        '<div class="k-card k-card--pad k-stack k-stack--tight' + (step === 'bin' ? '' : ' k-card--focus') + '">' +
          '<div class="ps-step"><span class="ps-step__no' + (step === 'bin' ? ' ps-step__no--ok' : '') + '">' + (step === 'bin' ? icon('check', 18, 3) : '1') + '</span>' +
          '<span class="k-stack k-stack--tight"><span class="k-strong" ' + (step === 'bin'
            ? (unitCode ? biAttr('Barang dipindai · cocok', 'Item scanned · matches') : biAttr('Barang dipilih', 'Item chosen'))
            : biAttr('Pindai barangnya', 'Scan the item')) + '></span>' +
          '<span class="ps-big">' + esc(cur.sku_name) + '</span></span></div>' +
          (manual ? '<button type="button" class="k-linkbtn" style="align-self:flex-start" data-other>' + bis('Pilih barang lain', 'Choose another item') + '</button>' : '') +
        '</div>' +
        (cur.location_code
          ? '<div class="k-target" style="' + (step === 'bin' ? '' : 'opacity:.6') + '"><div class="k-target__text">' + bis('2. Ke bin', '2. To bin', 'k-target__label') +
            '<span class="k-target__code">' + esc(bin) + '</span>' +
            (cur.location_words ? '<span class="k-target__hint">' + esc(cur.location_words) + '</span>' : '') +
            (manual
              ? '<span class="k-target__hint">' + bis('Taruh barang di bin ini, lalu ketuk tombol di bawah.', 'Put the item in this bin, then tap the button below.') + '</span>'
              : '<span class="k-target__hint">' + bis('Taruh barang di bin ini, lalu pindai label bin.', 'Put the item in this bin, then scan the bin label.') + '</span>') + '</div></div>'
          : '<div class="k-card k-card--stop k-card--pad k-stack k-stack--tight">' +
              '<div class="k-line" style="gap:8px">' + icon('warn', 20) + bis('Produk ini belum punya bin. Panggil SPV.', 'This product has no bin yet. Call the SPV.', 'k-strong') + '</div>' +
              bis('Simpan unit ini di keranjang. Unit tetap ada di daftar sampai SPV memberi bin.',
                'Keep this unit in the basket. It stays on the list until the SPV gives it a bin.', 'k-muted') +
              (q.length > 1 && !q.filter((x) => x !== cur).every((x) => skipped.has(x.id))
                ? '<button type="button" class="k-btn k-btn--secondary k-btn--block" data-skip>' + icon('arrow', 20) +
                  bis('Lewati, lanjut unit berikutnya', 'Skip, next unit') + '</button>' : '') +
              (S.atLeast('supervisor')
                ? '<a class="k-linkbtn" style="align-self:flex-start" href="rak-bin.html?tab=perlu">' + bis('Beri bin di Rak & bin', 'Give it a bin in Racks & bins') + '</a>' : '') +
            '</div>') +
        (cur.location_code && manual
          ? '<button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block ps-tap" data-back-tap>' + icon('check', 24, 2.4) +
            bis('Sudah dikembalikan ke bin ' + bin, 'Put back in bin ' + bin) + '</button>' + scanAltHtml()
          : cur.location_code ? '<div data-scan></div>' : '') +
        (later.length ? '<span class="k-muted" ' + biAttr('Berikutnya: ' + later.map((x) => x[0]).join(', lalu '), 'Next: ' + later.map((x) => x[1]).join(', then ')) + '></span>' : '');
      const skip = h.querySelector('[data-skip]');
      if (skip) skip.addEventListener('click', () => { skipped.add(cur.id); step = 'unit'; unitCode = null; chosen = null; draw(); });
      const other = h.querySelector('[data-other]');
      if (other) other.addEventListener('click', () => { step = 'unit'; unitCode = null; chosen = null; draw(); });
      // No bin: nothing to scan here. Skip, or wait for the SPV.
      if (!cur.location_code) { paint(h); return; }
      const tap = h.querySelector('[data-back-tap]');
      if (tap) tap.addEventListener('click', () => putBackTap(cur, tap));
      S.scan(async (code, z) => {
        const sc = 'return-' + cur.id;
        try {
          if (step === 'unit') {
            await api().post('/returns/' + cur.id + '/check-unit', { code });
            z.accept(t('Cocok', 'Match'));
            unitCode = code; step = 'bin';
            setTimeout(draw, 300);
          } else {
            // One key per scan until the server answers (S.scanKey). A unit
            // tapped in Mode manual and a scanned bin label: manual, no code.
            const k = S.scanKey(sc, (unitCode || 'tap') + '|' + code);
            let r;
            try {
              r = await api().post('/returns/' + cur.id + '/scan', unitCode
                ? { code: unitCode, bin_code: code, idempotency_key: k }
                : { manual: true, bin_code: code, idempotency_key: k });
              S.scanDone(sc);
            } catch (e) { if (!e.network) S.scanDone(sc); throw e; }
            z.accept(t('Kembali di rak', 'Back on the rack'));
            booked(cur, r);
            setTimeout(draw, 300);
          }
        } catch (e) { z.reject(say(e.message)); }
      }, {
        title: step === 'unit' ? ['Pindai barang', 'Scan the item'] : ['Pindai label bin ' + (cur.location_short || ''), 'Scan bin label ' + (cur.location_short || '')],
        mount: h.querySelector('[data-scan]'),
      });
      paint(h);
    }
    /* Mode manual, step 1: tap the item in hand in the list of what is still
       to put back. A scan still works: it is matched against the list. */
    function drawPickUnit(q, headHtml) {
      h.innerHTML = headHtml +
        '<div class="k-card k-card--pad k-card--focus k-stack">' +
          '<div class="ps-step"><span class="ps-step__no">1</span><span class="ps-big">' +
            bis('Ketuk barang yang Anda pegang', 'Tap the item in your hand') + '</span></div>' +
          bis('Pastikan produknya sama dengan foto.', 'Make sure the product matches the photo.', 'k-muted') +
          '<div class="k-stack k-stack--tight">' + q.map((x) => {
            const left = x.qty - x.qty_returned;
            return '<button type="button" class="ps-retpick" data-pick="' + x.id + '">' + photo(x.photo_key, true) +
              '<span class="k-grow k-stack k-stack--tight"><span class="k-strong">' + esc(x.sku_name) + '</span>' +
              '<span class="k-muted" ' + biAttr(unitsWord(left)[0] + ' · ke bin ' + (x.location_short || '?'), unitsWord(left)[1] + ' · to bin ' + (x.location_short || '?')) + '></span></span>' +
              icon('chev', 22) + '</button>';
          }).join('') + '</div>' +
        '</div>' + scanAltHtml();
      h.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        chosen = +b.dataset.pick; unitCode = null; step = 'bin';
        draw();
      }));
      S.scan(async (code, z) => {
        // The first task on the list whose product this is.
        for (const x of q) {
          try {
            await api().post('/returns/' + x.id + '/check-unit', { code });
            z.accept(t('Cocok', 'Match'), x.sku_name);
            chosen = x.id; unitCode = code; step = 'bin';
            setTimeout(draw, 300);
            return;
          } catch (e) {
            if (e.status !== 409) { z.reject(say(e.message)); return; }
          }
        }
        z.reject(t('Salah barang', 'Wrong item'), t('Barang ini tidak ada di daftar.', 'This item is not on the list.'));
      }, { title: ['Pindai barang', 'Scan the item'], mount: h.querySelector('[data-scan]') });
      paint(h);
    }
    /* "Sudah dikembalikan ke bin X": one tap books one unit. The button stays
       off until the answer; one key per tap until the server answers
       (S.scanKey, code 'tap'), so a lost answer is replayed, not booked twice. */
    async function putBackTap(cur, btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      const sc = 'return-tap-' + cur.id;
      const k = S.scanKey(sc, unitCode ? unitCode + '|tap' : 'tap');
      let r;
      try {
        r = await api().post('/returns/' + cur.id + '/scan', { manual: true, code: unitCode || '', idempotency_key: k });
        S.scanDone(sc);
      } catch (e) {
        if (!e.network) S.scanDone(sc);
        btn.disabled = false;
        S.fail(e);
        // Mode manual may have ended: read the list again and draw for scanning.
        if (!e.network && await reload()) draw();
        return;
      }
      S.toast(['Kembali di bin ' + (cur.location_short || ''), 'Back in bin ' + (cur.location_short || '')], 'ok');
      booked(cur, r);
      draw();
    }
    draw();
  }
})();
