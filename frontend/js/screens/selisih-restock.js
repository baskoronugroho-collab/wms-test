/* screens/selisih-restock.js — replenishment variances (console/selisih-restock.html).
 *
 * Two keys, two roles, so the billed number is one both sides stand behind:
 *   1. variance_review   the hub's SPV gives a final count and a reason for every
 *                        SKU that differs from Wardah's confirmation
 *                        POST /api/replenishments/{id}/acknowledge
 *   2. variance_signoff  Ops HQ signs it off (stock is corrected where the SPV's
 *                        count differs from the scan) or sends it back
 *                        POST /api/replenishments/{id}/sign-off | /send-back
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const t = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const n = v => NJW.fmt.n(v);
  const when = s => s ? NJW.fmt.date(s) + ' ' + NJW.fmt.time(s) : '—';
  const who = e => String(e || '').split('@')[0];
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);

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

  NJW.screens['selisih-restock'] = async () => {
    const me = W.me();
    const isHq = W.atLeast('hq');
    const isSpv = W.atLeast('supervisor');
    let tab = 'variance_review', reps = [], cur = null;

    // HQ sees every hub in one call; an SPV asks per hub they work at.
    async function fetchStatus(status) {
      if (isHq) return (await api.replenishments({ status, limit: 200 })).replenishments;
      const sites = (me.sites || []).filter(s => s.site_type !== 'hub');
      const all = await Promise.all(sites.map(s => api.replenishments({ site_id: s.id, status, limit: 200 })));
      return all.flatMap(r => r.replenishments);
    }

    async function load() {
      try {
        const [open, done] = await Promise.all([
          fetchStatus('variance'),
          tab === 'signed' ? fetchStatus('received') : Promise.resolve([]),
        ]);
        setF('n-variance_review', open.filter(r => r.status === 'variance_review').length);
        setF('n-variance_signoff', open.filter(r => r.status === 'variance_signoff').length);
        reps = tab === 'signed' ? done.filter(r => r.signed_off_at) : open.filter(r => r.status === tab);
      } catch (e) { return fail(e); }
      const host = region('rows');
      host.innerHTML = reps.length ? reps.map(r => {
        const diff = r.lines.filter(l => l.variance).length;
        const last = r.status === 'variance_signoff' ? t('Dicek ', 'Checked by ') + who(r.acknowledged_by) + ' · ' + when(r.acknowledged_at)
          : r.signed_off_at ? t('Ditandatangani ', 'Signed by ') + who(r.signed_off_by) + ' · ' + when(r.signed_off_at)
          : t('Diterima ', 'Received ') + when(r.received_at);
        return '<tr><td class="td-code"><strong>' + esc(r.reference) + '</strong></td>' +
          '<td class="td-code">' + esc(r.site_code) + '</td>' +
          '<td class="td-code">' + esc(r.awb || '—') + (r.surat_jalan_no ? '<br><span style="color:var(--muted)">' + esc(r.surat_jalan_no) + '</span>' : '') + '</td>' +
          '<td class="td-num td-code">' + n(r.total_confirmed) + '</td>' +
          '<td class="td-num td-code">' + n(r.total_received) + '</td>' +
          '<td class="td-num td-code num-warn">' + diff + '</td>' +
          '<td>' + esc(last) + (r.review_note && r.status === 'variance_review' ? '<br><span class="spill spill--warn"><span ' +
            biAttr('Dikembalikan HQ', 'Sent back by HQ') + '></span></span>' : '') + '</td>' +
          '<td class="td-actions"><button class="cbtn cbtn--sm' +
          ((r.status === 'variance_review' && isSpv) || (r.status === 'variance_signoff' && isHq) ? ' cbtn--primary' : '') +
          '" type="button" data-open="' + r.id + '" ' + biAttr('Buka', 'Open') + '></button></td></tr>';
      }).join('')
        : '<tr><td colspan="8"><div class="empty"><span class="empty__title" ' +
          biAttr('Tidak ada selisih di sini', 'No variances here') + '></span></div></td></tr>';
      applyLangTo(host);
    }

    function paint() {
      const r = cur;
      const spvStep = r.status === 'variance_review' && isSpv;
      const hqStep = r.status === 'variance_signoff' && isHq;
      bi(field('v-title'), 'Selisih ' + r.reference, 'Variance ' + r.reference);
      setF('v-site', r.site_code + ' · ' + r.site_name);
      setF('v-awb', (r.awb || '—') + (r.surat_jalan_no ? ' · ' + r.surat_jalan_no : ''));
      setF('v-received', when(r.received_at));
      setF('v-ack', r.acknowledged_at ? who(r.acknowledged_by) + ' · ' + when(r.acknowledged_at) : '—');
      setF('v-signed', r.signed_off_at ? who(r.signed_off_by) + ' · ' + when(r.signed_off_at) : '—');
      region('v-note').hidden = !r.review_note;
      setF('v-note-text', (r.signed_off_at ? t('Catatan HQ: ', 'HQ note: ') : t('Dikembalikan HQ: ', 'Sent back by HQ: ')) + (r.review_note || ''));

      const showAll = field('v-all').checked;
      const lines = r.lines.filter(l => showAll || l.variance || (l.qty_final != null && l.qty_final !== (l.qty_confirmed || 0)));
      region('v-lines').innerHTML = lines.map(l => {
        const confirmed = l.qty_confirmed || 0;
        const final = l.qty_final != null ? l.qty_final : (l.qty_received || 0);
        const diff = final - confirmed;
        return '<tr data-sku="' + l.sku_id + '"><td><strong>' + esc(l.sku_name) + '</strong><br><span class="td-code" style="color:var(--muted)">' + esc(l.brand_sku_code || '') + '</span></td>' +
          '<td class="td-num td-code">' + n(confirmed) + '</td>' +
          '<td class="td-num td-code">' + n(l.qty_received || 0) + '</td>' +
          '<td class="td-num">' + (spvStep
            ? '<input class="input" type="number" min="0" style="width:84px;text-align:right" data-final value="' + final + '">'
            : '<span class="td-code td-strong">' + n(final) + '</span>') + '</td>' +
          '<td class="td-num td-code" data-diff style="' + (diff ? 'color:var(--' + (diff < 0 ? 'stop' : 'caution') + ');font-weight:700' : '') + '">' +
          (diff ? signed(diff) : '0') + '</td>' +
          '<td>' + (spvStep
            ? '<input class="input" type="text" maxlength="255" data-note placeholder="' + esc(t('mis. kardus kurang 1, dicek ulang', 'e.g. carton short by 1, recounted')) + '" value="' + esc(l.final_note || '') + '">'
            : esc(l.final_note || '—')) + '</td></tr>';
      }).join('') || '<tr><td colspan="6" class="note">—</td></tr>';

      bi(field('v-hint'),
        spvStep ? 'Isi jumlah yang benar-benar ada setelah dicek, dan alasan untuk setiap selisih dari angka Wardah. Kalau jumlah final berbeda dari hasil pindai, stok dikoreksi saat Ops HQ menandatangani.'
          : hqStep ? 'Setelah ditandatangani, jumlah final menjadi angka tagihan untuk Ninja dan Wardah, dan stok dikoreksi di baris yang jumlah finalnya berbeda dari hasil pindai.'
          : r.signed_off_at ? 'Angka final di atas adalah angka tagihan.' : 'Menunggu langkah dari role lain.',
        spvStep ? 'Enter the count that is really there after checking, and a reason for every difference from Wardah\'s number. Where the final count differs from the scan, stock is corrected when Ops HQ signs off.'
          : hqStep ? 'Once signed, the final counts are the billed numbers for Ninja and Wardah, and stock is corrected on lines whose final count differs from the scan.'
          : r.signed_off_at ? 'The final counts above are the billed numbers.' : 'Waiting for another role.');
      $('[data-action="acknowledge"]').hidden = !spvStep;
      $('[data-action="sign-off"]').hidden = !hqStep;
      $('[data-action="send-back"]').hidden = !hqStep;
      applyLangTo($('#drawer-var'));
    }

    async function open(id) {
      try { cur = await api.replenishment(id); } catch (e) { return fail(e); }
      field('v-all').checked = false;
      paint();
      openDrawer('#drawer-var');
    }

    document.addEventListener('input', e => {
      const inp = e.target.closest('[data-final]');
      if (!inp || !cur) return;
      const tr = inp.closest('tr');
      const l = cur.lines.find(x => x.sku_id === +tr.dataset.sku);
      const diff = (+inp.value || 0) - (l.qty_confirmed || 0);
      const cell = $('[data-diff]', tr);
      cell.textContent = diff ? signed(diff) : '0';
      cell.style.color = diff ? 'var(--' + (diff < 0 ? 'stop' : 'caution') + ')' : '';
    });

    document.addEventListener('click', async e => {
      const tb = e.target.closest('[data-tab]');
      if (tb && tb.closest('[data-region="tabs"]')) {
        tab = tb.dataset.tab;
        $$('[data-region="tabs"] .tab').forEach(x => x.classList.toggle('is-on', x === tb));
        return load();
      }
      if (e.target.closest('[data-action="refresh"]')) return load();
      const op = e.target.closest('[data-open]');
      if (op) return open(+op.dataset.open);
      if (e.target === field('v-all') && cur) return paint();
      if (!cur) return;

      if (e.target.closest('[data-action="acknowledge"]')) {
        const lines = $$('#drawer-var [data-sku]').map(tr => ({
          sku_id: +tr.dataset.sku,
          qty_final: $('[data-final]', tr) ? +$('[data-final]', tr).value : null,
          note: $('[data-note]', tr) ? $('[data-note]', tr).value.trim() : null,
        }));
        const missing = lines.find(l => {
          const src = cur.lines.find(x => x.sku_id === l.sku_id);
          return l.qty_final !== (src.qty_confirmed || 0) && !l.note;
        });
        if (missing) return say(t('Tulis alasan untuk setiap SKU yang berbeda dari angka Wardah.', 'Give a reason for every SKU that differs from Wardah\'s number.'));
        try {
          cur = await api.acknowledgeVariance(cur.id, lines);
          say(cur.reference + t(' dikirim ke Ops HQ.', ' sent to Ops HQ.'));
          closeDrawers();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="sign-off"]')) {
        const corrections = cur.lines.filter(l => l.qty_final != null && l.qty_final !== (l.qty_received || 0));
        const msg = t('Tanda tangani ' + cur.reference + '? Jumlah final jadi angka tagihan', 'Sign off ' + cur.reference + '? The final counts become the billed numbers') +
          (corrections.length ? t(', dan stok ' + corrections.length + ' SKU dikoreksi.', ', and stock is corrected for ' + corrections.length + ' SKU(s).') : '.');
        if (!confirm(msg)) return;
        try {
          cur = await api.signOffVariance(cur.id, null);
          say(cur.reference + t(' ditandatangani.', ' signed off.'));
          closeDrawers();
          load();
        } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('[data-action="send-back"]')) {
        const note = prompt(t('Kenapa dikembalikan ke SPV?', 'Why is this going back to the SPV?'));
        if (!note || !note.trim()) return;
        try {
          cur = await api.sendBackVariance(cur.id, note.trim());
          closeDrawers();
          load();
        } catch (err) { fail(err); }
      }
    });

    await load();
  };
})();
