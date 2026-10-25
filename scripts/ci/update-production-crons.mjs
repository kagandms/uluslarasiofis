import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflareClient } from './worker-upload.mjs';
import { singleWorkerVersion } from './worker-version.mjs';
import { assertProductionCronTransition } from './cron-preflight.mjs';

export async function updateProductionCronSchedules({ api, target, evidence, now = Date.now(), expectedReleaseSha = null }) {
    const deployments = await api('/workers/scripts/goc/deployments');
    const activeVersion = singleWorkerVersion(deployments);
    const version = await api(`/workers/scripts/goc/versions/${activeVersion}`);
    const message = version.annotations?.['workers/message'] || '';
    const activeSha = /^release:[a-f0-9]{40}$/.test(message) ? message.slice(8) : null;
    const schedules = await api('/workers/scripts/goc/schedules');
    const current = (schedules?.schedules || []).map(entry => entry.cron);
    assertProductionCronTransition(current, target, evidence, activeVersion, activeSha, now, expectedReleaseSha);
    const response = await api('/workers/scripts/goc/schedules', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target.map(cron => ({ cron })))
    });
    assertCronList(response?.schedules, target, 'Cloudflare did not confirm the exact cron target.');
    const verified = await api('/workers/scripts/goc/schedules');
    assertCronList(verified?.schedules, target, 'Cron update read-back mismatch.');
    return { activeVersion, schedules: [...target] };
}

function assertCronList(entries, target, message) {
    const actual = (entries || []).map(entry => entry.cron);
    assert.deepEqual([...actual].sort(), [...target].sort(), message);
}

async function main() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    assert.equal(process.env.RELEASE_OPERATION, 'cron-update');
    assert.ok(process.env.RELEASE_SHA);
    const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
    const evidence = JSON.parse(readFileSync(new URL('../../docs/production-only-evidence/cron-transition-baseline.json', import.meta.url), 'utf8'));
    const api = cloudflareClient(accountId, token);
    const target = config.env.production.triggers.crons;
    const result = await updateProductionCronSchedules({ api, target, evidence, expectedReleaseSha: process.env.RELEASE_SHA });
    console.log(`Production cron triggers updated and read back (${result.schedules.length} schedules); Worker version and application data were not changed.`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Production cron triggers verified: ${[...result.schedules].sort().join(', ')}\nWorker version: ${result.activeVersion}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
