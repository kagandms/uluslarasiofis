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

function classifyApplicationStatus(status) {
    const normalized = normalizeStatus(status);
    if (['islem tamamlandi', 'tamamlandi'].includes(normalized)) return 'successful';
    if (normalized === 'islem bekliyor') return 'pending';
    if (normalized === 'eksik belge bekliyor') return 'missing_documents';
    if (['reddedildi', 'basvuru reddedildi', 'ret'].includes(normalized)) return 'rejected';
    return 'other';
}

function appendRecord(root, data, categoryOverride = '') {
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
    }, record.status_category);
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
    const stopButton = root.querySelector('#audit-stop');
    const confirmation = root.querySelector('#audit-confirm');
    const results = root.querySelector('#audit-results');
    if (!window || !startButton || !stopButton || !confirmation || !results) return;

    const pending = new Map();
    const state = { scanId: '', requestId: '', targetTabId: null, busy: false };
    const query = { status: 'all', page: 1, pageSize: PAGE_SIZE, total: 0, sequence: 0 };
    const pendingBatches = readPendingBatches(window);
    let currentBatch = [];
    let persistenceQueue = Promise.resolve();
    let persistenceBlocked = false;

    function updateControls() {
        startButton.disabled = state.busy;
        stopButton.hidden = !state.busy;
        stopButton.disabled = !state.busy || !Number.isInteger(state.targetTabId);
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
        if (!response.ok) throw new Error(payload?.error?.message || 'Ortak kayıt işlemi tamamlanamadı.');
        return payload || {};
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
        const body = {
            q: searchInput?.value || '',
            status: statusSelect?.value || query.status,
            page: query.page,
            pageSize: query.pageSize
        };
        query.status = body.status;
        setText(root, '#audit-shared-count', 'Ortak kayıtlar yükleniyor…');
        try {
            const payload = await postShared('query', body);
            if (requestSequence !== query.sequence) return;
            results.replaceChildren();
            for (const record of payload.records || []) appendSharedRecord(root, record);
            query.total = Number.isSafeInteger(payload.total) ? payload.total : 0;
            setText(root, '#audit-shared-count', `${query.total} kayıt`);
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
    }

    async function startScan() {
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
        setText(root, '#audit-status', 'YÖKSİS sekmesi ve kayıt listesi tarama başlamadan doğrulanıyor…');
        setText(root, '#audit-progress', '');
        updateControls();

        setText(root, '#audit-status', 'YÖKSİS sekmesi ve kayıt listesi tarama başlamadan doğrulanıyor…');
        const start = await requestExtension('START_YOKSIS_DOCUMENT_AUDIT', { scanId: state.scanId }, 30_000);
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
        setText(root, '#audit-status', 'Tarama sürüyor. Evrak yükleme veya kaydetme yapılmıyor.');
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
            } else {
                setText(root, '#audit-status', `${scanLabel} Sonuçlar ortak depoya kaydedildi.`);
                await loadSharedRecords();
            }
            state.targetTabId = null;
            updateControls();
        }
    });

    startButton.addEventListener('click', () => { void startScan(); });
    stopButton.addEventListener('click', () => { void stopScan(); });
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
    void refreshSharedRecords(true);
}
