import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initializeYoksisDocumentAuditManager } from '../src/managers/yoksisDocumentAuditManager.js';

const indexHtml = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
const auditManagerSource = readFileSync(new URL('../src/managers/yoksisDocumentAuditManager.js', import.meta.url), 'utf8');
const excelImportSource = readFileSync(new URL('../src/staff/yoksisExcelImport.js', import.meta.url), 'utf8');
const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/yoksis-ikamet-islemleri-ornek.json', import.meta.url), 'utf8')
);

function createDomFromYetkili() {
    const dom = new JSDOM(indexHtml, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('view-yoksis-audit');
    return { dom, window, root };
}

function attachFakeFile(window, input, fileName, size = 128) {
    const fakeFile = {
        name: fileName,
        size,
        arrayBuffer: async () => new ArrayBuffer(size)
    };
    Object.defineProperty(input, 'files', {
        configurable: true,
        value: [fakeFile]
    });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    return fakeFile;
}

test('yetkili/index.html #view-yoksis-audit includes Excel upload controls and preserves backup scan button', () => {
    const { dom, root } = createDomFromYetkili();
    assert.ok(root, '#view-yoksis-audit should exist');

    const fileLabel = root.querySelector('label[for="audit-excel-file"]');
    assert.ok(fileLabel, 'Excel file label should exist');
    assert.equal(fileLabel.textContent.trim(), "1. YÖKSİS'ten indirdiğiniz İkamet İşlemleri dosyasını seçin");

    const fileInput = root.querySelector('#audit-excel-file');
    assert.ok(fileInput, 'Excel file input should exist');
    assert.equal(fileInput.getAttribute('accept'), '.xls,.xlsx');
    assert.ok(root.querySelector('#audit-excel-file-info'), 'Selected file info element should exist');

    const uploadBtn = root.querySelector('#audit-excel-upload');
    assert.ok(uploadBtn, 'Excel upload button should exist');
    assert.equal(uploadBtn.textContent.trim(), '2. Excel yükle');
    assert.equal(uploadBtn.disabled, true);

    const scanBtn = root.querySelector('#audit-start');
    assert.ok(scanBtn, 'Legacy scan button must not be removed');
    assert.equal(scanBtn.textContent.trim(), 'Yedek: tek tek tara');

    assert.ok(root.querySelector('#audit-import-latest'), 'Latest import line should exist');
    assert.ok(root.querySelector('#audit-excel-stale-warning'), 'Stale file warning should exist');
    assert.equal(root.querySelector('#audit-excel-resume-wrap'), null, 'Resume wrapper must not exist');
    assert.equal(root.querySelector('#audit-excel-resume-info'), null, 'Resume explanation must not exist');
    assert.equal(root.querySelector('#audit-excel-resume'), null, 'Resume button must not exist');
    assert.equal(root.querySelector('#audit-excel-cancel-pending'), null, 'Cancel pending link must not exist');
    assert.ok(root.querySelector('#audit-excel-rejected-body'), 'Rejected rows table body should exist');

    for (const forbidden of [
        'audit-excel-resume',
        'audit-excel-cancel-pending',
        'Kaldığı yerden devam',
        'Yarım yüklemeyi iptal et',
        'IMPORT_PENDING_STORAGE_KEY',
        'readPendingImport',
        'savePendingImport',
        'clearPendingImport'
    ]) {
        assert.equal(indexHtml.includes(forbidden), false, `yetkili/index.html must not contain ${forbidden}`);
        assert.equal(auditManagerSource.includes(forbidden), false, `yoksisDocumentAuditManager.js must not contain ${forbidden}`);
        assert.equal(excelImportSource.includes(forbidden), false, `yoksisExcelImport.js must not contain ${forbidden}`);
    }

    dom.window.close();
});

test('latest import line renders formatted staff/date/count and handles null response', async () => {
    const { dom, window, root } = createDomFromYetkili();
    window.fetch = async (url) => {
        if (url.endsWith('/import/latest')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    importId: 'imp-1',
                    uploadedAt: '2026-11-23T10:30:00.000Z',
                    uploadedBy: 'Görevli Test',
                    rowCount: 1944,
                    exportedAt: '2026-11-23 13:07'
                })
            };
        }
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };

    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    assert.match(
        root.querySelector('#audit-import-latest').textContent,
        /^Son yükleme: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} · Görevli Test · 1944 satır$/
    );
    dom.window.close();

    const { dom: domNull, window: winNull, root: rootNull } = createDomFromYetkili();
    winNull.fetch = async (url) => {
        if (url.endsWith('/import/latest')) {
            return { ok: true, status: 200, json: async () => null };
        }
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };
    initializeYoksisDocumentAuditManager(rootNull);
    await new Promise((resolve) => winNull.setTimeout(resolve, 10));

    assert.match(rootNull.querySelector('#audit-import-latest').textContent, /Henüz Excel yüklenmedi/);
    domNull.window.close();
});

test('Excel upload displays summary, rejected rows as plain text, stale warning when older than 24h, and sends final:true', async () => {
    const { dom, window, root } = createDomFromYetkili();
    const aoa = [
        fixture.headers,
        ...fixture.rows,
        [
            '2026-00-0000099',
            '<img src=x onerror=alert(1)>',
            'XSS TEST',
            '', '', 'İlk Başvuru', '', '900099', '20.11.2026', 'İşlem Bekliyor', '', '', ''
        ]
    ];
    window.XLSX = {
        read: () => ({ SheetNames: ['Sayfa1'], Sheets: { Sayfa1: { __aoa: aoa } } }),
        utils: { sheet_to_json: (ws) => ws.__aoa }
    };

    const importCalls = [];
    window.fetch = async (url, options = {}) => {
        if (url.endsWith('/import/latest')) {
            return { ok: true, status: 200, json: async () => null };
        }
        if (url.endsWith('/import')) {
            const body = JSON.parse(options.body);
            importCalls.push(body);
            return { ok: true, status: 200, json: async () => ({ storedCount: body.rows.length, rejected: [] }) };
        }
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };

    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    // Old filename (> 24h ago) triggers yellow warning
    const fileInput = root.querySelector('#audit-excel-file');
    attachFakeFile(window, fileInput, 'Ikamet_Islemleri_20250101_0900.xls', 256);

    const warning = root.querySelector('#audit-excel-stale-warning');
    assert.equal(warning.hidden, false);
    assert.match(warning.textContent, /Bu dosya dünden kalma görünüyor/);

    root.querySelector('#audit-excel-upload').click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    assert.equal(importCalls.length, 1);
    assert.equal(importCalls[0].final, true);
    assert.equal(importCalls[0].rows.length, 4);

    assert.equal(
        root.querySelector('#audit-excel-summary').textContent,
        '8 satır, 4 başvuru (2 tekrar birleştirildi), 2 reddedildi'
    );

    const rejectedBody = root.querySelector('#audit-excel-rejected-body');
    assert.equal(rejectedBody.querySelectorAll('tr').length, 2);
    assert.equal(rejectedBody.querySelector('img'), null);
    assert.equal(rejectedBody.rows[0].cells[0].textContent, '7');
    assert.equal(rejectedBody.rows[1].cells[0].textContent, '9');

    dom.window.close();
});

test('failed batch mid-upload stops, never sends final:true, writes nothing to sessionStorage, and shows retry message with counts', async () => {
    const { dom, window, root } = createDomFromYetkili();
    const manyRows = [fixture.headers];
    for (let i = 1; i <= 120; i += 1) {
        manyRows.push([
            `2026-00-${String(i).padStart(7, '0')}`,
            `260000${String(i).padStart(5, '0')}`,
            `ÖĞRENCİ ${i}`,
            'Mühendislik', 'Bilgisayar', 'İlk Başvuru', '', String(i), '23.11.2026', 'İşlem Bekliyor', '', '', '23.11.2026'
        ]);
    }
    window.XLSX = {
        read: () => ({ SheetNames: ['Sayfa1'], Sheets: { Sayfa1: { __aoa: manyRows } } }),
        utils: { sheet_to_json: (ws) => ws.__aoa }
    };

    const importCalls = [];
    let failSecond = true;
    window.fetch = async (url, options = {}) => {
        if (url.endsWith('/import/latest')) {
            return { ok: true, status: 200, json: async () => null };
        }
        if (url.endsWith('/import')) {
            const body = JSON.parse(options.body);
            importCalls.push(body);
            if (importCalls.length === 2 && failSecond) {
                failSecond = false;
                return { ok: false, status: 500, json: async () => ({ error: { message: 'Sunucu hatası' } }) };
            }
            return { ok: true, status: 200, json: async () => ({ storedCount: body.rows.length, rejected: [] }) };
        }
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };

    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    attachFakeFile(window, root.querySelector('#audit-excel-file'), 'Ikamet_Islemleri_20261123_1307.xls', 1024);
    root.querySelector('#audit-excel-upload').click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    assert.equal(importCalls.length, 2);
    assert.equal(importCalls[0].final, false);
    assert.equal(importCalls[1].final, false);
    assert.equal(importCalls.some((call) => call.final === true), false);
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(
        root.querySelector('#audit-excel-progress').textContent.trim(),
        'Yükleme yarıda kaldı (1/3 parti gönderildi). Aynı dosyayı yeniden seçip yükleyin; kayıtlar çift yazılmaz.'
    );

    const firstImportId = importCalls[0].importId;
    root.querySelector('#audit-excel-upload').click();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    assert.equal(importCalls.length, 5);
    assert.notEqual(importCalls[2].importId, firstImportId);
    assert.equal(importCalls[2].final, false);
    assert.equal(importCalls[3].final, false);
    assert.equal(importCalls[4].final, true);
    assert.equal(importCalls[4].rows.length, 20);
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(
        root.querySelector('#audit-excel-progress').textContent.trim(),
        'Excel aktarımı tamamlandı (120 kayıt kaydedildi).'
    );

    dom.window.close();
});

test('records with import metadata show unit/program, missingDeadline with remaining days, and isStale badge as plain text', async () => {
    const { dom, window, root } = createDomFromYetkili();
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const futureIso = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;

    window.fetch = async (url) => {
        if (url.endsWith('/import/latest')) {
            return { ok: true, status: 200, json: async () => null };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                total: 1,
                page: 1,
                pageSize: 50,
                records: [{
                    application_number: '2026-00-0000011',
                    student_number: '26000000011',
                    first_name: 'DENEME ÖĞRENCİ',
                    last_name: '',
                    passport_number: '',
                    phone: '',
                    application_status: 'Eksik Belge İstendi',
                    status_category: 'missing_documents',
                    result_status: 'verified',
                    documents: [{ name: 'Öğrenci belgesi', required: true, note: '', uploadStatus: '' }],
                    scanned_at: '2026-11-23T10:00:00.000Z',
                    import: {
                        unit: '<b>Mühendislik</b>',
                        program: 'Bilgisayar',
                        missingDeadline: futureIso,
                        lastTransactionType: 'Eksik Evrak',
                        transactionCount: 2,
                        gocLastQueryAt: '2026-11-23',
                        isStale: true
                    }
                }]
            })
        };
    };

    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 15));

    const row = root.querySelector('#audit-results tr');
    assert.ok(row);
    assert.equal(row.querySelector('b'), null, 'Unit HTML must be rendered via textContent');
    assert.match(row.cells[1].textContent, /<b>Mühendislik<\/b>/);
    assert.match(row.cells[1].textContent, /Bilgisayar/);
    assert.match(row.cells[6].textContent, /gün kaldı/);
    assert.match(row.cells[7].textContent, /Son yüklemede yok/);

    dom.window.close();
});

test('Excel upload button stays disabled until .xls/.xlsx file is selected and shows selected file name and size', async () => {
    const { dom, window, root } = createDomFromYetkili();
    window.fetch = async (url) => {
        if (url.endsWith('/import/latest')) {
            return { ok: true, status: 200, json: async () => null };
        }
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };

    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    const fileInput = root.querySelector('#audit-excel-file');
    const uploadBtn = root.querySelector('#audit-excel-upload');
    const fileInfo = root.querySelector('#audit-excel-file-info');

    assert.equal(uploadBtn.disabled, true);
    assert.equal(fileInfo.hidden, true);

    attachFakeFile(window, fileInput, 'liste.csv', 512);
    assert.equal(uploadBtn.disabled, true);

    attachFakeFile(window, fileInput, 'Ikamet_Islemleri_20261123_1307.xls', 2048);
    assert.equal(uploadBtn.disabled, false);
    assert.equal(fileInfo.hidden, false);
    assert.match(fileInfo.textContent, /Ikamet_Islemleri_20261123_1307\.xls/);
    assert.match(fileInfo.textContent, /2,0 KB/);

    Object.defineProperty(fileInput, 'files', { configurable: true, value: [] });
    fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(uploadBtn.disabled, true);
    assert.equal(fileInfo.hidden, true);

    dom.window.close();
});
