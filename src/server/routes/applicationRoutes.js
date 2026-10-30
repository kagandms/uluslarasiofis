import { ACCOMMODATION_TYPES, DOCUMENT_ANSWER_FIELDS, DOCUMENT_ANSWER_OPTIONS } from '../../shared/document-conditions.js';
import { ApiError, ApplicationConflictError } from '../domain/errors.js';
import { APPLICATION_OWNER_SESSION_DAYS, CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../../config/constants.js';
import { createOpaqueSessionToken, createSessionCookie, createExpiredSessionCookie, getSessionCookieName, hashSessionToken, readCookie } from '../auth/sessionToken.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { constantTimeCompare, generateAccessCode, hashAccessCode, isValidAccessCodeFormat, isValidApplicationReference, normalizeApplicationReference, verifyAccessCode } from '../auth/applicationAccessCode.js';
import { requireStaff } from '../auth/staffAuth.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { APPLICATION_CREATE_RATE_LIMIT } from '../security/application-rate-limits.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { normalizeStudentNumber } from '../repositories/d1/studentRepository.js';
import { isValidPhoneNumber } from '../../shared/phoneNumber.js';
import { calculateUnder18, readIstanbulDate, requiresResidenceApplicationDate } from '../../shared/age.js';
import { CURRENT_ACADEMIC_YEAR_START_DATE } from '../../shared/academic-calendar.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { readSubmissionReadiness } from '../services/submissionReadiness.js';
import { listApplicationDocumentPolicies } from '../domain/documentPolicy.js';
import { createAuditEvent, createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';
import { DEFAULT_APPLICATION_PRIVACY_NOTICE } from '../domain/applicationPrivacyNotice.js';

const APPLICATION_SESSION_SECONDS = APPLICATION_OWNER_SESSION_DAYS * 24 * 60 * 60;
const APPLICATION_TYPE_VALUES = new Set(['initial', 'renewal', 'transition']);
const ADDRESS_EVIDENCE_VALUES = new Set(['rental_contract', 'residence_certificate', 'undertaking']);
const APPLICATION_PRIVACY_NOTICE_LOCALES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);
const DRAFT_FIELDS = Object.freeze({
    first_name: 'firstName',
    last_name: 'lastName',
    passport_number: 'passportNumber',
    nationality: 'nationality',
    student_email: 'studentEmail',
    student_phone: 'studentPhone',
    transition_foreign_id: 'transitionForeignId',
    transition_card_serial: 'transitionCardSerial',
    transition_card_number: 'transitionCardNumber',
    transition_contact_preference: 'transitionContactPreference'
});

function readApplicationType(applicationType) {
    if (!APPLICATION_TYPE_VALUES.has(applicationType)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türünü kontrol edip tekrar deneyin.');
    }
    return applicationType === 'transition'
        ? { applicationType: 'renewal', applicationRoute: 'transition' }
        : { applicationType, applicationRoute: 'standard' };
}

function requireString(body, name, { min = 1, max = 255 } = {}) {
    const value = body[name];
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
    }
    return value.trim();
}

function countPhoneDigits(phone) {
    return phone.match(/\d/g)?.length || 0;
}

function readDeclarationVersion(environment) {
    const version = environment.PUBLIC_DECLARATION_VERSION || 'student-information-accuracy-v1';
    if (typeof version === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(version)) return version;
    throw new ApiError(503, 'DECLARATION_CONFIGURATION_UNAVAILABLE', 'Başvuru onay bilgisi şu anda kullanılamıyor.', true);
}

function readConfiguredApplicationPrivacyNotice(environment) {
    let configuredNotice = environment.PUBLIC_APPLICATION_PRIVACY_NOTICE;
    if (configuredNotice === undefined || configuredNotice === null || configuredNotice === '') {
        return DEFAULT_APPLICATION_PRIVACY_NOTICE;
    }
    if (typeof configuredNotice === 'string') {
        try {
            configuredNotice = JSON.parse(configuredNotice);
        } catch {
            return null;
        }
    }
    if (!configuredNotice || typeof configuredNotice !== 'object' || Array.isArray(configuredNotice)) return null;
    const { version, content_by_locale: contentByLocale } = configuredNotice;
    if (typeof version !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(version)
        || !contentByLocale || typeof contentByLocale !== 'object' || Array.isArray(contentByLocale)) return null;
    const hasEveryLocale = APPLICATION_PRIVACY_NOTICE_LOCALES.every((locale) => {
        const content = contentByLocale[locale];
        return typeof content === 'string' && content.trim().length > 0 && content.length <= 20000;
    });
    if (!hasEveryLocale) return null;
    return {
        version,
        content_by_locale: Object.fromEntries(APPLICATION_PRIVACY_NOTICE_LOCALES.map((locale) => [locale, contentByLocale[locale]]))
    };
}

/**
 * Returns the currently configured five-language privacy notice without recording a user acknowledgement.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {object} Public notice payload or an unavailable marker.
 * @throws {ApiError} When the request method is invalid.
 */
export function readApplicationPrivacyNotice(request, environment) {
    requireMethod(request, 'GET');
    const notice = readConfiguredApplicationPrivacyNotice(environment);
    return notice ? { available: true, ...notice } : { available: false };
}

function createApplicationDto(application, environment) {
    const currentDeclarationVersion = readDeclarationVersion(environment);
    const isTransitionApplication = application.application_route === 'transition';
    return {
        reference_number: application.reference_number ?? null,
        lock_version: application.lock_version ?? 1,
        status: application.status,
        submitted_at: application.submitted_at ?? null,
        application_type: application.application_route === 'transition' ? 'transition' : application.application_type,
        address_evidence_type: application.accommodation_type || application.address_evidence_type || null,
        document_policy_version: application.document_policy_version,
        ...Object.fromEntries(DOCUMENT_ANSWER_FIELDS.map((field) => [field, application[field] ?? null])),
        student_number: application.student_number,
        student_email: application.student_email,
        student_phone: application.student_phone,
        first_name: application.first_name,
        last_name: application.last_name,
        passport_number: application.passport_number,
        nationality: application.nationality,
        date_of_birth: application.date_of_birth,
        residence_application_date: application.residence_application_date ?? null,
        academic_year_start_date: application.academic_year_start_date ?? null,
        transition_foreign_id: isTransitionApplication ? application.transition_foreign_id ?? '' : '',
        transition_card_serial: isTransitionApplication ? application.transition_card_serial ?? '' : '',
        transition_card_number: isTransitionApplication ? application.transition_card_number ?? '' : '',
        transition_contact_preference: isTransitionApplication ? application.transition_contact_preference ?? null : null,
        transition_change_province: isTransitionApplication ? application.transition_change_province ?? null : null,
        is_under_18: application.is_under_18,
        fingerprint_status: application.fingerprint_status ?? null,
        fingerprint_code: application.fingerprint_code ?? null,
        contact_acknowledgement: {
            current_version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
            accepted_version: application.contact_acknowledgement_accepted_current
                ? CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION : null,
            accepted_at: application.contact_acknowledgement_accepted_at ?? null,
            accepted_current: Boolean(application.contact_acknowledgement_accepted_current)
        },
        declaration: {
            current_version: currentDeclarationVersion,
            content_key: 'studentInformationAcknowledgement',
            accepted_version: application.declaration_version ?? null,
            accepted_at: application.declaration_accepted_at ?? null,
            accepted_current: Boolean(application.declaration_accepted_at)
                && application.declaration_version === currentDeclarationVersion
        }
    };
}

function readNewDraft(body) {
    const studentNumber = requireString(body, 'student_number', { max: 64 });
    const applicationType = readApplicationType(body.application_type);
    const studentEmail = requireString(body, 'email', { max: 254 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    const studentPhone = requireString(body, 'phone', { max: 25 });
    if (countPhoneDigits(studentPhone) > 15) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Telefon numarası en fazla 15 rakam içerebilir.');
    }
    return { studentNumber, ...applicationType, studentEmail, studentPhone };
}

async function persistDraftWithSession(repositories, draft, requestId) {
    const token = createOpaqueSessionToken();
    const accessCode = generateAccessCode();
    const accessCodeHash = await hashAccessCode(accessCode);
    const createdAt = new Date().toISOString();
    try {
        const application = await repositories.applications.createDraftWithSession({
            ...draft,
            applicationId: crypto.randomUUID(),
            studentId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
            auditEventId: crypto.randomUUID(),
            requestId,
            accessCodeHash,
            tokenHash: await hashSessionToken(token),
            expiresAt: new Date(Date.parse(createdAt) + APPLICATION_SESSION_SECONDS * 1000).toISOString(),
            createdAt
        });
        return { application, token, accessCode };
    } catch (error) {
        if (error instanceof ApplicationConflictError) throw new ApiError(409, error.code, 'Bu öğrenci için zaten etkin bir başvuru bulunuyor.');
        throw error;
    }
}

function readFingerprintStatus(value) {
    if (value === null) return null;
    if (value === 'registered' || value === 'not_registered') return value;
    throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
}

function readFingerprintCode(value) {
    if (value === null) return null;
    if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
    const code = value.trim();
    if (code.length > 128 || /[\u0000-\u001f\u007f]/u.test(code)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
    }
    return code || null;
}

function readOptionalApplicationDate(value) {
    if (value === '' || value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru tarihlerini kontrol edip tekrar deneyin.');
    }
    const parsedDate = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== value
        || value > readIstanbulDate()) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru tarihlerini kontrol edip tekrar deneyin.');
    }
    return value;
}

function readDocumentAnswerChanges(body) {
    const changes = {};
    for (const field of DOCUMENT_ANSWER_FIELDS) {
        if (!Object.hasOwn(body, field)) continue;
        if (body[field] !== null && !DOCUMENT_ANSWER_OPTIONS[field].includes(body[field])) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Belge koşullarına ait yanıtları kontrol edin.');
        }
        const repositoryField = field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        changes[repositoryField] = body[field];
    }
    return changes;
}

function readDraftChanges(body, application, { allowIncomplete = false } = {}) {
    const changes = readDocumentAnswerChanges(body);
    for (const [field, repositoryField] of Object.entries(DRAFT_FIELDS)) {
        if (!Object.hasOwn(body, field)) continue;
        const value = requireString(body, field, {
            min: allowIncomplete ? 0 : 1,
            max: field === 'student_email' ? 254 : (field === 'student_phone' ? 25 : 255)
        });
        if (field === 'student_phone' && countPhoneDigits(value) > 15) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Telefon numarası en fazla 15 rakam içerebilir.');
        }
        changes[repositoryField] = value;
    }
    if (Object.hasOwn(body, 'transition_change_province')) {
        if (body.transition_change_province !== null && !['yes', 'no'].includes(body.transition_change_province)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Geçiş başvuru bilgilerini kontrol edip tekrar deneyin.');
        }
        changes.transitionChangeProvince = body.transition_change_province;
    }
    if (Object.hasOwn(body, 'transition_contact_preference')) {
        if (body.transition_contact_preference !== null && !['email', 'phone'].includes(body.transition_contact_preference)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Geçiş iletişim tercihini kontrol edip tekrar deneyin.');
        }
        changes.transitionContactPreference = body.transition_contact_preference;
    }
    if (Object.hasOwn(body, 'residence_application_date')) {
        changes.residenceApplicationDate = readOptionalApplicationDate(body.residence_application_date);
    }
    if (Object.hasOwn(body, 'application_type')) {
        Object.assign(changes, readApplicationType(body.application_type));
    }
    if ((changes.insuranceBasis ?? application.insurance_basis) === 'gss_pending') {
        changes.academicYearStartDate = CURRENT_ACADEMIC_YEAR_START_DATE;
    }
    const targetRoute = changes.applicationRoute ?? application.application_route ?? 'standard';
    if (targetRoute !== 'transition') {
        changes.transitionForeignId = null;
        changes.transitionCardSerial = null;
        changes.transitionCardNumber = null;
        changes.transitionContactPreference = null;
        changes.transitionChangeProvince = null;
    }
    if (Object.hasOwn(body, 'address_evidence_type')) {
        if (body.address_evidence_type !== null && ![...ADDRESS_EVIDENCE_VALUES, ...ACCOMMODATION_TYPES].includes(body.address_evidence_type)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Adres belgesi seçimini kontrol edip tekrar deneyin.');
        }
        changes.addressEvidenceType = ADDRESS_EVIDENCE_VALUES.has(body.address_evidence_type) ? body.address_evidence_type : null;
        changes.accommodationType = ACCOMMODATION_TYPES.includes(body.address_evidence_type) ? body.address_evidence_type : null;
    }
    if (Object.hasOwn(body, 'is_under_18')) {
        if (body.is_under_18 !== null && typeof body.is_under_18 !== 'boolean') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
        }
        changes.isUnder18 = body.is_under_18 === null ? null : (body.is_under_18 ? 1 : 0);
    }
    if (Object.hasOwn(body, 'date_of_birth')) {
        changes.dateOfBirth = requireString(body, 'date_of_birth', { min: allowIncomplete ? 0 : 1, max: 255 });
    }
    if (Object.hasOwn(body, 'date_of_birth') || Object.hasOwn(body, 'residence_application_date') || Object.hasOwn(body, 'is_under_18')) {
        const birthDate = Object.hasOwn(changes, 'dateOfBirth') ? changes.dateOfBirth : application.date_of_birth;
        const residenceApplicationDate = Object.hasOwn(changes, 'residenceApplicationDate')
            ? changes.residenceApplicationDate : application.residence_application_date;
        const ageDateIsRequired = requiresResidenceApplicationDate(birthDate);
        const under18 = calculateUnder18(birthDate, residenceApplicationDate || readIstanbulDate());
        if (under18 === null && !allowIncomplete) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Doğum tarihi ve e-İkamet başvuru tarihini kontrol edip tekrar deneyin.');
        }
        if (ageDateIsRequired && !residenceApplicationDate && !allowIncomplete) {
            throw new ApiError(400, 'VALIDATION_ERROR', '18 yaş hesabı için e-İkamet başvuru tarihini girin.');
        }
        changes.isUnder18 = under18 === null ? null : (under18 ? 1 : 0);
    }
    const fingerprintStatus = Object.hasOwn(body, 'fingerprint_status')
        ? readFingerprintStatus(body.fingerprint_status)
        : application.fingerprint_status;
    if (Object.hasOwn(body, 'fingerprint_status')) changes.fingerprintStatus = fingerprintStatus;
    if (Object.hasOwn(body, 'fingerprint_code')) {
        const submittedCode = readFingerprintCode(body.fingerprint_code);
        changes.fingerprintCode = fingerprintStatus === 'registered' ? submittedCode : null;
    }
    if (Object.hasOwn(body, 'fingerprint_status') && fingerprintStatus !== 'registered') {
        changes.fingerprintCode = null;
    }
    if (!allowIncomplete && Object.hasOwn(changes, 'studentEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.studentEmail)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    }
    if (Object.keys(changes).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Güncellenecek başvuru bilgisi gerekli.');
    return changes;
}

/**
 * Creates a rate-limited draft and binds it to a hashed opaque applicant session.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation ID for the audit event.
 * @returns {Promise<object>} Route result with a student-safe DTO and session cookie.
 * @throws {ApiError} When request, applicant data, rate limit, or active-app rule fails.
 */
export async function createApplicationDraft(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const notice = readConfiguredApplicationPrivacyNotice(environment);
    if (!notice) {
        throw new ApiError(503, 'APPLICATION_PRIVACY_NOTICE_UNAVAILABLE', 'Yeni başvuru şu anda kullanılamıyor.', true);
    }
    const body = await readJsonBody(request);
    if (body.privacy_notice_version !== notice.version) {
        throw new ApiError(409, 'APPLICATION_PRIVACY_NOTICE_VERSION_CONFLICT', 'Başvuru bilgilendirme metni güncellendi. Lütfen sayfayı yenileyin.');
    }
    const draft = readNewDraft(body);
    const repositories = createRepositories(environment);
    await enforceRateLimit(repositories, request, APPLICATION_CREATE_RATE_LIMIT);
    const { application, token, accessCode } = await persistDraftWithSession(repositories, draft, requestId);
    return routeResult({
        application: createApplicationDto(application, environment),
        reference_number: application.reference_number,
        access_code: accessCode
    }, {
        status: 201, cookie: createSessionCookie('application', token, APPLICATION_SESSION_SECONDS)
    });
}

/**
 * Reads the applicant's current draft through its opaque session cookie.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Student-safe application data.
 * @throws {ApiError} When the request method or applicant session is invalid.
 */
export async function readCurrentApplication(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const application = await createD1Repositories(environment.DB).applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    return { application: createApplicationDto(application, environment) };
}

/**
 * Updates only the allowlisted fields of the applicant's current draft.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation ID for the audit event.
 * @returns {Promise<object>} Updated student-safe application data.
 * @throws {ApiError} When the session, state, or input is invalid.
 */
async function updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete }) {
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    if (session.status !== 'draft') throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    const repositories = createRepositories(environment);
    const currentApplication = await repositories.applications.findById(session.application_id);
    if (!currentApplication) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const body = await readJsonBody(request);
    if (!Number.isSafeInteger(body.lock_version) || body.lock_version < 1) {
        throw new ApiError(400, 'LOCK_VERSION_REQUIRED', 'Güncel başvuru sürümü gerekli. Sayfayı yenileyip tekrar deneyin.');
    }
    let expectedLockVersion = body.lock_version;
    let renumberedApplication = null;
    if (Object.hasOwn(body, 'student_number')) {
        const submittedNumber = requireString(body, 'student_number', { min: 0, max: 64 });
        const isChanged = submittedNumber.length > 0
            && normalizeStudentNumber(submittedNumber) !== normalizeStudentNumber(currentApplication.student_number);
        if (submittedNumber.length === 0 && !allowIncomplete) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci numarasını kontrol edip tekrar deneyin.');
        }
        if (isChanged) {
            try {
                renumberedApplication = await repositories.applications.changeDraftStudentNumber({
                    applicationId: session.application_id, studentId: crypto.randomUUID(),
                    studentNumber: submittedNumber, expectedLockVersion, ownerSessionId: session.session_id
                });
            } catch (error) {
                if (error instanceof ApplicationConflictError) {
                    if (error.code === 'APPLICATION_UPDATE_CONFLICT') {
                        throw new ApiError(409, error.code, 'Başvurunuz başka bir cihaz veya sekmede güncellendi. Lütfen sayfayı yenileyip en güncel bilgileri kontrol edin.');
                    }
                    throw new ApiError(409, error.code, 'Bu öğrenci numarası için zaten etkin bir başvuru bulunuyor.');
                }
                throw error;
            }
            if (!renumberedApplication) throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
            expectedLockVersion = renumberedApplication.lock_version;
            await createAuditEvent(repositories, {
                eventType: 'application.draft_updated', actorType: 'student', applicationId: session.application_id,
                requestId, metadata: { changedFields: 'studentNumber' }
            });
        }
    }
    const otherKeys = Object.keys(body).filter((key) => !['lock_version', 'student_number'].includes(key));
    if (otherKeys.length === 0) {
        if (!Object.hasOwn(body, 'student_number')) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Güncellenecek başvuru bilgisi gerekli.');
        }
        const unchanged = renumberedApplication || currentApplication;
        return { application: createApplicationDto(unchanged, environment) };
    }
    const changes = readDraftChanges(body, renumberedApplication || currentApplication, { allowIncomplete });
    const passportNumber = changes.passportNumber ?? (renumberedApplication || currentApplication).passport_number;
    const dateOfBirth = changes.dateOfBirth ?? (renumberedApplication || currentApplication).date_of_birth;
    if (await repositories.applications.hasOtherActiveApplicationForPassportIdentity(
        passportNumber, dateOfBirth, session.application_id
    )) {
        throw new ApiError(409, 'PASSPORT_IDENTITY_ALREADY_ACTIVE', 'Bu pasaport bilgileriyle etkin bir başvuru bulunuyor. Öğrenci numaranızı kontrol edin veya mevcut başvurunuza giriş yapın.');
    }
    let application;
    try {
        application = await repositories.applications.updateDraft(session.application_id, changes, {
            auditEventId: crypto.randomUUID(), requestId, ownerSessionId: session.session_id
        }, expectedLockVersion);
    } catch (error) {
        if (error.code === 'APPLICATION_TYPE_CHANGE_BLOCKED') {
            throw new ApiError(409, error.code, 'Başvuru türü, mevcut belge geçmişi güvenle korunamadığı için değiştirilemedi.');
        }
        if (error.code === 'APPLICATION_UPDATE_CONFLICT') {
            throw new ApiError(409, error.code, 'Başvurunuz başka bir cihaz veya sekmede güncellendi. Lütfen sayfayı yenileyip en güncel bilgileri kontrol edin.');
        }
        throw error;
    }
    if (!application) throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    await createAuditEvent(repositories, {
        eventType: 'application.draft_updated', actorType: 'student', applicationId: session.application_id,
        requestId, metadata: { changedFields: Object.keys(changes).sort().join(',') }
    });
    return { application: createApplicationDto(application, environment) };
}

/**
 * Saves a validated patch of the current applicant's draft.
 * @param {Request} request Owner-session request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation identifier.
 * @returns {Promise<object>} Student-safe updated application.
 */
export async function updateCurrentApplication(request, environment, requestId) {
    requireMethod(request, 'PATCH');
    return updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete: false });
}

/**
 * Saves an incomplete draft patch while the student is still editing a field.
 * @param {Request} request Owner-session request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation identifier.
 * @returns {Promise<object>} Student-safe updated application.
 */
export async function autosaveCurrentApplication(request, environment, requestId) {
    requireMethod(request, 'PATCH');
    return updateCurrentApplicationFields(request, environment, requestId, { allowIncomplete: true });
}

/**
 * Accepts the current configurable acknowledgement and records its server timestamp atomically with audit.
 * @param {Request} request Owner-session request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation identifier.
 * @returns {Promise<object>} Student-safe accepted application DTO.
 * @throws {ApiError} When ownership, origin, draft status, or current version validation fails.
 */
export async function acceptCurrentApplicationDeclaration(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    if (session.status !== 'draft') throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    const body = await readJsonBody(request);
    if (Object.keys(body).some((key) => !['accepted', 'version'].includes(key))
        || body.accepted !== true || typeof body.version !== 'string') {
        throw new ApiError(400, 'DECLARATION_ACCEPTANCE_REQUIRED', 'Devam etmek için başvuru bilgilendirmesini onaylayın.');
    }
    const currentVersion = readDeclarationVersion(environment);
    if (body.version !== currentVersion) {
        throw new ApiError(409, 'DECLARATION_VERSION_CONFLICT', 'Başvuru bilgilendirmesi güncellendi. Lütfen yeniden okuyup onaylayın.');
    }
    const repositories = createRepositories(environment);
    const application = await repositories.applications.acceptDeclaration({
        applicationId: session.application_id,
        version: currentVersion,
        acceptedAt: new Date().toISOString(),
        auditEventId: crypto.randomUUID(),
        requestId
    });
    if (!application) throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    return { application: createApplicationDto(application, environment) };
}

/**
 * Records an explicit, current-version contact responsibility acknowledgement for the draft.
 * @param {Request} request Owner-session request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation identifier.
 * @returns {Promise<object>} Student-safe application with the persisted acknowledgement state.
 * @throws {ApiError} When origin, session, draft state, contact details, or acknowledgement version is invalid.
 */
export async function acceptCurrentContactAcknowledgement(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    if (session.status !== 'draft') throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemiyor.');

    const body = await readJsonBody(request);
    if (Object.keys(body).some((key) => !['accepted', 'version'].includes(key))
        || body.accepted !== true || typeof body.version !== 'string') {
        throw new ApiError(400, 'CONTACT_ACKNOWLEDGEMENT_REQUIRED', 'İletişim sorumluluğu onayını kabul ederek devam edin.');
    }
    if (body.version !== CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION) {
        throw new ApiError(409, 'CONTACT_ACKNOWLEDGEMENT_VERSION_CONFLICT', 'İletişim onayı güncellendi. Lütfen metni yeniden okuyup kabul edin.');
    }

    const repositories = createRepositories(environment);
    await enforceRateLimit(repositories, request, {
        endpoint: 'contact-acknowledgement', maxRequests: 20, windowSeconds: 900
    });
    const currentApplication = await repositories.applications.findById(session.application_id);
    if (!currentApplication) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentApplication.student_email || '')
        || !isValidPhoneNumber(currentApplication.student_phone)) {
        throw new ApiError(400, 'CONTACT_INFORMATION_INCOMPLETE', 'Devam etmeden önce geçerli e-posta ve telefon bilgilerini girin.');
    }

    const acceptedAt = new Date().toISOString();
    const application = await repositories.applications.acceptContactResponsibilityAcknowledgement({
        applicationId: session.application_id,
        version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION,
        acceptedAt,
        requestId
    });
    if (!application) throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemiyor.');
    return { application: createApplicationDto(application, environment) };
}

/**
 * Revokes the applicant session and expires its cookie.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Route result with an expired applicant cookie.
 * @throws {ApiError} When method or request origin is invalid.
 */
export async function logoutApplication(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const token = readCookie(request, getSessionCookieName('application'));
    if (token && environment.DB) {
        await createD1Repositories(environment.DB).sessions.revokeApplicationSession(
            await hashSessionToken(token), new Date().toISOString()
        );
    }
    return routeResult({ success: true }, { cookie: createExpiredSessionCookie('application') });
}

/**
 * Returns the current session's student-safe application status.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Safe status DTO selected through the opaque owner session.
 * @throws {ApiError} When the applicant session is invalid or the application is missing.
 */
export async function readCurrentApplicationStatus(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const application = await createD1Repositories(environment.DB).applications.findCurrentStatusById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    return {
        application: {
            status: application.status,
            application_type: application.application_route === 'transition' ? 'transition' : application.application_type,
            updated_at: application.updated_at
        }
    };
}

/**
 * Submits the current owner-session application after server-side readiness validation.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @param {string} requestId Correlation ID for the submit audit event.
 * @returns {Promise<object>} Safe submitted application DTO if server readiness permits transition.
 * @throws {ApiError} When origin, session, state, or readiness validation fails.
 */
export async function submitCurrentApplication(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const repositories = createRepositories(environment);
    const application = await repositories.applications.findCurrentStatusById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    if (application.status !== 'draft') throw new ApiError(409, 'APPLICATION_NOT_SUBMITTABLE', 'Bu başvuru gönderim için uygun durumda değil.');

    const readiness = await readSubmissionReadiness(
        session.application_id,
        environment,
        readDeclarationVersion(environment)
    );
    if (readiness.status !== 'ready') {
        throw new ApiError(409, 'SUBMISSION_NOT_READY', 'Başvuru bilgileri ve gerekli belgeler tamamlanmadığı için gönderim yapılamıyor.');
    }

    const submitted = await repositories.applications.submitDraft({
        applicationId: session.application_id,
        expectedLockVersion: application.lock_version,
        ownerSessionId: session.session_id,
        requiredDocumentCodes: listApplicationDocumentPolicies(application)
            .filter((policy) => policy.required).map((policy) => policy.code),
        submittedAt: new Date().toISOString(),
        auditEventId: crypto.randomUUID(),
        requestId
    });
    if (!submitted) throw new ApiError(409, 'APPLICATION_NOT_SUBMITTABLE', 'Bu başvuru gönderim için uygun durumda değil.');
    return { application: createApplicationDto(submitted, environment) };
}

/** @param {object} input Failed credential request context. @returns {Promise<never>} Rejects without locking valid owners. @throws {ApiError} Invalid credentials or failed-attempt quota. */
async function rejectAccessCredentials({ repositories, request, referenceNumber }) {
    await enforceRateLimit(repositories, request, {
        endpoint: 'application-access-ip', maxRequests: 60, windowSeconds: 900
    });
    if (isValidApplicationReference(referenceNumber)) {
        const allowed = await consumePublicRateLimit(repositories.rateLimits, {
            endpoint: 'application-access-ref', identity: referenceNumber,
            nowSeconds: Math.floor(Date.now() / 1000), maxRequests: 5, windowSeconds: 900
        });
        if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Çok fazla hatalı deneme yapıldı. Daha sonra tekrar deneyin.', true);
    }
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Başvuru numarası veya öğrenci numarası hatalı.');
}

/**
 * Verifies application reference and student number, issuing a new owner session for another device.
 * Enforces rate limiting on both IP level (broad NAT tolerance) and reference level (strict anti-brute-force).
 * @param {Request} request Public JSON POST request.
 * @param {object} environment Cloudflare Worker bindings.
 * @param {string} requestId Correlation identifier.
 * @returns {Promise<object>} Route result with student-safe DTO and new session cookie.
 * @throws {ApiError} When input, rate limit, reference, or student number is invalid.
 */
export async function accessApplicationWithReference(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request);
    const rawRef = body.reference_number;
    const rawStudentNumber = body.student_number;
    const rawCode = body.access_code;

    if (!rawRef || typeof rawRef !== 'string' || (!rawStudentNumber && !rawCode)) {
        throw new ApiError(400, 'INVALID_INPUT', 'Başvuru numarası ve öğrenci numarası zorunludur.');
    }

    const repositories = createRepositories(environment);
    const referenceNumber = normalizeApplicationReference(rawRef);

    if (!isValidApplicationReference(referenceNumber)) {
        return rejectAccessCredentials({ repositories, request, referenceNumber });
    }

    let application = null;
    if (rawStudentNumber && typeof rawStudentNumber === 'string') {
        let submittedStudentNumber;
        try {
            submittedStudentNumber = normalizeStudentNumber(rawStudentNumber);
        } catch {
            return rejectAccessCredentials({ repositories, request, referenceNumber });
        }

        application = await repositories.applications.findByReferenceNumber(referenceNumber);
        if (!application
            || !constantTimeCompare(submittedStudentNumber, normalizeStudentNumber(application.student_number))) {
            return rejectAccessCredentials({ repositories, request, referenceNumber });
        }
    } else if (rawCode && typeof rawCode === 'string') {
        if (!isValidAccessCodeFormat(rawCode)) {
            return rejectAccessCredentials({ repositories, request, referenceNumber });
        }
        application = await repositories.applications.findByReferenceNumber(referenceNumber);
        if (!application || !application.access_code_hash) {
            await verifyAccessCode(rawCode, '0000000000000000000000000000000000000000000000000000000000000000');
            return rejectAccessCredentials({ repositories, request, referenceNumber });
        }
        const isValid = await verifyAccessCode(rawCode, application.access_code_hash);
        if (!isValid) {
            return rejectAccessCredentials({ repositories, request, referenceNumber });
        }
    } else {
        return rejectAccessCredentials({ repositories, request, referenceNumber });
    }

    // Success: create a fresh opaque session token for this device.
    const token = createOpaqueSessionToken();
    const createdAt = new Date().toISOString();
    const sessionCreated = await repositories.sessions.createApplicationSessionGuarded({
        id: crypto.randomUUID(),
        applicationId: application.id,
        tokenHash: await hashSessionToken(token),
        expiresAt: new Date(Date.parse(createdAt) + APPLICATION_SESSION_SECONDS * 1000).toISOString(),
        createdAt,
        expectedAccessCodeVersion: application.access_code_version
    });

    if (!sessionCreated) {
        return rejectAccessCredentials({ repositories, request, referenceNumber });
    }

    await createAuditEvent(repositories, {
        eventType: 'application.cross_device_access',
        actorType: 'student',
        applicationId: application.id,
        requestId,
        metadata: { referenceNumber: application.reference_number }
    });

    return routeResult({
        success: true,
        application: createApplicationDto(application, environment)
    }, {
        status: 200,
        cookie: createSessionCookie('application', token, APPLICATION_SESSION_SECONDS)
    });
}

export const accessApplicationWithCode = accessApplicationWithReference;

export async function regenerateCurrentAccessCode(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    if (['completed', 'cancelled', 'rejected'].includes(session.status)) {
        throw new ApiError(409, 'APPLICATION_TERMINAL', 'Sonuçlanmış başvurularda erişim kodu yenilenemez.');
    }

    const repositories = createRepositories(environment);
    await enforceRateLimit(repositories, request, {
        endpoint: 'application-regenerate-code', maxRequests: 3, windowSeconds: 900
    });

    const newCode = generateAccessCode();
    const newHash = await hashAccessCode(newCode);
    const now = new Date().toISOString();

    const updated = await repositories.applications.updateAccessCode({
        applicationId: session.application_id,
        accessCodeHash: newHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId,
        expectedAccessCodeVersion: session.access_code_version,
        ownerSessionId: session.session_id,
        actorType: 'student'
    });

    if (!updated) throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Erişim kodu güncellenemedi.');

    return {
        success: true,
        reference_number: updated.reference_number,
        access_code: newCode
    };
}

export async function resetStaffApplicationAccessCode({ request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, ['admin', 'reviewer']);
    const repositories = createRepositories(environment);

    const application = await repositories.applications.findById(applicationId);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');

    const newCode = generateAccessCode();
    const newHash = await hashAccessCode(newCode);
    const now = new Date().toISOString();

    const updated = await repositories.applications.updateAccessCode({
        applicationId,
        accessCodeHash: newHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId,
        expectedAccessCodeVersion: application.access_code_version,
        actorType: 'staff',
        actorStaffId: staff.id
    });

    if (!updated) throw new ApiError(409, 'ACCESS_CODE_ROTATION_CONFLICT', 'Başvuru veya erişim kodu değişti. Güncel durumu yeniden kontrol edin.');

    return {
        success: true,
        reference_number: updated.reference_number,
        access_code: newCode
    };
}
