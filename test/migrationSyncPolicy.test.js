import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    areNamesCompatible,
    buildMigrationSyncPlan,
    isWithinDateGuard,
    mapExcelStatusToTargetState
} from '../src/server/domain/migrationSync.js';
import { COMPLETED_GOC_STATUS_TARGET } from '../src/server/domain/yoksisAuditPolicy.js';

function makeExcelRow(overrides = {}) {
    return {
        application_number: '2026-11-0000100',
        student_number: '26000000001',
        first_name: 'AYSE YILMAZ',
        last_name: '',
        application_status: 'İşlem Bekliyor',
        documents_json: '[]',
        missing_deadline: null,
        source: 'excel',
        ...overrides
    };
}

function makeOnlineRecord(overrides = {}) {
    return {
        record_kind: 'online',
        record_id: 'app-1',
        student_number: '26000000001',
        first_name: 'Ayşe',
        last_name: 'Yılmaz',
        status: 'sent_to_migration',
        created_at: '2026-11-05T10:00:00.000Z',
        updated_at: '2026-11-10T10:00:00.000Z',
        overlay_state: null,
        overlay_note: '',
        overlay_deadline: null,
        ...overrides
    };
}

function makePhysicalRecord(overrides = {}) {
    return {
        record_kind: 'physical',
        record_id: 'phys-1',
        student_number: '26000000001',
        first_name: 'Ayşe',
        last_name: 'Yılmaz',
        status: 'sent_to_migration',
        application_date: '2026-11-05',
        submitted_at: '2026-11-05T10:00:00.000Z',
        lock_version: 2,
        linked_application_id: null,
        processing_closed_at: null,
        legacy_status: null,
        deleted_at: null,
        overlay_state: null,
        overlay_note: '',
        overlay_deadline: null,
        ...overrides
    };
}

test('mapExcelStatusToTargetState maps every row of the Göç Durumu table', () => {
    assert.equal(COMPLETED_GOC_STATUS_TARGET.targetState, 'approved');
    assert.equal(mapExcelStatusToTargetState('İşlem Tamamlandı'), COMPLETED_GOC_STATUS_TARGET.targetState);
    assert.equal(mapExcelStatusToTargetState('Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)'), 'missing_documents');
    assert.equal(mapExcelStatusToTargetState('Eksik belgeler iletildi – Göç incelemesi bekleniyor'), 'reviewing');
    assert.equal(mapExcelStatusToTargetState('İşlem Bekliyor'), 'reviewing');
    assert.equal(mapExcelStatusToTargetState('Değerlendirme Aşamasında'), 'reviewing');
    assert.equal(mapExcelStatusToTargetState('Sorgulanmadı'), null);
    assert.equal(mapExcelStatusToTargetState('Tanınmayan Durum'), null);
});

test('date guard blocks old-year completed rows from approving a new application while allowing 1 month older', () => {
    const newApp = makeOnlineRecord({ created_at: '2026-01-15T10:00:00.000Z' });
    assert.equal(isWithinDateGuard('2025-12-0000001', newApp), true);
    assert.equal(isWithinDateGuard('2025-11-0000001', newApp), false);

    const plan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            application_number: '2025-11-0000099',
            application_status: 'İşlem Tamamlandı',
            documents_json: JSON.stringify([{ name: 'Sensitive note', required: true }])
        })],
        portalRecords: [newApp]
    });
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.needsAttention.length, 0);
    assert.equal(plan.manual.length, 1);
    assert.equal(plan.manual[0].reason, 'older_application');
    assert.equal(plan.manual[0].note, '');
});

test('name matching is Turkish-tolerant and order-tolerant, and sends mismatches to manual', () => {
    assert.equal(areNamesCompatible({ first_name: 'İBRAHİM ŞAHİN', last_name: '' }, { first_name: 'ibrahim', last_name: 'sahin' }), true);
    assert.equal(areNamesCompatible({ first_name: 'YILMAZ AYŞE', last_name: '' }, { first_name: 'Ayşe', last_name: 'Yılmaz' }), true);
    assert.equal(areNamesCompatible({ first_name: 'MEHMET DEMİR', last_name: '' }, { first_name: 'Ayşe', last_name: 'Yılmaz' }), false);

    const planMismatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ first_name: 'MEHMET DEMİR', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord()]
    });
    assert.equal(planMismatch.changes.length, 0);
    assert.equal(planMismatch.manual.length, 1);
    assert.equal(planMismatch.manual[0].reason, 'name_mismatch');

    const planNameOnlyNoStudentMatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ student_number: '26999999999', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord({ student_number: '26000000001' })]
    });
    assert.equal(planNameOnlyNoStudentMatch.changes.length, 0);
    assert.equal(planNameOnlyNoStudentMatch.manual.length, 0);
});

test('multiple eligible Excel rows pick the highest E-İkamet application number', () => {
    const plan = buildMigrationSyncPlan({
        auditRows: [
            makeExcelRow({ application_number: '2026-10-0000050', application_status: 'İşlem Bekliyor' }),
            makeExcelRow({ application_number: '2026-11-0000200', application_status: 'İşlem Tamamlandı' })
        ],
        portalRecords: [makeOnlineRecord()]
    });
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].application_number, '2026-11-0000200');
    assert.equal(plan.changes[0].target_state, 'approved');
});

test('same student with unlinked online and physical records goes to manual, while linked records sync', () => {
    const unlinkedPlan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ application_status: 'İşlem Tamamlandı' })],
        portalRecords: [
            makeOnlineRecord({ record_id: 'app-1' }),
            makePhysicalRecord({ record_id: 'phys-1', linked_application_id: null })
        ]
    });
    assert.equal(unlinkedPlan.changes.length, 0);
    assert.equal(unlinkedPlan.manual.length, 2);
    assert.ok(unlinkedPlan.manual.every((item) => item.reason === 'multiple_open_records'));

    const linkedPlan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ application_status: 'İşlem Tamamlandı' })],
        portalRecords: [
            makeOnlineRecord({ record_id: 'app-1' }),
            makePhysicalRecord({ record_id: 'phys-1', linked_application_id: 'app-1' })
        ]
    });
    assert.equal(linkedPlan.manual.length, 0);
    assert.equal(linkedPlan.changes.length, 2);
});

test('protected statuses are never modified and conflicts go to manual; non-excel rows are ignored', () => {
    const plan = buildMigrationSyncPlan({
        auditRows: [
            makeExcelRow({ student_number: '26000000001', application_status: 'Eksik Belge İstendi (son: 06.12.2026)' }),
            makeExcelRow({ student_number: '26000000002', application_status: 'İşlem Tamamlandı' }),
            makeExcelRow({ student_number: '26000000003', application_status: 'İşlem Tamamlandı', source: 'scan' })
        ],
        portalRecords: [
            makeOnlineRecord({ record_id: 'app-approved', student_number: '26000000001', status: 'migration_approved' }),
            makeOnlineRecord({ record_id: 'app-rejected', student_number: '26000000002', status: 'rejected' }),
            makeOnlineRecord({ record_id: 'app-scan', student_number: '26000000003', status: 'sent_to_migration' }),
            makeOnlineRecord({ record_id: 'app-draft', student_number: '26000000001', status: 'draft' })
        ]
    });
    assert.equal(plan.changes.length, 0);
    assert.equal(plan.manual.length, 2);
    assert.ok(plan.manual.every((item) => item.reason === 'terminal_status_conflict'));
});

test('records not yet sent_to_migration go to needsAttention and reviewing clears missing_documents', () => {
    const plan = buildMigrationSyncPlan({
        auditRows: [
            makeExcelRow({ student_number: '26000000001', application_status: 'İşlem Tamamlandı' }),
            makeExcelRow({ student_number: '26000000002', application_status: 'Eksik belgeler iletildi – Göç incelemesi bekleniyor' }),
            makeExcelRow({
                student_number: '26000000003',
                application_status: 'Eksik Belge İstendi (son: 06.12.2026)',
                documents_json: JSON.stringify([{ name: 'Sağlık sigortası', required: true }]),
                missing_deadline: '2026-12-06'
            })
        ],
        portalRecords: [
            makeOnlineRecord({ record_id: 'app-1', student_number: '26000000001', status: 'under_review' }),
            makeOnlineRecord({ record_id: 'app-2', student_number: '26000000002', status: 'sent_to_migration', overlay_state: 'missing_documents' }),
            makeOnlineRecord({
                record_id: 'app-3',
                student_number: '26000000003',
                status: 'sent_to_migration',
                overlay_state: 'missing_documents',
                overlay_note: 'Sağlık sigortası',
                overlay_deadline: '2026-12-06'
            })
        ]
    });
    assert.equal(plan.needsAttention.length, 1);
    assert.equal(plan.needsAttention[0].record_id, 'app-1');
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].record_id, 'app-2');
    assert.equal(plan.changes[0].target_state, 'reviewing');
    assert.equal(plan.unchangedCount, 1);
});
