/* perlu-tindakan.js: what this person must settle (boards 1a and 1b).
 *
 *   GET /api/todo?site_id=   rows for the caller's role, most urgent first
 *
 * The server decides what belongs to which role (a superadmin viewing as an
 * SPV sees the SPV's list). Rows past their time come back overdue=true and
 * are shown amber. Each row opens the screen where it is settled; old console
 * links are turned into the new pages by NJW.shell.route. Refreshes every
 * minute. Laptop: a table. Phone: big rows, then "Pekerjaan saya" tiles.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;

  /* What the row's button says, and which icon the phone row shows.
     Unknown kinds fall back to "Buka" so a new kind never breaks the page. */
  const KIND = [
    [/^faktur_upload/, ['Unggah', 'Upload'], 'upload', true],
    [/^faktur_issue/, ['Putuskan', 'Decide'], 'inbound', true],
    [/^restock_draft|^extra_to_raise/, ['Periksa', 'Check'], 'truck', true],
    [/^restock_raised/, ['Buat PO', 'Make the PO'], 'truck', true],
    [/^restock_po_unsent|^restock_unconfirmed/, ['Lihat', 'View'], 'truck', false],
    [/^variance_signoff/, ['Setujui', 'Approve'], 'truck', true],
    [/^variance/, ['Periksa', 'Check'], 'truck', true],
    [/^expiry/, ['Isi', 'Fill in'], 'truck', true],
    [/quarant|write_?off/, ['Putuskan', 'Decide'], 'warn', true],
    [/count|opname/, ['Lihat', 'View'], 'count', false],
    [/consum|supply/, ['Ajukan', 'Request'], 'box', true],
    [/^sku|item_no_sku/, ['Lengkapi', 'Complete'], 'diamond', true],
    [/^link/, ['Lihat', 'View'], 'link', false],
    [/^return_to_shelf/, ['Kembalikan', 'Put back'], 'undo', true],
    [/^my_pick|^to_pack/, ['Lanjutkan', 'Continue'], 'bag', true],
    [/^await_driver|^late_orders|^not_started|^requeued|^missing_item/, ['Lihat', 'View'], 'bag', false],
  ];
  const kindOf = (k) => (KIND.find((x) => x[0].test(k || '')) || [null, ['Buka', 'Open'], 'todo', true]);

  function dueCell(x) {
    const d = S.fmt.due(x.due_at);
    if (d) return '<span class="k-strong" style="color:' + (d[2] ? 'var(--caution)' : 'var(--ink-2)') + '" ' + biAttr(d[0], d[1]) + '>' + esc(t(d[0], d[1])) + '</span>';
    if (x.since) return '<span class="k-muted"><span ' + biAttr('sejak', 'since') + '>' + esc(t('sejak', 'since')) + '</span> ' + esc(S.fmt.time(x.since)) + '</span>';
    return '<span class="k-muted">-</span>';
  }
  const statusPill = (x) => (x.overdue ? S.pill('caution', 'Lewat waktu', 'Past time') : S.pill('info', 'Menunggu', 'Waiting'));

  function tableHtml(items, showHub) {
    return '<div class="k-tablewrap"><table class="k-table"><thead><tr>' +
      '<th style="width:150px" ' + biAttr('Status', 'Status') + '></th>' +
      (showHub ? '<th style="width:80px" ' + biAttr('Hub', 'Hub') + '></th>' : '') +
      '<th ' + biAttr('Apa', 'What') + '></th><th style="width:150px" ' + biAttr('Batas', 'Due') + '></th><th style="width:140px"></th>' +
      '</tr></thead><tbody>' + items.map((x) => {
        const k = kindOf(x.kind);
        const href = S.route(x.link);
        return '<tr' + (x.overdue ? ' class="is-caution"' : '') + '><td>' + statusPill(x) + '</td>' +
          (showHub ? '<td class="k-mono k-strong">' + esc(S.shortCode(x.site_code || '-')) + '</td>' : '') +
          '<td><div class="k-cell2"><span class="k-cell2__main" ' + biAttr(x.title_id, x.title_en) + '></span>' +
          (x.detail_id ? '<span class="k-cell2__sub" ' + biAttr(x.detail_id, x.detail_en) + '></span>' : '') + '</div></td>' +
          '<td>' + dueCell(x) + '</td>' +
          '<td class="k-table__actions">' + (href
            ? '<a class="k-btn k-btn--sm ' + (k[3] ? 'k-btn--primary' : 'k-btn--secondary') + '" style="min-width:110px" href="' + esc(href) + '" ' + biAttr(k[1][0], k[1][1]) + '></a>'
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function rowsHtml(items, showHub) {
    return '<div class="k-list">' + items.map((x) => {
      const k = kindOf(x.kind);
      const href = S.route(x.link);
      const d = S.fmt.due(x.due_at);
      const sub = [];
      if (showHub && x.site_code) sub.push(esc(S.shortCode(x.site_code)));
      if (x.detail_id) sub.push('<span ' + biAttr(x.detail_id, x.detail_en) + '></span>');
      if (d) sub.push('<span ' + biAttr(d[0], d[1]) + '></span>');
      const tag = href ? 'a' : 'div';
      return '<' + tag + ' class="k-row' + (x.overdue ? ' k-row--caution' : '') + '"' + (href ? ' href="' + esc(href) + '"' : '') + '>' +
        '<span class="k-row__icon' + (x.overdue ? ' k-row__icon--caution' : '') + '">' + icon(k[2], 26) + '</span>' +
        '<span class="k-row__text"><span class="k-row__title" ' + biAttr(x.title_id, x.title_en) + '></span>' +
        (sub.length ? '<span class="k-row__sub' + (x.overdue ? ' k-row__sub--caution' : '') + '">' + sub.join(' · ') + '</span>' : '') + '</span>' +
        (href ? '<span class="k-row__chev">' + icon('chev', 22) + '</span>' : '') + '</' + tag + '>';
    }).join('') + '</div>';
  }

  const emptyHtml = () => '<div class="k-card k-empty">' +
    '<span class="k-empty__icon">' + icon('check', 28, 2.6) + '</span>' +
    bis('Tidak ada yang perlu diselesaikan', 'Nothing to settle', 'k-empty__title') +
    bis('Semua beres. Daftar ini terisi sendiri saat ada pekerjaan baru.', 'All clear. This list fills itself when new work comes in.', 'k-empty__text') +
    '</div>';

  /* Pekerjaan saya: the jobs a person starts from the phone (board 1b). */
  const TILES = [
    ['pesanan.html?tab=ambil', 'bag', 'Pesanan', 'Orders'],
    ['barang-masuk.html', 'inbound', 'Barang masuk', 'Inbound'],
    ['hitung-stok.html', 'count', 'Hitung stok', 'Stock count'],
    ['pesanan.html?tab=kembalikan', 'undo', 'Kembalikan ke rak', 'Put back to rack'],
  ];
  const tilesHtml = () => '<div class="k-stack k-phone-only" style="margin-top:8px">' +
    bis('Pekerjaan saya', 'My work', 'k-eyebrow') +
    '<div class="k-tiles">' + TILES.map((x) => '<a class="k-tile" href="' + x[0] + '">' + icon(x[1], 28) + bis(x[2], x[3]) + '</a>').join('') + '</div></div>';

  S.page(async function (ctx) {
    const body = ctx.body;
    const floor = !S.atLeast('supervisor');
    S.setSub(floor ? 'Kerjakan dari atas ke bawah.' : 'Yang harus Anda selesaikan, paling mendesak di atas. Baris hilang sendiri setelah selesai.',
      floor ? 'Work from the top down.' : 'What you must settle, most urgent first. A row disappears by itself once done.');
    body.innerHTML = '<div id="pt-list"><div class="k-loading" ' + biAttr('Memeriksa…', 'Checking…') + '></div></div>' + tilesHtml() +
      (floor ? '<div class="k-actionbar k-phone-only"><a class="k-btn k-btn--primary k-btn--lg k-btn--block" href="pesanan.html?tab=ambil">' +
        icon('arrow', 24, 2.2) + bis('Siap ambil pesanan', 'Ready to pick orders') + '</a></div>' : '');

    let last = null;
    async function load() {
      let res;
      try { res = await S.api().get('/todo' + S.api().qs({ site_id: S.siteId() })); }
      catch (e) { S.fail(e); return; }
      last = res;
      S.setCount(res.counts);
      paint();
    }
    function paint() {
      if (!last) return;
      const res = last;
      const showHub = S.allSites() || new Set(res.items.map((x) => x.site_id)).size > 1;
      ctx.actions.innerHTML = res.counts.total
        ? (res.counts.overdue ? '<span class="k-pill k-pill--caution k-pill--lg">' + esc(String(res.counts.overdue)) + ' ' + bis('lewat waktu', 'past time') + '</span>' : '') +
          '<span class="k-pill k-pill--info k-pill--lg">' + esc(String(res.counts.total)) + ' ' + bis('total', 'in total') + '</span>'
        : '';
      const host = body.querySelector('#pt-list');
      host.innerHTML = !res.items.length ? emptyHtml()
        : '<div class="k-laptop-only">' + tableHtml(res.items, showHub) + '</div><div class="k-phone-only">' + rowsHtml(res.items, showHub) + '</div>';
      S.applyLang(host);
      S.applyLang(ctx.actions);
    }
    document.addEventListener('njw:lang', paint);
    S.onSiteChange(load);
    await load();
    ctx.every(60000, load);
  });
})();
