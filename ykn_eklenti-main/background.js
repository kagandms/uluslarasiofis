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

function getTemporaryStudentData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['studentData'], (res) => {
            resolve(res?.studentData || null);
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
        if (options && Object.keys(options).length > 0) {
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
                    ? ['pdf.min.js', 'document-parser.js', 'yoksis-field-targets.js', 'content.js']
                    : ['yoksis-field-targets.js', 'content.js'];
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
    finishYknTiming('yoksis-tab-resolution', startedAt);
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

                    function isVisible(el) {
                        if (!el || !el.isConnected) return false;
                        if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
                        if (/(?:-|_)chdextr$/i.test(el.id || '')) return false;
                        const doc = el.ownerDocument || document;
                        const win = doc.defaultView || window;
                        for (let cur = el; cur && cur !== doc.documentElement; cur = cur.parentElement) {
                            if (cur.hidden || cur.getAttribute?.('aria-hidden') === 'true') return false;
                            const style = win.getComputedStyle ? win.getComputedStyle(cur) : null;
                            if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
                                return false;
                            }
                        }
                        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
                        return rect.width > 0 && rect.height > 0;
                    }

                    function getButtonRoot(el) {
                        if (!el) return null;
                        return el.closest('button, .z-button, .z-toolbarbutton, input[type="button"], input[type="submit"], a, [role="button"]') || el;
                    }

                    function isKabulSearchButtonText(text) {
                        const cTxt = norm(text);
                        if (!cTxt || cTxt.length > 90) return false;
                        if (cTxt.includes('pasaport') || cTxt.includes('belge') || cTxt.includes('tckimlik') || cTxt.includes('temizle') || cTxt.includes('kaydet') || cTxt.includes('iptal') || cTxt.includes('vazgec')) {
                            return false;
                        }
                        const hasSearchVerb = cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || /\bbul\b/.test(cTxt);
                        return hasSearchVerb && (cTxt.includes('kabul') || cTxt.includes('mektup'));
                    }

                    function scoreKabulButton(candidate, refInput) {
                        const root = getButtonRoot(candidate);
                        if (!isVisible(root)) return 0;
                        if (root.closest('.z-menu, .z-menuitem, .z-menu-item, .z-menupopup, .z-caption, .z-tab, nav')) return 0;
                        const cTxt = norm(root.innerText || root.textContent || root.value || root.title || '');
                        if (!isKabulSearchButtonText(cTxt)) return 0;
                        let score = 0;
                        if (cTxt.includes('kabul') && cTxt.includes('ara')) score = 240;
                        else if (cTxt.includes('kabul') && (cTxt.includes('sorgula') || cTxt.includes('getir') || /\bbul\b/.test(cTxt))) score = 200;
                        else if (cTxt === 'ara' || cTxt === 'sorgula' || cTxt === 'getir') score = 150;
                        else if (cTxt.includes('ara') || cTxt.includes('sorgula')) score = 120;
                        if (score === 0) return 0;
                        const tag = (root.tagName || '').toLowerCase();
                        if (tag === 'button' || root.classList?.contains('z-button') || root.classList?.contains('z-toolbarbutton')) {
                            score += 25;
                        }
                        if (refInput && typeof refInput.compareDocumentPosition === 'function') {
                            try {
                                if (refInput.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING) {
                                    score += 30;
                                }
                            } catch (_) {}
                        }
                        return score;
                    }

                    function findBestButtonIn(scope, refInput, minScore = 100) {
                        if (!scope || !scope.querySelectorAll) return null;
                        const candidates = scope.querySelectorAll('button, .z-button, .z-toolbarbutton, [class*="z-button"], a, input[type="button"], input[type="submit"], [role="button"], span');
                        let best = null;
                        let bestScore = 0;
                        const seen = new Set();
                        for (let i = 0; i < candidates.length; i++) {
                            const root = getButtonRoot(candidates[i]);
                            if (!root || seen.has(root)) continue;
                            seen.add(root);
                            const score = scoreKabulButton(root, refInput);
                            if (score >= minScore && score > bestScore) {
                                bestScore = score;
                                best = root;
                            }
                        }
                        return best;
                    }

                    function findZkWidget(el, win) {
                        if (!el || !win?.zk?.Widget?.$) return null;
                        for (let cur = el, depth = 0; cur && depth < 6; cur = cur.parentElement, depth++) {
                            try {
                                const w = win.zk.Widget.$(cur);
                                if (w) return w;
                            } catch (_) {}
                        }
                        if (el.querySelector) {
                            const inner = el.querySelector('.z-button, button, input');
                            if (inner) {
                                try {
                                    const w = win.zk.Widget.$(inner);
                                    if (w) return w;
                                } catch (_) {}
                            }
                        }
                        return null;
                    }

                    const allDocs = getAllDocs(document);

                    let inp = null;
                    let btn = null;
                    let targetWin = window;

                    for (const doc of allDocs) {
                        const win = doc.defaultView || window;
                        let dInp = null;
                        let dBtn = null;

                        // 1. ÖNCELİK: Placeholder / Title / Name / Id / Value üzerinden doğrudan Input bulma
                        const allInputs = doc.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])');
                        for (let i = 0; i < allInputs.length; i++) {
                            const it = allInputs[i];
                            if (!isVisible(it)) continue;
                            const ph = norm((it.placeholder || '') + ' ' + (it.getAttribute('placeholder') || '') + ' ' + (it.title || '') + ' ' + (it.name || '') + ' ' + (it.id || ''));
                            if (ph.includes('kabul') && !ph.includes('pasaport') && !ph.includes('tc') && !ph.includes('dogum')) {
                                dInp = it;
                                break;
                            }
                        }

                        // 2. ÖNCELİK: Etiket ("Kabul Mektup ID ile Sorgula" veya "Kabul Mektup Id") üzerinden bulma
                        if (!dInp) {
                            const textNodes = doc.querySelectorAll('span, td, div, label, b, strong, th, p, a, legend, caption, .z-caption, .z-groupbox-header');
                            for (let i = 0; i < textNodes.length; i++) {
                                const node = textNodes[i];
                                if (node.children.length > 3) continue;
                                const txt = norm(node.innerText || node.textContent || '');
                                if (txt.includes('kabul') && (txt.includes('id') || txt.includes('sorgula') || txt.includes('mektup') || txt.includes('kod') || txt.includes('no')) && !txt.includes('kabultarih')) {
                                    const td = node.closest('td');
                                    if (td && td.nextElementSibling && !dInp) {
                                        const candidate = td.nextElementSibling.querySelector('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])');
                                        if (isVisible(candidate)) dInp = candidate;
                                    }

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

                                    if (box && !dInp) {
                                        const bInps = box.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])');
                                        for (let j = 0; j < bInps.length; j++) {
                                            if (!isVisible(bInps[j])) continue;
                                            const bPh = norm((bInps[j].placeholder || '') + ' ' + (bInps[j].getAttribute('placeholder') || '') + ' ' + (bInps[j].id || '') + ' ' + (bInps[j].name || ''));
                                            if (!bPh.includes('pasaport') && !bPh.includes('tc') && !bPh.includes('dogum')) {
                                                dInp = bInps[j];
                                                break;
                                            }
                                        }
                                    }
                                    if (dInp) break;
                                }
                            }
                        }

                        // 3. ÖNCELİK: Input'un altındaki satırda, kapsayıcılarında veya belgede "Kabul Mektup Id İle Ara" butonunu bul
                        if (dInp) {
                            const row = dInp.closest('tr, .z-row, .z-hbox, .z-vbox, .form-group');
                            if (row) {
                                dBtn = findBestButtonIn(row, dInp, 100);
                                for (let sib = row.nextElementSibling, hop = 0; sib && hop < 3 && !dBtn; sib = sib.nextElementSibling, hop++) {
                                    dBtn = findBestButtonIn(sib, dInp, 100);
                                }
                            }
                            for (let parent = dInp.parentElement, depth = 0; parent && parent !== doc.body && depth < 12 && !dBtn; parent = parent.parentElement, depth++) {
                                dBtn = findBestButtonIn(parent, dInp, 180) || (depth <= 4 ? findBestButtonIn(parent, dInp, 120) : null);
                            }
                        }

                        if (!dBtn) {
                            dBtn = findBestButtonIn(doc, dInp, 180);
                        }

                        // 4. Buton bulunduysa ve input henüz bulunmadıysa butonun üst/ebeveyn satırından inputu tamamla
                        if (dBtn && !dInp) {
                            let parent = dBtn.parentElement;
                            while (parent && parent !== doc.body) {
                                const inps = parent.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])');
                                for (let k = 0; k < inps.length; k++) {
                                    if (!isVisible(inps[k])) continue;
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

                        if (dInp) {
                            inp = dInp;
                            btn = dBtn;
                            targetWin = win;
                            break;
                        }
                    }


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
                        inputWidget = findZkWidget(inp, targetWin);
                        if (inputWidget) {
                            try {
                                if (typeof inputWidget.setValue === 'function') inputWidget.setValue(code);
                                inputWidget._value = code;
                                inputWidget._lastValue = code;
                                if (typeof inputWidget.fire === 'function') {
                                    inputWidget.fire('onChange', { value: code }, { toServer: true });
                                    zkChangeSent = true;
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
                        const buttonWidget = findZkWidget(btn, targetWin);
                        if (buttonWidget && typeof buttonWidget.fire === 'function') {
                            buttonWidget.fire('onClick', null, { toServer: true });
                        } else {
                            btn.focus();
                            try { btn.click(); } catch (_) {}
                            const innerBtn = btn.querySelector ? btn.querySelector('button, input[type="button"], input[type="submit"]') : null;
                            if (innerBtn && innerBtn !== btn) {
                                try { innerBtn.click(); } catch (_) {}
                            }
                        }
                    }

                    if (inp && !btn) {
                        // Buton yoksa yalnızca Enter/onOK fallback'i kullan.
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        const wi = inputWidget || findZkWidget(inp, targetWin);
                        if (wi && typeof wi.fire === 'function') {
                            try { wi.fire('onOK', null, { toServer: true }); } catch (_) {}
                        }
                    }

                    return {
                        success: Boolean(inp),
                        inputFound: Boolean(inp),
                        buttonFound: Boolean(btn),
                        searchTriggered: Boolean(inp)
                    };
                } catch (e) {
                    console.error('[YKN MAIN World Search Error]', { errorName: e?.name || 'Error' });
                    return { error: e.message };
                }
            },
            args: [kabulId]
        });
        return results;
    } catch (err) {
        console.warn('executeYoksisSearchInMainWorld error:', { errorName: err?.name || 'Error' });
        return null;
    }
}

/** Runs only the packaged ZK controller in the validated main frame. */
async function runYoksisZkCommand(tabId, options) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', files: ['yoksis-field-targets.js', 'zk-form-controls.js'] });
    const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] }, world: 'MAIN', args: [options],
        func: async function executeYoksisZkCommand(command) { return await window.YknZkForm.execute(command); }
    });
    return results?.[0]?.result || { success: false, verified: false };
}

function buildYoksisCountrySelections(studentData) {
    return [
        { field: 'nationality', label: 'Uyruğu', value: studentData?.uyruk },
        { field: 'birthNationality', label: 'Doğum Uyruğu', value: studentData?.uyruk },
        { field: 'birthCountry', label: 'Doğum Yeri Ülkesi', value: studentData?.dogumUlkesi || studentData?.uyruk },
        { field: 'issuerCountry', label: 'Belgeyi Veren Ülke', value: studentData?.uyruk }
    ].filter(selection => String(selection.value || '').trim());
}

async function syncYoksisFormInMainWorld(tabId, studentData, options = {}) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return null;
    try {
        if (options.phase !== 'photo') {
            await chrome.scripting.executeScript({
                target: { tabId }, world: 'MAIN', files: ['yoksis-field-targets.js']
            });
        }
        const results = await chrome.scripting.executeScript({
            // Form ve alt frameler getAllDocs ile bu tek MAIN-world çalışması
            // içinde ele alınıyor; allFrames ikinci/üçüncü commit üretmesin.
            target: { tabId },
            world: 'MAIN',
            args: [studentData || null, options.phase || 'complete'],
            func: (data, phase) => {
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

                    function isVisibleElement(el) {
                        if (!el || !el.isConnected || el.disabled) return false;
                        for (var ancestor = el; ancestor; ancestor = ancestor.parentElement) {
                            var style = ancestor.ownerDocument.defaultView.getComputedStyle(ancestor);
                            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
                        }
                        return true;
                    }

                    function findControl(labels, kind, docs) {
                        const candidates = docs.map(root => window.YknFieldTargets.find({ root, labels, kind })).filter(Boolean);
                        const unique = [...new Set(candidates)];
                        return unique.length === 1 ? unique[0] : null;
                    }

                    function findStudentDocumentNumber(docs) {
                        return findControl(['Belge No'], 'text', docs);
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
                    if (data && phase !== 'photo') {
                        var firstName = data.firstName || data.adi || data.ad || '';
                        var lastName = data.lastName || data.soyadi || data.soyad || '';
                        var passportNo = data.pasaportNo || data.passportNo || '';
                        var birthPlace = data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || '';
                        var issuingAuthority = data.verenMakam || data.issuingAuthority || '';

                        fillTextByLabels(allDocs, ['Adı', 'Öğrenci Adı', 'Ad', 'First Name', 'Given Name'], firstName, fillResult, 'Adı', false);
                        fillTextByLabels(allDocs, ['Soyadı', 'Öğrenci Soyadı', 'Soyad', 'Last Name', 'Surname'], lastName, fillResult, 'Soyadı', false);
                        fillTextByLabels(allDocs, ['Anne Adı', 'Ana Adı', 'Anne İsmi', 'Ana İsmi', 'Mother Name', "Mother's Name"], data.anneAdi, fillResult, 'Anne Adı', false);
                        fillTextByLabels(allDocs, ['Baba Adı', 'Baba İsmi', 'Father Name', "Father's Name"], data.babaAdi, fillResult, 'Baba Adı', false);

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

                    var photoUploadAttempted = false;
                    for (var di = 0; di < allDocs.length; di++) {
                        var doc = allDocs[di];
                        var win = doc.defaultView || window;

                        // Fotoğraf Yükleme (MAIN World güvencesi)
                        if (phase !== 'fields' && data && data.croppedPhotoBase64 && !photoUploadAttempted) {
                            photoUploadAttempted = true;
                            var photoUploadStartedAt = performance.now();
                            try {
                                var buttons = doc.querySelectorAll('button, a, input[type="button"], span.z-button, div.z-button');
                                var photoBtn = null;
                                for (var b = 0; b < buttons.length; b++) {
                                    if (!isVisibleElement(buttons[b])) continue;
                                    var bt = norm(buttons[b].innerText || buttons[b].textContent || buttons[b].value || buttons[b].getAttribute('aria-label') || buttons[b].getAttribute('title') || buttons[b].id || '');
                                    if (bt.indexOf('fotograf') !== -1 && (bt.indexOf('yukle') !== -1 || bt.indexOf('sec') !== -1 || bt.indexOf('ekle') !== -1)) {
                                        photoBtn = buttons[b];
                                        break;
                                    }
                                }

                                if (!photoBtn) {
                                    var allLabels = doc.querySelectorAll('span, td, div, label, b');
                                    for (var l = 0; l < allLabels.length; l++) {
                                        if (!isVisibleElement(allLabels[l])) continue;
                                        var lt = norm(allLabels[l].innerText || allLabels[l].textContent || '');
                                        if (lt.indexOf('fotografadi') !== -1 || lt === 'fotograf') {
                                            var rowEl = allLabels[l].closest('tr') || allLabels[l].closest('div') || allLabels[l].parentElement;
                                            if (rowEl) {
                                                var btnInRow = rowEl.querySelector('button, a, input[type="button"], .z-button');
                                                if (isVisibleElement(btnInRow)) { photoBtn = btnInRow; break; }
                                            }
                                        }
                                    }
                                }

                                if (!photoBtn) {
                                    var uploadEl = doc.querySelector('[upload], .z-upload, .z-fileupload');
                                    if (uploadEl && isVisibleElement(uploadEl)) {
                                        photoBtn = uploadEl.matches('button, a, input[type="button"], .z-button')
                                            ? uploadEl
                                            : (uploadEl.querySelector('button, a, input[type="button"], .z-button') || uploadEl);
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
                                    var allFileInputs = Array.from(doc.querySelectorAll('input[type="file"]')).filter(function(input) { return isVisibleElement(input.parentElement); });
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
                                        try {
                                            var photoNameInputs = doc.querySelectorAll('input');
                                            for (var pni = 0; pni < photoNameInputs.length; pni++) {
                                                var pInp = photoNameInputs[pni];
                                                var pRow = pInp.closest('tr');
                                                var pText = pRow ? norm(pRow.innerText || pRow.textContent) : '';
                                                if (pText.indexOf('fotografadi') !== -1 || pText === 'fotograf' || (pInp.placeholder && norm(pInp.placeholder).indexOf('fotograf') !== -1)) {
                                                    if (!pInp.value) {
                                                        pInp.value = photoName;
                                                        commitTextbox(pInp, win);
                                                    }
                                                }
                                            }
                                        } catch (_) {}
                                    }
                                } else {
                                    addResultField(fillResult, 'Fotoğraf', false);
                                }
                            } catch (pErr) {
                                console.warn('[YKN MAIN World Photo Upload Error]', { errorName: pErr?.name || 'Error' });
                            } finally {
                                fillResult.photoUploadDurationMs = Math.round(performance.now() - photoUploadStartedAt);
                            }
                        }


                    }

                    fillResult.success = !data || fillResult.filledFields.length > 0;
                    return fillResult;
                } catch (e) {
                    console.error('[YKN MAIN World Form Sync Error]', { errorName: e?.name || 'Error' });
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
        if (options.phase !== 'photo') {
            for (const selection of buildYoksisCountrySelections(studentData)) {
                const response = await runYoksisZkCommand(tabId, {
                    action: 'selectCountry', field: selection.field, value: selection.value, requestId: options.requestId
                });
                (response?.verified ? aggregate.filledFields : aggregate.missingFields).push(selection.label);
            }
        }
        for (const [field, value, label] of [['gender', studentData?.cinsiyet, 'Cinsiyet'], ['marital', studentData?.medeniHali || studentData?.medeniHal, 'Medeni Hali']]) {
            if (!value || options.phase === 'photo') continue;
            const response = await runYoksisZkCommand(tabId, {
                action: 'selectRadio', field, value, requestId: options.requestId
            });
            (response?.verified ? aggregate.filledFields : aggregate.missingFields).push(label);
        }
        aggregate.success = aggregate.filledFields.length > 0;
        aggregate.partial = aggregate.missingFields.length > 0;
        return aggregate;
    } catch (err) {
        console.warn('syncYoksisFormInMainWorld error:', { errorName: err?.name || 'Error' });
        return { success: false, filledFields: [], missingFields: [], photoUploaded: false, error: err.message };
    }
}

function getExpectedYoksisFields(studentData) {
    const expected = new Set();
    const hasValue = (...values) => values.some((value) => String(value ?? '').trim() !== '');
    if (hasValue(studentData?.firstName, studentData?.adi, studentData?.ad)) expected.add('Adı');
    if (hasValue(studentData?.lastName, studentData?.soyadi, studentData?.soyad)) expected.add('Soyadı');
    if (hasValue(studentData?.anneAdi)) expected.add('Anne Adı');
    if (hasValue(studentData?.babaAdi)) expected.add('Baba Adı');
    if (hasValue(studentData?.uyruk)) {
        expected.add('Uyruğu');
        expected.add('Doğum Uyruğu');
        expected.add('Belgeyi Veren Ülke');
    }
    if (hasValue(studentData?.dogumUlkesi, studentData?.uyruk)) expected.add('Doğum Yeri Ülkesi');
    if (hasValue(studentData?.cinsiyet, studentData?.genderSource)) expected.add('Cinsiyet');
    if (hasValue(studentData?.medeniHali, studentData?.medeniHal, studentData?.maritalSource)) expected.add('Medeni Hali');
    if (hasValue(studentData?.dogumYeriAciklamasi, studentData?.dogumYeri, studentData?.birthPlace)) expected.add('Doğum Yeri Açıklaması');
    if (hasValue(studentData?.verenMakam, studentData?.issuingAuthority)) expected.add('Belgeyi Veren Makam');
    if (hasValue(studentData?.pasaportNo, studentData?.passportNo)) expected.add('Belge No');
    if (hasValue(studentData?.birthDate, studentData?.dogumTarihi)) expected.add('Doğum Tarihi');
    if (hasValue(studentData?.issueDate, studentData?.passportIssueDate, studentData?.duzenlemeTarihi,
        studentData?.pasaportDuzenlemeTarihi, studentData?.verilisTarihi, studentData?.belgeDuzenlemeTarihi)) expected.add('Düzenleme Tarihi');
    if (hasValue(studentData?.expiryDate, studentData?.passportExpiryDate, studentData?.gecerlilikTarihi,
        studentData?.pasaportGecerlilikTarihi, studentData?.bitisTarihi, studentData?.belgeGecerlilikTarihi)) expected.add('Geçerlilik Tarihi');
    return Array.from(expected);
}

function mergeYoksisFillResponses(mainResponse, contentResponse, studentData) {
    const mainFilledFields = Array.isArray(mainResponse?.filledFields) ? mainResponse.filledFields : [];
    const contentFilledFields = Array.isArray(contentResponse?.filledFields) ? contentResponse.filledFields : [];
    const mainMissingFields = Array.isArray(mainResponse?.missingFields) ? mainResponse.missingFields : [];
    const contentMissingFields = Array.isArray(contentResponse?.missingFields) ? contentResponse.missingFields : [];
    const filledFields = new Set([...mainFilledFields, ...contentFilledFields]);
    const missingFields = new Set([
        ...mainMissingFields,
        ...contentMissingFields
    ]);
    const expectedFields = getExpectedYoksisFields(studentData);
    for (const label of expectedFields) {
        if (!filledFields.has(label)) missingFields.add(label);
    }
    for (const label of filledFields) missingFields.delete(label);

    const photoUploaded = mainResponse?.photoUploaded === true || contentResponse?.photoUploaded === true;
    const hasRequiredPhoto = !studentData?.croppedPhotoBase64 || photoUploaded;
    const failedFields = new Set([
        ...(Array.isArray(mainResponse?.failedFields) ? mainResponse.failedFields : []),
        ...(Array.isArray(contentResponse?.failedFields) ? contentResponse.failedFields : [])
    ]);
    const fieldResults = expectedFields.map((label) => ({
        label,
        status: filledFields.has(label) ? 'verified' : failedFields.has(label) ? 'failed' : 'missing'
    }));
    if (studentData?.croppedPhotoBase64) {
        fieldResults.push({ label: 'Fotoğraf', status: photoUploaded ? 'verified' : 'missing' });
    }

    return {
        ...mainResponse,
        ...contentResponse,
        success: filledFields.size > 0,
        filledFields: Array.from(filledFields),
        missingFields: Array.from(missingFields),
        failedFields: Array.from(failedFields),
        fieldResults,
        photoUploaded,
        mainWorldSynced: mainResponse?.success === true,
        ...(contentResponse?.error ? { error: contentResponse.error } : {}),
        partial: missingFields.size > 0 || !hasRequiredPhoto
    };
}

function buildVerifiedFillResponse(mainResponse, verification, studentData) {
    const filledFields = verification?.filledFields || [];
    return {
        ...mainResponse,
        success: filledFields.length > 0,
        filledFields,
        missingFields: getExpectedYoksisFields(studentData).filter(label => !filledFields.includes(label)),
        failedFields: verification?.failedFields || [],
        ...(verification?.error ? { error: verification.error } : {})
    };
}

async function verifyTransferredYoksisFields(context) {
    try {
        const response = await sendTabMessage(context.tabId, {
            action: 'verifyYoksisFields', data: context.studentData, requestId: context.requestId
        }, { frameId: 0 });
        if (!Array.isArray(response?.filledFields) || !Array.isArray(response?.missingFields)) {
            throw new Error('YÖKSİS alan doğrulama yanıtı alınamadı.');
        }
        return response;
    } catch (error) {
        console.warn('YÖKSİS field verification failed.', { errorName: error.name });
        return { success: false, filledFields: [], failedFields: getExpectedYoksisFields(context.studentData), error: error.message };
    }
}

async function completeMissingYoksisFields(context, mainResponse) {
    if (mainResponse.error) return { ...mergeYoksisFillResponses(mainResponse, null, context.studentData), success: false, partial: true };
    const combined = mergeYoksisFillResponses(mainResponse, null, context.studentData);
    if (!combined.partial) return combined;
    const fallbackStartedAt = startYknTiming();
    const fieldData = { ...context.studentData, ...(mainResponse.photoUploaded ? { croppedPhotoBase64: '', photoBase64: '' } : {}) };
    try {
        const fallback = await sendTabMessage(context.tabId, {
            action: 'fillRemainingData', data: fieldData, requestId: context.requestId
        }, { frameId: 0 });
        const verification = await verifyTransferredYoksisFields(context);
        const verified = buildVerifiedFillResponse({ ...mainResponse, photoUploaded: mainResponse.photoUploaded || fallback?.photoUploaded === true }, verification, context.studentData);
        const result = mergeYoksisFillResponses(verified, null, context.studentData);
        finishYknTiming('content-script-fill-fallback', fallbackStartedAt, result.partial ? 'partial' : 'ok');
        return verification?.error ? { ...result, success: false, partial: true } : result;
    } catch (error) {
        finishYknTiming('content-script-fill-fallback', fallbackStartedAt, 'failed', 'content_fallback_unavailable');
        console.warn('YÖKSİS remaining field transfer failed.', { errorName: error.name });
        return { ...combined, error: error.message, partial: true };
    }
}

async function transferYoksisFieldsAndPhoto(context) {
    const startedAt = startYknTiming();
    const mainResponse = await syncYoksisFormInMainWorld(context.tabId, context.studentData, {
        phase: 'fields', requestId: context.requestId
    });
    const settled = await verifyTransferredYoksisFields(context);
    if (settled?.error) return { ...buildVerifiedFillResponse(mainResponse, settled, context.studentData), success: false, partial: true };
    let photoResponse = null;
    if (context.studentData.croppedPhotoBase64) {
        photoResponse = await syncYoksisFormInMainWorld(context.tabId, context.studentData, {
            phase: 'photo', requestId: context.requestId
        });
        reportYknTiming('photo-file-preparation-and-form-assignment', photoResponse?.photoUploadDurationMs,
            photoResponse?.photoUploaded ? 'assigned' : 'failed');
    }
    const verification = photoResponse ? await verifyTransferredYoksisFields(context) : settled;
    const verified = buildVerifiedFillResponse({ ...mainResponse, photoUploaded: photoResponse?.photoUploaded === true }, verification, context.studentData);
    const result = await completeMissingYoksisFields(context, verified);
    finishYknTiming('main-world-fields-and-photo-transfer', startedAt, result.partial ? 'partial' : 'ok');
    return result;
}

async function fillReadyYoksisStudent(context) {
    const formReady = await waitForYoksisFormReady(context.tabId, context.requestId, {
        requireBoundSearch: true, expectedKabulId: context.studentData.yoksisId || context.studentData.kabulId || '', expectedStudent: context.studentData
    });
    if (!formReady) throw new Error('YÖKSİS öğrenci formu hazır değil; aktarım başlatılmadı.');
    await saveTemporaryStudentData(context.studentData);
    return await transferYoksisFieldsAndPhoto(context);
}

async function fillBoundYoksisStudent(studentData, requestId) {
    if (studentData.yoksisReady !== true) throw new Error('Kabul kodu için doğrulanmış yeni YÖKSİS öğrenci formu yok. Önce kabul kodunu aratın.');
    const tab = await resolveExpectedYoksisTab(studentData.yoksisTabId, studentData.yoksisTabUrl);
    await updateTab(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(error => {
        console.warn('YÖKSİS window focus failed.', { errorName: error.name });
    });
    const startedAt = startYknTiming();
    const response = await runYoksisOperation(tab.id, 'fill', requestId, async () => {
        const result = await fillReadyYoksisStudent({ tabId: tab.id, studentData, requestId });
        const isComplete = result.success === true && !result.partial && (result.missingFields || []).length === 0
            && (!studentData.croppedPhotoBase64 || result.photoUploaded === true);
        return { ...result, ...(isComplete ? { temporaryDataCleared: await clearTemporaryStudentData() } : {}) };
    });
    finishYknTiming('yoksis-fill-total', startedAt, response.partial ? 'partial' : 'ok');
    return response;
}

async function fillStoredYoksisStudent(request) {
    const stored = await getTemporaryStudentData();
    if (!stored) throw new Error('Öğrenci bilgisi bulunamadı; kabul kodunu yeniden aratın.');
    const photo = request.action === 'CROPPED_PHOTO_CONFIRMED' ? request.photoBase64 : '';
    if (request.action === 'CROPPED_PHOTO_CONFIRMED' && (typeof photo !== 'string' || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(photo))) {
        throw new Error('Kırpılmış fotoğraf verisi bulunamadı veya geçersiz.');
    }
    return await fillBoundYoksisStudent({ ...stored, croppedPhotoBase64: photo, photoBase64: photo,
        photoFileName: photo ? request.fileName || 'ogrenci_foto.jpg' : '' }, request.requestId);
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
        console.warn('[YKN] Content-script YÖKSİS araması başarısız:', { errorName: error?.name || 'Error' });
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
        console.warn('[YKN] YÖKSİS form durumu okunamadı:', { errorName: error?.name || 'Error' });
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
                expectedStudent: options.expectedStudent || null,
                requireBoundSearch: options.requireBoundSearch === true,
                expectedKabulId: options.expectedKabulId || ''
            }, { frameId: 0 }),
            11_000,
            'YÖKSİS formu hazır olma zaman aşımı'
        );
        if (readiness && readiness.formReady === false && readiness.message) {
            options.lastErrorMessage = readiness.message;
        }
        return Boolean(readiness?.formReady);
    } catch (error) {
        console.warn('[YKN] YÖKSİS form hazır olma kontrolü başarısız:', { errorName: error?.name || 'Error' });
        return false;
    }
}

function isUnchangedEmptyYoksisForm(state, fingerprint, domRevision) {
    return state?.hasPopulatedStudentForm === false
        && typeof fingerprint === 'string'
        && state.fingerprint === fingerprint
        && Number.isFinite(domRevision)
        && state.domRevision === domRevision;
}

async function runVerifiedMainWorldSearch(tabId, kabulId, requestId, expectedStudent, baseline) {
    const results = await executeYoksisSearchInMainWorld(tabId, kabulId);
    const searchDispatched = Boolean(results?.some((result) => result.result?.searchTriggered === true));
    if (!searchDispatched) return null;

    const formReady = await waitForYoksisFormReady(tabId, requestId, {
        afterFingerprint: baseline.fingerprint,
        afterDomRevision: baseline.domRevision,
        requireFreshResult: true,
        expectedStudent,
        expectedKabulId: kabulId
    });
    if (!formReady) {
        throw new Error('YÖKSİS arama komutu gönderildi ancak yeni öğrenci formu doğrulanmadı. Önceki form korunarak işlem durduruldu.');
    }

    return {
        success: true,
        transferred: true,
        searchTriggered: true,
        formReady: true,
        ...(await getVerifiedYoksisTarget(tabId)),
        message: 'Kabul mektup kodu YÖKSİS’e aktarıldı ve yeni öğrenci formu doğrulandı.'
    };
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

    const performSearch = async () => {
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
        if (response?.allowMainFallback === false) throw new Error(response.message || 'Önceki YÖKSİS formu korundu.');
        if (response?.searchTriggered !== true) {
            finishYknTiming('acceptance-id-input-and-search', searchStartedAt, 'fallback', 'content_search_not_confirmed');
            // Content script arama butonunu bulamadıysa MAIN-world fallback'inden
            // hemen önce güncel form durumunu al. Bu baseline, eski öğrenci
            // formunun fallback sonunda "hazır" sayılmasını engeller.
            const stateBeforeMainSearch = await getYoksisFormState(yoksisTab.id, request.requestId);
            if (!stateBeforeMainSearch || stateBeforeMainSearch.hasPopulatedStudentForm !== false) {
                throw new Error('YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin.');
            }
            const formValidationStartedAt = startYknTiming();
            const mainSearch = await runVerifiedMainWorldSearch(
                yoksisTab.id,
                kabulId,
                request.requestId,
                expectedStudent,
                stateBeforeMainSearch
            );
            mainTriggered = mainSearch !== null;
            if (mainSearch) {
                finishYknTiming('fresh-student-form-validation', formValidationStartedAt);
                finishYknTiming('yoksis-transfer-total', totalStartedAt);
                return mainSearch;
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
                    expectedKabulId: kabulId,
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
                const currentFormState = await getYoksisFormState(yoksisTab.id, request.requestId);
                if (isUnchangedEmptyYoksisForm(
                    currentFormState,
                    response.formFingerprintBeforeSearch,
                    response.domRevisionBeforeSearch
                )) {
                    const fallbackStartedAt = startYknTiming();
                    const fallbackSearch = await runVerifiedMainWorldSearch(
                        yoksisTab.id,
                        kabulId,
                        request.requestId,
                        expectedStudent,
                        currentFormState
                    );
                    if (fallbackSearch) {
                        finishYknTiming('acceptance-id-input-and-search', fallbackStartedAt, 'fallback', 'content_click_not_applied');
                        finishYknTiming('yoksis-transfer-total', totalStartedAt);
                        return fallbackSearch;
                    }
                    finishYknTiming('acceptance-id-input-and-search', fallbackStartedAt, 'failed', 'main_search_not_dispatched');
                }
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
    };
    return runYoksisOperation(yoksisTab.id, 'search', request.requestId, async () => {
        await updateTab(yoksisTab.id, { active: true });
        if (yoksisTab.windowId) await chrome.windows.update(yoksisTab.windowId, { focused: true });
        const response = await performSearch();
        if (response.success && response.formReady) {
            await saveTemporaryStudentData({ ...request.data, yoksisId: kabulId,
                yoksisReady: true, yoksisTabId: response.yoksisTabId, yoksisTabUrl: response.yoksisTabUrl });
        }
        return response;
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
    if (request.action === 'YOKSIS_ZK_COMMAND') {
        const command = request.command || {};
        const allowedValues = command.field === 'gender' ? ['Erkek', 'Kadın'] : command.field === 'marital' ? ['Bekar', 'Evli'] : [];
        const isCountryCommand = ['selectCountry', 'verifyCountry'].includes(command.action)
            && ['nationality', 'birthNationality', 'birthCountry', 'issuerCountry'].includes(command.field)
            && typeof command.value === 'string' && command.value.trim().length > 0 && command.value.length <= 100
            && typeof command.requestId === 'string' && command.requestId.length > 0 && command.requestId.length <= 160;
        const validCommand = isCountryCommand || command.action === 'waitForIdle' || (['selectRadio', 'verifyRadio'].includes(command.action)
            && allowedValues.includes(command.value) && typeof command.requestId === 'string' && command.requestId.length > 0 && command.requestId.length <= 160);
        if (!isYoksisUrl(sender?.tab?.url || '') || sender.frameId !== 0 || !validCommand) {
            sendResponse({ success: false, verified: false, error: 'YÖKSİS komutu doğrulanamadı.' });
            return false;
        }
        void runYoksisZkCommand(sender.tab.id, command).then(sendResponse)
            .catch(() => sendResponse({ success: false, verified: false, error: 'YÖKSİS güncellemesi doğrulanamadı.' }));
        return true;
    }

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

    if (request.action === 'CROPPED_PHOTO_CONFIRMED' || request.action === 'FILL_YOKSIS_WITHOUT_PHOTO') {
        void fillStoredYoksisStudent(request).then(sendResponse)
            .catch(error => sendResponse({ success: false, error: error.message }));
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
            void fillBoundYoksisStudent(request.data || {}, request.requestId)
                .then(response => sendResponse({ ...response, requestId: request.requestId }))
                .catch(error => sendResponse({ success: false, requestId: request.requestId, error: error.message }));
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
