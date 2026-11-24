/**
 * Yetkili personel için halka açık sohbet kayıtları (`chat_sessions`, `chat_turns`) okuma,
 * istatistik ve elle silme uç noktaları.
 * Tüm yetkili personel (`reviewer`, `admin`) okuyabilir ve silebilir; yazma işlemlerinde
 * aynı köken (`requireSameOrigin`) zorunludur; sohbet metni hiçbir zaman konsol günlüğüne yazılmaz.
 */
import { requireStaff } from '../auth/staffAuth.js';
import { CHAT_LOG_MAX_ID_LENGTH } from '../domain/chatLog.js';
import { ApiError } from '../domain/errors.js';
import { createChatLogRepository, decodeChatSessionCursor } from '../repositories/d1/chatLogRepository.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const ALLOWED_FILTERS = Object.freeze(['all', 'down', 'handoff', 'refused', 'fallback']);
const ALLOWED_LANGUAGES = Object.freeze(['tr', 'en', 'ru', 'tk', 'ar']);
const OLDER_THAN_DAYS_MIN = 1;
const OLDER_THAN_DAYS_MAX = 3650;
const DAY_MS = 86_400_000;
const PERIOD_DURATION_MS = Object.freeze({
    all: null,
    '24h': DAY_MS,
    '7d': 7 * DAY_MS,
    '30d': 30 * DAY_MS
});
const SEARCH_QUERY_MIN_CHARS = 2;
const SEARCH_QUERY_MAX_CHARS = 80;
const ID_DISALLOWED_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\s]/u;

function createChatLogsRepo(environment) {
    if (!environment?.DB) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.', true);
    }
    return createChatLogRepository(environment.DB);
}

function validateSessionId(rawId) {
    if (typeof rawId !== 'string') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet oturumu kimliği geçersiz.');
    }
    const trimmed = rawId.trim();
    if (!trimmed || [...trimmed].length > CHAT_LOG_MAX_ID_LENGTH || ID_DISALLOWED_CHAR_PATTERN.test(rawId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet oturumu kimliği geçersiz.');
    }
    return trimmed;
}

function validateListQuery(searchParams, now = new Date()) {
    const rawFilter = searchParams.get('filter');
    const filter = rawFilter === null || rawFilter === '' ? 'all' : rawFilter.trim();
    if (!ALLOWED_FILTERS.includes(filter)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz süzgeç parametresi.');
    }

    const rawLang = searchParams.get('lang');
    let lang = null;
    if (rawLang !== null && rawLang !== '') {
        const trimmedLang = rawLang.trim();
        if (!ALLOWED_LANGUAGES.includes(trimmedLang)) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz dil parametresi.');
        }
        lang = trimmedLang;
    }

    const rawPeriod = searchParams.get('period');
    const period = rawPeriod === null || rawPeriod === '' ? 'all' : rawPeriod.trim();
    if (!Object.hasOwn(PERIOD_DURATION_MS, period)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Geçersiz dönem parametresi.');
    }
    const periodDurationMs = PERIOD_DURATION_MS[period];
    const sinceIso = periodDurationMs === null
        ? null
        : new Date(now.getTime() - periodDurationMs).toISOString();

    const rawQuery = searchParams.get('q');
    let query = null;
    if (rawQuery !== null && rawQuery !== '') {
        const trimmedQuery = rawQuery.trim();
        const queryLength = [...trimmedQuery].length;
        if (queryLength < SEARCH_QUERY_MIN_CHARS || queryLength > SEARCH_QUERY_MAX_CHARS) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Arama metni 2 ile 80 karakter arasında olmalıdır.');
        }
        query = trimmedQuery;
    }

    const rawCursor = searchParams.get('cursor');
    let cursor = null;
    if (rawCursor !== null && rawCursor !== '') {
        cursor = decodeChatSessionCursor(rawCursor);
        if (!cursor) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Sayfalama imleci geçersiz.');
        }
    }
    return { filter, lang, sinceIso, query, cursor };
}

function validateOlderThanDays(searchParams) {
    const raw = searchParams.get('older_than_days');
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Gün sayısı 1 ile 3650 arasında bir tam sayı olmalıdır.');
    }
    const days = Number.parseInt(raw.trim(), 10);
    if (!Number.isSafeInteger(days) || days < OLDER_THAN_DAYS_MIN || days > OLDER_THAN_DAYS_MAX) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Gün sayısı 1 ile 3650 arasında bir tam sayı olmalıdır.');
    }
    return days;
}

function getIstanbulStatsBoundaries(now = new Date()) {
    const todayYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
    const todayStartMs = Date.parse(`${todayYmd}T00:00:00+03:00`);
    return {
        todayStartIso: new Date(todayStartMs).toISOString(),
        last7StartIso: new Date(todayStartMs - 6 * DAY_MS).toISOString()
    };
}

/**
 * Yetkili personel için sohbet oturumlarını imleçli sayfalama ve süzgeçlerle listeler.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @returns {Promise<{items: Array<object>, nextCursor: string|null, total: number}>} Oturum listesi, sonraki imleç ve toplam eşleşme sayısı.
 */
export async function listStaffChatSessions(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const { searchParams } = new URL(request.url);
    const { filter, lang, sinceIso, query, cursor } = validateListQuery(searchParams, new Date());
    return createChatLogsRepo(environment).listSessions({ filter, lang, sinceIso, query, cursor, limit: 25 });
}

/**
 * Yetkili personel için tek bir sohbet oturumunu ve tüm turlarını okur.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} sessionId Oturum kimliği.
 * @returns {Promise<{session: object, turns: Array<object>}>} Oturum ve turlar.
 */
export async function readStaffChatSession(request, environment, sessionId) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const validatedId = validateSessionId(sessionId);
    const detail = await createChatLogsRepo(environment).getSessionWithTurns(validatedId);
    if (!detail) {
        throw new ApiError(404, 'CHAT_SESSION_NOT_FOUND', 'Sohbet oturumu bulunamadı.');
    }
    return detail;
}

/**
 * Yetkili personel için tek bir sohbet oturumunu (turları CASCADE ile) kalıcı olarak siler.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} sessionId Oturum kimliği.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<Response>} 204 boş yanıt.
 */
export async function deleteStaffChatSession(request, environment, sessionId, requestId) {
    requireMethod(request, 'DELETE');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const validatedId = validateSessionId(sessionId);
    const deleted = await createChatLogsRepo(environment).deleteSessionById({
        id: validatedId,
        staffId: staff.id,
        nowIso: new Date().toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    if (!deleted) {
        throw new ApiError(404, 'CHAT_SESSION_NOT_FOUND', 'Sohbet oturumu bulunamadı.');
    }
    return new Response(null, { status: 204 });
}

/**
 * Yetkili personel için `older_than_days` gününden eski tüm sohbet oturumlarını siler.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<{deleted: number}>} Silinen oturum sayısı.
 */
export async function deleteStaffChatSessionsOlderThan(request, environment, requestId) {
    requireMethod(request, 'DELETE');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const { searchParams } = new URL(request.url);
    const days = validateOlderThanDays(searchParams);
    const now = new Date();
    const cutoffIso = new Date(now.getTime() - days * DAY_MS).toISOString();
    const deleted = await createChatLogsRepo(environment).deleteSessionsOlderThan({
        cutoffIso,
        olderThanDays: days,
        staffId: staff.id,
        nowIso: now.toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    return { deleted };
}

/**
 * Yetkili personel için bugün ve son 7 günlük yanıt / Evet / Hayır sayılarını (İstanbul gün sınırı) döndürür.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @returns {Promise<{today: {answers: number, up: number, down: number}, last7: {answers: number, up: number, down: number}}>} İstatistikler.
 */
export async function readStaffChatStats(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const boundaries = getIstanbulStatsBoundaries(new Date());
    return createChatLogsRepo(environment).getStats(boundaries);
}

/**
 * `/api/staff/chat-stats`, `/api/staff/chat-sessions` ve `/api/staff/chat-sessions/<id>` uçlarını yönlendirir.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<object|Response>} JSON yanıt nesnesi veya 204 Response.
 */
export async function handleStaffChatLogs(request, environment, requestId) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/staff/chat-stats') {
        return readStaffChatStats(request, environment);
    }

    if (pathname === '/api/staff/chat-sessions') {
        if (request.method === 'GET') {
            return listStaffChatSessions(request, environment);
        }
        if (request.method === 'DELETE') {
            return deleteStaffChatSessionsOlderThan(request, environment, requestId);
        }
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
    }

    const match = pathname.match(/^\/api\/staff\/chat-sessions\/([^/]+)$/);
    if (!match) {
        throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    }
    let sessionId;
    try {
        sessionId = decodeURIComponent(match[1]);
    } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sohbet oturumu kimliği geçersiz.');
    }
    if (request.method === 'GET') {
        return readStaffChatSession(request, environment, sessionId);
    }
    if (request.method === 'DELETE') {
        return deleteStaffChatSession(request, environment, sessionId, requestId);
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
}
