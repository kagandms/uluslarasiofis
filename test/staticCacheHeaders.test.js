import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const headersText = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

function parseHeadersFile(source) {
    const rules = [];
    let current = null;

    for (const rawLine of source.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        if (!/^\s/.test(rawLine)) {
            assert.ok(trimmed.startsWith('/'), `Rule path must start with "/": ${trimmed}`);
            current = { path: trimmed, headers: new Map() };
            rules.push(current);
            continue;
        }

        assert.ok(current, `Header line appeared before any path rule: ${rawLine}`);
        const colonIndex = trimmed.indexOf(':');
        assert.ok(colonIndex > 0, `Invalid header line: ${rawLine}`);
        const name = trimmed.slice(0, colonIndex).trim().toLowerCase();
        const value = trimmed.slice(colonIndex + 1).trim();
        assert.ok(value.length > 0, `Empty header value for ${name}`);
        current.headers.set(name, value);
    }

    return rules;
}

function ruleMatchesPath(pattern, requestPath) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(requestPath);
}

test('public/_headers keeps existing global security headers without global Cache-Control', () => {
    const rules = parseHeadersFile(headersText);
    const paths = rules.map((rule) => rule.path);
    assert.equal(paths.length, new Set(paths).size, 'Duplicate path rules in public/_headers');

    const globalRule = rules.find((rule) => rule.path === '/*');
    assert.ok(globalRule, 'Missing /* rule');
    assert.equal(globalRule.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(globalRule.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(globalRule.headers.has('cache-control'), false, '/* must not set Cache-Control');
});

test('public/_headers configures expected cache lifetimes for hashed assets, fonts, and root images', () => {
    const rules = parseHeadersFile(headersText);
    const byPath = new Map(rules.map((rule) => [rule.path, rule.headers]));

    assert.equal(byPath.get('/assets/*')?.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(byPath.get('/pdfjs-support/*')?.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(byPath.get('/fonts/*')?.get('cache-control'), 'public, max-age=604800');

    const oneDayImages = [
        '/logo_tr_dark.png',
        '/logo_tr_transparent.png',
        '/goc_logo.png',
        '/topkapi_logo.jpg',
        '/header_logo.jpg',
        '/icon-192.png',
        '/icon-512.png',
        '/icon.png',
        '/apple-touch-icon.png',
        '/favicon-48x48.png',
        '/favicon-96x96.png',
        '/favicon.ico'
    ];

    for (const imagePath of oneDayImages) {
        assert.equal(
            byPath.get(imagePath)?.get('cache-control'),
            'public, max-age=86400',
            `Expected 1-day Cache-Control for ${imagePath}`
        );
    }
});

test('public/_headers never applies Cache-Control to HTML pages, metadata files, APIs, or document directories', () => {
    const rules = parseHeadersFile(headersText);
    const cachedRules = rules.filter((rule) => rule.headers.has('cache-control'));

    const uncachedPaths = [
        '/',
        '/index.html',
        '/basvuru',
        '/basvuru/',
        '/basvuru/index.html',
        '/basvurum',
        '/basvurum/',
        '/basvurum/index.html',
        '/basvuruya-devam-et',
        '/basvuruya-devam-et/',
        '/basvuruya-devam-et/index.html',
        '/yazdir',
        '/yazdir/',
        '/yazdir/index.html',
        '/yetkili',
        '/yetkili/',
        '/yetkili/index.html',
        '/mobile-transfer',
        '/mobile-transfer/',
        '/mobile-transfer/index.html',
        '/guide',
        '/guide/',
        '/guide/index.html',
        '/documents/',
        '/documents/sample.pdf',
        '/downloads/',
        '/downloads/file.zip',
        '/manifest.json',
        '/sitemap.xml',
        '/robots.txt',
        '/api/health'
    ];

    for (const targetPath of uncachedPaths) {
        const matching = cachedRules.filter((rule) => ruleMatchesPath(rule.path, targetPath));
        assert.deepEqual(matching, [], `Unexpected Cache-Control rule(s) matching ${targetPath}`);
    }
});
