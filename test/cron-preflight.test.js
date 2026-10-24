import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionCronSchedules } from '../scripts/ci/cron-preflight.mjs';

const activeVersion = 'c0a250d6-4ef8-4eff-bd27-b40246b5a5f9';
const previousCrons = ['* * * * *', '0 0 * * *'];
const targetCrons = ['*/5 * * * *', '*/15 * * * *', '0 1 1 * *', '0 0 * * *'];
const now = Date.parse('2026-10-24T18:40:00Z');
const evidence = {
    environment: 'production', result: 'passed', verified_at: '2026-10-24T15:23:24Z',
    current_version_id: activeVersion, compatibility: { cron_schedules: true },
    runtime_metadata: { active_crons: previousCrons }
};

test('accepts the release target cron schedules', () => {
    assert.equal(assertProductionCronSchedules(targetCrons, targetCrons, {}, 'other-version', now), 'target');
});

test('accepts only the fresh reviewed active schedules while the active Worker is unchanged', () => {
    assert.equal(assertProductionCronSchedules(previousCrons, targetCrons, evidence, activeVersion, now), 'reviewed-transition');
});

test('blocks unreviewed cron drift and a changed active Worker', () => {
    assert.throws(() => assertProductionCronSchedules(['* * * * *'], targetCrons, evidence, activeVersion, now));
    assert.throws(() => assertProductionCronSchedules(previousCrons, targetCrons, evidence, 'other-version', now));
});

test('blocks stale or failed transition evidence', () => {
    assert.throws(() => assertProductionCronSchedules(previousCrons, targetCrons,
        { ...evidence, verified_at: '2026-10-22T15:23:24Z' }, activeVersion, now));
    assert.throws(() => assertProductionCronSchedules(previousCrons, targetCrons,
        { ...evidence, result: 'not_verified' }, activeVersion, now));
});
