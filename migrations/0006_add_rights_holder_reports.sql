ALTER TABLE reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE reports ADD COLUMN claimant_name TEXT;
ALTER TABLE reports ADD COLUMN contact_email TEXT;
ALTER TABLE reports ADD COLUMN right_type TEXT;
