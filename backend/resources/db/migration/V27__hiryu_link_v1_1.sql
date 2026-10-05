-- V27: the Hiryu link, contract v1.1 (docs/hiryu-link-v1.md), and the demo toggle.
--
-- Message 1 keeps each Hiryu line as its own order line with the customer's
-- out-of-stock instruction; message 2 keeps who cancelled; message 5 is built
-- from what the floor decided per line; message 6 places stores on hubs by
-- Hiryu dark store and a new store waits for Ops HQ to pick its brand and Grab
-- merchant account; the WMS can ask Hiryu for the full catalogue; every message
-- in and out is kept with its exact JSON for the Pesan Hiryu log; a hub can run
-- in Mode demo, where a built-in Hiryu stand-in receives messages 3 to 5.
--
-- The dark store columns on `sites` (hiryu_dark_store_id, opening_hours_json,
-- hiryu_received_at, setup_completed_at ...) belong to V30; nothing here reads
-- them.
--
-- Nothing here stores customer data: no field for a customer's name, phone,
-- address, note or payment.
--
-- Re-runnable: every ALTER checks information_schema first, one change per
-- statement, no foreign keys, CREATE TABLE IF NOT EXISTS, seeds ON DUPLICATE KEY.
DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v27_upgrade$$
CREATE PROCEDURE wms_v27_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- ------------------------------------------------------------ order_lines
    -- Message 1, per Hiryu line: the SKU code as Hiryu sent it, and the
    -- customer's out-of-stock instruction as sent (oos_type NULL = no
    -- instruction). oos_effective is what the floor must do with it:
    -- replace | remove | cancel_order (null, contact_customer and a replacement
    -- the WMS cannot use all become cancel_order); oos_problem says why a
    -- replacement could not be used.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'hiryu_sku_code';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN hiryu_sku_code VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_type';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_type VARCHAR(20) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_replace_hiryu_item_id';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_replace_hiryu_item_id VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_replace_sku_code';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_replace_sku_code VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_replace_sku_id';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_replace_sku_id BIGINT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_replace_units';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_replace_units INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_effective';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_effective VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_problem';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_problem VARCHAR(160) NULL;
    END IF;

    -- Message 5, per line: what the WMS did once the item was missing. Written
    -- by the pick flow (floor.record_outcome, agent O); the sender reads them,
    -- and falls back to the queued payload.
    --   oos_action                 replaced | removed | cancel_order
    --   oos_units_wanted           the line's units from message 1
    --   oos_units_found            units the picker found (they stay in the order)
    --   oos_done_replace_sku_code  the replacement SKU the picker scanned
    --   oos_done_replace_units     units of the replacement the picker took
    --   oos_acted_at               when
    -- The replacement line itself points at this one with
    -- replacement_for_line_id (V28).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_action';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_action VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_units_wanted';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_units_wanted INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_units_found';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_units_found INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_done_replace_sku_code';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_done_replace_sku_code VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_done_replace_units';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_done_replace_units INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'oos_acted_at';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN oos_acted_at DATETIME NULL;
    END IF;

    -- ----------------------------------------------------------------- orders
    -- Grab's estimated ready time, kept for reference (ready-by is order time
    -- plus the Grab window, decided 5 Oct).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'estimated_ready_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN estimated_ready_at DATETIME NULL;
    END IF;

    -- Message 2: customer | grab | merchant. orders.cancelled_by keeps who in
    -- the WMS applied it ('hiryu' or a person's email).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'hiryu_cancelled_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN hiryu_cancelled_by VARCHAR(16) NULL;
    END IF;

    -- Made by Buat pesanan dummy (Mode demo). Not a WMS test order (is_test).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'is_demo';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    -- ------------------------------------------------- hiryu_pending_cancels
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_pending_cancels'
        AND COLUMN_NAME = 'cancelled_by';
    IF n = 0 THEN
        ALTER TABLE hiryu_pending_cancels ADD COLUMN cancelled_by VARCHAR(16) NULL;
    END IF;

    -- ----------------------------------------------------------- hiryu_stores
    -- A store from message 6 has no brand until Ops HQ picks one.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'brand_id' AND IS_NULLABLE = 'NO';
    IF n > 0 THEN
        ALTER TABLE hiryu_stores MODIFY COLUMN brand_id BIGINT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'hiryu_dark_store_id';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN hiryu_dark_store_id INT NULL;
    END IF;

    -- What Hiryu says (active | inactive). `active` stays the WMS's own
    -- answer: Hiryu active and a brand picked.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'hiryu_active';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN hiryu_active TINYINT(1) NOT NULL DEFAULT 1;
    END IF;

    -- The store's Grab merchant account, as on brands.grab_account (V30):
    -- own | ninja (Ninja Van's account, acting as Nemu Mart). It follows the
    -- brand; kept on the store as what Ops HQ confirmed for it (board 2e).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'grab_account';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN grab_account VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'order_acceptance';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN order_acceptance VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'hiryu_received_at';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN hiryu_received_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'brand_set_by';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN brand_set_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'brand_set_at';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN brand_set_at DATETIME NULL;
    END IF;

    -- The store is active on Grab (kick-off step 15), ticked by Ops HQ.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'grab_active';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN grab_active TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    -- The link per store (H8): on = the WMS sends this store's stock and Hiryu
    -- stops its own count. Stores already running keep running (backfill
    -- below the procedure). link_on_at = when it was last switched on.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'link_on';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN link_on TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_stores'
        AND COLUMN_NAME = 'link_on_at';
    IF n = 0 THEN
        ALTER TABLE hiryu_stores ADD COLUMN link_on_at DATETIME NULL;
    END IF;

    -- ------------------------------------------------------------ hiryu_items
    -- The SKU code as Hiryu sent it, so an item of a store still waiting for
    -- its brand can be connected once the brand is picked.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hiryu_items'
        AND COLUMN_NAME = 'sku_code';
    IF n = 0 THEN
        ALTER TABLE hiryu_items ADD COLUMN sku_code VARCHAR(64) NULL;
    END IF;

    -- ------------------------------------------------------------------ sites
    -- Mode demo (Pengaturan, Demo): Buat pesanan dummy, and messages 3 to 5
    -- go to the built-in Hiryu stand-in.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'demo_mode';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN demo_mode TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    -- 0 = the dark store is missing from Hiryu's last full catalogue. The hub
    -- stays in the WMS (stock, people); its stores stop.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'hiryu_active';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN hiryu_active TINYINT(1) NOT NULL DEFAULT 1;
    END IF;
END$$

DELIMITER ;

CALL wms_v27_upgrade();
DROP PROCEDURE wms_v27_upgrade;

-- Stores already sending stock keep sending: their link is on. Only stores
-- never switched (link_on_at NULL), so a re-run changes nothing. updated_at is
-- set here so ON UPDATE does not stamp it with the migration session's clock
-- (UTC+8 on the cluster, V13); the app's sessions are UTC.
UPDATE hiryu_stores SET link_on = 1, link_on_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
 WHERE active = 1 AND brand_id IS NOT NULL AND link_on = 0 AND link_on_at IS NULL;

-- SKUs from message 6 whose brand is not known yet (their store waits for
-- Ops HQ). Created as WMS SKUs once a store with a brand uses them.
CREATE TABLE IF NOT EXISTS hiryu_pending_skus (
    sku_code      VARCHAR(64)  NOT NULL,
    name          VARCHAR(255) NOT NULL,
    barcodes_json TEXT         NULL,
    message_id    VARCHAR(96)  NULL,
    received_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sku_code)
) DEFAULT CHARSET=utf8mb4;

-- Sinkron ulang dari Hiryu: who asked, when, for which hub, and when Hiryu's
-- full catalogue with the same request_id arrived. 5 minutes per hub.
CREATE TABLE IF NOT EXISTS hiryu_catalogue_requests (
    id                  BIGINT       NOT NULL AUTO_INCREMENT,
    request_id          VARCHAR(96)  NOT NULL,
    site_id             BIGINT       NOT NULL,
    requested_by        VARCHAR(255) NOT NULL,
    requested_by_name   VARCHAR(160) NULL,
    requested_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at         DATETIME     NULL,
    answered_message_id VARCHAR(96)  NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_catalogue_request (request_id),
    KEY ix_catalogue_request_site (site_id, requested_at)
) DEFAULT CHARSET=utf8mb4;

-- Every message in and out, with its exact JSON and the answer: the Pesan
-- Hiryu log on Integrasi Hiryu. One row per message ID and direction; a retry
-- or a repeat updates it. `via`: hiryu (Hiryu called us), demo (Buat pesanan
-- dummy), webhook (sent to POS_WEBHOOK_URL), standin (the built-in Hiryu
-- stand-in of Mode demo), test (the old simulator).
CREATE TABLE IF NOT EXISTS hiryu_message_log (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    direction     VARCHAR(4)   NOT NULL,
    message_no    INT          NULL,
    message_type  VARCHAR(24)  NOT NULL,
    h_ref         VARCHAR(16)  NULL,
    message_id    VARCHAR(96)  NOT NULL,
    site_id       BIGINT       NULL,
    grab_order_id VARCHAR(96)  NULL,
    trigger_id    VARCHAR(255) NULL,
    trigger_en    VARCHAR(255) NULL,
    via           VARCHAR(16)  NOT NULL,
    status        VARCHAR(24)  NOT NULL,
    http_status   INT          NULL,
    attempts      INT          NOT NULL DEFAULT 1,
    outbox_id     BIGINT       NULL,
    body_json     MEDIUMTEXT   NULL,
    answer_json   MEDIUMTEXT   NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_message_log_msg (direction, message_id),
    KEY ix_message_log_site (site_id, id),
    KEY ix_message_log_time (created_at)
) DEFAULT CHARSET=utf8mb4;

INSERT INTO alert_rules (rule_key, enabled, value_num, updated_at) VALUES
  ('hiryu_resync_cooldown_minutes', 1, 5, UTC_TIMESTAMP())   -- Sinkron ulang dari Hiryu: once per N min per hub
ON DUPLICATE KEY UPDATE rule_key = rule_key;
