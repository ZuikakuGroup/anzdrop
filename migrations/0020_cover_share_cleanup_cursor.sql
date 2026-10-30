-- Cover the existing cleanup order and cursor without persisting new metadata.
-- Replace the expiry-only index rather than retaining two overlapping indexes.
DROP INDEX idx_shares_expires_at;
CREATE INDEX idx_shares_expires_at ON shares (expires_at, id);
