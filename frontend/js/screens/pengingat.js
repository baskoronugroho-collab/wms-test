/* screens/pengingat.js — reminders and flags (console/pengingat.html).
 *
 *   GET /api/reminders/flags         what needs a person now (drafts first)
 *   GET /api/reminders/rules         the rules and their numbers
 *   PUT /api/reminders/rules/{key}   Ops HQ switches a rule or changes its number
 *
 * Reading the flags also runs the automatic replenishment draft, so opening this
 * page is always up to date with the drafts that exist.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const en = () => localStorage.getItem('njw.lang') === 'en';
  const n = v => NJW.fmt.n(v);
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '—';

  const SEV = {
    critical: ['stop', 'Kritis', 'Critical'],
    warn: ['warn', 'Perlu tindakan', 'Needs action'],
    info: ['info', 'Info', 'Info'],
  };
  const ACTION = {
    'restock-brand.html': ['Buka restock', 'Open restock'],
    'selisih-restock.html': ['Buka selisih', 'Open variance'],
    'permintaan-sku.html': ['Jawab', 'Answer'],
    'rak.html#needs': ['Tempatkan', 'Place'],
    'peta-hub.html': ['Lihat peta', 'See map'],
  };

  NJW.screens.pengingat = async () => {
    const me = W.me();
    const canEdit = W.atLeast('hq');
    let tab = 'flags';

    const sites = (me.sites || []).filter(s => s.site_type !== 'hub');
    field('site-filter').insertAdjacentHTML('beforeend', sites.map(s =>
      '<option value="' + s.id + '">' + esc(s.code) + (s.is_training ? ' · LATIHAN' : '') + '</option>').join(''));

    async function loadFlags() {
      let r;
      try { r = await api.flags({ site_id: field('site-filter').value || null }); } catch (e) { return fail(e); }
      setF('k-crit', n(r.counts.critical));
      setF('k-warn', n(r.counts.warn));
      setF('k-info', n(r.counts.info));
      setF('n-flags', r.counts.critical + r.counts.warn);
      region('k-crit-card').classList.toggle('kpi-card--stop', r.counts.critical > 0);
      region('k-warn-card').classList.toggle('kpi-card--caution', r.counts.warn > 0);
      const host = region('flag-rows');
      host.innerHTML = r.flags.length ? r.flags.map(f => {
        const sev = SEV[f.severity];
        const act = ACTION[f.link] || ['Buka', 'Open'];
        return '<tr><td><span class="spill spill--' + sev[0] + '"><span class="spill__dot"></span><span ' +
          biAttr(sev[1], sev[2]) + '></span></span></td>' +
          '<td class="td-code">' + esc(f.site_code) + '</td>' +
          '<td class="td-strong" ' + biAttr(f.title_id, f.title_en) + '></td>' +
          '<td style="color:var(--muted)" ' + biAttr(f.detail_id, f.detail_en) + '></td>' +
          '<td class="td-actions"><a class="cbtn cbtn--sm" href="' + esc(f.link) + '" data-site="' + f.site_id + '" ' +
          biAttr(act[0], act[1]) + '></a></td></tr>';
      }).join('')
        : '<tr><td colspan="5"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada yang perlu diperhatikan', 'Nothing needs attention') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    async function loadRules() {
      let r;
      try { r = await api.reminderRules(); } catch (e) { return fail(e); }
      const host = region('rule-rows');
      host.innerHTML = r.rules.map(x =>
        '<tr data-rule="' + x.key + '">' +
        '<td><label class="chipbox"><input type="checkbox" data-on' + (x.enabled ? ' checked' : '') +
        (canEdit ? '' : ' disabled') + '><span ' + biAttr(x.enabled ? 'Aktif' : 'Mati', x.enabled ? 'On' : 'Off') + '></span></label></td>' +
        '<td ' + biAttr(x.label_id, x.label_en) + '></td>' +
        '<td>' + (x.unit_id
          ? '<span style="display:inline-flex;gap:6px;align-items:center"><input class="input" type="number" min="1" max="365" ' +
            'style="width:84px;text-align:right" data-val value="' + (x.value ?? '') + '"' + (canEdit ? '' : ' disabled') +
            '><span ' + biAttr(x.unit_id, x.unit_en) + '></span></span>'
          : '—') + '</td>' +
        '<td class="td-code" style="color:var(--muted)">' + (x.updated_by ? esc(x.updated_by.split('@')[0]) + ' · ' + when(x.updated_at) : '—') + '</td>' +
        '<td class="td-actions">' + (canEdit ? '<button class="cbtn cbtn--sm" type="button" data-save ' + biAttr('Simpan', 'Save') + '></button>' : '') +
        '</td></tr>').join('');
      applyLangTo(host);
    }

    function load() {
      region('panel-flags').hidden = tab !== 'flags';
      region('panel-rules').hidden = tab !== 'rules';
      return tab === 'flags' ? loadFlags() : loadRules();
    }

    document.addEventListener('click', async e => {
      const tb = e.target.closest('[data-tab]');
      if (tb && tb.closest('[data-region="tabs"]')) {
        tab = tb.dataset.tab;
        $$('[data-region="tabs"] .tab').forEach(x => x.classList.toggle('is-on', x === tb));
        return load();
      }
      if (e.target.closest('[data-action="refresh"]')) return load();
      // Links open on the flag's own hub.
      const a = e.target.closest('a[data-site]');
      if (a) W.CTX.set('site', +a.dataset.site);
      const sv = e.target.closest('[data-save]');
      if (sv) {
        const tr = sv.closest('tr');
        const inp = $('[data-val]', tr);
        try {
          await api.setReminderRule(tr.dataset.rule, {
            enabled: $('[data-on]', tr).checked,
            value: inp && inp.value !== '' ? +inp.value : null,
          });
          say(en() ? 'Saved.' : 'Tersimpan.');
          loadRules();
        } catch (err) { fail(err); }
      }
    });
    field('site-filter').addEventListener('change', () => { if (tab === 'flags') loadFlags(); });

    await load();
  };
})();
