CREATE TABLE yoksis_audit_imports (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
    uploaded_at TEXT NOT NULL,
    uploaded_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    exported_at TEXT NULL,
    row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    finalized_at TEXT NULL
);

CREATE INDEX idx_yoksis_audit_imports_finalized
    ON yoksis_audit_imports(finalized_at DESC, uploaded_at DESC);

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN source TEXT NOT NULL DEFAULT 'scan' CHECK (source IN ('scan', 'excel'));

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN last_seen_import_id TEXT NULL;

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN unit TEXT NOT NULL DEFAULT '' CHECK (length(unit) <= 120);

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN program TEXT NOT NULL DEFAULT '' CHECK (length(program) <= 160);

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN missing_deadline TEXT NULL;

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN goc_last_query_at TEXT NULL;

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN last_transaction_type TEXT NOT NULL DEFAULT '' CHECK (length(last_transaction_type) <= 40);

ALTER TABLE yoksis_document_audit_records
    ADD COLUMN transaction_count INTEGER NOT NULL DEFAULT 1 CHECK (transaction_count >= 1);

CREATE INDEX idx_yoksis_audit_records_import
    ON yoksis_document_audit_records(last_seen_import_id);
