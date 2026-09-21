/* wire.js — the shared boot for every live screen, station and console.
 *
 * It signs the person in (/api/me), picks the site, paints the chrome and the
 * training banner, then hands over to the screen's own handler in
 * js/screens/<data-screen>.js, which registers on NJW.screens. The helpers
 * those handlers share (bilingual text, toasts, error handling, flow state)
 * live here and are exposed as NJW.wire, so every screen boots, fails and
 * speaks both languages the same way.
 *
 * Handlers fill the [data-field] and [data-region] hooks the design placed and
 * build rows from the classes the mockups use, so a restyle stays a CSS job.
 *
 * Load order: api.js, scan.js (scanning screens), app.js, console.js (console),
 * wire.js, then js/screens/<name>.js.
 */
(function () {
  'use strict';

  const NJW = (window.NJW = window.NJW || {});
  const api = () => NJW.api;

  /* ---------- flow state across pages (each screen is its own document) ---- */

  const CTX = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('njw.' + k)); } catch { return null; } },
    set(k, v) { sessionStorage.setItem('njw.' + k, JSON.stringify(v)); },
    del(k) { sessionStorage.removeItem('njw.' + k); },
  };
  NJW.ctx = CTX;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const field = (f, r) => $('[data-field="' + f + '"]', r);
  const region = f => $('[data-region="' + f + '"]');
  const setF = (f, v) => { const el = field(f); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const go = p => { location.href = p; };
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  /* app.js rewrites textContent from data-id on load and on every language
     switch, so generated copy must set BOTH attributes or the EN toggle blanks
     it. data-id is the runtime source of truth, not the text node. */
  function bi(el, id, en) {
    if (!el) return;
    el.dataset.id = id;
    el.dataset.en = en || id;
    el.textContent = (localStorage.getItem('njw.lang') === 'en') ? (en || id) : id;
  }
  const biAttr = (id, en) => 'data-id="' + esc(id) + '" data-en="' + esc(en || id) + '"';

  /* app.js applies the language once on load and keeps applyLang private, so
     anything rendered afterwards would stay Indonesian for an EN reader until
     they toggled. Re-apply over whatever we just built, without touching
     app.js — data-id remains the source of truth either way. */
  function applyLangTo(root) {
    const en = localStorage.getItem('njw.lang') === 'en';
    (root || document).querySelectorAll('[data-id]').forEach(el => {
      const v = en ? (el.dataset.en || el.dataset.id) : el.dataset.id;
      if (v != null) el.textContent = v;
    });
  }

  function codeHtml(code) {
    const p = String(code || '').split('-');
    if (p.length < 3) return esc(code || '—');
    return esc(p[0]) + '-<span class="code__hl">' + esc(p[1]) + '</span>-' +
      '<span class="code__hl">' + esc(p[2]) + '</span>' + (p[3] ? '-' + esc(p[3]) : '');
  }

  function say(msg) {
    let bar = $('.wire-toast');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'wire-toast notice notice--action';
      bar.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
        'z-index:200;max-width:90vw;box-shadow:var(--sh-2,0 6px 24px rgba(0,0,0,.2))';
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    clearTimeout(say._t);
    say._t = setTimeout(() => bar.remove(), 3600);
  }

  function fail(e) {
    if (e && e.status === 401) { go(isConsole() ? '../14-terkunci.html' : '14-terkunci.html'); return; }
    say((e && e.message) || 'Ada masalah. Panggil supervisor.');
  }

  const isConsole = () => location.pathname.includes('/console/');

  /* ---------- day colour: colour + day + date, never colour alone ---------- */

  async function paintDayColour() {
    if (!region('day-color') && !field('day-name')) return;
    try {
      const { today } = await api().dayColors();
      const block = field('day-block');
      if (block) {
        block.style.background = today.hex;
        block.style.color = today.ink;
      }
      setF('day-name', today.day_id);
      setF('day-date', NJW.fmt.date(today.date));
      setF('day-wk', 'W' + today.iso_week);
      setF('day-parity', today.week_parity);
      const el = field('day-name');
      if (el) el.dataset.en = today.day_en;
      return today;
    } catch (e) { /* the slip still prints without it */ }
  }

  /* ---------- boot ---------- */

  let ME = null, SITE = null;

  async function boot() {
    try {
      ME = await api().me();
    } catch (e) {
      if (e.status === 403) {
        document.body.innerHTML =
          '<div class="banner banner--stop" style="margin:40px">' +
          '<span class="banner__icon">!</span>' + esc(e.message) + '</div>';
        return false;
      }
      go(isConsole() ? '../14-terkunci.html' : '14-terkunci.html');
      return false;
    }
    const saved = CTX.get('site');
    SITE = ME.sites.find(s => s.id === saved)
      || ME.sites.find(s => s.id === ME.default_site_id)
      || ME.sites[0];
    if (SITE) CTX.set('site', SITE.id);
    NJW.me = ME; NJW.site = SITE;

    paintChrome();
    NJW.startHeartbeat('/api/health', 20000);
    // Installable to a phone's home screen. The worker caches nothing (sw.js).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(isConsole() ? '../sw.js' : 'sw.js').catch(() => {});
    }
    return true;
  }

  function paintChrome() {
    $$('.chrome__user, [data-field="user-name"]').forEach(el => {
      el.textContent = ME.name + (SITE ? ' · ' + SITE.code : '');
    });
    setF('site-code', SITE ? SITE.code : '—');

    const mode = $('.chrome__mode');
    if (mode && !$('#siteSel') && ME.sites.length > 1 &&
        ($('.app') || {}).dataset && $('.app').dataset.screen === 'home') {
      const sel = document.createElement('select');
      sel.id = 'siteSel';
      sel.className = 'chrome__mode';
      sel.style.cssText = 'background:var(--surface);color:var(--ink);' +
        'border:1px solid var(--rule);border-radius:var(--r-sm,6px);min-height:40px;padding:0 8px';
      sel.innerHTML = ME.sites.map(s =>
        '<option value="' + s.id + '"' + (SITE && s.id === SITE.id ? ' selected' : '') + '>' +
        esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join('');
      sel.onchange = () => { CTX.set('site', +sel.value); location.reload(); };
      mode.replaceWith(sel);
    } else if (mode && !mode.dataset.keep) {
      // Through bi(): a bare textContent left the design's sample data-id in
      // place, and the next language switch painted the sample back.
      bi(mode, SITE ? SITE.code : '', SITE ? SITE.code : '');
    }

    // Some screens deliberately ship no .chrome (the full-bleed stop screen),
    // so this has to place itself without one. That assumption broke in v1.
    if (SITE && SITE.is_training && !$('.wire-training') && !isConsole()) {
      const b = document.createElement('div');
      b.className = 'wire-training banner banner--caution';
      b.style.cssText = 'min-height:44px;font-size:17px;letter-spacing:.06em';
      b.innerHTML = '<span class="banner__icon" aria-hidden="true">!</span><span ' +
        biAttr('MODE LATIHAN — barang tidak nyata, aman untuk salah',
               'TRAINING MODE — not real stock, safe to get wrong') +
        '>MODE LATIHAN — barang tidak nyata, aman untuk salah</span>';
      const chrome = $('.chrome');
      if (chrome && chrome.parentNode) chrome.parentNode.insertBefore(b, chrome.nextSibling);
      else document.body.insertBefore(b, document.body.firstChild);
      applyLangTo(b);   // built after app.js applied the language
    }
  }

  async function testCodes(zoneEl, after) {
    if (!SITE || !SITE.is_training || !zoneEl) return;
    try {
      const sheet = await api().raw.get('/training/barcode-sheet?site_id=' + SITE.id + '&limit=18');
      if (!sheet.rows.length) return;
      const box = document.createElement('div');
      box.className = 'panel';
      box.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      box.innerHTML = '<span class="eyebrow" ' + biAttr('Barcode uji', 'Test barcodes') +
        '>Barcode uji</span>';
      sheet.rows.forEach(r => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn--outline';
        b.style.cssText = 'min-height:36px;padding:0 10px;font-size:13px';
        b.textContent = r.sku_name.slice(0, 20);
        b.title = r.sku_name + ' · ' + r.barcode;
        b.onclick = () => after(r.barcode);
        box.appendChild(b);
      });
      zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
    } catch { /* training-only nicety */ }
  }

  /* ---------- roles: the same ladder as auth.py ---------- */
  const RANK = { staff: 0, hub_operator: 1, supervisor: 2, hq: 3, superadmin: 4 };
  const ROLE_NAME = { superadmin: ['Superadmin', 'Superadmin'], hq: ['Ops HQ', 'Ops HQ'],
    supervisor: ['SPV', 'SPV'], hub_operator: ['Operator hub', 'Hub operator'], staff: ['Staf', 'Staff'] };

  /* A superadmin can look at the app as any other role: the same menu, the
     same screens, the same refusals. It is read-only — the server refuses any
     write while a preview is on — and a bar across the top says so. */
  function paintViewAs() {
    if (!ME) return;
    let stored = '';
    try { stored = localStorage.getItem('njw.viewAs') || ''; } catch (e) { /* no storage */ }
    if (ME.real_role !== 'superadmin') {
      if (stored) { try { localStorage.removeItem('njw.viewAs'); } catch (e) {} }
      return;
    }
    const setView = v => {
      try { v ? localStorage.setItem('njw.viewAs', v) : localStorage.removeItem('njw.viewAs'); } catch (e) {}
      // Each role lands on its own surface.
      const station = ['staff', 'hub_operator'].includes(v);
      const here = isConsole();
      if (station && here) return go('../index.html?station');
      if (!station && !here) return go('console/index.html');
      location.reload();
    };
    const bar = document.createElement('div');
    bar.className = 'wire-viewas';
    bar.style.cssText = 'position:sticky;top:0;z-index:300;display:flex;flex-wrap:wrap;gap:8px 12px;' +
      'align-items:center;padding:8px 16px;font-size:14px;background:' +
      (ME.viewing_as ? 'var(--accent-bg);color:var(--ink);border-bottom:2px solid var(--accent)' :
                       'var(--surface-2);color:var(--muted);border-bottom:1px solid var(--rule)');
    const opts = ['', 'hq', 'supervisor', 'hub_operator', 'staff'].map(k =>
      '<option value="' + k + '"' + ((ME.viewing_as || '') === k ? ' selected' : '') + '>' +
      (k ? esc(ROLE_NAME[k][0]) : 'Superadmin (' + (localStorage.getItem('njw.lang') === 'en' ? 'yourself' : 'diri sendiri') + ')') +
      '</option>').join('');
    bar.innerHTML = '<strong ' + biAttr('Lihat konsol sebagai', 'View the app as') + '></strong>' +
      '<select id="viewAsSel" aria-label="View as" style="min-height:32px;border:1px solid var(--rule-strong);' +
      'border-radius:6px;background:var(--surface);color:var(--ink);padding:0 8px">' + opts + '</select>' +
      (ME.viewing_as
        ? '<span ' + biAttr('Mode pratinjau — hanya melihat. Semua perubahan ditolak sampai kembali ke superadmin.',
            'Preview mode — read-only. Every change is refused until you switch back to superadmin.') + '></span>' +
          '<button type="button" id="viewAsExit" style="margin-left:auto;min-height:32px;padding:0 12px;border-radius:6px;' +
          'border:1px solid var(--accent);background:var(--surface);color:var(--ink);cursor:pointer" ' +
          biAttr('Kembali ke superadmin', 'Back to superadmin') + '></button>'
        : '');
    document.body.insertBefore(bar, document.body.firstChild);
    applyLangTo(bar);
    $('#viewAsSel', bar).onchange = e => setView(e.target.value);
    const exit = $('#viewAsExit', bar);
    if (exit) exit.onclick = () => setView('');
  }
  const atLeast = role => !!ME && (RANK[ME.role] || 0) >= (RANK[role] || 0);

  // A console link marked data-min-role is a screen whose every write the API
  // would refuse for this person; showing it only invites the 403.
  function gateSidebar() {
    $$('[data-min-role]').forEach(el => { el.hidden = !atLeast(el.dataset.minRole); });
    $$('.sidebar__section').forEach(sec => {
      const links = $$('.sidebar__link', sec);
      if (links.length && links.every(a => a.hidden)) sec.hidden = true;
    });
  }

  /* ---------- the reminders badge in the console sidebar ---------- */
  // Flags are computed live on the server, so the count is cached for five
  // minutes per tab; the Reminders page itself always reads fresh.
  async function paintFlagBadge() {
    const badge = field('flag-badge');
    if (!badge || !isConsole() || !atLeast('supervisor')) return;
    let c = null;
    try {
      const hit = JSON.parse(sessionStorage.getItem('njw.flagCount') || 'null');
      if (hit && Date.now() - hit.at < 5 * 60 * 1000) c = hit.counts;
    } catch (e) { /* no cache */ }
    if (!c) {
      try {
        c = (await api().flags()).counts;
        sessionStorage.setItem('njw.flagCount', JSON.stringify({ at: Date.now(), counts: c }));
      } catch (e) { return; }
    }
    const n = (c.critical || 0) + (c.warn || 0);
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('is-critical', (c.critical || 0) > 0);
  }

  /* ---------- photos: stored keys load through the API ---------- */
  // A key with a folder (sku/…, request/…) lives in object storage behind
  // sign-in; anything else is the design's placeholder convention and stays.
  function loadPhotos(root) {
    $$('img[data-photo-key]', root).forEach(img => {
      const url = api().photoUrl(img.dataset.photoKey);
      if (url && img.dataset.photoSrc !== url) {
        img.dataset.photoSrc = url;
        img.src = url;
      }
    });
  }
  function watchPhotos() {
    loadPhotos(document);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; loadPhotos(document); });
    }).observe(document.body, { subtree: true, childList: true, attributes: true,
                               attributeFilter: ['data-photo-key'] });
  }

  const screens = {};

  /* ======================= shared surface ======================= */

  /* Screen files register while the page parses; dispatch waits for
     DOMContentLoaded, so every handler is in place before it runs. */
  NJW.screens = screens;
  NJW.wire = {
    CTX, $, $$, field, region, setF, esc, go, key, bi, biAttr, applyLangTo,
    codeHtml, say, fail, isConsole, paintDayColour, testCodes, atLeast, loadPhotos,
    me: () => ME,
    site: () => SITE,
  };

  /* ======================= dispatch ======================= */

  /* The design ships plausible sample values in every hook, and a supervisor
     cannot tell a sample from a live number. Hooks stay hidden until the
     screen's first load has painted them — never longer than a few seconds,
     so a slow network shows a page rather than a blank. */
  const root = document.documentElement;
  root.classList.add('njw-loading');
  const reveal = () => root.classList.remove('njw-loading');
  setTimeout(reveal, 6000);

  window.addEventListener('DOMContentLoaded', async () => {
    const app = $('.app') || $('.shell') || $('[data-screen]');
    const name = app ? app.dataset.screen : '';
    try {
      // The stop screen is where a failed sign-in lands, so it must not sign in.
      if (name === 'blocked') return screens.blocked && await screens.blocked();
      if (!(await boot())) return;
      paintViewAs();
      gateSidebar();
      watchPhotos();
      if (name !== 'pengingat') paintFlagBadge();
      else sessionStorage.removeItem('njw.flagCount');
      const fn = screens[name];
      if (fn) { try { await fn(); } catch (e) { fail(e); } }
    } finally { reveal(); }
  });
})();
