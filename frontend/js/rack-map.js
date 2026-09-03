/* rack-map.js — the one dense view. Renders 7 racks x 5 levels x 5 positions
   from data of the shape:
   [{ name:'UT5-A', levels:[{ n:5, cells:[{ pos:1, state:'free'|'occ'|'over'|'count', sku, qty }] }] }]
*/
(function () {
  window.NJW = window.NJW || {};

  NJW.renderRackMap = function (host, racks) {
    if (!host) return;
    host.textContent = '';
    let used = 0, over = 0, tocount = 0;

    // left gutter: level numbers once, aligned to the rack rows
    const gutter = document.createElement('div');
    gutter.className = 'rack rack--gutter';
    gutter.setAttribute('aria-hidden', 'true');
    const gname = document.createElement('div');
    gname.className = 'rack__name';
    gname.textContent = 'TINGKAT';
    gutter.appendChild(gname);
    (racks[0] ? racks[0].levels : []).forEach(level => {
      const lv = document.createElement('div');
      lv.className = 'rack__level';
      const label = document.createElement('div');
      label.className = 'rack__lvl-label';
      label.textContent = level.n;
      lv.appendChild(label);
      gutter.appendChild(lv);
    });
    host.appendChild(gutter);
    racks.forEach(rack => {
      const col = document.createElement('div');
      col.className = 'rack';
      const name = document.createElement('div');
      name.className = 'rack__name';
      name.textContent = rack.name;
      col.appendChild(name);
      rack.levels.forEach(level => {
        const lv = document.createElement('div');
        lv.className = 'rack__level';
        const cells = document.createElement('div');
        cells.className = 'rack__cells';
        level.cells.forEach(cell => {
          const el = document.createElement('div');
          el.className = 'cell is-' + cell.state;
          el.textContent = cell.state === 'free' ? '·' : String(cell.pos).padStart(2, '0');
          el.title = rack.name + '-' + level.n + '-' + String(cell.pos).padStart(2, '0') +
            (cell.sku ? ' · ' + cell.sku : '') + (cell.qty != null ? ' · ' + cell.qty : '');
          if (cell.state !== 'free') used++;
          if (cell.state === 'over') over++;
          if (cell.state === 'count') tocount++;
          cells.appendChild(el);
        });
        lv.appendChild(cells);
        col.appendChild(lv);
      });
      host.appendChild(col);
    });
    const total = racks.reduce((n, r) => n + r.levels.reduce((m, l) => m + l.cells.length, 0), 0);
    const set = (f, v) => { const el = document.querySelector('[data-field="' + f + '"]'); if (el) el.textContent = v; };
    set('used', used + ' / ' + total);
    set('over', over);
    set('tocount', tocount);
  };

  /* Stand-in occupancy so the screen renders before the API exists. */
  NJW.demoRacks = function () {
    const overs = { 'UT5-A': [[3, 4]], 'UT5-C': [[5, 4]], 'UT5-E': [[2, 1]], 'UT5-F': [[4, 1]] };
    return ['UT5-A', 'UT5-B', 'UT5-C', 'UT5-D', 'UT5-E', 'UT5-F', 'UT5-G'].map((name, r) => ({
      name,
      levels: [5, 4, 3, 2, 1].map(n => ({
        n,
        cells: [1, 2, 3, 4, 5].map(pos => {
          const h = (r * 31 + n * 17 + pos * 7) % 11;
          let state = h < 3 ? 'free' : (h === 4 || h === 9) ? 'count' : 'occ';
          if ((overs[name] || []).some(o => o[0] === n && o[1] === pos)) state = 'over';
          return { pos, state };
        })
      }))
    }));
  };
})();
