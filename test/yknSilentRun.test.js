/**
 * @fileoverview Tests for silent YKN chain execution triggered from Topi (`ykn.run`),
 * silent flag lifecycle, reveal-on-error behavior, Tek Tık guard, and cropper overlay hiding.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');

const PORTAL_FIXTURE_HTML = `<!doctype html>
<html>
<body>
    <button type="button" data-workspace-view="ykn">YKN</button>
    <section id="view-ykn" hidden>
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
            <button type="button" id="btn-ykn-one-click" style="display:none">Tek Tık</button>
            <button type="button" id="btn-ykn-crop-photo" style="display:none">Kırp</button>
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
    </section>

    <div id="passport-cropper-modal" class="modal-overlay">
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

function createSilentTestEnvironment({ storageEntries = {}, detectedFaces = [] } = {}) {
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
        clearTimeout: globalThis.clearTimeout,
        Image: globalThis.Image,
        FaceDetector: globalThis.FaceDetector
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
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            getItem(key) {
                return backingStore.has(key) ? backingStore.get(key) : null;
            },
            setItem(key, value) {
                backingStore.set(key, String(value));
            },
            removeItem(key) {
                backingStore.delete(key);
            }
        }
    });

    window.postMessage = (payload) => {
        postedMessages.push(payload);
    };
    window.HTMLAnchorElement.prototype.click = () => {};

    const cropperSnapshots = [];
    window.Cropper = class MockCropper {
        constructor(_image, options) {
            this.options = options;
            const modal = window.document.getElementById('passport-cropper-modal');
            cropperSnapshots.push({
                hasShow: modal.classList.contains('show'),
                ariaHidden: modal.getAttribute('aria-hidden'),
                hasSilentClass: modal.classList.contains('is-ykn-silent'),
                docSilent: window.document.documentElement.dataset.yknSilent
            });
            queueMicrotask(() => {
                this.options.ready?.();
            });
        }
        getImageData() { return { rotate: 0 }; }
        rotateTo() {}
        setData() {}
        getCroppedCanvas() {
            return {
                toDataURL() { return 'data:image/jpeg;base64,MOCKCROPPED'; },
                toBlob(cb) {
                    cb(new globalThis.Blob(['mock'], { type: 'image/jpeg' }));
                }
            };
        }
        destroy() {}
    };

    globalThis.Image = class MockImage {
        set src(value) {
            this._src = value;
            this.width = 800;
            this.height = 600;
            this.naturalWidth = 800;
            this.naturalHeight = 600;
            queueMicrotask(() => {
                this.onload?.();
            });
        }
        get src() {
            return this._src || '';
        }
    };

    globalThis.FaceDetector = class MockFaceDetector {
        async detect() {
            return detectedFaces;
        }
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

    const statusEvents = [];
    window.addEventListener('ykn:auto-flow-status', (e) => statusEvents.push(e.detail));

    let yknNavClicks = 0;
    const yknNavButton = window.document.querySelector('button[data-workspace-view="ykn"]');
    yknNavButton.addEventListener('click', () => {
        yknNavClicks += 1;
        window.document.getElementById('view-ykn').hidden = false;
    });

    function waitForTerminalStatus(timeoutMs = 2000) {
        const existing = statusEvents.find((ev) => ev.state === 'DONE' || ev.state === 'STOPPED');
        if (existing) return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            const timer = origSetTimeout(() => {
                window.removeEventListener('ykn:auto-flow-status', onStatus);
                reject(new Error('Timed out waiting for terminal ykn:auto-flow-status'));
            }, timeoutMs);
            function onStatus(event) {
                const detail = event?.detail;
                if (detail?.state === 'DONE' || detail?.state === 'STOPPED') {
                    origClearTimeout(timer);
                    window.removeEventListener('ykn:auto-flow-status', onStatus);
                    resolve(detail);
                }
            }
            window.addEventListener('ykn:auto-flow-status', onStatus);
        });
    }

    return {
        window,
        document: window.document,
        Event: window.Event,
        CustomEvent: window.CustomEvent,
        postedMessages,
        statusEvents,
        cropperSnapshots,
        getYknNavClicks: () => yknNavClicks,
        waitForTerminalStatus,
        sendExtensionMessage(data) {
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
            globalThis.Image = prevGlobals.Image;
            globalThis.FaceDetector = prevGlobals.FaceDetector;
            dom.window.close();
        }
    };
}

test('contract: index.css visually hides #passport-cropper-modal while keeping layout, and main.js inits YKN at page load', async () => {
    const [cssSource, mainSource] = await Promise.all([
        readFile(resolve(projectRoot, 'src/index.css'), 'utf8'),
        readFile(resolve(projectRoot, 'src/staff/main.js'), 'utf8')
    ]);

    const cssWithoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
    const silentBlocks = cssWithoutComments.match(/[^{}]*(?:data-ykn-silent|\.is-ykn-silent)[^{}]*\{[^}]*\}/g) || [];
    assert.ok(silentBlocks.length > 0, 'index.css must define rule block(s) for data-ykn-silent or .is-ykn-silent');

    const joinedSilentBlocks = silentBlocks.join('\n');
    assert.match(joinedSilentBlocks, /html\[data-ykn-silent="true"\]\s+#passport-cropper-modal\.modal-overlay\.show/);
    assert.match(joinedSilentBlocks, /#passport-cropper-modal\.modal-overlay\.show\.is-ykn-silent/);

    for (const block of silentBlocks) {
        const bodyMatch = block.match(/\{([^}]*)\}/);
        const body = bodyMatch ? bodyMatch[1] : '';
        assert.match(body, /\bopacity\s*:\s*0\b/);
        assert.match(body, /\bpointer-events\s*:\s*none\b/);
        assert.doesNotMatch(body, /\bdisplay\s*:\s*none\b/i);
        assert.doesNotMatch(body, /\bvisibility\s*:\s*hidden\b/i);
        assert.doesNotMatch(body, /\bposition\s*:\s*(?:absolute|fixed)\b/i);
        assert.doesNotMatch(body, /\b(?:left|top|right|bottom)\s*:\s*-\d+/i);
    }

    const authIdx = mainSource.indexOf('if (!await staffAuthReady) return;');
    const yknInitIdx = mainSource.indexOf('initYknManager()');
    assert.ok(authIdx !== -1 && yknInitIdx > authIdx, 'initYknManager must run on DOMContentLoaded after staffAuthReady');
});

test('(b) silent run sets silent flag, keeps view-ykn hidden, hides cropper visually, and clears flag on DONE without navigating', async () => {
    const env = createSilentTestEnvironment({
        storageEntries: { 'ykn-auto-flow-v1': 'false' },
        detectedFaces: [{ boundingBox: { x: 120, y: 90, width: 140, height: 180 } }]
    });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
            detail: { passportNo: 'SL12345', silent: true }
        }));

        assert.equal(env.document.documentElement.dataset.yknSilent, 'true');
        assert.equal(env.getYknNavClicks(), 0);
        assert.equal(env.document.getElementById('view-ykn').hidden, true);

        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg);

        const terminalPromise = env.waitForTerminalStatus();

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: searchMsg.payload.requestId,
            data: {
                fullName: 'AYSE YILMAZ',
                passportNo: 'SL12345',
                yoksisId: '821-EC2-34',
                cinsiyet: 'Kadın',
                documentsReady: true,
                passportImageSrc: 'data:image/jpeg;base64,SRC',
                passportPages: [{ dataUrl: 'data:image/jpeg;base64,SRC', pageNumber: 1, text: 'P<TURYILMAZ<<AYSE<<<\nSL12345' }]
            }
        });

        const transferMsg = env.postedMessages.find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(transferMsg);
        env.sendExtensionMessage({
            type: 'RESPONSE',
            action: 'TRANSFER_TO_YOKSIS',
            requestId: transferMsg.payload.requestId,
            response: { success: true, formReady: true, yoksisTabId: 42, yoksisTabUrl: 'https://yoksis.yok.gov.tr/app' }
        });

        const terminalStatus = await terminalPromise;
        assert.equal(terminalStatus.state, 'DONE');
        assert.equal(terminalStatus.level, 'success');

        // Cropper opened silently hidden while silent run was active
        assert.equal(env.cropperSnapshots.length, 1);
        assert.deepEqual(env.cropperSnapshots[0], {
            hasShow: true,
            ariaHidden: 'true',
            hasSilentClass: true,
            docSilent: 'true'
        });

        // Flag cleared on DONE, no YKN navigation, FILL_YOKSIS_FORM dispatched
        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        assert.equal(env.document.documentElement.hasAttribute('data-ykn-silent'), false);
        assert.equal(env.getYknNavClicks(), 0);
        assert.equal(env.document.getElementById('view-ykn').hidden, true);
        assert.ok(env.postedMessages.some((m) => m?.payload?.action === 'FILL_YOKSIS_FORM'));

        const modal = env.document.getElementById('passport-cropper-modal');
        assert.equal(modal.classList.contains('show'), false);
        assert.equal(modal.hasAttribute('aria-hidden'), false);
        assert.equal(modal.classList.contains('is-ykn-silent'), false);
    } finally {
        env.cleanup();
    }
});

test('(b) silent run clears flag and clicks YKN nav button on STOPPED (search failure and cropper face error)', async () => {
    // 1. Search failure -> STOPPED
    {
        const env = createSilentTestEnvironment();
        try {
            const { initYknManager } = await import('../src/managers/yknManager.js');
            initYknManager();

            env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
                detail: { passportNo: 'NF12345', silent: true }
            }));
            assert.equal(env.document.documentElement.dataset.yknSilent, 'true');

            const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
            env.sendExtensionMessage({
                type: 'EVENT',
                action: 'STUDENT_NOT_FOUND',
                requestId: searchMsg.payload.requestId,
                error: 'Öğrenci bulunamadı'
            });

            assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
            assert.equal(env.getYknNavClicks(), 1);
            assert.equal(env.document.getElementById('view-ykn').hidden, false);
            assert.ok(env.statusEvents.some((ev) => ev.state === 'STOPPED' && ev.level === 'error'));
        } finally {
            env.cleanup();
        }
    }

    // 2. Cropper face error -> STOPPED reveals both YKN screen and open cropper
    {
        const env = createSilentTestEnvironment({ detectedFaces: [] });
        try {
            const { initYknManager } = await import('../src/managers/yknManager.js');
            initYknManager();

            env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
                detail: { passportNo: 'FC12345', silent: true }
            }));
            const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
            const terminalPromise = env.waitForTerminalStatus();

            env.sendExtensionMessage({
                type: 'EVENT',
                action: 'STUDENT_DOCUMENTS_FOUND',
                requestId: searchMsg.payload.requestId,
                data: {
                    fullName: 'MEHMET DEMIR',
                    passportNo: 'FC12345',
                    yoksisId: '555-AA1-22',
                    cinsiyet: 'Erkek',
                    documentsReady: true,
                    passportImageSrc: 'data:image/jpeg;base64,SRC',
                    passportPages: [{ dataUrl: 'data:image/jpeg;base64,SRC', pageNumber: 1, text: 'P<TURDEMIR<<MEHMET<<<\nFC12345' }]
                }
            });

            const transferMsg = env.postedMessages.find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
            env.sendExtensionMessage({
                type: 'RESPONSE',
                action: 'TRANSFER_TO_YOKSIS',
                requestId: transferMsg.payload.requestId,
                response: { success: true, formReady: true }
            });

            const terminalStatus = await terminalPromise;
            assert.equal(terminalStatus.state, 'STOPPED');
            assert.equal(terminalStatus.level, 'error');
            assert.match(terminalStatus.message, /elle kırpın/);

            assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
            assert.equal(env.getYknNavClicks(), 1);
            assert.equal(env.document.getElementById('view-ykn').hidden, false);

            // Cropper remains open so staff can crop manually, and is no longer hidden
            const modal = env.document.getElementById('passport-cropper-modal');
            assert.equal(modal.classList.contains('show'), true);
            assert.equal(modal.hasAttribute('aria-hidden'), false);
            assert.equal(modal.classList.contains('is-ykn-silent'), false);
        } finally {
            env.cleanup();
        }
    }
});

test('(b) silent flag is cleared on cancel and on ykn:cropper-closed', async () => {
    const env = createSilentTestEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'true' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        // Cancel via toggling auto-flow off
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
            detail: { passportNo: 'CN12345', silent: true }
        }));
        assert.equal(env.document.documentElement.dataset.yknSilent, 'true');

        const toggle = env.document.getElementById('ykn-auto-flow-toggle');
        toggle.checked = false;
        toggle.dispatchEvent(new env.Event('change'));

        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        assert.equal(env.getYknNavClicks(), 1);
        assert.ok(env.statusEvents.some((ev) => ev.state === 'STOPPED' && ev.level === 'error'));

        // Clear on ykn:cropper-closed
        const navClicksBefore = env.getYknNavClicks();
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
            detail: { passportNo: 'CC12345', silent: true }
        }));
        assert.equal(env.document.documentElement.dataset.yknSilent, 'true');

        env.window.dispatchEvent(new env.CustomEvent('ykn:cropper-closed'));
        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        assert.equal(env.getYknNavClicks(), navClicksBefore);
    } finally {
        env.cleanup();
    }
});

test('(c) non-silent auto-run leaves silent flag unset, clears stale flag, and does not click YKN nav on STOPPED', async () => {
    const env = createSilentTestEnvironment();
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        env.document.documentElement.dataset.yknSilent = 'true';
        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
            detail: { passportNo: 'NS12345' }
        }));

        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        const searchMsg = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg);
        assert.equal(searchMsg.payload.passportNo, 'NS12345');

        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_NOT_FOUND',
            requestId: searchMsg.payload.requestId,
            error: 'Öğrenci bulunamadı'
        });

        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        assert.equal(env.getYknNavClicks(), 0);
        assert.ok(env.statusEvents.some((ev) => ev.state === 'STOPPED' && ev.level === 'error'));
    } finally {
        env.cleanup();
    }
});

test('(d) one-click running refuses silent ykn:auto-run without setting silent flag or navigating', async () => {
    const env = createSilentTestEnvironment({ storageEntries: { 'ykn-auto-flow-v1': 'false' } });
    try {
        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        const inputPassport = env.document.getElementById('ykn-passport-input');
        const btnSearch = env.document.getElementById('btn-ykn-search');
        const btnOneClick = env.document.getElementById('btn-ykn-one-click');

        inputPassport.value = 'TK11111';
        btnSearch.click();

        const firstSearch = env.postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        env.sendExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: firstSearch.payload.requestId,
            data: {
                fullName: 'TEK TIK OGRENCI',
                passportNo: 'TK11111',
                yoksisId: '111-AA2-33',
                documentsReady: true
            }
        });

        btnOneClick.click();
        const searchesBefore = env.postedMessages.filter((m) => m?.payload?.action === 'SEARCH_STUDENT').length;

        env.window.dispatchEvent(new env.CustomEvent('ykn:auto-run', {
            detail: { passportNo: 'OC99999', silent: true }
        }));

        const searchesAfter = env.postedMessages.filter((m) => m?.payload?.action === 'SEARCH_STUDENT').length;
        assert.equal(searchesAfter, searchesBefore);
        assert.equal(env.document.documentElement.dataset.yknSilent, undefined);
        assert.equal(env.getYknNavClicks(), 0);
        assert.ok(env.statusEvents.some(
            (ev) => ev.state === 'STOPPED' && ev.level === 'error' && /Tek Tık akışı sürüyor/.test(ev.message)
        ));
    } finally {
        env.cleanup();
    }
});

test('(e) passportCropperModal overlay hide hook applies only while silent flag is set', async () => {
    const env = createSilentTestEnvironment();
    try {
        const {
            openPassportCropper,
            closePassportCropper,
            syncPassportCropperSilentState
        } = await import('../src/ui/passportCropperModal.js');

        const modal = env.document.getElementById('passport-cropper-modal');

        // Normal (non-silent) open keeps modal visible and accessible
        openPassportCropper({
            imageSrc: 'data:image/jpeg;base64,SRC',
            studentName: 'TEST',
            passportNo: 'MN12345'
        });
        await Promise.resolve();

        assert.equal(modal.classList.contains('show'), true);
        assert.equal(modal.hasAttribute('aria-hidden'), false);
        assert.equal(modal.classList.contains('is-ykn-silent'), false);

        // Toggling silent state while open applies and removes hook
        env.document.documentElement.dataset.yknSilent = 'true';
        syncPassportCropperSilentState();
        assert.equal(modal.getAttribute('aria-hidden'), 'true');
        assert.equal(modal.classList.contains('is-ykn-silent'), true);

        delete env.document.documentElement.dataset.yknSilent;
        syncPassportCropperSilentState();
        assert.equal(modal.hasAttribute('aria-hidden'), false);
        assert.equal(modal.classList.contains('is-ykn-silent'), false);

        closePassportCropper();

        // Opening while silent flag is already set hides immediately
        env.document.documentElement.dataset.yknSilent = 'true';
        openPassportCropper({
            imageSrc: 'data:image/jpeg;base64,SRC',
            studentName: 'TEST',
            passportNo: 'SL99999'
        });
        await Promise.resolve();

        assert.equal(modal.classList.contains('show'), true);
        assert.equal(modal.getAttribute('aria-hidden'), 'true');
        assert.equal(modal.classList.contains('is-ykn-silent'), true);

        closePassportCropper();
        assert.equal(modal.classList.contains('show'), false);
        assert.equal(modal.hasAttribute('aria-hidden'), false);
        assert.equal(modal.classList.contains('is-ykn-silent'), false);
    } finally {
        env.cleanup();
    }
});
