import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Changing these requires a separate reviewed data/configuration approval and baseline update.
export const protectedPaths = ['wrangler.jsonc', 'migrations', 'scripts/ci/runtime-secret-metadata.mjs'];
export function verifyCodeOnlyScope(baseline, sha, git = args => {
    const result = spawnSync('git', args, { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, 'Code-only scope could not be established.');
    return result.stdout;
}) {
    assert.match(baseline || '', /^[a-f0-9]{40}$/);
    assert.match(sha || '', /^[a-f0-9]{40}$/);
    git(['merge-base', '--is-ancestor', baseline, sha]);
    assert.equal(git(['diff', '--name-only', baseline, sha, '--', ...protectedPaths]).trim(), '',
        'Schema/storage/secret/Worker configuration change requires separate explicit approval; normal release stopped.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const policy = JSON.parse(readFileSync(new URL('../../config/production-publication.json', import.meta.url), 'utf8'));
    verifyCodeOnlyScope(policy.code_only_baseline_sha, process.env.RELEASE_SHA);
    console.log('Code-only release scope verified against the reviewed schema and configuration baseline.');
}
