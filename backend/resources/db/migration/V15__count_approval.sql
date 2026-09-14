-- A count adjustment is applied once, by a named supervisor.
--
-- Until now nothing recorded that a variance had been approved, so approving
-- the same count twice applied the adjustment twice, and the variance report
-- kept offering rows that were already in the ledger.
--
-- Defensive like V8-V14: safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v15_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v15_upgrade()
BEGIN
    DECLARE n INT;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opname_sessions'
        AND COLUMN_NAME = 'approved_at';
    IF n = 0 THEN
        ALTER TABLE opname_sessions ADD COLUMN approved_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'opname_sessions'
        AND COLUMN_NAME = 'approved_by';
    IF n = 0 THEN
        ALTER TABLE opname_sessions ADD COLUMN approved_by VARCHAR(255) NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v15_upgrade();
DROP PROCEDURE wms_v15_upgrade;

-- Adjustments already in the ledger count as approved, so the report stops
-- offering them again.
UPDATE opname_sessions os
   SET os.approved_at = (SELECT MIN(m.created_at) FROM stock_movements m
                          WHERE m.ref_type = 'opname_session' AND m.ref_id = os.id
                            AND m.movement_type = 'adjustment'),
       os.approved_by = (SELECT MIN(m.actor_email) FROM stock_movements m
                          WHERE m.ref_type = 'opname_session' AND m.ref_id = os.id
                            AND m.movement_type = 'adjustment')
 WHERE os.approved_at IS NULL
   AND EXISTS (SELECT 1 FROM stock_movements m
                WHERE m.ref_type = 'opname_session' AND m.ref_id = os.id
                  AND m.movement_type = 'adjustment');
