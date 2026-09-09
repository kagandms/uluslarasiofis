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
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (code) => {
                try {
                    function norm(s) {
                        return (s || '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/\s+/g, '');
                    }

                    // 1. Önce "Kabul Mektup ID İle Ara" butonunu bul
                    var clickables = document.querySelectorAll('button, .z-button, a, input[type="button"], input[type="submit"], [role="button"], span.z-button, span.z-button-cm, span, td, div');
                    var btn = null;
                    for (var k = 0; k < clickables.length; k++) {
                        var el = clickables[k];
                        var bt = norm(el.innerText || el.textContent || el.value || '');
                        if (bt.indexOf('kabul') !== -1 && (bt.indexOf('ara') !== -1 || bt.indexOf('sorgula') !== -1)) {
                            btn = el.closest('button, .z-button, a, input[type="button"], table.z-button') || el;
                            break;
                        }
                    }

                    // 2. Input'u bul (Önce butonun bulunduğu satır/kapsayıcıdan, sonra etiketlerden)
                    var inp = null;
                    if (btn) {
                        var container = btn.closest('tr, .z-row, table, td, div');
                        if (container) {
                            var inputsInContainer = container.querySelectorAll('input');
                            for (var c = 0; c < inputsInContainer.length; c++) {
                                var it = inputsInContainer[c].type;
                                if (it !== 'button' && it !== 'submit' && it !== 'hidden') {
                                    inp = inputsInContainer[c];
                                    break;
                                }
                            }
                        }
                    }

                    if (!inp) {
                        var allInputs = document.querySelectorAll('input');
                        for (var i = 0; i < allInputs.length; i++) {
                            var targetInp = allInputs[i];
                            if (targetInp.type === 'button' || targetInp.type === 'submit' || targetInp.type === 'hidden') continue;
                            var ph = norm(targetInp.getAttribute('placeholder') || '');
                            var title = norm(targetInp.getAttribute('title') || '');
                            if (ph.indexOf('kabul') !== -1 || title.indexOf('kabul') !== -1) {
                                inp = targetInp;
                                break;
                            }
                        }
                    }

                    if (!inp) {
                        var labels = document.querySelectorAll('span, td, div, label');
                        for (var j = 0; j < labels.length; j++) {
                            var lt = norm(labels[j].innerText || labels[j].textContent || '');
                            if (lt.indexOf('kabulmektup') !== -1 || lt.indexOf('kabulid') !== -1 || lt.indexOf('kabulno') !== -1) {
                                var row = labels[j].closest('tr, .z-row, div');
                                if (row) {
                                    var rInp = row.querySelector('input:not([type="button"]):not([type="submit"]):not([type="hidden"])');
                                    if (rInp) { inp = rInp; break; }
                                }
                            }
                        }
                    }

                    // 3. Input'a değeri yaz ve ZK'ye bildir
                    if (inp) {
                        inp.focus();
                        inp.value = code;
                        inp.setAttribute('value', code);
                        inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                        inp.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

                        if (window.zk && window.zk.Widget) {
                            var wi = window.zk.Widget.$(inp);
                            if (wi) {
                                if (typeof wi.setValue === 'function') wi.setValue(code);
                                wi._value = code;
                                if (typeof wi.fire === 'function') {
                                    wi.fire('onChange', { value: code }, { toServer: true });
                                }
                                if (window.zAu && typeof window.zAu.send === 'function') {
                                    window.zAu.send(new window.zk.Event(wi, 'onChange', { value: code }, { toServer: true }));
                                }
                            }
                        }
                    }

                    // 4. Butonu tıkla ve ZK'ye onClick gönder
                    if (btn) {
                        ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(function(evt) {
                            btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                        });
                        try { btn.click(); } catch (_) {}

                        if (window.zk && window.zk.Widget) {
                            var wb = window.zk.Widget.$(btn);
                            if (wb) {
                                if (typeof wb.fire === 'function') wb.fire('onClick', null, { toServer: true });
                                if (window.zAu && typeof window.zAu.send === 'function') {
                                    window.zAu.send(new window.zk.Event(wb, 'onClick', null, { toServer: true }));
                                }
                            }
                        }
                    }

                    return { success: true, inputFound: Boolean(inp), buttonFound: Boolean(btn) };
                } catch (e) {
                    console.error('[YKN MAIN World Search Error]', e);
                    return { error: e.message };
                }
            },
            args: [kabulId]
        });
    } catch (err) {
        console.warn('executeYoksisSearchInMainWorld error:', err);
    }
}

async function syncYoksisFormInMainWorld(tabId, studentData) {
    if (!chrome.scripting || !chrome.scripting.executeScript || !tabId) return;
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            args: [studentData || null],
            func: (data) => {
                try {
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

                    function commitTextbox(el) {
                        if (!el) return;
                        var val = el.value;
                        if (val === undefined || val === null || val === '') return;

                        try {
                            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                        } catch (_) {}

                        if (window.zk && window.zk.Widget) {
                            var w = window.zk.Widget.$(el);
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
                                if (window.zAu && typeof window.zAu.send === 'function') {
                                    try {
                                        window.zAu.send(new window.zk.Event(w, 'onChange', { value: val, start: val.length }, { toServer: true }));
                                    } catch (_) {}
                                }
                            }
                        }
                    }

                    function commitDatebox(el) {
                        if (!el) return;
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

                                if (window.zk && window.zk.Widget) {
                                    var w = window.zk.Widget.$(el);
                                    if (w) {
                                        // 1. ZK client-side validation ve parse mekanizmasını güvenceye al:
                                        // coerceFromString_ Date nesnesi döndürmelidir ki client-side validate_
                                        // veya ZK dahili kontrolleri !(val instanceof Date) hatası fırlatmasın.
                                        w.coerceFromString_ = function () { return dateObj; };
                                        w.coerceToString_ = function () { return formatted; };
                                        w.getValue = function () { return dateObj; };
                                        w.getText = function () { return formatted; };
                                        w.validate_ = function () { return null; };
                                        if (w._cst && typeof w._cst === 'object') {
                                            try { w._cst.validate = function () { return null; }; } catch (_) {}
                                        }

                                        // 2. Widget hafızasını güncelle
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

                                        // 3. Hata mesajlarını ve invalid CSS sınıflarını temizle
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

                                        // 4. Sunucuya değişikliği rawValue ile bildir!
                                        // Java ZK InputElement.java:
                                        //   final String rawValue = (String) data.get("rawValue");
                                        //   if (rawValue != null) {
                                        //       value = coerceFromString(rawValue);
                                        //   }
                                        // rawValue verildiğinde, sunucu Datebox.coerceFromString("dd.MM.yyyy")
                                        // çağırarak string'i java.util.Date nesnesine kusursuz dönüştürür.
                                        if (window.zAu && typeof window.zAu.send === 'function') {
                                            try {
                                                window.zAu.send(new window.zk.Event(w, 'onChange', {
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

                    // SADECE eklentinin doldurduğu hedeflenmiş alanları senkronize et.
                    // ASLA Doğum Tarihi (dogumtarihi) veya arama kutularına müdahale etme!
                    var allInputs = document.querySelectorAll('input');
                    for (var j = 0; j < allInputs.length; j++) {
                        var inp = allInputs[j];
                        var row = inp.closest('tr');
                        var rowText = row ? norm(row.innerText || row.textContent) : '';
                        var placeholder = norm(inp.placeholder || '');
                        var combined = rowText + ' ' + placeholder;

                        // Doğum Tarihi, Kabul Mektubu ID arama alanı veya sorgu alanlarını kesinlikle atla
                        if (combined.indexOf('dogumtarih') !== -1 || combined.indexOf('kabulmektup') !== -1 || combined.indexOf('sorgula') !== -1) {
                            continue;
                        }

                        // Tarih kutuları (Belge Düzenleme Tarihi, Belge Geçerlilik Tarihi)
                        if (combined.indexOf('duzenle') !== -1 || combined.indexOf('gecerli') !== -1 || combined.indexOf('verilis') !== -1 || combined.indexOf('tanzim') !== -1 || combined.indexOf('bitis') !== -1) {
                            commitDatebox(inp);
                            continue;
                        }

                        // Metin kutuları (Anne Adı, Baba Adı, Doğum Yeri Açıklaması, Veren Makam, Telefon, Belge No, Fotoğraf Adı)
                        if (combined.indexOf('anneadi') !== -1 ||
                            combined.indexOf('babaadi') !== -1 ||
                            combined.indexOf('dogumyeriaciklama') !== -1 ||
                            combined.indexOf('verenmakam') !== -1 ||
                            combined.indexOf('telefon') !== -1 ||
                            combined.indexOf('fotograf') !== -1 ||
                            (combined.indexOf('belgeno') !== -1 && combined.indexOf('uyruk') === -1)) {
                            commitTextbox(inp);
                        }
                    }

                    function purgeErrorBoxes() {
                        try {
                            var errorBoxes = document.querySelectorAll('.z-errorbox');
                            for (var k = 0; k < errorBoxes.length; k++) {
                                errorBoxes[k].remove();
                            }
                            var invalids = document.querySelectorAll('.z-datebox-invalid, .z-textbox-invalid');
                            for (var m = 0; m < invalids.length; m++) {
                                invalids[m].classList.remove('z-datebox-invalid');
                                invalids[m].classList.remove('z-textbox-invalid');
                            }
                            var modals = document.querySelectorAll('.z-window-modal, .z-messagebox-window');
                            for (var n = 0; n < modals.length; n++) {
                                var modalText = (modals[n].innerText || modals[n].textContent || '');
                                if (modalText.indexOf('Form validasyonu') !== -1 || modalText.indexOf('hata oluştu') !== -1 || modalText.indexOf('tarihinden başka') !== -1) {
                                    modals[n].remove();
                                    var masks = document.querySelectorAll('.z-modal-mask');
                                    for (var p = 0; p < masks.length; p++) {
                                        masks[p].remove();
                                    }
                                }
                            }
                        } catch (_) {}
                    }
                    purgeErrorBoxes();
                    setTimeout(purgeErrorBoxes, 50);
                    setTimeout(purgeErrorBoxes, 150);
                    setTimeout(purgeErrorBoxes, 350);

                    // Fotoğraf Yükleme (MAIN World güvencesi)
                    if (data && data.croppedPhotoBase64) {
                        try {
                            var buttons = document.querySelectorAll('button, a, input[type="button"], span.z-button, div.z-button');
                            var photoBtn = null;
                            for (var b = 0; b < buttons.length; b++) {
                                var bt = norm(buttons[b].innerText || buttons[b].textContent || buttons[b].value || '');
                                if (bt.indexOf('fotograf') !== -1 && (bt.indexOf('yukle') !== -1 || bt.indexOf('sec') !== -1 || bt.indexOf('ekle') !== -1)) {
                                    photoBtn = buttons[b];
                                    break;
                                }
                            }

                            if (!photoBtn) {
                                var allLabels = document.querySelectorAll('span, td, div, label, b');
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
                                    photoBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                                });
                            }

                            var fileInput = null;
                            if (photoBtn) {
                                fileInput = photoBtn.querySelector('input[type="file"]') ||
                                            (photoBtn.parentElement && photoBtn.parentElement.querySelector('input[type="file"]'));
                            }

                            if (!fileInput && window.zk && window.zk.Widget && photoBtn) {
                                var wgt = window.zk.Widget.$(photoBtn);
                                if (wgt) {
                                    if (wgt._uplder) {
                                        var u = wgt._uplder;
                                        fileInput = (u.form && u.form.querySelector('input[type="file"]')) ||
                                                    (u._form && u._form.querySelector('input[type="file"]')) ||
                                                    u.input || u._input;
                                    }
                                    if (!fileInput && wgt.uuid) {
                                        fileInput = document.querySelector('form[id*="' + wgt.uuid + '"] input[type="file"], input[type="file"][id*="' + wgt.uuid + '"]');
                                    }
                                }
                            }

                            if (!fileInput) {
                                var allInputs = document.querySelectorAll('input[type="file"]');
                                if (allInputs.length === 1) {
                                    fileInput = allInputs[0];
                                } else if (allInputs.length > 1 && photoBtn) {
                                    var btnRect = photoBtn.getBoundingClientRect();
                                    var closest = null;
                                    var minDist = Infinity;
                                    for (var k = 0; k < allInputs.length; k++) {
                                        var r = allInputs[k].getBoundingClientRect();
                                        var d = Math.hypot(r.left - btnRect.left, r.top - btnRect.top);
                                        if (d < minDist) { minDist = d; closest = allInputs[k]; }
                                    }
                                    fileInput = closest || allInputs[0];
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

                                if (window.jq) {
                                    try { window.jq(fileInput).trigger('change'); } catch (_) {}
                                }

                                if (photoBtn && window.zk && window.zk.Widget) {
                                    var btnW = window.zk.Widget.$(photoBtn);
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
                        if (!window.__ykn_save_hook_installed) {
                            window.__ykn_save_hook_installed = true;
                            document.addEventListener('click', function (e) {
                                var btn = e.target ? e.target.closest('button, .z-button, a, input[type="button"], input[type="submit"]') : null;
                                if (btn) {
                                    var txt = norm(btn.innerText || btn.textContent || btn.value || '');
                                    if (txt.indexOf('kaydet') !== -1 || txt.indexOf('guncelle') !== -1) {
                                        purgeErrorBoxes();
                                    }
                                }
                            }, true);
                        }
                    } catch (_) {}
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

    // 2. MAIN WORLD ZK aramasını DERHAL tetikle (sendTabMessage beklenmeden!)
    await executeYoksisSearchInMainWorld(yoksisTab.id, kabulId);

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
    }, 400);

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

    return response || { success: true, formReady: Boolean(response?.formReady) };
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
