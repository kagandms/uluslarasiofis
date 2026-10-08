ALTER TABLE print_jobs RENAME TO print_jobs_0012;

CREATE TABLE print_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    idempotency_key_hash TEXT NOT NULL UNIQUE,
    upload_token_hash TEXT,
    tracking_token_hash TEXT NOT NULL,
    storage_key TEXT UNIQUE,
    media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
    page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20),
    copies INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 50),
    orientation TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape')),
    paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A3')),
    color_mode TEXT NOT NULL DEFAULT 'monochrome' CHECK (color_mode IN ('monochrome', 'color')),
    duplex TEXT NOT NULL DEFAULT 'simplex' CHECK (duplex IN ('simplex', 'duplexlong')),
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
    storage_deleted_at TEXT,
    CHECK (page_count IS NULL OR page_count * copies <= 1000)
);

INSERT INTO print_jobs (
    id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,page_count,copies,
    orientation,paper_size,color_mode,duplex,status,attempts,available_at,runner_id,lease_until,lease_token_hash,
    submission_started_at,spooler_job_id,result_code,created_at,updated_at,expires_at,purge_after,
    cleanup_status,cleanup_attempts,storage_deleted_at
)
SELECT
    id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,page_count,copies,
    'portrait',paper_size,color_mode,duplex,status,attempts,available_at,runner_id,lease_until,lease_token_hash,
    submission_started_at,spooler_job_id,result_code,created_at,updated_at,expires_at,purge_after,
    cleanup_status,cleanup_attempts,storage_deleted_at
FROM print_jobs_0012;

DROP TABLE print_jobs_0012;

CREATE INDEX idx_print_jobs_due ON print_jobs(status, available_at, created_at);
CREATE INDEX idx_print_jobs_lease ON print_jobs(status, lease_until);
CREATE INDEX idx_print_jobs_cleanup ON print_jobs(cleanup_status, expires_at);
CREATE INDEX idx_print_jobs_purge ON print_jobs(cleanup_status, purge_after);

CREATE TABLE printer_heartbeats_0012 (
    printer_id TEXT PRIMARY KEY NOT NULL,
    runner_id TEXT NOT NULL,
    health TEXT NOT NULL CHECK (health IN ('ready', 'unavailable')),
    printer_name TEXT NOT NULL CHECK (length(printer_name) BETWEEN 1 AND 128),
    seen_at TEXT NOT NULL,
    settings_protocol INTEGER NOT NULL DEFAULT 0 CHECK (settings_protocol IN (0, 1, 2))
);

INSERT INTO printer_heartbeats_0012(printer_id,runner_id,health,printer_name,seen_at,settings_protocol)
SELECT printer_id,runner_id,health,printer_name,seen_at,settings_protocol FROM printer_heartbeats;

DROP TABLE printer_heartbeats;
ALTER TABLE printer_heartbeats_0012 RENAME TO printer_heartbeats;
