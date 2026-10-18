-- Preserve the requirement snapshot for already submitted applications.
ALTER TABLE applications ADD COLUMN document_policy_version INTEGER NOT NULL DEFAULT 2 CHECK(document_policy_version IN (1,2));
UPDATE applications SET document_policy_version=1 WHERE status <> 'draft';
ALTER TABLE applications ADD COLUMN accommodation_type TEXT CHECK(accommodation_type IS NULL OR accommodation_type IN ('rental_contract','own_home','dormitory','hotel','undertaking'));
ALTER TABLE applications ADD COLUMN has_residence_card TEXT CHECK(has_residence_card IS NULL OR has_residence_card IN ('yes','no'));
ALTER TABLE applications ADD COLUMN host_is_married TEXT CHECK(host_is_married IS NULL OR host_is_married IN ('yes','no'));
ALTER TABLE applications ADD COLUMN minor_entry_type TEXT CHECK(minor_entry_type IS NULL OR minor_entry_type IN ('student_visa','other'));
ALTER TABLE applications ADD COLUMN minor_family_status TEXT CHECK(minor_family_status IS NULL OR minor_family_status IN ('both_parents','divorced','deceased','single_parent','absent'));
ALTER TABLE applications ADD COLUMN minor_parents_identified TEXT CHECK(minor_parents_identified IS NULL OR minor_parents_identified IN ('yes','no'));
ALTER TABLE applications ADD COLUMN insurance_basis TEXT CHECK(insurance_basis IS NULL OR insurance_basis IN ('system_verified','bilateral_agreement','gss_pending'));
-- Existing photo requirement rows remain available to the current two-photo policy and legacy records.
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-title-deed','address_title_deed','initial',1,16,1),
('req-renewal-address-title-deed','address_title_deed','renewal',1,16,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-numbering','address_numbering','initial',1,17,1),
('req-renewal-address-numbering','address_numbering','renewal',1,17,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-dormitory','address_dormitory','initial',1,18,1),
('req-renewal-address-dormitory','address_dormitory','renewal',1,18,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-hotel','address_hotel','initial',1,19,1),
('req-renewal-address-hotel','address_hotel','renewal',1,19,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-address-hotel-receipt','address_hotel_receipt','initial',1,20,1),
('req-renewal-address-hotel-receipt','address_hotel_receipt','renewal',1,20,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-host-spouse-undertaking','host_spouse_undertaking','initial',1,21,1),
('req-renewal-host-spouse-undertaking','host_spouse_undertaking','renewal',1,21,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-minor-consent','minor_consent','initial',1,22,1),
('req-renewal-minor-consent','minor_consent','renewal',1,22,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-minor-family-evidence','minor_family_evidence','initial',1,23,1),
('req-renewal-minor-family-evidence','minor_family_evidence','renewal',1,23,1);
INSERT INTO document_requirements (id,code,application_type,is_required,display_order,is_active) VALUES
('req-initial-parent-permit-copy','parent_permit_copy','initial',0,24,1),
('req-renewal-parent-permit-copy','parent_permit_copy','renewal',0,24,1);
