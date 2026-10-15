import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadOnlyHealth, PRODUCTION_ORIGIN } from '../scripts/ci/post-deploy-healthcheck.mjs';

const guard = fileURLToPath(new URL('../scripts/ci/check-release-sha.mjs', import.meta.url));
const artifactGuard = fileURLToPath(new URL('../scripts/ci/candidate-artifact.mjs', import.meta.url));
const backupGuard = fileURLToPath(new URL('../scripts/ci/check-backup-evidence.mjs', import.meta.url));
const rollbackGuard = fileURLToPath(new URL('../scripts/ci/check-rollback-evidence.mjs', import.meta.url));

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

test('release artifact manifest binds all built files to one exact source SHA', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-artifact-'));
    const dist = join(root, 'dist');
    const sha = 'a'.repeat(40);
    try {
        mkdirSync(join(dist, 'assets'), { recursive: true });
        writeFileSync(join(dist, 'index.html'), '<main>candidate</main>');
        writeFileSync(join(dist, 'assets', 'app.js'), 'export default 1;');
        const run = (...args) => spawnSync(process.execPath, [artifactGuard, ...args], { cwd: root, encoding: 'utf8' });
        assert.equal(run('create', sha).status, 0);
        assert.equal(run('verify', sha).status, 0);
        assert.notEqual(run('verify', 'b'.repeat(40)).status, 0);
        writeFileSync(join(dist, 'index.html'), '<main>modified</main>');
        assert.notEqual(run('verify', sha).status, 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('production backup evidence requires a fresh backup and recent successful restore drill', () => {
    const root = mkdtempSync(join(tmpdir(), 'backup-evidence-'));
    const evidencePath = join(root, 'evidence.json');
    const now = Date.parse('2026-10-15T12:00:00Z');
    const evidence = {
        environment: 'production',
        backup_id: 'backup-20261015-abc123',
        backup_verified_at: '2026-10-15T11:30:00Z',
        coverage: { d1_snapshot: true, d1_sql_export: true, r2_objects: true },
        restore_drill: {
            verified_at: '2026-10-01T11:30:00Z',
            evidence_ref: 'a'.repeat(64),
            result: 'passed',
            coverage: { d1: true, r2: true }
        }
    };
    try {
        writeFileSync(evidencePath, JSON.stringify(evidence));
        const run = () => spawnSync(process.execPath, [backupGuard, evidencePath], {
            encoding: 'utf8', env: { ...process.env, EVIDENCE_NOW: new Date(now).toISOString() }
        });
        assert.equal(run().status, 0);
        evidence.backup_verified_at = '2026-10-08T00:00:00Z';
        writeFileSync(evidencePath, JSON.stringify(evidence));
        assert.notEqual(run().status, 0, 'stale backup must block publication');
        evidence.backup_verified_at = '2026-10-15T11:30:00Z';
        evidence.restore_drill.result = 'failed';
        writeFileSync(evidencePath, JSON.stringify(evidence));
        assert.notEqual(run().status, 0, 'failed restore drill must block publication');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('rollback evidence requires fresh schema, secret, binding and cron compatibility checks', () => {
    const root = mkdtempSync(join(tmpdir(), 'rollback-evidence-'));
    const evidencePath = join(root, 'evidence.json');
    const now = Date.parse('2026-10-15T12:00:00Z');
    const evidence = {
        environment: 'production',
        verified_at: '2026-10-15T11:30:00Z',
        current_version_id: 'current-version-123',
        rollback_version_id: 'rollback-version-123',
        evidence_ref: 'b'.repeat(64),
        result: 'passed',
        compatibility: { schema: true, runtime_secrets: true, d1_r2_bindings: true, cron_schedules: true }
    };
    try {
        writeFileSync(evidencePath, JSON.stringify(evidence));
        const run = () => spawnSync(process.execPath, [rollbackGuard, evidencePath], {
            encoding: 'utf8', env: { ...process.env, EVIDENCE_NOW: new Date(now).toISOString() }
        });
        assert.equal(run().status, 0);
        evidence.compatibility.cron_schedules = false;
        writeFileSync(evidencePath, JSON.stringify(evidence));
        assert.notEqual(run().status, 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('post-deploy health check uses only fixed public GET routes and rejects any other host', async () => {
    const requests = [];
    const fakeFetch = async (url, options) => {
        requests.push({ url: url.toString(), options });
        return { status: 200, redirected: false };
    };
    await checkReadOnlyHealth(fakeFetch);
    assert.equal(requests.length, 6);
    assert.ok(requests.every(({ url, options }) => new URL(url).origin === PRODUCTION_ORIGIN
        && options.method === 'GET' && options.redirect === 'manual'));
    await assert.rejects(checkReadOnlyHealth(fakeFetch, 'https://attacker.example'));
    await assert.rejects(checkReadOnlyHealth(async () => ({ status: 503, redirected: false })));
});

test('production release workflow stays manual, serialized, environment-gated and publication-locked', () => {
    const workflow = readFileSync(new URL('../.github/workflows/production-release.yml', import.meta.url), 'utf8');
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(workflow, /^  workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/m);
    assert.match(workflow, /group: production-release\s+cancel-in-progress: false/);
    assert.match(workflow, /environment: Production[\s\S]*secrets\.CLOUDFLARE_API_TOKEN/);
    assert.match(workflow, /scripts\/ci\/check-backup-evidence\.mjs/);
    assert.match(workflow, /scripts\/ci\/check-rollback-evidence\.mjs/);
    assert.match(workflow, /publication remains locked/);
    assert.doesNotMatch(workflow, /wrangler deploy --env production(?! --dry-run)/);
    assert.doesNotMatch(workflow, /d1 migrations apply .*--remote/);
    assert.match(ci, /candidate-artifact\.mjs create/);
    assert.match(ci, /candidate-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});
