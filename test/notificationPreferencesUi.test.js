import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import {
    parseNotificationPreferences,
    createNotificationPreferenceField,
    mountTrackingNotificationPreferences,
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

async function initializeTrackingAndLookup(document, root, api) {
    let cachedPayload = null;
    let lookupResult = null;
    let studentNumber = 'STU-1';
    if (!api.lookupApplicationTracking) {
        try {
            cachedPayload = await api.readCurrentApplicationTracking();
            studentNumber = cachedPayload.application.student_number || studentNumber;
        } catch {
            cachedPayload = null;
        }
    }
    const lookupApi = {
        ...api,
        async readCurrentApplicationTracking() {
            if (cachedPayload) {
                const payload = cachedPayload;
                cachedPayload = null;
                payload.application.student_number ||= studentNumber;
                return payload;
            }
            const payload = await api.readCurrentApplicationTracking();
            const ownerNumber = lookupResult?.application?.student_number;
            if (ownerNumber && !payload.application.student_number) payload.application.student_number = ownerNumber;
            return payload;
        },
        async lookupApplicationTracking(number) {
            if (api.lookupApplicationTracking) {
                lookupResult = await api.lookupApplicationTracking(number);
                return lookupResult;
            }
            cachedPayload = await api.readCurrentApplicationTracking();
            cachedPayload.application.student_number ||= studentNumber;
            return { found: true, ...cachedPayload };
        }
    };
    const result = await initializeApplicationTracking(root, lookupApi);
    root.querySelector('[name="student_number"]').value = studentNumber;
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    return result;
}

function enterPhone(root, value) {
    const input = root.querySelector('[data-phone-visible]');
    input.value = value;
    input.dispatchEvent(new root.ownerDocument.defaultView.Event('input', { bubbles: true }));
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

test('application_id missing or different blocks management in tracking view and wizard', async () => {
    // 1. Missing application_id in response
    const missingId = parseNotificationPreferences(createFullContractFixture({
        application_id: null
    }), 'app_target');
    assert.equal(missingId.isValidContract, false);
    assert.equal(missingId.isApplicationIdMatch, false);
    assert.equal(missingId.isVerified, false);

    // 2. Mismatched application_id in tracking view
    const { document, root } = createDom();
    const trackingPayload = {
        application: { id: 'app_owner_real', student_number: 'STU-1', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_foreign_id',
                effective_whatsapp_opt_in: true,
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION
            });
        }
    };

    await initializeTrackingAndLookup(root.ownerDocument, root, api);
    await flushAsync();
    await flushAsync();

    const prefSection = root.querySelector('.tracking-notification-preferences');
    assert.ok(prefSection);
    const button = prefSection.querySelector('button');
    const feedback = prefSection.querySelector('.tracking-message');

    assert.equal(button.style.display, 'none', 'Controls must be hidden on application_id mismatch');
    assert.equal(feedback.getAttribute('role'), 'alert');
    assert.match(feedback.textContent, /Sorgu şu anda tamamlanamadı/);
});

test('unknown current consent version blocks opt-in and does not auto-accept', async () => {
    // Response reports future unknown version: e.g. whatsapp-consent-v2
    const futureVersion = parseNotificationPreferences(createFullContractFixture({
        current_consent_version: 'whatsapp-consent-v2',
        effective_whatsapp_opt_in: true,
        whatsapp_opt_in: true,
        consent_version: 'whatsapp-consent-v2'
    }), 'app_test_full');
    assert.equal(futureVersion.isVersionSupported, false, 'Unknown version cannot be supported');
    assert.equal(futureVersion.isVerified, false);
    assert.equal(futureVersion.effectiveWhatsappOptIn, false, 'Unverified version cannot report effective opt-in');

    // Tracking view hides action buttons and displays version outdated notice
    const { root } = createDom();
    const api = {
        async readCurrentApplicationTracking() {
            return { application: { id: 'app_test_full', status: 'submitted' }, documents: [] };
        },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({ current_consent_version: 'whatsapp-consent-v2' });
        }
    };
    await initializeTrackingAndLookup(root.ownerDocument, root, api);
    await flushAsync();
    await flushAsync();

    const button = root.querySelector('.tracking-notification-preferences button');
    const statusText = root.querySelector('.tracking-notification-status');
    assert.equal(button.style.display, 'none', 'Opt-in must be blocked for unknown server version');
    assert.match(statusText.textContent, /İzin metni sürümü güncel değil/);
});

test('Contact step renders WhatsApp preference checkbox unchecked by default and does not block progression', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture();
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture();
        }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const acknowledgement = root.querySelector('#field-contact-acknowledgement');
    const continueBtn = root.querySelector('button[type="submit"]');

    assert.ok(checkbox, 'WhatsApp preference checkbox must exist');
    assert.equal(checkbox.checked, false, 'WhatsApp preference must default to unchecked');
    assert.equal(checkbox.required, false, 'WhatsApp preference must not be required');
    assert.ok(acknowledgement, 'Separate contact responsibility acknowledgement must exist');
    assert.notEqual(checkbox, acknowledgement);

    // Fill valid contact fields and check acknowledgement
    root.querySelector('[name="student_number"]').value = 'STU-1001';
    root.querySelector('[name="student_email"]').value = 'student@example.edu';
    enterPhone(root, '+905551112233');
    root.querySelector('[name="application_type"]').value = 'initial';
    acknowledgement.checked = true;

    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false, 'Continue must be enabled with valid contact fields and acknowledgement');

    // Toggling WhatsApp preference does not make continue disabled
    checkbox.checked = true;
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false);

    checkbox.checked = false;
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false);

    // No premature PUT was made
    assert.equal(calls.updatePrefs.length, 0);
});

test('pre-session visitor: toggling preference does not call PUT; calls PUT only on draft creation if checked', async () => {
    const { document, root } = createDom();
    const calls = { drafts: [], acknowledgements: [], updatePrefs: [] };
    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async createApplicationDraft(draft) {
            calls.drafts.push(draft);
            return {
                id: 'draft_app_1',
                status: 'draft',
                student_number: draft.student_number,
                student_email: draft.email,
                student_phone: draft.phone,
                application_type: draft.application_type,
                contact_acknowledgement: { current_version: 'contact-reachability-v1', accepted_current: false }
            };
        },
        async acceptCurrentContactAcknowledgement(version) {
            calls.acknowledgements.push(version);
            return {
                id: 'draft_app_1',
                status: 'draft',
                student_phone: '+905551112233',
                contact_acknowledgement: { current_version: version, accepted_current: true }
            };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture({
                application_id: 'draft_app_1',
                whatsapp_opt_in: payload.whatsapp_opt_in,
                consent_version: payload.consent_version,
                effective_whatsapp_opt_in: true
            });
        }
    };

    const state = await initializeApplicationWizard(root, api);

    root.querySelector('[name="student_number"]').value = 'STU-OPT-IN';
    root.querySelector('[name="student_email"]').value = 'visitor@example.edu';
    enterPhone(root, '+905551112233');
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    // Before draft creation, NO PUT call is made and NO "saved" status is displayed
    assert.equal(calls.updatePrefs.length, 0);
    const statusText = root.querySelector('.notification-preference-status');
    assert.equal(statusText.textContent, '');

    // Submit Step 0 to create draft
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.updatePrefs.length, 1);
    assert.deepEqual(calls.updatePrefs[0], {
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        language: 'tr'
    });
    assert.equal(state.step, 1, 'Wizard must advance to Residence step');
});

test('pre-session visitor: if WhatsApp preference is left unchecked, PUT is never called on step advance', async () => {
    const { document, root } = createDom();
    const calls = { drafts: [], updatePrefs: [] };
    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async createApplicationDraft(draft) {
            calls.drafts.push(draft);
            return {
                id: 'draft_app_2',
                status: 'draft',
                student_number: draft.student_number,
                contact_acknowledgement: { current_version: 'v1', accepted_current: true }
            };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture();
        }
    };

    const state = await initializeApplicationWizard(root, api);

    root.querySelector('[name="student_number"]').value = 'STU-UNCHECKED';
    root.querySelector('[name="student_email"]').value = 'visitor2@example.edu';
    enterPhone(root, '+905551112233');
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;

    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();

    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.updatePrefs.length, 0, 'Unchecked WhatsApp preference must never call PUT');
    assert.equal(state.step, 1);
});

test('pending phone save: phone is persisted before preference PUT is sent in existing draft', async () => {
    const { document, root } = createDom();
    const sequence = [];
    const application = {
        id: 'draft_phone_order',
        status: 'draft',
        student_number: 'STU-ORDER',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({ application_id: 'draft_phone_order' });
        },
        async updateCurrentApplication(values) {
            sequence.push('save_phone');
            application.student_phone = values.phone;
            return { ...application };
        },
        async updateCurrentNotificationPreferences(payload) {
            sequence.push('save_preference');
            return createFullContractFixture({
                application_id: 'draft_phone_order',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();
    await flushAsync();

    assert.deepEqual(sequence, ['save_phone', 'save_preference'], 'Phone save must strictly precede preference PUT');
});

test('changing the international calling prefix invalidates the previous WhatsApp consent', async () => {
    const { document, root } = createDom();
    const application = {
        id: 'draft_prefix_change', status: 'draft', student_number: 'SYN-PHONE-1',
        student_phone: '+905551112233', contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: application.id, whatsapp_opt_in: true, consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true, can_opt_in: true
            });
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };
    const state = await initializeApplicationWizard(root, api);
    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const phone = root.querySelector('[data-phone-visible]');

    assert.equal(checkbox.checked, true);
    phone.value = '+1 202 555 0123';
    phone.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    assert.equal(root.querySelector('[name="phone_country"]').value, 'US');
    assert.equal(root.querySelector('[name="student_phone"]').value, '+12025550123');
    assert.equal(checkbox.checked, false);
    assert.equal(state.formValues.whatsapp_opt_in, false);
    assert.match(root.querySelector('.notification-preference-notice').textContent, /yenileyin/i);
});

test('failed phone save prevents preference PUT; preserves user selection and shows retry option', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const application = {
        id: 'draft_phone_fail',
        status: 'draft',
        student_number: 'STU-FAIL',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({ application_id: 'draft_phone_fail' });
        },
        async updateCurrentApplication() {
            throw new Error('Phone persistence network error');
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture();
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 0, 'Preference PUT must NOT be called if phone persistence failed');
    assert.equal(checkbox.checked, true, 'User check selection must be preserved');
    const statusText = root.querySelector('.notification-preference-status');
    assert.equal(statusText.getAttribute('role'), 'alert');
    assert.match(statusText.textContent, /Bildirim tercihi kaydedilemedi/);
});

test('phone changed while preference PUT is in flight: stale response is not shown as valid consent for new phone', async () => {
    const { document, root } = createDom();
    let resolvePut;
    const application = {
        id: 'draft_race',
        status: 'draft',
        student_number: 'STU-RACE',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({ application_id: 'draft_race' });
        },
        async updateCurrentApplication(vals) { return { ...application, student_phone: vals.phone }; },
        async updateCurrentNotificationPreferences() {
            return new Promise((resolve) => {
                resolvePut = () => resolve(createFullContractFixture({
                    application_id: 'draft_race',
                    whatsapp_opt_in: true,
                    consent_version: WHATSAPP_CONSENT_VERSION,
                    effective_whatsapp_opt_in: true
                }));
            });
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const phoneInput = root.querySelector('[name="student_phone"]');

    // User checks opt-in for first phone
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    await flushAsync();

    // While PUT is pending, user changes phone number
    phoneInput.value = '+905559998877';
    phoneInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    // Now resolve the old PUT request
    resolvePut();
    await flushAsync();
    await flushAsync();

    // Verify stale response was discarded: checkbox is unchecked and reconsent notice is shown
    assert.equal(checkbox.checked, false, 'Checkbox must not be checked with stale consent');
    const notice = root.querySelector('.notification-preference-notice');
    assert.equal(notice.style.display, '');
    assert.match(notice.textContent, /Telefon numarası veya izin metni güncellendi/);
});

test('explicit re-consent after phone save succeeds and records verified opt-in', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const application = {
        id: 'draft_reconsent',
        status: 'draft',
        student_number: 'STU-RECONSENT',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'draft_reconsent',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async updateCurrentApplication(vals) {
            application.student_phone = vals.phone;
            return { ...application };
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture({
                application_id: 'draft_reconsent',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true,
                requires_reconsent: false
            });
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const phoneInput = root.querySelector('[name="student_phone"]');

    // Change phone
    phoneInput.value = '+905559990000';
    phoneInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(checkbox.checked, false, 'Checkbox unchecks on phone edit');

    // Explicitly re-consent for new phone
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 1);
    const statusText = root.querySelector('.notification-preference-status');
    assert.match(statusText.textContent, /Bildirim tercihi kaydedildi/);
    const notice = root.querySelector('.notification-preference-notice');
    assert.equal(notice.style.display, 'none');
});

test('initial draft creation: preference PUT failure allows wizard to advance, displays warning banner with retry button without re-creating draft', async () => {
    const { document, root } = createDom();
    let draftCalls = 0;
    let prefCalls = 0;
    let shouldPrefSucceed = false;

    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async createApplicationDraft(draft) {
            draftCalls++;
            return {
                id: 'draft_retry_flow',
                status: 'draft',
                student_number: draft.student_number,
                student_phone: draft.phone,
                contact_acknowledgement: { current_version: 'v1', accepted_current: true }
            };
        },
        async acceptCurrentContactAcknowledgement() {
            return {
                id: 'draft_retry_flow',
                status: 'draft',
                contact_acknowledgement: { current_version: 'v1', accepted_current: true }
            };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; },
        async updateCurrentNotificationPreferences(payload) {
            prefCalls++;
            if (!shouldPrefSucceed) {
                throw new Error('Preference service temporarily unavailable');
            }
            return createFullContractFixture({
                application_id: 'draft_retry_flow',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        }
    };

    const state = await initializeApplicationWizard(root, api);

    root.querySelector('[name="student_number"]').value = 'STU-RETRY';
    root.querySelector('[name="student_email"]').value = 'retry@example.edu';
    enterPhone(root, '+905551112233');
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;
    root.querySelector('#field-whatsapp-opt-in').checked = true;

    // Submit step 0
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();
    await flushAsync();

    // 1. Wizard advanced to Step 1 (non-blocking)
    assert.equal(state.step, 1, 'Wizard must advance to Step 1 despite preference error');
    assert.equal(draftCalls, 1, 'Draft was created');
    assert.equal(prefCalls, 1, 'Preference PUT was attempted');

    // 2. Banner is displayed on Step 1 explaining draft saved but preference failed
    const banner = root.querySelector('.application-notification-preference-banner');
    assert.ok(banner, 'Warning banner must be displayed');
    assert.match(banner.textContent, /Başvuru bilgileriniz kaydedildi, ancak WhatsApp bildirim tercihi kaydedilemedi/);
    const retryBtn = banner.querySelector('[data-action="preference-retry"]');
    assert.ok(retryBtn, 'Retry button must be present in banner');

    // 3. User clicks previous back to Step 0: banner persists
    const prevBtn = root.querySelector('button[data-action="previous"]');
    prevBtn.click();
    await flushAsync();
    await flushAsync();
    assert.equal(state.step, 0);
    assert.ok(root.querySelector('.application-notification-preference-banner'), 'Banner persists across steps');

    // 4. User clicks retry button: preference PUT is retried WITHOUT re-creating draft
    shouldPrefSucceed = true;
    const retryBtnStep0 = root.querySelector('[data-action="preference-retry"]');
    retryBtnStep0.click();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    assert.equal(draftCalls, 1, 'Retry must NOT create a new draft');
    assert.equal(prefCalls, 2, 'Preference PUT was retried');

    // 5. Success state is now shown
    const updatedBanner = root.querySelector('.application-notification-preference-banner');
    assert.match(updatedBanner.textContent, /Bildirim tercihi kaydedildi/);
    assert.equal(updatedBanner.querySelector('button'), null, 'Retry button is removed on success');
});

test('language change updates all labels and explanations without calling PUT', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: 0 };
    const application = {
        id: 'draft_lang',
        status: 'draft',
        student_number: 'STU-LANG',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'draft_lang',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences() {
            calls.updatePrefs++;
            return createFullContractFixture();
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    assert.match(root.textContent, /WhatsApp hattından almak istiyorum/);
    assert.equal(calls.updatePrefs, 0);

    document.documentElement.lang = 'en';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /International Office WhatsApp line/);
    assert.match(root.textContent, /This preference is optional/);
    assert.equal(calls.updatePrefs, 0);

    document.documentElement.lang = 'ru';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /WhatsApp Международного офиса/);
    assert.equal(calls.updatePrefs, 0);

    document.documentElement.lang = 'tk';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /Halkara Ofisiniň WhatsApp/);
    assert.equal(calls.updatePrefs, 0);

    document.documentElement.lang = 'ar';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /العلاقات الدولية/);
    assert.equal(calls.updatePrefs, 0);
});

test('tracking view: ready owner session mounts preferences card, supports opt-out and re-opt-in', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const trackingPayload = {
        application: { id: 'app_track_1', student_number: 'STU-TRACK-1', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    let preference = createFullContractFixture({
        application_id: 'app_track_1',
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        effective_whatsapp_opt_in: true
    });
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() { return { ...preference }; },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            preference = createFullContractFixture({
                application_id: 'app_track_1',
                whatsapp_opt_in: payload.whatsapp_opt_in,
                consent_version: payload.consent_version || null,
                effective_whatsapp_opt_in: Boolean(payload.whatsapp_opt_in)
            });
            return { ...preference };
        }
    };

    const result = await initializeTrackingAndLookup(root.ownerDocument, root, api);
    assert.equal(result.kind, 'ready');

    await flushAsync();
    await flushAsync();

    const prefSection = root.querySelector('.tracking-notification-preferences');
    assert.ok(prefSection);

    const statusP = prefSection.querySelector('.tracking-notification-status');
    const button = prefSection.querySelector('button');

    assert.match(statusP.textContent, /WhatsApp bildirim izni kayıtlı/);
    assert.equal(button.dataset.action, 'opt-out');

    // Click opt-out
    button.click();
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');

    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 1);
    assert.deepEqual(calls.updatePrefs[0], { whatsapp_opt_in: false });
    assert.match(statusP.textContent, /WhatsApp bildirim izni kapalı/);
    assert.equal(button.dataset.action, 'opt-in');

    // Click opt-in
    button.click();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 2);
    assert.deepEqual(calls.updatePrefs[1], {
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        language: 'tr'
    });
    assert.match(statusP.textContent, /WhatsApp bildirim izni kayıtlı/);
    assert.equal(button.dataset.action, 'opt-out');
});

test('tracking view: public lookup does not mount preference controls or leak preference data', async () => {
    const { document, root } = createDom();
    const calls = { readPrefs: 0 };
    const api = {
        async readCurrentApplicationTracking() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED', status: 401 });
        },
        async lookupApplicationTracking(studentNumber) {
            return {
                found: true,
                application: { student_number: studentNumber, status: 'submitted', application_type: 'initial' },
                documents: []
            };
        },
        async readCurrentNotificationPreferences() {
            calls.readPrefs++;
            return createFullContractFixture();
        }
    };

    const initial = await initializeApplicationTracking(root, api);
    assert.equal(initial.kind, 'lookup');

    const lookupInput = root.querySelector('#tracking-student-number');
    lookupInput.value = 'PUBLIC-STU-1';
    lookupInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));

    await flushAsync();
    await flushAsync();

    assert.equal(calls.readPrefs, 0, 'Public lookup must never call readCurrentNotificationPreferences');
    assert.equal(root.querySelector('.tracking-notification-preferences'), null);
    assert.doesNotMatch(root.textContent, /WhatsApp/i, 'No preference data must be leaked');
});

test('tracking view: can_opt_in = false explains phone required and hides action button', async () => {
    const { root } = createDom();
    const trackingPayload = {
        application: { id: 'app_no_phone', student_number: 'STU-NO-PHONE', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_no_phone',
                can_opt_in: false
            });
        }
    };

    await initializeTrackingAndLookup(root.ownerDocument, root, api);
    await flushAsync();
    await flushAsync();

    const prefSection = root.querySelector('.tracking-notification-preferences');
    const button = prefSection.querySelector('button');
    const statusP = prefSection.querySelector('.tracking-notification-status');

    assert.equal(button.style.display, 'none', 'Action button must be hidden when opt-in is impossible');
    assert.match(statusP.textContent, /geçerli bir telefon numarası bulunmalıdır/i);
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

test('rapid repeated clicking does not create conflicting writes or out-of-order state', async () => {
    const { document, root } = createDom();
    const calls = [];
    const application = {
        id: 'draft_rapid',
        status: 'draft',
        student_number: 'STU-RAPID',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({ application_id: 'draft_rapid' });
        },
        async updateCurrentApplication(vals) { return { ...application, student_phone: vals.phone }; },
        async updateCurrentNotificationPreferences(payload) {
            calls.push(payload);
            await new Promise((resolve) => setTimeout(resolve, 10));
            return createFullContractFixture({
                application_id: 'draft_rapid',
                whatsapp_opt_in: payload.whatsapp_opt_in,
                consent_version: payload.consent_version || null,
                effective_whatsapp_opt_in: Boolean(payload.whatsapp_opt_in)
            });
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');

    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    assert.equal(checkbox.disabled, true, 'Checkbox must be disabled while saving to prevent race conditions');

    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await flushAsync();

    assert.equal(checkbox.disabled, false);
    assert.equal(calls.length, 1);
});

test('requires_reconsent: true ve eski kayıtlı izin varken opt-out mümkün', async () => {
    // 1. Tracking View
    const { root: trackRoot } = createDom();
    const calls = { updatePrefs: [] };
    const trackingPayload = {
        application: { id: 'app_reconsent_1', student_number: 'STU-REC-1', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_reconsent_1',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                current_consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: false,
                requires_reconsent: true,
                can_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return createFullContractFixture({
                application_id: 'app_reconsent_1',
                whatsapp_opt_in: false,
                consent_version: null,
                current_consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: false,
                requires_reconsent: false,
                can_opt_in: true
            });
        }
    };

    await initializeTrackingAndLookup(trackRoot.ownerDocument, trackRoot, api);
    await flushAsync();
    await flushAsync();

    const prefSection = trackRoot.querySelector('.tracking-notification-preferences');
    const statusP = prefSection.querySelector('.tracking-notification-status');
    const optInBtn = prefSection.querySelector('button[data-action="opt-in"]');
    const optOutBtn = prefSection.querySelector('button[data-action="opt-out"]');

    assert.match(statusP.textContent, /onayınızı yenileyin/i);
    assert.ok(optInBtn, 'Opt-in action button must be visible for re-consent');
    assert.ok(optOutBtn, 'Opt-out action button must also be visible to withdraw stored consent');

    // Click opt-out
    optOutBtn.click();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 1);
    assert.deepEqual(calls.updatePrefs[0], { whatsapp_opt_in: false });
    assert.match(statusP.textContent, /WhatsApp bildirim izni kapalı/i);

    // 2. Wizard View
    const { document: wizDoc, root: wizRoot } = createDom();
    const wizCalls = [];
    const wizField = createNotificationPreferenceField(wizDoc, {
        application: { id: 'app_wiz_rec', status: 'draft', student_phone: '+905551112233' },
        initialPreference: createFullContractFixture({
            application_id: 'app_wiz_rec',
            whatsapp_opt_in: true,
            effective_whatsapp_opt_in: false,
            requires_reconsent: true,
            can_opt_in: true
        }),
        api: {
            async updateCurrentNotificationPreferences(payload) {
                wizCalls.push(payload);
                return createFullContractFixture({
                    application_id: 'app_wiz_rec',
                    whatsapp_opt_in: false,
                    effective_whatsapp_opt_in: false,
                    requires_reconsent: false,
                    can_opt_in: true
                });
            }
        }
    });
    wizRoot.append(wizField);

    const wizNotice = wizField.querySelector('.notification-preference-notice');
    const wizOptOutBtn = wizField.querySelector('[data-action="preference-opt-out"]');
    assert.match(wizNotice.textContent, /onayınızı yenileyin/i);
    assert.ok(wizOptOutBtn);
    assert.notEqual(wizOptOutBtn.style.display, 'none', 'Wizard must show opt-out button for stored consent requiring re-consent');

    wizOptOutBtn.click();
    await flushAsync();
    await flushAsync();

    assert.equal(wizCalls.length, 1);
    assert.deepEqual(wizCalls[0], { whatsapp_opt_in: false });
    const wizStatus = wizField.querySelector('.notification-preference-status');
    assert.match(wizStatus.textContent, /kaydedildi/i);
    assert.equal(wizOptOutBtn.style.display, 'none');
});

test('can_opt_in: false iken kayıtlı izni opt-out etmek mümkün', async () => {
    // 1. Tracking View
    const { root: trackRoot } = createDom();
    const calls = [];
    const trackingPayload = {
        application: { id: 'app_no_phone_consent', student_number: 'STU-NO-PH', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_no_phone_consent',
                whatsapp_opt_in: true,
                effective_whatsapp_opt_in: false,
                requires_reconsent: true,
                can_opt_in: false
            });
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.push(payload);
            return createFullContractFixture({
                application_id: 'app_no_phone_consent',
                whatsapp_opt_in: false,
                effective_whatsapp_opt_in: false,
                requires_reconsent: false,
                can_opt_in: false
            });
        }
    };

    await initializeTrackingAndLookup(trackRoot.ownerDocument, trackRoot, api);
    await flushAsync();
    await flushAsync();

    const prefSection = trackRoot.querySelector('.tracking-notification-preferences');
    const optInBtn = prefSection.querySelector('button[data-action="opt-in"]');
    const optOutBtn = prefSection.querySelector('button[data-action="opt-out"]');
    assert.equal(optInBtn, null, 'Opt-in button must NOT be available when can_opt_in is false');
    assert.ok(optOutBtn, 'Opt-out button MUST be available when stored consent exists even if can_opt_in is false');

    optOutBtn.click();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { whatsapp_opt_in: false });
    const feedback = prefSection.querySelector('.tracking-message');
    assert.match(feedback.textContent, /kaydedildi/i);

    // 2. Wizard View
    const { document: wizDoc, root: wizRoot } = createDom();
    const wizCalls = [];
    const wizField = createNotificationPreferenceField(wizDoc, {
        application: { id: 'app_wiz_nophone', status: 'draft', student_phone: '' },
        initialPreference: createFullContractFixture({
            application_id: 'app_wiz_nophone',
            whatsapp_opt_in: true,
            effective_whatsapp_opt_in: false,
            requires_reconsent: true,
            can_opt_in: false
        }),
        api: {
            async updateCurrentNotificationPreferences(payload) {
                wizCalls.push(payload);
                return createFullContractFixture({
                    application_id: 'app_wiz_nophone',
                    whatsapp_opt_in: false,
                    effective_whatsapp_opt_in: false,
                    requires_reconsent: false,
                    can_opt_in: false
                });
            }
        }
    });
    wizRoot.append(wizField);

    const checkbox = wizField.querySelector('#field-whatsapp-opt-in');
    const wizOptOutBtn = wizField.querySelector('[data-action="preference-opt-out"]');
    assert.equal(checkbox.disabled, true, 'Checkbox must be disabled when phone is missing');
    assert.notEqual(wizOptOutBtn.style.display, 'none', 'Opt-out button must be visible to withdraw stored consent');

    wizOptOutBtn.click();
    await flushAsync();
    await flushAsync();

    assert.equal(wizCalls.length, 1);
    assert.deepEqual(wizCalls[0], { whatsapp_opt_in: false });
    const wizStatus = wizField.querySelector('.notification-preference-status');
    assert.match(wizStatus.textContent, /kaydedildi/i);
});

test('Bilinmeyen izin sürümünde yeni opt-in engellenirken opt-out mümkün', async () => {
    const { root: trackRoot } = createDom();
    const calls = [];
    const trackingPayload = {
        application: { id: 'app_unknown_ver', student_number: 'STU-VER-1', status: 'submitted', application_type: 'initial' },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_unknown_ver',
                whatsapp_opt_in: true,
                consent_version: 'whatsapp-consent-v1',
                current_consent_version: 'whatsapp-consent-v999', // Unknown version on server
                effective_whatsapp_opt_in: false,
                requires_reconsent: true,
                can_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.push(payload);
            return createFullContractFixture({
                application_id: 'app_unknown_ver',
                whatsapp_opt_in: false,
                consent_version: null,
                current_consent_version: 'whatsapp-consent-v999', // Still unknown version on server
                effective_whatsapp_opt_in: false,
                requires_reconsent: false,
                can_opt_in: true
            });
        }
    };

    await initializeTrackingAndLookup(trackRoot.ownerDocument, trackRoot, api);
    await flushAsync();
    await flushAsync();

    const prefSection = trackRoot.querySelector('.tracking-notification-preferences');
    const optInBtn = prefSection.querySelector('button[data-action="opt-in"]');
    const optOutBtn = prefSection.querySelector('button[data-action="opt-out"]');

    assert.equal(optInBtn, null, 'New opt-in must be blocked on unknown consent version');
    assert.ok(optOutBtn, 'Opt-out must remain possible on unknown consent version');

    optOutBtn.click();
    await flushAsync();
    await flushAsync();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { whatsapp_opt_in: false });
    const feedback = prefSection.querySelector('.tracking-message');
    assert.match(feedback.textContent, /kaydedildi/i, 'Opt-out verification must succeed even if current_consent_version is unsupported');
});

test('Bozuk/eksik yanıt veya başka application_id için kaydedildi gösterilmiyor', async () => {
    // 1. Mismatched application_id
    const { root: root1 } = createDom();
    const apiMismatch = {
        async readCurrentApplicationTracking() {
            return { application: { id: 'app_target', status: 'submitted' }, documents: [] };
        },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_target',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences() {
            // Returns a response for a completely DIFFERENT application_id
            return createFullContractFixture({
                application_id: 'app_DIFFERENT',
                whatsapp_opt_in: false,
                consent_version: null,
                effective_whatsapp_opt_in: false
            });
        }
    };

    await initializeTrackingAndLookup(root1.ownerDocument, root1, apiMismatch);
    await flushAsync();
    await flushAsync();

    const section1 = root1.querySelector('.tracking-notification-preferences');
    const optOutBtn1 = section1.querySelector('button[data-action="opt-out"]');
    optOutBtn1.click();
    await flushAsync();
    await flushAsync();

    const feedback1 = section1.querySelector('.tracking-message');
    assert.equal(feedback1.getAttribute('role'), 'alert');
    assert.doesNotMatch(feedback1.textContent, /kaydedildi/i, 'Must not report saved on application_id mismatch');

    // 2. Broken / incomplete response missing required fields
    const { root: root2 } = createDom();
    const apiBroken = {
        async readCurrentApplicationTracking() {
            return { application: { id: 'app_target_2', status: 'submitted' }, documents: [] };
        },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_target_2',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences() {
            // Broken payload missing metadata
            return { ok: true, whatsapp_opt_in: false };
        }
    };

    await initializeTrackingAndLookup(root2.ownerDocument, root2, apiBroken);
    await flushAsync();
    await flushAsync();

    const section2 = root2.querySelector('.tracking-notification-preferences');
    const optOutBtn2 = section2.querySelector('button[data-action="opt-out"]');
    optOutBtn2.click();
    await flushAsync();
    await flushAsync();

    const feedback2 = section2.querySelector('.tracking-message');
    assert.equal(feedback2.getAttribute('role'), 'alert');
    assert.doesNotMatch(feedback2.textContent, /kaydedildi/i, 'Must not report saved on malformed response');
});

test('Opt-out PUT yanıtı izin durumunu hâlâ etkin gösterirse başarı gösterilmiyor', async () => {
    const { root } = createDom();
    const api = {
        async readCurrentApplicationTracking() {
            return { application: { id: 'app_still_active', status: 'submitted' }, documents: [] };
        },
        async readCurrentNotificationPreferences() {
            return createFullContractFixture({
                application_id: 'app_still_active',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        },
        async updateCurrentNotificationPreferences() {
            // Server responds but still claims consent is active
            return createFullContractFixture({
                application_id: 'app_still_active',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            });
        }
    };

    await initializeTrackingAndLookup(root.ownerDocument, root, api);
    await flushAsync();
    await flushAsync();

    const section = root.querySelector('.tracking-notification-preferences');
    const optOutBtn = section.querySelector('button[data-action="opt-out"]');
    optOutBtn.click();
    await flushAsync();
    await flushAsync();

    const feedback = section.querySelector('.tracking-message');
    assert.equal(feedback.getAttribute('role'), 'alert');
    assert.doesNotMatch(feedback.textContent, /kaydedildi/i, 'Must never show success when response still indicates active consent');
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
