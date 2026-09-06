import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTebligatDate } from '../src/utils/dateUtils.js';

test('should return the following Wednesday for a Monday delivery', () => {
    assert.equal(calculateTebligatDate('07.09.2026'), '16.09.2026 (Çarşamba)');
});

test('should return the following Wednesday for a Friday delivery', () => {
    assert.equal(calculateTebligatDate('11.09.2026'), '16.09.2026 (Çarşamba)');
});

test('should return the following Wednesday for a Wednesday delivery', () => {
    assert.equal(calculateTebligatDate('09.09.2026'), '16.09.2026 (Çarşamba)');
});
