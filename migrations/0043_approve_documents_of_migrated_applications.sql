-- Göç İdaresine gönderilmiş, Göç İdaresi tarafından onaylanmış veya tamamlanmış başvuruların
-- güncel, temiz ve kesinleşmiş durumdaki onaylanmamış belgelerini tek seferlik idempotent olarak onaylar.
-- Başvuru durumu ve updated_at alanı değiştirilmez.

-- Güncelleme görünür olmadan önce yalnızca en az bir uygun güncel revizyonu bulunan başvurular için denetim kaydı oluştur.
INSERT INTO audit_events (
    id,
    event_type,
    actor_type,
    application_id,
    request_id,
    safe_metadata_json
)
SELECT
    lower(hex(randomblob(16))),
    'system.documents_approved_for_migrated_application',
    'system',
    applications.id,
    'migration-0043',
    json_object('applicationStatus', applications.status, 'result', 'success')
FROM applications
WHERE applications.status IN ('sent_to_migration', 'migration_approved', 'completed')
  AND EXISTS (
      SELECT 1
      FROM document_records AS records
      JOIN document_revisions AS revisions
        ON revisions.document_record_id = records.id
      JOIN document_revision_files AS files
        ON files.revision_id = revisions.id
      WHERE records.application_id = applications.id
        AND revisions.is_current = 1
        AND revisions.status IN ('submitted', 'resubmission_required')
        AND files.upload_status = 'finalized'
        AND files.scan_status = 'clean'
        AND files.cleanup_status = 'none'
  );

-- Uygun güncel belge revizyonlarını sistem tarafından onaylanmış olarak işaretle.
UPDATE document_revisions
SET status = 'approved',
    reviewed_at = CURRENT_TIMESTAMP,
    reviewed_by_staff_id = NULL
WHERE is_current = 1
  AND status IN ('submitted', 'resubmission_required')
  AND EXISTS (
      SELECT 1
      FROM document_records AS records
      JOIN applications
        ON applications.id = records.application_id
      WHERE records.id = document_revisions.document_record_id
        AND applications.status IN ('sent_to_migration', 'migration_approved', 'completed')
  )
  AND EXISTS (
      SELECT 1
      FROM document_revision_files AS files
      WHERE files.revision_id = document_revisions.id
        AND files.upload_status = 'finalized'
        AND files.scan_status = 'clean'
        AND files.cleanup_status = 'none'
  );

-- Güncel revizyonu onaylı olan ve inceleme durumu henüz onaylanmamış belge kayıtlarını güncelle.
UPDATE document_records
SET review_status = 'approved',
    updated_at = CURRENT_TIMESTAMP
WHERE review_status IN ('pending', 'under_review', 'resubmission_required')
  AND EXISTS (
      SELECT 1
      FROM applications
      WHERE applications.id = document_records.application_id
        AND applications.status IN ('sent_to_migration', 'migration_approved', 'completed')
  )
  AND EXISTS (
      SELECT 1
      FROM document_revisions AS revisions
      WHERE revisions.document_record_id = document_records.id
        AND revisions.is_current = 1
        AND revisions.status = 'approved'
  );
