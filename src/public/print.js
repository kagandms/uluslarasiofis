import { arePrintSettingsAvailable, createPrintUploadPayload, getMaximumCopies, isValidCopies,
    normalizePrintCapabilities } from './printSettings.js';
import { parsePageSelection } from './printPageSelection.js';
import { extractPdfPages } from './printPdf.js';
import { submitPrintEntries } from './printQueue.js';
import { detectPrintLocale, translatePrintMessage } from './i18n/printMessages.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PRINT_PAGES = 20;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const fileInput = document.getElementById('print-file-input');
const fileList = document.getElementById('print-files');
const fileTemplate = document.getElementById('print-file-template');
const addFileButton = document.getElementById('print-add-file');
const submitButton = document.getElementById('print-submit');
const availability = document.getElementById('print-availability');
const message = document.getElementById('print-message');
const fileCount = document.getElementById('print-file-count');
const pageTotal = document.getElementById('print-page-total');
const historySection = document.getElementById('print-history-section');
const historyList = document.getElementById('print-history');
const locale = detectPrintLocale(window.navigator.languages, window.navigator.language);
const staffMode = new URLSearchParams(window.location.search).get('mode') === 'staff';
const HISTORY_KEY = staffMode ? 'print.staff.job-history.v1' : 'print.job-history.v2';
let optionCapabilities = normalizePrintCapabilities();
let isAvailable = false;
let hasCheckedAvailability = false;
let isSubmitting = false;
const files = [];
const jobs = readJobHistory();
let currentMessage = null;
let isQueuePaused = false;

function t(key, params = {}) { return translatePrintMessage(locale, key, params); }

function translateElements(container) {
    for (const element of container.querySelectorAll('[data-i18n]')) {
        element.textContent = t(element.dataset.i18n);
    }
    for (const element of container.querySelectorAll('[data-i18n-placeholder]')) {
        element.placeholder = t(element.dataset.i18nPlaceholder);
    }
    for (const element of container.querySelectorAll('[data-i18n-aria-label]')) {
        element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    }
    for (const element of container.querySelectorAll('[data-i18n-alt]')) {
        element.alt = t(element.dataset.i18nAlt);
    }
}

function renderMessage() {
    message.textContent = currentMessage ? t(currentMessage.key, currentMessage.params) : '';
}

function setMessage(key, params = {}) {
    currentMessage = key ? { key, params } : null;
    renderMessage();
}

function applyLocale() {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.title = t(staffMode ? 'staffPageTitle' : 'pageTitle');
    translateElements(document);
    translateElements(fileTemplate.content);
    if (staffMode) {
        document.querySelector('[data-i18n="title"]').textContent = t('staffTitle');
        document.querySelector('[data-i18n="intro"]').textContent = t('staffIntro');
    }
    availability.textContent = t(!hasCheckedAvailability ? 'availabilityChecking'
        : isQueuePaused ? 'availabilityPaused' : isAvailable ? 'availabilityReady' : 'availabilityOffline');
    for (const entry of files) renderFile(entry);
    renderHistory();
    renderMessage();
    submitButton.textContent = t(isSubmitting ? 'submitting' : 'submit');
    updateBasket();
}

function readJobHistory() {
    try {
        const storedJobs = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(storedJobs) ? storedJobs.filter((job) => typeof job?.trackingToken === 'string') : [];
    } catch { return []; }
}

function saveJobHistory() {
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(jobs.slice(-30))); } catch { /* Active page still tracks jobs in memory. */ }
}

function renderHistory() {
    historyList.replaceChildren();
    historySection.hidden = jobs.length === 0;
    for (const job of jobs) {
        const item = document.createElement('article');
        item.className = 'print-history-item';
        const name = document.createElement('p');
        name.textContent = job.name;
        const status = document.createElement('p');
        status.textContent = statusMessage(job.status);
        item.append(name, status);
        historyList.append(item);
    }
}

function statusMessage(status) {
    if (status === 'submitted') return t('statusSubmitted');
    if (status === 'unknown') return t('statusUnknown');
    if (status === 'failed' || status === 'expired' || status === 'cancelled') return t('statusFailed');
    if (status === 'uploading') return t('statusUploading');
    if (status === 'queued') return t('statusQueued');
    if (status === 'leased' || status === 'ready') return t('statusPreparing');
    if (status === 'submission_started') return t('statusSending');
    return t('statusChecking');
}

async function requestAvailability() {
    try {
        const response = await fetch('/api/public/print/status', { cache: 'no-store' });
        const result = await response.json();
        isAvailable = response.ok && result.available === true;
        isQueuePaused = result.queue_paused === true;
        optionCapabilities = normalizePrintCapabilities(result.limits
            ? { ...result.options, limits: result.limits } : result.options);
    } catch {
        isAvailable = false;
        optionCapabilities = normalizePrintCapabilities();
    }
    hasCheckedAvailability = true;
    availability.dataset.state = isAvailable ? 'ready' : 'unavailable';
    availability.textContent = t(isQueuePaused ? 'availabilityPaused' : isAvailable ? 'availabilityReady' : 'availabilityOffline');
    for (const entry of files) renderFile(entry);
    updateBasket();
}

function readSettings(entry) {
    const read = (key) => entry.card.querySelector(`[data-setting="${key}"]`).value;
    return { paper_size: read('paper_size'), color_mode: read('color_mode'), orientation: read('orientation'),
        duplex: 'simplex', copies: read('copies') };
}

function selectedPages(entry) {
    if (entry.file.type !== 'application/pdf' || entry.card.querySelector('[data-pages="all"]')?.checked) return null;
    return parsePageSelection(entry.card.querySelector('.page-range-input').value, entry.sourcePageCount);
}

function pageCountFor(entry) {
    if (entry.file.type !== 'application/pdf') return 1;
    if (!Number.isSafeInteger(entry.sourcePageCount)) return null;
    if (entry.card.querySelector('[data-pages="custom"]')?.checked && !entry.card.querySelector('.page-range-input').value.trim()) return 0;
    return selectedPages(entry)?.length ?? entry.sourcePageCount;
}

function renderFile(entry) {
    translateElements(entry.card);
    const settings = readSettings(entry);
    let count;
    try { count = pageCountFor(entry); } catch { count = null; }
    const copies = entry.card.querySelector('[data-setting="copies"]');
    const maxCopies = getMaximumCopies(optionCapabilities, count);
    copies.max = String(maxCopies);
    copies.setAttribute('aria-invalid', String(!isValidCopies(copies.value, maxCopies)));
    for (const select of entry.card.querySelectorAll('select[data-setting]')) {
        const values = select.dataset.setting === 'color_mode' ? optionCapabilities.color_modes
            : select.dataset.setting === 'orientation' ? optionCapabilities.orientations : optionCapabilities.paper_sizes;
        for (const option of select.options) {
            option.disabled = !values.includes(option.value);
            if (option.value === 'color') option.textContent = t(option.disabled ? 'colorUnavailable' : 'color');
        }
    }
    entry.card.querySelector('.remove-file-button').setAttribute('aria-label', t('removeFile', { name: entry.file.name }));
    const rangeField = entry.card.querySelector('.page-selection');
    if (rangeField && !rangeField.hidden) {
        const customPages = entry.card.querySelector('[data-pages="custom"]').checked;
        const rangeInput = entry.card.querySelector('.page-range-input');
        const hint = entry.card.querySelector('.page-selection-hint');
        rangeInput.hidden = !customPages;
        rangeInput.disabled = !customPages;
        hint.hidden = !customPages;
        hint.textContent = count === null ? t('pageRangeReading')
            : t('pageRangeHint', { count, maximum: MAX_PRINT_PAGES });
    }
    const summary = entry.card.querySelector('.print-settings-summary');
    summary.textContent = `${summarizeSettings(settings)}${count ? ` · ${t('pagesWord', { count })}` : ''}`;
    const error = validateEntry(entry);
    entry.card.querySelector('.file-error').textContent = error;
    updateBasket();
}

function summarizeSettings(settings) {
    const color = t(settings.color_mode === 'color' ? 'color' : 'monochrome');
    const sides = t(settings.duplex === 'duplexlong' ? 'duplex' : 'simplex');
    const orientation = t(settings.orientation === 'landscape' ? 'landscape' : 'portrait');
    const copies = t('copiesCount', { count: Number(settings.copies) });
    return t('settingsSummary', { paper: settings.paper_size, color, sides, orientation, copies });
}

function validateEntry(entry) {
    if (entry.error) return t(entry.error);
    if (!ACCEPTED_TYPES.has(entry.file.type)) return t('pdfTypeError');
    if (entry.file.size < 1 || entry.file.size > MAX_BYTES) return t('fileTooLarge');
    let count;
    try { count = pageCountFor(entry); } catch (error) { return pageSelectionError(error, entry); }
    if (count === null) return t('pdfUnreadable');
    if (count < 1 || count > MAX_PRINT_PAGES) return t('tooManyPages', { maximum: MAX_PRINT_PAGES });
    const settings = readSettings(entry);
    if (!arePrintSettingsAvailable(settings, optionCapabilities)) return t('settingsUnavailable');
    if (!isValidCopies(settings.copies, getMaximumCopies(optionCapabilities, count))) {
        return t('copyRange', { maximum: getMaximumCopies(optionCapabilities, count) });
    }
    try { selectedPages(entry); } catch (error) { return pageSelectionError(error, entry); }
    return '';
}

function pageSelectionError(error, entry) {
    const code = typeof error?.code === 'string' ? error.code : 'pageCountUnavailable';
    return t(code, { maximum: entry.sourcePageCount });
}

function updateBasket() {
    const total = files.reduce((sum, entry) => {
        try {
            const count = pageCountFor(entry);
            const copies = Number(readSettings(entry).copies);
            return sum + (count && Number.isSafeInteger(copies) ? count * copies : 0);
        } catch { return sum; }
    }, 0);
    fileCount.textContent = t('fileCount', { count: files.length });
    pageTotal.textContent = t('pageCount', { count: total });
    submitButton.disabled = !isAvailable || isSubmitting || files.length === 0 || total > optionCapabilities.limits.max_page_copies
        || files.some((entry) => validateEntry(entry));
    if (total > optionCapabilities.limits.max_page_copies) {
        pageTotal.textContent = t('pageCountWithLimit', { count: total, maximum: optionCapabilities.limits.max_page_copies });
    }
}

function setEntryControlsDisabled(disabled) {
    for (const entry of files) {
        for (const control of entry.card.querySelectorAll('input, select, button')) control.disabled = disabled;
        if (!disabled) renderFile(entry);
    }
}

function addFile(file) {
    if (!file) return;
    const card = fileTemplate.content.firstElementChild.cloneNode(true);
    const entry = { file, card, sourcePageCount: file.type === 'application/pdf' ? null : 1, error: '' };
    const cardId = crypto.randomUUID();
    card.querySelector('.file-name').textContent = file.name;
    card.querySelector('.file-meta').textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    card.querySelector('.remove-file-button').setAttribute('aria-label', t('removeFile', { name: file.name }));
    for (const [index, setting] of [...card.querySelectorAll('.print-setting')].entries()) {
        const control = setting.querySelector('select, input');
        control.id = `${cardId}-setting-${index}`;
        setting.querySelector('label').htmlFor = control.id;
    }
    card.querySelector('.remove-file-button').addEventListener('click', () => {
        files.splice(files.indexOf(entry), 1);
        card.remove();
        updateBasket();
    });
    card.addEventListener('input', () => renderFile(entry));
    card.addEventListener('change', () => renderFile(entry));
    const pages = card.querySelector('.page-selection');
    if (file.type === 'application/pdf') {
        pages.hidden = false;
        const radioGroupName = `pages-${cardId}`;
        for (const radio of card.querySelectorAll('[data-pages]')) radio.name = radioGroupName;
    }
    files.push(entry);
    fileList.append(card);
    renderFile(entry);
    if (file.type === 'application/pdf' && file.size > 0 && file.size <= MAX_BYTES) void readPdfPageCount(entry);
}

async function readPdfPageCount(entry) {
    try {
        const { PDFDocument } = await import('pdf-lib');
        const sourcePdf = await PDFDocument.load(await entry.file.arrayBuffer());
        entry.sourcePageCount = sourcePdf.getPageCount();
    } catch {
        entry.error = 'pdfReadFailed';
    }
    renderFile(entry);
}

async function preparePrintFile(entry) {
    const pages = selectedPages(entry);
    if (!pages) return entry.file;
    return extractPdfPages(entry.file, pages);
}

function readOpaqueToken() {
    return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createUpload(file, settings, tokens) {
    const endpoint = staffMode ? '/api/staff/print/upload-intents' : '/api/public/print/upload-intents';
    const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createPrintUploadPayload({ file, settings, tokens }))
    });
    if (!response.ok) {
        if (response.status === 429) throw new Error('rate_limit');
        if (response.status === 503) {
            const result = await response.json().catch(() => ({}));
            if (result.error?.code === 'PRINT_QUEUE_PAUSED') throw new Error('queue_paused');
        }
        throw new Error('upload_intent');
    }
    return { ...(await response.json()), tokens };
}

async function uploadFile(file, capability) {
    const response = await fetch(capability.url, { method: capability.method,
        headers: capability.requiredHeaders, body: file });
    if (!response.ok) throw new Error('upload');
}

async function finalizeUpload(jobId, uploadToken) {
    const route = staffMode ? '/api/staff/print/jobs' : '/api/public/print/jobs';
    const response = await fetch(`${route}/${encodeURIComponent(jobId)}/finalize`, {
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

function updateJob(job, status) {
    job.status = status;
    saveJobHistory();
    renderHistory();
}

async function monitorJob(job) {
    for (let poll = 0; poll < 90; poll += 1) {
        try {
            const status = await readJobStatus(job.trackingToken);
            updateJob(job, status);
            if (['submitted', 'unknown', 'failed', 'expired', 'cancelled'].includes(status)) return;
        } catch { /* Keep tracking the existing job; never create a replacement automatically. */ }
        await new Promise((resolve) => window.setTimeout(resolve, 8000));
    }
    updateJob(job, 'unknown');
}

async function submitEntry(entry) {
    const preparedFile = await preparePrintFile(entry);
    const tokens = { idempotency_key: readOpaqueToken(), tracking_token: readOpaqueToken(), upload_token: readOpaqueToken() };
    const job = { name: entry.file.name, status: 'uploading', trackingToken: tokens.tracking_token };
    jobs.push(job);
    saveJobHistory();
    renderHistory();
    entry.pendingJob = job;
    let upload;
    try {
        upload = await createUpload(preparedFile, readSettings(entry), tokens);
    } catch (error) {
        if (['rate_limit', 'queue_paused'].includes(error?.message)) {
            jobs.splice(jobs.indexOf(job), 1);
            entry.pendingJob = null;
            saveJobHistory();
            renderHistory();
        } else void monitorJob(job);
        throw error;
    }
    updateJob(job, upload.status || 'uploading');
    void monitorJob(job);
    if (!upload.upload) {
        return;
    }
    await uploadFile(preparedFile, upload.upload);
    await finalizeUpload(upload.job_id, upload.tokens.upload_token);
    updateJob(job, 'queued');
}

function applySubmitOutcomes(outcomes) {
    for (const outcome of outcomes) {
        const { entry } = outcome;
        if (outcome.status === 'sent') {
            files.splice(files.indexOf(entry), 1);
            entry.card.remove();
            continue;
        }
        if (outcome.status === 'failed') {
            entry.error = 'uploadFailedUncertain';
            renderFile(entry);
        }
    }
}

function showSubmitOutcome(outcomes) {
    if (outcomes.some((outcome) => outcome.status === 'queue_paused')) {
        setMessage('queuePaused');
        return;
    }
    if (outcomes.some((outcome) => outcome.status === 'rate_limited')) {
        setMessage('rateLimited');
        return;
    }
    if (outcomes.some((outcome) => outcome.status === 'failed')) {
        setMessage('someFilesFailed');
        return;
    }
    setMessage('queued');
}

async function submitAll() {
    if (isSubmitting || submitButton.disabled) return;
    isSubmitting = true;
    submitButton.textContent = t('submitting');
    setEntryControlsDisabled(true);
    updateBasket();
    const outcomes = await submitPrintEntries([...files], async (entry) => {
        setMessage('uploadingFile', { name: entry.file.name });
        await submitEntry(entry);
    });
    applySubmitOutcomes(outcomes);
    isSubmitting = false;
    setEntryControlsDisabled(false);
    submitButton.textContent = t('submit');
    updateBasket();
    showSubmitOutcome(outcomes);
}

addFileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    for (const file of fileInput.files || []) addFile(file);
    fileInput.value = '';
    setMessage(null);
});
submitButton.addEventListener('click', () => void submitAll());
applyLocale();
renderHistory();
for (const job of jobs) {
    if (!['submitted', 'unknown', 'failed', 'expired', 'cancelled'].includes(job.status)) void monitorJob(job);
}
void requestAvailability();
window.setInterval(() => void requestAvailability(), 15_000);
