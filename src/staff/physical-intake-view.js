import { createApplicationQueueTable, formatQueueDate } from './application-queue-table.js';
import { buildPhysicalPdfUrl } from './physical-intake-client.js';

const STATUS_LABELS = { under_review: 'İncelemede', approved_for_processing: 'Onaylandı', rejected: 'Reddedildi' };
const FILTERS = [['all', 'Tüm durumlar'], ['under_review', 'İncelemede'], ['approved', 'Onaylandı'], ['rejected', 'Reddedildi'], ['deleted', 'Silinen']];


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
    const submit = button(document, 'Filtrele', () => {});
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    form.addEventListener('submit', event => { event.preventDefault(); handlers.search({ q: search.value, status: status.value }); });
    form.append(searchLabel, search, statusLabel, status, submit);
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
    if (!state.result?.items.length) { panel.append(text(document, 'p', 'Görüntülenecek fiziksel teslim bulunamadı.')); return; }
    panel.append(createApplicationQueueTable(document, state.result.items, { statusLabel: status => STATUS_LABELS[status] || status,
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
    input.addEventListener('input', () => { options.draft[options.name] = input.value; });
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
    section.append(preview, text(document, 'p', 'Ad, soyad ve pasaport numarasını başvuru formuyla karşılaştırın. Öğrenci numarası isteğe bağlıdır.'));
    return section;
}

function renderCreate(document, panel, options) {
    const { state, handlers } = options;
    panel.append(button(document, 'Listeye Dön', handlers.back), text(document, 'h3', 'Öğrenci Bilgileri'));
    panel.append(createDraftPreview(document, state));
    const form = document.createElement('form');
    form.className = 'physical-intake-form';
    createField(document, form, { name: 'student_number', label: 'Öğrenci No (isteğe bağlı)', draft: state.draft });
    [['first_name', 'Ad'], ['last_name', 'Soyad'], ['passport_number', 'Pasaport No']].forEach(([name, label]) => createField(document, form, { name, label, draft: state.draft }));
    const type = select(document, [['initial', 'İlk başvuru'], ['renewal', 'Uzatma']]);
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
        text(document, 'p', `${formatQueueDate(file.uploaded_at)} · ${(file.byte_size / 1048576).toFixed(2)} MB · ${file.scan_status === 'clean' ? 'Güvenlik taraması tamamlandı' : file.scan_status === 'pending' ? 'Güvenlik taraması bekleniyor' : 'Güvenlik kontrolü başarısız'}`));
    if (intake.deleted_at) return row;
    if (file.scan_status !== 'clean') {
        if (intake.status === 'under_review') row.append(button(document, 'Sil', handlers.deletePdf));
        return row;
    }
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
    if (intake.status === 'under_review') {
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
        if (!detail.intake.deleted_at && detail.intake.status === 'under_review') {
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
    panel.append(button(document, 'Listeye Dön', handlers.back), button(document, 'Kaydı Yenile', () => handlers.open(intake.id)),
        text(document, 'h3', `${intake.student_number || 'Öğrenci no belirtilmedi'} — ${intake.first_name} ${intake.last_name}`),
        text(document, 'p', `${intake.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru'} · ${STATUS_LABELS[intake.status]}${intake.deleted_at ? ' · Silinen kayıt' : ''}`),
        text(document, 'p', `Pasaport: ${intake.passport_number || '—'} · ${intake.linked_application_id ? 'Online başvuruya bağlı' : 'Bağımsız fiziksel teslim'}`));
    const actions = document.createElement('div');
    actions.className = 'physical-status-actions';
    detail.allowed_transitions.forEach(status => actions.append(button(document, STATUS_LABELS[status], () => status === 'rejected' ? handlers.reject(intake) : handlers.mutate(intake, 'status', status))));
    actions.append(button(document, intake.deleted_at ? 'Geri Yükle' : 'Silinenlere Taşı', () => handlers.mutate(intake, intake.deleted_at ? 'restore' : 'delete')));
    panel.append(actions);
    if (intake.rejection_reason) panel.append(text(document, 'p', `Ret gerekçesi: ${intake.rejection_reason}`));
    if (state.isRejecting) panel.append(createRejectionForm(document, { state, handlers }));
    panel.append(createPdfControls(document, detail, handlers));
}

/** Renders a physical workspace without HTML interpolation.
 * @param {HTMLElement} root Mount. @param {object} state Current view. @param {object} handlers User actions.
 * @returns {void} Replaces the workspace contents.
 */
export function renderPhysicalIntakes(root, state, handlers) {
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
