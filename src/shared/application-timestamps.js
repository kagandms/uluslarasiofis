/** Formats persisted application instants in the office timezone, including SQLite UTC values.
 * @param {string|null|undefined} value Database timestamp.
 * @param {string} locale Display language.
 * @returns {string|null} Formatted timestamp, or null for unavailable dates.
 */
export function formatApplicationTimestamp(value, locale = 'tr-TR') {
    if (typeof value !== 'string' || !value) return null;
    // SQLite CURRENT_TIMESTAMP omits the UTC offset; never interpret it as device-local time.
    const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)
        ? `${value.replace(' ', 'T')}Z` : value;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.valueOf())) return null;
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul'
    }).format(date);
}
