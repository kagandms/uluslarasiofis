-- One reference-number e-mail per application, queued at submission and retried by later submissions.
-- Stores only delivery state and a short error code. The e-mail body and recipient address are not kept here.
CREATE TABLE application_reference_mails (
    application_id TEXT PRIMARY KEY NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'quota_deferred', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 1000),
    last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sent_at TEXT
);

CREATE INDEX idx_application_reference_mails_status ON application_reference_mails(status, updated_at);
