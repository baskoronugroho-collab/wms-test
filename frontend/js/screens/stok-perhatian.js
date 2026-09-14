/* stok-perhatian — console: stock needing attention.
 *
 * Two lists, both about running out:
 *   Low stock  — products whose AVAILABLE units, rack + overflow together,
 *                are at or under a threshold. Per product, because the picker
 *                is sent to whichever location holds the older stock; a rack
 *                at 2 with 40 in overflow is not low.
 *   Restock    — requests to the hub, raised automatically when rack +
 *                overflow falls to the SKU's restock point (backend/replenish.py).
 * There is no replenishment task any more, so nothing here moves stock
 * between rack and overflow.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, bi, biAttr, esc, applyLangTo, say, fail } = W;
  const tx = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 3.5 11 13"/>' +
    '<path d="M20.5 3.5 14.5 20.5l-3.5-7.5-7.5-3.5z"/></svg>';

  function age(iso) {
    const s = Math.max(0, (Date.now() - NJW.toDate(iso).getTime()) / 1000);
    if (s < 3600) { const m = Math.max(1, Math.floor(s / 60)); return [m + ' mnt', m + ' min', s]; }
    if (s < 86400) { const h = Math.floor(s / 3600); return [h + ' jam', h + ' h', s]; }
    const d = Math.floor(s / 86400);
    return [d + ' hari', d + ' d', s];
  }

  NJW.screens['stok-perhatian'] = async () => {
    const site = W.site(), me = W.me();
    // A hub holds bulk stock and asks nobody for more: say so plainly.
    if (site.site_type === 'hub' && NJW.applySiteType) return NJW.applySiteType('hub', site.code);

    const canSend = ['supervisor', 'admin'].includes(me.role);
    let threshold = 10;
    let reqs = [];

    /* ---- tabs (the design's demo script that switched them is gone) ---- */
    $$('.tab[data-tab]').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab[data-tab]').forEach(t => {
        t.classList.toggle('is-on', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      $$('.tabpanel[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    }));
    if (location.hash === '#reqs') { const t = $('.tab[data-tab="reqs"]'); if (t) t.click(); }

    async function load() {
      const [low, inv, reg, rq] = await Promise.all([
        NJW.api.lowStock({ site_id: site.id, threshold }),
        NJW.api.inventory({ site_id: site.id, limit: 1000 }),
        NJW.api.registry({ site_id: site.id, limit: 500 }).catch(() => null),
        NJW.api.restockRequests({ site_id: site.id }),
      ]);
      const regBy = new Map(((reg && reg.rows) || []).map(r => [r.sku_id, r]));
      const overflow = new Set(((reg && reg.rows) || []).map(r => r.overflow_location_code).filter(Boolean));
      reqs = rq.requests;
      const reqBy = new Map(reqs.map(r => [r.sku_id, r]));

      // Every product at the site, summed over its locations.
      const by = new Map();
      inv.rows.forEach(r => {
        const p = by.get(r.sku_id) || { sku_id: r.sku_id, sku_name: r.sku_name, on: 0, alloc: 0, avail: 0, locs: [] };
        p.on += r.qty_on_hand; p.alloc += r.qty_allocated; p.avail += r.available;
        p.locs.push({ code: r.location_code, avail: r.available, ov: overflow.has(r.location_code) });
        by.set(r.sku_id, p);
      });
      const candidates = new Set(low.rows.map(r => r.sku_id));
      const lowList = Array.from(by.values())
        .filter(p => candidates.has(p.sku_id) && p.avail <= threshold)
        .sort((a, b) => a.avail - b.avail || a.sku_name.localeCompare(b.sku_name));

      setF('kpi-out', Array.from(by.values()).filter(p => p.avail <= 0).length);
      setF('kpi-low', lowList.length);
      bi(field('kpi-low-foot'), 'produk, tersedia ≤ ' + threshold + ' unit', 'products, ≤ ' + threshold + ' available');
      const open = reqs.filter(r => r.status === 'open').length;
      setF('kpi-req', reqs.length);
      bi(field('kpi-req-foot'), open + ' belum dikirim', open + ' not yet sent');
      setF('kpi-sent', reqs.filter(r => r.status === 'sent').length);
      setF('tab-low', lowList.length);
      setF('tab-reqs', open);

      paintLow(lowList, regBy, reqBy);
      paintReqs(regBy);
    }

    function paintLow(list, regBy, reqBy) {
      const host = region('low');
      if (!list.length) {
        host.innerHTML = '<tr><td colspan="8" class="note" ' +
          biAttr('Tidak ada produk dengan stok tersedia ≤ ' + threshold + '.',
                 'No product has ' + threshold + ' or fewer available.') + '></td></tr>';
        applyLangTo(host);
        return;
      }
      host.innerHTML = list.map(p => {
        const reg = regBy.get(p.sku_id);
        const rq = reqBy.get(p.sku_id);
        const out = p.avail <= 0;
        const locs = p.locs.map(l => esc(l.code || '—') + ' <span style="color:var(--muted)">(' + l.avail +
          (l.ov ? ' · <span ' + biAttr('cadangan', 'overflow') + '>cadangan</span>' : '') + ')</span>').join('<br>');
        const hub = rq
          ? (rq.status === 'sent'
              ? '<span class="spill spill--info"><span class="spill__dot"></span><span ' +
                biAttr('Terkirim ke hub', 'Sent to hub') + '></span></span>'
              : '<a class="cbtn cbtn--sm" href="#reqs" data-goto="reqs"><span ' +
                biAttr('Belum dikirim — buka', 'Not sent — open') + '></span></a>')
          : reg && reg.restock_point == null
            ? '<a class="cbtn cbtn--sm" href="registry.html"><span ' +
              biAttr('Atur titik pesan', 'Set restock point') + '></span></a>'
            : '<span style="color:var(--muted)">—</span>';
        return '<tr><td><span class="td-strong">' + esc(p.sku_name) + '</span>' +
          (reg && reg.brand_sku_code ? '<br><span class="td-code" style="color:var(--muted);font-size:var(--fs-c-meta)">' +
            esc(reg.brand_sku_code) + '</span>' : '') + '</td>' +
          '<td class="td-code">' + locs + '</td>' +
          '<td class="td-num">' + p.on + '</td>' +
          '<td class="td-num" style="color:var(--muted)">' + (p.alloc || '—') + '</td>' +
          '<td class="td-num td-strong"' + (out ? ' style="color:var(--stop)"' : '') + '>' + p.avail + '</td>' +
          '<td class="td-num" style="color:var(--muted)">' + (reg && reg.restock_point != null ? reg.restock_point : '—') + '</td>' +
          '<td><span class="spill spill--' + (out ? 'stop' : 'warn') + '"><span class="spill__dot"></span><span ' +
            (out ? biAttr('Habis', 'Out of stock') : biAttr('Menipis', 'Low')) + '></span></span></td>' +
          '<td>' + hub + '</td></tr>';
      }).join('');
      applyLangTo(host);
    }

    function paintReqs(regBy) {
      const host = region('reqs');
      const note = field('send-note');
      if (note) note.hidden = canSend || !reqs.some(r => r.status === 'open');
      if (!reqs.length) {
        host.innerHTML = '<tr><td colspan="11" class="note" ' +
          biAttr('Tidak ada permintaan ke hub.', 'No requests to the hub.') + '></td></tr>';
        applyLangTo(host);
        return;
      }
      host.innerHTML = reqs.map(r => {
        const reg = regBy.get(r.sku_id) || {};
        const code = reg.brand_sku_code || '';
        const a = age(r.created_at);
        const isOpen = r.status === 'open';
        const qty = r.qty_requested || r.qty_suggested;
        return '<tr data-req="' + r.id + '" data-suggested="' + r.qty_suggested + '">' +
          '<td class="td-check"><input class="checkbox" type="checkbox" aria-label="Pilih ' + esc(code || r.sku_name) + '"' +
            (isOpen && canSend ? '' : ' disabled') + '></td>' +
          '<td class="td-thumb"><img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' +
            esc(code.toLowerCase()) + '" alt=""></td>' +
          '<td><span class="td-strong">' + esc(r.sku_name) + '</span>' +
            (code ? '<br><span class="td-code" style="color:var(--muted);font-size:var(--fs-c-meta)">' + esc(code) + '</span>' : '') + '</td>' +
          '<td class="td-num">' + (reg.qty_primary ?? '—') + '</td>' +
          '<td class="td-num">' + (reg.qty_overflow != null
            ? (reg.overflow_location_code ? reg.qty_overflow : '<span style="color:var(--muted)">—</span>') : '—') + '</td>' +
          '<td class="td-num" style="color:var(--muted)">' + (reg.restock_point ?? '—') + '</td>' +
          '<td class="td-num"><span class="suggested"><span class="suggested__dot"></span>' + r.qty_suggested + '</span></td>' +
          '<td>' + (isOpen
            ? '<span class="stepper"><button class="stepper__btn" type="button" data-step="down" aria-label="Kurangi">−</button>' +
              '<span class="stepper__val" contenteditable="' + canSend + '" inputmode="numeric">' + qty + '</span>' +
              '<button class="stepper__btn" type="button" data-step="up" aria-label="Tambah">+</button></span>'
            : '<span class="td-num">' + qty + '</span>') + '</td>' +
          '<td data-sort-value="' + Math.round(a[2]) + '" ' + biAttr(a[0], a[1]) + '></td>' +
          '<td><span class="spill spill--' + (isOpen ? 'accent' : 'info') + '"><span class="spill__dot"></span><span ' +
            (isOpen ? biAttr('Belum dikirim', 'Not sent') : biAttr('Terkirim ke hub', 'Sent to hub')) + '></span></span></td>' +
          '<td class="td-actions">' + (isOpen && canSend
            ? '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-send="' + r.id + '">' + SEND_ICON +
              '<span ' + biAttr('Kirim', 'Send') + '></span></button>' : '') + '</td></tr>';
      }).join('');
      applyLangTo(host);
      if (NJW.paintPhotos) NJW.paintPhotos(host);
      const bar = $('.bulkbar[data-bulk-table="#tbl-reqs"]');
      if (bar) { bar.classList.remove('is-on'); setF('bulk-count', 0); }
    }

    const qtyOf = tr => {
      const v = parseInt(($('.stepper__val', tr) || {}).textContent, 10);
      return Number.isFinite(v) && v > 0 ? v : +tr.dataset.suggested;
    };

    async function send(ids) {
      let ok = 0;
      for (const id of ids) {
        const tr = $('tr[data-req="' + id + '"]');
        try {
          // The API takes the confirmed quantity as a query parameter.
          await NJW.api.raw.post('/restock/' + id + '/send' + NJW.api.raw.qs({ qty: qtyOf(tr) }), {});
          ok++;
        } catch (e) { fail(e); break; }
      }
      if (ok) say(ok === 1 ? tx('Permintaan terkirim ke hub.', 'Request sent to the hub.')
                           : tx(ok + ' permintaan terkirim ke hub.', ok + ' requests sent to the hub.'));
      await load().catch(fail);
    }

    const reqBody = region('reqs');
    /* The stepper here needs its own handler: console.js's shared one clamps
       to 1–99, and a hub order is often more than 99. Stopping the click at
       the tbody keeps that handler (on document) from also firing. */
    reqBody.addEventListener('click', (e) => {
      const b = e.target.closest('.stepper__btn');
      if (b) {
        e.stopPropagation();
        const val = b.parentElement.querySelector('.stepper__val');
        const n = parseInt(val.textContent, 10) || 0;
        val.textContent = Math.max(1, Math.min(9999, n + (b.dataset.step === 'up' ? 1 : -1)));
        return;
      }
      const s = e.target.closest('[data-send]');
      if (s) { s.disabled = true; send([+s.dataset.send]); }
    });
    reqBody.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('stepper__val') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });

    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); const t = $('.tab[data-tab="' + g.dataset.goto + '"]'); if (t) t.click(); return; }
      const picked = () => $$('#tbl-reqs tbody tr[data-req]').filter(tr => {
        const c = $('.checkbox', tr); return c && c.checked && !c.disabled;
      });
      if (e.target.closest('[data-action="send-selected"]')) {
        const rows = picked();
        if (!rows.length) return say(tx('Pilih permintaan yang belum dikirim dulu.', 'Select requests not yet sent first.'));
        return send(rows.map(tr => +tr.dataset.req));
      }
      if (e.target.closest('[data-action="use-suggested"]')) {
        picked().forEach(tr => { const v = $('.stepper__val', tr); if (v) v.textContent = tr.dataset.suggested; });
      }
    });

    $$('.seg__opt[data-threshold]').forEach(b => b.addEventListener('click', () => {
      $$('.seg__opt[data-threshold]').forEach(o => o.classList.toggle('is-on', o === b));
      threshold = +b.dataset.threshold;
      load().catch(fail);
    }));

    try { await load(); } catch (e) { fail(e); }
  };
})();
