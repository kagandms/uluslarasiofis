import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import { NOTIFICATION_LANGUAGES, NOTIFICATION_TEMPLATES } from '../domain/notificationTemplates.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { NotificationIdempotencyConflictError } from '../repositories/d1/notificationRepository.js';
import { createEnqueueFingerprint, MAX_NOTIFICATION_ATTEMPTS, prepareNotificationPreview,
    readEnqueueBlockedError } from '../services/notificationService.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const CHANNELS = new Set(['whatsapp', 'email']);

function requireOnlyKeys(body, keys) {
    if (Object.keys(body).some((key) => !keys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Bildirim alanlarını kontrol edip tekrar deneyin.');
    }
}

function readSelection(body) {
    requireOnlyKeys(body, ['channel', 'template_key', 'language']);
    if (!CHANNELS.has(body.channel) || !Object.hasOwn(NOTIFICATION_TEMPLATES, body.template_key)
        || !NOTIFICATION_LANGUAGES.includes(body.language)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Şablon, dil ve kanal seçimini kontrol edip tekrar deneyin.');
    }
    return { channel: body.channel, templateKey: body.template_key, language: body.language };
}

function readIdempotencyKey(request) {
    const key = request.headers.get('Idempotency-Key') || '';
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
        throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Gönderim isteği anahtarı eksik. Yeniden deneyin.');
    }
    return key;
}

async function prepareStaffContext(request, environment) {
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    return { staff, repositories: createD1Repositories(environment.DB) };
}

/** Records and returns a staff preview without exposing recipient details. */
export async function previewStaffNotification({ request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { staff, repositories } = await prepareStaffContext(request, environment);
    const selection = readSelection(await readJsonBody(request));
    const preview = await prepareNotificationPreview({ repositories, environment, applicationId,
        ...selection, origin: new URL(request.url).origin });
    await repositories.notifications.writeStaffPreviewAudit({
        auditEventId: crypto.randomUUID(), staffUserId: staff.id, applicationId, requestId,
        ...selection, result: preview.can_send ? 'ready' : 'blocked'
    });
    return preview;
}

/** Reads masked notification history for a non-draft application. */
export async function readStaffNotificationHistory({ request, environment, applicationId }) {
    requireMethod(request, 'GET');
    const { repositories } = await prepareStaffContext(request, environment);
    const application = await repositories.notifications.readApplicationContext(applicationId);
    if (!application || application.status === 'draft') {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    }
    return { notifications: await repositories.notifications.listHistory(applicationId, 50) };
}

/** Enqueues an explicitly requested notification after rechecking current recipient and consent. */
export async function enqueueStaffNotification({ request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { staff, repositories } = await prepareStaffContext(request, environment);
    const selection = readSelection(await readJsonBody(request));
    const idempotencyKey = readIdempotencyKey(request);
    const preview = await prepareNotificationPreview({ repositories, environment, applicationId,
        ...selection, origin: new URL(request.url).origin });
    const fingerprint = await createEnqueueFingerprint({ applicationId, ...selection,
        recipientMasked: preview.recipient_masked, renderedMessage: preview.message });
    const idempotencyScope = `staff-notification:${applicationId}`;
    try {
        const existing = await repositories.notifications.readIdempotentNotification({
            idempotencyScope, idempotencyKey, fingerprint
        });
        if (existing) return { queued: true, is_existing: true, notification: existing,
            max_attempts: MAX_NOTIFICATION_ATTEMPTS };
    } catch (error) {
        if (error instanceof NotificationIdempotencyConflictError) {
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Aynı istek anahtarı farklı bir bildirim içeriğiyle kullanıldı.');
        }
        throw error;
    }
    if (!preview.can_send) throw readEnqueueBlockedError(preview.blocked_reasons[0]);
    let result;
    try {
        result = await repositories.notifications.enqueueManualNotification({
        notificationId: crypto.randomUUID(), outboxId: crypto.randomUUID(), auditEventId: crypto.randomUUID(),
        applicationId, staffUserId: staff.id, ...selection, recipientMasked: preview.recipient_masked,
        renderedMessage: preview.message, fingerprint, idempotencyKey,
            idempotencyScope, requestId, createdAt: new Date().toISOString()
        });
    } catch (error) {
        if (error instanceof NotificationIdempotencyConflictError) {
            throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Aynı istek anahtarı farklı bir bildirim içeriğiyle kullanıldı.');
        }
        throw error;
    }
    return { queued: true, is_existing: result.isExisting, notification: result.notification,
        max_attempts: MAX_NOTIFICATION_ATTEMPTS };
}

/** Schedules an eligible transient failure for an immediate retry without dispatching it inline. */
export async function retryStaffNotification({ request, environment, applicationId, notificationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const repositories = createD1Repositories(environment.DB);
    const item = await repositories.notifications.findHistoryItem(applicationId, notificationId);
    if (!item) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Bildirim kaydı bulunamadı.');
    if (item.attempt_count >= MAX_NOTIFICATION_ATTEMPTS || item.provider_status !== 'not_sent') {
        throw new ApiError(409, 'NOTIFICATION_RETRY_UNAVAILABLE', 'Bu bildirim için güvenli tekrar gönderim yapılamıyor.');
    }
    const result = await repositories.notifications.expediteRetry({
        applicationId, notificationId, staffUserId: staff.id, requestId, auditEventId: crypto.randomUUID(),
        now: new Date().toISOString(), maxAttempts: MAX_NOTIFICATION_ATTEMPTS
    });
    if (!result) throw new ApiError(409, 'NOTIFICATION_RETRY_UNAVAILABLE', 'Bu bildirim için güvenli tekrar gönderim yapılamıyor.');
    return { retry_scheduled: true, notification_id: notificationId };
}
