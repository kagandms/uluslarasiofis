import { canUseNotificationTemplate } from '../domain/notificationTemplates.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { hashNotificationPhone, maskNotificationEmail, MAX_NOTIFICATION_ATTEMPTS,
    normalizeE164Phone } from './notificationService.js';

const LEASE_SECONDS = 300;
const RETRY_DELAYS_SECONDS = Object.freeze([30, 120, 600, 1800]);
const REQUEST_ID = 'notification-dispatcher';

function addSeconds(value, seconds) {
    return new Date(Date.parse(value) + seconds * 1000).toISOString();
}

function readFailure(error) {
    if (error?.classification === 'transient') return { type: 'transient', code: 'provider_transient_failure' };
    if (error?.classification === 'permanent') return { type: 'permanent', code: 'provider_permanent_failure' };
    return { type: 'unknown', code: 'provider_result_unknown' };
}

function buildDispatchResult(result, claimed) {
    return { status: result, notification_id: claimed.notification_id };
}

async function recordFailure(repositories, input, classification) {
    if (classification.type === 'transient' && input.attemptCount < MAX_NOTIFICATION_ATTEMPTS) {
        const delay = RETRY_DELAYS_SECONDS[Math.min(input.attemptCount - 1, RETRY_DELAYS_SECONDS.length - 1)];
        await repositories.notifications.scheduleRetry({ ...input, errorCode: classification.code,
            now: input.now, nextAttemptAt: addSeconds(input.now, delay), auditEventId: crypto.randomUUID() });
        return 'retry_scheduled';
    }
    await repositories.notifications.finishDispatch({ ...input, notificationStatus: 'failed',
        providerStatus: classification.type === 'unknown' ? 'unknown' : 'failed', providerMessageId: null,
        outboxStatus: 'dead', errorCode: classification.code, failedAt: input.now, sentAt: null,
        auditEventId: crypto.randomUUID(), auditResult: classification.type === 'unknown' ? 'unknown' : 'failed' });
    return classification.type === 'unknown' ? 'unknown' : 'failed';
}

async function readCurrentSafeRecipient(envelope) {
    if (envelope.channel === 'whatsapp') {
        const phone = normalizeE164Phone(envelope.student_phone);
        if (!phone || envelope.whatsapp_opt_in !== 1) return null;
        const phoneHash = await hashNotificationPhone(phone);
        return phoneHash === envelope.whatsapp_phone_hash ? phone : null;
    }
    if (envelope.channel === 'email' && maskNotificationEmail(envelope.student_email)) return envelope.student_email.trim();
    return null;
}

/** Claims and dispatches one due notification using only an explicitly injected provider adapter. */
export async function dispatchNextNotification({ database, provider, now = new Date().toISOString() }) {
    if (!provider || typeof provider.dispatch !== 'function') return { status: 'provider_not_configured' };
    const repositories = createD1Repositories(database);
    const staleBefore = addSeconds(now, -LEASE_SECONDS);
    await repositories.notifications.recoverAmbiguousDispatch({ now, staleBefore,
        auditEventId: crypto.randomUUID(), requestId: REQUEST_ID });
    const leaseToken = crypto.randomUUID();
    const claimed = await repositories.notifications.claimNextOutbox({ now, staleBefore, leaseToken });
    if (!claimed) return { status: 'empty' };
    const envelope = await repositories.notifications.loadDispatchEnvelope(claimed.notification_id);
    if (!envelope) return buildDispatchResult('missing_envelope', claimed);
    const input = { notificationId: claimed.notification_id, applicationId: envelope.application_id,
        leaseToken, attemptCount: claimed.attempt_count, requestId: REQUEST_ID, now };
    if (!canUseNotificationTemplate(envelope.template_key, envelope.application_status)) {
        return buildDispatchResult(await recordFailure(repositories, input,
            { type: 'permanent', code: 'application_state_changed' }), claimed);
    }
    const recipient = await readCurrentSafeRecipient(envelope);
    if (!recipient) {
        return buildDispatchResult(await recordFailure(repositories, input,
            { type: 'permanent', code: envelope.channel === 'whatsapp' ? 'consent_or_phone_changed' : 'recipient_unavailable' }), claimed);
    }
    const dispatchStarted = await repositories.notifications.markDispatchStarted({
        notificationId: claimed.notification_id, leaseToken, now
    });
    if (!dispatchStarted) return buildDispatchResult('lease_lost', claimed);
    try {
        const providerResult = await provider.dispatch({ channel: envelope.channel, recipient,
            message: envelope.rendered_message, templateKey: envelope.template_key,
            language: envelope.language, notificationId: envelope.id });
        if (providerResult?.status !== 'accepted' && providerResult?.status !== 'sent') {
            return buildDispatchResult(await recordFailure(repositories, input, { type: 'unknown' }), claimed);
        }
        const isAccepted = providerResult.status === 'accepted';
        await repositories.notifications.finishDispatch({ ...input,
            notificationStatus: isAccepted ? 'queued' : 'sent', providerStatus: providerResult.status,
            providerMessageId: typeof providerResult.messageId === 'string' ? providerResult.messageId : null,
            outboxStatus: 'sent', errorCode: null, failedAt: null,
            sentAt: isAccepted ? null : now, auditEventId: crypto.randomUUID(), auditResult: providerResult.status });
        return buildDispatchResult(providerResult.status, claimed);
    } catch (error) {
        const failure = readFailure(error);
        return buildDispatchResult(await recordFailure(repositories, input, failure), claimed);
    }
}
