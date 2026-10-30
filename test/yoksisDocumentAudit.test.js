import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import '../ykn_eklenti-main/yoksis-document-audit.js';

const { collectYoksisAuditQueue, readSelectedYoksisAuditRecord } = globalThis.YoksisDocumentAudit;

const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const readFixture = (name) => readFileSync(join(testDirectory, 'fixtures', 'yoksis-document-audit', name), 'utf8');

test('collectYoksisAuditQueue does not claim completeness when a selectable row has an invalid application key', () => {
    const document = new JSDOM(readFixture('list.html')).window.document;

    const result = collectYoksisAuditQueue(document);

    assert.deepEqual(result, {
        status: 'incomplete',
        entries: [
            { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
            { applicationNumber: '2026-00-0000002', studentNumber: '2600000002' }
        ],
        reason: 'application-key-incomplete'
    });
});

test('readSelectedYoksisAuditRecord reports requested missing documents only after identity matches', () => {
    const document = new JSDOM(readFixture('missing-documents.html')).window.document;

    const result = readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000001',
        studentNumber: '2600000001'
    });

    assert.deepEqual(result, {
        status: 'verified',
        identity: {
            applicationNumber: '2026-00-0000001',
            studentNumber: '2600000001',
            firstName: 'TESTAD',
            lastName: 'TESTSOYAD',
            phone: '5000000000'
        },
        applicationStatus: 'Eksik Belge Bekliyor',
        documents: [{ code: '99', name: 'Diğer Belge', required: true, note: 'AKTİF ÖĞRENCİ BELGESİ', uploadStatus: 'Yüklenmedi' }]
    });
});

test('readSelectedYoksisAuditRecord rejects a different selected application without attaching its personal data', () => {
    const document = new JSDOM(readFixture('missing-documents.html')).window.document;

    const result = readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000009',
        studentNumber: '2600000009'
    });

    assert.deepEqual(result, { status: 'identity-mismatch' });
});

test('readSelectedYoksisAuditRecord treats a missing-document status with an empty table as unreadable', () => {
    const html = readFixture('missing-documents.html').replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>');
    const document = new JSDOM(html).window.document;

    const result = readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000001',
        studentNumber: '2600000001'
    });

    assert.deepEqual(result, { status: 'unreadable', reason: 'missing-documents-table-empty' });
});

test('readSelectedYoksisAuditRecord accepts an empty document table when YÖKSİS does not report missing documents', () => {
    const html = readFixture('missing-documents.html')
        .replace('value="Eksik Belge Bekliyor"', 'value="İşlem Bekliyor"')
        .replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>');
    const document = new JSDOM(html).window.document;

    const result = readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000001',
        studentNumber: '2600000001'
    });

    assert.equal(result.status, 'verified');
    assert.equal(result.applicationStatus, 'İşlem Bekliyor');
    assert.deepEqual(result.documents, []);
});

test('collectYoksisAuditQueue marks a row without a student identity as incomplete', () => {
    const html = readFixture('list.html').replace('2600000002', '—');
    const document = new JSDOM(html).window.document;

    const result = collectYoksisAuditQueue(document);

    assert.deepEqual(result, {
        status: 'incomplete',
        entries: [{ applicationNumber: '2026-00-0000001', studentNumber: '2600000001' }],
        reason: 'row-identity-incomplete'
    });
});

test('collectYoksisAuditQueue and readSelectedYoksisAuditRecord inspect same-origin child frames', () => {
    const dom = new JSDOM('<!doctype html><html><body><iframe id="yoksis-frame"></iframe></body></html>');
    const frame = dom.window.document.getElementById('yoksis-frame');
    frame.contentDocument.open();
    frame.contentDocument.write(readFixture('missing-documents.html'));
    frame.contentDocument.close();

    const record = readSelectedYoksisAuditRecord(dom.window.document, {
        applicationNumber: '2026-00-0000001',
        studentNumber: '2600000001'
    });

    assert.equal(record.status, 'verified');
    assert.equal(record.identity.applicationNumber, '2026-00-0000001');
    assert.equal(record.documents.length, 1);
});
