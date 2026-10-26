CREATE INDEX document_revision_files_pending_cleanup_by_revision
    ON document_revision_files(revision_id)
    WHERE cleanup_status = 'pending';

CREATE INDEX document_revision_files_complete_cleanup_by_revision
    ON document_revision_files(revision_id)
    WHERE cleanup_status = 'complete';

CREATE INDEX document_scan_jobs_clean_scanned_at
    ON document_scan_jobs(scanned_at DESC)
    WHERE outcome = 'clean';

CREATE INDEX document_scan_jobs_failed_updated_at
    ON document_scan_jobs(updated_at DESC, id, attempts, result_code)
    WHERE status = 'failed';
