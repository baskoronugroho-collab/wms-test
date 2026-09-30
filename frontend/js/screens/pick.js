/* pick.js — 07: Ambil pesanan. The WMS gives the order; the picker scans it.
 *
 * Deploy 2 (PRD §6.2): nobody chooses an order. The screen has three faces:
 *
 *  - Siap ambil / Istirahat: the picker says they are ready (or on a break);
 *  - Menunggu pesanan: ready, hands empty. The phone polls /api/pickers/me
 *    every 3 s; when the WMS gives it an order it rings (when the browser
 *    allows sound) and opens the pick;
 *  - the pick itself, unchanged: one scan per unit, wrong product refused,
 *    Barang tidak ada with its look-elsewhere step.
 *
 * Rules this screen keeps:
 *  - One scan per unit. The shade gate (07 vs 08) exists per unit: a picker
 *    holding one of each and scanning once would otherwise ship the wrong one.
 *  - A wrong scan is refused by the server and there is no override here.
 *  - The location comes from the server, which splits an order line across
 *    rack and overflow oldest-first, so one SKU can be two stops, and every
 *    count here is per pick line (a stop), never per SKU. The day colour is
 *    the server's too: the batch that has sat longest at that location.
 *  - The server is the truth about who holds what. While picking, the phone
 *    keeps asking; an order cancelled from Hiryu or moved by the SPV closes
 *    here with the reason, instead of at the next scan.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, bi, biAttr, applyLangTo, say, fail, go, key, CTX } = W;
  const api = () => NJW.api;

  const CHANNEL = {
    grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram',
  };
  const WAIT_POLL_MS = 3000;   // waiting for an order: the PRD's 3 s
  const PICK_POLL_MS = 6000;   // while picking: only to notice a cancel or a move

  /* Short date for the day-colour prompt: "8 Sep", from the server's
     calendar date (already a Jakarta date, so no clock maths here). */
  const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(ymd, months) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
    return m ? (+m[3]) + ' ' + months[+m[2] - 1] : '';
  }

  const lang = () => localStorage.getItem('njw.lang') === 'en' ? 'en' : 'id';
  // Server messages arrive as "Indonesian / English".
  const oneLang = m => { const p = String(m || '').split(' / '); return (lang() === 'en' ? p[1] : p[0]) || m; };

  /* ---------- the ring ----------
     Browsers only let a page make sound after a tap on it. Siap ambil is that
     tap; a page opened already ready unlocks on the first touch anywhere. A
     phone that stays silent still vibrates, and the screen changes anyway. */
  let audioCtx = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* no sound on this device */ }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  function ring() {
    try {
      if (!audioCtx) unlockAudio();
      if (audioCtx) {
        const t = audioCtx.currentTime;
        [0, 0.28, 0.56].forEach(d => {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = 'sine';
          o.frequency.value = d === 0.28 ? 1175 : 880;
          g.gain.setValueAtTime(0.0001, t + d);
          g.gain.exponentialRampToValueAtTime(0.5, t + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22);
          o.connect(g); g.connect(audioCtx.destination);
          o.start(t + d); o.stop(t + d + 0.24);
        });
      }
    } catch (e) { /* silent is fine */ }
    try { if (navigator.vibrate) navigator.vibrate([250, 120, 250]); } catch (e) { /* no vibration */ }
  }

  /* ---------- the screen ---------- */

  NJW.screens.pick = async () => {
    const site = W.site();
    if (!site) return;
    CTX.del('wrong');

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    const fifoEl = region('fifo');
    const FIFO_TPL = fifoEl ? fifoEl.innerHTML : '';
    const main = $('.main');
    const pickParts = [$('.progress'), $('.main .row-split')].filter(Boolean);

    let pollTimer = null;
    const stopPoll = () => { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; };

    function setMode(id, en) {
      const mode = $('.chrome__mode');
      if (mode) { mode.dataset.keep = '1'; bi(mode, id, en); }
    }

    const meUrl = () => '/pickers/me?site_id=' + site.id;

    /* ---------- waiting and choosing ---------- */

    let box = null;
    function panel(html) {
      pickParts.forEach(el => { el.style.display = 'none'; });
      if (!box) {
        box = document.createElement('div');
        box.className = 'col wire-waitbox';
        box.style.cssText = 'gap:16px;flex:1 1 auto';
        main.insertBefore(box, main.firstChild);
      }
      box.innerHTML = html;
      applyLangTo(box);
      return box;
    }

    function noteHtml(m) {
      if (!m.note) return '';
      const p = String(m.note).split(' / ');
      return '<div class="notice notice--caution" style="text-align:left;max-width:640px">' +
        '<span class="code code--sm" aria-hidden="true">!</span>' +
        '<span class="notice__body" ' + biAttr(p[0], p[1] || p[0]) + '></span></div>';
    }

    function queueText(m) {
      const n = m.waiting_orders || 0;
      return n ? [n + ' pesanan di antrean.', n + (n === 1 ? ' order' : ' orders') + ' in the queue.']
               : ['Antrean kosong.', 'The queue is empty.'];
    }

    // Break or off: the two big choices.
    function showChoice(m) {
      stopPoll();
      setMode('Ambil pesanan', 'Pick order');
      const onBreak = m.state === 'break';
      const el = panel(
        '<div class="emptystate">' +
        '<span class="emptystate__mark" aria-hidden="true" style="background:var(--action-bg);color:var(--action)">' +
          (onBreak ? '||' : '?') + '</span>' +
        '<span class="emptystate__title" ' + (onBreak
          ? biAttr('Sedang istirahat', 'On a break')
          : biAttr('Siap ambil pesanan?', 'Ready to pick?')) + '></span>' +
        '<span class="emptystate__body" ' + biAttr(
          'WMS memberi pesanan satu per satu ke picker yang siap. Tekan Siap ambil kalau kamu siap.',
          'The WMS gives orders one at a time to pickers who are ready. Tap Siap ambil when you are.') + '></span>' +
        noteHtml(m) +
        '<div class="stats" style="width:100%;max-width:640px">' +
          '<button class="btn btn--primary btn--lg btn--grow" type="button" data-act="ready" style="min-height:96px;font-size:26px" ' +
            biAttr('Siap ambil', 'Ready to pick') + '></button>' +
          '<button class="btn btn--outline btn--lg' + (onBreak ? ' is-locked' : '') + '" type="button" data-act="break" ' +
            (onBreak ? 'disabled ' : '') + biAttr('Istirahat', 'Take a break') + '></button>' +
        '</div>' +
        '<a class="btn btn--outline" href="index.html" ' + biAttr('Menu', 'Menu') + '></a>' +
        '</div>');
      el.onclick = onPanelClick;
    }

    // Ready with empty hands: wait for the WMS.
    function showWaiting(m) {
      setMode('Menunggu pesanan', 'Waiting for an order');
      const q = queueText(m);
      const el = panel(
        '<div class="emptystate">' +
        '<span class="emptystate__mark" aria-hidden="true">✓</span>' +
        '<span class="emptystate__title" ' + biAttr('Menunggu pesanan', 'Waiting for an order') + '></span>' +
        '<span class="emptystate__body" ' + biAttr(
          'Pesanan berikutnya langsung terbuka di sini dan HP berbunyi. Tidak perlu menekan apa pun.',
          'The next order opens here by itself and the phone rings. No need to tap anything.') + '></span>' +
        '<span class="note" data-field="queue" ' + biAttr(q[0], q[1]) + '></span>' +
        noteHtml(m) +
        '<div class="stats" style="width:100%;max-width:640px">' +
          '<button class="btn btn--outline btn--lg btn--grow" type="button" data-act="break" ' +
            biAttr('Istirahat', 'Take a break') + '></button>' +
        '</div>' +
        '<span class="note" ' + biAttr(
          'Mau keluar dari layar ini? Tekan Istirahat dulu, supaya pesanan diberikan ke orang lain.',
          'Leaving this screen? Tap Istirahat first, so orders go to someone else.') + '></span>' +
        '</div>');
      el.onclick = onPanelClick;
    }

    let busy = false;
    async function onPanelClick(e) {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled || busy) return;
      busy = true;
      unlockAudio();
      try {
        const m = await api().raw.post('/pickers/' + (b.dataset.act === 'ready' ? 'ready' : 'break'),
                                       { site_id: site.id });
        if (m.task_id) ring();
        route(m);
      } catch (err) {
        if (err.status === 401) return fail(err);
        say(oneLang(err.message));
      } finally { busy = false; }
    }

    // One place decides which face the screen shows.
    function route(m) {
      if (m.task_id) return openTask(m.task_id, true);
      if (m.state === 'ready') {
        showWaiting(m);
        schedulePoll();
      } else {
        showChoice(m);
      }
    }

    function schedulePoll() {
      stopPoll();
      pollTimer = setTimeout(async () => {
        pollTimer = null;
        let m = null;
        try { m = await api().raw.get(meUrl()); }
        catch (err) {
          if (err.status === 401) return fail(err);
          // app.js's connection indicator already says so; keep trying.
          return schedulePoll();
        }
        if (m.task_id) { ring(); return openTask(m.task_id, true); }
        if (m.state !== 'ready') return showChoice(m);
        const qEl = box && $('[data-field="queue"]', box);
        if (qEl) { const q = queueText(m); bi(qEl, q[0], q[1]); }
        schedulePoll();
      }, document.hidden ? WAIT_POLL_MS * 2 : WAIT_POLL_MS);
    }

    /* ---------- an order: open it ---------- */

    async function openTask(taskId, fresh) {
      stopPoll();
      let task;
      try {
        // For the holder, claim changes nothing and returns the order.
        task = await api().raw.post('/pick-tasks/' + taskId + '/claim', {});
      } catch (err) {
        if (err.status === 401) return fail(err);
        say(oneLang(err.message));
        // Moved or cancelled in the same instant: back to what the server says.
        return setTimeout(boot, 1500);
      }
      const saved = CTX.get('task');
      CTX.set('task', {
        id: task.id, external_ref: (task.short_no || task.external_ref),
        // A duration for the done screen, from when this phone opened it.
        startedAt: saved && saved.id === task.id && saved.startedAt ? saved.startedAt
          : (fresh ? new Date().toISOString() : null),
      });
      if (box) { box.remove(); box = null; }
      pickParts.forEach(el => { el.style.display = ''; });
      runPick(task);
    }

    async function boot() {
      let m;
      try { m = await api().raw.get(meUrl()); }
      catch (e) { return fail(e); }
      route(m);
    }

    /* ---------- the pick (unchanged rules) ---------- */

    function runPick(task) {
      const meta = { channel: task.channel, delivery_mode: task.delivery_mode, promised_at: task.promised_at };
      let leaving = false;      // set once the screen is navigating away

      const pending = () => task.lines.filter(l => l.status === 'pending');
      const currentLine = () => pending()[0];

      /* The order was taken away (cancelled from Hiryu, moved by the SPV):
         say why, then back to waiting, where the WMS gives the next order. */
      function lost(msg) {
        if (leaving) return;
        leaving = true;
        stopWatch();
        CTX.del('task');
        if (msg) say(msg);
        setTimeout(() => location.reload(), 3000);
      }

      /* While picking, a slow poll notices an order that was cancelled or
         moved, so the picker does not keep walking the aisle for nothing. */
      let watchTimer = null;
      function stopWatch() { if (watchTimer) clearInterval(watchTimer); watchTimer = null; }
      function watch() {
        stopWatch();
        watchTimer = setInterval(async () => {
          if (leaving || document.hidden) return;
          let m;
          try { m = await api().raw.get(meUrl()); } catch (e) { return; }
          if (leaving) return;
          if (m.task_id !== task.id) {
            lost(m.note ? oneLang(m.note)
              : (lang() === 'en' ? 'This order is no longer yours.' : 'Pesanan ini sudah tidak kamu pegang.'));
          }
        }, PICK_POLL_MS);
      }

      function finish() {
        leaving = true;
        stopWatch();
        const saved = CTX.get('task') || {};
        CTX.set('doneTask', {
          task, meta, startedAt: saved.startedAt || null,
          finishedAt: new Date().toISOString(), handed: false,
        });
        CTX.del('task');
        setTimeout(() => go('09-pesanan-selesai.html'), 500);
      }

      // Every line already picked: the order is ready to hand off. This is
      // also where a picker who never tapped "hand off" lands.
      if (!currentLine()) return finish();

      setMode('Ambil pesanan · ' + (task.short_no || task.external_ref),
              'Pick order · ' + (task.short_no || task.external_ref));

      /* ---------- painting ---------- */

      function paintProgress() {
        // Units, not lines: a SKU split over rack and overflow is two stops but
        // one item on the order, and "3 / 7" must mean items in the tote.
        const want = task.lines.reduce((n, l) => n + l.qty_required, 0);
        const got = task.lines.reduce((n, l) => n + Math.min(l.qty_picked, l.qty_required), 0);
        const count = $('.progress__count');
        if (count) count.textContent = got + ' / ' + want;
        const bar = $('.progress__bar');
        if (bar) bar.innerHTML = task.lines.map(l =>
          '<span class="progress__seg' + (l.status !== 'pending' ? ' is-done' : '') + '"></span>').join('');
        const tag = $('.progress .code--sm');
        if (tag) {
          const ch = CHANNEL[meta.channel] || (task.is_test ? 'Uji coba' : '');
          if (meta.promised_at) {
            const t = NJW.fmt.time(meta.promised_at);
            bi(tag, ch + ' · siap jam ' + t, ch + ' · ready by ' + t);
          } else {
            bi(tag, ch, ch);
          }
        }
      }

      let paintToken = 0;

      function paintLine() {
        const line = currentLine();
        if (!line) return;
        const token = ++paintToken;
        paintProgress();

        const codeEl = $('.code--xl');
        if (codeEl) codeEl.innerHTML = line.location_code ? W.codeHtml(line.location_code) : '?';
        const lede = $('.instr') && $('.instr').parentNode.querySelector('.lede');
        if (lede) {
          if (!line.location_code) {
            bi(lede, 'Barang ini belum punya tempat. Pakai tombol "Barang tidak ada".',
                     'This item has no location yet. Use "Item is not in the basket".');
          } else if (line.rack_code) {
            const over = line.slot_role === 'overflow';
            bi(lede, 'Rak ' + line.rack_code + ', tingkat ' + line.level_no +
                     (over ? '. Tempat overflow: stok di sini lebih lama.' : '.'),
                     'Rack ' + line.rack_code + ', level ' + line.level_no +
                     (over ? '. The overflow: the stock here is older.' : '.'));
          } else {
            bi(lede, '', '');
          }
        }

        paintCounter(line);
        const onHandEl = $('.counter .lede');
        bi(onHandEl, 'Sisa di keranjang: …', 'Left in basket: …');

        const img = $('.product__photo');
        if (img) {
          img.dataset.photoKey = line.photo_key || (line.brand_sku_code || '').toLowerCase();
          img.alt = line.sku_name;
        }
        const name = $('.product__name'); if (name) name.textContent = line.sku_name;
        const metaEl = $('.product__meta');
        if (metaEl) metaEl.textContent = [line.unit_size, line.brand_sku_code].filter(Boolean).join(' · ');
        if (NJW.paintPhotos) NJW.paintPhotos();

        // A unit-labelled product is confirmed by its Ninja plate, not a barcode.
        // Only the resting text changes; an accept banner still showing keeps
        // its detail until scan.js returns the zone to rest.
        if (zone && zone.promptEl) {
          const [pid, pen] = line.identity_mode === 'unit_label'
            ? ['Pindai label Ninja pada barangnya', 'Scan the Ninja label on the item']
            : ['Pindai barang yang kamu ambil', 'Scan the item you picked'];
          zone.promptEl.dataset.id = pid;
          zone.promptEl.dataset.en = pen;
          zone.restingPrompt = lang() === 'en' ? pen : pid;
          if (zone.state === 'waiting') zone.promptEl.textContent = zone.restingPrompt;
        }

        paintFifo(line);
        paintTestCodes(line);
        loadOnHand(line, token);
      }

      function paintCounter(line) {
        const num = $('.counter__num');
        if (num) num.textContent = Math.max(0, line.qty_required - line.qty_picked);
      }

      /* What the basket holds, for "left in basket". One read per stop; a slow
         answer for a stop the picker has already moved past is dropped. */
      async function loadOnHand(line, token) {
        if (!line.location_id) return;
        const inv = await api().inventory({ site_id: site.id, q: line.sku_name, limit: 50 }).catch(() => null);
        if (token !== paintToken) return;
        const row = inv && inv.rows.find(r => r.sku_id === line.sku_id && r.location_code === line.location_code);
        line._onHand = row ? row.qty_on_hand : null;
        paintOnHand(line);
        // An empty basket has no oldest batch to point at.
        if (line._onHand === 0 && fifoEl) fifoEl.style.display = 'none';
      }

      function paintOnHand(line) {
        const el = $('.counter .lede');
        if (line._onHand == null) bi(el, '', '');
        else bi(el, 'Sisa di keranjang: ' + line._onHand, 'Left in basket: ' + line._onHand);
      }

      /* Colour + day name + date, never the swatch alone. The colour is the
         day this location went from empty to stocked (server: stocked_since).
         Unknown (seeded or reset stock) counts as oldest, so say that rather
         than guess a colour. */
      function paintFifo(line) {
        if (!fifoEl) return;
        fifoEl.innerHTML = FIFO_TPL;
        fifoEl.hidden = false;
        fifoEl.style.display = line.location_id ? '' : 'none';
        const block = field('fifo-block', fifoEl);
        const also = $('.fifo__also', fifoEl);
        if (also) also.style.display = 'none';   // one batch colour per location
        const o = line.oldest_day_color;
        if (o) {
          block.style.background = o.hex;
          block.style.color = o.ink;
          block.textContent = o.week_parity;
          block.title = 'W' + o.iso_week;
          bi(field('fifo-day', fifoEl), o.day_id, o.day_en);
          bi(field('fifo-date', fifoEl), shortDate(o.date, MONTHS_ID), shortDate(o.date, MONTHS_EN));
        } else {
          block.style.background = 'var(--surface-2, #eee)';
          block.style.color = 'var(--ink)';
          block.textContent = '?';
          $('.fifo__lead', fifoEl).innerHTML = '<span ' +
            biAttr('Ambil stok yang paling lama dulu', 'Take the oldest stock first') +
            '>Ambil stok yang paling lama dulu</span>';
          $('.fifo__sub', fifoEl).innerHTML = '<span ' +
            biAttr('tanggal masuk stok di sini tidak tercatat', 'the arrival date of this stock is not recorded') +
            '>tanggal masuk stok di sini tidak tercatat</span>';
        }
        applyLangTo(fifoEl);
      }

      /* Training only: the right barcode and a wrong one for the current line,
         so a trainee can see the gate refuse without owning the wrong shade. */
      let sheet = null;
      async function paintTestCodes(line) {
        if (!site.is_training || !zoneEl) return;
        try {
          if (!sheet) sheet = await api().raw.get('/training/barcode-sheet?site_id=' + site.id + '&limit=500');
        } catch { return; }
        let tbox = $('.wire-testcodes');
        if (!tbox) {
          tbox = document.createElement('div');
          tbox.className = 'panel wire-testcodes';
          tbox.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
          zoneEl.parentNode.insertBefore(tbox, zoneEl.nextSibling);
        }
        const right = sheet.rows.find(r => r.sku_id === line.sku_id);
        const wrong = sheet.rows.find(r => r.sku_id !== line.sku_id);
        tbox.innerHTML = '<span class="eyebrow" ' + biAttr('Barcode uji', 'Test barcodes') + '>Barcode uji</span>';
        [[right, 'Benar', 'Right'], [wrong, 'Salah', 'Wrong']].forEach(([r, id, en]) => {
          if (!r) return;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn--outline';
          b.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px';
          b.textContent = (lang() === 'en' ? en : id) + ': ' + r.sku_name.slice(0, 26);
          b.title = r.sku_name + ' · ' + r.barcode;
          b.onclick = () => enqueue(r.barcode);
          tbox.appendChild(b);
        });
        applyLangTo(tbox);
      }

      /* ---------- scanning ---------- */

      // Scans are applied one at a time, in order: a gun can fire faster than a
      // round trip, and each unit must land on the line that was current for it.
      let chain = Promise.resolve();
      const enqueue = code => { chain = chain.then(() => doScan(code)); };

      async function doScan(code) {
        const line = currentLine();
        if (!line || leaving) return;
        try {
          const r = await api().raw.post('/pick-lines/' + line.id + '/confirm',
            { code, qty: 1, idempotency_key: key() });
          if (!r.accepted) {
            if (r.outcome === 'wrong_sku') {
              leaving = true;
              stopWatch();
              CTX.set('wrong', {
                code, message: r.message,
                scanned: r.scanned_sku_name || null,
                expected: line.sku_name, expected_sku_id: line.sku_id,
                expected_photo: line.photo_key, location: line.location_code,
                expected_code: [line.unit_size, line.brand_sku_code].filter(Boolean).join(' · '),
              });
              if (zone) zone.reject('Salah barang', r.scanned_sku_name || code);
              return setTimeout(() => go('08-salah-barang.html'), 900);
            }
            // Right product, wrong unit (a plate already picked, or recorded in
            // another basket). Held on screen until the next scan; no override.
            if (zone) zone.reject('Ditolak', r.message);
            return;
          }
          CTX.set('lastSave', { ref: (task.short_no || task.external_ref), at: new Date().toISOString() });
          line.qty_picked = r.qty_picked;
          line.status = r.line_complete ? 'picked' : 'pending';
          if (line._onHand != null) line._onHand = Math.max(0, line._onHand - 1);
          if (zone) zone.accept('Benar', line.sku_name + ' · ' + r.message);
          if (r.task_complete || !currentLine()) return finish();
          if (r.line_complete) paintLine();
          else { paintCounter(line); paintOnHand(line); }
        } catch (e) {
          if (!e.status) {
            // Online-only app: a lost connection mid-pick stops the picker, and
            // the stop screen says which order and when it was last saved.
            leaving = true;
            stopWatch();
            CTX.set('blocked', { reason: 'net', ref: (task.short_no || task.external_ref), at: new Date().toISOString() });
            return go('14-terkunci.html');
          }
          if (e.status === 401) { leaving = true; stopWatch(); return fail(e); }
          if (zone) zone.reject('Gagal', oneLang(e.message));
          // 409: cancelled, moved to someone else, or finished under us.
          if (e.status === 409) {
            lost(/cancel|batal/i.test(e.message)
              ? (lang() === 'en'
                ? 'Order cancelled. Units already picked are on the Return-to-shelf list.'
                : 'Pesanan dibatalkan. Barang yang sudah diambil masuk daftar Kembalikan ke rak.')
              : oneLang(e.message));
          }
        }
      }

      if (zone) zone.onScan(code => enqueue(code));

      /* "Item not in the basket" carries the line to the short-pick screen. */
      const short = $('a.btn--caution');
      if (short) short.onclick = async (e) => {
        e.preventDefault();
        const line = currentLine();
        if (!line || leaving) return;
        stopWatch();
        // Looking for a missing item counts as starting the order, so the
        // 2-minute rule does not take it away meanwhile.
        try { await api().raw.post('/pick-tasks/' + task.id + '/start', {}); }
        catch (err) {
          if (err.status === 409) return lost(oneLang(err.message));
          if (err.status === 401) { leaving = true; return fail(err); }
        }
        leaving = true;
        CTX.set('shortLine', {
          task_id: task.id, order_id: task.order_id, external_ref: (task.short_no || task.external_ref),
          others: pending().length - 1,
          line: {
            id: line.id, sku_id: line.sku_id, sku_name: line.sku_name, photo_key: line.photo_key,
            location_code: line.location_code, qty_required: line.qty_required,
            qty_picked: line.qty_picked, brand_sku_code: line.brand_sku_code, unit_size: line.unit_size,
          },
          // The same SKU may have a second stop (overflow) still to come.
          elsewhere: pending().filter(l => l.id !== line.id && l.sku_id === line.sku_id)
            .map(l => l.location_code).filter(Boolean),
        });
        go('17-barang-tidak-ada.html');
      };

      /* There is no un-pick on the server: a confirmed unit has left the ledger.
         Offering an undo that cannot happen is worse than none; the picker who
         grabbed one too many puts it back and the next count catches it. */
      const undo = $('[data-action="undo"]');
      if (undo) undo.style.display = 'none';

      paintLine();
      if (zone) zone.focus();
      watch();
    }

    boot();
  };
})();
