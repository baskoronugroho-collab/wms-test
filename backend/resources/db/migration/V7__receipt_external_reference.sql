-- Optional AWB / reference number a staffer can attach to a brand delivery,
-- if the brand happens to supply one. Nullable and read-only to the rest of
-- the app — no expected-quantity logic hangs off this yet, since we don't
-- have a real feed of what a reference number should map to.
ALTER TABLE inbound_receipts ADD COLUMN external_reference VARCHAR(64) NULL;
