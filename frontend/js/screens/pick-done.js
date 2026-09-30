/* pick-done.js — 09: every unit picked; hand the basket to the pack bench.
 *
 * Deploy 2 (PRD §6.3 step 5, §6.11): Serahkan ke meja packing completes the
 * pick task ("Waiting to pack") and frees the picker, who goes straight back
 * to Ambil pesanan, where the WMS gives the next order or they wait. Nothing
 * goes to Hiryu from here: the packer's Selesai dikemas sends order ready.
 * There is no Mark ready step for the picker any more.
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
    const no = task.short_no || task.external_ref;
    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, 'Ambil pesanan · ' + no, 'Pick order · ' + no); }
    const bannerRef = banner && $('.code', banner);
    if (bannerRef) bannerRef.textContent = no;

    /* ---- what was picked ---- */
    const lines = task.lines;
    const units = lines.reduce((n, l) => n + (l.qty_picked || 0), 0);
    const places = new Set(lines.map(l => l.location_code).filter(Boolean)).size;

    const tbody = $('.table tbody');
    if (tbody) {
      tbody.innerHTML = lines.map(l =>
        '<tr><td class="td-code">' + esc(l.location_code || '') + '</td>' +
        '<td>' + esc(l.sku_name) + '</td>' +
        '<td class="td-qty" style="white-space:nowrap">' + l.qty_picked + '</td></tr>').join('');
    }

    // Duration from the moment this phone opened the order, when we know it.
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

    /* ---- the number the pack bench works by ---- */
    const ticket = $('.panel .code');
    if (ticket) {
      ticket.textContent = no;
      ticket.style.fontSize = no.length > 10 ? '30px' : '56px';
      ticket.style.overflowWrap = 'anywhere';
    }
    const ticketLabel = $('.panel .eyebrow');
    bi(ticketLabel, 'Nomor pesanan untuk packing', 'Order number for packing');

    /* ---- hand-off, then straight back to waiting ---- */
    const handoff = $('button.btn--primary');
    function back(ms) {
      CTX.del('doneTask');
      setTimeout(() => go('07-ambil-pesanan.html'), ms);
    }
    function closeButton(id, enText) {
      if (!handoff) return;
      handoff.disabled = true;
      handoff.classList.add('is-locked');
      bi(handoff, id, enText);
    }

    let sending = false;
    if (handoff) handoff.onclick = async () => {
      if (sending) return;
      sending = true;
      try {
        await NJW.api.raw.post('/pick-tasks/' + task.id + '/complete', {});
        closeButton('Sudah diserahkan ke meja packing', 'Handed to the pack bench');
        say(en() ? no + ' is at the pack bench. Next order...' : no + ' di meja packing. Pesanan berikutnya...');
        back(900);
      } catch (e) {
        if (e.status !== 409) { sending = false; return fail(e); }
        const msg = oneLang(e.message);
        say(msg);
        if (/already done|sudah selesai/i.test(e.message)) {
          // An earlier tap already went through.
          closeButton('Sudah diserahkan ke meja packing', 'Handed to the pack bench');
          back(1500);
        } else if (/still to be picked|belum diambil/i.test(e.message)) {
          // The server knows of a stop this screen does not. Back to the pick.
          bi(handoff, 'Kembali ambil barang yang tersisa', 'Go back and pick what is left');
          handoff.onclick = () => back(0);
          sending = false;
        } else {
          // Cancelled from Hiryu, or moved by the SPV, while it was picked.
          // Picked units of a cancelled order are already on Kembalikan ke rak.
          closeButton(/cancel|batal/i.test(e.message)
            ? 'Dibatalkan: barangnya masuk Kembalikan ke rak' : 'Pesanan ini sudah dipindahkan',
            /cancel|batal/i.test(e.message)
            ? 'Cancelled: its units are on Return to shelf' : 'This order was moved');
          back(3500);
        }
      }
    };
  };
})();
