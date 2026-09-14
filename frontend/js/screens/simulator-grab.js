/* simulator-grab.js — console: the order simulator for training sites.
 *
 * Every real order reaches the WMS from Hiryu (the OMS), whatever channel the
 * customer used, and only Hiryu may send one. On a training site this page
 * stands in for Hiryu: it composes orders through the same intake path, and
 * can cancel them (message 2) so trainees see what a cancel does to picked
 * units.
 *
 * The gate is not decoration. The API refuses a test order on a live site,
 * but a user must never get as far as the refusal, so nothing on this page
 * calls a training endpoint unless the active site says is_training.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail, CTX } = W;
  const api = () => NJW.api;

  const CHANNEL = { grab: 'Grab', whatsapp: 'WhatsApp', web: 'Web', instagram: 'Instagram' };
  const MODE = {
    grab_rider: ['Kurir Grab', 'Grab rider'],
    ninja_rider: ['Kurir Ninja', 'Ninja rider'],
    third_party: ['Kurir pihak ketiga', 'Third-party courier'],
    next_day: ['Kirim besok', 'Next day'],
  };
  const ORDER_STATUS = {
    received: ['spill--info', 'Diterima', 'Received'],
    picked: ['spill--ok', 'Siap · pesan 4 terkirim', 'Ready · message 4 sent'],
    cancelled: ['spill--neutral', 'Dibatalkan', 'Cancelled'],
  };
  const PICK_STATUS = {
    ready: ['spill--neutral', 'Menunggu', 'Pending'],
    claimed: ['spill--info', 'Sedang diambil', 'Picking'],
    blocked: ['spill--stop', 'Terkunci', 'Blocked'],
    completed: ['spill--ok', 'Selesai', 'Done'],
    cancelled: ['spill--neutral', 'Dibatalkan', 'Cancelled'],
  };
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const spill = (s, fallback) => {
    const [cls, id, e] = s || fallback;
    return '<span class="spill ' + cls + '"><span class="spill__dot"></span><span ' + biAttr(id, e) + '>' + esc(id) + '</span></span>';
  };

  NJW.screens['simulator-grab'] = async () => {
    const site = W.site(), me = W.me();

    /* ---- which site: real sites from /me, never the design's TRN/UT5 ---- */
    const seg = region('site-seg');
    if (seg) {
      seg.innerHTML = me.sites.map(s =>
        '<button class="seg__opt' + (s.id === site.id ? ' is-on' : '') + '" type="button" data-site="' + s.id + '">' +
        esc(s.code) + ' — <span ' + (s.is_training ? biAttr('latihan', 'training') + '>latihan'
                                                      : biAttr('live', 'live') + '>live') + '</span></button>').join('');
      applyLangTo(seg);
      seg.addEventListener('click', e => {
        const b = e.target.closest('[data-site]');
        if (!b || +b.dataset.site === site.id) return;
        CTX.set('site', +b.dataset.site);
        location.reload();
      });
    }
    NJW.setTrainingGate(!!site.is_training, site.code);
    const trainingSite = me.sites.find(s => s.is_training);
    const switchBtn = $('[data-action="switch-training"]');
    if (switchBtn) {
      if (trainingSite) {
        bi(switchBtn, 'Ganti ke ' + trainingSite.code + ' — lokasi latihan', 'Switch to ' + trainingSite.code + ' — training site');
        switchBtn.onclick = () => { CTX.set('site', trainingSite.id); location.reload(); };
      } else {
        switchBtn.disabled = true;
        bi(switchBtn, 'Akunmu belum punya lokasi latihan', 'Your account has no training site');
      }
    }
    if (!site.is_training) {
      const host = region('testorders');
      if (host) host.innerHTML = '';
      return;   // fail closed: no training call from a live site
    }
    setF('train-site', site.code);

    /* ---- stock at this site, once, for search hints ---- */
    let stock = new Map();   // sku_id -> available units across its locations
    async function loadStock() {
      try {
        const inv = await api().inventory({ site_id: site.id, limit: 1000 });
        stock = new Map();
        inv.rows.forEach(r => stock.set(r.sku_id, (stock.get(r.sku_id) || 0) + r.available));
      } catch { /* hints only */ }
    }

    /* ---- channel and delivery mode ---- */
    let channel = 'grab';
    const chanSeg = region('channel');
    const delivery = region('delivery');
    const modeSel = field('delivery-mode');

    function paintChannel() {
      $$('[data-channel]', chanSeg).forEach(b => b.classList.toggle('is-on', b.dataset.channel === channel));
      // Grab assigns its own rider; the other channels choose the last mile.
      if (delivery) delivery.style.display = channel === 'grab' ? 'none' : '';
      const note = field('promise-note');
      if (channel === 'grab') {
        bi(note, 'Grab: harus siap 15 menit setelah pesanan sampai di Hiryu. Kurirnya dari Grab.',
                 'Grab: must be ready 15 minutes after the order reaches Hiryu. Grab sends the rider.');
      } else {
        bi(note, CHANNEL[channel] + ': harus siap 1 jam setelah pelanggan memesan.',
                 CHANNEL[channel] + ': must be ready 1 hour after the customer ordered.');
      }
    }
    if (chanSeg) chanSeg.addEventListener('click', e => {
      const b = e.target.closest('[data-channel]');
      if (!b) return;
      channel = b.dataset.channel;
      paintChannel();
    });
    paintChannel();

    /* ---- compose: search, lines, send ---- */
    const results = region('sku-results');
    const linesHost = region('compose-lines');
    const EMPTY_LINES = linesHost ? linesHost.innerHTML : '';
    const searchInput = field('sku-search');
    const lines = new Map();   // sku_id -> {sku, qty}
    let found = [];

    function avail(id) { return stock.has(id) ? stock.get(id) : 0; }

    function stockNote(id, qty) {
      const a = avail(id);
      if (qty > a) {
        return '<span class="spill spill--warn"><span class="spill__dot"></span><span ' +
          biAttr('stok ' + a + ' — akan kurang', a + ' in stock — will go short') + '>stok ' + a +
          ' — akan kurang</span></span>';
      }
      return '<span style="color:var(--muted);white-space:nowrap" ' + biAttr('stok ' + a, a + ' in stock') + '>stok ' + a + '</span>';
    }

    function renderLines() {
      if (!linesHost) return;
      if (!lines.size) { linesHost.innerHTML = EMPTY_LINES; applyLangTo(linesHost); return; }
      linesHost.innerHTML = Array.from(lines.values()).map(({ sku, qty }) =>
        '<span class="lineitem" data-sku="' + sku.id + '">' +
        '<span class="lineitem__name" title="' + esc(sku.name_display) + '">' + esc(sku.name_display) + '</span>' +
        '<span class="td-code" style="color:var(--muted)">' + esc(sku.brand_sku_code) + '</span>' +
        '<span data-field="stock-note">' + stockNote(sku.id, qty) + '</span>' +
        '<span class="stepper"><button class="stepper__btn" type="button" data-step="down">−</button>' +
        '<span class="stepper__val">' + qty + '</span>' +
        '<button class="stepper__btn" type="button" data-step="up">+</button></span>' +
        '<button class="cbtn cbtn--sm cbtn--ghost" type="button" data-remove="' + sku.id + '" aria-label="' +
        (en() ? 'Remove line' : 'Hapus baris') + '">✕</button></span>').join('');
      applyLangTo(linesHost);
    }

    // console.js owns the steppers' numbers, on a document-level listener that
    // fires after this one; read the value on the next tick, once it has
    // moved, to keep our copy and the "will go short" hint in step.
    if (linesHost) linesHost.addEventListener('click', e => {
      const rm = e.target.closest('[data-remove]');
      if (rm) { lines.delete(+rm.dataset.remove); renderLines(); return; }
      const item = e.target.closest('.lineitem');
      if (!item || !e.target.closest('.stepper__btn')) return;
      setTimeout(() => {
        const entry = lines.get(+item.dataset.sku);
        if (!entry) return;
        entry.qty = parseInt($('.stepper__val', item).textContent, 10) || 1;
        const note = field('stock-note', item);
        if (note) { note.innerHTML = stockNote(entry.sku.id, entry.qty); applyLangTo(note); }
      }, 0);
    });

    function renderResults() {
      if (!results) return;
      results.innerHTML = found.map(s =>
        '<button class="lineitem" type="button" data-add="' + s.id + '" ' +
        'style="border:0;cursor:pointer;text-align:left;width:100%;font:inherit;color:inherit">' +
        '<span class="lineitem__name">' + esc(s.name_display) + '</span>' +
        '<span class="td-code" style="color:var(--muted)">' + esc(s.brand_sku_code) + '</span>' +
        stockNote(s.id, 1) + '<span style="color:var(--action);font-weight:600" ' +
        biAttr('+ Tambah', '+ Add') + '>+ Tambah</span></button>').join('');
      applyLangTo(results);
    }
    if (results) results.addEventListener('click', e => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      const sku = found.find(s => s.id === +b.dataset.add);
      if (!sku) return;
      const cur = lines.get(sku.id);
      lines.set(sku.id, { sku, qty: cur ? Math.min(99, cur.qty + 1) : 1 });
      renderLines();
    });

    let searchTimer = null, searchSeq = 0;
    if (searchInput) searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { found = []; renderResults(); return; }
      searchTimer = setTimeout(async () => {
        const seq = ++searchSeq;
        try {
          const r = await api().skus({ q, limit: 12 });
          if (seq !== searchSeq) return;
          found = r.skus;
          if (!found.length && results) {
            results.innerHTML = '<span style="color:var(--muted)" ' + biAttr('Tidak ada SKU yang cocok.', 'No matching SKU.') +
              '>Tidak ada SKU yang cocok.</span>';
            applyLangTo(results);
            return;
          }
          renderResults();
        } catch (e) { fail(e); }
      }, 250);
    });

    const composeBtn = $('[data-action="compose"]');
    if (composeBtn) composeBtn.onclick = async () => {
      if (!lines.size) return say(en() ? 'Add at least one item.' : 'Tambah minimal satu barang.');
      composeBtn.disabled = true;
      try {
        const body = {
          site_id: site.id,
          lines: Array.from(lines.values()).map(l => ({ sku_id: l.sku.id, quantity: l.qty })),
          channel,
          delivery_mode: channel === 'grab' ? null : (modeSel ? modeSel.value : 'ninja_rider'),
        };
        const r = await api().raw.post('/training/orders/compose', body);
        say(r.external_ref + ' — ' + (r.short_lines
          ? (en() ? r.short_lines + ' line(s) could not be allocated in full.'
                  : r.short_lines + ' baris tidak cukup stok.')
          : (en() ? 'allocated in full.' : 'stok teralokasi penuh.')));
        lines.clear();
        renderLines();
        if (searchInput) searchInput.value = '';
        found = []; renderResults();
        await Promise.all([loadOrders(), loadStock()]);
      } catch (e) { fail(e); }
      finally { composeBtn.disabled = false; }
    };

    /* ---- generate N random orders ---- */
    const genBtn = $('[data-action="generate"]');
    if (genBtn) genBtn.onclick = async () => {
      genBtn.disabled = true;
      try {
        const r = await api().generateOrders({
          site_id: site.id,
          count: parseInt(field('gen-count').textContent, 10) || 1,
          max_lines: parseInt(field('gen-lines').textContent, 10) || 1,
        });
        say(r.message);
        await Promise.all([loadOrders(), loadStock()]);
      } catch (e) { fail(e); }
      finally { genBtn.disabled = false; }
    };

    /* ---- recent test orders ---- */
    const ordersHost = region('testorders');

    function orderRow(o) {
      const m = MODE[o.delivery_mode] || [o.delivery_mode || '—', o.delivery_mode || '—'];
      const ch = CHANNEL[o.channel] || o.channel || '—';
      const cancellable = o.status !== 'cancelled' && ['ready', 'claimed', 'blocked'].includes(o.pick_status);
      return '<tr>' +
        '<td class="td-code td-strong">' + esc(o.external_ref) + '</td>' +
        '<td><span class="td-strong">' + esc(ch) + '</span><br><span style="color:var(--muted)" ' +
          biAttr(m[0], m[1]) + '>' + esc(m[0]) + '</span></td>' +
        '<td class="td-code">' + (o.promised_at ? NJW.fmt.time(o.promised_at) : '—') + '</td>' +
        '<td class="td-num">' + o.line_count + '</td>' +
        '<td class="td-num">' + o.total_qty + '</td>' +
        '<td class="td-num">' + (o.short_lines ? '<span style="color:var(--caution);font-weight:700">' + o.short_lines + '</span>' : '—') + '</td>' +
        '<td>' + spill(ORDER_STATUS[o.status], ['spill--neutral', o.status, o.status]) + '</td>' +
        '<td>' + (o.pick_status ? spill(PICK_STATUS[o.pick_status], ['spill--neutral', o.pick_status, o.pick_status]) : '—') + '</td>' +
        '<td class="td-actions">' + (cancellable
          ? '<button class="cbtn cbtn--sm" type="button" data-cancel="' + esc(o.external_ref) + '" ' +
            biAttr('Batalkan', 'Cancel') + '>Batalkan</button>'
          : (o.pick_status && o.pick_status !== 'cancelled'
            ? '<a class="cbtn cbtn--sm" href="papan-antrean.html" ' + biAttr('Papan', 'Board') + '>Papan</a>' : '')) +
        '</td></tr>';
    }

    async function loadOrders() {
      if (!ordersHost) return;
      try {
        const r = await api().testOrders({ site_id: site.id, limit: 50 });
        ordersHost.innerHTML = r.orders.length ? r.orders.map(orderRow).join('')
          : '<tr><td colspan="9" class="note" ' + biAttr('Belum ada pesanan uji. Buat satu di atas.',
            'No test orders yet. Make one above.') + '>Belum ada pesanan uji. Buat satu di atas.</td></tr>';
        applyLangTo(ordersHost);
      } catch (e) { fail(e); }
    }

    const refresh = $('[data-action="refresh"]');
    if (refresh) refresh.onclick = () => loadOrders();

    /* ---- cancel: the simulator's message 2 ---- */
    const dlg = $('#dlg-cancel'), scrim = $('.scrim');
    const closeCancel = () => { if (dlg) dlg.classList.remove('is-open'); if (scrim) scrim.classList.remove('is-open'); };
    document.addEventListener('click', async e => {
      const c = e.target.closest('[data-cancel]');
      if (c && dlg) {
        setF('cancel-ref', c.dataset.cancel);
        const ok = $('[data-action="confirm-cancel"]', dlg);
        if (ok) ok.dataset.ref = c.dataset.cancel;
        dlg.classList.add('is-open');
        if (scrim) scrim.classList.add('is-open');
        return;
      }
      const ok = e.target.closest('[data-action="confirm-cancel"]');
      if (!ok || !ok.dataset.ref) return;
      ok.disabled = true;
      try {
        const r = await api().raw.post('/training/orders/' + encodeURIComponent(ok.dataset.ref) + '/cancel', {});
        closeCancel();
        say(r.message || (en() ? 'Cancelled.' : 'Dibatalkan.'));
        await Promise.all([loadOrders(), loadStock()]);
      } catch (err) { fail(err); }
      finally { ok.disabled = false; }
    });

    await Promise.all([loadStock(), loadOrders()]);
    // Pickers change order states from the station; keep the list current.
    setInterval(() => { if (!document.hidden) loadOrders(); }, 20000);
  };
})();
