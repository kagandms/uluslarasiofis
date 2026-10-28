function createText(document, tagName, value) {
    const node = document.createElement(tagName);
    node.textContent = value;
    return node;
}

function createField(document, className, labelText, input) {
    const field = document.createElement('div');
    field.className = className;
    const label = createText(document, 'label', labelText);
    label.htmlFor = input.id;
    field.append(label, input);
    return field;
}

/** Renders the common searchable, status-filtered, date-bounded staff queue form. */
export function createApplicationQueueFilters(document, options) {
    const form = document.createElement('form');
    form.className = 'staff-applications-filters';

    const search = document.createElement('input');
    search.className = 'glass-input';
    search.name = 'q';
    search.value = options.query.q || '';
    search.placeholder = 'Öğrenci no, ad, soyad veya pasaport no';
    search.maxLength = 120;
    search.id = `${options.idPrefix}-search`;

    const status = document.createElement('select');
    status.className = 'glass-input';
    status.name = 'status';
    status.id = `${options.idPrefix}-status`;
    for (const [value, label] of options.statusOptions) {
        const option = createText(document, 'option', label);
        option.value = value;
        option.selected = value === options.query.status;
        status.append(option);
    }

    const fromDate = document.createElement('input');
    fromDate.type = 'date';
    fromDate.className = 'glass-input';
    fromDate.name = 'from_date';
    fromDate.value = options.query.from_date || '';
    fromDate.id = `${options.idPrefix}-from-date`;

    const toDate = document.createElement('input');
    toDate.type = 'date';
    toDate.className = 'glass-input';
    toDate.name = 'to_date';
    toDate.value = options.query.to_date || '';
    toDate.id = `${options.idPrefix}-to-date`;

    const submit = createText(document, 'button', 'Filtrele');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.disabled = Boolean(options.disabled);
    form.addEventListener('submit', event => {
        event.preventDefault();
        options.onSubmit({ q: search.value, status: status.value, from_date: fromDate.value, to_date: toDate.value });
    });
    form.append(
        createField(document, 'physical-filter-search', 'Başvuru ara', search),
        createField(document, 'physical-filter-status', 'Durum', status),
        createField(document, 'physical-filter-start-date', 'Başlangıç tarihi', fromDate),
        createField(document, 'physical-filter-end-date', 'Bitiş tarihi', toDate),
        submit
    );
    return form;
}
