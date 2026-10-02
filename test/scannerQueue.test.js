import { createScanJobStatement } from '../src/server/repositories/d1/scanner-job-statement.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';

const NOW = '2026-10-02T12:00:00.000Z';
async function fixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    database.exec(`
        INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s', 'SCAN', 'SCAN');
        INSERT INTO applications(id, student_id, application_type) VALUES ('a', 's', 'initial');
        INSERT INTO document_records(id, application_id, requirement_id, application_type) VALUES ('d', 'a', 'req-initial-passport', 'initial');
        INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type) VALUES ('r', 'd', 1, 'submitted', 1, 'student');
        INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status) VALUES ('f', 'r', 0, 'quarantine/00000000-0000-4000-8000-000000000001', 'synthetic.pdf', 'application/pdf', 100, 'finalized', 'pending');
        INSERT INTO upload_intents(id, revision_file_id, idempotency_key, expires_at) VALUES ('i', 'f', 'ik', '2026-10-02T11:00:00.000Z');
    `);
    return database;
}
async function repository(database) {
    const module = await import('../src/server/repositories/d1/scanner-repository.js');
    return module.createScannerRepository(database);
}
async function completeIntent(database) {
    await database.batch([
        database.prepare("UPDATE upload_intents SET status='completed', completed_at='2026-10-02T10:00:00.000Z' WHERE id='i'"),
        createScanJobStatement(database, { fileId: 'f', finalizedAt: '2026-10-02T10:00:00.000Z' })
    ]);
}

test('finalize atomically creates one durable scan job and rollback leaves no job', async () => {
    const database = await fixture();

    await completeIntent(database);
    await completeIntent(database);

    assert.equal(database.prepare('SELECT count(*) AS count FROM document_scan_jobs').first().count, 1);
    assert.equal(database.prepare('SELECT file_id, revision_id, status FROM document_scan_jobs').first().status, 'queued');
    await database.prepare('DELETE FROM document_scan_jobs').run();
    await database.prepare("UPDATE upload_intents SET status='pending' WHERE id='i'").run();
    await assert.rejects(database.batch([
        database.prepare("UPDATE upload_intents SET status='completed' WHERE id='i'"),
        createScanJobStatement(database, { fileId: 'f', finalizedAt: NOW }),
        database.prepare("INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s', 'SCAN', 'SCAN')")
    ]));
    assert.equal(database.prepare('SELECT count(*) AS count FROM document_scan_jobs').first().count, 0);
});

test('only one runner claims a job and expired lease is fenced from the next attempt', async () => {
    const database = await fixture();
    await completeIntent(database);
    const queue = await repository(database);

    const claims = await Promise.all([
        queue.claim({ now: NOW, runnerId: 'mac-a', tokenHash: 'one' }),
        queue.claim({ now: NOW, runnerId: 'mac-b', tokenHash: 'two' })
    ]);

    assert.equal(claims.filter(Boolean).length, 1);
    const firstClaim = claims.find(Boolean);
    assert.equal(firstClaim.attempts, 1);
    await queue.reconcile('2026-10-02T12:06:00.000Z');
    const nextClaim = await queue.claim({ now: '2026-10-02T12:07:00.000Z', runnerId: 'mac-b', tokenHash: 'new' });
    assert.equal(nextClaim.attempts, 2);
    assert.equal(await queue.findLease({ jobId: firstClaim.id, tokenHash: 'one', now: '2026-10-02T12:07:00.000Z' }), null);
});

test('retry exhaustion marks failed and explicit retry requeues without declaring clean', async () => {
    const database = await fixture();
    await completeIntent(database);
    const queue = await repository(database);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const now = `2026-10-02T12:${String(attempt * 7).padStart(2, '0')}:00.000Z`;
        assert.ok(await queue.claim({ now, runnerId: 'mac-a', tokenHash: `t${attempt}` }));
        await queue.reconcile(`2026-10-02T12:${String(attempt * 7 + 6).padStart(2, '0')}:00.000Z`);
    }

    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'failed');
    const job = database.prepare('SELECT * FROM document_scan_jobs').first();
    assert.equal(job.status, 'failed');
    assert.equal(await queue.retry({ jobId: job.id, now: NOW, staffId: null, requestId: 'req' }), true);
    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'pending');
});

test('reconciliation recovers pending finalized files and rejects noncurrent files', async () => {
    const database = await fixture();
    await completeIntent(database);
    await database.prepare('DELETE FROM document_scan_jobs').run();
    const queue = await repository(database);

    await queue.reconcile(NOW);

    assert.equal(database.prepare('SELECT count(*) AS count FROM document_scan_jobs').first().count, 1);
    await database.prepare("UPDATE document_revisions SET is_current=0 WHERE id='r'").run();
    await queue.reconcile(NOW);
    assert.equal(await queue.claim({ now: NOW, runnerId: 'mac-a', tokenHash: 't' }), null);
    assert.equal(database.prepare('SELECT status FROM document_scan_jobs').first().status, 'stale');
});

test('migration backfills historical pending files and keeps upload-capability expiry before eligibility', async () => {
    const { readFileSync } = await import('node:fs');
    const database = await fixture();
    database.exec('DROP TRIGGER IF EXISTS enqueue_finalized_document_scan; DROP TABLE document_scan_jobs; DROP TABLE scanner_heartbeats;');
    await database.prepare("UPDATE upload_intents SET status='completed',completed_at='2026-10-02T10:00:00.000Z' WHERE id='i'").run();

    database.exec(readFileSync(new URL('../migrations/0009_document_scanner.sql', import.meta.url), 'utf8'));

    const job = database.prepare('SELECT * FROM document_scan_jobs').first();
    assert.equal(job.status, 'queued');
    assert.equal(job.available_at, '2026-10-02T11:00:00.000Z');
    const queue = await repository(database);
    assert.equal(await queue.claim({now:'2026-10-02T10:59:00.000Z',runnerId:'mac',tokenHash:'t'}), null);
    assert.ok(await queue.claim({now:NOW,runnerId:'mac',tokenHash:'t'}));
});

test('scanner migration preserves finalize row-count guards by avoiding metadata-changing triggers', async () => {
    const database = await fixture();

    const triggers = database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' AND name='enqueue_finalized_document_scan'").first();

    assert.equal(triggers.count, 0);
});
