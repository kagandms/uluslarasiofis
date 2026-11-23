import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return {
        database,
        environment: {
            DB: database,
            APP_ENV: 'test',
            STAFF_SHARED_USERNAME: 'reviewer-1'
        }
    };
}

function createRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers();
    if (origin !== null) headers.set('Origin', origin);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database, {
    id = 'reviewer-1',
    username = id,
    token = 'reviewer-session-token-000000000000000000',
    role = 'reviewer',
    displayName = 'Görevli Kullanıcı'
} = {}) {
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, username, username.toLowerCase(), displayName, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date().toISOString()).run();
    return `staff_session=${token}`;
}

async function seedStudentSession(database, token = 'student-session-token-0000000000000000000') {
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('stu-1', '20260001', '20260001')
    `).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status)
        VALUES ('app-1', 'stu-1', 'initial', 'draft')
    `).run();
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, 'app-1', ?, '2099-01-01T00:00:00.000Z')
    `).bind(crypto.randomUUID(), await hashSessionToken(token)).run();
    return `application_session=${token}`;
}

async function seedInquiry(database, {
    id = crypto.randomUUID(),
    firstName = 'Ali',
    lastName = 'Yılmaz',
    phone = '+905551112233',
    email = 'ali@example.edu',
    message = 'İkamet randevusu hakkında bilgi almak istiyorum.',
    language = 'tr',
    nowIso = '2026-11-19T10:00:00.000Z'
} = {}) {
    return createD1Repositories(database).officeInquiries.create({
        id,
        firstName,
        lastName,
        phone,
        email,
        message,
        language,
        nowIso
    });
}

test('staff inquiry endpoints require an authenticated reviewer or admin session', async () => {
    const { environment, database } = createEnvironment();
    await seedInquiry(database, { id: 'inq-auth-1' });
    const studentCookie = await seedStudentSession(database);

    for (const [path, method, body] of [
        ['/api/staff/inquiries', 'GET', undefined],
        ['/api/staff/inquiries/inq-auth-1', 'PATCH', { status: 'answered' }],
        ['/api/staff/inquiries/inq-auth-1', 'DELETE', undefined]
    ]) {
        const anonymousResponse = await worker.fetch(createRequest(path, { method, body }), environment);
        assert.equal(anonymousResponse.status, 401);
        assert.equal((await anonymousResponse.json()).error.code, 'UNAUTHORIZED');

        const studentResponse = await worker.fetch(createRequest(path, { method, body, cookie: studentCookie }), environment);
        assert.equal(studentResponse.status, 401);
        assert.equal((await studentResponse.json()).error.code, 'UNAUTHORIZED');
    }

    const adminCookie = await seedStaff(environment, database, {
        id: 'admin-1',
        username: 'admin-1',
        token: 'admin-session-token-000000000000000000000',
        role: 'admin',
        displayName: 'Yönetici'
    });
    const adminList = await worker.fetch(createRequest('/api/staff/inquiries', { cookie: adminCookie }), environment);
    assert.equal(adminList.status, 200);
    assert.equal((await adminList.json()).items.length, 1);
});

test('GET /api/staff/inquiries lists inquiries with counts, filters by status, and enforces limit', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database, {
        id: 'reviewer-1',
        username: 'reviewer-1',
        role: 'reviewer',
        displayName: 'Deniz Görevli'
    });

    await seedInquiry(database, { id: 'inq-1', nowIso: '2026-11-19T08:00:00.000Z', email: null });
    await seedInquiry(database, { id: 'inq-2', nowIso: '2026-11-19T09:00:00.000Z' });
    await seedInquiry(database, { id: 'inq-3', nowIso: '2026-11-19T10:00:00.000Z' });

    await worker.fetch(createRequest('/api/staff/inquiries/inq-2', {
        method: 'PATCH',
        cookie: reviewerCookie,
        body: { status: 'answered' }
    }), environment);

    const allResponse = await worker.fetch(createRequest('/api/staff/inquiries?status=all&limit=10', {
        cookie: reviewerCookie
    }), environment);
    assert.equal(allResponse.status, 200);
    const allPayload = await allResponse.json();
    assert.deepEqual(allPayload.counts, { new: 2, answered: 1 });
    assert.deepEqual(allPayload.items.map((item) => item.id), ['inq-3', 'inq-2', 'inq-1']);
    assert.deepEqual(Object.keys(allPayload.items[0]).sort(), [
        'created_at', 'email', 'first_name', 'handled_at', 'handled_by_name',
        'id', 'language', 'last_name', 'message', 'phone', 'status'
    ]);

    const newOnly = await worker.fetch(createRequest('/api/staff/inquiries?status=new&limit=1', {
        cookie: reviewerCookie
    }), environment);
    const newPayload = await newOnly.json();
    assert.equal(newOnly.status, 200);
    assert.deepEqual(newPayload.counts, { new: 2, answered: 1 });
    assert.deepEqual(newPayload.items.map((item) => item.id), ['inq-3']);

    const answeredOnly = await worker.fetch(createRequest('/api/staff/inquiries?status=answered', {
        cookie: reviewerCookie
    }), environment);
    const answeredPayload = await answeredOnly.json();
    assert.equal(answeredOnly.status, 200);
    assert.deepEqual(answeredPayload.items.map((item) => item.id), ['inq-2']);
    assert.equal(answeredPayload.items[0].handled_by_name, 'Deniz Görevli');
    assert.ok(answeredPayload.items[0].handled_at);

    for (const invalidPath of [
        '/api/staff/inquiries?status=bogus',
        '/api/staff/inquiries?limit=0',
        '/api/staff/inquiries?limit=101',
        '/api/staff/inquiries?limit=abc'
    ]) {
        const invalidResponse = await worker.fetch(createRequest(invalidPath, { cookie: reviewerCookie }), environment);
        assert.equal(invalidResponse.status, 400);
        assert.equal((await invalidResponse.json()).error.code, 'VALIDATION_ERROR');
    }
});

test('PATCH /api/staff/inquiries/:id updates status, validates inputs, enforces same-origin, and handles unknown ids', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database, {
        id: 'reviewer-1',
        username: 'reviewer-1',
        displayName: 'Elif Görevli'
    });
    await seedInquiry(database, { id: 'inq-patch-1', message: 'GIZLI-MESAJ', phone: '+905550001122' });

    for (const origin of ['https://attacker.test', null]) {
        const crossOrigin = await worker.fetch(createRequest('/api/staff/inquiries/inq-patch-1', {
            method: 'PATCH',
            cookie: reviewerCookie,
            origin,
            body: { status: 'answered' }
        }), environment);
        assert.equal(crossOrigin.status, 403);
        assert.equal((await crossOrigin.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    }

    for (const invalidBody of [
        { status: 'bogus' },
        { status: 'redirected' },
        { status: 'closed' },
        { status: 'answered', extra: true },
        {}
    ]) {
        const badStatus = await worker.fetch(createRequest('/api/staff/inquiries/inq-patch-1', {
            method: 'PATCH',
            cookie: reviewerCookie,
            body: invalidBody
        }), environment);
        assert.equal(badStatus.status, 400);
        assert.equal((await badStatus.json()).error.code, 'VALIDATION_ERROR');
    }

    const unknown = await worker.fetch(createRequest('/api/staff/inquiries/unknown-inquiry-id', {
        method: 'PATCH',
        cookie: reviewerCookie,
        body: { status: 'answered' }
    }), environment);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'INQUIRY_NOT_FOUND');

    const answered = await worker.fetch(createRequest('/api/staff/inquiries/inq-patch-1', {
        method: 'PATCH',
        cookie: reviewerCookie,
        body: { status: 'answered' }
    }), environment);
    assert.equal(answered.status, 200);
    const answeredPayload = await answered.json();
    assert.equal(answeredPayload.item.status, 'answered');
    assert.equal(answeredPayload.item.handled_by_name, 'Elif Görevli');
    assert.ok(answeredPayload.item.handled_at);

    const reopened = await worker.fetch(createRequest('/api/staff/inquiries/inq-patch-1', {
        method: 'PATCH',
        cookie: reviewerCookie,
        body: { status: 'new' }
    }), environment);
    assert.equal(reopened.status, 200);
    const reopenedPayload = await reopened.json();
    assert.equal(reopenedPayload.item.status, 'new');
    assert.equal(reopenedPayload.item.handled_by_name, null);
    assert.equal(reopenedPayload.item.handled_at, null);
});

test('DELETE /api/staff/inquiries/:id enforces same-origin, 404 for unknown, removes row, and writes safe audit row', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database, {
        id: 'reviewer-1',
        username: 'reviewer-1',
        displayName: 'Can Görevli'
    });
    const sensitiveMessage = 'SILINECEK-OZEL-MESAJ';
    const sensitivePhone = '+905557778899';
    const sensitiveEmail = 'silinecek@example.edu';
    await seedInquiry(database, {
        id: 'inq-del-1',
        message: sensitiveMessage,
        phone: sensitivePhone,
        email: sensitiveEmail
    });

    for (const origin of ['https://attacker.test', null]) {
        const crossOrigin = await worker.fetch(createRequest('/api/staff/inquiries/inq-del-1', {
            method: 'DELETE',
            cookie: reviewerCookie,
            origin
        }), environment);
        assert.equal(crossOrigin.status, 403);
        assert.equal((await crossOrigin.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    }

    const unknownDelete = await worker.fetch(createRequest('/api/staff/inquiries/nonexistent-id', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(unknownDelete.status, 404);
    assert.equal((await unknownDelete.json()).error.code, 'INQUIRY_NOT_FOUND');

    const deletedResponse = await worker.fetch(createRequest('/api/staff/inquiries/inq-del-1', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).deleted, true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM office_inquiries').first().count, 0);

    const repeatDelete = await worker.fetch(createRequest('/api/staff/inquiries/inq-del-1', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(repeatDelete.status, 404);

    const audits = database.prepare(`
        SELECT event_type, actor_type, actor_staff_id, safe_metadata_json
        FROM audit_events
        WHERE event_type = 'staff.office_inquiry_deleted'
    `).all().results;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_type, 'staff');
    assert.equal(audits[0].actor_staff_id, 'reviewer-1');
    const meta = JSON.parse(audits[0].safe_metadata_json);
    assert.equal(Object.hasOwn(meta, 'message'), false);
    assert.equal(Object.hasOwn(meta, 'phone'), false);
    assert.equal(Object.hasOwn(meta, 'email'), false);
    assert.doesNotMatch(audits[0].safe_metadata_json, /SILINECEK-OZEL-MESAJ|\+905557778899|silinecek@example\.edu/);
});
