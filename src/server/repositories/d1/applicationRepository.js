import { ApplicationConflictError } from '../../domain/errors.js';
import { normalizeStudentNumber } from './studentRepository.js';

const PUBLIC_APPLICATION_FIELDS = Object.freeze({
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
        async createDraftWithSession({ applicationId, studentId, studentNumber, applicationType, studentEmail, studentPhone, sessionId, tokenHash, expiresAt, createdAt, auditEventId, requestId }) {
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
                    SELECT ?, id, ?, ?, ?, datetime(?, '+30 days')
                    FROM students WHERE normalized_student_number = ?
                `).bind(applicationId, applicationType, studentEmail, studentPhone, createdAt, normalizedStudentNumber),
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
            } catch (error) {
                if (isActiveApplicationConflict(error)) throw new ApplicationConflictError();
                throw error;
            }

            return this.findById(applicationId);
        },
        async findById(applicationId) {
            return database.prepare(`
                SELECT applications.*, students.student_number
                FROM applications
                JOIN students ON students.id = applications.student_id
                WHERE applications.id = ?
            `).bind(applicationId).first();
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
                    SET status = 'submitted', submitted_at = ?, updated_at = ?, last_activity_at = ?
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
        async updateDraft(applicationId, changes) {
            const fields = Object.entries(changes)
                .filter(([key]) => Object.hasOwn(PUBLIC_APPLICATION_FIELDS, key));
            if (fields.length === 0) return this.findById(applicationId);

            const assignments = fields.map(([key]) => `${PUBLIC_APPLICATION_FIELDS[key]} = ?`);
            const values = fields.map(([, value]) => value);
            const result = await database.prepare(`
                UPDATE applications
                SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP,
                    last_activity_at = CURRENT_TIMESTAMP,
                    retention_due_at = datetime('now', '+30 days')
                WHERE id = ? AND status = 'draft'
            `).bind(...values, applicationId).run();
            return result.meta.changes === 1 ? this.findById(applicationId) : null;
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
