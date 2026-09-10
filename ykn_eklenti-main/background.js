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
        setTimeout(() => yoksisOperationResults.delete(key), 60_000);
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
            const file = pageKind === 'bridge' ? 'bridge.js' : 'content.js';
            await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
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

async function getExistingYoksisTab() {
    const tabs = await queryTabs({ url: ['*://yoksis.yok.gov.tr/*', '*://*.yok.gov.tr/*'] });
    if (!tabs || tabs.length === 0) {
        throw new Error('YÖKSİS sekmesi açık değil. Lütfen önce YÖKSİS sekmesini açın.');
    }

    // Aktif / odaklı olan YÖKSİS sekmesini öncelikle tercih et
    const yoksisTab = tabs.find(t => t.active) || tabs[0];
    yoksisTabId = yoksisTab.id;
    // Eklenti güncellendikten sonra açık sekmede eski content-script kalabilir.
    // Önce yeni bağlamı doğrula; gerekirse waitForContentScript yeniden enjekte eder.
    await waitForContentScript(yoksisTabId, 'yoksis');
    return yoksisTab;
}

async function getActiveYoksisTab() {
    const tabs = await queryTabs({ url: ['*://yoksis.yok.gov.tr/*', '*://*.yok.gov.tr/*'] });
    let yoksisTab = tabs.find(t => t.active) || tabs[0];
    if (!yoksisTab) yoksisTab = await createTab({ url: YOKSIS_URL, active: true });

    yoksisTabId = yoksisTab.id;
    await updateTab(yoksisTabId, { active: true });
    if (yoksisTab.windowId) {
        await chrome.windows.update(yoksisTab.windowId, { focused: true }).catch(() => {});
    }
    await waitForContentScript(yoksisTabId, 'yoksis');
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

                    function fillRadioByValue(docs, value, result, resultLabel) {
                        if (value === undefined || value === null || String(value).trim() === '') return;
                        var radio = findRadioByText(docs, value);
                        if (radio) {
                            try { radio.click(); } catch (_) { radio.checked = true; }
                            try { radio.checked = true; } catch (_) {}
                            commitRadio(radio, radio.ownerDocument && radio.ownerDocument.defaultView || window);
                        }
                        addResultField(result, resultLabel, Boolean(radio && radio.checked));
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
                        photoUploaded: false
                    };

                    // Content script izole dünyada DOM'a değer yazabilir ancak
                    // YÖKSİS/ZK bunu sunucu durumuna almayabilir. Bu prepass,
                    // değerleri doğrudan sayfanın gerçek JS dünyasında yazar.
                    if (data) {
                        var passportNo = data.pasaportNo || data.passportNo || '';
                        var birthPlace = data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || '';
                        var issuingAuthority = data.verenMakam || data.issuingAuthority || '';
                        var birthCountry = data.dogumUlkesi || data.uyruk || '';

                        fillTextByLabels(allDocs, ['Anne Adı', 'Mother Name', "Mother's Name"], data.anneAdi, fillResult, 'Anne Adı', false);
                        fillTextByLabels(allDocs, ['Baba Adı', 'Father Name', "Father's Name"], data.babaAdi, fillResult, 'Baba Adı', false);
                        fillSelectByLabels(allDocs, ['Uyruğu', 'Nationality'], data.uyruk, fillResult, 'Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Uyruğu', 'Birth Nationality'], data.uyruk, fillResult, 'Doğum Uyruğu');
                        fillSelectByLabels(allDocs, ['Doğum Yeri Ülkesi', 'Birth Country', 'Born Country'], birthCountry, fillResult, 'Doğum Yeri Ülkesi');
                        fillSelectByLabels(allDocs, ['Belgeyi Veren Ülke', 'Document Issuing Country'], data.uyruk, fillResult, 'Belgeyi Veren Ülke');
                        fillRadioByValue(allDocs, data.cinsiyet, fillResult, 'Cinsiyet');
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

async function searchYoksisFromContent(tabId, kabulId, requestId) {
    try {
        await waitForContentScript(tabId, 'yoksis');
        return await withTimeout(
            sendTabMessage(tabId, {
                action: 'searchWithId',
                kabulId,
                requestId
            }),
            12_000,
            'YÖKSİS arama zaman aşımı'
        );
    } catch (error) {
        console.warn('[YKN] Content-script YÖKSİS araması başarısız:', error);
        return null;
    }
}

async function waitForYoksisFormReady(tabId, requestId) {
    try {
        await waitForContentScript(tabId, 'yoksis');
        const readiness = await withTimeout(
            sendTabMessage(tabId, {
                action: 'WAIT_YOKSIS_FORM',
                timeoutMs: 10000,
                requestId
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
    const yoksisTab = await getExistingYoksisTab();
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
        let response = await searchYoksisFromContent(yoksisTab.id, kabulId, request.requestId);
        let mainTriggered = false;
        // Content-script eski sürümde yalnızca inputu bulup Enter'a basabiliyor
        // veya butonun ZK görsel parçasını kaçırabiliyor. Buton doğrulanmadıysa
        // MAIN-world taramasını kontrollü tek bir fallback olarak kullan.
        if (response?.searchTriggered !== true || response?.buttonFound !== true) {
            const mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
            mainTriggered = Boolean(mainResults?.some(r => r.result?.searchTriggered === true));
        }

        const searchTriggered = response?.searchTriggered === true || response?.success === true || mainTriggered;
        if (!searchTriggered) {
            throw new Error('YÖKSİS kabul mektubu araması başlatılamadı. Öğrenci başvuru/kayıt ekranını açık tutup tekrar deneyin.');
        }

        const formReady = Boolean(response?.formReady)
            || await waitForYoksisFormReady(yoksisTab.id, request.requestId);
        if (!formReady) {
            throw new Error('Kabul kodu gönderildi ancak YÖKSİS öğrenci formu zamanında açılmadı. Aynı aramayı otomatik olarak tekrar göndermeden işlem durduruldu.');
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
    if (request.action === 'SYNC_YOKSIS_MAIN_WORLD') {
        // Eski popup sürümleri content-script doldurmasından sonra aynı veriyi
        // MAIN world'de yeniden yazıyordu. Bu işlem artık FILL_YOKSIS_FORM
        // kuyruğunun parçasıdır; bağımsız çağrıyı güvenle no-op yapıyoruz.
        sendResponse({ success: true, skipped: true, message: 'YÖKSİS formu zaten kontrollü aktarım akışında işlenir.' });
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
            (async () => {
                const yoksisTab = await getActiveYoksisTab();
                const response = await runYoksisOperation(yoksisTab.id, 'fill', request.requestId, async () => {
                    await new Promise((resolve, reject) => {
                        chrome.storage.local.set({ studentData }, () => {
                            const storageError = chrome.runtime.lastError;
                            if (storageError) reject(new Error(storageError.message));
                            else resolve();
                        });
                    });

                    // Doldurma, arama postback'i tamamen bitmeden başlayamaz.
                    // Önce formun kararlı olduğunu doğrula; aksi halde eksik
                    // alanları ikinci/üçüncü yazımla telafi etmeye çalışma.
                    const formReady = await waitForYoksisFormReady(yoksisTab.id, request.requestId);
                    if (!formReady) {
                        throw new Error('YÖKSİS öğrenci formu hazır değil; aktarım başlatılmadı.');
                    }

                    const mainResponse = await syncYoksisFormInMainWorld(yoksisTab.id, studentData);
                    const needsFallback = !mainResponse?.success
                        || (studentData?.croppedPhotoBase64 && mainResponse.photoUploaded !== true)
                        || (mainResponse.missingFields || []).length > 0;

                    if (!needsFallback) {
                        return { ...mainResponse, mainWorldSynced: true, partial: false };
                    }

                    // Fallback yalnızca ilk denemenin eksik bıraktığı durumda
                    // bir kez çalışır. Sonrasında MAIN world'e yeniden yazmak
                    // eski kodda alanları ve fotoğraf yüklemesini çoğaltıyordu.
                    let contentResponse;
                    try {
                        contentResponse = await sendTabMessage(yoksisTab.id, {
                            action: 'fillRemainingData',
                            data: studentData,
                            requestId: request.requestId
                        });
                    } catch (contentError) {
                        return {
                            ...mainResponse,
                            partial: true,
                            error: contentError.message || mainResponse?.error
                        };
                    }

                    return {
                        ...contentResponse,
                        mainWorldSynced: Boolean(mainResponse?.success),
                        partial: Boolean(contentResponse?.partial || (contentResponse?.missingFields || []).length > 0)
                    };
                });
                sendResponse({ ...response, requestId: request.requestId });
            })().catch((error) => {
                sendResponse({ success: false, requestId: request.requestId, error: error.message });
            });
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
