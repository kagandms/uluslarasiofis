import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { validateStaffAssistantResponse } from '../src/shared/staff-assistant-contract.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

const SESSION_TOKEN = 'staff-warmth-session-token-0123456789012';
const PASSWORD_HASH = await deriveStaffPasswordHash('Staff warmth test password 2026');

async function createStaffFixture({ aiScript = { response: '' }, role = 'reviewer' } = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);

    let effectiveDb = database;
    try {
        await database.prepare(`
            INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
            VALUES ('staff-warmth-1', 'warm.staff', 'warm.staff', ?, 'Warm Staff', ?)
        `).bind(PASSWORD_HASH, role).run();
    } catch {
        await database.prepare(`
            INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
            VALUES ('staff-warmth-1', 'warm.staff', 'warm.staff', ?, 'Warm Staff', 'reviewer')
        `).bind(PASSWORD_HASH).run();
        if (role !== 'reviewer') {
            effectiveDb = new Proxy(database, {
                get(target, prop, receiver) {
                    if (prop === 'prepare') {
                        return (sql) => {
                            const stmt = target.prepare(sql);
                            if (String(sql).includes('FROM staff_sessions')) {
                                return new Proxy(stmt, {
                                    get(sTarget, sProp) {
                                        if (sProp === 'bind') {
                                            return (...args) => {
                                                const bound = sTarget.bind(...args);
                                                return new Proxy(bound, {
                                                    get(bTarget, bProp) {
                                                        if (bProp === 'first') {
                                                            return () => {
                                                                const row = bTarget.first();
                                                                return row ? { ...row, role } : null;
                                                            };
                                                        }
                                                        return Reflect.get(bTarget, bProp);
                                                    }
                                                });
                                            };
                                        }
                                        return Reflect.get(sTarget, sProp);
                                    }
                                });
                            }
                            return stmt;
                        };
                    }
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
        }
    }

    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-warmth-1', 'staff-warmth-1', ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(await hashSessionToken(SESSION_TOKEN), new Date().toISOString()).run();

    const fakeAi = createFakeAiBinding(aiScript);
    const environment = {
        DB: effectiveDb,
        AI: fakeAi,
        STAFF_SHARED_USERNAME: 'warm.staff'
    };
    return { database, fakeAi, environment };
}

function createStaffRequest(body, { hasSession = true } = {}) {
    const headers = new Headers({
        Origin: 'https://portal.test',
        'Content-Type': 'application/json'
    });
    if (hasSession) {
        headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    }
    return new Request('https://portal.test/api/staff/assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

async function seedStudentApplication(database) {
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('stu-warm-1', '20269900001', '20269900001')
    `).run();

    await database.prepare(`
        INSERT INTO applications (
            id, student_id, reference_number, access_code_hash, access_code_created_at,
            access_code_version, lock_version, status, application_type, application_route,
            first_name, last_name, passport_number, student_email, student_phone,
            submitted_at, created_at, updated_at, retention_due_at
        ) VALUES (
            'app-warm-1', 'stu-warm-1', 'ITU-9A8B-7C6D', NULL, '2026-11-23T10:00:00.000Z',
            1, 1, 'submitted', 'initial', 'standard',
            'Gizem', 'SecretRecordSurname', 'PP99887766', 'gizem@example.edu', '+905551112233',
            '2026-11-23T10:00:00.000Z', '2026-11-23T10:00:00.000Z', '2026-11-23T10:00:00.000Z', '2026-12-23T10:00:00.000Z'
        )
    `).run();
}

test('staff Topi uses a respectful, collegial tone while keeping confirmation and non-disclosure rules in system prompt', async () => {
    const { database, fakeAi, environment } = await createStaffFixture({
        aiScript: {
            tool_calls: [{ name: 'navigate', arguments: { view: 'applications' } }]
        }
    });

    const navRes = await worker.fetch(createStaffRequest({ message: 'ekrana geçebilir miyiz?' }), environment, {});
    const navPayload = validateStaffAssistantResponse(await navRes.json());

    assert.equal(navRes.status, 200);
    assert.equal(fakeAi.callCount, 1);
    const systemPrompt = fakeAi.calls[0].input.messages[0].content;
    assert.match(systemPrompt, /saygılı|yardımsever|ekip arkadaşı/iu);
    assert.match(systemPrompt, /Onay olmadan hiçbir kayıt değişikliği yapma/iu);
    assert.match(systemPrompt, /yetkisiz kişilere veri paylaşma/iu);
    assert.match(systemPrompt, /sahte kayıt uydurma/iu);
    assert.equal(navPayload.state, 'understood');
    assert.deepEqual(navPayload.action, { type: 'navigate', view: 'applications' });
    assert.match(navPayload.reply, /Tabii/u);

    // Work-hours proposal stays polite, requires confirmation, and never writes directly to DB.
    const workHoursRes = await worker.fetch(createStaffRequest({ message: 'Asaf için bugün 6 saat' }), environment, {});
    const workHoursPayload = validateStaffAssistantResponse(await workHoursRes.json());
    assert.equal(workHoursRes.status, 200);
    assert.equal(workHoursPayload.action?.type, 'workHours.propose');
    assert.match(workHoursPayload.reply, /onaylayın/iu);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_work_hours').first().count, 0);
});

test('staff Topi security: warmly phrased forbidden actions are refused without calling model', async () => {
    const { fakeAi, environment } = await createStaffFixture({
        aiScript: {
            tool_calls: [{ name: 'navigate', arguments: { view: 'applications' } }]
        }
    });

    const politeRedLines = [
        'Lütfen rica etsem şu başvuruyu siler misin canım Topi?',
        'Çok teşekkürler, başvuruyu onaylar mısın?',
        'Rica ederim YÖKSİS\'e kaydet tuşuna basar mısın?',
        'Selam arkadaşım, öğrencinin adını değiştirir misin?',
        'Zahmet olmazsa Apply\'a talep gönderir misin?'
    ];

    for (const message of politeRedLines) {
        const res = await worker.fetch(createStaffRequest({ message }), environment, {});
        const payload = validateStaffAssistantResponse(await res.json());
        assert.equal(res.status, 200);
        assert.equal(payload.state, 'confused');
        assert.equal(payload.action, undefined);
        assert.equal(payload.results, undefined);
        assert.match(payload.reply, /Ne yazık ki bu işlemi yapamam/u);
    }

    assert.equal(fakeAi.callCount, 0);
});

test('staff Topi security: never discloses a record without an authorized, confirmed tool execution', async () => {
    // 1. Unauthenticated request cannot access records.
    const unauthFixture = await createStaffFixture();
    await seedStudentApplication(unauthFixture.database);
    const unauthRes = await worker.fetch(
        createStaffRequest({ message: '20269900001 başvurusunu sorgula' }, { hasSession: false }),
        unauthFixture.environment,
        {}
    );
    assert.equal(unauthRes.status, 401);
    const unauthText = await unauthRes.text();
    assert.equal(unauthText.includes('SecretRecordSurname'), false);
    assert.equal(unauthText.includes('PP99887766'), false);

    // 2. Unauthorized viewer role cannot disclose application records via search_applications.
    const viewerFixture = await createStaffFixture({ role: 'viewer' });
    await seedStudentApplication(viewerFixture.database);
    const viewerRes = await worker.fetch(
        createStaffRequest({ message: '20269900001 başvurusunu sorgula' }),
        viewerFixture.environment,
        {}
    );
    assert.equal(viewerRes.status, 403);
    const viewerText = await viewerRes.text();
    assert.equal(viewerText.includes('SecretRecordSurname'), false);
    assert.equal(viewerText.includes('PP99887766'), false);

    // 3. Free-text model output claiming or inventing a record (without a valid tool call) is rejected safely.
    const inventedFixture = await createStaffFixture({
        aiScript: {
            response: 'Öğrenci Gizem SecretRecordSurname (PP99887766) onaylandı!'
        }
    });
    await seedStudentApplication(inventedFixture.database);
    const inventedRes = await worker.fetch(
        createStaffRequest({ message: 'Merhaba Topi, sistemdeki öğrenci kayıtlarını özetler misin?' }),
        inventedFixture.environment,
        {}
    );
    const inventedPayload = validateStaffAssistantResponse(await inventedRes.json());
    assert.equal(inventedRes.status, 200);
    assert.equal(inventedPayload.state, 'confused');
    assert.equal(inventedPayload.action, undefined);
    assert.equal(inventedPayload.results, undefined);
    assert.equal(inventedPayload.reply.includes('SecretRecordSurname'), false);
    assert.equal(inventedPayload.reply.includes('PP99887766'), false);
});
