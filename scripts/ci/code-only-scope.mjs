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

export function verifyCronReleaseScope(baseline, sha, git = args => {
    const result = spawnSync('git', args, { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, 'Cron release scope could not be established.');
    return result.stdout;
}) {
    assert.match(baseline || '', /^[a-f0-9]{40}$/);
    assert.match(sha || '', /^[a-f0-9]{40}$/);
    git(['merge-base', '--is-ancestor', baseline, sha]);
    const changed = git(['diff', '--name-only', baseline, sha, '--', ...protectedPaths]).trim().split('\n').filter(Boolean);
    assert.deepEqual(changed, ['wrangler.jsonc'], 'Cron release may change only the reviewed Worker cron configuration.');

    const readConfig = revision => JSON.parse(git(['show', `${revision}:wrangler.jsonc`]));
    const baselineConfig = readConfig(baseline);
    const releaseConfig = readConfig(sha);
    assert.deepEqual(releaseConfig.triggers?.crons, ['*/5 * * * *'], 'Cron release must retain the reviewed five-minute trigger.');
    assert.deepEqual(releaseConfig.env?.production?.triggers?.crons, ['*/5 * * * *'], 'Production must use the reviewed five-minute trigger.');
    assert.deepEqual(releaseConfig.env?.staging?.triggers?.crons, [], 'Staging must not gain Cron Triggers.');

    const withoutReviewedCrons = config => {
        const copy = structuredClone(config);
        delete copy.triggers?.crons;
        delete copy.env?.production?.triggers?.crons;
        return copy;
    };
    assert.deepEqual(withoutReviewedCrons(releaseConfig), withoutReviewedCrons(baselineConfig),
        'Cron release may change only the top-level and production cron arrays.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const policy = JSON.parse(readFileSync(new URL('../../config/production-publication.json', import.meta.url), 'utf8'));
    if (process.env.RELEASE_OPERATION === 'cron-release') {
        verifyCronReleaseScope(policy.code_only_baseline_sha, process.env.RELEASE_SHA);
        console.log('Cron release scope verified; only the reviewed cron arrays differ from baseline.');
    } else {
        verifyCodeOnlyScope(policy.code_only_baseline_sha, process.env.RELEASE_SHA);
        console.log('Code-only release scope verified against the reviewed schema and configuration baseline.');
    }
}
