import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffArchiveManager } from '../src/staff/archiveManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const TEST_PASSWORD = 'Test-only passphrase 2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

const DELETED_PHYSICAL_ID = '11111111-1111-4111-8111-111111111111';
const REJECTED_PHYSICAL_ID = '22222222-2222-4222-8222-222222222222';
const DELETED_ONLINE_ID = '33333333-3333-4333-8333-333333333333';

function createStaffDom() {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    return {
        dom,
        document: dom.window.document,
        archiveRoot: dom.window.document.getElementById('staff-archive-manager')
    };
}

function installDocument(context, document) {
    const previousDocument = globalThis.document;
    globalThis.document = document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        document.defaultView.close();
    });
}

async function createSeededEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = {
        DB: database,
        DOCUMENTS: {
            async get() { return null; },
            async head() { return null; },
            async put() { return {}; },
            async delete() {}
        },
        ASSETS: { async fetch() { return new Response('ok'); } },
        STAFF_SHARED_USERNAME: 'admin',
        APP_ENV: 'production',
        PHYSICAL_INTAKE_MODE: 'on'
    };

    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role, is_active)
        VALUES ('staff-shared', 'admin', 'admin', ?, 'Shared Admin', 'reviewer', 1)
    `).bind(PASSWORD_HASH).run();

    const sessionToken = 'physical-archive-session-token-000000000000000';
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-phys-archive', 'staff-shared', ?, ?, ?)
    `).bind(
        await hashSessionToken(sessionToken),
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
    ).run();

    // Sentetik silinmiş fiziksel teslim kaydı
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at,
            created_by_staff_id, status, lock_version, deleted_at,
            tracking_reference, application_date
        ) VALUES (
            ?, 'SYN-PHYS-01', 'Defne', 'Yılmaz', 'SYN-PASS-PHYS-DEL',
            'initial', 'standard', '2026-09-20T10:00:00.000Z', '2026-09-25T10:00:00.000Z',
            'staff-shared', 'under_review', 1, '2026-09-25T10:00:00.000Z',
            'ITU-SYN-2601', '2026-09-20'
        )
    `).bind(DELETED_PHYSICAL_ID).run();

    // Sentetik aktif reddedilmiş fiziksel teslim kaydı (arşivde görünmemeli)
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at,
            created_by_staff_id, status, lock_version, deleted_at,
            rejection_reason, tracking_reference, application_date
        ) VALUES (
            ?, 'SYN-PHYS-02', 'Emir', 'Kaya', 'SYN-PASS-PHYS-REJ',
            'renewal', 'standard', '2026-09-21T10:00:00.000Z', '2026-09-24T10:00:00.000Z',
            'staff-shared', 'rejected', 1, NULL,
            'Sentetik ret gerekçesi', 'ITU-SYN-2602', '2026-09-21'
        )
    `).bind(REJECTED_PHYSICAL_ID).run();

    // Sentetik silinmiş online başvuru kaydı
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number, created_at, updated_at)
        VALUES ('stu-syn-online-del', 'SYN-ONL-01', 'syn-onl-01', '2026-09-19T10:00:00.000Z', '2026-09-19T10:00:00.000Z')
    `).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, first_name, last_name, passport_number,
            application_type, status, submitted_at, created_at, updated_at
        ) VALUES (
            ?, 'stu-syn-online-del', 'Mert', 'Demir', 'SYN-PASS-ONL-DEL',
            'renewal', 'submitted', '2026-09-19T10:00:00.000Z', '2026-09-19T09:00:00.000Z', '2026-09-23T10:00:00.000Z'
        )
    `).bind(DELETED_ONLINE_ID).run();
    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES (?, 'submitted', 'soft_deleted', 'staff-shared', '2026-09-23T10:00:00.000Z')
    `).bind(DELETED_ONLINE_ID).run();

    return { database, environment, sessionToken };
}

function postJson(environment, path, body, sessionToken = null) {
    const headers = {
        'Content-Type': 'application/json',
        Origin: 'https://portal.test'
    };
    if (sessionToken) headers.Cookie = `staff_session=${sessionToken}`;
    return worker.fetch(new Request(`https://portal.test${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    }), environment, {});
}

test('deleted physical intake appears in archive_all and deleted, rejected physical stays out, and restore returns it to physical list', async () => {
    const { database, environment, sessionToken } = await createSeededEnvironment();

    // Yetkisiz istek reddedilir
    const unauth = await postJson(environment, '/api/staff/applications/query', { status: 'archive_all' });
    assert.equal(unauth.status, 401);

    // archive_all hem silinmiş fiziksel teslimi hem silinmiş online başvuruyu döndürür, reddedilen fiziksel kaydı döndürmez
    const archiveAllRes = await postJson(environment, '/api/staff/applications/query', { status: 'archive_all' }, sessionToken);
    assert.equal(archiveAllRes.status, 200);
    const archiveAll = await archiveAllRes.json();
    assert.equal(archiveAll.pagination.total_items, 2);
    assert.deepEqual(archiveAll.items.map((item) => item.id), [DELETED_PHYSICAL_ID, DELETED_ONLINE_ID]);

    const physicalRow = archiveAll.items.find((item) => item.id === DELETED_PHYSICAL_ID);
    assert.equal(physicalRow.kind, 'physical');
    assert.equal(physicalRow.note_kind, 'physical');
    assert.equal(physicalRow.passport_number, 'SYN-PASS-PHYS-DEL');
    assert.equal(physicalRow.first_name, 'Defne');
    assert.equal(physicalRow.last_name, 'Yılmaz');
    assert.equal(physicalRow.status, 'under_review');
    assert.equal(physicalRow.submitted_at, '2026-09-20T10:00:00.000Z');
    assert.equal(physicalRow.updated_at, '2026-09-25T10:00:00.000Z');
    assert.equal(physicalRow.lock_version, 1);

    const onlineRow = archiveAll.items.find((item) => item.id === DELETED_ONLINE_ID);
    assert.equal(onlineRow.kind, 'online');
    assert.equal(onlineRow.passport_number, 'SYN-PASS-ONL-DEL');
    assert.equal(onlineRow.deletion_state, 'soft_deleted');

    // deleted filtresi de her iki silinen kaydı döndürür, reddedileni döndürmez
    const deletedRes = await postJson(environment, '/api/staff/applications/query', { status: 'deleted' }, sessionToken);
    assert.equal(deletedRes.status, 200);
    const deletedPayload = await deletedRes.json();
    assert.equal(deletedPayload.pagination.total_items, 2);
    assert.deepEqual(deletedPayload.items.map((item) => item.id), [DELETED_PHYSICAL_ID, DELETED_ONLINE_ID]);
    assert.equal(deletedPayload.items.some((item) => item.id === REJECTED_PHYSICAL_ID), false);

    // Normal online kuyruğu (status: 'all') silinmiş fiziksel teslimi içermez
    const activeOnlineRes = await postJson(environment, '/api/staff/applications/query', { status: 'all' }, sessionToken);
    assert.equal(activeOnlineRes.status, 200);
    assert.equal((await activeOnlineRes.json()).items.length, 0);

    // Reddedilen fiziksel kayıt kendi Fiziksel listesinde kalır
    const physicalRejectedRes = await postJson(environment, '/api/staff/physical-intakes/query', { status: 'rejected' }, sessionToken);
    assert.equal(physicalRejectedRes.status, 200);
    const physicalRejected = await physicalRejectedRes.json();
    assert.deepEqual(physicalRejected.items.map((item) => item.id), [REJECTED_PHYSICAL_ID]);

    // Arama (q), tarih filtresi ve sayfalama her iki türde de çalışır
    const searchPhysRes = await postJson(environment, '/api/staff/applications/query', {
        status: 'archive_all',
        q: 'SYN-PASS-PHYS-DEL'
    }, sessionToken);
    assert.deepEqual((await searchPhysRes.json()).items.map((item) => item.id), [DELETED_PHYSICAL_ID]);

    const dateFilteredRes = await postJson(environment, '/api/staff/applications/query', {
        status: 'archive_all',
        from_date: '2026-09-20',
        to_date: '2026-09-20'
    }, sessionToken);
    assert.deepEqual((await dateFilteredRes.json()).items.map((item) => item.id), [DELETED_PHYSICAL_ID]);

    const page1Res = await postJson(environment, '/api/staff/applications/query', {
        status: 'archive_all',
        page: 1,
        page_size: 1
    }, sessionToken);
    const page1 = await page1Res.json();
    assert.equal(page1.pagination.total_items, 2);
    assert.equal(page1.pagination.total_pages, 2);
    assert.deepEqual(page1.items.map((item) => item.id), [DELETED_PHYSICAL_ID]);

    const page2Res = await postJson(environment, '/api/staff/applications/query', {
        status: 'archive_all',
        page: 2,
        page_size: 1
    }, sessionToken);
    const page2 = await page2Res.json();
    assert.deepEqual(page2.items.map((item) => item.id), [DELETED_ONLINE_ID]);

    // has_note filtresi staff_record_notes.record_kind ile eşleşir
    await database.prepare(`
        INSERT INTO staff_record_notes (
            record_kind, record_id, body, created_by_staff_id, created_at, updated_by_staff_id, updated_at
        ) VALUES ('physical', ?, 'Sentetik fiziksel not', 'staff-shared', '2026-09-25T11:00:00.000Z', 'staff-shared', '2026-09-25T11:00:00.000Z')
    `).bind(DELETED_PHYSICAL_ID).run();

    const withNoteRes = await postJson(environment, '/api/staff/applications/query', {
        status: 'deleted',
        has_note: 'yes'
    }, sessionToken);
    assert.deepEqual((await withNoteRes.json()).items.map((item) => item.id), [DELETED_PHYSICAL_ID]);

    const withoutNoteRes = await postJson(environment, '/api/staff/applications/query', {
        status: 'deleted',
        has_note: 'no'
    }, sessionToken);
    assert.deepEqual((await withoutNoteRes.json()).items.map((item) => item.id), [DELETED_ONLINE_ID]);

    // Fiziksel geri yükleme ucu çalıştırıldığında kayıt arşivden çıkar ve Fiziksel listesine döner
    const restoreRes = await postJson(
        environment,
        `/api/staff/physical-intakes/${DELETED_PHYSICAL_ID}/restore`,
        { lock_version: physicalRow.lock_version },
        sessionToken
    );
    assert.equal(restoreRes.status, 200);
    const restoredDetail = await restoreRes.json();
    assert.equal(restoredDetail.intake.deleted_at, null);

    const archiveAfterRestore = await (await postJson(environment, '/api/staff/applications/query', {
        status: 'archive_all'
    }, sessionToken)).json();
    assert.deepEqual(archiveAfterRestore.items.map((item) => item.id), [DELETED_ONLINE_ID]);

    const deletedAfterRestore = await (await postJson(environment, '/api/staff/applications/query', {
        status: 'deleted'
    }, sessionToken)).json();
    assert.deepEqual(deletedAfterRestore.items.map((item) => item.id), [DELETED_ONLINE_ID]);

    const physicalActiveAfterRestore = await (await postJson(environment, '/api/staff/physical-intakes/query', {
        status: 'all'
    }, sessionToken)).json();
    assert.equal(physicalActiveAfterRestore.items.some((item) => item.id === DELETED_PHYSICAL_ID), true);
});

test('archiveManager renders physical rows with physical noteKind, Geri Yükle restore action, and detail view', async (context) => {
    const { document, archiveRoot } = createStaffDom();
    installDocument(context, document);

    let physicalRestored = false;
    const restoreCalls = [];
    let detailMode = 'available';

    const physicalItem = {
        kind: 'physical',
        note_kind: 'physical',
        id: DELETED_PHYSICAL_ID,
        student_number: 'SYN-PHYS-01',
        passport_number: 'SYN-PASS-PHYS-DEL',
        first_name: 'Defne',
        last_name: 'Yılmaz',
        application_type: 'initial',
        status: 'under_review',
        submitted_at: '2026-09-20T10:00:00.000Z',
        updated_at: '2026-09-25T10:00:00.000Z',
        deleted_at: '2026-09-25T10:00:00.000Z',
        deletion_state: 'soft_deleted',
        lock_version: 2,
        tracking_reference: 'ITU-SYN-2601'
    };

    const onlineItem = {
        kind: 'online',
        id: DELETED_ONLINE_ID,
        student_number: 'SYN-ONL-01',
        passport_number: 'SYN-PASS-ONL-DEL',
        first_name: 'Mert',
        last_name: 'Demir',
        application_type: 'renewal',
        status: 'submitted',
        submitted_at: '2026-09-19T10:00:00.000Z',
        updated_at: '2026-09-23T10:00:00.000Z',
        deletion_state: 'soft_deleted'
    };

    const api = {
        async queryApplications() {
            const items = physicalRestored ? [onlineItem] : [physicalItem, onlineItem];
            return {
                items,
                pagination: { page: 1, page_size: 25, total_items: items.length, total_pages: 1 }
            };
        },
        async readApplicationDetail() {
            throw new Error('not used for physical row');
        },
        async readPhysicalIntakeDetail(id) {
            if (detailMode === 'unavailable') {
                throw Object.assign(new Error('Forbidden'), { status: 403 });
            }
            return {
                intake: { ...physicalItem, id },
                files: [],
                receipts: [],
                current_pdf: { original_filename: 'sentetik-fiziksel.pdf' }
            };
        },
        async restorePhysicalIntake(id, lockVersion) {
            restoreCalls.push({ id, lockVersion });
            physicalRestored = true;
            return { intake: { ...physicalItem, deleted_at: null } };
        }
    };

    initWorkspaceNavigation();
    initializeStaffArchiveManager(archiveRoot, api);

    document.querySelector('.home-actions [data-workspace-view="archive"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    const rows = [...archiveRoot.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 2);

    const [physRow, onlRow] = rows;
    assert.equal(physRow.querySelector('[data-action="record-note"]')?.dataset.noteKind, 'physical');
    assert.equal(onlRow.querySelector('[data-action="record-note"]')?.dataset.noteKind, 'online');

    // Fiziksel satır Detay ve Geri Yükle içerir; ZIP veya kalıcı sil içermez
    assert.equal(physRow.querySelector('[data-action="open-detail"]')?.textContent, 'Detay');
    assert.equal(physRow.querySelector('[data-action="restore"]')?.textContent, 'Geri Yükle');
    assert.equal(physRow.querySelector('[data-action="download-application-archive"]'), null);
    assert.equal(physRow.querySelector('[data-action="purge-application"]'), null);

    // Online satır kendi işlemlerini korur
    assert.equal(onlRow.querySelector('[data-action="open-detail"]')?.textContent, 'Detay');
    assert.equal(onlRow.querySelector('[data-action="download-application-archive"]')?.textContent, 'Belgeleri ZIP indir');
    assert.equal(onlRow.querySelector('[data-action="restore-application"]')?.textContent, 'Geri al');
    assert.equal(onlRow.querySelector('[data-action="purge-application"]')?.textContent, 'Kalıcı sil');

    // Detay düğmesi fiziksel kaydın detayını açar
    physRow.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Fiziksel teslim bilgileri/);
    assert.match(archiveRoot.textContent, /ITU-SYN-2601/);
    assert.match(archiveRoot.textContent, /sentetik-fiziksel\.pdf/);
    archiveRoot.querySelector('[data-action="back-to-queue"]').click();

    // Detay alınamadığında arşiv içinde açık bir mesaj gösterilir
    detailMode = 'unavailable';
    archiveRoot.querySelector('tbody tr [data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(archiveRoot.textContent, /Fiziksel teslim kaydının tam ayrıntısı arşiv görünümünde açılamadı/);
    archiveRoot.querySelector('[data-action="back-to-queue"]').click();

    // Geri Yükle düğmesi restore ucunu çağırır ve listeyi yeniler
    archiveRoot.querySelector('tbody tr [data-action="restore"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(restoreCalls, [{ id: DELETED_PHYSICAL_ID, lockVersion: 2 }]);
    assert.match(archiveRoot.textContent, /Fiziksel teslim kaydı geri yüklendi\./);
    assert.equal(archiveRoot.querySelectorAll('tbody tr').length, 1);
    assert.doesNotMatch(archiveRoot.textContent, /SYN-PASS-PHYS-DEL/);
});
