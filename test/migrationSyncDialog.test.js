import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
    MIGRATION_SYNC_BATCH_SIZE,
    chunkSyncItems,
    openMigrationSyncDialog,
    summarizeSyncPlan
} from '../src/staff/migrationSyncDialog.js';
import { initializeYoksisDocumentAuditManager } from '../src/managers/yoksisDocumentAuditManager.js';
import { getIstanbulTodayIso, shiftIsoCalendarDate } from '../src/server/domain/yoksisAuditPolicy.js';

function createDom() {
    return new JSDOM('<!doctype html><html><body><button id="trigger" type="button">Durumları portala işle</button></body></html>', {
        url: 'https://portal.test/yetkili/'
    });
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

test('summarizeSyncPlan and chunkSyncItems compute counts and 20-item packets', () => {
    const counts = summarizeSyncPlan({
        changes: [
            { target_state: 'approved' },
            { target_state: 'missing_documents' }
        ],
        needsAttention: [
            { target_state: 'reviewing' },
            { target_state: 'approved' }
        ],
        manual: [{ reason: 'name_mismatch' }],
        unchangedCount: 7
    });
    assert.deepEqual(counts, {
        approved: 2,
        missing_documents: 1,
        reviewing: 1,
        manual: 1,
        unchanged: 7
    });

    const items45 = Array.from({ length: 45 }, (_, index) => ({ id: index + 1 }));
    const packets = chunkSyncItems(items45, MIGRATION_SYNC_BATCH_SIZE);
    assert.deepEqual(packets.map((packet) => packet.length), [20, 20, 5]);
});

test('preview dialog shows counts, default selection, needsAttention warning, manual reasons, and accessible focus/Esc', async () => {
    const dom = createDom();
    const { document } = dom.window;
    const trigger = document.getElementById('trigger');
    trigger.focus();

    const previewPayload = {
        import_id: 'imp-1',
        exported_at: '2026-11-27 08:00',
        changes: [
            {
                record_kind: 'online',
                record_id: 'app-1',
                application_number: '2026-11-0000001',
                student_number: '26000000001',
                first_name: 'Ayşe',
                last_name: 'Yılmaz',
                current_status: 'sent_to_migration',
                target_state: 'approved',
                version: '2026-11-27T08:00:00.000Z',
                reason: 'status_approved',
                note: '',
                deadline: null
            },
            {
                record_kind: 'physical',
                record_id: 'phys-1',
                application_number: '2026-11-0000002',
                student_number: '26000000002',
                first_name: 'Mehmet',
                last_name: 'Demir',
                current_status: 'sent_to_migration',
                target_state: 'missing_documents',
                version: 3,
                reason: 'missing_documents',
                note: 'Sigorta poliçesi',
                deadline: '2026-12-10'
            }
        ],
        needsAttention: [
            {
                record_kind: 'online',
                record_id: 'app-2',
                application_number: '2026-11-0000003',
                student_number: '26000000003',
                first_name: 'Fatma',
                last_name: 'Kaya',
                current_status: 'under_review',
                target_state: 'reviewing',
                version: '2026-11-27T08:00:00.000Z',
                reason: 'not_sent_to_migration',
                note: '',
                deadline: null
            }
        ],
        manual: [
            {
                record_kind: 'online',
                record_id: 'app-3',
                application_number: '2026-11-0000004',
                student_number: '26000000004',
                first_name: 'Can',
                last_name: 'Öz',
                current_status: 'sent_to_migration',
                target_state: 'approved',
                version: '2026-11-27T08:00:00.000Z',
                reason: 'name_mismatch',
                note: '',
                deadline: null
            }
        ],
        unchangedCount: 4
    };

    const fetcher = async (url) => {
        if (url.endsWith('/sync/preview')) return jsonResponse(previewPayload);
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        trigger,
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00')
    });
    await handle.ready;

    const dialog = handle.dialog;
    assert.equal(dialog.querySelector('[data-sync-count="approved"]').textContent, '1');
    assert.equal(dialog.querySelector('[data-sync-count="missing_documents"]').textContent, '1');
    assert.equal(dialog.querySelector('[data-sync-count="reviewing"]').textContent, '1');
    assert.equal(dialog.querySelector('[data-sync-count="manual"]').textContent, '1');
    assert.equal(dialog.querySelector('[data-sync-count="unchanged"]').textContent, '4');

    const changeBoxes = [...dialog.querySelectorAll('input[data-sync-select="changes"]')];
    const attentionBoxes = [...dialog.querySelectorAll('input[data-sync-select="needsAttention"]')];
    assert.equal(changeBoxes.length, 2);
    assert.equal(changeBoxes.every((cb) => cb.checked), true);
    assert.equal(attentionBoxes.length, 1);
    assert.equal(attentionBoxes[0].checked, false);

    const attentionGroup = dialog.querySelector('[data-sync-group="needsAttention"]');
    assert.match(attentionGroup.textContent, /belgeler de toplu olarak onaylanır/i);

    const manualGroup = dialog.querySelector('[data-sync-group="manual"]');
    assert.equal(manualGroup.querySelectorAll('input[type="checkbox"]').length, 0);
    assert.match(manualGroup.textContent, /ad soyad uyuşmuyor/i);

    assert.match(dialog.textContent, /Ayşe Yılmaz/);
    assert.match(dialog.textContent, /26000000001/);

    // Escape closes dialog and returns focus to trigger
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.querySelector('.migration-sync-dialog'), null);
    assert.equal(document.activeElement, trigger);
});

test('apply splits 45 items into 20/20/5 packets and displays applied count and conflicts', async () => {
    const dom = createDom();
    const { document } = dom.window;

    const changes = Array.from({ length: 45 }, (_, index) => ({
        record_kind: 'online',
        record_id: `app-${index + 1}`,
        application_number: `2026-11-${String(index + 1).padStart(7, '0')}`,
        current_status: 'sent_to_migration',
        target_state: 'approved',
        version: '2026-11-27T08:00:00.000Z',
        reason: 'status_approved',
        note: '',
        deadline: null,
        student_number: `2600000${String(index + 1).padStart(4, '0')}`,
        full_name: `Öğrenci ${index + 1}`
    }));

    const applyPackets = [];
    let appliedCallbackCount = 0;

    const fetcher = async (url, init) => {
        if (url.endsWith('/sync/preview')) {
            return jsonResponse({
                import_id: 'imp-45',
                exported_at: '2026-11-27 08:30',
                changes,
                needsAttention: [],
                manual: [],
                unchangedCount: 0
            });
        }
        if (url.endsWith('/sync/apply')) {
            const body = JSON.parse(init.body);
            applyPackets.push(body.items.length);
            if (applyPackets.length === 3) {
                return jsonResponse({
                    applied: body.items.slice(0, 4).map((item) => ({ ...item, target_state: 'approved' })),
                    conflicts: [{ ...body.items[4], reason: 'version_conflict' }]
                });
            }
            return jsonResponse({
                applied: body.items.map((item) => ({ ...item, target_state: 'approved' })),
                conflicts: []
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00'),
        onApplied: () => { appliedCallbackCount += 1; }
    });
    await handle.ready;

    const applyBtn = handle.dialog.querySelector('[data-action="apply-sync"]');
    assert.equal(applyBtn.disabled, false);
    applyBtn.click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(applyPackets, [20, 20, 5]);
    assert.equal(appliedCallbackCount, 1);
    const summary = handle.dialog.querySelector('[data-sync-summary="true"]');
    assert.ok(summary);
    assert.match(summary.textContent, /44 kayıt güncellendi, 1 çakışma/);
    const conflictEl = handle.dialog.querySelector('[data-sync-conflict="online:app-45"]');
    assert.ok(conflictEl);
    assert.match(conflictEl.textContent, /çakışma/i);
});

test('interrupted apply stops and re-previews remaining items', async () => {
    const dom = createDom();
    const { document } = dom.window;

    const makeItems = (start, count) => Array.from({ length: count }, (_, idx) => ({
        record_kind: 'online',
        record_id: `app-${start + idx}`,
        application_number: `2026-11-${String(start + idx).padStart(7, '0')}`,
        current_status: 'sent_to_migration',
        target_state: 'approved',
        version: '2026-11-27T08:00:00.000Z',
        reason: 'status_approved',
        note: '',
        deadline: null,
        student_number: `2600000${String(start + idx).padStart(4, '0')}`,
        full_name: `Öğrenci ${start + idx}`
    }));

    let previewCalls = 0;
    let applyCalls = 0;

    const fetcher = async (url, init) => {
        if (url.endsWith('/sync/preview')) {
            previewCalls += 1;
            return jsonResponse({
                import_id: 'imp-int',
                exported_at: '2026-11-27 08:30',
                changes: previewCalls === 1 ? makeItems(1, 25) : makeItems(21, 5),
                needsAttention: [],
                manual: [],
                unchangedCount: previewCalls === 1 ? 0 : 20
            });
        }
        if (url.endsWith('/sync/apply')) {
            applyCalls += 1;
            const body = JSON.parse(init.body);
            if (applyCalls === 1) {
                return jsonResponse({
                    applied: body.items.map((item) => ({ ...item, target_state: 'approved' })),
                    conflicts: []
                });
            }
            return jsonResponse({ error: { message: 'Geçici ağ hatası' } }, 503);
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00')
    });
    await handle.ready;

    handle.dialog.querySelector('[data-action="apply-sync"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(previewCalls, 2);
    assert.equal(applyCalls, 2);
    const banner = handle.dialog.querySelector('[data-sync-interrupted="true"]');
    assert.ok(banner);
    assert.match(banner.textContent, /20 kayıt uygulandıktan sonra aktarım yarıda kaldı/);
    assert.equal(handle.dialog.querySelectorAll('input[data-sync-select="changes"]').length, 5);
});

test('stale export (>24h) requires extra checkbox before apply is enabled', async () => {
    const dom = createDom();
    const { document } = dom.window;

    const fetcher = async (url) => {
        if (url.endsWith('/sync/preview')) {
            return jsonResponse({
                import_id: 'imp-stale',
                exported_at: '2026-11-25 08:00',
                changes: [
                    {
                        record_kind: 'online',
                        record_id: 'app-1',
                        application_number: '2026-11-0000001',
                        current_status: 'sent_to_migration',
                        target_state: 'approved',
                        version: '2026-11-25T08:00:00.000Z',
                        reason: 'status_approved',
                        note: '',
                        deadline: null,
                        student_number: '26000000001',
                        full_name: 'Ayşe Yılmaz'
                    }
                ],
                needsAttention: [],
                manual: [],
                unchangedCount: 0
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00')
    });
    await handle.ready;

    const applyBtn = handle.dialog.querySelector('[data-action="apply-sync"]');
    const staleCheckbox = handle.dialog.querySelector('[data-sync-stale-confirm="true"]');
    assert.ok(staleCheckbox);
    assert.equal(applyBtn.disabled, true);

    staleCheckbox.checked = true;
    staleCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(applyBtn.disabled, false);
});

test('yoksisDocumentAuditManager reveals "Durumları portala işle" after latest import loads', async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="staff-yoksis-audit">
            <p id="audit-import-latest"></p>
            <input id="audit-excel-file" type="file">
            <button id="audit-excel-upload" type="button"></button>
            <button id="audit-sync-portal" type="button" hidden>Durumları portala işle</button>
            <input id="audit-confirm" type="checkbox">
            <button id="audit-start" type="button"></button>
            <button id="audit-stop" type="button" hidden></button>
            <p id="audit-shared-count"></p>
            <span id="audit-page"></span>
            <table><tbody id="audit-results"></tbody></table>
        </div>
    </body></html>`, { url: 'https://portal.test/yetkili/' });

    dom.window.fetch = async (url) => {
        if (url.endsWith('/import/latest')) {
            return jsonResponse({
                importId: 'imp-latest',
                uploadedAt: '2026-11-27T09:00:00.000Z',
                uploadedBy: 'Yetkili',
                rowCount: 3,
                exportedAt: '2026-11-27 09:00'
            });
        }
        if (url.endsWith('/query')) {
            return jsonResponse({ records: [], total: 0, page: 1, pageSize: 50 });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const root = dom.window.document.getElementById('staff-yoksis-audit');
    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const syncBtn = root.querySelector('#audit-sync-portal');
    assert.equal(syncBtn.hidden, false);
    assert.equal(syncBtn.disabled, false);
});

test('preview dialog shows staleUnfinishedCount banner and per-row Göç query date', async () => {
    const dom = createDom();
    const { document } = dom.window;

    const fetcher = async (url) => {
        if (url.endsWith('/sync/preview')) {
            return jsonResponse({
                import_id: 'imp-stale-q',
                exported_at: '2026-11-27 08:30',
                staleUnfinishedCount: 3,
                changes: [
                    {
                        record_kind: 'online',
                        record_id: 'app-1',
                        application_number: '2026-13-0000001',
                        current_status: 'sent_to_migration',
                        target_state: 'missing_documents',
                        version: '2026-11-27T08:00:00.000Z',
                        reason: 'missing_documents',
                        note: 'Sigorta',
                        deadline: '2026-12-10',
                        goc_last_query_at: '2026-11-12',
                        student_number: '26000000001',
                        full_name: 'Ayşe Yılmaz'
                    },
                    {
                        record_kind: 'online',
                        record_id: 'app-2',
                        application_number: '2026-13-0000002',
                        current_status: 'sent_to_migration',
                        target_state: 'approved',
                        version: '2026-11-27T08:00:00.000Z',
                        reason: 'status_approved',
                        note: '',
                        deadline: null,
                        goc_last_query_at: '2026-11-01',
                        student_number: '26000000002',
                        full_name: 'Mehmet Demir'
                    }
                ],
                needsAttention: [],
                manual: [],
                unchangedCount: 0
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00')
    });
    await handle.ready;

    const banner = handle.dialog.querySelector('[data-sync-stale-queries="true"]');
    assert.ok(banner);
    assert.match(banner.textContent, /3 tamamlanmamış kaydın/);
    assert.match(banner.textContent, /Kesin sonuç için kaydı YÖKSİS'te yeniden sorgulayıp Excel'i tekrar indirin\./);
    assert.match(handle.dialog.textContent, /Göç son sorgu: 12\.11\.2026 \(15 gün önce\)/);
    assert.match(handle.dialog.textContent, /Göç son sorgu: 01\.11\.2026 \(26 gün önce\)/);
    const warnings = handle.dialog.querySelectorAll('.migration-sync-tag--warning');
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].textContent, 'güncel olmayabilir');
});

test('yoksisDocumentAuditManager renders Göç query age, stale warning only on unfinished rows, Excel empty doc text, and stale filter', async () => {
    const todayIso = getIstanbulTodayIso();
    const eightDaysAgo = shiftIsoCalendarDate(todayIso, -8);
    const sevenDaysAgo = shiftIsoCalendarDate(todayIso, -7);
    const twentyDaysAgo = shiftIsoCalendarDate(todayIso, -20);

    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="staff-yoksis-audit">
            <p id="audit-import-latest"></p>
            <input id="audit-excel-file" type="file">
            <button id="audit-excel-upload" type="button"></button>
            <button id="audit-sync-portal" type="button" hidden></button>
            <input id="audit-confirm" type="checkbox">
            <button id="audit-start" type="button"></button>
            <button id="audit-stop" type="button" hidden></button>
            <input id="audit-stale-only" type="checkbox">
            <p id="audit-shared-count"></p>
            <span id="audit-page"></span>
            <table><tbody id="audit-results"></tbody></table>
        </div>
    </body></html>`, { url: 'https://portal.test/yetkili/' });

    const queryBodies = [];
    dom.window.fetch = async (url, init) => {
        if (url.endsWith('/import/latest')) {
            return jsonResponse(null);
        }
        if (url.endsWith('/query')) {
            queryBodies.push(JSON.parse(init.body));
            return jsonResponse({
                records: [
                    {
                        application_number: '2026-13-0000001',
                        student_number: '26000000001',
                        first_name: 'AYŞE YILMAZ',
                        last_name: '',
                        passport_number: '',
                        phone: '',
                        application_status: 'İşlem Bekliyor',
                        status_category: 'pending',
                        result_status: 'verified',
                        documents: [],
                        import: { gocLastQueryAt: eightDaysAgo, isStale: false }
                    },
                    {
                        application_number: '2026-13-0000002',
                        student_number: '26000000002',
                        first_name: 'MEHMET DEMİR',
                        last_name: '',
                        passport_number: '',
                        phone: '',
                        application_status: 'İşlem Bekliyor',
                        status_category: 'pending',
                        result_status: 'verified',
                        documents: [],
                        import: { gocLastQueryAt: sevenDaysAgo, isStale: false }
                    },
                    {
                        application_number: '2026-13-0000003',
                        student_number: '26000000003',
                        first_name: 'FATMA KAYA',
                        last_name: '',
                        passport_number: '',
                        phone: '',
                        application_status: 'İşlem Tamamlandı',
                        status_category: 'successful',
                        result_status: 'verified',
                        documents: [],
                        import: { gocLastQueryAt: twentyDaysAgo, isStale: false }
                    }
                ],
                total: 3,
                page: 1,
                pageSize: 50
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const root = dom.window.document.getElementById('staff-yoksis-audit');
    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const rows = [...root.querySelectorAll('#audit-results tr')];
    assert.equal(rows.length, 3);
    assert.match(rows[0].cells[5].textContent, /Göç son sorgu: \d{2}\.\d{2}\.\d{4} \(8 gün önce\)/);
    assert.match(rows[0].cells[5].textContent, /güncel olmayabilir/);
    assert.equal(rows[0].cells[6].textContent, 'Son sorguda eksik evrak yoktu');

    assert.match(rows[1].cells[5].textContent, /Göç son sorgu: \d{2}\.\d{2}\.\d{4} \(7 gün önce\)/);
    assert.doesNotMatch(rows[1].cells[5].textContent, /güncel olmayabilir/);

    assert.match(rows[2].cells[5].textContent, /Göç son sorgu: \d{2}\.\d{2}\.\d{4} \(20 gün önce\)/);
    assert.doesNotMatch(rows[2].cells[5].textContent, /güncel olmayabilir/);

    const staleCheckbox = root.querySelector('#audit-stale-only');
    staleCheckbox.checked = true;
    staleCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(queryBodies[queryBodies.length - 1].staleQueryOnly, true);
});

test('apply button is disabled and hidden after a successful apply instead of staying enabled with old count', async () => {
    const dom = createDom();
    const { document } = dom.window;

    const fetcher = async (url, init) => {
        if (url.endsWith('/sync/preview')) {
            return jsonResponse({
                import_id: 'imp-done',
                exported_at: '2026-11-27 08:30',
                changes: [
                    {
                        record_kind: 'online',
                        record_id: 'app-1',
                        application_number: '2026-11-0000001',
                        current_status: 'sent_to_migration',
                        target_state: 'approved',
                        version: '2026-11-27T08:00:00.000Z',
                        reason: 'status_approved',
                        note: '',
                        deadline: null,
                        student_number: '26000000001',
                        full_name: 'Ayşe Yılmaz'
                    },
                    {
                        record_kind: 'online',
                        record_id: 'app-2',
                        application_number: '2026-11-0000002',
                        current_status: 'sent_to_migration',
                        target_state: 'approved',
                        version: '2026-11-27T08:00:00.000Z',
                        reason: 'status_approved',
                        note: '',
                        deadline: null,
                        student_number: '26000000002',
                        full_name: 'Fatma Kaya'
                    }
                ],
                needsAttention: [],
                manual: [],
                unchangedCount: 0
            });
        }
        if (url.endsWith('/sync/apply')) {
            const body = JSON.parse(init.body);
            return jsonResponse({
                applied: body.items.map((item) => ({ ...item, target_state: 'approved' })),
                conflicts: []
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const handle = openMigrationSyncDialog(document, {
        fetcher,
        nowMs: Date.parse('2026-11-27T09:00:00+03:00')
    });
    await handle.ready;

    const applyBtn = handle.dialog.querySelector('[data-action="apply-sync"]');
    assert.equal(applyBtn.disabled, false);
    assert.equal(applyBtn.hidden, false);
    assert.equal(applyBtn.textContent, 'Seçilenleri uygula (2)');

    applyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(applyBtn.disabled, true);
    assert.equal(applyBtn.hidden, true);
    assert.notEqual(applyBtn.textContent, 'Seçilenleri uygula (2)');
});
