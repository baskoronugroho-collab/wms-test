/* screens/restock-brand.js: restock from the brand with a PO
 * (console/restock-brand.html, PRD §4.1).
 *
 *   alerts     GET /api/replenishment/alerts: SKUs at or below the reorder point
 *   draft      the SPV checks the quantities and presses Ajukan ke Ops HQ
 *   raised     Ops HQ presses Buat PO: header and quantities, Simpan PO
 *   po         Ops HQ downloads the Excel, emails it, presses Tandai terkirim
 *   sent       Ops HQ records the brand's shipment (Catat pengiriman)
 *   arriving   confirmed or partly received; staff receive it by the AWB
 *   expiry     the SPV uploaded the Faktur; Ops HQ types the EDs from it
 *   received   read-only: requested / sent / received / variance / ED
 *
 * Only Ops HQ (and roles above it) makes, downloads and sends the PO; the API
 * refuses the rest, and the buttons follow the same rule.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const raw = api.raw;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const n = v => NJW.fmt.n(v);
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '-';
  const who = e => String(e || '').split('@')[0];

  // This screen's own endpoints (routers/replenishment.py).
  const R = {
    raise: (id, note) => raw.post('/replenishments/' + id + '/raise', { note: note || null }),
    poHeader: id => raw.get('/replenishments/' + id + '/po-header'),
    savePo: (id, b) => raw.put('/replenishments/' + id + '/po', b),
    expiry: (id, lines) => raw.put('/replenishments/' + id + '/expiry', { lines }),
  };

  const STEP = {
    draft: ['neutral', 'Draf', 'Draft'],
    raised: ['info', 'Diajukan ke Ops HQ', 'Raised to Ops HQ'],
    po: ['info', 'PO dibuat', 'PO made'],
    sent: ['warn', 'Terkirim ke brand', 'Sent to brand'],
    confirmed: ['info', 'Dikonfirmasi', 'Confirmed'],
    receiving: ['info', 'Diterima sebagian (batch)', 'Partly received (batches)'],
    variance_review: ['warn', 'Selisih: dicek SPV', 'Variance: SPV checking'],
    variance_signoff: ['warn', 'Selisih: tanda tangan HQ', 'Variance: HQ to sign'],
    received: ['ok', 'Selesai', 'Closed'],
    cancelled: ['neutral', 'Dibatalkan', 'Cancelled'],
  };
  const PO_STATES = ['po', 'sent', 'confirmed', 'receiving', 'variance_review', 'variance_signoff', 'received'];

  function openDrawer(sel) {
    const d = $(sel), sc = $('.scrim');
    if (d) d.classList.add('is-open');
    if (sc) sc.classList.add('is-open');
  }
  function closeDrawers() {
    $$('.drawer.is-open').forEach(d => d.classList.remove('is-open'));
    const sc = $('.scrim');
    if (sc) sc.classList.remove('is-open');
  }

  /* The Excel comes through fetch, not a plain link, so a refusal (a PO not
     saved yet) shows as a message instead of a page of JSON. */
  async function downloadPo(r) {
    const headers = {};
    try { const v = localStorage.getItem('njw.viewAs'); if (v) headers['X-View-As'] = v; } catch (e) { /* none */ }
    const res = await fetch('/api/replenishments/' + r.id + '/po.xlsx', { headers, cache: 'no-store' });
    if (!res.ok) {
      let d = res.statusText;
      try { d = (await res.json()).detail || d; } catch (e) { /* not JSON */ }
      throw new Error(d);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = 'PO ' + r.reference + '.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  NJW.screens['restock-brand'] = async () => {
    // Ops HQ for every hub; an SPV for the hubs on their account (the API scopes it).
    if (!W.atLeast('supervisor')) {
      region('alert-rows').innerHTML = '<tr><td colspan="7"><div class="empty"><span class="empty__title" ' +
        biAttr('Halaman ini untuk SPV dan Ops HQ', 'This page is for SPVs and Ops HQ') + '></span></div></td></tr>';
      return applyLangTo(region('alert-rows'));
    }
    const me = W.me();
    const hq = W.atLeast('hq');
    let tab = 'alerts', alerts = [], reps = [], cur = null, brands = [];
    let po = null, poMode = false;   // the PO being made or corrected (Ops HQ)

    const sites = (me.sites || []).filter(s => s.site_type !== 'hub');
    field('site-filter').insertAdjacentHTML('beforeend', sites.map(s =>
      '<option value="' + s.id + '">' + esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join(''));
    field('m-site').innerHTML = sites.map(s => '<option value="' + s.id + '">' + esc(s.code) + ' · ' + esc(s.name) + '</option>').join('');
    try { brands = (await api.brands()).filter(b => b.active); } catch (e) { /* manual create stays empty */ }
    field('m-brand').innerHTML = brands.map(b => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
    const siteId = () => field('site-filter').value || null;

    /* ---- counts on every tab ---- */
    async function counts() {
      try {
        const [a, r, e] = await Promise.all([
          api.replenAlerts({ site_id: siteId() }),
          api.replenishments({ site_id: siteId(), status: 'active' }),
          hq ? api.replenishments({ site_id: siteId(), status: 'expiry' }) : Promise.resolve(null),
        ]);
        const by = s => r.replenishments.filter(x => x.status === s).length;
        setF('n-alerts', a.alerts.filter(x => !x.open_reference).length);
        ['draft', 'raised', 'po', 'sent'].forEach(s => setF('n-' + s, by(s)));
        setF('n-arriving', by('confirmed') + by('receiving'));
        setF('n-variance', r.replenishments.filter(x => x.status.indexOf('variance') === 0).length);
        if (e) setF('n-expiry', e.replenishments.length);
      } catch (e) { /* the tab bodies report their own errors */ }
    }

    /* ---- alerts ---- */
    async function loadAlerts() {
      try { alerts = (await api.replenAlerts({ site_id: siteId() })).alerts; } catch (e) { return fail(e); }
      const host = region('alert-rows');
      host.innerHTML = alerts.length ? alerts.map((a, i) =>
        '<tr' + (a.open_reference ? ' style="opacity:.6"' : '') + '>' +
        '<td class="td-check"><input class="checkbox" type="checkbox" data-alert="' + i + '"' +
        (a.open_reference ? ' disabled' : '') + ' aria-label="Pilih"></td>' +
        '<td class="td-code">' + esc(a.site_code) + '</td>' +
        '<td><strong>' + esc(a.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' +
        esc([a.brand_name, a.brand_sku_code].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="td-num td-code' + (a.below_safety ? ' num-stop' : '') + '">' + n(a.qty_total) +
        (a.below_safety ? ' <span class="spill spill--stop"><span ' + biAttr('kritis', 'critical') + '></span></span>' : '') + '</td>' +
        '<td class="td-num td-code">' + n(a.restock_point) + '</td>' +
        '<td class="td-num"><input class="input" type="number" min="1" style="width:90px;text-align:right" data-alert-qty="' + i + '" value="' + a.qty_suggested + '"' +
        (a.open_reference ? ' disabled' : '') + '></td>' +
        '<td>' + (a.open_reference ? '<span class="td-code">' + esc(a.open_reference) + '</span>' : '-') + '</td></tr>').join('')
        : '<tr><td colspan="7"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada SKU di bawah titik pesan ulang', 'No SKU is at its reorder point') + '></span>' +
          '<span class="empty__body" ' + biAttr('Peringatan muncul untuk SKU yang titik pesan ulangnya sudah diisi di Penempatan & batas atau saat SKU didaftarkan.',
            'Alerts appear for SKUs whose reorder point is set, in Slotting & thresholds or when the SKU was registered.') + '></span></div></td></tr>';
      applyLangTo(host);
      field('alerts-all').checked = false;
    }

    /* ---- request lists ---- */
    async function loadList() {
      try { reps = (await api.replenishments({ site_id: siteId(), status: tab })).replenishments; } catch (e) { return fail(e); }
      const host = region('list-rows');
      host.innerHTML = reps.length ? reps.map(r => {
        const st = STEP[r.status] || ['neutral', r.status, r.status];
        const last = r.status.indexOf('variance') === 0
          ? '<span class="spill spill--warn"><span ' + biAttr(st[1], st[2]) + '></span></span> ' +
            '<a href="selisih-restock.html" ' + biAttr('Buka selisih', 'Open variance') + '></a>'
          : r.status === 'received' ? when(r.signed_off_at || r.received_at)
          : r.status === 'confirmed' || r.status === 'receiving' ? when(r.confirmed_at)
          : r.status === 'sent' ? when(r.sent_at)
          : r.status === 'po' ? when(r.po_saved_at)
          : r.status === 'raised' ? when(r.raised_at) : when(r.created_at);
        const units = r.status === 'received' || r.status === 'receiving' || r.status.indexOf('variance') === 0 ? n(r.total_received) + ' / ' + n(r.total_confirmed)
          : r.status === 'confirmed' ? n(r.total_confirmed) : n(r.total_requested);
        const tags = (r.auto_created ? ' <span class="spill spill--info"><span ' + biAttr('Otomatis', 'Automatic') + '></span></span>' : '') +
          (r.expiry_due ? ' <span class="spill spill--warn"><span ' + biAttr('ED belum diisi', 'ED to enter') + '></span></span>' : '') +
          (r.open_issues ? ' <span class="spill spill--warn"><span ' + biAttr(r.open_issues + ' selisih Faktur', r.open_issues + ' Faktur difference(s)') + '></span></span>' : '');
        return '<tr><td class="td-code"><strong>' + esc(r.reference) + '</strong>' + (tags ? '<br>' + tags : '') + '</td>' +
          '<td class="td-code">' + esc(r.site_code) + '</td><td>' + esc(r.brand_name) + '</td>' +
          '<td class="td-num td-code">' + units + '</td>' +
          '<td class="td-code">' + esc(r.awb || '-') + (r.surat_jalan_no ? '<br><span style="color:var(--muted)">' + esc(r.surat_jalan_no) + '</span>' : '') + '</td>' +
          '<td class="td-code">' + last + '</td>' +
          '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-open="' + r.id + '" ' +
          biAttr('Buka', 'Open') + '></button></td></tr>';
      }).join('')
        : '<tr><td colspan="7"><div class="empty"><span class="empty__title" ' + biAttr('Kosong', 'Nothing here') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    async function load() {
      region('panel-alerts').hidden = tab !== 'alerts';
      region('panel-list').hidden = tab === 'alerts';
      counts();
      return tab === 'alerts' ? loadAlerts() : loadList();
    }

    /* ---- the PO section (Ops HQ) ---- */
    function paintPo() {
      const h = po.header, frozen = po.saved;
      field('po-reference').value = h.reference || '';
      field('po-date').value = h.po_date || '';
      field('po-to').value = h.po_to || '';
      field('po-contact').value = h.po_brand_contact || '';
      field('po-deliver').value = h.po_deliver_to || '';
      field('po-requested').value = h.po_requested_date || '';
      field('po-hours').value = h.po_receiving_hours || '';
      field('po-by').value = h.po_created_by_name || '';
      field('po-note').value = h.po_note || '';
      region('r-po-lines').innerHTML = po.lines.map((l, i) =>
        '<tr><td><strong>' + esc(l.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' +
        esc([l.brand_sku_code, l.hiryu_sku_code, l.unit_size].filter(Boolean).join(' · ')) + '</span></td>' +
        '<td class="td-code">' + (l.added ? '?' : l.barcode ? esc(l.barcode)
          : '<span class="spill spill--stop"><span ' + biAttr('MISSING', 'MISSING') + '></span></span>') + '</td>' +
        '<td class="td-num td-code">' + (l.added ? '?' : n(l.current_stock)) + '</td>' +
        '<td class="td-num td-code">' + (l.fill_to == null ? '-' : n(l.fill_to)) + '</td>' +
        '<td class="td-num td-code">' + (frozen ? '<strong>' + n(l.qty_requested) + '</strong>'
          : '<input class="input" type="number" min="0" style="width:80px;text-align:right" data-po-qty="' + i + '" value="' + l.qty_requested + '">') + '</td>' +
        '<td><input class="input" type="text" maxlength="255" style="min-width:120px" data-po-note="' + i + '" value="' + esc(l.note || '') + '"></td></tr>'
      ).join('') || '<tr><td colspan="6" class="note" ' + biAttr('Belum ada produk. Tambahkan di bawah.', 'No products yet. Add them below.') + '></td></tr>';
      const missing = po.lines.filter(l => !l.added && !l.barcode && l.qty_requested > 0).length;
      bi(field('po-missing'),
        (frozen ? 'Jumlah sudah dikunci sejak PO disimpan. ' : 'Baris dengan jumlah 0 tidak masuk PO. ') +
          (missing ? missing + ' SKU tanpa barcode: tertulis MISSING di Excel, brand mengisinya di kolom kuning.' : ''),
        (frozen ? 'The quantities are locked since the PO was saved. ' : 'Lines at 0 are left off the PO. ') +
          (missing ? missing + ' SKU without a barcode: MISSING on the Excel, the brand fills in the yellow column.' : ''));
      applyLangTo(region('r-po'));
    }

    function readPo() {
      $$('[data-po-qty]').forEach(inp => {
        const l = po.lines[+inp.dataset.poQty];
        if (l) l.qty_requested = inp.value === '' ? 0 : Math.max(0, +inp.value);
      });
      $$('[data-po-note]').forEach(inp => {
        const l = po.lines[+inp.dataset.poNote];
        if (l) l.note = inp.value.trim() || null;
      });
      return {
        reference: field('po-reference').value.trim().toUpperCase(),
        po_date: field('po-date').value || null,
        po_to: field('po-to').value.trim() || null,
        po_brand_contact: field('po-contact').value.trim() || null,
        po_deliver_to: field('po-deliver').value.trim() || null,
        po_requested_date: field('po-requested').value || null,
        po_receiving_hours: field('po-hours').value.trim() || null,
        po_created_by_name: field('po-by').value.trim() || null,
        po_note: field('po-note').value.trim() || null,
        lines: po.lines.map(l => ({ sku_id: l.sku_id, qty_requested: l.qty_requested || 0, note: l.note || null })),
      };
    }

    /* ---- the request drawer ---- */
    function paintRep() {
      const r = cur, st = r.status;
      const draft = st === 'draft', raised = st === 'raised';
      const editLines = !poMode && (draft || (raised && hq));
      const confirmable = hq && (st === 'sent' || st === 'confirmed');
      bi(field('r-title'), r.reference || 'Draf baru', r.reference || 'New draft');

      const order = ['draft', 'raised', 'po', 'sent', 'confirmed', 'receiving']
        .concat(r.has_variance || st.indexOf('variance') === 0 || r.signed_off_at ? ['variance_review', 'variance_signoff'] : [])
        .concat(['received']);
      region('r-steps').innerHTML = order.map(s => {
        const done = order.indexOf(s) <= order.indexOf(st);
        return '<span class="spill spill--' + (done && st !== 'cancelled' ? STEP[s][0] : 'neutral') + '"' +
          (done ? '' : ' style="opacity:.5"') + '><span ' + biAttr(STEP[s][1], STEP[s][2]) + '></span></span>';
      }).join('<span style="color:var(--muted)">›</span>') +
        (st === 'cancelled' ? ' <span class="spill spill--stop"><span ' + biAttr('Dibatalkan', 'Cancelled') + '></span></span>' : '');
      applyLangTo(region('r-steps'));

      setF('r-site', (r.site_code || '') + (r.site_name ? ' · ' + r.site_name : ''));
      setF('r-brand', r.brand_name || '');
      setF('r-created', r.created_at ? when(r.created_at) + ' · ' + (r.created_by || '') : '-');
      const row = (key, show, text) => {
        $$('[data-row="' + key + '"]').forEach(el => { el.hidden = !show; });
        if (show) setF('r-' + (key === 'po' ? 'po-saved' : key), text);
      };
      row('raised', !!r.raised_at, when(r.raised_at) + ' · ' + who(r.raised_by) + (r.raise_note ? ' · "' + r.raise_note + '"' : ''));
      row('po', !!r.po_saved_at, when(r.po_saved_at) + ' · ' + who(r.po_saved_by));
      row('sent', !!r.sent_at, when(r.sent_at) + ' · ' + who(r.sent_by));

      region('r-po').hidden = !poMode;
      if (poMode) paintPo();
      region('r-lines-wrap').hidden = poMode;
      region('r-confirm-fields').hidden = poMode || !(confirmable || r.awb);
      ['r-awb', 'r-sj', 'r-eta'].forEach(f => { field(f).disabled = !confirmable; });
      field('r-awb').value = r.awb || '';
      field('r-sj').value = r.surat_jalan_no || '';
      field('r-eta').value = r.eta_date || '';
      region('r-add').hidden = !(editLines || confirmable || (poMode && po && !po.saved));
      region('r-note-field').hidden = !(draft && !poMode);
      field('r-note').value = r.note || '';
      region('r-results').innerHTML = '';
      field('r-q').value = '';

      region('r-lines').innerHTML = r.lines.map((l, i) => {
        const qtyReq = editLines
          ? '<input class="input" type="number" min="0" style="width:80px;text-align:right" data-line-req="' + i + '" value="' + l.qty_requested + '">'
          : n(l.qty_requested);
        const qtyConf = confirmable
          ? '<input class="input" type="number" min="0" style="width:80px;text-align:right" data-line-conf="' + i + '" value="' +
            (l.qty_confirmed != null ? l.qty_confirmed : l.qty_requested) + '">'
          : (l.qty_confirmed != null ? n(l.qty_confirmed) : '-');
        const v = l.variance;
        const ed = l.expiry_month ? esc(l.expiry_month)
          : l.expiry_entered_at ? '<span style="color:var(--muted)" ' + biAttr('umur dari tanggal masuk', 'aged from inbound') + '></span>' : '-';
        return '<tr><td><strong>' + esc(l.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' + esc(l.brand_sku_code || '') + '</span></td>' +
          '<td class="td-num td-code">' + qtyReq + '</td><td class="td-num td-code">' + qtyConf + '</td>' +
          '<td class="td-num td-code">' + (l.qty_received != null ? n(l.qty_received) : '-') + '</td>' +
          '<td class="td-num td-code"' + (v ? ' style="color:var(--' + (v < 0 ? 'stop' : 'caution') + ');font-weight:700"' : '') + '>' +
          (v == null ? '-' : (v > 0 ? '+' : '') + v) + '</td><td class="td-code">' + ed + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="note" ' + biAttr('Belum ada produk. Tambahkan di bawah.', 'No products yet. Add them below.') + '></td></tr>';
      applyLangTo(region('r-lines'));

      // The signed Faktur, once the SPV has uploaded it (barang-masuk.html).
      const pages = r.faktur_pages || [];
      region('r-faktur').hidden = !pages.length;
      region('r-faktur-pages').innerHTML = pages.map(p =>
        '<a class="cbtn cbtn--sm" target="_blank" rel="noopener" href="' + esc(p.url) + '">' +
        '<span ' + biAttr('Halaman ' + p.page_no, 'Page ' + p.page_no) + '></span>' +
        (p.content_type === 'application/pdf' ? ' (PDF)' : '') + '</a>').join('') +
        (r.faktur_uploaded_at ? '<span class="note" style="align-self:center">' + when(r.faktur_uploaded_at) + '</span>' : '');
      applyLangTo(region('r-faktur'));

      // ED dari Faktur: Ops HQ only, and only from the uploaded Faktur.
      const canExpiry = hq && pages.length > 0 && st !== 'cancelled';
      region('r-expiry').hidden = !canExpiry;
      if (canExpiry) {
        const got = r.lines.filter(l => (l.qty_received || 0) > 0);
        region('r-exp-lines').innerHTML = (got.length ? got : r.lines).map(l =>
          '<tr><td><strong>' + esc(l.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' + esc(l.brand_sku_code || '') + '</span></td>' +
          '<td class="td-num td-code">' + (l.qty_received != null ? n(l.qty_received) : '-') + '</td>' +
          '<td><input class="input" type="month" min="2020-01" max="2100-12" placeholder="YYYY-MM" style="width:160px" data-exp="' + l.sku_id + '" value="' +
          esc(l.expiry_month || '') + '"></td></tr>').join('');
      }

      const showBtn = (a, on) => { const b = $('[data-action="' + a + '"]'); if (b) b.hidden = !on; };
      showBtn('save-draft', editLines);
      showBtn('raise', draft && !hq && !!r.id);
      showBtn('open-po', hq && (draft || raised) && !poMode && !!r.id);
      showBtn('save-po', hq && poMode && ['draft', 'raised', 'po'].includes(st));
      showBtn('download-po', hq && PO_STATES.includes(st));
      showBtn('mark-sent', hq && st === 'po');
      showBtn('save-confirm', confirmable);
      showBtn('save-expiry', canExpiry);
      showBtn('cancel-rep', !!r.id && (['draft', 'raised'].includes(st) || (hq && ['po', 'sent', 'confirmed'].includes(st))));
    }

    function readLines(attr, key) {
      $$('[' + attr + ']').forEach(inp => {
        const l = cur.lines[+inp.getAttribute(attr)];
        if (l) l[key] = inp.value === '' ? 0 : +inp.value;
      });
    }

    async function openPo() {
      po = await R.poHeader(cur.id);
      poMode = true;
      paintRep();
    }

    async function openRep(id) {
      try {
        cur = await api.replenishment(id);
        po = null;
        poMode = false;
        // A saved PO opens on its header for Ops HQ: it can still be corrected until sent.
        if (hq && cur.status === 'po') { po = await R.poHeader(id); poMode = true; }
      } catch (e) { return fail(e); }
      paintRep();
      openDrawer('#drawer-rep');
    }

    // Save what the SPV or Ops HQ typed on the draft before the next step uses it.
    async function saveDraftLines() {
      readLines('data-line-req', 'qty_requested');
      const lines = cur.lines.filter(l => l.qty_requested > 0).map(l => ({ sku_id: l.sku_id, qty_requested: l.qty_requested }));
      if (!lines.length) throw new Error(t('Isi minimal satu produk dengan jumlah.', 'Add at least one product with a quantity.'));
      cur = cur.id
        ? await api.editReplenishment(cur.id, { lines, note: field('r-note').hidden ? undefined : field('r-note').value })
        : await api.createReplenishment({ site_id: cur.site_id, brand_id: cur.brand_id, lines, note: field('r-note').value || null });
    }

    let seq = 0, timer = null;
    field('r-q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const term = field('r-q').value.trim();
        const host = region('r-results');
        if (term.length < 2 || !cur) { host.innerHTML = ''; return; }
        const mine = ++seq;
        try {
          const r = await api.skus({ q: term, brand_id: cur.brand_id, limit: 12 });
          if (mine !== seq) return;
          const have = new Set((poMode && po ? po.lines : cur.lines).map(l => l.sku_id));
          host.innerHTML = r.skus.filter(s => !have.has(s.id)).map(s =>
            '<button type="button" class="cbtn cbtn--ghost" style="justify-content:flex-start" data-add-sku="' + s.id + '" data-name="' + esc(s.name_display) + '" data-code="' + esc(s.brand_sku_code) + '">+ ' +
            esc(s.name_display) + ' <span class="td-code" style="color:var(--muted)">' + esc(s.brand_sku_code) + '</span></button>').join('')
            || '<span class="note">' + t('Tidak ada.', 'None.') + '</span>';
        } catch (e) { fail(e); }
      }, 250);
    });

    /* ---- clicks ---- */
    document.addEventListener('click', async e => {
      const tb = e.target.closest('[data-tab]');
      if (tb && tb.closest('[data-region="tabs"]')) {
        tab = tb.dataset.tab;
        $$('[data-region="tabs"] .tab').forEach(x => x.classList.toggle('is-on', x === tb));
        return load();
      }
      if (e.target === field('alerts-all')) {
        $$('[data-alert]').forEach(c => { if (!c.disabled) c.checked = e.target.checked; });
        return;
      }
      if (e.target.closest('[data-action="create-from-alerts"]')) {
        const picked = $$('[data-alert]').filter(c => c.checked).map(c => {
          const i = +c.dataset.alert;
          const q = $('[data-alert-qty="' + i + '"]');
          return Object.assign({}, alerts[i], { qty: +(q && q.value) || alerts[i].qty_suggested });
        });
        if (!picked.length) return say(t('Pilih minimal satu baris.', 'Select at least one row.'));
        const groups = {};
        picked.forEach(a => { (groups[a.site_id + ':' + a.brand_id] = groups[a.site_id + ':' + a.brand_id] || []).push(a); });
        let made = 0, lastId = null;
        for (const key of Object.keys(groups)) {
          const g = groups[key];
          try {
            const r = await api.createReplenishment({
              site_id: g[0].site_id, brand_id: g[0].brand_id,
              lines: g.map(a => ({ sku_id: a.sku_id, qty_requested: a.qty })),
            });
            made++;
            lastId = r.id;
          } catch (err) { fail(err); }
        }
        if (made) {
          say(made + t(' draf dibuat.', ' draft(s) created.'));
          await loadAlerts();
          counts();
          if (made === 1 && lastId) openRep(lastId);
        }
        return;
      }

      const op = e.target.closest('[data-open]');
      if (op) return openRep(+op.dataset.open);

      if (e.target.closest('[data-action="new-manual"]')) return openDrawer('#drawer-new');
      if (e.target.closest('[data-action="start-manual"]')) {
        const s = sites.find(x => x.id === +field('m-site').value);
        const b = brands.find(x => x.id === +field('m-brand').value);
        if (!s || !b) return say(t('Pilih hub dan brand.', 'Choose a hub and a brand.'));
        if (hq && field('m-fill-all').checked) {
          // First delivery: the server fills every SKU of the brand up to isi sampai.
          try {
            const r = await api.createReplenishment({ site_id: s.id, brand_id: b.id, fill_all: true, lines: [] });
            closeDrawers();
            field('m-fill-all').checked = false;
            await openRep(r.id);
            await openPo();
            load();
          } catch (err) { fail(err); }
          return;
        }
        cur = { id: null, reference: null, status: 'draft', site_id: s.id, site_code: s.code, site_name: s.name,
                brand_id: b.id, brand_name: b.name, lines: [], note: '', faktur_pages: [] };
        po = null;
        poMode = false;
        closeDrawers();
        paintRep();
        return openDrawer('#drawer-rep');
      }

      const add = e.target.closest('[data-add-sku]');
      if (add && cur) {
        const line = { sku_id: +add.dataset.addSku, sku_name: add.dataset.name, brand_sku_code: add.dataset.code };
        if (poMode && po && !po.saved) {
          readPo();
          po.lines.push(Object.assign(line, { added: true, barcode: null, current_stock: null, fill_to: null, qty_requested: 1, note: null }));
          return paintRep();
        }
        readLines('data-line-req', 'qty_requested');
        readLines('data-line-conf', 'qty_confirmed');
        const conf = cur.status === 'sent' || cur.status === 'confirmed';
        cur.lines.push(Object.assign(line, { qty_requested: conf ? 0 : 1, qty_confirmed: conf ? 1 : null,
                                             qty_received: null, variance: null }));
        return paintRep();
      }

      if (!cur) return;
      if (e.target.closest('[data-action="save-draft"]')) {
        try {
          await saveDraftLines();
          say(cur.reference + t(' tersimpan.', ' saved.'));
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="raise"]')) {
        const note = prompt(t('Ajukan ke Ops HQ. Catatan untuk Ops HQ (boleh kosong):', 'Raise to Ops HQ. Note for Ops HQ (optional):'), '');
        if (note === null) return;
        try {
          await saveDraftLines();
          cur = await R.raise(cur.id, note.trim());
          say(cur.reference + t(' diajukan ke Ops HQ.', ' raised to Ops HQ.'));
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="open-po"]')) {
        try {
          if (!region('r-lines-wrap').hidden && $$('[data-line-req]').length) await saveDraftLines();
          await openPo();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="save-po"]')) {
        const body = readPo();
        if (!body.reference) { field('po-reference').focus(); return say(t('Nomor PO wajib diisi.', 'The PO number is required.')); }
        if (!po.saved && !body.lines.some(l => l.qty_requested > 0)) {
          return say(t('Isi minimal satu produk dengan jumlah.', 'Add at least one product with a quantity.'));
        }
        if (!po.saved && !confirm(t('Simpan PO? Setelah ini jumlahnya dikunci.', 'Save the PO? The quantities are locked after this.'))) return;
        try {
          cur = await R.savePo(cur.id, body);
          po = await R.poHeader(cur.id);
          poMode = true;
          say(cur.reference + t(' tersimpan. Unduh Excel lalu kirim ke brand.', ' saved. Download the Excel and email it to the brand.'));
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="download-po"]')) {
        try { await downloadPo(cur); } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="mark-sent"]')) {
        if (!confirm(t('PO sudah dikirim ke brand lewat email?', 'Has the PO been emailed to the brand?'))) return;
        try {
          cur = await api.sendReplenishment(cur.id);
          po = null;
          poMode = false;
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="save-confirm"]')) {
        readLines('data-line-conf', 'qty_confirmed');
        const awb = field('r-awb').value.trim();
        if (!awb) { field('r-awb').focus(); return say(t('AWB wajib diisi.', 'The AWB is required.')); }
        try {
          cur = await api.confirmReplenishment(cur.id, {
            awb, surat_jalan_no: field('r-sj').value.trim() || null, eta_date: field('r-eta').value || null,
            lines: cur.lines.map(l => ({ sku_id: l.sku_id, qty_confirmed: l.qty_confirmed == null ? 0 : l.qty_confirmed })),
          });
          say(cur.reference + t(' dikonfirmasi. Staf bisa menerima dengan AWB ', ' confirmed. Staff can receive with AWB ') + cur.awb);
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="save-expiry"]')) {
        const lines = $$('[data-exp]').map(inp => ({ sku_id: +inp.dataset.exp, expiry_month: inp.value.trim() || null }));
        const bad = lines.find(l => l.expiry_month && !/^\d{4}-\d{2}$/.test(l.expiry_month));
        if (bad) return say(t('Tulis ED sebagai tahun-bulan, misalnya 2027-03.', 'Write the ED as year-month, for example 2027-03.'));
        try {
          cur = await R.expiry(cur.id, lines);
          say(t('ED tersimpan. Yang kosong dihitung umurnya dari tanggal masuk.', 'Expiry dates saved. Empty ones are aged from the inbound date.'));
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="cancel-rep"]')) {
        if (!confirm(t('Batalkan ', 'Cancel ') + cur.reference + '?')) return;
        try { cur = await api.cancelReplenishment(cur.id); po = null; poMode = false; paintRep(); load(); } catch (err) { fail(err); }
      }
    });
    field('site-filter').addEventListener('change', load);

    // Deep links from Perlu tindakan: ?tab=expiry opens a tab, ?id=42 opens a request.
    const q = new URLSearchParams(location.search);
    const wantTab = $('[data-region="tabs"] [data-tab="' + (q.get('tab') || '').replace(/[^a-z_]/g, '') + '"]');
    if (wantTab && !wantTab.hidden) {
      tab = wantTab.dataset.tab;
      $$('[data-region="tabs"] .tab').forEach(x => x.classList.toggle('is-on', x === wantTab));
    }
    await load();
    if (+q.get('id')) openRep(+q.get('id'));
  };
})();
