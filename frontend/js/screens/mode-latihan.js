/* screens/mode-latihan.js — training scenarios, reset, activity
 * (console/mode-latihan.html).
 *
 * GET /api/training/scenarios, POST /api/training/load and /reset,
 * GET /api/training/activity. Every one of these is refused by the server on a
 * live site (auth.assert_training_site); the gate makes sure nobody gets as
 * far as the refusal, and offers the way to the training site instead.
 *
 * A loaded scenario prints what it created — the empty basket, the swapped
 * shades, the seeded variances — because a trainer who does not know the right
 * answer cannot tell a trainee they got it wrong.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { field, region, esc, bi, biAttr, applyLangTo, say, fail, CTX } = W;
  const api = NJW.api;

  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

  // The API's `teaches` line is English only; staff read Indonesian first.
  const TEACHES_ID = {
    clean: 'Jalur normal. Panduan hari pertama.',
    variance: 'Hitung stok dan melihat selisihnya.',
    short_pick: 'Keranjang kosong saat ambil — kegagalan nyata yang paling mahal.',
    wrong_shade: 'Gerbang scan saat ambil, dan kenapa gerbang itu ada.',
    unknown_barcode: 'Mendaftarkan barcode baru saat barang masuk.',
    no_slot: 'Membuat keranjang baru di tengah barang masuk.',
    mode_b: 'Label unit: tempel, ikat, ambil dan hitung per label.',
    contention: 'Klaim dan rebutan: dua orang di satu station.',
  };
  const KEY_LABEL = {
    seeded_variances: ['Selisih yang ditanam', 'Seeded variances'],
    empty_basket: ['Keranjang kosong', 'Empty basket'],
    swap: ['Barang tertukar', 'Swapped item'],
    unslotted_sku: ['SKU tanpa keranjang', 'SKU with no basket'],
    unknown_barcode: ['Barcode tak dikenal', 'Unknown barcode'],
    skus: ['SKU label unit', 'Unit-label SKUs'],
    unbound_plates: ['Label belum dipakai', 'Unused plates'],
    orders: ['Pesanan uji', 'Test orders'],
    baskets_restocked: ['Keranjang diisi ulang', 'Baskets refilled'],
    qty_each: ['Unit per keranjang', 'Units each'],
    note: ['Catatan', 'Note'],
  };

  function valueText(v) {
    if (v == null) return '—';
    if (Array.isArray(v)) return v.map(valueText).join('\n');
    if (typeof v === 'object') return Object.values(v).map(x => valueText(x)).join(' · ');
    return String(v);
  }

  NJW.screens['mode-latihan'] = async () => {
    const site = W.site(), me = W.me();
    if (!site) return;
    const trn = (me.sites || []).find(s => s.is_training);

    /* ---- the gate ---- */
    NJW.setTrainingGate(!!site.is_training, site.code);
    if (!site.is_training) {
      bi(field('gate-body'),
        'Lokasi aktif sekarang adalah ' + site.code + ', station live. Reset dan skenario hanya berjalan di lokasi latihan — API menolaknya di station live. Ganti ke lokasi latihan dulu.',
        'The active site is ' + site.code + ', a live station. Reset and scenarios only run at a training site — the API refuses them at a live station. Switch to a training site first.');
      const sw = field('switch-label');
      if (trn) {
        bi(sw, 'Ganti ke ' + trn.code + ' — lokasi latihan', 'Switch to ' + trn.code + ' — training site');
        sw.onclick = () => { CTX.set('site', trn.id); location.reload(); };
      } else {
        bi(sw, 'Anda belum punya akses ke lokasi latihan', 'You have no access to a training site');
        sw.disabled = true;
      }
      return;
    }
    bi(field('train-site'), 'Hanya berlaku di ' + site.code + ' — reset tidak akan pernah menyentuh stok station live.',
                            'Applies to ' + site.code + ' only — a reset never touches stock at a live station.');

    /* ---- scenarios ---- */
    let scenarios = [];
    try { scenarios = (await api.scenarios()).scenarios; } catch (e) { fail(e); }
    const sHost = region('scenarios');
    sHost.innerHTML = scenarios.length ? scenarios.map(s =>
      '<div class="ccard">' +
      '<h2 class="ccard__title" ' + biAttr(s.name_id, s.name_en) + '>' + esc(s.name_id) + '</h2>' +
      '<p class="page__sub" ' + biAttr(TEACHES_ID[s.key] || s.teaches, s.teaches) + '>' +
      esc(TEACHES_ID[s.key] || s.teaches) + '</p>' +
      '<span class="toolbar__spacer"></span>' +
      '<button class="cbtn cbtn--primary" type="button" data-scenario="' + esc(s.key) + '" ' +
      biAttr('Muat skenario', 'Load scenario') + '>Muat skenario</button></div>').join('')
      : '<p class="note" ' + biAttr('Belum ada skenario.', 'No scenarios.') + '></p>';
    applyLangTo(sHost);

    function showResult(r, label) {
      const box = region('result');
      show(box, true);
      bi(field('result-title'), 'Dimuat: ' + label[0], 'Loaded: ' + label[1]);
      const dl = region('fixture');
      const entries = Object.entries(r.fixture || {});
      dl.innerHTML = entries.length ? entries.map(([k, v]) => {
        const l = KEY_LABEL[k] || [k, k];
        return '<dt ' + biAttr(l[0], l[1]) + '>' + esc(l[0]) + '</dt>' +
          '<dd class="mono" style="white-space:pre-line">' + esc(valueText(v)) + '</dd>';
      }).join('') : '<dt>—</dt><dd>' + esc(r.message) + '</dd>';
      applyLangTo(box);
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---- activity ---- */
    async function activity() {
      const host = region('activity');
      try {
        const r = await api.raw.get('/training/activity?site_id=' + site.id);
        host.innerHTML = r.rows.length ? r.rows.slice(0, 50).map(a =>
          '<tr><td class="td-code">' + esc(a.actor_email || '—') + '</td>' +
          '<td>' + esc(a.flow) + '</td><td>' + esc(a.event) + '</td>' +
          '<td class="td-code">' + esc(NJW.fmt.date(a.created_at) + ' ' + NJW.fmt.time(a.created_at)) + '</td></tr>').join('')
          : '<tr><td colspan="4" class="note" ' + biAttr('Belum ada yang berlatih di sini.', 'Nobody has practised here yet.') + '></td></tr>';
        applyLangTo(host);
      } catch (e) {
        host.innerHTML = '<tr><td colspan="4" class="note">' + esc(e.message) + '</td></tr>';
      }
    }

    document.addEventListener('click', async e => {
      const b = e.target.closest('[data-scenario]');
      if (b) {
        const s = scenarios.find(x => x.key === b.dataset.scenario);
        if (!s) return;
        if (!confirm('Muat "' + s.name_id + '" di ' + site.code + '? Stok dan pesanan latihan dihapus dulu.')) return;
        b.disabled = true;
        try {
          const r = await api.raw.post('/training/load', { site_id: site.id, scenario: s.key });
          say(r.message);
          showResult(r, [s.name_id, s.name_en]);
          activity();
        } catch (err) { fail(err); }
        b.disabled = false;
        return;
      }
      if (e.target.closest('[data-action="reset"]')) {
        if (!confirm('Reset ' + site.code + ' ke awal? Stok dan pesanan latihan dihapus, lalu semua keranjang diisi ulang.')) return;
        try {
          const r = await api.resetTraining({ site_id: site.id });
          say(r.message);
          showResult(r, ['Reset', 'Reset']);
          activity();
        } catch (err) { fail(err); }
      }
    });

    await activity();
  };
})();
