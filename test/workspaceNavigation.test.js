import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { initWorkspaceNavigation, isWorkspaceNavigationActive } from '../src/ui/workspaceNavigation.js';

function installWorkspace(context) {
    const html = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://portal.test/yetkili/' });
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    dom.window.document.getElementById('app-content').hidden = false;
    dom.window.document.getElementById('login-overlay').hidden = true;
    context.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        dom.window.close();
    });
    initWorkspaceNavigation();
    return dom;
}

test('number shortcuts switch workspaces and Escape returns home without clearing form content', (context) => {
    const dom = installWorkspace(context);
    const document = dom.window.document;
    const draft = document.getElementById('ykn-passport-input');
    draft.value = 'Unsaved passport';
    const visited = [];
    document.addEventListener('workspace:view-changed', event => visited.push(event.detail.viewName));

    for (const key of ['3', '7', '9']) document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.deepEqual(visited, ['ykn', 'print', 'yoksis-audit']);
    assert.equal(document.getElementById('home-screen').hidden, false);
    assert.equal(document.getElementById('workspace-content').hidden, true);
    assert.equal(draft.value, 'Unsaved passport');
    assert.equal(document.querySelectorAll('#home-screen [aria-keyshortcuts]').length, 9);
});

test('YKN and Teblig workspaces focus their headings instead of search inputs', (context) => {
    const dom = installWorkspace(context);
    const document = dom.window.document;
    const press = (target, key) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));

    document.querySelector('[data-workspace-view="ykn"]').click();
    assert.equal(document.activeElement.id, 'ykn-title');
    press(document.activeElement, '1');
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'İkamet Başvuruları');

    document.querySelector('[data-workspace-view="teblig"]').click();
    assert.equal(document.activeElement.id, 'workspace-title');
    press(document.activeElement, '2');
    assert.equal(document.getElementById('workspace-title').textContent.trim(), 'Arşiv');

    document.querySelector('[data-workspace-view="teblig"]').click();
    assert.equal(document.activeElement.id, 'workspace-title');
    const visited = [];
    document.addEventListener('workspace:view-changed', event => visited.push(event.detail.viewName));
    const searchInput = document.getElementById('tebligat-search-input');
    searchInput.focus();
    press(searchInput, '2');

    assert.deepEqual(visited, []);
    assert.equal(document.activeElement.id, 'tebligat-search-input');
});

test('İkamet Başvuruları navigation stays active for online and physical intake views', (context) => {
    const dom = installWorkspace(context);
    const document = dom.window.document;
    const intakeNavigation = document.querySelector('.workspace-nav [data-intake-entry]');
    intakeNavigation.dataset.workspaceView = 'intake';

    assert.equal(isWorkspaceNavigationActive(intakeNavigation, 'intake'), true);
    assert.equal(isWorkspaceNavigationActive(intakeNavigation, 'applications'), true);
    assert.equal(isWorkspaceNavigationActive(intakeNavigation, 'physical'), true);
    assert.equal(isWorkspaceNavigationActive(intakeNavigation, 'archive'), false);
});

test('YKN family and birth date fields are open when the result form renders', (context) => {
    const dom = installWorkspace(context);

    assert.equal(dom.window.document.querySelector('.ykn-family-details')?.open, true);
});

test('workspace shortcuts respect editing, dialogs, modifier keys and the login screen', (context) => {
    const dom = installWorkspace(context);
    const document = dom.window.document;
    const visited = [];
    document.addEventListener('workspace:view-changed', event => visited.push(event.detail.viewName));
    const press = (target, key, options = {}) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, ...options }));

    press(document.getElementById('ykn-passport-input'), '1');
    press(document, '2', { metaKey: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    press(document, '3');
    press(document, 'Escape');
    dialog.remove();
    document.getElementById('app-content').hidden = true;
    press(document, '4');

    assert.deepEqual(visited, []);
    assert.equal(document.getElementById('home-screen').hidden, false);
});

test('staff logo returns to the protected workspace home without resetting tool state', () => {
    const dom = new JSDOM(`<!doctype html><html><body>
        <a id="staff-home-link" href="/yetkili/#home-screen"></a>
        <section id="home-screen"><h2 id="home-screen-title" tabindex="-1">Home</h2></section>
        <main id="workspace-content"><h2 id="workspace-title"></h2><section id="view-cover"><h2 id="cover-title"></h2><input id="ocr-draft" value="OCR draft"></section></main>
        <button id="btn-workspace-home" type="button"></button>
        <button id="btn-go-home-global" type="button"></button>
        <button type="button" data-workspace-view="cover" aria-controls="view-cover">Cover</button>
    </body></html>`);
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });

    try {
        initWorkspaceNavigation();
        dom.window.document.querySelector('[data-workspace-view="cover"]').click();
        const draft = dom.window.document.getElementById('ocr-draft');
        draft.value = 'Unsaved OCR and form state';
        const logo = dom.window.document.getElementById('staff-home-link');
        const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
        logo.dispatchEvent(click);

        assert.equal(click.defaultPrevented, true);
        assert.equal(logo.getAttribute('href'), '/yetkili/#home-screen');
        assert.equal(dom.window.document.getElementById('home-screen').hidden, false);
        assert.equal(dom.window.document.getElementById('workspace-content').hidden, true);
        assert.equal(draft.value, 'Unsaved OCR and form state');
        assert.equal(dom.window.document.activeElement.id, 'home-screen-title');
    } finally {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        dom.window.close();
    }
});
