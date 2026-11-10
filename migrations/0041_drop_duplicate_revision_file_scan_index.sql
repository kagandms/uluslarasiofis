-- idx_revision_files_scan_pending (scan_status, upload_status, cleanup_status, revision_id) leads with the same
-- column as idx_document_files_scan_status (scan_status, created_at) and serves every scan_status lookup the
-- scanner and reconcile queries make. Dropping the redundant index removes one index write per file update
-- that changes scan_status, with no query plan change for the scanner paths (verified locally).
DROP INDEX IF EXISTS idx_document_files_scan_status;
