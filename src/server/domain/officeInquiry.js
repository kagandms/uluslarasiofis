import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { isValidPhoneNumber, normalizePhoneNumber } from '../../shared/phoneNumber.js';
import { ApiError } from './errors.js';

export const INQUIRY_STATUSES = Object.freeze(['new', 'answered']);
export const INQUIRY_STATUS_FILTERS = Object.freeze(['new', 'answered', 'all']);
export const INQUIRY_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);

export const INQUIRY_FIRST_NAME_MAX_LENGTH = 60;
export const INQUIRY_LAST_NAME_MAX_LENGTH = 60;
export const INQUIRY_EMAIL_MAX_LENGTH = 254;
export const INQUIRY_MESSAGE_MIN_LENGTH = 5;
export const INQUIRY_MESSAGE_MAX_LENGTH = 1000;
export const INQUIRY_MAX_ID_LENGTH = 64;
export const INQUIRY_MAX_LIST_LIMIT = 100;
export const INQUIRY_DEFAULT_LIST_LIMIT = 100;

const INQUIRY_ALLOWED_KEYS = Object.freeze([
    'first_name',
    'last_name',
    'phone',
    'email',
    'message',
    'language',
    'website'
]);
const STATUS_UPDATE_ALLOWED_KEYS = Object.freeze(['status']);
const EMAIL_PATTERN = /^[^\s@?#&%\/\\:;,<>"'()\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;
const SINGLE_LINE_CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
// Çok satırlı mesajlarda yalnızca \n satır sonuna izin verilir; diğer kontrol, bidi ve sıfır genişlikli karakterler reddedilir.
const MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
const ID_DISALLOWED_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\s]/u;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireOnlyKeys(body, allowedKeys) {
    if (!isPlainObject(body) || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Form alanlarını kontrol edip tekrar deneyin.');
    }
}

function validateNameField(value, maxLength, errorMessage) {
    if (typeof value !== 'string' || SINGLE_LINE_CONTROL_CHAR_PATTERN.test(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', errorMessage);
    }
    const trimmed = value.trim();
    const charLength = [...trimmed].length;
    if (charLength < 1 || charLength > maxLength) {
        throw new ApiError(400, 'VALIDATION_ERROR', errorMessage);
    }
    return trimmed;
}

function validateOptionalEmail(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || SINGLE_LINE_CONTROL_CHAR_PATTERN.test(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if ([...trimmed].length > INQUIRY_EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    }
    return trimmed;
}

function validateMessageField(value) {
    if (typeof value !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesajınızı kontrol edip tekrar deneyin.');
    }
    const normalized = value.replace(/\r\n/g, '\n');
    if (MESSAGE_DISALLOWED_CONTROL_CHAR_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mesajda geçersiz kontrol karakteri bulunamaz.');
    }
    const trimmed = normalized.trim();
    const charLength = [...trimmed].length;
    if (charLength < INQUIRY_MESSAGE_MIN_LENGTH || charLength > INQUIRY_MESSAGE_MAX_LENGTH) {
        throw new ApiError(
            400,
            'VALIDATION_ERROR',
            `Mesaj ${INQUIRY_MESSAGE_MIN_LENGTH} ile ${INQUIRY_MESSAGE_MAX_LENGTH} karakter arasında olmalıdır.`
        );
    }
    return trimmed;
}

/**
 * Soru formundaki telefon numarasını doğrular ve E.164 biçimine dönüştürür.
 * @param {unknown} value Ham telefon alanı değeri.
 * @returns {string} E.164 biçiminde kanonik telefon numarası.
 * @throws {ApiError} Numara geçersizse girdi yinelemeden 400 VALIDATION_ERROR fırlatır.
 */
function canonicalizeInquiryPhone(value) {
    const normalized = typeof value === 'string' ? normalizePhoneNumber(value) : '';
    if (normalized && isValidPhoneNumber(normalized)) {
        // Uluslararası "00" önekini "+" ile değiştir; ülke kodu olmayan yerel numaraları TR varsay.
        const candidate = normalized.startsWith('00') ? `+${normalized.slice(2)}` : normalized;
        const parsed = parsePhoneNumberFromString(
            candidate,
            candidate.startsWith('+')
                ? { extract: false }
                : { defaultCountry: 'TR', extract: false }
        );
        if (parsed && parsed.isValid()) {
            return parsed.number;
        }
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Telefon numarasını kontrol edip tekrar deneyin.');
}

/**
 * Ana sayfa soru formu gövdesini doğrular ve normalleştirilmiş alanları döndürür.
 * Hata iletilerinde kullanıcı girdisini hiçbir zaman yinelemez.
 * @param {unknown} body Ayrıştırılmış JSON istek gövdesi.
 * @returns {{first_name: string, last_name: string, phone: string, email: string|null, message: string, language: 'tr'|'en'|'ru'|'tk'|'ar'}} Doğrulanmış soru verisi.
 * @throws {ApiError} Alanlar geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateInquiryInput(body) {
    requireOnlyKeys(body, INQUIRY_ALLOWED_KEYS);
    if (Object.hasOwn(body, 'website') && body.website !== undefined) {
        if (typeof body.website !== 'string' || body.website.length > 0) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Form alanlarını kontrol edip tekrar deneyin.');
        }
    }
    const firstName = validateNameField(
        body.first_name,
        INQUIRY_FIRST_NAME_MAX_LENGTH,
        'Ad alanını kontrol edip tekrar deneyin.'
    );
    const lastName = validateNameField(
        body.last_name,
        INQUIRY_LAST_NAME_MAX_LENGTH,
        'Soyad alanını kontrol edip tekrar deneyin.'
    );
    const phone = canonicalizeInquiryPhone(body.phone);
    const email = validateOptionalEmail(body.email);
    const message = validateMessageField(body.message);
    if (typeof body.language !== 'string' || !INQUIRY_LANGUAGES.includes(body.language)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dil seçimini kontrol edip tekrar deneyin.');
    }
    return {
        first_name: firstName,
        last_name: lastName,
        phone,
        email,
        message,
        language: body.language
    };
}

/**
 * Tek bir soru kaydı kimliğini doğrular.
 * @param {unknown} id Soru kimliği.
 * @returns {string} Kırpılmış ve doğrulanmış kimlik.
 * @throws {ApiError} Kimlik geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateInquiryId(id) {
    if (typeof id !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Soru kimliği geçersiz.');
    }
    const trimmed = id.trim();
    if (!trimmed || [...trimmed].length > INQUIRY_MAX_ID_LENGTH || ID_DISALLOWED_CHAR_PATTERN.test(trimmed)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Soru kimliği geçersiz.');
    }
    return trimmed;
}

/**
 * Personel soru listeleme sorgu parametrelerini (`status`, `limit`) doğrular.
 * @param {URLSearchParams} searchParams İstek URL sorgu parametreleri.
 * @returns {{status: 'new'|'answered'|'all', limit: number}} Doğrulanmış sorgu filtreleri.
 * @throws {ApiError} Filtre veya sınır geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateInquiryListQuery(searchParams) {
    const rawStatus = searchParams.get('status');
    const status = rawStatus === null || rawStatus === '' ? 'all' : rawStatus;
    if (!INQUIRY_STATUS_FILTERS.includes(status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Durum filtresini kontrol edip tekrar deneyin.');
    }
    const rawLimit = searchParams.get('limit');
    if (rawLimit === null || rawLimit === '') {
        return { status, limit: INQUIRY_DEFAULT_LIST_LIMIT };
    }
    if (!/^\d+$/.test(rawLimit)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Liste sınırı 1 ile 100 arasında olmalıdır.');
    }
    const limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > INQUIRY_MAX_LIST_LIMIT) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Liste sınırı 1 ile 100 arasında olmalıdır.');
    }
    return { status, limit };
}

/**
 * Personel soru durumu güncelleme gövdesini doğrular.
 * @param {unknown} body Ayrıştırılmış JSON istek gövdesi.
 * @returns {'new'|'answered'} Doğrulanmış hedef durum.
 * @throws {ApiError} Bilinmeyen alan veya geçersiz durum varsa 400 VALIDATION_ERROR fırlatır.
 */
export function validateInquiryStatusUpdateBody(body) {
    requireOnlyKeys(body, STATUS_UPDATE_ALLOWED_KEYS);
    if (typeof body.status !== 'string' || !INQUIRY_STATUSES.includes(body.status)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Soru durumunu kontrol edip tekrar deneyin.');
    }
    return body.status;
}

/**
 * Veritabanı satırını personel API sözleşmesindeki InquiryDto biçimine dönüştürür.
 * @param {object} row `office_inquiries` ve `staff_users` birleşim satırı.
 * @returns {{id: string, first_name: string, last_name: string, phone: string, email: string|null, message: string, language: string, status: string, handled_by_name: string|null, handled_at: string|null, created_at: string}} Sözleşmeye uygun soru DTO'su.
 */
export function createInquiryDto(row) {
    return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        email: row.email ?? null,
        message: row.message,
        language: row.language,
        status: row.status,
        handled_by_name: row.handled_by_name ?? null,
        handled_at: row.handled_at ?? null,
        created_at: row.created_at
    };
}
