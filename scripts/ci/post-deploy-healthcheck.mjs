import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_ORIGIN = 'https://goc.topkapiuni.workers.dev';
const publicReadOnlyPaths = [
    '/', '/basvuru/', '/basvurum/', '/yetkili/', '/yazdir/', '/downloads/ykn-eklentisi.json'
];

export async function checkReadOnlyHealth(fetchImpl = fetch, origin = PRODUCTION_ORIGIN) {
    const parsed = new URL(origin);
    assert.equal(parsed.origin, PRODUCTION_ORIGIN, 'Health check is restricted to the production Worker origin.');
    for (const path of publicReadOnlyPaths) {
        const response = await fetchImpl(new URL(path, parsed), {
            method: 'GET',
            redirect: 'manual',
            cache: 'no-store',
            headers: { accept: path.endsWith('.json') ? 'application/json' : 'text/html' },
            signal: AbortSignal.timeout(15_000)
        });
        assert.equal(response.status, 200, `Read-only health check failed for ${path} (HTTP ${response.status}).`);
        assert.equal(response.redirected, false, `Unexpected redirect during read-only health check for ${path}.`);
    }
    console.log(`Read-only production health check passed (${publicReadOnlyPaths.length} public GET routes; no response bodies logged).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await checkReadOnlyHealth();
}
