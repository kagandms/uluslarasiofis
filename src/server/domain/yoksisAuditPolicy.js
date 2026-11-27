import { ApiError } from './errors.js';

/** Maximum number of scan records accepted in one `/records` batch. */
export const MAX_BATCH_RECORDS = 25;

/** Maximum number of Excel rows accepted in one `/import` batch. */
export const MAX_IMPORT_BATCH_ROWS = 50;

/** Maximum UTF-8 JSON payload size accepted by YÖKSİS audit write endpoints. */
export const MAX_BATCH_BYTES = 128 * 1024;

/** Maximum search text length accepted by `/query`. */
export const MAX_SEARCH_LENGTH = 120;

/** Maximum page size accepted by `/query`. */
export const MAX_PAGE_SIZE = 100;

/** Allowed status category filter values for `/query`. */
export const STATUS_CATEGORIES = new Set([
    'all', 'successful', 'pending', 'rejected', 'missing_documents', 'unreadable', 'other'
]);

/**
 * Online application match filters: 'matched' means student number or full name belongs
 * to an application already forwarded to the Migration Administration; 'unmatched' means neither.
 */
export const MATCH_FILTERS = new Set(['all', 'matched', 'unmatched']);

const IMPORT_ROW_KEYS = new Set([
    'applicationNumber',
    'studentNumber',
    'fullName',
    'unit',
    'program',
    'processType',
    'transactionCount',
    'gocStatus',
    'missingDeadline',
    'missingNote',
    'gocLastQueryAt',
    'recordDate'
]);

/**
 * Normalizes Turkish text for case-insensitive, diacritic-insensitive search and matching.
 * @param {unknown} value Raw input value.
 * @returns {string} Lowercased ASCII-folded search string with punctuation replaced by spaces.
 */
export function normalizeSearch(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Reads and bounds-checks a text field using Turkish validation errors.
 * @param {unknown} value Raw field value.
 * @param {string} field Turkish field label for error reporting.
 * @param {number} maxLength Maximum trimmed character length.
 * @param {{ optional?: boolean }} [options] Optionality flag.
 * @returns {string} Trimmed text value.
 * @throws {ApiError} When the value is not a valid string within bounds.
 */
export function readAuditText(value, field, maxLength, { optional = false } = {}) {
    if (optional && (value === undefined || value === null)) return '';
    if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edin.`);
    const text = value.trim();
    if ((!optional && !text) || text.length > maxLength) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edin.`);
    }
    return text;
}

/**
 * Classifies a scan-sourced YÖKSİS application status into a normalized status category.
 * @param {string} applicationStatus Raw application status text from YÖKSİS scan.
 * @param {string} resultStatus Verification status (`verified`, `unreadable`, or `identity-mismatch`).
 * @returns {'successful'|'pending'|'rejected'|'missing_documents'|'unreadable'|'other'} Status category.
 */
export function classifyStatus(applicationStatus, resultStatus) {
    if (resultStatus !== 'verified') return 'unreadable';
    const normalized = normalizeSearch(applicationStatus);
    if (['islem tamamlandi', 'tamamlandi'].includes(normalized)) return 'successful';
    if (normalized === 'islem bekliyor') return 'pending';
    if (normalized === 'eksik belge bekliyor') return 'missing_documents';
    if (['reddedildi', 'basvuru reddedildi', 'ret'].includes(normalized)) return 'rejected';
    return 'other';
}

/**
 * Single source of truth for mapping the Excel "İşlem Tamamlandı" status to the portal sync target.
 * Kept in one exported constant until the office confirms its exact meaning.
 */
export const COMPLETED_GOC_STATUS_TARGET = Object.freeze({
    normalizedText: 'islem tamamlandi',
    targetState: 'approved'
});

/**
 * Classifies an Excel-sourced "Göç Durumu" string into a normalized status category.
 * @param {unknown} gocStatus Raw Göç Durumu text from YÖKSİS Excel export.
 * @returns {'successful'|'pending'|'missing_documents'|'other'} Status category.
 */
export function classifyGocStatus(gocStatus) {
    const normalized = normalizeSearch(gocStatus);
    if (normalized === COMPLETED_GOC_STATUS_TARGET.normalizedText) return 'successful';
    if (normalized === 'islem bekliyor') return 'pending';
    if (normalized === 'eksik belge istendi' || normalized.startsWith('eksik belge istendi ')) {
        return 'missing_documents';
    }
    if (normalized === 'eksik belgeler iletildi' || normalized.startsWith('eksik belgeler iletildi ')) {
        return 'pending';
    }
    if (normalized === 'degerlendirme asamasinda') return 'pending';
    return 'other';
}

/**
 * Validates the missing-documents array sent by the scan endpoint.
 * @param {unknown} value Candidate documents array.
 * @returns {Array<{code: string, name: string, required: boolean, note: string, uploadStatus: string}>} Validated documents.
 * @throws {ApiError} When any document entry is malformed.
 */
export function validateDocuments(value) {
    if (!Array.isArray(value) || value.length > 100) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Eksik evrak satırları okunamadı.');
    }
    return value.map((document) => {
        if (!document || typeof document !== 'object' || Array.isArray(document) || typeof document.required !== 'boolean') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Eksik evrak satırları okunamadı.');
        }
        return {
            code: readAuditText(document.code, 'Belge kodu', 80, { optional: true }),
            name: readAuditText(document.name, 'Belge adı', 255),
            required: document.required,
            note: readAuditText(document.note, 'Belge açıklaması', 255, { optional: true }),
            uploadStatus: readAuditText(document.uploadStatus, 'Yükleme durumu', 80, { optional: true })
        };
    });
}

/**
 * Checks whether a value is a valid `YYYY-MM-DD` calendar date.
 * @param {unknown} value Candidate date string.
 * @returns {boolean} True when valid ISO calendar date.
 */
export function isValidIsoCalendarDate(value) {
    if (typeof value !== 'string') return false;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

let istanbulDateFormatter;

function getIstanbulDateFormatter() {
    if (istanbulDateFormatter === undefined) {
        try {
            istanbulDateFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Europe/Istanbul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        } catch {
            istanbulDateFormatter = null;
        }
    }
    return istanbulDateFormatter;
}

function formatIstanbulDate(date) {
    const formatter = getIstanbulDateFormatter();
    if (formatter) {
        try {
            const parts = formatter.formatToParts(date);
            const get = (type) => parts.find((part) => part.type === type)?.value || '';
            const year = get('year');
            const month = get('month');
            const day = get('day');
            if (year && month && day) return `${year}-${month}-${day}`;
        } catch {
            // Fallback below when Intl formatting fails.
        }
    }
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Returns today's calendar date (`YYYY-MM-DD`) in `Europe/Istanbul`.
 * @param {number} [nowMs=Date.now()] Reference timestamp in milliseconds.
 * @returns {string} ISO calendar date.
 */
export function getIstanbulTodayIso(nowMs = Date.now()) {
    return formatIstanbulDate(new Date(nowMs));
}

/**
 * Converts a calendar date (`YYYY-MM-DD`) or timestamp string to an `Europe/Istanbul` calendar date.
 * @param {unknown} value Raw date or timestamp string.
 * @returns {string|null} ISO calendar date or null when invalid.
 */
export function toIstanbulCalendarDate(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    if (isValidIsoCalendarDate(text)) return text;
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return null;
    return formatIstanbulDate(parsed);
}

/**
 * Computes signed calendar day difference `toIso - fromIso` between two `YYYY-MM-DD` dates.
 * @param {unknown} fromIso Start ISO date.
 * @param {unknown} toIso End ISO date.
 * @returns {number|null} Signed day difference, or null if either date is invalid.
 */
export function diffIsoCalendarDays(fromIso, toIso) {
    if (!isValidIsoCalendarDate(fromIso) || !isValidIsoCalendarDate(toIso)) return null;
    const [fy, fm, fd] = fromIso.split('-').map(Number);
    const [ty, tm, td] = toIso.split('-').map(Number);
    const fromUtc = Date.UTC(fy, fm - 1, fd);
    const toUtc = Date.UTC(ty, tm - 1, td);
    return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

/**
 * Shifts a valid `YYYY-MM-DD` calendar date by `deltaDays` days.
 * @param {string} isoDate Base ISO date.
 * @param {number} deltaDays Signed day offset.
 * @returns {string|null} Shifted ISO date or null when invalid.
 */
export function shiftIsoCalendarDate(isoDate, deltaDays) {
    if (!isValidIsoCalendarDate(isoDate) || !Number.isInteger(deltaDays)) return null;
    const [y, m, d] = isoDate.split('-').map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
    const sy = shifted.getUTCFullYear();
    const sm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const sd = String(shifted.getUTCDate()).padStart(2, '0');
    return `${sy}-${sm}-${sd}`;
}

/**
 * Validates an optional `exportedAt` timestamp in `YYYY-MM-DD HH:mm` format.
 * @param {unknown} value Candidate exportedAt value.
 * @returns {string|null} Trimmed timestamp or null when omitted.
 * @throws {ApiError} When the timestamp format or calendar values are invalid.
 */
export function validateExportedAt(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dışa aktarma tarihi YYYY-AA-GG SS:dd biçiminde olmalıdır.');
    }
    const text = value.trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/);
    if (!match || !isValidIsoCalendarDate(match[1])) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dışa aktarma tarihi YYYY-AA-GG SS:dd biçiminde olmalıdır.');
    }
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (hour > 23 || minute > 59) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dışa aktarma tarihi YYYY-AA-GG SS:dd biçiminde olmalıdır.');
    }
    return text;
}

function readOptionalIsoDate(value, label) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', `${label} YYYY-AA-GG biçiminde olmalıdır.`);
    }
    const text = value.trim();
    if (!isValidIsoCalendarDate(text)) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${label} YYYY-AA-GG biçiminde olmalıdır.`);
    }
    return text;
}

/**
 * Validates and normalizes a single Excel import row according to contract 7.3.
 * @param {unknown} value Candidate import row object.
 * @returns {{
 *   applicationNumber: string,
 *   studentNumber: string,
 *   fullName: string,
 *   unit: string,
 *   program: string,
 *   processType: string,
 *   transactionCount: number,
 *   gocStatus: string,
 *   statusCategory: 'successful'|'pending'|'missing_documents'|'other',
 *   resultStatus: 'verified',
 *   missingDeadline: string|null,
 *   missingNote: string,
 *   gocLastQueryAt: string|null
 * }} Validated import row ready for persistence.
 * @throws {ApiError} When any field or key violates the import contract.
 */
export function validateImportRow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Satır biçimi geçersiz.');
    }
    if (Object.keys(value).some((key) => !IMPORT_ROW_KEYS.has(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Satırda tanınmayan alan bulundu.');
    }

    if (typeof value.applicationNumber !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru numarası biçimi geçersiz (YYYY-AA-NNNNNNN beklenir).');
    }
    const applicationNumber = value.applicationNumber.trim();
    if (!/^\d{4}-\d{2}-\d{7}$/.test(applicationNumber)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru numarası biçimi geçersiz (YYYY-AA-NNNNNNN beklenir).');
    }

    if (typeof value.studentNumber !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarası 8 ile 14 rakam arasında olmalıdır.');
    }
    const studentNumber = value.studentNumber.trim();
    if (!/^\d{8,14}$/.test(studentNumber)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarası 8 ile 14 rakam arasında olmalıdır.');
    }

    if (typeof value.fullName !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Ad soyad alanı 1 ile 240 karakter arasında olmalıdır.');
    }
    const fullName = value.fullName.trim();
    if (fullName.length < 1 || fullName.length > 240) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Ad soyad alanı 1 ile 240 karakter arasında olmalıdır.');
    }

    let unit = '';
    if (value.unit !== undefined && value.unit !== null) {
        if (typeof value.unit !== 'string' || value.unit.trim().length > 120) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Birim alanı en fazla 120 karakter olabilir.');
        }
        unit = value.unit.trim();
    }

    let program = '';
    if (value.program !== undefined && value.program !== null) {
        if (typeof value.program !== 'string' || value.program.trim().length > 160) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Program alanı en fazla 160 karakter olabilir.');
        }
        program = value.program.trim();
    }

    if (typeof value.processType !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem türü alanı 1 ile 40 karakter arasında olmalıdır.');
    }
    const processType = value.processType.trim();
    if (processType.length < 1 || processType.length > 40) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem türü alanı 1 ile 40 karakter arasında olmalıdır.');
    }

    if (!Number.isSafeInteger(value.transactionCount) || value.transactionCount < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem sayısı en az 1 olan tam sayı olmalıdır.');
    }

    if (typeof value.gocStatus !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Göç durumu alanı 1 ile 300 karakter arasında olmalıdır.');
    }
    const gocStatus = value.gocStatus.trim();
    if (gocStatus.length < 1 || gocStatus.length > 300) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Göç durumu alanı 1 ile 300 karakter arasında olmalıdır.');
    }

    const missingDeadline = readOptionalIsoDate(value.missingDeadline, 'Eksik belge son tarihi');

    let missingNote = '';
    if (value.missingNote !== undefined && value.missingNote !== null) {
        if (typeof value.missingNote !== 'string' || value.missingNote.trim().length > 1000) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Eksik belge açıklaması en fazla 1000 karakter olabilir.');
        }
        missingNote = value.missingNote.trim();
    }

    const gocLastQueryAt = readOptionalIsoDate(value.gocLastQueryAt, 'Göç son sorgu tarihi');
    const recordDate = readOptionalIsoDate(value.recordDate, 'Kayıt tarihi');

    return {
        applicationNumber,
        studentNumber,
        fullName,
        unit,
        program,
        processType,
        transactionCount: value.transactionCount,
        gocStatus,
        statusCategory: classifyGocStatus(gocStatus),
        resultStatus: 'verified',
        missingDeadline,
        missingNote,
        gocLastQueryAt,
        recordDate
    };
}

/**
 * Builds the `documents_json` array representation for an Excel import row.
 * @param {string} missingNote Optional missing-document description from Excel.
 * @param {string|null} missingDeadline Optional ISO deadline (`YYYY-MM-DD`).
 * @returns {Array<{name: string, required: boolean, note: string, uploadStatus: string}>} Documents payload.
 */
export function buildImportDocuments(missingNote, missingDeadline) {
    const cleanedNote = String(missingNote || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleanedNote) return [];
    const name = cleanedNote.slice(0, 255);
    let note = '';
    if (typeof missingDeadline === 'string' && isValidIsoCalendarDate(missingDeadline)) {
        const [year, month, day] = missingDeadline.split('-');
        note = `Son tarih: ${day}.${month}.${year}`;
    }
    return [{ name, required: true, note, uploadStatus: '' }];
}
