-- V22: the interim Hiryu bridge (PRD v3.3 §13.2 to §13.6, §9.2, §10.3 to §10.6).
--
-- Orders reach the WMS by pasting the Hiryu order page; stock goes back to Hiryu
-- by the SPV typing a sheet. Nothing here stores customer data (PRD §2.11): no
-- table has a field for a customer's name, phone, address, note or payment.
--
-- Re-runnable: every ALTER checks information_schema first; tables are
-- CREATE TABLE IF NOT EXISTS; seed rows use ON DUPLICATE KEY.

-- Orders: what the paste carries, and the three taps staff make after it.
-- Order lines: the Hiryu item and how many of it were ordered.
-- SKUs: the code Hiryu knows the SKU by, and the Grab buffer (§13.6); a NULL
-- buffer means the default in alert_rules 'grab_buffer_default'.
DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v22_upgrade$$
CREATE PROCEDURE wms_v22_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'hiryu_short_no';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN hiryu_short_no VARCHAR(32) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'hiryu_store_no';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN hiryu_store_no INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'source';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN source VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'acceptance';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN acceptance VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'scheduled_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN scheduled_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'pasted_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN pasted_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'pasted_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN pasted_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'marked_ready_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN marked_ready_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'marked_ready_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN marked_ready_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'handed_over_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN handed_over_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'handed_over_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN handed_over_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'cancelled_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN cancelled_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'cancelled_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN cancelled_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'hiryu_item_id';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN hiryu_item_id VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'item_qty';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN item_qty INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'hiryu_sku_code';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN hiryu_sku_code VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'grab_buffer';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN grab_buffer INT NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v22_upgrade();
DROP PROCEDURE wms_v22_upgrade;

-- Hiryu menu items -> WMS SKU and units per sale (§13.3). Filled from Hiryu's
-- menu CSV; items whose barcode matches connect by themselves at 1 unit.
CREATE TABLE IF NOT EXISTS hiryu_items (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    hiryu_item_id   VARCHAR(64)  NOT NULL,
    brand_id        BIGINT       NULL,
    item_name       VARCHAR(255) NULL,
    barcode         VARCHAR(64)  NULL,
    available_status VARCHAR(32) NULL,
    sku_id          BIGINT       NULL,
    units_per_sale  INT          NOT NULL DEFAULT 1,
    active          TINYINT(1)   NOT NULL DEFAULT 1,
    seen_in_order   TINYINT(1)   NOT NULL DEFAULT 0,
    imported_at     DATETIME     NULL,
    mapped_by       VARCHAR(255) NULL,
    mapped_at       DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hiryu_items_item (hiryu_item_id),
    KEY ix_hiryu_items_brand (brand_id),
    KEY ix_hiryu_items_sku (sku_id)
) DEFAULT CHARSET=utf8mb4;

-- Menu prices by upload date, for the sell-out value (§5.3). From the menu, never
-- from an order.
CREATE TABLE IF NOT EXISTS hiryu_item_prices (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    hiryu_item_id   VARCHAR(64) NOT NULL,
    price_idr       BIGINT      NOT NULL,
    effective_date  DATE        NOT NULL,
    uploaded_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_hiryu_price_day (hiryu_item_id, effective_date)
) DEFAULT CHARSET=utf8mb4;

-- Hiryu store number -> hub and brand (§13.3).
CREATE TABLE IF NOT EXISTS hiryu_stores (
    hiryu_store_no   INT          NOT NULL,
    store_name       VARCHAR(160) NOT NULL,
    partner_store_id VARCHAR(64)  NULL,
    site_id          BIGINT       NOT NULL,
    brand_id         BIGINT       NOT NULL,
    active           TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by       VARCHAR(255) NULL,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (hiryu_store_no),
    KEY ix_hiryu_stores_site (site_id)
) DEFAULT CHARSET=utf8mb4;

-- What the SPV typed into Hiryu, one row per confirmed sheet line (§13.4.4).
CREATE TABLE IF NOT EXISTS hiryu_stock_sent (
    id        BIGINT       NOT NULL AUTO_INCREMENT,
    site_id   BIGINT       NOT NULL,
    sku_id    BIGINT       NOT NULL,
    qty       INT          NOT NULL,
    sent_by   VARCHAR(255) NOT NULL,
    sent_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_stock_sent_site_sku (site_id, sku_id, sent_at)
) DEFAULT CHARSET=utf8mb4;

-- Settings, editable on the Reminders page like every other number.
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('grab_ready_minutes',     1, 10),   -- ready-by = Hiryu order time + N min (§9.2)
  ('scheduled_lead_minutes', 1, 20),   -- ready-by = scheduled time - N min (§9.2a)
  ('grab_buffer_default',    1, 1),    -- units per SKU kept back from Grab (§13.6)
  ('handover_wait_minutes',  1, 20),   -- bag waiting for a driver flags after N min
  ('stock_untyped_hours',    1, 2)     -- stock changed, not typed into Hiryu after N h
ON DUPLICATE KEY UPDATE rule_key = rule_key;
