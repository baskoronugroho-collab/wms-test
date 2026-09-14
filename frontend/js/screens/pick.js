/* pick.js — 07: guided, scan-verified picking (Alur C).
 *
 * Replaces the wire.js `pick` handler, which was written against the older
 * markup: it trusted a task cached in sessionStorage, confirmed a whole line
 * on one scan, took the oldest-created order rather than the one with the
 * least time left, and never filled the day-colour prompt.
 *
 * Rules this screen keeps:
 *  - One scan per unit. The shade gate (07 vs 08) exists per unit: a picker
 *    holding one of each and scanning once would otherwise ship the wrong one.
 *  - A wrong scan is refused by the server and there is no override here.
 *  - The location comes from the server, which splits an order line across
 *    rack and overflow oldest-first — so one SKU can be two stops, and every
 *    count here is per pick line (a stop), never per SKU. The day colour is
 *    the server's too: the batch that has sat longest at that location.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, bi, biAttr, applyLangTo, say, fail, go, key, CTX } = W;
  const api = () => NJW.api;

  const CHANNEL = {
    grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram',
  };

  /* Short date for the day-colour prompt: "8 Sep", from the server's
     calendar date (already a Jakarta date, so no clock maths here). */
  const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(ymd, months) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
    return m ? (+m[3]) + ' ' + months[+m[2] - 1] : '';
  }

  /* ---------- the screen ---------- */

  NJW.screens.pick = async () => {
    const site = W.site(), me = W.me();
    CTX.del('wrong');

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    const fifoEl = region('fifo');
    const FIFO_TPL = fifoEl ? fifoEl.innerHTML : '';

    let task = null, meta = {};
    let leaving = false;      // set once the screen is navigating away
    try {
      task = await findMine();
      let fresh = false;
      if (!task) { task = await claimNext(); fresh = true; }
      if (!task) return showEmpty();
      const saved = CTX.get('task');
      CTX.set('task', {
        id: task.id, external_ref: task.external_ref,
        // A duration for the done screen. Kept across reloads of the same
        // order; a re-claim must not reset the clock the picker is judged by.
        // Unknown (null) when resuming an order this device did not start.
        startedAt: fresh ? new Date().toISOString()
          : (saved && saved.id === task.id ? saved.startedAt || null : null),
      });
      meta = { channel: task.channel, delivery_mode: task.delivery_mode, promised_at: task.promised_at };
    } catch (e) { return fail(e); }

    /* Resume before claiming: a picker whose tablet reloaded (or who came back
       from the wrong-item or short-pick screen) already holds an order, and a
       fresh claim would strand it. The server list is the truth — a task that
       was released, cancelled or finished is no longer "claimed by me". */
    async function findMine() {
      const r = await api().pickTasks({ site_id: site.id, status: 'claimed' });
      const saved = CTX.get('task');
      const mine = r.tasks.filter(t => t.claimed_by === me.email);
      return mine.find(t => saved && t.id === saved.id) || mine[0] || null;
    }

    /* The next order is the one with the least time left, which is how the
       board sorts its waiting lane — not the oldest, because a 15-minute Grab
       order and a 1-hour own-channel order share one queue. A lost race for a
       card (409) just moves to the next one. */
    async function claimNext() {
      let ids;
      const board = await api().pickBoard({ site_id: site.id }).catch(() => null);
      if (board) {
        const lane = board.lanes.find(l => l.key === 'waiting') || { cards: [] };
        ids = lane.cards.filter(c => c.status === 'ready').map(c => c.id);
      } else {
        ids = (await api().pickTasks({ site_id: site.id, status: 'ready' })).tasks.map(t => t.id);
      }
      for (const id of ids.slice(0, 5)) {
        try { return await api().raw.post('/pick-tasks/' + id + '/claim', {}); }
        catch (e) { if (e.status !== 409) throw e; }
      }
      return null;
    }

    function showEmpty() {
      const main = $('.main');
      const prog = $('.progress');
      if (prog) prog.style.display = 'none';
      if (!main) return;
      main.innerHTML =
        '<div class="emptystate">' +
        '<span class="emptystate__mark" aria-hidden="true">✓</span>' +
        '<span class="emptystate__title" ' + biAttr('Belum ada pesanan', 'No orders waiting') +
        '>Belum ada pesanan</span>' +
        '<span class="emptystate__body" ' +
        biAttr('Pesanan baru muncul di sini begitu Hiryu mengirimnya. Coba lagi sebentar lagi.',
               'New orders appear here as soon as Hiryu sends them. Try again in a moment.') +
        '>Pesanan baru muncul di sini begitu Hiryu mengirimnya. Coba lagi sebentar lagi.</span>' +
        '<div class="stats" style="width:100%;max-width:560px">' +
        '<button class="btn btn--primary btn--lg btn--grow" type="button" data-action="reload" ' +
        biAttr('Cek lagi', 'Check again') + '>Cek lagi</button>' +
        '<a class="btn btn--outline btn--lg" href="index.html" ' + biAttr('Menu', 'Menu') + '>Menu</a>' +
        '</div></div>';
      applyLangTo(main);
      $('[data-action="reload"]', main).onclick = () => location.reload();
      setMode('Ambil pesanan', 'Pick order');
    }

    function setMode(id, en) {
      const mode = $('.chrome__mode');
      if (mode) { mode.dataset.keep = '1'; bi(mode, id, en); }
    }

    const pending = () => task.lines.filter(l => l.status === 'pending');
    const currentLine = () => pending()[0];

    // Every line already picked or declared short: the order is ready to hand
    // off. This is also where a picker who never tapped "hand off" lands.
    if (!currentLine()) return finish();

    setMode('Ambil pesanan · ' + task.external_ref, 'Pick order · ' + task.external_ref);

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
        const ch = CHANNEL[meta.channel] || (task.is_test ? 'Uji coba' : '—');
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
      if (codeEl) codeEl.innerHTML = line.location_code ? W.codeHtml(line.location_code) : '—';
      const lede = $('.instr') && $('.instr').parentNode.querySelector('.lede');
      if (lede) {
        if (!line.location_code) {
          bi(lede, 'Barang ini belum punya tempat. Pakai tombol "Barang tidak ada".',
                   'This item has no location yet. Use "Item is not in the basket".');
        } else if (line.rack_code) {
          const over = line.slot_role === 'overflow';
          bi(lede, 'Rak ' + line.rack_code + ', tingkat ' + line.level_no +
                   (over ? ' — tempat overflow: stok di sini lebih lama.' : '.'),
                   'Rack ' + line.rack_code + ', level ' + line.level_no +
                   (over ? ' — the overflow: the stock here is older.' : '.'));
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

    const lang = () => localStorage.getItem('njw.lang') === 'en' ? 'en' : 'id';

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
      let box = $('.wire-testcodes');
      if (!box) {
        box = document.createElement('div');
        box.className = 'panel wire-testcodes';
        box.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
        zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
      }
      const right = sheet.rows.find(r => r.sku_id === line.sku_id);
      const wrong = sheet.rows.find(r => r.sku_id !== line.sku_id);
      box.innerHTML = '<span class="eyebrow" ' + biAttr('Barcode uji', 'Test barcodes') + '>Barcode uji</span>';
      [[right, 'Benar', 'Right'], [wrong, 'Salah', 'Wrong']].forEach(([r, id, en]) => {
        if (!r) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--outline';
        b.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px';
        b.textContent = (lang() === 'en' ? en : id) + ': ' + r.sku_name.slice(0, 26);
        b.title = r.sku_name + ' · ' + r.barcode;
        b.onclick = () => enqueue(r.barcode);
        box.appendChild(b);
      });
      applyLangTo(box);
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
        CTX.set('lastSave', { ref: task.external_ref, at: new Date().toISOString() });
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
          CTX.set('blocked', { reason: 'net', ref: task.external_ref, at: new Date().toISOString() });
          return go('14-terkunci.html');
        }
        if (e.status === 401) { leaving = true; return fail(e); }
        if (zone) zone.reject('Gagal', e.message);
        // 409: someone else holds it now, or it was cancelled/finished under us.
        // Reload so the screen shows the server's view, not ours.
        if (e.status === 409) {
          leaving = true;
          if (/cancel|batal/i.test(e.message)) {
            say(lang() === 'en'
              ? 'Order cancelled. Units already picked are on the Return-to-shelf list.'
              : 'Pesanan dibatalkan. Barang yang sudah diambil masuk daftar Kembalikan ke rak.');
          }
          setTimeout(() => location.reload(), 3000);
        }
      }
    }

    function finish() {
      leaving = true;
      const saved = CTX.get('task') || {};
      CTX.set('doneTask', {
        task, meta, startedAt: saved.startedAt || null,
        finishedAt: new Date().toISOString(), handed: false,
      });
      CTX.del('task');
      setTimeout(() => go('09-pesanan-selesai.html'), 500);
    }

    if (zone) zone.onScan(code => enqueue(code));

    /* "Item not in the basket" carries the line to the short-pick screen. */
    const short = $('a.btn--caution');
    if (short) short.onclick = (e) => {
      e.preventDefault();
      const line = currentLine();
      if (!line) return;
      CTX.set('shortLine', {
        task_id: task.id, external_ref: task.external_ref,
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
  };
})();
