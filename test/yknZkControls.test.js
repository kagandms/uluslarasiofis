import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const source = await readFile(new URL('../ykn_eklenti-main/zk-form-controls.js', import.meta.url), 'utf8');

function createFramework(options = {}) {
    const dom = new JSDOM('<div id="form"></div>', { runScripts: 'outside-only', url: 'https://yoksis.yok.gov.tr/' });
    const { window } = dom;
    const listeners = new Set();
    const events = [];
    let widgets = new Map();
    let isBusy = false;
    function mount(value) {
        window.document.getElementById('form').innerHTML = `<fieldset class="z-radiogroup"><label><input id="single" type="radio" ${value === 'Bekar' ? 'checked' : ''}>Bekar</label><label><input id="married" type="radio" ${value === 'Evli' ? 'checked' : ''}>Evli</label></fieldset>
            <fieldset class="z-radiogroup"><label><input id="male" type="radio" ${value === 'Erkek' ? 'checked' : ''}>Erkek</label><label><input id="female" type="radio" ${value === 'Kadın' ? 'checked' : ''}>Kadın</label></fieldset>`;
        widgets = new Map();
        const groups = new Map();
        for (const radio of window.document.querySelectorAll('input')) {
            const fieldset = radio.closest('fieldset');
            if (!groups.has(fieldset)) groups.set(fieldset, {
                selected: null,
                setSelectedItem(widget) { this.selected = widget; },
                getSelectedItem() { return this.selected; }
            });
            const group = groups.get(fieldset);
            const widget = {
                getRadiogroup: () => group,
                isChecked: () => radio.checked,
                setChecked(checked) { radio.checked = checked; },
                fireOnCheck_(checked) {
                    events.push({ id: radio.id, checked });
                    isBusy = true;
                    window.queueMicrotask(() => {
                        if (options.rerender) mount(radio.id === 'single' ? 'Bekar' : radio.id === 'female' ? 'Kadın' : radio.id === 'male' ? 'Erkek' : 'Evli');
                        if (options.reject) {
                            group.selected = null;
                            radio.closest('fieldset')?.insertAdjacentHTML('beforeend', '<span class="z-errorbox">Validation</span>');
                        }
                        isBusy = false;
                        if (!options.noResponse) for (const listener of listeners) listener.onResponse();
                    });
                }
            };
            widgets.set(radio, widget);
            if (radio.checked && (!options.emptyGroup || events.length > 0)) group.selected = widget;
        }
    }
    mount(options.initial || 'Bekar');
    window.zk = { Widget: { $: (radio) => widgets.get(radio) }, Desktop: { all: {} } };
    window.zAu = { processing: () => isBusy };
    window.zWatch = {
        listen: ({ onResponse }) => listeners.add(onResponse),
        unlisten: ({ onResponse }) => listeners.delete(onResponse)
    };
    window.eval(source);
    return { dom, events, listeners, execute: (command) => window.YknZkForm.execute(command), close: () => window.close() };
}

for (const value of ['Erkek', 'Kadın']) {
    test(`MAIN-world selects the semantic Apply ${value} radio once`, async () => {
        const fixture = createFramework();
        try {
            const result = await fixture.execute({ action: 'selectRadio', field: 'gender', value, requestId: `test-${value}` });

            assert.equal(result.verified, true);
            assert.equal(fixture.events.length, 1);
            assert.equal(fixture.events[0].id, value === 'Kadın' ? 'female' : 'male');
            assert.equal(fixture.dom.window.document.getElementById('single').checked, true);
        } finally { fixture.close(); }
    });
}

test('checked Bekar with empty ZK group still commits exactly one genuine framework event', async () => {
    const fixture = createFramework({ emptyGroup: true });
    try {
        const command = { action: 'selectRadio', field: 'marital', value: 'Bekar', requestId: 'single-initial' };

        const first = await fixture.execute(command);
        const second = await fixture.execute(command);
        const verified = await fixture.execute({ ...command, action: 'verifyRadio' });

        assert.equal(first.verified, true);
        assert.equal(second.eventSent, false);
        assert.equal(verified.verified, true);
        assert.deepEqual(fixture.events, [{ id: 'single', checked: true }]);
        assert.equal(fixture.listeners.size, 0);
    } finally { fixture.close(); }
});

test('Bekar remains verified after an AU response replaces the radio DOM/widget', async () => {
    const fixture = createFramework({ rerender: true, emptyGroup: true });
    const oldRadio = fixture.dom.window.document.getElementById('single');
    try {
        const command = { action: 'selectRadio', field: 'marital', value: 'Bekar', requestId: 'rerender' };

        const result = await fixture.execute(command);
        const repeated = await fixture.execute(command);

        assert.equal(result.verified, true);
        assert.equal(oldRadio.isConnected, false);
        assert.equal(repeated.eventSent, false);
        assert.equal(fixture.events.length, 1);
    } finally { fixture.close(); }
});

test('server validation rejection is incomplete and never resends the uncertain selection', async () => {
    const fixture = createFramework({ reject: true });
    try {
        const command = { action: 'selectRadio', field: 'marital', value: 'Bekar', requestId: 'rejected' };

        const first = await fixture.execute(command);
        const second = await fixture.execute(command);

        assert.equal(first.verified, false);
        assert.equal(second.verified, false);
        assert.equal(fixture.events.length, 1);
        assert.ok(fixture.dom.window.document.querySelector('.z-errorbox'));
    } finally { fixture.close(); }
});

test('a hidden old radio group is ignored and undocumented option values are refused', async () => {
    const fixture = createFramework();
    fixture.dom.window.document.body.insertAdjacentHTML('beforeend', '<fieldset hidden><label><input type="radio">Bekar</label><label><input type="radio">Evli</label></fieldset>');
    try {
        const rejected = await fixture.execute({ action: 'selectRadio', field: 'marital', value: '1', requestId: 'invalid' });
        const valid = await fixture.execute({ action: 'selectRadio', field: 'marital', value: 'Bekar', requestId: 'visible' });

        assert.equal(rejected.verified, false);
        assert.equal(valid.verified, true);
        assert.equal(fixture.events.length, 1);
    } finally { fixture.close(); }
});

test('a fresh controller has no confirmation proof for an old checked form', async () => {
    const fixture = createFramework();
    try {
        const result = await fixture.execute({ action: 'verifyRadio', field: 'marital', value: 'Bekar', requestId: 'new-workflow' });

        assert.equal(result.verified, false);
        assert.equal(fixture.events.length, 0);
    } finally { fixture.close(); }
});

test('without a server response, checked DOM is incomplete and a retry cannot duplicate onCheck', async () => {
    const fixture = createFramework({ noResponse: true });
    try {
        const command = { action: 'selectRadio', field: 'marital', value: 'Bekar', requestId: 'response-lost' };

        const first = await fixture.execute(command);
        const second = await fixture.execute(command);

        assert.equal(first.verified, false);
        assert.equal(second.verified, false);
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.listeners.size, 0);
    } finally { fixture.close(); }
});
