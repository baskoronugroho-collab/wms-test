/* variance — screen 12: the reveal, after the count is saved.
 *
 * Zero tolerance: any difference at all goes to a supervisor, and the stock
 * does not change until they sign (POST /opname/adjustments/approve, console).
 * There is no recount button: the session is closed by the save, and the API
 * has no way to reopen it — a recount offered after the system number is on
 * screen would not be blind anyway. The only recount prompt is the check
 * before saving on screen 11.
 *
 * Replaces the wire.js variance handler (pre-v3 markup; its recount link went
 * to a finished session and failed).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, setF, bi, esc, biAttr, applyLangTo, go, CTX } = W;

  NJW.screens.variance = async () => {
    const r = CTX.get('result');
    if (!r) return go('10-hitung-pilih-keranjang.html');
    const v = r.variance || 0;

    const mode = $('.chrome__mode');
    if (mode) {
      mode.dataset.keep = '1';
      bi(mode, 'Hitung stok · ' + (r.location_code || ''), 'Stock count · ' + (r.location_code || ''));
    }

    // Colour + icon + words: a match is green with a tick, a variance amber with "!".
    const banner = region('result');
    if (banner) {
      banner.className = 'banner ' + (v === 0 ? 'banner--accept' : 'banner--caution');
      const icon = $('.banner__icon', banner);
      if (icon) { icon.textContent = v === 0 ? '✓' : '!'; icon.classList.toggle('banner__icon--round', v === 0); }
    }
    if (v === 0) bi(field('result-title'), 'Cocok — hitungan sama dengan catatan', 'Match — your count equals the record');
    else bi(field('result-title'), 'Tercatat — ada selisih, supervisor akan memeriksa',
                                   'Recorded — there is a variance, a supervisor will check');

    setF('location', r.location_code || '—');
    setF('sku-name', r.sku_name || '—');
    setF('expected', r.qty_expected);
    setF('counted', r.qty_counted);
    setF('delta', (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v));

    const cell = field('delta-cell');
    if (cell && v === 0) cell.classList.remove('reveal__cell--delta');
    bi(field('delta-text'),
      v === 0 ? 'Cocok dengan catatan'
        : Math.abs(v) + (v < 0 ? ' barang kurang dari catatan' : ' barang lebih dari catatan'),
      v === 0 ? 'Matches the record'
        : Math.abs(v) + (v < 0 ? ' items fewer than recorded' : ' items more than recorded'));

    bi(field('next-step'),
      v === 0 ? 'Terima kasih. Lanjut ke keranjang berikutnya.'
        : 'Supervisor akan memeriksa selisih ini dan menandatanganinya. Stok di sistem tidak berubah sebelum ditandatangani.',
      v === 0 ? 'Thank you. Go on to the next basket.'
        : 'A supervisor will check this variance and sign it off. The system stock does not change until they sign.');

    // Things found along the way, recorded server-side for the supervisor.
    const extras = field('extras');
    if (extras) {
      const bits = [];
      if (r.foreign_items) {
        bits.push('<span ' + biAttr(r.foreign_items + ' barang lain atau barcode tidak dikenal ikut dicatat.',
          r.foreign_items + ' other products or unknown barcodes were noted.') + '></span>');
      }
      if (r.missing_plates && r.missing_plates.length) {
        const list = r.missing_plates.slice(0, 8).join(', ') + (r.missing_plates.length > 8 ? ', …' : '');
        bits.push('<span ' + biAttr('Label yang tidak terlihat: ', 'Labels not seen: ') + '></span>' +
          '<span class="code code--sm">' + esc(list) + '</span>');
      }
      extras.innerHTML = bits.join(' ');
      applyLangTo(extras);
    }

    CTX.del('session');
    // The result stays until they move on, so a reload still shows it.
    const next = $('[data-action="next"]');
    if (next) {
      next.href = '10-hitung-pilih-keranjang.html';
      next.addEventListener('click', () => CTX.del('result'));
    }
  };
})();
