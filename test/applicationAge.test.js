import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateUnder18 } from '../src/shared/age.js';

test('age calculation treats the eighteenth birthday as adult on that date', () => {
    assert.equal(calculateUnder18('2008-10-04', '2026-10-03'), true);
    assert.equal(calculateUnder18('2008-10-04', '2026-10-04'), false);
    assert.equal(calculateUnder18('2008-10-04', '2026-10-05'), false);
});

test('age calculation returns unknown for invalid or future calendar dates', () => {
    assert.equal(calculateUnder18('', '2026-10-04'), null);
    assert.equal(calculateUnder18('2008-02-30', '2026-10-04'), null);
    assert.equal(calculateUnder18('2027-01-01', '2026-10-04'), null);
});
