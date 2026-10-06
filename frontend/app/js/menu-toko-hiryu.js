/* menu-toko-hiryu.js: Menu & toko Hiryu (board 2e, kick-off step 8).
 *
 * Stores, menus and SKUs are made in Hiryu and arrive here by message 6. This
 * page shows them; the WMS adds only a new store's brand and Grab merchant
 * account (asked once, Ops HQ). Top to bottom:
 *
 *   1. Sinkron ulang dari Hiryu, any role, once per 5 minutes per dark store
 *      (a failed pull does not count). The WMS pulls the full catalogue from
 *      Hiryu while the button waits (up to 20 s):
 *        GET/POST /api/hiryu-link/catalogue-request
 *   2. New stores waiting for Ops HQ (yellow cards):
 *        GET  /api/catalog/brands                brands with their account
 *        POST /api/catalog/brands                Merek baru
 *        POST /api/hiryu-link/stores/{no}/assign {brand_id, grab_account}
 *   3. Toko di Hiryu: every store with its brand, menu size, Status di Hiryu
 *      (active or not, order acceptance; read-only, from message 6) and
 *      whether its stock goes to Hiryu (every active store, no switch).
 *   4. Item menu: every menu item of the stores listed, one table with
 *      filters (dark store, brand, store, SKU, available, search) and Export
 *      CSV of exactly the rows shown.
 *        GET /api/hiryu-link/catalogue?site_id=&all_items=true
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, icon, t } = S;
  const api = () => S.api();

  /* "Indonesian / English" from the server, as a pair. */
  function split(text) {
    const m = /^(.{6,}?) \/ (.{6,})$/.exec(String(text || ''));
    return m ? [m[1], m[2]] : [String(text || ''), String(text || '')];
  }
  const span = (pair, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + ' ' + biAttr(pair[0], pair[1]) + '>' + esc(t(pair[0], pair[1])) + '</span>';
  const ACCOUNT = { own: ['Merek sendiri', 'Own account'], ninja: ['Ninja Van (Nemu Mart)', 'Ninja Van (Nemu Mart)'] };
  const SHOW_MAX = 1000;   // rows drawn in the item table; the CSV has them all

  const CSS = `
  .mh-sync { display:flex; flex-wrap:wrap; align-items:center; gap:12px 16px; }
  .mh-sync__text { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1 1 260px; }
  .mh-sync__line { display:flex; align-items:flex-start; gap:8px; }
  .mh-sync__line > svg { flex-shrink:0; margin-top:2px; }
  .mh-sync__line--ok > svg { color:var(--ok); }
  .mh-sync__line--stop { color:var(--stop); }
  .mh-sync__line--wait > svg { color:var(--action); }
  .mh-sync .k-btn { flex-shrink:0; }
  .mh-spin { width:18px; height:18px; border-radius:50%; border:3px solid currentColor; border-right-color:transparent; animation:mh-spin .8s linear infinite; flex-shrink:0; }
  @keyframes mh-spin { to { transform:rotate(360deg); } }
  .mh-new { border:2px solid var(--caution-line); background:var(--caution-row); }
  .mh-new__head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .mh-choices { display:grid; gap:8px; }
  .mh-choice { display:flex; gap:12px; align-items:flex-start; padding:12px 14px; border:2px solid var(--rule); border-radius:12px; background:var(--surface); cursor:pointer; min-height:56px; }
  .mh-choice input { width:22px; height:22px; margin-top:2px; accent-color:var(--action); flex-shrink:0; }
  .mh-choice:has(input:checked) { border-color:var(--action); background:var(--action-bg); }
  .mh-choice:has(input:disabled) { cursor:not-allowed; opacity:.75; }
  .mh-choice__text { display:flex; flex-direction:column; gap:2px; }
  .mh-storerow { cursor:pointer; }
  .mh-storerow:focus-visible { outline:3px solid rgba(31,78,140,.35); outline-offset:-3px; }
  .mh-storecell { min-width:200px; }
  .mh-nw { white-space:nowrap; }
  .mh-table td, .mh-table th { padding-left:12px; padding-right:12px; }
  .mh-nosku { color:var(--stop); font-weight:700; display:inline-flex; align-items:center; gap:6px; }
  .mh-status { display:flex; flex-direction:column; align-items:flex-start; gap:4px; }
  .mh-chip { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; background:var(--sunk); color:var(--ink-2); white-space:nowrap; }
  .mh-chip--warn { background:var(--caution-bg); color:var(--caution); }
  .mh-grid2 { display:grid; gap:16px; }
  @media (min-width:1024px) { .mh-grid2 { grid-template-columns:1fr 1fr; } }
  .mh-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 12px; padding:16px 20px 0; }
  .mh-filters { display:grid; gap:10px; padding:12px 16px 0; grid-template-columns:repeat(2, minmax(0, 1fr)); }
  @media (min-width:700px) { .mh-filters { padding:12px 20px 0; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); } }
  .mh-filters .k-field { gap:4px; min-width:0; }
  .mh-filters .k-field__label { font-size:12px; }
  .mh-filters .k-select, .mh-filters .k-input { min-height:44px; width:100%; }
  .mh-filters .mh-q { grid-column:1 / -1; }
  @media (min-width:1024px) { .mh-filters .mh-q { grid-column:auto / span 2; } }
  .mh-count { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:10px 20px; }
  .mh-iscroll { max-height:70vh; overflow:auto; -webkit-overflow-scrolling:touch; border-top:1px solid var(--rule); }
  .mh-iscroll .k-table { min-width:880px; }
  .mh-iscroll thead th { position:sticky; top:0; z-index:1; background:var(--surface); box-shadow:inset 0 -1px 0 var(--rule); }
  .mh-itable td { vertical-align:top; }
  .mh-itemname { min-width:200px; }
  .mh-skucell { min-width:180px; }
  `;
  function style() {
    if (document.getElementById('mh-css')) return;
    const s = document.createElement('style');
    s.id = 'mh-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  let STATE = null;   // { cat, brands, sync, pulling, f: {site, brand, store, sku, avail, q} }

  /* ------------------------------------------------------------ sync ---- */

  function syncHtml() {
    const sid = S.siteId();
    const st = STATE.sync;
    const mins = (st && st.cooldown_minutes) || 5;
    const lines = [];
    let btn = '';
    if (!sid) {
      lines.push('<div class="mh-sync__line">' + span(['Pilih satu dark store untuk sinkron ulang.', 'Choose one dark store to resync.'], 'k-strong') + '</div>');
    } else if (STATE.pulling) {
      lines.push('<div class="mh-sync__line mh-sync__line--wait"><span class="mh-spin" aria-hidden="true"></span>' +
        span(['Menarik katalog dari Hiryu…', 'Pulling the catalogue from Hiryu…'], 'k-strong') + '</div>');
      lines.push(span(['Menunggu jawaban Hiryu, paling lama 20 detik.', 'Waiting for Hiryu\'s answer, at most 20 seconds.'], 'k-caption'));
      btn = '<button type="button" class="k-btn k-btn--secondary" disabled><span class="mh-spin" aria-hidden="true"></span>' + span(['Menunggu…', 'Waiting…']) + '</button>';
    } else {
      if (st && st.requested_at) {
        const who = st.requested_by_name || '-';
        const at = S.fmt.time(st.requested_at);
        if (st.status === 'answered') {
          lines.push('<div class="mh-sync__line mh-sync__line--ok">' + icon('check', 18) + '<span class="k-strong">' +
            span(['Sinkron ulang ' + at + ' oleh ' + who + ': katalog diterima ' + S.fmt.time(st.answered_at),
              'Resync ' + at + ' by ' + who + ': catalogue taken ' + S.fmt.time(st.answered_at)]) + '</span></div>');
        } else if (st.status === 'failed') {
          const r = split(st.reason || 'Tidak ada jawaban dari Hiryu / No answer from Hiryu');
          lines.push('<div class="mh-sync__line mh-sync__line--stop">' + icon('warn', 18) + '<span class="k-strong">' +
            span(['Sinkron ulang ' + at + ' oleh ' + who + ' gagal: ' + r[0], 'Resync ' + at + ' by ' + who + ' failed: ' + r[1]]) + '</span></div>');
        } else {
          lines.push('<div class="mh-sync__line mh-sync__line--wait"><span class="mh-spin" aria-hidden="true"></span><span class="k-strong">' +
            span(['Sinkron ulang ' + at + ' oleh ' + who + ': menunggu jawaban Hiryu', 'Resync ' + at + ' by ' + who + ': waiting for Hiryu']) + '</span></div>');
        }
      } else {
        lines.push('<div class="mh-sync__line">' + span(['Belum pernah sinkron ulang di dark store ini.', 'No resync at this dark store yet.'], 'k-strong') + '</div>');
      }
      const wait = st && st.next_allowed_at;
      const again = st && st.status === 'failed';
      btn = wait
        ? '<button type="button" class="k-btn k-btn--secondary" disabled>' + icon('clock') + span(['Bisa lagi ' + S.fmt.time(wait), 'Possible again ' + S.fmt.time(wait)]) + '</button>'
        : '<button type="button" class="k-btn k-btn--secondary" data-sync>' + icon('refresh') +
          span(again ? ['Coba lagi', 'Try again'] : ['Sinkron ulang dari Hiryu', 'Resync from Hiryu']) + '</button>';
      lines.push(span(['WMS mengambil seluruh katalog dari Hiryu saat itu juga. Semua peran bisa. Sekali per ' + mins + ' menit per dark store (yang gagal tidak dihitung), tercatat dengan nama.',
        'The WMS fetches Hiryu\'s whole catalogue at once. Any role. Once every ' + mins + ' minutes per dark store (a failed one does not count), logged with your name.'], 'k-caption'));
    }
    return '<div class="k-card k-card--pad mh-sync" id="mh-sync"><div class="mh-sync__text">' + lines.join('') + '</div>' + btn + '</div>';
  }

  function repaintSync() {
    const el = document.getElementById('mh-sync');
    if (!el) return;
    el.outerHTML = syncHtml();
    const fresh = document.getElementById('mh-sync');
    S.applyLang(fresh);
    const b = fresh.querySelector('[data-sync]');
    if (b) b.addEventListener('click', doSync);
  }

  async function doSync() {
    if (STATE.pulling) return;
    STATE.pulling = true;
    repaintSync();
    try {
      const st = await api().post('/hiryu-link/catalogue-request', { site_id: S.siteId() });
      STATE.sync = st;
      STATE.pulling = false;
      if (st.ok) {
        S.toast(st.message || ['Katalog dari Hiryu diterima.', 'Catalogue from Hiryu taken.'], 'ok');
        await loadCatalogue().catch(S.fail);
        paint();
        return;
      }
      S.toast(st.message || ['Sinkron ulang gagal.', 'Resync failed.'], 'stop', 8000);
    } catch (e) {
      STATE.pulling = false;
      if (e.status === 429) S.toast(e.message, 'caution'); else S.fail(e);
      await loadSync();
    }
    repaintSync();
  }

  /* ------------------------------------------------- new store cards ---- */

  function newStoreHtml(s) {
    const can = S.atLeast('hq');
    const brands = (STATE.brands || []).filter((b) => b.active);
    const opts = '<option value="">' + esc(t('Pilih merek', 'Choose a brand')) + '</option>' +
      brands.map((b) => '<option value="' + b.id + '"' + (s.brand_id === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
      '<option value="new">' + esc(t('Merek baru…', 'New brand…')) + '</option>';
    const acc = (k) => '<label class="mh-choice"><input type="radio" name="acc-' + s.hiryu_store_no + '" value="' + k + '"' +
      (s.grab_account === k ? ' checked' : '') + (can ? '' : ' disabled') + '>' +
      '<span class="mh-choice__text">' + span(k === 'own' ? ['Akun merchant merek sendiri', 'The brand\'s own merchant account'] : ['Akun merchant Ninja Van', 'Ninja Van\'s merchant account'], 'k-strong') +
      span(k === 'own' ? ['Sesuai data merek. Grab minta minimal 10 SKU.', 'As on the brand. Grab asks at least 10 SKUs.'] : ['Nemu Mart, untuk merek di bawah 10 SKU.', 'Nemu Mart, for brands under 10 SKUs.'], 'k-caption') +
      '</span></label>';
    return '<div class="k-card k-card--pad mh-new k-stack" data-new="' + s.hiryu_store_no + '">' +
      '<div class="mh-new__head">' + icon('warn', 22) + '<span class="k-h2" style="font-size:18px">' +
      span(['Toko baru dari Hiryu: ', 'New store from Hiryu: ']) + esc(s.store_name) + ' (#' + s.hiryu_store_no + ')</span>' + S.sysChip('Hiryu') + '</div>' +
      '<p class="k-p" style="margin:0">' + span(['Pilih merek toko ini dan akun merchant Grab-nya. Ditanya sekali saja.',
        'Choose this store\'s brand and its Grab merchant account. Asked once only.']) + '</p>' +
      '<span class="k-caption">' + span(['Masuk ' + S.fmt.dt(s.hiryu_received_at), 'Arrived ' + S.fmt.dt(s.hiryu_received_at)]) +
      ' · dark store ' + esc(S.shortCode(s.site_code)) + ' · ' + span(['terima pesanan ' + (s.order_acceptance || '-'), 'order acceptance ' + (s.order_acceptance || '-')]) + '</span>' +
      (s.acceptance_warning ? '<div class="k-note k-note--caution">' + icon('warn') + span(['Terima pesanan bukan MANUAL. Ubah ke MANUAL di Hiryu: staf harus menekan Terima.',
        'Order acceptance is not MANUAL. Set it to MANUAL in Hiryu: staff must press Terima.']) + '</div>' : '') +
      '<div class="mh-grid2"><div class="k-field"><label class="k-field__label" ' + biAttr('Merek', 'Brand') + '>Merek</label>' +
      '<select class="k-select" data-brand' + (can ? '' : ' disabled') + '>' + opts + '</select>' +
      '<span class="k-field__hint" ' + biAttr('Satu toko, satu merek.', 'One store, one brand.') + '></span></div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Akun merchant Grab', 'Grab merchant account') + '></span>' +
      '<div class="mh-choices">' + acc('own') + acc('ninja') + '</div>' +
      '<span class="k-field__hint" data-acchint></span></div></div>' +
      '<div class="k-line" style="justify-content:flex-end"><button type="button" class="k-btn k-btn--primary" data-save data-min-role="hq">' +
      icon('check') + span(['Simpan', 'Save']) + '</button></div></div>';
  }

  function wireNew(card) {
    const no = +card.dataset.new;
    const sel = card.querySelector('[data-brand]');
    const radios = Array.from(card.querySelectorAll('input[type=radio]'));
    const hint = card.querySelector('[data-acchint]');
    function brandChanged() {
      if (sel.value === 'new') { sel.value = ''; newBrand(card); return; }
      const b = (STATE.brands || []).find((x) => String(x.id) === sel.value);
      const fixed = b && b.grab_account;
      radios.forEach((r) => {
        if (fixed) r.checked = r.value === b.grab_account;
        r.disabled = !S.atLeast('hq') || !!fixed;
      });
      hint.innerHTML = fixed ? span(['Terisi dari merek ' + b.name + '. Ubah di Produk, Merek.', 'Filled in from the brand ' + b.name + '. Change it under Products, Brands.']) : '';
    }
    sel.addEventListener('change', brandChanged);
    brandChanged();
    const save = card.querySelector('[data-save]');
    save.addEventListener('click', async () => {
      const brand = +sel.value;
      const r = radios.find((x) => x.checked);
      if (!brand) { S.toast(['Pilih merek dulu.', 'Choose the brand first.'], 'caution'); sel.focus(); return; }
      if (!r) { S.toast(['Pilih akun merchant Grab.', 'Choose the Grab merchant account.'], 'caution'); return; }
      save.disabled = true;
      try {
        const res = await api().post('/hiryu-link/stores/' + no + '/assign', { brand_id: brand, grab_account: r.value });
        S.toast(res.message, 'ok');
        if (res.problems && res.problems.length) S.toast(res.problems[0], 'caution', 8000);
        await loadCatalogue();
        paint();
      } catch (e) { S.fail(e); save.disabled = false; }
    });
  }

  /* Merek baru: the brand form, in short (name + account). */
  function newBrand(card) {
    const box = document.createElement('div');
    box.className = 'k-stack';
    box.innerHTML = '<p class="k-p" style="margin:0">' + span(['Merek dicatat di WMS. Lengkapi data lainnya nanti di Produk, Merek.',
      'The brand is recorded in the WMS. Complete the rest later under Products, Brands.']) + '</p>' +
      '<div class="k-field"><label class="k-field__label" for="mh-bname" ' + biAttr('Nama merek', 'Brand name') + '></label>' +
      '<input id="mh-bname" class="k-input" maxlength="160" autocomplete="off" ' + 'data-ph-id="Sama seperti di Hiryu dan Grab" data-ph-en="As in Hiryu and Grab"></div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Akun merchant Grab', 'Grab merchant account') + '></span><div class="mh-choices">' +
      ['own', 'ninja'].map((k) => '<label class="mh-choice"><input type="radio" name="mh-bacc" value="' + k + '"><span class="mh-choice__text">' +
        span(ACCOUNT[k], 'k-strong') + '</span></label>').join('') + '</div></div>';
    S.modal({
      title: ['Merek baru', 'New brand'], body: box,
      actions: [
        { label: ['Batal', 'Cancel'], kind: 'secondary' },
        { label: ['Tambah merek', 'Add brand'], kind: 'primary', minRole: 'hq', onClick: async () => {
          const name = box.querySelector('#mh-bname').value.trim();
          const acc = box.querySelector('input[name=mh-bacc]:checked');
          if (!name || !acc) { S.toast(['Isi nama dan akun merchant.', 'Fill in the name and the merchant account.'], 'caution'); return false; }
          const b = await api().post('/catalog/brands', { name, grab_account: acc.value });
          S.toast(['Merek ' + b.name + ' ditambahkan.', 'Brand ' + b.name + ' added.'], 'ok');
          await loadBrands();
          const sel = card.querySelector('[data-brand]');
          sel.insertAdjacentHTML('beforeend', '<option value="' + b.id + '">' + esc(b.name) + '</option>');
          sel.value = String(b.id);
          sel.dispatchEvent(new Event('change'));
        } },
      ],
    });
  }

  /* ------------------------------------------------------ store list ---- */

  function brandCell(s) {
    if (!s.brand_id) return span(['Pilih di atas', 'Choose above'], 'k-muted mh-nw');
    return esc(s.brand_name || '-');
  }
  function accountCell(s) {
    if (!s.grab_account) return s.brand_id ? span(['Akun belum dipilih', 'Account not chosen'], 'mh-nw') : '';
    return span(s.grab_account === 'own' ? ['Merek sendiri', 'Own'] : ['Ninja Van', 'Ninja Van']);
  }

  /* Status di Hiryu, read-only from message 6: active or not, and order
     acceptance (MANUAL expected; anything else is a warning). */
  function acceptChip(s) {
    const a = s.order_acceptance;
    if (!a) return '<span class="mh-chip">' + span(['terima: belum dikirim', 'acceptance: not sent']) + '</span>';
    if (s.acceptance_warning) {
      return '<span class="mh-chip mh-chip--warn" title="' + esc(t('Harus MANUAL: staf menekan Terima di Hiryu.', 'Must be MANUAL: staff press Terima in Hiryu.')) + '">' +
        icon('warn', 13) + span(['terima ' + a + ', harus MANUAL', 'accept ' + a + ', must be MANUAL']) + '</span>';
    }
    return '<span class="mh-chip">' + span(['terima ' + a, 'accept ' + a]) + '</span>';
  }
  function hiryuStatus(s) {
    return '<div class="mh-status">' +
      (s.hiryu_active ? S.pill('ok', 'Aktif di Hiryu', 'Active in Hiryu') : S.pill('stop', 'Nonaktif di Hiryu', 'Inactive in Hiryu')) +
      acceptChip(s) + '</div>';
  }
  /* Stock goes to Hiryu for every active store: no switch. */
  function stockStatus(s) {
    if (s.active) return S.pill('ok', 'Stok ke Hiryu', 'Stock to Hiryu');
    if (s.hiryu_active && s.needs_brand) return S.pill('caution', 'Menunggu Ops HQ', 'Waiting for Ops HQ');
    return S.pill('info', 'Stok tidak dikirim', 'No stock sent');
  }

  function storeTable(stores) {
    const showHub = S.allSites();
    return '<div class="k-tablewrap"><table class="k-table mh-table"><thead><tr>' +
      '<th ' + biAttr('Toko', 'Store') + '></th>' + (showHub ? '<th ' + biAttr('Dark store', 'Dark store') + '></th>' : '') +
      '<th ' + biAttr('Merek · akun merchant', 'Brand · merchant account') + '></th>' +
      '<th ' + biAttr('Menu', 'Menu') + '></th>' +
      '<th ' + biAttr('Status di Hiryu', 'Status in Hiryu') + '></th>' +
      '<th ' + biAttr('Di WMS', 'In the WMS') + '></th>' +
      '</tr></thead><tbody>' + stores.map((s) => {
        const sel = STATE.f.store === String(s.hiryu_store_no);
        const cls = sel ? 'is-selected' : s.needs_brand && s.hiryu_active ? 'is-caution' : !s.hiryu_active ? 'is-stop' : '';
        return '<tr class="mh-storerow ' + cls + '" tabindex="0" data-store="' + s.hiryu_store_no + '" title="' + esc(t('Tampilkan item toko ini', 'Show this store\'s items')) + '">' +
          '<td class="mh-storecell"><div class="k-cell2"><span class="k-cell2__main">' + esc(s.store_name) + '</span>' +
          '<span class="k-cell2__sub">Hiryu #' + s.hiryu_store_no + '</span></div></td>' +
          (showHub ? '<td class="k-mono k-strong">' + esc(S.shortCode(s.site_code)) + '</td>' : '') +
          '<td><div class="k-cell2"><span class="k-cell2__main">' + brandCell(s) + '</span><span class="k-cell2__sub">' + accountCell(s) + '</span></div></td>' +
          '<td><div class="k-cell2"><span class="k-cell2__main mh-nw">' + (s.items ? span([S.fmt.n(s.items) + ' item', S.fmt.n(s.items) + ' items']) : span(['Belum ada menu', 'No menu yet'], 'k-muted')) + '</span>' +
          (s.unconnected ? '<span class="k-cell2__sub mh-nosku mh-nw">' + icon('warn', 14) + span([s.unconnected + ' tanpa SKU', s.unconnected + ' without SKU']) + '</span>' : '') + '</div></td>' +
          '<td>' + hiryuStatus(s) + '</td>' +
          '<td class="mh-nw">' + stockStatus(s) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function storeRows(stores) {
    return '<div class="k-list">' + stores.map((s) => {
      const kind = s.needs_brand && s.hiryu_active ? 'caution' : !s.hiryu_active ? 'stop' : '';
      const sub = [esc(S.shortCode(s.site_code)), s.brand_id ? esc(s.brand_name) : span(['merek belum dipilih', 'no brand yet']),
        span([(s.items || 0) + ' item', (s.items || 0) + ' items'])];
      if (s.unconnected) sub.push('<span class="mh-nosku">' + span([s.unconnected + ' tanpa SKU', s.unconnected + ' without SKU']) + '</span>');
      const status = (s.hiryu_active ? span(['Aktif di Hiryu', 'Active in Hiryu']) : span(['Nonaktif di Hiryu', 'Inactive in Hiryu'])) + ' · ' +
        (s.acceptance_warning ? '<span class="mh-nosku">' + icon('warn', 14) + span(['terima ' + s.order_acceptance, 'accept ' + s.order_acceptance]) + '</span>'
          : span(['terima ' + (s.order_acceptance || '-'), 'accept ' + (s.order_acceptance || '-')]));
      return '<button type="button" class="k-row' + (kind ? ' k-row--' + kind : '') + '" data-store="' + s.hiryu_store_no + '">' +
        '<span class="k-row__icon' + (kind ? ' k-row__icon--' + kind : ' k-row__icon--ok') + '">' + icon(kind ? 'warn' : 'bag', 24) + '</span>' +
        '<span class="k-row__text"><span class="k-row__title">' + esc(s.store_name) + ' · #' + s.hiryu_store_no + '</span>' +
        '<span class="k-row__sub">' + sub.join(' · ') + '</span><span class="k-row__sub">' + status + '</span></span>' +
        '<span class="k-row__chev">' + icon('chev', 22) + '</span></button>';
    }).join('') + '</div>';
  }

  /* ----------------------------------------------------------- items ---- */

  const storeOf = (no) => (STATE.cat.stores || []).find((s) => s.hiryu_store_no === no) || {};
  const isAvail = (i) => (i.available_status || '').toUpperCase() === 'AVAILABLE';

  /* Every item with its store's dark store and brand, for filters and CSV. */
  function allRows() {
    return (STATE.cat.items || []).map((i) => {
      const s = storeOf(i.hiryu_store_no);
      return { i, s, site: s.site_code || '', brand: s.brand_name || '' };
    });
  }

  function filtered() {
    const f = STATE.f;
    const q = (f.q || '').trim().toLowerCase();
    return allRows().filter(({ i, s, site, brand }) => {
      if (f.site && site !== f.site) return false;
      if (f.brand && (f.brand === '-' ? !!s.brand_id : brand !== f.brand)) return false;
      if (f.store && String(i.hiryu_store_no) !== f.store) return false;
      if (f.sku === 'yes' && !i.sku_id) return false;
      if (f.sku === 'no' && i.sku_id) return false;
      if (f.avail === 'yes' && !isAvail(i)) return false;
      if (f.avail === 'no' && isAvail(i)) return false;
      if (q) {
        const hay = [i.item_name, i.hiryu_item_id, i.sku_code, i.sku_name, s.store_name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function opt(value, label, cur) {
    return '<option value="' + esc(value) + '"' + (cur === value ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function filtersHtml() {
    const f = STATE.f;
    const stores = STATE.cat.stores || [];
    const sites = Array.from(new Set(stores.map((s) => s.site_code))).sort();
    const brands = Array.from(new Set(stores.filter((s) => s.brand_name).map((s) => s.brand_name))).sort();
    const noBrand = stores.some((s) => !s.brand_id);
    const inSite = stores.filter((s) => !f.site || s.site_code === f.site);
    const field = (label, inner, cls) => '<label class="k-field' + (cls ? ' ' + cls : '') + '"><span class="k-field__label" ' + biAttr(label[0], label[1]) + '></span>' + inner + '</label>';
    const parts = [];
    if (S.allSites() && sites.length > 1) {
      parts.push(field(['Dark store', 'Dark store'], '<select class="k-select" data-f="site">' + opt('', t('Semua dark store', 'All dark stores'), f.site) +
        sites.map((c) => opt(c, S.shortCode(c), f.site)).join('') + '</select>'));
    }
    parts.push(field(['Merek', 'Brand'], '<select class="k-select" data-f="brand">' + opt('', t('Semua merek', 'All brands'), f.brand) +
      brands.map((b) => opt(b, b, f.brand)).join('') + (noBrand ? opt('-', t('Merek belum dipilih', 'No brand yet'), f.brand) : '') + '</select>'));
    parts.push(field(['Toko', 'Store'], '<select class="k-select" data-f="store">' + opt('', t('Semua toko', 'All stores'), f.store) +
      inSite.map((s) => opt(String(s.hiryu_store_no), s.store_name + ' (#' + s.hiryu_store_no + ')', f.store)).join('') + '</select>'));
    parts.push(field(['SKU', 'SKU'], '<select class="k-select" data-f="sku">' + opt('', t('Semua', 'All'), f.sku) +
      opt('yes', t('Tersambung ke SKU', 'Matched to a SKU'), f.sku) + opt('no', t('Item tanpa SKU', 'Item without SKU'), f.sku) + '</select>'));
    parts.push(field(['Di Hiryu', 'In Hiryu'], '<select class="k-select" data-f="avail">' + opt('', t('Semua', 'All'), f.avail) +
      opt('yes', t('Tersedia', 'Available'), f.avail) + opt('no', t('Dimatikan', 'Switched off'), f.avail) + '</select>'));
    parts.push(field(['Cari', 'Search'], '<div class="k-search">' + icon('search', 18) +
      '<input class="k-input" type="search" data-f="q" value="' + esc(f.q || '') + '" data-ph-id="Item, ID item, SKU atau toko" data-ph-en="Item, item ID, SKU or store"></div>', 'mh-q'));
    return '<div class="mh-filters">' + parts.join('') + '</div>';
  }

  function itemTableHtml(rows) {
    const showHub = S.allSites();
    const skuCell = (i) => i.sku_id
      ? '<div class="k-cell2"><span class="k-cell2__main k-mono">' + esc(i.sku_code || '') + (i.sku_new ? ' <span class="k-tag" ' + biAttr('baru', 'new') + '></span>' : '') + '</span>' +
        '<span class="k-cell2__sub">' + esc(i.sku_name || '') + '</span></div>'
      : '<span class="mh-nosku">' + icon('warn', 16) + span(['Item tanpa SKU', 'Item without SKU']) + '</span>' +
        (i.sku_code ? '<div class="k-caption k-mono">' + esc(i.sku_code) + '</div>' : '');
    const avail = (i) => isAvail(i) ? S.pill('ok', 'Tersedia', 'Available') : S.pill('caution', 'Dimatikan', 'Switched off');
    const shown = rows.slice(0, SHOW_MAX);
    return '<div class="mh-iscroll" tabindex="0" role="region" data-aria-id="Daftar item menu" data-aria-en="Menu item list" aria-label="' + esc(t('Daftar item menu', 'Menu item list')) + '">' +
      '<table class="k-table mh-table mh-itable"><thead><tr>' +
      (showHub ? '<th ' + biAttr('Dark store', 'Dark store') + '></th>' : '') +
      '<th ' + biAttr('Toko', 'Store') + '></th><th ' + biAttr('Merek', 'Brand') + '></th>' +
      '<th ' + biAttr('Item menu', 'Menu item') + '></th><th ' + biAttr('SKU (Bundles)', 'SKU (Bundles)') + '></th>' +
      '<th class="k-num" ' + biAttr('Unit per jual', 'Units per sale') + '></th><th class="k-num" ' + biAttr('Harga', 'Price') + '></th>' +
      '<th ' + biAttr('Di Hiryu', 'In Hiryu') + '></th>' +
      '</tr></thead><tbody>' + shown.map(({ i, s }) => '<tr class="' + (!i.sku_id ? 'is-stop' : '') + '">' +
        (showHub ? '<td class="k-mono k-strong">' + esc(S.shortCode(s.site_code || '')) + '</td>' : '') +
        '<td><div class="k-cell2"><span class="k-cell2__main mh-nw">' + esc(s.store_name || '-') + '</span><span class="k-cell2__sub">#' + i.hiryu_store_no + '</span></div></td>' +
        '<td class="mh-nw">' + (s.brand_name ? esc(s.brand_name) : span(['belum dipilih', 'not chosen'], 'k-muted')) + '</td>' +
        '<td class="mh-itemname"><div class="k-cell2"><span class="k-cell2__main">' + esc(i.item_name || '-') + '</span><span class="k-cell2__sub k-mono">' + esc(i.hiryu_item_id) + '</span></div></td>' +
        '<td class="mh-skucell">' + skuCell(i) + '</td><td class="k-num">' + esc(String(i.units_per_sale)) + '</td>' +
        '<td class="k-num mh-nw">' + esc(S.fmt.rp(i.price_idr)) + '</td><td class="mh-nw">' + avail(i) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function itemResultHtml() {
    const all = (STATE.cat.items || []).length;
    const rows = filtered();
    const nosku = rows.filter((r) => !r.i.sku_id).length;
    const count = '<div class="mh-count"><span class="k-caption">' +
      span(['Menampilkan ' + S.fmt.n(rows.length) + ' dari ' + S.fmt.n(all) + ' item' + (nosku ? ', ' + S.fmt.n(nosku) + ' tanpa SKU' : ''),
        'Showing ' + S.fmt.n(rows.length) + ' of ' + S.fmt.n(all) + ' items' + (nosku ? ', ' + S.fmt.n(nosku) + ' without SKU' : '')]) +
      (rows.length > SHOW_MAX ? ' · ' + span(['tabel menampilkan ' + S.fmt.n(SHOW_MAX) + ' baris pertama; Export CSV berisi semuanya',
        'the table shows the first ' + S.fmt.n(SHOW_MAX) + ' rows; Export CSV has them all']) : '') + '</span>' +
      (STATE.f.site || STATE.f.brand || STATE.f.store || STATE.f.sku || STATE.f.avail || STATE.f.q
        ? '<button type="button" class="k-linkbtn" data-fclear>' + span(['Hapus saringan', 'Clear filters']) + '</button>' : '') + '</div>';
    if (!all) {
      return count + '<div class="k-empty"><span class="k-empty__icon k-empty__icon--muted">' + icon('list', 28) + '</span>' +
        span(['Belum ada menu', 'No menu yet'], 'k-empty__title') + span(['Menu dibuat di Hiryu lalu masuk ke sini sendiri.', 'The menu is made in Hiryu and arrives here by itself.'], 'k-empty__text') + '</div>';
    }
    if (!rows.length) return count + '<p class="k-muted" style="padding:0 20px 16px" ' + biAttr('Tidak ada yang cocok dengan saringan.', 'Nothing matches the filters.') + '></p>';
    return count + itemTableHtml(rows);
  }

  function itemsCardHtml() {
    const n = (STATE.cat.items || []).length;
    return '<div class="k-card" id="mh-items"><div class="mh-head"><span class="k-h2" style="font-size:18px">' +
      span(['Item menu', 'Menu items']) + ' <span class="k-muted">(' + S.fmt.n(n) + ')</span></span>' +
      '<button type="button" class="k-btn k-btn--secondary k-btn--sm" data-csv' + (n ? '' : ' disabled') + '>' + icon('download', 16) + span(['Export CSV', 'Export CSV']) + '</button></div>' +
      filtersHtml() + '<div id="mh-iresult">' + itemResultHtml() + '</div></div>';
  }

  function repaintItems() {
    const box = document.getElementById('mh-iresult');
    if (!box) return;
    box.innerHTML = itemResultHtml();
    S.applyLang(box);
    const c = box.querySelector('[data-fclear]');
    if (c) c.addEventListener('click', clearFilters);
  }
  function clearFilters() {
    STATE.f = { site: '', brand: '', store: '', sku: '', avail: '', q: '' };
    paint();
  }

  function wireItems(root) {
    root.querySelectorAll('[data-f]').forEach((el) => {
      const key = el.dataset.f;
      el.addEventListener(key === 'q' ? 'input' : 'change', () => {
        STATE.f[key] = el.value;
        if (key === 'site') {
          /* A store of another dark store no longer fits. */
          const s = storeOf(+STATE.f.store);
          if (STATE.f.store && STATE.f.site && s.site_code !== STATE.f.site) STATE.f.store = '';
          const card = document.getElementById('mh-items');
          card.outerHTML = itemsCardHtml();
          const fresh = document.getElementById('mh-items');
          S.applyLang(fresh);
          wireItems(fresh);
          return;
        }
        repaintItems();
        highlightStore();
      });
    });
    const c = root.querySelector('[data-fclear]');
    if (c) c.addEventListener('click', clearFilters);
    const csv = root.querySelector('[data-csv]');
    if (csv) csv.addEventListener('click', exportCsv);
  }

  function highlightStore() {
    if (!BODY) return;
    BODY.querySelectorAll('tr[data-store]').forEach((tr) => {
      const s = storeOf(+tr.dataset.store);
      tr.classList.toggle('is-selected', STATE.f.store === tr.dataset.store);
      tr.classList.toggle('is-caution', STATE.f.store !== tr.dataset.store && !!(s.needs_brand && s.hiryu_active));
      tr.classList.toggle('is-stop', STATE.f.store !== tr.dataset.store && !s.hiryu_active);
    });
  }

  /* A store row sets the store filter and shows its items. */
  function pickStore(no) {
    const s = storeOf(no);
    STATE.f.store = STATE.f.store === String(no) && window.innerWidth >= 1024 ? '' : String(no);
    if (STATE.f.site && s.site_code !== STATE.f.site) STATE.f.site = '';
    const card = document.getElementById('mh-items');
    if (card) {
      card.outerHTML = itemsCardHtml();
      const fresh = document.getElementById('mh-items');
      S.applyLang(fresh);
      wireItems(fresh);
      if (window.innerWidth < 1024) fresh.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    highlightStore();
  }

  /* ------------------------------------------------------- CSV export ---- */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // a cell Excel would run as a formula
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    const rows = filtered();
    if (!rows.length) { S.toast(['Tidak ada baris untuk diekspor.', 'No rows to export.'], 'caution'); return; }
    const en = S.lang() === 'en';
    const yes = en ? 'Yes' : 'Ya', no = en ? 'No' : 'Tidak';
    const head = en
      ? ['Dark store', 'Store no', 'Store name', 'Brand', 'Item ID', 'Item name', 'SKU code', 'SKU name', 'Units per sale', 'Price (IDR)', 'Available in Hiryu', 'Matched to a SKU']
      : ['Dark store', 'No toko', 'Nama toko', 'Merek', 'ID item', 'Nama item', 'Kode SKU', 'Nama SKU', 'Unit per jual', 'Harga (Rp)', 'Tersedia di Hiryu', 'Tersambung ke SKU'];
    const lines = [head.map(csvCell).join(',')];
    rows.forEach(({ i, s }) => {
      lines.push([
        S.shortCode(s.site_code || ''), i.hiryu_store_no, s.store_name || '', s.brand_name || '',
        i.hiryu_item_id, i.item_name || '', i.sku_code || '', i.sku_name || '',
        Number(i.units_per_sale) || 1, i.price_idr == null ? '' : Number(i.price_idr),
        isAvail(i) ? yes : no, i.sku_id ? yes : no,
      ].map(csvCell).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const site = S.site();
    const code = site ? S.shortCode(site.code) : (STATE.f.site ? S.shortCode(STATE.f.site) : 'semua');
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'menu-hiryu-' + String(code).replace(/[^A-Za-z0-9-]/g, '') + '-' + day + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    S.toast([S.fmt.n(rows.length) + ' baris diekspor.', S.fmt.n(rows.length) + ' rows exported.'], 'ok');
  }

  /* ----------------------------------------------------------- paint ---- */

  let BODY = null;
  function paint() {
    if (!STATE || !BODY) return;
    const stores = STATE.cat ? STATE.cat.stores || [] : [];
    const pending = stores.filter((s) => s.needs_brand && s.hiryu_active);
    const nosku = stores.reduce((n, s) => n + (s.unconnected || 0), 0);
    const warnAccept = stores.filter((s) => s.hiryu_active && s.acceptance_warning).length;
    BODY.innerHTML =
      '<div class="k-stack k-stack--loose">' + syncHtml() +
      pending.map(newStoreHtml).join('') +
      (stores.length
        ? '<div class="k-card"><div class="mh-head">' +
          '<span class="k-h2" style="font-size:18px">' + span(['Toko di Hiryu', 'Stores in Hiryu']) + ' <span class="k-muted">(' + stores.length + ')</span></span>' +
          '<span class="k-line" style="gap:8px;flex-wrap:wrap">' +
          (warnAccept ? '<span class="k-pill k-pill--caution"><span class="k-pill__dot"></span>' + span([warnAccept + ' toko bukan terima MANUAL', warnAccept + ' stores not on MANUAL acceptance']) + '</span>' : '') +
          (nosku ? '<span class="k-pill k-pill--stop"><span class="k-pill__dot"></span>' + span([nosku + ' item tanpa SKU', nosku + ' items without SKU']) + '</span>' : '') +
          '</span></div><div class="k-laptop-only" style="padding-top:12px">' + storeTable(stores) + '</div>' +
          '<div class="k-phone-only" style="padding:12px">' + storeRows(stores) + '</div></div>'
        : '<div class="k-card k-empty"><span class="k-empty__icon k-empty__icon--muted">' + icon('bag', 28) + '</span>' +
          span(['Belum ada toko dari Hiryu', 'No stores from Hiryu yet'], 'k-empty__title') +
          span(['Toko dibuat di Hiryu dan masuk ke sini sendiri. Jika ada yang kurang, tekan Sinkron ulang dari Hiryu.',
            'Stores are made in Hiryu and arrive here by themselves. If something is missing, press Sinkron ulang dari Hiryu.'], 'k-empty__text') + '</div>') +
      (stores.length ? itemsCardHtml() : '') +
      '<div class="k-note">' + icon('info') + '<div class="k-stack k-stack--tight">' +
      span(['Stok dikirim ke Hiryu untuk setiap toko aktif: aktif di Hiryu, merek sudah dipilih, dan dark store ada di katalog Hiryu. Tidak ada sakelar per toko.',
        'Stock goes to Hiryu for every active store: active in Hiryu, brand chosen, and the dark store in Hiryu\'s catalogue. There is no switch per store.']) +
      span(['Status di Hiryu hanya dibaca dari Hiryu. Aktif atau nonaktif, dan terima pesanan, diubah di Hiryu. Terima pesanan harus MANUAL: staf menekan Terima.',
        'Status in Hiryu is read from Hiryu only. Active or inactive, and order acceptance, are changed in Hiryu. Order acceptance must be MANUAL: staff press Terima.']) +
      span(['Akun merchant ikut merek, sama untuk semua toko merek itu. Grab minta minimal 10 SKU untuk akun merek sendiri. Merek di bawah 10 SKU dijual lewat akun merchant Ninja Van (Nemu Mart).',
        'The merchant account follows the brand, the same for every store of that brand. Grab asks at least 10 SKUs for an own account. Brands under 10 SKUs sell through Ninja Van\'s merchant account (Nemu Mart).']) +
      span(['Item tanpa SKU: item menu yang belum disambungkan ke SKU di Hiryu (Bundles). Pesanan untuk item itu tidak bisa diambil. Sambungkan di Hiryu sebelum toko diaktifkan di Grab.',
        'Item without SKU: a menu item not yet connected to a SKU in Hiryu (Bundles). Orders for it cannot be picked. Connect it in Hiryu before the store goes live on Grab.']) +
      '</div></div></div>';

    BODY.querySelectorAll('[data-new]').forEach(wireNew);
    const sb = BODY.querySelector('[data-sync]');
    if (sb) sb.addEventListener('click', doSync);
    BODY.querySelectorAll('[data-store]').forEach((el) => {
      el.addEventListener('click', () => pickStore(+el.dataset.store));
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') pickStore(+el.dataset.store); });
    });
    const items = BODY.querySelector('#mh-items');
    if (items) wireItems(items);
    S.applyLang(BODY);
    S.lockAll(BODY);
  }

  /* ------------------------------------------------------------ load ---- */

  async function loadCatalogue() {
    const r = await api().get('/hiryu-link/catalogue' + api().qs({ site_id: S.siteId(), all_items: 'true' }));
    STATE.cat = { stores: r.stores || [], items: r.items || [] };
    const f = STATE.f;
    if (f.store && !STATE.cat.stores.some((s) => String(s.hiryu_store_no) === f.store)) f.store = '';
    if (f.site && !STATE.cat.stores.some((s) => s.site_code === f.site)) f.site = '';
  }
  async function loadBrands() {
    try { STATE.brands = (await api().get('/catalog/brands')).brands || []; } catch (e) { STATE.brands = []; }
  }
  async function loadSync() {
    if (!S.siteId()) { STATE.sync = null; return; }
    try { STATE.sync = await api().get('/hiryu-link/catalogue-request' + api().qs({ site_id: S.siteId() })); } catch (e) { STATE.sync = null; }
  }
  async function loadAll() {
    await Promise.all([loadCatalogue().catch(S.fail), loadBrands(), loadSync()]);
    paint();
  }

  let HOOKED = false;
  S.page(async function (ctx) {
    style();
    BODY = ctx.body;
    STATE = { cat: { stores: [], items: [] }, brands: [], sync: null, pulling: false,
      f: { site: '', brand: '', store: '', sku: '', avail: '', q: '' } };
    S.setSub('Toko dan menu dibuat di Hiryu dan masuk ke sini sendiri. Satu toko untuk satu merek.',
      'Stores and menus are made in Hiryu and arrive here by themselves. One store per brand.');
    BODY.innerHTML = '<div class="k-loading" ' + biAttr('Memuat…', 'Loading…') + '></div>';
    if (!HOOKED) {
      HOOKED = true;
      S.onSiteChange(() => { STATE.f = { site: '', brand: '', store: '', sku: '', avail: '', q: '' }; loadAll(); });
      document.addEventListener('njw:lang', paint);
    }
    await loadAll();
    /* The cooldown button turns back on by itself; the lists catch new stores. */
    ctx.every(30000, async () => {
      if (STATE.pulling) return;
      await Promise.all([loadSync(), loadCatalogue().catch(() => {})]);
      /* Not while someone is choosing a brand, filtering or typing. */
      const a = document.activeElement;
      if (a && BODY.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      if (document.querySelector('.k-scrim')) return;
      paint();
    });
  });
})();
