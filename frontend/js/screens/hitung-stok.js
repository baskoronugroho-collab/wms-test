/* hitung-stok — console: count plans, and the supervisor's sign-off.
 *
 * Counting never moves stock by itself. A variance, any variance, sits in the
 * table below until a supervisor approves it; only then does the ledger take
 * the adjustment (POST /opname/adjustments/approve).
 *
 * The approve call needs opname SESSION ids, and the variance report does not
 * return them yet (it returns basket ids). Until it does, approval is shown
 * but disabled with the reason stated, rather than guessing an id: approving
 * the wrong session writes the wrong stock. The code reads `session_id`, and
 * `approved_at`, the moment the report carries them.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, bi, biAttr, esc, applyLangTo, say, fail } = W;
  const tx = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const STALE_MS = 30 * 864e5;
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/>' +
    '<path d="M20 4l-8.5 8.5"/><path d="M18 14v6H4V6h6"/></svg>';

  const who = email => String(email || '').split('@')[0] || '—';
  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);

  NJW.screens['hitung-stok'] = async () => {
    const site = W.site(), me = W.me();
    const canSign = W.atLeast('supervisor');
    let pending = [];          // variance rows awaiting signature
    let toApprove = [];        // session ids staged in the confirm dialog

    const newBtn = $('[data-action="new-plan"]');
    if (newBtn) newBtn.hidden = !canSign;

    async function load() {
      const [plans, inv] = await Promise.all([
        NJW.api.opnamePlans({ site_id: site.id, limit: 20 }),
        NJW.api.inventory({ site_id: site.id, limit: 1000 }).catch(() => null),
      ]);
      const list = plans.plans;
      const current = list.find(p => p.status !== 'closed') || list[0] || null;

      const reps = await Promise.all(list.filter(p => p.status !== 'closed' && p.variances > 0)
        .map(p => NJW.api.raw.get('/opname/plans/' + p.id + '/variance-report')
          .then(r => r.rows.map(x => Object.assign({ plan_name: p.name }, x)))));
      pending = reps.flat().filter(r => !r.approved_at && r.status !== 'approved');

      paintKpis(current, inv);
      paintVariances();
      paintPlans(list);
    }

    function paintKpis(current, inv) {
      if (current) {
        setF('kpi-counted', current.counted + ' / ' + current.total_baskets);
        bi(field('kpi-counted-foot'), current.name || '#' + current.id, current.name || '#' + current.id);
      } else {
        setF('kpi-counted', '—');
        bi(field('kpi-counted-foot'), 'belum ada rencana', 'no plan yet');
      }
      setF('kpi-variances', pending.length);
      setF('kpi-value', NJW.fmt.idr(pending.reduce((n, r) => n + (r.value_idr || 0), 0)));
      // The server sums absolute values: a +2 and a −2 do not cancel out.
      bi(field('kpi-value-foot'), 'total mutlak, ' + pending.length + ' baris',
                                  'absolute total, ' + pending.length + ' lines');
      if (inv) {
        const last = new Map();
        inv.rows.forEach(r => { if (!last.has(r.sku_id) || r.last_counted_at) last.set(r.sku_id, r.last_counted_at); });
        const stale = Array.from(last.values()).filter(t =>
          !t || Date.now() - NJW.toDate(t).getTime() > STALE_MS).length;
        setF('kpi-stale', stale);
      }
    }

    function paintVariances() {
      const host = region('variance');
      const ids = pending.every(r => r.session_id);
      const note = field('sign-note');
      if (note) {
        let t = null;
        if (pending.length && !canSign) {
          t = ['Hanya supervisor yang bisa menandatangani penyesuaian.',
               'Only a supervisor can sign off adjustments.'];
        } else if (pending.length && !ids) {
          t = ['Tanda tangan belum bisa dilakukan dari layar ini: server belum mengirim nomor sesi hitung. Selisih tetap tercatat, dan stok tidak berubah.',
               'Sign-off is not possible from this screen yet: the server does not send the count session number. The variances stay recorded, and stock does not change.'];
        }
        note.hidden = !t;
        if (t) bi(field('sign-note-text'), t[0], t[1]);
      }
      if (!pending.length) {
        host.innerHTML = '<tr><td colspan="9" class="note" ' +
          biAttr('Tidak ada selisih yang menunggu tanda tangan.', 'No variance is waiting for sign-off.') +
          '></td></tr>';
        applyLangTo(host);
        syncBulk();
        return;
      }
      const off = r => !canSign || !r.session_id;
      host.innerHTML = pending.map(r =>
        '<tr' + (r.session_id ? ' data-session="' + r.session_id + '"' : '') + '>' +
        '<td class="td-check"><input class="checkbox" type="checkbox" aria-label="Pilih ' +
          esc(r.location_code) + '"' + (off(r) ? ' disabled' : '') + '></td>' +
        '<td class="td-code td-strong">' + esc(r.location_code) + '</td>' +
        '<td>' + esc(r.sku_name || '—') + '</td>' +
        '<td class="td-num" style="color:var(--muted)">' + r.qty_expected + '</td>' +
        '<td class="td-num">' + r.qty_counted + '</td>' +
        '<td class="td-num" style="color:var(--caution);font-weight:700" data-sort-value="' + r.variance + '">' +
          signed(r.variance) + '</td>' +
        '<td class="td-num" data-sort-value="' + (r.value_idr || 0) + '">' + NJW.fmt.idr(r.value_idr) + '</td>' +
        '<td style="color:var(--muted)">' + esc(who(r.counted_by)) + '</td>' +
        '<td class="td-actions"><button class="cbtn cbtn--sm cbtn--ghost" type="button" data-recount="' +
          (r.session_id || '') + '"' + (off(r) ? ' disabled' : '') + ' ' +
          biAttr('Hitung ulang', 'Recount') + '>Hitung ulang</button> ' +
          '<button class="cbtn cbtn--sm cbtn--primary" type="button" data-approve="' +
          (r.session_id || '') + '"' + (off(r) ? ' disabled' : '') + ' ' +
          biAttr('Setujui', 'Approve') + '>Setujui</button></td></tr>').join('');
      applyLangTo(host);
      syncBulk();
    }

    // console.js counts ticks on change events only; a re-render resets them.
    function syncBulk() {
      const bar = $('.bulkbar[data-bulk-table="#tbl-variance"]');
      if (!bar) return;
      bar.classList.remove('is-on');
      setF('bulk-count', 0);
    }

    function paintPlans(list) {
      const host = region('plans');
      if (!list.length) {
        host.innerHTML = '<tr><td colspan="8" class="note" ' +
          biAttr(canSign ? 'Belum ada rencana. Buat satu dengan tombol di atas.' : 'Belum ada rencana hitung.',
                 canSign ? 'No plans yet. Create one with the button above.' : 'No count plans yet.') + '></td></tr>';
        applyLangTo(host);
        return;
      }
      host.innerHTML = list.map(p => {
        const closed = p.status === 'closed';
        const allDone = !closed && p.total_baskets > 0 && p.counted >= p.total_baskets;
        const st = closed ? ['ok', 'Ditutup', 'Closed']
          : allDone ? ['info', 'Semua dihitung', 'All counted'] : ['accent', 'Berjalan', 'Running'];
        // created_at / scope are not in the plan payload yet; shown when they are.
        const scope = p.scope && p.scope.rack_codes && p.scope.rack_codes.length
          ? ['Rak ' + p.scope.rack_codes.join(', '), 'Racks ' + p.scope.rack_codes.join(', ')]
          : p.scope ? ['Semua rak', 'All racks'] : ['—', '—'];
        return '<tr><td class="td-strong">' + esc(p.name || '#' + p.id) + '</td>' +
          '<td style="color:var(--muted)">' + (p.created_at ? NJW.fmt.date(p.created_at) : '—') + '</td>' +
          '<td ' + biAttr(scope[0], scope[1]) + '></td>' +
          '<td class="td-num">' + p.total_baskets + '</td>' +
          '<td class="td-num">' + p.counted + '</td>' +
          '<td class="td-num">' + (p.variances || '—') + '</td>' +
          '<td><span class="spill spill--' + st[0] + '"><span class="spill__dot"></span><span ' +
            biAttr(st[1], st[2]) + '></span></span></td>' +
          '<td class="td-actions">' + (closed ? '' :
            '<a class="cbtn cbtn--sm" href="../10-hitung-pilih-keranjang.html?plan=' + p.id + '">' +
            OPEN_ICON + '<span ' + biAttr('Buka', 'Open') + '></span></a>') + '</td></tr>';
      }).join('');
      applyLangTo(host);
    }

    /* ---- approval ---- */

    const dlg = $('#dlg-approve'), scrim = $('.scrim');
    function openApprove(ids) {
      toApprove = ids;
      const rows = pending.filter(r => ids.includes(r.session_id));
      const units = rows.reduce((n, r) => n + Math.abs(r.variance), 0);
      const value = rows.reduce((n, r) => n + (r.value_idr || 0), 0);
      bi(field('approve-title'),
        rows.length === 1 ? 'Setujui penyesuaian ' + rows[0].location_code + '?' : 'Setujui ' + rows.length + ' penyesuaian?',
        rows.length === 1 ? 'Approve the adjustment at ' + rows[0].location_code + '?' : 'Approve ' + rows.length + ' adjustments?');
      bi(field('approve-body'),
        'Stok di sistem akan diubah sesuai hitungan: ' + units + ' unit, senilai ' + NJW.fmt.idr(value) +
        '. Perubahan ini tercatat atas nama kamu.',
        'System stock will be changed to match the count: ' + units + ' units, worth ' + NJW.fmt.idr(value) +
        '. The change is recorded under your name.');
      dlg.classList.add('is-open');
      if (scrim) scrim.classList.add('is-open');
    }
    function closeDialogs() {
      $$('.drawer.is-open, .cdialog.is-open').forEach(d => d.classList.remove('is-open'));
      if (scrim) scrim.classList.remove('is-open');
    }

    document.addEventListener('click', async (e) => {
      // Send a count back before signing it: the basket returns to the plan as
      // pending and the next counter starts blind.
      const again = e.target.closest('[data-recount]');
      if (again && again.dataset.recount) {
        again.disabled = true;
        try {
          await NJW.api.raw.post('/opname/sessions/' + again.dataset.recount + '/recount', {});
          say(tx('Dikembalikan untuk dihitung ulang.', 'Sent back for a recount.'));
          await load();
        } catch (err) { fail(err); again.disabled = false; }
        return;
      }
      const one = e.target.closest('[data-approve]');
      if (one && !one.disabled && one.dataset.approve) return openApprove([+one.dataset.approve]);

      if (e.target.closest('[data-action="approve-selected"]')) {
        const ids = $$('#tbl-variance tbody tr[data-session]')
          .filter(tr => { const c = $('.checkbox', tr); return c && c.checked && !c.disabled; })
          .map(tr => +tr.dataset.session);
        if (!ids.length) {
          return say(canSign
            ? tx('Pilih selisih yang bisa disetujui dulu.', 'Select variances that can be approved first.')
            : tx('Hanya supervisor yang bisa menandatangani.', 'Only a supervisor can sign off.'));
        }
        return openApprove(ids);
      }

      const go = e.target.closest('[data-action="confirm-approve"]');
      if (go) {
        if (!toApprove.length) return;
        go.disabled = true;
        try {
          await NJW.api.raw.post('/opname/adjustments/approve',
            { session_ids: toApprove, reason_code: 'count_correction' });
          closeDialogs();
          say(tx(toApprove.length + ' penyesuaian disetujui. Stok sudah diubah.',
                 toApprove.length + ' adjustment(s) approved. Stock has been changed.'));
          toApprove = [];
          await load();
        } catch (err) { fail(err); } finally { go.disabled = false; }
        return;
      }

      const create = e.target.closest('[data-action="create-plan"]');
      if (create) {
        const name = (field('plan-name').value || '').trim();
        const all = field('plan-all').checked;
        const racks = $$('[data-region="plan-racks"] input:checked').map(i => i.value);
        if (!all && !racks.length) return say(tx('Pilih minimal satu rak.', 'Choose at least one rack.'));
        create.disabled = true;
        try {
          await NJW.api.raw.post('/opname/plans', Object.assign(
            { site_id: site.id, name: name || null }, all ? {} : { rack_codes: racks }));
          closeDialogs();
          say(tx('Rencana dibuat. Petugas bisa mulai menghitung di aplikasi station.',
                 'Plan created. Staff can start counting in the station app.'));
          await load();
        } catch (err) { fail(err); } finally { create.disabled = false; }
      }
    });

    /* ---- new-plan drawer: racks come from the site's real layout ---- */
    if (newBtn && canSign) {
      newBtn.addEventListener('click', async () => {
        const nameIn = field('plan-name');
        if (nameIn && !nameIn.value) nameIn.value = 'Hitung stok ' + NJW.fmt.date(new Date().toISOString());
        const box = region('plan-racks');
        if (!box || box.dataset.loaded) return;
        try {
          const m = await NJW.api.rackMap(site.id);
          box.innerHTML = m.racks.map(r =>
            '<label class="chipbox"><input type="checkbox" value="' + esc(r.code) + '"><span ' +
            biAttr('Rak ' + r.code, 'Rack ' + r.code) + '></span></label>').join('');
          applyLangTo(box);
          box.dataset.loaded = '1';
        } catch (err) { fail(err); }
      });
      const all = field('plan-all');
      const box = region('plan-racks');
      // Ticking a rack means "not all"; ticking "all" clears the racks.
      if (all && box) {
        all.addEventListener('change', () => { if (all.checked) $$('input', box).forEach(i => { i.checked = false; }); });
        box.addEventListener('change', () => { if ($$('input:checked', box).length) all.checked = false; });
      }
    }

    try { await load(); } catch (e) { fail(e); }
  };
})();
