import { readSynchronizedNow } from './clock.js';

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
    const targetYear = birthDate.year + 18;
    const isTargetLeapYear = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
    const targetDay = birthDate.month === 2 && birthDate.day === 29 && !isTargetLeapYear ? 28 : birthDate.day;
    const eighteenthBirthday = `${String(targetYear).padStart(4, '0')}-${String(birthDate.month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    return currentKey < eighteenthBirthday;
}

/**
 * Reads today's calendar date in the institution's Istanbul timezone.
 * @param {Date} now Current instant.
 * @returns {string} ISO date-only value for Europe/Istanbul.
 */
export function readIstanbulDate(now = readSynchronizedNow()) {
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

const MAX_PLAUSIBLE_AGE_YEARS = 100;

/**
 * Reports whether a birth date is a real calendar date that is not in the future and not implausibly old.
 * @param {string|null} dateOfBirth ISO date-only birth date.
 * @param {string} currentDate ISO date-only date on which plausibility is measured.
 * @returns {boolean} True when the birth date can belong to a real applicant.
 */
export function isPlausibleBirthDate(dateOfBirth, currentDate = readIstanbulDate()) {
    const birthDate = readCalendarDate(dateOfBirth);
    const asOfDate = readCalendarDate(currentDate);
    if (!birthDate || !asOfDate) return false;
    if (calculateUnder18(dateOfBirth, currentDate) === null) return false;
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    const birthKey = `${pad(birthDate.year, 4)}-${pad(birthDate.month)}-${pad(birthDate.day)}`;
    const earliestKey = `${pad(asOfDate.year - MAX_PLAUSIBLE_AGE_YEARS, 4)}-${pad(asOfDate.month)}-${pad(asOfDate.day)}`;
    return birthKey >= earliestKey;
}

/**
 * Reports whether the applicant crossed age 18 within the last month (the application validity period), making the filing date relevant.
 * @param {string|null} dateOfBirth ISO date-only birth date.
 * @param {string} currentDate ISO date-only current date.
 * @returns {boolean} True when the applicant is 18 or older today but was still under 18 one month ago.
 */
export function requiresResidenceApplicationDate(dateOfBirth, currentDate = readIstanbulDate()) {
    const isUnder18 = calculateUnder18(dateOfBirth, currentDate);
    if (isUnder18 === null) return true;
    const wasUnder18OneMonthAgo = calculateUnder18(dateOfBirth, subtractOneMonth(currentDate));
    return !isUnder18 && wasUnder18OneMonthAgo;
}

function subtractOneMonth(value) {
    const [year, month, day] = value.split('-').map(Number);
    const targetYear = month === 1 ? year - 1 : year;
    const targetMonth = month === 1 ? 12 : month - 1;
    const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const targetDay = Math.min(day, daysInTargetMonth);
    return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

/**
 * Returns the final eligible day in the three-calendar-month GSS registration window.
 * @param {string|null} academicYearStartDate ISO date-only start of the academic year.
 * @returns {string|null} Inclusive GSS deadline, or null for an invalid date.
 */
export function calculateGssRegistrationDeadline(academicYearStartDate) {
    const startDate = readCalendarDate(academicYearStartDate);
    if (!startDate) return null;
    const targetMonthIndex = startDate.year * 12 + startDate.month - 1 + 3;
    const targetYear = Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex % 12 + 1;
    const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const deadlineDay = Math.min(startDate.day, lastTargetDay);
    return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(deadlineDay).padStart(2, '0')}`;
}
