import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    IMPORT_PENDING_STORAGE_KEY,
    chunkImportRows,
    formatDeadlineWithRemaining,
    formatLatestImportLine,
    isExportedAtStale,
    normalizeYoksisRows,
    parseExportedAtFromFileName,
    parseYoksisExcel,
    readPendingImport,
    rowsFromWorkbook,
    uploadYoksisImport
} from '../src/staff/yoksisExcelImport.js';

const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/yoksis-ikamet-islemleri-ornek.json', import.meta.url), 'utf8')
);

function createFakeXlsx(aoa) {
    return {
        read(data, options) {
            assert.equal(options.type, 'array');
            assert.ok(data instanceof Uint8Array || data instanceof ArrayBuffer);
            return {
                SheetNames: ['Ikamet'],
                Sheets: { Ikamet: { __aoa: aoa } }
            };
        },
        utils: {
            sheet_to_json(sheet, options) {
                assert.equal(options.header, 1);
                assert.equal(options.raw, false);
                assert.equal(options.defval, '');
                return sheet.__aoa;
            }
        }
    };
}

test('normalizeYoksisRows parses fixture with duplicate merging, rejection, multiline note and invalid date', () => {
    const aoa = [fixture.headers, ...fixture.rows];
    const result = normalizeYoksisRows(aoa, fixture.fileName);

    assert.deepEqual(result.missingHeaders, []);
    assert.equal(result.exportedAt, '2026-11-23 13:07');
    assert.equal(result.totalRows, 7);
    assert.equal(result.mergedCount, 2);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].rowNumber, 7);
    assert.match(result.rejected[0].reason, /Öğrenci numarası/i);

    assert.equal(result.rows.length, 4);

    const r1 = result.rows.find((row) => row.applicationNumber === '2026-00-0000001');
    assert.equal(r1.studentNumber, '26000000001');
    assert.equal(r1.unit, 'Mühendislik Fakültesi');
    assert.equal(r1.program, 'Bilgisayar Mühendisliği');
    assert.equal(r1.transactionCount, 1);
    assert.equal(r1.gocLastQueryAt, '2026-11-23');

    const r2 = result.rows.find((row) => row.applicationNumber === '2026-00-0000002');
    assert.equal(r2.unit, '');
    assert.equal(r2.program, '');
    assert.equal(r2.gocStatus, 'İşlem Tamamlandı');

    const r3 = result.rows.find((row) => row.applicationNumber === '2026-00-0000003');
    assert.equal(r3.transactionCount, 3);
    assert.equal(r3.processType, 'Eksik Evrak');
    assert.equal(r3.gocStatus, 'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)');
    assert.equal(r3.missingDeadline, '2026-12-06');
    assert.equal(r3.missingNote, 'Aktif öğrenci belgesi ve sağlık sigortası poliçesi gerekli');

    const r5 = result.rows.find((row) => row.applicationNumber === '2026-00-0000005');
    assert.equal(r5.missingDeadline, null);
});

test('header matching is Turkish case-, diacritic- and whitespace-insensitive and column-order independent', () => {
    const aoa = [
        [
            '  göç   DURUMU ',
            '  AD   soyad ',
            'ogrenci   NO',
            'e-ikamet BASVURU no',
            'islem  türü'
        ],
        [
            'İşlem Bekliyor',
            'TEST KULLANICI',
            '26012345678',
            '2026-01-0000123',
            'İlk Başvuru'
        ]
    ];
    const result = normalizeYoksisRows(aoa, 'rapor.xlsx');
    assert.deepEqual(result.missingHeaders, []);
    assert.equal(result.exportedAt, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].applicationNumber, '2026-01-0000123');
    assert.equal(result.rows[0].studentNumber, '26012345678');
    assert.equal(result.rows[0].fullName, 'TEST KULLANICI');
    assert.equal(result.rows[0].gocStatus, 'İşlem Bekliyor');
    assert.equal(result.rows[0].processType, 'İlk Başvuru');
});

test('missing required headers rejects the file and reports missing header labels', () => {
    const aoa = [
        ['E-İkamet Başvuru No', 'Ad Soyad', 'Birim'],
        ['2026-00-0000001', 'TEST KULLANICI', 'Mühendislik']
    ];
    const result = normalizeYoksisRows(aoa, 'Ikamet_Islemleri_20261123_1307.xls');
    assert.equal(result.rows.length, 0);
    assert.equal(result.missingHeaders.length, 2);
    assert.ok(result.missingHeaders.includes('Öğrenci No'));
    assert.ok(result.missingHeaders.includes('Göç Durumu'));
});

test('__proto__ and constructor headers do not pollute Object.prototype or leak into output rows', () => {
    const aoa = [
        ['__proto__', 'constructor', 'prototype', 'E-İkamet Başvuru No', 'Öğrenci No', 'Ad Soyad', 'Göç Durumu'],
        ['{"polluted":true}', 'bad', 'bad', '2026-00-0000010', '26000000010', 'GÜVENLİ TEST', 'İşlem Bekliyor']
    ];
    const result = normalizeYoksisRows(aoa, 'Ikamet_Islemleri_20261123_1307.xls');
    assert.equal(({}).polluted, undefined);
    assert.equal(result.rows.length, 1);
    assert.equal(Object.getPrototypeOf(result.rows[0]), null);
    assert.equal('__proto__' in result.rows[0], false);
    assert.equal('constructor' in result.rows[0], false);
    assert.equal('prototype' in result.rows[0], false);
});

test('duplicate merging picks latest Kayıt Tarihi, then larger GöçNet Kayıt No regardless of row order', () => {
    const aoa = [
        ['E-İkamet Başvuru No', 'Öğrenci No', 'Ad Soyad', 'İşlem Türü', 'GöçNet Kayıt No', 'Kayıt Tarihi', 'Göç Durumu', 'Eksik Belge Son Tarih', 'Eksik Belge Açıklaması'],
        ['2026-00-0000099', '26000000099', 'SIRASIZ TEST', 'Eksik Evrak', '500', '20.11.2026', 'Eksik Belge İstendi', '05.12.2026', 'Güncel not'],
        ['2026-00-0000099', '26000000099', 'SIRASIZ TEST', 'İlk Başvuru', '999', '10.11.2026', 'İşlem Bekliyor', '', 'Eski tarih'],
        ['2026-00-0000099', '26000000099', 'SIRASIZ TEST', 'Eksik Evrak', '501', '20.11.2026', 'İşlem Tamamlandı', '', '']
    ];
    const result = normalizeYoksisRows(aoa, 'test.xls');
    assert.equal(result.rows.length, 1);
    assert.equal(result.mergedCount, 2);
    assert.equal(result.rows[0].transactionCount, 3);
    assert.equal(result.rows[0].gocStatus, 'İşlem Tamamlandı');
    assert.equal(result.rows[0].missingNote, '');
    assert.equal(result.rows[0].missingDeadline, null);
});

test('parseYoksisExcel enforces extension, file size (10 MB) and row count (5000) limits', () => {
    const aoa = [fixture.headers, fixture.rows[0]];
    const fakeXlsx = createFakeXlsx(aoa);
    const buffer = new ArrayBuffer(16);

    assert.throws(
        () => parseYoksisExcel(buffer, 'liste.csv', { XLSX: fakeXlsx, size: 16 }),
        /\.xls|\.xlsx/i
    );
    assert.throws(
        () => parseYoksisExcel(buffer, 'liste.pdf', { XLSX: fakeXlsx, size: 16 }),
        /\.xls|\.xlsx/i
    );
    assert.throws(
        () => parseYoksisExcel(buffer, 'liste.xlsx', { XLSX: fakeXlsx, size: 10 * 1024 * 1024 + 1 }),
        /10 MB/i
    );

    const tooManyRows = [fixture.headers];
    for (let i = 0; i < 5001; i += 1) {
        tooManyRows.push([
            `2026-00-${String(i).padStart(7, '0')}`,
            `260000${String(i).padStart(5, '0')}`,
            'DENEME', '', '', 'İlk Başvuru', '', String(i), '20.11.2026', 'İşlem Bekliyor', '', '', ''
        ]);
    }
    assert.throws(
        () => parseYoksisExcel(buffer, 'cok-satir.xls', { XLSX: createFakeXlsx(tooManyRows), size: 1024 }),
        /5000/
    );

    const parsed = parseYoksisExcel(buffer, fixture.fileName, { XLSX: fakeXlsx, size: 16 });
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.exportedAt, '2026-11-23 13:07');
});

test('rowsFromWorkbook returns empty array when workbook has no sheets', () => {
    const emptyXlsx = {
        read: () => ({ SheetNames: [], Sheets: {} }),
        utils: { sheet_to_json: () => [] }
    };
    assert.deepEqual(rowsFromWorkbook(emptyXlsx, new ArrayBuffer(4)), []);
});

test('chunkImportRows splits 120 rows into 3 batches of 50, 50, 20', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ applicationNumber: `2026-00-${String(i).padStart(7, '0')}` }));
    const chunks = chunkImportRows(rows, 50);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 50);
    assert.equal(chunks[1].length, 50);
    assert.equal(chunks[2].length, 20);
});

test('uploadYoksisImport sends final:true only on last batch and persists remaining batches on failure for resume', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
        applicationNumber: `2026-00-${String(i + 1).padStart(7, '0')}`,
        studentNumber: `260000${String(i + 1).padStart(5, '0')}`,
        fullName: 'TEST ÖĞRENCİ',
        unit: '',
        program: '',
        processType: 'İlk Başvuru',
        transactionCount: 1,
        gocStatus: 'İşlem Bekliyor',
        missingDeadline: null,
        missingNote: '',
        gocLastQueryAt: null
    }));

    const store = new Map();
    const storage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); }
    };

    const calls = [];
    let attempt = 0;
    const flakyFetcher = async (url, options) => {
        attempt += 1;
        const body = JSON.parse(options.body);
        calls.push({ url, body });
        if (attempt === 2) {
            return {
                ok: false,
                status: 503,
                json: async () => ({ error: { message: 'Geçici bağlantı hatası' } })
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ storedCount: body.rows.length, rejected: [] })
        };
    };

    const firstRun = await uploadYoksisImport({
        rows,
        exportedAt: '2026-11-23 13:07',
        importId: 'imp-test-001',
        fetcher: flakyFetcher,
        storage
    });

    assert.equal(firstRun.ok, false);
    assert.equal(firstRun.importId, 'imp-test-001');
    assert.equal(firstRun.completedBatches, 1);
    assert.equal(firstRun.totalBatches, 3);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.final, false);
    assert.equal(calls[1].body.final, false);

    const pending = readPendingImport(storage);
    assert.ok(pending);
    assert.equal(pending.importId, 'imp-test-001');
    assert.equal(pending.batches.length, 2);
    assert.equal(store.has(IMPORT_PENDING_STORAGE_KEY), true);

    // Resume with the SAME importId
    const resumeRun = await uploadYoksisImport({
        batches: pending.batches,
        exportedAt: pending.exportedAt,
        importId: pending.importId,
        startBatchIndex: pending.completedBatches,
        totalBatches: pending.totalBatches,
        initialStoredCount: pending.storedCount,
        fetcher: flakyFetcher,
        storage
    });

    assert.equal(resumeRun.ok, true);
    assert.equal(resumeRun.storedCount, 120);
    assert.equal(calls.length, 4);
    assert.equal(calls[2].body.importId, 'imp-test-001');
    assert.equal(calls[2].body.final, false);
    assert.equal(calls[3].body.importId, 'imp-test-001');
    assert.equal(calls[3].body.final, true);
    assert.equal(readPendingImport(storage), null);
});

test('exportedAt, staleness, deadline and latest-import formatting helpers work accurately', () => {
    assert.equal(parseExportedAtFromFileName('Ikamet_Islemleri_20261123_1307.xls'), '2026-11-23 13:07');
    assert.equal(parseExportedAtFromFileName('Ikamet_Islemleri_20260231_1307.xls'), null);
    assert.equal(parseExportedAtFromFileName('rastgele.xlsx'), null);

    const nowMs = new Date(2026, 10, 23, 15, 0).getTime();
    assert.equal(isExportedAtStale('2026-11-22 14:00', nowMs), true);
    assert.equal(isExportedAtStale('2026-11-23 13:07', nowMs), false);
    assert.equal(isExportedAtStale(null, nowMs), false);

    assert.equal(formatDeadlineWithRemaining('2026-12-06', nowMs), '06.12.2026 (13 gün kaldı)');
    assert.equal(formatDeadlineWithRemaining('2026-11-23', nowMs), '23.11.2026 (bugün son gün)');
    assert.equal(formatDeadlineWithRemaining('2026-11-20', nowMs), '20.11.2026 (süresi geçti)');

    assert.equal(formatLatestImportLine(null), 'Son yükleme: Henüz Excel yüklenmedi');
    const latestLine = formatLatestImportLine({
        uploadedAt: '2026-11-23T10:30:00.000Z',
        uploadedBy: 'Kağan Samet',
        rowCount: 1944
    });
    assert.match(latestLine, /^Son yükleme: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} · Kağan Samet · 1944 satır$/);
});
