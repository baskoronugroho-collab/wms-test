/* label-unit.js — 05: Mode B, one Ninja sticker per unit.
 *
 * The staffer locks one product (a product sold with no barcode of its own),
 * sticks a label on each unit and scans it. Binding and putaway are one action:
 * the scan tells the server which unit this is, and the server answers where
 * it goes. A label already on another product is stopped (screen 06).
 *
 * The design's "of 200 units in this delivery" has no source — nothing tells
 * the WMS how many unlabelled units arrived — so the counter is this session's
 * count, and the stock figure the server returns.
 *
 * Replaces the wire.js 'label-unit' handler (it silently locked the first
 * Mode B product in the catalogue).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, setF, esc, bi, biAttr, applyLangTo, say, fail, go, key, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  function paintSku(sku) {
    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = (sku.photo_key || sku.brand_sku_code || '').toLowerCase(); img.alt = sku.name_display; }
    const meta = $('.product__meta');
    if (meta) meta.textContent = [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
    const name = $('.product__name');
    if (name) { delete name.dataset.id; delete name.dataset.en; name.textContent = sku.name_display; }
    if (NJW.paintPhotos) NJW.paintPhotos();
  }

  NJW.screens['label-unit'] = async () => {
    const site = W.site();
    // wire.js's chrome paint puts the site code here; this screen's name is
    // more useful to the person holding the label gun (the site is on the right).
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Label unit · Mode B', 'Unit labelling · Mode B'); }
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;

    const counter = field('count');
    const lede = counter && counter.parentNode.querySelector('.lede');
    const bar = field('bar');
    show(bar && bar.parentNode, false);           // no delivery total to measure against
    const lastBox = field('last') && field('last').closest('.notice');
    show(lastBox, false);
    const eyebrow = $('.row-split .eyebrow');
    const done = $('button.btn--primary');
    const undoBtn = $('[data-action="undo"]');

    // The label roll running out mid-delivery stops the line: warn early.
    api.raw.get('/plates/stock' + api.raw.qs({ site_id: site.id })).then(s => {
      if (s.low) say(t('Stiker tinggal ' + s.unbound + '. Minta gulungan baru ke supervisor.',
                       'Only ' + s.unbound + ' labels left. Ask your supervisor for a new roll.'));
    }).catch(() => {});

    const sku = CTX.get('labelSku');
    if (!sku) return pickProduct();

    /* ================= locked: label and scan ================= */
    paintSku(sku);
    const state = CTX.get('labelCount');
    let n = state && state.sku_id === sku.id ? state.n : 0;
    let inStock = null;
    function paintCount() {
      setF('count', NJW.fmt.n(n));
      if (inStock == null) bi(lede, 'unit dilabeli sesi ini', 'units labelled this session');
      else bi(lede, 'dilabeli sesi ini · ' + NJW.fmt.n(inStock) + ' unit berlabel di stok',
                    'labelled this session · ' + NJW.fmt.n(inStock) + ' labelled units in stock');
      CTX.set('labelCount', { sku_id: sku.id, n });
    }
    paintCount();

    async function bind(code) {
      try {
        const r = await api.raw.post('/plates/bind', {
          site_id: site.id, sku_id: sku.id, plate_code: code, idempotency_key: key(),
        });
        if (r.accepted) {
          n += 1;
          inStock = r.bound_count;
          paintCount();
          show(lastBox, true);
          setF('last', code);
          NJW.undo.push({ plate: code });
          zone.accept(t('Tercatat', 'Recorded'), t('Simpan di ', 'Put away at ') + r.location_code);
          return;
        }
        if (r.outcome === 'already_bound') {
          CTX.set('boundPlate', code);
          return go('06-label-sudah-terpakai.html');
        }
        if (r.outcome === 'no_slot') {
          CTX.set('pendingSku', r.sku || sku);
          CTX.set('pendingPlate', code);
          CTX.set('basketReturn', '05-label-unit.html');
          return go('04-buat-keranjang.html');
        }
        if (r.outcome === 'wrong_site') {
          return zone.reject(t('Label lokasi lain', 'Another site\'s label'),
                             t('Jangan dipakai di sini. Ambil stiker dari gulungan station ini.',
                               'Do not use it here. Take a sticker from this station\'s roll.'));
        }
        zone.reject(t('Label tidak dikenal', 'Unknown label'),
                    t('Ini bukan stiker Ninja. Pindai stiker dari gulungan.',
                      'This is not a Ninja sticker. Scan a sticker from the roll.'));
      } catch (e) {
        if (e.status === 401) return fail(e);
        zone.reject(t('Ditolak', 'Refused'), e.message);
      }
    }
    let chain = Promise.resolve();
    const enqueue = code => { chain = chain.then(() => bind(code)); return chain; };
    if (zone) zone.onScan(enqueue);

    // Back from creating this product's basket: bind the sticker that was
    // waiting for it.
    const waiting = CTX.get('rescanPlate');
    if (waiting) { CTX.del('rescanPlate'); enqueue(waiting); }

    if (undoBtn) undoBtn.onclick = async () => {
      await chain;
      const last = NJW.undo.pop();
      if (!last) return say(t('Tidak ada yang bisa dibatalkan.', 'Nothing to undo.'));
      try {
        await api.raw.post('/plates/' + encodeURIComponent(last.plate) + '/unbind?reason=undo', {});
        n = Math.max(0, n - 1);
        if (inStock != null) inStock = Math.max(0, inStock - 1);
        paintCount();
        say(t('Label ' + last.plate + ' dilepas. Kupas stikernya.', 'Label ' + last.plate + ' released. Peel the sticker off.'));
      } catch (e) { NJW.undo.push(last); fail(e); }
    };

    // Finishing a product returns to the picker: the next product in the
    // delivery is the usual next step, and the menu is one tap away anyway.
    if (done) done.onclick = () => {
      CTX.del('labelSku');
      CTX.del('labelCount');
      location.reload();
    };

    /* ================= not locked: pick the product ================= */
    async function pickProduct() {
      bi(eyebrow, 'Pilih produk', 'Pick the product');
      const name = $('.product__name');
      bi(name, 'Belum ada produk dipilih', 'No product picked yet');
      const meta = $('.product__meta'); if (meta) meta.textContent = '';
      const img = $('.product__photo'); if (img) { img.dataset.photoKey = ''; img.alt = ''; }
      setF('count', '0');
      bi(lede, 'Pilih produk dulu, lalu mulai tempel stiker.', 'Pick the product first, then start labelling.');
      show(done, false);
      show(undoBtn, false);
      if (zone) zone.onScan(() => zone.reject(t('Pilih produk dulu', 'Pick the product first'),
        t('Stiker hanya bisa dicatat untuk produk yang dipilih.', 'A sticker can only be recorded against a picked product.')));

      const box = document.createElement('div');
      box.className = 'col';
      box.style.gap = '8px';
      box.innerHTML =
        '<div class="refstrip">' +
        '<label class="refstrip__label" for="skuQ" ' + biAttr('Cari produk tanpa barcode', 'Find a product with no barcode') + '></label>' +
        '<input class="refstrip__input" id="skuQ" type="search" autocomplete="off" style="font-family:inherit;font-size:20px;min-height:56px">' +
        '</div><div class="col" style="gap:8px" data-region="sku-results"></div>';
      const panel = $('.row-split .panel');
      panel.parentNode.insertBefore(box, panel.nextSibling);
      applyLangTo(box);

      const q = $('#skuQ', box);
      const results = $('[data-region="sku-results"]', box);
      let all = [];
      try {
        const r = await api.skus({ limit: 500 });
        all = r.skus.filter(s => s.identity_mode === 'unit_label');
      } catch (e) { return fail(e); }

      function render() {
        const term = q.value.trim().toLowerCase();
        const hits = all.filter(s => !term ||
          (s.name_display + ' ' + s.brand_sku_code).toLowerCase().includes(term)).slice(0, 6);
        if (!all.length) {
          results.innerHTML = '<span class="note" ' + biAttr(
            'Belum ada produk tanpa barcode di katalog. Panggil supervisor.',
            'No products without a barcode in the catalogue yet. Call your supervisor.') + '></span>';
        } else if (!hits.length) {
          results.innerHTML = '<span class="note" ' + biAttr('Tidak ketemu. Coba kata lain.', 'Nothing found. Try another word.') + '></span>';
        } else {
          results.innerHTML = hits.map(s =>
            '<button class="option" type="button" data-sku="' + s.id + '"><span>' + esc(s.name_display) +
            '</span><span class="option__hint">' +
            esc([s.brand_code, s.unit_size, s.brand_sku_code].filter(Boolean).join(' · ')) +
            '</span></button>').join('');
        }
        applyLangTo(results);
        $$('[data-sku]', results).forEach(b => {
          b.onclick = () => {
            CTX.set('labelSku', all.find(s => s.id === +b.dataset.sku));
            CTX.del('labelCount');
            location.reload();
          };
        });
      }
      q.addEventListener('input', render);
      render();
    }
  };
})();
