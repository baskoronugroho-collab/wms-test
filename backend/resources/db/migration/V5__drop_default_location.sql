-- Default storage location per product turned out to be the wrong shape: a
-- location code embeds its hub's prefix (TRN-A-1-01, UT5-A-3-02, ...), so one
-- default per product can never be valid across multiple hubs without a
-- location list maintained per hub per product. Simpler and more honest:
-- LOCATION is now a required column on stock upload, and this table exists
-- only to cross-check that a brand + product name pair is real.
ALTER TABLE product_default_locations DROP COLUMN default_location_code;
