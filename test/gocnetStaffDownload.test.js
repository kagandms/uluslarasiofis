import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';

async function createSamplePdfBytes() {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    return doc.save();
}

async function waitForSelector(root, selector, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const element = root.querySelector(selector);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${selector}`);
}

function setupDomEnvironment() {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: 'https://staff.example.test/applications'
    });
    const prevWindow = globalThis.window;
    const prevDocument = globalThis.document;
    Object.defineProperty(dom.window, 'crypto', { value: globalThis.crypto, configurable: true });
    dom.window.scrollTo = () => {};
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
    dom.window.pdfjsLib = {
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getTextContent: async () => ({ items: [{ str: 'Kayıt Numarası: 2026-12-1234567' }] }),
                    getViewport: () => ({ width: 100, height: 100 }),
                    render: () => ({ promise: Promise.resolve() })
                })
            }),
            destroy: async () => {}
        })
    };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    return {
        dom,
        root: dom.window.document.getElementById('root'),
        cleanup() {
            globalThis.window = prevWindow;
            globalThis.document = prevDocument;
            dom.window.close();
        }
    };
}

function createMockApi(applicationItem, pdfBytes) {
    return {
        async queryApplications() {
            return {
                items: [applicationItem],
                pagination: { page: 1, total_pages: 1, total_items: 1 }
            };
        },
        async readApplicationDetail() {
            return {
                application: applicationItem,
                documents: [{
                    code: 'residence_application_form',
                    required: true,
                    access_available: true,
                    revision_number: 1,
                    scan_status: 'clean'
                }]
            };
        },
        async createArchiveManifest() {
            return {
                files: [{
                    code: 'residence_application_form',
                    expected_revision_number: 1,
                    object_identity: 'a'.repeat(64),
                    media_type: 'application/pdf',
                    byte_size: pdfBytes.byteLength,
                    entry_name: '01-residence_application_form.pdf'
                }]
            };
        },
        async readArchiveFile() {
            return {
                ok: true,
                body: true,
                blob: async () => new Blob([pdfBytes], { type: 'application/pdf' })
            };
        },
        async createGocnetAttempt() {
            return { attemptId: 'attempt-1' };
        },
        async recordGocnetEvent() {
            return { ok: true };
        }
    };
}

test('clicking GöçNet transfer downloads isim_soyisim_pasaportno.pdf and hands identical bytes to extension', async () => {
    const pdfBytes = await createSamplePdfBytes();
    const env = setupDomEnvironment();
    const downloads = [];
    const uploadedPayloads = [];
    const applicationItem = {
        id: 'app-1',
        status: 'approved_for_processing',
        submitted_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
        student_number: '20260001',
        first_name: 'Çağrı',
        last_name: 'Yılmaz',
        passport_number: 'P12345',
        phone: '+905321234567'
    };

    const originalPostMessage = env.dom.window.postMessage.bind(env.dom.window);
    env.dom.window.postMessage = (message, targetOrigin) => {
        if (message?.source === 'WEB_APP' && message.payload) {
            const { action, requestId, phase } = message.payload;
            let response = { state: 'unknown' };
            if (action === 'CHECK_GOCNET_TRANSFER' && phase === 'history') {
                response = { state: 'no_match', yoksisTabId: 42 };
            } else if (action === 'CHECK_GOCNET_TRANSFER' && phase === 'form') {
                response = { state: 'student_data_filled', yoksisTabId: 42 };
            } else if (action === 'SAVE_GOCNET_RECORD') {
                response = { state: 'saved', recordId: '987654' };
            } else if (action === 'ACK_GOCNET_SAVE') {
                response = { success: true };
            } else if (action === 'UPLOAD_GOCNET_DOCUMENT') {
                uploadedPayloads.push(message.payload);
                response = { state: 'uploaded', documentId: '112233' };
            } else if (action === 'ACK_GOCNET_UPLOAD') {
                response = { success: true };
            }
            queueMicrotask(() => {
                env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
                    source: env.dom.window,
                    origin: env.dom.window.location.origin,
                    data: { source: 'EXTENSION', type: 'RESPONSE', action, requestId, response }
                }));
            });
            return;
        }
        originalPostMessage(message, targetOrigin);
    };

    try {
        initializeStaffApplicationsManager(env.root, createMockApi(applicationItem, pdfBytes), {
            downloadPdfFile(file, filename) {
                downloads.push({ file, filename });
            }
        });
        env.dom.window.document.dispatchEvent(new env.dom.window.CustomEvent('workspace:view-changed', {
            detail: { viewName: 'applications' }
        }));

        const button = await waitForSelector(env.root, '[data-action="gocnet-transfer"]');
        button.click();

        const status = await waitForSelector(env.root, '.staff-gocnet-transfer-status');
        assert.match(status.textContent, /Belge GöçNet’e yüklendi/);
        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].filename, 'cagri_yilmaz_p12345.pdf');
        assert.equal(downloads[0].file.name, 'gocnet-basvuru.pdf');
        assert.equal(uploadedPayloads.length, 1);

        const downloadedBytes = new Uint8Array(await downloads[0].file.arrayBuffer());
        const transferredBytes = new Uint8Array(Buffer.from(uploadedPayloads[0].pdfBase64, 'base64'));
        assert.deepEqual(downloadedBytes, transferredBytes);
    } finally {
        env.cleanup();
    }
});

test('missing student name or passport shows clear error and triggers no download', async () => {
    const pdfBytes = await createSamplePdfBytes();
    const env = setupDomEnvironment();
    const downloads = [];
    const extensionMessages = [];
    const applicationItem = {
        id: 'app-2',
        status: 'approved_for_processing',
        submitted_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
        student_number: '20260002',
        first_name: 'Ayşe',
        last_name: 'Demir',
        passport_number: '',
        phone: '+905321234567'
    };

    const originalPostMessage = env.dom.window.postMessage.bind(env.dom.window);
    env.dom.window.postMessage = (message, targetOrigin) => {
        if (message?.source === 'WEB_APP') {
            extensionMessages.push(message);
            return;
        }
        originalPostMessage(message, targetOrigin);
    };

    try {
        initializeStaffApplicationsManager(env.root, createMockApi(applicationItem, pdfBytes), {
            downloadPdfFile(file, filename) {
                downloads.push({ file, filename });
            }
        });
        env.dom.window.document.dispatchEvent(new env.dom.window.CustomEvent('workspace:view-changed', {
            detail: { viewName: 'applications' }
        }));

        const button = await waitForSelector(env.root, '[data-action="gocnet-transfer"]');
        button.click();

        const status = await waitForSelector(env.root, '.staff-gocnet-transfer-status');
        assert.equal(downloads.length, 0);
        assert.equal(extensionMessages.length, 0);
        assert.match(status.textContent, /Öğrenci adı, soyadı veya pasaport numarası eksik/);
    } finally {
        env.cleanup();
    }
});

test('GöçNet transfer uses YOKSIS_GOCNET_AUTO_SAVE_UPLOAD after history check and skips SAVE_GOCNET_RECORD on uploaded', async () => {
    const pdfBytes = await createSamplePdfBytes();
    const env = setupDomEnvironment();
    const downloads = [];
    const actions = [];
    const autoSavePayloads = [];
    const applicationItem = {
        id: 'app-3',
        status: 'approved_for_processing',
        submitted_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
        student_number: '20260003',
        first_name: 'Çağrı',
        last_name: 'Yılmaz',
        passport_number: 'P12345',
        phone: '+905321234567'
    };

    const originalPostMessage = env.dom.window.postMessage.bind(env.dom.window);
    env.dom.window.postMessage = (message, targetOrigin) => {
        if (message?.source === 'WEB_APP' && message.payload) {
            const { action, requestId, phase } = message.payload;
            actions.push(action);
            let response = { state: 'unknown' };
            if (action === 'CHECK_GOCNET_TRANSFER' && phase === 'history') {
                response = { state: 'no_match', yoksisTabId: 42 };
            } else if (action === 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD') {
                autoSavePayloads.push(message.payload);
                response = { state: 'uploaded', recordId: '555666' };
            }
            queueMicrotask(() => {
                env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
                    source: env.dom.window,
                    origin: env.dom.window.location.origin,
                    data: { source: 'EXTENSION', type: 'RESPONSE', action, requestId, response }
                }));
            });
            return;
        }
        originalPostMessage(message, targetOrigin);
    };

    try {
        initializeStaffApplicationsManager(env.root, createMockApi(applicationItem, pdfBytes), {
            downloadPdfFile(file, filename) {
                downloads.push({ file, filename });
            }
        });
        env.dom.window.document.dispatchEvent(new env.dom.window.CustomEvent('workspace:view-changed', {
            detail: { viewName: 'applications' }
        }));

        const button = await waitForSelector(env.root, '[data-action="gocnet-transfer"]');
        button.click();

        const status = await waitForSelector(env.root, '.staff-gocnet-transfer-status');
        assert.match(status.textContent, /Belge GöçNet’e yüklendi; son kontrol ofis görevlisinde\./);
        assert.deepEqual(actions, ['CHECK_GOCNET_TRANSFER', 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD']);
        assert.equal(actions.includes('SAVE_GOCNET_RECORD'), false);
        assert.equal(autoSavePayloads.length, 1);
        assert.equal(autoSavePayloads[0].applicationNumber, '2026-12-1234567');
        assert.equal(autoSavePayloads[0].existingRecord, false);
        assert.equal(autoSavePayloads[0].pdfFileName, 'cagri_yilmaz_p12345.pdf');
        const downloadedBytes = new Uint8Array(await downloads[0].file.arrayBuffer());
        const transferredBytes = new Uint8Array(Buffer.from(autoSavePayloads[0].pdfBase64, 'base64'));
        assert.deepEqual(downloadedBytes, transferredBytes);
    } finally {
        env.cleanup();
    }
});

test('GöçNet transfer falls back to SAVE_GOCNET_RECORD and UPLOAD_GOCNET_DOCUMENT when auto-save returns bad_input', async () => {
    const pdfBytes = await createSamplePdfBytes();
    const env = setupDomEnvironment();
    const actions = [];
    const applicationItem = {
        id: 'app-4',
        status: 'approved_for_processing',
        submitted_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:00:00Z',
        student_number: '20260004',
        first_name: 'Çağrı',
        last_name: 'Yılmaz',
        passport_number: 'P12345',
        phone: '+905321234567'
    };

    const originalPostMessage = env.dom.window.postMessage.bind(env.dom.window);
    env.dom.window.postMessage = (message, targetOrigin) => {
        if (message?.source === 'WEB_APP' && message.payload) {
            const { action, requestId, phase } = message.payload;
            actions.push(action);
            let response = { state: 'unknown' };
            if (action === 'CHECK_GOCNET_TRANSFER' && phase === 'history') {
                response = { state: 'no_match', yoksisTabId: 42 };
            } else if (action === 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD') {
                response = { state: 'unknown', reason: 'bad_input' };
            } else if (action === 'CHECK_GOCNET_TRANSFER' && phase === 'form') {
                response = { state: 'student_data_filled', yoksisTabId: 42 };
            } else if (action === 'SAVE_GOCNET_RECORD') {
                response = { state: 'saved', recordId: '987654' };
            } else if (action === 'ACK_GOCNET_SAVE') {
                response = { success: true };
            } else if (action === 'UPLOAD_GOCNET_DOCUMENT') {
                response = { state: 'uploaded', documentId: '112233' };
            } else if (action === 'ACK_GOCNET_UPLOAD') {
                response = { success: true };
            }
            queueMicrotask(() => {
                env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
                    source: env.dom.window,
                    origin: env.dom.window.location.origin,
                    data: { source: 'EXTENSION', type: 'RESPONSE', action, requestId, response }
                }));
            });
            return;
        }
        originalPostMessage(message, targetOrigin);
    };

    try {
        initializeStaffApplicationsManager(env.root, createMockApi(applicationItem, pdfBytes), {
            downloadPdfFile() {}
        });
        env.dom.window.document.dispatchEvent(new env.dom.window.CustomEvent('workspace:view-changed', {
            detail: { viewName: 'applications' }
        }));

        const button = await waitForSelector(env.root, '[data-action="gocnet-transfer"]');
        button.click();

        const status = await waitForSelector(env.root, '.staff-gocnet-transfer-status');
        assert.match(status.textContent, /Belge GöçNet’e yüklendi; son kontrol ofis görevlisinde\./);
        assert.deepEqual(actions, [
            'CHECK_GOCNET_TRANSFER',
            'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD',
            'CHECK_GOCNET_TRANSFER',
            'SAVE_GOCNET_RECORD',
            'ACK_GOCNET_SAVE',
            'UPLOAD_GOCNET_DOCUMENT',
            'ACK_GOCNET_UPLOAD'
        ]);
    } finally {
        env.cleanup();
    }
});
