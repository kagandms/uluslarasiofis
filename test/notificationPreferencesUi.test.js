import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import {
    parseNotificationPreferences,
    createNotificationPreferenceField,
    WHATSAPP_CONSENT_VERSION
} from '../src/public/notificationPreferences.js';

function createDom(html = '<!doctype html><html lang="tr" dir="ltr"><body><div id="mount"></div></body></html>') {
    const dom = new JSDOM(html);
    return {
        dom,
        document: dom.window.document,
        root: dom.window.document.querySelector('#mount')
    };
}

function flushAsync() {
    return new Promise((resolve) => setImmediate(resolve));
}

function createFullContractFixture(overrides = {}) {
    return {
        application_id: 'app_test_full',
        current_consent_version: WHATSAPP_CONSENT_VERSION,
        effective_whatsapp_opt_in: false,
        requires_reconsent: false,
        can_opt_in: true,
        whatsapp_opt_in: false,
        consent_version: null,
        language: 'tr',
        opted_in_at: null,
        opted_out_at: null,
        ...overrides
    };
}

test('parseNotificationPreferences rejects legacy API responses missing new contract fields: no active consent or save success assumed', () => {
    // Null / empty input
    const empty = parseNotificationPreferences(null);
    assert.equal(empty.isValidContract, false);
    assert.equal(empty.effectiveWhatsappOptIn, false);
    assert.equal(empty.isVerified, false);

    // Legacy baseline response (c59e56c) missing application_id, current_consent_version, effective_whatsapp_opt_in, can_opt_in, requires_reconsent
    const legacyBaseline = parseNotificationPreferences({
        whatsapp_opt_in: true,
        consent_version: 'whatsapp-consent-v1',
        language: 'tr'
    });
    assert.equal(legacyBaseline.isValidContract, false, 'Legacy response must NOT be accepted as valid contract');
    assert.equal(legacyBaseline.effectiveWhatsappOptIn, false, 'Missing effective_whatsapp_opt_in must NOT infer true from whatsapp_opt_in');
    assert.equal(legacyBaseline.currentConsentVersion, null, 'Missing current_consent_version must NOT default to client version');
    assert.equal(legacyBaseline.canOptIn, false, 'Missing can_opt_in must NOT default to true');
    assert.equal(legacyBaseline.isVerified, false);

    // Missing effective_whatsapp_opt_in boolean
    const missingEffective = parseNotificationPreferences(createFullContractFixture({
        effective_whatsapp_opt_in: undefined
    }));
    assert.equal(missingEffective.isValidContract, false);
    assert.equal(missingEffective.effectiveWhatsappOptIn, false);

    // Contradictory response: effective_whatsapp_opt_in true but requires_reconsent true
    const contradictory = parseNotificationPreferences(createFullContractFixture({
        effective_whatsapp_opt_in: true,
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        requires_reconsent: true
    }));
    assert.equal(contradictory.isValidContract, false, 'Contradictory state must fail contract validation');
    assert.equal(contradictory.effectiveWhatsappOptIn, false);

    // Valid full contract with matching expected application ID
    const valid = parseNotificationPreferences(createFullContractFixture({
        application_id: 'app_123',
        effective_whatsapp_opt_in: true,
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        requires_reconsent: false,
        can_opt_in: true
    }), 'app_123');
    assert.equal(valid.isValidContract, true);
    assert.equal(valid.isVerified, true);
    assert.equal(valid.effectiveWhatsappOptIn, true);
});

test('error handling displays user-safe alert messages on 401, 400 and 409', async () => {
    const { document, root } = createDom();
    const errors = [
        { err: Object.assign(new Error(), { status: 401, code: 'APPLICATION_SESSION_REQUIRED' }), match: /Oturum süresi doldu/ },
        { err: Object.assign(new Error(), { status: 400, code: 'CONSENT_VERSION_INVALID' }), match: /İzin metni sürümü güncel değil/ },
        { err: Object.assign(new Error(), { status: 409, code: 'RECIPIENT_UNAVAILABLE' }), match: /geçerli bir telefon numarası/ }
    ];

    for (const { err, match } of errors) {
        const field = createNotificationPreferenceField(document, {
            application: { id: 'app_err', status: 'draft', student_phone: '+905551112233' },
            initialPreference: createFullContractFixture({ application_id: 'app_err' }),
            api: {
                async updateCurrentNotificationPreferences() { throw err; }
            }
        });
        root.replaceChildren(field);

        const checkbox = field.querySelector('#field-whatsapp-opt-in');
        checkbox.checked = true;
        checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

        await flushAsync();
        await flushAsync();

        const status = field.querySelector('.notification-preference-status');
        assert.equal(status.getAttribute('role'), 'alert');
        assert.match(status.textContent, match);
    }
});

test('Opt-out payload’ı yalnızca { whatsapp_opt_in: false } olarak kalıyor', async () => {
    const payloads = [];
    const { document: wizDoc, root: wizRoot } = createDom();
    const field = createNotificationPreferenceField(wizDoc, {
        application: { id: 'app_payload_check', status: 'draft', student_phone: '+905551234567' },
        initialPreference: createFullContractFixture({
            application_id: 'app_payload_check',
            whatsapp_opt_in: true,
            consent_version: WHATSAPP_CONSENT_VERSION,
            effective_whatsapp_opt_in: true
        }),
        api: {
            async updateCurrentNotificationPreferences(body) {
                payloads.push(body);
                return createFullContractFixture({
                    application_id: 'app_payload_check',
                    whatsapp_opt_in: false,
                    effective_whatsapp_opt_in: false
                });
            }
        }
    });
    wizRoot.append(field);

    // Uncheck checkbox to opt out
    const checkbox = field.querySelector('#field-whatsapp-opt-in');
    assert.equal(checkbox.checked, true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new wizDoc.defaultView.Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0], { whatsapp_opt_in: false });
    assert.deepEqual(Object.keys(payloads[0]), ['whatsapp_opt_in']);
    assert.equal(payloads[0].application_id, undefined);
    assert.equal(payloads[0].student_phone, undefined);
    assert.equal(payloads[0].consent_version, undefined);
    assert.equal(payloads[0].language, undefined);
});
test('consent PUT locks phone input until response settles; field re-enables on completion', async () => {
    const { document, root } = createDom();
    let resolveConsentPut;
    const phoneLockEvents = [];
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.name = 'student_phone';
    phoneInput.value = '+905551234567';
    root.append(phoneInput);

    const field = createNotificationPreferenceField(document, {
        application: { id: 'app_lock_test', status: 'draft', student_phone: '+905551234567' },
        initialPreference: createFullContractFixture({ application_id: 'app_lock_test' }),
        api: {
            async updateCurrentNotificationPreferences(payload) {
                phoneLockEvents.push({ event: 'put_called', disabled: phoneInput.disabled });
                return new Promise((resolve) => {
                    resolveConsentPut = () => resolve(createFullContractFixture({
                        application_id: 'app_lock_test',
                        whatsapp_opt_in: true,
                        consent_version: WHATSAPP_CONSENT_VERSION,
                        effective_whatsapp_opt_in: true
                    }));
                });
            }
        },
        phoneInput,
        persistPhone: async () => ({ success: true }),
        onPhoneLockChange: (locked) => { phoneLockEvents.push({ event: locked ? 'locked' : 'unlocked' }); }
    });
    root.append(field);

    assert.equal(phoneInput.disabled, false, 'Phone starts unlocked');

    const checkbox = field.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await flushAsync();

    // Phone must be disabled while consent PUT is in flight
    assert.equal(phoneInput.disabled, true, 'Phone input must be disabled during in-flight consent PUT');
    assert.equal(phoneInput.getAttribute('aria-disabled'), 'true');

    // Verify lock was set before PUT was called
    const lockIdx = phoneLockEvents.findIndex(e => e.event === 'locked');
    const putIdx = phoneLockEvents.findIndex(e => e.event === 'put_called');
    assert.ok(lockIdx >= 0, 'Lock event must have been emitted');
    assert.ok(putIdx >= 0, 'PUT must have been called');
    assert.ok(lockIdx < putIdx, 'Lock must precede PUT call');
    assert.equal(phoneLockEvents[putIdx].disabled, true, 'Phone must be disabled when PUT is dispatched');

    // Resolve consent PUT
    resolveConsentPut();
    await flushAsync();
    await flushAsync();

    // Phone must be re-enabled after PUT settles
    assert.equal(phoneInput.disabled, false, 'Phone input must be re-enabled after consent PUT settles');
    assert.equal(phoneInput.getAttribute('aria-disabled'), null);
    assert.ok(phoneLockEvents.some(e => e.event === 'unlocked'), 'Unlock event must have been emitted');
});

test('phone change during autosave aborts workflow; consent PUT is never sent', async () => {
    const { document, root } = createDom();
    const calls = { persistPhone: 0, updatePrefs: 0 };
    let resolvePersistPhone;
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.name = 'student_phone';
    phoneInput.value = '+905551234567';
    root.append(phoneInput);

    const field = createNotificationPreferenceField(document, {
        application: { id: 'app_race_test', status: 'draft', student_phone: '+905551234567' },
        initialPreference: createFullContractFixture({ application_id: 'app_race_test' }),
        api: {
            async updateCurrentNotificationPreferences() {
                calls.updatePrefs++;
                return createFullContractFixture({
                    application_id: 'app_race_test',
                    whatsapp_opt_in: true,
                    consent_version: WHATSAPP_CONSENT_VERSION,
                    effective_whatsapp_opt_in: true
                });
            }
        },
        phoneInput,
        persistPhone: async () => {
            calls.persistPhone++;
            return new Promise((resolve) => {
                resolvePersistPhone = () => resolve({ success: true });
            });
        }
    });
    root.append(field);

    const checkbox = field.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await flushAsync();
    assert.equal(calls.persistPhone, 1, 'persistPhone must have been called');

    // While persistPhone is in flight, user changes phone number
    field.syncPhone('+905559998877');

    // Resolve persistPhone
    resolvePersistPhone();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    // Consent PUT must NOT have been called because phone changed during autosave
    assert.equal(calls.updatePrefs, 0, 'Consent PUT must never be sent when phone changed during autosave');
    // Phone must NOT remain locked
    assert.equal(phoneInput.disabled, false, 'Phone must not remain locked after aborted workflow');
});

test('consent PUT rejection unlocks the phone field and keeps failure visible', async () => {
    const { document, root } = createDom();
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.name = 'student_phone';
    phoneInput.value = '+905551234567';
    root.append(phoneInput);
    let rejectConsentPut;

    const field = createNotificationPreferenceField(document, {
        application: { id: 'app_lock_error', status: 'draft', student_phone: phoneInput.value },
        initialPreference: createFullContractFixture({ application_id: 'app_lock_error' }),
        api: {
            async updateCurrentNotificationPreferences() {
                return new Promise((resolve, reject) => { rejectConsentPut = reject; });
            }
        },
        phoneInput,
        persistPhone: async () => ({ success: true })
    });
    root.append(field);

    const checkbox = field.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await flushAsync();
    assert.equal(phoneInput.disabled, true, 'Phone must remain locked while PUT is pending');
    rejectConsentPut(Object.assign(new Error('Unavailable'), { code: 'NETWORK_ERROR' }));
    await flushAsync();

    assert.equal(phoneInput.disabled, false, 'Phone must unlock after a rejected PUT');
    assert.equal(phoneInput.getAttribute('aria-disabled'), null);
    assert.equal(field.querySelector('.notification-preference-status').getAttribute('role'), 'alert');
    assert.match(field.querySelector('.notification-preference-status').textContent, /kaydedilemedi/i);
});

test('opt-out PUT does not lock the phone field', async () => {
    const { document, root } = createDom();
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.name = 'student_phone';
    phoneInput.value = '+905551234567';
    root.append(phoneInput);
    let resolveOptOut;

    const field = createNotificationPreferenceField(document, {
        application: { id: 'app_opt_out_unlocked', status: 'draft', student_phone: phoneInput.value },
        initialPreference: createFullContractFixture({
            application_id: 'app_opt_out_unlocked',
            whatsapp_opt_in: true,
            consent_version: WHATSAPP_CONSENT_VERSION,
            effective_whatsapp_opt_in: true
        }),
        api: {
            async updateCurrentNotificationPreferences() {
                return new Promise((resolve) => { resolveOptOut = resolve; });
            }
        },
        phoneInput
    });
    root.append(field);

    field.querySelector('[data-action="preference-opt-out"]').click();
    await flushAsync();

    assert.equal(phoneInput.disabled, false, 'Opt-out must leave the phone field editable');
    assert.equal(phoneInput.getAttribute('aria-disabled'), null);

    resolveOptOut(createFullContractFixture({
        application_id: 'app_opt_out_unlocked',
        whatsapp_opt_in: false,
        effective_whatsapp_opt_in: false
    }));
    await flushAsync();
    await flushAsync();
    assert.equal(phoneInput.disabled, false);
});

test('tracking lookup removes student-number guidance and does not request WhatsApp preferences', async () => {
    const { document, root } = createDom();
    let preferenceReads = 0;
    const api = {
        async readCurrentApplicationTracking() {
            return {
                application: { id: 'app_owner', reference_number: 'ITU-7K9M-4X2P', student_number: 'STU-1', status: 'submitted', application_type: 'initial' },
                documents: []
            };
        },
        async lookupApplicationTracking(reference) {
            return {
                found: true,
                application: { reference_number: reference, student_number: 'STU-1', status: 'submitted', application_type: 'initial' },
                documents: []
            };
        },
        async readCurrentNotificationPreferences() {
            preferenceReads += 1;
            throw new Error('Tracking lookup must not load WhatsApp preferences.');
        }
    };

    await initializeApplicationTracking(root, api);
    assert.doesNotMatch(root.textContent, /öğrenci numarasıyla|student-number|رقم الطالب|talyp belgisi/i);
    assert.ok(root.querySelector('.tracking-owner-access-link'));
    const input = root.querySelector('#tracking-application-reference');
    input.value = 'ITU-7K9M-4X2P';
    root.querySelector('.tracking-lookup-form').dispatchEvent(new document.defaultView.Event('submit', {
        bubbles: true, cancelable: true
    }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(preferenceReads, 0);
    assert.equal(root.querySelector('.tracking-notification-preferences'), null);
    assert.ok(root.querySelector('.tracking-summary'));
    document.defaultView.close();
});
