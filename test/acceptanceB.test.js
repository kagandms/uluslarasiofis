import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { OFFICE_DOCUMENTS } from '../src/config/documents-config.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { validateStaffAssistantResponse } from '../src/shared/staff-assistant-contract.js';
import { initializeStaffAssistant } from '../src/staff/staffAssistant.js';
import { initWorkHours } from '../src/staff/work-hours.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { createFakeAiBinding } from './helpers/fakeAiBinding.js';

const SESSION_TOKEN = 'acceptance-b-staff-session-token-0123456789';
const PASSWORD_HASH = await deriveStaffPasswordHash('Acceptance B test password 2026');

async function createStaffFixture({ aiScript = { response: 'Yardımcı olamıyorum.' } } = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);

    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-b-1', 'qa.staff', 'qa.staff', ?, 'QA Staff', 'reviewer')
    `).bind(PASSWORD_HASH).run();

    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-b-1', 'staff-b-1', ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(await hashSessionToken(SESSION_TOKEN), new Date().toISOString()).run();

    const fakeAi = createFakeAiBinding(aiScript);
    const environment = {
        DB: database,
        STAFF_SHARED_USERNAME: 'qa.staff',
        AI: fakeAi
    };

    return { database, fakeAi, environment };
}

function createAssistantRequest(body, { origin = 'https://portal.test' } = {}) {
    const headers = new Headers({
        'Content-Type': 'application/json',
        Cookie: `staff_session=${SESSION_TOKEN}`
    });
    if (origin !== null) headers.set('Origin', origin);
    return new Request('https://portal.test/api/staff/assistant', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
}

async function sendAssistant(environment, message) {
    const response = await worker.fetch(createAssistantRequest({ message }), environment, {});
    assert.equal(response.status, 200, `Unexpected HTTP ${response.status} for message: ${message}`);
    const payload = await response.json();
    return validateStaffAssistantResponse(payload);
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(() => setImmediate(resolve), 10));
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function columnLetters(index) {
    let n = index + 1;
    let letters = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc ^= bytes[i];
        for (let j = 0; j < 8; j += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, content } of entries) {
        const nameBytes = encoder.encode(name);
        const dataBytes = typeof content === 'string' ? encoder.encode(content) : content;
        const crc = crc32(dataBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, dataBytes.length, true);
        lv.setUint32(22, dataBytes.length, true);
        lv.setUint16(26, nameBytes.length, true);
        localHeader.set(nameBytes, 30);

        localParts.push(localHeader, dataBytes);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(10, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, dataBytes.length, true);
        cv.setUint32(24, dataBytes.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);

        centralParts.push(centralHeader);
        offset += localHeader.length + dataBytes.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const totalLength = offset + centralSize + eocd.length;
    const output = new Uint8Array(totalLength);
    let cursor = 0;
    for (const part of [...localParts, ...centralParts, eocd]) {
        output.set(part, cursor);
        cursor += part.length;
    }
    return output;
}

function createRealXlsxAdapter() {
    return {
        utils: {
            aoa_to_sheet(rows) {
                return { '!rows': rows };
            },
            book_new() {
                return { SheetNames: [], Sheets: {} };
            },
            book_append_sheet(workbook, worksheet, sheetName) {
                workbook.SheetNames.push(sheetName);
                workbook.Sheets[sheetName] = worksheet;
            }
        },
        write(workbook) {
            const firstSheetName = workbook.SheetNames[0] || 'Sheet1';
            const rows = workbook.Sheets[firstSheetName]?.['!rows'] || [];
            const rowXml = rows.map((row, rowIndex) => {
                if (!Array.isArray(row) || row.length === 0) {
                    return `<row r="${rowIndex + 1}"/>`;
                }
                const cells = row.map((value, colIndex) => {
                    if (value === null || value === undefined || value === '') return '';
                    const ref = `${columnLetters(colIndex)}${rowIndex + 1}`;
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        return `<c r="${ref}" t="n"><v>${value}</v></c>`;
                    }
                    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
                }).filter(Boolean).join('');
                return `<row r="${rowIndex + 1}">${cells}</row>`;
            }).join('');

            const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
            const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(firstSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
            const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
            const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
            const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

            return buildStoredZip([
                { name: '[Content_Types].xml', content: contentTypes },
                { name: '_rels/.rels', content: rootRels },
                { name: 'xl/workbook.xml', content: workbookXml },
                { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
                { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
            ]);
        }
    };
}

function columnIndexFromRef(cellRef) {
    const match = /^([A-Z]+)(\d+)$/.exec(cellRef);
    if (!match) return { col: 0, row: 0 };
    let col = 0;
    for (const ch of match[1]) {
        col = col * 26 + (ch.charCodeAt(0) - 64);
    }
    return { col: col - 1, row: Number.parseInt(match[2], 10) - 1 };
}

async function readXlsxSheetRows(bytes, { defval = null, minCols = 3 } = {}) {
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    try {
        const entries = await reader.getEntries();
        const sheetEntry = entries.find((entry) => entry.filename === 'xl/worksheets/sheet1.xml');
        assert.ok(sheetEntry, 'Generated .xlsx must contain xl/worksheets/sheet1.xml');
        const xmlText = await sheetEntry.getData(new TextWriter());
        const dom = new JSDOM(xmlText, { contentType: 'application/xml' });
        try {
            const doc = dom.window.document;
            const rows = [];
            for (const rowEl of doc.querySelectorAll('sheetData > row')) {
                const rowIndex = Number.parseInt(rowEl.getAttribute('r') || '1', 10) - 1;
                const rowArr = [];
                for (const cellEl of rowEl.querySelectorAll('c')) {
                    const { col } = columnIndexFromRef(cellEl.getAttribute('r') || 'A1');
                    while (rowArr.length <= col) rowArr.push(defval);
                    const type = cellEl.getAttribute('t');
                    if (type === 'inlineStr') {
                        rowArr[col] = cellEl.querySelector('is > t')?.textContent ?? '';
                    } else {
                        const vText = cellEl.querySelector('v')?.textContent;
                        rowArr[col] = vText !== undefined && vText !== '' ? Number(vText) : defval;
                    }
                }
                if (rowIndex >= 3) {
                    while (rowArr.length < minCols) rowArr.push(defval);
                }
                rows[rowIndex] = rowArr;
            }
            return rows;
        } finally {
            dom.window.close();
        }
    } finally {
        await reader.close();
    }
}

test('B01 screenshot sentences resolve to the right document and 10 copies', async () => {
    const { environment, fakeAi } = await createStaffFixture();

    const cases = [
        { message: 'başvuru formu cıkarır mısın 10tane', expectedId: 'ogrenci-basvuru-formu' },
        { message: 'lisans checklist çıkar 10tane', expectedId: 'on-lisans-lisans-checklist' },
        { message: 'lisans checklist çıkar 10 tane', expectedId: 'on-lisans-lisans-checklist' }
    ];

    for (const { message, expectedId } of cases) {
        const payload = await sendAssistant(environment, message);
        assert.equal(payload.state, 'understood', `Expected understood for "${message}"`);
        assert.deepEqual(payload.action, {
            type: 'documents.print',
            documentId: expectedId,
            copies: 10
        });
    }

    assert.equal(fakeAi.callCount, 0, 'Deterministic print intent should not invoke the AI model');
});

test('B02 all 9 office documents match across at least 4 natural phrasings each (ASCII-folded, typo, polite)', async () => {
    const { environment, fakeAi } = await createStaffFixture();

    const phrasingsByDocumentId = {
        'ogrenci-basvuru-formu': [
            { message: 'basvuru formu yazdir', copies: 1 },
            { message: 'basvru formu cikar', copies: 1 },
            { message: 'Öğrenci başvuru formu rica edebilir miyim?', copies: 1 },
            { message: 'kayıt formu 3 tane çıkarır mısın', copies: 3 }
        ],
        'eksik-evrak-taahhutnamesi': [
            { message: 'taahhutname yazdir', copies: 1 },
            { message: 'taahutname cikar', copies: 1 },
            { message: 'Şartlı kayıt taahhütnamesi çıkarabilir misiniz lütfen', copies: 1 },
            { message: 'eksik evrak taahhütnamesi 2 adet', copies: 2 }
        ],
        'on-lisans-lisans-checklist': [
            { message: 'on lisans checklist cikar', copies: 1 },
            { message: 'lisans chekclist yazdir', copies: 1 },
            { message: 'Ön lisans kontrol listesi rica etsem', copies: 1 },
            { message: 'lisans kontrol listesi 5 tane', copies: 5 }
        ],
        'lisansustu-evrak-kontrol': [
            { message: 'yuksek lisans checklist cikar', copies: 1 },
            { message: 'lisansustu chekclist yazdir', copies: 1 },
            { message: 'Doktora kontrol listesi çıkarabilir misiniz?', copies: 1 },
            { message: 'master checklist 2 adet', copies: 2 }
        ],
        'kayit-silme-formu': [
            { message: 'kayit silme formu cikar', copies: 1 },
            { message: 'kayit silme fomru yazdir', copies: 1 },
            { message: 'Kayıt silme dilekçesi rica edebilir miyim?', copies: 1 },
            { message: 'ilişik kesme formu 3 tane', copies: 3 }
        ],
        'taksitlendirme-dilekcesi': [
            { message: 'taksit dilekcesi yazdir', copies: 1 },
            { message: 'taksit dilekcsi cikar', copies: 1 },
            { message: 'Taksitlendirme dilekçesi rica edebilir miyim?', copies: 1 },
            { message: 'taksit formu 4 kopya çıkarır mısın', copies: 4 }
        ],
        'bos-dilekce-formu': [
            { message: 'bos dilekce yazdir', copies: 1 },
            { message: 'bos dilekce fomru cikar', copies: 1 },
            { message: 'Boş dilekçe formu rica edebilir miyim?', copies: 1 },
            { message: 'genel dilekçe 2 tane', copies: 2 }
        ],
        'ikamet-kimlik-evrak-listesi': [
            { message: 'ikamet evrak listesi cikar', copies: 1 },
            { message: 'ikamet listsei yazdir', copies: 1 },
            { message: 'İkamet kimlik evrak listesi çıkarabilir misiniz lütfen', copies: 1 },
            { message: 'ikamet checklist 3 adet', copies: 3 }
        ],
        'indirim-dilekcesi': [
            { message: 'indirim dilekcesi cikar', copies: 1 },
            { message: 'indirm dilekcesi yazdir', copies: 1 },
            { message: 'TÖMER indirim dilekçesi rica edebilir miyim?', copies: 1 },
            { message: 'indirim 5 tane çıkar', copies: 5 }
        ]
    };

    assert.equal(Object.keys(phrasingsByDocumentId).length, OFFICE_DOCUMENTS.length);
    for (const doc of OFFICE_DOCUMENTS) {
        const cases = phrasingsByDocumentId[doc.id];
        assert.ok(Array.isArray(cases) && cases.length >= 4, `Document ${doc.id} must have at least 4 cases`);
        for (const { message, copies } of cases) {
            const payload = await sendAssistant(environment, message);
            assert.equal(payload.state, 'understood', `Expected understood for "${message}"`);
            assert.deepEqual(payload.action, {
                type: 'documents.print',
                documentId: doc.id,
                copies
            });
        }
    }

    assert.equal(fakeAi.callCount, 0);
});

test('B03 ambiguous document queries offer choices without auto-printing and preserve copy count', async (context) => {
    const { environment } = await createStaffFixture();

    const ambiguousCases = [
        { message: 'checklist 4 tane çıkar', expectedCopies: 4 },
        { message: 'dilekçe 3 tane çıkar', expectedCopies: 3 },
        { message: 'form 5 adet yazdır', expectedCopies: 5 },
        { message: 'kayıt 2 tane çıkar', expectedCopies: 2 },
        { message: 'ikamet 6 kopya yazdır', expectedCopies: 6 },
        { message: 'lisansüstü başvuru 7 tane çıkar', expectedCopies: 7, excludeId: 'on-lisans-lisans-checklist' }
    ];

    for (const { message, expectedCopies, excludeId } of ambiguousCases) {
        const payload = await sendAssistant(environment, message);
        assert.equal(payload.action, undefined, `Ambiguous query "${message}" must not auto-print`);
        assert.equal(payload.state, 'confused');
        assert.equal(payload.results?.kind, 'documentChoices');
        assert.equal(payload.results?.copies, expectedCopies);
        assert.ok(payload.results.items.length >= 2, `Expected multiple choices for "${message}"`);
        if (excludeId) {
            assert.equal(
                payload.results.items.some((item) => item.documentId === excludeId),
                false,
                `Graduate query "${message}" must not suggest ${excludeId}`
            );
        }
    }

    // End-to-end UI verification: selecting a choice preserves copy count when printing.
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([200, 200]);
    const sourcePdfBytes = await sourceDoc.save();

    const dom = new JSDOM('<!doctype html><html><body><div id="app-content"></div></body></html>', {
        url: 'https://portal.test/yetkili/'
    });
    const { window } = dom;
    const doc = window.document;
    context.after(() => dom.window.close());

    let printedBlob = null;
    const openedUrls = [];
    window.URL.createObjectURL = (blob) => {
        printedBlob = blob;
        return 'blob:https://portal.test/b03-print';
    };
    window.URL.revokeObjectURL = () => {};
    window.open = (url) => {
        openedUrls.push(url);
        return { addEventListener() {}, focus() {}, print() {} };
    };

    const fetcher = async (url, options = {}) => {
        if (url === '/api/staff/assistant') {
            return worker.fetch(createAssistantRequest(JSON.parse(options.body)), environment, {});
        }
        if (url.startsWith('/documents/') && url.endsWith('.pdf')) {
            return new Response(sourcePdfBytes, {
                status: 200,
                headers: { 'Content-Type': 'application/pdf' }
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    assert.ok(controller);
    context.after(() => controller.destroy());

    doc.getElementById('staff-assistant-launcher').click();
    const input = doc.getElementById('staff-assistant-input');
    input.value = 'checklist 4 tane çıkar';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(openedUrls.length, 0, 'Nothing should print before staff chooses a document');
    const choiceButtons = [...doc.querySelectorAll('.staff-assistant-choice-btn')];
    assert.ok(choiceButtons.length >= 2);
    assert.ok(choiceButtons.every((btn) => btn.dataset.copies === '4'));

    choiceButtons[0].click();
    await flushPromises();

    assert.equal(openedUrls.length, 1);
    assert.ok(printedBlob, 'Selecting a choice must generate the multi-copy PDF');
    const printedPdf = await PDFDocument.load(await printedBlob.arrayBuffer());
    assert.equal(printedPdf.getPageCount(), 4);
});

test('B04 rejects 0, 51, -3 copies and accepts 1 and 50 copies', async () => {
    const { environment } = await createStaffFixture();

    for (const invalidMessage of [
        '0 kopya başvuru formu çıkar',
        '51 tane başvuru formu çıkar',
        '-3 kopya başvuru formu çıkar'
    ]) {
        const payload = await sendAssistant(environment, invalidMessage);
        assert.equal(payload.state, 'confused', `Expected confused for "${invalidMessage}"`);
        assert.equal(payload.action, undefined, `Expected no print action for "${invalidMessage}"`);
    }

    for (const { message, expectedCopies } of [
        { message: '1 tane başvuru formu çıkar', expectedCopies: 1 },
        { message: '50 adet başvuru formu çıkar', expectedCopies: 50 }
    ]) {
        const payload = await sendAssistant(environment, message);
        assert.equal(payload.state, 'understood');
        assert.deepEqual(payload.action, {
            type: 'documents.print',
            documentId: 'ogrenci-basvuru-formu',
            copies: expectedCopies
        });
    }
});

test('B05 non-print requests do not route to printing and delete/approve requests are refused', async () => {
    const { environment } = await createStaffFixture({
        aiScript: { response: 'Bu isteği yerine getiremem.' }
    });

    const nonPrintCases = [
        { message: 'Ahmet Yılmaz için tebliğ çıkar', expectedActionType: 'tebligat.lookup' },
        { message: 'Asaf bugün 6 saat', expectedActionType: 'workHours.propose' },
        { message: 'AB123456 pasaportu için YKN çıkar', expectedActionType: 'ykn.run' },
        { message: 'YÖKSİS listesi çıkar', expectedActionType: undefined },
        { message: 'gelen sorular ekranını aç', expectedActionType: 'navigate' },
        { message: 'gelen sorular', expectedActionType: undefined }
    ];

    for (const { message, expectedActionType } of nonPrintCases) {
        const payload = await sendAssistant(environment, message);
        assert.notEqual(payload.action?.type, 'documents.print', `"${message}" must never route to documents.print`);
        if (expectedActionType !== undefined) {
            assert.equal(payload.action?.type, expectedActionType);
        }
    }

    for (const redLineMessage of [
        'bu başvuruyu sil',
        'başvuruyu onayla',
        'başvuruyu onaylandı olarak güncelle',
        'başvuru durumunu reddedildi yap'
    ]) {
        const payload = await sendAssistant(environment, redLineMessage);
        assert.equal(payload.state, 'confused', `Red-line "${redLineMessage}" must be refused`);
        assert.equal(payload.action, undefined, `Red-line "${redLineMessage}" must not emit an action`);
        assert.match(payload.reply, /yapamam/);
    }
});

test('B06 timesheet exports separate per-person .xlsx with 30 days, half hours, totals, and distinct empty vs 0 days', async (context) => {
    const { database, environment } = await createStaffFixture();

    await database.prepare(`
        INSERT INTO staff_work_hours (id, staff_key, work_date, minutes, created_at, updated_at)
        VALUES
            ('wh-1', 'kagan_samet', '2026-11-02', 450, '2026-11-02T17:00:00.000Z', '2026-11-02T17:00:00.000Z'),
            ('wh-2', 'kagan_samet', '2026-11-03', 0, '2026-11-03T17:00:00.000Z', '2026-11-03T17:00:00.000Z'),
            ('wh-3', 'kagan_samet', '2026-11-04', 90, '2026-11-04T17:00:00.000Z', '2026-11-04T17:00:00.000Z'),
            ('wh-4', 'asaf', '2026-11-02', 480, '2026-11-02T17:00:00.000Z', '2026-11-02T17:00:00.000Z')
    `).run();

    const dom = new JSDOM(`
        <section id="staff-work-hours">
            <input type="date" data-work-hours-date />
            <span data-work-hours-display></span>
            <span data-work-hours-status></span>
            <p data-work-hours-holiday hidden></p>
            <div data-work-hours-table></div>
            <div data-work-hours-history></div>
        </section>
    `, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const doc = window.document;
    context.after(() => dom.window.close());

    const downloads = [];
    const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function click() {
        downloads.push({ fileName: this.download, href: this.href });
    };
    context.after(() => { window.HTMLAnchorElement.prototype.click = originalAnchorClick; });

    const blobsByUrl = new Map();
    window.URL.createObjectURL = (blob) => {
        const url = `blob:https://portal.test/b06-${blobsByUrl.size + 1}`;
        blobsByUrl.set(url, blob);
        return url;
    };
    window.URL.revokeObjectURL = () => {};
    window.XLSX = createRealXlsxAdapter();

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const request = new Request(`https://portal.test${url}`, {
            headers: { Cookie: `staff_session=${SESSION_TOKEN}` }
        });
        return worker.fetch(request, environment, {});
    };
    context.after(() => { globalThis.fetch = previousFetch; });

    initWorkHours(doc);
    await flushPromises();

    // Load November 2026 (30-day month) explicitly via date input.
    const dateInput = doc.querySelector('[data-work-hours-date]');
    dateInput.value = '2026-11-27';
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    // Separate export button per person; no bulk export-all button.
    const exportButtons = doc.querySelectorAll('[data-export-timesheet]');
    assert.equal(exportButtons.length, 5);

    doc.querySelector('[data-export-timesheet="kagan_samet"]').click();
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].fileName, 'Puantaj_2026-11_Kağan-Samet.xlsx');

    const kaganBytes = new Uint8Array(await blobsByUrl.get(downloads[0].href).arrayBuffer());
    const rows = await readXlsxSheetRows(kaganBytes);

    assert.deepEqual(rows[0], ['Ad Soyad', 'Kağan Samet']);
    assert.deepEqual(rows[1], ['Ay', '2026-11']);
    assert.deepEqual(rows[3], ['Tarih', 'Gün', 'Saat']);

    // 30-day month: rows 4..33 are Nov 1..Nov 30, row 34 is Toplam.
    assert.equal(rows.length, 35);
    assert.deepEqual(rows[4], ['01.11.2026', 'Pazar', null]);       // empty day -> null
    assert.deepEqual(rows[5], ['02.11.2026', 'Pazartesi', 7.5]);   // 450 min -> 7.5 (Asaf's 8h excluded)
    assert.deepEqual(rows[6], ['03.11.2026', 'Salı', 0]);          // 0 min -> 0 (distinct from null)
    assert.notStrictEqual(rows[4][2], rows[6][2]);
    assert.deepEqual(rows[7], ['04.11.2026', 'Çarşamba', 1.5]);    // 90 min -> 1.5
    assert.deepEqual(rows[33], ['30.11.2026', 'Pazartesi', null]);
    assert.deepEqual(rows[34], ['Toplam', null, 9]);
});

test('B07 supports past month, empty month, February, Turkish filenames, and clear error when XLSX is missing', async (context) => {
    const { database, environment } = await createStaffFixture();

    await database.prepare(`
        INSERT INTO staff_work_hours (id, staff_key, work_date, minutes, created_at, updated_at)
        VALUES ('wh-feb-1', 'eyup', '2026-02-02', 390, '2026-02-02T17:00:00.000Z', '2026-02-02T17:00:00.000Z')
    `).run();

    const dom = new JSDOM(`
        <section id="staff-work-hours">
            <input type="date" data-work-hours-date />
            <span data-work-hours-display></span>
            <span data-work-hours-status></span>
            <p data-work-hours-holiday hidden></p>
            <div data-work-hours-table></div>
            <div data-work-hours-history></div>
        </section>
    `, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const doc = window.document;
    context.after(() => dom.window.close());

    const downloads = [];
    window.HTMLAnchorElement.prototype.click = function click() {
        downloads.push({ fileName: this.download, href: this.href });
    };
    const blobsByUrl = new Map();
    window.URL.createObjectURL = (blob) => {
        const url = `blob:https://portal.test/b07-${blobsByUrl.size + 1}`;
        blobsByUrl.set(url, blob);
        return url;
    };
    window.URL.revokeObjectURL = () => {};
    window.XLSX = createRealXlsxAdapter();

    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const request = new Request(`https://portal.test${url}`, {
            headers: { Cookie: `staff_session=${SESSION_TOKEN}` }
        });
        return worker.fetch(request, environment, {});
    };
    context.after(() => { globalThis.fetch = previousFetch; });

    initWorkHours(doc);
    await flushPromises();

    const dateInput = doc.querySelector('[data-work-hours-date]');
    const statusEl = doc.querySelector('[data-work-hours-status]');

    // 1. Past month + February (2026-02 has 28 days) + Turkish filename (Eyüp)
    dateInput.value = '2026-02-15';
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    doc.querySelector('[data-export-timesheet="eyup"]').click();
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].fileName, 'Puantaj_2026-02_Eyüp.xlsx');
    assert.match(statusEl.textContent, /19 hafta içi günü eksik/);

    const febRows = await readXlsxSheetRows(new Uint8Array(await blobsByUrl.get(downloads[0].href).arrayBuffer()));
    assert.equal(febRows.length, 33); // 4 header rows + 28 days + 1 total row
    assert.deepEqual(febRows[31], ['28.02.2026', 'Cumartesi', null]);
    assert.deepEqual(febRows[32], ['Toplam', null, 6.5]);

    // 2. Empty month + Turkish filename (Oğuz)
    dateInput.value = '2026-01-10';
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();

    doc.querySelector('[data-export-timesheet="oguz"]').click();
    assert.equal(downloads.length, 2);
    assert.equal(downloads[1].fileName, 'Puantaj_2026-01_Oğuz.xlsx');

    const emptyJanRows = await readXlsxSheetRows(new Uint8Array(await blobsByUrl.get(downloads[1].href).arrayBuffer()));
    assert.equal(emptyJanRows.length, 36); // 4 header rows + 31 days + 1 total row
    assert.deepEqual(emptyJanRows[35], ['Toplam', null, 0]);

    // 3. Missing XLSX library shows a clear Turkish error and does not trigger download
    window.XLSX = undefined;
    doc.querySelector('[data-export-timesheet="asaf"]').click();
    assert.equal(downloads.length, 2);
    assert.match(statusEl.textContent, /Excel kütüphanesi \(XLSX\) yüklenemedi/);
});
