-- Extend staff-entered physical stages without rewriting existing records or PDFs.
DROP TRIGGER physical_intakes_review_insert;
DROP TRIGGER physical_intakes_review_update;
DROP TRIGGER physical_passport_insert;
DROP TRIGGER physical_passport_update;
DROP TRIGGER physical_closed_metadata;
DROP INDEX physical_intakes_one_active;
CREATE UNIQUE INDEX physical_intakes_one_active ON physical_intakes(student_number)
 WHERE student_number<>'' AND deleted_at IS NULL AND status NOT IN ('rejected','completed')
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed';
CREATE TRIGGER physical_passport_insert BEFORE INSERT ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status NOT IN ('rejected','completed') AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE deleted_at IS NULL AND status NOT IN ('rejected','completed')
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;
CREATE TRIGGER physical_passport_update BEFORE UPDATE ON physical_intakes
 WHEN NEW.deleted_at IS NULL AND NEW.status NOT IN ('rejected','completed') AND NEW.processing_closed_at IS NULL
 AND coalesce(NEW.legacy_status,'')<>'completed' AND trim(NEW.passport_number)<>''
 AND (upper(trim(OLD.passport_number))<>upper(trim(NEW.passport_number)) OR OLD.application_type<>NEW.application_type
 OR OLD.deleted_at IS NOT NULL OR OLD.status IN ('rejected','completed') OR OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed')
 AND EXISTS(SELECT 1 FROM physical_intakes WHERE id<>NEW.id AND deleted_at IS NULL AND status NOT IN ('rejected','completed')
 AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
 AND upper(trim(passport_number))=upper(trim(NEW.passport_number)) AND application_type=NEW.application_type)
 BEGIN SELECT RAISE(ABORT,'physical_active_passport_conflict'); END;
CREATE TRIGGER physical_closed_metadata BEFORE UPDATE ON physical_intakes
 WHEN (OLD.processing_closed_at IS NOT NULL OR OLD.legacy_status='completed' OR OLD.status='completed') AND
 (OLD.first_name<>NEW.first_name OR OLD.last_name<>NEW.last_name OR OLD.passport_number<>NEW.passport_number
 OR OLD.student_number<>NEW.student_number OR OLD.application_type<>NEW.application_type
 OR OLD.application_date IS NOT NEW.application_date OR OLD.current_pdf_id IS NOT NEW.current_pdf_id)
 BEGIN SELECT RAISE(ABORT,'physical_processing_closed'); END;
CREATE TRIGGER physical_intakes_review_insert BEFORE INSERT ON physical_intakes
 WHEN NEW.status NOT IN ('under_review','approved_for_processing','sent_to_migration','migration_approved','completed','rejected')
 OR (NEW.status='rejected' AND length(trim(NEW.rejection_reason))<5)
 BEGIN SELECT RAISE(ABORT,'physical_review_state_invalid'); END;
CREATE TRIGGER physical_intakes_review_update BEFORE UPDATE OF status,rejection_reason ON physical_intakes
 WHEN NEW.status NOT IN ('under_review','approved_for_processing','sent_to_migration','migration_approved','completed','rejected')
 OR (NEW.status='rejected' AND length(trim(NEW.rejection_reason))<5)
 BEGIN SELECT RAISE(ABORT,'physical_review_state_invalid'); END;
CREATE TRIGGER physical_migration_pdf_guard BEFORE UPDATE OF status ON physical_intakes
 WHEN NEW.status IN ('sent_to_migration','migration_approved','completed')
 AND NOT EXISTS(SELECT 1 FROM physical_intake_files WHERE id=NEW.current_pdf_id AND intake_id=NEW.id AND upload_status='finalized')
 BEGIN SELECT RAISE(ABORT,'physical_migration_pdf_required'); END;
