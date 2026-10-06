/* shell.js: the one app's frame, menu and shared helpers (frontend/app/).
 *
 * Every page loads ../js/api.js, ../js/scan.js and this file, then calls
 *   NJW.shell.init({ page: 'pesanan', title: ['Pesanan', 'Orders'], tabs: [...] })
 * The shell signs the person in (/api/me), picks the hub, draws the menu (the
 * laptop sidebar or the phone header and menu sheet), the training and
 * view-as banners, then loads js/<page>.js. That script registers its view
 * with NJW.shell.page(fn) or NJW.shell.tab('id', fn). No script: "Segera hadir".
 *
 * Read README.md in this folder before writing a page.
 */
(function () {
  'use strict';

  const NJW = (window.NJW = window.NJW || {});
  const SELF = document.currentScript;
  const VER = ((SELF && /[?&]v=([^&#]+)/.exec(SELF.src)) || [])[1] || '';
  const raw = () => NJW.api.raw;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  /* ================= language: data-id / data-en ================= */

  const lang = () => (store.get('njw.lang') === 'en' ? 'en' : 'id');
  const t = (id, en) => (lang() === 'en' ? (en == null ? id : en) : id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const biAttr = (id, en) => 'data-id="' + esc(id) + '" data-en="' + esc(en == null ? id : en) + '"';
  /* A span with both languages, filled for the current one. */
  const bis = (id, en, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + ' ' + biAttr(id, en) + '>' + esc(t(id, en)) + '</span>';
  function bi(el, id, en) {
    if (!el) return el;
    el.dataset.id = id;
    el.dataset.en = en == null ? id : en;
    el.textContent = t(id, en);
    return el;
  }
  /* Label pairs are passed around as [id, en] or a plain string. */
  const pair = (v) => (Array.isArray(v) ? v : [v == null ? '' : String(v), v == null ? '' : String(v)]);

  function applyLang(root) {
    const en = lang() === 'en';
    root = root || document;
    $$('[data-id]', root).forEach((el) => {
      const v = en ? (el.dataset.en || el.dataset.id) : el.dataset.id;
      if (v != null) el.textContent = v;
    });
    $$('[data-ph-id]', root).forEach((el) => { el.placeholder = en ? (el.dataset.phEn || el.dataset.phId) : el.dataset.phId; });
    $$('[data-aria-id]', root).forEach((el) => { el.setAttribute('aria-label', en ? (el.dataset.ariaEn || el.dataset.ariaId) : el.dataset.ariaId); });
    if (root === document) {
      document.documentElement.lang = en ? 'en' : 'id';
      $$('[data-lang-toggle]').forEach((b) => { b.textContent = en ? 'EN' : 'ID'; b.setAttribute('aria-label', en ? 'Language: English. Switch to Indonesian' : 'Bahasa: Indonesia. Ganti ke Inggris'); });
    }
  }
  function setLang(l) {
    store.set('njw.lang', l === 'en' ? 'en' : 'id');
    applyLang(document);
    if (CUR_TITLE) document.title = t(CUR_TITLE[0], CUR_TITLE[1]) + ' · SatSet WMS';
    paintClock();
    document.dispatchEvent(new CustomEvent('njw:lang', { detail: lang() }));
  }
  /* The server answers "Indonesian / English" in one string. */
  function pick(text) {
    if (!text) return text;
    const m = /^(.{6,}?) \/ (.{6,})$/.exec(String(text));
    return m ? (lang() === 'en' ? m[2] : m[1]) : text;
  }

  /* ================= roles: the same ladder as backend/auth.py ================= */

  const RANK = { staff: 0, hub_operator: 1, supervisor: 2, hq: 3, ops_head: 4, superadmin: 5 };
  const ROLE_NAME = {
    staff: ['Staf', 'Staff'], hub_operator: ['Operator hub', 'Hub operator'], supervisor: ['SPV', 'SPV'],
    hq: ['Ops HQ', 'Ops HQ'], ops_head: ['Ops Head', 'Ops Head'], superadmin: ['Superadmin', 'Superadmin'],
  };
  const ROLE_CHIP = { staff: 'staff', hub_operator: 'staff', supervisor: 'spv', hq: 'hq', ops_head: 'head', superadmin: 'head' };
  const LOCK_WHO = {
    hub_operator: ['Hanya operator hub', 'Hub operator only'], supervisor: ['Hanya SPV', 'SPV only'],
    hq: ['Hanya Ops HQ', 'Ops HQ only'], ops_head: ['Hanya Ops Head', 'Ops Head only'],
    superadmin: ['Hanya superadmin', 'Superadmin only'],
  };
  let ME = null;
  const atLeast = (role) => !!ME && (RANK[ME.role] || 0) >= (RANK[role] || 0);
  const roleName = (r) => ROLE_NAME[r] || [r || '', r || ''];
  const roleChip = (r) => '<span class="k-chip k-chip--' + (ROLE_CHIP[r] || 'head') + '" ' + biAttr(roleName(r)[0], roleName(r)[1]) + '>' + esc(t(roleName(r)[0], roleName(r)[1])) + '</span>';

  /* ================= icons (stroke SVG from the boards) ================= */

  const ICON = {
    todo: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 9l1.6 1.6L12.5 7.5"/><path d="M14 9h2.5"/><path d="M8 15l1.6 1.6 2.9-3.1"/><path d="M14 15h2.5"/>',
    bag: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    inbound: '<path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M4 17v3h16v-3"/>',
    count: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    rack: '<rect x="4" y="3.5" width="16" height="17" rx="1"/><path d="M4 9.5h16M4 15h16M10 3.5v17"/>',
    warn: '<path d="M12 3.5 21 19.5H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    box: '<path d="M4 8 12 4l8 4v8l-8 4-8-4z"/><path d="m4 8 8 4 8-4"/><path d="M12 12v8"/>',
    truck: '<path d="M3.5 7.5h11v9h-11z"/><path d="M14.5 10.5h3.5l2.5 3v3h-6"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>',
    diamond: '<path d="M12 3.2 20.5 12 12 20.8 3.5 12z"/><circle cx="12" cy="12" r="2.2"/>',
    list: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    report: '<path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M9 17v-3M12 17v-6M15 17v-4"/>',
    book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20.5V5.5"/><path d="M8 8h7M8 11.5h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/>',
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    out: '<path d="M14 4h5.5v16H14"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V4.5h6V7"/><path d="M7 7l1 13h8l1-13"/>',
    print: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="1.5"/><path d="M7 13.5h10v7H7z"/>',
    download: '<path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M4 19.5h16"/>',
    upload: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 19.5h16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    basket: '<path d="M3.5 9.5h17l-1.8 9.5a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2z"/><path d="M8 9.5 11 4M16 9.5 13 4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  };
  function icon(name, size, sw) {
    return '<svg width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON.info) + '</svg>';
  }

  /* ================= the ONE menu (STYLE.md order) ================= */

  const MENU = [
    { group: null, items: [{ page: 'perlu-tindakan', id: 'Perlu tindakan', en: 'To do', icon: 'todo', badge: true }] },
    { group: ['Harian', 'Daily'], items: [
      { page: 'pesanan', id: 'Pesanan', en: 'Orders', icon: 'bag' },
      { page: 'pesanan', tab: 'kembalikan', id: 'Kembalikan ke rak', en: 'Put back to rack', icon: 'undo' },
      { page: 'barang-masuk', id: 'Barang masuk', en: 'Inbound', icon: 'inbound' },
      { page: 'hitung-stok', id: 'Hitung stok', en: 'Stock count', icon: 'count' },
    ] },
    { group: ['Stok', 'Stock'], items: [
      { page: 'stok', id: 'Stok', en: 'Stock', icon: 'grid' },
      { page: 'rak-bin', id: 'Rak & bin', en: 'Racks & bins', icon: 'rack' },
      { page: 'karantina-retur', id: 'Karantina & retur', en: 'Quarantine & returns', icon: 'warn' },
      { page: 'bahan-kemas', id: 'Bahan kemas', en: 'Packing supplies', icon: 'box' },
    ] },
    { group: ['Merek & menu', 'Brands & menu'], items: [
      { page: 'restock', id: 'Restock ke merek', en: 'Restock from brand', icon: 'truck' },
      { page: 'produk', id: 'Produk', en: 'Products', icon: 'diamond' },
      { page: 'menu-toko-hiryu', id: 'Menu & toko Hiryu', en: 'Hiryu menu & stores', icon: 'list' },
    ] },
    { group: ['Laporan & pengaturan', 'Reports & settings'], items: [
      { page: 'laporan', id: 'Laporan', en: 'Reports', icon: 'report' },
      { page: 'panduan', id: 'Panduan', en: 'Guide', icon: 'book' },
      { page: 'pengaturan', id: 'Pengaturan', en: 'Settings', icon: 'gear' },
    ] },
  ];
  const itemHref = (it) => it.page + '.html' + (it.tab ? '?tab=' + it.tab : '');

  /* Old console and station links (Perlu tindakan rows, bookmarks) to the new
     pages. legacy.js holds the table; this only reads it when loaded. */
  function route(link) {
    if (!link) return link;
    if (/^(https?:)?\/\//.test(link) || link.startsWith('/')) return link;
    const L = window.NJW_LEGACY;
    const m = /^((?:\.\.\/)*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(link);
    if (!L || !m) return link;
    const name = m[2].replace(/^console\//, '');
    const key = m[1] || /^\d\d-/.test(name) ? name : 'console/' + name;
    const to = L.map[key] || L.map[name];
    if (!to) return name + (m[3] || '') + (m[4] || '');
    return L.join(to, m[3] || '', m[4] || '');
  }

  /* ================= hubs ================= */

  let SITE = null, ALL = false, OPTS = {};
  const SITE_HANDLERS = [];
  /* The old warehouse ("hub" site type, the CWH) is out of the first build:
     the picker lists the dark stores, which the floor calls hubs. */
  function visibleSites() {
    const all = (ME && ME.sites) || [];
    const ds = all.filter((s) => s.site_type !== 'hub');
    return ds.length ? ds : all;
  }
  const shortCode = (code) => { const p = String(code || '').split('-'); return p.length > 1 ? p[p.length - 1] : String(code || ''); };
  const siteLabel = (s) => (s ? shortCode(s.code) + (s.name ? ' · ' + s.name : '') + (s.is_training ? ' · LATIHAN' : '') : t('Semua hub', 'All hubs'));
  function pickSite() {
    let saved = store.get('njw.site');
    if (!saved) { try { saved = JSON.parse(sessionStorage.getItem('njw.site')); } catch (e) { saved = null; } }
    const sites = visibleSites();
    if (saved === 'all' && OPTS.allSites && sites.length > 1) return { site: null, all: true };
    const s = sites.find((x) => String(x.id) === String(saved)) ||
      sites.find((x) => x.id === ME.default_site_id) || sites[0] || null;
    return { site: s, all: false };
  }
  function chooseSite(v) {
    store.set('njw.site', v === 'all' ? 'all' : String(v));
    try { sessionStorage.setItem('njw.site', JSON.stringify(v === 'all' ? null : +v)); } catch (e) { /* none */ }
    try { sessionStorage.removeItem('njw.todoCount'); } catch (e) { /* none */ }
    if (!SITE_HANDLERS.length) { location.reload(); return; }
    const p = pickSite();
    SITE = p.site; ALL = p.all; NJW.site = SITE;
    paintUser(); paintBanners(); refreshCount(true); paintLink();
    SITE_HANDLERS.forEach((fn) => { try { fn(SITE, ALL); } catch (e) { fail(e); } });
  }
  function hubSelectHtml(id) {
    const sites = visibleSites();
    if (sites.length < 2 && !(OPTS.allSites && sites.length > 1)) {
      return '<span class="k-hubsel" style="display:inline-flex;align-items:center;border:0;padding:0" id="' + id + '">' + esc(siteLabel(SITE)) + '</span>';
    }
    return '<select class="k-hubsel" id="' + id + '" aria-label="Hub">' +
      (OPTS.allSites ? '<option value="all"' + (ALL ? ' selected' : '') + ' ' + biAttr('Semua hub', 'All hubs') + '>' + esc(t('Semua hub', 'All hubs')) + '</option>' : '') +
      sites.map((s) => '<option value="' + s.id + '"' + (SITE && s.id === SITE.id ? ' selected' : '') + '>' + esc(siteLabel(s)) + '</option>').join('') +
      '</select>';
  }

  /* ================= frame ================= */

  let CUR_TITLE = null;
  function navHtml(sheet) {
    return MENU.map((g) => '<nav class="k-nav" aria-label="' + esc(g.group ? g.group[0] : 'Menu') + '">' +
      (g.group ? '<span class="k-nav__group" ' + biAttr(g.group[0], g.group[1]) + '>' + esc(t(g.group[0], g.group[1])) + '</span>' : '') +
      g.items.map((it) => '<a class="k-nav__link' + (it.badge ? ' k-nav__link--top' : '') + '" href="' + itemHref(it) + '" data-page="' + it.page + '"' +
        (it.tab ? ' data-tab="' + it.tab + '"' : '') + '>' + icon(it.icon, sheet ? 22 : 20) +
        '<span class="k-nav__label" ' + biAttr(it.id, it.en) + '>' + esc(t(it.id, it.en)) + '</span>' +
        (it.badge ? '<span class="k-badge" data-todo-count hidden></span>' : '') + '</a>').join('') +
      '</nav>').join('');
  }

  function renderFrame() {
    const body = document.body;
    body.classList.add('k-body');
    // Whatever the page wrote in <body> (besides scripts) becomes its content.
    const keep = Array.from(body.childNodes).filter((n) => !(n.nodeType === 1 && n.tagName === 'SCRIPT'));
    const frame = document.createElement('div');
    frame.className = 'k-app';
    frame.innerHTML =
      '<aside class="k-side" aria-label="Menu">' +
        '<div class="k-brand"><span class="k-brand__mark">NINJA</span><span class="k-brand__name">SatSet WMS</span></div>' +
        navHtml(false) +
        '<div class="k-usercard" id="k-usercard"></div>' +
      '</aside>' +
      '<div class="k-main">' +
        '<header class="k-phead">' +
          '<button type="button" class="k-iconbtn" id="k-menubtn" data-aria-id="Buka menu" data-aria-en="Open the menu" aria-label="Buka menu">' + icon('menu', 26) + '</button>' +
          '<div class="k-phead__text"><span class="k-phead__line" id="k-pline"></span><span class="k-phead__title" id="k-ptitle"></span></div>' +
          '<a class="k-todopill" id="k-ptodo" href="perlu-tindakan.html" hidden>' + icon('bell', 16, 2.4) + '<span data-todo-count></span></a>' +
        '</header>' +
        '<header class="k-top">' +
          '<label class="k-top__label" for="k-hub" ' + biAttr('Hub', 'Hub') + '>Hub</label><span id="k-hubslot"></span>' +
          '<span class="k-grow"></span>' +
          '<span id="k-linkpill"></span>' +
          '<span class="k-top__clock" id="k-clock"></span>' +
        '</header>' +
        '<div id="k-banners"></div>' +
        '<main class="k-content" id="k-content">' +
          '<div class="k-pagehead"><div class="k-pagehead__text"><h1 class="k-pagehead__title" id="k-title"></h1>' +
          '<p class="k-pagehead__sub" id="k-sub" hidden></p></div><div class="k-pagehead__actions" id="k-actions"></div></div>' +
          '<nav class="k-tabs" role="tablist" id="k-tabs" hidden></nav>' +
          '<div id="k-body"></div>' +
        '</main>' +
      '</div>';
    body.insertBefore(frame, body.firstChild);
    const host = $('#k-body', frame);
    keep.forEach((n) => host.appendChild(n));
    HAS_STATIC = keep.some((n) => (n.nodeType === 1) || (n.nodeType === 3 && n.textContent.trim()));
    const toasts = document.createElement('div');
    toasts.className = 'k-toasts';
    toasts.setAttribute('aria-live', 'polite');
    body.appendChild(toasts);
    $('#k-menubtn').addEventListener('click', () => (FULL ? FULL.back() : openSheet()));
  }
  let HAS_STATIC = false;

  function setTitle(id, en) {
    CUR_TITLE = pair(id).length && en !== undefined ? [id, en] : pair(id);
    const [a, b] = CUR_TITLE;
    bi($('#k-title'), a, b);
    if (!FULL) bi($('#k-ptitle'), a, b);
    document.title = t(a, b) + ' · SatSet WMS';
  }
  function setSub(id, en) {
    const el = $('#k-sub');
    if (!id) { el.hidden = true; return; }
    el.hidden = false;
    bi(el, id, en);
  }

  function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function paintUser() {
    const r = roleName(ME.role);
    const code = SITE ? shortCode(SITE.code) : t('Semua hub', 'All hubs');
    $('#k-usercard').innerHTML =
      '<div class="k-usercard__who"><span class="k-avatar k-avatar--' + (ROLE_CHIP[ME.role] || 'head') + '">' + esc(initials(ME.name)) + '</span>' +
      '<div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="k-usercard__name">' + esc(ME.name) + '</span>' +
      '<span class="k-usercard__role"><span ' + biAttr(r[0], r[1]) + '>' + esc(t(r[0], r[1])) + '</span> · ' + esc(code) + '</span></div></div>' +
      '<div class="k-usercard__tools"><button type="button" class="k-navbtn" data-lang-toggle>ID</button>' +
      '<a class="k-navbtn" href="' + NJW.shell.SIGN_OUT + '">' + icon('out', 16) + '<span ' + biAttr('Keluar', 'Sign out') + '>Keluar</span></a></div>';
    $('#k-pline').innerHTML = esc(code) + ' · ' + esc(String(ME.name || '').split(' ')[0]) + ' · <span ' + biAttr(r[0], r[1]) + '>' + esc(t(r[0], r[1])) + '</span>';
    $('#k-hubslot').innerHTML = hubSelectHtml('k-hub');
    const sel = $('#k-hub');
    if (sel && sel.tagName === 'SELECT') sel.addEventListener('change', () => chooseSite(sel.value));
    applyLang($('#k-usercard'));
  }

  /* ---- phone menu sheet (board 1c) ---- */
  let SHEET = null;
  function openSheet() {
    if (!ME) return;
    if (SHEET) SHEET.remove();
    const r = roleName(ME.role);
    SHEET = document.createElement('div');
    SHEET.className = 'k-sheet';
    SHEET.setAttribute('role', 'dialog');
    SHEET.setAttribute('aria-modal', 'true');
    SHEET.setAttribute('aria-label', 'Menu');
    SHEET.innerHTML =
      '<div class="k-sheet__head"><div class="k-brand"><span class="k-brand__mark">NINJA</span><span class="k-brand__name">SatSet WMS</span></div>' +
      '<button type="button" class="k-iconbtn k-sheet__close" data-close ' + 'data-aria-id="Tutup menu" data-aria-en="Close the menu" aria-label="Tutup menu">' + icon('close', 24, 2.2) + '</button></div>' +
      '<div class="k-sheet__user"><span class="k-avatar k-avatar--' + (ROLE_CHIP[ME.role] || 'head') + '">' + esc(initials(ME.name)) + '</span>' +
      '<div class="k-sheet__who"><span class="k-sheet__name">' + esc(ME.name) + '</span><span class="k-sheet__role"><span ' + biAttr(r[0], r[1]) + '></span> · Hub ' +
      esc(SITE ? shortCode(SITE.code) : t('semua', 'all')) + '</span></div>' +
      '<button type="button" class="k-navbtn" data-lang-toggle style="height:40px">ID</button>' +
      '<a class="k-navbtn" style="height:40px" href="' + NJW.shell.SIGN_OUT + '"><span ' + biAttr('Keluar', 'Sign out') + '></span></a></div>' +
      (visibleSites().length > 1 ? '<div class="k-sheet__hub"><label for="k-hub2">Hub</label>' + hubSelectHtml('k-hub2') + '</div>' : '') +
      navHtml(true);
    document.body.appendChild(SHEET);
    document.body.style.overflow = 'hidden';
    markCurrent(SHEET);
    paintCountInto(SHEET);
    applyLang(SHEET);
    const sel = $('#k-hub2', SHEET);
    if (sel && sel.tagName === 'SELECT') sel.addEventListener('change', () => { closeSheet(); chooseSite(sel.value); });
    $('[data-close]', SHEET).addEventListener('click', closeSheet);
    SHEET.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    $('[data-close]', SHEET).focus();
  }
  function closeSheet() {
    if (!SHEET) return;
    SHEET.remove(); SHEET = null;
    document.body.style.overflow = '';
    $('#k-menubtn').focus();
  }

  function markCurrent(root) {
    const tab = currentTab();
    $$('.k-nav__link', root).forEach((a) => {
      const on = a.dataset.page === OPTS.page &&
        (a.dataset.tab ? a.dataset.tab === tab : !MENU.some((g) => g.items.some((it) => it.page === OPTS.page && it.tab && it.tab === tab)));
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* ---- banners: training site, superadmin view-as ---- */
  function paintBanners() {
    const host = $('#k-banners');
    let h = '';
    if (ME.real_role === 'superadmin') {
      const opts = ['', 'ops_head', 'hq', 'supervisor', 'hub_operator', 'staff'].map((k) =>
        '<option value="' + k + '"' + ((ME.viewing_as || '') === k ? ' selected' : '') + '>' +
        esc(k ? t(roleName(k)[0], roleName(k)[1]) : t('Superadmin (diri sendiri)', 'Superadmin (yourself)')) + '</option>').join('');
      h += '<div class="k-banner ' + (ME.viewing_as ? '' : 'k-banner--info') + '">' + icon('eye', 20) +
        '<label for="k-viewas" ' + biAttr('Lihat aplikasi sebagai', 'View the app as') + '></label>' +
        '<select id="k-viewas">' + opts + '</select>' +
        (ME.viewing_as ? bis('Mode pratinjau, hanya melihat. Semua perubahan ditolak sampai kembali ke superadmin.',
          'Preview mode, read only. Every change is refused until you switch back to superadmin.') +
          '<button type="button" class="k-btn k-btn--sm k-btn--outline" id="k-viewas-exit" ' + biAttr('Kembali ke superadmin', 'Back to superadmin') + '></button>' : '') +
        '</div>';
    } else if (store.get('njw.viewAs')) {
      store.set('njw.viewAs', null);   // only a superadmin may preview
    }
    if (SITE && SITE.is_training) {
      h += '<div class="k-banner" role="status">' + icon('warn', 20) +
        bis('MODE LATIHAN: barang tidak nyata, aman untuk salah', 'TRAINING MODE: not real stock, safe to get wrong') + '</div>';
    }
    host.innerHTML = h;
    applyLang(host);
    const sel = $('#k-viewas', host);
    if (sel) sel.addEventListener('change', () => { store.set('njw.viewAs', sel.value || null); location.reload(); });
    const ex = $('#k-viewas-exit', host);
    if (ex) ex.addEventListener('click', () => { store.set('njw.viewAs', null); location.reload(); });
  }

  /* ---- Perlu tindakan count: menu badge and the phone header pill ---- */
  let COUNTS = null;
  function paintCountInto(root) {
    const n = COUNTS ? COUNTS.total || 0 : null;
    $$('[data-todo-count]', root).forEach((el) => {
      if (n == null) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = n > 99 ? '99+' : String(n);
      if (el.classList.contains('k-badge')) el.classList.toggle('k-badge--zero', !n);
    });
    const pill = $('#k-ptodo');
    if (pill && root === document) {
      pill.hidden = n == null;
      pill.classList.toggle('k-todopill--zero', !n);
      pill.setAttribute('aria-label', t(n + ' tugas', n + ' to do'));
    }
  }
  function setCount(counts) {
    COUNTS = counts || null;
    try { sessionStorage.setItem('njw.todoCount', JSON.stringify({ at: Date.now(), key: siteKey(), counts: COUNTS })); } catch (e) { /* none */ }
    paintCountInto(document);
  }
  const siteKey = () => (ME ? ME.role + ':' : '') + (SITE ? String(SITE.id) : 'all');
  async function refreshCount(force) {
    if (!force) {
      try {
        const hit = JSON.parse(sessionStorage.getItem('njw.todoCount') || 'null');
        if (hit && hit.key === siteKey() && Date.now() - hit.at < 120000) { COUNTS = hit.counts; paintCountInto(document); return; }
      } catch (e) { /* no cache */ }
    }
    try {
      const r = await raw().get('/todo' + raw().qs({ site_id: SITE ? SITE.id : null }));
      setCount(r.counts);
    } catch (e) { /* the badge is a nicety */ }
  }

  /* ---- Hiryu link status pill (laptop top bar, SPV and above) ---- */
  async function paintLink() {
    const host = $('#k-linkpill');
    if (!host) return;
    host.innerHTML = '';
    if (!atLeast('supervisor')) return;
    let s = null;
    const key = 'njw.linkStatus.' + siteKey();
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (hit && Date.now() - hit.at < 120000) s = hit.s;
    } catch (e) { /* none */ }
    if (!s) {
      try {
        const r = await raw().get('/hiryu-link/status' + raw().qs({ site_id: SITE ? SITE.id : null }));
        s = { live: !!r.live, sending: !!r.sending, failed: (r.failures || []).length,
          late: (r.oldest_pending_seconds || 0) > (r.wait_alert_minutes || 5) * 60 };
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), s }));
      } catch (e) { return; }
    }
    let p;
    if (!s.live) p = ['', 'Sambungan Hiryu belum aktif', 'Hiryu link not on yet'];
    else if (s.failed) p = ['stop', 'Hiryu: ada pesan gagal', 'Hiryu: messages failed'];
    else if (s.late || !s.sending) p = ['caution', 'Hiryu: pesan menunggu', 'Hiryu: messages waiting'];
    else p = ['ok', 'Tersambung ke Hiryu', 'Connected to Hiryu'];
    host.innerHTML = '<a href="pengaturan.html?tab=integrasi" style="text-decoration:none">' + pill(p[0], p[1], p[2]) + '</a>';
  }

  /* ---- clock (WIB) ---- */
  function paintClock() {
    const el = $('#k-clock');
    if (!el) return;
    el.textContent = fmt.day(new Date()) + ' · ' + fmt.time(new Date());
  }

  /* ================= views: page and tabs ================= */

  let PAGE_FN = null;
  const TAB_FNS = {};
  let TIMERS = [];
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = src + (VER ? (src.includes('?') ? '&' : '?') + 'v=' + VER : '');
      s.onload = () => ok(true);
      s.onerror = () => bad(new Error('missing ' + src));
      document.body.appendChild(s);
    });
    return loaded[src];
  }
  const param = (k) => new URLSearchParams(location.search).get(k);
  function currentTab() {
    if (!OPTS.tabs || !OPTS.tabs.length) return null;
    const q = param('tab');
    return OPTS.tabs.some((x) => x.id === q) ? q : OPTS.tabs[0].id;
  }
  function paintTabs(tab) {
    const nav = $('#k-tabs');
    if (!OPTS.tabs || !OPTS.tabs.length) { nav.hidden = true; return; }
    nav.hidden = false;
    nav.innerHTML = OPTS.tabs.map((x) => {
      const l = pair(x.label);
      return '<button type="button" class="k-tab" role="tab" data-tab="' + esc(x.id) + '" aria-selected="' + (x.id === tab) + '">' +
        '<span ' + biAttr(l[0], l[1]) + '>' + esc(t(l[0], l[1])) + '</span><span class="k-tab__count" data-tab-count hidden></span></button>';
    }).join('');
    $$('.k-tab', nav).forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  }
  function setTab(id) {
    const u = new URL(location.href);
    u.searchParams.set('tab', id);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
    render();
  }
  function tabCount(id, n, kind) {
    const el = $('#k-tabs .k-tab[data-tab="' + id + '"] [data-tab-count]');
    if (!el) return;
    el.hidden = n == null || n === '';
    el.textContent = n == null ? '' : String(n);
    el.classList.toggle('k-tab__count--caution', kind === 'caution');
  }
  const soonHtml = () =>
    '<div class="k-card k-soon">' +
      '<span class="k-empty__icon k-empty__icon--muted">' + icon('clock', 28) + '</span>' +
      '<span class="k-empty__title" ' + biAttr('Segera hadir', 'Coming soon') + '></span>' +
      '<span class="k-empty__text" ' + biAttr('Layar ini sedang dibuat. Untuk sekarang, lihat Panduan untuk cara kerjanya.',
        'This screen is being built. For now, see the Guide for how the process works.') + '></span>' +
      '<a class="k-btn k-btn--secondary" href="panduan.html">' + icon('book') + '<span ' + biAttr('Buka Panduan', 'Open the Guide') + '></span></a>' +
    '</div>';

  function ctxFor(tab, body) {
    return {
      me: ME, site: SITE, siteId: SITE ? SITE.id : null, allSites: ALL, tab, body,
      params: new URLSearchParams(location.search), actions: $('#k-actions'),
      every(ms, fn) { const id = setInterval(fn, ms); TIMERS.push(id); return id; },
    };
  }
  let RENDERING = 0;
  async function render() {
    const my = ++RENDERING;
    TIMERS.forEach(clearInterval); TIMERS = [];
    const tab = currentTab();
    paintTabs(tab);
    markCurrent(document);
    const body = $('#k-body');
    if (tab) { body.innerHTML = ''; $('#k-actions').innerHTML = ''; }
    let fn = tab ? TAB_FNS[tab] : null;
    const def = tab ? OPTS.tabs.find((x) => x.id === tab) : null;
    if (!fn && def && def.script) {
      try { await loadScript(def.script); } catch (e) { /* not built yet */ }
      if (my !== RENDERING) return;
      fn = TAB_FNS[tab];
    }
    fn = fn || PAGE_FN;
    if (!fn) {
      if (tab || !HAS_STATIC) body.innerHTML = soonHtml();
      applyLang(body);
      return;
    }
    try { await fn(ctxFor(tab, body)); } catch (e) { fail(e); }
    applyLang(body);
    lockAll(body);
    lockAll($('#k-actions'));
  }

  /* ================= boot ================= */

  let READY_OK;
  const READY = new Promise((ok) => { READY_OK = ok; });

  async function init(opts) {
    OPTS = Object.assign({ script: undefined, allSites: false }, opts || {});
    renderFrame();
    setTitle(pair(OPTS.title || OPTS.page)[0], pair(OPTS.title || OPTS.page)[1]);
    if (OPTS.sub) setSub(pair(OPTS.sub)[0], pair(OPTS.sub)[1]);
    if (OPTS.fullScreen) fullScreen(true, { title: OPTS.title, onBack: OPTS.onBack });
    applyLang(document);
    document.addEventListener('click', (e) => { if (e.target.closest('[data-lang-toggle]')) setLang(lang() === 'en' ? 'id' : 'en'); });
    try {
      ME = await raw().get('/me');
    } catch (e) {
      signedOut(e);
      return null;
    }
    NJW.me = ME;
    const p = pickSite();
    SITE = p.site; ALL = p.all; NJW.site = SITE;
    paintUser();
    paintBanners();
    paintClock();
    setInterval(paintClock, 30000);
    refreshCount(false);
    paintLink();
    applyLang(document);
    markCurrent(document);
    const ctx = ctxFor(currentTab(), $('#k-body'));
    READY_OK(ctx);
    if (OPTS.script !== false) {
      try { await loadScript(OPTS.script || ('js/' + OPTS.page + '.js')); } catch (e) { /* not built yet: Segera hadir */ }
    }
    await render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
    return ctx;
  }

  function signedOut(e) {
    const body = $('#k-body');
    const forbidden = e && e.status === 403;
    body.innerHTML = '<div class="k-card k-soon">' +
      '<span class="k-empty__icon k-empty__icon--muted">' + icon('lock', 28) + '</span>' +
      (forbidden
        ? '<span class="k-empty__title" ' + biAttr('Akun ini belum bisa masuk', 'This account cannot sign in yet') + '></span>' +
          '<span class="k-empty__text">' + esc(pick(e.message) || '') + '</span>'
        : '<span class="k-empty__title" ' + biAttr('Masuk dulu', 'Sign in first') + '></span>' +
          '<span class="k-empty__text" ' + biAttr('Masuk dengan akun Google @ninjavan.co Anda, lalu coba lagi.',
            'Sign in with your @ninjavan.co Google account, then try again.') + '></span>') +
      '<button type="button" class="k-btn k-btn--primary" onclick="location.reload()">' + icon('refresh') +
      '<span ' + biAttr('Coba lagi', 'Try again') + '></span></button></div>';
    applyLang(body);
  }

  /* ================= errors and toasts ================= */

  function toast(text, kind, ms) {
    const host = $('.k-toasts') || document.body;
    const p = Array.isArray(text) ? t(text[0], text[1]) : pick(text);
    const el = document.createElement('div');
    el.className = 'k-toast' + (kind ? ' k-toast--' + kind : '');
    el.setAttribute('role', kind === 'stop' ? 'alert' : 'status');
    el.innerHTML = icon(kind === 'ok' ? 'check' : kind === 'stop' || kind === 'caution' ? 'warn' : 'info', 20) + '<span></span>';
    el.lastChild.textContent = p;
    host.appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'stop' ? 6000 : 3600));
    return el;
  }
  function fail(e) {
    if (e && e.status === 401) { signedOut(e); return; }
    toast((e && e.message) || ['Ada masalah. Panggil supervisor.', 'Something went wrong. Call your supervisor.'], 'stop');
    if (window.console) console.error(e);
  }

  /* ================= role lock ================= */

  function lock(el, minRole) {
    if (typeof el === 'string') el = $(el);
    if (!el || !minRole || atLeast(minRole)) return false;
    if (el.dataset.locked) return true;
    el.dataset.locked = '1';
    el.classList.add('is-locked');
    el.setAttribute('aria-disabled', 'true');
    if ('disabled' in el) el.disabled = true;
    if (el.tagName === 'A') el.removeAttribute('href');
    el.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); }, true);
    const first = el.firstElementChild;
    if (first && first.tagName.toLowerCase() === 'svg') first.remove();
    el.insertAdjacentHTML('afterbegin', icon('lock', el.classList.contains('k-btn--lg') ? 22 : 16, 2.2));
    const who = LOCK_WHO[minRole] || ['Tidak untuk peran Anda', 'Not for your role'];
    el.title = t(who[0], who[1]);
    const wrap = document.createElement('span');
    wrap.className = 'k-lockwrap' + (el.classList.contains('k-btn--block') || el.classList.contains('k-btn--lg') ? ' k-lockwrap--block' : '');
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    wrap.insertAdjacentHTML('beforeend', '<span class="k-lock__who" ' + biAttr(who[0], who[1]) + '>' + esc(t(who[0], who[1])) + '</span>');
    return true;
  }
  const lockAll = (root) => $$('[data-min-role]', root || document).forEach((el) => lock(el, el.dataset.minRole));

  /* ================= overlays: modal, confirm, drawer ================= */

  function overlay(kind, o) {
    o = o || {};
    const scrim = document.createElement('div');
    scrim.className = 'k-scrim k-scrim--' + kind;
    const box = document.createElement('div');
    box.className = kind === 'drawer' ? 'k-drawer' : 'k-modal' + (o.wide ? ' k-modal--wide' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const title = pair(o.title || '');
    box.innerHTML = '<div class="k-modal__head"><h2 class="k-modal__title" ' + biAttr(title[0], title[1]) + '></h2>' +
      '<button type="button" class="k-modal__close" data-aria-id="Tutup" data-aria-en="Close" aria-label="Tutup">' + icon('close', 22) + '</button></div>' +
      '<div class="k-modal__body"></div>' + ((o.actions || []).length ? '<div class="k-modal__foot"></div>' : '');
    const bodyEl = $('.k-modal__body', box);
    if (o.body instanceof Node) bodyEl.appendChild(o.body); else bodyEl.innerHTML = o.body || '';
    scrim.appendChild(box);
    document.body.appendChild(scrim);
    const prevFocus = document.activeElement;
    let closed = false;
    const close = (v) => {
      if (closed) return;
      closed = true;
      scrim.remove();
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* gone */ }
      if (o.onClose) o.onClose(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && o.dismissible !== false) close(false); };
    document.addEventListener('keydown', onKey);
    $('.k-modal__close', box).addEventListener('click', () => close(false));
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && o.dismissible !== false) close(false); });
    const foot = $('.k-modal__foot', box);
    (o.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'k-btn k-btn--' + (a.kind || 'secondary');
      const l = pair(a.label);
      b.innerHTML = (a.icon ? icon(a.icon) : '') + '<span ' + biAttr(l[0], l[1]) + '>' + esc(t(l[0], l[1])) + '</span>';
      b.addEventListener('click', async () => {
        if (!a.onClick) { close(a.value); return; }
        b.disabled = true;
        try { const r = await a.onClick(close, b); if (r !== false) close(a.value); }
        catch (e) { fail(e); }
        finally { b.disabled = false; }
      });
      foot.appendChild(b);
      if (a.minRole) lock(b, a.minRole);
    });
    applyLang(box);
    lockAll(box);
    const f = $('input, select, textarea', bodyEl) || $('.k-modal__foot .k-btn--primary, .k-modal__foot .k-btn--danger', box) || $('.k-modal__close', box);
    if (f) f.focus();
    return { el: box, body: bodyEl, close };
  }
  const modal = (o) => overlay('modal', o);
  const drawer = (o) => overlay('drawer', o);
  function confirmBox(o) {
    o = o || {};
    return new Promise((ok) => {
      const text = pair(o.text || '');
      overlay('modal', {
        title: o.title || ['Yakin?', 'Are you sure?'],
        body: o.body || ('<p class="k-p" ' + biAttr(text[0], text[1]) + '></p>'),
        actions: [
          { label: o.cancel || ['Batal', 'Cancel'], kind: 'secondary', value: false },
          { label: o.ok || ['Ya, lanjut', 'Yes, go ahead'], kind: o.danger ? 'danger' : 'primary', value: true },
        ],
        onClose: (v) => ok(!!v),
      });
    });
  }

  /* ================= small widgets ================= */

  const pill = (kind, id, en) => '<span class="k-pill' + (kind ? ' k-pill--' + kind : '') + '"><span class="k-pill__dot"></span><span ' +
    biAttr(id, en) + '>' + esc(t(id, en)) + '</span></span>';
  const sysChip = (name) => '<span class="k-sys k-sys--' + esc(String(name).toLowerCase().split(/[\s/]/)[0]) + '">' + esc(name) + '</span>';

  function toggle(btn, onChange) {
    btn.setAttribute('role', 'switch');
    if (!btn.hasAttribute('aria-checked')) btn.setAttribute('aria-checked', 'false');
    btn.classList.add('k-switch');
    btn.addEventListener('click', async () => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      if (onChange) {
        try { if ((await onChange(next)) === false) btn.setAttribute('aria-checked', String(!next)); }
        catch (e) { btn.setAttribute('aria-checked', String(!next)); fail(e); }
      }
    });
    return { get: () => btn.getAttribute('aria-checked') === 'true', set: (v) => btn.setAttribute('aria-checked', String(!!v)) };
  }

  function stepper(el, o) {
    o = Object.assign({ value: 0, min: 0, max: Infinity, step: 1 }, o || {});
    el.classList.add('k-stepper');
    el.innerHTML = '<button type="button" class="k-stepper__btn" data-d="-1" data-aria-id="Kurangi" data-aria-en="Less" aria-label="Kurangi">' + icon('minus', 22, 2.4) + '</button>' +
      '<input class="k-stepper__val" type="number" inputmode="numeric" aria-label="' + esc(t(...pair(o.label || ['Jumlah', 'Quantity']))) + '">' +
      '<button type="button" class="k-stepper__btn" data-d="1" data-aria-id="Tambah" data-aria-en="More" aria-label="Tambah">' + icon('plus', 22, 2.4) + '</button>';
    const input = $('input', el);
    const clamp = (v) => Math.max(o.min, Math.min(o.max, isNaN(v) ? o.min : v));
    const paint = (v) => {
      input.value = String(v);
      $('[data-d="-1"]', el).disabled = v <= o.min;
      $('[data-d="1"]', el).disabled = v >= o.max;
    };
    let val = clamp(+o.value);
    const set = (v, quiet) => { val = clamp(+v); paint(val); if (!quiet && o.onChange) o.onChange(val); };
    $$('.k-stepper__btn', el).forEach((b) => b.addEventListener('click', () => set(val + (+b.dataset.d) * o.step)));
    input.addEventListener('change', () => set(parseInt(input.value, 10)));
    paint(val);
    return { get: () => val, set: (v) => set(v, true), input };
  }

  function stopwatch(el, startIso, o) {
    o = o || {};
    const start = startIso ? NJW.toDate(startIso) : new Date();
    el.innerHTML = '<span class="k-watch">' + (o.label === false ? '' : '<span class="k-watch__label" ' + biAttr('Waktu kerja', 'Work time') + '>' + esc(t('Waktu kerja', 'Work time')) + '</span>') +
      '<span class="k-watch__time" role="timer">' + icon('clock', 18, 2.2) + '<span>00:00</span></span></span>';
    const box = $('.k-watch', el), out = $('.k-watch__time span', el);
    let stopped = null;
    const secs = () => Math.max(0, Math.floor(((stopped || new Date()) - start) / 1000));
    const tick = () => {
      const s = secs();
      out.textContent = fmt.dur(s);
      box.classList.toggle('is-late', !!o.lateAfter && s >= o.lateAfter);
    };
    tick();
    const id = setInterval(tick, 1000);
    return {
      el: box, seconds: secs,
      stop() { stopped = new Date(); clearInterval(id); tick(); box.classList.add('is-stopped'); return secs(); },
    };
  }

  /* Scanner: a hardware gun (keyboard wedge, always listening), the phone
     camera, and "Ketik kode" as the last resort. All three call handler. */
  function scan(handler, o) {
    o = o || {};
    if (typeof o === 'string' || Array.isArray(o)) o = { title: o };
    const title = pair(o.title || ['Pindai barcode', 'Scan the barcode']);
    const el = document.createElement('div');
    const cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    el.className = 'k-stack k-stack--tight';
    el.innerHTML =
      '<div class="k-scan" data-no-tools aria-live="polite">' +
        '<span class="k-scan__icon">' + icon('scan', 32) + '</span>' +
        '<span class="k-scan__text"><span class="k-scan__title scanzone__prompt" ' + biAttr(title[0], title[1]) + '>' + esc(t(title[0], title[1])) + '</span>' +
        '<span class="k-scan__state scanzone__state"></span>' +
        '<span class="k-scan__tools"><button type="button" class="k-linkbtn" data-type ' + biAttr('Ketik kode', 'Type the code') + '>' + esc(t('Ketik kode', 'Type the code')) + '</button></span></span>' +
        (cam && o.camera !== false ? '<button type="button" class="k-btn k-btn--secondary k-btn--sm k-scan__cam" data-cam>' + icon('camera', 20) + '<span ' + biAttr('Kamera', 'Camera') + '>' + esc(t('Kamera', 'Camera')) + '</span></button>' : '') +
        '<input class="scanzone__input k-scan__input" tabindex="-1">' +
      '</div>' +
      '<form class="k-scan__form" hidden><label class="k-sr" for="k-type-' + (++SCANS) + '" ' + biAttr('Kode', 'Code') + '>Kode</label>' +
        '<input class="k-input" id="k-type-' + SCANS + '" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text">' +
        '<button type="submit" class="k-btn k-btn--primary">OK</button></form>';
    if (o.mount) (typeof o.mount === 'string' ? $(o.mount) : o.mount).appendChild(el);
    const zoneEl = $('.k-scan', el);
    const zone = new window.ScanZone(zoneEl, { minLength: o.minLength || 3 });
    const api = {
      el, zone,
      accept: (id, en) => zone.accept(Array.isArray(id) ? t(id[0], id[1]) : id, en),
      reject: (id, en) => zone.reject(Array.isArray(id) ? t(id[0], id[1]) : id, en),
      rest: () => zone.rest(),
      focus: () => zone.focus(),
      setTitle(id, en) { const s = $('.k-scan__title', zoneEl); bi(s, id, en); zone.restingPrompt = s.textContent; },
      openCamera: () => zone.openCamera(),
      emit: (code) => zone._emit(String(code)),
    };
    zone.onScan((code) => handler(code, api));
    const form = $('form', el), input = $('input', form);
    $('[data-type]', el).addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus(); else zone.focus();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = input.value.trim();
      input.value = '';
      if (code) zone._emit(code);
    });
    const camBtn = $('[data-cam]', el);
    if (camBtn) camBtn.addEventListener('click', () => zone.openCamera());
    return api;
  }
  let SCANS = 0;

  /* Full screen for a scanning step on the phone: the menu button becomes a
     back button and the sidebar, tabs and page header step aside. */
  let FULL = null;
  function fullScreen(on, o) {
    o = o || {};
    const btn = $('#k-menubtn');
    if (on) {
      FULL = { back: () => (o.onBack ? o.onBack() : fullScreen(false)) };
      document.body.classList.add('is-full');
      btn.innerHTML = icon('back', 26, 2.4);
      btn.dataset.ariaId = 'Kembali'; btn.dataset.ariaEn = 'Back';
      btn.setAttribute('aria-label', t('Kembali', 'Back'));
      if (o.title) { const p = pair(o.title); bi($('#k-ptitle'), p[0], p[1]); }
    } else {
      FULL = null;
      document.body.classList.remove('is-full');
      btn.innerHTML = icon('menu', 26);
      btn.dataset.ariaId = 'Buka menu'; btn.dataset.ariaEn = 'Open the menu';
      btn.setAttribute('aria-label', t('Buka menu', 'Open the menu'));
      if (CUR_TITLE) bi($('#k-ptitle'), CUR_TITLE[0], CUR_TITLE[1]);
    }
  }

  /* ================= formatting (WIB, Indonesian numbers) ================= */

  const TZ = 'Asia/Jakarta';
  const loc = () => (lang() === 'en' ? 'en-GB' : 'id-ID');
  const D = (iso) => (iso == null || iso === '' ? null : NJW.toDate(iso));
  const dateOnly = (iso) => typeof iso === 'string' && iso.length <= 10;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = {
    n: (v) => (v == null || v === '' || isNaN(v) ? '-' : Number(v).toLocaleString('id-ID')),
    rp: (v) => (v == null || v === '' || isNaN(v) ? '-' : 'Rp ' + Number(v).toLocaleString('id-ID')),
    pct: (v, d) => (v == null || isNaN(v) ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d == null ? 1 : d }) + '%'),
    date(iso) {
      const d = D(iso); if (!d) return '-';
      return d.toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly(iso) ? undefined : TZ });
    },
    day(iso) {
      const d = D(iso); if (!d) return '-';
      return d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'short', timeZone: dateOnly(iso) ? undefined : TZ }).replace(',', '');
    },
    time(iso) {
      const d = D(iso); if (!d) return '-';
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
    },
    dt(iso) { const d = D(iso); return d ? fmt.date(iso).replace(/ \d{4}$/, '') + ' ' + fmt.time(iso) : '-'; },
    wib(iso) { const d = D(iso); return d ? fmt.time(iso) + ' WIB' : '-'; },
    dur(sec) {
      sec = Math.max(0, Math.round(sec || 0));
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s);
    },
    /* "24 menit", "2 jam", "3 hari": how long since, for rows and badges. */
    ago(iso) {
      const d = D(iso); if (!d) return '-';
      const m = Math.max(0, Math.round((Date.now() - d) / 60000));
      if (m < 60) return t(m + ' menit', m + ' min');
      if (m < 48 * 60) return t(Math.round(m / 60) + ' jam', Math.round(m / 60) + ' h');
      return t(Math.round(m / 1440) + ' hari', Math.round(m / 1440) + ' days');
    },
    /* A due time as [id, en, late]: "3 jam lagi" or "lewat 2 jam". */
    due(iso) {
      const d = D(iso); if (!d) return null;
      const mins = Math.round((d - Date.now()) / 60000), a = Math.abs(mins);
      const span = a < 60 ? [a + ' menit', a + ' min'] : a < 48 * 60 ? [Math.round(a / 60) + ' jam', Math.round(a / 60) + ' h'] : [Math.round(a / 1440) + ' hari', Math.round(a / 1440) + ' days'];
      return mins >= 0 ? [span[0] + ' lagi', 'in ' + span[1], false] : ['lewat ' + span[0], span[1] + ' over', true];
    },
  };

  /* ================= public surface ================= */

  NJW.shell = {
    SIGN_OUT: '/oauth2/sign_out?rd=%2F',
    MENU, ICON, init,
    ready: () => READY,
    page(fn) { PAGE_FN = fn; },
    tab(id, fn) { TAB_FNS[id] = fn; },
    rerender: () => render(),
    setTab, currentTab, tabCount, setTitle, setSub,
    me: () => ME, role: () => (ME ? ME.role : null), atLeast, roleName, roleChip,
    site: () => SITE, siteId: () => (SITE ? SITE.id : null), allSites: () => ALL, sites: visibleSites,
    siteLabel, shortCode, onSiteChange(fn) { SITE_HANDLERS.push(fn); },
    setCount, refreshCount, route, param,
    lock, lockAll, toast, say: toast, fail, modal, drawer, confirm: confirmBox,
    stopwatch, scan, stepper, toggle, fullScreen, pill, sysChip, icon,
    t, bi, bis, biAttr, esc, pick, applyLang, lang, setLang,
    fmt, api: () => raw(), go: (p) => { location.href = p; },
  };
})();
