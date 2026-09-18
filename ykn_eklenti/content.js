// content.js
(() => {
if (location.hostname === 'apply.topkapi.edu.tr' && window !== window.top) return;
const CONTENT_SCRIPT_VERSION = '1.2.63';
if (window.__YKN_CONTENT_LOADED__ && window.__YKN_CONTENT_VERSION__ === CONTENT_SCRIPT_VERSION) return;
window.__YKN_CONTENT_LOADED__ = true;
window.__YKN_CONTENT_VERSION__ = CONTENT_SCRIPT_VERSION;
const FIXED_YOKSIS_PHONE = '5322431261';
// Arama komutunu portala hızlıca bildirmek için ilk form hazır olma kontrolü
// kısa tutulur. Form gecikirse background bunu beklemede başarılı kabul eder;
// son doldurma adımı YÖKSİS sekmesini öne alıp daha uzun süre tekrar bekler.
const YOKSIS_SEARCH_INITIAL_FORM_WAIT_MS = 1_500;

// YÖKSİS aynı öğrenci formunu aynı id ve boş değerlerle yeniden üretebiliyor.
// Bu nedenle yalnızca alan parmak izine bakmak, önceki öğrencinin formunu yeni
// aramanın sonucu sanmaya yol açar. ZK postback'inin gerçekten DOM'u güncellediğini
// de izliyoruz. Sayaç content-script yaşamı boyunca korunur.
let yoksisDomRevision = 0;
const observedYoksisRoots = new WeakSet();

function observeYoksisDomChanges() {
    if (getPageKind() !== 'yoksis' || typeof MutationObserver === 'undefined') return;
    for (const doc of getAllDocs(document)) {
        if (!doc) continue;
        const root = doc.documentElement || doc.body;
        if (!root) continue;
        // ZK bazı geçişlerde aynı Document altında documentElement'i tamamen
        // yeniden kuruyor. Document'i değil root düğümünü izlemek, yeni kökte
        // MutationObserver'ı tekrar kurup ikinci öğrencinin form değişimini
        // yakalamamızı sağlar.
        if (observedYoksisRoots.has(root)) continue;
        const observer = new MutationObserver(() => {
            yoksisDomRevision += 1;
        });
        observer.observe(root, { childList: true, subtree: true });
        observedYoksisRoots.add(root);
    }
}

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

async function simulateInput(element, value, options = {}) {
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
        // Önceki aramanın değeri ZK'nin istemci tarafı tamponunda kalabiliyor.
        // Değeri tek onChange ile göndermeden önce native alanda temizleyip yeni
        // değeri koymak, birleşmiş "eski+yeni" kod ihtimalini ortadan kaldırır.
        nativeSetter.call(element, '');
        nativeSetter.call(element, value);
    } else {
        element.value = '';
        element.value = value;
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    // Metin alanlarının tamamında Enter göndermek özellikle ZK formlarında
    // istenmeyen onOK/postback üretir. Arama gibi Enter gerektiren çağrılar
    // bunu açıkça options.pressEnter ile istemelidir.
    if (options.pressEnter === true) {
        const enterEventOptions = {
            bubbles: true,
            composed: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            view: win
        };
        // Apply listesindeki arama bileşeni keypress/keyup dinleyebildiği
        // için tam Enter zincirini gönder. Sadece keydown + keyup gönderimi
        // bazı sürümlerde tabloyu filtrelemiyordu.
        element.dispatchEvent(new KeyboardEvent('keydown', enterEventOptions));
        element.dispatchEvent(new KeyboardEvent('keypress', enterEventOptions));
        element.dispatchEvent(new KeyboardEvent('keyup', enterEventOptions));
    }
    
    let zkChangeSent = false;
    if (win.zk && win.zk.Widget) {
        try {
            const w = win.zk.Widget.$(element);
            if (w) {
                if (typeof w.setValue === 'function') w.setValue(value);
                w._value = value;
                w._lastValue = value;
                if (typeof w.fire === 'function') {
                    w.fire('onChange', { value }, { toServer: true });
                    zkChangeSent = true;
                }
            }
        } catch (_) {}
    }
    if (!zkChangeSent && win.zAu && typeof win.zAu.send === 'function' && win.zk?.Widget) {
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
    const win = element.ownerDocument?.defaultView || window;
    try {
        element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } catch (_) {}

    try { element.focus(); } catch (_) {}

    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(element, formattedDate);
    } else {
        element.value = formattedDate;
    }

    element.setAttribute('value', formattedDate);
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // YÖKSİS tarih kutuları ZK widget'ıdır; yalnızca DOM value yazmak
    // sunucu tarafındaki değeri güncellemez.
    try {
        if (win.zk && win.zk.Widget) {
            const widget = win.zk.Widget.$(element);
            if (widget) {
                // Varsa önceki geçici ezmeleri temizle; böylece kullanıcı kutuyu sildiğinde
                // veya elle yeni bir tarih yazdığında ZK prototipi gerçek DOM değerini okur.
                delete widget.coerceFromString_;
                delete widget.coerceToString_;
                delete widget.getValue;
                delete widget.getText;
                delete widget.getRawValue;

                widget._lastValue = '';
                widget._defRawVal = formattedDate;
                widget._lastChg = formattedDate;
                widget._shallSubmit = true;

                try {
                    if (typeof widget.coerceFromString_ === 'function') {
                        widget._value = widget.coerceFromString_(formattedDate);
                    } else {
                        widget._value = formattedDate;
                    }
                } catch (_) {
                    widget._value = formattedDate;
                }

                if (widget.$n('real')) {
                    widget.$n('real').value = formattedDate;
                }
                if (typeof widget.setText === 'function') {
                    try { widget.setText(formattedDate); } catch (_) {}
                }

                if (typeof widget.clearErrorMessage === 'function') {
                    try { widget.clearErrorMessage(true); } catch (_) {}
                }
                if (widget._errmsg) {
                    try { widget._errmsg.close(); } catch (_) {}
                    try { widget._errmsg.detach(); } catch (_) {}
                    widget._errmsg = null;
                }

                if (typeof widget.updateChange_ === 'function') {
                    try { widget.updateChange_(); } catch (_) {}
                }

                let zkSent = false;
                if (typeof widget.fire === 'function') {
                    try {
                        widget.fire('onChange', {
                            rawValue: formattedDate,
                            value: formattedDate,
                            start: formattedDate.length
                        }, { toServer: true });
                        zkSent = true;
                    } catch (_) {}
                }
                if (!zkSent && win.zAu && typeof win.zAu.send === 'function') {
                    try {
                        win.zAu.send(new win.zk.Event(widget, 'onChange', {
                            rawValue: formattedDate,
                            value: formattedDate,
                            start: formattedDate.length
                        }, { toServer: true }));
                        zkSent = true;
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}

    element.classList.remove('z-datebox-invalid');
    const parentBox = element.closest('.z-datebox');
    if (parentBox) {
        parentBox.classList.remove('z-datebox-invalid');
    }
    try {
        const errorBoxes = (element.ownerDocument || document).querySelectorAll('.z-errorbox, [class*="errorbox"]');
        for (const eb of errorBoxes) eb.remove();
    } catch (_) {}

    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
    try { element.blur(); } catch (_) {}
    return String(element.value || '') === String(formattedDate);
}

// ZK Framework için Event Dispatcher (Select/Dropdown'lar için)
function normalizeCountryText(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

// Apply profili ülke adlarını İngilizce, YÖKSİS ise Türkçe döndürebilir.
// Aynı ülkenin iki yazımı tek bir aday kümesinde eşleştirilir.
const COUNTRY_ALIAS_GROUPS = [
    ['afghanistan', 'afganistan'],
    ['albania', 'arnavutluk'],
    ['azerbaijan', 'azerbaycan'],
    ['bosniaandherzegovina', 'bosnahersek'],
    ['bulgaria', 'bulgaristan'],
    ['china', 'cin'],
    ['croatia', 'hirvatistan'],
    ['egypt', 'misir'],
    ['georgia', 'gurcistan'],
    ['greece', 'yunanistan'],
    ['india', 'hindistan'],
    ['iran', 'iran'],
    ['iraq', 'irak'],
    ['kazakhstan', 'kazakistan'],
    ['kyrgyzstan', 'kirgizistan'],
    ['lebanon', 'lubnan'],
    ['libya', 'libya'],
    ['morocco', 'fas'],
    ['nigeria', 'nijerya'],
    ['northmacedonia', 'kuzeymakedonya'],
    ['pakistan', 'pakistan'],
    ['palestine', 'filistin'],
    ['romania', 'romanya'],
    ['russia', 'rusya'],
    ['saudiarabia', 'suudiarabistan'],
    ['somalia', 'somali'],
    ['sudan', 'sudan'],
    ['syria', 'suriye'],
    ['tajikistan', 'tacikistan'],
    ['turkmenistan', 'turkmenistan'],
    ['ukraine', 'ukrayna'],
    ['unitedarabemirates', 'birlesikarapemirlikleri'],
    ['unitedkingdom', 'birlesikkrallik'],
    ['unitedstates', 'amerika'],
    ['uzbekistan', 'ozbekistan'],
    ['yemen', 'yemen'],
    ['zimbabwe', 'zimbabwe']
];

function countryNameVariants(value) {
    const normalized = normalizeCountryText(value);
    if (!normalized) return [];
    const group = COUNTRY_ALIAS_GROUPS.find((aliases) => aliases.includes(normalized));
    return group ? Array.from(new Set(group)) : [normalized];
}

function simulateSelect(element, textToMatch) {
    if (!element || !textToMatch) return false;
    let found = false;
    const targetVariants = countryNameVariants(textToMatch);

    const options = element.options || [];
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const optionVariants = countryNameVariants(option.text || option.value);
        if (targetVariants.some((target) => optionVariants.some((candidate) =>
            candidate === target || candidate.includes(target) || target.includes(candidate)
        ))) {
            element.selectedIndex = i;
            try { option.selected = true; } catch (_) {}
            element.value = option.value;
            found = true;
            break;
        }
    }
    if (found) {
        try {
            element.focus();
            element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
        } catch (_) {}
        return true;
    }
    return false;
}

function getSelectedOptionText(element) {
    if (!element || !element.options) return '';
    const option = element.options[element.selectedIndex];
    return (option?.text || option?.value || '').trim();
}

// ZK Framework ve HTML için Kullanıcı Tıklaması Simülatörü
function simulateUserClick(element) {
    if (!element) return;
    const doc = element.ownerDocument || document;
    const win = doc.defaultView || window;

    try { element.focus(); } catch (_) {}

    const eventOptions = { bubbles: true, cancelable: true, view: win, buttons: 1 };
    try { element.dispatchEvent(new win.PointerEvent('pointerdown', eventOptions)); } catch (_) {}
    try { element.dispatchEvent(new win.MouseEvent('mousedown', eventOptions)); } catch (_) {}
    try { element.dispatchEvent(new win.PointerEvent('pointerup', eventOptions)); } catch (_) {}
    try { element.dispatchEvent(new win.MouseEvent('mouseup', eventOptions)); } catch (_) {}
    try {
        element.click();
    } catch (_) {
        element.dispatchEvent(new win.MouseEvent('click', eventOptions));
    }
}

function findGenderControls(rootDoc) {
    const d = rootDoc || document;
    const normalize = (str) => (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*:\s]/g, '');

    const result = {
        maleRadio: null,
        maleLabel: null,
        maleWrapper: null,
        femaleRadio: null,
        femaleLabel: null,
        femaleWrapper: null
    };

    const allLabels = d.querySelectorAll('label, .z-radio-content, .z-radio, span, b, strong');
    for (const el of allLabels) {
        if (el.querySelectorAll('input[type="radio"]').length > 1) continue;
        const t = normalize(el.innerText || el.textContent || '');
        if (t === 'erkek' || t === 'bay' || t === 'male' || t === 'm') {
            if (!result.maleLabel || el.tagName === 'LABEL') {
                result.maleLabel = el;
                const forId = el.getAttribute('for');
                let radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                if (radio) {
                    result.maleRadio = radio;
                    result.maleWrapper = el.closest?.('.z-radio') || el.parentElement;
                }
            }
        } else if (t === 'kadin' || t === 'bayan' || t === 'female' || t === 'f') {
            if (!result.femaleLabel || el.tagName === 'LABEL') {
                result.femaleLabel = el;
                const forId = el.getAttribute('for');
                let radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                if (radio) {
                    result.femaleRadio = radio;
                    result.femaleWrapper = el.closest?.('.z-radio') || el.parentElement;
                }
            }
        }
    }

    if (!result.maleRadio || !result.femaleRadio) {
        const allRadios = d.querySelectorAll('input[type="radio"]');
        for (const r of allRadios) {
            const parentText = normalize(r.parentElement ? r.parentElement.innerText : '');
            const nextText = normalize(r.nextElementSibling ? r.nextElementSibling.innerText : '');
            const combined = normalize([r.value, r.id, r.name, parentText, nextText].join(' '));
            if (!result.maleRadio && (combined.includes('erkek') || r.value === 'E' || r.value === '1')) {
                result.maleRadio = r;
                result.maleWrapper = r.closest?.('.z-radio') || r.parentElement;
                if (!result.maleLabel) result.maleLabel = r.nextElementSibling || r.parentElement;
            } else if (!result.femaleRadio && (combined.includes('kadin') || r.value === 'K' || r.value === '2')) {
                result.femaleRadio = r;
                result.femaleWrapper = r.closest?.('.z-radio') || r.parentElement;
                if (!result.femaleLabel) result.femaleLabel = r.nextElementSibling || r.parentElement;
            }
        }
    }

    return result;
}

function findMaritalControls(doc) {
    const d = doc || document;
    const normalize = (str) => (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*:\s]/g, '');

    const result = {
        singleRadio: null,
        singleLabel: null,
        singleWrapper: null,
        marriedRadio: null,
        marriedLabel: null,
        marriedWrapper: null
    };

    const allLabels = d.querySelectorAll('label, .z-radio-content, .z-radio, span, b, strong');
    for (const el of allLabels) {
        if (el.querySelectorAll('input[type="radio"]').length > 1) continue;
        const t = normalize(el.innerText || el.textContent || '');
        if (t === 'bekar' || t === 'single' || t === 'b') {
            if (!result.singleLabel || el.tagName === 'LABEL') {
                result.singleLabel = el;
                const forId = el.getAttribute('for');
                let radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                if (radio) {
                    result.singleRadio = radio;
                    result.singleWrapper = el.closest?.('.z-radio') || el.parentElement;
                }
            }
        } else if (t === 'evli' || t === 'married' || t === 'e') {
            if (!result.marriedLabel || el.tagName === 'LABEL') {
                result.marriedLabel = el;
                const forId = el.getAttribute('for');
                let radio = forId ? d.getElementById(forId) : el.querySelector('input[type="radio"]');
                if (!radio && el.parentElement) radio = el.parentElement.querySelector('input[type="radio"]');
                if (!radio && el.closest) radio = el.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                if (radio) {
                    result.marriedRadio = radio;
                    result.marriedWrapper = el.closest?.('.z-radio') || el.parentElement;
                }
            }
        }
    }

    if (!result.singleRadio || !result.marriedRadio) {
        const allRadios = d.querySelectorAll('input[type="radio"]');
        for (const r of allRadios) {
            const parentText = normalize(r.parentElement ? r.parentElement.innerText : '');
            const nextText = normalize(r.nextElementSibling ? r.nextElementSibling.innerText : '');
            const combined = normalize([r.value, r.id, r.name, parentText, nextText].join(' '));
            if (!result.singleRadio && (combined.includes('bekar') || r.value === 'B' || r.value === '1')) {
                result.singleRadio = r;
                result.singleWrapper = r.closest?.('.z-radio') || r.parentElement;
                if (!result.singleLabel) result.singleLabel = r.nextElementSibling || r.parentElement;
            } else if (!result.marriedRadio && (combined.includes('evli') || r.value === 'E' || r.value === '2')) {
                result.marriedRadio = r;
                result.marriedWrapper = r.closest?.('.z-radio') || r.parentElement;
                if (!result.marriedLabel) result.marriedLabel = r.nextElementSibling || r.parentElement;
            }
        }
    }

    return result;
}

// ZK Framework için Event Dispatcher (Radio Button'lar için)
function simulateRadioByLabelText(labelText) {
    if (!labelText) return false;
    const normalize = (str) => (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*:\s]/g, '');
    const normVal = normalize(labelText);
    const isMale = normVal === 'erkek' || normVal === 'bay' || normVal === 'male' || normVal === 'm';
    const isFemale = normVal === 'kadin' || normVal === 'bayan' || normVal === 'female' || normVal === 'f';
    const isGender = isMale || isFemale;
    const isBekar = normVal === 'bekar' || normVal === 'single' || normVal === 'b';
    const isEvli = normVal === 'evli' || normVal === 'married' || normVal === 'e';
    const isMarital = isBekar || isEvli;

    let anySet = false;
    for (const doc of getAllDocs(document)) {
        if (isGender || isMarital) {
            const ctrl = isGender ? findGenderControls(doc) : findMaritalControls(doc);
            const targetRadio = isGender
                ? (isMale ? ctrl.maleRadio : ctrl.femaleRadio)
                : (isBekar ? ctrl.singleRadio : ctrl.marriedRadio);
            const targetLabel = isGender
                ? (isMale ? ctrl.maleLabel : ctrl.femaleLabel)
                : (isBekar ? ctrl.singleLabel : ctrl.marriedLabel);
            const targetWrapper = isGender
                ? (isMale ? ctrl.maleWrapper : ctrl.femaleWrapper)
                : (isBekar ? ctrl.singleWrapper : ctrl.marriedWrapper);

            const oppRadio = isGender
                ? (isMale ? ctrl.femaleRadio : ctrl.maleRadio)
                : (isBekar ? ctrl.marriedRadio : ctrl.singleRadio);
            const oppLabel = isGender
                ? (isMale ? ctrl.femaleLabel : ctrl.maleLabel)
                : (isBekar ? ctrl.marriedLabel : ctrl.singleLabel);
            const oppWrapper = isGender
                ? (isMale ? ctrl.femaleWrapper : ctrl.maleWrapper)
                : (isBekar ? ctrl.marriedWrapper : ctrl.singleWrapper);

            if (targetRadio || targetLabel) {
                if (oppRadio) {
                    oppRadio.checked = false;
                }
                if (oppWrapper && oppWrapper.classList) {
                    oppWrapper.classList.remove('z-radio-checked', 'z-radio-on');
                }

                if (targetLabel) simulateUserClick(targetLabel);
                else if (targetWrapper) simulateUserClick(targetWrapper);
                else if (targetRadio) simulateUserClick(targetRadio);

                if (targetRadio) {
                    targetRadio.checked = true;
                    try { targetRadio.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
                    try { targetRadio.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                }
                if (targetWrapper && targetWrapper.classList) {
                    targetWrapper.classList.add('z-radio-checked');
                }
                anySet = true;
                continue;
            }
        }

        const labels = doc.querySelectorAll('label, span, b, strong');
        for (const lbl of labels) {
            const text = normalize(lbl.innerText || lbl.textContent || '');
            if (text === normVal || (text.length > 0 && text.startsWith(normVal))) {
                const forId = lbl.getAttribute('for');
                let radio = forId ? doc.getElementById(forId) : null;
                if (!radio) {
                    radio = lbl.querySelector('input[type="radio"]')
                        || lbl.parentElement?.querySelector('input[type="radio"]')
                        || lbl.closest('.z-radio, tr, td, div')?.querySelector('input[type="radio"]');
                }
                if (radio) {
                    simulateUserClick(lbl);
                    radio.checked = true;
                    simulateUserClick(radio);
                    try { radio.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                    anySet = true;
                    break;
                }
            }
        }
        if (!anySet) {
            const radios = doc.querySelectorAll('input[type="radio"]');
            for (const radio of radios) {
                const radioText = normalize([radio.value, radio.id, radio.name].join(' '));
                if (radioText === normVal || radioText.includes(normVal)) {
                    radio.checked = true;
                    simulateUserClick(radio);
                    try { radio.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                    anySet = true;
                    break;
                }
            }
        }
    }
    return anySet;
}

// Kaynak Sistem - Etiket metni ile açılır liste okuyucu
function getSourceDropdownByLabel(substring) {
    const labels = document.querySelectorAll('label, dt, th, span, strong, b');
    const subLower = substring.toLocaleLowerCase('tr-TR');
    for (const label of labels) {
        const text = (label.innerText || label.textContent || '').toLocaleLowerCase('tr-TR');
        if (text.includes(subLower)) {
            const container = label.closest('.form-group, .mb-3, .form-item, .field, .col, [class*="col-"], tr, li, dl') || label.parentElement;
            if (!container) continue;
            const select = container.querySelector('select');
            if (select && select.options.length > 0 && select.selectedIndex >= 0) {
                return select.options[select.selectedIndex].text.trim();
            }
            const select2Span = container.querySelector('.select2-selection__rendered, .filter-option-inner-inner, .form-select, [role="combobox"]');
            if (select2Span) {
                return (select2Span.innerText || select2Span.textContent || '').trim();
            }
        }
    }
    return '';
}

function normalizeGenderValue(val) {
    if (!val || typeof val !== 'string') return '';
    const v = val.trim().toLocaleLowerCase('tr-TR');
    if (v === 'erkek' || v === 'male' || v === 'e' || v === 'm' || v === 'man' || v === 'boy' || v === '1') return 'Erkek';
    if (v === 'kadın' || v === 'kadin' || v === 'female' || v === 'k' || v === 'f' || v === 'woman' || v === 'girl' || v === '2') return 'Kadın';
    return '';
}

function extractGenderFromApply() {
    // 1. Doğrudan select elemanları (name/id içinde gender, cinsiyet, sex)
    const directSelects = document.querySelectorAll('select[name*="gender" i], select[name*="cinsiyet" i], select[id*="gender" i], select[id*="cinsiyet" i], select[name*="sex" i]');
    for (const sel of directSelects) {
        if (sel.options && sel.options.length > 0 && sel.selectedIndex >= 0) {
            const opt = sel.options[sel.selectedIndex];
            const txt = normalizeGenderValue(opt.text) || normalizeGenderValue(opt.value);
            if (txt) return txt;
        }
    }

    // 2. Doğrudan seçili radyo butonları
    const checkedRadios = document.querySelectorAll('input[type="radio"]:checked');
    for (const radio of checkedRadios) {
        const nameOrId = (radio.name + ' ' + radio.id).toLowerCase();
        if (nameOrId.includes('gender') || nameOrId.includes('cinsiyet') || nameOrId.includes('sex')) {
            const lbl = document.querySelector(`label[for="${radio.id}"]`) || radio.closest('label') || radio.parentElement;
            const text = normalizeGenderValue(lbl?.innerText || radio.value);
            if (text) return text;
        }
    }

    // 3. Etiket metni ("Cinsiyet", "Cinsiyeti", "Gender", "Sex") içeren form alanı
    const candidateNodes = document.querySelectorAll('label, dt, th, span, div, strong, b');
    for (const node of candidateNodes) {
        const rawText = (node.innerText || node.textContent || '').trim();
        const clean = rawText.toLocaleLowerCase('tr-TR').replace(/[*:\s]/g, '');
        if (clean === 'cinsiyet' || clean === 'cinsiyeti' || clean === 'gender' || clean === 'sex') {
            const container = node.closest('.form-group, .mb-3, .form-item, .field, .col, [class*="col-"], tr, li, dl') || node.parentElement;
            if (container) {
                const sel = container.querySelector('select');
                if (sel && sel.options && sel.options.length > 0 && sel.selectedIndex >= 0) {
                    const opt = sel.options[sel.selectedIndex];
                    const txt = normalizeGenderValue(opt.text) || normalizeGenderValue(opt.value);
                    if (txt) return txt;
                }
                const rendered = container.querySelector('.select2-selection__rendered, .filter-option-inner-inner, .form-select, .ant-select-selection-item, [role="combobox"]');
                if (rendered) {
                    const txt = normalizeGenderValue(rendered.innerText || rendered.textContent);
                    if (txt) return txt;
                }
                const checkedRadio = container.querySelector('input[type="radio"]:checked');
                if (checkedRadio) {
                    const rLbl = document.querySelector(`label[for="${checkedRadio.id}"]`) || checkedRadio.closest('label') || checkedRadio.parentElement;
                    const txt = normalizeGenderValue(rLbl?.innerText || checkedRadio.value);
                    if (txt) return txt;
                }
                const inp = container.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])');
                if (inp && inp.value) {
                    const txt = normalizeGenderValue(inp.value);
                    if (txt) return txt;
                }
                const clone = container.cloneNode(true);
                const labelsInClone = clone.querySelectorAll('label, dt, th, strong');
                for (const l of labelsInClone) l.remove();
                const containerText = (clone.innerText || clone.textContent || '');
                if (/erkek/i.test(containerText)) return 'Erkek';
                if (/kadın|kadin|female/i.test(containerText)) return 'Kadın';
            }
        }
    }

    // 4. Yedek arama
    const fallback = getSourceDropdownByLabel('Cinsiyet') || findApplyFieldValue(['Cinsiyet', 'Cinsiyeti', 'Gender', 'Sex']);
    return normalizeGenderValue(fallback) || (fallback ? fallback.trim() : '');
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

function getYoksisClickableSelector() {
    // ZK sürümleri butonu bazen table, bazen td/span olarak üretir.
    return 'button, a, input[type="button"], input[type="submit"], [role="button"], .z-button, [class*="z-button"]';
}

// ZK, arama tamamlandıktan sonra önceki bileşeni DOM'da gizli bırakabiliyor.
// İkinci öğrencide querySelector'ın bu eski inputu/butonu seçmesi, kod ekranda
// yazılmış gibi görünse de sunucuya yeni aramanın hiç gitmemesine yol açıyordu.
function isYoksisControlUsable(element) {
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

function getYoksisClickableText(element) {
    return normalizeYoksisText(
        element?.innerText
        || element?.textContent
        || element?.value
        || element?.getAttribute?.('aria-label')
        || element?.getAttribute?.('title')
        || ''
    );
}

function getYoksisClickableRoot(element) {
    if (!element) return null;
    // ZK'nin görsel parçası td.z-button-cm/td.z-button-cl olsa da gerçek
    // click listener çoğunlukla üst table.z-button üzerindedir.
    const nestedTableRoot = element.querySelector?.('table.z-button');
    if (nestedTableRoot) return nestedTableRoot;
    const tableRoot = element.closest('table.z-button');
    if (tableRoot) return tableRoot;
    return element.closest(`button, a, [role="button"], .z-button, [class*="z-button"]`) || element;
}

function findYoksisButtonIn(container) {
    if (!container) return null;
    const clickables = container.querySelectorAll(getYoksisClickableSelector());
    let best = null;
    let bestScore = -1;
    for (const candidate of clickables) {
        if (!isYoksisControlUsable(candidate)) continue;
        const text = getYoksisClickableText(candidate);
        let score = 0;
        if (text.includes('kabul')) score += 100;
        if (text.includes('ara')) score += 80;
        if (text.includes('sorgula')) score += 70;
        if (text.includes('getir') || text.includes('bul')) score += 20;
        if (score > bestScore) {
            best = getYoksisClickableRoot(candidate);
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}

function isYoksisTextInput(element) {
    if (!element) return false;
    const type = (element.getAttribute('type') || '').toLowerCase();
    return type !== 'button' && type !== 'submit' && type !== 'hidden'
        && type !== 'checkbox' && type !== 'radio' && type !== 'file';
}

function findYoksisKabulPair() {
    const allDocs = getAllDocs(document);
    const inputSelector = 'input:not([type="button"]):not([type="submit"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])';

    for (const doc of allDocs) {
        let idInput = null;

        // Önce gerçek input metadata'sına bak. Ekran görüntüsündeki ZK alanı
        // dinamik bir id taşısa da title/placeholder içinde "Kabul Mektup Id"
        // sabit kalıyor.
        const inputCandidates = Array.from(doc.querySelectorAll(inputSelector))
            .map((input) => {
                if (!isYoksisControlUsable(input)) return null;
                const metadata = normalizeYoksisText([
                    input.placeholder,
                    input.getAttribute('placeholder'),
                    input.title,
                    input.name,
                    input.id
                ].join(' '));
                // Canlı YÖKSİS ekranındaki kabul kutusu, örneğin
                // tGDP49-chdextr kimliğiyle üretiliyor. Başlıktaki metin
                // yeniden çizim sırasında kısa süreliğine boşalsa bile bu
                // imzayı, pasaport sorgu alanlarına göre önceliklendir.
                const isAcceptanceEditor = /(?:-|_)chdextr$/i.test(input.id || '');
                if ((!metadata.includes('kabul') && !isAcceptanceEditor)
                    || metadata.includes('pasaport') || metadata.includes('tc') || metadata.includes('dogum')) return null;
                let score = 10;
                if (isAcceptanceEditor) score += 100;
                if (metadata.includes('mektup')) score += 30;
                if (metadata.includes('id')) score += 20;
                return { input, score };
            })
            .filter(Boolean)
            .sort((left, right) => right.score - left.score);
        idInput = inputCandidates[0]?.input || null;

        // Bazı YÖKSİS sürümlerinde placeholder metadata'sı eksik kalıyor;
        // bu durumda etiket ve aynı satırdaki input birlikte kullanılır.
        if (!idInput) {
            for (const row of doc.querySelectorAll('tr')) {
                if (!isYoksisControlUsable(row)) continue;
                const rowText = normalizeYoksisText(row.innerText || row.textContent || '');
                if (!rowText.includes('kabul') || !rowText.includes('id')) continue;
                const candidate = Array.from(row.querySelectorAll(inputSelector))
                    .find((input) => isYoksisTextInput(input) && isYoksisControlUsable(input));
                if (candidate) {
                    idInput = candidate;
                    break;
                }
            }
        }

        if (!idInput) continue;

        // En güvenilir eşleştirme: input ile Kabul Mektup butonunun aynı tr
        // içinde olması. ZK'nin td.z-button-cm gibi sınıfları da kapsanır.
        let searchBtn = findYoksisButtonIn(idInput.closest('tr'));
        if (!searchBtn) {
            let parent = idInput.parentElement;
            let depth = 0;
            while (parent && parent !== doc.body && depth < 7 && !searchBtn) {
                searchBtn = findYoksisButtonIn(parent);
                parent = parent.parentElement;
                depth += 1;
            }
        }

        // Son fallback: sayfadaki kabul arama butonu.
        if (!searchBtn) {
            const allClickables = doc.querySelectorAll(getYoksisClickableSelector());
            for (const candidate of allClickables) {
                if (!isYoksisControlUsable(candidate)) continue;
                const text = getYoksisClickableText(candidate);
                if (text.includes('kabul') && (text.includes('ara') || text.includes('sorgula') || text.includes('getir') || text.includes('bul'))) {
                    searchBtn = getYoksisClickableRoot(candidate);
                    break;
                }
            }
        }

        return { idInput, searchBtn, doc };
    }

    return { idInput: null, searchBtn: null, doc: document };
}

function findKabulIdButton(idInput) {
    if (idInput) {
        const iRow = idInput.closest('tr, .z-row, table, .z-groupbox, div');
        if (iRow) {
            const rowBtns = Array.from(iRow.querySelectorAll('button, .z-button, a, input[type="button"], span.z-button, table.z-button, span.z-button-cm'))
                .filter(isYoksisControlUsable);
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

    // dispatchEvent('click') ve element.click() birlikte kullanıldığında aynı
    // ZK komutu iki kez gönderiliyordu. Native click tek gerçek tıklama olsun.
    try { element.click(); } catch (_) { return false; }

    return true;
}

function triggerZkClick(buttonElement, inputElement, kabulId) {
    if (!buttonElement && !inputElement) return false;
    const targetEl = buttonElement || inputElement;
    const win = targetEl.ownerDocument?.defaultView || window;

    try {
        if (win.zk && win.zk.Widget) {
            if (buttonElement) {
                let wb = win.zk.Widget.$(buttonElement);
                if (!wb && buttonElement.parentElement) {
                    wb = win.zk.Widget.$(buttonElement.parentElement);
                }
                if (wb && typeof wb.fire === 'function') {
                    wb.fire('onClick', null, { toServer: true });
                    return true;
                }
            }
        }
        if (buttonElement) {
            simulateButtonClick(buttonElement);
            return true;
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
            return true;
        }
    } catch (_) {
        return false;
    }
    return false;
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

function waitForYoksisSearchControls(timeoutMs = 12_000) {
    // Yeni açılan YÖKSİS sekmesinde ZK uygulaması oturum ve ekran bileşenlerini
    // birkaç saniye sonra oluşturabiliyor. Kısa sabit süre, Tek Tık akışının
    // kodu yazmadan "alan bulunamadı" hatasıyla bitmesine neden oluyordu.
    const deadline = Date.now() + timeoutMs;
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

function getYoksisFormFingerprint() {
    const parts = [];
    for (const doc of getAllDocs(document)) {
        const controls = doc.querySelectorAll('input, select, textarea');
        for (const control of controls) {
            const type = (control.type || '').toLowerCase();
            if (type === 'hidden' || type === 'button' || type === 'submit') continue;
            const row = control.closest('tr');
            const label = row ? (row.innerText || row.textContent || '') : '';
            const metadata = `${control.id || ''} ${control.name || ''} ${control.placeholder || ''} ${label}`
                .toLocaleLowerCase('tr-TR');
            // Arama kutusuna kabul kodunu yazmak formun değiştiği anlamına
            // gelmez; bu alan imzaya girerse eski öğrenci formu yanlışlıkla
            // yeni sonuç olarak doğrulanır.
            if (metadata.includes('kabul') || metadata.includes('mektup') || metadata.includes('sorgula')) continue;
            parts.push([
                control.id || control.name || control.placeholder || control.type || control.tagName,
                String(control.value || ''),
                String(label).replace(/\s+/g, ' ').trim()
            ].join('|'));
        }
    }
    return parts.join('||');
}

function getYoksisFormState() {
    observeYoksisDomChanges();
    return {
        fingerprint: getYoksisFormFingerprint(),
        domRevision: yoksisDomRevision
    };
}

// Kabul kodu alanının onChange olayı da ZK'de bağımsız bir AU/DOM güncellemesi
// üretebilir. Bu güncelleme arama tıklamasından sonra gelirse eski form yanlış
// biçimde "yeni sonuç" sayılır. Arama öncesi kısa bir sakinleşme penceresi
// bekleyip baseline'ı ancak ondan sonra alıyoruz.
function waitForYoksisSearchControlsToSettle(minimumMs = 900, quietMs = 350, timeoutMs = 3000) {
    observeYoksisDomChanges();
    const startedAt = Date.now();
    let lastRevision = yoksisDomRevision;
    let lastChangeAt = startedAt;

    return new Promise((resolve) => {
        const intervalId = setInterval(() => {
            const now = Date.now();
            if (yoksisDomRevision !== lastRevision) {
                lastRevision = yoksisDomRevision;
                lastChangeAt = now;
            }
            if ((now - startedAt >= minimumMs && now - lastChangeAt >= quietMs) || now - startedAt >= timeoutMs) {
                clearInterval(intervalId);
                resolve();
            }
        }, 100);
    });
}

function waitForYoksisForm(timeoutMs = 6000, options = {}) {
    const deadline = Date.now() + timeoutMs;
    const afterFingerprint = options.afterFingerprint || '';
    const afterDomRevision = Number.isFinite(options.afterDomRevision)
        ? options.afterDomRevision
        : null;
    const requireFreshResult = options.requireFreshResult === true;
    let stableChecks = 0;
    let previousFingerprint = '';
    return new Promise((resolve, reject) => {
        let intervalId;
        const checkForm = () => {
            const formSignals = [
                findTargetElementByFuzzyLabel('Anne Adı', 'input'),
                findTargetElementByFuzzyLabel('Baba Adı', 'input'),
                findBelgeNoInMainPanel(),
                findTargetElementByFuzzyLabel('Uyruğu', 'select'),
                findTargetElementByFuzzyLabel('Cinsiyet', 'input')
            ].filter(Boolean).length;
            const hasPhotoInput = Boolean(findYoksisFileInput(findPhotoUploadButton()));
            const fingerprint = getYoksisFormFingerprint();
            const formChangedAfterSearch = !afterFingerprint || fingerprint !== afterFingerprint;
            const domChangedAfterSearch = afterDomRevision === null || yoksisDomRevision > afterDomRevision;
            // Sonuç formu, önceki formdan alan değeri bakımından ayırt edilemeyebilir.
            // Bu durumda ancak arama tıklamasından sonra gelen ZK DOM güncellemesi
            // yeni bir sonuç olduğuna dair kanıttır.
            const hasFreshSearchResult = requireFreshResult
                ? (formChangedAfterSearch || domChangedAfterSearch)
                : formChangedAfterSearch;
            stableChecks = fingerprint && fingerprint === previousFingerprint ? stableChecks + 1 : 0;
            previousFingerprint = fingerprint;

            // YÖKSİS alanları parça parça oluşturulabildiği için tek bir inputun
            // görünmesi formun gerçekten hazır olduğu anlamına gelmez. Arama
            // sonrasında önceki öğrenci formu hâlâ ekrandaysa onu "hazır"
            // saymamak için formun değişmesini ve iki ardışık kontrolde sabit
            // kalmasını da bekle.
            if ((formSignals >= 2 || (formSignals >= 1 && hasPhotoInput)) &&
                hasFreshSearchResult && stableChecks >= 2) {
                clearInterval(intervalId);
                resolve();
                return;
            }
            if (Date.now() >= deadline) {
                clearInterval(intervalId);
                reject(new Error('YÖKSİS öğrenci bilgi formu açılmadı.'));
            }
        };
        intervalId = setInterval(checkForm, 400);
        checkForm();
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
            if (ph.toLocaleLowerCase('tr-TR').includes('pasaport')) {
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
        .replace(/[*:\s]/g, '');
    const searchWord = normalize(labelText);
    const isAdiSearch = searchWord === 'adi' || searchWord === 'ad' || searchWord === 'ogrenciadi';
    const isSoyadSearch = searchWord === 'soyadi' || searchWord === 'soyad' || searchWord === 'ogrencisoyadi';
    const allDocs = getAllDocs(document);

    for (const doc of allDocs) {
        const allTargets = doc.querySelectorAll(tagName);
        for (const target of allTargets) {
            if (tagName === 'input' && (target.getAttribute('type') || '').toLowerCase() === 'file') {
                continue;
            }
            const row = target.closest('tr');
            if (row) {
                const targetTd = target.closest('td');
                let prevTd = targetTd ? targetTd.previousElementSibling : null;
                while (prevTd) {
                    const prevText = normalize(prevTd.innerText);
                    if (isAdiSearch && (prevText.includes('soyad') || prevText.includes('anne') || prevText.includes('baba') || prevText.includes('foto'))) {
                        prevTd = prevTd.previousElementSibling;
                        continue;
                    }
                    if (isSoyadSearch && (prevText.includes('anne') || prevText.includes('baba'))) {
                        prevTd = prevTd.previousElementSibling;
                        continue;
                    }
                    const matches = isAdiSearch
                        ? (prevText === 'adi' || prevText === 'ad' || prevText === 'ogrenciadi')
                        : (prevText === searchWord || prevText.includes(searchWord));
                    if (matches) {
                        return target;
                    }
                    prevTd = prevTd.previousElementSibling;
                }
            }
        }
        
        // Yeni YÖKSİS kartlarında etiket ve kontrol aynı form grubunda,
        // tablo satırı olmadan yan yana bulunabilir. Kapsayıcıdaki ilk inputu
        // almak yerine etikete komşu veya tekil kontrolü kullan.
        const labelNodes = doc.querySelectorAll('label, span, div, dt, strong, b');
        for (const labelNode of labelNodes) {
            const labelValue = normalize(labelNode.innerText || labelNode.textContent || '');
            if (isAdiSearch && (labelValue.includes('soyad') || labelValue.includes('anne') || labelValue.includes('baba') || labelValue.includes('foto'))) {
                continue;
            }
            if (isSoyadSearch && (labelValue.includes('anne') || labelValue.includes('baba'))) {
                continue;
            }
            const isExplicitLabel = ['LABEL', 'DT', 'STRONG', 'B'].includes(labelNode.tagName);
            const exactMatch = isAdiSearch
                ? (labelValue === 'adi' || labelValue === 'ad' || labelValue === 'ogrenciadi')
                : (labelValue === searchWord);
            const partialMatch = !isAdiSearch && isExplicitLabel && labelValue.includes(searchWord);
            if (!exactMatch && !partialMatch) continue;

            const ownTargets = Array.from(labelNode.querySelectorAll(tagName));
            if (ownTargets.length === 1) return ownTargets[0];
            if (ownTargets.length > 0) continue;

            const nextNode = labelNode.nextElementSibling;
            const nextTarget = nextNode && (nextNode.matches?.(tagName)
                ? nextNode
                : nextNode.querySelector?.(tagName));
            if (nextTarget) return nextTarget;

            const parent = labelNode.parentElement;
            const parentTargets = parent ? Array.from(parent.querySelectorAll(tagName)) : [];
            if (parentTargets.length === 1) return parentTargets[0];
        }

        const elements = Array.from(doc.querySelectorAll('span, div, label')).filter(el => {
            const value = normalize(el.innerText || el.textContent || '');
            if (isAdiSearch && (value.includes('soyad') || value.includes('anne') || value.includes('baba') || value.includes('foto'))) {
                return false;
            }
            if (isSoyadSearch && (value.includes('anne') || value.includes('baba'))) {
                return false;
            }
            const isLeafLike = !el.querySelector(tagName);
            const isMatched = isAdiSearch
                ? (value === 'adi' || value === 'ad' || value === 'ogrenciadi')
                : (value === searchWord);
            return isMatched && isLeafLike && el.children.length <= 2;
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
            if (row) {
                const rowText = normalize(row.innerText);
                if (isAdiSearch && (rowText.includes('soyad') || rowText.includes('anne') || rowText.includes('baba') || rowText.includes('foto'))) {
                    continue;
                }
                if (isSoyadSearch && (rowText.includes('anne') || rowText.includes('baba'))) {
                    continue;
                }
                const matches = isAdiSearch
                    ? (rowText === 'adi' || rowText === 'ad' || rowText === 'ogrenciadi')
                    : rowText.includes(searchWord);
                if (matches) {
                    const rowTargets = Array.from(row.querySelectorAll(tagName));
                    if (rowTargets.length === 1) return target;
                }
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
            const t = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.id || '');
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

    for (const doc of getAllDocs(document)) {
        if (doc === photoBtn.ownerDocument) continue;
        const frameInput = doc.querySelector('input[type="file"]');
        if (frameInput) return frameInput;
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

    // YÖKSİS fotoğraf bileşeni gecikmeli ve bazen iframe içinde oluşturuluyor.
    // Form alanları hazır olsa bile file input birkaç saniye sonra gelebilir.
    for (let attempt = 0; attempt < 100; attempt++) {
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
        if (!fileInput.files || fileInput.files.length === 0) {
            console.warn('[YKN] Fotoğraf dosyası inputa atanamadı.');
            return false;
        }
        fileInput.setAttribute('data-ykn-photo-token', photoToken);
        fileInput.setAttribute('data-ykn-photo-status', 'file_assigned');

        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        if (window.jq) {
            try { window.jq(fileInput).trigger('change'); } catch (_) {}
        }

        if (photoBtn && window.zk && window.zk.Widget) {
            try {
                let widgetElement = photoBtn;
                let w = null;
                // ZK widget çoğu sayfada görünen span/button üzerinde değil,
                // onun ebeveynindeki table/div üzerinde tutuluyor.
                for (let level = 0; level < 6 && widgetElement; level++) {
                    w = window.zk.Widget.$(widgetElement);
                    if (w) break;
                    widgetElement = widgetElement.parentElement;
                }
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
                await simulateInput(fotoAdiInput, fileName);
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
    const clean = code.trim().toUpperCase()
        .replace(/[–—−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '-');
    if (clean.includes('SVG') || clean.includes('ICON') || clean.includes('BTN') || clean.includes('BADGE')) return false;
    if (clean.startsWith('202') || clean.startsWith('19')) return false;
    if (!/^[A-Z0-9]{2,4}-[A-Z0-9]{2,4}-[A-Z0-9]{2,4}$/.test(clean)) return false;
    return /\d/.test(clean);
}

function normalizeYoksisIdValue(value) {
    return String(value || '')
        .trim()
        .replace(/[–—−]/g, '-')
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '-')
        .toUpperCase();
}

function findDirectKabulCode() {
    try {
        const bodyText = document.body ? document.body.innerText : '';
        const labeledMatch = bodyText.match(/(?:YÖKS[İI]S|YOKSIS)\s*(?:ID|KODU|NO|CODE)?\s*[:#\.\-–—]?\s*([A-Z0-9]{2,4}(?:\s*[-–—−]\s*|\s+)[A-Z0-9]{2,4}(?:\s*[-–—−]\s*|\s+)[A-Z0-9]{2,4})/i);
        if (labeledMatch && labeledMatch[1]) {
            const code = normalizeYoksisIdValue(labeledMatch[1]);
            if (isValidYoksisId(code)) {
                return code;
            }
        }
        const yoksisInputs = document.querySelectorAll('input[name*="yoksis" i], input[id*="yoksis" i], [data-yoksis-id]');
        for (const inp of yoksisInputs) {
            const val = inp.value || inp.getAttribute('data-yoksis-id');
            const clean = normalizeYoksisIdValue(val);
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
    const cleanNorm = (str) => (str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[*:\s]/g, '');
    const normalizedLabels = (labels || []).map(cleanNorm).filter(Boolean);
    if (normalizedLabels.length === 0) return '';
    const isAdiSearch = normalizedLabels.some((l) => l === 'ad' || l === 'adi' || l === 'firstname' || l === 'givenname');
    const isSoyadSearch = normalizedLabels.some((l) => l === 'soyad' || l === 'soyadi' || l === 'lastname' || l === 'surname' || l === 'familyname');

    // 1. Check direct table cells
    const rows = document.querySelectorAll('tr');
    for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length < 2) continue;
        const cellText = cleanNorm(cells[0].innerText || cells[0].textContent);
        if (isAdiSearch && (cellText.includes('soyad') || cellText.includes('anne') || cellText.includes('baba'))) continue;
        if (isSoyadSearch && (cellText.includes('anne') || cellText.includes('baba'))) continue;
        const matches = normalizedLabels.some((val) => isAdiSearch ? (cellText === val || cellText === 'ogrenciadi') : (cellText === val || cellText.includes(val)));
        if (matches) {
            const inputInside = cells[1].querySelector('input, select, textarea');
            const value = inputInside ? readFieldValue(inputInside) : cells[1].innerText.trim();
            if (value) return value;
        }
    }

    // 2. Direct input in table cell with prevTd
    const targets = document.querySelectorAll('input, select, textarea');
    for (const target of targets) {
        const targetTd = target.closest('td, th');
        const prevTd = targetTd ? targetTd.previousElementSibling : null;
        if (prevTd) {
            const prevText = cleanNorm(prevTd.innerText || prevTd.textContent);
            if (isAdiSearch && (prevText.includes('soyad') || prevText.includes('anne') || prevText.includes('baba'))) continue;
            if (isSoyadSearch && (prevText.includes('anne') || prevText.includes('baba'))) continue;
            const matches = normalizedLabels.some((val) => isAdiSearch ? (prevText === val || prevText === 'ogrenciadi') : (prevText === val || prevText.includes(val)));
            if (matches) {
                const value = readFieldValue(target);
                if (value) return value;
            }
        }
    }

    // 3. Form labels / containers (strictly excluding .row to prevent cross-field leaking)
    const labelNodes = document.querySelectorAll('label, dt, strong, b, span, div');
    for (const labelNode of labelNodes) {
        const rawText = labelNode.innerText || labelNode.textContent || '';
        const labelText = cleanNorm(rawText);
        if (!labelText) continue;
        if (isAdiSearch && (labelText.includes('soyad') || labelText.includes('anne') || labelText.includes('baba'))) continue;
        if (isSoyadSearch && (labelText.includes('anne') || labelText.includes('baba'))) continue;

        const exactMatch = normalizedLabels.some((val) => labelText === val);
        const isExplicitLabel = ['LABEL', 'DT', 'STRONG', 'B'].includes(labelNode.tagName);
        const partialMatch = isExplicitLabel && normalizedLabels.some((val) => isAdiSearch ? (labelText === val || labelText === 'ogrenciadi') : labelText.includes(val));
        if (!exactMatch && !partialMatch) continue;

        // Try for attribute first
        const forId = labelNode.getAttribute?.('for');
        if (forId) {
            const el = document.getElementById(forId);
            const value = readFieldValue(el);
            if (value) return value;
        }

        // Try input inside label
        const insideInput = labelNode.querySelector?.('input, select, textarea');
        if (insideInput) {
            const value = readFieldValue(insideInput);
            if (value) return value;
        }

        // Try next element sibling
        const next = labelNode.nextElementSibling;
        const nextInput = next ? (next.matches?.('input, select, textarea') ? next : next.querySelector?.('input, select, textarea')) : null;
        if (nextInput) {
            const value = readFieldValue(nextInput);
            if (value) return value;
        }

        // Container (strictly excluding .row to avoid cross-column contamination)
        const container = labelNode.closest('.form-group, .form-floating, .col, [class*="col-"], .field, .input-group, dl, li') || labelNode.parentElement;
        if (container && !container.classList?.contains('row')) {
            const inputs = Array.from(container.querySelectorAll('input, select, textarea'));
            const following = inputs.filter((inp) => (labelNode.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING));
            const target = following.length > 0 ? following[0] : inputs[0];
            const value = readFieldValue(target);
            if (value) return value;
        }
    }
    return '';
}

function findApplyInputValue(selectors) {
    for (const selector of selectors) {
        const target = document.querySelector(selector);
        const value = readFieldValue(target);
        if (value) return value;
    }
    return '';
}

function findApplyStudentData() {
    return {
        firstName: findApplyFieldValue(['Adı', 'Ad', 'First Name', 'Given Name']),
        lastName: findApplyFieldValue(['Soyadı', 'Soyad', 'Last Name', 'Surname', 'Family Name']),
        anneAdi: findApplyFieldValue(['Anne Adı', "Mother's Name", 'Mother Name']),
        babaAdi: findApplyFieldValue(['Baba Adı', "Father's Name", 'Father Name']),
        uyruk: findApplyFieldValue(['Uyruğu', 'Nationality']),
        dogumUlkesi: findApplyFieldValue(['Doğum Yeri Ülkesi', 'Born Country']),
        cinsiyet: extractGenderFromApply(),
        pasaportNo: findApplyFieldValue(['Pasaport No', 'Passport No', 'Number of Document']),
        birthDate: findApplyFieldValue(['Doğum Tarihi', 'Date of Birth', 'Birth Date', 'Doğum Günü']),
        issueDate: findApplyFieldValue(['Belge Düzenleme Tarihi', 'Düzenleme Tarihi', 'Pasaport Düzenleme Tarihi', 'Veriliş Tarihi', 'Date of Issue', 'Issue Date', 'Tanzim Tarihi']),
        expiryDate: findApplyFieldValue(['Belge Geçerlilik Tarihi', 'Geçerlilik Tarihi', 'Pasaport Geçerlilik Tarihi', 'Son Geçerlilik Tarihi', 'Pasaport Bitiş Tarihi', 'Belge Bitiş Tarihi', 'Date of Expiry', 'Expiry Date', 'Expiration Date'])
    };
}

function normalizeApplyBirthDate(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return '';
    const clean = rawDate.replace(/[T\s]\d{1,2}:\d{1,2}(?::\d{1,2})?.*$/, '').trim();
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
    const firstNameInput = document.querySelector([
        'input[name="firstName"]', 'input[name="first_name"]', 'input[name="givenName"]',
        'input[name="ad"]', 'input[name="adi"]', 'input[name="ad_"]',
        'input[id="ad"]', 'input[id="adi"]', 'input[id="firstName"]', 'input[id="first_name"]',
        'input[id*="first" i]', 'input[id*="given-name" i]'
    ].join(','));
    const lastNameInput = document.querySelector([
        'input[name="lastName"]', 'input[name="last_name"]', 'input[name="surname"]',
        'input[name="familyName"]', 'input[name="soyad"]', 'input[name="soyadi"]', 'input[name="soyad_"]',
        'input[id="soyad"]', 'input[id="soyadi"]', 'input[id="lastName"]', 'input[id="last_name"]', 'input[id="surname"]',
        'input[id*="last" i]', 'input[id*="surname" i]', 'input[id*="soyad" i]'
    ].join(','));
    const anneInput = document.querySelector([
        'input[name="mothersName"]', 'input[name="motherName"]', 'input[name="mother_name"]',
        'input[name="motherFullName"]', 'input[id*="mother" i]'
    ].join(','));
    const babaInput = document.querySelector([
        'input[name="fathersName"]', 'input[name="fatherName"]', 'input[name="father_name"]',
        'input[name="fatherFullName"]', 'input[id*="father" i]'
    ].join(','));
    
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

    let issueDateInput = document.querySelector([
        'input[name="passportIssueDate"]', 'input[name="issueDate"]', 'input[name="passport_issue_date"]',
        'input[name="dateOfIssue"]', 'input[name="date_of_issue"]', 'input[id*="issue" i]',
        'input[id*="duzenle" i]', 'input[id*="verilis" i]'
    ].join(','));
    if (!issueDateInput) {
        const labels = document.querySelectorAll('label, span, th, dt');
        for (const label of labels) {
            const lt = label.innerText.toLowerCase();
            if (lt.includes('düzenleme tarihi') || lt.includes('duzenleme tarihi') || lt.includes('veriliş tarihi') || lt.includes('verilis tarihi') || lt.includes('issue date') || lt.includes('date of issue') || lt.includes('tanzim tarihi')) {
                issueDateInput = label.parentElement ? label.parentElement.querySelector('input') : null;
                if (issueDateInput) break;
            }
        }
    }

    let expiryDateInput = document.querySelector([
        'input[name="passportExpiryDate"]', 'input[name="expiryDate"]', 'input[name="passport_expiry_date"]',
        'input[name="dateOfExpiry"]', 'input[name="date_of_expiry"]', 'input[name="expirationDate"]',
        'input[id*="expir" i]', 'input[id*="gecerli" i]'
    ].join(','));
    if (!expiryDateInput) {
        const labels = document.querySelectorAll('label, span, th, dt');
        for (const label of labels) {
            const lt = label.innerText.toLowerCase();
            if (lt.includes('geçerlilik tarihi') || lt.includes('gecerlilik tarihi') || lt.includes('son geçerlilik') || lt.includes('expiry date') || lt.includes('date of expiry') || lt.includes('expiration date') || lt.includes('pasaport bitiş') || lt.includes('belge bitiş')) {
                expiryDateInput = label.parentElement ? label.parentElement.querySelector('input') : null;
                if (expiryDateInput) break;
            }
        }
    }

    const fallbackData = findApplyStudentData();
    const firstName = (firstNameInput ? firstNameInput.value : '')
        || fallbackData.firstName
        || findApplyInputValue(['input[name="ad"]', 'input[id="ad"]', 'input[name="firstName"]', 'input[name="first_name"]', 'input[name="name"]', 'input[id="name"]'])
        || '';
    let lastName = (lastNameInput ? lastNameInput.value : '')
        || fallbackData.lastName
        || findApplyInputValue(['input[name="soyad"]', 'input[id="soyad"]', 'input[name="surname"]', 'input[id="surname"]', 'input[name="lastName"]', 'input[id="last_name"]'])
        || '';

    // Safeguard: if lastName somehow picked up firstName (due to .row or form grouping), do not keep it identical
    if (lastName && firstName && lastName.trim().toLowerCase() === firstName.trim().toLowerCase()) {
        const altLastName = findApplyInputValue(['input[name="soyad"]', 'input[id="soyad"]', 'input[name="surname"]', 'input[id="surname"]']);
        if (altLastName && altLastName.trim().toLowerCase() !== firstName.trim().toLowerCase()) {
            lastName = altLastName;
        } else {
            lastName = '';
        }
    }
    const anneAdi = (anneInput ? anneInput.value : '') || fallbackData.anneAdi || findApplyFieldValue(['Anne Adı', 'Anne İsmi', "Mother's Name", 'Mother Name']) || '';
    const babaAdi = (babaInput ? babaInput.value : '') || fallbackData.babaAdi || findApplyFieldValue(['Baba Adı', 'Baba İsmi', "Father's Name", 'Father Name']) || '';
    const pasaportNo = (pasaportInput ? pasaportInput.value : '') || fallbackData.pasaportNo || '';
    const rawBirthDate = (birthInput ? birthInput.value : '') || fallbackData.birthDate || '';
    const rawIssueDate = (issueDateInput ? issueDateInput.value : '') || fallbackData.issueDate || '';
    const rawExpiryDate = (expiryDateInput ? expiryDateInput.value : '') || fallbackData.expiryDate || '';
    const uyruk = getSourceDropdownByLabel('Uyruk') || fallbackData.uyruk || '';
    const dogumUlkesi = getSourceDropdownByLabel('Doğduğunuz') || getSourceDropdownByLabel('Doğum') || fallbackData.dogumUlkesi || '';
    const cinsiyet = extractGenderFromApply() || getSourceDropdownByLabel('Cinsiyet') || fallbackData.cinsiyet || '';

    const normalizedBirthDate = normalizeApplyBirthDate(rawBirthDate);
    const normalizedIssueDate = normalizeApplyBirthDate(rawIssueDate);
    const normalizedExpiryDate = normalizeApplyBirthDate(rawExpiryDate);
    const fullName = [firstName, lastName].map((value) => String(value || '').trim()).filter(Boolean).join(' ');

    return {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ad: firstName.trim(),
        soyad: lastName.trim(),
        fullName,
        anneAdi: (anneAdi || '').trim(),
        babaAdi: (babaAdi || '').trim(),
        pasaportNo: (pasaportNo || '').trim(),
        passportNo: (pasaportNo || '').trim(),
        birthDate: normalizedBirthDate,
        issueDate: normalizedIssueDate,
        expiryDate: normalizedExpiryDate,
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

function decodeBase64ToBytes(base64) {
    const binary = atob(base64 || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function decodeDocumentBytes(bytes) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
    return String.fromCharCode(...bytes);
}

function ensurePdfWorkerReady() {
    if (!window.pdfjsLib) return;
    if (!window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions = {};
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
        } catch (_) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        }
    }
}

async function extractPdfText(bytes) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil. Eklentiyi yenileyip tekrar deneyin.');
    ensurePdfWorkerReady();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        pageTexts.push(textContent.items.map((item) => item.str).join(' '));
    }
    return pageTexts.join('\n');
}

function requestPortalOcr(imageBase64, requestId = '') {
    return new Promise((resolve, reject) => {
        if (!chrome?.runtime?.sendMessage) {
            reject(new Error('OCR servisine bağlanılamadı.'));
            return;
        }
        chrome.runtime.sendMessage({ action: 'OCR_IMAGE', imageBase64, requestId }, (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                reject(new Error(runtimeError.message));
                return;
            }
            if (!response?.success || !response.text) {
                reject(new Error(response?.error || 'OCR metin döndürmedi.'));
                return;
            }
            resolve(response.text);
        });
    });
}

async function extractPdfTextWithOcr(bytes, requestId = '', maxPages = 3) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil.');
    ensurePdfWorkerReady();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pageTexts = [];
    const pageLimit = Math.min(pdf.numPages, maxPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const text = await requestPortalOcr(canvas.toDataURL('image/jpeg', 0.85), requestId);
            if (text) pageTexts.push(text);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
    return pageTexts.join('\n');
}

async function extractImageTextWithOcr(bytes, contentType, requestId = '') {
    const blob = new Blob([bytes], { type: contentType || 'image/jpeg' });
    const imageUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = imageUrl;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Pasaport görseli açılamadı.'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return requestPortalOcr(canvas.toDataURL('image/jpeg', 0.85), requestId);
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

async function extractDocumentText(documentResult, options = {}) {
    const bytes = decodeBase64ToBytes(documentResult.documentBase64);
    const contentType = String(documentResult.contentType || '').toLowerCase();
    const signature = decodeDocumentBytes(bytes.slice(0, 8));
    if (contentType.includes('pdf') || signature.startsWith('%PDF')) {
        const text = await extractPdfText(bytes);
        if (text.trim() || options.fastOnly) return text;
        const ocrText = await extractPdfTextWithOcr(bytes, documentResult.requestId || '');
        documentResult.ocrText = ocrText;
        return ocrText;
    }
    if (contentType.startsWith('image/')) {
        if (options.fastOnly) return '';
        const ocrText = await extractImageTextWithOcr(bytes, contentType, documentResult.requestId || '');
        documentResult.ocrText = ocrText;
        return ocrText;
    }
    return decodeDocumentBytes(bytes);
}

function getDocumentCandidates(links, kind, requestedUrl = '') {
    const candidates = requestedUrl ? [requestedUrl] : [];
    const values = kind === 'passport'
        ? (links.passportCandidates || [links.passportDocumentUrl])
        : (links.acceptanceCandidates || [links.acceptanceLetterUrl]);
    for (const value of values) {
        if (value && !candidates.includes(value)) candidates.push(value);
    }
    return candidates.filter(Boolean);
}

async function extractPassportMetadataFromApply(request) {
    const links = findDocumentLinks();
    const profileData = extractApplyProfileData();
    const candidates = getDocumentCandidates(links, 'passport', request.documentUrl);
    if (candidates.length === 0) throw new Error('Öğrenci profilinde pasaport belgesi bulunamadı.');

    const isFast = Boolean(request.fastOnly || request.fromPortal);
    const errors = [];
    for (const documentUrl of candidates) {
        try {
            const documentResult = await fetchApplyDocument(documentUrl);
            documentResult.requestId = request.requestId;
            let text = await extractDocumentText(documentResult, { fastOnly: isFast });
            const parser = window.YknDocumentParser;
            if (!parser) throw new Error('Pasaport parserı hazır değil.');
            let metadata = parser.extractPassportMetadata(text, {
                nationality: profileData.uyruk,
                birthDate: profileData.birthDate,
                dogumUlkesi: profileData.dogumUlkesi,
                country: profileData.country || profileData.uyruk
            });
            let missingFields = ['issueDate', 'expiryDate', 'placeOfBirth', 'issuingAuthority']
                .filter((field) => !metadata[field]);

            // Portal üzerinden çağrılmıyorsa ve eksik alan varsa OCR dene
            if (!isFast && missingFields.length > 0 && !documentResult.ocrText) {
                try {
                    const bytes = decodeBase64ToBytes(documentResult.documentBase64);
                    const contentType = String(documentResult.contentType || '').toLowerCase();
                    const signature = decodeDocumentBytes(bytes.slice(0, 8));
                    const ocrText = contentType.includes('pdf') || signature.startsWith('%PDF')
                        ? await extractPdfTextWithOcr(bytes, request.requestId || '')
                        : contentType.startsWith('image/')
                            ? await extractImageTextWithOcr(bytes, contentType, request.requestId || '')
                            : '';
                    if (ocrText.trim()) {
                        text = `${text}\n${ocrText}`;
                        metadata = parser.extractPassportMetadata(text, {
                            nationality: profileData.uyruk,
                            birthDate: profileData.birthDate,
                            dogumUlkesi: profileData.dogumUlkesi,
                            country: profileData.country || profileData.uyruk
                        });
                        missingFields = ['issueDate', 'expiryDate', 'placeOfBirth', 'issuingAuthority']
                            .filter((field) => !metadata[field]);
                    }
                } catch (ocrError) {
                    errors.push(`OCR: ${ocrError.message}`);
                }
            }

            // Belge indirildiği için cropper'ın anında açılması adına veriyi hemen döndür
            return {
                metadata,
                missingFields,
                documentUrl,
                documentBase64: documentResult.documentBase64,
                contentType: documentResult.contentType
            };
        } catch (error) {
            errors.push(error.message);
        }
    }
    throw new Error(errors.at(-1) || 'Pasaport belgesi okunamadı.');
}

async function extractAcceptanceCodeFromApply(request) {
    const links = findDocumentLinks();
    const directCode = isValidYoksisId(links.kabulId) ? links.kabulId : '';
    if (directCode) return { code: directCode, documentUrl: '' };

    const candidates = getDocumentCandidates(links, 'acceptance', request.documentUrl);
    if (candidates.length === 0) throw new Error('Öğrenci profilinde kabul mektubu bulunamadı.');
    const errors = [];
    for (const documentUrl of candidates) {
        try {
            const documentResult = await fetchApplyDocument(documentUrl);
            const text = await extractDocumentText(documentResult);
            const parser = window.YknDocumentParser;
            const code = parser?.extractYoksisIdFromText(text) || '';
            if (code) return { code, documentUrl };
            errors.push('Kabul mektubu kodu belgede bulunamadı.');
        } catch (error) {
            errors.push(error.message);
        }
    }
    throw new Error(errors.at(-1) || 'Kabul mektubu okunamadı.');
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

// ==========================================
// YÖKSİS YKN & Kaydetme Otomasyon Fonksiyonları
// ==========================================

function findYoksisSaveButton() {
    const allDocs = getAllDocs(document);
    for (const doc of allDocs) {
        const clickables = doc.querySelectorAll(getYoksisClickableSelector());
        for (const candidate of clickables) {
            if (!isYoksisControlUsable(candidate)) continue;
            const text = getYoksisClickableText(candidate);
            if (text === 'kaydet' || text.startsWith('kaydet') || text.includes('ogrencikaydet')) {
                return getYoksisClickableRoot(candidate);
            }
        }
    }
    return null;
}

function findYoksisStudentRows() {
    const allDocs = getAllDocs(document);
    for (const doc of allDocs) {
        const candidateRows = Array.from(doc.querySelectorAll(
            '.z-grid-body tr.z-row, .z-listbox-body tr.z-listitem, table.z-grid-body tr, table.z-listbox-body tr, tr.z-row, tr.z-listitem'
        )).filter(row => {
            if (!isYoksisControlUsable(row)) return false;
            if (row.closest('.z-columns') || row.closest('.z-listhead') || row.classList.contains('z-columns') || row.classList.contains('z-listhead')) return false;
            const cells = row.querySelectorAll('td');
            return cells.length >= 4;
        });

        if (candidateRows.length > 0) {
            return candidateRows;
        }
    }
    return [];
}

function matchStudentInFirstThreeRows(studentName, passportNo) {
    const rows = findYoksisStudentRows().slice(0, 3);
    if (rows.length === 0) return null;

    const normName = normalizeYoksisText(studentName || '');
    const normPassport = normalizeYoksisText(passportNo || '');
    const nameTokens = (studentName || '').split(/\s+/).map(normalizeYoksisText).filter(t => t.length >= 3);

    let bestRow = null;
    let highestScore = -1;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowText = normalizeYoksisText(row.innerText || row.textContent || '');
        let score = 0;

        if (normPassport && normPassport.length >= 4 && rowText.includes(normPassport)) {
            score += 100;
        }

        if (normName && normName.length >= 4 && rowText.includes(normName)) {
            score += 70;
        } else {
            for (const token of nameTokens) {
                if (rowText.includes(token)) score += 25;
            }
        }

        if (score > highestScore) {
            highestScore = score;
            bestRow = row;
        }
    }

    return bestRow || rows[0];
}

async function selectYoksisTableRow(rowElement) {
    if (!rowElement) return false;
    const win = rowElement.ownerDocument?.defaultView || window;

    if (win.zk && win.zk.Widget) {
        const w = win.zk.Widget.$(rowElement);
        if (w && typeof w.fire === 'function') {
            try {
                w.fire('onClick', null, { toServer: true });
                w.fire('onSelect', null, { toServer: true });
            } catch (_) {}
        }
    }

    const targetCell = rowElement.querySelector('td:nth-child(3)') || rowElement.querySelector('td:nth-child(2)') || rowElement.querySelector('td') || rowElement;
    for (const el of [targetCell, rowElement]) {
        try {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: win }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: win }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: win }));
        } catch (_) {}
    }

    return true;
}

function findYoksisYknActionButtons() {
    const allDocs = getAllDocs(document);
    let talepButton = null;
    let sorgulaButton = null;

    for (const doc of allDocs) {
        const clickables = doc.querySelectorAll(getYoksisClickableSelector());
        for (const candidate of clickables) {
            if (!isYoksisControlUsable(candidate)) continue;
            const text = getYoksisClickableText(candidate);

            // "YKN Talep Gönder" butonu
            if (text.includes('talepgonder') || (text.includes('talep') && text.includes('gonder'))) {
                talepButton = getYoksisClickableRoot(candidate);
            }
            // "Durum Sorgula" veya "Durumu Sorgula" butonu
            else if (text.includes('durumsorgula') || text.includes('durumusorgula') || (text.includes('durum') && text.includes('sorgula'))) {
                sorgulaButton = getYoksisClickableRoot(candidate);
            }
        }
    }

    return { talepButton, sorgulaButton };
}

async function waitAndHandleYoksisModal(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    const allDocs = getAllDocs(document);

    while (Date.now() < deadline) {
        for (const doc of allDocs) {
            const modals = doc.querySelectorAll(
                '.z-window-modal, .z-window-highlighted, .z-messagebox-window, .z-messagebox, [class*="z-window-modal"], [class*="z-window-highlighted"], [class*="z-messagebox"]'
            );
            for (const modal of modals) {
                if (!isYoksisControlUsable(modal)) continue;

                const modalText = (modal.innerText || modal.textContent || '').trim();
                const buttons = modal.querySelectorAll('button, .z-button, [class*="z-button"], a, input[type="button"], [role="button"]');
                let confirmBtn = null;
                for (const btn of buttons) {
                    if (!isYoksisControlUsable(btn)) continue;
                    const bTxt = normalizeYoksisText(btn.innerText || btn.textContent || btn.value || '');
                    if (bTxt.includes('tamam') || bTxt === 'ok' || bTxt.includes('kapat')) {
                        confirmBtn = getYoksisClickableRoot(btn) || btn;
                        break;
                    }
                }

                if (confirmBtn) {
                    triggerZkClick(confirmBtn);
                    try { confirmBtn.click(); } catch (_) {}
                    return { found: true, text: modalText };
                } else if (modalText && modalText.length > 5) {
                    await new Promise(r => setTimeout(r, 200));
                    const retryButtons = modal.querySelectorAll('button, .z-button, a, input[type="button"]');
                    for (const rb of retryButtons) {
                        const rbTxt = normalizeYoksisText(rb.innerText || rb.textContent || rb.value || '');
                        if (rbTxt.includes('tamam') || rbTxt === 'ok' || rbTxt.includes('kapat')) {
                            triggerZkClick(rb);
                            try { rb.click(); } catch (_) {}
                            return { found: true, text: modalText };
                        }
                    }
                }
            }
        }
        await new Promise(r => setTimeout(r, 250));
    }

    return { found: false, text: '' };
}

function parseYknFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const ykn99Match = text.match(/\b(99\d{9})\b/);
    if (ykn99Match) return ykn99Match[1];
    const yknGeneralMatch = text.match(/(?:ykn|yabancı\s*kimlik|kimlik\s*no|durum)[\s:]*(\d{11})/i);
    if (yknGeneralMatch) return yknGeneralMatch[1];
    return null;
}

function parseGuidFromText(text) {
    if (!text) return '';
    const guidMatch = text.match(/(?:takip\s*guid|guid|takip\s*no)[\s:]*([a-zA-Z0-9-]{8,})/i);
    return guidMatch ? guidMatch[1] : '';
}

async function executeYoksisSave() {
    const saveBtn = findYoksisSaveButton();
    if (!saveBtn) {
        return { success: false, message: 'YÖKSİS Kaydet butonu ekranda bulunamadı.' };
    }
    triggerZkClick(saveBtn);
    const modal = await waitAndHandleYoksisModal(3000);
    return {
        success: true,
        modalText: modal.text || '',
        message: 'Kaydet butonuna basıldı.'
    };
}

async function executeYoksisYknCycleStep(studentName, passportNo) {
    const row = matchStudentInFirstThreeRows(studentName, passportNo);
    if (!row) {
        return {
            success: false,
            status: 'STUDENT_ROW_NOT_FOUND',
            message: 'YÖKSİS tablosunda ilk 3 satır arasında öğrenci kaydı bulunamadı. Lütfen önce YÖKSİS formunu kaydedin.'
        };
    }

    // 1. Tablonun 2. sütununda (YKN alanı) önceden YKN çıkmış mı kontrol et
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
        const tableYkn = (cells[1].innerText || cells[1].textContent || '').trim();
        if (/^99\d{9}$/.test(tableYkn)) {
            return {
                success: true,
                status: 'YKN_READY',
                ykn: tableYkn,
                message: `YKN Tabloda Hazır: ${tableYkn}`
            };
        }
    }

    // 2. Satırı seç (tıkla)
    await selectYoksisTableRow(row);
    await new Promise(r => setTimeout(r, 900));

    // 3. Ekranda hangi butonun belirdiğini kontrol et
    let { talepButton, sorgulaButton } = findYoksisYknActionButtons();

    if (!talepButton && !sorgulaButton) {
        await selectYoksisTableRow(row);
        await new Promise(r => setTimeout(r, 1200));
        const refreshed = findYoksisYknActionButtons();
        talepButton = refreshed.talepButton;
        sorgulaButton = refreshed.sorgulaButton;
    }

    // Senaryo A: "YKN Talep Gönder" butonu var
    if (talepButton) {
        triggerZkClick(talepButton);
        const modal = await waitAndHandleYoksisModal(5000);
        const modalText = modal.text || 'YKN talebi havuza düştü. İl Göç İdaresi Müdürlüğü tarafından değerlendirilecektir.';
        const guid = parseGuidFromText(modalText);
        return {
            success: true,
            status: 'TALEP_SENT',
            guid: guid,
            message: modalText
        };
    }

    // Senaryo B: "Durum Sorgula" butonu var
    if (sorgulaButton) {
        triggerZkClick(sorgulaButton);
        const modal = await waitAndHandleYoksisModal(6000);
        const modalText = modal.text || '';

        const ykn = parseYknFromText(modalText);
        if (ykn) {
            return {
                success: true,
                status: 'YKN_READY',
                ykn: ykn,
                message: modalText || `YKN: ${ykn}`
            };
        }

        const isPending = /ykn\s*bekliyor/i.test(modalText) || /durum:\s*ykn\s*bekliyor/i.test(modalText) || /bekliyor/i.test(modalText) || /takip\s*guid/i.test(modalText);
        if (isPending) {
            const guid = parseGuidFromText(modalText);
            return {
                success: true,
                status: 'YKN_PENDING',
                guid: guid,
                message: modalText || 'YKN Bekliyor'
            };
        }

        return {
            success: false,
            status: 'MODAL_INFO',
            message: modalText || 'Durum sorgulandı.'
        };
    }

    return {
        success: false,
        status: 'BUTTON_NOT_FOUND',
        message: 'Öğrenci satırı seçildi ancak "YKN Talep Gönder" veya "Durum Sorgula" butonu belirmedi. Kaydetmenin tamamlandığından emin olun.'
    };
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

    else if (request.action === 'EXTRACT_PASSPORT_METADATA') {
        extractPassportMetadataFromApply(request)
            .then((result) => sendResponse({ success: true, ...result, requestId: request.requestId }))
            .catch((error) => sendResponse({
                success: false,
                requestId: request.requestId,
                error: error.message
            }));
        return true;
    }

    else if (request.action === 'READ_ACCEPTANCE_CODE') {
        extractAcceptanceCodeFromApply(request)
            .then((result) => sendResponse({
                success: true,
                requestId: request.requestId,
                kabulId: result.code,
                acceptanceDocumentUrl: result.documentUrl
            }))
            .catch((error) => sendResponse({
                success: false,
                requestId: request.requestId,
                error: error.message
            }));
        return true;
    }

    else if (request.action === "searchWithId") {
        const kabulId = normalizeYoksisIdValue(request.kabulId);
        
        if (!kabulId) {
            sendResponse({ success: false, requestId: request.requestId, message: "Kabul ID boş olamaz." });
            return;
        }

        waitForYoksisSearchControls()
            .then(async (initialPair) => {
                let idInput = initialPair.idInput;
                let searchBtn = initialPair.searchBtn;

                // ZK, onChange sonrasında input düğümünü yeniden oluşturabilir.
                // Eski uygulama ilk düğüme değeri yazıp yeni (boş) düğümü
                // görünce aramayı kesiyordu. En fazla bir kez, güncel düğüme
                // yeniden yazıp doğruluyoruz; bu sınır aynı kabul kodu için
                // birden fazla arama/postback oluşmasını engeller.
                let valueConfirmed = false;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    if (!idInput || !isYoksisControlUsable(idInput)) {
                        const currentPair = await waitForYoksisSearchControls();
                        idInput = currentPair.idInput;
                        searchBtn = currentPair.searchBtn || searchBtn;
                    }

                    const inputFilled = await simulateInput(idInput, kabulId, { pressEnter: false });
                    if (!inputFilled) {
                        throw new Error('Kabul Mektup ID alanına değer yazılamadı.');
                    }

                    // Değerin ZK tarafındaki onChange güncellemesi bitmeden
                    // arama butonuna basılırsa ikinci öğrencide tıklama eski
                    // bileşene gidebilir. Yeniden bulma da bu yüzden şarttır.
                    await waitForYoksisSearchControlsToSettle();
                    const refreshedPair = findYoksisKabulPair();
                    idInput = refreshedPair.idInput || idInput;
                    searchBtn = refreshedPair.searchBtn || searchBtn;
                    if (idInput && isYoksisControlUsable(idInput)
                        && normalizeYoksisIdValue(idInput.value) === kabulId) {
                        valueConfirmed = true;
                        break;
                    }
                }

                if (!valueConfirmed) {
                    throw new Error('YÖKSİS Kabul Mektup ID değeri güncelleme sonrasında korunamadı. Sayfayı yenileyip tekrar deneyin.');
                }

                // Baseline, kod ZK widget'ına işlendi *sonra* ve arama tıklaması
                // yapılmadan hemen önce alınmalıdır. Böylece kodun onChange AU
                // güncellemesini sonuç postback'i sanmayız.
                const stateBeforeSearch = getYoksisFormState();
                const formFingerprintBeforeSearch = stateBeforeSearch.fingerprint;

                if (!searchBtn && idInput) {
                    searchBtn = findKabulIdButton(idInput);
                }

                let searchTriggered = false;
                if (searchBtn) {
                    searchTriggered = triggerZkClick(searchBtn, idInput, kabulId);
                } else {
                    // Enter fallback'i burada kullanma: ZK onOK tanımlı değilse
                    // hiçbir şey yapmaz, tanımlıysa da MAIN-world fallback'iyle
                    // çift postback üretir. Gerçek arama butonu bulunamazsa
                    // background kontrollü fallback yoluna geçsin.
                    console.warn('[YKN] Kabul mektup ID ara butonu bulunamadı. MAIN-world fallback deneniyor.');
                    searchTriggered = false;
                }
                if (!searchTriggered) throw new Error('YÖKSİS arama komutu tetiklenemedi.');

                let formReady = false;
                if (request.waitForForm !== false) try {
                    await waitForYoksisForm(YOKSIS_SEARCH_INITIAL_FORM_WAIT_MS, {
                        afterFingerprint: formFingerprintBeforeSearch,
                        afterDomRevision: stateBeforeSearch.domRevision,
                        requireFreshResult: true
                    });
                    formReady = true;
                } catch (_) {
                    formReady = false;
                }
                return {
                    formReady,
                    searchTriggered,
                    formFingerprintBeforeSearch,
                    domRevisionBeforeSearch: stateBeforeSearch.domRevision
                };
            })
            .then(({ formReady, searchTriggered, formFingerprintBeforeSearch, domRevisionBeforeSearch }) => sendResponse({
                // Tıklamayı göndermiş olmak başarı değildir: yeni öğrenci formu
                // doğrulanmadıkça portal sonraki "bilgileri aktar" adımını açmamalı.
                success: formReady,
                formReady,
                searchTriggered,
                formFingerprintBeforeSearch,
                domRevisionBeforeSearch,
                buttonFound: Boolean(findYoksisKabulPair().searchBtn),
                requestId: request.requestId
            }))
            .catch((error) => sendResponse({
                success: false,
                requestId: request.requestId,
                message: error.message
            }));
        return true;
    }

    else if (request.action === 'WAIT_YOKSIS_FORM') {
        waitForYoksisForm(Math.min(Number(request.timeoutMs) || 6000, 10000), {
            afterFingerprint: request.afterFingerprint || '',
            afterDomRevision: Number.isFinite(request.afterDomRevision)
                ? request.afterDomRevision
                : null,
            requireFreshResult: request.requireFreshResult === true
        })
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

    else if (request.action === 'GET_YOKSIS_FORM_STATE') {
        sendResponse({
            success: true,
            requestId: request.requestId,
            ...getYoksisFormState()
        });
        return true;
    }
    
    else if (request.action === "fillRemainingData") {
        chrome.storage.local.get(['studentData'], async (result) => {
            const data = request.data || result.studentData;
            if (!data) {
                sendResponse({ success: false, message: "Hafızada veri yok." });
                return;
            }

            // Arama sonrası YÖKSİS öğrenci paneli ve fotoğraf bileşeni gecikmeli
            // gelebilir. Tek input görünür görünmez devam etmek eksik aktarım
            // ürettiği için formun kararlı hale gelmesini daha uzun bekle.
            try {
                await waitForYoksisForm(10000);
            } catch (_) {
                // Form zaten açık veya süre aşıldıysa mevcut elemanlarla devam et
            }

            const hasFormControl = Boolean(
                findTargetElementByFuzzyLabel('Anne Adı', 'input')
                || findTargetElementByFuzzyLabel('Baba Adı', 'input')
                || findBelgeNoInMainPanel()
                || findTargetElementByFuzzyLabel('Uyruğu', 'select')
            );
            if (!hasFormControl) {
                sendResponse({
                    success: false,
                    message: 'YÖKSİS öğrenci bilgi formu henüz hazır değil. Form açıldıktan sonra tekrar deneyin.',
                    filledFields: [],
                    missingFields: ['Öğrenci bilgi formu']
                });
                return;
            }

            let successCount = 0;
            let photoUploaded = false;
            const filledFields = new Set();
            const missingFields = new Set();
            const recordField = (label, expectedValue, filled) => {
                const expected = String(expectedValue ?? '').trim();
                if (!expected) return Boolean(filled);
                if (filled) {
                    filledFields.add(label);
                    missingFields.delete(label);
                } else if (!filledFields.has(label)) {
                    missingFields.add(label);
                }
                return Boolean(filled);
            };

            const firstNameVal = String(data.firstName || data.ad || '').trim();
            const lastNameVal = String(data.lastName || data.soyad || '').trim();

            const adiInput = findTargetElementByFuzzyLabels(['Adı', 'Öğrenci Adı', 'Ad'], 'input');
            if (adiInput && !adiInput.disabled && !adiInput.readOnly && firstNameVal) {
                if (recordField('Adı', firstNameVal, await simulateInput(adiInput, firstNameVal))) successCount++;
            }

            const soyadiInput = findTargetElementByFuzzyLabels(['Soyadı', 'Öğrenci Soyadı', 'Soyad'], 'input');
            if (soyadiInput && !soyadiInput.disabled && !soyadiInput.readOnly && lastNameVal) {
                if (recordField('Soyadı', lastNameVal, await simulateInput(soyadiInput, lastNameVal))) successCount++;
            }

            const anneAdiInput = findTargetElementByFuzzyLabel('Anne Adı', 'input');
            if (recordField('Anne Adı', data.anneAdi, await simulateInput(anneAdiInput, data.anneAdi))) successCount++;

            const babaAdiInput = findTargetElementByFuzzyLabel('Baba Adı', 'input');
            if (recordField('Baba Adı', data.babaAdi, await simulateInput(babaAdiInput, data.babaAdi))) successCount++;

            const uyrukSelect = findTargetElementByFuzzyLabel('Uyruğu', 'select');
            const visibleNationality = getSelectedOptionText(uyrukSelect);
            const countryValue = data.uyruk || visibleNationality;
            if (recordField('Uyruğu', data.uyruk, simulateSelect(uyrukSelect, data.uyruk))) successCount++;
            
            const dogumUyruguSelect = findTargetElementByFuzzyLabel('Doğum Uyruğu', 'select');
            if (recordField('Doğum Uyruğu', countryValue, simulateSelect(dogumUyruguSelect, countryValue))) successCount++;
            
            const dogumYeriUlkesiSelect = findTargetElementByFuzzyLabel('Doğum Yeri Ülkesi', 'select');
            const dogumYeriDegeri = data.dogumUlkesi ? data.dogumUlkesi : countryValue;
            if (recordField('Doğum Yeri Ülkesi', dogumYeriDegeri, simulateSelect(dogumYeriUlkesiSelect, dogumYeriDegeri))) successCount++;
            
            const belgeyiVerenUlkeSelect = findTargetElementByFuzzyLabel('Belgeyi Veren Ülke', 'select');
            if (recordField('Belgeyi Veren Ülke', countryValue, simulateSelect(belgeyiVerenUlkeSelect, countryValue))) successCount++;

            if (data.cinsiyet) {
                if (recordField('Cinsiyet', data.cinsiyet, simulateRadioByLabelText(data.cinsiyet))) successCount++;
            }
            const maritalStatus = data.medeniHali || data.medeniHal || 'Bekar';
            if (recordField('Medeni Hali', maritalStatus, simulateRadioByLabelText(maritalStatus))) successCount++;

            // Özel Ülke Kuralları (Türkmenistan, Afganistan, Pakistan)
            const normalizeCountry = (val) => val ? val.toLocaleLowerCase('tr-TR').replace(/\s+/g, '') : '';
            const isMatch = (val, search) => normalizeCountry(val).includes(search);

            const uyrukNorm = normalizeCountry(countryValue);
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
                const filled = await simulateInput(dogumYeriAciklamasi, customDogumYeri);
                if (recordField('Doğum Yeri Açıklaması', customDogumYeri, filled)) {
                    successCount++;
                    filledDogumYeri = true;
                }
            }

            if (customVerenMakam && verenMakam) {
                const filled = await simulateInput(verenMakam, customVerenMakam);
                if (recordField('Belgeyi Veren Makam', customVerenMakam, filled)) {
                    successCount++;
                    filledVerenMakam = true;
                }
            }

            // Değerler portaldan gelmediyse ülke bazlı akıllı şablonları uygula
            if (!filledDogumYeri || !filledVerenMakam) {
                if (isTurkmen) {
                    if (!filledDogumYeri && dogumYeriAciklamasi) {
                        const filled = await simulateInput(dogumYeriAciklamasi, 'TKM');
                        if (recordField('Doğum Yeri Açıklaması', 'TKM', filled)) successCount++;
                    }
                    if (!filledVerenMakam && verenMakam) {
                        const filled = await simulateInput(verenMakam, 'SMST');
                        if (recordField('Belgeyi Veren Makam', 'SMST', filled)) successCount++;
                    }
                } 
                else if (uyrukNorm.includes('afgan') || dogumNorm.includes('afgan')) {
                    if (!filledDogumYeri && dogumYeriAciklamasi && !dogumYeriAciklamasi.value) {
                        const filled = await simulateInput(dogumYeriAciklamasi, 'AFG');
                        if (recordField('Doğum Yeri Açıklaması', 'AFG', filled)) successCount++;
                    }
                    if (!filledVerenMakam && verenMakam) {
                        const filled = await simulateInput(verenMakam, 'AFGHAN');
                        if (recordField('Belgeyi Veren Makam', 'AFGHAN', filled)) successCount++;
                    }
                } 
                else if (uyrukNorm.includes('pakistan') || dogumNorm.includes('pakistan')) {
                    if (!filledDogumYeri && dogumYeriAciklamasi && !dogumYeriAciklamasi.value) {
                        const filled = await simulateInput(dogumYeriAciklamasi, 'PAK');
                        if (recordField('Doğum Yeri Açıklaması', 'PAK', filled)) successCount++;
                    }
                    if (!filledVerenMakam && verenMakam) {
                        const filled = await simulateInput(verenMakam, 'PAKISTAN');
                        if (recordField('Belgeyi Veren Makam', 'PAKISTAN', filled)) successCount++;
                    }
                }
            }
            
            const telefonNoInput = findTargetElementByFuzzyLabels([
                'Telefon No',
                'Telefon Numarası',
                'Cep Telefonu No',
                'Cep Telefonu',
                'GSM',
                'Telefon'
            ], 'input');
            if (recordField('Telefon No', FIXED_YOKSIS_PHONE, await simulateInput(telefonNoInput, FIXED_YOKSIS_PHONE))) successCount++;

            const belgeNoInput = findBelgeNoInMainPanel();
            const passportValue = data.pasaportNo || data.passportNo;
            const foreignIdentityInput = findTargetElementByFuzzyLabels([
                'Uyruk Kimlik No',
                'Yabancı Kimlik No',
                'Nationality Identity No'
            ], 'input');
            const normalizeIdentity = (value) => String(value || '')
                .toLocaleLowerCase('tr-TR')
                .replace(/\s+/g, '');
            if (foreignIdentityInput && passportValue
                && normalizeIdentity(foreignIdentityInput.value) === normalizeIdentity(passportValue)) {
                await simulateInput(foreignIdentityInput, '');
            }
            if (recordField('Belge No', passportValue, await simulateInput(belgeNoInput, passportValue))) successCount++;

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
                'Pasaport Bitiş Tarihi',
                'Belge Bitiş Tarihi',
                'Date of Expiry',
                'Expiry Date',
                'Expiration Date'
            ], 'input');

            const rawIssueDate = data.issueDate || data.passportIssueDate || data.duzenlemeTarihi || data.pasaportDuzenlemeTarihi || data.verilisTarihi || data.belgeDuzenlemeTarihi || '';
            const rawExpiryDate = data.expiryDate || data.passportExpiryDate || data.gecerlilikTarihi || data.pasaportGecerlilikTarihi || data.bitisTarihi || data.belgeGecerlilikTarihi || '';

            const issueDateFilled = issueDateInput && rawIssueDate
                ? await simulateDateboxInput(issueDateInput, formatDateForYoksisInput(issueDateInput, rawIssueDate))
                : false;
            if (recordField('Düzenleme Tarihi', rawIssueDate, issueDateFilled)) {
                successCount++;
            }
            const expiryDateFilled = expiryDateInput && rawExpiryDate
                ? await simulateDateboxInput(expiryDateInput, formatDateForYoksisInput(expiryDateInput, rawExpiryDate))
                : false;
            if (recordField('Geçerlilik Tarihi', rawExpiryDate, expiryDateFilled)) {
                successCount++;
            }

            const birthDateInput = findTargetElementByFuzzyLabels([
                'Doğum Tarihi',
                'Date of Birth',
                'Birth Date'
            ], 'input');
            const rawBirthDate = data.birthDate || data.dogumTarihi || '';
            const birthDateFilled = birthDateInput && rawBirthDate
                ? await simulateDateboxInput(birthDateInput, formatDateForYoksisInput(birthDateInput, rawBirthDate))
                : false;
            if (recordField('Doğum Tarihi', rawBirthDate, birthDateFilled)) {
                successCount++;
            }

            // ZK widget'ının izole dünyada blur olayında değeri sıfırlamasını engellemek için
            // yıkıcı blur/focusout döngüsü yerine sadece input ve change güvencesi sağlanır.
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
                    if (el.value) {
                        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    }
                } catch (_) {}
            }

            // Fotoğraf otomatik yükleme (Kırpılmış vesikalık varsa YÖKSİS'e yükle)
            if (data.croppedPhotoBase64) {
                try {
                    photoUploaded = await uploadPhotoToYoksis(data.croppedPhotoBase64, data.photoFileName);
                    if (recordField('Fotoğraf', true, photoUploaded)) successCount++;
                } catch (photoErr) {
                    missingFields.add('Fotoğraf');
                    console.warn('[YKN] Fotoğraf yükleme hatası (content script):', photoErr);
                }
            }

            if (successCount > 0) {
                const missing = Array.from(missingFields);
                sendResponse({
                    success: true,
                    partial: missing.length > 0,
                    photoUploaded,
                    filledFields: Array.from(filledFields),
                    missingFields: missing
                });
            } else {
                sendResponse({
                    success: false,
                    message: "Hedef inputlar bulunamadı.",
                    filledFields: [],
                    missingFields: Array.from(missingFields)
                });
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

    else if (request.action === 'YOKSIS_SAVE_FORM') {
        executeYoksisSave()
            .then(result => sendResponse({ ...result, requestId: request.requestId }))
            .catch(err => sendResponse({ success: false, error: err.message, requestId: request.requestId }));
        return true;
    }

    else if (request.action === 'YOKSIS_STEP_YKN') {
        const studentName = request.studentName || '';
        const passportNo = request.passportNo || '';
        executeYoksisYknCycleStep(studentName, passportNo)
            .then(result => sendResponse({ ...result, requestId: request.requestId }))
            .catch(err => sendResponse({ success: false, error: err.message, requestId: request.requestId }));
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
            // Apply arama alanı bazı sürümlerde yalnızca Enter ile sunucu
            // tarafındaki tablo sorgusunu çalıştırıyor. Yazma işlemi ve Enter
            // zinciri tamamlanmadan sonuçları kontrol etmeye başlama.
            simulateInput(searchInput, passportNo, { pressEnter: true }).then(() => {
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
            }).catch(() => {
                sendApplyEvent(
                    'STUDENT_NOT_FOUND',
                    requestId,
                    { error: 'Apply arama alanına pasaport numarası yazılamadı.' }
                );
            });
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
