ALTER TABLE print_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source IN ('student', 'staff', 'unknown'));
ALTER TABLE print_jobs ADD COLUMN created_by_staff_id TEXT;
ALTER TABLE print_jobs ADD COLUMN created_by_staff_role TEXT
    CHECK (created_by_staff_role IS NULL OR created_by_staff_role IN ('admin', 'reviewer'));

CREATE TABLE print_queue_controls (
    id TEXT PRIMARY KEY NOT NULL CHECK (id = 'global'),
    is_paused INTEGER NOT NULL DEFAULT 0 CHECK (is_paused IN (0, 1)),
    updated_by_staff_id TEXT,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

INSERT INTO print_queue_controls (id, is_paused, updated_at, version)
VALUES ('global', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0);

CREATE TABLE print_queue_audit (
    id TEXT PRIMARY KEY NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'queue_paused', 'queue_resumed', 'job_cancelled', 'staff_job_created'
    )),
    actor_staff_id TEXT NOT NULL,
    actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'reviewer')),
    job_id TEXT,
    previous_status TEXT,
    occurred_at TEXT NOT NULL
);

CREATE INDEX idx_print_jobs_history ON print_jobs(created_at DESC, id DESC);
CREATE INDEX idx_print_jobs_source_history ON print_jobs(source, created_at DESC, id DESC);
CREATE INDEX idx_print_queue_audit_time ON print_queue_audit(occurred_at DESC, id DESC);

CREATE TRIGGER audit_staff_print_job
AFTER INSERT ON print_jobs
WHEN NEW.source='staff' AND NEW.created_by_staff_id IS NOT NULL AND NEW.created_by_staff_role IS NOT NULL
BEGIN
    INSERT INTO print_queue_audit
        (id,event_type,actor_staff_id,actor_role,job_id,occurred_at)
    VALUES (lower(hex(randomblob(16))), 'staff_job_created', NEW.created_by_staff_id,
        NEW.created_by_staff_role, NEW.id, NEW.created_at);
END;
