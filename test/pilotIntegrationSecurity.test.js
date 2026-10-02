import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { createApplicationRepository } from '../src/server/repositories/d1/applicationRepository.js';
import { createSessionRepository } from '../src/server/repositories/d1/sessionRepository.js';
import { generateAccessCode } from '../src/server/auth/applicationAccessCode.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

async function send(environment, path, options = {}) {
    const headers = { Origin: 'https://portal.test', 'CF-Connecting-IP': options.ip || '198.51.100.75' };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.body) headers['Content-Type'] = 'application/json';
    return worker.fetch(new Request(`https://portal.test${path}`, { method: options.method || 'POST', headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}) }), environment);
}

async function createFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'integration-reviewer' };
    const response = await send(environment, '/api/public/applications', { body: {
        student_number: 'INTEGRATION-SYNTHETIC', application_type: 'initial', email: 'synthetic@example.invalid', phone: '+905551112233'
    } });
    assert.equal(response.status, 201);
    const credentials = await response.json();
    const application = database.prepare('SELECT * FROM applications').first();
    return { database, environment, credentials, application, cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

function interceptNextBatch(database, beforeCommit) {
    const runBatch = database.batch.bind(database);
    database.batch = async (statements) => {
        database.batch = runBatch;
        beforeCommit();
        return runBatch(statements);
    };
}

test('an owner rotation authenticated before staff reset cannot overwrite the reset after its session is revoked', async () => {
    const fixture = await createFixture();
    const resetHash = '0'.repeat(64);
    interceptNextBatch(fixture.database, () => fixture.database.exec(`
        UPDATE applications SET access_code_hash='${resetHash}',access_code_version=2;
        UPDATE application_sessions SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
    `));

    const response = await send(fixture.environment, '/api/public/applications/current/regenerate-access-code', { cookie: fixture.cookie });

    assert.equal(response.status, 409);
    assert.equal(fixture.database.prepare('SELECT access_code_hash FROM applications').first().access_code_hash, resetHash);
    assert.equal((await response.json()).access_code, undefined);
});

test('only one reset with the same observed code version can commit and a stale reset has no revocation or audit effect', async () => {
    const { database, application } = await createFixture();
    const repository = createApplicationRepository(database);
    const input = { applicationId: application.id, accessCodeHash: 'a'.repeat(64), accessCodeCreatedAt: new Date().toISOString(),
        auditEventId: 'first-reset', requestId: 'reset-proof', actorType: 'staff', expectedAccessCodeVersion: 1 };
    assert.ok(await repository.updateAccessCode(input));
    database.prepare("UPDATE application_sessions SET revoked_at=NULL").run();

    const stale = await repository.updateAccessCode({ ...input, accessCodeHash: 'b'.repeat(64), auditEventId: 'stale-reset' });

    assert.equal(stale, null);
    assert.equal(database.prepare('SELECT access_code_hash FROM applications').first().access_code_hash, input.accessCodeHash);
    assert.equal(database.prepare("SELECT count(*) AS count FROM application_sessions WHERE revoked_at IS NULL").first().count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM audit_events WHERE id='stale-reset'").first().count, 0);
});

test('terminal transition between code verification and session insertion cannot create an owner session', async () => {
    const { database, application } = await createFixture();
    database.prepare("UPDATE applications SET status='completed'").run();

    const created = await createSessionRepository(database).createApplicationSessionGuarded({ id: 'terminal-login', applicationId: application.id,
        tokenHash: 'terminal-test-hash', createdAt: new Date().toISOString(), expiresAt: '2999-01-01T00:00:00.000Z', expectedAccessCodeVersion: 1 });

    assert.equal(created, false);
    assert.equal(database.prepare("SELECT count(*) AS count FROM application_sessions WHERE id='terminal-login'").first().count, 0);
});

test('a login whose code was verified before reset cannot insert a session after reset commits', async () => {
    const { database, environment, credentials } = await createFixture();
    const prepareStatement = database.prepare.bind(database);
    database.prepare = (sql) => {
        const statement = prepareStatement(sql);
        if (!sql.includes('AND access_code_version = ?')) return statement;
        const bindStatement = statement.bind.bind(statement);
        statement.bind = (...values) => {
            database.prepare = prepareStatement;
            database.exec("UPDATE applications SET access_code_version=2; UPDATE application_sessions SET revoked_at='2026-01-01T00:00:00.000Z'");
            return bindStatement(...values);
        };
        return statement;
    };

    const response = await send(environment, '/api/public/applications/access', { body: {
        reference_number: credentials.reference_number, access_code: credentials.access_code
    } });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(database.prepare('SELECT count(*) AS count FROM application_sessions WHERE revoked_at IS NULL').first().count, 0);
});

test('application type switch is fenced at commit when another device changes fields after its version precheck', async () => {
    const { database, application } = await createFixture();
    const repository = createApplicationRepository(database);
    database.prepare(`INSERT INTO document_records(id,application_id,requirement_id,application_type) VALUES('switch-record',?,'req-initial-passport','initial')`).bind(application.id).run();
    interceptNextBatch(database, () => database.prepare("UPDATE applications SET first_name='Fresh device edit',lock_version=2").run());

    await assert.rejects(repository.updateDraft(application.id, { applicationType: 'renewal', firstName: 'Stale device edit' },
        { auditEventId: 'stale-type-switch', requestId: 'type-proof' }, 1), { code: 'APPLICATION_UPDATE_CONFLICT' });

    const persisted = database.prepare('SELECT first_name,application_type,lock_version FROM applications').first();
    assert.deepEqual({ ...persisted }, { first_name: 'Fresh device edit', application_type: 'initial', lock_version: 2 });
    assert.equal(database.prepare("SELECT application_type FROM document_records WHERE id='switch-record'").first().application_type, 'initial');
});

test('successful credential logins from campus NAT and a guessed-reference flood cannot lock out a valid owner', async () => {
    const { environment, credentials } = await createFixture();
    const body = { reference_number: credentials.reference_number, access_code: credentials.access_code };

    for (let attempt = 0; attempt < 65; attempt += 1) {
        const response = await send(environment, '/api/public/applications/access', { body });
        assert.equal(response.status, 200, `valid campus login ${attempt + 1}`);
    }
    for (let attempt = 0; attempt < 7; attempt += 1) {
        await send(environment, '/api/public/applications/access', { body: { ...body, access_code: generateAccessCode() } });
    }

    assert.equal((await send(environment, '/api/public/applications/access', { body })).status, 200);
});

test('failed reset audit rolls back hash, version and every session revocation', async () => {
    const { database, application } = await createFixture();
    const sessionBefore = database.prepare('SELECT * FROM application_sessions').first();
    const auditBefore = database.prepare('SELECT id FROM audit_events LIMIT 1').first();

    await assert.rejects(createApplicationRepository(database).updateAccessCode({ applicationId: application.id, accessCodeHash: 'a'.repeat(64),
        accessCodeCreatedAt: new Date().toISOString(), auditEventId: auditBefore.id, requestId: 'rollback-proof', revokeSessions: true,
        actorType: 'staff', expectedAccessCodeVersion: 1 }));

    assert.equal(database.prepare('SELECT access_code_hash FROM applications').first().access_code_hash, application.access_code_hash);
    assert.equal(database.prepare('SELECT access_code_version FROM applications').first().access_code_version, 1);
    assert.equal(database.prepare('SELECT revoked_at FROM application_sessions').first().revoked_at, sessionBefore.revoked_at);
});

test('public draft updates require a positive integer observed version and cannot bypass stale-write protection', async () => {
    const { database, environment, cookie } = await createFixture();

    for (const version of [undefined, null, 0, 1.5, '1']) {
        const response = await send(environment, '/api/public/applications/current', { method: 'PATCH', cookie,
            body: { first_name: 'Unversioned stale write', ...(version === undefined ? {} : { lock_version: version }) } });
        assert.equal(response.status, 400);
    }

    assert.equal(database.prepare('SELECT first_name FROM applications').first().first_name, null);
    assert.equal(database.prepare('SELECT lock_version FROM applications').first().lock_version, 1);
});
