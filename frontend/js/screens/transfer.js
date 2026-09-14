/* screens/transfer.js — hub ↔ darkstore transfers (console/transfer.html).
 *
 * GET /api/transfers?site_id= lists transfers touching the active site in
 * either direction (newest first, capped at 100 by the API — no offset, so the
 * pager works client-side). A transfer is created by the hub dispatch screen
 * (19-gudang-kirim) and received by the darkstore's normal inbound scan of the
 * tote label, which is what flips it to "received" and fills the variance.
 *
 * This belongs to the restock model, which the canonical design keeps outside
 * the WMS for now; the page wires what the backend supports and says so.
 * There is no "raise with the hub" endpoint, so that control is not drawn.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, fail } = W;
  const api = NJW.api;

  const PER = 25;
  const jktDay = v => {
    const d = NJW.toDate(v);
    return d ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '';
  };
  const when = iso => iso ? NJW.fmt.date(iso) + ' ' + NJW.fmt.time(iso) : '—';

  function openDrawer(sel) {
    const d = $(sel), sc = $('.scrim');
    if (d) d.classList.add('is-open');
    if (sc) sc.classList.add('is-open');
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

  /* Hours left in the 24-hour window that opens when a variance is received. */
  const hoursLeft = t => t.received_at
    ? (NJW.toDate(t.received_at).getTime() + 24 * 36e5 - Date.now()) / 36e5 : null;

  function status(t) {
    if (t.status === 'dispatched') return ['info', 'Dalam perjalanan', 'In transit'];
    if (t.status === 'draft') return ['neutral', 'Draf', 'Draft'];
    if (t.status === 'received') return t.variance
      ? ['warn', 'Diterima, selisih', 'Received, variance'] : ['ok', 'Diterima, cocok', 'Received, matched'];
    return ['neutral', t.status, t.status];
  }

  function clock(t) {
    if (t.status !== 'received' || !t.variance) return '<span class="na">—</span>';
    const h = hoursLeft(t);
    if (h <= 0) return '<span class="clockpill clockpill--closed" ' + biAttr('Lewat batas', 'Window closed') + '>Lewat batas</span>';
    const n = Math.ceil(h);
    return '<span class="clockpill clockpill--' + (h <= 6 ? 'running' : 'soon') + '" ' +
      biAttr('Sisa ' + n + ' jam', n + ' h left') + '>Sisa ' + n + ' jam</span>';
  }

  function row(t) {
    const st = status(t);
    const recv = t.status === 'received';
    const v = t.variance;
    return '<tr' + (recv && v ? ' class="is-variance"' : '') + '>' +
      '<td class="td-code td-strong">' + esc(t.reference) + '</td>' +
      '<td class="td-code" style="color:var(--muted)">' + esc(t.from_site_code) + '</td>' +
      '<td class="td-code td-strong">' + esc(t.to_site_code) + '</td>' +
      '<td data-sort-value="' + esc(t.dispatched_at || '') + '">' + esc(when(t.dispatched_at)) + '</td>' +
      '<td class="td-num">' + t.lines.length + '</td>' +
      '<td class="td-num">' + t.total_dispatched + '</td>' +
      '<td class="td-num">' + (recv ? t.total_received : '<span class="na">—</span>') + '</td>' +
      '<td class="td-num">' + (!recv ? '<span class="na">—</span>'
        : v ? (v > 0 ? '+' : '') + v : '<span style="color:var(--accept);font-weight:700">0</span>') + '</td>' +
      '<td><span class="spill spill--' + st[0] + '"><span class="spill__dot"></span><span ' +
      biAttr(st[1], st[2]) + '>' + esc(st[1]) + '</span></span></td>' +
      '<td>' + clock(t) + '</td>' +
      '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-open="' + t.id + '" ' +
      biAttr('Lihat isi', 'View contents') + '>Lihat isi</button></td></tr>';
  }

  NJW.screens.transfer = async () => {
    const site = W.site();
    if (!site) return;
    let list = [], filter = 'all', page = 1;

    try {
      list = (await api.transfers({ site_id: site.id, limit: 100 })).transfers;
    } catch (e) { return fail(e); }

    /* ---- KPIs ---- */
    const today = jktDay(new Date());
    const transit = list.filter(t => t.status === 'dispatched');
    setF('kpi-transit', transit.length);
    const latest = transit[0];
    bi(field('kpi-transit-foot'),
      latest ? latest.reference + ' · ' + latest.total_dispatched + ' unit' : 'tidak ada tote di jalan',
      latest ? latest.reference + ' · ' + latest.total_dispatched + ' units' : 'no tote on the road');
    const recvToday = list.filter(t => t.status === 'received' && jktDay(t.received_at) === today);
    setF('kpi-received', recvToday.length);
    const got = recvToday.reduce((n, t) => n + t.total_received, 0);
    const sent = recvToday.reduce((n, t) => n + t.total_dispatched, 0);
    bi(field('kpi-received-foot'), recvToday.length ? got + ' dari ' + sent + ' unit diterima' : 'belum ada hari ini',
                                   recvToday.length ? got + ' of ' + sent + ' units received' : 'none today');
    const varied = list.filter(t => t.status === 'received' && t.variance);
    const open = varied.filter(t => hoursLeft(t) > 0);
    setF('kpi-variance', open.length);
    const closed = varied.length - open.length;
    bi(field('kpi-variance-foot'), closed ? closed + ' lagi sudah lewat batas' : 'tidak ada yang lewat batas',
                                   closed ? closed + ' more past the window' : 'none past the window');
    const vc = field('kpi-variance').closest('.kpi-card');
    if (vc) vc.classList.toggle('kpi-card--caution', open.length > 0);
    const drafts = list.filter(t => t.status === 'draft').length;
    setF('kpi-draft', drafts);
    bi(field('kpi-draft-foot'), 'di transfer yang menyentuh ' + site.code, 'on transfers touching ' + site.code);

    /* ---- table ---- */
    function visible() {
      const q = (field('search').value || '').trim().toLowerCase();
      return list.filter(t =>
        (filter === 'all' || (filter === 'variance' ? t.status === 'received' && t.variance : t.status === filter)) &&
        (!q || (t.reference + ' ' + t.from_site_code + ' ' + t.to_site_code).toLowerCase().includes(q)));
    }
    function render() {
      const rows = visible();
      const pages = Math.max(1, Math.ceil(rows.length / PER));
      page = Math.min(Math.max(1, page), pages);
      const host = region('transfer');
      const slice = rows.slice((page - 1) * PER, page * PER);
      host.innerHTML = slice.length ? slice.map(row).join('')
        : '<tr><td colspan="11" class="note" ' + (list.length
          ? biAttr('Tidak ada transfer yang cocok.', 'No matching transfers.')
          : biAttr('Belum ada transfer yang menyentuh ' + site.code + '.', 'No transfer touches ' + site.code + ' yet.')) +
          '></td></tr>';
      applyLangTo(host);
      paintPager(rows.length, page, p => { page = p; render(); });
    }

    field('search').addEventListener('input', () => { page = 1; render(); });
    $$('[data-filter]', region('filter')).forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      $$('[data-filter]', region('filter')).forEach(o => o.classList.toggle('is-on', o === b));
      page = 1;
      render();
    }));

    document.addEventListener('click', e => {
      const o = e.target.closest('[data-open]');
      if (o) {
        const t = list.find(x => x.id === +o.dataset.open);
        if (!t) return;
        const st = status(t);
        setF('tr-ref', t.reference);
        setF('tr-route', t.from_site_code + ' → ' + t.to_site_code);
        bi(field('tr-status'), st[1], st[2]);
        setF('tr-sent-at', when(t.dispatched_at));
        setF('tr-recv-at', when(t.received_at));
        const host = region('tr-lines');
        host.innerHTML = t.lines.map(l =>
          '<tr><td class="td-strong">' + esc(l.sku_name) + '</td>' +
          '<td class="td-num">' + l.qty_dispatched + '</td>' +
          '<td class="td-num">' + (t.status === 'received' ? l.qty_received : '<span class="na">—</span>') + '</td>' +
          '<td class="td-num">' + (l.variance == null ? '<span class="na">—</span>'
            : (l.variance > 0 ? '+' : '') + l.variance) + '</td></tr>').join('');
        openDrawer('#drawer-transfer');
        return;
      }
      if (e.target.closest('[data-action="export"]')) {
        downloadCsv('transfer-' + site.code + '.csv', [['reference', 'from', 'to', 'status', 'dispatched_at',
          'received_at', 'sent', 'received', 'variance']].concat(visible().map(t => [t.reference,
          t.from_site_code, t.to_site_code, t.status, t.dispatched_at, t.received_at, t.total_dispatched,
          t.status === 'received' ? t.total_received : '', t.status === 'received' ? t.variance : ''])));
      }
    });

    render();
  };
})();
