/* console.js — desk-surface behaviour: search filter, column sort,
   bulk select, pagination, drawers, and the training gate.
   Progressive enhancement only: every screen is readable without it. */
(function () {
  'use strict';
  window.NJW = window.NJW || {};

  const rowsOf = (t) => Array.from(t.querySelectorAll('tbody tr'));

  /* ---- search: filters the table it is pointed at ------------------- */
  function wireSearch() {
    document.querySelectorAll('[data-search-for]').forEach(input => {
      const table = document.querySelector(input.dataset.searchFor);
      if (!table) return;
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        rowsOf(table).forEach(tr => {
          const hit = !q || tr.textContent.toLowerCase().includes(q);
          tr.hidden = !hit;
          if (hit) shown++;
        });
        const out = document.querySelector('[data-field="result-count"]');
        if (out) out.textContent = shown;
      });
    });
  }

  /* ---- sort: click a th, sort by its cells -------------------------- */
  function wireSort() {
    document.querySelectorAll('.dtable th.is-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const idx = Array.from(th.parentElement.children).indexOf(th);
        const numeric = th.classList.contains('td-num') || th.dataset.sort === 'num';
        const asc = !th.classList.contains('is-asc');
        th.parentElement.querySelectorAll('th').forEach(o => o.classList.remove('is-sorted', 'is-asc'));
        th.classList.add('is-sorted');
        if (asc) th.classList.add('is-asc');
        const val = tr => {
          const cell = tr.children[idx];
          const raw = cell ? (cell.dataset.sortValue ?? cell.textContent) : '';
          return numeric ? parseFloat(String(raw).replace(/[^0-9.\-]/g, '')) || 0 : String(raw).trim().toLowerCase();
        };
        rowsOf(table)
          .sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * (asc ? 1 : -1))
          .forEach(tr => tbody.appendChild(tr));
      });
    });
  }

  /* ---- bulk select -------------------------------------------------- */
  function wireBulk() {
    document.querySelectorAll('[data-bulk-table]').forEach(bar => {
      const table = document.querySelector(bar.dataset.bulkTable);
      if (!table) return;
      const all = table.querySelector('thead .checkbox');
      const boxes = () => Array.from(table.querySelectorAll('tbody .checkbox'));
      const count = bar.querySelector('[data-field="bulk-count"]');
      const sync = () => {
        const picked = boxes().filter(b => b.checked);
        picked.forEach(b => b.closest('tr').classList.add('is-selected'));
        boxes().filter(b => !b.checked).forEach(b => b.closest('tr').classList.remove('is-selected'));
        bar.classList.toggle('is-on', picked.length > 0);
        if (count) count.textContent = picked.length;
        if (all) all.checked = picked.length > 0 && picked.length === boxes().length;
      };
      if (all) all.addEventListener('change', () => { boxes().forEach(b => { b.checked = all.checked; }); sync(); });
      table.addEventListener('change', e => { if (e.target.classList.contains('checkbox')) sync(); });
      const clear = bar.querySelector('[data-action="bulk-clear"]');
      if (clear) clear.addEventListener('click', () => { boxes().forEach(b => { b.checked = false; }); if (all) all.checked = false; sync(); });
    });
  }

  /* ---- drawer ------------------------------------------------------- */
  function wireDrawer() {
    const scrim = document.querySelector('.scrim');
    const close = () => {
      // .cdialog too: a centred confirm is closed by the same shared handler
      // as a side drawer, and a broken cancel on a destructive action is the
      // worst place to find that out.
      document.querySelectorAll('.drawer.is-open, .cdialog.is-open').forEach(d => d.classList.remove('is-open'));
      if (scrim) scrim.classList.remove('is-open');
    };
    document.addEventListener('click', e => {
      const open = e.target.closest('[data-drawer-open]');
      if (open) {
        const d = document.querySelector(open.dataset.drawerOpen);
        if (d) { d.classList.add('is-open'); if (scrim) scrim.classList.add('is-open'); }
        return;
      }
      if (e.target.closest('[data-drawer-close]') || e.target === scrim) close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  /* ---- steppers (compose-order lines) ------------------------------- */
  function wireSteppers() {
    document.addEventListener('click', e => {
      const b = e.target.closest('.stepper__btn');
      if (!b) return;
      const val = b.parentElement.querySelector('.stepper__val');
      const n = parseInt(val.textContent, 10) || 0;
      val.textContent = Math.max(1, Math.min(99, n + (b.dataset.step === 'up' ? 1 : -1)));
    });
  }

  /* ---- the training gate -------------------------------------------
     A test order on a live site would consume real stock and push a wrong
     number to Grab. The API refuses it; this makes sure a user never gets
     as far as the refusal. */
  NJW.setTrainingGate = function (isTraining, siteCode) {
    document.querySelectorAll('.gate').forEach(g => {
      g.classList.toggle('is-blocked', !isTraining);
      const c = g.querySelector('[data-field="gate-site"]');
      if (c && siteCode) c.textContent = siteCode;
    });
  };

  /* ---- day colour: paint every swatch on the page from one payload -- */
  NJW.paintDayColor = function (today) {
    document.querySelectorAll('[data-region="day-color"]').forEach(el => {
      const block = el.querySelector('[data-field="day-block"]');
      if (block) { block.style.background = today.hex; block.style.color = today.ink; block.textContent = today.week_parity; }
      const day = el.querySelector('[data-field="day-name"]');
      if (day) { day.textContent = today.day_id; day.dataset.id = today.day_id; day.dataset.en = today.day_en; }
      const date = el.querySelector('[data-field="day-date"]');
      if (date) date.textContent = NJW.fmt ? NJW.fmt.date(today.date) : today.date;
      const wk = el.querySelector('[data-field="day-week"]');
      if (wk) wk.textContent = 'Minggu ' + today.week_parity + ' · W' + today.iso_week;
    });
  };

  /* ---- site-type gating -------------------------------------------
     Everyone gets the same nav — a hub user still sees Pesanan and Papan
     antrean, because hiding nav items makes the product feel broken in a
     different way. Instead those screens say plainly why they are empty
     here. A hub has no pick queue and publishes no stock; that is a fact
     about the site, not a fault. */
  NJW.HUB_NA = {
    'pesanan': ['Hub tidak mengambil pesanan pelanggan',
                'A hub does not pick customer orders',
                'Pesanan pelanggan dikerjakan darkstore. Gudang Logos menerima dari brand, membongkar, lalu mengirim tote tersegel ke darkstore — pekerjaannya ada di Transfer gudang.',
                'Customer orders are picked by the darkstores. The Logos hub receives from the brand, decants, and dispatches sealed totes — its work lives on the Transfers screen.'],
    'papan-antrean': ['Tidak ada antrean ambil di hub',
                'No pick queue at a hub',
                'Papan ini memantau pesanan pelanggan yang menunggu diambil. Hub tidak punya jam lima belas menit dan tidak punya antrean.',
                'This board watches customer orders waiting to be picked. A hub has no fifteen-minute clock and no queue.'],
    'stok-perhatian': ['Hub tidak punya rak ambil',
                'A hub has no pick faces',
                'Batas isi ulang mengukur rak ambil darkstore. Hub menyimpan stok curah dan mengirimnya lewat transfer, jadi tidak ada rak ambil yang bisa menipis.',
                'Replenishment thresholds measure a darkstore pick face. A hub holds bulk stock and moves it by transfer, so there is no face to run low.'],
    'integrasi': ['Hub tidak mengirim stok ke POS',
                'A hub does not publish stock to the POS',
                'Hanya darkstore yang menerbitkan angka stok, karena hanya stok darkstore yang bisa dijual lewat GrabMart Kilat. Stok hub tidak pernah muncul di POS.',
                'Only a darkstore publishes stock, because only darkstore stock can be sold through GrabMart Kilat. Hub stock never reaches the POS.'],
  };

  NJW.applySiteType = function (siteType, siteCode) {
    if (siteType !== 'hub') return;
    const screen = (document.querySelector('.console') || {}).dataset;
    const na = screen && NJW.HUB_NA[screen.screen];
    if (!na) return;
    const page = document.querySelector('.page');
    if (!page) return;
    Array.from(page.children).forEach(el => { if (!el.classList.contains('page__head')) el.remove(); });
    const box = document.createElement('div');
    box.className = 'notapplicable';
    box.innerHTML =
      '<span class="notapplicable__mark" aria-hidden="true">\u2014</span>' +
      '<span class="notapplicable__title" data-id="' + na[0] + '" data-en="' + na[1] + '">' + na[0] + '</span>' +
      '<span class="notapplicable__body" data-id="' + na[2] + '" data-en="' + na[3] + '">' + na[2] + '</span>' +
      '<a class="cbtn cbtn--primary" href="transfer.html" data-id="Buka Transfer gudang" data-en="Open Transfers">Buka Transfer gudang</a>';
    page.appendChild(box);
    if (NJW.applyLang) NJW.applyLang();
  };

  document.addEventListener('DOMContentLoaded', () => {
    wireSearch(); wireSort(); wireBulk(); wireDrawer(); wireSteppers();
    /* ?site=hub previews the hub view of any screen without a live API. */
    if (new URLSearchParams(location.search).get('site') === 'hub') NJW.applySiteType('hub', 'LGS');
  });
})();
