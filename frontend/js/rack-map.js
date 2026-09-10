/* rack-map.js — the one dense view. Renders the pick faces plus the overflow
   rack, from data of the shape:
   [{ name:'UT5-A', overflow:false,
      levels:[{ n:5, cells:[{ pos:1, state:'free'|'occ'|'over'|'count', sku, qty }] }] }]

   overflow:true marks a rack a picker is NEVER sent to. That is a different
   KIND of location, not another status, so it reads as a hatch rather than
   another fill colour — legible to someone who cannot separate the fills,
   and the legend states it in words. */
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
      col.className = 'rack' + (rack.overflow ? ' rack--overflow' : '');
      const name = document.createElement('div');
      name.className = 'rack__name';
      name.textContent = rack.name;
      if (rack.overflow) name.title = 'Cadangan — pemetik tidak pernah dikirim ke sini';
      col.appendChild(name);
      rack.levels.forEach(level => {
        const lv = document.createElement('div');
        lv.className = 'rack__level';
        const cells = document.createElement('div');
        cells.className = 'rack__cells';
        level.cells.forEach(cell => {
          const el = document.createElement('div');
          el.className = 'cell is-' + cell.state + (rack.overflow ? ' is-overflow' : '');
          const label = document.createElement('span');
          label.textContent = cell.state === 'free' ? '·' : String(cell.pos).padStart(2, '0');
          el.appendChild(label);
          el.title = rack.name + '-' + level.n + '-' + String(cell.pos).padStart(2, '0') +
            (rack.overflow ? ' · cadangan' : '') +
            (cell.sku ? ' · ' + cell.sku : '') + (cell.qty != null ? ' · ' + cell.qty : '');
          /* Overflow is not a pick face, so it is not counted in occupancy —
             the number a supervisor acts on is faces in use. */
          if (rack.overflow) { cells.appendChild(el); return; }
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
    const total = racks.filter(r => !r.overflow)
      .reduce((n, r) => n + r.levels.reduce((m, l) => m + l.cells.length, 0), 0);
    const set = (f, v) => { const el = document.querySelector('[data-field="' + f + '"]'); if (el) el.textContent = v; };
    set('used', used + ' / ' + total);
    set('over', over);
    set('tocount', tocount);
  };

  /* Stand-in occupancy so the screen renders before the API exists. */
  NJW.demoRacks = function () {
    const overs = { 'UT5-A': [[3, 4]], 'UT5-C': [[5, 4]], 'UT5-E': [[2, 1]], 'UT5-F': [[4, 1]] };
    return ['UT5-A', 'UT5-B', 'UT5-C', 'UT5-D', 'UT5-E', 'UT5-F', 'UT5-G', 'UT5-OV'].map((name, r) => ({
      name,
      overflow: name === 'UT5-OV',
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
