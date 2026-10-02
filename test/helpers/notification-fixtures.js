import { createOpaqueSessionToken, hashSessionToken } from '../../src/server/auth/sessionToken.js';
import worker from '../../src/server/worker.js';
import { applyAllMigrations } from './apply-migrations.js';
import { TestD1Database } from './d1-test-binding.js';

export const TEST_STAFF_ID = 'staff-notification-test';
export const TEST_STAFF_TOKEN = createOpaqueSessionToken();

export async function createNotificationFixture(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = { DB: database, STAFF_SHARED_USERNAME: 'reviewer', ...options };
    const applicantResponse = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_number: 'NOTIF-001', application_type: 'initial',
            email: 'student@example.invalid', phone: '+19995550123' })
    }), environment, {});
    const ownerCookie = applicantResponse.headers.get('Set-Cookie').split(';')[0];
    const application = database.prepare(`SELECT a.id FROM applications a
        JOIN students s ON s.id = a.student_id WHERE s.student_number = 'NOTIF-001'`).first();
    await database.prepare("UPDATE applications SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(application.id).run();
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, 'reviewer', 'reviewer', 'test-only-hash', 'Reviewer', 'reviewer')`).bind(TEST_STAFF_ID).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), TEST_STAFF_ID, await hashSessionToken(TEST_STAFF_TOKEN),
        new Date(Date.now() + 60_000).toISOString(), new Date().toISOString()).run();
    return { database, environment, applicationId: application.id, ownerCookie,
        staffCookie: `staff_session=${TEST_STAFF_TOKEN}` };
}

export function notificationRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test', headers = {} } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Origin', origin);
    if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
    if (cookie) requestHeaders.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, { method, headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body) });
}

export async function callWorker(environment, path, options) {
    return worker.fetch(notificationRequest(path, options), environment, {});
}

export async function enqueueTestNotification(fixture, { templateKey = 'status_updated', language = 'tr' } = {}) {
    fixture.environment.NOTIFICATION_PROVIDERS = { whatsapp: { isConfigured: true, dispatch: async () => ({ status: 'accepted' }) } };
    const preferencesResponse = await callWorker(fixture.environment, '/api/public/applications/current/notification-preferences', {
        method: 'PUT', cookie: fixture.ownerCookie,
        body: { whatsapp_opt_in: true, consent_version: 'whatsapp-consent-v1', language }
    });
    if (!preferencesResponse.ok) throw new Error('Test fixture could not save applicant consent.');
    const response = await callWorker(fixture.environment,
        `/api/staff/applications/${encodeURIComponent(fixture.applicationId)}/notifications`, {
            method: 'POST', cookie: fixture.staffCookie, headers: { 'Idempotency-Key': `notification-fixture-${crypto.randomUUID()}` },
            body: { channel: 'whatsapp', template_key: templateKey, language }
        });
    if (!response.ok) throw new Error('Test fixture could not enqueue notification.');
    return (await response.json()).notification;
}
