/* app.js — shell behaviour shared by every screen:
   theme, language, connection indicator, undo affordance.
   No framework, no build step. Load after scan.js. */
(function () {
  'use strict';

  const STORE = { theme: 'njw.theme', lang: 'njw.lang' };

  /* ---- theme (backroom at night vs bench by the roller door) --------- */
  const savedTheme = localStorage.getItem(STORE.theme);
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action="toggle-theme"]');
    if (!t) return;
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORE.theme, next);
  });

  /* ---- language: ID is the default, EN is one tap ---------------------
     Every string lives in the markup as data-id / data-en, so translation
     is a content job, not a code change. */
  function applyLang(lang) {
    document.documentElement.lang = lang === 'en' ? 'en' : 'id';
    document.querySelectorAll('[data-id]').forEach(el => {
      const val = lang === 'en' ? (el.dataset.en || el.dataset.id) : el.dataset.id;
      if (val != null) el.textContent = val;
    });
    document.querySelectorAll('.lang__opt').forEach(btn => {
      btn.classList.toggle('is-on', btn.dataset.lang === lang);
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
    });
    localStorage.setItem(STORE.lang, lang);
  }
  const savedLang = localStorage.getItem(STORE.lang) || 'id';
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.lang__opt');
    if (b) applyLang(b.dataset.lang);
  });

  /* ---- connection indicator: online-only app, so say so loudly ------- */
  function paintConn(online) {
    document.querySelectorAll('.conn').forEach(el => {
      el.classList.toggle('is-off', !online);
      const label = el.querySelector('.conn__label');
      if (label) label.textContent = online
        ? (label.dataset.online || 'Terhubung')
        : (label.dataset.offline || 'Tidak terhubung');
    });
  }
  window.addEventListener('online', () => paintConn(true));
  window.addEventListener('offline', () => paintConn(false));

  /* ---- heartbeat hook: replace the URL with your own /health -------- */
  window.NJW = window.NJW || {};
  window.NJW.startHeartbeat = function (url, ms) {
    setInterval(() => {
      fetch(url, { method: 'HEAD', cache: 'no-store' })
        .then(r => paintConn(r.ok)).catch(() => paintConn(false));
    }, ms || 15000);
  };

  /* ---- undo: always one tap, never a confirm dialog ------------------ */
  window.NJW.undo = { stack: [], push(entry) { this.stack.push(entry); }, pop() { return this.stack.pop(); } };

  document.addEventListener('DOMContentLoaded', () => {
    applyLang(savedLang);
    paintConn(navigator.onLine);
    // wire every scan zone on the page; screens add their own onScan handlers
    document.querySelectorAll('.scanzone').forEach(el => {
      if (!el.__zone && window.ScanZone) el.__zone = new ScanZone(el);
    });
  });
})();
