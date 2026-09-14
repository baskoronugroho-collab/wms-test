/* returns.js — 18: the return-to-shelf list.
 *
 * Units from cancelled orders. A pick took them off the ledger, so until
 * somebody scans each one back at the rack they are stock nobody can sell.
 * Oldest first; anyone on shift can work it (PRD decision: return by anyone).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { region, setF, esc, biAttr, applyLangTo, fail, codeHtml } = W;

  function since(sec) {
    if (sec == null) return '';
    const m = Math.max(0, Math.round(sec / 60));
    if (m < 60) return m + ' mnt';
    return Math.floor(m / 60) + ' jam ' + String(m % 60).padStart(2, '0') + ' mnt';
  }

  function row(t) {
    const left = t.qty - t.qty_returned;
    return '<div class="task task--low" data-task-id="' + t.id + '">' +
      '<img class="task__photo" src="assets/products/placeholder.svg" data-photo-key="' +
        esc((t.brand_sku_code || '').toLowerCase()) + '" alt="">' +
      '<span class="task__ident">' +
        '<span class="task__name">' + esc(t.sku_name) + '</span>' +
        '<span class="task__sku">' + esc(t.brand_sku_code || '') +
          (t.qty_returned ? ' · <span ' + biAttr('sudah kembali', 'already back') +
            '>sudah kembali</span> ' + t.qty_returned + ' / ' + t.qty : '') + '</span>' +
      '</span>' +
      '<span class="task__move">' +
        '<span class="task__loc">' +
          '<span class="task__loc-label" ' + biAttr('Dari pesanan batal', 'From cancelled order') +
            '>Dari pesanan batal</span>' +
          '<span class="task__loc-code">' + esc(t.external_ref || '—') + '</span>' +
        '</span>' +
        '<span class="task__arrow" aria-hidden="true">→</span>' +
        '<span class="task__loc">' +
          '<span class="task__loc-label" ' + biAttr('Ke rak', 'To rack') + '>Ke rak</span>' +
          '<span class="task__loc-code">' + (t.location_code ? codeHtml(t.location_code) :
            '<span ' + biAttr('Belum ada rak', 'No rack yet') + '>Belum ada rak</span>') + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="task__qty">' +
        '<span class="task__qty-num">' + left + '</span>' +
        '<span class="task__qty-unit" ' + biAttr('unit', 'units') + '>unit</span>' +
      '</span>' +
      '<span class="task__since">' +
        '<span class="tasktag tasktag--low" ' + biAttr('Dibatalkan', 'Cancelled') + '>Dibatalkan</span>' +
        '<span class="note" style="font-size:13px">' + since(t.age_seconds) + '</span>' +
      '</span>' +
      '<a class="btn btn--primary" href="18-kembalikan-pindai.html?task=' + t.id + '" ' +
        biAttr('Kerjakan', 'Do it') + '>Kerjakan</a>' +
    '</div>';
  }

  NJW.screens.returns = async () => {
    const site = W.site();
    const list = region('tasks'), empty = region('empty');

    async function load() {
      const r = await NJW.api.returns({ site_id: site.id, status: 'open' });
      setF('task-count', r.open_count);
      setF('unit-count', r.tasks.reduce((n, t) => n + (t.qty - t.qty_returned), 0));
      list.innerHTML = r.tasks.map(row).join('');
      list.hidden = !r.tasks.length;
      if (empty) empty.hidden = !!r.tasks.length;
      applyLangTo(list);
      NJW.paintPhotos(list);
    }

    try { await load(); } catch (e) { fail(e); }
    // Cancellations arrive from Hiryu at any time; the list keeps itself fresh.
    setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 15000);
  };
})();
