/* return-scan.js — 18b: scan each unit back onto its rack.
 *
 * One scan, one unit back in stock (a `return_in` movement, which also sends
 * message 3 so Hiryu can sell it again). The scan is verified exactly like a
 * pick: a different SKU is refused and there is no override.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, setF, bi, biAttr, applyLangTo, say, fail, go, key, codeHtml } = W;

  NJW.screens['return-scan'] = async () => {
    const site = W.site();
    const id = +new URLSearchParams(location.search).get('task');
    if (!id) return go('18-kembalikan.html');

    const r = await NJW.api.returns({ site_id: site.id, status: 'open' });
    let task = r.tasks.find(t => t.id === id);
    if (!task) {
      say('Tugas ini sudah selesai. / This return is already done.');
      return setTimeout(() => go('18-kembalikan.html'), 1200);
    }

    function paint() {
      setF('order-ref', task.external_ref || '—');
      const loc = field('location-code');
      if (loc) loc.innerHTML = task.location_code ? codeHtml(task.location_code) : '—';
      setF('remaining', task.qty - task.qty_returned);
      setF('sku-name', task.sku_name);
      setF('sku-meta', task.brand_sku_code || '');
      const photo = field('photo');
      if (photo) {
        photo.alt = task.sku_name;
        photo.dataset.photoKey = (task.brand_sku_code || '').toLowerCase();
        NJW.paintPhotos(photo.parentNode);
      }
    }
    paint();

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    let busy = false;

    async function doScan(code) {
      if (busy) return;
      busy = true;
      try {
        const res = await NJW.api.returnScan(task.id, { code, idempotency_key: key() });
        task = res.task;
        paint();
        zone.accept('Benar', task.sku_name);
        if (res.done) {
          say('Selesai — semua sudah kembali di rak. / Done — all back on the rack.');
          setTimeout(() => go('18-kembalikan.html'), 1400);
        }
      } catch (e) {
        if (e.status === 401) return fail(e);
        // A wrong item is held on screen until the person acts: no override.
        zone.reject(e.status === 409 ? 'Salah barang' : 'Gagal', e.message);
      } finally { busy = false; }
    }
    if (zone) zone.onScan(doScan);

    // Training: one tap for the right item and one for a wrong one, so both
    // paths can be practised without a physical unit in hand.
    if (site.is_training && zoneEl) {
      try {
        const sheet = await NJW.api.raw.get('/training/barcode-sheet?site_id=' + site.id + '&limit=500');
        const right = sheet.rows.find(x => x.sku_id === task.sku_id);
        const wrong = sheet.rows.find(x => x.sku_id !== task.sku_id);
        const box = document.createElement('div');
        box.className = 'panel';
        box.style.cssText = 'padding:12px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
        box.innerHTML = '<span class="eyebrow" ' + biAttr('Barcode uji', 'Test barcodes') + '>Barcode uji</span>';
        [[right, 'Barang yang benar', 'The right item'], [wrong, 'Barang yang salah', 'A wrong item']]
          .forEach(([row, idText, en]) => {
            if (!row) return;
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn--outline';
            b.style.cssText = 'min-height:40px;padding:0 12px';
            bi(b, idText, en);
            b.title = row.sku_name + ' · ' + row.barcode;
            b.onclick = () => doScan(row.barcode);
            box.appendChild(b);
          });
        zoneEl.parentNode.insertBefore(box, zoneEl.nextSibling);
        applyLangTo(box);
      } catch { /* training-only nicety */ }
    }
  };
})();
