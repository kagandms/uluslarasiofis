import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateAccessCode, hashAccessCode } from '../src/server/auth/applicationAccessCode.js';
import { createOpaqueSessionToken, hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createAccessCodeRotationStatements } from '../src/server/repositories/d1/application-access-statements.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import {
    consumeRecoveryApplicationRateLimit,
    consumeRecoveryIpRateLimit,
    consumeRecoveryTelegramUserRateLimit,
    consumeReferenceReminderMailQuota,
    findRecoverableApplication,
    normalizeRecoveryLanguage
} from '../src/server/services/accessRecoveryService.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

async function createSeededDatabase() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const repositories = createD1Repositories(database);
    const initialCode = generateAccessCode();
    const initialHash = await hashAccessCode(initialCode);
    const sessionToken = createOpaqueSessionToken();
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    const application = await repositories.applications.createDraftWithSession({
        applicationId: crypto.randomUUID(),
        studentId: crypto.randomUUID(),
        studentNumber: 'SYN-REC-SVC-01',
        applicationType: 'initial',
        studentEmail: 'recovery-svc@example.invalid',
        studentPhone: '+905550000101',
        sessionId,
        tokenHash: await hashSessionToken(sessionToken),
        expiresAt,
        createdAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_seed_1',
        accessCodeHash: initialHash
    });

    return { database, repositories, application, initialCode, initialHash, sessionId };
}

test('findRecoverableApplication returns active non-deleted application only', async () => {
    const { database, application } = await createSeededDatabase();

    await database.prepare(`
        INSERT INTO notification_preferences (
            application_id, whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_consent_version,
            whatsapp_consent_language, whatsapp_phone_hash, whatsapp_opt_out_at, updated_at
        ) VALUES (?, 1, CURRENT_TIMESTAMP, 'whatsapp-consent-v1', 'ru', 'dummy-hash', NULL, CURRENT_TIMESTAMP)
    `).bind(application.id).run();

    const found = await findRecoverableApplication(database, { studentNumber: '  syn-rec-svc-01  ' });
    assert.deepEqual(found, {
        applicationId: application.id,
        referenceNumber: application.reference_number,
        studentEmail: 'recovery-svc@example.invalid',
        studentPhone: '+905550000101',
        language: 'ru'
    });

    assert.equal(await findRecoverableApplication(database, { studentNumber: 'UNKNOWN-999' }), null);
    assert.equal(await findRecoverableApplication(database, { studentNumber: '' }), null);

    // Terminal durumlar kurtarılamaz.
    for (const terminalStatus of ['completed', 'cancelled', 'rejected']) {
        await database.prepare('UPDATE applications SET status = ? WHERE id = ?').bind(terminalStatus, application.id).run();
        assert.equal(await findRecoverableApplication(database, { studentNumber: 'SYN-REC-SVC-01' }), null);
    }

    // Aktife döndürülüp arşivlenirse (application_deletions) yine kurtarılamaz.
    await database.prepare("UPDATE applications SET status = 'submitted' WHERE id = ?").bind(application.id).run();
    assert.ok(await findRecoverableApplication(database, { studentNumber: 'SYN-REC-SVC-01' }));

    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-del-1', 'admin', 'admin', 'test-hash', 'Admin', 'admin')`).run();
    await database.prepare(`INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES (?, 'submitted', 'soft_deleted', 'staff-del-1', CURRENT_TIMESTAMP)`).bind(application.id).run();
    assert.equal(await findRecoverableApplication(database, { studentNumber: 'SYN-REC-SVC-01' }), null);
});

test('createAccessCodeRotationStatements preserves student and staff rotation behavior and rejects recovery actor', async () => {
    const { database, application, sessionId } = await createSeededDatabase();
    const now = new Date().toISOString();

    // student: açık oturum gerektirir, oturumları iptal etmez, application.access_code_regenerated yazar.
    const studentHash = await hashAccessCode(generateAccessCode());
    const studentWithoutSession = await database.batch(createAccessCodeRotationStatements(database, {
        applicationId: application.id,
        accessCodeHash: studentHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_student_fail',
        expectedAccessCodeVersion: 1,
        actorType: 'student',
        ownerSessionId: 'non-existent-session'
    }));
    assert.equal(studentWithoutSession[0].meta.changes, 0);

    const studentSuccess = await database.batch(createAccessCodeRotationStatements(database, {
        applicationId: application.id,
        accessCodeHash: studentHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_student_ok',
        expectedAccessCodeVersion: 1,
        actorType: 'student',
        ownerSessionId: sessionId
    }));
    assert.equal(studentSuccess[0].meta.changes, 1);
    assert.equal(studentSuccess[1].meta.changes, 1);
    assert.equal(database.prepare('SELECT revoked_at FROM application_sessions WHERE id = ?').bind(sessionId).first().revoked_at, null);
    assert.equal(
        database.prepare("SELECT event_type, actor_type FROM audit_events WHERE request_id = 'req_student_ok'").first().event_type,
        'application.access_code_regenerated'
    );

    // Kaldırılan 'recovery' actorType dalı artık reddedilmelidir.
    assert.throws(() => createAccessCodeRotationStatements(database, {
        applicationId: application.id,
        accessCodeHash: studentHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_removed_recovery',
        expectedAccessCodeVersion: 2,
        actorType: 'recovery',
        channel: 'email'
    }), TypeError);

    // staff: açık oturumları iptal eder ve staff.application_access_code_reset yazar.
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-rot-1', 'admin', 'admin', 'test-hash', 'Admin', 'admin')`).run();
    const staffSuccess = await database.batch(createAccessCodeRotationStatements(database, {
        applicationId: application.id,
        accessCodeHash: await hashAccessCode(generateAccessCode()),
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_staff_ok',
        expectedAccessCodeVersion: 2,
        actorType: 'staff',
        actorStaffId: 'staff-rot-1'
    }));
    assert.equal(staffSuccess[0].meta.changes, 1);
    assert.equal(staffSuccess[1].meta.changes, 1);
    assert.ok(database.prepare('SELECT revoked_at FROM application_sessions WHERE id = ?').bind(sessionId).first().revoked_at);
    assert.equal(
        database.prepare("SELECT event_type, actor_type FROM audit_events WHERE request_id = 'req_staff_ok'").first().event_type,
        'staff.application_access_code_reset'
    );

    assert.throws(() => createAccessCodeRotationStatements(database, {
        applicationId: application.id,
        accessCodeHash: studentHash,
        accessCodeCreatedAt: now,
        auditEventId: crypto.randomUUID(),
        requestId: 'req_bad',
        expectedAccessCodeVersion: 1,
        actorType: 'unknown'
    }), TypeError);
});

test('recovery rate limit helpers enforce 3/day per application, 5/15m per IP, 3/day per Telegram user and 30/day global mail quota', async () => {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const { rateLimits } = createD1Repositories(database);
    const nowSeconds = 1_760_000_000;

    for (let i = 0; i < 3; i += 1) {
        assert.equal(await consumeRecoveryApplicationRateLimit(rateLimits, { applicationId: 'app-1', nowSeconds }), true);
    }
    assert.equal(await consumeRecoveryApplicationRateLimit(rateLimits, { applicationId: 'app-1', nowSeconds }), false);
    assert.equal(await consumeRecoveryApplicationRateLimit(rateLimits, { applicationId: 'app-2', nowSeconds }), true);

    for (let i = 0; i < 5; i += 1) {
        assert.equal(await consumeRecoveryIpRateLimit(rateLimits, { clientAddress: '198.51.100.10', nowSeconds }), true);
    }
    assert.equal(await consumeRecoveryIpRateLimit(rateLimits, { clientAddress: '198.51.100.10', nowSeconds }), false);

    for (let i = 0; i < 3; i += 1) {
        assert.equal(await consumeRecoveryTelegramUserRateLimit(rateLimits, { telegramUserId: 'tg-100', nowSeconds }), true);
    }
    assert.equal(await consumeRecoveryTelegramUserRateLimit(rateLimits, { telegramUserId: 'tg-100', nowSeconds }), false);

    for (let i = 0; i < 30; i += 1) {
        assert.equal(await consumeReferenceReminderMailQuota(rateLimits, { nowSeconds }), true);
    }
    assert.equal(await consumeReferenceReminderMailQuota(rateLimits, { nowSeconds }), false);
    assert.equal(await consumeReferenceReminderMailQuota(rateLimits, { nowSeconds: nowSeconds + 86_401 }), true);

    assert.equal(normalizeRecoveryLanguage('tk'), 'tk');
    assert.equal(normalizeRecoveryLanguage('xx'), null);
});
