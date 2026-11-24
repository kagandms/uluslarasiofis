import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    extractAfghanIdNumber,
    extractPassportMetadata
} from '../src/utils/ykn-document-parser.js';

const AFGHAN_AUTHORITY = 'KABUL CENTRAL PASSPORT DEPARTMENT (MOI)';
const MOCK_PDF_BASE64 = Buffer.from('%PDF-1.4\n').toString('base64');

const PORTAL_FIXTURE_HTML = `<!doctype html>
<html>
<body>
    <div id="toast-container"></div>
    <div id="ykn-extension-status" hidden>
        <div id="ykn-extension-status-title"></div>
        <div id="ykn-extension-status-message"></div>
        <a id="btn-ykn-extension-download" href="#"></a>
        <button id="btn-ykn-extension-recheck" type="button"></button>
    </div>
    <div class="form-group ykn-search-row">
        <input type="text" id="ykn-passport-input" />
        <button type="button" id="btn-ykn-search">Ara</button>
    </div>
    <div id="ykn-student-result" style="display:none">
        <h4 id="ykn-student-name"></h4>
        <div id="ykn-fields-panel" style="display:none">
            <span id="ykn-missing-badge"></span>
            <div id="ykn-missing-alert"></div>
            <input id="ykn-issue-date" /><span id="badge-issue-date"></span>
            <input id="ykn-expiry-date" /><span id="badge-expiry-date"></span>
            <input id="ykn-birth-place" /><span id="badge-birth-place"></span>
            <input id="ykn-issuing-authority" /><span id="badge-issuing-authority"></span>
            <input id="ykn-mother-name" />
            <input id="ykn-father-name" />
            <input id="ykn-birth-date" />
            <button type="button" id="btn-sync-yoksis-fields"></button>
            <input type="radio" name="ykn-cinsiyet" id="ykn-cinsiyet-erkek" value="Erkek" />
            <input type="radio" name="ykn-cinsiyet" id="ykn-cinsiyet-kadin" value="Kadın" />
            <input type="radio" name="ykn-medeni-hal" id="ykn-medeni-bekar" value="Bekar" />
            <input type="radio" name="ykn-medeni-hal" id="ykn-medeni-evli" value="Evli" />
        </div>
        <div id="ykn-pro-actions" style="display:none">
            <button type="button" id="btn-read-acceptance">1. Kabul Mektubu</button>
            <button type="button" id="btn-copy">2. Bilgileri Al</button>
        </div>
        <div id="ykn-steps-container">
            <span id="ykn-step-indicator"></span>
            <button type="button" id="btn-ykn-copy-letter"></button>
            <button type="button" id="btn-ykn-transfer-yoksis"></button>
            <button type="button" id="btn-ykn-copy-info"></button>
            <button type="button" id="btn-ykn-paste-yoksis"></button>
        </div>
    </div>
    <div id="ykn-status-container">
        <div id="ykn-status-empty"></div>
    </div>
    <span id="ykn-status-count"></span>

    <div id="passport-cropper-modal">
        <img id="passport-cropper-image" />
        <input id="passport-rotation-slider" type="range" value="0" />
        <span id="passport-rotation-angle-label">0°</span>
        <button id="btn-passport-rotate-left" type="button"></button>
        <button id="btn-passport-rotate-right" type="button"></button>
        <button id="btn-passport-fine-minus" type="button"></button>
        <button id="btn-passport-fine-plus" type="button"></button>
        <button id="btn-passport-aspect-ratio" type="button"></button>
        <button id="btn-passport-crop-download" type="button"></button>
        <button id="btn-passport-crop-transfer" type="button"></button>
        <button id="btn-passport-crop-cancel" type="button"></button>
        <button id="btn-passport-crop-close" type="button"></button>
        <div id="passport-page-selector"></div>
        <div id="passport-source-selector">
            <select id="passport-source-select"></select>
        </div>
        <span id="passport-page-info"></span>
        <button id="btn-passport-prev-page" type="button"></button>
        <button id="btn-passport-next-page" type="button"></button>
        <div id="cropper-missing-fields-box">
            <input id="cropper-input-issue-date" />
            <input id="cropper-input-expiry-date" />
            <input id="cropper-input-authority" />
            <select id="cropper-select-gender">
                <option value="">Seçin</option>
                <option value="Erkek">Erkek</option>
                <option value="Kadın">Kadın</option>
            </select>
            <select id="cropper-select-medeni">
                <option value="">Seçin</option>
                <option value="Bekar">Bekar</option>
                <option value="Evli">Evli</option>
            </select>
        </div>
    </div>
</body>
</html>`;

function createManagerHarness(mockPdfText = '') {
    const dom = new JSDOM(PORTAL_FIXTURE_HTML, { url: 'http://localhost:5173/yetkili/' });
    const { window } = dom;
    const postedMessages = [];
    const activeTimers = new Set();

    const prevGlobals = {
        window: globalThis.window,
        document: globalThis.document,
        CustomEvent: globalThis.CustomEvent,
        Event: globalThis.Event,
        HTMLElement: globalThis.HTMLElement,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        fetch: globalThis.fetch,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    };

    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;

    globalThis.setTimeout = (fn, ms, ...args) => {
        const id = origSetTimeout(() => {
            activeTimers.delete(id);
            fn(...args);
        }, ms);
        if (typeof id?.unref === 'function') id.unref();
        activeTimers.add(id);
        return id;
    };
    globalThis.clearTimeout = (id) => {
        activeTimers.delete(id);
        return origClearTimeout(id);
    };

    const backingStore = new Map([['ykn-auto-flow-v1', 'false']]);
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key) => (backingStore.has(key) ? backingStore.get(key) : null),
            setItem: (key, value) => backingStore.set(key, String(value)),
            removeItem: (key) => backingStore.delete(key)
        }
    });

    Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => {} }
    });

    window.HTMLCanvasElement.prototype.getContext = () => ({});
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,MOCK';

    window.pdfjsLib = {
        GlobalWorkerOptions: { workerSrc: '/pdfjs-support/worker.js' },
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getTextContent: async () => ({ items: [{ str: mockPdfText }] }),
                    getViewport: () => ({ width: 100, height: 100 }),
                    render: () => ({ promise: Promise.resolve() })
                })
            })
        })
    };

    window.postMessage = (payload) => {
        postedMessages.push(payload);
    };

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.CustomEvent = window.CustomEvent;
    globalThis.Event = window.Event;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.fetch = async () => ({
        ok: true,
        async json() {
            return { downloadUrl: '/downloads/ykn-eklentisi-test.zip', version: '1.0.0' };
        }
    });

    return {
        dom,
        window,
        document: window.document,
        postedMessages,
        sendExtensionMessage(data) {
            window.__YKN_PORTAL_MSG_HANDLER__({
                source: window,
                data: { source: 'EXTENSION', ...data }
            });
        },
        async waitFor(predicate, timeoutMs = 1000) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (predicate()) return;
                await new Promise((resolve) => origSetTimeout(resolve, 10));
            }
            throw new Error('Timed out waiting for condition');
        },
        syncAndReadStudentData() {
            const beforeLen = postedMessages.length;
            window.document.getElementById('btn-sync-yoksis-fields').click();
            const msg = postedMessages.slice(beforeLen).find((m) => m?.payload?.action === 'FILL_YOKSIS_FORM');
            return msg?.payload?.data || null;
        },
        cleanup() {
            for (const id of activeTimers) origClearTimeout(id);
            activeTimers.clear();
            globalThis.setTimeout = prevGlobals.setTimeout;
            globalThis.clearTimeout = prevGlobals.clearTimeout;
            globalThis.window = prevGlobals.window;
            globalThis.document = prevGlobals.document;
            globalThis.CustomEvent = prevGlobals.CustomEvent;
            globalThis.Event = prevGlobals.Event;
            globalThis.HTMLElement = prevGlobals.HTMLElement;
            globalThis.requestAnimationFrame = prevGlobals.requestAnimationFrame;
            globalThis.fetch = prevGlobals.fetch;
            dom.window.close();
        }
    };
}

// ============================================================================
// 1. isAfghanStudent detection
// ============================================================================

test('isAfghanStudent matches Afghan nationalities and whole-word AFG, rejecting PAKISTAN and AFRICA', async () => {
    const env = createManagerHarness();
    try {
        const { isAfghanStudent } = await import('../src/managers/yknManager.js');

        assert.equal(isAfghanStudent({ uyruk: 'AFGANİSTAN' }), true);
        assert.equal(isAfghanStudent({ uyruk: 'AFGHANISTAN' }), true);
        assert.equal(isAfghanStudent({ uyruk: 'AFG' }), true);
        assert.equal(isAfghanStudent({ dogumUlkesi: 'Afganistan' }), true);
        assert.equal(isAfghanStudent({ uyruk: 'Afğanistan' }), true);
        assert.equal(isAfghanStudent({ uyruk: 'Nationality: AFG' }), true);

        assert.equal(isAfghanStudent({ uyruk: 'PAKISTAN' }), false);
        assert.equal(isAfghanStudent({ uyruk: 'AFRICA' }), false);
        assert.equal(isAfghanStudent({ dogumUlkesi: 'SOUTH AFRICA' }), false);
        assert.equal(isAfghanStudent({ uyruk: 'TÜRKMENİSTAN' }), false);
        assert.equal(isAfghanStudent(null), false);
        assert.equal(isAfghanStudent({}), false);
    } finally {
        env.cleanup();
    }
});

// ============================================================================
// 2. extractAfghanIdNumber & extractPassportMetadata
// ============================================================================

test('extractAfghanIdNumber handles realistic OCR variants and rejects non-Afghan text', () => {
    // Label and value on one line
    assert.equal(
        extractAfghanIdNumber('ISLAMIC REPUBLIC OF AFGHANISTAN\nPASSPORT\nID No.: 1399-0102-12345'),
        '1399-0102-12345'
    );
    assert.equal(
        extractAfghanIdNumber('AFGHANISTAN\nID Number: ab-123456'),
        'AB-123456'
    );
    assert.equal(
        extractAfghanIdNumber('AFGHANISTAN\nID №: 98765432'),
        '98765432'
    );

    // Value on the next non-empty line
    assert.equal(
        extractAfghanIdNumber('P<AFGKHAN<<AHMAD<<<<<<<<<<<<<<<<<<<<<<<<<<<<\nID No.\n\n1400-0500-67890'),
        '1400-0500-67890'
    );

    // OCR noise in label: 1D NO, lD N0, spaces inside number, no auto-fix of O->0
    assert.equal(
        extractAfghanIdNumber('AFGHANISTAN\n1D NO: 1399 0102 12345'),
        '1399010212345'
    );
    assert.equal(
        extractAfghanIdNumber('AFGHANISTAN\nlD N0. 1399O10212345'),
        '1399O10212345'
    );

    // Missing label fallback: 8-16 digit token within 3 lines after ISSUING AUTHORITY or KABUL CENTRAL
    assert.equal(
        extractAfghanIdNumber([
            'PASSPORT',
            'Issuing Authority: KABUL CENTRAL PASSPORT DEPARTMENT (MOI)',
            '1399010212345',
            'Date of Issue: 12 MAR 2023'
        ].join('\n')),
        '1399010212345'
    );
    assert.equal(
        extractAfghanIdNumber([
            'PASSPORT',
            'ISSUING AUTHORITY',
            'KABUL CENTRAL',
            '9876543210'
        ].join('\n')),
        '9876543210'
    );

    // Non-Afghan text must return ''
    assert.equal(
        extractAfghanIdNumber('PAKISTAN\nID No: 1234567890'),
        ''
    );
    assert.equal(
        extractAfghanIdNumber('REPUBLIC OF TURKEY\nIssuing Authority: NVI\n1234567890'),
        ''
    );
    assert.equal(
        extractAfghanIdNumber('Nationality: IRAN\nPlace of Birth: KABUL\nID No: 12345678'),
        ''
    );
});

test('extractPassportMetadata prefers Afghan ID number over MRZ personal number', () => {
    const afghanWithBoth = [
        'ISLAMIC REPUBLIC OF AFGHANISTAN',
        'Issuing Authority: KABUL CENTRAL PASSPORT DEPARTMENT (MOI)',
        'ID No: 1399-0102-12345',
        'P<AFGAHMADI<<ALI<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
        'OA12345678AFG0101011M3001012999888777<<<<<02'
    ].join('\n');

    const meta = extractPassportMetadata(afghanWithBoth);
    assert.equal(meta.uyrukKimlikNo, '1399-0102-12345');
});

// ============================================================================
// 3. Authority defaults & birth place wiring in yknManager
// ============================================================================

test('Afghan student gets fixed authority and ID number', async () => {
    const afghanPdfText = [
        'ISLAMIC REPUBLIC OF AFGHANISTAN PASSPORT',
        'Place of birth: KABUL',
        'Authority: PASSPORT DEPARTMENT',
        'ID No: 1399-0102-12345',
        'Date of issue: 10.03.2022',
        'Date of expiry: 10.03.2027'
    ].join('\n');

    const env = createManagerHarness(afghanPdfText);
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnSearch = env.document.getElementById('btn-ykn-search');
        inputPassport.value = 'OA1234567';
        btnSearch.click();

        const reqId = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/afg-pass.pdf';
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'ALI AHMADI',
                passportNo: 'OA1234567',
                uyruk: 'AFGANİSTAN',
                dogumUlkesi: 'AFGANİSTAN',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        assert.equal(env.document.getElementById('ykn-issuing-authority').value, AFGHAN_AUTHORITY);

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await env.waitFor(() => env.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = env.syncAndReadStudentData();
        assert.equal(synced.verenMakam, AFGHAN_AUTHORITY);
        assert.equal(synced.issuingAuthority, AFGHAN_AUTHORITY);
        assert.equal(env.document.getElementById('ykn-issuing-authority').value, AFGHAN_AUTHORITY);
        assert.equal(synced.uyrukKimlikNo, '1399-0102-12345');
        assert.equal(synced.birthPlace, 'KABUL');
    } finally {
        env.cleanup();
    }
});

test('existing uyrukKimlikNo on student is not cleared when passport PDF has no ID number', async () => {
    const afghanNoIdPdfText = [
        'ISLAMIC REPUBLIC OF AFGHANISTAN PASSPORT',
        'Place of birth: KABUL',
        'Authority: PASSPORT DEPARTMENT',
        'Date of issue: 10.03.2022',
        'Date of expiry: 10.03.2027'
    ].join('\n');

    const env = createManagerHarness(afghanNoIdPdfText);
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        env.document.getElementById('ykn-passport-input').value = 'OA9998887';
        env.document.getElementById('btn-ykn-search').click();

        const reqId = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/afg-noid.pdf';
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'FARHAD NOORI',
                passportNo: 'OA9998887',
                uyruk: 'AFG',
                uyrukKimlikNo: 'MANUAL-12345',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await env.waitFor(() => env.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = env.syncAndReadStudentData();
        assert.equal(synced.uyrukKimlikNo, 'MANUAL-12345');
        assert.equal(synced.verenMakam, AFGHAN_AUTHORITY);
    } finally {
        env.cleanup();
    }
});

test('Afghan Arabic-only birth place stays empty for manual entry with status notice', async () => {
    const afghanArabicPdfText = [
        'ISLAMIC REPUBLIC OF AFGHANISTAN PASSPORT',
        'Place of birth: شبرغان',
        'Issuing Authority: KABUL CENTRAL PASSPORT DEPARTMENT (MOI)',
        'ID No: 1400-0203-55555',
        'Date of issue: 10.03.2022',
        'Date of expiry: 10.03.2027'
    ].join('\n');

    const env = createManagerHarness(afghanArabicPdfText);
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        env.document.getElementById('ykn-passport-input').value = 'OA7654321';
        env.document.getElementById('btn-ykn-search').click();

        const reqId = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/afg-arabic.pdf';
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'REZA KARIMI',
                passportNo: 'OA7654321',
                uyruk: 'AFGHANISTAN',
                dogumUlkesi: 'AFGHANISTAN',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await env.waitFor(() => env.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = env.syncAndReadStudentData();
        const bpInput = env.document.getElementById('ykn-birth-place');
        assert.equal(bpInput.value, '');
        assert.ok(
            bpInput.style.borderColor === 'rgb(243, 156, 18)' || bpInput.style.borderColor.toLowerCase() === '#f39c12',
            `Expected orange warning border on missing birth place input, got: ${bpInput.style.borderColor}`
        );
        assert.equal(env.document.getElementById('badge-birth-place').textContent, '⚠️ Eksik');
        assert.equal(synced.birthPlace || '', '');
        assert.equal(synced.dogumYeriAciklamasi || '', '');
        assert.match(env.document.getElementById('ykn-status-container').textContent, /Doğum yeri Latin harflerle elle yazılmalı\./);
        assert.match(env.document.getElementById('ykn-missing-alert').textContent, /Doğum Yeri/);
        assert.equal(synced.verenMakam, AFGHAN_AUTHORITY);
    } finally {
        env.cleanup();
    }
});

test('Russian student birth place is transliterated to Latin when stored', async () => {
    const russianPdfText = [
        'RUSSIAN FEDERATION PASSPORT',
        'Place of birth: ЩЁЛКОВО',
        'Authority: MIA OF RUSSIA',
        'Date of issue: 15.05.2022',
        'Date of expiry: 15.05.2032'
    ].join('\n');

    const env = createManagerHarness(russianPdfText);
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        env.document.getElementById('ykn-passport-input').value = '751234567';
        env.document.getElementById('btn-ykn-search').click();

        const reqId = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/rus-pass.pdf';
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'IVAN PETROV',
                passportNo: '751234567',
                uyruk: 'RUSYA',
                dogumUlkesi: 'RUSYA',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await env.waitFor(() => env.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = env.syncAndReadStudentData();
        assert.equal(env.document.getElementById('ykn-birth-place').value, 'SHCHELKOVO');
        assert.equal(synced.birthPlace, 'SHCHELKOVO');
        assert.equal(synced.dogumYeri, 'SHCHELKOVO');
        assert.equal(synced.dogumYeriAciklamasi, 'SHCHELKOVO');
    } finally {
        env.cleanup();
    }
});

test('Turkmen (TKM/SMST) and Pakistani (PAKISTAN) rules still win unchanged', async () => {
    const turkmenEnv = createManagerHarness([
        'TURKMENISTAN PASSPORT',
        'Place of birth: АШХАБАД',
        'Authority: STATE MIGRATION SERVICE',
        'Date of issue: 01.02.2023',
        'Date of expiry: 01.02.2033'
    ].join('\n'));
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        turkmenEnv.document.getElementById('ykn-passport-input').value = 'A1234567';
        turkmenEnv.document.getElementById('btn-ykn-search').click();

        const reqId = turkmenEnv.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/tkm-pass.pdf';
        turkmenEnv.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'MERDAN DURDY',
                passportNo: 'A1234567',
                uyruk: 'TÜRKMENİSTAN',
                dogumUlkesi: 'TÜRKMENİSTAN',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        turkmenEnv.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await turkmenEnv.waitFor(() => turkmenEnv.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = turkmenEnv.syncAndReadStudentData();
        assert.equal(synced.birthPlace, 'TKM');
        assert.equal(synced.dogumYeriAciklamasi, 'TKM');
        assert.equal(synced.verenMakam, 'SMST');
        assert.equal(synced.issuingAuthority, 'SMST');
    } finally {
        turkmenEnv.cleanup();
    }

    const pakEnv = createManagerHarness([
        'ISLAMIC REPUBLIC OF PAKISTAN PASSPORT',
        'Place of birth: PAKISTAN',
        'Authority: DGIP',
        'Date of issue: 01.02.2023',
        'Date of expiry: 01.02.2033'
    ].join('\n'));
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        pakEnv.document.getElementById('ykn-passport-input').value = 'PK1234567';
        pakEnv.document.getElementById('btn-ykn-search').click();

        const reqId = pakEnv.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT').payload.requestId;
        const passUrl = 'https://apply.example/pak-pass.pdf';
        pakEnv.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'TARIQ KHAN',
                passportNo: 'PK1234567',
                uyruk: 'PAKİSTAN',
                dogumUlkesi: 'PAKISTAN',
                passportDocumentUrl: passUrl,
                documentsReady: true
            }
        });

        pakEnv.sendExtensionMessage({
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: reqId,
            data: {
                documentKind: 'passport',
                documentUrl: passUrl,
                contentType: 'application/pdf',
                documentBase64: MOCK_PDF_BASE64
            }
        });

        await pakEnv.waitFor(() => pakEnv.document.getElementById('ykn-status-container').textContent.includes('Pasaport bilgileri okundu'));

        const synced = pakEnv.syncAndReadStudentData();
        assert.equal(pakEnv.document.getElementById('ykn-birth-place').value, 'PAKISTAN');
        assert.equal(synced.dogumYeriAciklamasi, 'PAKISTAN');
        assert.equal(synced.verenMakam, 'PAKISTAN');
        assert.equal(synced.issuingAuthority, 'PAKISTAN');
    } finally {
        pakEnv.cleanup();
    }
});
