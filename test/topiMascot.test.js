import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    TOPI_STATES,
    TOPI_SVG_SOURCE,
    createTopi,
    ensureTopiStyles,
    setTopiState
} from '../src/public/topiMascot.js';

function createDom(context) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    context.after(() => dom.window.close());
    return dom.window.document;
}

test('TOPI_SVG_SOURCE is byte-identical to design/mascot/topi/topi-cat.svg, <= 12288 bytes, and has no external or script content', async () => {
    const svgPath = resolve(process.cwd(), 'design/mascot/topi/topi-cat.svg');
    const fileContents = await readFile(svgPath, 'utf8');

    assert.equal(TOPI_SVG_SOURCE, fileContents);
    assert.ok(Buffer.byteLength(TOPI_SVG_SOURCE, 'utf8') <= 12288, 'SVG source must be <= 12288 bytes');

    const withoutXmlns = TOPI_SVG_SOURCE.replace('xmlns="http://www.w3.org/2000/svg"', '');
    assert.equal(/https?:\/\//i.test(withoutXmlns), false, 'SVG must not contain external http(s) URLs');
    assert.equal(/<script/i.test(TOPI_SVG_SOURCE), false, 'SVG must not contain <script');

    for (const match of TOPI_SVG_SOURCE.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
        assert.ok(match[1].startsWith('#'), `Unexpected non-fragment href: ${match[1]}`);
    }
});

test('TOPI_STATES is frozen and contains all 8 expected states', () => {
    assert.equal(Object.isFrozen(TOPI_STATES), true);
    assert.deepEqual(TOPI_STATES, [
        'idle',
        'thinking',
        'understood',
        'checking',
        'handoff',
        'confused',
        'sleepy',
        'hello'
    ]);
});

test('createTopi yields unique IDs across instances, resolves every internal reference, and strips inline <style>', (context) => {
    const doc = createDom(context);

    const first = createTopi(doc, { state: 'idle', size: 32 });
    const second = createTopi(doc, { state: 'thinking', calm: true, size: 28 });

    assert.equal(first.tagName, 'SPAN');
    assert.equal(first.className, 'topi');
    assert.equal(first.getAttribute('aria-hidden'), 'true');

    const svg1 = first.querySelector('svg');
    const svg2 = second.querySelector('svg');
    assert.ok(svg1);
    assert.ok(svg2);
    assert.equal(svg1.getAttribute('width'), '32');
    assert.equal(svg1.getAttribute('height'), '32');
    assert.equal(svg2.getAttribute('width'), '28');
    assert.equal(svg2.getAttribute('height'), '28');
    assert.equal(svg1.querySelector('style'), null);
    assert.equal(svg2.querySelector('style'), null);

    assert.equal(svg1.classList.contains('mascot-svg'), true);
    assert.equal(svg1.classList.contains('mascot-cat'), true);
    assert.equal(svg2.classList.contains('is-thinking'), true);
    assert.equal(svg2.classList.contains('is-calm'), true);

    const ids1 = new Set([...svg1.querySelectorAll('[id]')].map((el) => el.getAttribute('id')));
    const ids2 = new Set([...svg2.querySelectorAll('[id]')].map((el) => el.getAttribute('id')));

    assert.ok(ids1.size >= 7, 'First instance should preserve all <defs> IDs');
    assert.equal(ids1.size, ids2.size);
    for (const id of ids1) {
        assert.equal(ids2.has(id), false, `ID ${id} must be unique across instances`);
    }

    for (const [svg, idSet] of [[svg1, ids1], [svg2, ids2]]) {
        for (const el of svg.querySelectorAll('*')) {
            for (const attr of el.attributes) {
                if ((attr.localName === 'href' || attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#')) {
                    const targetId = attr.value.slice(1);
                    assert.ok(idSet.has(targetId), `Missing target id #${targetId} in same SVG instance`);
                }
                for (const urlMatch of attr.value.matchAll(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g)) {
                    const targetId = urlMatch[2];
                    assert.ok(idSet.has(targetId), `Missing url(#${targetId}) target in same SVG instance`);
                }
            }
        }
    }
});

test('setTopiState swaps state classes, preserves or updates calm, and falls back to idle on invalid state', (context) => {
    const doc = createDom(context);
    const topi = createTopi(doc, { state: 'idle', calm: false, size: 36 });
    const svg = topi.querySelector('svg');

    setTopiState(topi, 'thinking');
    assert.equal(svg.classList.contains('is-thinking'), true);
    assert.equal(svg.classList.contains('is-calm'), false);

    setTopiState(topi, 'checking', { calm: true });
    assert.equal(svg.classList.contains('is-thinking'), false);
    assert.equal(svg.classList.contains('is-checking'), true);
    assert.equal(svg.classList.contains('is-calm'), true);

    setTopiState(topi, 'handoff');
    assert.equal(svg.classList.contains('is-checking'), false);
    assert.equal(svg.classList.contains('is-handoff'), true);
    assert.equal(svg.classList.contains('is-calm'), true, 'calm should remain true when omitted');

    setTopiState(topi, 'invalid-state', { calm: false });
    assert.equal(svg.classList.contains('is-handoff'), false);
    assert.equal(svg.classList.contains('is-calm'), false);
    for (const state of TOPI_STATES) {
        if (state !== 'idle') {
            assert.equal(svg.classList.contains(`is-${state}`), false);
        }
    }

    const fallbackTopi = createTopi(doc, { state: 'not-valid' });
    const fallbackSvg = fallbackTopi.querySelector('svg');
    for (const state of TOPI_STATES) {
        if (state !== 'idle') {
            assert.equal(fallbackSvg.classList.contains(`is-${state}`), false);
        }
    }
});

test('ensureTopiStyles inserts a single stylesheet in document.head idempotently', (context) => {
    const doc = createDom(context);

    const firstStyle = ensureTopiStyles(doc);
    const secondStyle = ensureTopiStyles(doc);

    assert.ok(firstStyle);
    assert.equal(firstStyle, secondStyle);
    assert.equal(doc.head.querySelectorAll('#topi-mascot-styles').length, 1);
    assert.match(firstStyle.textContent, /\.mascot-cat/);
    assert.match(firstStyle.textContent, /@keyframes bk/);
});
