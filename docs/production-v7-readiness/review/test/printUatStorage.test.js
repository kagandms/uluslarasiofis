import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { reservePrintUatSlot, readPrintUatJobId } from '../src/server/repositories/d1/print-uat-repository.js';

test('local Workers R2 condition prevents replayed or racing UAT uploads from replacing the fixture', async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("local test"); } };',
        compatibilityDate: '2026-10-01', r2Buckets: ['PRINT_FILES'] }));
    const fixture = new Uint8Array([37, 80, 68, 70, 45]);

    try {
        const bucket = await runtime.getR2Bucket('PRINT_FILES');
        const writes = await Promise.all([1, 2].map(() => bucket.put('print/local-fixture', fixture, {
            onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/pdf' }
        })));

        assert.equal(writes.filter(Boolean).length, 1);
        const stored = await bucket.get('print/local-fixture');
        assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), fixture);
    } finally {
        await runtime.dispose();
    }
});

test('native local D1 preserves one persistent UAT reservation across racing sessions and job cleanup', async () => {
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("local test"); } };',
        compatibilityDate: '2026-10-01', d1Databases: ['DB'] }));

    try {
        const database = await runtime.getD1Database('DB');
        await database.exec(`CREATE TABLE audit_events (id TEXT PRIMARY KEY, event_type TEXT, actor_type TEXT,
            request_id TEXT, safe_metadata_json TEXT, created_at TEXT);`.replaceAll('\n', ' '));
        const now = new Date().toISOString();
        const claims = await Promise.all([1, 2, 3, 4].map((number) => reservePrintUatSlot(database, {
            jobId: `local-job-${number}`, now
        })));

        assert.equal(claims.filter(Boolean).length, 1);
        assert.match(await readPrintUatJobId(database), /^local-job-[1-4]$/);
        assert.equal(await reservePrintUatSlot(database, { jobId: 'second-job', now }), false);
    } finally {
        await runtime.dispose();
    }
});
