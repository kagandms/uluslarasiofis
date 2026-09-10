// content.js
(() => {
if (location.hostname === 'apply.topkapi.edu.tr' && window !== window.top) return;
if (window.__YKN_CONTENT_LOADED__) return;
window.__YKN_CONTENT_LOADED__ = true;

function getAllDocs(rootDoc = document) {
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

// ZK Framework için Event Dispatcher (Input'lar için)
function getPageKind() {
    if (location.hostname === 'apply.topkapi.edu.tr') return 'apply';
    if (location.hostname === 'yoksis.yok.gov.tr') return 'yoksis';
    return 'unknown';
}

function sendApplyEvent(action, requestId, payload = {}) {
    try {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) {
            console.warn('[YKN Content] chrome.runtime.sendMessage mevcut değil (Eklenti yeniden yüklenmiş veya bağlam geçersiz olabilir).');
            return;
        }
        chrome.runtime.sendMessage({
            source: 'APPLY_TOPKAPI',
            action,
            requestId,
            ...payload
        }, () => {
            if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
                // Eklenti arka planı kapalıysa veya yanıt beklenmiyorsa sessizce geç
            }
        });
    } catch (err) {
        console.warn('[YKN Content] sendApplyEvent hatası:', err);
    }
}

async function simulateInput(element, value) {
    if (!element || value === undefined || value === null) return false;
    const win = element.ownerDocument?.defaultView || window;
    
    try {
        element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } catch (_) {}

    // ZK odaklanmasını ve widget aktifleşmesini sağlamak için fare/focus simülasyonu
    try {
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: win }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
        element.focus();
        element.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
        element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: win }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
    } catch (_) {}

    await new Promise((r) => setTimeout(r, 25));

    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement?.prototype || window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(element, value);
    } else {
        element.value = value;
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, key: 'Enter', keyCode: 13, view: win }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: 'Enter', keyCode: 13, view: win }));
    
    if (win.zk && win.zk.Widget) {
        try {
            const w = win.zk.Widget.$(element);
            if (w) {
                if (typeof w.setValue === 'function') w.setValue(value);
                w._value = value;
                w._lastValue = value;
                if (typeof w.fire === 'function') {
                    w.fire('onChange', { value }, { toServer: true });
                }
            }
        } catch (_) {}
    }
    if (win.zAu && typeof win.zAu.send === 'function' && win.zk?.Widget) {
        try {
            const w = win.zk.Widget.$(element);
            if (w) {
                win.zAu.send(new win.zk.Event(w, 'onChange', { value }, { toServer: true }));
            }
        } catch (_) {}
    }

    await new Promise((r) => setTimeout(r, 25));

    // ZK Framework'ün değeri hafızaya alıp dirty/değişti olarak işaretlemesi için kritik olaylar
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    try { element.blur(); } catch (_) {}
    return true;
}

async function simulateDateboxInput(element, formattedDate) {
    if (!element || !formattedDate) return false;
    try {
        element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } catch (_) {}

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(element, formattedDate);
    } else {
        element.value = formattedDate;
    }

    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    element.classList.remove('z-datebox-invalid');
    const parentBox = element.closest('.z-datebox');
    if (parentBox) {
        parentBox.classList.remove('z-datebox-invalid');
    }
    return true;
}

// ZK Framework için Event Dispatcher (Select/Dropdown'lar için)
function simulateSelect(element, textToMatch) {
    if (!element || !textToMatch) return false;
    let found = false;
    const normalize = (str) => str.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
    const targetText = normalize(textToMatch);

    for (const option of element.options) {
        const optText = normalize(option.text);
        if (optText.includes(targetText) || targetText.includes(optText)) {
            element.value = option.value;
            found = true;
            break;
        }
    }
    if (found) {
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
    }
    return false;
}

// ZK Framework için Event Dispatcher (Radio Button'lar için)
function simulateRadioByLabelText(labelText) {
    if (!labelText) return false;
    const normalize = (str) => str.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
    const targetText = normalize(labelText);
    
    const labels = document.querySelectorAll('label');
    for (const lbl of labels) {
        if (normalize(lbl.innerText) === targetText) {
            const forId = lbl.getAttribute('for');
            if (forId) {
                const radio = document.getElementById(forId);
                if (radio) {
                    radio.click();
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
        }
    }
    return false;
}

// Kaynak Sistem - Etiket metni ile açılır liste okuyucu
function getSourceDropdownByLabel(substring) {
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
        if (label.innerText.toLocaleLowerCase('tr-TR').includes(substring.toLocaleLowerCase('tr-TR'))) {
            const container = label.parentElement;
            const select = container.querySelector('select');
            if (select && select.options.length > 0 && select.selectedIndex >= 0) {
                return select.options[select.selectedIndex].text;
            }
            const select2Span = container.querySelector('.select2-selection__rendered');
            if (select2Span) {
                return select2Span.innerText.trim();
            }
        }
    }
    return '';
}

// YÖKSİS: Kabul ID inputunu ve butonunu bul
function normalizeYoksisText(str) {
    return (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '');
}

function findYoksisKabulPair() {
    const allDocs = getAllDocs(document);
    for (const doc of allDocs) {
        let inp = null;
        let btn = null;

        // 1. ÖNCELİK: Placeholder / Title / Name / Id / Value üzerinden doğrudan Input bulma
        const allInputs = doc.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
        for (let i = 0; i < allInputs.length; i++) {
            const it = allInputs[i];
            const ph = normalizeYoksisText((it.placeholder || '') + ' ' + (it.getAttribute('placeholder') || '') + ' ' + (it.title || '') + ' ' + (it.name || '') + ' ' + (it.id || ''));
            if (ph.includes('kabul') && !ph.includes('pasaport') && !ph.includes('tc') && !ph.includes('dogum')) {
                inp = it;
                break;
            }
        }

        // 2. ÖNCELİK: Buton bulma ("Kabul Mektup Id İle Ara" veya içinde "kabul" geçen buton)
        const allClickables = doc.querySelectorAll('button, .z-button, a, input[type="button"], input[type="submit"], [role="button"], span.z-button, table.z-button, span.z-button-cm');
        for (let i = 0; i < allClickables.length; i++) {
            const c = allClickables[i];
            const cTxt = normalizeYoksisText(c.innerText || c.textContent || c.value || '');
            if (cTxt.includes('kabul') && (cTxt.includes('ara') || cTxt.includes('sorgula') || cTxt.includes('getir') || cTxt.includes('bul'))) {
                btn = c.closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || c;
                break;
            }
        }

        // 3. ÖNCELİK: Etiket ("Kabul Mektup Id" veya "Kabul Mektup ID ile Sorgula") üzerinden bulma
        if (!inp || !btn) {
            const textNodes = doc.querySelectorAll('span, td, div, label, b, strong, th, p, a, legend, caption, .z-caption, .z-groupbox-header');
            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                if (node.children.length > 3) continue;
                const txt = normalizeYoksisText(node.innerText || node.textContent || '');
                if (txt.includes('kabul') && (txt.includes('id') || txt.includes('sorgula') || txt.includes('mektup')) && !txt.includes('kabultarih')) {
                    const td = node.closest('td');
                    if (td && td.nextElementSibling && !inp) {
                        inp = td.nextElementSibling.querySelector('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
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

                    if (box) {
                        if (!inp) {
                            const bInps = box.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                            for (let j = 0; j < bInps.length; j++) {
                                const bPh = normalizeYoksisText((bInps[j].placeholder || '') + ' ' + (bInps[j].getAttribute('placeholder') || '') + ' ' + (bInps[j].id || '') + ' ' + (bInps[j].name || ''));
                                if (!bPh.includes('pasaport') && !bPh.includes('tc') && !bPh.includes('dogum')) {
                                    inp = bInps[j];
                                    break;
                                }
                            }
                            if (!inp && bInps.length > 0) inp = bInps[0];
                        }
                        if (!btn) {
                            const bBtns = box.querySelectorAll('button, .z-button, a, input[type="button"], table.z-button, span.z-button');
                            if (bBtns.length > 0) {
                                for (let j = 0; j < bBtns.length; j++) {
                                    const bTxt = normalizeYoksisText(bBtns[j].innerText || bBtns[j].textContent || bBtns[j].value || '');
                                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                                        btn = bBtns[j].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || bBtns[j];
                                        break;
                                    }
                                }
                                if (!btn) btn = bBtns[0].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || bBtns[0];
                            }
                        }
                    }
                    if (inp && btn) break;
                }
            }
        }

        // 4. Biri bulunup diğeri bulunamadıysa ebeveyn ağacında yukarı yürüyerek tamamla
        if (btn && !inp) {
            let parent = btn.parentElement;
            while (parent && parent !== doc.body) {
                const inps = parent.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
                for (let k = 0; k < inps.length; k++) {
                    const itPh = normalizeYoksisText(inps[k].placeholder || inps[k].getAttribute('placeholder') || inps[k].value || inps[k].id || '');
                    if (!itPh.includes('pasaport') && !itPh.includes('tc') && !itPh.includes('dogum')) {
                        inp = inps[k];
                        break;
                    }
                }
                if (inp) break;
                parent = parent.parentElement;
            }
        }

        if (inp && !btn) {
            let parent = inp.parentElement;
            while (parent && parent !== doc.body) {
                const btns = parent.querySelectorAll('button, .z-button, a, input[type="button"], table.z-button, span.z-button');
                for (let k = 0; k < btns.length; k++) {
                    const bTxt = normalizeYoksisText(btns[k].innerText || btns[k].textContent || btns[k].value || '');
                    if (bTxt.includes('ara') || bTxt.includes('kabul') || bTxt.includes('sorgula')) {
                        btn = btns[k].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || btns[k];
                        break;
                    }
                }
                if (btn) break;
                if (btns.length > 0) {
                    btn = btns[0].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || btns[0];
                    break;
                }
                parent = parent.parentElement;
            }
        }

        if (inp) {
            return { idInput: inp, searchBtn: btn, doc };
        }
    }

    return { idInput: null, searchBtn: null, doc: document };
}

function findKabulIdButton(idInput) {
    if (idInput) {
        const iRow = idInput.closest('tr, .z-row, table, .z-groupbox, div');
        if (iRow) {
            const rowBtns = iRow.querySelectorAll('button, .z-button, a, input[type="button"], span.z-button, table.z-button, span.z-button-cm');
            if (rowBtns.length > 0) {
                return rowBtns[0].closest('button, .z-button, a, input[type="button"], table.z-button, [role="button"]') || rowBtns[0];
            }
        }
    }
    return findYoksisKabulPair().searchBtn;
}

function findKabulIdInput() {
    return findYoksisKabulPair().idInput;
}

function simulateButtonClick(element) {
    if (!element) return false;
    const win = element.ownerDocument?.defaultView || window;
    try { element.focus(); } catch (_) {}

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + (rect.width ? rect.width / 2 : 10);
    const clientY = rect.top + (rect.height ? rect.height / 2 : 10);

    const mouseOpts = {
        bubbles: true,
        cancelable: true,
        view: win,
        clientX,
        clientY,
        button: 0,
        buttons: 1
    };

    try {
        element.dispatchEvent(new PointerEvent('pointerover', mouseOpts));
        element.dispatchEvent(new PointerEvent('pointerenter', mouseOpts));
        element.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
    } catch (_) {}

    element.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
    element.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));
    element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

    const mouseUpOpts = { ...mouseOpts, buttons: 0 };
    try {
        element.dispatchEvent(new PointerEvent('pointerup', mouseUpOpts));
    } catch (_) {}
    element.dispatchEvent(new MouseEvent('mouseup', mouseUpOpts));
    element.dispatchEvent(new MouseEvent('click', mouseUpOpts));

    try {
        element.click();
    } catch (_) {}

    return true;
}

function triggerZkClick(buttonElement, inputElement, kabulId) {
    if (!buttonElement && !inputElement) return;
    const targetEl = buttonElement || inputElement;
    const win = targetEl.ownerDocument?.defaultView || window;

    try {
        if (win.zk && win.zk.Widget) {
            if (inputElement) {
                const wi = win.zk.Widget.$(inputElement);
                if (wi) {
                    if (typeof wi.setValue === 'function') wi.setValue(kabulId);
                    wi.fire('onChange', { value: kabulId }, { toServer: true });
                }
            }
            if (buttonElement) {
                let wb = win.zk.Widget.$(buttonElement);
                if (!wb && buttonElement.parentElement) {
                    wb = win.zk.Widget.$(buttonElement.parentElement);
                }
                if (wb && typeof wb.fire === 'function') {
                    wb.fire('onClick', null, { toServer: true });
                }
            }
        }
        if (win.zAu && buttonElement && win.zk && win.zk.Widget) {
            const wb = win.zk.Widget.$(buttonElement) || (buttonElement.parentElement && win.zk.Widget.$(buttonElement.parentElement));
            if (wb) win.zAu.send(new win.zk.Event(wb, 'onClick', null, { toServer: true }));
        }
        if (inputElement) {
            inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: win }));
            inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, view: win }));
            if (win.zk && win.zk.Widget) {
                const wi = win.zk.Widget.$(inputElement);
                if (wi && typeof wi.fire === 'function') {
                    try { wi.fire('onOK', null, { toServer: true }); } catch (_) {}
                }
            }
        }
    } catch (_) {}
}

function syncZkFormInputs() {
    try {
        const allDocs = getAllDocs(document);
        for (const doc of allDocs) {
            const win = doc.defaultView || window;
            if (win.zk && win.zk.Widget) {
                var inputs = doc.querySelectorAll('input, select, textarea');
                for (var i = 0; i < inputs.length; i++) {
                    var el = inputs[i];
                    if (el.type === 'button' || el.type === 'submit' || el.type === 'reset' || el.type === 'hidden') continue;
                    var val = el.value;
                    if (val === undefined || val === null || val === '') continue;

                    var w = win.zk.Widget.$(el);
                    if (w) {
                        if (typeof w.setValue === 'function') {
                            w.setValue(val);
                        }
                        w._value = val;
                        if (typeof w.doBlur_ === 'function') {
                            try { w.doBlur_(new win.zk.Event(w, 'onBlur')); } catch (_) {}
                        }
                        if (typeof w.fire === 'function') {
                            w.fire('onChange', { value: val }, { toServer: true });
                        }
                        if (win.zAu && typeof win.zAu.send === 'function') {
                            win.zAu.send(new win.zk.Event(w, 'onChange', { value: val }, { toServer: true }));
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[YKN] syncZkFormInputs error:', e);
    }
}

function waitForYoksisSearchControls() {
    const deadline = Date.now() + 3500;
    return new Promise((resolve, reject) => {
        const initialPair = findYoksisKabulPair();
        if (initialPair.idInput) {
            resolve(initialPair);
            return;
        }

        const intervalId = setInterval(() => {
            if (typeof chrome === 'undefined' || !chrome?.runtime?.id) {
                clearInterval(intervalId);
                reject(new Error('Eklenti bağlantısı kesildi.'));
                return;
            }
            const pair = findYoksisKabulPair();
            if (pair.idInput) {
                clearInterval(intervalId);
                resolve(pair);
                return;
            }
            if (Date.now() >= deadline) {
                clearInterval(intervalId);
                reject(new Error('YÖKSİS Kabul Mektubu alanı hazır olmadı.'));
            }
        }, 200);
    });
}

function waitForYoksisForm(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const intervalId = setInterval(() => {
            const hasStudentForm = Boolean(
                findTargetElementByFuzzyLabel('Anne Adı', 'input')
                || findTargetElementByFuzzyLabel('Baba Adı', 'input')
                || findBelgeNoInMainPanel()
            );
            if (hasStudentForm) {
                clearInterval(intervalId);
                resolve();
                return;
            }
            if (Date.now() >= deadline) {
                clearInterval(intervalId);
                reject(new Error('YÖKSİS öğrenci bilgi formu açılmadı.'));
            }
        }, 400);
    });
}

// YÖKSİS: "Belge No" alanını bul (Hata Düzeltildi - Kesin TD Araması)
function findBelgeNoInMainPanel() {
    const normalize = str => str.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
    const searchWord = normalize('Belge No');
    const allDocs = getAllDocs(document);

    for (const doc of allDocs) {
        const allInputs = doc.querySelectorAll('input');
        for (const target of allInputs) {
            // Sol menüdeki arama kutucuğunu atlamak için placeholder kontrolü
            const ph = target.getAttribute('placeholder') || '';
            if (ph.toLocaleLowerCase('tr-TR').includes('pasaport') || ph.toLocaleLowerCase('tr-TR').includes('belge')) {
                continue; 
            }
            
            // Bu input'un solundaki hücrelerde 'Belge No' var mı bakıyoruz
            const targetTd = target.closest('td');
            let prevTd = targetTd ? targetTd.previousElementSibling : null;
            let foundLabel = false;
            
            while (prevTd) {
                const text = normalize(prevTd.innerText);
                if (text.includes(searchWord)) {
                    foundLabel = true;
                    break;
                }
                if (text.includes(normalize('Uyruk Kimlik No'))) {
                    // Eğer sola doğru giderken Belge No'dan önce Uyruk Kimlik No'ya çarparsak, 
                    // bu kutu Uyruk Kimlik No'nun kutusudur, Belge No'nun değil! Aramayı kes.
                    break;
                }
                prevTd = prevTd.previousElementSibling;
            }
            
            if (foundLabel) {
                return target;
            }
        }
    }
    return null;
}

// YÖKSİS: Diğer alanlar için çok güçlü, boşluk duyarsız arayıcı
function findTargetElementByFuzzyLabel(labelText, tagName) {
    const normalize = (str) => (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/duzenlenme/g, 'duzenleme')
        .replace(/\s+/g, '');
    const searchWord = normalize(labelText);
    const allDocs = getAllDocs(document);

    for (const doc of allDocs) {
        const allTargets = doc.querySelectorAll(tagName);
        for (const target of allTargets) {
            const row = target.closest('tr');
            if (row && normalize(row.innerText).includes(searchWord)) {
                const targetTd = target.closest('td');
                let prevTd = targetTd ? targetTd.previousElementSibling : null;
                while (prevTd) {
                    if (normalize(prevTd.innerText).includes(searchWord)) {
                        return target;
                    }
                    prevTd = prevTd.previousElementSibling;
                }
            }
        }
        
        const elements = Array.from(doc.querySelectorAll('span, div, label')).filter(el => {
            return normalize(el.innerText).includes(searchWord) && el.children.length <= 2;
        });

        for (const el of elements) {
            const parentTd = el.closest('td');
            if (parentTd && parentTd.nextElementSibling) {
                const target = parentTd.nextElementSibling.querySelector(tagName);
                if (target) return target;
            }
        }
        
        for (const target of allTargets) {
            const row = target.closest('tr');
            if (row && normalize(row.innerText).includes(searchWord)) {
                return target;
            }
        }
    }
    return null;
}

function findTargetElementByFuzzyLabels(labelTexts, tagName) {
    for (const labelText of labelTexts) {
        const target = findTargetElementByFuzzyLabel(labelText, tagName);
        if (target) return target;
    }
    return null;
}

function findPhotoUploadButton() {
    const norm = (s) => (s || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/ı/g, 'i')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '');

    const allDocs = getAllDocs(document);
    for (const doc of allDocs) {
        // 1. Text-based search across clickable elements
        const clickables = doc.querySelectorAll('button, a, input[type="button"], span.z-button, div.z-button, [role="button"]');
        for (const el of clickables) {
            const t = norm(el.innerText || el.textContent || el.value || '');
            if (t.includes('fotograf') && (t.includes('yukle') || t.includes('sec') || t.includes('ekle'))) {
                return el;
            }
        }

        // 2. Search in table row containing "Fotoğraf Adı"
        const allLabels = doc.querySelectorAll('span, td, div, label, b');
        for (const lbl of allLabels) {
            const t = norm(lbl.innerText || lbl.textContent || '');
            if (t.includes('fotografadi') || t === 'fotograf') {
                const row = lbl.closest('tr') || lbl.closest('div') || lbl.parentElement;
                if (row) {
                    const btn = row.querySelector('button, a, input[type="button"], .z-button, [role="button"]');
                    if (btn) return btn;
                }
            }
        }

        // 3. Fallback: Any element with upload attribute or upload class
        const uploadEl = doc.querySelector('[upload], .z-upload, .z-fileupload');
        if (uploadEl) {
            if (uploadEl.matches('button, a, input[type="button"], .z-button, [role="button"]')) return uploadEl;
            const inner = uploadEl.querySelector('button, a, input[type="button"], .z-button, [role="button"]');
            if (inner) return inner;
        }
    }

    return null;
}

function findYoksisFileInput(photoBtn) {
    if (!photoBtn) {
        const allDocs = getAllDocs(document);
        for (const d of allDocs) {
            const fi = d.querySelector('input[type="file"]');
            if (fi) return fi;
        }
        return null;
    }

    // 1. Inside the button
    let inp = photoBtn.querySelector('input[type="file"]');
    if (inp) return inp;

    // 2. Sibling or same parent
    inp = photoBtn.parentElement?.querySelector('input[type="file"]');
    if (inp) return inp;

    // 3. In the same row or container
    const row = photoBtn.closest('tr, td, table, .z-groupbox, .z-panel, fieldset, form');
    if (row) {
        inp = row.querySelector('input[type="file"]');
        if (inp) return inp;
    }

    // 4. ZK Widget uploader reference
    const win = photoBtn.ownerDocument?.defaultView || window;
    try {
        if (win.zk && win.zk.Widget) {
            const w = win.zk.Widget.$(photoBtn);
            if (w) {
                if (w._uplder) {
                    const u = w._uplder;
                    inp = (u.form && u.form.querySelector('input[type="file"]')) ||
                          (u._form && u._form.querySelector('input[type="file"]')) ||
                          u.input || u._input;
                }
                if (!inp && w.uuid) {
                    inp = photoBtn.ownerDocument.querySelector('form[id*="' + w.uuid + '"] input[type="file"], input[type="file"][id*="' + w.uuid + '"]');
                }
            }
        }
    } catch (_) {}
    if (inp) return inp;

    // 5. Check all file inputs in ownerDocument
    const allDocInputs = (photoBtn.ownerDocument || document).querySelectorAll('input[type="file"]');
    if (allDocInputs.length === 1) return allDocInputs[0];
    if (allDocInputs.length > 1) {
        const btnRect = photoBtn.getBoundingClientRect();
        let closest = null;
        let minDist = Infinity;
        for (let i = 0; i < allDocInputs.length; i++) {
            const r = allDocInputs[i].getBoundingClientRect();
            const d = Math.hypot(r.left - btnRect.left, r.top - btnRect.top);
            if (d < minDist) { minDist = d; closest = allDocInputs[i]; }
        }
        return closest || allDocInputs[0];
    }

    return null;
}

function base64ToFile(base64Data, filename) {
    const cleanName = filename || 'ogrenci_foto.jpg';
    let mime = 'image/jpeg';
    let byteChars;

    if (base64Data.includes(',')) {
        const parts = base64Data.split(',');
        const match = parts[0].match(/:(.*?);/);
        if (match) mime = match[1];
        byteChars = atob(parts[1]);
    } else {
        byteChars = atob(base64Data);
    }

    const byteNums = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNums);
    const blob = new Blob([byteArray], { type: mime });
    return new File([blob], cleanName, { type: mime, lastModified: Date.now() });
}

async function uploadPhotoToYoksis(photoBase64, fileName) {
    if (!photoBase64) return false;

    let photoBtn = null;
    let fileInput = null;

    // Fotoğraf butonunu ve ZK dosya inputunu yakalamak için 2.5 saniyeye kadar bekle (25 x 100ms)
    for (let attempt = 0; attempt < 25; attempt++) {
        photoBtn = findPhotoUploadButton();
        if (photoBtn) {
            try {
                photoBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
                photoBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
            } catch (_) {}
        }

        fileInput = findYoksisFileInput(photoBtn);
        if (fileInput) break;

        await new Promise(r => setTimeout(r, 100));
    }

    if (!fileInput) {
        console.warn('[YKN] YÖKSİS Fotoğraf file input bulunamadı.');
        return false;
    }

    const photoToken = `${fileName || 'foto'}_${photoBase64.length}_${photoBase64.slice(-15)}`;
    const currentToken = fileInput.getAttribute('data-ykn-photo-token');
    const currentStatus = fileInput.getAttribute('data-ykn-photo-status');

    if (currentToken === photoToken && (currentStatus === 'submitted' || currentStatus === 'file_assigned')) {
        console.log('[YKN] Bu fotoğraf zaten atanmış, mükerrer yükleme engellendi:', fileName);
        return true;
    }

    try {
        const file = base64ToFile(photoBase64, fileName);
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.setAttribute('data-ykn-photo-token', photoToken);
        fileInput.setAttribute('data-ykn-photo-status', 'file_assigned');

        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        if (window.jq) {
            try { window.jq(fileInput).trigger('change'); } catch (_) {}
        }

        if (photoBtn && window.zk && window.zk.Widget) {
            try {
                const w = window.zk.Widget.$(photoBtn);
                if (w && w._uplder) {
                    const u = w._uplder;
                    if (!u._uploading) {
                        if (typeof u.start === 'function') {
                            u.start();
                        } else if (typeof u._send === 'function') {
                            u._send();
                        } else if (typeof u.send === 'function') {
                            u.send();
                        } else if (u.form && typeof u.form.submit === 'function') {
                            u.form.submit();
                        }
                    }
                    fileInput.setAttribute('data-ykn-photo-status', 'submitted');
                }
            } catch (_) {}
        }

        // Fotoğraf Adı kutucuğuna da anında dosya adını yazdır (varsa)
        try {
            const fotoAdiInput = findTargetElementByFuzzyLabel('Fotoğraf Adı', 'input');
            if (fotoAdiInput && !fotoAdiInput.value) {
                simulateInput(fotoAdiInput, fileName);
            }
        } catch (_) {}

        console.log('[YKN] Fotoğraf başarıyla hazırlandı/yüklendi:', fileName);
        return true;
    } catch (err) {
        console.error('[YKN] Fotoğraf yükleme hatası:', err);
        return false;
    }
}

function formatDateForYoksisInput(element, rawDate) {
    if (!rawDate) return '';
    const clean = String(rawDate).trim();
    if (element && (element.getAttribute('type') || '').toLowerCase() === 'date') {
        const parts = clean.split(/[./\-\s]+/);
        if (parts.length === 3) {
            let y, m, d;
            if (parts[0].length === 4) {
                [y, m, d] = parts;
            } else {
                [d, m, y] = parts;
            }
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return clean;
    }

    const parts = clean.split(/[./\-\s]+/);
    if (parts.length === 3) {
        let d, m, y;
        if (parts[0].length === 4) {
            [y, m, d] = parts;
        } else {
            [d, m, y] = parts;
        }
        const dd = String(d).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        const yyyy = String(y).length === 2 ? (Number(y) <= 49 ? '20' + y : '19' + y) : String(y);
        return `${dd}.${mm}.${yyyy}`;
    }
    return clean;
}

function normalizeApplyText(value) {
    return (value || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
}

function toApplyUrl(value) {
    if (!value || value === '#' || value.startsWith('javascript:')) return '';

    try {
        const url = new URL(value, location.href);
        if (url.hostname !== 'apply.topkapi.edu.tr' && !url.hostname.endsWith('.topkapi.edu.tr')) return '';
        return url.href;
    } catch (error) {
        return '';
    }
}

function extractElementUrl(element) {
    const directValue = element.href
        || element.src
        || element.getAttribute('src')
        || element.getAttribute('data-href')
        || element.getAttribute('data-url')
        || element.getAttribute('data-link');
    const directUrl = toApplyUrl(directValue);
    if (directUrl) return directUrl;

    const onclick = element.getAttribute('onclick') || '';
    const embeddedValue = onclick.match(/['"]((?:https?:\/\/|\/)[^'"]+)['"]/i);
    return embeddedValue ? toApplyUrl(embeddedValue[1]) : '';
}

function findStudentProfileUrl(row) {
    if (!row) return '';
    const elements = row.querySelectorAll('a[href], [data-href], [data-url], [data-link], [onclick], button');
    for (const element of elements) {
        const url = extractElementUrl(element);
        const text = normalizeApplyText(element.innerText || element.textContent);
        if (url && url.includes('/applications') && !text.includes('sil')) return url;
    }

    for (const el of elements) {
        const appId = el.getAttribute('data-id') || el.getAttribute('data-application-id') || el.dataset?.id;
        const text = normalizeApplyText(el.innerText || el.textContent);
        if (appId && !text.includes('sil')) {
            return `https://apply.topkapi.edu.tr/panel/applications/${appId}`;
        }
    }

    const refCell = row.querySelector('td:nth-child(1)');
    if (refCell) {
        const refMatch = refCell.innerText.match(/\d+$/);
        if (refMatch) {
            return `https://apply.topkapi.edu.tr/panel/applications/${refMatch[0]}`;
        }
    }

    return '';
}

function isExcludedFromAcceptance(text) {
    if (!text) return false;
    const norm = normalizeApplyText(text);
    return norm.includes('pasaport') || norm.includes('passport')
        || norm.includes('diploma') || norm.includes('transkript') || norm.includes('transcript')
        || norm.includes('dekont') || norm.includes('makbuz') || norm.includes('receipt')
        || norm.includes('fotograf') || norm.includes('photo') || norm.includes('ikamet')
        || norm.includes('denklik') || norm.includes('kimlik');
}

function isOfferText(text) {
    if (!text) return false;
    const norm = normalizeApplyText(text);
    return norm.includes('teklif') || norm.includes('offer') || norm.includes('sartli') || norm.includes('conditional');
}

function isTrueAcceptanceText(text) {
    if (!text || isOfferText(text) || isExcludedFromAcceptance(text)) return false;
    const norm = normalizeApplyText(text);
    return norm.includes('kabulmektub')
        || norm.includes('resmikabul')
        || norm.includes('kesinkabul')
        || norm.includes('acceptanceletter')
        || norm.includes('officialacceptance')
        || norm.includes('finalacceptance')
        || (norm.includes('kabul') && (norm.includes('mektup') || norm.includes('belge')));
}

function isPassportText(text) {
    if (!text) return false;
    if (isOfferText(text) || isTrueAcceptanceText(text)) return false;
    const norm = normalizeApplyText(text);
    return norm.includes('pasaport') || norm.includes('passport');
}

function isAcceptanceLetterUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (lower.includes('pasaport') || lower.includes('passport') || lower.includes('offer') || lower.includes('teklif') || lower.includes('sartli') || lower.includes('conditional')) return false;
    return lower.includes('acceptance-letter')
        || lower.includes('acceptance_letter')
        || lower.includes('acceptanceletter')
        || lower.includes('/verify-document/')
        || lower.includes('kabul-mektubu')
        || lower.includes('kabul_mektubu')
        || lower.includes('kabulmektubu');
}

function isPassportUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('pasaport') || lower.includes('passport');
}

function isOfficialAcceptanceLetterText(rawText) {
    return isTrueAcceptanceText(rawText);
}

function isOfficialAcceptanceLetterUrl(url) {
    return isAcceptanceLetterUrl(url);
}

function isAcceptanceLetterText(rawText) {
    return isTrueAcceptanceText(rawText);
}

function getDocumentType(text) {
    if (isTrueAcceptanceText(text)) {
        return 'acceptanceLetterUrl';
    }
    if (isPassportText(text)) {
        return 'passportDocumentUrl';
    }
    return '';
}

function isNavigationOrInvalidUrl(url) {
    if (!url || url === '#' || url.startsWith('javascript:')) return true;
    try {
        const parsed = new URL(url, location.href);
        const path = parsed.pathname.replace(/\/$/, '');
        if (path === '/panel/applications' || path.endsWith('/edit') || path.endsWith('/delete')) return true;
        if (path === '/panel/dashboard' || path === '/panel') return true;
        if (parsed.hash && !parsed.pathname) return true;
        return false;
    } catch (_) {
        return true;
    }
}

function isValidYoksisId(code) {
    if (!code || typeof code !== 'string') return false;
    const clean = code.trim().toUpperCase().replace(/[–—]/g, '-');
    if (clean.includes('SVG') || clean.includes('ICON') || clean.includes('BTN') || clean.includes('BADGE')) return false;
    if (clean.startsWith('202') || clean.startsWith('19')) return false;
    if (!/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(clean)) return false;
    return /\d/.test(clean);
}

function findDirectKabulCode() {
    try {
        const bodyText = document.body ? document.body.innerText : '';
        const labeledMatch = bodyText.match(/(?:YÖKS[İI]S|YOKSIS)\s*(?:ID|KODU|NO|CODE)?\s*[:#\.\-–—]?\s*([A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4})/i);
        if (labeledMatch && labeledMatch[1]) {
            const code = labeledMatch[1].replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
            if (isValidYoksisId(code)) {
                return code;
            }
        }
        const yoksisInputs = document.querySelectorAll('input[name*="yoksis" i], input[id*="yoksis" i], [data-yoksis-id]');
        for (const inp of yoksisInputs) {
            const val = inp.value || inp.getAttribute('data-yoksis-id');
            const clean = (val || '').trim().replace(/[–—]/g, '-').toUpperCase();
            if (isValidYoksisId(clean)) return clean;
        }
    } catch (_) {}
    return '';
}

function parseDateTimestamp(text) {
    if (!text) return 0;
    const m = text.match(/(\d{2})[./-](\d{2})[./-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return 0;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const min = m[5] ? parseInt(m[5], 10) : 0;
    const sec = m[6] ? parseInt(m[6], 10) : 0;
    return new Date(year, month, day, hour, min, sec).getTime() || 0;
}

function findDocumentActionUrl(container) {
    if (!container) return '';
    const candidates = Array.from(container.querySelectorAll('a[href], [data-href], [data-url], [data-link], button, [onclick]'));
    
    // Priority 1: explicitly looks like an acceptance letter or document URL
    for (const el of candidates) {
        const url = extractElementUrl(el);
        if (!url || isNavigationOrInvalidUrl(url)) continue;
        if (isAcceptanceLetterUrl(url)) return url;
    }

    // Priority 2: document view/download URL
    for (const el of candidates) {
        const url = extractElementUrl(el);
        if (!url || isNavigationOrInvalidUrl(url)) continue;
        const normUrl = url.toLocaleLowerCase('tr-TR');
        const text = (el.innerText || el.textContent || el.getAttribute('title') || '').toLocaleLowerCase('tr-TR');
        if (normUrl.includes('.pdf') || normUrl.includes('/download') || normUrl.includes('/document') || normUrl.includes('/uploads') || normUrl.includes('/storage') || normUrl.includes('/view') || normUrl.includes('/verify-document')) {
            return url;
        }
        if (text.includes('görüntüle') || text.includes('indir') || text.includes('view') || text.includes('download') || text.includes('pdf')) {
            return url;
        }
    }

    // Priority 3: any valid non-navigation URL
    for (const el of candidates) {
        const url = extractElementUrl(el);
        if (url && !isNavigationOrInvalidUrl(url)) {
            return url;
        }
    }
    return '';
}

function findDocumentLinks() {
    const links = {
        acceptanceLetterUrl: '',
        acceptanceCandidates: [],
        passportDocumentUrl: '',
        passportCandidates: [],
        kabulId: ''
    };
    
    // Direct code if available on page
    const directCode = findDirectKabulCode();
    if (directCode) links.kabulId = directCode;

    // Detect section cards: "Oluşturulan Dosyalar" vs "Yüklenen Dosyalar"
    const allContainers = Array.from(document.querySelectorAll('.card, .row, .col, div, section'));
    let generatedSection = null;
    let uploadedSection = null;

    for (const container of allContainers) {
        const h = container.querySelector('h1, h2, h3, h4, h5, h6, .card-title, .fs-4, .fs-5, .fw-bolder, strong, span');
        const text = h ? normalizeApplyText(h.innerText) : '';
        if (!generatedSection && (text.includes('olusturulandosya') || text.includes('olusturulanbelge') || text.includes('generatedfiles'))) {
            generatedSection = container;
        }
        if (!uploadedSection && (text.includes('yuklenendosya') || text.includes('yuklenenbelge') || text.includes('uploadedfiles'))) {
            uploadedSection = container;
        }
    }

    const allClickables = Array.from(document.querySelectorAll('a[href], [data-url], [data-href], [data-link], button, [onclick], img[src], iframe[src], embed[src]'));
    const acceptanceCandidates = [];
    const passportCandidates = [];

    for (const el of allClickables) {
        const url = extractElementUrl(el);
        if (!url || isNavigationOrInvalidUrl(url)) continue;

        const selfText = el.innerText || el.textContent || '';
        const titleEl = el.querySelector('.fw-bold, .title, strong, b, h6, span');
        const titleText = titleEl ? titleEl.innerText : '';
        const parentContainer = el.closest('.d-flex, .card, tr, li, .document-item, .row');
        const parentText = parentContainer ? parentContainer.innerText : '';

        const fullItemText = `${titleText} ${selfText} ${parentText}`;
        const isOffer = isOfferText(fullItemText) || isOfferText(titleText) || isOfferText(selfText);
        const timestamp = parseDateTimestamp(fullItemText) || parseDateTimestamp(selfText);
        const inGenerated = generatedSection && generatedSection.contains(el);
        const inUploaded = uploadedSection && uploadedSection.contains(el);

        // ACCEPTANCE LETTER EVALUATION:
        // STRICT RULE: Teklif Mektubu (Offer Letter) is NEVER an Acceptance Letter!
        if (!isOffer && !isPassportUrl(url)) {
            const isAcceptance = isTrueAcceptanceText(titleText)
                || isTrueAcceptanceText(selfText)
                || isTrueAcceptanceText(fullItemText);

            if (isAcceptance) {
                let score = 500;
                if (inGenerated) score += 1000;
                if (isAcceptanceLetterUrl(url)) score += 200;
                if (timestamp > 0) score += Math.floor(timestamp / 1000);
                acceptanceCandidates.push({ url, score, timestamp });
            }
        }

        // PASSPORT EVALUATION:
        if (!isOffer && !isTrueAcceptanceText(fullItemText)) {
            const isPassport = isPassportText(titleText)
                || isPassportText(selfText)
                || isPassportText(fullItemText)
                || isPassportUrl(url);

            if (isPassport && !isTrueAcceptanceText(titleText) && !isTrueAcceptanceText(selfText)) {
                let score = 500;
                if (inUploaded) score += 1000;
                if (isPassportUrl(url)) score += 300;
                if (timestamp > 0) score += Math.floor(timestamp / 1000);
                passportCandidates.push({ url, score });
            }
        }
    }

    // Sort acceptance candidates: newest and generated section first
    acceptanceCandidates.sort((a, b) => b.score - a.score);
    const uniqueAcceptanceUrls = Array.from(new Set(acceptanceCandidates.map(c => c.url)));
    if (uniqueAcceptanceUrls.length > 0) {
        links.acceptanceLetterUrl = uniqueAcceptanceUrls[0];
        links.acceptanceCandidates = uniqueAcceptanceUrls;
    }

    // Sort passport candidates
    passportCandidates.sort((a, b) => b.score - a.score);
    const uniquePassportUrls = Array.from(new Set(passportCandidates.map(c => c.url)));
    if (uniquePassportUrls.length > 0) {
        links.passportDocumentUrl = uniquePassportUrls[0];
        links.passportCandidates = uniquePassportUrls;
    }

    // Fallback ONLY if absolutely no true acceptance letter with "kabul" text was found
    if (!links.acceptanceLetterUrl) {
        for (const el of allClickables) {
            const url = extractElementUrl(el);
            if (!url || isNavigationOrInvalidUrl(url) || isPassportUrl(url)) continue;
            const fullText = (el.innerText || '') + ' ' + (el.closest('.d-flex, tr, .card, li')?.innerText || '');
            if (isOfferText(fullText)) continue; // STRICT REJECTION of Offer letters!
            if (isAcceptanceLetterUrl(url)) {
                links.acceptanceLetterUrl = url;
                links.acceptanceCandidates = [url];
                break;
            }
        }
    }

    // Fallback for passport if not found
    if (!links.passportDocumentUrl) {
        for (const el of allClickables) {
            const url = extractElementUrl(el);
            if (!url || isNavigationOrInvalidUrl(url)) continue;
            if (isPassportUrl(url)) {
                links.passportDocumentUrl = url;
                links.passportCandidates = [url];
                break;
            }
        }
    }

    return links;
}

function readFieldValue(target) {
    if (!target) return '';
    if (target.tagName === 'SELECT') return target.options[target.selectedIndex]?.text?.trim() || '';
    return (target.value || target.textContent || '').trim();
}

function findApplyFieldValue(labels) {
    const normalizedLabels = labels.map(normalizeApplyText);
    const targets = document.querySelectorAll('input, select, textarea');
    for (const target of targets) {
        const rowText = normalizeApplyText(target.closest('tr')?.innerText);
        if (normalizedLabels.some((label) => rowText.includes(label))) {
            const value = readFieldValue(target);
            if (value) return value;
        }
    }

    const rows = document.querySelectorAll('tr');
    for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length < 2) continue;
        const label = normalizeApplyText(cells[0].innerText);
        if (normalizedLabels.some((value) => label.includes(value))) return cells[1].innerText.trim();
    }
    return '';
}

function findApplyStudentData() {
    return {
        anneAdi: findApplyFieldValue(['Anne Adı', "Mother's Name", 'Mother Name']),
        babaAdi: findApplyFieldValue(['Baba Adı', "Father's Name", 'Father Name']),
        uyruk: findApplyFieldValue(['Uyruğu', 'Nationality']),
        dogumUlkesi: findApplyFieldValue(['Doğum Yeri Ülkesi', 'Born Country']),
        cinsiyet: findApplyFieldValue(['Cinsiyeti', 'Gender', 'Sex']),
        pasaportNo: findApplyFieldValue(['Pasaport No', 'Passport No', 'Number of Document']),
        birthDate: findApplyFieldValue(['Doğum Tarihi', 'Date of Birth', 'Birth Date', 'Doğum Günü'])
    };
}

function normalizeApplyBirthDate(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return '';
    const clean = rawDate.trim();
    if (!clean) return '';

    const monthMap = {
        'ocak': '01', 'jan': '01', 'january': '01', 'oca': '01',
        'şubat': '02', 'subat': '02', 'feb': '02', 'february': '02', 'şub': '02', 'sub': '02',
        'mart': '03', 'mar': '03', 'march': '03',
        'nisan': '04', 'apr': '04', 'april': '04', 'nis': '04',
        'mayıs': '05', 'mayis': '05', 'may': '05',
        'haziran': '06', 'jun': '06', 'june': '06', 'haz': '06',
        'temmuz': '07', 'jul': '07', 'july': '07', 'tem': '07',
        'ağustos': '08', 'agustos': '08', 'aug': '08', 'august': '08', 'ağu': '08', 'agu': '08',
        'eylül': '09', 'eylul': '09', 'sep': '09', 'september': '09', 'eyl': '09',
        'ekim': '10', 'oct': '10', 'october': '10', 'eki': '10',
        'kasım': '11', 'kasim': '11', 'nov': '11', 'november': '11', 'kas': '11',
        'aralık': '12', 'aralik': '12', 'dec': '12', 'december': '12', 'ara': '12'
    };

    const parts = clean.split(/[./\-\s]+/).filter(Boolean);
    if (parts.length !== 3) {
        const isoMatch = clean.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
        if (isoMatch) {
            return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
        }
        return '';
    }

    let [p1, p2, p3] = parts;
    const parseMonth = (val) => {
        if (/^\d{1,2}$/.test(val)) return val.padStart(2, '0');
        const key = val.toLowerCase().replace(/[^a-zıüğşöç]/g, '');
        return monthMap[key] || '';
    };

    // Case 1: YYYY-MM-DD
    if (/^\d{4}$/.test(p1) && /^\d{1,2}$/.test(p3)) {
        const mm = parseMonth(p2);
        if (mm) return `${p1}-${mm}-${p3.padStart(2, '0')}`;
    }

    // Case 2: DD-MM-YYYY
    if (/^\d{1,2}$/.test(p1) && /^\d{4}$/.test(p3)) {
        const mm = parseMonth(p2);
        if (mm) return `${p3}-${mm}-${p1.padStart(2, '0')}`;
    }

    // Case 3: MM-DD-YYYY
    if (/^\d{4}$/.test(p3)) {
        const mm = parseMonth(p1);
        if (mm && /^\d{1,2}$/.test(p2)) return `${p3}-${mm}-${p2.padStart(2, '0')}`;
    }

    return '';
}

function extractApplyProfileData() {
    const anneInput = document.querySelector('input[name="mothersName"]');
    const babaInput = document.querySelector('input[name="fathersName"]');
    
    let pasaportInput = document.querySelector('input[name="passportNumber"]');
    if (!pasaportInput) pasaportInput = document.querySelector('.inputPassportNumber');
    if (!pasaportInput) {
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
            if (label.innerText.includes('Pasaport No')) {
                pasaportInput = label.parentElement ? label.parentElement.querySelector('input') : null;
                if (pasaportInput) break;
            }
        }
    }

    let birthInput = document.querySelector('input[name="birthDate"]') ||
                     document.querySelector('input[name="birthdate"]') ||
                     document.querySelector('input[name="dateOfBirth"]') ||
                     document.querySelector('.inputBirthDate');
    if (!birthInput) {
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
            const lt = label.innerText.toLowerCase();
            if (lt.includes('doğum tarihi') || lt.includes('dogum tarihi') || lt.includes('date of birth') || lt.includes('birth date')) {
                birthInput = label.parentElement ? label.parentElement.querySelector('input') : null;
                if (birthInput) break;
            }
        }
    }

    const fallbackData = findApplyStudentData();
    
    const anneAdi = (anneInput ? anneInput.value : '') || fallbackData.anneAdi || '';
    const babaAdi = (babaInput ? babaInput.value : '') || fallbackData.babaAdi || '';
    const pasaportNo = (pasaportInput ? pasaportInput.value : '') || fallbackData.pasaportNo || '';
    const rawBirthDate = (birthInput ? birthInput.value : '') || fallbackData.birthDate || '';
    const uyruk = getSourceDropdownByLabel('Uyruk') || fallbackData.uyruk || '';
    const dogumUlkesi = getSourceDropdownByLabel('Doğduğunuz') || getSourceDropdownByLabel('Doğum') || fallbackData.dogumUlkesi || '';
    const cinsiyet = getSourceDropdownByLabel('Cinsiyet') || fallbackData.cinsiyet || '';

    const normalizedBirthDate = normalizeApplyBirthDate(rawBirthDate);

    return {
        anneAdi: (anneAdi || '').trim(),
        babaAdi: (babaAdi || '').trim(),
        pasaportNo: (pasaportNo || '').trim(),
        birthDate: normalizedBirthDate,
        uyruk: (uyruk || '').trim(),
        dogumUlkesi: (dogumUlkesi || '').trim(),
        cinsiyet: (cinsiyet || '').trim()
    };
}

function watchForDocumentLinks(requestId) {
    const deadline = Date.now() + 15_000;
    const intervalId = setInterval(() => {
        if (typeof chrome === 'undefined' || !chrome?.runtime?.id) {
            clearInterval(intervalId);
            return;
        }
        const links = findDocumentLinks();
        const safeKabulId = isValidYoksisId(links.kabulId) ? links.kabulId : '';
        if (links.passportDocumentUrl || links.acceptanceLetterUrl || safeKabulId) {
            clearInterval(intervalId);
            sendApplyEvent('STUDENT_DOCUMENTS_FOUND', requestId, {
                data: { ...extractApplyProfileData(), ...links, kabulId: safeKabulId }
            });
            return;
        }

        if (Date.now() >= deadline) {
            clearInterval(intervalId);
            sendApplyEvent('STUDENT_DOCUMENTS_FOUND', requestId, {
                data: { ...extractApplyProfileData(), ...links, kabulId: safeKabulId }
            });
        }
    }, 400);
}

async function fetchApplyDocument(documentUrl) {
    let safeUrl = toApplyUrl(documentUrl);
    if (!safeUrl) throw new Error('Apply belge bağlantısı güvenli değil.');

    let response = await fetch(safeUrl, { credentials: 'include' });
    if (!response.ok) throw new Error(`Belge alınamadı: ${response.status}`);

    let contentType = response.headers.get('content-type') || '';
    let arrayBuffer = await response.arrayBuffer();

    const headBytes = new Uint8Array(arrayBuffer.slice(0, 500));
    const headText = String.fromCharCode(...headBytes).toLowerCase();
    const isHtml = contentType.includes('text/html') || headText.includes('<!doctype') || headText.includes('<html');

    if (isHtml) {
        const text = new TextDecoder('utf-8').decode(arrayBuffer);
        const iframeMatch = text.match(/<(?:iframe|embed|object)[^>]+(?:src|data)=["']([^"']+)["']/i)
            || text.match(/(?:src|href)=["']((?:https?:\/\/[^"']+|\/)[^"']*\/uploads\/acceptance-letters\/[^"']+)["']/i)
            || text.match(/((?:https?:\/\/[^"'\s<>]+\/|\/)[^"'\s<>]*\/uploads\/acceptance-letters\/[^"'\s<>]+\.pdf[^"'\s<>]*)/i)
            || text.match(/((?:https?:\/\/[^"'\s<>]+\/|\/)[^"'\s<>]+\.pdf(?:\?[^"'\s<>]*)?)/i);
        if (iframeMatch && iframeMatch[1]) {
            const rawPdfUrl = iframeMatch[1].replace(/&amp;/g, '&');
            let resolvedPdfUrl = rawPdfUrl;
            try {
                resolvedPdfUrl = new URL(rawPdfUrl, safeUrl).href;
            } catch (_) {}
            const pdfUrl = toApplyUrl(resolvedPdfUrl);
            if (pdfUrl) {
                const pdfResponse = await fetch(pdfUrl, { credentials: 'include' });
                if (pdfResponse.ok) {
                    contentType = pdfResponse.headers.get('content-type') || 'application/pdf';
                    arrayBuffer = await pdfResponse.arrayBuffer();
                }
            }
        }
    }

    return {
        contentType,
        documentBase64: await encodeBase64(arrayBuffer)
    };
}

async function encodeBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

// Mesaj Dinleyicisi
if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
        sendResponse({
            success: true,
            ready: true,
            pageKind: getPageKind(),
            url: location.href
        });
        return true;
    }
    
    if (request.action === "copyData") {
        try {
            const links = findDocumentLinks();
            const profileData = extractApplyProfileData();
            const dataToSave = {
                ...profileData,
                passportDocumentUrl: links.passportDocumentUrl || '',
                passportCandidates: links.passportCandidates || [],
                acceptanceLetterUrl: links.acceptanceLetterUrl || '',
                acceptanceCandidates: links.acceptanceCandidates || [],
                kabulId: links.kabulId || ''
            };
            chrome.storage.local.set({ studentData: dataToSave }, () => {
                sendResponse({ success: true, data: dataToSave });
            });
        } catch (error) {
            sendResponse({ success: false, message: error.message });
        }
        return true; 
    }

    else if (request.action === 'GET_KABUL_CODE_OR_DOCUMENT') {
        try {
            const links = findDocumentLinks();
            const studentData = extractApplyProfileData();
            const safeKabulId = isValidYoksisId(links.kabulId) ? links.kabulId : '';
            sendResponse({
                success: true,
                requestId: request.requestId,
                kabulId: safeKabulId,
                acceptanceLetterUrl: links.acceptanceLetterUrl || '',
                acceptanceCandidates: links.acceptanceCandidates || [],
                passportDocumentUrl: links.passportDocumentUrl || '',
                passportCandidates: links.passportCandidates || [],
                data: studentData
            });
        } catch (error) {
            sendResponse({ success: false, requestId: request.requestId, message: error.message });
        }
        return true;
    }

    else if (request.action === 'DISCOVER_STUDENT_DOCUMENTS') {
        watchForDocumentLinks(request.requestId);
        sendResponse({ success: true, requestId: request.requestId });
        return true;
    }

    else if (request.action === 'FETCH_APPLY_DOCUMENT') {
        fetchApplyDocument(request.documentUrl)
            .then((result) => sendResponse({ success: true, ...result }))
            .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    else if (request.action === "searchWithId") {
        const kabulId = request.kabulId;
        
        if (!kabulId) {
            sendResponse({ success: false, requestId: request.requestId, message: "Kabul ID boş olamaz." });
            return;
        }

        waitForYoksisSearchControls()
            .then(async ({ idInput, searchBtn }) => {
                if (idInput) {
                    await simulateInput(idInput, kabulId);
                }
                // ZK'nin blur/change olayını işlemesi için kısa bekleme
                await new Promise(resolve => setTimeout(resolve, 150));

                if (!searchBtn && idInput) {
                    searchBtn = findKabulIdButton(idInput);
                }

                if (searchBtn) {
                    simulateButtonClick(searchBtn);
                    triggerZkClick(searchBtn, idInput, kabulId);
                } else {
                    console.warn('[YKN] Kabul mektup ID ara butonu bulunamadı, genel tetikleyici deneniyor.');
                    triggerZkClick(null, idInput, kabulId);
                }

                let formReady = false;
                try {
                    await waitForYoksisForm(2500);
                    formReady = true;
                } catch (_) {
                    formReady = false;
                }
                return { formReady };
            })
            .then(({ formReady }) => sendResponse({ success: true, formReady, requestId: request.requestId }))
            .catch((error) => sendResponse({
                success: false,
                requestId: request.requestId,
                message: error.message
            }));
        return true;
    }

    else if (request.action === 'WAIT_YOKSIS_FORM') {
        waitForYoksisForm(Math.min(Number(request.timeoutMs) || 6000, 10000))
            .then(() => sendResponse({
                success: true,
                formReady: true,
                requestId: request.requestId
            }))
            .catch((error) => sendResponse({
                success: false,
                formReady: false,
                requestId: request.requestId,
                message: error.message
            }));
        return true;
    }
    
    else if (request.action === "fillRemainingData") {
        chrome.storage.local.get(['studentData'], async (result) => {
            const data = request.data || result.studentData;
            if (!data) {
                sendResponse({ success: false, message: "Hafızada veri yok." });
                return;
            }

            // Formun açılmasını ve alanların DOM'a yüklenmesini bekle (3.5 saniyeye kadar)
            try {
                await waitForYoksisForm(3500);
            } catch (_) {
                // Form zaten açık veya süre aşıldıysa mevcut elemanlarla devam et
            }

            let successCount = 0;
            let photoUploaded = false;

            const anneAdiInput = findTargetElementByFuzzyLabel('Anne Adı', 'input');
            if (await simulateInput(anneAdiInput, data.anneAdi)) successCount++;

            const babaAdiInput = findTargetElementByFuzzyLabel('Baba Adı', 'input');
            if (await simulateInput(babaAdiInput, data.babaAdi)) successCount++;

            const uyrukSelect = findTargetElementByFuzzyLabel('Uyruğu', 'select');
            if (simulateSelect(uyrukSelect, data.uyruk)) successCount++;
            
            const dogumUyruguSelect = findTargetElementByFuzzyLabel('Doğum Uyruğu', 'select');
            if (simulateSelect(dogumUyruguSelect, data.uyruk)) successCount++;
            
            const dogumYeriUlkesiSelect = findTargetElementByFuzzyLabel('Doğum Yeri Ülkesi', 'select');
            const dogumYeriDegeri = data.dogumUlkesi ? data.dogumUlkesi : data.uyruk;
            if (simulateSelect(dogumYeriUlkesiSelect, dogumYeriDegeri)) successCount++;
            
            const belgeyiVerenUlkeSelect = findTargetElementByFuzzyLabel('Belgeyi Veren Ülke', 'select');
            if (simulateSelect(belgeyiVerenUlkeSelect, data.uyruk)) successCount++;

            if (data.cinsiyet) {
                if (simulateRadioByLabelText(data.cinsiyet)) successCount++;
            }

            // Özel Ülke Kuralları (Türkmenistan, Afganistan, Pakistan)
            const normalizeCountry = (val) => val ? val.toLocaleLowerCase('tr-TR').replace(/\s+/g, '') : '';
            const isMatch = (val, search) => normalizeCountry(val).includes(search);

            const uyrukNorm = normalizeCountry(data.uyruk);
            const dogumNorm = normalizeCountry(data.dogumUlkesi);
            const isTurkmen = uyrukNorm.includes('türkmen') || uyrukNorm.includes('turkmen') || uyrukNorm === 'tkm' ||
                              dogumNorm.includes('türkmen') || dogumNorm.includes('turkmen') || dogumNorm === 'tkm';

            let verenMakam = findTargetElementByFuzzyLabel('Belgeyi Veren Makam', 'input');
            if (!verenMakam) verenMakam = findTargetElementByFuzzyLabel('Veren Makam', 'input');

            const dogumYeriAciklamasi = findTargetElementByFuzzyLabel('Doğum Yeri Açıklaması', 'input');

            // Türkmenistan için doğum yeri açıklaması her zaman TKM sabittir
            const customDogumYeri = isTurkmen ? 'TKM' : (data.dogumYeriAciklamasi || data.dogumYeri || data.birthPlace || '').trim();
            const customVerenMakam = (data.verenMakam || data.issuingAuthority || (isTurkmen ? 'SMST' : '')).trim();

            let filledDogumYeri = false;
            let filledVerenMakam = false;

            if (customDogumYeri && dogumYeriAciklamasi) {
                if (await simulateInput(dogumYeriAciklamasi, customDogumYeri)) {
                    successCount++;
                    filledDogumYeri = true;
                }
            }

            if (customVerenMakam && verenMakam) {
                if (await simulateInput(verenMakam, customVerenMakam)) {
                    successCount++;
                    filledVerenMakam = true;
                }
            }

            // Değerler portaldan gelmediyse ülke bazlı akıllı şablonları uygula
            if (!filledDogumYeri || !filledVerenMakam) {
                if (isTurkmen) {
                    if (!filledDogumYeri && dogumYeriAciklamasi && (await simulateInput(dogumYeriAciklamasi, 'TKM'))) successCount++;
                    if (!filledVerenMakam && verenMakam && (await simulateInput(verenMakam, 'SMST'))) successCount++;
                } 
                else if (uyrukNorm.includes('afgan') || dogumNorm.includes('afgan')) {
                    if (!filledDogumYeri && dogumYeriAciklamasi && !dogumYeriAciklamasi.value) {
                        if (await simulateInput(dogumYeriAciklamasi, 'AFG')) successCount++;
                    }
                    if (!filledVerenMakam && verenMakam && (await simulateInput(verenMakam, 'AFGHAN'))) successCount++;
                } 
                else if (uyrukNorm.includes('pakistan') || dogumNorm.includes('pakistan')) {
                    if (!filledDogumYeri && dogumYeriAciklamasi && !dogumYeriAciklamasi.value) {
                        if (await simulateInput(dogumYeriAciklamasi, 'PAK')) successCount++;
                    }
                    if (!filledVerenMakam && verenMakam && (await simulateInput(verenMakam, 'PAKISTAN'))) successCount++;
                }
            }
            
            const telefonNoInput = findTargetElementByFuzzyLabel('Telefon No', 'input');
            if (await simulateInput(telefonNoInput, '5327892361')) successCount++;

            const belgeNoInput = findBelgeNoInMainPanel();
            if (await simulateInput(belgeNoInput, data.pasaportNo)) successCount++;

            const issueDateInput = findTargetElementByFuzzyLabels([
                'Belge Düzenleme Tarihi',
                'Düzenleme Tarihi',
                'Belgenin Düzenleme Tarihi',
                'Belge Düzenlenme Tarihi',
                'Düzenlenme Tarihi',
                'Belgenin Düzenlenme Tarihi',
                'Pasaport Düzenleme Tarihi',
                'Pasaport Düzenlenme Tarihi',
                'Pasaport Veriliş Tarihi',
                'Belge Veriliş Tarihi',
                'Veriliş Tarihi',
                'Tanzim Tarihi',
                'Date of Issue',
                'Issue Date'
            ], 'input');
            const expiryDateInput = findTargetElementByFuzzyLabels([
                'Belge Geçerlilik Tarihi',
                'Geçerlilik Tarihi',
                'Belgenin Geçerlilik Tarihi',
                'Pasaport Son Geçerlilik Tarihi',
                'Pasaport Geçerlilik Tarihi',
                'Son Geçerlilik Tarihi',
                'Bitiş Tarihi',
                'Date of Expiry',
                'Expiry Date',
                'Expiration Date'
            ], 'input');

            if (issueDateInput && data.issueDate
                && (await simulateDateboxInput(issueDateInput, formatDateForYoksisInput(issueDateInput, data.issueDate)))) {
                successCount++;
            }
            if (expiryDateInput && data.expiryDate
                && (await simulateDateboxInput(expiryDateInput, formatDateForYoksisInput(expiryDateInput, data.expiryDate)))) {
                successCount++;
            }

            // Gerçek kullanıcı tıklaması ve odaklanma geçişi zinciri (Anne Adı ve Baba Adı öncelikli metin kutuları)
            const priorityElements = [
                anneAdiInput,
                babaAdiInput,
                dogumYeriAciklamasi,
                verenMakam,
                telefonNoInput,
                belgeNoInput
            ].filter(Boolean);

            for (const el of priorityElements) {
                try {
                    el.focus();
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    await new Promise(r => setTimeout(r, 40));
                    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    el.blur();
                    el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
                    await new Promise(r => setTimeout(r, 20));
                } catch (_) {}
            }

            // Fotoğraf otomatik yükleme (Kırpılmış vesikalık varsa YÖKSİS'e yükle)
            if (data.croppedPhotoBase64) {
                try {
                    photoUploaded = await uploadPhotoToYoksis(data.croppedPhotoBase64, data.photoFileName);
                    if (photoUploaded) successCount++;
                } catch (photoErr) {
                    console.warn('[YKN] Fotoğraf yükleme hatası (content script):', photoErr);
                }
            }

            if (successCount > 0) {
                sendResponse({ success: true, photoUploaded });
            } else {
                sendResponse({ success: false, message: "Hedef inputlar bulunamadı." });
            }
        });
        return true;
    }

    else if (request.action === "UPLOAD_PHOTO") {
        uploadPhotoToYoksis(request.photoBase64, request.fileName)
            .then(success => sendResponse({ success }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    
    else if (request.action === 'SEARCH_IN_APPLY' || request.action === 'searchStudent') {
        const passportNo = (request.passportNo || '').trim();
        const requestId = request.requestId;
        const cleanPassport = passportNo.toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
        
        // Apply Topkapı'daki arama kutusunu bul (Daha spesifik seçiciler)
        const searchInput = document.querySelector('.inputDatatableSearch') ||
                            document.querySelector('input[placeholder*="Tabloda ara"]') ||
                            document.querySelector('input[type="search"]') || 
                            document.querySelector('.dataTables_filter input') || 
                            document.querySelector('input.form-control');
        
        if (searchInput) {
            simulateInput(searchInput, passportNo);
            
            // Sonuçların gelmesini bekle (Polling ile - Pasaport eşleşmesi kontrol edilir)
            let attempts = 0;
            const maxAttempts = 24; // 24 * 500ms = 12 saniye
            
            const intervalId = setInterval(() => {
                if (typeof chrome === 'undefined' || !chrome?.runtime?.id) {
                    clearInterval(intervalId);
                    return;
                }
                attempts++;
                const rows = document.querySelectorAll('table tbody tr');
                let matchingRow = null;
                let isEmptyMessage = false;
                
                for (let i = 0; i < rows.length; i++) {
                    const rowText = rows[i].innerText.toLocaleLowerCase('tr-TR');
                    if (rowText.includes('no matching') || rowText.includes('bulunamadı') || rowText.includes('no data') || rows[i].classList.contains('dataTables_empty')) {
                        isEmptyMessage = true;
                        continue;
                    }
                    
                    // Pasaport numarası satırın içinde yer alıyor mu?
                    const normalizedRow = rowText.replace(/\s+/g, '');
                    if (cleanPassport && normalizedRow.includes(cleanPassport)) {
                        matchingRow = rows[i];
                        break;
                    }
                }
                
                if (matchingRow) {
                    clearInterval(intervalId);
                    const adCell = matchingRow.querySelector('td:nth-child(2)');
                    const soyadCell = matchingRow.querySelector('td:nth-child(3)');
                    
                    let fullName = "Öğrenci";
                    if (adCell && soyadCell) {
                        fullName = (adCell.innerText.trim() + " " + soyadCell.innerText.trim()).trim();
                    } else if (adCell) {
                        fullName = adCell.innerText.trim();
                    }

                    const profileUrl = findStudentProfileUrl(matchingRow);
                    
                    const studentData = {
                        fullName: fullName,
                        passportNo: passportNo,
                        profileUrl,
                        profileReady: true,
                        documentsReady: false
                    };
                    
                    sendApplyEvent('STUDENT_FOUND', requestId, { data: studentData });
                    if (profileUrl) {
                        sendApplyEvent('OPEN_STUDENT_PROFILE', requestId, { profileUrl });
                    } else {
                        sendApplyEvent('DOCUMENTS_NOT_FOUND', requestId, {
                            error: 'Öğrenci profiline geçiş bağlantısı bulunamadı.'
                        });
                    }
                } else if (isEmptyMessage && attempts >= 6) {
                    clearInterval(intervalId);
                    sendApplyEvent(
                        'STUDENT_NOT_FOUND',
                        requestId,
                        { error: 'Apply Topkapı üzerinde pasaport (' + passportNo + ') ile kayıt bulunamadı.' }
                    );
                } else if (attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    sendApplyEvent(
                        'STUDENT_NOT_FOUND',
                        requestId,
                        { error: isEmptyMessage ? 'Tablo boş (Öğrenci bulunamadı).' : 'Arama zaman aşımına uğradı (' + passportNo + ' bulunamadı).' }
                    );
                }
            }, 500);
        } else {
            sendApplyEvent(
                'STUDENT_NOT_FOUND',
                requestId,
                { error: 'Arama kutusu (.inputDatatableSearch veya form-control) sayfada bulunamadı.' }
            );
        }
        sendResponse({ success: true, requestId });
        return true;
    }
    });
}
})();
