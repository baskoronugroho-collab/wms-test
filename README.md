# Ninja Kilat WMS

Warehouse management for Ninja Van's GrabMart Kilat quick-commerce fulfilment.
Sits underneath the Hiryu POS as the physical-inventory layer: inbound and
putaway, guided picking, weekly stock opname, barcode and license-plate
registration, and an isolated training mode.

Deploys on **Substrait** (upload mode): FastAPI backend on port 8000 serving
`/health` and `/api`, OceanBase (MySQL wire), Flyway migrations, object storage
for photos, Google SSO for identity.

| Document | What it is |
|---|---|
| [PRD.md](PRD.md) | Product requirements — 8 modules, 28 flagged exceptions, 16 open questions |
| [DESIGN-BRIEF.md](DESIGN-BRIEF.md) | Design brief + a paste-ready Claude Design prompt |
| [FEATURE-RESEARCH.md](FEATURE-RESEARCH.md) | Independent feature-gap research against the PRD |

## Status

- **Backend — built.** 46 endpoints, 49 operations, 73 typed response schemas.
  Schema, ledger, auth, all seven operational modules, and training mode.
- **Frontend — not started.** The design lives in a Claude Design project and
  has not been imported yet (see *Importing the design* below).
- **POS integration — blocked** on who owns the stock number (PRD §9.1).
  `POS_PUSH_ENABLED` defaults to `false`, so the app runs in shadow mode.

## Running locally

```bash
docker compose up -d db && docker compose run --rm migrate
```

```bash
cd backend && pip install -r requirements.txt
```

```bash
cd backend && ALLOW_ANONYMOUS_DEV=true DATABASE_URL="mysql://root:root@localhost:3306/wms" uvicorn main:app --reload
```

Then open <http://localhost:8000/docs> for the interactive API, or run the
end-to-end smoke test:

```bash
python tools/smoke_test.py
```

`ALLOW_ANONYMOUS_DEV=true` is what makes local dev possible without SSO. It
resolves every request to `DEV_USER_EMAIL`. **It must be false anywhere
deployed** — with SSO off, the auth proxy is not there to strip forged headers.

## What the seed data gives you

`V2__seed_reference.sql` is generated from the real Wardah SKU list by
`tools/gen_seed_migration.py`. It creates:

- **108 real Wardah SKUs** with real names, categories, prices and unit cubes —
  including the 54 near-identical lip shades that are the whole reason the pick
  scan gate exists
- **A synthetic EAN-13 per SKU**, in the `299` internal-use prefix so it can
  never collide with a real manufacturer GTIN. These make scanning testable
  without physical stock.
- **A second brand in Mode B** (unbarcoded) to exercise license plates
- **The eight real sites** from the station register, plus `MAC-TRN`, the
  training site: 7 racks × 5 levels, 103 baskets, 55 units in each

## Training mode

A full, isolated copy of the warehouse that behaves exactly like the real one and
touches nothing real. Every training route refuses a non-training site on the
site's own flag — a reset on a live station is impossible, not merely
discouraged.

```
POST /api/training/reset     site -> a known state, deterministically
POST /api/training/load      load a named scenario
GET  /api/training/scenarios the fixture library
```

Scenarios: `clean`, `variance`, `short_pick`, `wrong_shade`, `unknown_barcode`,
`no_slot`, `mode_b`, `contention`.

Test orders go through `POST /api/pos/orders` — the same endpoint the real POS
will use — so switching to live Hiryu is configuration, not a rewrite.

## Architecture notes

**The ledger is the point.** `stock_movements` is append-only and
`inventory_balances` is a projection of it. `ledger.py` is the only module that
writes a balance, and every balance change writes a movement in the same
transaction. Anything else would make "where did this stock go" unanswerable,
and that question is the reason the system exists.

**Two identity modes, one interaction.** Mode A resolves a brand's barcode to a
SKU and tracks quantities. Mode B resolves a Ninja license plate to one physical
unit. `GET /api/scan/resolve` takes whatever the scanner produced and decides
which it was, so a staffer moving between brands sees the same screens.

**One basket, one SKU** — enforced by unique constraint, not convention. It
collapses an enormous amount of complexity: counting a basket is counting one
number.

**MySQL reality shaped the schema.** No partial indexes, no ENUM, no CHECK, no
`ON DELETE CASCADE`, and no adding a column and a foreign key in one `ALTER`.
The last two are OceanBase gotchas, and a failed migration blocks every later
deploy until it is repaired.

## Importing the design

The design lives in a Claude Design project. To pull it into this repo, run
this once from an interactive Claude Code terminal on the machine:

```bash
/design-login
```

That authorizes the DesignSync tool, after which the project's files can be read
and written directly.

## Deploying

```bash
/substrait:deploy
```

Set real values for `POS_WEBHOOK_URL` and `POS_SHARED_SECRET` in the portal, or
with `/substrait:env`. Enable Google SSO on the app's Access tab — the app has
no login page of its own and reads `X-Forwarded-Email`.
