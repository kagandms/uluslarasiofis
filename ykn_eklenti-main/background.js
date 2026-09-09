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
    ensureContentScriptInjected(yoksisTabId, 'yoksis').catch(() => {});
    return yoksisTab;
}

async function getActiveYoksisTab() {
    const tabs = await queryTabs({ url: ['*://yoksis.yok.gov.tr/*', '*://*.yok.gov.tr/*'] });
    let yoksisTab = tabs.find(t => t.active) || tabs[0];
    if (!yoksisTab) yoksisTab = await createTab({ url: YOKSIS_URL, active: true });

    yoksisTabId = yoksisTab.id;
    ensureContentScriptInjected(yoksisTabId, 'yoksis').catch(() => {});
    await updateTab(yoksisTabId, { active: true });
    return yoksisTab;
}

async function executeYoksisSearchInMainWorld(tabId, kabulId) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return null;
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
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
                        const allClickables = doc.querySelectorAll('button, .z-button, a, input[type="button"], input[type="submit"], [role="button"], span.z-button, table.z-button, span.z-button-cm');
                        for (let i = 0; i < allClickables.length; i++) {
                            const c = allClickables[i];
                            const cTxt = norm(c.innerText || c.textContent || c.value || '');
                            if (cTxt.includes('kabul') && (cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || cTxt.includes('bul'))) {
                                dBtn = c.closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || c;
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
                                            const bBtns = box.querySelectorAll('button, .z-button, a, input[type="button"], table.z-button, span.z-button');
                                            if (bBtns.length > 0) {
                                                for (let j = 0; j < bBtns.length; j++) {
                                                    const bTxt = norm(bBtns[j].innerText || bBtns[j].textContent || bBtns[j].value || '');
                                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                                        dBtn = bBtns[j].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || bBtns[j];
                                                        break;
                                                    }
                                                }
                                                if (!dBtn) dBtn = bBtns[0].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || bBtns[0];
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
                                const btns = parent.querySelectorAll('button, .z-button, a, input[type="button"], table.z-button, span.z-button');
                                for (let k = 0; k < btns.length; k++) {
                                    const bTxt = norm(btns[k].innerText || btns[k].textContent || btns[k].value || '');
                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                        dBtn = btns[k].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || btns[k];
                                        break;
                                    }
                                }
                                if (dBtn) break;
                                if (btns.length > 0) {
                                    dBtn = btns[0].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || btns[0];
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

                    // 5. Input'a değeri yaz ve tüm olayları tetikle
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
                        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                        if (targetWin.zk && targetWin.zk.Widget) {
                            const wi = targetWin.zk.Widget.$(inp);
                            if (wi) {
                                if (typeof wi.setValue === 'function') wi.setValue(code);
                                wi._value = code;
                                wi._lastValue = code;
                                if (typeof wi.fire === 'function') {
                                    wi.fire('onChange', { value: code }, { toServer: true });
                                }
                            }
                        }
                        if (targetWin.zAu && typeof targetWin.zAu.send === 'function' && targetWin.zk?.Widget) {
                            const wi = targetWin.zk.Widget.$(inp);
                            if (wi) {
                                try { targetWin.zAu.send(new targetWin.zk.Event(wi, 'onChange', { value: code }, { toServer: true })); } catch (_) {}
                            }
                        }

                        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                        try { inp.blur(); } catch (_) {}
                    }

                    // ZK'nin onChange'i işlemesi için kısa bekleme
                    await new Promise(r => setTimeout(r, 150));

                    // 6. Butonu tıkla ve ZK onClick olayını gönder
                    if (btn) {
                        btn.focus();
                        ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(function(evt) {
                            btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: targetWin }));
                        });
                        try { btn.click(); } catch (_) {}

                        if (targetWin.zk && targetWin.zk.Widget) {
                            let wb = targetWin.zk.Widget.$(btn);
                            if (!wb) {
                                let parentEl = btn.parentElement;
                                while (parentEl && parentEl !== doc?.body && !wb) {
                                    wb = targetWin.zk.Widget.$(parentEl);
                                    parentEl = parentEl.parentElement;
                                }
                            }
                            if (wb && typeof wb.fire === 'function') {
                                wb.fire('onClick', null, { toServer: true });
                            }
                        }
                        if (targetWin.zAu && typeof targetWin.zAu.send === 'function' && targetWin.zk?.Widget) {
                            let wb = targetWin.zk.Widget.$(btn);
                            if (wb) {
                                try { targetWin.zAu.send(new targetWin.zk.Event(wb, 'onClick', null, { toServer: true })); } catch (_) {}
                            }
                        }
                    }

                    if (inp) {
                        // Buton bulunsa da bulunmasa da ek güvence: Enter ve onOK
                        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: targetWin }));
                        if (targetWin.zk && targetWin.zk.Widget) {
                            const wi = targetWin.zk.Widget.$(inp);
                            if (wi && typeof wi.fire === 'function') {
                                try { wi.fire('onOK', null, { toServer: true }); } catch (_) {}
                            }
                        }
                    }

                    return { success: Boolean(inp), inputFound: Boolean(inp), buttonFound: Boolean(btn) };
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
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
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

                        try {
                            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                        } catch (_) {}

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
                                if (typeof w.fire === 'function') {
                                    try { w.fire('onChange', { value: val, start: val.length }, { toServer: true }); } catch (_) {}
                                }
                                if (wWin.zAu && typeof wWin.zAu.send === 'function') {
                                    try {
                                        wWin.zAu.send(new wWin.zk.Event(w, 'onChange', { value: val, start: val.length }, { toServer: true }));
                                    } catch (_) {}
                                }
                            }
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

                            if (y >= 2010 && y <= 2045 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
                                var formatted = ('0' + d).slice(-2) + '.' + ('0' + m).slice(-2) + '.' + y;
                                el.value = formatted;
                                var dateObj = new Date(y, m - 1, d, 0, 0, 0, 0);

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
                                            } catch (_) {}
                                        }
                                    }
                                }

                                try {
                                    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                                } catch (_) {}
                            }
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

                        purgeErrorBoxes(doc);

                        // Fotoğraf Yükleme (MAIN World güvencesi)
                        if (data && data.croppedPhotoBase64) {
                            try {
                                var buttons = doc.querySelectorAll('button, a, input[type="button"], span.z-button, div.z-button');
                                var photoBtn = null;
                                for (var b = 0; b < buttons.length; b++) {
                                    var bt = norm(buttons[b].innerText || buttons[b].textContent || buttons[b].value || '');
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
                                if (photoBtn) {
                                    fileInput = photoBtn.querySelector('input[type="file"]') ||
                                                (photoBtn.parentElement && photoBtn.parentElement.querySelector('input[type="file"]'));
                                }

                                if (!fileInput && win.zk && win.zk.Widget && photoBtn) {
                                    var wgt = win.zk.Widget.$(photoBtn);
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
                                    var photoFile = new File([u8arr], data.photoFileName || 'ogrenci_foto.jpg', { type: mime, lastModified: Date.now() });
                                    var dt = new DataTransfer();
                                    dt.items.add(photoFile);
                                    fileInput.files = dt.files;

                                    fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                                    fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

                                    if (win.jq) {
                                        try { win.jq(fileInput).trigger('change'); } catch (_) {}
                                    }

                                    if (photoBtn && win.zk && win.zk.Widget) {
                                        var btnW = win.zk.Widget.$(photoBtn);
                                        if (btnW && btnW._uplder) {
                                            var uplder = btnW._uplder;
                                            ['start', '_start', 'upload', '_upload', 'send', 'submit'].forEach(function(fn) {
                                                if (typeof uplder[fn] === 'function') {
                                                    try { uplder[fn](); } catch (_) {}
                                                }
                                            });
                                        }
                                    }
                                    console.log('[YKN MAIN World] Fotoğraf başarıyla yüklendi:', data.photoFileName);
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
    const kabulId = (request.data?.yoksisId || request.data?.kabulId || request.kabulId || '').trim();
    if (!kabulId) throw new Error('Kabul Mektup ID bulunamadı.');

    await new Promise((resolve) => {
        chrome.storage.local.set({ studentData: request.data }, resolve);
    });

    // 1. Önce YÖKSİS sekmesini aktif yap ve pencereyi öne getir
    await updateTab(yoksisTab.id, { active: true });
    if (yoksisTab.windowId) {
        try {
            await chrome.windows.update(yoksisTab.windowId, { focused: true });
        } catch (_) {}
    }

    // 2. MAIN WORLD ZK aramasını tüm framelerde çalıştır
    const mainResults = await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);
    const mainSuccess = mainResults && mainResults.some(r => r.result?.inputFound);

    // 3. Content script üzerinden de aramayı başlat (izole dünya ve DOM desteği)
    let response = null;
    try {
        response = await sendTabMessage(yoksisTab.id, {
            action: 'searchWithId',
            kabulId: kabulId,
            requestId: request.requestId
        });
    } catch (msgErr) {
        console.warn('[YKN] sendTabMessage searchWithId warning:', msgErr);
    }

    // 4. Teyit için kısa bir süre sonra MAIN WORLD aramasını bir kez daha tetikle
    setTimeout(() => {
        executeYoksisSearchInMainWorld(yoksisTab.id, kabulId).catch(() => {});
    }, 450);

    const isSuccess = Boolean(mainSuccess || response?.success);
    if (!isSuccess) {
        throw new Error('YÖKSİS sayfasında Kabul Mektup ID arama alanı bulunamadı. Lütfen YÖKSİS sekmesinde öğrenci başvuru/kayıt ekranının açık olduğundan emin olun.');
    }

    // Form açıldığında kalan bilgileri ve vesikalık fotoğrafı otomatik doldur ve yükle
    if (response?.formReady) {
        try {
            await new Promise((r) => setTimeout(r, 350));
            await sendTabMessage(yoksisTab.id, {
                action: 'fillRemainingData',
                data: request.data
            });
            await syncYoksisFormInMainWorld(yoksisTab.id, request.data);
        } catch (fillErr) {
            console.warn('[YKN] transferToYoksis auto-fill warning:', fillErr);
        }
    }

    return {
        success: true,
        transferred: true,
        formReady: Boolean(response?.formReady),
        message: 'Kabul mektup kodu YÖKSİS\'e başarıyla aktarıldı ve arama başlatıldı.'
    };
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
        (async () => {
            try {
                let targetId = (sender.tab ? sender.tab.id : null) || yoksisTabId;
                if (!targetId) {
                    const yoksisTab = await getActiveYoksisTab().catch(() => null);
                    targetId = yoksisTab?.id;
                }
                if (targetId) {
                    await syncYoksisFormInMainWorld(targetId);
                }
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
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
                        syncYoksisFormInMainWorld(yoksisTab.id, studentData).catch(() => {});
                        sendResponse({ ...response, requestId: request.requestId });
                    });
                });
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
            (async () => {
                const yoksisTab = await getExistingYoksisTab();
                if (yoksisTab) {
                    const data = request.data || (await new Promise(r => chrome.storage.local.get(['studentData'], res => r(res?.studentData))));
                    await syncYoksisFormInMainWorld(yoksisTab.id, data);
                }
            })().catch(() => {});
            return false;
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
