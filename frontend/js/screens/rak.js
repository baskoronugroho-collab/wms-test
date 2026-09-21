/* screens/rak.js — racks & bins (console/rak.html).
 *
 * Two levels, as the people managing racks think about them:
 *   1. the hub, one card per rack          GET /api/sites/{id}/racks
 *   2. one rack, level by level, each bin  GET /api/racks/{id}
 * plus the per-hub queue of SKUs that have no rack here yet
 *                                          GET /api/sites/{id}/needs-rack
 *
 * The view lives in the URL hash (#rack=12, #needs) so the browser's back
 * button walks back out of a rack. Every write is SPV or above server-side.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const n = v => NJW.fmt.n(v);

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

  NJW.screens.rak = async () => {
    const me = W.me();
    let site = W.site();
    const canEdit = W.atLeast('supervisor');
    let summary = null, rack = null, needs = [], binCtx = null, placeSku = null, levelCtx = null;

    /* ---- hub picker: HQ works across hubs, an SPV across their own ---- */
    const sel = field('site-select');
    const sites = (me.sites || []).filter(s => s.site_type !== 'hub');
    sel.innerHTML = sites.map(s => '<option value="' + s.id + '"' + (site && s.id === site.id ? ' selected' : '') +
      '>' + esc(s.code) + ' · ' + esc(s.name) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join('');
    sel.hidden = sites.length < 2;
    sel.onchange = () => { CTX.set('site', +sel.value); location.hash = ''; location.reload(); };
    if (site && site.site_type === 'hub' && sites.length) {
      CTX.set('site', sites[0].id);
      site = sites[0];
    }
    if (!canEdit) $$('[data-action="new-rack"], [data-action="add-level"]').forEach(b => { b.hidden = true; });

    /* ---- level 1: rack cards ---- */
    function mini(r) {
      // The first bins of each level are "used" in proportion; the card is a
      // silhouette of the rack, not a map — the map is one click away.
      const ratio = r.bins ? r.occupied / r.bins : 0;
      return '<div class="rackmini" aria-hidden="true">' + r.bins_per_level.map(b => {
        const used = Math.round(b * ratio);
        return '<div class="rackmini__level">' + Array.from({ length: b }, (_, i) =>
          '<span class="rackmini__bin' + (i < used ? ' is-used' : '') + '"></span>').join('') + '</div>';
      }).join('') + '</div>';
    }

    async function loadSummary() {
      try { summary = await api.racks(site.id); } catch (e) { return fail(e); }
      const racks = summary.racks;
      const bins = racks.reduce((a, r) => a + r.bins, 0);
      const used = racks.reduce((a, r) => a + r.occupied, 0);
      setF('kpi-racks', n(racks.length));
      bi(field('kpi-racks-foot'), n(bins) + ' bin', n(bins) + ' bins');
      setF('kpi-used', n(used));
      bi(field('kpi-used-foot'), (bins ? Math.round(used / bins * 100) : 0) + '% dari semua bin',
         (bins ? Math.round(used / bins * 100) : 0) + '% of all bins');
      setF('kpi-units', n(racks.reduce((a, r) => a + r.units, 0)));
      setF('kpi-needs', n(summary.needs_rack));
      region('kpi-needs-card').classList.toggle('kpi-card--caution', summary.needs_rack > 0);
      paintInbound(summary.inbound_bins);

      const host = region('rack-cards');
      host.innerHTML = racks.length ? racks.map(r => {
        const pct = r.bins ? Math.round(r.occupied / r.bins * 100) : 0;
        return '<button class="rackcard" type="button" data-rack="' + r.rack_id + '">' +
          '<span class="rackcard__top"><span class="rackcard__code">' + esc(r.code) + '</span>' +
          '<span class="toolbar__spacer"></span><span class="rackcard__meta">' + pct + '%</span></span>' +
          '<span class="rackcard__meta"><span ' + biAttr(r.levels + ' tingkat · ' + r.bins + ' bin',
            r.levels + ' levels · ' + r.bins + ' bins') + '></span></span>' +
          mini(r) +
          '<span class="rackcard__meta"><span ' + biAttr(r.occupied + ' bin berisi SKU · ' + n(r.units) + ' unit',
            r.occupied + ' bins with a SKU · ' + n(r.units) + ' units') + '></span></span></button>';
      }).join('')
        : '<div class="empty" style="grid-column:1/-1"><span class="empty__title" ' + biAttr('Belum ada rak di ' + site.code, 'No racks at ' + site.code + ' yet') +
          '></span><span class="empty__body" ' + biAttr('Buat tata letak standar sekaligus — satu rak per huruf — atau tambah rak satu per satu dengan tombol di kanan atas.',
            'Build the standard layout in one go — one rack per letter — or add racks one at a time with the button at the top right.') + '></span>' +
          (canEdit ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;align-items:end;width:min(820px,100%)">' +
            '<label class="field"><span class="field__label" ' + biAttr('Kode rak', 'Rack codes') + '></span><input class="input" data-field="gen-codes" value="A,B,C,D,E,F,G"></label>' +
            '<label class="field"><span class="field__label" ' + biAttr('Tingkat', 'Levels') + '></span><input class="input" type="number" min="1" max="9" value="5" data-field="gen-levels"></label>' +
            '<label class="field"><span class="field__label" ' + biAttr('Bin / tingkat', 'Bins / level') + '></span><input class="input" type="number" min="1" max="30" value="5" data-field="gen-bins"></label>' +
            '<label class="field"><span class="field__label" ' + biAttr('Keranjang', 'Basket') + '></span><select class="select" data-field="gen-size"><option>S</option><option selected>M</option><option>L</option></select></label>' +
            '<label class="field"><span class="field__label" ' + biAttr('Bin / posisi', 'Bins / position') + '></span><select class="select" data-field="gen-rows"><option value="1">1</option><option value="2">2 (T + B)</option></select></label>' +
            '<button class="cbtn cbtn--primary" type="button" data-action="generate" ' + biAttr('Buat tata letak', 'Build layout') + '></button></div>' : '') +
          '</div>';
      applyLangTo(host);
    }

    /* ---- temporary inbound bins: how many SKUs one inbound batch can take ---- */
    function paintInbound(v) {
      setF('kpi-inbound', v ? n(v) : t('Bebas', 'No limit'));
      const host = region('inbound-edit');
      if (!host || !canEdit) return;
      host.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:6px';
      host.innerHTML = '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
        '<input class="input" type="number" min="1" max="200" style="width:84px" data-field="inbound-n" value="' + (v || '') + '" ' +
        'placeholder="—" aria-label="' + t('Jumlah bin inbound', 'Inbound bins') + '">' +
        '<button class="cbtn cbtn--sm" type="button" data-action="save-inbound" ' + biAttr('Simpan', 'Save') + '></button></span>' +
        '<span ' + biAttr('1 bin = 1 SKU per batch; kosong = tidak dibatasi', '1 bin = 1 SKU per batch; empty = no limit') + '></span>';
      applyLangTo(host);
      host.querySelector('[data-action="save-inbound"]').onclick = async () => {
        const raw = field('inbound-n').value.trim();
        try {
          say((await api.setInboundBins(site.id, raw === '' ? null : +raw)).message);
          paintInbound(raw === '' ? null : +raw);
        } catch (err) { fail(err); }
      };
    }

    /* ---- level 2: one rack ---- */
    // Two stacked bins at a position: T (top, row 2) and B (bottom, row 1).
    function binCell(b, rows) {
      const cls = 'bincell' + (b.sku_id ? ' is-used' : '') + (b.slot_role === 'overflow' ? ' is-overflow' : '');
      const tier = rows === 2 ? (b.bin_row === 2 ? 'T' : 'B') : '';
      return '<button class="' + cls + '" type="button" data-bin="' + b.location_id + '">' +
        '<span class="bincell__code"><span>' + esc(String(b.position_no).padStart(2, '0') + tier) + '</span>' +
        '<span>' + esc(b.basket_size || '') + '</span>' +
        (b.slot_role === 'overflow' ? '<span ' + biAttr('cadangan', 'overflow') + '></span>' : '') + '</span>' +
        (b.sku_id
          ? '<span class="bincell__sku">' + esc(b.sku_name) + '</span><span class="bincell__qty">' +
            n(b.qty_on_hand) + ' unit</span>'
          : '<span class="bincell__sku" style="color:var(--muted);font-weight:500" ' + biAttr('Kosong', 'Empty') + '></span>') +
        '</button>';
    }

    async function loadRack(id) {
      try { rack = await api.rack(id); } catch (e) { return fail(e); }
      setF('rack-title', t('Rak ', 'Rack ') + rack.rack.code);
      bi(field('rack-meta'),
        rack.rack.levels + ' tingkat · ' + rack.rack.bins + ' bin · ' + rack.rack.occupied + ' berisi SKU',
        rack.rack.levels + ' levels · ' + rack.rack.bins + ' bins · ' + rack.rack.occupied + ' with a SKU');
      const host = region('rack-levels');
      // A level with two stacked bins per position draws each position as a
      // pair, the top bin (T) above the bottom one (B), as on the rack.
      const positions = lv => {
        const by = {};
        lv.bins.forEach(b => { (by[b.position_no] = by[b.position_no] || []).push(b); });
        return Object.keys(by).sort((a, b) => a - b).map(k => by[k].sort((a, b) => b.bin_row - a.bin_row));
      };
      host.innerHTML = rack.levels.map(lv =>
        '<div class="elev__level">' +
        '<div class="elev__head"><span class="elev__no"><span ' + biAttr('Tingkat ', 'Level ') + '></span>' + lv.level_no + '</span>' +
        '<span class="rackcard__meta">' + lv.bins.length + ' bin' + (lv.bin_rows === 2 ? ' · T/B' : '') +
        (lv.is_open_shelf ? ' · <span ' + biAttr('terbuka', 'open') + '></span>' : '') + '</span>' +
        (canEdit && !lv.is_open_shelf ? '<button class="cbtn cbtn--sm" type="button" data-bin-rows="' + lv.level_id + '" data-rows="' +
          (lv.bin_rows === 2 ? 1 : 2) + '" ' + (lv.bin_rows === 2
            ? biAttr('Jadikan 1 bin / posisi', 'Back to 1 bin / position')
            : biAttr('Tumpuk 2 bin', 'Stack 2 bins')) + '></button>' : '') +
        (canEdit && lv.removable ? '<button class="cbtn cbtn--sm cbtn--ghost" type="button" data-remove-level="' + lv.level_id + '" ' +
          biAttr('Hapus tingkat', 'Remove level') + '></button>' : '') + '</div>' +
        '<div class="elev__bins">' + positions(lv).map(pair => pair.length > 1
          ? '<div class="binpair">' + pair.map(b => binCell(b, 2)).join('') + '</div>' : binCell(pair[0], lv.bin_rows)).join('') +
        (canEdit ? '<button class="bincell bincell--add" type="button" data-add-bins="' + lv.level_id + '" ' +
          biAttr('+ bin', '+ bin') + '></button>' : '') + '</div></div>').join('')
        || '<p class="note" ' + biAttr('Rak ini belum punya tingkat.', 'This rack has no levels yet.') + '></p>';
      applyLangTo(host);
    }

    /* ---- the needs-a-rack queue ---- */
    async function loadNeeds() {
      try { needs = (await api.needsRack(site.id)).skus; } catch (e) { return fail(e); }
      const host = region('needs-rows');
      host.innerHTML = needs.length ? needs.map(s =>
        '<tr><td class="td-thumb"><img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' +
        esc(s.photo_key || '') + '" alt=""></td>' +
        '<td class="td-strong">' + esc(s.name_display) + '</td>' +
        '<td class="td-code">' + esc([s.brand_code, s.brand_sku_code].filter(Boolean).join(' · ')) + '</td>' +
        '<td class="td-code">' + esc(s.recommended_size) + '</td>' +
        '<td class="td-code">' + (s.default_restock_point ?? '—') + ' · ' + (s.default_full_threshold ?? '—') + '</td>' +
        '<td class="td-actions">' + (canEdit ? '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-place="' + s.id + '" ' +
          biAttr('Pilih bin', 'Choose bin') + '></button>' : '') + '</td></tr>').join('')
        : '<tr><td colspan="6"><div class="empty"><span class="empty__title" ' +
          biAttr('Semua SKU sudah punya rak di hub ini', 'Every SKU has a rack at this hub') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    /* ---- routing ---- */
    async function route() {
      const h = location.hash;
      const m = h.match(/^#rack=(\d+)/);
      region('view-racks').hidden = !!m || h === '#needs';
      region('view-rack').hidden = !m;
      region('view-needs').hidden = h !== '#needs';
      if (m) await loadRack(+m[1]);
      else if (h === '#needs') await loadNeeds();
      else await loadSummary();
    }
    window.addEventListener('hashchange', route);

    async function refresh() {
      const m = location.hash.match(/^#rack=(\d+)/);
      if (m) await loadRack(+m[1]);
      if (location.hash === '#needs') await loadNeeds();
      loadSummary();
    }

    /* ---- bin drawer ---- */
    async function openBin(locId) {
      let b = null;
      rack.levels.forEach(lv => lv.bins.forEach(x => { if (x.location_id === locId) b = x; }));
      if (!b) return;
      binCtx = b;
      setF('bin-title', b.code);
      region('bin-holds').hidden = !b.sku_id;
      region('bin-assign').hidden = !!b.sku_id || !canEdit;
      if (b.sku_id) {
        setF('bin-sku', b.sku_name);
        bi(field('bin-sku-meta'),
          (b.brand_sku_code || '') + ' · ' + n(b.qty_on_hand) + ' unit' + (b.slot_role === 'overflow' ? ' · cadangan' : ' · rak ambil'),
          (b.brand_sku_code || '') + ' · ' + n(b.qty_on_hand) + ' units' + (b.slot_role === 'overflow' ? ' · overflow' : ' · rack face'));
        field('bin-photo').dataset.photoKey = '';
      } else if (canEdit) {
        field('bin-q').value = '';
        try { needs = (await api.needsRack(site.id)).skus; } catch (e) { needs = []; }
        paintCandidates('');
      }
      const size = field('bin-size');
      size.value = b.basket_size || 'M';
      size.disabled = !canEdit;
      const rm = $('[data-action="remove-bin"]');
      rm.hidden = !canEdit || !b.removable;
      openDrawer('#drawer-bin');
    }
    function paintCandidates(q) {
      const host = region('bin-candidates');
      const term = q.trim().toLowerCase();
      const list = needs.filter(s => !term || (s.name_display + ' ' + s.brand_sku_code).toLowerCase().includes(term)).slice(0, 30);
      host.innerHTML = list.length ? list.map(s =>
        '<button class="option" type="button" data-assign="' + s.id + '" style="display:flex;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--rule);border-radius:var(--radius-chip);background:var(--surface);text-align:left;cursor:pointer">' +
        '<span>' + esc(s.name_display) + '</span><span class="td-code" style="color:var(--muted)">' +
        esc(s.brand_sku_code) + ' · ' + esc(s.recommended_size) + '</span></button>').join('')
        : '<span class="note" ' + biAttr(needs.length ? 'Tidak ada yang cocok.' : 'Tidak ada SKU yang butuh rak di hub ini.',
          needs.length ? 'No match.' : 'No SKU needs a rack at this hub.') + '></span>';
      applyLangTo(host);
    }
    field('bin-q').addEventListener('input', e => paintCandidates(e.target.value));

    async function assign(skuId, basketId) {
      const r = await api.assignSlot({ site_id: site.id, sku_id: skuId, basket_id: basketId });
      say(r.sku_name + ' → ' + r.location_code);
    }

    field('bin-size').addEventListener('change', async e => {
      if (!binCtx || !binCtx.basket_id) return;
      try {
        const r = await api.setBasketSize(binCtx.basket_id, e.target.value);
        say(r.message);
        refresh();
      } catch (err) { fail(err); }
    });

    /* ---- place drawer (from the queue) ---- */
    async function openPlace(skuId) {
      placeSku = needs.find(s => s.id === skuId);
      if (!placeSku) return;
      bi(field('pl-title'), 'Pilih bin · ' + placeSku.name_display, 'Choose bin · ' + placeSku.name_display);
      setF('pl-meta', [placeSku.brand_sku_code, t('saran keranjang ', 'suggested basket ') + placeSku.recommended_size].join(' · '));
      field('pl-photo').dataset.photoKey = placeSku.photo_key || '';
      const selBin = field('pl-bin');
      selBin.innerHTML = '<option>' + t('Memuat…', 'Loading…') + '</option>';
      openDrawer('#drawer-place');
      try {
        const [map, sug] = await Promise.all([
          api.rackMap(site.id),
          api.raw.get('/slots/suggest' + api.raw.qs({ site_id: site.id, sku_id: skuId })),
        ]);
        const free = [];
        map.racks.forEach(rk => rk.levels.forEach(lv => lv.positions.forEach(p => {
          if (p.basket_id && !p.sku_id) free.push(p);
        })));
        selBin.innerHTML = free.length ? free.map(p =>
          '<option value="' + p.basket_id + '"' + (p.code === sug.location_code ? ' selected' : '') + '>' +
          esc(p.code) + ' · ' + esc(p.basket_size) + (p.code === sug.location_code ? ' · ' + t('saran', 'suggested') : '') +
          '</option>').join('')
          : '<option value="">' + t('Tidak ada bin kosong — tambah bin atau rak dulu', 'No empty bin — add a bin or rack first') + '</option>';
      } catch (e) { fail(e); }
    }

    /* ---- clicks ---- */
    document.addEventListener('click', async e => {
      const card = e.target.closest('[data-rack]');
      if (card) { location.hash = 'rack=' + card.dataset.rack; return; }
      if (e.target.closest('[data-action="back-racks"]')) { location.hash = ''; return; }
      if (e.target.closest('[data-action="show-needs"]')) { location.hash = 'needs'; return; }

      const bin = e.target.closest('[data-bin]');
      if (bin) return openBin(+bin.dataset.bin);

      const as = e.target.closest('[data-assign]');
      if (as && binCtx) {
        try {
          await assign(+as.dataset.assign, binCtx.basket_id);
          closeDrawers();
          refresh();
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="remove-bin"]') && binCtx) {
        if (!confirm(t('Hapus bin ', 'Remove bin ') + binCtx.code + '?')) return;
        try {
          say((await api.removeBin(binCtx.location_id)).message);
          closeDrawers();
          refresh();
        } catch (err) { fail(err); }
        return;
      }

      const br = e.target.closest('[data-bin-rows]');
      if (br) {
        const rows = +br.dataset.rows;
        if (!confirm(rows === 2
          ? t('Tumpuk bin kedua di setiap posisi tingkat ini? Bin yang ada jadi B (bawah), bin baru T (atas).',
              'Stack a second bin at every position on this level? The bin already there becomes B (bottom), the new one T (top).')
          : t('Hapus semua bin T (atas) di tingkat ini? Hanya bisa kalau belum pernah dipakai. Bin B kembali ke kode tanpa huruf.',
              'Remove every T (top) bin on this level? Only possible if none was ever used. The B bins get their plain code back.'))) return;
        try { say((await api.setBinRows(+br.dataset.binRows, rows)).message); refresh(); } catch (err) { fail(err); }
        return;
      }
      const rl = e.target.closest('[data-remove-level]');
      if (rl) {
        if (!confirm(t('Hapus tingkat paling atas rak ini?', 'Remove the top level of this rack?'))) return;
        try { say((await api.removeLevel(+rl.dataset.removeLevel)).message); refresh(); } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="generate"]')) {
        const codes = field('gen-codes').value.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
        if (!codes.length) return say(t('Isi minimal satu kode rak.', 'Enter at least one rack code.'));
        if (!confirm(t('Buat ' + codes.length + ' rak di ' + site.code + '?', 'Build ' + codes.length + ' racks at ' + site.code + '?'))) return;
        try {
          const r = await api.raw.post('/sites/' + site.id + '/racks/generate', {
            rack_codes: codes, level_count: +field('gen-levels').value || 5,
            positions_per_level: +field('gen-bins').value || 5, basket_size: field('gen-size').value,
            bin_rows: +field('gen-rows').value || 1,
          });
          say(r.message);
          loadSummary();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="new-rack"]')) {
        const used = new Set((summary ? summary.racks : []).map(r => r.code));
        const next = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(c => !used.has(c)) || '';
        field('nr-code').value = next;
        return openDrawer('#drawer-rack');
      }
      if (e.target.closest('[data-action="save-rack"]')) {
        const code = field('nr-code').value.trim().toUpperCase();
        if (!code) return say(t('Isi kode rak.', 'Enter a rack code.'));
        try {
          const r = await api.addRack(site.id, {
            code, level_count: +field('nr-levels').value || 5,
            positions_per_level: +field('nr-bins').value || 5, basket_size: field('nr-size').value,
            bin_rows: +field('nr-rows').value || 1,
          });
          say(r.message);
          closeDrawers();
          loadSummary();
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="add-level"]') && rack) {
        levelCtx = { mode: 'level', rackId: rack.rack.rack_id };
        bi(field('lv-title'), 'Tambah tingkat · rak ' + rack.rack.code, 'Add level · rack ' + rack.rack.code);
        bi(field('lv-count-label'), 'Jumlah bin di tingkat baru', 'Bins on the new level');
        region('lv-open-field').hidden = false;
        region('lv-rows-field').hidden = false;
        region('lv-size-field').hidden = false;
        field('lv-count').value = rack.levels.length ? rack.levels[0].bins.length || 5 : 5;
        return openDrawer('#drawer-level');
      }
      const ab = e.target.closest('[data-add-bins]');
      if (ab && rack) {
        const lv = rack.levels.find(l => l.level_id === +ab.dataset.addBins);
        levelCtx = { mode: 'bins', levelId: +ab.dataset.addBins };
        bi(field('lv-title'), 'Tambah bin · tingkat ' + (lv ? lv.level_no : ''), 'Add bins · level ' + (lv ? lv.level_no : ''));
        bi(field('lv-count-label'), 'Jumlah bin', 'Number of bins');
        region('lv-open-field').hidden = true;
        region('lv-rows-field').hidden = true;
        region('lv-size-field').hidden = !!(lv && lv.is_open_shelf);
        field('lv-count').value = 1;
        return openDrawer('#drawer-level');
      }
      if (e.target.closest('[data-action="save-level"]') && levelCtx) {
        const count = +field('lv-count').value || 1;
        try {
          const r = levelCtx.mode === 'level'
            ? await api.addLevel(levelCtx.rackId, { bins: count, basket_size: field('lv-size').value, open_shelf: field('lv-open').checked,
                                                    bin_rows: field('lv-rows').checked && !field('lv-open').checked ? 2 : 1 })
            : await api.addBins(levelCtx.levelId, { count, basket_size: field('lv-size').value });
          say(r.message);
          closeDrawers();
          refresh();
        } catch (err) { fail(err); }
        return;
      }

      const pl = e.target.closest('[data-place]');
      if (pl) return openPlace(+pl.dataset.place);
      if (e.target.closest('[data-action="save-place"]') && placeSku) {
        const basket = +field('pl-bin').value;
        if (!basket) return say(t('Pilih bin kosong.', 'Choose an empty bin.'));
        try {
          await assign(placeSku.id, basket);
          closeDrawers();
          loadNeeds();
          loadSummary();
        } catch (err) { fail(err); }
      }
    });

    await route();
  };
})();
