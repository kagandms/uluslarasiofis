import { calculateUnder18, isPlausibleBirthDate, readIstanbulDate } from '../../shared/age.js';
import { isValidPhoneNumber, normalizePhoneNumber } from '../../shared/phoneNumber.js';
import { normalizeStudentNumber } from '../repositories/d1/studentRepository.js';
import { ApiError } from './errors.js';

export const MAX_EDITABLE_FIELDS_PER_REQUEST = 12;

export const EDITABLE_APPLICATION_STATUSES = Object.freeze([
    'submitted',
    'under_review',
    'resubmission_required',
    'approved_for_processing',
    'sent_to_migration',
    'migration_approved'
]);

export const TRANSITION_ONLY_FIELDS = Object.freeze([
    'transition_foreign_id',
    'transition_card_serial',
    'transition_card_number'
]);

export const STAFF_EDITABLE_FIELD_COLUMNS = Object.freeze({
    first_name: 'first_name',
    last_name: 'last_name',
    email: 'student_email',
    phone: 'student_phone',
    passport_number: 'passport_number',
    nationality: 'nationality',
    date_of_birth: 'date_of_birth',
    residence_application_date: 'residence_application_date',
    transition_foreign_id: 'transition_foreign_id',
    transition_card_serial: 'transition_card_serial',
    transition_card_number: 'transition_card_number'
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_NUMBER_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const PASSPORT_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{0,63}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// C0/C1 kontrol karakterleri ile görünmez Unicode biçim karakterlerini (ör. ZWSP, BOM, bidi) reddeder.
const DISALLOWED_CONTROL_OR_FORMAT_PATTERN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;
const TOP_LEVEL_KEYS = Object.freeze(['lock_version', 'fields']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireCleanString(value, { min = 1, max = 255, message = 'Başvuru bilgilerini kontrol edip tekrar deneyin.' } = {}) {
    if (typeof value !== 'string' || DISALLOWED_CONTROL_OR_FORMAT_PATTERN.test(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', message);
    }
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) {
        throw new ApiError(400, 'VALIDATION_ERROR', message);
    }
    return trimmed;
}

function isValidCalendarDate(value) {
    const match = DATE_PATTERN.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function validateStudentNumberField(value) {
    const normalized = requireCleanString(value, {
        max: 64,
        message: 'Öğrenci numarasını kontrol edip tekrar deneyin.'
    }).toLocaleUpperCase('en-US');
    if (!STUDENT_NUMBER_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarasını kontrol edip tekrar deneyin.');
    }
    return normalized;
}

function validateNameField(value) {
    const trimmed = requireCleanString(value, {
        max: 255,
        message: 'Ad ve soyad alanlarını kontrol edip tekrar deneyin.'
    });
    if (/\p{N}/u.test(trimmed) || !/\p{L}/u.test(trimmed)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Ad ve soyad yalnızca geçerli harf karakterleri içerebilir.');
    }
    return trimmed;
}

function validateEmailField(value) {
    const trimmed = requireCleanString(value, {
        max: 254,
        message: 'E-posta adresini kontrol edip tekrar deneyin.'
    });
    if (!EMAIL_PATTERN.test(trimmed)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    }
    return trimmed;
}

function validatePhoneField(value) {
    if (typeof value !== 'string' || DISALLOWED_CONTROL_OR_FORMAT_PATTERN.test(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Telefon numarasını kontrol edip tekrar deneyin.');
    }
    const normalized = normalizePhoneNumber(value);
    const digitCount = normalized.match(/\d/g)?.length || 0;
    if (normalized.length < 1 || normalized.length > 25 || digitCount > 15 || !isValidPhoneNumber(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Telefon numarasını kontrol edip tekrar deneyin.');
    }
    return normalized;
}

function validatePassportField(value) {
    const normalized = requireCleanString(value, {
        max: 64,
        message: 'Pasaport numarasını kontrol edip tekrar deneyin.'
    }).toLocaleUpperCase('en-US');
    if (!PASSPORT_NUMBER_PATTERN.test(normalized)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Pasaport numarasını kontrol edip tekrar deneyin.');
    }
    return normalized;
}

function validateNationalityField(value) {
    return requireCleanString(value, {
        max: 255,
        message: 'Uyruk bilgisini kontrol edip tekrar deneyin.'
    });
}

function validateDateOfBirthField(value, today) {
    const trimmed = requireCleanString(value, {
        max: 10,
        message: 'Doğum tarihini kontrol edip tekrar deneyin.'
    });
    if (!isPlausibleBirthDate(trimmed, today)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Doğum tarihini kontrol edip tekrar deneyin.');
    }
    return trimmed;
}

function validateResidenceApplicationDateField(value, today) {
    const trimmed = requireCleanString(value, {
        max: 10,
        message: 'İkamet başvuru tarihini kontrol edip tekrar deneyin.'
    });
    if (!isValidCalendarDate(trimmed) || trimmed > today) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İkamet başvuru tarihini kontrol edip tekrar deneyin.');
    }
    return trimmed;
}

function validateTransitionTextField(value) {
    return requireCleanString(value, {
        max: 255,
        message: 'Geçiş başvuru bilgilerini kontrol edip tekrar deneyin.'
    });
}

const FIELD_VALIDATORS = Object.freeze({
    student_number: (value) => validateStudentNumberField(value),
    first_name: (value) => validateNameField(value),
    last_name: (value) => validateNameField(value),
    email: (value) => validateEmailField(value),
    phone: (value) => validatePhoneField(value),
    passport_number: (value) => validatePassportField(value),
    nationality: (value) => validateNationalityField(value),
    date_of_birth: (value, today) => validateDateOfBirthField(value, today),
    residence_application_date: (value, today) => validateResidenceApplicationDateField(value, today),
    transition_foreign_id: (value) => validateTransitionTextField(value),
    transition_card_serial: (value) => validateTransitionTextField(value),
    transition_card_number: (value) => validateTransitionTextField(value)
});

function readStoredNormalizedStudentNumber(studentNumber) {
    if (typeof studentNumber !== 'string' || !studentNumber.trim()) return '';
    try {
        return normalizeStudentNumber(studentNumber);
    } catch {
        return studentNumber.trim().toLocaleUpperCase('en-US');
    }
}

/**
 * Personel alan düzeltme isteğinin gövdesini doğrular ve izin verilen alanları normalize eder.
 * @param {unknown} body Ayrıştırılmış JSON istek gövdesi.
 * @param {{today?: string}} [options] İsteğe bağlı İstanbul takvim tarihi (YYYY-MM-DD).
 * @returns {{lockVersion: number, validatedFields: Record<string, string>}} Doğrulanmış kilit sürümü ve alanlar.
 * @throws {ApiError} Gövde yapısı, kilit sürümü veya alan değerleri geçersizse 400 VALIDATION_ERROR fırlatır.
 */
export function validateStaffApplicationFieldEditBody(body, { today = readIstanbulDate() } = {}) {
    if (!isPlainObject(body)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
    }
    const topLevelKeys = Object.keys(body);
    if (topLevelKeys.length !== TOP_LEVEL_KEYS.length
        || TOP_LEVEL_KEYS.some((key) => !Object.hasOwn(body, key))
        || topLevelKeys.some((key) => !TOP_LEVEL_KEYS.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İstek alanlarını kontrol edip tekrar deneyin.');
    }
    if (!Number.isSafeInteger(body.lock_version) || body.lock_version < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru sürüm bilgisini kontrol edip tekrar deneyin.');
    }
    if (!isPlainObject(body.fields)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Güncellenecek başvuru alanlarını kontrol edip tekrar deneyin.');
    }

    const fieldKeys = Object.keys(body.fields);
    if (fieldKeys.length < 1 || fieldKeys.length > MAX_EDITABLE_FIELDS_PER_REQUEST) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Güncellenecek alan sayısı 1 ile 12 arasında olmalıdır.');
    }

    const validatedFields = {};
    for (const key of fieldKeys) {
        if (!Object.hasOwn(FIELD_VALIDATORS, key)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Bu alan bu işlemle düzenlenemez.');
        }
        validatedFields[key] = FIELD_VALIDATORS[key](body.fields[key], today);
    }

    return {
        lockVersion: body.lock_version,
        validatedFields
    };
}

/**
 * Doğrulanmış alan düzeltmelerini mevcut başvuru kaydına göre denetler ve değişim planı üretir.
 * @param {{application: object, validatedFields: Record<string, string>, today?: string}} input Başvuru satırı ve doğrulanmış alanlar.
 * @returns {{changedFields: string[], studentNumber: string|null, applicationChanges: Record<string, string>}} Kalıcılık planı.
 * @throws {ApiError} Rota uyumsuzluğu veya 18 yaş belge politikası değişikliğinde 409, tarih çelişkisinde 400 fırlatır.
 */
export function planStaffApplicationFieldChanges({ application, validatedFields, today = readIstanbulDate() }) {
    if (application.application_route !== 'transition'
        && TRANSITION_ONLY_FIELDS.some((field) => Object.hasOwn(validatedFields, field))) {
        throw new ApiError(409, 'FIELD_NOT_APPLICABLE', 'Geçiş alanları yalnızca geçiş başvurularında düzenlenebilir.');
    }

    const changedFields = [];
    const applicationChanges = {};
    let studentNumber = null;

    for (const [field, nextValue] of Object.entries(validatedFields)) {
        if (field === 'student_number') {
            if (readStoredNormalizedStudentNumber(application.student_number) !== nextValue) {
                changedFields.push('student_number');
                studentNumber = nextValue;
            }
            continue;
        }
        const column = STAFF_EDITABLE_FIELD_COLUMNS[field];
        const currentValue = application[column] ?? null;
        if (currentValue !== nextValue) {
            changedFields.push(field);
            applicationChanges[column] = nextValue;
        }
    }

    changedFields.sort();

    if (changedFields.includes('date_of_birth') || changedFields.includes('residence_application_date')) {
        const effectiveDateOfBirth = Object.hasOwn(validatedFields, 'date_of_birth')
            ? validatedFields.date_of_birth
            : application.date_of_birth;
        const effectiveResidenceDate = Object.hasOwn(validatedFields, 'residence_application_date')
            ? validatedFields.residence_application_date
            : application.residence_application_date;

        if (effectiveDateOfBirth && effectiveResidenceDate && effectiveResidenceDate < effectiveDateOfBirth) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'İkamet başvuru tarihi doğum tarihinden önce olamaz.');
        }

        const recalculatedUnder18 = calculateUnder18(effectiveDateOfBirth, effectiveResidenceDate || today);
        const currentUnder18 = application.is_under_18 === null || application.is_under_18 === undefined
            ? null
            : (application.is_under_18 === 1 || application.is_under_18 === true);

        if (recalculatedUnder18 !== null && recalculatedUnder18 !== currentUnder18) {
            throw new ApiError(
                409,
                'POLICY_FIELD_CHANGE_BLOCKED',
                'Bu değişiklik 18 yaş durumunu değiştirir ve belge listesini etkiler; bu alan için ayrı onay gerekir.'
            );
        }
    }

    return {
        changedFields,
        studentNumber,
        applicationChanges
    };
}
