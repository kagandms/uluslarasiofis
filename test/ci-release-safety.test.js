import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('../scripts/ci/check-release-sha.mjs', import.meta.url));

test('release SHA guard rejects another repository, dispatch branch, input or checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-guard-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
        git('init', '--initial-branch=production');
        git('-c', 'user.name=Synthetic CI', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-m', 'synthetic');
        const sha = git('rev-parse', 'HEAD');
        git('update-ref', 'refs/remotes/origin/production', sha);
        const env = { ...process.env, GITHUB_REPOSITORY: 'kagandms/uluslarasiofis', GITHUB_REF: 'refs/heads/production', GITHUB_SHA: sha, RELEASE_SHA: sha };
        const run = overrides => spawnSync(process.execPath, [guard], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
        assert.equal(run({}).status, 0);
        for (const overrides of [
            { GITHUB_REPOSITORY: 'someone/fork' },
            { GITHUB_REF: 'refs/heads/work' },
            { GITHUB_SHA: '0'.repeat(40) },
            { RELEASE_SHA: sha.slice(0, 7) },
            { RELEASE_SHA: `$(echo ${sha})` },
            { RELEASE_SHA: '0'.repeat(40) }
        ]) assert.notEqual(run(overrides).status, 0, JSON.stringify(overrides));
        git('-c', 'user.name=Synthetic CI', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-m', 'next synthetic');
        const next = git('rev-parse', 'HEAD');
        assert.notEqual(run({ RELEASE_SHA: next, GITHUB_SHA: next }).status, 0, 'A newer checkout cannot use stale production approval');
        git('update-ref', 'refs/remotes/origin/production', next);
        assert.equal(run({ RELEASE_SHA: next, GITHUB_SHA: next }).status, 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
