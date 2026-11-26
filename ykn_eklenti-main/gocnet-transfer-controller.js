(() => {
if (globalThis.__YOKSIS_GOCNET_TRANSFER_CONTROLLER_LOADED__) return;
globalThis.__YOKSIS_GOCNET_TRANSFER_CONTROLLER_LOADED__ = true;

const QUERY_LABEL = 'e-ikamet başvuru no';
const MAX_PDF_BYTES = 9 * 1024 * 1024;
const GOCNET_QUERY_TIMEOUT_MS = 12_000;
const QUERY_DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], .z-window-modal, .z-messagebox-window';
const STUDENT_DATA_FILLED_HEADERS = Object.freeze([
    'sorgulama başarılı (yöksis verileri doldurudu)',
    'sorgulama başarılı (yöksis verileri dolduruldu)'
]);
const QUERY_RESULT_MESSAGES = Object.freeze({
    no_match: ['sorgu hatası', 'başvuru sorgulama başarısız!', 'hata kodu: veri bulunamadı', 'detay: kayıt bulunamadı'],
    existing_record: ['sorgulama başarılı (db kaydı yüklendi)', 'başvuru sorgulama başarılı.',
        'öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.'],
    student_data_filled: STUDENT_DATA_FILLED_HEADERS
});
let queryInProgress = false;
const transferContexts = new Map();

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
}

function isVisible(element) {
    for (let current = element; current; current = current.parentElement) {
        if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
        const style = current.ownerDocument.defaultView?.getComputedStyle(current);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
}

const QUERY_BUTTON_SELECTOR = 'button, .z-button, input[type="button"], input[type="submit"]';
const QUERY_TEXT_INPUT_SELECTOR = 'input:not([type]), input[type="text"]';

function isExactSearchField(document, applicationNumber) {
    return findQueryControls(document)?.input.value === applicationNumber;
}

function isQueryButton(button) {
    return isVisible(button)
        && normalizeIdentity(String(button.textContent || button.value || '').replace(/^\W+/, '')) === 'basvurusorgula';
}

function isButtonDisabled(button) {
    return Boolean(button?.disabled
        || [...(button?.querySelectorAll?.('button, input') || [])].some((child) => child.disabled));
}

function findQueryControls(rootDocument) {
    if (!rootDocument) return null;
    const rawButtons = [...rootDocument.querySelectorAll(QUERY_BUTTON_SELECTOR)].filter(isQueryButton);
    const buttons = rawButtons.filter((candidate) => !rawButtons.some((other) => other !== candidate && other.contains(candidate)));
    const targets = [];
    for (const button of buttons) {
        let scope = null;
        let scopeInputs = [];
        for (let current = button.parentElement, depth = 0; current && depth < 7; current = current.parentElement, depth += 1) {
            const inputs = [...current.querySelectorAll(QUERY_TEXT_INPUT_SELECTOR)].filter(isVisible);
            if (inputs.length > 0) {
                scope = current;
                scopeInputs = inputs;
                break;
            }
        }
        if (!scope || scopeInputs.length !== 1) continue;
        if (!normalizeIdentity(scope.textContent).includes('eikametbasvuruno')) continue;
        let hasHeading = false;
        for (let headingScope = scope, headingDepth = 0; headingScope && headingDepth <= 7;
            headingScope = headingScope.parentElement, headingDepth += 1) {
            if (normalizeIdentity(headingScope.textContent).includes('1eikametbasvurusorgulama')) {
                hasHeading = true;
                break;
            }
        }
        if (hasHeading) targets.push({ input: scopeInputs[0], button });
    }
    return targets.length === 1 ? targets[0] : null;
}

function findVisibleQueryDialogs(rootDocument) {
    const raw = [...rootDocument.querySelectorAll(QUERY_DIALOG_SELECTOR)].filter(isVisible);
    return raw.filter((candidate) => !raw.some((other) => other !== candidate && other.contains(candidate)));
}

function hasVisibleDialog(rootDocument) {
    return findVisibleQueryDialogs(rootDocument).length > 0;
}

function findDialogHeaderNode(dialog) {
    return dialog?.querySelector('.z-window-header, .z-window-highlighted-header, .z-window-modal-header, .z-caption')
        || dialog?.querySelector('h1, h2, h3, h4, h5')
        || null;
}

function readSanitizedDialogHeader(dialog) {
    const headerNode = findDialogHeaderNode(dialog);
    if (!headerNode) return '';
    return normalizeText(headerNode.textContent)
        .replace(/20\d{2}-\d{2}-\d{5,8}|\b\d{5,}\b/g, '')
        .replace(/[^\p{L}\p{N} .,:\-!/()]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40)
        .trim();
}

function waitForQueryResult(rootDocument, applicationNumber, signal, timeoutMs = GOCNET_QUERY_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const view = rootDocument?.defaultView;
        const Observer = view?.MutationObserver;
        if (!Observer || !rootDocument.documentElement) {
            resolve(noteReason('bad_input'));
            return;
        }
        const setTimer = view?.setTimeout ? view.setTimeout.bind(view) : setTimeout;
        const clearTimer = view?.clearTimeout ? view.clearTimeout.bind(view) : clearTimeout;
        let settled = false;
        const observer = new Observer(check);
        const timer = setTimer(() => finish(noteReason('form_result_timeout')), timeoutMs);
        const finish = (result) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearTimer(timer);
            signal?.removeEventListener('abort', abort);
            resolve(result);
        };
        const abort = () => finish(noteReason('form_result_aborted'));
        function check() {
            const dialogs = findVisibleQueryDialogs(rootDocument);
            if (!dialogs.length) return;
            const result = readGocnetQueryResult(rootDocument, applicationNumber);
            if (result !== 'unknown') {
                finish(result);
                return;
            }
            if (!isExactSearchField(rootDocument, applicationNumber)) {
                finish(noteReason('form_search_value_mismatch'));
                return;
            }
            if (dialogs.length > 1) {
                finish(noteReason('form_result_multiple_dialogs'));
                return;
            }
            if (!normalizeText(dialogs[0].textContent)) return;
            const header = readSanitizedDialogHeader(dialogs[0]);
            finish(noteReason(header ? `form_result_unrecognized: ${header}` : 'form_result_unrecognized'));
        }
        observer.observe(rootDocument.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else check();
    });
}

function isStudentDataFilledResult(dialog, dialogText) {
    const headerNode = findDialogHeaderNode(dialog);
    const headerText = headerNode ? normalizeText(headerNode.textContent) : '';
    if (headerNode) {
        if (!STUDENT_DATA_FILLED_HEADERS.includes(headerText)) return false;
    } else if (dialogText.includes('db kaydı yüklendi') || !STUDENT_DATA_FILLED_HEADERS.some((header) => dialogText.includes(header))) {
        return false;
    }
    const messageNode = dialog?.querySelector('.z-messagebox');
    const bodyText = messageNode
        ? normalizeText(messageNode.textContent)
        : (headerText ? normalizeText(dialogText.replace(headerText, ' ')) : dialogText);
    if (!bodyText.includes('başvuru sorgulama başarılı')) return false;
    return (bodyText.includes('veri') && bodyText.includes('doldur'))
        || (bodyText.includes('veritabanından') && bodyText.includes('forma') && bodyText.includes('dolduru'));
}

/** Returns explicit YÖKSİS query states; unrecognized dialogs remain unknown. */
function readGocnetQueryResult(rootDocument, applicationNumber) {
    if (!rootDocument || typeof applicationNumber !== 'string' || !isExactSearchField(rootDocument, applicationNumber)) {
        return 'unknown';
    }
    const dialogs = findVisibleQueryDialogs(rootDocument);
    if (dialogs.length !== 1) return 'unknown';
    const dialog = dialogs[0];
    const dialogText = normalizeText(dialog.textContent);
    if (QUERY_RESULT_MESSAGES.no_match.every((message) => dialogText.includes(message))) return 'no_match';
    if (QUERY_RESULT_MESSAGES.existing_record.every((message) => dialogText.includes(message))) return 'existing_record';
    return isStudentDataFilledResult(dialog, dialogText) ? 'student_data_filled' : 'unknown';
}

function findDialogTamamButton(dialog) {
    if (!dialog) return null;
    const rawButtons = [...dialog.querySelectorAll('button.z-messagebox-button, button, input[type="button"], input[type="submit"], .z-button')]
        .filter((button) => isVisible(button) && normalizeText(button.textContent || button.value) === 'tamam');
    const buttons = rawButtons.filter((candidate) => !rawButtons.some((other) => other !== candidate && candidate.contains(other)));
    return buttons.length === 1 && !isButtonDisabled(buttons[0]) ? buttons[0] : null;
}

function acknowledgeGocnetQuery(rootDocument, applicationNumber, allowedStates = ['student_data_filled']) {
    if (!allowedStates.includes(readGocnetQueryResult(rootDocument, applicationNumber))) return false;
    const dialogs = findVisibleQueryDialogs(rootDocument);
    if (dialogs.length !== 1) return false;
    const button = findDialogTamamButton(dialogs[0]);
    if (!button) return false;
    button.click();
    return true;
}

function waitForTransferResult(rootDocument, readResult, timeoutMs = 30_000) {
    return new Promise((resolve) => {
        const Observer = rootDocument.defaultView?.MutationObserver;
        if (!Observer || !rootDocument.documentElement) return resolve(null);
        let settled = false;
        const observer = new Observer(check);
        const timer = rootDocument.defaultView.setTimeout(() => finish(null), timeoutMs);
        const finish = (result) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            rootDocument.defaultView.clearTimeout(timer);
            resolve(result);
        };
        function check() {
            const result = readResult(rootDocument);
            if (result) finish(result);
        }
        observer.observe(rootDocument.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        check();
    });
}

function validateGocnetPhoneNational(phoneNational) {
    if (phoneNational === undefined || phoneNational === null
        || (typeof phoneNational === 'string' && phoneNational.trim() === '')) {
        return { valid: false, reason: 'phone_missing' };
    }
    if (typeof phoneNational !== 'string' || !/^\d{7,10}$/.test(phoneNational)) {
        return { valid: false, reason: 'phone_invalid' };
    }
    return { valid: true, value: phoneNational };
}

async function writeAndVerifyGocnetPhone(rootDocument, phone, phoneNational, requestId) {
    if (phone.value === phoneNational && /^\d{7,10}$/.test(phone.value)) {
        return { verified: true };
    }
    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function'
        && typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'YOKSIS_ZK_COMMAND',
                command: { action: 'setGocnetPhone', phoneNational, requestId }
            });
            const currentPhone = findGocnetPhoneInput(rootDocument);
            if (response?.verified === true && currentPhone?.value === phoneNational
                && /^\d{7,10}$/.test(currentPhone.value)) {
                return { verified: true };
            }
            return { verified: false, reason: 'phone_write_failed' };
        } catch {
            return { verified: false, reason: 'phone_write_failed' };
        }
    }
    const view = rootDocument.defaultView;
    const setter = view?.HTMLInputElement?.prototype
        ? Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
        : null;
    if (setter) setter.call(phone, phoneNational);
    else phone.value = phoneNational;
    if (view?.Event) {
        phone.dispatchEvent(new view.Event('input', { bubbles: true }));
        phone.dispatchEvent(new view.Event('change', { bubbles: true }));
    }
    const currentPhone = findGocnetPhoneInput(rootDocument);
    if (!currentPhone || currentPhone.value !== phoneNational || !/^\d{7,10}$/.test(currentPhone.value)) {
        return { verified: false, reason: 'phone_write_failed' };
    }
    return { verified: true };
}

async function saveGocnetRecord(rootDocument, request) {
    const context = transferContexts.get(request.attemptId);
    if (!context || context.state !== 'student_data_filled' || context.applicationNumber !== request.applicationNumber
        || hasVisibleDialog(rootDocument)) return { state: 'unknown' };
    const phoneValidation = validateGocnetPhoneNational(request.phoneNational);
    if (!phoneValidation.valid) return { state: 'unknown', reason: phoneValidation.reason };
    const identityState = readGocnetIdentityMatch(rootDocument, request);
    if (identityState !== 'verified') return { state: identityState };
    const phone = findGocnetPhoneInput(rootDocument);
    const button = findGocnetSaveButton(rootDocument);
    if (!phone) return { state: 'unknown', reason: 'phone_input_missing' };
    if (!button) return { state: 'unknown' };
    const phoneWrite = await writeAndVerifyGocnetPhone(rootDocument, phone, phoneValidation.value, request.requestId);
    if (!phoneWrite.verified) return { state: 'unknown', reason: phoneWrite.reason };
    queryInProgress = true;
    try {
        const resultPromise = waitForTransferResult(rootDocument, readGocnetSaveResult);
        button.click();
        const result = await resultPromise;
        if (!result) {
            context.state = 'outcome_unknown';
            return { state: 'outcome_unknown' };
        }
        context.state = 'saved';
        context.recordId = result.recordId;
        return { state: 'saved', recordId: result.recordId };
    } finally {
        queryInProgress = false;
    }
}

async function uploadGocnetDocument(rootDocument, request) {
    const context = transferContexts.get(request.attemptId);
    if (!context || context.state !== 'saved' || context.applicationNumber !== request.applicationNumber
        || context.recordId !== request.recordId || hasVisibleDialog(rootDocument)
        || typeof request.pdfBase64 !== 'string' || request.pdfBase64.length > 12_582_912
        || !/^[a-f0-9]{64}$/.test(request.pdfSha256 || '')) return { state: 'unknown' };
    let file;
    try {
        const binary = atob(request.pdfBase64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_PDF_BYTES) return { state: 'unknown' };
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== request.pdfSha256 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
            return { state: 'unknown' };
        }
        file = new File([bytes], 'gocnet-basvuru.pdf', { type: 'application/pdf' });
    } catch {
        return { state: 'unknown' };
    }
    queryInProgress = true;
    context.state = 'uploading';
    try {
        const resultPromise = waitForTransferResult(rootDocument, readGocnetUploadResult);
        if (!dispatchGocnetPdfUpload(rootDocument, file)) {
            context.state = 'saved';
            return { state: 'not_dispatched' };
        }
        const result = await resultPromise;
        if (!result) {
            context.state = 'outcome_unknown';
            return { state: 'outcome_unknown' };
        }
        context.state = 'uploaded';
        context.documentId = result.documentId;
        return { state: 'uploaded', documentId: result.documentId };
    } finally {
        queryInProgress = false;
    }
}

function acknowledgeGocnetResult(rootDocument, request, expectedState, readResult) {
    const context = transferContexts.get(request.attemptId);
    if (!context || context.state !== expectedState) return false;
    const result = readResult(rootDocument);
    if (!result || (expectedState === 'saved' && result.recordId !== context.recordId)
        || (expectedState === 'uploaded' && result.documentId !== context.documentId)) return false;
    result.button.click();
    if (expectedState === 'uploaded') transferContexts.delete(request.attemptId);
    return true;
}

function normalizeIdentity(value) {
    return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
}

function normalizeFieldLabel(value) {
    return normalizeText(value).replace(/[():*]/g, '').trim();
}

/** Returns visible label elements matching the normalized field label. */
function findVisibleFieldLabels(rootDocument, labelText) {
    return [...rootDocument.querySelectorAll('.z-label, label, th, dt, strong, b')]
        .filter((label) => isVisible(label) && normalizeFieldLabel(label.textContent) === normalizeFieldLabel(labelText));
}

function findFieldValue(rootDocument, labelText) {
    const labels = findVisibleFieldLabels(rootDocument, labelText);
    if (labels.length !== 1) return null;
    const cell = labels[0].closest('td, th, dt');
    if (!cell) return null;
    let valueCell = cell.nextElementSibling;
    while (valueCell && valueCell.classList.contains('z-hbox-separator')) valueCell = valueCell.nextElementSibling;
    if (!valueCell) return null;
    const control = valueCell.querySelector('input:not([type="radio"]):not([type="file"]), select, textarea');
    if (control) return control instanceof rootDocument.defaultView.HTMLSelectElement
        ? control.selectedOptions?.[0]?.textContent?.trim() || '' : control.value.trim();
    return valueCell.textContent.trim();
}

function readGocnetIdentityMatch(rootDocument, expected) {
    const values = {
        studentNumber: findFieldValue(rootDocument, 'Öğrenci No (*)'),
        passportNumber: findFieldValue(rootDocument, 'Seyahat Belge No'),
        firstName: findFieldValue(rootDocument, 'Adı'),
        lastName: findFieldValue(rootDocument, 'Soyadı')
    };
    if (Object.values(values).some((value) => !value)) return 'unknown';
    if (Object.entries(values).some(([key, value]) => normalizeIdentity(value) !== normalizeIdentity(expected[key]))) {
        return 'identity_mismatch';
    }
    const requiredEducation = ['Eğitim Kademesi (*)', 'Okul Kayıt Tarihi (*)', 'Tahmini Bitiş Tar. (*)'];
    if (requiredEducation.some((label) => !findFieldValue(rootDocument, label))) return 'unknown';
    const newRecordRadios = [...rootDocument.querySelectorAll('input[type="radio"]')].filter((radio) => {
        const scope = radio.closest('.z-radio') || radio.parentElement;
        return isVisible(radio) && normalizeText(scope?.textContent).includes('1 = yeni kayıt');
    });
    if (newRecordRadios.length !== 1 || !newRecordRadios[0].checked) return 'unknown';
    return 'verified';
}

function findGocnetPhoneInput(rootDocument) {
    const inputs = [...rootDocument.querySelectorAll('input[placeholder="5XXXXXXXXX"][maxlength="10"]')].filter(isVisible);
    if (inputs.length === 1) {
        return !inputs[0].disabled && !inputs[0].readOnly ? inputs[0] : null;
    }
    if (inputs.length > 1) return null;
    for (const labelText of ['İrtibat Telefonu (*)', 'İrtibat Telefonu']) {
        const labels = findVisibleFieldLabels(rootDocument, labelText);
        if (labels.length !== 1) continue;
        let valueCell = labels[0].closest('td, th, dt')?.nextElementSibling || null;
        while (valueCell && valueCell.classList.contains('z-hbox-separator')) valueCell = valueCell.nextElementSibling;
        const control = valueCell?.querySelector('input:not([type="radio"]):not([type="file"]):not([type="hidden"])');
        if (control && isVisible(control) && !control.disabled && !control.readOnly) return control;
    }
    return null;
}

function findGocnetSaveButton(rootDocument) {
    const buttons = [...rootDocument.querySelectorAll('button, input[type="button"], input[type="submit"], .z-button')]
        .filter((button) => isVisible(button)
            && normalizeText(button.textContent || button.value).replace(/^\W+/, '') === 'işlemi başlat / kaydet');
    return buttons.length === 1 && !buttons[0].disabled ? buttons[0] : null;
}

function readGocnetSaveResult(rootDocument) {
    const dialogs = [...rootDocument.querySelectorAll('.z-messagebox-window')].filter(isVisible);
    if (dialogs.length !== 1) return null;
    const dialog = dialogs[0];
    const header = normalizeText(dialog.querySelector('.z-window-header')?.textContent);
    const body = normalizeText(dialog.querySelector('.z-messagebox')?.textContent);
    const recordId = /işlem kayıt no\s*:\s*(\d+)/i.exec(body)?.[1];
    if (header !== 'başarılı' || !body.includes('işlem kaydı göçnet sistemine ve yerel veritabanına başarıyla kaydedildi.')
        || !recordId || Number(recordId) < 1
        || findFieldValue(rootDocument, 'Mevcut GöçNet İşlem Kayıt No') !== recordId) return null;
    const buttons = [...dialog.querySelectorAll('button.z-messagebox-button, button')]
        .filter((button) => isVisible(button) && normalizeText(button.textContent) === 'tamam');
    return buttons.length === 1 ? { recordId, dialog, button: buttons[0] } : null;
}

function readGocnetUploadResult(rootDocument) {
    const dialogs = [...rootDocument.querySelectorAll('.z-messagebox-window')].filter(isVisible);
    if (dialogs.length !== 1) return null;
    const dialog = dialogs[0];
    const header = normalizeText(dialog.querySelector('.z-window-header')?.textContent);
    const body = normalizeText(dialog.querySelector('.z-messagebox')?.textContent);
    const documentId = /belge kayıt no\s*:\s*(\d+)/i.exec(body)?.[1];
    if (header !== 'belge yüklendi' || !body.includes("belge göçnet'e başarıyla iletildi.")
        || !documentId || Number(documentId) < 1) return null;
    const lists = [...rootDocument.querySelectorAll('.z-listbox')].filter((list) => {
        const headers = [...list.querySelectorAll('.z-listbox-header th')].map((cell) => normalizeFieldLabel(cell.textContent));
        return ['kod', 'belge başlığı', 'yükleme durumu', 'göçnet belge kayıt no'].every((label) => headers.includes(label));
    });
    if (lists.length !== 1) return null;
    const headers = [...lists[0].querySelectorAll('.z-listbox-header th')].map((cell) => normalizeFieldLabel(cell.textContent));
    const indexes = ['kod', 'belge başlığı', 'yükleme durumu', 'göçnet belge kayıt no'].map((label) => headers.indexOf(label));
    const rows = [...lists[0].querySelectorAll('.z-listbox-body tr.z-listitem')].filter(isVisible);
    const row = rows.filter((item) => {
        const cells = [...item.querySelectorAll('td')];
        return normalizeText(cells[indexes[0]]?.textContent) === '999'
            && normalizeText(cells[indexes[1]]?.textContent) === 'başvuru belgeleri';
    });
    const buttons = [...dialog.querySelectorAll('button.z-messagebox-button, button')]
        .filter((button) => isVisible(button) && normalizeText(button.textContent) === 'tamam');
    return row.length === 1 && normalizeText(row[0].querySelectorAll('td')[indexes[2]]?.textContent) === 'yüklendi'
        && row[0].querySelectorAll('td')[indexes[3]]?.textContent.trim() === documentId && buttons.length === 1
        ? { documentId, dialog, button: buttons[0] } : null;
}

let lastReason = '';
function noteReason(code) { lastReason = code; return 'unknown'; }

/** Returns no_match only after a fresh, exact, unfiltered history query shows its explicit empty state. */
function readGocnetRecordListResult(rootDocument, { applicationNumber, freshResponse, busy = false } = {}) {
    if (!rootDocument || freshResponse !== true || busy || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber || '')) return noteReason('bad_input');
    const headings = [...rootDocument.querySelectorAll('h1, h2, h3, h4, h5, legend, .z-caption, .z-groupbox-legend')]
        .filter((heading) => isVisible(heading)
            && normalizeText(heading.textContent).replace(/^[^\p{L}\p{N}]+/u, '').startsWith('kayıtlı ikamet işlemleri listesi'));
    if (headings.length !== 1) return noteReason(`heading_count_${headings.length}`);
    const hasHistoryHeaders = (list) => {
        const headers = [...list.querySelectorAll('.z-listbox-header th')].map((cell) => normalizeText(cell.textContent));
        return ['e-ikamet başvuru no', 'öğrenci no', 'göçnet kayıt no'].every((header) => headers.includes(header));
    };
    let section = headings[0];
    let lists = [];
    for (let depth = 0; section && depth < 8; section = section.parentElement, depth += 1) {
        lists = [...section.querySelectorAll('.z-listbox')].filter(hasHistoryHeaders);
        if (lists.length) break;
    }
    if (lists.length !== 1) return noteReason(`list_count_${lists.length}`);
    const list = lists[0];
    const numberFilters = [...section.querySelectorAll('input[placeholder="Tüm veya kısmi no..."]')].filter(isVisible);
    const studentFilters = [...section.querySelectorAll('input[placeholder="Öğrenci no..."]')].filter(isVisible);
    const processFilters = [...section.querySelectorAll('select')].filter(isVisible);
    if (numberFilters.length !== 1 || numberFilters[0].value !== applicationNumber || studentFilters.length !== 1
        || studentFilters[0].value.trim() !== '' || processFilters.length !== 1
        || normalizeText(processFilters[0].selectedOptions?.[0]?.textContent) !== '-- tümü --') return noteReason(`filter_state_n${numberFilters.length}_s${studentFilters.length}_p${processFilters.length}`);
    if ([...section.querySelectorAll('.z-paging')].some(isVisible)) return noteReason('paging_visible');
    const rows = [...list.querySelectorAll('.z-listbox-body tr.z-listitem')].filter(isVisible);
    const numberIndex = [...list.querySelectorAll('.z-listbox-header th')]
        .findIndex((cell) => normalizeText(cell.textContent) === 'e-ikamet başvuru no');
    if (numberIndex < 0) return noteReason('no_number_column');
    if (rows.length) {
        return rows.length === 1
            && normalizeText(rows[0].querySelectorAll('td')[numberIndex]?.textContent) === normalizeText(applicationNumber)
            ? 'existing_record' : noteReason('row_mismatch');
    }
    const emptyMessages = [...list.querySelectorAll('.z-listbox-emptybody-content')].filter(isVisible);
    return emptyMessages.length === 1
        && normalizeText(emptyMessages[0].textContent).startsWith('veritabanında kayıtlı ikamet işlemi bulunamadı.')
        ? 'no_match' : noteReason('empty_state_missing');
}

// Form komutu neden kodlarını ilk sırada koruyarak portalın hata kaynağını ayırmasını sağlar.
function formatFormCommandFailureReason(error) {
    const text = String(error || '').slice(0, 110);
    return /^(?:bad_input|form_dialog_already_open|form_controls_missing|form_controls_ambiguous|form_controls_disabled|form_zk_widget_missing|form_value_not_retained|form_value_no_response|form_click_no_response)\b/.test(text)
        ? text
        : (text ? `form_command_failed: ${text}` : 'form_command_failed');
}

/** Performs one read-only exact-number lookup; every unrecognized result fails closed. */
async function queryGocnetRegistration(rootDocument, applicationNumber, { signal, timeoutMs = GOCNET_QUERY_TIMEOUT_MS, requestId } = {}) {
    lastReason = '';
    if (!rootDocument || typeof applicationNumber !== 'string' || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)) {
        return noteReason('bad_input');
    }
    if (signal?.aborted) return noteReason('form_result_aborted');
    if (hasVisibleDialog(rootDocument)) return noteReason('form_dialog_already_open');

    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
        if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
            return noteReason('bad_input');
        }
        const view = rootDocument.defaultView;
        const AbortCtor = view?.AbortController || globalThis.AbortController;
        const waitController = AbortCtor ? new AbortCtor() : null;
        const onParentAbort = () => waitController?.abort();
        signal?.addEventListener('abort', onParentAbort, { once: true });
        const setTimer = view?.setTimeout ? view.setTimeout.bind(view) : setTimeout;
        const clearTimer = view?.clearTimeout ? view.clearTimeout.bind(view) : clearTimeout;
        const resultPromise = waitForQueryResult(rootDocument, applicationNumber, waitController?.signal || signal, timeoutMs);
        let commandTimer = null;
        const commandTimeoutPromise = new Promise((resolve) => {
            commandTimer = setTimer(() => resolve({ __timedOut: true }), timeoutMs);
        });
        try {
            const commandPromise = Promise.resolve(chrome.runtime.sendMessage({
                action: 'YOKSIS_ZK_COMMAND',
                command: { action: 'queryGocnetForm', applicationNumber, requestId }
            }));
            commandPromise.catch(() => {});
            const response = await Promise.race([commandPromise, commandTimeoutPromise]);
            clearTimer(commandTimer);
            commandTimer = null;
            if (signal?.aborted) {
                waitController?.abort();
                await resultPromise.catch(() => {});
                return noteReason('form_result_aborted');
            }
            if (response?.__timedOut) {
                const waited = await resultPromise;
                if (waited !== 'unknown') return waited;
                return noteReason(lastReason || 'form_result_timeout');
            }
            if (response?.success !== true || response.freshResponse !== true) {
                const reason = response?.success === true
                    ? 'form_command_stale'
                    : formatFormCommandFailureReason(response?.error);
                if (response?.success !== true && /^form_click_no_response\b/.test(reason)) {
                    const waited = await resultPromise;
                    if (waited !== 'unknown') return waited;
                    const waiterReason = lastReason && lastReason !== 'form_result_timeout' ? lastReason : '';
                    return noteReason(waiterReason || reason);
                }
                waitController?.abort();
                await resultPromise.catch(() => {});
                return noteReason(reason);
            }
            return await resultPromise;
        } catch {
            waitController?.abort();
            await resultPromise.catch(() => {});
            return noteReason(signal?.aborted ? 'form_result_aborted' : 'form_command_failed');
        } finally {
            if (commandTimer !== null) clearTimer(commandTimer);
            signal?.removeEventListener('abort', onParentAbort);
        }
    }

    let controls = findQueryControls(rootDocument);
    if (!controls) return noteReason('form_controls_missing');
    if (controls.input.disabled || controls.input.readOnly || isButtonDisabled(controls.button)) {
        return noteReason('form_controls_disabled');
    }
    const view = rootDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(controls.input, applicationNumber);
    else controls.input.value = applicationNumber;
    controls.input.dispatchEvent(new view.Event('input', { bubbles: true }));
    controls.input.dispatchEvent(new view.Event('change', { bubbles: true }));

    controls = findQueryControls(rootDocument);
    if (!controls) return noteReason('form_controls_missing');
    if (controls.input.disabled || controls.input.readOnly || isButtonDisabled(controls.button)) {
        return noteReason('form_controls_disabled');
    }
    if (controls.input.value !== applicationNumber) return noteReason('form_value_not_retained');
    if (signal?.aborted) return noteReason('form_result_aborted');
    if (hasVisibleDialog(rootDocument)) return noteReason('form_dialog_already_open');
    const resultPromise = waitForQueryResult(rootDocument, applicationNumber, signal, timeoutMs);
    const clickable = controls.button.querySelector?.('button, input[type="button"], input[type="submit"]') || controls.button;
    clickable.click();
    return resultPromise;
}

// Ekran kapısı kodlarını ilk sırada koruyarak portalın neden kodunu tanımasını sağlar.
function formatZkCommandFailureReason(error) {
    const text = String(error || '').slice(0, 110);
    return /^(?:not_on_gocnet_screen|history_section_missing)\b/.test(text)
        ? text
        : `zk_command_failed: ${text}`;
}

async function queryGocnetRecordList(rootDocument, applicationNumber, requestId) {
    lastReason = '';
    if (!rootDocument || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)
        || typeof requestId !== 'string' || requestId.length > 128 || typeof chrome === 'undefined') return 'unknown';
    try {
        const response = await chrome.runtime.sendMessage({ action: 'YOKSIS_ZK_COMMAND', command: {
            action: 'queryGocnetRecords', applicationNumber, requestId
        } });
        if (response?.success !== true || response.freshResponse !== true) {
            return noteReason(response?.success === true ? 'zk_command_stale' : formatZkCommandFailureReason(response?.error));
        }
        return readGocnetRecordListResult(rootDocument, { applicationNumber, freshResponse: true });
    } catch {
        return 'unknown';
    }
}

/** Resolves the unique, not-yet-uploaded 999 application-document row and its own upload controls. */
function findGocnetApplicationDocumentUploadTarget(rootDocument) {
    if (!rootDocument) return null;
    const headingText = 'göçnet tarafından istenen belgeler & yükleme işlemleri';
    const headings = [...rootDocument.querySelectorAll('h1, h2, h3, h4, h5, legend, [role="heading"], .z-groupbox-legend')]
        .filter((heading) => isVisible(heading) && normalizeText(heading.textContent).includes(headingText));
    if (headings.length !== 1) return null;
    let section = headings[0].parentElement;
    for (let depth = 0; section && depth < 6 && !section.querySelector('tr'); section = section.parentElement, depth += 1) {}
    if (!section) return null;

    const matchingRows = [...section.querySelectorAll('tr')].filter((row) => {
        const cells = [...row.querySelectorAll('th, td')].map((cell) => normalizeText(cell.textContent));
        return cells.includes('999') && cells.includes('başvuru belgeleri');
    });
    if (matchingRows.length !== 1 || [...matchingRows[0].querySelectorAll('th, td')]
        .some((cell) => normalizeText(cell.textContent) === 'yüklendi')) return null;
    const row = matchingRows[0];
    const buttons = [...row.querySelectorAll('button, input[type="button"], input[type="submit"]')]
        .filter((button) => isVisible(button) && normalizeText(button.textContent || button.value) === 'yükle');
    const inputs = [...row.querySelectorAll('input[type="file"]')].filter(isVisible);
    if (buttons.length !== 1 || inputs.length !== 1 || buttons[0].disabled || inputs[0].disabled || inputs[0].multiple) return null;
    return { row, button: buttons[0], input: inputs[0] };
}

/** Dispatches one bounded PDF to the exact row input; this does not confirm YÖKSİS accepted it. */
function dispatchGocnetPdfUpload(rootDocument, pdfFile) {
    if (!rootDocument || pdfFile?.type !== 'application/pdf' || !pdfFile.name?.toLowerCase().endsWith('.pdf')
        || !Number.isSafeInteger(pdfFile.size) || pdfFile.size < 1 || pdfFile.size > MAX_PDF_BYTES) return false;
    const target = findGocnetApplicationDocumentUploadTarget(rootDocument);
    const DataTransferConstructor = rootDocument.defaultView?.DataTransfer;
    if (!target || !DataTransferConstructor) return false;
    try {
        const transfer = new DataTransferConstructor();
        transfer.items.add(pdfFile);
        target.input.files = transfer.files;
        const assignedFiles = target.input.files;
        if (!target.input.isConnected || assignedFiles?.length !== 1 || assignedFiles[0]?.name !== pdfFile.name
            || assignedFiles[0]?.size !== pdfFile.size || assignedFiles[0]?.type !== 'application/pdf') return false;
        target.input.dispatchEvent(new rootDocument.defaultView.Event('change', { bubbles: true }));
        return true;
    } catch {
        return false;
    }
}

/** Extracts a 1-12 digit GöçNet process record number from section 3 info bar text, or null. */
function parseIslemKayitNo(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const match = /^(\d{1,12})(?:\s*\([^)]+\))?$/.exec(rawValue.trim());
    return match && /^\d{1,12}$/.test(match[1]) ? match[1] : null;
}

function formatLookupFailureReason(rawReason) {
    if (!rawReason) return 'query_unknown';
    return rawReason.startsWith('form_result_unrecognized')
        ? rawReason.replace(/^form_result_unrecognized/, 'result_unrecognised')
        : rawReason;
}

/** Runs a strictly read-only Başvuru Sorgula lookup and reads Başvuru Kayıt No and İşlem Kayıt No. */
async function lookupGocnetRecord(rootDocument, applicationNumber, { signal, timeoutMs = GOCNET_QUERY_TIMEOUT_MS, requestId } = {}) {
    if (!rootDocument || typeof applicationNumber !== 'string' || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)) {
        return { state: 'unknown', reason: 'bad_input' };
    }
    if (queryInProgress || transferContexts.size > 0) {
        return { state: 'unknown', reason: 'busy' };
    }
    queryInProgress = true;
    lastReason = '';
    const totalStartedAt = Date.now();
    let queryMs = 0;
    let readMs = 0;
    let finalState = 'unknown';
    try {
        const queryStartedAt = Date.now();
        let queryState;
        try {
            queryState = await queryGocnetRegistration(rootDocument, applicationNumber, { signal, timeoutMs, requestId });
        } finally {
            queryMs = Math.max(0, Date.now() - queryStartedAt);
        }
        if (queryState === 'no_match') {
            const readStartedAt = Date.now();
            try {
                acknowledgeGocnetQuery(rootDocument, applicationNumber, ['no_match']);
            } finally {
                readMs = Math.max(0, Date.now() - readStartedAt);
            }
            finalState = 'no_match';
            return { state: 'no_match' };
        }
        if (queryState !== 'student_data_filled' && queryState !== 'existing_record') {
            finalState = 'unknown';
            return { state: 'unknown', reason: formatLookupFailureReason(lastReason) };
        }
        if (!isExactSearchField(rootDocument, applicationNumber)) {
            finalState = 'unknown';
            return { state: 'unknown', reason: 'form_search_value_mismatch' };
        }
        const readStartedAt = Date.now();
        try {
            const basvuruCount = findVisibleFieldLabels(rootDocument, 'Başvuru Kayıt No').length;
            const islemCount = findVisibleFieldLabels(rootDocument, 'Mevcut GöçNet İşlem Kayıt No').length;
            const rawBasvuru = basvuruCount === 1 ? findFieldValue(rootDocument, 'Başvuru Kayıt No') : null;
            const rawIslem = islemCount === 1 ? findFieldValue(rootDocument, 'Mevcut GöçNet İşlem Kayıt No') : null;
            acknowledgeGocnetQuery(rootDocument, applicationNumber, ['student_data_filled', 'existing_record']);

            if (basvuruCount !== 1) {
                finalState = 'unknown';
                return { state: 'unknown', reason: basvuruCount > 1 ? 'ambiguous_fields' : 'basvuru_kayit_no_missing' };
            }
            if (islemCount > 1) {
                finalState = 'unknown';
                return { state: 'unknown', reason: 'ambiguous_fields' };
            }
            if (typeof rawBasvuru !== 'string' || !/^\d{1,12}$/.test(rawBasvuru.trim())) {
                finalState = 'unknown';
                return { state: 'unknown', reason: 'basvuru_kayit_no_invalid' };
            }
            const basvuruKayitNo = rawBasvuru.trim();
            const islemKayitNo = parseIslemKayitNo(rawIslem);
            finalState = 'found';
            return {
                state: 'found',
                basvuruKayitNo,
                ...(islemKayitNo ? { islemKayitNo } : {})
            };
        } finally {
            readMs = Math.max(0, Date.now() - readStartedAt);
        }
    } catch {
        finalState = 'error';
        return { state: 'unknown', reason: 'form_query_exception' };
    } finally {
        const totalMs = Math.max(0, Date.now() - totalStartedAt);
        console?.info?.('[YKN][timing] gocnet lookup', {
            queryMs,
            readMs,
            totalMs,
            state: finalState
        });
        lastReason = '';
        queryInProgress = false;
    }
}

function isValidGocnetPdfFile(pdfFile) {
    return Boolean(pdfFile
        && pdfFile.type === 'application/pdf'
        && typeof pdfFile.name === 'string'
        && pdfFile.name.toLowerCase().endsWith('.pdf')
        && Number.isSafeInteger(pdfFile.size)
        && pdfFile.size >= 1
        && pdfFile.size <= MAX_PDF_BYTES);
}

async function resolveGocnetPdfFile(rootDocument, { pdfFile, pdfBase64, pdfSha256, pdfFileName } = {}) {
    if (pdfFile !== undefined && pdfFile !== null) {
        return isValidGocnetPdfFile(pdfFile) ? { file: pdfFile } : { error: 'pdf_invalid' };
    }
    if (typeof pdfBase64 !== 'string' || !pdfBase64) {
        return { error: 'pdf_missing' };
    }
    if (pdfBase64.length > 12_582_912) {
        return { error: 'pdf_invalid' };
    }
    if (pdfSha256 !== undefined && !/^[a-f0-9]{64}$/.test(pdfSha256 || '')) {
        return { error: 'pdf_invalid' };
    }
    try {
        const binary = atob(pdfBase64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_PDF_BYTES
            || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
            return { error: 'pdf_invalid' };
        }
        if (pdfSha256) {
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
                .map((byte) => byte.toString(16).padStart(2, '0')).join('');
            if (digest !== pdfSha256) return { error: 'pdf_invalid' };
        }
        const FileCtor = rootDocument?.defaultView?.File || globalThis.File;
        const safeName = typeof pdfFileName === 'string' && pdfFileName.toLowerCase().endsWith('.pdf')
            ? pdfFileName : 'gocnet-basvuru.pdf';
        return { file: new FileCtor([bytes], safeName, { type: 'application/pdf' }) };
    } catch {
        return { error: 'pdf_invalid' };
    }
}

function readSaveDialogOutcome(rootDocument) {
    const saveResult = readGocnetSaveResult(rootDocument);
    if (saveResult) {
        return { kind: 'saved', recordId: saveResult.recordId, dialog: saveResult.dialog, button: saveResult.button };
    }
    const dialogs = findVisibleQueryDialogs(rootDocument);
    if (dialogs.length === 1) {
        const dialog = dialogs[0];
        const header = normalizeText(findDialogHeaderNode(dialog)?.textContent);
        const body = normalizeText(dialog.textContent);
        if (header.includes('hata') || header.includes('başarısız') || body.includes('hata kodu:')) {
            return { kind: 'error', dialog };
        }
        const button = findDialogTamamButton(dialog);
        if (button) {
            return { kind: 'dialog', dialog, button };
        }
        if (body) {
            return { kind: 'dialog_no_tamam', dialog };
        }
    }
    if (!hasVisibleDialog(rootDocument) && findGocnetApplicationDocumentUploadTarget(rootDocument)) {
        return { kind: 'upload_ready' };
    }
    return null;
}

function readReadyUploadTarget(rootDocument, context) {
    const saveResult = readGocnetSaveResult(rootDocument);
    if (saveResult) {
        if (context && !context.recordId) context.recordId = saveResult.recordId;
        saveResult.button.click();
        return null;
    }
    if (hasVisibleDialog(rootDocument)) return null;
    return findGocnetApplicationDocumentUploadTarget(rootDocument);
}

function findOrCreateAutoSaveContext(applicationNumber, attemptId) {
    if (attemptId && transferContexts.has(attemptId)) {
        return { key: attemptId, context: transferContexts.get(attemptId) };
    }
    for (const [key, existing] of transferContexts.entries()) {
        if (existing?.applicationNumber === applicationNumber) {
            return { key, context: existing };
        }
    }
    const key = attemptId || applicationNumber;
    const context = { applicationNumber, state: 'initialized' };
    transferContexts.set(key, context);
    return { key, context };
}

/**
 * Completes the GöçNet save + confirmation popup + upload section wait + PDF dispatch flow.
 * Resumable per application: skips clicking save when the record is already saved or exists.
 */
async function autoSaveAndUploadGocnet(rootDocument, request = {}) {
    const { applicationNumber, attemptId, existingRecord = false, islemKayitNo, timeoutMs = 12_000 } = request || {};
    if (!rootDocument || typeof applicationNumber !== 'string' || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)) {
        return { state: 'unknown', reason: 'bad_input' };
    }
    if (queryInProgress) {
        return { state: 'unknown', reason: 'busy' };
    }
    const resolvedPdf = await resolveGocnetPdfFile(rootDocument, request);
    if (resolvedPdf.error) {
        return { state: 'unknown', reason: resolvedPdf.error };
    }

    const { key: contextKey, context } = findOrCreateAutoSaveContext(applicationNumber, attemptId);
    if (context.applicationNumber !== applicationNumber) {
        return { state: 'unknown', reason: 'bad_input' };
    }

    const domIslemNo = parseIslemKayitNo(findFieldValue(rootDocument, 'Mevcut GöçNet İşlem Kayıt No') || '');
    const explicitIslemNo = parseIslemKayitNo(typeof islemKayitNo === 'string' ? islemKayitNo : '');
    if (domIslemNo && !context.recordId) context.recordId = domIslemNo;
    if (explicitIslemNo && !context.recordId) context.recordId = explicitIslemNo;

    let alreadySaved = Boolean(
        existingRecord === true
        || domIslemNo
        || explicitIslemNo
        || context.state === 'saved'
        || context.state === 'existing_record'
        || context.state === 'uploaded'
        || context.state === 'dispatched'
    );

    if (hasVisibleDialog(rootDocument)) {
        const queryState = readGocnetQueryResult(rootDocument, applicationNumber);
        if (queryState === 'existing_record') {
            acknowledgeGocnetQuery(rootDocument, applicationNumber, ['existing_record']);
            alreadySaved = true;
            context.state = 'saved';
        } else if (queryState === 'student_data_filled') {
            if (!acknowledgeGocnetQuery(rootDocument, applicationNumber, ['student_data_filled'])) {
                return { state: 'unknown', reason: 'dialog_already_open' };
            }
        } else {
            const saveDialog = readGocnetSaveResult(rootDocument);
            if (saveDialog) {
                context.recordId = saveDialog.recordId;
                context.state = 'saved';
                alreadySaved = true;
                saveDialog.button.click();
            } else {
                return { state: 'unknown', reason: 'dialog_already_open' };
            }
        }
    }

    queryInProgress = true;
    let saveClicked = false;
    try {
        if (!alreadySaved) {
            const saveButton = findGocnetSaveButton(rootDocument);
            if (!saveButton) {
                return { state: 'unknown', reason: 'save_button_missing' };
            }
            const outcomePromise = waitForTransferResult(rootDocument, readSaveDialogOutcome, timeoutMs);
            saveButton.click();
            saveClicked = true;
            const outcome = await outcomePromise;
            if (!outcome) {
                return { state: 'unknown', reason: 'save_no_response' };
            }
            if (outcome.kind === 'error') {
                return { state: 'unknown', reason: 'save_failed' };
            }
            if (outcome.kind === 'dialog_no_tamam') {
                return { state: 'unknown', reason: 'save_popup_ack_failed' };
            }
            if (outcome.kind === 'saved' || outcome.kind === 'dialog') {
                if (outcome.recordId) context.recordId = outcome.recordId;
                context.state = 'saved';
                outcome.button.click();
            } else if (outcome.kind === 'upload_ready') {
                context.state = 'saved';
            }
        } else if (context.state !== 'saved') {
            context.state = 'saved';
        }

        const uploadTarget = await waitForTransferResult(
            rootDocument,
            (doc) => readReadyUploadTarget(doc, context),
            timeoutMs
        );
        if (!uploadTarget) {
            return { state: 'unknown', reason: 'upload_section_missing' };
        }
        if (!dispatchGocnetPdfUpload(rootDocument, resolvedPdf.file)) {
            return { state: 'unknown', reason: 'pdf_dispatch_failed' };
        }
        const recordId = context.recordId;
        transferContexts.delete(contextKey);
        return {
            state: 'dispatched',
            saveClicked,
            ...(recordId ? { recordId } : {})
        };
    } finally {
        queryInProgress = false;
    }
}

globalThis.YoksisGocnetTransferController = Object.freeze({
    autoSaveAndUploadGocnet,
    dispatchGocnetPdfUpload,
    findGocnetApplicationDocumentUploadTarget,
    findGocnetPhoneInput,
    findGocnetSaveButton,
    getLastReason: () => lastReason,
    lookupGocnetRecord,
    parseIslemKayitNo,
    queryGocnetRegistration,
    queryGocnetRecordList,
    readGocnetUploadResult,
    readGocnetRecordListResult,
    readGocnetQueryResult,
    saveGocnetRecord,
    validateGocnetPhoneNational
});

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage
    && location.protocol === 'https:' && location.hostname === 'yoksis.yok.gov.tr' && window === window.top) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (sender.id !== chrome.runtime.id || sender.tab || typeof request?.requestId !== 'string' || request.requestId.length > 128
            || !Number.isInteger(request.portalTabId) || request.portalTabId < 0
            || (request.applicationNumber !== undefined && (typeof request.applicationNumber !== 'string'
                || !/^20\d{2}-\d{2}-\d{5,8}$/.test(request.applicationNumber)))) return false;
        if (request.action === 'YOKSIS_GOCNET_LOOKUP' && (queryInProgress || transferContexts.size > 0)) {
            sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'busy' });
            return false;
        }
        if (queryInProgress) {
            sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'controller_busy' });
            return false;
        }
        if (globalThis.YoksisDocumentAuditController?.isActive?.()) {
            sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'document_audit_active' });
            return false;
        }
        if (request.action === 'YOKSIS_GOCNET_LOOKUP' && typeof request.applicationNumber === 'string') {
            void lookupGocnetRecord(document, request.applicationNumber, {
                requestId: request.requestId,
                timeoutMs: GOCNET_QUERY_TIMEOUT_MS
            }).then((result) => sendResponse({ requestId: request.requestId, ...result }))
              .catch(() => sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'form_query_exception' }));
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_QUERY' && ['form', 'history'].includes(request.phase || 'form')
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.attemptId || '')) {
            queryInProgress = true;
            lastReason = '';
            const query = request.phase === 'history'
                ? queryGocnetRecordList(document, request.applicationNumber, request.requestId)
                : queryGocnetRegistration(document, request.applicationNumber, { requestId: request.requestId, timeoutMs: 120_000 });
            void query
                .then((state) => {
                    if (state === 'student_data_filled' && acknowledgeGocnetQuery(document, request.applicationNumber)) {
                        transferContexts.set(request.attemptId, {
                            applicationNumber: request.applicationNumber, state
                        });
                    }
                    const ackFailed = state === 'student_data_filled' && !transferContexts.has(request.attemptId);
                    const out = ackFailed ? 'unknown' : state;
                    const reason = ackFailed ? 'form_ack_failed' : lastReason;
                    lastReason = '';
                    queryInProgress = false;
                    sendResponse({ requestId: request.requestId, state: out, ...(out === 'unknown' && reason ? { reason } : {}) });
                })
                .catch(() => {
                    lastReason = '';
                    queryInProgress = false;
                    sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'form_query_exception' });
                })
                .finally(() => { queryInProgress = false; });
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_SAVE' && request.applicationNumber
            && typeof request.studentNumber === 'string' && typeof request.passportNumber === 'string'
            && typeof request.firstName === 'string' && typeof request.lastName === 'string') {
            void saveGocnetRecord(document, request)
                .then((result) => sendResponse({ requestId: request.requestId, ...result }))
                .catch(() => sendResponse({ requestId: request.requestId, state: 'unknown' }));
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD' && request.applicationNumber) {
            void autoSaveAndUploadGocnet(document, request)
                .then((result) => sendResponse({ requestId: request.requestId, ...result }))
                .catch(() => sendResponse({ requestId: request.requestId, state: 'unknown', reason: 'auto_save_exception' }));
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_UPLOAD' && request.applicationNumber
            && /^\d{1,12}$/.test(request.recordId || '')) {
            void uploadGocnetDocument(document, request)
                .then((result) => sendResponse({ requestId: request.requestId, ...result }))
                .catch(() => sendResponse({ requestId: request.requestId, state: 'outcome_unknown' }));
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_ACK_SAVE') {
            sendResponse({ requestId: request.requestId,
                success: acknowledgeGocnetResult(document, request, 'saved', readGocnetSaveResult) });
            return false;
        }
        if (request.action === 'YOKSIS_GOCNET_ACK_UPLOAD') {
            sendResponse({ requestId: request.requestId,
                success: acknowledgeGocnetResult(document, request, 'uploaded', readGocnetUploadResult) });
            return false;
        }
        return false;
    });
}
})();
