import { isPlausibleBirthDate } from '../shared/age.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STUDENT_NUMBER_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const NON_EDITABLE_STATUSES = new Set(['draft', 'completed', 'cancelled', 'rejected']);

export const EDITABLE_FIELD_CONFIGS = Object.freeze({
    student_number: Object.freeze({ label: 'Öğrenci No', inputType: 'text', uppercase: true }),
    first_name: Object.freeze({ label: 'Ad', inputType: 'text' }),
    last_name: Object.freeze({ label: 'Soyad', inputType: 'text' }),
    email: Object.freeze({ label: 'E-posta', inputType: 'email' }),
    phone: Object.freeze({ label: 'Telefon', inputType: 'tel' }),
    passport_number: Object.freeze({ label: 'Pasaport No', inputType: 'text' }),
    nationality: Object.freeze({ label: 'Uyruk', inputType: 'text' }),
    date_of_birth: Object.freeze({ label: 'Doğum tarihi', inputType: 'date' }),
    residence_application_date: Object.freeze({ label: 'e-İkamet başvuru tarihi', inputType: 'date' }),
    transition_foreign_id: Object.freeze({ label: 'Yabancı kimlik no', inputType: 'text' }),
    transition_card_serial: Object.freeze({ label: 'Mevcut kart seri no', inputType: 'text' }),
    transition_card_number: Object.freeze({ label: 'Mevcut kart no', inputType: 'text' })
});

/**
 * Başvuru kaydının satır içi alan düzenlemeye uygun olup olmadığını döner.
 * @param {object|null|undefined} application Başvuru detay kaydı.
 * @returns {boolean} Düzenleme simgesi gösterilebilirse true.
 */
export function isApplicationFieldEditingAllowed(application) {
    if (!application || typeof application !== 'object') return false;
    if (NON_EDITABLE_STATUSES.has(application.status)) return false;
    if (application.deletion_state || application.deleted_at || application.is_deleted) return false;
    return true;
}

/**
 * Alanın mevcut başvuru türü/koşullarına göre görünür ve düzenlenebilir olup olmadığını döner.
 * @param {string} fieldKey API alan adı.
 * @param {object|null|undefined} application Başvuru detay kaydı.
 * @returns {boolean} Alan geçerliyse true.
 */
export function isFieldApplicableToApplication(fieldKey, application) {
    if (!application || !Object.hasOwn(EDITABLE_FIELD_CONFIGS, fieldKey)) return false;
    if (fieldKey === 'residence_application_date') {
        const isMinor = application.is_under_18 === 1 || application.is_under_18 === true;
        return isMinor && isPlausibleBirthDate(application.date_of_birth);
    }
    if (fieldKey.startsWith('transition_')) {
        return application.application_type === 'transition';
    }
    return true;
}

/**
 * Düzenleme inputu için mevcut ham alanı okur.
 * @param {object|null|undefined} application Başvuru kaydı.
 * @param {string} fieldKey API alan adı.
 * @returns {string} Başlangıç input değeri.
 */
export function readInitialFieldValue(application, fieldKey) {
    const raw = application?.[fieldKey];
    if (raw === null || raw === undefined) return '';
    const text = String(raw).trim();
    const config = EDITABLE_FIELD_CONFIGS[fieldKey];
    if (config?.inputType === 'date') {
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
        return match ? match[1] : text;
    }
    return text;
}

/**
 * İstemci tarafı ön doğrulama ve normalizasyonu uygular.
 * @param {string} fieldKey API alan adı.
 * @param {unknown} rawValue Input değeri.
 * @param {object|null|undefined} application Mevcut başvuru kaydı.
 * @returns {{ok: true, changed: boolean, value: string}|{ok: false, error: string, normalizedValue: string}} Doğrulama sonucu.
 */
export function validateAndNormalizeFieldValue(fieldKey, rawValue, application) {
    const trimmed = String(rawValue ?? '').trim();
    const config = EDITABLE_FIELD_CONFIGS[fieldKey];
    const normalized = config?.uppercase ? trimmed.toUpperCase() : trimmed;

    if (!normalized) {
        return {
            ok: false,
            error: 'Bu alan boş bırakılamaz.',
            normalizedValue: ''
        };
    }

    if (fieldKey === 'student_number' && !STUDENT_NUMBER_PATTERN.test(normalized)) {
        return {
            ok: false,
            error: 'Öğrenci numarası yalnızca harf, rakam, - ve _ içerebilir.',
            normalizedValue: normalized
        };
    }

    const original = readInitialFieldValue(application, fieldKey);
    return {
        ok: true,
        changed: normalized !== original,
        value: normalized
    };
}

/**
 * API hatasından kullanıcıya gösterilecek güvenli Türkçe mesajı çıkarır.
 * @param {unknown} error Hata nesnesi.
 * @returns {string} Kullanıcıya gösterilecek mesaj.
 */
export function readFieldEditErrorMessage(error) {
    if (error?.status === 401) {
        return 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.';
    }
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (message && message !== 'Staff request failed.') {
        return message;
    }
    if (error?.code === 'APPLICATION_UPDATE_CONFLICT') {
        return 'Başvuru başka bir işlem tarafından güncellendi. Güncel bilgiler yeniden yüklendi.';
    }
    return 'Değişiklik kaydedilemedi. Lütfen tekrar deneyin.';
}

function createEditPencilSvg(document) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('class', 'staff-detail-edit-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z');
    svg.append(path);
    return svg;
}

/**
 * Düzenlenebilir özet satırını (görüntüleme veya satır içi form) DOM listesine ekler.
 * @param {Document} document Sahip belge.
 * @param {HTMLElement} list Tanım listesi (<dl>) öğesi.
 * @param {{
 *   label: string,
 *   value: unknown,
 *   fieldKey: string,
 *   fieldEdit: {field: string, value: string, pending: boolean, error: string|null}|null,
 *   disabled: boolean,
 *   displayValue: (value: unknown) => string,
 *   onBeginEdit: (fieldKey: string) => void,
 *   onUpdateDraft: (value: string) => void,
 *   onSaveEdit: (fieldKey: string, rawValue: string) => void,
 *   onCancelEdit: (fieldKey: string) => void
 * }} options Satır oluşturma seçenekleri.
 * @returns {void}
 */
export function appendEditableDetailItem(document, list, options) {
    const {
        label,
        value,
        fieldKey,
        fieldEdit = null,
        disabled = false,
        displayValue,
        onBeginEdit,
        onUpdateDraft,
        onSaveEdit,
        onCancelEdit
    } = options;
    const config = EDITABLE_FIELD_CONFIGS[fieldKey];
    const item = document.createElement('div');
    item.className = 'staff-application-detail-item';

    const term = document.createElement('dt');
    term.textContent = label;

    const definition = document.createElement('dd');
    const isEditingThisField = fieldEdit?.field === fieldKey;

    if (isEditingThisField) {
        item.classList.add('is-editing');
        definition.classList.add('is-editing-detail');

        const form = document.createElement('form');
        form.className = 'staff-detail-edit-form';
        form.noValidate = true;

        const controls = document.createElement('div');
        controls.className = 'staff-detail-edit-controls';

        const input = document.createElement('input');
        input.type = config?.inputType || 'text';
        input.className = 'glass-input staff-detail-edit-input';
        input.name = fieldKey;
        input.dataset.action = 'field-edit-input';
        input.dataset.field = fieldKey;
        input.value = fieldEdit.value ?? '';
        input.disabled = Boolean(fieldEdit.pending || disabled);
        input.setAttribute('aria-label', label);

        const actions = document.createElement('div');
        actions.className = 'staff-detail-edit-actions';

        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.className = 'btn btn-primary staff-detail-save-btn';
        saveButton.dataset.action = 'save-application-field';
        saveButton.disabled = Boolean(fieldEdit.pending || disabled);
        saveButton.textContent = fieldEdit.pending ? 'Kaydediliyor…' : 'Kaydet';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'btn btn-outline staff-detail-cancel-btn';
        cancelButton.dataset.action = 'cancel-application-field';
        cancelButton.disabled = Boolean(fieldEdit.pending || disabled);
        cancelButton.textContent = 'İptal';

        input.addEventListener('input', () => {
            if (config?.uppercase) {
                const start = input.selectionStart;
                const end = input.selectionEnd;
                const upper = input.value.toUpperCase();
                if (input.value !== upper) {
                    input.value = upper;
                    if (start !== null && end !== null) {
                        input.setSelectionRange?.(start, end);
                    }
                }
            }
            onUpdateDraft?.(input.value);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || fieldEdit.pending) return;
            event.preventDefault();
            event.stopPropagation();
            onCancelEdit?.(fieldKey);
        });

        cancelButton.addEventListener('click', () => {
            if (fieldEdit.pending) return;
            onCancelEdit?.(fieldKey);
        });

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (fieldEdit.pending || disabled) return;
            onSaveEdit?.(fieldKey, input.value);
        });

        actions.append(saveButton, cancelButton);
        controls.append(input, actions);
        form.append(controls);

        if (fieldEdit.error) {
            const errorId = `staff-field-edit-error-${fieldKey}`;
            const errorElement = document.createElement('p');
            errorElement.id = errorId;
            errorElement.className = 'staff-detail-edit-error';
            errorElement.setAttribute('role', 'alert');
            errorElement.textContent = fieldEdit.error;
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', errorId);
            form.append(errorElement);
        }

        definition.append(form);
    } else {
        definition.classList.add('is-editable-detail');

        const valueSpan = document.createElement('span');
        valueSpan.className = 'staff-detail-value';
        valueSpan.textContent = displayValue(value);

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'staff-detail-edit-btn';
        editButton.dataset.action = 'edit-application-field';
        editButton.dataset.field = fieldKey;
        editButton.disabled = Boolean(disabled || fieldEdit?.pending);
        editButton.title = `${label} alanını düzenle`;
        editButton.setAttribute('aria-label', `${label} alanını düzenle`);
        editButton.append(createEditPencilSvg(document));
        editButton.addEventListener('click', () => {
            if (disabled || fieldEdit?.pending) return;
            onBeginEdit?.(fieldKey);
        });

        definition.append(valueSpan, editButton);
    }

    item.append(term, definition);
    list.append(item);
}

/**
 * Başvuru özet alanı için satır içi düzenleme denetleyicisi oluşturur.
 * @param {{
 *   root: HTMLElement,
 *   state: object,
 *   api: object,
 *   render: () => void,
 *   refreshDetail: () => Promise<void>,
 *   refreshQueueSnapshot: () => Promise<void>
 * }} options Denetleyici bağımlılıkları.
 * @returns {{
 *   beginEdit: (fieldKey: string) => void,
 *   updateDraftValue: (value: string) => void,
 *   cancelEdit: (fieldKey?: string) => void,
 *   saveEdit: (fieldKey: string, rawValue: string) => Promise<void>,
 *   reset: () => void
 * }} Alan düzenleme işleyicileri.
 */
export function createApplicationFieldEditController({
    root,
    state,
    api,
    render,
    refreshDetail,
    refreshQueueSnapshot
}) {
    const document = root.ownerDocument;
    let noticeTimer = null;
    let editGeneration = 0;

    function clearNoticeTimer() {
        if (noticeTimer !== null) {
            document.defaultView?.clearTimeout?.(noticeTimer);
            noticeTimer = null;
        }
    }

    function scheduleNoticeClear() {
        clearNoticeTimer();
        const view = document.defaultView;
        if (!view?.setTimeout) return;
        noticeTimer = view.setTimeout(() => {
            noticeTimer = null;
            state.fieldEditNotice = null;
            const notice = root.querySelector('.staff-field-edit-notice');
            if (notice) notice.remove();
        }, 3500);
        if (typeof noticeTimer?.unref === 'function') {
            noticeTimer.unref();
        }
    }

    function focusFieldInput() {
        root.querySelector('[data-action="field-edit-input"]')?.focus();
    }

    function focusFieldEditButton(fieldKey) {
        const button = [...root.querySelectorAll('[data-action="edit-application-field"]')]
            .find((element) => element.dataset.field === fieldKey);
        button?.focus();
    }

    function reset() {
        editGeneration += 1;
        clearNoticeTimer();
        state.fieldEdit = null;
        state.fieldEditNotice = null;
        state.fieldEditBannerError = null;
    }

    function beginEdit(fieldKey) {
        const application = state.detail?.application;
        if (!isApplicationFieldEditingAllowed(application) || state.actionPending || state.fieldEdit?.pending) return;
        if (!isFieldApplicableToApplication(fieldKey, application)) return;
        clearNoticeTimer();
        state.fieldEditNotice = null;
        state.fieldEditBannerError = null;
        state.fieldEdit = {
            field: fieldKey,
            value: readInitialFieldValue(application, fieldKey),
            pending: false,
            error: null
        };
        render();
        focusFieldInput();
    }

    function updateDraftValue(value) {
        if (!state.fieldEdit || state.fieldEdit.pending) return;
        state.fieldEdit.value = value;
    }

    function cancelEdit(fieldKey = state.fieldEdit?.field) {
        if (state.fieldEdit?.pending) return;
        state.fieldEdit = null;
        render();
        if (fieldKey) focusFieldEditButton(fieldKey);
    }

    async function saveEdit(fieldKey, rawValue) {
        const application = state.detail?.application;
        if (!application || state.actionPending || state.fieldEdit?.pending) return;

        const validation = validateAndNormalizeFieldValue(fieldKey, rawValue, application);
        if (!validation.ok) {
            state.fieldEdit = {
                field: fieldKey,
                value: validation.normalizedValue,
                pending: false,
                error: validation.error
            };
            render();
            focusFieldInput();
            return;
        }

        if (!validation.changed) {
            state.fieldEdit = null;
            render();
            focusFieldEditButton(fieldKey);
            return;
        }

        if (typeof api?.updateApplicationFields !== 'function') {
            state.fieldEdit = {
                field: fieldKey,
                value: validation.value,
                pending: false,
                error: 'Alan güncelleme şu an kullanılamıyor.'
            };
            render();
            focusFieldInput();
            return;
        }

        clearNoticeTimer();
        state.fieldEditNotice = null;
        state.fieldEditBannerError = null;
        state.fieldEdit = {
            field: fieldKey,
            value: validation.value,
            pending: true,
            error: null
        };
        const generation = editGeneration;
        render();

        try {
            const response = await api.updateApplicationFields(
                application.id,
                application.lock_version,
                { [fieldKey]: validation.value }
            );
            if (generation !== editGeneration) return;
            const updatedApplication = response?.application && typeof response.application === 'object'
                ? response.application
                : { ...application, [fieldKey]: validation.value };

            state.detail = {
                ...state.detail,
                application: updatedApplication
            };
            if (Array.isArray(state.result?.items)) {
                state.result = {
                    ...state.result,
                    items: state.result.items.map((item) => (
                        item?.id === updatedApplication.id
                            ? { ...item, ...updatedApplication }
                            : item
                    ))
                };
            }
            state.fieldEdit = null;
            state.fieldEditNotice = 'Kaydedildi';
            scheduleNoticeClear();
            render();
            focusFieldEditButton(fieldKey);
            void refreshQueueSnapshot();
        } catch (error) {
            if (generation !== editGeneration) return;
            const message = readFieldEditErrorMessage(error);
            if (error?.code === 'APPLICATION_UPDATE_CONFLICT') {
                await refreshDetail();
                if (generation !== editGeneration) return;
                const refreshedApplication = state.detail?.application;
                if (isApplicationFieldEditingAllowed(refreshedApplication)
                    && isFieldApplicableToApplication(fieldKey, refreshedApplication)) {
                    state.fieldEdit = {
                        field: fieldKey,
                        value: validation.value,
                        pending: false,
                        error: message
                    };
                    render();
                    focusFieldInput();
                } else {
                    state.fieldEdit = null;
                    state.fieldEditBannerError = message;
                    render();
                }
                return;
            }
            state.fieldEdit = {
                field: fieldKey,
                value: validation.value,
                pending: false,
                error: message
            };
            render();
            focusFieldInput();
        }
    }

    return {
        beginEdit,
        updateDraftValue,
        cancelEdit,
        saveEdit,
        reset
    };
}
