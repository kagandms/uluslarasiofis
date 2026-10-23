import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { jsonResponse } from '../http/apiResponse.js';
import { readJsonBody } from '../http/requestBody.js';

const PEOPLE = Object.freeze([
    { key: 'kagan_samet', name: 'Kağan Samet' },
    { key: 'asaf', name: 'Asaf' },
    { key: 'eyup', name: 'Eyüp' },
    { key: 'oguz', name: 'Oğuz' },
    { key: 'eray', name: 'Eray' }
]);

function todayInIstanbul() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
}

function isWeekend(date) {
    const weekday = new Date(`${date}T12:00:00+03:00`).getUTCDay();
    return weekday === 0 || weekday === 6;
}

async function readMonth(request, environment, requestId) {
    requireMethod(request, 'GET');
    const today = todayInIstanbul();
    const selectedDate = new URL(request.url).searchParams.get('date') || today;
    if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(selectedDate)
        || new Date(`${selectedDate}T12:00:00+03:00`).toISOString().slice(0, 10) !== selectedDate) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Tarih seçimini kontrol edin.');
    }
    const month = selectedDate.slice(0, 7);
    const result = await environment.DB.prepare(
        'SELECT staff_key, work_date, minutes FROM staff_work_hours WHERE work_date LIKE ? ORDER BY work_date DESC, staff_key'
    ).bind(`${month}-%`).all();
    return jsonResponse({ people: PEOPLE, records: result.results || [], month, selectedDate, today }, 200, requestId);
}

async function saveToday(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request);
    const person = PEOPLE.find(({ key }) => key === body.person);
    if (!person || !Number.isInteger(body.minutes) || body.minutes < 0 || body.minutes > 1440 || body.minutes % 30 !== 0) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kişi ve çalışma süresini kontrol edin.');
    }
    const today = todayInIstanbul();
    if (isWeekend(today)) throw new ApiError(409, 'WORK_HOURS_CLOSED', 'Cumartesi ve pazar günleri kayıt yapılamaz.');
    const now = new Date().toISOString();
    await environment.DB.prepare(`
        INSERT INTO staff_work_hours (id, staff_key, work_date, minutes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(staff_key, work_date) DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), person.key, today, body.minutes, now, now).run();
    return jsonResponse({ person: person.key, workDate: today, minutes: body.minutes }, 200, requestId);
}

export async function handleStaffWorkHours(request, environment, requestId) {
    await requireStaff(request, environment);
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/staff/work-hours' && request.method === 'GET') return readMonth(request, environment, requestId);
    if (pathname === '/api/staff/work-hours' && request.method === 'POST') return saveToday(request, environment, requestId);
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kayıt bulunamadı.');
}
