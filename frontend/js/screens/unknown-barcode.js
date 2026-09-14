/* unknown-barcode.js — 03: a barcode the system has never seen.
 *
 * The common case is a real product whose barcode was never registered. The
 * staffer finds the product, matches it, and the barcode is bound to it for
 * good — then the waiting unit is scanned into the receipt on the way back, so
 * nobody has to scan it twice.
 *
 * Replaces the wire.js 'unknown-barcode' handler (it used window.prompt, and
 * reported "registered" even when the barcode already belonged to another SKU).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, esc, bi, biAttr, applyLangTo, say, fail, go, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  NJW.screens['unknown-barcode'] = async () => {
    const code = CTX.get('pendingCode');
    const receiptId = CTX.get('receipt');
    if (!receiptId) return go('01-mulai-barang-masuk.html');
    if (!code) return go('02-barang-masuk-scan.html');

    const label = CTX.get('receiptLabel') || ('#' + receiptId);
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Barang masuk · ' + label, 'Inbound · ' + label); }
    const today = await W.paintDayColour();
    if (today) bi(field('day-name'), today.day_id, today.day_en);
    const codeEl = $('.code--lg');
    if (codeEl) codeEl.textContent = code;

    const back = () => { CTX.del('pendingCode'); go('02-barang-masuk-scan.html'); };

    /* ---- option 1: register to a product ---- */
    const choices = $('.choices');
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.cssText = 'padding:20px;display:none';
    panel.innerHTML =
      '<div class="col">' +
      '<span class="eyebrow eyebrow--action" ' + biAttr('Daftarkan ke produk', 'Register to a product') + '></span>' +
      '<div class="refstrip">' +
      '<label class="refstrip__label" for="skuQ" ' + biAttr('Nama atau kode produk', 'Product name or code') + '></label>' +
      '<input class="refstrip__input" id="skuQ" type="search" autocomplete="off" style="font-family:inherit;font-size:20px;min-height:56px">' +
      '<span class="refstrip__hint" ' + biAttr('Ketik minimal 3 huruf, lalu pilih yang cocok dengan barang di tangan.',
        'Type at least 3 letters, then pick the one that matches the item in your hand.') + '></span>' +
      '</div>' +
      '<div class="col" style="gap:8px" data-region="sku-results"></div>' +
      '<div class="stats">' +
      '<button class="btn btn--lg" type="button" data-action="search-back" style="flex:0 0 220px" ' +
      biAttr('Kembali', 'Back') + '></button>' +
      '<button class="btn btn--primary btn--lg btn--grow" type="button" data-action="register" disabled ' +
      biAttr('Pilih produknya dulu', 'Pick the product first') + '></button>' +
      '</div></div>';
    choices.parentNode.insertBefore(panel, choices.nextSibling);
    applyLangTo(panel);

    const q = $('#skuQ', panel);
    const results = $('[data-region="sku-results"]', panel);
    const regBtn = $('[data-action="register"]', panel);
    let picked = null, seq = 0, timer = null;

    function renderResults(skus) {
      if (!skus.length) {
        results.innerHTML = '<span class="note" ' +
          biAttr('Tidak ketemu. Coba kata lain, atau panggil supervisor.',
                 'Nothing found. Try another word, or call your supervisor.') + '></span>';
        applyLangTo(results);
        return;
      }
      results.innerHTML = skus.map(s =>
        '<button class="option" type="button" data-sku="' + s.id + '">' +
        '<span>' + esc(s.name_display) + '</span>' +
        '<span class="option__hint">' +
        esc([s.brand_code, s.unit_size, s.brand_sku_code].filter(Boolean).join(' · ')) +
        '</span></button>').join('');
      $$('[data-sku]', results).forEach(b => {
        b.onclick = () => {
          $$('[data-sku]', results).forEach(x => { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
          b.classList.add('is-on');
          b.setAttribute('aria-pressed', 'true');
          picked = skus.find(s => s.id === +b.dataset.sku);
          regBtn.disabled = false;
          bi(regBtn, 'Daftarkan ke ' + picked.name_display, 'Register to ' + picked.name_display);
        };
      });
    }

    async function search() {
      const term = q.value.trim();
      picked = null;
      regBtn.disabled = true;
      bi(regBtn, 'Pilih produknya dulu', 'Pick the product first');
      if (term.length < 3) { results.innerHTML = ''; return; }
      const mine = ++seq;
      try {
        const r = await api.skus({ q: term, limit: 12 });
        if (mine !== seq) return;   // a newer keystroke already asked
        // A product sold without a barcode is labelled with Ninja stickers
        // instead; binding a brand barcode to it would be wrong.
        renderResults(r.skus.filter(s => s.identity_mode !== 'unit_label').slice(0, 8));
      } catch (e) { fail(e); }
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });

    const primary = $('.choice--primary .btn--primary');
    if (primary) {
      primary.removeAttribute('href');
      primary.setAttribute('role', 'button');
      primary.onclick = (e) => {
        e.preventDefault();
        show(choices, false);
        show(panel, true);
        q.focus();
      };
    }
    $('[data-action="search-back"]', panel).onclick = () => {
      show(panel, false);
      show(choices, true);
    };

    regBtn.onclick = async () => {
      if (!picked) return;
      regBtn.disabled = true;
      try {
        const r = await api.registerBarcodes({ sku_id: picked.id, barcodes: [code] });
        const chk = r.checks[0] || {};
        if (chk.state === 'conflict') {
          regBtn.disabled = false;
          return say(t('Barcode ini sudah terdaftar untuk ', 'This barcode already belongs to ') +
                     (chk.conflict_sku_name || '?') + t('. Panggil supervisor.', '. Call your supervisor.'));
        }
        say(t('Terdaftar: ', 'Registered: ') + picked.name_display);
        CTX.del('pendingCode');
        CTX.set('rescan', code);
        setTimeout(() => go('02-barang-masuk-scan.html'), 700);
      } catch (err) { regBtn.disabled = false; fail(err); }
    };

    /* ---- option 2: flag for a supervisor ---- */
    // There is no flag record in the backend yet, so this must not pretend it
    // saved one: it tells the person the physical step and the escalation.
    const flag = $('.choice button.btn--outline');
    if (flag) flag.onclick = () => say(t(
      'Belum tercatat di sistem. Taruh barang di rak transit dan beri tahu supervisor sekarang.',
      'Not recorded by the system yet. Park the item on the transit shelf and tell your supervisor now.'));

    /* ---- option 3: skip ---- */
    $$('.choice a.btn:not(.btn--primary)').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); back(); };
    });
  };
})();
