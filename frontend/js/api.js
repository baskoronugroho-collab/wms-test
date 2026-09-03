/* Same-origin API client. The ingress routes /api to the backend, so every
 * call is a relative path — no absolute URL is ever baked in.
 *
 * The app is online-only by design (PRD §5.2): a dropped connection blocks the
 * screen and retries rather than queueing locally. Every scan carries an
 * idempotency key so a retry after an ambiguous timeout cannot double-count.
 */
const API = (() => {
  let online = true;
  const listeners = [];

  function setOnline(v) {
    if (online !== v) { online = v; listeners.forEach(f => f(v)); }
  }

  async function call(method, path, body) {
    try {
      const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      setOnline(true);

      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (!res.ok) {
        const err = new Error((data && data.detail) || `HTTP ${res.status}`);
        err.status = res.status;
        err.detail = (data && data.detail) || null;
        throw err;
      }
      return data;
    } catch (e) {
      if (e instanceof TypeError) {           // network-level failure
        setOnline(false);
        const err = new Error('Koneksi terputus.');
        err.offline = true;
        throw err;
      }
      throw e;
    }
  }

  const qs = o => Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // A fresh key per scan attempt, reused when the SAME attempt is retried.
  const key = () => (crypto.randomUUID ? crypto.randomUUID()
                                       : String(Date.now() + Math.random()));

  return {
    onConnectionChange: f => listeners.push(f),
    isOnline: () => online,
    newKey: key,

    me:            ()                 => call('GET', '/me'),
    sites:         ()                 => call('GET', '/sites'),
    resolve:       (code, siteId)     => call('GET', `/scan/resolve?${qs({ code, site_id: siteId })}`),
    skus:          (o = {})           => call('GET', `/skus?${qs(o)}`),
    inventory:     (o)                => call('GET', `/inventory?${qs(o)}`),
    lowStock:      (o)                => call('GET', `/inventory/low-stock?${qs(o)}`),
    rackMap:       (siteId)           => call('GET', `/sites/${siteId}/rack-map`),

    openReceipt:   (b)                => call('POST', '/receipts', b),
    receiptScan:   (id, b)            => call('POST', `/receipts/${id}/scan`, b),
    receiptDone:   (id)               => call('POST', `/receipts/${id}/complete`),

    pickTasks:     (o)                => call('GET', `/pick-tasks?${qs(o)}`),
    claimTask:     (id)               => call('POST', `/pick-tasks/${id}/claim`),
    confirmPick:   (id, b)            => call('POST', `/pick-lines/${id}/confirm`, b),
    completeTask:  (id)               => call('POST', `/pick-tasks/${id}/complete`),

    createPlan:    (b)                => call('POST', '/opname/plans', b),
    plan:          (id)               => call('GET', `/opname/plans/${id}`),
    claimBasket:   (b)                => call('POST', '/opname/sessions', b),
    countScan:     (id, b)            => call('POST', `/opname/sessions/${id}/scan`, b),
    finishCount:   (id, b)            => call('POST', `/opname/sessions/${id}/finish`, b || {}),
    variance:      (id)               => call('GET', `/opname/plans/${id}/variance-report`),
    approve:       (b)                => call('POST', '/opname/adjustments/approve', b),

    plateStock:    (siteId)           => call('GET', `/plates/stock?${qs({ site_id: siteId })}`),
    issuePlates:   (b)                => call('POST', '/plates/ranges', b),
    bindPlate:     (b)                => call('POST', '/plates/bind', b),

    slotSuggest:   (o)                => call('GET', `/slots/suggest?${qs(o)}`),
    assignSlot:    (b)                => call('POST', '/slots', b),
    registerCodes: (b)                => call('POST', '/barcodes/register', b),

    scenarios:     ()                 => call('GET', '/training/scenarios'),
    trainingReset: (b)                => call('POST', '/training/reset', b),
    trainingLoad:  (b)                => call('POST', '/training/load', b),
    genOrders:     (b)                => call('POST', '/training/orders/generate', b),
    barcodeSheet:  (siteId, limit)    => call('GET', `/training/barcode-sheet?${qs({ site_id: siteId, limit })}`),
  };
})();
