import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
    TOPI_BALL_SVG_SOURCE,
    TOPI_FEATHER_SVG_SOURCE,
    TOPI_MOUSE_SVG_SOURCE,
    TOPI_TOYS,
    TOPI_YARN_SVG_SOURCE,
    createTopiBall,
    createTopiFeather,
    createTopiMouse,
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

test('all toy SVG sources are <= 1500 bytes, use 24x24 viewBox, have aria-hidden, and have no <image>, external href, or scripts', () => {
    const sources = [
        ['mouse', TOPI_MOUSE_SVG_SOURCE],
        ['yarn', TOPI_YARN_SVG_SOURCE],
        ['ball', TOPI_BALL_SVG_SOURCE],
        ['feather', TOPI_FEATHER_SVG_SOURCE]
    ];

    for (const [name, source] of sources) {
        assert.ok(Buffer.byteLength(source, 'utf8') <= 1500, `${name} SVG source must be <= 1500 bytes`);
        assert.match(source, /viewBox="0 0 24 24"/, `${name} SVG must use 24x24 viewBox`);
        assert.match(source, /aria-hidden="true"/, `${name} SVG must have aria-hidden="true"`);
        assert.equal(/<image\b/i.test(source), false, `${name} SVG must not contain <image`);
        assert.equal(/\b(?:xlink:)?href\s*=\s*["']?(?:https?:|\/\/)/i.test(source), false, `${name} SVG must not contain external href`);

        const withoutXmlns = source.replace('xmlns="http://www.w3.org/2000/svg"', '');
        assert.equal(/https?:\/\//i.test(withoutXmlns), false, `${name} SVG must not contain external http(s) URLs`);
        assert.equal(/<script/i.test(source), false, `${name} SVG must not contain <script`);
    }
});

test('toy factories return aria-hidden wrappers and SVGs respecting size', (context) => {
    const { doc } = createDom(context);
    const factories = [
        { create: createTopiMouse, wrapperClass: 'topi-mouse', svgClass: 'mascot-mouse' },
        { create: createTopiYarn, wrapperClass: 'topi-yarn', svgClass: 'mascot-yarn' },
        { create: createTopiBall, wrapperClass: 'topi-ball', svgClass: 'mascot-ball' },
        { create: createTopiFeather, wrapperClass: 'topi-feather', svgClass: 'mascot-feather' }
    ];

    for (const { create, wrapperClass, svgClass } of factories) {
        const first = create(doc, { size: 22 });
        const second = create(doc, { size: 18 });

        assert.ok(first);
        assert.ok(second);
        assert.equal(first.tagName, 'SPAN');
        assert.equal(first.className, wrapperClass);
        assert.equal(first.getAttribute('aria-hidden'), 'true');
        assert.equal(second.getAttribute('aria-hidden'), 'true');

        const svg1 = first.querySelector(`svg.${svgClass}`);
        const svg2 = second.querySelector(`svg.${svgClass}`);
        assert.ok(svg1);
        assert.ok(svg2);
        assert.equal(svg1.getAttribute('width'), '22');
        assert.equal(svg1.getAttribute('height'), '22');
        assert.equal(svg2.getAttribute('width'), '18');
        assert.equal(svg2.getAttribute('height'), '18');
        assert.equal(svg1.getAttribute('aria-hidden'), 'true');
        assert.equal(svg1.getAttribute('focusable'), 'false');
    }
});

test('pickTopiToy returns all 4 toys by thresholds and never returns the same toy 3 times in a row', () => {
    assert.deepEqual(TOPI_TOYS, ['mouse', 'yarn', 'ball', 'feather']);

    assert.equal(pickTopiToy([], () => 0), 'mouse');
    assert.equal(pickTopiToy([], () => 0.24), 'mouse');
    assert.equal(pickTopiToy([], () => 0.25), 'yarn');
    assert.equal(pickTopiToy([], () => 0.49), 'yarn');
    assert.equal(pickTopiToy([], () => 0.5), 'ball');
    assert.equal(pickTopiToy([], () => 0.74), 'ball');
    assert.equal(pickTopiToy([], () => 0.75), 'feather');
    assert.equal(pickTopiToy([], () => 0.99), 'feather');

    assert.equal(pickTopiToy(['mouse'], () => 0.1), 'mouse');
    assert.equal(pickTopiToy(['mouse', 'mouse'], () => 0.1), 'yarn');

    assert.equal(pickTopiToy(['yarn'], () => 0.3), 'yarn');
    assert.equal(pickTopiToy(['yarn', 'yarn'], () => 0.3), 'mouse');

    assert.equal(pickTopiToy(['ball'], () => 0.6), 'ball');
    assert.equal(pickTopiToy(['ball', 'ball'], () => 0.6), 'yarn');

    assert.equal(pickTopiToy(['feather'], () => 0.9), 'feather');
    assert.equal(pickTopiToy(['feather', 'feather'], () => 0.9), 'ball');

    for (const fixedRoll of [0.1, 0.3, 0.6, 0.9]) {
        const constantRandom = () => fixedRoll;
        const history = [];
        for (let i = 0; i < 16; i += 1) {
            const picked = pickTopiToy(history, constantRandom);
            history.push(picked);
            if (i >= 2) {
                const lastThree = history.slice(-3);
                assert.equal(
                    lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2],
                    false,
                    `Toy repeated 3 times in a row for roll ${fixedRoll} at index ${i}: ${lastThree.join(', ')}`
                );
            }
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

test('createTopiPlaytime renders aria-hidden wrapper with one toy child and swaps through all 4 toys on animationiteration/animationend', (context) => {
    const { dom, doc } = createDom(context);
    const scriptedRandom = createScriptedRandom([0.1, 0.1, 0.6, 0.9]);

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

    // Third random 0.6 -> 'ball' via animationend
    thirdToy.dispatchEvent(new dom.window.Event('animationend'));
    assert.equal(wrapper.children.length, 1);
    const fourthToy = wrapper.firstElementChild;
    assert.equal(fourthToy.className, 'topi-ball');
    assert.equal(fourthToy.getAttribute('aria-hidden'), 'true');

    // Fourth random 0.9 -> 'feather' via animationiteration
    fourthToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const fifthToy = wrapper.firstElementChild;
    assert.equal(fifthToy.className, 'topi-feather');
    assert.equal(fifthToy.getAttribute('aria-hidden'), 'true');
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

    assert.equal(pickTopiToy(['ball', 'ball'], rng), 'mouse');
    assert.equal(calls, 4);

    assert.equal(pickTopiToy(['feather', 'feather'], rng), 'mouse');
    assert.equal(calls, 5);
});
