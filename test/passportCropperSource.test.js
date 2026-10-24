import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

function installGlobal(context, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    });
}

async function createCropperHarness(context) {
    const dom = new JSDOM('<div id="passport-cropper-modal"><img id="passport-cropper-image"></div><div id="passport-source-selector"><select id="passport-source-select"></select></div>', {
        url: 'https://portal.test'
    });
    context.after(() => dom.window.close());
    dom.window.Cropper = class {
        destroy() {}
    };
    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    const cropper = await import(`../src/ui/passportCropperModal.js?test=${Date.now()}`);
    return { cropper, document: dom.window.document };
}

test('photo source selector stays visible when Apply has no alternative files', async context => {
    const { cropper, document } = await createCropperHarness(context);

    cropper.openPassportCropper({ imageSrc: 'data:image/jpeg;base64,AA==' });

    assert.equal(document.getElementById('passport-source-selector').style.display, 'block');
    assert.equal(document.getElementById('passport-source-select').disabled, true);
    assert.match(document.getElementById('passport-source-select').selectedOptions[0].textContent, /başka belge bulunamadı/i);
});

test('photo source selector stays visible and selectable when multiple files exist', async context => {
    const { cropper, document } = await createCropperHarness(context);

    cropper.openPassportCropper({
        pages: [{ dataUrl: 'data:image/jpeg;base64,AA==' }],
        sources: [
            { url: '/photo.jpg', label: 'Fotoğraf', type: 'photo' },
            { url: '/passport.pdf', label: 'Pasaport', type: 'passport' }
        ],
        selectedSourceUrl: '/photo.jpg'
    });

    assert.equal(document.getElementById('passport-source-selector').style.display, 'block');
    assert.equal(document.getElementById('passport-source-select').disabled, false);
    assert.equal(document.getElementById('passport-source-select').options.length, 2);
    assert.equal(document.getElementById('passport-source-select').value, '/photo.jpg');
});
