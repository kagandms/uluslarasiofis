const ADDRESS_EVIDENCE_CONDITIONS = Object.freeze({
    'address_evidence:rental_contract': "AND applications.address_evidence_type = 'rental_contract'",
    'address_evidence:residence_certificate': "AND applications.address_evidence_type = 'residence_certificate'",
    'address_evidence:undertaking': "AND applications.address_evidence_type = 'undertaking'"
});

function readConditionalSql(conditionalRule) {
    if (conditionalRule === null || conditionalRule === undefined) return '';
    if (conditionalRule === 'under18') return 'AND applications.is_under_18 = 1';
    const addressCondition = ADDRESS_EVIDENCE_CONDITIONS[conditionalRule];
    if (addressCondition) return addressCondition;
    throw new TypeError('Unsupported document policy condition.');
}

/**
 * Creates the document metadata repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{findPrivateFileById(fileId: string): Promise<object|null>}} Private document metadata operations.
 */
export function createDocumentRepository(database) {
    return Object.freeze({
        async listStudentRequirements(applicationId) {
            const result = await database.prepare(`
                SELECT requirements.code, requirements.is_required, requirements.display_order,
                       records.review_status, revisions.revision_number, revisions.status AS revision_status,
                       files.upload_status, files.scan_status, files.original_filename, files.media_type,
                       files.cleanup_status AS current_cleanup_status, intents.status AS upload_intent_status,
                       CASE
                         WHEN EXISTS (
                           SELECT 1 FROM document_revision_files AS cleanup_files
                           JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                           WHERE cleanup_revisions.document_record_id = records.id
                             AND cleanup_files.cleanup_status = 'pending'
                         ) THEN 'pending'
                         WHEN EXISTS (
                           SELECT 1 FROM document_revision_files AS cleanup_files
                           JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                           WHERE cleanup_revisions.document_record_id = records.id
                             AND cleanup_files.cleanup_status = 'complete'
                         ) THEN 'complete'
                         ELSE NULL
                       END AS cleanup_status
                FROM applications
                JOIN document_requirements AS requirements
                  ON requirements.application_type = applications.application_type
                 AND requirements.is_active = 1
                LEFT JOIN document_records AS records
                  ON records.application_id = applications.id
                 AND records.requirement_id = requirements.id
                LEFT JOIN document_revisions AS revisions
                  ON revisions.document_record_id = records.id AND revisions.is_current = 1
                LEFT JOIN document_revision_files AS files
                  ON files.revision_id = revisions.id AND files.page_order = 0
                LEFT JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE applications.id = ?
                ORDER BY requirements.display_order, requirements.code
            `).bind(applicationId).all();
            return result.results;
        },
        async listSubmissionRequirementStates(applicationId) {
            const result = await database.prepare(`
                SELECT requirements.code, requirements.is_required AS is_required,
                       CASE WHEN requirements.id IS NULL THEN 0 ELSE 1 END AS has_active_requirement,
                       CASE WHEN revisions.id IS NULL THEN 0 ELSE 1 END AS has_current_revision,
                       revisions.status AS revision_status,
                       files.upload_status, files.scan_status, files.cleanup_status,
                       CASE WHEN intents.status = 'completed' THEN 'completed' ELSE NULL END AS upload_intent_status
                FROM applications
                JOIN document_requirements AS requirements
                  ON requirements.application_type = applications.application_type
                 AND requirements.is_active = 1
                LEFT JOIN document_records AS records
                  ON records.application_id = applications.id
                 AND records.requirement_id = requirements.id
                LEFT JOIN document_revisions AS revisions
                  ON revisions.document_record_id = records.id AND revisions.is_current = 1
                LEFT JOIN document_revision_files AS files
                  ON files.revision_id = revisions.id AND files.page_order = 0
                LEFT JOIN upload_intents AS intents
                  ON intents.revision_file_id = files.id
                WHERE applications.id = ?
                ORDER BY requirements.code
            `).bind(applicationId).all();
            return result.results;
        },
        async findStudentRequirementId(applicationType, code) {
            return database.prepare(`
                SELECT id FROM document_requirements
                WHERE application_type = ? AND code = ? AND is_active = 1
                LIMIT 1
            `).bind(applicationType, code).first();
        },
        async createStudentUploadIntent({ applicationId, requirementId, conditionalRule, documentRecordId, revisionId, fileId, storageKey, filename, mediaType, byteSize, intentId, idempotencyKey, expiresAt, createdAt }) {
            const conditionalSql = readConditionalSql(conditionalRule);
            const results = await database.batch([
                database.prepare(`
                    INSERT INTO document_records (id, application_id, requirement_id, application_type)
                    SELECT ?, applications.id, requirements.id, applications.application_type
                    FROM applications
                    JOIN document_requirements AS requirements
                      ON requirements.application_type = applications.application_type
                    WHERE applications.id = ? AND applications.status = 'draft'
                      AND requirements.id = ? AND requirements.is_active = 1
                      ${conditionalSql}
                    ON CONFLICT(application_id, requirement_id) DO NOTHING
                `).bind(documentRecordId, applicationId, requirementId),
                database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        JOIN document_records AS records ON records.id = revisions.document_record_id
                        WHERE records.application_id = ? AND records.requirement_id = ?
                          AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
                    )
                `).bind(applicationId, requirementId),
                database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected'
                    WHERE id IN (
                        SELECT revision_file_id FROM upload_intents
                        WHERE status = 'rejected' AND revision_file_id IN (
                            SELECT files.id FROM document_revision_files AS files
                            JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                            JOIN document_records AS records ON records.id = revisions.document_record_id
                            WHERE records.application_id = ? AND records.requirement_id = ?
                              AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
                        )
                    )
                `).bind(applicationId, requirementId),
                database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE is_current = 0 AND status = 'pending_scan'
                      AND document_record_id IN (
                          SELECT id FROM document_records WHERE application_id = ? AND requirement_id = ?
                      )
                `).bind(applicationId, requirementId),
                database.prepare(`
                    INSERT INTO document_revisions (
                        id, document_record_id, revision_number, status, is_current,
                        submitted_by_type, uploaded_at
                    )
                    SELECT ?, records.id, COALESCE(MAX(previous.revision_number), 0) + 1,
                           'pending_scan', 0, 'student', ?
                    FROM document_records AS records
                    JOIN applications ON applications.id = records.application_id
                    JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                    LEFT JOIN document_revisions AS previous ON previous.document_record_id = records.id
                    WHERE records.application_id = ? AND records.requirement_id = ?
                      AND applications.status = 'draft' AND requirements.is_active = 1
                      ${conditionalSql}
                    GROUP BY records.id
                `).bind(revisionId, createdAt, applicationId, requirementId),
                database.prepare(`
                    INSERT INTO document_revision_files (
                        id, revision_id, page_order, storage_key, original_filename,
                        media_type, byte_size, upload_status, scan_status, created_at
                    )
                    SELECT ?, id, 0, ?, ?, ?, ?, 'intent', 'pending', ?
                    FROM document_revisions WHERE id = ? AND status = 'pending_scan'
                `).bind(fileId, storageKey, filename, mediaType, byteSize, createdAt, revisionId),
                database.prepare(`
                    INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, created_at)
                    SELECT ?, id, ?, ?, ? FROM document_revision_files WHERE id = ? AND upload_status = 'intent'
                `).bind(intentId, idempotencyKey, expiresAt, createdAt, fileId)
            ]);
            return results[6]?.meta?.changes === 1;
        },
        async findStudentUploadIntent(applicationId, intentId) {
            return database.prepare(`
                SELECT intents.id, intents.status AS intent_status, intents.expires_at,
                       files.id AS file_id, files.storage_key, files.original_filename,
                       files.media_type, files.byte_size, revisions.id AS revision_id,
                       revisions.revision_number, records.id AS document_record_id,
                       requirements.code
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND records.application_id = ?
                LIMIT 1
            `).bind(intentId, applicationId).first();
        },
        async expireStudentUploadIntent(applicationId, intentId) {
            const result = await database.prepare(`
                UPDATE upload_intents SET status = 'expired'
                WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                    SELECT files.id FROM document_revision_files AS files
                    JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                    JOIN document_records AS records ON records.id = revisions.document_record_id
                    WHERE records.application_id = ?
                )
            `).bind(intentId, applicationId).run();
            return result.meta.changes === 1;
        },
        async rejectStudentUpload(applicationId, intentId) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        JOIN document_records AS records ON records.id = revisions.document_record_id
                        WHERE records.application_id = ?
                    )
                `).bind(intentId, applicationId),
                database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected'
                    WHERE id IN (SELECT revision_file_id FROM upload_intents WHERE id = ? AND status = 'rejected')
                `).bind(intentId),
                database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE id IN (SELECT files.revision_id FROM document_revision_files AS files
                                 JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                                 WHERE intents.id = ? AND intents.status = 'rejected')
                      AND is_current = 0
                `).bind(intentId)
            ]);
            return results[0]?.meta?.changes === 1;
        },
        async finalizeStudentUpload({ applicationId, intentId, fileId, revisionId, documentRecordId, conditionalRule, finalizedAt }) {
            const conditionalSql = readConditionalSql(conditionalRule);
            const validPendingIntent = `EXISTS (
                SELECT 1 FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND intents.status = 'pending'
                  AND datetime(intents.expires_at) > datetime(?)
                  AND records.application_id = ? AND applications.status = 'draft'
                  AND requirements.is_active = 1
                  ${conditionalSql}
            )`;
            const results = await database.batch([
                database.prepare(`
                    UPDATE document_revisions SET is_current = 0, status = 'superseded'
                    WHERE document_record_id = ? AND is_current = 1
                      AND ${validPendingIntent}
                `).bind(documentRecordId, intentId, finalizedAt, applicationId),
                database.prepare(`
                    UPDATE document_revisions SET is_current = 1, status = 'submitted', uploaded_at = ?
                    WHERE id = ? AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
                      AND ${validPendingIntent}
                `).bind(finalizedAt, revisionId, documentRecordId, intentId, finalizedAt, applicationId),
                database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'finalized', scan_status = 'pending'
                    WHERE id = ? AND revision_id = ? AND upload_status = 'intent'
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(fileId, revisionId, revisionId),
                database.prepare(`
                    UPDATE document_records SET review_status = 'pending', updated_at = ? WHERE id = ?
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(finalizedAt, documentRecordId, revisionId),
                database.prepare(`
                    UPDATE upload_intents SET status = 'completed', completed_at = ?
                    WHERE id = ? AND status = 'pending' AND revision_file_id = ?
                      AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1)
                `).bind(finalizedAt, intentId, fileId, revisionId)
            ]);
            return results[4]?.meta?.changes === 1;
        },
        async beginStudentDocumentDelete({ applicationId, code, requestedAt }) {
            const record = await database.prepare(`
                SELECT records.id, records.review_status,
                       EXISTS (
                           SELECT 1 FROM document_revisions AS revisions
                           WHERE revisions.document_record_id = records.id AND revisions.status = 'approved'
                       ) AS has_approved_revision
                FROM document_records AS records
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ? AND requirements.code = ?
                  AND requirements.is_active = 1 AND applications.status = 'draft'
                LIMIT 1
            `).bind(applicationId, code).first();
            if (!record) return { found: false, locked: false };
            if (record.review_status === 'under_review' || record.review_status === 'approved' || record.has_approved_revision) {
                return { found: true, locked: true };
            }
            await database.batch([
                database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        WHERE revisions.document_record_id = ?
                    )
                `).bind(record.id),
                database.prepare(`
                    UPDATE document_revisions SET is_current = 0, status = 'superseded'
                    WHERE document_record_id = ? AND status <> 'approved'
                `).bind(record.id),
                database.prepare(`
                    UPDATE document_revision_files SET cleanup_status = 'pending', cleanup_requested_at = ?
                    WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_record_id = ?)
                      AND cleanup_status <> 'complete'
                `).bind(requestedAt, record.id)
            ]);
            return { found: true, locked: false };
        },
        async listStudentDocumentCleanupFiles(applicationId, code) {
            const result = await database.prepare(`
                SELECT files.id, files.storage_key
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ? AND requirements.code = ?
                  AND files.cleanup_status = 'pending'
                ORDER BY files.created_at, files.id
            `).bind(applicationId, code).all();
            return result.results;
        },
        async completeStudentDocumentCleanup(applicationId, code, fileId) {
            const result = await database.prepare(`
                UPDATE document_revision_files SET cleanup_status = 'complete'
                WHERE id = ? AND cleanup_status = 'pending'
                  AND revision_id IN (
                      SELECT revisions.id FROM document_revisions AS revisions
                      JOIN document_records AS records ON records.id = revisions.document_record_id
                      JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                      WHERE records.application_id = ? AND requirements.code = ?
                  )
            `).bind(fileId, applicationId, code).run();
            return result.meta.changes === 1;
        },
        async findPrivateFileById(fileId) {
            return database.prepare(`
                SELECT files.id, files.storage_key, files.original_filename,
                       files.media_type, files.byte_size, records.application_id
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE files.id = ?
                  AND files.upload_status = 'finalized'
                  AND files.scan_status = 'clean'
                  AND revisions.is_current = 1
                  AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
                LIMIT 1
            `).bind(fileId).first();
        },
        async findCurrentPrivateFileByApplicationAndCode(applicationId, code) {
            return database.prepare(`
                SELECT files.id, files.storage_key, files.original_filename, files.media_type, files.byte_size,
                       records.id AS document_record_id, records.application_id,
                       revisions.id AS revision_id, revisions.revision_number,
                       revisions.status AS revision_status, records.review_status,
                       files.upload_status, files.scan_status, files.cleanup_status
                FROM applications
                JOIN document_records AS records ON records.application_id = applications.id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
                JOIN document_revision_files AS files ON files.revision_id = revisions.id AND files.page_order = 0
                JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE applications.id = ? AND applications.status <> 'draft'
                  AND records.application_type = applications.application_type
                  AND requirements.application_type = applications.application_type
                  AND requirements.code = ? AND requirements.is_active = 1
                  AND revisions.is_current = 1
                  AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
                  AND files.upload_status = 'finalized' AND files.scan_status = 'clean'
                  AND files.cleanup_status = 'none' AND intents.status = 'completed'
                LIMIT 1
            `).bind(applicationId, code).first();
        }
    });
}
