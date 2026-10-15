import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Preparation only: no publish option exists. A real deploy requires a separate reviewed change.
export function artifactDryRunPlan(root, reviewed) {
    const config = resolve(root, 'dist/uluslarasiofis_local/wrangler.json');
    const c = JSON.parse(readFileSync(config, 'utf8'));
    assert.equal(c.name, 'goc'); assert.equal(c.targetEnvironment, 'production');
    assert.equal(c.main, 'index.js'); assert.equal(c.no_bundle, true);
    assert.equal(c.build, undefined); assert.equal(c.env, undefined);
    assert.equal(c.assets?.directory, '../client');
    assert.equal(c.assets.binding, 'ASSETS'); assert.equal(c.assets.not_found_handling, '404-page');
    assert.deepEqual(c.migrations, []); assert.deepEqual(c.durable_objects?.bindings, []);
    for (const field of ['vars', 'triggers', 'secrets', 'r2_buckets', 'd1_databases']) {
        const actual = structuredClone(c[field]);
        const expected = structuredClone(reviewed[field]);
        if (field === 'd1_databases') {
            // Vite relocates the directory, but deploy must NEVER apply these migrations.
            actual.forEach(item => { assert.equal(item.migrations_dir, '../../migrations'); delete item.migrations_dir; });
            expected.forEach(item => { delete item.migrations_dir; });
        }
        assert.deepEqual(actual, expected, `Artifact production ${field} differs from reviewed configuration.`);
    }
    assert.equal(c.compatibility_date, reviewed.compatibility_date);
    return ['deploy', '--config', config, '--no-bundle', '--dry-run'];
}

export function runArtifactDryRun() {
    assert.equal(process.argv.length, 2, 'No publish or remote arguments accepted.');
    const root = resolve(process.env.ARTIFACT_ROOT || '');
    assert.ok(process.env.ARTIFACT_ROOT, 'Downloaded artifact root is required.');
    const sha = process.env.RELEASE_SHA;
    assert.match(sha || '', /^[a-f0-9]{40}$/);
    assert.equal(readFileSync(join(root, 'candidate-sha.txt'), 'utf8').trim(), sha);
    const guard = fileURLToPath(new URL('./candidate-artifact.mjs', import.meta.url));
    const run = (cli, args, options = {}) => {
        const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', timeout: 120_000, ...options });
        assert.ok(!result.error && result.status === 0, 'Artifact preparation stopped.');
    };
    run(guard, ['verify', sha, root]);
    const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
    const args = artifactDryRunPlan(root, { ...config.env.production, compatibility_date: config.compatibility_date });
    const out = mkdtempSync(join(tmpdir(), 'candidate-dry-run-'));
    run(fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url)), [...args, '--outdir', out], {
        cwd: root, env: { ...process.env, CLOUDFLARE_ENV: '', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' }
    });
    run(guard, ['verify', sha, root]);
    console.log('Exact-artifact dry run passed without rebuilding; publication remains locked.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runArtifactDryRun();
