/* home.js — the station menu.
 *
 * Replaces the wire.js `home` handler. The supervisor redirect is unchanged;
 * what is new is that every count on a card is live or absent: the pick card
 * names how many orders are already late (the queue runs on time remaining,
 * not age), the count card says when there is nothing to count, and the
 * return card counts units waiting to go back to the shelf.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, bi, go, CTX } = W;
  const api = () => NJW.api;

  NJW.screens.home = async () => {
    const me = W.me(), site = W.site();

    /* The root lands on the Station app, which is right for the people who use
       it all day and wrong for a supervisor or admin, whose surface is the
       console. Send them there, but never trap them: arriving from the
       console's own "open station app" link, or with ?station, is an explicit
       choice and is remembered for the session. */
    const params = new URLSearchParams(location.search);
    const fromConsole = document.referrer.includes('/console/');
    if (params.has('station') || fromConsole) CTX.set('preferStation', true);
    if (me.role && ['admin', 'supervisor'].includes(me.role) && !CTX.get('preferStation')) {
      return go('console/index.html');
    }
    if (!site) return;

    const card = href => $('.main > nav.home a.home__card[href="' + href + '"] .note');
    const pickNote = card('07-ambil-pesanan.html');
    const countNote = card('10-hitung-pilih-keranjang.html');
    const returnNote = card('18-kembalikan.html');

    const [board, plans, returns] = await Promise.all([
      api().pickBoard({ site_id: site.id }).catch(() => null),
      api().opnamePlans({ site_id: site.id, limit: 1 }).catch(() => null),
      api().returns ? api().returns({ site_id: site.id, status: 'open' }).catch(() => null) : null,
    ]);

    /* Always overwrite a count the mockup shipped: a fabricated number on the
       home screen is worse than none, because a staffer cannot tell it is
       fiction. When a read fails, the card falls back to its description. */
    if (board) {
      const waiting = board.lanes.find(l => l.key === 'waiting') || { count: 0, cards: [] };
      const late = waiting.cards.filter(c => c.urgency === 'late').length;
      if (!waiting.count) bi(pickNote, 'Belum ada pesanan', 'No orders waiting');
      else bi(pickNote,
        waiting.count + ' pesanan menunggu' + (late ? ' · ' + late + ' terlambat' : ''),
        waiting.count + ' waiting' + (late ? ' · ' + late + ' late' : ''));
    } else {
      bi(pickNote, 'Ambil barang untuk pesanan pelanggan', 'Pick items for customer orders');
    }

    const plan = plans && plans.plans[0];
    if (plan && plan.total_baskets) {
      const left = plan.total_baskets - plan.counted;
      if (left > 0) bi(countNote, left + ' keranjang belum dihitung', left + ' baskets left to count');
      else bi(countNote, 'Semua keranjang sudah dihitung', 'Every basket is counted');
    } else if (plans) {
      bi(countNote, 'Belum ada jadwal hitung', 'No count scheduled yet');
    } else {
      bi(countNote, 'Hitung isi keranjang', 'Count what a basket holds');
    }

    if (returns && returns.tasks) {
      const units = returns.tasks.reduce((n, t) => n + (t.qty - t.qty_returned), 0);
      if (units) bi(returnNote, units + ' barang dari pesanan batal menunggu', units + ' units from cancelled orders waiting');
      else bi(returnNote, 'Tidak ada yang perlu dikembalikan', 'Nothing to return');
    }
  };
})();
