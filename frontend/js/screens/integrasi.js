/* screens/integrasi.js: the Hiryu link (console/integrasi.html), PRD §0.6, §9.3.
 *
 * Six messages cross the link. 1 (order to pick), 2 (order cancelled) and 6
 * (catalogue) come IN from Hiryu and are listed from the inbound log; 3 (stock
 * level), 4 (order ready) and 5 (item short) go OUT through the outbox that
 * GET /api/hiryu-link/status summarises.
 *
 * Whether anything is sent is decided on the server: POS_PUSH_ENABLED, the
 * webhook address and the secret are environment settings, and the switch
 * Sambungan Hiryu aktif is Ops HQ's. The page says in words which of them is
 * off, so a quiet queue is never read as a healthy link. Anything waiting
 * longer than the alert limit (5 minutes by default) is red (§9.3).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const r = NJW.api.raw;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  const link = {
    status: (siteId) => r.get('/hiryu-link/status' + r.qs({ site_id: siteId })),
    setLive: (on) => r.post('/hiryu-link/live', { live: on }),
    snapshot: () => r.post('/hiryu-link/snapshot', {}),
    retry: () => r.post('/hiryu-link/retry-failed', {}),
  };

  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const ageText = s => {
    const m = Math.floor((s || 0) / 60), h = Math.floor(m / 60);
    if (s < 60) return [s + ' dtk', s + ' s'];
    return h ? [h + ' jam ' + (m % 60) + ' mnt', h + ' h ' + (m % 60) + ' min'] : [m + ' mnt', m + ' min'];
  };
  const when = iso => iso ? NJW.fmt.date(iso) + ' ' + NJW.fmt.time(iso) : null;

  const OUT = [
    { n: 3, type: 'stock_level', id: 'Level stok', en: 'Stock level',
      when: ['setelah setiap perubahan stok', 'after every stock change'] },
    { n: 4, type: 'order_ready', id: 'Pesanan siap', en: 'Order ready',
      when: ['saat Selesai dikemas', 'at Selesai dikemas'] },
    { n: 5, type: 'order_short', id: 'Barang kurang', en: 'Item short',
      when: ['saat Barang tidak ada', 'at Barang tidak ada'] },
  ];
  const IN = [
    { n: 1, type: 'order', id: 'Pesanan untuk diambil', en: 'Order to pick', path: 'POST /api/hiryu/v1/orders' },
    { n: 2, type: 'cancel', id: 'Pesanan dibatalkan', en: 'Order cancelled', path: 'POST /api/hiryu/v1/orders/{id}/cancel' },
    { n: 6, type: 'catalogue', id: 'Katalog', en: 'Catalogue', path: 'POST /api/hiryu/v1/catalogue' },
  ];
  const OUTCOME = {
    accepted: ['spill--ok', 'Diterima', 'Accepted'],
    cancelled: ['spill--ok', 'Dibatalkan', 'Cancelled'],
    duplicate: ['spill--neutral', 'Sudah pernah', 'Seen before'],
    pending_cancel: ['spill--info', 'Batal disimpan', 'Cancel kept'],
    partial: ['spill--warn', 'Sebagian', 'Partly taken'],
    problem: ['spill--stop', 'Masalah', 'Problem'],
    refused: ['spill--stop', 'Ditolak', 'Refused'],
  };
  const TYPE_NAME = { order: ['Pesanan (1)', 'Order (1)'], cancel: ['Batal (2)', 'Cancel (2)'],
                      catalogue: ['Katalog (6)', 'Catalogue (6)'] };

  function num(v, id, e, red) {
    return '<span class="msgcard__num"><span class="msgcard__num-v"' + (red ? ' style="color:var(--stop)"' : '') + '>' +
      esc(v) + '</span><span class="msgcard__num-l" ' + biAttr(id, e) + '>' + esc(id) + '</span></span>';
  }
  function card(cls, n, id, e, badge, code, nums, foot) {
    return '<div class="msgcard' + (cls ? ' ' + cls : '') + '">' +
      '<span class="msgcard__top"><span class="msgcard__name" ' + biAttr(n + ' · ' + id, n + ' · ' + e) +
      '>' + esc(n + ' · ' + id) + '</span>' + badge + '</span>' +
      '<span class="msgcard__code">' + code + '</span>' +
      '<span class="msgcard__nums">' + nums + '</span>' +
      '<span class="msgcard__foot">' + foot + '</span></div>';
  }
  const spill = (tone, id, e) => '<span class="spill ' + tone + '"><span class="spill__dot"></span><span ' +
    biAttr(id, e) + '>' + esc(id) + '</span></span>';
  const span = (id, e) => '<span ' + biAttr(id, e) + '>' + esc(id) + '</span>';

  NJW.screens.integrasi = async () => {
    const site = W.site();
    if (!site) return;
    // A hub sends nothing itself, so it sees the whole link rather than a blank.
    const siteId = site.site_type === 'hub' ? null : site.id;
    const liveBox = field('live-switch');

    async function load() {
      let st;
      try { st = await link.status(siteId); } catch (e) { fail(e); return; }
      const limit = (st.wait_alert_minutes || 5) * 60;

      /* ---- is anything being sent, and if not, why ---- */
      if (liveBox) liveBox.checked = !!st.live;
      show(region('view-off'), !st.sending);
      show(region('view-on'), st.sending);
      show(region('training-note'), !!site.is_training);
      if (!st.sending) {
        const why = [], whyEn = [];
        if (!st.live) { why.push('Sambungan Hiryu dimatikan oleh Ops HQ: pesanan lewat tempel, stok diketik.'); whyEn.push('Ops HQ switched the link off: orders by paste, stock typed.'); }
        if (!st.push_enabled) { why.push('POS_PUSH_ENABLED belum true.'); whyEn.push('POS_PUSH_ENABLED is not true.'); }
        if (!st.webhook_configured) { why.push('Alamat Hiryu (POS_WEBHOOK_URL) belum diisi.'); whyEn.push('Hiryu\'s address (POS_WEBHOOK_URL) is not set.'); }
        if (!st.secret_configured) { why.push('Kunci bersama (POS_SHARED_SECRET) belum diisi.'); whyEn.push('The shared secret (POS_SHARED_SECRET) is not set.'); }
        bi(field('off-body'), why.join(' ') + ' Pesan tetap diantrekan dan dikirim begitu semuanya menyala.',
                              whyEn.join(' ') + ' Messages still queue and go once everything is on.');
      }

      /* ---- KPIs ---- */
      const lanes = st.lanes.filter(l => OUT.some(m => m.type === l.message_type));
      const sum = k => lanes.reduce((n, l) => n + (l[k] || 0), 0);
      const waiting = sum('pending') + sum('sending');
      setF('kpi-queued', NJW.fmt.n(waiting));
      bi(field('kpi-queued-foot'), waiting ? 'pesan 3, 4 dan 5 di antrean' : 'antrean kosong',
                                   waiting ? 'messages 3, 4 and 5 in the queue' : 'queue empty');
      const oldest = st.oldest_pending_seconds;
      const late = oldest != null && oldest > limit;
      if (oldest == null) {
        setF('kpi-oldest', '0');
        bi(field('kpi-oldest-foot'), 'tidak ada yang menunggu', 'nothing waiting');
      } else {
        const [a, b] = ageText(oldest);
        bi(field('kpi-oldest'), a, b);
        bi(field('kpi-oldest-foot'), late ? 'lebih dari ' + st.wait_alert_minutes + ' menit: beri tahu Ops HQ' : 'masih dalam batas',
                                     late ? 'over ' + st.wait_alert_minutes + ' minutes: tell Ops HQ' : 'within the limit');
      }
      const oc = field('kpi-oldest').closest('.kpi-card');
      if (oc) oc.classList.toggle('kpi-card--stop', late);

      const last = when(st.last_sent_at);
      setF('kpi-sent', last ? NJW.fmt.time(st.last_sent_at) : '-');
      bi(field('kpi-sent-foot'), last ? NJW.fmt.date(st.last_sent_at) : 'belum pernah ada yang terkirim',
                                 last ? NJW.fmt.date(st.last_sent_at) : 'nothing sent yet');
      const failed = sum('failed');
      setF('kpi-failed', NJW.fmt.n(failed));
      bi(field('kpi-failed-foot'), failed ? 'ditolak Hiryu, lihat di bawah' : 'tidak ada',
                                   failed ? 'refused by Hiryu, see below' : 'none');
      const fc = field('kpi-failed').closest('.kpi-card');
      if (fc) fc.classList.toggle('kpi-card--stop', failed > 0);
      if (st.sending) {
        bi(field('on-note'), failed || late ? 'Sambungan aktif, tapi ada pesan yang gagal atau menunggu terlalu lama. Beri tahu Ops HQ.'
                                            : 'Sambungan aktif: pesan terkirim ke Hiryu dan tidak ada yang gagal.',
                             failed || late ? 'The link is on, but some messages failed or waited too long. Tell Ops HQ.'
                                            : 'The link is on: messages reach Hiryu and none are failing.');
      }

      /* ---- the six messages ---- */
      let html = '';
      IN.forEach(m => {
        const rows = st.inbound.filter(x => x.message_type === m.type);
        const bad = rows.filter(x => x.outcome === 'refused' || x.outcome === 'problem').length;
        const lastIn = rows.length ? rows[0].received_at : null;
        html += card(bad ? 'is-failing' : '', m.n, m.id, m.en, spill('spill--info', 'MASUK', 'IN'),
          'Hiryu → WMS · ' + esc(m.path),
          num(rows.length, 'terakhir', 'recent') + num(bad, 'ditolak', 'refused', bad > 0),
          lastIn ? span('Terakhir ' + when(lastIn), 'Last ' + when(lastIn)) : span('Belum ada', 'None yet'));
      });
      OUT.forEach(m => {
        const l = st.lanes.find(x => x.message_type === m.type) || {};
        const wait = (l.pending || 0) + (l.sending || 0);
        const lateLane = l.oldest_pending_seconds != null && l.oldest_pending_seconds > limit;
        const cls = l.failed || lateLane ? 'is-failing' : !st.sending ? 'is-shadow' : wait ? 'is-queued' : '';
        const badge = !st.sending ? spill('spill--neutral', 'TIDAK DIKIRIM', 'NOT SENT')
          : l.failed ? spill('spill--stop', 'Gagal', 'Failing')
          : lateLane ? spill('spill--stop', 'Terlambat', 'Late')
          : wait ? spill('spill--accent', 'Antre', 'Queued') : spill('spill--ok', 'Terkirim', 'Sent');
        const nums = num(NJW.fmt.n(wait), 'menunggu', 'waiting', lateLane) +
          num(NJW.fmt.n(l.failed || 0), 'gagal', 'failed', (l.failed || 0) > 0) +
          num(NJW.fmt.n(l.sent || 0), 'terkirim', 'sent');
        let foot = l.last_sent_at ? span('Terakhir terkirim ' + when(l.last_sent_at), 'Last sent ' + when(l.last_sent_at))
                                  : span('Belum pernah terkirim', 'Never sent');
        if (lateLane) {
          const [a, b] = ageText(l.oldest_pending_seconds);
          foot = '<span style="color:var(--stop);font-weight:600" ' + biAttr('Menunggu ' + a, 'Waiting ' + b) + '></span>';
        }
        html += card(cls, m.n, m.id, m.en, badge,
          'WMS → Hiryu · ' + esc(l.contract_type || m.type) + ' · ' + span(m.when[0], m.when[1]), nums, foot);
      });
      const host = region('messages');
      host.innerHTML = html;
      applyLangTo(host);

      /* ---- failed rows ---- */
      show(region('fail-section'), st.failures.length > 0);
      const fHost = region('failures');
      fHost.innerHTML = st.failures.map(f => {
        const m = OUT.find(x => x.type === f.message_type);
        return '<tr><td>' + (m ? span(m.n + ' · ' + m.id, m.n + ' · ' + m.en) : esc(f.message_type)) + '</td>' +
          '<td class="td-code">' + esc(f.order_ref || '-') + '</td>' +
          '<td class="td-num">' + f.attempts + '</td>' +
          '<td style="max-width:420px;word-break:break-word">' + esc(f.last_error || '') + '</td>' +
          '<td>' + esc(when(f.created_at) || '-') + '</td></tr>';
      }).join('');
      applyLangTo(fHost);

      /* ---- inbound log ---- */
      const iHost = region('inbound');
      iHost.innerHTML = st.inbound.length ? st.inbound.map(x => {
        const o = OUTCOME[x.outcome] || ['spill--neutral', x.outcome, x.outcome];
        const t = TYPE_NAME[x.message_type] || [x.message_type, x.message_type];
        const red = x.outcome === 'refused' || x.outcome === 'problem';
        return '<tr' + (red ? ' style="background:var(--stop-bg)"' : '') + '>' +
          '<td>' + esc(when(x.received_at)) + '</td>' +
          '<td>' + span(t[0], t[1]) + '</td>' +
          '<td class="td-code">' + esc(x.grab_order_id || '') + (x.hiryu_store_no ? ' #' + x.hiryu_store_no : '') + '</td>' +
          '<td>' + spill(o[0], o[1], o[2]) + '</td>' +
          '<td style="max-width:460px;word-break:break-word">' + esc(oneLang(x.detail || '')) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="note">' + span('Belum ada pesan dari Hiryu.', 'No message from Hiryu yet.') + '</td></tr>';
      applyLangTo(iHost);
    }

    /* ---- Ops HQ actions ---- */
    if (liveBox) liveBox.addEventListener('change', async () => {
      const on = liveBox.checked;
      const ask = on
        ? (en() ? 'Switch the Hiryu link on? Paste and the stock sheet turn off, and a full stock snapshot is queued.'
                : 'Nyalakan sambungan Hiryu? Tempel pesanan dan lembar stok mati, dan snapshot stok penuh diantrekan.')
        : (en() ? 'Switch the Hiryu link off? Orders go back to paste and stock is typed by the SPV.'
                : 'Matikan sambungan Hiryu? Pesanan kembali lewat tempel dan stok diketik SPV.');
      if (!confirm(ask)) { liveBox.checked = !on; return; }
      liveBox.disabled = true;
      try { const res = await link.setLive(on); say(oneLang(res.message)); await load(); }
      catch (e) { liveBox.checked = !on; say(oneLang(e.message)); }
      finally { liveBox.disabled = false; }
    });

    document.addEventListener('click', async e => {
      if (e.target.closest('[data-action="refresh"]')) return load();
      const act = e.target.closest('[data-action="snapshot"],[data-action="retry"]');
      if (!act) return;
      act.disabled = true;
      try {
        const res = act.dataset.action === 'snapshot' ? await link.snapshot() : await link.retry();
        say(oneLang(res.message));
        await load();
      } catch (err) { say(oneLang(err.message)); }
      finally { act.disabled = false; }
    });

    await load();
    setInterval(() => { if (!document.hidden) load(); }, 15000);
  };
})();
