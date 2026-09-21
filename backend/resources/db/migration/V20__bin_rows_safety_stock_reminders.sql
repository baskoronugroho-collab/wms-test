-- 1. A level can hold one or two bins per position. The second bin (row B) is
--    kept open until the real racks are seen: behind the first, or stacked on
--    it. Row A keeps today's codes (UT5-A-3-02); row B adds a letter
--    (UT5-A-3-02B), so nothing that exists is renamed.
-- 2. Safety stock per SKU per hub, beside the restock point.
-- 3. Reminder and flag rules, with their numbers kept as data so Ops HQ can set
--    them when the consignment details are agreed.
--
-- Defensive like V8-V19: safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v20_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v20_upgrade()
BEGIN
    DECLARE n INT;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'levels' AND COLUMN_NAME = 'bin_rows';
    IF n = 0 THEN
        ALTER TABLE levels ADD COLUMN bin_rows INT NOT NULL DEFAULT 1;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'bin_row';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN bin_row INT NOT NULL DEFAULT 1;
    END IF;

    -- One location per level, position AND row. The old key would refuse row B.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND INDEX_NAME = 'uq_locations_level_pos';
    IF n > 0 THEN
        ALTER TABLE locations DROP INDEX uq_locations_level_pos;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND INDEX_NAME = 'uq_locations_level_pos_row';
    IF n = 0 THEN
        ALTER TABLE locations
          ADD UNIQUE KEY uq_locations_level_pos_row (level_id, position_no, bin_row);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'safety_stock';
    IF n = 0 THEN
        ALTER TABLE slot_assignments ADD COLUMN safety_stock INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'default_safety_stock';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN default_safety_stock INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'auto_created';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN auto_created TINYINT(1) NOT NULL DEFAULT 0;
    END IF;
END$$

DELIMITER ;

CALL wms_v20_upgrade();
DROP PROCEDURE wms_v20_upgrade;

CREATE TABLE IF NOT EXISTS alert_rules (
    rule_key    VARCHAR(48)  NOT NULL,
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,
    value_num   INT          NULL,
    updated_by  VARCHAR(255) NULL,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_key)
) DEFAULT CHARSET=utf8mb4;

-- Starting values. Every one is editable by Ops HQ on the Reminders page; the
-- ones that depend on the consignment terms start as placeholders.
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('auto_replenish',          1, NULL),   -- stock <= R: draft a request by itself
  ('safety_breach',           1, NULL),   -- stock <= safety stock: critical flag
  ('draft_unsent_hours',      1, 4),      -- a draft not sent to Wardah after N h
  ('sent_unconfirmed_hours',  1, 24),     -- sent, Wardah has not confirmed after N h
  ('delivery_overdue_days',   1, 1),      -- confirmed, not received N days past ETA
  ('variance_open_hours',     1, 24),     -- a variance waiting for the SPV or HQ
  ('sku_request_open_hours',  1, 24),     -- a station waiting for HQ's answer
  ('needs_rack_days',         1, 2),      -- a registered SKU still unracked at a hub
  ('slow_mover_days',         0, 30)      -- racked, stock held, nothing picked in N days
ON DUPLICATE KEY UPDATE rule_key = rule_key;
