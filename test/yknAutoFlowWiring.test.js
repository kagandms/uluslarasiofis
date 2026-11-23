/**
 * @fileoverview YKN otomatik zincir bağlama (Görev 2B) sözleşme ve davranış testleri.
 * `src/ui/passportCropperModal.js` dışa aktarımları, `src/managers/yknManager.js`
 * durum makinesi bağlantıları, açma/kapama anahtarı, `ykn:auto-run` olayı ve
 * kırmızı çizgi (YÖKSİS kaydet / Apply yazma yasağı) denetimlerini kapsar.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');

const yknManagerSource = await readFile(resolve(projectRoot, 'src/managers/yknManager.js'), 'utf8');
const cropperModalSource = await readFile(resolve(projectRoot, 'src/ui/passportCropperModal.js'), 'utf8');
const autoFlowSource = await readFile(resolve(projectRoot, 'src/managers/yknAutoFlow.js'), 'utf8');
const docGuardSource = await readFile(resolve(projectRoot, 'src/services/passportDocumentGuard.js'), 'utf8');
const faceCropSource = await readFile(resolve(projectRoot, 'src/services/passportFaceCrop.js'), 'utf8');

const ALLOWED_EXTENSION_ACTIONS = new Set([
    'PING',
    'SEARCH_STUDENT',
    'EXTRACT_KABUL_CODE',
    'TRANSFER_TO_YOKSIS',
    'COPY_APPLY_DATA',
    'FILL_YOKSIS_FORM',
    'READ_APPLY_DOCUMENT',
    'SAVE_CROPPED_PHOTO'
]);

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
            <input id="ykn-issue-date" />
            <input id="ykn-expiry-date" />
            <input id="ykn-birth-place" />
            <input id="ykn-issuing-authority" />
            <input id="ykn-mother-name" />
            <input id="ykn-father-name" />
            <input id="ykn-birth-date" />
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

/**
 * JSDOM tabanlı tarayıcı ortamı kurar ve test sonunda küresel değişkenleri geri yükler.
 *
 * @param {{ storageEntries?: Record<string, string>, throwingStorage?: boolean }} [options={}]
 */
function createDomEnvironment({ storageEntries = {}, throwingStorage = false } = {}) {
    const dom = new JSDOM(PORTAL_FIXTURE_HTML, { url: 'http://localhost:5173/yetkili/' });
    const { window } = dom;
    const postedMessages = [];
    const fetchCalls = [];
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

    const backingStore = new Map(Object.entries(storageEntries));
    const mockStorage = {
        getItem(key) {
            if (throwingStorage) throw new Error('storage disabled');
            return backingStore.has(key) ? backingStore.get(key) : null;
        },
        setItem(key, value) {
            if (throwingStorage) throw new Error('storage disabled');
            backingStore.set(key, String(value));
        },
        removeItem(key) {
            if (throwingStorage) throw new Error('storage disabled');
            backingStore.delete(key);
        }
    };
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: mockStorage
    });

    window.postMessage = (payload) => {
        postedMessages.push(payload);
    };
    window.HTMLAnchorElement.prototype.click = () => {};

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.CustomEvent = window.CustomEvent;
    globalThis.Event = window.Event;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.requestAnimationFrame = (cb) => cb();
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return {
            ok: true,
            async json() {
                return { downloadUrl: '/downloads/ykn-eklentisi-test.zip', version: '1.0.0' };
            }
        };
    };

    return {
        dom,
        window,
        document: window.document,
        Event: window.Event,
        CustomEvent: window.CustomEvent,
        backingStore,
        postedMessages,
        fetchCalls,
        sendExtensionMessage(data) {
            assert.equal(typeof window.__YKN_PORTAL_MSG_HANDLER__, 'function', 'message handler kayıtlı olmalı');
            window.__YKN_PORTAL_MSG_HANDLER__({
                source: window,
                data: {
                    source: 'EXTENSION',
                    ...data
                }
            });
        },
        cleanup() {
            for (const id of activeTimers) {
                origClearTimeout(id);
            }
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
// 1. Kaynak sözleşmesi testleri (2B.1 & 2B.2)
// ============================================================================

test('2B.1: yknManager.js scorePassportPageText işlevini passportPageScore modülünden içe aktarır ve özel kopyasını barındırmaz', () => {
    assert.match(yknManagerSource, /import\s*\{\s*scorePassportPageText\s*\}\s*from\s*['"]\.\.\/utils\/passportPageScore\.js['"]/);
    assert.doesNotMatch(yknManagerSource, /function\s+scorePassportPageText\s*\(/);
});

test('2B.2: yknManager.js 2A saf modüllerini içe aktarır ve zorunlu noktalara bağlar', () => {
    assert.match(yknManagerSource, /import\s*\{\s*createYknAutoFlow\s*\}\s*from\s*['"]\.\/yknAutoFlow\.js['"]/);
    assert.match(yknManagerSource, /import\s*\{\s*evaluatePassportPage\s*\}\s*from\s*['"]\.\.\/services\/passportDocumentGuard\.js['"]/);
    assert.match(yknManagerSource, /import\s*\{\s*detectFaceCrop\s*\}\s*from\s*['"]\.\.\/services\/passportFaceCrop\.js['"]/);

    assert.match(yknManagerSource, /ykn-auto-flow-v1/);
    assert.match(yknManagerSource, /autoFlow\.onSearchDone\(/);
    assert.match(yknManagerSource, /autoFlow\.onSearchDone\(\s*null\s*\)/);
    assert.match(yknManagerSource, /autoFlow\.onYoksisReady\(\)/);
    assert.match(yknManagerSource, /ykn:cropper-ready/);
    assert.match(yknManagerSource, /ykn:auto-run/);
    assert.match(yknManagerSource, /ykn:auto-flow-status/);
});

test('2B.2 & 2B.4: passportCropperModal.js gerekli işlevleri dışa aktarır ve ready() içinde ykn:cropper-ready yayınlar', () => {
    assert.match(cropperModalSource, /export\s+function\s+applyCropBox\s*\(/);
    assert.match(cropperModalSource, /export\s+function\s+submitCropperTransfer\s*\(/);
    assert.match(cropperModalSource, /export\s+function\s+setCropperDefaults\s*\(/);
    assert.match(cropperModalSource, /export\s+function\s+getCropperGender\s*\(/);
    assert.match(cropperModalSource, /ykn:cropper-ready/);
});

test('2B.6: Tek Tık akışı çalışırken otomatik zincir ve ykn:auto-run devreye girmez', () => {
    assert.match(
        yknManagerSource,
        /function\s+isOneClickRunning\s*\(\s*\)\s*\{\s*return\s+oneClickWorkflow\?\.status\s*===\s*['"]running['"];\s*\}/
    );
    // (1) Arama bitiş dalı: Tek Tık çalışıyorsa autoFlow atlanır, özgün dallar korunur
    assert.match(
        yknManagerSource,
        /if\s*\(\s*!isOneClickRunning\(\)\s*&&\s*\(\s*autoFlow\.isActive\(\)\s*\|\|\s*isAutoFlowEnabled\(\)\s*\)\s*\)[\s\S]*?else\s+if\s*\(\s*shouldAutoRunAcceptanceAfterSearch\s*\)[\s\S]*?else\s+if\s*\(\s*shouldAutoRunCopyAfterSearch\s*\)/
    );
    // (2) Kırpıcı hazır ve YÖKSİS hazır noktalarında Tek Tık koruması
    assert.match(
        yknManagerSource,
        /const\s+cropperReadyHandler\s*=\s*\(event\)\s*=>\s*\{\s*if\s*\(\s*isOneClickRunning\(\)\s*\)\s*\{\s*return;\s*\}[\s\S]*?autoFlow\.onCropperReady\(/
    );
    assert.match(
        yknManagerSource,
        /if\s*\(\s*!isOneClickRunning\(\)\s*\)\s*\{\s*autoFlow\.onYoksisReady\(\);\s*\}/
    );
    // (3) ykn:auto-run: Tek Tık çalışıyorsa başlatılmaz, durum mesajı ve olayı yayınlanır
    assert.match(
        yknManagerSource,
        /const\s+autoRunHandler\s*=\s*\(event\)\s*=>\s*\{[\s\S]*?if\s*\(\s*isOneClickRunning\(\)\s*\)\s*\{[\s\S]*?Tek Tık akışı sürüyor; Topi YKN zinciri başlatılmadı\.[\s\S]*?addStatus\([\s\S]*?['"]error['"][\s\S]*?ykn:auto-flow-status[\s\S]*?state:\s*['"]STOPPED['"][\s\S]*?level:\s*['"]error['"][\s\S]*?return;\s*\}/
    );
});

// ============================================================================
// 2. Kırpıcı modülü birim testleri (2B.4)
// ============================================================================

test('2B.4: passportCropperModal dışa aktarımları kırpma, varsayılan medeni hal, cinsiyet okuma ve ykn:cropper-ready olayını uygular', async () => {
    const env = createDomEnvironment();
    try {
        const cropperModule = await import('../src/ui/passportCropperModal.js');
        const {
            openPassportCropper,
            closePassportCropper,
            applyCropBox,
            submitCropperTransfer,
            setCropperDefaults,
            getCropperGender
        } = cropperModule;

        // Kırpıcı kapalıyken applyCropBox false döner
        assert.equal(applyCropBox({ x: 10, y: 20, width: 100, height: 133 }), false);

        const setDataCalls = [];
        let toBlobCalled = false;
        let readyEvents = [];
        let croppedEvents = [];

        env.window.addEventListener('ykn:cropper-ready', (e) => readyEvents.push(e.detail));
        env.window.addEventListener('ykn:photo-cropped', (e) => croppedEvents.push(e.detail));

        env.window.Cropper = class MockCropper {
            constructor(_image, options) {
                this.options = options;
                queueMicrotask(() => {
                    this.options.ready?.();
                });
            }
            getImageData() { return { rotate: 0 }; }
            rotateTo() {}
            setData(box) { setDataCalls.push(box); }
            getCroppedCanvas() {
                return {
                    toDataURL() { return 'data:image/jpeg;base64,MOCK'; },
                    toBlob(cb) {
                        toBlobCalled = true;
                        cb(new Blob(['mock'], { type: 'image/jpeg' }));
                    }
                };
            }
            destroy() {}
        };

        openPassportCropper({
            imageSrc: 'data:image/jpeg;base64,SRC',
            pages: [{ dataUrl: 'data:image/jpeg;base64,SRC', pageNumber: 1, text: 'P<TUR' }],
            initialPageIndex: 0,
            studentName: 'TEST OGRENCI',
            passportNo: 'AB12345',
            studentData: { cinsiyet: 'Kadın', medeniHali: '', genderSource: 'apply', maritalSource: 'unverified' }
        });

        await Promise.resolve();

        assert.equal(readyEvents.length, 1);
        assert.equal(readyEvents[0].pageIndex, 0);
        assert.equal(readyEvents[0].aspectRatio, 3 / 4);
        assert.equal(readyEvents[0].medeni, '');

        // getCropperGender mevcut cinsiyeti döner
        assert.equal(getCropperGender(), 'Kadın');

        // setCropperDefaults boş ve etkin medeni hali doldurur
        setCropperDefaults({ medeni: 'Bekar' });
        assert.equal(env.document.getElementById('cropper-select-medeni').value, 'Bekar');

        // Zaten doluysa üzerine yazmaz
        setCropperDefaults({ medeni: 'Evli' });
        assert.equal(env.document.getElementById('cropper-select-medeni').value, 'Bekar');

        // Disabled ise boş olsa bile yazmaz
        const medeniSelect = env.document.getElementById('cropper-select-medeni');
        medeniSelect.value = '';
        medeniSelect.disabled = true;
        setCropperDefaults({ medeni: 'Bekar' });
        assert.equal(medeniSelect.value, '');
        medeniSelect.disabled = false;

        // applyCropBox geçerli kutuyu setData'ya iletir
        assert.equal(applyCropBox({ x: 12, y: 24, width: 120, height: 160 }), true);
        assert.deepEqual(setDataCalls, [{ x: 12, y: 24, width: 120, height: 160 }]);
        assert.equal(applyCropBox({ x: 0, y: 0, width: 0, height: 100 }), false);

        // submitCropperTransfer yerel indirmeyi korur ve autoTransfer: true ile ykn:photo-cropped yayınlar
        submitCropperTransfer();
        assert.equal(toBlobCalled, true);
        assert.equal(croppedEvents.length, 1);
        assert.equal(croppedEvents[0].autoTransfer, true);

        closePassportCropper();
    } finally {
        env.cleanup();
    }
});

// ============================================================================
// 3. YKN Manager bağlama, anahtar ve olay testleri (2B.2 & 2B.5)
// ============================================================================

test('2B.2: Otomatik zincir anahtarı JS ile oluşturulur, varsayılan AÇIK olur ve localStorage ile saklanır', async () => {
    const env = createDomEnvironment();
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const toggle = env.document.querySelector('input[type="checkbox"]#ykn-auto-flow-toggle');
        assert.ok(toggle, 'Otomatik zincir onay kutusu oluşturulmalı');
        assert.equal(toggle.checked, true, 'Varsayılan durum açık olmalı');
        assert.match(toggle.parentElement.textContent, /Otomatik zincir/);

        toggle.checked = false;
        toggle.dispatchEvent(new env.Event('change'));
        assert.equal(env.backingStore.get('ykn-auto-flow-v1'), 'false');

        toggle.checked = true;
        toggle.dispatchEvent(new env.Event('change'));
        assert.equal(env.backingStore.get('ykn-auto-flow-v1'), 'true');
    } finally {
        env.cleanup();
    }
});

test('2B.2: localStorage hata fırlatsa bile initYknManager çökmez ve anahtar varsayılan açık kalır', async () => {
    const env = createDomEnvironment({ throwingStorage: true });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const toggle = env.document.querySelector('input[type="checkbox"]#ykn-auto-flow-toggle');
        assert.ok(toggle);
        assert.equal(toggle.checked, true);

        toggle.checked = false;
        assert.doesNotThrow(() => toggle.dispatchEvent(new env.Event('change')));
    } finally {
        env.cleanup();
    }
});

test('2B.2: Anahtar KAPALI iken arama bitince otomatik tıklama yapılmaz (bugünkü davranış korunur)', async () => {
    const env = createDomEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'false' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const toggle = env.document.getElementById('ykn-auto-flow-toggle');
        assert.equal(toggle.checked, false);

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnSearch = env.document.getElementById('btn-ykn-search');
        const btnReadAcceptance = env.document.getElementById('btn-read-acceptance');
        const btnCopy = env.document.getElementById('btn-copy');

        let acceptanceClicks = 0;
        let copyClicks = 0;
        btnReadAcceptance.addEventListener('click', () => { acceptanceClicks += 1; });
        btnCopy.addEventListener('click', () => { copyClicks += 1; });

        inputPassport.value = 'AB12345';
        btnSearch.click();

        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg, 'SEARCH_STUDENT gönderilmeli');
        const reqId = searchMsg.payload.requestId;

        env.sendExtensionMessage({ type: 'PONG', requestId: reqId });
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'TEST OGRENCI',
                passportNo: 'AB12345',
                yoksisId: '123-ABC-45',
                documentsReady: true
            }
        });

        assert.equal(acceptanceClicks, 0, 'Anahtar kapalıyken 1. adım otomatik tıklanmamalı');
        assert.equal(copyClicks, 0, 'Anahtar kapalıyken 2. adım otomatik tıklanmamalı');
    } finally {
        env.cleanup();
    }
});

test('2B.5: Anahtar AÇIK iken arama → kabul mektubu → YÖKSİS hazır → kopyala zinciri çift tetiklenmeden ilerler ve durum olayı yayınlar', async () => {
    const env = createDomEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'true' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnSearch = env.document.getElementById('btn-ykn-search');
        const btnReadAcceptance = env.document.getElementById('btn-read-acceptance');
        const btnCopy = env.document.getElementById('btn-copy');

        let acceptanceClicks = 0;
        let copyClicks = 0;
        const statusEvents = [];
        btnReadAcceptance.addEventListener('click', () => { acceptanceClicks += 1; });
        btnCopy.addEventListener('click', () => { copyClicks += 1; });
        env.window.addEventListener('ykn:auto-flow-status', (e) => statusEvents.push(e.detail));

        inputPassport.value = 'CD98765';
        btnSearch.click();

        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        const reqId = searchMsg.payload.requestId;

        env.sendExtensionMessage({ type: 'PONG', requestId: reqId });
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: reqId,
            data: {
                fullName: 'AYSE YILMAZ',
                passportNo: 'CD98765',
                yoksisId: '821-EC2-34',
                documentsReady: true
            }
        });

        assert.equal(acceptanceClicks, 1, '1. adım tam olarak bir kez tıklanmalı');

        const transferMsg = env.postedMessages.find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(transferMsg, 'TRANSFER_TO_YOKSIS gönderilmeli');

        env.sendExtensionMessage({
            type: 'RESPONSE',
            action: 'TRANSFER_TO_YOKSIS',
            requestId: transferMsg.payload.requestId,
            response: { success: true, formReady: true }
        });

        assert.equal(copyClicks, 1, 'YÖKSİS hazır olunca 2. adım tam olarak bir kez tıklanmalı');
        assert.ok(statusEvents.length >= 2, 'ykn:auto-flow-status olayları yayınlanmalı');
        assert.ok(statusEvents.every((ev) => typeof ev.state === 'string' && typeof ev.message === 'string' && typeof ev.level === 'string'));
    } finally {
        env.cleanup();
    }
});

test('2B.5: ykn:auto-run olayı anahtar KAPALI olsa bile zinciri zorla başlatır; geçersiz pasaport numarasını yok sayar', async () => {
    const env = createDomEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'false' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnReadAcceptance = env.document.getElementById('btn-read-acceptance');
        let acceptanceClicks = 0;
        btnReadAcceptance.addEventListener('click', () => { acceptanceClicks += 1; });

        // Geçersiz pasaportlar yok sayılır
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', { detail: { passportNo: 'a b' } }));
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', { detail: { passportNo: '123' } }));
        assert.equal(env.postedMessages.filter((m) => m?.payload?.action === 'SEARCH_STUDENT').length, 0);

        // Geçerli pasaport (küçük harf) büyük harfe çevrilir, input'a yazılır ve zorla başlatılır
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', { detail: { passportNo: 'ab99887' } }));
        assert.equal(inputPassport.value, 'AB99887');

        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg, 'ykn:auto-run aramayı başlatmalı');
        assert.equal(searchMsg.payload.passportNo, 'AB99887');

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: searchMsg.payload.requestId,
            data: {
                fullName: 'MEHMET KAYA',
                passportNo: 'AB99887',
                yoksisId: '555-AA1-22',
                documentsReady: true
            }
        });

        assert.equal(acceptanceClicks, 1, 'Anahtar kapalı olsa da ykn:auto-run ile 1. adım tetiklenmeli');
    } finally {
        env.cleanup();
    }
});

test('2B.5: Yeni pasaport yazıldığında veya öğrenci bulunamadığında aktif zincir iptal olur', async () => {
    const env = createDomEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'true' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnSearch = env.document.getElementById('btn-ykn-search');
        const btnCopy = env.document.getElementById('btn-copy');
        const statusEvents = [];
        let copyClicks = 0;

        btnCopy.addEventListener('click', () => { copyClicks += 1; });
        env.window.addEventListener('ykn:auto-flow-status', (e) => statusEvents.push(e.detail));

        // 1. Arama başlat ve ACCEPTANCE aşamasına geç
        inputPassport.value = 'ZZ11223';
        btnSearch.click();
        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: searchMsg.payload.requestId,
            data: {
                fullName: 'ZEYNEP DEMIR',
                passportNo: 'ZZ11223',
                yoksisId: '111-BB2-33',
                documentsReady: true
            }
        });
        const transferMsg = env.postedMessages.find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(transferMsg);

        // 2. Kullanıcı yeni pasaport yazıyor → zincir iptal olmalı
        inputPassport.value = 'YY99887';
        inputPassport.dispatchEvent(new env.Event('input'));

        assert.ok(
            statusEvents.some((ev) => ev.level === 'error' && /Yeni arama başlatıldı/.test(ev.message)),
            'Yeni pasaport yazıldığında iptal bildirimi yayınlanmalı'
        );

        // Eski TRANSFER_TO_YOKSIS yanıtı gelse bile 2. adım tetiklenmemeli
        env.sendExtensionMessage({
            type: 'RESPONSE',
            action: 'TRANSFER_TO_YOKSIS',
            requestId: transferMsg.payload.requestId,
            response: { success: true, formReady: true }
        });
        assert.equal(copyClicks, 0, 'İptal edilen zincirde 2. adım tıklanmamalı');

        // 3. Öğrenci bulunamadığında onSearchDone(null) çağrılmalı ve hata bildirilmeli
        const statusCountBefore = statusEvents.length;
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', { detail: { passportNo: 'XX00001' } }));
        const secondSearch = env.postedMessages.filter((m) => m?.payload?.action === 'SEARCH_STUDENT').at(-1);
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_NOT_FOUND',
            requestId: secondSearch.payload.requestId,
            error: 'Öğrenci bulunamadı'
        });

        const newErrorEvents = statusEvents.slice(statusCountBefore).filter((ev) => ev.level === 'error');
        assert.ok(newErrorEvents.length >= 1, 'STUDENT_NOT_FOUND durumunda zincir hata ile durmalı');
    } finally {
        env.cleanup();
    }
});

// ============================================================================
// 4. KIRMIZI ÇİZGİ (RED LINE) denetimi
// ============================================================================

test('KIRMIZI ÇİZGİ: Otomatik zincir yeni eklenti mesajı, YÖKSİS Kaydet tıklaması veya Apply isteği içermez', async () => {
    const newModules = [
        ['yknAutoFlow.js', autoFlowSource],
        ['passportDocumentGuard.js', docGuardSource],
        ['passportFaceCrop.js', faceCropSource],
        ['passportCropperModal.js', cropperModalSource]
    ];

    for (const [name, source] of newModules) {
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} içinde fetch çağrısı olmamalı`);
        assert.doesNotMatch(source, /postAppMessage|postExtensionRequest|chrome\.runtime\.sendMessage/, `${name} eklenti mesajı göndermemeli`);
        assert.doesNotMatch(source, /SUBMIT_YOKSIS|SAVE_YOKSIS|CLICK_YOKSIS_SAVE|yoksisSave/i, `${name} YÖKSİS kaydet/gönder içermemeli`);
    }

    // yknManager.js içindeki tüm postAppMessage / postExtensionRequest action adları mevcut izinli kümede kalmalı
    const actionMatches = [...yknManagerSource.matchAll(/action:\s*['"]([A-Z0-9_]+)['"]/g)].map((m) => m[1]);
    for (const action of actionMatches) {
        assert.ok(ALLOWED_EXTENSION_ACTIONS.has(action), `Beklenmeyen eklenti eylemi: ${action}`);
    }
    assert.doesNotMatch(yknManagerSource, /SUBMIT_YOKSIS|SAVE_YOKSIS|CLICK_YOKSIS_SAVE/i);

    // Çalışma zamanı doğrulaması: ykn:auto-run sırasında yalnız izinli eklenti mesajları gider ve Apply'a fetch atılmaz
    const env = createDomEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'true' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();
        env.fetchCalls.length = 0;

        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', { detail: { passportNo: 'RL12345' } }));
        for (const msg of env.postedMessages) {
            const action = msg?.payload?.action;
            if (action) {
                assert.ok(ALLOWED_EXTENSION_ACTIONS.has(action), `İzin dışı çalışma zamanı mesajı: ${action}`);
            }
        }
        assert.equal(env.fetchCalls.length, 0, 'Otomatik zincir Apply veya harici uç noktaya fetch atmamalı');
    } finally {
        env.cleanup();
    }
});
