/* slip-detail.js — console: one putaway slip, as the A4 it prints to.
 *
 * The slip is issued once and read back from its stored payload, so this page
 * only paints it. It is a paper record: the signature boxes stay empty for
 * pen, and nothing here signs, approves or changes anything.
 *
 * ?id=<slip id>, or ?receipt=<receipt id> (which also issues the slip if the
 * receipt was closed but its slip never requested).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, setF, esc, bi, biAttr, applyLangTo, fail } = W;
  const api = NJW.api;
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  const SOURCE = {
    from_brand: ['Kiriman dari brand', 'Delivery from the brand'],
    from_hub_transfer: ['Transfer gudang', 'Hub transfer'],
  };

  NJW.screens['slip-detail'] = async () => {
    const qs = new URLSearchParams(location.search);
    const id = qs.get('id'), rid = qs.get('receipt');
    const sheet = W.region('slip');
    if (!id && !rid) {
      show(sheet, false);
      const box = document.createElement('div');
      box.className = 'empty';
      box.innerHTML = '<span class="empty__title" ' + biAttr('Pilih slip dari arsip', 'Pick a slip from the archive') +
        '></span><span class="empty__body" ' + biAttr('Halaman ini menampilkan satu slip putaway. Buka dari Arsip slip atau dari Barang masuk.',
        'This page shows one putaway slip. Open it from the Slip archive or from Inbound.') + '></span>' +
        '<a class="cbtn cbtn--primary" href="slip-putaway.html" ' + biAttr('Buka arsip slip', 'Open the slip archive') + '></a>';
      sheet.parentNode.insertBefore(box, sheet);
      applyLangTo(box);
      bi($('.page__title'), 'Slip putaway', 'Putaway slip');
      document.title = 'Slip putaway — Ninja Kilat WMS';
      return;
    }

    let s;
    try {
      s = id ? await api.slip(id) : await api.receiptSlip(rid);
    } catch (e) {
      show(sheet, false);
      bi($('.page__title'), 'Slip tidak bisa dibuka', 'Slip could not be opened');
      bi($('.page__sub'), e.message, e.message);
      return fail(e);
    }
    // The receipt adds what the slip payload does not carry: the brand's
    // AWB/reference, which is how a supervisor will look this delivery up.
    // Slips issued before the payload carried external_reference fall back to it.
    const sum = await api.raw.get('/receipts/' + s.receipt_id + '/summary').catch(() => null);
    const ref = s.external_reference || (sum && sum.receipt.external_reference);
    const brandId = sum && sum.receipt.brand_id;
    const brand = brandId
      ? ((await api.brands().catch(() => [])).find(b => b.id === brandId) || {}).name : null;

    document.title = s.slip_no + ' — Ninja Kilat WMS';
    bi($('.page__title'), s.slip_no, s.slip_no);

    /* ---- head ---- */
    setF('slip-no', s.slip_no);
    const siteName = ((W.me().sites || []).find(x => x.id === s.site_id) || {}).name;
    const siteLine = field('site') && field('site').parentNode;
    if (siteLine) siteLine.innerHTML = 'Station <strong data-field="site">' + esc(s.site_code) + '</strong>' +
      (siteName ? ' — ' + esc(siteName) : '');
    const rcLine = field('receipt') && field('receipt').parentNode;
    const src = SOURCE[s.source_type] || [s.source_type, s.source_type];
    if (rcLine) {
      rcLine.innerHTML = 'Penerimaan <strong data-field="receipt">#' + esc(s.receipt_id) + '</strong> · <span ' +
        biAttr(src[0], src[1]) + '></span>' +
        (brand ? ' · ' + esc(brand) : '') +
        (ref ? ' · AWB/ref <strong>' + esc(ref) + '</strong>' : '');
      applyLangTo(rcLine);
    }
    setF('by', s.received_by || '—');
    const now = new Date().toISOString();
    setF('printed', NJW.fmt.date(now) + ' ' + NJW.fmt.time(now));

    /* ---- batch colour: block + day + week letter + date + ISO week ---- */
    const dc = s.day_color;
    const block = field('color-block');
    if (block) { block.style.background = dc.hex; block.style.color = dc.ink; }
    setF('color-day', dc.day_id.toUpperCase());
    setF('color-week', dc.week_parity);
    setF('color-date', dc.date);
    setF('color-iso', 'W' + dc.iso_week);

    /* ---- totals ---- */
    const planned = s.lines.some(l => l.qty_expected != null);
    const off = s.lines.filter(l => l.variance != null && l.variance !== 0).length;
    setF('total-lines', NJW.fmt.n(s.total_lines));
    setF('total-units', NJW.fmt.n(s.total_units));
    setF('total-variance', planned ? off : '—');
    const [y, m, d] = String(s.inbound_date).split('-');
    setF('inbound-date', d && m && y ? d + '/' + m + '/' + y.slice(2) : s.inbound_date);

    /* ---- lines, in walking order as stored ---- */
    const host = W.region('slip-lines');
    if (host) {
      host.innerHTML = s.lines.length ? s.lines.map((l, i) => {
        const v = l.variance;
        // A SKU split across its rack and its overflow prints both places, one
        // per line with its quantity, so the person filing it can walk to each.
        const locs = (l.locations || []).length > 1
          ? l.locations.map(x => esc(x.location_code) + ' (' + NJW.fmt.n(x.qty) + ')').join('<br>')
          : esc(l.location_code || '—');
        return '<tr' + (v ? ' class="has-variance"' : '') + '>' +
          '<td class="qty" style="text-align:left">' + (i + 1) + '</td>' +
          '<td>' + esc(l.sku_name) + '</td>' +
          '<td class="loc" style="font-size:10pt">' + esc(l.brand_sku_code || '—') + '</td>' +
          '<td class="loc">' + locs + '</td>' +
          '<td class="qty">' + (l.qty_expected == null ? '—' : NJW.fmt.n(l.qty_expected)) + '</td>' +
          '<td class="qty">' + NJW.fmt.n(l.qty_received) + '</td>' +
          '<td class="var">' + (v ? (v > 0 ? '+' : '-') + Math.abs(v) : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="7">Tidak ada barang di slip ini.</td></tr>';
    }

    /* ---- the 24-hour deadline, restated where a supervisor will look ---- */
    if (s.discrepancy_deadline) {
      const dt = NJW.toDate(s.discrepancy_deadline);
      setF('deadline', dt.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
        ', jam ' + NJW.fmt.time(s.discrepancy_deadline));
    }
    const foot = $('.slip__foot span:last-child');
    if (foot) foot.textContent = s.slip_no;
  };
})();
