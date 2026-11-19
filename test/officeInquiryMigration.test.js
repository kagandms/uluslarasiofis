import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyAllMigrations } from './helpers/apply-migrations.js';

function createDatabase() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    applyAllMigrations(database);
    return database;
}

function insertInquiry(database, overrides = {}) {
    const row = {
        id: 'inq-1',
        first_name: 'Ayşe',
        last_name: 'Yılmaz',
        phone: '+905551112233',
        email: 'ayse@example.edu',
        message: 'Merhaba, ikamet başvurusu hakkında sorum var.',
        language: 'tr',
        status: 'new',
        ...overrides
    };
    database.prepare(`
        INSERT INTO office_inquiries (
            id, first_name, last_name, phone, email, message, language, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.first_name, row.last_name, row.phone, row.email, row.message, row.language, row.status);
}

test('office_inquiries migration 0045 exists without version collision and creates table and index', () => {
    const migrationFiles = readdirSync(new URL('../migrations/', import.meta.url))
        .filter((file) => file.endsWith('.sql'))
        .sort();
    const version45Files = migrationFiles.filter((file) => file.startsWith('0045_'));
    assert.deepEqual(version45Files, ['0045_office_inquiries.sql']);

    const database = createDatabase();
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name);
    const columns = database.prepare('PRAGMA table_info(office_inquiries)').all().map(({ name }) => name);
    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'office_inquiries'")
        .all()
        .map(({ name }) => name);

    assert.ok(tables.includes('office_inquiries'));
    assert.deepEqual(columns, [
        'id', 'first_name', 'last_name', 'phone', 'email', 'message',
        'language', 'status', 'handled_by_staff_id', 'handled_at', 'created_at', 'updated_at'
    ]);
    assert.ok(indexes.includes('idx_office_inquiries_status_created'));
});

test('office_inquiries migration enforces defaults, nullable email, and CHECK constraints', () => {
    const database = createDatabase();

    database.prepare(`
        INSERT INTO office_inquiries (id, first_name, last_name, phone, email, message, language)
        VALUES ('inq-default', 'Ali', 'Demir', '0090 505 123 45 67', NULL, 'Sorum var mı', 'tr')
    `).run();

    const stored = database.prepare(`
        SELECT status, email, handled_by_staff_id, handled_at, created_at, updated_at
        FROM office_inquiries WHERE id = 'inq-default'
    `).get();
    assert.equal(stored.status, 'new');
    assert.equal(stored.email, null);
    assert.equal(stored.handled_by_staff_id, null);
    assert.equal(stored.handled_at, null);
    assert.ok(stored.created_at);
    assert.ok(stored.updated_at);

    assert.throws(
        () => insertInquiry(database, { id: 'inq-short-msg', message: 'abcd' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-padded-short-msg', message: '   ab   ' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-long-msg', message: 'a'.repeat(1001) }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-unknown-status', status: 'redirected' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-bogus-status', status: 'bogus' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-bad-lang', language: 'de' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-empty-first', first_name: '   ' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-long-last', last_name: 'x'.repeat(61) }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertInquiry(database, { id: 'inq-bad-email', email: 'not-an-email' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => database.prepare(`
            INSERT INTO office_inquiries (
                id, first_name, last_name, phone, email, message, language, handled_by_staff_id
            ) VALUES ('inq-bad-staff', 'Ali', 'Kaya', '+905551112233', NULL, 'Geçerli mesaj', 'tr', 'missing-staff')
        `).run(),
        /FOREIGN KEY constraint failed/
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
