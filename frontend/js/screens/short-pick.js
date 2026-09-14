/* short-pick.js — 17: the item is not (all) in the basket.
 *
 * Two taps: how many are really there, then carry on. The server writes the
 * shortfall off, picks whatever was found, and raises message 5 (Order short)
 * to Hiryu. Hiryu decides refund, partial or substitute — the station never
 * substitutes, so this screen offers no "take something else instead".
 *
 * Caution colours, never stop red: the picker did nothing wrong.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, region, setF, bi, say, fail, go, CTX } = W;

  NJW.screens['short-pick'] = async () => {
    const s = CTX.get('shortLine');
    if (!s || !s.line) return go('07-ambil-pesanan.html');
    const line = s.line;
    const wanted = Math.max(0, line.qty_required - line.qty_picked);

    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Ambil pesanan · ' + s.external_ref, 'Pick order · ' + s.external_ref); }
    const where = $('.banner--caution .code');
    if (where) where.textContent = line.location_code || '—';

    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = line.photo_key || (line.brand_sku_code || '').toLowerCase(); img.alt = line.sku_name; }
    const name = $('.product__name'); if (name) name.textContent = line.sku_name;
    const meta = $('.product__meta');
    if (meta) meta.textContent = [line.unit_size, line.brand_sku_code, line.location_code].filter(Boolean).join(' · ');
    if (NJW.paintPhotos) NJW.paintPhotos();

    // The design promised a recount list; nothing builds one yet, so the copy
    // says only what actually happens.
    bi($('.notice__body'),
       'Stoknya yang tidak cocok, bukan cara kamu mengambil. Supervisor melihat selisih ini, ' +
       'dan Hiryu diberi tahu. Hiryu yang memutuskan untuk pelanggan: refund, kirim sebagian, atau barang pengganti.',
       'The stock did not match, not the way you picked. A supervisor sees this gap and Hiryu is told. ' +
       'Hiryu decides for the customer: refund, partial delivery or a substitute.');

    /* ---- the choice and the stepper ----
       Found must stay below what the order wants: if everything is there, the
       right action is to scan it, and the server refuses a "short" of zero. */
    const maxSome = wanted - 1;
    let choice = 'none';
    let found = Math.min(1, maxSome);
    const noneBtn = $('[data-choice="none"]'), someBtn = $('[data-choice="some"]');
    // Dim only the stepper when it does not apply; "wanted" and "short"
    // stay readable either way.
    const stepper = $('.vsrow__stepper', region('stepper') || document);

    function paint() {
      const n = choice === 'none' ? 0 : found;
      noneBtn && noneBtn.classList.toggle('is-on', choice === 'none');
      someBtn && someBtn.classList.toggle('is-on', choice === 'some');
      if (stepper) stepper.style.opacity = choice === 'some' ? '' : '.45';
      $$('[data-step]').forEach(b => { b.disabled = choice !== 'some'; });
      setF('wanted', wanted);
      setF('found', maxSome >= 1 ? found : '—');
      setF('found-num', n);
      setF('short', wanted - n);
    }

    if (noneBtn) noneBtn.onclick = () => { choice = 'none'; paint(); };
    // With one unit wanted, "some" cannot exist: one found means nothing is short.
    if (someBtn) {
      if (maxSome < 1) { someBtn.disabled = true; someBtn.style.opacity = '.45'; }
      else someBtn.onclick = () => { choice = 'some'; found = Math.max(1, found); paint(); };
    }
    $$('[data-step]').forEach(b => b.onclick = () => {
      if (choice !== 'some') return;
      found = Math.max(1, Math.min(maxSome, found + (b.dataset.step === 'up' ? 1 : -1)));
      paint();
    });
    paint();

    /* ---- carry on ---- */
    /* This stop is one location. When the order line was split, the same SKU
       has another stop still to come, and the rest may well be there — say so,
       so the picker does not think the item is simply gone. */
    const elsewhere = s.elsewhere || [];
    if (elsewhere.length) {
      bi($('.main .lede'),
         'Hitung yang ada di keranjang ini saja. Barang ini juga diambil dari ' + elsewhere.join(', ') +
         ' — ambil sisanya di sana setelah ini.',
         'Count only what is in this basket. This item is also picked from ' + elsewhere.join(', ') +
         ' — take the rest there next.');
    }

    const carryOn = $('.stats a.btn--primary');
    if (carryOn) {
      carryOn.removeAttribute('href');
      carryOn.setAttribute('role', 'button');
      carryOn.style.cursor = 'pointer';
      if (!s.others) {
        bi(carryOn, 'Catat, lalu selesaikan pesanan', 'Record it, then finish the order');
        bi($('.main .lede'), 'Pilih satu. Ini barang terakhir di pesanan ini — setelahnya pesanan diserahkan ke packing.',
                             'Pick one. This is the last item in the order — after it, the order goes to packing.');
      }
      let sending = false;
      carryOn.onclick = async (e) => {
        e.preventDefault();
        if (sending) return;
        sending = true;
        carryOn.classList.add('is-locked');
        try {
          const r = await NJW.api.raw.post('/pick-lines/' + line.id + '/short',
            { qty_found: choice === 'none' ? 0 : found });
          CTX.del('shortLine');
          say(r.message);
          // The pick screen reloads the task from the server, and moves on to
          // the done screen by itself when nothing is left to pick.
          setTimeout(() => go('07-ambil-pesanan.html'), 900);
        } catch (err) {
          if (err.status === 409) {
            // The order was cancelled or finished meanwhile: nothing to record
            // here. The pick screen shows what the server now says.
            const p = String(err.message).split(' / ');
            say((localStorage.getItem('njw.lang') === 'en' ? p[1] : p[0]) || err.message);
            CTX.del('shortLine');
            return setTimeout(() => go('07-ambil-pesanan.html'), 2500);
          }
          sending = false;
          carryOn.classList.remove('is-locked');
          fail(err);
        }
      };
    }
    const cancel = $('.stats a.btn:not(.btn--primary)');
    if (cancel) cancel.onclick = () => CTX.del('shortLine');
  };
})();
