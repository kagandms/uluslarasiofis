import { ApiError } from './errors.js';
import { MAX_PHYSICAL_PDF_BYTES } from '../../config/physical-document-limits.js';

function requireText(value, { field, maxLength }) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edin.`);
    }
    return value.trim();
}

export { MAX_PHYSICAL_PDF_BYTES };
export const PHYSICAL_STATUS_FILTERS = Object.freeze({
    all: null, under_review: ['under_review'], approved: ['approved_for_processing'], rejected: ['rejected'], deleted: null
});
const REVIEW_STATUSES = ['under_review', 'approved_for_processing', 'rejected'];

/** @param {unknown} value Record version. @returns {number} Valid version. @throws {ApiError} Invalid version. */
export function requirePhysicalVersion(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'VERSION_REQUIRED', 'Kaydı yenileyip tekrar deneyin.');
    return value;
}

/** @param {unknown} value Student number. @returns {string} Normalized identity. @throws {ApiError} Invalid identity. */
export function normalizePhysicalStudentNumber(value) {
    const normalized = requireText(value, { field: 'Öğrenci numarası', maxLength: 64 }).toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarasını kontrol edin.');
    return normalized;
}

/** @param {object} body Staff form. @returns {object} Validated receipt. @throws {ApiError} Invalid fields. */
export function validatePhysicalIntake(body) {
    const keys = ['student_number', 'first_name', 'last_name', 'passport_number', 'application_type', 'linked_application_id'];
    if (Object.keys(body).some(key => !keys.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt alanlarını kontrol edin.');
    if (body.student_number != null && typeof body.student_number !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarasını kontrol edin.');
    if (!['initial', 'renewal'].includes(body.application_type)) throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türünü seçin.');
    return {
        student_number: typeof body.student_number === 'string' && body.student_number.trim() ? normalizePhysicalStudentNumber(body.student_number) : '',
        first_name: requireText(body.first_name, { field: 'Ad', maxLength: 120 }),
        last_name: requireText(body.last_name, { field: 'Soyad', maxLength: 120 }),
        passport_number: requireText(body.passport_number, { field: 'Pasaport no', maxLength: 64 }).toUpperCase(),
        application_type: body.application_type,
        linked_application_id: body.linked_application_id == null ? null : requireText(body.linked_application_id, { field: 'Bağlı başvuru', maxLength: 64 })
    };
}

/** @param {object} intake Current receipt. @param {object} pdf Current file. @returns {string[]} Available transitions. */
export function listPhysicalTransitions(intake, pdf) {
    if (intake.deleted_at) return [];
    return REVIEW_STATUSES.filter(status => status !== intake.status
        && (status !== 'approved_for_processing' || pdf?.upload_status === 'finalized' && pdf?.scan_status === 'clean'));
}

/** Validates a rejection reason. @param {unknown} value Reason. @returns {string} Bounded reason. @throws {ApiError} Missing or short reason. */
export function requirePhysicalRejectionReason(value) {
    const reason = requireText(value, { field: 'Ret gerekçesi', maxLength: 2000 });
    if (reason.length < 5) throw new ApiError(400, 'REJECTION_REASON_REQUIRED', 'Ret gerekçesi en az 5 karakter olmalı.');
    return reason;
}
