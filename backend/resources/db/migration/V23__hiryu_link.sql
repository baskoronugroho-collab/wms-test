-- V23: the Hiryu link (PRD §0.6, §2.12, §6.6, §9.4, §9.5; docs/hiryu-link-v1.md).
--
-- Orders, cancels and the catalogue now arrive from Hiryu by API, and the WMS
-- sends stock levels, order ready and item short back. This migration adds what
-- the receiver and the sender need to keep, and nothing about the customer: no
-- table here has a field for a customer's name, phone, address, note or payment.
--
-- Re-runnable and conservative, because a failed migration wedges every later
-- deploy (OceanBase rules):
--   * every ALTER checks information_schema first, one logical change each;
--   * a unique key is swapped in two guarded steps (add the new one, then drop
--     the old one), never in one combined ALTER;
--   * no foreign keys;
--   * tables are CREATE TABLE IF NOT EXISTS; seed rows use ON DUPLICATE KEY.
DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v23_upgrade$$
CREATE PROCEDURE wms_v23_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- ---------------------------------------------------------------- orders
    -- The item's menu price from message 1, for the brand's sales report
    -- (§15.1). One order line is one SKU; when two Hiryu items share a SKU the
    -- receiver stores an item-quantity-weighted price, so item_qty x
    -- item_price_idr is still the line's sale value.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'item_price_idr';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN item_price_idr BIGINT NULL;
    END IF;

    -- Why Hiryu cancelled (message 2), e.g. 2001 Item out of stock. A Grab
    -- reason, never a customer's words.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'cancel_reason_code';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN cancel_reason_code VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'cancel_reason';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(160) NULL;
    END IF;

    -- ------------------------------------------------------------ pos_outbox
    -- Backoff: a row is not tried again before this time (10 s, 30 s, 1 min,
    -- 2 min, 5 min, then every 10 min, as the contract says).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'next_attempt_at';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN next_attempt_at DATETIME NULL;
    END IF;

    -- When a pod claimed the row (status 'sending'). Several pods run the
    -- sender; a claim older than a minute is a pod that died mid-send, and the
    -- row goes back to pending.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'claimed_at';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN claimed_at DATETIME NULL;
    END IF;

    -- A burst of scans queues many stock rows for one SKU; one number is sent,
    -- worked out at send time, and the other rows point at the row that carried
    -- it (§9.4.3).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'merged_into';
    IF n = 0 THEN
        ALTER TABLE pos_outbox ADD COLUMN merged_into BIGINT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND INDEX_NAME = 'ix_outbox_pair';
    IF n = 0 THEN
        CREATE INDEX ix_outbox_pair ON pos_outbox (site_id, sku_id, status);
    END IF;

    -- ------------------------------------------------------------------ skus
    -- Set when the catalogue (message 6) created the SKU: the Menu Hiryu page
    -- marks it baru and Ops HQ completes it (§2.2.5, §2.2.6).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'hiryu_created_at';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN hiryu_created_at DATETIME NULL;
    END IF;

    -- ----------------------------------------------------------- hiryu_items
    -- The menu is per store now (§2.12): the same item ID can sit in both of a
    -- brand's stores with its own price. 0 = not tied to a store (the menu CSV
    -- and paste era). NOT NULL on purpose: a unique key over a NULL column does
    -- not deduplicate, and the older CSV and paste writers still upsert by
    -- item ID alone.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND COLUMN_NAME = 'hiryu_store_no';
    IF n = 0 THEN
        ALTER TABLE hiryu_items ADD COLUMN hiryu_store_no INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND COLUMN_NAME = 'price_idr';
    IF n = 0 THEN
        ALTER TABLE hiryu_items ADD COLUMN price_idr BIGINT NULL;
    END IF;

    -- Unique per store: add the new key first, so the table is never without one.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND INDEX_NAME = 'uq_hiryu_items_store_item';
    IF n = 0 THEN
        CREATE UNIQUE INDEX uq_hiryu_items_store_item
          ON hiryu_items (hiryu_store_no, hiryu_item_id);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND INDEX_NAME = 'uq_hiryu_items_item';
    IF n > 0 THEN
        ALTER TABLE hiryu_items DROP INDEX uq_hiryu_items_item;
    END IF;

    -- The lookups by item ID alone (the paste route) keep an index.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND INDEX_NAME = 'ix_hiryu_items_item';
    IF n = 0 THEN
        CREATE INDEX ix_hiryu_items_item ON hiryu_items (hiryu_item_id);
    END IF;

    -- ----------------------------------------------------- hiryu_item_prices
    -- Prices by store as well (§2.12: item ID and store -> price).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_item_prices'
        AND COLUMN_NAME = 'hiryu_store_no';
    IF n = 0 THEN
        ALTER TABLE hiryu_item_prices ADD COLUMN hiryu_store_no INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_item_prices'
        AND INDEX_NAME = 'uq_hiryu_price_store_day';
    IF n = 0 THEN
        CREATE UNIQUE INDEX uq_hiryu_price_store_day
          ON hiryu_item_prices (hiryu_store_no, hiryu_item_id, effective_date);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_item_prices'
        AND INDEX_NAME = 'uq_hiryu_price_day';
    IF n > 0 THEN
        ALTER TABLE hiryu_item_prices DROP INDEX uq_hiryu_price_day;
    END IF;
END$$

DELIMITER ;

CALL wms_v23_upgrade();
DROP PROCEDURE wms_v23_upgrade;

-- Messages from Hiryu already answered, by message_id: the same message again
-- gets the same answer and changes nothing (contract, common rules). Refusals
-- are not kept here, so a message refused for an unknown SKU is taken once Ops
-- HQ has fixed the catalogue and Hiryu sends it again.
CREATE TABLE IF NOT EXISTS hiryu_inbound_messages (
    message_id    VARCHAR(96)  NOT NULL,
    message_type  VARCHAR(16)  NOT NULL,
    status_code   INT          NOT NULL,
    response_json TEXT         NULL,
    received_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id)
) DEFAULT CHARSET=utf8mb4;

-- A cancel that arrived before its order (§0.6.2 out of order): kept, and
-- applied when message 1 for that Grab order ID arrives.
CREATE TABLE IF NOT EXISTS hiryu_pending_cancels (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    grab_order_id  VARCHAR(96)  NOT NULL,
    message_id     VARCHAR(96)  NULL,
    reason_code    VARCHAR(16)  NULL,
    reason         VARCHAR(160) NULL,
    cancelled_at   DATETIME     NULL,
    received_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at     DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pending_cancel_order (grab_order_id)
) DEFAULT CHARSET=utf8mb4;

-- Every message from Hiryu and what the WMS did with it. A refusal (unknown
-- store, unknown SKU code) is what flags Ops HQ (§6.6.3, §8.5); the rest is the
-- trail shown on Integrasi Hiryu.
CREATE TABLE IF NOT EXISTS hiryu_inbound_log (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    message_type   VARCHAR(16)  NOT NULL,
    message_id     VARCHAR(96)  NULL,
    grab_order_id  VARCHAR(96)  NULL,
    hiryu_store_no INT          NULL,
    outcome        VARCHAR(24)  NOT NULL,
    detail         VARCHAR(400) NULL,
    received_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_inbound_log_time (received_at),
    KEY ix_inbound_log_outcome (outcome, received_at)
) DEFAULT CHARSET=utf8mb4;

-- Settings. Not on the Reminders page: they are switched on Integrasi Hiryu.
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('hiryu_link_live',          1, 1),    -- 1 = the link runs: paste and the stock sheet are off
  ('link_wait_alert_minutes',  1, 5),    -- a message waiting longer than N min shows red (§9.3)
  ('hiryu_snapshot_last_day',  1, NULL)  -- WIB date (YYYYMMDD) of the last nightly snapshot
ON DUPLICATE KEY UPDATE rule_key = rule_key;
