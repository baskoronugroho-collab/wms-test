-- v2 operating model: one pick face plus overflow, three thresholds, a hub that
-- dispatches, and the remaining POS messages.
--
-- The blocking change is the first one. V1 declared
--   UNIQUE KEY uq_slot_site_sku (site_id, sku_id)
-- which permits exactly one basket per SKU per site and so made overflow
-- impossible to represent at all. The guarantee worth keeping is narrower --
-- one PICK FACE per SKU -- which (site_id, sku_id, slot_role) expresses exactly.
--
-- WHY THIS FILE IS WRITTEN DEFENSIVELY
-- The first attempt at this migration failed part-way. DDL auto-commits, so
-- whatever it had already applied is still in the database, and a corrected
-- migration re-runs FROM THE START -- hitting "duplicate column" on everything
-- that did land. Every step below therefore checks information_schema first and
-- skips what already exists, so the file is safe to run any number of times
-- from any partial state.
--
-- TWO COLUMNS WERE RENAMED from the first attempt: `role` -> `slot_role` and
-- `priority` -> `send_priority`. Both are keywords OceanBase treats more
-- strictly than MySQL does, and an unquoted keyword in an ALTER is the most
-- likely cause of the original failure. Renaming costs nothing and removes the
-- whole class of problem.

DROP PROCEDURE IF EXISTS wms_v8_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v8_upgrade()
BEGIN
    DECLARE n INT;

    -- ---------------------------------------------------------------- 1
    -- Slot registry: role + the three thresholds
    -- ----------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'slot_role';
    IF n = 0 THEN
        ALTER TABLE slot_assignments
          ADD COLUMN slot_role VARCHAR(16) NOT NULL DEFAULT 'primary';
    END IF;

    -- Units at which the pick face is full and surplus goes to overflow.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'full_threshold';
    IF n = 0 THEN
        ALTER TABLE slot_assignments ADD COLUMN full_threshold INT NULL;
    END IF;

    -- Units at which a replenishment task is raised. Measured on the PICK FACE
    -- only: primary empty with overflow full still totals healthy, and the
    -- picker walks up to a bare rack.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'low_threshold';
    IF n = 0 THEN
        ALTER TABLE slot_assignments ADD COLUMN low_threshold INT NULL;
    END IF;

    -- Units across primary + overflow at which the hub is asked for more.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'restock_point';
    IF n = 0 THEN
        ALTER TABLE slot_assignments ADD COLUMN restock_point INT NULL;
    END IF;

    -- Drop the constraint that makes overflow impossible.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND INDEX_NAME = 'uq_slot_site_sku';
    IF n > 0 THEN
        ALTER TABLE slot_assignments DROP INDEX uq_slot_site_sku;
    END IF;

    -- One pick face per SKU per site, and at most one overflow beside it.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND INDEX_NAME = 'uq_slot_site_sku_role';
    IF n = 0 THEN
        ALTER TABLE slot_assignments
          ADD UNIQUE KEY uq_slot_site_sku_role (site_id, sku_id, slot_role);
    END IF;

    -- ---------------------------------------------------------------- 2
    -- Day colour recorded per movement, so the pick screen can name the
    -- oldest colour in a basket without tracking individual units.
    -- ----------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_movements'
        AND COLUMN_NAME = 'day_color_key';
    IF n = 0 THEN
        ALTER TABLE stock_movements ADD COLUMN day_color_key VARCHAR(16) NULL;
    END IF;

    -- ---------------------------------------------------------------- 3
    -- Transfers: the hub -> darkstore hop. The dispatched quantity is what
    -- makes hop 2 checkable even when the brand sends no manifest.
    -- ----------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfer_lines'
        AND COLUMN_NAME = 'qty_dispatched';
    IF n = 0 THEN
        ALTER TABLE transfer_lines
          ADD COLUMN qty_dispatched INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers'
        AND COLUMN_NAME = 'dispatched_by';
    IF n = 0 THEN
        ALTER TABLE transfers ADD COLUMN dispatched_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers'
        AND COLUMN_NAME = 'note';
    IF n = 0 THEN
        ALTER TABLE transfers ADD COLUMN note VARCHAR(400) NULL;
    END IF;

    -- ---------------------------------------------------------------- 5
    -- The POS outbox carries all five messages, not just stock levels.
    -- send_priority is what keeps an order-ready from queueing behind two
    -- hundred stock updates.
    -- ----------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'message_type';
    IF n = 0 THEN
        ALTER TABLE pos_outbox
          ADD COLUMN message_type VARCHAR(32) NOT NULL DEFAULT 'stock_level';
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'send_priority';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN send_priority INT NOT NULL DEFAULT 5;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'payload_json';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN payload_json TEXT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'order_ref';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN order_ref VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'attempts';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN attempts INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'last_error';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN last_error VARCHAR(400) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND INDEX_NAME = 'ix_outbox_dispatch';
    IF n = 0 THEN
        CREATE INDEX ix_outbox_dispatch
          ON pos_outbox (status, send_priority, id);
    END IF;

    -- ---------------------------------------------------------------- 7
    -- Everything assigned before today is a pick face by definition. The
    -- thresholds stay NULL so the registry screen shows them as unset rather
    -- than inventing numbers a supervisor never chose.
    -- ----------------------------------------------------------------
    UPDATE slot_assignments SET slot_role = 'primary'
      WHERE slot_role IS NULL OR slot_role = '';
END$$

DELIMITER ;

CALL wms_v8_upgrade();
DROP PROCEDURE wms_v8_upgrade;

-- --------------------------------------------------------------------------
-- 4 & 6. New tables. CREATE TABLE IF NOT EXISTS needs no procedure.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS replenishment_tasks (
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
    -- One OPEN task per SKU per site is enforced in the service, not here: a
    -- unique key on (site, sku, status) would also permit only one *completed*
    -- task per SKU and so block the history after the second replenishment.
    -- MySQL has no partial index to express "unique only while open".
    KEY ix_replen_site_status (site_id, status, created_at),
    KEY ix_replen_sku (site_id, sku_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS restock_requests (
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

CREATE TABLE IF NOT EXISTS pick_shortfalls (
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
