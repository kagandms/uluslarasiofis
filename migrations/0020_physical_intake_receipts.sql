ALTER TABLE physical_intakes ADD COLUMN tracking_reference TEXT;
ALTER TABLE physical_intakes ADD COLUMN application_date TEXT;
ALTER TABLE physical_intakes ADD COLUMN processing_closed_at TEXT;
ALTER TABLE physical_intakes ADD COLUMN processing_closed_by_staff_id TEXT REFERENCES staff_users(id);
ALTER TABLE physical_intakes ADD COLUMN processing_closure_reason TEXT;
ALTER TABLE physical_intakes ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1 CHECK(metadata_version>0);
ALTER TABLE physical_intakes ADD COLUMN registration_body_hash TEXT;
CREATE UNIQUE INDEX physical_tracking_reference ON physical_intakes(tracking_reference) WHERE tracking_reference IS NOT NULL;
DROP INDEX physical_intakes_one_active;
CREATE UNIQUE INDEX physical_intakes_one_active ON physical_intakes(student_number)
 WHERE student_number<>'' AND deleted_at IS NULL AND status<>'rejected'
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed';
CREATE TRIGGER physical_passport_insert BEFORE INSERT ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status<>'rejected' AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE deleted_at IS NULL AND status<>'rejected'
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;
CREATE TRIGGER physical_passport_update BEFORE UPDATE ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status<>'rejected' AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND (upper(trim(OLD.passport_number))<>upper(trim(NEW.passport_number)) OR OLD.application_type<>NEW.application_type
 OR OLD.deleted_at IS NOT NULL OR OLD.status='rejected' OR OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed')
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE id<>NEW.id AND deleted_at IS NULL AND status<>'rejected'
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;
CREATE TRIGGER physical_closed_metadata BEFORE UPDATE ON physical_intakes
 WHEN (OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed') AND
 (OLD.first_name<>NEW.first_name OR OLD.last_name<>NEW.last_name OR OLD.passport_number<>NEW.passport_number
 OR OLD.student_number<>NEW.student_number OR OLD.application_type<>NEW.application_type
 OR OLD.application_date IS NOT NEW.application_date OR OLD.current_pdf_id IS NOT NEW.current_pdf_id)
 BEGIN SELECT RAISE(ABORT,'physical_processing_closed'); END;
-- A consumed UUID is a tombstone: intake deletion must never make a given reference reusable.
CREATE TABLE physical_reference_reservations (
 id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, tracking_reference TEXT NOT NULL UNIQUE,
 staff_id TEXT NOT NULL REFERENCES staff_users(id), session_hash TEXT NOT NULL,
 application_date TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 consumed_intake_id TEXT, UNIQUE(draft_id,session_hash)
);
CREATE TABLE physical_intake_receipts (
 id TEXT PRIMARY KEY, intake_id TEXT NOT NULL REFERENCES physical_intakes(id) ON DELETE CASCADE,
 document_version INTEGER NOT NULL CHECK(document_version>0), creation_id TEXT NOT NULL UNIQUE,
 snapshot_json TEXT NOT NULL, template_version TEXT NOT NULL, metadata_version INTEGER NOT NULL,
 artefact_key TEXT UNIQUE, sha256 TEXT, byte_size INTEGER,
 state TEXT NOT NULL DEFAULT 'awaiting_content' CHECK(state IN ('awaiting_content','ready','purged')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, download_lease_until TEXT,
 UNIQUE(intake_id,document_version)
);
CREATE TABLE physical_receipt_print_attempts (
 id TEXT PRIMARY KEY, intake_id TEXT NOT NULL REFERENCES physical_intakes(id) ON DELETE CASCADE,
 receipt_id TEXT NOT NULL REFERENCES physical_intake_receipts(id) ON DELETE CASCADE,
 creation_id TEXT NOT NULL UNIQUE, job_id TEXT UNIQUE,
 status TEXT NOT NULL, last_known_at TEXT NOT NULL, submission_started_at TEXT,
 result_code TEXT, spooler_job_id TEXT,
 blocks_new_attempt INTEGER NOT NULL DEFAULT 1 CHECK(blocks_new_attempt IN (0,1)),
 risk_acknowledged_at TEXT, risk_acknowledged_by TEXT REFERENCES staff_users(id), risk_reason TEXT,
 created_by_staff_id TEXT NOT NULL REFERENCES staff_users(id), created_at TEXT NOT NULL,
 decision TEXT NOT NULL DEFAULT 'print' CHECK(decision IN ('print','reprint','manual'))
);
CREATE UNIQUE INDEX physical_receipt_one_live_attempt ON physical_receipt_print_attempts(intake_id) WHERE blocks_new_attempt=1;
CREATE INDEX physical_receipts_cleanup ON physical_intake_receipts(state,expires_at);
CREATE TRIGGER physical_receipt_print_update AFTER UPDATE ON print_jobs
 BEGIN UPDATE physical_receipt_print_attempts SET status=NEW.status,last_known_at=NEW.updated_at,
 submission_started_at=coalesce(NEW.submission_started_at,submission_started_at),result_code=NEW.result_code,
 spooler_job_id=coalesce(NEW.spooler_job_id,spooler_job_id),
 blocks_new_attempt=CASE WHEN risk_acknowledged_at IS NOT NULL THEN 0
 WHEN NEW.status IN ('submitted','cancelled') THEN 0
 WHEN NEW.status IN ('failed','expired') AND NEW.submission_started_at IS NULL AND submission_started_at IS NULL THEN 0 ELSE 1 END
 WHERE job_id=NEW.id; END;
CREATE TRIGGER physical_receipt_print_delete BEFORE DELETE ON print_jobs
 BEGIN UPDATE physical_receipt_print_attempts SET
 status=CASE WHEN OLD.status IN ('submitted','failed','cancelled','expired','unknown') THEN OLD.status ELSE 'unknown' END,
 last_known_at=OLD.updated_at,submission_started_at=coalesce(OLD.submission_started_at,submission_started_at),
 result_code=OLD.result_code,spooler_job_id=coalesce(OLD.spooler_job_id,spooler_job_id),
 blocks_new_attempt=CASE WHEN risk_acknowledged_at IS NOT NULL THEN 0
 WHEN OLD.status IN ('submitted','cancelled') THEN 0
 WHEN OLD.status IN ('failed','expired') AND OLD.submission_started_at IS NULL AND submission_started_at IS NULL THEN 0 ELSE 1 END
 WHERE job_id=OLD.id; END;
CREATE TRIGGER physical_receipt_attempt_job BEFORE INSERT ON physical_receipt_print_attempts
 WHEN NEW.decision<>'manual' AND NOT EXISTS(SELECT 1 FROM print_jobs WHERE id=NEW.job_id AND source='staff'
 AND status='uploading' AND cleanup_status='none')
 BEGIN SELECT RAISE(ABORT,'physical_receipt_print_unavailable'); END;
CREATE TRIGGER physical_receipt_attempt_snapshot BEFORE INSERT ON physical_receipt_print_attempts
 WHEN NOT EXISTS(SELECT 1 FROM physical_intake_receipts JOIN physical_intakes ON physical_intakes.id=physical_intake_receipts.intake_id
 WHERE physical_intake_receipts.id=NEW.receipt_id AND physical_intakes.id=NEW.intake_id
 AND physical_intakes.deleted_at IS NULL AND physical_intake_receipts.state='ready'
 AND physical_intake_receipts.metadata_version=physical_intakes.metadata_version)
 BEGIN SELECT RAISE(ABORT,'physical_receipt_snapshot_stale'); END;
CREATE TRIGGER physical_receipt_manual_guard BEFORE INSERT ON physical_receipt_print_attempts
 WHEN NEW.decision='manual' AND EXISTS(SELECT 1 FROM physical_receipt_print_attempts WHERE intake_id=NEW.intake_id AND blocks_new_attempt=1)
 BEGIN SELECT RAISE(ABORT,'physical_receipt_print_blocked'); END;
CREATE TRIGGER physical_receipt_first_guard BEFORE INSERT ON physical_receipt_print_attempts
 WHEN NEW.decision='print' AND EXISTS(SELECT 1 FROM physical_receipt_print_attempts WHERE intake_id=NEW.intake_id)
 BEGIN SELECT RAISE(ABORT,'physical_receipt_reprint_required'); END;
ALTER TABLE physical_intake_receipts ADD COLUMN purge_claim_until TEXT;
CREATE TRIGGER physical_receipt_attempt_retention BEFORE INSERT ON physical_receipt_print_attempts
 WHEN EXISTS(SELECT 1 FROM physical_intake_receipts WHERE id=NEW.receipt_id AND purge_claim_until IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'physical_receipt_snapshot_stale'); END;
CREATE TABLE physical_receipt_cleanup_cursor (
 id TEXT PRIMARY KEY CHECK(id='global'), listing_cursor TEXT
);
INSERT INTO physical_receipt_cleanup_cursor(id) VALUES('global');
CREATE TABLE physical_receipt_schema (
 id TEXT PRIMARY KEY CHECK(id='global'), version INTEGER NOT NULL CHECK(version=1)
);
INSERT INTO physical_receipt_schema(id,version) VALUES('global',1);
