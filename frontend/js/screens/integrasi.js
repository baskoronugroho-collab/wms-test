/* screens/integrasi.js — the Hiryu boundary (console/integrasi.html).
 *
 * Five messages cross it. 1 (order to pick) and 2 (order cancelled) come IN
 * from Hiryu; 3 (stock level, after every stock change), 4 (order ready, at the
 * pack scan) and 5 (order short) go OUT through the durable outbox that
 * GET /api/pos/outbox summarises. The WMS never talks to Grab.
 *
 * `push_enabled` is the most important number on the page and it is server-
 * owned: the mode control is a read-out, never a switch. While push is off,
 * every outbound message sits in the queue as "pending" — computed, not sent —
 * and the page says so in words, not only in colour.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $$, field, region, setF, esc, bi, biAttr, applyLangTo, fail } = W;
  const api = NJW.api;

  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const mins = s => Math.max(0, Math.floor((s || 0) / 60));

  const OUT = [
    { n: 3, type: 'stock_level', id: 'Level stok', en: 'Stock level',
      when: ['setelah setiap perubahan stok', 'after every stock change'] },
    { n: 4, type: 'order_ready', id: 'Pesanan siap', en: 'Order ready',
      when: ['saat scan kemas', 'at the pack scan'] },
    { n: 5, type: 'order_short', id: 'Pesanan kurang', en: 'Order short',
      when: ['saat dinyatakan kurang — Hiryu memutuskan', 'when declared — Hiryu decides'] },
  ];

  function num(v, id, en) {
    return '<span class="msgcard__num"><span class="msgcard__num-v">' + esc(v) + '</span>' +
      '<span class="msgcard__num-l" ' + biAttr(id, en) + '>' + esc(id) + '</span></span>';
  }
  function card(cls, n, id, en, badge, code, nums, foot) {
    return '<div class="msgcard' + (cls ? ' ' + cls : '') + '">' +
      '<span class="msgcard__top"><span class="msgcard__name" ' + biAttr(n + ' · ' + id, n + ' · ' + en) +
      '>' + esc(n + ' · ' + id) + '</span>' + badge + '</span>' +
      '<span class="msgcard__code">' + code + '</span>' +
      '<span class="msgcard__nums">' + nums + '</span>' +
      '<span class="msgcard__foot">' + foot + '</span></div>';
  }
  const spill = (tone, id, en) => '<span class="spill spill--' + tone + '"><span class="spill__dot"></span><span ' +
    biAttr(id, en) + '>' + esc(id) + '</span></span>';

  NJW.screens.integrasi = async () => {
    const site = W.site();
    if (!site) return;
    // A hub publishes nothing; console.js owns the not-applicable panel.
    if (site.site_type === 'hub') { NJW.applySiteType('hub', site.code); return; }

    async function load() {
      const [ob, board, inv] = await Promise.all([
        api.outbox({ site_id: site.id }).catch(e => { fail(e); return null; }),
        api.pickBoard({ site_id: site.id }).catch(() => null),
        api.inventory({ site_id: site.id, limit: 1000 }).catch(() => null),
      ]);
      if (!ob) return;
      const live = !!ob.push_enabled;

      $$('[data-view]', region('mode')).forEach(b =>
        b.classList.toggle('is-on', (b.dataset.view === 'live') === live));
      show(region('view-shadow'), !live);
      show(region('view-live'), live);
      show(region('training-note'), !!site.is_training);

      const lane = t => ob.lanes.find(l => l.message_type === t) ||
        { message_type: t, pending: 0, suppressed: 0, sent: 0, failed: 0, last_sent_at: null };
      const sum = k => OUT.reduce((n, m) => n + (lane(m.type)[k] || 0), 0);

      /* ---- KPIs ---- */
      setF('kpi-queued', NJW.fmt.n(sum('pending')));
      bi(field('kpi-queued-foot'), live ? 'menunggu dikirim ke Hiryu' : 'dihitung, ditahan — tidak dikirim',
                                   live ? 'waiting to go to Hiryu' : 'computed, held — not sent');
      if (ob.oldest_pending_seconds == null) {
        setF('kpi-oldest', '—');
        bi(field('kpi-oldest-foot'), 'antrean kosong', 'queue empty');
      } else {
        const m = mins(ob.oldest_pending_seconds), h = Math.floor(m / 60);
        bi(field('kpi-oldest'), h ? h + ' jam ' + (m % 60) + ' mnt' : m + ' mnt',
                                h ? h + ' h ' + (m % 60) + ' min' : m + ' min');
        bi(field('kpi-oldest-foot'), live ? 'menunggu di antrean selama itu' : 'ditahan mode bayangan selama itu',
                                     live ? 'waiting in the queue that long' : 'held by shadow mode that long');
      }
      const lastSent = ob.lanes.map(l => l.last_sent_at).filter(Boolean).sort().pop();
      setF('kpi-sent', NJW.fmt.n(sum('sent')));
      bi(field('kpi-sent-foot'), lastSent ? 'terakhir ' + NJW.fmt.date(lastSent) + ' ' + NJW.fmt.time(lastSent)
                                          : 'belum pernah ada yang terkirim',
                                 lastSent ? 'last ' + NJW.fmt.date(lastSent) + ' ' + NJW.fmt.time(lastSent)
                                          : 'nothing has ever been delivered');
      const failed = sum('failed');
      setF('kpi-failed', NJW.fmt.n(failed));
      const failing = OUT.filter(m => lane(m.type).failed > 0).map(m => m.n);
      bi(field('kpi-failed-foot'), failed ? 'pesan ' + failing.join(', ') + ' — masalah di saluran' : 'tidak ada',
                                   failed ? 'message ' + failing.join(', ') + ' — a problem in the pipe' : 'none');
      const fc = field('kpi-failed') && field('kpi-failed').closest('.kpi-card');
      if (fc) fc.classList.toggle('kpi-card--caution', failed > 0);
      if (live) {
        bi(field('live-note'), failed ? 'Batas terbuka. Ada pesan yang gagal berulang — itu masalah di saluran, bukan di gudang.'
                                      : 'Batas terbuka: pesan dikirim ke Hiryu dan tidak ada yang gagal.',
                               failed ? 'The boundary is open. Some messages keep failing — a problem in the pipe, not the warehouse.'
                                      : 'The boundary is open: messages are reaching Hiryu and none are failing.');
      }

      /* ---- the five messages ---- */
      const inbound = spill('info', 'MASUK', 'INBOUND');
      const lanesOf = k => (board && board.lanes.find(l => l.key === k)) || { count: null };
      const onBoard = board ? lanesOf('waiting').count + lanesOf('picking').count : '—';
      const doneToday = board ? lanesOf('done_today').count : '—';
      let html =
        card('', 1, 'Pesanan untuk diambil', 'Order to pick', inbound,
          'Hiryu → WMS · POST /api/pos/orders',
          num(onBoard, 'di papan sekarang', 'on the board now') + num(doneToday, 'selesai hari ini', 'done today'),
          '<span ' + biAttr('Setiap pesanan masuk lewat Hiryu, dari saluran mana pun.',
                            'Every order enters through Hiryu, from any channel.') + '></span>') +
        card('', 2, 'Pesanan dibatalkan', 'Order cancelled', inbound,
          'Hiryu → WMS · POST /api/orders/{ref}/cancel',
          num('—', 'belum dihitung', 'not counted yet'),
          '<span ' + biAttr('Barang yang sudah diambil masuk daftar kembalikan ke rak. Jumlah pembatalan belum dilaporkan API.',
                            'Picked units go to the return-to-shelf list. The API does not report a cancel count yet.') + '></span>');

      OUT.forEach(m => {
        const l = lane(m.type);
        let cls, badge, nums, foot;
        if (!live) {
          cls = 'is-shadow';
          badge = '<span class="badge-training" ' + biAttr('TIDAK DIKIRIM', 'NOT SENT') + '>TIDAK DIKIRIM</span>';
          nums = num(NJW.fmt.n(l.pending), 'ditahan', 'held') +
                 num(NJW.fmt.n(l.suppressed), 'latihan', 'training') +
                 num(NJW.fmt.n(l.sent), 'terkirim', 'sent');
          foot = '<span ' + biAttr('Dihitung dan ditahan di batas.', 'Computed and held at the boundary.') + '></span>';
        } else {
          cls = l.failed ? 'is-failing' : l.pending ? 'is-queued' : '';
          badge = l.failed ? spill('warn', 'Gagal', 'Failing')
            : l.pending ? spill('accent', 'Antre', 'Queued') : spill('ok', 'Terkirim', 'Delivered');
          nums = num(NJW.fmt.n(l.sent), 'terkirim', 'sent') + num(NJW.fmt.n(l.pending), 'antre', 'queued') +
                 num(NJW.fmt.n(l.failed), 'gagal', 'failed');
          foot = l.last_sent_at
            ? '<span ' + biAttr('Terakhir terkirim ' + NJW.fmt.time(l.last_sent_at),
                                'Last delivered ' + NJW.fmt.time(l.last_sent_at)) + '></span>'
            : '<span ' + biAttr('Belum pernah terkirim', 'Never delivered') + '></span>';
        }
        html += card(cls, m.n, m.id, m.en, badge,
          'WMS → Hiryu · ' + esc(m.type) + ' · <span ' + biAttr(m.when[0], m.when[1]) + '></span>', nums, foot);
      });
      const host = region('messages');
      host.innerHTML = html;
      applyLangTo(host);

      /* ---- what message 3 carries: available per SKU, lowest first ---- */
      const sHost = region('stock-now');
      if (!inv) {
        sHost.innerHTML = '<tr><td colspan="4" class="note" ' + biAttr('Stok tidak bisa dimuat.', 'Stock could not be loaded.') + '></td></tr>';
      } else {
        const by = new Map();
        inv.rows.forEach(r => {
          const a = by.get(r.sku_id) || { name: r.sku_name, on: 0, alloc: 0 };
          a.on += r.qty_on_hand; a.alloc += r.qty_allocated;
          by.set(r.sku_id, a);
        });
        const list = Array.from(by.values())
          .map(a => Object.assign(a, { avail: Math.max(0, a.on - a.alloc) }))
          .sort((a, b) => a.avail - b.avail || a.name.localeCompare(b.name)).slice(0, 10);
        sHost.innerHTML = list.length ? list.map(a =>
          '<tr><td class="td-strong">' + esc(a.name) + '</td><td class="td-num">' + a.on + '</td>' +
          '<td class="td-num">' + a.alloc + '</td><td class="td-num"' +
          (a.avail ? '' : ' style="color:var(--caution);font-weight:700"') + '>' + a.avail + '</td></tr>').join('')
          : '<tr><td colspan="4" class="note" ' + biAttr('Belum ada stok di lokasi ini.', 'No stock at this site yet.') + '></td></tr>';
      }
      applyLangTo(sHost);
    }

    document.addEventListener('click', e => {
      if (e.target.closest('[data-action="refresh"]')) load();
    });
    await load();
    setInterval(() => { if (!document.hidden) load(); }, 30000);
  };
})();
