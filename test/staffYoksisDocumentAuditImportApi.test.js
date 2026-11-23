import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const SESSION_TOKEN = 'yoksis-import-session-token-0123456789012345';
const PASSWORD_HASH = await deriveStaffPasswordHash('Yoksis import test password 2026');

async function createFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'test.staff', 'test.staff', ?, 'Test Yetkili', 'reviewer')`).bind(PASSWORD_HASH).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-1', 'staff-1', ?, '2099-01-01T00:00:00.000Z', ?)`).bind(
        await hashSessionToken(SESSION_TOKEN), new Date().toISOString()
    ).run();
    return { database, environment: { DB: database, STAFF_SHARED_USERNAME: 'test.staff' } };
}

function postRequest(path, { body, hasSession = true, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (origin !== null) headers.set('Origin', origin);
    if (hasSession) headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    return new Request(`https://portal.test/api/staff/yoksis-document-audit/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

function getRequest(path, { hasSession = true } = {}) {
    const headers = new Headers();
    if (hasSession) headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    return new Request(`https://portal.test/api/staff/yoksis-document-audit/${path}`, {
        method: 'GET',
        headers
    });
}

function excelRow(applicationNumber, studentNumber, overrides = {}) {
    return {
        applicationNumber,
        studentNumber,
        fullName: 'AYŞE YILMAZ',
        unit: 'Mühendislik Fakültesi',
        program: 'Bilgisayar Mühendisliği',
        processType: 'İlk Başvuru',
        transactionCount: 1,
        gocStatus: 'İşlem Bekliyor',
        missingDeadline: null,
        missingNote: '',
        gocLastQueryAt: '2026-11-23',
        ...overrides
    };
}

function scanRecord(applicationNumber, studentNumber, identity = {}) {
    return {
        entry: { applicationNumber, studentNumber },
        result: {
            status: 'verified',
            identity: {
                applicationNumber,
                studentNumber,
                firstName: identity.firstName || 'AYŞE',
                lastName: identity.lastName || 'TEST',
                phone: identity.phone || '5000000000',
                passportNumber: identity.passportNumber || 'U12345678'
            },
            applicationStatus: identity.applicationStatus || 'İşlem Bekliyor',
            documents: []
        }
    };
}

test('Excel import endpoints enforce authentication, origin, method and batch limits', async () => {
    const { environment } = await createFixture();

    const unauthImport = await worker.fetch(postRequest('import', {
        body: { importId: 'imp-1', final: true, rows: [excelRow('2026-11-0000001', '2600000001')] },
        hasSession: false
    }), environment, {});
    const unauthLatest = await worker.fetch(getRequest('import/latest', { hasSession: false }), environment, {});
    assert.equal(unauthImport.status, 401);
    assert.equal(unauthLatest.status, 401);

    const crossOrigin = await worker.fetch(postRequest('import', {
        body: { importId: 'imp-1', final: true, rows: [excelRow('2026-11-0000001', '2600000001')] },
        origin: 'https://evil.example'
    }), environment, {});
    assert.equal(crossOrigin.status, 403);

    const wrongMethodImport = await worker.fetch(getRequest('import'), environment, {});
    const wrongMethodLatest = await worker.fetch(postRequest('import/latest', { body: {} }), environment, {});
    assert.equal(wrongMethodImport.status, 405);
    assert.equal(wrongMethodLatest.status, 405);

    const invalidImportId = await worker.fetch(postRequest('import', {
        body: { importId: 'bad id!', final: true, rows: [excelRow('2026-11-0000001', '2600000001')] }
    }), environment, {});
    assert.equal(invalidImportId.status, 400);

    const emptyNonFinal = await worker.fetch(postRequest('import', {
        body: { importId: 'imp-1', final: false, rows: [] }
    }), environment, {});
    assert.equal(emptyNonFinal.status, 400);

    const tooManyRows = Array.from({ length: 51 }, (_, index) =>
        excelRow(`2026-11-${String(index + 1).padStart(7, '0')}`, `260000${String(index + 1).padStart(4, '0')}`)
    );
    const overBatchLimit = await worker.fetch(postRequest('import', {
        body: { importId: 'imp-1', final: false, rows: tooManyRows }
    }), environment, {});
    assert.equal(overBatchLimit.status, 400);
});

test('GET import/latest returns null before any finalized import', async () => {
    const { environment } = await createFixture();

    const before = await worker.fetch(getRequest('import/latest'), environment, {});
    assert.equal(before.status, 200);
    assert.equal(await before.json(), null);

    const partial = await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-unfinalized',
            exportedAt: '2026-11-23 13:07',
            final: false,
            rows: [excelRow('2026-11-0000001', '2600000001')]
        }
    }), environment, {});
    assert.equal(partial.status, 200);

    const stillBefore = await worker.fetch(getRequest('import/latest'), environment, {});
    assert.equal(stillBefore.status, 200);
    assert.equal(await stillBefore.json(), null);
});

test('Excel import stores valid rows, reports rejected rows, is idempotent, and finalizes import/latest', async () => {
    const { database, environment } = await createFixture();

    const batchOneBody = {
        importId: 'imp-20261123',
        exportedAt: '2026-11-23 13:07',
        final: false,
        rows: [
            excelRow('2026-11-0000001', '2600000001', {
                fullName: 'AYŞE YILMAZ',
                gocStatus: 'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)',
                missingDeadline: '2026-12-06',
                missingNote: 'Sağlık sigortası\npoliçesi eksik',
                processType: 'Eksik Evrak',
                transactionCount: 2
            }),
            excelRow('2026-11-0000002', 'C12345678901', {
                fullName: 'BOZUK ÖĞRENCİ'
            }),
            excelRow('2026-11-0000003', '2600000003', {
                fullName: 'MEHMET DEMİR',
                gocStatus: 'İşlem Tamamlandı'
            })
        ]
    };

    const first = await worker.fetch(postRequest('import', { body: batchOneBody }), environment, {});
    assert.equal(first.status, 200);
    const firstPayload = await first.json();
    assert.equal(firstPayload.storedCount, 2);
    assert.equal(firstPayload.rejected.length, 1);
    assert.equal(firstPayload.rejected[0].index, 1);
    assert.match(firstPayload.rejected[0].reason, /Öğrenci numarası/);

    // Re-sending the exact same batch must be idempotent.
    const replay = await worker.fetch(postRequest('import', { body: batchOneBody }), environment, {});
    assert.equal(replay.status, 200);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM yoksis_document_audit_records').first().count, 2);

    // Finalize with empty rows array.
    const finalize = await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-20261123',
            exportedAt: '2026-11-23 13:07',
            final: true,
            rows: []
        }
    }), environment, {});
    assert.equal(finalize.status, 200);
    const finalizePayload = await finalize.json();
    assert.equal(finalizePayload.storedCount, 0);
    assert.deepEqual(finalizePayload.rejected, []);

    const stored = database.prepare(`
        SELECT source, last_seen_import_id, status_category, result_status, documents_json,
               unit, program, missing_deadline, last_transaction_type, transaction_count
        FROM yoksis_document_audit_records
        WHERE application_number = '2026-11-0000001'
    `).first();
    assert.equal(stored.source, 'excel');
    assert.equal(stored.last_seen_import_id, 'imp-20261123');
    assert.equal(stored.status_category, 'missing_documents');
    assert.equal(stored.result_status, 'verified');
    assert.equal(stored.missing_deadline, '2026-12-06');
    assert.equal(stored.last_transaction_type, 'Eksik Evrak');
    assert.equal(stored.transaction_count, 2);
    assert.deepEqual(JSON.parse(stored.documents_json), [{
        name: 'Sağlık sigortası poliçesi eksik',
        required: true,
        note: 'Son tarih: 06.12.2026',
        uploadStatus: ''
    }]);

    const latest = await worker.fetch(getRequest('import/latest'), environment, {});
    assert.equal(latest.status, 200);
    const latestPayload = await latest.json();
    assert.equal(latestPayload.importId, 'imp-20261123');
    assert.equal(latestPayload.uploadedBy, 'Test Yetkili');
    assert.equal(latestPayload.rowCount, 2);
    assert.equal(latestPayload.exportedAt, '2026-11-23 13:07');
    assert.equal(typeof latestPayload.uploadedAt, 'string');

    // Re-finalizing the same importId must not change rowCount.
    await worker.fetch(postRequest('import', {
        body: { importId: 'imp-20261123', exportedAt: '2026-11-23 13:07', final: true, rows: [] }
    }), environment, {});
    const latestAgain = await (await worker.fetch(getRequest('import/latest'), environment, {})).json();
    assert.equal(latestAgain.rowCount, 2);
});

test('Excel import preserves existing non-empty scan identity fields while updating status', async () => {
    const { database, environment } = await createFixture();

    const scanResponse = await worker.fetch(postRequest('records', {
        body: {
            scanId: 'scan-1',
            records: [scanRecord('2026-11-0000010', '2600000010', {
                firstName: 'ZEYNEP',
                lastName: 'KAYA',
                phone: '5551112233',
                passportNumber: 'P98765432',
                applicationStatus: 'İşlem Bekliyor'
            })]
        }
    }), environment, {});
    assert.equal(scanResponse.status, 200);

    const excelResponse = await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-preserve',
            final: true,
            rows: [excelRow('2026-11-0000010', '2600000010', {
                fullName: 'FARKLI AD',
                gocStatus: 'İşlem Tamamlandı',
                unit: 'Fen Fakültesi'
            })]
        }
    }), environment, {});
    assert.equal(excelResponse.status, 200);

    const row = database.prepare(`
        SELECT first_name, last_name, phone, passport_number, application_status, status_category, source, unit
        FROM yoksis_document_audit_records
        WHERE application_number = '2026-11-0000010'
    `).first();
    assert.equal(row.first_name, 'ZEYNEP');
    assert.equal(row.last_name, 'KAYA');
    assert.equal(row.phone, '5551112233');
    assert.equal(row.passport_number, 'P98765432');
    assert.equal(row.application_status, 'İşlem Tamamlandı');
    assert.equal(row.status_category, 'successful');
    assert.equal(row.source, 'excel');
    assert.equal(row.unit, 'Fen Fakültesi');

    // Passport search continues to find the updated record.
    const search = await worker.fetch(postRequest('query', {
        body: { q: 'P98765432', status: 'successful', page: 1, pageSize: 10 }
    }), environment, {});
    const searchPayload = await search.json();
    assert.equal(searchPayload.total, 1);
    assert.equal(searchPayload.records[0].passport_number, 'P98765432');
});

test('missing rows in a newer import are preserved and marked isStale while scan records stay unchanged in /query', async () => {
    const { environment } = await createFixture();

    // 1. Existing scan-only record.
    await worker.fetch(postRequest('records', {
        body: {
            scanId: 'scan-only',
            records: [scanRecord('2026-11-0000020', '2600000020', { firstName: 'TARAMA', lastName: 'KAYDI' })]
        }
    }), environment, {});

    // 2. First Excel import with two records.
    await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-first',
            exportedAt: '2026-11-22 10:00',
            final: true,
            rows: [
                excelRow('2026-11-0000021', '2600000021', {
                    fullName: 'ESKİ EXCEL',
                    gocStatus: 'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)',
                    missingDeadline: '2026-12-06',
                    missingNote: 'Transkript eksik'
                }),
                excelRow('2026-11-0000022', '2600000022', {
                    fullName: 'GÜNCEL EXCEL',
                    gocStatus: 'İşlem Bekliyor'
                })
            ]
        }
    }), environment, {});

    // 3. Second Excel import omits 2026-11-0000021.
    await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-second',
            exportedAt: '2026-11-23 10:00',
            final: true,
            rows: [
                excelRow('2026-11-0000022', '2600000022', {
                    fullName: 'GÜNCEL EXCEL',
                    gocStatus: 'İşlem Tamamlandı'
                })
            ]
        }
    }), environment, {});

    const query = await worker.fetch(postRequest('query', {
        body: { q: '', status: 'all', page: 1, pageSize: 20 }
    }), environment, {});
    assert.equal(query.status, 200);
    const payload = await query.json();
    assert.equal(payload.total, 3);

    const byApp = new Map(payload.records.map((item) => [item.application_number, item]));

    // Scan record has NO import key and no leaked columns.
    const scanItem = byApp.get('2026-11-0000020');
    assert.equal('import' in scanItem, false);
    assert.equal('source' in scanItem, false);
    assert.equal('last_seen_import_id' in scanItem, false);

    // Missing row from imp-first is NOT deleted, keeps its status, and has isStale = true.
    const staleItem = byApp.get('2026-11-0000021');
    assert.equal(staleItem.status_category, 'missing_documents');
    assert.deepEqual(staleItem.import, {
        unit: 'Mühendislik Fakültesi',
        program: 'Bilgisayar Mühendisliği',
        missingDeadline: '2026-12-06',
        lastTransactionType: 'İlk Başvuru',
        transactionCount: 1,
        gocLastQueryAt: '2026-11-23',
        isStale: true
    });

    // Current row from imp-second has isStale = false.
    const freshItem = byApp.get('2026-11-0000022');
    assert.equal(freshItem.status_category, 'successful');
    assert.equal(freshItem.import.isStale, false);
});

test('Excel import handles fullName up to 240 characters without violating DB column checks', async () => {
    const { environment } = await createFixture();
    const longName = `${'UZUNAD '.repeat(25).trim()}`;
    assert.ok(longName.length > 120 && longName.length <= 240);

    const response = await worker.fetch(postRequest('import', {
        body: {
            importId: 'imp-long-name',
            final: true,
            rows: [excelRow('2026-11-0000099', '2600000099', { fullName: longName })]
        }
    }), environment, {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.storedCount, 1);
    assert.deepEqual(payload.rejected, []);
});

test('Excel import write failures log a safe category without leaking personal data', async () => {
    const { database, environment } = await createFixture();
    environment.DB = {
        prepare: database.prepare.bind(database),
        batch: async () => { throw new Error('FOREIGN KEY constraint failed'); }
    };
    const logs = [];
    const originalError = console.error;
    console.error = (...values) => logs.push(values);
    let response;
    try {
        response = await worker.fetch(postRequest('import', {
            body: {
                importId: 'imp-fail',
                final: true,
                rows: [excelRow('2026-11-0000050', '2600000050', { fullName: 'GİZLİ KİŞİ' })]
            }
        }), environment, {});
    } finally {
        console.error = originalError;
    }

    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(logs), /GİZLİ|KİŞİ|2600000050|2026-11-0000050/);
});
