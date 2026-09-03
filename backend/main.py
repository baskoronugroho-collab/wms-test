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
from fastapi.responses import JSONResponse

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
