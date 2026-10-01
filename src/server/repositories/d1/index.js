import { createApplicationRepository } from './applicationRepository.js';
import { createApplicationNoteRepository } from './applicationNoteRepository.js';
import { createApplicationReviewRepository } from './applicationReviewRepository.js';
import { createAssignmentRepository } from './assignmentRepository.js';
import { createAuditRepository } from './auditRepository.js';
import { createDocumentRepository } from './documentRepository.js';
import { createResubmissionUploadRepository } from './resubmissionUploadRepository.js';
import { createNotificationRepository } from './notificationRepository.js';
import { createRateLimitRepository } from './rateLimitRepository.js';
import { createSessionRepository } from './sessionRepository.js';
import { createStaffRepository } from './staffRepository.js';
import { createStudentRepository } from './studentRepository.js';

/**
 * Creates all D1-backed persistence adapters behind domain-specific interfaces.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Repository collection used by application services and Worker routes.
 */
export function createD1Repositories(database) {
    if (!database) throw new TypeError('A D1 database binding is required.');
    const applicationNotes = createApplicationNoteRepository(database);
    return Object.freeze({
        applications: createApplicationRepository(database),
        applicationNotes,
        applicationReviews: createApplicationReviewRepository(database, applicationNotes),
        assignments: createAssignmentRepository(database),
        audit: createAuditRepository(database),
        documents: createDocumentRepository(database),
        resubmissionUploads: createResubmissionUploadRepository(database),
        notifications: createNotificationRepository(database),
        rateLimits: createRateLimitRepository(database),
        sessions: createSessionRepository(database),
        staff: createStaffRepository(database),
        students: createStudentRepository(database)
    });
}
