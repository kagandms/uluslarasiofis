import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as topiMascot from '../src/public/topiMascot.js';
import {
    TOPI_MOUSE_SVG_SOURCE,
    TOPI_TOYS,
    TOPI_YARN_SVG_SOURCE,
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

async function readWorkspaceFile(relativePath) {
    return readFile(resolve(process.cwd(), relativePath), 'utf8');
}

function extractCssBlock(css, selectorPattern) {
    const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `Expected CSS block matching ${selectorPattern}`);
    return match[1];
}

function parseZIndex(cssBlock, label) {
    const match = cssBlock.match(/z-index\s*:\s*(-?\d+)/);
    assert.ok(match, `Expected numeric z-index in ${label}`);
    return Number(match[1]);
}

test('all toy SVG sources are <= 1500 bytes, use 24x24 viewBox, have aria-hidden, and have no <image>, external href, or scripts', () => {
    const sources = [
        ['mouse', TOPI_MOUSE_SVG_SOURCE],
        ['yarn', TOPI_YARN_SVG_SOURCE]
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

    assert.match(TOPI_MOUSE_SVG_SOURCE, /class="mouse-shadow"/, 'mouse SVG must include a subtle ground shadow');
    assert.match(TOPI_YARN_SVG_SOURCE, /class="yarn-core"/, 'yarn SVG must include a rotating yarn-core group');
    assert.match(TOPI_YARN_SVG_SOURCE, /class="yarn-thread"/, 'yarn SVG must include a trailing loose thread');
});

test('toy factories return aria-hidden wrappers and SVGs respecting size', (context) => {
    const { doc } = createDom(context);
    const factories = [
        { create: createTopiMouse, wrapperClass: 'topi-mouse', svgClass: 'mascot-mouse' },
        { create: createTopiYarn, wrapperClass: 'topi-yarn', svgClass: 'mascot-yarn' }
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

test('pickTopiToy only returns mouse or yarn, never repeats 3 times in a row, and alternates after at most 2 rounds', () => {
    assert.deepEqual(TOPI_TOYS, ['mouse', 'yarn']);

    assert.equal(pickTopiToy([], () => 0), 'mouse');
    assert.equal(pickTopiToy([], () => 0.49), 'mouse');
    assert.equal(pickTopiToy([], () => 0.5), 'yarn');
    assert.equal(pickTopiToy([], () => 0.99), 'yarn');

    assert.equal(pickTopiToy(['mouse'], () => 0.1), 'mouse');
    assert.equal(pickTopiToy(['mouse', 'mouse'], () => 0.1), 'yarn');

    assert.equal(pickTopiToy(['yarn'], () => 0.9), 'yarn');
    assert.equal(pickTopiToy(['yarn', 'yarn'], () => 0.9), 'mouse');

    for (const fixedRoll of [0.1, 0.49, 0.5, 0.9]) {
        const constantRandom = () => fixedRoll;
        const history = [];
        for (let i = 0; i < 16; i += 1) {
            const picked = pickTopiToy(history, constantRandom);
            assert.ok(TOPI_TOYS.includes(picked), `Unexpected toy: ${picked}`);
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

test('createTopiPlaytime with reducedMotion returns element null, creates nothing, and clears reaction class', (context) => {
    const { doc } = createDom(context);
    const launcher = doc.createElement('button');
    launcher.classList.add('is-playing', 'is-playing-mouse');

    const playtime = createTopiPlaytime(doc, { reducedMotion: true, launcher });
    assert.equal(playtime.element, null);
    assert.equal(playtime.next(), null);
    assert.equal(launcher.classList.contains('is-playing'), false);
    assert.equal(launcher.classList.contains('is-playing-mouse'), false);
    assert.doesNotThrow(() => playtime.destroy());
    assert.equal(doc.body.children.length, 0);
});

test('createTopiPlaytime swaps between mouse and yarn on animationiteration/animationend and sets/clears reaction class', async (context) => {
    const { dom, doc } = createDom(context);
    const launcher = doc.createElement('button');
    const scriptedRandom = createScriptedRandom([0.1, 0.1, 0.9, 0.9]);

    const playtime = createTopiPlaytime(doc, {
        reducedMotion: false,
        random: scriptedRandom,
        launcher
    });
    context.after(() => playtime.destroy());

    const wrapper = playtime.element;
    assert.ok(wrapper);
    assert.equal(wrapper.tagName, 'SPAN');
    assert.equal(wrapper.className, 'topi-playtime');
    assert.equal(wrapper.getAttribute('aria-hidden'), 'true');
    assert.equal(wrapper.children.length, 1);
    assert.equal(launcher.classList.contains('is-playing'), true);
    assert.equal(launcher.classList.contains('is-playing-mouse'), true);
    assert.equal(launcher.classList.contains('is-playing-yarn'), false);

    const firstToy = wrapper.firstElementChild;
    assert.equal(firstToy.className, 'topi-mouse');
    assert.equal(firstToy.getAttribute('aria-hidden'), 'true');

    // History has ['mouse']; first random 0.1 -> 'mouse' (2 in a row)
    firstToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const secondToy = wrapper.firstElementChild;
    assert.equal(secondToy.className, 'topi-mouse');
    assert.equal(launcher.classList.contains('is-playing'), true);
    assert.equal(launcher.classList.contains('is-playing-mouse'), true);

    // History has ['mouse', 'mouse']; second random 0.1 is overridden to 'yarn'
    secondToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const thirdToy = wrapper.firstElementChild;
    assert.equal(thirdToy.className, 'topi-yarn');
    assert.equal(thirdToy.getAttribute('aria-hidden'), 'true');
    assert.equal(launcher.classList.contains('is-playing'), true);
    assert.equal(launcher.classList.contains('is-playing-yarn'), true);
    assert.equal(launcher.classList.contains('is-playing-mouse'), false);

    // History has ['mouse', 'mouse', 'yarn']; third random 0.9 -> 'yarn' via animationend
    thirdToy.dispatchEvent(new dom.window.Event('animationend'));
    assert.equal(wrapper.children.length, 1);
    const fourthToy = wrapper.firstElementChild;
    assert.equal(fourthToy.className, 'topi-yarn');

    // History ends with ['yarn', 'yarn']; fourth random 0.9 is overridden to 'mouse'
    fourthToy.dispatchEvent(new dom.window.Event('animationiteration'));
    assert.equal(wrapper.children.length, 1);
    const fifthToy = wrapper.firstElementChild;
    assert.equal(fifthToy.className, 'topi-mouse');
    assert.equal(launcher.classList.contains('is-playing-mouse'), true);

    playtime.destroy();
    assert.equal(launcher.classList.contains('is-playing'), false);
    assert.equal(launcher.classList.contains('is-playing-mouse'), false);
    assert.equal(launcher.classList.contains('is-playing-yarn'), false);

    // Also sets and clears is-playing when attached to a parent launcher without explicit launcher option
    const implicitLauncher = doc.createElement('button');
    const implicitPlaytime = createTopiPlaytime(doc, { reducedMotion: false, random: () => 0.1 });
    implicitLauncher.append(implicitPlaytime.element);
    await Promise.resolve();
    assert.equal(implicitLauncher.classList.contains('is-playing'), true);
    assert.equal(implicitLauncher.classList.contains('is-playing-mouse'), true);

    implicitPlaytime.destroy();
    assert.equal(implicitLauncher.classList.contains('is-playing'), false);
    assert.equal(implicitLauncher.classList.contains('is-playing-mouse'), false);
});

test('createTopiPlaytime destroy removes listeners and stops swapping', (context) => {
    const { dom, doc } = createDom(context);
    const launcher = doc.createElement('button');
    const playtime = createTopiPlaytime(doc, {
        reducedMotion: false,
        random: () => 0.9,
        launcher
    });

    const wrapper = playtime.element;
    const initialToy = wrapper.firstElementChild;
    assert.equal(initialToy.className, 'topi-mouse');
    assert.equal(launcher.classList.contains('is-playing'), true);

    playtime.destroy();

    initialToy.dispatchEvent(new dom.window.Event('animationiteration'));
    initialToy.dispatchEvent(new dom.window.Event('animationend'));
    assert.equal(wrapper.firstElementChild, initialToy);
    assert.equal(playtime.next(), null);
    assert.equal(launcher.classList.contains('is-playing'), false);
});

test('no ball or feather toy symbols remain in src', async () => {
    assert.equal('TOPI_BALL_SVG_SOURCE' in topiMascot, false);
    assert.equal('TOPI_FEATHER_SVG_SOURCE' in topiMascot, false);
    assert.equal('createTopiBall' in topiMascot, false);
    assert.equal('createTopiFeather' in topiMascot, false);

    const files = [
        'src/public/topiMascot.js',
        'src/public/chatbot.css',
        'src/public/homeChatbot.js',
        'src/staff/staffAssistant.css',
        'src/staff/staffAssistant.js'
    ];
    const forbiddenPattern = /TOPI_(?:BALL|FEATHER)_SVG_SOURCE|createTopi(?:Ball|Feather)|(?:topi|mascot)-(?:ball|feather)|(?:ball-bounce|feather-drift)|\bball\b|\bfeather\b/i;

    for (const file of files) {
        const source = await readWorkspaceFile(file);
        assert.equal(
            forbiddenPattern.test(source),
            false,
            `Found forbidden ball/feather reference in ${file}`
        );
    }
});

test('toy wrapper has higher z-index than the cat and enforces overflow hidden and pointer-events none in student and staff CSS', async () => {
    const [studentCss, staffCss] = await Promise.all([
        readWorkspaceFile('src/public/chatbot.css'),
        readWorkspaceFile('src/staff/staffAssistant.css')
    ]);

    const studentCatBlock = extractCssBlock(studentCss, '\\.chatbot-launcher \\.topi');
    const studentPlaytimeBlock = extractCssBlock(studentCss, '\\.chatbot-launcher \\.topi-playtime');
    assert.ok(
        parseZIndex(studentPlaytimeBlock, '.chatbot-launcher .topi-playtime')
            > parseZIndex(studentCatBlock, '.chatbot-launcher .topi'),
        'Student .topi-playtime z-index must be greater than .topi z-index'
    );
    assert.match(studentPlaytimeBlock, /overflow\s*:\s*hidden/);
    assert.match(studentPlaytimeBlock, /pointer-events\s*:\s*none/);
    assert.match(studentCss, /\.chatbot-launcher\.is-playing\s+\.topi\s*\{/);
    assert.match(studentCss, /\.chatbot-launcher\.is-playing\s+\.topi\s+\.R\s*\{/);

    const staffCatBlock = extractCssBlock(
        staffCss,
        '\\.staff-assistant-launcher \\.topi,\\s*\\.staff-assistant-launcher \\.staff-assistant-launcher-text'
    );
    const staffPlaytimeBlock = extractCssBlock(staffCss, '\\.staff-assistant-launcher \\.topi-playtime');
    assert.ok(
        parseZIndex(staffPlaytimeBlock, '.staff-assistant-launcher .topi-playtime')
            > parseZIndex(staffCatBlock, '.staff-assistant-launcher .topi'),
        'Staff .topi-playtime z-index must be greater than .topi z-index'
    );
    assert.match(staffPlaytimeBlock, /overflow\s*:\s*hidden/);
    assert.match(staffPlaytimeBlock, /pointer-events\s*:\s*none/);
    assert.match(staffCss, /\.staff-assistant-launcher\.is-playing\s+\.topi\s*\{/);
    assert.match(staffCss, /\.staff-assistant-launcher\.is-playing\s+\.topi\s+\.R\s*\{/);
});
