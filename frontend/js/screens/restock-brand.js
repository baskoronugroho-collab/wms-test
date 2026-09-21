/* screens/restock-brand.js — Ops HQ replenishment to the brand
 * (console/restock-brand.html).
 *
 *   alerts     GET /api/replenishment/alerts — SKUs at or below the restock point
 *   draft      HQ edits quantities, copies the text, marks it sent to Wardah
 *   sent       HQ enters Wardah's AWB, Surat Jalan number and confirmed quantities
 *   confirmed  on its way; staff receive it by the AWB
 *   received   read-only: requested / confirmed / received / variance
 *
 * Sending to Wardah happens outside the WMS (WhatsApp or email) — the screen
 * only builds the text and records that it was sent.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const n = v => NJW.fmt.n(v);
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '—';

  const STEP = {
    draft: ['neutral', 'Draf', 'Draft'],
    sent: ['warn', 'Dikirim ke brand', 'Sent to brand'],
    confirmed: ['info', 'Dalam perjalanan', 'On the way'],
    variance_review: ['warn', 'Selisih: dicek SPV', 'Variance: SPV checking'],
    variance_signoff: ['warn', 'Selisih: tanda tangan HQ', 'Variance: HQ to sign'],
    receiving: ['info', 'Diterima sebagian (batch)', 'Partly received (batches)'],
    received: ['ok', 'Selesai', 'Closed'],
    cancelled: ['neutral', 'Dibatalkan', 'Cancelled'],
  };

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

  NJW.screens['restock-brand'] = async () => {
    // Ops HQ for every hub; an SPV for the hubs on their account (the API scopes it).
    if (!W.atLeast('supervisor')) {
      region('alert-rows').innerHTML = '<tr><td colspan="7"><div class="empty"><span class="empty__title" ' +
        biAttr('Halaman ini untuk SPV dan Ops HQ', 'This page is for SPVs and Ops HQ') + '></span></div></td></tr>';
      return applyLangTo(region('alert-rows'));
    }
    const me = W.me();
    let tab = 'alerts', alerts = [], reps = [], cur = null, brands = [];

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
        const [a, r] = await Promise.all([
          api.replenAlerts({ site_id: siteId() }),
          api.replenishments({ site_id: siteId(), status: 'active' }),
        ]);
        setF('n-alerts', a.alerts.filter(x => !x.open_reference).length);
        ['draft', 'sent', 'confirmed'].forEach(s =>
          setF('n-' + s, r.replenishments.filter(x => x.status === s).length));
        setF('n-variance', r.replenishments.filter(x => x.status.indexOf('variance') === 0).length);
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
        '<td>' + (a.open_reference ? '<span class="td-code">' + esc(a.open_reference) + '</span>' : '—') + '</td></tr>').join('')
        : '<tr><td colspan="7"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada SKU di bawah titik restock', 'No SKU is at its restock point') + '></span>' +
          '<span class="empty__body" ' + biAttr('Peringatan muncul untuk SKU yang titik restock-nya sudah diisi di Penempatan & batas atau saat SKU didaftarkan.',
            'Alerts appear for SKUs whose restock point is set, in Slotting & thresholds or when the SKU was registered.') + '></span></div></td></tr>';
      applyLangTo(host);
      field('alerts-all').checked = false;
    }

    /* ---- request lists ---- */
    async function loadList() {
      try { reps = (await api.replenishments({ site_id: siteId(), status: tab })).replenishments; } catch (e) { return fail(e); }
      const host = region('list-rows');
      host.innerHTML = reps.length ? reps.map(r => {
        const last = r.status.indexOf('variance') === 0
          ? '<span class="spill spill--warn"><span ' + biAttr(STEP[r.status][1], STEP[r.status][2]) + '></span></span> ' +
            '<a href="selisih-restock.html" ' + biAttr('Buka selisih →', 'Open variance →') + '></a>'
          : r.status === 'received' ? when(r.signed_off_at || r.received_at)
          : r.status === 'confirmed' ? when(r.confirmed_at)
          : r.status === 'sent' ? when(r.sent_at) : when(r.created_at);
        const units = r.status === 'received' || r.status === 'receiving' || r.status.indexOf('variance') === 0 ? n(r.total_received) + ' / ' + n(r.total_confirmed)
          : r.status === 'confirmed' ? n(r.total_confirmed) : n(r.total_requested);
        return '<tr><td class="td-code"><strong>' + esc(r.reference) + '</strong>' +
          (r.auto_created ? '<br><span class="spill spill--info"><span ' + biAttr('Otomatis', 'Automatic') + '></span></span>' : '') + '</td>' +
          '<td class="td-code">' + esc(r.site_code) + '</td><td>' + esc(r.brand_name) + '</td>' +
          '<td class="td-num td-code">' + units + '</td>' +
          '<td class="td-code">' + esc(r.awb || '—') + (r.surat_jalan_no ? '<br><span style="color:var(--muted)">' + esc(r.surat_jalan_no) + '</span>' : '') + '</td>' +
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

    /* ---- the request drawer ---- */
    function paintRep() {
      const r = cur;
      const draft = r.status === 'draft';
      const confirmable = r.status === 'sent' || r.status === 'confirmed';
      bi(field('r-title'), (r.reference || 'Draf baru') , (r.reference || 'New draft'));
      const order = r.has_variance || r.status.indexOf('variance') === 0 || r.signed_off_at
        ? ['draft', 'sent', 'confirmed', 'receiving', 'variance_review', 'variance_signoff', 'received']
        : ['draft', 'sent', 'confirmed', 'receiving', 'received'];
      region('r-steps').innerHTML = order.map(s => {
        const done = order.indexOf(s) <= order.indexOf(r.status);
        return '<span class="spill spill--' + (done && r.status !== 'cancelled' ? STEP[s][0] : 'neutral') + '"' +
          (done ? '' : ' style="opacity:.5"') + '><span ' + biAttr(STEP[s][1], STEP[s][2]) + '></span></span>';
      }).join('<span style="color:var(--muted)">→</span>') +
        (r.status === 'cancelled' ? ' <span class="spill spill--stop"><span ' + biAttr('Dibatalkan', 'Cancelled') + '></span></span>' : '');
      applyLangTo(region('r-steps'));
      setF('r-site', (r.site_code || '') + (r.site_name ? ' · ' + r.site_name : ''));
      setF('r-brand', r.brand_name || '');
      setF('r-created', r.created_at ? when(r.created_at) + ' · ' + (r.created_by || '') : '—');

      region('r-confirm-fields').hidden = !(confirmable || r.status === 'received');
      ['r-awb', 'r-sj', 'r-eta'].forEach(f => { field(f).disabled = !confirmable; });
      field('r-awb').value = r.awb || '';
      field('r-sj').value = r.surat_jalan_no || '';
      field('r-eta').value = r.eta_date || '';
      region('r-add').hidden = !(draft || confirmable);
      region('r-note-field').hidden = !draft;
      field('r-note').value = r.note || '';
      region('r-results').innerHTML = '';
      field('r-q').value = '';

      region('r-lines').innerHTML = r.lines.map((l, i) => {
        const qtyReq = draft
          ? '<input class="input" type="number" min="0" style="width:80px;text-align:right" data-line-req="' + i + '" value="' + l.qty_requested + '">'
          : n(l.qty_requested);
        const qtyConf = confirmable
          ? '<input class="input" type="number" min="0" style="width:80px;text-align:right" data-line-conf="' + i + '" value="' +
            (l.qty_confirmed != null ? l.qty_confirmed : l.qty_requested) + '">'
          : (l.qty_confirmed != null ? n(l.qty_confirmed) : '—');
        const v = l.variance;
        return '<tr><td><strong>' + esc(l.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' + esc(l.brand_sku_code || '') + '</span></td>' +
          '<td class="td-num td-code">' + qtyReq + '</td><td class="td-num td-code">' + qtyConf + '</td>' +
          '<td class="td-num td-code">' + (l.qty_received != null ? n(l.qty_received) : '—') + '</td>' +
          '<td class="td-num td-code"' + (v ? ' style="color:var(--' + (v < 0 ? 'stop' : 'caution') + ');font-weight:700"' : '') + '>' +
          (v == null ? '—' : (v > 0 ? '+' : '') + v) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="note" ' + biAttr('Belum ada produk. Tambahkan di bawah.', 'No products yet. Add them below.') + '></td></tr>';
      applyLangTo(region('r-lines'));

      const showBtn = (a, on) => { const b = $('[data-action="' + a + '"]'); if (b) b.hidden = !on; };
      showBtn('copy-text', draft || r.status === 'sent');
      showBtn('save-draft', draft);
      showBtn('mark-sent', draft && !!r.id);
      showBtn('save-confirm', confirmable);
      showBtn('cancel-rep', !!r.id && ['draft', 'sent', 'confirmed'].includes(r.status));
    }

    function readLines(attr, key) {
      $$('[' + attr + ']').forEach(inp => {
        const l = cur.lines[+inp.getAttribute(attr)];
        if (l) l[key] = inp.value === '' ? 0 : +inp.value;
      });
    }

    async function openRep(id) {
      try { cur = await api.replenishment(id); } catch (e) { return fail(e); }
      paintRep();
      openDrawer('#drawer-rep');
    }

    function textForBrand(r) {
      const lines = r.lines.filter(l => l.qty_requested > 0);
      return [
        'Permintaan restock ' + (r.reference || '') + ' — ' + r.brand_name,
        'Kirim ke: ' + (r.site_name || '') + ' (' + (r.site_code || '') + ')',
        '',
        ...lines.map((l, i) => (i + 1) + '. ' + l.sku_name + (l.brand_sku_code ? ' [' + l.brand_sku_code + ']' : '') + ' — ' + l.qty_requested + ' pcs'),
        '',
        'Total: ' + lines.reduce((a, l) => a + l.qty_requested, 0) + ' pcs',
        'Mohon konfirmasi jumlah yang dikirim, nomor AWB dan nomor Surat Jalan. Terima kasih.',
      ].join('\n');
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
          const have = new Set(cur.lines.map(l => l.sku_id));
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
          say(made + t(' permintaan draf dibuat.', ' draft request(s) created.'));
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
        cur = { id: null, reference: null, status: 'draft', site_id: s.id, site_code: s.code, site_name: s.name,
                brand_id: b.id, brand_name: b.name, lines: [], note: '' };
        closeDrawers();
        paintRep();
        return openDrawer('#drawer-rep');
      }

      const add = e.target.closest('[data-add-sku]');
      if (add && cur) {
        readLines('data-line-req', 'qty_requested');
        readLines('data-line-conf', 'qty_confirmed');
        cur.lines.push({ sku_id: +add.dataset.addSku, sku_name: add.dataset.name, brand_sku_code: add.dataset.code,
                         qty_requested: cur.status === 'draft' ? 1 : 0, qty_confirmed: cur.status === 'draft' ? null : 1,
                         qty_received: null, variance: null });
        return paintRep();
      }

      if (!cur) return;
      if (e.target.closest('[data-action="copy-text"]')) {
        readLines('data-line-req', 'qty_requested');
        const text = textForBrand(cur);
        try { await navigator.clipboard.writeText(text); say(t('Teks disalin. Tempel ke WhatsApp atau email ke Wardah.', 'Copied. Paste it into WhatsApp or email to Wardah.')); }
        catch (err) { prompt(t('Salin teks ini:', 'Copy this text:'), text); }
        return;
      }
      if (e.target.closest('[data-action="save-draft"]')) {
        readLines('data-line-req', 'qty_requested');
        const lines = cur.lines.filter(l => l.qty_requested > 0).map(l => ({ sku_id: l.sku_id, qty_requested: l.qty_requested }));
        if (!lines.length) return say(t('Isi minimal satu produk dengan jumlah.', 'Add at least one product with a quantity.'));
        try {
          cur = cur.id
            ? await api.editReplenishment(cur.id, { lines, note: field('r-note').value })
            : await api.createReplenishment({ site_id: cur.site_id, brand_id: cur.brand_id, lines, note: field('r-note').value || null });
          say(cur.reference + t(' tersimpan.', ' saved.'));
          paintRep();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="mark-sent"]')) {
        if (!confirm(t('Sudah dikirim ke Wardah? Setelah ini jumlah permintaan tidak bisa diubah.',
          'Sent to Wardah? The requested quantities cannot change after this.'))) return;
        try { cur = await api.sendReplenishment(cur.id); paintRep(); load(); } catch (err) { fail(err); }
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
      if (e.target.closest('[data-action="cancel-rep"]')) {
        if (!confirm(t('Batalkan ', 'Cancel ') + cur.reference + '?')) return;
        try { cur = await api.cancelReplenishment(cur.id); paintRep(); load(); } catch (err) { fail(err); }
      }
    });
    field('site-filter').addEventListener('change', load);

    await load();
  };
})();
