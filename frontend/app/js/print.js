/* print.js: NJW.print, the one way the app prints (Pengaturan, Printer).
 *
 * A hub has two printers, the same set up as Hiryu's packing slip:
 *   thermal 80 mm (or 58 mm) receipt printer: slips (the putaway slip today)
 *   A4 office printer: rack and bin labels, the return note to the brand, the guide
 * The device settings live in this browser profile on this PC, not per person,
 * like Hiryu's printer page. A web page cannot choose a printer: the profile
 * started with --kiosk-printing prints silently to the Windows default printer
 * (the thermal one); the normal profile shows the dialog, where staff pick A4.
 *
 *   NJW.print.settings()            {thermal: true|false|null, width: 80|58, kiosk, autoSlip}
 *   NJW.print.save(patch)           saves and returns the settings
 *   NJW.print.cols()                48 on 80 mm, 32 on 58 mm (48 when printing on A4)
 *   NJW.print.thermal(html, {title})  a slip sized for the roll; on A4 when the device has none
 *   NJW.print.a4(html, {title, css})  an A4 page
 *   NJW.print.slip(lines)           html for a slip; a line is a string, a list of strings, or {b: text} for bold
 *   NJW.print.wrap / lr / rule / center    column helpers for those lines
 *   NJW.print.once(key)             true the first time on this device, then false (auto-print guard)
 *
 * Printing goes through a hidden iframe, so the page itself never changes.
 */
(function () {
  'use strict';
  const NJW = (window.NJW = window.NJW || {});
  const KEY = 'njw.printer';
  const ONCE = 'njw.printer.done';
  const DEF = { thermal: null, width: 80, kiosk: false, autoSlip: false };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function settings() {
    let v = null;
    try { v = JSON.parse(store.get(KEY) || 'null'); } catch (e) { v = null; }
    const s = Object.assign({}, DEF, v && typeof v === 'object' ? v : {});
    s.width = s.width === 58 ? 58 : 80;
    if (s.thermal !== true && s.thermal !== false) s.thermal = null;
    s.kiosk = !!s.kiosk;
    s.autoSlip = !!s.autoSlip && s.thermal === true;
    return s;
  }
  function save(patch) {
    const s = Object.assign(settings(), patch || {});
    store.set(KEY, JSON.stringify(s));
    return settings();
  }
  const hasThermal = () => settings().thermal === true;
  const paper = () => { const s = settings(); return s.thermal === true ? s.width : 80; };
  /* 80 mm paper prints 72 mm, 58 mm prints 48 mm; at 1.5 mm a character that is 48 and 32. */
  const cols = () => (paper() === 58 ? 32 : 48);
  const printable = (w) => (w === 58 ? 48 : 72);

  /* ---------------- column helpers ---------------- */
  /* Word wrap to w columns; a word longer than a line is split. Nothing is cut off. */
  function wrap(text, w, indent) {
    w = w || cols();
    const pad = indent || '';
    const out = [];
    let line = '';
    /* A size stays in one piece: "100 ml" is never split over two lines. */
    String(text == null ? '' : text).replace(/(\d)\s+(ml|g|gr|kg|l|pcs|cm|mm)\b/gi, '$1 $2')
      .split(/[ \t\r\n]+/).filter(Boolean).forEach((word) => {
      const room = () => w - (out.length ? pad.length : 0);
      while (word.length > room()) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, room()));
        word = word.slice(room());
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= room()) line += ' ' + word;
      else { out.push(line); line = word; }
    });
    if (line || !out.length) out.push(line);
    return out.map((l, i) => (i ? pad : '') + l);
  }
  /* Left text and right text on one line; when they do not fit the left part wraps. */
  function lr(left, right, w, indent) {
    w = w || cols();
    left = String(left == null ? '' : left);
    right = String(right == null ? '' : right);
    const one = w - right.length - 1;
    if (left.length <= one) return [left + ' '.repeat(w - left.length - right.length) + right];
    const lines = wrap(left, w, indent);
    const last = lines[lines.length - 1];
    if (last.length + 1 + right.length <= w) lines[lines.length - 1] = last + ' '.repeat(w - last.length - right.length) + right;
    else lines.push(' '.repeat(Math.max(0, w - right.length)) + right);
    return lines;
  }
  const rule = (ch, w) => (ch || '-').repeat(w || cols());
  const center = (text, w) => {
    w = w || cols();
    return wrap(text, w).map((l) => ' '.repeat(Math.floor((w - l.length) / 2)) + l);
  };

  /* ---------------- slip html ---------------- */
  /* Courier New is 0.6 em wide: 2.48 mm type gives 1.49 mm a character, so 48 fit in 72 mm. */
  const SLIP_CSS = '.njw-slip{background:#FFF;color:#000;font-family:"Courier New",Courier,"Liberation Mono",monospace;font-size:2.48mm;line-height:1.32;width:72mm;box-sizing:content-box}' +
    '.njw-slip--58{width:48mm}.njw-slip pre{margin:0;font:inherit;white-space:pre;overflow:hidden}.njw-slip b{font-weight:700}';
  function slip(lines, width) {
    const w = width || paper();
    const out = [];
    (lines || []).forEach((l) => {
      if (l && typeof l === 'object' && !Array.isArray(l)) [].concat(l.b).forEach((x) => out.push('<b>' + esc(x) + '</b>'));
      else [].concat(l).forEach((x) => out.push(esc(x)));
    });
    const body = out.join('\n');
    return '<div class="njw-slip' + (w === 58 ? ' njw-slip--58' : '') + '"><pre>' + body + '</pre></div>';
  }
  /* For an on-screen preview: the same CSS once in the page. */
  function previewCss() {
    if (document.getElementById('njw-slip-css')) return;
    const st = document.createElement('style');
    st.id = 'njw-slip-css';
    st.textContent = SLIP_CSS;
    document.head.appendChild(st);
  }

  /* ---------------- printing ---------------- */
  function doc(title, css, body) {
    return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>' + esc(title || 'SatSet WMS') + '</title>' +
      '<style>html,body{margin:0;padding:0;background:#FFF;color:#000}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' + css + '</style>' +
      '<style id="njw-page"></style></head><body>' + body + '</body></html>';
  }
  function viaFrame(html, fit) {
    return new Promise((resolve) => {
      const old = document.getElementById('njw-printframe');
      if (old) old.remove();
      const f = document.createElement('iframe');
      f.id = 'njw-printframe';
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:900px;border:0;opacity:0;pointer-events:none';
      document.body.appendChild(f);
      const w = f.contentWindow, d = w.document;
      d.open(); d.write(html); d.close();
      setTimeout(() => {
        try { if (fit) fit(d); } catch (e) { /* print anyway */ }
        let done = false;
        const end = () => { if (done) return; done = true; resolve(true); setTimeout(() => f.remove(), 1000); };
        w.addEventListener('afterprint', end);
        try { w.focus(); w.print(); } catch (e) { end(); return; }
        /* Chrome waits in print() until the dialog closes; other browsers return at once. */
        setTimeout(end, 60000);
      }, 80);
    });
  }

  /* A slip on the roll: page as wide as the paper, as long as the slip (CSS has no
   * "auto" page height, so the height is measured), margins 0. No thermal printer
   * on this device: the same slip on an A4 page. */
  function thermal(html, o) {
    o = o || {};
    const s = settings();
    if (s.thermal !== true) {
      return viaFrame(doc(o.title, SLIP_CSS + '@page{size:A4 portrait;margin:12mm}', html));
    }
    const w = s.width;
    const css = SLIP_CSS + 'body{width:' + w + 'mm}.njw-roll{width:' + printable(w) + 'mm;margin:0 auto;padding:2mm 0 8mm}' +
      '@page{size:' + w + 'mm 200mm;margin:0}';
    return viaFrame(doc(o.title, css, '<div class="njw-roll">' + html + '</div>'), (d) => {
      const mm = Math.ceil((d.body.scrollHeight * 25.4) / 96) + 2;
      d.getElementById('njw-page').textContent = '@page{size:' + w + 'mm ' + Math.max(mm, 40) + 'mm;margin:0}';
    });
  }
  function a4(html, o) {
    o = o || {};
    const css = '@page{size:A4 portrait;margin:' + (o.margin || '12mm') + '}body{font-family:Arial,Helvetica,sans-serif;font-size:11pt}' + (o.css || '');
    return viaFrame(doc(o.title, css, html));
  }

  /* Auto-print guard: true once per key on this device. */
  const mem = new Set();
  function once(key) {
    key = String(key);
    if (mem.has(key)) return false;
    let list = [];
    try { list = JSON.parse(store.get(ONCE) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    if (list.includes(key)) { mem.add(key); return false; }
    mem.add(key);
    list.push(key);
    store.set(ONCE, JSON.stringify(list.slice(-300)));
    return true;
  }

  /* Indonesian date and time in WIB for printouts, whatever the screen language. */
  function when(iso) {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return { date: '-', time: '-', both: '-' };
    const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' });
    return { date, time, both: date + ', ' + time + ' WIB' };
  }

  NJW.print = { settings, save, hasThermal, paper, cols, printable, wrap, lr, rule, center, slip, previewCss, thermal, a4, once, when, esc, SLIP_CSS };
})();
