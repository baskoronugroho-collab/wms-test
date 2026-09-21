-- Ops HQ workflows: SKU onboarding defaults, requests from stations for an
-- unregistered product, and replenishment to the brand (Surat Jalan).
--
-- The `hq` role needs no DDL: users.role is a VARCHAR validated in auth.py.
--
-- Defensive like V8-V16: every ALTER checks information_schema first, so the
-- file is safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v17_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v17_upgrade()
BEGIN
    DECLARE n INT;

    -- Thresholds are asked for when the SKU is registered, and copied onto the
    -- SKU's pick face at each hub when it gets a rack. A hub can still override
    -- its own copy in the registry.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'default_restock_point';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN default_restock_point INT NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'skus'
        AND COLUMN_NAME = 'default_full_threshold';
    IF n = 0 THEN
        ALTER TABLE skus ADD COLUMN default_full_threshold INT NULL;
    END IF;

    -- A receipt opened against a confirmed replenishment carries its expected
    -- quantities, so the variance against Wardah's confirmation is computable.
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inbound_receipts'
        AND COLUMN_NAME = 'replenishment_id';
    IF n = 0 THEN
        ALTER TABLE inbound_receipts ADD COLUMN replenishment_id BIGINT NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v17_upgrade();
DROP PROCEDURE wms_v17_upgrade;

-- --------------------------------------------------------------------------
-- A staffer found a product the WMS does not know. The units wait in the
-- station's temporary inbound bin; HQ registers the SKU and gives it a rack at
-- that station; the staffer puts the units away and they enter the ledger then.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sku_requests (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    site_id         BIGINT       NOT NULL,
    receipt_id      BIGINT       NULL,
    brand_id        BIGINT       NULL,
    barcode         VARCHAR(64)  NULL,
    qty_counted     INT          NOT NULL,
    photo_key       VARCHAR(400) NULL,
    note            VARCHAR(400) NULL,
    -- open | resolved | rejected | put_away
    status          VARCHAR(32)  NOT NULL DEFAULT 'open',
    raised_by       VARCHAR(255) NULL,
    raised_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sku_id          BIGINT       NULL,
    location_id     BIGINT       NULL,
    resolution_note VARCHAR(400) NULL,
    resolved_by     VARCHAR(255) NULL,
    resolved_at     DATETIME     NULL,
    qty_put_away    INT          NULL,
    put_away_by     VARCHAR(255) NULL,
    put_away_at     DATETIME     NULL,
    PRIMARY KEY (id),
    KEY ix_skureq_status (status, raised_at),
    KEY ix_skureq_site (site_id, status, raised_at)
) DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------------------------
-- Replenishment to the brand. HQ drafts it from the threshold alerts, sends it
-- to Wardah by hand, then records Wardah's AWB, Surat Jalan number and the
-- quantities Wardah confirmed. Staff receive against the AWB.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replenishments (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    reference       VARCHAR(32)  NOT NULL,
    site_id         BIGINT       NOT NULL,
    brand_id        BIGINT       NOT NULL,
    -- draft | sent | confirmed | received | cancelled
    status          VARCHAR(32)  NOT NULL DEFAULT 'draft',
    awb             VARCHAR(64)  NULL,
    surat_jalan_no  VARCHAR(64)  NULL,
    eta_date        DATE         NULL,
    note            VARCHAR(400) NULL,
    created_by      VARCHAR(255) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_by         VARCHAR(255) NULL,
    sent_at         DATETIME     NULL,
    confirmed_by    VARCHAR(255) NULL,
    confirmed_at    DATETIME     NULL,
    receipt_id      BIGINT       NULL,
    received_at     DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_replenishments_ref (reference),
    KEY ix_replenishments_awb (awb),
    KEY ix_replenishments_site (site_id, status, created_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS replenishment_lines (
    id                BIGINT NOT NULL AUTO_INCREMENT,
    replenishment_id  BIGINT NOT NULL,
    sku_id            BIGINT NOT NULL,
    qty_requested     INT    NOT NULL,
    qty_confirmed     INT    NULL,
    qty_received      INT    NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_replenishment_sku (replenishment_id, sku_id),
    KEY ix_replenishment_lines (replenishment_id)
) DEFAULT CHARSET=utf8mb4;
