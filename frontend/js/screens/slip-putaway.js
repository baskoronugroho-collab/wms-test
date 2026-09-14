/* slip-putaway.js — console: the putaway slip archive.
 *
 * GET /putaway-slips is newest-first and pages by limit/offset. The archive
 * is read in 200-row chunks (up to 1,000 slips) and paged here, because the
 * "with variance" and "24 h window" filters and console.js's search have to
 * see every slip, and the server filters none of them.
 *
 * Only a planned (transfer) receipt can have a variance; a slip with no
 * differing lines shows "—".
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, region, setF, esc, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  const PAGE = 10;
  const PRINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3.5h10V9"/>' +
    '<rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M7 16.5v4h10v-4"/></svg>';

  const MAX_ROWS = 1000;

  /* ---- a client-side pager over the rendered rows ---------------------- */
  function makePager(table, size, onPage) {
    const tbody = table.querySelector('tbody');
    const nav = $('.pager__nav');
    const search = $('[data-search-for="#' + table.id + '"]');
    let page = 1;
    const rows = () => Array.from(tbody.querySelectorAll('tr[data-row]'));
    function info(a, b, n) {
      setF('range', n ? a + '–' + b : '0');
      setF('total', NJW.fmt.n(n));
    }
    function btn(label, p, on, aria) {
      return '<button class="pager__page' + (on ? ' is-on' : '') + '" type="button" data-page="' + p + '"' +
        (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
    }
    function renderNav(pages) {
      if (!nav) return;
      if (pages <= 1) { nav.innerHTML = ''; return; }
      const want = new Set([1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
      let html = btn('‹', Math.max(1, page - 1), false, t('Sebelumnya', 'Previous')), last = 0;
      Array.from(want).sort((a, b) => a - b).forEach(p => {
        if (p - last > 1) html += '<span class="pager__gap">…</span>';
        html += btn(p, p, p === page);
        last = p;
      });
      nav.innerHTML = html + btn('›', Math.min(pages, page + 1), false, t('Berikutnya', 'Next'));
    }
    function apply() {
      const all = rows();
      // While a search is typed console.js owns visibility (tr.hidden) and
      // every match is shown; paging resumes when the box is cleared.
      if (search && search.value.trim()) {
        all.forEach(tr => { tr.style.display = ''; });
        const hits = all.filter(tr => !tr.hidden);
        info(1, hits.length, hits.length);
        renderNav(1);
        if (onPage) onPage(hits);
        return;
      }
      const pages = Math.max(1, Math.ceil(all.length / size));
      page = Math.min(page, pages);
      const from = (page - 1) * size;
      all.forEach((tr, i) => { tr.style.display = i >= from && i < from + size ? '' : 'none'; });
      info(from + 1, Math.min(from + size, all.length), all.length);
      renderNav(pages);
      if (onPage) onPage(all.slice(from, from + size));
    }
    if (nav) nav.addEventListener('click', e => {
      const b = e.target.closest('[data-page]');
      if (b) { page = +b.dataset.page; apply(); }
    });
    if (search) search.addEventListener('input', () => { page = 1; apply(); });
    table.querySelectorAll('th.is-sortable').forEach(th =>
      th.addEventListener('click', () => setTimeout(apply, 0)));
    return { apply, reset() { page = 1; apply(); } };
  }

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

  NJW.screens['slip-putaway'] = async () => {
    const site = W.site();
    const table = $('#tbl-slips');
    const host = region('slips');
    const note = (id, en) => '<tr><td colspan="9" class="note" ' + biAttr(id, en) + '></td></tr>';
    host.innerHTML = note('Memuat…', 'Loading…');
    applyLangTo(host);

    let dc = null, slips = [];
    try {
      const dcP = api.dayColors().catch(() => null);
      let n = 1;
      while (slips.length < n && slips.length < MAX_ROWS) {
        const res = await api.slips({ site_id: site.id, limit: 200, offset: slips.length });
        n = res.total;
        if (!res.slips.length) break;
        slips = slips.concat(res.slips);
      }
      dc = await dcP;
    } catch (e) {
      host.innerHTML = note(e.message, e.message);
      applyLangTo(host);
      setF('range', '0'); setF('total', '0');
      const nav = $('.pager__nav'); if (nav) nav.innerHTML = '';
      return fail(e);
    }
    const dayEn = {};
    if (dc) dc.week.forEach(d => { dayEn[d.day_id] = d.day_en; });

    const data = slips.map(s => ({ slip: s }));
    const msLeft = s => NJW.toDate(s.created_at).getTime() + 864e5 - Date.now();

    function varianceHtml(s) {
      if (!s.variance_lines) return '—';
      return '<span style="color:var(--caution);font-weight:700">' + s.variance_lines + '</span>';
    }
    function windowHtml(s) {
      const ms = msLeft(s);
      if (ms <= 0) return '<span class="spill spill--neutral"><span class="spill__dot"></span><span ' +
        biAttr('Ditutup', 'Closed') + '>Ditutup</span></span>';
      const h = Math.ceil(ms / 36e5);
      return '<span class="spill spill--' + (h <= 6 ? 'stop' : 'warn') + '"><span class="spill__dot"></span><span ' +
        biAttr('Sisa ' + h + ' jam', h + ' h left') + '>Sisa ' + h + ' jam</span></span>';
    }
    function rowHtml(d) {
      const s = d.slip;
      const href = 'slip-detail.html?id=' + s.id;
      return '<tr data-row data-slip="' + s.id + '">' +
        '<td class="td-code td-strong"><a href="' + href + '">' + esc(s.slip_no) + '</a>' +
        (s.external_reference ? '<br><span style="color:var(--muted);font-weight:400">' +
          esc(s.external_reference) + '</span>' : '') + '</td>' +
        '<td data-sort-value="' + esc(s.created_at) + '">' + esc(NJW.fmt.date(s.inbound_date)) +
        ' · <span class="td-code">' + esc(NJW.fmt.time(s.created_at)) + '</span></td>' +
        '<td><span style="display:inline-flex;align-items:center;gap:8px">' +
        '<span style="width:18px;height:18px;border-radius:4px;background:' + esc(s.day_color_hex) +
        ';flex:0 0 auto" aria-hidden="true"></span>' +
        '<span ' + biAttr(s.day_label, dayEn[s.day_label] || s.day_label) + '>' + esc(s.day_label) + '</span>' +
        ' <span class="td-code" style="color:var(--muted)">' + esc(s.week_parity || '') + '</span></span></td>' +
        '<td class="td-num" data-sort-value="' + s.total_lines + '">' + NJW.fmt.n(s.total_lines) + '</td>' +
        '<td class="td-num" data-sort-value="' + s.total_units + '">' + NJW.fmt.n(s.total_units) + '</td>' +
        '<td class="td-num" data-sort-value="' + (s.variance_lines || 0) + '">' + varianceHtml(s) + '</td>' +
        '<td style="color:var(--muted)">' + esc(s.received_by || '—') + '</td>' +
        '<td>' + windowHtml(s) + '</td>' +
        '<td class="td-actions"><a class="cbtn cbtn--sm" href="' + href + '">' + PRINT_ICON +
        '<span ' + biAttr('Cetak', 'Print') + '>Cetak</span></a></td></tr>';
    }

    let filter = 'all';
    const search = $('[data-search-for="#tbl-slips"]');
    function render() {
      const rows = data.filter(d =>
        filter === 'variance' ? d.slip.variance_lines > 0 :
        filter === 'window' ? msLeft(d.slip) > 0 : true);
      if (!rows.length) {
        host.innerHTML = filter === 'all'
          ? note('Belum ada slip putaway di station ini.', 'No putaway slips at this station yet.')
          : filter === 'variance'
            ? note('Tidak ada slip dengan selisih.', 'No slips with a variance.')
            : note('Tidak ada batas 24 jam yang sedang berjalan.', 'No 24-hour window is running.');
      } else {
        host.innerHTML = rows.map(rowHtml).join('');
      }
      applyLangTo(host);
      if (search && search.value.trim()) search.dispatchEvent(new Event('input'));
      else pager.reset();
    }

    const pager = makePager(table, PAGE);

    $$('.seg__opt').forEach((b, i) => {
      b.onclick = () => {
        $$('.seg__opt').forEach(x => x.classList.toggle('is-on', x === b));
        filter = ['all', 'variance', 'window'][i] || 'all';
        render();
      };
    });

    const exp = $$('.toolbar .cbtn').find(b => /Ekspor|Export/.test(b.textContent));
    if (exp) exp.onclick = () => {
      if (!data.length) return say(t('Tidak ada slip untuk diekspor.', 'No slips to export.'));
      const head = ['No. slip', 'Referensi', 'Tanggal masuk', 'Warna hari', 'Minggu', 'Baris', 'Unit',
                    'Baris berselisih', 'Diterima oleh', 'Diterbitkan'];
      download('slip-putaway-' + site.code + '.csv', [head].concat(data.map(d => [
        d.slip.slip_no, d.slip.external_reference || '', d.slip.inbound_date, d.slip.day_label,
        d.slip.week_parity || '', d.slip.total_lines, d.slip.total_units, d.slip.variance_lines || 0,
        d.slip.received_by || '', d.slip.created_at,
      ])));
    };

    render();
  };
})();
