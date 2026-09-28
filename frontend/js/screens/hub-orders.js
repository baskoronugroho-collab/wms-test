/* hub-orders.js — 21: pack and hand over (PRD v3.3 A8.4, A8.5, A9.3).
 *
 * Three lists from GET /api/hiryu/active-orders: picked and waiting to pack,
 * packed and waiting for the driver, still being picked. Every tap here comes
 * AFTER the same action in Hiryu (Hiryu first, §2.12): Mark ready there, then
 * Sudah Mark ready di Hiryu here; Cancel there, then Dibatalkan di Hiryu here.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { region, esc, biAttr, applyLangTo, say, fail } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  function mins(sec) { return Math.max(0, Math.floor((sec || 0) / 60)); }

  function remaining(iso) {
    if (!iso) return null;
    return Math.round((NJW.toDate ? NJW.toDate(iso) : new Date(iso + 'Z')) - Date.now()) / 1000;
  }

  function btn(act, o, id, enText, primary) {
    return '<button class="btn ' + (primary ? 'btn--primary btn--lg' : '') + '" type="button" data-act="' + act +
      '" data-order="' + o.order_id + '" data-no="' + esc(o.short_no) + '" ' + biAttr(id, enText) + '>' + esc(id) + '</button>';
  }

  function row(o, kind, limit) {
    const late = kind === 'wait' && o.waiting_seconds != null && o.waiting_seconds >= limit;
    let meta;
    if (kind === 'wait') {
      const m = mins(o.waiting_seconds);
      meta = '<span ' + biAttr('Menunggu ' + m + ' menit', 'Waiting ' + m + ' min') + '></span>';
    } else {
      const left = remaining(o.promised_at);
      const m = left == null ? null : Math.round(left / 60);
      meta = m == null ? '' : m >= 0
        ? '<span ' + biAttr('Siap paling lambat ' + m + ' menit lagi', 'Ready within ' + m + ' min') + '></span>'
        : '<span style="color:var(--caution);font-weight:700" ' + biAttr('Terlambat ' + (-m) + ' menit', (-m) + ' min late') + '></span>';
    }
    const units = kind === 'picking' ? o.units + ' / ' + o.units_ordered : String(o.units_ordered || o.units);
    let acts = '';
    if (kind === 'pack') acts = btn('ready', o, 'Sudah Mark ready di Hiryu', 'Marked ready in Hiryu', true);
    if (kind === 'wait') acts = btn('handed', o, 'Ya, sudah diambil driver', 'Yes, the driver took it', true);
    acts += btn('cancel', o, 'Dibatalkan di Hiryu', 'Cancelled in Hiryu', false);
    return '<div class="ho' + (late ? ' ho--late' : '') + '">' +
      '<span class="ho__no">' + esc(o.short_no) + '</span>' +
      '<span class="ho__meta"><span>' + esc(o.store_name || '') + ' · ' + units + ' unit</span>' +
      '<span class="ho__steps">' + meta + '</span></span>' +
      '<span class="ho__acts">' + acts + '</span></div>';
  }

  function empty(id, enText) {
    return '<span class="note" ' + biAttr(id, enText) + '>' + esc(id) + '</span>';
  }

  NJW.screens['hub-orders'] = async () => {
    const site = W.site();
    if (!site) return;

    async function load() {
      const r = await NJW.api.hiryu.activeOrders(site.id);
      const limit = r.wait_limit_seconds;
      const picked = o => o.task_status === 'completed' || (o.units_ordered > 0 && o.units >= o.units_ordered);
      const wait = r.orders.filter(o => o.marked_ready_at);
      const pack = r.orders.filter(o => !o.marked_ready_at && picked(o));
      const picking = r.orders.filter(o => !o.marked_ready_at && !picked(o));
      region('pack').innerHTML = pack.map(o => row(o, 'pack', limit)).join('') ||
        empty('Belum ada yang perlu dikemas.', 'Nothing to pack yet.');
      region('wait').innerHTML = wait.map(o => row(o, 'wait', limit)).join('') ||
        empty('Tidak ada tas yang menunggu driver.', 'No bags waiting for a driver.');
      region('picking').innerHTML = picking.map(o => row(o, 'picking', limit)).join('') ||
        empty('Tidak ada pesanan yang sedang diambil.', 'No orders being picked.');
      applyLangTo(document.querySelector('.main'));
    }

    document.querySelector('.main').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const id = +b.dataset.order, no = b.dataset.no;
      const api = NJW.api.hiryu;
      try {
        if (b.dataset.act === 'ready') {
          if (!confirm(en() ? 'Did you press Mark ready in Hiryu for ' + no + '?'
                            : 'Sudah tekan Mark ready di Hiryu untuk ' + no + '?')) return;
          b.disabled = true;
          await api.markedReady(id);
          say(en() ? no + ' packed. Put the bag on the ready shelf.' : no + ' siap. Taruh tasnya di rak siap ambil.');
        } else if (b.dataset.act === 'handed') {
          if (!confirm(en() ? 'Does the driver\'s order number match ' + no + '?'
                            : 'Nomor pesanan driver sama dengan ' + no + '?')) return;
          b.disabled = true;
          await api.handedOver(id);
          say(en() ? no + ' handed over.' : no + ' sudah diserahkan.');
        } else if (b.dataset.act === 'cancel') {
          if (!confirm(en() ? 'Is ' + no + ' CANCELLED in Hiryu? The WMS will release it.'
                            : 'Apakah ' + no + ' CANCELLED di Hiryu? WMS akan melepasnya.')) return;
          b.disabled = true;
          const r = await api.cancelledInHiryu(id);
          say(oneLang(r.message));
        }
      } catch (err) {
        if (err.status === 401) return fail(err);
        say(oneLang(err.message));
      }
      load().catch(() => {});
    });

    try { await load(); } catch (e) { fail(e); }
    setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 10000);
  };
})();
