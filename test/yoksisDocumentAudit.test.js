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

test('collectYoksisAuditQueue reads ZK split header/body tables and ignores the hidden empty placeholder', () => {
    const document = new JSDOM(readFixture('zk-split-listboxes.html')).window.document;

    assert.deepEqual(collectYoksisAuditQueue(document), {
        status: 'complete',
        entries: [
            { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
            { applicationNumber: '2026-00-0000002', studentNumber: '2600000002' }
        ]
    });
    assert.equal(globalThis.YoksisDocumentAudit.findYoksisAuditRecordButton(document, {
        applicationNumber: '2026-00-0000002', studentNumber: '2600000002'
    }), document.querySelector('#records .z-listbox-rows tr:nth-child(2) button'));
});

test('readSelectedYoksisAuditRecord reads ZK sibling-cell labels and GöçNet split document list', () => {
    const document = new JSDOM(readFixture('zk-split-listboxes.html')).window.document;

    assert.deepEqual(readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000001', studentNumber: '2600000001'
    }), {
        status: 'verified',
        identity: {
            applicationNumber: '2026-00-0000001', studentNumber: '2600000001',
            firstName: 'TESTAD', lastName: 'TESTSOYAD', phone: '5000000000'
        },
        applicationStatus: 'Eksik Belge Bekliyor',
        documents: [{ code: '99', name: 'Diğer Belge', required: true, note: 'AKTİF ÖĞRENCİ BELGESİ', uploadStatus: 'Yüklenmedi' }]
    });
});

test('readSelectedYoksisAuditRecord accepts an explicit ZK empty document placeholder for a completed application', () => {
    const document = new JSDOM(readFixture('zk-split-listboxes.html')).window.document;
    document.getElementById('application-status').value = 'Tamamlandı';
    document.querySelector('#documents .z-listbox-rows').replaceChildren();
    document.querySelector('#documents .z-listbox-emptybody').style.display = '';

    const result = readSelectedYoksisAuditRecord(document, {
        applicationNumber: '2026-00-0000001', studentNumber: '2600000001'
    });

    assert.equal(result.status, 'verified');
    assert.equal(result.applicationStatus, 'Tamamlandı');
    assert.deepEqual(result.documents, []);
});

test('readSelectedYoksisAuditRecord protects both ZK application and student identity before returning personal data', () => {
    const document = new JSDOM(readFixture('zk-split-listboxes.html')).window.document;
    for (const expectedEntry of [
        { applicationNumber: '2026-00-0000002', studentNumber: '2600000001' },
        { applicationNumber: '2026-00-0000001', studentNumber: '2600000002' }
    ]) {
        assert.deepEqual(readSelectedYoksisAuditRecord(document, expectedEntry), { status: 'identity-mismatch' });
    }
});
