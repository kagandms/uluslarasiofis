import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createNotificationManager } from '../src/staff/notificationManager.js';

function setup(api) {
    const dom = new JSDOM('<main></main>');
    const root = dom.window.document.querySelector('main');
    const manager = createNotificationManager(api);
    const application = { id: 'application-1', status: 'submitted' };
    const render = () => root.replaceChildren(manager.createPanel(dom.window.document, application, render));
    render();
    return { dom, root, render };
}

async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
}

test('staff notification panel previews allowlisted content and explains blocked channels', async () => {
    const api = {
        async history() { return { notifications: [] }; },
        async preview() { return { can_send: false, recipient_masked: '••••33',
            message: 'Preview text\nhttps://portal.test/basvurum/', blocked_reasons: ['WHATSAPP_PROVIDER_NOT_CONFIGURED'] }; },
        async enqueue() { assert.fail('blocked preview must not enqueue'); }, async retry() {}
    };
    const { root } = setup(api);
    await flush();
    root.querySelector('button').click();
    await flush();
    assert.match(root.textContent, /WhatsApp sağlayıcısı yapılandırılmadı/);
    assert.match(root.textContent, /••••33/);
    assert.match(root.textContent, /Preview text/);
    assert.equal([...root.querySelectorAll('button')].some((button) => button.textContent === 'Gönder' && !button.disabled), false);
});

test('staff panel retains the same idempotency key after an ambiguous enqueue failure', async () => {
    const keys = [];
    const api = {
        async history() { return { notifications: [] }; },
        async preview() { return { can_send: true, recipient_masked: '••••33', message: 'Güvenli içerik', blocked_reasons: [] }; },
        async enqueue(applicationId, selection, key) { keys.push(key); throw Object.assign(new Error('network'), { status: 0 }); },
        async retry() {}
    };
    const { root } = setup(api);
    await flush();
    root.querySelector('button').click();
    await flush();
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Gönder').click();
    await flush();
    assert.match(root.textContent, /aynı istek anahtarı/);
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Gönder').click();
    await flush();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
});

test('staff panel calls enqueue only after explicit click and reports queued separately from delivered', async () => {
    let enqueued = 0;
    const api = {
        async history() { return { notifications: [] }; },
        async preview() { return { can_send: true, recipient_masked: '••••33', message: 'Güvenli içerik', blocked_reasons: [] }; },
        async enqueue() { enqueued += 1; return { queued: true }; },
        async retry() {}
    };
    const { root } = setup(api);
    await flush();
    assert.equal(enqueued, 0);
    root.querySelector('button').click();
    await flush();
    [...root.querySelectorAll('button')].find((button) => button.textContent === 'Gönder').click();
    await flush();
    assert.equal(enqueued, 1);
    assert.match(root.textContent, /Kuyruğa alındı/);
    assert.match(root.textContent, /doğrulanmış değildir/);
    assert.doesNotMatch(root.textContent, /Teslim edildi$/);
});

test('history refresh failure after enqueue does not invite a duplicate send', async () => {
    let historyCalls = 0;
    let enqueueCalls = 0;
    const api = {
        async history() {
            historyCalls += 1;
            if (historyCalls > 1) throw new Error('history unavailable');
            return { notifications: [] };
        },
        async preview() { return { can_send: true, recipient_masked: '••••33', message: 'Güvenli içerik', blocked_reasons: [] }; },
        async enqueue() { enqueueCalls += 1; return { queued: true }; },
        async retry() {}
    };
    const { root } = setup(api);
    await flush();
    root.querySelector('button').click();
    await flush();
    root.querySelector('[data-action="notification-send"]').click();
    await flush();

    assert.equal(enqueueCalls, 1);
    assert.match(root.textContent, /Kuyruğa alındı/);
    assert.match(root.textContent, /geçmiş yenilenemedi/);
    assert.equal(root.querySelector('[data-action="notification-send"]'), null);
    assert.ok(root.querySelector('[data-action="notification-history-retry"]'));
});

test('selection changes invalidate a pending preview response', async () => {
    let resolvePreview;
    const api = {
        async history() { return { notifications: [] }; },
        preview() { return new Promise((resolve) => { resolvePreview = resolve; }); },
        async enqueue() { assert.fail('stale preview must not send'); }, async retry() {}
    };
    const { root } = setup(api);
    await flush();
    root.querySelector('button').click();
    const language = root.querySelector('select[name="language"]');
    language.value = 'en';
    language.dispatchEvent(new root.ownerDocument.defaultView.Event('change', { bubbles: true }));
    resolvePreview({ can_send: true, recipient_masked: '••••33', message: 'Türkçe önizleme', blocked_reasons: [] });
    await flush();

    assert.doesNotMatch(root.textContent, /Türkçe önizleme/);
    assert.equal(root.querySelector('[data-action="notification-send"]'), null);
});
