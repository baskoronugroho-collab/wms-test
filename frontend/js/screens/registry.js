/* screens/registry.js — SKU & rack registry (console/registry.html).
 *
 * One rack face and at most one overflow per SKU, and two numbers: the full
 * threshold (the rack is "full"; the next inbound goes to overflow) and the
 * restock point (everything held, rack plus overflow, is low: ask for more).
 * The low/replenishment threshold of the older model is gone — the picker is
 * sent to whichever of rack or overflow holds the older stock — so every write
 * from here sends low_threshold: null, which also clears any legacy value that
 * the server would otherwise keep validating restock against.
 *
 * GET /api/registry has a limit but no offset, so the list is read whole (it
 * is capped at 500 by the API) and filtered and paged here.
 */
(function () {
  'use strict';
  const W = NJW.wire;
  const { $, $$, field, region, setF, esc, bi, biAttr, applyLangTo, say, fail } = W;
  const api = NJW.api;

  const PER = 25;
  const show = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };

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

  function pageList(cur, n) {
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const keep = [...new Set([1, n, cur - 1, cur, cur + 1].filter(p => p >= 1 && p <= n))]
      .sort((a, b) => a - b);
    const out = [];
    keep.forEach((p, i) => { if (i && p - keep[i - 1] > 1) out.push('…'); out.push(p); });
    return out;
  }
  function paintPager(total, page, go) {
    const from = total ? (page - 1) * PER + 1 : 0, to = Math.min(total, page * PER);
    setF('range', from + '–' + to);
    setF('total', NJW.fmt.n(total));
    const nav = $('.pager__nav');
    if (!nav) return;
    const pages = Math.max(1, Math.ceil(total / PER));
    nav.innerHTML =
      '<button class="pager__page" type="button" data-pg="' + (page - 1) + '" aria-label="Sebelumnya"' +
      (page <= 1 ? ' disabled' : '') + '>‹</button>' +
      pageList(page, pages).map(p => p === '…' ? '<span class="pager__gap">…</span>'
        : '<button class="pager__page' + (p === page ? ' is-on' : '') + '" type="button" data-pg="' +
          p + '">' + p + '</button>').join('') +
      '<button class="pager__page" type="button" data-pg="' + (page + 1) + '" aria-label="Berikutnya"' +
      (page >= pages ? ' disabled' : '') + '>›</button>';
    nav.onclick = e => {
      const b = e.target.closest('[data-pg]');
      if (b && !b.disabled) go(+b.dataset.pg);
    };
  }

  function downloadCsv(name, rows) {
    const cell = v => {
      const s = String(v == null ? '' : v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')],
      { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  /* The track runs to roughly the rack's capacity. The registry row carries no
     capacity, but the full threshold is set at ~90% of it, so full / 0.9 is the
     closest honest scale — and the fill can never overrun what is really there. */
  function thbar(r) {
    const full = r.full_threshold, restock = r.restock_point;
    const scale = Math.max(full ? full / 0.9 : 0, r.qty_primary, restock || 0, 1);
    const at = v => Math.min(100, v / scale * 100).toFixed(1) + '%';
    const cls = r.qty_total <= 0 ? ' is-empty' : r.needs_restock ? ' is-low'
      : (full && r.qty_primary >= full ? ' is-full' : '');
    return '<span class="thbar"><span class="thbar__track">' +
      '<span class="thbar__fill' + cls + '" style="width:' + at(r.qty_primary) + '"></span>' +
      (restock != null ? '<span class="thbar__mark" data-mark="R" style="left:' + at(restock) + '"></span>' : '') +
      (full != null ? '<span class="thbar__mark" data-mark="P" style="left:' + at(full) + '"></span>' : '') +
      '</span><span class="thbar__nums"><strong>' + r.qty_primary + '</strong> <span ' +
      biAttr('rak', 'rack') + '>rak</span> <span class="sep">+</span> ' + r.qty_overflow + ' <span ' +
      biAttr('cadangan', 'overflow') + '>cadangan</span> <span class="sep">·</span> P' +
      (full != null ? full : '—') + ' R' + (restock != null ? restock : '—') + '</span></span>' +
      (!r.configured ? '<span class="misset" style="margin-top:6px"><span aria-hidden="true">!</span><span ' +
        biAttr('Belum diatur — sistem tidak tahu kapan minta kiriman', 'Unset — the system cannot tell when to ask for more') +
        '></span></span>'
        : r.needs_restock ? '<span class="spill spill--warn" style="margin-top:6px"><span class="spill__dot"></span><span ' +
          biAttr('Perlu pesan ulang', 'Needs restock') + '></span></span>' : '');
  }

  function row(r) {
    return '<tr data-sku="' + r.sku_id + '"' + (r.needs_restock ? ' class="is-variance"' : '') + '>' +
      '<td class="td-check"><input class="checkbox" type="checkbox" aria-label="Pilih ' + esc(r.brand_sku_code || r.sku_name) + '"></td>' +
      '<td class="td-thumb"><img class="thumb" src="../assets/products/placeholder.svg" data-photo-key="' +
      esc(String(r.brand_sku_code || '').toLowerCase()) + '" alt=""></td>' +
      '<td><span class="td-strong">' + esc(r.sku_name) + '</span><br><span class="td-code" ' +
      'style="color:var(--muted);font-size:var(--fs-c-meta)">' + esc(r.brand_sku_code || '') + '</span></td>' +
      '<td class="td-code">' + esc(r.primary_location_code || '—') + '</td>' +
      '<td>' + (r.overflow_location_code ? '<span class="td-code">' + esc(r.overflow_location_code) + '</span>'
        : '<span class="na" ' + biAttr('tidak ada', 'none') + '>tidak ada</span>') + '</td>' +
      '<td>' + thbar(r) + '</td>' +
      '<td class="td-actions"><button class="cbtn cbtn--sm" type="button" data-edit="' + r.sku_id + '" ' +
      biAttr('Ubah', 'Edit') + '>Ubah</button></td></tr>';
  }

  NJW.screens.registry = async () => {
    const site = W.site();
    if (!site) return;
    let rows = [], filter = 'all', page = 1, editing = null, rackIndex = null;
    const table = $('#tbl-registry');
    // Thresholds are set by Ops HQ. An SPV still sees them and assigns overflow.
    const canThreshold = W.atLeast('hq');
    if (!canThreshold) {
      $$('[data-action="suggest"], [data-action="bulk-open"]').forEach(b => { b.hidden = true; });
    }

    async function load() {
      try {
        rows = (await api.registry({ site_id: site.id, limit: 500 })).rows;
      } catch (e) { return fail(e); }
      render();
    }

    function visible() {
      const q = (field('search').value || '').trim().toLowerCase();
      return rows.filter(r =>
        (filter === 'all' ||
         (filter === 'restock' && r.needs_restock) ||
         (filter === 'unset' && !r.configured) ||
         (filter === 'nooverflow' && !r.overflow_location_code)) &&
        (!q || [r.sku_name, r.brand_sku_code, r.primary_location_code, r.overflow_location_code]
          .join(' ').toLowerCase().includes(q)));
    }

    function render() {
      const list = visible();
      const pages = Math.max(1, Math.ceil(list.length / PER));
      page = Math.min(Math.max(1, page), pages);
      const host = region('registry');
      const slice = list.slice((page - 1) * PER, page * PER);
      host.innerHTML = slice.length ? slice.map(row).join('')
        : '<tr><td colspan="7" class="note" ' + (rows.length
          ? biAttr('Tidak ada baris yang cocok.', 'No matching rows.')
          : biAttr('Belum ada SKU dengan rak ambil di lokasi ini.', 'No SKU has a rack face at this site yet.')) +
          '></td></tr>';
      applyLangTo(host);
      if (NJW.paintPhotos) NJW.paintPhotos(host);
      setF('result-count', slice.length);
      paintPager(list.length, page, p => { page = p; render(); });
      const all = $('thead .checkbox', table);
      if (all) { all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    const selected = () => $$('tbody .checkbox', table).filter(b => b.checked)
      .map(b => +b.closest('tr').dataset.sku).filter(Boolean);

    /* Typed overflow codes resolve to a basket through the rack map — the same
       payload the station's map draws — so the check is against what exists. */
    async function basketFor(code) {
      if (!rackIndex) {
        const m = await api.rackMap(site.id);
        rackIndex = new Map();
        m.racks.forEach(rk => rk.levels.forEach(lv => lv.positions.forEach(p =>
          rackIndex.set(String(p.code).toUpperCase(), p))));
      }
      return rackIndex.get(code.toUpperCase());
    }

    const put = (skuId, full, restock, safety) => api.updateRegistry(skuId, {
      site_id: site.id, full_threshold: full, low_threshold: null, restock_point: restock,
      safety_stock: safety === undefined ? (rows.find(r => r.sku_id === skuId) || {}).safety_stock ?? null : safety,
    });

    async function openEdit(r) {
      editing = r;
      setF('reg-name', r.sku_name);
      setF('reg-meta', (r.brand_sku_code || '') + ' · ' + r.qty_primary + ' rak + ' + r.qty_overflow + ' cadangan');
      const img = field('reg-photo');
      if (img) img.dataset.photoKey = String(r.brand_sku_code || '').toLowerCase();
      field('reg-face').value = r.primary_location_code || '';
      const ov = field('reg-overflow');
      ov.value = r.overflow_location_code || '';
      // Moving an existing overflow needs the slot id, which the registry row
      // does not carry; an existing one is shown, not offered for editing.
      ov.readOnly = !!r.overflow_location_code;
      show(field('reg-overflow-btn'), !r.overflow_location_code);
      field('reg-p').value = r.full_threshold != null ? r.full_threshold : '';
      field('reg-r').value = r.restock_point != null ? r.restock_point : '';
      field('reg-s').value = r.safety_stock != null ? r.safety_stock : '';
      field('reg-p').disabled = field('reg-r').disabled = field('reg-s').disabled = !canThreshold;
      if (!canThreshold) bi(field('reg-reason'), 'Batas P dan R diatur oleh Ops HQ.', 'P and R are set by Ops HQ.');
      setF('reg-p-sug', '…');
      setF('reg-r-sug', '…');
      openDrawer('#drawer-reg');
      try {
        const s = await api.suggestSlot(r.sku_id, { site_id: site.id });
        if (editing !== r) return;
        bi(field('reg-p-sug'), 'saran ' + s.full_threshold, 'suggested ' + s.full_threshold);
        bi(field('reg-r-sug'), 'saran ' + s.restock_point, 'suggested ' + s.restock_point);
        bi(field('reg-reason'),
          'Keranjang ' + s.basket_size + ' muat sekitar ' + s.capacity_units + ' unit. Saran: P di 90%, R di separuhnya.',
          'A ' + s.basket_size + ' basket holds about ' + s.capacity_units + ' units. Suggested: P at 90%, R at half.');
        setF('reg-meta', (r.brand_sku_code || '') + ' · keranjang ' + s.basket_size + ' · kapasitas ~' + s.capacity_units);
      } catch (e) {
        setF('reg-p-sug', '—');
        setF('reg-r-sug', '—');
      }
    }

    async function saveEdit() {
      const r = editing;
      if (!r) return;
      const pRaw = field('reg-p').value.trim(), rRaw = field('reg-r').value.trim();
      const full = pRaw === '' ? null : +pRaw;
      const restock = rRaw === '' ? null : +rRaw;
      const sRaw = field('reg-s').value.trim();
      const safety = sRaw === '' ? null : +sRaw;
      if (safety != null && restock != null && safety > restock) return say('S tidak boleh di atas R.');
      if (full != null && !(full > 0)) return say('P harus lebih dari nol.');
      if (restock != null && !(restock >= 0)) return say('R tidak boleh negatif.');
      try {
        if (canThreshold) await put(r.sku_id, full, restock, safety);
        const code = field('reg-overflow').value.trim();
        if (code && !r.overflow_location_code) {
          const pos = await basketFor(code);
          if (!pos) return say(code + ' tidak ada di ' + site.code + '.');
          if (!pos.basket_id) return say(code + ' belum punya keranjang.');
          if (pos.state === 'occupied') return say(code + ' sudah dipakai ' + (pos.sku_name || 'SKU lain') + '.');
          await api.raw.post('/slots', {
            site_id: site.id, sku_id: r.sku_id, basket_id: pos.basket_id, slot_role: 'overflow',
          });
          rackIndex = null;
        }
        say('Tersimpan.');
        closeDrawers();
        await load();
      } catch (e) { fail(e); }
    }

    const bulkMode = () => ($('input[name="mode"]:checked') || {}).value || 'pct';
    $$('input[name="mode"]').forEach(i => i.addEventListener('change', () => {
      const pct = bulkMode() === 'pct';
      setF('bulk-unit-p', pct ? '%' : 'unit');
      setF('bulk-unit-r', pct ? '%' : 'unit');
      // 90 and 50 are sane percents and nonsense unit counts; make the person
      // type real numbers rather than carry one mode's values into the other.
      field('bulk-p').value = pct ? 90 : '';
      field('bulk-r').value = pct ? 50 : '';
    }));

    async function applyBulk() {
      const ids = selected();
      if (!ids.length) return say('Pilih baris dulu.');
      const P = +field('bulk-p').value, R = +field('bulk-r').value;
      if (!(P > 0) || !(R >= 0)) return say('Isi P (lebih dari nol) dan R.');
      try {
        if (bulkMode() === 'fixed') {
          const r = await api.bulkRegistry({
            site_id: site.id, sku_ids: ids, full_threshold: P, low_threshold: null, restock_point: R,
          });
          say(r.message || 'Tersimpan.');
        } else {
          // A percent means something different per basket size, so each SKU's
          // own capacity is asked for; the bulk endpoint only takes fixed numbers.
          let n = 0;
          for (const id of ids) {
            const s = await api.suggestSlot(id, { site_id: site.id });
            const cap = s.capacity_units;
            await put(id, Math.max(1, Math.round(cap * P / 100)), Math.max(0, Math.round(cap * R / 100)));
            n++;
            say(n + ' / ' + ids.length + ' …');
          }
          say(n + ' SKU diperbarui.');
        }
        closeDrawers();
        await load();
      } catch (e) { fail(e); }
    }

    /* ---- wiring ---- */
    field('search').addEventListener('input', () => { page = 1; render(); });
    $$('[data-filter]', region('filter')).forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.filter;
      $$('[data-filter]', region('filter')).forEach(o => o.classList.toggle('is-on', o === b));
      page = 1;
      render();
    }));

    document.addEventListener('click', async e => {
      const ed = e.target.closest('[data-edit]');
      if (ed) return openEdit(rows.find(r => r.sku_id === +ed.dataset.edit));
      if (e.target.closest('[data-action="save-reg"]')) return saveEdit();
      if (e.target.closest('[data-action="bulk-open"]')) return setF('bulk-echo', selected().length);
      if (e.target.closest('[data-action="apply-bulk"]')) return applyBulk();

      if (e.target.closest('[data-action="suggest-overflow"]') && editing) {
        try {
          const s = await api.raw.get('/slots/suggest' + api.raw.qs({ site_id: site.id, sku_id: editing.sku_id }));
          if (s.location_code) field('reg-overflow').value = s.location_code;
          else say('Tidak ada keranjang kosong di ' + site.code + '.');
        } catch (err) { fail(err); }
        return;
      }

      if (e.target.closest('[data-action="suggest"]')) {
        const blank = rows.filter(r => !r.configured);
        if (!blank.length) return say('Semua SKU sudah diatur.');
        if (!confirm('Isi saran P dan R untuk ' + blank.length + ' SKU yang belum diatur?')) return;
        let n = 0;
        try {
          for (const r of blank) {
            const s = await api.suggestSlot(r.sku_id, { site_id: site.id });
            await put(r.sku_id, r.full_threshold != null ? r.full_threshold : s.full_threshold,
                      r.restock_point != null ? r.restock_point : s.restock_point);
            n++;
            say(n + ' / ' + blank.length + ' …');
          }
          say(n + ' SKU diisi saran. Periksa dan koreksi bila perlu.');
        } catch (err) { fail(err); }
        await load();
        return;
      }

      if (e.target.closest('[data-action="bulk-overflow"]')) {
        const ids = selected().filter(id => {
          const r = rows.find(x => x.sku_id === id);
          return r && !r.overflow_location_code;
        });
        if (!ids.length) return say('Semua yang dipilih sudah punya cadangan.');
        if (!confirm('Beri ' + ids.length + ' SKU keranjang cadangan kosong pertama yang tersedia?')) return;
        let n = 0;
        for (const id of ids) {
          try {
            await api.raw.post('/slots', { site_id: site.id, sku_id: id, slot_role: 'overflow' });
            n++;
          } catch (err) { say(err.message); break; }
        }
        say(n + ' cadangan ditetapkan.');
        rackIndex = null;
        await load();
        return;
      }

      if (e.target.closest('[data-action="export"]')) {
        downloadCsv('penempatan-' + site.code + '.csv',
          [['sku code', 'product', 'rack', 'overflow', 'qty rack', 'qty overflow', 'full (P)',
            'restock point (R)', 'needs restock']].concat(visible().map(r => [
            r.brand_sku_code, r.sku_name, r.primary_location_code, r.overflow_location_code,
            r.qty_primary, r.qty_overflow, r.full_threshold, r.restock_point, r.needs_restock ? 'yes' : 'no'])));
      }
    });

    await load();
  };
})();
