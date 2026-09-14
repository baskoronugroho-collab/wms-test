-- Return to shelf (canonical design: "Order cancelled -> WMS releases; picked
-- units go to return-to-shelf").
--
-- A pick takes units off the ledger the moment they are scanned into the tote.
-- When Hiryu cancels an order after that, the units are physically in a tote,
-- not on a shelf, and the ledger must not pretend otherwise until a person has
-- walked them back and scanned each one in. One row per SKU line to return.
-- Anyone on shift can work the list (PRD decision: return-to-shelf by anyone).

CREATE TABLE IF NOT EXISTS return_tasks (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    site_id       BIGINT       NOT NULL,
    sku_id        BIGINT       NOT NULL,
    order_id      BIGINT       NULL,
    external_ref  VARCHAR(64)  NULL,
    location_id   BIGINT       NULL,      -- where it goes back: where it was picked from
    qty           INT          NOT NULL,
    qty_returned  INT          NOT NULL DEFAULT 0,
    reason        VARCHAR(32)  NOT NULL DEFAULT 'cancelled',
    status        VARCHAR(16)  NOT NULL DEFAULT 'open',   -- open | done
    is_training   TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    done_at       DATETIME     NULL,
    done_by       VARCHAR(255) NULL,
    PRIMARY KEY (id),
    KEY ix_return_tasks_site_status (site_id, status)
) DEFAULT CHARSET=utf8mb4;
