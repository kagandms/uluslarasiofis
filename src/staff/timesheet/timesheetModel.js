const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const TURKISH_WEEKDAYS = [
    'Pazar',
    'Pazartesi',
    'Salı',
    'Çarşamba',
    'Perşembe',
    'Cuma',
    'Cumartesi'
];

function getIstanbulToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

/**
 * Builds a template-independent monthly timesheet model for a single staff member.
 *
 * @param {object} params
 * @param {string} params.month - Target month in YYYY-MM format.
 * @param {string} [params.today] - Reference current date in YYYY-MM-DD format.
 * @param {{ key: string, name?: string }} params.person - Staff member identifier and display name.
 * @param {Array<{ staff_key: string, work_date: string, minutes: number }>} [params.records] - Monthly work-hour records.
 * @returns {{
 *   month: string,
 *   person: { key: string, name: string },
 *   days: Array<{ date: string, weekday: string, isWeekend: boolean, minutes: number | null }>,
 *   totalMinutes: number,
 *   recordedDays: number,
 *   missingDays: number
 * }}
 */
export function buildTimesheet({ month, today, person, records = [] }) {
    const monthMatch = typeof month === 'string' ? MONTH_PATTERN.exec(month) : null;
    if (!monthMatch) {
        throw new Error('Geçerli bir ay belirtilmelidir (YYYY-AA).');
    }

    const year = Number(monthMatch[1]);
    const monthNumber = Number(monthMatch[2]);
    if (monthNumber < 1 || monthNumber > 12) {
        throw new Error('Geçerli bir ay belirtilmelidir (01-12).');
    }

    if (!person || typeof person.key !== 'string' || !person.key.trim()) {
        throw new Error('Çalışan bilgisi eksik.');
    }

    const referenceToday = typeof today === 'string' && DATE_PATTERN.test(today)
        ? today
        : getIstanbulToday();

    const personKey = person.key.trim();
    const personName = typeof person.name === 'string' && person.name.trim()
        ? person.name.trim()
        : personKey;

    const monthPrefix = `${month}-`;
    const minutesByDate = new Map();
    if (Array.isArray(records)) {
        for (const record of records) {
            if (!record || record.staff_key !== personKey) continue;
            if (typeof record.work_date !== 'string' || !record.work_date.startsWith(monthPrefix)) continue;
            const numericMinutes = Number(record.minutes);
            if (!Number.isFinite(numericMinutes) || numericMinutes < 0) continue;
            minutesByDate.set(record.work_date, numericMinutes);
        }
    }

    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const days = [];
    let totalMinutes = 0;
    let recordedDays = 0;
    let missingDays = 0;

    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const minutes = minutesByDate.has(date) ? minutesByDate.get(date) : null;

        if (minutes !== null) {
            totalMinutes += minutes;
            recordedDays += 1;
        } else if (!isWeekend && date <= referenceToday) {
            missingDays += 1;
        }

        days.push({
            date,
            weekday: TURKISH_WEEKDAYS[dayOfWeek],
            isWeekend,
            minutes
        });
    }

    return {
        month,
        person: { key: personKey, name: personName },
        days,
        totalMinutes,
        recordedDays,
        missingDays
    };
}
