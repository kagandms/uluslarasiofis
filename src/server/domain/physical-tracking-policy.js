import { ApiError } from './errors.js';
import { validatePhysicalIntake } from './physical-intake-policy.js';

export const TRACKING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RECEIPT_TEMPLATE_VERSION = '1';
export const RECEIPT_RETENTION_MS = 30 * 86400_000;

/** Returns the calendar day in Istanbul. @param {Date} instant UTC instant. @returns {string} ISO day. */
export function readIstanbulDay(instant = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Validates a real calendar day without limiting past/future years. @param {unknown} value Day. @returns {string} ISO day. @throws {ApiError} Invalid day. */
export function requireApplicationDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new ApiError(400, 'INVALID_DATE', 'Geçerli teslim tarihi seçin.');
    const instant = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(instant.valueOf()) || instant.toISOString().slice(0, 10) !== value) throw new ApiError(400, 'INVALID_DATE', 'Geçerli teslim tarihi seçin.');
    return value;
}

/** Creates an unbiased random office reference. @param {string} day Validated day. @returns {string} Reference. */
export function createTrackingReference(day) {
    requireApplicationDate(day);
    const ceiling = 256 - 256 % TRACKING_ALPHABET.length;
    let suffix = '';
    while (suffix.length < 7) {
        for (const sample of crypto.getRandomValues(new Uint8Array(16))) {
            if (sample < ceiling && suffix.length < 7) suffix += TRACKING_ALPHABET[sample % TRACKING_ALPHABET.length];
        }
    }
    return `ITU-${day.slice(2, 4)}-${suffix}`;
}

/** Accepts lower case and compact references; unexpected characters remain invalid. @param {unknown} value Reference. @returns {string|null} Canonical reference. */
export function normalizeTrackingReference(value) {
    if (typeof value !== 'string' || value.length > 64) return null;
    const reference = value.trim().toUpperCase();
    const pattern = new RegExp(`^ITU-([0-9]{2})-([${TRACKING_ALPHABET}]{7})$`);
    const compact = new RegExp(`^ITU([0-9]{2})([${TRACKING_ALPHABET}]{7})$`);
    if (pattern.test(reference)) return reference;
    const match = reference.match(compact);
    return match ? `ITU-${match[1]}-${match[2]}` : null;
}

/** Validates operation UUIDs. @param {unknown} value UUID. @returns {string} Canonical UUID. @throws {ApiError} Invalid identity. */
export function requireReceiptUuid(value) {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'INVALID_ID', 'İşlem kimliği geçersiz.');
    return value.toLowerCase();
}

/** Normalizes metadata independently of reservation identity. @param {object} body Metadata. @returns {object} Metadata. @throws {ApiError} Invalid fields. */
export function validateReceiptMetadata(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'linked_application_id')) throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt alanlarını kontrol edin.');
    const { application_date: day, ...fields } = body;
    return { ...validatePhysicalIntake(fields), application_date: requireApplicationDate(day) };
}

/** Reads a trusted configured portal origin. @param {object} environment Bindings. @returns {string|null} Allowed HTTPS origin. */
export function readReceiptPortalOrigin(environment) {
    try {
        const origin = new URL(environment.PUBLIC_PORTAL_ORIGIN);
        const allowlist = (environment.PUBLIC_PORTAL_ORIGIN_ALLOWLIST || '').split(',').map(entry => entry.trim());
        if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
            || !allowlist.includes(origin.origin)) return null;
        return origin.origin;
    } catch { return null; }
}

/** Returns a safe public status code with no personal information. @param {object} intake Stored record. @returns {string} Office status. */
export function readPhysicalTrackingStatus(intake) {
    if (intake.processing_closed_at || intake.legacy_status === 'completed') return 'closed';
    if (intake.status === 'rejected') return 'contact_office';
    if (intake.status === 'approved_for_processing') return 'approved_for_processing';
    return intake.current_pdf_id ? 'under_review' : 'received';
}

/** Builds a versioned, staff-only document snapshot. @param {object} intake Record. @param {string|null} portalOrigin Trusted origin. @param {string} createdAt Receipt UTC time. @returns {object} Snapshot. */
export function buildReceiptSnapshot(intake, portalOrigin, createdAt) {
    return { first_name: intake.first_name, last_name: intake.last_name, passport_number: intake.passport_number,
        application_date: intake.application_date, tracking_reference: intake.tracking_reference, portal_origin: portalOrigin, created_at: createdAt };
}
