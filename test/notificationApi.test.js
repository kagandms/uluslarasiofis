import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callWorker, createNotificationFixture } from './helpers/notification-fixtures.js';

const selection = { channel: 'whatsapp', template_key: 'status_updated', language: 'tr' };

async function saveConsent(fixture, isOptedIn = true) {
    return callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        method: 'PUT', cookie: fixture.ownerCookie,
        body: isOptedIn ? { whatsapp_opt_in: true, consent_version: 'whatsapp-consent-v1', language: 'tr' }
            : { whatsapp_opt_in: false }
    });
}

function staffPath(fixture, suffix = '') {
    return `/api/staff/applications/${encodeURIComponent(fixture.applicationId)}/notifications${suffix}`;
}

test('owner session controls WhatsApp consent and consent responses do not expose recipient hashes', async () => {
    const fixture = await createNotificationFixture();
    const before = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', { cookie: fixture.ownerCookie });
    const preferences = await before.json();
    assert.equal(before.status, 200);
    assert.equal(preferences.whatsapp_opt_in, false);
    assert.equal(preferences.application_id, fixture.applicationId);
    assert.equal(preferences.current_consent_version, 'whatsapp-consent-v1');
    assert.equal(preferences.effective_whatsapp_opt_in, false);
    assert.equal(preferences.requires_reconsent, false);
    assert.equal(preferences.can_opt_in, true);
    const saved = await saveConsent(fixture);
    const response = await saved.json();
    assert.equal(saved.status, 200);
    assert.equal(response.whatsapp_opt_in, true);
    assert.equal(response.consent_version, 'whatsapp-consent-v1');
    assert.equal(response.application_id, fixture.applicationId);
    assert.equal(response.current_consent_version, 'whatsapp-consent-v1');
    assert.equal(response.effective_whatsapp_opt_in, true);
    assert.equal(response.requires_reconsent, false);
    assert.equal(response.can_opt_in, true);
    assert.doesNotMatch(JSON.stringify(response), /phone_hash|19995550123|student@example/);

    const staffAttempt = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        method: 'PUT', cookie: fixture.staffCookie, body: { whatsapp_opt_in: true, consent_version: 'whatsapp-consent-v1', language: 'tr' }
    });
    assert.equal(staffAttempt.status, 401);
    const crossOrigin = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        method: 'PUT', cookie: fixture.ownerCookie, origin: 'https://attacker.test', body: { whatsapp_opt_in: false }
    });
    assert.equal(crossOrigin.status, 403);
});

test('staff notification history GET accepts an authenticated browser request without Origin', async () => {
    const fixture = await createNotificationFixture();
    const response = await callWorker(fixture.environment, staffPath(fixture), {
        cookie: fixture.staffCookie, omitOrigin: true
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).notifications, []);
});

test('preference response flags stale consent and an invalid current phone without exposing its hash', async () => {
    const fixture = await createNotificationFixture();
    await saveConsent(fixture);
    fixture.database.prepare("UPDATE applications SET student_phone = 'invalid' WHERE id = ?")
        .bind(fixture.applicationId).run();
    const response = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        cookie: fixture.ownerCookie
    });
    const preferences = await response.json();
    assert.equal(response.status, 200);
    assert.equal(preferences.whatsapp_opt_in, true);
    assert.equal(preferences.effective_whatsapp_opt_in, false);
    assert.equal(preferences.requires_reconsent, true);
    assert.equal(preferences.can_opt_in, false);
    assert.doesNotMatch(JSON.stringify(preferences), /phone_hash/);
});

test('preference response requires new consent when its version is stale but the phone remains valid', async () => {
    const fixture = await createNotificationFixture();
    await saveConsent(fixture);
    fixture.database.prepare("UPDATE notification_preferences SET whatsapp_consent_version = 'old-version' WHERE application_id = ?")
        .bind(fixture.applicationId).run();
    const response = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        cookie: fixture.ownerCookie
    });
    const preferences = await response.json();
    assert.equal(preferences.effective_whatsapp_opt_in, false);
    assert.equal(preferences.requires_reconsent, true);
    assert.equal(preferences.can_opt_in, true);
    const preview = await callWorker(fixture.environment, staffPath(fixture, '/preview'), {
        method: 'POST', cookie: fixture.staffCookie, body: selection
    });
    assert.ok((await preview.json()).blocked_reasons.includes('WHATSAPP_CONSENT_VERSION_STALE'));
});

test('Meta template configuration gates staff preview and enqueue per language', async () => {
    const fixture = await createNotificationFixture({
        WHATSAPP_ACCESS_TOKEN: 'test-only-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890123',
        WHATSAPP_CLOUD_API_VERSION: 'v24.0',
        WHATSAPP_APPROVED_TEMPLATES: { application_received: { tr: { name: 'application_received_tr', languageCode: 'tr' } } }
    });
    await saveConsent(fixture);
    const preview = await callWorker(fixture.environment, staffPath(fixture, '/preview'), {
        method: 'POST', cookie: fixture.staffCookie, body: selection
    });
    assert.ok((await preview.json()).blocked_reasons.includes('WHATSAPP_TEMPLATE_NOT_APPROVED'));
    const enqueue = await callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie, headers: { 'Idempotency-Key': 'notification-key-0004' }, body: selection
    });
    assert.equal(enqueue.status, 409);
    assert.equal((await enqueue.json()).error.code, 'TEMPLATE_NOT_AVAILABLE');
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notifications').first().count, 0);
});

test('staff preview and enqueue require owner consent and a configured provider', async () => {
    const fixture = await createNotificationFixture();
    const preview = await callWorker(fixture.environment, staffPath(fixture, '/preview'), {
        method: 'POST', cookie: fixture.staffCookie, body: selection
    });
    const previewBody = await preview.json();
    assert.equal(preview.status, 200);
    assert.equal(previewBody.can_send, false);
    assert.ok(previewBody.blocked_reasons.includes('WHATSAPP_CONSENT_REQUIRED'));
    assert.ok(previewBody.blocked_reasons.includes('WHATSAPP_PROVIDER_NOT_CONFIGURED'));

    await saveConsent(fixture);
    const stillDisabled = await callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie,
        headers: { 'Idempotency-Key': 'notification-key-0001' }, body: selection
    });
    assert.equal(stillDisabled.status, 409);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notifications').first().count, 0);
});

test('staff enqueue is manual, recipient-free, same-application, and idempotent', async () => {
    const provider = { isConfigured: true, dispatch: async () => ({ status: 'accepted' }) };
    const fixture = await createNotificationFixture({ NOTIFICATION_PROVIDERS: { whatsapp: provider } });
    await saveConsent(fixture);
    const injectedRecipient = await callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie, headers: { 'Idempotency-Key': 'notification-key-0002' },
        body: { ...selection, recipient: '+900000000000' }
    });
    assert.equal(injectedRecipient.status, 400);

    const enqueue = () => callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie,
        headers: { 'Idempotency-Key': 'notification-key-0002' }, body: selection
    });
    const firstResponse = await enqueue();
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(first.queued, true);
    assert.equal(first.notification.recipient_masked, '••••23');
    assert.equal(first.notification.provider_status, 'not_sent');
    assert.equal(first.delivered, undefined);
    assert.equal(first.notification.application_id, fixture.applicationId);

    await saveConsent(fixture, false);

    const repeated = await enqueue();
    const duplicate = await repeated.json();
    assert.equal(repeated.status, 200);
    assert.equal(duplicate.is_existing, true);
    assert.equal(duplicate.notification.id, first.notification.id);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').first().count, 1);

    const changedPayload = await callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie,
        headers: { 'Idempotency-Key': 'notification-key-0002' }, body: { ...selection, language: 'en' }
    });
    assert.equal(changedPayload.status, 409);

    const history = await callWorker(fixture.environment, staffPath(fixture), { cookie: fixture.staffCookie });
    const historyPayload = await history.json();
    assert.equal(history.status, 200);
    assert.equal(historyPayload.notifications.length, 1);
    assert.equal(historyPayload.notifications[0].recipient_masked, '••••23');
    assert.doesNotMatch(JSON.stringify(historyPayload), /rendered_message|student@example|19995550123|storage_key/);
});

test('email preview masks both local and domain names while the adapter remains disabled', async () => {
    const fixture = await createNotificationFixture();
    const response = await callWorker(fixture.environment, staffPath(fixture, '/preview'), {
        method: 'POST', cookie: fixture.staffCookie,
        body: { channel: 'email', template_key: 'application_received', language: 'en' }
    });
    const preview = await response.json();
    assert.equal(response.status, 200);
    assert.equal(preview.recipient_masked, 's•••@e•••.invalid');
    assert.ok(preview.blocked_reasons.includes('EMAIL_PROVIDER_NOT_CONFIGURED'));
    assert.doesNotMatch(JSON.stringify(preview), /student@example\.invalid/);
});

test('staff routes reject missing sessions and cross-origin mutations', async () => {
    const fixture = await createNotificationFixture();
    const unauthenticated = await callWorker(fixture.environment, staffPath(fixture), {});
    assert.equal(unauthenticated.status, 401);
    const crossOrigin = await callWorker(fixture.environment, staffPath(fixture, '/preview'), {
        method: 'POST', cookie: fixture.staffCookie, origin: 'https://attacker.test', body: selection
    });
    assert.equal(crossOrigin.status, 403);
});

test('notification enqueue rolls back atomically if its audit insert fails', async () => {
    const provider = { isConfigured: true, dispatch: async () => ({ status: 'accepted' }) };
    const fixture = await createNotificationFixture({ NOTIFICATION_PROVIDERS: { whatsapp: provider } });
    await saveConsent(fixture);
    fixture.database.exec(`CREATE TRIGGER reject_notification_audit BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'staff.notification_enqueued' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
    const response = await callWorker(fixture.environment, staffPath(fixture), {
        method: 'POST', cookie: fixture.staffCookie, headers: { 'Idempotency-Key': 'notification-key-0003' }, body: selection
    });
    assert.equal(response.status, 500);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notifications').first().count, 0);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM notification_outbox').first().count, 0);
    assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM idempotency_records').first().count, 0);
});
