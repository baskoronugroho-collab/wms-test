/* label-warna-hari.js — console: the day-colour legend and label sheet.
 *
 * Everything comes from GET /day-colors, which works in Jakarta time on the
 * server; nothing here reads the browser clock for a day. Every swatch is
 * printed with its day name, week letter and date — never colour alone.
 *
 * The label sheet prints today's colour by default. Tapping a day in the week
 * grid switches the sheet to that day, so a station can print tomorrow's
 * stickers before the delivery arrives.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, esc, bi, biAttr, applyLangTo, fail } = W;
  const api = NJW.api;

  // Pure calendar arithmetic on server dates (no clock involved).
  function isoWeek(ds) {
    const [y, m, d] = String(ds).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return Math.ceil(((dt - y0) / 864e5 + 1) / 7);
  }
  function shiftDate(ds, days) {
    const [y, m, d] = String(ds).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  const parity = ds => (isoWeek(ds) % 2 === 0 ? 'A' : 'B');   // same rule as daycolor.py
  const dmy = ds => { const [y, m, d] = String(ds).split('-'); return d + '/' + m + '/' + y; };

  NJW.screens['label-warna-hari'] = async () => {
    let dc;
    try { dc = await api.dayColors(); } catch (e) { return fail(e); }
    const today = dc.today;

    /* ---- today's chip ---- */
    NJW.paintDayColor(today);
    const wk = W.field('day-week');
    bi(wk, 'Minggu ' + today.week_parity + ' · W' + today.iso_week,
           'Week ' + today.week_parity + ' · W' + today.iso_week);

    /* ---- the FIFO warning, with this week's real numbers ---- */
    // The batch the week letter separates from today's: same weekday, same
    // colour, one week older, the other letter.
    const dd = $$('.deflist dd');
    const prev = shiftDate(today.date, -7);
    if (dd[0]) dd[0].innerHTML = 'W' + today.iso_week + ' · <strong ' +
      biAttr('Minggu ' + today.week_parity, 'Week ' + today.week_parity) + '></strong>';
    if (dd[1]) dd[1].innerHTML = esc(NJW.fmt.date(prev)) + ' · <span ' +
      biAttr(today.day_id, today.day_en) + '></span> · <span ' +
      biAttr('Minggu ' + parity(prev), 'Week ' + parity(prev)) + '></span>';
    applyLangTo($('.deflist'));

    /* ---- the week on screen ---- */
    const grid = $('.weekgrid');
    let chosen = today.date;
    function paintWeek() {
      grid.innerHTML = dc.week.map(d => {
        const isToday = d.date === today.date;
        return '<div class="daycell' + (isToday ? ' is-today' : '') + '" role="button" tabindex="0" ' +
          'data-date="' + esc(d.date) + '" aria-pressed="' + (d.date === chosen) + '" style="cursor:pointer' +
          (d.date === chosen && !isToday ? ';box-shadow:var(--shadow-2),inset 0 0 0 2px var(--ink-2)' : '') + '">' +
          '<span class="daycell__block" style="background:' + esc(d.hex) + ';color:' + esc(d.ink) + '">' +
          '<span>' + esc(d.day_id.slice(0, 3).toUpperCase()) + '</span>' +
          '<span' + (isToday ? ' ' + biAttr('HARI INI', 'TODAY') : '') + '></span></span>' +
          '<span class="daycell__text"><span class="daycell__day" ' + biAttr(d.day_id, d.day_en) + '></span>' +
          '<span class="daycell__date">' + esc(NJW.fmt.date(d.date)) + ' · ' + esc(d.week_parity) + '</span>' +
          '</span></div>';
      }).join('');
      applyLangTo(grid);
    }
    grid.addEventListener('click', e => {
      const cell = e.target.closest('[data-date]');
      if (cell) pick(cell.dataset.date);
    });
    grid.addEventListener('keydown', e => {
      const cell = e.target.closest('[data-date]');
      if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(cell.dataset.date); }
    });

    /* ---- the label sheet (21 × 63 × 38 mm): colour + day + week + date ---- */
    const note = $('.toolbar .pager__info');
    function paintLabels() {
      const d = dc.week.find(x => x.date === chosen) || today;
      $$('[data-field="label-block"]').forEach(b => { b.style.background = d.hex; b.style.color = d.ink; });
      $$('[data-field="label-day"]').forEach(e => { e.textContent = d.day_id.toUpperCase(); });
      $$('[data-field="label-week"]').forEach(e => { e.textContent = d.week_parity; });
      $$('[data-field="label-date"]').forEach(e => { e.textContent = dmy(d.date); });
      const n = $$('.label').length;
      const which = d.date === today.date ? ['hari ini', 'today'] : [d.day_id + ' ' + NJW.fmt.date(d.date), d.day_en + ' ' + NJW.fmt.date(d.date)];
      bi(note, 'Lembar cetak di bawah: ' + n + ' label A4 (63 × 38 mm) untuk ' + which[0] +
               ', lalu satu lembar bagan minggu untuk ditempel di dinding station. Ketuk hari lain untuk mencetak labelnya.',
               'Print sheets below: ' + n + ' A4 labels (63 × 38 mm) for ' + which[1] +
               ', then a one-page week chart to pin up at the station. Tap another day to print its labels.');
    }
    function pick(date) { chosen = date; paintWeek(); paintLabels(); }

    /* ---- the wall chart ---- */
    const wall = $('.wallchart');
    if (wall) wall.innerHTML = dc.week.map(d =>
      '<div class="wallday"><span class="wallday__block" style="background:' + esc(d.hex) + '"></span>' +
      '<span class="wallday__text"><span class="wallday__name">' + esc(d.day_id) + '</span>' +
      '<span class="wallday__date">' + esc(NJW.fmt.date(d.date)) + ' · Minggu ' + esc(d.week_parity) +
      '</span></span></div>').join('');

    pick(today.date);
  };
})();
