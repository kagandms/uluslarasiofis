ALTER TABLE applications
    ADD COLUMN application_route TEXT NOT NULL DEFAULT 'standard'
    CHECK (application_route IN ('standard', 'transition'));

ALTER TABLE applications ADD COLUMN transition_foreign_id TEXT;
ALTER TABLE applications ADD COLUMN transition_card_serial TEXT;
ALTER TABLE applications ADD COLUMN transition_card_number TEXT;
ALTER TABLE applications ADD COLUMN transition_contact_preference TEXT
    CHECK (transition_contact_preference IN ('email', 'phone') OR transition_contact_preference IS NULL);
ALTER TABLE applications ADD COLUMN transition_change_province TEXT
    CHECK (transition_change_province IN ('yes', 'no') OR transition_change_province IS NULL);

ALTER TABLE physical_intakes
    ADD COLUMN application_route TEXT NOT NULL DEFAULT 'standard'
    CHECK (application_route IN ('standard', 'transition'));

DROP TRIGGER physical_passport_insert;
DROP TRIGGER physical_passport_update;
DROP TRIGGER physical_closed_metadata;

CREATE TRIGGER physical_passport_insert BEFORE INSERT ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status NOT IN ('rejected','completed') AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE deleted_at IS NULL AND status NOT IN ('rejected','completed')
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type
 AND application_route=NEW.application_route)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;

CREATE TRIGGER physical_passport_update BEFORE UPDATE ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status NOT IN ('rejected','completed') AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND (upper(trim(OLD.passport_number))<>upper(trim(NEW.passport_number)) OR OLD.application_type<>NEW.application_type
 OR OLD.application_route<>NEW.application_route OR OLD.deleted_at IS NOT NULL OR OLD.status IN ('rejected','completed')
 OR OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed')
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE id<>NEW.id AND deleted_at IS NULL AND status NOT IN ('rejected','completed')
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type
 AND application_route=NEW.application_route)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;

CREATE TRIGGER physical_closed_metadata BEFORE UPDATE ON physical_intakes
 WHEN (OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed' OR OLD.status='completed') AND
 (OLD.first_name<>NEW.first_name OR OLD.last_name<>NEW.last_name OR OLD.passport_number<>NEW.passport_number
 OR OLD.student_number<>NEW.student_number OR OLD.application_type<>NEW.application_type
 OR OLD.application_route<>NEW.application_route OR OLD.application_date IS NOT NEW.application_date
 OR OLD.current_pdf_id IS NOT NEW.current_pdf_id)
 BEGIN SELECT RAISE(ABORT,'physical_processing_closed'); END;
