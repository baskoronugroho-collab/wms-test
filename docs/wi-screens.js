/* Interactive rack picture for the "rack-builder" screen draft (PRD v3.1, A2.2).
   Front view, to scale. Bin types and the stack rule follow PRD section 4.2. */
(function () {
  var BINS = {
    S: { w: 135, h: 120, stack: 3, name: 'Bin kecil JX-2' },
    L: { w: 198, h: 170, stack: 2, name: 'Bin besar JX-4' }
  };
  var BAY_W = 1000, LIFT = 15, SCALE = 0.24, HUB = 'MA5', RACK = 'A';
  var HEIGHTS = [380, 450, 450, 450, 450];   // clear height per level, level 1 at the bottom
  var DEFAULT = ['L', 'S', 'S', 'L', 'S'];
  var LETTERS = { 1: [''], 2: ['B', 'T'], 3: ['B', 'M', 'T'] };
  var WHERE = { B: 'bawah', M: 'tengah', T: 'atas' };

  function fit(size, h) {
    if (size === '-') return { pos: 0, stack: 0 };
    var b = BINS[size];
    return { pos: Math.floor(BAY_W / b.w), stack: Math.max(0, Math.min(b.stack, Math.floor((h - LIFT) / b.h))) };
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function init(root) {
    var st = { bays: 2, levels: 4, sel: [1, 3], size: {} };
    var pic = root.querySelector('[data-pic]'), selEl = root.querySelector('[data-sel]'),
        calc = root.querySelector('[data-calc]'), codeEl = root.querySelector('[data-code]'),
        sum = root.querySelector('[data-sum]'), sizeSeg = root.querySelector('[data-set="size"]');
    function sizeOf(bay, lvl) { return st.size[bay + '-' + lvl] || DEFAULT[lvl - 1]; }

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
        return;
      }
      sizeSeg.removeAttribute('aria-disabled');
      var bay = st.sel[0], lvl = st.sel[1], size = sizeOf(bay, lvl), h = HEIGHTS[lvl - 1], f = fit(size, h);
      selEl.textContent = 'Bagian ' + bay + ', tingkat ' + lvl + ' · tinggi bersih ' + h + ' mm';
      var on = sizeSeg.querySelector('[data-v="' + size + '"]');
      if (on) on.classList.add('on');
      calc.innerHTML = f.pos
        ? f.pos + ' bin berjajar × ' + f.stack + ' tumpuk = <b>' + (f.pos * f.stack) + ' bin</b>.<br>' +
          'Berjajar ' + f.pos + ' karena lebar ' + BAY_W + ' mm ÷ ' + BINS[size].w + ' mm. Tumpuk ' + f.stack +
          ' karena tinggi ' + h + ' mm (maks. ' + BINS[size].stack + ' untuk bin ini).'
        : 'Tingkat ini dibiarkan kosong.';
    }

    function draw() {
      pic.innerHTML = '';
      var totals = { S: 0, L: 0 };
      for (var bay = 1; bay <= st.bays; bay++) {
        var bayEl = document.createElement('div');
        bayEl.className = 'rk-bay';
        bayEl.style.width = (BAY_W * SCALE + 16) + 'px';
        for (var lvl = st.levels; lvl >= 1; lvl--) {
          var h = HEIGHTS[lvl - 1], size = sizeOf(bay, lvl), f = fit(size, h);
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'rk-lvl';
          row.style.height = (h * SCALE) + 'px';
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
              bin.className = 'rk-bin ' + size;
              bin.style.width = (BINS[size].w * SCALE) + 'px';
              bin.style.height = (BINS[size].h * SCALE) + 'px';
              bin.textContent = letter;
              bin.dataset.code = HUB + '-' + RACK + bay + '-' + lvl + '-' + pad(p) + letter;
              bin.dataset.bay = bay; bin.dataset.lvl = lvl; bin.dataset.pos = p; bin.dataset.letter = letter;
              col.appendChild(bin);
              totals[size]++;
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
          st.size[st.sel[0] + '-' + st.sel[1]] = v;
        } else {
          st[what] = +v;
          seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
          if (st.sel && (st.sel[0] > st.bays || st.sel[1] > st.levels)) st.sel = null;
        }
        draw();
      });
    });
    draw();
  }

  window.WMS_initRacks = function () { document.querySelectorAll('[data-rack]').forEach(init); };
  window.WMS_initRacks();
})();
