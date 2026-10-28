const AUDIT_EVENT_ACTIONS = new Set([
    'YOKSIS_DOCUMENT_AUDIT_PROGRESS',
    'YOKSIS_DOCUMENT_AUDIT_RECORD',
    'YOKSIS_DOCUMENT_AUDIT_COMPLETE'
]);

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

function classifyApplicationStatus(status) {
    const normalized = String(status || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    if (normalized === 'islem tamamlandi') return { key: 'success', label: 'Başarılı' };
    if (normalized === 'islem bekliyor') return { key: 'pending', label: 'Beklemede' };
    if (normalized === 'eksik belge bekliyor') return { key: 'failure', label: 'Başarısız' };
    return { key: 'unclassified', label: 'Sınıflandırılamadı' };
}

function appendRecord(root, data) {
    const document = root.ownerDocument;
    const row = document.createElement('tr');
    const verified = data.result?.status === 'verified';
    const identity = verified ? data.result.identity : null;
    const classification = verified
        ? classifyApplicationStatus(data.result.applicationStatus)
        : { key: 'unclassified', label: 'Sınıflandırılamadı' };
    const values = [
        data.entry?.applicationNumber || '—',
        identity ? `${identity.firstName} ${identity.lastName}`.trim() : '—',
        data.entry?.studentNumber || '—',
        identity?.phone || '—',
        verified ? data.result.applicationStatus : 'Kontrol edilemedi',
        verified ? formatDocuments(data.result.documents || []) : 'Kayıt güvenli biçimde okunamadı',
        classification.label
    ];
    for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.append(cell);
    }
    row.dataset.auditResult = verified ? 'verified' : 'unreadable';
    row.dataset.auditClassification = classification.key;
    row.cells[6].dataset.auditClassification = classification.key;
    root.querySelector('#audit-results')?.append(row);
}

/** Initializes the YÖKSİS audit panel after staff authorization succeeds. */
export function initializeYoksisDocumentAuditManager(root) {
    const window = root.ownerDocument.defaultView;
    const startButton = root.querySelector('#audit-start');
    const stopButton = root.querySelector('#audit-stop');
    const confirmation = root.querySelector('#audit-confirm');
    if (!window || !startButton || !stopButton || !confirmation || !root.querySelector('#audit-results')) return;

    const pending = new Map();
    const state = { scanId: '', requestId: '', targetTabId: null, busy: false };

    function updateControls() {
        startButton.disabled = state.busy;
        stopButton.hidden = !state.busy;
        stopButton.disabled = !state.busy || !Number.isInteger(state.targetTabId);
    }

    function requestExtension(action, payload = {}, timeoutMs = 10_000) {
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
        root.dataset.auditScanId = state.scanId;
        root.querySelector('#audit-results')?.replaceChildren();
        setText(root, '#audit-status', 'YÖKSİS sekmesi ve kayıt listesi doğrulanıyor…');
        setText(root, '#audit-progress', '');
        updateControls();

        const readiness = await requestExtension('CHECK_YOKSIS_DOCUMENT_AUDIT', { scanId: state.scanId });
        if (readiness.response?.ready !== true || !Number.isInteger(readiness.response.yoksisTabId)) {
            state.busy = false;
            setText(root, '#audit-status', readiness.response?.error || 'Açık YÖKSİS sekmesinde doğrulanabilir kayıt listesi bulunamadı.');
            updateControls();
            return;
        }

        state.targetTabId = readiness.response.yoksisTabId;
        const start = await requestExtension('START_YOKSIS_DOCUMENT_AUDIT', { scanId: state.scanId }, 15_000);
        if (start.response?.success !== true) {
            state.busy = false;
            state.targetTabId = null;
            setText(root, '#audit-status', start.response?.error || 'Tarama başlatılamadı.');
            updateControls();
            return;
        }

        state.requestId = start.requestId;
        root.dataset.auditRequestId = state.requestId;
        state.targetTabId = start.response.yoksisTabId || state.targetTabId;
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

    window.addEventListener('message', (event) => {
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
        } else if (event.data.action === 'YOKSIS_DOCUMENT_AUDIT_PROGRESS') {
            const { completed, total, remaining } = event.data.data || {};
            setText(root, '#audit-progress', `${completed || 0} / ${total || 0} kontrol edildi · ${remaining || 0} sırada`);
        } else {
            const completion = event.data.data || {};
            state.busy = false;
            setText(root, '#audit-progress', `${completion.completed || 0} kontrol edildi · ${completion.remaining || 0} sırada`);
            const labels = {
                complete: 'Tarama tamamlandı.',
                stopped: 'Tarama durduruldu.',
                incomplete: 'Kuyruk tam doğrulanamadı; sonuçları eksiksiz kabul etmeyin.',
                failed: 'Tarama güvenli biçimde tamamlanamadı.',
                rejected: 'Tarama isteği reddedildi.'
            };
            setText(root, '#audit-status', labels[completion.status] || 'Tarama tamamlandı.');
            state.targetTabId = null;
            updateControls();
        }
    });

    startButton.addEventListener('click', () => { void startScan(); });
    stopButton.addEventListener('click', () => { void stopScan(); });
    updateControls();
}
