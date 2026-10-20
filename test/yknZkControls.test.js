import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { installCountryFramework } from './helpers/ykn-country-framework.js';

const source = await readFile(new URL('../ykn_eklenti-main/zk-form-controls.js', import.meta.url), 'utf8');
const fieldTargets = await readFile(new URL('../ykn_eklenti-main/yoksis-field-targets.js', import.meta.url), 'utf8');

function createFramework(options = {}) {
    const dom = new JSDOM('<div id="form"></div>', { runScripts: 'outside-only', url: 'https://yoksis.yok.gov.tr/' });
    const { window } = dom;
    const listeners = new Set();
    const events = [];
    let widgets = new Map();
    let isBusy = false;
    const pendingChecks = [];
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
                    pendingChecks.push({ name: 'onCheck', opts: { defer: true }, complete: () => {
                        if (options.rerender) mount(radio.id === 'single' ? 'Bekar' : radio.id === 'female' ? 'Kadın' : radio.id === 'male' ? 'Erkek' : 'Evli');
                        if (options.reject) {
                            group.selected = null;
                            radio.closest('fieldset')?.insertAdjacentHTML('beforeend', '<span class="z-errorbox">Validation</span>');
                        }
                        isBusy = false;
                        if (!options.noResponse) for (const listener of listeners) listener.onResponse();
                    } });
                }
            };
            widgets.set(radio, widget);
            if (radio.checked && (!options.emptyGroup || events.length > 0)) group.selected = widget;
        }
    }
    mount(options.initial || 'Bekar');
    window.zk = { Widget: { $: (radio) => widgets.get(radio) }, Desktop: { all: { current: {} } } };
    window.zAu = {
        processing: () => isBusy, getAuRequests: () => [...(options.queue || []), ...pendingChecks],
        sendNow() {
            const requests = pendingChecks.splice(0);
            if (!requests.length) return false;
            isBusy = true;
            window.queueMicrotask(() => requests.forEach(request => request.complete()));
            return true;
        }
    };
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

test('deferred ignorable window events do not block idle or the next selection', async () => {
    const queue = ['onMove', 'onZIndex'].map(name => ({ name, opts: { defer: true, ignorable: true } }));
    const fixture = createFramework({ queue });
    try {
        const idle = await fixture.execute({ action: 'waitForIdle' });
        const selection = await fixture.execute({ action: 'selectRadio', field: 'gender', value: 'Erkek', requestId: 'deferred-window' });

        assert.equal(idle.success, true);
        assert.equal(selection.verified, true);
        assert.equal(queue.length, 2);
    } finally { fixture.close(); }
});

for (const opts of [{}, { defer: true }, { ignorable: true }]) {
    test(`a queued application event remains blocking (${JSON.stringify(opts)})`, async () => {
        const queue = [{ name: 'onSelect', opts }];
        const fixture = createFramework({ queue });
        let didFinish = false;
        const drain = setTimeout(() => { assert.equal(didFinish, false); queue.length = 0; }, 70);
        try {
            const result = await fixture.execute({ action: 'waitForIdle' });
            didFinish = true;

            assert.equal(result.success, true);
        } finally { clearTimeout(drain); fixture.close(); }
    });
}

function createCountryFixture(options = {}) {
    const dom = new JSDOM('<table><tr><td>Doğum Uyruğu</td><td><select id="country"><option value=""></option><option value="tm">Türkmenistan</option><option value="uz">Özbekistan</option></select></td></tr></table>',
        { runScripts: 'outside-only', url: 'https://yoksis.yok.gov.tr/' });
    if (options.alreadyVisible) dom.window.document.querySelector('select').value = 'tm';
    const framework = installCountryFramework(dom.window, options);
    dom.window.eval(fieldTargets);
    dom.window.eval(source);
    return { ...framework, dom, execute: command => dom.window.YknZkForm.execute(command), close: () => dom.window.close() };
}

test('a visible country without a confirmed server event cannot pass verification', async () => {
    const fixture = createCountryFixture({ alreadyVisible: true });
    try {
        const response = await fixture.execute({ action: 'verifyCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'unproven' });

        assert.equal(response.verified, false);
        assert.equal(fixture.events.length, 0);
    } finally { fixture.close(); }
});

test('consecutive country transfers use fresh request proofs and preserve English aliases', async () => {
    const fixture = createCountryFixture();
    try {
        const first = await fixture.execute({ action: 'selectCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'first-country' });
        const second = await fixture.execute({ action: 'selectCountry', field: 'birthNationality', value: 'Uzbekistan', requestId: 'second-country' });
        const oldProof = await fixture.execute({ action: 'verifyCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'first-country' });

        assert.equal(first.verified, true);
        assert.equal(second.verified, true);
        assert.equal(oldProof.verified, false);
        assert.equal(fixture.serverValues.get('country'), 'uz');
        assert.equal(fixture.events.length, 2);
    } finally { fixture.close(); }
});

test('ambiguous country options are refused before any server event', async () => {
    const fixture = createCountryFixture();
    fixture.dom.window.document.querySelector('select').insertAdjacentHTML('beforeend', '<option value="duplicate">Türkmenistan</option>');
    try {
        const response = await fixture.execute({ action: 'selectCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'ambiguous-country' });

        assert.equal(response.verified, false);
        assert.equal(fixture.events.length, 0);
    } finally { fixture.close(); }
});

for (const options of [{}, { alreadyVisible: true, staleWidget: true }, { alreadyVisible: true }, { rerender: true }]) {
    test(`country transfer commits option IDs to the server and survives verification (${JSON.stringify(options)})`, async () => {
        const fixture = createCountryFixture(options);
        const command = { action: 'selectCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'country-transfer' };
        try {
            const first = await fixture.execute(command);
            const verified = await fixture.execute({ ...command, action: 'verifyCountry' });
            const repeated = await fixture.execute(command);

            assert.equal(first.verified, true);
            assert.equal(verified.verified, true);
            assert.equal(repeated.eventSent, false);
            assert.equal(fixture.serverValues.get('country'), 'tm');
            assert.equal(fixture.events.length, 1);
            assert.equal(fixture.events[0].name, 'onSelect');
            assert.equal(fixture.events[0].payload.reference, 'country-option-1');
            assert.equal(fixture.listeners.size, 0);
        } finally { fixture.close(); }
    });
}

for (const options of [{ reject: true }, { noResponse: true }]) {
    test(`country DOM cannot prove a rejected or unanswered transfer (${JSON.stringify(options)})`, async () => {
        const fixture = createCountryFixture(options);
        const command = { action: 'selectCountry', field: 'birthNationality', value: 'Türkmenistan', requestId: 'unconfirmed-country' };
        try {
            const first = await fixture.execute(command);
            const repeated = await fixture.execute(command);
            const verified = await fixture.execute({ ...command, action: 'verifyCountry' });

            assert.equal(first.verified, false);
            assert.equal(repeated.verified, false);
            assert.equal(verified.verified, false);
            assert.equal(fixture.events.length, 1);
            assert.equal(fixture.listeners.size, 0);
        } finally { fixture.close(); }
    });
}

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
