ALTER TABLE applications ADD COLUMN fingerprint_status TEXT
    CHECK (fingerprint_status IS NULL OR fingerprint_status IN ('registered', 'not_registered'));
ALTER TABLE applications ADD COLUMN fingerprint_code TEXT
    CHECK (fingerprint_code IS NULL OR length(trim(fingerprint_code)) <= 128);

INSERT INTO document_requirements (id, code, application_type, is_required, display_order)
SELECT 'req-initial-birth-certificate-under18', 'birth_certificate_under18', 'initial', 1, 11
WHERE NOT EXISTS (
    SELECT 1 FROM document_requirements
    WHERE code IN ('birth_certificate_under18', 'birth_certificate') AND application_type = 'initial'
);

INSERT INTO document_requirements (id, code, application_type, is_required, display_order)
SELECT 'req-renewal-birth-certificate-under18', 'birth_certificate_under18', 'renewal', 1, 11
WHERE NOT EXISTS (
    SELECT 1 FROM document_requirements
    WHERE code IN ('birth_certificate_under18', 'birth_certificate') AND application_type = 'renewal'
);
