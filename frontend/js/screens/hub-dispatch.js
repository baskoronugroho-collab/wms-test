/* screens/hub-dispatch.js — pack and seal a tote at the hub (19-gudang-kirim.html).
 *
 * Pick a destination darkstore, scan units into the tote, seal: POST
 * /api/transfers takes the stock out of the hub's ledger and returns the tote
 * reference that the darkstore scans at inbound to open the matching receipt.
 * Only then is the label filled and printed — a label for a tote the server
 * never recorded would be the one piece of paper nobody can reconcile.
 *
 * Every scan is resolved (GET /api/scan/resolve) and checked against what the
 * hub's rack holds before it joins the tote. The server would refuse an
 * over-draw at sealing time anyway; blocking it at the scan keeps the refusal
 * next to the unit that caused it, not at the end of a full tote.
 *
 * The tote in progress lives in sessionStorage, so a reload or a trip to the
 * menu does not empty it.
 *
 * This belongs to the restock model, which is outside the canonical WMS design
 * for now; the page says so.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail, CTX } = W;
  const api = NJW.api;

  const short = code => String(code || '').split('-').pop();
  const setAll = (f, v) => $$('[data-field="' + f + '"]').forEach(el => { el.textContent = v; });

  NJW.screens['hub-dispatch'] = async () => {
    const site = W.site();
    if (!site) return;

    const mode = $('.chrome__mode');
    if (mode) { mode.dataset.keep = '1'; bi(mode, short(site.code) + ' · Kirim tote', short(site.code) + ' · Dispatch totes'); }

    const zoneEl = $('.scanzone');
    const zone = zoneEl && zoneEl.__zone;
    const sealBtn = $('[data-action="seal"]');

    /* A darkstore receives totes through Barang masuk; it never sends one.
       The API does not check the site type, so the screen does. */
    if (site.site_type !== 'hub') {
      region('not-hub').style.display = '';
      bi(field('not-hub-body'),
        site.code + ' adalah darkstore. Darkstore menerima tote lewat Barang masuk — pindai label tote di sana.',
        site.code + ' is a darkstore. A darkstore receives totes through Inbound — scan the tote label there.');
      region('dispatch').style.display = 'none';
      if (sealBtn) sealBtn.disabled = true;
      const undo = $('[data-action="undo"]');
      if (undo) undo.disabled = true;
      if (zoneEl) zoneEl.hidden = true;
      return;
    }

    let tote = CTX.get('tote');
    if (!tote || tote.site_id !== site.id) tote = { site_id: site.id, dest: null, lines: [], history: [] };
    const save = () => CTX.set('tote', tote);

    /* ---- destinations ---- */
    let dests = [];
    try {
      // Every darkstore this hub may send to, not only the operator's own
      // sites. The server keeps training with training: a practice tote must
      // never move real stock anywhere.
      dests = await api.raw.get('/sites/destinations?from_site_id=' + site.id);
    } catch (e) { fail(e); }
    const dHost = region('dests');
    if (!dests.length) {
      dHost.innerHTML = '<span class="note" ' + biAttr(
        'Belum ada darkstore tujuan yang aktif.',
        'No active destination darkstore yet.') + '></span>';
      applyLangTo(dHost);
    } else {
      dHost.innerHTML = dests.map(s =>
        '<button class="dest" type="button" data-dest="' + s.id + '">' +
        '<span class="dest__code">' + esc(short(s.code)) + '</span>' +
        '<span class="dest__name">' + esc(s.name) + '</span></button>').join('');
    }
    if (tote.dest && !dests.some(s => s.id === tote.dest)) tote.dest = null;

    function paint() {
      const d = dests.find(s => s.id === tote.dest);
      $$('[data-dest]', dHost).forEach(b => b.classList.toggle('is-on', +b.dataset.dest === tote.dest));
      setF('dest-code', d ? short(d.code) : '—');
      const dn = field('dest-name');
      if (d) { delete dn.dataset.id; delete dn.dataset.en; dn.textContent = d.name; }
      else bi(dn, 'Pilih tujuan di bawah', 'Choose a destination below');
      const units = tote.lines.reduce((n, l) => n + l.qty, 0);
      setF('unit-count', units);
      setF('line-count', tote.lines.length);
      setF('bar-units', units);
      setF('bar-lines', tote.lines.length);
      const host = region('tote-lines');
      host.innerHTML = tote.lines.length ? tote.lines.map(l =>
        '<span class="toteline"><span class="toteline__name">' + esc(l.name) + '</span>' +
        '<span class="toteline__sku">' + esc(l.code || '') + '</span>' +
        '<span class="toteline__qty">' + l.qty + '</span></span>').join('')
        : '<span class="note" ' + biAttr('Tote masih kosong. Pilih tujuan, lalu pindai barang satu per satu.',
            'The tote is empty. Choose a destination, then scan items one by one.') + '></span>';
      applyLangTo(host);
      if (sealBtn) sealBtn.disabled = !(d && units);
    }

    dHost.addEventListener('click', e => {
      const b = e.target.closest('[data-dest]');
      if (!b) return;
      tote.dest = +b.dataset.dest;
      save();
      paint();
      if (zone) zone.focus();
    });

    /* ---- scanning ---- */
    async function onCode(code) {
      if (!tote.dest) return zone.reject('Pilih tujuan dulu', 'Tote ini untuk darkstore mana?');
      let r;
      try {
        r = await api.raw.get('/scan/resolve' + api.raw.qs({ code, site_id: site.id }));
      } catch (e) { return zone.reject('Gagal', e.message); }
      if (!r.found || !r.sku) return zone.reject('Barcode tidak dikenal', code);
      if (r.kind === 'unit_plate') {
        // A transfer moves SKU quantities, not individual plates; sending a
        // labelled unit this way would leave its plate "in stock" at the hub.
        return zone.reject('Barang berlabel unit belum bisa dikirim', r.sku.name_display);
      }
      if (!r.slot_location_code) return zone.reject('Tidak ada rak di hub ini', r.sku.name_display);
      const line = tote.lines.find(l => l.sku_id === r.sku.id);
      const have = line ? line.qty : 0;
      if (r.qty_on_hand != null && have + 1 > r.qty_on_hand) {
        return zone.reject('Stok di hub tidak cukup',
          r.qty_on_hand + ' di ' + r.slot_location_code + ' — tote sudah ' + have);
      }
      // The reference shown belongs to the tote just sealed; a new one has none yet.
      if (!tote.lines.length) setF('tote-ref', '—');
      if (line) line.qty += 1;
      else tote.lines.push({ sku_id: r.sku.id, name: r.sku.name_display, code: r.sku.brand_sku_code, qty: 1 });
      tote.history.push(r.sku.id);
      save();
      paint();
      zone.accept('Masuk tote', r.sku.name_display);
    }
    if (zone) { zone.onScan(onCode); W.testCodes(zoneEl, onCode); }

    const undo = $('[data-action="undo"]');
    if (undo) undo.onclick = () => {
      const skuId = tote.history.pop();
      if (skuId == null) return say('Tidak ada yang bisa dibatalkan.');
      const line = tote.lines.find(l => l.sku_id === skuId);
      if (line) {
        line.qty -= 1;
        if (line.qty <= 0) tote.lines = tote.lines.filter(l => l !== line);
      }
      save();
      paint();
      say('Satu unit dikeluarkan dari tote.');
    };

    /* ---- seal ---- */
    if (sealBtn) sealBtn.onclick = async () => {
      const d = dests.find(s => s.id === tote.dest);
      const units = tote.lines.reduce((n, l) => n + l.qty, 0);
      if (!d || !units) return;
      if (!confirm('Segel tote ke ' + short(d.code) + ' berisi ' + units + ' unit? Isinya terkunci setelah ini.')) return;
      sealBtn.disabled = true;
      let t;
      try {
        t = await api.createTransfer({
          from_site_id: site.id, to_site_id: d.id,
          lines: tote.lines.map(l => ({ sku_id: l.sku_id, quantity: l.qty })),
        });
      } catch (e) { sealBtn.disabled = false; return fail(e); }

      setF('tote-ref', t.reference);
      setAll('label-dest', short(d.code));
      setAll('label-site', d.name);
      setAll('label-ref', t.reference);
      setAll('label-units', t.total_dispatched);
      setAll('label-date', new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta' }));
      setAll('label-from', 'Dari ' + site.name);
      say('Tote ' + t.reference + ' disegel.');

      // The next tote usually goes to the same place; keep the destination.
      tote = { site_id: site.id, dest: d.id, lines: [], history: [] };
      save();
      setTimeout(() => {
        window.print();
        paint();
      }, 300);
    };

    paint();
  };
})();
