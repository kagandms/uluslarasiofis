import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { mountInquiryManager } from '../src/staff/inquiryManager.js';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const NEW_ITEMS = [
    {
        id: 'inq-1',
        first_name: 'Ayşe',
        last_name: 'Demir',
        phone: '+90 (505) 123-45 67',
        email: 'ayse@example.edu',
        message: 'Öğrenci belgesi e-Devlet üzerinden kabul ediliyor mu?',
        language: 'tr',
        status: 'new',
        handled_by_name: null,
        handled_at: null,
        created_at: '2026-11-18 10:15:00'
    },
    {
        id: 'inq-2',
        first_name: '<b>John</b>',
        last_name: 'Doe',
        phone: '+90 532 987 65 43',
        email: null,
        message: '<script>alert(1)</script>Health insurance question.',
        language: 'en',
        status: 'new',
        handled_by_name: null,
        handled_at: null,
        created_at: '2026-11-18T11:30:00.000Z'
    }
];

const ANSWERED_ITEMS = [
    {
        id: 'inq-3',
        first_name: 'Selim',
        last_name: 'Ata',
        phone: '+993 65 12 34 56',
        email: null,
        message: 'Uzatma başvurusu ne zaman yapılır?',
        language: 'tk',
        status: 'answered',
        handled_by_name: 'Görevli Test',
        handled_at: '2026-11-18T14:00:00.000Z',
        created_at: '2026-11-18T09:00:00.000Z'
    }
];

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
    await new Promise((resolveTick) => setImmediate(resolveTick));
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function createStaffDom(context) {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    document.getElementById('app-content').hidden = false;
    document.getElementById('login-overlay').hidden = true;
    context.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        dom.window.close();
    });
    return {
        dom,
        document,
        root: document.getElementById('staff-inquiries-manager')
    };
}

test('staff HTML includes Gelen Sorular home card, workspace nav button, and view-inquiries panel', () => {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const doc = dom.window.document;
    try {
        const homeCard = doc.querySelector('#home-screen .home-actions .home-action[data-workspace-view="inquiries"]');
        assert.ok(homeCard);
        assert.equal(homeCard.getAttribute('aria-controls'), 'view-inquiries');
        assert.match(homeCard.textContent, /Gelen Sorular/);
        assert.ok(homeCard.querySelector('[data-inquiries-badge]'));

        const navButton = doc.querySelector('.workspace-nav button[data-workspace-view="inquiries"]');
        assert.ok(navButton);
        assert.equal(navButton.getAttribute('aria-controls'), 'view-inquiries');
        assert.equal(navButton.textContent.trim(), 'Gelen Sorular');

        const panel = doc.getElementById('view-inquiries');
        assert.ok(panel);
        assert.equal(panel.hidden, true);
        assert.ok(panel.querySelector('#staff-inquiries-manager'));
    } finally {
        dom.window.close();
    }
});

test('mount fetches initial new count once for home badge and renders fixture list with tel, wa.me digits, conditional mailto, and XSS-safe text', async (context) => {
    const { document, root } = createStaffDom(context);
    const requests = [];

    initWorkspaceNavigation();
    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            requests.push({ url: String(url), method: options.method || 'GET', options });
            return createJsonResponse({
                items: NEW_ITEMS,
                counts: { new: 2, answered: 1 }
            });
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Initial mount fetches once with no polling.
    assert.equal(requests.length, 1);
    const initialUrl = new URL(requests[0].url, 'https://portal.test');
    assert.equal(initialUrl.pathname, '/api/staff/inquiries');
    assert.equal(initialUrl.searchParams.get('status'), 'new');
    assert.equal(requests[0].options.credentials, 'same-origin');

    const badge = document.getElementById('staff-inquiries-home-badge');
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '2');

    // Clicking the home card opens #view-inquiries.
    document.querySelector('#home-screen .home-action[data-workspace-view="inquiries"]').click();
    await flushPromises();
    assert.equal(document.getElementById('home-screen').hidden, true);
    assert.equal(document.getElementById('view-inquiries').hidden, false);

    assert.equal(root.querySelector('[data-tab-count="new"]').textContent, '2');
    assert.equal(root.querySelector('[data-tab-count="answered"]').textContent, '1');

    const cards = root.querySelectorAll('.staff-inquiry-card');
    assert.equal(cards.length, 2);
    assert.equal(root.querySelector('script, b'), null);

    // First card has email -> tel:, wa.me/<digits>, and mailto:
    assert.match(cards[0].textContent, /Ayşe Demir/);
    assert.match(cards[0].textContent, /Öğrenci belgesi e-Devlet üzerinden kabul ediliyor mu\?/);
    assert.equal(cards[0].querySelector('a.staff-inquiry-tel')?.getAttribute('href'), 'tel:+905051234567');
    assert.equal(cards[0].querySelector('a.staff-inquiry-whatsapp')?.getAttribute('href'), 'https://wa.me/905051234567');
    assert.equal(cards[0].querySelector('a.staff-inquiry-email')?.getAttribute('href'), 'mailto:ayse@example.edu');

    // Second card has email: null -> no mailto link, XSS text rendered safely as plain text.
    assert.match(cards[1].querySelector('.staff-inquiry-name').textContent, /<b>John<\/b> Doe/);
    assert.equal(cards[1].querySelector('a.staff-inquiry-whatsapp')?.getAttribute('href'), 'https://wa.me/905329876543');
    assert.equal(cards[1].querySelector('a[href^="mailto:"]'), null);
});

test('Cevaplandı and Yeniye al buttons send contract PATCH and update counts and home badge', async (context) => {
    const { document, root } = createStaffDom(context);
    const requests = [];

    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            requests.push({ url: String(url), method, options });
            if (method === 'GET' && String(url).includes('status=answered')) {
                return createJsonResponse({
                    items: ANSWERED_ITEMS,
                    counts: { new: 1, answered: 2 }
                });
            }
            if (method === 'GET') {
                return createJsonResponse({
                    items: NEW_ITEMS,
                    counts: { new: 2, answered: 1 }
                });
            }
            if (method === 'PATCH' && String(url).endsWith('/inq-1')) {
                return createJsonResponse({
                    item: { ...NEW_ITEMS[0], status: 'answered', handled_by_name: 'Görevli', handled_at: '2026-11-19T12:00:00.000Z' }
                });
            }
            if (method === 'PATCH' && String(url).endsWith('/inq-3')) {
                return createJsonResponse({
                    item: { ...ANSWERED_ITEMS[0], status: 'new', handled_by_name: null, handled_at: null }
                });
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const firstStatusButton = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-1"] [data-action="toggle-inquiry-status"]');
    assert.equal(firstStatusButton.textContent, 'Cevaplandı');
    firstStatusButton.click();
    await flushPromises();

    const patchToAnswered = requests.find((entry) => entry.method === 'PATCH' && entry.url.endsWith('/inq-1'));
    assert.ok(patchToAnswered);
    assert.equal(patchToAnswered.options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(patchToAnswered.options.body), { status: 'answered' });
    assert.equal(root.querySelectorAll('.staff-inquiry-card').length, 1);
    assert.equal(root.querySelector('[data-tab-count="new"]').textContent, '1');
    assert.equal(root.querySelector('[data-tab-count="answered"]').textContent, '2');
    assert.equal(document.getElementById('staff-inquiries-home-badge').textContent, '1');

    // Switch to Answered tab and revert inq-3 back to new.
    root.querySelector('[data-inquiry-tab="answered"]').click();
    await flushPromises();
    const revertButton = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-3"] [data-action="toggle-inquiry-status"]');
    assert.equal(revertButton.textContent, 'Yeniye al');
    revertButton.click();
    await flushPromises();

    const patchToNew = requests.find((entry) => entry.method === 'PATCH' && entry.url.endsWith('/inq-3'));
    assert.ok(patchToNew);
    assert.deepEqual(JSON.parse(patchToNew.options.body), { status: 'new' });
    assert.equal(root.querySelector('[data-tab-count="new"]').textContent, '2');
    assert.equal(root.querySelector('[data-tab-count="answered"]').textContent, '1');
});

test('Sil button requires confirm step before sending DELETE /api/staff/inquiries/:id and hides badge when count reaches zero', async (context) => {
    const { document, root } = createStaffDom(context);
    const requests = [];

    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            requests.push({ url: String(url), method, options });
            if (method === 'GET') {
                return createJsonResponse({
                    items: [NEW_ITEMS[0]],
                    counts: { new: 1, answered: 0 }
                });
            }
            if (method === 'DELETE' && String(url).endsWith('/inq-1')) {
                return createJsonResponse({ deleted: true });
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const badge = document.getElementById('staff-inquiries-home-badge');
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '1');

    // Clicking Sil alone must not send DELETE.
    root.querySelector('[data-action="request-delete-inquiry"]').click();
    assert.equal(requests.some((entry) => entry.method === 'DELETE'), false);
    assert.ok(root.querySelector('[data-action="confirm-delete-inquiry"]'));

    // Canceling closes the confirm step without DELETE.
    root.querySelector('[data-action="cancel-delete-inquiry"]').click();
    assert.equal(requests.some((entry) => entry.method === 'DELETE'), false);
    assert.equal(root.querySelector('[data-action="confirm-delete-inquiry"]'), null);

    // Re-open confirm and confirm deletion -> sends DELETE and clears badge.
    root.querySelector('[data-action="request-delete-inquiry"]').click();
    root.querySelector('[data-action="confirm-delete-inquiry"]').click();
    await flushPromises();

    const deleteReq = requests.find((entry) => entry.method === 'DELETE');
    assert.ok(deleteReq);
    assert.equal(new URL(deleteReq.url, 'https://portal.test').pathname, '/api/staff/inquiries/inq-1');
    assert.equal(deleteReq.options.credentials, 'same-origin');
    assert.equal(root.querySelectorAll('.staff-inquiry-card').length, 0);
    assert.equal(root.querySelector('[data-tab-count="new"]').textContent, '0');
    assert.equal(badge.hidden, true);
    assert.equal(badge.textContent, '0');
});
