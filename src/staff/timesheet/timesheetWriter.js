const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

/**
 * Neutralizes spreadsheet formula prefixes so text cells are never evaluated as formulas.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeTextCell(value) {
    const text = String(value ?? '');
    return FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text;
}

/**
 * Formats a person's display name for use in the Turkish timesheet filename.
 *
 * @param {string} name
 * @returns {string}
 */
export function formatTimesheetFileName(month, name) {
    const safeName = String(name ?? '')
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '')
        .replace(/\s+/g, '-') || 'Personel';
    return `Puantaj_${month}_${safeName}.xlsx`;
}

function formatDisplayDate(isoDate) {
    const parts = String(isoDate ?? '').split('-');
    if (parts.length !== 3) return String(isoDate ?? '');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Converts a monthly timesheet model into an .xlsx workbook byte array using SheetJS.
 *
 * @param {{
 *   month: string,
 *   person: { key: string, name: string },
 *   days: Array<{ date: string, weekday: string, isWeekend: boolean, minutes: number | null }>,
 *   totalMinutes: number
 * }} timesheet
 * @param {{ XLSX?: any }} [options]
 * @returns {{ fileName: string, bytes: Uint8Array }}
 */
export function writeTimesheet(timesheet, { XLSX } = {}) {
    if (
        !XLSX
        || typeof XLSX.utils?.aoa_to_sheet !== 'function'
        || typeof XLSX.utils?.book_new !== 'function'
        || typeof XLSX.utils?.book_append_sheet !== 'function'
        || typeof XLSX.write !== 'function'
    ) {
        throw new Error('Excel kütüphanesi (XLSX) yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
    }

    if (!timesheet || !timesheet.person || !Array.isArray(timesheet.days)) {
        throw new Error('Geçersiz puantaj verisi.');
    }

    const rows = [
        [sanitizeTextCell('Ad Soyad'), sanitizeTextCell(timesheet.person.name)],
        [sanitizeTextCell('Ay'), sanitizeTextCell(timesheet.month)],
        [],
        [sanitizeTextCell('Tarih'), sanitizeTextCell('Gün'), sanitizeTextCell('Saat')]
    ];

    for (const day of timesheet.days) {
        const hours = day.minutes === null || day.minutes === undefined
            ? null
            : day.minutes / 60;
        rows.push([
            sanitizeTextCell(formatDisplayDate(day.date)),
            sanitizeTextCell(day.weekday),
            hours
        ]);
    }

    rows.push([
        sanitizeTextCell('Toplam'),
        '',
        timesheet.totalMinutes / 60
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 10 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Puantaj');

    const rawBytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

    return {
        fileName: formatTimesheetFileName(timesheet.month, timesheet.person.name),
        bytes
    };
}
