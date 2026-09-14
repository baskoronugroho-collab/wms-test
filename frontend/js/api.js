/* api.js — every endpoint the console and station talk to, in one place.
   Relative /api paths only: one ingress host routes /api to the backend.

   This is the thin, mergeable wiring layer. Screens read values into
   [data-field="..."] nodes and re-render [data-region="..."] blocks; nothing
   in the markup knows about fetch. */
(function () {
  window.NJW = window.NJW || {};

  const BASE = '/api';

  async function req(path, opts) {
    const r = await fetch(BASE + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }, opts || {}));
    if (!r.ok) {
      let detail = r.statusText;
      try { detail = (await r.json()).detail || detail; } catch (e) {}
      const err = new Error(detail);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  const get = (p) => req(p);
  const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
  const patch = (p, body) => req(p, { method: 'PATCH', body: JSON.stringify(body) });
  const qs = (o) => {
    const s = new URLSearchParams();
    Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
    const out = s.toString();
    return out ? '?' + out : '';
  };

  NJW.api = {
    raw: { get, post, patch, qs },

    me: () => get('/me'),
    health: () => get('/health'),

    // --- admin ---------------------------------------------------------
    users: () => get('/admin/users'),                       // {users, roles}
    createUser: (b) => post('/admin/users', b),             // AdminUserIn
    updateUser: (id, b) => patch('/admin/users/' + id, b),  // AdminUserPatch
    sites: () => get('/admin/sites'),                       // {sites:[SiteAdmin]}
    updateSite: (id, b) => patch('/admin/sites/' + id, b),  // SitePatch

    // --- product master ------------------------------------------------
    brands: () => get('/brands'),
    skus: (p) => get('/skus' + qs(p)),                      // {brand_id,q,limit,offset}
    createSku: (b) => post('/skus', b),
    checkBarcode: (p) => get('/barcodes/check' + qs(p)),    // {barcode,sku_id}
    registerBarcodes: (b) => post('/barcodes/register', b), // {sku_id,barcodes[]}

    // --- slips + day colour --------------------------------------------
    dayColors: () => get('/day-colors'),                    // {today,week,note}
    slips: (p) => get('/putaway-slips' + qs(p)),            // {site_id,limit}
    slip: (id) => get('/putaway-slips/' + id),
    receiptSlip: (rid) => get('/receipts/' + rid + '/putaway-slip'),

    // --- inventory / opname / picking ----------------------------------
    inventory: (p) => get('/inventory' + qs(p)),
    rackMap: (siteId) => get('/sites/' + siteId + '/rack-map'),
    pickTasks: (p) => get('/pick-tasks' + qs(p)),
    // Being added for the queue board: returns a claimed task to status
    // 'ready' and clears claimed_by. Supervisor-gated server-side.
    releasePickTask: (id) => post('/pick-tasks/' + id + '/release', {}),
    opnamePlans: (p) => get('/opname/plans' + qs(p)),

    // --- slotting, replenishment, restock (v3) --------------------------
    // One pick face per SKU plus an optional overflow, and three thresholds:
    // full (start using overflow), low (raise a replenishment task) and the
    // restock point (ask the hub). Only full and low measure the pick face.
    slotting: (p) => get('/slotting' + qs(p)),
    updateSlot: (skuId, b) => patch('/slotting/' + skuId, b),
    bulkSlot: (b) => post('/slotting/bulk', b),
    replenishTasks: (p) => get('/replenishment/tasks' + qs(p)),
    completeReplenish: (id, b) => post('/replenishment/tasks/' + id + '/complete', b),
    restockRequests: (p) => get('/restock/requests' + qs(p)),
    updateRestock: (id, b) => patch('/restock/requests/' + id, b),
    sendRestock: (id) => post('/restock/requests/' + id + '/send', {}),

    // --- hub transfers (v3) ---------------------------------------------
    transfers: (p) => get('/transfers' + qs(p)),
    createTransfer: (b) => post('/transfers', b),
    scanIntoTransfer: (id, b) => post('/transfers/' + id + '/scan', b),
    sealTransfer: (id) => post('/transfers/' + id + '/seal', {}),
    raiseTransferVariance: (id, b) => post('/transfers/' + id + '/raise', b),

    // --- POS integration (v3) -------------------------------------------
    // Five message types. The WMS never calls Grab; the POS owns that.
    // `mode` is server-owned — a client must never be able to make this
    // look connected while the boundary is deliberately closed.
    integrationHealth: () => get('/integration/health'),

    // --- short pick (v3) -------------------------------------------------
    shortPick: (taskId, b) => post('/pick-tasks/' + taskId + '/short', b),
    locationBatches: (code) => get('/inventory/' + code + '/batches'),

    // --- training / Grab simulator -------------------------------------
    // Training sites ONLY. Gate the UI on site.is_training before calling.
    generateOrders: (b) => post('/training/orders/generate', b), // {site_id,count,max_lines}
    composeOrder: (b) => post('/training/orders/compose', b),    // {site_id,lines[],external_ref}
    testOrders: (p) => get('/training/orders' + qs(p)),          // {site_id}
    scenarios: () => get('/training/scenarios'),
    resetTraining: (b) => post('/training/reset', b),            // {site_id,scenario}
  };

  /* Product photos.
     Every <img> ships with placeholder.svg as its src and the SKU's key in
     data-photo-key, so an unsourced photo costs nothing at runtime. Point
     PHOTO_BASE at wherever the real files land and call paintPhotos() after
     any render.

     Spec: 1:1, at least 800x800, product centred on a white ground, no crop
     (the CSS uses object-fit: contain). Filename is the lowercase SKU code —
     wdh-gll-07.jpg. For 118 near-identical Wardah shades this image is the
     primary disambiguator, so a wrong photo is worse than none. */
  NJW.PHOTO_BASE = null;   // e.g. '/media/skus/'
  NJW.paintPhotos = function (root) {
    if (!NJW.PHOTO_BASE) return;
    (root || document).querySelectorAll('img[data-photo-key]').forEach(img => {
      const url = NJW.PHOTO_BASE + img.dataset.photoKey + '.jpg';
      img.onerror = () => { img.onerror = null; img.src = img.src.replace(/[^/]+$/, 'placeholder.svg'); };
      img.src = url;
    });
  };

  /* Formatting helpers. Indonesian locale: 1.234 thousands, comma decimal. */
  /* The server stores and returns UTC, usually without a zone suffix
     ("2026-09-14 09:24:34"). A bare string like that would be read as the
     browser's local time, so anything with a clock and no zone is UTC.
     A plain date ("2026-09-14") stays a calendar date. */
  NJW.toDate = (iso) => {
    if (!iso) return null;
    if (iso instanceof Date) return iso;
    const s = String(iso);
    if (s.length <= 10) return new Date(s + 'T00:00:00');
    const t = s.replace(' ', 'T');
    return new Date(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : t + 'Z');
  };

  NJW.fmt = {
    n: (v) => (v == null ? '—' : Number(v).toLocaleString('id-ID')),
    idr: (v) => (v == null ? '—' : 'Rp ' + Number(v).toLocaleString('id-ID')),
    date: (iso) => {
      if (!iso) return '—';
      return NJW.toDate(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    },
    time: (iso) => (iso ? NJW.toDate(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'),
    /* Hours left in the 24-hour inbound discrepancy window. */
    hoursLeft: (deadlineIso) => {
      if (!deadlineIso) return null;
      return Math.max(0, Math.round((NJW.toDate(deadlineIso) - Date.now()) / 36e5));
    },
  };
})();
