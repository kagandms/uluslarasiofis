CREATE TABLE mobile_document_transfers (
 id TEXT PRIMARY KEY,
 staff_token_hash TEXT NOT NULL,
 claim_token_hash TEXT NOT NULL UNIQUE,
 phone_token_hash TEXT UNIQUE,
 expires_at INTEGER NOT NULL,
 file_count INTEGER NOT NULL DEFAULT 0 CHECK(file_count BETWEEN 0 AND 30),
 byte_count INTEGER NOT NULL DEFAULT 0 CHECK(byte_count BETWEEN 0 AND 125829120)
);
CREATE INDEX mobile_document_transfers_expiry ON mobile_document_transfers(expires_at);
CREATE TABLE mobile_document_transfer_files (
 id TEXT PRIMARY KEY,
 transfer_id TEXT NOT NULL REFERENCES mobile_document_transfers(id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE,
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER mobile_transfer_file_quota AFTER INSERT ON mobile_document_transfer_files
BEGIN
 UPDATE mobile_document_transfers SET file_count=file_count+1, byte_count=byte_count+NEW.byte_size WHERE id=NEW.transfer_id;
END;
