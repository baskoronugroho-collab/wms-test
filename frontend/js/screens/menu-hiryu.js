/* menu-hiryu: console, Hiryu menu items and stores (PRD §2.2.5, §2.12).
 *
 * With the link on, Hiryu sends its stores, SKUs and each store's menu by
 * itself (message 6), and this page shows what arrived: per store, each item
 * with its SKU, units per sale and price. An item with no SKU cannot be picked
 * and is fixed in Hiryu (Bundles), so it is highlighted, not edited here. A SKU
 * the catalogue created in the last week is marked baru for Lengkapi data SKU.
 *
 * The older tab is the interim bridge: Hiryu's menu CSV uploaded by brand and
 * items connected by hand. It is hidden while the link is on, because the next
 * catalogue from Hiryu would overwrite anything typed there.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, biAttr, applyLangTo, say, fail } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  NJW.screens['menu-hiryu'] = async () => {
    let brands = [], sites = [], skus = [], stores = [];
    const brandSel = field('brand');

    /* ---- tabs ---- */
    $$('.tab[data-tab]').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab[data-tab]').forEach(t => t.classList.toggle('is-on', t === tab));
      $$('.tabpanel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    }));

    const skuLabel = s => s.brand_sku_code + ' · ' + s.name_display;

    async function loadSkus() {
      const r = await NJW.api.skus({ brand_id: brandSel.value, limit: 500 });
      skus = r.skus;
      $('#sku-options').innerHTML = skus.map(s => '<option value="' + esc(skuLabel(s)) + '"></option>').join('');
    }

    async function loadItems() {
      const r = await NJW.api.hiryu.items({ brand_id: brandSel.value, unmapped: field('only-unmapped').checked || '' });
      setF('tab-items', r.items.length);
      const tb = region('items');
      if (!r.items.length) {
        tb.innerHTML = '<tr><td colspan="6" class="note" ' + biAttr('Belum ada barang. Unggah CSV menu dari Hiryu.',
          'No items yet. Upload the menu CSV from Hiryu.') + '></td></tr>';
        return applyLangTo(tb);
      }
      tb.innerHTML = r.items.map(it => {
        const cur = it.sku_id ? (it.sku_code || '') + ' · ' + (it.sku_name || '') : '';
        const status = !it.sku_id
          ? '<span class="tagline" style="background:var(--caution-bg);color:var(--caution)" ' + biAttr(it.seen_in_order ? 'Belum terhubung · ada pesanan' : 'Belum terhubung',
              it.seen_in_order ? 'Not connected · ordered' : 'Not connected') + '></span>'
          : '<span class="tagline" ' + biAttr('Terhubung', 'Connected') + '></span>';
        return '<tr data-item="' + it.id + '">' +
          '<td>' + esc(it.item_name || '') + '<br><span class="note" style="font-family:var(--font-code);font-size:12px">' + esc(it.hiryu_item_id) + '</span></td>' +
          '<td style="font-family:var(--font-code)">' + esc(it.barcode || '—') + '</td>' +
          '<td><input class="input" list="sku-options" data-sku value="' + esc(cur) + '" style="min-width:280px"></td>' +
          '<td class="td-num"><input class="input" type="number" min="1" max="99" data-ups value="' + it.units_per_sale + '" style="width:70px"></td>' +
          '<td>' + status + '</td>' +
          '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-save ' + biAttr('Simpan', 'Save') + '></button></td>' +
          '</tr>';
      }).join('');
      applyLangTo(tb);
    }

    region('items').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-save]');
      if (!b) return;
      const tr = b.closest('tr');
      const text = $('[data-sku]', tr).value.trim();
      const sku = text ? skus.find(s => skuLabel(s) === text || s.brand_sku_code === text) : null;
      if (text && !sku) return say(en() ? 'Choose a SKU from the list.' : 'Pilih SKU dari daftar.');
      b.disabled = true;
      try {
        await NJW.api.hiryu.mapItem(tr.dataset.item, { sku_id: sku ? sku.id : null, units_per_sale: +$('[data-ups]', tr).value || 1 });
        say(en() ? 'Saved.' : 'Tersimpan.');
        await loadItems();
      } catch (err) { b.disabled = false; say(oneLang(err.message)); }
    });

    field('csv').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      try {
        const r = await NJW.api.hiryu.menuImport(brandSel.value, fd);
        const msg = en()
          ? r.items + ' items · ' + r.auto_connected + ' connected by barcode · ' + r.needs_connecting + ' to connect'
          : r.items + ' barang · ' + r.auto_connected + ' terhubung lewat barcode · ' + r.needs_connecting + ' perlu dihubungkan';
        setF('import-result', msg);
        say(msg);
        await loadItems();
      } catch (err) { say(oneLang(err.message)); }
      e.target.value = '';
    };
    field('only-unmapped').onchange = () => loadItems().catch(fail);
    brandSel.onchange = async () => { await loadSkus(); await loadItems(); };

    /* ---- stores ---- */
    function storeRow(st, isNew) {
      const opt = (list, val, lab) => list.map(x => '<option value="' + x.id + '"' + (x.id === val ? ' selected' : '') + '>' + esc(lab(x)) + '</option>').join('');
      return '<tr data-no="' + (isNew ? '' : st.hiryu_store_no) + '">' +
        '<td class="td-num">' + (isNew ? '<input class="input" type="number" min="1" data-f="no" style="width:90px">' : '#' + st.hiryu_store_no) + '</td>' +
        '<td><input class="input" data-f="name" value="' + esc(st.store_name || '') + '"></td>' +
        '<td><input class="input" data-f="partner" value="' + esc(st.partner_store_id || '') + '"></td>' +
        '<td><select class="select" data-f="site">' + opt(sites, st.site_id, s => s.code) + '</select></td>' +
        '<td><select class="select" data-f="brand">' + opt(brands, st.brand_id, b => b.name) + '</select></td>' +
        '<td><input type="checkbox" data-f="active"' + (st.active !== false ? ' checked' : '') + '></td>' +
        '<td class="td-actions"><button class="cbtn cbtn--sm' + (isNew ? ' cbtn--primary' : '') + '" type="button" data-save-store ' +
          biAttr(isNew ? 'Tambah' : 'Simpan', isNew ? 'Add' : 'Save') + '></button></td></tr>';
    }

    async function loadStores() {
      stores = (await NJW.api.hiryu.stores()).stores;
      setF('tab-stores', stores.length);
      const tb = region('stores');
      tb.innerHTML = stores.map(s => storeRow(s, false)).join('') + storeRow({}, true);
      applyLangTo(tb);
    }

    region('stores').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-save-store]');
      if (!b) return;
      const tr = b.closest('tr');
      const v = k => $('[data-f="' + k + '"]', tr);
      const no = tr.dataset.no || v('no').value;
      if (!no) return say(en() ? 'Enter the Hiryu store number.' : 'Isi nomor toko Hiryu.');
      b.disabled = true;
      try {
        await NJW.api.hiryu.putStore(no, {
          store_name: v('name').value.trim(), partner_store_id: v('partner').value.trim() || null,
          site_id: +v('site').value, brand_id: +v('brand').value, active: v('active').checked,
        });
        say(en() ? 'Saved.' : 'Tersimpan.');
        await loadStores();
      } catch (err) { b.disabled = false; say(oneLang(err.message)); }
    });

    /* ---- the catalogue Hiryu sent (message 6) ---- */
    const catSel = field('cat-store');
    const idr = v => v == null ? '-' : 'Rp ' + Number(v).toLocaleString('id-ID');

    async function loadCatalogue() {
      const store = catSel.value || '';
      const cat = await NJW.api.raw.get('/hiryu-link/catalogue' + NJW.api.raw.qs({ store_no: store }));
      // Link on: the CSV path is closed (PRD §2.2.5, nothing is uploaded).
      const legacy = region('legacy-tab');
      if (legacy) legacy.hidden = !!cat.live;
      const csv = region('csv-upload');
      if (csv) csv.hidden = !!cat.live;
      const off = region('link-off-note');
      if (off) off.hidden = !!cat.live;
      if (cat.live && legacy && legacy.classList.contains('is-on')) $('.tab[data-tab="catalogue"]').click();

      const st = region('cat-stores');
      st.innerHTML = cat.stores.length ? cat.stores.map(x =>
        '<tr' + (x.unconnected ? ' style="background:var(--caution-bg)"' : '') + '>' +
        '<td class="td-num">#' + x.hiryu_store_no + '</td><td class="td-strong">' + esc(x.store_name) + '</td>' +
        '<td>' + esc(x.site_code) + '</td><td>' + esc(x.brand_name) + '</td>' +
        '<td><span class="tagline" ' + (x.active ? biAttr('Aktif', 'Active') : biAttr('Tidak aktif', 'Inactive')) + '></span></td>' +
        '<td class="td-num">' + x.items + '</td>' +
        '<td class="td-num"' + (x.unconnected ? ' style="color:var(--caution);font-weight:700"' : '') + '>' + x.unconnected + '</td>' +
        '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-open-store="' + x.hiryu_store_no + '" ' +
          biAttr('Lihat menu', 'View menu') + '></button></td></tr>').join('')
        : '<tr><td colspan="8" class="note" ' + biAttr('Hiryu belum mengirim toko.', 'Hiryu has not sent any store yet.') + '></td></tr>';
      applyLangTo(st);

      if (!catSel.options.length) {
        catSel.innerHTML = '<option value="" ' + biAttr('Pilih toko Hiryu', 'Choose a Hiryu store') + '></option>' +
          cat.stores.map(x => '<option value="' + x.hiryu_store_no + '">#' + x.hiryu_store_no + ' ' +
            esc(x.store_name) + ' (' + esc(x.site_code) + ')</option>').join('');
        applyLangTo(catSel);
      }
      setF('tab-catalogue', cat.stores.length);

      const tb = region('cat-items');
      if (!store) {
        tb.innerHTML = '<tr><td colspan="5" class="note" ' + biAttr('Pilih toko.', 'Choose a store.') + '></td></tr>';
        setF('cat-summary', '');
        return applyLangTo(tb);
      }
      const onlyUnmapped = field('cat-unmapped').checked;
      const items = cat.items.filter(i => !onlyUnmapped || (!i.sku_id && i.active));
      const open = cat.items.filter(i => i.active && !i.sku_id).length;
      setF('cat-summary', en()
        ? cat.items.filter(i => i.active).length + ' items · ' + open + ' without a SKU'
        : cat.items.filter(i => i.active).length + ' barang · ' + open + ' tanpa SKU');
      tb.innerHTML = items.length ? items.map(i => {
        const noSku = !i.sku_id;
        const status = !i.active ? '<span class="tagline" ' + biAttr('Tidak di menu lagi', 'No longer on the menu') + '></span>'
          : noSku ? '<span class="tagline" style="background:var(--caution-bg);color:var(--caution)" ' +
              biAttr('Belum terhubung di Hiryu', 'Not connected in Hiryu') + '></span>'
          : i.available_status === 'UNAVAILABLE' ? '<span class="tagline" ' + biAttr('Habis di Hiryu', 'Unavailable in Hiryu') + '></span>'
          : '<span class="tagline" ' + biAttr('Dijual', 'On sale') + '></span>';
        const sku = noSku ? '<span style="color:var(--caution);font-weight:600" ' + biAttr('Tanpa SKU', 'No SKU') + '></span>'
          : '<span style="font-family:var(--font-code)">' + esc(i.sku_code || '') + '</span>' +
            (i.sku_new ? ' <span class="spill spill--accent"><span class="spill__dot"></span><span ' + biAttr('baru', 'new') + '></span></span>' : '') +
            '<br><span class="note">' + esc(i.sku_name || '') + '</span>';
        return '<tr' + (noSku && i.active ? ' style="background:var(--caution-bg)"' : '') + (i.active ? '' : ' class="note"') + '>' +
          '<td>' + esc(i.item_name || '') + '<br><span class="note" style="font-family:var(--font-code);font-size:12px">' + esc(i.hiryu_item_id) + '</span></td>' +
          '<td>' + sku + '</td><td class="td-num">' + i.units_per_sale + '</td>' +
          '<td class="td-num">' + idr(i.price_idr) + '</td><td>' + status + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="note" ' + biAttr('Tidak ada barang.', 'No items.') + '></td></tr>';
      applyLangTo(tb);
    }
    catSel.onchange = () => loadCatalogue().catch(fail);
    field('cat-unmapped').onchange = () => loadCatalogue().catch(fail);
    region('cat-stores').addEventListener('click', e => {
      const b = e.target.closest('[data-open-store]');
      if (!b) return;
      catSel.value = b.dataset.openStore;
      loadCatalogue().catch(fail);
    });

    try {
      await loadCatalogue();
    } catch (e) { fail(e); }

    try {
      [brands, sites] = await Promise.all([NJW.api.brands(), NJW.api.raw.get('/sites')]);
      brandSel.innerHTML = brands.map(b => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
      await loadSkus();
      await Promise.all([loadItems(), loadStores()]);
    } catch (e) { fail(e); }
  };
})();
