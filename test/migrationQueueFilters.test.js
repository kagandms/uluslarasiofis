import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { queryStaffApplications } from '../src/server/routes/staffApplicationRoutes.js';
import { handlePhysicalIntakes } from '../src/server/routes/physical-intake-routes.js';
import { createStatusWithMigrationBadge } from '../src/staff/application-queue-table.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = {
        DB: database,
        APP_ENV: 'production',
        PHYSICAL_INTAKE_MODE: 'on',
        STAFF_SHARED_USERNAME: 'reviewer-1',
        DOCUMENTS: {}
    };
    return { database, environment };
}

function makeRequest(path, { body = {}, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json' });
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

async function seedStaff(environment, database, id = 'reviewer-1', token = 'staff-session-token-01234567890123456789012') {
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Reviewer', 'reviewer')
    `).bind(id, id, id).run();
    const tokenHash = await hashSessionToken(token);
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, tokenHash, new Date(Date.now() + 60_000).toISOString()).run();
    environment.STAFF_PHYSICAL_ALLOWED_SESSION_HASHES = tokenHash;
    return `staff_session=${token}`;
}

async function seedOnline(database, { id, studentNumber, firstName, lastName, status, overlayState = null, note = '', deadline = null }) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, first_name, last_name,
            is_under_18, address_evidence_type, document_policy_version, submitted_at, created_at, updated_at
        ) VALUES (?, ?, 'initial', ?, ?, ?, 0, 'rental_contract', 1, '2026-11-10T10:00:00.000Z', '2026-11-05T10:00:00.000Z', '2026-11-10T10:00:00.000Z')
    `).bind(id, studentId, status, firstName, lastName).run();
    if (overlayState) {
        await database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
            ) VALUES ('online', ?, '2026-11-0000001', ?, ?, ?, 'imp-1', 'reviewer-1', '2026-11-27T09:00:00.000Z')
        `).bind(id, overlayState, note, deadline).run();
    }
}

async function seedPhysical(database, { id, studentNumber, firstName, lastName, passport, tracking, status, overlayState = null, note = '', deadline = null }) {
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number, application_type, application_route,
            status, tracking_reference, application_date, submitted_at, updated_at, lock_version, created_by_staff_id
        ) VALUES (?, ?, ?, ?, ?, 'initial', 'standard', ?, ?, '2026-11-05', '2026-11-05T10:00:00.000Z', '2026-11-10T10:00:00.000Z', 1, 'reviewer-1')
    `).bind(id, studentNumber, firstName, lastName, passport, status, tracking).run();
    if (overlayState) {
        await database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
            ) VALUES ('physical', ?, '2026-11-0000002', ?, ?, ?, 'imp-1', 'reviewer-1', '2026-11-27T09:00:00.000Z')
        `).bind(id, overlayState, note, deadline).run();
    }
}

test('online queue SQL filters exclude stale overlay on reverted record and return badge fields', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    await seedOnline(database, {
        id: 'app-missing',
        studentNumber: '26000000001',
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        status: 'sent_to_migration',
        overlayState: 'missing_documents',
        note: 'Poliçe eksik',
        deadline: '2026-12-10'
    });
    // Stale overlay on a reverted record must NOT match filter and must NOT expose badge
    await seedOnline(database, {
        id: 'app-reverted-stale',
        studentNumber: '26000000002',
        firstName: 'Mehmet',
        lastName: 'Demir',
        status: 'under_review',
        overlayState: 'missing_documents',
        note: 'Eski not',
        deadline: '2026-12-01'
    });
    await seedOnline(database, {
        id: 'app-approved',
        studentNumber: '26000000003',
        firstName: 'Fatma',
        lastName: 'Kaya',
        status: 'migration_approved'
    });

    const missingResult = await queryStaffApplications(
        makeRequest('/api/staff/applications/query', { body: { status: 'migration_missing_documents', page: 1, page_size: 25 }, cookie }),
        environment
    );
    assert.deepEqual(missingResult.items.map((item) => item.id), ['app-missing']);
    assert.equal(missingResult.pagination.total_items, 1);
    assert.deepEqual(missingResult.items[0].migration_office, {
        state: 'missing_documents',
        deadline: '2026-12-10',
        note: 'Poliçe eksik'
    });

    const approvedResult = await queryStaffApplications(
        makeRequest('/api/staff/applications/query', { body: { status: 'migration_approved', page: 1, page_size: 25 }, cookie }),
        environment
    );
    assert.deepEqual(approvedResult.items.map((item) => item.id), ['app-approved']);

    const allResult = await queryStaffApplications(
        makeRequest('/api/staff/applications/query', { body: { status: 'all', page: 1, page_size: 25 }, cookie }),
        environment
    );
    const revertedItem = allResult.items.find((item) => item.id === 'app-reverted-stale');
    assert.equal(revertedItem.migration_office, null);
});

test('physical queue SQL filters exclude stale overlay on reverted record and UI renders badge only for sent_to_migration', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    await seedPhysical(database, {
        id: '11111111-1111-4111-8111-111111111111',
        studentNumber: '26000000011',
        firstName: 'Zeynep',
        lastName: 'Ak',
        passport: 'P1111',
        tracking: 'TRK-1',
        status: 'sent_to_migration',
        overlayState: 'missing_documents',
        note: 'Fotoğraf eksik',
        deadline: '2026-12-15'
    });
    await seedPhysical(database, {
        id: '22222222-2222-4222-8222-222222222222',
        studentNumber: '26000000012',
        firstName: 'Ali',
        lastName: 'Veli',
        passport: 'P2222',
        tracking: 'TRK-2',
        status: 'under_review',
        overlayState: 'missing_documents',
        note: 'Eski not',
        deadline: '2026-12-01'
    });
    await seedPhysical(database, {
        id: '33333333-3333-4333-8333-333333333333',
        studentNumber: '26000000013',
        firstName: 'Can',
        lastName: 'Öz',
        passport: 'P3333',
        tracking: 'TRK-3',
        status: 'migration_approved'
    });

    const missingResult = await handlePhysicalIntakes(
        makeRequest('/api/staff/physical-intakes/query', { body: { status: 'migration_missing_documents', page: 1, page_size: 25 }, cookie }),
        environment,
        'req-1'
    );
    assert.deepEqual(missingResult.items.map((item) => item.id), ['11111111-1111-4111-8111-111111111111']);
    assert.equal(missingResult.pagination.total, 1);

    const approvedResult = await handlePhysicalIntakes(
        makeRequest('/api/staff/physical-intakes/query', { body: { status: 'migration_approved', page: 1, page_size: 25 }, cookie }),
        environment,
        'req-2'
    );
    assert.deepEqual(approvedResult.items.map((item) => item.id), ['33333333-3333-4333-8333-333333333333']);

    // Render physical queue UI with both active missing_documents and stale reverted record
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    const root = dom.window.document.getElementById('root');
    const allResult = await handlePhysicalIntakes(
        makeRequest('/api/staff/physical-intakes/query', { body: { status: 'all', page: 1, page_size: 25 }, cookie }),
        environment,
        'req-3'
    );
    renderPhysicalIntakes(root, {
        view: 'queue',
        loading: false,
        query: { q: '', status: 'all', from_date: '', to_date: '' },
        result: allResult,
        recordNotes: new Map()
    }, {
        search: () => {},
        newReceipt: () => {},
        open: () => {},
        page: () => {}
    });

    const badges = root.querySelectorAll('.staff-migration-missing-badge');
    assert.equal(badges.length, 1);
    assert.match(root.textContent, /15\.12\.2026/);
    assert.match(root.textContent, /Fotoğraf eksik/);
    assert.doesNotMatch(root.textContent, /Eski not/);

    // Also verify createStatusWithMigrationBadge helper directly
    const plain = createStatusWithMigrationBadge(dom.window.document, 'Göç İdaresi inceliyor', null);
    assert.equal(plain, 'Göç İdaresi inceliyor');
});
