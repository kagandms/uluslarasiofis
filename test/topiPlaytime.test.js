import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    TOPI_YARN_SVG_SOURCE,
    createTopiPlaytime,
    createTopiYarn,
    pickTopiToy
} from '../src/public/topiMascot.js';

function createDom(context) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    context.after(() => dom.window.close());
    return { dom, doc: dom.window.document };
}

function createScriptedRandom(values) {
    let index = 0;
    return () => {
        const value = values[index % values.length];
        index += 1;
        return value;
    };
}

test('TOPI_YARN_SVG_SOURCE is <= 1500 bytes, uses 24x24 viewBox, and has no external URLs or scripts', () => {
    assert.ok(Buffer.byteLength(TOPI_YARN_SVG_SOURCE, 'utf8') <= 1500, 'Yarn SVG source must be <= 1500 bytes');
    assert.match(TOPI_YARN_SVG_SOURCE, /viewBox="0 0 24 24"/);

    const withoutXmlns = TOPI_YARN_SVG_SOURCE.replace('xmlns="http://www.w3.org/2000/svg"', '');
    assert.equal(/https?:\/\//i.test(withoutXmlns), false, 'Yarn SVG must not contain external http(s) URLs');
    assert.equal(/<script/i.test(TOPI_YARN_SVG_SOURCE), false, 'Yarn SVG must not contain <script');
});

test('createTopiYarn returns span.topi-yarn with an aria-hidden svg and respects size', (context) => {
    const { doc } = createDom(context);

    const first = createTopiYarn(doc, { size: 22 });
    const second = createTopiYarn(doc, { size: 18 });

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.tagName, 'SPAN');
    assert.equal(first.className, 'topi-yarn');
    assert.equal(first.getAttribute('aria-hidden'), 'true');
    assert.equal(second.getAttribute('aria-hidden'), 'true');

    const svg1 = first.querySelector('svg.mascot-yarn');
    const svg2 = second.querySelector('svg.mascot-yarn');
    assert.ok(svg1);
    assert.ok(svg2);
    assert.equal(svg1.getAttribute('width'), '22');
    assert.equal(svg1.getAttribute('height'), '22');
    assert.equal(svg2.getAttribute('width'), '18');
    assert.equal(svg2.getAttribute('height'), '18');
    assert.equal(svg1.getAttribute('aria-hidden'), 'true');
    assert.equal(svg1.getAttribute('focusable'), 'false');
});

test('pickTopiToy with scripted random never returns the same toy 3 times in a row', () => {
    const alwaysMouseRandom = () => 0.1;
    const alwaysYarnRandom = () => 0.9;

    assert.equal(pickTopiToy([], alwaysMouseRandom), 'mouse');
    assert.equal(pickTopiToy(['mouse'], alwaysMouseRandom), 'mouse');
    assert.equal(pickTopiToy(['mouse', 'mouse'], alwaysMouseRandom), 'yarn');

    assert.equal(pickTopiToy([], alwaysYarnRandom), 'yarn');
    assert.equal(pickTopiToy(['yarn'], alwaysYarnRandom), 'yarn');
    assert.equal(pickTopiToy(['yarn', 'yarn'], alwaysYarnRandom), 'mouse');

    const history = [];
    for (let i = 0; i < 12; i += 1) {
        const picked = pickTopiToy(history, alwaysMouseRandom);
        history.push(picked);
        if (i >= 2) {
            const lastThree = history.slice(-3);
            assert.equal(
                lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2],
                false,
                `Toy repeated 3 times in a row at index ${i}: ${lastThree.join(', ')}`
            );
        }
    }
});

test('createTopiPlaytime with reducedMotion returns element null and creates nothing', (context) => {
    const { doc } = createDom(context);

    const playtime = createTopiPlaytime(doc, { reducedMotion: true });
    assert.equal(playtime.element, null);
    assert.equal(playtime.next(), null);
    assert.doesNotThrow(() => playtime.destroy());
    assert.equal(doc.body.children.length, 0);
});

test('createTopiPlaytime renders aria-hidden wrapper with one toy child and swaps on animationiteration', (context) => {
    const { dom, doc } = createDom(context);
    const scriptedRandom = createScriptedRandom([0.1, 0.1, 0.9, 0.9]);

    const playtime = createTopiPlaytime(doc, { reducedMotion: false, random: scriptedRandom });
    context.after(() => playtime.destroy());

    const wrapper = playtime.element;
    assert.ok(wrapper);
    assert.equal(wrapper.tagName, 'SPAN');
    assert.equal(wrapper.className, 'topi-playtime');
    assert.equal(wrapper.getAttribute('aria-hidden'), 'true');
    assert.equal(wrapper.children.length, 1);

    const firstToy = wrapper.firstElementChild;
    assert.equal(firstToy.className, 'topi-mouse');
    assert.equal(firstToy.getAttribute('aria-hidden'), 'true');

    // Initial history has ['mouse']; first random 0.1 -> 'mouse' (2 in a row)
    firstToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const secondToy = wrapper.firstElementChild;
    assert.equal(secondToy.className, 'topi-mouse');
    assert.equal(secondToy.getAttribute('aria-hidden'), 'true');

    // History has ['mouse', 'mouse']; second random 0.1 is overridden to 'yarn'
    secondToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const thirdToy = wrapper.firstElementChild;
    assert.equal(thirdToy.className, 'topi-yarn');
    assert.equal(thirdToy.getAttribute('aria-hidden'), 'true');

    // Third random 0.9 -> 'yarn' (2 in a row) via animationend
    thirdToy.dispatchEvent(new dom.window.Event('animationend'));
    assert.equal(wrapper.children.length, 1);
    const fourthToy = wrapper.firstElementChild;
    assert.equal(fourthToy.className, 'topi-yarn');

    // Fourth random 0.9 is overridden to 'mouse'
    fourthToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    assert.equal(wrapper.firstElementChild.className, 'topi-mouse');
});

test('createTopiPlaytime destroy removes listeners and stops swapping', (context) => {
    const { dom, doc } = createDom(context);
    const playtime = createTopiPlaytime(doc, {
        reducedMotion: false,
        random: () => 0.9
    });

    const wrapper = playtime.element;
    const initialToy = wrapper.firstElementChild;
    assert.equal(initialToy.className, 'topi-mouse');

    playtime.destroy();

    initialToy.dispatchEvent(new dom.window.Event('animationiteration'));
    initialToy.dispatchEvent(new dom.window.Event('animationend'));
    assert.equal(wrapper.firstElementChild, initialToy);
    assert.equal(playtime.next(), null);
});

test('pickTopiToy calls random exactly once per pick including overridden case', () => {
    let calls = 0;
    const rng = () => {
        calls += 1;
        return 0.1;
    };

    assert.equal(pickTopiToy([], rng), 'mouse');
    assert.equal(calls, 1);

    assert.equal(pickTopiToy(['mouse', 'mouse'], rng), 'yarn');
    assert.equal(calls, 2);

    assert.equal(pickTopiToy(['yarn', 'yarn'], rng), 'mouse');
    assert.equal(calls, 3);
});
