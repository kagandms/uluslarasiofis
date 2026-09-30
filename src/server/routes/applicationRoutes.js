import { ApiError, ApplicationConflictError } from '../domain/errors.js';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../../config/constants.js';
import { createOpaqueSessionToken, createSessionCookie, createExpiredSessionCookie, getSessionCookieName, hashSessionToken, readCookie } from '../auth/sessionToken.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { isValidPhoneNumber } from '../../shared/phoneNumber.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { readSubmissionReadiness } from '../services/submissionReadiness.js';
import { createAuditEvent, createRepositories, enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

const APPLICATION_SESSION_SECONDS = 12 * 60 * 60;
const APPLICATION_TYPE_VALUES = new Set(['initial', 'renewal']);
const ADDRESS_EVIDENCE_VALUES = new Set(['rental_contract', 'residence_certificate', 'undertaking']);
const DRAFT_FIELDS = Object.freeze({
    first_name: 'firstName',
    last_name: 'lastName',
    passport_number: 'passportNumber',
    nationality: 'nationality',
    date_of_birth: 'dateOfBirth',
    student_email: 'studentEmail',
    student_phone: 'studentPhone'
});

function requireString(body, name, { min = 1, max = 255 } = {}) {
    const value = body[name];
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
    }
    return value.trim();
}

function readDeclarationVersion(environment) {
    const version = environment.PUBLIC_DECLARATION_VERSION || 'student-information-accuracy-v1';
    if (typeof version === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(version)) return version;
    throw new ApiError(503, 'DECLARATION_CONFIGURATION_UNAVAILABLE', 'Başvuru onay bilgisi şu anda kullanılamıyor.', true);
}

function createApplicationDto(application, environment) {
    const currentDeclarationVersion = readDeclarationVersion(environment);
    return {
        status: application.status,
        submitted_at: application.submitted_at ?? null,
        application_type: application.application_type,
        address_evidence_type: application.address_evidence_type ?? null,
        student_number: application.student_number,
        student_email: application.student_email,
        student_phone: application.student_phone,
        first_name: application.first_name,
        last_name: application.last_name,
        passport_number: application.passport_number,
        nationality: application.nationality,
        date_of_birth: application.date_of_birth,
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
    const applicationType = body.application_type;
    if (!APPLICATION_TYPE_VALUES.has(applicationType)) throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türünü kontrol edip tekrar deneyin.');
    const studentEmail = requireString(body, 'email', { max: 254 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) throw new ApiError(400, 'VALIDATION_ERROR', 'E-posta adresini kontrol edip tekrar deneyin.');
    return { studentNumber, applicationType, studentEmail, studentPhone: requireString(body, 'phone', { max: 40 }) };
}

async function persistDraftWithSession(repositories, draft, requestId) {
    const token = createOpaqueSessionToken();
    const createdAt = new Date().toISOString();
    try {
        const application = await repositories.applications.createDraftWithSession({
            ...draft,
            applicationId: crypto.randomUUID(),
            studentId: crypto.randomUUID(),
            sessionId: crypto.randomUUID(),
            auditEventId: crypto.randomUUID(),
            requestId,
            tokenHash: await hashSessionToken(token),
            expiresAt: new Date(Date.now() + APPLICATION_SESSION_SECONDS * 1000).toISOString(),
            createdAt
        });
        return { application, token };
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

function readDraftChanges(body, application, { allowIncomplete = false } = {}) {
    const changes = {};
    for (const [field, repositoryField] of Object.entries(DRAFT_FIELDS)) {
        if (Object.hasOwn(body, field)) changes[repositoryField] = requireString(body, field, {
            min: allowIncomplete ? 0 : 1,
            max: field === 'student_email' ? 254 : 255
        });
    }
    if (Object.hasOwn(body, 'application_type')) {
        if (!APPLICATION_TYPE_VALUES.has(body.application_type)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türünü kontrol edip tekrar deneyin.');
        }
        changes.applicationType = body.application_type;
    }
    if (Object.hasOwn(body, 'address_evidence_type')) {
        if (body.address_evidence_type !== null && !ADDRESS_EVIDENCE_VALUES.has(body.address_evidence_type)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Adres belgesi seçimini kontrol edip tekrar deneyin.');
        }
        changes.addressEvidenceType = body.address_evidence_type;
    }
    if (Object.hasOwn(body, 'is_under_18')) {
        if (body.is_under_18 !== null && typeof body.is_under_18 !== 'boolean') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru bilgilerini kontrol edip tekrar deneyin.');
        }
        changes.isUnder18 = body.is_under_18 === null ? null : (body.is_under_18 ? 1 : 0);
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
    const draft = readNewDraft(await readJsonBody(request));
    const repositories = createRepositories(environment);
    await enforceRateLimit(repositories, request, { endpoint: 'application-create', maxRequests: 5, windowSeconds: 900 });
    const { application, token } = await persistDraftWithSession(repositories, draft, requestId);
    return routeResult({ application: createApplicationDto(application, environment) }, {
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
    const changes = readDraftChanges(await readJsonBody(request), currentApplication, { allowIncomplete });
    let application;
    try {
        application = await repositories.applications.updateDraft(session.application_id, changes, {
            auditEventId: crypto.randomUUID(), requestId
        });
    } catch (error) {
        if (error.code === 'APPLICATION_TYPE_CHANGE_BLOCKED') {
            throw new ApiError(409, error.code, 'Başvuru türü, mevcut belge geçmişi güvenle korunamadığı için değiştirilemedi.');
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
            application_type: application.application_type,
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
        submittedAt: new Date().toISOString(),
        auditEventId: crypto.randomUUID(),
        requestId
    });
    if (!submitted) throw new ApiError(409, 'APPLICATION_NOT_SUBMITTABLE', 'Bu başvuru gönderim için uygun durumda değil.');
    return { application: createApplicationDto(submitted, environment) };
}
