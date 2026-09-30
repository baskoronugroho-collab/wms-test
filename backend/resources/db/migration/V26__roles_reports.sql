-- V26: roles, Lengkapi data SKU, and the brand sales report
-- (PRD §1.2, §2.2.6, §2.6, §4.5, §15.1).
--
-- 1. Roles. The Ops Head role (`ops_head`) needs no DDL: users.role is a
--    VARCHAR(32) with no ENUM or CHECK, validated in auth.py like every other
--    status field (V1 rule). Nothing to widen.
--
-- 2. What Ops HQ fills in on Lengkapi data SKU that the skus table has no column
--    for yet. The stock numbers already have homes and keep them:
--      isi sampai (P)            skus.default_full_threshold, per hub
--                                slot_assignments.full_threshold
--      pesan ulang saat sisa (R) skus.default_restock_point, per hub
--                                slot_assignments.restock_point
--      batas kritis (S)          skus.default_safety_stock, per hub
--                                slot_assignments.safety_stock
--      cadangan Grab             skus.grab_buffer (NULL = the default rule)
--    New here: the bin size, isi maks. per bin, pack size and weight, the two
--    carton-rule flags, and the percentage behind R and S when Ops HQ enters
--    one (§4.5.3: a percentage is stored as a percentage, so it follows
--    isi sampai). All nullable: a SKU made by Hiryu arrives with none of them.
--
-- 3. The report reads orders by hub and time; an index keeps a month of orders
--    from scanning the table.
--
-- Re-runnable and conservative (OceanBase): every ALTER checks
-- information_schema first and makes exactly one change; no foreign keys.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v26_upgrade$$
CREATE PROCEDURE wms_v26_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- Bin size the SKU needs: S | M | L | OPEN today, the bin type list later
    -- (§3.4.2). Required for a SKU to be complete (§2.6.2).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'bin_size';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN bin_size VARCHAR(16) NULL;
    END IF;

    -- Isi maks. per bin, shared by every hub (§4.6.1). Empty until known.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'bin_max';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN bin_max INT NULL;
    END IF;

    -- Pack size and weight from the brand (§2.6, §6.10). unit_cube_cm3 is
    -- worked out from the three sizes when all are known.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'pack_length_mm';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN pack_length_mm INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'pack_width_mm';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN pack_width_mm INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'pack_height_mm';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN pack_height_mm INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'pack_weight_g';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN pack_weight_g INT NULL;
    END IF;

    -- Liquid in a bottle; a large bottle (150 ml or more). Drive the carton
    -- rule (§6.10). NULL = not known yet.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'is_liquid';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN is_liquid TINYINT(1) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'is_large_bottle';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN is_large_bottle TINYINT(1) NULL;
    END IF;

    -- R and S as a percentage of isi sampai, when entered that way. The unit
    -- columns still hold the number every other flow reads.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'default_restock_pct';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN default_restock_pct INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'default_safety_pct';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN default_safety_pct INT NULL;
    END IF;

    -- Orders by hub and time, for the brand sales report.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'ix_orders_site_created';
    IF n = 0 THEN
        ALTER TABLE orders ADD INDEX ix_orders_site_created (site_id, created_at);
    END IF;
END$$

DELIMITER ;

CALL wms_v26_upgrade();
DROP PROCEDURE wms_v26_upgrade;
