import { requireApplicationSession } from '../auth/applicationAuth.js';
import { ApiError } from '../domain/errors.js';
import { NOTIFICATION_LANGUAGES } from '../domain/notificationTemplates.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { hashNotificationPhone, WHATSAPP_CONSENT_VERSION } from '../services/notificationService.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

/** Reads notification consent through the current applicant session only. */
export async function readCurrentNotificationPreferences(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const repositories = createD1Repositories(environment.DB).notifications;
    const [preferences, application] = await Promise.all([
        repositories.readPreferences(session.application_id),
        repositories.readApplicationContext(session.application_id)
    ]);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    return buildPreferenceResponse(session.application_id, preferences, application);
}

async function buildPreferenceResponse(applicationId, preferences, application) {
    const currentPhoneHash = await hashNotificationPhone(application.student_phone);
    const hasCurrentPhone = Boolean(currentPhoneHash);
    const isStoredConsent = preferences.whatsapp_opt_in === true;
    const isConsentVersionCurrent = preferences.whatsapp_consent_version === WHATSAPP_CONSENT_VERSION;
    const isConsentPhoneCurrent = hasCurrentPhone && currentPhoneHash === preferences.whatsapp_phone_hash;
    const requiresReconsent = isStoredConsent && (!isConsentVersionCurrent || !isConsentPhoneCurrent);
    return {
        application_id: applicationId,
        whatsapp_opt_in: preferences.whatsapp_opt_in,
        consent_version: preferences.whatsapp_consent_version,
        current_consent_version: WHATSAPP_CONSENT_VERSION,
        effective_whatsapp_opt_in: isStoredConsent && !requiresReconsent,
        requires_reconsent: requiresReconsent,
        can_opt_in: hasCurrentPhone,
        language: preferences.whatsapp_consent_language,
        opted_in_at: preferences.whatsapp_opt_in_at,
        opted_out_at: preferences.whatsapp_opt_out_at
    };
}

function validatePreferenceBody(body) {
    if (Object.keys(body).some((key) => !['whatsapp_opt_in', 'consent_version', 'language'].includes(key))
        || typeof body.whatsapp_opt_in !== 'boolean') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İletişim tercihini kontrol edip tekrar deneyin.');
    }
    if (!body.whatsapp_opt_in) return { isOptedIn: false, consentVersion: null, language: null };
    if (body.consent_version !== WHATSAPP_CONSENT_VERSION || !NOTIFICATION_LANGUAGES.includes(body.language)) {
        throw new ApiError(400, 'CONSENT_VERSION_INVALID', 'İzin metnini yenileyip dil seçimini kontrol edin.');
    }
    return { isOptedIn: true, consentVersion: body.consent_version, language: body.language };
}

/** Saves applicant-controlled WhatsApp consent using the authenticated owner session. */
export async function updateCurrentNotificationPreferences(request, environment, requestId) {
    requireMethod(request, 'PUT');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const selected = validatePreferenceBody(await readJsonBody(request));
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.notifications.readApplicationContext(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const phoneHash = selected.isOptedIn ? await hashNotificationPhone(application.student_phone) : null;
    if (selected.isOptedIn && !phoneHash) {
        throw new ApiError(409, 'RECIPIENT_UNAVAILABLE', 'Başvuruda geçerli bir uluslararası telefon numarası yok.');
    }
    const now = new Date().toISOString();
    const saved = await repositories.notifications.updateApplicantPreferences({
        applicationId: session.application_id, ...selected, phoneHash,
        optedInAt: selected.isOptedIn ? now : null, optedOutAt: selected.isOptedIn ? null : now,
        updatedAt: now, requestId, auditEventId: crypto.randomUUID()
    });
    return buildPreferenceResponse(session.application_id, saved, application);
}
