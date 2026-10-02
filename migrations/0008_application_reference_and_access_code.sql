ALTER TABLE applications ADD COLUMN reference_number TEXT;
ALTER TABLE applications ADD COLUMN access_code_hash TEXT;
ALTER TABLE applications ADD COLUMN access_code_created_at TEXT;
ALTER TABLE applications ADD COLUMN access_code_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE applications ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1;

-- Backfill reference_number for existing applications without one
-- Generates unique ITU-XXXX-XXXX format references using unconfusable 31-character set (no 0, 1, I, L, O)
UPDATE applications
SET reference_number = 'ITU-' ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  '-' ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (abs(random()) % 31) + 1, 1)
WHERE reference_number IS NULL;

CREATE UNIQUE INDEX idx_applications_reference_number ON applications(reference_number);
