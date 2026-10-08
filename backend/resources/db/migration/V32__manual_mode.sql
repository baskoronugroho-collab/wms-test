-- V32: Mode manual (Pengaturan, Dark store): the scanners or phone cameras of a
-- dark store are broken, so the floor works without scanning for a while.
--
-- Only Ops HQ and up switch it on, with a reason, until a set time (by default
-- the end of the WIB day); it ends by itself then. While it is on, picking is
-- a tap per unit, inbound and counts are typed blind numbers, and putaway and
-- put back are confirmed by tapping the bin. Every manual entry is marked, so
-- the SPV can review the day and the reports can show it.
--
-- Re-runnable: every ALTER checks information_schema first, one change per
-- statement, no foreign keys.
DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v32_upgrade$$
CREATE PROCEDURE wms_v32_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- ------------------------------------------------------------------ sites
    -- manual_mode_until: UTC. Mode manual is on while manual_mode = 1 and the
    -- time has not passed; the WMS also switches the flag off once it has.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'manual_mode';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN manual_mode TINYINT(1) NOT NULL DEFAULT 0;
    END IF;
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'manual_mode_until';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN manual_mode_until DATETIME NULL;
    END IF;
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'manual_mode_since';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN manual_mode_since DATETIME NULL;
    END IF;
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'manual_mode_by';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN manual_mode_by VARCHAR(255) NULL;
    END IF;
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites' AND COLUMN_NAME = 'manual_mode_reason';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN manual_mode_reason VARCHAR(255) NULL;
    END IF;

    -- ------------------------------------------------------------- pick_lines
    -- Units confirmed by a tap instead of a scan (Mode manual).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_lines' AND COLUMN_NAME = 'manual_units';
    IF n = 0 THEN
        ALTER TABLE pick_lines ADD COLUMN manual_units INT NOT NULL DEFAULT 0;
    END IF;

    -- ------------------------------------------------------- inbound_receipts
    -- 1 = counted by typed numbers (Mode manual) rather than unit scans.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts' AND COLUMN_NAME = 'manual_mode';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN manual_mode TINYINT(1) NOT NULL DEFAULT 0;
    END IF;
END$$

DELIMITER ;

CALL wms_v32_upgrade();
DROP PROCEDURE wms_v32_upgrade;
