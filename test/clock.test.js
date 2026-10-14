import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeClock, readSynchronizedNow } from '../src/shared/clock.js';
import { calculateCurrentUnder18 } from '../src/shared/age.js';

test('server Date synchronizes the clock and age across a wrong client calendar day', () => {
    const originalNow = Date.now;
    Date.now = () => Date.parse('2026-02-27T12:00:00Z');
    try {
        const startedAt = Date.now();

        assert.equal(synchronizeClock('Sat, 28 Feb 2026 12:00:00 GMT', { startedAt, receivedAt: startedAt }), true);
        assert.equal(readSynchronizedNow().toISOString(), '2026-02-28T12:00:00.000Z');
        assert.equal(calculateCurrentUnder18('2008-02-29'), false);
        assert.equal(synchronizeClock(null, { startedAt, receivedAt: startedAt }), false);
        assert.equal(readSynchronizedNow().toISOString(), '2026-02-28T12:00:00.000Z');
    } finally {
        synchronizeClock(new Date(Date.now()).toUTCString(), { startedAt: Date.now(), receivedAt: Date.now() });
        Date.now = originalNow;
    }
});

test('header clock uses Istanbul time and calendar day regardless of the browser timezone', async () => {
    const { formatClockTime, formatClockDate } = await import('../src/ui/liveClock.js');
    const instant = new Date('2026-02-27T21:05:09Z');

    assert.equal(formatClockTime(instant), '00:05:09');
    assert.match(formatClockDate(instant, 'tr-TR'), /28 Şubat 2026/);
});
