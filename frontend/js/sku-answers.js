/* sku-answers.js — HQ's answers to "unknown product" requests, on the station.
 *
 * A staffer who sent HQ a photo of an unregistered product left the units in the
 * temporary inbound bin. When HQ has registered the SKU and chosen its rack, the
 * answer appears here: take N units to LOCATION, then confirm. Confirming puts
 * the units into stock. Requests still waiting for HQ are listed too, so nobody
 * forgets what is sitting in the temporary bin.
 *
 *   NJW.skuAnswers.mount(beforeEl, { receiptId })   // null receiptId = whole site
 */
(function () {
  'use strict';
  window.NJW = window.NJW || {};

  function mount(anchor, opts) {
    const W = NJW.wire, api = NJW.api;
    const { esc, biAttr, applyLangTo, say, fail, codeHtml } = W;
    const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
    const site = W.site();
    if (!anchor || !site) return;

    const box = document.createElement('div');
    box.className = 'col';
    box.style.gap = '10px';
    box.hidden = true;
    anchor.parentNode.insertBefore(box, anchor);

    async function load() {
      let r;
      try {
        r = await api.skuRequests({ site_id: site.id, status: 'active', receipt_id: opts && opts.receiptId });
      } catch (e) { return; }
      const done = r.requests.filter(q => q.status === 'resolved');
      const waiting = r.requests.filter(q => q.status === 'open');
      box.hidden = !done.length && !waiting.length;
      box.innerHTML =
        done.map(q =>
          '<div class="notice notice--action" style="align-items:center">' +
          '<span class="code code--sm" aria-hidden="true">→</span>' +
          '<div class="col" style="gap:4px;flex:1 1 auto">' +
          '<span class="notice__title">' + esc(q.sku_name) + '</span>' +
          '<span class="notice__body"><span ' + biAttr('HQ sudah mendaftarkan barang ini. Ambil ' + q.qty_counted +
            ' unit dari bin sementara, taruh di', 'HQ registered this product. Take ' + q.qty_counted +
            ' units from the temporary bin to') + '></span> <span class="code code--sm">' + codeHtml(q.location_code) + '</span>' +
          (q.resolution_note ? '<br><span ' + biAttr('Pesan HQ: ', 'HQ says: ') + '></span>' + esc(q.resolution_note) : '') +
          '</span></div>' +
          '<button class="btn btn--primary" type="button" data-putaway="' + q.id + '" data-qty="' + q.qty_counted + '" ' +
          biAttr('Sudah ditaruh di rak', 'Put away') + '></button></div>').join('') +
        (waiting.length
          ? '<div class="notice notice--caution"><span class="code code--sm" aria-hidden="true">!</span>' +
            '<div class="col" style="gap:4px"><span class="notice__title" ' +
            biAttr(waiting.length + ' barang menunggu jawaban HQ', waiting.length + ' product(s) waiting for HQ') + '></span>' +
            '<span class="notice__body" ' + biAttr('Biarkan di bin sementara inbound. Jangan taruh di rak sampai HQ menjawab.',
              'Leave them in the temporary inbound bin. Do not rack them until HQ answers.') + '></span>' +
            '<span class="notice__body">' + waiting.map(q => esc(q.barcode || '#' + q.id) + ' · ' + q.qty_counted + ' unit').join(' — ') +
            '</span></div></div>'
          : '');
      applyLangTo(box);
    }

    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-putaway]');
      if (!b) return;
      const n = prompt(t('Berapa unit yang ditaruh di rak?', 'How many units did you put away?'), b.dataset.qty);
      if (n == null) return;
      const qty = parseInt(n, 10);
      if (!(qty >= 0)) return say(t('Isi angka.', 'Enter a number.'));
      b.disabled = true;
      try {
        const q = await api.putAwaySkuRequest(+b.dataset.putaway, qty);
        say(t('Masuk stok: ', 'In stock: ') + (q.qty_put_away || 0) + ' × ' + q.sku_name);
        if (opts && opts.onPutAway) opts.onPutAway(q);
        load();
      } catch (err) { b.disabled = false; fail(err); }
    });

    load();
    setInterval(load, 30000);
    return { reload: load };
  }

  NJW.skuAnswers = { mount };
})();
