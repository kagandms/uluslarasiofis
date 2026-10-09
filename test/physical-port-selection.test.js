import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

async function loadMerger() {
    const bundle = await rolldown({ platform:'browser', input:fileURLToPath(new URL('../src/ui/pdfMergerModal.js', import.meta.url)),
        plugins:[{ name:'test-css', resolveId:source => source.endsWith('.css') ? 'virtual:css' : null,
            load:id => id === 'virtual:css' ? 'export default ""' : null }] });
    try {
        const {output} = await bundle.generate({format:'esm'});
        const directory = mkdtempSync(join(tmpdir(),'physical-modal-test-'));
        const modulePath = join(directory,'modal.mjs');
        try { writeFileSync(modulePath,output[0].code); return await import(pathToFileURL(modulePath).href); }
        finally { rmSync(directory,{recursive:true}); }
    } finally { await bundle.close(); }
}

test('PC file and camera selection append documents and expose the separate phone transfer control', async () => {
    const dom = new JSDOM('<body></body>',{pretendToBeVisual:true});
    const originals = new Map();
    for (const [key,value] of Object.entries({document:dom.window.document,window:dom.window,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window)})) {
        originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
        Object.defineProperty(globalThis,key,{configurable:true,value});
    }
    const merger = await loadMerger();

    try {
        merger.openPdfMergerModal();
        const camera = dom.window.document.querySelector('input[capture="environment"]');
        const files = [...dom.window.document.querySelectorAll('input[type="file"]')].find(input=>input!==camera);
        Object.defineProperty(files,'files',{value:[new File(['synthetic'],'pc.pdf',{type:'application/pdf'})]});
        files.dispatchEvent(new dom.window.Event('change'));
        Object.defineProperty(camera,'files',{value:[new File(['synthetic'],'phone.jpg',{type:'image/jpeg'})]});
        camera.dispatchEvent(new dom.window.Event('change'));

        assert.ok(dom.window.document.body.textContent.includes('Eklenen Belgeler: 2 / 30'));
        assert.ok(dom.window.document.body.textContent.includes('pc.pdf'));
        assert.ok(dom.window.document.body.textContent.includes('Foto_2.jpg'));
        assert.ok(dom.window.document.body.textContent.includes('Telefondan ekle (QR)'));
        assert.equal(camera.getAttribute('accept'),'image/*');
        assert.equal(files.multiple,true);
    } finally {
        dom.window.document.getElementById('pdf-merger-modal-overlay')?.remove();
        await Promise.resolve();
        for (const [key,descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis,key,descriptor);
            else delete globalThis[key];
        }
        dom.window.close();
    }
});

test('phone camera and multi-photo gallery inputs are both available on the pairing page', () => {
    const dom = new JSDOM(readFileSync(new URL('../mobile-transfer/index.html',import.meta.url),'utf8'));

    const camera = dom.window.document.getElementById('camera');
    const gallery = dom.window.document.getElementById('gallery');

    assert.equal(camera.getAttribute('capture'),'environment');
    assert.equal(camera.getAttribute('accept'),'image/*');
    assert.equal(gallery.multiple,true);
    assert.equal(gallery.getAttribute('accept'),'image/*');
    assert.equal(dom.window.document.querySelector('meta[name="referrer"]').content,'no-referrer');
    dom.window.close();
});
