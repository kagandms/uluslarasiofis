import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { dispatchNextNotification } from '../src/server/services/notificationDispatcher.js';
import worker from '../src/server/worker.js';
import { MAX_WHATSAPP_WEBHOOK_BYTES } from '../src/server/services/metaWhatsAppWebhook.js';
import { callWorker, createNotificationFixture, enqueueTestNotification } from './helpers/notification-fixtures.js';

const WEBHOOK_SECRET = 'test-webhook-app-secret';
const PHONE_NUMBER_ID = '1234567890123';

function webhookPayload(status, { messageId = 'wamid.test-123', phoneNumberId = PHONE_NUMBER_ID, timestamp = '1790935200' } = {}) {
    return { object: 'whatsapp_business_account', entry: [{ id: 'test-waba', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId },
        statuses: [{ id: messageId, status, timestamp }]
    } }] }] };
}

async function postWebhook(fixture, payload, secret = WEBHOOK_SECRET) {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return worker.fetch(new Request('https://portal.test/api/webhooks/whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature }, body: raw
    }), fixture.environment, {});
}

async function createSentNotification() {
    const fixture = await createNotificationFixture({ WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
        WHATSAPP_APP_SECRET: WEBHOOK_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token' });
    await enqueueTestNotification(fixture);
    await dispatchNextNotification({ database: fixture.database, now: new Date().toISOString(),
        provider: { async dispatch() { return { status: 'accepted', messageId: 'wamid.test-123' }; } } });
    return fixture;
}

test('Meta webhook verifies subscription challenge and rejects an incorrect verification token', async () => {
    const fixture = await createNotificationFixture({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token' });
    const valid = await callWorker(fixture.environment,
        '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-1');
    const invalid = await callWorker(fixture.environment,
        '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-1');
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), 'challenge-1');
    assert.equal(invalid.status, 403);
});

test('Meta webhook rejects invalid signatures and a foreign sender phone number ID', async () => {
    const fixture = await createSentNotification();
    const raw = JSON.stringify(webhookPayload('delivered'));
    const invalidSignature = await worker.fetch(new Request('https://portal.test/api/webhooks/whatsapp', {
        method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body: raw
    }), fixture.environment, {});
    const invalidSender = await postWebhook(fixture, webhookPayload('delivered', { phoneNumberId: '9999999999999' }));
    assert.equal(invalidSignature.status, 403);
    assert.equal(invalidSender.status, 403);
    assert.equal(fixture.database.prepare('SELECT provider_status FROM notifications').first().provider_status, 'accepted');
});

test('Meta webhook rejects validly signed status events for unknown provider IDs', async () => {
    const fixture = await createSentNotification();
    const response = await postWebhook(fixture, webhookPayload('delivered', { messageId: 'wamid.unknown' }));
    assert.equal(response.status, 404);
});

test('Meta webhook bounds raw request bytes before parsing or verification', async () => {
    const fixture = await createNotificationFixture({ WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
        WHATSAPP_APP_SECRET: WEBHOOK_SECRET });
    const response = await worker.fetch(new Request('https://portal.test/api/webhooks/whatsapp', {
        method: 'POST', body: new Uint8Array(MAX_WHATSAPP_WEBHOOK_BYTES + 1)
    }), fixture.environment, {});
    assert.equal(response.status, 413);
});

test('Meta webhook acknowledges unsupported status types without altering application delivery state', async () => {
    const fixture = await createSentNotification();
    const response = await postWebhook(fixture, webhookPayload('deleted'));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual({ received: result.received, processed: result.processed }, { received: true, processed: 0 });
    assert.equal(fixture.database.prepare('SELECT provider_status FROM notifications').first().provider_status, 'accepted');
});

test('Meta webhook records status events once and prevents status regression', async () => {
    const fixture = await createSentNotification();
    for (const status of ['delivered', 'delivered', 'sent', 'read', 'failed']) {
        const response = await postWebhook(fixture, webhookPayload(status));
        assert.equal(response.status, 200);
    }
    const notification = fixture.database.prepare('SELECT status, provider_status FROM notifications').first();
    assert.deepEqual({ ...notification }, { status: 'read', provider_status: 'read' });
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notification_provider_webhook_events').first().count, 4);
    assert.equal(fixture.database.prepare(`SELECT COUNT(*) AS count FROM audit_events
        WHERE event_type = 'system.notification_provider_status_received'`).first().count, 2);
});

test('Meta webhook may move a sent message to failed, then treats failure as terminal', async () => {
    const fixture = await createSentNotification();
    await postWebhook(fixture, webhookPayload('sent'));
    await postWebhook(fixture, webhookPayload('failed'));
    await postWebhook(fixture, webhookPayload('delivered'));
    const notification = fixture.database.prepare('SELECT status, provider_status FROM notifications').first();
    assert.deepEqual({ ...notification }, { status: 'failed', provider_status: 'failed' });
});
