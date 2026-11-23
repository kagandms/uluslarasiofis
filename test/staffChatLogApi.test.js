/**
 * Yetkili "Sohbetler" API uç noktaları testleri:
 * GET /api/staff/chat-sessions, GET /api/staff/chat-sessions/:id,
 * DELETE /api/staff/chat-sessions/:id, DELETE /api/staff/chat-sessions?older_than_days=N,
 * GET /api/staff/chat-stats.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createChatLogRepository } from '../src/server/repositories/d1/chatLogRepository.js';
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

function createRequest(path, { method = 'GET', cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers();
    if (origin !== null) headers.set('Origin', origin);
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers
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

async function seedStudentSession(database, token = 'student-session-token-000000000000000000') {
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

async function seedTurn(database, {
    sessionId = crypto.randomUUID(),
    turnId = crypto.randomUUID(),
    language = 'tr',
    userText = 'İkamet belgesi nedir?',
    assistantText = 'İkamet başvurusu için gerekli belgeler şunlardır.',
    outcome = 'ok',
    tools = '[]',
    latencyMs = 42,
    nowIso = '2026-11-23T10:00:00.000Z',
    feedback = null
} = {}) {
    const repo = createChatLogRepository(database);
    const stored = await repo.appendTurn({
        sessionId,
        newSessionId: sessionId,
        turnId,
        language,
        userText,
        assistantText,
        outcome,
        tools,
        latencyMs,
        nowIso
    });
    if (feedback) {
        await repo.setFeedback({ turnId: stored.turnId, value: feedback, nowIso });
    }
    return stored;
}

test('staff chat log endpoints require an authenticated reviewer or admin session', async () => {
    const { environment, database } = createEnvironment();
    const { sessionId } = await seedTurn(database, { sessionId: 'sess-auth-1' });
    const studentCookie = await seedStudentSession(database);

    for (const [path, method] of [
        ['/api/staff/chat-stats', 'GET'],
        ['/api/staff/chat-sessions', 'GET'],
        [`/api/staff/chat-sessions/${sessionId}`, 'GET'],
        [`/api/staff/chat-sessions/${sessionId}`, 'DELETE'],
        ['/api/staff/chat-sessions?older_than_days=30', 'DELETE']
    ]) {
        const anonymousRes = await worker.fetch(createRequest(path, { method }), environment);
        assert.equal(anonymousRes.status, 401, `Anonymous ${method} ${path} should be 401`);
        assert.equal((await anonymousRes.json()).error.code, 'UNAUTHORIZED');

        const studentRes = await worker.fetch(createRequest(path, { method, cookie: studentCookie }), environment);
        assert.equal(studentRes.status, 401, `Student ${method} ${path} should be 401`);
        assert.equal((await studentRes.json()).error.code, 'UNAUTHORIZED');
    }

    const adminCookie = await seedStaff(environment, database, {
        id: 'admin-1',
        username: 'admin-1',
        token: 'admin-session-token-000000000000000000000',
        role: 'admin',
        displayName: 'Yönetici'
    });
    const adminList = await worker.fetch(createRequest('/api/staff/chat-sessions', { cookie: adminCookie }), environment);
    assert.equal(adminList.status, 200);
    assert.equal((await adminList.json()).items.length, 1);
});

test('GET /api/staff/chat-sessions paginates 25 newest-first with cursor and truncates first_user_text to 120 chars', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    const longText = 'A'.repeat(180);
    const baseMs = Date.parse('2026-11-23T08:00:00.000Z');
    for (let i = 1; i <= 27; i += 1) {
        const iso = new Date(baseMs + i * 60_000).toISOString();
        await seedTurn(database, {
            sessionId: `sess-${String(i).padStart(2, '0')}`,
            language: i % 2 === 0 ? 'en' : 'tr',
            userText: i === 27 ? longText : `Soru numarası ${i}`,
            assistantText: `Cevap ${i}`,
            nowIso: iso,
            feedback: i === 26 ? 'down' : null
        });
    }

    const page1Res = await worker.fetch(createRequest('/api/staff/chat-sessions', { cookie: reviewerCookie }), environment);
    assert.equal(page1Res.status, 200);
    const page1 = await page1Res.json();
    assert.equal(page1.items.length, 25);
    assert.equal(page1.items[0].id, 'sess-27');
    assert.equal(page1.items[24].id, 'sess-03');
    assert.ok(page1.nextCursor);

    // Check item shape and 120-char preview bound.
    const newest = page1.items[0];
    assert.equal(newest.language, 'tr');
    assert.equal(newest.turn_count, 1);
    assert.equal(newest.has_down_vote, false);
    assert.ok([...newest.first_user_text].length <= 120);
    assert.equal(page1.items[1].id, 'sess-26');
    assert.equal(page1.items[1].has_down_vote, true);

    const page2Res = await worker.fetch(
        createRequest(`/api/staff/chat-sessions?cursor=${encodeURIComponent(page1.nextCursor)}`, { cookie: reviewerCookie }),
        environment
    );
    assert.equal(page2Res.status, 200);
    const page2 = await page2Res.json();
    assert.deepEqual(page2.items.map((item) => item.id), ['sess-02', 'sess-01']);
    assert.equal(page2.nextCursor, null);

    // Invalid filter and cursor return 400.
    for (const invalidPath of [
        '/api/staff/chat-sessions?filter=invalid_filter',
        '/api/staff/chat-sessions?cursor=!!!not-a-cursor!!!'
    ]) {
        const res = await worker.fetch(createRequest(invalidPath, { cookie: reviewerCookie }), environment);
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    }
});

test('GET /api/staff/chat-sessions filters by down, handoff, refused, and fallback outcomes', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    await seedTurn(database, {
        sessionId: 'sess-ok',
        outcome: 'ok',
        feedback: 'up',
        nowIso: '2026-11-23T08:01:00.000Z'
    });
    await seedTurn(database, {
        sessionId: 'sess-down',
        outcome: 'ok',
        feedback: 'down',
        nowIso: '2026-11-23T08:02:00.000Z'
    });
    await seedTurn(database, {
        sessionId: 'sess-handoff-outcome',
        outcome: 'handoff',
        nowIso: '2026-11-23T08:03:00.000Z'
    });
    await seedTurn(database, {
        sessionId: 'sess-handoff-tool',
        outcome: 'ok',
        tools: '["handoff_to_office"]',
        nowIso: '2026-11-23T08:04:00.000Z'
    });
    await seedTurn(database, {
        sessionId: 'sess-refused',
        outcome: 'refusal',
        nowIso: '2026-11-23T08:05:00.000Z'
    });
    await seedTurn(database, {
        sessionId: 'sess-fallback',
        outcome: 'fallback',
        nowIso: '2026-11-23T08:06:00.000Z'
    });

    const expectIds = async (filter, expected) => {
        const res = await worker.fetch(
            createRequest(`/api/staff/chat-sessions?filter=${filter}`, { cookie: reviewerCookie }),
            environment
        );
        assert.equal(res.status, 200);
        const payload = await res.json();
        assert.deepEqual(payload.items.map((item) => item.id), expected, `filter=${filter}`);
    };

    await expectIds('all', [
        'sess-fallback',
        'sess-refused',
        'sess-handoff-tool',
        'sess-handoff-outcome',
        'sess-down',
        'sess-ok'
    ]);
    await expectIds('down', ['sess-down']);
    await expectIds('handoff', ['sess-handoff-tool', 'sess-handoff-outcome']);
    await expectIds('refused', ['sess-refused']);
    await expectIds('fallback', ['sess-fallback']);
});

test('GET /api/staff/chat-sessions/:id returns session with ordered turns and handles 400/404 without logging chat text', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    const secretUserText = 'GIZLI-OGRENCI-MESAJI-998877';
    const secretAssistantText = 'GIZLI-TOPI-CEVABI-998877';
    await seedTurn(database, {
        sessionId: 'sess-detail-1',
        userText: secretUserText,
        assistantText: secretAssistantText,
        outcome: 'ok',
        tools: '["lookup_knowledge"]',
        nowIso: '2026-11-23T09:00:00.000Z',
        feedback: 'up'
    });
    await seedTurn(database, {
        sessionId: 'sess-detail-1',
        userText: 'İkinci soru',
        assistantText: 'Ofise yönlendiriyorum.',
        outcome: 'handoff',
        tools: '[]',
        nowIso: '2026-11-23T09:02:00.000Z',
        feedback: 'down'
    });

    const logged = [];
    const originalInfo = console.info;
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.info = (...args) => logged.push(JSON.stringify(args));
    console.log = (...args) => logged.push(JSON.stringify(args));
    console.warn = (...args) => logged.push(JSON.stringify(args));
    console.error = (...args) => logged.push(JSON.stringify(args));

    try {
        const res = await worker.fetch(createRequest('/api/staff/chat-sessions/sess-detail-1', { cookie: reviewerCookie }), environment);
        assert.equal(res.status, 200);
        const payload = await res.json();
        assert.equal(payload.session.id, 'sess-detail-1');
        assert.equal(payload.session.language, 'tr');
        assert.equal(payload.session.turn_count, 2);
        assert.equal(payload.turns.length, 2);
        assert.equal(payload.turns[0].seq, 1);
        assert.equal(payload.turns[0].user_text, secretUserText);
        assert.equal(payload.turns[0].assistant_text, secretAssistantText);
        assert.equal(payload.turns[0].outcome, 'ok');
        assert.deepEqual(payload.turns[0].tools, ['lookup_knowledge']);
        assert.equal(payload.turns[0].feedback, 'up');
        assert.ok(payload.turns[0].created_at);

        assert.equal(payload.turns[1].seq, 2);
        assert.equal(payload.turns[1].outcome, 'handoff');
        assert.equal(payload.turns[1].feedback, 'down');

        const notFound = await worker.fetch(createRequest('/api/staff/chat-sessions/unknown-session-id', { cookie: reviewerCookie }), environment);
        assert.equal(notFound.status, 404);

        const tooLongId = 'x'.repeat(65);
        const badId = await worker.fetch(createRequest(`/api/staff/chat-sessions/${tooLongId}`, { cookie: reviewerCookie }), environment);
        assert.equal(badId.status, 400);
    } finally {
        console.info = originalInfo;
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    }

    const joinedLogs = logged.join('\n');
    assert.doesNotMatch(joinedLogs, /GIZLI-OGRENCI-MESAJI-998877|GIZLI-TOPI-CEVABI-998877/);
});

test('DELETE /api/staff/chat-sessions/:id enforces same-origin, returns 204, cascades turns, and writes safe audit row', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    await seedTurn(database, {
        sessionId: 'sess-del-1',
        userText: 'SILINECEK-MESAJ-ABC',
        assistantText: 'SILINECEK-YANIT-XYZ'
    });
    await seedTurn(database, {
        sessionId: 'sess-del-1',
        userText: 'İkinci tur'
    });

    for (const origin of ['https://attacker.test', null]) {
        const crossOrigin = await worker.fetch(createRequest('/api/staff/chat-sessions/sess-del-1', {
            method: 'DELETE',
            cookie: reviewerCookie,
            origin
        }), environment);
        assert.equal(crossOrigin.status, 403);
        assert.equal((await crossOrigin.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    }

    const unknownRes = await worker.fetch(createRequest('/api/staff/chat-sessions/no-such-session', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(unknownRes.status, 404);

    const deleteRes = await worker.fetch(createRequest('/api/staff/chat-sessions/sess-del-1', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(deleteRes.status, 204);
    assert.equal(await deleteRes.text(), '');

    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM chat_sessions WHERE id = ?').bind('sess-del-1').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM chat_turns WHERE session_id = ?').bind('sess-del-1').first().c, 0);

    const repeatRes = await worker.fetch(createRequest('/api/staff/chat-sessions/sess-del-1', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(repeatRes.status, 404);

    const audits = database.prepare(`
        SELECT event_type, actor_staff_id, safe_metadata_json
        FROM audit_events
        WHERE event_type = 'staff.chat_session_deleted'
    `).all().results;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_staff_id, 'reviewer-1');
    assert.doesNotMatch(audits[0].safe_metadata_json, /SILINECEK-MESAJ-ABC|SILINECEK-YANIT-XYZ/);
});

test('DELETE /api/staff/chat-sessions?older_than_days=N validates bounds, enforces same-origin, and cascades old sessions', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    const nowMs = Date.now();
    const oldIso40 = new Date(nowMs - 40 * 86_400_000).toISOString();
    const oldIso15 = new Date(nowMs - 15 * 86_400_000).toISOString();
    const recentIso2 = new Date(nowMs - 2 * 86_400_000).toISOString();

    await seedTurn(database, { sessionId: 'sess-old-40', nowIso: oldIso40 });
    await seedTurn(database, { sessionId: 'sess-old-15', nowIso: oldIso15 });
    await seedTurn(database, { sessionId: 'sess-recent-2', nowIso: recentIso2 });

    for (const origin of ['https://attacker.test', null]) {
        const crossOrigin = await worker.fetch(createRequest('/api/staff/chat-sessions?older_than_days=30', {
            method: 'DELETE',
            cookie: reviewerCookie,
            origin
        }), environment);
        assert.equal(crossOrigin.status, 403);
    }

    for (const badPath of [
        '/api/staff/chat-sessions',
        '/api/staff/chat-sessions?older_than_days=0',
        '/api/staff/chat-sessions?older_than_days=-5',
        '/api/staff/chat-sessions?older_than_days=3651',
        '/api/staff/chat-sessions?older_than_days=12.5',
        '/api/staff/chat-sessions?older_than_days=abc'
    ]) {
        const badRes = await worker.fetch(createRequest(badPath, {
            method: 'DELETE',
            cookie: reviewerCookie
        }), environment);
        assert.equal(badRes.status, 400, `Expected 400 for ${badPath}`);
        assert.equal((await badRes.json()).error.code, 'VALIDATION_ERROR');
    }

    // Boundary 3650 is valid and deletes nothing here.
    const maxBoundRes = await worker.fetch(createRequest('/api/staff/chat-sessions?older_than_days=3650', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(maxBoundRes.status, 200);
    assert.equal((await maxBoundRes.json()).deleted, 0);

    // Delete older than 10 days -> removes sess-old-40 and sess-old-15, keeps sess-recent-2.
    const deleteRes = await worker.fetch(createRequest('/api/staff/chat-sessions?older_than_days=10', {
        method: 'DELETE',
        cookie: reviewerCookie
    }), environment);
    assert.equal(deleteRes.status, 200);
    assert.equal((await deleteRes.json()).deleted, 2);

    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM chat_sessions').first().c, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM chat_turns').first().c, 1);
    assert.equal(database.prepare('SELECT id FROM chat_sessions').first().id, 'sess-recent-2');
});

test('GET /api/staff/chat-stats counts today and last7 using Europe/Istanbul day boundary', async () => {
    const { environment, database } = createEnvironment();
    const reviewerCookie = await seedStaff(environment, database);

    // Compute current Istanbul midnight in UTC.
    const todayIstanbulYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    const todayStartMs = Date.parse(`${todayIstanbulYmd}T00:00:00+03:00`);

    // 5 minutes after Istanbul midnight -> today AND last7
    const todayAfterMidnightIso = new Date(todayStartMs + 5 * 60_000).toISOString();
    // 10 minutes after Istanbul midnight -> today AND last7
    const todaySecondIso = new Date(todayStartMs + 10 * 60_000).toISOString();
    // 5 minutes before Istanbul midnight -> yesterday in Istanbul -> last7 ONLY
    const yesterdayLateIso = new Date(todayStartMs - 5 * 60_000).toISOString();
    // 5 days before Istanbul midnight -> last7 ONLY
    const fiveDaysAgoIso = new Date(todayStartMs - 5 * 86_400_000 + 60_000).toISOString();
    // 10 days before Istanbul midnight -> NEITHER
    const tenDaysAgoIso = new Date(todayStartMs - 10 * 86_400_000).toISOString();

    await seedTurn(database, { sessionId: 's-stat-1', nowIso: todayAfterMidnightIso, feedback: 'up' });
    await seedTurn(database, { sessionId: 's-stat-2', nowIso: todaySecondIso, feedback: 'down' });
    await seedTurn(database, { sessionId: 's-stat-3', nowIso: yesterdayLateIso, feedback: 'up' });
    await seedTurn(database, { sessionId: 's-stat-4', nowIso: fiveDaysAgoIso, feedback: null });
    await seedTurn(database, { sessionId: 's-stat-5', nowIso: tenDaysAgoIso, feedback: 'down' });

    const res = await worker.fetch(createRequest('/api/staff/chat-stats', { cookie: reviewerCookie }), environment);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.deepEqual(payload.today, { answers: 2, up: 1, down: 1 });
    assert.deepEqual(payload.last7, { answers: 4, up: 2, down: 1 });
});
