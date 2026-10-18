import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_NAME = '0024_physical_status_without_pdf.sql';
const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);
const MIGRATION_SQL = readFileSync(new URL(MIGRATION_NAME, MIGRATIONS_URL), 'utf8');

function createPreviousDatabase() {
    const database = new TestD1Database();
    for (const name of readdirSync(MIGRATIONS_URL).filter(name => name.endsWith('.sql') && name < MIGRATION_NAME).sort()) {
        database.exec(readFileSync(new URL(name, MIGRATIONS_URL), 'utf8'));
    }
    database.exec(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('staff','synthetic','synthetic','test','Synthetic','reviewer');
        INSERT INTO physical_intakes(id,student_number,first_name,last_name,passport_number,application_type,status,submitted_at,updated_at,created_by_staff_id)
        VALUES('intake','TEST','Synthetic','Student','SYNTHETIC','initial','under_review','2026-10-17','2026-10-17','staff');`);
    return database;
}

test('physical status migration preserves rows and removes only the digital PDF guard', () => {
    const database = createPreviousDatabase();
    const rows = database.prepare('SELECT * FROM physical_intakes').all().results;
    const schema = database.prepare("SELECT type,name,sql FROM sqlite_master WHERE name<>'physical_migration_pdf_guard' ORDER BY name").all().results;
    assert.throws(() => database.exec("UPDATE physical_intakes SET status='sent_to_migration'"), /physical_migration_pdf_required/);

    database.exec(MIGRATION_SQL);

    assert.deepEqual(database.prepare('SELECT * FROM physical_intakes').all().results, rows);
    assert.deepEqual(database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all().results, schema);
    database.exec("UPDATE physical_intakes SET status='sent_to_migration'");
    assert.equal(database.prepare('SELECT status,current_pdf_id FROM physical_intakes').first().status, 'sent_to_migration');
    assert.equal(database.prepare('SELECT current_pdf_id FROM physical_intakes').first().current_pdf_id, null);
});

test('PDF-independent stages still enforce rejection reasons and completed metadata protection', () => {
    const database = createPreviousDatabase();

    database.exec(MIGRATION_SQL);

    assert.throws(() => database.exec("UPDATE physical_intakes SET status='rejected',rejection_reason=''"), /physical_review_state_invalid/);
    assert.throws(() => database.exec("UPDATE physical_intakes SET status='unknown'"), /physical_review_state_invalid/);
    database.exec("UPDATE physical_intakes SET status='completed'");
    assert.throws(() => database.exec("UPDATE physical_intakes SET first_name='Changed'"), /physical_processing_closed/);
});
