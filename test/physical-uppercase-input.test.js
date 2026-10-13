import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindPhysicalUppercaseInput } from '../src/staff/physical-uppercase-input.js';

for (const [name, entered, expected] of [['first_name', 'selin ışık', 'SELİN IŞIK'], ['last_name', 'enik русский', 'ENİK РУССКИЙ'], ['passport_number', 'ai123', 'AI123']]) {
    test(`uppercase ${name} stores the displayed value and preserves the caret`, () => {
        const dom = new JSDOM(`<input name="${name}">`);
        const input = dom.window.document.querySelector('input');
        let saved;
        bindPhysicalUppercaseInput(input, value => { saved = value; });

        input.value = entered;
        input.setSelectionRange(2, 2);
        input.dispatchEvent(new dom.window.Event('input'));

        assert.equal(input.value, expected);
        assert.equal(saved, expected);
        assert.equal(input.selectionStart, 2);
        dom.window.close();
    });
}

test('uppercase waits for composition to finish', () => {
    const dom = new JSDOM('<input name="first_name">');
    const input = dom.window.document.querySelector('input');
    bindPhysicalUppercaseInput(input, () => {});

    input.value = 'selin';
    input.dispatchEvent(new dom.window.InputEvent('input', { isComposing: true }));
    assert.equal(input.value, 'selin');
    input.dispatchEvent(new dom.window.CompositionEvent('compositionend'));

    assert.equal(input.value, 'SELİN');
    dom.window.close();
});
