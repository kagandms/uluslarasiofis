import { PUBLIC_MESSAGES } from '../public/i18n/messages.js';

const STATUS_LABELS = Object.freeze({
    submitted: 'Gönderildi', under_review: 'İncelemede', resubmission_required: 'Yeniden yükleme gerekli',
    approved_for_processing: 'İşleme alınmak üzere onaylandı', sent_to_migration: 'Göç İdaresine gönderildi',
    migration_approved: 'Göç İdaresi onayladı', completed: 'Tamamlandı', cancelled: 'İptal edildi', rejected: 'Reddedildi'
});
const DOCUMENT_STATE_LABELS = Object.freeze({
    pending: 'İnceleme bekliyor', under_review: 'İnceleniyor', approved: 'Onaylandı',
    resubmission_required: 'Yeniden yükleme gerekli', submitted: 'Gönderildi',
    finalized: 'Yüklendi', clean: 'Temiz', unsafe: 'Güvenli değil', failed: 'Başarısız',
    complete: 'Tamamlandı'
});
const STATUS_FILTERS = Object.freeze([
    ['all', 'Tüm durumlar'], ['new', 'Yeni'], ['under_review', 'İncelemede'],
    ['resubmission_required', 'Yeniden yükleme gerekli'], ['approved', 'Onaylandı'],
    ['migration', 'Göç İdaresi'], ['completed', 'Tamamlanan'], ['terminal', 'Terminal']
]);

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
    label.htmlFor = 'staff-application-search';
    search.id = label.htmlFor;
    const statusLabel = createText(document, 'label', '', 'Durum');
    const status = createSelect(document, 'status', state.query.status, STATUS_FILTERS);
    statusLabel.htmlFor = 'staff-application-status';
    status.id = statusLabel.htmlFor;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.disabled = state.loading;
    submit.textContent = 'Filtrele';
    form.className = 'staff-applications-filters';
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        onSubmit({ q: search.value, status: status.value });
    });
    form.append(label, search, statusLabel, status, submit);
    return form;
}

function createQueueTable(document, items, onOpenDetail) {
    const table = document.createElement('table');
    table.className = 'staff-applications-table';
    const headers = ['Öğrenci No', 'Ad Soyad', 'Başvuru Türü', 'Durum', 'Gönderim Tarihi', 'Son Güncelleme', 'Atanan Personel', ''];
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
            formatDate(item.updated_at),
            item.assigned_staff?.display_name || 'Atanmamış'
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
        action.addEventListener('click', () => onOpenDetail(item.id));
        actionCell.append(action);
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
    controls.className = 'staff-applications-pagination';
    previous.type = 'button';
    previous.className = 'btn btn-outline';
    previous.dataset.action = 'previous-page';
    previous.textContent = 'Önceki';
    previous.disabled = pagination.page <= 1;
    previous.addEventListener('click', () => onPageChange(pagination.page - 1));
    const pages = createText(document, 'p', '', `Sayfa ${pagination.page} / ${pagination.total_pages} · ${pagination.total_items} başvuru`);
    next.type = 'button';
    next.className = 'btn btn-outline';
    next.dataset.action = 'next-page';
    next.textContent = 'Sonraki';
    next.disabled = pagination.page >= pagination.total_pages;
    next.addEventListener('click', () => onPageChange(pagination.page + 1));
    controls.append(previous, pages, next);
    return controls;
}

function createQueueError(document, state, onRetry) {
    const panel = document.createElement('section');
    const message = state.errorStatus === 401
        ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
        : 'Başvurular yüklenemedi. Lütfen tekrar deneyin.';
    const retry = document.createElement('button');
    panel.className = 'staff-applications-state';
    retry.type = 'button';
    retry.className = 'btn btn-outline';
    retry.dataset.action = 'retry-queue';
    retry.textContent = 'Tekrar dene';
    retry.addEventListener('click', onRetry);
    panel.append(createText(document, 'p', '', message), retry);
    return panel;
}

function renderQueue(root, state, handlers) {
    const document = root.ownerDocument;
    const panel = document.createElement('div');
    panel.className = 'staff-applications-queue';
    panel.append(createSearchForm(document, state, handlers.onSearch));
    if (state.loading) {
        panel.append(createText(document, 'p', 'staff-applications-state', 'Başvurular yükleniyor…'));
    } else if (state.error) {
        panel.append(createQueueError(document, state, handlers.onRetry));
    } else if (state.result?.items.length === 0) {
        panel.append(createText(document, 'p', 'staff-applications-state', 'Görüntülenecek başvuru bulunamadı.'));
    } else if (state.result) {
        panel.append(createQueueTable(document, state.result.items, handlers.onOpenDetail));
        panel.append(createPagination(document, state.result.pagination, handlers.onPageChange));
    }
    root.replaceChildren(panel);
}

function appendDetail(document, list, label, value) {
    list.append(createText(document, 'dt', '', label), createText(document, 'dd', '', displayValue(value)));
}

function createApplicationSummary(document, application, assignment) {
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
        ['Son güncelleme', formatDate(application.updated_at)],
        ['Atanan personel', assignment?.display_name || 'Atanmamış']
    ];
    section.className = 'staff-application-summary';
    section.append(createText(document, 'h4', '', 'Başvuru ve başvuran bilgileri'));
    details.className = 'staff-application-details-grid';
    fields.forEach(([label, value]) => appendDetail(document, details, label, value));
    section.append(details);
    return section;
}

function createDocumentSection(document, documents) {
    const section = document.createElement('section');
    const list = document.createElement('div');
    section.className = 'staff-application-documents';
    section.append(createText(document, 'h4', '', 'Güncel belge durumları'));
    list.className = 'staff-application-document-list';
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
        card.className = 'staff-application-document-card';
        card.append(createText(document, 'h5', '', label));
        details.className = 'staff-application-details-grid';
        fields.forEach(([fieldLabel, value]) => appendDetail(document, details, fieldLabel, value));
        card.append(details);
        list.append(card);
    });
    section.append(list);
    return section;
}

function renderDetail(root, state, handlers) {
    const document = root.ownerDocument;
    const panel = document.createElement('div');
    const back = document.createElement('button');
    panel.className = 'staff-application-detail-view';
    back.type = 'button';
    back.className = 'btn btn-outline';
    back.dataset.action = 'back-to-queue';
    back.textContent = 'Başvuru listesine dön';
    back.addEventListener('click', handlers.onBack);
    panel.append(back);
    if (state.loading) {
        panel.append(createText(document, 'p', 'staff-applications-state', 'Başvuru ayrıntıları yükleniyor…'));
    } else if (state.error) {
        const message = state.errorStatus === 401
            ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
            : 'Başvuru ayrıntıları yüklenemedi. Lütfen tekrar deneyin.';
        panel.append(createText(document, 'p', 'staff-applications-state', message));
    } else if (state.detail) {
        panel.append(
            createApplicationSummary(document, state.detail.application, state.detail.assignment),
            createDocumentSection(document, state.detail.documents)
        );
    }
    root.replaceChildren(panel);
}

function createStaffApplicationsApi() {
    async function request(path, options = {}) {
        let response;
        try {
            response = await fetch(path, { credentials: 'same-origin', ...options });
        } catch {
            throw Object.assign(new Error('Staff request failed.'), { status: 0 });
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error('Staff request failed.'), { status: response.status });
        return payload;
    }
    return {
        queryApplications(query) {
            return request('/api/staff/applications/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query)
            });
        },
        readApplicationDetail(applicationId) {
            return request(`/api/staff/applications/${encodeURIComponent(applicationId)}`);
        }
    };
}

/**
 * Initializes the authenticated, read-only staff application queue and detail workspace.
 * @param {HTMLElement} root Manager mount element inside the applications workspace.
 * @param {{queryApplications: (query: object) => Promise<object>, readApplicationDetail: (id: string) => Promise<object>}|null} [api] Optional API adapter for tests.
 * @returns {void} Registers the workspace view handler.
 */
export function initializeStaffApplicationsManager(root, api = createStaffApplicationsApi()) {
    const document = root.ownerDocument;
    const state = {
        view: 'queue', loading: false, error: false, errorStatus: null, detail: null,
        result: null, query: { q: '', status: 'all', page: 1, page_size: 25 }
    };
    const render = () => {
        if (state.view === 'detail') renderDetail(root, state, { onBack: returnToQueue });
        else renderQueue(root, state, {
            onSearch: submitSearch, onRetry: loadQueue, onPageChange: changePage, onOpenDetail: openDetail
        });
    };
    async function loadQueue() {
        state.loading = true;
        state.error = false;
        render();
        try {
            state.result = await api.queryApplications({ ...state.query });
        } catch (error) {
            state.error = true;
            state.errorStatus = error?.status ?? null;
        }
        state.loading = false;
        render();
    }
    async function submitSearch({ q, status }) {
        state.query = { ...state.query, q, status, page: 1 };
        await loadQueue();
    }
    async function changePage(page) {
        state.query = { ...state.query, page };
        await loadQueue();
    }
    async function openDetail(applicationId) {
        state.view = 'detail';
        state.loading = true;
        state.error = false;
        state.detail = null;
        render();
        try {
            state.detail = await api.readApplicationDetail(applicationId);
        } catch (error) {
            state.error = true;
            state.errorStatus = error?.status ?? null;
        }
        state.loading = false;
        render();
    }
    function returnToQueue() {
        state.view = 'queue';
        state.error = false;
        state.loading = false;
        render();
    }
    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName !== 'applications') return;
        state.view = 'queue';
        void loadQueue();
    });
    render();
}
