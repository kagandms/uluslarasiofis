// background.js

if (typeof importScripts === 'function') {
    importScripts('portal-security.js', 'storage-lifecycle.js');
}

const portalSecurity = globalThis.YKN_PORTAL_SECURITY;
const temporaryStorage = globalThis.YKN_TEMPORARY_STORAGE;
const STAFF_PORTAL_PATTERN_SOURCE = 'bridge.js';
const TEMPORARY_STORAGE_TIMESTAMP_KEY = 'temporaryStudentDataSavedAt';
const TEMPORARY_STUDENT_DATA_KEYS = ['studentData', 'pendingPassportCrop', 'croppedPhotoBase64'];
const YOKSIS_TAB_STORAGE_KEY = 'activeYoksisTabId';

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
// Content script, kabul kodunun ZK onChange güncellemesinin bitmesini ve yeni
// öğrenci formunun iki kez kararlı görünmesini bekler. 12 saniye bu zinciri
// kesip ikinci bir MAIN-world araması başlatabiliyordu.
// YÖKSİS sekmesi Tek Tık ile yeni açılmışsa ZK ekranı ve kabul alanı geç
// yüklenebilir. Content tarafının 12 sn kontrol beklemesi + form doğrulaması
// için bu sınırın daha uzun olması gerekir.
const YOKSIS_SEARCH_RESPONSE_TIMEOUT_MS = 32_000;
const YOKSIS_REFRESH_TIMEOUT_MS = 30_000;

function startYknTiming() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function finishYknTiming(stage, startedAt, outcome = 'ok', reasonCode = undefined) {
    if (globalThis.__YKN_DIAGNOSTICS_ENABLED__ !== true) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    console.info('[YKN_TIMING]', {
        stage,
        durationMs: Math.round(now - startedAt),
        outcome,
        ...(reasonCode ? { reasonCode } : {})
    });
}

function reportYknTiming(stage, durationMs, outcome = 'ok', reasonCode = undefined) {
    if (globalThis.__YKN_DIAGNOSTICS_ENABLED__ !== true || !Number.isFinite(durationMs)) return;
    console.info('[YKN_TIMING]', {
        stage,
        durationMs: Math.max(0, Math.round(durationMs)),
        outcome,
        ...(reasonCode ? { reasonCode } : {})
    });
}

function getPortalMatchPatterns() {
    const bridgeScript = chrome.runtime.getManifest()?.content_scripts?.find((script) => {
        return Array.isArray(script.js) && script.js.includes(STAFF_PORTAL_PATTERN_SOURCE);
    });
    return bridgeScript?.matches || [];
}

function getAllowedPortalMatchPatterns() {
    return getPortalMatchPatterns();
}

function isAllowedPortalUrl(url) {
    return Boolean(portalSecurity?.isAllowedPortalUrl(url, getAllowedPortalMatchPatterns()));
}

function isAllowedApplyUrl(url) {
    return portalSecurity?.isAllowedApplySender(url) === true;
}

function saveTemporaryStudentData(studentData) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({
            studentData,
            [TEMPORARY_STORAGE_TIMESTAMP_KEY]: Date.now()
        }, () => {
            const storageError = chrome.runtime.lastError;
            if (storageError) reject(new Error(storageError.message));
            else resolve();
        });
    });
}

function clearTemporaryStudentData() {
    return new Promise((resolve) => {
        chrome.storage.local.remove([...TEMPORARY_STUDENT_DATA_KEYS, TEMPORARY_STORAGE_TIMESTAMP_KEY], () => {
            resolve(!chrome.runtime.lastError);
        });
    });
}

function cleanupExpiredTemporaryStudentData() {
    chrome.storage.local.get([...TEMPORARY_STUDENT_DATA_KEYS, TEMPORARY_STORAGE_TIMESTAMP_KEY], (snapshot) => {
        const plan = temporaryStorage?.getCleanupPlan(snapshot || {});
        if (!plan) return;

        if (plan.removeKeys.length > 0) {
            chrome.storage.local.remove(plan.removeKeys, () => {
                if (chrome.runtime.lastError) {
                    console.error('Expired temporary student data cleanup failed.', { errorName: 'StorageError' });
                }
            });
            return;
        }

        if (plan.timestampToSet !== null) {
            chrome.storage.local.set({ [TEMPORARY_STORAGE_TIMESTAMP_KEY]: plan.timestampToSet }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Temporary student data retention marker could not be saved.', { errorName: 'StorageError' });
                }
            });
        }
    });
}

chrome.runtime.onStartup?.addListener(cleanupExpiredTemporaryStudentData);
chrome.runtime.onInstalled?.addListener(cleanupExpiredTemporaryStudentData);

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

function sendTabMessage(tabId, message, options = {}) {
    return new Promise((resolve, reject) => {
        const callback = (response) => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(response);
        };
        if (options && Object.keys(options).length > 0 && typeof chrome.tabs.sendMessage === "function" && chrome.tabs.sendMessage.length >= 4) {
            chrome.tabs.sendMessage(tabId, message, options, callback);
        } else {
            chrome.tabs.sendMessage(tabId, message, callback);
        }
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

function reloadTabAndWait(tabId, timeoutMs = YOKSIS_REFRESH_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(handleUpdated);
        };
        const handleUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
            cleanup();
            resolve();
        };
        const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('YÖKSİS sayfası yenileme zaman aşımına uğradı.'));
        }, timeoutMs);

        chrome.tabs.onUpdated.addListener(handleUpdated);
        chrome.tabs.reload(tabId, {}, () => {
            const error = chrome.runtime.lastError;
            if (!error) return;
            cleanup();
            reject(new Error(error.message));
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
                ? ['portal-security.js', 'bridge.js']
                : pageKind === 'apply'
                    ? ['pdf.min.js', 'document-parser.js', 'content.js']
                    : ['content.js'];
            await chrome.scripting.executeScript({
                target: { tabId },
                files
            });
        }
    } catch (error) {
        // Sayfa henüz hazır olmayabilir veya izin kısıtlı olabilir
    }
}

async function waitForContentScript(tabId, pageKind, options = {}) {
    const deadline = Date.now() + CONTENT_READY_TIMEOUT_MS;
    let delay = CONTENT_READY_INITIAL_DELAY_MS;
    let attemptedInjection = false;

    while (Date.now() < deadline) {
        try {
            const messageOptions = options.frameId === undefined ? {} : { frameId: options.frameId };
            const response = await sendTabMessage(tabId, {
                action: 'PING',
                pageKind
            }, messageOptions);
            const hasExpectedRoute = !options.requiredPath
                || (typeof response?.url === 'string' && new URL(response.url).pathname.replace(/\/$/, '') === options.requiredPath);
            if (response && response.ready === true && response.pageKind === pageKind && hasExpectedRoute) {
                return response;
            }
        } catch (error) {
            if (!attemptedInjection) {
                attemptedInjection = true;
                await ensureContentScriptInjected(tabId, pageKind);
            }
        }

        await wait(delay);
        delay = Math.min(delay * 2, CONTENT_READY_MAX_DELAY_MS);
    }

    throw new Error(pageKind + ' content script zamanında hazır olmadı.');
}

async function getPortalTabId() {
    if (ikametTabId) {
        try {
            const existing = await new Promise((resolve) => {
                chrome.tabs.get(ikametTabId, (t) => {
                    if (chrome.runtime.lastError || !t) resolve(null);
                    else resolve(t);
                });
            });
            if (existing && isAllowedPortalUrl(existing.url || '')) return existing.id;
            ikametTabId = null;
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
    await saveTemporaryStudentData(data);

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
    await waitForContentScript(applyTabId, 'apply', { requiredPath: '/panel/applications' });
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

async function resolveYoksisTab() {
    const tabs = await queryTabs({ url: '*://yoksis.yok.gov.tr/*' });
    if (!tabs || tabs.length === 0) {
        throw new Error('YÖKSİS sekmesi açık değil. Lütfen önce YÖKSİS sekmesini açın.');
    }

    // Arama hangi YÖKSİS sekmesinde yapıldıysa doldurma da mutlaka o sekmede
    // sürmelidir. Birden çok YÖKSİS sekmesi açıkken sadece "aktif" ya da
    // query sonucundaki ilk sekmeyi kullanmak arama ve doldurmayı ayırıyordu.
    const persistedTabId = await readSessionYoksisTabId();
    const yoksisTab = tabs.find(t => t.id === yoksisTabId)
        || tabs.find(t => t.id === persistedTabId)
        || tabs.find(t => t.active)
        || tabs[0];
    yoksisTabId = yoksisTab.id;
    await writeSessionYoksisTabId(yoksisTab.id);
    return yoksisTab;
}

function readSessionYoksisTabId() {
    const sessionStorage = chrome.storage?.session;
    if (!sessionStorage?.get) return Promise.resolve(null);
    return new Promise((resolve) => {
        sessionStorage.get(YOKSIS_TAB_STORAGE_KEY, (stored) => {
            resolve(Number.isInteger(stored?.[YOKSIS_TAB_STORAGE_KEY])
                ? stored[YOKSIS_TAB_STORAGE_KEY]
                : null);
        });
    });
}

function writeSessionYoksisTabId(tabId) {
    const sessionStorage = chrome.storage?.session;
    if (!sessionStorage?.set) return Promise.resolve();
    return new Promise((resolve) => {
        sessionStorage.set({ [YOKSIS_TAB_STORAGE_KEY]: tabId }, () => resolve());
    });
}

async function getBackgroundYoksisTab() {
    const startedAt = startYknTiming();
    let yoksisTab;
    try {
        yoksisTab = await resolveYoksisTab();
    } catch (_) {
        yoksisTab = await createTab({ url: YOKSIS_URL, active: false });
        yoksisTabId = yoksisTab.id;
        await writeSessionYoksisTabId(yoksisTab.id);
    }

    yoksisTabId = yoksisTab.id;
    await writeSessionYoksisTabId(yoksisTab.id);
    await waitForContentScript(yoksisTabId, 'yoksis', { frameId: 0 });
    finishYknTiming('yoksis-tab-resolution-and-content-readiness', startedAt);
    return yoksisTab;
}

async function getVerifiedYoksisTarget(tabId) {
    const tab = await new Promise((resolve) => {
        chrome.tabs.get(tabId, (result) => resolve(result || null));
    });
    if (!tab?.url || !isYoksisUrl(tab.url)) {
        throw new Error('YÖKSİS hedef sekmesi doğrulanamadı. Güvenli aktarım için kabul kodunu yeniden aratın.');
    }
    return { yoksisTabId: tab.id, yoksisTabUrl: tab.url };
}

async function resolveExpectedYoksisTab(tabId, expectedUrl) {
    if (!Number.isInteger(tabId) || typeof expectedUrl !== 'string' || !expectedUrl) {
        throw new Error('Doğrulanmış YÖKSİS hedef sekmesi yok. Önce kabul kodunu aratın.');
    }
    const tabs = await queryTabs({ url: '*://yoksis.yok.gov.tr/*' });
    const yoksisTab = tabs.find((tab) => tab.id === tabId && tab.url === expectedUrl);
    if (!yoksisTab) {
        throw new Error('YÖKSİS sekmesi değişti veya kapandı. Güvenli aktarım için kabul kodunu yeniden aratın.');
    }
    yoksisTabId = yoksisTab.id;
    await writeSessionYoksisTabId(yoksisTab.id);
    return yoksisTab;
}

function isYoksisUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === 'yoksis.yok.gov.tr';
    } catch (_) {
        return false;
    }
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
                                        dInp = td.nextElementSibling.querySelector('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
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
                                                const bPh = norm((bInps[j].placeholder || '') + ' ' + (bInps[j].getAttribute('placeholder') || '') + ' ' + (bInps[j].id || '') + ' ' + (bInps[j].name || ''));
                                                if (!bPh.includes('pasaport') && !bPh.includes('tc') && !bPh.includes('dogum')) {
                                                    dInp = bInps[j];
                                                    break;
                                                }
                                            }
                                            if (!dInp && bInps.length > 0) dInp = bInps[0];
                                        }
                                        if (!dBtn) {
                                            const bBtns = box.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]');
                                            if (bBtns.length > 0) {
                                                for (let j = 0; j < bBtns.length; j++) {
                                                    const bTxt = norm(bBtns[j].innerText || bBtns[j].textContent || bBtns[j].value || '');
                                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                                        dBtn = bBtns[j].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || bBtns[j];
                                                        break;
                                                    }
                                                }
                                                if (!dBtn) dBtn = bBtns[0].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || bBtns[0];
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
                                    const bTxt = norm(btns[k].innerText || btns[k].textContent || btns[k].value || '');
                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                        dBtn = btns[k].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || btns[k];
                                        break;
                                    }
                                }
                                if (dBtn) break;
                                if (btns.length > 0) {
                                    dBtn = btns[0].closest('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]') || btns[0];
                                    break;
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
                                var dateObj = new Date(y, m - 1, d, 0, 0, 0, 0);
                                var widgetCommitted = false;

                                if (wWin.zk && wWin.zk.Widget) {
                                    var w = wWin.zk.Widget.$(el);
                                    if (w) {
                                        w.coerceFromString_ = function () { return dateObj; };
                                        w.coerceToString_ = function () { return formatted; };
                                        w.getValue = function () { return dateObj; };
                                        w.getText = function () { return formatted; };
                                        w.validate_ = function () { return null; };
                                        if (w._cst && typeof w._cst === 'object') {
                                            try { w._cst.validate = function () { return null; }; } catch (_) {}
                                        }

                                        w._lastValue = formatted;
                                        w._value = dateObj;
                                        w._shallSubmit = true;
                                        w._defRawVal = formatted;
                                        w._lastChg = formatted;

                                        if (w.$n('real')) {
                                            w.$n('real').value = formatted;
                                        }
                                        if (typeof w.setText === 'function') {
                                            try { w.setText(formatted); } catch (_) {}
                                        }
                                        if (typeof w.setValue === 'function') {
                                            try { w.setValue(dateObj); } catch (_) {}
                                        }

                                        if (typeof w.clearErrorMessage === 'function') {
                                            try { w.clearErrorMessage(true); } catch (_) {}
                                        }
                                        if (w._errmsg) {
                                            try { w._errmsg.close(); } catch (_) {}
                                            w._errmsg = null;
                                        }

                                        el.classList.remove('z-datebox-invalid', 'z-textbox-invalid');
                                        var parentBox = el.closest('.z-datebox');
                                        if (parentBox) {
                                            parentBox.classList.remove('z-datebox-invalid', 'z-textbox-invalid');
                                        }

                                        if (wWin.zAu && typeof wWin.zAu.send === 'function') {
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

                                if (!widgetCommitted) {
                                    try {
                                        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                                    } catch (_) {}
                                }
                            }
                        }
                    }

                    function commitSelect(el, win) {
                        if (!el || !el.value) return;
                        var wWin = win || window;
                        var widgetCommitted = false;

                        // Native change olayı bazı YÖKSİS selectlerinde yeterli
                        // olmuyor; ZK widget değerini de sunucuya gönder.
                        try {
                            if (wWin.zk && wWin.zk.Widget) {
                                var w = wWin.zk.Widget.$(el);
                                if (w) {
                                    w._value = el.value;
                                    if (typeof w.setValue === 'function') {
                                        try { w.setValue(el.value); } catch (_) {}
                                    }
                                    if (typeof w.updateChange_ === 'function') {
                                        try { w.updateChange_(); } catch (_) {}
                                    }
                                    var changeSent = false;
                                    if (typeof w.fire === 'function') {
                                        try {
                                            w.fire('onChange', { value: el.value }, { toServer: true });
                                            changeSent = true;
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }
                                    if (!changeSent && wWin.zAu && typeof wWin.zAu.send === 'function') {
                                        try {
                                            wWin.zAu.send(new wWin.zk.Event(w, 'onChange', { value: el.value }, { toServer: true }));
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }
                                }
                            }
                        } catch (_) {}
                        if (!widgetCommitted) {
                            try {
                                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                                el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                            } catch (_) {}
                        }
                    }

                    function commitRadio(el, win) {
                        if (!el || !el.checked) return;
                        var wWin = win || window;
                        var widgetCommitted = false;
                        try {
                            if (wWin.zk && wWin.zk.Widget) {
                                var w = wWin.zk.Widget.$(el);
                                if (w) {
                                    if (typeof w.setChecked === 'function') {
                                        try { w.setChecked(true); } catch (_) {}
                                    }
                                    var checkSent = false;
                                    if (typeof w.fire === 'function') {
                                        try {
                                            w.fire('onCheck', { checked: true }, { toServer: true });
                                            checkSent = true;
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }
                                    if (!checkSent && wWin.zAu && typeof wWin.zAu.send === 'function') {
                                        try {
                                            wWin.zAu.send(new wWin.zk.Event(w, 'onCheck', { checked: true }, { toServer: true }));
                                            widgetCommitted = true;
                                        } catch (_) {}
                                    }
                                }
                            }
                        } catch (_) {}
                        if (!widgetCommitted) {
                            try { el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                        }
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

                        function matches(text) {
                            var value = norm(text || '');
                            return wanted.some(function (label) {
                                return value === label || value.indexOf(label) !== -1;
                            });
                        }

                        // Önce for/aria ilişkisini kullan; tablo düzeninden
                        // bağımsız olan en güvenilir eşleştirme budur.
                        var labelNodes = targetDoc.querySelectorAll('label, td, th, span, div, b, strong');
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

                            var parentTd = labelNode.closest ? labelNode.closest('td, th') : null;
                            if (parentTd) {
                                var nextCell = parentTd.nextElementSibling;
                                var nextControl = nextCell && nextCell.querySelector(selector);
                                if (isUsableControl(nextControl, kind)) return nextControl;
                                var sameCellControl = parentTd.querySelector(selector);
                                if (isUsableControl(sameCellControl, kind)) return sameCellControl;
                            }
                        }

                        // Sonra satır bazlı eşleştirme: YÖKSİS öğrenci paneli
                        // klasik iki sütunlu tablo olarak oluşturuluyor.
                        var rows = targetDoc.querySelectorAll('tr');
                        for (var ri = 0; ri < rows.length; ri++) {
                            var row = rows[ri];
                            var rowText = row.innerText || row.textContent || '';
                            if (!matches(rowText)) continue;
                            var controls = row.querySelectorAll(selector);
                            for (var ci = 0; ci < controls.length; ci++) {
                                if (isUsableControl(controls[ci], kind)) return controls[ci];
                            }
                        }

                        // Son güvenli fallback: placeholder/name/id üzerinden.
                        var allControls = targetDoc.querySelectorAll(selector);
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
                                    if (previousText.indexOf('uyrukkitlikno') !== -1) break;
                                    if (previousText === 'belgeno' || previousText.indexOf('belgeno') !== -1) return input;
                                    previousCell = previousCell.previousElementSibling;
                                }

                                var rowText = compact(row && (row.innerText || row.textContent) || '');
                                if (rowText.indexOf('belgeno') !== -1 && rowText.indexOf('pasaport') === -1) return input;
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
                        var wanted = norm(value);
                        var options = select.options || [];
                        for (var oi = 0; oi < options.length; oi++) {
                            var optionText = norm(options[oi].text || options[oi].value || '');
                            if (optionText === wanted || optionText.indexOf(wanted) !== -1 || wanted.indexOf(optionText) !== -1) {
                                select.value = options[oi].value;
                                try { options[oi].selected = true; } catch (_) {}
                                return Boolean(select.value);
                            }
                        }
                        return false;
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
                        var targetValue = dateMode ? formatDateValue(value) : String(value).trim();
                        var set = setNativeValue(control, targetValue);
                        if (set) {
                            if (dateMode) commitDatebox(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                            else commitTextbox(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                        }
                        addResultField(result, resultLabel, set && String(control.value || '').trim() === targetValue);
                    }

                    function fillSelectByLabels(docs, labels, value, result, resultLabel) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var control = findControl(labels, 'select', docs);
                        var set = Boolean(control && selectMatchingOption(control, value));
                        if (set) commitSelect(control, control.ownerDocument && control.ownerDocument.defaultView || window);
                        addResultField(result, resultLabel, set);
                    }

                    function fillGenderRadio(docs, value, result) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var normVal = norm(value);
                        var isMale = normVal === 'erkek' || normVal === 'male' || normVal === 'e' || normVal === 'm' || normVal === 'bay' || normVal === '1';
                        var isFemale = normVal === 'kadin' || normVal === 'female' || normVal === 'k' || normVal === 'f' || normVal === 'bayan' || normVal === '2';
                        if (!isMale && !isFemale) return;

                        var targetRadio = null;
                        var oppRadio = null;
                        var targetWrapper = null;
                        var oppWrapper = null;
                        var targetLabel = null;
                        var oppLabel = null;
                        var targetDoc = null;

                        for (var di = 0; di < docs.length; di++) {
                            var d = docs[di];
                            var labels = d.querySelectorAll('label, span, td, div, b, strong, th');
                            var genderRow = null;
                            for (var li = 0; li < labels.length; li++) {
                                var lbl = labels[li];
                                var txt = norm(lbl.innerText || lbl.textContent || '');
                                if (txt === 'cinsiyet' || txt === 'cinsiyeti' || txt === 'gender' || txt.indexOf('cinsiyet') !== -1) {
                                    var row = (lbl.closest && lbl.closest('tr, .z-row, .z-radiogroup')) || lbl.parentElement;
                                    if (row && row.querySelectorAll('input[type="radio"]').length >= 2) {
                                        genderRow = row;
                                        break;
                                    } else if (!genderRow && row) {
                                        genderRow = row;
                                    }
                                }
                            }

                            if (!genderRow) continue;
                            var scope = genderRow;
                            var radios = scope.querySelectorAll('input[type="radio"]');
                            if (radios.length >= 2) {
                                var maleRadio = null;
                                var maleWrap = null;
                                var maleLbl = null;
                                var femaleRadio = null;
                                var femaleWrap = null;
                                var femaleLbl = null;

                                for (var ri = 0; ri < radios.length; ri++) {
                                    var r = radios[ri];
                                    var wrap = (r.closest && r.closest('.z-radio'));
                                    if (!wrap) {
                                        var p = r.parentElement;
                                        if (p && p.querySelectorAll('input[type="radio"]').length === 1) wrap = p;
                                    }
                                    wrap = wrap || r.parentElement;

                                    var specificLabel = null;
                                    if (r.id) {
                                        specificLabel = d.getElementById(r.getAttribute('for')) || d.querySelector('label[for="' + r.id + '"]');
                                    }
                                    if (!specificLabel && wrap && wrap !== scope && wrap.querySelectorAll('input[type="radio"]').length === 1) {
                                        specificLabel = wrap.querySelector('label, .z-radio-cnt, .z-radio-content');
                                    }
                                    if (!specificLabel && r.nextElementSibling && (r.nextElementSibling.tagName === 'LABEL' || (r.nextElementSibling.classList && r.nextElementSibling.classList.contains('z-radio-cnt')))) {
                                        specificLabel = r.nextElementSibling;
                                    }

                                    var rLabelText = norm(specificLabel ? (specificLabel.innerText || specificLabel.textContent || '') : '');
                                    var rValText = norm(r.value || '');

                                    var isMaleR = rLabelText.indexOf('erkek') !== -1 || rLabelText.indexOf('male') !== -1 || rLabelText === 'e' || rLabelText === 'm' || rValText === 'e' || rValText === 'erkek' || rValText === '1';
                                    var isFemaleR = rLabelText.indexOf('kadin') !== -1 || rLabelText.indexOf('female') !== -1 || rLabelText === 'k' || rLabelText === 'f' || rValText === 'k' || rValText === 'kadin' || rValText === '2';

                                    if (isMaleR && !isFemaleR) {
                                        maleRadio = r;
                                        maleWrap = wrap;
                                        maleLbl = specificLabel || wrap;
                                    } else if (isFemaleR && !isMaleR) {
                                        femaleRadio = r;
                                        femaleWrap = wrap;
                                        femaleLbl = specificLabel || wrap;
                                    }
                                }

                                targetRadio = isMale ? maleRadio : femaleRadio;
                                oppRadio = isMale ? femaleRadio : maleRadio;
                                targetWrapper = isMale ? maleWrap : femaleWrap;
                                oppWrapper = isMale ? femaleWrap : maleWrap;
                                targetLabel = isMale ? maleLbl : femaleLbl;
                                oppLabel = isMale ? femaleLbl : maleLbl;
                                targetDoc = d;
                                break;
                            }
                        }

                        if (targetRadio) {
                            var win = (targetDoc && targetDoc.defaultView) || window;

                            if (oppRadio) {
                                oppRadio.checked = false;
                            }
                            if (oppWrapper && oppWrapper.classList) {
                                oppWrapper.classList.remove('z-radio-checked', 'z-radio-on');
                            }

                            try { targetRadio.checked = false; } catch (_) {}
                            try { targetRadio.focus(); } catch (_) {}
                            try { targetRadio.click(); } catch (_) {}
                            targetRadio.checked = true;
                            if (targetWrapper && targetWrapper.classList) {
                                targetWrapper.classList.add('z-radio-checked');
                            }

                            if (targetLabel) {
                                try { targetLabel.click(); } catch (_) {}
                            } else if (targetWrapper) {
                                try { targetWrapper.click(); } catch (_) {}
                            }

                            try { targetRadio.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (_) {}
                            try { targetRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                            if (oppRadio) {
                                try { oppRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                            }

                            try {
                                if (win.zk && win.zk.Widget) {
                                    var targetW = win.zk.Widget.$(targetRadio) || (targetWrapper && win.zk.Widget.$(targetWrapper)) || (targetLabel && win.zk.Widget.$(targetLabel));
                                    var oppW = oppRadio ? (win.zk.Widget.$(oppRadio) || (oppWrapper && win.zk.Widget.$(oppWrapper)) || (oppLabel && win.zk.Widget.$(oppLabel))) : null;

                                    if (oppW) {
                                        if (typeof oppW.setChecked === 'function') {
                                            try { oppW.setChecked(false); } catch (_) {}
                                        }
                                        oppW._checked = false;
                                        oppW._lastValue = false;
                                    }

                                    if (targetW) {
                                        targetW._lastValue = null;
                                        targetW._lastChg = null;

                                        if (typeof targetW.setChecked === 'function') {
                                            try { targetW.setChecked(true); } catch (_) {}
                                        }
                                        targetW._checked = true;

                                        var onCheckSent = false;
                                        if (typeof targetW.fireOnCheck_ === 'function') {
                                            try {
                                                targetW.fireOnCheck_(true);
                                                onCheckSent = true;
                                            } catch (_) {}
                                        }
                                        if (typeof targetW.fire === 'function') {
                                            try {
                                                targetW.fire('onCheck', { checked: true }, { toServer: true });
                                                onCheckSent = true;
                                            } catch (_) {}
                                        }

                                        var rg = (typeof targetW.getRadiogroup === 'function') ? targetW.getRadiogroup() : null;
                                        if (rg) {
                                            try {
                                                if (typeof rg.setSelectedItem === 'function') rg.setSelectedItem(targetW);
                                                if (typeof rg.fireOnCheck_ === 'function') rg.fireOnCheck_(targetW);
                                                if (typeof rg.fire === 'function') rg.fire('onCheck', { items: [targetW], reference: targetW }, { toServer: true });
                                            } catch (_) {}
                                        }

                                        if (win.zAu && typeof win.zAu.send === 'function') {
                                            try {
                                                win.zAu.send(new win.zk.Event(targetW, 'onCheck', { checked: true }, { toServer: true }));
                                                if (rg) {
                                                    win.zAu.send(new win.zk.Event(rg, 'onCheck', { items: [targetW], reference: targetW }, { toServer: true }));
                                                }
                                            } catch (_) {}
                                        }
                                    }
                                }
                            } catch (zkErr) {
                                console.warn('ZK gender radio sync hatası:', zkErr);
                            }

                            addResultField(result, 'Cinsiyet', targetRadio.checked === true);
                        } else {
                            addResultField(result, 'Cinsiyet', false);
                        }
                    }

                    function fillMaritalRadio(docs, value, result) {
                        if (value === undefined || value === null || String(value).trim() === '') value = 'Bekar';
                        var normVal = norm(value);
                        var isSingle = normVal === 'bekar' || normVal === 'single' || normVal === 'b' || normVal === '1';
                        var isMarried = normVal === 'evli' || normVal === 'married' || normVal === 'e' || normVal === '2';
                        if (!isSingle && !isMarried) {
                            isSingle = true;
                        }

                        var targetRadio = null;
                        var oppRadio = null;
                        var targetWrapper = null;
                        var oppWrapper = null;
                        var targetLabel = null;
                        var oppLabel = null;
                        var targetDoc = null;

                        for (var di = 0; di < docs.length; di++) {
                            var d = docs[di];
                            var labels = d.querySelectorAll('label, span, td, div, b, strong, th');
                            var maritalRow = null;
                            for (var li = 0; li < labels.length; li++) {
                                var lbl = labels[li];
                                var txt = norm(lbl.innerText || lbl.textContent || '');
                                if (txt === 'medenihali' || txt === 'medenihal' || txt.indexOf('medeni') !== -1 || txt.indexOf('marital') !== -1) {
                                    var row = (lbl.closest && lbl.closest('tr, .z-row, .z-radiogroup')) || lbl.parentElement;
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
                            if (radios.length >= 2) {
                                var singleRadio = null;
                                var singleWrap = null;
                                var singleLbl = null;
                                var marriedRadio = null;
                                var marriedWrap = null;
                                var marriedLbl = null;

                                for (var ri = 0; ri < radios.length; ri++) {
                                    var r = radios[ri];
                                    var wrap = (r.closest && r.closest('.z-radio'));
                                    if (!wrap) {
                                        var p = r.parentElement;
                                        if (p && p.querySelectorAll('input[type="radio"]').length === 1) wrap = p;
                                    }
                                    wrap = wrap || r.parentElement;

                                    var specificLabel = null;
                                    if (r.id) {
                                        specificLabel = d.getElementById(r.getAttribute('for')) || d.querySelector('label[for="' + r.id + '"]');
                                    }
                                    if (!specificLabel && wrap && wrap !== scope && wrap.querySelectorAll('input[type="radio"]').length === 1) {
                                        specificLabel = wrap.querySelector('label, .z-radio-cnt, .z-radio-content');
                                    }
                                    if (!specificLabel && r.nextElementSibling && (r.nextElementSibling.tagName === 'LABEL' || (r.nextElementSibling.classList && r.nextElementSibling.classList.contains('z-radio-cnt')))) {
                                        specificLabel = r.nextElementSibling;
                                    }

                                    var rLabelText = norm(specificLabel ? (specificLabel.innerText || specificLabel.textContent || '') : '');
                                    var rValText = norm(r.value || '');

                                    var isSingleR = rLabelText.indexOf('bekar') !== -1 || rLabelText.indexOf('single') !== -1 || rLabelText === 'b' || rValText === 'b' || rValText === 'bekar' || rValText === '1';
                                    var isMarriedR = rLabelText.indexOf('evli') !== -1 || rLabelText.indexOf('married') !== -1 || rLabelText === 'e' || rValText === 'e' || rValText === 'evli' || rValText === '2';

                                    if (isSingleR && !isMarriedR) {
                                        singleRadio = r;
                                        singleWrap = wrap;
                                        singleLbl = specificLabel || wrap;
                                    } else if (isMarriedR && !isSingleR) {
                                        marriedRadio = r;
                                        marriedWrap = wrap;
                                        marriedLbl = specificLabel || wrap;
                                    }
                                }

                                if (!singleRadio && !marriedRadio) {
                                    singleRadio = radios[0];
                                    marriedRadio = radios[1];
                                } else if (!singleRadio && marriedRadio) {
                                    singleRadio = (radios[0] === marriedRadio) ? radios[1] : radios[0];
                                } else if (!marriedRadio && singleRadio) {
                                    marriedRadio = (radios[0] === singleRadio) ? radios[1] : radios[0];
                                }

                                targetRadio = isSingle ? singleRadio : marriedRadio;
                                oppRadio = isSingle ? marriedRadio : singleRadio;
                                targetWrapper = isSingle ? singleWrap : marriedWrap;
                                oppWrapper = isSingle ? marriedWrap : singleWrap;
                                targetLabel = isSingle ? singleLbl : marriedLbl;
                                oppLabel = isSingle ? marriedLbl : singleLbl;
                                targetDoc = d;
                                break;
                            }
                        }

                        if (targetRadio) {
                            var win = (targetDoc && targetDoc.defaultView) || window;

                            if (oppRadio) {
                                oppRadio.checked = false;
                            }
                            if (oppWrapper && oppWrapper.classList) {
                                oppWrapper.classList.remove('z-radio-checked', 'z-radio-on');
                            }

                            try { targetRadio.checked = false; } catch (_) {}
                            try { targetRadio.focus(); } catch (_) {}
                            try { targetRadio.click(); } catch (_) {}
                            targetRadio.checked = true;
                            if (targetWrapper && targetWrapper.classList) {
                                targetWrapper.classList.add('z-radio-checked');
                            }

                            if (targetLabel) {
                                try { targetLabel.click(); } catch (_) {}
                            } else if (targetWrapper) {
                                try { targetWrapper.click(); } catch (_) {}
                            }

                            try { targetRadio.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (_) {}
                            try { targetRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                            if (oppRadio) {
                                try { oppRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
                            }

                            try {
                                if (win.zk && win.zk.Widget) {
                                    var targetW = win.zk.Widget.$(targetRadio) || (targetWrapper && win.zk.Widget.$(targetWrapper)) || (targetLabel && win.zk.Widget.$(targetLabel));
                                    var oppW = oppRadio ? (win.zk.Widget.$(oppRadio) || (oppWrapper && win.zk.Widget.$(oppWrapper)) || (oppLabel && win.zk.Widget.$(oppLabel))) : null;

                                    if (oppW) {
                                        if (typeof oppW.setChecked === 'function') {
                                            try { oppW.setChecked(false); } catch (_) {}
                                        }
                                        oppW._checked = false;
                                        oppW._lastValue = false;
                                    }

                                    if (targetW) {
                                        targetW._lastValue = null;
                                        targetW._lastChg = null;

                                        if (typeof targetW.setChecked === 'function') {
                                            try { targetW.setChecked(true); } catch (_) {}
                                        }
                                        targetW._checked = true;

                                        var onCheckSent = false;
                                        if (typeof targetW.fireOnCheck_ === 'function') {
                                            try {
                                                targetW.fireOnCheck_(true);
                                                onCheckSent = true;
                                            } catch (_) {}
                                        }
                                        if (typeof targetW.fire === 'function') {
                                            try {
                                                targetW.fire('onCheck', { checked: true }, { toServer: true });
                                                onCheckSent = true;
                                            } catch (_) {}
                                        }

                                        var rg = (typeof targetW.getRadiogroup === 'function') ? targetW.getRadiogroup() : null;
                                        if (rg) {
                                            try {
                                                if (typeof rg.setSelectedItem === 'function') rg.setSelectedItem(targetW);
                                                if (typeof rg.fireOnCheck_ === 'function') rg.fireOnCheck_(targetW);
                                                if (typeof rg.fire === 'function') rg.fire('onCheck', { items: [targetW], reference: targetW }, { toServer: true });
                                            } catch (_) {}
                                        }

                                        if (win.zAu && typeof win.zAu.send === 'function') {
                                            try {
                                                win.zAu.send(new win.zk.Event(targetW, 'onCheck', { checked: true }, { toServer: true }));
                                                if (rg) {
                                                    win.zAu.send(new win.zk.Event(rg, 'onCheck', { items: [targetW], reference: targetW }, { toServer: true }));
                                                }
                                            } catch (_) {}
                                        }
                                    }
                                }
                            } catch (zkErr) {
                                console.warn('ZK marital radio sync hatası:', zkErr);
                            }

                            addResultField(result, 'Medeni Hali', targetRadio.checked === true);
                        }
                    }

                    function purgeErrorBoxes(targetDoc) {
                        try {
                            var d = targetDoc || document;
                            var errorBoxes = d.querySelectorAll('.z-errorbox');
                            for (var k = 0; k < errorBoxes.length; k++) {
                                errorBoxes[k].remove();
                            }
                            var invalids = d.querySelectorAll('.z-datebox-invalid, .z-textbox-invalid');
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
                        photoUploaded: false,
                        photoUploadDurationMs: undefined
                    };

                    // Content script izole dünyada DOM'a değer yazabilir ancak
                    // YÖKSİS/ZK bunu sunucu durumuna almayabilir. Bu prepass,
                    // değerleri doğrudan sayfanın gerçek JS dünyasında yazar.
                    if (data) {
                        var passportNo = data.pasaportNo || data.passportNo || '';
                        var birthPlace = data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || '';
                        var issuingAuthority = data.verenMakam || data.issuingAuthority || '';
                        var birthCountry = data.dogumUlkesi || data.uyruk || '';

                        fillTextByLabels(allDocs, ['Anne Adı', 'Ana Adı', 'Anne İsmi', 'Ana İsmi', 'Mother Name', "Mother's Name"], data.anneAdi, fillResult, 'Anne Adı', false);
                        fillTextByLabels(allDocs, ['Baba Adı', 'Baba İsmi', 'Father Name', "Father's Name"], data.babaAdi, fillResult, 'Baba Adı', false);
                        fillSelectByLabels(allDocs, ['Uyruğu', 'Nationality'], data.uyruk, fillResult, 'Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Uyruğu', 'Birth Nationality'], data.uyruk, fillResult, 'Doğum Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Yeri Ülkesi', 'Birth Country', 'Born Country'], birthCountry, fillResult, 'Doğum Yeri Ülkesi');
                        fillSelectByLabels(allDocs, ['Belgeyi Veren Ülke', 'Document Issuing Country'], data.uyruk, fillResult, 'Belgeyi Veren Ülke');
                        fillGenderRadio(allDocs, data.cinsiyet, fillResult);
                        fillMaritalRadio(allDocs, data.medeniHali || data.medeniHal, fillResult);
                        fillTextByLabels(allDocs, ['Doğum Yeri Açıklaması', 'Place of Birth Description'], birthPlace, fillResult, 'Doğum Yeri Açıklaması', false);
                        fillTextByLabels(allDocs, ['Belgeyi Veren Makam', 'Veren Makam', 'Issuing Authority'], issuingAuthority, fillResult, 'Belgeyi Veren Makam', false);
                        fillTextByLabels(allDocs, ['Telefon No', 'Telefon Numarası', 'Cep Telefonu No', 'Cep Telefonu', 'GSM', 'Telefon'], '5322431261', fillResult, 'Telefon No', false);
                        fillTextByControl(findStudentDocumentNumber(allDocs), passportNo, fillResult, 'Belge No', false);
                        fillTextByLabels(allDocs, ['Doğum Tarihi', 'Date of Birth', 'Birth Date'], data.birthDate, fillResult, 'Doğum Tarihi', true);
                        fillTextByLabels(allDocs, [
                            'Belge Düzenleme Tarihi', 'Düzenleme Tarihi', 'Belgenin Düzenleme Tarihi',
                            'Belge Düzenlenme Tarihi', 'Düzenlenme Tarihi', 'Pasaport Düzenleme Tarihi',
                            'Pasaport Düzenlenme Tarihi', 'Pasaport Veriliş Tarihi', 'Belge Veriliş Tarihi',
                            'Veriliş Tarihi', 'Tanzim Tarihi', 'Date of Issue', 'Issue Date'
                        ], data.issueDate, fillResult, 'Düzenleme Tarihi', true);
                        fillTextByLabels(allDocs, [
                            'Belge Geçerlilik Tarihi', 'Geçerlilik Tarihi', 'Belgenin Geçerlilik Tarihi',
                            'Pasaport Son Geçerlilik Tarihi', 'Pasaport Geçerlilik Tarihi', 'Son Geçerlilik Tarihi',
                            'Bitiş Tarihi', 'Date of Expiry', 'Expiry Date', 'Expiration Date'
                        ], data.expiryDate, fillResult, 'Geçerlilik Tarihi', true);
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
                                // Cinsiyet ve Medeni Hali zaten yukarıda özel olarak ZK seviyesinde işlendi.
                                // Bu genel döngüde ikinci kez rastgele commit edilmesini engelle.
                                if (combined.indexOf('cinsiyet') !== -1 || combined.indexOf('medeni') !== -1) {
                                    continue;
                                }
                                if (inp.checked) {
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
                                combined.indexOf('anaadi') !== -1 ||
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
                            var photoUploadStartedAt = performance.now();
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
                                        console.info('[YKN MAIN World] Fotoğraf yüklemesi daha önce tamamlanmış; tekrar engellendi.');
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
                                        console.info('[YKN MAIN World] Fotoğraf dosyası forma eklendi.');
                                    }
                                } else {
                                    addResultField(fillResult, 'Fotoğraf', false);
                                }
                            } catch (pErr) {
                                console.warn('[YKN MAIN World Photo Upload Error]', pErr);
                            } finally {
                                fillResult.photoUploadDurationMs = Math.round(performance.now() - photoUploadStartedAt);
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
            photoUploaded: false,
            photoUploadDurationMs: 0
        };
        for (const entry of results || []) {
            const result = entry?.result;
            if (!result) continue;
            aggregate.success = aggregate.success || result.success === true;
            aggregate.photoUploaded = aggregate.photoUploaded || result.photoUploaded === true;
            if (Number.isFinite(result.photoUploadDurationMs)) {
                aggregate.photoUploadDurationMs += result.photoUploadDurationMs;
            }
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

function mergeYoksisFillResponses(mainResponse, contentResponse, studentData) {
    const mainFilledFields = Array.isArray(mainResponse?.filledFields) ? mainResponse.filledFields : [];
    const contentFilledFields = Array.isArray(contentResponse?.filledFields) ? contentResponse.filledFields : [];
    const mainMissingFields = Array.isArray(mainResponse?.missingFields) ? mainResponse.missingFields : [];
    const contentMissingFields = Array.isArray(contentResponse?.missingFields) ? contentResponse.missingFields : [];
    const filledFields = new Set([
        ...mainFilledFields,
        ...contentFilledFields
    ]);
    const missingFields = new Set([
        ...mainMissingFields,
        ...contentMissingFields
    ]);
    for (const label of filledFields) missingFields.delete(label);

    const photoUploaded = mainResponse?.photoUploaded === true || contentResponse?.photoUploaded === true;
    const hasRequiredPhoto = !studentData?.croppedPhotoBase64 || photoUploaded;

    return {
        ...mainResponse,
        ...contentResponse,
        success: mainResponse?.success === true || contentResponse?.success === true,
        filledFields: Array.from(filledFields),
        missingFields: Array.from(missingFields),
        photoUploaded,
        mainWorldSynced: mainResponse?.success === true,
        partial: missingFields.size > 0 || !hasRequiredPhoto
    };
}

async function searchYoksisFromContent(tabId, kabulId, requestId, expectedStudent = null) {
    try {
        await waitForContentScript(tabId, 'yoksis', { frameId: 0 });
        return await withTimeout(
            sendTabMessage(tabId, {
                action: 'searchWithId',
                kabulId,
                requestId,
                expectedStudent
            }, { frameId: 0 }),
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
        await waitForContentScript(tabId, 'yoksis', { frameId: 0 });
        const state = await withTimeout(
            sendTabMessage(tabId, { action: 'GET_YOKSIS_FORM_STATE', requestId }, { frameId: 0 }),
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
        await waitForContentScript(tabId, 'yoksis', { frameId: 0 });
        const readiness = await withTimeout(
            sendTabMessage(tabId, {
                action: 'WAIT_YOKSIS_FORM',
                timeoutMs: 10000,
                requestId,
                afterFingerprint: options.afterFingerprint || '',
                afterDomRevision: options.afterDomRevision,
                requireFreshResult: options.requireFreshResult === true,
                expectedStudent: options.expectedStudent || null
            }, { frameId: 0 }),
            11_000,
            'YÖKSİS formu hazır olma zaman aşımı'
        );
        if (readiness && readiness.formReady === false && readiness.message) {
            options.lastErrorMessage = readiness.message;
        }
        return Boolean(readiness?.formReady);
    } catch (error) {
        console.warn('[YKN] YÖKSİS form hazır olma kontrolü başarısız:', error);
        return false;
    }
}


async function transferToYoksis(request) {
    const totalStartedAt = startYknTiming();
    try {
        return await transferToYoksisOperation(request, totalStartedAt);
    } catch (error) {
        finishYknTiming('yoksis-transfer-total', totalStartedAt, 'failed', 'transfer_failed');
        throw error;
    }
}

async function transferToYoksisOperation(request, totalStartedAt) {
    // Kabul kodu okunduktan sonra YÖKSİS sekmesi bulunur veya açılır;
    // YKN Talebi V2 ekranı güvenli biçimde açılıp kod aratılır.
    const kabulId = String(request.data?.yoksisId || request.data?.kabulId || request.kabulId || '')
        .replace(/[–—−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        // OCR tireyi kaybettiyse "821 EC2 34" biçimini kanonik hale getir.
        .replace(/\s+/g, '-')
        .trim()
        .toUpperCase();
    if (!kabulId) throw new Error('Kabul Mektup ID bulunamadı.');
    const yoksisTab = await getBackgroundYoksisTab();

    const expectedStudent = {
        passportNo: request.data?.pasaportNo || request.data?.passportNo || '',
        studentName: request.data?.ad || request.data?.name || request.data?.adi || request.data?.firstName || '',
        studentSurname: request.data?.soyad || request.data?.surname || request.data?.soyadi || request.data?.lastName || '',
        motherName: request.data?.anneAdi || '',
        fatherName: request.data?.babaAdi || ''
    };

    return runYoksisOperation(yoksisTab.id, 'search', request.requestId, async () => {
        await saveTemporaryStudentData(request.data);

        await waitForContentScript(yoksisTab.id, 'yoksis', { frameId: 0 });
        const navigationStartedAt = startYknTiming();
        const navigation = await sendTabMessage(yoksisTab.id, {
            action: 'OPEN_YOKSIS_YKN_REQUEST',
            requestId: request.requestId
        }, { frameId: 0 });
        if (navigation?.success !== true) {
            finishYknTiming('ykn-request-screen-navigation', navigationStartedAt, 'failed', 'navigation_not_confirmed');
            throw new Error(navigation?.error || 'YÖKSİS YKN Talebi V2 ekranı açılamadı.');
        }
        finishYknTiming('ykn-request-screen-navigation', navigationStartedAt);
        reportYknTiming('ykn-request-screen-navigation-content', navigation.durationMs);

        // Öncelik content-script yolunda: arama öncesi/sonrası form imzasını
        // karşılaştırabildiği için eski öğrenci formunu yeni sonuç sanmaz.
        // MAIN world yalnızca bu yol arama kontrolünü hiç bulamazsa fallback'tir.
        const searchStartedAt = startYknTiming();
        let response = await searchYoksisFromContent(yoksisTab.id, kabulId, request.requestId, expectedStudent);
        reportYknTiming('acceptance-input-readiness', response?.timing?.inputReadyDurationMs,
            response?.timing ? 'ok' : 'unavailable', response?.timing ? undefined : 'timing_unavailable');
        reportYknTiming('acceptance-id-write-and-verification', response?.timing?.inputWriteDurationMs,
            response?.timing ? 'ok' : 'unavailable', response?.timing ? undefined : 'timing_unavailable');
        reportYknTiming('search-trigger', response?.timing?.searchClickDurationMs,
            response?.searchTriggered === true ? 'ok' : 'failed', response?.searchTriggered === true ? undefined : 'search_not_confirmed');
        reportYknTiming('fresh-form-wait-content', response?.timing?.formWaitDurationMs,
            response?.formReady === true ? 'ok' : 'pending', response?.formReady === true ? undefined : 'form_not_ready');
        let mainTriggered = false;
        // Content-script eski sürümde yalnızca inputu bulup Enter'a basabiliyor
        // veya butonun ZK görsel parçasını kaçırabiliyor. Buton doğrulanmadıysa
        // MAIN-world taramasını kontrollü tek bir fallback olarak kullan.
        if (response?.searchTriggered !== true) {
            finishYknTiming('acceptance-id-input-and-search', searchStartedAt, 'fallback', 'content_search_not_confirmed');
            // Content script arama butonunu bulamadıysa MAIN-world fallback'inden
            // hemen önce güncel form durumunu al. Bu baseline, eski öğrenci
            // formunun fallback sonunda "hazır" sayılmasını engeller.
            const stateBeforeMainSearch = await getYoksisFormState(yoksisTab.id, request.requestId);
            if (!stateBeforeMainSearch) {
                throw new Error('YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin.');
            }
            const mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
            mainTriggered = Boolean(mainResults?.some(r => r.result?.searchTriggered === true));
            if (mainTriggered) {
                const formValidationStartedAt = startYknTiming();
                const formReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId, {
                    afterFingerprint: stateBeforeMainSearch.fingerprint,
                    afterDomRevision: stateBeforeMainSearch.domRevision,
                    requireFreshResult: true,
                    expectedStudent
                });
                if (!formReady) {
                    finishYknTiming('fresh-student-form-validation', formValidationStartedAt, 'failed', 'fresh_form_not_confirmed');
                    throw new Error('YÖKSİS arama komutu gönderildi ancak yeni öğrenci formu doğrulanmadı. Önceki form korunarak işlem durduruldu.');
                }
                finishYknTiming('fresh-student-form-validation', formValidationStartedAt);
                finishYknTiming('yoksis-transfer-total', totalStartedAt);
                return {
                    success: true,
                    transferred: true,
                    searchTriggered: true,
                    formReady: true,
                    ...(await getVerifiedYoksisTarget(yoksisTab.id)),
                    message: 'Kabul mektup kodu YÖKSİS’e aktarıldı ve yeni öğrenci formu doğrulandı.'
                };
            }
        }

        const searchTriggered = response?.searchTriggered === true || mainTriggered;
        if (!searchTriggered) {
            finishYknTiming('acceptance-id-input-and-search', searchStartedAt, 'failed', 'search_not_confirmed');
            throw new Error('YÖKSİS kabul mektubu araması başlatılamadı. Öğrenci başvuru/kayıt ekranını açık tutup tekrar deneyin.');
        }
        finishYknTiming('acceptance-id-input-and-search', searchStartedAt);

        if (response?.searchTriggered === true && response.formReady !== true) {
            if (response.message && response.message.startsWith('YÖKSİS:')) {
                throw new Error(response.message);
            }
            const hasFreshBaseline = typeof response.formFingerprintBeforeSearch === 'string'
                && Number.isFinite(response.domRevisionBeforeSearch);
            if (hasFreshBaseline) {
                const waitOptions = {
                    afterFingerprint: response.formFingerprintBeforeSearch,
                    afterDomRevision: response.domRevisionBeforeSearch,
                    requireFreshResult: true,
                    expectedStudent
                };
                const formValidationStartedAt = startYknTiming();
                const delayedFormReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId, waitOptions);
                if (delayedFormReady) {
                    finishYknTiming('fresh-student-form-validation', formValidationStartedAt);
                    finishYknTiming('yoksis-transfer-total', totalStartedAt);
                    return {
                        success: true,
                        transferred: true,
                        searchTriggered: true,
                        formReady: true,
                        ...(await getVerifiedYoksisTarget(yoksisTab.id)),
                        message: 'Kabul mektup kodu YÖKSİS’e aktarıldı ve gecikmeli öğrenci formu doğrulandı.'
                    };
                }
                finishYknTiming('fresh-student-form-validation', formValidationStartedAt, 'failed', 'fresh_form_not_confirmed');
                if (waitOptions.lastErrorMessage) {
                    throw new Error(waitOptions.lastErrorMessage);
                }
            }
        }

        // Content script bu noktada formun arama tıklamasından sonra yenilendiğini
        // doğrulamış olmalıdır. "Tıklandı" yanıtını başarıya çevirmek, eski formu
        // yeni kayıt sanan asıl hataydı.
        const formReady = response?.formReady === true;
        if (!formReady) {
            throw new Error('Kabul kodu gönderildi ancak yeni YÖKSİS öğrenci formu doğrulanmadı. Aynı arama otomatik tekrar gönderilmedi.');
        }

        finishYknTiming('yoksis-transfer-total', totalStartedAt);

        return {
            success: true,
            transferred: true,
            searchTriggered: true,
            formReady: true,
            ...(await getVerifiedYoksisTarget(yoksisTab.id)),
            message: 'Kabul mektup kodu YÖKSİS\'e aktarıldı ve öğrenci formu doğrulandı.'
        };
    });
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
        const isValidImage = typeof request.imageBase64 === 'string'
            && request.imageBase64.length <= 15_000_000
            && /^data:image\/(?:jpeg|png);base64,/i.test(request.imageBase64);
        if (!isAllowedApplyUrl(sender?.tab?.url || '') || !isValidImage) {
            sendResponse({ success: false, error: 'OCR isteği doğrulanamadı.' });
            return false;
        }
        void getPortalTabId()
            .then((portalTabId) => sendTabMessage(portalTabId, request))
            .then((response) => sendResponse(response || { success: false, error: 'Yetkili portal OCR yanıtı vermedi.' }))
            .catch(() => sendResponse({ success: false, error: 'Yetkili portal OCR isteği tamamlanamadı.' }));
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

    // Mesaj İkamet Portalından geliyorsa
    if (request.source === 'IKAMET_PORTAL') {
        if (!isAllowedPortalUrl(sender?.tab?.url || '') || !portalSecurity?.isValidPortalMessage(request)) {
            sendResponse({ success: false, requestId: request.requestId, error: 'İstek doğrulanamadı. Yetkili portalı yenileyip tekrar deneyin.' });
            return false;
        }
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

                    await saveTemporaryStudentData(response.data);

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
            const totalStartedAt = startYknTiming();
            (async () => {
                if (studentData?.yoksisReady !== true) {
                    throw new Error('Kabul kodu için doğrulanmış yeni YÖKSİS öğrenci formu yok. Önce kabul kodunu aratın.');
                }
                const yoksisTab = await resolveExpectedYoksisTab(
                    studentData?.yoksisTabId,
                    studentData?.yoksisTabUrl
                );
                await updateTab(yoksisTab.id, { active: true });
                if (yoksisTab.windowId) {
                    await chrome.windows.update(yoksisTab.windowId, { focused: true }).catch(() => {});
                }
                const response = await runYoksisOperation(yoksisTab.id, 'fill', request.requestId, async () => {
                    await saveTemporaryStudentData(studentData);

                    // Doldurma, arama postback'i tamamen bitmeden başlayamaz.
                    // Önce formun kararlı olduğunu doğrula; aksi halde eksik
                    // alanları ikinci/üçüncü yazımla telafi etmeye çalışma.
                    const formReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId);
                    if (!formReady) {
                        throw new Error('YÖKSİS öğrenci formu hazır değil; aktarım başlatılmadı.');
                    }

                    const hasPhoto = Boolean(studentData?.croppedPhotoBase64);
                    // Tek MAIN-world turunda önce alanları, sonra fotoğrafı işle.
                    // Fotoğraf postback'i araya girip alan senkronizasyonunu kesmesin.
                    const mainFillStartedAt = startYknTiming();
                    const mainResponse = await syncYoksisFormInMainWorld(yoksisTab.id, studentData);
                    finishYknTiming('main-world-fields-and-photo-transfer', mainFillStartedAt,
                        mainResponse?.success ? 'ok' : 'partial', mainResponse?.success ? undefined : 'main_world_incomplete');
                    if (hasPhoto) {
                        reportYknTiming('photo-file-preparation-and-form-assignment',
                            mainResponse?.photoUploadDurationMs,
                            mainResponse?.photoUploaded === true ? 'assigned' : 'failed',
                            mainResponse?.photoUploaded === true ? undefined : 'photo_assignment_not_confirmed');
                    }
                    const fieldData = hasPhoto
                        ? { ...studentData, croppedPhotoBase64: '', photoFileName: '' }
                        : studentData;

                    const needsFallback = !mainResponse.success
                        || (studentData?.croppedPhotoBase64 && mainResponse.photoUploaded !== true)
                        || mainResponse.missingFields.length > 0;

                    if (!needsFallback) {
                        return { ...mainResponse, mainWorldSynced: true, partial: false };
                    }

                    // Fallback yalnızca ilk denemenin eksik bıraktığı durumda
                    // bir kez çalışır. Sonrasında MAIN world'e yeniden yazmak
                    // eski kodda alanları ve fotoğraf yüklemesini çoğaltıyordu.
                    let contentResponse;
                    const fallbackStartedAt = startYknTiming();
                    try {
                        contentResponse = await sendTabMessage(yoksisTab.id, {
                            action: 'fillRemainingData',
                            data: fieldData,
                            requestId: request.requestId
                        }, { frameId: 0 });
                    } catch (contentError) {
                        finishYknTiming('content-script-fill-fallback', fallbackStartedAt, 'failed', 'content_fallback_unavailable');
                        return {
                            ...mainResponse,
                            partial: true,
                            error: contentError.message || mainResponse?.error
                        };
                    }

                    finishYknTiming('content-script-fill-fallback', fallbackStartedAt,
                        contentResponse?.success ? 'ok' : 'partial', 'main_world_incomplete');
                    return mergeYoksisFillResponses(mainResponse, contentResponse, studentData);
                });
                const hasCompletedAllFields = response?.success === true
                    && response.partial !== true
                    && (response.missingFields || []).length === 0;
                const hasRequiredPhoto = !request.data?.croppedPhotoBase64 || response.photoUploaded === true;
                const temporaryDataCleared = hasCompletedAllFields && hasRequiredPhoto
                    ? await clearTemporaryStudentData()
                    : undefined;
                finishYknTiming('yoksis-fill-total', totalStartedAt,
                    response?.success && !response.partial ? 'ok' : 'partial',
                    response?.partial ? 'fields_or_photo_need_review' : undefined);
                sendResponse({
                    ...response,
                    requestId: request.requestId,
                    ...(temporaryDataCleared === undefined ? {} : { temporaryDataCleared })
                });
            })().catch((error) => {
                finishYknTiming('yoksis-fill-total', totalStartedAt, 'failed', 'fill_operation_failed');
                sendResponse({ success: false, requestId: request.requestId, error: error.message });
            });
            return true;
        }
        else if (request.action === 'SAVE_CROPPED_PHOTO') {
            chrome.storage.local.get(['studentData'], (res) => {
                const current = res?.studentData || {};
                current.croppedPhotoBase64 = request.photoBase64;
                current.photoFileName = request.fileName;
                saveTemporaryStudentData(current).then(() => {
                    sendResponse({ success: true, requestId: request.requestId });
                }).catch(() => {
                    sendResponse({ success: false, requestId: request.requestId, error: 'Fotoğraf geçici olarak kaydedilemedi. Lütfen tekrar deneyin.' });
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
        if (!isAllowedApplyUrl(sender?.tab?.url || '') || !portalSecurity?.isValidApplyEvent(request)) {
            sendResponse({ success: false, requestId: request.requestId, error: 'Apply isteği doğrulanamadı.' });
            return false;
        }
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
