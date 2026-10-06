/* rak-bin.js: Rak & bin (canvas section 3, boards 3a to 3e).
 *
 * Tabs:
 *   rak     the racks of the hub; sub-views by URL:
 *             view=new | edit&rack=  Tambah rak, the builder (3a)
 *             view=detail&rack=      the rack, bin by bin
 *             view=labels&rack=      A4 label sheets (3b)
 *             view=cek&rack=         Cek label on the phone (3c)
 *   khusus  Bin khusus: temporary inbound bins, quarantine trays, baskets (3d)
 *   perlu   Perlu bin: give each SKU with a bin size a free bin (3e)
 *
 * API (backend/routers/racks.py):
 *   GET  /sites/{id}/rak                 overview, tab counts
 *   GET  /racks/{id}/layout              one rack, levels bottom first
 *   POST /sites/{id}/racks/build         Simpan rak (new)      PUT /racks/{id}/build (edit)
 *   DELETE /racks/{id}                   PATCH /locations/{id}/size
 *   GET  /racks/{id}/labels              POST /racks/{id}/labels/printed
 *   GET|POST /racks/{id}/label-check     POST /locations/{id}/reprint
 *   GET  /sites/{id}/special-bins        PUT .../special-bins/{kind}  POST .../{kind}/add
 *   GET  /sites/{id}/special-bins/labels POST /sites/{id}/special-bins/printed
 *   GET  /sites/{id}/needs-bin           GET .../needs-bin/{sku}/options  POST .../needs-bin/{sku}
 *
 * Every role may look; building racks, sizes, special-bin counts and Simpan di
 * are SPV (data-min-role). Labels may be printed and checked by anyone.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  /* ---------------- page styles (this page only) ---------------- */
  const CSS = `
.rb-two{display:grid;gap:16px;align-items:start;grid-template-columns:minmax(0,1fr)}
@media(min-width:1024px){.rb-two{grid-template-columns:600px minmax(0,1fr);gap:20px}.rb-two--list{grid-template-columns:380px minmax(0,1fr)}}
.rb-racks{display:grid;gap:12px}
@media(min-width:720px){.rb-racks{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}}
.rb-rack__code{font-family:var(--mono);font-size:28px;font-weight:700;line-height:1}
.rb-pills{display:flex;flex-wrap:wrap;gap:6px}
.rb-btns{display:flex;flex-wrap:wrap;gap:8px}
.rb-form3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.rb-form3 .k-input{font-family:var(--mono);font-weight:700;font-size:17px}
.rb-bgrid{display:grid;gap:6px 8px;align-items:center}
.rb-bgrid__head{font-size:12px;font-weight:700;color:var(--muted)}
.rb-bgrid__lv{font-size:13px;font-weight:700}
.rb-cell{display:flex;flex-wrap:wrap;align-items:center;gap:4px;border:1px solid var(--rule);border-radius:10px;padding:5px;min-height:40px;cursor:pointer;background:#fff}
.rb-cell.is-sel{border:2px solid var(--action);background:#F5F8FC;padding:4px}
.rb-chip{display:inline-flex;align-items:center;gap:2px;height:30px;box-sizing:border-box;padding:0 1px 0 8px;border-radius:8px;border:1px solid #9AA6B8;background:#fff;font-size:12px;font-weight:700}
.rb-chip--besar{background:#CFDDF0;font-weight:800}
.rb-chip button{border:0;padding:0;background:transparent;font:inherit;color:var(--ink);cursor:pointer;min-height:28px}
.rb-chip .rb-x{width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:var(--muted);border-radius:6px}
.rb-add{width:30px;height:30px;padding:0;border:1px dashed var(--action);border-radius:8px;background:#fff;color:var(--action);display:flex;align-items:center;justify-content:center;cursor:pointer}
.rb-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;font-weight:700;color:var(--ink-2)}
.rb-legend i{display:inline-block;height:14px;border-radius:4px;border:1px solid #9AA6B8;vertical-align:-2px;margin-right:6px}
.rb-front{display:flex;flex-direction:column;gap:4px}
.rb-frow{display:grid;grid-template-columns:60px minmax(0,1fr);gap:8px}
.rb-frow__lv{display:flex;flex-direction:column;justify-content:center;font-size:13px;font-weight:700}
.rb-frow__lv small{font-size:11px;font-weight:600;color:var(--muted)}
.rb-frow__lv small.rb-mono{font-family:var(--mono)}
.rb-frame{display:flex;gap:4px;min-height:46px;box-sizing:border-box;padding:5px;border:4px solid #5F6672;border-left-width:6px;border-right-width:6px}
.rb-frame+.rb-frame{border-top-width:0}
.rb-kol{flex:1 1 0;min-width:0;display:flex;gap:4px}
.rb-upright{width:4px;margin:-5px 2px;background:#5F6672;flex:none}
.rb-bin{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:5px;border:1px solid #9AA6B8;background:#fff;font-family:var(--mono);font-size:12px;font-weight:700;padding:2px;text-align:center;overflow:hidden}
.rb-bin--besar{flex-grow:2;background:#CFDDF0}
.rb-bin small{font-family:var(--font);font-size:10px;font-weight:700;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.rb-bin.is-used{background:var(--sunk);border-color:var(--rule);color:var(--muted)}
.rb-bin.is-match{background:#CFDDF0;border:2px solid var(--action);cursor:pointer}
.rb-bin.is-best{background:var(--action);border:2px solid var(--action);color:#fff;cursor:pointer}
.rb-bin.is-best small{color:#fff}
.rb-bin.is-other{border-style:dashed;color:var(--muted)}
.rb-bin.is-pick{outline:3px solid #F2C46D;outline-offset:1px}
.rb-bin.is-click{cursor:pointer}
.rb-big .rb-frame{min-height:64px}
.rb-big .rb-bin{font-size:13px}
.rb-codes{display:flex;flex-wrap:wrap;gap:6px}
.rb-codes span{font-family:var(--mono);font-size:13px;font-weight:700;padding:4px 8px;border-radius:8px;background:var(--sunk)}
.rb-count{font-family:var(--mono);font-size:40px;font-weight:700;line-height:1}
.rb-skus{display:flex;flex-direction:column}
.rb-sku{display:flex;align-items:center;gap:10px;padding:12px 14px;border:0;border-top:1px solid var(--rule);background:#fff;text-align:left;font:inherit;cursor:pointer;min-height:56px}
.rb-sku:first-child{border-top:0}
.rb-sku.is-sel{background:var(--action-bg);box-shadow:inset 4px 0 0 var(--action)}
.rb-sku__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.rb-sku__name{font-weight:700}
.rb-sku__sub{font-size:13px;color:var(--muted)}
.rb-size{display:inline-flex;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;border:1px solid #9AA6B8;background:#fff}
.rb-size--besar{background:#CFDDF0}
.rb-sheets{display:flex;flex-direction:column;gap:20px;overflow-x:auto;padding-bottom:8px}
.rb-sheet{width:794px;min-height:1123px;box-sizing:border-box;padding:28px 38px;background:#fff;color:#000;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow);flex:none}
.rb-sheet__head{display:flex;align-items:flex-end;gap:16px;padding-bottom:10px;border-bottom:2px solid #000}
.rb-sheet__title{font-size:22px;font-weight:800}
.rb-sheet__note{font-size:12px;font-weight:600}
.rb-sheet__eyebrow{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.rb-sheet__foot{margin-top:auto;display:flex;justify-content:space-between;gap:12px;font-size:11px;font-weight:700;border-top:1px solid #000;padding-top:8px}
.rb-racklab{width:378px;height:150px;box-sizing:border-box;border:1px dashed #9AA6B8;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;flex:none}
.rb-racklab__code{font-family:var(--mono);font-size:48px;font-weight:700;line-height:1}
.rb-contents{flex-grow:1;box-sizing:border-box;border:2px solid #000;padding:12px 14px;display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;line-height:1.45}
.rb-strip{height:32px;box-sizing:border-box;border:1px dashed #9AA6B8;padding:0 12px;display:flex;align-items:center;gap:14px}
.rb-strip b{font-family:var(--mono);font-size:18px}
.rb-strip span{font-size:13px;font-weight:600}
.rb-strip em{margin-left:auto;font-style:normal;font-size:12px;font-weight:700}
.rb-labs{display:grid;grid-template-columns:repeat(3,227px);gap:8px 18px}
.rb-lab{width:227px;height:113px;box-sizing:border-box;border:1px dashed #9AA6B8;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;background:#fff;color:#000}
.rb-lab__top{display:flex;align-items:baseline;justify-content:space-between;gap:6px}
.rb-lab__code{font-family:var(--mono);font-size:28px;font-weight:700;line-height:1}
.rb-lab__code--sm{font-size:22px}
.rb-lab__kol{font-size:11px;font-weight:800}
.rb-lab__line{font-size:11px;font-weight:700}
.rb-lab svg{width:100%;height:38px;display:block}
.rb-check__num{font-family:var(--mono);font-size:30px;font-weight:700}
#rb-printzone{display:none}
@media print{
  @page{size:A4;margin:0}
  body.rb-printing>*:not(#rb-printzone){display:none!important}
  body.rb-printing #rb-printzone{display:block!important}
  #rb-printzone .rb-sheet{box-shadow:none;page-break-after:always;break-after:page;width:210mm;min-height:297mm;height:297mm}
  #rb-printzone .rb-sheets{overflow:visible;gap:0}
}`;
  if (!document.getElementById('rb-css')) {
    const st = document.createElement('style');
    st.id = 'rb-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------------- small helpers ---------------- */
  const SIZE = { KECIL: ['Kecil', 'Small'], BESAR: ['Besar', 'Large'] };
  const sizeWord = (s) => SIZE[s] || [s || '-', s || '-'];
  const sizeChip = (s) => '<span class="rb-size' + (s === 'BESAR' ? ' rb-size--besar' : '') + '" ' + biAttr(sizeWord(s)[0], sizeWord(s)[1]) + '></span>';
  const pad2 = (n) => String(n).padStart(2, '0');
  const siteId = () => S.siteId();

  function nav(q, push) {
    const u = new URL(location.href);
    ['view', 'rack', 'sku'].forEach((k) => u.searchParams.delete(k));
    Object.entries(q || {}).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
    history[push === false ? 'replaceState' : 'pushState'](null, '', u.pathname + u.search);
    S.rerender();
  }
  window.addEventListener('popstate', () => S.rerender());
  const back = (label) => '<a class="k-linkbtn" href="#" data-back>' + icon('back', 18) + bis(label ? label[0] : 'Semua rak', label ? label[1] : 'All racks') + '</a>';
  function wireBack(root, to) {
    root.querySelectorAll('[data-back]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); nav(to || {}); }));
  }
  function paintAll(root) { S.applyLang(root); S.lockAll(root); }

  /* ---------------- Code 128 (set B) barcode as SVG ---------------- */
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 ' +
    '131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
    '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
    '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
    '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
  function barcodeSvg(text) {
    const vals = [104];
    for (const ch of String(text)) {
      const c = ch.charCodeAt(0);
      vals.push(c >= 32 && c <= 126 ? c - 32 : 0);
    }
    let sum = 104;
    for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
    vals.push(sum % 103);
    vals.push(106);
    let x = 10, rects = '';
    vals.forEach((v) => {
      const p = C128[v];
      for (let i = 0; i < p.length; i++) {
        const w = +p[i];
        if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="40"/>';
        x += w;
      }
    });
    const W = x + 10;
    return '<svg viewBox="0 0 ' + W + ' 40" preserveAspectRatio="none" role="img" aria-label="' + esc(text) + '" fill="#000">' + rects + '</svg>';
  }

  /* ---------------- printing ---------------- */
  function printHtml(html, after) {
    let zone = document.getElementById('rb-printzone');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'rb-printzone';
      document.body.appendChild(zone);
    }
    zone.innerHTML = html;
    document.body.classList.add('rb-printing');
    const done = () => {
      document.body.classList.remove('rb-printing');
      zone.innerHTML = '';
      window.removeEventListener('afterprint', done);
      if (after) after();
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('rb-printing')) done(); }, 500); }, 50);
  }

  function binLabelHtml(l) {
    return '<div class="rb-lab"><span class="rb-lab__top"><span class="rb-lab__code">' + esc(l.code) + '</span>' +
      '<span class="rb-lab__kol">' + esc(l.kolom_text || '') + '</span></span>' + barcodeSvg(l.barcode || l.code) +
      '<span class="rb-lab__line">' + esc(l.line || '') + '</span></div>';
  }
  function specialLabelHtml(l) {
    return '<div class="rb-lab"><span class="rb-lab__top"><span class="rb-lab__code rb-lab__code--sm">' + esc(l.code) + '</span></span>' +
      barcodeSvg(l.barcode || l.code) + '<span class="rb-lab__line">' + esc(l.line || l.title || '') + '</span></div>';
  }
  function sheetFoot(d) {
    return '<div class="rb-sheet__foot"><span>' + esc(d.cut_note || '') + '</span><span>' + esc(d.footer || '') +
      (d.lost_note ? ' · ' + esc(d.lost_note) : '') + '</span></div>';
  }
  /* One loose label (Cetak ulang, Tambah bin sementara) on its own A4 sheet. */
  function singleSheet(label, d, special) {
    return '<div class="rb-sheets"><div class="rb-sheet"><div class="rb-sheet__head"><div class="k-stack k-stack--tight" style="flex-grow:1">' +
      '<span class="rb-sheet__title">' + esc(label.code) + '</span><span class="rb-sheet__note">' + esc(d.cut_note || '') + '</span></div></div>' +
      '<div class="rb-labs">' + (special ? specialLabelHtml(label) : binLabelHtml(label)) + '</div>' + sheetFoot(d) + '</div></div>';
  }
  function rackSheets(d) {
    const n = d.pages.length;
    return '<div class="rb-sheets">' + d.pages.map((p) => {
      let h = '<div class="rb-sheet"><div class="rb-sheet__head"><div class="k-stack k-stack--tight" style="flex-grow:1">' +
        '<span class="rb-sheet__title">' + esc(d.subtitle) + '</span><span class="rb-sheet__note">' + esc(d.top_note) + '</span></div>' +
        '<span class="rb-sheet__note" style="font-weight:700;white-space:nowrap">Halaman ' + p.page_no + ' dari ' + n + '</span></div>';
      if (p.rack_label) {
        h += '<div style="display:flex;gap:18px;align-items:stretch"><div class="rb-racklab"><span style="display:flex;align-items:baseline;justify-content:space-between">' +
          '<span class="rb-racklab__code">' + esc(d.rack_label.title) + '</span><span style="font-size:14px;font-weight:800">' + esc(d.rack_label.hub) + '</span></span>' +
          '<div style="height:44px">' + barcodeSvg(d.rack_label.title.replace(/\s+/g, '-') + '-' + d.rack_label.hub).replace('<svg', '<svg style="height:44px;width:100%"') + '</div>' +
          '<span style="font-size:12px;font-weight:700">' + esc(d.rack_label.note) + '</span></div>' +
          '<div class="rb-contents"><span style="font-size:13px;font-weight:800">Isi halaman ini</span>' +
          p.contents.map((c) => '<span>' + esc(c) + '</span>').join('') +
          (d.later_pages_text ? '<span>' + esc(d.later_pages_text) + '</span>' : '') +
          '<span style="margin-top:auto">' + esc(d.check_note) + '</span></div></div>';
      }
      if (p.level_strips) {
        h += '<span class="rb-sheet__eyebrow">Strip level</span><div class="k-stack k-stack--tight">' + d.level_strips.map((s) =>
          '<div class="rb-strip"><b>' + esc(s.title) + '</b><span>' + esc(s.text) + '</span><em>' + esc(s.rack_text) + '</em></div>').join('') + '</div>';
      }
      if (p.bin_labels.length) {
        h += '<span class="rb-sheet__eyebrow">Label bin · ' + esc(p.levels_text) + '</span><div class="rb-labs">' + p.bin_labels.map(binLabelHtml).join('') + '</div>';
      }
      return h + sheetFoot(d) + '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- the rack drawing (preview, detail, Perlu bin) ---------------- */
  /* levels: bottom first, each {level_no, kolom:[[bin…]…]} where a bin has
     size and optional code/state. opts.binHtml(bin) makes the inside of a bin,
     opts.cls(bin) adds classes, opts.levelSub(level) the small lines under "Level n". */
  function drawRack(levels, opts) {
    opts = opts || {};
    const kol = Math.max(1, ...levels.map((l) => l.kolom.length));
    const rows = levels.slice().sort((a, b) => b.level_no - a.level_no);
    return '<div class="rb-front' + (opts.big ? ' rb-big' : '') + '">' +
      '<div class="rb-frow"><span></span><div style="display:grid;grid-template-columns:repeat(' + kol + ',1fr);gap:12px;padding:0 11px;font-size:12px;font-weight:700;color:var(--muted);text-align:center">' +
      Array.from({ length: kol }, (_, i) => '<span>' + esc(t('Kolom ', 'Kolom ')) + (i + 1) + '</span>').join('') + '</div></div>' +
      rows.map((lv, ri) => '<div class="rb-frow"><span class="rb-frow__lv"><span>' + esc(t('Level ', 'Level ')) + lv.level_no + '</span>' + (opts.levelSub ? opts.levelSub(lv) : '') + '</span>' +
        '<div class="rb-frame"' + (ri ? ' style="border-top-width:0"' : '') + '>' + lv.kolom.map((bins, ki) =>
          (ki ? '<span class="rb-upright"></span>' : '') + '<span class="rb-kol">' + bins.map((b) =>
            '<span class="rb-bin' + (b.size === 'BESAR' ? ' rb-bin--besar' : '') + (opts.cls ? ' ' + opts.cls(b) : '') + '"' +
            (b.location_id ? ' data-loc="' + b.location_id + '"' : '') + '>' + (opts.binHtml ? opts.binHtml(b) : esc(pad2(b.index))) + '</span>').join('') + '</span>').join('') +
        '</div></div>').join('') + '</div>';
  }
  const legend = () => '<div class="rb-legend"><span><i style="width:12px"></i>' + bis('Kecil: sempit', 'Kecil: narrow') + '</span>' +
    '<span><i style="width:24px;background:#CFDDF0"></i>' + bis('Besar: lebar, biru', 'Besar: wide, blue') + '</span></div>';

  /* ================= tab: Rak ================= */

  let OVERVIEW = null;
  async function loadOverview() {
    OVERVIEW = await api().get('/sites/' + siteId() + '/rak');
    S.tabCount('rak', OVERVIEW.totals.racks);
    S.tabCount('perlu', OVERVIEW.needs_bin || null, OVERVIEW.needs_bin ? 'caution' : null);
    return OVERVIEW;
  }

  S.tab('rak', async function (ctx) {
    const view = ctx.params.get('view');
    const rack = ctx.params.get('rack');
    if (view !== 'cek') S.fullScreen(false);
    S.setTitle('Rak & bin', 'Racks & bins');
    S.setSub('Daftarkan rak persis seperti yang berdiri di dark store.', 'Register each rack exactly as it stands in the dark store.');
    if (!siteId()) { ctx.body.innerHTML = '<div class="k-note k-note--info">' + bis('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>'; return; }
    if (view === 'new' || (view === 'edit' && rack)) return builder(ctx, view === 'edit' ? +rack : null);
    if (view === 'detail' && rack) return rackDetail(ctx, +rack);
    if (view === 'labels' && rack) return rackLabels(ctx, +rack);
    if (view === 'cek' && rack) return labelCheck(ctx, +rack);
    return rackList(ctx);
  });

  async function rackList(ctx) {
    const d = await loadOverview();
    ctx.actions.innerHTML = '<button type="button" class="k-btn k-btn--primary" data-new data-min-role="supervisor">' + icon('plus') + bis('Tambah rak', 'Add rack') + '</button>';
    ctx.actions.querySelector('[data-new]').addEventListener('click', () => nav({ view: 'new' }));
    const k = d.totals;
    let h = '<div class="k-kpis">' +
      kpi('Rak', 'Racks', k.racks) + kpi('Bin', 'Bins', k.bins) +
      kpi('Bin Kecil kosong', 'Free Kecil bins', k.free_kecil) + kpi('Bin Besar kosong', 'Free Besar bins', k.free_besar) +
      '<a class="k-kpi' + (d.needs_bin ? ' k-kpi--caution' : '') + '" href="?tab=perlu" style="text-decoration:none;color:inherit">' +
      bis('Perlu bin', 'Need a bin', 'k-kpi__label') + '<span class="k-kpi__num">' + S.fmt.n(d.needs_bin) + '</span>' + bis('SKU tanpa bin', 'SKUs without a bin', 'k-kpi__foot') + '</a></div>';
    if (!d.racks.length) {
      h += '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('rack', 28) + '</span>' +
        bis('Belum ada rak', 'No racks yet', 'k-empty__title') +
        bis('Tambah rak persis seperti yang berdiri di dark store. Rak bisa ditambah kapan saja.', 'Add each rack exactly as it stands. Racks can be added any time.', 'k-empty__text') +
        '<button type="button" class="k-btn k-btn--primary" data-new2 data-min-role="supervisor">' + icon('plus') + bis('Tambah rak', 'Add rack') + '</button></div>';
    } else {
      h += '<div class="rb-racks">' + d.racks.map(rackCard).join('') + '</div>';
    }
    h += '<p class="k-caption">' + bis('Kode bin = rak, level, bin. Level 1 paling bawah. Bin dihitung per level dari kiri ke kanan, menyeberang kolom.',
      'Bin code = rack, level, bin. Level 1 is the bottom shelf. Bins are numbered per level from left to right, across the kolom.') + '</p>';
    ctx.body.innerHTML = h;
    const n2 = ctx.body.querySelector('[data-new2]');
    if (n2) n2.addEventListener('click', () => nav({ view: 'new' }));
    ctx.body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => nav({ view: b.dataset.go, rack: b.dataset.rack })));
  }
  const kpi = (id, en, n, kind) => '<div class="k-kpi' + (kind ? ' k-kpi--' + kind : '') + '">' + bis(id, en, 'k-kpi__label') + '<span class="k-kpi__num">' + S.fmt.n(n) + '</span></div>';

  function rackCard(r) {
    const pills = [];
    pills.push(r.labels_printed_at ? S.pill('ok', 'Label dicetak ' + S.fmt.date(r.labels_printed_at), 'Labels printed ' + S.fmt.date(r.labels_printed_at))
      : S.pill('caution', 'Label belum dicetak', 'Labels not printed'));
    if (r.labels_checked) pills.push(S.pill('ok', 'Label cocok ' + r.label_ok + ' dari ' + r.bins, 'Labels match ' + r.label_ok + ' of ' + r.bins));
    else if (r.label_ok || r.label_wrong) pills.push(S.pill('info', 'Cek label ' + (r.label_ok + r.label_wrong) + ' dari ' + r.bins, 'Checked ' + (r.label_ok + r.label_wrong) + ' of ' + r.bins));
    else pills.push(S.pill('', 'Label belum dicek', 'Labels not checked'));
    if (r.label_wrong) pills.push(S.pill('stop', r.label_wrong + ' label salah', r.label_wrong + ' wrong'));
    return '<div class="k-card k-card--pad k-stack">' +
      '<div class="k-line k-line--between"><span class="rb-rack__code">' + esc(t('Rak ', 'Rack ')) + esc(r.code) + '</span>' +
      '<span class="k-muted">' + r.levels + ' level · ' + r.kolom_count + ' kolom · ' + r.bins + ' bin</span></div>' +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap">' + sizeChip('KECIL') + '<span class="k-strong">' + r.kecil + '</span>' + sizeChip('BESAR') + '<span class="k-strong">' + r.besar + '</span>' +
      '<span class="k-muted">· ' + esc(t('kosong', 'free')) + ' ' + r.free_kecil + ' Kecil, ' + r.free_besar + ' Besar</span></div>' +
      '<div class="rb-pills">' + pills.join('') + '</div>' +
      '<div class="rb-btns"><button type="button" class="k-btn k-btn--sm k-btn--secondary" data-go="detail" data-rack="' + r.rack_id + '">' + icon('eye', 18) + bis('Lihat', 'View') + '</button>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-go="labels" data-rack="' + r.rack_id + '">' + icon('print', 18) + bis('Cetak label', 'Print labels') + '</button>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-go="cek" data-rack="' + r.rack_id + '">' + icon('scan', 18) + bis('Cek label', 'Check labels') + '</button>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--ghost" data-go="edit" data-rack="' + r.rack_id + '" data-min-role="supervisor">' + icon('edit', 18) + bis('Ubah', 'Edit') + '</button></div></div>';
  }

  /* ---------------- 3a: the builder ---------------- */
  function nextRackCode() {
    const used = new Set((OVERVIEW ? OVERVIEW.racks : []).map((r) => r.code));
    for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!used.has(c)) return c; }
    return '';
  }

  async function builder(ctx, rackId) {
    if (!OVERVIEW) await loadOverview().catch(() => null);
    const st = { code: nextRackCode(), kolom: 2, grid: [], sel: null, inUse: false };
    const mk = (n) => Array.from({ length: n }, () => 'KECIL');
    if (rackId) {
      const d = await api().get('/racks/' + rackId + '/layout');
      st.code = d.rack.code;
      st.kolom = d.rack.kolom_count || 1;
      st.inUse = d.rack.in_use;
      st.grid = d.levels.map((lv) => lv.columns.map((c) => c.slice()));
      while (st.grid.some((lv) => lv.length < st.kolom)) st.grid.forEach((lv) => { while (lv.length < st.kolom) lv.push([]); });
    } else {
      st.grid = Array.from({ length: 5 }, () => Array.from({ length: 2 }, () => mk(3)));
    }
    st.sel = { lv: st.grid.length - 1, k: 0 };

    ctx.body.innerHTML = '<div class="k-line">' + back() + '</div>' +
      (st.inUse ? '<div class="k-note k-note--caution">' + icon('warn', 20) + bis('Rak ini sudah dipakai. Ubah ukuran per bin di Lihat rak, atau tambah rak baru.',
        'This rack is in use. Change sizes bin by bin under View, or add a new rack.') + '</div>' : '') +
      '<div class="rb-two"><form class="k-card k-card--pad k-stack" id="rb-form" autocomplete="off">' +
      '<h2 class="k-h2">' + (rackId ? bis('Ubah rak', 'Edit rack') : bis('Tambah rak', 'Add rack')) + '</h2>' +
      '<div class="rb-form3"><label class="k-field"><span class="k-field__label" ' + biAttr('Nama rak', 'Rack name') + '></span><input class="k-input" id="rb-code" maxlength="4" value="' + esc(st.code) + '"></label>' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('Jumlah level', 'Levels') + '></span><input class="k-input" id="rb-lv" type="number" inputmode="numeric" min="1" max="10" value="' + st.grid.length + '"></label>' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('Kolom per level', 'Kolom per level') + '></span><input class="k-input" id="rb-k" type="number" inputmode="numeric" min="1" max="10" value="' + st.kolom + '"></label></div>' +
      '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px"><span class="k-field__label">' + bis('Bin per level dan kolom', 'Bins per level and kolom') +
      ' <span class="k-muted" style="font-weight:500">' + bis('· tiap bin punya ukurannya sendiri', '· each bin has its own size') + '</span></span>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" id="rb-copy">' + icon('list', 18) + bis('Salin ke semua kolom', 'Copy to every kolom') + '</button></div>' +
      '<div id="rb-grid"></div>' +
      '<p class="k-caption" id="rb-hint"></p>' +
      '<div class="k-note k-note--navy" id="rb-result"></div>' +
      '<div class="k-line" style="gap:10px"><button type="button" class="k-btn k-btn--secondary" data-back2>' + bis('Batal', 'Cancel') + '</button>' +
      '<button type="submit" class="k-btn k-btn--primary k-grow" data-min-role="supervisor">' + icon('check') + bis('Simpan rak', 'Save rack') + '</button></div>' +
      (rackId && !st.inUse ? '<button type="button" class="k-linkbtn" id="rb-del" data-min-role="supervisor" style="color:var(--stop)">' + icon('trash', 18) + bis('Hapus rak ini', 'Delete this rack') + '</button>' : '') +
      '</form><div class="k-card k-card--pad k-stack"><h2 class="k-h2" id="rb-ptitle"></h2>' + legend() + '<div id="rb-preview"></div>' +
      '<p class="k-caption">' + bis('Kode bin = rak, level, bin. Level 1 paling bawah. Bin dihitung per level dari kiri ke kanan, menyeberang kolom.',
        'Bin code = rack, level, bin. Level 1 is the bottom. Bins are numbered per level from left to right, across the kolom.') + '</p></div></div>';
    wireBack(ctx.body);
    ctx.body.querySelector('[data-back2]').addEventListener('click', () => nav({}));
    const $ = (s) => ctx.body.querySelector(s);

    function codeNow() { return ($('#rb-code').value || '').trim().toUpperCase() || '?'; }
    function paint() {
      const code = codeNow();
      const K = st.kolom;
      const g = $('#rb-grid');
      let h = '<div class="rb-bgrid" style="grid-template-columns:56px repeat(' + K + ',minmax(0,1fr))"><span></span>' +
        Array.from({ length: K }, (_, i) => '<span class="rb-bgrid__head">Kolom ' + (i + 1) + '</span>').join('');
      for (let li = st.grid.length - 1; li >= 0; li--) {
        h += '<span class="rb-bgrid__lv">Level ' + (li + 1) + '</span>';
        st.grid[li].forEach((col, ki) => {
          const sel = st.sel && st.sel.lv === li && st.sel.k === ki;
          h += '<div class="rb-cell' + (sel ? ' is-sel' : '') + '" data-lv="' + li + '" data-k="' + ki + '">' + col.map((s, bi) =>
            '<span class="rb-chip' + (s === 'BESAR' ? ' rb-chip--besar' : '') + '"><button type="button" data-tog="' + bi + '" aria-label="' +
            esc('Level ' + (li + 1) + ' kolom ' + (ki + 1) + ' bin ' + (bi + 1) + ': ' + t(sizeWord(s)[0], sizeWord(s)[1]) + ', ' + t('ketuk untuk ganti', 'tap to switch')) + '">' +
            esc(t(sizeWord(s)[0], sizeWord(s)[1])) + '</button><button type="button" class="rb-x" data-del="' + bi + '" aria-label="' +
            esc(t('Hapus bin ', 'Remove bin ') + (bi + 1)) + '">' + icon('close', 14, 2.4) + '</button></span>').join('') +
            '<button type="button" class="rb-add" data-addbin aria-label="' + esc(t('Tambah bin di level ', 'Add a bin on level ') + (li + 1) + ' kolom ' + (ki + 1)) + '">' + icon('plus', 16, 2.4) + '</button></div>';
        });
      }
      g.innerHTML = h + '</div>';
      $('#rb-hint').textContent = t('Ketuk ukuran untuk menukar Kecil dan Besar, × untuk hapus bin, + untuk tambah bin. Salin ke semua kolom menyalin kolom terpilih (',
        'Tap a size to switch Kecil and Besar, × removes a bin, + adds one. Copy to every kolom copies the selected kolom (') +
        (st.sel ? 'kolom ' + (st.sel.k + 1) + t(', semua level).', ', every level).') : '-).');
      // levels for drawing + counts
      const levels = st.grid.map((cols, li) => {
        let idx = 0;
        return { level_no: li + 1, kolom: cols.map((c) => c.map((s) => ({ size: s, index: ++idx }))), count: idx, sizes: cols.flat() };
      });
      const all = levels.flatMap((l) => l.sizes);
      const kecil = all.filter((s) => s === 'KECIL').length;
      const first = levels.find((l) => l.count), last = levels.slice().reverse().find((l) => l.count);
      $('#rb-result').innerHTML = '<span><b>' + esc(t('Hasil: ', 'Result: ')) + all.length + ' bin</b>' +
        (first ? ', ' + esc(code + '-' + first.level_no + '-01') + ' ' + esc(t('sampai', 'to')) + ' ' + esc(code + '-' + last.level_no + '-' + pad2(last.count)) : '') +
        ' · ' + kecil + ' Kecil, ' + (all.length - kecil) + ' Besar</span>';
      $('#rb-ptitle').textContent = t('Pratinjau rak ', 'Preview of rack ') + code + t(', tampak depan', ', front view');
      $('#rb-preview').innerHTML = drawRack(levels, {
        levelSub: (lv) => {
          const set = new Set(lv.sizes);
          const w = set.size > 1 ? ['campur', 'mixed'] : set.has('BESAR') ? SIZE.BESAR : SIZE.KECIL;
          return '<small class="rb-mono">' + esc(code + '-' + lv.level_no + '-xx') + '</small><small>' + esc(t(w[0], w[1])) + '</small>';
        },
      });
    }
    $('#rb-grid').addEventListener('click', (e) => {
      const cell = e.target.closest('.rb-cell');
      if (!cell) return;
      const li = +cell.dataset.lv, ki = +cell.dataset.k, col = st.grid[li][ki];
      const tog = e.target.closest('[data-tog]'), del = e.target.closest('[data-del]'), add = e.target.closest('[data-addbin]');
      if (tog) { const i = +tog.dataset.tog; col[i] = col[i] === 'KECIL' ? 'BESAR' : 'KECIL'; }
      else if (del) col.splice(+del.dataset.del, 1);
      else if (add) { if (col.length < 20) col.push(col.length ? col[col.length - 1] : 'KECIL'); }
      st.sel = { lv: li, k: ki };
      paint();
    });
    $('#rb-copy').addEventListener('click', () => {
      if (!st.sel) return;
      const k = st.sel.k;
      st.grid.forEach((cols) => cols.forEach((c, ki) => { if (ki !== k) cols[ki] = cols[k].slice(); }));
      S.toast(['Kolom ' + (k + 1) + ' disalin ke semua kolom.', 'Kolom ' + (k + 1) + ' copied to every kolom.'], 'ok');
      paint();
    });
    $('#rb-code').addEventListener('input', paint);
    $('#rb-lv').addEventListener('change', () => {
      const n = Math.max(1, Math.min(10, parseInt($('#rb-lv').value, 10) || 1));
      $('#rb-lv').value = n;
      while (st.grid.length < n) st.grid.push(st.grid.length ? st.grid[st.grid.length - 1].map((c) => c.slice()) : Array.from({ length: st.kolom }, () => mk(3)));
      st.grid.length = n;
      if (st.sel && st.sel.lv >= n) st.sel.lv = n - 1;
      paint();
    });
    $('#rb-k').addEventListener('change', () => {
      const n = Math.max(1, Math.min(10, parseInt($('#rb-k').value, 10) || 1));
      $('#rb-k').value = n;
      st.kolom = n;
      st.grid.forEach((cols) => {
        while (cols.length < n) cols.push(cols.length ? cols[cols.length - 1].slice() : mk(3));
        cols.length = n;
      });
      if (st.sel && st.sel.k >= n) st.sel.k = n - 1;
      paint();
    });
    $('#rb-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { code: codeNow(), kolom_count: st.kolom, levels: st.grid.map((cols, li) => ({ level_no: li + 1, columns: cols })) };
      try {
        const res = rackId ? await api().put('/racks/' + rackId + '/build', body) : await api().post('/sites/' + siteId() + '/racks/build', body);
        S.toast(S.pick(res.message), 'ok');
        nav({ view: 'labels', rack: res.rack_id });
      } catch (err) { S.fail(err); }
    });
    const del = $('#rb-del');
    if (del) del.addEventListener('click', async () => {
      if (!(await S.confirm({ title: ['Hapus rak?', 'Delete the rack?'], text: ['Rak ' + st.code + ' dan semua binnya dihapus.', 'Rack ' + st.code + ' and all its bins are removed.'], danger: true, ok: ['Hapus', 'Delete'] }))) return;
      try { const r = await api().del('/racks/' + rackId); S.toast(S.pick(r.message), 'ok'); nav({}); } catch (err) { S.fail(err); }
    });
    paint();
  }

  /* ---------------- the rack, bin by bin ---------------- */
  async function rackDetail(ctx, rackId) {
    const d = await api().get('/racks/' + rackId + '/layout');
    ctx.actions.innerHTML = '<button type="button" class="k-btn k-btn--secondary" data-go="labels">' + icon('print') + bis('Cetak label', 'Print labels') + '</button>' +
      '<button type="button" class="k-btn k-btn--secondary" data-go="cek">' + icon('scan') + bis('Cek label', 'Check labels') + '</button>';
    ctx.actions.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => nav({ view: b.dataset.go, rack: rackId })));
    const bins = {};
    const levels = d.levels.map((lv) => ({ level_no: lv.level_no, kolom: lv.kolom.map((k) => k.bins.map((b) => { bins[b.location_id] = b; return b; })) }));
    ctx.body.innerHTML = '<div class="k-line">' + back() + '</div>' +
      '<div class="k-card k-card--pad k-stack"><h2 class="k-h2">' + esc(t('Rak ', 'Rack ')) + esc(d.rack.code) + '</h2><div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px"><span class="k-strong">' + esc(d.rack.summary) + '</span>' +
      '<span class="k-muted">' + esc(t('Dipakai ', 'In use ')) + d.rack.used + ' · ' + esc(t('kosong ', 'free ')) + (d.rack.bins - d.rack.used) + '</span></div>' + legend() +
      '<div style="overflow-x:auto"><div style="min-width:' + Math.max(340, d.levels.reduce((m, l) => Math.max(m, l.bins.length), 0) * 64) + 'px">' +
      drawRack(levels, {
        big: true,
        cls: (b) => 'is-click' + (b.occupied ? ' is-used' : ''),
        binHtml: (b) => '<span>' + esc(b.short_code) + '</span><small>' + esc(b.occupied ? (b.sku_name || '') : t('Kosong', 'Empty')) + '</small>',
        levelSub: (lv) => { const s = new Set(lv.kolom.flat().map((b) => b.size)); const w = s.size > 1 ? ['campur', 'mixed'] : s.has('BESAR') ? SIZE.BESAR : SIZE.KECIL; return '<small>' + esc(t(w[0], w[1])) + '</small>'; },
      }) + '</div></div><p class="k-caption">' + bis('Ketuk bin untuk mencetak ulang labelnya atau mengganti ukurannya.', 'Tap a bin to reprint its label or change its size.') + '</p></div>';
    wireBack(ctx.body);
    ctx.body.querySelectorAll('[data-loc]').forEach((el) => el.addEventListener('click', () => binDialog(bins[el.dataset.loc], () => rackDetail(ctx, rackId).then(() => paintAll(ctx.body)))));
  }

  function binDialog(b, reload) {
    const other = b.size === 'BESAR' ? 'KECIL' : 'BESAR';
    S.modal({
      title: [b.short_code, b.short_code],
      body: '<div class="k-stack"><div class="k-line" style="gap:8px">' + sizeChip(b.size) + '<span class="k-muted">Level ' + b.level_no + ' · Kolom ' + b.kolom_no + '</span></div>' +
        (b.occupied ? '<div class="k-note"><span><b>' + esc(b.sku_name || '') + '</b><br>' + esc(S.fmt.n(b.qty_on_hand)) + ' ' + esc(t('unit di bin', 'units in the bin')) + '</span></div>'
          : '<div class="k-note">' + bis('Bin kosong.', 'Empty bin.') + '</div>') +
        (b.label_check === 'wrong' ? '<div class="k-note k-note--stop">' + bis('Label di bin ini salah: milik ' + (b.label_check_scanned || '?') + '.', 'The label on this bin is wrong: it belongs to ' + (b.label_check_scanned || '?') + '.') + '</div>' : '') + '</div>',
      actions: [
        { label: ['Ganti ke ' + sizeWord(other)[0], 'Switch to ' + sizeWord(other)[1]], kind: 'secondary', minRole: 'supervisor', onClick: async () => {
          const r = await api().patch('/locations/' + b.location_id + '/size', { size: other }); S.toast(S.pick(r.message), 'ok'); reload(); } },
        { label: ['Cetak ulang label', 'Reprint label'], kind: 'primary', onClick: async () => { await reprint(b.location_id); reload(); } },
      ],
    });
  }

  async function reprint(locationId) {
    const r = await api().post('/locations/' + locationId + '/reprint', {});
    printHtml(singleSheet(r.label, r, !!r.label.kind));
    S.toast(S.pick(r.message), 'ok');
    return r;
  }

  /* ---------------- 3b: A4 label sheets ---------------- */
  async function rackLabels(ctx, rackId) {
    const d = await api().get('/racks/' + rackId + '/labels');
    ctx.actions.innerHTML = '<button type="button" class="k-btn k-btn--primary" data-print>' + icon('print') + bis('Cetak', 'Print') + '</button>';
    const doPrint = () => printHtml(rackSheets(d), async () => {
      try { await api().post('/racks/' + rackId + '/labels/printed', {}); S.toast(['Label rak ' + d.rack.code + ' dicetak.', 'Rack ' + d.rack.code + ' labels printed.'], 'ok'); }
      catch (e) { S.fail(e); }
    });
    ctx.actions.querySelector('[data-print]').addEventListener('click', doPrint);
    ctx.body.innerHTML = '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px">' + back() + '<h2 class="k-h2 k-grow">' + esc(d.title) + '</h2>' +
      '<span class="k-muted">' + d.page_count + ' ' + esc(t('halaman', 'pages')) + ' · ' + d.rack.bins + ' ' + esc(t('label bin', 'bin labels')) + ', 1 ' + esc(t('label rak', 'rack label')) + ', ' + d.rack.levels + ' ' + esc(t('strip level', 'level strips')) + '</span></div>' +
      '<div class="k-note k-note--info">' + icon('info', 20) + '<span>' + esc(d.top_note) + ' ' + esc(d.cut_note) + '</span></div>' +
      '<div class="k-phone-only"><button type="button" class="k-btn k-btn--primary k-btn--block" data-print2>' + icon('print') + bis('Cetak', 'Print') + '</button></div>' +
      rackSheets(d) +
      '<div class="k-line" style="gap:10px;flex-wrap:wrap"><button type="button" class="k-btn k-btn--secondary" data-cek>' + icon('scan') + bis('Lanjut: Cek label', 'Next: check labels') + '</button></div>';
    wireBack(ctx.body);
    ctx.body.querySelector('[data-print2]').addEventListener('click', doPrint);
    ctx.body.querySelector('[data-cek]').addEventListener('click', () => nav({ view: 'cek', rack: rackId }));
  }

  /* ---------------- 3c: Cek label (phone, full screen) ---------------- */
  async function labelCheck(ctx, rackId) {
    let st = await api().get('/racks/' + rackId + '/label-check');
    S.fullScreen(true, { title: ['Cek label', 'Check labels'], onBack: () => { S.fullScreen(false); nav({}); } });
    ctx.body.innerHTML = '<div class="k-stack" id="rb-cek"></div>';
    const host = ctx.body.querySelector('#rb-cek');
    let zone = null;
    function paint(last) {
      const pct = st.total ? Math.round(100 * st.checked / st.total) : 0;
      let h = '<div class="k-card k-card--pad k-stack k-stack--tight"><span class="k-eyebrow">' + esc(t('Cek label rak ', 'Check labels, rack ')) + esc(st.rack.code) + '</span>' +
        '<div class="k-line" style="gap:10px;align-items:baseline"><span class="rb-check__num">' + st.checked + '</span><span class="k-strong">' + esc(t('dari ', 'of ')) + st.total + ' label</span>' +
        '<span class="k-muted k-grow" style="text-align:right">' + st.ok + ' ' + esc(t('cocok', 'match')) + ' · ' + st.wrong + ' ' + esc(t('salah', 'wrong')) + '</span></div>' +
        '<div class="k-progress"><span class="k-progress__bar" style="width:' + pct + '%"></span></div></div>';
      if (st.next) {
        h += '<div class="k-target' + (last === 'ok' ? ' k-target--ok' : last === 'stop' ? ' k-target--stop' : '') + '"><div class="k-target__text">' +
          '<span class="k-target__label">' + esc(t('Cek bin berikut', 'Check the next bin')) + '</span><span class="k-target__code">' + esc(st.next.code) + '</span>' +
          '<span class="k-target__hint">' + esc(st.next.hint) + '</span></div></div><div id="rb-zone"></div>';
      } else if (st.done) {
        h += '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
          '<span class="k-empty__title">' + esc(t('Semua label cocok', 'Every label matches')) + '</span>' +
          '<span class="k-empty__text">' + st.ok + ' ' + esc(t('dari ', 'of ')) + st.total + ' ' + esc(t('label rak ', 'labels of rack ')) + esc(st.rack.code) + '.</span></div>';
      } else {
        h += '<div class="k-note k-note--caution">' + icon('warn', 20) + bis('Semua bin sudah dipindai. Bereskan label yang salah di bawah, lalu pindai lagi.', 'Every bin was scanned. Fix the wrong labels below, then scan them again.') + '</div>';
      }
      if (st.to_fix.length) {
        h += '<span class="k-eyebrow" style="color:var(--stop)">' + esc(t('Perlu dibereskan', 'To fix')) + ' (' + st.to_fix.length + ')</span>' +
          st.to_fix.map((f) => '<div class="k-card k-card--pad k-card--stop k-stack k-stack--tight"><span class="k-mono k-strong" style="font-size:22px">' + esc(f.code) + '</span>' +
            '<span class="k-strong" style="color:var(--stop)">' + esc(f.message) + '</span><span class="k-muted">' + esc(f.action) + '</span>' +
            '<button type="button" class="k-btn k-btn--secondary" data-reprint="' + f.location_id + '">' + icon('print') + '<span>' + esc(t('Cetak ulang ', 'Reprint ')) + esc(f.code) + '</span></button></div>').join('');
      }
      if (st.recent.length) {
        h += '<span class="k-eyebrow">' + esc(t('Terakhir dicek', 'Last checked')) + '</span><div class="k-card">' + st.recent.map((r) =>
          '<div class="k-line k-line--between" style="padding:12px 16px;border-top:1px solid var(--rule)"><span class="k-mono k-strong">' + esc(r.code) + '</span>' +
          (r.result === 'cocok' ? S.pill('ok', 'Cocok', 'Match') : S.pill('stop', 'Salah', 'Wrong')) + '</div>').join('') + '</div>';
      }
      h += '<div class="k-actionbar"><button type="button" class="k-btn k-btn--secondary k-btn--lg k-btn--block" data-done>' + icon('back', 22) + bis('Kembali ke rak', 'Back to racks') + '</button></div>';
      host.innerHTML = h;
      S.applyLang(host);
      host.querySelectorAll('[data-reprint]').forEach((b) => b.addEventListener('click', async () => {
        try { await reprint(+b.dataset.reprint); st = await api().get('/racks/' + rackId + '/label-check'); paint(); } catch (e) { S.fail(e); }
      }));
      host.querySelector('[data-done]').addEventListener('click', () => { S.fullScreen(false); nav({}); });
      if (st.next) {
        zone = S.scan(onScan, { title: ['Pindai label ' + st.next.code, 'Scan label ' + st.next.code], mount: host.querySelector('#rb-zone') });
        zone.focus();
      }
    }
    async function onScan(code, z) {
      if (!st.next) return;
      try {
        const r = await api().post('/racks/' + rackId + '/label-check', { location_id: st.next.location_id, scanned: code });
        st = r.progress;
        if (r.result === 'cocok') { z.accept(['Cocok', 'Match'], r.expected_code); paint('ok'); }
        else { z.reject(r.message, ''); S.toast(r.message, 'stop'); paint('stop'); }
      } catch (e) { z.reject(S.pick(e.message), ''); S.fail(e); }
    }
    paint();
  }

  /* ================= tab: Bin khusus (3d) ================= */
  S.tab('khusus', async function (ctx) {
    S.fullScreen(false);
    S.setSub('Bin khusus bukan bagian dari rak. Kodenya memakai kode dark store.', 'Special bins are not part of a rack. Their codes carry the dark store code.');
    if (!siteId()) { ctx.body.innerHTML = '<div class="k-note k-note--info">' + bis('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>'; return; }
    loadOverview().catch(() => null);
    const d = await api().get('/sites/' + siteId() + '/special-bins');
    const TITLE_EN = { IN: 'Temporary inbound bins', QR: 'Quarantine trays (QR)', OUT: 'Order baskets' };
    const ADD = { IN: ['Tambah bin sementara', 'Add a temporary bin'], QR: ['Tambah baki', 'Add a tray'], OUT: ['Tambah keranjang', 'Add a basket'] };
    let h = d.hub_ready ? '' : '<div class="k-note k-note--caution">' + icon('warn', 20) + '<span><span ' + biAttr('Lengkapi dark store dulu (kode dark store) di Pengaturan.', 'Complete the dark store (dark store code) in Settings first.') + '></span> <a href="pengaturan.html?tab=hub">' + esc(t('Buka Pengaturan', 'Open Settings')) + '</a></span></div>';
    h += '<div class="k-grid3">' + d.cards.map((c) => '<div class="k-card k-card--pad k-stack" data-kind="' + c.kind + '">' +
      '<h2 class="k-h2" ' + biAttr(c.title, TITLE_EN[c.kind]) + '></h2><p class="k-p k-muted">' + esc(c.purpose) + '</p>' +
      '<div class="k-line k-line--between"><span class="k-field__label">' + bis('Jumlah', 'Count') + '</span><span class="rb-count">' + c.count + '</span></div>' +
      '<div class="rb-codes">' + (c.bins.length ? c.bins.map((b) => '<span>' + esc(b.code) + '</span>').join('') : '<em class="k-muted">' + esc(t('Belum ada', 'None yet')) + '</em>') + '</div>' +
      '<div class="rb-btns"><button type="button" class="k-btn k-btn--sm k-btn--secondary" data-add data-min-role="supervisor">' + icon('plus', 18) + bis(ADD[c.kind][0], ADD[c.kind][1]) + '</button>' +
      '<button type="button" class="k-btn k-btn--sm k-btn--ghost" data-less data-min-role="supervisor"' + (c.count <= c.min ? ' disabled' : '') + '>' + icon('minus', 18) + bis('Kurangi', 'Remove one') + '</button></div>' +
      (c.note ? '<p class="k-caption">' + esc(c.note) + '</p>' : '') +
      '<div class="k-card__foot" style="margin:0 -16px -16px;padding:12px 16px">' +
      (c.labels_printed ? S.pill('ok', c.label_printed_text, 'Labels printed') : S.pill('caution', 'Label belum dicetak', 'Labels not printed')) +
      '<button type="button" class="k-btn k-btn--sm k-btn--secondary" data-print style="margin-left:auto"' + (c.count ? '' : ' disabled') + '>' + icon('print', 18) + bis('Cetak label', 'Print labels') + '</button></div></div>').join('') + '</div>' +
      '<p class="k-caption">' + esc(d.rule) + '</p>';
    ctx.body.innerHTML = h;
    ctx.body.querySelectorAll('[data-kind]').forEach((card) => {
      const kind = card.dataset.kind, c = d.cards.find((x) => x.kind === kind);
      card.querySelector('[data-add]').addEventListener('click', async () => {
        try {
          const r = await api().post('/sites/' + siteId() + '/special-bins/' + kind + '/add', {});
          S.toast(S.pick(r.message), 'ok');
          printHtml(singleSheet(r.label, { cut_note: '', footer: '' }, true), () => S.rerender());
        } catch (e) { S.fail(e); }
      });
      card.querySelector('[data-less]').addEventListener('click', async () => {
        if (!(await S.confirm({ title: ['Kurangi satu?', 'Remove one?'], text: ['Yang terakhir (' + (c.bins.length ? c.bins[c.bins.length - 1].code : '') + ') dihapus bila kosong.', 'The last one is removed if it is empty.'] }))) return;
        try { const r = await api().put('/sites/' + siteId() + '/special-bins/' + kind, { count: c.count - 1 }); S.toast(S.pick(r.message), 'ok'); S.rerender(); } catch (e) { S.fail(e); }
      });
      card.querySelector('[data-print]').addEventListener('click', async () => {
        try {
          const l = await api().get('/sites/' + siteId() + '/special-bins/labels' + api().qs({ kind }));
          printHtml('<div class="rb-sheets"><div class="rb-sheet"><div class="rb-sheet__head"><div class="k-stack k-stack--tight" style="flex-grow:1"><span class="rb-sheet__title">' + esc(l.subtitle) + '</span>' +
            '<span class="rb-sheet__note">' + esc(c.title) + '</span></div></div><div class="rb-labs">' + l.labels.map(specialLabelHtml).join('') + '</div>' + sheetFoot(l) + '</div></div>', async () => {
            try { await api().post('/sites/' + siteId() + '/special-bins/printed' + api().qs({ kind }), {}); S.rerender(); } catch (e) { S.fail(e); }
          });
        } catch (e) { S.fail(e); }
      });
    });
  });

  /* ================= tab: Perlu bin (3e) ================= */
  S.tab('perlu', async function (ctx) {
    S.fullScreen(false);
    S.setSub('Satu produk per bin. Pilih bin kosong dengan ukuran yang sama.', 'One product per bin. Pick a free bin of the same size.');
    if (!siteId()) { ctx.body.innerHTML = '<div class="k-note k-note--info">' + bis('Pilih satu dark store di atas.', 'Choose one dark store above.') + '</div>'; return; }
    loadOverview().catch(() => null);
    const d = await api().get('/sites/' + siteId() + '/needs-bin');
    S.tabCount('perlu', d.total || null, d.total ? 'caution' : null);
    if (!d.total) {
      ctx.body.innerHTML = '<div class="k-card k-empty"><span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
        bis('Semua SKU sudah punya bin', 'Every SKU has a bin', 'k-empty__title') +
        bis('SKU baru muncul di sini setelah ukuran binnya diisi di Produk.', 'New SKUs show here once their bin size is set on Produk.', 'k-empty__text') + '</div>';
      return;
    }
    let sel = +(ctx.params.get('sku') || d.skus[0].sku_id);
    if (!d.skus.some((s) => s.sku_id === sel)) sel = d.skus[0].sku_id;
    let rackSel = null, pick = null, opt = null;
    ctx.body.innerHTML = '<div class="rb-two rb-two--list"><div class="k-card" style="overflow:hidden"><div class="k-card__head" style="padding:14px 16px">' +
      '<span class="k-strong">' + esc(t('Perlu bin', 'Need a bin')) + ' (' + d.total + ')</span>' +
      '<span class="k-muted" style="margin-left:auto;font-size:13px">' + esc(t('kosong: ', 'free: ')) + d.free.KECIL + ' Kecil, ' + d.free.BESAR + ' Besar</span></div>' +
      '<div class="rb-skus" id="rb-skus"></div></div><div class="k-card k-card--pad k-stack" id="rb-pic"></div></div>';
    const list = ctx.body.querySelector('#rb-skus'), pic = ctx.body.querySelector('#rb-pic');
    function paintList() {
      list.innerHTML = d.skus.map((s) => '<button type="button" class="rb-sku' + (s.sku_id === sel ? ' is-sel' : '') + '" data-sku="' + s.sku_id + '">' +
        '<span class="rb-sku__text"><span class="rb-sku__name">' + esc(s.name) + '</span><span class="rb-sku__sub">' + esc([s.barcode, s.brand_name].filter(Boolean).join(' · ')) + '</span></span>' +
        sizeChip(s.bin_size) + '</button>').join('');
      S.applyLang(list);
    }
    async function loadPic() {
      pic.innerHTML = '<div class="k-loading" ' + biAttr('Memuat rak…', 'Loading the rack…') + '></div>';
      S.applyLang(pic);
      opt = await api().get('/sites/' + siteId() + '/needs-bin/' + sel + '/options' + api().qs({ rack_id: rackSel }));
      pick = opt.suggested ? opt.suggested.location_id : null;
      paintPic();
    }
    function paintPic() {
      const sz = opt.sku.bin_size;
      const r = opt.rack;
      const codeOf = (id) => { let c = null; (r ? r.levels : []).forEach((lv) => lv.kolom.forEach((k) => k.bins.forEach((b) => { if (b.location_id === id) c = b.short_code; }))); return c; };
      let h = '<div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px"><h2 class="k-h2">' + esc(t('Rak ', 'Rack ')) + esc(r ? r.code : '-') + ' · ' +
        esc(t('bin ' + sizeWord(sz)[0] + ' yang kosong', 'free ' + sizeWord(sz)[1] + ' bins')) + '</h2>' +
        '<div class="k-segment" role="group">' + opt.racks.map((x) => '<button type="button" data-rack="' + x.rack_id + '" aria-pressed="' + (r && r.rack_id === x.rack_id) + '">' +
          esc(x.code) + ' <span class="k-muted">(' + x.free_matching + ')</span></button>').join('') + '</div></div>' +
        '<p class="k-caption">' + esc(opt.order_note) + '</p>';
      if (r) {
        const levels = r.levels.map((lv) => ({ level_no: lv.level_no, size_text: lv.size_text, kolom: lv.kolom.map((k) => k.bins) }));
        h += '<div style="overflow-x:auto"><div style="min-width:' + Math.max(320, Math.max(...r.levels.map((l) => l.bins.length)) * 70) + 'px">' + drawRack(levels, {
          big: true,
          levelSub: (lv) => '<small>' + esc(lv.size_text || '') + '</small>',
          cls: (b) => ({ dipakai: 'is-used', disarankan: 'is-match', cocok: 'is-match', lain: 'is-other' }[b.state] || '') + (b.location_id === pick ? ' is-best' : ''),
          binHtml: (b) => '<span>' + esc(b.short_code) + '</span><small>' + esc(
            b.location_id === pick && b.location_id === (opt.suggested && opt.suggested.location_id) ? t('Disarankan', 'Suggested')
              : b.location_id === pick ? t('Dipilih', 'Chosen')
                : b.state === 'dipakai' ? t('Dipakai', 'In use') : b.state === 'lain' ? t(sizeWord(b.size)[0], sizeWord(b.size)[1]) : t('Kosong', 'Empty')) + '</small>',
        }) + '</div></div>';
      }
      h += '<p class="k-caption">' + esc(opt.legend) + '</p>';
      const code = pick ? codeOf(pick) : null;
      h += '<div class="k-actionbar"><button type="button" class="k-btn k-btn--primary k-btn--lg k-btn--block" data-save data-min-role="supervisor"' + (code ? '' : ' disabled') + '>' +
        icon('check', 22) + '<span>' + esc(code ? t('Simpan di ', 'Save at ') + code : t('Tidak ada bin kosong yang cocok', 'No free bin of this size')) + '</span></button></div>';
      if (!opt.racks.length) h = '<div class="k-note k-note--caution">' + bis('Belum ada rak. Tambah rak dulu.', 'No racks yet. Add a rack first.') + '</div>';
      pic.innerHTML = h;
      paintAll(pic);
      pic.querySelectorAll('[data-rack]').forEach((b) => b.addEventListener('click', () => { rackSel = +b.dataset.rack; loadPic().catch(S.fail); }));
      pic.querySelectorAll('.rb-bin.is-match, .rb-bin.is-best').forEach((el) => el.addEventListener('click', () => { pick = +el.dataset.loc; paintPic(); }));
      const save = pic.querySelector('[data-save]');
      if (save) save.addEventListener('click', async () => {
        try {
          const res = await api().post('/sites/' + siteId() + '/needs-bin/' + sel, { location_id: pick });
          S.toast(res.message, 'ok');
          S.rerender();
        } catch (e) { S.fail(e); }
      });
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sku]');
      if (!b) return;
      sel = +b.dataset.sku; rackSel = null;
      paintList();
      loadPic().then(() => { if (window.innerWidth < 1024) pic.scrollIntoView({ behavior: 'smooth', block: 'start' }); }).catch(S.fail);
    });
    paintList();
    await loadPic();
  });
})();
