-- Put every stored timestamp on UTC.
--
-- The cluster's default session zone is UTC+8. Until now NOW() and
-- DEFAULT CURRENT_TIMESTAMP wrote +8 while the Python code wrote UTC, so a Grab
-- order made a second ago showed as eight hours late on the queue board.
-- From this release the app pins every session to UTC (db.connect), and this
-- migration moves the rows already written onto the same clock.
--
-- Rules:
--   * every DATETIME written by the database (defaults, NOW()) moves back 8 h;
--   * orders.placed_at was only ever written by Python in UTC - left alone;
--   * orders.promised_at is mixed: V12 derived it from created_at (+8), the app
--     wrote it in UTC. A +8 promise sits after its created_at; a UTC one before.
--
-- A retry after a partial failure must not shift a table twice, so each table
-- is recorded in tz_utc_done as it is converted and skipped if already there.

CREATE TABLE IF NOT EXISTS tz_utc_done (
    table_name VARCHAR(64) NOT NULL PRIMARY KEY,
    done_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

UPDATE audit_log
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'audit_log');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('audit_log');

UPDATE barcodes
   SET registered_at = DATE_SUB(registered_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'barcodes');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('barcodes');

UPDATE baskets
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       label_printed_at = DATE_SUB(label_printed_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'baskets');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('baskets');

UPDATE brands
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'brands');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('brands');

UPDATE inbound_receipts
   SET completed_at = DATE_SUB(completed_at, INTERVAL 8 HOUR),
       opened_at = DATE_SUB(opened_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'inbound_receipts');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('inbound_receipts');

UPDATE inventory_balances
   SET stocked_since = DATE_SUB(stocked_since, INTERVAL 8 HOUR),
       updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'inventory_balances');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('inventory_balances');

UPDATE opname_plans
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'opname_plans');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('opname_plans');

UPDATE opname_sessions
   SET claimed_at = DATE_SUB(claimed_at, INTERVAL 8 HOUR),
       finished_at = DATE_SUB(finished_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'opname_sessions');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('opname_sessions');

UPDATE pick_shortfalls
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       reviewed_at = DATE_SUB(reviewed_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'pick_shortfalls');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('pick_shortfalls');

UPDATE pick_tasks
   SET claimed_at = DATE_SUB(claimed_at, INTERVAL 8 HOUR),
       completed_at = DATE_SUB(completed_at, INTERVAL 8 HOUR),
       created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'pick_tasks');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('pick_tasks');

UPDATE plate_ranges
   SET issued_at = DATE_SUB(issued_at, INTERVAL 8 HOUR),
       printed_at = DATE_SUB(printed_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'plate_ranges');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('plate_ranges');

UPDATE pos_outbox
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       sent_at = DATE_SUB(sent_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'pos_outbox');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('pos_outbox');

UPDATE product_default_locations
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'product_default_locations');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('product_default_locations');

UPDATE putaway_slips
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'putaway_slips');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('putaway_slips');

UPDATE replenishment_tasks
   SET claimed_at = DATE_SUB(claimed_at, INTERVAL 8 HOUR),
       completed_at = DATE_SUB(completed_at, INTERVAL 8 HOUR),
       created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'replenishment_tasks');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('replenishment_tasks');

UPDATE restock_requests
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       sent_at = DATE_SUB(sent_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'restock_requests');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('restock_requests');

UPDATE scan_events
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'scan_events');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('scan_events');

UPDATE sites
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'sites');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('sites');

UPDATE skus
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'skus');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('skus');

UPDATE slot_assignments
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'slot_assignments');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('slot_assignments');

UPDATE stock_movements
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'stock_movements');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('stock_movements');

UPDATE stock_upload_rows
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'stock_upload_rows');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('stock_upload_rows');

UPDATE stock_uploads
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'stock_uploads');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('stock_uploads');

UPDATE training_activity
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'training_activity');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('training_activity');

UPDATE training_fixtures
   SET loaded_at = DATE_SUB(loaded_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'training_fixtures');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('training_fixtures');

UPDATE transfers
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR),
       dispatched_at = DATE_SUB(dispatched_at, INTERVAL 8 HOUR),
       received_at = DATE_SUB(received_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'transfers');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('transfers');

UPDATE unit_plates
   SET bound_at = DATE_SUB(bound_at, INTERVAL 8 HOUR),
       last_seen_at = DATE_SUB(last_seen_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'unit_plates');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('unit_plates');

UPDATE users
   SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'users');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('users');

-- orders: promised_at is assigned first because MySQL applies SET left to
-- right; it must compare against created_at before created_at moves.
UPDATE orders
   SET promised_at = IF(promised_at > created_at, DATE_SUB(promised_at, INTERVAL 8 HOUR), promised_at),
       created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
 WHERE NOT EXISTS (SELECT 1 FROM tz_utc_done WHERE table_name = 'orders');
INSERT IGNORE INTO tz_utc_done (table_name) VALUES ('orders');
