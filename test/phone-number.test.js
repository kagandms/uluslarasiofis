import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPhoneNumber } from '../src/shared/phoneNumber.js';
import { parsePhoneInput } from '../src/public/phoneField.js';

test('copied international phones ignore Unicode direction and zero-width marks', () => {
    const copiedPhone = '\u200e+90\u200b 555 111 22 33\u202c';

    assert.equal(isValidPhoneNumber(copiedPhone), true);
    assert.equal(parsePhoneInput(copiedPhone, 'TR').e164, '+905551112233');
});

test('international validation rejects impossible country codes and invalid national prefixes', () => {
    assert.equal(isValidPhoneNumber('+9995551112233'), false);
    assert.equal(isValidPhoneNumber('+901111112233'), false);
    assert.equal(isValidPhoneNumber('call +905551112233'), false);
    assert.equal(isValidPhoneNumber(null), false);
});

test('phone validation allows plain spaces, rejects control whitespace, and enforces length limit', () => {
    assert.equal(isValidPhoneNumber('+90 555 111 22 33'), true);
    assert.equal(isValidPhoneNumber('0555 111 22 33'), true);
    assert.equal(isValidPhoneNumber('+90 555 111 22 33'), true);
    assert.equal(isValidPhoneNumber('0555 111 22 33'), true);

    assert.equal(isValidPhoneNumber('+90\n5551112233'), false);
    assert.equal(isValidPhoneNumber('+90\t5551112233'), false);
    assert.equal(isValidPhoneNumber('0555\n1112233'), false);
    assert.equal(isValidPhoneNumber('0555\t1112233'), false);

    assert.equal(isValidPhoneNumber(`+905551112233${'-'.repeat(100000)}`), false);
    assert.equal(isValidPhoneNumber(`05551112233${'-'.repeat(100000)}`), false);
});
