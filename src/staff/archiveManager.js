import { PUBLIC_MESSAGES } from '../public/i18n/messages.js';
import { downloadApplicationArchive } from './applicationArchive.js';
import { readDocumentAccessMessage } from './documentAccessMessages.js';

const STATUS_LABELS = Object.freeze({
    completed: 'Tamamlandı',
    cancelled: 'İptal edildi',
    rejected: 'Reddedildi'
});
const DOCUMENT_STATE_LABELS = Object.freeze({
    pending: 'İnceleme bekliyor', under_review: 'İnceleniyor', approved: 'Onaylandı',
    resubmission_required: 'Yeniden yükleme gerekli', submitted: 'Gönderildi',
    finalized: 'Yüklendi', clean: 'Temiz', unsafe: 'Güvenli değil', failed: 'Başarısız',
    complete: 'Tamamlandı'
});
const ARCHIVE_STATUS_FILTERS = Object.freeze([
    ['terminal', 'Tümü'],
    ['completed', 'Tamamlandı'],
    ['cancelled', 'İptal edildi'],
    ['rejected', 'Reddedildi']
]);
const SAFE_PREVIEW_MEDIA_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const APPLICATION_DOCUMENT_ROUTE = (applicationId, code, action) =>
    `/api/staff/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(code)}/${action}`;

function createText(document, tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
}

function formatDate(value) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '—';
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function displayValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
    return String(value);
}

function readStatusLabel(status) {
    return STATUS_LABELS[status] || 'Durum bilgisi yok';
}

function readDocumentStateLabel(status) {
    if (!status) return 'Yüklenmemiş';
    return DOCUMENT_STATE_LABELS[status] || 'Durum bilgisi yok';
}

function createSelect(document, name, value, options) {
    const select = document.createElement('select');
    select.className = 'glass-input';
    select.name = name;
    options.forEach(([optionValue, label]) => {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = label;
        option.selected = optionValue === value;
        select.append(option);
    });
    return select;
}

function createSearchForm(document, state, onSubmit) {
    const form = document.createElement('form');
    const search = document.createElement('input');
    const label = createText(document, 'label', '', 'Başvuru ara');
    search.className = 'glass-input';
    search.name = 'q';
    search.maxLength = 120;
    search.value = state.query.q;
    search.placeholder = 'Öğrenci no, ad, soyad veya pasaport no';
    label.htmlFor = 'staff-archive-search';
    search.id = label.htmlFor;
    const statusLabel = createText(document, 'label', '', 'Durum');
    const status = createSelect(document, 'status', state.query.status, ARCHIVE_STATUS_FILTERS);
    statusLabel.htmlFor = 'staff-archive-status';
    status.id = statusLabel.htmlFor;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.disabled = state.loading;
    submit.textContent = 'Filtrele';
    form.className = 'staff-archive-filters';
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        onSubmit({ q: search.value, status: status.value });
    });
    form.append(label, search, statusLabel, status, submit);
    return form;
}

function createArchiveButton(document, state, applicationId, onDownload) {
    const button = document.createElement('button');
    const isActive = state.archiveApplicationId === applicationId;
    button.type = 'button';
    button.className = 'btn btn-outline';
    button.dataset.action = 'download-application-archive';
    button.textContent = isActive ? 'ZIP’i iptal et' : 'Belgeleri ZIP indir';
    button.setAttribute('aria-label', isActive ? 'ZIP indirmeyi iptal et' : 'Belgeleri ZIP indir');
    button.addEventListener('click', () => onDownload(applicationId));
    return button;
}

function createQueueTable(document, items, state, handlers) {
    const table = document.createElement('table');
    table.className = 'staff-archive-table';
    const headers = ['Öğrenci No', 'Ad Soyad', 'Başvuru Türü', 'Durum', 'Gönderim Tarihi', 'Son Güncelleme', ''];
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => headerRow.append(createText(document, 'th', '', header)));
    head.append(headerRow);
    const body = document.createElement('tbody');
    items.forEach((item) => {
        const row = document.createElement('tr');
        const values = [
            item.student_number,
            [item.first_name, item.last_name].filter(Boolean).join(' ') || '—',
            item.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru',
            readStatusLabel(item.status),
            formatDate(item.submitted_at),
            formatDate(item.updated_at)
        ];
        values.forEach((value, index) => {
            const cell = createText(document, 'td', '', displayValue(value));
            cell.dataset.label = headers[index];
            row.append(cell);
        });
        const actionCell = document.createElement('td');
        actionCell.dataset.label = 'Detay';
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'btn btn-outline';
        action.dataset.action = 'open-detail';
        action.textContent = 'Detay';
        action.addEventListener('click', () => handlers.onOpenDetail(item.id));
        actionCell.append(action, createArchiveButton(document, state, item.id, handlers.onDownloadArchive));
        row.append(actionCell);
        body.append(row);
    });
    table.append(head, body);
    return table;
}

function createPagination(document, pagination, onPageChange) {
    const controls = document.createElement('div');
    const previous = document.createElement('button');
    const next = document.createElement('button');
    controls.className = 'staff-archive-pagination';
    previous.type = 'button';
    previous.className = 'btn btn-outline';
    previous.dataset.action = 'previous-page';
    previous.textContent = 'Önceki';
    previous.disabled = pagination.page <= 1;
    previous.addEventListener('click', () => onPageChange(pagination.page - 1));
    const totalPages = pagination.total_pages ?? 0;
    const totalItems = pagination.total_items ?? 0;
    const pageDisplay = totalPages === 0 ? 0 : pagination.page;
    const pages = createText(document, 'p', '', `Sayfa ${pageDisplay} / ${totalPages} · ${totalItems} başvuru`);
    next.type = 'button';
    next.className = 'btn btn-outline';
    next.dataset.action = 'next-page';
    next.textContent = 'Sonraki';
    next.disabled = totalPages === 0 || pagination.page >= totalPages;
    next.addEventListener('click', () => onPageChange(pagination.page + 1));
    controls.append(previous, pages, next);
    return controls;
}

function createQueueError(document, state, onRetry) {
    const panel = document.createElement('section');
    const message = state.errorStatus === 401
        ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
        : 'Arşiv kayıtları yüklenemedi. Lütfen tekrar deneyin.';
    panel.className = 'staff-archive-state';
    panel.append(createText(document, 'p', '', message));
    if (state.errorStatus !== 401) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-outline';
        retry.dataset.action = 'retry-queue';
        retry.textContent = 'Tekrar dene';
        retry.addEventListener('click', onRetry);
        panel.append(retry);
    }
    return panel;
}

function renderQueue(root, state, handlers) {
    const document = root.ownerDocument;
    const panel = document.createElement('div');
    panel.className = 'staff-archive-queue';
    panel.append(createSearchForm(document, state, handlers.onSearch));
    if (state.loading) {
        panel.append(createText(document, 'p', 'staff-archive-state', 'Arşiv kayıtları yükleniyor…'));
    } else if (state.error) {
        panel.append(createQueueError(document, state, handlers.onRetry));
    } else if (state.result?.items.length === 0) {
        panel.append(createText(document, 'p', 'staff-archive-state', 'Görüntülenecek arşiv kaydı bulunamadı.'));
    } else if (state.result) {
        panel.append(createQueueTable(document, state.result.items, state, handlers));
        panel.append(createPagination(document, state.result.pagination, handlers.onPageChange));
    }
    if (state.archiveNotice) panel.append(createText(document, 'p', 'staff-archive-state', state.archiveNotice));
    root.replaceChildren(panel);
}

function appendDetail(document, list, label, value) {
    list.append(createText(document, 'dt', '', label), createText(document, 'dd', '', displayValue(value)));
}

function createApplicationSummary(document, application) {
    const section = document.createElement('section');
    const details = document.createElement('dl');
    const fields = [
        ['Başvuru No', application.id], ['Öğrenci No', application.student_number],
        ['Durum', readStatusLabel(application.status)],
        ['Başvuru türü', application.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru'],
        ['Ad', application.first_name], ['Soyad', application.last_name], ['E-posta', application.email],
        ['Telefon', application.phone], ['Pasaport No', application.passport_number], ['Uyruk', application.nationality],
        ['Doğum tarihi', application.date_of_birth], ['18 yaş altı', application.is_under_18],
        ['Adres belgesi türü', application.address_evidence_type], ['Parmak izi durumu', application.fingerprint_status],
        ['Parmak izi kodu', application.fingerprint_code], ['Beyan sürümü', application.declaration_version],
        ['Beyan tarihi', formatDate(application.declaration_accepted_at)],
        ['İletişim teyidi', application.contact_acknowledgement_accepted_current ? 'Onaylandı' : 'Onaylanmadı'],
        ['İletişim teyit tarihi', formatDate(application.contact_acknowledgement_accepted_at)],
        ['Oluşturulma', formatDate(application.created_at)], ['Gönderim', formatDate(application.submitted_at)],
        ['Son güncelleme', formatDate(application.updated_at)]
    ];
    section.className = 'staff-archive-summary';
    section.append(createText(document, 'h4', '', 'Başvuru ve başvuran bilgileri'));
    details.className = 'staff-archive-details-grid';
    fields.forEach(([label, value]) => appendDetail(document, details, label, value));
    section.append(details);
    return section;
}

function createDocumentAccessActions(document, applicationId, item, handlers, isPending) {
    const actions = document.createElement('div');
    actions.className = 'staff-archive-document-actions';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'btn btn-outline';
    preview.dataset.action = 'preview-document';
    preview.dataset.documentCode = item.code;
    preview.disabled = isPending;
    preview.textContent = 'Önizle';
    preview.addEventListener('click', () => handlers.onPreview(item));
    const download = document.createElement('a');
    download.className = 'btn btn-outline';
    download.dataset.action = 'download-document';
    download.href = APPLICATION_DOCUMENT_ROUTE(applicationId, item.code, 'download');
    download.download = item.filename || 'belge';
    if (isPending) download.setAttribute('aria-disabled', 'true');
    download.textContent = 'İndir';
    actions.append(preview, download);
    return actions;
}

function createUnavailableDocumentState(document, item) {
    return createText(document, 'p', 'staff-archive-document-unavailable', readDocumentAccessMessage(item));
}

function createDocumentSection(document, applicationId, documents, state, handlers) {
    const section = document.createElement('section');
    const list = document.createElement('div');
    section.className = 'staff-archive-documents';
    section.append(createText(document, 'h4', '', 'Güncel belge durumları'));
    list.className = 'staff-archive-document-list';
    documents.forEach((item) => {
        const card = document.createElement('article');
        const label = PUBLIC_MESSAGES.tr[item.label_key] || item.code;
        const details = document.createElement('dl');
        const fields = [
            ['Revizyon', item.revision_number], ['İnceleme', readDocumentStateLabel(item.review_status)],
            ['Revizyon durumu', readDocumentStateLabel(item.revision_status)],
            ['Yükleme', readDocumentStateLabel(item.upload_status)], ['Tarama', readDocumentStateLabel(item.scan_status)],
            ['Temizleme', readDocumentStateLabel(item.cleanup_status)], ['Dosya adı', item.filename]
        ];
        card.className = 'staff-archive-document-card';
        card.append(createText(document, 'h5', '', label));
        details.className = 'staff-archive-details-grid';
        fields.forEach(([fieldLabel, value]) => appendDetail(document, details, fieldLabel, value));
        card.append(details, item.access_available === true
            ? createDocumentAccessActions(document, applicationId, item, handlers, Boolean(state.actionPending))
            : createUnavailableDocumentState(document, item));
        if (item.student_message) {
            card.append(createText(document, 'p', 'staff-archive-student-message', `Öğrenciye iletilen neden: ${item.student_message}`));
        }
        list.append(card);
    });
    section.append(list);
    return section;
}

function validatePreviewCapability(capability) {
    const url = new URL(capability?.url);
    const isValidExpiry = typeof capability?.expires_at === 'string' && Number.isFinite(Date.parse(capability.expires_at));
    const isPrivateR2Host = /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(url.hostname);
    if (url.protocol !== 'https:' || url.username || url.password || !isPrivateR2Host
        || !SAFE_PREVIEW_MEDIA_TYPES.has(capability?.media_type) || !isValidExpiry) {
        throw new Error('Preview capability is invalid.');
    }
    return { ...capability, url: url.href };
}

function createPreviewPanel(document, preview, handlers) {
    if (!preview) return null;
    const panel = document.createElement('section');
    const close = document.createElement('button');
    panel.id = 'staff-document-preview';
    panel.className = 'staff-document-preview';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `Belge önizlemesi: ${preview.document.filename || ''}`);
    close.type = 'button';
    close.className = 'btn btn-outline';
    close.dataset.action = 'close-document-preview';
    close.textContent = 'Önizlemeyi kapat';
    close.addEventListener('click', handlers.onClose);
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') handlers.onClose();
    });
    panel.append(createText(document, 'h4', '', `Önizleme: ${preview.document.filename || 'Belge'}`), close);
    if (preview.status === 'loading') {
        panel.append(createText(document, 'p', 'staff-archive-state', 'Önizleme hazırlanıyor…'));
    } else if (preview.status === 'error' || preview.status === 'expired') {
        const message = preview.status === 'expired'
            ? 'Önizleme süresi doldu. Yeni bir erişim oluşturun.'
            : 'Belge önizlemesi açılamadı. Lütfen tekrar deneyin.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-outline';
        retry.dataset.action = 'retry-document-preview';
        retry.textContent = 'Yeniden önizle';
        retry.addEventListener('click', (event) => handlers.onRetry(event.currentTarget));
        panel.append(createText(document, 'p', 'staff-archive-state', message), retry);
    } else if (preview.status === 'ready' && preview.capability.media_type === 'application/pdf') {
        const frame = document.createElement('iframe');
        frame.title = `Belge önizlemesi: ${preview.document.filename || 'PDF'}`;
        frame.setAttribute('sandbox', '');
        frame.referrerPolicy = 'no-referrer';
        frame.src = preview.capability.url;
        panel.append(frame);
    } else if (preview.status === 'ready') {
        const image = document.createElement('img');
        image.alt = `Belge önizlemesi: ${preview.document.filename || 'Görsel'}`;
        image.referrerPolicy = 'no-referrer';
        image.src = preview.capability.url;
        panel.append(image);
    }
    return panel;
}

function renderDetail(root, state, handlers) {
    const document = root.ownerDocument;
    const panel = document.createElement('div');
    const back = document.createElement('button');
    panel.className = 'staff-archive-detail-view';
    back.type = 'button';
    back.className = 'btn btn-outline';
    back.dataset.action = 'back-to-queue';
    back.textContent = 'Arşiv listesine dön';
    back.addEventListener('click', handlers.onBack);
    panel.append(back);
    if (state.loading) {
        panel.append(createText(document, 'p', 'staff-archive-state', 'Başvuru ayrıntıları yükleniyor…'));
    } else if (state.error) {
        const message = state.errorStatus === 401
            ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
            : 'Başvuru ayrıntıları yüklenemedi. Lütfen tekrar deneyin.';
        panel.append(createText(document, 'p', 'staff-archive-state', message));
    } else if (state.detail) {
        if (['completed', 'cancelled', 'rejected'].includes(state.detail.application.status)) {
            panel.append(createArchiveButton(document, state, state.detail.application.id, handlers.onDownloadArchive));
        }
        panel.append(
            createApplicationSummary(document, state.detail.application),
            createDocumentSection(document, state.detail.application.id, state.detail.documents, state, handlers)
        );
    }
    if (state.archiveNotice) panel.append(createText(document, 'p', 'staff-archive-state', state.archiveNotice));
    const previewPanel = createPreviewPanel(document, state.preview, handlers);
    if (previewPanel) panel.append(previewPanel);
    root.replaceChildren(panel);
}

function createStaffArchiveApi() {
    async function request(path, options = {}) {
        let response;
        try {
            response = await fetch(path, { credentials: 'same-origin', ...options });
        } catch {
            throw Object.assign(new Error('Staff request failed.'), { status: 0 });
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error('Staff request failed.'), {
            status: response.status, code: payload?.error?.code
        });
        return payload;
    }
    return {
        queryApplications(query) {
            return request('/api/staff/applications/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query)
            });
        },
        readApplicationDetail(applicationId, signal) {
            return request(`/api/staff/applications/${encodeURIComponent(applicationId)}`, { signal });
        },
        createPreviewCapability(applicationId, code) {
            return request(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'preview'), { method: 'POST' });
        },
        createArchiveManifest(applicationId, signal) {
            return request(`/api/staff/applications/${encodeURIComponent(applicationId)}/documents/archive-manifest`, {
                method: 'POST', signal
            });
        },
        readArchiveFile(applicationId, file, signal) {
            const route = APPLICATION_DOCUMENT_ROUTE(applicationId, file.code, 'archive-file');
            const query = new URLSearchParams({ revision: String(file.expected_revision_number), identity: file.object_identity });
            return fetch(`${route}?${query}`, { credentials: 'same-origin', signal });
        }
    };
}

/**
 * Initializes the authenticated, read-only staff archive workspace.
 * @param {HTMLElement} root Manager mount element inside the archive workspace.
 * @param {{queryApplications: (query: object) => Promise<object>, readApplicationDetail: (id: string) => Promise<object>, createPreviewCapability?: (id: string, code: string) => Promise<object>}|null} [api] Optional API adapter for tests.
 * @returns {void} Registers the workspace view handler.
 */
export function initializeStaffArchiveManager(root, api = createStaffArchiveApi()) {
    const document = root.ownerDocument;
    const state = {
        view: 'queue', loading: false, error: false, errorStatus: null, detail: null,
        preview: null, result: null, archiveApplicationId: null, archiveNotice: null,
        query: { q: '', status: 'terminal', page: 1, page_size: 25 }
    };
    let queryRequestId = 0;
    let detailRequestId = 0;
    let archiveRequestId = 0;
    let archiveController = null;
    let previewTimer = null;
    let previewRequestId = 0;
    let previewTriggerCode = null;

    const clearPreviewTimer = () => {
        if (previewTimer !== null) document.defaultView.clearTimeout(previewTimer);
        previewTimer = null;
    };

    const render = () => {
        if (state.view === 'detail') {
            renderDetail(root, state, {
                onBack: returnToQueue,
                onPreview: openPreview,
                onClose: closePreview,
                onRetry: () => openPreview(state.preview?.document),
                onDownloadArchive: downloadArchive
            });
        } else {
            renderQueue(root, state, {
                onSearch: submitSearch, onRetry: loadQueue, onPageChange: changePage,
                onOpenDetail: openDetail, onDownloadArchive: downloadArchive
            });
        }
    };

    function discardPreview() {
        previewRequestId += 1;
        clearPreviewTimer();
        state.preview = null;
        previewTriggerCode = null;
    }

    function cancelArchive(showNotice = false) {
        if (!archiveController) return;
        archiveRequestId += 1;
        archiveController.abort();
        archiveController = null;
        state.archiveApplicationId = null;
        state.archiveNotice = showNotice ? 'ZIP indirme iptal edildi; eksik arşiv sunulmadı.' : null;
    }

    async function readArchiveManifest(applicationId, signal) {
        const detail = state.detail?.application.id === applicationId
            ? state.detail
            : await api.readApplicationDetail(applicationId, signal);
        if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
        const blockedDocument = detail.documents.find((item) => item.revision_number
            && ['pending', 'unsafe', 'failed'].includes(item.scan_status));
        if (blockedDocument) {
            const code = `DOCUMENT_SCAN_${blockedDocument.scan_status.toUpperCase()}`;
            throw Object.assign(new Error(readDocumentAccessMessage(blockedDocument)), { code });
        }
        return api.createArchiveManifest(applicationId, signal);
    }

    function readArchiveFailureMessage(error) {
        if (error?.name === 'AbortError') return 'ZIP indirme iptal edildi; eksik arşiv sunulmadı.';
        if (error?.code === 'DOCUMENT_SCAN_PENDING') return 'Belge güvenlik kontrolü bekleniyor.';
        if (error?.code === 'DOCUMENT_SCAN_UNSAFE') return 'Belge güvenli bulunmadı ve erişime kapatıldı.';
        if (error?.code === 'DOCUMENT_SCAN_FAILED') return 'Belge güvenlik kontrolü tamamlanamadı.';
        if (error instanceof Error && /Belge|ZIP/i.test(error.message)) return error.message;
        return 'ZIP hazırlanamadı. Belgeleri tek tek indirebilirsiniz.';
    }

    async function downloadArchive(applicationId) {
        if (state.archiveApplicationId === applicationId) {
            cancelArchive(true);
            render();
            return;
        }
        if (archiveController) return;
        const requestId = ++archiveRequestId;
        const controller = new AbortController();
        archiveController = controller;
        state.archiveApplicationId = applicationId;
        state.archiveNotice = null;
        render();
        try {
            await downloadApplicationArchive({
                applicationId, window: document.defaultView, signal: controller.signal,
                getManifest: (signal) => readArchiveManifest(applicationId, signal),
                fetchFile: (id, file, signal) => api.readArchiveFile(id, file, signal)
            });
            if (requestId === archiveRequestId) state.archiveNotice = 'ZIP indirme tamamlandı.';
        } catch (error) {
            if (requestId !== archiveRequestId) return;
            state.archiveNotice = readArchiveFailureMessage(error);
        } finally {
            if (requestId === archiveRequestId) {
                archiveController = null;
                state.archiveApplicationId = null;
                render();
            }
        }
    }

    function closePreview() {
        const documentCode = previewTriggerCode;
        discardPreview();
        render();
        [...root.querySelectorAll('[data-action="preview-document"]')]
            .find((button) => button.dataset.documentCode === documentCode)?.focus();
    }

    function closePreviewOnWorkspaceExit() {
        discardPreview();
        state.view = 'queue';
        state.detail = null;
        state.archiveNotice = null;
        state.loading = false;
        state.error = false;
        render();
    }

    function leaveWorkspace() {
        queryRequestId += 1;
        detailRequestId += 1;
        cancelArchive();
        closePreviewOnWorkspaceExit();
    }

    async function openPreview(documentItem) {
        if (!documentItem || documentItem.access_available !== true) return;
        clearPreviewTimer();
        const requestId = ++previewRequestId;
        previewTriggerCode = documentItem.code;
        state.preview = { status: 'loading', document: documentItem, capability: null, requestId };
        render();
        root.querySelector('[data-action="close-document-preview"]')?.focus();
        try {
            const capability = validatePreviewCapability(await api.createPreviewCapability(
                state.detail.application.id, documentItem.code
            ));
            if (state.preview?.requestId !== requestId) return;
            const expiresIn = Date.parse(capability.expires_at) - Date.now();
            if (expiresIn <= 0) {
                state.preview = { status: 'expired', document: documentItem, capability: null, requestId };
            } else {
                state.preview = { status: 'ready', document: documentItem, capability, requestId };
                previewTimer = document.defaultView.setTimeout(() => {
                    if (state.preview?.requestId !== requestId) return;
                    state.preview = { status: 'expired', document: documentItem, capability: null, requestId };
                    previewTimer = null;
                    render();
                    root.querySelector('[data-action="retry-document-preview"]')?.focus();
                }, expiresIn);
            }
            render();
            const focusTarget = state.preview.status === 'expired'
                ? '[data-action="retry-document-preview"]'
                : '[data-action="close-document-preview"]';
            root.querySelector(focusTarget)?.focus();
            return;
        } catch {
            if (state.preview?.requestId !== requestId) return;
            state.preview = { status: 'error', document: documentItem, capability: null, requestId };
        }
        render();
        root.querySelector('[data-action="retry-document-preview"]')?.focus();
    }

    async function loadQueue() {
        const requestId = ++queryRequestId;
        state.loading = true;
        state.error = false;
        state.errorStatus = null;
        render();
        try {
            const result = await api.queryApplications({ ...state.query });
            if (requestId !== queryRequestId) return;
            state.result = result;
        } catch (error) {
            if (requestId !== queryRequestId) return;
            state.error = true;
            state.errorStatus = error?.status ?? null;
        } finally {
            if (requestId === queryRequestId) {
                state.loading = false;
                render();
            }
        }
    }

    async function submitSearch({ q, status }) {
        cancelArchive();
        detailRequestId += 1;
        discardPreview();
        state.query = { ...state.query, q, status, page: 1 };
        await loadQueue();
    }

    async function changePage(page) {
        cancelArchive();
        detailRequestId += 1;
        discardPreview();
        state.query = { ...state.query, page };
        await loadQueue();
    }

    async function openDetail(applicationId) {
        cancelArchive();
        queryRequestId += 1;
        const requestId = ++detailRequestId;
        discardPreview();
        state.archiveNotice = null;
        state.view = 'detail';
        state.loading = true;
        state.error = false;
        state.detail = null;
        render();
        try {
            const detail = await api.readApplicationDetail(applicationId);
            if (requestId !== detailRequestId || state.view !== 'detail') return;
            state.detail = detail;
        } catch (error) {
            if (requestId !== detailRequestId || state.view !== 'detail') return;
            state.error = true;
            state.errorStatus = error?.status ?? null;
        }
        if (requestId !== detailRequestId || state.view !== 'detail') return;
        state.loading = false;
        render();
    }

    function returnToQueue() {
        detailRequestId += 1;
        cancelArchive();
        discardPreview();
        state.view = 'queue';
        state.detail = null;
        state.archiveNotice = null;
        state.error = false;
        state.loading = false;
        render();
    }

    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName !== 'archive') {
            leaveWorkspace();
            return;
        }
        detailRequestId += 1;
        cancelArchive();
        discardPreview();
        state.view = 'queue';
        void loadQueue();
    });
    document.getElementById('btn-workspace-home')?.addEventListener('click', leaveWorkspace);
    document.getElementById('btn-go-home-global')?.addEventListener('click', leaveWorkspace);
    render();
}
