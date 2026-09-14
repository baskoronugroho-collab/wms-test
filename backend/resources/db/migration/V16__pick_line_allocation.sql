-- Allocation per pick line.
--
-- An order line used to be allocated at one location only: the one holding the
-- older stock. When that location held fewer units than the order needed, the
-- line was marked short even though overflow had plenty, and Hiryu was told the
-- order was short (message 5) for stock sitting two metres away.
--
-- Now a line is allocated across locations, oldest stock first, with one pick
-- line per location. Each pick line records how much it holds, so a pick,
-- short pick or cancel releases exactly its own reservation and never another
-- order's.
--
-- Defensive like V8-V15: safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v16_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v16_upgrade()
BEGIN
    DECLARE n INT;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_lines'
        AND COLUMN_NAME = 'qty_allocated';
    IF n = 0 THEN
        ALTER TABLE pick_lines ADD COLUMN qty_allocated INT NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v16_upgrade();
DROP PROCEDURE wms_v16_upgrade;

-- Until now there was exactly one pick line per order line, so its allocation
-- is the order line's.
UPDATE pick_lines pl
  JOIN order_lines ol ON ol.id = pl.order_line_id
   SET pl.qty_allocated = ol.qty_allocated
 WHERE pl.qty_allocated IS NULL;
