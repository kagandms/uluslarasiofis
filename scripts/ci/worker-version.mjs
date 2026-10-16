import assert from 'node:assert/strict';

export function singleWorkerVersion(result) {
    const active = result?.deployments?.[0]?.versions;
    assert.ok(Array.isArray(active) && active.length === 1 && active[0].percentage === 100,
        'Rollback readiness requires one active Worker version at 100 percent.');
    assert.match(active[0].version_id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 'Active Worker version metadata is invalid.');
    return active[0].version_id;
}
