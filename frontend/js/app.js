/* Ninja Kilat WMS — station app.
 *
 * One task per screen, one primary action per screen. Every guided flow is the
 * same loop: the screen says what to scan, you scan, it goes green or red.
 */

const t = (k, v) => I18N.t(k, v);
const el = document.getElementById.bind(document);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { me: null, site: null, scanner: null };

/* ---------- chrome ---------- */

function toast(msg, bad) {
  const d = document.createElement('div');
  d.className = 'toast' + (bad ? ' bad' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

function renderBar() {
  const sites = state.me ? state.me.sites : [];
  el('bar').innerHTML = `
    <div class="mark">NINJA <span>· Kilat WMS</span></div>
    <div class="spacer"></div>
    ${sites.length ? `<select id="siteSel" aria-label="${t('site')}">
      ${sites.map(s => `<option value="${s.id}" ${state.site && s.id === state.site.id ? 'selected' : ''}>
        ${esc(s.code)}${s.is_training ? ' · latihan' : ''}</option>`).join('')}
    </select>` : ''}
    <span class="pill" id="conn" hidden>${t('offline')}</span>
    <button class="link" id="langId" aria-pressed="${I18N.get() === 'id'}">ID</button>
    <button class="link" id="langEn" aria-pressed="${I18N.get() === 'en'}">EN</button>`;

  const sel = el('siteSel');
  if (sel) sel.onchange = e => {
    state.site = sites.find(s => s.id === +e.target.value);
    localStorage.setItem('wms.site', state.site.id);
    render();
  };
  el('langId').onclick = () => { I18N.set('id'); render(); };
  el('langEn').onclick = () => { I18N.set('en'); render(); };

  el('trainbar').hidden = !(state.site && state.site.is_training);
  el('trainbar').textContent = t('training_banner');
}

API.onConnectionChange(on => {
  const c = el('conn');
  if (c) { c.hidden = on; c.classList.toggle('offline', !on); }
});

/* ---------- routing ---------- */

const routes = {};
function go(hash) { location.hash = hash; }
function route() {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { name, args: rest };
}
async function render() {
  renderBar();
  const { name, args } = route();
  const view = routes[name] || routes.home;
  const main = el('main');
  main.innerHTML = `<div class="empty-state">${t('loading')}</div>`;
  if (state.scanner) { state.scanner.destroy(); state.scanner = null; }
  try {
    await view(main, args);
  } catch (e) {
    main.innerHTML = `<div class="banner bad"><b>${esc(e.message)}</b>
      ${e.status === 403 || e.status === 409 ? '' : t('call_supervisor')}</div>
      <button class="btn ghost" onclick="history.back()">${t('back')}</button>`;
  }
}
window.addEventListener('hashchange', render);

function header(title, sub) {
  return `<button class="btn quiet" onclick="location.hash='#/home'">&larr; ${t('back')}</button>
    <h1 class="title">${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}`;
}

function scanZone(labelText) {
  return `<div class="scanzone" id="zone">
      <label for="scanIn">${labelText || t('scan_here')}</label>
      <input id="scanIn" autocomplete="off" autocapitalize="off" spellcheck="false"
             inputmode="text" placeholder="${t('scan_hint')}">
    </div>`;
}

function productBlock(sku, extra) {
  if (!sku) return '';
  return `<div class="product">
    <div class="thumb">${sku.photo_key
      ? `<img src="/api/photo/${esc(sku.photo_key)}" alt=""
              onerror="this.parentNode.textContent='FOTO'">`
      : 'FOTO'}</div>
    <div class="grow">
      <p class="pname">${esc(sku.name_display)}</p>
      <p class="pmeta">${esc(sku.unit_size || '')}${sku.brand_code ? ' · ' + esc(sku.brand_code) : ''}
      ${extra ? ' · ' + esc(extra) : ''}</p>
    </div></div>`;
}

/* A location code is what a person navigates by, so the rack letter and level
 * get the emphasis inside it. */
function bigCode(code) {
  if (!code) return '<p class="bigcode">—</p>';
  const parts = String(code).split('-');
  if (parts.length >= 3) {
    return `<p class="bigcode">${esc(parts[0])}-<span class="rack">${esc(parts[1])}-${esc(parts[2])}</span>${
      parts[3] ? '-' + esc(parts[3]) : ''}</p>`;
  }
  return `<p class="bigcode">${esc(code)}</p>`;
}

/* Tappable test barcodes: training must work with no physical stock. */
async function testBarcodes(container, onPick) {
  if (!state.site || !state.site.is_training) return;
  try {
    const sheet = await API.barcodeSheet(state.site.id, 24);
    if (!sheet.rows.length) return;
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<h2>${t('test_barcodes')}</h2>
      <div class="chips">${sheet.rows.map(r =>
        `<button class="chip" data-c="${esc(r.barcode)}" title="${esc(r.sku_name)}">
          ${esc(r.sku_name.slice(0, 22))}</button>`).join('')}</div>`;
    d.querySelectorAll('.chip').forEach(b =>
      b.onclick = () => onPick(b.dataset.c));
    container.appendChild(d);
  } catch { /* training-only nicety */ }
}

/* ---------- home ---------- */

routes.home = async (main) => {
  const tiles = [
    ['inbound',  'm_inbound',  'm_inbound_d'],
    ['pick',     'm_pick',     'm_pick_d'],
    ['opname',   'm_opname',   'm_opname_d'],
    ['label',    'm_label',    'm_label_d'],
    ['find',     'm_find',     'm_find_d'],
    ['rack',     'm_rack',     'm_rack_d'],
  ];
  if (state.site && state.site.is_training) tiles.push(['training', 'm_training', 'm_training_d']);

  main.innerHTML = `<h1 class="title">${t('home_title')}</h1>
    <p class="sub">${t('home_sub')} · ${esc(state.site ? state.site.name : '')}</p>
    <div class="menu">${tiles.map(([r, a, b]) =>
      `<button class="tile" onclick="location.hash='#/${r}'">
        <b>${t(a)}</b><i>${t(b)}</i></button>`).join('')}</div>`;
};

/* ---------- inbound ---------- */

routes.inbound = async (main) => {
  main.innerHTML = header(t('inbound_title')) + `
    <div class="rows">
      <button class="row" id="fromBrand"><div class="grow">
        <b>${t('inbound_from_brand')}</b><i>${t('inbound_from_brand_d')}</i></div></button>
      <button class="row" id="fromHub"><div class="grow">
        <b>${t('inbound_from_hub')}</b><i>${t('inbound_from_hub_d')}</i></div></button>
    </div>`;
  el('fromBrand').onclick = () => start('from_brand');
  el('fromHub').onclick = () => start('from_hub_transfer');

  async function start(sourceType) {
    if (sourceType === 'from_hub_transfer') {
      const ref = prompt('Scan / ketik kode transfer:');
      if (!ref) return;
      const r = await API.openReceipt({ site_id: state.site.id, source_type: sourceType,
                                        transfer_reference: ref });
      go(`#/receiving/${r.id}`);
      return;
    }
    const r = await API.openReceipt({ site_id: state.site.id, source_type: sourceType });
    go(`#/receiving/${r.id}`);
  }
};

routes.receiving = async (main, [id]) => {
  let total = 0, qty = 1;

  main.innerHTML = header(t('inbound_title')) + `
    <div id="result"></div>
    ${scanZone()}
    <div class="card"><h2>${t('qty')}</h2>
      <div class="stepper">
        <button id="minus" aria-label="-">−</button>
        <input id="qty" value="1" inputmode="numeric">
        <button id="plus" aria-label="+">+</button>
      </div></div>
    <div class="card"><h2>${t('session_total')}</h2>
      <p class="bigqty" id="total">0</p></div>
    <div class="btnrow">
      <button class="btn" id="finish">${t('finish_receipt')}</button>
    </div>
    <div id="extras"></div>`;

  const setQty = v => { qty = Math.max(1, v); el('qty').value = qty; };
  el('minus').onclick = () => setQty(qty - 1);
  el('plus').onclick = () => setQty(qty + 1);
  el('qty').onchange = e => setQty(parseInt(e.target.value, 10) || 1);

  const zone = el('zone');
  state.scanner = Scan.mount(zone, doScan);
  await testBarcodes(el('extras'), c => doScan(c));

  el('finish').onclick = async () => {
    const s = await API.receiptDone(id);
    main.innerHTML = header(t('inbound_title')) + `
      <div class="banner ok"><b>${t('done')}</b>${s.total_units} unit.</div>
      <div class="card"><h2>${t('done')}</h2><div class="tablewrap"><table>
        <thead><tr><th>Barang</th><th class="num">Terima</th></tr></thead>
        <tbody>${s.lines.map(l => `<tr><td>${esc(l.sku_name)}</td>
          <td class="num">${l.qty_received}</td></tr>`).join('')}</tbody>
      </table></div></div>
      <button class="btn" onclick="location.hash='#/home'">${t('done')}</button>`;
  };

  async function doScan(code) {
    try {
      const r = await API.receiptScan(id, { code, qty, idempotency_key: API.newKey() });
      const res = el('result');
      if (r.accepted) {
        total = r.session_total;
        el('total').textContent = total;
        state.scanner.state(r.outcome === 'over_capacity' ? 'warn' : 'ok');
        res.innerHTML = `<div class="card">
          ${productBlock(r.sku)}
          <p class="instruction" style="margin-top:1rem">${t('put_in')}</p>
          ${bigCode(r.location_code)}
          <p class="muted">${t('in_basket')}: <b>${r.qty_in_basket}</b></p>
          ${r.outcome === 'over_capacity'
            ? `<div class="banner warn" style="margin-top:.8rem">${esc(r.message)}</div>` : ''}
        </div>`;
        setQty(1);
      } else if (r.outcome === 'no_slot') {
        state.scanner.state('warn');
        res.innerHTML = `<div class="banner warn"><b>${t('no_slot')}</b>${esc(r.message)}</div>
          <div class="card">${productBlock(r.sku)}
            <div class="btnrow"><button class="btn" id="mk">${t('make_basket')}</button></div>
          </div>`;
        el('mk').onclick = async () => {
          const s = await API.slotSuggest({ site_id: state.site.id, sku_id: r.sku.id });
          if (!s.location_id) return toast('Tidak ada keranjang kosong.', true);
          await API.assignSlot({ site_id: state.site.id, sku_id: r.sku.id,
                                 created_during_inbound: true });
          toast(`Keranjang dibuat: ${s.location_code}`);
          doScan(code);
        };
      } else {
        state.scanner.state('bad');
        res.innerHTML = `<div class="banner bad"><b>${t('unknown_barcode')}</b>${esc(r.message)}</div>`;
      }
    } catch (e) {
      state.scanner.state('bad');
      el('result').innerHTML = `<div class="banner bad"><b>${esc(e.message)}</b></div>`;
    }
    state.scanner.focus();
  }
};

/* ---------- pick ---------- */

routes.pick = async (main) => {
  const { tasks } = await API.pickTasks({ site_id: state.site.id, status: 'ready' });
  main.innerHTML = header(t('pick_title')) + (tasks.length
    ? `<div class="rows">${tasks.map(x => `
        <button class="row" onclick="location.hash='#/picking/${x.id}'">
          <span class="code">${esc(x.external_ref)}</span>
          <div class="grow"><b>${x.lines.length} barang</b>
            <i>${x.lines.map(l => l.sku_name.slice(0, 18)).join(', ')}</i></div>
          ${x.is_test ? '<span class="tag warn">UJI</span>' : ''}
        </button>`).join('')}</div>`
    : `<div class="empty-state">${t('no_tasks')}</div>
       ${state.site.is_training
         ? `<button class="btn ghost" onclick="location.hash='#/training'">${t('m_training')}</button>` : ''}`);
};

routes.picking = async (main, [id]) => {
  let task = await API.claimTask(id);
  let idx = task.lines.findIndex(l => l.status === 'pending');

  function draw() {
    if (idx < 0 || idx >= task.lines.length) return finish();
    const line = task.lines[idx];
    main.innerHTML = header(t('pick_title'), task.external_ref) + `
      <p class="progress">${t('line_of', { a: idx + 1, b: task.lines.length })}</p>
      <div class="card">
        <p class="instruction">${t('go_to')}</p>
        ${bigCode(line.location_code)}
        <div style="margin:1rem 0">${productBlock({
          name_display: line.sku_name, photo_key: line.photo_key })}</div>
        <p class="instruction">${t('take')}</p>
        <p class="bigqty">${line.qty_required - line.qty_picked}</p>
      </div>
      <div id="result"></div>
      ${scanZone()}
      <div id="extras"></div>`;

    state.scanner = Scan.mount(el('zone'), code => confirm(line, code));
    testBarcodes(el('extras'), c => confirm(line, c));
  }

  async function confirm(line, code) {
    try {
      const r = await API.confirmPick(line.id, {
        code, qty: line.qty_required - line.qty_picked, idempotency_key: API.newKey(),
      });
      if (r.accepted) {
        state.scanner.state('ok');
        if (r.task_complete) return finish();
        task = await API.pickTasks({ site_id: state.site.id, status: 'claimed' })
          .then(x => x.tasks.find(y => y.id === +id) || task);
        idx = task.lines.findIndex(l => l.status === 'pending');
        draw();
      } else {
        state.scanner.state('bad');
        el('result').innerHTML = `<div class="stopscreen">
          <h2>${t('wrong_item')}</h2>
          <p style="margin:.2rem 0 0">${t('put_back')}</p>
          <div class="compare">
            <div class="wrong"><div class="lbl">${t('you_scanned')}</div>
              <b>${esc(r.scanned_sku_name || code)}</b></div>
            <div class="right"><div class="lbl">${t('order_wants')}</div>
              <b>${esc(r.expected_sku_name)}</b></div>
          </div></div>`;
        state.scanner.focus();
      }
    } catch (e) {
      state.scanner.state('bad');
      el('result').innerHTML = `<div class="banner bad"><b>${esc(e.message)}</b></div>`;
    }
  }

  async function finish() {
    await API.completeTask(id);
    main.innerHTML = `<div class="banner ok"><b>${t('order_done')}</b>${t('order_done_d')}</div>
      <button class="btn big" onclick="location.hash='#/pick'">${t('done')}</button>`;
  }

  draw();
};

/* ---------- opname ---------- */

routes.opname = async (main) => {
  const plan = await API.createPlan({ site_id: state.site.id, name: 'Hitung stok' });
  go(`#/counting/${plan.id}`);
};

routes.counting = async (main, [planId]) => {
  const d = await API.plan(planId);
  main.innerHTML = header(t('opname_title'), `${d.plan.counted} / ${d.plan.total_baskets}`) + `
    <p class="eyebrow">${t('pick_basket')}</p>
    <div class="rows">${d.baskets.map(b => {
      const busy = b.status === 'counting' && b.claimed_by && b.claimed_by !== state.me.email;
      const done = b.status === 'finished';
      return `<button class="row" ${busy || done ? 'disabled' : ''}
                data-b="${b.basket_id}">
        <span class="code">${esc(b.location_code)}</span>
        <div class="grow"><b>${esc(b.sku_name || '—')}</b>
          ${busy ? `<i>${t('counted_by', { who: esc(b.claimed_by) })}</i>` : ''}</div>
        ${done ? `<span class="tag ${b.variance ? 'bad' : 'ok'}">${
          b.variance ? (b.variance > 0 ? '+' : '') + b.variance : t('counted')}</span>` : ''}
      </button>`;
    }).join('')}</div>
    <div class="btnrow">
      <button class="btn ghost" id="report">${t('variance_report')}</button>
    </div>`;

  main.querySelectorAll('.row[data-b]').forEach(b => b.onclick = async () => {
    try {
      const s = await API.claimBasket({ plan_id: +planId, basket_id: +b.dataset.b });
      state.session = s;             // carries location, product and photo forward
      go(`#/count/${planId}/${s.id}`);
    } catch (e) { toast(e.message, true); }
  });

  el('report').onclick = () => go(`#/variance/${planId}`);
};

routes.count = async (main, [planId, sessionId]) => {
  let counted = 0;

  // Carried from the claim. On a page refresh mid-count, fall back to the plan.
  let session = state.session;
  if (!session || String(session.id) !== String(sessionId)) {
    const d = await API.plan(planId);
    session = d.baskets.find(b => b.status === 'counting'
      && b.claimed_by === state.me.email) || {};
  }

  main.innerHTML = header(t('opname_title')) + `
    <div class="card">
      <p class="instruction">${session.location_code || ''}</p>
      ${productBlock({ name_display: session.sku_name || '', photo_key: session.photo_key })}
      <p class="instruction" style="margin-top:1.2rem">${t('count_now')}</p>
      <p class="counter" id="cnt">0</p>
    </div>
    <div id="result"></div>
    ${scanZone()}
    <div class="btnrow">
      <button class="btn" id="fin">${t('finish_basket')}</button>
    </div>
    <div id="extras"></div>`;

  state.scanner = Scan.mount(el('zone'), doScan);
  await testBarcodes(el('extras'), c => doScan(c));

  async function doScan(code) {
    try {
      const r = await API.countScan(sessionId, { code, idempotency_key: API.newKey() });
      counted = r.qty_counted;
      el('cnt').textContent = counted;
      const kind = r.outcome === 'counted' ? 'ok' : 'warn';
      state.scanner.state(kind);
      el('result').innerHTML = r.outcome === 'counted' ? ''
        : `<div class="banner warn"><b>${esc(r.outcome)}</b>${esc(r.message)}</div>`;
    } catch (e) {
      state.scanner.state('bad');
      el('result').innerHTML = `<div class="banner bad"><b>${esc(e.message)}</b></div>`;
    }
    state.scanner.focus();
  }

  el('fin').onclick = async () => {
    const r = await API.finishCount(sessionId);
    const good = r.variance === 0;
    main.innerHTML = header(t('opname_title')) + `
      <div class="banner ${good ? 'ok' : 'warn'}">
        <b>${good ? t('match') : t('recount_q')}</b></div>
      <div class="card"><div class="tablewrap"><table>
        <tr><th>${t('expected')}</th><td class="num">${r.qty_expected}</td></tr>
        <tr><th>${t('count_now')}</th><td class="num">${r.qty_counted}</td></tr>
        <tr><th>${t('difference')}</th>
            <td class="num ${r.variance < 0 ? 'neg' : r.variance > 0 ? 'pos' : ''}">
            ${r.variance > 0 ? '+' : ''}${r.variance}</td></tr>
      </table></div>
      ${r.missing_plates && r.missing_plates.length
        ? `<p class="muted" style="margin-top:.8rem">Label hilang:
           <span class="mono">${r.missing_plates.slice(0, 8).map(esc).join(', ')}</span></p>` : ''}
      </div>
      <div class="btnrow">
        <button class="btn" onclick="location.hash='#/counting/${planId}'">${t('done')}</button>
      </div>`;
  };
};

routes.variance = async (main, [planId]) => {
  const r = await API.variance(planId);
  main.innerHTML = header(t('variance_report')) + (r.rows.length ? `
    <div class="card"><div class="tablewrap"><table>
      <thead><tr><th>Lokasi</th><th>Barang</th>
        <th class="num">${t('expected')}</th><th class="num">Hitung</th>
        <th class="num">${t('difference')}</th><th class="num">Rp</th></tr></thead>
      <tbody>${r.rows.map(x => `<tr>
        <td class="mono">${esc(x.location_code)}</td>
        <td>${esc(x.sku_name || '')}</td>
        <td class="num">${x.qty_expected}</td>
        <td class="num">${x.qty_counted}</td>
        <td class="num ${x.variance < 0 ? 'neg' : 'pos'}">${x.variance > 0 ? '+' : ''}${x.variance}</td>
        <td class="num">${x.value_idr.toLocaleString('id-ID')}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <p class="muted">Total ${r.total_variance_units} unit ·
      Rp ${r.total_variance_idr.toLocaleString('id-ID')}</p>`
    : `<div class="empty-state">${t('no_variance')}</div>`);
};

/* ---------- label (Mode B) ---------- */

routes.label = async (main) => {
  const [stock, skus] = await Promise.all([
    API.plateStock(state.site.id),
    API.skus({ limit: 200 }),
  ]);
  const modeB = skus.skus.filter(s => s.identity_mode === 'unit_label');

  main.innerHTML = header(t('label_title')) + `
    <div class="card"><h2>${t('plates_left')}</h2>
      <p class="bigqty ${stock.low ? 'neg' : ''}">${stock.unbound}</p>
      ${stock.low ? `<button class="btn ghost" id="issue">${t('issue_plates')}</button>` : ''}
    </div>
    <p class="eyebrow">${t('label_pick_sku')}</p>
    ${modeB.length ? `<div class="rows">${modeB.map(s =>
      `<button class="row" data-s="${s.id}"><div class="grow">
        <b>${esc(s.name_display)}</b><i>${esc(s.label_placement_note || '')}</i></div>
      </button>`).join('')}</div>`
      : `<div class="empty-state">Tidak ada barang tanpa barcode.</div>`}`;

  if (el('issue')) el('issue').onclick = async () => {
    await API.issuePlates({ site_id: state.site.id, count: 200 });
    toast('200 label dibuat.'); render();
  };
  main.querySelectorAll('.row[data-s]').forEach(b =>
    b.onclick = () => go(`#/labelling/${b.dataset.s}`));
};

routes.labelling = async (main, [skuId]) => {
  let n = 0;
  const skus = await API.skus({ limit: 500 });
  const sku = skus.skus.find(s => s.id === +skuId);

  main.innerHTML = header(t('label_title')) + `
    <div class="card">
      ${productBlock(sku)}
      ${sku.label_placement_note
        ? `<div class="banner info" style="margin-top:1rem">
             <b>${t('label_place')}</b>${esc(sku.label_placement_note)}</div>` : ''}
      <p class="instruction" style="margin-top:1rem">${t('labelled')}</p>
      <p class="counter" id="cnt">0</p>
    </div>
    <div id="result"></div>
    ${scanZone('Tempel label, lalu scan labelnya')}`;

  state.scanner = Scan.mount(el('zone'), async code => {
    try {
      const r = await API.bindPlate({ site_id: state.site.id, sku_id: +skuId,
                                      plate_code: code, idempotency_key: API.newKey() });
      if (r.accepted) {
        n++; el('cnt').textContent = n;
        state.scanner.state('ok');
        el('result').innerHTML = `<div class="card">
          <p class="instruction">${t('put_in')}</p>${bigCode(r.location_code)}</div>`;
      } else {
        state.scanner.state('bad');
        el('result').innerHTML = `<div class="banner bad"><b>${esc(r.outcome)}</b>${esc(r.message)}</div>`;
      }
    } catch (e) {
      state.scanner.state('bad');
      el('result').innerHTML = `<div class="banner bad"><b>${esc(e.message)}</b></div>`;
    }
    state.scanner.focus();
  });
};

/* ---------- find ---------- */

routes.find = async (main) => {
  main.innerHTML = header(t('find_title')) + `<div id="result"></div>${scanZone()}<div id="extras"></div>`;
  state.scanner = Scan.mount(el('zone'), lookup);
  await testBarcodes(el('extras'), lookup);

  async function lookup(code) {
    const r = await API.resolve(code, state.site.id);
    state.scanner.state(r.found ? 'ok' : 'bad');
    el('result').innerHTML = r.found ? `<div class="card">
        ${productBlock(r.sku)}
        <p class="instruction" style="margin-top:1rem">${t('found_at')}</p>
        ${bigCode(r.slot_location_code)}
        ${r.qty_on_hand != null
          ? `<p class="muted">${t('stock_here')}: <b>${r.qty_on_hand}</b></p>` : ''}
        ${r.plate_code ? `<p class="muted mono">${esc(r.plate_code)} · ${esc(r.plate_state)}</p>` : ''}
      </div>` : `<div class="banner bad"><b>${t('not_found')}</b>${esc(r.message || '')}</div>`;
    state.scanner.focus();
  }
};

/* ---------- rack map ---------- */

routes.rack = async (main) => {
  const m = await API.rackMap(state.site.id);
  main.innerHTML = header(t('rack_title'),
    `${m.slotted} ${t('occupied').toLowerCase()} · ${m.free} ${t('free').toLowerCase()}`) +
    m.racks.map(r => `<div class="rack">
      <div class="rackhead">RAK ${esc(r.code)}</div>
      ${r.levels.slice().reverse().map(lv => `<div class="level">
        <div class="levelno">${lv.level_no}</div>
        <div class="cells">${lv.positions.map(p => `
          <div class="cell ${p.state === 'occupied' ? 'occupied' : 'empty'}
               ${p.state === 'occupied' && p.qty_on_hand === 0 ? 'zero' : ''}
               ${p.expiry_tier === 'critical' ? 'critical' : ''}"
               title="${esc(p.code)} — ${esc(p.sku_name || 'kosong')}">
            <span class="cname">${esc(p.sku_name || '—')}</span>
            ${p.state === 'occupied' ? `<span class="cqty">${p.qty_on_hand}</span>` : ''}
          </div>`).join('')}</div>
      </div>`).join('')}
    </div>`).join('') + `
    <div class="legend">
      <span><i class="swatch" style="background:var(--surface)"></i>${t('occupied')}</span>
      <span><i class="swatch" style="background:var(--surface-2)"></i>${t('free')}</span>
      <span><i class="swatch" style="background:var(--stop-bg);border-color:var(--stop)"></i>${t('out')}</span>
    </div>`;
};

/* ---------- training ---------- */

routes.training = async (main) => {
  const { scenarios } = await API.scenarios();
  main.innerHTML = header(t('training_title')) + `
    <div class="card"><h2>${t('reset_site')}</h2>
      <p class="muted">${t('reset_site_d')}</p>
      <div class="btnrow">
        <button class="btn" id="reset">${t('reset_site')}</button>
        <button class="btn ghost" id="orders">${t('make_orders')}</button>
      </div></div>
    <p class="eyebrow">${t('load_scenario')}</p>
    <div class="rows">${scenarios.map(s => `
      <button class="row" data-k="${esc(s.key)}"><div class="grow">
        <b>${esc(I18N.get() === 'id' ? s.name_id : s.name_en)}</b><i>${esc(s.teaches)}</i></div>
        <span class="tag">${esc(s.key)}</span></button>`).join('')}</div>
    <div id="fixture"></div>`;

  el('reset').onclick = async () => {
    const r = await API.trainingReset({ site_id: state.site.id });
    toast(r.message);
  };
  el('orders').onclick = async () => {
    const r = await API.genOrders({ site_id: state.site.id, count: 2 });
    toast(r.message);
  };
  main.querySelectorAll('.row[data-k]').forEach(b => b.onclick = async () => {
    const r = await API.trainingLoad({ site_id: state.site.id, scenario: b.dataset.k });
    el('fixture').innerHTML = `<div class="card"><h2>${t('answer_key')}</h2>
      <pre class="mono" style="white-space:pre-wrap;font-size:.8rem;margin:0">${
        esc(JSON.stringify(r.fixture, null, 2))}</pre></div>`;
    toast(r.message);
  });
};

/* ---------- boot ---------- */

(async () => {
  try {
    state.me = await API.me();
  } catch (e) {
    el('main').innerHTML = `<div class="banner bad">
      <b>${esc(e.message)}</b>${e.status === 403
        ? 'Minta admin mendaftarkan akun Anda.' : ''}</div>`;
    return;
  }
  const saved = +localStorage.getItem('wms.site');
  state.me.locale && I18N.set(localStorage.getItem('wms.lang') || state.me.locale);
  state.site = state.me.sites.find(s => s.id === saved)
    || state.me.sites.find(s => s.id === state.me.default_site_id)
    || state.me.sites[0];
  render();
})();
