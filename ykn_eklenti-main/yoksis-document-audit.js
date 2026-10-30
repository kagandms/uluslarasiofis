(() => {
if (globalThis.YoksisDocumentAudit) return;

const normalizeLabel = (value) => String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function isApplicationNumber(value) {
    return /^\d{4}-\d{2}-\d{7}$/.test(cleanText(value));
}

function isStudentNumber(value) {
    return /^\d{8,14}$/.test(cleanText(value));
}

function getAccessibleDocuments(rootDocument) {
    const docs = [];
    function scan(doc) {
        if (!doc || docs.includes(doc)) return;
        docs.push(doc);
        try {
            const frames = doc.querySelectorAll('iframe, frame');
            for (const frame of frames) {
                try {
                    const childDoc = frame.contentDocument || frame.contentWindow?.document;
                    if (childDoc) scan(childDoc);
                } catch {}
            }
        } catch {}
    }
    scan(rootDocument);
    return docs;
}

function findHeaderIndex(table, aliases) {
    // ZK renders list headers in a separate table from the scrollable rows.
    const headers = Array.from(table.closest('.z-listbox-body')
        ? table.closest('.z-listbox').querySelectorAll('.z-listbox-header th')
        : table.querySelectorAll('thead th, thead td'));
    return headers.findIndex((header) => aliases.includes(normalizeLabel(header.textContent)));
}

function readTableRows(table) {
    return Array.from(table.querySelectorAll(table.closest('.z-listbox-body') ? 'tbody tr.z-listitem' : 'tbody tr'));
}

function findRecordTable(rootDocument) {
    for (const doc of getAccessibleDocuments(rootDocument)) {
        const match = Array.from(doc.querySelectorAll('table')).find((table) => {
            const applicationIndex = findHeaderIndex(table, ['e ikamet basvuru no']);
            const studentIndex = findHeaderIndex(table, ['ogrenci no']);
            const hasSelectAction = Array.from(table.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
                .some((control) => normalizeLabel(control.textContent || control.value).replace(/ /g, '') === 'secyukle');
            return applicationIndex >= 0 && studentIndex >= 0 && hasSelectAction;
        });
        if (match) return match;
    }
    return null;
}

function findYoksisAuditRecordButton(rootDocument, expectedEntry) {
    const table = findRecordTable(rootDocument);
    if (!table) return null;
    const applicationIndex = findHeaderIndex(table, ['e ikamet basvuru no']);
    const studentIndex = findHeaderIndex(table, ['ogrenci no']);
    for (const row of table.querySelectorAll('tbody tr')) {
        if (getCellText(row, applicationIndex) !== expectedEntry.applicationNumber
            || getCellText(row, studentIndex) !== expectedEntry.studentNumber) continue;
        return Array.from(row.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
            .find((control) => normalizeLabel(control.textContent || control.value).replace(/ /g, '') === 'secyukle') || null;
    }
    return null;
}

function getCellText(row, index) {
    return cleanText(row.cells?.[index]?.textContent);
}

function collectYoksisAuditQueue(rootDocument) {
    const table = findRecordTable(rootDocument);
    if (!table) return { status: 'incomplete', entries: [], reason: 'record-list-not-found' };

    const applicationIndex = findHeaderIndex(table, ['e ikamet basvuru no']);
    const studentIndex = findHeaderIndex(table, ['ogrenci no']);
    const entries = [];
    const seenApplications = new Map();
    let incompleteReason = '';

    for (const row of table.querySelectorAll('tbody tr')) {
        const hasSelectAction = Array.from(row.querySelectorAll('button, input[type="button"], input[type="submit"], a'))
            .some((control) => normalizeLabel(control.textContent || control.value).replace(/ /g, '') === 'secyukle');
        if (!hasSelectAction) continue;

        const applicationNumber = getCellText(row, applicationIndex);
        const studentNumber = getCellText(row, studentIndex);
        if (!isApplicationNumber(applicationNumber)) {
            incompleteReason ||= 'application-key-incomplete';
            continue;
        }
        if (seenApplications.has(applicationNumber)) {
            if (seenApplications.get(applicationNumber) !== studentNumber) incompleteReason ||= 'duplicate-identity-conflict';
            continue;
        }
        seenApplications.set(applicationNumber, studentNumber);
        if (!isStudentNumber(studentNumber)) {
            incompleteReason ||= 'row-identity-incomplete';
            continue;
        }

        entries.push({ applicationNumber, studentNumber });
    }

    if (entries.length === 0) return { status: 'incomplete', entries, reason: 'no-verifiable-records' };
    return incompleteReason
        ? { status: 'incomplete', entries, reason: incompleteReason }
        : { status: 'complete', entries };
}

function readLabeledValue(rootDocument, requestedLabel) {
    const requested = normalizeLabel(requestedLabel);
    const labels = getAccessibleDocuments(rootDocument)
        .flatMap((doc) => Array.from(doc.querySelectorAll('label, .z-label')))
        .filter((label) => !requestedLabel.includes('*') || label.textContent.includes('*'))
        .filter((label) => normalizeLabel(label.textContent).replace(/\s*\(\s*\*\s*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() === requested);
    if (labels.length !== 1) return '';

    const label = labels[0];
    const ownerDoc = label.ownerDocument || rootDocument;
    const control = label.control || (label.htmlFor ? ownerDoc.getElementById(label.htmlFor) : null);
    if (control) return cleanText(control.value || control.textContent);

    const siblingControl = label.parentElement?.querySelector('input, select, textarea');
    if (siblingControl) return cleanText(siblingControl.value || siblingControl.textContent);
    const adjacentControl = label.closest('td')?.nextElementSibling?.querySelector('input, select, textarea');
    if (adjacentControl) return cleanText(adjacentControl.value || adjacentControl.textContent);
    return '';
}

function findMissingDocumentsTable(rootDocument) {
    const heading = getAccessibleDocuments(rootDocument)
        .flatMap((doc) => Array.from(doc.querySelectorAll('h1, h2, h3, h4, legend, .section-title, .z-caption')))
        .find((element) => /eksik belgeler|gocnet tarafindan istenen belgeler/.test(normalizeLabel(element.textContent)));
    if (!heading) return null;

    const section = heading.closest('section, fieldset, .panel, .card, .z-groupbox') || heading.parentElement;
    if (!section) return null;
    return Array.from(section.querySelectorAll('table')).find((table) => (
        (!table.closest('.z-listbox') || table.closest('.z-listbox-body'))
        && findHeaderIndex(table, ['belge basligi']) >= 0
        && findHeaderIndex(table, ['not aciklama']) >= 0
        && findHeaderIndex(table, ['yukleme durumu']) >= 0
    )) || null;
}

function readDocumentRows(table) {
    const indexes = {
        code: findHeaderIndex(table, ['kod']),
        name: findHeaderIndex(table, ['belge basligi']),
        required: findHeaderIndex(table, ['zorunluluk']),
        note: findHeaderIndex(table, ['not aciklama']),
        uploadStatus: findHeaderIndex(table, ['yukleme durumu'])
    };

    return readTableRows(table).map((row) => {
        const requiredText = normalizeLabel(getCellText(row, indexes.required));
        return {
            code: getCellText(row, indexes.code),
            name: getCellText(row, indexes.name),
            required: requiredText.startsWith('evet'),
            note: getCellText(row, indexes.note),
            uploadStatus: getCellText(row, indexes.uploadStatus)
        };
    }).filter((row) => row.name);
}

function readSelectedYoksisAuditRecord(rootDocument, expectedEntry) {
    const applicationNumber = readLabeledValue(rootDocument, 'E-İkamet Başvuru No:');
    const studentNumber = readLabeledValue(rootDocument, 'Öğrenci No (*)');
    if (applicationNumber !== expectedEntry.applicationNumber || studentNumber !== expectedEntry.studentNumber) {
        return { status: 'identity-mismatch' };
    }

    const identity = {
        applicationNumber,
        studentNumber,
        firstName: readLabeledValue(rootDocument, 'Adı:'),
        lastName: readLabeledValue(rootDocument, 'Soyadı:'),
        phone: readLabeledValue(rootDocument, 'İrtibat Telefonu (*)')
    };
    if (!identity.firstName || !identity.lastName || !identity.phone) {
        return { status: 'unreadable', reason: 'identity-fields-incomplete' };
    }

    const applicationStatus = readLabeledValue(rootDocument, 'Başvuru Durumu:');
    if (!applicationStatus) return { status: 'unreadable', reason: 'application-status-missing' };

    const table = findMissingDocumentsTable(rootDocument);
    if (!table) return { status: 'unreadable', reason: 'missing-documents-section-not-found' };
    const documents = readDocumentRows(table);
    if (normalizeLabel(applicationStatus).includes('eksik belge bekliyor') && documents.length === 0) {
        return { status: 'unreadable', reason: 'missing-documents-table-empty' };
    }
    if (readTableRows(table).length !== documents.length) {
        return { status: 'unreadable', reason: 'missing-documents-row-malformed' };
    }

    return { status: 'verified', identity, applicationStatus, documents };
}

globalThis.YoksisDocumentAudit = Object.freeze({
    collectYoksisAuditQueue,
    readSelectedYoksisAuditRecord,
    findYoksisAuditRecordButton,
    findYoksisAuditRecordTable: findRecordTable,
    getAccessibleDocuments,
    readSelectedAuditIdentity: (rootDocument) => ({
        applicationNumber: readLabeledValue(rootDocument, 'E-İkamet Başvuru No:'),
        studentNumber: readLabeledValue(rootDocument, 'Öğrenci No (*)')
    })
});
})();
