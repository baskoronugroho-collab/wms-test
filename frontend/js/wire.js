/* wire.js — live behaviour for the Station surface and the pick queue board.
 *
 * The design ships each screen with a demo <script> and the endpoint named in a
 * comment; this file replaces that behaviour with real calls through NJW.api.
 * It never introduces markup of its own vocabulary: it fills the [data-field]
 * and [data-region] hooks the design already placed, and builds cards and rows
 * from the same classes the mockups use, so a restyle stays a CSS job.
 *
 * Load order: api.js, scan.js, app.js, then this.
 */
(function () {
  'use strict';

  const NJW = (window.NJW = window.NJW || {});
  const api = () => NJW.api;

  /* ---------- flow state across pages (each screen is its own document) ---- */

  const CTX = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('njw.' + k)); } catch { return null; } },
    set(k, v) { sessionStorage.setItem('njw.' + k, JSON.stringify(v)); },
    del(k) { sessionStorage.removeItem('njw.' + k); },
  };
  NJW.ctx = CTX;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const field = (f, r) => $('[data-field="' + f + '"]', r);
  const region = f => $('[data-region="' + f + '"]');
  const setF = (f, v) => { const el = field(f); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const go = p => { location.href = p; };
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  /* app.js rewrites textContent from data-id on load and on every language
     switch, so generated copy must set BOTH attributes or the EN toggle blanks
     it. data-id is the runtime source of truth, not the text node. */
  function bi(el, id, en) {
    if (!el) return;
    el.dataset.id = id;
    el.dataset.en = en || id;
    el.textContent = (localStorage.getItem('njw.lang') === 'en') ? (en || id) : id;
  }
  const biAttr = (id, en) => 'data-id="' + esc(id) + '" data-en="' + esc(en || id) + '"';

  /* app.js applies the language once on load and keeps applyLang private, so
     anything rendered afterwards would stay Indonesian for an EN reader until
     they toggled. Re-apply over whatever we just built, without touching
     app.js — data-id remains the source of truth either way. */
  function applyLangTo(root) {
    const en = localStorage.getItem('njw.lang') === 'en';
    (root || document).querySelectorAll('[data-id]').forEach(el => {
      const v = en ? (el.dataset.en || el.dataset.id) : el.dataset.id;
      if (v != null) el.textContent = v;
    });
  }

  function codeHtml(code) {
    const p = String(code || '').split('-');
    if (p.length < 3) return esc(code || '—');
    return esc(p[0]) + '-<span class="code__hl">' + esc(p[1]) + '</span>-' +
      '<span class="code__hl">' + esc(p[2]) + '</span>' + (p[3] ? '-' + esc(p[3]) : '');
  }

  function say(msg) {
    let bar = $('.wire-toast');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wire-toast notice notice--action';
      bar.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
        'z-index:200;max-width:90vw;box-shadow:var(--sh-2,0 6px 24px rgba(0,0,0,.2))';
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    clearTimeout(say._t);
    say._t = setTimeout(() => bar.remove(), 3600);
  }

  function fail(e) {
    if (e && e.status === 401) { go(isConsole() ? '../14-terkunci.html' : '14-terkunci.html'); return; }
    say((e && e.message) || 'Ada masalah. Panggil supervisor.');
  }

  const isConsole = () => location.pathname.includes('/console/');

  /* ---------- day colour: colour + day + date, never colour alone ---------- */

  async function paintDayColour() {
    if (!region('day-color') && !field('day-name')) return;
    try {
      const { today } = await api().dayColors();
      const block = field('day-block');
      if (block) {
        block.style.background = today.hex;
        block.style.color = today.ink;
      }
      setF('day-name', today.day_id);
      setF('day-date', NJW.fmt.date(today.date));
      setF('day-wk', 'W' + today.iso_week);
      setF('day-parity', today.week_parity);
      const el = field('day-name');
      if (el) el.dataset.en = today.day_en;
      return today;
    } catch (e) { /* the slip still prints without it */ }
  }

  /* ---------- boot ---------- */

  let ME = null, SITE = null;

  async function boot() {
    try {
      ME = await api().me();
    } catch (e) {
      if (e.status === 403) {
        document.body.innerHTML =
          '<div class="banner banner--stop" style="margin:40px">' +
          '<span class="banner__icon">!</span>' + esc(e.message) + '</div>';
        return false;
      }
      go(isConsole() ? '../14-terkunci.html' : '14-terkunci.html');
      return false;
    }
    const saved = CTX.get('site');
    SITE = ME.sites.find(s => s.id === saved)
      || ME.sites.find(s => s.id === ME.default_site_id)
      || ME.sites[0];
    if (SITE) CTX.set('site', SITE.id);
    NJW.me = ME; NJW.site = SITE;

    paintChrome();
    NJW.startHeartbeat('/api/health', 20000);
    return true;
  }

  function paintChrome() {
    $$('.chrome__user, [data-field="user-name"]').forEach(el => {
      el.textContent = ME.name + (SITE ? ' · ' + SITE.code : '');
    });
    setF('site-code', SITE ? SITE.code : '—');

    const mode = $('.chrome__mode');
    if (mode && !$('#siteSel') && ME.sites.length > 1 &&
        ($('.app') || {}).dataset && $('.app').dataset.screen === 'home') {
      const sel = document.createElement('select');
      sel.id = 'siteSel';
      sel.className = 'chrome__mode';
      sel.style.cssText = 'background:var(--surface);color:var(--ink);' +
        'border:1px solid var(--rule);border-radius:var(--r-sm,6px);min-height:40px;padding:0 8px';
      sel.innerHTML = ME.sites.map(s =>
        '<option value="' + s.id + '"' + (SITE && s.id === SITE.id ? ' selected' : '') + '>' +
        esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join('');
      sel.onchange = () => { CTX.set('site', +sel.value); location.reload(); };
      mode.replaceWith(sel);
    } else if (mode && !mode.dataset.keep) {
      mode.textContent = SITE ? SITE.code : '';
    }

    // Some screens deliberately ship no .chrome (the full-bleed stop screen),
    // so this has to place itself without one. That assumption broke in v1.
    if (SITE && SITE.is_training && !$('.wire-training') && !isConsole()) {
      const b = document.createElement('div');
      b.className = 'wire-training banner banner--caution';
      b.style.cssText = 'min-height:44px;font-size:17px;letter-spacing:.06em';
      b.innerHTML = '<span class="banner__icon" aria-hidden="true">!</span><span ' +
        biAttr('MODE LATIHAN — barang tidak nyata, aman untuk salah',
               'TRAINING MODE — not real stock, safe to get wrong') +
        '>MODE LATIHAN — barang tidak nyata, aman untuk salah</span>';
      const chrome = $('.chrome');
      if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(b, chrome.nextSibling);
      else document.body.insertBefore(b, document.body.firstChild);
    }
  }

  async function testCodes(zoneEl, after) {
    if (!SITE || !SITE.is_training || !zoneEl) return;
    try {
      const sheet = await api().raw.get('/training/barcode-sheet?site_id=' + SITE.id + '&limit=18');
      if (!sheet.rows.length) return;
      const box = document.createElement('div');
      box.className = 'panel';
      box.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      box.innerHTML = '<span class="eyebrow" ' + biAttr('Barcode uji', 'Test barcodes') +
        '>Barcode uji</span>';
      sheet.rows.forEach(r => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--outline';
        b.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px';
        b.textContent = r.sku_name.slice(0, 20);
        b.title = r.sku_name + ' · ' + r.barcode;
        b.onclick = () => after(r.barcode);
        box.appendChild(b);
      });
      zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
    } catch { /* training-only nicety */ }
  }

  /* ======================= screens ======================= */

  const screens = {};

  /* ---- home ---- */
  screens.home = async () => {
    /* The root lands on the Station app, which is right for the people who use
       this all day. It is wrong for a supervisor or admin: their surface is the
       console, and from here it is a card below the fold — so the app looked to
       them like it had never been redesigned at all.
       Send them to the console, but never trap them: arriving from the console's
       own "open station app" link, or with ?station, is an explicit choice and
       is remembered for the session. */
    const params = new URLSearchParams(location.search);
    const fromConsole = document.referrer.includes('/console/');
    if (params.has('station') || fromConsole) CTX.set('preferStation', true);
    if (ME.role && ['admin', 'supervisor'].includes(ME.role) && !CTX.get('preferStation')) {
      return go('console/index.html');
    }

    const cards = $$('.home__card');
    try {
      const [board, plans] = await Promise.all([
        api().pickBoard({ site_id: SITE.id }).catch(() => null),
        api().opnamePlans({ site_id: SITE.id, limit: 1 }).catch(() => null),
      ]);
      if (board) {
        const waiting = board.lanes.find(l => l.key === 'waiting');
        const note = cards[2] && $('.note', cards[2]);
        bi(note,
           waiting.count ? waiting.count + ' pesanan menunggu diambil' : 'Belum ada pesanan',
           waiting.count ? waiting.count + ' orders waiting to pick' : 'No orders waiting');
      }
      // Always overwrite: the mockup ships a plausible number here, and a
      // fabricated count on the home screen is worse than no count at all —
      // a staffer has no way to tell it is fiction.
      const note = cards[3] && $('.note', cards[3]);
      if (plans && plans.plans.length) {
        const p = plans.plans[0];
        const left = p.total_baskets - p.counted;
        bi(note, left + ' keranjang belum dihitung', left + ' baskets left to count');
      } else {
        bi(note, 'Belum ada jadwal hitung', 'No count scheduled yet');
      }
    } catch (e) { /* the menu still works */ }
  };

  /* ---- A: inbound ---- */

  screens['inbound-start'] = async () => {
    await paintDayColour();
    const primary = $('.choice--primary .btn') || $('.btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.onclick = async (e) => {
        e.preventDefault();
        try {
          const r = await api().raw.post('/receipts',
            { site_id: SITE.id, source_type: 'from_brand' });
          CTX.set('receipt', r.id);
          CTX.set('receiptSession', 0);
          go('02-barang-masuk-scan.html');
        } catch (err) { fail(err); }
      };
    }
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    if (zone) zone.onScan(async code => {
      try {
        const r = await api().raw.post('/receipts', {
          site_id: SITE.id, source_type: 'from_hub_transfer', transfer_reference: code,
        });
        CTX.set('receipt', r.id);
        CTX.set('receiptSession', 0);
        zone.accept('Diterima', code);
        setTimeout(() => go('02-barang-masuk-scan.html'), 600);
      } catch (err) { zone.reject('Transfer tidak ditemukan', err.message); }
    });
  };

  screens['inbound-scan'] = async () => {
    const receiptId = CTX.get('receipt');
    if (!receiptId) return go('01-mulai-barang-masuk.html');
    await paintDayColour();

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    const banner = region('result');
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; mode.textContent = 'Barang masuk · #' + receiptId; }

    function result(kind, title, detail) {
      if (!banner) return;
      banner.className = 'banner banner--' + kind;
      banner.innerHTML =
        '<span class="banner__icon banner__icon--round" aria-hidden="true">' +
        (kind === 'accept' ? '✓' : '!') + '</span><span>' + esc(title) + '</span>' +
        '<span class="chrome__sep"></span>' +
        '<span class="banner__detail" data-field="product">' + esc(detail) + '</span>';
    }

    function paintProduct(sku, locationCode, basketQty) {
      const img = $('.product__photo');
      if (img) {
        img.dataset.photoKey = (sku.brand_sku_code || '').toLowerCase();
        img.alt = sku.name_display;
      }
      const meta = $('.product__meta');
      if (meta) meta.textContent =
        [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
      const name = $('.product__name');
      if (name) name.textContent = sku.name_display;
      const codeEl = $('.code--xl');
      if (codeEl) codeEl.innerHTML = codeHtml(locationCode);
      const parts = String(locationCode || '').split('-');
      if (parts.length >= 3) {
        bi($('.lede'), 'Rak ' + parts[1] + ', tingkat ' + parts[2] + '.',
                       'Rack ' + parts[1] + ', level ' + parts[2] + '.');
      }
      setF('basket-qty', basketQty);
      if (NJW.paintPhotos) NJW.paintPhotos();
    }

    async function doScan(code) {
      try {
        const r = await api().raw.post('/receipts/' + receiptId + '/scan',
          { code, qty: 1, idempotency_key: key() });
        if (r.accepted) {
          CTX.set('receiptSession', r.session_total);
          setF('session-qty', r.session_total);
          paintProduct(r.sku, r.location_code, r.qty_in_basket);
          if (r.outcome === 'over_capacity') {
            zone.accept('Keranjang penuh', r.message);
            result('caution', 'Keranjang penuh', r.message);
          } else {
            zone.accept('Diterima', 'Simpan di ' + r.location_code);
            result('accept', 'Diterima', r.sku.name_display);
          }
          NJW.undo.push({ code });
          return;
        }
        if (r.outcome === 'no_slot') {
          CTX.set('pendingSku', r.sku);
          CTX.set('pendingCode', code);
          return go('04-buat-keranjang.html');
        }
        CTX.set('pendingCode', code);
        zone.reject('Barcode tidak dikenal', code);
        go('03-barcode-tidak-dikenal.html');
      } catch (e) { zone.reject('Gagal', e.message); }
    }

    if (zone) { zone.onScan(doScan); testCodes(zoneEl, doScan); }
    setF('session-qty', CTX.get('receiptSession') || 0);

    const finish = $('.btn--primary');
    if (finish) finish.onclick = async () => {
      try {
        await api().raw.post('/receipts/' + receiptId + '/complete', {});
        go('15-penerimaan-selesai.html');
      } catch (e) { fail(e); }
    };
    const undo = $('[data-action="undo"]');
    if (undo) undo.onclick = () => say('Batalkan belum tersedia — catat ke supervisor.');
  };

  screens['unknown-barcode'] = async () => {
    const code = CTX.get('pendingCode') || '';
    const codeEl = $('.code--xl') || $('.code--lg') || $('.code');
    if (codeEl) codeEl.textContent = code;
    const primary = $('.btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.onclick = async (e) => {
        e.preventDefault();
        const q = prompt('Nama barang (ketik sebagian):');
        if (!q) return;
        try {
          const r = await api().skus({ q, limit: 10 });
          if (!r.skus.length) return say('Tidak ketemu.');
          let pick = r.skus[0];
          if (r.skus.length > 1) {
            const n = parseInt(prompt(r.skus.map((s, i) =>
              (i + 1) + '. ' + s.name_display).join('\n') + '\n\nNomor:'), 10);
            pick = r.skus[Math.max(0, (n || 1) - 1)] || r.skus[0];
          }
          await api().registerBarcodes({ sku_id: pick.id, barcodes: [code] });
          say('Terdaftar: ' + pick.name_display);
          setTimeout(() => go('02-barang-masuk-scan.html'), 700);
        } catch (err) { fail(err); }
      };
    }
    $$('a.btn').forEach(a => {
      if (/lewati|skip|kembali|back/i.test(a.textContent)) a.href = '02-barang-masuk-scan.html';
    });
  };

  screens['create-basket'] = async () => {
    const sku = CTX.get('pendingSku');
    const code = CTX.get('pendingCode');
    if (!sku) return go('02-barang-masuk-scan.html');
    let suggestion;
    try {
      suggestion = await api().raw.get('/slots/suggest?site_id=' + SITE.id + '&sku_id=' + sku.id);
    } catch (e) { return fail(e); }

    const name = $('.product__name'); if (name) name.textContent = sku.name_display;
    const meta = $('.product__meta');
    if (meta) meta.textContent =
      [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = (sku.brand_sku_code || '').toLowerCase(); img.alt = sku.name_display; }
    const codeEl = $('.code--xl') || $('.code--lg');
    if (codeEl) codeEl.innerHTML = codeHtml(suggestion.location_code);
    bi($('.lede'), suggestion.reason, suggestion.reason);
    if (NJW.paintPhotos) NJW.paintPhotos();

    const primary = $('.btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.onclick = async (e) => {
        e.preventDefault();
        try {
          await api().raw.post('/slots',
            { site_id: SITE.id, sku_id: sku.id, created_during_inbound: true });
          CTX.del('pendingSku');
          if (code) {
            await api().raw.post('/receipts/' + CTX.get('receipt') + '/scan',
              { code, qty: 1, idempotency_key: key() });
          }
          say('Keranjang dibuat: ' + suggestion.location_code);
          setTimeout(() => go('02-barang-masuk-scan.html'), 600);
        } catch (err) { fail(err); }
      };
    }
  };

  screens['inbound-done'] = async () => {
    const receiptId = CTX.get('receipt');
    if (!receiptId) return go('index.html');
    try {
      const slip = await api().receiptSlip(receiptId);
      setF('slip-no', slip.slip_no);
      setF('total-lines', slip.total_lines);
      setF('total-units', slip.total_units);
      const variance = slip.lines.reduce((n, l) => n + Math.abs(l.variance || 0), 0);
      setF('total-variance', variance);

      const block = field('day-block');
      if (block) { block.style.background = slip.day_color.hex; block.style.color = slip.day_color.ink; }
      setF('day-name', slip.day_color.day_id);
      setF('day-date', NJW.fmt.date(slip.day_color.date));
      setF('day-wk', 'W' + slip.day_color.iso_week);
      setF('day-parity', slip.day_color.week_parity);

      const host = region('lines');
      if (host) host.innerHTML = slip.lines.map(l =>
        '<tr><td class="td-code">' + esc(l.location_code || '—') + '</td>' +
        '<td>' + esc(l.sku_name) + '</td>' +
        '<td class="td-qty">' + l.qty_received + '</td></tr>').join('');

      $$('a.btn, button.btn').forEach(b => {
        if (/slip/i.test(b.textContent)) {
          b.removeAttribute('href');
          b.onclick = () => { CTX.del('receipt'); go('console/slip-detail.html?id=' + slip.id); };
        } else if (/selesai|menu|done/i.test(b.textContent)) {
          b.removeAttribute('href');
          b.onclick = () => { CTX.del('receipt'); go('index.html'); };
        }
      });
    } catch (e) { fail(e); }
  };

  /* ---- B: unit labelling ---- */

  screens['label-unit'] = async () => {
    let sku = CTX.get('labelSku');
    if (!sku) {
      try {
        const r = await api().skus({ limit: 200 });
        const modeB = r.skus.filter(s => s.identity_mode === 'unit_label');
        if (!modeB.length) { say('Tidak ada barang tanpa barcode.'); return go('index.html'); }
        sku = modeB[0];
        CTX.set('labelSku', sku);
      } catch (e) { return fail(e); }
    }
    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = (sku.brand_sku_code || '').toLowerCase(); img.alt = sku.name_display; }
    const meta = $('.product__meta');
    if (meta) meta.textContent =
      [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
    const name = $('.product__name'); if (name) name.textContent = sku.name_display;
    if (NJW.paintPhotos) NJW.paintPhotos();
    await paintDayColour();

    let n = 0;
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    if (zone) zone.onScan(async code => {
      try {
        const r = await api().raw.post('/plates/bind', {
          site_id: SITE.id, sku_id: sku.id, plate_code: code, idempotency_key: key(),
        });
        if (r.accepted) {
          n = r.bound_count;
          setF('count', n);
          const bar = field('bar');
          if (bar) bar.style.width = Math.min(100, n / 200 * 100) + '%';
          setF('last', code);
          NJW.undo.push({ plate: code });
          zone.accept('Tercatat', 'Simpan di ' + r.location_code);
        } else if (r.outcome === 'already_bound') {
          CTX.set('boundMsg', r.message);
          CTX.set('boundPlate', code);
          go('06-label-sudah-terpakai.html');
        } else {
          zone.reject('Ditolak', r.message);
        }
      } catch (e) { zone.reject('Gagal', e.message); }
    });

    const undo = $('[data-action="undo"]');
    if (undo) undo.onclick = async () => {
      const last = NJW.undo.pop();
      if (!last) return say('Tidak ada yang bisa dibatalkan.');
      try {
        await api().raw.post('/plates/' + encodeURIComponent(last.plate) + '/unbind?reason=undo', {});
        setF('count', Math.max(0, --n));
        say('Label dilepas.');
      } catch (e) { fail(e); }
    };
    const done = $('.btn--primary');
    if (done) done.onclick = () => { CTX.del('labelSku'); go('index.html'); };
  };

  screens['label-bound'] = async () => {
    const codeEl = $('.code--xl') || $('.code--lg') || $('.code');
    if (codeEl) codeEl.textContent = CTX.get('boundPlate') || '';
    bi($('.lede'), CTX.get('boundMsg') || '', CTX.get('boundMsg') || '');
    $$('a.btn').forEach(a => { a.href = '05-label-unit.html'; });
  };

  /* ---- C: pick ---- */

  screens.pick = async () => {
    let task = CTX.get('task');
    try {
      if (!task) {
        const list = await api().pickTasks({ site_id: SITE.id, status: 'ready' });
        if (!list.tasks.length) {
          $('.main').innerHTML =
            '<h1 class="h1" ' + biAttr('Belum ada pesanan', 'No orders waiting') +
            '>Belum ada pesanan</h1><p class="lede" ' +
            biAttr('Tunggu pesanan masuk dari Grab.', 'Wait for an order from Grab.') +
            '>Tunggu pesanan masuk dari Grab.</p>' +
            '<a class="btn btn--primary btn--lg" href="index.html" ' +
            biAttr('Kembali', 'Back') + '>Kembali</a>';
          return;
        }
        task = await api().raw.post('/pick-tasks/' + list.tasks[0].id + '/claim', {});
        CTX.set('task', task);
      }
    } catch (e) { return fail(e); }

    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; mode.textContent = 'Ambil · ' + task.external_ref; }

    const currentLine = () => task.lines.find(l => l.status === 'pending');

    function paint() {
      const line = currentLine();
      if (!line) return finish();
      const codeEl = $('.code--xl');
      if (codeEl) codeEl.innerHTML = codeHtml(line.location_code);
      const parts = String(line.location_code || '').split('-');
      if (parts.length >= 3) {
        bi($('.lede'), 'Rak ' + parts[1] + ', tingkat ' + parts[2] + '.',
                       'Rack ' + parts[1] + ', level ' + parts[2] + '.');
      }
      const num = $('.counter__num');
      if (num) num.textContent = line.qty_required - line.qty_picked;
      const idx = task.lines.indexOf(line) + 1;
      bi($('.counter .lede'), 'Barang ' + idx + ' dari ' + task.lines.length,
                              'Item ' + idx + ' of ' + task.lines.length);
      const img = $('.product__photo');
      if (img) { img.dataset.photoKey = ''; img.alt = line.sku_name; }
      const name = $('.product__name'); if (name) name.textContent = line.sku_name;
      const meta = $('.product__meta'); if (meta) meta.textContent = line.location_code || '';
    }

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    if (zone) zone.onScan(async code => {
      const line = currentLine();
      if (!line) return;
      try {
        const r = await api().raw.post('/pick-lines/' + line.id + '/confirm', {
          code, qty: line.qty_required - line.qty_picked, idempotency_key: key(),
        });
        if (!r.accepted) {
          CTX.set('wrong', {
            scanned: r.scanned_sku_name || code,
            expected: r.expected_sku_name,
            location: line.location_code,
          });
          zone.reject('Salah barang', r.message);
          return setTimeout(() => go('08-salah-barang.html'), 900);
        }
        zone.accept('Benar', line.sku_name);
        line.qty_picked = r.qty_picked;
        line.status = r.line_complete ? 'picked' : 'pending';
        CTX.set('task', task);
        if (r.task_complete) return finish();
        setTimeout(paint, 500);
      } catch (e) { zone.reject('Gagal', e.message); }
    });

    async function finish() {
      try { await api().raw.post('/pick-tasks/' + task.id + '/complete', {}); } catch { /* done */ }
      CTX.set('doneTask', task);
      CTX.del('task');
      go('09-pesanan-selesai.html');
    }

    paint();
    if (zone) testCodes(zoneEl, c => zone.handlers[0](c, zone));
    const short = $('.btn--caution');
    if (short) short.onclick = () => say('Alur barang hilang belum dibuat — panggil supervisor.');
  };

  screens['wrong-item'] = async () => {
    const w = CTX.get('wrong') || {};
    const cards = $$('.card-compare');
    const fill = (card, name) => {
      if (!card) return;
      const n = $('.product__name', card);
      if (n) n.textContent = name || '—';
      const img = $('.card-compare__photo, .product__photo', card);
      if (img) img.alt = name || '';
    };
    fill(cards[0], w.scanned);
    fill(cards[1], w.expected);
    const instr = $('.col p[style]') || $('.lede');
    if (instr) {
      bi(instr,
        'Kembalikan barang itu, lalu ambil ' + (w.expected || 'yang benar') +
        ' dari keranjang yang sama' + (w.location ? ' — ' + w.location : '') + '.',
        'Put that item back, then take ' + (w.expected || 'the right one') +
        ' from the same basket' + (w.location ? ' — ' + w.location : '') + '.');
    }
  };

  screens['pick-done'] = async () => {
    const done = CTX.get('doneTask');
    if (done) {
      const tbody = $('.table tbody') || region('lines');
      if (tbody) tbody.innerHTML = done.lines.map(l =>
        '<tr><td class="td-code">' + esc(l.location_code || '') + '</td>' +
        '<td>' + esc(l.sku_name) + '</td>' +
        '<td class="td-qty">' + l.qty_picked + '</td></tr>').join('');
      const units = done.lines.reduce((n, l) => n + l.qty_picked, 0);
      bi($('.eyebrow'), units + ' barang · ' + done.lines.length + ' keranjang',
                        units + ' items · ' + done.lines.length + ' baskets');
      const ticket = $('.panel .code');
      if (ticket) { ticket.textContent = done.external_ref; ticket.style.fontSize = '30px'; }
      CTX.del('doneTask');
    }
    const handoff = $('button.btn--primary');
    if (handoff) handoff.onclick = () => go('07-ambil-pesanan.html');
  };

  /* ---- D: stock count ---- */

  screens['count-list'] = async () => {
    let planId = CTX.get('plan');
    try {
      if (!planId) {
        const existing = await api().opnamePlans({ site_id: SITE.id, limit: 1 })
          .catch(() => ({ plans: [] }));
        const open = existing.plans.find(p => p.status !== 'closed');
        planId = open ? open.id
          : (await api().raw.post('/opname/plans', { site_id: SITE.id, name: 'Hitung stok' })).id;
        CTX.set('plan', planId);
      }
      const d = await api().raw.get('/opname/plans/' + planId);
      const count = $('.progress__count');
      if (count) count.innerHTML = d.plan.counted + ' / ' + d.plan.total_baskets +
        ' <span class="note" ' + biAttr('keranjang selesai', 'baskets done') + '>keranjang selesai</span>';

      const list = $('.list');
      if (list) {
        list.innerHTML = d.baskets.map((b, i) => {
          const busy = b.status === 'counting' && b.claimed_by && b.claimed_by !== ME.email;
          const done = b.status === 'finished';
          const next = !busy && !done && !d.baskets.slice(0, i).some(x =>
            x.status !== 'finished' && !(x.status === 'counting' && x.claimed_by !== ME.email));
          return '<div class="row' + (done ? ' row--done' : busy ? ' row--claimed' : next ? ' row--next' : '') + '">' +
            '<span class="row__code code code--md">' + esc(b.location_code) + '</span>' +
            '<span class="row__name">' + esc(b.sku_name || '—') + '</span>' +
            (busy ? '<span class="row__state"><span class="code code--sm">!</span><span>Sedang dihitung: ' +
                    esc(b.claimed_by.split('@')[0]) + '</span></span>' : '') +
            (done ? '<span class="row__state"><span class="pill"><span class="pill__mark">✓</span></span>' +
                    '<span>Selisih ' + (b.variance > 0 ? '+' : '') + (b.variance || 0) + '</span></span>' : '') +
            (busy || done
              ? '<span class="btn is-locked" aria-disabled="true">' + (done ? 'Selesai' : 'Terkunci') + '</span>'
              : '<button class="btn ' + (next ? 'btn--primary' : 'btn--outline') + '" data-b="' +
                b.basket_id + '">' + (next ? 'Mulai hitung' : 'Hitung') + '</button>') +
            '</div>';
        }).join('');
        $$('[data-b]', list).forEach(btn => btn.onclick = async () => {
          try {
            const s = await api().raw.post('/opname/sessions',
              { plan_id: planId, basket_id: +btn.dataset.b });
            CTX.set('session', s);
            go('11-hitung-menghitung.html');
          } catch (e) { say(e.message); }
        });
      }
    } catch (e) { fail(e); }
  };

  screens.counting = async () => {
    const s = CTX.get('session');
    if (!s) return go('10-hitung-pilih-keranjang.html');
    const codeEl = $('.code--lg') || $('.code--xl');
    if (codeEl) codeEl.innerHTML = codeHtml(s.location_code);
    const name = $('.product__name'); if (name) name.textContent = s.sku_name || '—';
    const meta = $('.product__meta'); if (meta) meta.textContent = s.location_code || '';

    const out = field('count');
    if (out) out.textContent = '0';
    let typed = '';
    const set = n => { if (out) out.textContent = String(Math.max(0, Math.min(999, n))); };
    const inc = $('[data-action="inc"]'), dec = $('[data-action="dec"]');
    if (inc) inc.onclick = () => { typed = ''; set(+out.textContent + 1); };
    if (dec) dec.onclick = () => { typed = ''; set(+out.textContent - 1); };
    $$('.keypad__key').forEach(k => k.onclick = () => {
      const v = k.dataset.key;
      if (v === 'del') typed = typed.slice(0, -1);
      else if (v === 'zero') typed = '0';
      else typed = (typed + v).slice(0, 3);
      set(+(typed || 0));
    });

    const save = $('.btn--primary');
    if (save) {
      save.removeAttribute('href');
      save.onclick = async (e) => {
        e.preventDefault();
        try {
          const r = await api().raw.post('/opname/sessions/' + s.id + '/finish',
            { manual_qty: +out.textContent });
          CTX.set('result', Object.assign({}, r,
            { location_code: s.location_code, sku_name: s.sku_name }));
          go('12-hasil-hitung.html');
        } catch (err) { fail(err); }
      };
    }
    const skip = $('a.btn--outline');
    if (skip) skip.href = '10-hitung-pilih-keranjang.html';
  };

  screens.variance = async () => {
    const r = CTX.get('result');
    if (!r) return go('10-hitung-pilih-keranjang.html');
    const head = $('.instr');
    if (head) {
      const c = $('.code', head);
      if (c) c.textContent = r.location_code || '';
      if (head.lastElementChild) head.lastElementChild.textContent = r.sku_name || '';
    }
    const nums = $$('.reveal__num');
    if (nums[0]) nums[0].textContent = r.qty_expected;
    if (nums[1]) nums[1].textContent = r.qty_counted;
    if (nums[2]) nums[2].textContent =
      (r.variance > 0 ? '+' : r.variance < 0 ? '−' : '') + Math.abs(r.variance);
    const delta = $('.reveal__cell--delta');
    if (delta) {
      const msg = r.variance === 0 ? 'Cocok dengan catatan'
        : Math.abs(r.variance) + (r.variance < 0 ? ' barang kurang dari catatan'
                                                 : ' barang lebih dari catatan');
      bi(delta.lastElementChild, msg, msg);
      if (r.variance === 0) delta.classList.remove('reveal__cell--delta');
    }
    const recount = $('.btn--primary');
    if (recount) {
      bi(recount, 'Hitung ulang ' + (r.location_code || ''), 'Recount ' + (r.location_code || ''));
      recount.href = '11-hitung-menghitung.html';
    }
    const cont = $('a.btn--outline');
    if (cont) { cont.href = '10-hitung-pilih-keranjang.html'; CTX.del('session'); }
  };

  /* ---- E: rack map ---- */

  screens['rack-map'] = async () => {
    try {
      const m = await api().rackMap(SITE.id);
      const racks = m.racks.map(r => ({
        name: SITE.code.split('-').pop() + '-' + r.code,
        levels: r.levels.slice().sort((a, b) => b.level_no - a.level_no).map(lv => ({
          n: lv.level_no,
          cells: lv.positions.map(p => ({
            pos: p.position_no,
            state: p.state !== 'occupied' ? 'free'
              : p.qty_on_hand === 0 ? 'over'
              : p.expiry_tier === 'critical' ? 'count' : 'occ',
            sku: p.sku_name, qty: p.qty_on_hand,
          })),
        })),
      }));
      NJW.renderRackMap(region('rackmap') || $('.rackmap'), racks);
    } catch (e) { fail(e); }
  };

  screens.blocked = async () => {
    const retry = $('.btn--primary');
    if (retry) {
      retry.removeAttribute('href');
      retry.onclick = async () => {
        try { await api().me(); go('index.html'); } catch { say('Masih belum terhubung.'); }
      };
    }
  };

  /* ---- console: overview ---- */

  screens.index = async () => {
    await paintDayColour();
    const today = await api().dayColors().then(d => d.today).catch(() => null);
    if (today) {
      setF('day-week', 'W' + today.iso_week + ' · ' + today.week_parity);
      bi(field('day-name'), 'Warna hari ini · ' + today.day_id,
                            "Today's colour · " + today.day_en);
      setF('day-date', NJW.fmt.date(today.date));
    }

    const [board, slips, sites, plans] = await Promise.all([
      api().pickBoard({ site_id: SITE.id }).catch(() => null),
      api().slips({ site_id: SITE.id, limit: 50 }).catch(() => null),
      api().sites().catch(() => null),
      api().opnamePlans({ site_id: SITE.id, limit: 5 }).catch(() => null),
    ]);

    // Units received today, from the slips issued today at this site.
    if (slips) {
      const today10 = new Date().toISOString().slice(0, 10);
      const mine = slips.slips.filter(x => (x.created_at || '').slice(0, 10) === today10);
      setF('kpi-received', NJW.fmt.n(mine.reduce((n, x) => n + x.total_units, 0)));
      const foot = field('kpi-received') && field('kpi-received').nextElementSibling;
      bi(foot, 'dari ' + mine.length + ' kiriman', 'across ' + mine.length + ' deliveries');
    }

    if (board) {
      const waiting = board.lanes.find(l => l.key === 'waiting');
      setF('kpi-orders', waiting.count);
      const foot = field('kpi-orders') && field('kpi-orders').nextElementSibling;
      const mins = Math.floor((board.oldest_waiting_seconds || 0) / 60);
      bi(foot, waiting.count ? 'tertua ' + mins + ' menit' : 'antrean kosong',
               waiting.count ? 'oldest ' + mins + ' min' : 'queue empty');
    }

    if (plans) {
      const open = plans.plans.filter(x => x.variances > 0);
      setF('kpi-variance', open.reduce((n, x) => n + x.variances, 0));
    }

    if (sites) {
      const me = sites.sites.find(x => x.id === SITE.id);
      if (me) {
        setF('kpi-occupancy', me.occupied_locations + ' / ' + me.total_locations);
        const foot = field('kpi-occupancy') && field('kpi-occupancy').nextElementSibling;
        const free = me.total_locations - me.occupied_locations;
        bi(foot, free + ' posisi kosong', free + ' positions free');
      }
    }

    /* "Needs attention" is the only list here, and it must never invent a row:
       an ops board that shows a problem which does not exist costs someone a
       walk to a rack. */
    const host = region('attention');
    if (host) {
      const rows = [];
      if (slips) {
        slips.slips.slice(0, 3).forEach(x => {
          const hrs = NJW.fmt.hoursLeft(
            new Date(new Date(x.created_at).getTime() + 24 * 36e5).toISOString());
          if (hrs != null && hrs <= 24) {
            rows.push({
              what: 'Batas selisih barang masuk', what_en: 'Inbound discrepancy window',
              ref: x.slip_no,
              detail: 'Sisa ' + hrs + ' jam sebelum jadi tanggungan station',
              detail_en: hrs + ' hours left before the station bears it',
              status: hrs <= 6 ? 'Mendesak' : 'Berjalan',
              status_en: hrs <= 6 ? 'Urgent' : 'Running',
              urgent: hrs <= 6,
              href: 'slip-detail.html?id=' + x.id,
            });
          }
        });
      }
      if (board) {
        const stuck = (board.lanes.find(l => l.key === 'picking') || { cards: [] })
          .cards.filter(c => (c.held_seconds || 0) >= 900);
        stuck.forEach(c => rows.push({
          what: 'Klaim tersendat', what_en: 'Stuck claim', ref: c.external_ref,
          detail: 'Dipegang ' + Math.floor(c.held_seconds / 60) + ' menit oleh ' +
                  (c.claimed_by_name || c.claimed_by),
          detail_en: 'Held ' + Math.floor(c.held_seconds / 60) + ' min by ' +
                     (c.claimed_by_name || c.claimed_by),
          status: 'Mendesak', status_en: 'Urgent', urgent: true,
          href: 'papan-antrean.html',
        }));
      }

      // The design's own row vocabulary: td-strong, td-code, a spill status pill
      // with its dot, and td-actions. Inventing names here would render a row
      // that is structurally right and visually unstyled.
      host.innerHTML = rows.length ? rows.map(r =>
        '<tr><td class="td-strong" ' + biAttr(r.what, r.what_en) + '>' + esc(r.what) + '</td>' +
        '<td class="td-code">' + esc(r.ref) + '</td>' +
        '<td ' + biAttr(r.detail, r.detail_en) + '>' + esc(r.detail) + '</td>' +
        '<td><span class="spill spill--' + (r.urgent ? 'stop' : 'warn') + '">' +
        '<span class="spill__dot"></span><span ' + biAttr(r.status, r.status_en) + '>' +
        esc(r.status) + '</span></span></td>' +
        '<td class="td-actions"><a class="cbtn cbtn--sm" href="' + r.href + '" ' +
        biAttr('Buka', 'Open') + '>Buka</a></td></tr>').join('')
        : '<tr><td colspan="5" class="note" ' +
          biAttr('Tidak ada yang perlu perhatian.', 'Nothing needs attention.') +
          '>Tidak ada yang perlu perhatian.</td></tr>';
      applyLangTo(host);
    }
  };

  /* ======================= console: the pick queue board ================= */

  screens['papan-antrean'] = async () => {
    const BANDS = NJW.AGE_BANDS || { ageing: 300, late: 600, stuck: 900 };
    const band = NJW.band || (s => s >= BANDS.late ? 'late' : s >= BANDS.ageing ? 'ageing' : 'normal');
    const mins = s => Math.max(0, Math.floor((s || 0) / 60));
    const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

    let staged = null;

    function rackDots(racks) {
      if (!racks || !racks.length) return '';
      return '<span class="pcard__racks"><span class="pcard__racks-label" ' +
        biAttr('Rak', 'Racks') + '>Rak</span>' +
        racks.map(r => '<span class="rackdot">' + esc(r) + '</span>').join('') + '</span>';
    }

    /* The design marks a test order two ways, and both matter: `is-test` on the
       article draws the amber band through ::before, and a badge-test span sits
       beside the ref inside .pcard__top. An earlier version of this renderer
       invented pcard__test / pcard__test-badge, which exist in neither the CSS
       nor the mockup, so the badge rendered as bare unstyled text and the band
       never appeared at all. */
    const testBadge = c => c.is_test
      ? '<span class="badge-test" ' + biAttr('UJI COBA', 'TEST') + '>UJI COBA</span>' : '';

    // The release control carries the design's own icon.
    const RELEASE_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3.5v9"/><path d="M8.2 9l3.8 3.5L15.8 9"/><path d="M4.5 15v5.5h15V15"/></svg>';

    function facts(c) {
      return '<span class="pcard__facts">' +
        '<span><span class="n">' + c.line_count + '</span> <span ' +
        biAttr('barang', 'lines') + '>barang</span></span>' +
        '<span class="dot">·</span>' +
        '<span><span class="n">' + c.total_units + '</span> <span ' +
        biAttr('unit', 'units') + '>unit</span></span></span>';
    }

    function shortFlag(c) {
      if (!c.short_lines) return '';
      return '<span class="shortflag"><span aria-hidden="true">!</span><span>' +
        c.short_lines + ' <span ' +
        biAttr('baris kurang stok — perlu diputuskan orang',
               'lines short — a person must decide') +
        '>baris kurang stok — perlu diputuskan orang</span></span></span>';
    }

    function waitingCard(c) {
      const b = band(c.age_seconds);
      const chip = b === 'normal' ? '' :
        '<span class="agechip agechip--' + b + '"><span class="agechip__dot"></span><span ' +
        (b === 'late' ? biAttr('Terlambat', 'Late') : biAttr('Menua', 'Ageing')) + '>' +
        (b === 'late' ? 'Terlambat' : 'Menua') + '</span></span>';
      return '<article class="pcard' + (b === 'normal' ? '' : ' is-' + b) +
        (c.is_test ? ' is-test' : '') +
        '" data-task="' + c.id + '" data-age-seconds="' + c.age_seconds + '">' +
        '<span class="pcard__rule" aria-hidden="true"></span>' +
        '<span class="pcard__top"><span class="pcard__ref" data-field="ref">' +
        esc(c.external_ref) + '</span>' + testBadge(c) + '</span>' +
        '<span class="pcard__age"><span class="pcard__age-num" data-field="age">' +
        mins(c.age_seconds) + '</span><span class="pcard__age-unit" ' +
        biAttr('menit menunggu', 'min waiting') + '>menit menunggu</span>' + chip + '</span>' +
        facts(c) + rackDots(c.racks) + shortFlag(c) + '</article>';
    }

    function claimedCard(c) {
      const held = c.held_seconds || 0;
      const stuck = held >= BANDS.stuck;
      const who = c.claimed_by_name || (c.claimed_by || '').split('@')[0] || '—';
      return '<article class="pcard' + (stuck ? ' is-stuck' : '') +
        (c.is_test ? ' is-test' : '') +
        '" data-task="' + c.id + '" data-age-seconds="' + c.age_seconds + '">' +
        '<span class="pcard__rule" aria-hidden="true"></span>' +
        '<span class="pcard__top"><span class="pcard__ref" data-field="ref">' +
        esc(c.external_ref) + '</span>' + testBadge(c) + '</span>' +
        '<span class="pcard__age"><span class="pcard__age-num" data-field="age">' +
        mins(c.age_seconds) + '</span><span class="pcard__age-unit" ' +
        biAttr('menit sejak pesanan masuk', 'min since the order arrived') +
        '>menit sejak pesanan masuk</span></span>' +
        facts(c) + rackDots(c.racks) +
        '<span class="pcard__picker"><span class="pcard__avatar" aria-hidden="true">' +
        esc(initials(who)) + '</span><span class="pcard__who">' +
        '<span class="pcard__who-name">' + esc(who) + '</span>' +
        '<span class="pcard__who-held" data-field="held" ' +
        biAttr('Ditahan ' + mins(held) + ' menit', 'Held ' + mins(held) + ' min') +
        '>Ditahan ' + mins(held) + ' menit</span>' +
        '</span></span>' +
        '<span class="pcard__foot">' +
        (stuck ? '<span class="agechip agechip--stuck"><span class="agechip__dot"></span><span ' +
                 biAttr('Klaim tersendat', 'Stuck claim') + '>Klaim tersendat</span></span>' : '') +
        '<span class="toolbar__spacer"></span>' +
        '<button class="cbtn cbtn--primary" type="button" data-release="' + c.id +
        '" data-holder="' + esc(who) + '" data-ref="' + esc(c.external_ref) +
        '" data-held="' + mins(held) + '">' + RELEASE_ICON + '<span ' +
        biAttr('Lepaskan ke antrean', 'Release to the queue') + '>Lepaskan ke antrean</span></button>' +
        '</span></article>';
    }

    function render(board) {
      const lane = k => board.lanes.find(l => l.key === k) || { cards: [], count: 0 };
      const waiting = lane('waiting'), claimed = lane('picking'), done = lane('done_today');

      const wHost = region('waiting');
      if (wHost) wHost.innerHTML = waiting.cards.length
        ? waiting.cards.slice().sort((a, b) => b.age_seconds - a.age_seconds).map(waitingCard).join('')
        : '<p class="note" ' + biAttr('Antrean kosong.', 'The queue is empty.') + '>Antrean kosong.</p>';

      const cHost = region('claimed');
      if (cHost) cHost.innerHTML = claimed.cards.length
        ? claimed.cards.slice().sort((a, b) => (b.held_seconds || 0) - (a.held_seconds || 0))
            .map(claimedCard).join('')
        : '<p class="note" ' + biAttr('Tidak ada yang sedang diambil.', 'Nobody is picking.') +
          '>Tidak ada yang sedang diambil.</p>';

      const dHost = region('done');
      if (dHost) dHost.innerHTML = done.cards.slice(0, 8).map(c =>
        '<span class="donerow"><span class="donerow__ref">' + esc(c.external_ref) + '</span>' +
        '<span class="donerow__time">' + NJW.fmt.time(c.completed_at) + '</span></span>').join('') +
        (done.count > 8 ? '<span class="donerow" style="color:var(--muted-2)">…dan ' +
          (done.count - 8) + ' lainnya</span>' : '');

      // The mockup hard-codes "4 mnt 12 dtk" here. Compute it or say nothing:
      // an invented average on an ops board is a number someone will quote in a
      // meeting.
      const finished = done.cards.filter(c => c.completed_at && c.created_at);
      if (finished.length) {
        const avg = finished.reduce((n, c) =>
          n + (new Date(c.completed_at) - new Date(c.created_at)) / 1000, 0) / finished.length;
        bi(field('avg-pick'), Math.floor(avg / 60) + ' mnt ' + Math.round(avg % 60) + ' dtk',
                              Math.floor(avg / 60) + ' min ' + Math.round(avg % 60) + ' s');
      } else {
        bi(field('avg-pick'), '—', '—');
      }
      setF('count-waiting', waiting.count);
      setF('count-claimed', claimed.count);
      setF('count-done', done.count);
      const stuckCards = claimed.cards.filter(c => (c.held_seconds || 0) >= BANDS.stuck);
      setF('count-stuck', stuckCards.length);
      const oldestEl = field('oldest-waiting');
      if (oldestEl) {
        if (board.oldest_waiting_seconds == null) bi(oldestEl, '—', '—');
        else bi(oldestEl, mins(board.oldest_waiting_seconds) + ' menit',
                          mins(board.oldest_waiting_seconds) + ' min');
      }

      // The stuck banner names one order; it exists to be acted on, not admired.
      const alert = region('stuck-alert');
      if (alert) {
        const s = stuckCards[0];
        alert.style.display = s ? '' : 'none';
        if (s) {
          const who = s.claimed_by_name || (s.claimed_by || '').split('@')[0];
          setF('stuck-ref', s.external_ref);
          bi(field('stuck-held'), mins(s.held_seconds) + ' menit',
                                   mins(s.held_seconds) + ' min');
          setF('stuck-holder', who);
          const btn = $('[data-release]', alert);
          if (btn) {
            btn.dataset.release = s.id;
            btn.dataset.holder = who;
            btn.dataset.ref = s.external_ref;
            btn.dataset.held = mins(s.held_seconds);
          }
        }
      }
      applyLangTo(document.querySelector('.board') || document);
    }

    function signature(board) {
      return board.lanes.map(l => l.key + ':' + l.cards.map(c =>
        c.id + c.status + (c.claimed_by || '') + c.picked_units).join('|')).join('~');
    }

    let lastSig = null;

    async function poll(force) {
      try {
        const board = await api().pickBoard({ site_id: SITE.id });
        const sig = signature(board);
        if (force || lastSig === null) {
          lastSig = sig;
          render(board);
        } else if (sig !== lastSig) {
          // Park changes rather than reflowing cards under the supervisor's
          // cursor mid-click; the pill is how the board asks permission.
          staged = board;
          lastSig = sig;
          const n = field('staged-count');
          if (n) n.textContent = board.lanes.reduce((t, l) => t + l.count, 0);
          const pill = $('.stagepill');
          if (pill) pill.classList.add('is-on');
        }
        setF('last-poll', 'Diperbarui ' + NJW.fmt.time(new Date().toISOString()));
      } catch (e) { /* app.js's connection indicator already says so */ }
    }

    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="apply-staged"]')) {
        if (staged) { render(staged); staged = null; }
        const pill = $('.stagepill');
        if (pill) pill.classList.remove('is-on');
        return;
      }
      if (e.target.closest('[data-action="poll-now"]')) return poll(true);
      const rel = e.target.closest('[data-action="confirm-release"]');
      if (rel) {
        const id = rel.dataset.taskId;
        if (!id) return;
        closeDialog();
        try {
          await api().releasePickTask(id);
          say('Dikembalikan ke antrean.');
          await poll(true);
        } catch (err) { fail(err); }
      }
    });

    /* The confirm dialog. Its open/close lived in the design's demo script,
       which this file replaces, so the behaviour is reimplemented here rather
       than left as dead markup: releasing another person's work must never be
       a silent click, and the dialog is what names the holder before it acts. */
    const dlg = () => $('#dlg-release');
    const scrim = () => $('.scrim');
    function closeDialog() {
      const d = dlg(), sc = scrim();
      if (d) d.classList.remove('is-open');
      if (sc) sc.classList.remove('is-open');
    }
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-release]');
      if (btn) {
        const holder = btn.dataset.holder || '—';
        setF('dlg-holder', holder);
        setF('dlg-avatar', holder.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase());
        setF('dlg-ref', btn.dataset.ref || '—');
        setF('dlg-held', (btn.dataset.held || '?') + ' menit');
        const confirm = $('[data-action="confirm-release"]');
        if (confirm) confirm.dataset.taskId = btn.dataset.release;
        const d = dlg(), sc = scrim();
        if (d) d.classList.add('is-open');
        if (sc) sc.classList.add('is-open');
        return;
      }
      if (e.target.closest('[data-drawer-close]') || e.target.classList.contains('scrim')) {
        closeDialog();
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDialog(); });

    await poll(true);
    setInterval(() => { if (!document.hidden) poll(false); }, 10000);
  };

  /* ======================= dispatch ======================= */

  window.addEventListener('DOMContentLoaded', async () => {
    const app = $('.app') || $('.shell') || $('[data-screen]');
    const name = app ? app.dataset.screen : '';
    if (name === 'blocked') return screens.blocked();
    if (!(await boot())) return;
    const fn = screens[name];
    if (fn) { try { await fn(); } catch (e) { fail(e); } }
  });
})();
