/* menu-toko-hiryu.js: Menu & toko Hiryu (board 2e, kick-off step 8).
 *
 * Stores, menus and SKUs are made in Hiryu and arrive here by message 6. This
 * page shows them; the WMS adds only:
 *   - a new store's brand and Grab merchant account (asked once, Ops HQ):
 *       GET  /api/catalog/brands              brands with their account
 *       POST /api/catalog/brands              Merek baru (agent S)
 *       POST /api/hiryu-link/stores/{no}/assign {brand_id, grab_account}
 *   - each store's link (H8) and "active on Grab" (Ops HQ):
 *       PATCH /api/hiryu-link/stores/{no}      {link_on} | {grab_active}
 *   - Sinkron ulang dari Hiryu, any role, once per 5 minutes per hub:
 *       GET/POST /api/hiryu-link/catalogue-request
 * The lists: GET /api/hiryu-link/catalogue?site_id=&store_no=.
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, biAttr, bis, icon, t } = S;
  const api = () => S.api();

  /* "Indonesian / English" from the server, as a pair. */
  function split(text) {
    const m = /^(.{6,}?) \/ (.{6,})$/.exec(String(text || ''));
    return m ? [m[1], m[2]] : [String(text || ''), String(text || '')];
  }
  const span = (pair, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + ' ' + biAttr(pair[0], pair[1]) + '>' + esc(t(pair[0], pair[1])) + '</span>';
  const ACCOUNT = { own: ['Merek sendiri', 'Own account'], ninja: ['Ninja Van (Nemu Mart)', 'Ninja Van (Nemu Mart)'] };

  const CSS = `
  .mh-sync { display:flex; flex-wrap:wrap; align-items:center; gap:12px 16px; }
  .mh-sync__text { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 260px; }
  .mh-new { border:2px solid var(--caution-line); background:var(--caution-row); }
  .mh-new__head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .mh-choices { display:grid; gap:8px; }
  .mh-choice { display:flex; gap:12px; align-items:flex-start; padding:12px 14px; border:2px solid var(--rule); border-radius:12px; background:var(--surface); cursor:pointer; min-height:56px; }
  .mh-choice input { width:22px; height:22px; margin-top:2px; accent-color:var(--action); flex-shrink:0; }
  .mh-choice:has(input:checked) { border-color:var(--action); background:var(--action-bg); }
  .mh-choice:has(input:disabled) { cursor:not-allowed; opacity:.75; }
  .mh-choice__text { display:flex; flex-direction:column; gap:2px; }
  .mh-storerow { cursor:pointer; }
  .mh-storecell { min-width:200px; }
  .mh-nw { white-space:nowrap; }
  .mh-table td { padding-left:12px; padding-right:12px; }
  .mh-storerow:focus-visible { outline:3px solid rgba(31,78,140,.35); outline-offset:-3px; }
  .mh-nosku { color:var(--stop); font-weight:700; display:inline-flex; align-items:center; gap:6px; }
  .mh-switchcell { display:flex; align-items:center; gap:8px; }
  .mh-switchcell .k-switch { width:52px; height:30px; }
  .mh-switchcell .k-switch::after { width:24px; height:24px; }
  .mh-items-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
  .mh-search { max-width:320px; width:100%; }
  .mh-grid2 { display:grid; gap:16px; }
  @media (min-width:1024px) { .mh-grid2 { grid-template-columns:1fr 1fr; } }
  `;
  function style() {
    if (document.getElementById('mh-css')) return;
    const s = document.createElement('style');
    s.id = 'mh-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  let STATE = null;   // { cat, brands, sync, store, items, q }

  /* ------------------------------------------------------------ sync ---- */

  function syncHtml() {
    const sid = S.siteId();
    const st = STATE.sync;
    let line;
    if (!sid) {
      line = span(['Pilih satu dark store untuk sinkron ulang.', 'Choose one dark store to resync.'], 'k-strong');
    } else if (st && st.requested_at) {
      const who = st.requested_by_name || '-';
      const ans = st.status === 'answered'
        ? ' · ' + span(['dijawab Hiryu ' + S.fmt.time(st.answered_at), 'answered by Hiryu ' + S.fmt.time(st.answered_at)])
        : ' · ' + span(['menunggu jawaban Hiryu', 'waiting for Hiryu']);
      line = '<span class="k-strong">' + span(['Sinkron ulang ' + S.fmt.time(st.requested_at) + ' oleh ' + who,
        'Resync ' + S.fmt.time(st.requested_at) + ' by ' + who]) + '</span>' + '<span class="k-muted">' + ans + '</span>';
    } else {
      line = span(['Belum pernah sinkron ulang di dark store ini.', 'No resync at this dark store yet.'], 'k-strong');
    }
    const mins = (st && st.cooldown_minutes) || 5;
    const wait = st && st.next_allowed_at;
    const btn = !sid ? ''
      : wait
        ? '<button type="button" class="k-btn k-btn--secondary" disabled>' + icon('clock') + span(['Bisa lagi ' + S.fmt.time(wait), 'Possible again ' + S.fmt.time(wait)]) + '</button>'
        : '<button type="button" class="k-btn k-btn--secondary" data-sync>' + icon('refresh') + span(['Sinkron ulang dari Hiryu', 'Resync from Hiryu']) + '</button>';
    return '<div class="k-card k-card--pad mh-sync">' +
      '<div class="mh-sync__text"><div>' + line + '</div>' +
      '<span class="k-caption">' + span(['Semua peran bisa. Sekali per ' + mins + ' menit per dark store, tercatat dengan nama.',
        'Any role. Once every ' + mins + ' minutes per dark store, logged with your name.']) + '</span></div>' + btn + '</div>';
  }

  async function doSync(btn) {
    btn.disabled = true;
    try {
      const st = await api().post('/hiryu-link/catalogue-request', { site_id: S.siteId() });
      STATE.sync = st;
      S.toast(st.message || ['Permintaan dikirim ke Hiryu.', 'Request sent to Hiryu.'], 'ok');
    } catch (e) {
      if (e.status === 429) S.toast(e.message, 'caution'); else S.fail(e);
      await loadSync();
    }
    paint();
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
        'Order acceptance is not MANUAL. Set it to MANUAL in Hiryu: staff must press Accept.']) + '</div>' : '') +
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

  /* Merek baru: the brand form of agent S, in short (name + account). */
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

  function switchHtml(kind, s, on, label) {
    return '<span class="mh-switchcell"><button type="button" class="k-switch" data-sw="' + kind + '" data-no="' + s.hiryu_store_no + '" aria-checked="' + (on ? 'true' : 'false') + '"' +
      (S.atLeast('hq') ? '' : ' disabled') + ' aria-label="' + esc(t(label[0], label[1])) + '"></button>' +
      span(kind === 'grab' ? (on ? ['Aktif di Grab', 'Live on Grab'] : ['Grab: belum', 'Grab: not yet']) : (on ? ['Sambungan menyala', 'Link on'] : ['Sambungan mati', 'Link off']), 'k-caption mh-nw') + '</span>';
  }

  function brandCell(s) {
    if (!s.brand_id) return span(['Pilih di atas', 'Choose above'], 'k-muted mh-nw');
    return esc(s.brand_name || '-');
  }
  function accountCell(s) {
    if (!s.grab_account) return s.brand_id ? span(['Akun belum dipilih', 'Account not chosen'], 'mh-nw') : '';
    return span(s.grab_account === 'own' ? ['Merek sendiri', 'Own'] : ['Ninja Van', 'Ninja Van']);
  }
  function statePill(s) {
    if (!s.hiryu_active) return S.pill('stop', 'Nonaktif di Hiryu', 'Inactive in Hiryu');
    if (s.needs_brand) return S.pill('caution', 'Menunggu Ops HQ', 'Waiting for Ops HQ');
    return S.pill('ok', 'Aktif', 'Active');
  }

  function storeTable(stores) {
    const showHub = S.allSites();
    return '<div class="k-tablewrap"><table class="k-table mh-table"><thead><tr>' +
      '<th ' + biAttr('Toko', 'Store') + '></th>' + (showHub ? '<th ' + biAttr('Dark store', 'Dark store') + '></th>' : '') +
      '<th ' + biAttr('Merek · akun merchant', 'Brand · merchant account') + '></th>' +
      '<th ' + biAttr('Menu', 'Menu') + '></th>' +
      '<th ' + biAttr('Status', 'Status') + '></th><th ' + biAttr('Sambungan · Grab', 'Link · Grab') + '></th>' +
      '</tr></thead><tbody>' + stores.map((s) => {
        const sel = STATE.store === s.hiryu_store_no;
        const cls = sel ? 'is-selected' : s.needs_brand ? 'is-caution' : !s.hiryu_active ? 'is-stop' : '';
        return '<tr class="mh-storerow ' + cls + '" tabindex="0" data-store="' + s.hiryu_store_no + '">' +
          '<td class="mh-storecell"><div class="k-cell2"><span class="k-cell2__main">' + esc(s.store_name) + '</span>' +
          '<span class="k-cell2__sub">Hiryu #' + s.hiryu_store_no + ' · ' + span(['terima ' + (s.order_acceptance || '-'), 'accept ' + (s.order_acceptance || '-')]) +
          (s.acceptance_warning ? ' ' + icon('warn', 14) : '') + '</span></div></td>' +
          (showHub ? '<td class="k-mono k-strong">' + esc(S.shortCode(s.site_code)) + '</td>' : '') +
          '<td><div class="k-cell2"><span class="k-cell2__main">' + brandCell(s) + '</span><span class="k-cell2__sub">' + accountCell(s) + '</span></div></td>' +
          '<td><div class="k-cell2"><span class="k-cell2__main mh-nw">' + (s.items ? span([S.fmt.n(s.items) + ' item', S.fmt.n(s.items) + ' items']) : span(['Belum ada menu', 'No menu yet'], 'k-muted')) + '</span>' +
          (s.unconnected ? '<span class="k-cell2__sub mh-nosku mh-nw">' + icon('warn', 14) + span([s.unconnected + ' tanpa SKU', s.unconnected + ' without SKU']) + '</span>' : '') + '</div></td>' +
          '<td class="mh-nw">' + statePill(s) + '</td>' +
          '<td><div class="k-stack k-stack--tight">' + switchHtml('link', s, s.link_on, ['Sambungan toko', 'Store link']) +
          switchHtml('grab', s, s.grab_active, ['Aktif di Grab', 'Active on Grab']) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function storeRows(stores) {
    return '<div class="k-list">' + stores.map((s) => {
      const kind = s.needs_brand ? 'caution' : !s.hiryu_active ? 'stop' : '';
      const sub = [esc(S.shortCode(s.site_code)), s.brand_id ? esc(s.brand_name) : span(['merek belum dipilih', 'no brand yet']),
        span([(s.items || 0) + ' item', (s.items || 0) + ' items'])];
      if (s.unconnected) sub.push('<span class="mh-nosku">' + span([s.unconnected + ' tanpa SKU', s.unconnected + ' without SKU']) + '</span>');
      return '<button type="button" class="k-row' + (kind ? ' k-row--' + kind : '') + '" data-store="' + s.hiryu_store_no + '">' +
        '<span class="k-row__icon' + (kind ? ' k-row__icon--' + kind : ' k-row__icon--ok') + '">' + icon(kind ? 'warn' : 'bag', 24) + '</span>' +
        '<span class="k-row__text"><span class="k-row__title">' + esc(s.store_name) + ' · #' + s.hiryu_store_no + '</span>' +
        '<span class="k-row__sub">' + sub.join(' · ') + '</span></span><span class="k-row__chev">' + icon('chev', 22) + '</span></button>';
    }).join('') + '</div>';
  }

  async function onSwitch(kind, no, on) {
    const body = kind === 'link' ? { link_on: on } : { grab_active: on };
    if (kind === 'link' && on) {
      const ok = await S.confirm({
        title: ['Nyalakan sambungan toko?', 'Switch the store link on?'],
        text: ['WMS langsung mengirim stok penuh toko ini, dan Hiryu berhenti menghitung stoknya sendiri. Lakukan bersama Shaun (langkah 13).',
          'The WMS sends this store\'s full stock at once, and Hiryu stops its own stock count. Do it with Shaun (step 13).'],
        ok: ['Ya, nyalakan', 'Yes, switch on'],
      });
      if (!ok) return false;
    }
    const res = await api().patch('/hiryu-link/stores/' + no, body);
    S.toast(res.message, 'ok');
    await loadCatalogue();
    paint();
  }

  /* ----------------------------------------------------------- items ---- */

  function itemsHtml() {
    const s = (STATE.cat.stores || []).find((x) => x.hiryu_store_no === STATE.store);
    if (!s) return '';
    const q = (STATE.q || '').toLowerCase();
    const items = (STATE.items || []).filter((i) => !q || (i.item_name || '').toLowerCase().includes(q) ||
      (i.sku_code || '').toLowerCase().includes(q) || (i.hiryu_item_id || '').toLowerCase().includes(q));
    const head = '<div class="mh-items-head"><div><div class="k-eyebrow" ' + biAttr('Menu toko', 'Store menu') + '></div>' +
      '<div class="k-h2" style="font-size:20px">' + esc(s.store_name) + ' <span class="k-muted k-mono" style="font-size:14px">#' + s.hiryu_store_no + '</span></div>' +
      '<span class="k-caption">' + span([s.items + ' item · ' + s.unconnected + ' tanpa SKU', s.items + ' items · ' + s.unconnected + ' without SKU']) + '</span></div>' +
      '<div class="k-search mh-search">' + icon('search', 18) + '' +
      '<input class="k-input" type="search" data-q value="' + esc(STATE.q || '') + '" data-ph-id="Cari item atau SKU" data-ph-en="Search item or SKU"></div></div>';
    const switches = '<div class="k-phone-only k-stack k-stack--tight" style="padding:4px 0">' +
      switchHtml('link', s, s.link_on, ['Sambungan toko', 'Store link']) + switchHtml('grab', s, s.grab_active, ['Aktif di Grab', 'Active on Grab']) + '</div>';
    if (!s.items) {
      return '<div class="k-card k-card--pad k-stack" id="mh-items">' + head + switches + '<div class="k-empty"><span class="k-empty__icon k-empty__icon--muted">' + icon('list', 28) + '</span>' +
        span(['Belum ada menu', 'No menu yet'], 'k-empty__title') + span(['Menu dibuat di Hiryu lalu masuk ke sini sendiri.', 'The menu is made in Hiryu and arrives here by itself.'], 'k-empty__text') + '</div></div>';
    }
    const skuCell = (i) => i.sku_id
      ? '<div class="k-cell2"><span class="k-cell2__main k-mono">' + esc(i.sku_code || '') + (i.sku_new ? ' <span class="k-tag" ' + biAttr('baru', 'new') + '></span>' : '') + '</span>' +
        '<span class="k-cell2__sub">' + esc(i.sku_name || '') + '</span></div>'
      : '<span class="mh-nosku">' + icon('warn', 16) + span(['Item tanpa SKU', 'Item without SKU']) + '</span>' +
        (i.sku_code ? '<div class="k-caption k-mono">' + esc(i.sku_code) + '</div>' : '');
    const avail = (i) => !i.active ? S.pill('stop', 'Tidak di menu', 'Off the menu')
      : (i.available_status || '').toUpperCase() === 'AVAILABLE' ? S.pill('ok', 'Tersedia', 'Available') : S.pill('caution', 'Dimatikan', 'Switched off');
    const table = '<div class="k-tablewrap k-laptop-only"><table class="k-table"><thead><tr>' +
      '<th ' + biAttr('Item menu', 'Menu item') + '></th><th ' + biAttr('SKU (Bundles)', 'SKU (Bundles)') + '></th>' +
      '<th class="k-num" ' + biAttr('Unit per jual', 'Units per sale') + '></th><th class="k-num" ' + biAttr('Harga', 'Price') + '></th><th ' + biAttr('Di Hiryu', 'In Hiryu') + '></th>' +
      '</tr></thead><tbody>' + items.map((i) => '<tr class="' + (!i.sku_id && i.active ? 'is-stop' : '') + '">' +
        '<td><div class="k-cell2"><span class="k-cell2__main">' + esc(i.item_name || '-') + '</span><span class="k-cell2__sub k-mono">' + esc(i.hiryu_item_id) + '</span></div></td>' +
        '<td>' + skuCell(i) + '</td><td class="k-num">' + esc(String(i.units_per_sale)) + '</td>' +
        '<td class="k-num mh-nw">' + esc(S.fmt.rp(i.price_idr)) + '</td><td class="mh-nw">' + avail(i) + '</td></tr>').join('') +
      '</tbody></table></div>';
    const rows = '<div class="k-list k-phone-only">' + items.map((i) => '<div class="k-row' + (!i.sku_id && i.active ? ' k-row--stop' : '') + '">' +
      '<span class="k-row__text"><span class="k-row__title">' + esc(i.item_name || '-') + '</span>' +
      '<span class="k-row__sub">' + (i.sku_id ? '<span class="k-mono">' + esc(i.sku_code || '') + '</span>' : '<span class="mh-nosku">' + span(['Item tanpa SKU', 'Item without SKU']) + '</span>') +
      ' · ' + span([i.units_per_sale + ' unit per jual', i.units_per_sale + ' per sale']) + ' · <span class="mh-nw">' + esc(S.fmt.rp(i.price_idr)) + '</span></span></span></div>').join('') + '</div>';
    return '<div class="k-card k-card--pad k-stack" id="mh-items">' + head + switches +
      (items.length ? table + rows : '<p class="k-muted" ' + biAttr('Tidak ada yang cocok.', 'Nothing matches.') + '></p>') + '</div>';
  }

  async function openStore(no) {
    STATE.store = no;
    STATE.q = '';
    try {
      const r = await api().get('/hiryu-link/catalogue' + api().qs({ site_id: S.siteId(), store_no: no }));
      STATE.cat = r;
      STATE.items = r.items || [];
    } catch (e) { S.fail(e); }
    paint();
    const el = document.getElementById('mh-items');
    if (el && window.innerWidth < 1024) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ----------------------------------------------------------- paint ---- */

  /* The search box filters the item list without repainting the page. */
  function wireSearch(qi) {
    if (!qi) return;
    qi.addEventListener('input', () => {
      STATE.q = qi.value;
      const pos = qi.selectionStart;
      const card = document.getElementById('mh-items');
      if (!card) return;
      card.outerHTML = itemsHtml();
      const fresh = document.getElementById('mh-items');
      S.applyLang(fresh);
      fresh.querySelectorAll('[data-sw]').forEach((b) => S.toggle(b, (on) => onSwitch(b.dataset.sw, +b.dataset.no, on)));
      const input = fresh.querySelector('[data-q]');
      wireSearch(input);
      input.focus();
      try { input.setSelectionRange(pos, pos); } catch (e) { /* not supported */ }
    });
  }

  let BODY = null;
  function paint() {
    if (!STATE || !BODY) return;
    const stores = STATE.cat ? STATE.cat.stores || [] : [];
    const pending = stores.filter((s) => s.needs_brand && s.hiryu_active);
    const nosku = stores.reduce((n, s) => n + (s.unconnected || 0), 0);
    BODY.innerHTML =
      '<div class="k-stack k-stack--loose">' + syncHtml() +
      pending.map(newStoreHtml).join('') +
      (stores.length
        ? '<div class="k-card"><div class="k-card__head" style="padding:16px 20px 0"><div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px">' +
          '<span class="k-h2" style="font-size:18px">' + span(['Toko di Hiryu', 'Stores in Hiryu']) + ' <span class="k-muted">(' + stores.length + ')</span></span>' +
          (nosku ? '<span class="k-pill k-pill--stop"><span class="k-pill__dot"></span>' + span([nosku + ' item tanpa SKU', nosku + ' items without SKU']) + '</span>' : '') +
          '</div></div><div class="k-laptop-only" style="padding-top:12px">' + storeTable(stores) + '</div>' +
          '<div class="k-phone-only" style="padding:12px">' + storeRows(stores) + '</div></div>'
        : '<div class="k-card k-empty"><span class="k-empty__icon k-empty__icon--muted">' + icon('bag', 28) + '</span>' +
          span(['Belum ada toko dari Hiryu', 'No stores from Hiryu yet'], 'k-empty__title') +
          span(['Toko dibuat di Hiryu dan masuk ke sini sendiri. Jika ada yang kurang, tekan Sinkron ulang dari Hiryu.',
            'Stores are made in Hiryu and arrive here by themselves. If something is missing, press Resync from Hiryu.'], 'k-empty__text') + '</div>') +
      itemsHtml() +
      '<div class="k-note">' + icon('info') + '<div class="k-stack k-stack--tight">' +
      span(['Akun merchant ikut merek, sama untuk semua toko merek itu. Grab minta minimal 10 SKU untuk akun merek sendiri. Merek di bawah 10 SKU dijual lewat akun merchant Ninja Van (Nemu Mart).',
        'The merchant account follows the brand, the same for every store of that brand. Grab asks at least 10 SKUs for an own account. Brands under 10 SKUs sell through Ninja Van\'s merchant account (Nemu Mart).']) +
      span(['Item tanpa SKU: item menu yang belum disambungkan ke SKU di Hiryu (Bundles). Pesanan untuk item itu tidak bisa diambil. Sambungkan di Hiryu sebelum toko diaktifkan di Grab.',
        'Item without SKU: a menu item not yet connected to a SKU in Hiryu (Bundles). Orders for it cannot be picked. Connect it in Hiryu before the store goes live on Grab.']) +
      '</div></div></div>';

    BODY.querySelectorAll('[data-new]').forEach(wireNew);
    const sb = BODY.querySelector('[data-sync]');
    if (sb) sb.addEventListener('click', () => doSync(sb));
    BODY.querySelectorAll('[data-store]').forEach((el) => {
      const go = (ev) => { if (ev.target.closest('.mh-switchcell')) return; openStore(+el.dataset.store); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(ev); });
    });
    BODY.querySelectorAll('[data-sw]').forEach((b) => S.toggle(b, (on) => onSwitch(b.dataset.sw, +b.dataset.no, on)));
    wireSearch(BODY.querySelector('[data-q]'));
    S.applyLang(BODY);
    S.lockAll(BODY);
  }

  /* ------------------------------------------------------------ load ---- */

  async function loadCatalogue() {
    const r = await api().get('/hiryu-link/catalogue' + api().qs({ site_id: S.siteId(), store_no: STATE.store || null }));
    STATE.cat = r;
    STATE.items = r.items || [];
    if (STATE.store && !(r.stores || []).some((s) => s.hiryu_store_no === STATE.store)) STATE.store = null;
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
    if (!STATE.store) {
      const first = (STATE.cat.stores || []).find((s) => !s.needs_brand && s.items) || (STATE.cat.stores || [])[0];
      if (first) {
        STATE.store = first.hiryu_store_no;
        try { await loadCatalogue(); } catch (e) { S.fail(e); }
      }
    }
    paint();
  }

  let HOOKED = false;
  S.page(async function (ctx) {
    style();
    BODY = ctx.body;
    STATE = { cat: { stores: [] }, brands: [], sync: null, store: null, items: [], q: '' };
    S.setSub('Toko dan menu dibuat di Hiryu dan masuk ke sini sendiri. Satu toko untuk satu merek.',
      'Stores and menus are made in Hiryu and arrive here by themselves. One store per brand.');
    BODY.innerHTML = '<div class="k-loading" ' + biAttr('Memuat…', 'Loading…') + '></div>';
    if (!HOOKED) {
      HOOKED = true;
      S.onSiteChange(() => { STATE.store = null; loadAll(); });
      document.addEventListener('njw:lang', paint);
    }
    await loadAll();
    /* The cooldown button turns back on by itself; the lists catch new stores. */
    ctx.every(30000, async () => {
      await Promise.all([loadSync(), loadCatalogue().catch(() => {})]);
      /* Not while someone is choosing a brand or typing. */
      const a = document.activeElement;
      if (a && BODY.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
      if (document.querySelector('.k-scrim')) return;
      paint();
    });
  });
})();
