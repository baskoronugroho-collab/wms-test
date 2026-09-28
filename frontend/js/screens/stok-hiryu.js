/* stok-hiryu — console: the stock sheet the SPV types into Hiryu (PRD v3.3 §13.4, §13.6).
 *
 * Hiryu has no API yet, so stock reaches Grab by the SPV typing each number
 * into the store's Stock tab. Per Hiryu store (brand × hub):
 *   Ketik di Hiryu = on the shelf + picked but not marked ready − Grab buffer
 * Picked-not-ready units are added back because Hiryu takes stock off only at
 * Mark ready. Hiryu first: type there, then confirm here, which records what
 * was sent so the next sheet shows only what changed.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, esc, biAttr, applyLangTo, say, fail } = W;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const oneLang = m => { const p = String(m || '').split(' / '); return (en() ? p[1] : p[0]) || m; };

  function when(iso) {
    if (!iso) return '—';
    return NJW.toDate(iso).toLocaleString(en() ? 'en-GB' : 'id-ID',
      { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  NJW.screens['stok-hiryu'] = async () => {
    const site = W.site();
    const onlyChanged = field('only-changed');
    let sheet = null;

    function render() {
      const box = region('stores');
      if (!sheet.stores.length) {
        box.innerHTML = '<p class="note" ' + biAttr('Belum ada toko Hiryu untuk hub ini. Ops HQ memetakannya di Menu & toko Hiryu.',
          'No Hiryu store for this hub yet. Ops HQ maps them in Hiryu menu & stores.') + '></p>';
        return applyLangTo(box);
      }
      box.innerHTML = sheet.stores.map(st => {
        const lines = st.lines.filter(l => !onlyChanged.checked || l.changed);
        const changed = st.lines.filter(l => l.changed).length;
        return '<section class="card" style="margin-top:var(--sp-4);padding:var(--sp-4);background:var(--surface);border-radius:var(--radius-card);box-shadow:var(--shadow-1)" data-store="' + st.hiryu_store_no + '">' +
          '<div class="toolbar" style="margin-bottom:var(--sp-3)">' +
            '<strong style="font-size:17px">' + esc(st.store_name) + '</strong>' +
            '<span class="note">#' + st.hiryu_store_no + ' · ' + esc(st.brand_name) + '</span>' +
            '<span class="toolbar__spacer"></span>' +
            '<span class="note" ' + biAttr(changed + ' berubah', changed + ' changed') + '></span>' +
            (lines.length ? '<button class="cbtn cbtn--primary" type="button" data-typed="' + st.hiryu_store_no + '" ' +
              biAttr('Sudah disimpan di Hiryu', 'Saved in Hiryu') + '></button>' : '') +
          '</div>' +
          (lines.length ? '<div class="table-scroll"><table class="dtable"><thead><tr>' +
            '<th ' + biAttr('Kode SKU Hiryu', 'Hiryu SKU code') + '></th>' +
            '<th ' + biAttr('Produk', 'Product') + '></th>' +
            '<th class="td-num" ' + biAttr('Di rak', 'On shelf') + '></th>' +
            '<th class="td-num" ' + biAttr('Diambil, belum Mark ready', 'Picked, not marked ready') + '></th>' +
            '<th class="td-num" ' + biAttr('Cadangan Grab', 'Grab buffer') + '></th>' +
            '<th class="td-num" style="font-weight:700" ' + biAttr('Ketik di Hiryu', 'Type in Hiryu') + '></th>' +
            '<th class="td-num" ' + biAttr('Terakhir diketik', 'Last typed') + '></th>' +
            '</tr></thead><tbody>' +
            lines.map(l => '<tr' + (l.changed ? ' style="background:var(--caution-bg)"' : '') + '>' +
              '<td style="font-family:var(--font-code)">' + esc(l.hiryu_sku_code) + '</td>' +
              '<td>' + esc(l.name) + '</td>' +
              '<td class="td-num">' + l.on_shelf + '</td>' +
              '<td class="td-num">' + (l.picked_not_ready ? '+' + l.picked_not_ready : '0') + '</td>' +
              '<td class="td-num">' + (l.buffer ? '−' + l.buffer : '0') + '</td>' +
              '<td class="td-num" style="font-family:var(--font-code);font-size:18px;font-weight:700">' + l.to_type + '</td>' +
              '<td class="td-num note">' + (l.last_typed == null ? '—' : l.last_typed + ' · ' + esc(when(l.last_typed_at))) + '</td>' +
              '</tr>').join('') +
            '</tbody></table></div>'
            : '<p class="note" ' + biAttr('Semua angka sama dengan yang terakhir diketik.', 'Every number matches what was last typed.') + '></p>') +
          '</section>';
      }).join('');
      applyLangTo(box);
    }

    async function load() {
      sheet = await NJW.api.hiryu.stockSheet(site.id);
      render();
    }

    onlyChanged.onchange = render;
    $('[data-action="reload"]').onclick = () => load().catch(fail);

    region('stores').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-typed]');
      if (!b) return;
      const st = sheet.stores.find(s => String(s.hiryu_store_no) === b.dataset.typed);
      const lines = st.lines.filter(l => !onlyChanged.checked || l.changed);
      if (!confirm(en() ? 'Did you type these ' + lines.length + ' numbers into ' + st.store_name + ' in Hiryu?'
                        : 'Sudah mengetik ' + lines.length + ' angka ini ke ' + st.store_name + ' di Hiryu?')) return;
      b.disabled = true;
      try {
        await NJW.api.hiryu.stockTyped({ site_id: site.id, rows: lines.map(l => ({ sku_id: l.sku_id, qty: l.to_type })) });
        say(en() ? 'Recorded.' : 'Tercatat.');
        await load();
      } catch (err) { b.disabled = false; say(oneLang(err.message)); }
    });

    try { await load(); } catch (e) { fail(e); }
  };
})();
