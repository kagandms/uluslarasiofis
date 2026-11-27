-- Göç İdaresi durum eşitlemesinden gelen ek durum bilgisini (incelemede, eksik evrak, onaylandı) tutar.
CREATE TABLE migration_office_states (
    record_kind TEXT NOT NULL CHECK (record_kind IN ('online', 'physical')),
    record_id TEXT NOT NULL,
    application_number TEXT NOT NULL CHECK (
        length(application_number) = 15
        AND substr(application_number, 5, 1) = '-'
        AND substr(application_number, 8, 1) = '-'
        AND length(replace(application_number, '-', '')) = 13
        AND replace(application_number, '-', '') NOT GLOB '*[^0-9]*'
    ),
    state TEXT NOT NULL CHECK (state IN ('reviewing', 'missing_documents', 'approved')),
    note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    deadline TEXT,
    goc_last_query_at TEXT,
    import_id TEXT NOT NULL,
    updated_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (record_kind, record_id)
);

CREATE INDEX idx_migration_office_states_state
    ON migration_office_states(state, record_kind);
CREATE INDEX idx_migration_office_states_import
    ON migration_office_states(import_id);

ALTER TABLE yoksis_document_audit_records ADD COLUMN record_date TEXT;
