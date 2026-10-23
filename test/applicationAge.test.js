import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateGssRegistrationDeadline, calculateUnder18 } from '../src/shared/age.js';

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

test('February 29 reaches eighteen on February 28 in a non-leap year', () => {
    assert.equal(calculateUnder18('2008-02-29', '2026-02-27'), true);
    assert.equal(calculateUnder18('2008-02-29', '2026-02-28'), false);
    assert.equal(calculateUnder18('2008-02-29', '2026-03-01'), false);
});

test('GSS deadline is three calendar months after registration and clamps month ends', () => {
    assert.equal(calculateGssRegistrationDeadline('2026-08-23'), '2026-11-23');
    assert.equal(calculateGssRegistrationDeadline('2026-11-30'), '2027-02-28');
    assert.equal(calculateGssRegistrationDeadline('invalid'), null);
});
