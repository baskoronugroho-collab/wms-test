/* counting — screen 11: count one basket, blind.
 *
 * Every unit is scanned; the server keeps the scanned tally. The stepper and
 * keypad are the fallback for a unit whose barcode will not read — they move
 * the same big number, and the difference from the scanned tally is sent as a
 * manual count, so a supervisor can tell a scanned count from a typed one
 * (count_method on the session).
 *
 * The expected quantity is never on this screen. The claim response carries
 * `expected_plates` for unit-label SKUs, which IS the expected quantity; it is
 * deliberately never read here.
 *
 * Replaces the wire.js counting handler (pre-v3 markup, keypad only, no scans).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, bi, fail, go, key, CTX } = W;
  const tx = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);

  NJW.screens.counting = async () => {
    const s = CTX.get('session');
    if (!s) return go('10-hitung-pilih-keranjang.html');

    const mode = $('.chrome__mode');
    if (mode) {
      mode.dataset.keep = '1';
      bi(mode, 'Hitung stok · ' + s.location_code, 'Stock count · ' + s.location_code);
    }
    const loc = field('location');
    if (loc) loc.innerHTML = W.codeHtml(s.location_code);
    const img = $('.product__photo');
    if (img) { img.dataset.photoKey = s.photo_key || ''; img.alt = s.sku_name || ''; }
    const name = field('sku-name');
    if (name) name.textContent = s.sku_name || '—';
    if (NJW.paintPhotos) NJW.paintPhotos();

    // Brand · size · code, so a 07 is not counted as an 08. Nice to have only.
    if (s.sku_name) {
      NJW.api.skus({ q: s.sku_name, limit: 20 }).then(r => {
        const sku = r.skus.find(x => x.id === s.sku_id);
        const meta = field('meta');
        if (sku && meta) meta.textContent =
          [sku.brand_code, sku.unit_size, sku.brand_sku_code].filter(Boolean).join(' · ');
      }).catch(() => {});
    }

    /* Local state survives a reload of this page, and a resumed claim carries
       the server's scanned tally; the larger of the two wins. */
    const store = 'count.' + s.id;
    const saved = CTX.get(store) || {};
    let scanned = Math.max(s.qty_counted || 0, saved.scanned || 0);
    let extra = saved.extra || 0;       // units added or removed by hand
    let typed = '';

    const out = field('count');
    const split = field('count-split');
    const total = () => Math.max(0, Math.min(999, scanned + extra));

    function paint() {
      if (out) out.textContent = String(total());
      const manual = total() - scanned;
      const m = manual ? ' · ' + (manual > 0 ? '+' : '−') + Math.abs(manual) + ' manual' : '';
      bi(split, scanned + ' dipindai' + m, scanned + ' scanned' + m);
      CTX.set(store, { scanned, extra });
      disarm();
    }
    const setTotal = n => { extra = Math.max(0, Math.min(999, n)) - scanned; paint(); };

    const inc = $('[data-action="inc"]'), dec = $('[data-action="dec"]');
    if (inc) inc.onclick = () => { typed = ''; setTotal(total() + 1); };
    if (dec) dec.onclick = () => { typed = ''; setTotal(total() - 1); };
    $$('.keypad__key').forEach(k => k.onclick = () => {
      const v = k.dataset.key;
      if (v === 'del') typed = typed.slice(0, -1);
      else if (v === 'zero') typed = '0';
      else typed = (typed + v).slice(0, 3);
      setTotal(+(typed || 0));
    });

    /* ---- scanning ---- */
    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;

    async function doScan(code) {
      try {
        const r = await NJW.api.raw.post('/opname/sessions/' + s.id + '/scan',
          { code, idempotency_key: key() });
        if (r.outcome === 'counted' || r.outcome === 'out_of_place') {
          scanned = r.qty_counted;
          typed = '';
          paint();
          zone.accept(tx('Dihitung', 'Counted'), r.outcome === 'out_of_place'
            ? tx('Terdaftar di keranjang lain — tetap dihitung, dan dicatat.',
                 'Registered to another basket — counted, and noted.')
            : (s.sku_name || ''));
        } else if (r.outcome === 'foreign_item') {
          // Recorded server-side, not counted. Red, because this unit does
          // not belong here; the person has to set it aside.
          const other = (String(r.message).match(/^Barang lain: (.*) — dicatat\.$/) || [])[1];
          zone.reject(tx('Barang lain — tidak dihitung', 'Different product — not counted'),
            (other ? other + '. ' : '') +
            tx('Sisihkan barang ini. Sudah dicatat untuk supervisor.',
               'Set it aside. It has been noted for the supervisor.'));
        } else {
          zone.reject(tx('Barcode tidak dikenal — tidak dihitung', 'Unknown barcode — not counted'),
            tx('Sudah dicatat. Kalau barangnya memang ini, tambah pakai tombol +.',
               'Noted. If it really is this product, add it with the + button.'));
        }
      } catch (e) {
        if (e.status === 401) return fail(e);
        zone.reject(tx('Gagal', 'Failed'), e.message);
      }
    }
    if (zone) { zone.onScan(doScan); W.testCodes(zoneEl, doScan); }

    /* ---- save: two taps, and the check happens BEFORE the reveal ----
       Asking "check again?" after showing the system number would defeat the
       blind count, so the only recount prompt is this one, shown to everyone
       before anything is revealed. */
    const save = $('[data-action="save"]');
    const note = field('blind-note');
    const noteText = note ? [note.dataset.id, note.dataset.en] : null;
    let armed = false, busy = false;

    function disarm() {
      if (!armed) return;
      armed = false;
      bi(save, 'Simpan hitungan', 'Save count');
      if (note) { bi(note, noteText[0], noteText[1]); note.style.color = ''; note.style.boxShadow = ''; }
    }

    if (save) {
      save.removeAttribute('href');
      save.onclick = async (e) => {
        e.preventDefault();
        if (busy) return;
        if (!armed) {
          armed = true;
          bi(save, 'Ya, simpan ' + total(), 'Yes, save ' + total());
          if (note) {
            bi(note, 'Sudah cek belakang keranjang dan keranjang sebelahnya? Setelah disimpan, hitungan tidak bisa diubah.',
                     'Checked the back of the basket and the one next to it? Once saved, the count cannot be changed.');
            note.style.color = 'var(--caution)';
            note.style.boxShadow = 'inset 5px 0 0 var(--caution), var(--shadow-1)';
          }
          return;
        }
        busy = true;
        try {
          // A count that was never touched by hand stays a scanned count.
          const body = total() === scanned ? {} : { manual_qty: total() };
          const r = await NJW.api.raw.post('/opname/sessions/' + s.id + '/finish', body);
          if (r.needs_recount) {
            // First mismatch: the server has reset the tally and revealed
            // nothing (PRD 11.2.5). Start again from zero, still blind.
            scanned = 0; extra = 0; typed = ''; busy = false;
            paint();
            if (note) {
              bi(note, 'Belum cocok. Hitung ulang keranjang ini sekali lagi dari awal — pindai setiap barang.',
                       'Not matching yet. Count this basket once more from the start — scan every unit.');
              note.style.color = 'var(--caution)';
              note.style.boxShadow = 'inset 5px 0 0 var(--caution), var(--shadow-1)';
            }
            if (zone) zone.reject(tx('Hitung ulang', 'Recount'),
              tx('Mulai lagi dari nol.', 'Start again from zero.'));
            return;
          }
          CTX.set('result', Object.assign({}, r,
            { session_id: s.id, location_code: s.location_code, sku_name: s.sku_name }));
          CTX.del(store);
          CTX.del('session');
          go('12-hasil-hitung.html');
        } catch (err) { busy = false; disarm(); fail(err); }
      };
    }

    // Skipping releases the claim, so someone else can count this basket.
    const skip = $('a.btn--outline');
    if (skip) {
      skip.href = '10-hitung-pilih-keranjang.html';
      skip.onclick = async (e) => {
        e.preventDefault();
        try { await NJW.api.raw.post('/opname/sessions/' + s.id + '/release', {}); } catch (err) { /* the list still shows it */ }
        CTX.del(store);
        CTX.del('session');
        go('10-hitung-pilih-keranjang.html');
      };
    }

    paint();
  };
})();
