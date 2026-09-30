/* short-pick.js — 17: the item is not (all) in the basket (PRD §8.1, §8.3).
 *
 * A missing item cancels the whole order (decided 30 Sep). First the screen
 * lists any other place at this hub the WMS records the SKU; found there,
 * Ketemu, lanjut ambil moves the line and the pick goes on. If not, the
 * picker says what is really in the bin and taps Catat: tidak ada. In one
 * step the server then sets the bin's count to that number, tells Hiryu the
 * item is short (message 5), cancels the order in the WMS (holds released,
 * picked units to Kembalikan ke rak) and keeps the declaration, with the
 * picker's name, for the SPV. No SPV step here.
 *
 * The picker sees Pesanan dibatalkan and goes back to waiting; the WMS gives
 * the next order. Units already picked go back to the shelf first.
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
    const site = W.site();
    const line = s.line;
    const no = s.external_ref;
    const wanted = Math.max(0, line.qty_required - line.qty_picked);

    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Ambil pesanan · ' + no, 'Pick order · ' + no); }
    const where = $('.banner--caution .code');
    if (where) where.textContent = line.location_code || '';

    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = line.photo_key || (line.brand_sku_code || '').toLowerCase(); img.alt = line.sku_name; }
    const name = $('.product__name'); if (name) name.textContent = line.sku_name;
    const meta = $('.product__meta');
    if (meta) meta.textContent = [line.unit_size, line.brand_sku_code, line.location_code].filter(Boolean).join(' · ');
    if (NJW.paintPhotos) NJW.paintPhotos();

    /* ---- after Catat: the order is cancelled ---- */
    function showCancelled(r) {
      const banner = $('.banner--caution');
      if (banner) bi(banner.querySelector('span[data-id]'), 'Pesanan dibatalkan', 'Order cancelled');
      const back = r.units_to_return || 0;
      const main = $('.main');
      main.innerHTML =
        '<div class="col" style="gap:16px;max-width:760px">' +
        '<span class="code" style="font-size:44px">' + esc(no) + '</span>' +
        '<span class="h1" ' + biAttr('Pesanan dibatalkan', 'Order cancelled') + '></span>' +
        '<div class="notice notice--caution"><span class="code code--sm" aria-hidden="true">i</span>' +
        '<div class="col" style="gap:6px">' +
        '<span class="notice__body" ' + biAttr(
          'Jumlah di keranjang sudah dicatat ' + r.qty_found + '. Barang yang ada biarkan di keranjang.',
          'The basket count is now ' + r.qty_found + '. Leave what is there in the basket.') + '></span>' +
        (r.link_live
          ? '<span class="notice__body" ' + biAttr(
              'WMS sudah memberi tahu Hiryu. Hiryu membatalkan pesanan ini dengan sendirinya.',
              'The WMS has told Hiryu. Hiryu cancels this order by itself.') + '></span>'
          : '<span class="notice__body" ' + biAttr(
              'Sambungan Hiryu belum aktif: minta SPV membatalkan ' + no + ' di Hiryu (2001 Item out of stock).',
              'The Hiryu link is not on yet: ask the SPV to cancel ' + no + ' in Hiryu (2001 Item out of stock).') + '></span>') +
        '</div></div>' +
        (back
          ? '<div class="notice notice--action"><span class="code code--sm" aria-hidden="true">' + back + '</span>' +
            '<span class="notice__body" ' + biAttr(
              back + ' barang yang sudah kamu ambil untuk pesanan ini harus kembali ke rak dulu.',
              back + (back === 1 ? ' unit' : ' units') + ' you already picked for this order must go back to the shelf first.') +
            '></span></div>' +
            '<button class="btn btn--primary btn--lg btn--block" type="button" data-act="return" ' +
              biAttr('Kembalikan ke rak', 'Return to the shelf') + '></button>' +
            '<button class="btn btn--outline btn--lg btn--block" type="button" data-act="wait" ' +
              biAttr('Tunggu pesanan berikutnya', 'Wait for the next order') + '></button>'
          : '<button class="btn btn--primary btn--lg btn--block" type="button" data-act="wait" ' +
              biAttr('Tunggu pesanan berikutnya', 'Wait for the next order') + '></button>') +
        '</div>';
      applyLangTo(main);
      main.onclick = async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b || b.disabled) return;
        b.disabled = true;
        CTX.del('shortLine'); CTX.del('task');
        if (b.dataset.act === 'return') {
          // A break while walking units back, so no order is given meanwhile.
          // Siap ambil on Ambil pesanan brings the next one.
          try { await NJW.api.raw.post('/pickers/break', { site_id: site.id }); }
          catch (err) { if (err.status === 401) return fail(err); }
          return go('18-kembalikan.html');
        }
        go('07-ambil-pesanan.html');
      };
      if (!back) setTimeout(() => { if (CTX.get('shortLine')) { CTX.del('shortLine'); CTX.del('task'); } go('07-ambil-pesanan.html'); }, 6000);
    }
    if (s.result) return showCancelled(s.result);

    /* ---- look elsewhere first ---- */
    (async () => {
      let places = [];
      try { places = (await NJW.api.raw.get('/hiryu/pick-lines/' + line.id + '/elsewhere')).places || []; }
      catch (e) { return; }
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
          await NJW.api.raw.post('/hiryu/pick-lines/' + line.id + '/move', { location_id: +b.dataset.move });
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
      setF('found', maxSome >= 1 ? found : '');
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

    /* ---- Catat: tidak ada ---- */
    const record = $('.stats a.btn--primary');
    if (record) {
      record.removeAttribute('href');
      record.setAttribute('role', 'button');
      record.style.cursor = 'pointer';
      bi(record, 'Catat: tidak ada', 'Record: not there');
      let sending = false;
      record.onclick = async (e) => {
        e.preventDefault();
        if (sending) return;
        const n = choice === 'none' ? 0 : found;
        if (!confirm(en()
          ? 'Only ' + n + ' in the basket and nowhere else? ' + no + ' will be cancelled.'
          : 'Hanya ada ' + n + ' dan tidak ada di tempat lain? ' + no + ' akan dibatalkan.')) return;
        sending = true;
        record.classList.add('is-locked');
        try {
          const r = await NJW.api.raw.post('/pick-lines/' + line.id + '/short', { qty_found: n });
          s.result = r;
          CTX.set('shortLine', s);
          CTX.del('task');
          showCancelled(r);
        } catch (err) {
          if (err.status === 409) {
            // Cancelled or moved meanwhile: the pick screen shows what is true now.
            say(oneLang(err.message));
            CTX.del('shortLine');
            return setTimeout(() => go('07-ambil-pesanan.html'), 2500);
          }
          sending = false;
          record.classList.remove('is-locked');
          if (err.status === 401) return fail(err);
          say(oneLang(err.message));
        }
      };
    }
    const cancel = $('.stats a.btn:not(.btn--primary)');
    if (cancel) {
      bi(cancel, 'Kembali', 'Back');
      cancel.onclick = () => CTX.del('shortLine');
    }
  };
})();
