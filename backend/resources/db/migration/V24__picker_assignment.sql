-- V24: the WMS gives orders to pickers by itself (PRD §6.2, §6.5.4), packing
-- is a step of its own (§6.4) and a cancelled bag is taken back (§7.2.4).
--
-- How pick_tasks maps onto §6.11, reusing what V1 already has:
--
--   status 'ready'      Waiting: in the queue, nobody holds it.
--   status 'claimed'    Being picked. claimed_by is the picker who holds it
--                       (the ASSIGNED picker: the WMS assigns by writing
--                       claimed_by, so there is no separate assigned_to that
--                       could drift from it) and claimed_at is when they got it
--                       (the assigned_at the 2-minute rule is measured from).
--   status 'completed'  Waiting to pack: the picker tapped Serahkan ke meja
--                       packing. completed_at and the new handed_to_pack_at are
--                       that moment.
--   orders.marked_ready_at / _by   Packed and ready: Selesai dikemas, and
--                       order_ready queued to Hiryu in the same transaction.
--                       (V22 named them after Hiryu's Mark ready button; the
--                       meaning is now "packed, ready sent".)
--   orders.handed_over_at / _by    Handed to the Grab driver.
--   status 'cancelled'  Cancelled, from Hiryu (message 2) or by a missing item.
--
-- New on pick_tasks:
--   started_at         the current holder's first scan. Cleared when the order
--                      changes hands, so the 2-minute rule always measures the
--                      person who holds it now.
--   handed_to_pack_at  Serahkan ke meja packing.
--   reassign_note      the last reason the order changed hands (not started in
--                      time, moved by the SPV), shown on the board.
--   requeued_at, requeue_count   an order that went back to the queue unstarted;
--                      the SPV's Perlu tindakan lists these.
--
-- New on orders:
--   back_to_bench_at / _by   a bag cancelled after packing (or a basket at the
--                      bench) was taken back to be unpacked; its red row on the
--                      handover screen clears.
--
-- picker_presence: one row per hub and picker. state ready | break | off, since
-- when, and the order in hand (a cache: the truth is pick_tasks.claimed_by, and
-- the assigner repairs the cache before it trusts it).
--
-- OceanBase rules: no foreign keys, one change per ALTER, each guarded by an
-- information_schema check, so a re-run after a partial failure is harmless.

DROP PROCEDURE IF EXISTS wms_v24_upgrade;

DELIMITER $$

CREATE PROCEDURE wms_v24_upgrade()
BEGIN
    DECLARE n INT DEFAULT 0;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'started_at';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN started_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'handed_to_pack_at';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN handed_to_pack_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'reassign_note';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN reassign_note VARCHAR(255) NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'requeued_at';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN requeued_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND COLUMN_NAME = 'requeue_count';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD COLUMN requeue_count INT NOT NULL DEFAULT 0;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pick_tasks'
        AND INDEX_NAME = 'ix_pick_claimed_by';
    IF n = 0 THEN
        ALTER TABLE pick_tasks ADD INDEX ix_pick_claimed_by (claimed_by, status);
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'back_to_bench_at';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN back_to_bench_at DATETIME NULL;
    END IF;

    SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'back_to_bench_by';
    IF n = 0 THEN
        ALTER TABLE orders ADD COLUMN back_to_bench_by VARCHAR(255) NULL;
    END IF;
END$$

DELIMITER ;

CALL wms_v24_upgrade();
DROP PROCEDURE wms_v24_upgrade;

-- Orders already in a picker's hands when this deploys have no first scan
-- recorded. Without this they would all look "not started" and the first sweep
-- would pull every one of them back to the queue mid-pick.
UPDATE pick_tasks SET started_at = COALESCE(claimed_at, created_at)
 WHERE status = 'claimed' AND started_at IS NULL;

CREATE TABLE IF NOT EXISTS picker_presence (
    site_id          BIGINT       NOT NULL,
    user_email       VARCHAR(255) NOT NULL,
    state            VARCHAR(16)  NOT NULL DEFAULT 'off',   -- ready | break | off
    since            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- When they last became free (ready, nothing in hand). "Ready longest"
    -- is the earliest idle_since, so a picker who just handed an order to pack
    -- queues behind one who has been standing by.
    idle_since       DATETIME     NULL,
    current_task_id  BIGINT       NULL,
    -- The phone polls every few seconds; a phone that stopped polling (asleep,
    -- dead, left in a drawer) is not given new orders.
    last_seen_at     DATETIME     NULL,
    -- The last thing the phone should tell its picker, "Indonesian / English":
    -- why an order was taken away (cancelled, moved, not started in time).
    note             VARCHAR(255) NULL,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (site_id, user_email),
    KEY ix_presence_ready (site_id, state, idle_since),
    KEY ix_presence_user (user_email)
) DEFAULT CHARSET=utf8mb4;

-- Settings, editable on Aturan pengingat like every other number.
INSERT INTO alert_rules (rule_key, enabled, value_num) VALUES
  ('pick_start_minutes', 1, 2)   -- an assigned order with no scan after N min goes back (§6.2)
ON DUPLICATE KEY UPDATE rule_key = rule_key;
