CREATE TABLE print_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    idempotency_key_hash TEXT NOT NULL UNIQUE,
    upload_token_hash TEXT,
    tracking_token_hash TEXT NOT NULL,
    storage_key TEXT UNIQUE,
    media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20),
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 3),
    paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size = 'A4'),
    color_mode TEXT NOT NULL DEFAULT 'monochrome' CHECK (color_mode = 'monochrome'),
    duplex TEXT NOT NULL DEFAULT 'simplex' CHECK (duplex = 'simplex'),
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN (
        'uploading', 'queued', 'leased', 'ready', 'submission_started',
        'submitted', 'failed', 'unknown', 'cancelled', 'expired'
    )),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    available_at TEXT NOT NULL,
    runner_id TEXT,
    lease_until TEXT,
    lease_token_hash TEXT,
    submission_started_at TEXT,
    spooler_job_id TEXT,
    result_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    purge_after TEXT NOT NULL,
    cleanup_status TEXT NOT NULL DEFAULT 'none' CHECK (cleanup_status IN ('none', 'pending', 'complete')),
    cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
    storage_deleted_at TEXT
);

CREATE INDEX idx_print_jobs_due ON print_jobs(status, available_at, created_at);
CREATE INDEX idx_print_jobs_lease ON print_jobs(status, lease_until);
CREATE INDEX idx_print_jobs_cleanup ON print_jobs(cleanup_status, expires_at);
CREATE INDEX idx_print_jobs_purge ON print_jobs(cleanup_status, purge_after);

CREATE TABLE printer_heartbeats (
    printer_id TEXT PRIMARY KEY NOT NULL,
    runner_id TEXT NOT NULL,
    health TEXT NOT NULL CHECK (health IN ('ready', 'unavailable')),
    printer_name TEXT NOT NULL CHECK (length(printer_name) BETWEEN 1 AND 128),
    seen_at TEXT NOT NULL
);
