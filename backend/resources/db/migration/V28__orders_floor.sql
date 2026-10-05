-- V28: orders on the floor, deploy 3 (canvas Section 6, boards 6a to 6k;
-- decisions log 1 Oct and 5 Oct).
--
--   * Outbound baskets (MA5-OUT-01 ...): the picker scans an empty basket to
--     start an order. pick_tasks.basket_code is the basket; it is busy until
--     basket_released_at (Selesai dikemas, or a cancelled order emptied back to
--     the rack). The basket codes themselves live in agent S's special_bins
--     (kind 'OUT'); this migration does not create them.
--   * return_by: the picker who held an order when it was cancelled with units
--     already in the basket. They put them back before the next order comes.
--   * A missing item follows the customer's instruction (V27: oos_type,
--     oos_replace_*, oos_effective). What the floor did goes on V27's
--     oos_action, oos_units_wanted, oos_units_found, oos_done_replace_sku_code,
--     oos_done_replace_units, oos_acted_at (message 5 is built from them). A
--     replacement is a new order line with replacement_for_line_id (here)
--     pointing at the line it replaces. pick_shortfalls (V8) also keeps the
--     instruction and the action, for the SPV.
--   * order_packs: the pack the WMS named, the pack used, why it changed, and
--     whether the consumables were booked.
--   * driver_returns: a cancelled parcel the driver brought back, checked on
--     arrival (fine units to the rack, damaged units to quarantine).
--   * bin_count_flags: bins a picker found wrong, for the next count.
--   * Test orders (UJI): orders.source = 'uji' and is_test = 1; who made it.
--
-- Re-runnable and conservative (OceanBase): every ALTER is guarded by an
-- information_schema check and makes one change; no foreign keys; tables are
-- CREATE TABLE IF NOT EXISTS; settings rows use ON DUPLICATE KEY.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v28_upgrade$$
CREATE PROCEDURE wms_v28_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- pick_tasks ------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'basket_code';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN basket_code VARCHAR(32) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'basket_scanned_at';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN basket_scanned_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'basket_released_at';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN basket_released_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'return_by';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN return_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND INDEX_NAME = 'ix_pick_basket';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD INDEX ix_pick_basket (site_id, basket_code);
    END IF;

    -- orders ----------------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'test_created_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN test_created_by VARCHAR(255) NULL;
    END IF;

    -- order_lines: a replacement line points at the line it replaces ----------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_lines'
        AND COLUMN_NAME = 'replacement_for_line_id';
    IF n = 0 THEN
        ALTER TABLE order_lines ADD COLUMN replacement_for_line_id BIGINT NULL;
    END IF;

    -- pick_shortfalls: what the WMS did with the missing line ------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_shortfalls'
        AND COLUMN_NAME = 'order_line_id';
    IF n = 0 THEN
        ALTER TABLE pick_shortfalls ADD COLUMN order_line_id BIGINT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_shortfalls'
        AND COLUMN_NAME = 'action';
    IF n = 0 THEN
        ALTER TABLE pick_shortfalls ADD COLUMN action VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_shortfalls'
        AND COLUMN_NAME = 'instruction';
    IF n = 0 THEN
        ALTER TABLE pick_shortfalls ADD COLUMN instruction VARCHAR(24) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_shortfalls'
        AND COLUMN_NAME = 'replace_sku_id';
    IF n = 0 THEN
        ALTER TABLE pick_shortfalls ADD COLUMN replace_sku_id BIGINT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_shortfalls'
        AND COLUMN_NAME = 'replace_units';
    IF n = 0 THEN
        ALTER TABLE pick_shortfalls ADD COLUMN replace_units INT NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v28_upgrade();
DROP PROCEDURE wms_v28_upgrade;

-- The pack of each order (PRD §6.10, board 6h). One row per order, written when
-- the pack screen first opens and completed at Selesai dikemas.
--   suggested / chosen   bag | carton | two
--   estimated            1 when any product lacked pack data ("perkiraan")
CREATE TABLE IF NOT EXISTS order_packs (
    order_id            BIGINT       NOT NULL,
    site_id             BIGINT       NOT NULL,
    suggested           VARCHAR(16)  NOT NULL,
    suggested_reason    VARCHAR(255) NULL,
    estimated           TINYINT(1)   NOT NULL DEFAULT 0,
    volume_ml           INT          NULL,
    weight_g            INT          NULL,
    longest_mm          INT          NULL,
    large_bottles       INT          NULL,
    chosen              VARCHAR(16)  NULL,
    change_reason       VARCHAR(200) NULL,
    changed_by          VARCHAR(255) NULL,
    changed_at          DATETIME     NULL,
    pack_started_at     DATETIME     NULL,
    pack_started_by     VARCHAR(255) NULL,
    packed_at           DATETIME     NULL,
    packed_by           VARCHAR(255) NULL,
    consumables_booked  TINYINT(1)   NOT NULL DEFAULT 0,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (order_id),
    KEY ix_order_packs_site (site_id, packed_at)
) DEFAULT CHARSET=utf8mb4;

-- A cancelled parcel the driver brought back, checked on arrival (decisions
-- 5 Oct round 5). One row per SKU line. Fine units become a return-to-shelf
-- task; damaged units go to quarantine with the reason "Kembali dari driver,
-- rusak", cost Ninja. quarantine_ref is the quarantine row when agent C's
-- helper took them; NULL with qty_damaged > 0 means still to be booked there.
CREATE TABLE IF NOT EXISTS driver_returns (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    order_id        BIGINT       NOT NULL,
    site_id         BIGINT       NOT NULL,
    sku_id          BIGINT       NOT NULL,
    qty_back        INT          NOT NULL,
    qty_ok          INT          NOT NULL DEFAULT 0,
    qty_damaged     INT          NOT NULL DEFAULT 0,
    return_task_id  BIGINT       NULL,
    quarantine_ref  BIGINT       NULL,
    note            VARCHAR(255) NULL,
    checked_by      VARCHAR(255) NOT NULL,
    checked_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_driver_returns_order (order_id),
    KEY ix_driver_returns_site (site_id, checked_at)
) DEFAULT CHARSET=utf8mb4;

-- Bins to count next (board 6d: "Dua bin jadi 0, masuk hitung stok
-- berikutnya"). Written by the floor, read and closed by the counts (agent C).
--   status  open | counted
CREATE TABLE IF NOT EXISTS bin_count_flags (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    site_id       BIGINT       NOT NULL,
    location_id   BIGINT       NOT NULL,
    sku_id        BIGINT       NULL,
    reason        VARCHAR(32)  NOT NULL,
    ref_type      VARCHAR(32)  NULL,
    ref_id        BIGINT       NULL,
    qty_before    INT          NULL,
    qty_found     INT          NULL,
    raised_by     VARCHAR(255) NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'open',
    closed_by     VARCHAR(255) NULL,
    closed_at     DATETIME     NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_count_flags_site (site_id, status, created_at),
    KEY ix_count_flags_loc (location_id, status)
) DEFAULT CHARSET=utf8mb4;

-- Settings, editable on Aturan & waktu like every other number. The pack rule
-- is PRD §6.10.1; every limit is an assumption to test (§6.10.3).
INSERT INTO alert_rules (rule_key, enabled, value_num, updated_at) VALUES
  ('pack_bag_volume_ml',       1, 3900, UTC_TIMESTAMP()),  -- paper bag: usable volume
  ('pack_bag_weight_g',        1, 3000, UTC_TIMESTAMP()),  -- paper bag: max load
  ('pack_bag_longest_mm',      1, 270, UTC_TIMESTAMP()),   -- paper bag: longest item (folded height)
  ('pack_bag_max_large',       1, 1, UTC_TIMESTAMP()),     -- paper bag: at most N large bottles
  ('pack_carton_volume_ml',    1, 4000, UTC_TIMESTAMP()),  -- carton: usable volume
  ('pack_carton_weight_g',     1, 5000, UTC_TIMESTAMP()),  -- carton: max load
  ('pack_carton_longest_mm',   1, 250, UTC_TIMESTAMP()),   -- carton: longest item
  ('pack_large_bottle_ml',     1, 150, UTC_TIMESTAMP()),   -- a bottle of N ml or more is large
  ('pack_wait_minutes',        1, 3, UTC_TIMESTAMP()),     -- a basket waiting to pack turns amber after N min
  ('return_block_minutes',     1, 30, UTC_TIMESTAMP())     -- a picker returning a cancelled basket gets no order for up to N min
ON DUPLICATE KEY UPDATE rule_key = rule_key;
