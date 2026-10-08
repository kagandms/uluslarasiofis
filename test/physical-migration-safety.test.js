import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_NAME = '0018_staff_document_security.sql';
const migration = readFileSync(new URL(`../migrations/${MIGRATION_NAME}`, import.meta.url), 'utf8');

function createExistingDatabase() {
    const database = new TestD1Database();
    for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql') && name !== MIGRATION_NAME).sort()) {
        database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
    }
    database.exec(`CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO students(id,student_number,normalized_student_number) VALUES('student','SYNTHETIC','SYNTHETIC');
        INSERT INTO applications(id,student_id,application_type,status,first_name) VALUES('online','student','initial','draft','Synthetic');
        INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role) VALUES('staff','synthetic','synthetic','test','Synthetic','reviewer');
        INSERT INTO physical_intakes(id,student_number,first_name,last_name,application_type,status,submitted_at,updated_at,created_by_staff_id)
            VALUES('physical','TEST','Synthetic','Legacy','initial','under_review','2026-01-01','2026-01-01','staff');
        INSERT INTO mobile_document_transfers(id,staff_token_hash,claim_token_hash,expires_at) VALUES('transfer','owner','claim',1);
        INSERT INTO mobile_document_transfer_files(id,transfer_id,storage_key,byte_size,created_at) VALUES('photo','transfer','quarantine/synthetic',10,1);`);
    return database;
}

function applyTrackedMigration(database) {
    if (database.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(MIGRATION_NAME).first()) return false;
    database.exec('BEGIN IMMEDIATE');
    try {
        database.exec(migration);
        database.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(MIGRATION_NAME).run();
        database.exec('COMMIT');
        return true;
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

test('0018 preserves online and existing physical records and keeps legacy photos non-clean', () => {
    const database = createExistingDatabase();
    const online = database.prepare('SELECT * FROM applications').all().results;
    const physical = database.prepare('SELECT * FROM physical_intakes').all().results;

    assert.equal(applyTrackedMigration(database), true);

    assert.deepEqual(database.prepare('SELECT * FROM applications').all().results, online);
    assert.deepEqual(database.prepare('SELECT * FROM physical_intakes').all().results, physical);
    const photo = database.prepare('SELECT * FROM mobile_document_transfer_files').first();
    assert.equal(photo.id, 'photo');
    assert.equal(photo.scan_status, 'pending');
    assert.equal(photo.sha256, null);
    assert.equal(photo.upload_status, 'finalized');
    assert.equal(database.prepare('SELECT * FROM mobile_document_transfers').first().phone_approved_at, null);
});

test('tracked filename application is once-only and raw replay fails without changing records', () => {
    const database = createExistingDatabase();
    applyTrackedMigration(database);
    const schema = database.prepare('SELECT * FROM sqlite_master ORDER BY name').all().results;
    const records = database.prepare('SELECT * FROM applications').all().results;

    assert.equal(applyTrackedMigration(database), false);
    assert.throws(() => database.exec(migration), /duplicate column/);

    assert.deepEqual(database.prepare('SELECT * FROM sqlite_master ORDER BY name').all().results, schema);
    assert.deepEqual(database.prepare('SELECT * FROM applications').all().results, records);
    assert.equal(database.prepare('SELECT count(*) AS total FROM d1_migrations').first().total, 1);
});

test('a migration failure rolls back earlier additions and never marks the filename applied', () => {
    const database = createExistingDatabase();
    database.exec('CREATE TABLE staff_document_scan_jobs(id TEXT);');
    const schema = database.prepare('SELECT * FROM sqlite_master ORDER BY name').all().results;

    assert.throws(() => applyTrackedMigration(database), /already exists/);

    assert.deepEqual(database.prepare('SELECT * FROM sqlite_master ORDER BY name').all().results, schema);
    assert.equal(database.prepare('SELECT count(*) AS total FROM d1_migrations').first().total, 0);
});
