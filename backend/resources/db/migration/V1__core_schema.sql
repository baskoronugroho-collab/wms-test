-- Ninja Kilat WMS — core schema.
-- OceanBase / MySQL dialect. All DDL lives here, never in application code.
--
-- Deliberate conservatism (PRD §11): no ENUM, no CHECK, no generated columns,
-- no partial indexes (MySQL has none), no ON DELETE CASCADE, and no
-- "add column + FK in one ALTER" — the last two are OceanBase gotchas, and a
-- failed migration blocks every later deploy until it is repaired.
--
-- Status/type fields are VARCHAR(32) validated in the service layer so that
-- adding a value later is a code change, not an ALTER.

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

CREATE TABLE brands (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    code        VARCHAR(32)  NOT NULL,
    name        VARCHAR(160) NOT NULL,
    -- default identity mode for new SKUs: sku_barcode | unit_label  (PRD §5.1)
    identity_mode VARCHAR(32) NOT NULL DEFAULT 'sku_barcode',
    active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_brands_code (code)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sites (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    code        VARCHAR(32)  NOT NULL,
    name        VARCHAR(160) NOT NULL,
    address     VARCHAR(400) NULL,
    site_type   VARCHAR(32)  NOT NULL DEFAULT 'darkstore',   -- hub | darkstore
    -- M8: a training site is a full site that never reaches the POS and can be
    -- reset. Isolation is free because every query is already site-scoped.
    is_training TINYINT(1)   NOT NULL DEFAULT 0,
    active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sites_code (code)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE brand_sites (
    brand_id    BIGINT     NOT NULL,
    site_id     BIGINT     NOT NULL,
    active      TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (brand_id, site_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE skus (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    brand_id      BIGINT       NOT NULL,
    brand_sku_code VARCHAR(64) NOT NULL,
    name_display  VARCHAR(255) NOT NULL,
    category      VARCHAR(120) NULL,
    product_line  VARCHAR(160) NULL,
    unit_size     VARCHAR(64)  NULL,
    price_idr     BIGINT       NULL,
    unit_cube_cm3 INT          NULL,
    expiry_tier   VARCHAR(32)  NOT NULL DEFAULT 'stable',    -- critical|watch|stable
    identity_mode VARCHAR(32)  NOT NULL DEFAULT 'sku_barcode',
    label_placement_note VARCHAR(255) NULL,                  -- Mode B sticker rule
    photo_key     VARCHAR(400) NULL,                         -- object-storage key
    active        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_skus_brand_code (brand_id, brand_sku_code),
    KEY ix_skus_brand (brand_id, active),
    KEY ix_skus_name (name_display(64))
) DEFAULT CHARSET=utf8mb4;

-- Mode A. One barcode resolves to exactly one SKU, always — hence a plain
-- UNIQUE over every row. Unbinding DELETEs the row and writes audit_log;
-- history belongs in the ledger, not in dead rows here.
CREATE TABLE barcodes (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    barcode       VARCHAR(64) NOT NULL,
    sku_id        BIGINT      NOT NULL,
    source        VARCHAR(32) NOT NULL DEFAULT 'manufacturer',
    registered_by VARCHAR(255) NULL,
    registered_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_barcodes_code (barcode),
    KEY ix_barcodes_sku (sku_id)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Physical structure
-- ---------------------------------------------------------------------------

CREATE TABLE racks (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    site_id       BIGINT      NOT NULL,
    code          VARCHAR(8)  NOT NULL,          -- A, B, C ...
    level_count   INT         NOT NULL DEFAULT 5,
    level_width_m DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    sort_order    INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_racks_site_code (site_id, code)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE levels (
    id            BIGINT     NOT NULL AUTO_INCREMENT,
    rack_id       BIGINT     NOT NULL,
    level_no      INT        NOT NULL,           -- 1 = bottom
    is_open_shelf TINYINT(1) NOT NULL DEFAULT 0, -- hair care: no basket
    PRIMARY KEY (id),
    UNIQUE KEY uq_levels_rack_no (rack_id, level_no)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE locations (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    level_id    BIGINT      NOT NULL,
    site_id     BIGINT      NOT NULL,            -- denormalised: every query scopes by site
    position_no INT         NOT NULL,            -- 0 = open shelf
    code        VARCHAR(48) NOT NULL,            -- UT5-A-3-02
    is_virtual  TINYINT(1)  NOT NULL DEFAULT 0,  -- in-transit pseudo-location
    PRIMARY KEY (id),
    UNIQUE KEY uq_locations_code (code),
    UNIQUE KEY uq_locations_level_pos (level_id, position_no),
    KEY ix_locations_site (site_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE baskets (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    location_id     BIGINT      NOT NULL,
    site_id         BIGINT      NOT NULL,
    basket_size     VARCHAR(8)  NOT NULL DEFAULT 'M',   -- S | M | L | OPEN
    label_printed_at DATETIME   NULL,
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_baskets_location (location_id),        -- one basket per location
    KEY ix_baskets_site (site_id)
) DEFAULT CHARSET=utf8mb4;

-- The row IS the current slot. Relocating UPDATEs basket_id and writes
-- relocate_out / relocate_in movements; the history lives in the ledger.
CREATE TABLE slot_assignments (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    site_id       BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    basket_id     BIGINT      NOT NULL,
    created_by    VARCHAR(255) NULL,
    created_during_inbound TINYINT(1) NOT NULL DEFAULT 0,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_slot_basket (basket_id),           -- one SKU per basket (§5.5)
    UNIQUE KEY uq_slot_site_sku (site_id, sku_id)    -- one slot per SKU per site
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Mode B — license plates (PRD §5.1, M1.4)
-- ---------------------------------------------------------------------------

CREATE TABLE plate_ranges (
    id         BIGINT      NOT NULL AUTO_INCREMENT,
    site_id    BIGINT      NOT NULL,
    prefix     VARCHAR(8)  NOT NULL DEFAULT 'NJ',
    seq_from   BIGINT      NOT NULL,
    seq_to     BIGINT      NOT NULL,
    issued_by  VARCHAR(255) NULL,
    issued_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    printed_at DATETIME    NULL,
    PRIMARY KEY (id),
    KEY ix_plate_ranges_site (site_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE unit_plates (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    plate_code   VARCHAR(32) NOT NULL,
    range_id     BIGINT      NULL,
    site_id      BIGINT      NOT NULL,
    -- unbound | in_stock | picked | shipped | written_off
    state        VARCHAR(32) NOT NULL DEFAULT 'unbound',
    sku_id       BIGINT      NULL,
    location_id  BIGINT      NULL,
    expiry_date  DATE        NULL,
    bound_by     VARCHAR(255) NULL,
    bound_at     DATETIME    NULL,
    last_seen_at DATETIME    NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_plates_code (plate_code),
    -- the pick/opname hot path: must stay a narrow indexed lookup (§10.3)
    KEY ix_plates_lookup (site_id, sku_id, location_id, state),
    KEY ix_plates_state (site_id, state)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Inventory + the ledger
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_balances (
    id            BIGINT   NOT NULL AUTO_INCREMENT,
    site_id       BIGINT   NOT NULL,
    sku_id        BIGINT   NOT NULL,
    location_id   BIGINT   NOT NULL,
    qty_on_hand   INT      NOT NULL DEFAULT 0,
    qty_allocated INT      NOT NULL DEFAULT 0,
    version       BIGINT   NOT NULL DEFAULT 0,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_balance (site_id, sku_id, location_id),
    KEY ix_balance_site_sku (site_id, sku_id)
) DEFAULT CHARSET=utf8mb4;

-- Append only. The single source of truth: balances are a projection of this
-- and must always be rebuildable by replaying it (§10.5.3).
CREATE TABLE stock_movements (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    site_id     BIGINT      NOT NULL,
    sku_id      BIGINT      NOT NULL,
    location_id BIGINT      NULL,
    plate_id    BIGINT      NULL,               -- Mode B only
    qty_delta   INT         NOT NULL,
    -- receipt_in | transfer_out | transfer_in | pick_out | adjustment
    -- | relocate_out | relocate_in | label_bind
    movement_type VARCHAR(32) NOT NULL,
    ref_type    VARCHAR(32) NULL,
    ref_id      BIGINT      NULL,
    reason_code VARCHAR(48) NULL,
    actor_email VARCHAR(255) NULL,
    scan_source VARCHAR(16) NOT NULL DEFAULT 'scan',   -- scan|manual|plate|system
    is_training TINYINT(1)  NOT NULL DEFAULT 0,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_mv_site_sku_time (site_id, sku_id, created_at),
    KEY ix_mv_location (location_id, created_at),
    KEY ix_mv_ref (ref_type, ref_id)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Inbound + transfers
-- ---------------------------------------------------------------------------

CREATE TABLE inbound_receipts (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    site_id      BIGINT      NOT NULL,
    brand_id     BIGINT      NULL,
    source_type  VARCHAR(32) NOT NULL,        -- from_brand | from_hub_transfer
    transfer_id  BIGINT      NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'open',  -- open|completed|discrepancy_raised
    opened_by    VARCHAR(255) NULL,
    opened_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME    NULL,
    PRIMARY KEY (id),
    KEY ix_receipts_site_status (site_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE receipt_lines (
    id           BIGINT NOT NULL AUTO_INCREMENT,
    receipt_id   BIGINT NOT NULL,
    sku_id       BIGINT NOT NULL,
    qty_expected INT    NULL,
    qty_received INT    NOT NULL DEFAULT 0,
    location_id  BIGINT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_receipt_sku (receipt_id, sku_id),
    KEY ix_receipt_lines (receipt_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE transfers (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    from_site_id  BIGINT      NOT NULL,
    to_site_id    BIGINT      NOT NULL,
    brand_id      BIGINT      NULL,
    reference     VARCHAR(48) NOT NULL,
    status        VARCHAR(32) NOT NULL DEFAULT 'draft',  -- draft|dispatched|received
    dispatched_at DATETIME    NULL,
    received_at   DATETIME    NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_transfer_ref (reference)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE transfer_lines (
    id             BIGINT NOT NULL AUTO_INCREMENT,
    transfer_id    BIGINT NOT NULL,
    sku_id         BIGINT NOT NULL,
    qty_dispatched INT    NOT NULL DEFAULT 0,
    qty_received   INT    NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_transfer_sku (transfer_id, sku_id)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Orders + picking
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    external_ref VARCHAR(96) NOT NULL,
    site_id      BIGINT      NOT NULL,
    brand_id     BIGINT      NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'received',
    is_test      TINYINT(1)  NOT NULL DEFAULT 0,
    created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orders_ref (external_ref),
    KEY ix_orders_site_status (site_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_lines (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    order_id      BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    qty_ordered   INT         NOT NULL,
    qty_allocated INT         NOT NULL DEFAULT 0,
    qty_picked    INT         NOT NULL DEFAULT 0,
    status        VARCHAR(32) NOT NULL DEFAULT 'pending',  -- pending|allocated|short|picked
    PRIMARY KEY (id),
    KEY ix_order_lines (order_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE pick_tasks (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    order_id     BIGINT      NOT NULL,
    site_id      BIGINT      NOT NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'ready',  -- ready|claimed|completed|blocked
    claimed_by   VARCHAR(255) NULL,
    claimed_at   DATETIME    NULL,
    completed_at DATETIME    NULL,
    created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_pick_order (order_id),
    KEY ix_pick_site_status (site_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE pick_lines (
    id            BIGINT      NOT NULL AUTO_INCREMENT,
    pick_task_id  BIGINT      NOT NULL,
    order_line_id BIGINT      NOT NULL,
    sku_id        BIGINT      NOT NULL,
    location_id   BIGINT      NULL,
    sequence_no   INT         NOT NULL,
    qty_required  INT         NOT NULL,
    qty_picked    INT         NOT NULL DEFAULT 0,
    status        VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|picked|short
    PRIMARY KEY (id),
    KEY ix_pick_lines (pick_task_id, sequence_no)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Stock opname
-- ---------------------------------------------------------------------------

CREATE TABLE opname_plans (
    id         BIGINT      NOT NULL AUTO_INCREMENT,
    site_id    BIGINT      NOT NULL,
    name       VARCHAR(160) NULL,
    scope_json TEXT        NULL,
    status     VARCHAR(32) NOT NULL DEFAULT 'open',   -- open|closed
    created_by VARCHAR(255) NULL,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_plans_site (site_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE opname_sessions (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    plan_id      BIGINT      NOT NULL,
    site_id      BIGINT      NOT NULL,
    basket_id    BIGINT      NOT NULL,
    sku_id       BIGINT      NULL,
    claimed_by   VARCHAR(255) NULL,
    claimed_at   DATETIME    NULL,
    qty_expected INT         NULL,
    qty_counted  INT         NOT NULL DEFAULT 0,
    variance     INT         NULL,
    count_method VARCHAR(16) NOT NULL DEFAULT 'scan',   -- scan | manual
    recounted    TINYINT(1)  NOT NULL DEFAULT 0,
    status       VARCHAR(32) NOT NULL DEFAULT 'counting', -- counting|finished|abandoned
    finished_at  DATETIME    NULL,
    PRIMARY KEY (id),
    -- one live count per basket per plan: the claim (§10.2.1)
    UNIQUE KEY uq_session_plan_basket (plan_id, basket_id),
    KEY ix_sessions_site (site_id, status)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE opname_foreign (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    session_id      BIGINT      NOT NULL,
    scanned_code    VARCHAR(64) NOT NULL,
    sku_id_resolved BIGINT      NULL,
    qty             INT         NOT NULL DEFAULT 1,
    note            VARCHAR(255) NULL,
    PRIMARY KEY (id),
    KEY ix_foreign_session (session_id)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- People, audit, idempotency
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    email           VARCHAR(255) NOT NULL,
    name            VARCHAR(160) NULL,
    role            VARCHAR(32) NOT NULL DEFAULT 'staff', -- admin|supervisor|staff|hub_operator
    default_site_id BIGINT      NULL,
    locale          VARCHAR(8)  NOT NULL DEFAULT 'id',
    active          TINYINT(1)  NOT NULL DEFAULT 1,
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_sites (
    user_id BIGINT NOT NULL,
    site_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, site_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE audit_log (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    actor_email VARCHAR(255) NULL,
    entity      VARCHAR(64) NOT NULL,
    entity_id   BIGINT      NULL,
    action      VARCHAR(64) NOT NULL,
    before_json TEXT        NULL,
    after_json  TEXT        NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_audit_entity (entity, entity_id, created_at)
) DEFAULT CHARSET=utf8mb4;

-- A replay returns the stored response and never re-applies the effect (§10.2.3).
CREATE TABLE scan_events (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    idempotency_key VARCHAR(80)  NOT NULL,
    endpoint        VARCHAR(120) NOT NULL,
    response_json   TEXT         NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_scan_key (idempotency_key)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- POS outbox (§9.2) — a retrying table, not Kafka
-- ---------------------------------------------------------------------------

CREATE TABLE pos_outbox (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    site_id      BIGINT      NOT NULL,
    sku_id       BIGINT      NOT NULL,
    available    INT         NOT NULL,
    status       VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|sent|failed|suppressed
    attempts     INT         NOT NULL DEFAULT 0,
    last_error   VARCHAR(400) NULL,
    created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at      DATETIME    NULL,
    PRIMARY KEY (id),
    KEY ix_outbox_status (status, created_at)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Training (M8)
-- ---------------------------------------------------------------------------

CREATE TABLE training_fixtures (
    id           BIGINT      NOT NULL AUTO_INCREMENT,
    site_id      BIGINT      NOT NULL,
    scenario     VARCHAR(48) NOT NULL,
    payload_json TEXT        NULL,
    loaded_by    VARCHAR(255) NULL,
    loaded_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_fixtures_site (site_id, loaded_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE training_activity (
    id          BIGINT      NOT NULL AUTO_INCREMENT,
    site_id     BIGINT      NOT NULL,
    actor_email VARCHAR(255) NULL,
    flow        VARCHAR(48) NOT NULL,     -- inbound | pick | opname | labelling
    event       VARCHAR(48) NOT NULL,     -- started | scan_ok | scan_reject | completed
    detail_json TEXT        NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_activity_site_actor (site_id, actor_email, created_at)
) DEFAULT CHARSET=utf8mb4;
