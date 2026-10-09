/** Parse and validate a one-based PDF page selection. */
export function parsePageSelection(value, pageCount) {
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw selectionError('pageCountUnavailable');
    if (typeof value !== 'string' || value.trim() === '') throw selectionError('pageRequired');
    const pages = [];
    const seen = new Set();
    for (const part of value.split(',')) {
        const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) throw selectionError('pageFormatInvalid');
        const first = Number(match[1]);
        const last = match[2] ? Number(match[2]) : first;
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount) {
            throw selectionError('pageOutOfRange');
        }
        for (let page = first; page <= last; page += 1) {
            if (seen.has(page)) throw selectionError('pageDuplicate');
            seen.add(page);
            pages.push(page - 1);
        }
    }
    return pages;
}

function selectionError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

/** Return the one-based page count represented by a parsed selection. */
export function getSelectedPageCount(pages) {
    return pages.length;
}
