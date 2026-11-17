import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const htmlTemplate = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function installGlobal(context, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    });
}

function installFakeTimers(context) {
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    let nextId = 1;
    const timers = new Map();

    globalThis.setTimeout = (fn, ms = 0, ...args) => {
        const id = nextId++;
        timers.set(id, { fn, ms: Number(ms) || 0, args });
        return id;
    };
    globalThis.clearTimeout = (id) => {
        timers.delete(id);
    };

    context.after(() => {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
        timers.clear();
    });

    return {
        runTimersAtOrAbove(minMs) {
            for (const [id, entry] of [...timers.entries()]) {
                if (entry.ms >= minMs) {
                    timers.delete(id);
                    entry.fn(...entry.args);
                }
            }
        }
    };
}

async function createPortalHarness(context, suffix) {
    const fakeTimers = installFakeTimers(context);
    const dom = new JSDOM(htmlTemplate, { url: 'https://portal.test/yetkili/' });
    context.after(() => dom.window.close());

    dom.window.document.execCommand = () => true;
    dom.window.Cropper = class {
        destroy() {}
        rotateTo() {}
        getImageData() {
            return { rotate: 0 };
        }
        getCroppedCanvas() {
            return {
                toDataURL: () => 'data:image/jpeg;base64,AA==',
                toBlob: (cb) => cb(null)
            };
        }
    };

    const postedMessages = [];
    dom.window.postMessage = (payload) => {
        postedMessages.push(payload);
    };

    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    installGlobal(context, 'CustomEvent', dom.window.CustomEvent);
    installGlobal(context, 'MutationObserver', dom.window.MutationObserver);
    installGlobal(context, 'requestAnimationFrame', () => 0);
    installGlobal(context, 'fetch', async () => ({ ok: false }));

    const { initYknManager } = await import(`../src/managers/yknManager.js?test=${Date.now()}-${suffix}`);
    initYknManager();

    function dispatchExtensionMessage(data) {
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: { source: 'EXTENSION', ...data },
            source: dom.window
        }));
    }

    function loadSyntheticStudent({ yoksisId = 'AB1-234-CD', documentsReady = true } = {}) {
        const doc = dom.window.document;
        doc.getElementById('ykn-passport-input').value = 'SYNTH12345';
        doc.getElementById('btn-ykn-search').click();

        const searchMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg, 'SEARCH_STUDENT message should be posted');
        const requestId = searchMsg.payload.requestId;

        dispatchExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_FOUND',
            requestId,
            data: {
                fullName: 'ORNEK OGRENCI',
                passportNo: 'SYNTH12345',
                yoksisId,
                passportImageSrc: 'data:image/jpeg;base64,AA=='
            }
        });

        dispatchExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId,
            data: {
                fullName: 'ORNEK OGRENCI',
                passportNo: 'SYNTH12345',
                yoksisId,
                documentsReady,
                passportImageSrc: 'data:image/jpeg;base64,AA=='
            }
        });

        return requestId;
    }

    return {
        dom,
        document: dom.window.document,
        postedMessages,
        fakeTimers,
        dispatchExtensionMessage,
        loadSyntheticStudent
    };
}

test('ykn-pro-actions places background search button first and leaves existing two buttons intact', async (context) => {
    const { document } = await createPortalHarness(context, 'buttons');
    const proActions = document.getElementById('ykn-pro-actions');
    const buttons = [...proActions.querySelectorAll('button')];

    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].id, 'btn-ykn-background-search');
    assert.equal(buttons[1].id, 'btn-read-acceptance');
    assert.equal(buttons[2].id, 'btn-copy');
    assert.match(buttons[0].textContent, /Kabul Kodunu Arka Planda YÖKSİS’te Ara/);
    assert.equal(
        buttons[0].getAttribute('title'),
        'Sekme değiştirmeden YÖKSİS’te aranır; bu sırada fotoğrafı kırpabilirsiniz'
    );
});

test('cropper modal disables transfer button when gate is closed, restores original label when opened, and blocks transfer clicks', async (context) => {
    const dom = new JSDOM(htmlTemplate, { url: 'https://portal.test/yetkili/' });
    context.after(() => dom.window.close());
    dom.window.Cropper = class {
        destroy() {}
        rotateTo() {}
        getImageData() {
            return { rotate: 0 };
        }
        getCroppedCanvas() {
            return {
                toDataURL: () => 'data:image/jpeg;base64,AA==',
                toBlob: (cb) => cb(null)
            };
        }
    };

    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    installGlobal(context, 'CustomEvent', dom.window.CustomEvent);
    installGlobal(context, 'requestAnimationFrame', () => 0);

    const cropper = await import(`../src/ui/passportCropperModal.js?gate=${Date.now()}`);
    const doc = dom.window.document;
    const btnTransfer = doc.getElementById('btn-passport-crop-transfer');
    const originalHtml = btnTransfer.innerHTML;
    const originalTitle = btnTransfer.getAttribute('title');

    let croppedEvents = 0;
    dom.window.addEventListener('ykn:photo-cropped', () => {
        croppedEvents += 1;
    });

    // Kapı kapalıyken sonradan açılan modal bile düğmeyi kilitli başlatmalıdır
    dom.window.__YKN_TRANSFER_GATE__ = {
        allowed: false,
        reasonKey: 'running',
        label: 'YÖKSİS aranıyor...'
    };

    cropper.initPassportCropperModal();
    cropper.openPassportCropper({ imageSrc: 'data:image/jpeg;base64,AA==' });

    assert.equal(btnTransfer.disabled, true);
    assert.equal(btnTransfer.getAttribute('aria-disabled'), 'true');
    assert.equal(btnTransfer.textContent, 'YÖKSİS aranıyor...');
    assert.equal(btnTransfer.getAttribute('title'), 'YÖKSİS aranıyor...');

    btnTransfer.click();
    assert.equal(croppedEvents, 0);

    // Kapı açılınca özgün metin ve başlık geri yüklenmelidir
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:transfer-gate', {
        detail: { allowed: true, reasonKey: null, label: '' }
    }));

    assert.equal(btnTransfer.disabled, false);
    assert.equal(btnTransfer.getAttribute('aria-disabled'), 'false');
    assert.equal(btnTransfer.innerHTML, originalHtml);
    assert.equal(btnTransfer.getAttribute('title'), originalTitle);
});

test('background search gates transfer & sync-fields, allows photo save, and unlocks upon verified formReady response', async (context) => {
    const { dom, document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'flow');
    loadSyntheticStudent({ yoksisId: 'XY9-876-ZW', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnSync = document.getElementById('btn-sync-yoksis-fields');
    const btnCropTransfer = document.getElementById('btn-passport-crop-transfer');
    const btnCropDownload = document.getElementById('btn-passport-crop-download');
    const btnCopy = document.getElementById('btn-copy');

    btnBg.click();

    assert.equal(btnBg.disabled, true);
    assert.equal(btnBg.classList.contains('is-loading'), true);
    assert.equal(btnSync.disabled, true);

    const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg, 'TRANSFER_TO_YOKSIS should be posted');
    assert.equal(bgTransferMsg.payload.background, true);
    assert.equal(bgTransferMsg.payload.data.yoksisId, 'XY9-876-ZW');
    const bgRequestId = bgTransferMsg.payload.requestId;

    // Arka plan araması sürerken kırpıcı açılabilmeli ve aktarım tuşu kilitli kalmalıdır
    btnCopy.click();
    assert.equal(btnCropTransfer.disabled, true);
    assert.equal(btnCropTransfer.textContent, 'YÖKSİS aranıyor...');
    assert.equal(btnCropDownload.disabled, false);

    // Savunma amaçlı: kapı kapalıyken sync (disabled kaldırılsa bile) veya autoTransfer hiçbir FILL_YOKSIS_FORM / ikinci TRANSFER göndermemelidir
    const beforeBlockedCount = postedMessages.length;
    btnSync.disabled = false;
    btnSync.click();
    btnSync.disabled = true;
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
        detail: { dataUrl: 'data:image/jpeg;base64,AA==', fileName: 'test.jpg', autoTransfer: true }
    }));
    const newMsgsDuringBlock = postedMessages.slice(beforeBlockedCount).map((m) => m.payload.action);
    assert.deepEqual(newMsgsDuringBlock, ['SAVE_CROPPED_PHOTO']);
    assert.match(document.getElementById('ykn-status-container').textContent, /YÖKSİS alan aktarımı bekletildi/);

    // Eski/uyumsuz requestId yanıtı yok sayılmalıdır
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'stale-request-id',
        response: { success: true, formReady: true }
    });
    assert.equal(btnBg.disabled, true);
    assert.equal(btnCropTransfer.disabled, true);

    // Doğru requestId ile formReady === true yanıtı kapıyı açar
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgRequestId,
        response: {
            success: true,
            formReady: true,
            background: true,
            yoksisTabId: 77,
            yoksisTabUrl: 'https://yoksis.example/student'
        }
    });

    assert.equal(btnBg.disabled, false);
    assert.equal(btnBg.classList.contains('is-loading'), false);
    assert.equal(btnSync.disabled, false);
    assert.equal(btnCropTransfer.disabled, false);
    assert.match(btnCropTransfer.textContent, /Her Şeyi YÖKSİS'e Aktar/);

    const statusText = document.getElementById('ykn-status-container').textContent;
    assert.match(statusText, /YÖKSİS öğrenci formu hazır ve kimlik doğrulandı/);
    assert.doesNotMatch(statusText, /portala dönüldü/i);
});

test('needs_attention, 45s timeout, and acceptance extraction path behave according to spec', async (context) => {
    const { document, postedMessages, fakeTimers, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'attention-timeout');
    loadSyntheticStudent({ yoksisId: '', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnSync = document.getElementById('btn-sync-yoksis-fields');

    // yoksisId yokken önce EXTRACT_KABUL_CODE üzerinden kodu alır ve arka plan aramasına geçer
    btnBg.click();
    assert.equal(btnBg.disabled, true);
    assert.equal(btnSync.disabled, true);

    const extractMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'EXTRACT_KABUL_CODE');
    assert.ok(extractMsg, 'EXTRACT_KABUL_CODE should be posted when yoksisId is missing');

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'EXTRACT_KABUL_CODE',
        requestId: extractMsg.payload.requestId,
        response: { success: true, kabulId: 'CD2-456-EF' }
    });

    const bgTransferMsg1 = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg1);
    assert.equal(bgTransferMsg1.payload.background, true);

    // surfaced + login_required -> needs_attention, retry için buton açılır, kapı kapalı kalır
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg1.payload.requestId,
        response: {
            success: false,
            surfaced: true,
            attentionReason: 'login_required'
        }
    });

    assert.equal(btnBg.disabled, false);
    assert.equal(btnSync.disabled, true);
    assert.match(document.getElementById('ykn-status-container').textContent, /YÖKSİS sekmesi öne getirildi: YÖKSİS oturumu gerekli/);

    // Tekrar dene ve 45 sn zaman aşımını tetikle
    btnBg.click();
    const bgTransferMsg2 = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.notEqual(bgTransferMsg2.payload.requestId, bgTransferMsg1.payload.requestId);

    fakeTimers.runTimersAtOrAbove(45_000);
    assert.equal(btnBg.disabled, false);
    assert.equal(btnSync.disabled, true);
    assert.match(document.getElementById('ykn-status-container').textContent, /zaman aşımına uğradı \(45 sn\)/);

    // Zaman aşımından sonra gelen geç yanıt eski akışa düşmemeli ve kapıyı açmamalıdır
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg2.payload.requestId,
        response: { success: true, formReady: true }
    });
    assert.equal(btnSync.disabled, true);
});

test('old #btn-read-acceptance, new Ara search, and workspace change reset background search to idle', async (context) => {
    const { dom, document, postedMessages, loadSyntheticStudent } = await createPortalHarness(context, 'resets');
    loadSyntheticStudent({ yoksisId: 'EF3-789-GH', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnSync = document.getElementById('btn-sync-yoksis-fields');
    const btnOld = document.getElementById('btn-read-acceptance');

    // 1. Eski #btn-read-acceptance basılınca arka plan durumu sıfırlanır ve kapı açılır; eski TRANSFER_TO_YOKSIS background içermez
    btnBg.click();
    assert.equal(btnSync.disabled, true);

    btnOld.click();
    assert.equal(btnSync.disabled, false);
    assert.equal(btnBg.disabled, false);
    const oldTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.equal(oldTransferMsg.payload.background, undefined);

    // 2. Yeni Ara araması sıfırlar
    btnBg.click();
    assert.equal(btnSync.disabled, true);
    document.getElementById('btn-ykn-search').click();
    assert.equal(btnSync.disabled, false);
    assert.equal(btnBg.disabled, false);

    // 3. Çalışma alanı değişimi sıfırlar
    loadSyntheticStudent({ yoksisId: 'EF3-789-GH', documentsReady: true });
    btnBg.click();
    assert.equal(btnSync.disabled, true);
    document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', { detail: { viewName: 'cover' } }));
    assert.equal(btnSync.disabled, false);
    assert.equal(btnBg.disabled, false);
});
