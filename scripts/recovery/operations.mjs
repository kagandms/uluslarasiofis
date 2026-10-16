import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { digest } from './evidence.mjs';

export function approveOperation(policy, source, operation) {
    assert.ok(['backup', 'restore'].includes(operation));
    assert.equal(policy.execution_enabled, true, 'RECOVERY_OPERATIONS_LOCKED');
    assert.match(policy.approval_ref || '', /^[a-f0-9]{64}$/, 'Scope/cost approval required.');
    assert.ok(Number.isFinite(policy.monthly_budget_usd) && policy.monthly_budget_usd > 0);
    assert.equal(policy.retention_days, 30); assert.equal(policy.backup_interval_hours, 24); assert.equal(policy.restore_interval_days, 30);
    assert.equal(policy.scope.d1, 'full-sql'); assert.equal(policy.scope.documents, 'full-bucket');
    assert.equal(policy.deletion_policy_approved, true, 'Thirty-day deletion/temporary-data policy requires approval.');
    assert.ok(['include', 'exclude-ephemeral'].includes(policy.scope.print_files), 'Live print safety review required.');
    if (policy.scope.print_files === 'exclude-ephemeral') assert.match(policy.print_exclusion_evidence_sha256 || '', /^[a-f0-9]{64}$/);
    const target = policy.restore_target, vault = policy.vault;
    assert.ok(target && vault);
    for (const account of [source.account_id, target.account_id, vault.account_id]) assert.match(account || '', /^[a-f0-9]{32}$/);
    assert.match(target.database_id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.notEqual(target.database_id, source.database_id);
    const production = [source.document_bucket, source.print_bucket];
    for (const bucket of [target.document_bucket, target.print_bucket, vault.bucket]) {
        assert.match(bucket || '', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/); assert.ok(!production.includes(bucket));
    }
    assert.equal(new Set([target.document_bucket, target.print_bucket, vault.bucket]).size, 3);
    return { operation, retention_days: 30, source, target, vault, print_mode: policy.scope.print_files };
}

// I/O ports are intentionally explicit. No default production writer, secret loader or evidence signer.
// A reviewed private-storage adapter is selected after inventory/cost/data approvals.
export async function prepareMaintenanceOperation(policy, source, operation, io) {
    const plan = approveOperation(policy, source, operation); // Always BEFORE any credential or I/O access.
    const ready = await io.preflight(plan);
    assert.equal(ready.private_storage, true); assert.equal(ready.retention_days, 30);
    assert.equal(ready.identities_separated, true);
    assert.ok(Number.isFinite(ready.monthly_upper_usd) && ready.monthly_upper_usd <= policy.monthly_budget_usd);
    if (operation === 'backup') {
        const sql = await io.exportFullSql(plan);
        const sqlCopy = await io.writePrivateSql(sql, plan);
        assert.ok(sqlCopy.bytes > 0 && /^[a-f0-9]{64}$/.test(sqlCopy.sha256));
        assert.equal(await io.verifyPrivateCopy(sqlCopy, plan), true);
        let objects = 0;
        for (const binding of plan.print_mode === 'include' ? ['DOCUMENTS', 'PRINT_FILES'] : ['DOCUMENTS']) {
            for await (const object of io.listSourceObjects(binding, plan)) {
                const copied = await io.copyPrivateObject(binding, object, plan);
                assert.equal(await io.verifyPrivateCopy(copied, plan), true);
                objects++;
            }
        }
        // Includes D1->R2 references, source mutations, approved deletion semantics and print exclusions.
        assert.equal(await io.verifySnapshotConsistency(plan), true);
        const manifest = await io.finishPrivateManifest(plan);
        assert.match(manifest.sha256 || '', /^[a-f0-9]{64}$/);
        return { operation, verified: true, sql_sha256: sqlCopy.sha256, objects, manifest_sha256: manifest.sha256 };
    }
    const isolation = await io.verifyIsolation(plan);
    for (const key of ['no_production_write', 'no_routes', 'no_crons', 'no_external_services', 'egress_denied', 'no_live_secrets']) assert.equal(isolation[key], true);
    const backup = await io.readVerifiedPrivateBackup(plan);
    await io.restoreSqlIntoIsolatedTarget(backup, plan);
    await io.restoreObjectsIntoIsolatedTarget(backup, plan);
    const checks = await io.verifyRestore(plan);
    for (const key of ['integrity', 'foreign_keys', 'schema', 'ledger', 'row_hashes', 'objects', 'metadata', 'references', 'deletion_policy', 'no_job_replay']) assert.equal(checks[key], true);
    return { operation, verified: true, report_sha256: digest(checks) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const policy = JSON.parse(readFileSync(new URL('../../config/recovery-operations.json', import.meta.url), 'utf8'));
        const c = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')).env.production;
        approveOperation(policy, { account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
            database_id: c.d1_databases[0].database_id, document_bucket: c.r2_buckets[0].bucket_name, print_bucket: c.r2_buckets[1].bucket_name }, process.argv[2]);
        throw new Error('Reviewed private-storage adapter not configured.');
    } catch { console.error('Recovery operations locked or adapters unconfigured; no export, copy, restore or successful evidence produced.'); process.exitCode = 1; }
}
