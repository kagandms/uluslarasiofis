import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';

const source = readFileSync(new URL('../ykn_eklenti-main/zk-form-controls.js', import.meta.url), 'utf8');
const queryFormFixture = readFileSync(new URL('./fixtures/gocnet-transfer/query-form.html', import.meta.url), 'utf8');
const applicationNumber = '2099-01-0000001';

function createHarness() {
    const dom = new JSDOM(`<section>
        <h2>Kayıtlı İkamet İşlemleri Listesi (Veritabanı Geçmişi &amp; Takip)</h2>
        <input data-widget="number" placeholder="Tüm veya kısmi no...">
        <input placeholder="Öğrenci no...">
        <select data-widget="process"><option value="" selected>-- Tümü --</option><option value="completed">Tamamlandı</option></select>
        <button class="z-button" data-widget="list">🔎 Kayıtları Listele</button>
        <div class="z-listbox"><div class="z-listbox-header"><table><thead><tr><th>E-İkamet Başvuru No</th><th>Öğrenci No</th><th>GöçNet Kayıt No</th></tr></thead></table></div>
            <div class="z-listbox-body"><table><tbody><tr class="z-listitem"><td>${applicationNumber}</td><td>masked</td><td>1</td></tr></tbody></table></div>
        </div>
    </section>`, { runScripts: 'outside-only' });
    const { window } = dom;
    const observers = new Set();
    let filterEvents = 0;
    let listQueries = 0;
    const widgetFor = (element) => {
        const kind = element?.getAttribute?.('data-widget');
        if (kind === 'number') return {
            value: '', setValue(value) { element.value = value; this.value = value; },
            getValue() { return this.value; }, fire(name) { if (name === 'onChange') { filterEvents += 1; for (const watcher of observers) watcher.onResponse(); } }
        };
        if (kind === 'process') return { setValue() {}, fire() {} };
        if (kind === 'list') return { fire(name) { if (name === 'onClick') { listQueries += 1; for (const watcher of observers) watcher.onResponse(); } } };
        return null;
    };
    window.zk = { Widget: { $: widgetFor }, Desktop: { all: {} } };
    window.zAu = { processing: () => false, getAuRequests: () => [] };
    window.zWatch = {
        listen({ onResponse }) { observers.add(onResponse); },
        unlisten({ onResponse }) { observers.delete(onResponse); }
    };
    vm.runInContext(source, dom.getInternalVMContext());
    return { dom, filterEvents: () => filterEvents, listQueries: () => listQueries, observerCount: () => observers.size };
}

test('GöçNet history query synchronizes the exact filter and waits for both fresh ZK responses', async () => {
    const harness = createHarness();
    const result = await harness.dom.window.YknZkForm.execute({ action: 'queryGocnetRecords', applicationNumber, requestId: 'history-test' });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, freshResponse: true });
    assert.equal(harness.dom.window.document.querySelector('[placeholder="Tüm veya kısmi no..."]').value, applicationNumber);
    assert.equal(harness.filterEvents(), 1);
    assert.equal(harness.listQueries(), 1);
    assert.equal(harness.observerCount(), 0);
    harness.dom.window.close();
});

test('GöçNet history query refuses restricted filters and malformed identifiers without clicking list', async () => {
    const harness = createHarness();
    harness.dom.window.document.querySelector('[placeholder="Öğrenci no..."]').value = 'restricted';
    const result = await harness.dom.window.YknZkForm.execute({ action: 'queryGocnetRecords', applicationNumber, requestId: 'history-test' });
    assert.equal(result.success, false);
    assert.equal(harness.listQueries(), 0);
    const malformed = await harness.dom.window.YknZkForm.execute({ action: 'queryGocnetRecords', applicationNumber: 'bad', requestId: 'history-test' });
    assert.equal(malformed.success, false);
    harness.dom.window.close();
});

test('GöçNet history query accepts the real YÖKSİS "Tümü" option whose value is its label', async () => {
    const harness = createHarness();
    const select = harness.dom.window.document.querySelector('select');
    select.innerHTML = '<option selected>-- Tümü --</option><option>Tamamlandı</option>';
    assert.equal(select.value, '-- Tümü --');
    const result = await harness.dom.window.YknZkForm.execute({ action: 'queryGocnetRecords', applicationNumber, requestId: 'history-test' });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, freshResponse: true });
    assert.equal(harness.listQueries(), 1);
    harness.dom.window.close();
});

function createFormHarness({
    html = `<section>
        <h2>1. E-İkamet Başvuru Sorgulama</h2>
        <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
        <button class="z-button" data-widget="form-query">🔍 Başvuru Sorgula</button>
    </section>`,
    retainValue = true,
    hasInputWidget = true,
    hasButtonWidget = true,
    respondOnChange = true,
    respondOnClick = true
} = {}) {
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const { window } = dom;
    const observers = new Set();
    const calls = [];
    const triggerResponse = () => {
        for (const watcher of [...observers]) watcher.onResponse();
    };
    const widgetFor = (element) => {
        const kind = element?.getAttribute?.('data-widget');
        if (kind === 'form-number' && hasInputWidget) {
            return {
                value: '',
                setValue(value) {
                    calls.push(['input.setValue', value]);
                    if (retainValue) {
                        element.value = value;
                        this.value = value;
                    }
                },
                getValue() { return this.value; },
                fire(name, data, opts) {
                    calls.push(['input.fire', name, data, opts]);
                    if (name === 'onChange' && respondOnChange) {
                        triggerResponse();
                    }
                }
            };
        }
        if (kind === 'form-query' && hasButtonWidget) {
            return {
                fire(name, data, opts) {
                    calls.push(['button.fire', name, data, opts]);
                    if (name === 'onClick' && respondOnClick) {
                        triggerResponse();
                    }
                }
            };
        }
        return null;
    };
    window.zk = { Widget: { $: widgetFor }, Desktop: { all: {} } };
    window.zAu = { processing: () => false, getAuRequests: () => [] };
    window.zWatch = {
        listen({ onResponse }) { observers.add(onResponse); },
        unlisten({ onResponse }) { observers.delete(onResponse); }
    };
    vm.runInContext(source, dom.getInternalVMContext());
    return { dom, calls, triggerResponse, observerCount: () => observers.size };
}

function installFakeClock(window) {
    let now = 1_000_000;
    let nextId = 1;
    const intervals = new Map();
    const originalDateNow = window.Date.now;
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    window.Date.now = () => now;
    window.setInterval = (callback, delay = 25) => {
        const id = nextId++;
        const step = Math.max(1, Number(delay) || 25);
        intervals.set(id, { callback, delay: step, nextRun: now + step });
        return id;
    };
    window.clearInterval = (id) => {
        intervals.delete(id);
    };
    const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
    const tickTo = async (targetNow) => {
        while (true) {
            let earliest = null;
            for (const entry of intervals.values()) {
                if (entry.nextRun <= targetNow && (!earliest || entry.nextRun < earliest.nextRun)) {
                    earliest = entry;
                }
            }
            if (!earliest) break;
            now = earliest.nextRun;
            earliest.nextRun = now + earliest.delay;
            earliest.callback();
            await flushMicrotasks();
        }
        now = Math.max(now, targetNow);
    };
    return {
        advanceBy: (ms) => tickTo(now + ms),
        activeIntervals: () => intervals.size,
        restore() {
            window.Date.now = originalDateNow;
            window.setInterval = originalSetInterval;
            window.clearInterval = originalClearInterval;
        }
    };
}

test('queryGocnetForm sets the value via ZK widget, fires onChange then onClick toServer, and returns freshResponse true', async () => {
    const harness = createFormHarness();
    const result = await harness.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-test-1'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, freshResponse: true });
    assert.equal(harness.dom.window.document.querySelector('[data-widget="form-number"]').value, applicationNumber);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.calls)), [
        ['input.setValue', applicationNumber],
        ['input.fire', 'onChange', { value: applicationNumber }, { toServer: true }],
        ['button.fire', 'onClick', null, { toServer: true }]
    ]);
    assert.equal(harness.observerCount(), 0);
    harness.dom.window.close();
});

test('queryGocnetForm reports reason-coded errors for missing, ambiguous, or disabled controls and open dialogs', async () => {
    const missingInput = createFormHarness({
        html: `<section><h2>1. E-İkamet Başvuru Sorgulama</h2><button class="z-button" data-widget="form-query">Başvuru Sorgula</button></section>`
    });
    const missingResult = await missingInput.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-missing'
    });
    assert.equal(missingResult.success, false);
    assert.match(missingResult.error, /^form_controls_missing \(inputs: 0, buttons: 1\)/);
    missingInput.dom.window.close();

    const twoInputsSameScope = createFormHarness({
        html: `<section>
            <h2>1. E-İkamet Başvuru Sorgulama</h2>
            <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
            <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
            <button class="z-button" data-widget="form-query">Başvuru Sorgula</button>
        </section>`
    });
    const twoInputsResult = await twoInputsSameScope.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-two-inputs'
    });
    assert.equal(twoInputsResult.success, false);
    assert.match(twoInputsResult.error, /^form_controls_missing \(inputs: 2, buttons: 1\)/);
    assert.equal(twoInputsSameScope.calls.length, 0);
    twoInputsSameScope.dom.window.close();

    const ambiguous = createFormHarness({
        html: `<main>
            <section>
                <h2>1. E-İkamet Başvuru Sorgulama</h2>
                <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
                <button class="z-button" data-widget="form-query">Başvuru Sorgula</button>
            </section>
            <section>
                <h2>1. E-İkamet Başvuru Sorgulama</h2>
                <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
                <button class="z-button" data-widget="form-query">Başvuru Sorgula</button>
            </section>
        </main>`
    });
    const ambiguousResult = await ambiguous.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-ambiguous'
    });
    assert.equal(ambiguousResult.success, false);
    assert.match(ambiguousResult.error, /^form_controls_ambiguous \(targets: 2\)/);
    assert.equal(ambiguous.calls.length, 0);
    ambiguous.dom.window.close();

    const disabled = createFormHarness();
    disabled.dom.window.document.querySelector('[data-widget="form-query"]').disabled = true;
    const disabledResult = await disabled.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-disabled'
    });
    assert.equal(disabledResult.success, false);
    assert.equal(disabledResult.error, 'form_controls_disabled');
    assert.equal(disabled.calls.length, 0);
    disabled.dom.window.close();

    const openDialog = createFormHarness({
        html: `<main>
            <section><h2>1. E-İkamet Başvuru Sorgulama</h2><label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label><button class="z-button" data-widget="form-query">Başvuru Sorgula</button></section>
            <div role="dialog"><h2>Açık Pencere</h2></div>
        </main>`
    });
    const dialogResult = await openDialog.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-dialog'
    });
    assert.equal(dialogResult.success, false);
    assert.equal(dialogResult.error, 'form_dialog_already_open');
    openDialog.dom.window.close();
});

test('queryGocnetForm reports form_zk_widget_missing and form_value_not_retained without clicking query', async () => {
    const missingWidget = createFormHarness({ hasButtonWidget: false });
    const widgetResult = await missingWidget.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-no-widget'
    });
    assert.equal(widgetResult.success, false);
    assert.equal(widgetResult.error, 'form_zk_widget_missing');
    assert.equal(missingWidget.calls.length, 0);
    missingWidget.dom.window.close();

    const notRetained = createFormHarness({ retainValue: false });
    const retainedResult = await notRetained.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-not-retained'
    });
    assert.equal(retainedResult.success, false);
    assert.equal(retainedResult.error, 'form_value_not_retained');
    assert.equal(notRetained.calls.some(([entry]) => entry === 'button.fire'), false);
    notRetained.dom.window.close();
});

test('queryGocnetForm finds the single target inside query-form.html and nested ZK groupboxes with unrelated inputs', async () => {
    const fixtureHarness = createFormHarness({ html: queryFormFixture });
    fixtureHarness.dom.window.document.querySelector('section input').setAttribute('data-widget', 'form-number');
    fixtureHarness.dom.window.document.querySelector('section button').setAttribute('data-widget', 'form-query');
    const fixtureResult = await fixtureHarness.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-rich-fixture'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(fixtureResult)), { success: true, freshResponse: true });
    assert.equal(fixtureHarness.dom.window.document.querySelector('section input').value, applicationNumber);
    assert.equal(fixtureHarness.dom.window.document.querySelector('input[placeholder="5XXXXXXXXX"]').value, '');
    fixtureHarness.dom.window.close();

    const nestedZkHarness = createFormHarness({
        html: `<div class="z-window">
            <div class="z-window-cnt">
                <div class="z-groupbox">
                    <div class="z-groupbox-header"><div class="z-caption">1. E-İkamet Başvuru Sorgulama</div></div>
                    <div class="z-groupbox-cnt">
                        <table><tbody><tr>
                            <td><span>E-İkamet Başvuru No:</span></td>
                            <td><input type="text" data-widget="form-number"></td>
                            <td><span class="z-button" data-widget="form-query"><button type="button">🔍 Başvuru Sorgula</button></span></td>
                        </tr></tbody></table>
                    </div>
                </div>
                <div class="z-groupbox">
                    <div class="z-groupbox-header"><div class="z-caption">2. Öğrenci Bilgileri</div></div>
                    <div class="z-groupbox-cnt">
                        <label>Öğrenci No: <input type="text"></label>
                        <label>Telefon: <input type="text" placeholder="5XXXXXXXXX"></label>
                    </div>
                </div>
            </div>
        </div>`
    });
    const nestedResult = await nestedZkHarness.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-nested-zk'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(nestedResult)), { success: true, freshResponse: true });
    assert.deepEqual(JSON.parse(JSON.stringify(nestedZkHarness.calls)), [
        ['input.setValue', applicationNumber],
        ['input.fire', 'onChange', { value: applicationNumber }, { toServer: true }],
        ['button.fire', 'onClick', null, { toServer: true }]
    ]);
    nestedZkHarness.dom.window.close();
});

test('queryGocnetForm fails with form_controls_ambiguous when two separate Başvuru Sorgula blocks exist', async () => {
    const duplicateHarness = createFormHarness({
        html: `<main>
            <div class="z-groupbox">
                <div class="z-groupbox-header"><div class="z-caption">1. E-İkamet Başvuru Sorgulama</div></div>
                <div class="z-groupbox-cnt">
                    <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
                    <button class="z-button" data-widget="form-query">Başvuru Sorgula</button>
                </div>
            </div>
            <div class="z-groupbox">
                <div class="z-groupbox-header"><div class="z-caption">1. E-İkamet Başvuru Sorgulama</div></div>
                <div class="z-groupbox-cnt">
                    <label>E-İkamet Başvuru No: <input type="text" data-widget="form-number"></label>
                    <button class="z-button" data-widget="form-query">Başvuru Sorgula</button>
                </div>
            </div>
        </main>`
    });
    const result = await duplicateHarness.dom.window.YknZkForm.execute({
        action: 'queryGocnetForm', applicationNumber, requestId: 'form-two-blocks'
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'form_controls_ambiguous (targets: 2)');
    assert.equal(duplicateHarness.calls.length, 0);
    duplicateHarness.dom.window.close();
});

test('queryGocnetForm rejects with form_value_no_response at 30 s without clicking query', async () => {
    const harness = createFormHarness({ respondOnChange: false, respondOnClick: false });
    const clock = installFakeClock(harness.dom.window);
    try {
        let settled = false;
        const promise = harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetForm', applicationNumber, requestId: 'form-val-timeout'
        }).then((value) => {
            settled = true;
            return value;
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(clock.activeIntervals(), 1);
        await clock.advanceBy(29_975);
        assert.equal(settled, false);
        await clock.advanceBy(25);
        assert.equal(settled, true);
        const result = await promise;
        assert.equal(result.success, false);
        assert.equal(result.error, 'form_value_no_response');
        assert.equal(harness.calls.some(([entry]) => entry === 'button.fire'), false);
        assert.equal(clock.activeIntervals(), 0);
        assert.equal(harness.observerCount(), 0);
    } finally {
        clock.restore();
        harness.dom.window.close();
    }
});

test('queryGocnetForm succeeds when click response arrives after 30 s and before 110 s', async () => {
    const harness = createFormHarness({ respondOnChange: true, respondOnClick: false });
    const clock = installFakeClock(harness.dom.window);
    try {
        let settled = false;
        const promise = harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetForm', applicationNumber, requestId: 'form-click-slow-ok'
        }).then((value) => {
            settled = true;
            return value;
        });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(harness.calls.some(([entry]) => entry === 'button.fire'), true);
        await clock.advanceBy(35_000);
        assert.equal(settled, false);
        harness.triggerResponse();
        await clock.advanceBy(25);
        const result = await promise;
        assert.equal(settled, true);
        assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, freshResponse: true });
        assert.equal(clock.activeIntervals(), 0);
        assert.equal(harness.observerCount(), 0);
    } finally {
        clock.restore();
        harness.dom.window.close();
    }
});

test('queryGocnetForm succeeds as soon as a visible dialog appears after click without ZK onResponse', async () => {
    const harness = createFormHarness({ respondOnChange: true, respondOnClick: false });
    const clock = installFakeClock(harness.dom.window);
    try {
        let settled = false;
        const promise = harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetForm', applicationNumber, requestId: 'form-click-dialog-ok'
        }).then((value) => {
            settled = true;
            return value;
        });
        await new Promise((resolve) => setImmediate(resolve));
        await clock.advanceBy(10_000);
        assert.equal(settled, false);
        harness.dom.window.document.body.insertAdjacentHTML('beforeend', '<div class="z-window-modal" style="display: none"><h2>Gizli</h2></div>');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(settled, false);
        harness.dom.window.document.querySelector('.z-window-modal').style.display = 'block';
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(settled, true);
        const result = await promise;
        assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, freshResponse: true });
        assert.equal(clock.activeIntervals(), 0);
        assert.equal(harness.observerCount(), 0);
    } finally {
        clock.restore();
        harness.dom.window.close();
    }
});

test('queryGocnetForm rejects with form_click_no_response at 110 s when neither response nor dialog arrives', async () => {
    const harness = createFormHarness({ respondOnChange: true, respondOnClick: false });
    const clock = installFakeClock(harness.dom.window);
    try {
        let settled = false;
        const promise = harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetForm', applicationNumber, requestId: 'form-click-timeout'
        }).then((value) => {
            settled = true;
            return value;
        });
        await new Promise((resolve) => setImmediate(resolve));
        await clock.advanceBy(109_975);
        assert.equal(settled, false);
        await clock.advanceBy(25);
        assert.equal(settled, true);
        const result = await promise;
        assert.equal(result.success, false);
        assert.equal(result.error, 'form_click_no_response');
        assert.equal(clock.activeIntervals(), 0);
        assert.equal(harness.observerCount(), 0);
    } finally {
        clock.restore();
        harness.dom.window.close();
    }
});
