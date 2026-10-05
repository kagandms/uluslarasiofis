const ALLOWED_ACTIONS = new Set(['getAll', 'search', 'add', 'update', 'unmark', 'remove']);
const REQUEST_TIMEOUT_MS = 50_000;

export class UpstreamServiceError extends Error {
    constructor(code, isConfigurationError = false) {
        super('Tebligat service request failed.');
        this.name = 'UpstreamServiceError';
        this.code = code;
        this.isConfigurationError = isConfigurationError;
    }
}

function readEndpoint(environment) {
    if (!environment.APPS_SCRIPT_URL || !environment.APPS_SCRIPT_API_KEY) {
        throw new UpstreamServiceError('MISSING_CONFIGURATION', true);
    }
    let endpoint;
    try {
        endpoint = new URL(environment.APPS_SCRIPT_URL);
    } catch {
        throw new UpstreamServiceError('INVALID_CONFIGURATION', true);
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new UpstreamServiceError('INVALID_CONFIGURATION', true);
    }
    return endpoint.toString();
}

/**
 * Calls the allowlisted Apps Script API with credentials kept in Worker bindings.
 * @param {string} action Approved Apps Script action.
 * @param {Record<string, string>} parameters Validated request parameters.
 * @param {object} environment Cloudflare Worker bindings.
 * @param {typeof fetch} fetcher Fetch implementation used for upstream I/O.
 * @returns {Promise<object>} Successful upstream result.
 * @throws {UpstreamServiceError} When configuration or upstream response fails.
 */
export async function callAppsScript(action, parameters, environment, fetcher = fetch) {
    if (!ALLOWED_ACTIONS.has(action)) throw new UpstreamServiceError('UNSUPPORTED_ACTION', true);
    const endpoint = readEndpoint(environment);
    let response;
    let payload = null;
    let postError = null;

    try {
        response = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...parameters, action, key: environment.APPS_SCRIPT_API_KEY }),
            redirect: 'follow',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (response.ok) {
            try {
                payload = await response.json();
            } catch {
                payload = null;
            }
        }
    } catch (error) {
        postError = error;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.success === false) {
        try {
            const getUrl = new URL(endpoint);
            getUrl.searchParams.set('key', environment.APPS_SCRIPT_API_KEY);
            if (action === 'search' && parameters.q) {
                getUrl.searchParams.set('q', parameters.q);
                if (parameters.year) getUrl.searchParams.set('year', parameters.year);
            } else {
                getUrl.searchParams.set('action', action);
                for (const [key, value] of Object.entries(parameters)) {
                    if (value !== undefined && value !== null) {
                        getUrl.searchParams.set(key, String(value));
                    }
                }
            }
            const getResponse = await fetcher(getUrl.toString(), {
                method: 'GET',
                redirect: 'follow',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });
            if (getResponse.ok) {
                try {
                    payload = await getResponse.json();
                } catch {
                    payload = null;
                }
            }
        } catch (error) {
            const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError' || postError?.name === 'TimeoutError' || postError?.name === 'AbortError';
            throw new UpstreamServiceError(isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_FAILURE');
        }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload.success === false && !payload.results)) {
        throw new UpstreamServiceError('UPSTREAM_FAILURE');
    }
    return payload;
}
