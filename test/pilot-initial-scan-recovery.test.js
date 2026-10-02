import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealScannerFixture, createSyntheticDraft, finalizeSyntheticFile, portalRequest } from './helpers/scanner-real-fixture.js';

async function createRecoveryFixture(options = {}) {
    const context = await createRealScannerFixture();
    const app = await createSyntheticDraft(context);
    const initial = await finalizeSyntheticFile({ context, app, bytes: Buffer.from('synthetic initial file') });
    const secondary = options.secondaryCode
        ? await finalizeSyntheticFile({ context, app, bytes: Buffer.from('other synthetic file'), code: options.secondaryCode }) : null;
    context.database.prepare('UPDATE applications SET status=? WHERE id=?')
        .bind(options.status ?? 'under_review', app.applicationId).run();
    context.database.prepare('UPDATE document_revision_files SET scan_status=? WHERE id=?')
        .bind(options.scanStatus ?? 'unsafe', initial.file.id).run();
    return { context, app, initial, secondary, path: `/api/staff/applications/${app.applicationId}/documents/passport` };
}

test('initial unsafe recovery preserves another current approved document', async () => {
    const fixture = await createRecoveryFixture({ secondaryCode: 'student_certificate' });
    const { context, app, secondary } = fixture;
    try {
        context.database.prepare("UPDATE document_revision_files SET scan_status='clean' WHERE id=?").bind(secondary.file.id).run();
        const approved = await portalRequest(context, `/api/staff/applications/${app.applicationId}/documents/student_certificate/approve`, {
            cookie: context.staffCookie, method: 'POST', body: { expected_revision_number: 1 } });
        assert.equal(approved.status, 200);

        assert.equal((await requestRecovery(fixture)).status, 200);

        assert.equal(context.database.prepare('SELECT status FROM document_revisions WHERE id=?')
            .bind(secondary.file.revision_id).first().status, 'approved');
        assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?')
            .bind(secondary.file.id).first().scan_status, 'clean');
    } finally { context.database.database.close(); }
});

async function requestRecovery(fixture, options = {}) {
    const { body, ...requestOptions } = options;
    return portalRequest(fixture.context, `${fixture.path}/request-resubmission`, {
        cookie: fixture.context.staffCookie, method: 'POST',
        body: { expected_revision_number: 1, reason: 'Yeni ve açılabilir belge gönderin.', ...body }, ...requestOptions
    });
}

async function checkBlockedFile(fixture) {
    const { context, path } = fixture;
    assert.equal((await portalRequest(context, `${path}/download`, { cookie: context.staffCookie })).status, 404);
    assert.equal((await portalRequest(context, `${path}/preview`, {
        cookie: context.staffCookie, method: 'POST', body: {} })).status, 404);
    assert.equal((await portalRequest(context, `${path}/approve`, {
        cookie: context.staffCookie, method: 'POST', body: { expected_revision_number: 1 } })).status, 409);
}

async function checkRecoveryFacts(fixture, scanStatus) {
    const { context, app, initial } = fixture;
    const eligibility = await portalRequest(context, '/api/public/applications/current/documents/resubmission-eligibility', {
        cookie: app.cookie });
    assert.equal(eligibility.status, 200);
    assert.deepEqual((await eligibility.json()).documents.map(({ code, mode }) => ({ code, mode })),
        [{ code: 'passport', mode: 'first_replacement' }]);
    assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?')
        .bind(initial.file.id).first().scan_status, scanStatus);
    assert.equal(context.database.prepare('SELECT status FROM applications WHERE id=?')
        .bind(app.applicationId).first().status, 'resubmission_required');
    assert.equal(context.database.prepare('SELECT body FROM application_notes WHERE application_id=?')
        .bind(app.applicationId).first().body, 'Yeni ve açılabilir belge gönderin.');
    assert.equal(context.database.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type='staff.document_resubmission_requested'")
        .first().count, 1);
}

for (const scanStatus of ['unsafe', 'failed']) {
    test(`staff can request initial ${scanStatus} recovery while file access and approval remain blocked`, async () => {
        const fixture = await createRecoveryFixture({ scanStatus });
        const { context, app, initial } = fixture;
        try {
            await checkBlockedFile(fixture);
            const detail = await portalRequest(context, `/api/staff/applications/${app.applicationId}`, { cookie: context.staffCookie });
            const passport = (await detail.json()).documents.find(({ code }) => code === 'passport');
            assert.equal(passport.access_available, false);
            assert.equal(passport.can_approve, false);
            assert.equal(passport.can_request_resubmission, true);

            assert.equal((await requestRecovery(fixture)).status, 200);

            await checkRecoveryFacts(fixture, scanStatus);
            const replacement = await finalizeSyntheticFile({ context, app, bytes: Buffer.from('new synthetic file'), replacement: true });
            assert.notEqual(replacement.job.id, initial.job.id);
            assert.notEqual(replacement.file.revision_id, initial.file.revision_id);
            assert.equal(context.database.prepare('SELECT scan_status FROM document_revision_files WHERE id=?')
                .bind(initial.file.id).first().scan_status, scanStatus);
            await checkBlockedFile({ ...fixture, path: fixture.path });
        } finally { context.database.database.close(); }
    });
}

test('initial pending scan cannot be replaced even by an authenticated reviewer', async () => {
    const fixture = await createRecoveryFixture({ scanStatus: 'pending' });

    const reply = await requestRecovery(fixture);

    assert.equal(reply.status, 409);
    assert.equal(fixture.context.database.prepare('SELECT count(*) AS count FROM application_notes').first().count, 0);
    fixture.context.database.database.close();
});

test('initial unsafe recovery rolls back all state and messages when its audit fails', async () => {
    const fixture = await createRecoveryFixture();
    fixture.context.database.exec(`CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON audit_events
        WHEN NEW.event_type='staff.document_resubmission_requested'
        BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

    const reply = await requestRecovery(fixture);

    assert.equal(reply.status, 500);
    assert.equal(fixture.context.database.prepare('SELECT status FROM applications WHERE id=?')
        .bind(fixture.app.applicationId).first().status, 'under_review');
    assert.equal(fixture.context.database.prepare('SELECT status FROM document_revisions WHERE id=?')
        .bind(fixture.initial.file.revision_id).first().status, 'submitted');
    assert.equal(fixture.context.database.prepare('SELECT count(*) AS count FROM application_notes').first().count, 0);
    fixture.context.database.database.close();
});

for (const [label, mutation] of [
    ['scanner changed the verdict', (fixture) => fixture.context.database.prepare("UPDATE document_revision_files SET scan_status='clean' WHERE id=?").bind(fixture.initial.file.id).run()],
    ['application became terminal', (fixture) => fixture.context.database.prepare("UPDATE applications SET status='completed' WHERE id=?").bind(fixture.app.applicationId).run()],
    ['revision stopped being current', (fixture) => fixture.context.database.prepare('UPDATE document_revisions SET is_current=0 WHERE id=?').bind(fixture.initial.file.revision_id).run()]
]) {
    test(`initial recovery rejects at commit when ${label}`, async () => {
        const fixture = await createRecoveryFixture();
        const originalBatch = fixture.context.database.batch.bind(fixture.context.database);
        fixture.context.database.batch = async (statements) => {
            mutation(fixture);
            fixture.context.database.batch = originalBatch;
            return originalBatch(statements);
        };

        const reply = await requestRecovery(fixture);

        assert.equal(reply.status, 409);
        assert.equal(fixture.context.database.prepare('SELECT count(*) AS count FROM application_notes').first().count, 0);
        assert.equal(fixture.context.database.prepare("SELECT count(*) AS count FROM audit_events WHERE event_type='staff.document_resubmission_requested'").first().count, 0);
        fixture.context.database.database.close();
    });
}

for (const [label, options, mutation, expected] of [
    ['no staff session', { cookie: undefined }, null, 401],
    ['cross origin', { headers: { Origin: 'https://attacker.invalid' } }, null, 403],
    ['deactivated staff', {}, (fixture) => fixture.context.database.prepare('UPDATE staff_users SET is_active=0').run(), 401],
    ['stale revision', { body: { expected_revision_number: 2 } }, null, 409],
    ['empty reason', { body: { reason: ' ' } }, null, 400],
    ['incomplete intent', {}, (fixture) => fixture.context.database.prepare("UPDATE upload_intents SET status='pending'").run(), 409],
    ['cleanup pending', {}, (fixture) => fixture.context.database.prepare("UPDATE document_revision_files SET cleanup_status='pending'").run(), 409],
    ['submitted before Start Review', {}, (fixture) => fixture.context.database.prepare("UPDATE applications SET status='submitted'").run(), 409]
]) {
    test(`initial unsafe recovery rejects ${label}`, async () => {
        const fixture = await createRecoveryFixture();
        mutation?.(fixture);

        const reply = await requestRecovery(fixture, options);

        assert.equal(reply.status, expected);
        assert.equal(fixture.context.database.prepare('SELECT count(*) AS count FROM application_notes').first().count, 0);
        fixture.context.database.database.close();
    });
}
