-- The outbox now carries order events, not just stock levels.
--
-- V1 shaped pos_outbox for exactly one message: a stock level for one SKU, so
-- `sku_id` and `available` were both NOT NULL. Messages 2, 4 and 5 are about an
-- ORDER, and have neither: an order-ready names a bag, not a shelf.
--
-- Writing 0 into `available` for those would be worse than null. Zero is a
-- legitimate stock figure meaning "none left", so an order-ready carrying
-- available=0 would look to the POS exactly like a SKU that has just run out.
-- Null is the honest answer: this message has no quantity.
--
-- Defensive for the same reason V8 is — a failed migration leaves DDL applied
-- and re-runs from the start.

DROP PROCEDURE IF EXISTS wms_v9_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v9_upgrade()
BEGIN
    DECLARE n INT;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'available' AND IS_NULLABLE = 'NO';
    IF n > 0 THEN
        ALTER TABLE pos_outbox MODIFY COLUMN available INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'sku_id' AND IS_NULLABLE = 'NO';
    IF n > 0 THEN
        ALTER TABLE pos_outbox MODIFY COLUMN sku_id BIGINT NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v9_upgrade();
DROP PROCEDURE wms_v9_upgrade;
