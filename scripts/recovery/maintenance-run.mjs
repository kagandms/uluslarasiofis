import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = 'kagandms/uluslarasiofis';
export async function selectMaintenanceRun(request) {
    // Query the latest run, INCLUDING failed/in-progress runs. Never pick an older green run.
    const result = await request(`/repos/${repo}/actions/workflows/recovery-preparation.yml/runs?branch=production&per_page=1`);
    const run = result.workflow_runs?.[0];
    assert.ok(run && Number.isSafeInteger(run.id) && run.id > 0
        && run.repository?.full_name === repo && run.head_branch === 'production'
        && run.path === '.github/workflows/recovery-preparation.yml'
        && ['workflow_dispatch', 'schedule'].includes(run.event)
        && run.status === 'completed' && run.conclusion === 'success', 'RECOVERY_LATEST_MAINTENANCE_NOT_SUCCESSFUL');
    const artifacts = await request(`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`);
    const matches = artifacts.artifacts?.filter(item => item.name === 'recovery-evidence');
    assert.ok(matches?.length === 1 && matches[0].expired === false
        && matches[0].size_in_bytes > 0 && matches[0].size_in_bytes <= 262_144, 'RECOVERY_METADATA_ARTIFACT_UNAVAILABLE');
    return run.id;
}

async function main() {
    try {
        const policy = JSON.parse(readFileSync(new URL('../../config/recovery-trust.json', import.meta.url), 'utf8'));
        assert.equal(policy.enabled, true, 'RECOVERY_POLICY_NOT_APPROVED');
        assert.equal(process.env.GITHUB_REPOSITORY, repo);
        assert.ok(process.env.GITHUB_TOKEN && process.env.GITHUB_OUTPUT);
        const id = await selectMaintenanceRun(async path => {
            const response = await fetch(`https://api.github.com${path}`, {
                headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
                signal: AbortSignal.timeout(20_000), redirect: 'error'
            });
            assert.ok(response.ok, 'RECOVERY_MAINTENANCE_METADATA_DENIED');
            return response.json();
        });
        appendFileSync(process.env.GITHUB_OUTPUT, `run_id=${id}\n`);
    } catch {
        console.error('Recovery metadata unavailable or policy unapproved; publication blocked. No recovery operation executed.');
        process.exitCode = 1;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
