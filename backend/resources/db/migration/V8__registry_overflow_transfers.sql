-- v2 operating model: one pick face plus overflow, three thresholds, a hub that
-- dispatches, and the remaining POS messages.
--
-- The blocking change is the first one. V1 declared
--   UNIQUE KEY uq_slot_site_sku (site_id, sku_id)
-- which permits exactly one basket per SKU per site and therefore makes overflow
-- impossible to represent at all. The guarantee worth keeping is narrower than
-- that: one *pick face* per SKU. Roles express it precisely.
--
-- OceanBase note: every statement below is a single logical change. No ALTER adds
-- a column and its foreign key together, and there are no self-referencing
-- cascades — the two shapes OceanBase rejects (deploy-contract.md).

-- --------------------------------------------------------------------------
-- 1. Slot registry: role + the three thresholds
-- --------------------------------------------------------------------------

ALTER TABLE slot_assignments ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'primary';

-- Units at which the pick face is considered full and surplus goes to overflow.
ALTER TABLE slot_assignments ADD COLUMN full_threshold INT NULL;

-- Units at which a replenishment task is raised. Measured on the PICK FACE only:
-- primary empty with overflow full still totals healthy, and the picker walks up
-- to a bare rack — the exact failure overflow exists to prevent.
ALTER TABLE slot_assignments ADD COLUMN low_threshold INT NULL;

-- Units across primary + overflow at which the hub is asked for more. The only
-- threshold that counts everything held.
ALTER TABLE slot_assignments ADD COLUMN restock_point INT NULL;

ALTER TABLE slot_assignments DROP INDEX uq_slot_site_sku;

-- One pick face per SKU per site, and at most one overflow beside it.
ALTER TABLE slot_assignments ADD UNIQUE KEY uq_slot_site_sku_role (site_id, sku_id, role);

-- --------------------------------------------------------------------------
-- 2. Day colour recorded per movement
-- --------------------------------------------------------------------------

-- So the pick screen can say "take the Wednesday colour first". This does not
-- track units — Mode A holds a quantity — it records which colours entered a
-- location and when, which is enough to name the oldest one present.
ALTER TABLE stock_movements ADD COLUMN day_color_key VARCHAR(16) NULL;

-- --------------------------------------------------------------------------
-- 3. Transfers: the Logos -> darkstore hop
-- --------------------------------------------------------------------------

-- The dispatch quantity is what makes hop 2 checkable even when the brand sends
-- no manifest, so it has to survive independently of the receipt that consumes it.
ALTER TABLE transfer_lines ADD COLUMN qty_dispatched INT NOT NULL DEFAULT 0;
ALTER TABLE transfers ADD COLUMN dispatched_by VARCHAR(255) NULL;
ALTER TABLE transfers ADD COLUMN note VARCHAR(400) NULL;

-- --------------------------------------------------------------------------
-- 4. Replenishment and restock tasks
-- --------------------------------------------------------------------------

CREATE TABLE replenishment_tasks (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    site_id       BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    from_location_id BIGINT   NULL,
    to_location_id   BIGINT   NOT NULL,
    qty_suggested INT         NOT NULL,
    qty_moved     INT         NOT NULL DEFAULT 0,
    -- open | claimed | done | cancelled
    status        VARCHAR(32) NOT NULL DEFAULT 'open',
    claimed_by    VARCHAR(255) NULL,
    claimed_at    DATETIME    NULL,
    completed_at  DATETIME    NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- One OPEN task per SKU per site — raising a second while the first is
    -- outstanding would have two people walk to the same rack. Enforced in the
    -- service, not here: a unique key on (site, sku, status) would also permit
    -- only one *completed* task per SKU and so block the history after the
    -- second replenishment. MySQL has no partial index to express "unique only
    -- while open".
    KEY ix_replen_site_status (site_id, status, created_at),
    KEY ix_replen_sku (site_id, sku_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE restock_requests (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    site_id       BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    qty_suggested INT         NOT NULL,
    qty_requested INT         NULL,
    -- open | sent | fulfilled | cancelled
    status        VARCHAR(32) NOT NULL DEFAULT 'open',
    raised_by     VARCHAR(255) NULL,
    sent_at       DATETIME    NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_restock_site_status (site_id, status, created_at)
) DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------------------------
-- 5. The POS outbox carries all five messages, not just stock
-- --------------------------------------------------------------------------

-- v1's pos_outbox held only stock levels. Order ready, order short and order
-- cancelled travel the same durable path, so they share the table and gain a
-- type. Order events are latency-critical and stock is not, which is what the
-- priority column exists to express — a stock sync behind two hundred updates is
-- fine; an order-ready behind them costs a delivery.
ALTER TABLE pos_outbox ADD COLUMN message_type VARCHAR(32) NOT NULL DEFAULT 'stock_level';
ALTER TABLE pos_outbox ADD COLUMN priority TINYINT NOT NULL DEFAULT 5;
ALTER TABLE pos_outbox ADD COLUMN payload_json TEXT NULL;
ALTER TABLE pos_outbox ADD COLUMN order_ref VARCHAR(64) NULL;
ALTER TABLE pos_outbox ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER TABLE pos_outbox ADD COLUMN last_error VARCHAR(400) NULL;

CREATE INDEX ix_outbox_dispatch ON pos_outbox (status, priority, id);

-- --------------------------------------------------------------------------
-- 6. Short pick
-- --------------------------------------------------------------------------

CREATE TABLE pick_shortfalls (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    pick_line_id  BIGINT      NOT NULL,
    site_id       BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    qty_required  INT         NOT NULL,
    qty_found     INT         NOT NULL,
    declared_by   VARCHAR(255) NULL,
    -- open | reviewed
    status        VARCHAR(32) NOT NULL DEFAULT 'open',
    reviewed_by   VARCHAR(255) NULL,
    reviewed_at   DATETIME    NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_shortfall_line (pick_line_id),
    KEY ix_shortfall_site (site_id, status, created_at),
    -- Repeat declarations by one person must be visible to a supervisor
    -- (PRD 8.9.5): a staffer can zero a SKU with two taps.
    KEY ix_shortfall_actor (declared_by, created_at)
) DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------------------------
-- 7. Existing slots become primaries with sensible defaults
-- --------------------------------------------------------------------------

-- Everything assigned before today is a pick face by definition; the thresholds
-- stay NULL so the registry screen can show them as unset rather than inventing
-- numbers a supervisor never chose.
UPDATE slot_assignments SET role = 'primary' WHERE role IS NULL OR role = '';
