const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function readCalendarDate(value) {
    if (typeof value !== 'string') return null;
    const match = DATE_PATTERN.exec(value);
    if (!match) return null;
    const [, yearText, monthText, dayText] = match;
    const parts = { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return date.getUTCFullYear() === parts.year
        && date.getUTCMonth() === parts.month - 1
        && date.getUTCDate() === parts.day ? parts : null;
}

/**
 * Returns the under-18 answer by comparing calendar dates without timezone conversion.
 * @param {string|null} dateOfBirth ISO date-only birth date.
 * @param {string} currentDate ISO date-only date on which age is measured.
 * @returns {boolean|null} True for under 18, false for 18 or older, null for invalid dates.
 */
export function calculateUnder18(dateOfBirth, currentDate) {
    const birthDate = readCalendarDate(dateOfBirth);
    const asOfDate = readCalendarDate(currentDate);
    if (!birthDate || !asOfDate) return null;
    const birthKey = `${String(birthDate.year).padStart(4, '0')}-${String(birthDate.month).padStart(2, '0')}-${String(birthDate.day).padStart(2, '0')}`;
    const currentKey = `${String(asOfDate.year).padStart(4, '0')}-${String(asOfDate.month).padStart(2, '0')}-${String(asOfDate.day).padStart(2, '0')}`;
    if (birthKey > currentKey) return null;
    const eighteenthBirthday = `${String(birthDate.year + 18).padStart(4, '0')}-${String(birthDate.month).padStart(2, '0')}-${String(birthDate.day).padStart(2, '0')}`;
    return currentKey < eighteenthBirthday;
}

/**
 * Reads today's calendar date in the institution's Istanbul timezone.
 * @param {Date} now Current instant.
 * @returns {string} ISO date-only value for Europe/Istanbul.
 */
export function readIstanbulDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Derives the under-18 answer for a birth date using the current Istanbul calendar day.
 * @param {string|null} dateOfBirth ISO date-only birth date.
 * @returns {boolean|null} True for under 18, false for 18 or older, null for invalid dates.
 */
export function calculateCurrentUnder18(dateOfBirth) {
    return calculateUnder18(dateOfBirth, readIstanbulDate());
}
