import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const OLD_MIGRATION = new URL('../migrations/0011_print_queue.sql', import.meta.url);
const OPTION_MIGRATION = new URL('../migrations/0012_print_options.sql', import.meta.url);
const NEW_MIGRATION = new URL('../migrations/0013_print_orientation_volume.sql', import.meta.url);
const DEVMODE_MIGRATION = new URL('../migrations/0014_print_orientation_devmode.sql', import.meta.url);

test('print settings migration preserves jobs, defaults, and existing indexes', () => {
    const database = new TestD1Database();
    database.exec(readFileSync(OLD_MIGRATION, 'utf8'));
    database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,
        page_count,copies,status,available_at,created_at,updated_at,expires_at,purge_after
    ) VALUES (?,?,?,?,?,'application/pdf',500,2,3,'queued',?,?,?,?,?)`).bind(
        'job-preserved', 'idempotency-hash', 'upload-hash', 'tracking-hash', 'print/job-preserved',
        '2026-10-08T10:00:00.000Z', '2026-10-08T10:00:00.000Z', '2026-10-08T10:00:00.000Z',
        '2026-10-08T11:00:00.000Z', '2026-10-09T10:00:00.000Z'
    ).run();
    const oldIndexes = database.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='print_jobs'
        ORDER BY name`).all().results.map((row) => row.name);

    database.exec(readFileSync(OPTION_MIGRATION, 'utf8'));
    database.exec(readFileSync(NEW_MIGRATION, 'utf8'));
    database.prepare(`INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at,settings_protocol)
        VALUES('old-agent','legacy-runner','ready','Legacy printer','2026-10-08T10:00:00.000Z',2)`).run();
    database.exec(readFileSync(DEVMODE_MIGRATION, 'utf8'));

    const job = database.prepare('SELECT * FROM print_jobs WHERE id=?').bind('job-preserved').first();
    const newIndexes = database.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='print_jobs'
        ORDER BY name`).all().results.map((row) => row.name);
    assert.deepEqual(oldIndexes, newIndexes);
    assert.equal(job.idempotency_key_hash, 'idempotency-hash');
    assert.equal(job.storage_key, 'print/job-preserved');
    assert.equal(job.page_count, 2);
    assert.equal(job.copies, 3);
    assert.equal(job.status, 'queued');
    assert.equal(job.paper_size, 'A4');
    assert.equal(job.color_mode, 'monochrome');
    assert.equal(job.duplex, 'simplex');
    assert.equal(job.orientation, 'portrait');
    assert.equal(database.prepare("SELECT settings_protocol FROM printer_heartbeats WHERE printer_id='old-agent'")
        .first().settings_protocol, 2);
    database.prepare(`INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at,settings_protocol)
        VALUES('new-agent','new-runner','ready','New printer','2026-10-08T10:00:00.000Z',3)`).run();
    assert.equal(database.prepare("SELECT settings_protocol FROM printer_heartbeats WHERE printer_id='new-agent'")
        .first().settings_protocol, 3);
    assert.throws(() => database.prepare(`UPDATE printer_heartbeats SET settings_protocol=4
        WHERE printer_id='new-agent'`).run());
});

test('print settings migration accepts only supported persisted values', () => {
    const database = new TestD1Database();
    database.exec(readFileSync(OLD_MIGRATION, 'utf8'));
    database.exec(readFileSync(OPTION_MIGRATION, 'utf8'));
    database.exec(readFileSync(NEW_MIGRATION, 'utf8'));
    database.exec(readFileSync(DEVMODE_MIGRATION, 'utf8'));

    assert.throws(() => database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,tracking_token_hash,media_type,byte_size,available_at,created_at,updated_at,expires_at,purge_after,
        paper_size,color_mode,duplex
    ) VALUES ('job-invalid','idem','track','application/pdf',1,'n','n','n','n','n','LETTER','color','duplexlong')`).run());
    database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,tracking_token_hash,media_type,byte_size,available_at,created_at,updated_at,expires_at,purge_after,
        paper_size,color_mode,duplex
    ) VALUES ('job-supported','idem2','track2','application/pdf',1,'n','n','n','n','n','A3','color','duplexlong')`).run();
    assert.equal(database.prepare("SELECT count(*) AS count FROM print_jobs WHERE paper_size='A3' AND color_mode='color' AND duplex='duplexlong'")
        .first().count, 1);
    database.prepare(`INSERT INTO printer_heartbeats(printer_id,runner_id,health,printer_name,seen_at)
        VALUES('legacy','legacy-runner','ready','Legacy printer','n')`).run();
    assert.equal(database.prepare("SELECT settings_protocol FROM printer_heartbeats WHERE printer_id='legacy'").first()
        .settings_protocol, 0);
    database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,tracking_token_hash,media_type,byte_size,available_at,created_at,updated_at,expires_at,purge_after,
        page_count,copies,orientation
    ) VALUES ('job-volume','idem-volume','track-volume','application/pdf',1,'n','n','n','n','n',20,50,'landscape')`).run();
    assert.deepEqual({ ...database.prepare("SELECT page_count,copies,orientation FROM print_jobs WHERE id='job-volume'").first() },
        { page_count: 20, copies: 50, orientation: 'landscape' });
    assert.throws(() => database.prepare(`UPDATE print_jobs SET page_count=20,copies=51 WHERE id='job-volume'`).run());
    assert.throws(() => database.prepare(`INSERT INTO print_jobs (
        id,idempotency_key_hash,tracking_token_hash,media_type,byte_size,available_at,created_at,updated_at,expires_at,purge_after,
        copies
    ) VALUES ('job-over-limit','idem-over','track-over','application/pdf',1,'n','n','n','n','n',51)`).run());
});
