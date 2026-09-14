/* pick-done.js — 09: every line picked; hand the tote to packing.
 *
 * Replaces the wire.js `pick-done` handler. The order is completed HERE, on
 * the hand-off, not the moment the last unit is scanned: completing sends
 * message 4 (Order ready) to Hiryu, which tells the rider and the customer the
 * bag is ready — so it goes when the tote is actually on the packing bench.
 *
 * "Pick the next order" stays locked until the hand-off is done. Otherwise an
 * order with everything picked would sit claimed and unfinished, invisible to
 * the queue, while its promise ran out.
 *
 * Rows are pick lines (stops): a SKU split over rack and overflow shows twice,
 * once per location, which is how it was actually walked.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, esc, bi, biAttr, applyLangTo, say, fail, go, CTX } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  // Server guard messages arrive as "Indonesian / English".
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  NJW.screens['pick-done'] = async () => {
    const done = CTX.get('doneTask');
    const main = $('.main');
    const banner = $('.banner--accept');

    if (!done || !done.task) {
      if (banner) banner.style.display = 'none';
      if (main) {
        main.innerHTML =
          '<div class="emptystate">' +
          '<span class="emptystate__title" ' + biAttr('Tidak ada pesanan yang baru selesai',
            'No order has just been finished') + '>Tidak ada pesanan yang baru selesai</span>' +
          '<span class="emptystate__body" ' + biAttr('Layar ini muncul setelah semua barang pesanan diambil.',
            'This screen appears once every item in an order is picked.') +
          '>Layar ini muncul setelah semua barang pesanan diambil.</span>' +
          '<a class="btn btn--primary btn--lg" href="07-ambil-pesanan.html" ' +
          biAttr('Ambil pesanan', 'Pick an order') + '>Ambil pesanan</a></div>';
        applyLangTo(main);
      }
      return;
    }

    const task = done.task;
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Ambil pesanan · ' + task.external_ref, 'Pick order · ' + task.external_ref); }
    const bannerRef = banner && $('.code', banner);
    if (bannerRef) bannerRef.textContent = task.external_ref;

    /* ---- what was picked ---- */
    const lines = task.lines;
    const units = lines.reduce((n, l) => n + (l.qty_picked || 0), 0);
    const places = new Set(lines.map(l => l.location_code).filter(Boolean)).size;
    // Short is counted in units: with a split, one stop can be short while the
    // other stop for the same SKU made up part of it.
    const shortUnits = lines.reduce((n, l) => n + Math.max(0, l.qty_required - l.qty_picked), 0);

    const tbody = $('.table tbody');
    if (tbody) {
      tbody.innerHTML = lines.map(l => {
        const short = l.qty_picked < l.qty_required;
        return '<tr><td class="td-code">' + esc(l.location_code || '—') + '</td>' +
          '<td>' + esc(l.sku_name) +
          (short ? ' <span style="color:var(--caution);font-weight:700" ' +
            biAttr('· kurang ' + (l.qty_required - l.qty_picked),
                   '· short ' + (l.qty_required - l.qty_picked)) + '></span>' : '') + '</td>' +
          '<td class="td-qty" style="white-space:nowrap">' + l.qty_picked + (short ? ' / ' + l.qty_required : '') + '</td></tr>';
      }).join('');
      applyLangTo(tbody);
    }

    // Duration from the moment this picker took the order, when we know it.
    let dur = null;
    if (done.startedAt && done.finishedAt) {
      const s = Math.max(0, Math.round((new Date(done.finishedAt) - new Date(done.startedAt)) / 1000));
      dur = [Math.floor(s / 60), s % 60];
    }
    const eyebrow = $('.main .eyebrow');
    bi(eyebrow,
       units + ' barang · ' + places + ' keranjang' + (dur ? ' · ' + dur[0] + ' menit ' + dur[1] + ' detik' : ''),
       units + ' items · ' + places + (places === 1 ? ' basket' : ' baskets') +
         (dur ? ' · ' + dur[0] + ' min ' + dur[1] + ' s' : ''));

    /* Short lines were already reported (message 5) when they were declared.
       Say so, and say who decides — the station never substitutes. */
    if (shortUnits && tbody && !$('.wire-shortnote')) {
      const note = document.createElement('div');
      note.className = 'notice notice--caution wire-shortnote';
      note.innerHTML = '<span class="code code--sm" aria-hidden="true">!</span>' +
        '<div class="col" style="gap:4px"><span class="notice__title" ' +
        biAttr(shortUnits + ' barang kurang — Hiryu sudah diberi tahu',
               shortUnits + (shortUnits === 1 ? ' unit' : ' units') + ' short — Hiryu has been told') + '></span>' +
        '<span class="notice__body" ' +
        biAttr('Hiryu yang memutuskan untuk pelanggan: refund, kirim sebagian, atau barang pengganti. Kemas yang ada saja.',
               'Hiryu decides for the customer: refund, partial delivery or a substitute. Pack only what is here.') +
        '></span></div>';
      tbody.closest('table').parentNode.insertBefore(note, tbody.closest('table'));
      applyLangTo(note);
    }

    /* ---- the ticket: the order reference is what packing calls out ---- */
    const ticket = $('.panel .code');
    if (ticket) {
      ticket.textContent = task.external_ref;
      ticket.style.fontSize = task.external_ref.length > 10 ? '30px' : '56px';
      ticket.style.overflowWrap = 'anywhere';
    }
    const ticketLabel = $('.panel .eyebrow');
    bi(ticketLabel, 'Nomor pesanan untuk packing', 'Order number for packing');

    /* ---- hand-off = message 4 ---- */
    const handoff = $('button.btn--primary');
    const next = $('a.btn--outline[href="07-ambil-pesanan.html"]');

    function lockNext(locked) {
      if (!next) return;
      next.classList.toggle('is-locked', locked);
      next.setAttribute('aria-disabled', String(locked));
      if (!locked) { next.classList.remove('btn--outline'); next.classList.add('btn--primary'); }
    }

    function paintHanded() {
      if (handoff) {
        handoff.disabled = true;
        handoff.classList.add('is-locked');
        bi(handoff, '✓ Sudah diserahkan — Hiryu diberi tahu', '✓ Handed off — Hiryu has been told');
      }
      const note = $('.panel .note');
      bi(note, 'Pesanan siap dikirim. Biarkan keranjang di meja packing.',
               'The order is ready to go. Leave the tote on the packing bench.');
      lockNext(false);
    }

    if (next) next.addEventListener('click', (e) => {
      if (next.classList.contains('is-locked')) {
        e.preventDefault();
        say(en()
          ? 'Hand the tote to packing first.' : 'Serahkan dulu ke meja packing.');
      } else {
        CTX.del('doneTask');
      }
    });

    if (done.handed) { paintHanded(); return; }
    lockNext(true);

    let sending = false;
    if (handoff) handoff.onclick = async () => {
      if (sending) return;
      sending = true;
      try {
        await NJW.api.raw.post('/pick-tasks/' + task.id + '/complete', {});
        done.handed = true;
        CTX.set('doneTask', done);
        paintHanded();
        say(localStorage.getItem('njw.lang') === 'en'
          ? 'Order ready — Hiryu has been told.' : 'Pesanan siap — Hiryu sudah diberi tahu.');
      } catch (e) {
        if (e.status !== 409) return fail(e);
        const msg = oneLang(e.message);
        if (/already done|sudah selesai/i.test(e.message)) {
          // Someone (or an earlier tap) already completed it: message 4 went.
          done.handed = true;
          CTX.set('doneTask', done);
          paintHanded();
          say(msg);
        } else if (/still to be picked|belum diambil/i.test(e.message)) {
          // The server knows of a stop this screen does not (e.g. a stale
          // snapshot). Back to the pick screen, which reloads the order.
          say(msg);
          bi(handoff, 'Kembali ambil barang yang tersisa', 'Go back and pick what is left');
          handoff.onclick = () => { CTX.del('doneTask'); go('07-ambil-pesanan.html'); };
        } else if (/cancel|batal/i.test(e.message)) {
          // Hiryu cancelled while it was being picked. Nothing to hand off;
          // the picked units are already on the return-to-shelf list.
          say(msg);
          handoff.disabled = true;
          handoff.classList.add('is-locked');
          bi(handoff, 'Dibatalkan — barangnya masuk daftar Kembalikan ke rak',
                      'Cancelled — its units are on the Return-to-shelf list');
          lockNext(false);
        } else {
          say(msg);
        }
      } finally { sending = false; }
    };
  };
})();
