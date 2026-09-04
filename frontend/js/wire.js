/* wire.js — connects the design's screens to the API.
 *
 * The design ships one HTML page per screen with demo behaviour in a trailing
 * <script>. This file replaces all of that: it boots identity, fills the chrome,
 * dispatches on [data-screen], and drives each flow against real endpoints.
 *
 * Nothing here changes the design's markup vocabulary — it populates the nodes
 * the design already marked (`data-field`, `data-region`) and builds lists from
 * the same classes the mockups use, so restyling stays a CSS job.
 *
 * Flow state crosses pages in sessionStorage: each screen is its own document.
 */
(function () {
  'use strict';

  const NJW = (window.NJW = window.NJW || {});

  /* ---------- context that survives a page change ---------- */

  const CTX = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('njw.' + k)); } catch { return null; } },
    set(k, v) { sessionStorage.setItem('njw.' + k, JSON.stringify(v)); },
    del(k) { sessionStorage.removeItem('njw.' + k); },
  };
  NJW.ctx = CTX;

  /* ---------- api ---------- */

  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((data && data.detail) || ('HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  NJW.api = api;

  /* ---------- small helpers ---------- */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const field = f => $('[data-field="' + f + '"]');
  const setField = (f, v) => { const el = field(f); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const go = p => { location.href = p; };

  /* A location code is what a person navigates by, so rack and level are the
     parts that get the accent — the design's own .code__hl. */
  function codeHtml(code) {
    const p = String(code || '').split('-');
    if (p.length < 3) return esc(code || '—');
    return esc(p[0]) + '-<span class="code__hl">' + esc(p[1]) + '</span>-' +
      '<span class="code__hl">' + esc(p[2]) + '</span>' + (p[3] ? '-' + esc(p[3]) : '');
  }

  function photoFor(sku) {
    const code = (sku && sku.brand_sku_code ? sku.brand_sku_code : '').toLowerCase();
    return code ? 'assets/products/' + code + '.jpg' : 'assets/products/placeholder.svg';
  }

  /* The design writes both languages into the markup as data-id / data-en.
     Text we generate has to carry both or the EN toggle would blank it. */
  function bi(el, id, en) {
    if (!el) return;
    el.dataset.id = id;
    el.dataset.en = en || id;
    el.textContent = (localStorage.getItem('njw.lang') === 'en') ? (en || id) : id;
  }

  function say(msg) {
    let bar = $('.wire-toast');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wire-toast notice notice--action';
      bar.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
        'z-index:60;max-width:90vw;box-shadow:0 6px 24px rgba(0,0,0,.2)';
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    clearTimeout(say._t);
    say._t = setTimeout(() => bar.remove(), 3600);
  }

  function fail(e) {
    if (e && e.status === 401) { go('14-terkunci.html'); return; }
    say((e && e.message) || 'Ada masalah. Panggil supervisor.');
  }

  /* ---------- boot: identity, site, chrome ---------- */

  let ME = null, SITE = null;

  async function boot() {
    try {
      ME = await api('GET', '/me');
    } catch (e) {
      if (e.status === 403) {
        document.body.innerHTML =
          '<div class="banner banner--stop" style="margin:40px">' +
          '<span class="banner__icon">!</span>' + esc(e.message) + '</div>';
        return false;
      }
      go('14-terkunci.html');
      return false;
    }

    const saved = CTX.get('site');
    SITE = ME.sites.find(s => s.id === saved)
      || ME.sites.find(s => s.id === ME.default_site_id)
      || ME.sites[0];
    if (SITE) CTX.set('site', SITE.id);
    NJW.me = ME; NJW.site = SITE;

    paintChrome();
    NJW.startHeartbeat('/health', 20000);
    return true;
  }

  function paintChrome() {
    const user = $('.chrome__user');
    if (user) user.textContent = ME.name + ' · ' + (SITE ? SITE.code : '—');

    // The site picker replaces the mockup's static "Station UT5" label.
    const mode = $('.chrome__mode');
    if (mode && ME.sites.length && !$('#siteSel')) {
      const screen = ($('.app') || {}).dataset ? $('.app').dataset.screen : '';
      if (screen === 'home') {
        const sel = document.createElement('select');
        sel.id = 'siteSel';
        sel.className = 'chrome__mode';
        sel.style.cssText = 'background:var(--surface);color:var(--ink);' +
          'border:1px solid var(--rule);min-height:40px;padding:0 8px';
        sel.innerHTML = ME.sites.map(s =>
          '<option value="' + s.id + '"' + (SITE && s.id === SITE.id ? ' selected' : '') + '>' +
          esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join('');
        sel.onchange = () => { CTX.set('site', +sel.value); location.reload(); };
        mode.replaceWith(sel);
      } else {
        mode.textContent = SITE ? SITE.code : '';
      }
    }

    // A training site must be impossible to be in by accident.
    // Some screens (the wrong-item stop, the blocked screen) deliberately ship
    // no chrome header, so this has to place itself without one.
    if (SITE && SITE.is_training && !$('.wire-training')) {
      const b = document.createElement('div');
      b.className = 'wire-training banner banner--caution';
      b.style.cssText = 'min-height:44px;font-size:17px;letter-spacing:.06em';
      b.innerHTML = '<span class="banner__icon" aria-hidden="true">!</span>' +
        '<span data-id="MODE LATIHAN — barang tidak nyata, aman untuk salah" ' +
        'data-en="TRAINING MODE — not real stock, safe to get wrong">' +
        'MODE LATIHAN — barang tidak nyata, aman untuk salah</span>';
      const chrome = $('.chrome');
      if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(b, chrome.nextSibling);
      else document.body.insertBefore(b, document.body.firstChild);
    }
  }

  /* Tappable test barcodes, so a training screen works with no scanner and no
     stock. Only ever rendered on a training site. */
  async function testCodes(zone, after) {
    if (!SITE || !SITE.is_training || !zone) return;
    try {
      const sheet = await api('GET', '/training/barcode-sheet?site_id=' + SITE.id + '&limit=18');
      if (!sheet.rows.length) return;
      const box = document.createElement('div');
      box.className = 'panel';
      box.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      box.innerHTML = '<span class="eyebrow" data-id="Barcode uji" data-en="Test barcodes">Barcode uji</span>';
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
      zone.parentNode.insertBefore(box, zone.nextSibling);
    } catch { /* training-only nicety */ }
  }

  /* ---------- screens ---------- */

  const screens = {};

  /* --- home --- */
  screens.home = async () => {
    const cards = $$('.home__card');
    try {
      const [tasks, inv] = await Promise.all([
        api('GET', '/pick-tasks?site_id=' + SITE.id + '&status=ready'),
        api('GET', '/inventory?site_id=' + SITE.id + '&limit=1000'),
      ]);
      const n = tasks.tasks.length;
      const pickNote = $('.note', cards[2]);
      bi(pickNote, n ? n + ' pesanan menunggu diambil' : 'Belum ada pesanan',
                   n ? n + ' orders waiting to pick' : 'No orders waiting');
      const stale = inv.rows.filter(r => !r.last_counted_at).length;
      bi($('.note', cards[3]), stale + ' keranjang belum dihitung',
                               stale + ' baskets not counted yet');
    } catch (e) { fail(e); }

    // Training tools live behind the rack-map card's row, not in the main menu.
    if (SITE.is_training) {
      const nav = $('.home');
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'home__card';
      a.innerHTML = '<span class="eyebrow">Alur F</span>' +
        '<span class="home__title" data-id="Alat latihan" data-en="Training tools">Alat latihan</span>' +
        '<span class="note" data-id="Reset, muat skenario, buat pesanan uji" ' +
        'data-en="Reset, load a scenario, make test orders">Reset, muat skenario, buat pesanan uji</span>';
      a.onclick = trainingPanel;
      nav.appendChild(a);
    }
  };

  async function trainingPanel() {
    const { scenarios } = await api('GET', '/training/scenarios');
    const main = $('.main');
    main.innerHTML = '<h1 class="h1" data-id="Alat latihan" data-en="Training tools">Alat latihan</h1>' +
      '<div class="stats"><button class="btn btn--primary btn--lg" id="rst" ' +
      'data-id="Reset lokasi latihan" data-en="Reset the training site">Reset lokasi latihan</button>' +
      '<button class="btn btn--outline btn--lg" id="ord" ' +
      'data-id="Buat 2 pesanan uji" data-en="Make 2 test orders">Buat 2 pesanan uji</button>' +
      '<a class="btn btn--outline btn--lg" href="index.html" data-id="Kembali" data-en="Back">Kembali</a></div>' +
      '<div class="list" id="scn">' + scenarios.map(s =>
        '<div class="row"><span class="row__code code code--sm">' + esc(s.key) + '</span>' +
        '<span class="row__name">' + esc(s.name_id) + ' — ' + esc(s.teaches) + '</span>' +
        '<button class="btn btn--outline" data-k="' + esc(s.key) + '" ' +
        'data-id="Muat" data-en="Load">Muat</button></div>').join('') + '</div>' +
      '<pre class="panel" id="fx" style="padding:14px;font-size:13px;white-space:pre-wrap"></pre>';

    $('#rst').onclick = async () => {
      try { say((await api('POST', '/training/reset', { site_id: SITE.id })).message); }
      catch (e) { fail(e); }
    };
    $('#ord').onclick = async () => {
      try { say((await api('POST', '/training/orders/generate', { site_id: SITE.id, count: 2 })).message); }
      catch (e) { fail(e); }
    };
    $$('#scn [data-k]').forEach(b => b.onclick = async () => {
      try {
        const r = await api('POST', '/training/load', { site_id: SITE.id, scenario: b.dataset.k });
        $('#fx').textContent = JSON.stringify(r.fixture, null, 2);
        say(r.message);
      } catch (e) { fail(e); }
    });
  }

  /* --- A: inbound --- */

  screens['inbound-start'] = async () => {
    // The mockup lists three fictional deliveries; replace the table with the
    // real open receipts at this site, and make the button open a new one.
    const table = $('.choice--primary .table tbody');
    const btn = $('.choice--primary .btn');
    if (table) table.closest('table').remove();

    btn.textContent = btn.dataset.id = 'Mulai terima kiriman';
    btn.dataset.en = 'Start receiving';
    btn.removeAttribute('href');
    btn.onclick = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/receipts', { site_id: SITE.id, source_type: 'from_brand' });
        CTX.set('receipt', r.id);
        CTX.set('receiptSession', 0);
        go('02-barang-masuk-scan.html');
      } catch (err) { fail(err); }
    };

    const zone = $('.scanzone').__zone;
    if (zone) zone.onScan(async code => {
      try {
        const r = await api('POST', '/receipts', {
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

    const zone = $('.scanzone').__zone;
    const banner = $('[data-region="result"]');
    const mode = $('.chrome__mode');
    if (mode) mode.textContent = 'Barang masuk · #' + receiptId;

    let lastCode = null;

    function showResult(kind, title, detail) {
      banner.className = 'banner banner--' + kind;
      banner.innerHTML = '<span class="banner__icon banner__icon--round" aria-hidden="true">' +
        (kind === 'accept' ? '✓' : '!') + '</span><span>' + esc(title) + '</span>' +
        '<span class="chrome__sep"></span><span class="banner__detail" data-field="product">' +
        esc(detail) + '</span>';
    }

    function paintProduct(sku, locationCode, basketQty, capacityNote) {
      const left = $('.row-split .col');
      const img = $('.product__photo', left);
      if (img) { img.src = photoFor(sku); img.alt = sku.name_display; }
      $('.product__meta', left).textContent =
        [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
      $('.product__name', left).textContent = sku.name_display;

      const codeEl = $('.code--xl');
      if (codeEl) codeEl.innerHTML = codeHtml(locationCode);
      const lede = $('.lede');
      const parts = String(locationCode || '').split('-');
      if (lede && parts.length >= 3) {
        bi(lede, 'Rak ' + parts[1] + ', tingkat ' + parts[2] + '.',
                 'Rack ' + parts[1] + ', level ' + parts[2] + '.');
      }
      setField('basket-qty', basketQty);
      const foot = field('basket-qty') && field('basket-qty').nextElementSibling;
      if (foot && capacityNote) bi(foot, capacityNote, capacityNote);
    }

    async function doScan(code) {
      lastCode = code;
      try {
        const r = await api('POST', '/receipts/' + receiptId + '/scan',
          { code, qty: 1, idempotency_key: key() });

        if (r.accepted) {
          CTX.set('receiptSession', r.session_total);
          setField('session-qty', r.session_total);
          paintProduct(r.sku, r.location_code, r.qty_in_basket);
          if (r.outcome === 'over_capacity') {
            zone.accept('Keranjang penuh', r.message);
            showResult('caution', 'Keranjang penuh', r.message);
          } else {
            zone.accept('Diterima', 'Simpan di ' + r.location_code);
            showResult('accept', 'Diterima', r.sku.name_display);
          }
          NJW.undo.push({ code, qty: 1 });
          return;
        }

        if (r.outcome === 'no_slot') {
          CTX.set('pendingSku', r.sku);
          CTX.set('pendingCode', code);
          go('04-buat-keranjang.html');
          return;
        }

        CTX.set('pendingCode', code);
        zone.reject('Barcode tidak dikenal', code);
        go('03-barcode-tidak-dikenal.html');
      } catch (e) {
        zone.reject('Gagal', e.message);
      }
    }

    zone.onScan(doScan);
    testCodes($('.scanzone'), doScan);
    setField('session-qty', CTX.get('receiptSession') || 0);

    const undoBtn = $('[data-action="undo"]');
    if (undoBtn) undoBtn.onclick = () => {
      const last = NJW.undo.pop();
      if (!last) return say('Tidak ada yang bisa dibatalkan.');
      say('Batalkan belum tersedia — catat ke supervisor.');
      NJW.undo.push(last);
    };

    const finish = $('.btn--primary');
    if (finish) finish.onclick = async () => {
      try {
        const s = await api('POST', '/receipts/' + receiptId + '/complete');
        CTX.del('receipt');
        say('Selesai: ' + s.total_units + ' unit.');
        setTimeout(() => go('index.html'), 900);
      } catch (e) { fail(e); }
    };
  };

  screens['unknown-barcode'] = async () => {
    const code = CTX.get('pendingCode') || '';
    $$('.code').forEach(el => { if (/^\s*\d/.test(el.textContent) || el.dataset.wire) el.textContent = code; });
    const codeEl = $('.code--xl') || $('.code--lg') || $('.code');
    if (codeEl) codeEl.textContent = code;

    // "Register to a product" needs a SKU chosen first; keep it to one search.
    const primary = $('.btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.onclick = async (e) => {
        e.preventDefault();
        const q = prompt('Nama barang (ketik sebagian):');
        if (!q) return;
        try {
          const r = await api('GET', '/skus?q=' + encodeURIComponent(q) + '&limit=10');
          if (!r.skus.length) return say('Tidak ketemu.');
          const pick = r.skus.length === 1 ? r.skus[0] : r.skus[
            Math.max(0, (parseInt(prompt(r.skus.map((s, i) =>
              (i + 1) + '. ' + s.name_display).join('\n') + '\n\nNomor:'), 10) || 1) - 1)];
          await api('POST', '/barcodes/register', { sku_id: pick.id, barcodes: [code] });
          say('Terdaftar: ' + pick.name_display);
          setTimeout(() => go('02-barang-masuk-scan.html'), 700);
        } catch (err) { fail(err); }
      };
    }
    $$('a.btn').forEach(a => {
      if (/lewati|skip/i.test(a.textContent)) a.href = '02-barang-masuk-scan.html';
    });
  };

  screens['create-basket'] = async () => {
    const sku = CTX.get('pendingSku');
    const code = CTX.get('pendingCode');
    if (!sku) return go('02-barang-masuk-scan.html');

    let suggestion = null;
    try {
      suggestion = await api('GET', '/slots/suggest?site_id=' + SITE.id + '&sku_id=' + sku.id);
    } catch (e) { return fail(e); }

    const name = $('.product__name');
    if (name) name.textContent = sku.name_display;
    const meta = $('.product__meta');
    if (meta) meta.textContent = [sku.brand_code, sku.unit_size, sku.brand_sku_code]
      .filter(Boolean).join(' · ');
    const img = $('.product__photo');
    if (img) { img.src = photoFor(sku); img.alt = sku.name_display; }

    const codeEl = $('.code--xl') || $('.code--lg');
    if (codeEl) codeEl.innerHTML = codeHtml(suggestion.location_code);
    const lede = $('.lede');
    if (lede) bi(lede, suggestion.reason, suggestion.reason);

    const primary = $('.btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.onclick = async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/slots', {
            site_id: SITE.id, sku_id: sku.id, created_during_inbound: true,
          });
          CTX.del('pendingSku');
          say('Keranjang dibuat: ' + suggestion.location_code);
          // Resume the very unit that triggered this.
          if (code) {
            await api('POST', '/receipts/' + CTX.get('receipt') + '/scan',
              { code, qty: 1, idempotency_key: key() });
          }
          setTimeout(() => go('02-barang-masuk-scan.html'), 600);
        } catch (err) { fail(err); }
      };
    }
  };

  screens['inbound-bulk-upload'] = async () => {
    const fileInput = $('#fileInput');
    const box = $('#resultBox');
    const submit = $('#submitBtn');

    function renderResult(r) {
      box.style.display = 'block';
      if (r.ok) {
        box.className = 'panel banner banner--accept';
        box.innerHTML = '<div class="col"><span>' + esc(r.message) + '</span></div>';
      } else {
        box.className = 'panel';
        box.innerHTML = '<div class="col" style="gap:8px">' +
          '<span class="banner__icon" aria-hidden="true">!</span>' +
          '<span>' + esc(r.message) + '</span>' +
          '<div class="list">' + r.errors.map(e =>
            '<div class="row"><span class="row__name">' + esc(e.message) + '</span></div>'
          ).join('') + '</div></div>';
      }
    }

    submit.onclick = async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) { say('Pilih file dulu.'); return; }
      const fd = new FormData();
      fd.append('file', f);
      submit.setAttribute('aria-disabled', 'true');
      try {
        const res = await fetch('/api/stock-uploads', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || ('HTTP ' + res.status));
        renderResult(data);
        if (data.ok) fileInput.value = '';
      } catch (e) { fail(e); } finally {
        submit.removeAttribute('aria-disabled');
      }
    };
  };

  screens['stock-upload-list'] = async () => {
    const body = $('#itemsBody');
    const emptyNote = $('#emptyNote');
    try {
      const r = await api('GET', '/stock-uploads/items?site_id=' + SITE.id + '&limit=500');
      if (!r.items.length) { emptyNote.style.display = 'block'; return; }
      body.innerHTML = r.items.map(it =>
        '<tr>' +
        '<td class="td-code">' + esc(it.site_code) + '</td>' +
        '<td class="td-code">' + esc(it.barcode) + '</td>' +
        '<td>' + esc(it.brand_name) + '</td>' +
        '<td>' + esc(it.sku_name) + '</td>' +
        '<td class="td-code">' + esc(it.location_code) +
          (it.location_was_blank ? ' <span class="note">(default)</span>' : '') + '</td>' +
        '<td>' + esc(it.input_date_raw || '—') + '</td>' +
        '<td>' + esc((it.uploaded_by || '—').split('@')[0]) + '</td>' +
        '</tr>'
      ).join('');
    } catch (e) { fail(e); }
  };

  /* --- B: labelling (Mode B) --- */

  screens['label-unit'] = async () => {
    let sku = CTX.get('labelSku');
    if (!sku) {
      try {
        const r = await api('GET', '/skus?limit=200');
        const modeB = r.skus.filter(s => s.identity_mode === 'unit_label');
        if (!modeB.length) { say('Tidak ada barang tanpa barcode.'); return go('index.html'); }
        sku = modeB[0];
        CTX.set('labelSku', sku);
      } catch (e) { return fail(e); }
    }

    const img = $('.product__photo');
    if (img) { img.src = photoFor(sku); img.alt = sku.name_display; }
    $('.product__meta').textContent =
      [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
    $('.product__name').textContent = sku.name_display;
    const note = $('.notice--action span[style]');
    if (note && sku.label_placement_note) bi(note, sku.label_placement_note, sku.label_placement_note);

    let n = 0;
    let stock = { unbound: 0 };
    try { stock = await api('GET', '/plates/stock?site_id=' + SITE.id); } catch { /* shown below */ }
    const lede = $('.lede');
    if (lede) bi(lede, 'sisa ' + stock.unbound + ' label kosong',
                       stock.unbound + ' blank labels left');
    if (stock.unbound === 0) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--outline btn--lg btn--block';
      bi(b, 'Buat 200 label baru', 'Make 200 new labels');
      b.onclick = async () => {
        try { await api('POST', '/plates/ranges', { site_id: SITE.id, count: 200 });
              say('200 label dibuat.'); location.reload(); } catch (e) { fail(e); }
      };
      $('.col--grow').prepend(b);
    }

    const zone = $('.scanzone').__zone;
    zone.onScan(async code => {
      try {
        const r = await api('POST', '/plates/bind', {
          site_id: SITE.id, sku_id: sku.id, plate_code: code, idempotency_key: key(),
        });
        if (r.accepted) {
          n = r.bound_count;
          setField('count', n);
          const bar = field('bar');
          if (bar) bar.style.width = Math.min(100, n / 200 * 100) + '%';
          setField('last', code);
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
        await api('POST', '/plates/' + encodeURIComponent(last.plate) + '/unbind?reason=undo');
        setField('count', Math.max(0, --n));
        say('Label dilepas.');
      } catch (e) { fail(e); }
    };

    const done = $('.btn--primary');
    if (done) done.onclick = () => { CTX.del('labelSku'); go('index.html'); };
  };

  screens['label-bound'] = async () => {
    const msg = CTX.get('boundMsg') || '';
    const plate = CTX.get('boundPlate') || '';
    const codeEl = $('.code--xl') || $('.code--lg') || $('.code');
    if (codeEl) codeEl.textContent = plate;
    const lede = $('.lede');
    if (lede) bi(lede, msg, msg);
    $$('a.btn').forEach(a => { a.href = '05-label-unit.html'; });
  };

  /* --- C: pick --- */

  screens.pick = async () => {
    let task = CTX.get('task');
    try {
      if (!task) {
        const list = await api('GET', '/pick-tasks?site_id=' + SITE.id + '&status=ready');
        if (!list.tasks.length) {
          $('.main').innerHTML =
            '<h1 class="h1" data-id="Belum ada pesanan" data-en="No orders waiting">Belum ada pesanan</h1>' +
            '<p class="lede" data-id="Tunggu pesanan masuk dari Grab." ' +
            'data-en="Wait for an order to arrive from Grab.">Tunggu pesanan masuk dari Grab.</p>' +
            '<a class="btn btn--primary btn--lg" href="index.html" data-id="Kembali" data-en="Back">Kembali</a>';
          return;
        }
        task = await api('POST', '/pick-tasks/' + list.tasks[0].id + '/claim');
        CTX.set('task', task);
      }
    } catch (e) { return fail(e); }

    const mode = $('.chrome__mode');
    if (mode) mode.textContent = 'Ambil · ' + task.external_ref;

    function currentLine() {
      return task.lines.find(l => l.status === 'pending');
    }

    function paint() {
      const line = currentLine();
      if (!line) return finish();

      $('.code--xl').innerHTML = codeHtml(line.location_code);
      const parts = String(line.location_code || '').split('-');
      if (parts.length >= 3) {
        bi($('.lede'), 'Rak ' + parts[1] + ', tingkat ' + parts[2] + '.',
                       'Rack ' + parts[1] + ', level ' + parts[2] + '.');
      }
      $('.counter__num').textContent = line.qty_required - line.qty_picked;
      const sub = $('.counter .lede');
      const idx = task.lines.indexOf(line) + 1;
      if (sub) bi(sub, 'Barang ' + idx + ' dari ' + task.lines.length,
                       'Item ' + idx + ' of ' + task.lines.length);

      const img = $('.product__photo');
      if (img) { img.src = 'assets/products/placeholder.svg'; img.alt = line.sku_name; }
      $('.product__name').textContent = line.sku_name;
      $('.product__meta').textContent = line.location_code || '';
      return line;
    }

    const zone = $('.scanzone').__zone;
    zone.onScan(async code => {
      const line = currentLine();
      if (!line) return;
      try {
        const r = await api('POST', '/pick-lines/' + line.id + '/confirm', {
          code, qty: line.qty_required - line.qty_picked, idempotency_key: key(),
        });
        if (!r.accepted) {
          CTX.set('wrong', {
            scanned: r.scanned_sku_name || code,
            expected: r.expected_sku_name,
            location: line.location_code,
          });
          zone.reject('Salah barang', r.message);
          setTimeout(() => go('08-salah-barang.html'), 900);
          return;
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
      try { await api('POST', '/pick-tasks/' + task.id + '/complete'); } catch { /* already done */ }
      CTX.set('doneTask', task);
      CTX.del('task');
      go('09-pesanan-selesai.html');
    }

    paint();
    testCodes($('.scanzone'), c => zone.handlers[0](c, zone));

    const short = $('.btn--caution');
    if (short) short.onclick = () => say('Alur barang hilang belum dibuat — panggil supervisor.');
  };

  screens['wrong-item'] = async () => {
    const w = CTX.get('wrong') || {};

    const cards = $$('.card-compare');
    const fill = (card, name, code) => {
      if (!card) return;
      const n = $('.product__name', card);
      if (n) n.textContent = name || '—';
      const img = $('.card-compare__photo', card);
      if (img) { img.src = 'assets/products/placeholder.svg'; img.alt = name || ''; }
      const meta = $('.code--sm', card);
      if (meta) meta.textContent = code || '';
    };
    fill(cards[0], w.scanned, '');
    fill(cards[1], w.expected, w.location || '');

    // The instruction names the basket, because that is where both items live.
    const instr = $('.col p[style]');
    if (instr) {
      const id = 'Kembalikan barang itu, lalu ambil ' + (w.expected || 'yang benar') +
        ' dari keranjang yang sama' + (w.location ? ' — ' + w.location : '') + '.';
      const en = 'Put that item back, then take ' + (w.expected || 'the right one') +
        ' from the same basket' + (w.location ? ' — ' + w.location : '') + '.';
      bi(instr, id, en);
    }
  };

  screens['pick-done'] = async () => {
    const done = CTX.get('doneTask');
    if (done) {
      const tbody = $('.table tbody');
      if (tbody) tbody.innerHTML = done.lines.map(l =>
        '<tr><td class="td-code">' + esc(l.location_code || '') + '</td>' +
        '<td>' + esc(l.sku_name) + '</td>' +
        '<td class="td-qty">' + l.qty_picked + '</td></tr>').join('');

      const eyebrow = $('.eyebrow');
      const units = done.lines.reduce((n, l) => n + l.qty_picked, 0);
      if (eyebrow) bi(eyebrow, units + ' barang · ' + done.lines.length + ' keranjang',
                               units + ' items · ' + done.lines.length + ' baskets');

      // The POS owns the packing ticket; until it is wired, show the order ref.
      const ticket = $('.panel .code');
      if (ticket) { ticket.textContent = done.external_ref; ticket.style.fontSize = '30px'; }
      CTX.del('doneTask');
    }
    const handoff = $('button.btn--primary');
    if (handoff) handoff.onclick = () => go('07-ambil-pesanan.html');
  };

  /* --- D: stock count --- */

  screens['count-list'] = async () => {
    let planId = CTX.get('plan');
    try {
      if (!planId) {
        const p = await api('POST', '/opname/plans', { site_id: SITE.id, name: 'Hitung stok' });
        planId = p.id;
        CTX.set('plan', planId);
      }
      const d = await api('GET', '/opname/plans/' + planId);
      const count = $('.progress__count');
      if (count) count.innerHTML = d.plan.counted + ' / ' + d.plan.total_baskets +
        ' <span class="note" data-id="keranjang selesai" data-en="baskets done">keranjang selesai</span>';

      const list = $('.list');
      list.innerHTML = d.baskets.map((b, i) => {
        const busy = b.status === 'counting' && b.claimed_by && b.claimed_by !== ME.email;
        const done = b.status === 'finished';
        const next = !busy && !done && !d.baskets.slice(0, i).some(x =>
          x.status !== 'finished' && !(x.status === 'counting' && x.claimed_by !== ME.email));
        return '<div class="row' + (done ? ' row--done' : busy ? ' row--claimed' : next ? ' row--next' : '') + '">' +
          '<span class="row__code code code--md">' + esc(b.location_code) + '</span>' +
          '<span class="row__name">' + esc(b.sku_name || '—') + '</span>' +
          (busy ? '<span class="row__state"><span class="code code--sm">!</span>' +
                  '<span>Sedang dihitung: ' + esc(b.claimed_by.split('@')[0]) + '</span></span>' : '') +
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
          const s = await api('POST', '/opname/sessions',
            { plan_id: planId, basket_id: +btn.dataset.b });
          CTX.set('session', s);
          go('11-hitung-menghitung.html');
        } catch (e) { say(e.message); }
      });
    } catch (e) { fail(e); }
  };

  screens.counting = async () => {
    const s = CTX.get('session');
    if (!s) return go('10-hitung-pilih-keranjang.html');

    const codeEl = $('.code--lg');
    if (codeEl) codeEl.innerHTML = codeHtml(s.location_code);
    $('.product__name').textContent = s.sku_name || '—';
    $('.product__meta').textContent = s.location_code || '';
    const img = $('.product__photo');
    if (img) { img.src = 'assets/products/placeholder.svg'; img.alt = s.sku_name || ''; }

    // The design counts on a keypad rather than scan-per-unit; the backend
    // records that as count_method 'manual', which is exactly what it is.
    const out = field('count');
    out.textContent = '0';
    let typed = '';
    const set = n => { out.textContent = String(Math.max(0, Math.min(999, n))); };
    $('[data-action="inc"]').onclick = () => { typed = ''; set(+out.textContent + 1); };
    $('[data-action="dec"]').onclick = () => { typed = ''; set(+out.textContent - 1); };
    $$('.keypad__key').forEach(k => k.onclick = () => {
      const v = k.dataset.key;
      if (v === 'del') typed = typed.slice(0, -1);
      else if (v === 'zero') typed = '0';
      else typed = (typed + v).slice(0, 3);
      set(+(typed || 0));
    });

    const save = $('.btn--primary');
    save.removeAttribute('href');
    save.onclick = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', '/opname/sessions/' + s.id + '/finish',
          { manual_qty: +out.textContent });
        CTX.set('result', Object.assign({}, r, {
          location_code: s.location_code, sku_name: s.sku_name,
        }));
        go('12-hasil-hitung.html');
      } catch (err) { fail(err); }
    };
    const skip = $('a.btn--outline');
    if (skip) skip.href = '10-hitung-pilih-keranjang.html';
  };

  screens.variance = async () => {
    const r = CTX.get('result');
    if (!r) return go('10-hitung-pilih-keranjang.html');

    const head = $('.instr');
    if (head) {
      $('.code', head).textContent = r.location_code || '';
      const nameEl = head.lastElementChild;
      if (nameEl) nameEl.textContent = r.sku_name || '';
    }
    const nums = $$('.reveal__num');
    if (nums[0]) nums[0].textContent = r.qty_expected;
    if (nums[1]) nums[1].textContent = r.qty_counted;
    if (nums[2]) nums[2].textContent = (r.variance > 0 ? '+' : r.variance < 0 ? '−' : '') +
      Math.abs(r.variance);

    const delta = $('.reveal__cell--delta');
    if (delta) {
      const foot = delta.lastElementChild;
      const msg = r.variance === 0 ? 'Cocok dengan catatan'
        : Math.abs(r.variance) + (r.variance < 0 ? ' barang kurang dari catatan'
                                                 : ' barang lebih dari catatan');
      bi(foot, msg, msg);
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

  /* --- E: rack map --- */

  screens['rack-map'] = async () => {
    try {
      const m = await api('GET', '/sites/' + SITE.id + '/rack-map');
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
      NJW.renderRackMap($('[data-region="rackmap"]'), racks);
    } catch (e) { fail(e); }
  };

  /* --- blocked --- */

  screens.blocked = async () => {
    const retry = $('.btn--primary');
    if (retry) {
      retry.removeAttribute('href');
      retry.onclick = async () => {
        try { await api('GET', '/me'); go('index.html'); }
        catch { say('Masih belum terhubung.'); }
      };
    }
  };

  /* ---------- go ---------- */

  window.addEventListener('DOMContentLoaded', async () => {
    const app = $('.app');
    const name = app ? app.dataset.screen : '';
    if (name === 'blocked') { await screens.blocked(); return; }
    if (!(await boot())) return;
    const fn = screens[name];
    if (fn) { try { await fn(); } catch (e) { fail(e); } }
  });
})();
