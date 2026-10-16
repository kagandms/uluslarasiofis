import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { assertWorkerSettings } from './worker-settings.mjs';
import { singleWorkerVersion } from './worker-version.mjs';
import { assertProductionRuntimeSecretMetadata } from './runtime-secret-metadata.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token, 'CLOUDFLARE_API_TOKEN is required in the Production environment.');
assert.match(accountId || '', /^[a-f0-9]{32}$/, 'CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.');

const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const production = config.env?.production;
assert.equal(production?.name, 'goc', 'Production Worker name must remain goc.');
const api = 'https://api.cloudflare.com/client/v4';

async function cloudflare(path) {
    let response;
    try {
        response = await fetch(`${api}${path}`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(20_000)
        });
    } catch {
        throw new Error('Cloudflare API request failed before a response was received.');
    }
    let body;
    try { body = await response.json(); } catch { throw new Error('Cloudflare API returned an invalid response.'); }
    if (!response.ok || body.success !== true) {
        const codes = Array.isArray(body.errors) ? body.errors.map(error => error.code).filter(Number.isInteger) : [];
        throw new Error(`Cloudflare read-only preflight denied (HTTP ${response.status}${codes.length ? `, error code ${codes.join(',')}` : ''}); check the token's account scope and read permissions.`);
    }
    return body.result;
}

const verified = await cloudflare('/user/tokens/verify');
assert.equal(verified.status, 'active', 'Cloudflare API token is not active.');

// Successful account-scoped metadata reads prove that the configured account is reachable.
const workerPath = `/accounts/${accountId}/workers/scripts/${encodeURIComponent(production.name)}`;
const [settings, schedules, secrets] = await Promise.all([
    cloudflare(`${workerPath}/settings`),
    cloudflare(`${workerPath}/schedules`),
    cloudflare(`${workerPath}/secrets`)
]);

assertWorkerSettings(settings, production, config.compatibility_date);
const bindings = settings.bindings || [];
const byName = new Map(bindings.map(binding => [binding.name, binding]));
for (const binding of [
    { name: 'DB', type: 'd1', database_id: production.d1_databases[0].database_id },
    ...production.r2_buckets.map(item => ({ name: item.binding, type: 'r2_bucket', bucket_name: item.bucket_name }))
]) {
    const actual = byName.get(binding.name);
    assert.ok(actual, `Required production binding ${binding.name} is missing.`);
    for (const [key, value] of Object.entries(binding)) {
        if (key === 'name') continue;
        assert.equal(actual[key], value, `Production binding ${binding.name} does not match the reviewed configuration.`);
    }
}
for (const [name, value] of Object.entries(production.vars || {})) {
    const actual = byName.get(name);
    assert.equal(actual?.type, 'plain_text', `Production configuration variable metadata is missing: ${name}.`);
    assert.equal(actual?.text, value, `Production configuration variable differs from the reviewed configuration: ${name}.`);
}

const expectedCrons = [...(production.triggers?.crons || [])].sort();
const actualCrons = (schedules?.schedules || []).map(item => item.cron).sort();
assert.deepEqual(actualCrons, expectedCrons, 'Production cron schedules differ from the reviewed configuration.');

const actualSecrets = assertProductionRuntimeSecretMetadata(secrets, production.secrets?.required || []);

// Pin the currently active version before publication; reject gradual deployments.
const version = singleWorkerVersion(await cloudflare(`${workerPath}/deployments`));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `current_version=${version}\n`);

console.log(`Cloudflare preflight passed for account scope, Worker ${production.name}, D1/R2 bindings, ${actualCrons.length} cron schedules, and ${actualSecrets.length} runtime secret names/types. Secret values were not requested or logged.`);
