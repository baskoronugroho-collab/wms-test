/* hub-orders.js — 21: Kemas & serah ke driver (PRD §6.4, §7, §8.2).
 *
 * Lists from GET /api/hiryu/active-orders, by stage:
 *
 *  - Siap dikemas: handed to the pack bench, not packed. Selesai dikemas asks
 *    for the GM number off the slip; the server checks it, records the pack
 *    and tells Hiryu the order is ready (message 4). Nobody presses Mark ready
 *    in Hiryu.
 *  - Menunggu driver: packed bags, with how long each has waited (amber after
 *    the handover_wait_minutes setting). Ya, sudah diambil driver records the
 *    handover; nothing goes to Hiryu.
 *  - Red Dibatalkan rows: a basket or bag whose order was cancelled before it
 *    left. Staff take it back to the pack bench and say so with one tap.
 *  - Belum sampai di meja packing: waiting for a picker or being picked.
 *
 * While the Hiryu link is off (paste still in use), Dibatalkan di Hiryu and the
 * paste link stay. With the link on, cancels arrive by themselves and both go.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { region, esc, biAttr, applyLangTo, say, fail } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };
  const POLL_MS = 5000;

  function mins(sec) { return Math.max(0, Math.floor((sec || 0) / 60)); }

  function remaining(iso) {
    if (!iso) return null;
    return Math.round((NJW.toDate ? NJW.toDate(iso) : new Date(iso + 'Z')) - Date.now()) / 1000;
  }

  function btn(act, o, id, enText, primary) {
    return '<button class="btn ' + (primary ? 'btn--primary btn--lg' : '') + '" type="button" data-act="' + act +
      '" data-order="' + o.order_id + '" data-no="' + esc(o.short_no) + '" ' + biAttr(id, enText) + '>' + esc(id) + '</button>';
  }

  function row(o, kind, limit, live) {
    let meta = '', acts = '', cls = 'ho';
    const units = kind === 'picking' ? o.units + ' / ' + o.units_ordered : String(o.units_ordered || o.units);
    if (o.cancelled) {
      cls += ' ho--cancel';
      const packedBag = !!o.marked_ready_at;
      meta = '<span class="ho__flag" ' + biAttr(
        packedBag ? 'Dibatalkan: jangan diserahkan ke driver' : 'Dibatalkan: jangan dikemas',
        packedBag ? 'Cancelled: do not hand it to the driver' : 'Cancelled: do not pack it') + '></span>';
      acts = packedBag
        ? btn('bench', o, 'Sudah dibawa kembali ke meja packing', 'Taken back to the pack bench', true)
        : btn('bench', o, 'Sudah disisihkan untuk dikembalikan ke rak', 'Set aside to go back to the shelf', true);
    } else if (kind === 'wait') {
      const late = o.waiting_seconds != null && o.waiting_seconds >= limit;
      if (late) cls += ' ho--late';
      const m = mins(o.waiting_seconds);
      meta = '<span ' + (late ? 'style="color:var(--caution);font-weight:700" ' : '') +
        biAttr('Menunggu driver ' + m + ' menit', 'Waiting for the driver ' + m + ' min') + '></span>';
      acts = btn('handed', o, 'Ya, sudah diambil driver', 'Yes, the driver took it', true);
    } else if (kind === 'pack') {
      const m = mins(o.pack_seconds);
      meta = '<span ' + biAttr('Menunggu dikemas ' + m + ' menit', 'Waiting to pack ' + m + ' min') + '></span>';
      acts = btn('pack', o, 'Selesai dikemas', 'Packed', true);
    } else {
      const left = remaining(o.promised_at);
      const m = left == null ? null : Math.round(left / 60);
      const who = o.stage === 'waiting'
        ? '<span ' + biAttr('Menunggu picker', 'Waiting for a picker') + '></span> · '
        : (o.picker ? esc(o.picker) + ' · ' : '');
      meta = who + (m == null ? '' : m >= 0
        ? '<span ' + biAttr('Siap paling lambat ' + m + ' menit lagi', 'Ready within ' + m + ' min') + '></span>'
        : '<span style="color:var(--caution);font-weight:700" ' + biAttr('Terlambat ' + (-m) + ' menit', (-m) + ' min late') + '></span>');
    }
    if (!live && !o.cancelled) acts += btn('cancel', o, 'Dibatalkan di Hiryu', 'Cancelled in Hiryu', false);
    return '<div class="' + cls + '" data-row="' + o.order_id + '">' +
      '<span class="ho__no">' + esc(o.short_no) + '</span>' +
      '<span class="ho__meta"><span>' + esc(o.store_name || '') + (o.store_name ? ' · ' : '') + units + ' unit</span>' +
      '<span class="ho__steps">' + meta + '</span></span>' +
      '<span class="ho__acts">' + acts + '</span></div>';
  }

  function empty(id, enText) {
    return '<span class="note" ' + biAttr(id, enText) + '>' + esc(id) + '</span>';
  }

  NJW.screens['hub-orders'] = async () => {
    const site = W.site();
    if (!site) return;
    const main = document.querySelector('.main');
    let editing = false;   // a GM number being typed: do not repaint under the packer

    async function load() {
      if (editing) return;
      const r = await NJW.api.raw.get('/hiryu/active-orders?site_id=' + site.id);
      const limit = r.wait_limit_seconds;
      const live = !!r.link_live;
      document.querySelectorAll('[data-paste-only]').forEach(el => { el.hidden = live; });
      const cancelledAtBench = r.orders.filter(o => o.cancelled && !o.marked_ready_at);
      const cancelledBags = r.orders.filter(o => o.cancelled && o.marked_ready_at);
      const pack = r.orders.filter(o => o.stage === 'to_pack');
      const wait = r.orders.filter(o => o.stage === 'to_driver');
      const picking = r.orders.filter(o => o.stage === 'waiting' || o.stage === 'picking');
      region('pack').innerHTML =
        cancelledAtBench.map(o => row(o, 'pack', limit, live)).join('') +
        pack.map(o => row(o, 'pack', limit, live)).join('') ||
        empty('Belum ada yang perlu dikemas.', 'Nothing to pack yet.');
      region('wait').innerHTML =
        cancelledBags.map(o => row(o, 'wait', limit, live)).join('') +
        wait.map(o => row(o, 'wait', limit, live)).join('') ||
        empty('Tidak ada tas yang menunggu driver.', 'No bags waiting for a driver.');
      region('picking').innerHTML = picking.map(o => row(o, 'picking', limit, live)).join('') ||
        empty('Tidak ada pesanan yang sedang diambil.', 'No orders being picked.');
      applyLangTo(main);
    }

    /* Selesai dikemas: the packer types the GM number off the slip. The
       server compares it (GM-358, gm358 and 358 all match), so a bag with the
       wrong slip is caught here, not at the driver. */
    function askGm(b) {
      const acts = b.closest('.ho__acts');
      editing = true;
      acts.innerHTML =
        '<input class="ho__gm" inputmode="text" autocomplete="off" aria-label="GM" placeholder="GM-">' +
        '<button class="btn btn--primary btn--lg" type="button" data-act="packed" data-order="' + b.dataset.order +
          '" data-no="' + esc(b.dataset.no) + '" ' + biAttr('Konfirmasi', 'Confirm') + '></button>' +
        '<button class="btn" type="button" data-act="unpack-cancel" ' + biAttr('Batal', 'Back') + '></button>' +
        '<span class="note" style="flex-basis:100%" ' + biAttr('Ketik nomor GM yang tertulis di slip Hiryu.',
          'Type the GM number printed on the Hiryu slip.') + '></span>';
      applyLangTo(acts);
      const input = acts.querySelector('input');
      input.focus();
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') acts.querySelector('[data-act="packed"]').click();
      });
    }

    main.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const id = +b.dataset.order, no = b.dataset.no;
      const act = b.dataset.act;
      try {
        if (act === 'pack') return askGm(b);
        if (act === 'unpack-cancel') { editing = false; return load(); }
        if (act === 'packed') {
          const gm = (b.closest('.ho__acts').querySelector('input') || {}).value || '';
          if (!gm.trim()) return say(en() ? 'Type the GM number from the slip.' : 'Ketik nomor GM dari slip.');
          b.disabled = true;
          await NJW.api.raw.post('/hiryu/orders/' + id + '/packed', { gm_number: gm.trim() });
          editing = false;
          say(en() ? no + ' packed. Hiryu is told it is ready. Take the bag to the ready shelf.'
                   : no + ' selesai dikemas. Hiryu diberi tahu pesanan siap. Bawa tasnya ke rak siap ambil.');
        } else if (act === 'handed') {
          if (!confirm(en() ? 'Does the order number the driver gave match ' + no + '?'
                            : 'Nomor pesanan dari driver sama dengan ' + no + '?')) return;
          b.disabled = true;
          await NJW.api.raw.post('/hiryu/orders/' + id + '/handed-over', {});
          say(en() ? no + ' handed over.' : no + ' sudah diserahkan.');
        } else if (act === 'bench') {
          b.disabled = true;
          await NJW.api.raw.post('/hiryu/orders/' + id + '/back-to-bench', {});
          say(en() ? no + ': unpack it and return the units to the shelf.'
                   : no + ': bongkar, lalu kembalikan barangnya ke rak.');
        } else if (act === 'cancel') {
          if (!confirm(en() ? 'Is ' + no + ' CANCELLED in Hiryu? The WMS will release it.'
                            : 'Apakah ' + no + ' CANCELLED di Hiryu? WMS akan melepasnya.')) return;
          b.disabled = true;
          const r = await NJW.api.raw.post('/hiryu/orders/' + id + '/cancelled-in-hiryu', {});
          say(oneLang(r.message));
        }
      } catch (err) {
        if (err.status === 401) return fail(err);
        b.disabled = false;
        say(oneLang(err.message));
        // A wrong GM number keeps the box open to type again; anything else
        // (cancelled meanwhile, already packed) repaints from the server.
        if (act === 'packed' && err.status === 422) return;
        editing = false;
      }
      load().catch(() => {});
    });

    try { await load(); } catch (e) { fail(e); }
    setInterval(() => { if (!document.hidden) load().catch(() => {}); }, POLL_MS);
  };
})();
