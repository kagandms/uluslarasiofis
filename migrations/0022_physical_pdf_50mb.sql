CREATE TABLE physical_pdf_pointer_backup_50mb AS
    SELECT id AS intake_id,current_pdf_id AS file_id FROM physical_intakes WHERE current_pdf_id IS NOT NULL;
CREATE TABLE physical_scan_jobs_backup_50mb AS SELECT * FROM physical_document_scan_jobs;

DROP TABLE physical_document_scan_jobs;
DROP TRIGGER physical_migration_pdf_guard;
DROP TRIGGER physical_closed_metadata;
UPDATE physical_intakes SET current_pdf_id=NULL WHERE current_pdf_id IS NOT NULL;

CREATE TABLE physical_intake_files_50mb (
    id TEXT PRIMARY KEY,
    intake_id TEXT NOT NULL REFERENCES physical_intakes(id),
    revision_number INTEGER NOT NULL CHECK(revision_number>0),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=52428800),
    media_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK(media_type='application/pdf'),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    upload_status TEXT NOT NULL CHECK(upload_status IN ('uploading','finalized','failed')),
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','unsafe','failed')),
    uploaded_at TEXT NOT NULL,
    created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    UNIQUE(intake_id,revision_number)
);
INSERT INTO physical_intake_files_50mb SELECT * FROM physical_intake_files;
DROP TABLE physical_intake_files;
ALTER TABLE physical_intake_files_50mb RENAME TO physical_intake_files;
CREATE INDEX physical_intake_files_history ON physical_intake_files(intake_id,revision_number DESC);
UPDATE physical_intakes SET current_pdf_id=(SELECT file_id FROM physical_pdf_pointer_backup_50mb WHERE intake_id=physical_intakes.id)
    WHERE id IN (SELECT intake_id FROM physical_pdf_pointer_backup_50mb);

CREATE TABLE physical_document_scan_jobs (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE REFERENCES physical_intake_files(id),
    revision_id TEXT NOT NULL REFERENCES physical_intake_files(id),
    storage_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=52428800),
    media_type TEXT NOT NULL CHECK(media_type='application/pdf'),
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
INSERT INTO physical_document_scan_jobs SELECT * FROM physical_scan_jobs_backup_50mb;
CREATE INDEX physical_document_scan_jobs_due ON physical_document_scan_jobs(status,available_at);

DROP TABLE physical_pdf_pointer_backup_50mb;
DROP TABLE physical_scan_jobs_backup_50mb;
CREATE TRIGGER physical_closed_metadata BEFORE UPDATE ON physical_intakes
 WHEN (OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed' OR OLD.status='completed') AND
 (OLD.first_name<>NEW.first_name OR OLD.last_name<>NEW.last_name OR OLD.passport_number<>NEW.passport_number
 OR OLD.student_number<>NEW.student_number OR OLD.application_type<>NEW.application_type
 OR OLD.application_date IS NOT NEW.application_date OR OLD.current_pdf_id IS NOT NEW.current_pdf_id)
 BEGIN SELECT RAISE(ABORT,'physical_processing_closed'); END;
CREATE TRIGGER physical_migration_pdf_guard BEFORE UPDATE OF status ON physical_intakes
 WHEN NEW.status IN ('sent_to_migration','migration_approved','completed')
 AND NOT EXISTS(SELECT 1 FROM physical_intake_files WHERE id=NEW.current_pdf_id AND intake_id=NEW.id AND upload_status='finalized')
 BEGIN SELECT RAISE(ABORT,'physical_migration_pdf_required'); END;
