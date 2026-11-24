/**
 * Yetkili "Gelen Sorular" altındaki "Topi ile sohbet geçmişleri" arayüzü testleri:
 * HTML yerleşimi, liste, süzgeç çipleri, sayaçlar, oturum detayı ve onaylı silme akışları.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { mountChatLogManager } from '../src/staff/chatLogManager.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const SAMPLE_STATS = {
    today: { answers: 12, up: 8, down: 2 },
    last7: { answers: 64, up: 45, down: 7 }
};

const SAMPLE_SESSIONS = [
    {
        id: 'sess-1',
        language: 'tr',
        created_at: '2026-11-23T09:00:00.000Z',
        last_at: '2026-11-23T09:05:00.000Z',
        turn_count: 2,
        has_down_vote: true,
        first_user_text: '<b>İkamet</b> belgeleri nelerdir?'
    },
    {
        id: 'sess-2',
        language: 'en',
        created_at: '2026-11-23T08:00:00.000Z',
        last_at: '2026-11-23T08:01:00.000Z',
        turn_count: 1,
        has_down_vote: false,
        first_user_text: '<script>alert(1)</script>How to apply?'
    }
];

const SAMPLE_DETAIL = {
    session: {
        id: 'sess-1',
        language: 'tr',
        created_at: '2026-11-23T09:00:00.000Z',
        last_at: '2026-11-23T09:05:00.000Z',
        turn_count: 2
    },
    turns: [
        {
            id: 'turn-1',
            seq: 1,
            user_text: '<b>İkamet</b> belgeleri nelerdir?',
            assistant_text: 'Gerekli belgeler pasaport ve öğrenci belgesidir.',
            outcome: 'ok',
            tools: ['get_required_documents'],
            feedback: 'up',
            created_at: '2026-11-23T09:00:00.000Z'
        },
        {
            id: 'turn-2',
            seq: 2,
            user_text: 'Yetkiliyle görüşmek istiyorum',
            assistant_text: 'Ofis soru formundan yazabilirsiniz.',
            outcome: 'handoff',
            tools: [],
            feedback: 'down',
            created_at: '2026-11-23T09:05:00.000Z'
        }
    ]
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

function createEmptyResponse(status = 204) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            throw new SyntaxError('No content');
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
        root: document.getElementById('staff-chat-logs-manager')
    };
}

test('staff HTML embeds chat logs inside #view-inquiries after inquiries manager with 10 production home cards', () => {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const doc = dom.window.document;
    try {
        const cssLink = doc.querySelector('link[rel="stylesheet"][href="/src/staff/chatLog.css"]');
        assert.ok(cssLink);

        assert.equal(doc.querySelector('[data-workspace-view="chat-logs"]'), null);
        assert.equal(doc.getElementById('view-chat-logs'), null);

        const homeCards = [...doc.querySelectorAll('#home-screen .home-actions .home-action')];
        assert.equal(homeCards.length, 10);
        assert.deepEqual(
            homeCards.map((el) => el.dataset.workspaceView),
            [
                'applications',
                'archive',
                'ykn',
                'cover',
                'teblig',
                'documents',
                'print',
                'work-hours',
                'yoksis-audit',
                'inquiries'
            ]
        );

        const inquiriesPanel = doc.getElementById('view-inquiries');
        assert.ok(inquiriesPanel);
        assert.equal(inquiriesPanel.hidden, true);

        const inquiriesManager = inquiriesPanel.querySelector('#staff-inquiries-manager');
        const historySection = inquiriesPanel.querySelector('#staff-chat-history-section.staff-chat-history-section');
        const chatLogsManager = historySection?.querySelector('#staff-chat-logs-manager');
        assert.ok(inquiriesManager);
        assert.ok(historySection);
        assert.equal(historySection.getAttribute('aria-label'), 'Topi ile sohbet geçmişleri');
        assert.equal(historySection.querySelector('h1, h2, h3, h4'), null);
        assert.ok(chatLogsManager);

        const position = inquiriesManager.compareDocumentPosition(chatLogsManager);
        assert.ok((position & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    } finally {
        dom.window.close();
    }
});

test('mount renders title, today/7-day stats, session list with XSS-safe textContent while #view-inquiries is hidden, and filter chips query the right endpoint', async (context) => {
    const { document, root } = createStaffDom(context);
    assert.equal(document.getElementById('view-inquiries').hidden, true);
    const requests = [];

    const controller = mountChatLogManager(root, {
        fetcher: async (url, options = {}) => {
            requests.push({ url: String(url), method: options.method || 'GET', options });
            const parsed = new URL(String(url), 'https://portal.test');
            if (parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (parsed.pathname === '/api/staff/chat-sessions') {
                const filter = parsed.searchParams.get('filter') || 'all';
                if (filter === 'down') {
                    return createJsonResponse({ items: [SAMPLE_SESSIONS[0]], nextCursor: null });
                }
                return createJsonResponse({ items: SAMPLE_SESSIONS, nextCursor: 'cursor-page-2' });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Embedded section heading rendered
    assert.equal(root.querySelector('.staff-inquiries-heading h3')?.textContent, 'Topi ile sohbet geçmişleri');

    // Stats rendered
    assert.equal(root.querySelector('[data-stat-period="today"][data-stat-metric="answers"]')?.textContent, '12');
    assert.equal(root.querySelector('[data-stat-period="today"][data-stat-metric="up"]')?.textContent, '8');
    assert.equal(root.querySelector('[data-stat-period="today"][data-stat-metric="down"]')?.textContent, '2');
    assert.equal(root.querySelector('[data-stat-period="last7"][data-stat-metric="answers"]')?.textContent, '64');
    assert.equal(root.querySelector('[data-stat-period="last7"][data-stat-metric="up"]')?.textContent, '45');
    assert.equal(root.querySelector('[data-stat-period="last7"][data-stat-metric="down"]')?.textContent, '7');

    // List rendered with textContent only (no injected HTML elements)
    const items = root.querySelectorAll('.staff-chatlog-item');
    assert.equal(items.length, 2);
    assert.equal(root.querySelector('script, b'), null);
    assert.match(items[0].textContent, /<b>İkamet<\/b> belgeleri nelerdir\?/);
    assert.match(items[1].textContent, /<script>alert\(1\)<\/script>How to apply\?/);

    // Filter chips present
    for (const filterKey of ['all', 'down', 'handoff', 'refused', 'fallback']) {
        assert.ok(root.querySelector(`[data-chatlog-filter="${filterKey}"]`), `Missing filter chip ${filterKey}`);
    }

    // Clicking "down" filter queries ?filter=down
    root.querySelector('[data-chatlog-filter="down"]').click();
    await flushPromises();
    const downReq = requests.find((entry) => entry.url.includes('filter=down'));
    assert.ok(downReq);
    assert.equal(root.querySelectorAll('.staff-chatlog-item').length, 1);

    // Clicking "handoff" filter queries ?filter=handoff
    root.querySelector('[data-chatlog-filter="handoff"]').click();
    await flushPromises();
    assert.ok(requests.some((entry) => entry.url.includes('filter=handoff')));
});

test('opening a session renders user and Topi bubbles with outcome and vote badges, and deletes only after confirm', async (context) => {
    const { root } = createStaffDom(context);
    const requests = [];
    const confirmCalls = [];
    let confirmResult = false;

    const controller = mountChatLogManager(root, {
        confirm: (msg) => {
            confirmCalls.push(msg);
            return confirmResult;
        },
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            requests.push({ url: String(url), method, options });
            const parsed = new URL(String(url), 'https://portal.test');
            if (method === 'GET' && parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (method === 'GET' && parsed.pathname === '/api/staff/chat-sessions') {
                return createJsonResponse({ items: SAMPLE_SESSIONS, nextCursor: null });
            }
            if (method === 'GET' && parsed.pathname === '/api/staff/chat-sessions/sess-1') {
                return createJsonResponse(SAMPLE_DETAIL);
            }
            if (method === 'DELETE' && parsed.pathname === '/api/staff/chat-sessions/sess-1') {
                return createEmptyResponse(204);
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Open session sess-1
    root.querySelector('[data-action="open-session"][data-session-id="sess-1"]').click();
    await flushPromises();

    const userBubbles = root.querySelectorAll('.staff-chatlog-bubble-user');
    const topiBubbles = root.querySelectorAll('.staff-chatlog-bubble-assistant');
    assert.equal(userBubbles.length, 2);
    assert.equal(topiBubbles.length, 2);
    assert.equal(root.querySelector('b, script'), null);
    assert.match(userBubbles[0].textContent, /<b>İkamet<\/b> belgeleri nelerdir\?/);
    assert.match(topiBubbles[0].textContent, /Gerekli belgeler pasaport ve öğrenci belgesidir\./);
    assert.match(topiBubbles[0].textContent, /Evet/);
    assert.match(topiBubbles[1].textContent, /Hayır/);
    assert.match(topiBubbles[1].textContent, /Ofise yönlendirildi/);

    // Click "Bu sohbeti sil" when confirm returns false -> no DELETE sent
    confirmResult = false;
    root.querySelector('[data-action="delete-session"]').click();
    await flushPromises();
    assert.equal(confirmCalls.length, 1);
    assert.equal(requests.some((entry) => entry.method === 'DELETE'), false);

    // Click "Bu sohbeti sil" when confirm returns true -> DELETE /api/staff/chat-sessions/sess-1
    confirmResult = true;
    root.querySelector('[data-action="delete-session"]').click();
    await flushPromises();
    assert.equal(confirmCalls.length, 2);
    const deleteReq = requests.find((entry) => entry.method === 'DELETE');
    assert.ok(deleteReq);
    assert.equal(new URL(deleteReq.url, 'https://portal.test').pathname, '/api/staff/chat-sessions/sess-1');
    assert.equal(deleteReq.options.credentials, 'same-origin');
    assert.equal(root.querySelector('.staff-chatlog-detail'), null);
});

test('bulk delete older_than_days validates input and calls DELETE only after confirm', async (context) => {
    const { root } = createStaffDom(context);
    const requests = [];
    const confirmCalls = [];
    let confirmResult = false;

    const controller = mountChatLogManager(root, {
        confirm: (msg) => {
            confirmCalls.push(msg);
            return confirmResult;
        },
        fetcher: async (url, options = {}) => {
            const method = options.method || 'GET';
            requests.push({ url: String(url), method, options });
            const parsed = new URL(String(url), 'https://portal.test');
            if (method === 'GET' && parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (method === 'GET' && parsed.pathname === '/api/staff/chat-sessions') {
                return createJsonResponse({ items: SAMPLE_SESSIONS, nextCursor: null });
            }
            if (method === 'DELETE' && parsed.pathname === '/api/staff/chat-sessions') {
                return createJsonResponse({ deleted: 5 });
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    const daysInput = root.querySelector('[data-older-days-input]');
    assert.ok(daysInput);

    // Invalid value (0) must not call confirm or DELETE
    daysInput.value = '0';
    daysInput.dispatchEvent(new root.ownerDocument.defaultView.Event('input', { bubbles: true }));
    root.querySelector('[data-action="delete-older-sessions"]').click();
    await flushPromises();
    assert.equal(confirmCalls.length, 0);
    assert.equal(requests.some((entry) => entry.method === 'DELETE'), false);
    assert.ok(root.querySelector('.staff-inquiries-error'));

    // Valid value (45), confirm returns false -> no DELETE
    daysInput.value = '45';
    daysInput.dispatchEvent(new root.ownerDocument.defaultView.Event('input', { bubbles: true }));
    confirmResult = false;
    root.querySelector('[data-action="delete-older-sessions"]').click();
    await flushPromises();
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], /45/);
    assert.match(confirmCalls[0], /kalıcı/i);
    assert.equal(requests.some((entry) => entry.method === 'DELETE'), false);

    // Confirm returns true -> sends DELETE /api/staff/chat-sessions?older_than_days=45
    confirmResult = true;
    root.querySelector('[data-action="delete-older-sessions"]').click();
    await flushPromises();
    const bulkDelete = requests.find((entry) => entry.method === 'DELETE');
    assert.ok(bulkDelete);
    const parsedBulk = new URL(bulkDelete.url, 'https://portal.test');
    assert.equal(parsedBulk.pathname, '/api/staff/chat-sessions');
    assert.equal(parsedBulk.searchParams.get('older_than_days'), '45');
    assert.equal(bulkDelete.options.credentials, 'same-origin');
    assert.match(root.querySelector('.staff-inquiries-status')?.textContent || '', /5/);
});

test('every session row displays the Topi source chip and result count renders total only when present', async (context) => {
    const { root } = createStaffDom(context);
    let responsePayload = { items: SAMPLE_SESSIONS, nextCursor: null, total: 14 };

    const controller = mountChatLogManager(root, {
        fetcher: async (url) => {
            const parsed = new URL(String(url), 'https://portal.test');
            if (parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (parsed.pathname === '/api/staff/chat-sessions') {
                return createJsonResponse(responsePayload);
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Every session row has the "Topi" source chip
    const items = [...root.querySelectorAll('.staff-chatlog-item')];
    assert.equal(items.length, 2);
    for (const item of items) {
        const sourceChip = item.querySelector('[data-chatlog-source="topi"]');
        assert.ok(sourceChip, 'Missing Topi source chip on session row');
        assert.equal(sourceChip.textContent, 'Topi');
    }

    // Result line shows "14 sohbet"
    const countLine = root.querySelector('[data-chatlog-result-count="true"]');
    assert.ok(countLine);
    assert.equal(countLine.textContent, '14 sohbet');

    // When total is missing from response, show nothing
    responsePayload = { items: [SAMPLE_SESSIONS[0]], nextCursor: null };
    root.querySelector('[data-chatlog-filter="down"]').click();
    await flushPromises();
    assert.equal(root.querySelector('[data-chatlog-result-count="true"]'), null);
});

test('chat filters build exact query strings with only active params, preserve filters on pagination, and reset cursor/list on change', async (context) => {
    const { dom, root } = createStaffDom(context);
    const sessionRequests = [];

    const controller = mountChatLogManager(root, {
        fetcher: async (url) => {
            const parsed = new URL(String(url), 'https://portal.test');
            if (parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (parsed.pathname === '/api/staff/chat-sessions') {
                sessionRequests.push(String(url));
                const cursor = parsed.searchParams.get('cursor');
                if (cursor === 'cursor-2') {
                    return createJsonResponse({
                        items: [{ ...SAMPLE_SESSIONS[1], id: 'sess-page-2' }],
                        nextCursor: null,
                        total: 2
                    });
                }
                return createJsonResponse({
                    items: [SAMPLE_SESSIONS[0]],
                    nextCursor: 'cursor-2',
                    total: 2
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();

    // Initial load sends no query params
    assert.equal(sessionRequests[0], '/api/staff/chat-sessions');

    // Clear button hidden when nothing is active
    assert.equal(root.querySelector('[data-action="clear-chatlog-filters"]').hidden, true);

    // Language chips exist
    for (const lang of ['all', 'tr', 'en', 'ru', 'tk', 'ar']) {
        assert.ok(root.querySelector(`[data-chatlog-lang="${lang}"]`), `Missing lang chip ${lang}`);
    }

    // Select lang=tr
    root.querySelector('[data-chatlog-lang="tr"]').click();
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?lang=tr');
    assert.equal(root.querySelector('[data-action="clear-chatlog-filters"]').hidden, false);

    // Select period=7d
    const periodSelect = root.querySelector('[data-chatlog-period="true"]');
    periodSelect.value = '7d';
    periodSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?lang=tr&period=7d');

    // Select filter=down
    root.querySelector('[data-chatlog-filter="down"]').click();
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?filter=down&lang=tr&period=7d');

    // Pagination keeps active filters and appends items
    root.querySelector('[data-action="load-more-sessions"]').click();
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?filter=down&lang=tr&period=7d&cursor=cursor-2');
    assert.equal(root.querySelectorAll('.staff-chatlog-item').length, 2);

    // Changing language resets cursor and list
    root.querySelector('[data-chatlog-lang="en"]').click();
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?filter=down&lang=en&period=7d');
    assert.equal(root.querySelectorAll('.staff-chatlog-item').length, 1);

    // Clear button resets all filters and fetches clean endpoint
    root.querySelector('[data-action="clear-chatlog-filters"]').click();
    await flushPromises();
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions');
    assert.equal(root.querySelector('[data-action="clear-chatlog-filters"]').hidden, true);
    assert.equal(root.querySelector('[data-chatlog-period="true"]').value, 'all');
});

test('search input debounces 300ms, enforces >=2 chars and max 80 chars, and clears on Escape', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const { dom, root } = createStaffDom(context);
    const sessionRequests = [];

    const controller = mountChatLogManager(root, {
        fetcher: async (url) => {
            const parsed = new URL(String(url), 'https://portal.test');
            if (parsed.pathname === '/api/staff/chat-stats') {
                return createJsonResponse(SAMPLE_STATS);
            }
            if (parsed.pathname === '/api/staff/chat-sessions') {
                sessionRequests.push(String(url));
                return createJsonResponse({ items: SAMPLE_SESSIONS, nextCursor: null, total: 2 });
            }
            throw new Error(`Unexpected request: ${url}`);
        }
    });
    context.after(() => controller?.destroy());
    await flushPromises();
    assert.equal(sessionRequests.length, 1);

    // Single character must not trigger a request even after 300ms
    const searchInput = root.querySelector('[data-chatlog-search="true"]');
    assert.equal(searchInput.maxLength, 80);
    searchInput.value = 'a';
    searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    context.mock.timers.tick(500);
    await flushPromises();
    assert.equal(sessionRequests.length, 1);

    // Typing "ik" then "ika" within 300ms sends only one debounced request for "ika"
    searchInput.value = 'ik';
    searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    context.mock.timers.tick(150);
    searchInput.value = 'ika';
    searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    context.mock.timers.tick(299);
    await flushPromises();
    assert.equal(sessionRequests.length, 1);

    context.mock.timers.tick(1);
    await flushPromises();
    assert.equal(sessionRequests.length, 2);
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions?q=ika');

    // Esc in search box clears input and reloads without q
    const activeSearchInput = root.querySelector('[data-chatlog-search="true"]');
    activeSearchInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    assert.equal(sessionRequests.length, 3);
    assert.equal(sessionRequests.at(-1), '/api/staff/chat-sessions');
    assert.equal(root.querySelector('[data-chatlog-search="true"]').value, '');
    assert.equal(root.querySelector('[data-action="clear-chatlog-filters"]').hidden, true);
});
