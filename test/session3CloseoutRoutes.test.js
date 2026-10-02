import { readApplicationVersion } from './helpers/owner-version.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const removedKeys = [];
    const cleanupControl = { shouldFail: options.failDelete === true };
    const environment = {
        DB: database,
        DOCUMENTS: {
            async delete(key) {
                removedKeys.push(key);
                if (cleanupControl.shouldFail) throw new Error('provider failure');
            }
        },
        ASSETS: { async fetch() { return new Response('asset'); } },
        ...options
    };
    return { environment, database, removedKeys, cleanupControl };
}

function request(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (cookie) headers.set('Cookie', cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function json(response) {
    return response.json();
}

async function createApplicant(environment, studentNumber) {
    const response = await worker.fetch(request('/api/public/applications', {
        method: 'POST',
        body: { student_number: studentNumber, application_type: 'initial', email: `${studentNumber}@example.edu`, phone: '5551112233' }
    }), environment, {});
    return { response, cookie: response.headers.get('Set-Cookie').split(';')[0] };
}

test('declaration acceptance uses current configured version, server timestamp, audit and safe DTO', async () => {
    const { environment, database } = createEnvironment({ PUBLIC_DECLARATION_VERSION: 'accuracy-v2' });
    const { cookie } = await createApplicant(environment, 'S3-DECL-1');
    await createApplicant(environment, 'S3-DECL-2');
    const before = Date.now();
    const accepted = await worker.fetch(request('/api/public/applications/current/declaration', {
        method: 'POST', cookie, body: { accepted: true, version: 'accuracy-v2' }
    }), environment, {});
    const payload = await json(accepted);
    const row = database.prepare(`SELECT declaration_version, declaration_accepted_at FROM applications
        JOIN students ON students.id = applications.student_id WHERE students.student_number = 'S3-DECL-1'`).first();
    const otherStudent = database.prepare(`SELECT declaration_version FROM applications
        JOIN students ON students.id = applications.student_id WHERE students.student_number = 'S3-DECL-2'`).first();

    assert.equal(accepted.status, 200);
    assert.equal(row.declaration_version, 'accuracy-v2');
    assert.equal(otherStudent.declaration_version, null);
    assert.ok(Date.parse(row.declaration_accepted_at) >= before);
    assert.equal(payload.application.declaration.accepted_version, 'accuracy-v2');
    assert.equal(payload.application.declaration.accepted_current, true);
    assert.equal(payload.application.id, undefined);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.declaration_accepted'").first().count, 1);
    assert.doesNotMatch(JSON.stringify(payload), /storage_key|staff_id|request_id|audit/i);
});

test('declaration rejects missing owner, cross origin, false acceptance, stale version and client timestamp', async () => {
    const { environment } = createEnvironment({ PUBLIC_DECLARATION_VERSION: 'accuracy-v2' });
    const { cookie } = await createApplicant(environment, 'S3-DECL-2');
    const path = '/api/public/applications/current/declaration';
    const cases = [
        [request(path, { method: 'POST', body: { accepted: true, version: 'accuracy-v2' } }), 401],
        [request(path, { method: 'POST', cookie, origin: 'https://attacker.test', body: { accepted: true, version: 'accuracy-v2' } }), 403],
        [request(path, { method: 'POST', cookie, body: { accepted: false, version: 'accuracy-v2' } }), 400],
        [request(path, { method: 'POST', cookie, body: { accepted: true, version: 'stale' } }), 409],
        [request(path, { method: 'POST', cookie, body: { accepted: true, version: 'accuracy-v2', accepted_at: '2000-01-01T00:00:00Z' } }), 400]
    ];

    for (const [incoming, expectedStatus] of cases) {
        const response = await worker.fetch(incoming, environment, {});
        assert.equal(response.status, expectedStatus);
    }
});

test('student requirements expose the safe policy contract and never leak D1 identifiers or storage keys', async () => {
    const { environment } = createEnvironment();
    const { cookie } = await createApplicant(environment, 'S3-POLICY-1');
    const response = await worker.fetch(request('/api/public/applications/current/documents', { cookie }), environment, {});
    const payload = await json(response);
    const passport = payload.requirements.find(({ code }) => code === 'passport');

    assert.equal(response.status, 200);
    assert.equal(payload.requirements.some(({ code }) => code === 'uets'), false);
    assert.equal(passport.required, true);
    assert.equal(passport.label_key, 'documentPassport');
    assert.deepEqual(passport.accepted_media_types, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    assert.equal(passport.max_byte_size, 10 * 1024 * 1024);
    assert.equal(payload.requirements.some(({ code }) => code === 'fingerprint'), false);
    assert.doesNotMatch(JSON.stringify(payload), /storage_key|requirement_id|document_record_id|staff_id/i);
});

test('autosave permits incomplete edits but remains owner-scoped and same-origin', async () => {
    const { environment, database } = createEnvironment();
    const studentA = await createApplicant(environment, 'S3-AUTOSAVE-A');
    const studentB = await createApplicant(environment, 'S3-AUTOSAVE-B');
    const path = '/api/public/applications/current/autosave';
    const saved = await worker.fetch(request(path, {
        method: 'PATCH', cookie: studentA.cookie, body: { lock_version: await readApplicationVersion(environment, studentA.cookie), first_name: 'A', student_email: 'draft-in-progress@' }
    }), environment, {});
    const crossOrigin = await worker.fetch(request(path, {
        method: 'PATCH', cookie: studentA.cookie, origin: 'https://attacker.test', body: { lock_version: await readApplicationVersion(environment, studentA.cookie), first_name: 'Injected' }
    }), environment, {});
    const rows = database.prepare(`
        SELECT students.student_number, applications.first_name, applications.student_email
        FROM applications JOIN students ON students.id = applications.student_id
        ORDER BY students.student_number
    `).all().results;

    assert.equal(saved.status, 200);
    assert.equal((await json(saved)).application.first_name, 'A');
    assert.equal(crossOrigin.status, 403);
    assert.equal(rows.find(({ student_number }) => student_number === 'S3-AUTOSAVE-A').student_email, 'draft-in-progress@');
    assert.equal(rows.find(({ student_number }) => student_number === 'S3-AUTOSAVE-B').first_name, null);
});

test('document delete marks current revision unavailable before R2 cleanup and retries cleanup safely', async () => {
    const { environment, database, removedKeys, cleanupControl } = createEnvironment({ failDelete: true });
    const { cookie } = await createApplicant(environment, 'S3-DEL-1');
    const applicationId = database.prepare('SELECT id FROM applications').first().id;
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('doc-owned', ?, 'req-initial-passport', 'initial')
    `).bind(applicationId).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES ('rev-owned', 'doc-owned', 1, 'submitted', 1, 'student')
    `).run();
    database.prepare(`
        INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status)
        VALUES ('file-owned', 'rev-owned', 0, 'quarantine/11111111-1111-4111-8111-111111111111',
            'passport.pdf', 'application/pdf', 100, 'finalized', 'pending')
    `).run();
    const deleteRequest = () => request('/api/public/applications/current/documents/passport', { method: 'DELETE', cookie });

    const first = await worker.fetch(deleteRequest(), environment, {});
    const firstPayload = await json(first);
    const revision = database.prepare("SELECT is_current, status FROM document_revisions WHERE id = 'rev-owned'").first();
    const file = database.prepare("SELECT cleanup_status FROM document_revision_files WHERE id = 'file-owned'").first();
    assert.equal(first.status, 200);
    assert.equal(firstPayload.cleanup_status, 'pending');
    assert.equal(revision.is_current, 0);
    assert.equal(revision.status, 'superseded');
    assert.equal(file.cleanup_status, 'pending');
    assert.equal(removedKeys.length, 1);

    cleanupControl.shouldFail = false;
    const retried = await worker.fetch(deleteRequest(), environment, {});
    assert.equal(retried.status, 200);
    assert.equal((await json(retried)).cleanup_status, 'complete');
    assert.equal(database.prepare("SELECT cleanup_status FROM document_revision_files WHERE id = 'file-owned'").first().cleanup_status, 'complete');
});

test('document delete denies cross origin and unknown policy codes without changing another application', async () => {
    const { environment, database } = createEnvironment();
    const { cookie } = await createApplicant(environment, 'S3-DEL-2');
    const path = '/api/public/applications/current/documents/not_a_requirement';
    const unauthenticated = await worker.fetch(request(path, { method: 'DELETE' }), environment, {});
    const crossOrigin = await worker.fetch(request(path, { method: 'DELETE', cookie, origin: 'https://attacker.test' }), environment, {});
    const unknown = await worker.fetch(request(path, { method: 'DELETE', cookie }), environment, {});

    assert.equal(unauthenticated.status, 401);
    assert.equal(crossOrigin.status, 403);
    assert.equal(unknown.status, 404);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_records').first().count, 0);
});

test('document delete preserves files while staff has locked a document for review', async () => {
    const { environment, database, removedKeys } = createEnvironment();
    const { cookie } = await createApplicant(environment, 'S3-DEL-LOCKED');
    const applicationId = database.prepare('SELECT id FROM applications').first().id;
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES ('doc-review-locked', ?, 'req-initial-passport', 'initial', 'under_review')
    `).bind(applicationId).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES ('rev-review-locked', 'doc-review-locked', 1, 'submitted', 1, 'student')
    `).run();
    database.prepare(`
        INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status)
        VALUES ('file-review-locked', 'rev-review-locked', 0,
            'quarantine/33333333-3333-4333-8333-333333333333', 'passport.pdf', 'application/pdf', 100, 'finalized', 'pending')
    `).run();

    const deletion = await worker.fetch(request('/api/public/applications/current/documents/passport', {
        method: 'DELETE', cookie
    }), environment, {});
    const revision = database.prepare("SELECT is_current FROM document_revisions WHERE id = 'rev-review-locked'").first();

    assert.equal(deletion.status, 409);
    assert.equal((await json(deletion)).error.code, 'DOCUMENT_NOT_EDITABLE');
    assert.equal(revision.is_current, 1);
    assert.equal(removedKeys.length, 0);
});

test('document upload metadata uses policy MIME and byte limits before signing', async () => {
    const { environment } = createEnvironment();
    const { cookie } = await createApplicant(environment, 'S3-POLICY-2');
    const path = '/api/public/applications/current/documents/upload-intent';
    const invalidType = await worker.fetch(request(path, {
        method: 'POST', cookie, body: { code: 'passport', filename: 'document.svg', media_type: 'image/svg+xml', byte_size: 10 }
    }), environment, {});
    const tooLarge = await worker.fetch(request(path, {
        method: 'POST', cookie, body: { code: 'passport', filename: 'large.pdf', media_type: 'application/pdf', byte_size: 10 * 1024 * 1024 + 1 }
    }), environment, {});

    assert.equal(invalidType.status, 400);
    assert.equal((await json(invalidType)).error.code, 'INVALID_FILE');
    assert.equal(tooLarge.status, 400);
    assert.equal((await json(tooLarge)).error.code, 'FILE_TOO_LARGE');
});

test('Student A can delete only A document while Student B current revision remains visible', async () => {
    const { environment, database, removedKeys } = createEnvironment();
    const studentA = await createApplicant(environment, 'S3-DELETE-A');
    const studentB = await createApplicant(environment, 'S3-DELETE-B');
    const applicationRows = database.prepare(`
        SELECT applications.id, students.student_number FROM applications
        JOIN students ON students.id = applications.student_id
    `).all().results;
    const applicationA = applicationRows.find(({ student_number }) => student_number === 'S3-DELETE-A');
    const applicationB = applicationRows.find(({ student_number }) => student_number === 'S3-DELETE-B');
    for (const [application, suffix] of [[applicationA, 'a'], [applicationB, 'b']]) {
        const recordId = `doc-${suffix}`;
        const revisionId = `rev-${suffix}`;
        database.prepare(`INSERT INTO document_records (id, application_id, requirement_id, application_type)
            VALUES (?, ?, 'req-initial-passport', 'initial')`).bind(recordId, application.id).run();
        database.prepare(`INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
            VALUES (?, ?, 1, 'submitted', 1, 'student')`).bind(revisionId, recordId).run();
        database.prepare(`INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status) VALUES (?, ?, 0, ?, 'passport.pdf', 'application/pdf', 100, 'finalized', 'pending')`)
            .bind(`file-${suffix}`, revisionId, `quarantine/22222222-2222-4222-8222-22222222222${suffix === 'a' ? '1' : '2'}`).run();
    }

    const deleteResponse = await worker.fetch(request('/api/public/applications/current/documents/passport', {
        method: 'DELETE', cookie: studentA.cookie
    }), environment, {});
    const requirements = await worker.fetch(request('/api/public/applications/current/documents', { cookie: studentA.cookie }), environment, {});
    const currentA = database.prepare("SELECT is_current FROM document_revisions WHERE id = 'rev-a'").first().is_current;
    const currentB = database.prepare("SELECT is_current FROM document_revisions WHERE id = 'rev-b'").first().is_current;

    assert.equal((await json(requirements)).requirements.find(({ code }) => code === 'passport').filename, null);
    assert.equal(deleteResponse.status, 200);
    assert.equal(currentA, 0);
    assert.equal(currentB, 1);
    assert.equal(removedKeys.length, 1);
    assert.match(removedKeys[0], /222222222221$/);
});

test('non-draft applications cannot accept declarations or delete documents', async () => {
    const { environment, database } = createEnvironment();
    const { cookie } = await createApplicant(environment, 'S3-LOCKED-1');
    database.prepare("UPDATE applications SET status = 'submitted' WHERE status = 'draft'").run();

    const declaration = await worker.fetch(request('/api/public/applications/current/declaration', {
        method: 'POST', cookie, body: { accepted: true, version: 'student-information-accuracy-v1' }
    }), environment, {});
    const deletion = await worker.fetch(request('/api/public/applications/current/documents/passport', { method: 'DELETE', cookie }), environment, {});

    assert.equal(declaration.status, 409);
    assert.equal((await json(declaration)).error.code, 'APPLICATION_NOT_EDITABLE');
    assert.equal(deletion.status, 409);
    assert.equal((await json(deletion)).error.code, 'APPLICATION_NOT_EDITABLE');
    assert.equal(database.prepare('SELECT declaration_version FROM applications').first().declaration_version, null);
});
