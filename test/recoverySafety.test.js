import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonical, digest, verifyRecoveryEvidence } from '../scripts/recovery/evidence.mjs';
import { runSyntheticRestore } from '../scripts/recovery/synthetic-restore.mjs';
import { verifyRestoredObject } from '../scripts/recovery/restore-checks.mjs';
import { contractFromMetadata } from '../scripts/recovery/contract.mjs';

// Synthetic scope and in-memory test keys only. No production success receipt is generated or saved.
function fixture() {
    const now = Date.parse('2026-10-16T12:00:00.000Z');
    const at = minutes => new Date(now + minutes * 60_000).toISOString();
    const pairs = Object.fromEntries(['backup', 'restore', 'rollback', 'observation'].map(role => [role, generateKeyPairSync('ed25519')]));
    const source = { environment: 'synthetic-test', repository: 'synthetic/recovery', worker: 'synthetic', account_id: 'a'.repeat(32),
        database_id: randomUUID(), document_bucket: 'synthetic-documents', print_bucket: 'synthetic-print' };
    const context = { source, releaseSha: 'a'.repeat(40) };
    const policy = { schema: 1, enabled: true, minimum_retention_hours: 24,
        keys: Object.keys(pairs).map(role => ({ id: `synthetic-${role}`, role, producer_sha: 'b'.repeat(40),
            public_key: pairs[role].publicKey.export({ format: 'pem', type: 'spki' }).toString() })),
        vault: { id: randomUUID(), account_id: 'c'.repeat(32), bucket: 'synthetic-vault' },
        restore_target: { account_id: 'b'.repeat(32), database_id: randomUUID(), document_bucket: 'synthetic-restored-docs', print_bucket: 'synthetic-restored-print' } };
    const contract = Object.fromEntries(['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars', 'worker', 'assets'].map(field => [field, digest(field)]));
    const backupId = randomUUID(), currentVersion = randomUUID(), restoreId = randomUUID();
    const details = {
        backup: { backup_id: backupId, captured_at: at(-30), verified_at: at(-28), bookmark_sha256: digest('synthetic-bookmark'),
            sql_sha256: digest('synthetic-sql'), sql_bytes: 100, manifest_sha256: digest('synthetic-manifest'),
            archive_sha256: digest('synthetic-ciphertext'), archive_bytes: 200, storage_receipt_sha256: digest('synthetic-storage-receipt'),
            vault_id: policy.vault.id, retention_until: at(2880), consistency: 'quiesced-window', window_start: at(-31), window_end: at(-29),
            documents: { objects: 1, bytes: 12, manifest_sha256: digest('synthetic-docs') },
            print_files: { objects: 1, bytes: 12, manifest_sha256: digest('synthetic-print') } },
        restore: { backup_id: backupId, manifest_sha256: digest('synthetic-manifest'), started_at: at(-26), completed_at: at(-10),
            target: { ...policy.restore_target }, report_sha256: digest('synthetic-restore-report'), side_effects: 'disabled',
            checks: Object.fromEntries(['sql_integrity', 'foreign_keys', 'schema', 'migration_ledger', 'row_counts', 'object_hashes', 'object_metadata', 'references', 'no_external_effects'].map(key => [key, true])) },
        rollback: { release_sha: context.releaseSha, current_version_id: currentVersion, target_version_id: randomUUID(), verified_at: at(-8),
            backup_id: backupId, restore_id: restoreId, current_contract: { ...contract },
            target_contract: { ...contract, worker: digest('synthetic-old-worker'), assets: digest('synthetic-old-assets') },
            report_sha256: digest('synthetic-compatibility-report'), checks: { application_contract: true, print_scanner_contract: true, no_job_replay: true } },
        observation: { observed_at: at(-2), current_version_id: currentVersion, current_contract_sha256: digest(contract), backup_id: backupId,
            manifest_sha256: digest('synthetic-manifest'), vault_id: policy.vault.id, storage_receipt_sha256: digest('synthetic-storage-receipt'),
            archive_sha256: digest('synthetic-ciphertext'), archive_bytes: 200, retention_until: at(2880) }
    };
    const bundle = { schema: 1, records: Object.keys(details).map(kind => ({ key_id: `synthetic-${kind}`, signature: '', payload: {
        schema: 1, kind, id: kind === 'restore' ? restoreId : randomUUID(), issued_at: at({ backup: -27, restore: -9, rollback: -7, observation: -1 }[kind]),
        source: { ...source }, producer_sha: 'b'.repeat(40), run_id: '12345', details: details[kind] } })) };
    const resign = () => bundle.records.forEach(record => { record.signature = sign(null, Buffer.from(canonical(record.payload)), pairs[record.payload.kind].privateKey).toString('base64'); });
    resign();
    return { now, at, policy, context, bundle, details, resign, pairs,
        run: (mode = 'rollback') => verifyRecoveryEvidence(bundle, policy, context, now, mode) };
}

test('signed synthetic receipts verify complete coverage, provenance, exact backup restore and rollback contracts', () => {
    const f = fixture();
    assert.deepEqual(f.run('backup'), { verified: true, mode: 'backup' });
    assert.deepEqual(f.run(), { verified: true, mode: 'rollback' });
    assert.throws(() => verifyRecoveryEvidence(f.bundle, f.policy, { ...f.context, releaseSha: 'c'.repeat(40) }, f.now, 'rollback'), /CONTEXT_MISMATCH/);
    f.bundle.records = f.bundle.records.filter(record => record.payload.kind !== 'rollback');
    assert.equal(f.run('backup').verified, true);
    assert.throws(() => f.run(), /ROLLBACK_REQUIRED/);
});

test('every source scope field is bound to the reviewed context', () => {
    for (const field of ['environment', 'repository', 'worker', 'account_id', 'database_id', 'document_bucket', 'print_bucket']) {
        const f = fixture(); f.bundle.records[0].payload.source[field] = 'different-source'; f.resign();
        assert.throws(() => f.run(), /WRONG_SOURCE/);
    }
});

test('unsigned, altered, wrong-role and untrusted evidence is rejected', () => {
    for (const change of [
        f => { f.bundle.records[0].signature = ''; },
        f => { f.bundle.records[0].key_id = 'untrusted-key'; },
        f => { f.bundle.records[0].key_id = 'synthetic-restore'; },
        f => { f.details.backup.sql_bytes += 1; },
        f => { f.bundle.records[0].payload.source.environment = 'production'; },
        f => { f.bundle.records[0].payload.producer_sha = 'd'.repeat(40); },
        f => { f.bundle.records.push(f.bundle.records[0]); }
    ]) { const f = fixture(); change(f); assert.throws(() => f.run(), /RECOVERY_/); }
    const f = fixture();
    assert.throws(() => verifyRecoveryEvidence({ environment: 'production', coverage: { d1_snapshot: true } }, f.policy, f.context, f.now), /RECOVERY_/);
});

test('even correctly signed incomplete, stale, fabricated-field and unsafe restore claims fail closed', () => {
    for (const change of [
        f => { f.details.backup.captured_at = f.at(-1500); },
        f => { f.details.backup.verified_at = f.at(1); },
        f => { f.details.backup.captured_at = '2026-02-30T12:00:00.000Z'; },
        f => { f.details.backup.window_start = f.at(-60); },
        f => { f.details.backup.retention_until = f.at(-1); },
        f => { f.details.backup.consistency = 'best-effort'; },
        f => { f.details.backup.sql_bytes = 0; },
        f => { delete f.details.backup.print_files; },
        f => { f.details.backup.raw_student_data = 'must-not-appear-in-evidence'; },
        f => { f.details.restore.manifest_sha256 = digest('different'); },
        f => { f.details.restore.backup_id = randomUUID(); },
        f => { f.details.restore.completed_at = f.at(-45_000); },
        f => { f.details.restore.target.account_id = f.context.source.account_id; },
        f => { f.details.restore.checks.references = false; },
        f => { f.details.restore.side_effects = 'enabled'; },
        f => { f.details.observation.observed_at = f.at(-20); },
        f => { f.details.observation.storage_receipt_sha256 = digest('different'); },
        f => { f.details.observation.archive_sha256 = digest('different'); },
        f => { f.details.observation.archive_bytes -= 1; },
        f => { f.details.observation.retention_until = f.at(1); },
        f => { f.bundle.records[0].payload.run_id = 'not-a-run'; }
    ]) { const f = fixture(); change(f); f.resign(); assert.throws(() => f.run(), /RECOVERY_/); }
});

test('rollback rejects every schema, migration, secret, binding, cron and variable drift or stale live observation', () => {
    for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars']) {
        const f = fixture(); f.details.rollback.target_contract[field] = digest('drift'); f.resign();
        assert.throws(() => f.run(), /CONTRACT_DRIFT/);
    }
    for (const change of [
        f => { f.details.rollback.current_version_id = randomUUID(); },
        f => { f.details.rollback.target_version_id = f.details.rollback.current_version_id; },
        f => { f.details.rollback.verified_at = f.at(-1500); },
        f => { f.details.rollback.checks.no_job_replay = false; },
        f => { f.details.observation.current_contract_sha256 = digest('drift'); }
    ]) { const f = fixture(); change(f); f.resign(); assert.throws(() => f.run(), /RECOVERY_/); }
});

test('unapproved policy, same production targets and self-certified restore cannot pass', () => {
    for (const change of [
        f => { f.policy.enabled = false; }, f => { f.policy.keys = []; },
        f => { f.policy.vault.account_id = f.context.source.account_id; },
        f => { f.policy.restore_target.database_id = f.context.source.database_id; },
        f => { f.policy.minimum_retention_hours = null; },
        f => { f.policy.keys.find(key => key.role === 'restore').public_key = f.policy.keys.find(key => key.role === 'backup').public_key; f.pairs.restore = f.pairs.backup; }
    ]) { const f = fixture(); change(f); f.resign(); assert.throws(() => f.run(), /RECOVERY_/); }
});

test('production CLI rejects old unsigned booleans and clock overrides before reading an unapproved evidence path', () => {
    for (const name of ['backup', 'rollback']) {
        const cli = fileURLToPath(new URL(`../scripts/ci/check-${name}-evidence.mjs`, import.meta.url));
        const result = spawnSync(process.execPath, [cli, '/nonexistent/must-not-be-read.json'], {
            encoding: 'utf8', env: { ...process.env, EVIDENCE_NOW: '2026-10-08T00:00:00.000Z' }
        });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /RECOVERY_POLICY_NOT_APPROVED/);
        assert.doesNotMatch(result.stderr, /ENOENT|BEGIN|must-not-be-read/);
    }
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

test('synthetic workflow has no credentials, production environment, data upload, remote command or automatic trigger', () => {
    const workflow = readFileSync(new URL('../.github/workflows/recovery-preparation.yml', import.meta.url), 'utf8');
    assert.match(workflow, /^  workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/m);
    assert.doesNotMatch(workflow, /secrets\.|environment:|upload-artifact|--remote|wrangler deploy|rollback/);
    assert.match(workflow, /contents: read/); assert.match(workflow, /check-release-sha\.mjs/);
    assert.match(workflow, /synthetic-restore\.mjs/);
});
