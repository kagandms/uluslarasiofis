import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { artifactDryRunPlan } from './artifact-dry-run.mjs';
import { singleWorkerVersion } from './worker-version.mjs';
import { checkReadOnlyHealth } from './post-deploy-healthcheck.mjs';

// Workflow still exits unconditionally before this step; the independent code policy is also false.
export async function releaseWithPorts(policy, context, io) {
    assert.equal(policy.enabled, true, 'PUBLICATION_LOCKED');
    assert.match(context.sha || '', /^[a-f0-9]{40}$/);
    await io.verifySource(); await io.verifyArtifact();
    await io.preflight(); await io.verifyLedger(); await io.verifyRecovery();
    const previous = await io.activeVersion();
    assert.equal(previous.id, context.approvedCurrentVersion, 'Active Worker changed since approved preflight.');
    assert.notEqual(previous.release_sha, context.sha, 'This source SHA is already published.');
    // Recheck HEAD and immutable bytes immediately before the single write. No automatic retries.
    await io.verifySource(); await io.verifyArtifact();
    await io.publish();
    const active = await io.activeVersion();
    assert.notEqual(active.id, previous.id, 'Published version could not be confirmed; do not retry automatically.');
    assert.equal(active.release_sha, context.sha, 'Published version/source annotation mismatch.');
    await io.verifyArtifact();
    try {
        await io.health();
    } catch (error) {
        await io.record({ sha: context.sha, previous_version: previous.id, version: active.id, health: 'failed' });
        throw error; // No rollback, migration, restore or print job replay.
    }
    await io.record({ sha: context.sha, previous_version: previous.id, version: active.id, health: 'passed' });
}

async function main() {
    try {
        assert.equal(process.argv.length, 2);
        const policy = JSON.parse(readFileSync(new URL('../../config/production-publication.json', import.meta.url), 'utf8'));
        assert.equal(policy.enabled, true, 'PUBLICATION_LOCKED'); // Before reading credentials or invoking any command.
        const sha = process.env.RELEASE_SHA, root = resolve(process.env.ARTIFACT_ROOT || '');
        assert.ok(process.env.ARTIFACT_ROOT && process.env.RUNNER_TEMP);
        assert.equal(process.env.GITHUB_REPOSITORY, 'kagandms/uluslarasiofis');
        assert.equal(process.env.GITHUB_REF, 'refs/heads/production');
        const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
        const args = artifactDryRunPlan(root, { ...config.env.production, compatibility_date: config.compatibility_date });
        assert.equal(readFileSync(join(root, 'candidate-sha.txt'), 'utf8').trim(), sha);
        const node = (script, args = []) => {
            const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { stdio: 'inherit', timeout: 120_000 });
            assert.ok(!result.error && result.status === 0, 'Release guard stopped.');
        };
        const account = process.env.CLOUDFLARE_ACCOUNT_ID;
        assert.match(account || '', /^[a-f0-9]{32}$/);
        const api = async path => {
            const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/goc${path}`, {
                headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(20_000)
            });
            assert.ok(response.ok, 'Worker version metadata unavailable.');
            const body = await response.json(); assert.equal(body.success, true); return body.result;
        };
        await releaseWithPorts(policy, { sha, approvedCurrentVersion: process.env.CURRENT_WORKER_VERSION }, {
            verifySource() {
                const fetched = spawnSync('git', ['fetch', '--no-tags', 'origin', 'production'], { stdio: 'pipe', timeout: 30_000 });
                assert.equal(fetched.status, 0, 'Production HEAD refresh failed.');
                node('./check-release-sha.mjs');
            },
            verifyArtifact() {
                node('./candidate-artifact.mjs', ['verify', sha, root]);
                const expected = ['package-lock.json', 'wrangler.jsonc'].map(name =>
                    `${createHash('sha256').update(readFileSync(new URL(`../../${name}`, import.meta.url))).digest('hex')}  ${name}\n`).join('');
                assert.equal(readFileSync(join(root, 'candidate-config.sha256'), 'utf8'), expected, 'Artifact config checksum mismatch.');
            },
            preflight() { node('./cloudflare-preflight.mjs'); node('../check-production-print-secrets.mjs'); },
            verifyLedger() { node('./check-migration-ledger.mjs'); },
            verifyRecovery() {
                assert.ok(process.env.RECOVERY_EVIDENCE_PATH);
                node('./check-backup-evidence.mjs', [process.env.RECOVERY_EVIDENCE_PATH]);
                node('./check-rollback-evidence.mjs', [process.env.RECOVERY_EVIDENCE_PATH]);
            },
            async activeVersion() {
                const id = singleWorkerVersion(await api('/deployments'));
                const version = await api(`/versions/${id}`);
                const message = version.annotations?.['workers/message'] || '';
                return { id, release_sha: /^release:[a-f0-9]{40}$/.test(message) ? message.slice(8) : null };
            },
            publish() {
                // Same flattened config and no-bundle inputs proven by CI. No npm/Vite build or migrations.
                const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
                    ...args.filter(arg => arg !== '--dry-run'), '--keep-vars', '--message', `release:${sha}`], {
                    cwd: root, stdio: 'pipe', timeout: 120_000,
                    env: { ...process.env, CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false' }
                });
                // Do not print provider output, signed URLs, or unreviewed error payloads. Never retry.
                assert.ok(!result.error && result.status === 0, 'Publication failed or is uncertain; inspect metadata before another attempt.');
            },
            health: () => checkReadOnlyHealth(),
            record(result) {
                const manifest_sha256 = createHash('sha256').update(readFileSync(join(root, 'candidate-artifact.json'))).digest('hex');
                writeFileSync(join(process.env.RUNNER_TEMP, 'release-result.json'), JSON.stringify({ ...result, manifest_sha256, at: new Date().toISOString() }), { mode: 0o600 });
            }
        });
    } catch { console.error('Publication locked, blocked, failed or uncertain. No automatic retry, migration, restore or rollback.'); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
