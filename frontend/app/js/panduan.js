/* panduan.js: the tutorial menu. A list of the 11 sections; each opens its
 * working instruction as numbered steps (panduan.html?s=6).
 *
 * Content: panduan/sections.json, built from the review canvas working
 * instructions (Indonesian for staff, English as the EN variant). Text may
 * hold <em> for the exact words on a screen; nothing else is rendered as HTML.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, icon, t, bis } = S;

  /* Only <em> survives; every other tag is dropped. The file is ours, this
     is a seatbelt. */
  const rich = (v) => String(v || '').replace(/<(?!\/?em>)[^>]*>/g, '');
  const L = (o) => rich(o ? t(o.id, o.en) : '');
  const plain = (o) => (o ? t(o.id, o.en) : '');

  const ROLE = (name) => {
    const s = String(name).toLowerCase();
    if (s.startsWith('staf')) return 'staff';
    if (s.startsWith('spv')) return 'spv';
    if (s.startsWith('ops hq')) return 'hq';
    return 'head';
  };
  const sysChip = (x) => {
    const n = typeof x === 'string' ? x : plain(x);
    const en = typeof x === 'string' ? x : x.en;
    const k = /hiryu/i.test(en) ? 'hiryu' : /wms/i.test(en) ? 'wms' : /grab/i.test(en) ? 'grab' : 'email';
    return '<span class="k-sys k-sys--' + k + '">' + esc(n) + '</span>';
  };

  let DATA = null;
  async function data() {
    if (DATA) return DATA;
    const v = ((document.querySelector('script[src*="shell.js"]') || {}).src || '').split('v=')[1] || '';
    const r = await fetch('panduan/sections.json' + (v ? '?v=' + v : ''), { cache: 'no-cache' });
    if (!r.ok) throw new Error(t('Panduan belum bisa dibuka.', 'The guide cannot be opened yet.'));
    DATA = await r.json();
    return DATA;
  }

  function listHtml(secs) {
    return '<div class="k-grid3">' + secs.map((s) =>
      '<a class="k-card k-card--pad k-stack k-stack--tight" style="text-decoration:none;color:inherit" href="panduan.html?s=' + s.n + '">' +
        '<span class="k-line" style="gap:8px"><span style="font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--brand)">' +
          esc(t('BAGIAN ', 'SECTION ') + s.n) + '</span><span class="k-grow"></span><span class="k-muted" style="font-size:13px;font-weight:700">' +
          esc(s.steps.length + t(' langkah', ' steps')) + '</span></span>' +
        '<span style="font-size:19px;font-weight:800;line-height:1.25">' + L(s.title) + '</span>' +
        '<span class="k-p" style="font-size:15px">' + L(s.intro) + '</span>' +
        '<span class="k-line" style="gap:6px;margin-top:4px">' + (s.who || []).map((w) => '<span class="k-chip k-chip--' + ROLE(w.en) + '">' + esc(plain(w)) + '</span>').join('') + '</span>' +
      '</a>').join('') + '</div>';
  }

  function stepHtml(st) {
    return '<div class="k-card k-card--flat" style="display:flex;gap:14px;padding:16px">' +
      '<span style="width:36px;height:36px;flex-shrink:0;border-radius:999px;background:var(--navy);color:#fff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center">' + st.n + '</span>' +
      '<div class="k-grow k-stack" style="gap:6px">' +
        '<span class="k-line" style="gap:6px">' +
          (st.roles || []).map((r) => '<span class="k-chip k-chip--' + ROLE(r.en) + '">' + esc(plain(r)) + '</span>').join('') +
          (st.systems || []).map(sysChip).join('') +
          (st.tags || []).map((x) => '<span class="k-tag" style="background:var(--sunk);color:var(--ink-2)">' + esc(plain(x)) + '</span>').join('') +
          (st.screens && st.screens.length ? '<span class="k-grow"></span><span class="k-tag">' + esc(t('Layar ', 'Screen ') + st.screens.join(', ')) + '</span>' : '') +
        '</span>' +
        '<span style="font-size:17px;font-weight:700;line-height:1.35">' + L(st.action) + '</span>' +
        (st.detail && (st.detail.id || st.detail.en) ? '<span style="font-size:15px;line-height:1.5;color:var(--ink-2)">' + L(st.detail) + '</span>' : '') +
        (st.result && (st.result.id || st.result.en) ? '<span style="display:flex;gap:6px;align-items:flex-start;font-size:15px;font-weight:600;line-height:1.45">' +
          '<span style="color:var(--ok);margin-top:2px">' + icon('check', 18, 2.6) + '</span><span>' + L(st.result) + '</span></span>' : '') +
      '</div></div>';
  }

  function sectionHtml(s, all) {
    let phase = null;
    const steps = s.steps.map((st) => {
      let h = '';
      if (st.phase && plain(st.phase) !== phase) {
        phase = plain(st.phase);
        h += '<div class="k-line" style="gap:10px;margin-top:8px"><span class="k-eyebrow" style="color:var(--navy)">' + esc(phase) + '</span><span class="k-grow" style="height:1px;background:var(--rule)"></span></div>';
      }
      return h + stepHtml(st);
    }).join('');
    const prev = all.find((x) => x.n === s.n - 1), next = all.find((x) => x.n === s.n + 1);
    return '<div class="k-stack k-stack--loose" style="max-width:860px">' +
      '<a class="k-btn k-btn--ghost k-btn--sm" style="align-self:flex-start;padding-left:0" href="panduan.html">' + icon('back', 18, 2.4) + bis('Semua panduan', 'All guides') + '</a>' +
      '<div class="k-stack" style="gap:8px">' +
        '<span style="font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--brand)">' + esc(t('BAGIAN ', 'SECTION ') + s.n) + '</span>' +
        '<h2 style="margin:0;font-size:26px;font-weight:800;line-height:1.2">' + L(s.title) + '</h2>' +
        '<p class="k-p" style="font-size:16px;line-height:1.5">' + L(s.intro) + '</p>' +
      '</div>' +
      '<div class="k-card k-card--pad" style="display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px 12px;align-items:center">' +
        '<span class="k-eyebrow">' + esc(t('Siapa', 'Who')) + '</span><span class="k-line" style="gap:6px">' +
          (s.who || []).map((w) => '<span class="k-chip k-chip--' + ROLE(w.en) + '">' + esc(plain(w)) + '</span>').join('') + '</span>' +
        (s.when ? '<span class="k-eyebrow">' + esc(t('Kapan', 'When')) + '</span><span style="font-size:15px;font-weight:600;color:var(--ink-2)">' + L(s.when) + '</span>' : '') +
        ((s.where || []).length ? '<span class="k-eyebrow">' + esc(t('Di mana', 'Where')) + '</span><span class="k-line" style="gap:6px">' + s.where.map(sysChip).join('') + '</span>' : '') +
      '</div>' +
      (s.page ? '<a class="k-btn k-btn--secondary" style="align-self:flex-start" href="' + esc(s.page) + '">' + icon('arrow', 20, 2.2) + '<span>' + esc(t('Buka layarnya', 'Open the screen')) + '</span></a>' : '') +
      '<div class="k-stack">' + steps + '</div>' +
      ((s.rules || []).length ? '<div class="k-card k-card--flat" style="background:var(--sunk);border:0;padding:16px"><span style="font-size:15px;font-weight:800">' + esc(t('Aturan', 'Rules')) + '</span>' +
        '<ul style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:15px;line-height:1.5;color:var(--ink-2)">' +
        s.rules.map((r) => '<li>' + L(r) + '</li>').join('') + '</ul></div>' : '') +
      '<div class="k-line k-line--between">' +
        (prev ? '<a class="k-btn k-btn--outline" href="panduan.html?s=' + prev.n + '">' + icon('back', 18, 2.4) + '<span>' + esc(t('Bagian ', 'Section ') + prev.n) + '</span></a>' : '<span></span>') +
        (next ? '<a class="k-btn k-btn--outline" href="panduan.html?s=' + next.n + '"><span>' + esc(t('Bagian ', 'Section ') + next.n) + '</span>' + icon('chev', 18, 2.4) + '</a>' : '') +
      '</div></div>';
  }

  S.page(async function (ctx) {
    const d = await data();
    const n = parseInt(ctx.params.get('s'), 10);
    const sec = d.sections.find((s) => s.n === n);
    const paint = () => {
      if (sec) {
        S.setTitle(['Panduan ' + sec.n, 'Guide ' + sec.n]);
        S.setSub(null);
        ctx.body.innerHTML = sectionHtml(sec, d.sections);
      } else {
        S.setSub('Cara kerja setiap proses, langkah demi langkah. Pilih satu bagian.', 'How every process works, step by step. Pick a section.');
        ctx.body.innerHTML = listHtml(d.sections);
      }
      S.applyLang(ctx.body);
    };
    paint();
    document.addEventListener('njw:lang', paint);
  });
})();
