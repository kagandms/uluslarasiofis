import test from 'node:test';
import assert from 'node:assert/strict';
import { updateProductionCronSchedules } from '../scripts/ci/update-production-crons.mjs';

const activeVersion = '6b3c5d90-12bb-4a76-8847-e5bd7272be7f';
const activeSha = 'b'.repeat(40);
const current = ['* * * * *', '0 0 * * *'];
const target = ['*/5 * * * *', '*/15 * * * *', '0 1 1 * *', '0 0 * * *'];
const evidence = {
    environment: 'production', result: 'passed', verified_at: '2026-10-24T19:30:00Z',
    active_worker_version: activeVersion, active_worker_sha: activeSha,
    active_crons: current, target_crons: target
};

function createApi(schedules = current) {
    const calls = [];
    let liveSchedules = [...schedules];
    const api = async (path, options = {}) => {
        calls.push({ path, options });
        if (path.endsWith('/deployments')) return { deployments: [{ versions: [{ version_id: activeVersion, percentage: 100 }] }] };
        if (path.endsWith(`/versions/${activeVersion}`)) return { annotations: { 'workers/message': `release:${activeSha}` } };
        if (path.endsWith('/schedules') && options.method === 'PUT') {
            liveSchedules = JSON.parse(options.body).map(entry => entry.cron);
            return { schedules: liveSchedules.map(cron => ({ cron })) };
        }
        if (path.endsWith('/schedules')) return { schedules: liveSchedules.map(cron => ({ cron })) };
        throw new Error(`Unexpected API path: ${path}`);
    };
    return { api, calls };
}

test('writes the exact cron target once only after the active Worker and current list match evidence', async () => {
    const { api, calls } = createApi();
    const result = await updateProductionCronSchedules({
        api, target, evidence, now: Date.parse('2026-10-24T19:40:00Z')
    });

    assert.deepEqual(result, { activeVersion, schedules: target });
    assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
    assert.deepEqual(JSON.parse(calls.find(call => call.options.method === 'PUT').options.body), target.map(cron => ({ cron })));
    assert.equal(calls.at(-1).options.method, undefined);
});

test('does not write when the active version, source or current cron list drifted', async () => {
    for (const mutate of [
        (calls) => { calls.api = async (path, options = {}) => path.endsWith('/deployments')
            ? { deployments: [{ versions: [{ version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', percentage: 100 }] }] }
            : calls.originalApi(path, options); },
        (calls) => { calls.api = async (path, options = {}) => path.includes('/versions/')
            ? { annotations: { 'workers/message': 'release:' + 'c'.repeat(40) } }
            : calls.originalApi(path, options); }
    ]) {
        const state = createApi();
        state.originalApi = state.api;
        mutate(state);
        await assert.rejects(updateProductionCronSchedules({ api: state.api, target, evidence }));
        assert.equal(state.calls.filter(call => call.options.method === 'PUT').length, 0);
    }

    const mismatch = createApi(['* * * * *']);
    await assert.rejects(updateProductionCronSchedules({ api: mismatch.api, target, evidence }));
    assert.equal(mismatch.calls.filter(call => call.options.method === 'PUT').length, 0);
});

test('does not report success if Cloudflare read-back differs from the target', async () => {
    const base = createApi();
    const calls = [];
    const api = async (path, options = {}) => {
        calls.push({ path, options });
        if (path.endsWith('/schedules') && !options.method && calls.some(call => call.options.method === 'PUT')) {
            return { schedules: current.map(cron => ({ cron })) };
        }
        return base.api(path, options);
    };
    await assert.rejects(updateProductionCronSchedules({ api, target, evidence }));
});
