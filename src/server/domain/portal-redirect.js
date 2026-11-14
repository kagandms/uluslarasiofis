const LEGACY_WORKERS_HOSTNAME = 'goc.topkapiuni.workers.dev';
const EXCLUDED_LEGACY_PREFIXES = ['/api/', '/downloads/'];
const EXCLUDED_LEGACY_PATHS = new Set([
    '/sw.js',
    '/robots.txt',
    '/sitemap.xml',
    '/manifest.json'
]);

/**
 * Parses and validates PORTAL_CANONICAL_ORIGIN as an https origin without credentials, path, query, or hash.
 * @param {unknown} rawOrigin
 * @returns {URL | null}
 */
function parseCanonicalOrigin(rawOrigin) {
    if (typeof rawOrigin !== 'string' || !rawOrigin || rawOrigin !== rawOrigin.trim()) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(rawOrigin);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || rawOrigin.includes('@')) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed;
}

/**
 * Checks whether a legacy-host pathname must never be redirected.
 * @param {string} pathname
 * @returns {boolean}
 */
function isExcludedLegacyPath(pathname) {
    if (EXCLUDED_LEGACY_PATHS.has(pathname)) return true;
    return EXCLUDED_LEGACY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Resolves a host-level redirect response for the legacy workers.dev or www hostname, or null if none applies.
 * @param {Request} request
 * @param {Record<string, unknown> | undefined} environment
 * @returns {Response | null}
 */
export function resolvePortalRedirect(request, environment) {
    const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
    if (method !== 'GET' && method !== 'HEAD') return null;

    const canonicalUrl = parseCanonicalOrigin(environment?.PORTAL_CANONICAL_ORIGIN);
    if (!canonicalUrl) return null;

    let requestUrl;
    try {
        requestUrl = new URL(request.url);
    } catch {
        return null;
    }

    if (requestUrl.hostname === canonicalUrl.hostname) return null;

    const location = `${canonicalUrl.origin}${requestUrl.pathname}${requestUrl.search}`;

    if (requestUrl.hostname === `www.${canonicalUrl.hostname}`) {
        return new Response(null, {
            status: 301,
            headers: {
                Location: location
            }
        });
    }

    if (
        requestUrl.hostname === LEGACY_WORKERS_HOSTNAME &&
        environment?.PORTAL_REDIRECT_ENABLED === 'true'
    ) {
        if (isExcludedLegacyPath(requestUrl.pathname)) return null;
        const scope = environment?.PORTAL_REDIRECT_SCOPE || 'home';
        if (scope === 'home' && requestUrl.pathname !== '/') return null;
        if (scope !== 'home' && scope !== 'pages') return null;

        return new Response(null, {
            status: 302,
            headers: {
                Location: location,
                'Cache-Control': 'no-store'
            }
        });
    }

    return null;
}
