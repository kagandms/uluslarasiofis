import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digest, verifyRecoveryEvidence } from '../scripts/recovery/evidence.mjs';
import { runSyntheticRestore } from '../scripts/recovery/synthetic-restore.mjs';
import { verifyRestoredObject } from '../scripts/recovery/restore-checks.mjs';
import { contractFromMetadata } from '../scripts/recovery/contract.mjs';
import { artifactDryRunPlan } from '../scripts/ci/artifact-dry-run.mjs';
import { selectMaintenanceRun } from '../scripts/recovery/maintenance-run.mjs';
import { singleWorkerVersion } from '../scripts/ci/worker-version.mjs';

// Only synthetic scopes and one ephemeral in-memory test key. No production receipts.
function fixture() {
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    const at = minutes => new Date(now + minutes * 60_000).toISOString();
    const pair = generateKeyPairSync('ed25519');
    const source = { environment: 'synthetic-test', repository: 'synthetic/recovery', worker: 'synthetic', account_id: 'a'.repeat(32),
        database_id: randomUUID(), document_bucket: 'synthetic-documents', print_bucket: 'synthetic-print' };
    const context = { source, releaseSha: 'a'.repeat(40), currentVersion: randomUUID(), runId: '12345' };
    const policy = { schema: 2, enabled: true, minimum_retention_hours: 24,
        signer: { producer_sha: 'b'.repeat(40), public_key: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString() },
        vault: { id: randomUUID(), account_id: 'c'.repeat(32), bucket: 'synthetic-vault' },
        restore_target: { account_id: 'b'.repeat(32), database_id: randomUUID(), document_bucket: 'synthetic-restored-docs', print_bucket: 'synthetic-restored-print' } };
    const contract = Object.fromEntries(['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars', 'worker', 'assets'].map(field => [field, digest(field)]));
    const recovery = digest({ schema: contract.schema, migrations: contract.migrations, format: 2, producer_sha: policy.signer.producer_sha });
    const payload = { schema: 2, source, producer_sha: policy.signer.producer_sha, run_id: '12345',
        backup: { id: randomUUID(), captured_at: at(-30), verified_at: at(-28), contract: recovery,
            bookmark_sha256: digest('synthetic-bookmark'), sql_sha256: digest('synthetic-sql'), sql_bytes: 100,
            manifest_sha256: digest('synthetic-manifest'), archive_sha256: digest('synthetic-ciphertext'), archive_bytes: 200,
            storage_receipt_sha256: digest('synthetic-storage-receipt'), vault_id: policy.vault.id, retention_until: at(2880),
            consistency_report_sha256: digest('synthetic-consistency'),
            documents: { objects: 1, bytes: 12, manifest_sha256: digest('synthetic-docs') },
            print_files: { objects: 1, bytes: 12, manifest_sha256: digest('synthetic-print') } },
        restore: { backup_id: randomUUID(), contract: recovery, manifest_sha256: digest('older-tested-backup'),
            started_at: at(-20_010), completed_at: at(-20_000), target: { ...policy.restore_target },
            report_sha256: digest('synthetic-restore-report'), side_effects: 'disabled',
            checks: Object.fromEntries(['sql_integrity', 'foreign_keys', 'schema', 'migration_ledger', 'row_counts', 'object_hashes', 'object_metadata', 'references', 'no_external_effects'].map(key => [key, true])) },
        rollback: { release_sha: context.releaseSha, current_version_id: context.currentVersion, target_version_id: randomUUID(), verified_at: at(-8),
            current_contract: { ...contract }, target_contract: { ...contract, worker: digest('synthetic-old-worker'), assets: digest('synthetic-old-assets') },
            report_sha256: digest('synthetic-compatibility-report'), checks: { application_contract: true, print_scanner_contract: true, no_job_replay: true } }
    };
    const bundle = { payload, signature: '' };
    const resign = () => { bundle.signature = sign(null, Buffer.from(canonical(payload)), pair.privateKey).toString('base64'); };
    resign();
    return { now, at, policy, context, bundle, payload, resign, run: (mode = 'rollback') => verifyRecoveryEvidence(bundle, policy, context, now, mode) };
}

test('one maintenance signer and an older periodic drill cover a different fresh backup of the same contract', () => {
    const f = fixture();
    assert.notEqual(f.payload.backup.id, f.payload.restore.backup_id);
    assert.deepEqual(f.run(), { verified: true, mode: 'rollback' });
    f.payload.rollback = null; f.resign();
    assert.equal(f.run('backup').verified, true);
    assert.throws(() => f.run(), /RECOVERY_/);
});

test('unsigned, modified, untrusted, wrong source and wrong producer evidence fails', () => {
    for (const mutate of [
        f => { f.bundle.signature = ''; }, f => { f.payload.backup.sql_bytes++; },
        f => { f.policy.signer.public_key = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString(); },
        f => { f.payload.producer_sha = 'c'.repeat(40); f.resign(); }
    ]) { const f = fixture(); mutate(f); assert.throws(() => f.run(), /RECOVERY_/); }
    for (const field of Object.keys(fixture().context.source)) {
        const f = fixture(); f.payload.source = { ...f.context.source, [field]: 'wrong-source' }; f.resign();
        assert.throws(() => f.run(), /WRONG_SOURCE/);
    }
});

test('signed incomplete, stale, future, failed and unsafe backup/restore records fail closed', () => {
    for (const mutate of [
        f => { f.payload.backup.captured_at = f.at(-1500); },
        f => { f.payload.backup.verified_at = f.at(1); },
        f => { f.payload.backup.captured_at = '2026-02-30T12:00:00.000Z'; },
        f => { f.payload.backup.retention_until = f.at(-1); },
        f => { f.payload.backup.sql_bytes = 0; },
        f => { delete f.payload.backup.print_files; },
        f => { f.payload.backup.student_data = 'forbidden-field'; },
        f => { f.payload.restore.contract = digest('different-format-or-schema'); },
        f => { f.payload.restore.completed_at = f.at(-45_000); },
        f => { f.payload.restore.started_at = f.at(1); },
        f => { f.payload.restore.target.database_id = f.context.source.database_id; },
        f => { f.payload.restore.checks.references = false; },
        f => { f.payload.restore.side_effects = 'enabled'; },
        f => { f.payload.backup.consistency_report_sha256 = ''; },
        f => { f.payload.run_id = 'arbitrary-url'; },
        f => { f.context.runId = '99999'; }
    ]) { const f = fixture(); mutate(f); f.resign(); assert.throws(() => f.run(), /RECOVERY_/); }
});

test('rollback remains bound to exact release, active version, schema, secrets, bindings, cron and vars', () => {
    for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars']) {
        const f = fixture(); f.payload.rollback.target_contract[field] = digest('drift'); f.resign();
        assert.throws(() => f.run(), /CONTRACT_DRIFT/);
    }
    for (const mutate of [
        f => { f.context.releaseSha = 'c'.repeat(40); },
        f => { f.context.currentVersion = randomUUID(); },
        f => { f.payload.rollback.target_version_id = f.context.currentVersion; },
        f => { f.payload.rollback.verified_at = f.at(-1500); },
        f => { f.payload.rollback.checks.no_job_replay = false; },
        f => { f.payload.backup.contract = digest('different-schema'); f.payload.restore.contract = f.payload.backup.contract; },
        f => { f.policy.signer.producer_sha = 'c'.repeat(40); f.payload.producer_sha = 'c'.repeat(40); }
    ]) { const f = fixture(); mutate(f); f.resign(); assert.throws(() => f.run(), /RECOVERY_/); }
});

test('unapproved trust, production resource collision and missing retention never pass', () => {
    for (const mutate of [
        f => { f.policy.enabled = false; }, f => { f.policy.signer = null; },
        f => { f.policy.vault.bucket = f.context.source.document_bucket; },
        f => { f.policy.restore_target.database_id = f.context.source.database_id; },
        f => { f.policy.minimum_retention_hours = null; }
    ]) { const f = fixture(); mutate(f); assert.throws(() => f.run()); }
    const f = fixture();
    f.policy.vault.account_id = f.context.source.account_id;
    f.policy.restore_target.account_id = f.context.source.account_id;
    f.payload.restore.target.account_id = f.context.source.account_id; f.resign();
    assert.equal(f.run().verified, true, 'separate resources and identities can use the approved same-account option');
});

test('production CLI stays closed before reading evidence and ignores clock overrides', () => {
    for (const name of ['backup', 'rollback']) {
        const cli = fileURLToPath(new URL(`../scripts/ci/check-${name}-evidence.mjs`, import.meta.url));
        const result = spawnSync(process.execPath, [cli, '/nonexistent/must-not-read.json'], {
            encoding: 'utf8', env: { ...process.env, EVIDENCE_NOW: '2026-10-08T00:00:00.000Z' }
        });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /RECOVERY_POLICY_NOT_APPROVED/);
        assert.doesNotMatch(result.stderr, /ENOENT|must-not-read/);
    }
});

test('active Worker version metadata rejects missing and gradual deployments', () => {
    const id = randomUUID();
    assert.equal(singleWorkerVersion({ deployments: [{ versions: [{ version_id: id, percentage: 100 }] }] }), id);
    for (const result of [{}, { deployments: [] }, { deployments: [{ versions: [{ version_id: id, percentage: 50 }] }] },
        { deployments: [{ versions: [{ version_id: id, percentage: 50 }, { version_id: randomUUID(), percentage: 50 }] }] }]) {
        assert.throws(() => singleWorkerVersion(result));
    }
});

test('artifact preparation is always dry-run, uses generated no-bundle config and rejects config drift/build hooks', () => {
    const root = mkdtempSync(join(tmpdir(), 'synthetic-artifact-plan-'));
    try {
        const dir = join(root, 'dist/uluslarasiofis_local'); mkdirSync(dir, { recursive: true });
        const source = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
        const reviewed = { ...source.env.production, compatibility_date: source.compatibility_date };
        const config = { ...structuredClone(reviewed), main: 'index.js', no_bundle: true, targetEnvironment: 'production',
            assets: { ...source.assets, directory: '../client' }, migrations: [], durable_objects: { bindings: [] } };
        config.d1_databases[0].migrations_dir = '../../migrations';
        const path = join(dir, 'wrangler.json'); const save = c => writeFileSync(path, JSON.stringify(c));
        save(config);
        const args = artifactDryRunPlan(root, reviewed);
        assert.equal(args[0], 'deploy'); assert.ok(args.includes('--dry-run')); assert.ok(args.includes('--no-bundle'));
        assert.ok(!args.includes('--env'));
        for (const mutate of [
            c => { c.name = 'wrong-worker'; }, c => { c.main = '../../src/server/worker.js'; },
            c => { c.build = { command: 'npm run build' }; }, c => { c.no_bundle = false; },
            c => { c.vars.PRINT_ENABLED = 'false'; }, c => { c.triggers.crons = []; },
            c => { c.assets.directory = '../../private'; }, c => { c.migrations = [{ tag: 'unexpected' }]; }, c => { c.d1_databases[0].database_id = randomUUID(); }
        ]) { const bad = structuredClone(config); mutate(bad); save(bad); assert.throws(() => artifactDryRunPlan(root, reviewed)); }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rollback contract fingerprints ignore API ordering but retain schema, ledger, secret type, binding, cron and variable drift', () => {
    const input = { schema: [{ type: 'table', name: 'synthetic', sql: 'CREATE TABLE synthetic(id TEXT)' }],
        migrations: [{ name: '0001_synthetic.sql', sha256: digest('synthetic') }],
        secrets: [{ name: 'PRINTER_SECRET', type: 'secret_text' }, { name: 'PRINT_R2_ACCESS_KEY_ID', type: 'secret_text' }],
        bindings: [{ name: 'DB', type: 'd1', id: 'synthetic-db' }, { name: 'DOCUMENTS', type: 'r2_bucket', id: 'synthetic-documents' },
            { name: 'PRINT_FILES', type: 'r2_bucket', id: 'synthetic-print' }], crons: ['* * * * *', '0 0 * * *'],
        vars: { PRINT_ENABLED: 'true' }, worker: digest('synthetic-worker'), assets: digest('synthetic-assets') };
    const expected = contractFromMetadata(input);
    const reordered = structuredClone(input); reordered.secrets.reverse(); reordered.crons.reverse();
    assert.deepEqual(contractFromMetadata(reordered), expected);
    for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons']) {
        assert.throws(() => contractFromMetadata({ ...input, [field]: [] }), /INVALID_CONTRACT_METADATA/);
    }
    Object.defineProperty(reordered.secrets[0], 'text', { get() { throw new Error('Secret content must not be read.'); } });
    assert.deepEqual(contractFromMetadata(reordered), expected);
    for (const [field, mutate] of [
        ['schema', f => { f.schema[0].sql += ';'; }], ['migrations', f => { f.migrations[0].sha256 = digest('changed'); }],
        ['secrets', f => { f.secrets[0].type = 'plain_text'; }], ['bindings', f => { f.bindings[0].id = 'different-db'; }],
        ['crons', f => { f.crons[0] = '1 * * * *'; }], ['vars', f => { f.vars.PRINT_ENABLED = 'false'; }]
    ]) { const changed = structuredClone(input); mutate(changed); assert.notEqual(contractFromMetadata(changed)[field], expected[field]); }
});

test('synthetic CLI refuses input files and credentials without echoing them', () => {
    const cli = fileURLToPath(new URL('../scripts/recovery/synthetic-restore.mjs', import.meta.url));
    const marker = 'SYNTHETIC-REFUSAL-MARKER';
    for (const [args, env] of [
        [[cli, '--remote', '/must-not-read.sql'], process.env],
        [[cli], { ...process.env, CLOUDFLARE_API_TOKEN: marker }]
    ]) {
        const result = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 20_000 });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /no production operation or evidence was created/);
        assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
    }
});

test('R2 restore validation rejects missing bytes, corrupted content and metadata drift without logging payloads', async () => {
    const object = (text, contentType = 'application/pdf') => ({ httpMetadata: { contentType }, customMetadata: { synthetic: 'true' },
        async arrayBuffer() { return new TextEncoder().encode(text).buffer; } });
    await verifyRestoredObject(object('synthetic'), object('synthetic'));
    await assert.rejects(verifyRestoredObject(object('synthetic'), null), /OBJECT_MISSING/);
    await assert.rejects(verifyRestoredObject(object('synthetic'), object('corrupted')), /HASH_MISMATCH/);
    await assert.rejects(verifyRestoredObject(object('synthetic'), object('synthetic', 'text/plain')), /METADATA_MISMATCH/);
    const left = object('synthetic'), right = object('synthetic');
    left.httpMetadata.cacheExpiry = new Date('2026-10-16T00:00:00.000Z');
    right.httpMetadata.cacheExpiry = new Date('2026-10-17T00:00:00.000Z');
    await assert.rejects(verifyRestoredObject(left, right), /METADATA_MISMATCH/);
});

test('native local synthetic SQL and two R2 buckets restore with schema, ledger, byte hashes, metadata and reference checks', { timeout: 60_000 }, async () => {
    const result = await runSyntheticRestore();
    assert.equal(result.environment, 'synthetic-local'); assert.equal(result.eligible_for_production, false);
    assert.equal(result.migrations, 23); assert.equal(result.objects, 2); assert.ok(result.tables > 30);
});

test('synthetic maintenance job has no credentials and real operations remain manual and guarded', () => {
    const workflow = readFileSync(new URL('../.github/workflows/recovery-preparation.yml', import.meta.url), 'utf8');
    assert.match(workflow, /^  workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/m);
    const synthetic = workflow.slice(workflow.indexOf('  synthetic:'), workflow.indexOf('  inventory:'));
    assert.doesNotMatch(synthetic, /secrets\.|environment:|upload-artifact|--remote|wrangler deploy/);
    assert.match(workflow, /environment: Production/);
    assert.match(workflow, /execution_enabled:false/);
    assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.sha \}\}/);
    assert.match(workflow, /contents: read/); assert.match(workflow, /check-release-sha\.mjs/);
    assert.match(workflow, /synthetic-restore\.mjs/);
});

test('maintenance evidence selection uses latest run and never falls back past a failure', async () => {
    const fixtureRun = { id: 12345, status: 'completed', conclusion: 'success', head_branch: 'production',
        event: 'workflow_dispatch', path: '.github/workflows/recovery-preparation.yml', repository: { full_name: 'kagandms/uluslarasiofis' } };
    const request = run => async path => path.includes('/artifacts')
        ? { artifacts: [{ name: 'recovery-evidence', expired: false, size_in_bytes: 1024 }] }
        : { workflow_runs: [run] };
    assert.equal(await selectMaintenanceRun(request(fixtureRun)), 12345);
    for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { head_branch: 'other' },
        { event: 'pull_request' }, { path: 'other.yml' }, { repository: { full_name: 'other/repository' } }]) {
        await assert.rejects(selectMaintenanceRun(request({ ...fixtureRun, ...change })));
    }
    await assert.rejects(selectMaintenanceRun(async () => ({ workflow_runs: [] })));
    await assert.rejects(selectMaintenanceRun(async path => path.includes('/artifacts')
        ? { artifacts: [{ name: 'recovery-evidence', expired: true, size_in_bytes: 1 }] }
        : { workflow_runs: [fixtureRun] }));
});

test('artifact CLI rejects a publish argument before reading configuration or running Wrangler', () => {
    const cli = fileURLToPath(new URL('../scripts/ci/artifact-dry-run.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--publish'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No publish or remote arguments accepted/);
    assert.doesNotMatch(result.stdout, /wrangler|Upload/);
});
