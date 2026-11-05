-- Keep submitted application snapshots and existing uploads; drafts use the final list.
ALTER TABLE applications ADD COLUMN final_document_policy INTEGER NOT NULL DEFAULT 1 CHECK(final_document_policy IN (0,1));
ALTER TABLE applications ADD COLUMN host_is_turkish TEXT CHECK(host_is_turkish IS NULL OR host_is_turkish IN ('yes','no'));
UPDATE applications SET final_document_policy=0 WHERE status <> 'draft';
UPDATE applications SET document_policy_version=2 WHERE status='draft' AND document_policy_version=1;

INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-dask','address_dask','initial',0,15,1),
('req-renewal-address-dask','address_dask','renewal',0,15,1),
('req-initial-dorm-tax','dormitory_tax_certificate','initial',1,16,1),
('req-renewal-dorm-tax','dormitory_tax_certificate','renewal',1,16,1),
('req-initial-dorm-signature','dormitory_signature_circular','initial',1,17,1),
('req-renewal-dorm-signature','dormitory_signature_circular','renewal',1,17,1),
('req-initial-host-population','host_population_record','initial',1,18,1),
('req-renewal-host-population','host_population_record','renewal',1,18,1);
