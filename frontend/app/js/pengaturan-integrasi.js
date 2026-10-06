/* pengaturan-integrasi.js: Pengaturan, Integrasi Hiryu (PRD §9.3, board 11a/11d).
 *
 * The SPV checks the pipe at opening; Ops HQ switches the link and fixes
 * failures; in the demo, Shaun watches Pesan Hiryu.
 *
 *   GET  /api/hiryu-link/status?site_id=      link, queue per message type, failures
 *   POST /api/hiryu-link/live {live}          Sambungan Hiryu aktif (Ops HQ)
 *   POST /api/hiryu-link/retry-failed?site_id=  Coba lagi yang gagal (Ops HQ)
 *   POST /api/hiryu-link/snapshot?site_id=    Kirim snapshot stok penuh (Ops HQ)
 *   GET  /api/hiryu-link/messages?site_id=&since=   Pesan Hiryu, every message in and out
 *   GET  /api/hiryu-link/messages/{id}        one message with its whole body
 *
 * Pesan Hiryu refreshes every 3 seconds with what changed since the last look
 * (new messages and retries), and can be paused.
 *
 * Peta pesan (above the log): every message between Hiryu and the WMS, field
 * by field, from peta-pesan.json. That file is built from the code by
 * `python tools/gen_message_map.py`; edit the generator, never the JSON. Each
 * log row's number and its "Definisi" link open the map card of its message;
 * ?pesan=<key> in the URL opens one card (keys 1 to 6, catalogue_request,
 * rules, h).
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const api = () => S.api();
  const span = (p, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + ' ' + biAttr(p[0], p[1]) + '>' + esc(t(p[0], p[1])) + '</span>';

  const CSS = `
  .hl-word { font-family:var(--font) !important; font-size:22px !important; line-height:1.2; }
  .hl-checks { display:flex; flex-wrap:wrap; gap:8px 18px; font-size:13px; }
  .hl-check { display:inline-flex; align-items:center; gap:6px; font-weight:600; color:var(--ink-2); }
  .hl-check--ok { color:var(--ok); } .hl-check--no { color:var(--stop); }
  .hl-livehead { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
  .hl-live { display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--ok); }
  .hl-live__dot { width:10px; height:10px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 0 rgba(18,112,63,.5); animation:hl-pulse 1.6s infinite; }
  .hl-live.is-paused { color:var(--muted); } .hl-live.is-paused .hl-live__dot { background:var(--muted); animation:none; }
  @keyframes hl-pulse { 0% { box-shadow:0 0 0 0 rgba(18,112,63,.45); } 70% { box-shadow:0 0 0 8px rgba(18,112,63,0); } 100% { box-shadow:0 0 0 0 rgba(18,112,63,0); } }
  .hl-filters { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; }
  .hl-legend { display:flex; flex-wrap:wrap; gap:8px 16px; font-size:12.5px; color:var(--muted); font-weight:600; }
  .hl-list { display:flex; flex-direction:column; border-top:1px solid var(--rule); }
  .hl-msg { border-bottom:1px solid var(--rule); }
  .hl-msg.is-new { animation:hl-flash 2.4s ease-out; }
  @keyframes hl-flash { 0% { background:#FFF4CC; } 100% { background:transparent; } }
  .hl-sum { width:100%; display:grid; grid-template-columns:72px 128px 40px minmax(0,1.2fr) minmax(0,1.6fr) 150px 22px; gap:12px; align-items:center;
            padding:10px 16px; border:0; background:transparent; text-align:left; min-height:60px; }
  .hl-sum:hover { background:var(--ground); }
  .hl-sum:focus-visible { outline:3px solid rgba(31,78,140,.35); outline-offset:-3px; }
  .hl-time { font-family:var(--mono); font-size:13px; font-weight:600; color:var(--ink-2); }
  .hl-dir { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:800; padding:4px 8px; border-radius:8px; white-space:nowrap; }
  .hl-dir--in { color:var(--ok); background:var(--ok-bg); }
  .hl-dir--out { color:var(--action); background:var(--action-bg); }
  .hl-no { width:34px; height:34px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font:800 16px var(--mono);
           color:#fff; background:var(--navy); }
  .hl-no--q { font-size:13px; background:var(--ink-2); }
  .hl-type { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .hl-type__name { font-weight:700; color:var(--ink); }
  .hl-type__tags { display:flex; flex-wrap:wrap; gap:4px; }
  .hl-h { font:700 11px var(--mono); padding:2px 6px; border-radius:5px; background:var(--sunk); color:var(--ink-2); }
  .hl-via { font-size:11px; font-weight:800; padding:2px 6px; border-radius:5px; background:var(--caution-bg); color:var(--caution); text-transform:uppercase; letter-spacing:.03em; }
  .hl-trig { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .hl-trig__text { color:var(--ink-2); font-weight:600; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .hl-trig__ref { font:600 12px var(--mono); color:var(--muted); }
  .hl-chev { color:var(--muted); transition:transform .15s; }
  .hl-msg.is-open .hl-chev { transform:rotate(90deg); }
  .hl-detail { padding:4px 16px 18px; display:grid; gap:12px; }
  .hl-meta { display:flex; flex-wrap:wrap; gap:6px 18px; font-size:13px; color:var(--ink-2); }
  .hl-meta b { font-family:var(--mono); font-weight:600; color:var(--ink); }
  .hl-panes { display:grid; gap:12px; min-width:0; }
  .hl-panes > div, .hl-detail, .hl-msg { min-width:0; }
  .hl-detail { grid-template-columns:minmax(0,1fr); }
  @media (min-width:1024px) { .hl-panes { grid-template-columns:minmax(0,1.6fr) minmax(0,1fr); } }
  .hl-pane__label { font-size:12px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; display:flex; justify-content:space-between; gap:8px; }
  .hl-json { margin:0; max-height:420px; overflow:auto; background:var(--navy); color:#DCE3EC; border-radius:12px; padding:14px 16px; font:500 12.5px/1.55 var(--mono); white-space:pre; }
  .hl-json .k { color:#9CC3FF; } .hl-json .s { color:#A8E6B5; } .hl-json .n { color:#FFD08A; } .hl-json .b { color:#F5A3C7; }
  .hl-copy { border:0; background:transparent; color:var(--action); font-weight:700; font-size:12px; cursor:pointer; text-transform:none; letter-spacing:0; }
  @media (max-width:1023px) {
    .hl-sum { grid-template-columns:36px minmax(0,1fr) 22px; grid-template-areas:"no main chev"; gap:10px; padding:12px; }
    .hl-sum > .hl-no { grid-area:no; } .hl-sum > .hl-chev { grid-area:chev; }
    .hl-sum > .hl-time, .hl-sum > .hl-dirwrap, .hl-sum > .hl-type, .hl-sum > .hl-trig, .hl-sum > .hl-st { display:none; }
    .hl-sum > .hl-mobile { display:flex; grid-area:main; }
    .hl-detail { padding:4px 12px 16px; }
  }
  @media (min-width:1024px) { .hl-mobile { display:none !important; } }
  .hl-mobile { flex-direction:column; gap:4px; min-width:0; }
  .hl-mobile__top { display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  .hl-empty { padding:28px 16px; text-align:center; color:var(--muted); }
  .hl-no--go { cursor:pointer; } .hl-no--go:hover { box-shadow:0 0 0 3px var(--action-bg); }

  /* Peta pesan: two lanes, Hiryu left and WMS right, one arrow per message. */
  .pm-heads { display:flex; justify-content:space-between; }
  .pm-head { width:64px; display:flex; justify-content:center; }
  .pm-rows { position:relative; padding:4px 0 2px; }
  .pm-rows::before, .pm-rows::after { content:""; position:absolute; top:0; bottom:0; width:2px; border-radius:2px; background:var(--rule); }
  .pm-rows::before { left:31px; } .pm-rows::after { right:31px; }
  .pm-row { position:relative; margin:0 32px; padding:8px 0 12px; display:flex; flex-direction:column; gap:8px; }
  .pm-msg { margin:0 14px; display:grid; grid-template-columns:34px minmax(0,1fr) auto; gap:10px; align-items:center; min-height:56px; padding:8px 12px;
            border:1px solid var(--rule); border-radius:12px; background:var(--surface); color:var(--ink); text-align:left; cursor:pointer; font:inherit; }
  .pm-msg:hover { background:var(--ground); }
  .pm-msg.is-selected { border-color:var(--action); box-shadow:0 0 0 2px var(--action-bg); }
  .pm-msg:focus-visible, .pm-chipbtn:focus-visible { outline:3px solid rgba(31,78,140,.35); outline-offset:2px; }
  .pm-msg__text { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .pm-msg__name { font-weight:700; line-height:1.3; }
  .pm-msg__sub { font:600 12px var(--mono); color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pm-msg__tags { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; }
  .pm-arrow { position:relative; display:block; height:2px; }
  .pm-row--in .pm-arrow { background:var(--ok); color:var(--ok); }
  .pm-row--out .pm-arrow { background:var(--action); color:var(--action); }
  .pm-arrow::before { content:""; position:absolute; top:-4px; width:10px; height:10px; border-radius:50%; background:currentColor; }
  .pm-arrow::after { content:""; position:absolute; top:-5px; width:0; height:0; border-top:6px solid transparent; border-bottom:6px solid transparent; }
  .pm-row--in .pm-arrow::before { left:-5px; } .pm-row--out .pm-arrow::before { right:-5px; }
  .pm-row--in .pm-arrow::after { right:-1px; border-left:10px solid currentColor; }
  .pm-row--out .pm-arrow::after { left:-1px; border-right:10px solid currentColor; }
  @media (max-width:640px) {
    .pm-head { width:48px; }
    .pm-rows::before { left:23px; } .pm-rows::after { right:23px; }
    .pm-row { margin:0 24px; }
    .pm-msg { margin:0 8px; grid-template-columns:34px minmax(0,1fr); }
    .pm-msg__tags { grid-column:2; justify-content:flex-start; }
  }
  .pm-card { border-top:1px solid var(--rule); padding:16px 20px 20px; display:grid; grid-template-columns:minmax(0,1fr); gap:20px; min-width:0; }
  .pm-card:focus { outline:none; }
  .pm-card, #pm-map { scroll-margin-top:88px; }
  .pm-card__head { display:flex; align-items:flex-start; gap:12px; }
  .pm-card__name { font-size:20px; font-weight:800; line-height:1.25; }
  .pm-type { font-size:12px; font-weight:600; color:var(--muted); }
  .pm-sec { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; min-width:0; }
  .pm-sec__title { margin:0; font-size:12px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .pm-grid2 { display:grid; grid-template-columns:minmax(0,1fr); gap:20px; min-width:0; }
  @media (min-width:1024px) { .pm-grid2 { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
  .pm-list { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .pm-list li { display:grid; gap:4px; font-size:14px; line-height:1.45; color:var(--ink-2); }
  .pm-list__tags { display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
  .pm-call { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .pm-method { font:800 12px var(--mono); padding:4px 8px; border-radius:6px; background:var(--navy); color:var(--navy-ink); }
  .pm-path { font:700 13.5px var(--mono); color:var(--ink); overflow-wrap:anywhere; }
  .pm-p { margin:0; font-size:14px; line-height:1.5; color:var(--ink-2); }
  .pm-headers { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
  .pm-code-inline { font:600 12px var(--mono); background:var(--sunk); color:var(--ink-2); padding:2px 6px; border-radius:5px; overflow-wrap:anywhere; }
  .pm-pattern { display:inline-block; margin-top:4px; }
  .pm-table { min-width:900px; font-size:13px; }
  .pm-table th { white-space:nowrap; }
  .pm-table td { height:auto; padding:9px 10px; vertical-align:top; }
  .pm-fpath { font:600 12.5px var(--mono); min-width:170px; max-width:260px; overflow-wrap:anywhere; }
  .pm-fpath .pm-parent { color:var(--muted); font-weight:500; }
  .pm-fpath b { color:var(--ink); font-weight:700; }
  .pm-nowrap { white-space:nowrap; }
  .pm-req { min-width:90px; } .pm-allowed { min-width:170px; max-width:240px; overflow-wrap:anywhere; }
  .pm-ex { font-size:12px; min-width:110px; max-width:170px; overflow-wrap:anywhere; }
  .pm-mean { min-width:240px; line-height:1.45; color:var(--ink-2); }
  .pm-url { font:600 12.5px var(--mono); color:var(--ink-2); overflow-wrap:anywhere; }
  .pm-ans { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; align-items:start; padding:10px 0; border-top:1px solid var(--rule); font-size:14px; line-height:1.45; }
  .pm-ans:first-child { border-top:0; padding-top:0; }
  .pm-code { display:inline-block; min-width:44px; text-align:center; font:800 12px var(--mono); padding:4px 8px; border-radius:6px; white-space:nowrap; }
  .pm-code--ok { color:var(--ok); background:var(--ok-bg); }
  .pm-code--caution { color:var(--caution); background:var(--caution-bg); }
  .pm-code--stop { color:var(--stop); background:var(--stop-bg); }
  .pm-code--info { color:var(--action); background:var(--action-bg); }
  .pm-json--sm { max-height:220px; font-size:12px; padding:10px 12px; margin-top:4px; }
  .pm-bullets { margin:0; padding-left:20px; display:grid; gap:6px; font-size:14px; line-height:1.5; color:var(--ink-2); }
  .pm-rules { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; }
  @media (min-width:1024px) { .pm-rules { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
  .pm-rule { display:grid; gap:4px; padding:12px 14px; border-radius:12px; background:var(--sunk); font-size:14px; line-height:1.5; }
  .pm-rule__title { font-weight:800; color:var(--ink); }
  .pm-table--h { min-width:760px; }
  .pm-hmsgs { min-width:240px; }
  .pm-chipbtn { display:inline-flex; align-items:center; justify-content:center; min-width:44px; height:40px; padding:0 10px; margin:2px 4px 2px 0;
                border:0; border-radius:999px; background:var(--navy); color:var(--navy-ink); font:800 13px var(--mono); cursor:pointer; }
  .pm-later td { color:var(--muted); }
  `;
  function style() {
    if (document.getElementById('hl-css')) return;
    const s = document.createElement('style');
    s.id = 'hl-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function jsonHtml(v) {
    const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    return esc(text || '').replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (m, str, colon, lit, num) => {
      if (str) return '<span class="' + (colon ? 'k' : 's') + '">' + str + '</span>' + (colon || '');
      if (lit) return '<span class="b">' + lit + '</span>';
      return '<span class="n">' + num + '</span>';
    });
  }

  /* The names on board 11d. */
  const TYPE = {
    order: ['Pesanan untuk diambil', 'Order to pick'],
    cancel: ['Pesanan dibatalkan', 'Order cancelled'],
    stock_level: ['Level stok', 'Stock level'],
    order_ready: ['Pesanan siap', 'Order ready'],
    item_short: ['Barang kurang', 'Item short'],
    catalogue: ['Katalog', 'Catalogue'],
    catalogue_request: ['Minta katalog penuh', 'Catalogue request'],
  };
  const LANE_NO = { stock_level: '3', order_ready: '4', order_short: '5', catalogue_request: '6?' };
  const STATUS = {
    accepted: ['ok', 'Diterima', 'Accepted'], taken: ['ok', 'Diterima', 'Taken'], cancelled: ['ok', 'Dibatalkan', 'Cancelled'],
    sent: ['ok', 'Terkirim', 'Sent'], partial: ['caution', 'Sebagian', 'Partly taken'],
    duplicate: ['info', 'Duplikat', 'Duplicate'], already_cancelled: ['info', 'Sudah batal', 'Already cancelled'],
    repeat: ['info', 'Ulangan', 'Repeat'], pending: ['info', 'Disimpan', 'Kept'],
    retrying: ['caution', 'Dicoba lagi', 'Retrying'], refused: ['stop', 'Ditolak', 'Refused'], failed: ['stop', 'Gagal', 'Failed'],
  };
  const VIA = { demo: ['Demo', 'Demo'], standin: ['Stand-in', 'Stand-in'], test: ['Simulator', 'Simulator'] };

  const statusPill = (st) => { const s = STATUS[st] || ['info', st, st]; return S.pill(s[0], s[1], s[2]); };
  const dirHtml = (m) => m.direction === 'in'
    ? '<span class="hl-dir hl-dir--in">Hiryu ' + icon('arrow', 13, 2.6) + ' WMS</span>'
    : '<span class="hl-dir hl-dir--out">WMS ' + icon('arrow', 13, 2.6) + ' Hiryu</span>';
  /* The number opens the message's card in Peta pesan (wireLog). */
  const noHtml = (m) => {
    const k = mapKeyOf(m);
    const go = k ? ' data-mapgo="' + esc(k) + '"' : '';
    const tip = t(': buka di peta pesan', ': open in the message map');
    return m.message_no ? '<span class="hl-no' + (k ? ' hl-no--go' : '') + '"' + go + ' title="' + esc(t('Pesan ', 'Message ') + m.message_no + (k ? tip : '')) + '">' + m.message_no + '</span>'
      : '<span class="hl-no hl-no--q' + (k ? ' hl-no--go' : '') + '"' + go + ' title="' + esc('catalogue_request' + (k ? tip : '')) + '">6?</span>';
  };
  function gmOf(m) {
    const b = m.body || {};
    const d = b.data || {};
    return b.gm_number || d.gm_number || null;
  }
  function refOf(m) {
    const gm = gmOf(m);
    const b = m.body || {};
    const d = b.data || {};
    if (gm || m.grab_order_id) return [gm, m.grab_order_id].filter(Boolean).join(' · ');
    if (m.message_type === 'stock_level' && d.sku_code) return d.sku_code + ' = ' + d.available + (d.is_snapshot ? ' (snapshot)' : '');
    if (m.message_type === 'catalogue_request' && d.request_id) return d.request_id;
    if (m.message_type === 'catalogue' && b.message_id) return (b.full ? 'full · ' : '') + (b.request_id || '');
    return '';
  }
  const trig = (m) => m.trigger ? '<span ' + biAttr(m.trigger, m.trigger_en || m.trigger) + '>' + esc(t(m.trigger, m.trigger_en || m.trigger)) + '</span>' : '';
  const tags = (m) => (m.h_ref || '').split(/\s+/).filter(Boolean).map((h) => '<span class="hl-h">' + esc(h) + '</span>').join('') +
    (VIA[m.via] ? '<span class="hl-via">' + esc(t(VIA[m.via][0], VIA[m.via][1])) + '</span>' : '');
  const timeOf = (iso) => {
    const d = iso ? NJW.toDate(iso) : null;
    return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }) : '-';
  };

  /* ------------------------------------------------------------ state ---- */

  let ST = null;
  function fresh() {
    return { status: null, statusErr: null, msgs: new Map(), order: [], since: null, open: new Set(), seen: new Set(), paused: false,
      dir: 'all', hideStock: false, q: '', first: true, mapSel: null };
  }

  /* ------------------------------------------------------------ status ---- */

  function statusHtml() {
    const s = ST.status;
    if (ST.statusErr) {
      return '<div class="k-note k-note--info">' + icon('lock') + span(['Status antrean untuk SPV ke atas. Pesan Hiryu di bawah bisa dilihat semua peran.',
        'The queue status is for SPV and above. Hiryu messages below are open to every role.']) + '</div>';
    }
    if (!s) return '<div class="k-loading" ' + biAttr('Memeriksa sambungan…', 'Checking the link…') + '></div>';
    const lanes = s.lanes || [];
    const pending = lanes.reduce((n, l) => n + (l.pending || 0) + (l.sending || 0), 0);
    const failed = lanes.reduce((n, l) => n + (l.failed || 0), 0);
    const waitLimit = (s.wait_alert_minutes || 5) * 60;
    const late = (s.oldest_pending_seconds || 0) > waitLimit;
    const mode = s.demo_mode ? ['info', 'Mode demo: ke stand-in', 'Mode demo: to the stand-in']
      : s.sending ? ['ok', 'Terkirim ke Hiryu', 'Delivered to Hiryu'] : ['caution', 'Diantrekan, belum dikirim', 'Queued, not sent'];
    const kpi = (kind, label, num, foot) => '<div class="k-kpi' + (kind ? ' k-kpi--' + kind : '') + '">' + span(label, 'k-kpi__label') +
      '<span class="k-kpi__num">' + num + '</span><span class="k-kpi__foot">' + foot + '</span></div>';
    const check = (ok, label) => '<span class="hl-check ' + (ok ? 'hl-check--ok' : 'hl-check--no') + '">' + icon(ok ? 'check' : 'close', 15, 2.6) + esc(label) + '</span>';
    return '<div class="k-stack">' +
      '<div class="k-kpis">' +
      '<div class="k-kpi' + (s.live ? ' k-kpi--ok' : ' k-kpi--stop') + '">' + span(['Sambungan Hiryu', 'Hiryu link'], 'k-kpi__label') +
      '<div class="k-line" style="gap:10px"><span class="k-kpi__num hl-word">' + span(s.live ? ['Aktif', 'On'] : ['Mati', 'Off']) + '</span>' +
      '<button type="button" class="k-switch" data-live aria-checked="' + (s.live ? 'true' : 'false') + '" data-min-role="hq" ' +
      'data-aria-id="Sambungan Hiryu aktif" data-aria-en="Hiryu link on" aria-label="Sambungan Hiryu aktif"></button></div>' +
      '<span class="k-kpi__foot">' + span(s.live ? ['Tempel dan lembar stok mati.', 'Paste and the stock sheet are off.'] : ['Pesanan lewat tempel.', 'Orders by paste.']) + '</span></div>' +
      kpi(mode[0] === 'ok' ? 'ok' : mode[0] === 'caution' ? 'caution' : '', ['Pengiriman', 'Delivery'], '<span class="hl-word" style="font-size:17px !important">' + span([mode[1], mode[2]]) + '</span>',
        s.last_sent_at ? span(['Terakhir ' + S.fmt.dt(s.last_sent_at), 'Last ' + S.fmt.dt(s.last_sent_at)]) : span(['Belum ada yang terkirim', 'Nothing sent yet'])) +
      kpi(late ? 'caution' : '', ['Menunggu', 'Waiting'], esc(S.fmt.n(pending)),
        s.oldest_pending_seconds != null && pending ? span(['terlama ' + S.fmt.dur(s.oldest_pending_seconds), 'oldest ' + S.fmt.dur(s.oldest_pending_seconds)]) : span(['tidak ada antrean', 'no queue'])) +
      kpi(failed ? 'stop' : 'ok', ['Gagal', 'Failed'], esc(S.fmt.n(failed)), span(failed ? ['Periksa di bawah', 'Check below'] : ['Semua lancar', 'All good'])) +
      kpi(s.refused_24h ? 'caution' : '', ['Ditolak 24 jam', 'Refused 24 h'], esc(S.fmt.n(s.refused_24h || 0)), span(['dari Hiryu: SKU atau toko tak dikenal', 'from Hiryu: unknown SKU or store'])) +
      '</div>' +
      '<div class="hl-checks">' + check(s.push_enabled, 'POS_PUSH_ENABLED') + check(s.webhook_configured, 'POS_WEBHOOK_URL') +
      check(s.secret_configured, 'POS_SHARED_SECRET') + check(s.live, t('Sambungan aktif', 'Link on')) + '</div>' +
      '</div>';
  }

  function lanesHtml() {
    const s = ST.status;
    if (!s) return '';
    const lanes = (s.lanes || []).slice().sort((a, b) => (LANE_NO[a.message_type] || '9').localeCompare(LANE_NO[b.message_type] || '9'));
    const wait = (s.wait_alert_minutes || 5) * 60;
    const fails = s.failures || [];
    return '<div class="k-card">' +
      '<div class="k-card__head" style="padding:16px 20px 0"><div class="k-line k-line--between" style="flex-wrap:wrap;gap:10px">' +
      '<span class="k-h2" style="font-size:18px">' + span(['Antrean ke Hiryu', 'Queue to Hiryu']) + '</span>' +
      '<div class="k-line" style="gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-retry data-min-role="hq">' + icon('refresh', 16) + span(['Coba lagi yang gagal', 'Retry failed']) + '</button>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-snap data-min-role="hq">' + icon('upload', 16) + span(['Kirim snapshot stok penuh', 'Send full stock snapshot']) + '</button>' +
      '</div></div></div>' +
      '<div class="k-tablewrap" style="margin-top:12px"><table class="k-table"><thead><tr>' +
      '<th style="width:56px">#</th><th ' + biAttr('Jenis pesan', 'Message type') + '></th>' +
      '<th class="k-num" ' + biAttr('Menunggu', 'Waiting') + '></th><th class="k-num" ' + biAttr('Gagal', 'Failed') + '></th>' +
      '<th class="k-num k-laptop-only" ' + biAttr('Terkirim', 'Sent') + '></th><th class="k-num k-laptop-only" ' + biAttr('Tidak dikirim', 'Not sent') + '></th>' +
      '<th ' + biAttr('Terlama menunggu', 'Oldest wait') + '></th><th class="k-laptop-only" ' + biAttr('Terakhir terkirim', 'Last sent') + '></th>' +
      '</tr></thead><tbody>' + lanes.map((l) => {
        const waiting = (l.pending || 0) + (l.sending || 0);
        const late = (l.oldest_pending_seconds || 0) > wait;
        const name = TYPE[l.contract_type] || [l.contract_type, l.contract_type];
        return '<tr class="' + (l.failed ? 'is-stop' : late ? 'is-caution' : '') + '"><td><span class="hl-no' + (LANE_NO[l.message_type] === '6?' ? ' hl-no--q' : '') +
          '" style="width:30px;height:30px;font-size:14px">' + esc(LANE_NO[l.message_type] || '?') + '</span></td>' +
          '<td><div class="k-cell2"><span class="k-cell2__main">' + span(name) + '</span><span class="k-cell2__sub k-mono">' + esc(l.contract_type) + '</span></div></td>' +
          '<td class="k-num">' + esc(S.fmt.n(waiting)) + '</td><td class="k-num"' + (l.failed ? ' style="color:var(--stop);font-weight:800"' : '') + '>' + esc(S.fmt.n(l.failed || 0)) + '</td>' +
          '<td class="k-num k-laptop-only">' + esc(S.fmt.n(l.sent || 0)) + '</td><td class="k-num k-laptop-only">' + esc(S.fmt.n(l.suppressed || 0)) + '</td>' +
          '<td>' + (waiting && l.oldest_pending_seconds != null ? '<span' + (late ? ' style="color:var(--caution);font-weight:800"' : '') + '>' + esc(S.fmt.dur(l.oldest_pending_seconds)) + '</span>' : '<span class="k-muted">-</span>') + '</td>' +
          '<td class="k-laptop-only">' + (l.last_sent_at ? esc(S.fmt.dt(l.last_sent_at)) : '<span class="k-muted">-</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (fails.length ? '<div style="padding:12px 20px 18px" class="k-stack k-stack--tight">' + span(['Gagal (terbaru)', 'Failed (latest)'], 'k-eyebrow') +
        fails.slice(0, 8).map((f) => '<div class="k-note k-note--stop">' + icon('warn') + '<div class="k-stack k-stack--tight"><span class="k-strong">' +
          esc((TYPE[f.message_type] ? t(TYPE[f.message_type][0], TYPE[f.message_type][1]) : f.message_type)) + (f.order_ref ? ' · ' + esc(f.order_ref) : '') +
          ' · ' + esc(t('percobaan ', 'attempts ')) + f.attempts + '</span><span class="k-mono" style="font-size:12px">' + esc(f.last_error || '') + '</span></div></div>').join('') + '</div>'
        : '<div style="padding:4px 20px 16px" class="k-caption">' + span(['Pesan pesanan (4, 5) dikirim lebih dulu dari pesan stok (3). Dicoba lagi 10 dtk, 30 dtk, 1, 2, 5 menit, lalu tiap 10 menit.',
          'Order messages (4, 5) go ahead of stock (3). Retried after 10 s, 30 s, 1, 2, 5 min, then every 10 min.']) + '</div>') +
      '</div>';
  }

  /* ----------------------------------------------------------- the log ---- */

  function visible() {
    const q = ST.q.trim().toLowerCase();
    return ST.order.map((id) => ST.msgs.get(id)).filter((m) => {
      if (ST.dir !== 'all' && m.direction !== ST.dir) return false;
      if (ST.hideStock && m.message_type === 'stock_level') return false;
      if (q) {
        const hay = [m.message_id, m.grab_order_id, gmOf(m), m.trigger, m.trigger_en, m.message_type, refOf(m)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function msgHtml(m) {
    const name = TYPE[m.message_type] || [m.message_type, m.message_type];
    const open = ST.open.has(m.id);
    const isNew = !ST.first && !ST.seen.has(m.id);
    const ref = refOf(m);
    return '<div class="hl-msg' + (open ? ' is-open' : '') + (isNew ? ' is-new' : '') + '" data-msg="' + m.id + '">' +
      '<button type="button" class="hl-sum" aria-expanded="' + open + '">' +
      '<span class="hl-time">' + esc(timeOf(m.time)) + '</span>' +
      '<span class="hl-dirwrap">' + dirHtml(m) + '</span>' + noHtml(m) +
      '<span class="hl-type"><span class="hl-type__name">' + span(name) + '</span><span class="hl-type__tags">' + tags(m) + '</span></span>' +
      '<span class="hl-trig"><span class="hl-trig__text">' + trig(m) + '</span>' + (ref ? '<span class="hl-trig__ref">' + esc(ref) + '</span>' : '') + '</span>' +
      '<span class="hl-st">' + statusPill(m.status) + '</span>' +
      '<span class="hl-mobile"><span class="hl-mobile__top">' + dirHtml(m) + '<span class="hl-type__name">' + span(name) + '</span></span>' +
      '<span class="hl-mobile__top">' + statusPill(m.status) + '<span class="hl-time">' + esc(timeOf(m.time)) + '</span>' + tags(m) + '</span>' +
      '<span class="hl-trig__text">' + trig(m) + '</span>' + (ref ? '<span class="hl-trig__ref">' + esc(ref) + '</span>' : '') + '</span>' +
      '<span class="hl-chev">' + icon('chev', 20) + '</span></button>' +
      (open ? detailHtml(m) : '') + '</div>';
  }

  function detailHtml(m) {
    const via = { hiryu: 'Hiryu', demo: t('Demo (Buat pesanan dummy)', 'Demo (dummy order)'), test: 'Simulator', webhook: 'POS_WEBHOOK_URL',
      standin: t('Stand-in Hiryu (Mode demo)', 'Hiryu stand-in (Mode demo)') }[m.via] || m.via;
    const body = m.body_truncated
      ? '<div class="k-note">' + icon('info') + '<span>' + esc(t('Isinya besar. ', 'The body is large. ')) +
        '<button type="button" class="k-linkbtn" data-full="' + m.id + '">' + esc(t('Muat isi lengkap', 'Load the whole body')) + '</button></span></div>'
      : '<pre class="hl-json">' + jsonHtml(m.body) + '</pre>';
    return '<div class="hl-detail">' +
      '<div class="hl-meta"><span>message_id <b>' + esc(m.message_id) + '</b></span>' +
      '<span>' + esc(t('lewat', 'via')) + ' <b>' + esc(via) + '</b></span>' +
      (m.http_status != null ? '<span>HTTP <b>' + esc(String(m.http_status)) + '</b></span>' : '') +
      '<span>' + esc(t('percobaan', 'attempts')) + ' <b>' + esc(String(m.attempts)) + '</b></span>' +
      '<span>' + esc(t('waktu', 'time')) + ' <b>' + esc(S.fmt.dt(m.time)) + ':' + esc(timeOf(m.time).slice(-2)) + '</b></span>' +
      (mapKeyOf(m) ? '<button type="button" class="k-linkbtn" data-mapgo="' + esc(mapKeyOf(m)) + '">' + icon('book', 16) +
        span(['Definisi di peta pesan', 'Definition in the message map']) + '</button>' : '') + '</div>' +
      '<div class="hl-panes"><div><div class="hl-pane__label"><span>' + esc(t('Isi pesan (JSON persis)', 'Message body (exact JSON)')) + '</span>' +
      (m.body_truncated ? '' : '<button type="button" class="hl-copy" data-copy="body">' + esc(t('Salin', 'Copy')) + '</button>') + '</div>' + body + '</div>' +
      '<div><div class="hl-pane__label"><span>' + esc(t('Jawaban', 'Answer')) + '</span><button type="button" class="hl-copy" data-copy="answer">' + esc(t('Salin', 'Copy')) + '</button></div>' +
      '<pre class="hl-json">' + jsonHtml(m.answer == null ? null : m.answer) + '</pre></div></div></div>';
  }

  function logHtml() {
    const rows = visible();
    const n = ST.order.length;
    return '<div class="k-card" id="hl-log">' +
      '<div style="padding:16px 20px 12px" class="k-stack">' +
      '<div class="hl-livehead"><div class="k-stack k-stack--tight"><span class="k-h2" style="font-size:20px">' + span(['Pesan Hiryu', 'Hiryu messages']) + '</span>' +
      '<span class="k-caption">' + span(['Setiap pesan masuk dan keluar, dengan pemicunya, nomor H dari 11a dan JSON persisnya. Tanpa data pelanggan.',
        'Every message in and out, with its trigger, the H number from 11a and its exact JSON. No customer data.']) + '</span></div>' +
      '<div class="k-line" style="gap:10px"><span class="hl-live' + (ST.paused ? ' is-paused' : '') + '" data-livetag><span class="hl-live__dot"></span>' +
      span(ST.paused ? ['Dijeda', 'Paused'] : ['Langsung, tiap 3 detik', 'Live, every 3 s']) + '</span>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-pause>' + icon(ST.paused ? 'arrow' : 'clock', 16) +
      span(ST.paused ? ['Lanjutkan', 'Resume'] : ['Jeda', 'Pause']) + '</button></div></div>' +
      '<div class="hl-filters"><div class="k-segment" role="group">' +
      [['all', ['Semua', 'All']], ['in', ['Masuk', 'In']], ['out', ['Keluar', 'Out']]].map((x) =>
        '<button type="button" data-dir="' + x[0] + '" aria-pressed="' + (ST.dir === x[0]) + '">' + span(x[1]) + '</button>').join('') + '</div>' +
      '<label class="k-check" style="min-height:40px"><input type="checkbox" data-hidestock' + (ST.hideStock ? ' checked' : '') + '>' + span(['Sembunyikan level stok (3)', 'Hide stock levels (3)']) + '</label>' +
      '<div class="k-search" style="flex:1 1 220px;max-width:320px">' + icon('search', 18) + '' +
      '<input class="k-input" type="search" data-logq value="' + esc(ST.q) + '" data-ph-id="Cari GM, ID pesanan, SKU" data-ph-en="Search GM, order ID, SKU"></div></div>' +
      '<div class="hl-legend"><span>' + dirHtml({ direction: 'in' }) + ' ' + esc(t('pesan 1, 2, 6', 'messages 1, 2, 6')) + '</span>' +
      '<span>' + dirHtml({ direction: 'out' }) + ' ' + esc(t('pesan 3, 4, 5 dan minta katalog', 'messages 3, 4, 5 and catalogue request')) + '</span>' +
      '<span><span class="hl-via">Demo</span> <span class="hl-via">Stand-in</span> ' + esc(t('Mode demo', 'Mode demo')) + '</span></div></div>' +
      '<div class="hl-list" data-list>' + (rows.length ? rows.map(msgHtml).join('')
        : '<div class="hl-empty">' + (n ? span(['Tidak ada yang cocok dengan saringan.', 'Nothing matches the filter.'])
          : span(['Belum ada pesan. Pesan muncul di sini begitu Hiryu mengirim, atau saat Buat pesanan dummy di Mode demo.',
            'No messages yet. They appear here as soon as Hiryu sends, or when you make a dummy order in Mode demo.'])) + '</div>') +
      '</div></div>';
  }

  /* ------------------------------------------------------ message map ---- */

  /* Peta pesan. peta-pesan.json is fetched once, with the same ?v= as the
     page's scripts (as panduan.js does for panduan/sections.json). */
  let MAP = null, MAP_ERR = false;
  async function loadMap() {
    if (MAP) return;
    try {
      const v = ((document.querySelector('script[src*="shell.js"]') || {}).src || '').split('v=')[1] || '';
      const r = await fetch('peta-pesan.json' + (v ? '?v=' + v : ''), { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      MAP = await r.json();
      MAP_ERR = false;
    } catch (e) { MAP_ERR = true; }
  }

  /* Log message type to map key. The outbox calls message 5 order_short. */
  const MAP_KEY = { order: '1', cancel: '2', stock_level: '3', order_ready: '4', item_short: '5', order_short: '5',
    catalogue: '6', catalogue_request: 'catalogue_request' };
  function mapKeyOf(m) {
    return MAP_KEY[m.message_type] || (m.message_no ? String(m.message_no) : null);
  }
  const L = (o) => (o ? span([o.id, o.en]) : '');
  const mapMsg = (key) => (MAP ? MAP.messages.find((x) => x.key === key) : null);
  const mapBadge = (m) => (m.no ? '<span class="hl-no">' + m.no + '</span>' : '<span class="hl-no hl-no--q">6?</span>');
  const sideChip = (side) => (side === 'hiryu' ? '<span class="k-sys k-sys--hiryu">Hiryu</span>' : '<span class="k-sys k-sys--wms">WMS</span>');
  const hTags = (hs) => (hs || []).map((h) => '<span class="hl-h">' + esc(h) + '</span>').join('');
  const closeBtn = '<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-map="" data-aria-id="Tutup" data-aria-en="Close" aria-label="Tutup">' + icon('close', 18) + '</button>';

  function flowHtml() {
    return '<div class="pm-flow">' +
      '<div class="pm-heads"><span class="pm-head">' + sideChip('hiryu') + '</span><span class="pm-head">' + sideChip('wms') + '</span></div>' +
      '<div class="pm-rows">' + MAP.messages.map((m) => {
        const sel = ST.mapSel === m.key;
        const sub = m.direction === 'in' ? m.call.method + ' ' + m.call.path.replace('/api/hiryu/v1', '') : 'type: ' + m.log_type;
        return '<div class="pm-row pm-row--' + m.direction + '">' +
          '<button type="button" class="pm-msg' + (sel ? ' is-selected' : '') + '" data-map="' + esc(m.key) + '" aria-pressed="' + sel + '">' +
          mapBadge(m) + '<span class="pm-msg__text"><span class="pm-msg__name">' + L(m.name) + '</span>' +
          '<span class="pm-msg__sub">' + esc(sub) + '</span></span><span class="pm-msg__tags">' + hTags(m.h) + '</span>' +
          '<span class="k-sr">' + span(m.direction === 'in' ? ['Hiryu ke WMS', 'Hiryu to WMS'] : ['WMS ke Hiryu', 'WMS to Hiryu']) + '</span></button>' +
          '<span class="pm-arrow" aria-hidden="true"></span></div>';
      }).join('') + '</div></div>';
  }

  function reqHtml(m, f) {
    if (f.when) return L(f.when) + (m.direction === 'out' && f.nullable ? span(['; selain itu null', '; null otherwise']) : '');
    if (f.required) return f.nullable ? span(['Ya, boleh null', 'Yes, may be null']) : span(['Ya', 'Yes']);
    return f.nullable ? span(['Tidak, boleh null', 'No, may be null']) : span(['Tidak', 'No']);
  }
  function pathHtml(p) {
    if (p.indexOf('(path) ') === 0) {
      return '<b>' + esc(p.slice(7)) + '</b> <span class="k-tag">' + span(['di alamat', 'in the path']) + '</span>';
    }
    const cut = p.lastIndexOf('.');
    return cut < 0 ? '<b>' + esc(p) + '</b>' : '<span class="pm-parent">' + esc(p.slice(0, cut + 1)) + '</span><b>' + esc(p.slice(cut + 1)) + '</b>';
  }
  function fieldsHtml(m) {
    const th = (id, en) => '<th ' + biAttr(id, en) + '></th>';
    return '<div class="k-tablewrap"><table class="k-table pm-table"><thead><tr>' +
      '<th>Field</th>' + th('Tipe', 'Type') + th('Wajib', 'Required') + th('Nilai yang boleh', 'Allowed values') + th('Contoh', 'Example') + th('Arti', 'Meaning') +
      '</tr></thead><tbody>' + m.fields.map((f) =>
        '<tr><td class="pm-fpath">' + pathHtml(f.path) + '</td>' +
        '<td class="k-mono pm-nowrap">' + esc(f.type + (f.nullable ? ' | null' : '')) + '</td>' +
        '<td class="pm-req">' + reqHtml(m, f) + '</td>' +
        '<td class="pm-allowed">' + ((f.allowed || []).map(L).join('<br>') || (f.pattern ? '' : '<span class="k-muted">-</span>')) +
          (f.pattern ? '<br><code class="pm-code-inline pm-pattern">' + esc(f.pattern) + '</code>' : '') + '</td>' +
        '<td class="k-mono pm-ex">' + (f.example == null ? '<span class="k-muted">-</span>' : esc(f.example)) + '</td>' +
        '<td class="pm-mean">' + L(f.meaning) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  function answerHtml(a) {
    const s = String(a.status);
    const kind = s === 'replay' ? 'info' : /^2/.test(s) || s === '409' ? 'ok' : /^(408|5)|timeout/.test(s) ? 'caution' : 'stop';
    const label = s === 'replay' ? span(['Ulangan', 'Repeat']) : s === 'timeout' ? span(['Tanpa jawaban', 'No answer']) : esc(s);
    return '<div class="pm-ans"><span class="pm-code pm-code--' + kind + '">' + label + '</span>' +
      '<div class="k-stack k-stack--tight" style="min-width:0"><span>' + L(a.when) + '</span>' +
      (a.request ? '<span class="k-caption">' + span(['Dikirim dengan: ', 'Sent with: ']) + '<code class="pm-code-inline">' + esc(JSON.stringify(a.request)) + '</code></span>' : '') +
      (a.body != null ? '<pre class="hl-json pm-json--sm">' + jsonHtml(a.body) + '</pre>' : '') + '</div></div>';
  }
  const sec = (title, body) => '<section class="pm-sec"><h4 class="pm-sec__title">' + span(title) + '</h4>' + body + '</section>';
  const sideList = (items) => '<ul class="pm-list">' + items.map((x) =>
    '<li><span class="pm-list__tags">' + sideChip(x.side) + hTags(x.h) + '</span><span>' + L(x.text) + '</span></li>').join('') + '</ul>';

  function msgCardHtml(m) {
    const head = '<div class="pm-card__head">' + mapBadge(m) +
      '<div class="k-stack k-stack--tight k-grow" style="min-width:0"><span class="pm-card__name">' + L(m.name) + '</span>' +
      '<span class="k-line" style="gap:6px;flex-wrap:wrap">' + dirHtml({ direction: m.direction }) + hTags(m.h) +
      '<span class="k-mono pm-type">' + esc(m.log_type) + '</span></span></div>' + closeBtn + '</div>';
    const call = '<div class="pm-call"><span class="pm-method">' + esc(m.call.method) + '</span><span class="pm-path">' + esc(m.call.path) + '</span></div>' +
      '<p class="pm-p">' + L(m.call.who) + '. ' + L(m.call.note) + '</p>' +
      '<div class="pm-headers">' + m.headers.map((h) => '<code class="pm-code-inline">' + esc(h.name + ': ' + h.value) + '</code>').join('') + '</div>';
    const example = '<div class="hl-pane__label"><span>' + span(['Contoh lengkap, persis seperti dikirim', 'Full example, exactly as sent']) + '</span>' +
      '<button type="button" class="hl-copy" data-mapcopy="' + esc(m.key) + '">' + span(['Salin', 'Copy']) + '</button></div>' +
      (m.call.url ? '<div class="pm-url">' + esc(m.call.method + ' ' + m.call.url) + '</div>' : '') +
      '<pre class="hl-json">' + jsonHtml(m.example) + '</pre>';
    const answers = '<div>' + m.answers.map(answerHtml).join('') + '</div>';
    return head +
      '<div class="pm-grid2">' + sec(['Kapan dikirim', 'When it is sent'], sideList(m.triggers)) +
      sec(['Alamat dan kunci', 'Address and key'], call) + '</div>' +
      sec(['Field', 'Fields'], fieldsHtml(m)) +
      '<div class="pm-grid2">' + '<section class="pm-sec">' + example + '</section>' +
      sec(m.direction === 'in' ? ['Jawaban WMS', 'The WMS answers'] : ['Jawaban yang diharapkan dari Hiryu', 'What Hiryu should answer'], answers) + '</div>' +
      '<div class="pm-grid2">' + sec(['Setelah itu', 'What happens next'], sideList(m.next)) +
      ((m.rules || []).length ? sec(['Perlu diketahui', 'Good to know'], '<ul class="pm-bullets">' + m.rules.map((r) => '<li>' + L(r) + '</li>').join('') + '</ul>') : '') +
      '</div>';
  }

  function rulesCardHtml() {
    return '<div class="pm-card__head"><span class="pm-card__name k-grow">' + span(['Aturan umum, semua pesan', 'General rules, every message']) + '</span>' + closeBtn + '</div>' +
      '<div class="pm-rules">' + MAP.rules.map((r) => '<div class="pm-rule"><span class="pm-rule__title">' + L(r.title) + '</span><span class="pm-p">' + L(r.text) + '</span></div>').join('') + '</div>';
  }

  function hCardHtml() {
    const th = (id, en) => '<th ' + biAttr(id, en) + '></th>';
    return '<div class="pm-card__head"><span class="pm-card__name k-grow">' + span(['Daftar H dari papan 11a', 'The H list from board 11a']) + '</span>' + closeBtn + '</div>' +
      '<div class="k-tablewrap"><table class="k-table pm-table pm-table--h"><thead><tr><th>H</th>' + th('Arti', 'Meaning') + th('Pesan', 'Messages') + th('Panggilan Grab', 'Grab call') +
      '</tr></thead><tbody>' + MAP.h_list.map((h) =>
        '<tr' + (h.pilot ? '' : ' class="pm-later"') + '><td class="pm-nowrap"><span class="hl-h">' + esc(h.h) + '</span>' +
        (h.pilot ? '' : '<br><span class="k-tag" style="margin-top:6px">' + span(['setelah pilot', 'after the pilot']) + '</span>') + '</td>' +
        '<td class="pm-mean">' + L(h.text) + '</td>' +
        '<td class="pm-hmsgs">' + (h.messages.length ? h.messages.map((k) => '<button type="button" class="pm-chipbtn" data-map="' + esc(k) + '" title="' +
          esc(L(mapMsg(k) && mapMsg(k).name).replace(/<[^>]*>/g, '')) + '">' + esc(k === 'catalogue_request' ? '6?' : k) + '</button>').join('') : '<span class="k-muted">-</span>') + '</td>' +
        '<td class="k-mono" style="font-size:12px">' + (h.grab.length ? esc(h.grab.join(', ')) : '<span class="k-muted">-</span>') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function mapCardHtml() {
    if (!MAP || !ST.mapSel) return '';
    const m = mapMsg(ST.mapSel);
    const inner = ST.mapSel === 'rules' ? rulesCardHtml() : ST.mapSel === 'h' ? hCardHtml() : m ? msgCardHtml(m) : '';
    return inner ? '<div class="pm-card" id="pm-card" tabindex="-1">' + inner + '</div>' : '';
  }

  function mapHtml() {
    const sel = (k) => ' aria-pressed="' + (ST.mapSel === k) + '"';
    const head = '<div class="hl-livehead"><div class="k-stack k-stack--tight"><span class="k-h2" style="font-size:20px">' + span(['Peta pesan', 'Message map']) + '</span>' +
      '<span class="k-caption">' + span(['Semua pesan antara Hiryu dan WMS, field demi field, sesuai kode yang berjalan. Pilih satu untuk melihat pemicu, alamat, field, contoh JSON dan jawabannya.',
        'Every message between Hiryu and the WMS, field by field, as the running code has it. Pick one to see its triggers, address, fields, example JSON and answer.']) + '</span></div>' +
      (MAP ? '<div class="k-line" style="gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-map="rules"' + sel('rules') + '>' + icon('book', 16) + span(['Aturan umum', 'General rules']) + '</button>' +
        '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-map="h"' + sel('h') + '>' + icon('list', 16) + span(['Daftar H1 sampai H11', 'H1 to H11']) + '</button></div>' : '') +
      '</div>';
    const body = MAP ? flowHtml()
      : MAP_ERR ? '<div class="k-note k-note--caution">' + icon('warn') + span(['Peta pesan belum bisa dibuka. Muat ulang halaman.', 'The message map cannot be opened yet. Reload the page.']) + '</div>'
        : '<div class="k-loading" ' + biAttr('Memuat peta…', 'Loading the map…') + '></div>';
    return '<div class="k-card" id="pm-map"><div style="padding:16px 20px" class="k-stack">' + head + body + '</div>' + mapCardHtml() + '</div>';
  }

  function paintMap() {
    const wrap = BODY && BODY.querySelector('#pm-wrap');
    if (!wrap) return;
    wrap.innerHTML = mapHtml();
    S.applyLang(wrap);
  }

  /* Open one card (or close with null). `scroll` brings the card into view,
     used when the jump comes from the log or the H list. */
  function openMap(key, opts) {
    const o = opts || {};
    ST.mapSel = key ? (o.toggle && ST.mapSel === key ? null : key) : null;
    try {
      const u = new URL(location.href);
      if (ST.mapSel) u.searchParams.set('pesan', ST.mapSel); else u.searchParams.delete('pesan');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* the URL is a nicety */ }
    paintMap();
    const card = document.getElementById('pm-card');
    if (card && (o.scroll || card.getBoundingClientRect().top > window.innerHeight - 120)) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.focus({ preventScroll: true });
    } else if (!card && o.toggle) {
      const map = document.getElementById('pm-map');
      if (map && map.getBoundingClientRect().top < 0) map.scrollIntoView({ block: 'start' });
    }
  }

  function wireMap() {
    const wrap = BODY.querySelector('#pm-wrap');
    if (!wrap) return;
    wrap.addEventListener('click', async (ev) => {
      const copy = ev.target.closest('[data-mapcopy]');
      if (copy) {
        const m = mapMsg(copy.dataset.mapcopy);
        try { await navigator.clipboard.writeText(JSON.stringify(m.example, null, 2)); S.toast(['Disalin.', 'Copied.'], 'ok'); }
        catch (e) { S.toast(['Tidak bisa menyalin di peramban ini.', 'Cannot copy in this browser.'], 'caution'); }
        return;
      }
      const b = ev.target.closest('[data-map]');
      if (!b) return;
      const fromCard = !!b.closest('#pm-card');
      openMap(b.dataset.map || null, { toggle: !fromCard, scroll: fromCard && !!b.dataset.map });
    });
  }

  /* ------------------------------------------------------------ paint ---- */

  let BODY = null;
  function paintAll() {
    if (!BODY) return;
    BODY.innerHTML = '<div class="k-stack k-stack--loose">' +
      '<div id="hl-status">' + statusHtml() + '</div>' +
      '<div id="hl-lanes">' + lanesHtml() + '</div>' +
      '<div id="pm-wrap">' + mapHtml() + '</div>' +
      logHtml() + '</div>';
    wireStatus();
    wireMap();
    wireLog();
    S.applyLang(BODY);
    S.lockAll(BODY);
    ST.first = false;
    ST.order.forEach((id) => ST.seen.add(id));
  }
  function paintStatus() {
    const a = document.getElementById('hl-status'), b = document.getElementById('hl-lanes');
    if (!a || !b) return;
    a.innerHTML = statusHtml();
    b.innerHTML = lanesHtml();
    wireStatus();
    S.applyLang(a); S.applyLang(b);
    S.lockAll(a); S.lockAll(b);
  }
  function paintList() {
    const list = BODY && BODY.querySelector('[data-list]');
    if (!list) return;
    const rows = visible();
    list.innerHTML = rows.length ? rows.map(msgHtml).join('') : '<div class="hl-empty">' +
      span(ST.order.length ? ['Tidak ada yang cocok dengan saringan.', 'Nothing matches the filter.']
        : ['Belum ada pesan. Pesan muncul di sini begitu Hiryu mengirim, atau saat Buat pesanan dummy di Mode demo.',
          'No messages yet. They appear here as soon as Hiryu sends, or when you make a dummy order in Mode demo.']) + '</div>';
    S.applyLang(list);
    ST.order.forEach((id) => ST.seen.add(id));
  }

  /* New and changed messages only, so an open JSON body keeps its scroll. */
  function applyChanges(ids) {
    const list = BODY && BODY.querySelector('[data-list]');
    if (!list) return;
    if (!list.querySelector('[data-msg]')) { paintList(); return; }
    const shown = new Set(visible().map((m) => m.id));
    ids.slice().sort((a, b) => a - b).forEach((id) => {
      const el = list.querySelector('[data-msg="' + id + '"]');
      if (!shown.has(id)) { if (el) el.remove(); return; }
      const html = msgHtml(ST.msgs.get(id));
      if (el) {
        if (ST.open.has(id)) {
          const sum = el.querySelector('.hl-sum');
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          sum.replaceWith(tmp.querySelector('.hl-sum'));
        } else el.outerHTML = html;
      } else {
        const after = Array.from(list.querySelectorAll('[data-msg]')).find((x) => +x.dataset.msg < id);
        if (after) after.insertAdjacentHTML('beforebegin', html); else list.insertAdjacentHTML('beforeend', html);
      }
      const fresh = list.querySelector('[data-msg="' + id + '"]');
      if (fresh) S.applyLang(fresh);
      ST.seen.add(id);
    });
    const all = list.querySelectorAll('[data-msg]');
    for (let i = 500; i < all.length; i++) all[i].remove();
  }

  function wireStatus() {
    const live = BODY.querySelector('[data-live]');
    if (live && !live.closest('.k-lockwrap')) S.toggle(live, async (on) => {
      const ok = await S.confirm({
        title: on ? ['Nyalakan sambungan Hiryu?', 'Switch the Hiryu link on?'] : ['Matikan sambungan Hiryu?', 'Switch the Hiryu link off?'],
        text: on ? ['Pesanan hanya datang dari Hiryu, tempel dan lembar stok mati, dan snapshot stok penuh diantrekan.',
          'Orders come only from Hiryu, paste and the stock sheet go off, and a full stock snapshot is queued.']
          : ['Pesanan kembali lewat tempel dan stok diketik. Tidak ada yang dikirim ke Hiryu.', 'Orders go back to paste and stock is typed. Nothing is sent to Hiryu.'],
        ok: on ? ['Ya, nyalakan', 'Yes, switch on'] : ['Ya, matikan', 'Yes, switch off'], danger: !on,
      });
      if (!ok) return false;
      const r = await api().post('/hiryu-link/live', { live: on });
      S.toast(r.message, 'ok');
      await loadStatus(); paintStatus();
    });
    const retry = BODY.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', async () => {
      try { const r = await api().post('/hiryu-link/retry-failed' + api().qs({ site_id: S.siteId() })); S.toast(r.message, 'ok'); }
      catch (e) { S.fail(e); }
      await loadStatus(); paintStatus();
    });
    const snap = BODY.querySelector('[data-snap]');
    if (snap) snap.addEventListener('click', async () => {
      const ok = await S.confirm({ title: ['Kirim snapshot stok penuh?', 'Send a full stock snapshot?'],
        text: ['Setiap SKU dari setiap toko dengan sambungan menyala di hub ini dikirim ulang ke Hiryu.',
          'Every SKU of every store with its link on at this hub is sent to Hiryu again.'] });
      if (!ok) return;
      try { const r = await api().post('/hiryu-link/snapshot' + api().qs({ site_id: S.siteId() })); S.toast(r.message, 'ok'); }
      catch (e) { S.fail(e); }
      await loadStatus(); paintStatus();
    });
  }

  function wireLog() {
    const log = BODY.querySelector('#hl-log');
    log.addEventListener('click', async (ev) => {
      const go = ev.target.closest('[data-mapgo]');
      if (go) { ev.preventDefault(); openMap(go.dataset.mapgo, { scroll: true }); return; }
      const seg = ev.target.closest('[data-dir]');
      if (seg) { ST.dir = seg.dataset.dir; log.querySelectorAll('[data-dir]').forEach((b) => b.setAttribute('aria-pressed', String(b === seg))); paintList(); return; }
      if (ev.target.closest('[data-pause]')) { ST.paused = !ST.paused; repaintLogHead(); return; }
      const full = ev.target.closest('[data-full]');
      if (full) {
        try {
          const m = await api().get('/hiryu-link/messages/' + full.dataset.full);
          ST.msgs.set(m.id, m); paintList();
        } catch (e) { S.fail(e); }
        return;
      }
      const copy = ev.target.closest('[data-copy]');
      if (copy) {
        const m = ST.msgs.get(+copy.closest('[data-msg]').dataset.msg);
        const v = copy.dataset.copy === 'body' ? m.body : m.answer;
        try { await navigator.clipboard.writeText(JSON.stringify(v, null, 2)); S.toast(['Disalin.', 'Copied.'], 'ok'); }
        catch (e) { S.toast(['Tidak bisa menyalin di peramban ini.', 'Cannot copy in this browser.'], 'caution'); }
        return;
      }
      const sum = ev.target.closest('.hl-sum');
      if (sum) {
        const id = +sum.closest('[data-msg]').dataset.msg;
        if (ST.open.has(id)) ST.open.delete(id); else ST.open.add(id);
        const el = sum.closest('[data-msg]');
        el.outerHTML = msgHtml(ST.msgs.get(id));
        S.applyLang(log.querySelector('[data-msg="' + id + '"]'));
      }
    });
    log.querySelector('[data-hidestock]').addEventListener('change', (ev) => { ST.hideStock = ev.target.checked; paintList(); });
    log.querySelector('[data-logq]').addEventListener('input', (ev) => { ST.q = ev.target.value; paintList(); });
  }
  function repaintLogHead() {
    const tag = BODY.querySelector('[data-livetag]');
    const btn = BODY.querySelector('[data-pause]');
    if (!tag || !btn) return;
    tag.classList.toggle('is-paused', ST.paused);
    tag.lastChild.outerHTML = span(ST.paused ? ['Dijeda', 'Paused'] : ['Langsung, tiap 3 detik', 'Live, every 3 s']);
    btn.innerHTML = icon(ST.paused ? 'arrow' : 'clock', 16) + span(ST.paused ? ['Lanjutkan', 'Resume'] : ['Jeda', 'Pause']);
  }

  /* ------------------------------------------------------------- load ---- */

  async function loadStatus() {
    try { ST.status = await api().get('/hiryu-link/status' + api().qs({ site_id: S.siteId() })); ST.statusErr = null; }
    catch (e) { if (e.status === 403) ST.statusErr = e; else S.fail(e); }
  }
  async function loadMessages() {
    const q = { site_id: S.siteId(), limit: ST.since ? 200 : 150 };
    if (ST.since) q.since = ST.since;
    let r;
    try { r = await api().get('/hiryu-link/messages' + api().qs(q)); }
    catch (e) { if (!ST.since) S.fail(e); return false; }
    const changed = [];
    (r.messages || []).forEach((m) => {
      const old = ST.msgs.get(m.id);
      if (!old || old.status !== m.status || old.attempts !== m.attempts || old.updated_at !== m.updated_at) changed.push(m.id);
      if (old && old.body && m.body_truncated) m = Object.assign({}, m, { body: old.body, body_truncated: false });
      ST.msgs.set(m.id, m);
      if (m.updated_at && (!ST.since || m.updated_at > ST.since)) ST.since = m.updated_at;
    });
    ST.order = Array.from(ST.msgs.keys()).sort((a, b) => b - a).slice(0, 500);
    return changed;
  }

  let HOOKED = false;
  S.tab('integrasi', async function (ctx) {
    style();
    BODY = ctx.body;
    ST = fresh();
    if (!HOOKED) {
      HOOKED = true;
      S.onSiteChange(() => { if (S.currentTab() === 'integrasi') S.rerender(); });
      document.addEventListener('njw:lang', () => { if (S.currentTab() === 'integrasi' && BODY && BODY.isConnected) paintAll(); });
    }
    if (!S.siteId() && !S.atLeast('hq')) {
      BODY.innerHTML = '<div class="k-card k-card--pad">' + span(['Pilih satu hub.', 'Choose one hub.']) + '</div>';
      return;
    }
    ST.mapSel = S.param('pesan') || null;
    BODY.innerHTML = '<div class="k-loading" ' + biAttr('Memuat…', 'Loading…') + '></div>';
    await Promise.all([loadStatus(), loadMessages(), loadMap()]);
    paintAll();
    if (ST.mapSel && document.getElementById('pm-card')) document.getElementById('pm-card').scrollIntoView({ block: 'start' });
    let busy = false;
    ctx.every(3000, async () => {
      if (ST.paused || busy || !BODY.isConnected) return;
      busy = true;
      try { const ids = await loadMessages(); if (ids && ids.length) applyChanges(ids); } finally { busy = false; }
    });
    ctx.every(15000, async () => { await loadStatus(); if (!document.querySelector('.k-scrim')) paintStatus(); });
  });
})();
