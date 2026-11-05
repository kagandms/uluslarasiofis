import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import '../ykn_eklenti-main/gocnet-transfer-controller.js';

const noMatchFixture = readFileSync(new URL('./fixtures/gocnet-transfer/no-match.html', import.meta.url), 'utf8');
const queryFixture = readFileSync(new URL('./fixtures/gocnet-transfer/query-form.html', import.meta.url), 'utf8');
const existingRecordFixture = readFileSync(new URL('./fixtures/gocnet-transfer/existing-record.html', import.meta.url), 'utf8');
const uploadFixture = readFileSync(new URL('./fixtures/gocnet-transfer/document-upload.html', import.meta.url), 'utf8');
const { dispatchGocnetPdfUpload, findGocnetApplicationDocumentUploadTarget, queryGocnetRegistration,
    queryGocnetRecordList, readGocnetQueryResult, readGocnetRecordListResult, readGocnetUploadResult } = globalThis.YoksisGocnetTransferController;

test('recognizes only the explicit completed no-record query result for the exact searched number', () => {
    const dom = new JSDOM(noMatchFixture);
    assert.equal(readGocnetQueryResult(dom.window.document, '2099-12-99999999'), 'no_match');
    assert.equal(readGocnetQueryResult(dom.window.document, '2099-12-99999998'), 'unknown');
    dom.window.close();
});

test('recognizes the explicit database-loaded response as an existing record', () => {
    const dom = new JSDOM(existingRecordFixture);
    assert.equal(readGocnetQueryResult(dom.window.document, '2026-08-1234567'), 'existing_record');
    assert.equal(readGocnetQueryResult(dom.window.document, '2026-08-1234568'), 'unknown');
    dom.window.close();
});

test('classifies GöçNet history only after a fresh unfiltered exact-number result and visible empty state', () => {
    const evidenceHtml = readFileSync(new URL('../test/fixtures/gocnet-transfer/dom-contract.html', import.meta.url), 'utf8');
    const dom = new JSDOM(evidenceHtml);
    const { document } = dom.window;
    const options = { applicationNumber: '2099-01-0000001', freshResponse: true };
    assert.equal(readGocnetRecordListResult(document, options), 'existing_record');
    const list = document.querySelector('[data-fixture="records"]');
    const exactRow = list.querySelector('.fixture-records tr').cloneNode(true);
    exactRow.querySelectorAll('td')[1].textContent = '2099-01-0000002';
    list.querySelector('.fixture-records').append(exactRow);
    assert.equal(readGocnetRecordListResult(document, options), 'unknown');
    exactRow.remove();
    list.querySelector('.fixture-records').replaceChildren();
    assert.equal(readGocnetRecordListResult(document, options), 'unknown');
    list.querySelector('.z-listbox-emptybody td').style.display = 'table-cell';
    assert.equal(readGocnetRecordListResult(document, options), 'no_match');
    assert.equal(readGocnetRecordListResult(document, { ...options, freshResponse: false }), 'unknown');
    assert.equal(readGocnetRecordListResult(document, { ...options, busy: true }), 'unknown');
    document.querySelector('input[placeholder="Öğrenci no..."]').value = '99000000002';
    assert.equal(readGocnetRecordListResult(document, options), 'unknown');
    dom.window.close();
});

test('GöçNet history result is trusted only after the MAIN-world query confirms a fresh response', async () => {
    const evidenceHtml = readFileSync(new URL('../test/fixtures/gocnet-transfer/dom-contract.html', import.meta.url), 'utf8');
    const dom = new JSDOM(evidenceHtml);
    const previousChrome = globalThis.chrome;
    globalThis.chrome = { runtime: { sendMessage: async () => ({ success: true, freshResponse: true }) } };
    try {
        assert.equal(await queryGocnetRecordList(dom.window.document, '2099-01-0000001', 'history-1'), 'existing_record');
        const records = dom.window.document.querySelector('[data-fixture="records"]');
        records.querySelector('.fixture-records').replaceChildren();
        records.querySelector('.z-listbox-emptybody td').style.display = 'table-cell';
        assert.equal(await queryGocnetRecordList(dom.window.document, '2099-01-0000001', 'history-2'), 'no_match');
        globalThis.chrome.runtime.sendMessage = async () => ({ success: false });
        assert.equal(await queryGocnetRecordList(dom.window.document, '2099-01-0000001', 'history-3'), 'unknown');
    } finally {
        if (previousChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = previousChrome;
        dom.window.close();
    }
});

test('treats empty, hidden, changed, or unrelated query results as unknown', () => {
    const dom = new JSDOM(noMatchFixture);
    const { document } = dom.window;
    const emptyDom = new JSDOM('<main></main>');
    assert.equal(readGocnetQueryResult(emptyDom.window.document, '2099-12-99999999'), 'unknown');
    emptyDom.window.close();
    document.querySelector('[role="dialog"]').setAttribute('aria-hidden', 'true');
    assert.equal(readGocnetQueryResult(document, '2099-12-99999999'), 'unknown');
    document.querySelector('[role="dialog"]').removeAttribute('aria-hidden');
    document.querySelector('[role="dialog"] p:last-of-type').textContent = 'Detay: Başka bir hata';
    assert.equal(readGocnetQueryResult(document, '2099-12-99999999'), 'unknown');
    dom.window.close();
});

test('issues one exact read-only query and waits for its explicit no-match result', async () => {
    const dom = new JSDOM(queryFixture, { pretendToBeVisual: true });
    let clicks = 0;
    dom.window.document.querySelector('button').addEventListener('click', () => {
        clicks += 1;
        dom.window.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h2>Sorgu Hatası</h2><p>Başvuru sorgulama başarısız!</p><p>Hata Kodu: Veri Bulunamadı</p><p>Detay: Kayıt bulunamadı</p><button>Tamam</button></div>');
    });
    const result = await queryGocnetRegistration(dom.window.document, '2099-12-99999999', { timeoutMs: 100 });
    assert.equal(result, 'no_match');
    assert.equal(clicks, 1);
    assert.equal(dom.window.document.querySelector('input').value, '2099-12-99999999');
    dom.window.close();
});

test('reports an existing record without closing its result dialog', async () => {
    const dom = new JSDOM(queryFixture, { pretendToBeVisual: true });
    let clicks = 0;
    dom.window.document.querySelector('button').addEventListener('click', () => {
        clicks += 1;
        dom.window.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h2>Sorgulama Başarılı (DB Kaydı Yüklendi)</h2><p>Başvuru sorgulama başarılı. Öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.</p><button>Tamam</button></div>');
    });
    assert.equal(await queryGocnetRegistration(dom.window.document, '2026-08-1234567', { timeoutMs: 100 }), 'existing_record');
    assert.equal(clicks, 1);
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    dom.window.close();
});

test('finds only the upload control in the exact 999 application-documents row', () => {
    const dom = new JSDOM(uploadFixture);
    const target = findGocnetApplicationDocumentUploadTarget(dom.window.document);
    assert.ok(target);
    assert.match(target.row.textContent, /999[\s\S]*Başvuru Belgeleri/);
    assert.equal(target.button.textContent, 'Yükle');
    assert.equal(target.input.type, 'file');

    target.row.remove();
    assert.equal(findGocnetApplicationDocumentUploadTarget(dom.window.document), null);
    dom.window.close();
});

test('accepts upload only when the GöçNet success receipt matches the uploaded 999 row', () => {
    const evidenceHtml = readFileSync(new URL('../test/fixtures/gocnet-transfer/dom-contract.html', import.meta.url), 'utf8');
    const dom = new JSDOM(evidenceHtml, { pretendToBeVisual: true });
    const dialog = dom.window.document.querySelector('.z-messagebox-window');
    dialog.style.display = 'block';
    const row = dom.window.document.querySelector('[data-fixture="documents"] .z-listbox-body .z-listitem');
    row.querySelectorAll('td')[4].textContent = 'YÜKLENDİ';
    row.querySelectorAll('td')[5].textContent = '80001';
    assert.equal(readGocnetUploadResult(dom.window.document)?.documentId, '80001');
    row.querySelectorAll('td')[5].textContent = '80002';
    assert.equal(readGocnetUploadResult(dom.window.document), null);
    dom.window.close();
});

test('assigns one bounded PDF through the exact row file input and dispatches one normal change event', () => {
    const dom = new JSDOM(uploadFixture);
    const { document } = dom.window;
    const target = findGocnetApplicationDocumentUploadTarget(document);
    const file = new dom.window.File(['pdf'], 'prepared.pdf', { type: 'application/pdf' });
    let changes = 0;
    target.input.addEventListener('change', () => { changes += 1; });
    dom.window.DataTransfer = class {
        files = [];
        items = { add: (item) => this.files.push(item) };
    };
    Object.defineProperty(target.input, 'files', { configurable: true, get: () => assignedFiles, set: (files) => { assignedFiles = files; } });
    let assignedFiles = [];

    assert.equal(dispatchGocnetPdfUpload(document, file), true);
    assert.equal(assignedFiles[0], file);
    assert.equal(changes, 1);
    assert.equal(dispatchGocnetPdfUpload(document, new dom.window.File(['x'], 'wrong.txt', { type: 'text/plain' })), false);
    assert.equal(changes, 1);
    dom.window.close();
});

test('does not issue a query when another modal is already open or the input is ambiguous', async () => {
    const dom = new JSDOM(queryFixture);
    let clicks = 0;
    dom.window.document.querySelector('button').addEventListener('click', () => { clicks += 1; });
    dom.window.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><p>Başka işlem</p></div>');
    assert.equal(await queryGocnetRegistration(dom.window.document, '2099-12-99999999', { timeoutMs: 25 }), 'unknown');
    assert.equal(clicks, 0);
    dom.window.document.querySelector('[role="dialog"]').remove();
    dom.window.document.querySelector('section').insertAdjacentHTML('beforeend', '<label>E-İkamet Başvuru No: <input type="text"></label>');
    assert.equal(await queryGocnetRegistration(dom.window.document, '2099-12-99999999', { timeoutMs: 25 }), 'unknown');
    assert.equal(clicks, 0);
    dom.window.document.querySelector('section label input').disabled = true;
    dom.window.document.querySelector('section label:last-of-type').remove();
    assert.equal(await queryGocnetRegistration(dom.window.document, '2099-12-99999999', { timeoutMs: 25 }), 'unknown');
    assert.equal(clicks, 0);
    dom.window.close();
});
