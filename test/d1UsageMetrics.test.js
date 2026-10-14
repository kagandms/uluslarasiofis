import assert from 'node:assert/strict';
import test from 'node:test';
import { readD1UsageMetrics } from '../src/server/services/d1-usage-metrics.js';
import worker from '../src/server/worker.js';

function createEnvironment(options = {}) {
    return { D1_ANALYTICS_ACCOUNT_ID: 'account-id', D1_ANALYTICS_API_TOKEN: 'analytics-token', ...options };
}

test('daily D1 usage sums account-wide database groups and caches the snapshot', async () => {
    let requestCount = 0;
    const cached = new Map();
    const cache = {
        async match(key) { return cached.get(key.url)?.clone() || null; },
        async put(key, response) { cached.set(key.url, response.clone()); }
    };
    const fetcher = async (_url, request) => {
        requestCount += 1;
        assert.equal(request.headers.Authorization, 'Bearer analytics-token');
        const requestBody = JSON.parse(request.body);
        assert.equal(requestBody.variables.accountTag, 'account-id');
        assert.match(requestBody.variables.date, /^\d{4}-\d{2}-\d{2}$/);
        return Response.json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [
            { sum: { rowsRead: 2400 } }, { sum: { rowsRead: 3600 } }
        ] }] } } });
    };

    const first = await readD1UsageMetrics({ environment: createEnvironment(), cache, fetcher });
    const second = await readD1UsageMetrics({ environment: createEnvironment(), cache, fetcher });

    assert.equal(first.rowsRead, 6000);
    assert.equal(first.limit, 5_000_000);
    assert.equal(second.rowsRead, 6000);
    assert.equal(requestCount, 1);
});

test('daily D1 usage fails closed when analytics credentials are missing', async () => {
    await assert.rejects(
        readD1UsageMetrics({ environment: createEnvironment({ D1_ANALYTICS_API_TOKEN: '' }), fetcher: fetch }),
        (error) => error.status === 503 && error.code === 'USAGE_METRICS_UNAVAILABLE'
    );
});

test('daily D1 usage rejects incomplete Cloudflare analytics results', async () => {
    await assert.rejects(
        readD1UsageMetrics({
            environment: createEnvironment(),
            fetcher: async () => Response.json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [
                { sum: { rowsRead: -1 } }
            ] }] } } })
        }),
        (error) => error.status === 503 && error.code === 'USAGE_METRICS_UNAVAILABLE'
    );
});

test('staff D1 usage endpoint enforces GET without entering print authorization', async () => {
    const response = await worker.fetch(new Request('https://portal.test/api/staff/admin/d1-usage', { method: 'POST' }), {});

    assert.equal(response.status, 405);
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
});

test('staff D1 usage endpoint rejects unauthenticated analytics access', async () => {
    const response = await worker.fetch(new Request('https://portal.test/api/staff/admin/d1-usage'), {
        DB: {}, D1_ANALYTICS_ACCOUNT_ID: 'account-id', D1_ANALYTICS_API_TOKEN: 'analytics-token'
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});
