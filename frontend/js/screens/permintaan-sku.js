/* screens/permintaan-sku.js — Ops HQ answers stations about unknown products
 * (console/permintaan-sku.html).
 *
 * GET /api/sku-requests (every station, HQ only); resolve with an existing SKU
 * or a new one plus a bin at the requesting station; or reject with a reason.
 * The station sees the answer on its inbound screens and puts the units away.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  const STATUS = {
    open: ['warn', 'Menunggu HQ', 'Waiting for HQ'],
    resolved: ['info', 'Menunggu ditaruh', 'Waiting for put-away'],
    put_away: ['ok', 'Selesai', 'Done'],
    rejected: ['neutral', 'Ditolak', 'Rejected'],
  };
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '—';

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

  NJW.screens['permintaan-sku'] = async () => {
    if (!W.atLeast('hq')) {
      region('rows').innerHTML = '<tr><td colspan="8"><div class="empty"><span class="empty__title" ' +
        biAttr('Halaman ini untuk Ops HQ', 'This page is for Ops HQ') + '></span></div></td></tr>';
      return applyLangTo(region('rows'));
    }
    let status = 'open', rows = [], cur = null, mode = 'existing', picked = null, brands = [];

    try { brands = (await api.brands()).filter(b => b.active); } catch (e) { /* new-SKU form stays empty */ }
    field('n-brand').innerHTML = brands.map(b => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');

    async function load() {
      let r;
      try { r = await api.skuRequests({ status, limit: 200 }); } catch (e) { return fail(e); }
      rows = r.requests;
      Object.keys(STATUS).forEach(k => setF('n-' + k, r.counts[k] || 0));
      const host = region('rows');
      host.innerHTML = rows.length ? rows.map(q => {
        const st = STATUS[q.status] || ['neutral', q.status, q.status];
        const answer = q.status === 'rejected'
          ? esc(q.resolution_note || '')
          : q.sku_name ? '<strong>' + esc(q.sku_name) + '</strong><br><span class="td-code">' + esc(q.location_code || '') + '</span>'
          : '<span class="spill spill--' + st[0] + '"><span ' + biAttr(st[1], st[2]) + '></span></span>';
        return '<tr data-req="' + q.id + '">' +
          '<td class="td-thumb"><img class="thumb thumb--lg" src="../assets/products/placeholder.svg" data-photo-key="' + esc(q.photo_key || '') + '" alt=""></td>' +
          '<td><span class="td-code">' + esc(q.site_code) + '</span><br><span style="color:var(--muted);font-size:var(--fs-c-meta)">' + esc(q.site_name) + '</span></td>' +
          '<td class="td-code">' + esc(q.barcode || '—') + '</td>' +
          '<td class="td-num td-code">' + q.qty_counted + (q.qty_put_away != null ? ' → ' + q.qty_put_away : '') + '</td>' +
          '<td>' + esc(q.note || '—') + '</td>' +
          '<td><span class="td-code">' + when(q.raised_at) + '</span><br><span style="color:var(--muted);font-size:var(--fs-c-meta)">' + esc(q.raised_by || '') + '</span></td>' +
          '<td>' + answer + '</td>' +
          '<td class="td-actions">' + (q.status === 'open'
            ? '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-answer="' + q.id + '" ' + biAttr('Jawab', 'Answer') + '></button>' : '') +
          '</td></tr>';
      }).join('')
        : '<tr><td colspan="8"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada permintaan di sini', 'No requests here') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    /* ---- the answer drawer ---- */
    function setMode(m) {
      mode = m;
      $$('[data-mode]').forEach(b => b.classList.toggle('is-on', b.dataset.mode === m));
      region('a-existing').hidden = m !== 'existing';
      region('a-new').hidden = m !== 'new';
      picked = null;
      paintBins();
    }

    let freeBins = null;
    async function paintBins() {
      const sel = field('a-bin');
      sel.disabled = false;
      if (mode === 'existing' && !picked) {
        sel.innerHTML = '<option value="">' + t('Pilih SKU dulu', 'Choose the SKU first') + '</option>';
        sel.disabled = true;
        return;
      }
      if (picked) {
        try {
          const racks = await api.skuRacks(picked.id);
          const here = racks.sites.find(s => s.site_id === cur.site_id);
          if (here && here.location_code) {
            sel.innerHTML = '<option value="">' + esc(here.location_code) + ' · ' +
              t('rak yang sudah ada', 'its existing rack') + '</option>';
            sel.disabled = true;
            return;
          }
        } catch (e) { /* fall through to free bins */ }
      }
      if (!freeBins) {
        try {
          const map = await api.rackMap(cur.site_id);
          freeBins = [];
          map.racks.forEach(rk => rk.levels.forEach(lv => lv.positions.forEach(p => {
            if (p.basket_id && !p.sku_id) freeBins.push(p);
          })));
        } catch (e) { freeBins = []; }
      }
      sel.innerHTML = '<option value="">' + t('Otomatis — bin kosong terbaik', 'Automatic — best empty bin') + '</option>' +
        freeBins.map(p => '<option value="' + p.basket_id + '">' + esc(p.code) + ' · ' + esc(p.basket_size) + '</option>').join('');
      if (!freeBins.length) {
        sel.innerHTML = '<option value="">' + t('Tidak ada bin kosong di station ini — tambah bin dulu', 'No empty bin at this station — add one first') + '</option>';
      }
    }

    function openAnswer(id) {
      cur = rows.find(q => q.id === id);
      if (!cur) return;
      freeBins = null;
      bi(field('a-title'), 'Permintaan #' + cur.id + ' · ' + cur.site_code, 'Request #' + cur.id + ' · ' + cur.site_code);
      const img = field('a-photo');
      img.removeAttribute('data-photo-src');
      img.src = '../assets/products/placeholder.svg';
      img.dataset.photoKey = cur.photo_key || '';
      setF('a-site', cur.site_code + ' · ' + cur.site_name);
      setF('a-barcode', cur.barcode || '—');
      setF('a-qty', cur.qty_counted);
      setF('a-note', cur.note || '—');
      setF('a-receipt', cur.receipt_reference || (cur.receipt_id ? '#' + cur.receipt_id : '—'));
      field('a-q').value = '';
      field('a-msg').value = '';
      ['n-name', 'n-code', 'n-category', 'n-size', 'n-restock', 'n-full'].forEach(f => { field(f).value = ''; });
      if (cur.brand_id) field('n-brand').value = cur.brand_id;
      region('a-results').innerHTML = '';
      setMode('existing');
      openDrawer('#drawer-answer');
      setTimeout(() => field('a-q').focus(), 250);
    }

    let seq = 0, timer = null;
    async function search() {
      const term = field('a-q').value.trim();
      const host = region('a-results');
      if (term.length < 2) { host.innerHTML = ''; return; }
      const mine = ++seq;
      try {
        const r = await api.skus({ q: term, limit: 15 });
        if (mine !== seq) return;
        host.innerHTML = r.skus.length ? r.skus.map(s =>
          '<button type="button" data-pick="' + s.id + '" style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--rule);border-radius:var(--radius-chip);background:var(--surface);text-align:left;cursor:pointer' +
          (picked && picked.id === s.id ? ';border-color:var(--action);box-shadow:var(--shadow-focus)' : '') + '">' +
          '<img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' + esc(s.photo_key || '') + '" alt="">' +
          '<span style="display:flex;flex-direction:column"><strong>' + esc(s.name_display) + '</strong>' +
          '<span class="td-code" style="color:var(--muted)">' + esc([s.brand_code, s.brand_sku_code, s.unit_size].filter(Boolean).join(' · ')) + '</span></span></button>').join('')
          : '<span class="note" ' + biAttr('Tidak ketemu. Kalau memang produk baru, pilih “Daftarkan SKU baru”.',
            'Nothing found. If it really is new, choose “Register a new SKU”.') + '></span>';
        applyLangTo(host);
        host._skus = r.skus;
      } catch (e) { fail(e); }
    }
    field('a-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });

    document.addEventListener('click', async e => {
      const tab = e.target.closest('[data-status]');
      if (tab && tab.closest('[data-region="tabs"]')) {
        status = tab.dataset.status;
        $$('[data-region="tabs"] .tab').forEach(x => x.classList.toggle('is-on', x === tab));
        return load();
      }
      if (e.target.closest('[data-action="refresh"]')) return load();
      const ans = e.target.closest('[data-answer]');
      if (ans) return openAnswer(+ans.dataset.answer);
      const m = e.target.closest('[data-mode]');
      if (m) return setMode(m.dataset.mode);
      const pk = e.target.closest('[data-pick]');
      if (pk) {
        const list = region('a-results')._skus || [];
        picked = list.find(s => s.id === +pk.dataset.pick);
        $$('[data-pick]').forEach(b => {
          const on = b === pk;
          b.style.borderColor = on ? 'var(--action)' : 'var(--rule)';
          b.style.boxShadow = on ? 'var(--shadow-focus)' : 'none';
        });
        return paintBins();
      }

      if (e.target.closest('[data-action="resolve"]') && cur) {
        const body = { basket_id: +field('a-bin').value || null, note: field('a-msg').value.trim() || null };
        if (mode === 'existing') {
          if (!picked) return say(t('Pilih SKU yang cocok dulu.', 'Pick the matching SKU first.'));
          body.sku_id = picked.id;
        } else {
          const restock = field('n-restock').value;
          body.new_sku = {
            brand_id: +field('n-brand').value,
            name_display: field('n-name').value.trim(),
            brand_sku_code: field('n-code').value.trim().toUpperCase(),
            category: field('n-category').value.trim() || null,
            unit_size: field('n-size').value.trim() || null,
            default_restock_point: restock === '' ? null : +restock,
            default_full_threshold: +field('n-full').value || null,
          };
          if (!body.new_sku.brand_id || !body.new_sku.name_display || !body.new_sku.brand_sku_code) {
            return say(t('Brand, nama, dan kode SKU wajib diisi.', 'Brand, name and SKU code are required.'));
          }
          if (body.new_sku.default_restock_point == null) {
            return say(t('Isi titik restock (R).', 'Enter the restock point (R).'));
          }
        }
        try {
          const r = await api.resolveSkuRequest(cur.id, body);
          say(t('Terkirim ke ', 'Sent to ') + r.site_code + ': ' + r.sku_name + ' → ' + r.location_code);
          closeDrawers();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="reject"]') && cur) {
        const note = prompt(t('Alasan untuk staf (mis. bukan produk kita — kembalikan ke brand):',
          'Reason for the station (e.g. not our product — return it to the brand):'));
        if (!note || !note.trim()) return;
        try {
          await api.rejectSkuRequest(cur.id, note.trim());
          closeDrawers();
          load();
        } catch (err) { fail(err); }
      }
    });

    await load();
  };
})();
