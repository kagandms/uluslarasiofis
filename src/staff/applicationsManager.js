import { PUBLIC_MESSAGES } from '../public/i18n/messages.js';
import { downloadApplicationArchive, createArchiveFilename } from './applicationArchive.js';
import { readDocumentAccessMessage } from './documentAccessMessages.js';
import { createNotificationApi, createNotificationManager } from './notificationManager.js';

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
const SAFE_PREVIEW_MEDIA_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const STATUS_ACTION_LABELS = Object.freeze({
    under_review: 'İncelemeye Başla',
    approved_for_processing: 'İşlem İçin Onayla',
    sent_to_migration: 'Göç İdaresine Aktarıldı Olarak İşaretle',
    migration_approved: 'Göç İdaresi Onayladı',
    completed: 'Başvuruyu Tamamla'
});
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

function createQueueTable(document, items, onOpenDetail, onDownloadArchive, onArchiveApplication, archiveApplicationId) {
    const table = document.createElement('table');
    table.className = 'staff-applications-table';
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
        action.addEventListener('click', () => onOpenDetail(item.id));
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn-outline';
        download.dataset.action = 'download-application-archive';
        download.textContent = archiveApplicationId === item.id ? 'İptal' : 'İndir';
        download.setAttribute('aria-label', archiveApplicationId === item.id ? 'ZIP indirmeyi iptal et' : 'Virüs taramasından geçmiş belgeleri ZIP olarak indir');
        download.addEventListener('click', () => onDownloadArchive(item.id));
        const archive = document.createElement('button');
        archive.type = 'button';
        archive.className = 'btn btn-outline';
        archive.dataset.action = 'archive-application';
        archive.textContent = 'Sil';
        archive.setAttribute('aria-label', `${item.student_number} başvurusunu Silinen arşivine taşı`);
        archive.addEventListener('click', () => onArchiveApplication(item.id));
        actionCell.append(action, download, archive);
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

let staffToastTimer = null;

function createStaffToast(document, message, onDismiss) {
    if (staffToastTimer) {
        clearTimeout(staffToastTimer);
        staffToastTimer = null;
    }
    const overlay = document.createElement('div');
    overlay.className = 'staff-toast-modal-overlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'staff-toast-modal-card';

    const text = document.createElement('p');
    text.className = 'staff-toast-modal-text';
    text.textContent = message;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'staff-toast-modal-confirm';
    button.textContent = 'Tamam';
    button.addEventListener('click', () => {
        if (staffToastTimer) {
            clearTimeout(staffToastTimer);
            staffToastTimer = null;
        }
        onDismiss();
    });

    card.append(text, button);
    overlay.append(card);

    staffToastTimer = setTimeout(() => {
        staffToastTimer = null;
        onDismiss();
    }, 5000);
    if (typeof staffToastTimer?.unref === 'function') {
        staffToastTimer.unref();
    }

    return overlay;
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
        panel.append(createQueueTable(document, state.result.items, handlers.onOpenDetail,
            handlers.onDownloadArchive, handlers.onArchiveApplication, state.archiveApplicationId));
        if (state.archiveMessage) panel.append(createText(document, 'p', 'staff-applications-state', state.archiveMessage));
        if (state.archiveError) panel.append(createText(document, 'p', 'staff-applications-state', state.archiveError));
        if (state.archiveMessage || state.archiveError) {
            panel.append(createStaffToast(document, state.archiveError || state.archiveMessage, () => {
                handlers.onDismissToast?.();
            }));
        }
        panel.append(createPagination(document, state.result.pagination, handlers.onPageChange));
    }
    root.replaceChildren(panel);
}

function appendDetail(document, list, label, value) {
    list.append(createText(document, 'dt', '', label), createText(document, 'dd', '', displayValue(value)));
}

function createApplicationSummary(document, application) {
    const section = document.createElement('section');
    const details = document.createElement('dl');
    const fields = [
        ['Başvuru Referansı', application.reference_number || '-'],
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
    section.className = 'staff-application-summary';
    section.append(createText(document, 'h4', '', 'Başvuru ve başvuran bilgileri'));
    details.className = 'staff-application-details-grid';
    fields.forEach(([label, value]) => appendDetail(document, details, label, value));
    section.append(details);
    return section;
}

function createResubmissionButton(document, item, options) {
    const request = document.createElement('button');
    request.type = 'button';
    request.className = 'btn btn-outline';
    request.dataset.action = 'request-document-resubmission';
    request.disabled = options.isPending;
    request.textContent = 'Yeniden Yükleme İste';
    request.addEventListener('click', () => options.handlers.onOpenResubmission(item));
    return request;
}

function createDocumentReadActions(document, item, options) {
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'btn btn-outline';
    preview.dataset.action = 'preview-document';
    preview.dataset.documentCode = item.code;
    preview.disabled = options.isPending;
    preview.textContent = 'Önizle';
    preview.addEventListener('click', () => options.handlers.onPreview(item));
    return [preview];
}

function createApplicationArchiveAction(document, applicationId, state, onDownloadArchive) {
    const button = document.createElement('button');
    const isActive = state.archiveApplicationId === applicationId;
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.dataset.action = 'download-application-archive';
    button.textContent = isActive ? 'ZIP’i iptal et' : 'Belgeleri ZIP indir';
    button.setAttribute('aria-label', isActive ? 'ZIP indirmeyi iptal et' : 'Virüs taramasından geçmiş belgeleri ZIP olarak indir');
    button.addEventListener('click', () => onDownloadArchive(applicationId));
    return button;
}

function createDocumentAccessActions(document, item, options) {
    const actions = document.createElement('div');
    actions.className = 'staff-application-document-actions';
    if (item.access_available === true && item.can_approve === true) {
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'btn btn-primary';
        approve.dataset.action = 'approve-document';
        approve.disabled = options.isPending;
        approve.textContent = options.isPending ? 'İşleniyor…' : 'Onayla';
        approve.addEventListener('click', () => options.handlers.onApprove(item));
        actions.append(approve);
    }
    if (item.access_available === true && item.can_unapprove === true) {
        const unapprove = document.createElement('button');
        unapprove.type = 'button';
        unapprove.className = 'btn btn-outline';
        unapprove.dataset.action = 'unapprove-document';
        unapprove.disabled = options.isPending;
        unapprove.textContent = 'Onayı kaldır';
        unapprove.addEventListener('click', () => options.handlers.onUnapprove(item));
        actions.append(unapprove);
    }
    if (item.can_request_resubmission === true) actions.append(createResubmissionButton(document, item, options));
    if (item.access_available === true) actions.append(...createDocumentReadActions(document, item, options));
    return actions;
}

function createUnavailableDocumentState(document, item) {
    return createText(document, 'p', 'staff-application-document-unavailable', readDocumentAccessMessage(item));
}

function createResubmissionForm(document, item, state, handlers) {
    if (state.resubmissionDocument?.code !== item.code) return null;
    const form = document.createElement('form');
    const label = createText(document, 'label', '', `Yeniden yükleme nedeni: ${PUBLIC_MESSAGES.tr[item.label_key] || item.code}`);
    const reason = document.createElement('textarea');
    const cancel = document.createElement('button');
    const submit = document.createElement('button');
    reason.name = 'reason';
    reason.required = true;
    reason.minLength = 3;
    reason.maxLength = 1000;
    reason.rows = 4;
    reason.dataset.action = 'resubmission-reason';
    label.htmlFor = 'staff-resubmission-reason';
    reason.id = label.htmlFor;
    reason.addEventListener('input', () => reason.setCustomValidity(''));
    cancel.type = 'button';
    cancel.className = 'btn btn-outline';
    cancel.dataset.action = 'cancel-document-resubmission';
    cancel.disabled = Boolean(state.actionPending);
    cancel.textContent = 'Vazgeç';
    cancel.addEventListener('click', handlers.onCancelResubmission);
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.dataset.action = 'submit-document-resubmission';
    submit.disabled = Boolean(state.actionPending);
    submit.textContent = state.actionPending === `resubmission:${item.code}` ? 'Gönderiliyor…' : 'Nedeni Gönder';
    form.className = 'staff-resubmission-form';
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if ([...reason.value.trim().replace(/[\s\p{C}]/gu, '')].length < 3) {
            reason.setCustomValidity('En az 3 karakter girin.');
            reason.reportValidity();
            return;
        }
        reason.setCustomValidity('');
        handlers.onRequestResubmission(item, reason.value);
    });
    form.append(label, reason, createText(document, 'p', 'staff-application-state', 'En fazla 1000 karakter.'), cancel, submit);
    if (state.actionError) {
        const error = createText(document, 'p', 'staff-application-state', state.actionError);
        error.setAttribute('role', 'alert');
        form.append(error);
    }
    return form;
}

function createDocumentSection(document, applicationId, documents, state, handlers) {
    const section = document.createElement('section');
    const list = document.createElement('div');
    section.className = 'staff-application-documents';
    section.append(createText(document, 'h4', '', 'Güncel belge durumları'));
    if (state.actionNotice && !state.scanQueuedCode) {
        const notice = createText(document, 'p', 'staff-application-state staff-application-notice', state.actionNotice);
        notice.setAttribute('role', 'status');
        section.append(notice);
    }
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
        if (state.actionNotice && state.scanQueuedCode === item.code) {
            const notice = createText(document, 'p', 'staff-application-state staff-application-notice', state.actionNotice);
            notice.setAttribute('role', 'status');
            card.append(notice);
        }
        details.className = 'staff-application-details-grid';
        fields.forEach(([fieldLabel, value]) => appendDetail(document, details, fieldLabel, value));
        card.append(details, item.access_available === true
            ? createDocumentAccessActions(document, item, { applicationId, handlers, isPending: Boolean(state.actionPending) })
            : createUnavailableDocumentState(document, item));
        if (item.scan_status === 'pending' && item.file_id) {
            const scanAction = document.createElement('div');
            const scanButton = document.createElement('button');
            scanAction.className = 'staff-document-scan-actions';
            scanButton.type = 'button';
            scanButton.className = 'btn btn-primary staff-document-scan-button';
            scanButton.dataset.action = 'scan-document';
            scanButton.textContent = state.scanQueuedCode === item.code ? 'Taramayı yeniden sırala' : 'Tara';
            scanButton.disabled = Boolean(state.actionPending);
            scanButton.addEventListener('click', () => handlers.onScanDocument(item));
            scanAction.append(scanButton);
            card.append(scanAction);
        }
        if (item.access_available !== true && item.can_request_resubmission === true) {
            card.append(createDocumentAccessActions(document, item, { applicationId, handlers, isPending: Boolean(state.actionPending) }));
        }
        if (item.student_message) {
            card.append(createText(document, 'p', 'staff-application-student-message', `Öğrenciye iletilen neden: ${item.student_message}`));
        }
        const resubmissionForm = createResubmissionForm(document, item, state, handlers);
        if (resubmissionForm) card.append(resubmissionForm);
        list.append(card);
    });
    section.append(list);
    return section;
}

function createApplicationWorkflow(document, application, detail, state, handlers) {
    const section = document.createElement('section');
    section.className = 'staff-application-workflow';
    if (application.status === 'resubmission_required') {
        section.append(createText(document, 'p', 'staff-applications-state', 'Öğrenciden belge bekleniyor.'));
    }
    for (const targetStatus of detail.allowed_status_transitions || []) {
        const label = STATUS_ACTION_LABELS[targetStatus];
        if (!label) continue;
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'btn btn-primary';
        action.dataset.action = 'application-status-transition';
        action.dataset.targetStatus = targetStatus;
        action.disabled = Boolean(state.actionPending);
        action.textContent = state.actionPending === `status:${targetStatus}` ? 'İşleniyor…' : label;
        action.addEventListener('click', () => handlers.onTransition(targetStatus));
        section.append(action);
    }
    if (state.actionError && !state.resubmissionDocument) {
        const error = createText(document, 'p', 'staff-application-state', state.actionError);
        error.setAttribute('role', 'alert');
        section.append(error);
    }
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

async function readCleanArchiveManifest(applicationId, signal, state, api) {
    const detail = state.detail?.application.id === applicationId
        ? state.detail : await api.readApplicationDetail(applicationId, signal);
    if (signal.aborted) throw new DOMException('Canceled', 'AbortError');
    const blockedDocument = detail.documents.find((item) => item.revision_number
        && ['pending', 'unsafe', 'failed'].includes(item.scan_status));
    if (blockedDocument) throw Object.assign(new Error(readDocumentAccessMessage(blockedDocument)), {
        code: `DOCUMENT_SCAN_${blockedDocument.scan_status.toUpperCase()}`
    });
    return api.createArchiveManifest(applicationId, signal);
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
        panel.append(createText(document, 'p', 'staff-applications-state', 'Önizleme hazırlanıyor…'));
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
        panel.append(createText(document, 'p', 'staff-applications-state', message), retry);
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
    panel.className = 'staff-application-detail-view';
    back.type = 'button';
    back.className = 'btn btn-primary';
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
            createApplicationArchiveAction(document, state.detail.application.id, state, handlers.onDownloadArchive),
            createApplicationSummary(document, state.detail.application),
            createApplicationWorkflow(document, state.detail.application, state.detail, state, handlers),
            createDocumentSection(document, state.detail.application.id, state.detail.documents, state, handlers),
            handlers.createNotificationPanel()
        );
    }
    if (state.archiveMessage) panel.append(createText(document, 'p', 'staff-applications-state', state.archiveMessage));
    if (state.archiveError) panel.append(createText(document, 'p', 'staff-applications-state', state.archiveError));
    if (state.archiveMessage || state.archiveError) {
        panel.append(createStaffToast(document, state.archiveError || state.archiveMessage, () => {
            handlers.onDismissToast?.();
        }));
    }
    const previewPanel = createPreviewPanel(document, state.preview, handlers);
    if (previewPanel) panel.append(previewPanel);
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
        if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'Staff request failed.'), {
            status: response.status, code: payload?.error?.code
        });
        return payload;
    }
    const postJson = (path, body) => request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return {
        queryApplications(query) {
            return request('/api/staff/applications/query', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query)
            });
        },
        readApplicationDetail(applicationId) {
            return request(`/api/staff/applications/${encodeURIComponent(applicationId)}`);
        },
        createPreviewCapability(applicationId, code) {
            return request(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'preview'), { method: 'POST' });
        },
        createArchiveManifest(applicationId, signal) {
            return request(`/api/staff/applications/${encodeURIComponent(applicationId)}/documents/archive-manifest`, { method: 'POST', signal });
        },
        archiveApplication(applicationId) {
            return postJson(`/api/staff/applications/${encodeURIComponent(applicationId)}/archive`, {});
        },
        readArchiveFile(applicationId, file, signal) {
            const query = new URLSearchParams({
                revision: String(file.expected_revision_number), identity: file.object_identity
            });
            return fetch(`/api/staff/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(file.code)}/archive-file?${query}`, {
                credentials: 'same-origin', signal
            });
        },
        approveDocument(applicationId, code, revisionNumber) {
            return postJson(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'approve'), {
                expected_revision_number: revisionNumber
            });
        },
        unapproveDocument(applicationId, code, revisionNumber) {
            return postJson(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'unapprove'), {
                expected_revision_number: revisionNumber
            });
        },
        prioritizeDocumentScan(applicationId, code) {
            return postJson(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'scan'), {});
        },
        readScannerStatus() {
            return request('/api/staff/scanner/status');
        },
        requestDocumentResubmission(applicationId, code, revisionNumber, reason) {
            return postJson(APPLICATION_DOCUMENT_ROUTE(applicationId, code, 'request-resubmission'), {
                expected_revision_number: revisionNumber, reason
            });
        },
        transitionApplication(applicationId, targetStatus, updatedAt) {
            return postJson(`/api/staff/applications/${encodeURIComponent(applicationId)}/status`, {
                target_status: targetStatus, expected_updated_at: updatedAt
            });
        },
        notifications: createNotificationApi()
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
    const notificationManager = createNotificationManager(api.notifications);
    const state = {
        view: 'queue', loading: false, error: false, errorStatus: null, detail: null,
        actionPending: null, actionError: null, actionNotice: null, scanQueuedCode: null, resubmissionDocument: null,
        preview: null, result: null, archiveApplicationId: null, archiveController: null,
        archiveError: null, archiveMessage: null,
        query: { q: '', status: 'all', page: 1, page_size: 25 }
    };
    let previewTimer = null;
    let scanPollTimer = null;
    let scanPollStartedAt = 0;
    let previewRequestId = 0;
    let previewTriggerCode = null;
    const clearPreviewTimer = () => {
        if (previewTimer !== null) document.defaultView.clearTimeout(previewTimer);
        previewTimer = null;
    };
    const clearScanPoll = () => {
        if (scanPollTimer !== null) document.defaultView.clearTimeout(scanPollTimer);
        scanPollTimer = null;
    };
    const render = () => {
        const dismissToast = () => {
            state.archiveMessage = null;
            state.archiveError = null;
            render();
        };
        if (state.view === 'detail') renderDetail(root, state, {
            onBack: returnToQueue,
            onPreview: openPreview,
            onClose: closePreview,
            onRetry: () => openPreview(state.preview?.document),
            onApprove: approveDocument,
            onUnapprove: unapproveDocument,
            onScanDocument: prioritizeDocumentScan,
            onOpenResubmission: openResubmission,
            onCancelResubmission: cancelResubmission,
            onRequestResubmission: requestResubmission,
            onTransition: transitionApplication,
            onDismissToast: dismissToast,
            createNotificationPanel: () => notificationManager.createPanel(document,
                state.detail.application, render)
        });
        else renderQueue(root, state, {
            onSearch: submitSearch, onRetry: loadQueue, onPageChange: changePage, onOpenDetail: openDetail,
            onDownloadArchive: downloadArchive, onArchiveApplication: archiveApplication,
            onDismissToast: dismissToast
        });
        root.dataset.staffView = state.view;
        try {
            const eventType = typeof CustomEvent === 'function' ? CustomEvent : document.defaultView?.CustomEvent;
            if (eventType) {
                document.dispatchEvent(new eventType('staff-applications:view-changed', {
                    detail: { view: state.view }
                }));
            }
        } catch {
            // View change event is best effort for UI layout syncing
        }
    };
    function discardPreview() {
        previewRequestId += 1;
        clearPreviewTimer();
        state.preview = null;
        previewTriggerCode = null;
    }
    async function downloadArchive(applicationId) {
        if (state.archiveController && state.archiveApplicationId === applicationId) {
            state.archiveController.abort();
            return;
        }
        if (!api.createArchiveManifest || !api.readArchiveFile || state.archiveController) return;
        const archiveController = new AbortController();
        state.archiveApplicationId = applicationId;
        state.archiveController = archiveController;
        state.archiveError = null;
        state.archiveMessage = null;
        const applicationObj = state.detail?.application?.id === applicationId
            ? state.detail.application
            : state.items.find((item) => item.id === applicationId);
        const suggestedName = createArchiveFilename({
            firstName: applicationObj?.first_name,
            lastName: applicationObj?.last_name,
            studentNumber: applicationObj?.student_number
        });
        render();
        try {
            await downloadApplicationArchive({
                applicationId, window: document.defaultView,
                signal: archiveController.signal,
                suggestedName,
                getManifest: (signal) => readCleanArchiveManifest(applicationId, signal, state, api),
                fetchFile: (id, file, signal) => api.readArchiveFile(id, file, signal)
            });
            state.archiveMessage = 'ZIP arşivi hazırlandı.';
        } catch (error) {
            state.archiveError = error?.name === 'AbortError'
                ? 'ZIP indirme işlemi iptal edildi; eksik arşiv sunulmadı.'
                : (typeof error?.message === 'string' && /ZIP|Belge/.test(error.message)
                    ? error.message : 'ZIP hazırlanamadı. Belge tarama durumlarını kontrol edip tekrar deneyin.');
        }
        state.archiveApplicationId = null;
        state.archiveController = null;
        render();
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
        render();
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
    async function archiveApplication(applicationId) {
        if (state.actionPending || typeof api.archiveApplication !== 'function') return;
        state.actionPending = `archive:${applicationId}`;
        state.archiveError = null;
        state.archiveMessage = null;
        render();
        try {
            await api.archiveApplication(applicationId);
            state.archiveMessage = 'Başvuru Silinen arşivine taşındı.';
            state.actionPending = null;
            await loadQueue();
        } catch {
            state.archiveError = 'Başvuru arşive taşınamadı. Listeyi yenileyip tekrar deneyin.';
            state.actionPending = null;
            render();
        }
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
        discardPreview();
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
    async function refreshDetail() {
        const applicationId = state.detail?.application.id;
        if (!applicationId) return;
        const scrollY = document.defaultView?.scrollY ?? 0;
        try {
            state.detail = await api.readApplicationDetail(applicationId);
            state.error = false;
        } catch (error) {
            state.actionError = error?.status === 401
                ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
                : 'Güncel başvuru durumu alınamadı. Listeyi yenileyip tekrar deneyin.';
        }
        render();
        if (scrollY > 0) document.defaultView?.scrollTo?.({ top: scrollY, behavior: 'instant' });
    }
    async function refreshQueueSnapshot() {
        try {
            state.result = await api.queryApplications({ ...state.query });
        } catch {
            // The visible detail remains usable; queue reloads when staff returns to it.
        }
    }
    function readActionError(error) {
        if (error?.code === 'DOCUMENT_REVIEW_CONFLICT' || error?.code === 'APPLICATION_STATE_CONFLICT') {
            return 'Başvuru veya belge başka bir işlem nedeniyle değişti. Güncel durumu yeniden yüklendi.';
        }
        if (error?.code === 'APPLICATION_NOT_READY_FOR_APPROVAL') {
            return 'İşlem onayı için tüm zorunlu belgeler onaylanmış olmalıdır.';
        }
        return 'İşlem tamamlanamadı. Güncel durumu kontrol edip tekrar deneyin.';
    }
    async function completeAction(actionKey, operation) {
        const scrollY = document.defaultView?.scrollY ?? 0;
        state.actionPending = actionKey;
        state.actionError = null;
        render();
        try {
            await operation();
            state.scanQueuedCode = null;
            state.actionNotice = actionKey.startsWith('approve:')
                ? 'Belge onaylandı.'
                : actionKey.startsWith('unapprove:')
                    ? 'Belge onayı kaldırıldı; belge yeniden incelenebilir.'
                    : 'İşlem tamamlandı.';
            state.resubmissionDocument = null;
            discardPreview();
            await refreshDetail();
            await refreshQueueSnapshot();
            state.actionPending = null;
            render();
        } catch (error) {
            state.actionError = readActionError(error);
            state.actionPending = null;
            if (error?.status === 409) {
                state.resubmissionDocument = null;
                discardPreview();
                await refreshDetail();
                await refreshQueueSnapshot();
            }
            render();
        }
        if (scrollY > 0) document.defaultView?.scrollTo?.({ top: scrollY, behavior: 'instant' });
    }
    function approveDocument(item) {
        return completeAction(`approve:${item.code}`, () => api.approveDocument(
            state.detail.application.id, item.code, item.revision_number
        ));
    }
    function unapproveDocument(item) {
        return completeAction(`unapprove:${item.code}`, () => api.unapproveDocument(
            state.detail.application.id, item.code, item.revision_number
        ));
    }
    async function prioritizeDocumentScan(item) {
        if (state.actionPending || item.scan_status !== 'pending' || !item.file_id) return;
        state.actionPending = `scan:${item.code}`;
        state.actionNotice = null;
        state.actionError = null;
        render();
        try {
            await api.prioritizeDocumentScan(state.detail.application.id, item.code);
            await refreshDetail();
            state.scanQueuedCode = item.code;
            const scannerStatus = await api.readScannerStatus?.();
            const isRunnerOnline = scannerStatus?.runners?.some((runner) =>
                runner.health === 'ready' && Date.now() - Date.parse(runner.seen_at) < 120_000);
            state.actionNotice = isRunnerOnline
                ? 'Gerçek ClamAV taraması kuyruğa alındı. Sonuç otomatik güncellenecek.'
                : 'Tarama kuyruğa alındı ancak PC’deki ClamAV çalıştırıcısı çevrimdışı. Çalıştırıcı bağlanınca gerçek tarama başlayacak.';
            if (isRunnerOnline) {
                clearScanPoll();
                scanPollStartedAt = Date.now();
                scheduleScanResultPoll(item.code);
            }
        } catch {
            state.actionError = 'Tarama başlatılamadı. PC’deki ClamAV çalıştırıcısının bağlı olduğunu kontrol edin.';
        }
        state.actionPending = null;
        render();
    }
    function scheduleScanResultPoll(documentCode) {
        scanPollTimer = document.defaultView.setTimeout(async () => {
            if (state.view !== 'detail' || !state.detail || Date.now() - scanPollStartedAt > 120_000) {
                clearScanPoll();
                return;
            }
            await refreshDetail();
            const currentDocument = state.detail?.documents.find((item) => item.code === documentCode);
            if (!currentDocument || currentDocument.scan_status !== 'pending') {
                state.actionNotice = currentDocument?.scan_status === 'clean'
                    ? 'ClamAV taraması tamamlandı: temiz.'
                    : `ClamAV taraması tamamlandı: ${readDocumentStateLabel(currentDocument?.scan_status || 'failed')}.`;
                clearScanPoll();
                render();
                return;
            }
            scheduleScanResultPoll(documentCode);
        }, 3000);
    }
    function openResubmission(item) {
        state.resubmissionDocument = item;
        state.actionError = null;
        render();
        root.querySelector('[data-action="resubmission-reason"]')?.focus();
    }
    function cancelResubmission() {
        if (state.actionPending) return;
        state.resubmissionDocument = null;
        state.actionError = null;
        render();
    }
    function requestResubmission(item, reason) {
        return completeAction(`resubmission:${item.code}`, () => api.requestDocumentResubmission(
            state.detail.application.id, item.code, item.revision_number, reason
        ));
    }
    function transitionApplication(targetStatus) {
        return completeAction(`status:${targetStatus}`, () => api.transitionApplication(
            state.detail.application.id, targetStatus, state.detail.application.updated_at
        ));
    }
    function returnToQueue() {
        clearScanPoll();
        discardPreview();
        state.view = 'queue';
        state.error = false;
        state.loading = false;
        render();
    }
    document.addEventListener('workspace:view-changed', (event) => {
        if (event.detail?.viewName !== 'applications') {
            clearScanPoll();
            closePreviewOnWorkspaceExit();
            return;
        }
        discardPreview();
        state.view = 'queue';
        void loadQueue();
    });
    document.getElementById('btn-workspace-home')?.addEventListener('click', closePreviewOnWorkspaceExit);
    document.getElementById('btn-go-home-global')?.addEventListener('click', closePreviewOnWorkspaceExit);
    render();
}
