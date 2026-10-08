import { ApiError } from './errors.js';

export const MAX_PRINT_BYTES = 10 * 1024 * 1024;
export const MAX_PRINT_PAGES = 20;
export const MAX_PRINT_COPIES = 50;
export const MAX_PRINT_PAGE_COPIES = 1000;
export const DEFAULT_PRINT_LIMITS = Object.freeze({ maxCopies: 50, maxPageCopies: 200, isValid: true });
export const MAX_PENDING_PRINT_JOBS = 50;
export const PRINT_HEARTBEAT_MAX_AGE_MS = 60_000;
export const PRINT_UPLOAD_TTL_MS = 10 * 60_000;
export const PRINT_SUCCESS_RETENTION_MS = 15 * 60_000;
export const PRINT_FAILURE_RETENTION_MS = 60 * 60_000;
export const PRINT_ROW_RETENTION_MS = 24 * 60 * 60_000;
export const PRINT_MAX_ATTEMPTS = 3;
export const PRINT_LEASE_MS = 5 * 60_000;

const ALLOWED_MEDIA_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const RESULT_CODES = new Set(['submitted', 'printer_unavailable', 'validation_failed', 'unsupported_content', 'invalid_print_options', 'page_copy_budget_exceeded', 'spooler_error', 'submission_unknown']);
const ALLOWED_PAPER_SIZES = new Set(['A4', 'A3']);
const ALLOWED_COLOR_MODES = new Set(['monochrome', 'color']);
const ALLOWED_DUPLEX_MODES = new Set(['simplex', 'duplexlong']);
const ALLOWED_ORIENTATIONS = new Set(['portrait', 'landscape']);

export function readPrintLimits(environment = {}) {
    const maxCopies = readConfiguredLimit(environment.PRINT_MAX_COPIES_PER_JOB, 50, MAX_PRINT_COPIES);
    const maxPageCopies = readConfiguredLimit(environment.PRINT_MAX_PAGE_COPIES, 200, MAX_PRINT_PAGE_COPIES);
    return Object.freeze({ maxCopies: maxCopies.value, maxPageCopies: maxPageCopies.value,
        isValid: maxCopies.isValid && maxPageCopies.isValid });
}

function readConfiguredLimit(value, fallback, maximum) {
    if (value === undefined) return { value: fallback, isValid: true };
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return { value: fallback, isValid: false };
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return { value: fallback, isValid: false };
    return { value: parsed, isValid: true };
}

export function readPrintOptionCapabilities(environment = {}, settingsProtocol = 0) {
    const agentSupportsSettings = settingsProtocol >= 1;
    const orientationModes = settingsProtocol >= 3 ? ['portrait', 'landscape'] : ['portrait'];
    const limits = readPrintLimits(environment);
    return Object.freeze({
        paper_sizes: Object.freeze(environment.PRINT_ENABLE_A3 === 'true' && agentSupportsSettings ? ['A4', 'A3'] : ['A4']),
        color_modes: Object.freeze(environment.PRINT_ENABLE_COLOR === 'true' && agentSupportsSettings
            ? ['monochrome', 'color'] : ['monochrome']),
        duplex_modes: Object.freeze(environment.PRINT_ENABLE_DUPLEX === 'true' && agentSupportsSettings
            ? ['simplex', 'duplexlong'] : ['simplex']),
        orientations: Object.freeze(orientationModes),
        limits: Object.freeze({ max_copies: settingsProtocol >= 2 ? limits.maxCopies : Math.min(limits.maxCopies, 3),
            max_page_copies: limits.maxPageCopies })
    });
}

export function validatePrintUpload(input, capabilities = readPrintOptionCapabilities()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidPrintInput();
    if (!ALLOWED_MEDIA_TYPES.has(input.media_type)) throw new ApiError(415, 'PRINT_UNSUPPORTED_MEDIA', 'PDF, JPG veya PNG dosyası seçin.');
    if (!Number.isSafeInteger(input.byte_size) || input.byte_size < 1 || input.byte_size > MAX_PRINT_BYTES) {
        throw new ApiError(413, 'PRINT_FILE_SIZE_INVALID', 'Dosya boyutu izin verilen sınırı aşıyor.');
    }
    const maxCopies = capabilities.limits?.max_copies ?? 3;
    const orientations = capabilities.orientations || ['portrait'];
    if (!Number.isSafeInteger(input.copies) || input.copies < 1 || input.copies > maxCopies) {
        throw invalidPrintInput();
    }
    const orientation = input.orientation ?? 'portrait';
    if (!ALLOWED_PAPER_SIZES.has(input.paper_size) || !capabilities.paper_sizes.includes(input.paper_size)
        || !ALLOWED_COLOR_MODES.has(input.color_mode) || !capabilities.color_modes.includes(input.color_mode)
        || !ALLOWED_DUPLEX_MODES.has(input.duplex) || !capabilities.duplex_modes.includes(input.duplex)
        || !ALLOWED_ORIENTATIONS.has(orientation) || !orientations.includes(orientation)) {
        throw invalidPrintInput();
    }
    const settingsProtocol = orientation === 'landscape' ? 3 : input.copies > 3 ? 2
        : input.paper_size !== 'A4' || input.color_mode !== 'monochrome' || input.duplex !== 'simplex' ? 1 : 0;
    return Object.freeze({ mediaType: input.media_type, byteSize: input.byte_size, copies: input.copies,
        paperSize: input.paper_size, colorMode: input.color_mode, duplex: input.duplex,
        orientation, requiredProtocol: settingsProtocol });
}

export function validatePrintMagicBytes(mediaType, bytes) {
    if (!(bytes instanceof Uint8Array)) return false;
    if (mediaType === 'application/pdf') return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
    if (mediaType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mediaType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    return false;
}

export function validatePrintResult(input) {
    if (!input || typeof input !== 'object' || !['submitted', 'failed', 'unknown'].includes(input.status)
        || !RESULT_CODES.has(input.result_code)) throw invalidPrintInput();
    if (input.status === 'submitted' && input.result_code !== 'submitted') throw invalidPrintInput();
    if (input.status === 'unknown' && input.result_code !== 'submission_unknown') throw invalidPrintInput();
    if (input.spooler_job_id !== null && !(typeof input.spooler_job_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.spooler_job_id))) {
        throw invalidPrintInput();
    }
    return Object.freeze({ status: input.status, resultCode: input.result_code, spoolerJobId: input.spooler_job_id });
}

export function createPrintTrackingToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function invalidPrintInput() {
    return new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
}
