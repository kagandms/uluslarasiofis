/**
 * Migration 0047 (`chat_sessions` ve `chat_turns`) şema, indeks, kısıtlama,
 * kademeli silme ve kişisel veri sütunu yokluğu testleri.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyAllMigrations } from './helpers/apply-migrations.js';

const FORBIDDEN_PII_COLUMNS = Object.freeze([
    'ip',
    'ip_address',
    'client_ip',
    'user_agent',
    'ua',
    'application_id',
    'student_id',
    'phone',
    'email',
    'first_name',
    'last_name'
]);

function createDatabase() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    applyAllMigrations(database);
    return database;
}

function insertSession(database, overrides = {}) {
    const row = {
        id: '11111111-1111-4111-8111-111111111111',
        language: 'tr',
        turn_count: 1,
        ...overrides
    };
    database.prepare(`
        INSERT INTO chat_sessions (id, language, turn_count)
        VALUES (?, ?, ?)
    `).run(row.id, row.language, row.turn_count);
    return row.id;
}

function insertTurn(database, overrides = {}) {
    const row = {
        id: '22222222-2222-4222-8222-222222222222',
        session_id: '11111111-1111-4111-8111-111111111111',
        seq: 1,
        user_text: 'Başvuru adımları nelerdir?',
        assistant_text: 'Ana sayfadan başvurunuzu başlatabilirsiniz.',
        outcome: 'ok',
        tools: '[]',
        latency_ms: 42,
        feedback: null,
        feedback_at: null,
        ...overrides
    };
    database.prepare(`
        INSERT INTO chat_turns (
            id, session_id, seq, user_text, assistant_text, outcome, tools, latency_ms, feedback, feedback_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.id,
        row.session_id,
        row.seq,
        row.user_text,
        row.assistant_text,
        row.outcome,
        row.tools,
        row.latency_ms,
        row.feedback,
        row.feedback_at
    );
    return row.id;
}

test('chat_log migration 0047 exists without version collision, creates tables and indexes, and has no PII metadata columns', () => {
    const migrationFiles = readdirSync(new URL('../migrations/', import.meta.url))
        .filter((file) => file.endsWith('.sql'))
        .sort();
    const version47Files = migrationFiles.filter((file) => file.startsWith('0047_'));
    assert.deepEqual(version47Files, ['0047_chat_log.sql']);

    const database = createDatabase();
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name);
    const sessionColumns = database.prepare('PRAGMA table_info(chat_sessions)').all().map(({ name }) => name);
    const turnColumns = database.prepare('PRAGMA table_info(chat_turns)').all().map(({ name }) => name);
    const sessionIndexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_sessions'")
        .all()
        .map(({ name }) => name);
    const turnIndexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_turns'")
        .all()
        .map(({ name }) => name);

    assert.ok(tables.includes('chat_sessions'));
    assert.ok(tables.includes('chat_turns'));
    assert.deepEqual(sessionColumns, ['id', 'language', 'created_at', 'last_at', 'turn_count']);
    assert.deepEqual(turnColumns, [
        'id',
        'session_id',
        'seq',
        'user_text',
        'assistant_text',
        'outcome',
        'tools',
        'latency_ms',
        'feedback',
        'feedback_at',
        'created_at'
    ]);

    for (const forbidden of FORBIDDEN_PII_COLUMNS) {
        assert.equal(sessionColumns.includes(forbidden), false, `chat_sessions must not contain ${forbidden}`);
        assert.equal(turnColumns.includes(forbidden), false, `chat_turns must not contain ${forbidden}`);
    }

    assert.ok(sessionIndexes.includes('idx_chat_sessions_last_at'));
    assert.ok(turnIndexes.includes('idx_chat_turns_created'));
    assert.ok(turnIndexes.includes('idx_chat_turns_feedback_created'));
    assert.ok(turnIndexes.includes('idx_chat_turns_outcome_created'));
});

test('chat_log migration enforces defaults, CHECK constraints, foreign keys, and ON DELETE CASCADE', () => {
    const database = createDatabase();

    database.prepare(`
        INSERT INTO chat_sessions (id, language)
        VALUES ('11111111-1111-4111-8111-111111111111', 'tr')
    `).run();

    const storedSession = database.prepare(`
        SELECT language, created_at, last_at, turn_count
        FROM chat_sessions WHERE id = '11111111-1111-4111-8111-111111111111'
    `).get();
    assert.equal(storedSession.language, 'tr');
    assert.equal(storedSession.turn_count, 0);
    assert.ok(storedSession.created_at);
    assert.ok(storedSession.last_at);

    database.prepare(`
        INSERT INTO chat_turns (id, session_id, seq, user_text, assistant_text, outcome)
        VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1, 'Merhaba', 'Selam', 'ok')
    `).run();

    const storedTurn = database.prepare(`
        SELECT tools, latency_ms, feedback, feedback_at, created_at
        FROM chat_turns WHERE id = '22222222-2222-4222-8222-222222222222'
    `).get();
    assert.equal(storedTurn.tools, '[]');
    assert.equal(storedTurn.latency_ms, 0);
    assert.equal(storedTurn.feedback, null);
    assert.equal(storedTurn.feedback_at, null);
    assert.ok(storedTurn.created_at);

    // Valid feedback values ('up' and 'down') succeed.
    database.prepare("UPDATE chat_turns SET feedback = 'up' WHERE id = '22222222-2222-4222-8222-222222222222'").run();
    database.prepare("UPDATE chat_turns SET feedback = 'down' WHERE id = '22222222-2222-4222-8222-222222222222'").run();

    // Invalid constraints fail.
    assert.throws(
        () => insertSession(database, { id: 'bad-lang', language: 'de' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertSession(database, { id: 'neg-turns', turn_count: -1 }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'bad-seq', seq: 0 }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'empty-user', seq: 2, user_text: '' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'long-user', seq: 3, user_text: 'a'.repeat(501) }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'empty-assistant', seq: 4, assistant_text: '' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'long-assistant', seq: 5, assistant_text: 'b'.repeat(4001) }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'bad-feedback', seq: 6, feedback: 'maybe' }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'neg-latency', seq: 7, latency_ms: -1 }),
        /CHECK constraint failed/
    );
    assert.throws(
        () => insertTurn(database, { id: 'orphan-turn', session_id: 'missing-session', seq: 1 }),
        /FOREIGN KEY constraint failed/
    );

    // ON DELETE CASCADE deletes child turns when the parent session is deleted.
    database.prepare("DELETE FROM chat_sessions WHERE id = '11111111-1111-4111-8111-111111111111'").run();
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM chat_turns').get().count, 0);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
