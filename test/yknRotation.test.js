/**
 * @fileoverview YKN döndürülmüş pasaport sayfası uçtan uca JSDOM entegrasyon testi.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

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

test('yknManager rotates 90-degree passport page, reloads cropper upright, crops and submits without human step', async () => {
    const dom = new JSDOM(PORTAL_FIXTURE_HTML, { url: 'http://localhost:5173/yetkili/' });
    const { window } = dom;
    const postedMessages = [];
    const activeTimers = new Set();
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    const origGetContext = window.HTMLCanvasElement.prototype.getContext;
    const origToDataURL = window.HTMLCanvasElement.prototype.toDataURL;
    const origCreateObjectURL = globalThis.URL.createObjectURL;
    const origRevokeObjectURL = globalThis.URL.revokeObjectURL;

    const prevGlobals = {
        window: globalThis.window,
        document: globalThis.document,
        CustomEvent: globalThis.CustomEvent,
        Event: globalThis.Event,
        HTMLElement: globalThis.HTMLElement,
        Image: globalThis.Image,
        FaceDetector: globalThis.FaceDetector,
        OffscreenCanvas: globalThis.OffscreenCanvas,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        fetch: globalThis.fetch,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    };

    const SIDEWAYS_PAGE_URL = 'data:image/jpeg;base64,SIDEWAYS_PDF_PAGE';
    const UPRIGHT_PAGE_URL = 'data:image/jpeg;base64,UPRIGHT_ROTATED_PAGE';
    const toDataUrlCalls = [];
    const rotatedCanvases = [];
    const cropperReplaceCalls = [];
    const cropperSetDataCalls = [];
    const statusEvents = [];

    try {
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

        const backingStore = new Map([['ykn-auto-flow-v1', 'true']]);
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: (k) => (backingStore.has(k) ? backingStore.get(k) : null),
                setItem: (k, v) => backingStore.set(k, String(v)),
                removeItem: (k) => backingStore.delete(k)
            }
        });

        window.postMessage = (payload) => postedMessages.push(payload);
        window.HTMLAnchorElement.prototype.click = () => {};

        window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
            if (type !== '2d') return null;
            const canvasEl = this;
            return {
                translate() {},
                rotate(rad) {
                    const deg = Math.round((rad * 180) / Math.PI);
                    if (deg === 90) {
                        canvasEl.__rotated90 = true;
                        rotatedCanvases.push(canvasEl);
                    }
                },
                drawImage() {}
            };
        };
        window.HTMLCanvasElement.prototype.toDataURL = function toDataURL(mime, quality) {
            toDataUrlCalls.push({ mime, quality, rotated90: Boolean(this.__rotated90), width: this.width, height: this.height });
            if (this.__rotated90) {
                return UPRIGHT_PAGE_URL;
            }
            return SIDEWAYS_PAGE_URL;
        };

        window.pdfjsLib = {
            GlobalWorkerOptions: { workerSrc: '/pdfjs-support/mock/pdf.worker.mjs' },
            getDocument() {
                return {
                    promise: Promise.resolve({
                        numPages: 1,
                        async getPage() {
                            return {
                                async getTextContent() {
                                    return {
                                        items: [{
                                            str: 'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<\nROT123450EXM9001011M3001015<<<<<<<<<<<<<<04'
                                        }]
                                    };
                                },
                                getViewport({ scale }) {
                                    return { width: Math.round(875 * scale), height: Math.round(625 * scale) };
                                },
                                render() {
                                    return { promise: Promise.resolve() };
                                }
                            };
                        }
                    })
                };
            }
        };

        window.Cropper = class MockCropper {
            constructor(_image, options) {
                this.options = options;
                queueMicrotask(() => {
                    this.options.ready?.();
                });
            }
            getImageData() {
                return { rotate: 0 };
            }
            rotateTo() {}
            replace(src) {
                cropperReplaceCalls.push(src);
                queueMicrotask(() => {
                    this.options.ready?.();
                });
            }
            setData(box) {
                cropperSetDataCalls.push(box);
            }
            getCroppedCanvas() {
                return {
                    toDataURL: () => 'data:image/jpeg;base64,FINAL_CROPPED',
                    toBlob: (cb) => cb(new window.Blob(['ok'], { type: 'image/jpeg' }))
                };
            }
            destroy() {}
        };

        globalThis.Image = class FakeImage {
            set src(value) {
                this._src = value;
                if (value === UPRIGHT_PAGE_URL) {
                    this.width = 1000;
                    this.height = 1400;
                } else {
                    this.width = 1400;
                    this.height = 1000;
                }
                this.naturalWidth = this.width;
                this.naturalHeight = this.height;
                queueMicrotask(() => {
                    this.onload?.();
                });
            }
            get src() {
                return this._src;
            }
        };

        globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.rotations = [];
            }
            getContext(type) {
                if (type !== '2d') return null;
                return {
                    translate: () => {},
                    rotate: (rad) => {
                        this.rotations.push(Math.round((rad * 180) / Math.PI));
                    },
                    drawImage: () => {}
                };
            }
        };

        globalThis.FaceDetector = class FakeFaceDetector {
            async detect(source) {
                if (source instanceof globalThis.OffscreenCanvas && source.rotations.includes(90)) {
                    return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 }, score: 0.94 }];
                }
                if (source?._src === UPRIGHT_PAGE_URL) {
                    return [{ boundingBox: { x: 210, y: 310, width: 140, height: 180 }, score: 0.96 }];
                }
                return [];
            }
        };

        globalThis.URL.createObjectURL = () => 'blob:mock-download';
        globalThis.URL.revokeObjectURL = () => {};
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

        const { initYknManager } = await import('../src/managers/yknManager.js');
        initYknManager();

        window.addEventListener('ykn:auto-flow-status', (e) => statusEvents.push(e.detail));

        window.dispatchEvent(new window.CustomEvent('ykn:auto-run', { detail: { passportNo: 'ROT12345' } }));

        const searchMsg = postedMessages.find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg, 'SEARCH_STUDENT gönderilmeli');

        window.__YKN_PORTAL_MSG_HANDLER__({
            source: window,
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'STUDENT_DOCUMENTS_FOUND',
                requestId: searchMsg.payload.requestId,
                data: {
                    fullName: 'AHMET YILMAZ',
                    passportNo: 'ROT12345',
                    yoksisId: '821-EC2-34',
                    cinsiyet: 'Erkek',
                    medeniHali: 'Bekar',
                    genderSource: 'apply',
                    maritalSource: 'apply',
                    issueDate: '2022-01-01',
                    expiryDate: '2032-01-01',
                    birthPlace: 'ANKARA',
                    issuingAuthority: 'TURKEY',
                    passportDocumentUrl: 'https://apply.test/passport.pdf',
                    passportCandidates: ['https://apply.test/passport.pdf'],
                    documentsReady: true
                }
            }
        });

        const transferMsg = postedMessages.find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(transferMsg, 'TRANSFER_TO_YOKSIS gönderilmeli');

        window.__YKN_PORTAL_MSG_HANDLER__({
            source: window,
            data: {
                source: 'EXTENSION',
                type: 'RESPONSE',
                action: 'TRANSFER_TO_YOKSIS',
                requestId: transferMsg.payload.requestId,
                response: { success: true, formReady: true }
            }
        });

        window.__YKN_PORTAL_MSG_HANDLER__({
            source: window,
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'DOCUMENT_BYTES_READY',
                requestId: searchMsg.payload.requestId,
                data: {
                    documentKind: 'passport',
                    documentUrl: 'https://apply.test/passport.pdf',
                    contentType: 'application/pdf',
                    documentBase64: window.btoa('%PDF-1.4\nMOCK')
                }
            }
        });

        // Wait for async PDF render + cropper ready + face detection + rotation + re-detect + submit
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && !statusEvents.some((ev) => ev.state === 'DONE')) {
            await new Promise((resolve) => origSetTimeout(resolve, 10));
        }

        assert.ok(
            statusEvents.some((ev) => ev.level === 'info' && ev.message === 'Pasaport sayfası 90° döndürülüp düzeltildi.'),
            'Döndürme bilgi mesajı yayınlanmalı'
        );
        assert.ok(
            statusEvents.some((ev) => ev.state === 'DONE' && ev.level === 'success'),
            'Otomatik zincir başarıyla tamamlanmalı'
        );
        assert.deepEqual(cropperReplaceCalls, [UPRIGHT_PAGE_URL]);
        assert.equal(cropperSetDataCalls.length, 1);
        assert.ok(cropperSetDataCalls[0].x <= 210);
        assert.ok(cropperSetDataCalls[0].y <= 310);
        assert.ok(
            toDataUrlCalls.some((c) => c.rotated90 && c.mime === 'image/jpeg' && c.quality === 0.9),
            'Döndürülen sayfa JPEG 0.9 olarak kaydedilmeli'
        );
        assert.ok(
            rotatedCanvases.every((c) => c.width === 0 && c.height === 0),
            'Geçici döndürülmüş canvas serbest bırakılmalı'
        );
        assert.ok(
            postedMessages.some((m) => m?.payload?.action === 'FILL_YOKSIS_FORM'),
            'Kırpma sonrası FILL_YOKSIS_FORM gönderilmeli'
        );
    } finally {
        for (const id of activeTimers) {
            origClearTimeout(id);
        }
        activeTimers.clear();
        window.HTMLCanvasElement.prototype.getContext = origGetContext;
        window.HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        globalThis.URL.createObjectURL = origCreateObjectURL;
        globalThis.URL.revokeObjectURL = origRevokeObjectURL;
        globalThis.setTimeout = prevGlobals.setTimeout;
        globalThis.clearTimeout = prevGlobals.clearTimeout;
        globalThis.window = prevGlobals.window;
        globalThis.document = prevGlobals.document;
        globalThis.CustomEvent = prevGlobals.CustomEvent;
        globalThis.Event = prevGlobals.Event;
        globalThis.HTMLElement = prevGlobals.HTMLElement;
        globalThis.Image = prevGlobals.Image;
        globalThis.FaceDetector = prevGlobals.FaceDetector;
        globalThis.OffscreenCanvas = prevGlobals.OffscreenCanvas;
        globalThis.requestAnimationFrame = prevGlobals.requestAnimationFrame;
        globalThis.fetch = prevGlobals.fetch;
        dom.window.close();
    }
});
