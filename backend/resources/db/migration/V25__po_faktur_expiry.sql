-- V25: restock to the brand with the PO, the signed Faktur, extra units and
-- expiry dates (PRD §4.1, §4.4, §5.1 steps 7 to 9, §5.3.8, §5.3.9, §5.5).
--
--   draft -> raised -> po -> sent -> confirmed -> receiving -> (variance) -> received
--
-- `raised`: the SPV raised the draft to Ops HQ. `po`: Ops HQ saved the PO and the
-- quantities are frozen. Only Ops HQ sends it to the brand (decided 30 Sep).
-- `status` is a VARCHAR, so the new states need no DDL of their own.
--
-- Re-runnable and conservative for OceanBase: every ALTER checks
-- information_schema first and makes one change; new tables are CREATE TABLE
-- IF NOT EXISTS with plain indexed columns and no foreign keys; settings rows
-- use ON DUPLICATE KEY.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v25_upgrade$$
CREATE PROCEDURE wms_v25_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- Step 2: the SPV raised the draft to Ops HQ (*Ajukan ke Ops HQ*).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'raised_by';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN raised_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'raised_at';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN raised_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'raise_note';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN raise_note VARCHAR(400) NULL;
    END IF;

    -- Step 3: Ops HQ saved the PO (*Simpan PO*); quantities are frozen from here.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_saved_by';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_saved_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_saved_at';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_saved_at DATETIME NULL;
    END IF;

    -- The PO header, filled by the WMS and editable by Ops HQ until the PO is sent (§4.4.5).
    -- The PO number itself stays `reference`.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_date';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_date DATE NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_to';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_to VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_brand_contact';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_brand_contact VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_deliver_to';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_deliver_to VARCHAR(400) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_receiving_hours';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_receiving_hours VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_requested_date';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_requested_date DATE NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_created_by_name';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_created_by_name VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'po_note';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN po_note VARCHAR(400) NULL;
    END IF;

    -- What the hub held and the fill-up-to number when the PO was saved, so the
    -- Excel downloaded next week still says what Ops HQ saw.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'stock_at_po';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN stock_at_po INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'fill_to_at_po';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN fill_to_at_po INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'po_note';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN po_note VARCHAR(255) NULL;
    END IF;

    -- Expiry from the Faktur, month precision, stored as the LAST day of that month
    -- (an ED printed 03/2027 is good through 31 March 2027). NULL with
    -- expiry_entered_at set = the Faktur lists no ED: aged from the inbound date.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'expiry_date';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN expiry_date DATE NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'expiry_entered_by';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN expiry_entered_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'expiry_entered_at';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN expiry_entered_at DATETIME NULL;
    END IF;

    -- The signed Faktur (§5.3.8). A completed brand receipt is waiting for its Faktur
    -- until this is set; the pages are in faktur_documents.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'faktur_uploaded_at';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN faktur_uploaded_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'faktur_uploaded_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN faktur_uploaded_by VARCHAR(255) NULL;
    END IF;

    -- The batch record: one SKU in one delivery batch. The ED is copied here from
    -- the replenishment line so a later build can send the picker by ED (§5.5.2).
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipt_lines'
        AND COLUMN_NAME = 'expiry_date';
    IF n = 0 THEN
        ALTER TABLE receipt_lines ADD COLUMN expiry_date DATE NULL;
    END IF;

    -- "Faktur to upload" is asked per hub on every to-do refresh.
    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND INDEX_NAME = 'ix_receipts_faktur';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD INDEX ix_receipts_faktur (site_id, faktur_uploaded_at);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND INDEX_NAME = 'ix_receipts_replenishment';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD INDEX ix_receipts_replenishment (replenishment_id);
    END IF;
END$$

DELIMITER ;

CALL wms_v25_upgrade();
DROP PROCEDURE wms_v25_upgrade;

-- The pages of a signed Faktur, photographed or scanned by the SPV after the
-- inbound (§5.1 step 8). One row per file. replenishment_id is copied from the
-- receipt so the PO screen can show the Faktur without walking the batches.
CREATE TABLE IF NOT EXISTS faktur_documents (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id       BIGINT       NOT NULL,
    replenishment_id BIGINT       NULL,
    site_id          BIGINT       NOT NULL,
    storage_key      VARCHAR(200) NOT NULL,
    content_type     VARCHAR(64)  NOT NULL,
    file_name        VARCHAR(255) NULL,
    size_bytes       INT          NULL,
    page_no          INT          NOT NULL DEFAULT 1,
    uploaded_by      VARCHAR(255) NOT NULL,
    uploaded_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_faktur_key (storage_key),
    KEY ix_faktur_receipt (receipt_id),
    KEY ix_faktur_replenishment (replenishment_id)
) DEFAULT CHARSET=utf8mb4;

-- Differences at receiving the SPV raises to Ops HQ (§5.1 step 9, §4.4.6).
--   kind    extra | short | damaged | other
--   status  open | settled
-- Short and damaged units still go through the variance approval on the
-- replenishment as well; extra units are settled here, by Ops HQ with the brand
-- by email, and closed with the outcome.
CREATE TABLE IF NOT EXISTS faktur_issues (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id       BIGINT       NOT NULL,
    replenishment_id BIGINT       NULL,
    site_id          BIGINT       NOT NULL,
    sku_id           BIGINT       NULL,
    kind             VARCHAR(16)  NOT NULL,
    qty              INT          NULL,
    note             VARCHAR(400) NULL,
    status           VARCHAR(16)  NOT NULL DEFAULT 'open',
    raised_by        VARCHAR(255) NOT NULL,
    raised_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_by       VARCHAR(255) NULL,
    settled_at       DATETIME     NULL,
    outcome          VARCHAR(400) NULL,
    PRIMARY KEY (id),
    KEY ix_faktur_issues_status (status, site_id),
    KEY ix_faktur_issues_receipt (receipt_id),
    KEY ix_faktur_issues_replenishment (replenishment_id)
) DEFAULT CHARSET=utf8mb4;

-- Settings, editable like every other number (§4.8).
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('stock_old_days',    1, 180),   -- no ED: flag Stok lama when a batch is older than N days (§5.5.1b)
  ('ed_near_days',      1, 90),    -- flag ED dekat N days before expiry (§5.5.3)
  ('faktur_spv_hours',  1, 24),    -- Faktur not uploaded N h after inbound: to the SPV (§5.3.8)
  ('faktur_hq_hours',   1, 48)     -- ... and after N h to Ops HQ
ON DUPLICATE KEY UPDATE rule_key = rule_key;
