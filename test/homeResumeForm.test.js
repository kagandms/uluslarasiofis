import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initHomeResumeForm } from '../src/public/homeResumeForm.js';

test('homepage resume form opens the matched draft and the new-application page omits it', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const publicCss = await readFile(resolve(process.cwd(), 'src/public/public.css'), 'utf8');
    const applicationHtml = await readFile(resolve(process.cwd(), 'basvuru/index.html'), 'utf8');
    const home = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const application = new JSDOM(applicationHtml);
    const style = home.window.document.createElement('style');
    style.textContent = publicCss;
    home.window.document.head.append(style);
    const { getComputedStyle } = home.window;
    const form = home.window.document.querySelector('#resume-application-form');
    const panel = form.closest('.application-resume-card');
    const openButton = home.window.document.querySelector('#btn-home-resume');
    assert.ok(form);
    assert.equal(application.window.document.querySelector('#resume-application-form'), null);
    assert.equal(panel.hidden, true);
    assert.equal(getComputedStyle(panel).display, 'none');
    assert.equal(openButton.parentElement.closest('.home-actions') !== null, true);
    assert.equal(openButton.classList.contains('home-cta'), true);
    assert.equal(openButton.classList.contains('home-cta-tertiary'), true);
    assert.equal(openButton.getAttribute('aria-controls'), panel.id);
    assert.equal(openButton.getAttribute('aria-expanded'), 'false');
    assert.equal(openButton.textContent, 'Başvuruma Devam Et');

    let accessCredentials;
    const destinations = [];
    initHomeResumeForm({
        root: home.window.document,
        api: {
            async accessApplicationWithReference(credentials) {
                accessCredentials = credentials;
                return { status: 'draft' };
            }
        },
        navigate: (path) => destinations.push(path),
        getMessage: (key) => ({ applicationLoadFailed: 'Başvuru açılamadı.' })[key] || key
    });

    openButton.click();
    assert.equal(panel.hidden, false);
    assert.equal(getComputedStyle(panel).display, 'grid');
    assert.equal(openButton.getAttribute('aria-expanded'), 'true');
    assert.equal(home.window.document.activeElement, form.querySelector('[name="resume_reference_number"]'));
    openButton.click();
    assert.equal(panel.hidden, true);
    assert.equal(getComputedStyle(panel).display, 'none');
    assert.equal(openButton.getAttribute('aria-expanded'), 'false');
    openButton.click();

    form.querySelector('[name="resume_reference_number"]').value = ' ITU-TEST-1234 ';
    form.querySelector('[name="resume_student_number"]').value = ' STU-12345 ';
    form.dispatchEvent(new home.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.deepEqual(accessCredentials, { reference_number: 'ITU-TEST-1234', student_number: 'STU-12345' });
    assert.deepEqual(destinations, ['/basvuru/']);
    home.window.close();
    application.window.close();
});

test('homepage resume form keeps invalid credentials feedback on the homepage', async () => {
    const dom = new JSDOM(`<!doctype html><form id="resume-application-form">
        <input name="resume_reference_number"><input name="resume_student_number">
        <button type="submit">Continue</button><p class="resume-feedback"></p>
    </form>`, { url: 'https://portal.test/' });
    const messages = {
        accessInvalidCredentials: 'Application number or student number is incorrect.',
        applicationLoadFailed: 'Application could not be opened.'
    };
    initHomeResumeForm({
        root: dom.window.document,
        api: {
            async accessApplicationWithReference() {
                throw Object.assign(new Error('invalid credentials'), { status: 401 });
            }
        },
        navigate: () => assert.fail('invalid credentials must not navigate'),
        getMessage: (key) => messages[key] || key
    });
    const form = dom.window.document.querySelector('form');
    form.querySelector('[name="resume_reference_number"]').value = 'ITU-TEST-1234';
    form.querySelector('[name="resume_student_number"]').value = 'STU-12345';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(form.querySelector('.resume-feedback').textContent, messages.accessInvalidCredentials);
    assert.equal(form.querySelector('button').disabled, false);
    dom.window.close();
});
