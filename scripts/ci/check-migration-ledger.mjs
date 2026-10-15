import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const config = JSON.parse(await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
const database = config.env?.production?.d1_databases?.find(item => item.binding === 'DB');
assert.ok(token, 'CLOUDFLARE_API_TOKEN is required in the Production environment.');
assert.match(accountId || '', /^[a-f0-9]{32}$/, 'CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID.');
assert.ok(database?.database_id, 'Production D1 binding metadata is missing.');

let response;
try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database.database_id}/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sql: 'SELECT name FROM d1_migrations ORDER BY id' }),
        signal: AbortSignal.timeout(20_000)
    });
} catch {
    throw new Error('Read-only D1 migration-ledger query failed before a response was received.');
}
let body;
try { body = await response.json(); } catch { throw new Error('Cloudflare D1 API returned an invalid migration-ledger response.'); }
if (!response.ok || body.success !== true || !Array.isArray(body.result) || body.result.length !== 1 || body.result[0].success !== true) {
    const codes = Array.isArray(body.errors) ? body.errors.map(error => error.code).filter(Number.isInteger) : [];
    throw new Error(`Read-only D1 migration-ledger check denied (HTTP ${response.status}${codes.length ? `, error code ${codes.join(',')}` : ''}); no migration was run.`);
}

const applied = body.result[0].results?.map(row => row.name);
assert.ok(Array.isArray(applied) && applied.every(name => typeof name === 'string'), 'D1 migration ledger response did not contain migration names.');
const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const checkedIn = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
const normalizedApplied = [...applied].sort();
assert.deepEqual(normalizedApplied, checkedIn, 'Production D1 migration ledger differs from checked-in migrations; publication is blocked.');
console.log(`Production D1 migration ledger matches ${checkedIn.length} checked-in migrations. Read-only SELECT only; no migration or student rows were accessed.`);
