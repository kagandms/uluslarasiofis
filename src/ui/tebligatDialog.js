import { formatEIkametNumber, toIstanbulIsoDate } from '../shared/tebligatPage.js';
import { requestExtensionAction } from '../staff/extension-request.js';

const E_IKAMET_NUMBER_PATTERN = /^20\d{2}-\d{2}-\d{7}$/u;
const E_IKAMET_FORMAT_ERROR = 'E-İKAMET başvuru numarasını 2026-00-0000000 biçiminde girin.';
const YOKSIS_DIGITS_PATTERN = /^\d{1,12}$/u;

function caretIndexForDigitCount(formatted, digitCount) {
    if (digitCount <= 0) return 0;
    let seen = 0;
    for (let index = 0; index < formatted.length; index += 1) {
        if (formatted[index] >= '0' && formatted[index] <= '9') {
            seen += 1;
            if (seen === digitCount) return index + 1;
        }
    }
    return formatted.length;
}

function isValidIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeBirthDateInput(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (isValidIsoDate(text)) return text;
    const trMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(text);
    if (trMatch) {
        const iso = `${trMatch[3]}-${trMatch[2]}-${trMatch[1]}`;
        return isValidIsoDate(iso) ? iso : '';
    }
    return '';
}

function appendField(document, form, options) {
    const group = document.createElement('div');
    Object.assign(group.style, { display: 'grid', gap: '.35rem' });
    const label = document.createElement('label');
    label.htmlFor = options.id;
    label.textContent = options.label;
    Object.assign(label.style, { fontWeight: '600', fontSize: '.9rem' });

    const input = document.createElement('input');
    input.id = options.id;
    input.name = options.name;
    input.type = options.type || 'text';
    input.className = 'glass-input';
    input.required = options.required !== false;
    input.autocomplete = 'off';
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.inputMode) {
        input.inputMode = options.inputMode;
        input.setAttribute('inputmode', options.inputMode);
    }
    if (options.dir) input.dir = options.dir;
    if (options.value) input.value = options.value;
    Object.assign(input.style, { boxSizing: 'border-box', width: '100%', minHeight: '42px', padding: '8px 12px' });

    group.append(label, input);
    form.append(group);
    return input;
}

/** Opens the Tebliğ / Tebligat print dialog with optional E-İKAMET auto-fill. */
export function openTebligatDialog(document, record = {}, opener = null, options = {}) {
    if (!document?.body) return null;
    document.querySelectorAll('dialog.tebligat-dialog').forEach((existing) => {
        if (existing.open && typeof existing.close === 'function') existing.close();
        existing.remove();
    });

    const firstName = String(record.firstName ?? record.first_name ?? '').trim();
    const lastName = String(record.lastName ?? record.last_name ?? '').trim();
    const passportNumber = String(record.passportNumber ?? record.passport_number ?? '').trim();
    const initialBirthDate = normalizeBirthDateInput(record.birthDate ?? record.date_of_birth ?? '');
    const initialMigrationGoDate = toIstanbulIsoDate(record.migrationGoDate ?? record.migration_go_date ?? record.updatedAt ?? record.updated_at ?? '');
    const readEIkametNo = typeof options?.readEIkametNo === 'function' ? options.readEIkametNo : null;
    const returnFocusTo = opener || document.activeElement;

    const dialog = document.createElement('dialog');
    dialog.className = 'tebligat-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'tebligat-dialog-title');
    Object.assign(dialog.style, {
        boxSizing: 'border-box',
        width: 'min(480px, calc(100vw - 32px))',
        maxHeight: 'calc(100dvh - 48px)',
        margin: 'auto',
        padding: '24px',
        border: '1px solid var(--card-border, #e0e4e8)',
        borderRadius: '14px',
        background: 'var(--card-bg, #ffffff)',
        color: 'var(--text-primary, #1e293b)',
        boxShadow: '0 16px 48px rgb(0 0 0 / 24%)',
        overflowY: 'auto'
    });

    const form = document.createElement('form');
    form.method = 'dialog';
    form.noValidate = true;
    Object.assign(form.style, { display: 'grid', gap: '.9rem' });

    const title = document.createElement('h3');
    title.id = 'tebligat-dialog-title';
    title.textContent = 'Tebliğ / Tebligat Yazdır';
    Object.assign(title.style, { margin: '0', fontSize: '1.15rem' });

    const studentInfo = document.createElement('p');
    const studentNameText = [firstName, lastName].filter(Boolean).join(' ') || '—';
    studentInfo.textContent = `Öğrenci: ${studentNameText} · Pasaport: ${passportNumber || '—'}`;
    Object.assign(studentInfo.style, { margin: '0', fontSize: '.88rem', color: 'var(--text-secondary, #5c6c7c)' });

    form.append(title, studentInfo);

    const eIkametGroup = document.createElement('div');
    Object.assign(eIkametGroup.style, { display: 'grid', gap: '.35rem' });
    const eIkametLabel = document.createElement('label');
    eIkametLabel.htmlFor = 'tebligat-eikamet-no';
    eIkametLabel.textContent = 'E-İKAMET başvuru no';
    Object.assign(eIkametLabel.style, { fontWeight: '600', fontSize: '.9rem' });

    const eIkametRow = document.createElement('div');
    Object.assign(eIkametRow.style, { display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' });

    const eIkametInput = document.createElement('input');
    eIkametInput.id = 'tebligat-eikamet-no';
    eIkametInput.name = 'e_ikamet_no';
    eIkametInput.type = 'text';
    eIkametInput.className = 'glass-input';
    eIkametInput.required = true;
    eIkametInput.autocomplete = 'off';
    eIkametInput.inputMode = 'numeric';
    eIkametInput.setAttribute('inputmode', 'numeric');
    eIkametInput.maxLength = 15;
    eIkametInput.placeholder = '2026-00-0000000';
    eIkametInput.dir = 'ltr';
    Object.assign(eIkametInput.style, {
        boxSizing: 'border-box',
        flex: '1 1 200px',
        minWidth: '0',
        minHeight: '42px',
        padding: '8px 12px'
    });
    eIkametInput.addEventListener('input', () => {
        const rawValue = eIkametInput.value;
        const selectionStart = eIkametInput.selectionStart;
        const formatted = formatEIkametNumber(rawValue);
        if (formatted === rawValue) return;

        const digitsBeforeCaret = typeof selectionStart === 'number'
            ? rawValue.slice(0, selectionStart).replace(/\D+/gu, '').length
            : null;
        eIkametInput.value = formatted;
        if (digitsBeforeCaret !== null && typeof eIkametInput.setSelectionRange === 'function') {
            const nextCaret = caretIndexForDigitCount(formatted, digitsBeforeCaret);
            eIkametInput.setSelectionRange(nextCaret, nextCaret);
        }
    });

    const lookupButton = document.createElement('button');
    lookupButton.type = 'button';
    lookupButton.className = 'btn btn-outline';
    lookupButton.dataset.action = 'lookup-yoksis';
    lookupButton.textContent = "YÖKSİS'ten oku";
    Object.assign(lookupButton.style, { flexShrink: '0', whiteSpace: 'nowrap', minHeight: '42px' });

    eIkametRow.append(eIkametInput, lookupButton);
    eIkametGroup.append(eIkametLabel, eIkametRow);
    form.append(eIkametGroup);

    let eIkametStatus = null;
    if (readEIkametNo) {
        eIkametStatus = document.createElement('p');
        eIkametStatus.id = 'tebligat-eikamet-status';
        eIkametStatus.className = 'tebligat-eikamet-status';
        eIkametStatus.setAttribute('role', 'status');
        eIkametStatus.setAttribute('aria-live', 'polite');
        eIkametStatus.textContent = 'Belgeden okunuyor…';
        Object.assign(eIkametStatus.style, { margin: '0', fontSize: '.8rem', color: 'var(--text-secondary, #5c6c7c)' });
        eIkametInput.setAttribute('aria-describedby', eIkametStatus.id);
        eIkametGroup.append(eIkametStatus);
    }

    const yoksisStatus = document.createElement('p');
    yoksisStatus.id = 'tebligat-yoksis-status';
    yoksisStatus.className = 'tebligat-yoksis-status';
    yoksisStatus.setAttribute('role', 'status');
    yoksisStatus.setAttribute('aria-live', 'polite');
    yoksisStatus.hidden = true;
    Object.assign(yoksisStatus.style, { margin: '0', fontSize: '.8rem', color: 'var(--text-secondary, #5c6c7c)' });
    eIkametGroup.append(yoksisStatus);

    const basvuruInput = appendField(document, form, {
        id: 'tebligat-basvuru-kayit-no',
        name: 'basvuru_kayit_no',
        label: 'YÖKSİS Başvuru Kayıt No',
        maxLength: 12,
        inputMode: 'numeric',
        dir: 'ltr'
    });
    const islemInput = appendField(document, form, {
        id: 'tebligat-islem-kayit-no',
        name: 'islem_kayit_no',
        label: 'YÖKSİS İşlem Kayıt No',
        required: false,
        maxLength: 12,
        inputMode: 'numeric',
        dir: 'ltr'
    });
    const migrationDateInput = appendField(document, form, {
        id: 'tebligat-migration-date',
        name: 'migration_go_date',
        label: 'Göç İdaresine gidiş tarihi',
        type: 'date',
        value: initialMigrationGoDate
    });
    const birthDateInput = appendField(document, form, {
        id: 'tebligat-birth-date',
        name: 'birth_date',
        label: 'Doğum tarihi',
        type: 'date',
        value: initialBirthDate
    });

    const errorMessage = document.createElement('p');
    errorMessage.className = 'tebligat-dialog-error';
    errorMessage.setAttribute('role', 'alert');
    errorMessage.setAttribute('aria-live', 'polite');
    errorMessage.hidden = true;
    Object.assign(errorMessage.style, {
        margin: '0',
        padding: '8px 10px',
        borderRadius: '8px',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        color: '#991b1b',
        fontSize: '.875rem'
    });
    form.append(errorMessage);

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '.65rem', marginTop: '.25rem' });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-outline';
    cancelButton.dataset.action = 'cancel-tebligat';
    cancelButton.textContent = 'Vazgeç';

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'btn btn-primary';
    submitButton.dataset.action = 'submit-tebligat';
    submitButton.textContent = 'PDF oluştur';

    actions.append(cancelButton, submitButton);
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);

    let closed = false;
    let isSubmitting = false;
    let isLookupPending = false;
    const readController = readEIkametNo ? new AbortController() : null;

    const showError = (message, focusTarget = null) => {
        errorMessage.textContent = message;
        errorMessage.hidden = false;
        focusTarget?.focus?.();
    };

    const closeDialog = () => {
        if (closed) return;
        closed = true;
        readController?.abort();
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.remove();
        if (returnFocusTo && returnFocusTo.isConnected && typeof returnFocusTo.focus === 'function') {
            returnFocusTo.focus();
        }
    };

    dialog.addEventListener('close', () => {
        closed = true;
        readController?.abort();
    });

    cancelButton.addEventListener('click', () => {
        if (!isSubmitting) closeDialog();
    });
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (!isSubmitting) closeDialog();
    });
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !isSubmitting) {
            event.preventDefault();
            closeDialog();
        }
    });

    lookupButton.addEventListener('click', async () => {
        if (closed || isSubmitting || isLookupPending) return;
        errorMessage.hidden = true;
        errorMessage.textContent = '';

        const applicationNumber = eIkametInput.value.trim();
        if (!E_IKAMET_NUMBER_PATTERN.test(applicationNumber)) {
            showError(E_IKAMET_FORMAT_ERROR, eIkametInput);
            return;
        }

        isLookupPending = true;
        lookupButton.disabled = true;
        yoksisStatus.textContent = "YÖKSİS'te aranıyor…";
        yoksisStatus.hidden = false;

        try {
            const response = await requestExtensionAction(
                document.defaultView,
                'LOOKUP_GOCNET_RECORD',
                { applicationNumber },
                90_000
            );
            if (closed || !dialog.isConnected) return;

            if (response?.state === 'found') {
                const basvuru = response.basvuruKayitNo != null ? String(response.basvuruKayitNo).trim() : '';
                const islem = response.islemKayitNo != null ? String(response.islemKayitNo).trim() : '';
                if (!YOKSIS_DIGITS_PATTERN.test(basvuru)) {
                    yoksisStatus.textContent = "YÖKSİS'ten okunamadı. YÖKSİS sekmesinin açık ve girişli olduğunu kontrol edin; numaraları elle yazabilirsiniz.";
                    return;
                }
                basvuruInput.value = basvuru;
                if (YOKSIS_DIGITS_PATTERN.test(islem)) {
                    islemInput.value = islem;
                    yoksisStatus.textContent = "YÖKSİS'ten okundu. Lütfen kontrol edin.";
                } else {
                    islemInput.value = '';
                    yoksisStatus.textContent = "Başvuru Kayıt No okundu; YÖKSİS'te işlem henüz başlatılmamış.";
                }
            } else if (response?.state === 'no_match') {
                yoksisStatus.textContent = "YÖKSİS'te bu numarayla başvuru bulunamadı.";
            } else {
                yoksisStatus.textContent = "YÖKSİS'ten okunamadı. YÖKSİS sekmesinin açık ve girişli olduğunu kontrol edin; numaraları elle yazabilirsiniz.";
            }
        } catch {
            if (closed || !dialog.isConnected) return;
            yoksisStatus.textContent = "YÖKSİS'ten okunamadı. YÖKSİS sekmesinin açık ve girişli olduğunu kontrol edin; numaraları elle yazabilirsiniz.";
        } finally {
            isLookupPending = false;
            if (!closed && dialog.isConnected && !isSubmitting) {
                lookupButton.disabled = false;
            }
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) return;
        errorMessage.hidden = true;
        errorMessage.textContent = '';

        const eIkametNo = eIkametInput.value.trim();
        if (!eIkametNo) {
            showError('E-İKAMET başvuru numarasını girin.', eIkametInput);
            return;
        }
        if (!E_IKAMET_NUMBER_PATTERN.test(eIkametNo)) {
            showError(E_IKAMET_FORMAT_ERROR, eIkametInput);
            return;
        }

        const basvuruKayitNo = basvuruInput.value.trim();
        if (!YOKSIS_DIGITS_PATTERN.test(basvuruKayitNo)) {
            showError('YÖKSİS Başvuru Kayıt No bilgisini girin (yalnızca rakam).', basvuruInput);
            return;
        }

        const islemKayitNo = islemInput.value.trim();
        if (islemKayitNo && !YOKSIS_DIGITS_PATTERN.test(islemKayitNo)) {
            showError('YÖKSİS İşlem Kayıt No yalnızca rakam içerebilir.', islemInput);
            return;
        }

        const migrationGoDate = migrationDateInput.value.trim();
        if (!isValidIsoDate(migrationGoDate)) {
            showError('Göç İdaresine gidiş tarihini girin.', migrationDateInput);
            return;
        }

        const birthDate = birthDateInput.value.trim();
        if (!isValidIsoDate(birthDate)) {
            showError('Doğum tarihini girin.', birthDateInput);
            return;
        }

        isSubmitting = true;
        submitButton.disabled = true;
        cancelButton.disabled = true;
        lookupButton.disabled = true;
        submitButton.textContent = 'PDF hazırlanıyor…';
        try {
            const { downloadTebligatPdf } = await import('../services/tebligatPdf.js');
            await downloadTebligatPdf({
                firstName,
                lastName,
                passportNumber,
                birthDate,
                eIkametNo,
                basvuruKayitNo,
                islemKayitNo,
                migrationGoDate
            }, document);
            isSubmitting = false;
            closeDialog();
        } catch (error) {
            isSubmitting = false;
            submitButton.disabled = false;
            cancelButton.disabled = false;
            lookupButton.disabled = isLookupPending;
            submitButton.textContent = 'PDF oluştur';
            showError(error?.message || 'Tebliğ / Tebligat PDF’i oluşturulamadı. Lütfen tekrar deneyin.');
        }
    });

    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    eIkametInput.focus();

    if (readEIkametNo && readController) {
        let readPromise;
        try {
            readPromise = Promise.resolve(readEIkametNo(readController.signal));
        } catch (error) {
            readPromise = Promise.reject(error);
        }
        readPromise.then(
            (value) => {
                if (closed || readController.signal.aborted || !dialog.isConnected) return;
                const extracted = typeof value === 'string' ? formatEIkametNumber(value) : '';
                if (extracted) {
                    if (!eIkametInput.value.trim()) {
                        eIkametInput.value = extracted;
                    }
                    eIkametStatus.textContent = 'Belgeden okundu. Lütfen kontrol edin.';
                } else {
                    eIkametStatus.textContent = 'Otomatik okunamadı; numarayı elle yazın.';
                }
            },
            (error) => {
                if (closed || readController.signal.aborted || error?.name === 'AbortError' || !dialog.isConnected) return;
                eIkametStatus.textContent = 'Otomatik okunamadı; numarayı elle yazın.';
            }
        );
    }

    return dialog;
}
