/* rack-map — screen 13: the whole station at a glance, plus the variances
 * waiting for a supervisor's signature.
 *
 * Cell states, each with a word in the legend (never colour alone):
 *   free   — no product assigned to the basket
 *   occ    — holds a product
 *   over   — a rack face holding more than its full threshold (registry)
 *   count  — a product not counted in the last 30 days (same rule as the
 *            "Belum dihitung 30 hari" figure on the console stock screens)
 * Overflow baskets are a different KIND of place, not a status, so they get
 * the hatch. They can sit in any rack now, so the hatch is per cell; a rack
 * holding nothing but overflow is drawn as an overflow rack.
 *
 * Replaces the wire.js rack-map handler (it marked qty 0 as over capacity and
 * a short expiry tier as "needs counting").
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, region, setF, bi, esc, biAttr, applyLangTo, fail } = W;
  const STALE_MS = 30 * 864e5;

  NJW.screens['rack-map'] = async () => {
    const site = W.site();
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Peta rak · ' + site.code, 'Rack map · ' + site.code); }

    let m;
    const [reg, inv, plans] = await Promise.all([
      NJW.api.registry({ site_id: site.id, limit: 500 }).catch(() => null),
      NJW.api.inventory({ site_id: site.id, limit: 1000 }).catch(() => null),
      NJW.api.opnamePlans({ site_id: site.id, limit: 20 }).catch(() => null),
      NJW.api.rackMap(site.id).then(x => { m = x; }),
    ]).catch(e => { fail(e); return []; });
    if (!m) return;

    const overflow = new Set(((reg && reg.rows) || []).map(r => r.overflow_location_code).filter(Boolean));
    const full = new Map(((reg && reg.rows) || []).map(r => [r.primary_location_code, r.full_threshold]));
    const lastCounted = new Map();
    ((inv && inv.rows) || []).forEach(r => {
      if (r.last_counted_at) lastCounted.set(r.sku_id, r.last_counted_at);
    });
    const stale = skuId => {
      const t = lastCounted.get(skuId);
      return !t || Date.now() - NJW.toDate(t).getTime() > STALE_MS;
    };

    const prefix = site.code.split('-').pop();
    const order = [];        // location codes in render order, to find each cell after
    let positions = 0, overflowCells = 0;
    const racks = m.racks.map(r => {
      const levels = r.levels.slice().sort((a, b) => b.level_no - a.level_no);
      const occupied = levels.flatMap(lv => lv.positions.filter(p => p.state === 'occupied'));
      const allOverflow = occupied.length > 0 && occupied.every(p => overflow.has(p.code));
      return {
        name: prefix + '-' + r.code,
        overflow: allOverflow,
        levels: levels.map(lv => ({
          n: lv.level_no,
          cells: lv.positions.map(p => {
            order.push(p.code);
            const isOv = overflow.has(p.code);
            if (isOv) overflowCells++;
            else if (!allOverflow) positions++;
            let st = 'free';
            if (p.state === 'occupied') {
              const cap = full.get(p.code);
              st = !isOv && cap != null && p.qty_on_hand > cap ? 'over'
                : stale(p.sku_id) ? 'count' : 'occ';
            }
            return { pos: p.position_no, state: st, sku: p.sku_name, qty: p.qty_on_hand, code: p.code, ov: isOv };
          }),
        })),
      };
    });

    const host = region('rackmap');
    NJW.renderRackMap(host, racks);

    // The shared renderer only knows whole overflow racks; hatch single cells.
    const cells = $$('.rack:not(.rack--gutter) .cell', host);
    const flat = racks.flatMap(r => r.levels.flatMap(lv => lv.cells.map(c => ({ c, rackOv: r.overflow }))));
    let used = 0, over = 0, tocount = 0;
    flat.forEach(({ c, rackOv }, i) => {
      const el = cells[i];
      if (!el) return;
      if (c.ov && !rackOv) { el.classList.add('is-overflow'); el.title += ' · cadangan'; }
      if (c.ov || rackOv) return;   // overflow is storage, not a rack position
      if (c.state !== 'free') used++;
      if (c.state === 'over') over++;
      if (c.state === 'count') tocount++;
    });
    setF('used', used + ' / ' + positions);
    setF('over', over);
    setF('tocount', tocount);

    const nRacks = racks.filter(r => !r.overflow).length;
    bi($('[data-field="map-title"]'),
      nRacks + ' rak · ' + positions + ' posisi · ' + overflowCells + ' keranjang cadangan',
      nRacks + ' racks · ' + positions + ' positions · ' + overflowCells + ' overflow baskets');

    await paintVariances(plans);
  };

  /* Variances from every open plan that has any, largest rupiah value first
     (the server's own order within a plan). Rows the API marks as signed —
     once it can — are left out. */
  async function paintVariances(plans) {
    const panel = region('variances');
    if (!panel) return;
    const open = ((plans && plans.plans) || []).filter(p => p.status !== 'closed' && p.variances > 0);
    let rows = [];
    try {
      const reps = await Promise.all(open.map(p =>
        NJW.api.raw.get('/opname/plans/' + p.id + '/variance-report')));
      rows = reps.flatMap(r => r.rows).filter(r => !r.approved_at && r.status !== 'approved');
    } catch (e) { if (e.status === 401) return fail(e); }

    const head = $('.panel__head', panel);
    panel.innerHTML = '';
    if (head) panel.appendChild(head);
    if (!rows.length) {
      panel.insertAdjacentHTML('beforeend', '<div class="varrow"><span class="note" ' +
        biAttr('Tidak ada selisih yang menunggu.', 'No variance is waiting.') + '></span></div>');
    } else {
      panel.insertAdjacentHTML('beforeend', rows.slice(0, 8).map(r =>
        '<div class="varrow"><span class="varrow__top"><span class="code code--sm">' +
        esc(r.location_code) + '</span><span class="varrow__delta">' +
        (r.variance > 0 ? '+' : '−') + Math.abs(r.variance) + '</span></span>' +
        '<span class="note">' + esc(r.sku_name || '—') + ' · ' +
        esc(String(r.counted_by || '').split('@')[0] || '—') + '</span></div>').join(''));
    }
    applyLangTo(panel);

    const btn = $('[data-action="review"]');
    if (btn) {
      if (rows.length) bi(btn, 'Tinjau ' + rows.length + ' selisih', 'Review ' + rows.length + ' variances');
      else bi(btn, 'Buka hitung stok', 'Open stock count');
    }
  }
})();
