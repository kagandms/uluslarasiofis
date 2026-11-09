import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';

const source = readFileSync(new URL('../ykn_eklenti-main/zk-form-controls.js', import.meta.url), 'utf8');
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
