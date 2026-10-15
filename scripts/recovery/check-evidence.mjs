import { readFileSync, lstatSync } from 'node:fs';
import { requireApprovedPolicy, verifyRecoveryEvidence } from './evidence.mjs';

export function checkEvidence(mode) {
    try {
        const policy = JSON.parse(readFileSync(new URL('../../config/recovery-trust.json', import.meta.url), 'utf8'));
        // Stop before reading evidence while recovery authority/targets remain unapproved.
        if (policy.enabled !== true) throw new Error('RECOVERY_POLICY_NOT_APPROVED');
        const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')).env.production;
        const context = { releaseSha: process.env.RELEASE_SHA, currentVersion: process.env.CURRENT_WORKER_VERSION, runId: process.env.RECOVERY_RUN_ID, source: {
            environment: 'production', repository: 'kagandms/uluslarasiofis', worker: config.name,
            account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
            database_id: config.d1_databases.find(item => item.binding === 'DB').database_id,
            document_bucket: config.r2_buckets.find(item => item.binding === 'DOCUMENTS').bucket_name,
            print_bucket: config.r2_buckets.find(item => item.binding === 'PRINT_FILES').bucket_name
        } };
        if (!/^[a-f0-9]{40}$/.test(context.releaseSha || '') || context.source.worker !== 'goc') throw new Error('RECOVERY_INVALID_CONTEXT');
        requireApprovedPolicy(policy, context.source);
        const path = process.argv[2] || 'docs/recovery/production-evidence.json';
        const info = lstatSync(path);
        if (!path.endsWith('.json') || !info.isFile() || info.isSymbolicLink() || info.size > 262_144) throw new Error('RECOVERY_EVIDENCE_FILE_INVALID');
        const bundle = JSON.parse(readFileSync(path, 'utf8'));
        // The real clock cannot be overridden with EVIDENCE_NOW or an evidence field.
        verifyRecoveryEvidence(bundle, policy, context, Date.now(), mode);
        console.log(`Signed production ${mode} evidence verified; metadata only.`);
    } catch (error) {
        const code = /^RECOVERY_[A-Z_]+$/.test(error.message || '') ? error.message : 'RECOVERY_EVIDENCE_INVALID_OR_UNAVAILABLE';
        console.error(`${code}: publication blocked; no backup, restore or rollback was executed.`);
        process.exitCode = 1;
    }
}
