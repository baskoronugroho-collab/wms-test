/* inbound-start.js — 01: open a receipt.
 *
 * Option 1 — a delivery from the brand. The AWB on Wardah's Surat Jalan is the
 * key: HQ recorded it when Wardah confirmed the replenishment, so opening a
 * receipt with it loads the confirmed quantities as the expectation and every
 * shortfall shows at once. The deliveries HQ has confirmed for this station are
 * listed, so a torn Surat Jalan never stops the receipt. A delivery that is on
 * no confirmed list can still be received "without AWB" — it is then discovered
 * inbound, counted by scan only, and HQ sees it had no Surat Jalan.
 *
 * Option 2 — a sealed tote transferred from the central warehouse or another
 * hub. Its label carries the dispatched quantities. The Wardah pilot delivers
 * straight to the hubs, so the option is parked in a <template> in the HTML;
 * everything below simply skips it while there is no scan zone on the page.
 *
 * HQ's answers to unknown-product requests from this station are shown on top.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, bi, biAttr, applyLangTo, say, fail, go, esc, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  // Every entry to the scan screen starts from a clean flow: leftovers from an
  // earlier delivery (a pending unknown barcode, a queued re-scan) must never
  // replay into the new receipt.
  function startReceipt(r) {
    ['pendingSku', 'pendingCode', 'rescan', 'basketReturn', 'receiptLabel']
      .forEach(k => CTX.del(k));
    CTX.set('receipt', r.id);
    go('02-barang-masuk-scan.html');
  }

  NJW.screens['inbound-start'] = async () => {
    const site = W.site();
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Barang masuk', 'Inbound'); }
    const today = await W.paintDayColour();
    if (today) bi(field('day-name'), today.day_id, today.day_en);

    // HQ's answers, and what is still waiting in the temporary bin.
    if (NJW.skuAnswers) NJW.skuAnswers.mount($('.main .h1'), { receiptId: null });

    // A receipt still open in this tab is almost always an interrupted one —
    // offer the way back instead of silently orphaning it.
    const openId = CTX.get('receipt');
    if (openId) {
      api.raw.get('/receipts/' + openId + '/summary').then(s => {
        if (s.receipt.status !== 'open') { CTX.del('receipt'); return; }
        const label = s.receipt.external_reference || ('#' + s.receipt.id);
        const n = document.createElement('div');
        n.className = 'notice notice--action';
        n.innerHTML =
          '<span class="code code--sm" aria-hidden="true">→</span>' +
          '<div class="col" style="gap:4px">' +
          '<span class="notice__title" ' +
          biAttr('Penerimaan ' + label + ' masih terbuka', 'Receipt ' + label + ' is still open') + '></span>' +
          '<span class="notice__body" ' +
          biAttr(s.total_units + ' barang sudah dipindai. Lanjutkan sebelum membuka kiriman baru.',
                 s.total_units + ' items scanned so far. Finish it before opening a new delivery.') +
          '></span></div>' +
          '<a class="btn btn--primary" href="02-barang-masuk-scan.html" ' +
          biAttr('Lanjutkan', 'Continue') + '></a>';
        const main = $('.main');
        main.insertBefore(n, main.querySelector('.h1'));
        applyLangTo(n);
      }).catch(() => CTX.del('receipt'));
    }

    /* ---- option 1: brand delivery, by AWB ---- */
    const refInput = $('#refInput');
    const primary = $('.choice--primary .btn--primary');
    let busy = false;

    async function openWithAwb(awb) {
      if (busy) return;
      awb = (awb || '').trim();
      if (!awb) {
        if (refInput) refInput.focus();
        return say(t('Mulai dari AWB atau referensi restock: pindai, ketik, atau pilih kiriman di daftar.',
                     'Start from the AWB or replenishment reference: scan it, type it, or pick a delivery from the list.'));
      }
      busy = true;
      try {
        const r = await api.raw.post('/receipts', { site_id: site.id, source_type: 'from_brand', awb });
        startReceipt(r);
      } catch (err) {
        if (err.status === 401) return fail(err);
        say(err.message);
        if (refInput) refInput.select();
      } finally { busy = false; }
    }

    async function openWithoutAwb() {
      if (busy) return;
      if (!confirm(t('Latihan tanpa AWB: barang hanya dihitung dari hasil pindai, tanpa pembanding.',
                     'Training without an AWB: only the scan count is recorded, with nothing to compare.'))) return;
      busy = true;
      try {
        const r = await api.raw.post('/receipts', { site_id: site.id, source_type: 'from_brand' });
        const note = (refInput ? refInput.value.trim() : '');
        if (note) {
          try { await api.raw.patch('/receipts/' + r.id, { external_reference: note.slice(0, 64) }); } catch (e) { /* optional */ }
        }
        startReceipt(r);
      } catch (err) { fail(err); } finally { busy = false; }
    }

    if (primary) {
      primary.removeAttribute('href');
      primary.setAttribute('role', 'button');
      primary.onclick = (e) => { e.preventDefault(); openWithAwb(refInput && refInput.value); };
    }
    // Every real delivery starts from its AWB, so it is compared with what Wardah
    // confirmed. Only the training site keeps a way in without one.
    const noAwb = $('[data-action="no-awb"]');
    if (noAwb) { noAwb.hidden = !site.is_training; noAwb.onclick = openWithoutAwb; }
    // A gun scanning the AWB types it and presses Enter: that is the person
    // saying "this delivery", so Enter opens it.
    if (refInput) refInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); openWithAwb(refInput.value); }
    });

    // What HQ has confirmed is on its way to this station.
    const expected = region('expected-deliveries');
    try {
      const r = await api.replenishments({ site_id: site.id, status: 'arriving' });
      if (expected && r.replenishments.length) {
        expected.innerHTML = '<span class="eyebrow" ' + biAttr('Kiriman yang dikonfirmasi HQ', 'Deliveries HQ confirmed') + '></span>' +
          r.replenishments.slice(0, 6).map(x =>
            '<button class="option" type="button" data-awb="' + esc(x.awb) + '">' +
            '<span>' + esc(x.awb) + ' · ' + esc(x.reference) + '</span>' +
            '<span class="option__hint">' + esc(x.brand_name) + ' · ' + (x.status === 'receiving'
              ? '<span ' + biAttr('lanjut batch ' + (x.batches + 1) + ' · ' + NJW.fmt.n(x.total_received) + '/' + NJW.fmt.n(x.total_confirmed) + ' unit sudah diterima',
                                  'continue batch ' + (x.batches + 1) + ' · ' + NJW.fmt.n(x.total_received) + '/' + NJW.fmt.n(x.total_confirmed) + ' units received') + '></span>'
              : NJW.fmt.n(x.total_confirmed) + ' unit') +
            (x.surat_jalan_no ? ' · SJ ' + esc(x.surat_jalan_no) : '') +
            (x.eta_date ? ' · ' + NJW.fmt.date(x.eta_date) : '') + '</span></button>').join('');
        applyLangTo(expected);
        expected.querySelectorAll('[data-awb]').forEach(b => { b.onclick = () => openWithAwb(b.dataset.awb); });
      }
    } catch (e) { /* typing the AWB still works */ }

    // With option 2 parked, the AWB field is the only input: a gun scan lands there.
    if (refInput && !$('.scanzone')) refInput.focus();

    /* ---- option 2: hub transfer (planned) — parked in the HTML for the pilot ---- */
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;

    async function openTransfer(code) {
      try {
        const r = await api.raw.post('/receipts', {
          site_id: site.id, source_type: 'from_hub_transfer', transfer_reference: code,
        });
        if (zone) zone.accept(t('Diterima', 'Accepted'), code);
        setTimeout(() => startReceipt(r), 600);
      } catch (err) {
        if (err.status === 401) return fail(err);
        const title = err.status === 404 ? t('Transfer tidak ditemukan', 'Transfer not found')
          : err.status === 409 ? t('Bukan untuk station ini', 'Not for this station')
          : t('Gagal', 'Failed');
        if (zone) zone.reject(title, err.message);
        else say(title + ' — ' + err.message);
      }
    }
    if (zone) zone.onScan(openTransfer);

    // Transfers already on their way here are the planned inbound: list them so
    // a torn or missing label does not stop the receipt. Say so when there are
    // none, so an empty option does not look broken.
    let due = [];
    if (zoneEl) try {
      const tr = await api.transfers({ site_id: site.id, limit: 30 });
      due = tr.transfers.filter(x => x.status === 'dispatched' && x.to_site_code === site.code);
    } catch (e) { /* the label scan still works */ }
    if (zoneEl) {
      const box = document.createElement('div');
      box.className = 'col';
      box.style.gap = '8px';
      box.innerHTML = due.length
        ? '<span class="eyebrow" ' + biAttr('Transfer yang ditunggu', 'Transfers on the way') + '></span>' +
          due.slice(0, 4).map(x =>
            '<button class="option" type="button" data-ref="' + esc(x.reference) + '">' +
            '<span>' + esc(x.reference) + '</span>' +
            '<span class="option__hint"><span ' + biAttr('dari ', 'from ') + '></span>' +
            esc(x.from_site_code) + ' · ' + NJW.fmt.n(x.total_dispatched) + ' <span ' +
            biAttr('unit', 'units') + '></span></span></button>').join('')
        : '<span class="note" ' + biAttr('Tidak ada transfer menuju ' + site.code + ' saat ini. Kalau ada tote berlabel transfer, pindai labelnya di atas.',
            'No transfer is on its way to ' + site.code + '. If a tote with a transfer label arrives, scan the label above.') + '></span>';
      zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
      applyLangTo(box);
      box.querySelectorAll('[data-ref]').forEach(b => {
        b.onclick = () => openTransfer(b.dataset.ref);
      });
    }
  };
})();
