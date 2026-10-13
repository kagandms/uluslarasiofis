ALTER TABLE mobile_document_transfers ADD COLUMN active_batch_id TEXT;
ALTER TABLE mobile_document_transfer_files ADD COLUMN batch_id TEXT;

CREATE TABLE mobile_document_transfer_batches (
 id TEXT PRIMARY KEY,
 transfer_id TEXT NOT NULL REFERENCES mobile_document_transfers(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('active','closed')),
 file_count INTEGER NOT NULL DEFAULT 0 CHECK(file_count BETWEEN 0 AND 30),
 byte_count INTEGER NOT NULL DEFAULT 0 CHECK(byte_count BETWEEN 0 AND 125829120),
 created_at INTEGER NOT NULL,
 closed_at INTEGER,
 UNIQUE(id,transfer_id)
);

CREATE INDEX mobile_transfer_batches_transfer ON mobile_document_transfer_batches(transfer_id,status,created_at);
CREATE UNIQUE INDEX mobile_transfer_one_active_batch ON mobile_document_transfer_batches(transfer_id) WHERE status='active';
CREATE INDEX mobile_transfer_files_batch_status ON mobile_document_transfer_files(transfer_id,batch_id,upload_status);

DROP TRIGGER mobile_transfer_file_quota;

CREATE TRIGGER mobile_transfer_batch_quota_insert AFTER INSERT ON mobile_document_transfer_files
WHEN NEW.batch_id IS NOT NULL
BEGIN
 UPDATE mobile_document_transfer_batches
 SET file_count=file_count+1, byte_count=byte_count+NEW.byte_size
 WHERE id=NEW.batch_id;
END;

CREATE TRIGGER mobile_transfer_batch_quota_retry AFTER UPDATE OF upload_status ON mobile_document_transfer_files
WHEN OLD.upload_status='failed' AND NEW.upload_status='uploading' AND NEW.batch_id IS NOT NULL
BEGIN
 UPDATE mobile_document_transfer_batches
 SET file_count=file_count+1, byte_count=byte_count+NEW.byte_size
 WHERE id=NEW.batch_id;
END;

CREATE TRIGGER mobile_transfer_batch_quota_release AFTER UPDATE OF upload_status ON mobile_document_transfer_files
WHEN OLD.upload_status='uploading' AND NEW.upload_status='failed' AND NEW.batch_id IS NOT NULL
BEGIN
 UPDATE mobile_document_transfer_batches
 SET file_count=file_count-1, byte_count=byte_count-NEW.byte_size
 WHERE id=NEW.batch_id;
END;
