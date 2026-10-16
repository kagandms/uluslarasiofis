import { createHash, createPublicKey, verify } from 'node:crypto';

const HOUR = 3_600_000;
const scopeFields = ['environment', 'repository', 'worker', 'account_id', 'database_id', 'document_bucket', 'print_bucket'];
const targetFields = ['account_id', 'database_id', 'document_bucket', 'print_bucket'];
const contractFields = ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars', 'worker', 'assets'];
const restoreChecks = ['sql_integrity', 'foreign_keys', 'schema', 'migration_ledger', 'row_counts', 'object_hashes', 'object_metadata', 'references', 'no_external_effects'];
const need = (ok, code) => { if (!ok) throw new Error(code); };
const shape = (value, fields) => need(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && Object.keys(value).sort().every((key, index) => key === [...fields].sort()[index]), 'RECOVERY_INVALID_SHAPE');
const hash = value => need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'RECOVERY_INVALID_SHA256');
const uuid = value => need(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), 'RECOVERY_INVALID_ID');
const account = value => need(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'RECOVERY_INVALID_ACCOUNT');
const bucket = value => need(typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value), 'RECOVERY_INVALID_BUCKET');
const integer = value => need(Number.isSafeInteger(value) && value >= 0, 'RECOVERY_INVALID_COUNT');
const checks = (value, fields) => { shape(value, fields); fields.forEach(field => need(value[field] === true, 'RECOVERY_CHECK_FAILED')); };

export function canonical(value, depth = 0) {
    need(depth < 16, 'RECOVERY_EXCESSIVE_DEPTH');
    if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
    if (value && typeof value === 'object') {
        need([Object.prototype, null].includes(Object.getPrototypeOf(value)), 'RECOVERY_NON_JSON_OBJECT');
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
    }
    need(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)), 'RECOVERY_INVALID_JSON');
    return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function timestamp(value) {
    need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 'RECOVERY_INVALID_TIME');
    const parsed = Date.parse(value);
    need(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'RECOVERY_INVALID_TIME');
    return parsed;
}
function fresh(value, now, hours) {
    const time = timestamp(value);
    need(time <= now && now - time <= hours * HOUR, 'RECOVERY_STALE_OR_FUTURE');
    return time;
}
function target(value) {
    shape(value, targetFields);
    account(value.account_id); uuid(value.database_id); bucket(value.document_bucket); bucket(value.print_bucket);
    need(value.document_bucket !== value.print_bucket, 'RECOVERY_TARGET_COLLISION');
}

// One reviewed maintenance identity/key; no controller or independent signing authorities.
// Same-account isolated resources are permitted, but do not cover account loss.
export function requireApprovedPolicy(policy, source) {
    shape(policy, ['schema', 'enabled', 'signer', 'vault', 'restore_target', 'minimum_retention_hours']);
    need(policy.schema === 2 && policy.enabled === true, 'RECOVERY_POLICY_NOT_APPROVED');
    shape(source, scopeFields); account(source.account_id); uuid(source.database_id);
    bucket(source.document_bucket); bucket(source.print_bucket);
    shape(policy.signer, ['public_key', 'producer_sha']);
    need(typeof policy.signer.producer_sha === 'string' && /^[a-f0-9]{40}$/.test(policy.signer.producer_sha), 'RECOVERY_INVALID_PRODUCER');
    need(typeof policy.signer.public_key === 'string' && policy.signer.public_key.length <= 4096
        && policy.signer.public_key.startsWith('-----BEGIN PUBLIC KEY-----'), 'RECOVERY_TRUST_NOT_CONFIGURED');
    need(createPublicKey(policy.signer.public_key).asymmetricKeyType === 'ed25519', 'RECOVERY_TRUST_NOT_CONFIGURED');
    shape(policy.vault, ['id', 'account_id', 'bucket']); uuid(policy.vault.id); account(policy.vault.account_id); bucket(policy.vault.bucket);
    target(policy.restore_target);
    need(policy.restore_target.database_id !== source.database_id
        && ![policy.restore_target.document_bucket, policy.restore_target.print_bucket, policy.vault.bucket].some(name => [source.document_bucket, source.print_bucket].includes(name))
        && ![policy.restore_target.document_bucket, policy.restore_target.print_bucket].includes(policy.vault.bucket), 'RECOVERY_TARGET_NOT_ISOLATED');
    need(Number.isSafeInteger(policy.minimum_retention_hours) && policy.minimum_retention_hours > 0 && policy.minimum_retention_hours <= 8760, 'RECOVERY_RETENTION_NOT_APPROVED');
}

// Signed metadata only. The producer must verify real storage and test results before signing.
// A signature authenticates that producer, not an independently repeated backup/restore.
export function verifyRecoveryEvidence(bundle, policy, context, now = Date.now(), mode = 'backup') {
    need(Number.isFinite(now) && ['backup', 'rollback'].includes(mode), 'RECOVERY_INVALID_CONTEXT');
    requireApprovedPolicy(policy, context.source);
    shape(bundle, ['payload', 'signature']);
    const p = bundle.payload;
    shape(p, ['schema', 'source', 'producer_sha', 'run_id', 'backup', 'restore', 'rollback']);
    need(p.schema === 2 && p.producer_sha === policy.signer.producer_sha
        && typeof p.run_id === 'string' && /^[1-9][0-9]{0,19}$/.test(p.run_id) && p.run_id === context.runId, 'RECOVERY_PRODUCER_MISMATCH');
    shape(p.source, scopeFields); need(canonical(p.source) === canonical(context.source), 'RECOVERY_WRONG_SOURCE');
    need(typeof bundle.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(bundle.signature), 'RECOVERY_SIGNATURE_REQUIRED');
    need(verify(null, Buffer.from(canonical(p)), createPublicKey(policy.signer.public_key), Buffer.from(bundle.signature, 'base64')), 'RECOVERY_SIGNATURE_INVALID');
    const b = p.backup, r = p.restore;
    shape(b, ['id', 'captured_at', 'verified_at', 'contract', 'bookmark_sha256', 'sql_sha256', 'sql_bytes',
        'manifest_sha256', 'archive_sha256', 'archive_bytes', 'storage_receipt_sha256', 'vault_id', 'retention_until', 'documents', 'print_files', 'consistency_report_sha256']);
    uuid(b.id); uuid(b.vault_id);
    for (const field of ['contract', 'bookmark_sha256', 'sql_sha256', 'manifest_sha256', 'archive_sha256', 'storage_receipt_sha256', 'consistency_report_sha256']) hash(b[field]);
    integer(b.sql_bytes); integer(b.archive_bytes); need(b.sql_bytes > 0 && b.archive_bytes > 0, 'RECOVERY_EMPTY_BACKUP');
    for (const group of ['documents', 'print_files']) {
        shape(b[group], ['objects', 'bytes', 'manifest_sha256']); integer(b[group].objects); integer(b[group].bytes); hash(b[group].manifest_sha256);
    }
    const captured = fresh(b.captured_at, now, 24), verified = fresh(b.verified_at, now, 24);
    need(captured <= verified, 'RECOVERY_BACKUP_TIME_INVALID');
    need(b.vault_id === policy.vault.id && timestamp(b.retention_until) >= now + policy.minimum_retention_hours * HOUR, 'RECOVERY_RETENTION_OR_VAULT_MISMATCH');
    shape(r, ['backup_id', 'contract', 'manifest_sha256', 'started_at', 'completed_at', 'target', 'report_sha256', 'checks', 'side_effects']);
    uuid(r.backup_id); hash(r.contract); hash(r.manifest_sha256); hash(r.report_sha256); target(r.target);
    checks(r.checks, restoreChecks); need(r.side_effects === 'disabled', 'RECOVERY_SIDE_EFFECTS_ENABLED');
    // A monthly drill can cover later backups of the SAME producer/format/schema contract.
    // Never refresh completed_at by re-signing; changing the producer or contract invalidates it.
    need(r.contract === b.contract && canonical(r.target) === canonical(policy.restore_target), 'RECOVERY_RESTORE_SCOPE_MISMATCH');
    need(timestamp(r.started_at) <= fresh(r.completed_at, now, 720), 'RECOVERY_RESTORE_TIME_INVALID');
    if (mode === 'rollback') {
        const d = p.rollback;
        shape(d, ['release_sha', 'current_version_id', 'target_version_id', 'verified_at', 'current_contract', 'target_contract', 'report_sha256', 'checks']);
        uuid(d.current_version_id); uuid(d.target_version_id); hash(d.report_sha256);
        fresh(d.verified_at, now, 24);
        need(typeof context.releaseSha === 'string' && /^[a-f0-9]{40}$/.test(context.releaseSha)
            && d.release_sha === context.releaseSha && d.current_version_id === context.currentVersion
            && d.target_version_id !== d.current_version_id, 'RECOVERY_ROLLBACK_CONTEXT_MISMATCH');
        checks(d.checks, ['application_contract', 'print_scanner_contract', 'no_job_replay']);
        for (const c of [d.current_contract, d.target_contract]) { shape(c, contractFields); contractFields.forEach(field => hash(c[field])); }
        for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars']) need(d.current_contract[field] === d.target_contract[field], 'RECOVERY_ROLLBACK_CONTRACT_DRIFT');
        need(b.contract === digest({ schema: d.current_contract.schema, migrations: d.current_contract.migrations, format: 2, producer_sha: p.producer_sha }), 'RECOVERY_CONTRACT_MISMATCH');
    } else need(p.rollback === null || (typeof p.rollback === 'object' && !Array.isArray(p.rollback)), 'RECOVERY_INVALID_SHAPE');
    return { verified: true, mode };
}
