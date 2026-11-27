import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNameMatch } from '../src/server/domain/migrationSyncNameMatch.js';
import { areNamesCompatible, buildMigrationSyncPlan } from '../src/server/domain/migrationSync.js';
import { handleStaffYoksisDocumentAudit } from '../src/server/routes/staffYoksisDocumentAuditRoutes.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function audit(fullName, overrides = {}) {
    return {
        source: 'excel',
        application_number: '2026-11-0000001',
        student_number: '26000000001',
        first_name: fullName,
        last_name: '',
        application_status: 'İşlem Tamamlandı',
        documents_json: '[]',
        missing_deadline: null,
        record_date: '2026-11-10',
        goc_last_query_at: '2026-11-26',
        ...overrides
    };
}

function portal(firstName, lastName, overrides = {}) {
    return {
        record_kind: 'online',
        record_id: 'app-1',
        student_number: '26000000001',
        first_name: firstName,
        last_name: lastName,
        status: 'sent_to_migration',
        created_at: '2026-11-01T10:00:00.000Z',
        updated_at: '2026-11-01T10:00:00.000Z',
        ...overrides
    };
}

test('classifyNameMatch level A (compatible): existing token rules plus folded joined-letters in same or sorted order', () => {
    assert.equal(classifyNameMatch(audit('Amir Hossein Karimi'), portal('Amirhossein', 'Karimi')), 'compatible');
    assert.equal(classifyNameMatch(audit('Abdu Salam'), portal('Abdusalam', '')), 'compatible');
    assert.equal(classifyNameMatch(audit('Karimi Amir Hossein'), portal('Amirhossein', 'Karimi')), 'compatible');
    assert.equal(classifyNameMatch(audit('Ayşe Fatma Yılmaz'), portal('Ayşe', 'Yılmaz')), 'compatible');
    assert.equal(areNamesCompatible(audit('Amir Hossein Karimi'), portal('Amirhossein', 'Karimi')), true);
});

test('classifyNameMatch level B (similar): transliterations, small token edits, and joined-letters with <=2 edits', () => {
    assert.equal(classifyNameMatch(audit('Resad Ibragimov'), portal('Rashad', 'Ibragimov')), 'similar');
    assert.equal(classifyNameMatch(audit('Guwanc Jumayew'), portal('Guvanch', 'Jumayev')), 'similar');
    assert.equal(classifyNameMatch(audit('Şahriyar Şahin'), portal('Shahriyar', 'Shahin')), 'similar');
    assert.equal(classifyNameMatch(audit('Ibragimov Resad'), portal('Rashad', 'Ibragimov')), 'similar');
    assert.equal(classifyNameMatch(audit('Amir Hossein Karimi'), portal('Amirhossain', 'Karimi')), 'similar');
    assert.equal(areNamesCompatible(audit('Resad Ibragimov'), portal('Rashad', 'Ibragimov')), false);
});

test('classifyNameMatch negative sibling cases and level C (different)', () => {
    assert.equal(classifyNameMatch(audit('Ali Karimov'), portal('Omar', 'Karimov')), 'different');
    assert.equal(classifyNameMatch(audit('Maryam Hosseini'), portal('Zahra', 'Hosseini')), 'different');
    assert.equal(classifyNameMatch(audit('Mehmet'), portal('Mehmet', 'Yılmaz')), 'different');
    assert.equal(classifyNameMatch(audit('Иван Петров'), portal('Ivan', 'Petrov')), 'different');
    assert.equal(classifyNameMatch(audit('Hasan Demir'), portal('Kemal', 'Yılmaz')), 'different');
    assert.equal(classifyNameMatch(audit(''), portal('Kemal', 'Yılmaz')), 'different');
});

test('buildMigrationSyncPlan routes level B to nameCheck, preserves unchanged, and keeps conflicts/mismatches in manual', () => {
    const plan = buildMigrationSyncPlan({
        nowMs: Date.parse('2026-11-27T10:00:00+03:00'),
        auditRows: [
            // 1) Similar, sent_to_migration -> approved -> nameCheck
            audit('Resad Ibragimov', {
                student_number: '26000000001',
                application_number: '2026-11-0000001',
                application_status: 'İşlem Tamamlandı'
            }),
            // 2) Similar, not sent_to_migration -> nameCheck with needs_attention: true
            audit('Guwanc Jumayew', {
                student_number: '26000000002',
                application_number: '2026-11-0000002',
                application_status: 'İşlem Bekliyor'
            }),
            // 3) Similar, no-change (sent_to_migration + reviewing) -> unchangedCount
            audit('Şahriyar Şahin', {
                student_number: '26000000003',
                application_number: '2026-11-0000003',
                application_status: 'İşlem Bekliyor'
            }),
            // 4) Similar, stale_query_conflict -> manual
            audit('Timur Aliyew', {
                student_number: '26000000004',
                application_number: '2026-11-0000004',
                application_status: 'İşlem Tamamlandı',
                goc_last_query_at: '2026-11-10'
            }),
            // 5) Similar, terminal_status_conflict (protected completed) -> manual
            audit('Nurlan Kerimow', {
                student_number: '26000000005',
                application_number: '2026-11-0000005',
                application_status: 'İşlem Bekliyor'
            }),
            // 6) Different (sibling) -> manual name_mismatch with excel_name
            audit('Ali Karimov', {
                student_number: '26000000006',
                application_number: '2026-11-0000006',
                application_status: 'İşlem Tamamlandı'
            }),
            // 7) Level A row exists alongside Level B row -> Level A wins (changes, not nameCheck)
            audit('Farhad Musayew', {
                student_number: '26000000007',
                application_number: '2026-11-0000007',
                application_status: 'İşlem Bekliyor'
            }),
            audit('Farhad Musayev', {
                student_number: '26000000007',
                application_number: '2026-11-0000008',
                application_status: 'İşlem Tamamlandı'
            })
        ],
        portalRecords: [
            portal('Rashad', 'Ibragimov', { record_id: 'app-1', student_number: '26000000001', status: 'sent_to_migration' }),
            portal('Guvanch', 'Jumayev', { record_id: 'app-2', student_number: '26000000002', status: 'under_review' }),
            portal('Shahriyar', 'Shahin', { record_id: 'app-3', student_number: '26000000003', status: 'sent_to_migration' }),
            portal('Temur', 'Aliyev', {
                record_id: 'app-4',
                student_number: '26000000004',
                status: 'sent_to_migration',
                overlay_state: 'missing_documents',
                overlay_goc_last_query_at: '2026-11-20'
            }),
            portal('Nurlan', 'Karimov', { record_id: 'app-5', student_number: '26000000005', status: 'completed' }),
            portal('Omar', 'Karimov', { record_id: 'app-6', student_number: '26000000006', status: 'sent_to_migration' }),
            portal('Farhad', 'Musayev', { record_id: 'app-7', student_number: '26000000007', status: 'sent_to_migration' })
        ]
    });

    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].record_id, 'app-7');
    assert.equal(plan.needsAttention.length, 0);
    assert.equal(plan.unchangedCount, 1);

    assert.equal(plan.nameCheck.length, 2);
    const nc1 = plan.nameCheck.find((item) => item.record_id === 'app-1');
    assert.equal(nc1.excel_name, 'Resad Ibragimov');
    assert.equal(nc1.target_state, 'approved');
    assert.equal(nc1.needs_attention, false);

    const nc2 = plan.nameCheck.find((item) => item.record_id === 'app-2');
    assert.equal(nc2.excel_name, 'Guwanc Jumayew');
    assert.equal(nc2.reason, 'not_sent_to_migration');
    assert.equal(nc2.needs_attention, true);

    const manualReasons = Object.fromEntries(plan.manual.map((item) => [item.record_id, item.reason]));
    assert.equal(manualReasons['app-4'], 'stale_query_conflict');
    assert.equal(manualReasons['app-5'], 'terminal_status_conflict');
    assert.equal(manualReasons['app-6'], 'name_mismatch');
    const mismatchItem = plan.manual.find((item) => item.record_id === 'app-6');
    assert.equal(mismatchItem.excel_name, 'Ali Karimov');
});

async function createRouteTestEnv() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'reviewer-1' };
    const token = 'reviewer-session-token-000000000000000000';
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('reviewer-1', 'reviewer-1', 'reviewer-1', 'test-hash', 'Reviewer', 'reviewer')
    `).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES ('sess-1', 'reviewer-1', ?, ?)
    `).bind(await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    return { database, environment, cookie: `staff_session=${token}` };
}

function makeRequest(path, body, cookie) {
    return new Request(`https://portal.test${path}`, {
        method: 'POST',
        headers: {
            Origin: 'https://portal.test',
            'Content-Type': 'application/json',
            Cookie: cookie
        },
        body: JSON.stringify(body)
    });
}

test('sync/preview returns nameCheck and sync/apply applies nameCheck only when requested, rejects different and unknown fields', async () => {
    const { database, environment, cookie } = await createRouteTestEnv();

    // Empty preview shape includes nameCheck
    const emptyRes = await handleStaffYoksisDocumentAudit(
        makeRequest('/api/staff/yoksis-document-audit/sync/preview', {}, cookie),
        environment,
        'req-empty'
    );
    assert.equal(emptyRes.status, 200);
    const emptyJson = await emptyRes.json();
    assert.deepEqual(emptyJson.nameCheck, []);

    // Seed import, students, applications, and excel audit rows
    await database.prepare(`
        INSERT INTO yoksis_audit_imports (id, uploaded_at, uploaded_by_staff_id, exported_at, row_count, finalized_at)
        VALUES ('imp-1', '2026-11-27T08:00:00.000Z', 'reviewer-1', '2026-11-27 08:00', 2, '2026-11-27T08:01:00.000Z')
    `).run();

    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number, created_at, updated_at)
        VALUES
            ('stu-1', '26000000011', '26000000011', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z'),
            ('stu-2', '26000000012', '26000000012', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')
    `).run();

    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, first_name, last_name,
            is_under_18, created_at, updated_at, last_activity_at
        )
        VALUES
            ('app-sim', 'stu-1', 'initial', 'sent_to_migration', 'Rashad', 'Ibragimov', 0, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z'),
            ('app-dif', 'stu-2', 'initial', 'sent_to_migration', 'Omar', 'Karimov', 0, '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z')
    `).run();

    await database.prepare(`
        INSERT INTO yoksis_document_audit_records (
            application_number, student_number, first_name, last_name, passport_number, phone,
            application_status, status_category, result_status, documents_json, search_text,
            scanned_at, updated_by_staff_id, source, last_seen_import_id, record_date, goc_last_query_at
        )
        VALUES
            ('2026-11-0000011', '26000000011', 'Resad Ibragimov', '', '', '', 'İşlem Tamamlandı', 'successful', 'verified', '[]', 'resad ibragimov 26000000011', '2026-11-27T08:00:00.000Z', 'reviewer-1', 'excel', 'imp-1', '2026-11-10', '2026-11-26'),
            ('2026-11-0000012', '26000000012', 'Ali Karimov', '', '', '', 'İşlem Tamamlandı', 'successful', 'verified', '[]', 'ali karimov 26000000012', '2026-11-27T08:00:00.000Z', 'reviewer-1', 'excel', 'imp-1', '2026-11-10', '2026-11-26')
    `).run();

    const previewRes = await handleStaffYoksisDocumentAudit(
        makeRequest('/api/staff/yoksis-document-audit/sync/preview', {}, cookie),
        environment,
        'req-preview'
    );
    assert.equal(previewRes.status, 200);
    const previewJson = await previewRes.json();
    assert.equal(previewJson.nameCheck.length, 1);
    assert.equal(previewJson.nameCheck[0].record_id, 'app-sim');
    assert.equal(previewJson.nameCheck[0].excel_name, 'Resad Ibragimov');
    assert.equal(previewJson.manual.length, 1);
    assert.equal(previewJson.manual[0].record_id, 'app-dif');
    assert.equal(previewJson.manual[0].reason, 'name_mismatch');
    assert.equal(previewJson.manual[0].excel_name, 'Ali Karimov');

    // Apply rejects unknown fields
    await assert.rejects(
        () => handleStaffYoksisDocumentAudit(
            makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
                import_id: 'imp-1',
                extra: true,
                items: [{
                    record_kind: 'online',
                    record_id: 'app-sim',
                    application_number: '2026-11-0000011',
                    version: '2026-11-01T10:00:00.000Z'
                }]
            }, cookie),
            environment,
            'req-bad-field'
        ),
        (err) => err.status === 400
    );

    // Apply applies nameCheck item and rejects/conflicts different item
    const applyRes = await handleStaffYoksisDocumentAudit(
        makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
            import_id: 'imp-1',
            items: [
                {
                    record_kind: 'online',
                    record_id: 'app-sim',
                    application_number: '2026-11-0000011',
                    version: '2026-11-01T10:00:00.000Z'
                },
                {
                    record_kind: 'online',
                    record_id: 'app-dif',
                    application_number: '2026-11-0000012',
                    version: '2026-11-01T10:00:00.000Z'
                }
            ]
        }, cookie),
        environment,
        'req-apply'
    );
    assert.equal(applyRes.status, 200);
    const applyJson = await applyRes.json();
    assert.equal(applyJson.applied.length, 1);
    assert.equal(applyJson.applied[0].record_id, 'app-sim');
    assert.equal(applyJson.applied[0].target_state, 'approved');
    assert.equal(applyJson.conflicts.length, 1);
    assert.equal(applyJson.conflicts[0].record_id, 'app-dif');

    const simApp = await database.prepare("SELECT status FROM applications WHERE id = 'app-sim'").first();
    const difApp = await database.prepare("SELECT status FROM applications WHERE id = 'app-dif'").first();
    assert.equal(simApp.status, 'migration_approved');
    assert.equal(difApp.status, 'sent_to_migration');
});
