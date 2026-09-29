import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
import { callAppsScript, UpstreamServiceError } from '../services/appsScriptProxy.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const MUTATIONS = Object.freeze({
    '/api/add-tebligat': { action: 'add', requiresNumber: false },
    '/api/update-tebligat': { action: 'update', requiresNumber: true },
    '/api/unmark-tebligat': { action: 'unmark', requiresNumber: true },
    '/api/remove-tebligat': { action: 'remove', requiresNumber: true }
});

function safeUpstreamFailure(error) {
    if (!(error instanceof UpstreamServiceError)) return new ApiError(502, 'UPSTREAM_FAILURE', 'Tebligat işlemi tamamlanamadı. Lütfen tekrar deneyin.', true);
    if (error.isConfigurationError) return new ApiError(503, 'SERVICE_UNAVAILABLE', 'Tebligat hizmeti şu anda kullanılamıyor.', true);
    if (error.code === 'UPSTREAM_TIMEOUT') return new ApiError(504, 'UPSTREAM_TIMEOUT', 'Tebligat hizmetine zamanında ulaşılamadı. Lütfen tekrar deneyin.', true);
    return new ApiError(502, 'UPSTREAM_FAILURE', 'Tebligat işlemi tamamlanamadı. Lütfen tekrar deneyin.', true);
}

function readMutation(body, requiresNumber) {
    if (typeof body.sayfa !== 'string' || body.sayfa.trim().length === 0 || body.sayfa.length > 80
        || typeof body.isim !== 'string' || body.isim.trim().length === 0 || body.isim.length > 200) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem için geçerli tebligat bilgileri gerekli.');
    }
    if (requiresNumber && typeof body.no !== 'string' && typeof body.no !== 'number') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem için geçerli tebligat numarası gerekli.');
    }
    if (body.no !== undefined && String(body.no).length > 30) throw new ApiError(400, 'VALIDATION_ERROR', 'Tebligat numarasını kontrol edip tekrar deneyin.');
    return {
        sayfa: body.sayfa.trim(), isim: body.isim.trim(),
        ...(body.no === undefined ? {} : { no: String(body.no) })
    };
}

async function callSafe(action, parameters, environment) {
    try {
        return await callAppsScript(action, parameters, environment);
    } catch (error) {
        throw safeUpstreamFailure(error);
    }
}

/**
 * Authenticates and proxies one supported tebligat API route.
 * @param {Request} request Fetch API request.
 * @param {object} environment Worker bindings including Apps Script configuration.
 * @param {string} pathname API route path.
 * @returns {Promise<unknown>} Sanitized upstream JSON payload.
 * @throws {ApiError} When authorization, validation, or upstream checks fail.
 */
export async function handleTebligatRequest(request, environment, pathname) {
    await requireStaff(request, environment);
    const mutation = MUTATIONS[pathname];
    if (mutation) {
        requireMethod(request, 'POST');
        requireSameOrigin(request);
        const body = await readJsonBody(request);
        return callSafe(mutation.action, readMutation(body, mutation.requiresNumber), environment);
    }
    requireMethod(request, 'GET');
    const url = new URL(request.url);
    if (pathname === '/api/get-all-tebligat') return callSafe('getAll', {}, environment);
    if (pathname !== '/api/search-tebligat') throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    const query = url.searchParams.get('q');
    const year = url.searchParams.get('year') || '2026';
    if (!query || query.trim().length < 2 || query.length > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'En az iki karakterli bir arama girin.');
    if (!/^\d{4}$/.test(year)) throw new ApiError(400, 'VALIDATION_ERROR', 'Geçerli bir yıl seçin.');
    return callSafe('search', { q: query.trim(), year }, environment);
}
