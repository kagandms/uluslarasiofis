import assert from 'node:assert/strict';

export function assertProductionCronSchedules(actualCrons, targetCrons, evidence, activeVersion, now = Date.now()) {
    const actual = [...actualCrons].sort();
    const target = [...targetCrons].sort();
    if (JSON.stringify(actual) === JSON.stringify(target)) return 'target';

    assert.equal(evidence?.environment, 'production', 'Cron transition evidence must identify production.');
    assert.equal(evidence?.result, 'passed', 'Cron transition requires passed rollback evidence.');
    assert.equal(evidence?.compatibility?.cron_schedules, true, 'Cron transition requires reviewed cron compatibility.');
    assert.match(evidence?.verified_at || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/,
        'Cron transition evidence must include a UTC verification timestamp.');
    const age = now - Date.parse(evidence.verified_at);
    assert.ok(Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000,
        'Cron transition evidence must be no older than 24 hours.');
    assert.match(evidence.current_version_id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
        'Cron transition evidence must identify the active Worker version.');
    assert.equal(activeVersion, evidence.current_version_id,
        'The active Worker changed since the reviewed cron transition baseline.');
    assert.deepEqual(actual, [...(evidence.runtime_metadata?.active_crons || [])].sort(),
        'Production cron schedules differ from both the target and reviewed active baseline.');
    return 'reviewed-transition';
}

export function assertProductionCronTransition(actualCrons, targetCrons, evidence, activeVersion, liveWorkerSha,
    now = Date.now(), expectedReleaseSha = null) {
    assert.equal(evidence?.environment, 'production');
    assert.equal(evidence?.result, 'passed');
    assert.match(evidence?.verified_at || '', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
    const age = now - Date.parse(evidence.verified_at);
    assert.ok(Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000, 'Cron baseline must be no older than 24 hours.');
    const isBaselineVersion = activeVersion === evidence.active_worker_version && liveWorkerSha === evidence.active_worker_sha;
    const isVerifiedRelease = typeof expectedReleaseSha === 'string'
        && /^[a-f0-9]{40}$/.test(expectedReleaseSha)
        && activeVersion !== evidence.active_worker_version && liveWorkerSha === expectedReleaseSha;
    assert.ok(isBaselineVersion || isVerifiedRelease,
        'Active Worker must match the reviewed baseline or the exact published release candidate.');
    assert.deepEqual([...actualCrons].sort(), [...evidence.active_crons].sort(), 'Production cron schedules drifted before update.');
    assert.deepEqual([...targetCrons].sort(), [...evidence.target_crons].sort(), 'Cron target differs from reviewed production configuration.');
    return 'reviewed-transition';
}
