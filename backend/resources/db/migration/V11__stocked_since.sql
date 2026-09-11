-- When did the stock currently at this location arrive?
--
-- Decision 13 (PRD 5.7): when a SKU sits in both its rack and an overflow slot,
-- the picker goes to whichever holds the OLDER stock. The WMS cannot know that
-- per unit in Mode A, but it can know it per location: the moment a location
-- goes from empty to stocked is when its current batch began. Within the
-- location, FIFO is the coloured divider, chosen by eye.
--
-- Defensive, like V8-V10: safe to re-run from any partial state.

DROP PROCEDURE IF EXISTS wms_v11_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v11_upgrade()
BEGIN
    DECLARE n INT;
    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventory_balances'
        AND COLUMN_NAME = 'stocked_since';
    IF n = 0 THEN
        ALTER TABLE inventory_balances ADD COLUMN stocked_since DATETIME NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v11_upgrade();
DROP PROCEDURE wms_v11_upgrade;

-- Everything already on a shelf gets its batch start from the earliest inbound
-- movement into that location. Approximate, but it is only ever used to order
-- two locations against each other, and it corrects itself the next time
-- either one empties.
UPDATE inventory_balances ib
   SET stocked_since = (
       SELECT MIN(sm.created_at) FROM stock_movements sm
        WHERE sm.site_id = ib.site_id AND sm.sku_id = ib.sku_id
          AND sm.location_id = ib.location_id AND sm.qty_delta > 0)
 WHERE ib.qty_on_hand > 0 AND ib.stocked_since IS NULL;
