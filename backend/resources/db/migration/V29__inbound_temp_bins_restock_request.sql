-- V29: restock request with the Ninja reference and the brand's PO number; inbound
-- by unit into temporary bins, batch putaway, differences approved by Ops HQ
-- (canvas sections 4 and 5, decisions of 1 and 5 Oct 2026).
--
--   * The request has no PO number of ours. Its key stays `replenishments.reference`,
--     now the Ninja reference RPL-<hub>-<yymm>-<nnn> minted when Ops HQ makes the
--     request (yymm = that month). The brand answers with its own PO number,
--     stored with the brand (brand_po_number; may repeat across brands).
--   * ED tracking is dropped. The expiry columns of V25 stay but are no longer
--     written; stock age counts from the inbound date (inventory_balances
--     .stocked_since) and `stock_old_days` (now 90) flags Stok lama.
--   * Units counted at inbound are NOT stock: they sit in a temporary bin
--     (inbound_bin_loads) until the rack-bin scan puts them away through the
--     ledger. Extras and units of a delivery with no PO wait there for Ops HQ.
--   * Every difference (short, extra, damaged) waits in inbound_differences for
--     Ops HQ's approval within 24 hours before it reaches stock and billing.
--
-- Re-runnable and conservative (OceanBase): every ALTER checks information_schema
-- first and makes one change; new tables are CREATE TABLE IF NOT EXISTS with no
-- foreign keys; settings use ON DUPLICATE KEY. Status columns are VARCHAR,
-- validated in routers/inbound.py and routers/replenishment.py.

DELIMITER $$

DROP PROCEDURE IF EXISTS wms_v29_upgrade$$
CREATE PROCEDURE wms_v29_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    -- Restock request: the brand's own PO number, recorded at *Catat konfirmasi merek*.
    -- Two brands may use the same number, so it is only ever looked up with the brand.

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'brand_po_number';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN brand_po_number VARCHAR(64) NULL;
    END IF;

    -- Who sent the confirmation numbers in (confirmed_by/at already exist) and the
    -- brand's note, if any.

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'brand_note';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN brand_note VARCHAR(400) NULL;
    END IF;

    -- Ops HQ's note to the brand when deciding the differences (*Catatan untuk merek*).

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND COLUMN_NAME = 'brand_claim_note';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD COLUMN brand_claim_note VARCHAR(1000) NULL;
    END IF;

    -- Per SKU: a barcode the brand wrote in the yellow column, and the number the brand
    -- bills once Ops HQ has approved every difference (*Ditagih*).

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'brand_barcode';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN brand_barcode VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishment_lines'
        AND COLUMN_NAME = 'qty_billed';
    IF n = 0 THEN
        ALTER TABLE replenishment_lines ADD COLUMN qty_billed INT NULL;
    END IF;

    -- The door check: cartons on the Surat Jalan and cartons counted. A difference waits
    -- for the SPV: accept_rewrite (raised to Ops HQ at once) or refuse.

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'sj_cartons';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN sj_cartons INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'counted_cartons';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN counted_cartons INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'carton_decision';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN carton_decision VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'carton_decided_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN carton_decided_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'carton_decided_at';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN carton_decided_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'carton_seen_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN carton_seen_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'carton_seen_at';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN carton_seen_at DATETIME NULL;
    END IF;

    -- A delivery with no PO the WMS knows: the number typed, raised to Ops HQ at once,
    -- counted into temporary bins but not stock until Ops HQ links it to a request.

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'no_po';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN no_po TINYINT(1) NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'no_po_code';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN no_po_code VARCHAR(64) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'no_po_raised_at';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN no_po_raised_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'no_po_linked_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN no_po_linked_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'no_po_linked_at';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN no_po_linked_at DATETIME NULL;
    END IF;

    -- End of receiving (*Semua barang sudah diterima*): who signed the Surat Jalan,
    -- who finished, and the 24-hour deadline for Ops HQ to approve the differences.

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'sj_signed_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN sj_signed_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'finished_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN finished_by VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'decide_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN decide_by DATETIME NULL;
    END IF;

    -- Per SKU on a receipt: units counted damaged, and units picked from the list
    -- because the product has no barcode (seen by the SPV).

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipt_lines'
        AND COLUMN_NAME = 'qty_damaged';
    IF n = 0 THEN
        ALTER TABLE receipt_lines ADD COLUMN qty_damaged INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipt_lines'
        AND COLUMN_NAME = 'qty_manual';
    IF n = 0 THEN
        ALTER TABLE receipt_lines ADD COLUMN qty_manual INT NOT NULL DEFAULT 0;
    END IF;

    -- Opening a delivery by the brand's PO number, Ops HQ's lists.

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND INDEX_NAME = 'ix_replenishments_brand_po';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD INDEX ix_replenishments_brand_po (brand_id, brand_po_number);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'replenishments'
        AND INDEX_NAME = 'ix_replenishments_site_po';
    IF n = 0 THEN
        ALTER TABLE replenishments ADD INDEX ix_replenishments_site_po (site_id, brand_po_number);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND INDEX_NAME = 'ix_receipts_no_po';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD INDEX ix_receipts_no_po (no_po, no_po_linked_at);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND INDEX_NAME = 'ix_receipts_decide_by';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD INDEX ix_receipts_decide_by (site_id, decide_by);
    END IF;

END$$

DELIMITER ;

CALL wms_v29_upgrade();
DROP PROCEDURE wms_v29_upgrade;

-- One product in one temporary inbound bin for one delivery (one SKU per bin).
--   status   filling   units are being scanned into it
--            full      *Bin penuh*: the product continues in the next free bin
--            batched   *Selesai batch ini*: on the putaway list
--            held      waits for Ops HQ (extra units, or a delivery with no PO)
--            return    extra units Ops HQ rejected: on the return-to-brand list
--            done      emptied (put away, or handed back); the bin is free again
--   qty_hold units in it that may not go to the rack yet (extra units, or the
--            excess found when a no-PO delivery is linked to a request).
-- A bin is occupied while it has a row in filling, full, batched, held or return.
CREATE TABLE IF NOT EXISTS inbound_bin_loads (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    site_id            BIGINT       NOT NULL,
    receipt_id         BIGINT       NOT NULL,
    sku_id             BIGINT       NOT NULL,
    bin_code           VARCHAR(48)  NOT NULL,
    is_extra           TINYINT(1)   NOT NULL DEFAULT 0,
    status             VARCHAR(16)  NOT NULL DEFAULT 'filling',
    qty                INT          NOT NULL DEFAULT 0,
    qty_put            INT          NOT NULL DEFAULT 0,
    qty_hold           INT          NOT NULL DEFAULT 0,
    batch_no           INT          NULL,
    label_scanned_at   DATETIME     NULL,
    label_scanned_by   VARCHAR(255) NULL,
    opened_by          VARCHAR(255) NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    full_at            DATETIME     NULL,
    batched_at         DATETIME     NULL,
    done_at            DATETIME     NULL,
    done_by            VARCHAR(255) NULL,
    PRIMARY KEY (id),
    KEY ix_bin_loads_site_bin (site_id, bin_code, status),
    KEY ix_bin_loads_receipt (receipt_id, sku_id),
    KEY ix_bin_loads_status (site_id, status)
) DEFAULT CHARSET=utf8mb4;

-- Every unit counted at inbound, one row per +1 or -1 (scan, list pick, undo).
--   method   scan | manual (picked from the list: the product has no barcode)
--   damaged  1 = counted damaged; damage_to quarantine | driver
-- undo_of points at the row a -1 takes back.
CREATE TABLE IF NOT EXISTS inbound_units (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id     BIGINT       NOT NULL,
    site_id        BIGINT       NOT NULL,
    sku_id         BIGINT       NOT NULL,
    load_id        BIGINT       NULL,
    difference_id  BIGINT       NULL,
    qty            INT          NOT NULL,
    method         VARCHAR(8)   NOT NULL DEFAULT 'scan',
    damaged        TINYINT(1)   NOT NULL DEFAULT 0,
    damage_to      VARCHAR(16)  NULL,
    code           VARCHAR(64)  NULL,
    undo_of        BIGINT       NULL,
    actor_email    VARCHAR(255) NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_inbound_units_receipt (receipt_id, created_at),
    KEY ix_inbound_units_manual (site_id, method, created_at),
    KEY ix_inbound_units_undo (undo_of)
) DEFAULT CHARSET=utf8mb4;

-- Each move from a temporary bin to a rack bin, confirmed by the rack label scan.
-- The ledger movement (receipt_in) makes the units sellable and tells Hiryu.
CREATE TABLE IF NOT EXISTS inbound_putaways (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    load_id        BIGINT       NOT NULL,
    receipt_id     BIGINT       NOT NULL,
    site_id        BIGINT       NOT NULL,
    sku_id         BIGINT       NOT NULL,
    location_id    BIGINT       NOT NULL,
    location_code  VARCHAR(48)  NOT NULL,
    qty            INT          NOT NULL,
    movement_id    BIGINT       NULL,
    day_color_key  VARCHAR(16)  NULL,
    actor_email    VARCHAR(255) NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_inbound_putaways_receipt (receipt_id),
    KEY ix_inbound_putaways_load (load_id)
) DEFAULT CHARSET=utf8mb4;

-- Differences of a delivery, for Ops HQ to approve within 24 hours (*Selesaikan
-- selisih*). Nothing reaches stock or billing before status = approved.
--   kind      short | extra | damaged
--   place     damaged: quarantine (tray <HUB>-QR-01) | driver (back on the Surat
--             Jalan); extra: 'bin'; short: 'none'
--   decision  extra: accept (put away, billed) | reject (return to the brand);
--             short and damaged: approve
--   status    pending | approved
CREATE TABLE IF NOT EXISTS inbound_differences (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id       BIGINT       NOT NULL,
    replenishment_id BIGINT       NULL,
    site_id          BIGINT       NOT NULL,
    sku_id           BIGINT       NOT NULL,
    kind             VARCHAR(16)  NOT NULL,
    place            VARCHAR(16)  NOT NULL DEFAULT 'none',
    bin_code         VARCHAR(48)  NULL,
    qty              INT          NOT NULL DEFAULT 0,
    status           VARCHAR(16)  NOT NULL DEFAULT 'pending',
    decision         VARCHAR(16)  NULL,
    note             VARCHAR(400) NULL,
    created_by       VARCHAR(255) NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decide_by        DATETIME     NULL,
    decided_by       VARCHAR(255) NULL,
    decided_at       DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inbound_diff (receipt_id, sku_id, kind, place),
    KEY ix_inbound_diff_status (status, site_id, decide_by),
    KEY ix_inbound_diff_replenishment (replenishment_id)
) DEFAULT CHARSET=utf8mb4;

-- Photos taken at inbound, in the private bucket under docs/inbound/, streamed back
-- to the SPV and Ops HQ only.
--   kind  sj_signed | selfie | sj_driver   the three required at the end
--         sj_no_po                         the Surat Jalan of a delivery with no PO
--         damage                           one per damaged product (difference_id)
CREATE TABLE IF NOT EXISTS inbound_photos (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id     BIGINT       NOT NULL,
    site_id        BIGINT       NOT NULL,
    kind           VARCHAR(16)  NOT NULL,
    difference_id  BIGINT       NULL,
    storage_key    VARCHAR(200) NOT NULL,
    content_type   VARCHAR(64)  NOT NULL,
    size_bytes     INT          NULL,
    uploaded_by    VARCHAR(255) NOT NULL,
    uploaded_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inbound_photo_key (storage_key),
    KEY ix_inbound_photos_receipt (receipt_id, kind)
) DEFAULT CHARSET=utf8mb4;

-- Settings (editable on Aturan & waktu like every other number).
INSERT INTO alert_rules (rule_key, enabled, value_num, updated_at) VALUES
  ('stock_old_days',          1, 90, UTC_TIMESTAMP()),   -- a batch older than N days from its inbound date: Stok lama
  ('difference_decide_hours', 1, 24, UTC_TIMESTAMP()),   -- Ops HQ approves inbound differences within N hours
  ('no_po_alert_minutes',     1, 30, UTC_TIMESTAMP()),   -- a delivery with no PO unanswered N minutes: alert the Ops Head
  ('default_temp_bins',       1, 6, UTC_TIMESTAMP())     -- temporary inbound bins a hub has before the SPV adds more
ON DUPLICATE KEY UPDATE rule_key = rule_key;

-- ED tracking is dropped (5 Oct): age counts from the inbound date. The old default
-- of 180 days becomes 90, unless someone already changed it. updated_at is set
-- explicitly: ON UPDATE would stamp the migration session's clock (UTC+8, V13).
UPDATE alert_rules SET value_num = 90, updated_at = UTC_TIMESTAMP()
 WHERE rule_key = 'stock_old_days' AND value_num = 180;
UPDATE alert_rules SET enabled = 0, updated_at = UTC_TIMESTAMP()
 WHERE rule_key = 'ed_near_days' AND enabled <> 0;
