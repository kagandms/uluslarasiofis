import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createPhoneField, listPhoneCountryOptions, parsePhoneInput } from '../src/public/phoneField.js';
import { createNationalityField, listNationalityCountries, searchNationalityCountries } from '../src/public/nationalityField.js';
import { calculateDocumentReadiness, getReviewReadiness } from '../src/public/applicationWizard.js';

test('phone choices include translated labels and all supported calling regions', () => {
    const countries = listPhoneCountryOptions('tr');

    assert.ok(countries.length > 200);
    assert.ok(countries.some((country) => country.code === 'TR' && country.label.includes('+90')));
    assert.ok(countries.some((country) => country.code === 'TM' && country.label.includes('+993')));
});

test('phone parsing canonicalizes Turkish local input without duplicating its trunk zero', () => {
    const parsed = parsePhoneInput('0555 111 22 33', 'TR');

    assert.equal(parsed.e164, '+905551112233');
    assert.equal(parsed.isPossible, true);
});

test('international parsing retains Italy significant leading zero and avoids a second prefix', () => {
    const parsed = parsePhoneInput('+39 02 1234 5678', 'TR');

    assert.equal(parsed.e164, '+390212345678');
    assert.equal(parsed.country, 'IT');
    assert.match(parsed.formattedNational, /^02/u);
});

test('editing a phone with a selected country creates one canonical E.164 value', () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body></body></html>').window.document;
    const field = createPhoneField(document, {
        value: '', locale: 'tr', messages: { phone: 'Telefon', phoneCountryLabel: 'Ülke', phoneCountryChoose: 'Seç', phoneCountryHelp: 'Yardım', phoneCountryReview: 'Ülkeyi seçin', phoneCountryMismatch: 'Uyuşmadı', contactPhoneInvalid: 'Telefon geçersiz' }
    });
    const input = field.querySelector('[data-phone-visible]');

    input.value = '+90 555 111 22 33';
    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(field.querySelector('[name="student_phone"]').value, '+905551112233');
    assert.equal(field.querySelector('[name="phone_country"]').value, 'TR');
    document.defaultView.close();
});

test('legacy local phone values remain unchanged until the student edits the phone field', () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body></body></html>').window.document;
    const field = createPhoneField(document, {
        value: '61234567', locale: 'tr', messages: { phone: 'Telefon', phoneCountryLabel: 'Ülke', phoneCountryChoose: 'Seç', phoneCountryHelp: 'Yardım', phoneCountryReview: 'Ülkeyi seçin', phoneCountryMismatch: 'Uyuşmadı', contactPhoneInvalid: 'Telefon geçersiz' }
    });

    assert.equal(field.querySelector('[name="student_phone"]').value, '61234567');
    assert.equal(field.querySelector('[data-phone-visible]').value, '61234567');
    field.querySelector('[name="phone_country"]').value = 'TM';
    field.querySelector('[name="phone_country"]').dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    assert.equal(field.querySelector('[name="student_phone"]').value, '+99361234567');
    document.defaultView.close();
});

test('incomplete shared calling code input stays explicit and requests country review', () => {
    const parsed = parsePhoneInput('+1 200 000 0000', 'TR');

    assert.equal(parsed.isInternational, true);
    assert.equal(parsed.needsCountryReview, true);
    assert.equal(parsed.e164, '+12000000000');
});

test('nationality search handles Turkish accent variants and includes both Turk countries', () => {
    const plain = searchNationalityCountries('turk', 'tr');
    const accented = searchNationalityCountries('türk', 'tr');
    const codes = (results) => results.map((country) => country.code);

    assert.ok(codes(plain).includes('TR'));
    assert.ok(codes(plain).includes('TM'));
    assert.ok(codes(accented).includes('TR'));
    assert.ok(codes(accented).includes('TM'));
    assert.ok(listNationalityCountries('tr').length >= 240);
});

test('nationality suggestions preserve an existing free-text value', () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body></body></html>').window.document;
    const field = createNationalityField(document, { value: 'Türkmen', locale: 'tr', messages: { nationality: 'Uyruk' } });
    const nationality = field.querySelector('[name="nationality"]');
    document.body.append(field);
    nationality.value = 'Tür';
    nationality.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(nationality.value, 'Tür');
    assert.ok(field.querySelector('[role="listbox"]'));
    document.defaultView.close();
});

test('nationality suggestions can be selected with the keyboard and then close', () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body></body></html>').window.document;
    const field = createNationalityField(document, { value: '', locale: 'tr', messages: { nationality: 'Uyruk' } });
    const nationality = field.querySelector('[name="nationality"]');
    document.body.append(field);
    nationality.value = 'turkiye';
    nationality.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    nationality.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    const activeId = nationality.getAttribute('aria-activedescendant');
    assert.equal(field.querySelector(`#${activeId}`).getAttribute('aria-selected'), 'true');
    nationality.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    assert.equal(nationality.value, 'Türkiye');
    assert.equal(nationality.getAttribute('aria-expanded'), 'false');
    document.defaultView.close();
});

test('document readiness allows finalized pending scans and ignores missing optional uploads', () => {
    const readiness = calculateDocumentReadiness([
        { code: 'required-pending', required: true, revision_number: 1, revision_status: 'submitted', filename: 'receipt.pdf', upload_status: 'finalized', scan_status: 'pending' },
        { code: 'optional', required: false, upload_status: null }
    ]);

    assert.equal(readiness.canContinue, true);
    assert.equal(readiness.requiredCount, 1);
    assert.equal(readiness.uploadedCount, 1);
});

test('document readiness blocks unsafe, cleanup-pending, and in-flight required revisions', () => {
    for (const requirement of [
        { code: 'unsafe', required: true, revision_number: 1, revision_status: 'submitted', upload_status: 'finalized', scan_status: 'unsafe' },
        { code: 'failed', required: true, revision_number: 1, revision_status: 'submitted', upload_status: 'finalized', scan_status: 'failed' },
        { code: 'cleanup', required: true, revision_number: 1, revision_status: 'submitted', upload_status: 'finalized', scan_status: 'pending', cleanup_status: 'pending' },
        { code: 'missing', required: true, upload_status: null }
    ]) {
        const readiness = calculateDocumentReadiness([requirement], { [requirement.code]: { state: 'verifying' } });
        assert.equal(readiness.canContinue, false);
        assert.equal(readiness.uploadedCount, 0);
    }
});

test('review readiness requires declaration but does not require a clean scan verdict', () => {
    const application = {
        student_number: 'SYN-1', student_email: 'synthetic@example.test', student_phone: '+905551112233',
        application_type: 'initial', address_evidence_type: 'rental_contract', first_name: 'Test', last_name: 'Student',
        passport_number: 'P-1', nationality: 'Türkiye', date_of_birth: '2000-01-01', is_under_18: 0,
        fingerprint_status: 'registered', fingerprint_code: 'FP-1', contact_acknowledgement: { accepted_current: true },
        declaration: { accepted_current: false }
    };
    const requirements = [{ code: 'passport', required: true, revision_number: 1, revision_status: 'submitted', upload_status: 'finalized', scan_status: 'pending' }];

    assert.equal(getReviewReadiness(application, requirements).canSubmit, false);
    application.declaration.accepted_current = true;
    assert.equal(getReviewReadiness(application, requirements).canSubmit, true);
});
