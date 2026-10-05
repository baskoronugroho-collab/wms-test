-- V30: kick-off, racks and products for deploy 3 (canvas sections 2 and 3).
--
--   sites       a hub that arrives from Hiryu (message 6) and what Ops HQ completes
--               on Hub & mulai operasi: the real hub code and the special bins.
--               A hub with hiryu_dark_store_id set and setup_completed_at NULL is
--               "Baru dari Hiryu". Agent L creates it with the placeholder code
--               HY<dark store id>; Ops HQ sets the real code (MA5) once.
--   racks       kolom per level (a kolom is the part of the rack between two
--               uprights; never "bay") and when the labels were printed.
--   locations   which kolom a bin stands in, and the label check (Cek label).
--   brands      company, restock e-mail, barcodes on the packs, and the Grab
--               merchant account: own | ninja (Ninja Van's, acting as Nemu Mart).
--   users       "Login Hiryu sudah dibuat", first sign-in, when the account closed.
--   special_bins   temporary inbound bins <HUB>-IN-NN, quarantine trays
--               <HUB>-QR-NN, outbound baskets <HUB>-OUT-NN. Each also gets a
--               locations row (level_id 0, so no rack query sees it) for stock.
--   hub_kickoff_marks   steps of Mulai operasi ticked by hand (Tandai selesai).
--   Bin sizes are two now: KECIL and BESAR (S becomes KECIL, the rest BESAR).
--
-- Re-runnable and conservative (OceanBase): every ALTER checks
-- information_schema first and makes exactly one change; no foreign keys; new
-- tables are CREATE TABLE IF NOT EXISTS; settings rows use ON DUPLICATE KEY.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v30_upgrade$$
CREATE PROCEDURE wms_v30_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- ------------------------------------------------------------------ sites
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'hiryu_dark_store_id';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN hiryu_dark_store_id INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'opening_hours_json';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN opening_hours_json TEXT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'hiryu_received_at';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN hiryu_received_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'setup_completed_at';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN setup_completed_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'setup_completed_by';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN setup_completed_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'quarantine_trays';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN quarantine_trays INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND COLUMN_NAME = 'outbound_baskets';
    IF n = 0 THEN
        ALTER TABLE sites ADD COLUMN outbound_baskets INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'
        AND INDEX_NAME = 'uq_sites_hiryu_dark_store';
    IF n = 0 THEN
        CREATE UNIQUE INDEX uq_sites_hiryu_dark_store ON sites (hiryu_dark_store_id);
    END IF;

    -- ------------------------------------------------------------------ racks
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'racks'
        AND COLUMN_NAME = 'kolom_count';
    IF n = 0 THEN
        ALTER TABLE racks ADD COLUMN kolom_count INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'racks'
        AND COLUMN_NAME = 'labels_printed_at';
    IF n = 0 THEN
        ALTER TABLE racks ADD COLUMN labels_printed_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'racks'
        AND COLUMN_NAME = 'created_by';
    IF n = 0 THEN
        ALTER TABLE racks ADD COLUMN created_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'racks'
        AND COLUMN_NAME = 'created_at';
    IF n = 0 THEN
        ALTER TABLE racks ADD COLUMN created_at DATETIME NULL;
    END IF;

    -- -------------------------------------------------------------- locations
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND COLUMN_NAME = 'kolom_no';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN kolom_no INT NULL;
    END IF;

    -- Cek label: ok | wrong (the label scanned belongs to another bin). NULL = not checked.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND COLUMN_NAME = 'label_check_state';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN label_check_state VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND COLUMN_NAME = 'label_check_scanned';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN label_check_scanned VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND COLUMN_NAME = 'label_checked_at';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN label_checked_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
        AND COLUMN_NAME = 'label_checked_by';
    IF n = 0 THEN
        ALTER TABLE locations ADD COLUMN label_checked_by VARCHAR(255) NULL;
    END IF;

    -- ----------------------------------------------------------------- brands
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
        AND COLUMN_NAME = 'company';
    IF n = 0 THEN
        ALTER TABLE brands ADD COLUMN company VARCHAR(160) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
        AND COLUMN_NAME = 'restock_email';
    IF n = 0 THEN
        ALTER TABLE brands ADD COLUMN restock_email VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
        AND COLUMN_NAME = 'has_barcodes';
    IF n = 0 THEN
        ALTER TABLE brands ADD COLUMN has_barcodes TINYINT(1) NULL;
    END IF;

    -- own = the brand's own Grab merchant account; ninja = Ninja Van's account
    -- acting as Nemu Mart (brands under 10 SKUs). NULL = not chosen yet.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
        AND COLUMN_NAME = 'grab_account';
    IF n = 0 THEN
        ALTER TABLE brands ADD COLUMN grab_account VARCHAR(16) NULL;
    END IF;

    -- ------------------------------------------------------------------ users
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'hiryu_login';
    IF n = 0 THEN
        ALTER TABLE users ADD COLUMN hiryu_login TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'first_login_at';
    IF n = 0 THEN
        ALTER TABLE users ADD COLUMN first_login_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'deactivated_at';
    IF n = 0 THEN
        ALTER TABLE users ADD COLUMN deactivated_at DATETIME NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v30_upgrade();
DROP PROCEDURE wms_v30_upgrade;

-- Special bins. kind IN | QR | OUT; seq numbers from 1 per hub and kind; code is
-- <HUB>-<KIND>-NN. location_id is the bin's own locations row (level_id 0).
CREATE TABLE IF NOT EXISTS special_bins (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    site_id          BIGINT       NOT NULL,
    kind             VARCHAR(8)   NOT NULL,
    seq              INT          NOT NULL,
    code             VARCHAR(48)  NOT NULL,
    location_id      BIGINT       NULL,
    active           TINYINT(1)   NOT NULL DEFAULT 1,
    label_printed_at DATETIME     NULL,
    created_by       VARCHAR(255) NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_special_bins_code (code),
    UNIQUE KEY uq_special_bins_seq (site_id, kind, seq),
    KEY ix_special_bins_site (site_id, kind, active)
) DEFAULT CHARSET=utf8mb4;

-- Mulai operasi: a step a person ticked (Tandai selesai). The steps the WMS can
-- see are worked out live and never stored.
CREATE TABLE IF NOT EXISTS hub_kickoff_marks (
    site_id      BIGINT       NOT NULL,
    step_key     VARCHAR(48)  NOT NULL,
    done_by      VARCHAR(255) NOT NULL,
    done_by_name VARCHAR(160) NULL,
    done_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note         VARCHAR(255) NULL,
    PRIMARY KEY (site_id, step_key)
) DEFAULT CHARSET=utf8mb4;

-- Two bin sizes only (decided 1 Oct): S becomes KECIL, M, L and OPEN become BESAR.
UPDATE baskets SET basket_size = 'KECIL' WHERE basket_size = 'S';
UPDATE baskets SET basket_size = 'BESAR' WHERE basket_size IN ('M', 'L', 'OPEN');
UPDATE skus SET bin_size = 'KECIL' WHERE bin_size = 'S';
UPDATE skus SET bin_size = 'BESAR' WHERE bin_size IN ('M', 'L', 'OPEN');

-- Racks built before kolom existed: one kolom per level.
UPDATE racks SET kolom_count = 1 WHERE kolom_count IS NULL;
UPDATE locations SET kolom_no = 1 WHERE kolom_no IS NULL AND level_id > 0;

-- Hubs made before the Hiryu link are already in use: no "Baru dari Hiryu" banner.
UPDATE sites SET setup_completed_at = created_at
 WHERE setup_completed_at IS NULL AND hiryu_dark_store_id IS NULL;

-- The bin size guide on Produk (Ukuran bin), editable by Ops HQ on Aturan & waktu:
-- Kecil fits a 15 x 10 x 20 cm box; a bottle of 150 ml or more is Besar.
INSERT INTO alert_rules (rule_key, enabled, value_num, updated_at) VALUES
  ('bin_kecil_length_cm', 1, 15, UTC_TIMESTAMP()),
  ('bin_kecil_width_cm',  1, 10, UTC_TIMESTAMP()),
  ('bin_kecil_height_cm', 1, 20, UTC_TIMESTAMP()),
  ('bin_besar_bottle_ml', 1, 150, UTC_TIMESTAMP())
ON DUPLICATE KEY UPDATE rule_key = rule_key;
