/* screens/lengkapi-sku.js · Lengkapi data SKU (console/lengkapi-sku.html), Ops HQ.
 *
 *   GET   /api/sku-complete?status=&brand_id=&q=   rows, belum lengkap first
 *   GET   /api/sku-complete/summary                 counts for the cards
 *   PATCH /api/sku-complete/{id}                    one row; only the fields sent change
 *   PUT   /api/sku-complete/{id}/hubs/{site}        one hub's own numbers
 *   GET   /api/sku-complete/export.csv              the rows on screen, to fill in
 *   POST  /api/sku-complete/import[?commit=true]    preview, then save (PRD §2.6.1)
 *   POST  /api/skus/{id}/photo                      the existing photo upload
 *
 * Every row is edited in place and saved with its own button, which lights up
 * once something on the row changed. A saved row stays on screen even when it
 * is now complete, so the person sees the "lengkap" they just earned; it drops
 * out of the Belum lengkap filter at the next load.
 *
 * Pesan ulang saat sisa and batas kritis take units or a percentage ("25%");
 * the unit number it means is shown under the box (PRD §4.5.3).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const r = api.raw;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const SIZE_NAME = { S: ['Kecil (S)', 'Small (S)'], M: ['Sedang (M)', 'Medium (M)'],
    L: ['Besar (L)', 'Large (L)'], OPEN: ['Rak terbuka', 'Open shelf'] };

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

  /* A download through fetch, so a refusal shows as a message rather than a
     page of JSON, and the preview header rides along like on every call. */
  async function download(url, fallback) {
    const headers = {};
    try { const v = localStorage.getItem('njw.viewAs'); if (v) headers['X-View-As'] = v; } catch (e) {}
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = m ? m[1] : fallback;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* "25%" -> {pct: 25}; "4" -> {units: 4}; "" -> {}; anything else -> null. */
  function parseAmount(text) {
    const t = String(text || '').replace(/\s/g, '');
    if (!t) return {};
    let m = t.match(/^(\d+)%$/);
    if (m) return { pct: +m[1] };
    m = t.match(/^\d+$/);
    return m ? { units: +t } : null;
  }
  const shownAmount = (units, pct) => pct != null ? pct + '%' : (units == null ? '' : String(units));
  const pctUnits = (fill, pct, floor) => Math.max(floor, Math.ceil(fill * pct / 100));

  NJW.screens['lengkapi-sku'] = async () => {
    const host = region('rows');
    let rows = [], meta = { bin_sizes: ['S', 'M', 'L', 'OPEN'], grab_buffer_default: 1, restock_default_pct: 25 };
    let status = 'incomplete', brandId = '', q = '', detail = null, csvFile = null;

    if (!W.atLeast('hq')) {
      host.innerHTML = '<tr><td colspan="10" class="note" ' +
        biAttr('Halaman ini untuk Ops HQ.', 'This page is for Ops HQ.') + '></td></tr>';
      applyLangTo(host);
      $$('[data-action="download"], [data-action="upload"]').forEach(b => { b.disabled = true; });
      return;
    }

    try {
      const brands = await api.brands();
      field('brand-filter').insertAdjacentHTML('beforeend', brands.filter(b => b.active).map(b =>
        '<option value="' + b.id + '">' + esc(b.name) + '</option>').join(''));
    } catch (e) { /* the list still loads for every brand */ }

    const query = () => r.qs({ status, brand_id: brandId, q });

    async function summary() {
      try {
        const s = await r.get('/sku-complete/summary');
        setF('kpi-incomplete', NJW.fmt.n(s.incomplete));
        setF('kpi-total', NJW.fmt.n(s.total));
      } catch (e) { /* cards keep their last value */ }
    }

    async function load() {
      try {
        const res = await r.get('/sku-complete' + query());
        rows = res.rows;
        meta = res;
        setF('kpi-buffer', NJW.fmt.n(res.grab_buffer_default));
        render();
      } catch (e) { fail(e); }
    }

    function sizeSelect(row) {
      const opts = meta.bin_sizes.map(s => {
        const n = SIZE_NAME[s] || [s, s];
        return '<option value="' + s + '"' + (row.bin_size === s ? ' selected' : '') + '>' +
          esc(en() ? n[1] : n[0]) + (row.suggested_bin_size === s && !row.bin_size ? (en() ? ' (suggested)' : ' (saran)') : '') +
          '</option>';
      }).join('');
      return '<select class="select" data-k="bin_size" style="width:130px">' +
        '<option value="">' + (row.suggested_bin_size ? (en() ? 'Suggested: ' : 'Saran: ') + esc(row.suggested_bin_size) : '-') +
        '</option>' + opts + '</select>';
    }

    function numInput(key, value, placeholder, width) {
      return '<input class="input" type="' + (key === 'reorder' || key === 'critical' ? 'text' : 'number') +
        '" min="0" inputmode="numeric" style="width:' + (width || 80) + 'px;text-align:right" data-k="' + key +
        '" value="' + esc(value == null ? '' : value) + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + '>';
    }

    function statusPill(row) {
      if (row.complete) {
        return '<span class="spill spill--ok"><span class="spill__dot"></span><span ' +
          biAttr('Lengkap', 'Complete') + '>Lengkap</span></span>';
      }
      const miss = row.missing.map(m => m === 'bin_size' ? (en() ? 'bin size' : 'ukuran bin') : (en() ? 'fill up to' : 'isi sampai')).join(', ');
      return '<span class="spill spill--warn"><span class="spill__dot"></span><span ' +
        biAttr('Belum lengkap', 'Not complete') + '>Belum lengkap</span></span>' +
        '<div class="tagline">' + esc(miss) + '</div>';
    }

    function hint(row, which) {
      const fill = row.fill_to;
      const pct = which === 'reorder' ? row.reorder_pct : row.critical_pct;
      const units = which === 'reorder' ? row.reorder_at : row.critical_at;
      if (pct == null || units == null || fill == null) return '';
      return '<div class="tagline">= ' + units + (en() ? ' units' : ' unit') + '</div>';
    }

    function rowHtml(row) {
      const codes = [row.hiryu_sku_code, row.brand_sku_code !== row.hiryu_sku_code ? row.brand_sku_code : null]
        .filter(Boolean).map(esc).join(' · ');
      return '<tr data-sku="' + row.id + '">' +
        '<td class="td-thumb"><img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' +
          esc(row.photo_key || '') + '" alt=""></td>' +
        '<td style="min-width:240px"><div class="td-strong">' + esc(row.name_display) + (row.unit_size ? ' <span class="tagline">' + esc(row.unit_size) + '</span>' : '') + '</div>' +
          '<div class="td-code">' + codes + '</div>' +
          '<div class="tagline">' + esc(row.brand_name || '') +
          (row.barcodes.length ? ' · ' + esc(row.barcodes.join(', ')) : ' · ' + (en() ? 'no barcode' : 'belum ada barcode')) + '</div></td>' +
        '<td>' + sizeSelect(row) + '</td>' +
        '<td class="td-num">' + numInput('fill_to', row.fill_to, '15') + '</td>' +
        '<td class="td-num">' + numInput('reorder', shownAmount(row.reorder_at, row.reorder_pct),
          meta.restock_default_pct ? meta.restock_default_pct + '%' : '') + hint(row, 'reorder') + '</td>' +
        '<td class="td-num">' + numInput('critical', shownAmount(row.critical_at, row.critical_pct), '') + hint(row, 'critical') + '</td>' +
        '<td class="td-num">' + numInput('grab_buffer', row.grab_buffer, String(meta.grab_buffer_default), 70) + '</td>' +
        '<td class="td-num">' + numInput('bin_max', row.bin_max, en() ? 'learned' : 'dipelajari', 90) + '</td>' +
        '<td>' + statusPill(row) + '</td>' +
        '<td class="td-actions">' +
          '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-save="' + row.id + '" disabled ' + biAttr('Simpan', 'Save') + '>Simpan</button>' +
          '<button class="cbtn cbtn--sm" type="button" data-detail="' + row.id + '" ' + biAttr('Detail', 'Details') + '>Detail</button>' +
        '</td></tr>';
    }

    function render() {
      host.innerHTML = rows.length ? rows.map(rowHtml).join('')
        : '<tr><td colspan="10" class="note" ' + (status === 'incomplete'
          ? biAttr('Semua SKU sudah lengkap.', 'Every SKU is complete.')
          : biAttr('Tidak ada SKU yang cocok.', 'No matching SKUs.')) + '></td></tr>';
      applyLangTo(host);
      setF('result-count', NJW.fmt.n(rows.length));
    }

    /* The body for one row: only what differs from what was loaded. */
    function rowChanges(tr, row) {
      const body = {};
      const val = k => { const el = $('[data-k="' + k + '"]', tr); return el ? el.value.trim() : ''; };
      const num = s => (s === '' ? null : +s);
      const size = val('bin_size') || null;
      if (size !== (row.bin_size || null)) body.bin_size = size;
      for (const k of ['fill_to', 'grab_buffer', 'bin_max']) {
        const v = num(val(k));
        if (v !== (row[k] == null ? null : row[k])) body[k] = v;
      }
      for (const [k, unitsKey, pctKey] of [['reorder', 'reorder_at', 'reorder_pct'], ['critical', 'critical_at', 'critical_pct']]) {
        const text = val(k);
        if (text === shownAmount(row[unitsKey], row[pctKey])) continue;
        const a = parseAmount(text);
        if (a === null) return { error: (k === 'reorder' ? 'Pesan ulang saat sisa' : 'Batas kritis') + ': ketik unit atau persen, misalnya 4 atau 25%.' };
        if (a.pct != null) { body[pctKey] = a.pct; body[unitsKey] = null; }
        else { body[unitsKey] = a.units == null ? null : a.units; body[pctKey] = null; }
      }
      return { body };
    }

    function replaceRow(fresh) {
      const i = rows.findIndex(x => x.id === fresh.id);
      if (i >= 0) rows[i] = fresh;
      const tr = $('tr[data-sku="' + fresh.id + '"]', host);
      if (tr) {
        tr.outerHTML = rowHtml(fresh);
        applyLangTo($('tr[data-sku="' + fresh.id + '"]', host));
      }
    }

    async function saveRow(id) {
      const row = rows.find(x => x.id === id);
      const tr = $('tr[data-sku="' + id + '"]', host);
      if (!row || !tr) return;
      const { body, error } = rowChanges(tr, row);
      if (error) return say(error);
      if (!Object.keys(body).length) return say(en() ? 'Nothing changed.' : 'Tidak ada perubahan.');
      try {
        const res = await r.patch('/sku-complete/' + id, body);
        replaceRow(res.row);
        say(res.message);
        summary();
      } catch (e) { fail(e); }
    }

    /* ---- detail drawer ---- */
    function hubRow(h) {
      return '<tr data-site="' + h.site_id + '">' +
        '<td class="td-code">' + esc(h.site_code) + '</td>' +
        '<td class="td-code">' + esc(h.location_code || '-') +
          (h.follows_default ? '<div class="tagline" ' + biAttr('ikut SKU', 'follows the SKU') + '>ikut SKU</div>' : '') + '</td>' +
        '<td class="td-num"><input class="input" type="number" min="1" style="width:70px;text-align:right" data-h="fill" value="' + esc(h.fill_to ?? '') + '"></td>' +
        '<td class="td-num"><input class="input" type="text" style="width:70px;text-align:right" data-h="reorder" value="' + esc(h.reorder_at ?? '') + '"></td>' +
        '<td class="td-num"><input class="input" type="text" style="width:70px;text-align:right" data-h="critical" value="' + esc(h.critical_at ?? '') + '"></td>' +
        '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-hub-save="' + h.site_id + '" ' + biAttr('Simpan', 'Save') + '>Simpan</button></td></tr>';
    }

    function openDetail(row) {
      detail = row;
      const t = field('d-title');
      t.textContent = row.name_display + (row.unit_size ? ' ' + row.unit_size : '');
      setF('d-brand', row.brand_name || '-');
      setF('d-hiryu', row.hiryu_sku_code || '-');
      setF('d-barcodes', row.barcodes.join(', ') || (en() ? 'none yet' : 'belum ada'));
      field('d-code').value = row.brand_sku_code || '';
      field('d-l').value = row.pack_length_mm ?? '';
      field('d-w').value = row.pack_width_mm ?? '';
      field('d-h').value = row.pack_height_mm ?? '';
      field('d-g').value = row.pack_weight_g ?? '';
      field('d-liquid').checked = !!row.is_liquid;
      field('d-large').checked = !!row.is_large_bottle;
      field('d-barcode').value = '';
      field('d-photo').value = '';
      const img = field('d-photo-preview');
      img.removeAttribute('data-photo-src');
      img.src = '../assets/products/placeholder.svg';
      img.dataset.photoKey = row.photo_key || '';
      const hubs = region('d-hubs');
      hubs.innerHTML = row.hubs.length ? row.hubs.map(hubRow).join('')
        : '<tr><td colspan="6" class="note" ' + biAttr('Belum ada hub yang memberi SKU ini bin.',
          'No hub has given this SKU a bin yet.') + '></td></tr>';
      applyLangTo($('#drawer-sku'));
      openDrawer('#drawer-sku');
    }

    async function saveDetail() {
      const row = detail;
      if (!row) return;
      const body = {};
      const num = f => { const v = field(f).value.trim(); return v === '' ? null : +v; };
      const code = field('d-code').value.trim();
      if (code && code !== row.brand_sku_code) body.brand_sku_code = code;
      for (const [f, k] of [['d-l', 'pack_length_mm'], ['d-w', 'pack_width_mm'], ['d-h', 'pack_height_mm'], ['d-g', 'pack_weight_g']]) {
        if (num(f) !== (row[k] ?? null)) body[k] = num(f);
      }
      // A box never ticked stays "not known" rather than turning into "no".
      const liquid = field('d-liquid').checked, large = field('d-large').checked;
      if (liquid !== !!row.is_liquid) body.is_liquid = liquid;
      if (large !== !!row.is_large_bottle) body.is_large_bottle = large;
      const bc = field('d-barcode').value.trim();
      if (bc) body.add_barcodes = [bc];
      const photo = field('d-photo').files[0];
      try {
        let fresh = row;
        if (Object.keys(body).length) {
          const res = await r.patch('/sku-complete/' + row.id, body);
          fresh = res.row;
          say(res.message);
        }
        if (photo) {
          const fd = new FormData();
          fd.append('file', photo);
          const sku = await api.uploadSkuPhoto(row.id, fd);
          fresh = Object.assign({}, fresh, { photo_key: sku.photo_key || fresh.photo_key });
          say(en() ? 'Photo saved.' : 'Foto tersimpan.');
        }
        if (!Object.keys(body).length && !photo) say(en() ? 'Nothing changed.' : 'Tidak ada perubahan.');
        replaceRow(fresh);
        closeDrawers();
      } catch (e) { fail(e); }
    }

    async function saveHub(siteId) {
      const tr = $('tr[data-site="' + siteId + '"]', region('d-hubs'));
      if (!tr || !detail) return;
      const fill = +($('[data-h="fill"]', tr).value || 0);
      const re = parseAmount($('[data-h="reorder"]', tr).value);
      const cr = parseAmount($('[data-h="critical"]', tr).value);
      if (!fill) return say(en() ? 'Enter fill up to for this hub.' : 'Isi sampai untuk hub ini wajib diisi.');
      if (re === null || cr === null) return say('Ketik unit atau persen, misalnya 4 atau 25%.');
      const body = { fill_to: fill, reorder_at: re.units ?? null, reorder_pct: re.pct ?? null,
                     critical_at: cr.units ?? null, critical_pct: cr.pct ?? null };
      try {
        const res = await r.put('/sku-complete/' + detail.id + '/hubs/' + siteId, body);
        detail = res.row;
        replaceRow(res.row);
        openDetail(res.row);
        say(res.message);
      } catch (e) { fail(e); }
    }

    /* ---- CSV ---- */
    function csvRow(x) {
      const tone = x.status === 'error' ? 'stop' : x.status === 'change' ? 'info' : 'neutral';
      const label = x.status === 'error' ? ['Bermasalah', 'Problem'] : x.status === 'change' ? ['Berubah', 'Changes'] : ['Tetap', 'Unchanged'];
      const changes = x.changes.map(c => '<div><strong>' + esc(c.label) + '</strong>: ' +
        esc(c.old == null ? '-' : c.old) + ' → ' + esc(c.new == null ? '-' : c.new) + '</div>').join('');
      const errs = x.errors.map(m => '<div class="num-stop">' + esc(m) + '</div>').join('');
      return '<tr><td class="td-num">' + x.row_no + '</td>' +
        '<td><div class="td-strong">' + esc(x.name || '-') + '</div><div class="td-code">' + esc(x.code || '') + '</div></td>' +
        '<td>' + (changes || errs ? changes + errs : '<span class="tagline">-</span>') + '</td>' +
        '<td><span class="spill spill--' + tone + '"><span class="spill__dot"></span><span ' +
          biAttr(label[0], label[1]) + '>' + label[0] + '</span></span></td></tr>';
    }

    async function preview(file) {
      csvFile = file;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await r.form('/sku-complete/import', fd);
        field('csv-summary').textContent = res.message;
        const list = res.rows.filter(x => x.status !== 'same');
        region('csv-rows').innerHTML = list.length ? list.map(csvRow).join('')
          : '<tr><td colspan="4" class="note" ' + biAttr('Tidak ada yang berubah di file ini.', 'Nothing in this file changes anything.') + '></td></tr>';
        applyLangTo($('#drawer-csv'));
        const commit = $('[data-action="csv-commit"]');
        commit.disabled = !res.to_change;
        openDrawer('#drawer-csv');
      } catch (e) { fail(e); }
    }

    async function commitCsv() {
      if (!csvFile) return;
      const fd = new FormData();
      fd.append('file', csvFile);
      try {
        const res = await r.form('/sku-complete/import' + r.qs({ commit: true }), fd);
        say(res.message);
        csvFile = null;
        closeDrawers();
        await load();
        summary();
      } catch (e) { fail(e); }
    }

    /* ---- wiring ---- */
    $$('[data-status]', region('status-filter')).forEach(b => b.addEventListener('click', () => {
      status = b.dataset.status;
      $$('[data-status]', region('status-filter')).forEach(o => o.classList.toggle('is-on', o === b));
      load();
    }));
    field('brand-filter').addEventListener('change', e => { brandId = e.target.value; load(); });
    let t = null;
    field('search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { q = e.target.value.trim(); load(); }, 300);
    });

    host.addEventListener('input', e => {
      const tr = e.target.closest('tr[data-sku]');
      if (!tr) return;
      const btn = $('[data-save]', tr);
      if (btn) btn.disabled = false;
    });
    host.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-sku]');
      if (tr && e.target.matches('select')) { const btn = $('[data-save]', tr); if (btn) btn.disabled = false; }
    });
    host.addEventListener('keydown', e => {
      // Enter in a row saves that row, as a spreadsheet user expects.
      const tr = e.target.closest('tr[data-sku]');
      if (tr && e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveRow(+tr.dataset.sku); }
    });

    document.addEventListener('click', async e => {
      const sv = e.target.closest('[data-save]');
      if (sv) return saveRow(+sv.dataset.save);
      const dt = e.target.closest('[data-detail]');
      if (dt) return openDetail(rows.find(x => x.id === +dt.dataset.detail));
      const hs = e.target.closest('[data-hub-save]');
      if (hs) return saveHub(+hs.dataset.hubSave);
      if (e.target.closest('[data-action="save-detail"]')) return saveDetail();
      if (e.target.closest('[data-action="csv-commit"]')) return commitCsv();
      if (e.target.closest('[data-action="upload"]')) return field('csv-file').click();
      if (e.target.closest('[data-action="download"]')) {
        try { await download('/api/sku-complete/export.csv' + query(), 'lengkapi-data-sku.csv'); }
        catch (err) { fail(err); }
      }
    });
    field('csv-file').addEventListener('change', e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) preview(f);
    });
    field('d-photo').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) field('d-photo-preview').src = URL.createObjectURL(f);
    });

    await Promise.all([load(), summary()]);
  };
})();
