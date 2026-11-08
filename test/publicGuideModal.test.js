import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { openPublicGuideModal } from '../src/public/publicGuideModal.js';

function withDocument(run) {
    const dom = new JSDOM('<html lang="tr"><body><button id="trigger">Rehber</button><section id="already-inert"></section></body></html>');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
    try { run(dom.window); } finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
        dom.window.close();
    }
}

test('public guide focuses its controls, traps Tab, and restores the trigger and background on close', () => {
    withDocument((view) => {
        const trigger = document.getElementById('trigger');
        const background = document.getElementById('already-inert');
        background.inert = true;
        trigger.focus();
        openPublicGuideModal();
        const overlay = document.getElementById('public-guide-modal-overlay');
        const buttons = [...overlay.querySelectorAll('button')];
        const first = buttons[0];
        const last = buttons.at(-1);
        assert.equal(document.activeElement, first);
        assert.equal(trigger.inert, true);
        first.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        assert.equal(document.activeElement, last);
        last.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        assert.equal(document.activeElement, first);
        first.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(document.getElementById('public-guide-modal-overlay'), null);
        assert.equal(document.activeElement, trigger);
        assert.equal(Boolean(trigger.inert), false);
        assert.equal(background.inert, true);
    });
});

test('reopening the public guide cleans up its singleton and both close buttons restore focus', () => {
    withDocument(() => {
        const trigger = document.getElementById('trigger');
        trigger.focus();
        openPublicGuideModal();
        openPublicGuideModal();
        assert.equal(document.querySelectorAll('#public-guide-modal-overlay').length, 1);
        document.querySelector('.public-modal-close').focus();
        document.querySelector('.public-modal-close').click();
        assert.equal(document.activeElement, trigger);
        assert.equal(Boolean(trigger.inert), false);
        openPublicGuideModal();
        document.querySelector('.public-modal-footer button').focus();
        document.querySelector('.public-modal-footer button').click();
        assert.equal(document.activeElement, trigger);
        openPublicGuideModal();
        trigger.remove();
        document.querySelector('.public-modal-close').click();
        assert.equal(document.getElementById('public-guide-modal-overlay'), null);
    });
});

test('resume reference label stays translated in all five public locales', async () => {
    const html = await readFile(new URL('../basvuruya-devam-et/index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'https://portal.example.test/basvuruya-devam-et/' });
    dom.window.document.querySelectorAll('#live-clock-time, .live-clock-time, #live-clock-date, .live-clock-date').forEach((node) => node.remove());
    const originals = new Map(['window', 'document', 'localStorage'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const name of originals.keys()) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
    try {
        await import(`../src/public/main.js?resume-label=${crypto.randomUUID()}`);
        for (const [locale, expected] of [['tr', 'Başvuru Numarası'], ['en', 'Application Number'], ['ru', 'Номер заявки'], ['tk', 'Arza belgisi'], ['ar', 'رقم الطلب']]) {
            const select = document.getElementById('locale-select');
            select.value = locale;
            select.dispatchEvent(new dom.window.Event('change'));
            assert.equal(document.querySelector('label[for="resume-reference-number"] span').textContent, expected, locale);
        }
    } finally {
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
        dom.window.close();
    }
});

test('public guide walks through the screenshot steps and localizes its labels', () => {
    withDocument((view) => {
        openPublicGuideModal();
        const overlay = document.getElementById('public-guide-modal-overlay');
        const counter = overlay.querySelector('.public-guide-counter');
        const prev = overlay.querySelector('.public-guide-prev');
        const next = overlay.querySelector('.public-guide-next');
        const image = overlay.querySelector('.public-guide-figure img');
        assert.match(counter.textContent, /^Adım 1 \/ 9$/);
        assert.equal(prev.disabled, true);
        assert.equal(image.getAttribute('src'), '/guide/tr/iletisim.jpg');
        next.click();
        assert.match(counter.textContent, /^Adım 2 \/ 9$/);
        assert.equal(image.getAttribute('src'), '/guide/tr/kisisel.jpg');
        for (let step = 0; step < 10; step += 1) next.click();
        assert.equal(next.disabled, true);
        assert.equal(image.getAttribute('src'), '/guide/tr/devam-et.jpg');
        prev.click();
        assert.match(counter.textContent, /^Adım 8 \/ 9$/);
        overlay.querySelector('.public-modal-close').click();
        document.documentElement.lang = 'en';
        openPublicGuideModal();
        assert.match(document.querySelector('.public-guide-counter').textContent, /^Step 1 of 9$/);
        assert.equal(document.querySelector('.public-guide-figure img').getAttribute('src'), '/guide/en/iletisim.jpg');
        document.querySelector('.public-modal-close').click();
    });
});
