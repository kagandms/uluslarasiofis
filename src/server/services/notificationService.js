import { ApiError } from '../domain/errors.js';
import { buildNotificationMessage, canUseNotificationTemplate,
    NOTIFICATION_LANGUAGES, NOTIFICATION_TEMPLATES } from '../domain/notificationTemplates.js';

export const WHATSAPP_CONSENT_VERSION = 'whatsapp-consent-v1';
export const MAX_NOTIFICATION_ATTEMPTS = 5;
const SUPPORTED_CHANNELS = new Set(['whatsapp', 'email']);

/** Normalizes a stored international phone number or rejects it as unavailable. */
export function normalizeE164Phone(value) {
    if (typeof value !== 'string' || !value.startsWith('+')) return null;
    const digits = value.slice(1).replace(/[\s().-]/g, '');
    if (!/^\d{8,15}$/.test(digits) || digits.startsWith('0')) return null;
    return `+${digits}`;
}

/** Returns a SHA-256 fingerprint used only to bind WhatsApp consent to the saved phone. */
export async function hashNotificationPhone(phone) {
    const normalized = normalizeE164Phone(phone);
    if (!normalized) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Returns a minimal phone mask suitable for staff notification history. */
export function maskNotificationRecipient(phone) {
    const normalized = normalizeE164Phone(phone);
    if (!normalized) return null;
    return `••••${normalized.slice(-2)}`;
}

/** Returns a masked email address suitable for staff notification history. */
export function maskNotificationEmail(email) {
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    const [local, domain] = email.trim().split('@');
    const domainParts = domain.split('.');
    const maskedDomain = domainParts.map((part, index) => index === domainParts.length - 1
        ? part : `${part.slice(0, 1)}•••`).join('.');
    return `${local.slice(0, 1)}•••@${maskedDomain}`;
}

/** Checks whether an internal provider adapter is explicitly available. */
export function isNotificationProviderConfigured(environment, channel) {
    const provider = environment?.NOTIFICATION_PROVIDERS?.[channel];
    return provider?.isConfigured === true && typeof provider.dispatch === 'function';
}

function readBlockedReasons({ application, channel, templateKey, language, context, preferences, phoneHash,
    isProviderConfigured, isTemplateConfigured }) {
    const reasons = [];
    if (!application) return ['APPLICATION_NOT_FOUND'];
    if (!SUPPORTED_CHANNELS.has(channel)) return ['CHANNEL_UNAVAILABLE'];
    if (!Object.hasOwn(NOTIFICATION_TEMPLATES, templateKey) || !NOTIFICATION_LANGUAGES.includes(language)) {
        return ['TEMPLATE_UNAVAILABLE'];
    }
    if (!canUseNotificationTemplate(templateKey, application.status)) reasons.push('TEMPLATE_STATUS_MISMATCH');
    if (channel === 'whatsapp') {
        if (!preferences.whatsapp_opt_in) reasons.push('WHATSAPP_CONSENT_REQUIRED');
        if (preferences.whatsapp_opt_in && preferences.whatsapp_consent_version !== WHATSAPP_CONSENT_VERSION) {
            reasons.push('WHATSAPP_CONSENT_VERSION_STALE');
        }
        if (!phoneHash) reasons.push('RECIPIENT_PHONE_UNAVAILABLE');
        if (preferences.whatsapp_opt_in && phoneHash !== preferences.whatsapp_phone_hash) {
            reasons.push('WHATSAPP_CONSENT_PHONE_CHANGED');
        }
        if (!context.student_phone) reasons.push('RECIPIENT_PHONE_UNAVAILABLE');
    }
    if (!isProviderConfigured) reasons.push(channel === 'email' ? 'EMAIL_PROVIDER_NOT_CONFIGURED' : 'WHATSAPP_PROVIDER_NOT_CONFIGURED');
    if (channel === 'whatsapp' && isProviderConfigured && !isTemplateConfigured) {
        reasons.push('WHATSAPP_TEMPLATE_NOT_APPROVED');
    }
    if (channel === 'email' && !maskNotificationEmail(context.student_email)) {
        reasons.push('RECIPIENT_EMAIL_UNAVAILABLE');
    }
    return [...new Set(reasons)];
}

/** Resolves the server-derived recipient, consent, template, and provider gates for a preview. */
export async function prepareNotificationPreview({ repositories, environment, applicationId, channel, templateKey, language, origin }) {
    const context = await repositories.notifications.readApplicationContext(applicationId);
    if (!context || context.status === 'draft') throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const preferences = await repositories.notifications.readPreferences(applicationId);
    const phoneHash = channel === 'whatsapp' ? await hashNotificationPhone(context.student_phone) : null;
    const provider = environment?.NOTIFICATION_PROVIDERS?.[channel];
    const isProviderConfigured = isNotificationProviderConfigured(environment, channel);
    const isTemplateConfigured = typeof provider?.isTemplateConfigured !== 'function'
        || provider.isTemplateConfigured(templateKey, language) === true;
    const blockedReasons = readBlockedReasons({ application: context, channel, templateKey, language,
        context, preferences, phoneHash, isProviderConfigured, isTemplateConfigured });
    let message = null;
    if (Object.hasOwn(NOTIFICATION_TEMPLATES, templateKey) && NOTIFICATION_LANGUAGES.includes(language)) {
        message = buildNotificationMessage({ templateKey, language, origin });
    }
    return {
        channel, template_key: templateKey, language,
        recipient_masked: channel === 'email'
            ? maskNotificationEmail(context.student_email) : maskNotificationRecipient(context.student_phone),
        message, can_send: blockedReasons.length === 0, blocked_reasons: blockedReasons
    };
}

/** Hashes only server-resolved notification content and application scope. */
export function createEnqueueFingerprint(input) {
    const source = JSON.stringify({ applicationId: input.applicationId, channel: input.channel,
        templateKey: input.templateKey, language: input.language, recipientMasked: input.recipientMasked,
        renderedMessage: input.renderedMessage });
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
        .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

/** Maps an internal send gate to a safe API error. */
export function readEnqueueBlockedError(reason) {
    const errors = {
        WHATSAPP_CONSENT_REQUIRED: ['WHATSAPP_CONSENT_REQUIRED', 'Öğrencinin WhatsApp izni yok. Gönderim engellendi.'],
        WHATSAPP_CONSENT_PHONE_CHANGED: ['WHATSAPP_CONSENT_PHONE_CHANGED', 'Telefon değiştiği için yeni öğrenci izni gerekiyor.'],
        WHATSAPP_CONSENT_VERSION_STALE: ['WHATSAPP_CONSENT_REQUIRED', 'İzin metni güncellendiği için öğrenciden yeniden izin gerekiyor.'],
        WHATSAPP_PROVIDER_NOT_CONFIGURED: ['PROVIDER_NOT_CONFIGURED', 'WhatsApp sağlayıcısı yapılandırılmadı; gönderim devre dışı.'],
        WHATSAPP_TEMPLATE_NOT_APPROVED: ['TEMPLATE_NOT_AVAILABLE', 'Seçilen Meta şablonu bu dil için kurum tarafından onaylanmadı.'],
        EMAIL_PROVIDER_NOT_CONFIGURED: ['PROVIDER_NOT_CONFIGURED', 'E-posta sağlayıcısı yapılandırılmadı; gönderim devre dışı.'],
        RECIPIENT_PHONE_UNAVAILABLE: ['RECIPIENT_UNAVAILABLE', 'Başvuruda geçerli bir uluslararası telefon numarası yok.'],
        RECIPIENT_EMAIL_UNAVAILABLE: ['RECIPIENT_UNAVAILABLE', 'Başvuruda geçerli bir e-posta adresi yok.'],
        TEMPLATE_STATUS_MISMATCH: ['TEMPLATE_NOT_AVAILABLE', 'Bu şablon mevcut başvuru durumunda kullanılamaz.']
    };
    const [code, message] = errors[reason] || ['NOTIFICATION_BLOCKED', 'Bildirim şu anda gönderilemez.'];
    return new ApiError(409, code, message);
}
