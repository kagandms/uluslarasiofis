import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPrintCleanup } from '../src/server/services/printCleanupService.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createCleanupFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Set(['print/11111111-1111-4111-8111-111111111111']);
    let shouldFailDelete = false;
    const environment = {
        PRINT_ENABLED: 'false',
        DB: database,
        PRINT_FILES: {
            async delete(key) {
                if (shouldFailDelete) throw new Error('simulated storage failure');
                objects.delete(key);
            }
        }
    };
    const now = '2026-10-07T12:00:00.000Z';
    database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,
        copies,status,available_at,created_at,updated_at,expires_at,purge_after
    ) VALUES (?,?,?,?,?,'application/pdf',8,1,'submitted',?,?,?, ?,?)`).bind(
        'print-job-1', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64),
        'print/11111111-1111-4111-8111-111111111111', now, now, now,
        '2026-10-07T11:00:00.000Z', '2026-10-08T12:00:00.000Z'
    ).run();
    return { database, environment, objects, now, setFailDelete(value) { shouldFailDelete = value; } };
}

test('print cleanup deletes R2 object idempotently and marks the queue row complete', async () => {
    const { database, environment, objects, now } = createCleanupFixture();

    await runPrintCleanup(environment, now);

    const job = database.prepare('SELECT storage_key,cleanup_status FROM print_jobs WHERE id=?').bind('print-job-1').first();
    assert.equal(objects.size, 0);
    assert.equal(job.storage_key, null);
    assert.equal(job.cleanup_status, 'complete');
});

test('minute scheduled event runs print cleanup', async () => {
    const { database, environment, objects } = createCleanupFixture();
    // This invocation uses the real clock; retain the row while checking object cleanup.
    database.prepare('UPDATE print_jobs SET purge_after=? WHERE id=?')
        .bind(new Date(Date.now() + 24 * 60 * 60_000).toISOString(), 'print-job-1').run();

    await worker.scheduled({ cron: '* * * * *' }, environment);

    const job = database.prepare('SELECT storage_key,cleanup_status FROM print_jobs WHERE id=?').bind('print-job-1').first();
    assert.equal(objects.size, 0);
    assert.equal(job.storage_key, null);
    assert.equal(job.cleanup_status, 'complete');
});

test('print cleanup retains failed deletion for a later retry', async () => {
    const fixture = createCleanupFixture();
    fixture.setFailDelete(true);

    await runPrintCleanup(fixture.environment, fixture.now);

    let job = fixture.database.prepare('SELECT cleanup_status,cleanup_attempts FROM print_jobs WHERE id=?').bind('print-job-1').first();
    assert.equal(job.cleanup_status, 'pending');
    assert.equal(job.cleanup_attempts, 1);
    assert.equal(fixture.objects.size, 1);

    fixture.setFailDelete(false);
    await runPrintCleanup(fixture.environment, fixture.now);
    job = fixture.database.prepare('SELECT storage_key,cleanup_status FROM print_jobs WHERE id=?').bind('print-job-1').first();
    assert.equal(job.storage_key, null);
    assert.equal(job.cleanup_status, 'complete');
    assert.equal(fixture.objects.size, 0);
});
