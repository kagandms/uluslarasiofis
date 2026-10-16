import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { artifactDryRunPlan } from './artifact-dry-run.mjs';
import { singleWorkerVersion } from './worker-version.mjs';
import { verifyCodeOnlyScope } from './code-only-scope.mjs';
import { cloudflareClient, readPreparedBundle, assetPlan, publishPrepared } from './worker-upload.mjs';
import { settingsSnapshot, assertStagedVersion } from './worker-settings.mjs';
import { checkReadOnlyHealth } from './post-deploy-healthcheck.mjs';

// One approved code/assets activation. Recovery maintenance is independent of this flow.
export async function releaseWithPorts(policy, context, io) {
    assert.equal(policy.enabled, true, 'PUBLICATION_LOCKED');
    assert.match(context.sha || '', /^[a-f0-9]{40}$/);
    await io.verifySource(); await io.verifyArtifact();
    await io.verifyScope(); await io.preflight(); await io.verifyLedger();
    const previous = await io.activeVersion();
    assert.equal(previous.id, context.approvedCurrentVersion, 'Active Worker changed since approved preflight.');
    assert.notEqual(previous.release_sha, context.sha, 'This source SHA is already published.');
    // Recheck HEAD and immutable bytes immediately before the single write. No automatic retries.
    await io.verifySource(); await io.verifyArtifact();
    const published = await io.publish(previous);
    const active = await io.activeVersion();
    assert.equal(active.id, published, 'Active version differs from the uploaded candidate.');
    assert.notEqual(active.id, previous.id, 'Published version could not be confirmed; do not retry automatically.');
    assert.equal(active.release_sha, context.sha, 'Published version/source annotation mismatch.');
    await io.verifyArtifact();
    try {
        await io.verifyPreservedSettings(); await io.preflight();
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
        assert.equal(policy.enabled, true, 'PUBLICATION_LOCKED');
        assert.equal(process.env.RELEASE_OPERATION, 'publish');
        assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
        assert.equal(process.env.GITHUB_ACTIONS, 'true');
        const sha = process.env.RELEASE_SHA, root = resolve(process.env.ARTIFACT_ROOT || '');
        assert.ok(process.env.ARTIFACT_ROOT && process.env.RUNNER_TEMP);
        assert.equal(process.env.GITHUB_REPOSITORY, 'kagandms/uluslarasiofis');
        assert.equal(process.env.GITHUB_REF, 'refs/heads/production');
        const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
        const args = artifactDryRunPlan(root, { ...config.env.production, compatibility_date: config.compatibility_date });
        assert.equal(readFileSync(join(root, 'candidate-sha.txt'), 'utf8').trim(), sha);
        const node = (script, args = [], extraEnv = {}) => {
            const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], { stdio: 'inherit', timeout: 120_000, env: { ...process.env, ...extraEnv } });
            assert.ok(!result.error && result.status === 0, 'Release guard stopped.');
        };
        const api = cloudflareClient(process.env.CLOUDFLARE_ACCOUNT_ID, process.env.CLOUDFLARE_API_TOKEN);
        const getSettings = () => api('/workers/scripts/goc/settings');
        let beforeSettings;
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
            verifyScope() { verifyCodeOnlyScope(policy.code_only_baseline_sha, sha); },
            async verifyPreservedSettings() { assert.deepEqual(settingsSnapshot(await getSettings()), settingsSnapshot(beforeSettings), 'Worker settings changed; stop and inspect.'); },
            async activeVersion() {
                const id = singleWorkerVersion(await api('/workers/scripts/goc/deployments'));
                const version = await api(`/workers/scripts/goc/versions/${id}`);
                const message = version.annotations?.['workers/message'] || '';
                const handlers = version.resources?.script?.handlers;
                assert.ok(Array.isArray(handlers) && handlers.includes('fetch') && handlers.includes('scheduled'), 'Live Worker handler metadata unavailable.');
                return { id, handlers, release_sha: /^release:[a-f0-9]{40}$/.test(message) ? message.slice(8) : null };
            },
            async publish(previous) {
                beforeSettings = await getSettings();
                const out = mkdtempSync(join(process.env.RUNNER_TEMP, 'worker-package-'));
                try {
                    // Local serialization only. No rebuild, network, secrets file, or remote Wrangler invocation.
                    const file = join(out, 'worker.multipart');
                    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
                        ...args, '--outfile', file, '--outdir', join(out, 'modules')], {
                        cwd: root, stdio: 'pipe', timeout: 120_000,
                        env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_API_KEY: '', CLOUDFLARE_EMAIL: '',
                            CF_API_TOKEN: '', CF_API_KEY: '', CF_EMAIL: '', CLOUDFLARE_ENV: '',
                            WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' }
                    });
                    assert.ok(!result.error && result.status === 0, 'Local artifact serialization failed.');
                    const bundle = await readPreparedBundle(readFileSync(file), root);
                    return await publishPrepared({ bundle, plan: assetPlan(root), settings: beforeSettings, sha, activeVersion: previous.id, api,
                        beforeActivation: async id => {
                            node('./check-release-sha.mjs');
                            node('./candidate-artifact.mjs', ['verify', sha, root]);
                            assert.equal(singleWorkerVersion(await api('/workers/scripts/goc/deployments')), previous.id, 'Active Worker changed during staging.');
                            assert.deepEqual(settingsSnapshot(await getSettings()), settingsSnapshot(beforeSettings));
                            const version = await api(`/workers/scripts/goc/versions/${id}`);
                            assertStagedVersion(version, previous, beforeSettings, sha);
                            node('./cloudflare-preflight.mjs', [], { EXPECTED_STAGED_WORKER_VERSION: id }); node('./check-migration-ledger.mjs');
                            const fetched = spawnSync('git', ['fetch', '--no-tags', 'origin', 'production'], { stdio: 'pipe', timeout: 30_000 });
                            assert.equal(fetched.status, 0); node('./check-release-sha.mjs');
                        }
                    });
                } finally { rmSync(out, { recursive: true, force: true }); }
            },
            health: () => checkReadOnlyHealth(),
            record(result) {
                const manifest_sha256 = createHash('sha256').update(readFileSync(join(root, 'candidate-artifact.json'))).digest('hex');
                writeFileSync(join(process.env.RUNNER_TEMP, 'release-result.json'), JSON.stringify({ ...result, manifest_sha256, at: new Date().toISOString() }), { mode: 0o600 });
                const summary = `Worker: goc | source: ${result.sha} | active version: ${result.version} | previous: ${result.previous_version} | health: ${result.health} | manifest SHA-256: ${manifest_sha256}`;
                console.log(summary);
                if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
            }
        });
    } catch (error) {
        if (/^Cloudflare request (?:denied|failed)/.test(error.message)) console.error(error.message);
        console.error('Publication blocked, failed or uncertain. Inspect live version before another attempt. No automatic retry, migration, restore or rollback.'); process.exitCode = 1;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
