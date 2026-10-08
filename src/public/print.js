import {
    arePrintSettingsAvailable, createPrintUploadPayload, getMaximumCopies, isValidCopies,
    normalizePrintCapabilities, summarizePrintSettings
} from './printSettings.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const SUCCESS_MESSAGE = 'Document sent to the printer. Please collect your document.';
const GENERIC_ERROR = 'Yazdırma tamamlanamadı. Lütfen dosyanızı kontrol edip yeniden deneyin.';
const PENDING_JOB_KEY = 'print.pending-job-token';

const fileInput = document.getElementById('print-file');
const copiesInput = document.getElementById('print-copies');
const paperSizeInput = document.getElementById('print-paper-size');
const colorModeInput = document.getElementById('print-color-mode');
const duplexInput = document.getElementById('print-duplex');
const orientationInput = document.getElementById('print-orientation');
const decreaseCopiesButton = document.getElementById('print-copies-decrease');
const increaseCopiesButton = document.getElementById('print-copies-increase');
const form = document.getElementById('print-form');
const availability = document.getElementById('print-availability');
const fileDetails = document.getElementById('print-file-details');
const message = document.getElementById('print-message');
const submitButton = document.getElementById('print-submit');
const settingsSummary = document.getElementById('print-settings-summary');
const settingsHint = document.getElementById('print-settings-hint');
const copyLimits = document.getElementById('print-copy-limits');
let optionCapabilities = normalizePrintCapabilities();
let selectedPageCount = null;
let fileReadGeneration = 0;
let isAvailable = false;
let isSubmitting = false;
let isJobAmbiguous = false;

function setMessage(text) {
    message.textContent = text;
}

function storePendingJobToken(token) {
    try { sessionStorage.setItem(PENDING_JOB_KEY, token); } catch { /* The active page still tracks the request in memory. */ }
}

function clearPendingJobToken() {
    try { sessionStorage.removeItem(PENDING_JOB_KEY); } catch { /* No stored token needs cleanup. */ }
}

function readPendingJobToken() {
    try { return sessionStorage.getItem(PENDING_JOB_KEY); } catch { return null; }
}

async function requestAvailability() {
    try {
        const response = await fetch('/api/public/print/status', { cache: 'no-store' });
        const result = await response.json();
        isAvailable = response.ok && result.available === true;
        optionCapabilities = normalizePrintCapabilities(result.options);
        if (result.limits) optionCapabilities = normalizePrintCapabilities({ ...result.options, limits: result.limits });
    } catch {
        isAvailable = false;
        optionCapabilities = normalizePrintCapabilities();
    }
    applyOptionCapabilities();
    availability.dataset.state = isAvailable ? 'ready' : 'unavailable';
    availability.textContent = isAvailable ? 'Yazıcı kullanıma hazır.' : 'Yazdırma şu anda kullanılamıyor.';
    updateSubmitState();
}

function applyOptionCapabilities() {
    updateSelectCapabilities(paperSizeInput, optionCapabilities.paper_sizes);
    updateSelectCapabilities(colorModeInput, optionCapabilities.color_modes);
    updateSelectCapabilities(duplexInput, optionCapabilities.duplex_modes);
    updateSelectCapabilities(orientationInput, optionCapabilities.orientations);
    const lockedOptions = [];
    if (!optionCapabilities.paper_sizes.includes('A3')) lockedOptions.push('A3');
    if (!optionCapabilities.color_modes.includes('color')) lockedOptions.push('renkli');
    if (!optionCapabilities.duplex_modes.includes('duplexlong')) lockedOptions.push('çift taraflı');
    if (!optionCapabilities.orientations.includes('landscape')) lockedOptions.push('yatay');
    settingsHint.textContent = lockedOptions.length
        ? `${lockedOptions.join(', ')} seçenekleri yazıcı doğrulaması tamamlandığında açılır.`
        : 'Yazıcı şu anda dikey ve yatay yönü destekleyen Agent protokolüyle bağlı.';
    updateCopyControls();
    updateSettingsSummary();
}

function updateSelectCapabilities(select, allowedValues) {
    for (const option of select.options) {
        option.disabled = !allowedValues.includes(option.value);
        if (option.value === 'A3') option.textContent = option.disabled ? 'A3 · Hazne doğrulaması bekleniyor' : 'A3';
        if (option.value === 'color') option.textContent = option.disabled ? 'Renkli · UAT onayı bekleniyor' : 'Renkli';
        if (option.value === 'duplexlong') option.textContent = option.disabled
            ? 'Çift taraflı (uzun kenardan çevir) · UAT onayı bekleniyor'
            : 'Çift taraflı (uzun kenardan çevir)';
        if (option.value === 'landscape') option.textContent = option.disabled
            ? 'Yatay · Agent güncellemesi bekleniyor' : 'Yatay';
    }
}

function readPrintSettings() {
    return { paper_size: paperSizeInput.value, color_mode: colorModeInput.value,
        duplex: duplexInput.value, orientation: orientationInput.value, copies: copiesInput.value };
}

function updateSettingsSummary() {
    settingsSummary.textContent = summarizePrintSettings(readPrintSettings());
}

function updateCopyControls() {
    const maximum = getMaximumCopies(optionCapabilities, selectedPageCount);
    copiesInput.max = String(maximum);
    const valid = isValidCopies(copiesInput.value, maximum);
    copiesInput.setAttribute('aria-invalid', String(!valid));
    decreaseCopiesButton.disabled = !valid || Number(copiesInput.value) <= 1;
    increaseCopiesButton.disabled = !valid || Number(copiesInput.value) >= maximum;
    const pageDescription = selectedPageCount ? `Bu dosya ${selectedPageCount} sayfa; ` : '';
    copyLimits.textContent = `${pageDescription}en fazla ${maximum} kopya seçilebilir. Toplam baskı sınırı ${optionCapabilities.limits.max_page_copies} sayfadır.`;
    return valid;
}

function updateSubmitState() {
    const file = fileInput.files?.[0];
    const settingsAreAllowed = arePrintSettingsAvailable(readPrintSettings(), optionCapabilities);
    const copiesAreValid = updateCopyControls();
    submitButton.disabled = !isAvailable || isSubmitting || isJobAmbiguous || !file || !settingsAreAllowed || !copiesAreValid;
}

function validateSelectedFile(file) {
    if (!file) return 'Bir dosya seçin.';
    if (!ACCEPTED_TYPES.has(file.type)) return 'PDF, JPG veya PNG dosyası seçin.';
    if (file.size < 1 || file.size > MAX_BYTES) return 'Dosya en fazla 10 MB olabilir.';
    return '';
}

function readOpaqueToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createUpload(file, settings) {
    const tokens = { idempotency_key: readOpaqueToken(), tracking_token: readOpaqueToken(), upload_token: readOpaqueToken() };
    const response = await fetch('/api/public/print/upload-intents', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPrintUploadPayload({ file, settings, tokens }))
    });
    if (!response.ok) throw new Error('upload_intent');
    return { ...(await response.json()), tokens };
}

async function uploadFile(file, capability) {
    const response = await fetch(capability.url, {
        method: capability.method, headers: capability.requiredHeaders, body: file
    });
    if (!response.ok) throw new Error('upload');
}

async function finalizeUpload(jobId, uploadToken) {
    const response = await fetch(`/api/public/print/jobs/${encodeURIComponent(jobId)}/finalize`, {
        method: 'POST', credentials: 'same-origin', headers: { 'X-Print-Upload-Token': uploadToken }
    });
    if (!response.ok) throw new Error('finalize');
}

async function readJobStatus(trackingToken) {
    const response = await fetch('/api/public/print/jobs/status', {
        cache: 'no-store', headers: { 'X-Print-Tracking-Token': trackingToken }
    });
    if (!response.ok) throw new Error('status');
    return (await response.json()).status;
}

async function waitForPrintResult(trackingToken) {
    for (let pollCount = 0; pollCount < 100; pollCount += 1) {
        const status = await readJobStatus(trackingToken);
        if (status === 'submitted') return 'submitted';
        if (status === 'unknown') return 'unknown';
        if (['failed', 'expired', 'cancelled'].includes(status)) return 'failed';
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    return 'pending';
}

async function monitorJob(trackingToken) {
    try {
        const result = await waitForPrintResult(trackingToken);
        if (result === 'submitted') {
            clearPendingJobToken();
            isJobAmbiguous = false;
            fileInput.value = '';
            fileDetails.textContent = 'PDF, JPG veya PNG · En fazla 10 MB';
            setMessage(SUCCESS_MESSAGE);
            return;
        }
        if (result === 'failed') {
            clearPendingJobToken();
            isJobAmbiguous = false;
            setMessage(GENERIC_ERROR);
            return;
        }
        if (result === 'unknown') {
            isJobAmbiguous = true;
            setMessage('İsteğin sonucu doğrulanamadı. Aynı belgeyi yeniden göndermeyin; ofis görevlisine danışın.');
            updateSubmitState();
            return;
        }
    } catch {
        // Keep the tracking token for this tab so a later visit cannot silently resubmit the same request.
    }
    isJobAmbiguous = true;
    setMessage('İsteğiniz işleniyor. Aynı belgeyi yeniden göndermeyin.');
    updateSubmitState();
}

async function submitPrintRequest(event) {
    event.preventDefault();
    if (isSubmitting) return;
    const file = fileInput.files?.[0];
    const validationMessage = validateSelectedFile(file);
    if (validationMessage) {
        setMessage(validationMessage);
        return;
    }
    isSubmitting = true;
    isJobAmbiguous = false;
    let trackingToken = null;
    let finalizeStarted = false;
    setMessage('Dosya gönderiliyor…');
    updateSubmitState();
    try {
        const upload = await createUpload(file, readPrintSettings());
        if (!upload.upload) throw new Error('upload_unavailable');
        trackingToken = upload.tokens.tracking_token;
        storePendingJobToken(trackingToken);
        await uploadFile(file, upload.upload);
        finalizeStarted = true;
        await finalizeUpload(upload.job_id, upload.tokens.upload_token);
        setMessage('Yazıcıya gönderiliyor…');
        await monitorJob(upload.tokens.tracking_token);
    } catch {
        if (finalizeStarted && trackingToken) {
            isJobAmbiguous = true;
            await monitorJob(trackingToken);
        } else {
            clearPendingJobToken();
            setMessage(GENERIC_ERROR);
        }
    } finally {
        isSubmitting = false;
        updateSubmitState();
    }
}

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    const currentGeneration = ++fileReadGeneration;
    selectedPageCount = file && file.type !== 'application/pdf' ? 1 : null;
    const validationMessage = file ? validateSelectedFile(file) : '';
    fileDetails.textContent = validationMessage || (file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF, JPG veya PNG · En fazla 10 MB');
    setMessage(validationMessage);
    updateSubmitState();
    if (file?.type === 'application/pdf' && !validationMessage) {
        void readPdfPageCount(file).then((pageCount) => {
            if (currentGeneration !== fileReadGeneration) return;
            selectedPageCount = pageCount;
            updateSubmitState();
        });
    }
});
async function readPdfPageCount(file) {
    try {
        const parsedDocument = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        try {
            return parsedDocument.numPages;
        } finally {
            await parsedDocument.destroy();
        }
    } catch {
        return null;
    }
}

for (const settingInput of [paperSizeInput, colorModeInput, duplexInput, orientationInput]) {
    settingInput.addEventListener('change', () => {
        updateSettingsSummary();
        updateSubmitState();
    });
}
copiesInput.addEventListener('input', () => {
    updateSettingsSummary();
    updateSubmitState();
    if (!isValidCopies(copiesInput.value, getMaximumCopies(optionCapabilities, selectedPageCount))) {
        setMessage(`1 ile ${getMaximumCopies(optionCapabilities, selectedPageCount)} arasında tam sayı girin.`);
    } else setMessage('');
});
decreaseCopiesButton.addEventListener('click', () => adjustCopies(-1));
increaseCopiesButton.addEventListener('click', () => adjustCopies(1));

function adjustCopies(delta) {
    const maximum = getMaximumCopies(optionCapabilities, selectedPageCount);
    const current = isValidCopies(copiesInput.value, maximum) ? Number(copiesInput.value) : 1;
    copiesInput.value = String(Math.max(1, Math.min(maximum, current + delta)));
    copiesInput.dispatchEvent(new Event('input', { bubbles: true }));
}
form.addEventListener('submit', (event) => void submitPrintRequest(event));
const pendingToken = readPendingJobToken();
if (pendingToken) {
    isJobAmbiguous = true;
    setMessage('Önceki yazdırma isteğinizin durumu kontrol ediliyor…');
    updateSubmitState();
    void monitorJob(pendingToken);
}
void requestAvailability();
window.setInterval(() => void requestAvailability(), 15_000);
