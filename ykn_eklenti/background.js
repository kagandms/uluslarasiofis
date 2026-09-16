// background.js

let ikametTabId = null;
let applyTabId = null;
let yoksisTabId = null;
let pendingApplyNavigation = null;
// YÖKSİS/ZK aynı anda gelen iki AU isteğinde formu yeniden oluşturabiliyor.
// Aynı sekmedeki otomasyon komutlarını sıraya koyup, aynı istek kimliğini de
// tekilleştiriyoruz. Böylece köprüden gelen yinelenmiş mesaj ikinci kez tıklama
// veya alan doldurma başlatamaz.
const yoksisOperationQueues = new Map();
const yoksisOperationResults = new Map();

const APPLY_APPLICATIONS_URL = 'https://apply.topkapi.edu.tr/panel/applications';
const YOKSIS_URL = 'https://yoksis.yok.gov.tr/';
const CONTENT_READY_TIMEOUT_MS = 15_000;
const CONTENT_READY_INITIAL_DELAY_MS = 250;
const CONTENT_READY_MAX_DELAY_MS = 1_000;
const CONTENT_SCRIPT_INJECTION_RETRY_MS = 2_000;
// Content script, kabul kodunun ZK onChange güncellemesinin bitmesini ve yeni
// öğrenci formunun iki kez kararlı görünmesini bekler. 12 saniye bu zinciri
// kesip ikinci bir MAIN-world araması başlatabiliyordu.
// YÖKSİS sekmesi Tek Tık ile yeni açılmışsa ZK ekranı ve kabul alanı geç
// yüklenebilir. Content tarafının 12 sn kontrol beklemesi + form doğrulaması
// için bu sınırın daha uzun olması gerekir.
const YOKSIS_SEARCH_RESPONSE_TIMEOUT_MS = 32_000;

function runYoksisOperation(tabId, operation, requestId, task) {
    const key = `${tabId}:${operation}:${requestId || 'anonymous'}`;
    if (yoksisOperationResults.has(key)) return yoksisOperationResults.get(key);

    const queueKey = String(tabId);
    const previous = yoksisOperationQueues.get(queueKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    yoksisOperationQueues.set(queueKey, current);
    yoksisOperationResults.set(key, current);

    current.finally(() => {
        if (yoksisOperationQueues.get(queueKey) === current) {
            yoksisOperationQueues.delete(queueKey);
        }
        // Aynı mesajın kısa süre içinde yeniden teslim edilmesini önle; ancak
        // kullanıcı sonraki denemede yeni requestId ile tekrar çalıştırabilsin.
        const cleanupTimer = setTimeout(() => yoksisOperationResults.delete(key), 60_000);
        if (typeof cleanupTimer?.unref === 'function') cleanupTimer.unref();
    }).catch(() => {});

    return current;
}

function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(response);
        });
    });
}

function updateTab(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
        chrome.tabs.update(tabId, updateProperties, (tab) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(tab);
        });
    });
}

function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
        chrome.tabs.query(queryInfo, (tabs) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(tabs);
        });
    });
}

function createTab(createProperties) {
    return new Promise((resolve, reject) => {
        chrome.tabs.create(createProperties, (tab) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(tab);
        });
    });
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, errorMessage) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
        Promise.resolve(promise).then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            }
        );
    });
}

async function ensureContentScriptInjected(tabId, pageKind) {
    try {
        if (chrome.scripting && chrome.scripting.executeScript) {
            const files = pageKind === 'bridge'
                ? ['bridge.js']
                : pageKind === 'apply'
                    ? ['pdf.min.js', 'document-parser.js', 'content.js']
                    : ['content.js'];
            await chrome.scripting.executeScript({
                // Dinamik enjeksiyonda allFrames kullanmak, YÖKSİS'in izinli
                // olmayan üçüncü taraf iframe'lerinden biri yüzünden tüm
                // enjeksiyonu reddedebiliyordu. Content script zaten aynı
                // origin iframe'lerini kendi içinde tarıyor.
                target: { tabId },
                files
            });
            return true;
        }
    } catch (error) {
        // Sayfa henüz hazır olmayabilir veya izin kısıtlı olabilir
    }
    return false;
}

async function waitForContentScript(tabId, pageKind, requiredPath = '') {
    const deadline = Date.now() + CONTENT_READY_TIMEOUT_MS;
    let delay = CONTENT_READY_INITIAL_DELAY_MS;
    let lastInjectionAt = 0;

    while (Date.now() < deadline) {
        let response = null;
        try {
            response = await sendTabMessage(tabId, {
                action: 'PING',
                pageKind
            });
            const hasExpectedRoute = !requiredPath
                || (typeof response?.url === 'string' && new URL(response.url).pathname.replace(/\/$/, '') === requiredPath);
            if (response && response.ready === true && response.pageKind === pageKind && hasExpectedRoute) {
                return response;
            }
        } catch (_) {
            // Sekme yeni açılmışsa veya eski içerik betiği geçersiz kaldıysa
            // aşağıdaki kontrollü yeniden enjeksiyon devreye girer.
        }

        // İlk enjeksiyon sayfa yüklenirken başarısız olabilir. Önceki akış bunu
        // yalnızca bir kez denediği için yeni açılan YÖKSİS sekmesi 15 saniye
        // sonra hataya düşüyordu. Başarılı PING gelene kadar aralıklı dene.
        const now = Date.now();
        if (now - lastInjectionAt >= CONTENT_SCRIPT_INJECTION_RETRY_MS) {
            lastInjectionAt = now;
            await ensureContentScriptInjected(tabId, pageKind);
        }

        await wait(delay);
        delay = Math.min(delay * 2, CONTENT_READY_MAX_DELAY_MS);
    }

    throw new Error(pageKind + ' content script zamanında hazır olmadı. Sekmeyi yenileyip tekrar deneyin.');
}

async function getPortalTabId() {
    if (ikametTabId) {
        try {
            const tab = await queryTabs({ active: false });
            // Check if tabId is still alive
            const existing = await new Promise((resolve) => {
                chrome.tabs.get(ikametTabId, (t) => {
                    if (chrome.runtime.lastError || !t) resolve(null);
                    else resolve(t.id);
                });
            });
            if (existing) return existing;
        } catch (_) {
            ikametTabId = null;
        }
    }

    const tabs = await queryTabs({});
    for (const tab of tabs) {
        const url = tab.url || '';
        if (isAllowedPortalUrl(url)) {
            ikametTabId = tab.id;
            return tab.id;
        }
    }

    return null;
}

async function getOcrPortalTabId() {
    if (ikametTabId) return ikametTabId;
    const tabs = await queryTabs({});
    const portalTab = tabs.find((tab) => {
        const url = String(tab.url || '').toLowerCase();
        return isAllowedPortalUrl(url)
            && !url.includes('apply.topkapi.edu.tr')
            && !url.includes('yoksis.yok.gov.tr');
    });
    if (portalTab) {
        ikametTabId = portalTab.id;
        return portalTab.id;
    }
    return null;
}

async function requestPortalOcr(imageBase64, requestId) {
    const portalTabId = await getOcrPortalTabId();
    if (!portalTabId) throw new Error('OCR için İkamet Portalı sekmesi açık değil.');
    const response = await sendTabMessage(portalTabId, {
        action: 'OCR_IMAGE',
        imageBase64,
        requestId
    });
    if (!response?.success || !response.text) {
        throw new Error(response?.error || 'Pasaport görüntüsünden metin okunamadı.');
    }
    return response;
}

function isAllowedPortalUrl(url) {
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname.toLowerCase();
        return host === 'localhost'
            || host === '127.0.0.1'
            || host.endsWith('.vercel.app')
            || host.includes('topkapi.edu.tr');
    } catch (_) {
        return false;
    }
}

async function notifyPortal(message) {
    try {
        const portalTabId = await getPortalTabId();
        if (portalTabId) {
            await sendTabMessage(portalTabId, message);
            return;
        }
    } catch (_) {}

    // Sekme bulunamazsa tüm izin verilen portallara yayınla
    try {
        const tabs = await queryTabs({});
        for (const tab of tabs) {
            if (isAllowedPortalUrl(tab.url || '')) {
                sendTabMessage(tab.id, message).catch(() => {});
            }
        }
    } catch (_) {}
}

async function handleStudentFound(data) {
    if (!data) return;
    studentData = data;
    await new Promise((resolve) => {
        chrome.storage.local.set({ studentData: data }, resolve);
    });

    notifyPortal({
        source: 'APPLY_TOPKAPI',
        type: 'EVENT',
        action: 'STUDENT_FOUND',
        data
    });
}

async function searchStudentByPassport(request) {
    let targetTabId = applyTabId;
    if (!targetTabId) {
        const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
        if (tabs.length > 0) {
            targetTabId = tabs[0].id;
            applyTabId = targetTabId;
        }
    }
    if (!targetTabId) {
        throw new Error('Apply Topkapı sekmesi açık değil. Lütfen önce Apply sekmesini açıp giriş yapın.');
    }

    await waitForContentScript(targetTabId, 'apply');
    const response = await sendTabMessage(targetTabId, {
        action: 'searchStudent',
        passportNo: request.passportNo,
        requestId: request.requestId
    });

    if (!response || !response.success) {
        throw new Error(response?.message || 'Apply sekmesinde arama başlatılamadı.');
    }

    return response;
}

function isApplyListUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === 'apply.topkapi.edu.tr'
            && parsedUrl.pathname.replace(/\/$/, '') === '/panel/applications';
    } catch (error) {
        return false;
    }
}

async function getReadyApplyTab() {
    const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
    let applyTab = tabs[0];

    if (!applyTab) {
        applyTab = await createTab({ url: APPLY_APPLICATIONS_URL, active: false });
    } else if (!isApplyListUrl(applyTab.url)) {
        await updateTab(applyTab.id, { url: APPLY_APPLICATIONS_URL });
    }

    applyTabId = applyTab.id;
    await waitForContentScript(applyTabId, 'apply', '/panel/applications');
    return applyTab;
}

async function startApplySearch(request) {
    const applyTab = await getReadyApplyTab();
    await sendTabMessage(applyTab.id, {
        action: 'SEARCH_IN_APPLY',
        passportNo: request.passportNo,
        requestId: request.requestId
    });

    return {
        success: true,
        requestId: request.requestId,
        message: 'Apply araması başlatıldı.'
    };
}

async function discoverApplyDocuments(tabId, requestId) {
    await waitForContentScript(tabId, 'apply');
    await sendTabMessage(tabId, {
        action: 'DISCOVER_STUDENT_DOCUMENTS',
        requestId
    });
}

async function readApplyDocument(request) {
    let targetTabId = applyTabId;
    if (!targetTabId) {
        const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
        if (tabs.length > 0) {
            targetTabId = tabs[0].id;
            applyTabId = targetTabId;
        }
    }
    if (!targetTabId) throw new Error('Apply sekmesi bulunamadı.');

    await waitForContentScript(targetTabId, 'apply');
    const result = await sendTabMessage(targetTabId, {
        action: 'FETCH_APPLY_DOCUMENT',
        documentUrl: request.documentUrl
    });
    if (!result?.success || !result.documentBase64) {
        throw new Error(result?.error || 'Apply belgesi okunamadı.');
    }

    notifyPortal({
        source: 'APPLY_TOPKAPI',
        type: 'EVENT',
        action: 'DOCUMENT_BYTES_READY',
        requestId: request.requestId,
        data: {
            documentKind: request.documentKind,
            documentUrl: request.documentUrl,
            contentType: result.contentType,
            documentBase64: result.documentBase64
        }
    });
}

function getStoredStudentData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['studentData'], (result) => resolve(result?.studentData || {}));
    });
}

function saveStudentData(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ studentData: data }, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(data);
        });
    });
}

function mergeStudentData(previous = {}, incoming = {}) {
    const merged = { ...previous };
    for (const [key, value] of Object.entries(incoming)) {
        if (value !== undefined && value !== null && value !== '') merged[key] = value;
    }
    return merged;
}

function mergeApplyProfileData(previous = {}, incoming = {}) {
    // Apply kopyası yeni öğrencinin profilinin tam fotoğrafıdır. Önceki
    // öğrencinin anne/baba, pasaport veya OCR alanlarını boş bir Apply alanı
    // üzerinden taşımak yeni aktarımın sessizce yanlış kişiye gitmesine yol
    // açar. Yalnızca aynı akışta gerekli olan YÖKSİS arama durumunu koru.
    const merged = { ...incoming };
    const workflowFields = [
        'yoksisReady',
        'yoksisId',
        'kabulId',
        'acceptanceLetterUrl',
        'acceptanceCandidates'
    ];
    for (const key of workflowFields) {
        const incomingValue = merged[key];
        const hasIncomingValue = Array.isArray(incomingValue)
            ? incomingValue.length > 0
            : incomingValue !== undefined && incomingValue !== null && incomingValue !== '';
        if (!hasIncomingValue && previous[key] !== undefined) merged[key] = previous[key];
    }
    return merged;
}

function hasStudentDataForYoksis(data = {}) {
    return ['fullName', 'anneAdi', 'babaAdi', 'uyruk', 'dogumUlkesi', 'cinsiyet', 'pasaportNo', 'passportNo', 'birthDate']
        .some((field) => Boolean(data[field]));
}

function applyPassportMetadata(data, metadata = {}) {
    const enriched = { ...data };
    if (metadata.issueDate) {
        enriched.issueDate = metadata.issueDate;
        enriched.passportIssueDate = metadata.issueDate;
        enriched.duzenlemeTarihi = metadata.issueDate;
        enriched.pasaportDuzenlemeTarihi = metadata.issueDate;
        enriched.verilisTarihi = metadata.issueDate;
        enriched.belgeDuzenlemeTarihi = metadata.issueDate;
    }
    if (metadata.expiryDate) {
        enriched.expiryDate = metadata.expiryDate;
        enriched.passportExpiryDate = metadata.expiryDate;
        enriched.gecerlilikTarihi = metadata.expiryDate;
        enriched.pasaportGecerlilikTarihi = metadata.expiryDate;
        enriched.bitisTarihi = metadata.expiryDate;
        enriched.belgeGecerlilikTarihi = metadata.expiryDate;
    }
    if (metadata.placeOfBirth) {
        enriched.birthPlace = metadata.placeOfBirth;
        enriched.dogumYeri = metadata.placeOfBirth;
        enriched.dogumYeriAciklamasi = metadata.placeOfBirth;
    }
    if (metadata.issuingAuthority) {
        enriched.issuingAuthority = metadata.issuingAuthority;
        enriched.verenMakam = metadata.issuingAuthority;
    }
    if (metadata.birthDate && !enriched.birthDate) {
        enriched.birthDate = metadata.birthDate;
    }
    if (metadata.cinsiyet && !enriched.cinsiyet) {
        enriched.cinsiyet = metadata.cinsiyet;
    }
    if (metadata.mrzSurname && (!enriched.lastName || enriched.lastName === enriched.firstName)) {
        enriched.lastName = metadata.mrzSurname;
        enriched.soyad = metadata.mrzSurname;
    }
    if (metadata.mrzGivenNames && (!enriched.firstName || enriched.firstName === enriched.lastName)) {
        enriched.firstName = metadata.mrzGivenNames;
        enriched.ad = metadata.mrzGivenNames;
    }
    if (enriched.firstName && enriched.lastName) {
        enriched.fullName = `${enriched.firstName} ${enriched.lastName}`.trim();
    }
    return enriched;
}

function getPassportCandidateUrls(data = {}) {
    return Array.from(new Set([
        ...(data.passportCandidates || []),
        data.passportDocumentUrl,
        data.passportImageUrl
    ].filter(Boolean)));
}

async function getReadyApplyProfileTab() {
    let targetTabId = applyTabId;
    if (!targetTabId) {
        const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
        if (tabs.length > 0) targetTabId = tabs[0].id;
    }
    if (!targetTabId) throw new Error('Açık bir Apply Topkapı öğrenci profili bulunamadı.');
    applyTabId = targetTabId;
    await waitForContentScript(targetTabId, 'apply');
    return targetTabId;
}

async function copyApplyDataWithPassportMetadata(request) {
    const targetTabId = await getReadyApplyProfileTab();
    const applyResponse = await sendTabMessage(targetTabId, {
        action: 'copyData',
        requestId: request.requestId
    });
    if (!applyResponse?.success || !applyResponse.data) {
        throw new Error(applyResponse?.message || 'Apply profilinden bilgiler okunamadı.');
    }

    const storedData = await getStoredStudentData();
    let enrichedData = mergeApplyProfileData(storedData, applyResponse.data);
    const passportCandidateUrls = getPassportCandidateUrls(enrichedData);
    let passportMetadata = {
        issueDate: '',
        expiryDate: '',
        placeOfBirth: '',
        issuingAuthority: '',
        missingFields: []
    };

    if (passportCandidateUrls.length > 0) {
        try {
            const passportResponse = await sendTabMessage(targetTabId, {
                action: 'EXTRACT_PASSPORT_METADATA',
                documentUrl: applyResponse.data.passportDocumentUrl,
                requestId: request.requestId
            });
            if (passportResponse?.success) {
                const metadata = passportResponse.metadata || {};
                passportMetadata = {
                    ...metadata,
                    missingFields: passportResponse.missingFields || []
                };
                enrichedData = applyPassportMetadata(enrichedData, metadata);
            } else {
                passportMetadata.missingFields = ['Düzenleme tarihi', 'Geçerlilik tarihi', 'Doğum yeri', 'Veren makam'];
            }
        } catch (error) {
            passportMetadata.missingFields = ['Düzenleme tarihi', 'Geçerlilik tarihi', 'Doğum yeri', 'Veren makam'];
            passportMetadata.error = error.message;
        }
    } else {
        // Pasaport dosyası zorunlu değil: kullanıcı fotoğrafı YÖKSİS'te
        // kendisi yükleyebilir. Bu durum metin aktarımını engellememeli.
        passportMetadata = {
            issueDate: '',
            expiryDate: '',
            placeOfBirth: '',
            issuingAuthority: '',
            missingFields: ['Fotoğraf'],
            error: 'Pasaport belgesi bulunamadı; fotoğraf manuel yüklenecek.'
        };
    }

    // Taranmış pasaportlarda PDF'nin metin katmanı olmayabilir. Bu durumda
    // fotoğraf aktarımı yine yapılır; fakat kırpma ekranı tarihlerin okunduğu
    // izlenimini vermesin diye kullanıcıya eksik kaynak alanları taşınır.
    const passportFieldLabels = {
        issueDate: 'Düzenleme tarihi',
        expiryDate: 'Geçerlilik tarihi',
        placeOfBirth: 'Doğum yeri',
        issuingAuthority: 'Veren makam'
    };
    const transferWarnings = (passportMetadata.missingFields || [])
        .map((field) => passportFieldLabels[field] || field)
        .filter(Boolean);
    if (transferWarnings.length > 0) enrichedData.transferWarnings = transferWarnings;
    else delete enrichedData.transferWarnings;

    await saveStudentData(enrichedData);

    if (passportCandidateUrls.length === 0) {
        if (enrichedData.yoksisReady !== true) {
            return {
                success: true,
                requestId: request.requestId,
                data: enrichedData,
                passportMetadata,
                autoFilled: false,
                cropperOpened: false,
                manualPhotoRequired: true,
                waitingForYoksis: true,
                filledFields: [],
                missingFields: [],
                message: 'Pasaport bulunamadı. Diğer bilgiler hazırlandı; YÖKSİS formu açılınca fotoğrafı elle yükleyebilirsiniz.'
            };
        }

        try {
            const fillResponse = await fillYoksisStudentData(enrichedData, request.requestId);
            return {
                success: Boolean(fillResponse?.success),
                requestId: request.requestId,
                data: enrichedData,
                passportMetadata,
                autoFilled: Boolean(fillResponse?.success),
                cropperOpened: false,
                manualPhotoRequired: true,
                partial: true,
                photoUploaded: false,
                filledFields: fillResponse?.filledFields || [],
                missingFields: fillResponse?.missingFields || [],
                message: 'Pasaport bulunamadı; diğer bilgiler YÖKSİS’e aktarıldı. Fotoğrafı YÖKSİS’te elle yükleyin.'
            };
        } catch (error) {
            return {
                success: false,
                requestId: request.requestId,
                data: enrichedData,
                passportMetadata,
                autoFilled: false,
                cropperOpened: false,
                manualPhotoRequired: true,
                error: error.message
            };
        }
    }

    await openPassportCropper(enrichedData, request);

    return {
        success: true,
        requestId: request.requestId,
        data: enrichedData,
        passportMetadata,
        autoFilled: false,
        cropperOpened: true,
        filledFields: [],
        missingFields: []
    };
}

async function readAcceptanceCodeFromCurrentProfile(request) {
    const targetTabId = await getReadyApplyProfileTab();
    const response = await sendTabMessage(targetTabId, {
        action: 'READ_ACCEPTANCE_CODE',
        requestId: request.requestId
    });
    if (!response?.success || !response.kabulId) {
        throw new Error(response?.error || response?.message || 'Kabul mektubu kodu okunamadı.');
    }
    return response;
}

async function resolveYoksisTab() {
    const tabs = await queryTabs({ url: '*://yoksis.yok.gov.tr/*' });
    if (!tabs || tabs.length === 0) {
        throw new Error('YÖKSİS sekmesi açık değil. Lütfen önce YÖKSİS sekmesini açın.');
    }

    // Arama hangi YÖKSİS sekmesinde yapıldıysa doldurma da mutlaka o sekmede
    // sürmelidir. Birden çok YÖKSİS sekmesi açıkken sadece "aktif" ya da
    // query sonucundaki ilk sekmeyi kullanmak arama ve doldurmayı ayırıyordu.
    const yoksisTab = tabs.find(t => t.id === yoksisTabId)
        || tabs.find(t => t.active)
        || tabs[0];
    yoksisTabId = yoksisTab.id;
    return yoksisTab;
}

async function getBackgroundYoksisTab() {
    let yoksisTab;
    try {
        yoksisTab = await resolveYoksisTab();
    } catch (_) {
        yoksisTab = await createTab({ url: YOKSIS_URL, active: false });
        yoksisTabId = yoksisTab.id;
    }

    yoksisTabId = yoksisTab.id;
    await waitForContentScript(yoksisTabId, 'yoksis');
    return yoksisTab;
}

async function getForegroundYoksisTab() {
    const yoksisTab = await getBackgroundYoksisTab();
    await updateTab(yoksisTab.id, { active: true });
    if (yoksisTab.windowId) {
        await chrome.windows.update(yoksisTab.windowId, { focused: true }).catch(() => {});
    }
    return yoksisTab;
}

async function executeYoksisSearchInMainWorld(tabId, kabulId) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return null;
    try {
        const results = await chrome.scripting.executeScript({
            // getAllDocs zaten aynı-origin YÖKSİS iframe'lerini tek geçişte
            // tarıyor. allFrames burada her üst/alt frame için aynı aramayı
            // yeniden çalıştırıp aynı ZK butonuna birden çok tıklama gönderirdi.
            target: { tabId },
            world: 'MAIN',
            func: async (code) => {
                try {
                    function getAllDocs(rootDoc) {
                        const docs = [];
                        function scan(d) {
                            if (!d || docs.includes(d)) return;
                            docs.push(d);
                            try {
                                const iframes = d.querySelectorAll('iframe, frame');
                                for (let i = 0; i < iframes.length; i++) {
                                    try {
                                        const cDoc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
                                        if (cDoc) scan(cDoc);
                                    } catch (_) {}
                                }
                            } catch (_) {}
                        }
                        scan(rootDoc || document);
                        return docs;
                    }

                    function norm(s) {
                        return (s || '')
                            .toLocaleLowerCase('tr-TR')
                            .replace(/ı/g, 'i')
                            .replace(/ğ/g, 'g')
                            .replace(/ü/g, 'u')
                            .replace(/ş/g, 's')
                            .replace(/ö/g, 'o')
                            .replace(/ç/g, 'c')
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim();
                    }

                    function isUsableControl(element) {
                        if (!element || !element.isConnected || element.disabled) return false;
                        let current = element;
                        for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
                            if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
                            const inlineStyle = current.style;
                            if (inlineStyle?.display === 'none' || inlineStyle?.visibility === 'hidden') return false;
                            try {
                                const style = (current.ownerDocument?.defaultView || window).getComputedStyle(current);
                                if (style?.display === 'none' || style?.visibility === 'hidden') return false;
                            } catch (_) {}
                        }
                        return true;
                    }

                    function findVisibleSearchButton(input) {
                        if (!input) return null;
                        const containers = [];
                        const row = input.closest('tr');
                        if (row) containers.push(row);
                        let parent = input.parentElement;
                        for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
                            containers.push(parent);
                        }

                        for (const container of containers) {
                            const clickables = container.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"]');
                            for (let i = 0; i < clickables.length; i += 1) {
                                const candidate = clickables[i];
                                if (!isUsableControl(candidate)) continue;
                                const text = norm(candidate.innerText || candidate.textContent || candidate.value || '');
                                if (text.includes('kabul') || text.includes('ara') || text.includes('sorgula') || text.includes('getir') || text.includes('bul')) {
                                    return candidate.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || candidate;
                                }
                            }
                        }
                        return null;
                    }

                    function findVisibleAcceptancePair(docs) {
                        for (const doc of docs) {
                            const inputs = doc.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                            for (let i = 0; i < inputs.length; i += 1) {
                                const candidate = inputs[i];
                                if (!isUsableControl(candidate)) continue;
                                const metadata = norm([
                                    candidate.placeholder,
                                    candidate.getAttribute('placeholder'),
                                    candidate.title,
                                    candidate.name,
                                    candidate.id
                                ].join(' '));
                                const isAcceptanceEditor = /(?:-|_)chdextr$/i.test(candidate.id || '');
                                if ((!metadata.includes('kabul') && !isAcceptanceEditor)
                                    || metadata.includes('pasaport')
                                    || metadata.includes('tc')
                                    || metadata.includes('dogum')) continue;
                                return {
                                    input: candidate,
                                    button: findVisibleSearchButton(candidate),
                                    win: doc.defaultView || window
                                };
                            }
                        }
                        return null;
                    }

                    const allDocs = getAllDocs(document);
                    console.log('[YKN MAIN WORLD] Scanning docs count:', allDocs.length, 'with code:', code);

                    let inp = null;
                    let btn = null;
                    let targetWin = window;

                    for (const doc of allDocs) {
                        const win = doc.defaultView || window;
                        let dInp = null;
                        let dBtn = null;

                        // 1. ÖNCELİK: Placeholder / Title / Name / Id / Value üzerinden doğrudan Input bulma
                        const allInputs = doc.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                        for (let i = 0; i < allInputs.length; i++) {
                            const it = allInputs[i];
                            if (!isUsableControl(it)) continue;
                            const ph = norm((it.placeholder || '') + ' ' + (it.getAttribute('placeholder') || '') + ' ' + (it.title || '') + ' ' + (it.name || '') + ' ' + (it.id || ''));
                            if (ph.includes('kabul') && !ph.includes('pasaport') && !ph.includes('tc') && !ph.includes('dogum')) {
                                dInp = it;
                                break;
                            }
                        }

                        // 2. ÖNCELİK: Buton bulma ("Kabul Mektup Id İle Ara" veya içinde "kabul" geçen buton)
                        const allClickables = doc.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"]');
                        for (let i = 0; i < allClickables.length; i++) {
                            const c = allClickables[i];
                            if (!isUsableControl(c)) continue;
                            const cTxt = norm(c.innerText || c.textContent || c.value || '');
                            if (cTxt.includes('kabul') && (cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || cTxt.includes('bul'))) {
                                dBtn = c.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || c;
                                break;
                            }
                        }

                        // 3. ÖNCELİK: Etiket ("Kabul Mektup ID ile Sorgula" veya "Kabul Mektup Id") üzerinden bulma
                        if (!dInp || !dBtn) {
                            const textNodes = doc.querySelectorAll('span, td, div, label, b, strong, th, p, a, legend, caption, .z-caption, .z-groupbox-header');
                            for (let i = 0; i < textNodes.length; i++) {
                                const node = textNodes[i];
                                if (node.children.length > 3) continue;
                                const txt = norm(node.innerText || node.textContent || '');
                                if (txt.includes('kabul') && (txt.includes('id') || txt.includes('sorgula') || txt.includes('mektup')) && !txt.includes('kabultarih')) {
                                    // Komşu hücreye bak
                                    const td = node.closest('td');
                                    if (td && td.nextElementSibling && !dInp) {
                                        const adjacentInputs = td.nextElementSibling.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                                        for (let ai = 0; ai < adjacentInputs.length; ai++) {
                                            if (isUsableControl(adjacentInputs[ai])) {
                                                dInp = adjacentInputs[ai];
                                                break;
                                            }
                                        }
                                    }

                                    // En yakın kapsayıcıyı (groupbox, panel, table, form, window) bul
                                    let box = node.closest('.z-groupbox, .z-panel, fieldset, table, form, div.z-window');
                                    if (!box) {
                                        let p = node.parentElement;
                                        while (p && p !== doc.body) {
                                            if (p.querySelector('input:not([type="button"]):not([type="submit"]):not([type="hidden"])')) {
                                                box = p;
                                                break;
                                            }
                                            p = p.parentElement;
                                        }
                                    }

                                    if (box) {
                                        if (!dInp) {
                                            const bInps = box.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                                            for (let j = 0; j < bInps.length; j++) {
                                                if (!isUsableControl(bInps[j])) continue;
                                                const bPh = norm((bInps[j].placeholder || '') + ' ' + (bInps[j].getAttribute('placeholder') || '') + ' ' + (bInps[j].id || '') + ' ' + (bInps[j].name || ''));
                                                if (!bPh.includes('pasaport') && !bPh.includes('tc') && !bPh.includes('dogum')) {
                                                    dInp = bInps[j];
                                                    break;
                                                }
                                            }
                                            if (!dInp) {
                                                for (let j = 0; j < bInps.length; j++) {
                                                    if (isUsableControl(bInps[j])) {
                                                        dInp = bInps[j];
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        if (!dBtn) {
                                            const bBtns = box.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]');
                                            if (bBtns.length > 0) {
                                                for (let j = 0; j < bBtns.length; j++) {
                                                    if (!isUsableControl(bBtns[j])) continue;
                                                    const bTxt = norm(bBtns[j].innerText || bBtns[j].textContent || bBtns[j].value || '');
                                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                                        dBtn = bBtns[j].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || bBtns[j];
                                                        break;
                                                    }
                                                }
                                                if (!dBtn) {
                                                    for (let j = 0; j < bBtns.length; j++) {
                                                        if (!isUsableControl(bBtns[j])) continue;
                                                        dBtn = bBtns[j].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || bBtns[j];
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    if (dInp && dBtn) break;
                                }
                            }
                        }

                        // 4. Biri bulunup diğeri bulunamadıysa ebeveyn ağacında yukarı yürüyerek tamamla
                        if (dBtn && !dInp) {
                            let parent = dBtn.parentElement;
                            while (parent && parent !== doc.body) {
                                const inps = parent.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                                for (let k = 0; k < inps.length; k++) {
                                    if (!isUsableControl(inps[k])) continue;
                                    const itPh = norm(inps[k].placeholder || inps[k].getAttribute('placeholder') || inps[k].value || inps[k].id || '');
                                    if (!itPh.includes('pasaport') && !itPh.includes('tc') && !itPh.includes('dogum')) {
                                        dInp = inps[k];
                                        break;
                                    }
                                }
                                if (dInp) break;
                                parent = parent.parentElement;
                            }
                        }

                        if (dInp && !dBtn) {
                            let parent = dInp.parentElement;
                            while (parent && parent !== doc.body) {
                                const btns = parent.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]');
                                for (let k = 0; k < btns.length; k++) {
                                    if (!isUsableControl(btns[k])) continue;
                                    const bTxt = norm(btns[k].innerText || btns[k].textContent || btns[k].value || '');
                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                        dBtn = btns[k].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || btns[k];
                                        break;
                                    }
                                }
                                if (dBtn) break;
                                if (btns.length > 0) {
                                    for (let k = 0; k < btns.length; k++) {
                                        if (!isUsableControl(btns[k])) continue;
                                        dBtn = btns[k].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || btns[k];
                                        break;
                                    }
                                    if (dBtn) break;
                                }
                                parent = parent.parentElement;
                            }
                        }

                        if (dInp) {
                            inp = dInp;
                            btn = dBtn;
                            targetWin = win;
                            console.log('[YKN MAIN WORLD] Found in doc:', { inp: Boolean(inp), btn: Boolean(btn) });
                            break;
                        }
                    }

                    console.log('[YKN MAIN WORLD] Search summary:', { inp: Boolean(inp), btn: Boolean(btn) });

                    // 5. Input'a değeri yaz. ZK varsa tek bir onChange gönder;
                    // aynı isteği DOM, zAu ve widget üzerinden çoğaltma.
                    let inputWidget = null;
                    let zkChangeSent = false;
                    if (inp) {
                        inp.focus();
                        const nativeSetter = Object.getOwnPropertyDescriptor(targetWin.HTMLInputElement.prototype, 'value')?.set
                            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) {
                            nativeSetter.call(inp, code);
                        } else {
                            inp.value = code;
                        }
                        inp.setAttribute('value', code);
                        inp.dispatchEvent(new Event('focus', { bubbles: true }));
                        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        if (targetWin.zk && targetWin.zk.Widget) {
                            try {
                                inputWidget = targetWin.zk.Widget.$(inp);
                                if (inputWidget) {
                                    if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                                    inputWidget._value = code;
                                    inputWidget._lastValue = code;
                                    if (typeof inputWidget.fire === 'function') {
                                        inputWidget.fire('onChange', { value: code }, { toServer: true });
                                        zkChangeSent = true;
                                    }
                                }
                            } catch (_) {}
                        }
                        if (!zkChangeSent) inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                        try { inp.blur(); } catch (_) {}
                    }

                    // ZK'nin onChange'i işlemesi için kısa bekleme
                    await new Promise(r => setTimeout(r, 150));

                    // Kabul alanı onChange sonrasında ZK tarafından yeniden
                    // oluşturulabilir. Eski input/buton referansına tıklamak
                    // kod ekranda görünse bile aramayı sunucuya göndermez.
                    const refreshedPair = findVisibleAcceptancePair(getAllDocs(document));
                    if (refreshedPair) {
                        inp = refreshedPair.input;
                        targetWin = refreshedPair.win;
                        btn = refreshedPair.button || null;

                        // onChange inputu gerçekten yenilediyse yeni düğüm boş
                        // başlayabilir. Kodu aktif düğüme tekrar yazmadan eski
                        // değeri taşıyan butona basmak aramayı boşa düşürür.
                        if (String(inp.value || '').trim().toUpperCase() !== String(code).trim().toUpperCase()) {
                            const refreshedSetter = Object.getOwnPropertyDescriptor(targetWin.HTMLInputElement.prototype, 'value')?.set
                                || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                            if (refreshedSetter) refreshedSetter.call(inp, code);
                            else inp.value = code;
                            inp.setAttribute('value', code);
                            inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                            if (targetWin.zk && targetWin.zk.Widget) {
                                try {
                                    const refreshedWidget = targetWin.zk.Widget.$(inp);
                                    if (refreshedWidget) {
                                        if (typeof refreshedWidget.setValue === 'function') refreshedWidget.setValue(code);
                                        refreshedWidget._value = code;
                                        refreshedWidget._lastValue = code;
                                        if (typeof refreshedWidget.fire === 'function') {
                                            refreshedWidget.fire('onChange', { value: code }, { toServer: true });
                                        }
                                    }
                                } catch (_) {}
                            }
                        }
                    } else if (btn && !isUsableControl(btn)) {
                        btn = null;
                    }

                    // 6. Butonu tek kez çalıştır. ZK widget bulunduysa doğrudan onu
                    // çalıştırmak, DOM click + zAu + onClick üçlemesini engeller.
                    if (btn) {
                        let buttonWidget = null;
                        if (targetWin.zk && targetWin.zk.Widget) {
                            try {
                                buttonWidget = targetWin.zk.Widget.$(btn);
                                if (!buttonWidget && btn.parentElement) {
                                    buttonWidget = targetWin.zk.Widget.$(btn.parentElement);
                                }
                            } catch (_) {}
                        }
                        if (buttonWidget && typeof buttonWidget.fire === 'function') {
                            buttonWidget.fire('onClick', null, { toServer: true });
                        } else {
                            btn.focus();
                            try { btn.click(); } catch (_) {}
                        }
                    }

                    if (inp && !btn) {
                        // Buton yoksa yalnızca Enter/onOK fallback'i kullan.
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        if (targetWin.zk && targetWin.zk.Widget) {
                            const wi = inputWidget || targetWin.zk.Widget.$(inp);
                            if (wi && typeof wi.fire === 'function') {
                                try { wi.fire('onOK', null, { toServer: true }); } catch (_) {}
                            }
                        }
                    }

                    return {
                        success: Boolean(inp),
                        inputFound: Boolean(inp),
                        buttonFound: Boolean(btn),
                        searchTriggered: Boolean(inp)
                    };
                } catch (e) {
                    console.error('[YKN MAIN World Search Error]', e);
                    return { error: e.message };
                }
            },
            args: [kabulId]
        });
        return results;
    } catch (err) {
        console.warn('executeYoksisSearchInMainWorld error:', err);
        return null;
    }
}

async function syncYoksisFormInMainWorld(tabId, studentData) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return null;
    try {
        const results = await chrome.scripting.executeScript({
            // Form ve alt frameler getAllDocs ile bu tek MAIN-world çalışması
            // içinde ele alınıyor; allFrames ikinci/üçüncü commit üretmesin.
            target: { tabId },
            world: 'MAIN',
            args: [studentData || null],
            func: (data) => {
                try {
                    function getAllDocs(rootDoc) {
                        var docs = [];
                        function scan(d) {
                            if (!d || docs.indexOf(d) !== -1) return;
                            docs.push(d);
                            try {
                                var iframes = d.querySelectorAll('iframe, frame');
                                for (var i = 0; i < iframes.length; i++) {
                                    try {
                                        var cDoc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
                                        if (cDoc) scan(cDoc);
                                    } catch (_) {}
                                }
                            } catch (_) {}
                        }
                        scan(rootDoc || document);
                        return docs;
                    }

                    function norm(s) {
                        return (s || '')
                            .toLocaleLowerCase('tr-TR')
                            .replace(/ğ/g, 'g')
                            .replace(/ü/g, 'u')
                            .replace(/ş/g, 's')
                            .replace(/ö/g, 'o')
                            .replace(/ç/g, 'c')
                            .replace(/ı/g, 'i')
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .replace(/duzenlenme/g, 'duzenleme')
                            .replace(/\s+/g, '');
                    }

                    // Apply ülkeleri çoğunlukla İngilizce, YÖKSİS seçenekleri
                    // Türkçe gösterir. Seçim yapılırken iki yazımı da dene.
                    var countryAliasGroups = [
                        ['afghanistan', 'afganistan'],
                        ['azerbaijan', 'azerbaycan'],
                        ['bulgaria', 'bulgaristan'],
                        ['china', 'cin'],
                        ['egypt', 'misir'],
                        ['georgia', 'gurcistan'],
                        ['greece', 'yunanistan'],
                        ['india', 'hindistan'],
                        ['iraq', 'irak'],
                        ['kazakhstan', 'kazakistan'],
                        ['kyrgyzstan', 'kirgizistan'],
                        ['lebanon', 'lubnan'],
                        ['morocco', 'fas'],
                        ['nigeria', 'nijerya'],
                        ['northmacedonia', 'kuzeymakedonya'],
                        ['palestine', 'filistin'],
                        ['romania', 'romanya'],
                        ['russia', 'rusya'],
                        ['saudiarabia', 'suudiarabistan'],
                        ['somalia', 'somali'],
                        ['syria', 'suriye'],
                        ['tajikistan', 'tacikistan'],
                        ['turkmenistan', 'turkmenistan'],
                        ['ukraine', 'ukrayna'],
                        ['unitedarabemirates', 'birlesikarapemirlikleri'],
                        ['unitedkingdom', 'birlesikkrallik'],
                        ['unitedstates', 'amerika'],
                        ['uzbekistan', 'ozbekistan'],
                        ['zimbabwe', 'zimbabwe']
                    ];

                    function countryVariants(value) {
                        var wanted = norm(value);
                        if (!wanted) return [];
                        for (var gi = 0; gi < countryAliasGroups.length; gi++) {
                            if (countryAliasGroups[gi].indexOf(wanted) !== -1) return countryAliasGroups[gi];
                        }
                        return [wanted];
                    }

                    function commitTextbox(el, win) {
                        if (!el) return;
                        var wWin = win || window;
                        var val = el.value;
                        if (val === undefined || val === null || val === '') return;
                        var widgetCommitted = false;

                        if (wWin.zk && wWin.zk.Widget) {
                            var w = wWin.zk.Widget.$(el);
                            if (w) {
                                w._lastValue = '';
                                w._shallSubmit = true;
                                w._value = val;
                                w.validate_ = function () { return null; };
                                if (w._cst && typeof w._cst === 'object') {
                                    try { w._cst.validate = function () { return null; }; } catch (_) {}
                                }
                                if (typeof w.setValue === 'function') {
                                    try { w.setValue(val); } catch (_) {}
                                }
                                if (typeof w.clearErrorMessage === 'function') {
                                    try { w.clearErrorMessage(true); } catch (_) {}
                                }
                                el.classList.remove('z-textbox-invalid');
                                if (typeof w.updateChange_ === 'function') {
                                    try { w.updateChange_(); } catch (_) {}
                                }
                                var changeSent = false;
                                if (typeof w.fire === 'function') {
                                    try {
                                        w.fire('onChange', { value: val, start: val.length }, { toServer: true });
                                        changeSent = true;
                                        widgetCommitted = true;
                                    } catch (_) {}
                                }
                                if (!changeSent && wWin.zAu && typeof wWin.zAu.send === 'function') {
                                    try {
                                        wWin.zAu.send(new wWin.zk.Event(w, 'onChange', { value: val, start: val.length }, { toServer: true }));
                                        widgetCommitted = true;
                                    } catch (_) {}
                                }
                            }
                        }
                        if (!widgetCommitted) {
                            try {
                                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                            } catch (_) {}
                        }
                    }

                    function commitDatebox(el, win) {
                        if (!el) return;
                        var wWin = win || window;
                        var val = (el.value || '').trim();
                        if (!val) return;

                        var parts = val.split(/[./\-\s]+/);
                        if (parts.length === 3) {
                            var d, m, y;
                            if (parts[0].length === 4) {
                                y = parseInt(parts[0], 10);
                                m = parseInt(parts[1], 10);
                                d = parseInt(parts[2], 10);
                            } else {
                                d = parseInt(parts[0], 10);
                                m = parseInt(parts[1], 10);
                                y = parseInt(parts[2], 10);
                            }

                            if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                                var formatted = ('0' + d).slice(-2) + '.' + ('0' + m).slice(-2) + '.' + y;
                                el.value = formatted;
                                el.setAttribute('value', formatted);
                                var widgetCommitted = false;

                                if (wWin.zk && wWin.zk.Widget) {
                                    var w = wWin.zk.Widget.$(el);
                                    if (w) {
                                        // Varsa önceki geçici ezmeleri temizle; böylece kullanıcı kutuyu sildiğinde
                                        // veya elle yeni bir tarih yazdığında ZK prototipi gerçek DOM değerini okur.
                                        delete w.coerceFromString_;
                                        delete w.coerceToString_;
                                        delete w.getValue;
                                        delete w.getText;
                                        delete w.getRawValue;

                                        w._lastValue = '';
                                        w._shallSubmit = true;
                                        w._defRawVal = formatted;
                                        w._lastChg = formatted;

                                        // ZK'nin dahili tarih nesnesi ayrıştırmasını çağır
                                        try {
                                            if (typeof w.coerceFromString_ === 'function') {
                                                w._value = w.coerceFromString_(formatted);
                                            } else {
                                                w._value = formatted;
                                            }
                                        } catch (_) {
                                            w._value = formatted;
                                        }

                                        if (w.$n('real')) {
                                            w.$n('real').value = formatted;
                                        }
                                        if (typeof w.setText === 'function') {
                                            try { w.setText(formatted); } catch (_) {}
                                        }

                                        if (typeof w.clearErrorMessage === 'function') {
                                            try { w.clearErrorMessage(true); } catch (_) {}
                                        }
                                        if (w._errmsg) {
                                            try { w._errmsg.close(); } catch (_) {}
                                            try { w._errmsg.detach(); } catch (_) {}
                                            w._errmsg = null;
                                        }

                                        el.classList.remove('z-datebox-invalid', 'z-textbox-invalid');
                                        var parentBox = el.closest('.z-datebox');
                                        if (parentBox) {
                                            parentBox.classList.remove('z-datebox-invalid', 'z-textbox-invalid');
                                        }
                                        if (typeof w.updateChange_ === 'function') {
                                            try { w.updateChange_(); } catch (_) {}
                                        }

                                        // ZK sunucusuna ASLA JS Date nesnesi atanmamalıdır;
                                        // JSON.stringify Date nesnesini ISO-8601'e çevirir.
                                        // Doğrudan geçerli string ('dd.MM.yyyy') içeren onChange AU olayı gönder.
                                        var changeSent = false;
                                        if (typeof w.fire === 'function') {
                                            try {
                                                w.fire('onChange', {
                                                    rawValue: formatted,
                                                    value: formatted,
                                                    start: formatted.length
                                                }, { toServer: true });
                                                changeSent = true;
                                                widgetCommitted = true;
                                            } catch (_) {}
                                        }
                                        if (!changeSent && wWin.zAu && typeof wWin.zAu.send === 'function') {
                                            try {
                                                wWin.zAu.send(new wWin.zk.Event(w, 'onChange', {
                                                    rawValue: formatted,
                                                    value: formatted,
                                                    start: formatted.length
                                                }, { toServer: true }));
                                                widgetCommitted = true;
                                            } catch (_) {}
                                        }
                                    }
                                }

                                try {
                                    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                                } catch (_) {}
                                if (wWin.jq) {
                                    try { wWin.jq(el).trigger('change'); } catch (_) {}
                                }
                                purgeErrorBoxes(el.ownerDocument || document);
                            }
                        }
                    }

                    function commitSelect(el, win) {
                        if (!el || !el.value) return;
                        var wWin = win || window;
                        var selIndex = el.selectedIndex;

                        if (selIndex >= 0 && el.options && el.options[selIndex]) {
                            el.options[selIndex].selected = true;
                        }

                        // ZK Widget senkronizasyonu:
                        // ZK Selectbox sunucu tarafında onSelect dinler.
                        // ÖNEMLİ: 'items' dizisine ASLA HTML DOM elemanı (optEl) eklenmemelidir!
                        // ZK Java (SelectEvent.java) items içini Component bekler ve DOM elementi görünce
                        // java.lang.ClassCastException fırlatır.
                        try {
                            if (wWin.zk && wWin.zk.Widget) {
                                var w = wWin.zk.Widget.$(el);
                                if (w) {
                                    // Önceki index'i geçici sıfırla ki ZK değişiklik olduğunu anlasın
                                    w._selectedIndex = -1;

                                    if (typeof w.doChange_ === 'function') {
                                        try { w.doChange_(); } catch (_) {}
                                    }

                                    // ZK Selectbox için standart ve güvenli onSelect:
                                    // Selectbox'ta child component (Listitem) bulunmaz; items her zaman [], reference her zaman null'dır.
                                    if (w.widgetName === 'Selectbox' || (w.className && w.className.indexOf('Selectbox') !== -1)) {
                                        w._selectedIndex = selIndex;
                                        try {
                                            w.fire('onSelect', { items: [], reference: null, selectedIndex: selIndex }, { toServer: true });
                                        } catch (_) {}
                                    } else if (w.widgetName === 'Listbox' || (w.className && w.className.indexOf('Listbox') !== -1)) {
                                        var item = typeof w.getChildAt === 'function' ? w.getChildAt(selIndex) : null;
                                        w._selectedIndex = selIndex;
                                        if (item) {
                                            try {
                                                if (typeof w.setSelectedItems === 'function') w.setSelectedItems([item]);
                                                else if (typeof w.setSelectedItem === 'function') w.setSelectedItem(item);
                                            } catch (_) {}
                                            try {
                                                w.fire('onSelect', { items: [item], reference: item }, { toServer: true });
                                            } catch (_) {}
                                        }
                                    }
                                }
                            }
                        } catch (_) {}

                        // Tarayıcının doğal kullanıcı seçimini tam olarak simüle et
                        try {
                            el.focus();
                            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true, composed: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
                            if (wWin.jq) {
                                try {
                                    wWin.jq(el).trigger('change');
                                    wWin.jq(el).trigger('select');
                                } catch (_) {}
                            }
                            el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true, composed: true }));
                        } catch (_) {}
                    }

                    function commitRadio(el, win) {
                        if (!el) return;
                        var wWin = win || (el.ownerDocument && el.ownerDocument.defaultView) || window;
                        var widgetCommitted = false;
                        try {
                            if (wWin.zk && wWin.zk.Widget) {
                                var w = wWin.zk.Widget.$(el);
                                if (!w && el.id && el.id.indexOf('-real') !== -1) {
                                    w = wWin.zk.Widget.$(el.id.replace(/-real$/, ''));
                                }
                                if (!w && el.parentElement) {
                                    w = wWin.zk.Widget.$(el.parentElement);
                                }
                                if (!w && el.closest) {
                                    w = wWin.zk.Widget.$(el.closest('.z-radio, .z-radiogroup'));
                                }
                                if (w) {
                                    if (typeof w.setChecked === 'function') {
                                        try { w.setChecked(true); } catch (_) {}
                                    }
                                    if (typeof w.setSelected === 'function') {
                                        try { w.setSelected(true); } catch (_) {}
                                    }

                                    var rg = typeof w.getRadiogroup === 'function' ? w.getRadiogroup() : (w.parent || null);
                                    if (rg) {
                                        if (typeof rg.setSelectedItem === 'function') {
                                            try { rg.setSelectedItem(w); } catch (_) {}
                                        }
                                        if (typeof rg.fire === 'function') {
                                            try { rg.fire('onCheck', { selected: w, checked: true }, { toServer: true }); } catch (_) {}
                                        }
                                    }

                                    if (typeof w.fire === 'function') {
                                        try {
                                            w.fire('onCheck', { checked: true }, { toServer: true });
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }

                                    if (typeof w.doClick_ === 'function') {
                                        try {
                                            w.doClick_(new wWin.zk.Event(w, 'click', {}));
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }

                                    if (wWin.zAu && typeof wWin.zAu.send === 'function') {
                                        try {
                                            wWin.zAu.send(new wWin.zk.Event(w, 'onCheck', { checked: true }, { toServer: true }));
                                            if (rg) {
                                                wWin.zAu.send(new wWin.zk.Event(rg, 'onCheck', { selected: w, checked: true }, { toServer: true }));
                                            }
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }
                                }
                            }
                        } catch (_) {}

                        try {
                            el.checked = true;
                            el.dispatchEvent(new wWin.Event('input', { bubbles: true, cancelable: true }));
                            el.dispatchEvent(new wWin.Event('change', { bubbles: true, cancelable: true }));
                            if (wWin.jq) {
                                try {
                                    wWin.jq(el).trigger('change');
                                    wWin.jq(el).trigger('click');
                                } catch (_) {}
                            }
                        } catch (_) {}
                    }

                    function isUsableControl(el, kind) {
                        if (!el) return false;
                        var tag = (el.tagName || '').toLowerCase();
                        var type = (el.type || '').toLowerCase();
                        if (kind === 'radio') return tag === 'input' && type === 'radio';
                        if (kind === 'select') return tag === 'select';
                        if (tag !== 'input' && tag !== 'textarea') return false;
                        return type !== 'hidden' && type !== 'button' && type !== 'submit' &&
                            type !== 'reset' && type !== 'file' && type !== 'checkbox' && type !== 'radio';
                    }

                    function findControlByLabels(targetDoc, labels, kind) {
                        var wanted = (labels || []).map(norm).filter(Boolean);
                        if (!targetDoc || wanted.length === 0) return null;
                        var selector = kind === 'select' ? 'select' : kind === 'radio' ? 'input[type="radio"]' : 'input, textarea';

                        function isExcluded(wantedList, text) {
                            var hasAdiOnly = wantedList.some(function (w) { return w === 'adi' || w === 'ad' || w === 'givenname' || w === 'firstname'; });
                            if (hasAdiOnly && (text.indexOf('anne') !== -1 || text.indexOf('baba') !== -1 || text.indexOf('soyad') !== -1 || text.indexOf('foto') !== -1)) return true;

                            var hasSoyadOnly = wantedList.some(function (w) { return w === 'soyadi' || w === 'soyad' || w === 'lastname' || w === 'surname'; });
                            if (hasSoyadOnly && (text.indexOf('anne') !== -1 || text.indexOf('baba') !== -1)) return true;

                            var hasUyrukOnly = wantedList.some(function (w) { return w === 'uyrugu' || w === 'nationality'; });
                            if (hasUyrukOnly && text.indexOf('dogum') !== -1) return true;

                            var hasVerenUlke = wantedList.some(function (w) { return w.indexOf('ulke') !== -1; });
                            if (hasVerenUlke && text.indexOf('makam') !== -1) return true;

                            var hasVerenMakam = wantedList.some(function (w) { return w.indexOf('makam') !== -1; });
                            if (hasVerenMakam && text.indexOf('ulke') !== -1) return true;

                            var hasBelgeNo = wantedList.some(function (w) { return w === 'belgeno' || w === 'documentno'; });
                            if (hasBelgeNo && (text.indexOf('uyruk') !== -1 || text.indexOf('kimlik') !== -1)) return true;

                            return false;
                        }

                        function matches(text) {
                            var value = norm(text || '');
                            if (!value) return false;
                            if (isExcluded(wanted, value)) return false;
                            var isAdiSearch = wanted.some(function (w) { return w === 'adi' || w === 'ad' || w === 'givenname' || w === 'firstname'; });
                            if (isAdiSearch && (value.indexOf('soyad') !== -1 || value.indexOf('anne') !== -1 || value.indexOf('baba') !== -1)) return false;
                            return wanted.some(function (label) {
                                if (label === 'ad' || label === 'adi') {
                                    return value === 'ad' || value === 'adi' || value === 'ogrenciadi';
                                }
                                return value === label || value.indexOf(label) !== -1;
                            });
                        }

                        // 1. Önce kontrolleri doğrudan tara ve solundaki hücrede (prevTd) etiket ara (YÖKSİS tablo düzeni için en güveniliri)
                        var allControls = targetDoc.querySelectorAll(selector);
                        for (var aci = 0; aci < allControls.length; aci++) {
                            var ctrl = allControls[aci];
                            if (!isUsableControl(ctrl, kind)) continue;
                            if (kind === 'text' && norm(ctrl.getAttribute('placeholder') || '').indexOf('pasaport') !== -1) continue;

                            var targetTd = ctrl.closest ? ctrl.closest('td, th') : null;
                            var prevTd = targetTd ? targetTd.previousElementSibling : null;
                            while (prevTd) {
                                if (prevTd.querySelector('input, select, textarea')) break;
                                var prevText = norm(prevTd.innerText || prevTd.textContent || '');
                                if (matches(prevText)) return ctrl;
                                prevTd = prevTd.previousElementSibling;
                            }
                        }

                        // 2. Explicit label / aria ilişkisi
                        var labelNodes = targetDoc.querySelectorAll('label, dt, strong, b, span.z-label');
                        for (var li = 0; li < labelNodes.length; li++) {
                            var labelNode = labelNodes[li];
                            var labelText = labelNode.innerText || labelNode.textContent || '';
                            if (!matches(labelText)) continue;

                            var forId = labelNode.getAttribute && labelNode.getAttribute('for');
                            if (forId) {
                                var associated = targetDoc.getElementById(forId);
                                if (isUsableControl(associated, kind)) return associated;
                            }

                            var labelledById = labelNode.getAttribute && labelNode.getAttribute('id');
                            if (labelledById) {
                                var byAria = targetDoc.querySelector(selector + '[aria-labelledby~="' + labelledById + '"]');
                                if (isUsableControl(byAria, kind)) return byAria;
                            }

                            var ownControls = labelNode.querySelectorAll(selector);
                            var usableOwnControls = [];
                            for (var oci = 0; oci < ownControls.length; oci++) {
                                if (isUsableControl(ownControls[oci], kind)) usableOwnControls.push(ownControls[oci]);
                            }
                            if (usableOwnControls.length === 1) return usableOwnControls[0];

                            var nextNode = labelNode.nextElementSibling;
                            var nextControl = nextNode && (isUsableControl(nextNode, kind)
                                ? nextNode
                                : nextNode.querySelector && nextNode.querySelector(selector));
                            if (isUsableControl(nextControl, kind)) return nextControl;

                            var parentTd2 = labelNode.closest ? labelNode.closest('td, th') : null;
                            if (parentTd2 && parentTd2.nextElementSibling) {
                                var nextCellControl = parentTd2.nextElementSibling.querySelector(selector);
                                if (isUsableControl(nextCellControl, kind)) return nextCellControl;
                            }
                        }

                        // 3. Satır bazlı tekil kontrol eşleştirmesi
                        var rows = targetDoc.querySelectorAll('tr');
                        for (var ri = 0; ri < rows.length; ri++) {
                            var row = rows[ri];
                            var rowText = row.innerText || row.textContent || '';
                            if (!matches(rowText)) continue;
                            var rowControls = row.querySelectorAll(selector);
                            var usableControls = [];
                            for (var ci = 0; ci < rowControls.length; ci++) {
                                if (isUsableControl(rowControls[ci], kind)) usableControls.push(rowControls[ci]);
                            }
                            if (usableControls.length === 1) return usableControls[0];
                        }

                        // 4. Placeholder / name / id / title eşleştirmesi
                        for (var ai = 0; ai < allControls.length; ai++) {
                            var control = allControls[ai];
                            if (!isUsableControl(control, kind)) continue;
                            var metadata = [control.placeholder, control.name, control.id, control.title].join(' ');
                            if (matches(metadata)) return control;
                        }
                        return null;
                    }

                    function findControl(labels, kind, docs) {
                        for (var fi = 0; fi < docs.length; fi++) {
                            var found = findControlByLabels(docs[fi], labels, kind);
                            if (found) return found;
                        }
                        return null;
                    }

                    function findStudentDocumentNumber(docs) {
                        var compact = function (value) { return norm(value || ''); };
                        for (var di = 0; di < docs.length; di++) {
                            var doc = docs[di];
                            var inputs = doc.querySelectorAll('input');
                            for (var ii = 0; ii < inputs.length; ii++) {
                                var input = inputs[ii];
                                if (!isUsableControl(input, 'text')) continue;
                                var metadata = compact([input.placeholder, input.name, input.id].join(' '));
                                // Soldaki “Pasaport/Belge No” arama kutusu
                                // öğrenci panelindeki aynı etiketle karışmasın.
                                if (metadata.indexOf('pasaport') !== -1) continue;

                                var row = input.closest('tr');
                                var targetCell = input.closest('td, th');
                                var previousCell = targetCell && targetCell.previousElementSibling;
                                while (previousCell) {
                                    var previousText = compact(previousCell.innerText || previousCell.textContent || '');
                                    if (previousText.indexOf('uyrukkimlikno') !== -1) break;
                                    if (previousText === 'belgeno' || previousText.indexOf('belgeno') !== -1) return input;
                                    previousCell = previousCell.previousElementSibling;
                                }

                                var rowText = compact(row && (row.innerText || row.textContent) || '');
                                if (rowText.indexOf('belgeno') !== -1
                                    && rowText.indexOf('uyrukkimlikno') === -1
                                    && rowText.indexOf('pasaport') === -1) {
                                    var rowInputs = row.querySelectorAll('input');
                                    var usableRowInputs = [];
                                    for (var rni = 0; rni < rowInputs.length; rni++) {
                                        if (isUsableControl(rowInputs[rni], 'text')) usableRowInputs.push(rowInputs[rni]);
                                    }
                                    if (usableRowInputs.length === 1) return usableRowInputs[0];
                                }
                            }
                        }

                        // Kart/form düzeninde Belge No etiketi tablo hücresi
                        // olmayabilir. Etikete ait tekil kontrolü bulurken
                        // Uyruk Kimlik No alanını kesinlikle aday yapma.
                        for (var di2 = 0; di2 < docs.length; di2++) {
                            var targetDoc = docs[di2];
                            var documentLabels = targetDoc.querySelectorAll('label, td, th, span, div, dt, b, strong');
                            for (var dli = 0; dli < documentLabels.length; dli++) {
                                var documentLabel = documentLabels[dli];
                                var documentLabelText = compact(documentLabel.innerText || documentLabel.textContent || '');
                                if (documentLabelText.indexOf('belgeno') === -1 || documentLabelText.indexOf('uyrukkimlikno') !== -1) continue;

                                var ownDocumentInputs = documentLabel.querySelectorAll('input');
                                var usableDocumentInputs = [];
                                for (var odi = 0; odi < ownDocumentInputs.length; odi++) {
                                    if (isUsableControl(ownDocumentInputs[odi], 'text')
                                        && !compact(ownDocumentInputs[odi].getAttribute('placeholder') || '').includes('pasaport')) {
                                        usableDocumentInputs.push(ownDocumentInputs[odi]);
                                    }
                                }
                                if (usableDocumentInputs.length === 1) return usableDocumentInputs[0];

                                var documentNext = documentLabel.nextElementSibling;
                                var documentNextInput = documentNext && (isUsableControl(documentNext, 'text')
                                    ? documentNext
                                    : documentNext.querySelector && documentNext.querySelector('input'));
                                if (isUsableControl(documentNextInput, 'text')
                                    && !compact(documentNextInput.getAttribute('placeholder') || '').includes('pasaport')) {
                                    return documentNextInput;
                                }
                            }
                        }
                        return null;
                    }

                    function setNativeValue(el, value) {
                        if (!el || value === undefined || value === null) return false;
                        var textValue = String(value);
                        try {
                            var ownerWin = el.ownerDocument && el.ownerDocument.defaultView || window;
                            var proto = el.tagName && el.tagName.toLowerCase() === 'textarea'
                                ? ownerWin.HTMLTextAreaElement.prototype
                                : ownerWin.HTMLInputElement.prototype;
                            var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                            if (setter) setter.call(el, textValue);
                            else el.value = textValue;
                        } catch (_) {
                            try { el.value = textValue; } catch (_) { return false; }
                        }
                        return String(el.value || '') === textValue;
                    }

                    function formatDateValue(rawValue) {
                        var value = String(rawValue || '').trim();
                        if (!value) return '';
                        var parts = value.split(/[.\/\-\s]+/).filter(Boolean);
                        if (parts.length !== 3) return value;
                        var d, m, y;
                        if (parts[0].length === 4) {
                            y = parts[0]; m = parts[1]; d = parts[2];
                        } else {
                            d = parts[0]; m = parts[1]; y = parts[2];
                        }
                        if (String(y).length === 2) y = Number(y) <= 49 ? '20' + y : '19' + y;
                        return ('0' + d).slice(-2) + '.' + ('0' + m).slice(-2) + '.' + y;
                    }

                    function findRadioByText(docs, value) {
                        var wanted = norm(value);
                        if (!wanted) return null;
                        for (var di = 0; di < docs.length; di++) {
                            var doc = docs[di];
                            var labels = doc.querySelectorAll('label, span, b, strong');
                            for (var li = 0; li < labels.length; li++) {
                                var node = labels[li];
                                var text = norm(node.innerText || node.textContent || '');
                                if (text !== wanted && text.indexOf(wanted) === -1) continue;
                                var forId = node.getAttribute && node.getAttribute('for');
                                var nodeRadios = node.querySelectorAll('input[type="radio"]');
                                var radio = forId
                                    ? doc.getElementById(forId)
                                    : nodeRadios.length === 1 ? nodeRadios[0] : null;
                                if (!radio && node.parentElement) {
                                    radio = node.parentElement.querySelector('input[type="radio"]');
                                }
                                if (!radio && node.closest) {
                                    radio = node.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                                }
                                if (isUsableControl(radio, 'radio')) return radio;
                            }
                            var radios = doc.querySelectorAll('input[type="radio"]');
                            for (var ri = 0; ri < radios.length; ri++) {
                                var radioText = norm([radios[ri].value, radios[ri].id, radios[ri].name].join(' '));
                                if (radioText === wanted || radioText.indexOf(wanted) !== -1) return radios[ri];
                            }
                        }
                        return null;
                    }

                    function selectMatchingOption(select, value) {
                        if (!select || value === undefined || value === null || String(value).trim() === '') return false;
                        var wantedVariants = countryVariants(value);
                        var options = select.options || [];
                        for (var oi = 0; oi < options.length; oi++) {
                            var optionText = norm(options[oi].text || options[oi].value || '');
                            var optionVariants = countryVariants(optionText);
                            var matches = wantedVariants.some(function (wanted) {
                                return optionVariants.some(function (candidate) {
                                    return candidate === wanted || candidate.indexOf(wanted) !== -1 || wanted.indexOf(candidate) !== -1;
                                });
                            });
                            if (matches) {
                                select.value = options[oi].value;
                                select.selectedIndex = oi;
                                try { options[oi].selected = true; } catch (_) {}
                                return Boolean(select.value);
                            }
                        }
                        return false;
                    }

                    function selectedOptionText(select) {
                        if (!select || !select.options) return '';
                        var option = select.options[select.selectedIndex];
                        return String(option && (option.text || option.value) || '').trim();
                    }

                    function addResultField(result, label, filled) {
                        var filledIndex = result.filledFields.indexOf(label);
                        var missingIndex = result.missingFields.indexOf(label);
                        if (filled) {
                            if (filledIndex === -1) result.filledFields.push(label);
                            if (missingIndex !== -1) result.missingFields.splice(missingIndex, 1);
                        } else if (missingIndex === -1) {
                            result.missingFields.push(label);
                        }
                    }

                    function fillTextByLabels(docs, labels, value, result, resultLabel, dateMode) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var control = findControl(labels, 'text', docs);
                        fillTextByControl(control, value, result, resultLabel, dateMode);
                    }

                    function fillTextByControl(control, value, result, resultLabel, dateMode) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        if (!control) {
                            addResultField(result, resultLabel, false);
                            return;
                        }
                        if (control.disabled || control.readOnly) {
                            if (control.value) {
                                addResultField(result, resultLabel, true);
                            }
                            return;
                        }
                        var targetValue = dateMode ? formatDateValue(value) : String(value).trim();
                        var set = setNativeValue(control, targetValue);
                        if (set) {
                            if (dateMode) commitDatebox(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                            else commitTextbox(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                        }
                        addResultField(result, resultLabel, set && String(control.value || '').trim() === targetValue);
                    }

                    function clearTextbox(control, win) {
                        if (!control) return false;
                        var ownerWin = win || control.ownerDocument?.defaultView || window;
                        var cleared = setNativeValue(control, '');
                        var widgetCommitted = false;
                        if (ownerWin.zk && ownerWin.zk.Widget) {
                            try {
                                var widget = ownerWin.zk.Widget.$(control);
                                if (widget) {
                                    delete widget.coerceFromString_;
                                    delete widget.coerceToString_;
                                    delete widget.getValue;
                                    delete widget.getText;
                                    delete widget.getRawValue;
                                    widget._value = '';
                                    widget._lastValue = '';
                                    if (typeof widget.setValue === 'function') widget.setValue('');
                                    if (typeof widget.fire === 'function') {
                                        widget.fire('onChange', { value: '', rawValue: '' }, { toServer: true });
                                        widgetCommitted = true;
                                    }
                                }
                            } catch (_) {}
                        }
                        if (!widgetCommitted) {
                            try {
                                control.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                control.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                            } catch (_) {}
                        }
                        return cleared && String(control.value || '') === '';
                    }

                    function fillSelectByLabels(docs, labels, value, result, resultLabel) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var control = findControl(labels, 'select', docs);
                        var set = Boolean(control && selectMatchingOption(control, value));
                        if (set) commitSelect(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                        addResultField(result, resultLabel, set);
                    }

                    function triggerUserClick(element) {
                        if (!element) return;
                        var doc = element.ownerDocument || document;
                        var win = doc.defaultView || window;
                        try { element.focus(); } catch (_) {}
                        var opts = { bubbles: true, cancelable: true, view: win, buttons: 1 };
                        try { element.dispatchEvent(new win.PointerEvent('pointerdown', opts)); } catch (_) {}
                        try { element.dispatchEvent(new win.MouseEvent('mousedown', opts)); } catch (_) {}
                        try { element.dispatchEvent(new win.PointerEvent('pointerup', opts)); } catch (_) {}
                        try { element.dispatchEvent(new win.MouseEvent('mouseup', opts)); } catch (_) {}
                        try {
                            element.click();
                        } catch (_) {
                            element.dispatchEvent(new win.MouseEvent('click', opts));
                        }
                    }

                    function findGenderControls(doc) {
                        var d = doc || document;
                        var result = {
                            maleRadio: null,
                            maleLabel: null,
                            maleWrapper: null,
                            femaleRadio: null,
                            femaleLabel: null,
                            femaleWrapper: null
                        };

                        var allLabels = d.querySelectorAll('label, .z-radio-content, .z-radio, span, b, strong');
                        for (var i = 0; i < allLabels.length; i++) {
                            var el = allLabels[i];
                            if (el.querySelectorAll('input[type="radio"]').length > 1) continue;
                            var t = norm(el.innerText || el.textContent || '');
                            if (t === 'erkek' || t === 'bay' || t === 'male' || t === 'm') {
                                if (!result.maleLabel || el.tagName === 'LABEL') {
                                    result.maleLabel = el;
                                    var forId = el.getAttribute && el.getAttribute('for');
                                    var radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                                    if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                                    if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                                    if (radio) {
                                        result.maleRadio = radio;
                                        result.maleWrapper = el.closest ? el.closest('.z-radio') : el.parentElement;
                                    }
                                }
                            } else if (t === 'kadin' || t === 'bayan' || t === 'female' || t === 'f') {
                                if (!result.femaleLabel || el.tagName === 'LABEL') {
                                    result.femaleLabel = el;
                                    var forId = el.getAttribute && el.getAttribute('for');
                                    var radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                                    if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                                    if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                                    if (radio) {
                                        result.femaleRadio = radio;
                                        result.femaleWrapper = el.closest ? el.closest('.z-radio') : el.parentElement;
                                    }
                                }
                            }
                        }

                        if (!result.maleRadio || !result.femaleRadio) {
                            var allRadios = d.querySelectorAll('input[type="radio"]');
                            for (var j = 0; j < allRadios.length; j++) {
                                var r = allRadios[j];
                                var parentText = norm(r.parentElement ? r.parentElement.innerText : '');
                                var nextText = norm(r.nextElementSibling ? r.nextElementSibling.innerText : '');
                                var combined = norm([r.value, r.id, r.name, parentText, nextText].join(' '));
                                if (!result.maleRadio && (combined.indexOf('erkek') !== -1 || r.value === 'E' || r.value === '1')) {
                                    result.maleRadio = r;
                                    result.maleWrapper = r.closest ? r.closest('.z-radio') : r.parentElement;
                                    if (!result.maleLabel) result.maleLabel = r.nextElementSibling || r.parentElement;
                                } else if (!result.femaleRadio && (combined.indexOf('kadin') !== -1 || r.value === 'K' || r.value === '2')) {
                                    result.femaleRadio = r;
                                    result.femaleWrapper = r.closest ? r.closest('.z-radio') : r.parentElement;
                                    if (!result.femaleLabel) result.femaleLabel = r.nextElementSibling || r.parentElement;
                                }
                            }
                        }

                        return result;
                    }

                    function fillRadioByValue(docs, value, result, resultLabel) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var normVal = norm(value);
                        var isMale = normVal === 'erkek' || normVal === 'bay' || normVal === 'male' || normVal === 'm';
                        var isFemale = normVal === 'kadin' || normVal === 'bayan' || normVal === 'female' || normVal === 'f';
                        var isGender = isMale || isFemale;
                        var anySet = false;

                        for (var di = 0; di < docs.length; di++) {
                            var doc = docs[di];
                            var win = doc.defaultView || window;

                            if (isGender) {
                                var ctrl = findGenderControls(doc);
                                var targetRadio = isMale ? ctrl.maleRadio : ctrl.femaleRadio;
                                var targetLabel = isMale ? ctrl.maleLabel : ctrl.femaleLabel;
                                var targetWrapper = isMale ? ctrl.maleWrapper : ctrl.femaleWrapper;

                                var oppRadio = isMale ? ctrl.femaleRadio : ctrl.maleRadio;
                                var oppLabel = isMale ? ctrl.femaleLabel : ctrl.maleLabel;
                                var oppWrapper = isMale ? ctrl.femaleWrapper : ctrl.maleWrapper;

                                if (targetRadio || targetLabel) {
                                    // 1. ZK change listener'larını uyandırmak için önce karşı cinsiyeti tıkla
                                    if (oppRadio || oppLabel) {
                                        if (oppRadio) {
                                            oppRadio.checked = true;
                                            if (targetRadio) targetRadio.checked = false;
                                        }
                                        if (oppLabel) triggerUserClick(oppLabel);
                                        else if (oppWrapper) triggerUserClick(oppWrapper);
                                        if (oppRadio) {
                                            triggerUserClick(oppRadio);
                                            commitRadio(oppRadio, win);
                                        }
                                    }

                                    // 2. Hedef cinsiyeti tıkla ve ZK durumuna işle
                                    if (targetRadio) {
                                        targetRadio.checked = true;
                                        if (oppRadio) oppRadio.checked = false;
                                    }
                                    if (targetLabel) triggerUserClick(targetLabel);
                                    else if (targetWrapper) triggerUserClick(targetWrapper);
                                    if (targetRadio) {
                                        triggerUserClick(targetRadio);
                                        commitRadio(targetRadio, win);
                                    }
                                    anySet = true;
                                    continue;
                                }
                            }

                            var radio = findRadioByText([doc], value);
                            if (radio) {
                                triggerUserClick(radio);
                                radio.checked = true;
                                commitRadio(radio, win);
                                anySet = true;
                            }
                        }
                        addResultField(result, resultLabel, anySet);
                    }

                    function purgeErrorBoxes(targetDoc) {
                        try {
                            var d = targetDoc || document;
                            var errorBoxes = d.querySelectorAll('.z-errorbox, [class*="errorbox"]');
                            for (var k = 0; k < errorBoxes.length; k++) {
                                errorBoxes[k].remove();
                            }
                            var invalids = d.querySelectorAll('.z-datebox-invalid, .z-textbox-invalid, [class*="-invalid"]');
                            for (var m = 0; m < invalids.length; m++) {
                                invalids[m].classList.remove('z-datebox-invalid');
                                invalids[m].classList.remove('z-textbox-invalid');
                            }
                            var modals = d.querySelectorAll('.z-window-modal, .z-messagebox-window');
                            for (var n = 0; n < modals.length; n++) {
                                var modalText = (modals[n].innerText || modals[n].textContent || '');
                                if (modalText.indexOf('Form validasyonu') !== -1 || modalText.indexOf('hata oluştu') !== -1 || modalText.indexOf('tarihinden başka') !== -1) {
                                    modals[n].remove();
                                    var masks = d.querySelectorAll('.z-modal-mask');
                                    for (var p = 0; p < masks.length; p++) {
                                        masks[p].remove();
                                    }
                                }
                            }
                        } catch (_) {}
                    }

                    var allDocs = getAllDocs(document);
                    var fillResult = {
                        success: false,
                        filledFields: [],
                        missingFields: [],
                        photoUploaded: false
                    };

                    // Content script izole dünyada DOM'a değer yazabilir ancak
                    // YÖKSİS/ZK bunu sunucu durumuna almayabilir. Bu prepass,
                    // değerleri doğrudan sayfanın gerçek JS dünyasında yazar.
                    if (data) {
                        var passportNo = data.pasaportNo || data.passportNo || '';
                        var foreignIdentityNo = findControl(['Uyruk Kimlik No', 'Yabancı Kimlik No', 'Nationality Identity No'], 'text', allDocs);
                        // Pasaport numarası YÖKSİS'teki Uyruk Kimlik No alanına
                        // yazılmamalı. Eski akış yanlış kutuyu doldurduysa ve
                        // değer pasaportla aynıysa güvenli biçimde temizle.
                        if (foreignIdentityNo && passportNo
                            && norm(foreignIdentityNo.value || '') === norm(passportNo)) {
                            clearTextbox(foreignIdentityNo, foreignIdentityNo.ownerDocument && foreignIdentityNo.ownerDocument.defaultView || window);
                        }
                        var nationalityControl = findControl(['Uyruğu', 'Nationality'], 'select', allDocs);
                        // Kabul sorgusu bazı öğrencilerde yalnızca uyruğu hazırlar.
                        // Apply alanı boşsa bunu kaynak kabul ederek üç ilişkili ülke
                        // alanını aynı seçimle tamamla.
                        var countryValue = data.uyruk || selectedOptionText(nationalityControl);
                        var countryNorm = norm(countryValue);
                        var dogumUlkesiNorm = norm(data.dogumUlkesi || '');
                        var isTurkmen = countryNorm.indexOf('turkmen') !== -1 || countryNorm === 'tkm' || dogumUlkesiNorm.indexOf('turkmen') !== -1 || dogumUlkesiNorm === 'tkm';
                        var isAfghan = countryNorm.indexOf('afgan') !== -1 || countryNorm.indexOf('afghan') !== -1 || dogumUlkesiNorm.indexOf('afgan') !== -1 || dogumUlkesiNorm.indexOf('afghan') !== -1;
                        var isPakistan = countryNorm.indexOf('pakistan') !== -1 || dogumUlkesiNorm.indexOf('pakistan') !== -1;

                        var defaultBirthPlace = isTurkmen ? 'TKM' : (isAfghan ? 'AFG' : (isPakistan ? 'PAK' : ''));
                        var defaultIssuingAuthority = isTurkmen ? 'SMST' : (isAfghan ? 'AFGHAN' : (isPakistan ? 'PAKISTAN' : ''));

                        var birthPlace = data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || defaultBirthPlace;
                        var issuingAuthority = data.verenMakam || data.issuingAuthority || defaultIssuingAuthority;
                        var birthCountry = data.dogumUlkesi || countryValue || '';
                        var firstName = data.firstName || data.ad || data.name || '';
                        var lastName = data.lastName || data.soyad || data.surname || '';

                        fillTextByLabels(allDocs, ['Adı', 'Ad', 'First Name', 'Given Name'], firstName, fillResult, 'Adı', false);
                        fillTextByLabels(allDocs, ['Soyadı', 'Soyad', 'Last Name', 'Surname'], lastName, fillResult, 'Soyadı', false);
                        fillTextByLabels(allDocs, ['Anne Adı', 'Mother Name', "Mother's Name"], data.anneAdi, fillResult, 'Anne Adı', false);
                        fillTextByLabels(allDocs, ['Baba Adı', 'Father Name', "Father's Name"], data.babaAdi, fillResult, 'Baba Adı', false);
                        fillSelectByLabels(allDocs, ['Uyruğu', 'Nationality'], data.uyruk, fillResult, 'Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Uyruğu', 'Birth Nationality'], countryValue, fillResult, 'Doğum Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Yeri Ülkesi', 'Birth Country', 'Born Country'], birthCountry, fillResult, 'Doğum Yeri Ülkesi');
                        fillSelectByLabels(allDocs, ['Belgeyi Veren Ülke', 'Document Issuing Country'], countryValue, fillResult, 'Belgeyi Veren Ülke');
                        fillRadioByValue(allDocs, data.cinsiyet, fillResult, 'Cinsiyet');
                        fillTextByLabels(allDocs, ['Doğum Yeri Açıklaması', 'Place of Birth Description'], birthPlace, fillResult, 'Doğum Yeri Açıklaması', false);
                        fillTextByLabels(allDocs, ['Belgeyi Veren Makam', 'Veren Makam', 'Issuing Authority'], issuingAuthority, fillResult, 'Belgeyi Veren Makam', false);
                        fillTextByLabels(allDocs, ['Telefon No', 'Telefon Numarası', 'Cep Telefonu No', 'Cep Telefonu', 'GSM', 'Telefon'], '5322431261', fillResult, 'Telefon No', false);
                        fillTextByControl(findStudentDocumentNumber(allDocs), passportNo, fillResult, 'Belge No', false);
                        fillTextByLabels(allDocs, ['Doğum Tarihi', 'Date of Birth', 'Birth Date'], data.birthDate, fillResult, 'Doğum Tarihi', true);
                        var issueDate = data.issueDate || data.passportIssueDate || data.duzenlemeTarihi || data.pasaportDuzenlemeTarihi || data.verilisTarihi || data.belgeDuzenlemeTarihi || '';
                        var expiryDate = data.expiryDate || data.passportExpiryDate || data.gecerlilikTarihi || data.pasaportGecerlilikTarihi || data.bitisTarihi || data.belgeGecerlilikTarihi || '';

                        fillTextByLabels(allDocs, [
                            'Belge Düzenleme Tarihi', 'Düzenleme Tarihi', 'Belgenin Düzenleme Tarihi',
                            'Belge Düzenlenme Tarihi', 'Düzenlenme Tarihi', 'Pasaport Düzenleme Tarihi',
                            'Pasaport Düzenlenme Tarihi', 'Pasaport Veriliş Tarihi', 'Belge Veriliş Tarihi',
                            'Veriliş Tarihi', 'Tanzim Tarihi', 'Date of Issue', 'Issue Date'
                        ], issueDate, fillResult, 'Düzenleme Tarihi', true);
                        fillTextByLabels(allDocs, [
                            'Belge Geçerlilik Tarihi', 'Geçerlilik Tarihi', 'Belgenin Geçerlilik Tarihi',
                            'Pasaport Son Geçerlilik Tarihi', 'Pasaport Geçerlilik Tarihi', 'Son Geçerlilik Tarihi',
                            'Pasaport Bitiş Tarihi', 'Belge Bitiş Tarihi', 'Date of Expiry', 'Expiry Date', 'Expiration Date'
                        ], expiryDate, fillResult, 'Geçerlilik Tarihi', true);
                    }

                    for (var di = 0; di < allDocs.length; di++) {
                        var doc = allDocs[di];
                        var win = doc.defaultView || window;

                        // SADECE eklentinin doldurduğu hedeflenmiş alanları senkronize et.
                        var allInputs = doc.querySelectorAll('input');
                        for (var j = 0; j < allInputs.length; j++) {
                            var inp = allInputs[j];
                            var row = inp.closest('tr');
                            var rowText = row ? norm(row.innerText || row.textContent) : '';
                            var placeholder = norm(inp.placeholder || '');
                            var combined = rowText + ' ' + placeholder;

                            if ((inp.type || '').toLowerCase() === 'radio') {
                                if (inp.checked && combined.indexOf('cinsiyet') !== -1) {
                                    commitRadio(inp, win);
                                }
                                continue;
                            }

                            if (combined.indexOf('dogumtarih') !== -1 || combined.indexOf('kabulmektup') !== -1 || combined.indexOf('sorgula') !== -1) {
                                continue;
                            }

                            if (combined.indexOf('duzenle') !== -1 || combined.indexOf('gecerli') !== -1 || combined.indexOf('verilis') !== -1 || combined.indexOf('tanzim') !== -1 || combined.indexOf('bitis') !== -1) {
                                commitDatebox(inp, win);
                                continue;
                            }

                            if (combined.indexOf('anneadi') !== -1 ||
                                combined.indexOf('babaadi') !== -1 ||
                                combined.indexOf('dogumyeriaciklama') !== -1 ||
                                combined.indexOf('verenmakam') !== -1 ||
                                combined.indexOf('telefon') !== -1 ||
                                combined.indexOf('fotograf') !== -1 ||
                                (combined.indexOf('belgeno') !== -1 && combined.indexOf('uyruk') === -1)) {
                                commitTextbox(inp, win);
                            }
                        }

                        // Select alanları input döngüsünde yer almadığı için
                        // özellikle uyruk ve ülke seçimlerini ayrıca commit et.
                        var allSelects = doc.querySelectorAll('select');
                        for (var si = 0; si < allSelects.length; si++) {
                            var selectEl = allSelects[si];
                            var selectRow = selectEl.closest('tr');
                            var selectText = selectRow ? norm(selectRow.innerText || selectRow.textContent) : '';
                            if (selectText.indexOf('uyruk') !== -1 ||
                                selectText.indexOf('dogumyeriulkesi') !== -1 ||
                                selectText.indexOf('belgeyiverenulke') !== -1 ||
                                selectText.indexOf('belgeverenulke') !== -1) {
                                commitSelect(selectEl, win);
                            }
                        }

                        purgeErrorBoxes(doc);

                        // Fotoğraf Yükleme (MAIN World güvencesi)
                        if (data && data.croppedPhotoBase64) {
                            try {
                                var buttons = doc.querySelectorAll('button, a, input[type="button"], span.z-button, div.z-button');
                                var photoBtn = null;
                                for (var b = 0; b < buttons.length; b++) {
                                    var bt = norm(buttons[b].innerText || buttons[b].textContent || buttons[b].value || buttons[b].getAttribute('aria-label') || buttons[b].getAttribute('title') || buttons[b].id || '');
                                    if (bt.indexOf('fotograf') !== -1 && (bt.indexOf('yukle') !== -1 || bt.indexOf('sec') !== -1 || bt.indexOf('ekle') !== -1)) {
                                        photoBtn = buttons[b];
                                        break;
                                    }
                                }

                                if (!photoBtn) {
                                    var allLabels = doc.querySelectorAll('span, td, div, label, b');
                                    for (var l = 0; l < allLabels.length; l++) {
                                        var lt = norm(allLabels[l].innerText || allLabels[l].textContent || '');
                                        if (lt.indexOf('fotografadi') !== -1 || lt === 'fotograf') {
                                            var rowEl = allLabels[l].closest('tr') || allLabels[l].closest('div') || allLabels[l].parentElement;
                                            if (rowEl) {
                                                var btnInRow = rowEl.querySelector('button, a, input[type="button"], .z-button');
                                                if (btnInRow) { photoBtn = btnInRow; break; }
                                            }
                                        }
                                    }
                                }

                                if (photoBtn) {
                                    ['mouseover', 'mouseenter'].forEach(function(evt) {
                                        photoBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: win }));
                                    });
                                }

                                var fileInput = null;
                                var photoWidget = null;
                                if (photoBtn) {
                                    fileInput = photoBtn.querySelector('input[type="file"]') ||
                                                (photoBtn.parentElement && photoBtn.parentElement.querySelector('input[type="file"]'));
                                }

                                if (!fileInput && win.zk && win.zk.Widget && photoBtn) {
                                    var widgetElement = photoBtn;
                                    var wgt = null;
                                    for (var wl = 0; wl < 6 && widgetElement; wl++) {
                                        wgt = win.zk.Widget.$(widgetElement);
                                        if (wgt) break;
                                        widgetElement = widgetElement.parentElement;
                                    }
                                    photoWidget = wgt;
                                    if (wgt) {
                                        if (wgt._uplder) {
                                            var u = wgt._uplder;
                                            fileInput = (u.form && u.form.querySelector('input[type="file"]')) ||
                                                        (u._form && u._form.querySelector('input[type="file"]')) ||
                                                        u.input || u._input;
                                        }
                                        if (!fileInput && wgt.uuid) {
                                            fileInput = doc.querySelector('form[id*="' + wgt.uuid + '"] input[type="file"], input[type="file"][id*="' + wgt.uuid + '"]');
                                        }
                                    }
                                }

                                // Bazı ZK sürümlerinde uploader widget butonda
                                // değil doğrudan gizli file inputunun ebeveyninde
                                // tutulur. Her iki DOM ağacını da tara.
                                if (!photoWidget && fileInput && win.zk && win.zk.Widget) {
                                    var inputWidgetElement = fileInput;
                                    for (var il = 0; il < 6 && inputWidgetElement; il++) {
                                        photoWidget = win.zk.Widget.$(inputWidgetElement);
                                        if (photoWidget) break;
                                        inputWidgetElement = inputWidgetElement.parentElement;
                                    }
                                }

                                if (!fileInput) {
                                    var allFileInputs = doc.querySelectorAll('input[type="file"]');
                                    if (allFileInputs.length === 1) {
                                        fileInput = allFileInputs[0];
                                    } else if (allFileInputs.length > 1 && photoBtn) {
                                        var btnRect = photoBtn.getBoundingClientRect();
                                        var closest = null;
                                        var minDist = Infinity;
                                        for (var k = 0; k < allFileInputs.length; k++) {
                                            var r = allFileInputs[k].getBoundingClientRect();
                                            var d = Math.hypot(r.left - btnRect.left, r.top - btnRect.top);
                                            if (d < minDist) { minDist = d; closest = allFileInputs[k]; }
                                        }
                                        fileInput = closest || allFileInputs[0];
                                    }
                                }

                                if (fileInput) {
                                    var photoName = data.photoFileName || 'ogrenci_foto.jpg';
                                    var photoToken = photoName + '_' + data.croppedPhotoBase64.length + '_' + data.croppedPhotoBase64.slice(-15);
                                    var currentToken = fileInput.getAttribute('data-ykn-photo-token');
                                    var currentStatus = fileInput.getAttribute('data-ykn-photo-status');

                                    if (currentToken === photoToken && currentStatus === 'submitted') {
                                        console.log('[YKN MAIN World] Fotoğraf zaten gönderilmiş, mükerrer istek engellendi:', photoName);
                                        fillResult.photoUploaded = true;
                                    } else {
                                        if (currentToken !== photoToken || !fileInput.files || fileInput.files.length === 0) {
                                            var raw = data.croppedPhotoBase64;
                                            var mime = 'image/jpeg';
                                            var bstr;
                                            if (raw.indexOf(',') !== -1) {
                                                var parts = raw.split(',');
                                                var mm = parts[0].match(/:(.*?);/);
                                                if (mm) mime = mm[1];
                                                bstr = atob(parts[1]);
                                            } else {
                                                bstr = atob(raw);
                                            }
                                            var len = bstr.length;
                                            var u8arr = new Uint8Array(len);
                                            while (len--) {
                                                u8arr[len] = bstr.charCodeAt(len);
                                            }
                                            var photoFile = new File([u8arr], photoName, { type: mime, lastModified: Date.now() });
                                            var dt = new DataTransfer();
                                            dt.items.add(photoFile);
                                            fileInput.files = dt.files;
                                            fileInput.setAttribute('data-ykn-photo-token', photoToken);

                                            fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                            fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                                            if (win.jq) {
                                                try { win.jq(fileInput).trigger('change'); } catch (_) {}
                                            }
                                        }

                                        if (photoBtn && win.zk && win.zk.Widget) {
                                            var btnW = photoWidget;
                                            if (!btnW) {
                                                var btnWidgetElement = photoBtn;
                                                for (var bl = 0; bl < 6 && btnWidgetElement; bl++) {
                                                    btnW = win.zk.Widget.$(btnWidgetElement);
                                                    if (btnW) break;
                                                    btnWidgetElement = btnWidgetElement.parentElement;
                                                }
                                            }
                                            if (btnW && btnW._uplder) {
                                                var uplder = btnW._uplder;
                                                if (!uplder._uploading) {
                                                    if (typeof uplder.start === 'function') {
                                                        uplder.start();
                                                    } else if (typeof uplder._send === 'function') {
                                                        uplder._send();
                                                    } else if (typeof uplder.send === 'function') {
                                                        uplder.send();
                                                    } else if (uplder.form && typeof uplder.form.submit === 'function') {
                                                        uplder.form.submit();
                                                    }
                                                }
                                            }
                                        }
                                        fileInput.setAttribute('data-ykn-photo-status', 'submitted');
                                        fillResult.photoUploaded = Boolean(fileInput.files && fileInput.files.length > 0);
                                        console.log('[YKN MAIN World] Fotoğraf başarıyla yüklendi:', photoName);
                                    }
                                } else {
                                    addResultField(fillResult, 'Fotoğraf', false);
                                }
                            } catch (pErr) {
                                console.warn('[YKN MAIN World Photo Upload Error]', pErr);
                            }
                        }

                        try {
                            if (!doc.__ykn_save_hook_installed) {
                                doc.__ykn_save_hook_installed = true;
                                doc.addEventListener('click', function (e) {
                                    var btn = e.target ? e.target.closest('button, .z-button, a, input[type="button"], input[type="submit"]') : null;
                                    if (btn) {
                                        var txt = norm(btn.innerText || btn.textContent || btn.value || '');
                                        if (txt.indexOf('kaydet') !== -1 || txt.indexOf('guncelle') !== -1) {
                                            purgeErrorBoxes(doc);
                                        }
                                    }
                                }, true);
                            }
                        } catch (_) {}

                        try {
                            if (!doc.__ykn_error_observer_installed) {
                                doc.__ykn_error_observer_installed = true;
                                var winObs = doc.defaultView || window;
                                if (winObs && winObs.MutationObserver) {
                                    var obs = new winObs.MutationObserver(function (mutations) {
                                        for (var mi = 0; mi < mutations.length; mi++) {
                                            var added = mutations[mi].addedNodes;
                                            for (var ai = 0; ai < added.length; ai++) {
                                                var n = added[ai];
                                                if (n && n.nodeType === 1) {
                                                    var isErr = (n.classList && (n.classList.contains('z-errorbox') || String(n.className || '').indexOf('errorbox') !== -1));
                                                    var text = isErr ? (n.innerText || n.textContent || '') : '';
                                                    if (isErr && (text.indexOf('tarihinden başka') !== -1 || text.indexOf('Format:') !== -1)) {
                                                        n.remove();
                                                    } else if (n.querySelectorAll) {
                                                        var errElements = n.querySelectorAll('.z-errorbox, [class*="errorbox"]');
                                                        for (var ei = 0; ei < errElements.length; ei++) {
                                                            var etext = errElements[ei].innerText || errElements[ei].textContent || '';
                                                            if (etext.indexOf('tarihinden başka') !== -1 || etext.indexOf('Format:') !== -1) {
                                                                errElements[ei].remove();
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    });
                                    obs.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
                                    setTimeout(function () {
                                        try { obs.disconnect(); } catch (_) {}
                                    }, 8000);
                                }
                            }
                        } catch (_) {}
                    }

                    fillResult.success = Boolean(
                        !data ||
                        fillResult.filledFields.length > 0 ||
                        (fillResult.missingFields.length === 0 && fillResult.photoUploaded)
                    );
                    return fillResult;
                } catch (e) {
                    console.error('[YKN MAIN World Form Sync Error]', e);
                    return { success: false, filledFields: [], missingFields: [], photoUploaded: false, error: e.message };
                }
            }
        });
        const aggregate = {
            success: false,
            filledFields: [],
            missingFields: [],
            photoUploaded: false
        };
        for (const entry of results || []) {
            const result = entry?.result;
            if (!result) continue;
            aggregate.success = aggregate.success || result.success === true;
            aggregate.photoUploaded = aggregate.photoUploaded || result.photoUploaded === true;
            for (const label of result.filledFields || []) {
                if (!aggregate.filledFields.includes(label)) aggregate.filledFields.push(label);
            }
            for (const label of result.missingFields || []) {
                if (!aggregate.missingFields.includes(label)) aggregate.missingFields.push(label);
            }
        }
        for (const label of aggregate.filledFields) {
            const missingIndex = aggregate.missingFields.indexOf(label);
            if (missingIndex !== -1) aggregate.missingFields.splice(missingIndex, 1);
        }
        aggregate.partial = aggregate.missingFields.length > 0;
        return aggregate;
    } catch (err) {
        console.warn('syncYoksisFormInMainWorld error:', err);
        return { success: false, filledFields: [], missingFields: [], photoUploaded: false, error: err.message };
    }
}

async function searchYoksisFromContent(tabId, kabulId, requestId, options = {}) {
    try {
        await waitForContentScript(tabId, 'yoksis');
        return await withTimeout(
            sendTabMessage(tabId, {
                action: 'searchWithId',
                kabulId,
                waitForForm: options.waitForForm !== false,
                requestId
            }),
            YOKSIS_SEARCH_RESPONSE_TIMEOUT_MS,
            'YÖKSİS arama zaman aşımı'
        );
    } catch (error) {
        console.warn('[YKN] Content-script YÖKSİS araması başarısız:', error);
        return null;
    }
}

async function getYoksisFormState(tabId, requestId) {
    try {
        await waitForContentScript(tabId, 'yoksis');
        const state = await withTimeout(
            sendTabMessage(tabId, { action: 'GET_YOKSIS_FORM_STATE', requestId }),
            3_000,
            'YÖKSİS form durumu okunamadı'
        );
        return state?.success ? state : null;
    } catch (error) {
        console.warn('[YKN] YÖKSİS form durumu okunamadı:', error);
        return null;
    }
}

async function waitForYoksisFormReady(tabId, requestId, options = {}) {
    try {
        await waitForContentScript(tabId, 'yoksis');
        const readiness = await withTimeout(
            sendTabMessage(tabId, {
                action: 'WAIT_YOKSIS_FORM',
                timeoutMs: 10000,
                requestId,
                afterFingerprint: options.afterFingerprint || '',
                afterDomRevision: options.afterDomRevision,
                requireFreshResult: options.requireFreshResult === true
            }),
            11_000,
            'YÖKSİS formu hazır olma zaman aşımı'
        );
        return Boolean(readiness?.formReady);
    } catch (error) {
        console.warn('[YKN] YÖKSİS form hazır olma kontrolü başarısız:', error);
        return false;
    }
}


async function transferToYoksis(request) {
    // Kabul kodu araması arka planda yürür. Kullanıcı fotoğrafı kırpana kadar
    // portal ekranında kalmalı; YÖKSİS yalnızca son doldurma adımında öne alınır.
    const yoksisTab = await getBackgroundYoksisTab();
    const kabulId = String(request.data?.yoksisId || request.data?.kabulId || request.kabulId || '')
        .replace(/[–—−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        // OCR tireyi kaybettiyse "821 EC2 34" biçimini kanonik hale getir.
        .replace(/\s+/g, '-')
        .trim()
        .toUpperCase();
    if (!kabulId) throw new Error('Kabul Mektup ID bulunamadı.');

    return runYoksisOperation(yoksisTab.id, 'search', request.requestId, async () => {
        await new Promise((resolve) => {
            chrome.storage.local.set({ studentData: request.data }, resolve);
        });

        // Öncelik content-script yolunda: arama öncesi/sonrası form imzasını
        // karşılaştırabildiği için eski öğrenci formunu yeni sonuç sanmaz.
        // MAIN world yalnızca bu yol arama kontrolünü hiç bulamazsa fallback'tir.
        const waitForForm = request.waitForForm !== false;
        let response = await searchYoksisFromContent(yoksisTab.id, kabulId, request.requestId, { waitForForm });
        let mainTriggered = false;
        // Content-script eski sürümde yalnızca inputu bulup Enter'a basabiliyor
        // veya butonun ZK görsel parçasını kaçırabiliyor. Buton doğrulanmadıysa
        // MAIN-world taramasını kontrollü tek bir fallback olarak kullan.
        if (response?.searchTriggered !== true) {
            // Content script arama butonunu bulamadıysa MAIN-world fallback'inden
            // hemen önce güncel form durumunu al. Bu baseline, eski öğrenci
            // formunun fallback sonunda "hazır" sayılmasını engeller.
            const stateBeforeMainSearch = await getYoksisFormState(yoksisTab.id, request.requestId);
            if (!stateBeforeMainSearch) {
                throw new Error('YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin.');
            }
            const mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
            mainTriggered = Boolean(mainResults?.some(r => r.result?.searchTriggered === true));
            if (mainTriggered && waitForForm) {
                const formReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId, {
                    afterFingerprint: stateBeforeMainSearch.fingerprint,
                    afterDomRevision: stateBeforeMainSearch.domRevision,
                    requireFreshResult: true
                });
                return {
                    success: true,
                    transferred: true,
                    searchTriggered: true,
                    formReady,
                    formPending: !formReady,
                    message: formReady
                        ? 'Kabul mektup kodu YÖKSİS’e aktarıldı ve yeni öğrenci formu doğrulandı.'
                        : 'Kabul mektup kodu YÖKSİS’e aktarıldı; öğrenci formu bekleniyor.'
                };
            }
        }

        const searchTriggered = response?.searchTriggered === true || mainTriggered;
        if (!searchTriggered) {
            throw new Error('YÖKSİS kabul mektubu araması başlatılamadı. Öğrenci başvuru/kayıt ekranını açık tutup tekrar deneyin.');
        }

        if (waitForForm && response?.searchTriggered === true && response.formReady !== true) {
            const hasFreshBaseline = typeof response.formFingerprintBeforeSearch === 'string'
                && Number.isFinite(response.domRevisionBeforeSearch);
            if (hasFreshBaseline) {
                const delayedFormReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId, {
                    afterFingerprint: response.formFingerprintBeforeSearch,
                    afterDomRevision: response.domRevisionBeforeSearch,
                    requireFreshResult: true
                });
                if (delayedFormReady) {
                    return {
                        success: true,
                        transferred: true,
                        searchTriggered: true,
                        formReady: true,
                        message: 'Kabul mektup kodu YÖKSİS’e aktarıldı ve gecikmeli öğrenci formu doğrulandı.'
                    };
                }
            }
        }

        // Arama tıklaması gönderildiyse portalı yalnızca formun gecikmeli
        // oluşturulması nedeniyle başarısız sayma. Form hazırsa hemen başarı,
        // değilse beklemede başarılı dön; son doldurma adımı yeniden doğrular.
        if (response?.searchTriggered === true) {
            // ZK arama tıklamasını kabul etmiş olabilir ancak öğrenci formunu
            // arka planda birkaç saniye sonra oluşturabilir. Bu durumda portalı
            // bloklamadan sonucu beklemede başarılı bildir; son doldurma adımı
            // YÖKSİS sekmesini öne alıp formu tekrar doğrulayacaktır.
            return {
                success: true,
                transferred: true,
                searchTriggered: true,
                formReady: response.formReady === true,
                formPending: response.formReady !== true,
                message: response.formReady === true
                    ? 'Kabul mektup kodu YÖKSİS’e aktarıldı ve öğrenci formu doğrulandı.'
                    : 'Kabul mektup kodu YÖKSİS’e aktarıldı; öğrenci formu bekleniyor.'
            };
        }

        return {
            success: true,
            transferred: true,
            searchTriggered: true,
            formReady: true,
            message: 'Kabul mektup kodu YÖKSİS\'e aktarıldı ve öğrenci formu doğrulandı.'
        };
    });
}

async function fillYoksisStudentData(studentData, requestId) {
    if (studentData?.yoksisReady !== true) {
        throw new Error('Kabul kodu için doğrulanmış yeni YÖKSİS öğrenci formu yok. Önce kabul kodunu aratın.');
    }

    const yoksisTab = await getForegroundYoksisTab();
    return runYoksisOperation(yoksisTab.id, 'fill', requestId, async () => {
        await saveStudentData(studentData);
        const formReady = await waitForYoksisFormReady(yoksisTab.id, requestId);
        if (!formReady) throw new Error('YÖKSİS öğrenci formu hazır değil; aktarım başlatılmadı.');

        const mainResponse = await syncYoksisFormInMainWorld(yoksisTab.id, studentData);
        const needsFallback = !mainResponse?.success
            || (studentData?.croppedPhotoBase64 && mainResponse.photoUploaded !== true)
            || (mainResponse.missingFields || []).length > 0;
        if (!needsFallback) return { ...mainResponse, mainWorldSynced: true, partial: false };

        let contentResponse;
        try {
            contentResponse = await sendTabMessage(yoksisTab.id, {
                action: 'fillRemainingData',
                data: studentData,
                requestId
            });
        } catch (contentError) {
            return {
                ...mainResponse,
                partial: true,
                error: contentError.message || mainResponse?.error
            };
        }
        const filledFields = Array.from(new Set([
            ...(mainResponse?.filledFields || []),
            ...(contentResponse?.filledFields || [])
        ]));
        const missingFields = Array.from(new Set([
            ...(mainResponse?.missingFields || []),
            ...(contentResponse?.missingFields || [])
        ])).filter((field) => !filledFields.includes(field));
        return {
            ...mainResponse,
            ...contentResponse,
            success: Boolean(mainResponse?.success || contentResponse?.success),
            filledFields,
            missingFields,
            photoUploaded: Boolean(mainResponse?.photoUploaded || contentResponse?.photoUploaded),
            mainWorldSynced: Boolean(mainResponse?.success),
            partial: Boolean(
                mainResponse?.partial
                || contentResponse?.partial
                || missingFields.length > 0
            )
        };
    });
}

async function confirmYoksisReadyForCrop(data, requestId) {
    if (data.yoksisReady === true) return data;

    const yoksisTab = await getForegroundYoksisTab();
    const state = await getYoksisFormState(yoksisTab.id, requestId);
    if (!state?.fingerprint) {
        throw new Error('YÖKSİS öğrenci formu doğrulanamadı. Kabul kodunu aratıp öğrenci formu açıldıktan sonra tekrar deneyin.');
    }
    return { ...data, yoksisReady: true };
}

async function openPassportCropper(data, request) {
    const targetTabId = await getReadyApplyProfileTab();
    const candidateUrls = getPassportCandidateUrls(data);
    if (candidateUrls.length === 0) throw new Error('Pasaport belgesi bulunamadı; fotoğraf kırpma ekranı açılamadı.');

    // Apply profilinde birden fazla pasaport yüklenmiş olabilir. Önceki
    // davranış yalnızca ilk bağlantıyı gösteriyordu; artık erişilebilen tüm
    // belgeler kırpma penceresinde seçilebilir aday olarak saklanır.
    const documents = [];
    const errors = [];
    for (const documentUrl of candidateUrls) {
        try {
            const documentResponse = await sendTabMessage(targetTabId, {
                action: 'FETCH_APPLY_DOCUMENT',
                documentUrl,
                requestId: request.requestId
            });
            if (!documentResponse?.success || !documentResponse.documentBase64) {
                throw new Error(documentResponse?.error || 'Pasaport belgesi alınamadı.');
            }
            documents.push({
                url: documentUrl,
                documentBase64: documentResponse.documentBase64,
                contentType: documentResponse.contentType || 'application/pdf'
            });
        } catch (error) {
            errors.push(error.message);
        }
    }
    if (documents.length === 0) throw new Error(errors.at(-1) || 'Pasaport belgesi alınamadı.');

    await new Promise((resolve) => chrome.storage.local.set({
        pendingPassportCrop: {
            data,
            documents,
            // Eski açık kırpma pencereleriyle geriye dönük uyumluluk.
            documentBase64: documents[0].documentBase64,
            contentType: documents[0].contentType
        }
    }, resolve));
    await createTab({ url: chrome.runtime.getURL('cropper.html') });
}

function isAllowedApplyUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === 'apply.topkapi.edu.tr'
            && parsedUrl.pathname.includes('/applications');
    } catch (error) {
        return false;
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete' || !pendingApplyNavigation) return;
    if (pendingApplyNavigation.tabId !== tabId) return;

    const { requestId } = pendingApplyNavigation;
    pendingApplyNavigation = null;
    discoverApplyDocuments(tabId, requestId).catch((error) => {
        notifyPortal({
            source: 'APPLY_TOPKAPI',
            type: 'EVENT',
            action: 'DOCUMENTS_NOT_FOUND',
            requestId,
            error: error.message
        });
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'OCR_IMAGE') {
        requestPortalOcr(request.imageBase64, request.requestId)
            .then(sendResponse)
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'SYNC_YOKSIS_MAIN_WORLD') {
        // Eski popup sürümleri content-script doldurmasından sonra aynı veriyi
        // MAIN world'de yeniden yazıyordu. Bu işlem artık FILL_YOKSIS_FORM
        // kuyruğunun parçasıdır; bağımsız çağrıyı güvenle no-op yapıyoruz.
        sendResponse({ success: true, skipped: true, message: 'YÖKSİS formu zaten kontrollü aktarım akışında işlenir.' });
        return true;
    }

    // Eklentinin açılır penceresi de portal ile aynı, tekilleştirilmiş arama
    // yolunu kullanır. Böylece YÖKSİS sekmesi kapalıysa popup eski davranıştaki
    // gibi hemen hata vermek yerine sekmeyi açıp arama ekranını bekler.
    if (request.action === 'SEARCH_YOKSIS_FROM_POPUP') {
        transferToYoksis(request)
            .then((response) => sendResponse({ ...response, requestId: request.requestId }))
            .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
        return true;
    }

    if (request.action === 'COPY_APPLY_DATA_AND_FILL_YOKSIS') {
        copyApplyDataWithPassportMetadata(request)
            .then((response) => sendResponse(response))
            .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
        return true;
    }

    if (request.action === 'READ_ACCEPTANCE_AND_FILL_YOKSIS') {
        (async () => {
            const acceptance = await readAcceptanceCodeFromCurrentProfile(request);
            const storedData = await getStoredStudentData();
            const data = mergeStudentData(storedData, {
                kabulId: acceptance.kabulId,
                yoksisId: acceptance.kabulId,
                acceptanceLetterUrl: acceptance.acceptanceDocumentUrl
            });
            const transfer = await transferToYoksis({
                ...request,
                data,
                kabulId: acceptance.kabulId,
                waitForForm: false
            });
            const readyData = {
                ...data,
                yoksisReady: transfer.searchTriggered === true
            };
            await saveStudentData(readyData);

            return {
                ...transfer,
                success: transfer.success !== false,
                requestId: request.requestId,
                kabulId: acceptance.kabulId,
                autoFilled: false,
                filledFields: [],
                missingFields: []
            };
        })()
            .then((response) => sendResponse(response))
            .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
        return true;
    }

    if (request.action === 'CROPPED_PHOTO_CONFIRMED') {
        (async () => {
            const stored = await new Promise((resolve) => chrome.storage.local.get(['studentData', 'pendingPassportCrop'], resolve));
            // Kırpma penceresi, kabul kodu aramasından önce açılmış olabilir.
            // Bu durumda pending kayıt eskiyken studentData güncel YÖKSİS hazır
            // durumunu taşır; güncel kayıt son sözü söylemelidir.
            const pendingData = stored?.pendingPassportCrop?.data || {};
            const currentData = stored?.studentData || {};
            let data = mergeStudentData(mergeStudentData(pendingData, currentData), {
                croppedPhotoBase64: request.photoBase64,
                photoFileName: request.fileName || 'ogrenci_foto.jpg'
            });
            data = await confirmYoksisReadyForCrop(data, request.requestId);
            await saveStudentData(data);
            await new Promise((resolve) => chrome.storage.local.set({ pendingPassportCrop: null }, resolve));
            const fillResponse = await fillYoksisStudentData(data, request.requestId);
            const unavailableFields = Array.from(new Set(data.transferWarnings || []));
            return {
                success: Boolean(fillResponse?.success),
                ...fillResponse,
                partial: Boolean(fillResponse?.partial || unavailableFields.length > 0),
                unavailableFields,
                requestId: request.requestId
            };
        })()
            .then(sendResponse)
            .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
        return true;
    }

    if (request.action === 'FILL_YOKSIS_WITHOUT_PHOTO') {
        (async () => {
            const stored = await new Promise((resolve) => chrome.storage.local.get(['studentData', 'pendingPassportCrop'], resolve));
            const pendingData = stored?.pendingPassportCrop?.data || {};
            const currentData = stored?.studentData || {};
            // studentData, kopyalama adımında güncel Apply profiliyle yeniden
            // yazılır. Eski bir kırpma sekmesinin pending kaydı yeni öğrencide
            // olmayan alanları (ör. eski baba adı veya pasaport numarası)
            // taşımamalı; yalnızca güncel kayıt gerçekten yoksa pending veriye
            // geri dön.
            const merged = hasStudentDataForYoksis(currentData)
                ? currentData
                : mergeStudentData(pendingData, currentData);
            const { croppedPhotoBase64, photoFileName, ...data } = merged;
            const readyData = await confirmYoksisReadyForCrop(data, request.requestId);
            await saveStudentData(readyData);
            const fillResponse = await fillYoksisStudentData(readyData, request.requestId);
            return {
                success: Boolean(fillResponse?.success),
                ...fillResponse,
                requestId: request.requestId,
                manualPhotoRequired: true,
                unavailableFields: ['Fotoğraf'],
                partial: true,
                photoUploaded: false
            };
        })()
            .then(sendResponse)
            .catch((error) => sendResponse({
                success: false,
                requestId: request.requestId,
                manualPhotoRequired: true,
                error: error.message
            }));
        return true;
    }

    // Mesaj İkamet Portalından geliyorsa
    if (request.source === 'IKAMET_PORTAL') {
        ikametTabId = sender.tab ? sender.tab.id : null;
        
        if (request.action === 'SEARCH_STUDENT') {
            startApplySearch(request)
                .then(sendResponse)
                .catch((error) => {
                    notifyPortal({
                        source: 'APPLY_TOPKAPI',
                        type: 'EVENT',
                        action: 'REQUEST_FAILED',
                        requestId: request.requestId,
                        error: error.message
                    });
                    sendResponse({
                        success: false,
                        requestId: request.requestId,
                        error: error.message
                    });
                });
            return true;
        }
        else if (request.action === 'READ_APPLY_DOCUMENT') {
            readApplyDocument(request)
                .then(() => sendResponse({ success: true, requestId: request.requestId }))
                .catch((error) => {
                    notifyPortal({
                        source: 'APPLY_TOPKAPI',
                        type: 'EVENT',
                        action: 'DOCUMENT_READ_FAILED',
                        requestId: request.requestId,
                        error: error.message,
                        data: { documentKind: request.documentKind }
                    });
                    sendResponse({
                        success: false,
                        requestId: request.requestId,
                        error: error.message
                    });
                });
            return true;
        }
        else if (request.action === 'TRANSFER_TO_YOKSIS') {
            transferToYoksis(request)
                .then((response) => sendResponse({ ...response, requestId: request.requestId }))
                .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
            return true;
        }
        else if (request.action === 'COPY_APPLY_DATA' || request.action === 'copyData') {
            (async () => {
                try {
                    let targetTabId = applyTabId;
                    if (!targetTabId) {
                        const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
                        if (tabs.length > 0) targetTabId = tabs[0].id;
                    }
                    if (!targetTabId) throw new Error('Açık bir Apply Topkapı sekmesi bulunamadı.');

                    await waitForContentScript(targetTabId, 'apply');
                    const response = await sendTabMessage(targetTabId, { action: 'copyData' });
                    if (!response || !response.success) {
                        throw new Error(response?.message || 'Apply profilinden bilgiler okunamadı.');
                    }

                    await new Promise((resolve) => {
                        chrome.storage.local.set({ studentData: response.data }, resolve);
                    });

                    sendResponse({ success: true, requestId: request.requestId, data: response.data });
                } catch (error) {
                    sendResponse({ success: false, requestId: request.requestId, error: error.message });
                }
            })();
            return true;
        }
        else if (request.action === 'EXTRACT_KABUL_CODE') {
            (async () => {
                try {
                    let targetTabId = applyTabId;
                    if (!targetTabId) {
                        const tabs = await queryTabs({ url: '*://apply.topkapi.edu.tr/*' });
                        if (tabs.length > 0) targetTabId = tabs[0].id;
                    }
                    if (!targetTabId) throw new Error('Açık bir Apply Topkapı sekmesi bulunamadı.');

                    await waitForContentScript(targetTabId, 'apply');
                    const response = await sendTabMessage(targetTabId, {
                        action: 'GET_KABUL_CODE_OR_DOCUMENT',
                        requestId: request.requestId
                    });
                    sendResponse({ success: true, requestId: request.requestId, ...response });
                } catch (error) {
                    sendResponse({ success: false, requestId: request.requestId, error: error.message });
                }
            })();
            return true;
        }
        else if (request.action === 'OPEN_STUDENT_PROFILE') {
            if (!applyTabId || !isAllowedApplyUrl(request.profileUrl)) {
                sendResponse({
                    success: false,
                    requestId: request.requestId,
                    error: 'Apply öğrenci profil bağlantısı güvenli değil.'
                });
                return true;
            }

            chrome.tabs.get(applyTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false, requestId: request.requestId, error: 'Apply sekmesi bulunamadı.' });
                    return;
                }
                const currentUrl = tab.url ? tab.url.replace(/\/$/, '') : '';
                const targetUrl = request.profileUrl.replace(/\/$/, '');
                if (currentUrl === targetUrl) {
                    discoverApplyDocuments(applyTabId, request.requestId).catch((err) => {
                        notifyPortal({
                            source: 'APPLY_TOPKAPI',
                            type: 'EVENT',
                            action: 'DOCUMENTS_NOT_FOUND',
                            requestId: request.requestId,
                            error: err.message
                        });
                    });
                    sendResponse({ success: true, requestId: request.requestId, alreadyOpen: true });
                    return;
                }

                pendingApplyNavigation = {
                    tabId: applyTabId,
                    requestId: request.requestId
                };
                updateTab(applyTabId, { url: request.profileUrl })
                    .then(() => sendResponse({ success: true, requestId: request.requestId }))
                    .catch((error) => {
                        pendingApplyNavigation = null;
                        discoverApplyDocuments(applyTabId, request.requestId).catch((err) => {
                            notifyPortal({
                                source: 'APPLY_TOPKAPI',
                                type: 'EVENT',
                                action: 'DOCUMENTS_NOT_FOUND',
                                requestId: request.requestId,
                                error: error.message
                            });
                        });
                        sendResponse({ success: true, requestId: request.requestId });
                    });
            });
            return true;
        }
        else if (request.action === 'FILL_YOKSIS_FORM') {
            const studentData = request.data;
            fillYoksisStudentData(studentData, request.requestId)
                .then((response) => {
                sendResponse({ ...response, requestId: request.requestId });
                })
                .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
            return true;
        }
        else if (request.action === 'SAVE_CROPPED_PHOTO') {
            chrome.storage.local.get(['studentData'], (res) => {
                const current = res?.studentData || {};
                current.croppedPhotoBase64 = request.photoBase64;
                current.photoFileName = request.fileName;
                chrome.storage.local.set({ studentData: current }, () => {
                    sendResponse({ success: true, requestId: request.requestId });
                });
            });
            return true;
        }
        else if (request.action === 'SYNC_YOKSIS_MAIN_WORLD') {
            sendResponse({ success: true, skipped: true, requestId: request.requestId });
            return true;
        }
    }
    
    // Mesaj Apply Topkapı (content.js) tarafından geliyorsa İkamet Portala ilet
    else if (request.source === 'APPLY_TOPKAPI') {
        if (request.action === 'OPEN_STUDENT_PROFILE') {
            if (!applyTabId || !isAllowedApplyUrl(request.profileUrl)) {
                sendResponse({ success: false, error: 'URL not allowed' });
                return false;
            }

            chrome.tabs.get(applyTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false, error: 'Tab not found' });
                    return;
                }
                const currentUrl = tab.url ? tab.url.replace(/\/$/, '') : '';
                const targetUrl = request.profileUrl.replace(/\/$/, '');
                if (currentUrl === targetUrl) {
                    discoverApplyDocuments(applyTabId, request.requestId).catch((err) => {
                        notifyPortal({
                            source: 'APPLY_TOPKAPI',
                            type: 'EVENT',
                            action: 'DOCUMENTS_NOT_FOUND',
                            requestId: request.requestId,
                            error: err.message
                        });
                    });
                    return;
                }

                pendingApplyNavigation = {
                    tabId: applyTabId,
                    requestId: request.requestId
                };
                updateTab(applyTabId, { url: request.profileUrl }).catch((error) => {
                    pendingApplyNavigation = null;
                    discoverApplyDocuments(applyTabId, request.requestId).catch((err) => {
                        notifyPortal({
                            source: 'APPLY_TOPKAPI',
                            type: 'EVENT',
                            action: 'DOCUMENTS_NOT_FOUND',
                            requestId: request.requestId,
                            error: error.message
                        });
                    });
                });
            });
            sendResponse({ success: true });
            return false;
        }

        notifyPortal(request);
        sendResponse({ success: true });
        return false;
    }
    
    return false;
});
