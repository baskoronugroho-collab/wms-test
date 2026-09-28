/* menu-hiryu — console: Hiryu menu items and stores, kept by Ops HQ (PRD v3.3 §13.3).
 *
 * Hiryu first: the menu and SKUs are built in Hiryu, then its menu CSV comes
 * here. An item whose barcode matches a WMS SKU of the brand connects itself
 * at 1 unit per sale; the rest are connected by hand, with units per sale for
 * bundles. The store map ties each Hiryu store number to a hub and a brand,
 * which is how a pasted order finds its hub.
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

    try {
      [brands, sites] = await Promise.all([NJW.api.brands(), NJW.api.raw.get('/sites')]);
      brandSel.innerHTML = brands.map(b => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
      await loadSkus();
      await Promise.all([loadItems(), loadStores()]);
    } catch (e) { fail(e); }
  };
})();
