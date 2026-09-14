/* inbound-start.js — 01: open a receipt.
 *
 * The two choices on this screen are the planned/discovered split the backend
 * actually knows about:
 *  - a brand delivery is DISCOVERED inbound. Nothing tells the WMS what should
 *    arrive, so the scan count is the only quantity there is. The AWB/reference
 *    a brand sometimes supplies is recorded so the slip can be found by it later.
 *  - a hub transfer is PLANNED inbound. The transfer carries dispatched
 *    quantities, so the receipt opens with an expectation and the variance is
 *    computed when it is closed.
 *
 * Replaces the wire.js 'inbound-start' handler.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, bi, biAttr, applyLangTo, say, fail, go, esc, CTX } = W;
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

    /* ---- option 1: brand delivery (discovered) ---- */
    const refInput = $('#refInput');
    const primary = $('.choice--primary .btn--primary');
    let busy = false;
    async function openBrand() {
      if (busy) return;
      busy = true;
      try {
        const r = await api.raw.post('/receipts', { site_id: site.id, source_type: 'from_brand' });
        const ref = refInput ? refInput.value.trim() : '';
        if (ref) {
          try {
            await api.raw.patch('/receipts/' + r.id, { external_reference: ref.slice(0, 64) });
          } catch (e) { /* the scan screen shows the field again */ }
        }
        startReceipt(r);
      } catch (err) { fail(err); } finally { busy = false; }
    }
    if (primary) {
      primary.removeAttribute('href');
      primary.setAttribute('role', 'button');
      primary.onclick = (e) => { e.preventDefault(); openBrand(); };
    }
    // A gun scanning the AWB types it and presses Enter: that is the person
    // saying "this delivery", so Enter opens it.
    if (refInput) refInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); openBrand(); }
    });

    /* ---- option 2: hub transfer (planned) ---- */
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
    // a torn or missing label does not stop the receipt.
    try {
      const tr = await api.transfers({ site_id: site.id, limit: 30 });
      const due = tr.transfers.filter(x => x.status === 'dispatched' && x.to_site_code === site.code);
      if (due.length && zoneEl) {
        const box = document.createElement('div');
        box.className = 'col';
        box.style.gap = '8px';
        box.innerHTML = '<span class="eyebrow" ' +
          biAttr('Kiriman yang ditunggu', 'Expected deliveries') + '></span>' +
          due.slice(0, 4).map(x =>
            '<button class="option" type="button" data-ref="' + esc(x.reference) + '">' +
            '<span>' + esc(x.reference) + '</span>' +
            '<span class="option__hint"><span ' + biAttr('dari ', 'from ') + '></span>' +
            esc(x.from_site_code) + ' · ' + NJW.fmt.n(x.total_dispatched) + ' <span ' +
            biAttr('unit', 'units') + '></span></span></button>').join('');
        zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
        applyLangTo(box);
        box.querySelectorAll('[data-ref]').forEach(b => {
          b.onclick = () => openTransfer(b.dataset.ref);
        });
      }
    } catch (e) { /* the label scan still works */ }
  };
})();
