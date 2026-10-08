/* pengaturan-aturan.js: Pengaturan, tab Aturan & waktu.
 *
 * The reminder and timing rules (alert_rules), grouped. Ops HQ switches a rule
 * on or off and sets its number; everyone else may look. Ops HQ writes the SOPs:
 * these numbers only decide when the WMS reminds.
 *
 * API: GET /settings/rules   PUT /settings/rules/{key} {enabled, value}
 */
(function () {
  'use strict';
  const S = NJW.shell;
  const { esc, bis, biAttr, t, icon } = S;
  const api = () => NJW.api.raw;

  if (!document.getElementById('pa-css')) {
    const st = document.createElement('style');
    st.id = 'pa-css';
    st.textContent = '.pa-groups{display:grid;gap:16px;align-items:start}@media(min-width:1024px){.pa-groups{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '.pa-rule{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;padding:14px 0;border-top:1px solid var(--rule);align-items:center}' +
      '.pa-rule:first-of-type{border-top:0}.pa-rule__label{font-weight:600}.pa-rule__val{grid-column:2;display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.pa-rule__val .k-input{width:96px;font-family:var(--mono);font-weight:700;text-align:right}.pa-who{font-size:12px;color:var(--muted)}' +
      '.pa-rule.is-off .pa-rule__label{color:var(--muted)}';
    document.head.appendChild(st);
  }

  S.tab('aturan', async function (ctx) {
    S.setSub('Kapan WMS mengingatkan dan menandai. Ops HQ mengubah angkanya.', 'When the WMS reminds and flags. Ops HQ changes the numbers.');
    let d = await api().get('/settings/rules');
    const host = ctx.body;
    function paint() {
      host.innerHTML = (d.can_edit ? '' : '<div class="k-note k-note--info">' + icon('lock', 18) + bis('Hanya Ops HQ yang bisa mengubah aturan.', 'Only Ops HQ can change the rules.') + '</div>') +
        '<p class="k-caption">' + esc(S.pick(d.note)) + '</p><div class="pa-groups">' + d.groups.map((g) => '<div class="k-card k-card--pad"><h2 class="k-h2" ' + biAttr(g.title, g.title_en) + '></h2>' +
          g.rules.map((r) => '<div class="pa-rule' + (r.enabled ? '' : ' is-off') + '" data-key="' + esc(r.key) + '">' +
            '<button type="button" class="k-switch" data-sw aria-checked="' + r.enabled + '" aria-label="' + esc(t(r.label_id, r.label_en)) + '"' +
              (d.can_edit ? '' : ' disabled title="' + esc(t('Hanya Ops HQ', 'Ops HQ only')) + '"') + '></button>' +
            '<span class="pa-rule__label" ' + biAttr(r.label_id, r.label_en) + '></span>' +
            '<div class="pa-rule__val">' + (r.has_value ? '<input class="k-input k-input--sm" type="number" inputmode="numeric" min="' + r.min + '" max="' + r.max + '" value="' + (r.value == null ? '' : r.value) + '" data-val' + (d.can_edit ? '' : ' disabled') + '>' +
              '<span class="k-muted" ' + biAttr(r.unit_id, r.unit_en) + '></span>' : '') +
              (r.updated_by ? '<span class="pa-who">' + esc(t('diubah ', 'changed by ')) + esc(r.updated_by.split('@')[0]) + (r.updated_at ? ' · ' + esc(S.fmt.date(r.updated_at)) : '') + '</span>' : '') +
            '</div></div>').join('') + '</div>').join('') + '</div>';
      S.applyLang(host);
      host.querySelectorAll('[data-key]').forEach((row) => {
        const key = row.dataset.key;
        const val = row.querySelector('[data-val]');
        const sw = S.toggle(row.querySelector('[data-sw]'), (on) => save(key, on, val ? val.value : null));
        if (val) val.addEventListener('change', () => save(key, sw.get(), val.value));
      });
      S.lockAll(host);
    }
    async function save(key, enabled, value) {
      const v = value === '' || value == null ? null : parseInt(value, 10);
      try {
        d = await api().put('/settings/rules/' + encodeURIComponent(key), { enabled, value: v });
        S.toast(['Aturan tersimpan.', 'Rule saved.'], 'ok', 1500);
        paint();
      } catch (e) { S.fail(e); paint(); return false; }
    }
    paint();
  });
})();
