/* label-bound.js — 06: this sticker is already on another product. Stop.
 *
 * No override: the only way forward is a fresh sticker. The screen names the
 * product the sticker already belongs to, read from the plate itself, so the
 * person can see it is not a scanner glitch.
 *
 * Replaces the wire.js 'label-bound' handler.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, say, fail, go, CTX } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  NJW.screens['label-bound'] = async () => {
    const code = CTX.get('boundPlate');
    if (!code) return go('05-label-unit.html');
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; W.bi(mode, 'Label unit · Mode B', 'Unit labelling · Mode B'); }
    const codeEl = $('.blocked .code--lg');
    if (codeEl) codeEl.textContent = code;

    const img = $('.product__photo');
    const meta = $('.product__meta');
    const name = $('.product__name');
    if (img) { img.dataset.photoKey = ''; img.alt = ''; }
    if (meta) meta.textContent = '';
    if (name) name.textContent = '—';

    try {
      const p = await api.raw.get('/plates/' + encodeURIComponent(code));
      // The same sticker scanned twice on the product being labelled is a
      // double scan, not a wrong label: the unit is already counted.
      const locked = CTX.get('labelSku');
      if (locked && p.sku_id === locked.id) {
        CTX.del('boundPlate');
        say(t('Stiker ini sudah tercatat untuk produk ini. Lanjut ke unit berikutnya.',
              'This sticker is already recorded for this product. Carry on with the next unit.'));
        return setTimeout(() => go('05-label-unit.html'), 1800);
      }
      if (name) name.textContent = p.sku_name || '—';
      if (meta) meta.textContent = p.location_code || '';
      if (p.sku_id && p.sku_name) {
        // The plate carries only the name; the product card also wants the
        // brand, size and code, so look the SKU up by that name.
        const r = await api.skus({ q: p.sku_name, limit: 10 }).catch(() => null);
        const sku = r && r.skus.find(s => s.id === p.sku_id);
        if (sku) {
          if (meta) meta.textContent = [sku.brand_code, sku.unit_size, sku.brand_sku_code, p.location_code]
            .filter(Boolean).join(' · ');
          if (img) { img.dataset.photoKey = (sku.photo_key || sku.brand_sku_code || '').toLowerCase(); img.alt = sku.name_display; }
          if (NJW.paintPhotos) NJW.paintPhotos();
        }
      }
    } catch (e) {
      if (e.status === 401) return fail(e);
      /* the stop message stands on its own */
    }

    $$('a.btn').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); CTX.del('boundPlate'); go('05-label-unit.html'); };
    });
    const sup = $('.stats button.btn--outline');
    if (sup) sup.onclick = () => say(t(
      'Tunjukkan layar ini ke supervisor. Sisihkan unit itu sampai diperiksa.',
      'Show this screen to your supervisor. Set the unit aside until it is checked.'));
  };
})();
