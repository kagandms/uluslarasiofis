import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffArchiveManager } from '../src/staff/archiveManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const DELETED_PHYSICAL_ID = '11111111-1111-4111-8111-111111111111';
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
