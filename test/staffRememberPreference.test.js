import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initStaffAuth } from '../src/staff/auth.js';

const LOGIN_MARKUP = `<!doctype html><html><body>
  <div id="login-overlay"><form id="login-form"><input id="login-username"><input id="login-password"><input id="login-remember" type="checkbox"><button id="btn-login-submit"></button><div id="login-error"></div></form></div>
  <main id="app-content"></main><button id="btn-staff-logout"></button><div id="staff-global-error"></div>
</body></html>`;

function installAuthEnvironment(context, rememberPreference) {
    const dom = new JSDOM(LOGIN_MARKUP, { url: 'https://portal.test/yetkili/' });
    dom.window.localStorage.setItem('staff-login-device-id', 'test-device-id-1234567890');
    dom.window.localStorage.setItem('staff-login-remember-me', rememberPreference);
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.fetch = async () => new Response(null, { status: 401 });
    context.after(() => {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
        dom.window.close();
    });
    return dom;
}

test('remember-me selection is restored and saved for the next login', async (context) => {
    const firstPage = installAuthEnvironment(context, 'true');
    void initStaffAuth();
    await new Promise((resolve) => setImmediate(resolve));
    const rememberCheckbox = firstPage.window.document.querySelector('#login-remember');
    assert.equal(rememberCheckbox.checked, true);

    rememberCheckbox.checked = false;
    rememberCheckbox.dispatchEvent(new firstPage.window.Event('change'));
    assert.equal(firstPage.window.localStorage.getItem('staff-login-remember-me'), 'false');

    rememberCheckbox.checked = true;
    void initStaffAuth();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rememberCheckbox.checked, false);
});
