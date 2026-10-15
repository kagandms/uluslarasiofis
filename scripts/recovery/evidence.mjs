import { createHash, createPublicKey, verify } from 'node:crypto';

const HOUR = 3_600_000;
const roles = ['backup', 'restore', 'observation', 'rollback'];
const scopeFields = ['environment', 'repository', 'worker', 'account_id', 'database_id', 'document_bucket', 'print_bucket'];
const targetFields = ['account_id', 'database_id', 'document_bucket', 'print_bucket'];
const contractFields = ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars', 'worker', 'assets'];
const restoreChecks = ['sql_integrity', 'foreign_keys', 'schema', 'migration_ledger', 'row_counts', 'object_hashes', 'object_metadata', 'references', 'no_external_effects'];
const rollbackChecks = ['application_contract', 'print_scanner_contract', 'no_job_replay'];
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

export function requireApprovedPolicy(policy, source) {
    shape(policy, ['schema', 'enabled', 'keys', 'vault', 'restore_target', 'minimum_retention_hours']);
    need(policy.schema === 1 && policy.enabled === true, 'RECOVERY_POLICY_NOT_APPROVED');
    shape(source, scopeFields); account(source.account_id); uuid(source.database_id);
    bucket(source.document_bucket); bucket(source.print_bucket);
    shape(policy.vault, ['id', 'account_id', 'bucket']); uuid(policy.vault.id); account(policy.vault.account_id); bucket(policy.vault.bucket);
    target(policy.restore_target);
    need(policy.vault.account_id !== source.account_id && policy.restore_target.account_id !== source.account_id, 'RECOVERY_ACCOUNT_NOT_ISOLATED');
    need(policy.restore_target.database_id !== source.database_id
        && ![policy.restore_target.document_bucket, policy.restore_target.print_bucket, policy.vault.bucket].some(name => [source.document_bucket, source.print_bucket].includes(name))
        && ![policy.restore_target.document_bucket, policy.restore_target.print_bucket].includes(policy.vault.bucket), 'RECOVERY_TARGET_NOT_ISOLATED');
    need(Number.isSafeInteger(policy.minimum_retention_hours) && policy.minimum_retention_hours > 0 && policy.minimum_retention_hours <= 8760, 'RECOVERY_RETENTION_NOT_APPROVED');
    need(Array.isArray(policy.keys) && policy.keys.length >= 4 && policy.keys.length <= 20, 'RECOVERY_TRUST_NOT_CONFIGURED');
    const ids = new Set(), fingerprints = new Set();
    for (const key of policy.keys) {
        shape(key, ['id', 'role', 'public_key', 'producer_sha']);
        need(typeof key.producer_sha === 'string' && /^[a-f0-9]{40}$/.test(key.producer_sha), 'RECOVERY_INVALID_PRODUCER');
        need(typeof key.id === 'string' && /^[a-z0-9-]{4,64}$/.test(key.id) && !ids.has(key.id) && roles.includes(key.role), 'RECOVERY_INVALID_TRUST');
        need(typeof key.public_key === 'string' && key.public_key.length <= 4096 && key.public_key.startsWith('-----BEGIN PUBLIC KEY-----'), 'RECOVERY_INVALID_TRUST');
        const publicKey = createPublicKey(key.public_key);
        need(publicKey.asymmetricKeyType === 'ed25519', 'RECOVERY_INVALID_TRUST');
        const fingerprint = createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
        need(!fingerprints.has(fingerprint), 'RECOVERY_DUPLICATE_AUTHORITY'); fingerprints.add(fingerprint);
        ids.add(key.id);
    }
    roles.forEach(role => need(policy.keys.some(key => key.role === role), 'RECOVERY_TRUST_NOT_CONFIGURED'));
}
function contract(value) { shape(value, contractFields); contractFields.forEach(field => hash(value[field])); }
function detailShape(kind, d) {
    if (kind === 'backup') {
        shape(d, ['backup_id', 'captured_at', 'verified_at', 'bookmark_sha256', 'sql_sha256', 'sql_bytes', 'manifest_sha256', 'archive_sha256', 'archive_bytes',
            'storage_receipt_sha256', 'vault_id', 'retention_until', 'consistency', 'window_start', 'window_end', 'documents', 'print_files']);
        uuid(d.backup_id); uuid(d.vault_id);
        for (const field of ['bookmark_sha256', 'sql_sha256', 'manifest_sha256', 'archive_sha256', 'storage_receipt_sha256']) hash(d[field]);
        integer(d.sql_bytes); integer(d.archive_bytes); need(d.sql_bytes > 0 && d.archive_bytes > 0, 'RECOVERY_EMPTY_BACKUP');
        for (const group of ['documents', 'print_files']) {
            shape(d[group], ['objects', 'bytes', 'manifest_sha256']); integer(d[group].objects); integer(d[group].bytes); hash(d[group].manifest_sha256);
        }
        need(d.consistency === 'quiesced-window', 'RECOVERY_CONSISTENCY_NOT_PROVEN');
    } else if (kind === 'restore') {
        shape(d, ['backup_id', 'manifest_sha256', 'started_at', 'completed_at', 'target', 'report_sha256', 'checks', 'side_effects']);
        uuid(d.backup_id); hash(d.manifest_sha256); hash(d.report_sha256); target(d.target);
        checks(d.checks, restoreChecks); need(d.side_effects === 'disabled', 'RECOVERY_SIDE_EFFECTS_ENABLED');
    } else if (kind === 'observation') {
        shape(d, ['observed_at', 'current_version_id', 'current_contract_sha256', 'backup_id', 'manifest_sha256', 'vault_id', 'storage_receipt_sha256', 'archive_sha256', 'archive_bytes', 'retention_until']);
        uuid(d.current_version_id); uuid(d.backup_id); uuid(d.vault_id);
        hash(d.current_contract_sha256); hash(d.manifest_sha256); hash(d.storage_receipt_sha256); hash(d.archive_sha256); integer(d.archive_bytes);
    } else {
        shape(d, ['release_sha', 'current_version_id', 'target_version_id', 'verified_at', 'backup_id', 'restore_id', 'current_contract', 'target_contract', 'report_sha256', 'checks']);
        need(typeof d.release_sha === 'string' && /^[a-f0-9]{40}$/.test(d.release_sha), 'RECOVERY_INVALID_RELEASE_SHA');
        for (const field of ['current_version_id', 'target_version_id', 'backup_id', 'restore_id']) uuid(d[field]);
        hash(d.report_sha256); contract(d.current_contract); contract(d.target_contract); checks(d.checks, rollbackChecks);
    }
}

// Tests use synthetic scopes/ephemeral keys. The production CLI pins its policy and context.
export function verifyRecoveryEvidence(bundle, policy, context, now = Date.now(), mode = 'backup') {
    need(Number.isFinite(now) && ['backup', 'rollback'].includes(mode), 'RECOVERY_INVALID_CONTEXT');
    requireApprovedPolicy(policy, context.source); shape(bundle, ['schema', 'records']);
    need(bundle.schema === 1 && Array.isArray(bundle.records) && bundle.records.length >= 3 && bundle.records.length <= 4, 'RECOVERY_INVALID_BUNDLE');
    const records = new Map(), ids = new Set();
    for (const envelope of bundle.records) {
        shape(envelope, ['key_id', 'payload', 'signature']);
        const p = envelope.payload; shape(p, ['schema', 'kind', 'id', 'issued_at', 'source', 'producer_sha', 'run_id', 'details']);
        need(p.schema === 1 && roles.includes(p.kind) && !records.has(p.kind) && !ids.has(p.id), 'RECOVERY_INVALID_RECORD'); uuid(p.id); ids.add(p.id);
        shape(p.source, scopeFields); need(canonical(p.source) === canonical(context.source), 'RECOVERY_WRONG_SOURCE');
        const key = policy.keys.find(item => item.id === envelope.key_id && item.role === p.kind);
        need(key && typeof envelope.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature), 'RECOVERY_SIGNATURE_REQUIRED');
        need(p.producer_sha === key.producer_sha && typeof p.run_id === 'string' && /^[1-9][0-9]{0,19}$/.test(p.run_id), 'RECOVERY_PRODUCER_MISMATCH');
        const publicKey = createPublicKey(key.public_key);
        need(verify(null, Buffer.from(canonical(p)), publicKey, Buffer.from(envelope.signature, 'base64')), 'RECOVERY_SIGNATURE_INVALID');
        const issued = fresh(p.issued_at, now, p.kind === 'observation' ? 0.25 : p.kind === 'restore' ? 720 : 24);
        detailShape(p.kind, p.details);
        records.set(p.kind, { ...p, issued, signer: createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex') });
    }
    const b = records.get('backup'), r = records.get('restore'), o = records.get('observation');
    need(b && r && o, 'RECOVERY_INCOMPLETE_BUNDLE');
    const bd = b.details, rd = r.details, od = o.details;
    need(b.signer !== r.signer, 'RECOVERY_INDEPENDENT_RESTORE_REQUIRED');
    const captured = fresh(bd.captured_at, now, 24), verified = fresh(bd.verified_at, now, 24);
    const start = timestamp(bd.window_start), end = timestamp(bd.window_end);
    need(start <= captured && captured <= end && end <= verified && verified <= b.issued && end - start <= 0.25 * HOUR, 'RECOVERY_INVALID_CONSISTENCY_WINDOW');
    need(bd.vault_id === policy.vault.id && timestamp(bd.retention_until) >= now + policy.minimum_retention_hours * HOUR, 'RECOVERY_RETENTION_OR_VAULT_MISMATCH');
    need(rd.backup_id === bd.backup_id && rd.manifest_sha256 === bd.manifest_sha256, 'RECOVERY_RESTORE_BACKUP_MISMATCH');
    need(canonical(rd.target) === canonical(policy.restore_target), 'RECOVERY_RESTORE_TARGET_MISMATCH');
    const restored = fresh(rd.completed_at, now, 720);
    need(b.issued <= timestamp(rd.started_at) && timestamp(rd.started_at) <= restored && restored <= r.issued, 'RECOVERY_RESTORE_TIME_INVALID');
    const observed = fresh(od.observed_at, now, 0.25);
    need(r.issued <= observed && observed <= o.issued && od.backup_id === bd.backup_id && od.manifest_sha256 === bd.manifest_sha256
        && od.vault_id === bd.vault_id && od.storage_receipt_sha256 === bd.storage_receipt_sha256
        && od.archive_sha256 === bd.archive_sha256 && od.archive_bytes === bd.archive_bytes && od.retention_until === bd.retention_until, 'RECOVERY_OBSERVATION_MISMATCH');
    if (mode === 'rollback') {
        const rollback = records.get('rollback'); need(rollback, 'RECOVERY_ROLLBACK_REQUIRED');
        const d = rollback.details, checked = fresh(d.verified_at, now, 24);
        need(d.release_sha === context.releaseSha && d.current_version_id === od.current_version_id && d.target_version_id !== d.current_version_id
            && d.backup_id === bd.backup_id && d.restore_id === r.id && digest(d.current_contract) === od.current_contract_sha256, 'RECOVERY_ROLLBACK_CONTEXT_MISMATCH');
        need(r.issued <= checked && checked <= rollback.issued && rollback.issued <= observed, 'RECOVERY_ROLLBACK_TIME_INVALID');
        for (const field of ['schema', 'migrations', 'secrets', 'bindings', 'crons', 'vars']) need(d.current_contract[field] === d.target_contract[field], 'RECOVERY_ROLLBACK_CONTRACT_DRIFT');
    }
    return { verified: true, mode };
}
