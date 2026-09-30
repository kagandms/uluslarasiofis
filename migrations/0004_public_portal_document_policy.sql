ALTER TABLE applications ADD COLUMN address_evidence_type TEXT
    CHECK (address_evidence_type IS NULL OR address_evidence_type IN (
        'rental_contract', 'residence_certificate', 'undertaking'
    ));

UPDATE document_requirements
SET is_required = 0, is_active = 0
WHERE code IN ('passport_identity', 'address_document', 'fingerprint');

INSERT INTO document_requirements (id, code, application_type, is_required, display_order, is_active)
VALUES
    ('req-initial-passport', 'passport', 'initial', 1, 2, 1),
    ('req-renewal-passport', 'passport', 'renewal', 1, 2, 1),
    ('req-initial-residence-card', 'residence_card', 'initial', 1, 3, 1),
    ('req-renewal-residence-card', 'residence_card', 'renewal', 1, 3, 1),
    ('req-initial-address-rental-contract', 'address_rental_contract', 'initial', 1, 8, 1),
    ('req-renewal-address-rental-contract', 'address_rental_contract', 'renewal', 1, 8, 1),
    ('req-initial-address-residence-certificate', 'address_residence_certificate', 'initial', 1, 9, 1),
    ('req-renewal-address-residence-certificate', 'address_residence_certificate', 'renewal', 1, 9, 1),
    ('req-initial-address-undertaking', 'address_undertaking', 'initial', 1, 10, 1),
    ('req-renewal-address-undertaking', 'address_undertaking', 'renewal', 1, 10, 1),
    ('req-initial-host-residence-certificate', 'host_residence_certificate', 'initial', 1, 11, 1),
    ('req-renewal-host-residence-certificate', 'host_residence_certificate', 'renewal', 1, 11, 1),
    ('req-initial-host-identity-copy', 'host_identity_copy', 'initial', 1, 12, 1),
    ('req-renewal-host-identity-copy', 'host_identity_copy', 'renewal', 1, 12, 1)
ON CONFLICT (code, application_type) DO UPDATE SET
    is_required = excluded.is_required,
    display_order = excluded.display_order,
    is_active = excluded.is_active;

INSERT INTO document_requirements (id, code, application_type, is_required, display_order, is_active)
VALUES ('req-initial-uets-compatibility', 'uets', 'initial', 0, 5, 0)
ON CONFLICT (code, application_type) DO UPDATE SET
    is_required = 0,
    is_active = 0;
