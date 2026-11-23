/**
 * Staff-only Topi assistant panel: chat UI, result list rendering, and validated client action appliers.
 * Never mounts without an active staff session and never executes unvalidated server actions.
 */

import { OFFICE_DOCUMENTS } from '../config/documents-config.js';
import { createTopi, ensureTopiStyles, setTopiState } from '../public/topiMascot.js';
import {
    validateStaffAssistantAction,
    validateStaffAssistantResponse
} from '../shared/staff-assistant-contract.js';
import { buildCopiesPdfBlob } from './documentCopies.js';

const ASSISTANT_ENDPOINT = '/api/staff/assistant';
const WORK_HOURS_ENDPOINT = '/api/staff/work-hours';
const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_ITEMS = 6;
const BLOB_REVOKE_DELAY_MS = 60_000;
const UNAVAILABLE_MESSAGE = 'Asistan şu anda kullanılamıyor.';
const INVALID_ACTION_MESSAGE = 'İşlem doğrulanamadığı için uygulanmadı.';

const APPLICATION_STATUS_LABELS = Object.freeze({
    draft: 'Taslak',
    submitted: 'Gönderildi',
    under_review: 'İncelemede',
    resubmission_required: 'Yeniden yükleme gerekli',
    approved_for_processing: 'İşleme alınmak üzere onaylandı',
    sent_to_migration: 'Göç İdaresine gönderildi',
    migration_approved: 'Göç İdaresi onayladı',
    completed: 'Tamamlandı',
    cancelled: 'İptal edildi',
    rejected: 'Reddedildi'
});

const YOKSIS_STATUS_LABELS = Object.freeze({
    successful: 'İşlem tamamlandı',
    pending: 'Beklemede',
    missing_documents: 'Eksik evrak',
    rejected: 'Reddedildi',
    unreadable: 'Okunamadı',
    other: 'Diğer'
});

const UNKNOWN_STATUS_LABEL = 'Bilinmeyen durum';

function resolveApplicationStatusLabel(status) {
    if (typeof status === 'string' && Object.hasOwn(APPLICATION_STATUS_LABELS, status)) {
        return APPLICATION_STATUS_LABELS[status];
    }
    return UNKNOWN_STATUS_LABEL;
}

function resolveYoksisStatusLabel(statusCategory) {
    if (typeof statusCategory === 'string' && Object.hasOwn(YOKSIS_STATUS_LABELS, statusCategory)) {
        return YOKSIS_STATUS_LABELS[statusCategory];
    }
    return UNKNOWN_STATUS_LABEL;
}

const YKN_LEVEL_TO_TOPI_STATE = Object.freeze({
    info: 'checking',
    success: 'understood',
    error: 'confused'
});

const activeControllers = new WeakMap();

function resolveFetcher(doc, customFetcher) {
    if (typeof customFetcher === 'function') return customFetcher;
    const view = doc?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function prefersReducedMotion(doc) {
    return Boolean(doc?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function hasActiveStaffSession(doc) {
    const appContent = doc.getElementById('app-content');
    if (appContent) return !appContent.hidden;
    const loginOverlay = doc.getElementById('login-overlay');
    if (loginOverlay && !loginOverlay.hidden) return false;
    return true;
}

function clickWorkspaceView(doc, viewName) {
    const button = doc.querySelector(`button[data-workspace-view="${viewName}"]`);
    if (button) button.click();
}

function buildResultsElement(doc, results) {
    const section = doc.createElement('div');
    section.className = 'staff-assistant-results';

    const totalLine = doc.createElement('p');
    totalLine.className = 'staff-assistant-results-total';
    totalLine.textContent = `Toplam ${results.total}`;
    section.append(totalLine);

    const list = doc.createElement('ul');
    list.className = 'staff-assistant-results-list';

    if (results.kind === 'applications') {
        for (const item of results.items) {
            const li = doc.createElement('li');
            li.className = 'staff-assistant-result-item';

            const primary = doc.createElement('div');
            primary.className = 'staff-assistant-result-primary';
            const fullName = `${item.firstName} ${item.lastName}`.trim();
            primary.textContent = [item.referenceNumber, fullName].filter(Boolean).join(' · ');

            const meta = doc.createElement('div');
            meta.className = 'staff-assistant-result-meta';
            meta.textContent = [item.studentNumber, resolveApplicationStatusLabel(item.status)]
                .filter(Boolean)
                .join(' · ');

            li.append(primary, meta);
            list.append(li);
        }
    } else if (results.kind === 'yoksisAudit') {
        for (const item of results.items) {
            const li = doc.createElement('li');
            li.className = 'staff-assistant-result-item';

            const header = doc.createElement('div');
            header.className = 'staff-assistant-result-primary';
            header.textContent = [item.applicationNumber, item.fullName].filter(Boolean).join(' · ');

            const statusLabel = resolveYoksisStatusLabel(item.statusCategory);
            const meta = doc.createElement('div');
            meta.className = 'staff-assistant-result-meta';
            meta.textContent = [statusLabel, item.applicationStatus].filter(Boolean).join(' · ');

            li.append(header, meta);

            if (Array.isArray(item.missingDocuments) && item.missingDocuments.length > 0) {
                const docsLine = doc.createElement('div');
                docsLine.className = 'staff-assistant-result-docs';
                docsLine.textContent = `Eksik: ${item.missingDocuments
                    .map((entry) => (entry.note ? `${entry.name} (${entry.note})` : entry.name))
                    .join(', ')}`;
                li.append(docsLine);
            }

            if (item.missingDeadline) {
                const deadlineLine = doc.createElement('div');
                deadlineLine.className = 'staff-assistant-result-deadline';
                deadlineLine.textContent = `Son tarih: ${item.missingDeadline}`;
                li.append(deadlineLine);
            }

            if (item.isStale) {
                const staleBadge = doc.createElement('span');
                staleBadge.className = 'staff-assistant-badge-stale';
                staleBadge.textContent = 'Son yüklemede yok';
                li.append(staleBadge);
            }

            list.append(li);
        }
    }

    if (list.childElementCount > 0) {
        section.append(list);
    }

    return section;
}

/**
 * Mounts and manages the staff Topi assistant panel inside `#staff-assistant-root`.
 * Returns `null` when there is no valid document or no active staff session.
 *
 * @param {{ root?: Document, fetcher?: typeof fetch, now?: () => number }} [options]
 * @returns {{ open: () => void, close: () => void, destroy: () => void } | null}
 */
export function initializeStaffAssistant({ root = globalThis.document, fetcher, now = Date.now } = {}) {
    const doc = root;
    if (!doc || !doc.body || !hasActiveStaffSession(doc)) {
        return null;
    }

    const existing = activeControllers.get(doc);
    if (existing) existing.destroy();

    ensureTopiStyles(doc);

    const view = doc.defaultView || globalThis;
    const reducedMotion = prefersReducedMotion(doc);
    let isOpen = false;
    let isSending = false;
    let destroyed = false;
    let conversationHistory = [];
    const activeTimers = new Set();
    const activeBlobUrls = new Set();

    const mountParent = doc.getElementById('app-content') || doc.body;
    const rootContainer = doc.createElement('div');
    rootContainer.id = 'staff-assistant-root';
    rootContainer.className = reducedMotion
        ? 'staff-assistant-root is-reduced-motion'
        : 'staff-assistant-root';

    const launcherButton = doc.createElement('button');
    launcherButton.type = 'button';
    launcherButton.id = 'staff-assistant-launcher';
    launcherButton.className = 'staff-assistant-launcher';
    launcherButton.setAttribute('aria-expanded', 'false');
    launcherButton.setAttribute('aria-controls', 'staff-assistant-panel');
    launcherButton.setAttribute('aria-label', 'Topi yetkili asistanını aç');

    const launcherTopi = createTopi(doc, { state: 'idle', calm: reducedMotion, size: 42 });
    const launcherText = doc.createElement('span');
    launcherText.className = 'staff-assistant-launcher-text';
    launcherText.textContent = 'Topi';
    launcherButton.append(launcherTopi, launcherText);

    const panel = doc.createElement('section');
    panel.id = 'staff-assistant-panel';
    panel.className = 'staff-assistant-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'staff-assistant-title');
    panel.hidden = true;

    const header = doc.createElement('div');
    header.className = 'staff-assistant-header';

    const headerBrand = doc.createElement('div');
    headerBrand.className = 'staff-assistant-header-brand';
    const headerTopi = createTopi(doc, { state: 'idle', calm: reducedMotion, size: 32 });
    const title = doc.createElement('h2');
    title.id = 'staff-assistant-title';
    title.className = 'staff-assistant-title';
    title.textContent = 'Topi · Yetkili Asistanı';
    headerBrand.append(headerTopi, title);

    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'staff-assistant-close';
    closeButton.setAttribute('aria-label', 'Asistanı kapat');
    closeButton.textContent = '✕';
    header.append(headerBrand, closeButton);

    const log = doc.createElement('div');
    log.className = 'staff-assistant-log';
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions');
    log.setAttribute('aria-label', 'Asistan mesajları');

    const composer = doc.createElement('form');
    composer.className = 'staff-assistant-composer';
    composer.noValidate = true;

    const composerRow = doc.createElement('div');
    composerRow.className = 'staff-assistant-composer-row';

    const inputLabel = doc.createElement('label');
    inputLabel.className = 'staff-assistant-sr-only';
    inputLabel.htmlFor = 'staff-assistant-input';
    inputLabel.textContent = 'Topi asistanına mesaj yazın';

    const input = doc.createElement('textarea');
    input.id = 'staff-assistant-input';
    input.className = 'staff-assistant-input';
    input.name = 'message';
    input.rows = 2;
    input.maxLength = MAX_MESSAGE_LENGTH;
    input.placeholder = 'Başvuru, YKN, tebliğ, dilekçe veya çalışma saati...';

    const sendButton = doc.createElement('button');
    sendButton.type = 'submit';
    sendButton.className = 'staff-assistant-send';
    sendButton.textContent = 'Gönder';

    composerRow.append(inputLabel, input, sendButton);

    const composerMeta = doc.createElement('div');
    composerMeta.className = 'staff-assistant-composer-meta';

    const validationError = doc.createElement('p');
    validationError.id = 'staff-assistant-validation-error';
    validationError.className = 'staff-assistant-validation-error';
    validationError.setAttribute('role', 'alert');
    validationError.hidden = true;

    const counter = doc.createElement('span');
    counter.className = 'staff-assistant-counter';
    counter.textContent = `0 / ${MAX_MESSAGE_LENGTH}`;

    composerMeta.append(validationError, counter);
    composer.append(composerRow, composerMeta);

    panel.append(header, log, composer);
    rootContainer.append(launcherButton, panel);
    mountParent.append(rootContainer);

    function scheduleTimer(callback, delayMs) {
        const timerId = globalThis.setTimeout(() => {
            activeTimers.delete(timerId);
            if (!destroyed) callback();
        }, delayMs);
        if (typeof timerId?.unref === 'function') {
            timerId.unref();
        }
        activeTimers.add(timerId);
        return timerId;
    }

    function setMascotState(state) {
        setTopiState(headerTopi, state, { calm: reducedMotion });
        setTopiState(launcherTopi, isOpen || state === 'thinking' ? state : 'idle', { calm: reducedMotion });
    }

    function scrollLogToBottom() {
        log.scrollTop = log.scrollHeight;
    }

    function appendMessage({ role, text, isError = false, results = null, extraNode = null }) {
        const wrapper = doc.createElement('div');
        wrapper.className = `staff-assistant-message staff-assistant-message-${isError ? 'error' : role}`;
        wrapper.dataset.timestamp = String(now());

        const bubble = doc.createElement('p');
        bubble.className = 'staff-assistant-bubble';
        bubble.textContent = String(text ?? '');
        wrapper.append(bubble);

        if (results) {
            wrapper.append(buildResultsElement(doc, results));
        }

        if (extraNode) {
            wrapper.append(extraNode);
        }

        log.append(wrapper);
        scrollLogToBottom();
        return wrapper;
    }

    function updateInputMeta() {
        const length = input.value.length;
        const overLimit = length > MAX_MESSAGE_LENGTH;
        counter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
        counter.classList.toggle('is-over-limit', overLimit);

        if (overLimit) {
            validationError.textContent = `En fazla ${MAX_MESSAGE_LENGTH} karakter yazabilirsiniz.`;
            validationError.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'staff-assistant-validation-error');
        } else {
            validationError.hidden = true;
            validationError.textContent = '';
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-describedby');
        }
    }

    function setSendingState(pending) {
        isSending = pending;
        sendButton.disabled = pending;
        sendButton.textContent = pending ? 'Gönderiliyor...' : 'Gönder';
        if (pending) {
            panel.setAttribute('aria-busy', 'true');
            setMascotState('thinking');
        } else {
            panel.removeAttribute('aria-busy');
        }
    }

    function buildWorkHoursConfirmationRow(action, fetchFn) {
        const row = doc.createElement('div');
        row.className = 'staff-assistant-confirm-row';

        const label = doc.createElement('span');
        label.className = 'staff-assistant-confirm-label';
        label.textContent = action.label;

        const buttons = doc.createElement('div');
        buttons.className = 'staff-assistant-confirm-actions';

        const saveButton = doc.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'staff-assistant-confirm-save';
        saveButton.textContent = 'Kaydet';

        const cancelButton = doc.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'staff-assistant-confirm-cancel';
        cancelButton.textContent = 'Vazgeç';

        cancelButton.addEventListener('click', () => {
            row.remove();
        });

        saveButton.addEventListener('click', async () => {
            if (!fetchFn) {
                appendMessage({ role: 'assistant', text: 'Çalışma saati kaydedilemedi.', isError: true });
                setMascotState('confused');
                return;
            }
            saveButton.disabled = true;
            cancelButton.disabled = true;
            saveButton.textContent = 'Kaydediliyor...';
            try {
                const response = await fetchFn(WORK_HOURS_ENDPOINT, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        person: action.person,
                        minutes: action.minutes
                    })
                });
                if (destroyed) return;
                if (response.ok) {
                    const cleanLabel = String(action.label ?? '').trim().replace(/\.+$/, '');
                    const status = doc.createElement('span');
                    status.className = 'staff-assistant-confirm-status is-success';
                    status.textContent = `Kaydedildi: ${cleanLabel}. Çalışma Saatleri ekranı güncellendi.`;
                    buttons.replaceWith(status);
                    const CustomEventCtor = view?.CustomEvent || globalThis.CustomEvent;
                    if (CustomEventCtor && typeof view?.dispatchEvent === 'function') {
                        view.dispatchEvent(new CustomEventCtor('staff-work-hours:changed', {
                            detail: { person: action.person, minutes: action.minutes }
                        }));
                    }
                    setMascotState('understood');
                    return;
                }
                saveButton.disabled = false;
                cancelButton.disabled = false;
                saveButton.textContent = 'Kaydet';
                appendMessage({ role: 'assistant', text: 'Çalışma saati kaydedilemedi.', isError: true });
                setMascotState('confused');
            } catch {
                if (destroyed) return;
                saveButton.disabled = false;
                cancelButton.disabled = false;
                saveButton.textContent = 'Kaydet';
                appendMessage({ role: 'assistant', text: 'Çalışma saati kaydedilemedi.', isError: true });
                setMascotState('confused');
            }
        });

        buttons.append(saveButton, cancelButton);
        row.append(label, buttons);
        return row;
    }

    async function applyPrintDocumentAction(action, fetchFn) {
        const documentRecord = OFFICE_DOCUMENTS.find((entry) => entry.id === action.documentId);
        if (!documentRecord) {
            appendMessage({ role: 'assistant', text: 'İstenen belge bulunamadı.', isError: true });
            setMascotState('confused');
            return;
        }

        try {
            const blob = await buildCopiesPdfBlob(documentRecord.fileUrl, action.copies, { fetcher: fetchFn });
            if (destroyed) return;
            const urlApi = view?.URL || globalThis.URL;
            if (typeof urlApi?.createObjectURL !== 'function') {
                appendMessage({ role: 'assistant', text: 'Belge yazdırma penceresi açılamadı.', isError: true });
                setMascotState('confused');
                return;
            }
            const blobUrl = urlApi.createObjectURL(blob);
            activeBlobUrls.add(blobUrl);

            const printWindow = view?.open?.(blobUrl, '_blank');
            if (printWindow) {
                printWindow.addEventListener?.('load', () => {
                    printWindow.focus?.();
                    printWindow.print?.();
                }, { once: true });
            } else {
                appendMessage({
                    role: 'assistant',
                    text: 'Yazdırma penceresi açılamadı. Tarayıcı açılır pencere iznini kontrol edin.',
                    isError: true
                });
            }

            scheduleTimer(() => {
                if (activeBlobUrls.delete(blobUrl)) {
                    urlApi.revokeObjectURL?.(blobUrl);
                }
            }, BLOB_REVOKE_DELAY_MS);
        } catch (error) {
            if (destroyed) return;
            const message = error?.message === 'too-large'
                ? 'Belge kopyası 20 MB sınırını aştığı için hazırlanamadı.'
                : 'Belge yazdırma için hazırlanamadı.';
            appendMessage({ role: 'assistant', text: message, isError: true });
            setMascotState('confused');
        }
    }

    async function applyAction(rawAction, fetchFn) {
        let action;
        try {
            action = validateStaffAssistantAction(rawAction);
        } catch {
            appendMessage({ role: 'assistant', text: INVALID_ACTION_MESSAGE, isError: true });
            setMascotState('confused');
            return;
        }

        switch (action.type) {
        case 'navigate': {
            clickWorkspaceView(doc, action.view);
            return;
        }
        case 'ykn.run': {
            clickWorkspaceView(doc, 'ykn');
            const CustomEventCtor = view?.CustomEvent || globalThis.CustomEvent;
            if (CustomEventCtor && typeof view?.dispatchEvent === 'function') {
                view.dispatchEvent(new CustomEventCtor('ykn:auto-run', {
                    detail: { passportNo: action.passportNo }
                }));
            }
            return;
        }
        case 'tebligat.search': {
            clickWorkspaceView(doc, 'teblig');
            const toggleButton = doc.getElementById('tebligat-search-toggle');
            const searchBody = doc.getElementById('tebligat-search-body');
            const isCollapsed = (searchBody && (searchBody.style.display === 'none' || searchBody.hidden))
                || toggleButton?.getAttribute('aria-expanded') === 'false';
            if (isCollapsed && toggleButton) {
                toggleButton.click();
            }
            const searchInput = doc.getElementById('tebligat-search-input');
            if (searchInput) {
                searchInput.value = action.query;
                const EventCtor = view?.Event || globalThis.Event;
                searchInput.dispatchEvent(new EventCtor('input', { bubbles: true }));
            }
            return;
        }
        case 'documents.print': {
            await applyPrintDocumentAction(action, fetchFn);
            return;
        }
        default:
            appendMessage({ role: 'assistant', text: INVALID_ACTION_MESSAGE, isError: true });
            setMascotState('confused');
        }
    }

    async function sendMessage() {
        if (isSending || destroyed) return;

        const rawText = String(input.value ?? '');
        const trimmed = rawText.trim();
        if (rawText.length > MAX_MESSAGE_LENGTH || trimmed.length > MAX_MESSAGE_LENGTH) {
            updateInputMeta();
            return;
        }
        if (trimmed.length === 0) return;

        const historyPayload = conversationHistory.slice(-MAX_HISTORY_ITEMS);
        input.value = '';
        updateInputMeta();
        appendMessage({ role: 'user', text: trimmed });

        const fetchFn = resolveFetcher(doc, fetcher);
        if (!fetchFn) {
            appendMessage({ role: 'assistant', text: UNAVAILABLE_MESSAGE, isError: true });
            setMascotState('sleepy');
            return;
        }

        setSendingState(true);
        try {
            const response = await fetchFn(ASSISTANT_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: trimmed,
                    history: historyPayload
                })
            });

            if (destroyed) return;
            if (!response.ok) {
                appendMessage({ role: 'assistant', text: UNAVAILABLE_MESSAGE, isError: true });
                setMascotState(response.status === 503 || response.status === 429 ? 'sleepy' : 'confused');
                return;
            }

            let rawPayload;
            try {
                rawPayload = await response.json();
            } catch {
                appendMessage({ role: 'assistant', text: UNAVAILABLE_MESSAGE, isError: true });
                setMascotState('confused');
                return;
            }

            if (destroyed) return;

            let validated;
            try {
                validated = validateStaffAssistantResponse(rawPayload);
            } catch {
                appendMessage({ role: 'assistant', text: INVALID_ACTION_MESSAGE, isError: true });
                setMascotState('confused');
                return;
            }

            conversationHistory = [
                ...conversationHistory,
                { role: 'user', content: trimmed },
                { role: 'assistant', content: validated.reply.trim().slice(0, MAX_MESSAGE_LENGTH) }
            ].slice(-MAX_HISTORY_ITEMS);

            const extraNode = validated.action?.type === 'workHours.propose'
                ? buildWorkHoursConfirmationRow(validated.action, fetchFn)
                : null;

            appendMessage({
                role: 'assistant',
                text: validated.reply,
                results: validated.results || null,
                extraNode
            });
            setMascotState(validated.state);

            if (validated.action && validated.action.type !== 'workHours.propose') {
                await applyAction(validated.action, fetchFn);
            }
        } catch {
            if (destroyed) return;
            appendMessage({ role: 'assistant', text: UNAVAILABLE_MESSAGE, isError: true });
            setMascotState('sleepy');
        } finally {
            if (!destroyed) setSendingState(false);
        }
    }

    function open() {
        if (destroyed || isOpen) return;
        isOpen = true;
        panel.hidden = false;
        rootContainer.classList.add('is-panel-open');
        launcherButton.setAttribute('aria-expanded', 'true');
        doc.addEventListener('keydown', handleDocumentKeydown);
        input.focus();
    }

    function close({ restoreFocus = true } = {}) {
        if (destroyed || !isOpen) return;
        isOpen = false;
        panel.hidden = true;
        rootContainer.classList.remove('is-panel-open');
        launcherButton.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('keydown', handleDocumentKeydown);
        if (!isSending) {
            setMascotState('idle');
        }
        if (restoreFocus) {
            launcherButton.focus();
        }
    }

    function handleDocumentKeydown(event) {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close({ restoreFocus: true });
        }
    }

    function handleYknAutoFlowStatus(event) {
        if (destroyed) return;
        const message = typeof event?.detail?.message === 'string' ? event.detail.message.trim() : '';
        const level = typeof event?.detail?.level === 'string' ? event.detail.level : 'info';
        const topiState = YKN_LEVEL_TO_TOPI_STATE[level] || 'checking';
        setMascotState(topiState);
        if (message) {
            appendMessage({
                role: 'status',
                text: message,
                isError: level === 'error'
            });
        }
    }

    launcherButton.addEventListener('click', () => {
        if (isOpen) {
            close({ restoreFocus: true });
        } else {
            open();
        }
    });

    closeButton.addEventListener('click', () => {
        close({ restoreFocus: true });
    });

    input.addEventListener('input', updateInputMeta);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            void sendMessage();
        }
    });

    composer.addEventListener('submit', (event) => {
        event.preventDefault();
        void sendMessage();
    });

    view?.addEventListener?.('ykn:auto-flow-status', handleYknAutoFlowStatus);

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        doc.removeEventListener('keydown', handleDocumentKeydown);
        view?.removeEventListener?.('ykn:auto-flow-status', handleYknAutoFlowStatus);

        for (const timerId of activeTimers) {
            globalThis.clearTimeout(timerId);
        }
        activeTimers.clear();

        const urlApi = view?.URL || globalThis.URL;
        for (const blobUrl of activeBlobUrls) {
            urlApi?.revokeObjectURL?.(blobUrl);
        }
        activeBlobUrls.clear();

        rootContainer.remove();
        if (activeControllers.get(doc) === controller) {
            activeControllers.delete(doc);
        }
    }

    const controller = {
        open,
        close: () => close({ restoreFocus: false }),
        destroy
    };
    activeControllers.set(doc, controller);
    return controller;
}
