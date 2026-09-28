import { requireAuth, requireSameOrigin } from './_auth.js';

const APPS_SCRIPT_ACTIONS = new Set(['getAll', 'search', 'add', 'update', 'unmark', 'remove']);
// Leave room for the serverless function to return a controlled timeout response.
const APPS_SCRIPT_TIMEOUT_MS = 50_000;

function createProxyError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

export async function callAppsScript(action, parameters = {}) {
    if (!APPS_SCRIPT_ACTIONS.has(action)) {
        throw createProxyError('Unsupported Apps Script action.', 'UNSUPPORTED_ACTION');
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_URL;
    const apiKey = process.env.APPS_SCRIPT_API_KEY;
    if (!appsScriptUrl || !apiKey) {
        throw createProxyError('Server configuration is incomplete.', 'MISSING_CONFIGURATION');
    }

    let endpoint;
    try {
        endpoint = new URL(appsScriptUrl);
    } catch {
        throw createProxyError('Server configuration is invalid.', 'INVALID_CONFIGURATION');
    }

    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw createProxyError('Server configuration is invalid.', 'INVALID_CONFIGURATION');
    }

    const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parameters, action, key: apiKey }),
        redirect: 'follow',
        signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw createProxyError('Apps Script request failed.', 'UPSTREAM_FAILURE');
    }

    let payload;
    try {
        payload = JSON.parse(await response.text());
    } catch {
        throw createProxyError('Apps Script returned an invalid response.', 'INVALID_UPSTREAM_RESPONSE');
    }

    if (!payload || typeof payload !== 'object' || payload.success === false) {
        throw createProxyError('Apps Script returned an unsuccessful result.', 'UPSTREAM_FAILURE');
    }

    return payload;
}

export async function respondWithAppsScript(res, action, parameters = {}) {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const payload = await callAppsScript(action, parameters);
        return res.status(200).json(payload);
    } catch (error) {
        const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        console.error('Tebligat upstream request failed.', {
            action,
            errorCode: error?.code || error?.name || 'UNKNOWN_ERROR'
        });
        return res.status(isTimeout ? 504 : (error?.code?.includes('CONFIGURATION') ? 500 : 502)).json({
            error: isTimeout
                ? 'Tebligat servisine zamanında ulaşılamadı. Lütfen tekrar deneyin.'
                : (error?.code?.includes('CONFIGURATION')
                    ? 'Sunucu yapılandırma hatası.'
                    : 'Tebligat işlemi tamamlanamadı. Lütfen tekrar deneyin.')
        });
    }
}

export function readTebligatMutation(body, options = {}) {
    const { requiresNumber = true } = options;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

    const { sayfa, isim, no } = body;
    if (typeof sayfa !== 'string' || sayfa.trim().length === 0 || sayfa.length > 80) return null;
    if (typeof isim !== 'string' || isim.trim().length === 0 || isim.length > 200) return null;
    if (requiresNumber && (typeof no !== 'string' && typeof no !== 'number')) return null;
    if (no !== undefined && String(no).length > 30) return null;

    return {
        sayfa: sayfa.trim(),
        isim: isim.trim(),
        ...(no === undefined ? {} : { no: String(no) })
    };
}

export function createTebligatMutationHandler(action, options = {}) {
    const { requiresNumber = true } = options;
    return async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        if (!requireAuth(req, res)) return;
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Bu işlem için POST isteği gerekir.' });
        }
        if (!requireSameOrigin(req, res)) return;

        const mutation = readTebligatMutation(req.body, { requiresNumber });
        if (!mutation) {
            return res.status(400).json({ error: 'İşlem için geçerli tebligat bilgileri gerekli.' });
        }

        return respondWithAppsScript(res, action, mutation);
    };
}
