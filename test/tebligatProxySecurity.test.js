import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { callAppsScript } from '../api/_tebligat.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));

test('Apps Script proxy sends its credential in a server-side POST body', async () => {
    const originalFetch = globalThis.fetch;
    process.env.APPS_SCRIPT_URL = 'https://apps.example.test/exec';
    process.env.APPS_SCRIPT_API_KEY = 'test-only-api-key';
    let requestUrl;
    let requestOptions;
    globalThis.fetch = async (url, options) => {
        requestUrl = String(url);
        requestOptions = options;
        return { ok: true, status: 200, text: async () => '{"success":true}' };
    };

    try {
        const result = await callAppsScript('update', { sayfa: '01.01.2026', isim: 'Test', no: '1' });

        assert.deepEqual(result, { success: true });
        assert.equal(requestUrl, process.env.APPS_SCRIPT_URL);
        assert.equal(requestOptions.method, 'POST');
        assert.equal(requestOptions.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(requestOptions.body), {
            action: 'update',
            key: 'test-only-api-key',
            sayfa: '01.01.2026',
            isim: 'Test',
            no: '1'
        });
    } finally {
        globalThis.fetch = originalFetch;
        delete process.env.APPS_SCRIPT_URL;
        delete process.env.APPS_SCRIPT_API_KEY;
    }
});

test('Apps Script proxy rejects unknown actions and missing server configuration', async () => {
    const originalUrl = process.env.APPS_SCRIPT_URL;
    const originalKey = process.env.APPS_SCRIPT_API_KEY;
    delete process.env.APPS_SCRIPT_URL;
    delete process.env.APPS_SCRIPT_API_KEY;

    await assert.rejects(callAppsScript('deleteEverything'), /Unsupported Apps Script action/);
    await assert.rejects(callAppsScript('getAll'), /Server configuration/);

    if (originalUrl === undefined) delete process.env.APPS_SCRIPT_URL;
    else process.env.APPS_SCRIPT_URL = originalUrl;
    if (originalKey === undefined) delete process.env.APPS_SCRIPT_API_KEY;
    else process.env.APPS_SCRIPT_API_KEY = originalKey;
});

test('browser tebligat code uses same-origin APIs and contains no Apps Script endpoint or key', async () => {
    const source = await readFile(resolve(testDirectory, '../src/ui/tebligatSearch.js'), 'utf8');

    assert.match(source, /\/api\/get-all-tebligat/);
    assert.doesNotMatch(source, /script\.google\.com|APPS_SCRIPT_API_KEY|GIZLI_SIFRE_123/);
});

test('Apps Script GET endpoint cannot invoke mutations and POST dispatch is allowlisted', async () => {
    const source = await readFile(resolve(testDirectory, '../apps_script.txt'), 'utf8');
    const getHandler = source.match(/function doGet\(e\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    const postHandler = source.match(/function doPost\(e\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';

    assert.match(source, /PropertiesService\.getScriptProperties\(\)\.getProperty\(/);
    assert.doesNotMatch(source, /var\s+API_KEY\s*=/);
    assert.doesNotMatch(getHandler, /islem(?:Unmark|Add|Update|Remove)_/);
    assert.match(postHandler, /update|unmark|add|remove/);
    assert.match(postHandler, /getAll|search/);
});
