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
    // A transfer carries its own reference, and a receipt opened by AWB is tied
    // to HQ's confirmed Surat Jalan: neither has anything to type. Only a brand
    // delivery received without an AWB keeps a free-text note of its paperwork.
    const strip = $('.refstrip');
    const refInput = $('#refInput');
    if (rc.replenishment_id) {
      show(strip, false);
      const sj = document.createElement('div');
      sj.className = 'notice notice--action';
      sj.innerHTML = '<span class="code code--sm" aria-hidden="true">SJ</span><div class="col" style="gap:4px">' +
        '<span class="notice__title">' + esc(rc.replenishment_reference || '') + ' · AWB ' + esc(rc.external_reference || '') +
        (rc.surat_jalan_no ? ' · SJ ' + esc(rc.surat_jalan_no) : '') + ' · Batch ' + (rc.batch_no || 1) + '</span>' +
        '<span class="notice__body" ' + biAttr('Jumlah pembanding = yang belum diterima dari konfirmasi Wardah. Satu bin inbound = satu SKU: kalau bin habis, selesaikan batch ini lalu lanjutkan sisanya di batch berikutnya dengan AWB yang sama.',
          "Expected = what is still to come from Wardah's confirmation. One inbound bin = one SKU: when the bins run out, finish this batch and receive the rest in the next batch with the same AWB.") +
        '></span><span class="notice__body" data-field="batch-bins"></span></div>';
      if (strip && strip.parentNode) strip.parentNode.insertBefore(sj, strip);
      applyLangTo(sj);
    } else if (rc.source_type === 'from_hub_transfer') {
      show(strip, false);
    } else if (refInput) {
      bi($('.refstrip__label'), 'Catatan nomor kiriman (tanpa AWB dari HQ)', 'Delivery paperwork note (no AWB from HQ)');
      bi($('.refstrip__hint'), 'Kiriman ini tidak ada di daftar HQ. Tulis nomor AWB atau Surat Jalan yang tertera supaya HQ bisa menelusurinya.',
         "This delivery is not on HQ's list. Write the AWB or Surat Jalan number on the paperwork so HQ can trace it.");
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
    if (rc.replenishment_id) bi(targetFoot, 'dari ' + NJW.fmt.n(expected) + ' unit di Surat Jalan',
                               'of ' + NJW.fmt.n(expected) + ' units on the Surat Jalan');
    else if (planned) bi(targetFoot, 'dari ' + NJW.fmt.n(expected) + ' barang dikirim',
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

    /* ---- live comparison with the Surat Jalan ---- */
    // A receipt opened by AWB carries Wardah's confirmed quantity per SKU. The
    // staffer sees, while scanning, what is still missing and what is extra —
    // so a short carton is caught with the driver still there.
    const compare = document.createElement('div');
    compare.className = 'panel';
    compare.style.cssText = 'padding:16px 20px;display:flex;flex-direction:column;gap:10px';
    compare.hidden = !rc.replenishment_id;
    const mainEl = $('.main');
    if (mainEl) mainEl.appendChild(compare);

    function paintBins(s) {
      const el = field('batch-bins');
      if (!el) return;
      const used = s.lines.filter(l => l.qty_received > 0).length;
      if (rc.inbound_bins) bi(el, 'Bin inbound terpakai: ' + used + ' dari ' + rc.inbound_bins + ' SKU',
                                'Inbound bins used: ' + used + ' of ' + rc.inbound_bins + ' SKUs');
      else bi(el, used + ' SKU di batch ini', used + ' SKUs in this batch');
    }
    function paintCompare(s) {
      if (!rc.replenishment_id) return;
      paintBins(s);
      const lines = s.lines.map(l => Object.assign({}, l, {
        left: (l.qty_expected || 0) - l.qty_received,
      })).sort((a, b) => (b.left > 0) - (a.left > 0) || (a.left < 0) - (b.left < 0) || a.sku_name.localeCompare(b.sku_name));
      const done = lines.filter(l => l.left === 0).length;
      const extra = lines.filter(l => l.left < 0).length;
      const cell = 'padding:8px 10px;border-bottom:1px solid var(--rule);font-size:17px';
      const num = cell + ';text-align:right;font-family:var(--font-code);white-space:nowrap';
      compare.innerHTML =
        '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline">' +
        '<span class="eyebrow" ' + biAttr('Dibandingkan dengan Surat Jalan', 'Compared with the Surat Jalan') + '></span>' +
        '<span class="note" ' + biAttr(done + ' dari ' + lines.length + ' SKU cocok' + (extra ? ' · ' + extra + ' SKU lebih' : ''),
          done + ' of ' + lines.length + ' SKUs match' + (extra ? ' · ' + extra + ' SKUs over' : '')) + '></span></div>' +
        '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">' +
        '<thead><tr><th style="' + cell + ';text-align:left;font-size:14px" ' + biAttr('Produk', 'Product') + '></th>' +
        '<th style="' + num + ';font-size:14px" ' + ((rc.batch_no || 1) > 1 ? biAttr('Sisa AWB', 'Left on AWB') : biAttr('Wardah', 'Wardah')) + '></th>' +
        '<th style="' + num + ';font-size:14px" ' + biAttr('Dipindai', 'Scanned') + '></th>' +
        '<th style="' + num + ';font-size:14px" ' + biAttr('Status', 'Status') + '></th></tr></thead><tbody>' +
        lines.map(l => {
          const st = l.left > 0 ? ['var(--caution)', 'kurang ' + l.left, l.left + ' short']
            : l.left < 0 ? ['var(--stop)', 'lebih ' + (-l.left), (-l.left) + ' over']
            : ['var(--accept)', 'cocok', 'matches'];
          return '<tr><td style="' + cell + '">' + esc(l.sku_name) + '</td>' +
            '<td style="' + num + '">' + NJW.fmt.n(l.qty_expected || 0) + '</td>' +
            '<td style="' + num + '">' + NJW.fmt.n(l.qty_received) + '</td>' +
            '<td style="' + num + ';color:' + st[0] + ';font-weight:700" ' + biAttr(st[1], st[2]) + '></td></tr>';
        }).join('') + '</tbody></table></div>';
      applyLangTo(compare);
    }
    async function refreshCompare() {
      if (!rc.replenishment_id) return;
      try { paintCompare(await api.raw.get('/receipts/' + receiptId + '/summary')); } catch (e) { /* next scan retries */ }
    }
    paintCompare(sum);

    /* ---- HQ's answers for products from this delivery ---- */
    if (NJW.skuAnswers && banner) {
      NJW.skuAnswers.mount(banner, {
        receiptId: rc.id,
        onPutAway: q => {
          total += q.qty_put_away || 0;
          setF('session-qty', NJW.fmt.n(total));
          refreshCompare();
        },
      });
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
          refreshCompare();
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
        if (r.outcome === 'batch_full') {
          zone.reject(t('Bin inbound penuh', 'Inbound bins full'), r.message);
          result('caution', 'Bin inbound penuh — SKU ini masuk batch berikutnya',
                 'Inbound bins full — this SKU goes in the next batch', r.sku ? r.sku.name_display : code);
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
        refreshCompare();
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
    let closing = false;
    // Against an AWB there are two ways to stop: this batch is done and more
    // of the AWB follows, or everything is in and the whole AWB is compared.
    if (finish && rc.replenishment_id) {
      bi(finish, 'Semua barang AWB sudah diterima', 'Everything on the AWB is in');
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn btn--outline btn--lg btn--grow';
      bi(next, 'Selesai batch ini — sisanya batch berikutnya', 'Finish this batch — the rest comes next');
      finish.parentNode.insertBefore(next, finish);
      next.onclick = async () => {
        if (closing) return;
        await chain;
        if (!total) return say(t('Belum ada barang dipindai.', 'Nothing has been scanned yet.'));
        if (!confirm(t('Tutup batch ini? Sisa AWB diterima di batch berikutnya: mulai lagi dari AWB yang sama.',
                       'Close this batch? The rest of the AWB is received in the next batch: start again from the same AWB.'))) return;
        closing = true;
        try {
          await api.raw.post('/receipts/' + receiptId + '/complete', { final: false });
          go('15-penerimaan-selesai.html');
        } catch (err) { closing = false; fail(err); }
      };
    }
    if (finish) {
      finish.removeAttribute('href');
      finish.setAttribute('role', 'button');
      finish.onclick = async (e) => {
        e.preventDefault();
        if (closing) return;
        await chain;
        if (!total) return say(t('Belum ada barang dipindai.', 'Nothing has been scanned yet.'));
        if (rc.replenishment_id) {
          try {
            const s = await api.raw.get('/receipts/' + receiptId + '/summary');
            const off = s.lines.filter(l => l.variance);
            if (off.length && !confirm(t(
              off.length + ' SKU tidak cocok dengan Surat Jalan. Sudah dicek ulang semua kardus? Kalau selesai, selisihnya dikirim ke SPV untuk dicek lalu ditandatangani Ops HQ.',
              off.length + ' SKUs do not match the Surat Jalan. Have you rechecked every carton? If you finish, the variance goes to the SPV to check and Ops HQ to sign off.'))) return;
          } catch (e) { /* the server still records the variance */ }
        }
        closing = true;
        try {
          await api.raw.post('/receipts/' + receiptId + '/complete', { final: true });
          go('15-penerimaan-selesai.html');
        } catch (err) { closing = false; fail(err); }
      };
    }
  };
})();
