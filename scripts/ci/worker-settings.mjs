import assert from 'node:assert/strict';

export function assertWorkerSettings(settings, production, compatibilityDate) {
    const expected = new Set(['ASSETS', 'DB', ...production.r2_buckets.map(b => b.binding), ...Object.keys(production.vars)]);
    for (const b of settings.bindings || []) {
        if (b.type === 'secret_text') continue; // Exact secret-name/type check is performed separately.
        assert.ok(expected.delete(b.name), 'Unexpected or duplicate live binding; normal publication stopped.');
    }
    assert.equal(expected.size, 0, 'Required live binding is missing.');
    assert.equal(settings.bindings.find(b => b.name === 'ASSETS')?.type, 'assets');
    assert.equal(settings.compatibility_date, compatibilityDate, 'Live compatibility date differs; separate configuration review required.');
    assert.deepEqual(settings.compatibility_flags || [], []);
    assert.ok(!settings.migration_tag, 'Durable Object migration state requires separate approval.');
}

export function settingsSnapshot(settings) {
    const snapshot = {};
    // Exclude code identifiers/timestamps; never capture secret values.
    for (const key of ['compatibility_date', 'compatibility_flags', 'placement', 'limits', 'cache_options',
        'logpush', 'observability', 'tail_consumers', 'streaming_tail_consumers', 'tags', 'usage_model']) {
        if (settings[key] !== undefined) snapshot[key] = settings[key];
    }
    snapshot.bindings = (settings.bindings || []).map(b => b.type === 'secret_text' ? { name: b.name, type: b.type } : b)
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return snapshot;
}

export function assertStagedVersion(version, previous, settings, sha) {
    assert.equal(version.annotations?.['workers/message'], `release:${sha}`);
    assert.deepEqual(settingsSnapshot({ bindings: version.resources?.bindings }).bindings, settingsSnapshot(settings).bindings,
        'Staged candidate did not inherit the approved live bindings.');
    assert.equal(version.resources?.script_runtime?.compatibility_date, settings.compatibility_date);
    assert.deepEqual(version.resources?.script_runtime?.compatibility_flags || [], settings.compatibility_flags || []);
    assert.deepEqual([...(version.resources?.script?.handlers || [])].sort(), [...previous.handlers].sort(),
        'Candidate changed live Worker handlers.');
}
