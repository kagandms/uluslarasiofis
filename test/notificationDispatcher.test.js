import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchNextNotification, runNotificationDispatchBatch } from '../src/server/services/notificationDispatcher.js';
import { callWorker, createNotificationFixture, enqueueTestNotification } from './helpers/notification-fixtures.js';
import worker from '../src/server/worker.js';

const TEST_NOW = '2026-10-01T10:00:00.000Z';

function makeOutboxDue(fixture) {
    fixture.database.prepare('UPDATE notification_outbox SET next_attempt_at = ?').bind(TEST_NOW).run();
}

test('dispatcher remains inactive without an explicitly injected provider', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    const result = await dispatchNextNotification({ database: fixture.database });
    assert.deepEqual(result, { status: 'provider_not_configured' });
    assert.equal(fixture.database.prepare('SELECT status FROM notification_outbox').first().status, 'pending');
});

test('background consumer is disabled by default and caps each enabled batch at five', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    const disabled = await runNotificationDispatchBatch({ database: fixture.database,
        provider: { async dispatch() { assert.fail('disabled consumer must not dispatch'); } } });
    assert.deepEqual(disabled, { status: 'disabled', processed: 0 });
    assert.deepEqual(await worker.scheduled({}, fixture.environment), { status: 'disabled', processed: 0 });
    assert.deepEqual(await worker.scheduled({}, { ...fixture.environment, NOTIFICATION_DISPATCH_ENABLED: 'true' }),
        { status: 'provider_not_configured', processed: 0 });
    assert.equal(fixture.database.prepare('SELECT status FROM notification_outbox').first().status, 'pending');

    for (let index = 0; index < 5; index += 1) await enqueueTestNotification(fixture);
    fixture.database.prepare('UPDATE notification_outbox SET next_attempt_at = ?').bind(TEST_NOW).run();
    const enabled = await runNotificationDispatchBatch({ database: fixture.database,
        provider: { async dispatch() { return { status: 'accepted', messageId: `wamid.batch-${crypto.randomUUID()}` }; } },
        isEnabled: true, now: TEST_NOW });
    assert.deepEqual(enabled, { status: 'complete', processed: 5 });
    assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE status = 'pending'").first().count, 1);
});

test('dispatcher distinguishes provider acceptance from confirmed send', async () => {
    const acceptedFixture = await createNotificationFixture();
    const accepted = await enqueueTestNotification(acceptedFixture);
    makeOutboxDue(acceptedFixture);
    const acceptedResult = await dispatchNextNotification({ database: acceptedFixture.database,
        provider: { async dispatch(input) { assert.equal(input.recipient, '+19995550123'); return { status: 'accepted', messageId: 'mock-accepted' }; } },
        now: TEST_NOW });
    assert.equal(acceptedResult.status, 'accepted');
    assert.equal(acceptedFixture.database.prepare('SELECT status, provider_status FROM notifications WHERE id = ?')
        .bind(accepted.id).first().status, 'queued');
    assert.equal(acceptedFixture.database.prepare('SELECT provider_status FROM notifications WHERE id = ?')
        .bind(accepted.id).first().provider_status, 'accepted');
    assert.equal(acceptedFixture.database.prepare('SELECT status FROM notification_outbox').first().status, 'sent');

    const sentFixture = await createNotificationFixture();
    const sent = await enqueueTestNotification(sentFixture);
    makeOutboxDue(sentFixture);
    const sentResult = await dispatchNextNotification({ database: sentFixture.database,
        provider: { async dispatch() { return { status: 'sent', messageId: 'mock-sent' }; } },
        now: TEST_NOW });
    assert.equal(sentResult.status, 'sent');
    assert.equal(sentFixture.database.prepare('SELECT status, provider_status FROM notifications WHERE id = ?')
        .bind(sent.id).first().status, 'sent');
});

test('dispatch rechecks WhatsApp consent and the current phone before calling a provider', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    fixture.database.prepare(`UPDATE notification_preferences SET whatsapp_opt_in = 0,
        whatsapp_opt_in_at = NULL, whatsapp_consent_version = NULL, whatsapp_consent_language = NULL,
        whatsapp_phone_hash = NULL, whatsapp_opt_out_at = CURRENT_TIMESTAMP WHERE application_id = ?`)
        .bind(fixture.applicationId).run();
    let providerCalls = 0;
    const result = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { providerCalls += 1; return { status: 'sent' }; } },
        now: TEST_NOW });
    assert.equal(result.status, 'failed');
    assert.equal(providerCalls, 0);
    assert.equal(fixture.database.prepare('SELECT last_error_code FROM notifications').first().last_error_code,
        'consent_or_phone_changed');
});

test('dispatch blocks an outbox item when the applicant consent version becomes stale', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    fixture.database.prepare("UPDATE notification_preferences SET whatsapp_consent_version = 'old-version' WHERE application_id = ?")
        .bind(fixture.applicationId).run();
    let providerCalls = 0;
    const result = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { providerCalls += 1; return { status: 'accepted' }; } }, now: TEST_NOW });
    assert.equal(result.status, 'failed');
    assert.equal(providerCalls, 0);
    assert.equal(fixture.database.prepare('SELECT provider_status FROM notifications').first().provider_status, 'failed');
});

test('ambiguous provider results become unknown and are dead-lettered without blind retry', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    const result = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { throw Object.assign(new Error('timeout'), { classification: 'unknown' }); } },
        now: TEST_NOW });
    const row = fixture.database.prepare('SELECT status, provider_status FROM notifications').first();
    const outbox = fixture.database.prepare('SELECT status FROM notification_outbox').first();
    assert.equal(result.status, 'unknown');
    assert.equal(row.status, 'failed');
    assert.equal(row.provider_status, 'unknown');
    assert.equal(outbox.status, 'dead');
});

test('transient failures are scheduled with bounded attempts and manual retry is recorded', async () => {
    const fixture = await createNotificationFixture();
    const notification = await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    const result = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { throw Object.assign(new Error('temporary'), { classification: 'transient' }); } },
        now: TEST_NOW });
    assert.equal(result.status, 'retry_scheduled');
    const queue = fixture.database.prepare('SELECT status, attempt_count, next_attempt_at FROM notification_outbox').first();
    assert.equal(queue.status, 'retry');
    assert.equal(queue.attempt_count, 1);
    assert.equal(queue.next_attempt_at, '2026-10-01T10:00:30.000Z');

    const historyResponse = await callWorker(fixture.environment,
        `/api/staff/applications/${fixture.applicationId}/notifications`, { cookie: fixture.staffCookie });
    const history = await historyResponse.json();
    assert.equal(history.notifications[0].can_retry, true);
    const retry = await callWorker(fixture.environment,
        `/api/staff/applications/${fixture.applicationId}/notifications/${notification.id}/retry`, {
            method: 'POST', cookie: fixture.staffCookie
        });
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).retry_scheduled, true);
    assert.ok(fixture.database.prepare("SELECT next_attempt_at FROM notification_outbox WHERE notification_id = ?")
        .bind(notification.id).first().next_attempt_at <= new Date().toISOString());
});

test('provider failures at the attempt ceiling stop retrying', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    await fixture.database.prepare(`UPDATE notification_outbox SET attempt_count = 4,
        next_attempt_at = '2026-10-01T10:00:00.000Z'`).run();
    const result = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { throw Object.assign(new Error('temporary'), { classification: 'transient' }); } },
        now: '2026-10-01T10:00:00.000Z' });
    assert.equal(result.status, 'failed');
    assert.equal(fixture.database.prepare('SELECT status FROM notification_outbox').first().status, 'dead');
});

test('outbox claim is atomic across concurrent dispatcher invocations', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    makeOutboxDue(fixture);
    let releaseProvider;
    const providerStarted = new Promise((resolve) => { releaseProvider = resolve; });
    let finishProvider;
    const providerGate = new Promise((resolve) => { finishProvider = resolve; });
    const provider = { async dispatch() { releaseProvider(); await providerGate; return { status: 'sent' }; } };
    const first = dispatchNextNotification({ database: fixture.database, provider, now: '2026-10-01T10:00:00.000Z' });
    await providerStarted;
    const second = await dispatchNextNotification({ database: fixture.database, provider, now: '2026-10-01T10:00:01.000Z' });
    finishProvider();
    const firstResult = await first;
    assert.equal(firstResult.status, 'sent');
    assert.equal(second.status, 'empty');
    assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'system.notification_dispatch_result'")
        .first().count, 1);
});

test('stale leases recover before provider I/O but ambiguous in-flight leases become unknown', async () => {
    const fixture = await createNotificationFixture();
    await enqueueTestNotification(fixture);
    fixture.database.prepare(`UPDATE notification_outbox SET status = 'processing', attempt_count = 1,
        locked_at = '2026-10-01T09:00:00.000Z', lease_token = 'crashed-before-send', dispatch_started_at = NULL`)
        .run();
    const recovered = await dispatchNextNotification({ database: fixture.database,
        provider: { async dispatch() { return { status: 'sent' }; } }, now: TEST_NOW });
    assert.equal(recovered.status, 'sent');

    const ambiguousFixture = await createNotificationFixture();
    await enqueueTestNotification(ambiguousFixture);
    ambiguousFixture.database.prepare(`UPDATE notifications SET status = 'processing', provider_status = 'unknown'`).run();
    ambiguousFixture.database.prepare(`UPDATE notification_outbox SET status = 'processing', attempt_count = 1,
        locked_at = '2026-10-01T09:00:00.000Z', lease_token = 'crashed-during-send',
        dispatch_started_at = '2026-10-01T09:00:01.000Z'`).run();
    let providerCalls = 0;
    const noReplay = await dispatchNextNotification({ database: ambiguousFixture.database,
        provider: { async dispatch() { providerCalls += 1; return { status: 'sent' }; } }, now: TEST_NOW });
    assert.equal(noReplay.status, 'empty');
    assert.equal(providerCalls, 0);
    assert.equal(ambiguousFixture.database.prepare('SELECT provider_status FROM notifications').first().provider_status, 'unknown');
    assert.equal(ambiguousFixture.database.prepare('SELECT status FROM notification_outbox').first().status, 'dead');
});
