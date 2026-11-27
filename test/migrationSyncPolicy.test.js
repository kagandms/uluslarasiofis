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
        record_date: '2026-11-05',
        goc_last_query_at: '2026-11-25',
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

test('date guard ignores E-İkamet middle groups (00, 13, 99), enforces 30-day record_date boundary (29/30/31), and flags missing record_date', () => {
    const appNov30 = makeOnlineRecord({ created_at: '2026-11-30T10:00:00.000Z' });
    assert.equal(isWithinDateGuard({ application_number: '2026-00-1000001', record_date: '2026-11-01' }, appNov30), true);
    assert.equal(isWithinDateGuard({ application_number: '2026-13-1046943', record_date: '2026-10-31' }, appNov30), true);
    assert.equal(isWithinDateGuard({ application_number: '2026-99-9999999', record_date: '2026-10-30' }, appNov30), false);
    assert.equal(isWithinDateGuard({ application_number: '2026-13-1046943', record_date: null }, appNov30), false);

    // Physical record uses application_date (or submitted_at), and Istanbul calendar day shifts UTC 21:30+ to next day
    const physNov30 = makePhysicalRecord({ application_date: '2026-11-30' });
    assert.equal(isWithinDateGuard({ record_date: '2026-10-31' }, physNov30), true);
    assert.equal(isWithinDateGuard({ record_date: '2026-10-30' }, physNov30), false);
    const istanbulNextDay = makeOnlineRecord({ created_at: '2026-11-30T21:30:00.000Z' }); // 2026-12-01 in Europe/Istanbul
    assert.equal(isWithinDateGuard({ record_date: '2026-10-31' }, istanbulNextDay), false); // 31 days before 2026-12-01
    assert.equal(isWithinDateGuard({ record_date: '2026-11-01' }, istanbulNextDay), true); // 30 days before 2026-12-01

    const olderPlan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            application_number: '2026-13-1046943',
            record_date: '2026-10-30',
            application_status: 'İşlem Tamamlandı',
            documents_json: JSON.stringify([{ name: 'Sensitive note', required: true }])
        })],
        portalRecords: [appNov30]
    });
    assert.equal(olderPlan.changes.length, 0);
    assert.equal(olderPlan.needsAttention.length, 0);
    assert.equal(olderPlan.manual.length, 1);
    assert.equal(olderPlan.manual[0].reason, 'older_application');
    assert.equal(olderPlan.manual[0].note, '');
    assert.equal(olderPlan.manual[0].student_number, '26000000001');
    assert.equal(olderPlan.manual[0].first_name, 'Ayşe');
    assert.equal(olderPlan.manual[0].last_name, 'Yılmaz');

    const missingDatePlan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            application_number: '2026-13-1046943',
            record_date: null,
            application_status: 'İşlem Tamamlandı'
        })],
        portalRecords: [appNov30]
    });
    assert.equal(missingDatePlan.changes.length, 0);
    assert.equal(missingDatePlan.manual.length, 1);
    assert.equal(missingDatePlan.manual[0].reason, 'missing_record_date');
});

test('name matching is Turkish-tolerant and order-tolerant, supports shortened >=2-token subsets in either direction, sends open mismatches to nameCheck and protected mismatches to manual', () => {
    assert.equal(areNamesCompatible({ first_name: 'İBRAHİM ŞAHİN', last_name: '' }, { first_name: 'ibrahim', last_name: 'sahin' }), true);
    assert.equal(areNamesCompatible({ first_name: 'YILMAZ AYŞE', last_name: '' }, { first_name: 'Ayşe', last_name: 'Yılmaz' }), true);
    assert.equal(areNamesCompatible({ first_name: 'MEHMET DEMİR', last_name: '' }, { first_name: 'Ayşe', last_name: 'Yılmaz' }), false);

    // Shortened portal name vs full YÖKSİS name (and reverse direction)
    assert.equal(areNamesCompatible(
        { first_name: 'TARIK KERİM ÖMER ALMANSUR', last_name: '' },
        { first_name: 'Tarık', last_name: 'Almansur' }
    ), true);
    assert.equal(areNamesCompatible(
        { first_name: 'TARIK ALMANSUR', last_name: '' },
        { first_name: 'Tarık Kerim Ömer', last_name: 'Almansur' }
    ), true);

    // Single-token name, single shared token, repeated token without multiplicity, or differing token in shorter name -> incompatible
    assert.equal(areNamesCompatible({ first_name: 'TARIK KERİM ALMANSUR', last_name: '' }, { first_name: 'Tarık', last_name: '' }), false);
    assert.equal(areNamesCompatible({ first_name: 'TARIK', last_name: '' }, { first_name: 'Tarık', last_name: 'Almansur' }), false);
    assert.equal(areNamesCompatible({ first_name: 'TARIK KERİM ALMANSUR', last_name: '' }, { first_name: 'Tarık', last_name: 'Demir' }), false);
    assert.equal(areNamesCompatible({ first_name: 'TARIK ALİ', last_name: '' }, { first_name: 'Tarık', last_name: 'Demir' }), false);
    assert.equal(areNamesCompatible({ first_name: 'TARIK KERİM ALMANSUR', last_name: '' }, { first_name: 'Tarık', last_name: 'Tarık' }), false);

    const shortenedPlan = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ first_name: 'TARIK KERİM ÖMER ALMANSUR', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord({ first_name: 'Tarık', last_name: 'Almansur' })]
    });
    assert.equal(shortenedPlan.changes.length, 1);
    assert.equal(shortenedPlan.manual.length, 0);

    const planMismatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ first_name: 'MEHMET DEMİR', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord()]
    });
    assert.equal(planMismatch.changes.length, 0);
    assert.equal(planMismatch.needsAttention.length, 0);
    assert.equal(planMismatch.manual.length, 0);
    assert.equal(planMismatch.nameCheck.length, 1);
    assert.equal(planMismatch.nameCheck[0].name_level, 'different');

    const oneTokenMismatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ first_name: 'AYŞE YILMAZ', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord({ first_name: 'Ayşe', last_name: '' })]
    });
    assert.equal(oneTokenMismatch.changes.length, 0);
    assert.equal(oneTokenMismatch.needsAttention.length, 0);
    assert.equal(oneTokenMismatch.manual.length, 0);
    assert.equal(oneTokenMismatch.nameCheck.length, 1);
    assert.equal(oneTokenMismatch.nameCheck[0].name_level, 'different');

    const closedMismatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ first_name: 'MEHMET DEMİR', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord({ status: 'completed' })]
    });
    assert.equal(closedMismatch.changes.length, 0);
    assert.equal(closedMismatch.needsAttention.length, 0);
    assert.equal(closedMismatch.nameCheck.length, 0);
    assert.equal(closedMismatch.manual.length, 1);
    assert.equal(closedMismatch.manual[0].reason, 'name_mismatch');

    const planNameOnlyNoStudentMatch = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({ student_number: '26999999999', application_status: 'İşlem Tamamlandı' })],
        portalRecords: [makeOnlineRecord({ student_number: '26000000001' })]
    });
    assert.equal(planNameOnlyNoStudentMatch.changes.length, 0);
    assert.equal(planNameOnlyNoStudentMatch.needsAttention.length, 0);
    assert.equal(planNameOnlyNoStudentMatch.nameCheck.length, 0);
    assert.equal(planNameOnlyNoStudentMatch.manual.length, 0);
});

test('multiple eligible Excel rows pick latest record_date, then latest goc_last_query_at (not application_number alone)', () => {
    const byRecordDate = buildMigrationSyncPlan({
        auditRows: [
            makeExcelRow({
                application_number: '2026-99-0000999',
                record_date: '2026-11-10',
                goc_last_query_at: '2026-11-26',
                application_status: 'İşlem Bekliyor'
            }),
            makeExcelRow({
                application_number: '2026-00-0000050',
                record_date: '2026-11-15',
                goc_last_query_at: '2026-11-20',
                application_status: 'İşlem Tamamlandı'
            })
        ],
        portalRecords: [makeOnlineRecord()]
    });
    assert.equal(byRecordDate.changes.length, 1);
    assert.equal(byRecordDate.changes[0].application_number, '2026-00-0000050');
    assert.equal(byRecordDate.changes[0].target_state, 'approved');

    const byQueryDate = buildMigrationSyncPlan({
        auditRows: [
            makeExcelRow({
                application_number: '2026-99-0000999',
                record_date: '2026-11-15',
                goc_last_query_at: '2026-11-18',
                application_status: 'İşlem Bekliyor'
            }),
            makeExcelRow({
                application_number: '2026-00-0000050',
                record_date: '2026-11-15',
                goc_last_query_at: '2026-11-25',
                application_status: 'İşlem Tamamlandı'
            })
        ],
        portalRecords: [makeOnlineRecord()]
    });
    assert.equal(byQueryDate.changes.length, 1);
    assert.equal(byQueryDate.changes[0].application_number, '2026-00-0000050');
    assert.equal(byQueryDate.changes[0].target_state, 'approved');
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

test('older or missing goc_last_query_at cannot clear or replace a newer missing_documents overlay', () => {
    const portalWithNewerOverlay = makeOnlineRecord({
        record_id: 'app-1',
        student_number: '26000000001',
        status: 'sent_to_migration',
        overlay_state: 'missing_documents',
        overlay_note: 'Sağlık sigortası',
        overlay_deadline: '2026-12-06',
        overlay_goc_last_query_at: '2026-11-20'
    });

    const olderReviewing = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            student_number: '26000000001',
            application_status: 'İşlem Bekliyor',
            goc_last_query_at: '2026-11-15'
        })],
        portalRecords: [portalWithNewerOverlay]
    });
    assert.equal(olderReviewing.changes.length, 0);
    assert.equal(olderReviewing.manual.length, 1);
    assert.equal(olderReviewing.manual[0].reason, 'stale_query_conflict');

    const missingQueryReplace = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            student_number: '26000000001',
            application_status: 'Eksik Belge İstendi (son: 10.12.2026)',
            documents_json: JSON.stringify([{ name: 'Farklı evrak', required: true }]),
            missing_deadline: '2026-12-10',
            goc_last_query_at: null
        })],
        portalRecords: [portalWithNewerOverlay]
    });
    assert.equal(missingQueryReplace.changes.length, 0);
    assert.equal(missingQueryReplace.manual.length, 1);
    assert.equal(missingQueryReplace.manual[0].reason, 'stale_query_conflict');

    const newerReviewing = buildMigrationSyncPlan({
        auditRows: [makeExcelRow({
            student_number: '26000000001',
            application_status: 'İşlem Bekliyor',
            goc_last_query_at: '2026-11-21'
        })],
        portalRecords: [portalWithNewerOverlay]
    });
    assert.equal(newerReviewing.manual.length, 0);
    assert.equal(newerReviewing.changes.length, 1);
    assert.equal(newerReviewing.changes[0].target_state, 'reviewing');
});

test('buildMigrationSyncPlan counts stale unfinished rows (8+ days or missing, excluding 7 days and completed)', () => {
    const nowMs = Date.parse('2026-11-27T09:00:00+03:00');
    const plan = buildMigrationSyncPlan({
        nowMs,
        auditRows: [
            makeExcelRow({ application_number: '2026-13-0000001', application_status: 'İşlem Bekliyor', goc_last_query_at: '2026-11-20' }), // 7 days -> ok
            makeExcelRow({ application_number: '2026-13-0000002', application_status: 'İşlem Bekliyor', goc_last_query_at: '2026-11-19' }), // 8 days -> stale
            makeExcelRow({ application_number: '2026-13-0000003', application_status: 'Eksik Belge İstendi', goc_last_query_at: null }), // missing -> stale
            makeExcelRow({ application_number: '2026-13-0000004', application_status: 'İşlem Tamamlandı', goc_last_query_at: '2026-11-01' }), // completed -> not counted
            makeExcelRow({ application_number: '2026-13-0000005', application_status: 'İşlem Tamamlandı', goc_last_query_at: null }) // completed -> not counted
        ],
        portalRecords: []
    });
    assert.equal(plan.staleUnfinishedCount, 2);
});
