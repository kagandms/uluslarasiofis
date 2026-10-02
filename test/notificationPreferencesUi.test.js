import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeApplicationWizard } from '../src/public/applicationWizard.js';
import { initializeApplicationTracking } from '../src/public/applicationTracking.js';
import { parseNotificationPreferences, createNotificationPreferenceField, mountTrackingNotificationPreferences, WHATSAPP_CONSENT_VERSION } from '../src/public/notificationPreferences.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

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

test('parseNotificationPreferences normalizes baseline and extended contract formats safely', () => {
    // Null / empty input
    const empty = parseNotificationPreferences(null);
    assert.equal(empty.whatsappOptIn, false);
    assert.equal(empty.effectiveWhatsappOptIn, false);
    assert.equal(empty.requiresReconsent, false);
    assert.equal(empty.canOptIn, true);

    // Baseline response (c59e56c) with valid consent
    const baselineOptIn = parseNotificationPreferences({
        whatsapp_opt_in: true,
        consent_version: 'whatsapp-consent-v1',
        language: 'tr'
    });
    assert.equal(baselineOptIn.whatsappOptIn, true);
    assert.equal(baselineOptIn.effectiveWhatsappOptIn, true);
    assert.equal(baselineOptIn.requiresReconsent, false);
    assert.equal(baselineOptIn.currentConsentVersion, 'whatsapp-consent-v1');

    // Baseline response with stale consent version
    const baselineStale = parseNotificationPreferences({
        whatsapp_opt_in: true,
        consent_version: 'whatsapp-consent-v0',
        language: 'tr'
    });
    assert.equal(baselineStale.whatsappOptIn, true);
    assert.equal(baselineStale.effectiveWhatsappOptIn, false);
    assert.equal(baselineStale.requiresReconsent, true);

    // Extended response with explicit metadata
    const extended = parseNotificationPreferences({
        application_id: 'app_test_1',
        whatsapp_opt_in: true,
        consent_version: 'whatsapp-consent-v1',
        effective_whatsapp_opt_in: true,
        requires_reconsent: false,
        can_opt_in: true
    });
    assert.equal(extended.applicationId, 'app_test_1');
    assert.equal(extended.effectiveWhatsappOptIn, true);
    assert.equal(extended.canOptIn, true);
});

test('Contact step renders WhatsApp preference checkbox unchecked by default and does not block progression', async () => {
    const { document, root } = createDom();
    const calls = {
        readPrefs: 0,
        updatePrefs: []
    };
    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async readCurrentNotificationPreferences() {
            calls.readPrefs++;
            return { whatsapp_opt_in: false };
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return { whatsapp_opt_in: payload.whatsapp_opt_in, consent_version: payload.consent_version };
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

    // WhatsApp checkbox is completely separate from responsibility acknowledgement
    assert.notEqual(checkbox, acknowledgement);
    assert.ok(checkbox.closest('.notification-preference-group'));
    assert.ok(acknowledgement.closest('.contact-acknowledgement'));

    // Checkbox is optional and does NOT block continue when contact fields are filled
    root.querySelector('[name="student_number"]').value = 'STU-1001';
    root.querySelector('[name="student_email"]').value = 'student@example.edu';
    root.querySelector('[name="student_phone"]').value = '+905551112233';
    root.querySelector('[name="application_type"]').value = 'initial';
    acknowledgement.checked = true;

    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false, 'Continue must be enabled with valid contact fields and acknowledgement even if WhatsApp is unchecked');

    // Toggling WhatsApp preference does not make continue disabled
    checkbox.checked = true;
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false);

    checkbox.checked = false;
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(continueBtn.disabled, false);

    // No PUT request was made without an application session
    assert.equal(calls.updatePrefs.length, 0);
});

test('pre-session visitor: toggling preference does not call PUT; calls PUT only on draft creation if checked', async () => {
    const { document, root } = createDom();
    const calls = {
        drafts: [],
        acknowledgements: [],
        updatePrefs: []
    };
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
        async readCurrentStudentDocumentRequirements() {
            return { requirements: [] };
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return {
                application_id: 'draft_app_1',
                whatsapp_opt_in: payload.whatsapp_opt_in,
                consent_version: payload.consent_version,
                effective_whatsapp_opt_in: true
            };
        }
    };

    const state = await initializeApplicationWizard(root, api);

    // Step 0: visitor fills fields and checks WhatsApp checkbox
    root.querySelector('[name="student_number"]').value = 'STU-OPT-IN';
    root.querySelector('[name="student_email"]').value = 'visitor@example.edu';
    root.querySelector('[name="student_phone"]').value = '+905551112233';
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    // Before draft creation, NO PUT call is made and NO "saved" status is displayed
    assert.equal(calls.updatePrefs.length, 0, 'No PUT call should occur before session exists');
    const statusText = root.querySelector('.notification-preference-status');
    assert.equal(statusText.textContent, '', 'No saved status should be displayed before session creation');

    // Submit Step 0 to create draft
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();
    await flushAsync();

    // Verify draft was created and PUT opt-in was sent with strict payload
    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.acknowledgements.length, 1);
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
    const calls = {
        drafts: [],
        updatePrefs: []
    };
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
        async readCurrentStudentDocumentRequirements() {
            return { requirements: [] };
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return {};
        }
    };

    const state = await initializeApplicationWizard(root, api);

    root.querySelector('[name="student_number"]').value = 'STU-UNCHECKED';
    root.querySelector('[name="student_email"]').value = 'visitor2@example.edu';
    root.querySelector('[name="student_phone"]').value = '+905551112233';
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;

    // Leave WhatsApp checkbox unchecked
    assert.equal(root.querySelector('#field-whatsapp-opt-in').checked, false);

    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();

    assert.equal(calls.drafts.length, 1);
    assert.equal(calls.updatePrefs.length, 0, 'Unchecked WhatsApp preference must never call PUT');
    assert.equal(state.step, 1);
});

test('pre-session visitor: if draft creation fails, preference PUT is never called', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const api = {
        async readCurrentApplication() {
            throw Object.assign(new Error('Session required'), { code: 'APPLICATION_SESSION_REQUIRED' });
        },
        async createApplicationDraft() {
            throw Object.assign(new Error('Network error'), { code: 'NETWORK_ERROR' });
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return {};
        }
    };

    const state = await initializeApplicationWizard(root, api);

    root.querySelector('[name="student_number"]').value = 'STU-FAIL';
    root.querySelector('[name="student_email"]').value = 'fail@example.edu';
    root.querySelector('[name="student_phone"]').value = '+905551112233';
    root.querySelector('[name="application_type"]').value = 'initial';
    root.querySelector('#field-contact-acknowledgement').checked = true;
    root.querySelector('#field-whatsapp-opt-in').checked = true;

    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 0, 'No preference PUT must be called if draft creation failed');
    assert.equal(state.step, 0, 'Wizard must remain on Step 0');
});

test('existing draft session: checking and unchecking triggers immediate PUT and updates status indicator', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const application = {
        id: 'draft_active',
        status: 'draft',
        student_number: 'STU-EXISTING',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return {
                application_id: 'draft_active',
                whatsapp_opt_in: false,
                consent_version: null,
                can_opt_in: true
            };
        },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            return {
                application_id: 'draft_active',
                whatsapp_opt_in: payload.whatsapp_opt_in,
                consent_version: payload.consent_version || null,
                effective_whatsapp_opt_in: Boolean(payload.whatsapp_opt_in)
            };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const statusText = root.querySelector('.notification-preference-status');
    assert.equal(checkbox.checked, false);

    // Check opt-in
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    assert.match(statusText.textContent, /kaydediliyor/i);

    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 1);
    assert.deepEqual(calls.updatePrefs[0], {
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        language: 'tr'
    });
    assert.match(statusText.textContent, /kaydedildi/i);

    // Uncheck opt-out
    checkbox.checked = false;
    checkbox.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    assert.equal(calls.updatePrefs.length, 2);
    assert.deepEqual(calls.updatePrefs[1], {
        whatsapp_opt_in: false
    });
    assert.match(statusText.textContent, /kaydedildi/i);
});

test('phone change in Step 0 invalidates existing consent and prompts re-consent', async () => {
    const { document, root } = createDom();
    const application = {
        id: 'draft_phone_change',
        status: 'draft',
        student_number: 'STU-PHONE-1',
        student_phone: '+905551112233',
        contact_acknowledgement: { current_version: 'v1', accepted_current: false }
    };
    const api = {
        async readCurrentApplication() { return { ...application }; },
        async readCurrentNotificationPreferences() {
            return {
                application_id: 'draft_phone_change',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true,
                requires_reconsent: false
            };
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    const checkbox = root.querySelector('#field-whatsapp-opt-in');
    const notice = root.querySelector('.notification-preference-notice');
    assert.equal(checkbox.checked, true, 'Should be checked with existing valid consent');
    assert.equal(notice.style.display, 'none');

    // Change phone number in form input
    const phoneInput = root.querySelector('[name="student_phone"]');
    phoneInput.value = '+905559998877';
    phoneInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));

    // Reconsent is required: checkbox becomes unchecked and notice is displayed
    assert.equal(checkbox.checked, false, 'Checkbox must uncheck on phone change');
    assert.equal(notice.style.display, '');
    assert.match(notice.textContent, /Telefon numarası veya izin metni güncellendi/);
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
            return {
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            };
        },
        async updateCurrentNotificationPreferences() {
            calls.updatePrefs++;
            return {};
        },
        async readCurrentStudentDocumentRequirements() { return { requirements: [] }; }
    };

    await initializeApplicationWizard(root, api);

    // Initial Turkish
    assert.match(root.textContent, /WhatsApp hattından almak istiyorum/);
    assert.equal(calls.updatePrefs, 0);

    // Switch to English
    document.documentElement.lang = 'en';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /International Office WhatsApp line/);
    assert.match(root.textContent, /This preference is optional/);
    assert.equal(calls.updatePrefs, 0, 'No PUT call on locale change');

    // Switch to Russian
    document.documentElement.lang = 'ru';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /WhatsApp Международного офиса/);
    assert.equal(calls.updatePrefs, 0);

    // Switch to Turkmen
    document.documentElement.lang = 'tk';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /Halkara Ofisiniň WhatsApp/);
    assert.equal(calls.updatePrefs, 0);

    // Switch to Arabic
    document.documentElement.lang = 'ar';
    document.dispatchEvent(new document.defaultView.Event('public:locale-changed'));
    assert.match(root.textContent, /العلاقات الدولية/);
    assert.equal(calls.updatePrefs, 0);
});

test('tracking view: ready owner session mounts preferences card, supports opt-out and re-opt-in', async () => {
    const { document, root } = createDom();
    const calls = { updatePrefs: [] };
    const trackingPayload = {
        application: {
            id: 'app_track_1',
            student_number: 'STU-TRACK-1',
            status: 'submitted',
            application_type: 'initial'
        },
        documents: []
    };
    const preference = {
        application_id: 'app_track_1',
        whatsapp_opt_in: true,
        consent_version: WHATSAPP_CONSENT_VERSION,
        effective_whatsapp_opt_in: true,
        requires_reconsent: false,
        can_opt_in: true
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() { return { ...preference }; },
        async updateCurrentNotificationPreferences(payload) {
            calls.updatePrefs.push(payload);
            preference.whatsapp_opt_in = payload.whatsapp_opt_in;
            preference.effective_whatsapp_opt_in = Boolean(payload.whatsapp_opt_in);
            preference.consent_version = payload.consent_version || null;
            return { ...preference };
        }
    };

    const result = await initializeApplicationTracking(root, api);
    assert.equal(result.kind, 'ready');

    await flushAsync();
    await flushAsync();

    const prefSection = root.querySelector('.tracking-notification-preferences');
    assert.ok(prefSection, 'Preferences card must be mounted in ready tracking view');

    const statusP = prefSection.querySelector('.tracking-notification-status');
    const button = prefSection.querySelector('button');

    assert.match(statusP.textContent, /WhatsApp bildirim izni kayıtlı/);
    assert.equal(button.dataset.action, 'opt-out');
    assert.match(button.textContent, /WhatsApp Bildirimlerini Kapat/);

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
    assert.match(button.textContent, /WhatsApp Bildirimlerini Aç/);

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
                application: {
                    student_number: studentNumber,
                    status: 'submitted',
                    application_type: 'initial'
                },
                documents: []
            };
        },
        async readCurrentNotificationPreferences() {
            calls.readPrefs++;
            return { whatsapp_opt_in: true };
        }
    };

    const initial = await initializeApplicationTracking(root, api);
    assert.equal(initial.kind, 'lookup');

    // Submit public lookup
    const lookupInput = root.querySelector('#tracking-student-number');
    lookupInput.value = 'PUBLIC-STU-1';
    lookupInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    root.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));

    await flushAsync();
    await flushAsync();

    assert.equal(calls.readPrefs, 0, 'Public lookup must never call readCurrentNotificationPreferences');
    assert.equal(root.querySelector('.tracking-notification-preferences'), null, 'Public lookup must never render preference controls');
    assert.doesNotMatch(root.textContent, /WhatsApp/i, 'No preference data must be leaked');
});

test('tracking view: application_id mismatch hides controls and shows error alert', async () => {
    const { document, root } = createDom();
    const trackingPayload = {
        application: {
            id: 'app_legit_owner',
            student_number: 'STU-MISMATCH',
            status: 'submitted',
            application_type: 'initial'
        },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return {
                application_id: 'app_attacker_other_id',
                whatsapp_opt_in: true,
                consent_version: WHATSAPP_CONSENT_VERSION,
                effective_whatsapp_opt_in: true
            };
        }
    };

    await initializeApplicationTracking(root, api);
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

test('tracking view: can_opt_in = false explains phone required and hides action button', async () => {
    const { document, root } = createDom();
    const trackingPayload = {
        application: {
            id: 'app_no_phone',
            student_number: 'STU-NO-PHONE',
            status: 'submitted',
            application_type: 'initial'
        },
        documents: []
    };
    const api = {
        async readCurrentApplicationTracking() { return trackingPayload; },
        async readCurrentNotificationPreferences() {
            return {
                application_id: 'app_no_phone',
                whatsapp_opt_in: false,
                can_opt_in: false
            };
        }
    };

    await initializeApplicationTracking(root, api);
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
            application: { id: 'app_err', status: 'draft' },
            api: {
                async updateCurrentNotificationPreferences() {
                    throw err;
                }
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
