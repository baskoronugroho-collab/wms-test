/* wrong-item.js — 08: the stop screen after a refused pick scan.
 *
 * Replaces the wire.js `wrong-item` handler, which filled names only and left
 * the design's codes (WDH-GLL-08 / 07) and its fixed instruction on screen.
 *
 * There is deliberately nothing here that lets the picker carry on with the
 * wrong item: the only ways out are back to the scan, or the menu.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, bi, go, CTX } = W;
  const api = () => NJW.api;

  NJW.screens['wrong-item'] = async () => {
    const w = CTX.get('wrong');
    // Reached from anywhere but a refused scan, this page has nothing true to say.
    if (!w) return go('07-ambil-pesanan.html');
    const site = W.site();
    const cards = $$('.card-compare');

    function fill(card, name, codeLine, photoKey) {
      if (!card) return;
      const n = $('.product__name', card);
      if (n) n.textContent = name || '—';
      const c = $('.code', card);
      if (c) c.textContent = codeLine || '';
      const img = $('.card-compare__photo', card);
      if (img) { img.alt = name || ''; img.dataset.photoKey = photoKey || ''; }
    }

    fill(cards[0], w.scanned || w.code, '', '');
    fill(cards[1], w.expected, [w.expected_code, w.location].filter(Boolean).join(' · '), w.expected_photo || '');

    const instr = $('.col > p');
    const back = w.scanned
      ? ['Kembalikan ' + w.scanned + ' ke keranjangnya, lalu ambil ' + w.expected,
         'Put ' + w.scanned + ' back in its basket, then take ' + w.expected]
      : ['Barcode itu tidak dikenal. Taruh barangnya, lalu ambil ' + w.expected,
         'That barcode is not known. Put the item down, then take ' + w.expected];
    bi(instr,
       back[0] + (w.location ? ' dari ' + w.location : '') + '.',
       back[1] + (w.location ? ' from ' + w.location : '') + '.');

    /* The scanned item's code is what tells 07 from 08 at a glance; the
       expected one came with the pick line. One lookup, never waited on. */
    const scanned = w.scanned
      ? await api().raw.get('/scan/resolve' + api().raw.qs({ code: w.code, site_id: site.id })).catch(() => null)
      : null;
    const codeOf = s => [s.unit_size, s.brand_sku_code].filter(Boolean).join(' · ');
    if (scanned && scanned.found && scanned.sku) {
      const s = scanned.sku;
      fill(cards[0], s.name_display, codeOf(s) +
        (scanned.slot_location_code ? ' · ' + scanned.slot_location_code : ''),
        s.photo_key || (s.brand_sku_code || '').toLowerCase());
    } else if (!w.scanned) {
      const c = cards[0] && $('.code', cards[0]);
      bi(c, 'Barcode tidak dikenal: ' + w.code, 'Unknown barcode: ' + w.code);
    }
    if (NJW.paintPhotos) NJW.paintPhotos();
  };
})();
