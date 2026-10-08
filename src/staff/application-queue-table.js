const HEADERS = ['Öğrenci No', 'Ad Soyad', 'Başvuru Türü', 'Durum', 'Gönderim Tarihi', 'Son Güncelleme', ''];

/** Formats a queue timestamp. @param {string} value ISO timestamp. @returns {string} Turkish date or placeholder. */
export function formatQueueDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '—';
    return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function createRow(document, item, options) {
    const row = document.createElement('tr');
    const values = [item.student_number || '—', [item.first_name, item.last_name].filter(Boolean).join(' ') || '—',
        item.application_type === 'renewal' ? 'Uzatma' : 'İlk başvuru', options.statusLabel(item.status),
        formatQueueDate(item.submitted_at), formatQueueDate(item.updated_at)];
    values.forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value || '—';
        cell.dataset.label = HEADERS[index];
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
        button.addEventListener('click', action.run);
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
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    HEADERS.forEach(label => {
        const cell = document.createElement('th');
        cell.textContent = label;
        headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement('tbody');
    items.forEach(item => body.append(createRow(document, item, options)));
    table.append(head, body);
    return table;
}
