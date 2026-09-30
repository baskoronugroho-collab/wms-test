/* barang-masuk.js — console: receipts, open and closed, for supervisors.
 *
 * Built on GET /receipts, which pages on the server (limit/offset) and filters
 * by status, so the segment control and the pager both ask the server. Search
 * and sort are console.js's and work on the page on screen.
 *
 * An open receipt can be continued from here; a closed one opens its slip
 * (asking /receipts/{id}/putaway-slip to issue it if nobody has yet).
 *
 * After a brand delivery (PRD §5.1 steps 8 and 9): the SPV opens the receipt,
 * uploads every page of the signed Faktur (camera or files, photos or a PDF),
 * and raises any difference to Ops HQ. Ops HQ settles the open differences
 * from the list at the top. Nobody types an expiry date here (§5.3.9): Ops HQ
 * reads the dates off the uploaded Faktur on Restock ke brand.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail, go, CTX } = W;
  const api = NJW.api;
  const raw = api.raw;
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
  const KIND = {
    extra: ['Lebih', 'Extra'], short: ['Kurang', 'Short'],
    damaged: ['Rusak', 'Damaged'], other: ['Lainnya', 'Other'],
  };
  const PRINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3.5h10V9"/>' +
    '<rect x="3.5" y="9" width="17" height="7.5" rx="1.5"/><path d="M7 16.5v4h10v-4"/></svg>';

  const list = (p) => raw.get('/receipts' + raw.qs(p));
  // The Faktur and the differences (routers/faktur.py).
  const F = {
    summary: id => raw.get('/receipts/' + id + '/summary'),
    pages: id => raw.get('/receipts/' + id + '/faktur'),
    upload: (id, fd) => raw.form('/receipts/' + id + '/faktur', fd),
    issues: p => raw.get('/faktur-issues' + raw.qs(p)),
    raise: (id, b) => raw.post('/receipts/' + id + '/issues', b),
    settle: (id, outcome) => raw.post('/faktur-issues/' + id + '/settle', { outcome }),
  };
  const refOf = r => r.external_reference || ('#' + r.id);
  const WINDOW_MS = 864e5;   // the 24-hour discrepancy window (inbound.py)
  const MAX_MB = 10;
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '-';

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
    const who = String(r.opened_by || '-').split('@')[0];
    let action;
    if (r.status === 'open') {
      action = '<a class="cbtn cbtn--sm cbtn--primary" href="../02-barang-masuk-scan.html" data-continue="' +
        r.id + '" ' + biAttr('Lanjutkan', 'Continue') + '>Lanjutkan</a>';
    } else {
      const href = r.slip_id ? 'slip-detail.html?id=' + r.slip_id : 'slip-detail.html?receipt=' + r.id;
      action = '<a class="cbtn cbtn--sm" href="' + href + '">' + PRINT_ICON +
        '<span ' + biAttr('Slip', 'Slip') + '>Slip</span></a>';
      if (r.source_type === 'from_brand') {
        action += ' <button class="cbtn cbtn--sm' + (r.needs_faktur ? ' cbtn--primary' : '') + '" type="button" data-faktur="' +
          r.id + '" ' + (r.needs_faktur ? biAttr('Unggah Faktur', 'Upload Faktur') : biAttr('Faktur', 'Faktur')) + '></button>';
      }
    }
    const extra = (r.needs_faktur ? ' <span class="spill spill--warn"><span ' + biAttr('Menunggu Faktur', 'Waiting for Faktur') + '></span></span>' : '') +
      (r.open_issues ? ' <span class="spill spill--warn"><span ' + biAttr(r.open_issues + ' selisih ke Ops HQ', r.open_issues + ' difference(s) to Ops HQ') + '></span></span>' : '');
    return '<tr data-row data-receipt="' + r.id + '">' +
      '<td class="td-code td-strong">' + esc(refOf(r)) +
      (r.replenishment_reference ? '<br><span style="color:var(--muted);font-weight:400">' + esc(r.replenishment_reference) + '</span>' : '') + '</td>' +
      '<td ' + biAttr(src[0], src[1]) + '>' + esc(src[0]) + '</td>' +
      '<td data-sort-value="' + esc(r.opened_at) + '">' +
      esc(NJW.fmt.date(r.opened_at) + ' ' + NJW.fmt.time(r.opened_at)) + '</td>' +
      '<td><span style="display:inline-flex;align-items:center;gap:8px">' +
      '<span class="day-swatch" style="width:18px;height:18px;border-radius:4px;background:' + esc(dc.hex || 'transparent') +
      ';flex:0 0 auto" aria-hidden="true"></span>' +
      '<span ' + biAttr(dc.day_id || '-', dc.day_en || dc.day_id || '-') + '>' + esc(dc.day_id || '-') + '</span>' +
      (dc.date ? ' · ' + esc(NJW.fmt.date(dc.date)) + ' · ' + esc(dc.week_parity || '') : '') + '</span></td>' +
      '<td class="td-num" data-sort-value="' + r.line_count + '">' + NJW.fmt.n(r.line_count) + '</td>' +
      '<td class="td-num" data-sort-value="' + r.units + '">' + NJW.fmt.n(r.units) + '</td>' +
      '<td style="color:var(--muted)" title="' + esc(r.opened_by || '') + '">' + esc(who) + '</td>' +
      '<td><span class="spill spill--' + st[0] + '"><span class="spill__dot"></span><span ' +
      biAttr(st[1], st[2]) + '>' + esc(st[1]) + '</span></span>' + extra + '</td>' +
      '<td class="td-actions">' + action + '</td></tr>';
  }

  NJW.screens['barang-masuk'] = async () => {
    const site = W.site();
    const hq = W.atLeast('hq');
    const spv = W.atLeast('supervisor');
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
        : status === 'needs_faktur' ? note('Semua Faktur sudah diunggah.', 'Every Faktur is uploaded.')
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
        status = ['all', 'open', 'completed', 'needs_faktur'][i] || 'all';
        page = 1;
        load();
      };
    });
    host.addEventListener('click', e => {
      const f = e.target.closest('[data-faktur]');
      if (f) { e.preventDefault(); return openReceipt(+f.dataset.faktur); }
      const a = e.target.closest('[data-continue]');
      if (!a) return;
      e.preventDefault();
      CTX.set('receipt', +a.dataset.continue);
      go(a.getAttribute('href'));
    });

    /* ---- open Faktur differences: Ops HQ settles, the SPV follows ---- */
    function issueLine(x, withSettle) {
      const k = KIND[x.kind] || [x.kind, x.kind];
      return {
        cells: '<td class="td-code">' + esc(x.site_code || '') + '</td>' +
          '<td class="td-code">' + esc(x.replenishment_reference || ('#' + x.receipt_id)) +
          (x.brand_name ? '<br><span style="color:var(--muted)">' + esc(x.brand_name) + '</span>' : '') + '</td>' +
          '<td>' + (x.sku_name ? '<strong>' + esc(x.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' + esc(x.brand_sku_code || '') + '</span>' : '-') + '</td>' +
          '<td><span class="spill spill--' + (x.kind === 'extra' ? 'info' : 'warn') + '"><span ' + biAttr(k[0], k[1]) + '></span></span></td>' +
          '<td class="td-num td-code">' + (x.qty != null ? NJW.fmt.n(x.qty) : '-') + '</td>' +
          '<td>' + esc(x.note || '') + '</td>' +
          '<td class="td-code">' + when(x.raised_at) + '<br><span style="color:var(--muted)">' + esc(String(x.raised_by || '').split('@')[0]) +
          (x.age_hours != null ? ' · ' + x.age_hours + ' ' + t('jam', 'h') : '') + '</span></td>',
        action: withSettle && x.status === 'open'
          ? '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-settle="' + x.id + '" ' + biAttr('Selesaikan', 'Settle') + '></button>'
          : x.status === 'settled' ? '<span class="spill spill--ok"><span ' + biAttr('Selesai', 'Settled') + '></span></span>' : '',
      };
    }

    async function loadIssues() {
      const panel = region('issues-panel');
      let res;
      try { res = await F.issues({ status: 'open' }); } catch (e) { panel.hidden = true; return; }
      panel.hidden = !res.issues.length && !hq;
      region('issues').innerHTML = res.issues.length ? res.issues.map(x => {
        const l = issueLine(x, hq);
        return '<tr>' + l.cells + '<td class="td-actions">' + l.action + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="note" ' + biAttr('Tidak ada selisih yang menunggu.', 'No difference is waiting.') + '></td></tr>';
      applyLangTo(panel);
    }

    async function settle(id) {
      const outcome = prompt(t('Hasil dengan brand (misalnya: Faktur direvisi, unit lebih dikembalikan):',
        'Outcome with the brand (for example: Faktur revised, extra units sent back):'), '');
      if (outcome === null) return false;
      if (!outcome.trim()) { say(t('Tulis hasilnya dulu.', 'Write the outcome first.')); return false; }
      try { await F.settle(id, outcome.trim()); say(t('Selisih diselesaikan.', 'Difference settled.')); return true; }
      catch (e) { fail(e); return false; }
    }
    region('issues').addEventListener('click', async e => {
      const b = e.target.closest('[data-settle]');
      if (b && await settle(+b.dataset.settle)) { loadIssues(); load(); }
    });

    /* ---- one receipt: its lines, the Faktur, the differences ---- */
    let rc = null, lines = [], pending = [];

    function paintPending() {
      region('rc-pending').innerHTML = pending.map((f, i) =>
        '<span style="display:flex;gap:8px;align-items:center"><span class="td-code">' + (i + 1) + '. ' + esc(f.name) +
        ' (' + (f.size / 1048576).toFixed(1) + ' MB)</span><button class="cbtn cbtn--sm cbtn--ghost" type="button" data-unpend="' + i + '" ' +
        biAttr('Hapus', 'Remove') + '></button></span>').join('');
      applyLangTo(region('rc-pending'));
      const up = $('[data-action="upload-faktur"]');
      if (up) up.disabled = !pending.length;
    }

    async function paintReceipt() {
      // The Faktur and the differences are the SPV's and Ops HQ's (the API refuses staff).
      const [sum, pages, iss] = await Promise.all([
        F.summary(rc.id),
        spv ? F.pages(rc.id) : Promise.resolve({ pages: [] }),
        spv ? F.issues({ status: 'all', receipt_id: rc.id }) : Promise.resolve({ issues: [] }),
      ]);
      const r = sum.receipt;
      lines = sum.lines;
      bi(field('rc-title'), 'Penerimaan ' + refOf(r), 'Receipt ' + refOf(r));
      setF('rc-po', r.replenishment_reference || '-');
      setF('rc-opened', when(r.opened_at) + ' · ' + String(r.opened_by || '').split('@')[0]);
      setF('rc-closed', when(r.completed_at));
      const left = NJW.fmt.hoursLeft(sum.discrepancy_deadline);
      bi(field('rc-deadline'),
        sum.discrepancy_deadline ? when(sum.discrepancy_deadline) + (left != null ? ' · sisa ' + left + ' jam' : '') : '-',
        sum.discrepancy_deadline ? when(sum.discrepancy_deadline) + (left != null ? ' · ' + left + ' h left' : '') : '-');

      region('rc-lines').innerHTML = lines.map(l => {
        const v = l.variance;
        const kind = v > 0 ? 'extra' : v < 0 ? 'short' : null;
        return '<tr><td><strong>' + esc(l.sku_name) + '</strong></td>' +
          '<td class="td-num td-code">' + (l.qty_expected != null ? NJW.fmt.n(l.qty_expected) : '-') + '</td>' +
          '<td class="td-num td-code">' + NJW.fmt.n(l.qty_received) + '</td>' +
          '<td class="td-num td-code"' + (v ? ' style="color:var(--' + (v < 0 ? 'stop' : 'caution') + ');font-weight:700"' : '') + '>' +
          (v == null ? '-' : (v > 0 ? '+' + v + ' ' + t('lebih', 'extra') : v < 0 ? v + ' ' + t('kurang', 'short') : '0')) + '</td>' +
          '<td class="td-actions">' + (kind && spv && r.status !== 'open'
            ? '<button class="cbtn cbtn--sm" type="button" data-prefill="' + l.sku_id + '" data-kind="' + kind + '" data-qty="' + Math.abs(v) + '" ' +
              biAttr('Ajukan', 'Raise') + '></button>' : '') + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="note" ' + biAttr('Belum ada barang.', 'Nothing received yet.') + '></td></tr>';
      applyLangTo(region('rc-lines'));

      // The Faktur: brand deliveries only, once the receipt is finished.
      const brand = r.source_type === 'from_brand';
      region('rc-faktur').hidden = !brand;
      region('rc-issues').hidden = !brand;
      const done = r.status !== 'open';
      region('rc-pages').innerHTML = pages.pages.map(p =>
        '<a class="cbtn cbtn--sm" target="_blank" rel="noopener" href="' + esc(p.url) + '"><span ' +
        biAttr('Halaman ' + p.page_no, 'Page ' + p.page_no) + '></span>' + (p.content_type === 'application/pdf' ? ' (PDF)' : '') + '</a>').join('');
      bi(field('rc-faktur-state'),
        !done ? 'Selesaikan penerimaan dulu, lalu unggah Faktur.'
          : pages.faktur_uploaded_at ? 'Diunggah ' + when(pages.faktur_uploaded_at) + ' oleh ' + String(pages.faktur_uploaded_by || '').split('@')[0] + '. Halaman yang terlewat bisa ditambah.'
          : r.needs_faktur ? 'Menunggu Faktur. Batas 24 jam untuk SPV, lalu diteruskan ke Ops HQ di 48 jam.'
          : 'Faktur diunggah setelah batch terakhir AWB ini selesai.',
        !done ? 'Finish the receipt first, then upload the Faktur.'
          : pages.faktur_uploaded_at ? 'Uploaded ' + when(pages.faktur_uploaded_at) + ' by ' + String(pages.faktur_uploaded_by || '').split('@')[0] + '. A missed page can still be added.'
          : r.needs_faktur ? 'Waiting for the Faktur. 24 h for the SPV, then it goes to Ops HQ at 48 h.'
          : 'The Faktur is uploaded after the last batch of this AWB.');
      region('rc-upload').hidden = !(done && spv);
      pending = [];
      paintPending();

      // Differences already raised on this receipt, and the form for a new one.
      region('rc-issue-list').innerHTML = iss.issues.map(x => {
        const k = KIND[x.kind] || [x.kind, x.kind];
        return '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;padding:8px;border:1px solid var(--rule);border-radius:6px">' +
          '<span class="spill spill--' + (x.status === 'open' ? 'warn' : 'ok') + '"><span ' +
          biAttr(x.status === 'open' ? 'Menunggu Ops HQ' : 'Selesai', x.status === 'open' ? 'With Ops HQ' : 'Settled') + '></span></span>' +
          '<span><strong ' + biAttr(k[0], k[1]) + '></strong> ' + (x.qty != null ? x.qty + ' × ' : '') + esc(x.sku_name || '') +
          (x.note ? '<br><span style="color:var(--muted)">' + esc(x.note) + '</span>' : '') +
          (x.outcome ? '<br><span ' + biAttr('Hasil: ', 'Outcome: ') + '></span>' + esc(x.outcome) : '') + '</span>' +
          (hq && x.status === 'open' ? '<button class="cbtn cbtn--sm cbtn--primary" type="button" style="margin-left:auto" data-settle-in="' + x.id + '" ' +
            biAttr('Selesaikan', 'Settle') + '></button>' : '') + '</div>';
      }).join('');
      region('rc-issue-form').hidden = !(done && spv);
      field('is-sku').innerHTML = '<option value="" ' + biAttr('(tanpa produk)', '(no product)') + '></option>' +
        lines.map(l => '<option value="' + l.sku_id + '">' + esc(l.sku_name) + '</option>').join('');
      field('is-qty').value = '';
      field('is-note').value = '';
      applyLangTo(region('rc-issues'));
      applyLangTo(region('rc-faktur'));
    }

    async function openReceipt(id) {
      rc = { id };
      try { await paintReceipt(); } catch (e) { return fail(e); }
      $('#drawer-receipt').classList.add('is-open');
      const sc = $('.scrim');
      if (sc) sc.classList.add('is-open');
    }

    function addFiles(input) {
      Array.from(input.files || []).forEach(f => {
        if (f.size > MAX_MB * 1048576) return say(f.name + t(': lebih dari 10 MB.', ': over 10 MB.'));
        if (!/^image\//.test(f.type) && f.type !== 'application/pdf') return say(f.name + t(': harus foto atau PDF.', ': must be a photo or a PDF.'));
        pending.push(f);
      });
      input.value = '';
      paintPending();
    }
    field('rc-camera').addEventListener('change', e => addFiles(e.target));
    field('rc-files').addEventListener('change', e => addFiles(e.target));

    $('#drawer-receipt').addEventListener('click', async e => {
      const un = e.target.closest('[data-unpend]');
      if (un) { pending.splice(+un.dataset.unpend, 1); return paintPending(); }

      const pre = e.target.closest('[data-prefill]');
      if (pre) {
        field('is-kind').value = pre.dataset.kind;
        field('is-sku').value = pre.dataset.prefill;
        field('is-qty').value = pre.dataset.qty;
        field('is-note').focus();
        return;
      }

      const st = e.target.closest('[data-settle-in]');
      if (st) {
        if (await settle(+st.dataset.settleIn)) { paintReceipt().catch(fail); loadIssues(); load(); }
        return;
      }

      if (e.target.closest('[data-action="upload-faktur"]')) {
        if (!pending.length) return say(t('Pilih foto atau PDF Faktur dulu.', 'Choose the Faktur photos or PDF first.'));
        const fd = new FormData();
        pending.forEach(f => fd.append('files', f, f.name));
        const btn = e.target.closest('[data-action="upload-faktur"]');
        btn.disabled = true;
        try {
          await F.upload(rc.id, fd);
          say(t('Faktur terunggah. Ops HQ bisa mengisi ED dari Faktur.', 'Faktur uploaded. Ops HQ can now enter the expiry dates from it.'));
          await paintReceipt();
          load();
          kpis().catch(() => {});
        } catch (err) { fail(err); btn.disabled = false; }
        return;
      }

      if (e.target.closest('[data-action="raise-issue"]')) {
        const kind = field('is-kind').value;
        const sku = +field('is-sku').value || null;
        const qty = field('is-qty').value === '' ? null : +field('is-qty').value;
        const txt = field('is-note').value.trim();
        if (kind !== 'other' && (!sku || !qty)) return say(t('Pilih produk dan jumlah unitnya.', 'Choose the product and how many units.'));
        if ((kind === 'extra' || kind === 'other') && !txt) { field('is-note').focus(); return say(t('Tulis catatan untuk Ops HQ.', 'Add a note for Ops HQ.')); }
        try {
          await F.raise(rc.id, { kind, sku_id: sku, qty, note: txt || null });
          say(t('Selisih diajukan ke Ops HQ.', 'Difference raised to Ops HQ.'));
          await paintReceipt();
          loadIssues();
          load();
        } catch (err) { fail(err); }
      }
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

      // Unknown barcodes are not recorded anywhere yet: no number to show.
      setF('kpi-unknown', '-');
      bi(kpiFoot('kpi-unknown'), 'belum dicatat sistem', 'not recorded by the system yet');
    }
    kpis().catch(() => {
      ['kpi-open', 'kpi-today', 'kpi-window', 'kpi-unknown'].forEach(f => {
        setF(f, '-');
        bi(kpiFoot(f), '-', '-');
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
                      'Baris', 'Unit', 'Petugas', 'Status', 'Ditutup', 'Faktur diunggah'];
        download('barang-masuk-' + site.code + '-' + status + '.csv', [head].concat(all.map(r => [
          refOf(r), (SOURCE[r.source_type] || [r.source_type])[0], r.opened_at,
          r.day_color ? r.day_color.day_id : '', r.day_color ? r.day_color.date : '',
          r.day_color ? r.day_color.week_parity : '', r.line_count, r.units, r.opened_by || '',
          (STATUS[r.status] || [0, r.status])[1], r.completed_at || '', r.faktur_uploaded_at || '',
        ])));
      } catch (e) { fail(e); }
    };

    // Deep links from Perlu tindakan: ?status=needs_faktur, ?receipt=42 opens that receipt.
    const q = new URLSearchParams(location.search);
    const segs = ['all', 'open', 'completed', 'needs_faktur'];
    if (segs.indexOf(q.get('status')) > 0) {
      status = q.get('status');
      $$('.seg__opt').forEach((x, i) => x.classList.toggle('is-on', segs[i] === status));
    }
    if (spv) loadIssues();
    await load();
    if (+q.get('receipt')) openReceipt(+q.get('receipt'));
  };
})();
