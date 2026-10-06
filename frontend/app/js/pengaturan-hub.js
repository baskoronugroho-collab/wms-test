/* pengaturan-hub.js: Pengaturan, tab Hub & mulai operasi (boards 2a and 2c).
 *
 * Hub (2a): a hub is made in Hiryu and arrives by itself (name, address and
 * hours read-only). Ops HQ completes only the WMS part: the hub code and the
 * numbers of temporary inbound bins, quarantine trays and order baskets. A new
 * dark store that is a hub the WMS already runs is linked to it instead.
 * Mulai operasi (2c): the kick-off guide, phases A to E; the WMS ticks what it
 * can see, the rest is ticked by hand (Tandai selesai).
 *
 * API: GET /hubs, GET /hubs/{id}, GET /hubs/{id}/preview-codes,
 *      PUT /hubs/{id}/complete, POST /hubs/{id}/link,
 *      GET /hubs/{id}/kickoff, POST|DELETE /hubs/{id}/kickoff/{step}/done
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  if (!document.getElementById('ph-css')) {
    const st = document.createElement('style');
    st.id = 'ph-css';
    st.textContent = `
.ph-hub{display:grid;gap:16px;align-items:start;grid-template-columns:minmax(0,1fr)}
.ph-ko{display:grid;gap:16px;align-items:start;grid-template-columns:minmax(0,1fr)}
@media(min-width:1024px){.ph-hub{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}.ph-ko{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}}
.ph-ro dt{font-size:12px;font-weight:700;color:var(--muted);margin-top:10px}
.ph-ro dd{margin:2px 0 0;font-weight:600}
.ph-form{display:grid;gap:12px}
@media(min-width:600px){.ph-form{grid-template-columns:repeat(2,minmax(0,1fr))}}
.ph-form .k-input{font-family:var(--mono);font-weight:700}
.ph-phase{border-top:1px solid var(--rule)}
.ph-phase:first-child{border-top:0}
.ph-phase__head{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;border:0;background:transparent;font:inherit;text-align:left;cursor:pointer;min-height:56px}
.ph-letter{width:32px;height:32px;border-radius:999px;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}
.ph-letter.is-done{background:var(--ok)}
.ph-step{display:flex;align-items:center;gap:10px;width:100%;padding:10px 16px 10px 60px;border:0;border-top:1px solid var(--rule);background:#fff;font:inherit;text-align:left;cursor:pointer;min-height:48px}
.ph-step .ph-who{white-space:nowrap}
@media(max-width:1023.98px){.ph-step{padding-left:20px}.ph-step .ph-who{display:none}}
.ph-step.is-sel{background:var(--action-bg);box-shadow:inset 4px 0 0 var(--action)}
.ph-step__title{flex:1;min-width:0;font-weight:600}
.ph-check{width:22px;height:22px;border-radius:999px;border:2px solid var(--rule);display:flex;align-items:center;justify-content:center;flex:none;color:#fff}
.ph-check.is-done{background:var(--ok);border-color:var(--ok)}
.ph-check.is-busy{border-color:var(--action);border-style:dashed}
.ph-do{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.ph-kv{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px 12px;align-items:baseline}
.ph-kv dt{font-size:13px;font-weight:700;color:var(--muted)}
.ph-kv dd{margin:0}`;
    document.head.appendChild(st);
  }

  const STATUS = { selesai: ['ok', 'Selesai', 'Done'], sedang: ['info', 'Sedang', 'In progress'], belum: ['', 'Belum', 'Not yet'] };
  const statusPill = (s) => S.pill(STATUS[s][0], STATUS[s][1], STATUS[s][2]);
  const guideHref = (g) => 'panduan.html?s=' + (parseInt(String(g || '').replace(/\D/g, ''), 10) || 2);

  S.tab('hub', async function (ctx) {
    S.setSub('Dark store dibuat di Hiryu dan muncul di sini sendiri. Di WMS Anda hanya melengkapi data gudang.',
      'A dark store is made in Hiryu and shows up here by itself. In the WMS you only complete the warehouse data.');
    const list = await api().get('/hubs');
    const pick = +(ctx.params.get('hub') || 0);
    const fresh = list.hubs.filter((h) => h.new_from_hiryu);
    let hub = list.hubs.find((h) => h.id === pick) || list.hubs.find((h) => h.id === S.siteId()) || fresh[0] || list.hubs[0];
    if (!hub) { ctx.body.innerHTML = '<div class="k-card k-empty"><span class="k-empty__title">' + esc(t('Belum ada dark store', 'No dark stores yet')) + '</span></div>'; return; }

    let h = fresh.filter((x) => x.id !== hub.id).map((x) => '<div class="k-note k-note--caution">' + icon('info', 20) +
      '<span class="k-grow"><b>' + esc(x.banner) + '</b></span><a class="k-btn k-btn--sm k-btn--secondary" href="?tab=hub&hub=' + x.id + '">' + esc(t('Lengkapi', 'Complete')) + '</a></div>').join('');
    if (list.hubs.length > 1) {
      h += '<label class="k-field" style="max-width:340px"><span class="k-field__label">' + bis('Dark store', 'Dark store') + '</span><select class="k-select" id="ph-pick">' +
        list.hubs.map((x) => '<option value="' + x.id + '"' + (x.id === hub.id ? ' selected' : '') + '>' + esc(S.shortCode(x.code) + ' · ' + x.name + (x.new_from_hiryu ? ' (' + t('baru dari Hiryu', 'new from Hiryu') + ')' : '')) + '</option>').join('') + '</select></label>';
    }
    h += '<div id="ph-hub"></div><div id="ph-ko"></div>';
    ctx.body.innerHTML = h;
    const sel = ctx.body.querySelector('#ph-pick');
    if (sel) sel.addEventListener('change', () => { const u = new URL(location.href); u.searchParams.set('hub', sel.value); history.replaceState(null, '', u.pathname + u.search); S.rerender(); });
    paintHub(ctx.body.querySelector('#ph-hub'), hub);
    if (!hub.new_from_hiryu) await paintKickoff(ctx.body.querySelector('#ph-ko'), hub.id);
  });

  /* ---------------- 2a: the hub ---------------- */
  function paintHub(host, hub) {
    const isNew = hub.new_from_hiryu;
    const editable = S.atLeast('hq');
    const field = (name, id, en, hint, val, extra) => '<label class="k-field"><span class="k-field__label" ' + biAttr(id, en) + '></span>' +
      '<input class="k-input" name="' + name + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '>' +
      '<span class="k-field__hint">' + esc(hint) + '</span></label>';
    let h = '';
    if (isNew) {
      h += '<div class="k-note k-note--caution" style="margin-bottom:12px">' + icon('info', 20) + '<span><b>' + esc(hub.banner) + '</b><br>' +
        esc(t('Masuk ', 'Arrived ')) + esc(S.fmt.dt(hub.hiryu_received_at)) + '. ' +
        esc(t('Lengkapi 4 data WMS di bawah, lalu tekan Simpan dark store.', 'Complete the 4 WMS fields below, then press Simpan dark store.')) + '</span></div>';
    }
    h += '<div class="ph-hub"><div class="k-card k-card--pad k-stack k-stack--tight"><div class="k-line k-line--between"><h2 class="k-h2">' + bis('Dari Hiryu', 'From Hiryu') + '</h2>' +
      (hub.from_hiryu ? S.sysChip('Hiryu') : '') + '</div>' +
      (hub.from_hiryu ? '<p class="k-caption">' + bis('Tidak bisa diubah di sini. Ubah di Hiryu, WMS ikut berubah.', 'Cannot be changed here. Change it in Hiryu and the WMS follows.') + '</p>'
        : '<div class="k-note">' + bis('Dark store ini belum tersambung ke Hiryu.', 'This dark store is not linked to Hiryu yet.') + '</div>') +
      '<dl class="ph-ro"><dt>' + esc(t('Nama', 'Name')) + '</dt><dd>' + esc(hub.name) + (hub.hiryu_dark_store_id ? ' <span class="k-muted">(dark store #' + hub.hiryu_dark_store_id + ')</span>' : '') + '</dd>' +
      '<dt>' + esc(t('Jam buka', 'Opening hours')) + '</dt><dd>' + esc(hub.opening_hours_text || '-') + '</dd>' +
      '<dt>' + esc(t('Alamat', 'Address')) + '</dt><dd>' + esc(hub.address || '-') + '</dd></dl></div>' +
      '<form class="k-card k-card--pad k-stack" id="ph-form" autocomplete="off"><div class="k-line k-line--between"><h2 class="k-h2">' + bis('Khusus WMS', 'WMS only') + '</h2>' + S.sysChip('WMS') + '</div>' +
      '<p class="k-caption">' + bis('Wajib diisi sebelum dark store bisa dipakai.', 'Required before the dark store can be used.') + '</p><div class="ph-form">' +
      field('code', 'Kode dark store', 'Dark store code', t('Dipakai di awal kode bin khusus.', 'Starts every special-bin code.'), isNew && /^HY/.test(hub.code) ? '' : S.shortCode(hub.code),
        ' maxlength="8" style="text-transform:uppercase"' + (hub.code_editable ? '' : ' disabled')) +
      field('inbound_bins', 'Bin barang masuk sementara', 'Temporary inbound bins', t('Barang dari truk menunggu di sini sebelum ke rak.', 'Goods off the truck wait here before the rack.'), isNew ? 6 : hub.inbound_bins, ' type="number" min="1" max="99" inputmode="numeric"') +
      field('quarantine_trays', 'Baki karantina', 'Quarantine trays', t('Barang rusak atau ditahan, menunggu keputusan SPV.', 'Damaged or held goods wait for the SPV.'), isNew ? 1 : hub.quarantine_trays, ' type="number" min="1" max="99" inputmode="numeric"') +
      field('outbound_baskets', 'Keranjang pesanan', 'Order baskets', t('Satu keranjang untuk satu pesanan yang diambil.', 'One basket for one order being picked.'), isNew ? 6 : hub.outbound_baskets, ' type="number" min="1" max="99" inputmode="numeric"') +
      '</div><div class="k-note k-note--navy" id="ph-codes">' + esc(hub.special_codes_text || '') + '</div>' +
      (!hub.code_editable ? '<p class="k-caption">' + bis('Kode dark store sudah dipakai di kode bin, jadi tetap.', 'The dark store code is on bin labels already, so it stays.') + '</p>' : '') +
      '<div class="k-line" style="gap:10px"><button type="button" class="k-btn k-btn--secondary" id="ph-cancel">' + bis('Batal', 'Cancel') + '</button>' +
      '<button type="submit" class="k-btn k-btn--primary k-grow" data-min-role="hq">' + icon('check') + bis('Simpan dark store', 'Save dark store') + '</button></div></form></div>';
    if (isNew && hub.link_targets && hub.link_targets.length) {
      h += '<div class="k-card k-card--pad k-stack" style="margin-top:16px"><h2 class="k-h2">' + bis('Atau: sambungkan ke dark store yang sudah ada', 'Or: link to a dark store that already exists') + '</h2>' +
        '<p class="k-caption">' + bis('Pakai ini bila dark store dari Hiryu ini sudah jalan di WMS. Dark store di WMS itu mengambil nama, alamat dan jam buka dari Hiryu; toko dari Hiryu pindah ke sana.',
          'Use this when this Hiryu dark store already runs in the WMS. That WMS dark store takes the name, address and hours from Hiryu; the stores from Hiryu move to it.') + '</p>' +
        '<div class="k-line" style="gap:10px;flex-wrap:wrap"><select class="k-select" id="ph-target" style="max-width:280px">' +
        hub.link_targets.map((x) => '<option value="' + x.id + '">' + esc(S.shortCode(x.code) + ' · ' + x.name) + '</option>').join('') + '</select>' +
        '<button type="button" class="k-btn k-btn--secondary" id="ph-link" data-min-role="hq">' + icon('link') + bis('Sambungkan', 'Link') + '</button></div></div>';
    }
    host.innerHTML = h;
    S.applyLang(host);
    S.lockAll(host);
    const form = host.querySelector('#ph-form');
    if (!editable) form.querySelectorAll('input').forEach((i) => { i.disabled = true; });
    let pT = null;
    const preview = () => {
      clearTimeout(pT);
      pT = setTimeout(async () => {
        const fd = new FormData(form);
        const code = (fd.get('code') || S.shortCode(hub.code) || '').toString().toUpperCase();
        if (!code) { host.querySelector('#ph-codes').textContent = ''; return; }
        try {
          const r = await api().get('/hubs/' + hub.id + '/preview-codes' + api().qs({ code, inbound_bins: fd.get('inbound_bins'), quarantine_trays: fd.get('quarantine_trays'), outbound_baskets: fd.get('outbound_baskets') }));
          host.querySelector('#ph-codes').textContent = r.text;
        } catch (e) { /* the preview is a nicety */ }
      }, 250);
    };
    form.addEventListener('input', preview);
    if (isNew || !hub.special_codes_text) preview();
    host.querySelector('#ph-cancel').addEventListener('click', () => S.rerender());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        code: String(fd.get('code') == null ? S.shortCode(hub.code) : fd.get('code')).trim().toUpperCase() || (hub.code_editable ? '' : hub.code),
        inbound_bins: parseInt(fd.get('inbound_bins'), 10) || 0,
        quarantine_trays: parseInt(fd.get('quarantine_trays'), 10) || 0,
        outbound_baskets: parseInt(fd.get('outbound_baskets'), 10) || 0,
      };
      if (!hub.code_editable) body.code = hub.code;
      try {
        const r = await api().put('/hubs/' + hub.id + '/complete', body);
        S.toast(S.pick(r.message), 'ok');
        S.rerender();
      } catch (err) { S.fail(err); }
    });
    const link = host.querySelector('#ph-link');
    if (link) link.addEventListener('click', async () => {
      const tsel = host.querySelector('#ph-target');
      const name = tsel.options[tsel.selectedIndex].textContent;
      if (!(await S.confirm({ title: ['Sambungkan ke ' + name + '?', 'Link to ' + name + '?'],
        text: ['Dark store #' + hub.hiryu_dark_store_id + ' menjadi ' + name + '. Entri baru ini dimatikan.', 'Dark store #' + hub.hiryu_dark_store_id + ' becomes ' + name + '. This new entry is switched off.'] }))) return;
      try {
        const r = await api().post('/hubs/' + hub.id + '/link', { target_site_id: +tsel.value });
        S.toast(r.message, 'ok');
        location.href = '?tab=hub&hub=' + r.hub.id;
      } catch (err) { S.fail(err); }
    });
  }

  /* ---------------- 2c: Mulai operasi ---------------- */
  async function paintKickoff(host, siteId, keep) {
    const d = await api().get('/hubs/' + siteId + '/kickoff');
    let sel = keep || d.current_step || d.steps[d.steps.length - 1].key;
    const open = new Set();
    d.phases.forEach((p) => {
      const mine = d.steps.filter((s) => s.phase === p.phase);
      if (mine.some((s) => s.key === sel) || (p.status === 'sedang')) open.add(p.phase);
    });
    function paint() {
      const pct = Math.round(100 * d.done / d.total);
      let h = '<div class="k-card k-card--pad k-stack k-stack--tight" style="margin-top:16px"><div class="k-line k-line--between" style="flex-wrap:wrap;gap:8px">' +
        '<h2 class="k-h2">' + esc(t('Mulai operasi ', 'Go-live ')) + esc(S.shortCode(d.site.code)) + '</h2><span class="k-strong">' +
        esc(t(d.done + ' dari ' + d.total + ' langkah selesai', d.done + ' of ' + d.total + ' steps done')) + '</span></div>' +
        '<p class="k-caption">' + esc(d.intro) + '</p><div class="k-progress"><span class="k-progress__bar" style="width:' + pct + '%"></span></div></div>' +
        '<div class="ph-ko" style="margin-top:16px"><div class="k-card" style="overflow:hidden">' + d.phases.map((p) => {
          const steps = d.steps.filter((s) => s.phase === p.phase);
          const isOpen = open.has(p.phase);
          return '<div class="ph-phase"><button type="button" class="ph-phase__head" data-phase="' + p.phase + '" aria-expanded="' + isOpen + '">' +
            '<span class="ph-letter' + (p.status === 'selesai' ? ' is-done' : '') + '">' + p.phase + '</span>' +
            '<span class="k-grow"><span class="k-strong" ' + biAttr(p.title, p.title_en) + '></span> <span class="k-muted">' +
            esc(t(p.done + ' dari ' + p.steps + ' selesai', p.done + ' of ' + p.steps + ' done')) + '</span>' +
            (!isOpen && p.subtitle ? '<br><span class="k-caption">' + esc(p.subtitle) + '</span>' : '') + '</span>' +
            statusPill(p.status) + icon(isOpen ? 'minus' : 'plus', 18) + '</button>' +
            (isOpen ? steps.map((s) => '<button type="button" class="ph-step' + (s.key === sel ? ' is-sel' : '') + '" data-step="' + s.key + '">' +
              '<span class="ph-check' + (s.status === 'selesai' ? ' is-done' : s.status === 'sedang' ? ' is-busy' : '') + '">' + (s.status === 'selesai' ? icon('check', 14, 3) : '') + '</span>' +
              '<span class="ph-step__title" ' + biAttr(s.title, s.title_en) + '></span><span class="k-muted ph-who" style="font-size:13px">' + esc(s.who.map((r) => t(S.roleName(r)[0], S.roleName(r)[1])).join(', ')) + '</span>' +
              statusPill(s.status) + '</button>').join('') : '') + '</div>';
        }).join('') + '</div><div id="ph-detail"></div></div>';
      host.innerHTML = h;
      paintDetail();
      S.applyLang(host);
      S.lockAll(host);
      host.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => {
        if (open.has(b.dataset.phase)) open.delete(b.dataset.phase); else open.add(b.dataset.phase);
        paint();
      }));
      host.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        sel = b.dataset.step;
        paint();
        if (window.innerWidth < 1024) host.querySelector('#ph-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    }
    function paintDetail() {
      const s = d.steps.find((x) => x.key === sel);
      const p = d.phases.find((x) => x.phase === s.phase);
      const inPhase = d.steps.filter((x) => x.phase === s.phase);
      const no = inPhase.indexOf(s) + 1;
      const done = s.status === 'selesai';
      let h = '<div class="k-card k-card--pad k-stack' + (s.key === d.current_step ? ' k-card--focus' : '') + '">' +
        '<div class="k-line k-line--between"><span class="k-eyebrow">' + esc(t('Fase ', 'Phase ')) + s.phase + ' · ' + esc(t(p.title, p.title_en)) + ' · ' +
        esc(t('langkah ' + no + ' dari ' + inPhase.length, 'step ' + no + ' of ' + inPhase.length)) + '</span>' + statusPill(s.status) + '</div>' +
        '<h3 class="k-h2" ' + biAttr(s.title, s.title_en) + '></h3>' +
        '<dl class="ph-kv"><dt>' + esc(t('Siapa', 'Who')) + '</dt><dd>' + s.who.map(S.roleChip).join(' ') + '</dd>' +
        '<dt>' + esc(t('Di mana', 'Where')) + '</dt><dd>' + s.systems.map(S.sysChip).join(' ') + ' <span>' + esc(s.where) + '</span></dd></dl>' +
        '<ul class="ph-do">' + s.do.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        '<div class="k-note ' + (s.mode === 'auto' ? 'k-note--info' : '') + '">' + icon(s.mode === 'auto' ? 'refresh' : 'info', 20) + '<span>' + esc(s.how) +
        (s.detail ? ' <b>' + esc(s.detail) + '</b>' : '') + '</span></div>';
      if (done) {
        h += '<span class="k-strong" style="color:var(--ok)">' + icon('check', 18, 2.6) + ' ' + esc(s.done_by === 'WMS' ? t('Dicentang WMS', 'Ticked by the WMS') :
          t('Selesai', 'Done') + (s.done_by ? ' · ' + s.done_by : '') + (s.done_at ? ' · ' + S.fmt.date(s.done_at) : '')) + '</span>';
      }
      h += '<div class="k-line" style="gap:8px;flex-wrap:wrap">' +
        (s.screen ? '<a class="k-btn k-btn--secondary" href="' + esc(s.screen) + '">' + icon('arrow') + bis('Buka layar ini', 'Open this screen') + '</a>' : '') +
        '<a class="k-btn k-btn--ghost" href="' + guideHref(s.guide) + '">' + icon('book') + bis('Lihat panduan', 'See the guide') + '</a>' +
        (s.mode === 'manual' && !done ? '<button type="button" class="k-btn k-btn--primary" data-mark data-min-role="' + esc(s.mark_role) + '">' + icon('check') + bis('Tandai selesai', 'Mark done') + '</button>' : '') +
        (s.mode === 'manual' && done ? '<button type="button" class="k-btn k-btn--ghost" data-unmark data-min-role="' + esc(s.mark_role) + '">' + icon('undo') + bis('Batalkan tanda', 'Undo') + '</button>' : '') +
        '</div></div>';
      const open2 = d.open_earlier.map((k) => d.steps.find((x) => x.key === k)).filter((x) => x && x.key !== s.key).slice(0, 3);
      if (open2.length) {
        h += '<span class="k-eyebrow" style="margin-top:12px;display:block">' + esc(t('Masih terbuka', 'Still open')) + '</span>' + open2.map((o) =>
          '<button type="button" class="k-card k-card--pad k-line" style="width:100%;border:0;text-align:left;margin-top:8px;cursor:pointer" data-jump="' + o.key + '">' +
          statusPill(o.status) + '<span class="k-grow k-strong" ' + biAttr(o.title, o.title_en) + '></span><span class="k-muted">' + esc(t('Fase ', 'Phase ')) + o.phase + '</span></button>').join('');
      }
      const box = host.querySelector('#ph-detail');
      box.innerHTML = h;
      const mark = box.querySelector('[data-mark]'), unmark = box.querySelector('[data-unmark]');
      if (mark) mark.addEventListener('click', async () => {
        try { await api().post('/hubs/' + siteId + '/kickoff/' + s.key + '/done', {}); S.toast(['Ditandai selesai.', 'Marked done.'], 'ok'); paintKickoff(host, siteId, s.key); } catch (e) { S.fail(e); }
      });
      if (unmark) unmark.addEventListener('click', async () => {
        try { await api().del('/hubs/' + siteId + '/kickoff/' + s.key + '/done'); paintKickoff(host, siteId, s.key); } catch (e) { S.fail(e); }
      });
      box.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
        sel = b.dataset.jump; open.add(d.steps.find((x) => x.key === sel).phase); paint();
      }));
    }
    paint();
  }
})();
