import { formatApplicationTimestamp } from '../shared/application-timestamps.js';

const STAFF_INQUIRIES_URL = '/api/staff/inquiries';
const INQUIRIES_TITLE = 'Gelen Sorular';

function resolveFetcher(document, customFetcher) {
    if (typeof customFetcher === 'function') return customFetcher;
    const view = document?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function buildTelHref(phone) {
    const raw = String(phone || '').trim();
    const hasLeadingPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/gu, '');
    if (!digits) return '';
    return `tel:${hasLeadingPlus ? '+' : ''}${digits}`;
}

function buildWhatsAppHref(phone) {
    const digits = String(phone || '').replace(/\D/gu, '');
    return digits ? `https://wa.me/${digits}` : '';
}

function normalizeCounts(counts) {
    return {
        new: Number.isFinite(Number(counts?.new)) ? Math.max(0, Number(counts.new)) : 0,
        answered: Number.isFinite(Number(counts?.answered)) ? Math.max(0, Number(counts.answered)) : 0
    };
}

function formatLanguageCode(language) {
    const value = String(language || '').trim().toUpperCase();
    return ['TR', 'EN', 'RU', 'TK', 'AR'].includes(value) ? value : '';
}

function findInquiryActionButton(rootElement, inquiryId, action) {
    for (const card of rootElement.querySelectorAll('.staff-inquiry-card')) {
        if (card.dataset.inquiryId === String(inquiryId)) {
            return card.querySelector(`[data-action="${action}"]`);
        }
    }
    return null;
}

/**
 * Mounts the staff "Gelen Sorular" inbox manager and fetches the initial "new" count once.
 * @param {HTMLElement} rootElement Container element (`#staff-inquiries-manager`).
 * @param {{fetcher?: typeof fetch}} [options] Optional fetch override for tests.
 * @returns {{refresh: (status?: 'new'|'answered') => Promise<void>, destroy: () => void}|null} Controller handle.
 */
export function mountInquiryManager(rootElement, { fetcher } = {}) {
    if (!rootElement) return null;

    const document = rootElement.ownerDocument;
    const state = {
        activeTab: 'new',
        items: [],
        counts: { new: 0, answered: 0 },
        loading: false,
        errorMessage: '',
        statusMessage: '',
        confirmDeleteId: null,
        pendingIds: new Set(),
        requestSeq: 0
    };

    function updateHomeBadges() {
        const newCount = state.counts.new;
        document.querySelectorAll('[data-inquiries-badge]').forEach((badge) => {
            badge.textContent = String(newCount);
            badge.hidden = newCount <= 0;
            if (newCount > 0) {
                badge.setAttribute('aria-label', `${newCount} yeni soru`);
            } else {
                badge.removeAttribute('aria-label');
            }
        });
    }

    async function requestJson(url, init = {}) {
        const fetchFn = resolveFetcher(document, fetcher);
        if (!fetchFn) {
            throw Object.assign(new Error('Bağlantı kurulamadı. Lütfen tekrar deneyin.'), { status: 0 });
        }
        let response;
        try {
            response = await fetchFn(url, { credentials: 'same-origin', ...init });
        } catch {
            throw Object.assign(new Error('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.'), { status: 0 });
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const fallbackMessage = response.status === 401
                ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
                : (response.status === 404
                    ? 'Soru kaydı bulunamadı. Listeyi yenileyebilirsiniz.'
                    : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.');
            throw Object.assign(new Error(payload?.error?.message || fallbackMessage), {
                status: response.status,
                code: payload?.error?.code
            });
        }
        return payload;
    }

    function createInquiryCard(item) {
        const card = document.createElement('article');
        card.className = 'staff-inquiry-card';
        card.dataset.inquiryId = String(item.id || '');

        const header = document.createElement('div');
        header.className = 'staff-inquiry-header';

        const identity = document.createElement('div');
        identity.className = 'staff-inquiry-identity';

        const name = document.createElement('h4');
        name.className = 'staff-inquiry-name';
        const fullName = [item.first_name, item.last_name]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join(' ');
        name.textContent = fullName || 'İsimsiz';
        identity.append(name);

        const langCode = formatLanguageCode(item.language);
        if (langCode) {
            const langBadge = document.createElement('span');
            langBadge.className = 'staff-inquiry-lang';
            langBadge.textContent = langCode;
            identity.append(langBadge);
        }

        const time = document.createElement('time');
        time.className = 'staff-inquiry-time';
        if (item.created_at) time.dateTime = String(item.created_at);
        time.textContent = formatApplicationTimestamp(item.created_at) || '—';

        header.append(identity, time);

        const message = document.createElement('p');
        message.className = 'staff-inquiry-message';
        message.textContent = String(item.message || '');

        const contacts = document.createElement('div');
        contacts.className = 'staff-inquiry-contacts';

        const phoneText = String(item.phone || '').trim();
        const telHref = buildTelHref(phoneText);
        if (telHref) {
            const telLink = document.createElement('a');
            telLink.className = 'staff-inquiry-link staff-inquiry-tel';
            telLink.href = telHref;
            telLink.textContent = phoneText;
            contacts.append(telLink);
        }

        const waHref = buildWhatsAppHref(phoneText);
        if (waHref) {
            const waLink = document.createElement('a');
            waLink.className = 'staff-inquiry-link staff-inquiry-whatsapp';
            waLink.href = waHref;
            waLink.target = '_blank';
            waLink.rel = 'noopener noreferrer';
            waLink.textContent = 'WhatsApp';
            contacts.append(waLink);
        }

        const emailText = typeof item.email === 'string' ? item.email.trim() : '';
        if (emailText) {
            const mailLink = document.createElement('a');
            mailLink.className = 'staff-inquiry-link staff-inquiry-email';
            mailLink.href = `mailto:${emailText}`;
            mailLink.textContent = emailText;
            contacts.append(mailLink);
        }

        card.append(header, message, contacts);

        if (item.status === 'answered' && (item.handled_by_name || item.handled_at)) {
            const handled = document.createElement('p');
            handled.className = 'staff-inquiry-handled';
            const parts = [
                item.handled_by_name ? String(item.handled_by_name).trim() : '',
                formatApplicationTimestamp(item.handled_at) || ''
            ].filter(Boolean);
            handled.textContent = `Cevaplandı: ${parts.join(' · ')}`;
            card.append(handled);
        }

        const actions = document.createElement('div');
        actions.className = 'staff-inquiry-actions';
        const isPending = state.pendingIds.has(item.id);

        const targetStatus = item.status === 'answered' ? 'new' : 'answered';
        const statusButton = document.createElement('button');
        statusButton.type = 'button';
        statusButton.className = item.status === 'answered' ? 'btn btn-outline' : 'btn btn-primary';
        statusButton.dataset.action = 'toggle-inquiry-status';
        statusButton.dataset.inquiryId = String(item.id || '');
        statusButton.dataset.targetStatus = targetStatus;
        statusButton.disabled = isPending;
        statusButton.textContent = item.status === 'answered' ? 'Yeniye al' : 'Cevaplandı';
        statusButton.addEventListener('click', () => {
            void handleStatusChange(item, targetStatus);
        });
        actions.append(statusButton);

        if (state.confirmDeleteId === item.id) {
            const confirmWrap = document.createElement('div');
            confirmWrap.className = 'staff-inquiry-delete-confirm';

            const prompt = document.createElement('span');
            prompt.className = 'staff-inquiry-confirm-text';
            prompt.textContent = 'Silinsin mi?';

            const confirmButton = document.createElement('button');
            confirmButton.type = 'button';
            confirmButton.className = 'btn btn-danger';
            confirmButton.dataset.action = 'confirm-delete-inquiry';
            confirmButton.dataset.inquiryId = String(item.id || '');
            confirmButton.disabled = isPending;
            confirmButton.textContent = isPending ? 'Siliniyor…' : 'Silmeyi onayla';
            confirmButton.addEventListener('click', () => {
                void handleDeleteInquiry(item);
            });

            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'btn btn-outline';
            cancelButton.dataset.action = 'cancel-delete-inquiry';
            cancelButton.dataset.inquiryId = String(item.id || '');
            cancelButton.disabled = isPending;
            cancelButton.textContent = 'Vazgeç';
            cancelButton.addEventListener('click', () => {
                state.confirmDeleteId = null;
                render();
                findInquiryActionButton(rootElement, item.id, 'request-delete-inquiry')?.focus();
            });

            confirmWrap.append(prompt, confirmButton, cancelButton);
            actions.append(confirmWrap);
        } else {
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'btn btn-outline staff-inquiry-delete-btn';
            deleteButton.dataset.action = 'request-delete-inquiry';
            deleteButton.dataset.inquiryId = String(item.id || '');
            deleteButton.disabled = isPending;
            deleteButton.textContent = 'Sil';
            deleteButton.addEventListener('click', () => {
                state.confirmDeleteId = item.id;
                render();
                findInquiryActionButton(rootElement, item.id, 'cancel-delete-inquiry')?.focus();
            });
            actions.append(deleteButton);
        }

        card.append(actions);
        return card;
    }

    function render() {
        const panel = document.createElement('div');
        panel.className = 'staff-inquiries-panel';

        const topbar = document.createElement('div');
        topbar.className = 'staff-inquiries-topbar';

        const headingGroup = document.createElement('div');
        headingGroup.className = 'staff-inquiries-heading';
        const title = document.createElement('h3');
        title.textContent = INQUIRIES_TITLE;
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Ana sayfa formundan gelen sorular. Yanıtlar telefon veya WhatsApp üzerinden verilir.';
        headingGroup.append(title, subtitle);

        const refreshButton = document.createElement('button');
        refreshButton.type = 'button';
        refreshButton.className = 'btn btn-outline';
        refreshButton.dataset.action = 'refresh-inquiries';
        refreshButton.disabled = state.loading;
        refreshButton.textContent = state.loading ? 'Yükleniyor…' : 'Yenile';
        refreshButton.addEventListener('click', () => {
            void loadInquiries(state.activeTab);
        });

        topbar.append(headingGroup, refreshButton);

        const tabs = document.createElement('div');
        tabs.className = 'staff-inquiries-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Soru durumları');

        for (const [tabStatus, label] of [['new', 'Yeni'], ['answered', 'Cevaplandı']]) {
            const tabButton = document.createElement('button');
            tabButton.type = 'button';
            tabButton.className = 'staff-inquiries-tab';
            tabButton.setAttribute('role', 'tab');
            tabButton.dataset.inquiryTab = tabStatus;
            const isSelected = state.activeTab === tabStatus;
            tabButton.setAttribute('aria-selected', String(isSelected));
            tabButton.classList.toggle('is-active', isSelected);

            const tabText = document.createElement('span');
            tabText.textContent = `${label} `;

            const countSpan = document.createElement('span');
            countSpan.className = 'staff-inquiries-tab-count';
            countSpan.dataset.tabCount = tabStatus;
            countSpan.textContent = String(state.counts[tabStatus] ?? 0);

            tabButton.append(tabText, countSpan);
            tabButton.addEventListener('click', () => {
                if (state.activeTab === tabStatus && !state.errorMessage) return;
                state.activeTab = tabStatus;
                state.confirmDeleteId = null;
                void loadInquiries(tabStatus);
            });
            tabs.append(tabButton);
        }

        panel.append(topbar, tabs);

        if (state.errorMessage) {
            const errorBox = document.createElement('p');
            errorBox.className = 'staff-inquiries-error';
            errorBox.setAttribute('role', 'alert');
            errorBox.textContent = state.errorMessage;
            panel.append(errorBox);
        }

        const statusRegion = document.createElement('p');
        statusRegion.className = 'staff-inquiries-status';
        statusRegion.setAttribute('role', 'status');
        statusRegion.setAttribute('aria-live', 'polite');
        statusRegion.textContent = state.statusMessage;
        statusRegion.hidden = !state.statusMessage;
        panel.append(statusRegion);

        if (state.loading && state.items.length === 0) {
            const loadingMsg = document.createElement('p');
            loadingMsg.className = 'staff-inquiries-empty';
            loadingMsg.textContent = 'Sorular yükleniyor…';
            panel.append(loadingMsg);
        } else if (state.items.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.className = 'staff-inquiries-empty';
            emptyMsg.textContent = state.activeTab === 'new'
                ? 'Bekleyen yeni soru yok.'
                : 'Cevaplandı olarak işaretlenen soru yok.';
            panel.append(emptyMsg);
        } else {
            const list = document.createElement('div');
            list.className = 'staff-inquiries-list';
            list.append(...state.items.map((item) => createInquiryCard(item)));
            panel.append(list);
        }

        rootElement.replaceChildren(panel);
    }

    async function loadInquiries(status = state.activeTab, { silentError = false } = {}) {
        const seq = ++state.requestSeq;
        state.activeTab = status === 'answered' ? 'answered' : 'new';
        state.loading = true;
        state.errorMessage = '';
        render();

        try {
            const payload = await requestJson(
                `${STAFF_INQUIRIES_URL}?status=${encodeURIComponent(state.activeTab)}&limit=100`,
                { headers: { Accept: 'application/json' } }
            );
            if (seq !== state.requestSeq) return;
            state.items = Array.isArray(payload?.items) ? payload.items : [];
            state.counts = normalizeCounts(payload?.counts);
            updateHomeBadges();
        } catch (error) {
            if (seq !== state.requestSeq) return;
            console.error('Staff inquiries load failed.', { errorName: error?.name || 'Error' });
            if (!silentError) {
                state.errorMessage = error?.message || 'Sorular yüklenemedi. Lütfen tekrar deneyin.';
            }
        } finally {
            if (seq === state.requestSeq) {
                state.loading = false;
                render();
            }
        }
    }

    async function handleStatusChange(item, nextStatus) {
        if (!item?.id || state.pendingIds.has(item.id)) return;
        state.pendingIds.add(item.id);
        state.errorMessage = '';
        state.statusMessage = '';
        render();

        try {
            const payload = await requestJson(`${STAFF_INQUIRIES_URL}/${encodeURIComponent(item.id)}`, {
                method: 'PATCH',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: nextStatus })
            });
            const updatedItem = payload?.item || { ...item, status: nextStatus };
            const previousStatus = item.status === 'answered' ? 'answered' : 'new';
            const resolvedStatus = updatedItem.status === 'answered' ? 'answered' : 'new';

            if (previousStatus !== resolvedStatus) {
                state.counts[previousStatus] = Math.max(0, state.counts[previousStatus] - 1);
                state.counts[resolvedStatus] = state.counts[resolvedStatus] + 1;
            }
            if (resolvedStatus !== state.activeTab) {
                state.items = state.items.filter((entry) => entry.id !== item.id);
            } else {
                state.items = state.items.map((entry) => (entry.id === item.id ? updatedItem : entry));
            }
            state.statusMessage = resolvedStatus === 'answered'
                ? 'Soru cevaplandı olarak işaretlendi.'
                : 'Soru yeni sekmesine alındı.';
            updateHomeBadges();
        } catch (error) {
            console.error('Staff inquiry status update failed.', { errorName: error?.name || 'Error' });
            state.errorMessage = error?.message || 'Durum güncellenemedi. Lütfen tekrar deneyin.';
        } finally {
            state.pendingIds.delete(item.id);
            render();
        }
    }

    async function handleDeleteInquiry(item) {
        if (!item?.id || state.pendingIds.has(item.id)) return;
        state.pendingIds.add(item.id);
        state.errorMessage = '';
        state.statusMessage = '';
        render();

        try {
            const payload = await requestJson(`${STAFF_INQUIRIES_URL}/${encodeURIComponent(item.id)}`, {
                method: 'DELETE',
                headers: { Accept: 'application/json' }
            });
            if (payload?.deleted !== false) {
                const itemStatus = item.status === 'answered' ? 'answered' : 'new';
                state.counts[itemStatus] = Math.max(0, state.counts[itemStatus] - 1);
                state.items = state.items.filter((entry) => entry.id !== item.id);
                state.confirmDeleteId = null;
                state.statusMessage = 'Soru silindi.';
                updateHomeBadges();
            }
        } catch (error) {
            console.error('Staff inquiry delete failed.', { errorName: error?.name || 'Error' });
            state.errorMessage = error?.message || 'Soru silinemedi. Lütfen tekrar deneyin.';
        } finally {
            state.pendingIds.delete(item.id);
            render();
        }
    }

    const handleWorkspaceViewChanged = (event) => {
        if (event.detail?.viewName === 'inquiries') {
            void loadInquiries(state.activeTab);
        }
    };

    const handleKeydown = (event) => {
        if (event.key === 'Escape' && state.confirmDeleteId) {
            event.preventDefault();
            event.stopPropagation();
            const cancelledId = state.confirmDeleteId;
            state.confirmDeleteId = null;
            render();
            findInquiryActionButton(rootElement, cancelledId, 'request-delete-inquiry')?.focus();
        }
    };

    document.addEventListener('workspace:view-changed', handleWorkspaceViewChanged);
    rootElement.addEventListener('keydown', handleKeydown);

    render();
    // Staff home açıldığında yalnızca bir kez yeni soru sayısını getir (polling yok).
    void loadInquiries('new', { silentError: true });

    return {
        refresh: (status = state.activeTab) => loadInquiries(status),
        destroy() {
            document.removeEventListener('workspace:view-changed', handleWorkspaceViewChanged);
            rootElement.removeEventListener('keydown', handleKeydown);
        }
    };
}
