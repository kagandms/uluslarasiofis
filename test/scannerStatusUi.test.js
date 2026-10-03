import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

test('staff scanner panel exposes backlog, stale host and controlled failed-job retry', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    const retries = [];
    const api = {
        readStatus: async () => ({ jobs: [{ status: 'queued', count: 3 }, { status: 'leased', count: 1 }],
            runners: [{ runner_id: 'mac', health: 'ready', seen_at: '2026-01-01T00:00:00.000Z', signature_updated_at: '2026-01-01T00:00:00.000Z' }],
            last_successful_scan: null, failed_jobs: [{ id: 'job-id', result_code: 'scan_timeout', attempts: 3 }] }),
        retry: async (jobId) => { retries.push(jobId); }
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /4/);
    assert.match(root.textContent, /çevrimdışı|bayat/);
    const retry = root.querySelector('[data-action="retry-scan"]');
    retry.click();
    assert.equal(retry.disabled, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(retries, ['job-id']);
    document.defaultView.close();
});

test('staff scanner panel does not offer replay for deterministic unsupported content', async () => {
    const module = await import('../src/staff/scanner-manager.js');
    const document = new JSDOM('<section></section>').window.document;
    const root = document.querySelector('section');
    const retries = [];
    const api = {
        readStatus: async () => ({ jobs: [], runners: [], last_successful_scan: null,
            failed_jobs: [{ id: 'job-unsupported', result_code: 'unsupported_content', attempts: 1 }] }),
        retry: async (jobId) => { retries.push(jobId); }
    };
    module.initializeScannerManager(root, api);

    root.querySelector('[data-action="refresh-scanner"]').click();
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.textContent, /replacement akışından yüklemeli/i);
    assert.equal(root.querySelector('[data-action="retry-scan"]'), null);
    assert.deepEqual(retries, []);
    document.defaultView.close();
});
