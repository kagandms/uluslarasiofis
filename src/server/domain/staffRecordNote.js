import { ApiError } from './errors.js';

export const RECORD_NOTE_KINDS = Object.freeze(['online', 'physical']);
export const RECORD_NOTE_MAX_BODY_LENGTH = 500;
export const RECORD_NOTE_MAX_IDS = 100;
export const RECORD_NOTE_MAX_ID_LENGTH = 64;

const RECORD_NOTE_ALLOWED_KEYS = Object.freeze(['body']);
// Satır sonu (\n) dışındaki tüm ASCII/C1 kontrol karakterlerini reddeder.
const DISALLOWED_CONTROL_CHAR_PATTERN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/u;
const DISALLOWED_ID_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\s]/u;

/**
 * İstek gövdesinde yalnızca izin verilen anahtarların bulunmasını zorunlu kılar.
 * @param {unknown} body Ayrıştırılmış JSON istek gövdesi.
 * @param {readonly string[]} allowedKeys İzin verilen alan adları.
 * @returns {void} Geçerliyse bir şey döndürmez.
 * @throws {ApiError} Gövde nesne değilse veya bilinmeyen alan içeriyorsa 400 VALIDATION_ERROR fırlatır.
 */
export function requireOnlyKeys(body, allowedKeys) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem alanlarını kontrol edip tekrar deneyin.');
    }
}

/**
 * Kayıt türünü doğrular ('online' veya 'physical').
 * @param {unknown} kind İstekten gelen kayıt türü.
 * @returns {'online'|'physical'} Doğrulanmış kayıt türü.
 * @throws {ApiError} Kayıt türü geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateRecordKind(kind) {
    if (typeof kind !== 'string' || !RECORD_NOTE_KINDS.includes(kind)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt türü yalnızca online veya physical olabilir.');
    }
    return kind;
}

/**
 * Tek bir kayıt kimliğini uzunluk ve karakter kurallarına göre doğrular.
 * @param {unknown} id Kayıt kimliği.
 * @returns {string} Kırpılmış ve doğrulanmış kayıt kimliği.
 * @throws {ApiError} Kimlik boş, 64 karakterden uzun veya geçersiz karakter içeriyorsa 400 VALIDATION_ERROR fırlatır.
 */
export function validateRecordId(id) {
    if (typeof id !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt kimliği geçersiz.');
    }
    const trimmed = id.trim();
    if (!trimmed || [...trimmed].length > RECORD_NOTE_MAX_ID_LENGTH
        || DISALLOWED_ID_CHAR_PATTERN.test(trimmed)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt kimliği geçersiz.');
    }
    return trimmed;
}

/**
 * Toplu okuma sorgusundaki virgülle ayrılmış ids parametresini ayrıştırıp doğrular.
 * @param {string|null} idsParam URL sorgusundaki ids değeri.
 * @returns {string[]} Yinelenenleri temizlenmiş geçerli kayıt kimlikleri.
 * @throws {ApiError} Parametre eksik, 100 adetten fazla veya geçersiz kimlik içeriyorsa 400 VALIDATION_ERROR fırlatır.
 */
export function validateRecordIdsQuery(idsParam) {
    if (idsParam === null) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt kimlikleri belirtilmelidir.');
    }
    if (idsParam.trim() === '') return [];
    const rawParts = idsParam.split(',');
    if (rawParts.length > RECORD_NOTE_MAX_IDS) {
        throw new ApiError(400, 'VALIDATION_ERROR', `En fazla ${RECORD_NOTE_MAX_IDS} kayıt kimliği sorgulanabilir.`);
    }
    const uniqueIds = [];
    const seen = new Set();
    for (const part of rawParts) {
        const id = validateRecordId(part);
        if (!seen.has(id)) {
            seen.add(id);
            uniqueIds.push(id);
        }
    }
    return uniqueIds;
}

/**
 * Personel kayıt notu gövdesini doğrular ve baştaki/sondaki boşlukları temizler.
 * @param {unknown} payload Ayrıştırılmış JSON gövdesi.
 * @returns {string} Kırpılmış, 1..500 karakter arası geçerli not metni.
 * @throws {ApiError} Bilinmeyen alan, kontrol karakteri veya uzunluk ihlalinde 400 VALIDATION_ERROR fırlatır.
 */
export function validateRecordNoteBody(payload) {
    requireOnlyKeys(payload, RECORD_NOTE_ALLOWED_KEYS);
    if (typeof payload.body !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Not metni geçerli bir yazı olmalıdır.');
    }
    const normalized = payload.body.replace(/\r\n/g, '\n');
    if (DISALLOWED_CONTROL_CHAR_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Not metninde geçersiz kontrol karakteri bulunamaz.');
    }
    const trimmed = normalized.trim();
    const charLength = [...trimmed].length;
    if (charLength < 1 || charLength > RECORD_NOTE_MAX_BODY_LENGTH) {
        throw new ApiError(400, 'VALIDATION_ERROR', `Not metni 1 ile ${RECORD_NOTE_MAX_BODY_LENGTH} karakter arasında olmalıdır.`);
    }
    return trimmed;
}

/**
 * Saklanan not satırını GET yanıtındaki harita öğesi biçimine dönüştürür.
 * @param {{body: string, updated_at: string, updated_by_name?: string|null}} row Veritabanı satırı.
 * @returns {{body: string, updated_at: string, updated_by_name: string|null}} Personel için güvenli not özeti.
 */
export function createStaffRecordNoteItemDto(row) {
    return {
        body: row.body,
        updated_at: row.updated_at,
        updated_by_name: row.updated_by_name ?? null
    };
}

/**
 * Saklanan not satırını PUT yanıtındaki tam not biçimine dönüştürür.
 * @param {{record_id: string, record_kind: string, body: string, updated_at: string, updated_by_name?: string|null}} row Veritabanı satırı.
 * @returns {{id: string, kind: string, body: string, updated_at: string, updated_by_name: string|null}} Personel için güvenli not DTO'su.
 */
export function createStaffRecordNoteDto(row) {
    return {
        id: row.record_id,
        kind: row.record_kind,
        body: row.body,
        updated_at: row.updated_at,
        updated_by_name: row.updated_by_name ?? null
    };
}
