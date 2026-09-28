/* paste-order.js — 20: paste a Hiryu order page (PRD v3.3 A8.2, §13.2).
 *
 * The pasted text is read inside the paste event and never put in the box, so
 * nothing the customer wrote is ever on screen or in the page. hiryu-parse.js
 * keeps only the order fields; this screen shows them for a check against the
 * slip, and "Mulai ambil" sends exactly what the parser returned.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, region, setF, esc, bi, biAttr, applyLangTo, say, fail, go } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => {
    if (/^\[object/.test(String(m))) return en() ? 'The copy was not understood. Copy the page again.'
      : 'Salinan tidak dikenali. Salin ulang halamannya.';
    const p = String(m || '').split(' / ');
    return (en() ? p[1] : p[0]) || String(m);
  };

  function hubTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(en() ? 'en-GB' : 'id-ID', {
      timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  NJW.screens['paste-order'] = async () => {
    const site = W.site();
    const box = region('box'), preview = region('preview'), error = region('error'), done = region('done');
    let parsed = null, stores = [];
    try { stores = (await NJW.api.hiryu.stores()).stores || []; } catch (e) { /* the server checks anyway */ }

    function placeholder() {
      box.placeholder = en() ? box.dataset.phEn : box.dataset.phId;
    }
    placeholder();
    document.addEventListener('click', e => { if (e.target.closest('.lang__opt')) setTimeout(placeholder, 0); });

    function showError(id, enText, body) {
      error.hidden = false;
      bi(error.querySelector('[data-field="error-title"]'), id, enText);
      const b = error.querySelector('[data-field="error-body"]');
      if (body) bi(b, body[0], body[1]); else { b.textContent = ''; b.dataset.id = ''; b.dataset.en = ''; }
    }

    function reset() {
      parsed = null;
      preview.hidden = true; error.hidden = true; done.hidden = true;
      box.value = '';
      box.focus();
    }

    function show(p) {
      parsed = p;
      error.hidden = true; done.hidden = true; preview.hidden = false;
      setF('short-no', p.short_no);
      const st = stores.find(s => s.hiryu_store_no === p.store_no);
      const storeEl = $('[data-field="store"]');
      if (st && site && st.site_id !== site.id) {
        showError('Toko ini milik hub lain: ' + st.site_code, 'This store belongs to another hub: ' + st.site_code,
          ['Beri tahu SPV.', 'Tell the SPV.']);
      }
      storeEl.textContent = (st ? st.store_name : 'Store #' + p.store_no);
      bi($('[data-field="tick"]'),
        '✓ ' + p.declared_lines + ' baris · ' + p.declared_units + ' unit, cocok dengan Hiryu',
        '✓ ' + p.declared_lines + (p.declared_lines === 1 ? ' line' : ' lines') + ' · ' + p.declared_units +
          (p.declared_units === 1 ? ' unit' : ' units') + ', matches Hiryu');
      const t = p.scheduled_time
        ? ['Terjadwal ' + hubTime(p.scheduled_time), 'Scheduled ' + hubTime(p.scheduled_time)]
        : ['Masuk ' + hubTime(p.order_time), 'Placed ' + hubTime(p.order_time)];
      const acc = p.acceptance === 'MANUAL' ? [' · Terima manual', ' · Manual acceptance'] : ['', ''];
      bi($('[data-field="times"]'), t[0] + acc[0] + ' · ' + p.status, t[1] + acc[1] + ' · ' + p.status);
      region('lines').innerHTML = p.lines.map(l =>
        '<tr><td class="td-qty" style="text-align:left;width:70px">' + l.qty + '×</td>' +
        '<td>' + esc(l.item_name || '') + '<br><span class="note" style="font-family:var(--font-code);font-size:13px">' +
        esc(l.item_id) + '</span></td></tr>').join('');
      $('[data-action="send"]').focus();
    }

    function take(text) {
      // Drop the text as soon as it is read: box, clipboard copy in memory, all.
      box.value = '';
      try {
        show(NJW.hiryuParse.parseOrder(text));
      } catch (e) {
        preview.hidden = true; done.hidden = true;
        if (e instanceof NJW.hiryuParse.ParseError) showError(e.id, e.en);
        else showError('Salinan tidak dikenali.', 'The copy was not understood.');
      }
      text = null;
    }

    box.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      take(text);
    });
    // Typing or a drop that slipped past the paste event: read it, then clear.
    box.addEventListener('input', () => { if (box.value.length > 40) take(box.value); else box.value = ''; });
    box.addEventListener('drop', e => { e.preventDefault(); take(e.dataTransfer.getData('text')); });

    $('[data-action="clear"]').onclick = reset;

    let sending = false;
    $('[data-action="send"]').onclick = async () => {
      if (!parsed || sending) return;
      if (!site) return say(en() ? 'Choose a hub first.' : 'Pilih hub dulu.');
      sending = true;
      const body = Object.assign({ site_id: site.id, source: 'paste' }, parsed);
      try {
        const r = await NJW.api.hiryu.paste(body);
        preview.hidden = true;
        finished(r);
      } catch (e) {
        if (e.status === 401) return fail(e);
        if (/^\[object/.test(String(e.message))) {
          showError('Salinan tidak dikenali. Salin ulang halamannya.', 'The copy was not understood. Copy the page again.');
        } else {
          const p = e.message.split(' / ');
          showError(p[0], p[1] || p[0]);
        }
      } finally { sending = false; }
    };

    function finished(r) {
      done.hidden = false;
      const title = done.querySelector('[data-field="done-title"]');
      const body = done.querySelector('[data-field="done-body"]');
      const acts = region('done-actions');
      acts.innerHTML = '';
      const p = String(r.message || '').split(' / ');
      if (r.action === 'created') {
        bi(title, r.short_no + ' masuk antrean ambil', r.short_no + ' is in the pick queue');
        bi(body, 'Picker mengambilnya di HP. Kalau kamu sendirian, ambil sendiri sekarang.',
                 'The picker takes it on the phone. On your own? Pick it yourself now.');
        acts.innerHTML =
          '<button class="btn btn--primary btn--lg" type="button" data-act="pick" ' + biAttr('Ambil sendiri sekarang', 'Pick it myself now') + '>Ambil sendiri sekarang</button>' +
          '<button class="btn btn--lg" type="button" data-act="next" ' + biAttr('Tempel pesanan berikutnya', 'Paste the next order') + '>Tempel pesanan berikutnya</button>';
      } else if (r.action === 'open') {
        bi(title, 'Pesanan ' + r.short_no + ' sudah ada', 'Order ' + r.short_no + ' is already in the WMS');
        bi(body, 'Tidak perlu ditempel lagi.', 'No need to paste it again.');
        acts.innerHTML =
          '<a class="btn btn--primary btn--lg" href="21-pesanan-hub.html" ' + biAttr('Lihat pesanan hub', 'See the hub orders') + '>Lihat pesanan hub</a>' +
          '<button class="btn btn--lg" type="button" data-act="next" ' + biAttr('Tempel pesanan berikutnya', 'Paste the next order') + '>Tempel pesanan berikutnya</button>';
      } else if (r.action === 'confirm_cancel') {
        bi(title, r.short_no + ' dibatalkan di Hiryu', r.short_no + ' was cancelled in Hiryu');
        bi(body, 'Tekan tombol ini untuk melepas stoknya. Barang yang sudah diambil masuk Kembalikan ke rak.',
                 'Press this to release its stock. Units already picked go to Return to shelf.');
        acts.innerHTML =
          '<button class="btn btn--primary btn--lg" type="button" data-act="cancel" ' + biAttr('Dibatalkan di Hiryu', 'Cancelled in Hiryu') + '>Dibatalkan di Hiryu</button>' +
          '<button class="btn btn--lg" type="button" data-act="next" ' + biAttr('Batal', 'Back') + '>Batal</button>';
      } else {
        bi(title, p[0] || 'Selesai', p[1] || p[0] || 'Done');
        body.textContent = ''; body.dataset.id = ''; body.dataset.en = '';
        acts.innerHTML = '<button class="btn btn--lg" type="button" data-act="next" ' + biAttr('Tempel pesanan berikutnya', 'Paste the next order') + '>Tempel pesanan berikutnya</button>';
      }
      applyLangTo(done);
      acts.onclick = async (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'next') return reset();
        if (b.dataset.act === 'pick') {
          try { await NJW.api.hiryu.claim(r.pick_task_id); go('07-ambil-pesanan.html'); }
          catch (err) { say(oneLang(err.message)); }
        }
        if (b.dataset.act === 'cancel') {
          if (!confirm((en() ? 'Cancel ' : 'Batalkan ') + r.short_no + '?')) return;
          try { const x = await NJW.api.hiryu.cancelledInHiryu(r.order_id); say(oneLang(x.message)); reset(); }
          catch (err) { say(oneLang(err.message)); }
        }
      };
    }

    box.focus();
  };
})();
