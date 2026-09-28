/* short-pick.js — 17: the item is not (all) in the basket (PRD v3.3 A9.1).
 *
 * Grab does not allow an order to change, so a missing item cancels the whole
 * order. First the screen lists other places at this hub holding the SKU;
 * found there, the line moves and the pick carries on. If not, the picker
 * records what is really in the bin (the server corrects the count at once so
 * no other order is sent to an empty bin), then the SPV cancels in Hiryu first
 * (Cancel order, 2001 Item out of stock) and taps Sudah dibatalkan di Hiryu.
 *
 * Caution colours, never stop red: the picker did nothing wrong.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, region, setF, esc, bi, biAttr, applyLangTo, say, fail, go, CTX } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  NJW.screens['short-pick'] = async () => {
    const s = CTX.get('shortLine');
    if (!s || !s.line) return go('07-ambil-pesanan.html');
    const line = s.line;
    const no = s.external_ref;
    const wanted = Math.max(0, line.qty_required - line.qty_picked);

    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Ambil pesanan · ' + no, 'Pick order · ' + no); }
    const where = $('.banner--caution .code');
    if (where) where.textContent = line.location_code || '—';

    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = line.photo_key || (line.brand_sku_code || '').toLowerCase(); img.alt = line.sku_name; }
    const name = $('.product__name'); if (name) name.textContent = line.sku_name;
    const meta = $('.product__meta');
    if (meta) meta.textContent = [line.unit_size, line.brand_sku_code, line.location_code].filter(Boolean).join(' · ');
    if (NJW.paintPhotos) NJW.paintPhotos();

    bi($('.notice__body'),
       'Stoknya yang tidak cocok, bukan cara kamu mengambil. Supervisor melihat selisih ini beserta namamu.',
       'The stock did not match, not the way you picked. A supervisor sees this gap with your name.');

    /* ---- the cancel step, once the shortfall is recorded ---- */
    function showCancel() {
      const banner = $('.banner--caution');
      if (banner) bi(banner.querySelector('span[data-id]'),
                     'Pesanan harus dibatalkan', 'The order must be cancelled');
      const main = $('.main');
      main.innerHTML =
        '<div class="col" style="gap:16px;max-width:760px">' +
        '<span class="code" style="font-size:44px">' + esc(no) + '</span>' +
        '<div class="notice notice--caution"><span class="code code--sm" aria-hidden="true">!</span>' +
        '<div class="col" style="gap:6px"><span class="notice__title" ' + biAttr('Panggil SPV', 'Call the SPV') + '></span>' +
        '<span class="notice__body" ' + biAttr(
          'Grab tidak mengizinkan pesanan diubah. SPV: di Hiryu buka ' + no +
            ', tekan Cancel order, alasan 2001 Item out of stock. Setelah itu tekan tombol di bawah.',
          'Grab does not allow an order to change. SPV: in Hiryu open ' + no +
            ', press Cancel order, reason 2001 Item out of stock. Then tap the button below.') + '></span>' +
        '</div></div>' +
        '<button class="btn btn--primary btn--lg btn--block" type="button" data-act="cancelled" ' +
          biAttr('Sudah dibatalkan di Hiryu', 'Cancelled in Hiryu') + '></button>' +
        '<span class="note" ' + biAttr(
          'Barang yang sudah diambil masuk Kembalikan ke rak. SPV lalu mengetik stok SKU ini ke Hiryu.',
          'Units already picked go to Return to shelf. The SPV then types this SKU stock into Hiryu.') + '></span>' +
        '</div>';
      applyLangTo(main);
      const b = $('[data-act="cancelled"]');
      b.onclick = async () => {
        if (!confirm(en() ? 'Is ' + no + ' cancelled in Hiryu?' : 'Apakah ' + no + ' sudah dibatalkan di Hiryu?')) return;
        b.disabled = true;
        try {
          const r = await NJW.api.hiryu.cancelledInHiryu(s.order_id);
          CTX.del('shortLine'); CTX.del('task');
          say(oneLang(r.message));
          setTimeout(() => go('18-kembalikan.html'), 1500);
        } catch (err) {
          if (err.status === 401) return fail(err);
          b.disabled = false;
          say(oneLang(err.message));
        }
      };
    }
    if (s.recorded) return showCancel();

    /* ---- look elsewhere first ---- */
    (async () => {
      let places = [];
      try { places = (await NJW.api.hiryu.elsewhere(line.id)).places || []; } catch (e) { return; }
      if (!places.length) return;
      const box = document.createElement('div');
      box.className = 'notice notice--action';
      box.innerHTML = '<span class="code code--sm" aria-hidden="true">?</span>' +
        '<div class="col" style="gap:8px"><span class="notice__title" ' +
        biAttr('Cek dulu di tempat lain', 'Look somewhere else first') + '></span>' +
        '<span class="notice__body" ' + biAttr('WMS mencatat barang ini juga ada di:', 'The WMS records this item at:') + '></span>' +
        places.map(p => '<div class="stats" style="align-items:center;gap:12px"><span class="code code--md">' +
          esc(p.location_code) + '</span><span class="note">' + p.free + ' unit</span>' +
          '<button class="btn btn--primary" type="button" data-move="' + p.location_id + '" ' +
          biAttr('Ketemu, lanjut ambil', 'Found it, carry on') + '></button></div>').join('') +
        '</div>';
      const first = $('.main .row-split .col--grow');
      if (first) first.insertBefore(box, first.firstChild);
      applyLangTo(box);
      box.onclick = async (e) => {
        const b = e.target.closest('[data-move]');
        if (!b) return;
        b.disabled = true;
        try {
          await NJW.api.hiryu.moveLine(line.id, +b.dataset.move);
          CTX.del('shortLine');
          go('07-ambil-pesanan.html');
        } catch (err) {
          b.disabled = false;
          say(oneLang(err.message));
        }
      };
    })();

    /* ---- the choice and the stepper ----
       Found must stay below what the order wants: if everything is there, the
       right action is to scan it, and the server refuses a "short" of zero. */
    const maxSome = wanted - 1;
    let choice = 'none';
    let found = Math.min(1, maxSome);
    const noneBtn = $('[data-choice="none"]'), someBtn = $('[data-choice="some"]');
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

    bi($('.main .lede'), 'Pilih satu. Pesanan ini akan dibatalkan di Hiryu, jadi berhenti mengambil barang lain.',
                         'Pick one. This order will be cancelled in Hiryu, so stop picking the other items.');

    /* ---- record, then the cancel step ---- */
    const carryOn = $('.stats a.btn--primary');
    if (carryOn) {
      carryOn.removeAttribute('href');
      carryOn.setAttribute('role', 'button');
      carryOn.style.cursor = 'pointer';
      bi(carryOn, 'Catat, lalu panggil SPV', 'Record it, then call the SPV');
      let sending = false;
      carryOn.onclick = async (e) => {
        e.preventDefault();
        if (sending) return;
        sending = true;
        carryOn.classList.add('is-locked');
        try {
          await NJW.api.raw.post('/pick-lines/' + line.id + '/short',
            { qty_found: choice === 'none' ? 0 : found });
          s.recorded = true;
          CTX.set('shortLine', s);
          showCancel();
        } catch (err) {
          if (err.status === 409) {
            // Cancelled or finished meanwhile: the pick screen shows what is true now.
            say(oneLang(err.message));
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
