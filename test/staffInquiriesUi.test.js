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

    // First card has email -> tel:, wa.me/<digits>?text=..., and mailto:
    assert.match(cards[0].textContent, /Ayşe Demir/);
    assert.match(cards[0].textContent, /Öğrenci belgesi e-Devlet üzerinden kabul ediliyor mu\?/);
    assert.equal(cards[0].querySelector('a.staff-inquiry-tel')?.getAttribute('href'), 'tel:+905051234567');
    const waHref0 = cards[0].querySelector('a.staff-inquiry-whatsapp')?.getAttribute('href') || '';
    assert.ok(waHref0.startsWith('https://wa.me/905051234567?text='));
    assert.equal(
        new URL(waHref0).searchParams.get('text'),
        "Merhaba, İstanbul Topkapı Üniversitesi Uluslararası Ofisi'nden yazıyorum. Gördüğümüz üzere portalımız üzerinden bize şu mesajı göndermişsiniz:\n«Öğrenci belgesi e-Devlet üzerinden kabul ediliyor mu?»\n\n\n\nAnlayışınız için teşekkür ederiz."
    );
    assert.equal(cards[0].querySelector('a.staff-inquiry-email')?.getAttribute('href'), 'mailto:ayse@example.edu');

    // Second card has email: null -> no mailto link, XSS text rendered safely as plain text.
    assert.match(cards[1].querySelector('.staff-inquiry-name').textContent, /<b>John<\/b> Doe/);
    const waHref1 = cards[1].querySelector('a.staff-inquiry-whatsapp')?.getAttribute('href') || '';
    assert.ok(waHref1.startsWith('https://wa.me/905329876543?text='));
    assert.equal(
        new URL(waHref1).searchParams.get('text'),
        'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“<script>alert(1)</script>Health insurance question.”\n\n\n\nThank you for your understanding.'
    );
    assert.equal(cards[1].querySelector('a[href^="mailto:"]'), null);
});

test('card WhatsApp href decodes to TR draft for TR inquiry and EN draft for inquiry without language', async (context) => {
    const { root } = createStaffDom(context);
    const items = [
        {
            ...NEW_ITEMS[0],
            id: 'inq-tr',
            language: 'tr',
            message: 'Kayıt tarihleri nedir?'
        },
        {
            ...NEW_ITEMS[1],
            id: 'inq-no-lang',
            language: null,
            message: 'When does registration open?'
        }
    ];

    const controller = mountInquiryManager(root, {
        fetcher: async () => createJsonResponse({
            items,
            counts: { new: items.length, answered: 0 }
        })
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const trHref = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-tr"] a.staff-inquiry-whatsapp')?.getAttribute('href') || '';
    assert.equal(
        new URL(trHref).searchParams.get('text'),
        "Merhaba, İstanbul Topkapı Üniversitesi Uluslararası Ofisi'nden yazıyorum. Gördüğümüz üzere portalımız üzerinden bize şu mesajı göndermişsiniz:\n«Kayıt tarihleri nedir?»\n\n\n\nAnlayışınız için teşekkür ederiz."
    );

    const noLangHref = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-no-lang"] a.staff-inquiry-whatsapp')?.getAttribute('href') || '';
    assert.equal(
        new URL(noLangHref).searchParams.get('text'),
        'Hello, I am writing from the International Office of Istanbul Topkapı University. As we can see, you sent us the following message through our portal:\n“When does registration open?”\n\n\n\nThank you for your understanding.'
    );
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

test('mailto link encodes valid local-part and renders unsafe emails as plain text without a link', async (context) => {
    const { root } = createStaffDom(context);
    const unsafeEmails = [
        { id: 'inq-inject', email: 'a@b.co?cc=x@y.z&body=hello' },
        { id: 'inq-q', email: 'a?b@example.edu' },
        { id: 'inq-amp', email: 'a&b@example.edu' },
        { id: 'inq-hash', email: 'a#b@example.edu' },
        { id: 'inq-pct', email: 'a%20b@example.edu' },
        { id: 'inq-comma', email: 'a,b@example.edu' },
        { id: 'inq-at', email: 'a@b@example.edu' }
    ];
    const items = [
        {
            ...NEW_ITEMS[0],
            id: 'inq-valid',
            email: 'ayse+test@example.edu'
        },
        ...unsafeEmails.map((entry) => ({
            ...NEW_ITEMS[0],
            id: entry.id,
            email: entry.email
        }))
    ];

    const controller = mountInquiryManager(root, {
        fetcher: async () => createJsonResponse({
            items,
            counts: { new: items.length, answered: 0 }
        })
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const validCard = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-valid"]');
    const validLink = validCard?.querySelector('a.staff-inquiry-email');
    assert.ok(validLink);
    assert.equal(validLink.getAttribute('href'), 'mailto:ayse%2Btest@example.edu');
    assert.equal(validLink.textContent, 'ayse+test@example.edu');

    for (const entry of unsafeEmails) {
        const card = root.querySelector(`.staff-inquiry-card[data-inquiry-id="${entry.id}"]`);
        assert.ok(card, `Card ${entry.id} must render`);
        assert.equal(card.querySelector('a[href^="mailto:"]'), null, `No mailto link for ${entry.email}`);
        assert.equal(card.querySelector('a.staff-inquiry-email'), null, `No email anchor for ${entry.email}`);
        const plainEmail = card.querySelector('span.staff-inquiry-email');
        assert.ok(plainEmail, `Plain text email span must render for ${entry.email}`);
        assert.equal(plainEmail.textContent, entry.email);
    }
});

test('copy phone button renders only when phone has digits, copies normalized number via Clipboard API, and resets after 2 seconds', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const { dom, root } = createStaffDom(context);
    const copiedValues = [];
    const toasts = [];

    Object.defineProperty(dom.window.navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async (text) => {
                copiedValues.push(text);
            }
        }
    });
    dom.window.showToast = (message, type) => {
        toasts.push({ message, type });
    };

    const items = [
        {
            ...NEW_ITEMS[0],
            id: 'inq-plus',
            phone: '+90 505 123 45 67'
        },
        {
            ...NEW_ITEMS[1],
            id: 'inq-no-plus',
            first_name: '',
            last_name: '',
            phone: '90 532 987 65 43'
        },
        {
            ...NEW_ITEMS[0],
            id: 'inq-no-phone',
            phone: ''
        }
    ];

    const controller = mountInquiryManager(root, {
        fetcher: async () => createJsonResponse({
            items,
            counts: { new: items.length, answered: 0 }
        })
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const plusCard = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-plus"]');
    const noPlusCard = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-no-plus"]');
    const noPhoneCard = root.querySelector('.staff-inquiry-card[data-inquiry-id="inq-no-phone"]');

    assert.equal(noPhoneCard.querySelector('button.staff-inquiry-copy-phone'), null);

    const plusButton = plusCard.querySelector('button.staff-inquiry-copy-phone');
    assert.ok(plusButton);
    assert.equal(plusButton.type, 'button');
    assert.equal(plusButton.textContent, 'Numarayı kopyala');
    assert.equal(plusButton.getAttribute('aria-label'), 'Ayşe Demir numarasını kopyala');

    const noPlusButton = noPlusCard.querySelector('button.staff-inquiry-copy-phone');
    assert.ok(noPlusButton);
    assert.equal(noPlusButton.getAttribute('aria-label'), 'Numarayı kopyala');

    plusButton.click();
    await flushPromises();
    assert.deepEqual(copiedValues, ['+905051234567']);
    assert.equal(plusButton.textContent, 'Kopyalandı');
    assert.equal(plusCard.querySelector('.staff-inquiry-copy-status[aria-live="polite"]')?.textContent, 'Numara kopyalandı.');
    assert.deepEqual(toasts, [{ message: 'Numara kopyalandı.', type: 'success' }]);

    context.mock.timers.tick(2000);
    assert.equal(plusButton.textContent, 'Numarayı kopyala');
    assert.equal(plusCard.querySelector('.staff-inquiry-copy-status')?.textContent, '');

    noPlusButton.click();
    await flushPromises();
    assert.deepEqual(copiedValues, ['+905051234567', '905329876543']);
});

test('copy phone button falls back to document.execCommand when Clipboard rejects and shows failure feedback when both fail', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const { dom, document, root } = createStaffDom(context);
    const toasts = [];
    let execCommandResult = true;
    const execCalls = [];

    Object.defineProperty(dom.window.navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: async () => {
                throw new Error('Permission denied');
            }
        }
    });
    document.execCommand = (command) => {
        execCalls.push(command);
        return execCommandResult;
    };
    dom.window.showToast = (message, type) => {
        toasts.push({ message, type });
    };

    const controller = mountInquiryManager(root, {
        fetcher: async () => createJsonResponse({
            items: [NEW_ITEMS[0]],
            counts: { new: 1, answered: 0 }
        })
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const copyButton = root.querySelector('button.staff-inquiry-copy-phone');
    const copyStatus = root.querySelector('.staff-inquiry-copy-status');

    copyButton.click();
    await flushPromises();
    assert.deepEqual(execCalls, ['copy']);
    assert.equal(copyButton.textContent, 'Kopyalandı');
    assert.equal(copyStatus.textContent, 'Numara kopyalandı.');

    context.mock.timers.tick(2000);
    assert.equal(copyButton.textContent, 'Numarayı kopyala');

    execCommandResult = false;
    copyButton.click();
    await flushPromises();
    assert.equal(copyButton.textContent, 'Kopyalanamadı');
    assert.equal(copyStatus.textContent, 'Numara kopyalanamadı.');
    assert.equal(toasts.at(-1)?.type, 'error');
    assert.equal(toasts.at(-1)?.message, 'Numara kopyalanamadı.');
});

test('staff inquiry note UI renders on new and answered tabs, updates counter, saves, deletes, and cancels XSS-safely', async (context) => {
    const { dom, root } = createStaffDom(context);
    const requests = [];
    let currentNewItem = {
        ...NEW_ITEMS[0],
        staff_note: null,
        staff_note_updated_by_name: null,
        staff_note_updated_at: null
    };
    const answeredWithNote = {
        ...ANSWERED_ITEMS[0],
        staff_note: 'Cevaplandı sekmesindeki not <script>alert(1)</script>',
        staff_note_updated_by_name: 'Deniz Görevli',
        staff_note_updated_at: '2026-11-27T08:30:00.000Z'
    };

    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            const payloadBody = options.body ? JSON.parse(options.body) : null;
            requests.push({ url: String(url), method, body: payloadBody });
            if (method === 'GET' && String(url).includes('status=answered')) {
                return createJsonResponse({ items: [answeredWithNote], counts: { new: 1, answered: 1 } });
            }
            if (method === 'GET') {
                return createJsonResponse({ items: [currentNewItem], counts: { new: 1, answered: 1 } });
            }
            if (method === 'PUT' && String(url).endsWith('/inq-1/note')) {
                const trimmed = payloadBody.note.trim();
                currentNewItem = trimmed
                    ? {
                        ...currentNewItem,
                        staff_note: trimmed,
                        staff_note_updated_by_name: 'Mert Görevli',
                        staff_note_updated_at: '2026-11-27T09:00:00.000Z'
                    }
                    : {
                        ...currentNewItem,
                        staff_note: null,
                        staff_note_updated_by_name: null,
                        staff_note_updated_at: null
                    };
                return createJsonResponse({ item: currentNewItem });
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // "Not ekle" button on new tab
    const addButton = root.querySelector('[data-action="edit-inquiry-note"]');
    assert.equal(addButton.textContent, 'Not ekle');
    addButton.click();

    const textarea = root.querySelector('[data-inquiry-note-input="inq-1"]');
    const counter = root.querySelector('[data-inquiry-note-counter="inq-1"]');
    assert.equal(counter.textContent, '0 / 1000');

    // Over 1000 chars shows over-limit state and does not send PUT
    textarea.value = 'a'.repeat(1001);
    textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('[data-inquiry-note-counter="inq-1"]').textContent, '1001 / 1000');
    assert.equal(root.querySelector('[data-inquiry-note-counter="inq-1"]').classList.contains('is-over-limit'), true);
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();
    assert.equal(requests.some((entry) => entry.method === 'PUT'), false);
    assert.match(root.querySelector('.staff-inquiry-note-error').textContent, /1000/);

    // Save valid note
    const inputEl = root.querySelector('[data-inquiry-note-input="inq-1"]');
    inputEl.value = 'Öğrenci ile görüşüldü';
    inputEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('[data-inquiry-note-counter="inq-1"]').textContent, '21 / 1000');
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();

    const putSave = requests.find((entry) => entry.method === 'PUT');
    assert.deepEqual(putSave.body, { note: 'Öğrenci ile görüşüldü', expected_note_updated_at: null });
    assert.equal(root.querySelector('.staff-inquiry-note-text').textContent, 'Öğrenci ile görüşüldü');
    assert.match(root.querySelector('.staff-inquiry-note-meta').textContent, /Son düzenleyen: Mert Görevli/);
    assert.equal(root.querySelector('[data-action="edit-inquiry-note"]').textContent, 'Notu düzenle');

    // Cancel edit discards draft
    root.querySelector('[data-action="edit-inquiry-note"]').click();
    const cancelInput = root.querySelector('[data-inquiry-note-input="inq-1"]');
    cancelInput.value = 'Kaydedilmeyecek taslak';
    cancelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    root.querySelector('[data-action="cancel-inquiry-note"]').click();
    assert.equal(root.querySelector('.staff-inquiry-note-text').textContent, 'Öğrenci ile görüşüldü');

    // Empty text deletes note
    root.querySelector('[data-action="edit-inquiry-note"]').click();
    const clearInput = root.querySelector('[data-inquiry-note-input="inq-1"]');
    clearInput.value = '   ';
    clearInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();
    assert.equal(root.querySelector('.staff-inquiry-note-box'), null);
    assert.equal(root.querySelector('[data-action="edit-inquiry-note"]').textContent, 'Not ekle');

    // Switch to Answered tab -> note is visible and XSS-safe
    root.querySelector('[data-inquiry-tab="answered"]').click();
    await flushPromises();
    assert.equal(root.querySelector('script'), null);
    assert.equal(
        root.querySelector('.staff-inquiry-note-text').textContent,
        'Cevaplandı sekmesindeki not <script>alert(1)</script>'
    );
    assert.match(root.querySelector('.staff-inquiry-note-meta').textContent, /Son düzenleyen: Deniz Görevli/);
});

test('unsaved note draft survives list refresh and 409 conflict keeps draft while showing latest note', async (context) => {
    const { dom, root } = createStaffDom(context);
    let serverItem = {
        ...NEW_ITEMS[0],
        staff_note: 'İlk sunucu notu',
        staff_note_updated_by_name: 'Deniz Görevli',
        staff_note_updated_at: '2026-11-27T08:00:00.000Z'
    };

    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            if (method === 'GET') {
                return createJsonResponse({ items: [serverItem], counts: { new: 1, answered: 0 } });
            }
            if (method === 'PUT' && String(url).endsWith('/inq-1/note')) {
                // Simulate another staff member having updated the note before our save
                serverItem = {
                    ...serverItem,
                    staff_note: 'Başka yetkilinin güncel notu',
                    staff_note_updated_by_name: 'Mert Görevli',
                    staff_note_updated_at: '2026-11-27T08:05:00.000Z'
                };
                return createJsonResponse({
                    error: {
                        code: 'INQUIRY_NOTE_CONFLICT',
                        message: 'Not başka bir yetkili tarafından güncellendi. Güncel not yükleniyor.'
                    }
                }, 409);
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Open editor and type an unsaved draft
    root.querySelector('[data-action="edit-inquiry-note"]').click();
    const input = root.querySelector('[data-inquiry-note-input="inq-1"]');
    input.value = 'Benim kaydedilmemiş taslağım';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    // Refresh list -> unsaved draft must survive
    await controller.refresh();
    await flushPromises();
    const inputAfterRefresh = root.querySelector('[data-inquiry-note-input="inq-1"]');
    assert.ok(inputAfterRefresh);
    assert.equal(inputAfterRefresh.value, 'Benim kaydedilmemiş taslağım');

    // Save triggers 409 -> draft stays in textarea AND latest server note is displayed
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();

    assert.equal(root.querySelector('[data-inquiry-note-input="inq-1"]').value, 'Benim kaydedilmemiş taslağım');
    assert.equal(root.querySelector('.staff-inquiry-note-text').textContent, 'Başka yetkilinin güncel notu');
    assert.match(root.querySelector('.staff-inquiry-note-meta').textContent, /Son düzenleyen: Mert Görevli/);
    assert.match(root.querySelector('.staff-inquiry-note-error').textContent, /güncellendi/);
});

test('409 conflict with failed reload reports reload failure, retries reload on next save, and handles inquiry leaving tab', async (context) => {
    const { dom, root } = createStaffDom(context);
    let serverItem = {
        ...NEW_ITEMS[0],
        staff_note: 'İlk not',
        staff_note_updated_by_name: 'Deniz Görevli',
        staff_note_updated_at: '2026-11-27T08:00:00.000Z'
    };
    let getMode = 'ok';
    const putBodies = [];

    const controller = mountInquiryManager(root, {
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            if (method === 'GET') {
                if (getMode === 'fail') {
                    return createJsonResponse({ error: { message: 'Sunucu hatası' } }, 500);
                }
                if (getMode === 'moved') {
                    return createJsonResponse({ items: [], counts: { new: 0, answered: 1 } });
                }
                return createJsonResponse({ items: [serverItem], counts: { new: 1, answered: 0 } });
            }
            if (method === 'PUT' && String(url).endsWith('/inq-1/note')) {
                const body = JSON.parse(options.body);
                putBodies.push(body);
                if (body.expected_note_updated_at !== serverItem.staff_note_updated_at) {
                    return createJsonResponse({ error: { code: 'INQUIRY_NOTE_CONFLICT', message: 'Çakışma' } }, 409);
                }
                serverItem = { ...serverItem, staff_note: body.note, staff_note_updated_at: '2026-11-27T08:10:00.000Z' };
                return createJsonResponse({ item: serverItem });
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Open editor and type draft
    root.querySelector('[data-action="edit-inquiry-note"]').click();
    const input = root.querySelector('[data-inquiry-note-input="inq-1"]');
    input.value = 'Taslak metni';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    // Server updates note, and subsequent reload fails
    serverItem = { ...serverItem, staff_note: 'Güncel sunucu notu', staff_note_updated_at: '2026-11-27T08:05:00.000Z' };
    getMode = 'fail';
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();

    assert.equal(putBodies.length, 1);
    const errorEl = root.querySelector('.staff-inquiry-note-error');
    assert.match(errorEl.textContent, /yüklenemedi/);
    assert.doesNotMatch(errorEl.textContent, /yukarıda gösteriliyor/);
    assert.equal(root.querySelector('[data-inquiry-note-input="inq-1"]').value, 'Taslak metni');

    // Next save retries reload instead of sending stale PUT
    getMode = 'ok';
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();
    assert.equal(putBodies.length, 1);
    assert.equal(root.querySelector('.staff-inquiry-note-text').textContent, 'Güncel sunucu notu');
    assert.equal(root.querySelector('[data-inquiry-note-input="inq-1"]').value, 'Taslak metni');

    // Now suppose another 409 happens and the inquiry left the current tab
    serverItem = { ...serverItem, staff_note_updated_at: '2026-11-27T08:06:00.000Z' };
    getMode = 'moved';
    root.querySelector('[data-action="save-inquiry-note"]').click();
    await flushPromises();

    assert.equal(root.querySelector('[data-inquiry-note-input="inq-1"]'), null);
    const orphanBox = root.querySelector('.staff-inquiry-orphaned-draft');
    assert.ok(orphanBox);
    assert.equal(orphanBox.querySelector('.staff-inquiry-orphaned-draft-text').value, 'Taslak metni');
    assert.ok(orphanBox.querySelector('[data-action="copy-orphaned-note-draft"]'));
});
