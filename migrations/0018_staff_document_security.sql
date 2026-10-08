ALTER TABLE mobile_document_transfers ADD COLUMN pairing_code_hash TEXT;
ALTER TABLE mobile_document_transfers ADD COLUMN phone_approved_at INTEGER;
ALTER TABLE mobile_document_transfer_files ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'finalized' CHECK(upload_status IN ('uploading','finalized','failed','consumed'));
ALTER TABLE mobile_document_transfer_files ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','unsafe','failed'));
ALTER TABLE mobile_document_transfer_files ADD COLUMN sha256 TEXT;
CREATE TABLE mobile_transfer_rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE staff_document_scan_jobs (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE,
    revision_id TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 10485760),
    media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','complete','failed','stale')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_until TEXT,
    lease_token_hash TEXT,
    runner_id TEXT,
    object_etag TEXT,
    content_sha256 TEXT,
    outcome TEXT CHECK(outcome IN ('clean','unsafe','failed')),
    result_code TEXT,
    engine_version TEXT,
    signature_version TEXT,
    signature_updated_at TEXT,
    scanned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX staff_document_scan_jobs_due ON staff_document_scan_jobs(status, available_at);
CREATE INDEX staff_document_scan_jobs_lease ON staff_document_scan_jobs(status, lease_until);

CREATE VIEW staff_scan_files AS
SELECT 'physical_'||files.id AS file_id, 'physical_'||files.intake_id AS revision_id,
 files.storage_key, files.byte_size, files.media_type, files.scan_status,
 files.upload_status, files.sha256
FROM physical_intake_files files JOIN physical_intakes intake ON intake.id=files.intake_id
WHERE intake.deleted_at IS NULL AND intake.current_pdf_id=files.id
UNION ALL
SELECT 'mobile_'||files.id, 'mobile_'||files.transfer_id, files.storage_key, files.byte_size,
 'image/jpeg', files.scan_status, files.upload_status, files.sha256
FROM mobile_document_transfer_files files JOIN mobile_document_transfers transfers ON transfers.id=files.transfer_id
WHERE transfers.expires_at>unixepoch();

CREATE TRIGGER physical_approval_scan_guard BEFORE UPDATE OF status ON physical_intakes
WHEN NEW.status='approved_for_processing' AND NOT EXISTS(SELECT 1 FROM physical_intake_files
 WHERE id=NEW.current_pdf_id AND intake_id=NEW.id AND upload_status='finalized' AND scan_status='clean')
BEGIN SELECT RAISE(ABORT,'physical_pdf_scan_required'); END;
CREATE TRIGGER physical_insert_scan_guard BEFORE INSERT ON physical_intakes
WHEN NEW.status='approved_for_processing'
BEGIN SELECT RAISE(ABORT,'physical_pdf_scan_required'); END;
