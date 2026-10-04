CREATE TABLE application_deletions (
    application_id TEXT PRIMARY KEY NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    previous_status TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('soft_deleted', 'purge_pending')),
    deleted_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    deleted_at TEXT NOT NULL,
    purge_started_at TEXT
);
CREATE INDEX idx_application_deletions_state ON application_deletions(state, deleted_at DESC);
