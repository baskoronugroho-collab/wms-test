/* papan-antrean.js — console: the pick queue board.
 *
 * Replaces the wire.js `papan-antrean` handler. That one re-sorted the waiting
 * lane oldest-first and banded cards by age. The canonical design ranks by
 * time remaining against the promise instead: a Grab order must be ready 15
 * minutes after it reaches Hiryu, an own-channel order an hour after the
 * customer placed it, and both share one queue. Age would rank a comfortable
 * WhatsApp order level with a Grab order about to go late.
 *
 * So the server's order is kept as-is, and each card leads with its channel
 * and the minutes left, in colour AND words (normal / running out / late).
 *
 * Clocks tick locally from server-computed seconds, never from the laptop's
 * own time, so a wrong station clock cannot mis-band the queue.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = () => NJW.api;

  const STUCK_SECONDS = 15 * 60;   // a claim held this long is presumed dead
  const POLL_MS = 10000;
  const TICK_MS = 15000;

  const CHANNEL = { grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram' };
  const MODE = {
    grab_rider: ['Kurir Grab', 'Grab rider'],
    ninja_rider: ['Kurir Ninja', 'Ninja rider'],
    third_party: ['Kurir pihak ketiga', 'Third-party courier'],
    next_day: ['Kirim besok', 'Next day'],
  };
  const URGENCY = {
    normal: ['agechip--fresh', 'Sesuai jadwal', 'On time'],
    ageing: ['agechip--ageing', 'Hampir habis', 'Running out'],
    late: ['agechip--late', 'Terlambat', 'Late'],
  };

  // Mirrors the server's _urgency: late once the promise has passed, ageing
  // in the final third of the window (never less than a minute).
  function urgencyOf(remaining, windowSec) {
    if (remaining == null) return 'normal';
    if (remaining <= 0) return 'late';
    if (windowSec && remaining <= Math.max(60, Math.floor(windowSec / 3))) return 'ageing';
    return 'normal';
  }

  const mins = s => Math.max(0, Math.floor((s || 0) / 60));
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  NJW.screens['papan-antrean'] = async () => {
    const site = W.site();
    if (site.site_type === 'hub' && NJW.applySiteType) return NJW.applySiteType('hub', site.code);

    bi($('.page__eyebrow'), 'Masuk & keluar · ' + site.code, 'Inbound & outbound · ' + site.code);

    let staged = null;

    /* ---- card parts, in the design's own vocabulary ---- */

    function rackDots(racks) {
      if (!racks || !racks.length) return '';
      return '<span class="pcard__racks"><span class="pcard__racks-label" ' +
        biAttr('Rak', 'Racks') + '>Rak</span>' +
        racks.map(r => '<span class="rackdot">' + esc(r) + '</span>').join('') + '</span>';
    }

    const testBadge = c => c.is_test
      ? '<span class="badge-test" ' + biAttr('UJI COBA', 'TEST') + '>UJI COBA</span>' : '';

    // Channel and last-mile mode, as words: "Grab · Kurir Grab".
    function channelTag(c) {
      const m = MODE[c.delivery_mode] || [c.delivery_mode || '', c.delivery_mode || ''];
      const ch = CHANNEL[c.channel] || c.channel || '—';
      return '<span class="spill ' + (c.channel === 'grab' ? 'spill--ok' : 'spill--info') + '">' +
        '<span class="spill__dot"></span><span ' + biAttr(ch + ' · ' + m[0], ch + ' · ' + m[1]) + '>' +
        esc(ch + ' · ' + m[0]) + '</span></span>';
    }

    // The big number is minutes left (or minutes late), with the words beside it.
    function clock(c) {
      const u = urgencyOf(c.remaining_seconds, c._window);
      const [cls, id, en] = URGENCY[u];
      const r = c.remaining_seconds;
      let num = '—', unitId = 'tanpa janji waktu', unitEn = 'no promised time';
      if (r != null && r > 0) { num = Math.ceil(r / 60); unitId = 'menit lagi'; unitEn = 'min left'; }
      else if (r != null) { num = Math.max(1, Math.ceil(-r / 60)); unitId = 'menit terlambat'; unitEn = 'min late'; }
      const due = c.promised_at ? NJW.fmt.time(c.promised_at) : null;
      return '<span class="pcard__age">' +
        '<span class="pcard__age-num" data-field="age">' + num + '</span>' +
        '<span class="pcard__age-unit" data-field="age-unit" ' + biAttr(unitId, unitEn) + '>' + unitId + '</span>' +
        '<span class="agechip ' + cls + '" data-field="urgency"><span class="agechip__dot"></span><span ' +
        biAttr(id, en) + '>' + id + '</span></span></span>' +
        (due ? '<span class="note" style="font-size:var(--fs-c-meta)" ' +
          biAttr('Janji siap ' + due + ' · masuk ' + mins(c.age_seconds) + ' menit lalu',
                 'Due ' + due + ' · arrived ' + mins(c.age_seconds) + ' min ago') + '></span>' : '');
    }

    function facts(c) {
      return '<span class="pcard__facts">' +
        '<span><span class="n">' + c.line_count + '</span> <span ' +
        biAttr('barang', 'lines') + '>barang</span></span>' +
        '<span class="dot">·</span>' +
        '<span><span class="n">' + c.total_units + '</span> <span ' +
        biAttr('unit', 'units') + '>unit</span></span></span>';
    }

    function shortFlag(c) {
      if (!c.short_lines) return '';
      return '<span class="shortflag"><span aria-hidden="true">!</span><span>' +
        c.short_lines + ' <span ' +
        biAttr('baris kurang stok — Hiryu yang memutuskan', 'lines short — Hiryu decides') +
        '>baris kurang stok — Hiryu yang memutuskan</span></span></span>';
    }

    function cardAttrs(c, extra) {
      return ' data-task="' + c.id + '" data-remaining-seconds="' +
        (c.remaining_seconds == null ? '' : c.remaining_seconds) +
        '" data-window-seconds="' + (c._window || '') + '"' + (extra || '');
    }

    function head(c) {
      return '<span class="pcard__rule" aria-hidden="true"></span>' +
        '<span class="pcard__top"><span class="pcard__ref" data-field="ref">' +
        esc(c.external_ref) + '</span>' + testBadge(c) + '</span>' + channelTag(c);
    }

    function waitingCard(c) {
      const u = urgencyOf(c.remaining_seconds, c._window);
      return '<article class="pcard' + (u === 'normal' ? '' : ' is-' + u) + (c.is_test ? ' is-test' : '') +
        '"' + cardAttrs(c) + '>' + head(c) + clock(c) + facts(c) + rackDots(c.racks) + shortFlag(c) +
        (c.status === 'blocked' ? '<span class="shortflag"><span aria-hidden="true">!</span><span ' +
          biAttr('Terkunci — perlu supervisor', 'Blocked — needs a supervisor') +
          '>Terkunci — perlu supervisor</span></span>' : '') +
        '</article>';
    }

    const RELEASE_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3.5v9"/><path d="M8.2 9l3.8 3.5L15.8 9"/><path d="M4.5 15v5.5h15V15"/></svg>';

    function claimedCard(c) {
      const held = c.held_seconds || 0;
      const stuck = held >= STUCK_SECONDS;
      const u = urgencyOf(c.remaining_seconds, c._window);
      const who = c.claimed_by_name || (c.claimed_by || '').split('@')[0] || '—';
      return '<article class="pcard' + (stuck ? ' is-stuck' : u === 'late' ? ' is-late' : '') +
        (c.is_test ? ' is-test' : '') + '"' +
        cardAttrs(c, ' data-held-seconds="' + held + '"') + '>' + head(c) + clock(c) +
        facts(c) + rackDots(c.racks) + shortFlag(c) +
        '<span class="pcard__picker"><span class="pcard__avatar" aria-hidden="true">' +
        esc(initials(who)) + '</span><span class="pcard__who">' +
        '<span class="pcard__who-name">' + esc(who) + '</span>' +
        '<span class="pcard__who-held" data-field="held" ' +
        biAttr('Dipegang ' + mins(held) + ' menit · ' + c.picked_units + '/' + c.total_units + ' unit',
               'Held ' + mins(held) + ' min · ' + c.picked_units + '/' + c.total_units + ' units') + '></span>' +
        '</span></span>' +
        '<span class="pcard__foot">' +
        (stuck ? '<span class="agechip agechip--stuck"><span class="agechip__dot"></span><span ' +
                 biAttr('Klaim tersendat', 'Stuck claim') + '>Klaim tersendat</span></span>'
               : '<span class="agechip agechip--held"><span class="agechip__dot"></span><span ' +
                 biAttr('Sedang diambil', 'Being picked') + '>Sedang diambil</span></span>') +
        '<span class="toolbar__spacer"></span>' +
        '<button class="cbtn ' + (stuck ? 'cbtn--primary' : 'cbtn--sm') + '" type="button" data-release="' + c.id +
        '" data-holder="' + esc(who) + '" data-ref="' + esc(c.external_ref) +
        '" data-held="' + mins(held) + '">' + (stuck ? RELEASE_ICON : '') + '<span ' +
        biAttr(stuck ? 'Lepaskan ke antrean' : 'Lepaskan', stuck ? 'Release to the queue' : 'Release') + '>' +
        (stuck ? 'Lepaskan ke antrean' : 'Lepaskan') + '</span></button>' +
        '</span></article>';
    }

    /* ---- lanes ---- */

    function render(board) {
      const lane = k => board.lanes.find(l => l.key === k) || { cards: [], count: 0 };
      const waiting = lane('waiting'), claimed = lane('picking'), done = lane('done_today');
      // The promise window (created -> promised) is what "final third" is measured
      // against; age + remaining reconstructs it without a second clock.
      [waiting, claimed].forEach(l => l.cards.forEach(c => {
        c._window = c.remaining_seconds == null ? null : c.age_seconds + c.remaining_seconds;
      }));

      const wHost = region('waiting');
      // Server order is the queue order (least time left first). Not re-sorted.
      if (wHost) wHost.innerHTML = waiting.cards.length
        ? waiting.cards.map(waitingCard).join('')
        : '<p class="note" ' + biAttr('Antrean kosong.', 'The queue is empty.') + '>Antrean kosong.</p>';

      const cHost = region('claimed');
      if (cHost) cHost.innerHTML = claimed.cards.length
        ? claimed.cards.slice().sort((a, b) => (b.held_seconds || 0) - (a.held_seconds || 0))
            .map(claimedCard).join('')
        : '<p class="note" ' + biAttr('Tidak ada yang sedang diambil.', 'Nobody is picking.') +
          '>Tidak ada yang sedang diambil.</p>';

      const dHost = region('done');
      if (dHost) dHost.innerHTML = done.cards.length ? done.cards.slice(0, 8).map(c => {
        const late = c.promised_at && c.completed_at && NJW.toDate(c.completed_at) > NJW.toDate(c.promised_at);
        return '<span class="donerow"><span class="donerow__ref">' + esc(c.external_ref) +
          ' <span class="note" style="font-family:var(--font-ui)">' + esc(CHANNEL[c.channel] || '') +
          (late ? ' · <span ' + biAttr('terlambat', 'late') + '>terlambat</span>' : '') + '</span></span>' +
          '<span class="donerow__time">' + NJW.fmt.time(c.completed_at) + '</span></span>';
      }).join('') +
        (done.count > 8 ? '<span class="donerow" style="color:var(--muted-2)"><span ' +
          biAttr('…dan ' + (done.count - 8) + ' lainnya', '…and ' + (done.count - 8) + ' more') +
          '></span></span>' : '')
        : '<span class="donerow" style="color:var(--muted-2)"><span ' +
          biAttr('Belum ada yang selesai hari ini.', 'Nothing finished yet today.') + '></span></span>';

      // Average from arrival to done, computed or nothing: an invented average
      // on an ops board is a number someone will quote in a meeting.
      const finished = done.cards.filter(c => c.completed_at && c.created_at);
      if (finished.length) {
        const avg = finished.reduce((n, c) =>
          n + (NJW.toDate(c.completed_at) - NJW.toDate(c.created_at)) / 1000, 0) / finished.length;
        bi(field('avg-pick'), Math.floor(avg / 60) + ' mnt ' + Math.round(avg % 60) + ' dtk',
                              Math.floor(avg / 60) + ' min ' + Math.round(avg % 60) + ' s');
      } else {
        bi(field('avg-pick'), '—', '—');
      }
      setF('count-waiting', waiting.count);
      setF('count-claimed', claimed.count);
      setF('count-done', done.count);
      const stuckCards = claimed.cards.filter(c => (c.held_seconds || 0) >= STUCK_SECONDS);
      setF('count-stuck', stuckCards.length);
      const oldestEl = field('oldest-waiting');
      if (oldestEl) {
        if (board.oldest_waiting_seconds == null) bi(oldestEl, '—', '—');
        else bi(oldestEl, mins(board.oldest_waiting_seconds) + ' menit', mins(board.oldest_waiting_seconds) + ' min');
      }

      // The stuck banner names one order; it exists to be acted on.
      const alert = region('stuck-alert');
      if (alert) {
        const s = stuckCards[0];
        alert.style.display = s ? '' : 'none';
        if (s) {
          const who = s.claimed_by_name || (s.claimed_by || '').split('@')[0];
          setF('stuck-ref', s.external_ref);
          bi(field('stuck-held'), mins(s.held_seconds) + ' menit', mins(s.held_seconds) + ' min');
          setF('stuck-holder', who);
          const btn = $('[data-release]', alert);
          if (btn) {
            btn.dataset.release = s.id;
            btn.dataset.holder = who;
            btn.dataset.ref = s.external_ref;
            btn.dataset.held = mins(s.held_seconds);
          }
        }
      }
      applyLangTo($('.page') || document);
    }

    /* The clocks move between polls without a re-render: a card never
       reflows under the cursor, only its number, words and band change. */
    function tick() {
      if (document.hidden) return;
      const step = TICK_MS / 1000;
      document.querySelectorAll('.board [data-remaining-seconds]').forEach(card => {
        if (card.dataset.remainingSeconds === '') return;
        const r = +card.dataset.remainingSeconds - step;
        card.dataset.remainingSeconds = r;
        const u = urgencyOf(r, +card.dataset.windowSeconds || null);
        const num = field('age', card), unit = field('age-unit', card), chip = field('urgency', card);
        if (num) num.textContent = r > 0 ? Math.ceil(r / 60) : Math.max(1, Math.ceil(-r / 60));
        if (unit) bi(unit, r > 0 ? 'menit lagi' : 'menit terlambat', r > 0 ? 'min left' : 'min late');
        if (chip) {
          const [cls, id, en] = URGENCY[u];
          chip.className = 'agechip ' + cls;
          bi(chip.lastElementChild, id, en);
        }
        const held = card.dataset.heldSeconds;
        if (held == null) {
          card.classList.toggle('is-ageing', u === 'ageing');
          card.classList.toggle('is-late', u === 'late');
        } else {
          const h = +held + step;
          card.dataset.heldSeconds = h;
          if (!card.classList.contains('is-stuck')) card.classList.toggle('is-late', u === 'late');
        }
      });
    }

    function signature(board) {
      return board.lanes.map(l => l.key + ':' + l.cards.map(c =>
        c.id + c.status + (c.claimed_by || '') + c.picked_units + c.short_lines).join('|')).join('~');
    }

    let lastSig = null;

    async function poll(force) {
      try {
        const board = await api().pickBoard({ site_id: site.id });
        const sig = signature(board);
        if (force || lastSig === null) {
          lastSig = sig;
          staged = null;
          const pill = $('.stagepill');
          if (pill) pill.classList.remove('is-on');
          render(board);
        } else if (sig !== lastSig) {
          // Park changes rather than reflowing cards under a supervisor's
          // cursor mid-click; the pill is how the board asks permission.
          staged = board;
          lastSig = sig;
          const n = field('staged-count');
          if (n) n.textContent = board.lanes.reduce((t, l) => t + l.count, 0);
          const pill = $('.stagepill');
          if (pill) pill.classList.add('is-on');
        }
        const t = NJW.fmt.time(new Date().toISOString());
        bi(field('last-poll'), 'Diperbarui ' + t, 'Updated ' + t);
      } catch (e) {
        if (e && e.status === 401) fail(e);
        // otherwise app.js's connection indicator already says so
      }
    }

    /* ---- release: never silent, and it always names the holder ---- */
    const dlg = () => $('#dlg-release');
    const scrim = () => $('.scrim');
    function closeDialog() {
      const d = dlg(), sc = scrim();
      if (d) d.classList.remove('is-open');
      if (sc) sc.classList.remove('is-open');
    }

    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="apply-staged"]')) {
        if (staged) { render(staged); staged = null; }
        const pill = $('.stagepill');
        if (pill) pill.classList.remove('is-on');
        return;
      }
      if (e.target.closest('[data-action="poll-now"]')) return poll(true);

      const btn = e.target.closest('[data-release]');
      if (btn) {
        const holder = btn.dataset.holder || '—';
        setF('dlg-holder', holder);
        setF('dlg-avatar', initials(holder));
        setF('dlg-ref', btn.dataset.ref || '—');
        bi(field('dlg-held'), (btn.dataset.held || '?') + ' menit', (btn.dataset.held || '?') + ' min');
        const confirm = $('[data-action="confirm-release"]');
        if (confirm) confirm.dataset.taskId = btn.dataset.release;
        const d = dlg(), sc = scrim();
        if (d) d.classList.add('is-open');
        if (sc) sc.classList.add('is-open');
        return;
      }

      const rel = e.target.closest('[data-action="confirm-release"]');
      if (rel) {
        const id = rel.dataset.taskId;
        if (!id) return;
        closeDialog();
        try {
          await api().releasePickTask(id);
          say(localStorage.getItem('njw.lang') === 'en' ? 'Released to the queue.' : 'Dikembalikan ke antrean.');
          await poll(true);
        } catch (err) { fail(err); }
      }
    });

    await poll(true);
    setInterval(() => { if (!document.hidden) poll(false); }, POLL_MS);
    setInterval(tick, TICK_MS);
  };
})();
