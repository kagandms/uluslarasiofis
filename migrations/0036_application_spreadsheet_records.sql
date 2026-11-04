CREATE TABLE application_spreadsheet_records (
    application_id TEXT PRIMARY KEY NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    record_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('pending_add', 'present', 'pending_remove', 'absent')),
    sheet_name TEXT,
    operation_id TEXT NOT NULL UNIQUE,
    last_actor_staff TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_application_spreadsheet_records_state ON application_spreadsheet_records(state);
