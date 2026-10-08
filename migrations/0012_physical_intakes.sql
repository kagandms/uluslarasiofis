CREATE TABLE physical_intakes (
    id TEXT PRIMARY KEY,
    student_number TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    passport_number TEXT NOT NULL DEFAULT '',
    application_type TEXT NOT NULL CHECK(application_type IN ('initial','renewal')),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','resubmission_required','approved_for_processing','sent_to_migration','migration_approved','completed','cancelled','rejected')),
    linked_application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
    current_pdf_id TEXT REFERENCES physical_intake_files(id),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK(lock_version>0),
    deleted_at TEXT
);
CREATE UNIQUE INDEX physical_intakes_one_active ON physical_intakes(student_number)
    WHERE deleted_at IS NULL AND status NOT IN ('completed','cancelled','rejected');
CREATE INDEX physical_intakes_queue ON physical_intakes(deleted_at,status,updated_at);
CREATE TABLE physical_intake_files (
    id TEXT PRIMARY KEY,
    intake_id TEXT NOT NULL REFERENCES physical_intakes(id),
    revision_number INTEGER NOT NULL CHECK(revision_number>0),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10485760),
    media_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK(media_type='application/pdf'),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    upload_status TEXT NOT NULL CHECK(upload_status IN ('uploading','finalized','failed')),
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','unsafe','failed')),
    uploaded_at TEXT NOT NULL,
    created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id),
    UNIQUE(intake_id,revision_number)
);
CREATE INDEX physical_intake_files_history ON physical_intake_files(intake_id,revision_number DESC);
CREATE TABLE physical_document_scan_jobs (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE REFERENCES physical_intake_files(id),
    revision_id TEXT NOT NULL REFERENCES physical_intake_files(id),
    storage_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10485760),
    media_type TEXT NOT NULL CHECK(media_type='application/pdf'),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','leased','complete','failed','stale')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_until TEXT,
    lease_token_hash TEXT,
    runner_id TEXT,
    object_etag TEXT,
    content_sha256 TEXT,
    outcome TEXT CHECK(outcome IN ('clean','unsafe','failed')),
    result_code TEXT,
    engine_version TEXT,
    signature_version TEXT,
    signature_updated_at TEXT,
    scanned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX physical_document_scan_jobs_due ON physical_document_scan_jobs(status,available_at);
