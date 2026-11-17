import { formatApplicationTimestamp } from '../shared/application-timestamps.js';
import { createRecordNoteButton, loadTableRecordNotes } from './record-note.js';

const HEADERS = ['Öğrenci No', 'Ad Soyad', 'Başvuru Türü', 'Durum', 'Gönderim Tarihi', 'Son Güncelleme', ''];

/** Formats a queue timestamp. @param {string} value ISO timestamp. @returns {string} Turkish date or placeholder. */
export function formatQueueDate(value) {
    return formatApplicationTimestamp(value) || '—';
}

function resolveHeaders(options) {
    if (options.headers) return options.headers;
    return options.noteKind ? ['', ...HEADERS] : HEADERS;
}

function createRow(document, item, options, index, noteEntries) {
    const row = document.createElement('tr');
    const headers = resolveHeaders(options);
    const hasNotes = Boolean(options.noteKind);
    const columnOffset = (hasNotes ? 1 : 0) + (options.rowNumber ? 1 : 0);
    if (hasNotes) {
        const noteId = options.noteId ? options.noteId(item) : item.id;
        const studentName = options.noteStudentName
            ? options.noteStudentName(item)
            : [item.first_name, item.last_name].filter(Boolean).join(' ');
        const noteCell = document.createElement('td');
        noteCell.className = 'staff-record-note-cell';
        noteCell.dataset.label = 'Not';
        const { button, setNote } = createRecordNoteButton(document, {
            kind: options.noteKind,
            id: noteId,
            studentName,
            note: options.initialNotes?.get?.(noteId) ?? null,
            api: options.notesApi,
            onChange: options.onNoteChange
        });
        noteCell.append(button);
        row.append(noteCell);
        if (noteId) noteEntries.push({ id: noteId, setNote });
    }
    if (options.rowNumber) {
        const number = document.createElement('td');
        number.textContent = options.rowNumber(item, index);
        number.dataset.label = headers[hasNotes ? 1 : 0];
        row.append(number);
    }
    const values = options.values ? options.values(item) : [item.student_number || '—', [item.first_name, item.last_name].filter(Boolean).join(' ') || '—',
        item.application_type === 'transition' ? 'Geçiş başvurusu' : item.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru', options.statusLabel(item.status),
        formatQueueDate(item.submitted_at), formatQueueDate(item.updated_at)];
    values.forEach((value, valueIndex) => {
        const cell = document.createElement('td');
        if (value?.nodeType) cell.append(value);
        else cell.textContent = value || '—';
        cell.dataset.label = headers[valueIndex + columnOffset];
        row.append(cell);
    });
    const actions = document.createElement('td');
    actions.dataset.label = 'Detay';
    options.actions(item).forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline';
        button.textContent = action.label;
        button.dataset.action = action.action;
        button.disabled = Boolean(action.isDisabled);
        if (action.ariaLabel) button.setAttribute('aria-label', action.ariaLabel);
        button.addEventListener('click', async (event) => {
            if (button.disabled) return;
            button.disabled = true;
            try {
                await action.run(event);
            } catch (error) {
                console.error('Queue action failed.', { errorName: error.name });
            } finally {
                button.disabled = Boolean(action.isDisabled);
            }
        });
        actions.append(button);
    });
    row.append(actions);
    return row;
}

/** Renders the common online/physical queue layout.
 * @param {Document} document Owner document. @param {object[]} items Queue rows.
 * @param {object} options Status label and row actions. @returns {HTMLTableElement} Queue table.
 */
export function createApplicationQueueTable(document, items, options) {
    const table = document.createElement('table');
    table.className = 'staff-applications-table';
    const headers = resolveHeaders(options);
    const hasNotes = Boolean(options.noteKind);
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((label, index) => {
        const cell = document.createElement('th');
        cell.textContent = label;
        if (hasNotes && index === 0) {
            cell.className = 'staff-record-note-col';
            cell.setAttribute('aria-label', 'Not');
        }
        headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement('tbody');
    const noteEntries = [];
    items.forEach((item, index) => body.append(createRow(document, item, options, index, noteEntries)));
    table.append(head, body);
    if (hasNotes && !options.skipNoteLoad && noteEntries.length > 0) {
        void loadTableRecordNotes(document, options.noteKind, noteEntries, options.notesApi);
    }
    return table;
}
