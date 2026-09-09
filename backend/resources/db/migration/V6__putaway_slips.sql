-- Putaway slips: the record of what a finished receipt actually put where.
--
-- Stored as a SNAPSHOT, not a view over live tables. A slip is a document of
-- record a supervisor may read weeks later to settle a discrepancy, and the
-- 24-hour rule (HANDOFF §16: raise an inbound discrepancy within 24 h or the
-- station bears the loss) makes it evidence. If a SKU is later renamed or a
-- basket relocated, the slip must still say what the staffer was told at the
-- time — so the lines live in payload_json, frozen at issue.
--
-- The queryable columns beside it exist so the supervisor's archive can be
-- filtered without parsing every blob.

CREATE TABLE putaway_slips (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    receipt_id     BIGINT       NOT NULL,
    site_id        BIGINT       NOT NULL,
    slip_no        VARCHAR(32)  NOT NULL,
    -- The day-colour the batch was labelled with, frozen with the rest. The
    -- palette may be re-tuned later; a historical slip must not silently change
    -- which colour it claims was applied to the cartons.
    day_color_key  VARCHAR(16)  NOT NULL,
    day_color_hex  VARCHAR(9)   NOT NULL,
    day_label_id   VARCHAR(32)  NOT NULL,
    week_parity    VARCHAR(2)   NULL,
    inbound_date   DATE         NOT NULL,
    total_lines    INT          NOT NULL DEFAULT 0,
    total_units    INT          NOT NULL DEFAULT 0,
    received_by    VARCHAR(255) NULL,
    payload_json   LONGTEXT     NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- One slip per receipt: re-opening the screen reprints, never re-issues.
    UNIQUE KEY uq_slip_receipt (receipt_id),
    UNIQUE KEY uq_slip_no (slip_no),
    KEY ix_slips_site_created (site_id, created_at)
) DEFAULT CHARSET=utf8mb4;
