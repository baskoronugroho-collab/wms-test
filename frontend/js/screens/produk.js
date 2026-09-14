/* screens/produk.js — product master: SKUs, barcodes, brands (console/produk.html).
 *
 * GET /api/skus pages server-side (limit/offset, q, brand_id): the Wardah range
 * alone is over a hundred near-identical rows, and the design note asked for it
 * not to be fetched whole for the table. KPIs take one capped read of the
 * whole list instead, because "how many have no photo" is a question about all
 * SKUs, not about the page on screen.
 *
 * Writes: POST /api/skus, POST /api/brands, the two CSV imports (SKUs for one
 * brand; the brand + product-name list stock uploads are checked against), and
 * barcode registration, which checks each code before binding it — a barcode
 * may belong to exactly one SKU.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;

  const PER = 25;
  const OWNER = {
    grab: ['Grab (mis. Wardah)', 'Grab (e.g. Wardah)'],
    brand: ['Brand (konsinyasi)', 'Brand (consignment)'],
    ninja: ['Ninja', 'Ninja'],
  };
  const EXPIRY = {
    stable: ['ok', 'Stabil', 'Stable'],
    watch: ['accent', 'Pantau', 'Watch'],
    short: ['warn', 'Pendek', 'Short'],
  };

  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  function openDrawer(sel) {
    const d = $(sel), sc = $('.scrim');
    if (d) d.classList.add('is-open');
    if (sc) sc.classList.add('is-open');
  }
  function closeDrawers() {
    $$('.drawer.is-open').forEach(d => d.classList.remove('is-open'));
    const sc = $('.scrim');
    if (sc) sc.classList.remove('is-open');
  }

  function pageList(cur, n) {
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const keep = [...new Set([1, n, cur - 1, cur, cur + 1].filter(p => p >= 1 && p <= n))]
      .sort((a, b) => a - b);
    const out = [];
    keep.forEach((p, i) => { if (i && p - keep[i - 1] > 1) out.push('…'); out.push(p); });
    return out;
  }
  function paintPager(total, page, go) {
    const from = total ? (page - 1) * PER + 1 : 0, to = Math.min(total, page * PER);
    setF('range', from + '–' + to);
    setF('total', NJW.fmt.n(total));
    const nav = $('.pager__nav');
    if (!nav) return;
    const pages = Math.max(1, Math.ceil(total / PER));
    nav.innerHTML =
      '<button class="pager__page" type="button" data-pg="' + (page - 1) + '" aria-label="Sebelumnya"' +
      (page <= 1 ? ' disabled' : '') + '>‹</button>' +
      pageList(page, pages).map(p => p === '…' ? '<span class="pager__gap">…</span>'
        : '<button class="pager__page' + (p === page ? ' is-on' : '') + '" type="button" data-pg="' +
          p + '">' + p + '</button>').join('') +
      '<button class="pager__page" type="button" data-pg="' + (page + 1) + '" aria-label="Berikutnya"' +
      (page >= pages ? ' disabled' : '') + '>›</button>';
    nav.onclick = e => {
      const b = e.target.closest('[data-pg]');
      if (b && !b.disabled) go(+b.dataset.pg);
    };
  }

  function downloadCsv(name, rows) {
    const cell = v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')],
      { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* api.js sends JSON only; a CSV import is multipart. Same error contract as
     api.js (detail -> message, status on the error) so fail() treats it alike. */
  async function upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api' + path, { method: 'POST', body: fd, cache: 'no-store' });
    if (!r.ok) {
      let d = r.statusText;
      try { d = (await r.json()).detail || d; } catch (e) { /* not JSON */ }
      const err = new Error(typeof d === 'string' ? d : JSON.stringify(d));
      err.status = r.status;
      throw err;
    }
    return r.json();
  }

  const identitySpill = mode => mode === 'unit_label'
    ? '<span class="spill spill--info"><span ' + biAttr('Label unit', 'Unit label') + '>Label unit</span></span>'
    : '<span class="spill spill--neutral"><span ' + biAttr('Barcode SKU', 'SKU barcode') + '>Barcode SKU</span></span>';

  function row(s) {
    const ex = EXPIRY[s.expiry_tier] || ['neutral', s.expiry_tier, s.expiry_tier];
    return '<tr data-sku="' + s.id + '">' +
      '<td class="td-check"><input class="checkbox" type="checkbox" aria-label="Pilih ' + esc(s.brand_sku_code) + '"></td>' +
      '<td class="td-thumb"><img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' +
      esc(s.photo_key || String(s.brand_sku_code || '').toLowerCase()) + '" alt=""></td>' +
      '<td class="td-strong">' + esc(s.name_display) + '</td>' +
      '<td class="td-code">' + esc(s.brand_sku_code) + '</td>' +
      '<td class="td-code">' + esc(s.brand_code || '—') + '</td>' +
      '<td>' + esc(s.category || '—') + '</td>' +
      '<td class="td-code">' + esc(s.unit_size || '—') + '</td>' +
      '<td>' + identitySpill(s.identity_mode) + '</td>' +
      '<td><span class="spill spill--' + ex[0] + '"><span class="spill__dot"></span><span ' +
      biAttr(ex[1], ex[2]) + '>' + esc(ex[1]) + '</span></span></td>' +
      '<td class="td-actions">' + (s.identity_mode === 'unit_label' ? ''
        : '<button class="cbtn cbtn--sm" type="button" data-bc="' + s.id + '" ' +
          biAttr('Barcode', 'Barcodes') + '>Barcode</button>') + '</td></tr>';
  }

  NJW.screens.produk = async () => {
    const me = W.me();
    const admin = me && me.role === 'admin';
    let brands = [], rows = [], page = 1, bcSku = null, pending = [];

    // Admin-only endpoints behind these; a supervisor would only meet a 403.
    if (!admin) {
      $$('[data-action="import"], [data-action="new-sku"], [data-action="new-brand"], ' +
         'a[href*="product-master"]').forEach(el => show(el, false));
    }

    try { brands = await api.brands(); } catch (e) { return fail(e); }
    const brandOpts = brands.filter(b => b.active).map(b =>
      '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
    field('brand-filter').insertAdjacentHTML('beforeend', brandOpts);
    field('sku-brand').innerHTML = brandOpts;
    field('import-brand').innerHTML = brandOpts;

    /* ---- brands and stock owner ----
       The owner decides whose every unit is (Wardah → Grab, consignment →
       the brand, the Ninja range → Ninja). An admin changes it in place with
       PATCH /api/brands/{id}; everyone else reads it. */
    const ownerSelect = b => '<select class="select" style="width:auto" data-owner="' + b.id +
      '" aria-label="Pemilik stok ' + esc(b.name) + '">' + Object.keys(OWNER).map(k =>
        '<option value="' + k + '"' + (k === b.default_stock_owner ? ' selected' : '') + ' ' +
        biAttr(OWNER[k][0], OWNER[k][1]) + '>' + esc(OWNER[k][0]) + '</option>').join('') + '</select>';
    const ownerSpill = b => {
      const o = OWNER[b.default_stock_owner] || [b.default_stock_owner || '—', b.default_stock_owner || '—'];
      return '<span class="spill spill--accent"><span ' + biAttr(o[0], o[1]) + '>' + esc(o[0]) + '</span></span>';
    };
    const bHost = region('brands');
    bHost.innerHTML = brands.length ? brands.map(b =>
      '<tr><td class="td-code">' + esc(b.code) + '</td>' +
      '<td class="td-strong">' + esc(b.name) + '</td>' +
      '<td>' + identitySpill(b.identity_mode) + '</td>' +
      '<td>' + (admin ? ownerSelect(b) : ownerSpill(b)) + '</td>' +
      '<td>' + (b.active
        ? '<span class="spill spill--ok"><span class="spill__dot"></span><span ' + biAttr('Aktif', 'Active') + '>Aktif</span></span>'
        : '<span class="spill spill--neutral"><span class="spill__dot"></span><span ' + biAttr('Nonaktif', 'Inactive') + '>Nonaktif</span></span>') +
      '</td></tr>').join('')
      : '<tr><td colspan="5" class="note" ' + biAttr('Belum ada brand.', 'No brands yet.') + '></td></tr>';
    applyLangTo(bHost);
    bHost.addEventListener('change', async e => {
      const sel = e.target.closest('[data-owner]');
      if (!sel) return;
      const b = brands.find(x => x.id === +sel.dataset.owner);
      if (!b) return;
      const next = sel.value;
      // Ownership decides whose stock it is on every future movement; a stray
      // click on a select must not rebook a brand silently.
      if (!confirm('Ubah pemilik stok ' + b.name + ' menjadi ' + OWNER[next][0] + '?')) {
        sel.value = b.default_stock_owner;
        return;
      }
      try {
        const r = await api.raw.patch('/brands/' + b.id, { default_stock_owner: next });
        b.default_stock_owner = r.default_stock_owner;
        say(b.name + ': pemilik stok ' + OWNER[r.default_stock_owner][0] + '.');
      } catch (err) {
        sel.value = b.default_stock_owner;
        fail(err);
      }
    });

    /* ---- KPIs over the whole list, not the page ---- */
    (async () => {
      try {
        const all = await api.skus({ limit: 500 });
        setF('kpi-skus', NJW.fmt.n(all.total));
        const nBrands = new Set(all.skus.map(s => s.brand_id)).size;
        bi(field('kpi-skus-foot'), 'di ' + nBrands + ' brand', 'across ' + nBrands +
          (nBrands === 1 ? ' brand' : ' brands'));
        setF('kpi-unitlabel', all.skus.filter(s => s.identity_mode === 'unit_label').length);
        // Photos are served only once NJW.PHOTO_BASE points somewhere; until
        // then no SKU has one on screen, whatever its photo_key says.
        setF('kpi-nophoto', NJW.PHOTO_BASE ? all.skus.filter(s => !s.photo_key).length : all.total);
        const np = field('kpi-nophoto');
        if (np) np.closest('.kpi-card').classList.toggle('kpi-card--stop', +np.textContent > 0);
      } catch (e) {
        setF('kpi-skus', '—'); bi(field('kpi-skus-foot'), 'Tidak bisa dimuat', 'Could not load');
      }
      if (admin) {
        try {
          const pm = await api.raw.get('/admin/product-master?limit=1');
          setF('kpi-master', NJW.fmt.n(pm.total));
        } catch (e) { /* stays a dash */ }
      }
    })();

    /* ---- the table ---- */
    const table = $('#tbl-sku');
    async function load() {
      const host = region('skus');
      let r;
      try {
        r = await api.skus({
          q: field('search').value.trim(), brand_id: field('brand-filter').value,
          limit: PER, offset: (page - 1) * PER,
        });
      } catch (e) { return fail(e); }
      rows = r.skus;
      host.innerHTML = rows.length ? rows.map(row).join('')
        : '<tr><td colspan="10" class="note" ' + biAttr('Tidak ada SKU yang cocok.', 'No matching SKUs.') + '></td></tr>';
      applyLangTo(host);
      if (NJW.paintPhotos) NJW.paintPhotos(host);
      setF('result-count', rows.length);
      paintPager(r.total, page, p => { page = p; load(); });
      const all = $('thead .checkbox', table);
      if (all) { all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    let t;
    field('search').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { page = 1; load(); }, 300);
    });
    field('brand-filter').addEventListener('change', () => { page = 1; load(); });

    /* ---- barcode drawer ---- */
    function paintPending() {
      const host = region('bc-list');
      const label = {
        new: ['ok', 'Baru — siap didaftarkan', 'New — ready to register'],
        already_this_sku: ['neutral', 'Sudah terdaftar di SKU ini', 'Already on this SKU'],
        registered: ['ok', 'Terdaftar', 'Registered'],
      };
      host.innerHTML = pending.map(p => {
        const l = p.state === 'conflict'
          ? ['stop', 'Bentrok: milik ' + (p.conflict_sku_name || '?'), 'Clash: belongs to ' + (p.conflict_sku_name || '?')]
          : (label[p.state] || ['neutral', p.state, p.state]);
        return '<tr><td class="td-code">' + esc(p.barcode) + '</td><td><span class="spill spill--' + l[0] +
          '"><span ' + biAttr(l[1], l[2]) + '>' + esc(l[1]) + '</span></span></td></tr>';
      }).join('');
      applyLangTo(host);
    }
    field('bc-input').addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = e.target.value.trim();
      e.target.value = '';
      if (!code || !bcSku || pending.some(p => p.barcode === code)) return;
      try {
        pending.unshift(await api.checkBarcode({ barcode: code, sku_id: bcSku.id }));
        paintPending();
      } catch (err) { fail(err); }
    });

    /* ---- import drawer ---- */
    const importMode = () => ($('input[name="import-mode"]:checked') || {}).value || 'master';
    $$('input[name="import-mode"]').forEach(r => r.addEventListener('change', () => {
      const skus = importMode() === 'skus';
      show(region('import-master'), !skus);
      show(region('import-skus'), skus);
      show($('[data-action="import-preview"]'), skus);
    }));
    function importResult(msg, results) {
      show(region('import-result'), true);
      setF('import-message', msg);
      const wrap = region('import-rows-wrap');
      show(wrap, !!(results && results.length));
      if (results) region('import-rows').innerHTML = results.map(r =>
        '<tr><td class="td-code">' + r.row_no + '</td><td><span class="spill spill--' +
        (r.ok ? 'ok' : 'stop') + '"><span>' + esc(r.message) + '</span></span></td></tr>').join('');
    }
    async function runImport(commit) {
      const file = field('import-file').files[0];
      if (!file) return say('Pilih file CSV dulu.');
      try {
        if (importMode() === 'master') {
          const r = await upload('/admin/product-master/import', file);
          // Failed rows first: those are the ones a person has to fix.
          importResult(r.message, r.results.slice().sort((a, b) => a.ok - b.ok));
          const pm = await api.raw.get('/admin/product-master?limit=1').catch(() => null);
          if (pm) setF('kpi-master', NJW.fmt.n(pm.total));
        } else {
          const b = field('import-brand').value;
          if (!b) return say('Pilih brand.');
          const r = await upload('/skus/import?brand_id=' + encodeURIComponent(b) +
                                 '&commit=' + (commit ? 'true' : 'false'), file);
          importResult(r.message, null);
        }
        if (commit) load();
      } catch (e) { importResult(e.message, null); fail(e); }
    }

    /* ---- clicks ---- */
    document.addEventListener('click', async e => {
      if (e.target.closest('[data-action="new-sku"]')) return openDrawer('#drawer-sku');
      if (e.target.closest('[data-action="new-brand"]')) return openDrawer('#drawer-brand');
      if (e.target.closest('[data-action="import"]')) {
        show(region('import-result'), false);
        show(region('import-rows-wrap'), false);
        return openDrawer('#drawer-import');
      }
      if (e.target.closest('[data-action="import-preview"]')) return runImport(false);
      if (e.target.closest('[data-action="import-run"]')) return runImport(true);

      const bc = e.target.closest('[data-bc]');
      if (bc) {
        bcSku = rows.find(s => s.id === +bc.dataset.bc);
        if (!bcSku) return;
        pending = [];
        paintPending();
        setF('bc-sku-name', bcSku.name_display);
        setF('bc-sku-code', bcSku.brand_sku_code);
        openDrawer('#drawer-barcode');
        setTimeout(() => field('bc-input').focus(), 250);
        return;
      }
      if (e.target.closest('[data-action="register-barcodes"]')) {
        const fresh = pending.filter(p => p.state === 'new').map(p => p.barcode);
        if (!bcSku || !fresh.length) return say('Tidak ada barcode baru untuk didaftarkan.');
        try {
          const r = await api.registerBarcodes({ sku_id: bcSku.id, barcodes: fresh });
          pending.forEach(p => { if (fresh.includes(p.barcode)) p.state = 'registered'; });
          // The server re-checks; a code taken in the meantime comes back as a clash.
          (r.checks || []).forEach(c => {
            const p = pending.find(x => x.barcode === c.barcode);
            if (p && c.state === 'conflict') Object.assign(p, c);
          });
          paintPending();
          say(r.registered + ' barcode terdaftar' + (r.skipped ? ', ' + r.skipped + ' dilewati' : '') + '.');
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="save-sku"]')) {
        const body = {
          brand_id: +field('sku-brand').value,
          name_display: field('sku-name').value.trim(),
          brand_sku_code: field('sku-code').value.trim().toUpperCase(),
          category: field('sku-category').value.trim() || null,
          unit_size: field('sku-size').value.trim() || null,
          unit_cube_cm3: +field('sku-cube').value || null,
          expiry_tier: field('sku-expiry').value,
          identity_mode: field('sku-mode').value || null,
          label_placement_note: field('sku-note').value.trim() || null,
        };
        if (!body.brand_id || !body.name_display || !body.brand_sku_code) {
          return say('Brand, nama produk, dan kode SKU wajib diisi.');
        }
        try {
          const s = await api.createSku(body);
          say(s.name_display + ' ditambahkan.');
          ['sku-name', 'sku-code', 'sku-size', 'sku-cube', 'sku-note'].forEach(f => { field(f).value = ''; });
          closeDrawers();
          load();
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="save-brand"]')) {
        const body = {
          code: field('brand-code').value.trim().toUpperCase(),
          name: field('brand-name').value.trim(),
          identity_mode: field('brand-mode').value,
          default_stock_owner: field('brand-owner').value,
        };
        if (!body.code || !body.name) return say('Kode dan nama brand wajib diisi.');
        try {
          await api.raw.post('/brands', body);
          say(body.name + ' ditambahkan.');
          // Brands feed three pickers and the owner table; a reload repaints
          // them all from one source instead of patching each.
          setTimeout(() => location.reload(), 700);
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="export-selected"]')) {
        const ids = $$('tbody .checkbox', table).filter(b => b.checked)
          .map(b => +b.closest('tr').dataset.sku);
        const pick = rows.filter(s => ids.includes(s.id));
        if (!pick.length) return;
        downloadCsv('sku-pilihan.csv', [['brand', 'sku code', 'product name', 'category', 'size',
          'identity', 'expiry']].concat(pick.map(s => [s.brand_code, s.brand_sku_code, s.name_display,
          s.category, s.unit_size, s.identity_mode, s.expiry_tier])));
      }
    });

    await load();
  };
})();
