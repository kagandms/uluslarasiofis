import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
            signal: AbortSignal.timeout(20_000)
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

const expectedSecretNames = [
    'APPS_SCRIPT_API_KEY', 'APPS_SCRIPT_URL', 'AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY',
    'PRINTER_SECRET', 'PRINT_R2_ACCESS_KEY_ID', 'PRINT_R2_SECRET_ACCESS_KEY',
    'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_SECRET_ACCESS_KEY', 'SCANNER_SECRET', 'STAFF_BOOTSTRAP_TOKEN'
].sort();
const actualSecrets = (Array.isArray(secrets) ? secrets : secrets?.secrets || [])
    .map(secret => ({ name: secret.name, type: secret.type }))
    .sort((left, right) => left.name.localeCompare(right.name));
assert.deepEqual(actualSecrets.map(secret => secret.name), expectedSecretNames, 'Production runtime secret metadata differs from the reviewed baseline.');
for (const requiredName of production.secrets?.required || []) {
    const secret = actualSecrets.find(item => item.name === requiredName);
    assert.equal(secret?.type, 'secret_text', `Required production secret metadata is missing or has the wrong type: ${requiredName}.`);
}

console.log(`Cloudflare preflight passed for account scope, Worker ${production.name}, D1/R2 bindings, ${actualCrons.length} cron schedules, and ${actualSecrets.length} runtime secret names/types. Secret values were not requested or logged.`);
