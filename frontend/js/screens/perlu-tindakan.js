/* screens/perlu-tindakan.js — what this person must settle (console/perlu-tindakan.html).
 *
 *   GET /api/todo?site_id=   rows for the caller's role, most urgent first (PRD §13.5)
 *
 * The server decides what belongs to which role, so a superadmin viewing as an
 * SPV sees exactly the SPV's list. Rows past their time come back with
 * overdue=true; they also show on the next role's list, which is the server's
 * business too. The page refreshes itself every minute.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { field, region, setF, esc, biAttr, applyLangTo, fail } = W;
  const r = NJW.api.raw;
  const en = () => localStorage.getItem('njw.lang') === 'en';

  const ROLE = {
    staff: ['Staf', 'Staff'], hub_operator: ['Operator hub', 'Hub operator'],
    supervisor: ['SPV', 'SPV'], hq: ['Ops HQ', 'Ops HQ'], ops_head: ['Ops Head', 'Ops Head'],
    superadmin: ['Superadmin', 'Superadmin'],
  };

  function due(row) {
    if (!row.due_at) return '<span style="color:var(--muted)">-</span>';
    const t = NJW.toDate(row.due_at);
    const mins = Math.round((t - Date.now()) / 60000);
    let id, enTxt;
    if (mins >= 0) {
      id = mins < 60 ? mins + ' mnt lagi' : Math.round(mins / 60) + ' jam lagi';
      enTxt = mins < 60 ? 'in ' + mins + ' min' : 'in ' + Math.round(mins / 60) + ' h';
    } else {
      const m = -mins;
      id = m < 60 ? 'lewat ' + m + ' mnt' : 'lewat ' + Math.round(m / 60) + ' jam';
      enTxt = m < 60 ? m + ' min over' : Math.round(m / 60) + ' h over';
    }
    return '<span ' + biAttr(id, enTxt) + '></span>';
  }

  NJW.screens['perlu-tindakan'] = async () => {
    const me = W.me();
    const sites = (me.sites || []).filter(s => s.site_type !== 'hub');
    field('site-filter').insertAdjacentHTML('beforeend', sites.map(s =>
      '<option value="' + s.id + '">' + esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join(''));
    const role = ROLE[me.role] || [me.role, me.role];
    field('k-role').setAttribute('data-id', role[0]);
    field('k-role').setAttribute('data-en', role[1]);
    field('k-role').textContent = en() ? role[1] : role[0];

    async function load() {
      let res;
      try { res = await r.get('/todo' + r.qs({ site_id: field('site-filter').value || null })); }
      catch (e) { return fail(e); }
      setF('k-total', String(res.counts.total));
      setF('k-late', String(res.counts.overdue));
      region('k-late-card').classList.toggle('kpi-card--caution', res.counts.overdue > 0);
      setF('k-updated', NJW.fmt.time(new Date().toISOString()));
      const badge = field('todo-badge');
      if (badge) { badge.hidden = !res.counts.total; badge.textContent = res.counts.total > 99 ? '99+' : String(res.counts.total); }
      try { sessionStorage.setItem('njw.todoCount', JSON.stringify({ at: Date.now(), counts: res.counts })); } catch (e) {}
      const host = region('todo-rows');
      host.innerHTML = res.items.length ? res.items.map(x =>
        '<tr' + (x.overdue ? ' class="is-caution"' : '') + '>' +
        '<td><span class="spill spill--' + (x.overdue ? 'warn' : 'info') + '"><span class="spill__dot"></span><span ' +
        (x.overdue ? biAttr('Lewat waktu', 'Past time') : biAttr('Menunggu', 'Waiting')) + '></span></span></td>' +
        '<td class="td-code">' + esc(x.site_code || '-') + '</td>' +
        '<td class="td-strong" ' + biAttr(x.title_id, x.title_en) + '></td>' +
        '<td style="color:var(--muted)" ' + biAttr(x.detail_id || '', x.detail_en || '') + '></td>' +
        '<td>' + due(x) + '</td>' +
        '<td class="td-actions">' + (x.link
          ? '<a class="cbtn cbtn--sm" href="' + esc(x.link) + '" ' + biAttr('Buka', 'Open') + '></a>' : '') + '</td></tr>'
      ).join('')
        : '<tr><td colspan="6"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada yang perlu diselesaikan', 'Nothing to settle') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    field('site-filter').addEventListener('change', load);
    document.querySelector('[data-action="refresh"]').addEventListener('click', load);
    await load();
    setInterval(load, 60000);
  };
})();
