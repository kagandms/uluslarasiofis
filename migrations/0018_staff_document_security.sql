-- Temporary photo upload integrity only; no scanner queues or verdicts.
ALTER TABLE mobile_document_transfer_files ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'finalized' CHECK(upload_status IN ('uploading','finalized','failed','consumed'));
ALTER TABLE mobile_document_transfer_files ADD COLUMN sha256 TEXT;
CREATE TABLE mobile_transfer_rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
