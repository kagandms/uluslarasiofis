(() => {
if (globalThis.__YOKSIS_GOCNET_TRANSFER_CONTROLLER_LOADED__) return;
globalThis.__YOKSIS_GOCNET_TRANSFER_CONTROLLER_LOADED__ = true;

const QUERY_LABEL = 'e-ikamet başvuru no';
const MAX_PDF_BYTES = 9 * 1024 * 1024;
const QUERY_RESULT_MESSAGES = Object.freeze({
    no_match: ['sorgu hatası', 'başvuru sorgulama başarısız!', 'hata kodu: veri bulunamadı', 'detay: kayıt bulunamadı'],
    existing_record: ['sorgulama başarılı (db kaydı yüklendi)', 'başvuru sorgulama başarılı.',
        'öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.'],
    student_data_filled: ['sorgulama başarılı (yöksis verileri dolduruldu)',
        'başvuru sorgulama başarılı.', 'yöksis veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve form otomatik dolduruldu.']
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

function isExactSearchField(document, applicationNumber) {
    return findQueryControls(document)?.input.value === applicationNumber;
}

function findQueryControls(rootDocument) {
    const inputs = [...rootDocument.querySelectorAll('input:not([type]), input[type="text"]')].filter(isVisible);
    const labeledInputs = inputs.filter((input) => {
        for (let parent = input.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth += 1) {
            const text = normalizeText(parent.textContent);
            if (text.includes('1. e-ikamet başvuru sorgulama') && text.includes(QUERY_LABEL)) return true;
        }
        return false;
    });
    if (labeledInputs.length !== 1) return null;
    const input = labeledInputs[0];
    for (let scope = input.parentElement, depth = 0; scope && depth < 7; scope = scope.parentElement, depth += 1) {
        const text = normalizeText(scope.textContent);
        if (!text.includes('1. e-ikamet başvuru sorgulama') || !text.includes(QUERY_LABEL)) continue;
        const buttons = [...scope.querySelectorAll('button, input[type="button"], input[type="submit"]')]
            .filter((button) => isVisible(button) && normalizeText(button.textContent || button.value) === 'başvuru sorgula');
        if (buttons.length === 1) return { input, button: buttons[0] };
        if (buttons.length > 1) return null;
    }
    return null;
}

function hasVisibleDialog(rootDocument) {
    return [...rootDocument.querySelectorAll('[role="dialog"], .z-window-modal')].some(isVisible);
}

function waitForQueryResult(rootDocument, applicationNumber, signal, timeoutMs) {
    return new Promise((resolve) => {
        const Observer = rootDocument.defaultView?.MutationObserver;
        if (!Observer || !rootDocument.documentElement) {
            resolve('unknown');
            return;
        }
        let settled = false;
        const observer = new Observer(check);
        const timer = rootDocument.defaultView.setTimeout(() => finish('unknown'), timeoutMs);
        const finish = (result) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            rootDocument.defaultView.clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve(result);
        };
        const abort = () => finish('unknown');
        function check() {
            const result = readGocnetQueryResult(rootDocument, applicationNumber);
            if (result !== 'unknown') finish(result);
            else if (hasVisibleDialog(rootDocument)) finish('unknown');
        }
        observer.observe(rootDocument.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) finish('unknown');
        else check();
    });
}

/** Returns no_match only for the exact explicit YÖKSİS response; all other DOM states remain unknown. */
function readGocnetQueryResult(rootDocument, applicationNumber) {
    if (!rootDocument || typeof applicationNumber !== 'string' || !isExactSearchField(rootDocument, applicationNumber)) {
        return 'unknown';
    }
    const dialogs = [...rootDocument.querySelectorAll('[role="dialog"], .z-window-modal')]
        .filter(isVisible);
    if (dialogs.length !== 1) return 'unknown';
    const dialogText = normalizeText(dialogs[0].textContent);
    return Object.entries(QUERY_RESULT_MESSAGES).find(([, messages]) => messages.every((message) => dialogText.includes(message)))?.[0]
        || 'unknown';
}

function acknowledgeGocnetQuery(rootDocument, applicationNumber) {
    if (readGocnetQueryResult(rootDocument, applicationNumber) !== 'student_data_filled') return false;
    const dialogs = [...rootDocument.querySelectorAll('[role="dialog"], .z-window-modal')].filter(isVisible);
    if (dialogs.length !== 1) return false;
    const buttons = [...dialogs[0].querySelectorAll('button.z-messagebox-button, button')]
        .filter((button) => isVisible(button) && normalizeText(button.textContent) === 'tamam');
    if (buttons.length !== 1) return false;
    buttons[0].click();
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

async function saveGocnetRecord(rootDocument, request) {
    const context = transferContexts.get(request.attemptId);
    if (!context || context.state !== 'student_data_filled' || context.applicationNumber !== request.applicationNumber
        || hasVisibleDialog(rootDocument)) return { state: 'unknown' };
    const identityState = readGocnetIdentityMatch(rootDocument, request);
    if (identityState !== 'verified') return { state: identityState };
    const phone = findGocnetPhoneInput(rootDocument);
    const button = findGocnetSaveButton(rootDocument);
    if (!phone || phone.value !== request.phoneNational || !/^5\d{9}$/.test(phone.value) || !button) return { state: 'unknown' };
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

function findFieldValue(rootDocument, labelText) {
    const labels = [...rootDocument.querySelectorAll('.z-label, label, th, dt, strong, b')]
        .filter((label) => isVisible(label) && normalizeFieldLabel(label.textContent) === normalizeFieldLabel(labelText));
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
    return inputs.length === 1 && !inputs[0].disabled && !inputs[0].readOnly ? inputs[0] : null;
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

/** Returns no_match only after a fresh, exact, unfiltered history query shows its explicit empty state. */
function readGocnetRecordListResult(rootDocument, { applicationNumber, freshResponse, busy = false } = {}) {
    if (!rootDocument || freshResponse !== true || busy || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber || '')) return 'unknown';
    const headings = [...rootDocument.querySelectorAll('h1, h2, h3, h4, h5, legend, .z-caption, .z-groupbox-legend')]
        .filter((heading) => isVisible(heading)
            && normalizeText(heading.textContent).replace(/^[^\p{L}\p{N}]+/u, '').startsWith('kayıtlı ikamet işlemleri listesi'));
    if (headings.length !== 1) return 'unknown';
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
    if (lists.length !== 1) return 'unknown';
    const list = lists[0];
    const numberFilters = [...section.querySelectorAll('input[placeholder="Tüm veya kısmi no..."]')].filter(isVisible);
    const studentFilters = [...section.querySelectorAll('input[placeholder="Öğrenci no..."]')].filter(isVisible);
    const processFilters = [...section.querySelectorAll('select')].filter(isVisible);
    if (numberFilters.length !== 1 || numberFilters[0].value !== applicationNumber || studentFilters.length !== 1
        || studentFilters[0].value.trim() !== '' || processFilters.length !== 1
        || normalizeText(processFilters[0].selectedOptions?.[0]?.textContent) !== '-- tümü --') return 'unknown';
    if ([...section.querySelectorAll('.z-paging')].some(isVisible)) return 'unknown';
    const rows = [...list.querySelectorAll('.z-listbox-body tr.z-listitem')].filter(isVisible);
    const numberIndex = [...list.querySelectorAll('.z-listbox-header th')]
        .findIndex((cell) => normalizeText(cell.textContent) === 'e-ikamet başvuru no');
    if (numberIndex < 0) return 'unknown';
    if (rows.length) {
        return rows.length === 1
            && normalizeText(rows[0].querySelectorAll('td')[numberIndex]?.textContent) === normalizeText(applicationNumber)
            ? 'existing_record' : 'unknown';
    }
    const emptyMessages = [...list.querySelectorAll('.z-listbox-emptybody-content')].filter(isVisible);
    return emptyMessages.length === 1
        && normalizeText(emptyMessages[0].textContent).startsWith('veritabanında kayıtlı ikamet işlemi bulunamadı.')
        ? 'no_match' : 'unknown';
}

/** Performs one read-only exact-number lookup; every unrecognized result fails closed. */
async function queryGocnetRegistration(rootDocument, applicationNumber, { signal, timeoutMs = 20_000 } = {}) {
    if (!rootDocument || signal?.aborted || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)
        || hasVisibleDialog(rootDocument)) return 'unknown';
    let controls = findQueryControls(rootDocument);
    if (!controls || controls.input.disabled || controls.input.readOnly || controls.button.disabled) return 'unknown';
    const view = rootDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(controls.input, applicationNumber);
    else controls.input.value = applicationNumber;
    controls.input.dispatchEvent(new view.Event('input', { bubbles: true }));
    controls.input.dispatchEvent(new view.Event('change', { bubbles: true }));

    controls = findQueryControls(rootDocument);
    if (!controls || controls.input.disabled || controls.input.readOnly || controls.button.disabled
        || controls.input.value !== applicationNumber || signal?.aborted || hasVisibleDialog(rootDocument)) return 'unknown';
    const resultPromise = waitForQueryResult(rootDocument, applicationNumber, signal, timeoutMs);
    controls.button.click();
    return resultPromise;
}

async function queryGocnetRecordList(rootDocument, applicationNumber, requestId) {
    if (!rootDocument || !/^20\d{2}-\d{2}-\d{5,8}$/.test(applicationNumber)
        || typeof requestId !== 'string' || requestId.length > 128 || typeof chrome === 'undefined') return 'unknown';
    try {
        const response = await chrome.runtime.sendMessage({ action: 'YOKSIS_ZK_COMMAND', command: {
            action: 'queryGocnetRecords', applicationNumber, requestId
        } });
        if (response?.success !== true || response.freshResponse !== true) return 'unknown';
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

globalThis.YoksisGocnetTransferController = Object.freeze({
    dispatchGocnetPdfUpload,
    findGocnetApplicationDocumentUploadTarget,
    queryGocnetRegistration,
    queryGocnetRecordList,
    readGocnetUploadResult,
    readGocnetRecordListResult,
    readGocnetQueryResult
});

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage
    && location.protocol === 'https:' && location.hostname === 'yoksis.yok.gov.tr' && window === window.top) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (sender.id !== chrome.runtime.id || sender.tab || typeof request?.requestId !== 'string' || request.requestId.length > 128
            || !Number.isInteger(request.portalTabId) || request.portalTabId < 0
            || (request.applicationNumber !== undefined && (typeof request.applicationNumber !== 'string'
                || !/^20\d{2}-\d{2}-\d{5,8}$/.test(request.applicationNumber)))) return false;
        if (queryInProgress || globalThis.YoksisDocumentAuditController?.isActive?.()) {
            sendResponse({ requestId: request.requestId, state: 'unknown' });
            return false;
        }
        if (request.action === 'YOKSIS_GOCNET_QUERY' && ['form', 'history'].includes(request.phase || 'form')
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.attemptId || '')) {
            queryInProgress = true;
            const query = request.phase === 'history'
                ? queryGocnetRecordList(document, request.applicationNumber, request.requestId)
                : queryGocnetRegistration(document, request.applicationNumber);
            void query
                .then((state) => {
                    if (state === 'student_data_filled' && acknowledgeGocnetQuery(document, request.applicationNumber)) transferContexts.set(request.attemptId, {
                        applicationNumber: request.applicationNumber, state
                    });
                    sendResponse({ requestId: request.requestId, state: state === 'student_data_filled'
                        && !transferContexts.has(request.attemptId) ? 'unknown' : state });
                })
                .catch(() => sendResponse({ requestId: request.requestId, state: 'unknown' }))
                .finally(() => { queryInProgress = false; });
            return true;
        }
        if (request.action === 'YOKSIS_GOCNET_SAVE' && request.applicationNumber
            && typeof request.studentNumber === 'string' && typeof request.passportNumber === 'string'
            && typeof request.firstName === 'string' && typeof request.lastName === 'string'
            && /^5\d{9}$/.test(request.phoneNational || '')) {
            void saveGocnetRecord(document, request)
                .then((result) => sendResponse({ requestId: request.requestId, ...result }))
                .catch(() => sendResponse({ requestId: request.requestId, state: 'unknown' }));
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
