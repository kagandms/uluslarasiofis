// background.js

let ikametTabId = null;
let applyTabId = null;
let yoksisTabId = null;
let pendingApplyNavigation = null;

const APPLY_APPLICATIONS_URL = 'https://apply.topkapi.edu.tr/panel/applications';
const YOKSIS_URL = 'https://yoksis.yok.gov.tr/';
const CONTENT_READY_TIMEOUT_MS = 15_000;
const CONTENT_READY_INITIAL_DELAY_MS = 250;
const CONTENT_READY_MAX_DELAY_MS = 1_000;

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

async function ensureContentScriptInjected(tabId, pageKind) {
    try {
        if (chrome.scripting && chrome.scripting.executeScript) {
            const file = pageKind === 'bridge' ? 'bridge.js' : 'content.js';
            await chrome.scripting.executeScript({
                target: { tabId },
                files: [file]
            });
        }
    } catch (error) {
        // Sayfa henüz hazır olmayabilir veya izin kısıtlı olabilir
    }
}

async function waitForContentScript(tabId, pageKind, requiredPath = '') {
    const deadline = Date.now() + CONTENT_READY_TIMEOUT_MS;
    let delay = CONTENT_READY_INITIAL_DELAY_MS;
    let attemptedInjection = false;

    while (Date.now() < deadline) {
        try {
            const response = await sendTabMessage(tabId, {
                action: 'PING',
                pageKind
            });
            const hasExpectedRoute = !requiredPath
                || (typeof response?.url === 'string' && new URL(response.url).pathname.replace(/\/$/, '') === requiredPath);
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

    try {
        const portalTabs = await queryTabs({
            url: ['*://*.vercel.app/*', 'http://localhost/*', 'http://127.0.0.1/*']
        });
        if (portalTabs && portalTabs.length > 0) {
            ikametTabId = portalTabs[0].id;
            return ikametTabId;
        }
    } catch (_) {}

    return null;
}

function notifyPortal(request) {
    getPortalTabId().then((targetTabId) => {
        if (!targetTabId) return;
        chrome.tabs.sendMessage(targetTabId, request, () => {
            void chrome.runtime.lastError;
        });
    });
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
    if (!applyTabId) throw new Error('Apply sekmesi bulunamadı.');

    const result = await sendTabMessage(applyTabId, {
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
            contentType: result.contentType,
            documentBase64: result.documentBase64
        }
    });
}

async function getExistingYoksisTab() {
    const tabs = await queryTabs({ url: '*://yoksis.yok.gov.tr/*' });
    const yoksisTab = tabs[0];
    if (!yoksisTab) {
        throw new Error('YÖKSİS sekmesi açık değil. Önce YÖKSİS sekmesini açın.');
    }

    yoksisTabId = yoksisTab.id;
    await waitForContentScript(yoksisTabId, 'yoksis');
    return yoksisTab;
}

async function getActiveYoksisTab() {
    const tabs = await queryTabs({ url: '*://yoksis.yok.gov.tr/*' });
    let yoksisTab = tabs[0];
    if (!yoksisTab) yoksisTab = await createTab({ url: YOKSIS_URL, active: true });

    yoksisTabId = yoksisTab.id;
    await waitForContentScript(yoksisTabId, 'yoksis');
    await updateTab(yoksisTabId, { active: true });
    return yoksisTab;
}

async function executeYoksisSearchInMainWorld(tabId, kabulId) {
    if (!chrome.scripting || !chrome.scripting.executeScript) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (code) => {
                try {
                    function norm(s) {
                        return (s || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
                    }
                    var inputs = document.querySelectorAll('input');
                    var inp = null;
                    for (var i = 0; i < inputs.length; i++) {
                        var ph = norm(inputs[i].getAttribute('placeholder') || '');
                        var title = norm(inputs[i].getAttribute('title') || '');
                        if (ph.indexOf('kabul') !== -1 || title.indexOf('kabul') !== -1) {
                            inp = inputs[i];
                            break;
                        }
                    }
                    if (!inp) {
                        var labels = document.querySelectorAll('span, td, div, label');
                        for (var j = 0; j < labels.length; j++) {
                            if (norm(labels[j].innerText || labels[j].textContent).indexOf('kabulmektupid') !== -1) {
                                var row = labels[j].closest('tr');
                                if (row) {
                                    var rInp = row.querySelector('input');
                                    if (rInp) { inp = rInp; break; }
                                }
                            }
                        }
                    }
                    if (inp) {
                        inp.focus();
                        inp.value = code;
                        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                        inp.blur();
                        if (window.zk && window.zk.Widget) {
                            var wi = window.zk.Widget.$(inp);
                            if (wi) {
                                if (typeof wi.setValue === 'function') wi.setValue(code);
                                wi.fire('onChange', { value: code }, { toServer: true });
                            }
                        }
                    }

                    var buttons = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
                    var btn = null;
                    for (var k = 0; k < buttons.length; k++) {
                        var bt = norm(buttons[k].innerText || buttons[k].textContent || buttons[k].value || '');
                        if (bt.indexOf('kabul') !== -1 && (bt.indexOf('ara') !== -1 || bt.indexOf('sorgula') !== -1)) {
                            btn = buttons[k];
                            break;
                        }
                    }
                    if (btn) {
                        ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(function(evt) {
                            btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                        });
                        btn.click();
                        if (window.zk && window.zk.Widget) {
                            var wb = window.zk.Widget.$(btn);
                            if (wb) wb.fire('onClick', null, { toServer: true });
                        }
                        if (window.zAu && window.zk && window.zk.Widget) {
                            var wb2 = window.zk.Widget.$(btn);
                            if (wb2) window.zAu.send(new window.zk.Event(wb2, 'onClick', null, { toServer: true }));
                        }
                    }
                } catch (e) {
                    console.error('[YKN MAIN World Search Error]', e);
                }
            },
            args: [kabulId]
        });
    } catch (err) {
        console.warn('executeYoksisSearchInMainWorld error:', err);
    }
}

async function syncYoksisFormInMainWorld(tabId) {
    if (!chrome.scripting || !chrome.scripting.executeScript) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                try {
                    var inputs = document.querySelectorAll('input, select, textarea');
                    for (var i = 0; i < inputs.length; i++) {
                        var el = inputs[i];
                        if (el.type === 'button' || el.type === 'submit' || el.type === 'reset' || el.type === 'hidden') continue;
                        var val = el.value;
                        if (val === undefined || val === null || val === '') continue;

                        try {
                            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                            el.focus();
                            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                            el.dispatchEvent(new Event('blur', { bubbles: true }));
                            el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                            el.blur();
                        } catch (_) {}

                        if (window.zk && window.zk.Widget) {
                            var w = window.zk.Widget.$(el);
                            if (w) {
                                if (typeof w.setValue === 'function') {
                                    w.setValue(val);
                                }
                                w._value = val;
                                if (typeof w.doBlur_ === 'function') {
                                    try { w.doBlur_(new window.zk.Event(w, 'onBlur')); } catch (_) {}
                                }
                                if (typeof w.fire === 'function') {
                                    w.fire('onChange', { value: val }, { toServer: true });
                                }
                                if (window.zAu && typeof window.zAu.send === 'function') {
                                    window.zAu.send(new window.zk.Event(w, 'onChange', { value: val }, { toServer: true }));
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('[YKN MAIN World Form Sync Error]', e);
                }
            }
        });
    } catch (err) {
        console.warn('syncYoksisFormInMainWorld error:', err);
    }
}

async function transferToYoksis(request) {
    const yoksisTab = await getExistingYoksisTab();
    const response = await sendTabMessage(yoksisTab.id, {
        action: 'searchWithId',
        kabulId: request.data.yoksisId,
        requestId: request.requestId
    });
    // ZK Framework main-world desteği için ek tetikleyici
    executeYoksisSearchInMainWorld(yoksisTab.id, request.data.yoksisId).catch(() => {});
    if (!response?.success) throw new Error(response?.message || 'YÖKSİS araması başlatılamadı.');
    return response;
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
            (async () => {
                const yoksisTab = await getActiveYoksisTab();
                chrome.storage.local.set({ studentData }, () => {
                    const storageError = chrome.runtime.lastError;
                    if (storageError) {
                        sendResponse({ success: false, requestId: request.requestId, error: storageError.message });
                        return;
                    }
                    chrome.tabs.sendMessage(yoksisTab.id, {
                        action: 'fillRemainingData',
                        data: studentData
                    }, (response) => {
                        const error = chrome.runtime.lastError;
                        if (error) {
                            sendResponse({ success: false, requestId: request.requestId, error: error.message });
                            return;
                        }
                        syncYoksisFormInMainWorld(yoksisTab.id).catch(() => {});
                        sendResponse({ ...response, requestId: request.requestId });
                        chrome.storage.local.remove('studentData');
                    });
                });
            })().catch((error) => {
                sendResponse({ success: false, requestId: request.requestId, error: error.message });
            });
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
