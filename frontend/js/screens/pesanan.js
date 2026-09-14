/* pesanan.js — console: the orders list.
 *
 * Every order reaches the WMS from Hiryu, whatever channel the customer used,
 * so each row says which channel, how it leaves the store, and how long is
 * left against its promise (Grab: 15 minutes from reaching Hiryu; own
 * channels: 1 hour from placement).
 *
 * Rows come from GET /api/orders, paged on the server (limit/offset) and
 * filtered there by status and channel. The KPI cards above describe the
 * live shift, so they read the queue board, which is exactly that.
 *
 * Cancel exists ONLY on a training site. For real orders, cancelling is
 * Hiryu's message 2 and never a button in the WMS; in training the simulator
 * stands in for Hiryu.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = () => NJW.api;

  const PAGE = 25;
  const CHANNEL = { grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram' };
  const MODE = {
    grab_rider: ['Kurir Grab', 'Grab rider'],
    ninja_rider: ['Kurir Ninja', 'Ninja rider'],
    third_party: ['Kurir pihak ketiga', 'Third-party courier'],
    next_day: ['Kirim besok', 'Next day'],
  };
  const STATUS = {
    ready: ['spill--neutral', 'Menunggu', 'Pending'],
    claimed: ['spill--info', 'Sedang diambil', 'Picking'],
    blocked: ['spill--stop', 'Terkunci', 'Blocked'],
    completed: ['spill--ok', 'Selesai', 'Done'],
    completed_short: ['spill--warn', 'Selesai · kurang barang', 'Done · short'],
    cancelled: ['spill--neutral', 'Dibatalkan', 'Cancelled'],
  };
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const ACTIVE = ['ready', 'claimed', 'blocked'];

  // One status per row from the order and its pick task.
  function stateOf(o) {
    if (o.status === 'cancelled' || o.pick_status === 'cancelled') return 'cancelled';
    if (o.status === 'picked' || o.pick_status === 'completed') return 'completed';
    return o.pick_status || 'ready';
  }

  // The server's urgency rule: late past the promise, "running out" in the
  // final third of the window from arrival to promise.
  function urgencyOf(o) {
    const r = o.remaining_seconds;
    if (r == null) return 'normal';
    if (r <= 0) return 'late';
    const win = o.promised_at && o.created_at
      ? (NJW.toDate(o.promised_at) - NJW.toDate(o.created_at)) / 1000 : null;
    return win && r <= Math.max(60, Math.floor(win / 3)) ? 'ageing' : 'normal';
  }

  NJW.screens.pesanan = async () => {
    const site = W.site();
    if (site.site_type === 'hub' && NJW.applySiteType) return NJW.applySiteType('hub', site.code);

    const host = region('orders');
    const search = $('[data-search-for="#tbl-orders"]');
    const filter = { status: '', channel: '' };
    let page = 0, total = 0;

    /* ---- rows ---- */

    function promisedCell(o, state) {
      if (!o.promised_at) return '<td class="td-code" data-sort-value="999999999">—</td>';
      const due = NJW.fmt.time(o.promised_at);
      let tag = '';
      if (state === 'completed' && o.completed_at) {
        const late = NJW.toDate(o.completed_at) > NJW.toDate(o.promised_at);
        tag = late
          ? '<span class="spill spill--warn"><span class="spill__dot"></span><span ' + biAttr('terlambat', 'late') + '>terlambat</span></span>'
          : '<span class="spill spill--ok"><span class="spill__dot"></span><span ' + biAttr('tepat waktu', 'on time') + '>tepat waktu</span></span>';
      } else if (ACTIVE.includes(state) && o.remaining_seconds != null) {
        const r = o.remaining_seconds;
        const m = Math.ceil(Math.abs(r) / 60) || 1;
        const u = urgencyOf(o);
        tag = r <= 0
          ? '<span class="agechip agechip--late"><span class="agechip__dot"></span><span ' +
            biAttr('terlambat ' + m + ' mnt', m + ' min late') + '>terlambat ' + m + ' mnt</span></span>'
          : '<span class="agechip agechip--' + (u === 'ageing' ? 'ageing' : 'fresh') +
            '"><span class="agechip__dot"></span><span ' + biAttr(m + ' mnt lagi', m + ' min left') + '>' +
            m + ' mnt lagi</span></span>';
      }
      const sortVal = ACTIVE.includes(state) && o.remaining_seconds != null ? o.remaining_seconds : 999999999;
      return '<td data-sort-value="' + sortVal + '"><span class="td-code">' + due + '</span> ' + tag + '</td>';
    }

    function row(o) {
      const state = stateOf(o);
      const st = STATUS[state === 'completed' && o.short_lines ? 'completed_short' : state] || STATUS.ready;
      const m = MODE[o.delivery_mode] || [o.delivery_mode || '—', o.delivery_mode || '—'];
      const ch = CHANNEL[o.channel] || o.channel || '—';
      const picker = o.claimed_by ? o.claimed_by.split('@')[0] : '—';
      const cancellable = site.is_training && ACTIVE.includes(state);
      const received = NJW.toDate(o.created_at);
      const units = state === 'cancelled' || o.units_picked === 0
        ? String(o.units) : o.units_picked + ' / ' + o.units;
      return '<tr data-ref="' + esc(o.external_ref) + '">' +
        '<td class="td-code td-strong">' + esc(o.external_ref) +
          (o.is_test ? ' <span class="badge-test" ' + biAttr('UJI', 'TEST') + '>UJI</span>' : '') + '</td>' +
        '<td><span class="td-strong">' + esc(ch) + '</span><br><span style="color:var(--muted)" ' +
          biAttr(m[0], m[1]) + '>' + esc(m[0]) + '</span></td>' +
        '<td class="td-code" data-sort-value="' + (received ? received.getTime() : 0) + '">' +
          NJW.fmt.time(o.created_at) + '</td>' +
        promisedCell(o, state) +
        '<td class="td-num">' + o.line_count + '</td>' +
        '<td class="td-num" style="white-space:nowrap">' + units + '</td>' +
        '<td class="td-num">' + (o.short_lines ? '<span style="color:var(--caution);font-weight:700">' + o.short_lines + '</span>' : '—') + '</td>' +
        '<td style="color:var(--muted)">' + esc(picker) + '</td>' +
        '<td><span class="spill ' + st[0] + '"><span class="spill__dot"></span><span ' +
          biAttr(st[1], st[2]) + '>' + st[1] + '</span></span></td>' +
        '<td class="td-actions">' + (cancellable
          ? '<button class="cbtn cbtn--sm" type="button" data-cancel="' + esc(o.external_ref) + '" ' +
            biAttr('Batalkan', 'Cancel') + '>Batalkan</button>' : '') + '</td>' +
        '</tr>';
    }

    const query = (offset, limit) => ({ site_id: site.id, status: filter.status, channel: filter.channel, limit, offset });

    async function load() {
      const r = await api().raw.get('/orders' + api().raw.qs(query(page * PAGE, PAGE)));
      total = r.total;
      if (!r.orders.length && page > 0) { page = Math.max(0, Math.ceil(total / PAGE) - 1); return load(); }
      if (host) {
        host.innerHTML = r.orders.length ? r.orders.map(row).join('')
          : '<tr><td colspan="10" style="color:var(--muted)" ' +
            biAttr('Tidak ada pesanan untuk filter ini.', 'No orders match this filter.') +
            '>Tidak ada pesanan untuk filter ini.</td></tr>';
        applyLangTo(host);
      }
      // Search is console.js's, over the rows on screen; re-run it on new rows.
      if (search && search.value) search.dispatchEvent(new Event('input'));
      const from = total ? page * PAGE + 1 : 0;
      setF('range', total ? from + '–' + (page * PAGE + r.orders.length) : '0');
      setF('total', total);
      paintPager(Math.max(1, Math.ceil(total / PAGE)));
    }

    function paintPager(pages) {
      const nav = $('.pager__nav');
      if (!nav) return;
      let html = '<button class="pager__page" type="button" data-page="' + (page - 1) + '"' +
        (page === 0 ? ' disabled' : '') + ' aria-label="' + (en() ? 'Previous' : 'Sebelumnya') + '">‹</button>';
      let gap = false;
      for (let i = 0; i < pages; i++) {
        if (pages > 7 && i > 0 && i < pages - 1 && Math.abs(i - page) > 1) {
          if (!gap) { html += '<span class="pager__gap">…</span>'; gap = true; }
          continue;
        }
        gap = false;
        html += '<button class="pager__page' + (i === page ? ' is-on' : '') + '" type="button" data-page="' + i + '">' + (i + 1) + '</button>';
      }
      html += '<button class="pager__page" type="button" data-page="' + (page + 1) + '"' +
        (page >= pages - 1 ? ' disabled' : '') + ' aria-label="' + (en() ? 'Next' : 'Berikutnya') + '">›</button>';
      nav.innerHTML = html;
    }

    const reload = () => load().catch(fail);

    const nav = $('.pager__nav');
    if (nav) nav.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      page = +b.dataset.page;
      reload();
    });

    // Status filter: the order's own status, filtered on the server.
    const segs = $$('.toolbar .seg__opt[data-status]');
    segs.forEach(b => b.addEventListener('click', () => {
      filter.status = b.dataset.status;
      segs.forEach(o => o.classList.toggle('is-on', o === b));
      page = 0;
      reload();
    }));
    const chanSel = field('channel-filter');
    if (chanSel) chanSel.addEventListener('change', () => { filter.channel = chanSel.value; page = 0; reload(); });

    /* ---- KPIs: the live shift, from the queue board ---- */

    function paintKpis(board) {
      const lane = k => board.lanes.find(l => l.key === k) || { cards: [], count: 0 };
      const waiting = lane('waiting'), picking = lane('picking'), done = lane('done_today');
      const foot = f => field(f) && field(f).nextElementSibling;
      const mins = s => Math.max(0, Math.floor((s || 0) / 60));

      setF('kpi-pending', waiting.count);
      const late = waiting.cards.filter(c => c.urgency === 'late').length;
      if (!waiting.count) bi(foot('kpi-pending'), 'antrean kosong', 'queue empty');
      else bi(foot('kpi-pending'),
        (late ? late + ' terlambat · ' : '') + 'tertua ' + mins(board.oldest_waiting_seconds) + ' menit',
        (late ? late + ' late · ' : '') + 'oldest ' + mins(board.oldest_waiting_seconds) + ' min');

      setF('kpi-picking', picking.count);
      const names = Array.from(new Set(picking.cards.map(c =>
        c.claimed_by_name || (c.claimed_by || '').split('@')[0]).filter(Boolean)));
      const who = names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
      bi(foot('kpi-picking'), who || 'tidak ada', who || 'nobody');

      setF('kpi-done', done.count);
      const fin = done.cards.filter(c => c.completed_at && c.created_at);
      if (fin.length) {
        const avg = fin.reduce((n, c) => n + (NJW.toDate(c.completed_at) - NJW.toDate(c.created_at)) / 1000, 0) / fin.length;
        bi(foot('kpi-done'), 'rata-rata ' + Math.floor(avg / 60) + ' mnt ' + Math.round(avg % 60) + ' dtk',
                             'avg ' + Math.floor(avg / 60) + ' min ' + Math.round(avg % 60) + ' s');
      } else {
        bi(foot('kpi-done'), 'belum ada', 'none yet');
      }

      const all = [].concat(waiting.cards, picking.cards, done.cards);
      setF('kpi-short', all.reduce((n, c) => n + (c.short_lines || 0), 0));
      // Message 5 goes to Hiryu, and Hiryu decides refund, partial or substitute.
      bi(foot('kpi-short'), 'Hiryu yang memutuskan', 'Hiryu decides');
    }
    const loadKpis = () => api().pickBoard({ site_id: site.id }).then(paintKpis).catch(() => {});

    /* ---- export: every row the current filter matches, as CSV ---- */
    const exportBtn = $('.toolbar > .cbtn');
    if (exportBtn) exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        const out = [];
        for (let off = 0; off < Math.min(total, 2000); off += 200) {
          const r = await api().raw.get('/orders' + api().raw.qs(query(off, 200)));
          out.push(...r.orders);
          if (r.orders.length < 200) break;
        }
        const head = ['reference', 'channel', 'delivery_mode', 'created_at_utc', 'placed_at_utc',
          'promised_at_utc', 'completed_at_utc', 'status', 'pick_status', 'lines', 'units',
          'units_picked', 'short_lines', 'picker', 'is_test'];
        const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
        const csv = [head.join(',')].concat(out.map(o => [o.external_ref, o.channel, o.delivery_mode,
          o.created_at, o.placed_at, o.promised_at, o.completed_at, o.status, o.pick_status, o.line_count,
          o.units, o.units_picked, o.short_lines, o.claimed_by, o.is_test].map(cell).join(','))).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'pesanan-' + site.code + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      } catch (e) { fail(e); }
      finally { exportBtn.disabled = false; }
    });

    /* ---- cancel (training only): the simulator's message 2 ---- */
    const dlg = $('#dlg-cancel'), scrim = $('.scrim');
    const closeCancel = () => { if (dlg) dlg.classList.remove('is-open'); if (scrim) scrim.classList.remove('is-open'); };
    document.addEventListener('click', async e => {
      const c = e.target.closest('[data-cancel]');
      if (c && dlg) {
        setF('cancel-ref', c.dataset.cancel);
        const ok = $('[data-action="confirm-cancel"]', dlg);
        if (ok) ok.dataset.ref = c.dataset.cancel;
        dlg.classList.add('is-open');
        if (scrim) scrim.classList.add('is-open');
        return;
      }
      const ok = e.target.closest('[data-action="confirm-cancel"]');
      if (!ok || !ok.dataset.ref) return;
      if (!site.is_training) return closeCancel();   // never reachable on a live site; belt and braces
      ok.disabled = true;
      try {
        const r = await api().raw.post('/training/orders/' + encodeURIComponent(ok.dataset.ref) + '/cancel', {});
        closeCancel();
        say(r.message || (en() ? 'Cancelled.' : 'Dibatalkan.'));
        await Promise.all([load(), loadKpis()]);
      } catch (err) { fail(err); }
      finally { ok.disabled = false; }
    });

    try { await Promise.all([load(), loadKpis()]); } catch (e) { return fail(e); }
    // Time remaining goes stale, so refresh — but not while someone has sorted
    // the table: a re-render would silently undo their sort under them.
    setInterval(() => {
      if (document.hidden) return;
      loadKpis();
      if (!$('#tbl-orders th.is-sorted')) load().catch(() => {});
    }, 30000);
  };
})();
