import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_ORIGIN = 'https://goc.topkapiuni.workers.dev';
export const CANONICAL_ORIGIN = 'https://topkapiunigoc.com';
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const publicReadOnlyPaths = [
    '/', '/basvuru/', '/basvurum/', '/yetkili/', '/yazdir/', '/downloads/ykn-eklentisi.json'
];

async function fetchReadOnlyRoute(fetchImpl, targetUrl, path) {
    return fetchImpl(targetUrl, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { accept: path.endsWith('.json') ? 'application/json' : 'text/html' },
        signal: AbortSignal.timeout(15_000)
    });
}

function getLocationHeader(response) {
    return response.headers?.get?.('location') ?? response.headers?.location ?? response.headers?.Location;
}

export async function checkReadOnlyHealth(fetchImpl = fetch, origin = PRODUCTION_ORIGIN) {
    const parsed = new URL(origin);
    assert.equal(parsed.origin, PRODUCTION_ORIGIN, 'Health check is restricted to the production Worker origin.');
    for (const path of publicReadOnlyPaths) {
        const requestUrl = new URL(path, parsed);
        const response = await fetchReadOnlyRoute(fetchImpl, requestUrl, path);
        assert.equal(Boolean(response.redirected), false, `Unexpected redirect during read-only health check for ${path}.`);
        if (response.status === 200) continue;
        if (!REDIRECT_STATUSES.has(response.status)) {
            assert.fail(`Read-only health check failed for ${path} (HTTP ${response.status}).`);
        }
        const location = getLocationHeader(response);
        assert.ok(typeof location === 'string' && location.trim().length > 0, `Redirect response for ${path} (HTTP ${response.status}) is missing a Location header.`);
        const expectedCanonicalUrl = new URL(path, CANONICAL_ORIGIN);
        const resolvedLocation = new URL(location, requestUrl);
        assert.equal(resolvedLocation.href, expectedCanonicalUrl.href, `Unexpected redirect target for ${path}: ${resolvedLocation.href}.`);
        const canonicalResponse = await fetchReadOnlyRoute(fetchImpl, expectedCanonicalUrl, path);
        assert.equal(canonicalResponse.status, 200, `Canonical read-only health check failed for ${expectedCanonicalUrl.href} (HTTP ${canonicalResponse.status}).`);
        assert.equal(Boolean(canonicalResponse.redirected), false, `Unexpected redirect during canonical read-only health check for ${expectedCanonicalUrl.href}.`);
    }
    console.log(`Read-only production health check passed (${publicReadOnlyPaths.length} public GET routes; no response bodies logged).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await checkReadOnlyHealth();
}
