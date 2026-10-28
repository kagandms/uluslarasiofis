-- Keep the highest-frequency scanner status summary bounded by status count, not job history.
CREATE TABLE document_scan_job_status_counts (
    status TEXT PRIMARY KEY CHECK(status IN ('queued', 'leased', 'complete', 'failed', 'stale')),
    job_count INTEGER NOT NULL CHECK(job_count >= 0)
) WITHOUT ROWID;

INSERT INTO document_scan_job_status_counts(status, job_count)
SELECT status, count(*) FROM document_scan_jobs GROUP BY status;

CREATE TRIGGER document_scan_job_status_counts_insert
AFTER INSERT ON document_scan_jobs
BEGIN
    INSERT INTO document_scan_job_status_counts(status, job_count)
    VALUES(NEW.status, 1)
    ON CONFLICT(status) DO UPDATE SET job_count = job_count + 1;
END;

CREATE TRIGGER document_scan_job_status_counts_status_update
AFTER UPDATE OF status ON document_scan_jobs
WHEN OLD.status != NEW.status
BEGIN
    UPDATE document_scan_job_status_counts
    SET job_count = job_count - 1
    WHERE status = OLD.status;

    INSERT INTO document_scan_job_status_counts(status, job_count)
    VALUES(NEW.status, 1)
    ON CONFLICT(status) DO UPDATE SET job_count = job_count + 1;
END;

CREATE TRIGGER document_scan_job_status_counts_delete
AFTER DELETE ON document_scan_jobs
BEGIN
    UPDATE document_scan_job_status_counts
    SET job_count = job_count - 1
    WHERE status = OLD.status;
END;

-- Keep earlier hot-path DDL represented in migrations; Production may already have these indexes.
CREATE INDEX IF NOT EXISTS idx_revision_files_scan_pending
    ON document_revision_files(scan_status, upload_status, cleanup_status, revision_id);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_updated
    ON document_scan_jobs(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status_submission
    ON print_jobs(status, cleanup_status, submission_started_at);

-- Target the normalized uniqueness check without scanning all applications.
CREATE INDEX idx_applications_active_passport_dob
    ON applications(upper(trim(passport_number)), date_of_birth)
    WHERE status NOT IN ('completed', 'cancelled', 'rejected');

-- Let audit purge combine its existing application index with a record-scoped lookup.
CREATE INDEX idx_audit_events_document_record
    ON audit_events(document_record_id);
