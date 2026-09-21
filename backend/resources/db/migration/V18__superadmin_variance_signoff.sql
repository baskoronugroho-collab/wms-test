-- 1. Roles: admin and Ops HQ are one role (`hq`); `superadmin` sits above it and
--    can preview the app as any other role.
-- 2. Replenishment variance: when what arrived differs from what Wardah
--    confirmed, the SPV acknowledges or corrects the count and Ops HQ signs it
--    off. The signed number is what both sides bill on.
--
-- Defensive like V8-V17: safe to re-run from any partial state.

-- The pilot owner becomes superadmin; every other admin becomes Ops HQ.
UPDATE users SET role = 'superadmin'
 WHERE role = 'admin' AND email = 'baskoro.nugroho@ninjavan.co';
UPDATE users SET role = 'hq' WHERE role = 'admin';

DROP PROCEDURE IF EXISTS wms_v18_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v18_upgrade()
BEGIN
    DECLARE n INT;

    -- The count the SPV stands behind for one line, and why it differs.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'qty_final';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN qty_final INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'final_note';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN final_note VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'acknowledged_by';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN acknowledged_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'acknowledged_at';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN acknowledged_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'signed_off_by';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN signed_off_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'signed_off_at';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN signed_off_at DATETIME NULL;
    END IF;

    -- HQ's note when sending a count back to the SPV, or when signing it off.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'review_note';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN review_note VARCHAR(400) NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v18_upgrade();
DROP PROCEDURE wms_v18_upgrade;
