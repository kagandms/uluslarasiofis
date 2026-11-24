import {
    formatDeadlineWithRemaining,
    formatLatestImportLine,
    isExportedAtStale,
    parseExportedAtFromFileName,
    parseYoksisExcel,
    uploadYoksisImport
} from '../staff/yoksisExcelImport.js';

const AUDIT_EVENT_ACTIONS = new Set([
    'YOKSIS_DOCUMENT_AUDIT_PROGRESS',
    'YOKSIS_DOCUMENT_AUDIT_RECORD',
    'YOKSIS_DOCUMENT_AUDIT_COMPLETE'
]);
const SHARED_API = '/api/staff/yoksis-document-audit';
const PENDING_STORAGE_KEY = 'staff-yoksis-audit-pending-v1';
const MAX_BATCH_RECORDS = 25;
const MAX_BATCH_BYTES = 100 * 1024;
const PAGE_SIZE = 50;
const RETRY_PAGE_SIZE = 100;
const MAX_RETRY_ENTRIES = 1000;
const CATEGORY_LABELS = Object.freeze({
    successful: 'Başarılı',
    pending: 'Beklemede',
    rejected: 'Reddedilen',
    missing_documents: 'Eksik Evrak',
    unreadable: 'Okunamadı',
    other: 'Diğer'
});

function createRequestId() {
    return globalThis.crypto?.randomUUID?.() || `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setText(root, selector, value) {
    const element = root.querySelector(selector);
    if (element) element.textContent = String(value ?? '');
}

function formatDocuments(documents) {
    return documents.map((document) => {
        const required = document.required ? 'Zorunlu' : 'İsteğe bağlı';
        return [document.name, document.note, required, document.uploadStatus].filter(Boolean).join(' · ');
    }).join('\n') || 'Eksik evrak bulunmadı';
}

function normalizeStatus(status) {
    return String(status || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeSearch(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function classifyApplicationStatus(status) {
    const normalized = normalizeStatus(status);
    if (['islem tamamlandi', 'tamamlandi'].includes(normalized)) return 'successful';
    if (normalized === 'islem bekliyor') return 'pending';
    if (normalized === 'eksik belge bekliyor') return 'missing_documents';
    if (['reddedildi', 'basvuru reddedildi', 'ret'].includes(normalized)) return 'rejected';
    return 'other';
}

function isValidExcelFile(file) {
    return Boolean(file && /\.(xls|xlsx)$/i.test(String(file.name || '').trim()));
}

function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) return '0 B';
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
    return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function readFileBuffer(file, window) {
    if (typeof file.arrayBuffer === 'function') {
        return file.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
        const reader = new window.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Excel dosyası okunamadı.'));
        reader.readAsArrayBuffer(file);
    });
}

function renderRejectedRows(root, rejected) {
    const wrap = root.querySelector('#audit-excel-rejected-wrap');
    const tbody = root.querySelector('#audit-excel-rejected-body');
    if (!wrap || !tbody) return;
    tbody.replaceChildren();
    if (!Array.isArray(rejected) || rejected.length === 0) {
        wrap.hidden = true;
        return;
    }
    const document = root.ownerDocument;
    for (const item of rejected) {
        const row = document.createElement('tr');
        const rowCell = document.createElement('td');
        rowCell.textContent = String(item.rowNumber ?? '');
        const reasonCell = document.createElement('td');
        reasonCell.textContent = String(item.reason ?? '');
        row.append(rowCell, reasonCell);
        tbody.append(row);
    }
    wrap.hidden = false;
}

function appendRecord(root, data, categoryOverride = '', importMeta = null) {
    const document = root.ownerDocument;
    const row = document.createElement('tr');
    const verified = data.result?.status === 'verified';
    const identity = verified ? data.result.identity : null;
    const classification = verified ? categoryOverride || classifyApplicationStatus(data.result.applicationStatus) : 'unreadable';
    const values = [
        data.entry?.applicationNumber || '—',
        identity ? `${identity.firstName} ${identity.lastName}`.trim() : '—',
        data.entry?.studentNumber || '—',
        identity?.passportNumber || '—',
        identity?.phone || '—',
        verified ? data.result.applicationStatus : 'Kontrol edilemedi',
        verified ? formatDocuments(data.result.documents || []) : 'Kayıt güvenli biçimde okunamadı',
        CATEGORY_LABELS[classification] || CATEGORY_LABELS.other
    ];
    for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
    }
    if (importMeta && typeof importMeta === 'object') {
        const unitProgram = [importMeta.unit, importMeta.program].filter(Boolean).join(' · ');
        if (unitProgram) {
            const meta = document.createElement('div');
            meta.className = 'yoksis-audit-meta';
            meta.style.fontSize = '0.8rem';
            meta.style.color = 'var(--staff-home-card-secondary)';
            meta.style.marginTop = '0.2rem';
            meta.textContent = unitProgram;
            row.cells[1].append(meta);
        }
        const deadlineText = formatDeadlineWithRemaining(importMeta.missingDeadline);
        if (deadlineText) {
            const deadline = document.createElement('div');
            deadline.className = 'yoksis-audit-deadline';
            deadline.style.fontSize = '0.82rem';
            deadline.style.fontWeight = '600';
            deadline.style.marginTop = '0.25rem';
            deadline.textContent = `Son tarih: ${deadlineText}`;
            row.cells[6].append(deadline);
        }
        if (importMeta.isStale) {
            const badge = document.createElement('span');
            badge.className = 'yoksis-audit-stale-badge';
            badge.style.display = 'inline-block';
            badge.style.marginTop = '0.25rem';
            badge.style.padding = '0.15rem 0.45rem';
            badge.style.borderRadius = '999px';
            badge.style.fontSize = '0.74rem';
            badge.style.fontWeight = '700';
            badge.style.background = '#fff4df';
            badge.style.color = '#8a5a00';
            badge.textContent = 'Son yüklemede yok';
            row.cells[7].append(document.createTextNode(' '), badge);
        }
    }
    row.dataset.auditResult = verified ? 'verified' : 'unreadable';
    row.dataset.auditClassification = classification;
    row.cells[7].dataset.auditClassification = classification;
    root.querySelector('#audit-results')?.append(row);
}

function appendSharedRecord(root, record) {
    appendRecord(root, {
        entry: {
            applicationNumber: record.application_number,
            studentNumber: record.student_number
        },
        result: {
            status: record.result_status,
            identity: record.result_status === 'verified' ? {
                firstName: record.first_name,
                lastName: record.last_name,
                passportNumber: record.passport_number,
                phone: record.phone
            } : null,
            applicationStatus: record.application_status,
            documents: record.documents
        }
    }, record.status_category, record.import || null);
}

function readPendingBatches(window) {
    try {
        const batches = JSON.parse(window.sessionStorage.getItem(PENDING_STORAGE_KEY) || '[]');
        if (!Array.isArray(batches)) return [];
        return batches.filter((batch) => batch && typeof batch.scanId === 'string'
            && Array.isArray(batch.records) && batch.records.length > 0 && batch.records.length <= MAX_BATCH_RECORDS);
    } catch {
        return [];
    }
}

/** Initializes the YÖKSİS audit panel after staff authorization succeeds. */
export function initializeYoksisDocumentAuditManager(root) {
    const window = root.ownerDocument.defaultView;
    const startButton = root.querySelector('#audit-start');
    const retryButton = root.querySelector('#audit-retry-unreadable');
    const stopButton = root.querySelector('#audit-stop');
    const confirmation = root.querySelector('#audit-confirm');
    const results = root.querySelector('#audit-results');
    if (!window || !startButton || !stopButton || !confirmation || !results) return;

    const excelFileInput = root.querySelector('#audit-excel-file');
    const excelFileInfo = root.querySelector('#audit-excel-file-info');
    const excelUploadButton = root.querySelector('#audit-excel-upload');
    const excelLatest = root.querySelector('#audit-import-latest');
    const excelStaleWarning = root.querySelector('#audit-excel-stale-warning');
    const excelSummary = root.querySelector('#audit-excel-summary');

    const pending = new Map();
    const state = {
        scanId: '',
        requestId: '',
        targetTabId: null,
        busy: false,
        retryBusy: false,
        excelBusy: false,
        unreadableCount: null
    };
    const query = { status: 'all', page: 1, pageSize: PAGE_SIZE, total: 0, sequence: 0 };
    const pendingBatches = readPendingBatches(window);
    let currentBatch = [];
    let persistenceQueue = Promise.resolve();
    let persistenceBlocked = false;

    function updateControls() {
        startButton.disabled = state.busy;
        stopButton.hidden = !state.busy;
        stopButton.disabled = !state.busy || !Number.isInteger(state.targetTabId);
        if (retryButton) {
            retryButton.disabled = state.busy || state.retryBusy || state.unreadableCount === null || state.unreadableCount === 0;
            retryButton.textContent = state.unreadableCount > 0
                ? `Okunamayanları yeniden tara (${state.unreadableCount})`
                : 'Okunamayanları yeniden tara';
        }
        if (excelUploadButton) {
            excelUploadButton.disabled = state.excelBusy || !isValidExcelFile(excelFileInput?.files?.[0]);
        }
        if (excelFileInput) excelFileInput.disabled = state.excelBusy;
    }

    async function requestExtension(action, payload = {}, timeoutMs = 10_000) {
        const requestId = createRequestId();
        return new Promise((resolve) => {
            const timer = window.setTimeout(() => {
                pending.delete(requestId);
                resolve({ requestId, response: { success: false, error: 'Eklentiden yanıt alınamadı.' } });
            }, timeoutMs);
            pending.set(requestId, (response) => {
                window.clearTimeout(timer);
                pending.delete(requestId);
                resolve({ requestId, response });
            });
            window.postMessage({
                source: 'WEB_APP',
                payload: { action, requestId, ...payload }
            }, window.location.origin);
        });
    }

    async function postShared(path, body) {
        if (typeof window.fetch !== 'function') throw new Error('Ortak kayıt servisine bağlanılamadı.');
        const response = await window.fetch(`${SHARED_API}/${path}`, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        let payload = null;
        try { payload = await response.json(); } catch {}
        if (!response.ok) {
            const message = payload?.error?.message || 'Ortak kayıt işlemi tamamlanamadı.';
            const requestId = response.headers?.get('X-Request-Id');
            const detail = requestId ? ` (HTTP ${response.status}, İstek: ${requestId})` : ` (HTTP ${response.status})`;
            throw new Error(`${message}${detail}`);
        }
        return payload || {};
    }

    async function fetchUnreadableEntries() {
        const entries = [];
        let total = 0;
        for (let page = 1; entries.length < total || page === 1; page += 1) {
            const payload = await postShared('query', {
                q: '', status: 'unreadable', page, pageSize: RETRY_PAGE_SIZE
            });
            if (!Number.isSafeInteger(payload.total) || !Array.isArray(payload.records)) {
                throw new Error('Okunamayan kayıt listesi doğrulanamadı.');
            }
            total = payload.total;
            if (total > MAX_RETRY_ENTRIES) throw new Error('Okunamayan kayıt sayısı güvenli tarama sınırını aşıyor.');
            for (const record of payload.records) {
                if (typeof record.application_number !== 'string' || typeof record.student_number !== 'string') {
                    throw new Error('Okunamayan kayıt kimliği eksik.');
                }
                addRetryEntry(entries, record.application_number, record.student_number);
            }
            if (entries.length >= total) break;
            if (!payload.records.length) throw new Error('Okunamayan kayıt listesi eksik döndü.');
        }
        if (entries.length !== total) throw new Error('Okunamayan kayıt listesi tam alınamadı.');
        const localOutcomes = new Map();
        for (const batch of pendingBatches) {
            for (const record of batch.records) {
                const { applicationNumber, studentNumber } = record.entry || {};
                if (applicationNumber && studentNumber) {
                    localOutcomes.set(applicationNumber, {
                        studentNumber,
                        unreadable: record.result?.status !== 'verified'
                    });
                }
            }
        }
        for (const [applicationNumber, outcome] of localOutcomes) {
            const index = entries.findIndex((entry) => entry.applicationNumber === applicationNumber);
            if (index >= 0 && entries[index].studentNumber !== outcome.studentNumber) {
                throw new Error('Aynı başvuru numarası için öğrenci numarası çakışması var; otomatik tarama durduruldu.');
            }
            if (outcome.unreadable) {
                addRetryEntry(entries, applicationNumber, outcome.studentNumber);
            } else if (index >= 0) {
                entries.splice(index, 1);
            }
        }
        if (entries.length > MAX_RETRY_ENTRIES) throw new Error('Okunamayan kayıt sayısı güvenli tarama sınırını aşıyor.');
        return entries;
    }

    function addRetryEntry(entries, applicationNumber, studentNumber) {
        const existing = entries.find((entry) => entry.applicationNumber === applicationNumber);
        if (existing && existing.studentNumber !== studentNumber) {
            throw new Error('Aynı başvuru numarası için öğrenci numarası çakışması var; otomatik tarama durduruldu.');
        }
        if (!existing) entries.push({ applicationNumber, studentNumber });
    }

    async function refreshUnreadableCount() {
        try {
            state.unreadableCount = (await fetchUnreadableEntries()).length;
        } catch {
            state.unreadableCount = null;
        }
        updateControls();
    }

    function savePendingBatches() {
        try {
            window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingBatches));
            return true;
        } catch {
            return false;
        }
    }

    function showPersistenceError(message) {
        setText(root, '#audit-status', message);
        setText(root, '#audit-shared-count', 'Ortak depoya kaydedilemeyen sonuçlar bu sekmede yeniden denenmek üzere tutuluyor.');
    }

    function drainPendingBatches(retry = false) {
        if (retry) persistenceBlocked = false;
        persistenceQueue = persistenceQueue.then(async () => {
            if (persistenceBlocked) return;
            while (pendingBatches.length) {
                const batch = pendingBatches[0];
                try {
                    await postShared('records', batch);
                    pendingBatches.shift();
                    savePendingBatches();
                } catch (error) {
                    persistenceBlocked = true;
                    showPersistenceError(`Ortak kayıtlar kaydedilemedi: ${error.message}`);
                    break;
                }
            }
        });
        return persistenceQueue;
    }

    function enqueueBatch(scanId, recordsToSave) {
        if (!recordsToSave.length) return;
        const batch = { scanId, records: recordsToSave };
        pendingBatches.push(batch);
        if (!savePendingBatches()) showPersistenceError('Tarayıcı belleği dolu; kaydedilmemiş kayıtlar yenileme sonrası korunamayabilir.');
        void drainPendingBatches();
    }

    function queueRecord(scanId, record) {
        const candidate = [...currentBatch, record];
        const serialized = JSON.stringify({ scanId, records: candidate });
        const byteLength = new TextEncoder().encode(serialized).length;
        if (currentBatch.length && (candidate.length > MAX_BATCH_RECORDS || byteLength > MAX_BATCH_BYTES)) {
            enqueueBatch(scanId, currentBatch);
            currentBatch = [];
        }
        currentBatch.push(record);
        if (currentBatch.length >= MAX_BATCH_RECORDS) {
            enqueueBatch(scanId, currentBatch);
            currentBatch = [];
        }
    }

    async function loadSharedRecords() {
        const requestSequence = ++query.sequence;
        const searchInput = root.querySelector('#audit-search');
        const statusSelect = root.querySelector('#audit-filter');
        const matchSelect = root.querySelector('#audit-match');
        const body = {
            q: searchInput?.value || '',
            status: statusSelect?.value || query.status,
            match: matchSelect?.value || 'all',
            page: query.page,
            pageSize: query.pageSize
        };
        query.status = body.status;
        setText(root, '#audit-shared-count', 'Ortak kayıtlar yükleniyor…');
        try {
            const payload = await postShared('query', body);
            if (requestSequence !== query.sequence) return;
            results.replaceChildren();
            const visibleApplications = new Set();
            for (const record of payload.records || []) {
                appendSharedRecord(root, record);
                visibleApplications.add(record.application_number);
            }
            query.total = Number.isSafeInteger(payload.total) ? payload.total : 0;
            const pendingApplications = new Set();
            const search = normalizeSearch(body.q);
            for (const batch of pendingBatches) {
                for (const record of batch.records) {
                    const applicationNumber = record.entry?.applicationNumber;
                    if (!applicationNumber) continue;
                    pendingApplications.add(applicationNumber);
                    const identity = record.result?.status === 'verified' ? record.result.identity : null;
                    const category = identity ? classifyApplicationStatus(record.result.applicationStatus) : 'unreadable';
                    if (visibleApplications.has(applicationNumber)
                        || (body.status !== 'all' && category !== body.status)
                        || (search && !normalizeSearch([
                            identity?.firstName, identity?.lastName, record.entry?.studentNumber,
                            identity?.passportNumber
                        ].join(' ')).includes(search))) continue;
                    appendRecord(root, record);
                    visibleApplications.add(applicationNumber);
                }
            }
            const pendingLabel = pendingApplications.size
                ? ` · ${pendingApplications.size} yerel sonuç eşitlenmeyi bekliyor`
                : '';
            setText(root, '#audit-shared-count', `${query.total} kayıt${pendingLabel}`);
            setText(root, '#audit-page', `${query.page} / ${Math.max(1, Math.ceil(query.total / query.pageSize))}`);
            const previous = root.querySelector('#audit-page-previous');
            const next = root.querySelector('#audit-page-next');
            if (previous) previous.disabled = query.page <= 1;
            if (next) next.disabled = query.page * query.pageSize >= query.total;
        } catch (error) {
            if (requestSequence !== query.sequence) return;
            setText(root, '#audit-shared-count', `Ortak kayıtlar yüklenemedi: ${error.message}`);
        }
    }

    async function refreshSharedRecords(retryPending = false) {
        await drainPendingBatches(retryPending);
        await loadSharedRecords();
        await refreshUnreadableCount();
    }

    async function startScan(entries) {
        if (!confirmation.checked) {
            setText(root, '#audit-status', 'Devam etmeden önce YÖKSİS formunun değişebileceğini onaylayın.');
            return;
        }
        if (state.busy) return;

        state.busy = true;
        state.scanId = createRequestId();
        state.requestId = '';
        state.targetTabId = null;
        query.sequence += 1;
        currentBatch = [];
        root.dataset.auditScanId = state.scanId;
        results.replaceChildren();
        setText(root, '#audit-status', entries
            ? `${entries.length} okunamayan kayıt yeniden okunmak üzere hazırlanıyor…`
            : 'YÖKSİS sekmesi ve kayıt listesi tarama başlamadan doğrulanıyor…');
        setText(root, '#audit-progress', '');
        updateControls();

        const start = await requestExtension('START_YOKSIS_DOCUMENT_AUDIT', {
            scanId: state.scanId,
            ...(entries ? { entries } : {})
        }, 30_000);
        if (start.response?.success !== true) {
            state.busy = false;
            state.targetTabId = null;
            setText(root, '#audit-status', start.response?.error || 'Tarama başlatılamadı.');
            updateControls();
            return;
        }

        state.requestId = start.requestId;
        root.dataset.auditRequestId = state.requestId;
        state.targetTabId = start.response.yoksisTabId || null;
        setText(root, '#audit-status', entries
            ? `${entries.length} okunamayan kayıt sırayla yeniden okunuyor. Evrak yükleme veya kaydetme yapılmıyor.`
            : 'Tarama sürüyor. Evrak yükleme veya kaydetme yapılmıyor.');
        updateControls();
    }

    async function stopScan() {
        if (!state.busy || !Number.isInteger(state.targetTabId)) return;
        stopButton.disabled = true;
        setText(root, '#audit-status', 'Durdurma istendi; açık kayıt okuması bitince duracak…');
        const result = await requestExtension('STOP_YOKSIS_DOCUMENT_AUDIT', {
            scanId: state.scanId,
            targetTabId: state.targetTabId
        });
        if (result.response?.success !== true) {
            stopButton.disabled = false;
            setText(root, '#audit-status', result.response?.error || 'Durdurma isteği iletilemedi.');
        }
    }

    async function retryUnreadable() {
        if (state.busy || state.retryBusy || !retryButton || retryButton.disabled) return;
        state.retryBusy = true;
        updateControls();
        setText(root, '#audit-status', 'Okunamayan kayıtlar ortak depodan alınıyor…');
        try {
            const entries = await fetchUnreadableEntries();
            state.unreadableCount = entries.length;
            updateControls();
            if (!entries.length) {
                setText(root, '#audit-status', 'Yeniden okunacak kayıt yok.');
                return;
            }
            state.retryBusy = false;
            await startScan(entries);
        } catch (error) {
            setText(root, '#audit-status', error.message || 'Okunamayan kayıtlar alınamadı.');
        } finally {
            state.retryBusy = false;
            updateControls();
        }
    }

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.origin !== window.location.origin || !event.data) return;
        if (event.data.source === 'EXTENSION' && event.data.type === 'RESPONSE') {
            pending.get(event.data.requestId)?.(event.data.response || { success: false });
            return;
        }
        if (event.data.source === 'EXTENSION' && event.data.type === 'EVENT'
            && event.data.action === 'REQUEST_FAILED') {
            const error = typeof event.data.error === 'string' && event.data.error.trim()
                ? event.data.error.slice(0, 300)
                : 'Eklenti bağlantı isteği başarısız oldu.';
            pending.get(event.data.requestId)?.({
                success: false,
                error,
                code: typeof event.data.code === 'string' ? event.data.code.slice(0, 80) : undefined
            });
            return;
        }
        if (event.data.source !== 'EXTENSION' || event.data.type !== 'EVENT'
            || !AUDIT_EVENT_ACTIONS.has(event.data.action)
            || !state.busy || event.data.scanId !== state.scanId
            || (state.requestId && event.data.requestId !== state.requestId)) return;

        if (event.data.action === 'YOKSIS_DOCUMENT_AUDIT_RECORD') {
            appendRecord(root, event.data.data);
            queueRecord(state.scanId, event.data.data);
        } else if (event.data.action === 'YOKSIS_DOCUMENT_AUDIT_PROGRESS') {
            const { completed, total, remaining } = event.data.data || {};
            setText(root, '#audit-progress', `${completed || 0} / ${total || 0} kontrol edildi · ${remaining || 0} sırada`);
        } else {
            const completion = event.data.data || {};
            state.busy = false;
            if (currentBatch.length) {
                enqueueBatch(state.scanId, currentBatch);
                currentBatch = [];
            }
            await drainPendingBatches();
            setText(root, '#audit-progress', `${completion.completed || 0} kontrol edildi · ${completion.remaining || 0} sırada`);
            const labels = {
                complete: 'Tarama tamamlandı.',
                stopped: 'Tarama durduruldu.',
                incomplete: 'Kuyruk tam doğrulanamadı; sonuçları eksiksiz kabul etmeyin.',
                failed: 'Tarama güvenli biçimde tamamlanamadı.',
                rejected: 'Tarama isteği reddedildi.'
            };
            const scanLabel = labels[completion.status] || 'Tarama tamamlandı.';
            if (pendingBatches.length) {
                setText(root, '#audit-status', `${scanLabel} Ortak depoya kaydedilemeyen kayıtlar var; Yenile ile tekrar deneyin.`);
            } else if (completion.completed > 0) {
                const savedLabel = completion.status === 'complete'
                    ? 'Sonuçlar ortak depoya kaydedildi.'
                    : 'Okunan sonuçlar ortak depoya kaydedildi.';
                setText(root, '#audit-status', `${scanLabel} ${savedLabel}`);
            } else {
                setText(root, '#audit-status', scanLabel);
            }
            if (!pendingBatches.length) await loadSharedRecords();
            await refreshUnreadableCount();
            state.targetTabId = null;
            updateControls();
        }
    });

    async function loadLatestImport() {
        if (!excelLatest || typeof window.fetch !== 'function') return;
        try {
            const response = await window.fetch(`${SHARED_API}/import/latest`, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response.ok) {
                excelLatest.textContent = 'Son yükleme bilgisi alınamadı.';
                return;
            }
            const payload = await response.json();
            excelLatest.textContent = formatLatestImportLine(payload);
        } catch {
            excelLatest.textContent = 'Son yükleme bilgisi alınamadı.';
        }
    }

    function updateStaleFileWarning(exportedAt) {
        if (!excelStaleWarning) return;
        excelStaleWarning.hidden = !isExportedAtStale(exportedAt);
    }

    function handleExcelFileChange() {
        const file = excelFileInput?.files?.[0];
        if (!file) {
            if (excelFileInfo) {
                excelFileInfo.textContent = '';
                excelFileInfo.hidden = true;
            }
            updateStaleFileWarning(null);
            updateControls();
            return;
        }
        const validFile = isValidExcelFile(file);
        if (excelFileInfo) {
            const sizeLabel = formatFileSize(file.size);
            excelFileInfo.textContent = validFile
                ? `Seçilen dosya: ${file.name} (${sizeLabel})`
                : `Seçilen dosya: ${file.name} (${sizeLabel}) — Yalnız .xls veya .xlsx dosyaları yüklenebilir.`;
            excelFileInfo.hidden = false;
        }
        updateStaleFileWarning(validFile ? parseExportedAtFromFileName(file.name) : null);
        updateControls();
    }

    async function handleExcelUpload() {
        if (state.excelBusy) return;
        const file = excelFileInput?.files?.[0];
        if (!file) {
            setText(root, '#audit-excel-progress', 'Lütfen önce bir Excel dosyası (.xls veya .xlsx) seçin.');
            return;
        }
        state.excelBusy = true;
        updateControls();
        setText(root, '#audit-excel-progress', 'Excel dosyası okunuyor…');
        if (excelSummary) excelSummary.hidden = true;
        renderRejectedRows(root, []);

        try {
            const buffer = await readFileBuffer(file, window);
            const parsed = parseYoksisExcel(buffer, file.name, {
                XLSX: window.XLSX,
                size: file.size
            });
            updateStaleFileWarning(parsed.exportedAt);

            if (parsed.missingHeaders.length > 0) {
                setText(
                    root,
                    '#audit-excel-progress',
                    `YÖKSİS dışa aktarma biçimi değişmiş olabilir. Eksik başlıklar: ${parsed.missingHeaders.join(', ')}`
                );
                return;
            }

            if (excelSummary) {
                excelSummary.textContent = `${parsed.totalRows} satır, ${parsed.rows.length} başvuru (${parsed.mergedCount} tekrar birleştirildi), ${parsed.rejected.length} reddedildi`;
                excelSummary.hidden = false;
            }
            renderRejectedRows(root, parsed.rejected);

            if (parsed.rows.length === 0) {
                setText(root, '#audit-excel-progress', 'Yüklenecek geçerli satır bulunamadı.');
                return;
            }

            const result = await uploadYoksisImport({
                rows: parsed.rows,
                exportedAt: parsed.exportedAt,
                fetcher: window.fetch.bind(window),
                onProgress: ({ completedBatches, totalBatches, storedCount }) => {
                    setText(
                        root,
                        '#audit-excel-progress',
                        `${completedBatches} / ${totalBatches} paket yüklendi (${storedCount} kayıt)…`
                    );
                }
            });

            if (!result.ok) {
                setText(
                    root,
                    '#audit-excel-progress',
                    `Yükleme yarıda kaldı (${result.completedBatches}/${result.totalBatches} parti gönderildi). Aynı dosyayı yeniden seçip yükleyin; kayıtlar çift yazılmaz.`
                );
                return;
            }

            if (result.rejected.length > 0) {
                const serverRows = result.rejected.map((item) => ({
                    rowNumber: item.index + 2,
                    reason: item.reason
                }));
                renderRejectedRows(root, [...parsed.rejected, ...serverRows]);
            }
            setText(root, '#audit-excel-progress', `Excel aktarımı tamamlandı (${result.storedCount} kayıt kaydedildi).`);
            await loadLatestImport();
            await loadSharedRecords();
        } catch (error) {
            setText(root, '#audit-excel-progress', `Aktarım tamamlanamadı: ${error.message || 'Bilinmeyen hata.'}`);
        } finally {
            state.excelBusy = false;
            updateControls();
        }
    }

    startButton.addEventListener('click', () => { void startScan(); });
    retryButton?.addEventListener('click', () => { void retryUnreadable(); });
    stopButton.addEventListener('click', () => { void stopScan(); });
    excelFileInput?.addEventListener('change', () => { handleExcelFileChange(); });
    excelUploadButton?.addEventListener('click', () => { void handleExcelUpload(); });
    root.querySelector('#audit-search-submit')?.addEventListener('click', () => {
        query.page = 1;
        void loadSharedRecords();
    });
    root.querySelector('#audit-search')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        query.page = 1;
        void loadSharedRecords();
    });
    root.querySelector('#audit-filter')?.addEventListener('change', () => {
        query.page = 1;
        void loadSharedRecords();
    });
    root.querySelector('#audit-match')?.addEventListener('change', () => {
        query.page = 1;
        void loadSharedRecords();
    });
    root.querySelector('#audit-refresh')?.addEventListener('click', () => { void refreshSharedRecords(true); });
    root.querySelector('#audit-page-previous')?.addEventListener('click', () => {
        if (query.page <= 1) return;
        query.page -= 1;
        void loadSharedRecords();
    });
    root.querySelector('#audit-page-next')?.addEventListener('click', () => {
        if (query.page * query.pageSize >= query.total) return;
        query.page += 1;
        void loadSharedRecords();
    });
    updateControls();
    if (excelLatest) void loadLatestImport();
    void refreshSharedRecords(true);
}
