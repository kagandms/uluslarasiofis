import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { runStaffAssistantTool } from '../src/server/domain/staffAssistantTools.js';
import { createApplicationRepository } from '../src/server/repositories/d1/applicationRepository.js';
import { createPhysicalIntakeRepository } from '../src/server/repositories/d1/physical-intake-repository.js';
import { foldedSqlExpression } from '../src/server/repositories/d1/search-fold-sql.js';
import { foldSearchText, searchTokens } from '../src/shared/searchFold.js';

function createSqliteD1Shim(sqlite) {
    return {
        prepare(sql) {
            const createStatement = (values = []) => ({
                bind(...boundValues) {
                    return createStatement(boundValues);
                },
                async all() {
                    return { results: sqlite.prepare(sql).all(...values) };
                },
                async first() {
                    return sqlite.prepare(sql).get(...values) ?? null;
                }
            });
            return createStatement();
        }
    };
}

function createMinimalApplicationDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE students (
            id TEXT PRIMARY KEY,
            student_number TEXT NOT NULL
        );
        CREATE TABLE applications (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            reference_number TEXT,
            passport_number TEXT,
            first_name TEXT,
            last_name TEXT,
            application_type TEXT DEFAULT 'initial',
            application_route TEXT DEFAULT 'standard',
            status TEXT DEFAULT 'submitted',
            submitted_at TEXT DEFAULT '2026-11-01T10:00:00.000Z',
            created_at TEXT DEFAULT '2026-11-01T10:00:00.000Z',
            updated_at TEXT DEFAULT '2026-11-01T10:00:00.000Z'
        );
        CREATE TABLE application_deletions (
            application_id TEXT
        );
        CREATE TABLE application_spreadsheet_records (
            application_id TEXT,
            state TEXT,
            sheet_name TEXT
        );
    `);
    return sqlite;
}

function insertApplicationRow(sqlite, { id, studentNumber, referenceNumber, passportNumber, firstName, lastName }) {
    const studentId = `stu-${id}`;
    sqlite.prepare('INSERT INTO students (id, student_number) VALUES (?, ?)').run(studentId, studentNumber);
    sqlite.prepare(`
        INSERT INTO applications (id, student_id, reference_number, passport_number, first_name, last_name)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, studentId, referenceNumber, passportNumber, firstName, lastName);
}

function createMinimalPhysicalIntakeDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE physical_intakes (
            id TEXT PRIMARY KEY,
            student_number TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            passport_number TEXT NOT NULL,
            application_type TEXT DEFAULT 'initial',
            application_route TEXT DEFAULT 'standard',
            status TEXT DEFAULT 'under_review',
            linked_application_id TEXT,
            current_pdf_id TEXT,
            submitted_at TEXT DEFAULT '2026-11-01T10:00:00.000Z',
            updated_at TEXT DEFAULT '2026-11-01T10:00:00.000Z',
            lock_version INTEGER DEFAULT 1,
            deleted_at TEXT,
            rejection_reason TEXT,
            legacy_status TEXT,
            tracking_reference TEXT,
            application_date TEXT DEFAULT '2026-11-01',
            metadata_version INTEGER DEFAULT 1,
            registration_body_hash TEXT,
            processing_closed_at TEXT,
            processing_closed_by_staff_id TEXT,
            processing_closure_reason TEXT
        );
        CREATE TABLE physical_intake_receipts (
            intake_id TEXT,
            document_version INTEGER,
            state TEXT,
            metadata_version INTEGER,
            template_version INTEGER
        );
        CREATE TABLE physical_receipt_print_attempts (
            intake_id TEXT,
            created_at TEXT,
            id TEXT,
            status TEXT
        );
    `);
    return sqlite;
}

function escapeLike(value) {
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

test('foldedSqlExpression produces the same result as foldSearchText over supported Latin names in node:sqlite', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE sample_names (raw_name TEXT NOT NULL)');

    const names = [
        'ILBEK',
        'ilbek',
        'İbrahim',
        'Ibrahim',
        'ılgın',
        'ŞAHİN Çağlar',
        'Ömer Ünal',
        'Müller',
        'Wasim Akram',
        'Vasim Akram',
        'Âdem Îsâ Ûmit',
        'Änä Ýazmyradow Ňury Žanna',
        'Çç Ğğ İIı Öö Şş Üü Ââ Îî Ûû Ää Ýý Ňň Žž Ww'
    ];

    const insert = sqlite.prepare('INSERT INTO sample_names (raw_name) VALUES (?)');
    for (const name of names) {
        insert.run(name);
    }

    const rows = sqlite.prepare(`SELECT raw_name, ${foldedSqlExpression('raw_name')} AS sql_folded FROM sample_names`).all();
    assert.equal(rows.length, names.length);
    for (const row of rows) {
        assert.equal(row.sql_folded, foldSearchText(row.raw_name), `Mismatch for ${row.raw_name}`);
    }
});

test('applicationRepository tolerant name search matches W/V, Turkish letters, accents, middle names, order, and literal codes', async () => {
    const sqlite = createMinimalApplicationDatabase();
    insertApplicationRow(sqlite, {
        id: 'app-vasim-1',
        studentNumber: '20260001',
        referenceNumber: 'ITU-2026-1001',
        passportNumber: 'PP1001',
        firstName: 'Vasim',
        lastName: 'Akram'
    });
    insertApplicationRow(sqlite, {
        id: 'app-wasim-2',
        studentNumber: '20260002',
        referenceNumber: 'ITU-2026-1002',
        passportNumber: 'PP1002',
        firstName: 'WASIM',
        lastName: 'AKRAM'
    });
    insertApplicationRow(sqlite, {
        id: 'app-sahin-3',
        studentNumber: '20260003',
        referenceNumber: 'ITU-2026-1003',
        passportNumber: 'PP1003',
        firstName: 'ŞAHİN',
        lastName: 'Çağlar'
    });
    insertApplicationRow(sqlite, {
        id: 'app-saad-4',
        studentNumber: '20260004',
        referenceNumber: 'ITU-2026-1004',
        passportNumber: 'PP1004',
        firstName: 'Muhammad Saad',
        lastName: 'Naeem'
    });
    insertApplicationRow(sqlite, {
        id: 'app-ayse-5',
        studentNumber: '20260005',
        referenceNumber: 'ITU-2026-1005',
        passportNumber: 'PP1005',
        firstName: 'Ayşe',
        lastName: 'Demir'
    });

    const d1Shim = createSqliteD1Shim(sqlite);
    const repository = createApplicationRepository(d1Shim);

    const searchIds = async (term, pageSize = 25) => {
        const result = await repository.queryStaffApplications({
            statuses: null,
            isDraft: false,
            searchPattern: escapeLike(term),
            searchNameTokens: searchTokens(term),
            pageSize,
            offset: 0
        });
        return { ids: result.items.map((row) => row.id).sort(), totalItems: result.totalItems };
    };

    assert.deepEqual((await searchIds('wasim')).ids, ['app-vasim-1', 'app-wasim-2']);
    assert.deepEqual((await searchIds('vasim')).ids, ['app-vasim-1', 'app-wasim-2']);
    assert.deepEqual((await searchIds('sahin')).ids, ['app-sahin-3']);
    assert.deepEqual((await searchIds('caglar sahin')).ids, ['app-sahin-3']);
    assert.deepEqual((await searchIds('saad muhammad')).ids, ['app-saad-4']);
    assert.deepEqual((await searchIds('NAEEM')).ids, ['app-saad-4']);
    assert.deepEqual((await searchIds('ayse')).ids, ['app-ayse-5']);

    // Literal code columns still match ITU reference, student number, and passport number
    assert.deepEqual((await searchIds('ITU-2026-1003')).ids, ['app-sahin-3']);
    assert.deepEqual((await searchIds('20260004')).ids, ['app-saad-4']);
    assert.deepEqual((await searchIds('PP1005')).ids, ['app-ayse-5']);

    // Force COUNT(*) path (pageSize: 1 when 2 rows match)
    assert.equal((await searchIds('wasim', 1)).totalItems, 2);

    // Topi assistant search_applications shares the same tolerant matching
    const topiResult = await runStaffAssistantTool(
        'search_applications',
        { query: 'caglar sahin' },
        { environment: { DB: d1Shim }, staff: { id: 'staff-1', role: 'reviewer' } }
    );
    assert.equal(topiResult.results?.total, 1);
    assert.equal(topiResult.results?.items[0].id, 'app-sahin-3');
});

test('applicationRepository keeps % and _ literal on code columns and handles punctuation-only search safely', async () => {
    const sqlite = createMinimalApplicationDatabase();
    insertApplicationRow(sqlite, {
        id: 'app-pct',
        studentNumber: 'STU-50%',
        referenceNumber: 'ITU-50%',
        passportNumber: 'PASS-50%',
        firstName: 'Can',
        lastName: 'Kaya'
    });
    insertApplicationRow(sqlite, {
        id: 'app-500',
        studentNumber: 'STU-500',
        referenceNumber: 'ITU-500',
        passportNumber: 'PASS-500',
        firstName: 'Mert',
        lastName: 'Yilmaz'
    });
    insertApplicationRow(sqlite, {
        id: 'app-und',
        studentNumber: 'STU-a_b',
        referenceNumber: 'ITU-a_b',
        passportNumber: 'PASS-a_b',
        firstName: 'Deniz',
        lastName: 'Ozturk'
    });
    insertApplicationRow(sqlite, {
        id: 'app-axb',
        studentNumber: 'STU-axb',
        referenceNumber: 'ITU-axb',
        passportNumber: 'PASS-axb',
        firstName: 'Emre',
        lastName: 'Demir'
    });

    const repository = createApplicationRepository(createSqliteD1Shim(sqlite));
    const searchIds = async (term) => {
        const result = await repository.queryStaffApplications({
            statuses: null,
            isDraft: false,
            searchPattern: escapeLike(term),
            searchNameTokens: searchTokens(term),
            pageSize: 25,
            offset: 0
        });
        return result.items.map((row) => row.id).sort();
    };

    assert.deepEqual(await searchIds('50%'), ['app-pct']);
    assert.deepEqual(await searchIds('a_b'), ['app-und']);
    assert.deepEqual(await searchIds('%'), ['app-pct']);
});

test('physical-intake-repository applies tolerant name matching and preserves literal code columns', async () => {
    const sqlite = createMinimalPhysicalIntakeDatabase();
    const insert = sqlite.prepare(`
        INSERT INTO physical_intakes (id, student_number, first_name, last_name, passport_number, tracking_reference)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run('phy-vasim', '20261001', 'Vasim', 'Akram', 'PP-PHY-1', 'ITU-26-1001');
    insert.run('phy-sahin', '20261002', 'ŞAHİN', 'Çağlar', 'PP-PHY-2', 'ITU-26-1002');
    insert.run('phy-saad', '20261003', 'Muhammad Saad', 'Naeem', 'PP-PHY-3', 'ITU-26-1003');
    insert.run('phy-pct', 'STU-50%', 'Can', 'Kaya', 'PASS-50%', 'ITU-26-50%');
    insert.run('phy-500', 'STU-500', 'Mert', 'Yilmaz', 'PASS-500', 'ITU-26-500');

    const repository = createPhysicalIntakeRepository(createSqliteD1Shim(sqlite));
    const listIds = async (q) => {
        const result = await repository.list({ q, page: 1, pageSize: 25 });
        return result.items.map((row) => row.id).sort();
    };

    assert.deepEqual(await listIds('wasim'), ['phy-vasim']);
    assert.deepEqual(await listIds('sahin'), ['phy-sahin']);
    assert.deepEqual(await listIds('caglar sahin'), ['phy-sahin']);
    assert.deepEqual(await listIds('saad muhammad'), ['phy-saad']);
    assert.deepEqual(await listIds('ITU-26-1002'), ['phy-sahin']);
    assert.deepEqual(await listIds('PP-PHY-3'), ['phy-saad']);
    assert.deepEqual(await listIds('50%'), ['phy-pct']);
});
