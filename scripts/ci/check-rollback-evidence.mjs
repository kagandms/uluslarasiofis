import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'docs/production-only-evidence/rollback-compatibility.json';
const evidence = JSON.parse(readFileSync(path, 'utf8'));
const now = new Date(process.env.EVIDENCE_NOW || Date.now());
assert.equal(evidence.environment, 'production', 'Rollback evidence must identify production.');
assert.match(evidence.verified_at || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/, 'Rollback evidence must include a UTC verification timestamp.');
assert.match(evidence.current_version_id || '', /^[A-Za-z0-9_-]{8,128}$/, 'Current Worker version ID is required.');
assert.match(evidence.rollback_version_id || '', /^[A-Za-z0-9_-]{8,128}$/, 'Rollback Worker version ID is required.');
assert.match(evidence.evidence_ref || '', /^https:\/\/.+|^[a-f0-9]{64}$/, 'Rollback compatibility evidence must include a URL or SHA-256 reference.');
assert.equal(evidence.result, 'passed', 'Rollback compatibility review must have passed.');
for (const check of ['schema', 'runtime_secrets', 'd1_r2_bindings', 'cron_schedules']) {
    assert.equal(evidence.compatibility?.[check], true, `Rollback compatibility must be verified for ${check}.`);
}
const age = now - Date.parse(evidence.verified_at);
assert.ok(Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000, 'Rollback compatibility evidence must be no older than 24 hours.');
console.log('Production rollback compatibility evidence passed.');
