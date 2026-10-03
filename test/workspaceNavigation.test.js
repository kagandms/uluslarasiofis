import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initWorkspaceNavigation } from '../src/ui/workspaceNavigation.js';

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
