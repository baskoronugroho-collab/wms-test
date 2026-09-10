-- Clean up what the first, failed V8 left behind.
--
-- That attempt used a column called `role` and created
--   UNIQUE KEY uq_slot_site_sku_role (site_id, sku_id, role)
-- before dying further down the file. DDL auto-commits, so both survived.
--
-- The rewritten V8 renamed the column to `slot_role` and guards every step on
-- information_schema -- which is what makes it re-runnable, and is also exactly
-- why it did NOT fix this: it saw an index named uq_slot_site_sku_role already
-- present and skipped creating its own. So the live index points at the stale
-- `role` column, which still carries its DEFAULT 'primary' on every row.
--
-- The visible symptom was that assigning an overflow basket failed with
--   Duplicate entry '99-107-primary' for key 'uq_slot_site_sku_role'
-- no matter what slot_role the request asked for: the index was reading a column
-- the application had stopped writing to.
--
-- A guard that checks only a NAME cannot tell that the thing behind the name is
-- wrong. Where a rerunnable migration replaces an object, it has to verify the
-- shape too -- which is what the column check below does before trusting the
-- index.

DROP PROCEDURE IF EXISTS wms_v10_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v10_upgrade()
BEGIN
    DECLARE idx_on_stale INT;
    DECLARE stale_col INT;

    -- Is the unique index built on the stale `role` column rather than slot_role?
    SELECT COUNT(*) INTO idx_on_stale FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND INDEX_NAME = 'uq_slot_site_sku_role' AND COLUMN_NAME = 'role';

    IF idx_on_stale > 0 THEN
        ALTER TABLE slot_assignments DROP INDEX uq_slot_site_sku_role;
    END IF;

    -- Rebuild it on the column the application actually writes.
    SELECT COUNT(*) INTO idx_on_stale FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND INDEX_NAME = 'uq_slot_site_sku_role' AND COLUMN_NAME = 'slot_role';
    IF idx_on_stale = 0 THEN
        ALTER TABLE slot_assignments
          ADD UNIQUE KEY uq_slot_site_sku_role (site_id, sku_id, slot_role);
    END IF;

    -- Carry any value the old column still holds across, then drop it. Nothing
    -- reads `role` any more, and leaving a NOT NULL column with a default that
    -- silently satisfies a constraint is how this bug happened in the first place.
    SELECT COUNT(*) INTO stale_col FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'slot_assignments'
        AND COLUMN_NAME = 'role';
    IF stale_col > 0 THEN
        UPDATE slot_assignments
           SET slot_role = role
         WHERE role IN ('primary', 'overflow')
           AND (slot_role IS NULL OR slot_role = '');
        ALTER TABLE slot_assignments DROP COLUMN role;
    END IF;

    -- Same treatment for the outbox: the first attempt may have added `priority`
    -- beside the send_priority the code now uses.
    SELECT COUNT(*) INTO stale_col FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_outbox'
        AND COLUMN_NAME = 'priority';
    IF stale_col > 0 THEN
        ALTER TABLE pos_outbox DROP COLUMN priority;
    END IF;
END$$

DELIMITER ;

CALL wms_v10_upgrade();
DROP PROCEDURE wms_v10_upgrade;
