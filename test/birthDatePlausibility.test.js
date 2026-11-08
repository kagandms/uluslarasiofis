import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPlausibleBirthDate } from '../src/shared/age.js';

test('birth date plausibility accepts real past dates within 100 years', () => {
    assert.equal(isPlausibleBirthDate('2008-10-04', '2026-11-08'), true);
    assert.equal(isPlausibleBirthDate('1927-11-08', '2026-11-08'), true);
});

test('birth date plausibility rejects missing, invalid, future and implausibly old dates', () => {
    assert.equal(isPlausibleBirthDate(null, '2026-11-08'), false);
    assert.equal(isPlausibleBirthDate('', '2026-11-08'), false);
    assert.equal(isPlausibleBirthDate('2026-02-30', '2026-11-08'), false);
    assert.equal(isPlausibleBirthDate('2026-11-09', '2026-11-08'), false);
    assert.equal(isPlausibleBirthDate('1926-11-07', '2026-11-08'), false);
});
