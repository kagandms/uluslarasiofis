import { ApiError } from '../domain/errors.js';
import { R2_CLASS_A_ACTIONS, R2_CLASS_B_ACTIONS, USAGE_METRICS } from './cloudflare-usage-limits.js';

const ANALYTICS_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const CACHE_TTL_SECONDS = 300;

const WORKERS_QUERY = `query WorkersRequests($accountTag: string!, $start: string, $end: string) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
      sum { requests }
    }
  } }
}`;
const D1_OPERATIONS_QUERY = `query D1Rows($accountTag: string!, $date: Date) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) {
      sum { rowsRead rowsWritten }
      dimensions { databaseId }
    }
  } }
}`;
// Field names for the storage dataset are not shown on the D1 metrics page; unverified until checked on staging.
const D1_STORAGE_QUERY = `query D1Storage($accountTag: string!, $date: Date) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $date, date_leq: $date }) {
      max { databaseSizeBytes }
      dimensions { databaseId }
    }
  } }
}`;
const R2_OPERATIONS_QUERY = `query R2Operations($accountTag: string!, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
      sum { requests }
      dimensions { actionType }
    }
  } }
}`;
const R2_STORAGE_QUERY = `query R2Storage($accountTag: string!, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }, orderBy: [datetime_DESC]) {
      max { payloadSize metadataSize }
      dimensions { datetime bucketName }
    }
  } }
}`;

/**
 * Reads free-plan usage for Workers, D1 and R2 from Cloudflare analytics. Never touches D1.
 * @param {object} options Worker environment, optional edge cache, and injectable fetch.
 * @returns {Promise<{date: string, month: string, retrievedAt: string, metrics: Array<object>}>} Usage snapshot in catalog order.
 * @throws {ApiError} When analytics credentials are missing.
 */
export async function readCloudflareUsage({ environment, cache, fetcher = fetch }) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const month = date.slice(0, 7);
    const cacheKey = new Request(`https://portal-cache.invalid/cloudflare-usage/${date}`);
    try {
        const cachedResponse = await cache?.match(cacheKey);
        if (cachedResponse) return await cachedResponse.json();
    } catch (error) {
        console.error('Cloudflare usage cache read failed.', { errorName: error?.name || 'UnknownError' });
    }

    const accountId = environment.D1_ANALYTICS_ACCOUNT_ID;
    const apiToken = environment.D1_ANALYTICS_API_TOKEN;
    if (!accountId || !apiToken) throw metricsUnavailable();

    const run = (query, variables) => runQuery({ query, variables: { accountTag: accountId, ...variables }, apiToken, fetcher });
    const dayStart = `${date}T00:00:00Z`;
    const monthStart = `${month}-01T00:00:00Z`;
    const nowIso = now.toISOString();
    const storageStart = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const [workers, d1Operations, d1Storage, r2Operations, r2Storage] = await Promise.allSettled([
        run(WORKERS_QUERY, { start: dayStart, end: nowIso }).then(parseWorkers),
        run(D1_OPERATIONS_QUERY, { date }).then(parseD1Operations),
        run(D1_STORAGE_QUERY, { date }).then(parseD1Storage),
        run(R2_OPERATIONS_QUERY, { start: monthStart, end: nowIso }).then(parseR2Operations),
        run(R2_STORAGE_QUERY, { start: storageStart, end: nowIso }).then(parseR2Storage)
    ]);
    const value = (result, pick) => (result.status === 'fulfilled' ? pick(result.value) : undefined);
    const results = {
        workers_requests: value(workers, (v) => ({ value: v })),
        d1_rows_read: value(d1Operations, (v) => ({ value: v.read.total, detail: v.read.detail })),
        d1_rows_written: value(d1Operations, (v) => ({ value: v.written.total, detail: v.written.detail })),
        d1_largest_db_bytes: value(d1Storage, (v) => ({ value: v.largest, detail: v.detail })),
        d1_total_bytes: value(d1Storage, (v) => ({ value: v.total })),
        r2_class_a: value(r2Operations, (v) => ({ value: v.classA })),
        r2_class_b: value(r2Operations, (v) => ({ value: v.classB })),
        r2_storage_bytes: value(r2Storage, (v) => ({ value: v }))
    };
    const snapshot = {
        date,
        month,
        retrievedAt: now.toISOString(),
        metrics: USAGE_METRICS.map(({ key, limit, period }) => {
            const result = results[key];
            const entry = { key, value: result ? result.value : null, limit, period, status: result ? 'ok' : 'unavailable' };
            if (result?.detail?.length) entry.detail = result.detail;
            return entry;
        })
    };
    try {
        await cache?.put(cacheKey, new Response(JSON.stringify(snapshot), {
            headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
        }));
    } catch (error) {
        console.error('Cloudflare usage cache write failed.', { errorName: error?.name || 'UnknownError' });
    }
    return snapshot;
}

async function runQuery({ query, variables, apiToken, fetcher }) {
    const response = await fetcher(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw metricsUnavailable();
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || payload.errors?.length) throw metricsUnavailable();
    const account = payload.data?.viewer?.accounts?.[0];
    if (!account) throw metricsUnavailable();
    return account;
}

function safeCount(candidate) {
    if (!Number.isSafeInteger(candidate) || candidate < 0) throw metricsUnavailable();
    return candidate;
}

function groupsOf(account, dataset) {
    const groups = account[dataset];
    if (!Array.isArray(groups)) throw metricsUnavailable();
    return groups;
}

function parseWorkers(account) {
    return groupsOf(account, 'workersInvocationsAdaptive').reduce((total, group) => total + safeCount(group?.sum?.requests), 0);
}

function parseD1Operations(account) {
    const read = new Map();
    const written = new Map();
    for (const group of groupsOf(account, 'd1AnalyticsAdaptiveGroups')) {
        const databaseId = group?.dimensions?.databaseId;
        if (typeof databaseId !== 'string' || !databaseId.trim()) throw metricsUnavailable();
        read.set(databaseId, (read.get(databaseId) || 0) + safeCount(group.sum?.rowsRead));
        written.set(databaseId, (written.get(databaseId) || 0) + safeCount(group.sum?.rowsWritten));
    }
    return { read: summarize(read), written: summarize(written) };
}

function parseD1Storage(account) {
    const sizes = new Map();
    for (const group of groupsOf(account, 'd1StorageAdaptiveGroups')) {
        const databaseId = group?.dimensions?.databaseId;
        if (typeof databaseId !== 'string' || !databaseId.trim()) throw metricsUnavailable();
        sizes.set(databaseId, Math.max(sizes.get(databaseId) || 0, safeCount(group.max?.databaseSizeBytes)));
    }
    const { total, detail } = summarize(sizes);
    return { total, detail, largest: Math.max(0, ...sizes.values()) };
}

function parseR2Operations(account) {
    let classA = 0;
    let classB = 0;
    for (const group of groupsOf(account, 'r2OperationsAdaptiveGroups')) {
        const count = safeCount(group?.sum?.requests);
        const action = group.dimensions?.actionType;
        if (R2_CLASS_A_ACTIONS.includes(action)) classA += count;
        else if (R2_CLASS_B_ACTIONS.includes(action)) classB += count;
    }
    return { classA, classB };
}

function parseR2Storage(account) {
    const latest = new Map();
    for (const group of groupsOf(account, 'r2StorageAdaptiveGroups')) {
        const bucket = group?.dimensions?.bucketName ?? '';
        const datetime = group?.dimensions?.datetime;
        if (typeof datetime !== 'string') throw metricsUnavailable();
        const bytes = safeCount(group.max?.payloadSize) + safeCount(group.max?.metadataSize);
        if (!latest.has(bucket) || datetime > latest.get(bucket).datetime) latest.set(bucket, { datetime, bytes });
    }
    return [...latest.values()].reduce((total, entry) => total + entry.bytes, 0);
}

function summarize(byDatabase) {
    const detail = [...byDatabase.entries()]
        .map(([databaseId, value]) => ({ name: databaseId.slice(0, 8), value }))
        .sort((left, right) => right.value - left.value);
    return { total: detail.reduce((sum, entry) => sum + entry.value, 0), detail };
}

function metricsUnavailable() {
    return new ApiError(503, 'USAGE_METRICS_UNAVAILABLE', 'Kullanım bilgisi şu anda alınamıyor.', true);
}
