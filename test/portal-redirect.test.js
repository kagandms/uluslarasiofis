import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePortalRedirect } from '../src/server/domain/portal-redirect.js';

const CANONICAL_ORIGIN = 'https://topkapiunigoc.com';
const LEGACY_ORIGIN = 'https://goc.topkapiuni.workers.dev';

test('disabled flag returns null for every path on legacy host', () => {
    const paths = ['/', '/basvurum/', '/basvurum/?x=1', '/api/health', '/downloads/guide.pdf'];
    for (const env of [
        { PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN },
        { PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN, PORTAL_REDIRECT_ENABLED: 'false' },
        { PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN, PORTAL_REDIRECT_ENABLED: '1', PORTAL_REDIRECT_SCOPE: 'pages' }
    ]) {
        for (const path of paths) {
            const response = resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}${path}`), env);
            assert.equal(response, null);
        }
    }
});

test('enabled + home scope (explicit and default) redirects / with 302 and preserves query', async () => {
    for (const scope of [undefined, 'home']) {
        const env = {
            PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
            PORTAL_REDIRECT_ENABLED: 'true',
            ...(scope ? { PORTAL_REDIRECT_SCOPE: scope } : {})
        };
        const response = resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/?ref=old&tab=1`), env);
        assert.ok(response instanceof Response);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('Location'), `${CANONICAL_ORIGIN}/?ref=old&tab=1`);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(await response.text(), '');

        const headResponse = resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/?a=1`, { method: 'HEAD' }), env);
        assert.ok(headResponse instanceof Response);
        assert.equal(headResponse.status, 302);
        assert.equal(headResponse.headers.get('Location'), `${CANONICAL_ORIGIN}/?a=1`);
    }
});

test('enabled + home scope does not redirect /basvurum/', () => {
    const env = {
        PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
        PORTAL_REDIRECT_ENABLED: 'true',
        PORTAL_REDIRECT_SCOPE: 'home'
    };
    assert.equal(resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/basvurum/`), env), null);
});

test('enabled + pages scope redirects /basvurum/?x=1 with 302 and preserves path + query', async () => {
    const env = {
        PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
        PORTAL_REDIRECT_ENABLED: 'true',
        PORTAL_REDIRECT_SCOPE: 'pages'
    };
    const response = resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/basvurum/?x=1`), env);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), `${CANONICAL_ORIGIN}/basvurum/?x=1`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), '');
});

test('/api/, /downloads/, /sw.js, /robots.txt, /sitemap.xml, and /manifest.json are never redirected on legacy host', () => {
    const env = {
        PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
        PORTAL_REDIRECT_ENABLED: 'true',
        PORTAL_REDIRECT_SCOPE: 'pages'
    };
    const excludedPaths = [
        '/api/',
        '/api/public/applications/current',
        '/downloads/',
        '/downloads/kilavuz.pdf',
        '/sw.js',
        '/robots.txt',
        '/sitemap.xml',
        '/manifest.json'
    ];
    for (const path of excludedPaths) {
        assert.equal(resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}${path}`), env), null);
    }
});

test('POST and other non-GET/HEAD methods are never redirected', () => {
    const env = {
        PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
        PORTAL_REDIRECT_ENABLED: 'true',
        PORTAL_REDIRECT_SCOPE: 'pages'
    };
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        assert.equal(resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/`, { method }), env), null);
        assert.equal(resolvePortalRedirect(new Request('https://www.topkapiunigoc.com/', { method }), env), null);
    }
});

test('other hosts including canonical host return null', () => {
    const env = {
        PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
        PORTAL_REDIRECT_ENABLED: 'true',
        PORTAL_REDIRECT_SCOPE: 'pages'
    };
    assert.equal(resolvePortalRedirect(new Request(`${CANONICAL_ORIGIN}/`), env), null);
    assert.equal(resolvePortalRedirect(new Request('https://example.com/'), env), null);
    assert.equal(resolvePortalRedirect(new Request('https://other.workers.dev/'), env), null);
});

test('www host redirects with 301 independently of enabled flag', async () => {
    for (const enabled of [undefined, 'false', 'true']) {
        const env = {
            PORTAL_CANONICAL_ORIGIN: CANONICAL_ORIGIN,
            ...(enabled !== undefined ? { PORTAL_REDIRECT_ENABLED: enabled } : {})
        };
        const response = resolvePortalRedirect(new Request('https://www.topkapiunigoc.com/basvurum/?x=1'), env);
        assert.ok(response instanceof Response);
        assert.equal(response.status, 301);
        assert.equal(response.headers.get('Location'), `${CANONICAL_ORIGIN}/basvurum/?x=1`);
        assert.equal(await response.text(), '');
    }
});

test('invalid canonical origin returns null', () => {
    const invalidOrigins = [
        undefined,
        '',
        'not-a-url',
        'http://topkapiunigoc.com',
        'https://user:pass@topkapiunigoc.com',
        'https://user@topkapiunigoc.com',
        'https://topkapiunigoc.com/path',
        'https://topkapiunigoc.com?q=1',
        'https://topkapiunigoc.com#hash',
        ' https://topkapiunigoc.com'
    ];
    for (const origin of invalidOrigins) {
        const env = {
            PORTAL_CANONICAL_ORIGIN: origin,
            PORTAL_REDIRECT_ENABLED: 'true',
            PORTAL_REDIRECT_SCOPE: 'pages'
        };
        assert.equal(resolvePortalRedirect(new Request(`${LEGACY_ORIGIN}/`), env), null);
        assert.equal(resolvePortalRedirect(new Request('https://www.topkapiunigoc.com/'), env), null);
    }
});
