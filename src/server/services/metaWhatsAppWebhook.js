import { ApiError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';

export const MAX_WHATSAPP_WEBHOOK_BYTES = 256 * 1024;

/** Validates Meta's HMAC over the unchanged webhook body. */
export async function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
    const signature = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader || '')?.[1];
    if (!signature || typeof appSecret !== 'string' || appSecret.length === 0) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
    let difference = 0;
    for (let index = 0; index < digest.length; index += 1) {
        difference |= digest[index] ^ Number.parseInt(signature.slice(index * 2, index * 2 + 2), 16);
    }
    return difference === 0;
}

async function readBoundedBody(request) {
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = [];
    let byteLength = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_WHATSAPP_WEBHOOK_BYTES) {
            await reader.cancel();
            throw new ApiError(413, 'WEBHOOK_TOO_LARGE', 'Webhook isteği çok büyük.');
        }
        chunks.push(value);
    }
    const body = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
}

function readTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return null;
    const timestamp = new Date(Number(value) * 1000);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function readStatusEvent(status) {
    if (typeof status?.status !== 'string' || !/^[a-z_]{1,32}$/.test(status.status)
        || typeof status.id !== 'string' || !status.id.startsWith('wamid.')) {
        throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.');
    }
    const providerTimestamp = readTimestamp(status.timestamp);
    if (!providerTimestamp) throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.');
    if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) return null;
    return { providerMessageId: status.id, providerStatus: status.status, providerTimestamp };
}

function readStatusChange(change, expectedPhoneNumberId) {
    if (change?.field !== 'messages') return [];
    const value = change.value;
    if (value?.metadata?.phone_number_id !== expectedPhoneNumberId) {
        throw new ApiError(403, 'WEBHOOK_SENDER_INVALID', 'Webhook kaynağı doğrulanamadı.');
    }
    if (value.messaging_product !== 'whatsapp'
        || (value.statuses !== undefined && !Array.isArray(value.statuses))) {
        throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.');
    }
    return (value.statuses || []).map(readStatusEvent).filter(Boolean);
}

function readStatusEvents(payload, expectedPhoneNumberId) {
    if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
        throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.');
    }
    const events = [];
    for (const entry of payload.entry) {
        if (!Array.isArray(entry?.changes)) throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.');
        for (const change of entry.changes) events.push(...readStatusChange(change, expectedPhoneNumberId));
    }
    if (events.length > 100) throw new ApiError(413, 'WEBHOOK_TOO_LARGE', 'Webhook olay sayısı çok fazla.');
    return events;
}

function readConstantTimeTokenMatch(expected, actual) {
    if (!expected || !actual || expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
    return difference === 0;
}

function verifySubscription(request, environment) {
    const url = new URL(request.url);
    const challenge = url.searchParams.get('hub.challenge');
    const isValid = url.searchParams.get('hub.mode') === 'subscribe'
        && readConstantTimeTokenMatch(environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
            url.searchParams.get('hub.verify_token'));
    if (!isValid || !challenge || challenge.length > 256) {
        throw new ApiError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Webhook doğrulaması başarısız.');
    }
    return new Response(challenge, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function acceptSignedEvents(request, environment, requestId) {
    if (typeof environment.WHATSAPP_PHONE_NUMBER_ID !== 'string'
        || !/^\d{5,30}$/.test(environment.WHATSAPP_PHONE_NUMBER_ID)
        || typeof environment.WHATSAPP_APP_SECRET !== 'string' || !environment.WHATSAPP_APP_SECRET) {
        throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'WhatsApp webhook yapılandırılmadı.');
    }
    const rawBody = await readBoundedBody(request);
    if (!await verifyMetaWebhookSignature(rawBody, request.headers.get('X-Hub-Signature-256'), environment.WHATSAPP_APP_SECRET)) {
        throw new ApiError(403, 'WEBHOOK_SIGNATURE_INVALID', 'Webhook imzası doğrulanamadı.');
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(rawBody)); }
    catch { throw new ApiError(400, 'WEBHOOK_PAYLOAD_INVALID', 'Webhook içeriği doğrulanamadı.'); }
    const events = readStatusEvents(payload, environment.WHATSAPP_PHONE_NUMBER_ID);
    const notifications = createD1Repositories(environment.DB).notifications;
    for (const event of events) {
        const notificationId = await notifications.findByProviderMessageId(event.providerMessageId);
        if (!notificationId) throw new ApiError(404, 'WEBHOOK_MESSAGE_UNKNOWN', 'Webhook bildirimi bulunamadı.');
        const eventId = await createEventId(event);
        await notifications.recordProviderStatusEvent({ ...event, eventId, notificationId,
            receivedAt: new Date().toISOString(), requestId });
    }
    return { received: true, processed: events.length };
}

/** Handles Meta webhook subscription verification and signed delivery status callbacks. */
export async function handleMetaWhatsAppWebhook(request, environment, requestId) {
    if (request.method === 'GET') return verifySubscription(request, environment);
    if (request.method === 'POST') return acceptSignedEvents(request, environment, requestId);
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
}

async function createEventId(event) {
    const input = `${event.providerMessageId}\n${event.providerStatus}\n${event.providerTimestamp}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
