import { ApplicationConflictError, ApplicationTypeChangeBlockedError } from '../../domain/errors.js';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../../../config/constants.js';
import { normalizeStudentNumber } from './studentRepository.js';
import { mapDocumentRequirementCodeForTypeSwitch } from '../../domain/documentPolicy.js';
import { createAccessCodeRotationStatements } from './application-access-statements.js';
import { generateApplicationReference } from '../../auth/applicationAccessCode.js';

const PUBLIC_APPLICATION_FIELDS = Object.freeze({
    applicationType: 'application_type',
    addressEvidenceType: 'address_evidence_type',
    studentEmail: 'student_email',
    studentPhone: 'student_phone',
    firstName: 'first_name',
    lastName: 'last_name',
    passportNumber: 'passport_number',
    nationality: 'nationality',
    dateOfBirth: 'date_of_birth',
    isUnder18: 'is_under_18',
    fingerprintStatus: 'fingerprint_status',
    fingerprintCode: 'fingerprint_code',
    declarationVersion: 'declaration_version',
    declarationAcceptedAt: 'declaration_accepted_at'
});

function isActiveApplicationConflict(error) {
    return /unique constraint failed: applications\.student_id/i.test(String(error?.message));
}

function isReferenceConflict(error) {
    return /unique constraint failed: (applications\.)?reference_number/i.test(String(error?.message));
}

/**
 * Creates the application repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Repository operations for application records.
 */
export function createApplicationRepository(database) {
    return Object.freeze({
        async createDraft({ applicationId, studentId, studentNumber, applicationType, studentEmail, studentPhone }) {
            const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
            const statements = [
                database.prepare(`
                    INSERT INTO students (id, student_number, normalized_student_number)
                    VALUES (?, ?, ?)
                    ON CONFLICT(normalized_student_number) DO NOTHING
                `).bind(studentId, studentNumber.trim(), normalizedStudentNumber),
                database.prepare(`
                    INSERT INTO applications (
                        id, student_id, application_type, student_email, student_phone, retention_due_at
                    )
                    SELECT ?, id, ?, ?, ?, datetime('now', '+30 days')
                    FROM students WHERE normalized_student_number = ?
                `).bind(applicationId, applicationType, studentEmail, studentPhone, normalizedStudentNumber)
            ];

            try {
                const results = await database.batch(statements);
                if (results[1]?.meta?.changes !== 1) throw new Error('Application insert did not create a row.');
            } catch (error) {
                if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
                throw error;
            }

            return this.findById(applicationId);
        },
        async createDraftWithSession({
            applicationId, studentId, studentNumber, applicationType, studentEmail, studentPhone,
            sessionId, tokenHash, expiresAt, createdAt, auditEventId, requestId,
            referenceNumber = null, accessCodeHash = null
        }) {
            const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
            const maxRetries = referenceNumber ? 1 : 5;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const finalReference = referenceNumber || generateApplicationReference();
                const statements = [
                    database.prepare(`
                        INSERT INTO students (id, student_number, normalized_student_number)
                        VALUES (?, ?, ?)
                        ON CONFLICT(normalized_student_number) DO NOTHING
                    `).bind(studentId, studentNumber.trim(), normalizedStudentNumber),
                    database.prepare(`
                        INSERT INTO applications (
                            id, student_id, reference_number, access_code_hash, access_code_created_at,
                            access_code_version, lock_version, application_type, student_email, student_phone, retention_due_at
                        )
                        SELECT ?, id, ?, ?, ?, 1, 1, ?, ?, ?, datetime(?, '+30 days')
                        FROM students WHERE normalized_student_number = ?
                    `).bind(applicationId, finalReference, accessCodeHash, createdAt, applicationType, studentEmail, studentPhone, createdAt, normalizedStudentNumber),
                    database.prepare(`
                        INSERT INTO application_sessions (id, application_id, token_hash, expires_at, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `).bind(sessionId, applicationId, tokenHash, expiresAt, createdAt),
                    database.prepare(`
                        INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json)
                        SELECT ?, 'application.draft_created', 'student', ?, ?, '{}'
                        WHERE EXISTS (SELECT 1 FROM applications WHERE id = ?)
                    `).bind(auditEventId, applicationId, requestId, applicationId)
                ];

                try {
                    const results = await database.batch(statements);
                    if (results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1 || results[3]?.meta?.changes !== 1) {
                        throw new Error('Application, session, and audit transaction did not complete.');
                    }
                    return this.findById(applicationId);
                } catch (error) {
                    if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
                    if (isReferenceConflict(error) && !referenceNumber && attempt < maxRetries - 1) {
                        continue;
                    }
                    throw error;
                }
            }
        },
        async findByReferenceNumber(referenceNumber) {
            if (!referenceNumber) return null;
            const normalizedRef = referenceNumber.trim().toUpperCase();
            return database.prepare(`
                SELECT applications.*, students.student_number,
                    EXISTS (
                        SELECT 1 FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                    ) AS contact_acknowledgement_accepted_current,
                    (
                        SELECT audit_events.created_at FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                        ORDER BY audit_events.created_at DESC LIMIT 1
                    ) AS contact_acknowledgement_accepted_at
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE UPPER(applications.reference_number) = ?
            `).bind(CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
                CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, normalizedRef).first();
        },
        async updateAccessCode(input) {
            const results = await database.batch(createAccessCodeRotationStatements(database, input));
            if (results[0]?.meta?.changes !== 1) return null;
            return this.findById(input.applicationId);
        },
        async findById(applicationId) {
            return database.prepare(`
                SELECT applications.*, students.student_number,
                    EXISTS (
                        SELECT 1 FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                    ) AS contact_acknowledgement_accepted_current,
                    (
                        SELECT audit_events.created_at FROM audit_events
                        WHERE audit_events.application_id = applications.id
                          AND audit_events.event_type = 'application.contact_responsibility_accepted'
                          AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
                        ORDER BY audit_events.created_at DESC LIMIT 1
                    ) AS contact_acknowledgement_accepted_at
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE applications.id = ?
            `).bind(CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
                CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, applicationId).first();
        },
        async findTrackableByStudentNumber(studentNumber) {
            const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
            const selected = await database.prepare(`
                SELECT applications.id
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE students.normalized_student_number = ?
                  AND applications.status <> 'draft'
                ORDER BY
                    CASE WHEN applications.status IN ('completed', 'cancelled', 'rejected') THEN 1 ELSE 0 END,
                    applications.updated_at DESC,
                    applications.created_at DESC,
                    applications.id DESC
                LIMIT 1
            `).bind(normalizedStudentNumber).first();
            if (!selected) return null;
            return this.findById(selected.id);
        },
        async queryStaffApplications({ statuses, searchPattern, pageSize, offset }) {
            const conditions = ["applications.status <> 'draft'"];
            const queryValues = [];
            if (statuses) {
                conditions.push(`applications.status IN (${statuses.map(() => '?').join(', ')})`);
                queryValues.push(...statuses);
            }
            if (searchPattern) {
                conditions.push(`(
                    students.student_number LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.first_name, '') LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.last_name, '') LIKE ? ESCAPE '\\'
                    OR (COALESCE(applications.first_name, '') || ' ' || COALESCE(applications.last_name, '')) LIKE ? ESCAPE '\\'
                    OR (COALESCE(applications.last_name, '') || ' ' || COALESCE(applications.first_name, '')) LIKE ? ESCAPE '\\'
                    OR COALESCE(applications.passport_number, '') LIKE ? ESCAPE '\\'
                )`);
                queryValues.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
            }
            const whereClause = conditions.join(' AND ');
            const [countResult, pageResult] = await Promise.all([
                database.prepare(`
                    SELECT COUNT(*) AS total_items
                    FROM applications
                    JOIN students ON students.id = applications.student_id
                    WHERE ${whereClause}
                `).bind(...queryValues).first(),
                database.prepare(`
                    SELECT applications.id, students.student_number, applications.first_name,
                           applications.last_name, applications.application_type, applications.status,
                           applications.submitted_at, applications.updated_at
                    FROM applications
                    JOIN students ON students.id = applications.student_id
                    WHERE ${whereClause}
                    ORDER BY applications.updated_at DESC, applications.created_at DESC, applications.id DESC
                    LIMIT ? OFFSET ?
                `).bind(...queryValues, pageSize, offset).all()
            ]);
            return { totalItems: countResult.total_items, items: pageResult.results };
        },
        async acceptContactResponsibilityAcknowledgement({ applicationId, version, acceptedAt, requestId }) {
            const eventId = `${applicationId}:contact-responsibility:${version}`;
            await database.prepare(`
                INSERT OR IGNORE INTO audit_events (
                    id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                )
                SELECT ?, 'application.contact_responsibility_accepted', 'student', ?, ?, json_object('version', ?), ?
                WHERE EXISTS (
                    SELECT 1 FROM applications
                    WHERE id = ? AND status = 'draft'
                      AND length(trim(COALESCE(student_email, ''))) > 0
                      AND length(trim(COALESCE(student_phone, ''))) > 0
                )
            `).bind(eventId, applicationId, requestId, version, acceptedAt, applicationId).run();
            const existingEvent = await database.prepare(`
                SELECT id FROM audit_events
                WHERE id = ? AND application_id = ?
                  AND event_type = 'application.contact_responsibility_accepted'
            `).bind(eventId, applicationId).first();
            return existingEvent ? this.findById(applicationId) : null;
        },
        async findCurrentStatusById(applicationId) {
            return database.prepare(`
                SELECT status, application_type, updated_at
                FROM applications
                WHERE id = ?
            `).bind(applicationId).first();
        },
        async submitDraft({ applicationId, submittedAt, auditEventId, requestId }) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE applications
                    SET status = 'submitted', submitted_at = ?, updated_at = ?, last_activity_at = ?,
                        terminal_at = NULL, retention_due_at = NULL
                    WHERE id = ? AND status = 'draft'
                `).bind(submittedAt, submittedAt, submittedAt, applicationId),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'application.submitted', 'student', ?, ?, '{"applicationStatus":"submitted"}', ?
                    WHERE changes() = 1
                `).bind(auditEventId, applicationId, requestId, submittedAt)
            ]);
            if (results[0]?.meta?.changes !== 1) return null;
            if (results[1]?.meta?.changes !== 1) throw new Error('Application submit audit did not complete.');
            return this.findById(applicationId);
        },
        async acceptDeclaration({ applicationId, version, acceptedAt, auditEventId, requestId }) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE applications
                    SET declaration_version = ?, declaration_accepted_at = ?,
                        updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status = 'draft'
                `).bind(version, acceptedAt, acceptedAt, acceptedAt, applicationId),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
                    ) SELECT ?, 'application.declaration_accepted', 'student', ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditEventId, applicationId, requestId, JSON.stringify({ version }), acceptedAt)
            ]);
            if (results[0]?.meta?.changes !== 1) return null;
            if (results[1]?.meta?.changes !== 1) throw new Error('Declaration acceptance audit did not complete.');
            return this.findById(applicationId);
        },
        async findActiveByStudentNumber(studentNumber) {
            const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
            return database.prepare(`
                SELECT applications.id, applications.status, applications.application_type
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE students.normalized_student_number = ?
                  AND applications.status NOT IN ('completed', 'cancelled', 'rejected')
                LIMIT 1
            `).bind(normalizedStudentNumber).first();
        },
        async updateDraft(applicationId, changes, auditContext = null, expectedLockVersion = null) {
            const fields = Object.entries(changes)
                .filter(([key]) => Object.hasOwn(PUBLIC_APPLICATION_FIELDS, key));
            if (fields.length === 0) return this.findById(applicationId);

            const requestedType = changes.applicationType;
            if (requestedType === undefined) return this.updateDraftFields(applicationId, fields, expectedLockVersion);

            const currentApplication = await this.findById(applicationId);
            if (!currentApplication || currentApplication.status !== 'draft') return null;
            if (expectedLockVersion !== null && expectedLockVersion !== undefined && currentApplication.lock_version !== expectedLockVersion) {
                throw new ApplicationConflictError('APPLICATION_UPDATE_CONFLICT');
            }
            if (requestedType === currentApplication.application_type) {
                return this.updateDraftFields(applicationId, fields.filter(([key]) => key !== 'applicationType'), expectedLockVersion);
            }
            if (!auditContext?.auditEventId || !auditContext?.requestId) throw new TypeError('Application type changes require audit context.');

            const remaps = await this.readDocumentRequirementRemaps(applicationId, requestedType);
            const assignments = fields.map(([key]) => `${PUBLIC_APPLICATION_FIELDS[key]} = ?`);
            assignments.push('lock_version = lock_version + 1');
            const values = fields.map(([, value]) => value);
            const applicationUpdateIndex = remaps.length + 1;
            const statements = [database.prepare('PRAGMA defer_foreign_keys = ON')];
            remaps.forEach((remap) => statements.push(database.prepare(`
                UPDATE document_records
                SET requirement_id = ?, application_type = ?
                WHERE id = ? AND application_id = ?
                  AND requirement_id = ? AND application_type = ?
                  AND EXISTS (SELECT 1 FROM applications WHERE id=? AND status='draft'
                    AND (? IS NULL OR lock_version=?))
            `).bind(
                remap.targetRequirementId, requestedType, remap.recordId, applicationId,
                remap.currentRequirementId, currentApplication.application_type, applicationId, expectedLockVersion, expectedLockVersion
            )));
            statements.push(database.prepare(`
                UPDATE applications
                SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP,
                    last_activity_at = CURRENT_TIMESTAMP,
                    retention_due_at = datetime('now', '+30 days')
                WHERE id = ? AND status = 'draft' AND application_type = ?
                  AND (? IS NULL OR lock_version=?)
                  AND (SELECT COUNT(*) FROM document_records WHERE application_id = ?) = ?
                  AND NOT EXISTS (
                      SELECT 1 FROM document_records AS records
                      JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                      WHERE records.application_id = ?
                        AND (records.application_type <> ? OR requirements.application_type <> ?)
                  )
            `).bind(
                ...values, applicationId, currentApplication.application_type, expectedLockVersion, expectedLockVersion,
                applicationId, remaps.length, applicationId, requestedType, requestedType
            ));
            statements.push(database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, application_id, request_id, safe_metadata_json
                ) SELECT ?, 'application.application_type_changed', 'student', ?, ?, ?
                WHERE changes() = 1
            `).bind(
                auditContext.auditEventId,
                applicationId,
                auditContext.requestId,
                JSON.stringify({
                    previous_application_type: currentApplication.application_type,
                    new_application_type: requestedType
                })
            ));
            const results = await database.batch(statements);
            if (results[applicationUpdateIndex]?.meta?.changes !== 1 && expectedLockVersion !== null) {
                throw new ApplicationConflictError('APPLICATION_UPDATE_CONFLICT');
            }
            if (results[applicationUpdateIndex]?.meta?.changes !== 1) return null;
            if (results[applicationUpdateIndex + 1]?.meta?.changes !== 1) throw new Error('Application type change audit did not complete.');
            return this.findById(applicationId);
        },
        async updateDraftFields(applicationId, fields, expectedLockVersion = null) {
            if (fields.length === 0) return this.findById(applicationId);

            const assignments = fields.map(([key]) => `${PUBLIC_APPLICATION_FIELDS[key]} = ?`);
            assignments.push('lock_version = lock_version + 1');
            const values = fields.map(([, value]) => value);
            let whereClause = "id = ? AND status = 'draft'";
            const whereValues = [applicationId];
            if (expectedLockVersion !== null && expectedLockVersion !== undefined) {
                whereClause += ' AND lock_version = ?';
                whereValues.push(expectedLockVersion);
            }
            const result = await database.prepare(`
                UPDATE applications
                SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP,
                    last_activity_at = CURRENT_TIMESTAMP,
                    retention_due_at = datetime('now', '+30 days')
                WHERE ${whereClause}
            `).bind(...values, ...whereValues).run();
            if (result.meta.changes === 0 && expectedLockVersion !== null && expectedLockVersion !== undefined) {
                throw new ApplicationConflictError('APPLICATION_UPDATE_CONFLICT');
            }
            return result.meta.changes === 1 ? this.findById(applicationId) : null;
        },
        async readDocumentRequirementRemaps(applicationId, targetApplicationType) {
            const records = await database.prepare(`
                SELECT records.id AS record_id, records.requirement_id, requirements.code
                FROM document_records AS records
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE records.application_id = ?
                ORDER BY records.id
            `).bind(applicationId).all();
            const remaps = [];
            for (const record of records.results) {
                const targetCode = mapDocumentRequirementCodeForTypeSwitch(record.code);
                if (!targetCode) throw new ApplicationTypeChangeBlockedError();
                const targetRequirement = await database.prepare(`
                    SELECT id, application_type FROM document_requirements
                    WHERE code = ? AND application_type = ?
                `).bind(targetCode, targetApplicationType).first();
                if (!targetRequirement || targetRequirement.application_type !== targetApplicationType) {
                    throw new ApplicationTypeChangeBlockedError();
                }
                remaps.push({
                    recordId: record.record_id,
                    currentRequirementId: record.requirement_id,
                    targetRequirementId: targetRequirement.id
                });
            }
            return remaps;
        },
        async listExpiredDrafts(cutoff, limit = 100) {
            const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
            const result = await database.prepare(`
                SELECT id FROM applications
                WHERE status = 'draft'
                  AND COALESCE(retention_due_at, datetime(last_activity_at, '+30 days')) <= datetime(?)
                ORDER BY retention_due_at ASC LIMIT ?
            `).bind(cutoff, boundedLimit).all();
            return result.results;
        }
    });
}
