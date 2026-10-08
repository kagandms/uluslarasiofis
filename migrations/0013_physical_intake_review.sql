ALTER TABLE physical_intakes ADD COLUMN rejection_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE physical_intakes ADD COLUMN legacy_status TEXT;
DROP INDEX physical_intakes_one_active;
UPDATE physical_intakes SET legacy_status=status WHERE status NOT IN ('under_review','approved_for_processing','rejected');
UPDATE physical_intakes SET status=CASE
    WHEN status IN ('approved_for_processing','sent_to_migration','migration_approved','completed') THEN 'approved_for_processing'
    WHEN status IN ('rejected','cancelled') THEN 'rejected'
    ELSE 'under_review' END;
UPDATE physical_intakes SET rejection_reason='Önceki kayıtta ret gerekçesi belirtilmemiş.' WHERE status='rejected';
CREATE UNIQUE INDEX physical_intakes_one_active ON physical_intakes(student_number)
    WHERE student_number<>'' AND deleted_at IS NULL AND status<>'rejected'
      AND coalesce(legacy_status,'')<>'completed';
CREATE TRIGGER physical_intakes_review_insert BEFORE INSERT ON physical_intakes
    WHEN NEW.status NOT IN ('under_review','approved_for_processing','rejected')
      OR (NEW.status='rejected' AND length(trim(NEW.rejection_reason))<5)
    BEGIN SELECT RAISE(ABORT,'physical_review_state_invalid'); END;
CREATE TRIGGER physical_intakes_review_update BEFORE UPDATE OF status,rejection_reason ON physical_intakes
    WHEN NEW.status NOT IN ('under_review','approved_for_processing','rejected')
      OR (NEW.status='rejected' AND length(trim(NEW.rejection_reason))<5)
    BEGIN SELECT RAISE(ABORT,'physical_review_state_invalid'); END;
