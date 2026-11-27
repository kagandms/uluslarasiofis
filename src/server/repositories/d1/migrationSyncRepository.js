const D1_IN_CHUNK_SIZE = 90;

function chunkValues(values, size = D1_IN_CHUNK_SIZE) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function normalizeStudentNumbers(studentNumbers) {
    return [...new Set(
        (studentNumbers || [])
            .map((value) => String(value || '').trim().toUpperCase())
            .filter(Boolean)
    )];
}

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
         * Resolves distinct normalized student numbers for a list of requested sync items.
         * @param {Array<{record_kind: string, record_id: string}>} items Requested sync items.
         * @returns {Promise<Array<string>>} Distinct normalized student numbers.
         */
        async listStudentNumbersForItems(items) {
            const onlineIds = [...new Set(
                (items || []).filter((item) => item?.record_kind === 'online').map((item) => item.record_id).filter(Boolean)
            )];
            const physicalIds = [...new Set(
                (items || []).filter((item) => item?.record_kind === 'physical').map((item) => item.record_id).filter(Boolean)
            )];
            const queries = [];
            for (const chunk of chunkValues(onlineIds)) {
                const placeholders = chunk.map(() => '?').join(',');
                queries.push(
                    database.prepare(`
                        SELECT DISTINCT upper(trim(students.student_number)) AS student_number
                        FROM applications
                        JOIN students ON students.id = applications.student_id
                        WHERE applications.id IN (${placeholders})
                          AND applications.status <> 'draft'
                          AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                    `).bind(...chunk).all()
                );
            }
            for (const chunk of chunkValues(physicalIds)) {
                const placeholders = chunk.map(() => '?').join(',');
                queries.push(
                    database.prepare(`
                        SELECT DISTINCT upper(trim(student_number)) AS student_number
                        FROM physical_intakes
                        WHERE id IN (${placeholders})
                          AND deleted_at IS NULL
                    `).bind(...chunk).all()
                );
            }
            if (queries.length === 0) return [];
            const results = await Promise.all(queries);
            return normalizeStudentNumbers(
                results.flatMap((result) => (result.results ?? []).map((row) => row.student_number))
            );
        },

        /**
         * Lists Excel-sourced audit rows belonging to a finalized import, optionally scoped to specific student numbers.
         * @param {string} importId Finalized import ID.
         * @param {{ studentNumbers?: Array<string> }} [options] Optional student-number filter.
         * @returns {Promise<Array<object>>} Audit rows.
         */
        async listFinalizedExcelAuditRows(importId, { studentNumbers } = {}) {
            if (Array.isArray(studentNumbers)) {
                const normalized = normalizeStudentNumbers(studentNumbers);
                if (normalized.length === 0) return [];
                const results = await Promise.all(
                    chunkValues(normalized).map((chunk) => {
                        const placeholders = chunk.map(() => '?').join(',');
                        return database.prepare(`
                            SELECT application_number, student_number, first_name, last_name,
                                   application_status, documents_json, missing_deadline, source,
                                   record_date, goc_last_query_at
                            FROM yoksis_document_audit_records
                            WHERE source = 'excel' AND last_seen_import_id = ?
                              AND upper(trim(student_number)) IN (${placeholders})
                        `).bind(importId, ...chunk).all();
                    })
                );
                return results.flatMap((result) => result.results ?? []);
            }
            const result = await database.prepare(`
                SELECT application_number, student_number, first_name, last_name,
                       application_status, documents_json, missing_deadline, source,
                       record_date, goc_last_query_at
                FROM yoksis_document_audit_records
                WHERE source = 'excel' AND last_seen_import_id = ?
            `).bind(importId).all();
            return result.results ?? [];
        },

        /**
         * Lists non-draft, non-deleted online and (optionally) physical portal records with their current overlay state.
         * @param {{ includePhysical?: boolean, studentNumbers?: Array<string> }} [options] Query options.
         * @returns {Promise<Array<object>>} Combined portal records.
         */
        async listPortalRecordsForSync({ includePhysical = true, studentNumbers } = {}) {
            const buildOnlineSql = (studentFilterClause = '') => `
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
                       states.goc_last_query_at AS overlay_goc_last_query_at,
                       states.application_number AS overlay_application_number,
                       states.import_id AS overlay_import_id
                FROM applications
                JOIN students ON students.id = applications.student_id
                LEFT JOIN migration_office_states AS states
                  ON states.record_kind = 'online' AND states.record_id = applications.id
                WHERE applications.status <> 'draft'
                  AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                  ${studentFilterClause}
            `;
            const buildPhysicalSql = (studentFilterClause = '') => `
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
                       states.goc_last_query_at AS overlay_goc_last_query_at,
                       states.application_number AS overlay_application_number,
                       states.import_id AS overlay_import_id
                FROM physical_intakes
                LEFT JOIN migration_office_states AS states
                  ON states.record_kind = 'physical' AND states.record_id = physical_intakes.id
                WHERE physical_intakes.deleted_at IS NULL
                  ${studentFilterClause}
            `;

            if (Array.isArray(studentNumbers)) {
                const normalized = normalizeStudentNumbers(studentNumbers);
                if (normalized.length === 0) return [];
                const queries = [];
                for (const chunk of chunkValues(normalized)) {
                    const placeholders = chunk.map(() => '?').join(',');
                    queries.push(
                        database.prepare(buildOnlineSql(`AND upper(trim(students.student_number)) IN (${placeholders})`))
                            .bind(...chunk)
                            .all()
                    );
                    if (includePhysical) {
                        queries.push(
                            database.prepare(buildPhysicalSql(`AND upper(trim(physical_intakes.student_number)) IN (${placeholders})`))
                                .bind(...chunk)
                                .all()
                        );
                    }
                }
                const results = await Promise.all(queries);
                return results.flatMap((result) => result.results ?? []);
            }

            const onlineQuery = database.prepare(buildOnlineSql()).all();
            if (!includePhysical) {
                const onlineResult = await onlineQuery;
                return onlineResult.results ?? [];
            }
            const [onlineResult, physicalResult] = await Promise.all([
                onlineQuery,
                database.prepare(buildPhysicalSql()).all()
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
            gocLastQueryAt = null,
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
                            goc_last_query_at, import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'online', id, ?, ?, ?, ?, ?, ?, ?, ?
                        FROM applications
                        WHERE id = ? AND status = ? AND updated_at = ?
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            goc_last_query_at = excluded.goc_last_query_at,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, gocLastQueryAt, importId, staffId, now,
                        recordId, finalStatus, now
                    )
                );
            } else {
                statements.push(
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            goc_last_query_at, import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'online', id, ?, ?, ?, ?, ?, ?, ?, ?
                        FROM applications
                        WHERE id = ? AND status = 'sent_to_migration' AND updated_at = ?
                          AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
                        ON CONFLICT(record_kind, record_id) DO UPDATE SET
                            application_number = excluded.application_number,
                            state = excluded.state,
                            note = excluded.note,
                            deadline = excluded.deadline,
                            goc_last_query_at = excluded.goc_last_query_at,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, gocLastQueryAt, importId, staffId, now,
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
            gocLastQueryAt = null,
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
                            goc_last_query_at, import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'physical', id, ?, ?, ?, ?, ?, ?, ?, ?
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
                            goc_last_query_at = excluded.goc_last_query_at,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, gocLastQueryAt, importId, staffId, now,
                        recordId, finalStatus, nextLockVersion
                    )
                );
            } else {
                statements.push(
                    database.prepare(`
                        INSERT INTO migration_office_states (
                            record_kind, record_id, application_number, state, note, deadline,
                            goc_last_query_at, import_id, updated_by_staff_id, updated_at
                        )
                        SELECT 'physical', id, ?, ?, ?, ?, ?, ?, ?, ?
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
                            goc_last_query_at = excluded.goc_last_query_at,
                            import_id = excluded.import_id,
                            updated_by_staff_id = excluded.updated_by_staff_id,
                            updated_at = excluded.updated_at
                    `).bind(
                        applicationNumber, targetState, note, deadline, gocLastQueryAt, importId, staffId, now,
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
