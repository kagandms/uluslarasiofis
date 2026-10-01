ALTER TABLE application_notes
ADD COLUMN document_record_id TEXT
REFERENCES document_records(id) ON DELETE RESTRICT;

CREATE INDEX idx_application_notes_document_visibility_created
ON application_notes(application_id, document_record_id, visibility, created_at DESC);
