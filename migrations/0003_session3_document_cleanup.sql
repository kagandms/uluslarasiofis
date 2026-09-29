ALTER TABLE document_revision_files ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'none'
    CHECK (cleanup_status IN ('none', 'pending', 'complete'));
ALTER TABLE document_revision_files ADD COLUMN cleanup_requested_at TEXT;

CREATE INDEX idx_document_files_cleanup_status
    ON document_revision_files(cleanup_status, cleanup_requested_at);
