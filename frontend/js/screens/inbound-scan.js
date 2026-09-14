/* inbound-scan.js — 02: the receiving scan loop.
 *
 * One scan, one unit into the ledger. The server decides where it goes: the
 * SKU's rack first, and the overflow only once the rack is at its full
 * threshold — so the screen's job is to make the overflow case impossible to
 * miss, because it sends the person to a second rack.
 *
 * Replaces the wire.js 'inbound-scan' handler (which also carried a demo AWB ->
 * quantity table; that number was fiction and is gone).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail, go, key, codeHtml, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  const show = (el, on) => { if (el) el.hidden = !on; };

  function paintDay(d) {
    const block = field('day-block');
    if (block) { block.style.background = d.hex; block.style.color = d.ink; }
    setF('day-parity', d.week_parity);
    setF('day-wk', 'W' + d.iso_week);
    bi(field('day-name'), d.day_id, d.day_en);
    setF('day-date', NJW.fmt.date(d.date));
  }

  NJW.screens['inbound-scan'] = async () => {
    const receiptId = CTX.get('receipt');
    if (!receiptId) return go('01-mulai-barang-masuk.html');

    let sum;
    try {
      sum = await api.raw.get('/receipts/' + receiptId + '/summary');
    } catch (e) {
      if (e.status === 404) { CTX.del('receipt'); return go('01-mulai-barang-masuk.html'); }
      return fail(e);
    }
    const rc = sum.receipt;
    if (rc.status !== 'open') return go('15-penerimaan-selesai.html');

    /* ---- chrome + batch colour ---- */
    const mode = $('.chrome__mode');
    function paintMode(ref) {
      const label = ref || ('#' + rc.id);
      CTX.set('receiptLabel', label);
      if (mode) { mode.dataset.keep = '1'; bi(mode, 'Barang masuk · ' + label, 'Inbound · ' + label); }
    }
    paintMode(rc.external_reference);

    // The sticker colour is the day the delivery arrived (the receipt's
    // opened_at, resolved by the server), not the day someone is still
    // scanning it — the slip prints the same rule, and the two must agree.
    if (rc.day_color) {
      paintDay(rc.day_color);
      // A delivery carried past midnight keeps yesterday's colour; say so,
      // or the strip's "today's label colour" would contradict the swatch.
      api.dayColors().then(dc => {
        if (dc.today.date !== rc.day_color.date) {
          bi($('.daystrip__label'), 'Warna batch kiriman ini', "This delivery's batch colour");
        }
      }).catch(() => {});
    } else {
      W.paintDayColour();
    }

    /* ---- reference / AWB ---- */
    // A transfer is planned inbound and carries its own reference; the AWB
    // field is only for a brand delivery that happens to have one.
    const strip = $('.refstrip');
    const refInput = $('#refInput');
    if (rc.source_type === 'from_hub_transfer') {
      show(strip, false);
    } else if (refInput) {
      refInput.value = rc.external_reference || '';
      refInput.addEventListener('change', async () => {
        const val = refInput.value.trim().slice(0, 64);
        try {
          const r = await api.raw.patch('/receipts/' + receiptId, { external_reference: val || null });
          paintMode(r.external_reference);
          say(val ? t('Referensi disimpan.', 'Reference saved.') : t('Referensi dihapus.', 'Reference cleared.'));
        } catch (e) { fail(e); }
      });
      refInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); refInput.blur(); if (zone) zone.focus(); }
      });
    }

    /* ---- planned quantity (transfers only) ---- */
    const planned = sum.lines.some(l => l.qty_expected != null);
    const expected = sum.lines.reduce((n, l) => n + (l.qty_expected || 0), 0);
    const targetFoot = $('#sessionTargetFoot');
    if (planned) bi(targetFoot, 'dari ' + NJW.fmt.n(expected) + ' barang dikirim',
                               'of ' + NJW.fmt.n(expected) + ' items sent');
    else bi(targetFoot, 'barang discan sesi ini', 'items scanned this session');
    let total = sum.total_units;
    setF('session-qty', NJW.fmt.n(total));

    /* ---- clear the design's sample product until something is scanned ---- */
    const banner = region('result');
    show(banner, false);
    const eyebrow = $('.col--grow .eyebrow');
    const basketFoot = field('basket-qty') && field('basket-qty').nextElementSibling;
    bi(basketFoot, 'unit di keranjang ini', 'units in this basket');
    setF('basket-qty', '—');
    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = ''; img.alt = ''; }
    const meta = $('.product__meta');
    if (meta) meta.textContent = '';
    bi($('.product__name'), 'Belum ada barang dipindai', 'No item scanned yet');
    const codeEl = $('.code--xl');
    if (codeEl) codeEl.textContent = '—';
    bi($('.lede'), 'Pindai barang — layar ini menunjukkan tempat menyimpannya.',
                   'Scan an item — this screen shows where it goes.');

    function result(kind, titleId, titleEn, detail) {
      if (!banner) return;
      show(banner, true);
      banner.className = 'banner banner--' + kind;
      banner.innerHTML =
        '<span class="banner__icon banner__icon--round" aria-hidden="true">' +
        (kind === 'accept' ? '✓' : '!') + '</span><span ' + biAttr(titleId, titleEn) + '></span>' +
        '<span class="chrome__sep"></span>' +
        '<span class="banner__detail" data-field="product">' + esc(detail) + '</span>';
      applyLangTo(banner);
    }

    function paintProduct(r) {
      const sku = r.sku;
      if (img) {
        img.dataset.photoKey = (sku.photo_key || sku.brand_sku_code || '').toLowerCase();
        img.alt = sku.name_display;
      }
      if (meta) meta.textContent =
        [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
      const name = $('.product__name');
      if (name) { delete name.dataset.id; delete name.dataset.en; name.textContent = sku.name_display; }
      if (codeEl) codeEl.innerHTML = codeHtml(r.location_code);
      const over = r.outcome === 'overflow';
      bi(eyebrow, over ? 'Simpan di rak cadangan' : 'Simpan di',
                  over ? 'Put away at the overflow' : 'Put away at');
      const p = String(r.location_code || '').split('-');
      if (p.length >= 3) {
        bi($('.lede'),
           (over ? 'Rak utama sudah penuh. ' : '') + 'Rak ' + p[1] + ', tingkat ' + p[2] + '.',
           (over ? 'The main rack is full. ' : '') + 'Rack ' + p[1] + ', level ' + p[2] + '.');
      }
      setF('basket-qty', r.qty_in_basket == null ? '—' : NJW.fmt.n(r.qty_in_basket));
      if (NJW.paintPhotos) NJW.paintPhotos();
    }

    /* ---- the scan loop ---- */
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    const startBtn = $('#startScanBtn');
    function startScanning() {
      show(startBtn, false);
      if (zoneEl) zoneEl.hidden = false;
      if (zone) zone.focus();
    }
    if (startBtn) startBtn.onclick = startScanning;

    async function doScan(code) {
      try {
        const r = await api.raw.post('/receipts/' + receiptId + '/scan',
          { code, qty: 1, idempotency_key: key() });
        if (r.accepted) {
          total = r.session_total;
          setF('session-qty', NJW.fmt.n(total));
          paintProduct(r);
          if (r.outcome === 'overflow') {
            zone.accept(t('Rak utama penuh', 'Main rack full'),
                        t('Simpan di rak cadangan ', 'Put in overflow ') + r.location_code);
            result('caution', 'Rak utama penuh — simpan di rak cadangan',
                   'Main rack full — put it in the overflow', r.sku.name_display);
          } else if (r.outcome === 'over_capacity') {
            zone.accept(t('Keranjang penuh', 'Basket full'),
                        t('Tetap simpan di ', 'Store it anyway at ') + r.location_code);
            result('caution', 'Keranjang melebihi kapasitas — tetap disimpan',
                   'Basket over capacity — stored anyway', r.sku.name_display);
          } else {
            zone.accept(t('Diterima', 'Accepted'), t('Simpan di ', 'Put away at ') + r.location_code);
            result('accept', 'Diterima', 'Accepted', r.sku.name_display);
          }
          return;
        }
        if (r.outcome === 'no_slot') {
          CTX.set('pendingSku', r.sku);
          CTX.set('pendingCode', code);
          CTX.set('basketReturn', '02-barang-masuk-scan.html');
          return go('04-buat-keranjang.html');
        }
        // An unused Ninja label is not an unknown barcode: registering it as a
        // brand barcode would bind a roll sticker to one product for good.
        let kind = 'unknown';
        try {
          const res = await api.raw.get('/scan/resolve' + api.raw.qs({ code, site_id: W.site().id }));
          kind = res.kind;
        } catch (e) { /* treat as unknown */ }
        if (kind === 'unit_plate') {
          zone.reject(t('Label Ninja belum dipakai', 'Unused Ninja label'),
                      t('Tempel dan daftarkan di menu Label unit.', 'Bind it in Unit labelling.'));
          result('stop', 'Label Ninja belum dipakai', 'Unused Ninja label', code);
          return;
        }
        CTX.set('pendingCode', code);
        zone.reject(t('Barcode tidak dikenal', 'Unknown barcode'), code);
        setTimeout(() => go('03-barcode-tidak-dikenal.html'), 700);
      } catch (e) {
        if (e.status === 401) return fail(e);
        if (e.status === 409) { say(e.message); return go('15-penerimaan-selesai.html'); }
        zone.reject(t('Gagal', 'Failed'), e.message);
      }
    }
    // Scans are serialised: a gun fires faster than a round trip, and running
    // them in parallel would paint session totals out of order.
    let chain = Promise.resolve();
    const enqueue = code => { chain = chain.then(() => doScan(code)); return chain; };
    if (zone) { zone.onScan(enqueue); W.testCodes(zoneEl, enqueue); }

    // Back from registering a barcode or creating a basket: scan the unit that
    // was waiting, so the person sees where it goes without scanning it again.
    const rescan = CTX.get('rescan');
    if (rescan) {
      CTX.del('rescan');
      startScanning();
      enqueue(rescan);
    } else if (total > 0) {
      startScanning();
    }

    // Undo takes back this person's own last scan, and only while the receipt
    // is open; after that it is an adjustment a supervisor signs. It joins the
    // scan queue so it can never overtake a scan still in flight.
    async function doUndo() {
      try {
        const r = await api.raw.post('/receipts/' + receiptId + '/scan/undo', { idempotency_key: key() });
        total = r.session_total;
        setF('session-qty', NJW.fmt.n(total));
        result('caution', 'Dibatalkan — keluarkan barangnya dari keranjang',
               'Undone — take the item back out of the basket', r.qty + ' × ' + r.sku_name);
        if (zone) zone.rest();
      } catch (e) {
        if (e.status === 401) return fail(e);
        say(e.message);   // 409: nothing of yours to undo, or the receipt is closed
      }
    }
    const undo = $('[data-action="undo"]');
    if (undo) undo.onclick = () => { chain = chain.then(doUndo); };

    const finish = $('#finishDeliveryBtn');
    if (finish) {
      finish.removeAttribute('href');
      finish.setAttribute('role', 'button');
      let closing = false;
      finish.onclick = async (e) => {
        e.preventDefault();
        if (closing) return;
        await chain;
        if (!total) return say(t('Belum ada barang dipindai.', 'Nothing has been scanned yet.'));
        closing = true;
        try {
          await api.raw.post('/receipts/' + receiptId + '/complete', {});
          go('15-penerimaan-selesai.html');
        } catch (err) { closing = false; fail(err); }
      };
    }
  };
})();
