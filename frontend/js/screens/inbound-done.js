/* inbound-done.js — 15: the receipt is closed and its putaway slip issued.
 *
 * The slip is minted on the first request after completion and never
 * re-rendered, so everything here is read from it: the batch colour (the day
 * the delivery was opened), the lines in walking order, and the 24-hour
 * discrepancy deadline.
 *
 * Variance only exists for PLANNED inbound (a hub transfer, which carries the
 * dispatched quantities). A brand delivery has no expected list in the WMS, so
 * the screen says so instead of printing a "0 lines differ" it cannot know.
 *
 * Replaces the wire.js 'inbound-done' handler.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, setF, esc, bi, biAttr, applyLangTo, fail, go, CTX } = W;
  const api = NJW.api;
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  // "Kamis 10 Sep, jam 09.12" / "Thursday 10 Sep, 09:12" — both built, so the
  // language toggle can switch between them.
  function deadlineText(iso) {
    const d = NJW.toDate(iso);
    const fmt = loc => d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'short' });
    const time = loc => d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    return { id: fmt('id-ID') + ', jam ' + time('id-ID'), en: fmt('en-GB') + ', ' + time('en-GB') };
  }

  NJW.screens['inbound-done'] = async () => {
    // ?receipt= keeps the page reloadable after the flow state is cleared
    // (printing the slip, then coming back).
    const qp = +new URLSearchParams(location.search).get('receipt');
    const receiptId = qp || CTX.get('receipt');
    if (!receiptId) return go('index.html');
    if (!qp) history.replaceState(null, '', '?receipt=' + receiptId);

    let slip, sum;
    try {
      [sum, slip] = await Promise.all([
        api.raw.get('/receipts/' + receiptId + '/summary'),
        api.receiptSlip(receiptId),
      ]);
    } catch (e) {
      // 409: the receipt is still open — finish it on the scan screen first.
      if (e.status === 409) return go('02-barang-masuk-scan.html');
      return fail(e);
    }

    const label = sum.receipt.external_reference || slip.slip_no;
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Barang masuk · ' + label, 'Inbound · ' + label); }
    const bannerCode = $('.banner .code');
    if (bannerCode) bannerCode.textContent = label;

    // Products from this delivery still with HQ, or answered and waiting to be
    // carried from the temporary bin to their rack.
    if (NJW.skuAnswers) NJW.skuAnswers.mount($('.banner') || $('.main').firstElementChild, { receiptId });

    // Against a Surat Jalan, any difference now waits for the SPV and Ops HQ;
    // say so, so nobody reports it to Wardah on their own.
    if (sum.receipt.replenishment_id && sum.receipt.final_batch === false) {
      const note = document.createElement('div');
      note.className = 'notice notice--action';
      note.innerHTML = '<span class="code code--sm" aria-hidden="true">' + (sum.receipt.batch_no || 1) + '</span><div class="col" style="gap:4px">' +
        '<span class="notice__title" ' + biAttr('Batch ' + (sum.receipt.batch_no || 1) + ' dari ' + (sum.receipt.replenishment_reference || '') + ' selesai',
          'Batch ' + (sum.receipt.batch_no || 1) + ' of ' + (sum.receipt.replenishment_reference || '') + ' done') + '></span>' +
        '<span class="notice__body" ' + biAttr('Kosongkan bin inbound ke rak, lalu mulai batch berikutnya dari AWB ' + (sum.receipt.external_reference || '') + '. Selisih dengan Surat Jalan dihitung setelah batch terakhir.',
          'Empty the inbound bins onto the racks, then start the next batch from AWB ' + (sum.receipt.external_reference || '') + '. The comparison with the Surat Jalan is made after the last batch.') +
        '></span></div>';
      const main = $('.main');
      if (main) main.insertBefore(note, main.firstChild);
      applyLangTo(note);
    } else if (sum.receipt.replenishment_id) {
      const off = sum.lines.filter(l => l.variance);
      const note = document.createElement('div');
      note.className = 'notice ' + (off.length ? 'notice--caution' : 'notice--action');
      note.innerHTML = '<span class="code code--sm" aria-hidden="true">SJ</span><div class="col" style="gap:4px">' +
        '<span class="notice__title" ' + (off.length
          ? biAttr(off.length + ' SKU berbeda dari Surat Jalan ' + (sum.receipt.replenishment_reference || ''),
                   off.length + ' SKUs differ from Surat Jalan ' + (sum.receipt.replenishment_reference || ''))
          : biAttr('Semua cocok dengan Surat Jalan ' + (sum.receipt.replenishment_reference || ''),
                   'Everything matches Surat Jalan ' + (sum.receipt.replenishment_reference || ''))) + '></span>' +
        '<span class="notice__body" ' + (off.length
          ? biAttr('Selisihnya sudah dikirim ke SPV hub untuk dicek, lalu ditandatangani Ops HQ. Angka yang ditandatangani dipakai untuk tagihan dengan Wardah.',
                   'The variance has gone to the hub SPV to check, then to Ops HQ to sign off. The signed numbers are what is billed with Wardah.')
          : biAttr('Tidak ada yang perlu dicek. Permintaan restock ini selesai.', 'Nothing to check. This replenishment is closed.')) +
        '></span></div>';
      const main = $('.main');
      if (main) main.insertBefore(note, main.firstChild);
      applyLangTo(note);
    }

    /* ---- batch colour: colour + day + date + week ---- */
    const dc = slip.day_color;
    const block = field('day-block');
    if (block) { block.style.background = dc.hex; block.style.color = dc.ink; }
    setF('day-parity', dc.week_parity);
    setF('day-wk', 'W' + dc.iso_week);
    bi(field('day-name'), dc.day_id, dc.day_en);
    setF('day-date', NJW.fmt.date(dc.date));

    /* ---- totals ---- */
    const lines = slip.lines;
    const planned = lines.some(l => l.qty_expected != null);
    const expected = lines.reduce((n, l) => n + (l.qty_expected || 0), 0);
    const off = lines.filter(l => l.variance != null && l.variance !== 0);
    setF('total-lines', NJW.fmt.n(slip.total_lines));
    setF('total-units', NJW.fmt.n(slip.total_units));
    const unitsFoot = field('total-units').nextElementSibling;
    if (planned) bi(unitsFoot, 'dari ' + NJW.fmt.n(expected) + ' dikirim', 'of ' + NJW.fmt.n(expected) + ' shipped');
    else bi(unitsFoot, 'tanpa daftar kiriman', 'no shipping list');
    const varEl = field('total-variance');
    const varFoot = varEl.nextElementSibling;
    if (planned) {
      setF('total-variance', off.length);
      varEl.style.color = off.length ? 'var(--caution)' : 'var(--accept)';
      bi(varFoot, off.length ? 'tercantum di slip' : 'semua cocok', off.length ? 'itemised on the slip' : 'all matched');
    } else {
      setF('total-variance', '—');
      varEl.style.color = '';
      bi(varFoot, 'cocokkan dengan surat jalan', 'check against the delivery note');
    }

    /* ---- the 24-hour notice ---- */
    const notice = $('.notice--caution');
    const dl = slip.discrepancy_deadline ? deadlineText(slip.discrepancy_deadline) : null;
    if (notice) {
      const title = $('.notice__title', notice), body = $('.notice__body', notice);
      if (planned && !off.length) {
        show(notice, false);
      } else if (planned) {
        bi(title, 'Ada ' + off.length + ' baris yang jumlahnya tidak cocok',
                  off.length + (off.length === 1 ? ' line did' : ' lines did') + ' not match');
        bi(body,
           'Selisih harus diangkat dalam 24 jam' + (dl ? ' — paling lambat ' + dl.id : '') +
           '. Lewat dari itu, kekurangannya jadi tanggungan station. Cetak slipnya sekarang dan serahkan ke supervisor.',
           'A discrepancy must be raised within 24 hours' + (dl ? ' — by ' + dl.en : '') +
           '. After that the shortfall is the station’s. Print the slip now and hand it to your supervisor.');
      } else {
        bi(title, 'Cocokkan dengan surat jalan brand', "Check against the brand's delivery note");
        bi(body,
           'Kiriman brand tidak punya daftar jumlah di sistem. Kalau jumlahnya tidak cocok dengan surat jalan, angkat ke brand dalam 24 jam' +
           (dl ? ' — paling lambat ' + dl.id : '') + '. Lewat dari itu, kekurangannya jadi tanggungan station.',
           'A brand delivery has no quantity list in the system. If the count does not match the delivery note, raise it with the brand within 24 hours' +
           (dl ? ' — by ' + dl.en : '') + '. After that the shortfall is the station’s.');
      }
    }

    /* ---- lines: the differences for a transfer, everything for a brand ---- */
    const host = W.region('lines');
    if (host) {
      const row = (loc, nameHtml, qty, color) =>
        '<tr><td class="td-code">' + esc(loc || '—') + '</td><td>' + nameHtml + '</td>' +
        '<td class="td-qty"' + (color ? ' style="color:' + color + '"' : '') + '>' + qty + '</td></tr>';
      let html;
      if (planned) {
        html = off.map(l => row(l.location_code, esc(l.sku_name),
          (l.variance > 0 ? '+' : '−') + Math.abs(l.variance), 'var(--caution)')).join('');
        const matched = lines.length - off.length;
        if (matched) {
          html += '<tr><td class="td-code" style="color:var(--accept)" ' +
            biAttr(matched + ' baris', matched + (matched === 1 ? ' line' : ' lines')) + '></td>' +
            '<td ' + biAttr('cocok semua', 'all matched') + '></td>' +
            '<td class="td-qty" style="color:var(--accept)">✓</td></tr>';
        }
      } else {
        html = lines.map(l => row(l.location_code, esc(l.sku_name), NJW.fmt.n(l.qty_received))).join('');
      }
      host.innerHTML = html || '<tr><td colspan="3" class="note" ' +
        biAttr('Tidak ada barang di penerimaan ini.', 'Nothing was received on this receipt.') + '></td></tr>';
      applyLangTo(host);
    }

    setF('slip-no', slip.slip_no);

    /* ---- next steps ---- */
    const finish = (href) => (e) => { e.preventDefault(); CTX.del('receipt'); CTX.del('receiptLabel'); go(href); };
    $$('.col a.btn').forEach(a => {
      const h = a.getAttribute('href') || '';
      if (h.indexOf('slip-detail') >= 0) {
        a.href = 'console/slip-detail.html?id=' + slip.id;
        a.onclick = finish(a.href);
      } else if (h.indexOf('01-') === 0) {
        a.onclick = finish('01-mulai-barang-masuk.html');
      } else if (h.indexOf('index') === 0) {
        a.onclick = finish('index.html');
      }
    });
  };
})();
