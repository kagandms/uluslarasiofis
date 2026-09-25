import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClockTime, formatClockDate, initLiveClock } from '../src/ui/liveClock.js';

test('formatClockTime formats hours, minutes, seconds with zero padding', () => {
    const d1 = new Date(2026, 8, 25, 9, 5, 4);
    assert.equal(formatClockTime(d1), '09:05:04');

    const d2 = new Date(2026, 8, 25, 23, 59, 59);
    assert.equal(formatClockTime(d2), '23:59:59');

    const d3 = new Date(2026, 8, 25, 0, 0, 0);
    assert.equal(formatClockTime(d3), '00:00:00');
});

test('formatClockDate formats date in Turkish locale', () => {
    // 25 Eylül 2026 is a Friday
    const d = new Date(2026, 8, 25, 12, 0, 0);
    const formatted = formatClockDate(d, 'tr-TR');
    assert.match(formatted, /25/);
    assert.match(formatted, /Eylül/i);
    assert.match(formatted, /2026/);
    assert.match(formatted, /Cuma/i);
});

test('initLiveClock updates mock elements and handles cleanup without error', () => {
    const mockTimeEl = { textContent: '' };
    const mockDateEl = { textContent: '' };

    const destroy = initLiveClock({
        timeElement: mockTimeEl,
        dateElement: mockDateEl
    });

    assert.match(mockTimeEl.textContent, /^\d{2}:\d{2}:\d{2}$/);
    assert.ok(mockDateEl.textContent.length > 5);

    assert.equal(typeof destroy, 'function');
    destroy();
});
