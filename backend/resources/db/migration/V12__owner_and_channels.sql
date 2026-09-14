-- Aligns the ledger and orders with the canonical system design
-- (docs/canonical/qc-oms-wms.html, ChangWen, 11 Sep 2026).
--
-- 1. STOCK OWNER. "The WMS ledger records who owns each unit, not only the
--    brand." Three dark-store models run through the same system:
--      Wardah            -> owned by Grab
--      brand consignment -> owned by the brand
--      Ninja's own range -> owned by Ninja
--    Owner is set per brand, overridable per brand x site, and stamped on every
--    movement and balance so the ledger answers "whose stock is this" directly.
--
-- 2. ORDER CHANNEL. Every order enters through Hiryu, from any channel, and
--    carries where it came from, how it will leave, and when it is promised.
--    Grab: 15 min from reaching Hiryu. Own channels: 1 hour from placement.
--
-- Defensive like V8-V11: safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v12_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v12_upgrade()
BEGIN
    DECLARE n INT;

    -- owner defaults ------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brands'
        AND COLUMN_NAME = 'default_stock_owner';
    IF n = 0 THEN
        ALTER TABLE brands
          ADD COLUMN default_stock_owner VARCHAR(16) NOT NULL DEFAULT 'brand';
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'brand_sites'
        AND COLUMN_NAME = 'stock_owner';
    IF n = 0 THEN
        ALTER TABLE brand_sites ADD COLUMN stock_owner VARCHAR(16) NULL;
    END IF;

    -- owner on the ledger -------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_movements'
        AND COLUMN_NAME = 'stock_owner';
    IF n = 0 THEN
        ALTER TABLE stock_movements ADD COLUMN stock_owner VARCHAR(16) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_balances'
        AND COLUMN_NAME = 'stock_owner';
    IF n = 0 THEN
        ALTER TABLE inventory_balances ADD COLUMN stock_owner VARCHAR(16) NULL;
    END IF;

    -- order channel -------------------------------------------------------
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'channel';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN channel VARCHAR(32) NOT NULL DEFAULT 'grab';
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'delivery_mode';
    IF n = 0 THEN
        ALTER TABLE orders
          ADD COLUMN delivery_mode VARCHAR(32) NOT NULL DEFAULT 'grab_rider';
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'placed_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN placed_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'promised_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN promised_at DATETIME NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v12_upgrade();
DROP PROCEDURE wms_v12_upgrade;

-- Wardah is model 1: the stock on the shelf belongs to Grab.
UPDATE brands SET default_stock_owner = 'grab' WHERE code = 'WRD';

-- Existing ledger rows inherit their brand's owner.
UPDATE stock_movements sm
  JOIN skus s   ON s.id = sm.sku_id
  JOIN brands b ON b.id = s.brand_id
   SET sm.stock_owner = b.default_stock_owner
 WHERE sm.stock_owner IS NULL;

UPDATE inventory_balances ib
  JOIN skus s   ON s.id = ib.sku_id
  JOIN brands b ON b.id = s.brand_id
   SET ib.stock_owner = b.default_stock_owner
 WHERE ib.stock_owner IS NULL;

-- Orders already in the system were all Grab orders; give them a promise so the
-- queue can sort them by time remaining.
UPDATE orders
   SET promised_at = DATE_ADD(created_at, INTERVAL 15 MINUTE)
 WHERE promised_at IS NULL;
