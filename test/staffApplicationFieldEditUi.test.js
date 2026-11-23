import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

function createStaffDom() {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    return {
        dom,
        document: dom.window.document,
        root: dom.window.document.getElementById('staff-applications-manager')
    };
}

function installDocument(context, document) {
    const previousDocument = globalThis.document;
    globalThis.document = document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        document.defaultView.close();
    });
}

function createQueuePayload(items) {
    return {
        items,
        pagination: {
            page: 1,
            page_size: 25,
            total_items: items.length,
            total_pages: 1
        }
    };
}

function createSyntheticApplication(overrides = {}) {
    return {
        id: 'app-test-001',
        reference_number: 'ITU-T100-1001',
        student_number: 'T1001',
        status: 'under_review',
        application_type: 'renewal',
        first_name: 'Test',
        last_name: 'Kullanıcı',
        email: 'test@example.edu',
        phone: '+905550000001',
        passport_number: 'P0001001',
        nationality: 'Testland',
        date_of_birth: '2001-01-01',
        is_under_18: false,
        address_evidence_type: 'undertaking',
        host_is_turkish: 'yes',
        fingerprint_code: 'FP-TEST-1',
        contact_acknowledgement_accepted_current: true,
        submitted_at: '2026-10-01T10:00:00.000Z',
        updated_at: '2026-10-02T10:00:00.000Z',
        lock_version: 3,
        ...overrides
    };
}

async function openApplicationDetail(document, root, api) {
    initWorkspaceNavigation();
    initializeStaffApplicationsManager(root, api);
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await new Promise((resolve) => setImmediate(resolve));
    root.querySelector('[data-action="open-detail"]').click();
    await new Promise((resolve) => setImmediate(resolve));
}

function findSummaryRowByLabel(root, label) {
    return [...root.querySelectorAll('.staff-application-summary .staff-application-details-grid .staff-application-detail-item')]
        .find((item) => item.querySelector('dt')?.textContent.trim() === label);
}

test('editable summary rows show accessible edit buttons while non-editable rows do not', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const application = createSyntheticApplication({
        application_type: 'transition',
        date_of_birth: '2010-05-15',
        is_under_18: true,
        residence_application_date: '2026-09-20',
        academic_year_start_date: '2026-09-28',
        transition_foreign_id: '99123456780',
        transition_card_serial: 'SER-100',
        transition_card_number: 'CRD-200',
        transition_change_province: false,
        transition_contact_preference: 'email'
    });
    const api = {
        async queryApplications() { return createQueuePayload([application]); },
        async readApplicationDetail() {
            return { application, allowed_status_transitions: [], documents: [] };
        }
    };

    await openApplicationDetail(document, root, api);

    const editableLabels = [
        ['Öğrenci No', 'student_number'],
        ['Ad', 'first_name'],
        ['Soyad', 'last_name'],
        ['E-posta', 'email'],
        ['Telefon', 'phone'],
        ['Pasaport No', 'passport_number'],
        ['Uyruk', 'nationality'],
        ['Doğum tarihi', 'date_of_birth'],
        ['e-İkamet başvuru tarihi', 'residence_application_date'],
        ['Yabancı kimlik no', 'transition_foreign_id'],
        ['Mevcut kart seri no', 'transition_card_serial'],
        ['Mevcut kart no', 'transition_card_number']
    ];

    for (const [label, fieldKey] of editableLabels) {
        const row = findSummaryRowByLabel(root, label);
        assert.ok(row, `Row for ${label} must exist`);
        const button = row.querySelector('dd [data-action="edit-application-field"]');
        assert.ok(button, `Edit button for ${label} must exist inside dd`);
        assert.equal(button.type, 'button');
        assert.equal(button.dataset.field, fieldKey);
        assert.equal(button.getAttribute('aria-label'), `${label} alanını düzenle`);
        assert.equal(row.querySelector('dt')?.tagName, 'DT');
        assert.equal(row.querySelector('dd')?.tagName, 'DD');
    }

    const nonEditableLabels = [
        'Başvuru Referansı',
        'Durum',
        'Başvuru türü',
        'Akademik yıl başlangıç tarihi',
        'İkamet ili değişikliği',
        'Tercih edilen iletişim',
        '18 yaş altı (başvuru tarihine göre)',
        'Adres belgesi türü',
        'Taahhüt veren kişi Türk vatandaşı mı?',
        'Parmak izi kodu',
        'İletişim teyidi',
        'Gönderim'
    ];

    for (const label of nonEditableLabels) {
        const row = findSummaryRowByLabel(root, label);
        assert.ok(row, `Non-editable row ${label} must exist`);
        assert.equal(row.querySelector('[data-action="edit-application-field"]'), null, `${label} must not have edit button`);
    }

    // Verify no personal data values are leaked into data-* attributes
    const buttons = [...root.querySelectorAll('[data-action="edit-application-field"]')];
    for (const button of buttons) {
        assert.doesNotMatch(JSON.stringify(button.dataset), /T1001|Test|Kullanıcı|test@example\.edu|P0001001/);
    }
});

for (const blockedCase of [
    { name: 'draft', overrides: { status: 'draft', submitted_at: null } },
    { name: 'completed', overrides: { status: 'completed' } },
    { name: 'cancelled', overrides: { status: 'cancelled' } },
    { name: 'rejected', overrides: { status: 'rejected' } },
    { name: 'deleted', overrides: { status: 'under_review', deletion_state: 'deleted' } }
]) {
    test(`no edit pencil buttons render for ${blockedCase.name} applications`, async (context) => {
        const { document, root } = createStaffDom();
        installDocument(context, document);
        const application = createSyntheticApplication(blockedCase.overrides);
        const api = {
            async queryApplications() { return createQueuePayload([application]); },
            async readApplicationDetail() {
                return { application, allowed_status_transitions: [], documents: [] };
            }
        };

        await openApplicationDetail(document, root, api);

        assert.equal(root.querySelectorAll('[data-action="edit-application-field"]').length, 0);
        assert.equal(findSummaryRowByLabel(root, 'Öğrenci No')?.querySelector('dd')?.textContent.trim(), 'T1001');
    });
}

test('clicking edit opens focused input (including type=date), cancel restores original value and button focus', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const application = createSyntheticApplication({
        is_under_18: true,
        date_of_birth: '2010-05-15',
        residence_application_date: '2026-09-20',
        academic_year_start_date: '2026-09-28'
    });
    let updateCalls = 0;
    const api = {
        async queryApplications() { return createQueuePayload([application]); },
        async readApplicationDetail() {
            return { application, allowed_status_transitions: [], documents: [] };
        },
        async updateApplicationFields() {
            updateCalls += 1;
            return { application, changed_fields: [] };
        }
    };

    await openApplicationDetail(document, root, api);

    // Date field renders input[type="date"]
    const dobButton = root.querySelector('[data-action="edit-application-field"][data-field="date_of_birth"]');
    dobButton.click();
    const dobInput = root.querySelector('[data-action="field-edit-input"]');
    assert.ok(dobInput);
    assert.equal(dobInput.type, 'date');
    assert.equal(dobInput.value, '2010-05-15');
    assert.equal(document.activeElement, dobInput);

    // Cancel via button restores display and focus
    dobInput.value = '2009-01-01';
    root.querySelector('[data-action="cancel-application-field"]').click();
    assert.equal(root.querySelector('[data-action="field-edit-input"]'), null);
    assert.equal(findSummaryRowByLabel(root, 'Doğum tarihi')?.querySelector('dd')?.textContent.trim(), '2010-05-15');
    assert.equal(
        document.activeElement,
        root.querySelector('[data-action="edit-application-field"][data-field="date_of_birth"]')
    );

    // Residence application date also renders input[type="date"] and Escape cancels without leaving workspace
    root.querySelector('[data-action="edit-application-field"][data-field="residence_application_date"]').click();
    const resInput = root.querySelector('[data-action="field-edit-input"]');
    assert.equal(resInput.type, 'date');
    assert.equal(resInput.value, '2026-09-20');
    resInput.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(root.querySelector('[data-action="field-edit-input"]'), null);
    assert.equal(document.getElementById('view-applications').hidden, false);
    assert.equal(
        document.activeElement,
        root.querySelector('[data-action="edit-application-field"][data-field="residence_application_date"]')
    );
    assert.equal(updateCalls, 0);
});

test('saving a single changed field sends PATCH payload, disables buttons while pending, updates summary and lock_version, and invalidates queue cache', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const initialApp = createSyntheticApplication({ lock_version: 0 });
    let detailReads = 0;
    let queueReads = 0;
    const patchCalls = [];
    let resolvePatch;
    const api = {
        async queryApplications() {
            queueReads += 1;
            return createQueuePayload([initialApp]);
        },
        async readApplicationDetail() {
            detailReads += 1;
            return { application: initialApp, allowed_status_transitions: [], documents: [] };
        },
        updateApplicationFields(applicationId, lockVersion, fields) {
            patchCalls.push([applicationId, lockVersion, fields]);
            return new Promise((resolve) => { resolvePatch = resolve; });
        }
    };

    await openApplicationDetail(document, root, api);
    assert.equal(detailReads, 1);
    assert.equal(queueReads, 1);

    root.querySelector('[data-action="edit-application-field"][data-field="first_name"]').click();
    const input = root.querySelector('[data-action="field-edit-input"]');
    input.value = 'Deneme';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );

    // While in flight: buttons and input are disabled
    assert.equal(root.querySelector('[data-action="save-application-field"]').disabled, true);
    assert.equal(root.querySelector('[data-action="cancel-application-field"]').disabled, true);
    assert.equal(root.querySelector('[data-action="field-edit-input"]').disabled, true);
    assert.equal(
        root.querySelector('[data-action="edit-application-field"][data-field="last_name"]').disabled,
        true
    );
    assert.deepEqual(patchCalls, [['app-test-001', 0, { first_name: 'Deneme' }]]);

    resolvePatch({
        application: { ...initialApp, first_name: 'Deneme', lock_version: 1 },
        changed_fields: ['first_name']
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Summary reflects new value, shows Kaydedildi, does not refetch detail, invalidates queue cache, returns focus
    assert.equal(findSummaryRowByLabel(root, 'Ad')?.querySelector('dd')?.textContent.trim(), 'Deneme');
    assert.equal(root.querySelector('.staff-field-edit-notice')?.textContent, 'Kaydedildi');
    assert.equal(detailReads, 1);
    assert.equal(queueReads, 2);
    assert.equal(
        document.activeElement,
        root.querySelector('[data-action="edit-application-field"][data-field="first_name"]')
    );

    // Next edit uses updated lock_version (1)
    root.querySelector('[data-action="edit-application-field"][data-field="last_name"]').click();
    root.querySelector('[data-action="field-edit-input"]').value = 'Yeni';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(patchCalls[1], ['app-test-001', 1, { last_name: 'Yeni' }]);
});

test('unchanged value closes inline edit without calling API', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const application = createSyntheticApplication();
    let patchCalls = 0;
    const api = {
        async queryApplications() { return createQueuePayload([application]); },
        async readApplicationDetail() {
            return { application, allowed_status_transitions: [], documents: [] };
        },
        async updateApplicationFields() {
            patchCalls += 1;
            return { application, changed_fields: [] };
        }
    };

    await openApplicationDetail(document, root, api);

    root.querySelector('[data-action="edit-application-field"][data-field="first_name"]').click();
    const input = root.querySelector('[data-action="field-edit-input"]');
    input.value = '  Test  ';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(patchCalls, 0);
    assert.equal(root.querySelector('[data-action="field-edit-input"]'), null);
    assert.equal(findSummaryRowByLabel(root, 'Ad')?.querySelector('dd')?.textContent.trim(), 'Test');
    assert.equal(
        document.activeElement,
        root.querySelector('[data-action="edit-application-field"][data-field="first_name"]')
    );
});

test('409 API error displays server message below the row and keeps the field in edit mode', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const application = createSyntheticApplication();
    let detailReads = 0;
    const api = {
        async queryApplications() { return createQueuePayload([application]); },
        async readApplicationDetail() {
            detailReads += 1;
            return { application, allowed_status_transitions: [], documents: [] };
        },
        async updateApplicationFields() {
            throw Object.assign(new Error('Bu öğrenci numarası başka başvuruda kayıtlı.'), {
                status: 409,
                code: 'STUDENT_NUMBER_IN_USE'
            });
        }
    };

    await openApplicationDetail(document, root, api);

    root.querySelector('[data-action="edit-application-field"][data-field="student_number"]').click();
    const input = root.querySelector('[data-action="field-edit-input"]');
    input.value = 'T2002';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));

    const row = findSummaryRowByLabel(root, 'Öğrenci No');
    const activeInput = row.querySelector('[data-action="field-edit-input"]');
    const errorBox = row.querySelector('.staff-detail-edit-error[role="alert"]');
    assert.ok(activeInput);
    assert.equal(activeInput.value, 'T2002');
    assert.equal(activeInput.disabled, false);
    assert.equal(row.querySelector('[data-action="save-application-field"]').disabled, false);
    assert.equal(errorBox?.textContent, 'Bu öğrenci numarası başka başvuruda kayıtlı.');
    assert.equal(detailReads, 1);
});

test('APPLICATION_UPDATE_CONFLICT displays message and reloads detail to refresh lock_version', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const initialApp = createSyntheticApplication({ lock_version: 2 });
    const refreshedApp = createSyntheticApplication({ lock_version: 5, first_name: 'Sunucudaki' });
    let detailReads = 0;
    const patchCalls = [];
    const api = {
        async queryApplications() { return createQueuePayload([initialApp]); },
        async readApplicationDetail() {
            detailReads += 1;
            return {
                application: detailReads === 1 ? initialApp : refreshedApp,
                allowed_status_transitions: [],
                documents: []
            };
        },
        async updateApplicationFields(id, lockVersion, fields) {
            patchCalls.push([id, lockVersion, fields]);
            if (lockVersion === 2) {
                throw Object.assign(new Error('Başvuru başka bir işlemle güncellendi.'), {
                    status: 409,
                    code: 'APPLICATION_UPDATE_CONFLICT'
                });
            }
            return { application: { ...refreshedApp, ...fields, lock_version: 6 }, changed_fields: ['first_name'] };
        }
    };

    await openApplicationDetail(document, root, api);

    root.querySelector('[data-action="edit-application-field"][data-field="first_name"]').click();
    root.querySelector('[data-action="field-edit-input"]').value = 'YeniTest';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(detailReads, 2);
    const row = findSummaryRowByLabel(root, 'Ad');
    assert.equal(row.querySelector('.staff-detail-edit-error')?.textContent, 'Başvuru başka bir işlemle güncellendi.');
    assert.ok(row.querySelector('[data-action="field-edit-input"]'));

    // Retrying save uses reloaded lock_version (5)
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(patchCalls, [
        ['app-test-001', 2, { first_name: 'YeniTest' }],
        ['app-test-001', 5, { first_name: 'YeniTest' }]
    ]);
    assert.equal(findSummaryRowByLabel(root, 'Ad')?.querySelector('dd')?.textContent.trim(), 'YeniTest');
});

test('client-side validation rejects empty values and invalid student_number format without calling API, while uppercasing valid student_number', async (context) => {
    const { document, root } = createStaffDom();
    installDocument(context, document);
    const application = createSyntheticApplication();
    const patchCalls = [];
    const api = {
        async queryApplications() { return createQueuePayload([application]); },
        async readApplicationDetail() {
            return { application, allowed_status_transitions: [], documents: [] };
        },
        async updateApplicationFields(...args) {
            patchCalls.push(args);
            return {
                application: { ...application, ...args[2], lock_version: 4 },
                changed_fields: Object.keys(args[2])
            };
        }
    };

    await openApplicationDetail(document, root, api);

    // Invalid student_number format
    root.querySelector('[data-action="edit-application-field"][data-field="student_number"]').click();
    const studentInput = root.querySelector('[data-action="field-edit-input"]');
    studentInput.value = 't1001!@#';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(patchCalls.length, 0);
    let studentRow = findSummaryRowByLabel(root, 'Öğrenci No');
    assert.equal(
        studentRow.querySelector('.staff-detail-edit-error')?.textContent,
        'Öğrenci numarası yalnızca harf, rakam, - ve _ içerebilir.'
    );
    assert.equal(studentRow.querySelector('[data-action="field-edit-input"]')?.value, 'T1001!@#');

    // Empty value is rejected
    studentRow.querySelector('[data-action="field-edit-input"]').value = '   ';
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(patchCalls.length, 0);
    studentRow = findSummaryRowByLabel(root, 'Öğrenci No');
    assert.equal(studentRow.querySelector('.staff-detail-edit-error')?.textContent, 'Bu alan boş bırakılamaz.');

    // Lowercase valid student_number is uppercased on input and sent
    const liveInput = studentRow.querySelector('[data-action="field-edit-input"]');
    liveInput.value = 't-2026_a';
    liveInput.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(liveInput.value, 'T-2026_A');
    root.querySelector('.staff-detail-edit-form').dispatchEvent(
        new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(patchCalls, [['app-test-001', 3, { student_number: 'T-2026_A' }]]);
    assert.equal(findSummaryRowByLabel(root, 'Öğrenci No')?.querySelector('dd')?.textContent.trim(), 'T-2026_A');
});
