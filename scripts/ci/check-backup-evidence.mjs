import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'docs/production-only-evidence/production-only-backup-evidence.json';
const evidence = JSON.parse(readFileSync(path, 'utf8'));
const now = new Date(process.env.EVIDENCE_NOW || Date.now());
assert.equal(evidence.environment, 'production', 'Backup evidence must identify production.');
assert.match(evidence.backup_id || '', /^[A-Za-z0-9._:-]{8,200}$/, 'Backup evidence must include a provider backup identifier.');
assert.match(evidence.backup_verified_at || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/, 'Backup evidence must include a UTC verification timestamp.');
for (const key of ['d1_snapshot', 'd1_sql_export', 'r2_objects']) {
    assert.equal(evidence.coverage?.[key], true, `Verified backup coverage is required for ${key}.`);
}
assert.match(evidence.restore_drill?.verified_at || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/, 'A successful restore drill timestamp is required.');
assert.match(evidence.restore_drill?.evidence_ref || '', /^https:\/\/.+|^[a-f0-9]{64}$/, 'Restore drill evidence must include a URL or SHA-256 evidence reference.');
assert.equal(evidence.restore_drill?.result, 'passed', 'The latest restore drill must have passed.');
assert.equal(evidence.restore_drill?.coverage?.d1, true, 'Restore drill must include a D1 restore.');
assert.equal(evidence.restore_drill?.coverage?.r2, true, 'Restore drill must include an R2 object restore.');
const maxBackupAge = 24 * 60 * 60 * 1000;
const maxRestoreAge = 30 * 24 * 60 * 60 * 1000;
const backupAge = now - Date.parse(evidence.backup_verified_at);
const restoreAge = now - Date.parse(evidence.restore_drill.verified_at);
assert.ok(Number.isFinite(backupAge) && backupAge >= 0 && backupAge <= maxBackupAge, 'A verified production backup no older than 24 hours is required.');
assert.ok(Number.isFinite(restoreAge) && restoreAge >= 0 && restoreAge <= maxRestoreAge, 'A successful restore drill from the last 30 days is required.');
console.log('Production backup freshness and restore evidence passed.');
