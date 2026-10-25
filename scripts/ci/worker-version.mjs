import assert from 'node:assert/strict';

export function singleWorkerVersion(result) {
    const active = result?.deployments?.[0]?.versions;
    assert.ok(Array.isArray(active) && active.length === 1 && active[0].percentage === 100,
        'Publication requires one active Worker version at 100 percent.');
    assert.match(active[0].version_id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 'Active Worker version metadata is invalid.');
    return active[0].version_id;
}

// The unfiltered first page is newest-first (also used by pinned Wrangler's secret metadata CLI).
export function latestUploadedVersion(result) {
    const items = result?.items;
    assert.ok(Array.isArray(items) && items.length > 0, 'Latest uploaded Worker version metadata is missing.');
    const first = items[0];
    assert.match(first?.id || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.ok(Number.isSafeInteger(first.number) && first.number > 0, 'Latest version sequence number is missing.');
    assert.ok(items.every(v => Number.isSafeInteger(v.number) && v.number > 0 && v.number <= first.number),
        'Worker version list is not newest-first; inheritance blocked.');
    assert.ok(items.slice(1).every(v => v.number < first.number), 'Ambiguous latest Worker version sequence.');
    return first.id;
}

export async function assertUploadHead(api, approvedActive, expectedLatest = approvedActive) {
    const [deployments, versions] = await Promise.all([
        api('/workers/scripts/goc/deployments'), api('/workers/scripts/goc/versions')
    ]);
    assert.equal(singleWorkerVersion(deployments), approvedActive, 'Active Worker changed; inheritance blocked.');
    assert.equal(latestUploadedVersion(versions), expectedLatest,
        'Latest uploaded Worker differs from the approved inheritance source; inspect without retrying.');
}

export function readOnlyVersionReport(deployments, versions) {
    const active = singleWorkerVersion(deployments);
    const latest = latestUploadedVersion(versions);
    const created = deployments.deployments[0].created_on;
    assert.ok(typeof created === 'string' && Number.isFinite(Date.parse(created)), 'Deployment timestamp unavailable.');
    return { worker: 'goc', active_version: active, latest_uploaded_version: latest,
        deployed_at: new Date(created).toISOString(), latest_matches_active: latest === active };
}

export async function assertPreflightVersion(report, context = {}, readVersion) {
    const staged = context.staged;
    if (context.expectedActiveReleaseSha) {
        assert.match(context.expectedActiveReleaseSha, /^[a-f0-9]{40}$/);
        assert.notEqual(report.active_version, context.approvedActive);
        assert.equal(report.latest_uploaded_version, report.active_version);
        const active = await readVersion(report.active_version);
        assert.equal(active.annotations?.['workers/message'], `release:${context.expectedActiveReleaseSha}`);
        return;
    }
    if (staged) {
        // The publisher may have just staged its own version; this is never an arbitrary latest bypass.
        assert.ok(['publish', 'cron-release'].includes(context.operation));
        assert.equal(report.active_version, context.approvedActive);
        assert.match(staged, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
        assert.match(context.sha || '', /^[a-f0-9]{40}$/);
        const candidate = await readVersion(staged);
        assert.equal(candidate.annotations?.['workers/message'], `release:${context.sha}`);
    }
    assert.equal(report.latest_uploaded_version, staged || report.active_version,
        'Latest uploaded Worker differs from the approved inheritance source/candidate; publication stopped for review.');
}
