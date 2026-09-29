CREATE TABLE students (
    id TEXT PRIMARY KEY NOT NULL,
    student_number TEXT NOT NULL CHECK (length(trim(student_number)) BETWEEN 1 AND 64),
    normalized_student_number TEXT NOT NULL UNIQUE CHECK (length(normalized_student_number) BETWEEN 1 AND 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE applications (
    id TEXT PRIMARY KEY NOT NULL,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    application_type TEXT NOT NULL CHECK (application_type IN ('initial', 'renewal')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'under_review', 'resubmission_required',
        'approved_for_processing', 'sent_to_migration', 'migration_approved',
        'completed', 'cancelled', 'rejected'
    )),
    student_email TEXT,
    student_phone TEXT,
    first_name TEXT,
    last_name TEXT,
    passport_number TEXT,
    nationality TEXT,
    date_of_birth TEXT,
    is_under_18 INTEGER CHECK (is_under_18 IN (0, 1)),
    declaration_version TEXT,
    declaration_accepted_at TEXT,
    submitted_at TEXT,
    terminal_at TEXT,
    retention_due_at TEXT,
    last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, application_type)
);

CREATE UNIQUE INDEX idx_applications_one_active_per_student
    ON applications(student_id)
    WHERE status NOT IN ('completed', 'cancelled', 'rejected');
CREATE INDEX idx_applications_status_created ON applications(status, created_at DESC);
CREATE INDEX idx_applications_student_status ON applications(student_id, status);
CREATE INDEX idx_applications_retention_due ON applications(status, retention_due_at);

CREATE TABLE document_requirements (
    id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    application_type TEXT NOT NULL CHECK (application_type IN ('initial', 'renewal')),
    is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (code, application_type),
    UNIQUE (id, application_type)
);

CREATE TABLE document_records (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    requirement_id TEXT NOT NULL REFERENCES document_requirements(id) ON DELETE RESTRICT,
    application_type TEXT NOT NULL CHECK (application_type IN ('initial', 'renewal')),
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
        'pending', 'under_review', 'approved', 'resubmission_required'
    )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (application_id, requirement_id),
    FOREIGN KEY (application_id, application_type) REFERENCES applications(id, application_type) ON DELETE RESTRICT,
    FOREIGN KEY (requirement_id, application_type) REFERENCES document_requirements(id, application_type) ON DELETE RESTRICT
);
CREATE INDEX idx_document_records_application_status ON document_records(application_id, review_status);

CREATE TABLE document_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    document_record_id TEXT NOT NULL REFERENCES document_records(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    status TEXT NOT NULL DEFAULT 'pending_scan' CHECK (status IN (
        'pending_scan', 'submitted', 'approved', 'resubmission_required', 'superseded'
    )),
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    submitted_by_type TEXT NOT NULL CHECK (submitted_by_type IN ('student', 'staff')),
    submitted_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    reviewed_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    UNIQUE (document_record_id, revision_number)
);
CREATE UNIQUE INDEX idx_document_revisions_one_current
    ON document_revisions(document_record_id) WHERE is_current = 1;
CREATE INDEX idx_document_revisions_review_status ON document_revisions(status, uploaded_at);

CREATE TABLE document_revision_files (
    id TEXT PRIMARY KEY NOT NULL,
    revision_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE RESTRICT,
    page_order INTEGER NOT NULL CHECK (page_order >= 0),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    sha256 TEXT,
    upload_status TEXT NOT NULL DEFAULT 'intent' CHECK (upload_status IN (
        'intent', 'uploaded', 'finalized', 'quarantined', 'rejected'
    )),
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN (
        'pending', 'clean', 'unsafe', 'failed'
    )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (revision_id, page_order)
);
CREATE INDEX idx_document_files_scan_status ON document_revision_files(scan_status, created_at);

CREATE TABLE upload_intents (
    id TEXT PRIMARY KEY NOT NULL,
    revision_file_id TEXT NOT NULL UNIQUE REFERENCES document_revision_files(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);
CREATE INDEX idx_upload_intents_expiry_status ON upload_intents(status, expires_at);

CREATE TABLE staff_users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) BETWEEN 3 AND 64),
    normalized_username TEXT NOT NULL UNIQUE CHECK (length(normalized_username) BETWEEN 3 AND 64),
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    role TEXT NOT NULL CHECK (role IN ('admin', 'reviewer')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);
CREATE INDEX idx_staff_users_active_role ON staff_users(is_active, role);

CREATE TABLE staff_bootstrap_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    staff_user_id TEXT NOT NULL UNIQUE,
    completed_at TEXT NOT NULL
);

CREATE TABLE staff_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    staff_user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_staff_sessions_user_expiry ON staff_sessions(staff_user_id, expires_at);

CREATE TABLE application_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_application_sessions_application_expiry ON application_sessions(application_id, expires_at);

CREATE TABLE staff_login_attempts (
    attempt_key TEXT PRIMARY KEY NOT NULL,
    window_started_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
    blocked_until INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_staff_login_attempts_updated ON staff_login_attempts(updated_at);

CREATE TABLE public_rate_limits (
    endpoint TEXT NOT NULL,
    request_key_hash TEXT NOT NULL,
    window_started_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    blocked_until INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (endpoint, request_key_hash)
);
CREATE INDEX idx_public_rate_limits_updated ON public_rate_limits(updated_at);

CREATE TABLE assignments (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    staff_user_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    assigned_by_staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TEXT
);
CREATE UNIQUE INDEX idx_assignments_one_active_per_application
    ON assignments(application_id) WHERE status = 'active';
CREATE INDEX idx_assignments_staff_status ON assignments(staff_user_id, status, assigned_at DESC);

CREATE TABLE application_notes (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    author_type TEXT NOT NULL CHECK (author_type IN ('staff', 'student', 'system')),
    author_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    visibility TEXT NOT NULL CHECK (visibility IN ('staff', 'student')),
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((author_type = 'staff' AND author_staff_id IS NOT NULL) OR author_type <> 'staff')
);
CREATE INDEX idx_application_notes_visibility_created ON application_notes(application_id, visibility, created_at);

CREATE TABLE audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'student', 'system')),
    actor_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    application_id TEXT REFERENCES applications(id) ON DELETE RESTRICT,
    document_record_id TEXT REFERENCES document_records(id) ON DELETE RESTRICT,
    request_id TEXT NOT NULL,
    safe_metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(safe_metadata_json)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_events_application_created ON audit_events(application_id, created_at DESC);
CREATE INDEX idx_audit_events_actor_created ON audit_events(actor_staff_id, created_at DESC);

CREATE TABLE notifications (
    id TEXT PRIMARY KEY NOT NULL,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    created_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE RESTRICT,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
    template_key TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language IN ('tr', 'en', 'ru', 'tk', 'ar')),
    recipient_masked TEXT,
    provider_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'processing', 'sent', 'delivered', 'read', 'failed'
    )),
    is_manual INTEGER NOT NULL DEFAULT 1 CHECK (is_manual IN (0, 1)),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,
    delivered_at TEXT,
    read_at TEXT,
    failed_at TEXT
);
CREATE INDEX idx_notifications_application_created ON notifications(application_id, created_at DESC);
CREATE INDEX idx_notifications_status_created ON notifications(status, created_at);

CREATE TABLE notification_outbox (
    id TEXT PRIMARY KEY NOT NULL,
    notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'sent', 'retry', 'dead'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_outbox_due ON notification_outbox(status, next_attempt_at);

CREATE TABLE idempotency_records (
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    resource_id TEXT,
    response_status INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, idempotency_key)
);
CREATE INDEX idx_idempotency_records_expiry ON idempotency_records(expires_at);

INSERT INTO document_requirements (id, code, application_type, display_order)
VALUES
    ('req-initial-application-form', 'residence_application_form', 'initial', 1),
    ('req-renewal-application-form', 'residence_application_form', 'renewal', 1),
    ('req-initial-passport-identity', 'passport_identity', 'initial', 2),
    ('req-renewal-passport-identity', 'passport_identity', 'renewal', 2),
    ('req-initial-photographs', 'photographs', 'initial', 3),
    ('req-renewal-photographs', 'photographs', 'renewal', 3),
    ('req-initial-health-insurance', 'health_insurance', 'initial', 4),
    ('req-renewal-health-insurance', 'health_insurance', 'renewal', 4),
    ('req-renewal-uets', 'uets', 'renewal', 5),
    ('req-initial-student-certificate', 'student_certificate', 'initial', 6),
    ('req-renewal-student-certificate', 'student_certificate', 'renewal', 6),
    ('req-initial-residence-fee', 'residence_permit_fee', 'initial', 7),
    ('req-renewal-residence-fee', 'residence_permit_fee', 'renewal', 7),
    ('req-initial-address-document', 'address_document', 'initial', 8),
    ('req-renewal-address-document', 'address_document', 'renewal', 8),
    ('req-initial-fingerprint', 'fingerprint', 'initial', 9),
    ('req-renewal-fingerprint', 'fingerprint', 'renewal', 9),
    ('req-initial-home-utility-bill', 'home_utility_bill', 'initial', 10),
    ('req-renewal-home-utility-bill', 'home_utility_bill', 'renewal', 10);
