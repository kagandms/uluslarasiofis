import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPrintLimits, readPrintOptionCapabilities, validatePrintUpload } from '../src/server/domain/printPolicy.js';
import { createPrintRepository } from '../src/server/repositories/d1/printRepository.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const NOW = '2026-10-07T10:00:00.000Z';

function createDatabase() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    database.prepare(`INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at)
        VALUES('printer-1','agent-1','ready','Office Printer',?)`).bind(NOW).run();
    return database;
}

function makeIntent(overrides = {}) {
    return {
        id: 'job-1', idempotencyHash: 'idem-hash-1', uploadTokenHash: 'upload-hash-1',
        trackingTokenHash: 'track-hash-1', storageKey: 'quarantine/00000000-0000-4000-8000-000000000001',
        mediaType: 'application/pdf', byteSize: 1234, copies: 1, paperSize: 'A4',
        colorMode: 'monochrome', duplex: 'simplex', now: NOW,
        expiresAt: '2026-10-07T10:10:00.000Z', purgeAfter: '2026-10-08T10:00:00.000Z',
        heartbeatCutoff: '2026-10-07T09:59:00.000Z', ...overrides
    };
}

test('print jobs store requested settings and create a queued-ready upload intent', async () => {
    const repository = createPrintRepository(createDatabase());
    const job = await repository.createUploadIntent(makeIntent());

    assert.equal(job.status, 'uploading');
    assert.equal(job.page_count, null);
    assert.equal(job.paper_size, 'A4');
    assert.equal(job.color_mode, 'monochrome');
    assert.equal(job.duplex, 'simplex');
    assert.equal(job.copies, 1);
});

test('only one concurrent print agent can claim a job', async () => {
    const repository = createPrintRepository(createDatabase());
    await repository.createUploadIntent(makeIntent());
    await repository.markQueued({ id: 'job-1', tokenHash: 'upload-hash-1', now: NOW, expiresAt: '2026-10-07T11:00:00.000Z' });

    const claims = await Promise.all([
        repository.claim({ now: NOW, runnerId: 'agent-1', leaseTokenHash: 'lease-a' }),
        repository.claim({ now: NOW, runnerId: 'agent-1', leaseTokenHash: 'lease-b' })
    ]);

    assert.equal(claims.filter(Boolean).length, 1);
});

test('idempotency replay cannot change print settings', async () => {
    const repository = createPrintRepository(createDatabase());
    await repository.createUploadIntent(makeIntent());

    const replay = await repository.createUploadIntent(makeIntent({ id: 'job-replay', paperSize: 'A3' }));

    assert.equal(replay, null);
});

test('verified page count is written only when the agent marks the job ready', async () => {
    const database = createDatabase();
    const repository = createPrintRepository(database);
    await repository.createUploadIntent(makeIntent());
    await repository.markQueued({ id: 'job-1', tokenHash: 'upload-hash-1', now: NOW, expiresAt: '2026-10-07T11:00:00.000Z' });
    await repository.claim({ now: NOW, runnerId: 'agent-1', leaseTokenHash: 'lease-a' });

    assert.equal(database.prepare("SELECT page_count FROM print_jobs WHERE id='job-1'").first().page_count, null);
    assert.equal(await repository.markReady({ id: 'job-1', tokenHash: 'lease-a', now: NOW, pageCount: 2 }), true);
    assert.equal(database.prepare("SELECT page_count FROM print_jobs WHERE id='job-1'").first().page_count, 2);
});

test('submission-started jobs become unknown after lease expiry and are never requeued', async () => {
    const database = createDatabase();
    const repository = createPrintRepository(database);
    await repository.createUploadIntent(makeIntent());
    await repository.markQueued({ id: 'job-1', tokenHash: 'upload-hash-1', now: NOW, expiresAt: '2026-10-07T11:00:00.000Z' });
    await repository.claim({ now: NOW, runnerId: 'agent-1', leaseTokenHash: 'lease-a' });
    await repository.markReady({ id: 'job-1', tokenHash: 'lease-a', now: NOW, pageCount: 1 });
    assert.equal(await repository.markSubmissionStarted({ id: 'job-1', tokenHash: 'lease-a', now: NOW }), true);

    await repository.reconcile('2026-10-07T10:06:00.000Z');
    const job = database.prepare("SELECT status FROM print_jobs WHERE id='job-1'").first();
    assert.equal(job.status, 'unknown');
    assert.equal(await repository.claim({ now: '2026-10-07T10:07:00.000Z', runnerId: 'agent-1', leaseTokenHash: 'lease-b' }), null);
});

test('public availability requires both a fresh ready heartbeat and remaining queue capacity', async () => {
    const database = createDatabase();
    const repository = createPrintRepository(database);

    assert.deepEqual(await repository.readPublicStatus(NOW), { available: true, settingsProtocol: 0,
        limits: { max_copies: 3, max_page_copies: 200 } });
    assert.deepEqual(await repository.readPublicStatus('2026-10-07T10:02:00.000Z'), { available: false, settingsProtocol: 0,
        limits: { max_copies: 3, max_page_copies: 200 } });
});

test('print settings whitelist permits only configured options', () => {
    const allowed = {
        paper_sizes: ['A4', 'A3'], color_modes: ['monochrome', 'color'], duplex_modes: ['simplex', 'duplexlong']
    };
    const parsed = validatePrintUpload({ media_type: 'application/pdf', byte_size: 100, copies: 2,
        paper_size: 'A3', color_mode: 'color', duplex: 'duplexlong' }, allowed);

    assert.deepEqual(parsed, { mediaType: 'application/pdf', byteSize: 100, copies: 2,
        paperSize: 'A3', colorMode: 'color', duplex: 'duplexlong', orientation: 'portrait', requiredProtocol: 1 });
});

test('print settings reject unsupported values and options disabled for this environment', () => {
    const defaults = { paperSizes: ['A4'], colorModes: ['monochrome'], duplexModes: ['simplex'] };
    const unsafeValues = [
        { paper_size: 'A3', color_mode: 'monochrome', duplex: 'simplex' },
        { paper_size: 'A4', color_mode: 'color', duplex: 'simplex' },
        { paper_size: 'A4', color_mode: 'monochrome', duplex: 'duplexlong' },
        { paper_size: 'LETTER', color_mode: 'monochrome', duplex: 'simplex' }
    ];

    for (const settings of unsafeValues) {
        assert.throws(() => validatePrintUpload({ media_type: 'application/pdf', byte_size: 100, copies: 1,
            ...settings }, defaults));
    }
});

test('protocol 3 enables orientations while limits remain configurable and fail closed', () => {
    const limits = readPrintLimits({ PRINT_MAX_COPIES_PER_JOB: '40', PRINT_MAX_PAGE_COPIES: '180' });
    const capabilities = readPrintOptionCapabilities({ PRINT_MAX_COPIES_PER_JOB: '40',
        PRINT_MAX_PAGE_COPIES: '180' }, 3);
    const invalidLimits = readPrintLimits({ PRINT_MAX_COPIES_PER_JOB: '51', PRINT_MAX_PAGE_COPIES: '180' });

    assert.deepEqual(limits, { maxCopies: 40, maxPageCopies: 180, isValid: true });
    assert.deepEqual(capabilities.orientations, ['portrait', 'landscape']);
    assert.equal(capabilities.limits.max_copies, 40);
    assert.equal(invalidLimits.isValid, false);
});

test('protocol 3 accepts copy boundaries and rejects invalid or over-limit counts', () => {
    const capabilities = readPrintOptionCapabilities({ PRINT_MAX_COPIES_PER_JOB: '50',
        PRINT_MAX_PAGE_COPIES: '200' }, 3);
    const base = { media_type: 'application/pdf', byte_size: 100, paper_size: 'A4', color_mode: 'monochrome',
        duplex: 'simplex', orientation: 'landscape' };

    for (const copies of [1, 2, 3, 4, 10, 50]) {
        assert.equal(validatePrintUpload({ ...base, copies }, capabilities).copies, copies);
    }
    for (const copies of [0, -1, 1.5, '4', 51, Number.NaN]) {
        assert.throws(() => validatePrintUpload({ ...base, copies }, capabilities));
    }
});
