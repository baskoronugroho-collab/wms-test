/* barang-masuk.js: receive a brand delivery (canvas section 5, flow reordered 7 Oct 2026).
 *
 * One screen per step, a step bar on top, phone first. The URL picks the screen:
 *   (none)                              1  open the delivery: Ninja reference or brand PO number;
 *                                          also the *Taruh di rak* list of the dark store
 *   ?nopo=<code>                           a number the WMS does not know (no PO)
 *   ?receipt=<id>&step=door             1  the carton check (inline) and what is expected
 *   ?receipt=<id>&step=scan             2  scan every unit into temporary bins (damaged mode too)
 *   ?receipt=<id>&step=manual           2  pick a product with no barcode from the list
 *   ?receipt=<id>&step=review           3  differences: expected against scanned, per product
 *   ?receipt=<id>&step=docs             4  Surat Jalan / Faktur checklist and the three POD photos
 *   ?receipt=<id>&step=print            5  print the putaway slips, one per temporary bin
 *   ?receipt=<id>&step=putaway[&load=]  6  the putaway tasks, one per temporary bin
 *   ?receipt=<id>&step=detail           7  the receipt (done, Faktur upload, reprint)
 *   ?receipt=<id>                          the step the receipt is at
 *   ?slip=<id>                             the summary slip (old links)
 *
 * API (backend/routers/inbound.py, faktur.py): /api/inbound/... and
 * /api/receipts/{id}/faktur. Units in a temporary bin are not stock; the rack
 * scan makes them sellable and tells Hiryu.
 *
 * Photos: every camera button is a <label> around its own file input that stays
 * in the page, so one capture is enough (see photoSlot).
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const API = () => S.api();
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const key = () => 'bm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const n = (v) => S.fmt.n(v);

  /* ---------- page styles that kilat.css has no class for ---------- */
  function styles() {
    if ($('#bm-style')) return;
    const st = document.createElement('style');
    st.id = 'bm-style';
    st.textContent = [
      '.bm-wrap{max-width:720px;margin:0 auto;width:100%;display:flex;flex-direction:column;gap:16px}',
      '.bm-wrap--wide{max-width:1200px}',
      '.bm-ref{font-family:var(--mono);font-weight:700;font-size:26px;line-height:1.15;overflow-wrap:anywhere}',
      '.bm-opt{display:flex;gap:12px;align-items:flex-start;text-align:left;width:100%;padding:16px;border-radius:16px;background:var(--surface);border:2px solid var(--rule);font:inherit;color:var(--ink);cursor:pointer}',
      '.bm-opt:hover{border-color:var(--action)}',
      '.bm-opt__title{font-size:17px;font-weight:700;display:block}',
      '.bm-opt__sub{font-size:14px;color:var(--ink-2);display:block;margin-top:2px}',
      '.bm-damage{border:2px solid var(--stop);background:var(--stop-bg)}',
      '.bm-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
      '.bm-steps li{display:flex;gap:10px;align-items:flex-start;font-size:16px;font-weight:600;line-height:1.35}',
      '.bm-num{flex-shrink:0;width:28px;height:28px;border-radius:999px;background:var(--navy);color:#FFF;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}',
      '.bm-num--ok{background:var(--ok)}',
      '.bm-swatch{display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid var(--rule-2,#C9CED6);vertical-align:-2px;margin-right:4px}',
      /* step bar */
      '.bm-bar{display:flex;flex-direction:column;gap:6px}',
      '.bm-bar__segs{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;list-style:none;margin:0;padding:0}',
      '.bm-bar__seg{display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;font:inherit;background:none;border:0;padding:0;text-align:left;color:var(--muted)}',
      '.bm-bar__seg::before{content:"";display:block;height:6px;border-radius:3px;background:var(--rule)}',
      '.bm-bar__seg.is-done::before{background:var(--ok)}',
      '.bm-bar__seg.is-cur::before{background:var(--action)}',
      '.bm-bar__seg.is-cur{color:var(--ink)}',
      'button.bm-bar__seg{cursor:pointer}',
      '.bm-bar__lab{display:none;font-size:12px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}',
      '.bm-bar__cap{display:flex;justify-content:space-between;gap:8px;font-size:14px;font-weight:700;color:var(--ink-2)}',
      '@media (min-width:768px){.bm-bar__lab{display:block}.bm-bar__cap{display:none}}',
      '.bm-bar__cap b{color:var(--ink)}',
      /* scan answer */
      '.bm-answer{flex-wrap:wrap}',
      '.bm-answer .k-target__text{flex-basis:100%}',
      '.bm-answer .k-target__code{font-size:44px;white-space:nowrap}',
      '@media (min-width:768px){.bm-answer .k-target__code{font-size:56px}}',
      '.bm-answer__sku{font-size:17px;font-weight:700;color:var(--ink)}',
      '.bm-answer__count{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--ink)}',
      '.bm-answer__count b{font-size:30px}',
      '.bm-answer--first .k-target__label{font-size:17px;color:var(--ink);letter-spacing:0;text-transform:none}',
      /* live differences */
      '.bm-lines{display:flex;flex-direction:column}',
      '.bm-line{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 0;border-top:1px solid var(--rule)}',
      '.bm-line:first-child{border-top:0}',
      '.bm-line.is-cur{background:var(--action-bg);margin:0 -12px;padding:10px 12px;border-radius:10px}',
      '.bm-line__name{font-weight:700;font-size:15px;line-height:1.3}',
      '.bm-line__sub{font-size:13px;color:var(--ink-2);font-family:var(--mono)}',
      '.bm-line__pills{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;flex-shrink:0;max-width:55%}',
      /* photos */
      '.bm-photo{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 0;border-top:1px solid var(--rule)}',
      '.bm-photo:first-child{border-top:0}',
      '.bm-photo__text{flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:15px}',
      '.bm-photo__state{font-size:13px;font-weight:700}',
      '.bm-thumb{width:56px;height:56px;flex-shrink:0;border-radius:10px;background:var(--sunk) center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:var(--muted);overflow:hidden}',
      '.bm-thumb img{width:100%;height:100%;object-fit:cover}',
      '.bm-take{position:relative;cursor:pointer;flex-shrink:0}',
      '.bm-take.is-busy{opacity:.6;pointer-events:none}',
      '.bm-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}',
      '.bm-check{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--rule);cursor:pointer}',
      '.bm-check:first-child{border-top:0}',
      '.bm-check input{width:26px;height:26px;flex-shrink:0;margin:0;accent-color:var(--ok)}',
      '.bm-check__t{font-weight:700;font-size:16px;line-height:1.3;display:block}',
      '.bm-check__h{font-size:14px;color:var(--ink-2);display:block;margin-top:2px;font-weight:400}',
      /* Faktur upload, slip preview */
      '.bm-drop{border:2px dashed var(--rule-2,#C9CED6);border-radius:14px;padding:20px;text-align:center;color:var(--ink-2)}',
      '.bm-drop.is-over{border-color:var(--action);background:var(--action-bg)}',
      '.bm-pages{display:flex;gap:10px;flex-wrap:wrap}',
      '.bm-page{width:92px;height:120px;border-radius:10px;border:1px solid var(--rule);background:var(--sunk);display:flex;align-items:flex-end;justify-content:center;padding:6px;font-size:13px;font-weight:700;color:var(--ink-2);background-size:cover;background-position:center;text-decoration:none}',
      '.bm-next{border:2px solid var(--action)}',
      '#k-body .k-table td.k-mono{white-space:nowrap}',
      '.bm-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}',
      '@media (min-width:1024px){.bm-cols{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)}}',
      '.bm-mini td,.bm-mini th{padding:8px 10px}',
      '.bm-roll{background:var(--sunk);border-radius:16px;padding:20px 12px;overflow-x:auto;display:flex;flex-direction:column;align-items:center;gap:16px}',
      '.bm-roll .njw-slip{padding:4mm;box-shadow:var(--shadow);flex:none}',
      '@media (min-width:768px){.bm-roll .njw-slip{zoom:1.3}}',
      '.bm-task{display:flex;flex-direction:column;gap:6px;text-align:left;width:100%;font:inherit;color:inherit;cursor:pointer}',
      '.bm-move{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-family:var(--mono);font-weight:700;font-size:20px}',
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- small builders ---------- */
  const p2 = (id, en) => '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  const btn = (cls, id, en, attrs, ic) => '<button type="button" class="k-btn ' + (cls || '') + '" ' + (attrs || '') + '>' +
    (ic ? icon(ic, 22, 2.2) : '') + p2(id, en) + '</button>';
  const note = (kind, id, en, ic) => '<div class="k-note k-note--' + kind + '">' + icon(ic || (kind === 'caution' || kind === 'stop' ? 'warn' : 'info'), 20) +
    '<span ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span></div>';
  const short = (s) => String(s || '').replace(/^(Labore|Kahf)\s+/i, '');
  const refOf = (R) => R.reference || R.no_po_code || ('#' + R.id);

  function go(params, replace) {
    const u = new URL(location.href);
    ['receipt', 'step', 'nopo', 'slip', 'i', 'load'].forEach((k) => u.searchParams.delete(k));
    Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    history[replace ? 'replaceState' : 'pushState'](null, '', u.pathname + u.search);
    S.rerender();
  }
  window.addEventListener('popstate', () => S.rerender());

  const count = (l) => n(l.qty_received) + (l.qty_expected != null ? '/' + n(l.qty_expected) : '');
  const binShort = (code) => String(code || '').replace(/^[A-Z0-9]+-(?=IN-|QR-)/, '');
  function rackWords(code) {
    const m = /([A-Z]+)-(\d+)-(\d+)([TB])?$/.exec(String(code || ''));
    if (!m) return null;
    const pos = m[4] === 'T' ? ['atas', 'top'] : m[4] === 'B' ? ['bawah', 'bottom'] : null;
    return ['Rak ' + m[1] + ', level ' + (+m[2]) + ', bin ' + m[3] + (pos ? ', ' + pos[0] : ''),
      'Rack ' + m[1] + ', level ' + (+m[2]) + ', bin ' + m[3] + (pos ? ', ' + pos[1] : '')];
  }

  async function getReceipt(id) { return API().get('/inbound/receipts/' + id); }

  /* Plain states per product: Pas / Kurang 3 / Lebih 2 / Rusak 1 / Tidak ada di PO.
   * While scanning, a shortfall is still being counted, so it is blue, not amber. */
  function lineStates(l, scanning) {
    const out = [];
    const r = l.qty_received || 0, e = l.qty_expected;
    if (e == null) { if (r) out.push(['info', 'Dihitung ' + r, 'Counted ' + r]); }
    else if (e === 0 && r > 0) out.push(['caution', 'Tidak ada di PO', 'Not on the PO']);
    else if (r === e) out.push(['ok', 'Pas', 'Match']);
    else if (r < e) out.push([scanning ? 'info' : 'caution', 'Kurang ' + (e - r), 'Short ' + (e - r)]);
    else out.push(['caution', 'Lebih ' + (r - e), 'Extra ' + (r - e)]);
    if (l.qty_damaged) out.push(['stop', 'Rusak ' + l.qty_damaged, 'Damaged ' + l.qty_damaged]);
    return out;
  }
  const isDiff = (l) => lineStates(l, false).some((s) => s[0] !== 'ok' && s[0] !== 'info');
  const pills = (l, scanning) => lineStates(l, scanning).map((s) => S.pill(s[0], s[1], s[2])).join('');

  function linesHtml(R, scanning, curSku) {
    if (!R.lines.length) return '<p class="k-caption" ' + biAttr('Belum ada produk dipindai.', 'No product scanned yet.') + '></p>';
    const rows = R.lines.slice().sort((a, b) => (scanning ? 0 : (isDiff(b) - isDiff(a))));
    return '<div class="bm-lines">' + rows.map((l) => '<div class="bm-line' + (curSku === l.sku_id ? ' is-cur' : '') + '">' +
      '<div style="min-width:0"><div class="bm-line__name">' + esc(short(l.sku_name)) + '</div>' +
      '<div class="bm-line__sub">' + count(l) + ' pcs' + (l.bins && l.bins.length ? ' · ' + esc(l.bins.map(binShort).join(', ')) : '') + '</div></div>' +
      '<div class="bm-line__pills">' + pills(l, scanning) + '</div></div>').join('') + '</div>';
  }

  /* ---------- the step bar ---------- */
  const STEPS = [
    ['door', 'Buka kiriman', 'Open delivery'],
    ['scan', 'Pindai barang', 'Scan items'],
    ['review', 'Cek selisih', 'Check differences'],
    ['docs', 'Dokumen & foto', 'Paperwork & photos'],
    ['print', 'Cetak slip', 'Print slips'],
    ['putaway', 'Taruh di rak', 'Put away'],
  ];
  /* cur: index 0..5, or 6 when everything is done. Earlier steps of an open
   * receipt can be tapped to go back. */
  function stepBar(cur, R) {
    const canGo = (i) => R && R.status === 'open' && i < cur && i <= 3 && (i === 0 || R.can_scan);
    const segs = STEPS.map((s, i) => {
      const cls = 'bm-bar__seg' + (i < cur ? ' is-done' : '') + (i === cur ? ' is-cur' : '');
      const lab = '<span class="bm-bar__lab">' + (i + 1) + '. ' + p2(s[1], s[2]) + '</span>';
      return canGo(i) ? '<li><button type="button" class="' + cls + '" data-gostep="' + s[0] + '">' + lab + '</button></li>'
        : '<li><span class="' + cls + '"' + (i === cur ? ' aria-current="step"' : '') + '>' + lab + '</span></li>';
    }).join('');
    const cap = cur >= STEPS.length
      ? '<span>' + p2('Selesai', 'Done') + '</span><b>' + p2('Semua sudah di rak', 'Everything is on the rack') + '</b>'
      : '<span>' + p2('Langkah ' + (cur + 1) + ' dari 6', 'Step ' + (cur + 1) + ' of 6') + '</span><b>' + p2(STEPS[cur][1], STEPS[cur][2]) + '</b>';
    return '<nav class="bm-bar" data-aria-id="Langkah barang masuk" data-aria-en="Inbound steps" aria-label="' + esc(t('Langkah barang masuk', 'Inbound steps')) + '">' +
      '<ol class="bm-bar__segs">' + segs + '</ol><div class="bm-bar__cap">' + cap + '</div></nav>';
  }
  function bindBar(root, R) {
    $$('[data-gostep]', root).forEach((b) => b.addEventListener('click', () => go({ receipt: R.id, step: b.dataset.gostep })));
  }

  /* ---------- photos: one capture is enough ----------
   * The old helper made a throwaway <input type=file>, clicked it from script,
   * removed it on change, uploaded the full camera file (several MB) with
   * nothing on screen, then re-rendered the whole step from the server. Back
   * from the camera the row still said "Ambil" until both calls had finished,
   * so people took the photo again, and a phone that reloaded the page on the
   * way back from the camera lost the first one. Now each slot is a <label>
   * around its own input that stays in the page, the photo shows at once with
   * "Mengunggah..." while a smaller copy uploads, and only that row repaints.
   * Retake is the same button. */
  const PH = {};      // slot key -> {state: uploading|done|error, url, msg}
  const SLOTS = {};   // slot key -> its options

  async function shrink(file) {
    const okType = /^image\/(jpeg|png|webp)$/.test(file.type || '');
    if (okType && file.size < 1.5 * 1024 * 1024) return file;
    try {
      let src;
      if (window.createImageBitmap) src = await createImageBitmap(file, { imageOrientation: 'from-image' });
      else {
        src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = URL.createObjectURL(file); });
      }
      const w0 = src.width, h0 = src.height;
      const k = Math.min(1, 1920 / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      if (src.close) src.close();
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
      if (!blob) return file;
      return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
    } catch (e) { return file; }
  }

  /* o: {key, id, en, capture, done, receiptId, kind, diff, local, onChange} */
  function photoSlot(o) {
    SLOTS[o.key] = Object.assign(SLOTS[o.key] || {}, o);
    return '<div class="bm-photo" data-slot="' + esc(o.key) + '">' + slotInner(o.key) + '</div>';
  }
  function slotInner(k) {
    const o = SLOTS[k], s = PH[k] || {};
    const state = s.state || (o.done ? 'done' : 'idle');
    const thumb = s.url ? '<img alt="" src="' + esc(s.url) + '">' : icon(state === 'done' ? 'check' : 'camera', 24);
    const sub = state === 'uploading' ? '<span class="bm-photo__state" style="color:var(--action)" ' + biAttr('Mengunggah...', 'Uploading...') + '></span>'
      : state === 'error' ? '<span class="bm-photo__state" style="color:var(--stop)">' + p2('Belum tersimpan. Coba lagi.', 'Not saved. Try again.') + '</span>'
        : state === 'done' ? '<span class="bm-photo__state" style="color:var(--ok)">' + p2(o.local ? 'Foto diambil' : 'Tersimpan', o.local ? 'Photo taken' : 'Saved') + '</span>' : '';
    const again = state === 'done' || (state === 'error' && o.done);
    return '<span class="bm-thumb"' + (state === 'done' && !s.url ? ' style="color:var(--ok)"' : '') + '>' + thumb + '</span>' +
      '<span class="bm-photo__text"><span ' + biAttr(o.id, o.en) + '>' + esc(t(o.id, o.en)) + '</span>' + sub + '</span>' +
      '<label class="k-btn k-btn--' + (again ? 'ghost' : 'secondary') + ' k-btn--sm bm-take' + (state === 'uploading' ? ' is-busy' : '') + '">' +
        icon('camera', 18) + p2(again ? 'Ulangi' : 'Ambil foto', again ? 'Retake' : 'Take photo') +
        '<input type="file" class="bm-file" accept="image/*"' + (o.capture ? ' capture="' + esc(o.capture) + '"' : '') +
          (state === 'uploading' ? ' disabled' : '') + '></label>';
  }
  function bindSlots(root) {
    $$('[data-slot]', root).forEach((el) => bindSlot(el));
  }
  function bindSlot(el) {
    const k = el.dataset.slot;
    const input = $('input[type=file]', el);
    if (!input) return;
    let busy = false;
    const pick = () => {
      const f = input.files && input.files[0];
      if (!f || busy) return;
      busy = true;
      takePhoto(k, f);
    };
    input.addEventListener('change', pick);
    input.addEventListener('input', pick);
  }
  function repaintSlot(k) {
    const el = document.querySelector('[data-slot="' + (window.CSS && CSS.escape ? CSS.escape(k) : k) + '"]');
    if (!el) return;
    el.innerHTML = slotInner(k);
    S.applyLang(el);
    bindSlot(el);
  }
  async function takePhoto(k, file) {
    const o = SLOTS[k];
    const old = PH[k];
    if (old && old.url) { try { URL.revokeObjectURL(old.url); } catch (e) { /* gone */ } }
    PH[k] = { state: 'uploading', url: URL.createObjectURL(file) };
    repaintSlot(k);
    if (o.local) {
      PH[k].state = 'done';
      o.done = true;
      repaintSlot(k);
      if (o.onChange) o.onChange(file);
      return;
    }
    try {
      const fd = new FormData();
      fd.append('kind', o.kind);
      if (o.diff) fd.append('difference_id', o.diff);
      fd.append('file', await shrink(file));
      await API().form('/inbound/receipts/' + o.receiptId + '/photos', fd);
      PH[k].state = 'done';
      o.done = true;
      S.toast(['Foto tersimpan.', 'Photo saved.'], 'ok');
    } catch (e) {
      PH[k].state = 'error';
      S.fail(e);
    }
    repaintSlot(k);
    if (o.onChange) o.onChange();
  }

  /* ================= 1: open the delivery (and the putaway list) ================= */

  async function home(ctx) {
    S.fullScreen(false);
    S.setSub('Lihat Surat Jalan. Ketik atau pindai nomornya.', 'Look at the Surat Jalan. Type or scan its number.');
    const siteId = S.siteId();
    const [dl, recent, put] = await Promise.all([
      API().get('/inbound/deliveries' + API().qs({ site_id: siteId })),
      API().get('/inbound/receipts' + API().qs({ site_id: siteId, limit: 30 })),
      API().get('/inbound/putaway' + API().qs({ site_id: siteId })).catch(() => ({ items: [], held: [] })),
    ]);
    const row = (d, today) => '<button type="button" class="k-row bm-dl" data-ref="' + esc(d.reference) + '" style="width:100%;text-align:left">' +
      '<span class="k-row__icon">' + icon('truck', 26) + '</span><span class="k-row__text">' +
      '<span class="k-row__title k-mono" style="white-space:nowrap">' + esc(d.reference) + '</span>' +
      '<span class="k-row__sub">' + esc(d.brand_name) + ' · ' + n(d.sku_count) + ' SKU · ' + n(d.units) + ' unit' +
      (d.brand_po_number ? ' · ' + esc(d.brand_po_number) : '') + '</span>' +
      '<span style="margin-top:4px">' + (d.receipt_id ? S.pill('info', 'Sedang diterima', 'Being received')
        : today ? S.pill('ok', 'Tiba hari ini', 'Arrives today')
          : '<span class="k-muted" style="font-size:14px">' + p2('Perkiraan', 'Expected') + ' ' + esc(d.eta_date ? S.fmt.day(d.eta_date) : '-') + '</span>') +
      '</span></span></button>';
    const openNoPo = recent.receipts.filter((r) => r.status === 'open' && r.no_po);
    const toPrint = recent.receipts.filter((r) => r.stage === 'print');
    const tasks = put.items || [];
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      stepBar(0, null) +
      '<form class="k-card k-card--pad k-stack" id="bm-open">' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Ninja reference atau No. PO merek', 'Ninja reference or brand PO number') + '></span>' +
        '<input class="k-input k-mono" id="bm-code" autocomplete="off" autocapitalize="characters" spellcheck="false" style="font-size:20px">' +
        '<span class="k-field__hint" ' + biAttr('Contoh: RPL-MA5-2609-002 atau PO/PRG/2610/0457', 'For example: RPL-MA5-2609-002 or PO/PRG/2610/0457') + '></span></label>' +
        btn('k-btn--primary k-btn--lg k-btn--block', 'Buka kiriman', 'Open delivery', 'id="bm-go"', 'arrow') +
      '</form>' +
      (toPrint.length ? '<div class="k-stack k-stack--tight">' + bis('Slip putaway belum dicetak', 'Putaway slips not printed', 'k-eyebrow') +
        '<div class="k-list">' + toPrint.map((r) => '<a class="k-row k-row--caution" href="?receipt=' + r.id + '&step=print">' +
          '<span class="k-row__icon k-row__icon--caution">' + icon('print', 26) + '</span><span class="k-row__text">' +
          '<span class="k-row__title k-mono">' + esc(r.reference || r.no_po_code || ('#' + r.id)) + '</span>' +
          '<span class="k-row__sub">' + esc(r.brand_name || '') + ' · ' + p2(r.slip_pending + ' bin sementara', r.slip_pending + ' temporary bin(s)') + '</span></span>' +
          '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div></div>' : '') +
      (tasks.length ? '<div class="k-stack k-stack--tight">' + bis('Taruh di rak', 'Put away', 'k-eyebrow') +
        '<div class="k-list">' + tasks.map((it) => '<a class="k-row" href="?receipt=' + it.load.receipt_id + '&step=putaway&load=' + it.load.id + '">' +
          '<span class="k-row__icon">' + icon('rack', 26) + '</span><span class="k-row__text">' +
          '<span class="k-row__title"><span class="k-mono">' + esc(binShort(it.load.bin_code)) + '</span> → <span class="k-mono">' + esc(it.to_location_label || '?') + '</span></span>' +
          '<span class="k-row__sub">' + esc(short(it.sku_name)) + ' · ' + n(it.load.qty_to_put) + ' unit' + (it.reference ? ' · ' + esc(it.reference) : '') + '</span></span>' +
          '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div></div>' : '') +
      '<div class="k-stack k-stack--tight">' + bis('Kiriman hari ini', 'Deliveries today', 'k-eyebrow') +
        (dl.today.length ? '<div class="k-list">' + dl.today.map((d) => row(d, true)).join('') + '</div>'
          : '<p class="k-caption" ' + biAttr('Tidak ada kiriman yang dijadwalkan hari ini.', 'No delivery is scheduled today.') + '></p>') +
      '</div>' +
      (dl.next.length ? '<div class="k-stack k-stack--tight">' + bis('Berikutnya', 'Next', 'k-eyebrow') +
        '<div class="k-list">' + dl.next.map((d) => row(d, false)).join('') + '</div></div>' : '') +
      (openNoPo.length ? '<div class="k-stack k-stack--tight">' + bis('Tanpa PO, sedang dihitung', 'No PO, being counted', 'k-eyebrow') +
        '<div class="k-list">' + openNoPo.map((r) => '<a class="k-row k-row--caution" href="?receipt=' + r.id + '&step=scan">' +
          '<span class="k-row__icon k-row__icon--caution">' + icon('warn', 26) + '</span><span class="k-row__text">' +
          '<span class="k-row__title k-mono">' + esc(r.no_po_code || ('#' + r.id)) + '</span>' +
          '<span class="k-row__sub">' + esc(r.brand_name || '') + ' · ' + n(r.units) + ' unit</span></span>' +
          '<span class="k-row__chev">' + icon('chev', 22) + '</span></a>').join('') + '</div></div>' : '') +
      note('info', 'Di pintu: cocokkan jumlah karton dengan Surat Jalan saja. Barang dihitung per unit (pcs) saat dipindai. Jangan tanda tangan dulu.',
        'At the door: only check the carton count against the Surat Jalan. Goods are counted per unit (pcs) when scanned. Do not sign yet.') +
      '<div class="k-laptop-only k-stack k-stack--tight" style="margin-top:8px">' + bis('Penerimaan terakhir', 'Recent receipts', 'k-eyebrow') + receiptTable(recent.receipts) + '</div>' +
      '</div>';
    const code = $('#bm-code', ctx.body);
    $$('.bm-dl', ctx.body).forEach((b) => b.addEventListener('click', () => {
      $$('.bm-dl', ctx.body).forEach((x) => x.classList.remove('bm-next'));
      b.classList.add('bm-next');
      code.value = b.dataset.ref;
      openByCode(b.dataset.ref);
    }));
    const submit = async (e) => {
      if (e) e.preventDefault();
      const c = code.value.trim();
      if (!c) { S.toast(['Ketik atau pindai nomornya dulu.', 'Type or scan the number first.'], 'caution'); code.focus(); return; }
      await openByCode(c);
    };
    $('#bm-open', ctx.body).addEventListener('submit', submit);
    $('#bm-go', ctx.body).addEventListener('click', submit);
  }

  function stagePill(r) {
    if (r.status === 'open') return S.pill('info', 'Sedang diterima', 'Receiving');
    if (r.status === 'refused') return S.pill('stop', 'Ditolak', 'Refused');
    if (r.stage === 'print') return S.pill('caution', 'Slip belum dicetak', 'Slips not printed');
    if (r.stage === 'putaway') return S.pill('caution', 'Taruh di rak: ' + r.tasks_open + ' bin', 'Put away: ' + r.tasks_open + ' bin(s)');
    if (r.pending_differences) return S.pill('caution', 'Menunggu Ops HQ', 'Waiting for Ops HQ');
    if (!r.faktur_uploaded_at) return S.pill('caution', 'Faktur belum diunggah', 'Faktur not uploaded');
    return S.pill('ok', 'Selesai', 'Done');
  }

  function receiptTable(rows) {
    if (!rows.length) return '<p class="k-caption" ' + biAttr('Belum ada penerimaan.', 'No receipts yet.') + '></p>';
    return '<div class="k-tablewrap"><table class="k-table"><thead><tr>' +
      '<th ' + biAttr('Kiriman', 'Delivery') + '></th><th ' + biAttr('Merek', 'Brand') + '></th><th ' + biAttr('Dibuka', 'Opened') + '></th>' +
      '<th class="k-num" ' + biAttr('Unit', 'Units') + '></th><th ' + biAttr('Status', 'Status') + '></th><th></th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td class="k-mono k-strong">' + esc(r.reference || r.no_po_code || ('#' + r.id)) +
          (r.no_po && !r.reference ? ' ' + S.pill('caution', 'Tanpa PO', 'No PO') : '') + '</td>' +
          '<td>' + esc(r.brand_name || '-') + '</td><td>' + esc(S.fmt.dt(r.opened_at)) + '</td>' +
          '<td class="k-num">' + n(r.units) + '</td><td>' + stagePill(r) + '</td>' +
          '<td class="k-table__actions"><a class="k-btn k-btn--sm k-btn--secondary" href="?receipt=' + r.id + '" ' + biAttr('Buka', 'Open') + '></a></td></tr>').join('') +
      '</tbody></table></div>';
  }

  async function openByCode(c) {
    const siteId = S.siteId();
    let res;
    try { res = await API().get('/inbound/lookup' + API().qs({ site_id: siteId, code: c })); } catch (e) { S.fail(e); return; }
    const live = res.matches.filter((m) => m.status === 'confirmed' || m.status === 'receiving');
    if (!res.matches.length) { go({ nopo: c }); return; }
    if (!live.length) { S.toast(res.message || ['Kiriman ini sudah diterima.', 'Already received.'], 'caution'); return; }
    let pick = live[0];
    if (live.length > 1) {
      pick = await new Promise((ok) => {
        S.modal({
          title: ['Pilih merek', 'Choose the brand'],
          body: '<p class="k-p" ' + biAttr('Nomor ini dipakai lebih dari satu merek. Lihat merek di Surat Jalan.', 'This number is used by more than one brand. Check the brand on the Surat Jalan.') + '></p>',
          actions: live.map((m) => ({ label: [m.brand_name + ' · ' + m.reference, m.brand_name + ' · ' + m.reference], kind: 'secondary', onClick: () => ok(m) })),
          onClose: () => ok(null),
        });
      });
      if (!pick) return;
    }
    try {
      const r = await API().post('/inbound/receipts', { site_id: siteId, replenishment_id: pick.replenishment_id });
      go({ receipt: r.id });
    } catch (e) { S.fail(e); }
  }

  /* ================= no PO ================= */

  async function noPo(ctx, code) {
    S.fullScreen(true, { title: ['PO tidak ditemukan', 'PO not found'], onBack: () => go({}) });
    const brands = (await API().get('/brands')).filter((b) => b.active);
    const st = { photo: null, brand: brands.length === 1 ? brands[0].id : null };
    const slotKey = 'nopo:' + code;
    if (PH[slotKey] && PH[slotKey].state === 'done' && SLOTS[slotKey] && SLOTS[slotKey].file) st.photo = SLOTS[slotKey].file;
    ctx.body.innerHTML = '<div class="bm-wrap">' + stepBar(0, null) +
      '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('PO tidak ditemukan', 'PO not found') + '></h2>' +
      '<p class="k-p"><span class="k-mono k-strong">' + esc(code) + '</span> ' +
        p2('tidak ada di WMS. Tetap terima, Ops HQ yang mencocokkan.', 'is not in the WMS. Receive it anyway; Ops HQ will match it.') + '</p></div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('1. Foto Surat Jalan', '1. Photo of the Surat Jalan', 'k-strong') +
        photoSlot({ key: slotKey, id: 'Surat Jalan', en: 'Surat Jalan', capture: 'environment', local: true, done: !!st.photo,
          onChange: (f) => { st.photo = f; SLOTS[slotKey].file = f; } }) + '</div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('2. Pilih merek', '2. Choose the brand', 'k-strong') +
        '<div class="k-segment" role="group" id="bm-brand">' + brands.map((b) => '<button type="button" data-b="' + b.id + '" aria-pressed="' + (st.brand === b.id) + '">' + esc(b.name) + '</button>').join('') + '</div></div>' +
      '<div class="k-card k-card--pad k-stack">' + bis('3. Hitung karton', '3. Count the cartons', 'k-strong') +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Karton di Surat Jalan', 'Cartons on the Surat Jalan') + '></span><div id="bm-sjc"></div></label></div>' +
      '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + S.pill('caution', 'Segera', 'Urgent') + ' ' +
        p2('Ops HQ diberi tahu sekarang, harus menjawab segera.', 'Ops HQ is told now and must answer at once.') + '</span></div>' +
      note('info', 'Unit dipindai ke bin sementara seperti biasa, tapi belum jadi stok. Baru jadi stok setelah Ops HQ menghubungkan kiriman ini ke permintaan restock.',
        'Units are scanned into temporary bins as usual, but are not stock yet. They become stock once Ops HQ links this delivery to a restock request.') +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Kirim ke Ops HQ, lalu hitung', 'Send to Ops HQ, then count', 'id="bm-send"', 'arrow') + '</div></div>';
    bindSlots(ctx.body);
    const sjc = S.stepper($('#bm-sjc', ctx.body), { value: 1, min: 0, max: 999 });
    $$('#bm-brand button', ctx.body).forEach((b) => b.addEventListener('click', () => {
      st.brand = +b.dataset.b;
      $$('#bm-brand button', ctx.body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('#bm-send', ctx.body).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!st.photo) { S.toast(['Foto Surat Jalan dulu.', 'Take the Surat Jalan photo first.'], 'caution'); return; }
      if (!st.brand) { S.toast(['Pilih merek.', 'Choose the brand.'], 'caution'); return; }
      const fd = new FormData();
      fd.append('site_id', S.siteId());
      fd.append('brand_id', st.brand);
      fd.append('code', code);
      fd.append('sj_cartons', sjc.get());
      fd.append('photo', await shrink(st.photo));
      b.disabled = true;
      try {
        const r = await API().form('/inbound/receipts/no-po', fd);
        S.toast(['Ops HQ sudah diberi tahu. Mulai pindai.', 'Ops HQ has been told. Start scanning.'], 'ok');
        go({ receipt: r.id, step: r.can_scan ? 'scan' : 'door' }, true);
      } catch (err) { S.fail(err); b.disabled = false; }
    });
  }

  /* ================= 1: the carton check and what is expected ================= */

  function headHtml(R) {
    return '<div class="k-stack k-stack--tight">' +
      '<span class="k-eyebrow">' + esc(R.brand_name || '') + '</span>' +
      '<span class="bm-ref">' + esc(refOf(R)) + '</span>' +
      '<span class="k-caption">' + (R.brand_po_number ? p2('No. PO merek', 'Brand PO') + ' <span class="k-mono">' + esc(R.brand_po_number) + '</span> · ' : '') +
        p2('tiba', 'arrived') + ' ' + esc(S.fmt.time(R.opened_at)) +
        (R.no_po && !R.no_po_linked ? ' · ' + S.pill('caution', 'Tanpa PO: menunggu Ops HQ', 'No PO: waiting for Ops HQ') : '') + '</span></div>';
  }

  function oldTasksNote(R) {
    if (!R.tasks_open) return '';
    return '<div class="k-note k-note--info">' + icon('rack', 20) + '<span>' +
      p2(R.tasks_open + ' bin sementara dari batch sebelumnya siap ditaruh di rak.', R.tasks_open + ' temporary bin(s) from an earlier batch are ready to put away.') +
      ' <a class="k-linkbtn" href="?receipt=' + R.id + '&step=putaway" ' + biAttr('Taruh di rak', 'Put away') + '></a></span></div>';
  }

  async function door(ctx, R) {
    S.fullScreen(false);
    S.setSub('Cek karton, lalu pindai per unit.', 'Check the cartons, then scan per unit.');
    const cs = R.carton_state;
    const started = R.total_received > 0;
    let carton = '';
    if (cs === 'waiting_spv') {
      carton = '<div class="k-card k-card--pad k-card--caution k-stack">' +
        '<span class="k-strong" style="color:var(--caution)">' + icon('warn', 20) + ' ' +
          p2('Surat Jalan: ' + R.sj_cartons + ' karton, dihitung: ' + R.counted_cartons, 'Surat Jalan: ' + R.sj_cartons + ' cartons, counted: ' + R.counted_cartons) + '</span>' +
        '<div class="k-line">' + bis('Keputusan SPV', 'SPV decision', 'k-strong') + ' ' + S.roleChip('supervisor') +
          (S.atLeast('supervisor') ? '' : ' <span class="k-caption" ' + biAttr('Panggil SPV sekarang', 'Call the SPV now') + '></span>') + '</div>' +
        '<div class="k-grid2">' + btn('k-btn--secondary', 'Terima & tulis ulang', 'Accept and rewrite', 'data-cd="accept_rewrite" data-min-role="supervisor"', 'check') +
          btn('k-btn--problem', 'Tolak', 'Refuse', 'data-cd="refuse" data-min-role="supervisor"', 'close') + '</div>' +
        '<span class="k-caption" ' + biAttr('Tulis ulang langsung dilaporkan ke Ops HQ.', 'A rewrite is reported to Ops HQ at once.') + '></span></div>';
    } else if (cs === 'refused') {
      carton = '<div class="k-card k-card--pad k-card--stop">' + bis('Kiriman ditolak SPV. Jangan tanda tangan Surat Jalan.', 'The SPV refused this delivery. Do not sign the Surat Jalan.', 'k-strong') + '</div>';
    } else if (cs === 'not_counted') {
      carton = '<div class="k-card k-card--pad k-stack k-stack--tight">' +
        '<div class="k-grid2"><label class="k-field"><span class="k-field__label" ' + biAttr('Karton di Surat Jalan', 'Cartons on the Surat Jalan') + '></span><div id="bm-sj"></div></label>' +
        '<label class="k-field"><span class="k-field__label" ' + biAttr('Karton dihitung', 'Cartons counted') + '></span><div id="bm-cnt"></div></label></div>' +
        '<span class="k-caption" ' + biAttr('Cek pintu saja, bukan stok. Beda? SPV memutuskan.', 'A door check only, never stock. Different? The SPV decides.') + '></span></div>';
    } else {
      carton = '<div class="k-card k-card--pad k-line" style="flex-wrap:wrap;gap:8px">' + icon('check', 20) +
        (cs === 'match' ? p2('Karton cocok: ' + R.counted_cartons, 'Cartons match: ' + R.counted_cartons)
          : p2('Diterima SPV, Surat Jalan ditulis ulang (' + R.counted_cartons + ' karton). Ops HQ diberi tahu.', 'Accepted by the SPV, Surat Jalan rewritten (' + R.counted_cartons + ' cartons). Ops HQ told.')) + '</div>';
    }
    const exp = R.lines.filter((l) => l.qty_expected);
    const action = cs === 'refused' ? btn('k-btn--secondary k-btn--lg k-btn--block', 'Kembali', 'Back', 'id="bm-home"', 'back')
      : cs === 'not_counted' ? btn('k-btn--primary k-btn--lg k-btn--block', 'Cek karton & mulai pindai', 'Check cartons and start scanning', 'id="bm-cc"', 'scan')
        : btn('k-btn--primary k-btn--lg k-btn--block', started ? 'Lanjut pindai' : 'Mulai pindai', started ? 'Continue scanning' : 'Start scanning', 'id="bm-start"' + (R.can_scan ? '' : ' disabled'), 'scan');
    ctx.body.innerHTML = '<div class="bm-wrap">' + stepBar(0, R) + headHtml(R) +
      '<div class="k-stack k-stack--tight">' + bis('Karton', 'Cartons', 'k-eyebrow') + carton + '</div>' +
      oldTasksNote(R) +
      (exp.length ? '<div class="k-card k-card--pad k-stack k-stack--tight"><div class="k-line k-line--between">' + bis('Yang diharapkan', 'Expected', 'k-strong') +
        '<span class="k-mono k-strong">' + n(R.total_expected) + ' pcs</span></div>' +
        '<table class="k-table bm-mini"><tbody>' + exp.map((l) => '<tr><td>' + esc(short(l.sku_name)) + '</td><td class="k-num">' + n(l.qty_expected) + '</td></tr>').join('') + '</tbody></table></div>'
        : note('caution', 'Belum ada PO: hitung semua unit. Ops HQ yang mencocokkan.', 'No PO yet: count every unit. Ops HQ will match it.')) +
      (S.atLeast('hq') && R.no_po && !R.no_po_linked ? '<div>' + btn('k-btn--secondary', 'Hubungkan ke permintaan', 'Link to a request', 'id="bm-link" data-min-role="hq"', 'link') + '</div>' : '') +
      '<div class="k-actionbar">' + action + '</div></div>';
    bindBar(ctx.body, R);
    if ($('#bm-sj', ctx.body)) {
      const a = S.stepper($('#bm-sj', ctx.body), { value: R.sj_cartons != null ? R.sj_cartons : 1, min: 0, max: 999 });
      const b = S.stepper($('#bm-cnt', ctx.body), { value: R.counted_cartons != null ? R.counted_cartons : 1, min: 0, max: 999 });
      $('#bm-cc', ctx.body).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await API().post('/inbound/receipts/' + R.id + '/cartons', { sj_cartons: a.get(), counted_cartons: b.get() });
          if (r.can_scan) go({ receipt: R.id, step: 'scan' });
          else {
            S.toast(['Jumlah karton beda dengan Surat Jalan. Panggil SPV.', 'The carton count differs from the Surat Jalan. Call the SPV.'], 'caution');
            S.rerender();
          }
        } catch (err) { S.fail(err); S.rerender(); }
      });
    }
    $$('[data-cd]', ctx.body).forEach((b) => b.addEventListener('click', async () => {
      const d = b.dataset.cd;
      if (d === 'refuse' && !(await S.confirm({ title: ['Tolak kiriman?', 'Refuse the delivery?'], text: ['Kiriman ini tidak diterima. Driver membawanya kembali.', 'This delivery is not received. The driver takes it back.'], ok: ['Tolak', 'Refuse'], danger: true }))) return;
      try { await API().post('/inbound/receipts/' + R.id + '/carton-decision', { decision: d }); S.rerender(); } catch (e) { S.fail(e); }
    }));
    const startB = $('#bm-start', ctx.body);
    if (startB) startB.addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
    const hm = $('#bm-home', ctx.body);
    if (hm) hm.addEventListener('click', () => go({}));
    const lk = $('#bm-link', ctx.body);
    if (lk) lk.addEventListener('click', () => linkDialog(R));
  }

  async function linkDialog(R) {
    const res = await API().get('/inbound/no-po' + API().qs({ site_id: R.site_id, status: 'open' }));
    const me = res.deliveries.find((d) => d.receipt_id === R.id);
    const cands = me ? me.candidates : [];
    S.modal({
      title: ['Hubungkan ke permintaan', 'Link to a request'],
      body: cands.length ? '<div class="k-stack">' + cands.map((c, i) => '<label class="k-check"><input type="radio" name="bm-c" value="' + c.id + '"' + (i ? '' : ' checked') + '> <span class="k-mono">' +
        esc(c.reference) + '</span> ' + (c.brand_po_number ? '· ' + esc(c.brand_po_number) : '') + '</label>').join('') + '</div>'
        : '<p class="k-p" ' + biAttr('Tidak ada permintaan terbuka untuk merek ini di dark store ini.', 'No open request for this brand at this dark store.') + '></p>',
      actions: cands.length ? [{ label: ['Batal', 'Cancel'], kind: 'secondary' }, {
        label: ['Hubungkan', 'Link'], kind: 'primary', minRole: 'hq', onClick: async (close, b) => {
          const v = $('input[name="bm-c"]:checked', b.closest('.k-modal'));
          await API().post('/inbound/receipts/' + R.id + '/link', { replenishment_id: +v.value });
          S.toast(['Kiriman dihubungkan.', 'Delivery linked.'], 'ok');
          S.rerender();
        },
      }] : [{ label: ['Tutup', 'Close'], kind: 'secondary' }],
    });
  }

  /* ================= 2: scan every unit ================= */

  const SCAN = { rid: null, last: null, damaged: false, pending: null, after: null, unknown: null, wrong: null };

  async function scanStep(ctx, R) {
    S.fullScreen(true, { title: ['Pindai barang', 'Scan items'], onBack: () => go({}) });
    if (!R.can_scan) { go({ receipt: R.id, step: 'door' }, true); return; }
    if (SCAN.rid !== R.id) Object.assign(SCAN, { rid: R.id, last: null, damaged: false, pending: null, after: null, unknown: null, wrong: null });
    if (!SCAN.last) {
      const filling = R.loads.filter((l) => l.status === 'filling');
      SCAN.last = filling.length ? filling[filling.length - 1] : null;
    }
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-scan">' + stepBar(1, R) +
      '<div class="k-line k-line--between"><h2 class="k-h2" ' + biAttr('Pindai setiap unit', 'Scan every unit') + '></h2>' +
        '<span class="k-mono k-strong" id="bm-total"></span></div>' +
      '<div id="bm-answer" aria-live="polite"></div>' +
      '<div id="bm-zone"></div>' +
      '<div id="bm-dmg" class="k-stack k-stack--tight"></div>' +
      '<button type="button" class="k-linkbtn" id="bm-manual" style="align-self:flex-start">' + p2('Produk tanpa barcode? Pilih dari daftar', 'Product without a barcode? Pick from the list') + '</button>' +
      '<div id="bm-bins"></div>' +
      oldTasksNote(R) +
      '<div class="k-card k-card--pad k-stack k-stack--tight"><div class="k-line k-line--between" style="flex-wrap:wrap">' + bis('Selisih per produk', 'Differences per product', 'k-strong') +
        '<span class="k-caption" ' + biAttr('dipindai/diharapkan', 'scanned/expected') + '></span></div><div id="bm-lines"></div></div>' +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Selesai pindai', 'Done scanning', 'id="bm-done"', 'check') + '</div></div>';
    const host = $('#bm-scan', ctx.body);
    bindBar(host, R);
    let seq = 0;
    const zone = S.scan(onCode, { mount: $('#bm-zone', host), title: ['Pindai barang', 'Scan the item'] });
    $('#bm-manual', host).addEventListener('click', () => go({ receipt: R.id, step: 'manual' }));
    $('#bm-done', host).addEventListener('click', () => {
      if (!R.total_received) { S.toast(['Pindai minimal satu unit dulu.', 'Scan at least one unit first.'], 'caution'); return; }
      if (SCAN.pending || SCAN.after) { S.toast(['Selesaikan unit rusak dulu.', 'Finish the damaged unit first.'], 'caution'); return; }
      go({ receipt: R.id, step: 'review' });
    });

    const curLoad = () => SCAN.last && (R.loads.find((x) => x.id === SCAN.last.id) || SCAN.last);

    function answerHtml() {
      if (SCAN.wrong) {
        return '<div class="k-card k-card--pad k-card--stop k-stack k-stack--tight"><span class="k-strong" style="color:var(--stop)">' + icon('warn', 20) + ' ' +
          esc(S.pick(SCAN.wrong)) + '</span><div>' + btn('k-btn--secondary k-btn--sm', 'Tutup', 'Dismiss', 'data-unk="close"') + '</div></div>';
      }
      if (SCAN.unknown != null) {
        return '<div class="k-card k-card--pad k-card--caution k-stack k-stack--tight">' +
          '<span class="k-strong" style="color:var(--caution)">' + icon('warn', 20) + ' ' + p2('Barcode tidak dikenal', 'Unknown barcode') +
            (SCAN.unknown ? ' <span class="k-mono">' + esc(SCAN.unknown) + '</span>' : '') + '</span>' +
          '<span ' + biAttr('Produk tanpa barcode? Pilih dari daftar. Tidak ada di daftar? Sisihkan unitnya dan panggil SPV.', 'A product with no barcode? Pick it from the list. Not on the list? Put the unit aside and call the SPV.') + '></span>' +
          '<div class="k-grid2">' + btn('k-btn--primary', 'Pilih dari daftar', 'Pick from the list', 'data-unk="pick"', 'list') +
            btn('k-btn--secondary', 'Tutup', 'Dismiss', 'data-unk="close"') + '</div></div>';
      }
      if (SCAN.damaged) return '';
      const l = curLoad();
      if (!l || l.status !== 'filling') {
        return '<div class="k-target bm-answer bm-answer--first"><div class="k-target__text">' +
          '<span class="k-target__label">' + p2(R.total_received ? 'Pindai unit berikutnya' : 'Pindai unit pertama', R.total_received ? 'Scan the next unit' : 'Scan the first unit') + '</span>' +
          '<span class="k-target__hint" ' + biAttr('Ambil satu unit dari karton, pindai barcodenya. WMS langsung bilang masuk ke bin mana.', 'Take one unit from the carton and scan its barcode. The WMS tells you which bin at once.') + '></span></div></div>';
      }
      const line = R.lines.find((x) => x.sku_id === l.sku_id) || {};
      const label = !l.label_scanned ? (l.is_extra ? ['Lebih dari PO. Ambil bin kosong ini, pindai labelnya', 'More than the PO. Take this empty bin, scan its label']
        : ['Ambil bin kosong ini, pindai labelnya', 'Take this empty bin, scan its label'])
        : l.is_extra ? ['Lebih dari PO. Masukkan ke', 'More than the PO. Put in'] : ['Masukkan ke', 'Put in'];
      const got = line.qty_received != null ? line.qty_received : l.qty;
      const cnt = line.qty_expected != null
        ? '<b>' + n(got) + '</b> ' + p2('dari', 'of') + ' ' + n(line.qty_expected)
        : '<b>' + n(got) + '</b> pcs';
      return '<div class="k-target bm-answer' + (l.is_extra ? ' k-target--stop' : '') + '"><div class="k-target__text">' +
        '<span class="k-target__label" ' + biAttr(label[0], label[1]) + '>' + esc(t(label[0], label[1])) + '</span>' +
        '<span class="k-target__code">' + esc(l.bin_code) + '</span>' +
        '<span class="bm-answer__sku">' + esc(short(l.sku_name || line.sku_name)) + '</span>' +
        '<span class="bm-answer__count">' + cnt + '</span>' +
        (l.is_extra ? '<span class="k-target__hint" style="color:var(--stop)" ' + biAttr('Tunggu Ops HQ. Jangan ke rak.', 'Waits for Ops HQ. Not to the rack.') + '></span>' : '') +
        '</div>' + btn('k-btn--secondary k-btn--sm', 'Bin penuh', 'Bin full', 'id="bm-full"') + '</div>';
    }

    function damageHtml() {
      const row = '<div class="k-card k-card--pad k-switchrow' + (SCAN.damaged ? ' bm-damage' : '') + '"><button type="button" class="k-switch--danger" id="bm-dmgsw" aria-checked="' + SCAN.damaged + '" data-aria-id="Rusak" data-aria-en="Damaged" aria-label="Rusak"></button>' +
        '<span class="k-grow k-strong"' + (SCAN.damaged ? ' style="color:var(--stop)"' : '') + '>' + p2(SCAN.damaged ? 'Rusak nyala' : 'Rusak', SCAN.damaged ? 'Damaged on' : 'Damaged') + '</span></div>';
      if (!SCAN.damaged) return row;
      if (SCAN.after) {
        const a = SCAN.after;
        const q = a.place === 'quarantine';
        return row + '<div class="k-card k-card--pad bm-damage k-stack">' +
          '<span class="k-strong" style="color:var(--stop)">' + esc(short(a.sku_name)) + '</span>' + bis('Lalu:', 'Then:', 'k-strong') +
          '<ol class="bm-steps"><li><span class="bm-num bm-num--ok">' + icon('check', 16, 3) + '</span>' + p2('Unit rusak sudah dipindai', 'The damaged unit is scanned') + '</li>' +
          '<li><span class="bm-num">2</span>' + (q ? p2('Taruh di baki ' + R.quarantine_tray, 'Put it in the tray ' + R.quarantine_tray)
            : p2('Berikan ke driver. Tulis di Surat Jalan: ditolak, rusak.', 'Give it to the driver. Write on the Surat Jalan: refused, damaged.')) + '</li>' +
          '<li><span class="bm-num' + (a.photo_needed ? '' : ' bm-num--ok') + '">' + (a.photo_needed ? '3' : icon('check', 16, 3)) + '</span>' +
            p2('Ambil 1 foto kerusakannya', 'Take 1 photo of the damage') + '</li></ol>' +
          (a.photo_needed ? '<div class="k-card k-card--pad">' + photoSlot({ key: 'dmg:' + a.difference_id, id: 'Foto kerusakan', en: 'Damage photo', capture: 'environment',
            receiptId: R.id, kind: 'damage', diff: a.difference_id, done: false, onChange: damagePhotoDone }) + '</div>' : '') +
          '<span class="k-caption" ' + biAttr('Dikirim ke Ops HQ untuk disetujui. Mode rusak mati sendiri setelah produk ini.', 'Sent to Ops HQ for approval. Damaged mode switches off by itself after this product.') + '></span>' +
          (a.photo_needed ? '' : btn('k-btn--secondary k-btn--block', 'Selesai, mode rusak mati', 'Done, damaged mode off', 'id="bm-doff"', 'check')) + '</div>';
      }
      if (SCAN.pending) {
        return row + '<div class="k-card k-card--pad bm-damage k-stack">' + bis('Unit rusak ini mau ke mana?', 'Where does this damaged unit go?', 'k-strong') +
          '<button type="button" class="bm-opt" data-dto="quarantine">' + icon('box', 26) + '<span><span class="bm-opt__title">' + p2('Masukkan ke karantina', 'Put in quarantine') +
            ' <span class="k-mono">' + esc(R.quarantine_tray) + '</span></span><span class="bm-opt__sub" ' + biAttr('Baki karantina. Jangan ke rak.', 'The quarantine tray. Not on the rack.') + '></span></span></button>' +
          '<button type="button" class="bm-opt" data-dto="driver">' + icon('truck', 26) + '<span><span class="bm-opt__title" ' + biAttr('Kembalikan ke driver sekarang', 'Back to the driver now') + '></span>' +
            '<span class="bm-opt__sub" ' + biAttr('Unit ikut pulang dengan sopir pengirim. Tulis di Surat Jalan: ditolak, rusak.', 'The unit leaves with the delivery driver. Write on the Surat Jalan: refused, damaged.') + '></span></span></button>' +
          btn('k-btn--ghost k-btn--sm', 'Batal', 'Cancel', 'id="bm-dcancel"') + '</div>';
      }
      return row + '<div class="k-note k-note--stop">' + icon('warn', 20) + '<span class="k-strong" ' + biAttr('Mode rusak: unit ini tidak jadi stok. Pindai unit yang rusak.', 'Damaged mode: this unit never becomes stock. Scan the damaged unit.') + '></span></div>';
    }

    function damagePhotoDone() {
      const k = SCAN.after && 'dmg:' + SCAN.after.difference_id;
      if (!k || !PH[k] || PH[k].state !== 'done') return;
      S.toast(['Foto disimpan. Mode rusak mati.', 'Photo saved. Damaged mode off.'], 'ok');
      SCAN.damaged = false; SCAN.after = null;
      paint();
      reload();
    }

    function binsHtml() {
      if (R.free_bins) return '<span class="k-caption">' + p2('Produk sama selalu ke bin-nya. Bin kosong tersisa: ' + R.free_bins + '.', 'The same product always goes to its bin. Empty bins left: ' + R.free_bins + '.') + '</span>';
      return '<div class="k-stack k-stack--tight">' + note('caution', 'Semua bin sementara terisi. Panggil SPV untuk tambah bin sementara.', 'Every temporary bin is taken. Ask the SPV to add a temporary bin.') +
        '<div>' + btn('k-btn--secondary k-btn--sm', 'Tambah bin sementara', 'Add a temporary bin', 'id="bm-addbin" data-min-role="supervisor"', 'plus') + '</div></div>';
    }

    function paint() {
      if (!host.isConnected) return;
      const l = curLoad();
      $('#bm-total', host).textContent = n(R.total_received) + (R.total_expected != null ? ' / ' + n(R.total_expected) : '') + ' pcs';
      const ans = $('#bm-answer', host);
      ans.innerHTML = answerHtml();
      const dm = $('#bm-dmg', host);
      dm.innerHTML = damageHtml();
      $('#bm-bins', host).innerHTML = binsHtml();
      $('#bm-lines', host).innerHTML = linesHtml(R, true, l && l.status === 'filling' ? l.sku_id : null);
      const needLabel = l && l.status === 'filling' && !l.label_scanned && !SCAN.damaged;
      zone.setTitle(needLabel ? 'Pindai label bin, lalu unitnya' : 'Pindai barang', needLabel ? 'Scan the bin label, then the unit' : 'Scan the item');
      S.toggle($('#bm-dmgsw', dm), (on) => { SCAN.damaged = on; SCAN.pending = null; SCAN.after = null; paint(); });
      const bf = $('#bm-full', ans);
      if (bf) bf.addEventListener('click', async () => {
        try { await API().post('/inbound/loads/' + SCAN.last.id + '/full', {}); S.toast(['Unit berikutnya dapat bin baru.', 'The next unit gets a new bin.'], 'ok'); await reload(); } catch (e) { S.fail(e); }
      });
      $$('[data-unk]', ans).forEach((b) => b.addEventListener('click', () => {
        const pick = b.dataset.unk === 'pick';
        SCAN.unknown = null; SCAN.wrong = null;
        if (pick) go({ receipt: R.id, step: 'manual' }); else paint();
      }));
      const ab = $('#bm-addbin', host);
      if (ab) ab.addEventListener('click', () => addBin(reload));
      $$('[data-dto]', dm).forEach((b) => b.addEventListener('click', () => countUnit(SCAN.pending, b.dataset.dto)));
      const dc = $('#bm-dcancel', dm);
      if (dc) dc.addEventListener('click', () => { SCAN.pending = null; paint(); });
      const doff = $('#bm-doff', dm);
      if (doff) doff.addEventListener('click', () => { SCAN.damaged = false; SCAN.after = null; paint(); });
      bindSlots(dm);
      S.applyLang(host);
      S.lockAll(host);
    }

    async function reload() {
      const my = ++seq;
      try {
        const fresh = await getReceipt(R.id);
        if (my !== seq) return;
        R = fresh;
        paint();
      } catch (e) { /* the next scan refreshes */ }
    }

    async function countUnit(unit, damageTo) {
      const body = Object.assign({ idempotency_key: key() }, unit);
      if (SCAN.damaged) { body.damaged = true; body.damage_to = damageTo || null; }
      ++seq;
      let res;
      try { res = await API().post('/inbound/receipts/' + R.id + '/units', body); }
      catch (e) { zone.reject(S.pick(e.message)); S.fail(e); return null; }
      if (!res.accepted) {
        if (res.outcome === 'needs_damage_place') { SCAN.pending = unit; paint(); return res; }
        zone.reject(S.pick(res.message));
        if (res.outcome === 'unknown_barcode') { SCAN.unknown = unit.code || ''; paint(); return res; }
        if (res.outcome === 'wrong_brand') { SCAN.wrong = res.message; paint(); return res; }
        S.toast(res.message, res.outcome === 'no_free_bin' ? 'caution' : 'stop');
        if (res.outcome === 'no_free_bin' || res.outcome === 'carton_check') await reload();
        return res;
      }
      SCAN.unknown = null; SCAN.wrong = null;
      if (res.outcome === 'damaged') {
        SCAN.pending = null;
        SCAN.after = { sku_name: res.sku && res.sku.name_display, place: damageTo, difference_id: res.difference_id, photo_needed: res.photo_needed };
      } else if (res.load) {
        SCAN.last = res.load;
        const i = R.loads.findIndex((x) => x.id === res.load.id);
        if (i >= 0) R.loads[i] = res.load; else R.loads.push(res.load);
      }
      /* Answer at once from the scan's own reply; the full receipt follows. */
      R.total_received = res.total_received;
      R.free_bins = res.free_bins;
      if (res.line) {
        const j = R.lines.findIndex((x) => x.sku_id === res.line.sku_id);
        if (j >= 0) R.lines[j] = Object.assign({}, R.lines[j], res.line); else R.lines.push(res.line);
      }
      paint();
      zone.accept(short(res.sku && res.sku.name_display), S.pick(res.message));
      reload();
      return res;
    }

    async function onCode(code, z) {
      const c = code.trim().toUpperCase();
      if (SCAN.damaged && (SCAN.pending || SCAN.after)) { z.reject(t('Selesaikan unit rusak dulu.', 'Finish the damaged unit first.')); return; }
      const l = curLoad();
      if (/-(IN)-\d+$/.test(c)) {
        if (!l || l.status !== 'filling') { z.reject(t('Pindai unit dulu, lalu label bin.', 'Scan a unit first, then the bin label.')); return; }
        try {
          const nl = await API().post('/inbound/loads/' + l.id + '/bin-label', { code: c });
          SCAN.last = nl;
          const i = R.loads.findIndex((x) => x.id === nl.id);
          if (i >= 0) R.loads[i] = nl;
          paint();
          z.accept(l.bin_code, t('Label cocok. Masukkan unit ke bin ini.', 'Label matches. Put the units in this bin.'));
        } catch (e) { z.reject(S.pick(e.message)); S.fail(e); }
        return;
      }
      await countUnit({ code: code.trim() });
    }

    paint();
  }

  async function addBin(after) {
    try {
      const r = await API().post('/inbound/temp-bins' + API().qs({ site_id: S.siteId() }), {});
      const nb = r.bins[r.bins.length - 1];
      S.toast([(nb ? nb.code + ' ditambahkan. ' : '') + 'Cetak labelnya di Rak & bin.', (nb ? nb.code + ' added. ' : '') + 'Print its label in Rak & bin.'], 'ok');
      if (after) await after();
    } catch (e) { S.fail(e); }
  }

  /* ================= 2: pick a product with no barcode ================= */

  async function manualStep(ctx, R) {
    S.fullScreen(true, { title: ['Pilih produk', 'Pick a product'], onBack: () => go({ receipt: R.id, step: 'scan' }) });
    if (!R.can_scan) { go({ receipt: R.id, step: 'door' }, true); return; }
    const list = R.lines.map((l) => ({ sku_id: l.sku_id, sku_name: l.sku_name, has_barcode: l.has_barcode, line: l }));
    if (R.no_po || !list.length) {
      const res = await API().get('/skus' + API().qs({ brand_id: R.brand_id, limit: 200 }));
      const have = new Set(list.map((x) => x.sku_id));
      (res.skus || []).forEach((s) => { if (!have.has(s.id)) list.push({ sku_id: s.id, sku_name: s.name_display, has_barcode: true, line: null }); });
    }
    let sel = null;
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-man"></div>';
    const host = $('#bm-man', ctx.body);
    function paint() {
      host.innerHTML = stepBar(1, R) + '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Pilih produk', 'Pick a product') + '></h2>' +
        '<span class="k-caption">' + esc(refOf(R) + ' · ' + (R.brand_name || '')) + '</span></div>' +
        '<p class="k-p k-strong" ' + biAttr('Ketuk produk yang sedang Anda pegang.', 'Tap the product you are holding.') + '></p>' +
        note('caution', 'Hanya untuk produk yang memang tidak punya barcode. Dicatat dan dilihat SPV.', 'Only for products that really have no barcode. Logged and seen by the SPV.') +
        '<div class="k-list">' + list.map((x) => {
          const l = R.lines.find((y) => y.sku_id === x.sku_id);
          const on = sel === x.sku_id;
          return '<div class="k-row' + (on ? ' bm-next' : '') + '" style="flex-wrap:wrap">' +
            '<button type="button" data-sku="' + x.sku_id + '" style="all:unset;cursor:pointer;flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span class="k-row__title">' + esc(short(x.sku_name)) + (x.has_barcode ? '' : ' <span class="k-caption">· ' + esc(t('tidak ada barcode', 'no barcode')) + '</span>') + '</span>' +
            '<span class="k-row__sub k-mono">' + n(l ? l.qty_received : 0) + (l && l.qty_expected != null ? ' ' + esc(t('dari', 'of')) + ' ' + n(l.qty_expected) : '') +
              (l && l.bins && l.bins.length ? ' · ' + esc(l.bins.map(binShort).join(', ')) : '') + '</span></button>' +
            (on ? '<div class="k-line">' + btn('k-btn--secondary', '−1', '−1', 'data-minus aria-label="-1"', 'minus') + btn('k-btn--primary', '+1', '+1', 'data-plus aria-label="+1"', 'plus') + '</div>' : '') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Kembali ke pindai', 'Back to scanning', 'id="bm-back"', 'scan') + '</div>';
      bindBar(host, R);
      $$('[data-sku]', host).forEach((b) => b.addEventListener('click', () => { sel = +b.dataset.sku; paint(); }));
      const plus = $('[data-plus]', host), minus = $('[data-minus]', host);
      if (plus) plus.addEventListener('click', async () => {
        plus.disabled = true;
        try {
          const r = await API().post('/inbound/receipts/' + R.id + '/units', { sku_id: sel, idempotency_key: key() });
          if (!r.accepted) S.toast(r.message, 'caution');
          else S.toast(r.message, r.outcome === 'extra_bin' ? 'caution' : 'info', 6000);
          if (r.load) { SCAN.rid = R.id; SCAN.last = r.load; }
          R = await getReceipt(R.id); paint();
        } catch (e) { S.fail(e); plus.disabled = false; }
      });
      if (minus) minus.addEventListener('click', async () => {
        try { await API().post('/inbound/receipts/' + R.id + '/units/undo', { sku_id: sel, manual_only: true, idempotency_key: key() }); R = await getReceipt(R.id); paint(); }
        catch (e) { S.fail(e); }
      });
      $('#bm-back', host).addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
      S.applyLang(host);
    }
    paint();
  }

  /* ================= 3: check the differences ================= */

  function tallies(R) {
    const out = { match: 0, short: 0, shortNames: [], extra: 0, extraNames: [], damaged: 0, q: 0, d: 0 };
    R.lines.forEach((l) => {
      const e = l.qty_expected || 0;
      if (l.qty_expected != null && l.qty_received === e && e > 0) out.match += 1;
      if (l.qty_expected != null && l.qty_received < e) { out.short += e - l.qty_received; out.shortNames.push(short(l.sku_name) + ' ' + (e - l.qty_received)); }
      if (l.qty_expected != null && l.qty_received > e) { out.extra += l.qty_received - e; out.extraNames.push(short(l.sku_name) + ' ' + (l.qty_received - e)); }
      out.damaged += l.qty_damaged;
    });
    R.differences.filter((d) => d.kind === 'damaged').forEach((d) => { if (d.place === 'quarantine') out.q += d.qty; else out.d += d.qty; });
    return out;
  }

  async function reviewStep(ctx, R) {
    S.fullScreen(true, { title: ['Cek selisih', 'Check differences'], onBack: () => go({ receipt: R.id, step: 'scan' }) });
    const T = tallies(R);
    const diffs = R.lines.filter(isDiff);
    const kpi = (cls, id, en, num, foot) => '<div class="k-kpi' + (cls ? ' k-kpi--' + cls : '') + '">' + bis(id, en, 'k-kpi__label') + '<span class="k-kpi__num">' + num + '</span>' + (foot || '') + '</div>';
    ctx.body.innerHTML = '<div class="bm-wrap">' + stepBar(2, R) +
      '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Cek selisih', 'Check differences') + '></h2>' +
        '<span class="k-caption">' + esc(refOf(R) + ' · ' + (R.brand_name || '')) + '</span></div>' +
      '<div class="k-kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">' +
        kpi('', 'Diharapkan', 'Expected', R.total_expected != null ? n(R.total_expected) : '-', bis('pcs di PO', 'pcs on the PO', 'k-kpi__foot')) +
        kpi('', 'Dipindai', 'Scanned', n(R.total_received), bis('pcs', 'pcs', 'k-kpi__foot')) +
        kpi(T.short || T.extra ? 'caution' : 'ok', 'Kurang / lebih', 'Short / extra', (T.short ? '−' + T.short : '0') + ' / ' + (T.extra ? '+' + T.extra : '0'), bis('pcs', 'pcs', 'k-kpi__foot')) +
        kpi(T.damaged ? 'stop' : '', 'Rusak', 'Damaged', n(T.damaged), '<span class="k-kpi__foot">' + p2('Karantina ' + T.q + ', driver ' + T.d, 'Quarantine ' + T.q + ', driver ' + T.d) + '</span>') +
      '</div>' +
      (diffs.length ? '<div class="k-card k-card--pad k-card--caution k-stack k-stack--tight">' + bis(diffs.length + ' produk berbeda dari PO', diffs.length + ' product(s) differ from the PO', 'k-strong') +
          linesHtml({ lines: diffs }, false) + '</div>' +
          note('caution', 'Selisih dikirim ke Ops HQ untuk disetujui dalam 24 jam. Unit lebih tetap di bin sementaranya dan tidak dijual sampai diputuskan.',
            'Differences go to Ops HQ for approval within 24 hours. Extra units stay in their temporary bin and are not sold until decided.')
        : note('ok', 'Semua cocok dengan PO.', 'Everything matches the PO.', 'check')) +
      (R.no_po && !R.no_po_linked ? note('caution', 'Kiriman tanpa PO: belum jadi stok sampai Ops HQ menghubungkannya.', 'Delivery with no PO: not stock until Ops HQ links it.') : '') +
      (R.lines.length > diffs.length ? '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Cocok dengan PO', 'Matching the PO', 'k-strong') +
        linesHtml({ lines: R.lines.filter((l) => !isDiff(l)) }, false) + '</div>' : '') +
      '<p class="k-caption" ' + biAttr('Ada yang belum dipindai? Kembali ke pindai sebelum lanjut.', 'Something not scanned yet? Go back to scanning before you continue.') + '></p>' +
      '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Kembali pindai', 'Back to scanning', 'id="bm-back"', 'scan') +
        btn('k-btn--primary k-btn--lg k-btn--block', 'Benar, lanjut', 'Correct, continue', 'id="bm-next"' + (R.total_received ? '' : ' disabled'), 'arrow') + '</div></div>';
    bindBar(ctx.body, R);
    $('#bm-back', ctx.body).addEventListener('click', () => go({ receipt: R.id, step: 'scan' }));
    $('#bm-next', ctx.body).addEventListener('click', () => go({ receipt: R.id, step: 'docs' }));
  }

  /* ================= 4: paperwork and the three POD photos ================= */

  const PROOF = [
    ['sj_signed', 'Surat Jalan / Faktur yang sudah ditandatangani', 'The signed Surat Jalan / Faktur', 'environment'],
    ['selfie', 'Swafoto penerima', 'Selfie of the receiver', 'user'],
    ['sj_driver', 'Surat Jalan / Faktur bersama driver', 'The Surat Jalan / Faktur with the driver', 'environment'],
  ];
  const docsKey = (id) => 'bm-docs-' + id;
  function docsGet(id) {
    let v = null;
    try { v = sessionStorage.getItem(docsKey(id)); } catch (e) { v = null; }
    if (!v) { try { v = localStorage.getItem(docsKey(id)); } catch (e) { v = null; } }
    try { return JSON.parse(v || '{}') || {}; } catch (e) { return {}; }
  }
  function docsSet(id, v) {
    const s = JSON.stringify(v);
    try { sessionStorage.setItem(docsKey(id), s); } catch (e) { /* private mode */ }
    try { localStorage.setItem(docsKey(id), s); } catch (e) { /* private mode */ }
  }
  const AUTO = new Set();     // receipts just finished on this device: print their slips once

  async function docsStep(ctx, R) {
    S.fullScreen(true, { title: ['Dokumen & foto', 'Paperwork & photos'], onBack: () => go({ receipt: R.id, step: 'review' }) });
    const T = tallies(R);
    const dmg = R.differences.filter((d) => d.kind === 'damaged');
    const D = docsGet(R.id);
    const write = [];
    if (T.shortNames.length) write.push(['Kurang: ' + T.shortNames.join(', '), 'Short: ' + T.shortNames.join(', ')]);
    if (T.extraNames.length) write.push(['Lebih: ' + T.extraNames.join(', '), 'Extra: ' + T.extraNames.join(', ')]);
    if (T.d) write.push([T.d + ' rusak dikembalikan ke driver: tulis ditolak, rusak', T.d + ' damaged back to the driver: write refused, damaged']);
    if (T.q) write.push([T.q + ' rusak di karantina', T.q + ' damaged in quarantine']);
    const hint = write.length ? write.map((w) => p2(w[0], w[1])).join('<br>')
      : p2('Semua cocok: tulis jumlah yang sama dengan PO.', 'Everything matches: write the same quantities as the PO.');
    const podKeys = PROOF.map((p) => 'pod:' + R.id + ':' + p[0]);
    const dmgKeys = dmg.map((d) => 'dmg:' + d.id);
    const slots = PROOF.map((p, i) => photoSlot({ key: podKeys[i], id: p[1], en: p[2], capture: p[3], receiptId: R.id, kind: p[0],
      done: R.proof_done.includes(p[0]), onChange: refresh })).join('') +
      dmg.map((d, i) => photoSlot({ key: dmgKeys[i], id: 'Foto kerusakan: ' + short(d.sku_name), en: 'Damage photo: ' + short(d.sku_name), capture: 'environment',
        receiptId: R.id, kind: 'damage', diff: d.id, done: d.photos > 0, onChange: refresh })).join('');
    ctx.body.innerHTML = '<div class="bm-wrap">' + stepBar(3, R) +
      '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Dokumen & foto', 'Paperwork & photos') + '></h2>' +
        '<span class="k-caption">' + esc(refOf(R) + ' · ' + (R.brand_name || '')) + '</span></div>' +
      '<div class="k-card k-card--pad">' +
        '<label class="bm-check"><input type="checkbox" data-doc="wrote"' + (D.wrote ? ' checked' : '') + '><span><span class="bm-check__t">1. ' + p2('Tulis jumlah yang diterima di Surat Jalan / Faktur', 'Write the received quantities on the Surat Jalan / Faktur') + '</span>' +
          '<span class="bm-check__h">' + hint + '</span></span></label>' +
        '<label class="bm-check"><input type="checkbox" data-doc="signed"' + (D.signed ? ' checked' : '') + '><span><span class="bm-check__t">2. ' + p2('Tanda tangani Surat Jalan / Faktur', 'Sign the Surat Jalan / Faktur') + '</span>' +
          '<span class="bm-check__h">' + p2('Sebaiknya SPV yang tanda tangan. Beri driver 1 salinan Surat Jalan.', 'Ideally the SPV signs. Give the driver 1 copy of the Surat Jalan.') + '</span></span></label>' +
      '</div>' +
      '<div class="k-card k-card--pad"><div class="k-line k-line--between" style="margin-bottom:4px">' + bis('3. Foto bukti terima (POD)', '3. Proof of delivery photos (POD)', 'k-strong') +
        '<span class="k-mono k-strong" id="bm-phn"></span></div>' + slots + '</div>' +
      '<span class="k-caption" id="bm-left"></span>' +
      '<div class="k-actionbar">' + btn('k-btn--primary k-btn--lg k-btn--block', 'Selesai & cetak slip', 'Finish and print slips', 'id="bm-finish" disabled', 'print') +
        btn('k-btn--ghost k-btn--block', 'Kembali', 'Back', 'id="bm-back"') + '</div></div>';
    bindBar(ctx.body, R);
    bindSlots(ctx.body);
    const slotDone = (k) => !!(SLOTS[k] && SLOTS[k].done);
    function refresh() {
      const fb = $('#bm-finish', ctx.body);
      if (!fb || !fb.isConnected) return;
      const D2 = docsGet(R.id);
      const pod = podKeys.filter(slotDone).length;
      const dmgLeft = dmgKeys.filter((k) => !slotDone(k)).length;
      const busy = podKeys.concat(dmgKeys).some((k) => PH[k] && PH[k].state === 'uploading');
      const ticks = (D2.wrote ? 1 : 0) + (D2.signed ? 1 : 0);
      const photosLeft = 3 - pod + dmgLeft;
      $('#bm-phn', ctx.body).textContent = pod + ' ' + t('dari', 'of') + ' 3';
      fb.disabled = !(ticks === 2 && photosLeft === 0 && !busy && R.total_received > 0);
      const bits = [];
      if (ticks < 2) bits.push([(2 - ticks) + ' centang lagi', (2 - ticks) + ' more tick' + (2 - ticks > 1 ? 's' : '')]);
      if (photosLeft > 0) bits.push([photosLeft + ' foto lagi', photosLeft + ' more photo' + (photosLeft > 1 ? 's' : '')]);
      $('#bm-left', ctx.body).innerHTML = bits.length ? p2('Untuk selesai: ' + bits.map((b) => b[0]).join(', ') + '.', 'To finish: ' + bits.map((b) => b[1]).join(', ') + '.') : '';
    }
    $$('[data-doc]', ctx.body).forEach((c) => c.addEventListener('change', () => {
      const v = docsGet(R.id);
      v[c.dataset.doc] = c.checked;
      docsSet(R.id, v);
      refresh();
    }));
    $('#bm-back', ctx.body).addEventListener('click', () => go({ receipt: R.id, step: 'review' }));
    $('#bm-finish', ctx.body).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await API().post('/inbound/receipts/' + R.id + '/finish', {});
        S.toast(['Penerimaan selesai. Cetak slip putaway.', 'Receipt finished. Print the putaway slips.'], 'ok');
        AUTO.add(R.id);
        go({ receipt: R.id }, true);
      } catch (err) {
        if (err && typeof err.message !== 'string') S.toast(['Belum bisa selesai: cek foto dan centang.', 'Not ready to finish: check the photos and ticks.'], 'caution');
        else S.fail(err);
        refresh();
      }
    });
    refresh();
  }

  /* ================= 5: print the putaway slips ================= */

  const PRINTED = new Set();  // receipts whose slips this device sent to the printer

  function printerNote() {
    const P = NJW.print;
    const st = P.settings();
    return st.thermal === true
      ? note('info', 'Dicetak di printer thermal ' + st.width + ' mm.' + (st.kiosk ? '' : ' Di dialog cetak, pilih printer thermal.'),
        'Prints on the ' + st.width + ' mm thermal printer.' + (st.kiosk ? '' : ' In the print dialog, choose the thermal printer.'))
      : st.thermal === false
        ? note('info', 'Perangkat ini tidak punya printer thermal: slip dicetak di kertas A4.', 'This device has no thermal printer: the slips print on A4 paper.')
        : '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span>' + p2('Printer belum diatur di perangkat ini, jadi slip dicetak di kertas A4. ', 'No printer is set up on this device yet, so the slips print on A4 paper. ') +
          '<a class="k-linkbtn" href="pengaturan.html?tab=printer" ' + biAttr('Atur printer', 'Set up the printer') + '></a></span></div>';
  }

  async function printStep(ctx, R) {
    S.fullScreen(true, { title: ['Cetak slip putaway', 'Print putaway slips'], onBack: () => go({}) });
    const s = await API().get('/inbound/receipts/' + R.id + '/slip');
    const P = NJW.print;
    P.previewCss();
    const tasks = s.tasks || [];
    function render() {
      const printed = PRINTED.has(R.id);
      ctx.body.innerHTML = '<div class="bm-wrap">' + stepBar(4, R) +
        '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Cetak slip putaway', 'Print putaway slips') + '></h2>' +
          '<span class="k-caption">' + esc(refOf(R) + ' · ' + (R.brand_name || '')) + (s.slip_no ? ' · <span class="k-mono">' + esc(s.slip_no) + '</span>' : '') + '</span></div>' +
        '<p class="k-p">' + p2(tasks.length + ' slip, satu per bin sementara. Taruh setiap slip di bin sementaranya.', tasks.length + ' slip(s), one per temporary bin. Put each slip on its temporary bin.') + '</p>' +
        printerNote() +
        '<div class="k-list">' + tasks.map((x) => '<div class="k-row"><span class="k-row__icon">' + icon('print', 24) + '</span><span class="k-row__text">' +
          '<span class="k-row__title"><span class="k-mono">' + esc(binShort(x.from_bin)) + '</span> → <span class="k-mono">' + esc(x.to_bin || '?') + '</span></span>' +
          '<span class="k-row__sub">' + x.n + '/' + x.of + ' · ' + esc(short(x.sku_name)) + ' · ' + n(x.qty) + ' unit</span></span></div>').join('') + '</div>' +
        ((s.held || []).length ? '<div class="k-stack k-stack--tight">' + bis('Tetap di bin sementara (tanpa slip)', 'Stay in the temporary bin (no slip)', 'k-eyebrow') +
          s.held.map((h) => '<div class="k-row k-row--caution"><span class="k-row__icon k-row__icon--caution">' + icon('warn', 24) + '</span><span class="k-row__text">' +
            '<span class="k-row__title"><span class="k-mono">' + esc(binShort(h.from_bin)) + '</span> · ' + (h.returning ? p2('Retur ke merek', 'Return to the brand') : p2('Tunggu Ops HQ', 'Wait for Ops HQ')) + '</span>' +
            '<span class="k-row__sub">' + esc(short(h.sku_name)) + ' · ' + n(h.qty) + ' unit</span></span></div>').join('') + '</div>' : '') +
        (tasks.length ? '<details class="k-card k-card--pad"><summary class="k-strong" style="cursor:pointer">' + p2('Lihat slip', 'Preview the slips') + '</summary>' +
          '<div class="bm-roll" lang="id" style="margin-top:12px">' + binSlipsHtml(s) + '</div></details>'
          : note('ok', 'Tidak ada bin untuk ditaruh sekarang.', 'No bin to put away right now.', 'check')) +
        (printed ? '<div class="k-card k-card--pad k-card--focus k-stack k-stack--tight">' + bis('Slip sudah keluar dari printer?', 'Did the slips come out of the printer?', 'k-strong') +
          '<span class="k-caption" ' + biAttr('Setelah dicetak, WMS membuat satu tugas taruh di rak per bin sementara.', 'Once printed, the WMS makes one putaway task per temporary bin.') + '></span></div>' : '') +
        '<div><a class="k-linkbtn" href="?receipt=' + R.id + '&step=detail">' + p2('Lihat tanda terima', 'View the receipt') + '</a></div>' +
        '<div class="k-actionbar">' +
          (!tasks.length ? btn('k-btn--primary k-btn--lg k-btn--block', 'Lanjut', 'Continue', 'id="bm-ok"', 'arrow')
            : printed ? btn('k-btn--secondary k-btn--lg k-btn--block', 'Cetak ulang', 'Print again', 'id="bm-print"', 'print') +
              btn('k-btn--primary k-btn--lg k-btn--block', 'Sudah dicetak, mulai taruh', 'Printed, start putting away', 'id="bm-printed"', 'check')
              : btn('k-btn--primary k-btn--lg k-btn--block', 'Cetak slip', 'Print slips', 'id="bm-print"', 'print') +
                '<button type="button" class="k-linkbtn" id="bm-printed" style="align-self:center">' + p2('Sudah dicetak di perangkat lain', 'Already printed on another device') + '</button>') +
        '</div></div>';
      bindBar(ctx.body, R);
      const pb = $('#bm-print', ctx.body);
      if (pb) pb.addEventListener('click', doPrint);
      const pd = $('#bm-printed', ctx.body);
      if (pd) pd.addEventListener('click', confirmPrinted);
      const ok = $('#bm-ok', ctx.body);
      if (ok) ok.addEventListener('click', confirmPrinted);
      S.applyLang(ctx.body);
    }
    async function doPrint() {
      try {
        await printBinSlips(s);
      } catch (e) { S.toast(['Slip tidak tercetak. Coba lagi.', 'The slips did not print. Try again.'], 'caution'); }
      PRINTED.add(R.id);
      render();
    }
    async function confirmPrinted(e) {
      if (e && e.currentTarget) e.currentTarget.disabled = true;
      try {
        const res = await API().post('/inbound/receipts/' + R.id + '/slips-printed', {});
        const k = (res.items || []).length;
        if (k) S.toast([k + ' tugas taruh di rak dibuat.', k + ' putaway task(s) created.'], 'ok');
        go({ receipt: R.id, step: k ? 'putaway' : 'detail' }, true);
      } catch (err) { S.fail(err); render(); }
    }
    render();
    /* Finishing the receipt prints the slips where auto-print is on for this
     * device (Pengaturan, Printer: one profile only, like Hiryu's). Elsewhere the
     * Print slips button shows instead. */
    if (AUTO.has(R.id)) {
      AUTO.delete(R.id);
      if (tasks.length && P.settings().autoSlip) doPrint();
    }
  }

  /* ================= 6: putaway tasks, one per temporary bin ================= */

  function setLoadParam(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set('load', id); else u.searchParams.delete('load');
    history.replaceState(null, '', u.pathname + u.search);
  }

  async function putawayStep(ctx, R) {
    if (R.status === 'completed' && R.stage === 'print') return printStep(ctx, R);
    const back = () => go(R.status === 'open' ? { receipt: R.id, step: 'scan' } : {});
    S.fullScreen(true, { title: ['Taruh di rak', 'Put away'], onBack: back });
    const fetchList = () => API().get('/inbound/putaway' + API().qs({ site_id: R.site_id, receipt_id: R.id }));
    let P = await fetchList();
    ctx.body.innerHTML = '<div class="bm-wrap" id="bm-put"></div>';
    const host = $('#bm-put', ctx.body);
    const cur = R.status === 'open' ? 1 : 5;
    const doneGo = () => go(R.status === 'open' ? { receipt: R.id, step: 'scan' } : { receipt: R.id, step: 'detail' }, true);

    function listView() {
      setLoadParam(null);
      const ready = P.items, held = P.held;
      host.innerHTML = stepBar(cur, R) +
        '<div class="k-stack k-stack--tight"><h2 class="k-h2" ' + biAttr('Taruh di rak', 'Put away') + '></h2>' +
        '<span class="k-caption">' + esc(refOf(R)) + ' · ' + p2(ready.length + ' tugas, satu per bin sementara', ready.length + ' task(s), one per temporary bin') + '</span></div>' +
        (ready.length ? '<p class="k-p" ' + biAttr('Bawa bin sementara dengan slipnya ke rak. Urutan sesuai jalan di rak.', 'Carry the temporary bin with its slip to the rack. In walking order.') + '></p>' : '') +
        ready.map((it, i) => '<button type="button" class="k-card k-card--pad bm-task' + (i === 0 ? ' k-card--focus' : '') + '" data-task="' + i + '">' +
          (i === 0 ? bis('Berikutnya', 'Next', 'k-eyebrow') : '') +
          '<span class="bm-move"><span>' + esc(binShort(it.load.bin_code)) + '</span>' + icon('arrow', 20) + '<span>' + esc(it.to_location_label || '?') + '</span></span>' +
          '<span class="k-strong">' + esc(short(it.sku_name)) + ' · ' + n(it.load.qty_to_put) + ' unit</span>' +
          (it.to_location_code ? '' : note('caution', 'Produk ini belum punya bin rak. Panggil SPV (Rak & bin, Perlu bin).', 'This product has no rack bin yet. Call the SPV (Rak & bin, Needs a bin).')) + '</button>').join('') +
        held.map((h) => '<div class="k-row k-row--caution"><span class="k-row__icon k-row__icon--caution">' + icon('warn', 24) + '</span><span class="k-row__text">' +
          '<span class="k-row__title"><span class="k-mono">' + esc(h.load.bin_code) + '</span> · ' + (h.returning ? p2('Retur ke merek', 'Return to the brand') : p2('Tunggu Ops HQ', 'Wait for Ops HQ')) + '</span>' +
          '<span class="k-row__sub">' + esc(short(h.sku_name)) + ' · ' + n(h.load.qty_hold || (h.load.qty - h.load.qty_put)) + ' ' + esc(h.load.is_extra ? t('unit lebih', 'extra units') : t('unit', 'units')) + '</span>' +
          '<span class="k-row__sub k-row__sub--caution" ' + biAttr(h.returning ? 'Siapkan untuk dikembalikan ke merek.' : 'Jangan ditaruh sebelum diputuskan.', h.returning ? 'Ready it for return to the brand.' : 'Do not put away before a decision.') + '></span></span></div>').join('') +
        (!ready.length ? note('ok', 'Tidak ada bin yang perlu ditaruh sekarang.', 'No bin to put away right now.', 'check') : '') +
        '<div><a class="k-linkbtn" href="?receipt=' + R.id + '&step=detail">' + p2('Lihat tanda terima', 'View the receipt') + '</a></div>' +
        '<div class="k-actionbar">' + (ready.length ? btn('k-btn--primary k-btn--lg k-btn--block', 'Mulai tugas berikutnya', 'Start the next task', 'id="bm-startput"', 'arrow')
          : btn('k-btn--primary k-btn--lg k-btn--block', R.status === 'open' ? 'Kembali ke pindai' : 'Selesai', R.status === 'open' ? 'Back to scanning' : 'Done', 'id="bm-back"', R.status === 'open' ? 'back' : 'check')) + '</div>';
      bindBar(host, R);
      $$('[data-task]', host).forEach((b) => b.addEventListener('click', () => taskView(P.items[+b.dataset.task])));
      const sp = $('#bm-startput', host);
      if (sp) sp.addEventListener('click', () => taskView(P.items[0]));
      const bk = $('#bm-back', host);
      if (bk) bk.addEventListener('click', doneGo);
      S.applyLang(host);
      S.lockAll(host);
    }

    function taskView(it) {
      if (!it) { listView(); return; }
      setLoadParam(it.load.id);
      let alt = null;   // after Bin rak penuh: {code, label}
      const d = P.divider;
      const idx = P.items.indexOf(it);
      function paint() {
        const label = alt ? alt.label : it.to_location_label;
        const code = alt ? alt.code : it.to_location_code;
        const words = rackWords(label);
        const left = it.load.qty_to_put;
        host.innerHTML = stepBar(cur, R) +
          '<div class="k-line k-line--between"><h2 class="k-h2">' + p2('Tugas ' + (idx + 1) + ' dari ' + P.items.length, 'Task ' + (idx + 1) + ' of ' + P.items.length) + '</h2>' +
            '<button type="button" class="k-linkbtn" id="bm-list">' + p2('Daftar tugas', 'Task list') + '</button></div>' +
          '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('1. Ambil dari bin sementara', '1. Take from the temporary bin', 'k-eyebrow') +
            '<span class="k-code k-code--xl">' + esc(it.load.bin_code) + '</span>' +
            '<span class="k-strong" style="font-size:17px">' + esc(it.sku_name) + ' · ' + n(left) + ' unit</span></div>' +
          '<div class="k-target"><div class="k-target__text">' + bis('2. Ke bin rak', '2. To rack bin', 'k-target__label') +
            '<span class="k-target__code">' + esc(label || '?') + '</span>' +
            (words ? '<span class="k-target__hint" ' + biAttr(words[0], words[1]) + '></span>' : '') + '</div></div>' +
          (code ? '' : note('caution', 'Produk ini belum punya bin rak. Panggil SPV (Rak & bin, Perlu bin).', 'This product has no rack bin yet. Call the SPV (Rak & bin, Needs a bin).')) +
          '<ol class="bm-steps">' +
            '<li><span class="bm-num">3</span><span><span class="bm-swatch" style="background:' + esc(d.hex) + '"></span>' +
              p2('Pasang sekat ' + d.colour_id.toLowerCase() + ' (hari ini) di belakang stok lama, kalau ada', 'Put a new ' + d.colour_en.toLowerCase() + ' divider (today) behind the old stock, if any') + '</span></li>' +
            '<li><span class="bm-num">4</span>' + p2('Tulis tanggal ' + d.written + ' di sekat putih', 'Write the date ' + d.written + ' on the white divider') + '</li>' +
            '<li><span class="bm-num">5</span>' + p2('Taruh unitnya di belakang sekat, cek jumlahnya, lalu pindai label bin rak', 'Put the units behind the divider, check the count, then scan the rack bin label') + '</li></ol>' +
          '<div class="k-card k-card--pad k-line k-line--between" style="flex-wrap:wrap;gap:12px"><span class="k-strong" ' + biAttr('Unit yang ditaruh', 'Units put away') + '></span><div id="bm-qty"></div></div>' +
          '<div id="bm-zone"></div>' +
          note('info', 'Setelah pindai, unit bisa dijual dan stok baru dikirim ke Hiryu.', 'After the scan the units are sellable and the new stock goes to Hiryu.') +
          '<div class="k-actionbar">' + btn('k-btn--secondary k-btn--lg k-btn--block', 'Bin rak penuh', 'Rack bin full', 'id="bm-rfull"' + (code ? '' : ' disabled')) + '</div>';
        const q = S.stepper($('#bm-qty', host), { value: left, min: 1, max: Math.max(1, left), label: ['Unit yang ditaruh', 'Units put away'] });
        S.scan(async (c, z) => {
          const cc = c.trim().toUpperCase();
          if (/-(IN)-\d+$/.test(cc)) {
            if (cc === String(it.load.bin_code).toUpperCase()) z.accept(it.load.bin_code, t('Bin sementara benar. Sekarang pindai label bin rak.', 'Right temporary bin. Now scan the rack bin label.'));
            else z.reject(t('Bukan bin tugas ini: ambil dari ' + it.load.bin_code + '.', 'Not this task\'s bin: take from ' + it.load.bin_code + '.'));
            return;
          }
          try {
            const r = await API().post('/inbound/loads/' + it.load.id + '/putaway', { location_code: c, qty: q.get(), idempotency_key: key() });
            z.accept(c, S.pick(r.message));
            S.toast(r.message, 'ok');
            it.load = r.load;
            if (r.remaining > 0) {
              S.toast(['Sisa ' + r.remaining + ' unit. Bin rak penuh? Tekan Bin rak penuh.', r.remaining + ' unit(s) left. Rack bin full? Tap Rack bin full.'], 'info', 6000);
              paint();
              return;
            }
            P = await fetchList();
            if (P.items.length) {
              S.toast(['Tugas selesai. Lanjut ke bin berikutnya.', 'Task done. On to the next bin.'], 'ok');
              taskView(P.items[0]);
              return;
            }
            S.toast(['Semua bin sudah di rak.', 'Every bin is on the rack.'], 'ok');
            doneGo();
          } catch (e) { z.reject(S.pick(e.message)); S.fail(e); }
        }, { mount: $('#bm-zone', host), title: ['Pindai label bin rak', 'Scan the rack bin label'] });
        $('#bm-list', host).addEventListener('click', listView);
        $('#bm-rfull', host).addEventListener('click', async () => {
          try {
            const nx = await API().post('/inbound/loads/' + it.load.id + '/rack-full', { location_code: code });
            alt = { code: nx.location_code, label: nx.location_label };
            S.toast(['Taruh sisanya di ' + nx.location_label + '.', 'Put the rest in ' + nx.location_label + '.'], 'info', 6000);
            paint();
          } catch (e) { S.fail(e); }
        });
        bindBar(host, R);
        S.applyLang(host);
      }
      paint();
    }

    const want = S.param('load');
    const first = want ? P.items.find((x) => String(x.load.id) === String(want)) : null;
    if (first) taskView(first); else listView();
  }

  /* ================= 7: the receipt ================= */

  const DIFF_WORDS = {
    short: (d) => ['−' + d.qty, '−' + d.qty],
    extra: (d) => ['+' + d.qty + (d.bin_code ? ', di ' + d.bin_code : ''), '+' + d.qty + (d.bin_code ? ', in ' + d.bin_code : '')],
    damaged: (d) => d.place === 'quarantine' ? [d.qty + ' rusak, di karantina ' + (d.bin_code || ''), d.qty + ' damaged, in quarantine ' + (d.bin_code || '')]
      : [d.qty + ' rusak, dikembalikan ke driver', d.qty + ' damaged, back to the driver'],
  };
  const diffPill = (d) => d.status === 'pending' ? S.pill('caution', 'Menunggu persetujuan Ops HQ', 'Waiting for Ops HQ approval')
    : d.decision === 'reject' ? S.pill('info', 'Disetujui: ditolak', 'Approved: rejected')
      : d.decision === 'accept' ? S.pill('ok', 'Disetujui: diterima', 'Approved: accepted') : S.pill('ok', 'Disetujui', 'Approved');
  const STAGE_STEP = { scan: 1, print: 4, putaway: 5, done: 6, refused: 0 };

  async function detail(ctx, R) {
    S.fullScreen(false);
    const spv = S.atLeast('supervisor');
    const closed = R.status === 'completed';
    const [fk, slip] = await Promise.all([
      spv && closed ? API().get('/receipts/' + R.id + '/faktur').catch(() => null) : null,
      closed ? API().get('/inbound/receipts/' + R.id + '/slip').catch(() => null) : null,
    ]);
    S.setSub('Barang masuk / ' + refOf(R), 'Inbound / ' + refOf(R));
    const names = slip ? slip.receiver : (R.opened_by || '');
    const cartons = R.counted_cartons != null ? n(R.counted_cartons) + ' karton' + (R.carton_state === 'accepted_rewrite' ? ' (Surat Jalan ' + n(R.sj_cartons) + ', ditulis ulang SPV)' : '') : '';
    const cartonsEn = R.counted_cartons != null ? n(R.counted_cartons) + ' cartons' + (R.carton_state === 'accepted_rewrite' ? ' (Surat Jalan ' + n(R.sj_cartons) + ', rewritten by the SPV)' : '') : '';
    const pend = R.differences.filter((d) => d.status === 'pending').length;
    const statusPill = stagePill(Object.assign({}, R, { pending_differences: pend }));
    const res = (l) => '<span class="k-line" style="flex-wrap:wrap;gap:4px">' + pills(l, false) + '</span>';
    const pages = (fk && fk.pages) || [];
    const tasks = slip ? (slip.tasks || []) : [];
    const stageCard = R.stage === 'print'
      ? '<div class="k-card k-card--pad k-card--focus k-stack k-stack--tight">' + bis('Berikutnya: cetak slip putaway', 'Next: print the putaway slips', 'k-strong') +
        '<span class="k-caption">' + p2(R.slip_pending + ' bin sementara menunggu slipnya.', R.slip_pending + ' temporary bin(s) waiting for their slip.') + '</span>' +
        '<div>' + btn('k-btn--primary', 'Cetak slip putaway', 'Print putaway slips', 'id="bm-toprint"', 'print') + '</div></div>'
      : R.stage === 'putaway'
        ? '<div class="k-card k-card--pad k-card--focus k-stack k-stack--tight">' + bis('Berikutnya: taruh di rak', 'Next: put away', 'k-strong') +
          '<span class="k-caption">' + p2(R.tasks_open + ' tugas, ' + R.units_to_put + ' unit masih di bin sementara.', R.tasks_open + ' task(s), ' + R.units_to_put + ' unit(s) still in temporary bins.') + '</span>' +
          '<div>' + btn('k-btn--primary', 'Taruh di rak', 'Put away', 'id="bm-toput"', 'rack') + '</div></div>'
        : R.stage === 'done' ? note('ok', 'Selesai: semua bin sudah di rak.', 'Done: every bin is on the rack.', 'check') : '';
    ctx.body.innerHTML = '<div class="bm-wrap bm-wrap--wide">' +
      (R.status === 'refused' ? '' : stepBar(STAGE_STEP[R.stage] != null ? STAGE_STEP[R.stage] : 6, R)) +
      '<div class="k-stack k-stack--tight"><div class="k-line" style="flex-wrap:wrap;gap:12px"><span class="bm-ref">' + esc(refOf(R)) + '</span>' + statusPill +
        (closed && R.faktur_uploaded_at ? S.pill('ok', 'Faktur diunggah ' + S.fmt.time(R.faktur_uploaded_at), 'Faktur uploaded ' + S.fmt.time(R.faktur_uploaded_at)) : '') + '</div>' +
        '<span class="k-caption">' + esc(R.brand_name || '') + (R.brand_po_number ? ' · ' + esc(t('No. PO merek', 'Brand PO')) + ' ' + esc(R.brand_po_number) : '') +
          (cartons ? ' · <span ' + biAttr(cartons, cartonsEn) + '></span>' : '') +
          (R.first_unit_at ? ' · ' + p2('dipindai ' + S.fmt.time(R.first_unit_at) + ' sampai ' + S.fmt.time(R.last_unit_at) + ' oleh ' + names,
            'scanned ' + S.fmt.time(R.first_unit_at) + ' to ' + S.fmt.time(R.last_unit_at) + ' by ' + names) : '') + '</span></div>' +
      stageCard +
      '<div class="bm-cols">' +
        '<div class="k-stack">' +
          '<div class="k-tablewrap"><table class="k-table"><thead><tr><th ' + biAttr('Produk', 'Product') + '></th><th class="k-num" ' + biAttr('Harapan', 'Expected') + '></th>' +
            '<th class="k-num" ' + biAttr('Diterima', 'Received') + '></th><th ' + biAttr('Hasil', 'Result') + '></th></tr></thead><tbody>' +
            R.lines.map((l) => '<tr' + (isDiff(l) ? ' class="is-caution"' : '') + '><td>' + esc(l.sku_name) + '</td><td class="k-num">' + n(l.qty_expected) + '</td>' +
              '<td class="k-num">' + n(l.qty_received) + '</td><td>' + res(l) + '</td></tr>').join('') +
            '<tr><td class="k-strong" ' + biAttr('Total', 'Total') + '></td><td class="k-num">' + n(R.total_expected) + '</td><td class="k-num k-strong">' + n(R.total_received) + '</td><td>' +
              (R.total_expected != null ? p2(n(R.total_received) + ' dari ' + n(R.total_expected) + ' unit', n(R.total_received) + ' of ' + n(R.total_expected) + ' units') : '') + '</td></tr>' +
          '</tbody></table></div>' +
          (R.differences.length ? '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Selisih', 'Differences', 'k-strong') +
            R.differences.map((d) => { const w = DIFF_WORDS[d.kind](d); return '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px"><span><span class="k-strong">' + esc(short(d.sku_name)) + '</span> <span ' + biAttr(w[0], w[1]) + '></span></span>' + diffPill(d) + '</div>'; }).join('') +
            (R.decide_by ? '<span class="k-caption">' + p2('Masuk stok dan tagihan setelah Ops HQ setuju (batas ' + S.fmt.dt(R.decide_by) + ').', 'Reaches stock and billing after Ops HQ approves (by ' + S.fmt.dt(R.decide_by) + ').') + '</span>' : '') + '</div>' : '') +
          (R.no_po && !R.no_po_linked ? '<div class="k-card k-card--pad k-card--caution k-stack">' + note('caution', 'Kiriman tanpa PO: unit belum jadi stok sampai Ops HQ menghubungkannya ke permintaan restock.', 'Delivery with no PO: the units are not stock until Ops HQ links it to a restock request.') +
            '<div>' + btn('k-btn--primary', 'Hubungkan ke permintaan', 'Link to a request', 'id="bm-link" data-min-role="hq"', 'link') + '</div></div>' : '') +
          (spv && R.photos.length ? '<div class="k-card k-card--pad k-stack k-stack--tight">' + bis('Foto penerimaan', 'Receiving photos', 'k-strong') +
            '<div class="bm-pages">' + R.photos.map((p) => '<a class="bm-page" target="_blank" rel="noopener" href="' + esc('..' + p.url) + '" style="background-image:url(' + esc('..' + p.url) + ')">' + esc(photoName(p.kind)) + '</a>').join('') + '</div>' +
            '<span class="k-caption" ' + biAttr('Hanya SPV dan Ops HQ yang bisa melihat foto ini.', 'Only the SPV and Ops HQ can see these photos.') + '></span></div>' : '') +
        '</div>' +
        '<div class="k-stack">' +
          (closed ? '<div class="k-card k-card--pad k-stack">' + bis('Unggah Faktur', 'Upload the Faktur', 'k-h2') +
            '<div class="bm-pages">' + pages.map((p) => '<a class="bm-page" target="_blank" rel="noopener" href="' + esc('..' + p.url) + '"' +
              (/^image\//.test(p.content_type) ? ' style="background-image:url(' + esc('..' + p.url) + ')"' : '') + '>' + esc(t('Hal. ', 'p. ') + p.page_no) + '</a>').join('') +
              (pages.length ? '<button type="button" class="bm-page" id="bm-addpg" style="align-items:center;cursor:pointer">' + icon('plus', 22) + '</button>' : '') + '</div>' +
            '<div class="bm-drop" id="bm-drop">' + icon('upload', 24) + '<div>' + p2('Tarik foto ke sini atau ', 'Drag photos here or ') + '<button type="button" class="k-linkbtn" id="bm-pick" data-min-role="supervisor" ' + biAttr('pilih file', 'choose files') + '></button>. ' +
              p2('Foto semua halaman.', 'Photograph every page.') + '</div></div>' +
            '<span class="k-caption" ' + biAttr('Bisa dari kamera ponsel: buka penerimaan ini di ponsel, tekan Unggah Faktur.', 'From a phone camera too: open this receipt on the phone, press Upload Faktur.') + '></span>' +
            (pages.length ? '<span class="k-caption">' + p2(pages.length + ' halaman disimpan ' + S.fmt.time(fk.faktur_uploaded_at) + ' oleh ' + (fk.faktur_uploaded_by || ''), pages.length + ' pages saved ' + S.fmt.time(fk.faktur_uploaded_at) + ' by ' + (fk.faktur_uploaded_by || '')) + '</span>' : '') +
            '<div class="k-phone-only">' + btn('k-btn--primary k-btn--block', 'Unggah Faktur', 'Upload Faktur', 'id="bm-cam" data-min-role="supervisor"', 'camera') + '</div></div>' : '') +
          (closed ? '<div class="k-card k-card--pad k-stack k-stack--tight">' +
            '<span class="k-h2">' + p2('Slip putaway', 'Putaway slip') + (slip && slip.slip_no ? ' <span class="k-mono">' + esc(slip.slip_no) + '</span>' : '') + '</span>' +
            '<span class="k-caption" ' + biAttr('Satu slip per bin sementara untuk menaruh barang, dan satu ringkasan untuk SPV tanda tangan dan simpan bersama Surat Jalan dan Faktur.', 'One slip per temporary bin for the putaway, and one summary for the SPV to sign and keep with the Surat Jalan and the Faktur.') + '></span>' +
            '<div class="k-line" style="flex-wrap:wrap;gap:8px">' + (tasks.length ? btn('k-btn--secondary', 'Cetak ulang slip bin', 'Reprint bin slips', 'id="bm-binslips"', 'print') : '') +
              btn('k-btn--secondary', 'Cetak ringkasan', 'Print summary', 'id="bm-slip"', 'print') + '</div></div>' : '') +
        '</div></div>' +
      '<div><a class="k-linkbtn" href="barang-masuk.html">' + icon('back', 18) + p2('Semua penerimaan', 'All receipts') + '</a></div></div>';
    bindBar(ctx.body, R);
    const upload = async (files) => {
      if (!files.length) return;
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      try { await API().form('/receipts/' + R.id + '/faktur', fd); S.toast(['Faktur disimpan.', 'Faktur saved.'], 'ok'); S.rerender(); } catch (e) { S.fail(e); }
    };
    /* Inputs that stay in the page (see photoSlot): picked files are never lost. */
    const input = (cap) => {
      const f = document.createElement('input');
      f.type = 'file'; f.accept = 'image/*,application/pdf'; f.multiple = true; f.className = 'bm-file';
      if (cap) f.setAttribute('capture', cap);
      ctx.body.appendChild(f);
      f.addEventListener('change', () => { const files = Array.from(f.files || []); f.value = ''; upload(files); });
      return f;
    };
    const fi = input(null), fc = input('environment');
    ['#bm-pick', '#bm-addpg'].forEach((sel) => { const b = $(sel, ctx.body); if (b) b.addEventListener('click', () => fi.click()); });
    const cam = $('#bm-cam', ctx.body);
    if (cam) cam.addEventListener('click', () => fc.click());
    const drop = $('#bm-drop', ctx.body);
    if (drop && spv) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); upload(Array.from(e.dataTransfer.files || [])); });
    }
    const sl = $('#bm-slip', ctx.body);
    if (sl) sl.addEventListener('click', () => printSummary(slip).catch(() => S.toast(['Ringkasan tidak tercetak.', 'The summary did not print.'], 'caution')));
    const bs = $('#bm-binslips', ctx.body);
    if (bs) bs.addEventListener('click', () => printBinSlips(slip).catch(() => S.toast(['Slip tidak tercetak.', 'The slips did not print.'], 'caution')));
    const tpr = $('#bm-toprint', ctx.body);
    if (tpr) tpr.addEventListener('click', () => go({ receipt: R.id, step: 'print' }));
    const tp = $('#bm-toput', ctx.body);
    if (tp) tp.addEventListener('click', () => go({ receipt: R.id, step: 'putaway' }));
    const lk = $('#bm-link', ctx.body);
    if (lk) lk.addEventListener('click', () => linkDialog(R));
  }
  const photoName = (k) => ({ sj_signed: t('SJ ditandatangani', 'Signed SJ'), selfie: t('Swafoto', 'Selfie'), sj_driver: t('SJ + driver', 'SJ + driver'), sj_no_po: t('SJ tanpa PO', 'SJ, no PO'), damage: t('Kerusakan', 'Damage') }[k] || k);

  /* ================= the putaway slips (thermal 80 mm, A4 without one) ================= */
  /* One slip per temporary bin goes with the bin to the rack: product, units, from
   * the temporary bin, to the rack bin, today's divider colour. The summary is the
   * record the SPV signs. Printed in Indonesian, like the other paper records.
   * Long product names wrap onto the next line. */

  function head(s, W, title) {
    const P = NJW.print;
    const L = 11;
    const kv = (k, v) => P.wrap(v || '-', W - L).map((x, i) => (i ? ' '.repeat(L) : (k + ' '.repeat(L)).slice(0, L)) + x);
    return { kv, lines: [
      P.center('NINJA VAN · SATSET WMS', W),
      { b: P.center(title, W) },
      P.rule('=', W),
      kv('Dark store', S.shortCode(s.site_code) + ' · ' + (s.site_name || '')),
      kv('Merek', s.brand_name),
      kv('Ninja ref', s.reference),
      kv('No. PO', s.brand_po_number),
    ] };
  }

  function binSlipLines(s, x, W) {
    const P = NJW.print;
    const h = head(s, W, 'SLIP PUTAWAY ' + x.n + '/' + x.of);
    return h.lines.concat([
      h.kv('Slip', s.slip_no),
      h.kv('Dicetak', P.when().both),
      P.rule('=', W),
      { b: P.wrap(x.sku_name, W) },
      P.lr('Jumlah', n(x.qty) + ' pcs', W),
      P.lr('Dari bin sementara', x.from_bin, W),
      { b: P.lr('Ke bin rak', x.to_bin || 'minta SPV', W) },
      P.lr('Warna sekat', x.divider.colour_id + ', minggu ' + x.divider.week_parity, W),
      P.lr('Tulis di sekat putih', x.divider.written || '', W),
      P.rule('-', W),
      P.wrap('Taruh unit di belakang sekat, lalu pindai label bin rak di WMS (Taruh di rak). Unit bisa dijual setelah dipindai.', W),
      '',
      'Ditaruh oleh ' + '_'.repeat(Math.max(4, W - 13)),
    ]);
  }
  const CUT = '<div style="border-top:1px dashed #000;margin:5mm 0;height:0"></div>';
  function binSlipsHtml(s) {
    const P = NJW.print;
    return (s.tasks || []).map((x) => '<div style="break-inside:avoid;page-break-inside:avoid">' + P.slip(binSlipLines(s, x, P.cols())) + '</div>').join(CUT);
  }
  function printBinSlips(s) {
    if (!s || !(s.tasks || []).length) return Promise.resolve(false);
    return NJW.print.thermal(binSlipsHtml(s), { title: 'Slip putaway ' + (s.slip_no || '') });
  }

  function summaryLines(s, W) {
    const P = NJW.print;
    const h = head(s, W, 'RINGKASAN PUTAWAY');
    const from = P.when(s.received_from), to = P.when(s.received_to);
    const diffText = (x) => {
      if (x.kind === 'extra') return x.sku_name + ': ' + x.qty + ' unit lebih, tetap di ' + (x.bin_code || '') + '.';
      if (x.kind === 'damaged') return x.sku_name + ': ' + x.qty + ' unit rusak, ' + (x.place === 'quarantine' ? 'di karantina ' + (x.bin_code || '') + '.' : 'dikembalikan ke driver, tertulis di Surat Jalan.');
      return x.sku_name + ': kurang ' + x.qty + ' unit dari permintaan.';
    };
    const pend = s.differences.filter((x) => x.status === 'pending');
    const sign = (who, names) => [{ b: P.wrap(who + ': ' + (names || ''), W) }, '', 'Tanda tangan ' + '_'.repeat(W - 13), '', 'Tanggal/jam  ' + '_'.repeat(W - 13), ''];
    const out = h.lines.concat([
      h.kv('Slip', s.slip_no),
      h.kv('Diterima', from.date + ', ' + from.time + (s.received_to ? ' sampai ' + to.time : '') + ' WIB'),
      h.kv('Penerima', (s.receiver || '-') + (s.sj_signed_by ? ' · Surat Jalan ditandatangani ' + s.sj_signed_by : '')),
      h.kv('Dicetak', P.when().both),
      P.rule('=', W),
    ]);
    if (!s.lines.length) out.push(P.wrap('Belum ada unit yang ditaruh di rak.', W));
    s.lines.forEach((l, i) => {
      if (i) out.push(P.rule('-', W));
      out.push({ b: P.wrap((i + 1) + '. ' + l.sku_name, W, '   ') });
      out.push(P.lr('   Jumlah', n(l.qty) + ' pcs', W, '   '));
      out.push(P.lr('   Dari bin sementara', l.from_bin, W, '   '));
      out.push({ b: P.lr('   Ke bin rak', l.to_bin, W, '   ') });
      out.push(P.lr('   Warna sekat', l.divider.colour_id + ', minggu ' + l.divider.week_parity, W, '   '));
    });
    out.push(P.rule('=', W), { b: P.lr('Total ditaruh di rak', n(s.total_put) + ' pcs', W) });
    const left = (s.tasks || []).reduce((a, x) => a + x.qty, 0);
    if (left) out.push(P.wrap('Belum ditaruh: ' + n(left) + ' pcs di ' + s.tasks.length + ' bin sementara.', W));
    out.push(P.wrap('Satu bin sementara, satu produk.', W));
    if (s.differences.length) {
      out.push(P.rule('-', W), { b: P.wrap('SELISIH' + (pend.length ? ', menunggu persetujuan Ops HQ' : '') + ' (tidak ditaruh di rak)', W) });
      s.differences.forEach((x) => out.push(P.wrap('- ' + diffText(x), W, '  ')));
    }
    if (s.claim_deadline) out.push({ b: P.wrap('Batas klaim ke merek (24 jam): ' + P.when(s.claim_deadline).both + '.', W) });
    out.push(P.rule('=', W), ...sign('Ditaruh oleh (staf)', s.signatures.put_by.join(', ')), ...sign('Diperiksa SPV', s.signatures.spv),
      P.rule('-', W), P.wrap('Ringkasan ini catatan kepatuhan. SPV tanda tangan, lalu simpan bersama Surat Jalan dan Faktur dari kiriman ini.', W));
    return out;
  }
  const printSummary = (s) => NJW.print.thermal(NJW.print.slip(summaryLines(s, NJW.print.cols())), { title: 'Ringkasan putaway ' + (s.slip_no || '') });

  /* ?slip=<id>: the summary, for old links and the laptop. */
  async function slipView(ctx, id) {
    S.fullScreen(true, { title: ['Slip putaway', 'Putaway slip'], onBack: () => go({ receipt: id, step: 'detail' }) });
    const s = await API().get('/inbound/receipts/' + id + '/slip');
    const P = NJW.print;
    P.previewCss();
    ctx.body.innerHTML = '<div class="bm-wrap">' +
      '<div class="k-line" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
        btn('k-btn--secondary', 'Kembali', 'Back', 'id="bm-sback"', 'back') +
        ((s.tasks || []).length ? btn('k-btn--secondary', 'Cetak slip bin', 'Print bin slips', 'id="bm-pbins"', 'print') : '') +
        btn('k-btn--primary', 'Cetak ringkasan', 'Print summary', 'id="bm-print"', 'print') + '</div>' +
      printerNote() +
      '<div class="bm-roll" lang="id">' + P.slip(summaryLines(s, P.cols())) + '</div></div>';
    $('#bm-print', ctx.body).addEventListener('click', () => printSummary(s));
    const pb = $('#bm-pbins', ctx.body);
    if (pb) pb.addEventListener('click', () => printBinSlips(s));
    $('#bm-sback', ctx.body).addEventListener('click', () => go({ receipt: id, step: 'detail' }));
  }

  /* ================= router ================= */

  S.page(async function (ctx) {
    styles();
    const slip = S.param('slip'), nopo = S.param('nopo'), rid = S.param('receipt');
    let step = S.param('step');
    if (step === 'summary') step = 'docs';          // the old *Semua barang sudah diterima*
    if (slip) return slipView(ctx, slip);
    if (nopo) return noPo(ctx, nopo);
    if (!rid) return home(ctx);
    const R = await getReceipt(rid);
    if (R.status === 'refused') return step === 'door' ? door(ctx, R) : detail(ctx, R);
    if (R.status === 'open') {
      if (step === 'door' || !R.can_scan) return door(ctx, R);
      if (step === 'scan') return scanStep(ctx, R);
      if (step === 'manual') return manualStep(ctx, R);
      if (step === 'review') return reviewStep(ctx, R);
      if (step === 'docs') return docsStep(ctx, R);
      if (step === 'putaway') return putawayStep(ctx, R);   // bins batched before 7 Oct
      if (R.no_po && !R.no_po_linked && S.atLeast('hq')) return door(ctx, R);
      return R.total_received > 0 ? scanStep(ctx, R) : door(ctx, R);
    }
    if (step === 'print') return printStep(ctx, R);
    if (step === 'putaway') return putawayStep(ctx, R);
    if (step === 'detail') return detail(ctx, R);
    if (R.stage === 'print') return printStep(ctx, R);
    if (R.stage === 'putaway') return putawayStep(ctx, R);
    return detail(ctx, R);
  });
  S.onSiteChange(() => go({}, true));
})();
