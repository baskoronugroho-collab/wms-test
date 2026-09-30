/* Interactive rack picture for the "rack-builder" screen draft (PRD v4.1, §3.2).
   Front view. There is no rack type (decided 30 Sep): the SPV enters, per level,
   the bin size and how many bins were counted across and stacked at the real
   rack. Bin types and the stack limit follow PRD §3.4. */
(function () {
  var BINS = {
    S: { w: 135, h: 120, stack: 3, name: 'Bin kecil JX-2' },
    L: { w: 198, h: 170, stack: 2, name: 'Bin besar JX-4' }
  };
  var SCALE = 0.24, HUB = 'MA5', RACK = 'A', LEVEL_H = 450;
  var DEFAULT = { S: [7, 3], L: [5, 2] };           // a first guess, overwritten by what the SPV counts
  var DEFAULT_SIZE = ['L', 'S', 'S', 'L', 'S'];
  var LETTERS = { 1: [''], 2: ['B', 'T'], 3: ['B', 'M', 'T'] };
  var WHERE = { B: 'bawah', M: 'tengah', T: 'atas' };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function init(root) {
    var st = { bays: 2, levels: 4, sel: [1, 3], size: {}, across: {}, stack: {} };
    var pic = root.querySelector('[data-pic]'), selEl = root.querySelector('[data-sel]'),
        calc = root.querySelector('[data-calc]'), codeEl = root.querySelector('[data-code]'),
        sum = root.querySelector('[data-sum]'), sizeSeg = root.querySelector('[data-set="size"]'),
        counts = root.querySelector('[data-counts]');
    function k(bay, lvl) { return bay + '-' + lvl; }
    function sizeOf(bay, lvl) { return st.size[k(bay, lvl)] || DEFAULT_SIZE[lvl - 1]; }
    function fit(bay, lvl) {
      var size = sizeOf(bay, lvl);
      if (size === '-') return { size: size, pos: 0, stack: 0 };
      var key = k(bay, lvl), d = DEFAULT[size];
      var pos = st.across[key] != null ? st.across[key] : d[0];
      var stack = Math.min(BINS[size].stack, st.stack[key] != null ? st.stack[key] : d[1]);
      return { size: size, pos: pos, stack: stack };
    }

    function hot(bin) {
      pic.querySelectorAll('.rk-bin.hot').forEach(function (x) { x.classList.remove('hot'); });
      bin.classList.add('hot');
      var d = bin.dataset;
      codeEl.innerHTML = d.code + '<br><small class="muted" style="font-weight:400;font-size:11px">Rak ' + RACK +
        ', bagian ' + d.bay + ', tingkat ' + d.lvl + ', posisi ' + d.pos + (d.letter ? ', bin ' + WHERE[d.letter] : '') + '</small>';
    }

    function side() {
      sizeSeg.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); });
      if (!st.sel) {
        sizeSeg.setAttribute('aria-disabled', 'true');
        selEl.textContent = 'Klik satu tingkat di gambar';
        calc.textContent = '';
        if (counts) counts.hidden = true;
        return;
      }
      sizeSeg.removeAttribute('aria-disabled');
      var bay = st.sel[0], lvl = st.sel[1], f = fit(bay, lvl);
      selEl.textContent = 'Bagian ' + bay + ', tingkat ' + lvl;
      var on = sizeSeg.querySelector('[data-v="' + f.size + '"]');
      if (on) on.classList.add('on');
      if (counts) {
        counts.hidden = !f.pos && f.size === '-';
        counts.querySelector('[data-n="across"]').textContent = f.pos;
        counts.querySelector('[data-n="stack"]').textContent = f.stack;
      }
      calc.innerHTML = f.size !== '-'
        ? f.pos + ' bin menyamping × ' + f.stack + ' tumpuk = <b>' + (f.pos * f.stack) + ' bin</b>.<br>' +
          'Angka dari hitungan SPV di rak. Tumpukan maks. ' + BINS[f.size].stack + ' untuk ' + BINS[f.size].name + '.'
        : 'Tingkat ini dibiarkan kosong.';
    }

    function draw() {
      pic.innerHTML = '';
      var totals = { S: 0, L: 0 };
      for (var bay = 1; bay <= st.bays; bay++) {
        var bayEl = document.createElement('div');
        bayEl.className = 'rk-bay';
        var widest = 0;
        for (var l2 = 1; l2 <= st.levels; l2++) {
          var g = fit(bay, l2);
          if (g.pos) widest = Math.max(widest, g.pos * (BINS[g.size].w * SCALE + 2));
        }
        bayEl.style.width = Math.max(160, widest + 30) + 'px';
        for (var lvl = st.levels; lvl >= 1; lvl--) {
          var f = fit(bay, lvl);
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'rk-lvl';
          row.style.height = (LEVEL_H * SCALE) + 'px';
          row.setAttribute('aria-label', 'Bagian ' + bay + ', tingkat ' + lvl);
          if (st.sel && st.sel[0] === bay && st.sel[1] === lvl) row.classList.add('sel');
          var lvn = document.createElement('span');
          lvn.className = 'lvn';
          lvn.textContent = 'Tk ' + lvl;
          row.appendChild(lvn);
          if (!f.pos) {
            var e = document.createElement('span');
            e.className = 'empty';
            e.textContent = 'kosong';
            row.appendChild(e);
          }
          for (var p = 1; p <= f.pos; p++) {
            var col = document.createElement('span');
            col.className = 'rk-col';
            for (var s = 0; s < f.stack; s++) {
              var bin = document.createElement('span'), letter = LETTERS[f.stack][s];
              bin.className = 'rk-bin ' + f.size;
              bin.style.width = (BINS[f.size].w * SCALE) + 'px';
              bin.style.height = (BINS[f.size].h * SCALE) + 'px';
              bin.textContent = letter;
              bin.dataset.code = HUB + '-' + RACK + bay + '-' + lvl + '-' + pad(p) + letter;
              bin.dataset.bay = bay; bin.dataset.lvl = lvl; bin.dataset.pos = p; bin.dataset.letter = letter;
              col.appendChild(bin);
              totals[f.size]++;
            }
            row.appendChild(col);
          }
          row.addEventListener('click', (function (b, l) { return function () { st.sel = [b, l]; draw(); }; })(bay, lvl));
          bayEl.appendChild(row);
        }
        var lab = document.createElement('span');
        lab.className = 'rk-baylab';
        lab.textContent = 'Bagian ' + bay;
        bayEl.appendChild(lab);
        pic.appendChild(bayEl);
      }
      pic.querySelectorAll('.rk-bin').forEach(function (b) {
        b.addEventListener('mouseenter', function () { hot(b); });
      });
      sum.textContent = 'Rak ' + RACK + ': ' + (totals.S + totals.L) + ' bin (' + totals.L + ' besar, ' + totals.S + ' kecil)';
      side();
    }

    root.querySelectorAll('[data-set]').forEach(function (seg) {
      seg.addEventListener('click', function (ev) {
        var b = ev.target.closest('button');
        if (!b) return;
        var what = seg.dataset.set, v = b.dataset.v;
        if (what === 'size') {
          if (!st.sel) return;
          st.size[k(st.sel[0], st.sel[1])] = v;
        } else {
          st[what] = +v;
          seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          if (st.sel && (st.sel[0] > st.bays || st.sel[1] > st.levels)) st.sel = null;
        }
        draw();
      });
    });
    if (counts) counts.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-step]');
      if (!b || !st.sel) return;
      var key = k(st.sel[0], st.sel[1]), f = fit(st.sel[0], st.sel[1]);
      if (f.size === '-') return;
      if (b.dataset.what === 'across') st.across[key] = Math.max(1, Math.min(12, f.pos + (+b.dataset.step)));
      else st.stack[key] = Math.max(1, Math.min(BINS[f.size].stack, f.stack + (+b.dataset.step)));
      draw();
    });
    draw();
  }

  window.WMS_initRacks = function () { document.querySelectorAll('[data-rack]').forEach(init); };
  window.WMS_initRacks();
})();
