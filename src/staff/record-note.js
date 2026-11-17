import { formatApplicationTimestamp } from '../shared/application-timestamps.js';

const RECORD_NOTES_BASE_URL = '/api/staff/record-notes';
const RECORD_NOTE_MAX_LENGTH = 500;
const RECORD_NOTE_PREVIEW_LENGTH = 80;
const RECORD_NOTE_SCOPE_TEXT = 'Yalnız personel görür';
const RECORD_NOTE_PLACEHOLDER = 'Örn. Eksik evrak var, aranacak';
const SVG_NS = 'http://www.w3.org/2000/svg';

function resolveFetcher(document, fetcher) {
    if (typeof fetcher === 'function') return fetcher;
    const view = document?.defaultView;
    if (typeof view?.fetch === 'function') return view.fetch.bind(view);
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

function normalizeNote(note) {
    if (!note || typeof note.body !== 'string') return null;
    if (!note.body.trim()) return null;
    return {
        ...note,
        body: note.body
    };
}

function buildNotePreview(body) {
    const trimmed = String(body || '').trim();
    return trimmed.length > RECORD_NOTE_PREVIEW_LENGTH
        ? `${trimmed.slice(0, RECORD_NOTE_PREVIEW_LENGTH)}…`
        : trimmed;
}

function formatNoteMeta(note) {
    if (!note) return '';
    const parts = [];
    if (typeof note.updated_by_name === 'string' && note.updated_by_name.trim()) {
        parts.push(note.updated_by_name.trim());
    }
    const formattedDate = note.updated_at ? formatApplicationTimestamp(note.updated_at) : '';
    if (formattedDate) parts.push(formattedDate);
    return parts.join(' · ');
}

/**
 * Kayıt notları için same-origin personel API istemcisi oluşturur.
 * @param {{document?: Document, fetcher?: typeof fetch}} [options] İsteğe bağlı belge veya fetch adaptörü.
 * @returns {{readNotes: (kind: 'online'|'physical', ids: string[]) => Promise<Record<string, object>>, saveNote: (kind: 'online'|'physical', id: string, body: string) => Promise<object>, deleteNote: (kind: 'online'|'physical', id: string) => Promise<object>}} API yardımcıları.
 */
export function createRecordNotesApi(options = {}) {
    const { document, fetcher } = options;

    async function mutate(kind, id, init) {
        const fetchFn = resolveFetcher(document, fetcher);
        if (!fetchFn) {
            throw Object.assign(new Error('Bağlantı kurulamadı. Lütfen tekrar deneyin.'), { status: 0 });
        }
        const url = `${RECORD_NOTES_BASE_URL}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
        let response;
        try {
            response = await fetchFn(url, { credentials: 'same-origin', ...init });
        } catch {
            throw Object.assign(new Error('Not işlemi tamamlanamadı. Bağlantınızı kontrol edin.'), { status: 0 });
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const fallback = response.status === 401
                ? 'Yetkili oturumu sona erdi. Sayfayı yenileyip yeniden giriş yapın.'
                : 'Not işlemi tamamlanamadı.';
            throw Object.assign(new Error(payload?.error?.message || fallback), {
                status: response.status,
                code: payload?.error?.code
            });
        }
        return payload;
    }

    return {
        async readNotes(kind, ids) {
            const uniqueIds = Array.from(new Set(
                (Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)
            )).slice(0, 100);
            if (!kind || uniqueIds.length === 0) return {};

            const fetchFn = resolveFetcher(document, fetcher);
            if (!fetchFn) return {};

            const url = `${RECORD_NOTES_BASE_URL}?kind=${encodeURIComponent(kind)}&ids=${uniqueIds.map(encodeURIComponent).join(',')}`;
            try {
                const response = await fetchFn(url, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' }
                });
                if (!response.ok) {
                    throw Object.assign(new Error('Record notes request failed.'), { name: 'HttpError' });
                }
                const payload = await response.json().catch(() => ({}));
                return payload?.notes && typeof payload.notes === 'object' ? payload.notes : {};
            } catch (error) {
                // Not yükleme hatası liste görünümünü bozmaz; yalnızca hata adı kaydedilir.
                console.error('Record notes load failed.', { errorName: error?.name || 'Error' });
                return {};
            }
        },
        async saveNote(kind, id, body) {
            const payload = await mutate(kind, id, {
                method: 'PUT',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ body })
            });
            return payload?.note || { id, kind, body, updated_at: '', updated_by_name: '' };
        },
        async deleteNote(kind, id) {
            return mutate(kind, id, {
                method: 'DELETE',
                headers: { Accept: 'application/json' }
            });
        }
    };
}

function createNoteSvg(document) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('class', 'staff-record-note-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const bodyPath = document.createElementNS(SVG_NS, 'path');
    bodyPath.setAttribute('d', 'M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z');

    const foldPath = document.createElementNS(SVG_NS, 'path');
    foldPath.setAttribute('class', 'staff-record-note-fold');
    foldPath.setAttribute('d', 'M15 21v-6h6');

    const plusPath = document.createElementNS(SVG_NS, 'path');
    plusPath.setAttribute('class', 'staff-record-note-plus');
    plusPath.setAttribute('d', 'M12 8v6M9 11h6');

    svg.append(bodyPath, foldPath, plusPath);
    return svg;
}

/**
 * Not düğmesinin görsel ve erişilebilirlik durumunu günceller.
 * @param {HTMLButtonElement} button Not düğmesi.
 * @param {object|null} note Güncel not kaydı veya null.
 * @param {string} [studentName] Öğrenci adı.
 * @returns {void}
 */
export function applyRecordNoteButtonState(button, note, studentName = '') {
    const activeNote = normalizeNote(note);
    const hasNote = Boolean(activeNote);
    button.classList.toggle('has-note', hasNote);
    button.dataset.hasNote = hasNote ? 'true' : 'false';

    const label = button.querySelector('.staff-record-note-label');
    if (label) {
        label.textContent = hasNote ? 'Notu düzenle' : 'Not ekle';
    }

    if (hasNote) {
        const preview = buildNotePreview(activeNote.body);
        button.title = `${preview} (${RECORD_NOTE_SCOPE_TEXT})`;
        button.setAttribute(
            'aria-label',
            studentName
                ? `${studentName} için not (${RECORD_NOTE_SCOPE_TEXT}): ${preview}`
                : `Not (${RECORD_NOTE_SCOPE_TEXT}): ${preview}`
        );
        return;
    }

    button.title = `Not ekle (${RECORD_NOTE_SCOPE_TEXT})`;
    button.setAttribute(
        'aria-label',
        studentName
            ? `${studentName} için not ekle (${RECORD_NOTE_SCOPE_TEXT})`
            : `Not ekle (${RECORD_NOTE_SCOPE_TEXT})`
    );
}

/**
 * Personel notu görüntüleme, kaydetme ve silme iletişim kutusunu açar.
 * @param {Document} document Sahip belge.
 * @param {{kind: 'online'|'physical', id: string, studentName?: string, note?: object|null, triggerButton?: HTMLElement|null, api?: ReturnType<typeof createRecordNotesApi>, onUpdated?: (note: object|null) => void}} options İletişim kutusu seçenekleri.
 * @returns {HTMLDialogElement} Açılan iletişim kutusu öğesi.
 */
export function openRecordNoteDialog(document, options) {
    const { kind, id, studentName = '', note = null, triggerButton = null, api = createRecordNotesApi({ document }), onUpdated } = options;
    const currentNote = normalizeNote(note);

    document.querySelectorAll('.staff-record-note-dialog').forEach((existing) => {
        if (existing.open && typeof existing.close === 'function') existing.close();
        existing.remove();
    });

    const dialog = document.createElement('dialog');
    dialog.className = 'staff-record-note-dialog';
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'staff-record-note-title');

    const form = document.createElement('form');
    form.className = 'staff-record-note-form';
    form.method = 'dialog';
    form.noValidate = true;

    const header = document.createElement('div');
    header.className = 'staff-record-note-header';
    const title = document.createElement('h2');
    title.id = 'staff-record-note-title';
    title.textContent = 'Not';
    const scope = document.createElement('span');
    scope.className = 'staff-record-note-scope';
    scope.textContent = RECORD_NOTE_SCOPE_TEXT;
    header.append(title, scope);

    const student = document.createElement('p');
    student.className = 'staff-record-note-student';
    student.textContent = studentName || 'Öğrenci kaydı';

    const metaText = formatNoteMeta(currentNote);
    let meta = null;
    if (metaText) {
        meta = document.createElement('p');
        meta.className = 'staff-record-note-meta';
        meta.textContent = metaText;
    }

    const label = document.createElement('label');
    label.className = 'sr-only';
    label.htmlFor = 'staff-record-note-textarea';
    label.textContent = 'Personel notu';

    const textarea = document.createElement('textarea');
    textarea.id = 'staff-record-note-textarea';
    textarea.className = 'glass-input staff-record-note-textarea';
    textarea.name = 'body';
    textarea.rows = 5;
    textarea.maxLength = RECORD_NOTE_MAX_LENGTH;
    textarea.placeholder = RECORD_NOTE_PLACEHOLDER;
    textarea.value = currentNote?.body || '';

    const countRow = document.createElement('div');
    countRow.className = 'staff-record-note-counts';
    const hint = document.createElement('span');
    hint.className = 'staff-record-note-hint';
    hint.textContent = `En fazla ${RECORD_NOTE_MAX_LENGTH} karakter · ${RECORD_NOTE_SCOPE_TEXT}`;
    const counter = document.createElement('span');
    counter.className = 'staff-record-note-counter';
    counter.dataset.noteCounter = 'true';
    counter.setAttribute('aria-live', 'polite');

    const updateCounter = () => {
        const length = textarea.value.length;
        counter.textContent = `${length}/${RECORD_NOTE_MAX_LENGTH}`;
        counter.classList.toggle('is-over-limit', length > RECORD_NOTE_MAX_LENGTH);
    };
    updateCounter();
    countRow.append(hint, counter);

    const errorBox = document.createElement('p');
    errorBox.className = 'staff-record-note-error';
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;

    const showError = (message) => {
        errorBox.textContent = message;
        errorBox.hidden = !message;
    };

    const actions = document.createElement('div');
    actions.className = 'staff-record-note-actions';

    let deleteButton = null;
    if (currentNote) {
        deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn btn-danger staff-record-note-delete';
        deleteButton.dataset.action = 'delete-record-note';
        deleteButton.textContent = 'Notu Sil';
        actions.append(deleteButton);
    }

    const actionRight = document.createElement('div');
    actionRight.className = 'staff-record-note-actions-right';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn-outline';
    closeButton.dataset.action = 'close-record-note';
    closeButton.textContent = 'Kapat';

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.className = 'btn btn-primary';
    saveButton.dataset.action = 'save-record-note';
    saveButton.textContent = 'Kaydet';

    actionRight.append(closeButton, saveButton);
    actions.append(actionRight);

    form.append(header, student);
    if (meta) form.append(meta);
    form.append(label, textarea, countRow, errorBox, actions);
    dialog.append(form);

    let isPending = false;
    let isClosed = false;

    const setPending = (pending, mode = '') => {
        isPending = pending;
        textarea.disabled = pending;
        saveButton.disabled = pending;
        closeButton.disabled = pending;
        if (deleteButton) deleteButton.disabled = pending;
        saveButton.textContent = pending && mode === 'save' ? 'Kaydediliyor…' : 'Kaydet';
        if (deleteButton) {
            deleteButton.textContent = pending && mode === 'delete' ? 'Siliniyor…' : 'Notu Sil';
        }
    };

    const handleDocumentKeydown = (event) => {
        if (event.key !== 'Escape' || isClosed) return;
        event.preventDefault();
        event.stopPropagation();
        if (!isPending) closeDialog();
    };

    function closeDialog() {
        if (isClosed) return;
        isClosed = true;
        document.removeEventListener('keydown', handleDocumentKeydown, true);
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        dialog.removeAttribute('open');
        dialog.remove();
        if (triggerButton?.isConnected) triggerButton.focus();
    }

    textarea.addEventListener('input', () => {
        updateCounter();
        if (!errorBox.hidden) showError('');
    });

    closeButton.addEventListener('click', () => {
        if (!isPending) closeDialog();
    });

    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (!isPending) closeDialog();
    });

    document.addEventListener('keydown', handleDocumentKeydown, true);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isPending || isClosed) return;
        const trimmed = textarea.value.trim();
        if (!trimmed) {
            showError('Not boş olamaz. Kaydetmek için metin yazın.');
            textarea.focus();
            return;
        }
        if (trimmed.length > RECORD_NOTE_MAX_LENGTH) {
            showError(`Not en fazla ${RECORD_NOTE_MAX_LENGTH} karakter olabilir.`);
            textarea.focus();
            return;
        }
        showError('');
        setPending(true, 'save');
        try {
            const saved = await api.saveNote(kind, id, trimmed);
            if (isClosed) return;
            onUpdated?.(saved);
            closeDialog();
        } catch (error) {
            if (isClosed) return;
            setPending(false);
            showError(error?.message || 'Not kaydedilemedi. Lütfen tekrar deneyin.');
        }
    });

    if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
            if (isPending || isClosed) return;
            showError('');
            setPending(true, 'delete');
            try {
                await api.deleteNote(kind, id);
                if (isClosed) return;
                onUpdated?.(null);
                closeDialog();
            } catch (error) {
                if (isClosed) return;
                setPending(false);
                showError(error?.message || 'Not silinemedi. Lütfen tekrar deneyin.');
            }
        });
    }

    (document.body || document.documentElement).append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    textarea.focus();
    return dialog;
}

/**
 * Satır içi not düğmesi ve güncelleme denetleyicisi üretir.
 * @param {Document} document Sahip belge.
 * @param {{kind: 'online'|'physical', id: string, studentName?: string, note?: object|null, api?: ReturnType<typeof createRecordNotesApi>, onChange?: (note: object|null, id: string) => void}} options Düğme seçenekleri.
 * @returns {{button: HTMLButtonElement, setNote: (note: object|null) => void}} Düğme ve durum güncelleyici.
 */
export function createRecordNoteButton(document, options) {
    const {
        kind,
        id,
        studentName = '',
        note = null,
        api = createRecordNotesApi({ document }),
        onChange = null
    } = options;
    let currentNote = normalizeNote(note);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'staff-record-note-btn';
    button.dataset.action = 'record-note';
    button.dataset.noteKind = kind;
    button.dataset.noteId = id || '';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'staff-record-note-label';

    const dot = document.createElement('span');
    dot.className = 'staff-record-note-dot';
    dot.setAttribute('aria-hidden', 'true');
    button.append(createNoteSvg(document), labelSpan, dot);

    const setNote = (nextNote) => {
        currentNote = normalizeNote(nextNote);
        applyRecordNoteButtonState(button, currentNote, studentName);
    };

    setNote(currentNote);

    button.addEventListener('click', () => {
        if (!id) return;
        openRecordNoteDialog(document, {
            kind,
            id,
            studentName,
            note: currentNote,
            triggerButton: button,
            api,
            onUpdated: (updatedNote) => {
                setNote(updatedNote);
                onChange?.(currentNote, id);
            }
        });
    });

    return { button, setNote };
}

/**
 * Görünür liste satırları için notları tek bir GET isteğiyle yükleyip düğmeleri günceller.
 * @param {Document} document Sahip belge.
 * @param {'online'|'physical'} kind Kayıt türü.
 * @param {Array<{id: string, setNote: (note: object|null) => void}>} entries Satır düğmesi kayıtları.
 * @param {ReturnType<typeof createRecordNotesApi>} [api] İsteğe bağlı API istemcisi.
 * @returns {Promise<Record<string, object>>} Yüklenen not eşlemesi (hata durumunda boş nesne).
 */
export async function loadTableRecordNotes(document, kind, entries, api = createRecordNotesApi({ document })) {
    const validEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.id);
    if (!kind || validEntries.length === 0) return {};

    const notesById = await api.readNotes(kind, validEntries.map((entry) => entry.id));
    validEntries.forEach(({ id, setNote }) => {
        setNote(Object.hasOwn(notesById, id) ? notesById[id] : null);
    });
    return notesById;
}
