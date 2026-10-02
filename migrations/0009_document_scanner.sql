-- 0008 is reserved for the independent pilot access-code branch.
CREATE TABLE document_scan_jobs (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL UNIQUE REFERENCES document_revision_files(id),
    revision_id TEXT NOT NULL REFERENCES document_revisions(id),
    storage_key TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 10485760),
    media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
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
CREATE INDEX document_scan_jobs_due ON document_scan_jobs(status, available_at);
CREATE INDEX document_scan_jobs_lease ON document_scan_jobs(status, lease_until);
CREATE TABLE scanner_heartbeats (
    runner_id TEXT PRIMARY KEY,
    health TEXT NOT NULL CHECK(health IN ('ready','engine_unavailable','signature_stale','update_failed')),
    engine_version TEXT,
    signature_version TEXT,
    signature_updated_at TEXT,
    seen_at TEXT NOT NULL
);

-- Historical pending files are reconciled without assigning any verdict.
INSERT OR IGNORE INTO document_scan_jobs
    (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
SELECT lower(hex(randomblob(16))), files.id, files.revision_id, files.storage_key,
    files.byte_size, files.media_type,
    strftime('%Y-%m-%dT%H:%M:%fZ', max(datetime(intents.expires_at), datetime(intents.completed_at, '+300 seconds'))),
    strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM document_revision_files AS files
JOIN document_revisions AS revisions ON revisions.id = files.revision_id
JOIN upload_intents AS intents ON intents.revision_file_id = files.id AND intents.status = 'completed'
WHERE files.upload_status = 'finalized' AND files.scan_status = 'pending'
  AND files.cleanup_status = 'none' AND revisions.is_current = 1;
