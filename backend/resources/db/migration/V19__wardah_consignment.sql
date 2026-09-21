-- Consignment is the agreed deal (21 Sep 2026): Wardah owns its stock until it
-- is sold. V12 recorded Wardah as Grab's inventory.
--
-- The brand default and any per-hub override move to 'brand', and so does the
-- owner on today's balances, because that is who owns the units on the shelf
-- now. Movements keep the owner they were written with: history is history.
-- Re-runnable: every statement is idempotent.

UPDATE brands SET default_stock_owner = 'brand' WHERE code = 'WRD';

UPDATE brand_sites bs
  JOIN brands b ON b.id = bs.brand_id
   SET bs.stock_owner = NULL
 WHERE b.code = 'WRD' AND bs.stock_owner = 'grab';

UPDATE inventory_balances ib
  JOIN skus s ON s.id = ib.sku_id
  JOIN brands b ON b.id = s.brand_id
   SET ib.stock_owner = 'brand'
 WHERE b.code = 'WRD' AND ib.stock_owner = 'grab';
