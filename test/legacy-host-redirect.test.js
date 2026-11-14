import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyHostRedirectTarget, redirectLegacyHome } from '../src/public/legacyHostRedirect.js';

test('legacyHostRedirectTarget redirects legacy home page to canonical domain', () => {
    assert.equal(
        legacyHostRedirectTarget({
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/',
            search: '',
            hash: ''
        }),
        'https://topkapiunigoc.com/'
    );
    assert.equal(
        legacyHostRedirectTarget({
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/'
        }),
        'https://topkapiunigoc.com/'
    );
});

test('legacyHostRedirectTarget preserves query string and hash on legacy home', () => {
    assert.equal(
        legacyHostRedirectTarget({
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/',
            search: '?lang=en&ref=bookmark',
            hash: '#documents'
        }),
        'https://topkapiunigoc.com/?lang=en&ref=bookmark#documents'
    );
    assert.equal(
        legacyHostRedirectTarget({
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/',
            search: '?new=1',
            hash: ''
        }),
        'https://topkapiunigoc.com/?new=1'
    );
    assert.equal(
        legacyHostRedirectTarget({
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/',
            search: '',
            hash: '#guide'
        }),
        'https://topkapiunigoc.com/#guide'
    );
});

test('legacyHostRedirectTarget returns null for non-home paths on legacy host', () => {
    for (const pathname of ['/basvurum/', '/basvuru/', '/api/x', '/yetkili/', '/yazdir/']) {
        assert.equal(
            legacyHostRedirectTarget({
                hostname: 'goc.topkapiuni.workers.dev',
                pathname,
                search: '?a=1',
                hash: '#top'
            }),
            null
        );
    }
});

test('legacyHostRedirectTarget returns null for canonical, staging, and local hosts', () => {
    for (const hostname of ['topkapiunigoc.com', 'goc-staging.topkapiuni.workers.dev', 'localhost']) {
        assert.equal(
            legacyHostRedirectTarget({
                hostname,
                pathname: '/',
                search: '',
                hash: ''
            }),
            null
        );
    }
});

test('redirectLegacyHome calls location.replace once on legacy home and never otherwise', () => {
    const calls = [];
    const legacyWin = {
        location: {
            hostname: 'goc.topkapiuni.workers.dev',
            pathname: '/',
            search: '?lang=tr',
            hash: '#start',
            replace(url) {
                calls.push(url);
            }
        }
    };

    redirectLegacyHome(legacyWin);
    assert.deepEqual(calls, ['https://topkapiunigoc.com/?lang=tr#start']);

    const otherCases = [
        { hostname: 'goc.topkapiuni.workers.dev', pathname: '/basvurum/', search: '', hash: '' },
        { hostname: 'topkapiunigoc.com', pathname: '/', search: '', hash: '' },
        { hostname: 'goc-staging.topkapiuni.workers.dev', pathname: '/', search: '', hash: '' }
    ];
    for (const loc of otherCases) {
        const untouchedCalls = [];
        redirectLegacyHome({
            location: {
                ...loc,
                replace(url) {
                    untouchedCalls.push(url);
                }
            }
        });
        assert.deepEqual(untouchedCalls, []);
    }
});

test('redirectLegacyHome does not throw when window or location is missing', () => {
    assert.doesNotThrow(() => redirectLegacyHome(undefined));
    assert.doesNotThrow(() => redirectLegacyHome(null));
    assert.doesNotThrow(() => redirectLegacyHome({}));
    assert.doesNotThrow(() => redirectLegacyHome({ location: null }));
    assert.doesNotThrow(() =>
        redirectLegacyHome({
            location: {
                hostname: 'goc.topkapiuni.workers.dev',
                pathname: '/'
            }
        })
    );
});
