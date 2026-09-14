/* screens/staf.js — staff accounts (console/staf.html).
 *
 * GET/POST/PATCH /api/admin/users, all admin-only. The list is small (one
 * pilot, tens of people) and the endpoint has no paging, so search, filters
 * and the pager work client-side over the whole list.
 *
 * The API refuses self-deactivation and self-role-change with a 422. Those
 * controls are disabled on the signed-in admin's own row so the click never
 * happens: a refusal after the fact reads like a bug.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;

  const PER = 25;
  const ROLE_LABEL = { admin: 'Admin', supervisor: 'Supervisor', hub_operator: 'Operator hub', staff: 'Staf' };
  const ROLE_TONE = { admin: 'accent', supervisor: 'info' };

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

  function pageList(cur, n) {
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const keep = [...new Set([1, n, cur - 1, cur, cur + 1].filter(p => p >= 1 && p <= n))]
      .sort((a, b) => a - b);
    const out = [];
    keep.forEach((p, i) => { if (i && p - keep[i - 1] > 1) out.push('…'); out.push(p); });
    return out;
  }
  function paintPager(total, page, go) {
    const from = total ? (page - 1) * PER + 1 : 0, to = Math.min(total, page * PER);
    setF('range', from + '–' + to);
    setF('total', NJW.fmt.n(total));
    const nav = $('.pager__nav');
    if (!nav) return;
    const pages = Math.max(1, Math.ceil(total / PER));
    nav.innerHTML =
      '<button class="pager__page" type="button" data-pg="' + (page - 1) + '" aria-label="Sebelumnya"' +
      (page <= 1 ? ' disabled' : '') + '>‹</button>' +
      pageList(page, pages).map(p => p === '…' ? '<span class="pager__gap">…</span>'
        : '<button class="pager__page' + (p === page ? ' is-on' : '') + '" type="button" data-pg="' +
          p + '">' + p + '</button>').join('') +
      '<button class="pager__page" type="button" data-pg="' + (page + 1) + '" aria-label="Berikutnya"' +
      (page >= pages ? ' disabled' : '') + '>›</button>';
    nav.onclick = e => {
      const b = e.target.closest('[data-pg]');
      if (b && !b.disabled) go(+b.dataset.pg);
    };
  }

  function downloadCsv(name, rows) {
    const cell = v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = rows.map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  NJW.screens.staf = async () => {
    const me = W.me();
    let users = [], roles = Object.keys(ROLE_LABEL), sites = [];
    let status = 'all', page = 1, editing = null;

    const host = region('staff');
    const table = $('#tbl-staff');

    try {
      const [u, s] = await Promise.all([api.users(), api.sites().catch(() => ({ sites: [] }))]);
      users = u.users;
      roles = u.roles && u.roles.length ? u.roles : roles;
      sites = s.sites;
    } catch (e) {
      if (e.status === 403) {
        host.innerHTML = '<tr><td colspan="7" class="note" ' +
          biAttr('Hanya admin yang bisa melihat dan mengubah daftar staf.',
                 'Only an admin can see and change the staff list.') + '></td></tr>';
        applyLangTo(host);
        $$('[data-action="new-user"]').forEach(b => { b.disabled = true; b.classList.add('is-disabled'); });
        return;
      }
      return fail(e);
    }

    const codeToId = new Map(sites.map(s => [s.code, s.id]));
    const siteIdsOf = u => u.site_codes.map(c => codeToId.get(c)).filter(Boolean);

    const roleFilter = field('role-filter');
    roleFilter.insertAdjacentHTML('beforeend', roles.map(r =>
      '<option value="' + esc(r) + '">' + esc(ROLE_LABEL[r] || r) + '</option>').join(''));
    field('u-role').innerHTML = roles.map(r =>
      '<option value="' + esc(r) + '">' + esc(ROLE_LABEL[r] || r) + '</option>').join('');

    function visible() {
      const q = (field('search').value || '').trim().toLowerCase();
      const role = roleFilter.value;
      return users.filter(u =>
        (status === 'all' || (status === 'active') === u.active) &&
        (!role || u.role === role) &&
        (!q || (u.name + ' ' + u.email + ' ' + u.role + ' ' + u.site_codes.join(' '))
          .toLowerCase().includes(q)));
    }

    function row(u) {
      const self = me && u.email === me.email;
      const tone = ROLE_TONE[u.role] || 'neutral';
      return '<tr data-uid="' + u.id + '"' + (self ? ' data-self="true"' : '') +
        (u.active ? '' : ' class="is-inactive"') + '>' +
        '<td class="td-check"><input class="checkbox" type="checkbox" aria-label="Pilih ' + esc(u.email) + '"></td>' +
        '<td class="td-strong">' + esc(u.name || '—') +
        (self ? ' <span class="tagline" ' + biAttr('akun Anda', 'your account') + '>akun Anda</span>' : '') + '</td>' +
        '<td class="td-code">' + esc(u.email) + '</td>' +
        '<td><span class="spill spill--' + tone + '"><span class="role">' + esc(u.role) + '</span></span></td>' +
        '<td class="td-code">' + esc(u.site_codes.join(', ') || '—') + '</td>' +
        '<td>' + (u.active
          ? '<span class="spill spill--ok"><span class="spill__dot"></span><span ' + biAttr('Aktif', 'Active') + '>Aktif</span></span>'
          : '<span class="spill spill--neutral"><span class="spill__dot"></span><span ' + biAttr('Nonaktif', 'Inactive') + '>Nonaktif</span></span>') +
        '</td>' +
        '<td class="td-actions">' +
        '<button class="cbtn cbtn--sm" type="button" data-edit="' + u.id + '" ' + biAttr('Ubah', 'Edit') + '>Ubah</button>' +
        (self
          ? '<button class="cbtn cbtn--sm is-disabled" type="button" disabled title="Tidak bisa menonaktifkan akun sendiri — minta admin lain." ' +
            biAttr('Nonaktifkan', 'Deactivate') + '>Nonaktifkan</button>'
          : '<button class="cbtn cbtn--sm" type="button" data-toggle="' + u.id + '" ' +
            (u.active ? biAttr('Nonaktifkan', 'Deactivate') + '>Nonaktifkan'
                      : biAttr('Aktifkan', 'Reactivate') + '>Aktifkan') + '</button>') +
        '</td></tr>';
    }

    function render() {
      const list = visible();
      const pages = Math.max(1, Math.ceil(list.length / PER));
      page = Math.min(Math.max(1, page), pages);
      const slice = list.slice((page - 1) * PER, page * PER);
      host.innerHTML = slice.length ? slice.map(row).join('')
        : '<tr><td colspan="7" class="note" ' + biAttr('Tidak ada staf yang cocok.', 'No matching staff.') + '></td></tr>';
      applyLangTo(host);
      paintPager(list.length, page, p => { page = p; render(); });
      // Selection belongs to the rows it was made on; a re-render drops it.
      const all = $('thead .checkbox', table);
      if (all) { all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    function selectedIds() {
      return $$('tbody .checkbox', table).filter(b => b.checked)
        .map(b => +b.closest('tr').dataset.uid).filter(Boolean);
    }

    function siteChips(hostEl, checkedIds) {
      hostEl.innerHTML = sites.filter(s => s.active || checkedIds.includes(s.id)).map(s =>
        '<label class="chipbox" title="' + esc(s.name) + '"><input type="checkbox" value="' + s.id + '"' +
        (checkedIds.includes(s.id) ? ' checked' : '') + '>' + esc(s.code) +
        (s.is_training ? ' · latihan' : '') + '</label>').join('');
    }

    function openUser(u) {
      editing = u || null;
      const self = u && me && u.email === me.email;
      const title = field('staff-drawer-title');
      title.dataset.id = u ? 'Ubah staf' : 'Tambah staf';
      title.dataset.en = u ? 'Edit staff' : 'Add staff';
      const email = field('u-email');
      email.value = u ? u.email : '';
      email.disabled = !!u;          // the email is the sign-in identity; changing it is a new account
      field('u-name').value = u ? (u.name || '') : '';
      const role = field('u-role');
      role.value = u ? u.role : 'staff';
      role.disabled = !!self;
      field('u-role-hint').style.display = self ? '' : 'none';
      const def = field('u-default');
      def.innerHTML = '<option value="">—</option>' + sites.filter(s => s.active).map(s =>
        '<option value="' + s.id + '">' + esc(s.code + ' — ' + s.name) + '</option>').join('');
      def.value = u && u.default_site_id ? String(u.default_site_id) : '';
      // New staff start on the training site, as the hint under the chips says.
      const trn = sites.find(s => s.is_training && s.active);
      siteChips(region('u-sites'), u ? siteIdsOf(u) : (trn ? [trn.id] : []));
      applyLangTo($('#drawer-staff'));
      openDrawer('#drawer-staff');
    }

    async function saveUser() {
      const site_ids = $$('input:checked', region('u-sites')).map(i => +i.value);
      const defVal = field('u-default').value;
      const default_site_id = defVal ? +defVal : null;
      // A default site the person may not work at would strand them at sign-in.
      if (default_site_id && !site_ids.includes(default_site_id)) site_ids.push(default_site_id);
      const name = field('u-name').value.trim() || null;
      try {
        if (!editing) {
          const email = field('u-email').value.trim().toLowerCase();
          if (!/^[^@\s]+@ninjavan\.co$/.test(email)) return say('Pakai email @ninjavan.co.');
          await api.createUser({ email, name, role: field('u-role').value, default_site_id, site_ids });
          say(email + ' ditambahkan.');
        } else {
          const body = { name, site_ids };
          if (default_site_id) body.default_site_id = default_site_id;
          const self = me && editing.email === me.email;
          if (!self && field('u-role').value !== editing.role) body.role = field('u-role').value;
          await api.updateUser(editing.id, body);
          say('Tersimpan.');
        }
        closeDrawers();
        await reload();
      } catch (e) { fail(e); }
    }

    async function reload() {
      try { users = (await api.users()).users; } catch (e) { return fail(e); }
      render();
    }

    /* ---- wiring ---- */
    field('search').addEventListener('input', () => { page = 1; render(); });
    roleFilter.addEventListener('change', () => { page = 1; render(); });
    $$('[data-filter]', region('status-filter')).forEach(b => b.addEventListener('click', () => {
      status = b.dataset.filter;
      $$('[data-filter]', region('status-filter')).forEach(o => o.classList.toggle('is-on', o === b));
      page = 1;
      render();
    }));

    document.addEventListener('click', async e => {
      if (e.target.closest('[data-action="new-user"]')) return openUser(null);
      const ed = e.target.closest('[data-edit]');
      if (ed) return openUser(users.find(u => u.id === +ed.dataset.edit));
      if (e.target.closest('[data-action="save-user"]')) return saveUser();

      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const u = users.find(x => x.id === +tg.dataset.toggle);
        if (!u) return;
        const verb = u.active ? 'Nonaktifkan' : 'Aktifkan kembali';
        if (!confirm(verb + ' ' + u.email + '?')) return;
        try { await api.updateUser(u.id, { active: !u.active }); await reload(); } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="export"]')) {
        downloadCsv('staf.csv', [['name', 'email', 'role', 'sites', 'active']].concat(
          visible().map(u => [u.name, u.email, u.role, u.site_codes.join(' '), u.active ? 'yes' : 'no'])));
        return;
      }

      if (e.target.closest('[data-action="bulk-deactivate"]')) {
        const ids = selectedIds().filter(id => {
          const u = users.find(x => x.id === id);
          return u && u.active && !(me && u.email === me.email);
        });
        if (!ids.length) return say('Tidak ada akun aktif lain yang dipilih.');
        if (!confirm('Nonaktifkan ' + ids.length + ' akun?')) return;
        let done = 0;
        for (const id of ids) {
          try { await api.updateUser(id, { active: false }); done++; } catch (err) { say(err.message); }
        }
        say(done + ' akun dinonaktifkan.');
        await reload();
        return;
      }

      if (e.target.closest('[data-action="bulk-sites"]')) {
        const ids = selectedIds();
        if (!ids.length) return;
        setF('bulk-echo', ids.length);
        siteChips(region('bulk-sites'), []);
        openDrawer('#drawer-bulk-sites');
        return;
      }

      if (e.target.closest('[data-action="apply-bulk-sites"]')) {
        const add = $$('input:checked', region('bulk-sites')).map(i => +i.value);
        if (!add.length) return say('Pilih minimal satu lokasi.');
        const ids = selectedIds();
        let done = 0;
        for (const id of ids) {
          const u = users.find(x => x.id === id);
          if (!u) continue;
          const site_ids = [...new Set(siteIdsOf(u).concat(add))];
          try { await api.updateUser(id, { site_ids }); done++; } catch (err) { say(err.message); }
        }
        closeDrawers();
        say(done + ' akun diperbarui.');
        await reload();
      }
    });

    render();
  };
})();
