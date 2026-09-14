/* create-basket.js — 04: the product has no rack yet, give it one.
 *
 * Creates the SKU's PRIMARY slot (its rack face); inbound always fills that
 * first. Sizes and locations come from the live rack map: only empty baskets
 * are offered, grouped by their real size, in the same height preference the
 * server's own suggestion uses (level 3, 2, 4, 1, then 5 which needs a stool).
 *
 * Reached from inbound (02) and from unit labelling (05); CTX.basketReturn says
 * which, and the unit that was waiting is re-scanned there.
 *
 * Replaces the wire.js 'create-basket' handler.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, bi, applyLangTo, say, fail, go, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  const LEVEL_RANK = { 3: 0, 2: 1, 4: 2, 1: 3 };
  const SIZES = [
    { size: 'S', id: 'Kecil', en: 'Small' },
    { size: 'M', id: 'Sedang', en: 'Medium' },
    { size: 'L', id: 'Besar', en: 'Large' },
    { size: 'OPEN', id: 'Rak terbuka', en: 'Open shelf' },
  ];

  NJW.screens['create-basket'] = async () => {
    const site = W.site();
    const sku = CTX.get('pendingSku');
    const back = CTX.get('basketReturn') || '02-barang-masuk-scan.html';
    const fromLabel = back.indexOf('05-') === 0;
    if (!sku) return go(back);

    const mode = $('.chrome__mode');
    if (mode) {
      mode.dataset.keep = '1';
      if (fromLabel) bi(mode, 'Label unit · keranjang baru', 'Unit labelling · new basket');
      else bi(mode, 'Barang masuk · keranjang baru', 'Inbound · new basket');
    }
    W.paintDayColour().then(d => { if (d) bi(field('day-name'), d.day_id, d.day_en); });

    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = (sku.photo_key || sku.brand_sku_code || '').toLowerCase(); img.alt = sku.name_display; }
    const meta = $('.product__meta');
    if (meta) meta.textContent = [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
    const name = $('.product__name');
    if (name) name.textContent = sku.name_display;
    if (NJW.paintPhotos) NJW.paintPhotos();

    const leave = () => {
      ['pendingSku', 'pendingCode', 'pendingPlate', 'basketReturn'].forEach(k => CTX.del(k));
      go(back);
    };
    $$('a.btn:not(.btn--primary)').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); leave(); };
    });

    let suggestion, empties;
    async function load() {
      const [sug, map] = await Promise.all([
        api.raw.get('/slots/suggest' + api.raw.qs({ site_id: site.id, sku_id: sku.id })),
        api.rackMap(site.id),
      ]);
      suggestion = sug;
      empties = [];
      map.racks.forEach(rk => rk.levels.forEach(lv => lv.positions.forEach(p => {
        // empty_slot = a basket is on the shelf and nobody owns it yet
        if (p.state === 'empty_slot' && p.basket_id) {
          empties.push({ basket_id: p.basket_id, code: p.code, size: p.basket_size || 'M',
                         rack: rk.code, level: lv.level_no });
        }
      })));
      empties.sort((a, b) =>
        ((LEVEL_RANK[a.level] ?? 4) - (LEVEL_RANK[b.level] ?? 4)) || a.code.localeCompare(b.code));
    }
    try { await load(); } catch (e) { return fail(e); }

    /* ---- sizes ---- */
    const sizeBtns = $$('.option');
    const sizeCol = sizeBtns[0] && sizeBtns[0].parentNode;
    // The markup ships three sizes; an open shelf is a fourth, shown only when
    // this station has one or the product is too big for any basket.
    if (sizeCol && (suggestion.recommended_size === 'OPEN' || empties.some(e => e.size === 'OPEN'))) {
      const extra = sizeBtns[sizeBtns.length - 1].cloneNode(true);
      sizeCol.appendChild(extra);
      sizeBtns.push(extra);
    }
    sizeBtns.forEach((b, i) => { if (SIZES[i]) b.dataset.size = SIZES[i].size; });

    let size = null, choice = null;
    const locBtns = $$('.loc-option');
    const locRow = locBtns[0] && locBtns[0].parentNode;
    const none = document.createElement('p');
    none.className = 'note';
    if (locRow) locRow.parentNode.insertBefore(none, locRow.nextSibling);
    const primary = $('.btn--primary');
    if (primary) { primary.removeAttribute('href'); primary.setAttribute('role', 'button'); }

    function paintSizes() {
      sizeBtns.forEach(b => {
        const s = SIZES.find(x => x.size === b.dataset.size);
        const spans = b.querySelectorAll('span');
        if (spans[0]) bi(spans[0], s.id, s.en);
        const n = empties.filter(e => e.size === s.size).length;
        const rec = s.size === suggestion.recommended_size;
        bi(spans[1], n + ' kosong' + (rec ? ' · disarankan' : ''),
                     n + ' empty' + (rec ? ' · suggested' : ''));
        b.classList.toggle('is-on', s.size === size);
        b.setAttribute('aria-pressed', String(s.size === size));
      });
    }

    function paintLocs() {
      const list = empties.filter(e => e.size === size).slice(0, locBtns.length);
      choice = list[0] || null;
      locBtns.forEach((b, i) => {
        const e = list[i];
        show(b, !!e);
        if (!e) return;
        b.dataset.basket = e.basket_id;
        const parts = b.children;
        if (parts[0]) {
          parts[0].className = 'eyebrow' + (i === 0 ? ' eyebrow--action' : '');
          bi(parts[0], i === 0 ? 'Disarankan' : 'Pilihan lain', i === 0 ? 'Suggested' : 'Alternative');
        }
        if (parts[1]) parts[1].textContent = e.code;
        if (parts[2]) bi(parts[2], 'Rak ' + e.rack + ', tingkat ' + e.level, 'Rack ' + e.rack + ', level ' + e.level);
        b.classList.toggle('is-on', i === 0);
        b.setAttribute('aria-pressed', String(i === 0));
      });
      show(none, !list.length);
      if (!list.length) {
        bi(none, 'Tidak ada keranjang kosong ukuran ini. Pilih ukuran lain, atau panggil supervisor.',
                 'No empty basket of this size. Pick another size, or call your supervisor.');
      }
      paintPrimary();
    }

    function paintPrimary() {
      if (!primary) return;
      if (choice) {
        primary.removeAttribute('aria-disabled');
        bi(primary, 'Buat keranjang di ' + choice.code + ' & lanjut', 'Create basket at ' + choice.code + ' & continue');
      } else {
        primary.setAttribute('aria-disabled', 'true');
        bi(primary, 'Tidak ada keranjang kosong', 'No empty basket');
      }
    }

    function pickSize(s) { size = s; paintSizes(); paintLocs(); }

    sizeBtns.forEach(b => { b.onclick = () => pickSize(b.dataset.size); });
    locBtns.forEach(b => {
      b.onclick = () => {
        const e = empties.find(x => x.basket_id === +b.dataset.basket);
        if (!e) return;
        choice = e;
        locBtns.forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        paintPrimary();
      };
    });

    const firstWithRoom = SIZES.map(s => s.size).find(s => empties.some(e => e.size === s));
    pickSize(empties.some(e => e.size === suggestion.recommended_size)
      ? suggestion.recommended_size : (firstWithRoom || suggestion.recommended_size));
    applyLangTo(document.querySelector('.main'));

    let busy = false;
    if (primary) primary.onclick = async (e) => {
      e.preventDefault();
      if (busy || !choice) return;
      busy = true;
      try {
        await api.raw.post('/slots', {
          site_id: site.id, sku_id: sku.id, basket_id: choice.basket_id,
          created_during_inbound: true, slot_role: 'primary',
        });
        say(t('Keranjang dibuat: ', 'Basket created: ') + choice.code);
        done();
      } catch (err) {
        busy = false;
        if (err.status === 401) return fail(err);
        // Someone else slotted this product meanwhile: it has a rack now, which
        // is all the waiting unit needed.
        if (err.status === 409 && /already has a primary/i.test(err.message)) return done();
        say(err.message);
        // Most likely the basket was just taken: offer what is still free.
        try { await load(); pickSize(size); } catch (e2) { /* keep the old list */ }
      }
    };

    function done() {
      const plate = CTX.get('pendingPlate'), code = CTX.get('pendingCode');
      if (fromLabel && plate) CTX.set('rescanPlate', plate);
      else if (code) CTX.set('rescan', code);
      ['pendingSku', 'pendingCode', 'pendingPlate', 'basketReturn'].forEach(k => CTX.del(k));
      setTimeout(() => go(back), 600);
    }
  };
})();
