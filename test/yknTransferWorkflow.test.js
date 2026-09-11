import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

function createPortalMarkup() {
    return `
        <input id="ykn-passport-input">
        <button id="btn-ykn-search"></button>
        <div id="ykn-student-result"></div>
        <div id="ykn-student-name"></div>
        <div id="ykn-status-container"></div>
        <div id="ykn-extension-status"><span id="ykn-extension-status-title"></span><span id="ykn-extension-status-message"></span></div>
        <a id="btn-ykn-extension-download"></a>
        <button id="btn-ykn-extension-recheck"></button>
        <button id="btn-ykn-copy-info"></button>
        <button id="btn-ykn-copy-letter"></button>
        <button id="btn-ykn-crop-photo"></button>
        <button id="btn-ykn-transfer-yoksis"></button>
        <button id="btn-ykn-paste-yoksis"></button>
        <button id="btn-ykn-one-click"></button>
        <input id="ykn-issue-date">
        <input id="ykn-expiry-date">
        <input id="ykn-birth-place">
        <input id="ykn-issuing-authority">
        <span id="ykn-step-indicator"></span>
    `;
}

function installPortalEnvironment() {
    const dom = new JSDOM(createPortalMarkup(), {
        url: 'https://portal.example.test/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    globalThis.window = window;
    globalThis.document = window.document;
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: window.navigator
    });
    window.requestAnimationFrame = (callback) => callback();
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    window.fetch = async () => ({
        ok: true,
        json: async () => ({ downloadUrl: '/downloads/ykn.zip' })
    });
    window.navigator.clipboard = { writeText: async () => {} };
    return dom;
}

function postExtensionResponse(window, action, requestId, response) {
    window.dispatchEvent(new window.MessageEvent('message', {
        data: {
            source: 'EXTENSION',
            type: 'RESPONSE',
            action,
            requestId,
            response
        },
        source: window
    }));
}

test('cropperdaki Her Şeyi aktar onayı, doğrulanmış YÖKSİS formuna tüm veriyi gönderir', async () => {
    const dom = installPortalEnvironment();
    const { initYknManager } = await import('../src/managers/yknManager.js');
    const messages = [];
    dom.window.addEventListener('message', (event) => {
        if (event.data?.source === 'WEB_APP') messages.push(event.data.payload);
    });

    try {
        initYknManager();
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'STUDENT_FOUND',
                requestId: 'search-1',
                data: {
                    fullName: 'Test Student',
                    passportNo: 'P123',
                    yoksisId: 'AB-123-CD'
                }
            },
            source: dom.window
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        dom.window.document.getElementById('btn-ykn-transfer-yoksis').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const searchRequest = messages.find((payload) => payload.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(searchRequest, 'YÖKSİS arama isteği gönderilmeliydi');

        postExtensionResponse(dom.window, 'TRANSFER_TO_YOKSIS', searchRequest.requestId, {
            success: true,
            searchTriggered: true,
            formReady: true
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const copyInfoButton = dom.window.document.getElementById('btn-ykn-copy-info');
        assert.equal(copyInfoButton.disabled, false, 'YÖKSİS formu hazır olduğunda 3. buton aktif olmalıydı');
        assert.ok(
            copyInfoButton.classList.contains('is-active') || copyInfoButton.classList.contains('is-available'),
            '3. buton aktif/uygulanabilir görsel durumda olmalıydı'
        );

        dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
            detail: {
                dataUrl: 'data:image/jpeg;base64,ZmFrZQ==',
                fileName: 'student.jpg'
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        const fillRequest = messages.find((payload) => payload.action === 'FILL_YOKSIS_FORM');
        assert.ok(fillRequest, 'cropper onayı sonrası YÖKSİS form doldurma isteği gönderilmeliydi');
        assert.equal(fillRequest.data.yoksisReady, true);
        assert.equal(fillRequest.data.croppedPhotoBase64, 'data:image/jpeg;base64,ZmFrZQ==');

        postExtensionResponse(dom.window, 'FILL_YOKSIS_FORM', fillRequest.requestId, {
            success: true,
            filledFields: ['Anne Adı', 'Fotoğraf'],
            missingFields: [],
            photoUploaded: true
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        dom.window.close();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.navigator;
    }
});

test('aynı kabul belgesi iki kez bildirildiğinde kod ve YÖKSİS aktarımı tek kez işlenir', async () => {
    const dom = installPortalEnvironment();
    const { initYknManager } = await import('../src/managers/yknManager.js');
    const messages = [];
    const clipboardWrites = [];
    dom.window.navigator.clipboard = {
        writeText: async (value) => clipboardWrites.push(value)
    };
    dom.window.addEventListener('message', (event) => {
        if (event.data?.source === 'WEB_APP') messages.push(event.data.payload);
    });

    try {
        initYknManager();
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'STUDENT_DOCUMENTS_FOUND',
                requestId: 'search-duplicate-1',
                data: {
                    fullName: 'Test Student',
                    passportNo: 'P123',
                    acceptanceCandidates: ['https://apply.example.test/acceptance-letter.pdf'],
                    acceptanceLetterUrl: 'https://apply.example.test/acceptance-letter.pdf',
                    passportCandidates: [],
                    documentsReady: true
                }
            },
            source: dom.window
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        dom.window.document.getElementById('btn-ykn-one-click').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const readRequest = messages.find((payload) => payload.action === 'READ_APPLY_DOCUMENT');
        assert.ok(readRequest, 'kabul belgesi okuma isteği gönderilmeliydi');

        const documentBase64 = Buffer.from('Kabul mektubu YÖKSİS ID: 3FE-D2D-28', 'utf8').toString('base64');
        const documentEvent = {
            source: 'EXTENSION',
            type: 'EVENT',
            action: 'DOCUMENT_BYTES_READY',
            requestId: readRequest.requestId,
            data: {
                documentKind: 'acceptanceLetter',
                documentUrl: readRequest.documentUrl,
                contentType: 'text/plain',
                documentBase64
            }
        };

        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: documentEvent,
            source: dom.window
        }));
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: documentEvent,
            source: dom.window
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(clipboardWrites, ['3FE-D2D-28']);
        assert.equal(
            messages.filter((payload) => payload.action === 'TRANSFER_TO_YOKSIS').length,
            1,
            'YÖKSİS aktarımı aynı kabul belgesi için tek kez başlatılmalıydı'
        );
        const statusText = dom.window.document.getElementById('ykn-status-container').textContent;
        assert.equal(
            (statusText.match(/Kabul mektubu YÖKSİS ID bulundu ve kopyalandı/g) || []).length,
            1,
            'kabul kodu başarı mesajı tek kez yazılmalıydı'
        );

        const transferRequest = messages.find((payload) => payload.action === 'TRANSFER_TO_YOKSIS');
        postExtensionResponse(dom.window, 'TRANSFER_TO_YOKSIS', transferRequest.requestId, {
            success: true,
            searchTriggered: true,
            formReady: true
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const copyInfoButton = dom.window.document.getElementById('btn-ykn-copy-info');
        assert.equal(copyInfoButton.disabled, false, 'YÖKSİS formu hazır olduğunda 3. buton aktif olmalıydı');
        assert.ok(
            copyInfoButton.classList.contains('is-active') || copyInfoButton.classList.contains('is-available'),
            '3. buton aktif/uygulanabilir görsel durumda olmalıydı'
        );
        assert.equal(
            messages.filter((payload) => payload.action === 'COPY_APPLY_DATA').length,
            1,
            'YÖKSİS araması başarılı olduğunda Apply bilgileri tek kez istenmeliydi'
        );

        const copyInfoRequest = messages.find((payload) => payload.action === 'COPY_APPLY_DATA');
        postExtensionResponse(dom.window, 'COPY_APPLY_DATA', copyInfoRequest.requestId, {
            success: false,
            error: 'test akışını sonlandır'
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        dom.window.close();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.navigator;
    }
});

test('yeni öğrenci aramasında önceki öğrencinin kabul belgesi önbelleği kullanılmaz', async () => {
    const dom = installPortalEnvironment();
    const { initYknManager } = await import('../src/managers/yknManager.js');
    const messages = [];
    const clipboardWrites = [];
    dom.window.navigator.clipboard = {
        writeText: async (value) => clipboardWrites.push(value)
    };
    dom.window.addEventListener('message', (event) => {
        if (event.data?.source === 'WEB_APP') messages.push(event.data.payload);
    });

    const acceptanceUrl = 'https://apply.example.test/acceptance-letter-student-series.pdf';
    const dispatchDocuments = (requestId, fullName, passportNo) => {
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'STUDENT_DOCUMENTS_FOUND',
                requestId,
                data: {
                    fullName,
                    passportNo,
                    acceptanceCandidates: [acceptanceUrl],
                    acceptanceLetterUrl: acceptanceUrl,
                    passportCandidates: [],
                    documentsReady: true
                }
            },
            source: dom.window
        }));
    };

    const dispatchDocument = (readRequest, code) => {
        const documentBase64 = Buffer.from(`Kabul mektubu YÖKSİS ID: ${code}`, 'utf8').toString('base64');
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'DOCUMENT_BYTES_READY',
                requestId: readRequest.requestId,
                data: {
                    documentKind: 'acceptanceLetter',
                    documentUrl: readRequest.documentUrl,
                    contentType: 'text/plain',
                    documentBase64
                }
            },
            source: dom.window
        }));
    };

    try {
        initYknManager();
        dispatchDocuments('search-student-1', 'First Student', 'P1');
        await new Promise((resolve) => setTimeout(resolve, 0));
        dom.window.document.getElementById('btn-ykn-one-click').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const firstReadRequest = messages.find((payload) => payload.action === 'READ_APPLY_DOCUMENT');
        assert.ok(firstReadRequest, 'ilk öğrenci için belge okunmalıydı');
        dispatchDocument(firstReadRequest, 'AAA-111-BB');
        await new Promise((resolve) => setTimeout(resolve, 0));

        const firstTransferRequest = messages.find((payload) => payload.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(firstTransferRequest, 'ilk öğrenci için YÖKSİS aktarımı başlamalıydı');
        postExtensionResponse(dom.window, 'TRANSFER_TO_YOKSIS', firstTransferRequest.requestId, {
            success: false,
            error: 'test ilk akışı sonlandır'
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const passportInput = dom.window.document.getElementById('ykn-passport-input');
        passportInput.value = 'P2';
        dom.window.document.getElementById('btn-ykn-search').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const secondSearchRequest = messages.filter((payload) => payload.action === 'SEARCH_STUDENT').at(-1);
        assert.ok(secondSearchRequest, 'ikinci öğrenci araması başlamalıydı');

        dispatchDocuments(secondSearchRequest.requestId, 'Second Student', 'P2');
        await new Promise((resolve) => setTimeout(resolve, 0));
        dom.window.document.getElementById('btn-ykn-one-click').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const readRequests = messages.filter((payload) => payload.action === 'READ_APPLY_DOCUMENT');
        assert.equal(readRequests.length, 2, 'ikinci öğrenci için kabul belgesi yeniden okunmalıydı');

        const secondReadRequest = readRequests.at(-1);
        dispatchDocument(secondReadRequest, 'CCC-222-DD');
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.deepEqual(clipboardWrites, ['AAA-111-BB', 'CCC-222-DD']);
        const transferRequests = messages.filter((payload) => payload.action === 'TRANSFER_TO_YOKSIS');
        assert.equal(transferRequests.length, 2, 'iki öğrenci için iki ayrı YÖKSİS aktarımı başlamalıydı');

        postExtensionResponse(dom.window, 'TRANSFER_TO_YOKSIS', transferRequests.at(-1).requestId, {
            success: false,
            error: 'test ikinci akışı sonlandır'
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 4_500));
    } finally {
        dom.window.close();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.navigator;
    }
});
