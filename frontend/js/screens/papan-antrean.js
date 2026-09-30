/* papan-antrean.js — console: the queue board (PRD §6.2 step 6, §6.5.4).
 *
 * The WMS gives out every order by itself; this board is where the SPV sees
 * it happen and steps in:
 *
 *  - the pickers: ready (and since when), on a break, off, and who holds what;
 *  - five lanes: Menunggu (with Terjadwal, scheduled and not yet due, last),
 *    Sedang diambil (picker and time since assigned), Menunggu dikemas,
 *    Menunggu driver (amber past handover_wait_minutes), Selesai hari ini;
 *  - Pindahkan on an order: to a named picker or the one ready longest, with
 *    a reason, audited.
 *
 * Waiting orders keep the server's order: least time left first. Clocks tick
 * locally from server-computed seconds, never from the laptop's own time, so
 * a wrong station clock cannot mis-band the queue.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = () => NJW.api;

  const POLL_MS = 5000;
  const TICK_MS = 15000;

  const CHANNEL = { grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram' };
  const URGENCY = {
    normal: ['agechip--fresh', 'Sesuai jadwal', 'On time'],
    ageing: ['agechip--ageing', 'Hampir habis', 'Running out'],
    late: ['agechip--late', 'Terlambat', 'Late'],
  };
  const STATE = {
    ready: ['spill--ok', 'Siap', 'Ready'],
    break: ['spill--warn', 'Istirahat', 'On a break'],
    off: ['spill--neutral', 'Tidak aktif', 'Off'],
  };

  // Mirrors the server's _urgency: late once the promise has passed, ageing
  // in the final third of the window (never less than a minute).
  function urgencyOf(remaining, windowSec) {
    if (remaining == null) return 'normal';
    if (remaining <= 0) return 'late';
    if (windowSec && remaining <= Math.max(60, Math.floor(windowSec / 3))) return 'ageing';
    return 'normal';
  }

  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };
  const mins = s => Math.max(0, Math.floor((s || 0) / 60));
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const shortName = (name, email) => name || (email || '').split('@')[0] || '?';

  NJW.screens['papan-antrean'] = async () => {
    const site = W.site();
    if (site.site_type === 'hub' && NJW.applySiteType) return NJW.applySiteType('hub', site.code);

    bi($('.page__eyebrow'), 'Masuk & keluar · ' + site.code, 'Inbound & outbound · ' + site.code);

    let staged = null;
    let current = null;   // the board last rendered

    /* ---- card parts ---- */

    function rackDots(racks) {
      if (!racks || !racks.length) return '';
      return '<span class="pcard__racks"><span class="pcard__racks-label" ' +
        biAttr('Rak', 'Racks') + '>Rak</span>' +
        racks.map(r => '<span class="rackdot">' + esc(r) + '</span>').join('') + '</span>';
    }

    const testBadge = c => c.is_test
      ? '<span class="badge-test" ' + biAttr('UJI COBA', 'TEST') + '>UJI COBA</span>' : '';

    function head(c) {
      const ch = CHANNEL[c.channel] || c.channel || '';
      return '<span class="pcard__rule" aria-hidden="true"></span>' +
        '<span class="pcard__top"><span class="pcard__ref" data-field="ref">' +
        esc(c.short_no || c.external_ref) + '</span>' + testBadge(c) +
        (ch ? '<span class="note">' + esc(ch) + '</span>' : '') + '</span>';
    }

    // The big number is minutes left (or minutes late), with the words beside it.
    function clock(c) {
      const u = urgencyOf(c.remaining_seconds, c._window);
      const [cls, id, enT] = URGENCY[u];
      const r = c.remaining_seconds;
      let num = '', unitId = 'tanpa janji waktu', unitEn = 'no promised time';
      if (r != null && r > 0) { num = Math.ceil(r / 60); unitId = 'menit lagi'; unitEn = 'min left'; }
      else if (r != null) { num = Math.max(1, Math.ceil(-r / 60)); unitId = 'menit terlambat'; unitEn = 'min late'; }
      const due = c.promised_at ? NJW.fmt.time(c.promised_at) : null;
      return '<span class="pcard__age">' +
        '<span class="pcard__age-num" data-field="age">' + num + '</span>' +
        '<span class="pcard__age-unit" data-field="age-unit" ' + biAttr(unitId, unitEn) + '>' + unitId + '</span>' +
        '<span class="agechip ' + cls + '" data-field="urgency"><span class="agechip__dot"></span><span ' +
        biAttr(id, enT) + '>' + id + '</span></span></span>' +
        (due ? '<span class="note" style="font-size:var(--fs-c-meta)" ' +
          biAttr('Siap paling lambat ' + due + ' · masuk ' + mins(c.age_seconds) + ' menit lalu',
                 'Ready by ' + due + ' · arrived ' + mins(c.age_seconds) + ' min ago') + '></span>' : '');
    }

    function facts(c) {
      return '<span class="pcard__facts">' +
        '<span><span class="n">' + c.line_count + '</span> <span ' +
        biAttr('barang', 'lines') + '>barang</span></span>' +
        '<span class="dot">·</span>' +
        '<span><span class="n">' + c.total_units + '</span> <span ' +
        biAttr('unit', 'units') + '>unit</span></span></span>';
    }

    function noteLine(c) {
      if (!c.requeue_count && !c.reassign_note) return '';
      const text = c.requeue_count
        ? ['Kembali ke antrean ' + c.requeue_count + 'x', 'Back in the queue ' + c.requeue_count + 'x']
        : ['Dipindahkan', 'Moved'];
      return '<span class="shortflag"><span aria-hidden="true">!</span><span ' +
        biAttr(text[0], text[1]) + '></span>' +
        (c.reassign_note ? ' <span class="note" style="font-family:var(--font-ui)">' + esc(c.reassign_note) + '</span>' : '') +
        '</span>';
    }

    function cardAttrs(c, extra) {
      return ' data-task="' + c.id + '" data-remaining-seconds="' +
        (c.remaining_seconds == null ? '' : c.remaining_seconds) +
        '" data-window-seconds="' + (c._window || '') + '"' + (extra || '');
    }

    function moveBtn(c, primary) {
      return '<button class="cbtn ' + (primary ? 'cbtn--primary' : 'cbtn--sm') + '" type="button" data-move="' + c.id +
        '"><span ' + biAttr('Pindahkan', 'Move') + '>Pindahkan</span></button>';
    }

    function waitingCard(c) {
      if (c.scheduled_hold) {
        const at = c.scheduled_at ? NJW.fmt.time(c.scheduled_at) : '';
        return '<article class="pcard' + (c.is_test ? ' is-test' : '') + '" data-task="' + c.id + '">' + head(c) +
          '<span class="agechip agechip--held"><span class="agechip__dot"></span><span ' +
          biAttr('Terjadwal ' + at, 'Scheduled ' + at) + '></span></span>' +
          '<span class="note" ' + biAttr('Diberikan ke picker saat waktunya tiba.', 'Given to a picker when it is due.') + '></span>' +
          facts(c) + '</article>';
      }
      const u = urgencyOf(c.remaining_seconds, c._window);
      return '<article class="pcard' + (u === 'normal' ? '' : ' is-' + u) + (c.is_test ? ' is-test' : '') +
        '"' + cardAttrs(c) + '>' + head(c) + clock(c) + facts(c) + rackDots(c.racks) + noteLine(c) +
        (c.status === 'blocked' ? '<span class="shortflag"><span aria-hidden="true">!</span><span ' +
          biAttr('Terkunci: perlu supervisor', 'Blocked: needs a supervisor') + '></span></span>' : '') +
        '<span class="pcard__foot"><span class="toolbar__spacer"></span>' + moveBtn(c, false) + '</span>' +
        '</article>';
    }

    function claimedCard(c, startSec) {
      const held = c.held_seconds || 0;
      const unstarted = !c.started_at;
      const warn = unstarted && held >= Math.max(30, startSec / 2);
      const u = urgencyOf(c.remaining_seconds, c._window);
      const who = shortName(c.claimed_by_name, c.claimed_by);
      return '<article class="pcard' + (warn ? ' is-stuck' : u === 'late' ? ' is-late' : '') +
        (c.is_test ? ' is-test' : '') + '"' +
        cardAttrs(c, ' data-held-seconds="' + held + '"') + '>' + head(c) + clock(c) +
        facts(c) + rackDots(c.racks) + noteLine(c) +
        '<span class="pcard__picker"><span class="pcard__avatar" aria-hidden="true">' +
        esc(initials(who)) + '</span><span class="pcard__who">' +
        '<span class="pcard__who-name">' + esc(who) + '</span>' +
        '<span class="pcard__who-held" data-field="held" ' +
        biAttr('Diberikan ' + mins(held) + ' menit lalu · ' + c.picked_units + '/' + c.total_units + ' unit',
               'Assigned ' + mins(held) + ' min ago · ' + c.picked_units + '/' + c.total_units + ' units') + '></span>' +
        '</span></span>' +
        '<span class="pcard__foot">' +
        (unstarted
          ? '<span class="agechip agechip--stuck"><span class="agechip__dot"></span><span ' +
            biAttr('Belum dimulai', 'Not started') + '></span></span>'
          : '<span class="agechip agechip--held"><span class="agechip__dot"></span><span ' +
            biAttr('Sedang diambil', 'Being picked') + '></span></span>') +
        '<span class="toolbar__spacer"></span>' + moveBtn(c, warn) +
        '</span></article>';
    }

    function packCard(c) {
      const who = shortName(c.claimed_by_name, c.claimed_by);
      return '<article class="pcard' + (c.is_test ? ' is-test' : '') + '" data-task="' + c.id + '">' + head(c) +
        '<span class="pcard__age"><span class="pcard__age-num">' + mins(c.waiting_seconds) + '</span>' +
        '<span class="pcard__age-unit" ' + biAttr('menit di meja packing', 'min at the pack bench') + '></span></span>' +
        facts(c) + '<span class="note" ' + biAttr('Diambil oleh ' + who, 'Picked by ' + who) + '></span></article>';
    }

    function driverCard(c, limit) {
      const late = c.waiting_seconds != null && c.waiting_seconds >= limit;
      return '<article class="pcard' + (late ? ' is-late' : '') + (c.is_test ? ' is-test' : '') + '" data-task="' + c.id + '">' +
        head(c) +
        '<span class="pcard__age"><span class="pcard__age-num">' + mins(c.waiting_seconds) + '</span>' +
        '<span class="pcard__age-unit" ' + biAttr('menit menunggu driver', 'min waiting for the driver') + '></span>' +
        (late ? '<span class="agechip agechip--late"><span class="agechip__dot"></span><span ' +
          biAttr('Cek di Hiryu', 'Check in Hiryu') + '></span></span>' : '') +
        '</span>' +
        '<span class="note" ' + biAttr('Dikemas ' + NJW.fmt.time(c.packed_at), 'Packed ' + NJW.fmt.time(c.packed_at)) + '></span>' +
        '</article>';
    }

    function pickerChip(p) {
      const [cls, id, enT] = STATE[p.state] || STATE.off;
      const who = shortName(p.name, p.email);
      let extra = '';
      if (p.task_id) {
        extra = '<span class="note">' + esc(p.order_ref || '') + ' · ' +
          '<span ' + (p.started
            ? biAttr(mins(p.held_seconds) + ' menit', mins(p.held_seconds) + ' min')
            : biAttr('belum dimulai', 'not started')) + '></span></span>';
      } else if (p.state === 'ready') {
        extra = '<span class="note" ' + biAttr('menunggu pesanan', 'waiting for an order') + '></span>';
      }
      return '<span class="pcard" style="flex-direction:row;align-items:center;gap:10px;padding:10px 14px">' +
        '<span class="pcard__avatar" aria-hidden="true">' + esc(initials(who)) + '</span>' +
        '<span class="pcard__who"><span class="pcard__who-name">' + esc(who) + '</span>' + extra + '</span>' +
        '<span class="spill ' + cls + '"><span class="spill__dot"></span><span ' + biAttr(id, enT) + '></span></span>' +
        (p.phone_online ? '' : '<span class="note" style="color:var(--caution)" ' +
          biAttr('HP tidak terhubung', 'Phone not connected') + '></span>') +
        '</span>';
    }

    /* ---- render ---- */

    function render(board) {
      current = board;
      const lane = k => board.lanes.find(l => l.key === k) || { cards: [], count: 0 };
      const waiting = lane('waiting'), claimed = lane('picking'), toPack = lane('to_pack'),
        toDriver = lane('to_driver'), done = lane('done_today');
      const th = board.thresholds || {};
      const startSec = th.pick_start_seconds || 120;
      const driverLimit = th.handover_wait_seconds || 1200;
      // The promise window (created -> promised) is what "final third" is
      // measured against; age + remaining reconstructs it without a second clock.
      [waiting, claimed].forEach(l => l.cards.forEach(c => {
        c._window = c.remaining_seconds == null ? null : c.age_seconds + c.remaining_seconds;
      }));

      const put = (key, cards, fn, emptyId, emptyEn) => {
        const host = region(key);
        if (!host) return;
        host.innerHTML = cards.length ? cards.map(fn).join('')
          : '<p class="note" ' + biAttr(emptyId, emptyEn) + '></p>';
      };
      put('waiting', waiting.cards, waitingCard, 'Antrean kosong.', 'The queue is empty.');
      put('claimed', claimed.cards, c => claimedCard(c, startSec), 'Tidak ada yang sedang diambil.', 'Nobody is picking.');
      put('to-pack', toPack.cards, packCard, 'Tidak ada yang menunggu dikemas.', 'Nothing waiting to pack.');
      put('to-driver', toDriver.cards, c => driverCard(c, driverLimit), 'Tidak ada tas yang menunggu.', 'No bags waiting.');

      const dHost = region('done');
      if (dHost) dHost.innerHTML = done.cards.length ? done.cards.slice(0, 12).map(c => {
        const late = c.promised_at && c.packed_at && NJW.toDate(c.packed_at) > NJW.toDate(c.promised_at);
        return '<span class="donerow"><span class="donerow__ref">' + esc(c.short_no || c.external_ref) +
          ' <span class="note" style="font-family:var(--font-ui)">' + esc(CHANNEL[c.channel] || '') +
          (late ? ' · <span ' + biAttr('siap terlambat', 'ready late') + '></span>' : '') + '</span></span>' +
          '<span class="donerow__time">' + NJW.fmt.time(c.handed_over_at) + '</span></span>';
      }).join('') +
        (done.count > 12 ? '<span class="donerow" style="color:var(--muted-2)"><span ' +
          biAttr('dan ' + (done.count - 12) + ' lainnya', 'and ' + (done.count - 12) + ' more') + '></span></span>' : '')
        : '<span class="donerow" style="color:var(--muted-2)"><span ' +
          biAttr('Belum ada yang selesai hari ini.', 'Nothing finished yet today.') + '></span></span>';

      // Average from arrival to handover, computed or nothing: an invented
      // average on an ops board is a number someone will quote in a meeting.
      const finished = done.cards.filter(c => c.handed_over_at && c.created_at);
      if (finished.length) {
        const avg = finished.reduce((n, c) =>
          n + (NJW.toDate(c.handed_over_at) - NJW.toDate(c.created_at)) / 1000, 0) / finished.length;
        bi(field('avg-pick'), Math.floor(avg / 60) + ' mnt ' + Math.round(avg % 60) + ' dtk',
                              Math.floor(avg / 60) + ' min ' + Math.round(avg % 60) + ' s');
      } else {
        bi(field('avg-pick'), '', '');
      }

      const live = waiting.cards.filter(c => !c.scheduled_hold);
      const unstarted = claimed.cards.filter(c => !c.started_at);
      const driverLate = toDriver.cards.filter(c => (c.waiting_seconds || 0) >= driverLimit);
      setF('count-waiting', waiting.count);
      setF('count-claimed', claimed.count);
      setF('count-unstarted', unstarted.length);
      setF('count-pack', toPack.count);
      setF('count-driver', toDriver.count);
      setF('count-driver-late', driverLate.length);
      setF('count-done', done.count);
      const oldestEl = field('oldest-waiting');
      if (oldestEl) {
        if (board.oldest_waiting_seconds == null) bi(oldestEl, '', '');
        else bi(oldestEl, mins(board.oldest_waiting_seconds) + ' menit', mins(board.oldest_waiting_seconds) + ' min');
      }

      /* ---- pickers ---- */
      const pickers = board.pickers || [];
      const ready = pickers.filter(p => p.state === 'ready');
      setF('count-ready', ready.length);
      const pm = field('pickers-meta');
      if (pm) {
        const onBreak = pickers.filter(p => p.state === 'break').length;
        bi(pm, onBreak + ' istirahat · ' + ready.filter(p => !p.task_id).length + ' menunggu pesanan',
               onBreak + ' on a break · ' + ready.filter(p => !p.task_id).length + ' waiting for an order');
      }
      const pHost = region('pickers');
      if (pHost) pHost.innerHTML = pickers.length ? pickers.map(pickerChip).join('')
        : '<p class="note" ' + biAttr('Belum ada picker yang menekan Siap ambil hari ini.',
                                      'No picker has tapped Siap ambil today.') + '></p>';

      /* ---- what needs the SPV now ---- */
      const alert = region('alert');
      if (alert) {
        const late = live.filter(c => urgencyOf(c.remaining_seconds, c._window) === 'late').length +
          claimed.cards.filter(c => urgencyOf(c.remaining_seconds, c._window) === 'late').length;
        const requeued = live.filter(c => c.requeue_count > 0).length;
        const idle = live.length && !ready.some(p => !p.task_id && p.phone_online);
        const partsId = [], partsEn = [];
        if (idle) { partsId.push(live.length + ' pesanan menunggu dan tidak ada picker yang siap'); partsEn.push(live.length + ' orders waiting and no picker ready'); }
        if (late) { partsId.push(late + ' pesanan terlambat'); partsEn.push(late + ' orders late'); }
        if (requeued) { partsId.push(requeued + ' pesanan kembali ke antrean karena belum dimulai'); partsEn.push(requeued + ' orders back in the queue, not started'); }
        if (driverLate.length) { partsId.push(driverLate.length + ' tas menunggu driver lebih dari ' + mins(driverLimit) + ' menit: cek di Hiryu'); partsEn.push(driverLate.length + ' bags waiting for a driver over ' + mins(driverLimit) + ' min: check in Hiryu'); }
        alert.style.display = partsId.length ? '' : 'none';
        bi(field('alert-text'), partsId.join('. ') + '.', partsEn.join('. ') + '.');
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
          const [cls, id, enT] = URGENCY[u];
          chip.className = 'agechip ' + cls;
          bi(chip.lastElementChild, id, enT);
        }
        if (card.dataset.heldSeconds == null) {
          card.classList.toggle('is-ageing', u === 'ageing');
          card.classList.toggle('is-late', u === 'late');
        } else if (!card.classList.contains('is-stuck')) {
          card.classList.toggle('is-late', u === 'late');
        }
      });
    }

    function signature(board) {
      return board.lanes.map(l => l.key + ':' + l.cards.map(c =>
        c.id + c.status + (c.claimed_by || '') + c.picked_units + (c.started_at ? 's' : '') +
        (c.packed_at ? 'p' : '')).join('|')).join('~') + '#' +
        (board.pickers || []).map(p => p.email + p.state + (p.task_id || '') + (p.phone_online ? 1 : 0)).join('|');
    }

    let lastSig = null;
    let dialogOpen = false;

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
          lastSig = sig;
          if (dialogOpen) {
            // Park changes rather than reflowing cards under a supervisor who
            // is mid-decision; the pill is how the board asks permission.
            staged = board;
            const n = field('staged-count');
            if (n) n.textContent = board.lanes.reduce((t, l) => t + l.count, 0);
            const pill = $('.stagepill');
            if (pill) pill.classList.add('is-on');
          } else {
            render(board);
          }
        }
        const t = NJW.fmt.time(new Date().toISOString());
        bi(field('last-poll'), 'Diperbarui ' + t, 'Updated ' + t);
      } catch (e) {
        if (e && e.status === 401) fail(e);
        // otherwise app.js's connection indicator already says so
      }
    }

    /* ---- Pindahkan: never silent, always with a reason ---- */
    const dlg = () => $('#dlg-move');
    const scrim = () => $('.scrim');
    function closeDialog() {
      dialogOpen = false;
      const d = dlg(), sc = scrim();
      if (d) d.classList.remove('is-open');
      if (sc) sc.classList.remove('is-open');
    }

    function openMove(taskId) {
      const all = current ? current.lanes.flatMap(l => l.cards) : [];
      const c = all.find(x => x.id === taskId);
      if (!c) return;
      const holder = c.claimed_by ? shortName(c.claimed_by_name, c.claimed_by) : null;
      setF('dlg-ref', c.short_no || c.external_ref);
      const hr = region('dlg-holder');
      if (hr) hr.style.display = holder ? '' : 'none';
      if (holder) {
        setF('dlg-holder', holder);
        setF('dlg-avatar', initials(holder));
        bi(field('dlg-held'),
           (c.started_at ? 'Sedang diambil' : 'Belum dimulai') + ' · ' + mins(c.held_seconds) + ' menit',
           (c.started_at ? 'Being picked' : 'Not started') + ' · ' + mins(c.held_seconds) + ' min');
      }
      const sel = field('dlg-to');
      const pickers = (current.pickers || []).filter(p => p.email !== c.claimed_by);
      sel.innerHTML = '<option value="">' + esc(en() ? 'The picker ready longest' : 'Picker yang paling lama siap') + '</option>' +
        pickers.map(p => {
          const st = STATE[p.state] || STATE.off;
          const busy = p.task_id ? (en() ? ', holds ' : ', memegang ') + (p.order_ref || '') : '';
          return '<option value="' + esc(p.email) + '"' + (p.task_id ? ' disabled' : '') + '>' +
            esc(shortName(p.name, p.email)) + ' (' + esc(en() ? st[2] : st[1]) + busy + ')</option>';
        }).join('');
      const reason = field('dlg-reason');
      reason.value = '';
      const ok = $('[data-action="confirm-move"]');
      if (ok) ok.dataset.taskId = String(taskId);
      dialogOpen = true;
      const d = dlg(), sc = scrim();
      if (d) d.classList.add('is-open');
      if (sc) sc.classList.add('is-open');
      applyLangTo(d);
      reason.focus();
    }

    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="apply-staged"]')) {
        if (staged) { render(staged); staged = null; }
        const pill = $('.stagepill');
        if (pill) pill.classList.remove('is-on');
        return;
      }
      if (e.target.closest('[data-action="poll-now"]')) return poll(true);
      if (e.target.closest('[data-drawer-close]') || e.target === scrim()) { closeDialog(); return; }

      const mv = e.target.closest('[data-move]');
      if (mv) return openMove(+mv.dataset.move);

      const ok = e.target.closest('[data-action="confirm-move"]');
      if (ok) {
        const id = ok.dataset.taskId;
        const reason = (field('dlg-reason').value || '').trim();
        if (reason.length < 3) {
          return say(en() ? 'Write the reason first.' : 'Tulis alasannya dulu.');
        }
        const to = field('dlg-to').value || null;
        ok.disabled = true;
        try {
          const r = await api().raw.post('/pick-tasks/' + id + '/reassign', { to_email: to, reason });
          closeDialog();
          say(oneLang(r.message));
        } catch (err) {
          if (err.status === 401) return fail(err);
          say(oneLang(err.message));
        } finally { ok.disabled = false; }
        return poll(true);
      }
    });

    await poll(true);
    setInterval(() => { if (!document.hidden) poll(false); }, POLL_MS);
    setInterval(tick, TICK_MS);
  };
})();
