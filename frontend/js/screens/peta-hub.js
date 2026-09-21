/* screens/peta-hub.js — Ops HQ: every hub, then one hub's layout map
 * (console/peta-hub.html).
 *
 *   GET /api/hq/hubs              rack availability and stock health per hub
 *   GET /api/sites/{id}/layout    every rack, level and bin with its stock status
 *   PUT /api/registry/{sku_id}    R and P for a SKU at a hub (Ops HQ only)
 *
 * The map is for looking, not arranging: a bin is a small square coloured by its
 * SKU's stock at the hub, so a floor of 175+ bins reads in one glance. Setting
 * up racks stays on the Rak & bin page.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const n = v => NJW.fmt.n(v);

  const STATUS = {
    ok: ['Stok aman', 'Stock fine'],
    low: ['Menipis (≤ R)', 'Low (≤ R)'],
    critical: ['Kritis (≤ safety)', 'Critical (≤ safety)'],
    out: ['Habis', 'Out of stock'],
    unset: ['Belum ada R', 'No R set'],
    empty: ['Bin kosong', 'Empty bin'],
    used: ['Bin terpakai', 'Bin in use'],
  };

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
  const numCls = (v, kind) => (!v ? 'num-zero' : kind);

  NJW.screens['peta-hub'] = async () => {
    const canEdit = W.atLeast('hq');
    let hubs = [], siteId = null, map = null, mode = 'stock', binCtx = null;
    try { mode = localStorage.getItem('njw.mapMode') || 'stock'; } catch (e) { /* default */ }

    /* ---- every hub ---- */
    async function loadHubs() {
      try { hubs = (await api.hubOverview()).hubs; } catch (e) { return fail(e); }
      const live = hubs.filter(h => !h.is_training);
      const sum = k => live.reduce((a, h) => a + h[k], 0);
      setF('k-free', n(sum('bins_free')));
      bi(field('k-free-foot'), 'dari ' + n(sum('bins')) + ' bin di ' + live.length + ' hub',
         'of ' + n(sum('bins')) + ' bins at ' + live.length + ' hubs');
      setF('k-needs', n(sum('needs_rack')));
      setF('k-low', n(sum('skus_low')));
      bi(field('k-low-foot'), n(sum('skus_critical')) + ' di bawah safety stock', n(sum('skus_critical')) + ' below safety stock');
      setF('k-out', n(sum('skus_out')));
      bi(field('k-out-foot'), n(sum('units')) + ' unit tersimpan', n(sum('units')) + ' units held');
      region('k-needs-card').classList.toggle('kpi-card--caution', sum('needs_rack') > 0);
      region('k-low-card').classList.toggle('kpi-card--caution', sum('skus_low') > 0);
      region('k-out-card').classList.toggle('kpi-card--stop', sum('skus_out') > 0);

      const host = region('hubs');
      host.innerHTML = hubs.length ? hubs.map(h => {
        const pct = h.bins ? Math.round(h.bins_used / h.bins * 100) : 0;
        return '<tr class="hubrow' + (h.site_id === siteId ? ' is-on' : '') + '" data-hub="' + h.site_id + '" tabindex="0">' +
          '<td><span class="td-code td-strong">' + esc(h.site_code) + '</span>' +
          (h.is_training ? ' <span class="badge-training" ' + biAttr('LATIHAN', 'TRAINING') + '></span>' : '') +
          '<br><span style="color:var(--muted);font-size:var(--fs-c-meta)">' + esc(h.site_name) + '</span></td>' +
          '<td><span class="availbar"><span class="availbar__track"><span class="availbar__fill' +
          (pct > 85 ? ' is-tight' : '') + '" style="width:' + pct + '%"></span></span>' +
          '<span class="availbar__num">' + n(h.bins_used) + '/' + n(h.bins) + ' · ' + pct + '%</span></span></td>' +
          '<td class="td-num td-code">' + n(h.bins_free) + '</td>' +
          '<td class="td-num td-code ' + numCls(h.needs_rack, 'num-warn') + '">' + n(h.needs_rack) + '</td>' +
          '<td class="td-num td-code">' + n(h.skus_racked) + '</td>' +
          '<td class="td-num td-code">' + n(h.units) + '</td>' +
          '<td class="td-num td-code ' + numCls(h.skus_low, 'num-warn') + '">' + n(h.skus_low) +
          (h.skus_critical ? ' <span class="num-stop">(' + n(h.skus_critical) + ')</span>' : '') + '</td>' +
          '<td class="td-num td-code ' + numCls(h.skus_out, 'num-stop') + '">' + n(h.skus_out) + '</td>' +
          '<td class="td-num td-code ' + numCls(h.skus_unset, 'num-warn') + '">' + n(h.skus_unset) + '</td>' +
          '<td class="td-num td-code">' + n(h.deliveries_incoming) + '</td>' +
          '<td class="td-num td-code ' + numCls(h.variances_open, 'num-warn') + '">' + n(h.variances_open) + '</td></tr>';
      }).join('') : '<tr><td colspan="11" class="note" ' + biAttr('Belum ada hub.', 'No hubs yet.') + '></td></tr>';
      applyLangTo(host);

      const sel = field('map-site');
      sel.innerHTML = hubs.map(h => '<option value="' + h.site_id + '"' + (h.site_id === siteId ? ' selected' : '') + '>' +
        esc(h.site_code) + ' · ' + esc(h.site_name) + '</option>').join('');
      if (!siteId && hubs.length) {
        const cur = W.site();
        const first = hubs.find(h => cur && h.site_id === cur.id && !h.is_training) || hubs.find(h => !h.is_training) || hubs[0];
        selectHub(first.site_id, false);
      }
    }

    /* ---- one hub's map ---- */
    function binClass(b) {
      const base = mode === 'space' ? (b.sku_id ? 'used' : 'empty') : b.status;
      return 'lbin lbin--' + base + (b.slot_role === 'overflow' ? ' is-overflow' : '');
    }
    function binTitle(b) {
      if (!b.sku_id) return b.code + ' · ' + t('kosong', 'empty');
      return b.code + ' · ' + b.sku_name + ' · ' + t('di bin ', 'here ') + b.qty_here + ' · ' +
        t('hub ', 'hub ') + b.qty_total + ' · S ' + (b.safety_stock ?? '—') + ' · R ' + (b.restock_point ?? '—') +
        ' · P ' + (b.full_threshold ?? '—');
    }
    function paintLegend() {
      const keys = mode === 'space' ? ['used', 'empty'] : ['ok', 'low', 'critical', 'out', 'unset', 'empty'];
      const c = map ? map.counts : {};
      const used = map ? (c.ok + c.low + (c.critical || 0) + c.out + c.unset) : 0;
      region('legend').innerHTML = keys.map(k => {
        const count = k === 'used' ? used : (c[k] || 0);
        return '<span><i class="swatch lbin--' + k + '" style="border:1px solid"></i><span ' +
          biAttr(STATUS[k][0], STATUS[k][1]) + '></span> <b class="td-code">' + n(count) + '</b></span>';
      }).join('') +
        '<span><i class="swatch" style="position:relative;background:transparent"><i style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--accent)"></i></i><span ' +
        biAttr('Bin cadangan', 'Overflow bin') + '></span></span>' +
        (map && map.needs_rack ? '<span class="num-warn"><span ' + biAttr(map.needs_rack + ' SKU belum punya rak di hub ini',
          map.needs_rack + ' SKUs have no rack at this hub') + '></span></span>' : '');
      applyLangTo(region('legend'));
      $$('[data-mode]').forEach(b => b.classList.toggle('is-on', b.dataset.mode === mode));
    }
    function paintMap() {
      const host = region('lmap');
      if (!map) return;
      host.innerHTML = map.racks.length ? map.racks.map(rk => {
        const bins = rk.levels.reduce((a, lv) => a + lv.bins.length, 0);
        const used = rk.levels.reduce((a, lv) => a + lv.bins.filter(b => b.sku_id).length, 0);
        return '<div class="lrack"><div class="lrack__head"><span class="lrack__code">' + esc(rk.code) + '</span>' +
          '<span class="lrack__meta">' + used + '/' + bins + '</span></div>' +
          rk.levels.map(lv => '<div class="lrow"><span class="lrow__no">' + lv.level_no + '</span>' +
            pairs(lv).map(pair => pair.length > 1
              ? '<span class="lpair">' + pair.map(binBtn).join('') + '</span>' : binBtn(pair[0])).join('') +
            '</div>').join('') + '</div>';
      }).join('') : '<div class="empty"><span class="empty__title" ' + biAttr('Hub ini belum punya rak', 'This hub has no racks yet') +
        '></span></div>';
      applyLangTo(host);
      applySearch();
      paintLegend();
    }
    // Two stacked bins at one position are drawn as one short column, T above B.
    function pairs(lv) {
      const by = {};
      lv.bins.forEach(b => { (by[b.position_no] = by[b.position_no] || []).push(b); });
      return Object.keys(by).sort((a, b) => a - b).map(k => by[k].sort((a, b) => b.bin_row - a.bin_row));
    }
    function binBtn(b) {
      return '<button type="button" class="' + binClass(b) + '" data-loc="' + b.location_id + '" title="' +
        esc(binTitle(b)) + '" aria-label="' + esc(binTitle(b)) + '">' +
        (b.sku_id && mode === 'stock' ? (b.qty_total > 999 ? '999+' : b.qty_total) : '') + '</button>';
    }

    function applySearch() {
      const q = (field('map-q').value || '').trim().toLowerCase();
      const host = region('lmap');
      host.classList.toggle('is-searching', !!q);
      if (!map) return;
      const all = {};
      map.racks.forEach(rk => rk.levels.forEach(lv => lv.bins.forEach(b => { all[b.location_id] = b; })));
      $$('[data-loc]', host).forEach(el => {
        const b = all[el.dataset.loc];
        const hay = (b.code + ' ' + (b.sku_name || '') + ' ' + (b.brand_sku_code || '')).toLowerCase();
        el.classList.toggle('is-match', !!q && hay.includes(q));
      });
    }

    async function selectHub(id, scroll) {
      siteId = id;
      $$('.hubrow').forEach(r => r.classList.toggle('is-on', +r.dataset.hub === id));
      field('map-site').value = id;
      const h = hubs.find(x => x.site_id === id);
      bi(field('map-title'), 'Peta layout · ' + (h ? h.site_code : ''), 'Layout map · ' + (h ? h.site_code : ''));
      field('map-rack-link').dataset.site = id;
      try { map = await api.layout(id); } catch (e) { map = null; return fail(e); }
      paintMap();
      if (scroll) $('#map').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---- bin drawer ---- */
    function findBin(loc) {
      let hit = null;
      map.racks.forEach(rk => rk.levels.forEach(lv => lv.bins.forEach(b => { if (b.location_id === loc) hit = b; })));
      return hit;
    }
    function openBin(loc) {
      const b = findBin(loc);
      if (!b) return;
      binCtx = b;
      setF('b-title', b.code);
      region('b-empty').hidden = !!b.sku_id;
      region('b-sku').hidden = !b.sku_id;
      $('[data-action="save-thresholds"]').hidden = !b.sku_id || !canEdit;
      if (b.sku_id) {
        setF('b-name', b.sku_name);
        setF('b-code', b.brand_sku_code || '');
        const img = field('b-photo');
        img.removeAttribute('data-photo-src');
        img.src = '../assets/products/placeholder.svg';
        img.dataset.photoKey = b.photo_key || '';
        const st = STATUS[b.status] || ['', ''];
        const tone = { ok: 'ok', low: 'warn', critical: 'stop', out: 'stop', unset: 'neutral' }[b.status] || 'neutral';
        field('b-status').innerHTML = '<span class="spill spill--' + tone + '"><span class="spill__dot"></span><span ' +
          biAttr(st[0], st[1]) + '></span></span>';
        applyLangTo(field('b-status'));
        setF('b-here', n(b.qty_here) + ' unit');
        setF('b-total', n(b.qty_total) + ' unit');
        bi(field('b-role'), b.slot_role === 'overflow' ? 'Cadangan' : 'Rak ambil', b.slot_role === 'overflow' ? 'Overflow' : 'Rack face');
        field('b-r').value = b.restock_point ?? '';
        field('b-p').value = b.full_threshold ?? '';
        field('b-s').value = b.safety_stock ?? '';
        field('b-r').disabled = field('b-p').disabled = field('b-s').disabled = field('b-all').disabled = !canEdit;
        field('b-all').checked = false;
      }
      openDrawer('#drawer-lbin');
    }

    async function saveThresholds() {
      const b = binCtx;
      if (!b || !b.sku_id) return;
      const rRaw = field('b-r').value.trim(), pRaw = field('b-p').value.trim(), sRaw = field('b-s').value.trim();
      const full = pRaw === '' ? null : +pRaw;
      // R left empty takes 25% of P, the same default the server applies.
      const restock = rRaw !== '' ? +rRaw
        : full >= 2 ? Math.min(full - 1, Math.max(1, Math.round(full * 0.25))) : null;
      const safety = sRaw === '' ? null : +sRaw;
      if (restock == null) return say(t('Isi P (penuh) — R otomatis 25% darinya — atau isi R.', 'Enter P (full) — R defaults to 25% of it — or R.'));
      if (restock < 0) return say(t('R tidak boleh negatif.', 'R cannot be negative.'));
      if (full != null && full <= restock) return say(t('P harus lebih besar dari R.', 'P must be above R.'));
      if (safety != null && (safety < 0 || safety > restock)) return say(t('S harus di antara 0 dan R.', 'S must be between 0 and R.'));
      const body = id => ({ site_id: id, full_threshold: full, low_threshold: null, restock_point: restock, safety_stock: safety });
      try {
        let targets = [siteId];
        if (field('b-all').checked) {
          const r = await api.skuRacks(b.sku_id);
          targets = r.sites.filter(s => s.location_code).map(s => s.site_id);
        }
        for (const id of targets) await api.updateRegistry(b.sku_id, body(id));
        say(b.sku_name + ': S ' + (safety ?? '—') + ' · R ' + restock + ' · P ' + (full ?? '—') +
            (targets.length > 1 ? t(' di ' + targets.length + ' hub', ' at ' + targets.length + ' hubs') : ''));
        closeDrawers();
        await selectHub(siteId, false);
        loadHubs();
      } catch (err) { fail(err); }
    }

    /* ---- events ---- */
    document.addEventListener('click', e => {
      const row = e.target.closest('[data-hub]');
      if (row) return selectHub(+row.dataset.hub, true);
      const bin = e.target.closest('[data-loc]');
      if (bin) return openBin(+bin.dataset.loc);
      const m = e.target.closest('[data-mode]');
      if (m) {
        mode = m.dataset.mode;
        try { localStorage.setItem('njw.mapMode', mode); } catch (err) { /* per-viewer nicety */ }
        return paintMap();
      }
      if (e.target.closest('[data-action="save-thresholds"]')) return saveThresholds();
      if (e.target.closest('[data-action="refresh"]')) { loadHubs(); if (siteId) selectHub(siteId, false); return; }
      const link = e.target.closest('[data-field="map-rack-link"]');
      if (link && link.dataset.site) W.CTX.set('site', +link.dataset.site);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('[data-hub]')) selectHub(+e.target.dataset.hub, true);
    });
    field('map-site').addEventListener('change', e => selectHub(+e.target.value, false));
    field('map-q').addEventListener('input', applySearch);

    if (!W.atLeast('hq')) {
      region('hubs').innerHTML = '<tr><td colspan="11"><div class="empty"><span class="empty__title" ' +
        biAttr('Halaman ini untuk Ops HQ', 'This page is for Ops HQ') + '></span></div></td></tr>';
      return applyLangTo(region('hubs'));
    }
    await loadHubs();
  };
})();
