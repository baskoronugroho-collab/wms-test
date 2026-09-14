/* screens/index.js — the supervisor overview (console/index.html).
 *
 * Replaces the wire.js `index` handler, which was written against the older
 * four-card overview (occupancy and variance KPIs, inferred "next element"
 * footers). The v3 page asks a different question — is the queue on time, did
 * anything go short, did stock arrive, can Hiryu be told — and every card now
 * names its own footer with a data-field so a reordered layout cannot put one
 * card's explanation under another card's number.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { field, region, esc, bi, biAttr, applyLangTo } = W;
  const api = NJW.api;

  /* The station's calendar is Jakarta's, whatever the laptop is set to, and the
     server's timestamps are UTC. Comparing either against the browser's own
     date would roll "today" over at the wrong hour. */
  const jktDay = v => {
    const d = NJW.toDate(v);
    return d ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '';
  };
  const mins = s => Math.max(0, Math.floor((s || 0) / 60));

  function kpi(name, value, footId, footEn, tone) {
    const num = field('kpi-' + name);
    if (num) num.textContent = value;
    bi(field('kpi-' + name + '-foot'), footId, footEn);
    const card = num && num.closest('.kpi-card');
    if (card) {
      card.classList.remove('kpi-card--caution', 'kpi-card--stop');
      if (tone) card.classList.add('kpi-card--' + tone);
    }
  }
  const unknown = name => kpi(name, '—', 'Tidak bisa dimuat', 'Could not load');
  const notHere = name => kpi(name, '—', 'Tidak berlaku di hub', 'Does not apply at a hub');

  NJW.screens.index = async () => {
    const site = W.site();
    if (!site) return;
    const hub = site.site_type === 'hub';
    bi(field('eyebrow'), 'Station ' + site.code + ' · hari ini', 'Station ' + site.code + ' · today');

    const dc = await api.dayColors().catch(() => null);
    const today = dc && dc.today;
    if (today) {
      NJW.paintDayColor(today);
      bi(field('day-name'), today.day_id, today.day_en);
      bi(field('day-week'), 'Minggu ' + today.week_parity + ' · W' + today.iso_week,
                            'Week ' + today.week_parity + ' · W' + today.iso_week);
    }
    const todayDate = today ? today.date : jktDay(new Date());
    const sid = site.id;

    // A hub picks no customer orders and publishes nothing to Hiryu, so asking
    // would only produce empty lanes that read like an outage.
    const [board, shorts, slips, inv, outbox, plans] = await Promise.all([
      hub ? null : api.pickBoard({ site_id: sid }).catch(() => undefined),
      hub ? null : api.shortfalls({ site_id: sid, limit: 200 }).catch(() => undefined),
      api.slips({ site_id: sid, limit: 100 }).catch(() => undefined),
      api.inventory({ site_id: sid, limit: 1000 }).catch(() => undefined),
      hub ? null : api.outbox({ site_id: sid }).catch(() => undefined),
      api.opnamePlans({ site_id: sid, limit: 10 }).catch(() => undefined),
    ]);

    const lane = k => (board && board.lanes.find(l => l.key === k)) || { cards: [], count: 0 };

    /* ---- queue: waiting and late, against the promise not the age ---- */
    if (hub) notHere('orders');
    else if (!board) unknown('orders');
    else {
      const waiting = lane('waiting');
      const late = waiting.cards.filter(c => c.urgency === 'late').length;
      const oldest = mins(board.oldest_waiting_seconds);
      if (late) kpi('orders', waiting.count, late + ' terlambat · tertua ' + oldest + ' menit',
                    late + ' late · oldest ' + oldest + ' min', 'stop');
      else if (waiting.count) kpi('orders', waiting.count, 'tidak ada yang terlambat',
                                  'none late');
      else kpi('orders', 0, 'antrean kosong', 'queue empty');
    }

    /* ---- picks finished today, with the real order-to-done average ---- */
    if (hub) notHere('picked');
    else if (!board) unknown('picked');
    else {
      const done = lane('done_today');
      const timed = done.cards.filter(c => c.completed_at && c.created_at);
      if (timed.length) {
        const avg = timed.reduce((n, c) =>
          n + (NJW.toDate(c.completed_at) - NJW.toDate(c.created_at)) / 1000, 0) / timed.length;
        const m = Math.floor(avg / 60), s = Math.round(avg % 60);
        kpi('picked', done.count, 'rata-rata ' + m + ' mnt ' + s + ' dtk masuk→selesai',
            'avg ' + m + ' min ' + s + ' s order→done');
      } else {
        kpi('picked', done.count, 'belum ada yang selesai hari ini', 'none finished today');
      }
    }

    /* ---- short picks declared today ---- */
    let shortToday = [];
    if (hub) notHere('short');
    else if (!shorts) unknown('short');
    else {
      shortToday = shorts.rows.filter(r => jktDay(r.created_at) === todayDate);
      const people = new Set(shortToday.map(r => r.declared_by || '?')).size;
      if (shortToday.length) kpi('short', shortToday.length,
        'dinyatakan oleh ' + people + ' orang', 'declared by ' + people +
        (people === 1 ? ' person' : ' people'), 'caution');
      else kpi('short', 0, 'tidak ada hari ini', 'none today');
    }

    /* ---- receipts: slips whose inbound date is today at the station ---- */
    let slipsToday = [];
    if (!slips) unknown('received');
    else {
      slipsToday = slips.slips.filter(x => String(x.inbound_date || '').slice(0, 10) === todayDate);
      const units = slipsToday.reduce((n, x) => n + (x.total_units || 0), 0);
      kpi('received', NJW.fmt.n(units), 'dari ' + slipsToday.length + ' kiriman',
          'across ' + slipsToday.length + (slipsToday.length === 1 ? ' delivery' : ' deliveries'));
    }

    /* ---- stock alerts: SKUs with nothing left to sell. Summed per SKU across
       rack and overflow — an empty rack face with a full overflow is not out. */
    let outSkus = 0;
    if (!inv) unknown('alerts');
    else {
      const bySku = new Map();
      inv.rows.forEach(r => bySku.set(r.sku_id, (bySku.get(r.sku_id) || 0) + (r.available || 0)));
      outSkus = Array.from(bySku.values()).filter(v => v <= 0).length;
      kpi('alerts', outSkus, 'dari ' + bySku.size + ' SKU di lokasi ini',
          'of ' + bySku.size + ' SKUs at this site', outSkus ? 'caution' : null);
    }

    /* ---- outbox: the only honest reading of "is Hiryu being told" ---- */
    let failing = [];
    if (hub) notHere('outbox');
    else if (!outbox) unknown('outbox');
    else {
      const sum = k => outbox.lanes.reduce((n, l) => n + (l[k] || 0), 0);
      failing = outbox.lanes.filter(l => l.failed > 0);
      if (site.is_training) {
        kpi('outbox', 0, 'lokasi latihan — tidak pernah dikirim', 'training site — never sent');
      } else if (!outbox.push_enabled) {
        kpi('outbox', NJW.fmt.n(sum('pending')), 'mode bayangan — sengaja belum dikirim',
            'shadow mode — deliberately not sent', 'caution');
      } else if (failing.length) {
        kpi('outbox', NJW.fmt.n(sum('pending')), sum('failed') + ' gagal — cek Integrasi',
            sum('failed') + ' failed — see Integration', 'stop');
      } else {
        kpi('outbox', NJW.fmt.n(sum('pending')), 'terkirim normal', 'flowing normally');
      }
    }

    /* "Needs attention" must never invent a row: an ops board that shows a
       problem which does not exist costs someone a walk to a rack. */
    const rows = [];
    if (board) {
      lane('waiting').cards.filter(c => c.urgency === 'late').slice(0, 5).forEach(c => {
        const over = mins(-(c.remaining_seconds || 0));
        rows.push({
          what: 'Pesanan terlambat', what_en: 'Late order', ref: c.external_ref,
          detail: 'Lewat janji ' + over + ' menit · belum diambil',
          detail_en: over + ' min past the promise · not picked yet',
          status: 'Mendesak', status_en: 'Urgent', tone: 'stop', href: 'papan-antrean.html',
        });
      });
      lane('picking').cards.filter(c => (c.held_seconds || 0) >= 900).forEach(c => {
        const who = c.claimed_by_name || c.claimed_by || '—';
        rows.push({
          what: 'Klaim tersendat', what_en: 'Stuck claim', ref: c.external_ref,
          detail: 'Dipegang ' + mins(c.held_seconds) + ' menit oleh ' + who,
          detail_en: 'Held ' + mins(c.held_seconds) + ' min by ' + who,
          status: 'Mendesak', status_en: 'Urgent', tone: 'stop', href: 'papan-antrean.html',
        });
      });
    }
    shortToday.slice(0, 5).forEach(r => rows.push({
      what: 'Kurang barang', what_en: 'Short pick', ref: r.sku_name,
      detail: 'Ketemu ' + r.qty_found + ' dari ' + r.qty_required + ' · ' + (r.declared_by || '—'),
      detail_en: 'Found ' + r.qty_found + ' of ' + r.qty_required + ' · ' + (r.declared_by || '—'),
      status: 'Tinjau', status_en: 'Review', tone: 'warn', href: 'pesanan.html',
    }));
    if (plans) {
      plans.plans.filter(p => p.status !== 'closed' && p.variances > 0).forEach(p => rows.push({
        what: 'Selisih hitung stok', what_en: 'Count variance', ref: p.name || ('#' + p.id),
        detail: p.variances + ' keranjang selisih — perlu tanda tangan supervisor',
        detail_en: p.variances + ' baskets with a variance — needs supervisor sign-off',
        status: 'Perlu tanda tangan', status_en: 'Needs sign-off', tone: 'warn',
        href: 'hitung-stok.html',
      }));
    }
    if (slips) {
      // Only a window that is still open and closing soon is worth a row; a
      // closed one can no longer be acted on, and an early one is not urgent.
      slips.slips.forEach(x => {
        const left = (NJW.toDate(x.created_at).getTime() + 24 * 36e5 - Date.now()) / 36e5;
        if (left > 0 && left <= 6) rows.push({
          what: 'Batas selisih barang masuk', what_en: 'Inbound discrepancy window',
          ref: x.slip_no,
          detail: 'Sisa ' + Math.ceil(left) + ' jam sebelum jadi tanggungan station',
          detail_en: Math.ceil(left) + ' h left before the station bears it',
          status: 'Mendesak', status_en: 'Urgent', tone: 'stop',
          href: 'slip-detail.html?id=' + x.id,
        });
      });
    }
    if (outSkus) rows.push({
      what: 'Stok habis', what_en: 'Out of stock', ref: outSkus + ' SKU',
      detail: 'Tidak ada stok tersedia — Hiryu akan menampilkannya habis',
      detail_en: 'Nothing available — Hiryu will show these as sold out',
      status: 'Cek', status_en: 'Check', tone: 'warn', href: 'stok-perhatian.html',
    });
    if (outbox && outbox.push_enabled) failing.forEach(l => rows.push({
      what: 'Pesan ke Hiryu gagal', what_en: 'Message to Hiryu failing', ref: l.message_type,
      detail: l.failed + ' gagal · ' + l.pending + ' antre',
      detail_en: l.failed + ' failed · ' + l.pending + ' queued',
      status: 'Mendesak', status_en: 'Urgent', tone: 'stop', href: 'integrasi.html',
    }));

    const host = region('attention');
    if (!host) return;
    // The design's own row vocabulary: td-strong, td-code, a spill status pill
    // with its dot, and td-actions. Invented class names would render a row
    // that is structurally right and visually unstyled.
    host.innerHTML = rows.length ? rows.map(r =>
      '<tr><td class="td-strong" ' + biAttr(r.what, r.what_en) + '>' + esc(r.what) + '</td>' +
      '<td class="td-code">' + esc(r.ref) + '</td>' +
      '<td ' + biAttr(r.detail, r.detail_en) + '>' + esc(r.detail) + '</td>' +
      '<td><span class="spill spill--' + r.tone + '"><span class="spill__dot"></span><span ' +
      biAttr(r.status, r.status_en) + '>' + esc(r.status) + '</span></span></td>' +
      '<td class="td-actions"><a class="cbtn cbtn--sm" href="' + esc(r.href) + '" ' +
      biAttr('Buka', 'Open') + '>Buka</a></td></tr>').join('')
      : '<tr><td colspan="5" class="note" ' +
        biAttr('Tidak ada yang perlu perhatian.', 'Nothing needs attention.') +
        '>Tidak ada yang perlu perhatian.</td></tr>';
    applyLangTo(host);
  };
})();
