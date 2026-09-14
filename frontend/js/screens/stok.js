/* stok — console: stock on hand, one row per product per location.
 *
 * /api/inventory returns every balance at the site in one response (it takes
 * a limit, not an offset), so search, filters, sort and paging all run here
 * over the full list. console.js's own search and sort only ever see the rows
 * currently in the DOM, which with paging would be one page of truth; the
 * search box is therefore not bound to it, and sorting is taken over below.
 *
 * Capacity and overflow come from the slot registry: the rack's full
 * threshold is where new stock starts going to overflow.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, bi, biAttr, esc, applyLangTo, say, fail } = W;
  const tx = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const PAGE = 50;
  const STALE_MS = 30 * 864e5;
  // Same default the low-stock endpoint uses, measured per product (rack +
  // overflow together) because the picker is sent wherever the older stock is.
  const LOW = 10;

  const TIER = {
    stable: ['ok', 'Stabil', 'Stable'],
    watch: ['accent', 'Pantau', 'Watch'],
    short: ['warn', 'Pendek', 'Short'],
  };
  const OWNER = { grab: 'Grab', brand: 'Brand', ninja: 'Ninja' };
  const MOVE = {
    receipt_in: ['Barang masuk', 'Inbound'], pick_out: ['Diambil', 'Picked'],
    adjustment: ['Penyesuaian hitung', 'Count adjustment'],
    relocate_in: ['Pindah masuk', 'Moved in'], relocate_out: ['Pindah keluar', 'Moved out'],
    transfer_out: ['Transfer keluar', 'Transfer out'], return_in: ['Kembali ke rak', 'Returned to shelf'],
    label_bind: ['Label unit', 'Unit label'], short: ['Barang tidak ada', 'Short pick'],
    bulk_upload: ['Unggah stok', 'Stock upload'],
  };

  NJW.screens.stok = async () => {
    const site = W.site();
    let rows = [];
    let filter = 'all', rack = '', q = '', page = 0;
    let sortKey = 'location_code', asc = true;

    async function load() {
      const [inv, reg, skus] = await Promise.all([
        NJW.api.inventory({ site_id: site.id, limit: 1000 }),
        NJW.api.registry({ site_id: site.id, limit: 500 }).catch(() => null),
        NJW.api.skus({ limit: 500 }).catch(() => null),
      ]);
      const skuById = new Map(((skus && skus.skus) || []).map(s => [s.id, s]));
      const primary = new Map(), overflow = new Set();
      ((reg && reg.rows) || []).forEach(r => {
        if (r.primary_location_code) primary.set(r.primary_location_code, r);
        if (r.overflow_location_code) overflow.add(r.overflow_location_code);
      });
      const skuAvail = new Map();
      inv.rows.forEach(r => skuAvail.set(r.sku_id, (skuAvail.get(r.sku_id) || 0) + r.available));

      rows = inv.rows.map(r => {
        const sku = skuById.get(r.sku_id) || {};
        const slot = primary.get(r.location_code);
        const cap = slot ? slot.full_threshold : null;
        const code = r.location_code || '';
        return Object.assign({}, r, {
          brand_sku_code: sku.brand_sku_code || (slot && slot.brand_sku_code) || '',
          price: sku.price_idr || 0,
          capacity: cap,
          is_overflow: overflow.has(code),
          over: cap != null && r.qty_on_hand > cap,
          low: (skuAvail.get(r.sku_id) || 0) <= LOW,
          stale: !r.last_counted_at || Date.now() - NJW.toDate(r.last_counted_at).getTime() > STALE_MS,
          rack: code.split('-')[1] || '',
        });
      });

      // KPIs over the whole site, not the current filter.
      const skuIds = new Set(rows.map(r => r.sku_id));
      setF('kpi-slotted', NJW.fmt.n(reg ? reg.total : skuIds.size));
      if (skus) bi(field('kpi-slotted-foot'), 'dari ' + NJW.fmt.n(skus.total) + ' SKU aktif',
                                              'of ' + NJW.fmt.n(skus.total) + ' active SKUs');
      setF('kpi-units', NJW.fmt.n(rows.reduce((n, r) => n + r.qty_on_hand, 0)));
      const value = rows.reduce((n, r) => n + r.qty_on_hand * r.price, 0);
      if (value) bi(field('kpi-units-foot'), 'nilai ' + compact(value, 'id'), 'value ' + compact(value, 'en'));
      else bi(field('kpi-units-foot'), 'nilai belum ada (harga kosong)', 'no value (no prices)');
      setF('kpi-over', rows.filter(r => r.over).length);
      const staleSkus = new Set(rows.filter(r => r.stale).map(r => r.sku_id));
      setF('kpi-stale', staleSkus.size);

      // Owner column only once the API sends stock_owner.
      const hasOwner = rows.some(r => r.stock_owner !== undefined);
      const oh = field('owner-head');
      if (oh) oh.hidden = !hasOwner;

      const sel = field('rack');
      if (sel && sel.options.length <= 1) {
        Array.from(new Set(rows.map(r => r.rack).filter(Boolean))).sort().forEach(k => {
          const o = document.createElement('option');
          o.value = k;
          bi(o, 'Rak ' + k, 'Rack ' + k);
          sel.appendChild(o);
        });
      }
      render();
    }

    function compact(v, lang) {
      if (v >= 1e9) return 'Rp ' + (v / 1e9).toFixed(2).replace('.', lang === 'id' ? ',' : '.') + (lang === 'id' ? ' M' : ' bn');
      if (v >= 1e6) return 'Rp ' + (v / 1e6).toFixed(1).replace('.', lang === 'id' ? ',' : '.') + (lang === 'id' ? ' jt' : ' m');
      return NJW.fmt.idr(v);
    }

    function visible() {
      const s = q.toLowerCase();
      return rows.filter(r =>
        (filter === 'all' || (filter === 'over' && r.over) || (filter === 'low' && r.low)) &&
        (!rack || r.rack === rack) &&
        (!s || [r.location_code, r.sku_name, r.brand_sku_code, r.brand_code]
          .some(x => String(x || '').toLowerCase().includes(s))))
        .sort((a, b) => {
          const x = a[sortKey] ?? '', y = b[sortKey] ?? '';
          return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
        });
    }

    function rowHtml(r, hasOwner) {
      const t = TIER[r.expiry_tier] || ['neutral', r.expiry_tier || '—', r.expiry_tier || '—'];
      const muted = 'style="color:var(--muted)"';
      return '<tr data-sku="' + r.sku_id + '">' +
        '<td class="td-code td-strong">' + esc(r.location_code || '—') +
          (r.is_overflow ? ' <span class="spill spill--neutral" ' + biAttr('cadangan', 'overflow') + '>cadangan</span>' : '') + '</td>' +
        '<td>' + esc(r.sku_name) + '</td>' +
        '<td class="td-code" ' + muted + '>' + esc(r.brand_sku_code || '—') + '</td>' +
        '<td class="td-num"' + (r.over ? ' style="color:var(--caution);font-weight:700"' : '') + '>' + r.qty_on_hand + '</td>' +
        '<td class="td-num" ' + muted + '>' + (r.qty_allocated || '—') + '</td>' +
        '<td class="td-num td-strong">' + r.available + '</td>' +
        '<td class="td-num" ' + muted + (r.over ? ' title="Di atas batas penuh / above the full threshold"' : '') + '>' +
          (r.capacity != null ? r.capacity + (r.over ? ' ⚠' : '') : '—') + '</td>' +
        (hasOwner ? '<td>' + esc(OWNER[r.stock_owner] || r.stock_owner || '—') + '</td>' : '<td hidden></td>') +
        '<td><span class="spill spill--' + t[0] + '"><span class="spill__dot"></span><span ' +
          biAttr(t[1], t[2]) + '>' + esc(t[1]) + '</span></span></td>' +
        '<td' + (r.stale ? ' style="color:var(--caution)"' : ' ' + muted) + '>' +
          (r.last_counted_at ? esc(NJW.fmt.date(r.last_counted_at))
            : '<span ' + biAttr('Belum pernah', 'Never') + '>Belum pernah</span>') + '</td></tr>';
    }

    function render() {
      const list = visible();
      const pages = Math.max(1, Math.ceil(list.length / PAGE));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      const host = region('stock');
      const hasOwner = !field('owner-head').hidden;
      host.innerHTML = slice.length ? slice.map(r => rowHtml(r, hasOwner)).join('')
        : '<tr><td colspan="10" class="note" ' + (rows.length
          ? biAttr('Tidak ada yang cocok dengan pencarian atau filter ini.', 'Nothing matches this search or filter.')
          : biAttr('Belum ada stok di lokasi ini.', 'No stock at this site yet.')) + '></td></tr>';
      applyLangTo(host);

      setF('range', list.length ? (page * PAGE + 1) + '–' + (page * PAGE + slice.length) : '0');
      setF('total', NJW.fmt.n(list.length));
      const nav = region('pager');
      if (nav) {
        const btn = (label, p, on, aria) => '<button class="pager__page' + (on ? ' is-on' : '') +
          '" type="button" data-page="' + p + '"' + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
        let h = btn('‹', Math.max(0, page - 1), false, tx('Sebelumnya', 'Previous'));
        for (let i = 0; i < pages; i++) {
          if (pages > 7 && i > 0 && i < pages - 1 && Math.abs(i - page) > 1) {
            if (!h.endsWith('<span class="pager__gap">…</span>')) h += '<span class="pager__gap">…</span>';
            continue;
          }
          h += btn(i + 1, i, i === page);
        }
        nav.innerHTML = h + btn('›', Math.min(pages - 1, page + 1), false, tx('Berikutnya', 'Next'));
      }
    }

    /* ---- controls ---- */

    const search = field('search');
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { q = search.value.trim(); page = 0; render(); }, 120);
    });
    // A scanned barcode matches no name: ask the server what it is and where.
    search.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      q = search.value.trim();
      page = 0;
      render();
      if (!q || visible().length) return;
      try {
        const r = await NJW.api.findStock({ code: q, site_id: site.id });
        if (!r.found || !r.sku) return say(tx('Tidak ditemukan: ', 'Not found: ') + q);
        search.value = q = r.sku.name_display;
        render();
        say(r.sku.name_display + (r.slot_location_code ? ' · ' + r.slot_location_code : '') +
          (r.qty_on_hand != null ? ' · ' + r.qty_on_hand + tx(' di rak', ' on hand') : ''));
      } catch (err) { fail(err); }
    });

    $$('.seg__opt[data-filter]').forEach(b => b.addEventListener('click', () => {
      $$('.seg__opt[data-filter]').forEach(o => o.classList.toggle('is-on', o === b));
      filter = b.dataset.filter;
      page = 0;
      render();
    }));
    const sel = field('rack');
    if (sel) sel.addEventListener('change', () => { rack = sel.value; page = 0; render(); });

    region('pager').addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b) return;
      page = +b.dataset.page;
      render();
    });

    /* Sort the whole list, not the page on screen. Captured at the thead so
       console.js's per-page DOM sort on the same th never runs. */
    const thead = $('#tbl-stock thead');
    thead.addEventListener('click', (e) => {
      const th = e.target.closest('th.is-sortable');
      if (!th) return;
      e.stopPropagation();
      const k = th.dataset.key;
      asc = sortKey === k ? !asc : true;
      sortKey = k;
      $$('th', thead).forEach(o => o.classList.remove('is-sorted', 'is-asc'));
      th.classList.add('is-sorted');
      if (asc) th.classList.add('is-asc');
      render();
    }, true);

    /* ---- movements drawer: "where did this stock go" ---- */
    const drawer = $('#drawer-moves'), scrim = $('.scrim');
    region('stock').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-sku]');
      if (!tr) return;
      const r = rows.find(x => x.sku_id === +tr.dataset.sku);
      bi(field('moves-title'), 'Riwayat · ' + (r ? r.sku_name : ''), 'History · ' + (r ? r.sku_name : ''));
      const host = region('moves');
      host.innerHTML = '<tr><td colspan="5" class="note" ' + biAttr('Memuat…', 'Loading…') + '></td></tr>';
      applyLangTo(host);
      drawer.classList.add('is-open');
      if (scrim) scrim.classList.add('is-open');
      try {
        const m = await NJW.api.movements({ site_id: site.id, sku_id: +tr.dataset.sku, limit: 100 });
        host.innerHTML = m.movements.length ? m.movements.map(x => {
          const k = MOVE[x.movement_type] || [x.movement_type, x.movement_type];
          return '<tr><td style="color:var(--muted);white-space:nowrap">' + esc(NJW.fmt.date(x.created_at)) + ' ' +
            esc(NJW.fmt.time(x.created_at)) + '</td>' +
            '<td ' + biAttr(k[0], k[1]) + '>' + esc(k[0]) + '</td>' +
            '<td class="td-code">' + esc(x.location_code || x.plate_code || '—') + '</td>' +
            '<td class="td-num" style="font-weight:700">' + (x.qty_delta > 0 ? '+' : x.qty_delta < 0 ? '−' : '') +
              Math.abs(x.qty_delta) + '</td>' +
            '<td style="color:var(--muted)">' + esc(String(x.actor_email || '').split('@')[0] || '—') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="note" ' +
          biAttr('Belum ada pergerakan.', 'No movements yet.') + '></td></tr>';
        applyLangTo(host);
      } catch (err) { fail(err); }
    });

    /* ---- export what is on screen (all pages of the current filter) ---- */
    const exp = $('[data-action="export"]');
    if (exp) exp.addEventListener('click', () => {
      const cols = ['location_code', 'sku_name', 'brand_sku_code', 'qty_on_hand', 'qty_allocated',
                    'available', 'capacity', 'stock_owner', 'expiry_tier', 'last_counted_at'];
      const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const csv = [cols.join(',')].concat(visible().map(r => cols.map(c => cell(r[c])).join(','))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'stok-' + site.code + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });

    try { await load(); } catch (e) { fail(e); }
  };
})();
