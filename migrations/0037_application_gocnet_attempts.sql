CREATE TABLE application_gocnet_attempts (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    application_number_hash TEXT NOT NULL CHECK(length(application_number_hash) = 64),
    manifest_fingerprint TEXT NOT NULL CHECK(length(manifest_fingerprint) = 64),
    pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256) = 64),
    state TEXT NOT NULL CHECK(state IN ('prepared', 'querying', 'saving', 'uploading', 'uploaded_for_review', 'existing_record', 'stopped', 'failed', 'outcome_unknown')),
    last_event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_event_sequence >= 0),
    remote_record_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_gocnet_active_application_attempt
    ON application_gocnet_attempts(application_id)
    WHERE state IN ('prepared', 'querying', 'saving', 'uploading', 'outcome_unknown');

CREATE UNIQUE INDEX idx_gocnet_active_application_number
    ON application_gocnet_attempts(application_number_hash)
    WHERE state IN ('prepared', 'querying', 'saving', 'uploading', 'outcome_unknown');

CREATE TABLE application_gocnet_attempt_events (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES application_gocnet_attempts(id) ON DELETE CASCADE,
    actor_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    state TEXT NOT NULL CHECK(state IN ('querying', 'saving', 'uploading', 'uploaded_for_review', 'existing_record', 'stopped', 'failed', 'outcome_unknown')),
    remote_record_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(attempt_id, sequence)
);
