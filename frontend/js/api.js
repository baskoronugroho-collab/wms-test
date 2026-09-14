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
  const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });
  const del = (p) => req(p, { method: 'DELETE' });
  const qs = (o) => {
    const s = new URLSearchParams();
    Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, v); });
    const out = s.toString();
    return out ? '?' + out : '';
  };

  NJW.api = {
    raw: { get, post, patch, put, del, qs },

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
    // Queue board: waiting / picking / done lanes, each card with channel,
    // delivery mode, promised_at, remaining_seconds and urgency.
    pickBoard: (p) => get('/pick-tasks/board' + qs(p)),
    // Returns a claimed task to status 'ready' and clears claimed_by.
    // Supervisor-gated server-side.
    releasePickTask: (id) => post('/pick-tasks/' + id + '/release', {}),
    opnamePlans: (p) => get('/opname/plans' + qs(p)),

    // --- SKU & rack registry ---------------------------------------------
    // One rack face per SKU plus an optional overflow, a full threshold (new
    // stock starts going to overflow) and a restock point (everything held is
    // low: ask for more). There is no replenishment task: the picker is sent to
    // whichever of rack/overflow holds the older stock.
    registry: (p) => get('/registry' + qs(p)),                   // {site_id,q,...}
    updateRegistry: (skuId, b) => put('/registry/' + skuId, b),  // RegistryIn
    bulkRegistry: (b) => post('/registry/bulk', b),
    suggestSlot: (skuId, p) => get('/registry/suggest/' + skuId + qs(p)),
    restockRequests: (p) => get('/restock' + qs(p)),             // {site_id,status}
    sendRestock: (id) => post('/restock/' + id + '/send', {}),
    lowStock: (p) => get('/inventory/low-stock' + qs(p)),
    findStock: (p) => get('/inventory/find' + qs(p)),
    movements: (p) => get('/movements' + qs(p)),

    // --- hub transfers --------------------------------------------------
    // Frozen pending the restocking model (supplier -> CWH -> dark store),
    // which sits outside the canonical design; the WMS takes over at inbound.
    transfers: (p) => get('/transfers' + qs(p)),
    createTransfer: (b) => post('/transfers', b),

    // --- Hiryu boundary -------------------------------------------------
    // Five messages. The WMS never calls Grab; only Hiryu talks to the WMS.
    // `mode` is server-owned — a client must never be able to make this look
    // connected while the boundary is deliberately closed.
    outbox: (p) => get('/pos/outbox' + qs(p)),
    cancelOrder: (ref, b) => post('/orders/' + encodeURIComponent(ref) + '/cancel', b || {}),

    // --- short pick -----------------------------------------------------
    shortPick: (lineId, b) => post('/pick-lines/' + lineId + '/short', b),
    shortfalls: (p) => get('/shortfalls' + qs(p)),

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
