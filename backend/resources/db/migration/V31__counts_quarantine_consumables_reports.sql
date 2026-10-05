-- V31: counts, quarantine and returns to the brand, consumables, reports
-- (deploy 3, canvas Sections 7, 8, 9 and 10; decisions log 1 Oct and 5 Oct).
--
--   count_cycles        Ops HQ's mandatory cycle counts: one SKU or every SKU of
--                       a brand, every N days or N weeks. No rotation bins.
--   count_tasks         the count plan: one row per hub, day and bin, with why
--                       it is counted (cycle | missing_item | spv_added |
--                       monthly_full), the counter, the result, the SPV
--                       approval and Ops HQ's review afterwards.
--   count_attempts      each count of a task (first count, recount by another
--                       person); scan by default, blind optional. A row with
--                       status 'counting' locks the bin against picking.
--   count_scans         every scan of a count by scan, so the last can be undone.
--   quarantine_items    every unit that cannot be sold: found in the hub,
--                       damaged at inbound, refused at inbound, or brought back
--                       damaged by the driver. The cost bearer is set by the WMS.
--   return_notes        nota retur RTR-<HUB>-yymm-NNN, and its lines.
--   consumables         Ninja's own packing stock per hub, its usage rule, its
--                       minimum, and the ledger of every change; needs, PR,
--                       receipts and the weekly count, each approved by Ops HQ.
--   eod_notes           the SPV's note for tomorrow on the end-of-day report.
--   report_finalisations  "Finalised by Ops HQ" on the monthly variance report.
--
-- No customer data anywhere. Re-runnable and conservative (OceanBase): tables
-- are CREATE TABLE IF NOT EXISTS, no foreign keys, seed rows ON DUPLICATE KEY.
-- No ALTER of another module's table.

CREATE TABLE IF NOT EXISTS count_cycles (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    -- sku | brand
    scope         VARCHAR(8)   NOT NULL,
    sku_id        BIGINT       NULL,
    brand_id      BIGINT       NULL,
    every_n       INT          NOT NULL,
    -- day | week
    every_unit    VARCHAR(8)   NOT NULL DEFAULT 'day',
    start_date    DATE         NOT NULL,
    active        TINYINT(1)   NOT NULL DEFAULT 1,
    created_by    VARCHAR(255) NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(255) NULL,
    updated_at    DATETIME     NULL,
    PRIMARY KEY (id),
    KEY ix_count_cycles_active (active, scope)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS count_tasks (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    site_id         BIGINT       NOT NULL,
    plan_date       DATE         NOT NULL,             -- WIB calendar day
    is_full         TINYINT(1)   NOT NULL DEFAULT 0,   -- part of the monthly full count
    location_id     BIGINT       NOT NULL,
    sku_id          BIGINT       NULL,
    -- cycle | missing_item | spv_added | monthly_full
    reason          VARCHAR(16)  NOT NULL,
    reason_note     VARCHAR(255) NULL,
    reason_ref_type VARCHAR(32)  NULL,
    reason_ref_id   BIGINT       NULL,
    assigned_to     VARCHAR(255) NULL,
    -- pending | counting | recount | awaiting_spv | closed
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    -- auto_closed | approved
    outcome         VARCHAR(16)  NULL,
    qty_expected    INT          NULL,
    qty_final       INT          NULL,
    variance        INT          NULL,
    first_match     TINYINT(1)   NULL,                 -- first count matched the system
    approved_by     VARCHAR(255) NULL,
    approved_at     DATETIME     NULL,
    movement_id     BIGINT       NULL,
    -- not_needed | pending | reviewed
    hq_review       VARCHAR(16)  NULL,
    hq_reviewed_by  VARCHAR(255) NULL,
    hq_reviewed_at  DATETIME     NULL,
    hq_note         VARCHAR(255) NULL,
    added_by        VARCHAR(255) NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at       DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_count_task_day_bin (site_id, plan_date, location_id),
    KEY ix_count_tasks_status (site_id, status, plan_date),
    KEY ix_count_tasks_review (hq_review, approved_at),
    KEY ix_count_tasks_loc (location_id, closed_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS count_attempts (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    task_id       BIGINT       NOT NULL,
    site_id       BIGINT       NOT NULL,
    location_id   BIGINT       NOT NULL,
    attempt_no    INT          NOT NULL,
    counted_by    VARCHAR(255) NOT NULL,
    -- scan | blind
    method        VARCHAR(8)   NOT NULL DEFAULT 'scan',
    qty_counted   INT          NOT NULL DEFAULT 0,
    qty_expected  INT          NULL,                   -- snapshot at Selesai hitung
    -- counting | finished | abandoned
    status        VARCHAR(16)  NOT NULL DEFAULT 'counting',
    started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at   DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_count_attempt (task_id, attempt_no),
    KEY ix_count_attempts_lock (site_id, status, location_id),
    KEY ix_count_attempts_by (counted_by, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS count_scans (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    attempt_id    BIGINT       NOT NULL,
    code          VARCHAR(64)  NOT NULL,
    sku_id        BIGINT       NULL,
    -- counted | foreign | unknown
    outcome       VARCHAR(16)  NOT NULL,
    undone        TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_count_scans_attempt (attempt_id, id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quarantine_items (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    site_id          BIGINT       NOT NULL,
    sku_id           BIGINT       NOT NULL,
    qty              INT          NOT NULL,
    -- hub | inbound | inbound_rejected | driver_return
    origin           VARCHAR(16)  NOT NULL,
    reason           VARCHAR(24)  NOT NULL,
    reason_note      VARCHAR(255) NULL,
    location_id      BIGINT       NULL,                -- the bin it came from (origin hub)
    tray_code        VARCHAR(48)  NULL,
    photo_key        VARCHAR(400) NULL,
    -- ninja | brand, set by the WMS from the origin
    cost_bearer      VARCHAR(8)   NOT NULL,
    bearer_note      VARCHAR(160) NULL,
    in_ledger        TINYINT(1)   NOT NULL DEFAULT 0,  -- 1: the units left the stock ledger at report
    -- open | back_to_rack | return_pending | on_note | returned
    -- | write_off_pending | written_off
    status           VARCHAR(20)  NOT NULL DEFAULT 'open',
    decided_by       VARCHAR(255) NULL,
    decided_at       DATETIME     NULL,
    decision_note    VARCHAR(255) NULL,
    hq_by            VARCHAR(255) NULL,
    hq_at            DATETIME     NULL,
    hq_note          VARCHAR(255) NULL,
    hq_rejected_at   DATETIME     NULL,
    return_task_id   BIGINT       NULL,
    return_note_id   BIGINT       NULL,
    receipt_id       BIGINT       NULL,
    replenishment_id BIGINT       NULL,
    order_id         BIGINT       NULL,
    order_ref        VARCHAR(64)  NULL,
    -- Where an item was read from another module's table, so it is taken once:
    -- inbound_difference (damaged at inbound, into the tray) or inbound_bin_load
    -- (extra units Ops HQ rejected, status 'return'). NULL for the rest.
    source_ref_type  VARCHAR(32)  NULL,
    source_ref_id    BIGINT       NULL,
    reported_by      VARCHAR(255) NOT NULL,
    reported_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at        DATETIME     NULL,
    is_training      TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_quarantine_source (source_ref_type, source_ref_id),
    KEY ix_quarantine_site_status (site_id, status, reported_at),
    KEY ix_quarantine_status (status, hq_at),
    KEY ix_quarantine_replenishment (replenishment_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS return_notes (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    site_id          BIGINT       NOT NULL,
    brand_id         BIGINT       NOT NULL,
    reference        VARCHAR(32)  NOT NULL,
    -- open | handed_over | cancelled
    status           VARCHAR(16)  NOT NULL DEFAULT 'open',
    replenishment_id BIGINT       NULL,               -- the brand's next delivery
    note             VARCHAR(400) NULL,
    created_by       VARCHAR(255) NOT NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    printed_at       DATETIME     NULL,
    handed_over_by   VARCHAR(255) NULL,
    handed_over_at   DATETIME     NULL,
    driver_name      VARCHAR(160) NULL,
    vehicle_no       VARCHAR(32)  NULL,
    cancelled_by     VARCHAR(255) NULL,
    cancelled_at     DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_return_notes_ref (reference),
    KEY ix_return_notes_site (site_id, status, created_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS return_note_lines (
    id                 BIGINT       NOT NULL AUTO_INCREMENT,
    note_id            BIGINT       NOT NULL,
    sku_id             BIGINT       NOT NULL,
    -- quarantine | old_stock | rejected
    origin             VARCHAR(16)  NOT NULL,
    quarantine_item_id BIGINT       NULL,
    location_id        BIGINT       NULL,             -- old stock: the bin
    stocked_since      DATETIME     NULL,             -- old stock: inbound date of the batch
    qty                INT          NOT NULL,
    qty_scanned        INT          NOT NULL DEFAULT 0,
    reason_text        VARCHAR(255) NULL,
    ed_on_pack         VARCHAR(32)  NULL,             -- what the SPV read on the pack; never stored as a date
    movement_id        BIGINT       NULL,
    PRIMARY KEY (id),
    KEY ix_return_note_lines (note_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS consumables (
    id            BIGINT        NOT NULL AUTO_INCREMENT,
    site_id       BIGINT        NOT NULL,
    name          VARCHAR(160)  NOT NULL,
    unit          VARCHAR(16)   NOT NULL DEFAULT 'pcs',
    pack_size     DECIMAL(12,3) NULL,                 -- isi per pak
    -- bag | carton | order | delivery | none
    usage_basis   VARCHAR(16)   NOT NULL DEFAULT 'order',
    usage_qty     DECIMAL(10,3) NOT NULL DEFAULT 1,
    min_qty       DECIMAL(12,3) NULL,
    stock_qty     DECIMAL(12,3) NOT NULL DEFAULT 0,
    active        TINYINT(1)    NOT NULL DEFAULT 1,
    sort_order    INT           NOT NULL DEFAULT 0,
    created_by    VARCHAR(255)  NULL,
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by    VARCHAR(255)  NULL,
    updated_at    DATETIME      NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_consumables_site_name (site_id, name),
    KEY ix_consumables_site (site_id, active, sort_order)
) DEFAULT CHARSET=utf8mb4;

-- Every change to a consumable's stock. kind: order | delivery | receipt |
-- count | manual. The unique key makes an order or a delivery book once.
CREATE TABLE IF NOT EXISTS consumable_movements (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    consumable_id  BIGINT        NOT NULL,
    site_id        BIGINT        NOT NULL,
    qty_delta      DECIMAL(12,3) NOT NULL,
    kind           VARCHAR(16)   NOT NULL,
    ref_type       VARCHAR(32)   NULL,
    ref_id         BIGINT        NULL,
    actor_email    VARCHAR(255)  NULL,
    note           VARCHAR(255)  NULL,
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_consumable_mv_ref (consumable_id, kind, ref_type, ref_id),
    KEY ix_consumable_mv_site (site_id, created_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS consumable_requests (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    consumable_id  BIGINT        NOT NULL,
    site_id        BIGINT        NOT NULL,
    -- raised | pr_submitted | closed | cancelled
    status         VARCHAR(16)   NOT NULL DEFAULT 'raised',
    qty_suggested  DECIMAL(12,3) NULL,
    note           VARCHAR(255)  NULL,
    raised_by      VARCHAR(255)  NOT NULL,
    raised_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    pr_number      VARCHAR(64)   NULL,
    pr_qty         DECIMAL(12,3) NULL,
    pr_by          VARCHAR(255)  NULL,
    pr_at          DATETIME      NULL,
    closed_at      DATETIME      NULL,
    PRIMARY KEY (id),
    KEY ix_consumable_req (site_id, status, raised_at),
    KEY ix_consumable_req_item (consumable_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS consumable_receipts (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    consumable_id  BIGINT        NOT NULL,
    site_id        BIGINT        NOT NULL,
    request_id     BIGINT        NULL,
    packs          DECIMAL(12,3) NOT NULL,
    per_pack       DECIMAL(12,3) NOT NULL,
    qty_total      DECIMAL(12,3) NOT NULL,
    -- pending | approved | returned (sent back by Ops HQ) | withdrawn
    status         VARCHAR(16)   NOT NULL DEFAULT 'pending',
    entered_by     VARCHAR(255)  NOT NULL,
    entered_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by     VARCHAR(255)  NULL,
    decided_at     DATETIME      NULL,
    hq_note        VARCHAR(255)  NULL,
    PRIMARY KEY (id),
    KEY ix_consumable_rcpt (site_id, status, entered_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS consumable_counts (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    site_id        BIGINT        NOT NULL,
    -- pending | approved | returned
    status         VARCHAR(16)   NOT NULL DEFAULT 'pending',
    counted_by     VARCHAR(255)  NOT NULL,
    counted_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by     VARCHAR(255)  NULL,
    decided_at     DATETIME      NULL,
    hq_note        VARCHAR(255)  NULL,
    PRIMARY KEY (id),
    KEY ix_consumable_counts (site_id, status, counted_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS consumable_count_lines (
    id             BIGINT        NOT NULL AUTO_INCREMENT,
    count_id       BIGINT        NOT NULL,
    consumable_id  BIGINT        NOT NULL,
    qty_counted    DECIMAL(12,3) NOT NULL,
    qty_system     DECIMAL(12,3) NOT NULL,             -- the computed stock when counted
    PRIMARY KEY (id),
    UNIQUE KEY uq_consumable_count_line (count_id, consumable_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS eod_notes (
    site_id          BIGINT       NOT NULL,
    day              DATE         NOT NULL,            -- WIB calendar day
    note             TEXT         NOT NULL,
    written_by       VARCHAR(255) NOT NULL,
    written_by_name  VARCHAR(160) NULL,
    written_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (site_id, day)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS report_finalisations (
    report_key        VARCHAR(32)  NOT NULL,           -- variance
    period            VARCHAR(16)  NOT NULL,           -- 2026-09
    finalised_by      VARCHAR(255) NOT NULL,
    finalised_by_name VARCHAR(160) NULL,
    finalised_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (report_key, period)
) DEFAULT CHARSET=utf8mb4;

-- Settings, editable by Ops HQ (Aturan & waktu, and Bahan kemas for the last
-- three). Deadlines only turn a Perlu tindakan row amber; nothing is decided
-- automatically.
INSERT INTO alert_rules (rule_key, enabled, value_num, updated_at) VALUES
  ('quarantine_decide_hours',  1, 24, UTC_TIMESTAMP()),   -- SPV decides a quarantined unit within N h
  ('writeoff_approve_hours',   1, 24, UTC_TIMESTAMP()),   -- Ops HQ approves or refuses a write-off within N h
  ('count_approve_hours',      1, 24, UTC_TIMESTAMP()),   -- SPV approves a count result within N h
  ('count_review_hours',       1, 72, UTC_TIMESTAMP()),   -- Ops HQ reviews an approved difference within N h
  ('count_full_workdays',      1, 3, UTC_TIMESTAMP()),    -- month-end count approved by the Nth working day
  ('consumable_pr_hours',      1, 24, UTC_TIMESTAMP()),   -- Ops HQ records the PR within N h of the SPV's need
  ('consumable_approve_hours', 1, 24, UTC_TIMESTAMP()),   -- Ops HQ approves a receipt or weekly count within N h
  ('consumable_count_days',    1, 7, UTC_TIMESTAMP()),    -- the SPV counts consumables every N days
  ('consumable_orders_month',  1, 200, UTC_TIMESTAMP()),  -- Grab's target orders per hub per month (minimums)
  ('consumable_min_days',      1, 14, UTC_TIMESTAMP())    -- minimum = N days of use at the target
ON DUPLICATE KEY UPDATE rule_key = rule_key;

-- Stok lama for returns to the brand reads stock_old_days (90 since V29).

-- Starting consumables at every live dark store (board 9a). Ops HQ adds,
-- renames and resets them; stock starts at 0 until the first approved count.
-- created_at is UTC_TIMESTAMP(): the column default would take the migration
-- session's clock (UTC+8 on the cluster, V13). The unique key (site_id, name)
-- makes a re-run add nothing.
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Kantong kertas Berkah PBG15', 'pcs', 50, 'bag', 1, 90, 0, 1, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Kardus Maxellpack CCM-36', 'pcs', 25, 'carton', 1, 15, 0, 2, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Gulungan label bin', 'label', 500, 'order', 1, 100, 0, 3, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Lakban', 'm', 90, 'carton', 0.6, 10, 0, 4, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Sekat warna', 'pcs', 50, 'delivery', 1, 4, 0, 5, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
INSERT INTO consumables (site_id, name, unit, pack_size, usage_basis, usage_qty, min_qty, stock_qty, sort_order, created_at)
SELECT id, 'Stiker warna hari', 'lembar', 10, 'delivery', 1, 4, 0, 6, UTC_TIMESTAMP()
  FROM sites WHERE site_type = 'darkstore' AND is_training = 0
ON DUPLICATE KEY UPDATE consumables.id = consumables.id;
