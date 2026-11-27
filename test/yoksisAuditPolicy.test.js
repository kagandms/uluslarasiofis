import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAX_BATCH_BYTES,
    MAX_BATCH_RECORDS,
    MAX_IMPORT_BATCH_ROWS,
    buildImportDocuments,
    classifyGocStatus,
    classifyStatus,
    getIstanbulTodayIso,
    normalizeSearch,
    toIstanbulCalendarDate,
    validateDocuments,
    validateImportRow
} from '../src/server/domain/yoksisAuditPolicy.js';

function createValidRow(overrides = {}) {
    return {
        applicationNumber: '2026-11-0000123',
        studentNumber: '26000000123',
        fullName: 'AYŞE FATMA YILMAZ',
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

test('yoksisAuditPolicy exports expected batch limits', () => {
    assert.equal(MAX_BATCH_RECORDS, 25);
    assert.equal(MAX_IMPORT_BATCH_ROWS, 50);
    assert.equal(MAX_BATCH_BYTES, 128 * 1024);
});

test('normalizeSearch folds Turkish characters and removes punctuation', () => {
    assert.equal(normalizeSearch('İşlem Tamamlandı!'), 'islem tamamlandi');
    assert.equal(normalizeSearch('Eksik belgeler iletildi – Göç incelemesi bekleniyor'), 'eksik belgeler iletildi goc incelemesi bekleniyor');
    assert.equal(normalizeSearch('  ÇĞİÖŞÜ  123  '), 'cgiosu 123');
});

test('classifyStatus preserves existing scan classification behaviour', () => {
    assert.equal(classifyStatus('İşlem Tamamlandı', 'verified'), 'successful');
    assert.equal(classifyStatus('İşlem Bekliyor', 'verified'), 'pending');
    assert.equal(classifyStatus('Eksik Belge Bekliyor', 'verified'), 'missing_documents');
    assert.equal(classifyStatus('Reddedildi', 'verified'), 'rejected');
    assert.equal(classifyStatus('Bilinmeyen', 'verified'), 'other');
    assert.equal(classifyStatus('İşlem Tamamlandı', 'unreadable'), 'unreadable');
});

test('validateDocuments accepts valid documents and rejects malformed entries', () => {
    const documents = validateDocuments([
        { code: 'DOC1', name: 'Pasaport', required: true, note: 'Eksik', uploadStatus: 'pending' }
    ]);
    assert.deepEqual(documents, [
        { code: 'DOC1', name: 'Pasaport', required: true, note: 'Eksik', uploadStatus: 'pending' }
    ]);
    assert.throws(() => validateDocuments('not-an-array'), /Eksik evrak/);
    assert.throws(() => validateDocuments([{ name: 'Pasaport', required: 'yes' }]), /Eksik evrak/);
});

test('classifyGocStatus maps all Göç Durumu values according to contract 7.3', () => {
    assert.equal(classifyGocStatus('İşlem Tamamlandı'), 'successful');
    assert.equal(classifyGocStatus('İşlem Bekliyor'), 'pending');
    assert.equal(classifyGocStatus('Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)'), 'missing_documents');
    assert.equal(classifyGocStatus('Eksik Belge İstendi (son: 21.11.2026, süresi geçti)'), 'missing_documents');
    assert.equal(classifyGocStatus('Eksik belgeler iletildi – Göç incelemesi bekleniyor'), 'pending');
    assert.equal(classifyGocStatus('Değerlendirme Aşamasında'), 'pending');
    assert.equal(classifyGocStatus('Sorgulanmadı'), 'other');
    assert.equal(classifyGocStatus('bilinmeyen metin'), 'other');
    assert.equal(classifyGocStatus(''), 'other');
});

test('validateImportRow accepts minimal valid Excel row without phone or passport fields', () => {
    const row = validateImportRow({
        applicationNumber: '2026-11-0000123',
        studentNumber: '26000000123',
        fullName: 'MEHMET ALİ ÖZTÜRK',
        processType: 'Eksik Evrak',
        transactionCount: 2,
        gocStatus: 'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)'
    });

    assert.deepEqual(row, {
        applicationNumber: '2026-11-0000123',
        studentNumber: '26000000123',
        fullName: 'MEHMET ALİ ÖZTÜRK',
        unit: '',
        program: '',
        processType: 'Eksik Evrak',
        transactionCount: 2,
        gocStatus: 'Eksik Belge İstendi (son: 06.12.2026, 13 gün kaldı)',
        statusCategory: 'missing_documents',
        resultStatus: 'verified',
        missingDeadline: null,
        missingNote: '',
        gocLastQueryAt: null,
        recordDate: null
    });
});

test('validateImportRow rejects invalid fields with Turkish messages', () => {
    assert.throws(
        () => validateImportRow(createValidRow({ applicationNumber: '12-3' })),
        /Başvuru numarası/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ studentNumber: 'C12345678901' })),
        /Öğrenci numarası/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ unknownField: 'x' })),
        /tanınmayan alan/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ phone: '5000000000' })),
        /tanınmayan alan/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ fullName: 'A'.repeat(241) })),
        /Ad soyad/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ missingDeadline: '31.02.2026' })),
        /Eksik belge son tarihi/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ missingDeadline: '2026-02-31' })),
        /Eksik belge son tarihi/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ missingNote: 'N'.repeat(1001) })),
        /Eksik belge açıklaması/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ transactionCount: 0 })),
        /İşlem sayısı/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ gocLastQueryAt: '23.11.2026' })),
        /Göç son sorgu tarihi/
    );
    assert.throws(
        () => validateImportRow(createValidRow({ recordDate: '23.11.2026' })),
        /Kayıt tarihi/
    );
});

test('validateImportRow accepts boundary lengths and valid ISO dates', () => {
    const row = validateImportRow(createValidRow({
        fullName: 'A'.repeat(240),
        missingDeadline: '2026-12-06',
        missingNote: 'M'.repeat(1000),
        gocLastQueryAt: '2026-11-23',
        recordDate: '2026-11-20'
    }));
    assert.equal(row.fullName.length, 240);
    assert.equal(row.missingDeadline, '2026-12-06');
    assert.equal(row.missingNote.length, 1000);
    assert.equal(row.gocLastQueryAt, '2026-11-23');
    assert.equal(row.recordDate, '2026-11-20');
});

test('buildImportDocuments formats multiline notes and deadline into documents array', () => {
    assert.deepEqual(buildImportDocuments('', '2026-12-06'), []);
    assert.deepEqual(buildImportDocuments('   \n  ', null), []);

    const longNote = `İlk satır\nİkinci satır ${'x'.repeat(300)}`;
    const docs = buildImportDocuments(longNote, '2026-12-06');
    assert.equal(docs.length, 1);
    assert.equal(docs[0].name.length, 255);
    assert.equal(docs[0].name.includes('\n'), false);
    assert.equal(docs[0].name.startsWith('İlk satır İkinci satır '), true);
    assert.equal(docs[0].required, true);
    assert.equal(docs[0].note, 'Son tarih: 06.12.2026');
    assert.equal(docs[0].uploadStatus, '');

    const noDeadlineDocs = buildImportDocuments('Sağlık sigortası eksik', null);
    assert.deepEqual(noDeadlineDocs, [
        { name: 'Sağlık sigortası eksik', required: true, note: '', uploadStatus: '' }
    ]);
});

test('Istanbul date formatting caches Intl.DateTimeFormat instance across repeated calls', () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;
    let constructorCalls = 0;
    Intl.DateTimeFormat = function WrappedDateTimeFormat(...args) {
        constructorCalls += 1;
        return new OriginalDateTimeFormat(...args);
    };
    try {
        const d1 = getIstanbulTodayIso(Date.parse('2026-11-27T09:00:00Z'));
        const d2 = toIstanbulCalendarDate('2026-11-26T22:30:00Z');
        const d3 = toIstanbulCalendarDate('2026-11-25T12:00:00Z');
        assert.equal(d1, '2026-11-27');
        assert.equal(d2, '2026-11-27');
        assert.equal(d3, '2026-11-25');
        assert.ok(constructorCalls <= 1, `Expected cached Intl.DateTimeFormat, got ${constructorCalls} calls`);
    } finally {
        Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
});
