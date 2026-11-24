import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';
import { createPhysicalIntakeClient } from '../src/staff/physical-intake-client.js';
import { renderPhysicalIntakes } from '../src/staff/physical-intake-view.js';
import { splitNoteStatus } from '../src/staff/application-queue-filters.js';
import {
    confirmPermanentDelete,
    performPhysicalPermanentDelete
} from '../src/staff/permanentDeleteDialog.js';
import {
    STAFF_ASSISTANT_VIEWS,
    validateStaffAssistantAction
} from '../src/shared/staff-assistant-contract.js';
import { parseStaffIntent } from '../src/server/domain/staffAssistantIntent.js';
import { validateStaffToolArgs } from '../src/server/domain/staffAssistantTools.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const ONLINE_ITEM = {
    id: 'app-del-1',
    reference_number: 'ITU-2026-0001',
    student_number: '2026000001',
    passport_number: 'P987654',
    first_name: 'Ayşe',
    last_name: 'Yılmaz',
    application_type: 'initial',
    status: 'under_review',
    submitted_at: '2026-11-20T09:00:00.000Z',
    updated_at: '2026-11-21T10:00:00.000Z'
};

const PHYSICAL_ITEM = {
    id: 'phy-del-1',
    tracking_reference: 'ITU-26-0000001',
    passport_number: 'PP112233',
    first_name: 'Mehmet',
    last_name: 'Demir',
    application_type: 'initial',
    application_date: '2026-11-20',
    submitted_at: '2026-11-20T10:00:00.000Z',
    status: 'under_review',
    lock_version: 4,
    metadata_version: 1,
    current_pdf_id: 'pdf-1'
};

function createJsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

function setupStaffDom(context) {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    context.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        dom.window.close();
    });
    return { dom, document };
}

function installFakeFetch(context, handler) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = handler;
    context.after(() => {
        globalThis.fetch = previousFetch;
    });
}

test('Archive card, nav button, view panel, and archive.css are removed from yetkili/index.html and home has 9 cards', () => {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    try {
        assert.equal(document.querySelector('link[href="/src/staff/archive.css"]'), null);
        assert.ok(document.querySelector('link[href="/src/staff/permanentDelete.css"]'));
        assert.equal(document.querySelector('#home-screen [data-workspace-view="archive"]'), null);
        assert.equal(document.querySelector('.workspace-nav [data-workspace-view="archive"]'), null);
        assert.equal(document.getElementById('view-archive'), null);
        assert.equal(document.getElementById('staff-archive-manager'), null);

        const homeCards = [...document.querySelectorAll('#home-screen .home-actions .home-action')];
        assert.equal(homeCards.length, 9);
        assert.deepEqual(
            homeCards.map((card) => card.dataset.workspaceView),
            ['applications', 'ykn', 'cover', 'teblig', 'documents', 'print', 'work-hours', 'yoksis-audit', 'inquiries']
        );
    } finally {
        dom.window.close();
    }
});

test('staff assistant contract no longer lists archive and assistant refuses archive navigation', () => {
    assert.equal(STAFF_ASSISTANT_VIEWS.includes('archive'), false);
    assert.throws(() => validateStaffAssistantAction({ type: 'navigate', view: 'archive' }), { message: 'invalid-action' });
    assert.throws(() => validateStaffToolArgs('navigate', { view: 'archive' }), { message: 'invalid-tool-args' });
    assert.equal(parseStaffIntent('Arşive git'), null);
    assert.equal(parseStaffIntent('Arşiv ekranını aç'), null);
});

test('confirmPermanentDelete opens accessible dialog, renders plain text, traps Tab, cancels on Vazgeç/Esc/backdrop, and returns focus', async (context) => {
    const { dom, document } = setupStaffDom(context);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'Sil';
    document.body.append(trigger);

    // 1. Vazgeç button (default autofocus) cancels and returns focus
    trigger.focus();
    const p1 = confirmPermanentDelete(document, {
        name: '<script>Ayşe</script> Yılmaz',
        number: 'ITU-2026-0001',
        kind: 'online',
        trigger
    });
    const dialog1 = document.querySelector('dialog.permanent-delete-dialog');
    assert.ok(dialog1);
    assert.equal(dialog1.querySelector('script'), null);
    assert.equal(dialog1.querySelector('#permanent-delete-dialog-title')?.textContent, 'Emin misiniz?');
    assert.equal(
        dialog1.querySelector('#permanent-delete-dialog-body')?.textContent,
        '<script>Ayşe</script> Yılmaz · ITU-2026-0001 kaydı, yüklenen belgeleri ve tüm bilgileriyle birlikte KALICI olarak silinecek. Bu işlem geri alınamaz.'
    );
    const cancelBtn1 = dialog1.querySelector('[data-action="cancel-permanent-delete"]');
    const confirmBtn1 = dialog1.querySelector('[data-action="confirm-permanent-delete"]');
    assert.equal(cancelBtn1.textContent, 'Vazgeç');
    assert.equal(confirmBtn1.textContent, 'Evet, kalıcı olarak sil');
    assert.equal(document.activeElement, cancelBtn1);

    // Focus trap cycles with Shift+Tab and Tab
    dialog1.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, confirmBtn1);
    dialog1.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, cancelBtn1);

    cancelBtn1.click();
    assert.equal(await p1, false);
    assert.equal(document.querySelector('dialog.permanent-delete-dialog'), null);
    assert.equal(document.activeElement, trigger);

    // 2. Escape cancels and returns focus (physical copy)
    trigger.focus();
    const p2 = confirmPermanentDelete(document, {
        name: 'Mehmet Demir',
        number: 'ITU-26-0000001',
        kind: 'physical',
        trigger
    });
    const dialog2 = document.querySelector('dialog.permanent-delete-dialog');
    assert.equal(
        dialog2.querySelector('#permanent-delete-dialog-body')?.textContent,
        'Mehmet Demir · ITU-26-0000001 fiziksel teslim kaydı ve PDF dosyaları KALICI olarak silinecek. Bu işlem geri alınamaz.'
    );
    dialog2.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await p2, false);
    assert.equal(document.activeElement, trigger);

    // 3. Backdrop click cancels and returns focus
    trigger.focus();
    const p3 = confirmPermanentDelete(document, {
        name: 'Ayşe Yılmaz',
        number: 'ITU-2026-0001',
        kind: 'online',
        trigger
    });
    const dialog3 = document.querySelector('dialog.permanent-delete-dialog');
    dialog3.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(await p3, false);
    assert.equal(document.activeElement, trigger);
});

test('online permanent delete: Vazgeç/Esc/backdrop do not call fetch; Yes sends POST /delete with confirmed:true and removes row', async (context) => {
    const { dom, document } = setupStaffDom(context);
    const root = document.getElementById('staff-applications-manager');
    let items = [ONLINE_ITEM];
    const deleteRequests = [];

    installFakeFetch(context, async (url, options = {}) => {
        const path = String(url);
        const method = options.method || 'GET';
        if (path.includes('/api/staff/record-notes')) {
            return createJsonResponse({ notes: {} });
        }
        if (path === '/api/staff/applications/query') {
            return createJsonResponse({
                items,
                pagination: { page: 1, page_size: 25, total_items: items.length, total_pages: 1 }
            });
        }
        if (path === `/api/staff/applications/${ONLINE_ITEM.id}/delete` && method === 'POST') {
            deleteRequests.push({ path, method, body: JSON.parse(options.body) });
            items = [];
            return createJsonResponse({ purged: true }, 200);
        }
        throw new Error(`Unexpected fetch: ${method} ${path}`);
    });

    initializeStaffApplicationsManager(root);
    document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', { detail: { viewName: 'applications' } }));
    await flush();

    // Cancel via Vazgeç -> no delete fetch
    let silBtn = root.querySelector('[data-action="delete-application"]');
    assert.ok(silBtn);
    assert.equal(silBtn.classList.contains('btn-permanent-delete'), true);
    silBtn.focus();
    silBtn.click();
    document.querySelector('[data-action="cancel-permanent-delete"]').click();
    await flush();
    assert.equal(deleteRequests.length, 0);
    assert.equal(document.activeElement, silBtn);

    // Cancel via Escape -> no delete fetch
    silBtn.click();
    document.querySelector('dialog.permanent-delete-dialog')
        .dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    assert.equal(deleteRequests.length, 0);

    // Cancel via backdrop -> no delete fetch
    silBtn.click();
    document.querySelector('dialog.permanent-delete-dialog')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(deleteRequests.length, 0);

    // Confirm -> POST /api/staff/applications/:id/delete with {"confirmed": true}
    silBtn.click();
    document.querySelector('[data-action="confirm-permanent-delete"]').click();
    await flush();

    assert.deepEqual(deleteRequests, [{
        path: `/api/staff/applications/${ONLINE_ITEM.id}/delete`,
        method: 'POST',
        body: { confirmed: true }
    }]);
    assert.equal(root.querySelector(`[data-application-id="${ONLINE_ITEM.id}"]`), null);
    assert.match(root.textContent, /Kalıcı olarak silindi\./);
});

for (const errorCase of [
    {
        name: '403 admin required',
        status: 403,
        payload: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
        expected: /Kalıcı silme için yönetici yetkisi gerekir\./
    },
    {
        name: '409 APPLICATION_SPREADSHEET_TRANSFER_PRESENT',
        status: 409,
        payload: { error: { code: 'APPLICATION_SPREADSHEET_TRANSFER_PRESENT', message: 'Önce e-tablodan kaldırın.' } },
        expected: /Önce e-tablodan kaldırın\./
    },
    {
        name: '409 lock conflict',
        status: 409,
        payload: { error: { code: 'LOCK_CONFLICT', message: 'Conflict' } },
        expected: /Kayıt başka bir işlemle değişti\. Listeyi yenileyin\./
    },
    {
        name: '503 *_PURGE_RETRY_REQUIRED',
        status: 503,
        payload: { error: { code: 'APPLICATION_PURGE_RETRY_REQUIRED', message: 'Retry' } },
        expected: /Silme tamamlanamadı; tekrar deneyin\./
    },
    {
        name: '500 generic',
        status: 500,
        payload: { error: { code: 'INTERNAL_ERROR', message: 'boom' } },
        expected: /Silme işlemi tamamlanamadı\. Tekrar deneyin\./
    }
]) {
    test(`online permanent delete handles ${errorCase.name}, keeps row, and re-enables Sil button`, async (context) => {
        const { dom, document } = setupStaffDom(context);
        const root = document.getElementById('staff-applications-manager');

        installFakeFetch(context, async (url, options = {}) => {
            const path = String(url);
            if (path.includes('/api/staff/record-notes')) {
                return createJsonResponse({ notes: {} });
            }
            if (path === '/api/staff/applications/query') {
                return createJsonResponse({
                    items: [ONLINE_ITEM],
                    pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 }
                });
            }
            if (path === `/api/staff/applications/${ONLINE_ITEM.id}/delete` && options.method === 'POST') {
                return createJsonResponse(errorCase.payload, errorCase.status);
            }
            throw new Error(`Unexpected fetch: ${path}`);
        });

        initializeStaffApplicationsManager(root);
        document.dispatchEvent(new dom.window.CustomEvent('workspace:view-changed', { detail: { viewName: 'applications' } }));
        await flush();

        root.querySelector('[data-action="delete-application"]').click();
        document.querySelector('[data-action="confirm-permanent-delete"]').click();
        await flush();

        const silBtn = root.querySelector('[data-action="delete-application"]');
        assert.ok(silBtn);
        assert.equal(silBtn.disabled, false);
        assert.equal(silBtn.textContent, 'Sil');
        assert.match(root.textContent, errorCase.expected);
    });
}

test('physical permanent delete sends DELETE /api/staff/physical-intakes/:id with lock_version and confirmed:true, removes row on 200, and handles 503 retry', async (context) => {
    const { document } = setupStaffDom(context);
    const root = document.getElementById('staff-physical-manager');
    let items = [PHYSICAL_ITEM];
    const deleteRequests = [];
    let nextDeleteResponse = () => {
        items = [];
        return createJsonResponse({ purged: true }, 200);
    };

    installFakeFetch(context, async (url, options = {}) => {
        const path = String(url);
        const method = options.method || 'GET';
        if (path.includes('/api/staff/record-notes')) {
            return createJsonResponse({ notes: {} });
        }
        if (path === '/api/staff/physical-intakes/query') {
            return createJsonResponse({
                items,
                pagination: { page: 1, page_size: 25, total: items.length, total_pages: 1 }
            });
        }
        if (path === `/api/staff/physical-intakes/${PHYSICAL_ITEM.id}` && method === 'DELETE') {
            deleteRequests.push({ path, method, body: JSON.parse(options.body) });
            return nextDeleteResponse();
        }
        throw new Error(`Unexpected fetch: ${method} ${path}`);
    });

    const contextObj = {
        root,
        api: createPhysicalIntakeClient(),
        isBusy: false,
        confirmingDelete: false,
        queueRequestId: 0,
        state: {
            view: 'queue',
            loading: false,
            error: false,
            errorStatus: null,
            deletingId: null,
            recordNotes: new Map(),
            recordNotesResult: null,
            query: { q: '', status: 'all', from_date: '', to_date: '', page: 1, page_size: 25 },
            result: {
                items: [PHYSICAL_ITEM],
                pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 }
            },
            detail: null,
            message: ''
        },
        handlers: null
    };
    const render = (ctx) => renderPhysicalIntakes(ctx.root, ctx.state, ctx.handlers);
    contextObj.handlers = {
        newReceipt: () => {},
        search: () => {},
        page: () => {},
        open: () => {},
        mutate: () => {},
        deleteIntake: (intake, trigger) => performPhysicalPermanentDelete(contextObj, intake, trigger, { render, splitNoteStatus })
    };
    render(contextObj);

    // 1. Cancel does not call DELETE and returns focus
    const initialBtn = root.querySelector('[data-action="delete"]');
    assert.ok(initialBtn);
    assert.equal(initialBtn.classList.contains('btn-permanent-delete'), true);
    initialBtn.focus();
    initialBtn.click();
    await flush();
    document.querySelector('[data-action="cancel-permanent-delete"]').click();
    await flush();
    assert.equal(deleteRequests.length, 0);
    assert.equal(document.activeElement, initialBtn);

    // 2. 503 PHYSICAL_INTAKE_PURGE_RETRY_REQUIRED keeps row and re-enables Sil
    nextDeleteResponse = () => createJsonResponse({
        error: { code: 'PHYSICAL_INTAKE_PURGE_RETRY_REQUIRED', message: 'Retry' }
    }, 503);
    root.querySelector('[data-action="delete"]').click();
    await flush();
    document.querySelector('[data-action="confirm-permanent-delete"]').click();
    await flush();
    assert.equal(deleteRequests.length, 1);
    assert.deepEqual(deleteRequests[0], {
        path: `/api/staff/physical-intakes/${PHYSICAL_ITEM.id}`,
        method: 'DELETE',
        body: { lock_version: 4, confirmed: true }
    });
    const retryBtn = root.querySelector('[data-action="delete"]');
    assert.ok(retryBtn);
    assert.equal(retryBtn.disabled, false);
    assert.equal(retryBtn.textContent, 'Sil');
    assert.match(root.textContent, /Silme tamamlanamadı; tekrar deneyin\./);

    // 3. Confirm with 200 removes row and shows success notice
    nextDeleteResponse = () => {
        items = [];
        return createJsonResponse({ purged: true }, 200);
    };
    const deletedBtn = root.querySelector('[data-action="delete"]');
    deletedBtn.click();
    await flush();
    document.querySelector('[data-action="confirm-permanent-delete"]').click();
    await flush();
    assert.equal(deleteRequests.length, 2);
    assert.equal(root.querySelector('[data-action="delete"]'), null);
    assert.notEqual(document.activeElement, deletedBtn);
    assert.ok(root.contains(document.activeElement) || document.activeElement === document.body);
    assert.match(root.textContent, /Kalıcı olarak silindi\./);
});
