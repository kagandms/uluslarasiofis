import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS_VERIFIED_ON, USAGE_METRICS } from '../src/server/services/cloudflare-usage-limits.js';
import { readCloudflareUsage } from '../src/server/services/cloudflare-usage-metrics.js';
import worker from '../src/server/worker.js';

const environment = (options = {}) => ({ D1_ANALYTICS_ACCOUNT_ID: 'account-id', D1_ANALYTICS_API_TOKEN: 'analytics-token', ...options });

function memoryCache() {
    const cached = new Map();
    return {
        async match(key) { return cached.get(key.url)?.clone() || null; },
        async put(key, response) { cached.set(key.url, response.clone()); },
        cached
    };
}

function fakeFetcher({ failing = [] } = {}) {
    const calls = [];
    const fetcher = async (_url, request) => {
        calls.push(request);
        const { query } = JSON.parse(request.body);
        const wrap = (field, groups) => failing.includes(field)
            ? Response.json({ errors: [{ message: 'denied' }] })
            : Response.json({ data: { viewer: { accounts: [{ [field]: groups }] } } });
        if (query.includes('workersInvocationsAdaptive')) return wrap('workersInvocationsAdaptive', [{ sum: { requests: 1234 } }]);
        if (query.includes('d1AnalyticsAdaptiveGroups')) return wrap('d1AnalyticsAdaptiveGroups', [
            { dimensions: { databaseId: 'database-production' }, sum: { rowsRead: 2400, rowsWritten: 300 } },
            { dimensions: { databaseId: 'database-staging' }, sum: { rowsRead: 3600, rowsWritten: 200 } }
        ]);
        if (query.includes('d1StorageAdaptiveGroups')) return wrap('d1StorageAdaptiveGroups', [
            { dimensions: { databaseId: 'database-production' }, max: { databaseSizeBytes: 1000 } },
            { dimensions: { databaseId: 'database-staging' }, max: { databaseSizeBytes: 500 } }
        ]);
        if (query.includes('r2OperationsAdaptiveGroups')) return wrap('r2OperationsAdaptiveGroups', [
            { dimensions: { actionType: 'PutObject' }, sum: { requests: 4 } },
            { dimensions: { actionType: 'ListObjects' }, sum: { requests: 6 } },
            { dimensions: { actionType: 'GetObject' }, sum: { requests: 40 } },
            { dimensions: { actionType: 'DeleteObject' }, sum: { requests: 99 } }
        ]);
        return wrap('r2StorageAdaptiveGroups', [
            { dimensions: { bucketName: 'docs', datetime: '2026-11-08T10:00:00Z' }, max: { payloadSize: 900, metadataSize: 100 } },
            { dimensions: { bucketName: 'docs', datetime: '2026-11-07T10:00:00Z' }, max: { payloadSize: 1, metadataSize: 1 } }
        ]);
    };
    return { fetcher, calls };
}

test('catalog keeps the reviewed free-tier limits and order', () => {
    assert.deepEqual(USAGE_METRICS.map((m) => m.key), [
        'workers_requests', 'd1_rows_read', 'd1_rows_written', 'd1_largest_db_bytes',
        'd1_total_bytes', 'r2_class_a', 'r2_class_b', 'r2_storage_bytes'
    ]);
    assert.equal(USAGE_METRICS.find((m) => m.key === 'd1_rows_written').limit, 100000);
    for (const metric of USAGE_METRICS) {
        assert.ok(Number.isSafeInteger(metric.limit) && metric.limit > 0);
        assert.ok(['day', 'month', 'now'].includes(metric.period));
    }
    assert.match(LIMITS_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/);
});

test('returns every catalog metric in catalog order with values from separate datasets', async () => {
    const { fetcher, calls } = fakeFetcher();
    const usage = await readCloudflareUsage({ environment: environment(), fetcher });
    const byKey = Object.fromEntries(usage.metrics.map((m) => [m.key, m]));
    assert.deepEqual(usage.metrics.map((m) => m.key), USAGE_METRICS.map((m) => m.key));
    assert.equal(byKey.workers_requests.value, 1234);
    assert.equal(byKey.d1_rows_read.value, 6000);
    assert.equal(byKey.d1_rows_written.value, 500);
    assert.equal(byKey.d1_largest_db_bytes.value, 1000);
    assert.equal(byKey.d1_total_bytes.value, 1500);
    assert.equal(byKey.r2_class_a.value, 10);
    assert.equal(byKey.r2_class_b.value, 40);
    assert.equal(byKey.r2_storage_bytes.value, 1000);
    assert.ok(usage.metrics.every((m) => m.status === 'ok'));
    assert.equal(calls.length, 5);
    for (const call of calls) {
        assert.equal(call.headers.Authorization, 'Bearer analytics-token');
        assert.equal(JSON.parse(call.body).variables.accountTag, 'account-id');
    }
});

test('one failing dataset marks only its metrics unavailable', async () => {
    const { fetcher } = fakeFetcher({ failing: ['workersInvocationsAdaptive'] });
    const usage = await readCloudflareUsage({ environment: environment(), fetcher });
    const workers = usage.metrics.find((m) => m.key === 'workers_requests');
    assert.equal(workers.status, 'unavailable');
    assert.equal(workers.value, null);
    assert.equal(usage.metrics.filter((m) => m.status === 'ok').length, 7);
});

test('missing token throws USAGE_METRICS_UNAVAILABLE without calling fetch', async () => {
    await assert.rejects(
        readCloudflareUsage({ environment: environment({ D1_ANALYTICS_API_TOKEN: '' }), fetcher: () => assert.fail('fetch called') }),
        (error) => error.status === 503 && error.code === 'USAGE_METRICS_UNAVAILABLE'
    );
});

test('caches per UTC date and never touches a database', async () => {
    const { fetcher, calls } = fakeFetcher();
    const cache = memoryCache();
    const env = environment();
    Object.defineProperty(env, 'DB', { get() { assert.fail('DB accessed'); } });
    await readCloudflareUsage({ environment: env, cache, fetcher });
    await readCloudflareUsage({ environment: env, cache, fetcher });
    assert.equal(calls.length, 5);
    assert.match([...cache.cached.keys()][0], /^https:\/\/portal-cache\.invalid\/cloudflare-usage\/\d{4}-\d{2}-\d{2}$/);
});

test('usage endpoint requires a staff session and rejects non-GET', async () => {
    const post = await worker.fetch(new Request('https://portal.test/api/staff/admin/usage', { method: 'POST' }), {});
    assert.equal(post.status, 405);
    const get = await worker.fetch(new Request('https://portal.test/api/staff/admin/usage'), { DB: {}, ...environment() });
    assert.equal(get.status, 401);
    assert.equal((await get.json()).error.code, 'UNAUTHORIZED');
});
