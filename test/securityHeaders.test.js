import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/server/worker.js';

function assertSecurityHeaders(response) {
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
}

test('API success, errors and maintenance responses carry compatible security headers', async () => {
    for (const [path, environment, status] of [
        ['/api/public/applications/privacy-notice', {}, 200],
        ['/api/not-found', {}, 404],
        ['/api/not-found', { RECOVERY_MODE: 'maintenance' }, 503],
        ['/', { RECOVERY_MODE: 'maintenance' }, 503],
        ['/', {}, 404]
    ]) {
        const response = await worker.fetch(new Request(`https://portal.test${path}`), environment);
        assert.equal(response.status, status);
        assertSecurityHeaders(response);
        if (path.startsWith('/api/')) assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
});

test('asset hardening preserves streamed content, MIME, caching, CSP and same-origin PDF embedding', async () => {
    for (const [path, contentType, status] of [
        ['/', 'text/html; charset=utf-8', 200],
        ['/assets/main.js', 'text/javascript', 200],
        ['/assets/main.css', 'text/css', 200],
        ['/documents/example.pdf', 'application/pdf', 206]
    ]) {
        const upstream = new Response('synthetic asset', { status, headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Content-Disposition': 'inline',
            'Content-Range': 'bytes 0-14/15',
            'ETag': 'synthetic-etag'
        } });
        const response = await worker.fetch(new Request(`https://portal.test${path}`), {
            ASSETS: { fetch: async () => upstream }
        });
        assertSecurityHeaders(response);
        assert.equal(response.status, status);
        assert.equal(response.body, upstream.body);
        for (const name of ['Content-Type', 'Cache-Control', 'Content-Security-Policy', 'Content-Disposition', 'Content-Range', 'ETag']) {
            assert.equal(response.headers.get(name), upstream.headers.get(name));
        }
        for (const name of ['X-Frame-Options', 'Cross-Origin-Resource-Policy', 'Cross-Origin-Embedder-Policy', 'Permissions-Policy', 'Access-Control-Allow-Origin']) {
            assert.equal(response.headers.get(name), null);
        }
        assert.equal(await response.text(), 'synthetic asset');
    }
});

test('asset conditional responses retain a null body and status', async () => {
    const response = await worker.fetch(new Request('https://portal.test/assets/main.js'), {
        ASSETS: { fetch: async () => new Response(null, { status: 304, headers: { ETag: 'unchanged' } }) }
    });
    assertSecurityHeaders(response);
    assert.equal(response.status, 304);
    assert.equal(response.body, null);
    assert.equal(response.headers.get('ETag'), 'unchanged');
});
