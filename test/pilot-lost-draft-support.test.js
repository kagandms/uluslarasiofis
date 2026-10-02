import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, chmodSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDraftSupportQuery } from '../scripts/pilot/draft-support-query.mjs';
import { createRealScannerFixture, portalRequest } from './helpers/scanner-real-fixture.js';

async function createLostDraft(context, studentNumber) {
    const response = await portalRequest(context, '/api/public/applications', { method: 'POST', body: {
        student_number: studentNumber, application_type: 'initial', email: 'synthetic@example.invalid', phone: '+905551112233' } });
    assert.equal(response.status, 201);
    return { ...(await response.json()), cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

async function loginWithCode(context, credentials) {
    return portalRequest(context, '/api/public/applications/access', { method: 'POST', body: {
        reference_number: credentials.reference_number, access_code: credentials.access_code } });
}

async function checkHiddenDraft(context, candidate, studentNumber) {
    const list = await portalRequest(context, '/api/staff/applications/query', { cookie: context.staffCookie,
        method: 'POST', body: { q: studentNumber } });
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).items, []);
    const detail = await portalRequest(context, `/api/staff/applications/${candidate.application_id}`, { cookie: context.staffCookie });
    assert.equal(detail.status, 404);
    const duplicate = await portalRequest(context, '/api/public/applications', { method: 'POST', body: {
        student_number: studentNumber, application_type: 'initial', email: 'synthetic@example.invalid', phone: '+905551112233' } });
    assert.equal(duplicate.status, 409);
}

for (const kind of ['reference', 'student-number']) {
    test(`verified operator ${kind} lookup recovers a hidden draft using only the staff reset API`, async () => {
        const context = await createRealScannerFixture();
        try {
            const credentials = await createLostDraft(context, 'LOST-DRAFT');
            const value = kind === 'reference' ? credentials.reference_number.toLowerCase() : ' lost-draft ';
            const candidates = context.database.database.prepare(buildDraftSupportQuery({ kind, value })).all();
            assert.equal(candidates.length, 1);
            assert.deepEqual(Object.keys(candidates[0]).sort(), ['application_id', 'reference_number', 'status']);
            const candidate = candidates[0];
            assert.equal(candidate.status, 'draft');
            await checkHiddenDraft(context, candidate, 'LOST-DRAFT');
            const second = await loginWithCode(context, credentials);
            const reset = await portalRequest(context, `/api/staff/applications/${candidate.application_id}/reset-access-code`, {
                cookie: context.staffCookie, method: 'POST', body: {} });

            assert.equal(reset.status, 200);

            const renewed = await reset.json();
            assert.equal(renewed.reference_number, credentials.reference_number);
            assert.equal((await loginWithCode(context, credentials)).status, 401);
            for (const cookie of [credentials.cookie, second.headers.get('Set-Cookie').split(';')[0]]) {
                assert.equal((await portalRequest(context, '/api/public/applications/current', { cookie })).status, 401);
            }
            assert.equal((await loginWithCode(context, renewed)).status, 200);
            assert.equal(context.database.prepare('SELECT count(*) AS count FROM applications').first().count, 1);
        } finally { context.database.database.close(); }
    });
}

test('support lookup treats SQL metacharacters as literal identity text and never changes a record', async () => {
    const context = await createRealScannerFixture();
    await createLostDraft(context, "X' OR 1=1; --");
    await createLostDraft(context, 'UNRELATED-STUDENT');
    const before = context.database.prepare('SELECT count(*) AS count FROM applications').first().count;

    const literal = context.database.database.prepare(buildDraftSupportQuery({ kind: 'student-number', value: "X' OR 1=1; --" })).all();
    const unrelated = context.database.database.prepare(buildDraftSupportQuery({ kind: 'student-number', value: "MISSING' OR 1=1; --" })).all();

    assert.equal(literal.length, 1);
    assert.equal(unrelated.length, 0);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM applications').first().count, before);
    context.database.database.close();
});

test('support lookup rejects malformed identifiers and unsupported lookup requests', () => {
    for (const input of [{ kind: 'reference', value: 'not-a-reference' }, { kind: 'student-number', value: '' },
        { kind: 'student-number', value: 'x'.repeat(65) }, { kind: 'student-number', value: 'ABC\nDEF' },
        { kind: 'email', value: 'synthetic@example.invalid' }, { kind: 'student-number', value: 'ABC', code: 'extra' }]) {
        assert.throws(() => buildDraftSupportQuery(input), TypeError);
    }
});

test('operator CLI writes a private SELECT file without logging identity and refuses overwrite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pilot-support-'));
    chmodSync(directory, 0o700);
    const output = join(directory, 'lookup.sql');
    const options = { input: JSON.stringify({ kind: 'student-number', value: 'SYNTHETIC-PRIVATE' }), encoding: 'utf8' };
    try {
        const result = spawnSync(process.execPath, ['scripts/pilot/draft-support-query.mjs', output], options);

        assert.equal(result.status, 0);
        assert.equal(statSync(output).mode & 0o777, 0o600);
        assert.equal(result.stdout, '');
        assert.doesNotMatch(result.stderr, /SYNTHETIC-PRIVATE/);
        const original = readFileSync(output, 'utf8');
        const duplicate = spawnSync(process.execPath, ['scripts/pilot/draft-support-query.mjs', output], options);
        assert.equal(duplicate.status, 1);
        assert.equal(readFileSync(output, 'utf8'), original);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('operator CLI refuses a shared directory before writing identity text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pilot-support-'));
    chmodSync(directory, 0o755);
    const output = join(directory, 'lookup.sql');
    try {
        const result = spawnSync(process.execPath, ['scripts/pilot/draft-support-query.mjs', output], {
            input: JSON.stringify({ kind: 'student-number', value: 'SYNTHETIC-PRIVATE' }), encoding: 'utf8' });

        assert.equal(result.status, 1);
        assert.equal(existsSync(output), false);
        assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC-PRIVATE/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
