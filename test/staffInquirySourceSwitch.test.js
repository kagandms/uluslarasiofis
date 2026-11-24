/**
 * Yetkili "Gelen Sorular" kaynak sekme anahtarı (Formdan gelen sorular / Topi sohbetleri) testleri:
 * tek panel görünürlüğü, klavye gezintisi, rozet aynalama ve sessionStorage hata dayanıklılığı.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initInquirySourceSwitch } from '../src/staff/inquirySourceSwitch.js';

const STAFF_HTML = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

async function flushMutations() {
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function createSwitchDom(context) {
    const dom = new JSDOM(STAFF_HTML, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    document.getElementById('app-content').hidden = false;
    document.getElementById('login-overlay').hidden = true;
    document.getElementById('view-inquiries').hidden = false;
    context.after(() => {
        dom.window.close();
    });
    return {
        dom,
        document,
        tablist: document.getElementById('staff-inquiry-source-switch'),
        formTab: document.getElementById('staff-source-tab-form'),
        topiTab: document.getElementById('staff-source-tab-topi'),
        formPanel: document.getElementById('staff-inquiries-manager'),
        topiPanel: document.getElementById('staff-chat-history-section'),
        formBadge: document.getElementById('staff-source-form-badge'),
        homeBadge: document.getElementById('staff-inquiries-home-badge')
    };
}

test('source switch defaults to form tab, shows exactly one panel at a time, and keeps both panels mounted', (context) => {
    const { document, tablist, formTab, topiTab, formPanel, topiPanel } = createSwitchDom(context);
    const controller = initInquirySourceSwitch({ document });
    context.after(() => controller?.destroy());

    assert.ok(controller);
    assert.equal(tablist.getAttribute('role'), 'tablist');
    assert.equal(formTab.getAttribute('role'), 'tab');
    assert.equal(topiTab.getAttribute('role'), 'tab');
    assert.equal(formTab.getAttribute('aria-controls'), 'staff-inquiries-manager');
    assert.equal(topiTab.getAttribute('aria-controls'), 'staff-chat-history-section');

    // Default tab 1 (form)
    assert.equal(controller.getActiveSource(), 'form');
    assert.equal(formTab.getAttribute('aria-selected'), 'true');
    assert.equal(topiTab.getAttribute('aria-selected'), 'false');
    assert.equal(formTab.tabIndex, 0);
    assert.equal(topiTab.tabIndex, -1);
    assert.equal(formPanel.hidden, false);
    assert.equal(topiPanel.hidden, true);

    // Mount state marker inside form panel to confirm it stays mounted
    const marker = document.createElement('span');
    marker.id = 'form-state-marker';
    formPanel.append(marker);

    // Click tab 2 (topi)
    topiTab.click();
    assert.equal(controller.getActiveSource(), 'topi');
    assert.equal(formTab.getAttribute('aria-selected'), 'false');
    assert.equal(topiTab.getAttribute('aria-selected'), 'true');
    assert.equal(formTab.tabIndex, -1);
    assert.equal(topiTab.tabIndex, 0);
    assert.equal(formPanel.hidden, true);
    assert.equal(topiPanel.hidden, false);
    assert.equal(document.getElementById('form-state-marker'), marker);

    // Click tab 1 again
    formTab.click();
    assert.equal(controller.getActiveSource(), 'form');
    assert.equal(formPanel.hidden, false);
    assert.equal(topiPanel.hidden, true);
});

test('source switch supports ArrowRight, ArrowLeft, Home, and End keyboard navigation with roving tabindex and focus', (context) => {
    const { dom, document, formTab, topiTab, formPanel, topiPanel } = createSwitchDom(context);
    const controller = initInquirySourceSwitch({ document });
    context.after(() => controller?.destroy());

    formTab.focus();
    assert.equal(document.activeElement, formTab);

    // ArrowRight -> Topi
    formTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(controller.getActiveSource(), 'topi');
    assert.equal(document.activeElement, topiTab);
    assert.equal(topiTab.tabIndex, 0);
    assert.equal(formTab.tabIndex, -1);
    assert.equal(formPanel.hidden, true);
    assert.equal(topiPanel.hidden, false);

    // ArrowRight wraps -> Form
    topiTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(controller.getActiveSource(), 'form');
    assert.equal(document.activeElement, formTab);
    assert.equal(formPanel.hidden, false);
    assert.equal(topiPanel.hidden, true);

    // ArrowLeft wraps -> Topi
    formTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(controller.getActiveSource(), 'topi');
    assert.equal(document.activeElement, topiTab);

    // Home -> Form
    topiTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(controller.getActiveSource(), 'form');
    assert.equal(document.activeElement, formTab);

    // End -> Topi
    formTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(controller.getActiveSource(), 'topi');
    assert.equal(document.activeElement, topiTab);
});

test('form tab badge mirrors #staff-inquiries-home-badge on init and via MutationObserver and hides at 0', async (context) => {
    const { document, homeBadge, formBadge } = createSwitchDom(context);

    // Starts at 0 -> hidden
    assert.equal(homeBadge.textContent.trim(), '0');
    const controller = initInquirySourceSwitch({ document });
    context.after(() => controller?.destroy());

    assert.equal(formBadge.hidden, true);
    assert.equal(formBadge.textContent, '0');

    // Home badge updates to 4 -> tab badge updates and becomes visible
    homeBadge.textContent = '4';
    homeBadge.hidden = false;
    await flushMutations();

    assert.equal(formBadge.hidden, false);
    assert.equal(formBadge.textContent, '4');

    // Home badge updates back to 0 -> tab badge hides
    homeBadge.textContent = '0';
    homeBadge.hidden = true;
    await flushMutations();

    assert.equal(formBadge.hidden, true);
    assert.equal(formBadge.textContent, '0');
});

test('form tab badge copies non-zero #staff-inquiries-home-badge immediately on init', (context) => {
    const { document, homeBadge, formBadge } = createSwitchDom(context);
    homeBadge.textContent = '7';
    homeBadge.hidden = false;

    const controller = initInquirySourceSwitch({ document });
    context.after(() => controller?.destroy());

    assert.equal(formBadge.hidden, false);
    assert.equal(formBadge.textContent, '7');
});

test('source switch persists selection in sessionStorage and does not throw when sessionStorage fails', (context) => {
    const { dom, document, topiTab, formPanel, topiPanel } = createSwitchDom(context);
    const first = initInquirySourceSwitch({ document });
    topiTab.click();
    assert.equal(dom.window.sessionStorage.getItem('staff:inquiries:source'), 'topi');
    first.destroy();

    // Re-init restores persisted 'topi' selection
    const restored = initInquirySourceSwitch({ document });
    assert.equal(restored.getActiveSource(), 'topi');
    assert.equal(formPanel.hidden, true);
    assert.equal(topiPanel.hidden, false);
    restored.destroy();

    // Throwing storage does not throw on init or tab switch
    const brokenStorage = {
        getItem() {
            throw new Error('SecurityError');
        },
        setItem() {
            throw new Error('QuotaExceededError');
        }
    };
    const fallbackController = initInquirySourceSwitch({ document, storage: brokenStorage });
    context.after(() => fallbackController?.destroy());

    assert.doesNotThrow(() => {
        fallbackController.setSource('form');
        fallbackController.setSource('topi');
    });
    assert.equal(fallbackController.getActiveSource(), 'topi');
    assert.equal(formPanel.hidden, true);
    assert.equal(topiPanel.hidden, false);
});
