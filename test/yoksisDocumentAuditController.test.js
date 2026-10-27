import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import '../ykn_eklenti-main/yoksis-document-audit.js';
import '../ykn_eklenti-main/yoksis-document-audit-controller.js';

const { collectYoksisAuditQueueAcrossInnerScroll, startYoksisDocumentAudit, requestStopYoksisDocumentAudit } = globalThis.YoksisDocumentAuditController;
const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const readFixture = (name) => readFileSync(join(testDirectory, 'fixtures', 'yoksis-document-audit', name), 'utf8');

function createDocument({ twoRows = false } = {}) {
    const listHtml = readFixture('list.html');
    const selectedRows = twoRows
        ? '<tr><td>1</td><td>2026-00-0000001</td><td>2600000001</td><td><button>Seç &amp; Yükle</button></td></tr><tr><td>2</td><td>2026-00-0000002</td><td>2600000002</td><td><button>Seç &amp; Yükle</button></td></tr>'
        : '<tr><td>1</td><td>2026-00-0000001</td><td>2600000001</td><td><button>Seç &amp; Yükle</button></td></tr>';
    const dom = new JSDOM(listHtml.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${selectedRows}</tbody>`));
    const selectedForm = new JSDOM(readFixture('missing-documents.html')).window.document.body;
    dom.window.document.body.append(...Array.from(selectedForm.children).map((element) => dom.window.document.importNode(element, true)));
    const scrollContainer = dom.window.document.querySelector('.table-scroll');
    Object.defineProperties(scrollContainer, {
        clientHeight: { configurable: true, value: 80 },
        scrollHeight: { configurable: true, value: 240 },
        scrollTop: { configurable: true, writable: true, value: 15 }
    });
    return dom;
}

test('collectYoksisAuditQueueAcrossInnerScroll reaches the bottom and restores the original list position', async () => {
    const dom = createDocument({ twoRows: true });
    const container = dom.window.document.querySelector('.table-scroll');

    const result = await collectYoksisAuditQueueAcrossInnerScroll(dom.window.document);

    assert.equal(result.status, 'complete');
    assert.equal(result.entries.length, 2);
    assert.equal(container.scrollTop, 15);
});

test('collectYoksisAuditQueueAcrossInnerScroll includes rows revealed near the bottom of a virtualized list', async () => {
    const dom = createDocument();
    const document = dom.window.document;
    const container = document.querySelector('.table-scroll');
    const body = document.querySelector('tbody');
    body.innerHTML = '<tr><td>1</td><td>2026-00-0000001</td><td>2600000001</td><td><button>Seç &amp; Yükle</button></td></tr>';
    container.addEventListener('scroll', () => {
        if (container.scrollTop > 30) {
            body.innerHTML = '<tr><td>2</td><td>2026-00-0000002</td><td>2600000002</td><td><button>Seç &amp; Yükle</button></td></tr>';
        }
    });

    const result = await collectYoksisAuditQueueAcrossInnerScroll(document);

    assert.equal(result.status, 'complete');
    assert.deepEqual(result.entries, [
        { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
        { applicationNumber: '2026-00-0000002', studentNumber: '2600000002' }
    ]);
});

test('startYoksisDocumentAudit selects and verifies queue entries serially', async () => {
    const dom = createDocument();
    const events = [];
    let selectedCount = 0;
    dom.window.document.querySelector('tbody button').addEventListener('click', () => { selectedCount += 1; });

    const result = await startYoksisDocumentAudit('scan-test-1', dom.window.document, (event) => events.push(event));

    assert.equal(selectedCount, 1);
    assert.equal(events.filter((event) => event.type === 'record').length, 1);
    assert.equal(events.find((event) => event.type === 'record').result.status, 'verified');
    assert.deepEqual(result, { status: 'complete', completed: 1, remaining: 0, selectionRestored: true });
});

test('startYoksisDocumentAudit waits for the selected record document rows to finish rendering', async () => {
    const dom = createDocument();
    const document = dom.window.document;
    const documentRows = document.querySelectorAll('tbody')[1];
    const expectedRow = documentRows.innerHTML;
    document.querySelector('tbody button').addEventListener('click', () => {
        documentRows.replaceChildren();
        dom.window.setTimeout(() => { documentRows.innerHTML = expectedRow; }, 25);
    });
    const events = [];

    await startYoksisDocumentAudit('scan-test-render-delay', document, (event) => events.push(event));

    assert.equal(events.find((event) => event.type === 'record').result.status, 'verified');
    assert.equal(events.find((event) => event.type === 'record').result.documents[0].name, 'Diğer Belge');
});

test('startYoksisDocumentAudit restores the initially selected record after scanning the queue', async () => {
    const dom = createDocument({ twoRows: true });
    const document = dom.window.document;
    const listRows = document.querySelectorAll('.table-scroll tbody tr');
    const applicationInput = document.getElementById('application-number');
    const studentInput = document.getElementById('student-number');
    listRows[1].querySelector('button').addEventListener('click', () => {
        applicationInput.value = '2026-00-0000002';
        studentInput.value = '2600000002';
    });
    listRows[0].querySelector('button').addEventListener('click', () => {
        applicationInput.value = '2026-00-0000001';
        studentInput.value = '2600000001';
    });

    const result = await startYoksisDocumentAudit('scan-test-restore', document, () => {});

    assert.equal(applicationInput.value, '2026-00-0000001');
    assert.equal(studentInput.value, '2600000001');
    assert.equal(result.selectionRestored, true);
});

test('startYoksisDocumentAudit honors stop after the current verified record', async () => {
    const dom = createDocument({ twoRows: true });
    const events = [];
    let selectedCount = 0;
    dom.window.document.querySelectorAll('tbody button')[0].addEventListener('click', () => { selectedCount += 1; });

    const result = await startYoksisDocumentAudit('scan-test-stop', dom.window.document, (event) => {
        events.push(event);
        if (event.type === 'record') requestStopYoksisDocumentAudit('scan-test-stop');
    });

    assert.equal(selectedCount, 1);
    assert.equal(events.filter((event) => event.type === 'record').length, 1);
    assert.deepEqual(result, { status: 'stopped', completed: 1, remaining: 1, selectionRestored: true });
});
