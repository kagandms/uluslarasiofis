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

    let cropperInitCount = 0;
    dom.window.document.execCommand = () => true;
    dom.window.Cropper = class {
        constructor() {
            cropperInitCount += 1;
        }
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

    function loadSyntheticStudent({
        yoksisId = 'AB1-234-CD',
        documentsReady = true,
        passportImageSrc = 'data:image/jpeg;base64,AA==',
        acceptanceCandidates = [],
        passportDocumentUrl = ''
    } = {}) {
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
                ...(passportImageSrc ? { passportImageSrc } : {}),
                ...(passportDocumentUrl ? { passportDocumentUrl } : {})
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
                ...(passportImageSrc ? { passportImageSrc } : {}),
                ...(acceptanceCandidates.length ? { acceptanceCandidates } : {}),
                ...(passportDocumentUrl ? { passportDocumentUrl } : {})
            }
        });

        return requestId;
    }

    return {
        dom,
        document: dom.window.document,
        postedMessages,
        fakeTimers,
        getCropperInitCount: () => cropperInitCount,
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
    assert.match(buttons[0].textContent, /Arka Planda YÖKSİS’te Ara ve Fotoğrafı Kırp/);
    assert.equal(
        buttons[0].getAttribute('title'),
        'YÖKSİS sekmesi birkaç saniye öne alınıp aranır, sonra portala dönülür; aynı anda pasaport fotoğrafı kırpma ekranı açılır'
    );
});

test('cropper modal keeps transfer enabled with queue label while running, disables for failed/needs_attention, and restores original label when opened', async (context) => {
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

    // Kapı kuyruklanabilir (running) durumdayken aktarım düğmesi etkin kalır ve kuyruk etiketini gösterir
    dom.window.__YKN_TRANSFER_GATE__ = {
        allowed: false,
        queueable: true,
        reasonKey: 'running',
        label: 'YÖKSİS aranıyor...'
    };

    cropper.initPassportCropperModal();
    cropper.openPassportCropper({ imageSrc: 'data:image/jpeg;base64,AA==' });

    assert.equal(btnTransfer.disabled, false);
    assert.equal(btnTransfer.getAttribute('aria-disabled'), 'false');
    assert.equal(btnTransfer.textContent, 'Kırp ve YÖKSİS Bitince Aktar');

    btnTransfer.click();
    assert.equal(croppedEvents, 1);

    // Kuyruklanamayan needs_attention / failed durumunda düğme kilitlenir ve tıklamayı engeller
    cropper.openPassportCropper({ imageSrc: 'data:image/jpeg;base64,AA==' });
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:transfer-gate', {
        detail: {
            allowed: false,
            queueable: false,
            reasonKey: 'login_required',
            label: 'YÖKSİS oturumu gerekli'
        }
    }));

    assert.equal(btnTransfer.disabled, true);
    assert.equal(btnTransfer.getAttribute('aria-disabled'), 'true');
    assert.equal(btnTransfer.textContent, 'YÖKSİS oturumu gerekli');
    assert.equal(btnTransfer.getAttribute('title'), 'YÖKSİS oturumu gerekli');

    btnTransfer.click();
    assert.equal(croppedEvents, 1);

    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:transfer-gate', {
        detail: {
            allowed: false,
            queueable: false,
            reasonKey: 'search_failed',
            label: 'YÖKSİS araması başarısız oldu, tekrar deneyin'
        }
    }));
    assert.equal(btnTransfer.disabled, true);
    assert.equal(btnTransfer.textContent, 'YÖKSİS araması başarısız oldu, tekrar deneyin');

    // Kapı açılınca özgün metin ve başlık geri yüklenmelidir
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:transfer-gate', {
        detail: { allowed: true, queueable: false, reasonKey: null, label: '' }
    }));

    assert.equal(btnTransfer.disabled, false);
    assert.equal(btnTransfer.getAttribute('aria-disabled'), 'false');
    assert.equal(btnTransfer.innerHTML, originalHtml);
    assert.equal(btnTransfer.getAttribute('title'), originalTitle);
});

test('one-tap background search opens cropper simultaneously, queues crop transfer while running, and posts FILL_YOKSIS_FORM once upon success', async (context) => {
    const { dom, document, postedMessages, getCropperInitCount, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'flow');
    loadSyntheticStudent({ yoksisId: 'XY9-876-ZW', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnSync = document.getElementById('btn-sync-yoksis-fields');
    const btnCropTransfer = document.getElementById('btn-passport-crop-transfer');
    const btnCropDownload = document.getElementById('btn-passport-crop-download');
    const cropperModal = document.getElementById('passport-cropper-modal');

    btnBg.click();

    assert.equal(btnBg.disabled, true);
    assert.equal(btnBg.classList.contains('is-loading'), true);
    assert.equal(btnSync.disabled, true);
    assert.equal(cropperModal.classList.contains('show'), true);
    assert.equal(getCropperInitCount(), 1);
    assert.equal(btnCropTransfer.disabled, false);
    assert.equal(btnCropTransfer.textContent, 'Kırp ve YÖKSİS Bitince Aktar');
    assert.equal(btnCropDownload.disabled, false);

    // Çalışırken ikinci basış hiçbir şey yapmaz ve kırpıcıyı ikinci kez açmaz
    const countAfterFirstClick = postedMessages.length;
    btnBg.click();
    assert.equal(postedMessages.length, countAfterFirstClick);
    assert.equal(getCropperInitCount(), 1);

    const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg, 'TRANSFER_TO_YOKSIS should be posted');
    assert.equal(bgTransferMsg.payload.background, true);
    assert.equal(bgTransferMsg.payload.data.yoksisId, 'XY9-876-ZW');
    const bgRequestId = bgTransferMsg.payload.requestId;
    assert.match(
        document.getElementById('ykn-status-container').textContent,
        /YÖKSİS aranıyor \(sekme birkaç saniye öne alınır, sonra portala dönülür\)\. Fotoğrafı kırpabilirsiniz\./
    );

    // sync-fields çalışırken kilitli kalmalıdır
    const beforeSyncAttemptCount = postedMessages.length;
    btnSync.disabled = false;
    btnSync.click();
    btnSync.disabled = true;
    assert.equal(postedMessages.length, beforeSyncAttemptCount);
    assert.match(document.getElementById('ykn-status-container').textContent, /YÖKSİS alan aktarımı bekletildi/);

    // Arama sürerken fotoğraf onaylanınca yalnızca SAVE_CROPPED_PHOTO gider, FILL_YOKSIS_FORM gönderilmez
    const beforeCropCount = postedMessages.length;
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
        detail: { dataUrl: 'data:image/jpeg;base64,AA==', fileName: 'test.jpg', autoTransfer: true }
    }));
    const newMsgsDuringQueue = postedMessages.slice(beforeCropCount).map((m) => m.payload.action);
    assert.deepEqual(newMsgsDuringQueue, ['SAVE_CROPPED_PHOTO']);
    assert.match(
        document.getElementById('ykn-status-container').textContent,
        /Fotoğraf hazır; YÖKSİS araması bitince otomatik aktarılacak\./
    );

    // Eski/uyumsuz requestId yanıtı yok sayılmalıdır
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'stale-request-id',
        response: { success: true, formReady: true }
    });
    assert.equal(btnBg.disabled, true);
    assert.equal(postedMessages.filter((m) => m?.payload?.action === 'FILL_YOKSIS_FORM').length, 0);

    // Doğru requestId ile formReady === true yanıtı kapıyı açar ve bekleyen FILL_YOKSIS_FORM'u tam 1 kez gönderir
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

    await Promise.resolve();

    assert.equal(btnBg.disabled, false);
    assert.equal(btnBg.classList.contains('is-loading'), false);
    assert.equal(btnSync.disabled, false);
    assert.equal(btnCropTransfer.disabled, false);
    assert.match(btnCropTransfer.textContent, /Her Şeyi YÖKSİS'e Aktar/);

    const fillMessages = postedMessages.filter((m) => m?.payload?.action === 'FILL_YOKSIS_FORM');
    assert.equal(fillMessages.length, 1);

    const statusText = document.getElementById('ykn-status-container').textContent;
    assert.match(statusText, /YÖKSİS doğrulandı; aktarım başlatılıyor\./);
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
    assert.match(
        document.getElementById('ykn-status-container').textContent,
        /Kabul mektubu okunuyor ve ardından YÖKSİS’te aranacak \(sekme birkaç saniye öne alınır, sonra portala dönülür\)\.\.\./
    );

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

test('needs_attention while pending clears the pending flag and reports manual_confirmation guidance', async (context) => {
    const { dom, document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'pending-attention');
    loadSyntheticStudent({ yoksisId: 'GH4-123-JK', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnCropTransfer = document.getElementById('btn-passport-crop-transfer');

    btnBg.click();
    const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg);

    // Kırpma onaylanıp kuyruğa alınır
    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
        detail: { dataUrl: 'data:image/jpeg;base64,AA==', fileName: 'pending.jpg', autoTransfer: true }
    }));

    // needs_attention (manual_confirmation) gelince bekleyen aktarım iptal edilir ve FILL_YOKSIS_FORM gönderilmez
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg.payload.requestId,
        response: {
            success: true,
            formReady: false,
            manualOverrideAvailable: true
        }
    });

    assert.equal(postedMessages.filter((m) => m?.payload?.action === 'FILL_YOKSIS_FORM').length, 0);
    assert.equal(btnCropTransfer.disabled, true);
    const statusText = document.getElementById('ykn-status-container').textContent;
    assert.match(
        statusText,
        /YÖKSİS formu otomatik doğrulanamadı; YÖKSİS sekmesinde kontrol edip “1\. Kabul Mektubunu Oku ve YÖKSİS’te Ara” ile devam edin/
    );
    assert.match(statusText, /Bekleyen aktarım iptal edildi:/);

    // Sonradan yeni bir başarılı arama gelse bile temizlenmiş bekleyen bayrak yüzünden otomatik FILL_YOKSIS_FORM tetiklenmez
    btnBg.click();
    const bgTransferMsg2 = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg2.payload.requestId,
        response: { success: true, formReady: true }
    });
    await Promise.resolve();
    assert.equal(postedMessages.filter((m) => m?.payload?.action === 'FILL_YOKSIS_FORM').length, 0);
});

test('extension feature check blocks background search when PONG lacks background_transfer and allows when present', async (context) => {
    const { document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'feature-check');
    loadSyntheticStudent({ yoksisId: 'KL5-999-MN', documentsReady: true });

    const pingMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'PING');
    assert.ok(pingMsg, 'PING handshake should be posted');

    // Eski eklenti PONG yanıtında background_transfer özelliği yok
    dispatchExtensionMessage({
        type: 'PONG',
        requestId: pingMsg.payload.requestId,
        features: []
    });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const cropperModal = document.getElementById('passport-cropper-modal');
    const beforeBlockedCount = postedMessages.length;

    btnBg.click();

    assert.equal(postedMessages.length, beforeBlockedCount);
    assert.equal(btnBg.disabled, false);
    assert.equal(cropperModal.classList.contains('show'), false);
    assert.match(
        document.getElementById('ykn-status-container').textContent,
        /Yüklü eklenti arka plan aramasını desteklemiyor\. Eklentiyi son sürümle yeniden yükleyin\./
    );

    // Güncel eklenti PONG yanıtı background_transfer içerince akış normal çalışır
    document.getElementById('btn-ykn-extension-recheck').click();
    const recheckPing = [...postedMessages].reverse().find((m) => m?.payload?.action === 'PING');
    dispatchExtensionMessage({
        type: 'PONG',
        requestId: recheckPing.payload.requestId,
        features: ['background_transfer']
    });

    btnBg.click();
    const transferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(transferMsg, 'TRANSFER_TO_YOKSIS should be posted when feature is supported');
    assert.equal(cropperModal.classList.contains('show'), true);
});

test('idle state keeps immediate FILL_YOKSIS_FORM transfer behavior', async (context) => {
    const { dom, document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'idle-flow');
    loadSyntheticStudent({ yoksisId: 'MN6-321-OP', documentsReady: true });

    const btnCopy = document.getElementById('btn-copy');
    const btnCropTransfer = document.getElementById('btn-passport-crop-transfer');

    btnCopy.click();
    assert.equal(document.getElementById('passport-cropper-modal').classList.contains('show'), true);
    assert.equal(btnCropTransfer.disabled, false);
    assert.match(btnCropTransfer.textContent, /Her Şeyi YÖKSİS'e Aktar/);

    dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
        detail: { dataUrl: 'data:image/jpeg;base64,AA==', fileName: 'idle.jpg', autoTransfer: true }
    }));

    // Boşta (idle) durumda yoksisReady/bağlı sekme yoksa startManualYoksisFillAfterCrop önce hazırlık aramasını bekler
    const prepTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(prepTransferMsg, 'TRANSFER_TO_YOKSIS preparation request should be posted');
    assert.equal(prepTransferMsg.payload.waitForForm, true);

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: prepTransferMsg.payload.requestId,
        response: {
            success: true,
            formReady: true,
            yoksisTabId: 88,
            yoksisTabUrl: 'https://yoksis.example/student'
        }
    });

    await Promise.resolve();
    await Promise.resolve();

    const actions = postedMessages.map((m) => m?.payload?.action);
    assert.ok(actions.includes('SAVE_CROPPED_PHOTO'));
    assert.ok(actions.includes('FILL_YOKSIS_FORM'));
});

test('parallel acceptance letter and passport document reads do not clobber each other or fail background search on passport read failure', async (context) => {
    const { document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'parallel-reads');
    loadSyntheticStudent({
        yoksisId: '',
        documentsReady: true,
        passportImageSrc: '',
        acceptanceCandidates: ['https://apply.test/acceptance-1.pdf'],
        passportDocumentUrl: 'https://apply.test/passport-1.pdf'
    });

    // STUDENT_FOUND aşamasında başlayan ön pasaport okumasını sonlandırarak tıklama anında iki paralel okumanın başlatılmasını doğrula
    const initialPassportPrefetch = [...postedMessages]
        .reverse()
        .find((m) => m?.payload?.action === 'READ_APPLY_DOCUMENT' && m?.payload?.documentKind === 'passport');
    assert.ok(initialPassportPrefetch, 'STUDENT_FOUND should prefetch passport document');
    dispatchExtensionMessage({
        type: 'EVENT',
        action: 'DOCUMENT_READ_FAILED',
        requestId: initialPassportPrefetch.payload.requestId,
        error: 'İlk pasaport ön okuması tamamlanamadı',
        data: {
            documentKind: 'passport',
            documentUrl: 'https://apply.test/passport-1.pdf'
        }
    });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const beforeClickCount = postedMessages.length;

    btnBg.click();

    const docRequests = postedMessages
        .slice(beforeClickCount)
        .filter((m) => m?.payload?.action === 'READ_APPLY_DOCUMENT');

    assert.equal(docRequests.length, 2);
    const acceptanceReq = docRequests.find((m) => m.payload.documentKind === 'acceptanceLetter');
    const passportReq = docRequests.find((m) => m.payload.documentKind === 'passport');
    assert.ok(acceptanceReq, 'acceptanceLetter READ_APPLY_DOCUMENT should be posted');
    assert.ok(passportReq, 'passport READ_APPLY_DOCUMENT should be posted');
    assert.notEqual(acceptanceReq.payload.requestId, passportReq.payload.requestId);

    // Pasaport okuması hata verse bile kabul mektubu arka plan araması reading_letter durumunda kalır
    dispatchExtensionMessage({
        type: 'EVENT',
        action: 'DOCUMENT_READ_FAILED',
        requestId: passportReq.payload.requestId,
        error: 'Pasaport indirilemedi',
        data: {
            documentKind: 'passport',
            documentUrl: 'https://apply.test/passport-1.pdf'
        }
    });

    assert.equal(btnBg.disabled, true);
    assert.equal(document.getElementById('btn-sync-yoksis-fields').disabled, true);
});

test('portal prints background phase timing status line when response includes phaseMs', async (context) => {
    const { document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'phase-ms-present');
    loadSyntheticStudent({ yoksisId: 'ST1-234-UV', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    const btnSync = document.getElementById('btn-sync-yoksis-fields');
    btnBg.click();

    const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg, 'TRANSFER_TO_YOKSIS should be posted');

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg.payload.requestId,
        response: {
            success: true,
            formReady: true,
            background: true,
            yoksisTabId: 77,
            yoksisTabUrl: 'https://yoksis.example/student',
            phaseMs: {
                searchMs: 1200,
                firstWaitMs: 1000,
                retryMs: 840,
                totalMs: 3040
            }
        }
    });

    assert.equal(btnBg.disabled, false);
    assert.equal(btnSync.disabled, false);

    const statusContainer = document.getElementById('ykn-status-container');
    const infoTexts = [...statusContainer.querySelectorAll('.ykn-status-item.is-info .ykn-status-text')]
        .map((el) => el.textContent);
    assert.ok(
        infoTexts.includes('Arka plan süreleri: arama 1.2 sn, ilk doğrulama 1.0 sn, yeniden doğrulama 0.8 sn, toplam 3.0 sn.'),
        `Expected timing status line in: ${JSON.stringify(infoTexts)}`
    );
    assert.match(statusContainer.textContent, /YÖKSİS öğrenci formu hazır ve kimlik doğrulandı/);
});

test('portal prints nothing extra when background response lacks phaseMs', async (context) => {
    const { document, postedMessages, dispatchExtensionMessage, loadSyntheticStudent } = await createPortalHarness(context, 'phase-ms-absent');
    loadSyntheticStudent({ yoksisId: 'ST2-345-WX', documentsReady: true });

    const btnBg = document.getElementById('btn-ykn-background-search');
    btnBg.click();

    const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
    assert.ok(bgTransferMsg, 'TRANSFER_TO_YOKSIS should be posted');

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: bgTransferMsg.payload.requestId,
        response: {
            success: true,
            formReady: true,
            background: true,
            yoksisTabId: 77,
            yoksisTabUrl: 'https://yoksis.example/student'
        }
    });

    const statusText = document.getElementById('ykn-status-container').textContent;
    assert.doesNotMatch(statusText, /Arka plan süreleri:/);
    assert.match(statusText, /YÖKSİS öğrenci formu hazır ve kimlik doğrulandı/);
});
