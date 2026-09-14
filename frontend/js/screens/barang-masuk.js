/* barang-masuk.js — console: receipts, open and closed, for supervisors.
 *
 * Built on GET /receipts, which pages on the server (limit/offset) and filters
 * by status, so the segment control and the pager both ask the server. Search
 * and sort are console.js's and work on the page on screen.
 *
 * An open receipt can be continued from here; a closed one opens its slip
 * (asking /receipts/{id}/putaway-slip to issue it if nobody has yet).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, fail, go, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  const PAGE = 10;
  const SOURCE = {
    from_brand: ['Kiriman brand', 'Brand delivery'],
    from_hub_transfer: ['Transfer gudang', 'Hub transfer'],
  };
  const STATUS = {
    open: ['accent', 'Berjalan', 'Open'],
    completed: ['ok', 'Ditutup', 'Closed'],
    discrepancy_raised: ['warn', 'Selisih diajukan', 'Discrepancy raised'],
  };
  const PRINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3.5h10V9"/>' +
    '<rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M7 16.5v4h10v-4"/></svg>';

  const list = (p) => api.raw.get('/receipts' + api.raw.qs(p));
  const refOf = r => r.external_reference || ('#' + r.id);
  const WINDOW_MS = 864e5;   // the 24-hour discrepancy window (inbound.py)

  function download(name, rows) {
    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function rowHtml(r) {
    const src = SOURCE[r.source_type] || [r.source_type, r.source_type];
    const st = STATUS[r.status] || ['neutral', r.status, r.status];
    const dc = r.day_color || {};
    const who = String(r.opened_by || '—').split('@')[0];
    let action;
    if (r.status === 'open') {
      action = '<a class="cbtn cbtn--sm cbtn--primary" href="../02-barang-masuk-scan.html" data-continue="' +
        r.id + '" ' + biAttr('Lanjutkan', 'Continue') + '>Lanjutkan</a>';
    } else {
      const href = r.slip_id ? 'slip-detail.html?id=' + r.slip_id : 'slip-detail.html?receipt=' + r.id;
      action = '<a class="cbtn cbtn--sm" href="' + href + '">' + PRINT_ICON +
        '<span ' + biAttr('Slip', 'Slip') + '>Slip</span></a>';
    }
    return '<tr data-row data-receipt="' + r.id + '">' +
      '<td class="td-code td-strong">' + esc(refOf(r)) + '</td>' +
      '<td ' + biAttr(src[0], src[1]) + '>' + esc(src[0]) + '</td>' +
      '<td data-sort-value="' + esc(r.opened_at) + '">' +
      esc(NJW.fmt.date(r.opened_at) + ' ' + NJW.fmt.time(r.opened_at)) + '</td>' +
      '<td><span style="display:inline-flex;align-items:center;gap:8px">' +
      '<span style="width:18px;height:18px;border-radius:4px;background:' + esc(dc.hex || 'transparent') +
      ';flex:0 0 auto" aria-hidden="true"></span>' +
      '<span ' + biAttr(dc.day_id || '—', dc.day_en || dc.day_id || '—') + '>' + esc(dc.day_id || '—') + '</span>' +
      (dc.date ? ' · ' + esc(NJW.fmt.date(dc.date)) + ' · ' + esc(dc.week_parity || '') : '') + '</span></td>' +
      '<td class="td-num" data-sort-value="' + r.line_count + '">' + NJW.fmt.n(r.line_count) + '</td>' +
      '<td class="td-num" data-sort-value="' + r.units + '">' + NJW.fmt.n(r.units) + '</td>' +
      '<td style="color:var(--muted)" title="' + esc(r.opened_by || '') + '">' + esc(who) + '</td>' +
      '<td><span class="spill spill--' + st[0] + '"><span class="spill__dot"></span><span ' +
      biAttr(st[1], st[2]) + '>' + esc(st[1]) + '</span></span></td>' +
      '<td class="td-actions">' + action + '</td></tr>';
  }

  NJW.screens['barang-masuk'] = async () => {
    const site = W.site();
    const host = region('receipts');
    const nav = $('.pager__nav');
    const search = $('[data-search-for="#tbl-receipts"]');
    const note = (id, en) => '<tr><td colspan="9" class="note" ' + biAttr(id, en) + '></td></tr>';
    const kpiFoot = f => field(f) && field(f).nextElementSibling;

    let status = 'all', page = 1, total = 0;

    /* ---- the table: one server page at a time ---- */
    function renderNav() {
      const pages = Math.max(1, Math.ceil(total / PAGE));
      if (!nav) return;
      if (pages <= 1) { nav.innerHTML = ''; return; }
      const btn = (label, p, on, aria) => '<button class="pager__page' + (on ? ' is-on' : '') +
        '" type="button" data-page="' + p + '"' + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
      const want = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
      let html = btn('‹', Math.max(1, page - 1), false, t('Sebelumnya', 'Previous')), last = 0;
      Array.from(want).sort((a, b) => a - b).forEach(p => {
        if (p - last > 1) html += '<span class="pager__gap">…</span>';
        html += btn(p, p, p === page);
        last = p;
      });
      nav.innerHTML = html + btn('›', Math.min(pages, page + 1), false, t('Berikutnya', 'Next'));
    }

    let seq = 0;
    async function load() {
      const mine = ++seq;
      host.innerHTML = note('Memuat…', 'Loading…');
      applyLangTo(host);
      let res;
      try {
        res = await list({ site_id: site.id, status, limit: PAGE, offset: (page - 1) * PAGE });
      } catch (e) {
        if (mine !== seq) return;
        host.innerHTML = note(e.message, e.message);
        applyLangTo(host);
        total = 0; setF('range', '0'); setF('total', '0'); renderNav();
        return fail(e);
      }
      if (mine !== seq) return;   // a newer page or filter was asked for
      total = res.total;
      host.innerHTML = res.receipts.length ? res.receipts.map(rowHtml).join('')
        : status === 'open' ? note('Tidak ada penerimaan yang sedang berjalan.', 'No receipt is in progress.')
        : note('Belum ada penerimaan di station ini.', 'No receipts at this station yet.');
      applyLangTo(host);
      const from = (page - 1) * PAGE;
      setF('range', res.receipts.length ? (from + 1) + '–' + (from + res.receipts.length) : '0');
      setF('total', NJW.fmt.n(total));
      renderNav();
      // console.js filters rows on input; re-run it over the new page.
      if (search && search.value.trim()) search.dispatchEvent(new Event('input'));
    }

    if (nav) nav.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (b && +b.dataset.page !== page) { page = +b.dataset.page; load(); }
    });
    $$('.seg__opt').forEach((b, i) => {
      b.onclick = () => {
        $$('.seg__opt').forEach(x => x.classList.toggle('is-on', x === b));
        status = ['all', 'open', 'completed'][i] || 'all';
        page = 1;
        load();
      };
    });
    host.addEventListener('click', e => {
      const a = e.target.closest('[data-continue]');
      if (!a) return;
      e.preventDefault();
      CTX.set('receipt', +a.dataset.continue);
      go(a.getAttribute('href'));
    });

    /* ---- KPIs ---- */
    async function kpis() {
      const [open, recent, dc] = await Promise.all([
        list({ site_id: site.id, status: 'open', limit: 1 }),
        list({ site_id: site.id, status: 'all', limit: 200 }),
        api.dayColors().catch(() => null),
      ]);
      setF('kpi-open', NJW.fmt.n(open.total));
      if (open.receipts.length) {
        const r = open.receipts[0];
        bi(kpiFoot('kpi-open'), refOf(r) + ' · ' + NJW.fmt.n(r.units) + ' unit',
                                refOf(r) + ' · ' + NJW.fmt.n(r.units) + ' units');
      } else bi(kpiFoot('kpi-open'), 'tidak ada', 'none');

      // "Today" is the server's Jakarta date, carried on every receipt's colour.
      const todayDate = dc ? dc.today.date : null;
      const todays = recent.receipts.filter(r => r.day_color && r.day_color.date === todayDate);
      setF('kpi-today', NJW.fmt.n(todays.reduce((n, r) => n + r.units, 0)));
      const lines = todays.reduce((n, r) => n + r.line_count, 0);
      bi(kpiFoot('kpi-today'), lines + ' baris · ' + todays.length + ' kiriman',
         lines + ' lines · ' + todays.length + (todays.length === 1 ? ' delivery' : ' deliveries'));

      const running = recent.receipts.filter(r => r.status !== 'open' && r.completed_at)
        .map(r => ({ r, ms: NJW.toDate(r.completed_at).getTime() + WINDOW_MS - Date.now() }))
        .filter(x => x.ms > 0).sort((a, b) => a.ms - b.ms);
      setF('kpi-window', running.length);
      if (running.length) {
        const h = Math.ceil(running[0].ms / 36e5), ref = refOf(running[0].r);
        bi(kpiFoot('kpi-window'), ref + ' · sisa ' + h + ' jam', ref + ' · ' + h + ' h left');
      } else bi(kpiFoot('kpi-window'), 'tidak ada yang berjalan', 'none running');

      // Unknown barcodes are not recorded anywhere yet — no number to show.
      setF('kpi-unknown', '—');
      bi(kpiFoot('kpi-unknown'), 'belum dicatat sistem', 'not recorded by the system yet');
    }
    kpis().catch(() => {
      ['kpi-open', 'kpi-today', 'kpi-window', 'kpi-unknown'].forEach(f => {
        setF(f, '—');
        bi(kpiFoot(f), '—', '—');
      });
    });

    /* ---- export: every receipt under the current filter ---- */
    const exp = $$('.toolbar .cbtn').find(b => /Ekspor|Export/.test(b.textContent));
    if (exp) exp.onclick = async () => {
      try {
        let all = [], off = 0, n = 1;
        while (off < n && off < 5000) {
          const res = await list({ site_id: site.id, status, limit: 200, offset: off });
          all = all.concat(res.receipts);
          n = res.total;
          off += 200;
        }
        const head = ['Referensi', 'Sumber', 'Dibuka', 'Warna hari', 'Tanggal warna', 'Minggu',
                      'Baris', 'Unit', 'Petugas', 'Status', 'Ditutup'];
        download('barang-masuk-' + site.code + '-' + status + '.csv', [head].concat(all.map(r => [
          refOf(r), (SOURCE[r.source_type] || [r.source_type])[0], r.opened_at,
          r.day_color ? r.day_color.day_id : '', r.day_color ? r.day_color.date : '',
          r.day_color ? r.day_color.week_parity : '', r.line_count, r.units, r.opened_by || '',
          (STATUS[r.status] || [0, r.status])[1], r.completed_at || '',
        ])));
      } catch (e) { fail(e); }
    };

    await load();
  };
})();
