/* screens/hub.js — sites and hubs (console/hub.html).
 *
 * GET /api/admin/sites for the cards; PATCH /api/admin/sites/{id} for name,
 * address and active; POST /api/sites to create; POST /api/sites/{id}/racks and
 * /racks/generate to grow the layout. Every write is admin-only server-side, so
 * the controls are only drawn for an admin — a supervisor still gets the cards,
 * because a station supervisor needs to see their own racks.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;

  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const val = f => (field(f) || {}).value || '';

  function openDrawer() {
    const d = $('#drawer-site'), sc = $('.scrim');
    if (d) d.classList.add('is-open');
    if (sc) sc.classList.add('is-open');
  }
  function closeDrawer() {
    const d = $('#drawer-site'), sc = $('.scrim');
    if (d) d.classList.remove('is-open');
    if (sc) sc.classList.remove('is-open');
  }

  /* What a site does follows from its type and its training flag — never from
     a stored column. A training site picks, but never publishes: the outbox
     suppresses it at the single outbound edge, so saying "Ya" would be a lie. */
  function roles(s) {
    if (s.site_type === 'hub') {
      const na = '<span class="na" ' + biAttr('tidak berlaku', 'not applicable') + '>tidak berlaku</span>';
      return { picks: na, publishes: na };
    }
    return {
      picks: '<span ' + biAttr('Ya', 'Yes') + '>Ya</span>',
      publishes: s.is_training
        ? '<span class="na" ' + biAttr('Tidak — latihan', 'No — training') + '>Tidak — latihan</span>'
        : '<span ' + biAttr('Ya', 'Yes') + '>Ya</span>',
    };
  }

  function rackChips(racks) {
    return racks.map(r =>
      '<span class="rack-chip"><span class="rack-chip__code">' + esc(r.code) + '</span>' +
      '<span class="rack-chip__meta">' + r.levels + ' tk × ' + r.positions_per_level + '</span>' +
      '<span class="rack-chip__meta">' + r.occupied + '/' + r.locations + '</span></span>').join('');
  }

  function card(s, admin) {
    const r = roles(s);
    const p = pct(s.occupied_locations, s.total_locations);
    const fact = (id, en, html) =>
      '<span style="display:flex;flex-direction:column;gap:2px"><span class="kpi-card__label" ' +
      biAttr(id, en) + '>' + esc(id) + '</span><span style="font-size:var(--fs-c-label)">' + html +
      '</span></span>';
    let body = '';
    if (s.site_type === 'hub') {
      body =
        '<span class="inline-note"><span ' + biAttr(
          'Hub menerima dari brand, membongkar, dan mengirim tote tersegel ke darkstore. Hub tidak mengambil pesanan pelanggan dan tidak mengirim angka stok ke Hiryu — kolom itu kosong karena memang tidak berlaku.',
          'A hub receives from the brand, decants, and dispatches sealed totes to the darkstores. It never picks a customer order and never publishes stock to Hiryu — those columns are blank because they do not apply.') +
        '></span></span>' +
        (s.racks.length ? '<div class="rack-chips">' + rackChips(s.racks) + '</div>' : '') +
        '<div style="display:flex;gap:var(--sp-2);flex-wrap:wrap">' +
        '<a class="cbtn" href="transfer.html"><span ' + biAttr('Lihat transfer keluar', 'View outbound transfers') + '></span></a>' +
        '<a class="cbtn" href="../19-gudang-kirim.html"><span ' + biAttr('Buka layar kirim', 'Open dispatch screen') + '></span></a>' +
        '</div>';
    } else if (s.total_locations) {
      body =
        '<div class="occ"><span class="occ__top">' +
        '<span class="occ__num">' + NJW.fmt.n(s.occupied_locations) + ' / ' + NJW.fmt.n(s.total_locations) + '</span>' +
        '<span class="occ__label" ' + biAttr('posisi rak terpakai', 'rack positions in use') + '></span>' +
        '<span class="toolbar__spacer"></span><span class="occ__label">' + p + '%</span></span>' +
        '<span class="occ__track"><span class="occ__fill' + (p >= 95 ? ' is-full' : p > 85 ? ' is-tight' : '') +
        '" style="width:' + p + '%"></span></span></div>' +
        '<div class="rack-chips">' + rackChips(s.racks) + '</div>';
    } else {
      body = '<span class="inline-note inline-note--warn"><span ' +
        biAttr('Belum ada rak. Admin bisa membuat tata letak lewat Ubah.',
               'No racks yet. An admin can build the layout from Edit.') + '></span></span>';
    }
    return '<div class="ccard" data-site="' + s.id + '"' + (s.active ? '' : ' style="opacity:.6"') + '>' +
      '<div style="display:flex;align-items:flex-start;gap:var(--sp-3);flex-wrap:wrap">' +
      '<div style="flex:1 1 220px;display:flex;flex-direction:column;gap:4px;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
      '<span class="td-code" style="font-size:var(--fs-c-h2);font-weight:700">' + esc(s.code) + '</span>' +
      (s.site_type === 'hub'
        ? '<span class="sitetype sitetype--hub" ' + biAttr('Hub', 'Hub') + '>Hub</span>'
        : '<span class="sitetype sitetype--dark" ' + biAttr('Darkstore', 'Darkstore') + '>Darkstore</span>') +
      (s.is_training ? '<span class="badge-training" ' + biAttr('LOKASI LATIHAN', 'TRAINING SITE') + '>LOKASI LATIHAN</span>' : '') +
      (s.active ? '' : '<span class="spill spill--neutral"><span class="spill__dot"></span><span ' +
        biAttr('Nonaktif', 'Inactive') + '>Nonaktif</span></span>') +
      '</div>' +
      '<span style="font-size:var(--fs-c-label);color:var(--ink);font-weight:500">' + esc(s.name) + '</span>' +
      '<span style="font-size:var(--fs-c-meta);color:var(--muted)">' + esc(s.address || '—') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:var(--sp-4);flex:0 0 auto">' +
      fact('Ambil pesanan', 'Picks orders', r.picks) +
      fact('Kirim stok ke Hiryu', 'Publishes stock to Hiryu', r.publishes) +
      fact('Staf', 'Staff', '<span class="td-code">' + s.staff_count + '</span>') +
      '</div>' +
      (admin ? '<button class="cbtn" type="button" data-edit="' + s.id + '" ' + biAttr('Ubah', 'Edit') + '>Ubah</button>' : '') +
      '</div>' + body + '</div>';
  }

  function kpis(sites) {
    const live = sites.filter(s => s.active);
    const dark = live.filter(s => s.site_type !== 'hub' && !s.is_training);
    const trn = live.filter(s => s.is_training).length;
    const hubs = live.filter(s => s.site_type === 'hub');
    setF('kpi-sites', dark.length);
    bi(field('kpi-sites-foot'), trn + ' lokasi latihan', trn + (trn === 1 ? ' training site' : ' training sites'));
    setF('kpi-hubs', hubs.length);
    const names = hubs.map(h => h.name).join(', ');
    bi(field('kpi-hubs-foot'), names || 'belum ada hub', names || 'no hub yet');
    const used = dark.reduce((n, s) => n + s.occupied_locations, 0);
    const total = dark.reduce((n, s) => n + s.total_locations, 0);
    setF('kpi-used', NJW.fmt.n(used) + ' / ' + NJW.fmt.n(total));
    bi(field('kpi-used-foot'), pct(used, total) + '% terpakai', pct(used, total) + '% in use');
    const tight = dark.filter(s => s.total_locations && pct(s.occupied_locations, s.total_locations) > 85);
    setF('kpi-tight', tight.length);
    const tc = field('kpi-tight') && field('kpi-tight').closest('.kpi-card');
    if (tc) tc.classList.toggle('kpi-card--caution', tight.length > 0);
  }

  NJW.screens.hub = async () => {
    const me = W.me();
    const admin = me && me.role === 'admin';
    let sites = [];
    let editing = null;          // the site in the drawer, or null when creating

    show(region('admin-actions'), admin);

    async function load() {
      try {
        sites = (await api.sites()).sites;
      } catch (e) { return fail(e); }
      kpis(sites);
      const host = region('sites');
      host.innerHTML = sites.length ? sites.map(s => card(s, admin)).join('')
        : '<p class="note" ' + biAttr('Belum ada lokasi yang bisa Anda lihat.', 'No sites you can see yet.') + '></p>';
      applyLangTo(host);
      if (editing) {
        editing = sites.find(s => s.id === editing.id) || null;
        if (editing) paintRacks(editing);
      }
    }

    function paintRacks(s) {
      const chips = region('site-rack-chips');
      if (chips) chips.innerHTML = s.racks.length ? rackChips(s.racks) : '';
      show(region('site-generate'), !s.racks.length);
      show(region('site-add-rack'), s.racks.length > 0);
    }

    function openFor(s) {
      editing = s;
      const create = !s;
      bi(field('site-drawer-title'), create ? 'Tambah lokasi' : 'Ubah lokasi ' + s.code,
                                     create ? 'Add site' : 'Edit site ' + s.code);
      show(region('site-code-field'), create);
      field('site-code-input').value = '';
      field('site-name-input').value = create ? '' : s.name;
      field('site-address-input').value = create ? '' : (s.address || '');
      const type = field('site-type-input'), trn = field('site-training-input');
      type.value = create ? 'darkstore' : s.site_type;
      trn.checked = create ? false : s.is_training;
      // SitePatch carries no type or training flag; showing them editable in
      // edit mode would promise a change the API silently drops.
      type.disabled = !create;
      trn.disabled = !create;
      show(region('site-type-hint'), !create);
      show(region('site-active-field'), !create && !s.is_training);
      if (!create) field('site-active-input').checked = s.active;
      show(region('site-racks'), !create);
      if (!create) paintRacks(s);
      openDrawer();
    }

    document.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return openFor(sites.find(s => s.id === +ed.dataset.edit));
      if (e.target.closest('[data-action="new-site"]')) return openFor(null);

      if (e.target.closest('[data-action="save-site"]')) {
        const name = val('site-name-input').trim();
        if (!name) return say('Nama lokasi wajib diisi.');
        try {
          if (!editing) {
            const code = val('site-code-input').trim().toUpperCase();
            if (!code) return say('Kode lokasi wajib diisi.');
            const made = await api.raw.post('/sites', {
              code, name, address: val('site-address-input').trim() || null,
              site_type: val('site-type-input'),
              is_training: field('site-training-input').checked,
            });
            say(made.code + ' dibuat. Buat raknya lewat Ubah.');
          } else {
            const body = { name, address: val('site-address-input').trim() || null };
            if (!editing.is_training) body.active = field('site-active-input').checked;
            const r = await api.updateSite(editing.id, body);
            say(r.message || 'Tersimpan.');
          }
          closeDrawer();
          editing = null;
          await load();
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="generate-racks"]') && editing) {
        const codes = val('gen-codes').split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
        if (!codes.length) return say('Isi minimal satu kode rak.');
        if (!confirm('Buat ' + codes.length + ' rak di ' + editing.code + '?')) return;
        try {
          const r = await api.raw.post('/sites/' + editing.id + '/racks/generate', {
            rack_codes: codes,
            level_count: +val('gen-levels') || 5,
            positions_per_level: +val('gen-positions') || 5,
          });
          say(r.message || 'Rak dibuat.');
          await load();
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="add-rack"]') && editing) {
        const code = val('rack-code').trim().toUpperCase();
        if (!code) return say('Isi kode rak.');
        try {
          const r = await api.raw.post('/sites/' + editing.id + '/racks', {
            code,
            level_count: +val('rack-levels') || 5,
            positions_per_level: +val('rack-positions') || 5,
            basket_size: val('rack-basket') || 'M',
          });
          field('rack-code').value = '';
          say(r.message || 'Rak ditambahkan.');
          await load();
        } catch (err) { fail(err); }
      }
    });

    await load();
  };
})();
