import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { renderPublicDocumentOverview } from '../src/public/home.js';
import { listPublicDocumentOverview } from '../src/server/domain/documentPolicy.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..');

async function readRepositoryFile(path) {
    return readFile(resolve(repositoryRoot, path), 'utf8');
}

function setGlobal(name, value) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    return () => {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
    };
}

test('public route contains no staff workspace and links to the planned student routes', async () => {
    const publicHtml = await readRepositoryFile('index.html');
    const staffHtml = await readRepositoryFile('yetkili/index.html');

    assert.match(publicHtml, /href="\/basvuru\/"/);
    assert.match(publicHtml, /href="\/basvurum\/"/);
    assert.match(publicHtml, /href="\/yetkili\/"/);
    assert.doesNotMatch(publicHtml, /view-ykn|view-cover|view-teblig|src\/staff\/main\.js|login-overlay/);
    assert.match(staffHtml, /src="\/src\/staff\/main\.js/);
    assert.match(staffHtml, /id="app-content" hidden/);
    assert.match(staffHtml, /id="btn-staff-logout"/);

    const applicationHtml = await readRepositoryFile('basvuru/index.html');
    const trackingHtml = await readRepositoryFile('basvurum/index.html');
    assert.doesNotMatch(applicationHtml + trackingHtml, /<form\b|type="file"|\/api\//i);
});

test('public landing exposes the requested student entry points and information sections', async () => {
    const publicHtml = await readRepositoryFile('index.html');
    const document = new JSDOM(publicHtml).window.document;

    assert.equal(document.querySelector('[data-i18n="homeStartAction"]')?.getAttribute('href'), '/basvuru/');
    assert.equal(document.querySelector('[data-i18n="homeTrackAction"]')?.getAttribute('href'), '/basvurum/');
    assert.ok(document.querySelector('[data-i18n="staffLink"][href="/yetkili/"]'));
    assert.equal(document.querySelectorAll('[data-process-step]').length, 5);
    assert.ok(document.querySelector('#public-document-overview'));
    assert.ok(document.querySelector('#public-application-statuses'));
    assert.doesNotMatch(publicHtml, /view-ykn|view-cover|view-teblig|src\/staff\/main\.js|login-overlay/);
});

test('landing document guidance renders policy-derived titles and highlights the under-18 requirement', () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><div id="overview"></div></body></html>').window.document;
    const root = document.getElementById('overview');
    renderPublicDocumentOverview(root, 'tr');

    assert.equal(root.querySelectorAll('.public-document-card').length, listPublicDocumentOverview().length);
    assert.ok([...root.querySelectorAll('.public-document-card h3')].some(({ textContent }) => textContent === 'Doğum belgesi'));
    assert.equal(root.querySelectorAll('.public-document-badge').length, 1);
    assert.match(root.textContent, /18 yaş altı başvurularda zorunludur/);
    assert.doesNotMatch(root.textContent, /application\/pdf|10 MB|conditional_rule/i);
});

test('public locale dictionaries have matching keys for all five supported languages', () => {
    assert.deepEqual(Object.keys(PUBLIC_MESSAGES).sort(), [...SUPPORTED_LOCALES].sort());
    const expectedKeys = Object.keys(PUBLIC_MESSAGES.tr).sort();
    for (const locale of SUPPORTED_LOCALES) {
        assert.deepEqual(Object.keys(PUBLIC_MESSAGES[locale]).sort(), expectedKeys, `${locale} locale keys`);
        assert.ok(Object.values(PUBLIC_MESSAGES[locale]).every((message) => typeof message === 'string'));
    }
});

test('public locale selection applies Arabic RTL direction and persists the selected locale', async () => {
    const publicHtml = await readRepositoryFile('index.html');
    const dom = new JSDOM(publicHtml, { url: 'https://portal.example.test/' });
    const restoreDocument = setGlobal('document', dom.window.document);
    const restoreLocalStorage = setGlobal('localStorage', dom.window.localStorage);

    try {
        await import('../src/public/main.js');
        const localeSelect = document.getElementById('locale-select');
        localeSelect.value = 'ar';
        localeSelect.dispatchEvent(new dom.window.Event('change'));

        assert.equal(document.documentElement.lang, 'ar');
        assert.equal(document.documentElement.dir, 'rtl');
        assert.equal(document.getElementById('public-home-heading').textContent, PUBLIC_MESSAGES.ar.homeHeading);
        assert.equal(localStorage.getItem('portal_ui_locale'), 'ar');
    } finally {
        restoreLocalStorage();
        restoreDocument();
        dom.window.close();
    }
});
