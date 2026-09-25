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
    if (operation !== 'search' && yoksisOperationResults.has(key)) return yoksisOperationResults.get(key);

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
        'acceptanceCandidates',
        'medeniHali',
        'medeniHal'
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
    return ['fullName', 'anneAdi', 'babaAdi', 'uyruk', 'dogumUlkesi', 'cinsiyet', 'medeniHali', 'pasaportNo', 'passportNo', 'birthDate']
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
    if (metadata.medeniHali) {
        enriched.medeniHali = metadata.medeniHali;
        enriched.medeniHal = metadata.medeniHali;
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

function getActiveTransferWarnings(data) {
    if (!data) return [];
    const rawWarnings = Array.isArray(data.transferWarnings) ? data.transferWarnings : [];
    if (rawWarnings.length === 0) return [];

    const hasIssueDate = Boolean((data.issueDate || data.passportIssueDate || data.duzenlemeTarihi || data.pasaportDuzenlemeTarihi || data.verilisTarihi || data.belgeDuzenlemeTarihi || '').trim());
    const hasExpiryDate = Boolean((data.expiryDate || data.passportExpiryDate || data.gecerlilikTarihi || data.pasaportGecerlilikTarihi || data.bitisTarihi || data.belgeGecerlilikTarihi || '').trim());
    const hasBirthPlace = Boolean((data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || '').trim());
    const hasAuthority = Boolean((data.verenMakam || data.issuingAuthority || '').trim());

    return rawWarnings.filter((warning) => {
        const wNorm = String(warning || '').toLocaleLowerCase('tr-TR');
        if (wNorm.includes('düzenle') || wNorm.includes('duzenle') || wNorm.includes('veriliş') || wNorm.includes('verilis')) {
            return !hasIssueDate;
        }
        if (wNorm.includes('geçerli') || wNorm.includes('gecerli') || wNorm.includes('bitiş') || wNorm.includes('bitis')) {
            return !hasExpiryDate;
        }
        if (wNorm.includes('doğum yeri') || wNorm.includes('dogum yeri')) {
            return !hasBirthPlace;
        }
        if (wNorm.includes('makam') || wNorm.includes('authority')) {
            return !hasAuthority;
        }
        return true;
    });
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
                requestId: request.requestId,
                fromPortal: Boolean(request?.fromPortal || request?.source === 'IKAMET_PORTAL'),
                fastOnly: true
            });
            if (passportResponse?.success) {
                const metadata = passportResponse.metadata || {};
                passportMetadata = {
                    ...metadata,
                    missingFields: passportResponse.missingFields || []
                };
                enrichedData = applyPassportMetadata(enrichedData, metadata);
                if (passportResponse.documentBase64) {
                    enrichedData.prefetchedDocuments = [{
                        url: passportResponse.documentUrl || applyResponse.data.passportDocumentUrl,
                        documentBase64: passportResponse.documentBase64,
                        contentType: passportResponse.contentType || 'application/pdf'
                    }];
                }
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

    const cropResult = await openPassportCropper(enrichedData, request);
    const isFromPortal = request?.source === 'IKAMET_PORTAL' || request?.fromPortal === true;

    return {
        success: true,
        requestId: request.requestId,
        data: enrichedData,
        passportMetadata,
        documents: cropResult?.documents || [],
        autoFilled: false,
        cropperOpened: true,
        openInTab: !isFromPortal,
        inPageCropper: isFromPortal,
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

async function reloadYoksisTab(tabId) {
    // YÖKSİS tek sayfa (ZK SPA) olduğu için sekme yenilenirse (F5) ana sayfaya döner
    // ve "Öğrenciler İçin YKN Talep Ekranı" kaybolur. Bu yüzden sekme ASLA yenilenmez!
    console.warn('[YKN] reloadYoksisTab çağrısı engellendi - sekme yenilenmeyecek.');
}

async function executeYoksisSearchInMainWorld(tabId, kabulId) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return null;
    try {
        const results = await chrome.scripting.executeScript({
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
                        if (element.classList?.contains('z-textbox-disd') || element.classList?.contains('z-button-disd')) return false;
                        let current = element;
                        for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
                            if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
                            if (current.classList?.contains('z-disabled') || current.getAttribute('disabled') !== null) return false;
                            const inlineStyle = current.style;
                            if (inlineStyle?.display === 'none' || inlineStyle?.visibility === 'hidden') return false;
                            try {
                                const style = (current.ownerDocument?.defaultView || window).getComputedStyle(current);
                                if (style?.display === 'none' || style?.visibility === 'hidden') return false;
                            } catch (_) {}
                        }
                        return true;
                    }

                    // Formun "Temizle" butonunu bul (Kaydet butonunun yanındaki Temizle)
                    // Tablo filtre temizle butonuyla karışmaması için Kaydet ile olan yakınlığı kontrol edilir
                    function findFormClearButton(docs) {
                        for (const doc of docs) {
                            const win = doc.defaultView || window;
                            const allClickables = doc.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button');
                            let kaydetBtn = null;
                            for (let i = 0; i < allClickables.length; i++) {
                                const b = allClickables[i];
                                if (!isUsableControl(b)) continue;
                                const txt = norm(b.innerText || b.textContent || b.value || b.getAttribute('title') || '');
                                if (txt === 'kaydet' || txt.startsWith('kaydet')) {
                                    kaydetBtn = b.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || b;
                                    break;
                                }
                            }

                            if (kaydetBtn) {
                                let container = kaydetBtn.parentElement;
                                for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
                                    const candidates = container.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button');
                                    for (let j = 0; j < candidates.length; j++) {
                                        const c = candidates[j];
                                        if (c === kaydetBtn) continue;
                                        if (!isUsableControl(c)) continue;
                                        const cTxt = norm(c.innerText || c.textContent || c.value || c.getAttribute('title') || '');
                                        if (cTxt === 'temizle') {
                                            const targetBtn = c.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || c;
                                            return { btn: targetBtn, win };
                                        }
                                    }
                                }
                            }

                            // Fallback: Kaydet bulunamazsa, tablo toolbar'ında olmayan Temizle butonunu bul
                            for (let i = 0; i < allClickables.length; i++) {
                                const c = allClickables[i];
                                if (!isUsableControl(c)) continue;
                                const txt = norm(c.innerText || c.textContent || c.value || c.getAttribute('title') || '');
                                if (txt === 'temizle' || txt === 'yeni kayit') {
                                    const container = c.closest('tr, .z-row, div, table');
                                    const containerText = norm(container?.innerText || container?.textContent || '');
                                    if (containerText.includes('excel') || containerText.includes('yil') || containerText.includes('ykn')) continue;
                                    const targetBtn = c.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || c;
                                    return { btn: targetBtn, win };
                                }
                            }
                        }
                        return null;
                    }

                    function triggerButton(targetBtn, win) {
                        if (!targetBtn) return;
                        const wWin = win || (targetBtn.ownerDocument && targetBtn.ownerDocument.defaultView) || window;
                        const actualBtn = targetBtn.querySelector?.('button, input[type="button"], a, [role="button"]') || targetBtn;
                        if (wWin.zk && wWin.zk.Widget) {
                            try {
                                const w = wWin.zk.Widget.$(actualBtn) || wWin.zk.Widget.$(targetBtn) || (targetBtn.parentElement ? wWin.zk.Widget.$(targetBtn.parentElement) : null);
                                if (w && typeof w.fire === 'function') {
                                    w.fire('onClick', {}, { toServer: true });
                                }
                                if (wWin.zAu && typeof wWin.zAu.send === 'function' && w && wWin.zk?.Event) {
                                    wWin.zAu.send(new wWin.zk.Event(w, 'onClick', {}, { toServer: true }));
                                }
                            } catch (_) {}
                        }
                        try {
                            actualBtn.focus();
                            actualBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: wWin, button: 0 }));
                            actualBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: wWin, button: 0 }));
                            actualBtn.click();
                        } catch (_) {}
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
                            const clickables = container.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"], table.z-button');
                            for (let i = 0; i < clickables.length; i += 1) {
                                const candidate = clickables[i];
                                if (!isUsableControl(candidate)) continue;
                                const text = norm(candidate.innerText || candidate.textContent || candidate.value || '');
                                if (text.includes('kabul') || text.includes('ara') || text.includes('sorgula') || text.includes('getir') || text.includes('bul')) {
                                    return candidate.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || candidate;
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
                                if (candidate.closest('.z-grid-body, .z-listbox-body')) continue;
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
                                    || metadata.includes('dogum')
                                    || metadata.includes('tarih')) continue;
                                let searchBtn = findVisibleSearchButton(candidate);
                                if (!searchBtn) {
                                    const allClickables = doc.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"], table.z-button');
                                    for (let ci = 0; ci < allClickables.length; ci++) {
                                        const c = allClickables[ci];
                                        if (!isUsableControl(c)) continue;
                                        const cTxt = norm(c.innerText || c.textContent || c.value || '');
                                        if (cTxt.includes('kabul') && (cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || cTxt.includes('bul'))) {
                                            searchBtn = c.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || c;
                                            break;
                                        }
                                    }
                                }
                                return {
                                    input: candidate,
                                    button: searchBtn,
                                    win: doc.defaultView || window
                                };
                            }
                        }
                        return null;
                    }

                    const allDocs = getAllDocs(document);
                    let inp = null;
                    let btn = null;
                    let targetWin = window;

                    // 1. ÖNCELİK: "Kabul Mektup Id İle Ara" butonu ve onun ait olduğu panel/satırdaki input
                    for (const doc of allDocs) {
                        const win = doc.defaultView || window;
                        const allClickables = doc.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"], table.z-button');
                        for (let i = 0; i < allClickables.length; i++) {
                            const c = allClickables[i];
                            if (!isUsableControl(c)) continue;
                            const cTxt = norm(c.innerText || c.textContent || c.value || '');
                            if (cTxt.includes('kabul') && (cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || cTxt.includes('bul'))) {
                                const foundBtn = c.closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button') || c;
                                let container = foundBtn.parentElement;
                                for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
                                    const inps = container.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                                    for (let j = 0; j < inps.length; j++) {
                                        const it = inps[j];
                                        if (!isUsableControl(it) || it.closest('.z-grid-body, .z-listbox-body')) continue;
                                        const ph = norm([it.placeholder, it.name, it.id, it.title].join(' '));
                                        if (ph.includes('pasaport') || ph.includes('tc') || ph.includes('dogum') || ph.includes('tarih')) continue;
                                        inp = it;
                                        btn = foundBtn;
                                        targetWin = win;
                                        break;
                                    }
                                    if (inp) break;
                                }
                                if (inp) break;
                            }
                        }
                        if (inp) break;
                    }

                    // 2. ÖNCELİK: "Kabul Mektup ID ile Sorgula" kutusu / başlığı üzerinden arama
                    if (!inp) {
                        for (const doc of allDocs) {
                            const win = doc.defaultView || window;
                            const headers = doc.querySelectorAll('.z-groupbox-header, .z-caption, legend, caption, span, td, div, label, b, strong');
                            for (let i = 0; i < headers.length; i++) {
                                const h = headers[i];
                                if (h.children.length > 3) continue;
                                const hTxt = norm(h.innerText || h.textContent || '');
                                if (hTxt.includes('kabul') && (hTxt.includes('id') || hTxt.includes('mektup') || hTxt.includes('sorgula')) && !hTxt.includes('tarih')) {
                                    const box = h.closest('.z-groupbox, .z-panel, fieldset, table, form, .z-window') || h.parentElement?.parentElement;
                                    if (box) {
                                        const inps = box.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                                        for (let j = 0; j < inps.length; j++) {
                                            if (!isUsableControl(inps[j]) || inps[j].closest('.z-grid-body, .z-listbox-body')) continue;
                                            const ph = norm([inps[j].placeholder, inps[j].name, inps[j].id].join(' '));
                                            if (ph.includes('pasaport') || ph.includes('tc') || ph.includes('dogum') || ph.includes('tarih')) continue;
                                            inp = inps[j];
                                            break;
                                        }
                                        const btns = box.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"], table.z-button');
                                        for (let j = 0; j < btns.length; j++) {
                                            if (!isUsableControl(btns[j])) continue;
                                            const bTxt = norm(btns[j].innerText || btns[j].textContent || btns[j].value || '');
                                            if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                                btn = btns[j].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || btns[j];
                                                break;
                                            }
                                        }
                                    }
                                    if (inp && btn) {
                                        targetWin = win;
                                        break;
                                    }
                                }
                            }
                            if (inp) break;
                        }
                    }

                    // 3. ÖNCELİK: findVisibleAcceptancePair fallback
                    if (!inp) {
                        const pair = findVisibleAcceptancePair(allDocs);
                        if (pair && pair.input) {
                            inp = pair.input;
                            btn = pair.button || btn;
                            targetWin = pair.win || window;
                        }
                    }

                    if (inp && !btn) {
                        btn = findVisibleSearchButton(inp);
                    }

                    console.log('[YKN MAIN WORLD] Search summary:', { inp: Boolean(inp), btn: Boolean(btn) });

                    if (!inp || !btn) {
                        return {
                            success: false,
                            inputFound: Boolean(inp),
                            buttonFound: Boolean(btn),
                            searchTriggered: false
                        };
                    }

                    // Input'a değeri yaz
                    let inputWidget = null;
                    if (inp) {
                        inp.focus();
                        const nativeSetter = Object.getOwnPropertyDescriptor(targetWin.HTMLInputElement.prototype, 'value')?.set
                            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

                        // 1. Önce alanı temizle
                        if (nativeSetter) {
                            nativeSetter.call(inp, '');
                        } else {
                            inp.value = '';
                        }
                        inp.setAttribute('value', '');
                        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

                        if (targetWin.zk && targetWin.zk.Widget) {
                            try {
                                inputWidget = targetWin.zk.Widget.$(inp);
                                if (inputWidget) {
                                    inputWidget._lastValue = '';
                                    inputWidget._value = '';
                                    inputWidget._shallSubmit = true;
                                }
                            } catch (_) {}
                        }

                        // 2. Yeni değeri yaz
                        if (nativeSetter) {
                            nativeSetter.call(inp, code);
                        } else {
                            inp.value = code;
                        }
                        inp.setAttribute('value', code);
                        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                        if (inputWidget) {
                            try {
                                if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                                inputWidget._value = code;
                                inputWidget._lastValue = '';
                                if (typeof inputWidget.fire === 'function') {
                                    inputWidget.fire('onChange', { value: code, start: code.length }, { toServer: true });
                                }
                                if (targetWin.zAu && typeof targetWin.zAu.send === 'function' && targetWin.zk?.Event) {
                                    targetWin.zAu.send(new targetWin.zk.Event(inputWidget, 'onChange', { value: code, start: code.length }, { toServer: true }));
                                }
                            } catch (_) {}
                        }

                        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                        try { inp.blur(); } catch (_) {}
                    }

                    // ZK'nin onChange'i işlemesi için kısa bekleme
                    await new Promise(r => setTimeout(r, 200));

                    // Butonu ve aramayı ZK Widget + zAu + DOM ile çalıştır
                    if (btn) {
                        triggerButton(btn, targetWin);
                    }

                    if (inp) {
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        if (targetWin.zk && targetWin.zk.Widget) {
                            const wi = inputWidget || targetWin.zk.Widget.$(inp);
                            if (wi && typeof wi.fire === 'function') {
                                try { wi.fire('onOK', {}, { toServer: true }); } catch (_) {}
                            }
                        }
                    }

                    const finalVal = norm(inp?.value || '');
                    const codeNorm = norm(code || '');
                    const valueConfirmed = finalVal.includes(codeNorm);

                    return {
                        success: Boolean(valueConfirmed && btn),
                        inputFound: Boolean(inp),
                        buttonFound: Boolean(btn),
                        searchTriggered: Boolean(valueConfirmed && btn)
                    };
                } catch (e) {
                    console.error('[YKN MAIN World Search Error]', e);
                    return { error: e.message, searchTriggered: false };
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
                            .replace(/[^a-z0-9]/g, '');
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

                        var parts = val.split(/[./\-\s]+/).filter(Boolean);
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
                            if (y < 100) y = y <= 49 ? 2000 + y : 1900 + y;

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
                            el.focus();
                            el.click();
                        } catch (_) {}

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
                                        if (typeof rg._fixCheck === 'function') {
                                            try { rg._fixCheck(w); } catch (_) {}
                                        }
                                        if (typeof rg.fire === 'function') {
                                            try {
                                                rg.fire('onCheck', { items: [w], reference: w }, { toServer: true });
                                                widgetCommitted = true;
                                            } catch (_) {}
                                        }
                                    } else {
                                        if (typeof w.fire === 'function') {
                                            try {
                                                w.fire('onCheck', { checked: true }, { toServer: true });
                                                widgetCommitted = true;
                                            } catch (_) {}
                                        }
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

                        // 1. Cinsiyet etiketini içeren satırı (tr veya div) bul
                        var allLabels = d.querySelectorAll('label, span, td, div, b, strong');
                        var genderRow = null;
                        for (var i = 0; i < allLabels.length; i++) {
                            var txt = norm(allLabels[i].innerText || allLabels[i].textContent || '');
                            if (txt === 'cinsiyet' || txt === 'cinsiyeti' || txt === 'gender' || txt.indexOf('cinsiyet') !== -1) {
                                var row = allLabels[i].closest('tr') || allLabels[i].closest('.z-row') || allLabels[i].closest('.form-group') || allLabels[i].parentElement;
                                if (row && row.querySelectorAll('input[type="radio"]').length >= 2) {
                                    genderRow = row;
                                    break;
                                } else if (!genderRow && row) {
                                    genderRow = row;
                                }
                            }
                        }

                        var scope = genderRow || d;
                        var radios = scope.querySelectorAll('input[type="radio"]');
                        for (var j = 0; j < radios.length; j++) {
                            var r = radios[j];
                            var wrapper = r.closest ? r.closest('.z-radio') : r.parentElement;
                            var specificLabel = (r.labels && r.labels[0])
                                || (r.id ? d.querySelector('label[for="' + r.id + '"]') : null)
                                || (wrapper ? wrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null)
                                || (r.nextElementSibling && (r.nextElementSibling.tagName === 'LABEL' || r.nextElementSibling.classList.contains('z-radio-cnt')) ? r.nextElementSibling : null);
                            var rText = norm((specificLabel ? (specificLabel.innerText || specificLabel.textContent) : '') + ' ' + (r.id || '') + ' ' + (r.value || ''));
                            if (rText.indexOf('erkek') !== -1 || rText.indexOf('male') !== -1 || rText === 'e' || rText === 'm') {
                                result.maleRadio = r;
                                result.maleWrapper = wrapper;
                                result.maleLabel = specificLabel || wrapper;
                            } else if (rText.indexOf('kadin') !== -1 || rText.indexOf('female') !== -1 || rText === 'k' || rText === 'f') {
                                result.femaleRadio = r;
                                result.femaleWrapper = wrapper;
                                result.femaleLabel = specificLabel || wrapper;
                            }
                        }

                        // YÖKSİS standardında 1. radyo Erkek, 2. radyo Kadın'dır
                        if (genderRow && radios.length >= 2) {
                            if (!result.maleRadio) {
                                result.maleRadio = radios[0];
                                result.maleWrapper = radios[0].closest ? radios[0].closest('.z-radio') : radios[0].parentElement;
                                result.maleLabel = (result.maleWrapper ? result.maleWrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null) || radios[0].nextElementSibling || result.maleWrapper;
                            }
                            if (!result.femaleRadio) {
                                result.femaleRadio = radios[1];
                                result.femaleWrapper = radios[1].closest ? radios[1].closest('.z-radio') : radios[1].parentElement;
                                result.femaleLabel = (result.femaleWrapper ? result.femaleWrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null) || radios[1].nextElementSibling || result.femaleWrapper;
                            }
                        }

                        return result;
                    }

                    function findMaritalControls(doc) {
                        var d = doc || document;
                        var result = {
                            singleRadio: null,
                            singleLabel: null,
                            singleWrapper: null,
                            marriedRadio: null,
                            marriedLabel: null,
                            marriedWrapper: null
                        };

                        // 1. Medeni Hali etiketini içeren satırı (tr veya div) bul
                        var allLabels = d.querySelectorAll('label, span, td, div, b, strong');
                        var maritalRow = null;
                        for (var i = 0; i < allLabels.length; i++) {
                            var txt = norm(allLabels[i].innerText || allLabels[i].textContent || '');
                            if (txt === 'medenihali' || txt === 'medenihal' || txt === 'maritalstatus' || txt.indexOf('medeni') !== -1 || txt.indexOf('marital') !== -1) {
                                var row = allLabels[i].closest('tr') || allLabels[i].closest('.z-row') || allLabels[i].closest('.form-group') || allLabels[i].parentElement;
                                if (row && row.querySelectorAll('input[type="radio"]').length >= 2) {
                                    maritalRow = row;
                                    break;
                                } else if (!maritalRow && row) {
                                    maritalRow = row;
                                }
                            }
                        }

                        var scope = maritalRow || d;
                        var radios = scope.querySelectorAll('input[type="radio"]');
                        for (var j = 0; j < radios.length; j++) {
                            var r = radios[j];
                            var wrapper = r.closest ? r.closest('.z-radio') : r.parentElement;
                            var specificLabel = (r.labels && r.labels[0])
                                || (r.id ? d.querySelector('label[for="' + r.id + '"]') : null)
                                || (wrapper ? wrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null)
                                || (r.nextElementSibling && (r.nextElementSibling.tagName === 'LABEL' || r.nextElementSibling.classList.contains('z-radio-cnt')) ? r.nextElementSibling : null);
                            var rText = norm((specificLabel ? (specificLabel.innerText || specificLabel.textContent) : '') + ' ' + (r.id || '') + ' ' + (r.value || ''));
                            if (rText.indexOf('bekar') !== -1 || rText.indexOf('single') !== -1 || rText === 'b') {
                                result.singleRadio = r;
                                result.singleWrapper = wrapper;
                                result.singleLabel = specificLabel || wrapper;
                            } else if (rText.indexOf('evli') !== -1 || rText.indexOf('married') !== -1 || rText === 'e') {
                                result.marriedRadio = r;
                                result.marriedWrapper = wrapper;
                                result.marriedLabel = specificLabel || wrapper;
                            }
                        }

                        // YÖKSİS standardında 1. radyo Bekar, 2. radyo Evli'dir
                        if (maritalRow && radios.length >= 2) {
                            if (!result.singleRadio) {
                                result.singleRadio = radios[0];
                                result.singleWrapper = radios[0].closest ? radios[0].closest('.z-radio') : radios[0].parentElement;
                                result.singleLabel = (result.singleWrapper ? result.singleWrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null) || radios[0].nextElementSibling || result.singleWrapper;
                            }
                            if (!result.marriedRadio) {
                                result.marriedRadio = radios[1];
                                result.marriedWrapper = radios[1].closest ? radios[1].closest('.z-radio') : radios[1].parentElement;
                                result.marriedLabel = (result.marriedWrapper ? result.marriedWrapper.querySelector('label, .z-radio-cnt, .z-radio-content') : null) || radios[1].nextElementSibling || result.marriedWrapper;
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
                        var isBekar = normVal === 'bekar' || normVal === 'single' || normVal === 'b';
                        var isEvli = normVal === 'evli' || normVal === 'married' || normVal === 'e';
                        var isMarital = isBekar || isEvli;
                        var anySet = false;

                        for (var di = 0; di < docs.length; di++) {
                            var doc = docs[di];
                            var win = doc.defaultView || window;

                            if (isGender || isMarital) {
                                var ctrl = isGender ? findGenderControls(doc) : findMaritalControls(doc);
                                var targetRadio = isGender
                                    ? (isMale ? ctrl.maleRadio : ctrl.femaleRadio)
                                    : (isBekar ? ctrl.singleRadio : ctrl.marriedRadio);
                                var targetLabel = isGender
                                    ? (isMale ? ctrl.maleLabel : ctrl.femaleLabel)
                                    : (isBekar ? ctrl.singleLabel : ctrl.marriedLabel);
                                var targetWrapper = isGender
                                    ? (isMale ? ctrl.maleWrapper : ctrl.femaleWrapper)
                                    : (isBekar ? ctrl.singleWrapper : ctrl.marriedWrapper);

                                var oppRadio = isGender
                                    ? (isMale ? ctrl.femaleRadio : ctrl.maleRadio)
                                    : (isBekar ? ctrl.marriedRadio : ctrl.singleRadio);
                                var oppLabel = isGender
                                    ? (isMale ? ctrl.femaleLabel : ctrl.maleLabel)
                                    : (isBekar ? ctrl.marriedLabel : ctrl.singleLabel);
                                var oppWrapper = isGender
                                    ? (isMale ? ctrl.femaleWrapper : ctrl.maleWrapper)
                                    : (isBekar ? ctrl.marriedWrapper : ctrl.singleWrapper);

                                if (targetRadio || targetLabel || targetWrapper) {
                                    // 1. Karşı radyo sarmalayıcısının işaret stilini kaldır
                                    if (oppWrapper && oppWrapper.classList) {
                                        oppWrapper.classList.remove('z-radio-checked', 'z-radio-on');
                                    }

                                    // 2. Doğal kullanıcı tıklaması:
                                    // Radyoyu doğrudan checked=true yapmadan önce click() çağrılır;
                                    // böylece tarayıcı native change eventini ve ZK dinleyicisini eksiksiz tetikler.
                                    if (targetRadio) {
                                        try { targetRadio.focus(); } catch (_) {}
                                        try { targetRadio.click(); } catch (_) {}
                                    } else if (targetLabel || targetWrapper) {
                                        triggerUserClick(targetLabel || targetWrapper);
                                    }

                                    // 3. DOM güvencesi
                                    if (targetRadio) {
                                        targetRadio.checked = true;
                                    }
                                    if (oppRadio) {
                                        oppRadio.checked = false;
                                    }
                                    if (targetWrapper && targetWrapper.classList) {
                                        targetWrapper.classList.add('z-radio-checked');
                                    }

                                    // 4. Standart input/change eventleri
                                    if (targetRadio) {
                                        try { targetRadio.dispatchEvent(new win.Event('input', { bubbles: true, cancelable: true })); } catch (_) {}
                                        try { targetRadio.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true })); } catch (_) {}
                                        if (win.jq) {
                                            try { win.jq(targetRadio).trigger('change'); } catch (_) {}
                                        }
                                    }

                                    // 5. ZK Widget API ve Radiogroup onCheck AU Senkronizasyonu
                                    try {
                                        var w = null;
                                        if (win.zk && win.zk.Widget) {
                                            w = (targetRadio ? win.zk.Widget.$(targetRadio) : null)
                                                || (targetRadio && targetRadio.id ? win.zk.Widget.$(targetRadio.id.replace(/-real$/, '')) : null)
                                                || (targetWrapper ? win.zk.Widget.$(targetWrapper) : null)
                                                || (targetLabel ? win.zk.Widget.$(targetLabel) : null);
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
                                                if (typeof rg._fixCheck === 'function') {
                                                    try { rg._fixCheck(w); } catch (_) {}
                                                }
                                                // ZK Java backend standardı: Radiogroup üzerinde items ve reference ile onCheck gönder
                                                if (typeof rg.fire === 'function') {
                                                    try {
                                                        rg.fire('onCheck', { items: [w], reference: w }, { toServer: true });
                                                    } catch (_) {}
                                                }
                                            } else {
                                                // Radiogroup yoksa doğrudan Radio widget'ı üzerinden gönder
                                                if (typeof w.fire === 'function') {
                                                    try {
                                                        w.fire('onCheck', { checked: true }, { toServer: true });
                                                    } catch (_) {}
                                                }
                                            }
                                        }
                                    } catch (zkErr) {
                                        console.warn('[YKN] fillRadioByValue ZK sync error:', zkErr);
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
                        var isPakistan = countryNorm.indexOf('pakistan') !== -1 || countryNorm === 'pak' || dogumUlkesiNorm.indexOf('pakistan') !== -1 || dogumUlkesiNorm === 'pak';
                        var isRussia = countryNorm.indexOf('rus') !== -1 || dogumUlkesiNorm.indexOf('rus') !== -1;

                        var defaultBirthPlace = isTurkmen ? 'TKM' : (isAfghan ? 'KABUL' : (isPakistan ? 'ISLAMABAD' : (isRussia ? 'MOSCOW' : '')));
                        var defaultIssuingAuthority = isTurkmen ? 'SMST' : (isAfghan ? 'PASSPORT DEPARTMENT' : (isPakistan ? 'PAKISTAN' : (isRussia ? 'MIA OF RUSSIA' : '')));

                        var birthPlace = data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || defaultBirthPlace;
                        var issuingAuthority = isTurkmen ? 'SMST' : (isPakistan ? 'PAKISTAN' : (data.verenMakam || data.issuingAuthority || defaultIssuingAuthority));
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
                        var maritalStatus = data.medeniHali || data.medeniHal || 'Bekar';
                        fillRadioByValue(allDocs, maritalStatus, fillResult, 'Medeni Hali');
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

                        // Seçili radyo butonlarını (Medeni Hali ve Cinsiyet) ZK seviyesinde garanti et
                        var checkedRadios = doc.querySelectorAll('input[type="radio"]:checked');
                        for (var cri = 0; cri < checkedRadios.length; cri++) {
                            commitRadio(checkedRadios[cri], win);
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

    // Yeni arama başladığında önceki öğrencinin beklemede kalmış sırasını sıfırla
    const queueKey = String(yoksisTab.id);
    yoksisOperationQueues.delete(queueKey);

    return runYoksisOperation(yoksisTab.id, 'search', request.requestId, async () => {
        await new Promise((resolve) => {
            chrome.storage.local.set({ studentData: request.data }, resolve);
        });

        // 1. Arama öncesi form durumunu al (baseline)
        const stateBeforeSearch = await getYoksisFormState(yoksisTab.id, request.requestId);
        const baselineFingerprint = stateBeforeSearch?.fingerprint || '';
        const baselineDomRevision = stateBeforeSearch?.domRevision;

        // 2. ARAMAYI DOĞRUDAN MAIN WORLD'DE ÇALIŞTIR (Form Temizle + Kabul Mektup ID yaz + Ara)
        let mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
        let searchTriggered = Boolean(mainResults?.some(r => r.result?.searchTriggered === true));

        // 3. İlk denemede tetiklenemediyse kısa bir bekleme sonrasında tekrar dene (SEKMEYİ ASLA YENİLEME!)
        if (!searchTriggered) {
            console.log('[YKN] YÖKSİS arama alanı ilk denemede hazır olmadı. 500ms bekleyip tekrar deneniyor...');
            await wait(500);
            mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
            searchTriggered = Boolean(mainResults?.some(r => r.result?.searchTriggered === true));
        }

        // 4. MAIN world butonu bulamadıysa izole content-script yolu ile dene
        if (!searchTriggered) {
            console.warn('[YKN] MAIN world kabul aramasını tetikleyemedi, content-script deneniyor...');
            const response = await searchYoksisFromContent(yoksisTab.id, kabulId, request.requestId, { waitForForm: false });
            searchTriggered = response?.searchTriggered === true;
        }

        if (!searchTriggered) {
            throw new Error('YÖKSİS kabul mektubu araması başlatılamadı. Kabul Mektup ID alanı veya ara butonu bulunamadı. Öğrenci başvuru/kayıt ekranını açık tutup tekrar deneyin.');
        }

        // 4. İsteniyorsa formun açılmasını bekle
        const waitForForm = request.waitForForm !== false;
        let formReady = false;
        if (waitForForm) {
            formReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId, {
                afterFingerprint: baselineFingerprint,
                afterDomRevision: baselineDomRevision,
                requireFreshResult: Boolean(baselineFingerprint)
            });
        }

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
    });
}

async function fillYoksisStudentData(studentData, requestId, bringToFront = false) {
    if (studentData?.yoksisReady !== true) {
        throw new Error('Kabul kodu için doğrulanmış yeni YÖKSİS öğrenci formu yok. Önce kabul kodunu aratın.');
    }

    if (studentData) {
        studentData.transferWarnings = getActiveTransferWarnings(studentData);
        if (studentData.transferWarnings.length === 0) delete studentData.transferWarnings;
    }

    const yoksisTab = bringToFront ? await getForegroundYoksisTab() : await getBackgroundYoksisTab();
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

    const yoksisTab = await getBackgroundYoksisTab();
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

    // Apply profilinde birden fazla pasaport yüklenmiş olabilir.
    // Eğer belge az önce EXTRACT_PASSPORT_METADATA aşamasında indirilmişse
    // tekrar ağ isteği yapmayıp doğrudan önbellekteki veriyi kullan.
    const documents = [];
    if (data.prefetchedDocuments && data.prefetchedDocuments.length > 0) {
        documents.push(...data.prefetchedDocuments);
    } else {
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
    }

    await new Promise((resolve) => chrome.storage.local.set({
        pendingPassportCrop: {
            data,
            documents,
            // Eski açık kırpma pencereleriyle geriye dönük uyumluluk.
            documentBase64: documents[0].documentBase64,
            contentType: documents[0].contentType
        }
    }, resolve));

    const isFromPortal = request?.source === 'IKAMET_PORTAL' || request?.fromPortal === true;
    if (!isFromPortal) {
        await createTab({ url: chrome.runtime.getURL('cropper.html') });
    }
    return { documents };
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
            // Yeni bir öğrencinin kabul kodu okunuyorsa, önceki öğrencinin alanlarını temizle
            const isDifferentStudent = storedData?.kabulId && storedData.kabulId !== acceptance.kabulId;
            const baseData = isDifferentStudent ? {} : (storedData || {});
            const data = {
                ...baseData,
                kabulId: acceptance.kabulId,
                yoksisId: acceptance.kabulId,
                acceptanceLetterUrl: acceptance.acceptanceDocumentUrl,
                yoksisReady: false
            };
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
            const incomingData = request.data || request.studentData || {};
            let data = mergeStudentData(mergeStudentData(mergeStudentData(pendingData, currentData), incomingData), {
                croppedPhotoBase64: request.photoBase64,
                photoFileName: request.fileName || 'ogrenci_foto.jpg'
            });
            data.transferWarnings = getActiveTransferWarnings(data);
            if (data.transferWarnings.length === 0) delete data.transferWarnings;
            data = await confirmYoksisReadyForCrop(data, request.requestId);
            await saveStudentData(data);
            await new Promise((resolve) => chrome.storage.local.set({ pendingPassportCrop: null }, resolve));
            const fillResponse = await fillYoksisStudentData(data, request.requestId, true);
            await getForegroundYoksisTab().catch(() => {});
            const unavailableFields = Array.from(new Set(getActiveTransferWarnings(data)));
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
            if (studentData) {
                studentData.transferWarnings = getActiveTransferWarnings(studentData);
                if (studentData.transferWarnings.length === 0) delete studentData.transferWarnings;
            }
            fillYoksisStudentData(studentData, request.requestId)
                .then((response) => {
                    const unavailableFields = Array.from(new Set(getActiveTransferWarnings(studentData)));
                    sendResponse({
                        ...response,
                        unavailableFields,
                        partial: Boolean(response?.partial || unavailableFields.length > 0),
                        requestId: request.requestId
                    });
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
        else if (request.action === 'YOKSIS_SAVE_FORM') {
            (async () => {
                const yoksisTab = await getBackgroundYoksisTab();
                await waitForContentScript(yoksisTab.id, 'yoksis');

                // MAIN World: Kaydet öncesi Medeni Hali ve Cinsiyet radyo gruplarının ZK sunucusunda
                // eksiksiz seçili olduğundan emin ol.
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: yoksisTab.id },
                        world: 'MAIN',
                        func: () => {
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

                                function commitRadioDirect(el, win) {
                                    if (!el) return;
                                    var wWin = win || (el.ownerDocument && el.ownerDocument.defaultView) || window;
                                    try {
                                        if (wWin.zk && wWin.zk.Widget) {
                                            var w = wWin.zk.Widget.$(el) || (el.id ? wWin.zk.Widget.$(el.id.replace(/-real$/, '')) : null);
                                            if (w) {
                                                if (typeof w.setChecked === 'function') {
                                                    try { w.setChecked(true); } catch (_) {}
                                                }
                                                var rg = typeof w.getRadiogroup === 'function' ? w.getRadiogroup() : (w.parent || null);
                                                if (rg) {
                                                    if (typeof rg.setSelectedItem === 'function') {
                                                        try { rg.setSelectedItem(w); } catch (_) {}
                                                    }
                                                    if (typeof rg._fixCheck === 'function') {
                                                        try { rg._fixCheck(w); } catch (_) {}
                                                    }
                                                }
                                                if (typeof w.doClick_ === 'function') {
                                                    try { w.doClick_(new wWin.zk.Event(w, 'onClick', {})); } catch (_) {}
                                                }
                                                if (typeof w.fire === 'function') {
                                                    try { w.fire('onCheck', { checked: true }, { toServer: true }); } catch (_) {}
                                                }
                                                if (wWin.zAu && typeof wWin.zAu.send === 'function') {
                                                    try { wWin.zAu.send(new wWin.zk.Event(w, 'onCheck', { checked: true }, { toServer: true })); } catch (_) {}
                                                    if (rg && rg.uuid) {
                                                        try { wWin.zAu.send(new wWin.zk.Event(rg, 'onCheck', { data: [w.uuid], checked: true }, { toServer: true })); } catch (_) {}
                                                    }
                                                }
                                            }
                                        }
                                    } catch (_) {}
                                    try {
                                        el.checked = true;
                                        el.dispatchEvent(new wWin.Event('input', { bubbles: true, cancelable: true }));
                                        el.dispatchEvent(new wWin.Event('change', { bubbles: true, cancelable: true }));
                                    } catch (_) {}
                                }

                                var allDocs = getAllDocs(document);
                                for (var di = 0; di < allDocs.length; di++) {
                                    var doc = allDocs[di];
                                    var win = doc.defaultView || window;

                                    // 1. Zaten seçili olan tüm radyoları ZK sunucusuyla senkronize et
                                    var checkedRadios = doc.querySelectorAll('input[type="radio"]:checked');
                                    for (var ri = 0; ri < checkedRadios.length; ri++) {
                                        commitRadioDirect(checkedRadios[ri], win);
                                    }

                                    // 2. Medeni Hali satırını kontrol et: eğer hiçbiri seçili değilse 'Bekar'ı seç ve commit et
                                    var allLabels = doc.querySelectorAll('label, span, td, div, b, strong');
                                    for (var li = 0; li < allLabels.length; li++) {
                                        var txt = (allLabels[li].innerText || allLabels[li].textContent || '')
                                            .toLocaleLowerCase('tr-TR')
                                            .replace(/[^a-z0-9]/g, '');
                                        if (txt.indexOf('medenihal') !== -1 || txt.indexOf('maritalstatus') !== -1) {
                                            var row = allLabels[li].closest('tr') || allLabels[li].closest('.z-row') || allLabels[li].closest('.form-group') || allLabels[li].parentElement;
                                            if (row) {
                                                var rowRadios = row.querySelectorAll('input[type="radio"]');
                                                if (rowRadios.length >= 2) {
                                                    var anyChecked = false;
                                                    for (var rj = 0; rj < rowRadios.length; rj++) {
                                                        if (rowRadios[rj].checked) anyChecked = true;
                                                    }
                                                    if (!anyChecked) {
                                                        rowRadios[0].checked = true;
                                                        commitRadioDirect(rowRadios[0], win);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (_) {}
                        }
                    });
                } catch (_) {}

                return sendTabMessage(yoksisTab.id, {
                    action: 'YOKSIS_SAVE_FORM',
                    requestId: request.requestId
                });
            })()
                .then(sendResponse)
                .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
            return true;
        }
        else if (request.action === 'YOKSIS_STEP_YKN') {
            (async () => {
                const yoksisTab = await getBackgroundYoksisTab();
                await waitForContentScript(yoksisTab.id, 'yoksis');
                return sendTabMessage(yoksisTab.id, {
                    action: 'YOKSIS_STEP_YKN',
                    studentName: request.studentName,
                    passportNo: request.passportNo,
                    requestId: request.requestId
                });
            })()
                .then(sendResponse)
                .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
            return true;
        }
        else if (request.action === 'FOCUS_YOKSIS_TAB') {
            getForegroundYoksisTab()
                .then(() => sendResponse({ success: true, requestId: request.requestId }))
                .catch((error) => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
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
