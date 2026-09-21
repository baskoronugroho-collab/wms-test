/* count-list — screen 10: choose a basket to count.
 *
 * Several people count the same plan at once, so this list is a live view of
 * who holds what. The claim itself is the server's UNIQUE(plan, basket) index:
 * two staff racing for one basket, exactly one wins, and the loser is told.
 * The expected quantity never appears here — not even for finished baskets —
 * because a number seen on this list is a number someone will "confirm" on
 * the next basket instead of counting it.
 *
 * Replaces the wire.js count-list handler (written for the pre-v3 markup; it
 * also created a plan on the fly, which the API only lets a supervisor do).
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, bi, biAttr, esc, applyLangTo, say, fail, go, CTX } = W;
  const tx = (id, en) => (localStorage.getItem('njw.lang') === 'en' ? en : id);
  const who = email => String(email || '').split('@')[0] || '—';

  /* Which plan: an explicit ?plan= from the console first, then the one this
     device was already counting, then the newest open plan at this site. A
     remembered id can be stale (another site, or a training reset wiped it),
     so every candidate is re-checked rather than trusted. */
  async function findPlan(site) {
    const wanted = [+new URLSearchParams(location.search).get('plan') || null, CTX.get('plan')];
    for (const id of wanted.filter(Boolean)) {
      try {
        const d = await NJW.api.raw.get('/opname/plans/' + id);
        if (d.plan.site_id === site.id && d.plan.status !== 'closed') return d;
      } catch (e) { if (e.status === 401) throw e; }
    }
    const list = await NJW.api.opnamePlans({ site_id: site.id, limit: 20 });
    const open = list.plans.find(p => p.status !== 'closed');
    return open ? NJW.api.raw.get('/opname/plans/' + open.id) : null;
  }

  function state(b, meEmail) {
    if (b.status === 'finished') return 'done';
    if (b.status === 'counting') return b.claimed_by === meEmail ? 'mine' : 'busy';
    return 'todo';
  }

  // The mockup's own row vocabulary, one variant per state.
  function rowHtml(b, st, isNext) {
    const code = '<span class="row__code code code--md">' + esc(b.location_code) + '</span>' +
      '<span class="row__name">' + esc(b.sku_name || '—') + '</span>';
    if (st === 'done') {
      const t = 'Sudah dihitung · ' + who(b.claimed_by), e = 'Counted · ' + who(b.claimed_by);
      return '<div class="row row--done">' + code +
        '<span class="row__state"><span class="pill"><span class="pill__mark">✓</span></span>' +
        '<span ' + biAttr(t, e) + '>' + esc(t) + '</span></span>' +
        '<span class="btn is-locked" aria-disabled="true" ' + biAttr('Selesai', 'Done') + '>Selesai</span></div>';
    }
    if (st === 'busy') {
      const t = 'Sedang dihitung: ' + who(b.claimed_by), e = 'Being counted: ' + who(b.claimed_by);
      return '<div class="row row--claimed">' + code +
        '<span class="row__state"><span class="code code--sm">!</span>' +
        '<span ' + biAttr(t, e) + '>' + esc(t) + '</span></span>' +
        '<span class="btn is-locked" aria-disabled="true" ' + biAttr('Terkunci', 'Locked') + '>Terkunci</span></div>';
    }
    if (st === 'mine') {
      return '<div class="row row--next">' + code +
        '<span class="eyebrow eyebrow--action" ' + biAttr('Kamu sedang menghitung', 'You are counting this') +
        '>Kamu sedang menghitung</span>' +
        '<button class="btn btn--primary" type="button" data-b="' + b.basket_id + '" ' +
        biAttr('Lanjutkan', 'Continue') + '>Lanjutkan</button></div>';
    }
    return '<div class="row' + (isNext ? ' row--next' : '') + '">' + code +
      (isNext ? '<span class="eyebrow eyebrow--action" ' + biAttr('Berikutnya', 'Next') + '>Berikutnya</span>' : '') +
      '<button class="btn ' + (isNext ? 'btn--primary' : 'btn--outline') + '" type="button" data-b="' +
      b.basket_id + '" ' + (isNext ? biAttr('Mulai hitung', 'Start counting') + '>Mulai hitung'
                                   : biAttr('Hitung', 'Count') + '>Hitung') + '</button></div>';
  }

  function emptyHtml(title, titleEn, body, bodyEn, withCreate) {
    return '<div class="notice notice--action"><div class="col" style="gap:6px">' +
      '<span class="notice__title" ' + biAttr(title, titleEn) + '>' + esc(title) + '</span>' +
      '<span class="notice__body" ' + biAttr(body, bodyEn) + '>' + esc(body) + '</span>' +
      (withCreate ? '<button class="btn btn--primary" type="button" data-action="create-plan" ' +
        'style="align-self:flex-start;margin-top:8px" ' + biAttr('Buat rencana hitung', 'Create a count plan') +
        '>Buat rencana hitung</button>' : '') +
      '</div></div>';
  }

  NJW.screens['count-list'] = async () => {
    const site = W.site(), me = W.me();
    const list = $('.list');
    const count = $('.progress__count');
    const mode = $('.chrome__mode');
    const isSup = W.atLeast('supervisor');
    let planId = null;

    async function load() {
      const d = await findPlan(site);
      if (!d) {
        CTX.del('plan');
        if (count) count.textContent = '';
        if (mode) { mode.dataset.keep = '1'; bi(mode, 'Hitung stok', 'Stock count'); }
        list.innerHTML = emptyHtml('Belum ada jadwal hitung', 'No count scheduled',
          isSup ? 'Buat rencana hitung dulu. Semua keranjang berisi barang ikut dihitung.'
                : 'Minta supervisor membuat rencana hitung di konsol.',
          isSup ? 'Create a count plan first. Every basket that holds stock is included.'
                : 'Ask a supervisor to create a count plan in the console.', isSup);
        applyLangTo(list);
        return;
      }
      planId = d.plan.id;
      CTX.set('plan', planId);
      if (mode) {
        // Plan names are typed by a supervisor in one language; show as-is.
        mode.dataset.keep = '1';
        bi(mode, d.plan.name || 'Hitung stok #' + planId, d.plan.name || 'Stock count #' + planId);
      }
      if (count) count.innerHTML = d.plan.counted + ' / ' + d.plan.total_baskets +
        ' <span class="note" ' + biAttr('keranjang selesai', 'baskets done') + '>keranjang selesai</span>';

      if (!d.baskets.length) {
        list.innerHTML = emptyHtml('Tidak ada keranjang untuk dihitung',
          'No baskets to count', 'Rencana ini tidak mencakup keranjang yang berisi barang.',
          'This plan covers no basket that holds stock.', false);
        applyLangTo(list);
        return;
      }
      // Your own unfinished basket comes first in attention; otherwise the
      // first free basket in walking order is "next".
      const states = d.baskets.map(b => state(b, me.email));
      const hasMine = states.includes('mine');
      const nextIdx = hasMine ? -1 : states.indexOf('todo');
      list.innerHTML = d.baskets.map((b, i) => rowHtml(b, states[i], i === nextIdx)).join('');
      applyLangTo(list);
    }

    list.addEventListener('click', async (e) => {
      const create = e.target.closest('[data-action="create-plan"]');
      if (create) {
        create.disabled = true;
        try {
          const p = await NJW.api.raw.post('/opname/plans', {
            site_id: site.id, name: 'Hitung stok ' + NJW.fmt.date(new Date().toISOString()),
          });
          CTX.set('plan', p.id);
          await load();
        } catch (err) { create.disabled = false; fail(err); }
        return;
      }
      const btn = e.target.closest('[data-b]');
      if (!btn || !planId) return;
      btn.disabled = true;
      try {
        const s = await NJW.api.raw.post('/opname/sessions', { plan_id: planId, basket_id: +btn.dataset.b });
        CTX.set('session', s);
        go('11-hitung-menghitung.html');
      } catch (err) {
        if (err.status === 401) return fail(err);
        // Lost the race, or it was finished meanwhile: say so, then show the truth.
        say(err.status === 409
          ? tx('Keranjang ini sudah diambil orang lain. Daftar diperbarui.',
               'Someone else has this basket. The list is refreshed.')
          : err.message);
        load().catch(fail);
      }
    });

    try { await load(); } catch (e) { return fail(e); }
    // Other counters claim baskets while this list is open; keep it honest.
    setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 15000);
  };
})();
