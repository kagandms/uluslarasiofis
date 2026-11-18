import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';
import { createApplicationQueueTable } from '../src/staff/application-queue-table.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const ONLINE_ITEMS = [
    {
        id: 'online-001',
        student_number: '20260001',
        passport_number: 'SYN-PASS-0001',
        first_name: 'Deniz',
        last_name: 'Kaya',
        application_type: 'initial',
        status: 'under_review',
        submitted_at: '2026-10-01T10:00:00.000Z',
        updated_at: '2026-10-02T10:00:00.000Z'
    },
    {
        id: 'online-002',
        student_number: '20260002',
        passport_number: 'SYN-PASS-0002',
        first_name: 'Ece',
        last_name: 'Demir',
        application_type: 'renewal',
        status: 'submitted',
        submitted_at: '2026-10-01T11:00:00.000Z',
        updated_at: '2026-10-02T11:00:00.000Z'
    }
];

const PHYSICAL_ITEMS = [
    {
        id: 'phys-001',
        tracking_reference: 'FZK-0001',
        first_name: 'Mert',
        last_name: 'Arslan',
        application_date: '2026-10-03',
        submitted_at: '2026-10-03T09:00:00.000Z',
        status: 'under_review',
        current_pdf_id: 'pdf-1',
        receipt_state: 'ready',
        receipt_metadata_version: 1,
        metadata_version: 1,
        receipt_template_version: 'v1'
    },
    {
        id: 'phys-002',
        tracking_reference: 'FZK-0002',
        first_name: 'Selin',
        last_name: 'Yıldız',
        application_date: '2026-10-04',
        submitted_at: '2026-10-04T09:00:00.000Z',
        status: 'approved',
        current_pdf_id: null,
        receipt_state: null
    }
];

function createStaffDom(context) {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    const previousDocument = globalThis.document;
    globalThis.document = document;
    context.after(() => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        dom.window.close();
    });
    return {
        dom,
        document,
        applicationsRoot: document.getElementById('staff-applications-manager'),
        physicalRoot: document.getElementById('staff-physical-manager')
    };
}

function installFetchStub(context, handler) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = handler;
    context.after(() => {
        if (previousFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = previousFetch;
    });
}

function createJsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

async function flushPromises() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

function createQueuePayload(items) {
    return {
        items,
        pagination: { page: 1, page_size: 25, total_items: items.length, total_pages: 1 }
    };
}

test('online queue places note button in first cell and loads all page notes in one GET', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    const longNote = 'Öğrenci eksik sigorta poliçesi getirecek ve telefonla bilgilendirilmesi gerekiyor ek bilgi.';
    const requests = [];

    installFetchStub(context, async (url, options = {}) => {
        requests.push({ url: String(url), options });
        return createJsonResponse({
            notes: {
                'online-001': {
                    body: longNote,
                    updated_at: '2026-10-05T12:00:00.000Z',
                    updated_by_name: 'Görevli Test'
                }
            }
        });
    });

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => createQueuePayload(ONLINE_ITEMS)
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();

    assert.equal(requests.length, 1);
    const parsedUrl = new URL(requests[0].url, 'https://portal.test');
    assert.equal(parsedUrl.pathname, '/api/staff/record-notes');
    assert.equal(parsedUrl.searchParams.get('kind'), 'online');
    assert.equal(parsedUrl.searchParams.get('ids'), 'online-001,online-002');
    assert.equal(requests[0].options.credentials, 'same-origin');

    const rows = applicationsRoot.querySelectorAll('tbody tr');
    assert.equal(rows.length, 2);

    const firstButton = rows[0].querySelector('td:first-child button[data-action="record-note"]');
    const secondButton = rows[1].querySelector('td:first-child button[data-action="record-note"]');
    assert.ok(firstButton);
    assert.ok(secondButton);
    assert.equal(rows[0].querySelector('td[data-label="Pasaport No"]')?.textContent, 'SYN-PASS-0001');

    assert.equal(firstButton.classList.contains('has-note'), true);
    assert.equal(firstButton.dataset.hasNote, 'true');
    assert.equal(firstButton.querySelector('.staff-record-note-label')?.textContent, 'Notu düzenle');
    assert.ok(firstButton.title.includes(longNote.slice(0, 80)));
    assert.equal(firstButton.title.includes(longNote), false);
    assert.ok(firstButton.title.includes('Yalnız personel görür'));
    assert.ok(firstButton.getAttribute('aria-label')?.includes(longNote.slice(0, 80)));

    assert.equal(secondButton.classList.contains('has-note'), false);
    assert.equal(secondButton.dataset.hasNote, 'false');
    assert.equal(secondButton.querySelector('.staff-record-note-label')?.textContent, 'Not ekle');
    assert.ok(secondButton.title.includes('Not ekle'));
});

test('physical queue renders note button before row number, loads notes with one GET, and leaves default queue table unchanged when noteKind is absent', async (context) => {
    const { document, physicalRoot } = createStaffDom(context);
    const requests = [];

    installFetchStub(context, async (url, options = {}) => {
        requests.push({ url: String(url), options });
        return createJsonResponse({
            notes: {
                'phys-002': {
                    body: 'Pasaport fotokopisi teyit edildi.',
                    updated_at: '2026-10-06T09:00:00.000Z',
                    updated_by_name: 'Ofis Görevlisi'
                }
            }
        });
    });

    renderPhysicalIntakes(physicalRoot, {
        view: 'queue',
        message: 'Fiziksel teslimler',
        query: { page_size: 25 },
        result: {
            items: PHYSICAL_ITEMS,
            pagination: { page: 1, page_size: 25, total: 2, total_pages: 1 }
        }
    }, {
        newReceipt() {},
        search() {},
        page() {},
        open() {},
        mutate() {}
    });
    await flushPromises();

    assert.equal(requests.length, 1);
    const parsedUrl = new URL(requests[0].url, 'https://portal.test');
    assert.equal(parsedUrl.pathname, '/api/staff/record-notes');
    assert.equal(parsedUrl.searchParams.get('kind'), 'physical');
    assert.equal(parsedUrl.searchParams.get('ids'), 'phys-001,phys-002');

    const headers = [...physicalRoot.querySelectorAll('thead th')].map((th) => th.textContent);
    assert.equal(headers[0], '');
    assert.equal(headers[1], 'Pasaport No');

    const rows = physicalRoot.querySelectorAll('tbody tr');
    assert.equal(rows.length, 2);
    const firstNoteBtn = rows[0].querySelector('td:first-child button[data-action="record-note"]');
    const secondNoteBtn = rows[1].querySelector('td:first-child button[data-action="record-note"]');
    assert.ok(firstNoteBtn);
    assert.ok(secondNoteBtn);
    assert.equal(rows[0].querySelector('td:nth-child(2)')?.textContent, '1');
    assert.equal(rows[1].querySelector('td:nth-child(2)')?.textContent, '2');
    assert.equal(firstNoteBtn.dataset.hasNote, 'false');
    assert.equal(secondNoteBtn.dataset.hasNote, 'true');
    assert.ok(secondNoteBtn.title.includes('Pasaport fotokopisi teyit edildi.'));

    const plainTable = createApplicationQueueTable(document, [PHYSICAL_ITEMS[0]], {
        statusLabel: (status) => status,
        actions: () => [{ label: 'Detay', action: 'open-detail', run: () => {} }]
    });
    assert.equal(plainTable.querySelectorAll('th').length, 7);
    assert.equal(plainTable.querySelector('[data-action="record-note"]'), null);
    assert.equal(requests.length, 1);
});

test('dialog opens with existing note, saves trimmed body via PUT, and updates button in place without reloading list', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    let queryCalls = 0;
    const requests = [];

    installFetchStub(context, async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || 'GET', options });
        if ((options.method || 'GET') === 'GET') {
            return createJsonResponse({
                notes: {
                    'online-001': {
                        body: 'İlk not',
                        updated_at: '2026-10-05T12:00:00.000Z',
                        updated_by_name: 'Görevli Test'
                    }
                }
            });
        }
        if (options.method === 'PUT') {
            const parsed = JSON.parse(options.body);
            return createJsonResponse({
                note: {
                    id: 'online-001',
                    kind: 'online',
                    body: parsed.body,
                    updated_at: '2026-10-06T14:00:00.000Z',
                    updated_by_name: 'Görevli Test'
                }
            });
        }
        throw new Error(`Unexpected request: ${options.method} ${url}`);
    });

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => {
            queryCalls += 1;
            return createQueuePayload([ONLINE_ITEMS[0]]);
        }
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();
    assert.equal(queryCalls, 1);

    const noteButton = applicationsRoot.querySelector('tbody tr:first-child td:first-child button[data-action="record-note"]');
    noteButton.click();

    const dialog = document.querySelector('dialog.staff-record-note-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('h2')?.textContent, 'Not');
    assert.ok(dialog.textContent.includes('Yalnız personel görür'));
    assert.ok(dialog.textContent.includes('Deniz Kaya'));

    const textarea = dialog.querySelector('textarea');
    assert.equal(textarea.value, 'İlk not');
    assert.equal(textarea.maxLength, 500);
    assert.equal(textarea.placeholder, 'Örn. Eksik evrak var, aranacak');
    assert.equal(dialog.querySelector('[data-note-counter]')?.textContent, '7/500');
    assert.ok(dialog.querySelector('[data-action="save-record-note"]'));
    assert.ok(dialog.querySelector('[data-action="delete-record-note"]'));
    assert.ok(dialog.querySelector('[data-action="close-record-note"]'));

    textarea.value = '   Güncellenmiş personel notu   ';
    textarea.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(dialog.querySelector('[data-note-counter]')?.textContent, '32/500');

    dialog.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const putRequest = requests.find((entry) => entry.method === 'PUT');
    assert.ok(putRequest);
    assert.equal(new URL(putRequest.url, 'https://portal.test').pathname, '/api/staff/record-notes/online/online-001');
    assert.equal(putRequest.options.credentials, 'same-origin');
    assert.equal(putRequest.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(putRequest.options.body), { body: 'Güncellenmiş personel notu' });

    assert.equal(document.querySelector('dialog.staff-record-note-dialog'), null);
    assert.equal(queryCalls, 1);
    assert.equal(requests.filter((entry) => entry.method === 'GET').length, 1);
    assert.equal(noteButton.classList.contains('has-note'), true);
    assert.equal(noteButton.querySelector('.staff-record-note-label')?.textContent, 'Notu düzenle');
    assert.ok(noteButton.title.includes('Güncellenmiş personel notu'));
});

test('empty and 501-character notes are blocked client-side and delete button is absent without existing note', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    const putCalls = [];

    installFetchStub(context, async (_url, options = {}) => {
        if ((options.method || 'GET') === 'GET') {
            return createJsonResponse({ notes: {} });
        }
        putCalls.push(options);
        return createJsonResponse({});
    });

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => createQueuePayload([ONLINE_ITEMS[1]])
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();

    const noteButton = applicationsRoot.querySelector('tbody tr:first-child td:first-child button[data-action="record-note"]');
    noteButton.click();

    const dialog = document.querySelector('dialog.staff-record-note-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('[data-action="delete-record-note"]'), null);
    assert.equal(dialog.querySelector('[data-note-counter]')?.textContent, '0/500');

    const textarea = dialog.querySelector('textarea');
    const form = dialog.querySelector('form');
    const errorBox = dialog.querySelector('[role="alert"]');

    textarea.value = '   \n\t  ';
    textarea.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(putCalls.length, 0);
    assert.equal(errorBox.hidden, false);
    assert.match(errorBox.textContent, /boş olamaz/i);

    textarea.value = 'a'.repeat(501);
    textarea.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    assert.equal(dialog.querySelector('[data-note-counter]')?.textContent, '501/500');
    form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(putCalls.length, 0);
    assert.equal(errorBox.hidden, false);
    assert.match(errorBox.textContent, /500 karakter/i);
});

test('Notu Sil calls DELETE and clears button state in place', async (context) => {
    const { document, physicalRoot } = createStaffDom(context);
    const requests = [];

    installFetchStub(context, async (url, options = {}) => {
        requests.push({ url: String(url), method: options.method || 'GET', options });
        if ((options.method || 'GET') === 'GET') {
            return createJsonResponse({
                notes: {
                    'phys-001': { body: 'Silinecek not', updated_at: '2026-10-05T10:00:00.000Z', updated_by_name: 'Görevli' }
                }
            });
        }
        if (options.method === 'DELETE') {
            return createJsonResponse({ deleted: true });
        }
        throw new Error(`Unexpected request: ${options.method}`);
    });

    renderPhysicalIntakes(physicalRoot, {
        view: 'queue',
        message: 'Fiziksel teslimler',
        query: { page_size: 25 },
        result: { items: [PHYSICAL_ITEMS[0]], pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 } }
    }, {
        newReceipt() {},
        search() {},
        page() {},
        open() {},
        mutate() {}
    });
    await flushPromises();

    const noteButton = physicalRoot.querySelector('tbody tr:first-child td:first-child button[data-action="record-note"]');
    assert.equal(noteButton.classList.contains('has-note'), true);

    noteButton.click();
    const deleteButton = document.querySelector('dialog.staff-record-note-dialog [data-action="delete-record-note"]');
    assert.ok(deleteButton);
    assert.equal(deleteButton.textContent, 'Notu Sil');

    deleteButton.click();
    await flushPromises();

    const deleteRequest = requests.find((entry) => entry.method === 'DELETE');
    assert.ok(deleteRequest);
    assert.equal(new URL(deleteRequest.url, 'https://portal.test').pathname, '/api/staff/record-notes/physical/phys-001');
    assert.equal(deleteRequest.options.credentials, 'same-origin');

    assert.equal(document.querySelector('dialog.staff-record-note-dialog'), null);
    assert.equal(noteButton.classList.contains('has-note'), false);
    assert.equal(noteButton.dataset.hasNote, 'false');
    assert.equal(noteButton.querySelector('.staff-record-note-label')?.textContent, 'Not ekle');
    assert.ok(noteButton.title.includes('Not ekle'));
});

test('GET failure fails silently with only errorName logged and leaves the queue list intact', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    const logged = [];
    const originalConsoleError = console.error;
    console.error = (...args) => { logged.push(args); };
    context.after(() => { console.error = originalConsoleError; });

    installFetchStub(context, async () => {
        throw new TypeError('network offline secret-detail');
    });

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => createQueuePayload(ONLINE_ITEMS)
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();

    assert.equal(applicationsRoot.querySelectorAll('tbody tr').length, 2);
    assert.match(applicationsRoot.textContent, /Deniz Kaya/);
    const noteButtons = applicationsRoot.querySelectorAll('button[data-action="record-note"]');
    assert.equal(noteButtons.length, 2);
    assert.equal(noteButtons[0].classList.contains('has-note'), false);
    assert.equal(logged.length, 1);
    assert.deepEqual(Object.keys(logged[0][1]), ['errorName']);
    assert.equal(logged[0][1].errorName, 'TypeError');
});

test('Escape closes the note dialog and restores focus to the trigger button without leaving the workspace', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    document.getElementById('app-content').hidden = false;

    installFetchStub(context, async () => createJsonResponse({ notes: {} }));

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => createQueuePayload([ONLINE_ITEMS[0]])
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();

    const triggerButton = applicationsRoot.querySelector('tbody tr:first-child td:first-child button[data-action="record-note"]');
    triggerButton.focus();
    triggerButton.click();

    const dialog = document.querySelector('dialog.staff-record-note-dialog');
    assert.ok(dialog);
    const textarea = dialog.querySelector('textarea');
    assert.equal(document.activeElement, textarea);

    textarea.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
    }));

    assert.equal(document.querySelector('dialog.staff-record-note-dialog'), null);
    assert.equal(document.activeElement, triggerButton);
    assert.equal(document.getElementById('view-applications').hidden, false);

    triggerButton.click();
    const reopened = document.querySelector('dialog.staff-record-note-dialog');
    reopened.querySelector('[data-action="close-record-note"]').click();
    assert.equal(document.querySelector('dialog.staff-record-note-dialog'), null);
    assert.equal(document.activeElement, triggerButton);
});

test('note text and student names are rendered as plain text with zero HTML injection', async (context) => {
    const { document, applicationsRoot } = createStaffDom(context);
    const xssNote = '<img src=x onerror=alert(1)><script>window.__xss=true</script>';
    const xssStudent = {
        ...ONLINE_ITEMS[0],
        first_name: '<b>Ada</b>',
        last_name: '<svg onload=alert(2)>Test</svg>'
    };

    installFetchStub(context, async (_url, options = {}) => {
        if ((options.method || 'GET') === 'GET') {
            return createJsonResponse({
                notes: {
                    'online-001': { body: xssNote, updated_at: '2026-10-05T12:00:00.000Z', updated_by_name: '<i>Staff</i>' }
                }
            });
        }
        return createJsonResponse({
            note: { id: 'online-001', kind: 'online', body: xssNote, updated_at: '2026-10-05T12:00:00.000Z', updated_by_name: '<i>Staff</i>' }
        });
    });

    initWorkspaceNavigation();
    initializeStaffApplicationsManager(applicationsRoot, {
        queryApplications: async () => createQueuePayload([xssStudent])
    });
    document.querySelector('.home-actions [data-workspace-view="applications"]').click();
    await flushPromises();

    const noteButton = applicationsRoot.querySelector('button[data-action="record-note"]');
    assert.ok(noteButton.title.includes(xssNote));
    assert.equal(applicationsRoot.querySelector('script, img, b'), null);

    noteButton.click();
    const dialog = document.querySelector('dialog.staff-record-note-dialog');
    assert.ok(dialog);
    assert.equal(dialog.querySelector('script, img, b, i'), null);
    assert.equal(dialog.querySelector('textarea').value, xssNote);
    assert.ok(dialog.querySelector('.staff-record-note-student')?.textContent.includes('<b>Ada</b>'));
});
