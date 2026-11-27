/**
 * Creates D1 persistence operations for YÖKSİS Excel -> portal migration status sync.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Read and atomic batch-write operations for migration sync.
 */
export function createMigrationSyncRepository(database) {
    return Object.freeze({
        /**
         * Reads the most recently finalized Excel import metadata.
         * @returns {Promise<{id: string, exported_at: string|null}|null>} Latest finalized import or null.
         */
        async readLatestFinalizedImport() {
            return database.prepare(`
                SELECT id, exported_at
                FROM yoksis_audit_imports
                WHERE finalized_at IS NOT NULL
                ORDER BY finalized_at DESC, rowid DESC
                LIMIT 1
            `).first();
        },

        /**
         * Lists Excel-sourced audit rows belonging to a finalized import.
         * @param {string} importId Finalized import ID.
         * @returns {Promise<Array<object>>} Audit rows.
         */
        async listFinalizedExcelAuditRows(importId) {
            const result = await database.prepare(`
                SELECT application_number, student_number, first_name, last_name,
                       application_status, documents_json, missing_deadline, source
                FROM yoksis_document_audit_records
                WHERE source = 'excel' AND last_seen_import_id = ?
            `).bind(importId).all();
            return result.results ?? [];
        },

        /**
         * Lists non-draft, non-deleted online and (optionally) physical portal records with their current overlay state.
         * @param {{ includePhysical?: boolean }} [options] Whether to include physical_intakes.
         * @returns {Promise<Array<object>>} Combined portal records.
         */
        async listPortalRecordsForSync({ includePhysical = true } = {}) {
            const onlineQuery = database.prepare(`
                    SELECT 'online' AS record_kind,
                           applications.id AS record_id,
                           students.student_number,
                           applications.first_name,
                           applications.last_name,
                           applications.status,
                           applications.created_at,
                           applications.updated_at,
                           NULL AS application_date,
                           NULL AS submitted_at,
                           NULL AS lock_version,
                           NULL AS linked_application_id,
                           NULL AS processing_closed_at,
                           NULL AS legacy_status,
                           NULL AS deleted_at,
                           states.state AS overlay_state,
                           states.note AS overlay_note,
                           states.deadline AS overlay_deadline,
                           states.application_number AS overlay_application_number,
                           states.import_id AS overlay_import_id
                    FROM applications
                    JOIN students ON students.id = applications.student_id
                    LEFT JOIN migration_office_states AS states
                      ON states.record_kind = 'online' AND states.record_id = applications.id
                    WHERE applications.status <> 'draft'
                      AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                `).all();
            if (!includePhysical) {
                const onlineResult = await onlineQuery;
                return onlineResult.results ?? [];
            }
            const [onlineResult, physicalResult] = await Promise.all([
                onlineQuery,
                database.prepare(`
                    SELECT 'physical' AS record_kind,
                           physical_intakes.id AS record_id,
                           physical_intakes.student_number,
                           physical_intakes.first_name,
                           physical_intakes.last_name,
                           physical_intakes.status,
                           NULL AS created_at,
                           physical_intakes.updated_at,
                           physical_intakes.application_date,
                           physical_intakes.submitted_at,
                           physical_intakes.lock_version,
                           physical_intakes.linked_application_id,
                           physical_intakes.processing_closed_at,
                           physical_intakes.legacy_status,
                           physical_intakes.deleted_at,
                           states.state AS overlay_state,
                           states.note AS overlay_note,
                           states.deadline AS overlay_deadline,
                           states.application_number AS overlay_application_number,
                           states.import_id AS overlay_import_id
                    FROM physical_intakes
                    LEFT JOIN migration_office_states AS states
                      ON states.record_kind = 'physical' AND states.record_id = physical_intakes.id
                    WHERE physical_intakes.deleted_at IS NULL
                `).all()
            ]);
            return [...(onlineResult.results ?? []), ...(physicalResult.results ?? [])];
        },

        /**
         * Atomically applies one online application sync update (status transition + overlay + audit).
         * @param {object} input Sync write parameters.
         * @returns {Promise<boolean>} True when the guarded write committed.
         */
        async applyOnlineItem({
            recordId,
            currentStatus,
            expectedUpdatedAt,
            targetState,
            applicationNumber,
            note,
            deadline,
            importId,
            staffId,
            now,
            requestId,
            auditId = crypto.randomUUID(),
            documentsAuditId = crypto.randomUUID()
        }) {
            const finalStatus = targetState === 'approved' ? 'migration_approved' : 'sent_to_migration';
            const needsStatusUpdate = currentStatus !== finalStatus;
            const statements = [];

            if (needsStatusUpdate) {
                statements.push(
                    database.prepare(`
                        UPDATE applications
                        SET status = ?, updated_at = ?, last_activity_at = ?,
                            terminal_at = NULL, retention_due_at = NULL
                        WHERE id = ? AND status = ? AND updated_at = ?
                          AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                    `).bind(finalStatus, now, now, recordId, currentStatus, expectedUpdatedAt)
                );

                if (currentStatus !== 'sent_to_migration') {
                    statements.push(
                        database.prepare(`
                            UPDATE document_revisions
                            SET status = 'approved', reviewed_at = ?, reviewed_by_staff_id = ?
                            WHERE is_current = 1
                              AND status IN ('submitted', 'resubmission_required')
                              AND EXISTS (
                                SELECT 1 FROM document_records AS records
                                WHERE records.id = document_revisions.document_record_id
                                  AND records.application_id = ?
                              )
                              AND EXISTS (
                                SELECT 1 FROM document_revision_files AS files
                                WHERE files.revision_id = document_revisions.id
                                  AND files.upload_status = 'finalized'
                                  AND files.scan_status = 'clean'
                                  AND files.cleanup_status = 'none'
                              )
                              AND EXISTS (
                                SELECT 1 FROM applications
                                WHERE id = ? AND status = ? AND updated_at = ?
                              )
                        `).bind(now, staffId, recordId, recordId, finalStatus, now),
                        database.prepare(`
                            UPDATE document_records
                            SET review_status = 'approved', updated_at = ?
                            WHERE application_id = ?
                              AND review_status IN ('pending', 'under_review', 'resubmission_required')
                              AND EXISTS (
                                SELECT 1 FROM applications
                                WHERE id = ? AND status = ? AND updated_at = ?
                              )
                              AND EXISTS (
                                SELECT 1 FROM document_revisions AS revisions
                                WHERE revisions.document_record_id = document_records.id
                                  AND revisions.is_current = 1
                                  AND revisions.status = 'approved'
                              )
                        `).bind(now, recordId, recordId, finalStatus, now),
                        database.prepare(`
                            INSERT INTO audit_events (
                                id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json, created_at
                            ) SELECT ?, 'staff.application_documents_approved_on_migration', 'staff', ?, ?, ?, ?, ?
                            WHERE changes() > 0
                        `).bind(
                            documentsAuditId,
                            staffId,
                            recordId,
                            requestId,
                            JSON.stringify({ applicationStatus: finalStatus, result: 'success' }),
                            now
                        )
                    );
                }

                statements.push(
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'online', id, ?, ?, ?, ?, ?, ?, ?
                        FROM applications
                        WHERE id = ? AND status = ? AND updated_at = ?
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, importId, staffId, now,
                        recordId, finalStatus, now
                    )
                );
            } else {
                statements.push(
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'online', id, ?, ?, ?, ?, ?, ?, ?
                        FROM applications
                        WHERE id = ? AND status = 'sent_to_migration' AND updated_at = ?
                          AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, importId, staffId, now,
                        recordId, expectedUpdatedAt
                    )
                );
            }

            statements.push(
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.yoksis_sync_applied', 'staff', ?, ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(
                    auditId,
                    staffId,
                    recordId,
                    requestId,
                    JSON.stringify({ recordKind: 'online', targetState, result: 'success' }),
                    now
                )
            );

            const results = await database.batch(statements);
            const overlayIndex = statements.length - 2;
            const auditIndex = statements.length - 1;
            const statusOk = !needsStatusUpdate || results[0]?.meta?.changes === 1;
            return statusOk
                && results[overlayIndex]?.meta?.changes === 1
                && results[auditIndex]?.meta?.changes === 1;
        },

        /**
         * Atomically applies one physical intake sync update (status transition + overlay + audit).
         * @param {object} input Sync write parameters.
         * @returns {Promise<boolean>} True when the guarded write committed.
         */
        async applyPhysicalItem({
            recordId,
            currentStatus,
            expectedLockVersion,
            targetState,
            applicationNumber,
            note,
            deadline,
            importId,
            staffId,
            now,
            requestId,
            auditId = crypto.randomUUID()
        }) {
            const finalStatus = targetState === 'approved' ? 'migration_approved' : 'sent_to_migration';
            const needsStatusUpdate = currentStatus !== finalStatus;
            const statements = [];

            if (needsStatusUpdate) {
                const nextLockVersion = expectedLockVersion + 1;
                statements.push(
                    database.prepare(`
                        UPDATE physical_intakes
                        SET status = ?, rejection_reason = '', legacy_status = NULL,
                            lock_version = lock_version + 1, updated_at = ?
                        WHERE id = ? AND status = ? AND lock_version = ?
                          AND processing_closed_at IS NULL
                          AND coalesce(legacy_status, '') <> 'completed'
                          AND deleted_at IS NULL
                    `).bind(finalStatus, now, recordId, currentStatus, expectedLockVersion),
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'physical', id, ?, ?, ?, ?, ?, ?, ?
                        FROM physical_intakes
                        WHERE id = ? AND status = ? AND lock_version = ?
                          AND processing_closed_at IS NULL
                          AND coalesce(legacy_status, '') <> 'completed'
                          AND deleted_at IS NULL
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, importId, staffId, now,
                        recordId, finalStatus, nextLockVersion
                    )
                );
            } else {
                statements.push(
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'physical', id, ?, ?, ?, ?, ?, ?, ?
                        FROM physical_intakes
                        WHERE id = ? AND status = 'sent_to_migration' AND lock_version = ?
                          AND processing_closed_at IS NULL
                          AND coalesce(legacy_status, '') <> 'completed'
                          AND deleted_at IS NULL
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, importId, staffId, now,
                        recordId, expectedLockVersion
                    )
                );
            }

            statements.push(
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json, created_at
                    )
                    SELECT ?, 'staff.yoksis_sync_applied', 'staff', ?, NULL, ?, ?, ?
                    WHERE changes() = 1
                `).bind(
                    auditId,
                    staffId,
                    requestId,
                    JSON.stringify({ recordKind: 'physical', targetState, result: 'success' }),
                    now
                )
            );

            const results = await database.batch(statements);
            const overlayIndex = statements.length - 2;
            const auditIndex = statements.length - 1;
            const statusOk = !needsStatusUpdate || results[0]?.meta?.changes === 1;
            return statusOk
                && results[overlayIndex]?.meta?.changes === 1
                && results[auditIndex]?.meta?.changes === 1;
        }
    });
}
