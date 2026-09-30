/* screens/laporan-merek.js · Laporan merek (console/laporan-merek.html), Ops HQ.
 *
 *   GET /api/reports/brand-sales/period?brand_id=&period=&start=   what a download covers
 *   GET /api/reports/brand-sales.xlsx?brand_id=&period=&start=     the Excel (PRD §15.1)
 *
 * The page defaults to the report Ops HQ sends next: last week's on a Monday
 * (the weekly goes out Monday 10:00 WIB), last month's in the first days of a
 * month. Before downloading it says which period, hubs and file name the
 * server will use, so the person checks the period, not the date arithmetic.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;
  const r = api.raw;
  const en = () => localStorage.getItem('njw.lang') === 'en';

  // Today in WIB, whatever the browser's clock zone.
  function wibToday() {
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const iso = d => d.toISOString().slice(0, 10);

  async function download(url, fallback) {
    const headers = {};
    try { const v = localStorage.getItem('njw.viewAs'); if (v) headers['X-View-As'] = v; } catch (e) {}
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch (e) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = m ? m[1] : fallback;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  NJW.screens['laporan-merek'] = async () => {
    const btn = $('[data-action="download"]');
    if (!W.atLeast('hq')) {
      btn.disabled = true;
      setF('p-label', en() ? 'This page is for Ops HQ.' : 'Halaman ini untuk Ops HQ.');
      return;
    }
    let period = 'weekly', info = null;

    // Last week (the one just sent for) and last month by default.
    const today = wibToday();
    const lastWeek = new Date(today.getTime() - 7 * 86400000);
    const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    field('day').value = iso(lastWeek);
    field('month').value = iso(lastMonth).slice(0, 7);

    try {
      const brands = (await api.brands()).filter(b => b.active);
      field('brand').innerHTML = brands.map(b =>
        '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
      if (!brands.length) {
        btn.disabled = true;
        setF('p-label', en() ? 'No active brand yet.' : 'Belum ada merek aktif.');
        return;
      }
    } catch (e) { return fail(e); }

    function params() {
      const start = period === 'weekly' ? field('day').value
        : (field('month').value ? field('month').value + '-01' : '');
      return { brand_id: field('brand').value, period, start,
               include_training: field('training').checked ? 'true' : '' };
    }

    let seq = 0;
    async function refresh() {
      const p = params();
      if (!p.brand_id || !p.start) return;
      const mine = ++seq;
      try {
        const res = await r.get('/reports/brand-sales/period' + r.qs(p));
        if (mine !== seq) return;   // a newer choice has already asked
        info = res;
        setF('p-label', res.label);
        setF('p-hubs', res.hubs.length ? res.hubs.join(', ')
          : (en() ? 'No hub carries this brand yet' : 'Belum ada hub yang menjual merek ini'));
        setF('p-ref', res.reference);
        setF('p-file', res.file_name);
        region('p-current').hidden = !res.is_current;
      } catch (e) { fail(e); }
    }

    $$('[data-period]', region('period')).forEach(b => b.addEventListener('click', () => {
      period = b.dataset.period;
      $$('[data-period]', region('period')).forEach(o => o.classList.toggle('is-on', o === b));
      region('week-field').hidden = period !== 'weekly';
      region('month-field').hidden = period !== 'monthly';
      refresh();
    }));
    ['brand', 'day', 'month', 'training'].forEach(f => field(f).addEventListener('change', refresh));

    btn.addEventListener('click', async () => {
      const p = params();
      if (!p.start) return say(en() ? 'Choose the period first.' : 'Pilih periodenya dulu.');
      btn.disabled = true;
      say(en() ? 'Making the report...' : 'Membuat laporan...');
      try {
        await download('/api/reports/brand-sales.xlsx' + r.qs(p), info ? info.file_name : 'brand-report.xlsx');
        say(en() ? 'Downloaded. Fill in the Notes column, then email it to the brand.'
                 : 'Terunduh. Isi kolom Notes, lalu kirim lewat email ke merek.');
      } catch (e) { fail(e); }
      finally { btn.disabled = false; }
    });

    applyLangTo(document.querySelector('.page'));
    await refresh();
  };
})();
