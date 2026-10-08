import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';

const BLOCKED_ENDPOINTS = [
    ['/api/public/print/upload-intents', 'POST'],
    ['/api/public/print/jobs/job-1/finalize', 'POST'],
    ['/api/printer/claim', 'POST'],
    ['/api/printer/jobs/job-1/content', 'GET'],
    ['/api/printer/jobs/job-1/validation-result', 'POST'],
    ['/api/printer/jobs/job-1/submission-started', 'POST'],
    ['/api/printer/future-action', 'POST'],
    ['/api/public/print/future-action', 'POST']
];

for (const value of [undefined, 'false', '', 'TRUE', ' true ', true, 1]) {
    test(`print gate rejects work without side effects for ${JSON.stringify(value)}`, async () => {
        const environment = { PRINT_ENABLED: value };
        for (const [pathname, method] of BLOCKED_ENDPOINTS) {
            const request = new Request(`https://portal.test${pathname}`, { method });

            const response = await worker.fetch(request, environment);

            assert.equal(response.status, 503, pathname);
            assert.equal((await response.json()).error.code, 'PRINT_DISABLED', pathname);
        }
    });
}

test('disabled public status is available without database or storage bindings', async () => {
    const request = new Request('https://portal.test/api/public/print/status');

    const response = await worker.fetch(request, { PRINT_ENABLED: 'false' });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).available, false);
});

test('explicit true permits route authorization to run', async () => {
    const request = new Request('https://portal.test/api/printer/claim', { method: 'POST' });

    const response = await worker.fetch(request, { PRINT_ENABLED: 'true' });

    assert.equal((await response.json()).error.code, 'PRINTER_UNAVAILABLE');
});

for (const pathname of ['/api/printer/heartbeat', '/api/printer/reconcile', '/api/printer/jobs/job-1/result']) {
    test(`disabled printing retains authenticated recovery endpoint ${pathname}`, async () => {
        const request = new Request(`https://portal.test${pathname}`);

        const response = await worker.fetch(request, { PRINT_ENABLED: 'false' });

        assert.equal((await response.json()).error.code, 'PRINTER_UNAVAILABLE');
    });
}
