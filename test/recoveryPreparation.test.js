import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inventoryClient, collectInventory } from '../scripts/recovery/inventory.mjs';
import { recoveryCost, estimateInventoryCost } from '../scripts/recovery/cost.mjs';
import { approveOperation, prepareMaintenanceOperation } from '../scripts/recovery/operations.mjs';
import { exportFullD1Sql } from '../scripts/recovery/d1-export.mjs';
import { releaseWithPorts } from '../scripts/ci/exact-artifact-release.mjs';

const hash = 'a'.repeat(64);
const source = { account_id: 'a'.repeat(32), database_id: randomUUID(), document_bucket: 'synthetic-documents', print_bucket: 'synthetic-print' };
const policy = () => ({ schema: 1, execution_enabled: true, approval_ref: hash, monthly_budget_usd: 10,
    retention_days: 30, backup_interval_hours: 24, restore_interval_days: 30, resource_placement: 'same-account-private-isolated',
    scope: { d1: 'full-sql', documents: 'exclude-backup-prefixes', document_exclude_prefixes: ['backups/'], print_files: 'include' }, deletion_policy_approved: true,
    vault: { account_id: source.account_id, bucket: 'synthetic-vault' },
    restore_target: { account_id: source.account_id, database_id: randomUUID(), document_bucket: 'synthetic-restore-documents', print_bucket: 'synthetic-restore-print' } });

test('inventory transport permits only fixed metadata GETs and a literal read-only GraphQL query', async () => {
    const calls = [];
    const client = inventoryClient(source.account_id, 'SYNTHETIC', async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ success: true, result: {}, data: { viewer: { accounts: [] } } }) };
    });
    await client(`/accounts/${source.account_id}/d1/database/${source.database_id}`);
    await client('/graphql', { accountTag: source.account_id, filter: { bucketName: source.document_bucket } });
    assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[1].options.method, 'POST');
    assert.doesNotMatch(JSON.parse(calls[1].options.body).query, /mutation|export|objects\s*\{/i);
    for (const path of [`/accounts/${source.account_id}/d1/database/${source.database_id}/export`,
        `/accounts/${source.account_id}/r2/buckets/${source.document_bucket}/objects/private`, 'https://other.invalid/']) {
        await assert.rejects(client(path));
    }
    assert.equal(calls.length, 2);
});

test('inventory returns only aggregates and hashes, never customer rows, object keys, lifecycle prefixes or billing data', async () => {
    const production = { name: 'goc', d1_databases: [{ database_id: source.database_id }], r2_buckets: [{ binding: 'DOCUMENTS', bucket_name: source.document_bucket }] };
    const now = Date.parse('2026-10-15T12:00:00.000Z');
    const result = await collectInventory(async path => {
        if (path === '/graphql') return { dimensions: { datetime: new Date(now).toISOString() }, max: { objectCount: 2, payloadSize: 123, metadataSize: 4 } };
        if (path.endsWith('/lifecycle')) return { rules: [{ conditions: { prefix: 'SYNTHETIC-PRIVATE-OBJECT-KEY' } }] };
        if (path.endsWith('/lock')) return { rules: [] };
        if (path.endsWith('/subscriptions')) return [{ rate_plan: { public_name: 'Workers Paid' }, billing_email: 'SYNTHETIC-BILLING-MARKER' }];
        if (path.includes('/time_travel/')) return { bookmark: 'SYNTHETIC-PRIVATE-BOOKMARK' };
        if (path.includes('?page=')) return [{ uuid: source.database_id }, { uuid: randomUUID() }];
        if (path.endsWith('/r2/buckets')) return { buckets: [{ name: source.document_bucket }, { name: 'synthetic-other' }] };
        if (path.includes('/r2/buckets/')) return { storage_class: 'Standard' };
        return { file_size: 1234, version: 'production' };
    }, source.account_id, production, now);
    assert.equal(result.d1.value.bytes, 1234); assert.equal(result.buckets[0].metrics.value.bytes, 123);
    assert.equal(result.time_travel.value.retention_days, null);
    assert.equal(result.databases.value.isolation_and_emptiness_verified, false);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC-PRIVATE|SYNTHETIC-BILLING/);
});

test('missing/denied metrics stay unknown and are never substituted with zero', async () => {
    const production = { name: 'goc', d1_databases: [{ database_id: source.database_id }], r2_buckets: [{ binding: 'DOCUMENTS', bucket_name: source.document_bucket }] };
    const result = await collectInventory(async () => { throw new Error('SENSITIVE ERROR MUST NOT BE LOGGED'); }, source.account_id, production);
    assert.equal(result.d1.state, 'unavailable'); assert.equal(result.buckets[0].metrics.state, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), /SENSITIVE/);
});

test('cost requires measured SQL bytes and explicit free-tier assumptions, and rounds billing units', () => {
    assert.throws(() => recoveryCost({ documentBytes: 1e9, objects: 1000, printBytes: 0, printObjects: 0 }), /MEASUREMENTS/);
    const paid = recoveryCost({ sqlBytes: 1e6, documentBytes: 1e9, objects: 1000, printBytes: 0, printObjects: 0 });
    assert.equal(paid.r2_usd, 5.325);
    assert.throws(() => recoveryCost({ sqlBytes: 1e6, documentBytes: 1e9, objects: 1000 }), /MEASUREMENTS/);
    assert.ok(recoveryCost({ sqlBytes: 1e6, documentBytes: 1e9, objects: 1000, printBytes: 1e9, printObjects: 1 }).r2_usd > paid.r2_usd);
    assert.equal(recoveryCost({ sqlBytes: 1e6, documentBytes: 1e9, objects: 1000, printBytes: 0, printObjects: 0, remainingFree: { gb: 10, a: 1e6, b: 10e6 } }).r2_usd, 0.315);
    assert.ok(paid.excluded.includes('GitHub runner minutes'));
    assert.throws(() => estimateInventoryCost({ d1: { state: 'unavailable' } }, 2), /INVENTORY/);
    const estimate = estimateInventoryCost({ d1: { state: 'verified', value: { bytes: 1e6 } }, buckets: [{ binding: 'DOCUMENTS', metrics: { state: 'verified', value: { bytes: 1e9, metadata_bytes: 0, objects: 1000 } } }, { binding: 'PRINT_FILES', metrics: { state: 'verified', value: { bytes: 0, metadata_bytes: 0, objects: 0 } } }] }, 2);
    assert.equal(estimate.sql_expansion_factor_assumed, 2); assert.match(estimate.warning, /not measured/);
});

test('operation policy is closed before ports and rejects scope, retention, budget and production target collisions', async () => {
    const checked = JSON.parse(readFileSync(new URL('../config/recovery-operations.json', import.meta.url)));
    await assert.rejects(prepareMaintenanceOperation(checked, source, 'backup', new Proxy({}, { get() { throw new Error('Ports must not be touched'); } })), /LOCKED/);
    for (const mutate of [p => { p.deletion_policy_approved = false; }, p => { p.retention_days = 7; },
        p => { p.monthly_budget_usd = null; }, p => { p.scope.print_files = 'pending-live-verification'; },
        p => { p.scope.print_files = 'exclude-ephemeral'; }, p => { p.restore_target.database_id = source.database_id; },
        p => { p.vault.bucket = source.document_bucket; }, p => { p.vault.account_id = 'b'.repeat(32); },
        p => { p.restore_target.account_id = 'c'.repeat(32); }, p => { p.scope.document_exclude_prefixes = ['']; },
        p => { p.scope.document_exclude_prefixes = ['backups/', 'documents/']; }]) {
        const p = policy(); mutate(p); assert.throws(() => approveOperation(p, source, 'backup'));
    }
    const p = policy(); p.scope.print_files = 'exclude-ephemeral'; p.print_exclusion_evidence_sha256 = hash;
    assert.equal(approveOperation(p, source, 'backup').print_mode, 'exclude-ephemeral');
});

function fakeMaintenance() {
    const calls = [];
    return { calls, io: {
        async preflight() { calls.push('preflight'); return { private_storage: true, retention_days: 30, identities_separated: true, monthly_upper_usd: 5 }; },
        async exportFullSql() { calls.push('export'); return 'SYNTHETIC SQL ONLY'; },
        async writePrivateSql() { calls.push('sql'); return { bytes: 1, sha256: hash }; },
        async verifyPrivateCopy() { return true; },
        async *listSourceObjects(binding) { calls.push(binding); yield { key: 'synthetic-only', bytes: 1 }; },
        async copyPrivateObject() { calls.push('copy'); return { sha256: hash }; },
        async verifySnapshotConsistency() { return true; }, async finishPrivateManifest() { return { sha256: hash }; },
        async verifyIsolation() { return Object.fromEntries(['no_production_write', 'no_routes', 'no_crons', 'no_external_services', 'egress_denied', 'no_live_secrets'].map(k => [k, true])); },
        async readVerifiedPrivateBackup() { calls.push('read-private'); return {}; },
        async restoreSqlIntoIsolatedTarget() { calls.push('restore-sql'); }, async restoreObjectsIntoIsolatedTarget() { calls.push('restore-r2'); },
        async verifyRestore() { return Object.fromEntries(['integrity', 'foreign_keys', 'schema', 'ledger', 'row_hashes', 'objects', 'metadata', 'references', 'deletion_policy', 'no_job_replay'].map(k => [k, true])); }
    } };
}

test('synthetic adapter exercise verifies copy/restore ordering and stops before writes on budget or isolation failures', async () => {
    const backup = fakeMaintenance(); assert.equal((await prepareMaintenanceOperation(policy(), source, 'backup', backup.io)).objects, 2);
    assert.deepEqual(backup.calls, ['preflight', 'export', 'sql', 'DOCUMENTS', 'copy', 'PRINT_FILES', 'copy']);
    const restore = fakeMaintenance(); assert.equal((await prepareMaintenanceOperation(policy(), source, 'restore', restore.io)).verified, true);
    for (const operation of ['backup', 'restore']) {
        const f = fakeMaintenance(); f.io.preflight = async () => ({ private_storage: true, retention_days: 30, identities_separated: true, monthly_upper_usd: 100 });
        await assert.rejects(prepareMaintenanceOperation(policy(), source, operation, f.io)); assert.equal(f.calls.length, 0);
    }
    const f = fakeMaintenance(); f.io.verifyIsolation = async () => ({ no_production_write: false });
    await assert.rejects(prepareMaintenanceOperation(policy(), source, 'restore', f.io)); assert.deepEqual(f.calls, ['preflight']);
    const corrupt = fakeMaintenance(); corrupt.io.verifyPrivateCopy = async () => false;
    await assert.rejects(prepareMaintenanceOperation(policy(), source, 'backup', corrupt.io)); assert.ok(!corrupt.calls.includes('DOCUMENTS'));
});

test('D1 export is full schema/data, bounded, authenticated only at the API and separately downloaded without forwarding auth', async () => {
    const calls = []; let downloaded = false;
    const request = async (path, args) => {
        calls.push({ path, args });
        return { success: true, status: 'complete', result: { signed_url: 'https://synthetic.r2.cloudflarestorage.com/synthetic?signature=FAKE' } };
    };
    const bytes = await exportFullD1Sql(policy(), source, request, async (url, options) => {
        downloaded = true; assert.deepEqual(options.headers, {}); assert.equal(options.redirect, 'error'); return 'SYNTHETIC SQL';
    });
    assert.equal(bytes, 'SYNTHETIC SQL'); assert.equal(downloaded, true);
    assert.deepEqual(calls[0].args.body.dump_options, { no_data: false, no_schema: false });
    await assert.rejects(exportFullD1Sql({ ...policy(), execution_enabled: false }, source, request, () => {}), /LOCKED/);
    assert.equal(calls.length, 1);
});

function fakeRelease() {
    const calls = []; const records = []; let deployed = false;
    const io = Object.fromEntries(['verifySource', 'verifyArtifact', 'preflight', 'verifyLedger', 'verifyRecovery', 'health'].map(name => [name, async () => { calls.push(name); }]));
    io.activeVersion = async () => ({ id: deployed ? 'synthetic-new' : 'synthetic-old', release_sha: deployed ? 'a'.repeat(40) : null });
    io.publish = async () => { calls.push('publish'); deployed = true; };
    io.record = async result => records.push(result);
    return { io, calls, records, context: { sha: 'a'.repeat(40), approvedCurrentVersion: 'synthetic-old' } };
}

test('publication policy stops before I/O; prepared flow verifies before a single publish and records read-only health', async () => {
    const f = fakeRelease(); const checked = JSON.parse(readFileSync(new URL('../config/production-publication.json', import.meta.url)));
    await assert.rejects(releaseWithPorts(checked, f.context, f.io), /LOCKED/); assert.deepEqual(f.calls, []);
    await releaseWithPorts({ enabled: true }, f.context, f.io);
    assert.deepEqual(f.calls, ['verifySource', 'verifyArtifact', 'preflight', 'verifyLedger', 'verifyRecovery', 'verifySource', 'verifyArtifact', 'publish', 'verifyArtifact', 'health']);
    assert.equal(f.records[0].health, 'passed');
});

test('publication rejects failed gates, changed current version, duplicates and failed health without retries or rollback', async () => {
    for (const gate of ['verifySource', 'verifyArtifact', 'preflight', 'verifyLedger', 'verifyRecovery']) {
        const f = fakeRelease(); f.io[gate] = async () => { throw new Error('synthetic guard failure'); };
        await assert.rejects(releaseWithPorts({ enabled: true }, f.context, f.io)); assert.ok(!f.calls.includes('publish'));
    }
    const changed = fakeRelease(); changed.context.approvedCurrentVersion = 'different';
    await assert.rejects(releaseWithPorts({ enabled: true }, changed.context, changed.io)); assert.ok(!changed.calls.includes('publish'));
    const duplicate = fakeRelease(); duplicate.io.activeVersion = async () => ({ id: 'synthetic-old', release_sha: duplicate.context.sha });
    await assert.rejects(releaseWithPorts({ enabled: true }, duplicate.context, duplicate.io)); assert.ok(!duplicate.calls.includes('publish'));
    const health = fakeRelease(); health.io.health = async () => { throw new Error('synthetic health failure'); };
    await assert.rejects(releaseWithPorts({ enabled: true }, health.context, health.io));
    assert.equal(health.calls.filter(c => c === 'publish').length, 1); assert.equal(health.records[0].health, 'failed');
});

test('both production CLIs stay locked even when an enable environment variable is provided', () => {
    for (const [path, args] of [['../scripts/ci/exact-artifact-release.mjs', []], ['../scripts/recovery/operations.mjs', ['backup']]]) {
        const r = spawnSync(process.execPath, [fileURLToPath(new URL(path, import.meta.url)), ...args], {
            encoding: 'utf8', env: { ...process.env, ENABLE_PUBLICATION: 'true', RECOVERY_EXECUTION_ENABLED: 'true' }
        });
        assert.notEqual(r.status, 0); assert.match(r.stderr, /locked/i);
    }
});

test('workflow keeps unconditional exit before prepared publication, and maintenance has no automatic export/restore schedule', () => {
    const release = readFileSync(new URL('../.github/workflows/production-release.yml', import.meta.url), 'utf8');
    assert.ok(release.indexOf('          exit 1') < release.indexOf('        run: node scripts/ci/exact-artifact-release.mjs'));
    const prepared = release.slice(release.indexOf('      - name: Prepared exact-artifact'));
    assert.match(prepared, /if: success\(\)/); assert.doesNotMatch(prepared, /always\(\)/);
    const maintenance = readFileSync(new URL('../.github/workflows/recovery-preparation.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(maintenance, /^  schedule:/m);
    assert.match(maintenance, /inputs.operation == 'inventory'/); assert.match(maintenance, /execution_enabled:false/);
});

test('selected preparation decisions keep execution, budget, retention approval and real resource IDs unresolved', () => {
    const p = JSON.parse(readFileSync(new URL('../config/recovery-operations.json', import.meta.url)));
    assert.equal(p.resource_placement, 'same-account-private-isolated');
    assert.equal(p.scope.d1, 'full-sql'); assert.equal(p.scope.documents, 'exclude-backup-prefixes');
    assert.deepEqual(p.scope.document_exclude_prefixes, ['backups/']); assert.equal(p.scope.print_files, 'include');
    assert.equal(p.retention_days, 30); assert.equal(p.backup_interval_hours, 24); assert.equal(p.restore_interval_days, 30);
    assert.equal(p.execution_enabled, false); assert.equal(p.approval_ref, null); assert.equal(p.monthly_budget_usd, null);
    assert.equal(p.deletion_policy_approved, false); assert.equal(p.print_exclusion_evidence_sha256, null);
    assert.equal(p.vault, null); assert.equal(p.restore_target, null);
});

test('DOCUMENTS excludes old backups but preserves ordinary documents and PRINT_FILES until live exclusion proof', async () => {
    const f = fakeMaintenance(); const copied = [];
    f.io.listSourceObjects = async function* (binding) {
        for (const key of ['backups/production/latest.json', 'backups/production/old.json', 'documents/permanent.pdf', 'backups-photos/document.pdf']) yield { key };
    };
    f.io.copyPrivateObject = async (binding, object) => { copied.push(`${binding}:${object.key}`); return { sha256: hash }; };
    const result = await prepareMaintenanceOperation(policy(), source, 'backup', f.io);
    assert.equal(result.objects, 6);
    assert.deepEqual(copied.filter(key => key.startsWith('DOCUMENTS:')), ['DOCUMENTS:documents/permanent.pdf', 'DOCUMENTS:backups-photos/document.pdf']);
    assert.equal(copied.filter(key => key.startsWith('PRINT_FILES:')).length, 4);
});
