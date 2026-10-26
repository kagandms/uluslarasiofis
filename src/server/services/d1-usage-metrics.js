import { ApiError } from '../domain/errors.js';

export const D1_DAILY_ROWS_READ_LIMIT = 5_000_000;
const ANALYTICS_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const CACHE_TTL_SECONDS = 300;

/**
 * Reads the account-wide D1 rows-read metric for the current UTC day.
 * @param {object} options Worker environment, optional edge cache, and injectable fetch.
 * @returns {Promise<{rowsRead: number, databases: Array<{databaseId: string, rowsRead: number}>, limit: number, date: string, retrievedAt: string}>} Current usage snapshot.
 * @throws {ApiError} When analytics configuration or Cloudflare metrics are unavailable.
 */
export async function readD1UsageMetrics({ environment, cache, fetcher = fetch }) {
    const date = new Date().toISOString().slice(0, 10);
    const cacheKey = new Request(`https://portal-cache.invalid/d1-usage/${date}`);
    try {
        const cachedResponse = await cache?.match(cacheKey);
        if (cachedResponse) return await cachedResponse.json();
    } catch (error) {
        console.error('D1 usage cache read failed.', { errorName: error?.name || 'UnknownError' });
    }

    const accountId = environment.D1_ANALYTICS_ACCOUNT_ID;
    const apiToken = environment.D1_ANALYTICS_API_TOKEN;
    if (!accountId || !apiToken) throw metricsUnavailable();

    const usage = await queryRowsRead({ accountId, apiToken, date, fetcher });
    const metrics = { ...usage, limit: D1_DAILY_ROWS_READ_LIMIT, date, retrievedAt: new Date().toISOString() };
    try {
        await cache?.put(cacheKey, new Response(JSON.stringify(metrics), {
            headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` }
        }));
    } catch (error) {
        console.error('D1 usage cache write failed.', { errorName: error?.name || 'UnknownError' });
    }
    return metrics;
}

async function queryRowsRead({ accountId, apiToken, date, fetcher }) {
    let responsePayload;
    try {
        const response = await fetcher(ANALYTICS_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: D1_ROWS_READ_QUERY, variables: { accountTag: accountId, date } }),
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) throw metricsUnavailable();
        responsePayload = await response.json();
    } catch {
        throw metricsUnavailable();
    }
    if (!responsePayload || typeof responsePayload !== 'object' || responsePayload.errors?.length) throw metricsUnavailable();
    const groups = responsePayload.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
    if (!Array.isArray(groups)) throw metricsUnavailable();
    const databaseTotals = new Map();
    const rowCounts = groups.map(({ dimensions, sum }) => {
        const databaseId = dimensions?.databaseId;
        const count = sum?.rowsRead;
        if (typeof databaseId !== 'string' || !databaseId.trim() || !Number.isSafeInteger(count) || count < 0) {
            throw metricsUnavailable();
        }
        databaseTotals.set(databaseId, (databaseTotals.get(databaseId) || 0) + count);
        return count;
    });
    const total = rowCounts.reduce((sum, count) => sum + count, 0);
    if (!Number.isSafeInteger(total)) throw metricsUnavailable();
    const databases = [...databaseTotals.entries()]
        .map(([databaseId, rowsRead]) => ({ databaseId, rowsRead }))
        .sort((left, right) => left.databaseId.localeCompare(right.databaseId));
    return { rowsRead: total, databases };
}

function metricsUnavailable() {
    return new ApiError(503, 'USAGE_METRICS_UNAVAILABLE', 'Kullanım bilgisi şu anda alınamıyor.', true);
}

const D1_ROWS_READ_QUERY = `query D1DailyRowsRead($accountTag: string!, $date: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $date, date_leq: $date }
      ) {
        sum { rowsRead }
        dimensions { databaseId }
      }
    }
  }
}`;
