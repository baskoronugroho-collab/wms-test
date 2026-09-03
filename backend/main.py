"""Ninja Kilat WMS — backend.

Substrait upload-mode contract: listens on 8000, serves GET /health, and serves
its API under /api. All DDL lives in Flyway migrations; nothing here creates a
table.

Layout:
  db.py       connection pool and transaction helper
  auth.py     SSO identity, roles, site scoping, the training-site guard
  ledger.py   the ONLY writer of inventory_balances; append-only movements
  common.py   the three questions every flow asks
  routers/    one module per PRD module (M1-M8)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

import auth
import db
import models
from routers import (
    inbound,
    inventory,
    locations,
    master,
    opname,
    outbound,
    plates,
    scan,
    training,
)

log = logging.getLogger("wms")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(
    title="Ninja Kilat WMS",
    version="0.1.0",
    description=(
        "Warehouse management for Ninja Van's GrabMart Kilat fulfilment: inbound "
        "and putaway, guided picking, weekly stock opname, barcode and "
        "license-plate registration, and an isolated training mode."
    ),
    lifespan=lifespan,
)


INDEX_HTML = """<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ninja Kilat WMS</title>
<style>
  :root{
    --paper:#f4f4f2; --surface:#fff; --ink:#17181a; --ink-2:#5e6064;
    --rule:#dedcd8; --action:#1b3a5c; --accept:#127a45; --stop:#c01d22;
  }
  @media (prefers-color-scheme: dark){
    :root{ --paper:#131416; --surface:#1c1d20; --ink:#f0efec; --ink-2:#a8a7a3;
           --rule:#2f3034; --action:#5e9bd1; --accept:#42c182; --stop:#f2545b; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;}
  .wrap{max-width:720px;margin:0 auto;padding:3rem 1.25rem 4rem}
  .eyebrow{font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--ink-2);margin:0 0 .5rem}
  h1{font-size:1.9rem;line-height:1.15;letter-spacing:-.02em;margin:0 0 .4rem}
  .lede{color:var(--ink-2);margin:0 0 2rem}
  .card{background:var(--surface);border:1px solid var(--rule);
    border-radius:4px;padding:1.1rem 1.25rem;margin-bottom:1rem}
  .card h2{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink-2);margin:0 0 .7rem;font-weight:600}
  dl{display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:0;
    font-size:.9rem}
  dt{color:var(--ink-2)}
  dd{margin:0;font-variant-numeric:tabular-nums}
  code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.86em;
    background:var(--paper);padding:.1em .35em;border-radius:3px}
  a.btn{display:inline-block;background:var(--action);color:#fff;
    text-decoration:none;padding:.65rem 1.1rem;border-radius:4px;
    font-size:.92rem;font-weight:500}
  a.btn:hover{opacity:.9}
  ul{margin:.2rem 0 0;padding-left:1.1rem;font-size:.9rem;color:var(--ink-2)}
  li{margin-bottom:.3rem}
  .ok{color:var(--accept);font-weight:600}
  .warn{color:var(--stop);font-weight:600}
  .note{font-size:.85rem;color:var(--ink-2);margin-top:1.6rem;
    padding-top:1.1rem;border-top:1px solid var(--rule)}
</style>
</head>
<body>
<div class="wrap">
  <p class="eyebrow">Ninja Van &middot; GrabMart Kilat</p>
  <h1>Kilat WMS &mdash; API</h1>
  <p class="lede">Backend is running. The staff interface is not deployed yet,
     so there is no app to open here.</p>

  <div class="card">
    <h2>Status</h2>
    <dl>
      <dt>Service</dt><dd><span class="ok">running</span></dd>
      <dt>Database</dt><dd id="db">checking&hellip;</dd>
      <dt>Signed in as</dt><dd id="who">checking&hellip;</dd>
      <dt>Role</dt><dd id="role">&mdash;</dd>
      <dt>Sites</dt><dd id="sites">&mdash;</dd>
    </dl>
  </div>

  <div class="card">
    <h2>Try it</h2>
    <p style="margin:0 0 .9rem;font-size:.9rem;color:var(--ink-2)">
      Every endpoint is documented and callable from the browser, signed in as you.</p>
    <a class="btn" href="/docs">Open the API docs</a>
    <ul style="margin-top:1rem">
      <li><code>POST /api/training/reset</code> &mdash; restore the training site
          (<code>site_id: 99</code>) to a known state</li>
      <li><code>POST /api/training/load</code> &mdash; load a scenario:
          <code>variance</code>, <code>short_pick</code>, <code>wrong_shade</code>,
          <code>mode_b</code></li>
      <li><code>GET /api/training/barcode-sheet</code> &mdash; printable test
          barcodes, so you can scan with no stock</li>
      <li><code>GET /api/inventory?site_id=99</code> &mdash; what is on the shelves</li>
    </ul>
  </div>

  <p class="note">
    Training routes refuse any site that is not flagged as a training site, so
    nothing here can touch real stock. POS pushes are suppressed
    (<code>POS_PUSH_ENABLED=false</code>) until stock-number ownership is agreed,
    so nothing reaches Grab.
  </p>
</div>
<script>
(async () => {
  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    el.textContent = text;
    if (cls) el.className = cls;
  };
  try {
    const h = await fetch('/health').then(r => r.json());
    set('db', h.database ? 'connected' : 'not connected',
        h.database ? 'ok' : 'warn');
  } catch { set('db', 'unreachable', 'warn'); }
  try {
    const r = await fetch('/api/me');
    if (!r.ok) throw new Error(r.status);
    const me = await r.json();
    set('who', me.email);
    set('role', me.role);
    set('sites', me.sites.map(s => s.code + (s.is_training ? ' (latihan)' : ''))
                          .join(', ') || 'none');
  } catch (e) {
    set('who', 'not recognised \\u2014 ask an admin to add you', 'warn');
  }
})();
</script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index():
    """A landing page for the root path.

    With no `frontend/` shipped, Substrait routes every path to this backend —
    so without this, `/` returns the API's own 404 and the app looks broken to
    anyone who opens the URL. Replace this with the real frontend once the
    design is imported.
    """
    return INDEX_HTML


@app.get("/health", response_model=models.Health, tags=["platform"])
def health():
    """Readiness probe.

    Reports database state without failing on it: a database blip should show up
    in the payload, not take the pod out of rotation on its own.
    """
    return {"status": "ok", "database": db.ready()}


@app.get("/api/me", response_model=models.Me, tags=["platform"])
async def whoami(user: auth.User = Depends(auth.current_user)):
    """The frontend asks "who am I?" here — the browser never sees the SSO headers."""
    if user.at_least("admin"):
        sites = await db.fetch_all(
            "SELECT id, code, name, site_type, is_training FROM sites "
            "WHERE active = 1 ORDER BY is_training, code"
        )
    else:
        sites = await db.fetch_all(
            "SELECT s.id, s.code, s.name, s.site_type, s.is_training FROM sites s "
            "JOIN user_sites us ON us.site_id = s.id "
            "WHERE us.user_id = %s AND s.active = 1 ORDER BY s.is_training, s.code",
            (user.id,),
        )
    return {
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "locale": user.locale,
        "default_site_id": user.default_site_id,
        "sites": [dict(s, is_training=bool(s["is_training"])) for s in sites],
    }


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Never leak a stack trace onto a station laptop.

    The staffer gets one plain sentence they can act on; the detail goes to the
    logs where a supervisor or a developer can find it.
    """
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Sistem sedang bermasalah. Panggil supervisor."},
    )


for module in (
    master, locations, scan, inbound, plates, outbound, opname, inventory, training
):
    app.include_router(module.router)
