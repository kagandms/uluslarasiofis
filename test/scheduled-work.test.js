import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getScheduledWork } from '../src/server/services/scheduled-work.js';

test('local and production Workers use one five-minute Cron Trigger', () => {
    const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.deepEqual(config.triggers.crons, ['*/5 * * * *']);
    assert.deepEqual(config.env.production.triggers.crons, ['*/5 * * * *']);
    assert.deepEqual(config.env.staging.triggers.crons, []);
});

test('one five-minute cron preserves scanner, print, daily, and monthly schedules in UTC', () => {
    assert.deepEqual(getScheduledWork(new Date('2026-10-07T12:05:00.000Z')), {
        shouldRunScannerMaintenance: true,
        shouldRunPrintCleanup: false,
        shouldRunDailyMaintenance: false,
        shouldRunReceiptCleanup: false,
        shouldSweepReceiptOrphans: false
    });
    assert.deepEqual(getScheduledWork(new Date('2026-10-07T12:15:00.000Z')), {
        shouldRunScannerMaintenance: true,
        shouldRunPrintCleanup: true,
        shouldRunDailyMaintenance: false,
        shouldRunReceiptCleanup: false,
        shouldSweepReceiptOrphans: false
    });
    assert.deepEqual(getScheduledWork(new Date('2026-10-07T00:00:00.000Z')), {
        shouldRunScannerMaintenance: true,
        shouldRunPrintCleanup: true,
        shouldRunDailyMaintenance: true,
        shouldRunReceiptCleanup: true,
        shouldSweepReceiptOrphans: false
    });
    assert.deepEqual(getScheduledWork(new Date('2026-11-01T01:00:00.000Z')), {
        shouldRunScannerMaintenance: true,
        shouldRunPrintCleanup: true,
        shouldRunDailyMaintenance: false,
        shouldRunReceiptCleanup: true,
        shouldSweepReceiptOrphans: true
    });
});

test('scheduled work rejects an invalid event timestamp', () => {
    assert.throws(() => getScheduledWork('invalid-time'), TypeError);
});
