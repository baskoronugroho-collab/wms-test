-- V21: stacked bins are Top (T) and Bottom (B); restock point defaults to 25% of
-- the full level; one AWB can be received in several batches, sized by the
-- hub's temporary inbound bins (one bin = one SKU).
--
-- Re-runnable: every ALTER checks information_schema first.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v21_upgrade$$
CREATE PROCEDURE wms_v21_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- How many temporary inbound bins the hub has. NULL = not limited.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'inbound_bins';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN inbound_bins INT NULL;
    END IF;

    -- Batch 1, 2, 3 ... of one replenishment, and whether it was the last one.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'batch_no';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN batch_no INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'final_batch';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN final_batch TINYINT(1) NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v21_upgrade();
DROP PROCEDURE wms_v21_upgrade;

-- Two bins stacked at one position: bin_row 1 is the Bottom (B), bin_row 2 the
-- Top (T). A level with one bin per position keeps the plain code. Top first,
-- so the old "...B" codes of row 2 are free before row 1 takes the B.
UPDATE locations l JOIN levels lv ON lv.id = l.level_id
   SET l.code = CONCAT(LEFT(l.code, CHAR_LENGTH(l.code) - 1), 'T')
 WHERE lv.bin_rows = 2 AND l.bin_row = 2 AND l.code LIKE '%B';

UPDATE locations l JOIN levels lv ON lv.id = l.level_id
   SET l.code = CONCAT(l.code, 'B')
 WHERE lv.bin_rows = 2 AND l.bin_row = 1 AND l.code NOT LIKE '%B';

-- Default restock point R = 25% of the full level P until Ops HQ sets real
-- numbers. Editable on the Reminders page.
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('restock_default_pct', 1, 25)
ON DUPLICATE KEY UPDATE rule_key = rule_key;

UPDATE skus
   SET default_restock_point = GREATEST(1, ROUND(default_full_threshold * 0.25))
 WHERE default_restock_point IS NULL AND default_full_threshold IS NOT NULL;

UPDATE slot_assignments
   SET restock_point = GREATEST(1, ROUND(full_threshold * 0.25))
 WHERE slot_role = 'primary' AND restock_point IS NULL AND full_threshold IS NOT NULL;
