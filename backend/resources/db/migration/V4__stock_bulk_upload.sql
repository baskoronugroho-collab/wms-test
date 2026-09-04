-- Alur A, Option C — bulk stock upload.
--
-- product_default_locations is the "brand + product name + default location"
-- master data the upload validates against (PRD conversation, M3 addendum).
-- It is deliberately its own table, separate from skus/slot_assignments, so
-- this feature cannot disturb the existing receiving/picking/opname flows —
-- it only reads a location code out of it, then goes through the same
-- ledger/slot machinery every other inbound path uses.
--
-- stock_uploads / stock_upload_rows record what a batch did, for the
-- "see all uploaded stock" screen. A row is only ever inserted for a batch
-- that fully validated — this feature is all-or-nothing per file.

CREATE TABLE product_default_locations (
    id                    BIGINT      NOT NULL AUTO_INCREMENT,
    brand_id              BIGINT      NOT NULL,
    sku_id                BIGINT      NOT NULL,
    default_location_code VARCHAR(48) NOT NULL,
    created_at            DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_default_location_sku (sku_id),
    KEY ix_default_location_brand (brand_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE stock_uploads (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    filename     VARCHAR(255) NULL,
    uploaded_by  VARCHAR(255) NULL,
    row_count    INT          NOT NULL DEFAULT 0,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE stock_upload_rows (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    upload_id     BIGINT      NOT NULL,
    row_no        INT         NOT NULL,
    site_id       BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    location_id   BIGINT      NOT NULL,
    barcode       VARCHAR(64) NOT NULL,
    input_date_raw VARCHAR(32) NULL,
    location_was_blank TINYINT(1) NOT NULL DEFAULT 0,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_upload_rows_upload (upload_id),
    KEY ix_upload_rows_site (site_id, created_at)
) DEFAULT CHARSET=utf8mb4;

-- Dummy master data so the flow is testable before the real product master is
-- ready: default locations for the first 10 Wardah SKUs at the training site,
-- matching the empty baskets already seeded at TRN-A-1-01..TRN-A-2-02 (V2).
INSERT INTO product_default_locations (brand_id, sku_id, default_location_code) VALUES
  (1, 1, 'TRN-A-1-01'),
  (1, 2, 'TRN-A-1-02'),
  (1, 3, 'TRN-A-1-03'),
  (1, 4, 'TRN-A-2-01'),
  (1, 5, 'TRN-A-2-02'),
  (1, 6, 'TRN-A-2-03'),
  (1, 7, 'TRN-A-3-01'),
  (1, 8, 'TRN-A-3-02'),
  (1, 9, 'TRN-A-3-03'),
  (1, 10, 'TRN-A-4-01');
