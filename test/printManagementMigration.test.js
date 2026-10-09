import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_DIRECTORY = new URL('../migrations/', import.meta.url);
const MANAGEMENT_MIGRATION = '0019_print_staff_management.sql';

test('print management migration preserves legacy rows with unknown source and initializes an open queue', () => {
    const database = new TestD1Database();
    const previousMigrations = readdirSync(MIGRATION_DIRECTORY).filter((name) => name.endsWith('.sql')
        && name !== MANAGEMENT_MIGRATION).sort();
    for (const migration of previousMigrations) {
        database.exec(readFileSync(new URL(migration, MIGRATION_DIRECTORY), 'utf8'));
    }
    database.prepare(`INSERT INTO print_jobs(id,idempotency_key_hash,tracking_token_hash,media_type,byte_size,
        available_at,created_at,updated_at,expires_at,purge_after)
        VALUES('legacy-job','legacy-idempotency','legacy-tracking','application/pdf',100,
            '2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',
            '2026-10-02T00:00:00.000Z','2026-10-30T00:00:00.000Z')`).run();

    database.exec(readFileSync(new URL(MANAGEMENT_MIGRATION, MIGRATION_DIRECTORY), 'utf8'));

    const legacy = database.prepare('SELECT source,created_by_staff_id,status FROM print_jobs WHERE id=?')
        .bind('legacy-job').first();
    assert.equal(legacy.source, 'unknown');
    assert.equal(legacy.created_by_staff_id, null);
    assert.equal(legacy.status, 'uploading');
    assert.equal(database.prepare("SELECT is_paused FROM print_queue_controls WHERE id='global'").first().is_paused, 0);
    assert.equal(database.prepare('SELECT count(*) AS count FROM print_queue_audit').first().count, 0);
});
