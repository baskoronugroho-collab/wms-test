/* hiryu-parse.js — read a copied Hiryu order page, in the browser only.
 *
 * PRD v3.3 §13.2: staff click the title "Order GM-…" in Hiryu, press Ctrl+A,
 * Ctrl+C, and paste here. The pasted text never leaves this page. This file
 * takes out the order fields and nothing else; the caller sends only what
 * parseOrder() returns. Customer details (name, phone, notes) are never read:
 * they live in Raw payload, which must stay closed, and a note under an item
 * line is skipped because it is neither a quantity, a name slot nor an item ID.
 *
 * Layout read off Hiryu's order page (21 and 25 Sep 2026):
 *   Order GM-358 / RECEIVED / Details / Grab order ID / <id> / Store /
 *   View store #12 / … / Acceptance / AUTO / … / Order time / Sep 21, 2026,
 *   12:27 PM / Scheduled time / — / History … / Items / 1 line · 1 unit /
 *   1× / <item name> / <ITEM ID> / If out of stock: … / MYR 125.50 /
 *   Raw payload / Show
 * Clipboard text can join a label and its value with a tab; both are handled.
 */
(function () {
  'use strict';
  window.NJW = window.NJW || {};

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const STATUSES = ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DRIVER_ALLOCATED',
    'DRIVER_ARRIVED', 'COLLECTED', 'DELIVERED', 'BILL_PAID', 'COMPLETED', 'REJECTED', 'FAILED',
    'CANCELLED', 'REFUNDED', 'MARKED_READY'];
  const ITEM_ID = /^[A-Za-z]{2,}[A-Za-z0-9]*\d{6,}[A-Za-z0-9]*$/;   // e.g. MYITE20260819102823055224
  const HUB_TZ_OFFSET_MIN = 7 * 60;                                // Jakarta, WIB

  class ParseError extends Error {
    constructor(id, en) { super(id + ' / ' + en); this.id = id; this.en = en; }
  }

  function linesOf(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n').replace(/ /g, ' ')
      .split('\n').map(s => s.replace(/\s+$/, '').replace(/^\s+/, '')).filter(Boolean);
  }

  // "Label<TAB>value" on one line, or the value on the next line.
  function valueAfter(lines, label, from) {
    for (let i = from || 0; i < lines.length; i++) {
      const l = lines[i];
      if (l === label) return { value: lines[i + 1] || '', at: i + 1 };
      if (l.startsWith(label + '\t')) return { value: l.slice(label.length + 1).trim(), at: i };
    }
    return null;
  }

  // "Sep 21, 2026, 12:27 PM" shown in hub time -> ISO UTC.
  function hubTimeToUtc(s) {
    const m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(String(s || '').trim());
    if (!m) return null;
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon == null) return null;
    let h = parseInt(m[4], 10);
    const ap = (m[6] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const utcMs = Date.UTC(+m[3], mon, +m[2], h, +m[5]) - HUB_TZ_OFFSET_MIN * 60000;
    return new Date(utcMs).toISOString();
  }

  function isNone(v) { return !v || /^[—–-]$/.test(v.trim()); }

  function parseOrder(text) {
    const raw = String(text || '');
    // Raw payload open: it holds the customer's name and contact. Refuse it all.
    if (/"(receiver|eaterPayment|orderID|virtualContact|shortOrderNumber)"\s*:/.test(raw)) {
      throw new ParseError('Tutup "Raw payload" dulu, lalu salin ulang.',
        'Close "Raw payload" first, then copy again.');
    }
    const lines = linesOf(raw);
    if (!lines.length) throw new ParseError('Kosong. Salin halaman pesanan di Hiryu.', 'Empty. Copy the Hiryu order page.');

    // Title and status.
    let titleAt = -1, shortNo = null, status = null;
    for (let i = 0; i < lines.length; i++) {
      const m = /^Order\s+(GM-[A-Za-z0-9]{1,16})\b(.*)$/.exec(lines[i]);
      if (m) {
        titleAt = i; shortNo = m[1];
        const rest = m[2].trim().split(/\s+/).find(t => STATUSES.includes(t));
        if (rest) status = rest;
        break;
      }
    }
    if (!shortNo) {
      throw new ParseError('Ini bukan halaman pesanan Hiryu. Buka pesanannya, klik judul "Order GM-…", lalu Ctrl+A, Ctrl+C.',
        'This is not a Hiryu order page. Open the order, click the title "Order GM-…", then Ctrl+A, Ctrl+C.');
    }
    if (!status) {
      for (let i = titleAt + 1; i < Math.min(lines.length, titleAt + 4); i++) {
        const t = lines[i].split(/\s+/)[0];
        if (STATUSES.includes(t)) { status = t; break; }
      }
    }

    const gid = valueAfter(lines, 'Grab order ID', titleAt);
    const store = valueAfter(lines, 'Store', titleAt);
    const acc = valueAfter(lines, 'Acceptance', titleAt);
    const ot = valueAfter(lines, 'Order time', titleAt);
    const st = valueAfter(lines, 'Scheduled time', titleAt);
    const grabOrderId = gid ? gid.value.split(/\s+/)[0] : null;
    const storeNo = store ? parseInt((/#(\d+)/.exec(store.value) || [])[1], 10) : NaN;
    if (!grabOrderId || !/^[A-Za-z0-9._#:-]{6,96}$/.test(grabOrderId) || !storeNo) {
      throw new ParseError('Salinan tidak lengkap, salin ulang seluruh halaman.', 'Incomplete copy: copy the whole page again.');
    }

    // Items card: "N line(s) · M unit(s)", then blocks of qty, name, item ID.
    let declared = null, i0 = -1;
    for (let i = titleAt; i < lines.length; i++) {
      const m = /^(\d+)\s+lines?\s*[·•.]\s*(\d+)\s+units?$/i.exec(lines[i]);
      if (m) { declared = { lines: +m[1], units: +m[2] }; i0 = i + 1; break; }
    }
    if (!declared) throw new ParseError('Salinan tidak lengkap, salin ulang seluruh halaman.', 'Incomplete copy: copy the whole page again.');

    const items = [];
    let pendingQty = null, pendingName = null;
    for (let i = i0; i < lines.length; i++) {
      const l = lines[i];
      if (/^Raw payload\b/i.test(l)) break;
      const q = /^(\d{1,3})\s*[×x]\s*(.*)$/.exec(l);
      if (q && pendingQty === null) {
        pendingQty = +q[1];
        pendingName = q[2] && !ITEM_ID.test(q[2]) ? q[2] : null;
        if (q[2] && ITEM_ID.test(q[2])) { items.push({ item_id: q[2], qty: pendingQty, item_name: null }); pendingQty = null; }
        continue;
      }
      if (pendingQty !== null) {
        const id = l.split(/\s+/)[0];
        if (ITEM_ID.test(id) && l.split(/\s+/).length === 1) {
          items.push({ item_id: id, qty: pendingQty, item_name: pendingName ? pendingName.slice(0, 160) : null });
          pendingQty = null; pendingName = null;
        } else if (pendingName === null) {
          pendingName = l;          // the product name shown on Grab
        }
        continue;
      }
      // Anything else (out-of-stock wish, price, a customer's note) is skipped.
    }
    if (pendingQty !== null) throw new ParseError('Salinan tidak lengkap, salin ulang seluruh halaman.', 'Incomplete copy: copy the whole page again.');

    const units = items.reduce((n, x) => n + x.qty, 0);
    if (items.length !== declared.lines || units !== declared.units) {
      throw new ParseError('Salinan tidak lengkap, salin ulang seluruh halaman.', 'Incomplete copy: copy the whole page again.');
    }

    const acceptance = acc && /^(AUTO|MANUAL)$/.test(acc.value.trim()) ? acc.value.trim() : null;
    return {
      grab_order_id: grabOrderId,
      short_no: shortNo,
      status: status || 'RECEIVED',
      store_no: storeNo,
      acceptance,
      order_time: ot && !isNone(ot.value) ? hubTimeToUtc(ot.value) : null,
      scheduled_time: st && !isNone(st.value) ? hubTimeToUtc(st.value) : null,
      declared_lines: declared.lines,
      declared_units: declared.units,
      lines: items,
    };
  }

  NJW.hiryuParse = { parseOrder, hubTimeToUtc, ParseError };
})();
