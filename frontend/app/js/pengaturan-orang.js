/* pengaturan-orang.js: Pengaturan, tab Orang & akses (board 2b).
 *
 * Hiryu first: the Hiryu login (MANAGER for an SPV, STAFF for staff) is made,
 * then the person is added here by their @ninjavan.co e-mail. No invitation and
 * no e-mail are sent: they sign in straight away with Google. An SPV adds staff
 * at their own hubs only; Ops HQ adds up to Ops HQ. Someone who leaves: close the
 * WMS account and revoke the Hiryu login the same day.
 *
 * API: GET /admin/users?site_id=   POST /admin/users   PATCH /admin/users/{id}
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  if (!document.getElementById('po-css')) {
    const st = document.createElement('style');
    st.id = 'po-css';
    st.textContent = '.po-two{display:grid;gap:16px;align-items:start;grid-template-columns:minmax(0,1fr)}@media(min-width:1024px){.po-two{grid-template-columns:minmax(0,1fr) 380px}}' +
      '.po-sub{font-size:13px;color:var(--muted)}.po-sub b{color:var(--caution)}.po-off td{color:var(--muted)}' +
      '.po-hubs{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto}';
    document.head.appendChild(st);
  }

  const ROLE_ORDER = ['staff', 'supervisor', 'hq', 'ops_head', 'superadmin'];

  function subLine(u) {
    const p = [esc(u.email)];
    if (!u.active) p.push('<b>' + esc(t('ditutup', 'closed')) + (u.deactivated_at ? ' ' + esc(S.fmt.date(u.deactivated_at)) : '') + '</b>');
    else if (u.never_signed_in) p.push('<b>' + esc(t('belum pernah masuk', 'never signed in')) + '</b>');
    return '<span class="po-sub">' + p.join(' · ') + '</span>';
  }
  const hubText = (u) => u.all_hubs ? t('Semua', 'All') : (u.site_codes.map(S.shortCode).join(', ') || '-');
  function hiryuText(u) {
    const ok = u.active && u.hiryu_login;
    return '<span class="k-strong k-nowrap" style="color:' + (ok ? 'var(--ok)' : u.active ? 'var(--caution)' : 'var(--stop)') + '">' + esc(u.hiryu_text) + '</span>';
  }

  S.tab('orang', async function (ctx) {
    S.setSub('Urutan: login Hiryu dulu, lalu tambah di WMS.', 'Order: the Hiryu login first, then add the person in the WMS.');
    const scope = ctx.params.get('semua') ? null : S.siteId();
    const d = await api().get('/admin/users' + api().qs({ site_id: scope }));
    const rows = d.users;
    ctx.actions.innerHTML = (S.atLeast('hq') ? '<a class="k-btn k-btn--ghost" href="?tab=orang' + (scope ? '&semua=1' : '') + '">' +
      esc(scope ? t('Semua orang', 'Everyone') : t('Dark store ini saja', 'This dark store only')) + '</a>' : '') +
      '<button type="button" class="k-btn k-btn--primary k-phone-only" id="po-add" data-min-role="supervisor">' + icon('plus') + bis('Tambah orang', 'Add a person') + '</button>';
    ctx.body.innerHTML = '<div class="po-two"><div class="k-stack">' +
      '<div class="k-laptop-only"><div class="k-tablewrap"><table class="k-table"><thead><tr><th>' + esc(t('Nama', 'Name')) + '</th><th>' + esc(t('Peran', 'Role')) + '</th><th>Dark store</th><th>' +
      esc(t('Login Hiryu', 'Hiryu login')) + '</th><th></th></tr></thead><tbody>' + rows.map((u) => '<tr class="' + (u.active ? '' : 'po-off') + '">' +
        '<td><div class="k-cell2"><span class="k-cell2__main">' + esc(u.name || u.email) + '</span>' + subLine(u) + '</div></td><td>' + S.roleChip(u.role) + '</td>' +
        '<td class="k-mono k-strong">' + esc(hubText(u)) + '</td><td>' + hiryuText(u) + '</td><td class="k-table__actions">' +
        (u.can_edit ? '<button type="button" class="k-btn k-btn--sm k-btn--ghost" data-edit="' + u.id + '">' + icon('edit', 16) + '<span>' + esc(t('Ubah', 'Edit')) + '</span></button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="k-phone-only k-list">' + rows.map((u) => '<div class="k-row"' + (u.can_edit ? ' data-edit="' + u.id + '" role="button" tabindex="0"' : '') + '>' +
        '<span class="k-row__text"><span class="k-row__title">' + esc(u.name || u.email) + ' ' + S.roleChip(u.role) + '</span>' + subLine(u) +
        '<span class="k-row__sub">Dark store ' + esc(hubText(u)) + ' · Hiryu: ' + esc(u.hiryu_text) + '</span></span>' +
        (u.can_edit ? '<span class="k-row__chev">' + icon('chev', 22) + '</span>' : '') + '</div>').join('') + '</div>' +
      '<div class="k-note k-note--info">' + icon('info', 20) + '<span>' + esc(d.note) + '</span></div></div>' +
      '<div class="k-laptop-only" id="po-formhost"></div></div>';
    const formHost = ctx.body.querySelector('#po-formhost');
    formHost.appendChild(addForm(d));
    S.applyLang(formHost);
    ctx.actions.querySelector('#po-add').addEventListener('click', () => {
      const m = S.drawer({ title: ['Tambah orang', 'Add a person'], body: addForm(d, () => m.close()) });
    });
    ctx.body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editPerson(rows.find((u) => u.id === +b.dataset.edit), d)));
  });

  function hubOptions(multi, chosen) {
    const sites = S.sites().filter((s) => !s.is_training || S.atLeast('hq'));
    if (multi) {
      return '<div class="po-hubs">' + sites.map((s) => '<label class="k-check"><input type="checkbox" name="site_ids" value="' + s.id + '"' + (chosen.includes(s.id) ? ' checked' : '') + '>' +
        '<span>' + esc(S.shortCode(s.code) + ' · ' + s.name) + '</span></label>').join('') + '</div>';
    }
    return '<select class="k-select" name="site_ids">' + sites.map((s) => '<option value="' + s.id + '"' + (chosen.includes(s.id) ? ' selected' : '') + '>' +
      esc(S.shortCode(s.code) + ' · ' + s.name) + '</option>').join('') + '</select>';
  }
  function roleSeg(d, current) {
    const shown = ROLE_ORDER.filter((r) => d.roles.includes(r) || ['staff', 'supervisor', 'hq'].includes(r));
    return '<div class="k-segment" role="group" data-roles>' + shown.map((r) => '<button type="button" data-role="' + r + '" aria-pressed="' + (r === current) + '"' +
      (d.roles.includes(r) ? '' : ' disabled') + ' ' + biAttr(S.roleName(r)[0], S.roleName(r)[1]) + '>' + esc(t(S.roleName(r)[0], S.roleName(r)[1])) + '</button>').join('') + '</div>';
  }
  function wireRoles(root, onChange) {
    root.querySelector('[data-roles]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-role]');
      if (!b || b.disabled) return;
      root.querySelectorAll('[data-role]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (onChange) onChange(b.dataset.role);
    });
    return () => (root.querySelector('[data-role][aria-pressed="true"]') || {}).dataset.role;
  }

  function addForm(d, onDone) {
    const f = document.createElement('form');
    f.className = 'k-card k-card--pad k-stack';
    f.autocomplete = 'off';
    const here = S.siteId();
    f.innerHTML = '<h2 class="k-h2">' + bis('Tambah orang', 'Add a person') + '</h2>' +
      '<label class="k-field"><span class="k-field__label">Email</span><input class="k-input" name="email" type="email" inputmode="email" placeholder="nama@ninjavan.co" required>' +
      '<span class="k-field__hint" ' + biAttr('Hanya email @ninjavan.co.', 'Only @ninjavan.co e-mails.') + '></span></label>' +
      '<label class="k-field"><span class="k-field__label" ' + biAttr('Nama', 'Name') + '></span><input class="k-input" name="name" required></label>' +
      '<div class="k-field" data-hubfield><span class="k-field__label">Dark store</span>' + hubOptions(false, here ? [here] : []) + '</div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Peran', 'Role') + '></span>' + roleSeg(d, 'staff') +
      '<span class="k-field__hint" ' + biAttr('SPV hanya bisa menambah Staf di dark store miliknya.', 'An SPV can only add staff at their own dark store.') + '></span></div>' +
      '<label class="k-check"><input type="checkbox" name="hiryu_login"><span><b ' + biAttr('Login Hiryu sudah dibuat', 'The Hiryu login is made') + '></b><br>' +
      '<span class="k-caption" ' + biAttr('Di Hiryu: STAFF atau MANAGER. Wajib.', 'In Hiryu: STAFF or MANAGER. Required.') + '></span></span></label>' +
      '<div class="k-note k-note--info">' + icon('info', 20) + bis('Orang ini langsung bisa masuk dengan akun Google @ninjavan.co. Tidak ada undangan atau email yang dikirim.',
        'This person can sign in straight away with their @ninjavan.co Google account. No invitation or e-mail is sent.') + '</div>' +
      '<button type="submit" class="k-btn k-btn--primary" data-min-role="supervisor">' + icon('check') + bis('Simpan', 'Save') + '</button>';
    const roleOf = wireRoles(f, (r) => { f.querySelector('[data-hubfield]').hidden = ['hq', 'ops_head', 'superadmin'].includes(r); });
    S.applyLang(f);
    S.lockAll(f);
    if (!d.can_add) f.querySelectorAll('input, select').forEach((i) => { i.disabled = true; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const role = roleOf() || 'staff';
      const email = String(fd.get('email') || '').trim().toLowerCase();
      if (!/@ninjavan\.co$/.test(email)) { S.toast(['Hanya email @ninjavan.co.', 'Only @ninjavan.co e-mails.'], 'stop'); return; }
      if (!fd.get('hiryu_login')) { S.toast(['Buat login Hiryu dulu, lalu centang.', 'Make the Hiryu login first, then tick it.'], 'stop'); return; }
      const hubs = ['hq', 'ops_head', 'superadmin'].includes(role) ? [] : fd.getAll('site_ids').map(Number);
      try {
        await api().post('/admin/users', { email, name: String(fd.get('name') || '').trim(), role, site_ids: hubs, default_site_id: hubs[0] || null, hiryu_login: true });
        S.toast([email + ' ditambahkan. Ia bisa langsung masuk.', email + ' added. They can sign in now.'], 'ok');
        if (onDone) onDone();
        S.rerender();
      } catch (err) { S.fail(err); }
    });
    return f;
  }

  function editPerson(u, d) {
    const body = document.createElement('div');
    body.className = 'k-stack';
    const hq = ['hq', 'ops_head', 'superadmin'].includes(u.role);
    body.innerHTML = '<div><div class="k-strong">' + esc(u.name || '') + '</div><div class="po-sub">' + esc(u.email) + '</div></div>' +
      '<div class="k-field"><span class="k-field__label" ' + biAttr('Peran', 'Role') + '></span>' + roleSeg(d, u.role) + '</div>' +
      '<div class="k-field" data-hubfield' + (hq ? ' hidden' : '') + '><span class="k-field__label">Dark store</span>' + hubOptions(true, u.site_ids) + '</div>' +
      '<label class="k-check"><input type="checkbox" name="hiryu_login"' + (u.hiryu_login ? ' checked' : '') + '><span ' + biAttr('Login Hiryu sudah dibuat', 'The Hiryu login is made') + '></span></label>' +
      (u.active ? '<div class="k-note k-note--caution">' + icon('warn', 20) + bis('Orang yang keluar: tutup akun WMS dan cabut login Hiryu di hari yang sama.', 'Someone who leaves: close the WMS account and revoke the Hiryu login the same day.') + '</div>' : '');
    const roleOf = wireRoles(body, (r) => { body.querySelector('[data-hubfield]').hidden = ['hq', 'ops_head', 'superadmin'].includes(r); });
    const save = async (extra) => {
      const role = roleOf() || u.role;
      const patch = Object.assign({ hiryu_login: body.querySelector('[name="hiryu_login"]').checked }, extra || {});
      if (role !== u.role) patch.role = role;
      if (!['hq', 'ops_head', 'superadmin'].includes(role)) patch.site_ids = Array.from(body.querySelectorAll('[name="site_ids"]:checked')).map((i) => +i.value);
      await api().patch('/admin/users/' + u.id, patch);
      S.toast(['Tersimpan.', 'Saved.'], 'ok');
      S.rerender();
    };
    S.drawer({
      title: ['Ubah orang', 'Edit person'], body,
      actions: [
        u.active ? { label: ['Tutup akun', 'Close the account'], kind: 'problem', minRole: 'supervisor', onClick: async () => {
          if (!(await S.confirm({ title: ['Tutup akun ' + (u.name || u.email) + '?', 'Close ' + (u.name || u.email) + '?'], text: ['Ia tidak bisa masuk lagi. Cabut juga login Hiryu-nya hari ini.', 'They can no longer sign in. Revoke their Hiryu login today too.'], danger: true, ok: ['Tutup akun', 'Close'] }))) return false;
          await save({ active: false, hiryu_login: false });
        } } : { label: ['Buka lagi', 'Reopen'], kind: 'secondary', minRole: 'supervisor', onClick: () => save({ active: true }) },
        { label: ['Simpan', 'Save'], kind: 'primary', minRole: 'supervisor', onClick: () => save() },
      ],
    });
  }
})();
