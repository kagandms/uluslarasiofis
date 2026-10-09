import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { rolldown } from 'rolldown';

async function loadProductionNavigation() {
    const bundle = await rolldown({ input:fileURLToPath(new URL('../src/ui/workspaceNavigation.js', import.meta.url)),
        transform:{define:{'import.meta.env':JSON.stringify({PHYSICAL_INTAKES_ENABLED:true})}} });
    try {
        const { output } = await bundle.generate({format:'esm'});
        return await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
    } finally { await bundle.close(); }
}

test('production intake entry shows Online and Physical before opening either existing workspace', async () => {
    const dom = new JSDOM(readFileSync(new URL('../yetkili/index.html',import.meta.url),'utf8'));
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis,'document');
    Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
    const navigation = await loadProductionNavigation();

    try {
        navigation.initWorkspaceNavigation();
        dom.window.document.querySelector('[data-intake-entry]').click();
        assert.equal(dom.window.document.getElementById('view-intake').hidden,false);
        assert.equal(dom.window.document.getElementById('view-applications').hidden,true);
        assert.equal(dom.window.document.getElementById('view-physical').hidden,true);

        dom.window.document.querySelector('#view-intake [data-workspace-view="applications"]').click();
        assert.equal(dom.window.document.getElementById('view-applications').hidden,false);
        assert.equal(dom.window.document.getElementById('view-intake').hidden,true);
        dom.window.document.querySelector('[data-intake-entry]').click();
        dom.window.document.querySelector('#view-intake [data-workspace-view="physical"]').click();
        assert.equal(dom.window.document.getElementById('view-physical').hidden,false);
        assert.equal(dom.window.document.getElementById('view-applications').hidden,true);
        dom.window.document.querySelector('[data-workspace-view="print"]').click();
        assert.equal(dom.window.document.getElementById('view-print').hidden,false);
        assert.equal(dom.window.document.getElementById('view-physical').hidden,true);
    } finally {
        if (previousDocument) Object.defineProperty(globalThis,'document',previousDocument);
        else delete globalThis.document;
        dom.window.close();
    }
});
