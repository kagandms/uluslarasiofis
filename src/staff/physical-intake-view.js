import { PHYSICAL_STATUS_LABELS, PHYSICAL_PDF_EDIT_STATUSES } from '../config/physical-statuses.js';
import { renderPhysicalReceiptDialog, closePhysicalReceiptDialog } from './physical-receipt-dialog.js';
import { renderPhysicalReceiptDraft, renderPhysicalReceiptControls } from './physical-receipt-view.js';
import { createApplicationQueueTable, formatQueueDate } from './application-queue-table.js';
import { buildPhysicalPdfUrl } from './physical-intake-client.js';
import { bindPhysicalUppercaseInput } from './physical-uppercase-input.js';

const STATUS_LABELS = PHYSICAL_STATUS_LABELS;
const FILTERS = [['all', 'Tüm durumlar'], ['under_review', 'İncelemede'], ['approved', 'Onaylandı'], ['sent_to_migration', 'Göçe Gönderildi'], ['migration_approved', 'Göç Onayladı'], ['completed', 'Tamamlandı'], ['rejected', 'Reddedildi'], ['deleted', 'Silinen']];


function text(document, tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
}

function button(document, label, run) {
    const node = text(document, 'button', label);
    node.type = 'button';
    node.className = 'btn btn-outline';
    node.addEventListener('click', run);
    return node;
}

function select(document, options) {
    const node = document.createElement('select');
    node.className = 'glass-input';
    options.forEach(([value, label]) => {
        const option = text(document, 'option', label);
        option.value = value;
        node.append(option);
    });
    return node;
}

function filterField(document, label, input, className) {
    const field = document.createElement('div');
    field.className = className;
    field.append(label, input);
    return field;
}

function formatDeliveryDate(document, item) {
    const cell = document.createElement('span');
    const date = String(item.application_date || item.submitted_at || '').slice(0, 10);
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateLabel = match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
    const dateText = text(document, 'span', dateLabel);
    dateText.className = 'physical-delivery-date';
    cell.append(dateText);
    const instant = new Date(item.submitted_at || '');
    if (Number.isFinite(instant.valueOf())) {
        const timeText = text(document, 'small', new Intl.DateTimeFormat('tr-TR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul'
        }).format(instant));
        timeText.className = 'physical-delivery-time';
        cell.append(document.createElement('br'), timeText);
    }
    return cell;
}

function createFilters(document, state, handlers) {
    const form = document.createElement('form');
    form.className = 'staff-applications-filters';
    const search = document.createElement('input');
    search.className = 'glass-input';
    search.value = state.query.q;
    search.placeholder = 'Öğrenci no, ad, soyad veya pasaport no';
    search.maxLength = 120;
    search.id = 'staff-physical-search';
    const searchLabel = text(document, 'label', 'Başvuru ara');
    searchLabel.htmlFor = search.id;
    const status = select(document, FILTERS);
    status.value = state.query.status;
    status.id = 'staff-physical-status';
    const statusLabel = text(document, 'label', 'Durum');
    statusLabel.htmlFor = status.id;
    const startDate = document.createElement('input');
    startDate.type = 'date';
    startDate.className = 'glass-input';
    startDate.value = state.query.from_date || '';
    startDate.id = 'staff-physical-from-date';
    const startDateLabel = text(document, 'label', 'Başlangıç tarihi');
    startDateLabel.htmlFor = startDate.id;
    const endDate = document.createElement('input');
    endDate.type = 'date';
    endDate.className = 'glass-input';
    endDate.value = state.query.to_date || '';
    endDate.id = 'staff-physical-to-date';
    const endDateLabel = text(document, 'label', 'Bitiş tarihi');
    endDateLabel.htmlFor = endDate.id;
    const submit = button(document, 'Filtrele', () => {});
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    form.addEventListener('submit', event => { event.preventDefault(); handlers.search({ q: search.value, status: status.value,
        from_date: startDate.value, to_date: endDate.value }); });
    form.append(filterField(document, searchLabel, search, 'physical-filter-search'),
        filterField(document, statusLabel, status, 'physical-filter-status'),
        filterField(document, startDateLabel, startDate, 'physical-filter-start-date'),
        filterField(document, endDateLabel, endDate, 'physical-filter-end-date'), submit);
    return form;
}

function createPagination(document, pagination, handlers) {
    const row = document.createElement('div');
    row.className = 'staff-applications-pagination';
    const previous = button(document, 'Önceki', () => handlers.page(pagination.page - 1));
    const next = button(document, 'Sonraki', () => handlers.page(pagination.page + 1));
    previous.disabled = pagination.page <= 1;
    next.disabled = pagination.page >= pagination.total_pages;
    row.append(previous, text(document, 'span', `${pagination.page} / ${Math.max(1, pagination.total_pages)} · ${pagination.total} kayıt`), next);
    return row;
}

function renderQueue(document, panel, options) {
    const { state, handlers } = options;
    panel.append(button(document, 'Fiziksel Dosya Gir', handlers.newReceipt), createFilters(document, state, handlers));
    if (state.receiptDelivery) {
        const links = document.createElement('div'); links.className = 'physical-pdf-actions';
        for (const [label, url] of [['PDF’i Aç', state.receiptDelivery.previewUrl], ['PDF İndir', state.receiptDelivery.downloadUrl]]) {
            const link = text(document, 'a', label); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.className = 'btn btn-outline'; links.append(link);
        }
        panel.append(links);
    }
    if (!state.result?.items.length) { panel.append(text(document, 'p', 'Görüntülenecek fiziksel teslim bulunamadı.')); return; }
    panel.append(createApplicationQueueTable(document, state.result.items, { statusLabel: status => STATUS_LABELS[status] || status,
        headers: ['Sıra','Takip No','Ad Soyad','Teslim Tarihi','Ofis Durumu','PDF','A4',''],
        rowNumber: (_item, index) => String((state.result.pagination.page - 1) * (state.result.pagination.page_size || state.query.page_size || 25) + index + 1),
        values: item => [item.tracking_reference || '—', `${item.first_name} ${item.last_name}`, formatDeliveryDate(document, item),
            item.processing_closed_at ? 'Ofis işlemi kapalı' : STATUS_LABELS[item.status], item.current_pdf_id ? 'PDF var' : 'PDF yok',
            item.receipt_metadata_version && item.receipt_metadata_version !== item.metadata_version ? 'A4 güncel değil' : `${item.receipt_state === 'ready' ? 'Hazır' : item.receipt_state || 'Hazırlanmadı'}${item.receipt_print_status ? ` · ${item.receipt_print_status}` : ''}`],
        actions: item => [{ label: 'Detay', action: 'open-detail', run: () => handlers.open(item.id) },
            { label: 'İndir', action: 'download-physical-pdf', isDisabled: !item.current_pdf_id || Boolean(item.deleted_at),
                ariaLabel: 'Güncel PDF’i indir',
                run: () => window.open(buildPhysicalPdfUrl(item.id, item.current_pdf_id, 'download'), '_blank', 'noopener') },
            { label: item.deleted_at ? 'Geri Yükle' : 'Sil', action: item.deleted_at ? 'restore' : 'delete',
                run: () => handlers.mutate(item, item.deleted_at ? 'restore' : 'delete') }]
    }), createPagination(document, state.result.pagination, handlers));
}

function createField(document, form, options) {
    const label = text(document, 'label', options.label);
    const input = document.createElement('input');
    input.className = 'glass-input';
    input.name = options.name;
    input.id = `physical-${options.name}`;
    input.value = options.draft[options.name] || '';
    input.maxLength = options.name.includes('name') ? 120 : 64;
    input.required = options.name !== 'student_number';
    label.htmlFor = input.id;
    bindPhysicalUppercaseInput(input, value => { options.draft[options.name] = value; });
    form.append(label, input);
    return input;
}

function createDraftPreview(document, state) {
    const section = document.createElement('section');
    const preview = text(document, 'a', 'Oluşturulan PDF’i Aç ve Kontrol Et');
    preview.className = 'btn';
    preview.href = state.previewUrl;
    preview.target = '_blank';
    preview.rel = 'noopener';
    section.append(preview, text(document, 'p', 'Ad, soyad ve pasaport numarasını başvuru formuyla karşılaştırın.'));
    return section;
}

function renderCreate(document, panel, options) {
    const { state, handlers } = options;
    if (state.isMetadataFirst) { renderPhysicalReceiptDraft(panel, state, handlers); return; }
    panel.append(button(document, 'Listeye Dön', handlers.back), text(document, 'h3', 'Öğrenci Bilgileri'));
    panel.append(createDraftPreview(document, state));
    const form = document.createElement('form');
    form.className = 'physical-intake-form';
    [['first_name', 'Ad'], ['last_name', 'Soyad'], ['passport_number', 'Pasaport No']].forEach(([name, label]) => createField(document, form, { name, label, draft: state.draft }));
    const type = select(document, [['initial', 'İlk başvuru'], ['renewal', 'Uzatma'], ['transition', 'Geçiş başvurusu']]);
    type.id = 'physical-application-type';
    type.value = state.draft.application_type;
    const label = text(document, 'label', 'Başvuru Türü');
    label.htmlFor = type.id;
    type.addEventListener('change', () => { state.draft.application_type = type.value; });
    const submit = button(document, 'Kaydet', () => {});
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    form.addEventListener('submit', event => { event.preventDefault(); handlers.create(); });
    form.append(label, type, submit);
    panel.append(form);
}

function createFileRow(document, intake, file, handlers) {
    const row = document.createElement('li');
    row.append(text(document, 'strong', 'Güncel PDF'),
        text(document, 'p', `${formatQueueDate(file.uploaded_at)} · ${(file.byte_size / 1048576).toFixed(2)} MB · Kaydedildi`));
    if (intake.deleted_at) return row;
    const actions = document.createElement('div');
    actions.className = 'physical-pdf-actions';
    [['preview', 'PDF’i Aç'], ['download', 'İndir']].forEach(([action, label]) => {
        const link = text(document, 'a', label);
        link.className = 'btn btn-outline';
        link.href = buildPhysicalPdfUrl(intake.id, file.id, action);
        link.target = '_blank';
        link.rel = 'noopener';
        actions.append(link);
    });
    if (PHYSICAL_PDF_EDIT_STATUSES.includes(intake.status) && !intake.processing_closed_at) {
        actions.insertBefore(button(document, 'Sil', handlers.deletePdf), actions.lastChild);
        actions.append(button(document, 'Düzenle', handlers.preparePdf));
    }
    row.append(actions);
    return row;
}

function createPdfControls(document, detail, handlers) {
    const section = document.createElement('section');
    const history = document.createElement('ul');
    history.className = 'physical-pdf-history';
    const currentPdf = detail.files.find(file => file.id === detail.intake.current_pdf_id);
    if (currentPdf) history.append(createFileRow(document, detail.intake, currentPdf, handlers));
    section.append(history);
    if (!currentPdf) {
        section.append(text(document, 'p', 'Bu kayda bağlı güncel PDF yok.'));
        if (!detail.intake.deleted_at && PHYSICAL_PDF_EDIT_STATUSES.includes(detail.intake.status) && !detail.intake.processing_closed_at) {
            section.append(button(document, 'PDF Ekle', handlers.preparePdf));
        }
    }
    return section;
}

function createRejectionForm(document, options) {
    const { state, handlers } = options;
    const form = document.createElement('form');
    form.className = 'physical-intake-form';
    const label = text(document, 'label', 'Ret gerekçesi (zorunlu)');
    const reason = document.createElement('textarea');
    reason.id = 'physical-rejection-reason';
    reason.className = 'glass-input';
    reason.rows = 4;
    reason.required = true;
    reason.minLength = 5;
    reason.maxLength = 2000;
    reason.value = state.rejectionReason || '';
    label.htmlFor = reason.id;
    reason.addEventListener('input', () => { state.rejectionReason = reason.value; });
    const submit = button(document, 'Gerekçeyle Reddet', () => {});
    submit.type = 'submit';
    form.addEventListener('submit', event => { event.preventDefault(); handlers.saveRejection(reason.value); });
    form.append(label, reason, submit, button(document, 'Vazgeç', handlers.cancelReject));
    return form;
}

function renderDetail(document, panel, options) {
    const { state, handlers } = options;
    const detail = state.detail;
    const intake = detail.intake;
    panel.append(button(document, 'Listeye Dön', handlers.back),
        text(document, 'h3', `${intake.first_name} ${intake.last_name}`),
        text(document, 'p', `${intake.application_type === 'transition' ? 'Geçiş başvurusu' : intake.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru'} · ${STATUS_LABELS[intake.status]}${intake.deleted_at ? ' · Silinen kayıt' : ''}`),
        text(document, 'p', `Pasaport: ${intake.passport_number || '—'} · ${intake.linked_application_id ? 'Online başvuruya bağlı' : 'Bağımsız fiziksel teslim'}`));
    const actions = document.createElement('div');
    actions.className = 'physical-status-actions';
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
        const action = button(document, label, () => status === 'rejected' ? handlers.reject(intake) : handlers.mutate(intake, 'status', status));
        action.disabled = !detail.allowed_transitions.includes(status);
        if (status === intake.status) {
            action.setAttribute('aria-current', 'true');
            action.classList.add('is-current');
        }
        if (action.disabled && status !== intake.status) action.title = 'Bu kayıt için durum değişikliği kullanılamıyor.';
        actions.append(action);
    }
    actions.append(button(document, intake.deleted_at ? 'Geri Yükle' : 'Silinenlere Taşı', () => handlers.mutate(intake, intake.deleted_at ? 'restore' : 'delete')));
    panel.append(actions);
    if (!intake.current_pdf_id && !intake.deleted_at) panel.append(text(document, 'p', 'Dijital dosya PDF’i henüz eklenmedi. Fiziksel evrakın işlem durumunu güncelleyebilirsiniz.'));
    if (intake.rejection_reason) panel.append(text(document, 'p', `Ret gerekçesi: ${intake.rejection_reason}`));
    if (state.isRejecting) panel.append(createRejectionForm(document, { state, handlers }));
    renderPhysicalReceiptControls(panel, state, handlers);
    panel.append(createPdfControls(document, detail, handlers));
}

/** Renders a physical workspace without HTML interpolation.
 * @param {HTMLElement} root Mount. @param {object} state Current view. @param {object} handlers User actions.
 * @returns {void} Replaces the workspace contents.
 */
export function renderPhysicalIntakes(root, state, handlers) {
    if (state.view === 'create' && state.isMetadataFirst) { renderPhysicalReceiptDialog(root, state, handlers); return; }
    closePhysicalReceiptDialog(root);
    const document = root.ownerDocument;
    const panel = document.createElement('div');
    panel.className = 'staff-applications-queue physical-intake-panel';
    const notice = text(document, 'p', state.message || 'Fiziksel teslimler yükleniyor…');
    notice.setAttribute('role', 'status');
    notice.id = 'physical-intake-notice';
    panel.append(notice);
    if (state.view === 'create') renderCreate(document, panel, { state, handlers });
    if (state.view === 'detail' && state.detail) renderDetail(document, panel, { state, handlers });
    if (state.view === 'queue') renderQueue(document, panel, { state, handlers });
    root.replaceChildren(panel);
}
