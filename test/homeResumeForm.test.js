import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initHomeResumeForm } from '../src/public/homeResumeForm.js';

test('dedicated resume page opens the matched draft while the homepage stays focused', async () => {
    const homeHtml = await readFile(resolve(process.cwd(), 'basvuruya-devam-et/index.html'), 'utf8');
    const publicCss = await readFile(resolve(process.cwd(), 'src/public/public.css'), 'utf8');
    const applicationHtml = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
    const home = new JSDOM(homeHtml, { url: 'https://portal.test/' });
    const application = new JSDOM(applicationHtml);
    const style = home.window.document.createElement('style');
    style.textContent = publicCss;
    home.window.document.head.append(style);
    const form = home.window.document.querySelector('#resume-application-form');
    assert.ok(form);
    assert.equal(home.window.document.body.dataset.page, 'resume');
    assert.equal(application.window.document.querySelector('#resume-application-form'), null);

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


    form.querySelector('[name="resume_reference_number"]').value = ' ITU-TEST-1234 ';
    form.querySelector('[name="resume_student_number"]').value = ' STU-12345 ';
    form.dispatchEvent(new home.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.deepEqual(accessCredentials, { reference_number: 'ITU-TEST-1234', student_number: 'STU-12345' });
    assert.deepEqual(destinations, ['/basvuru/']);
    home.window.close();
    application.window.close();
});

test('dedicated resume form keeps invalid credentials feedback visible', async () => {
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
