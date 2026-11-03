CREATE TABLE yoksis_document_audit_records_replacement (
    application_number TEXT PRIMARY KEY NOT NULL CHECK (
        length(application_number) = 15
        AND substr(application_number, 5, 1) = '-'
        AND substr(application_number, 8, 1) = '-'
        AND length(replace(application_number, '-', '')) = 13
        AND replace(application_number, '-', '') NOT GLOB '*[^0-9]*'
    ),
    student_number TEXT NOT NULL CHECK (
        length(student_number) BETWEEN 8 AND 14 AND student_number NOT GLOB '*[^0-9]*'
    ),
    first_name TEXT NOT NULL DEFAULT '' CHECK (length(first_name) <= 120),
    last_name TEXT NOT NULL DEFAULT '' CHECK (length(last_name) <= 120),
    passport_number TEXT NOT NULL DEFAULT '' CHECK (length(passport_number) <= 64),
    phone TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
    application_status TEXT NOT NULL DEFAULT '' CHECK (length(application_status) <= 300),
    status_category TEXT NOT NULL CHECK (status_category IN (
        'successful', 'pending', 'rejected', 'missing_documents', 'unreadable', 'other'
    )),
    result_status TEXT NOT NULL CHECK (result_status IN ('verified', 'unreadable', 'identity-mismatch')),
    documents_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(documents_json)),
    search_text TEXT NOT NULL CHECK (length(search_text) <= 500),
    scanned_at TEXT NOT NULL,
    updated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT
);

INSERT INTO yoksis_document_audit_records_replacement (
    application_number, student_number, first_name, last_name, passport_number, phone,
    application_status, status_category, result_status, documents_json, search_text, scanned_at, updated_by_staff_id
)
SELECT
    application_number, student_number, first_name, last_name, passport_number, phone,
    application_status, status_category, result_status, documents_json, search_text, scanned_at, updated_by_staff_id
FROM yoksis_document_audit_records;

DROP TABLE yoksis_document_audit_records;
ALTER TABLE yoksis_document_audit_records_replacement RENAME TO yoksis_document_audit_records;

CREATE INDEX idx_yoksis_audit_status_scanned
    ON yoksis_document_audit_records(status_category, scanned_at DESC);
CREATE INDEX idx_yoksis_audit_student_number
    ON yoksis_document_audit_records(student_number);
