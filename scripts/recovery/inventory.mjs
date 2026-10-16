import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const api = 'https://api.cloudflare.com/client/v4';
const storageQuery = `query getR2StorageMetrics($accountTag: String, $filter: R2StorageAdaptiveGroupsFilter_InputObject) {
 viewer { accounts(filter: {accountTag: $accountTag}) {
 r2StorageAdaptiveGroups(limit: 1, filter: $filter, orderBy: [datetime_DESC]) {
 max { objectCount payloadSize metadataSize } dimensions { datetime }
 } } } }`;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function inventoryClient(account, token, fetchImpl = fetch) {
    assert.match(account || '', /^[a-f0-9]{32}$/); assert.ok(token, 'Inventory identity unavailable.');
    return async (path, variables) => {
        // No caller-supplied query, SQL, object content route, mutation or other host.
        const readPath = new RegExp(`^/accounts/${account}/(?:subscriptions|d1/database(?:\\?page=\\d+&per_page=100|/[a-f0-9-]{36}(?:/time_travel/bookmark)?)?|r2/(?:buckets(?:/[-a-z0-9]+(?:/(?:lifecycle|lock|domains/managed|domains/custom))?)?|metrics))$`);
        assert.ok((path === '/graphql' && variables?.accountTag === account) || (!variables && readPath.test(path)), 'Inventory route refused.');
        const response = await fetchImpl(`${api}${path}`, {
            method: variables ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            ...(variables ? { body: JSON.stringify({ query: storageQuery, variables }) } : {})
        });
        if (!response.ok) throw new Error(`INVENTORY_HTTP_${response.status}`);
        let body; try { body = await response.json(); } catch { throw new Error('INVENTORY_INVALID_RESPONSE'); }
        if (variables) {
            if (body.errors?.length) throw new Error('INVENTORY_METRICS_UNAVAILABLE');
            return body.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups?.[0] || null;
        }
        if (body.success !== true) throw new Error('INVENTORY_API_DENIED');
        return body.result;
    };
}

export async function collectInventory(request, account, production, now = Date.now()) {
    assert.equal(production.name, 'goc');
    const root = `/accounts/${account}`;
    const read = async work => {
        try { return { state: 'verified', value: await work() }; }
        catch (error) { return { state: 'unavailable', reason: /^INVENTORY_[A-Z0-9_]+$/.test(error.message) ? error.message : 'INVENTORY_UNAVAILABLE' }; }
    };
    const d1 = await read(async () => {
        const value = await request(`${root}/d1/database/${production.d1_databases[0].database_id}`);
        return { bytes: count(value.file_size), version: ['alpha', 'production'].includes(value.version) ? value.version : 'unknown' };
    });
    const timeTravel = await read(async () => {
        const value = await request(`${root}/d1/database/${production.d1_databases[0].database_id}/time_travel/bookmark`);
        assert.ok(value?.bookmark || value?.current_bookmark, 'Bookmark missing.');
        return { current_bookmark_available: true, retention_days: null }; // Current bookmark does not prove a 30-day plan.
    });
    const databases = await read(async () => {
        let page = 1, total = 0;
        for (;;) {
            const rows = await request(`${root}/d1/database?page=${page}&per_page=100`);
            assert.ok(Array.isArray(rows));
            total += rows.filter(item => item.uuid !== production.d1_databases[0].database_id).length;
            if (rows.length < 100) break;
            assert.ok(++page <= 100, 'Inventory pagination limit.');
        }
        return { non_production_resources: total, isolation_and_emptiness_verified: false };
    });
    const subscriptions = await read(async () => {
        const rows = await request(`${root}/subscriptions`);
        assert.ok(Array.isArray(rows));
        // Never publish billing identities, payment details or entire subscription objects.
        return { workers_plan: rows.some(row => /workers.*(?:paid|standard)/i.test(row.rate_plan?.public_name || '')) ? 'paid-indicated' : 'unknown' };
    });
    const buckets = [];
    for (const binding of production.r2_buckets) {
        const base = `${root}/r2/buckets/${binding.bucket_name}`;
        const metadata = await read(async () => {
            const value = await request(base);
            return { storage_class: ['Standard', 'InfrequentAccess'].includes(value.storage_class) ? value.storage_class : 'unknown' };
        });
        const metrics = await read(async () => {
            const value = await request('/graphql', { accountTag: account, filter: { bucketName: binding.bucket_name,
                datetime_geq: new Date(now - 86_400_000).toISOString(), datetime_leq: new Date(now).toISOString() } });
            const at = Date.parse(value?.dimensions?.datetime);
            assert.ok(Number.isFinite(at) && at <= now && now - at <= 86_400_000, 'Metrics stale or missing.');
            const bytes = count(value.max?.payloadSize), objects = count(value.max?.objectCount), metadataBytes = count(value.max?.metadataSize);
            assert.ok(bytes !== null && objects !== null && metadataBytes !== null);
            return { bytes, objects, metadata_bytes: metadataBytes, observed_at: new Date(at).toISOString(), exact_snapshot: false };
        });
        const lifecycle = await read(async () => {
            const value = await request(`${base}/lifecycle`); assert.ok(Array.isArray(value.rules));
            return { rule_count: value.rules.length, policy_sha256: hash(value.rules), deletion_policy_review_required: true };
        });
        const lock = await read(async () => {
            const value = await request(`${base}/lock`); assert.ok(Array.isArray(value.rules));
            return { rule_count: value.rules.length, policy_sha256: hash(value.rules) };
        });
        buckets.push({ binding: binding.binding, metadata, metrics, lifecycle, lock });
    }
    const available = await read(async () => {
        const value = await request(`${root}/r2/buckets`); assert.ok(Array.isArray(value.buckets));
        return { non_production_resources: value.buckets.filter(item => !production.r2_buckets.some(p => p.bucket_name === item.name)).length,
            private_and_isolated_verified: false };
    });
    return { schema: 1, observed_at: new Date(now).toISOString(), environment: 'production', metadata_only: true,
        d1, time_travel: timeTravel, subscriptions, databases, buckets, other_buckets: available,
        backup_operation_executed: false, deletion_policy_approved: false, print_exclusion_verified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        assert.equal(process.argv.length, 2);
        const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
        const account = process.env.CLOUDFLARE_ACCOUNT_ID;
        const result = await collectInventory(inventoryClient(account, process.env.CLOUDFLARE_API_TOKEN), account, config.env.production);
        console.log(JSON.stringify(result)); // Aggregate counts/hashes only; no object keys, rows or credentials.
        if (result.d1.state !== 'verified' || result.buckets.some(item => item.metrics.state !== 'verified')) process.exitCode = 1;
    } catch { console.error('Read-only inventory unavailable; no export, copy or resource change executed.'); process.exitCode = 1; }
}
