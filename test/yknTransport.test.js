import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(testDirectory, '../ykn_eklenti-main');
const hasLocalExtensionCheckout = existsSync(extensionDirectory);

async function readExtensionFile(fileName) {
    return readFile(resolve(extensionDirectory, fileName), 'utf8');
}

test('YKN extension uses a readiness handshake before Apply search', { skip: !hasLocalExtensionCheckout }, async () => {
    const background = await readExtensionFile('background.js');
    const content = await readExtensionFile('content.js');

    assert.match(background, /waitForContentScript/);
    assert.match(background, /action: 'PING'/);
    assert.match(background, /requestId: request\.requestId/);
    assert.match(content, /request\.action === 'PING'/);
    assert.match(content, /requestId = request\.requestId/);
    assert.match(content, /findDocumentLinks/);
    assert.match(content, /DISCOVER_STUDENT_DOCUMENTS/);
    assert.match(content, /FETCH_APPLY_DOCUMENT/);
    assert.match(background, /chrome\.tabs\.onUpdated/);
    assert.match(background, /READ_APPLY_DOCUMENT/);
});

test('YKN transport does not return fabricated document links', { skip: !hasLocalExtensionCheckout }, async () => {
    const content = await readExtensionFile('content.js');
    const manager = await readFile(resolve(testDirectory, '../src/managers/yknManager.js'), 'utf8');

    assert.doesNotMatch(content, /test_passport|test_letter/);
    assert.match(manager, /passportDocumentUrl/);
    assert.match(manager, /acceptanceLetterUrl/);
});

test('YKN bridge preserves request correlation IDs', { skip: !hasLocalExtensionCheckout }, async () => {
    const bridge = await readExtensionFile('bridge.js');

    assert.match(bridge, /requestId: payload\.requestId/);
    assert.match(bridge, /requestId: request\.requestId/);
});

test('YKN one-click workflow keeps the required ordered transport stages', { skip: !hasLocalExtensionCheckout }, async () => {
    const manager = await readFile(resolve(testDirectory, '../src/managers/yknManager.js'), 'utf8');
    const background = await readExtensionFile('background.js');
    const content = await readExtensionFile('content.js');

    assert.match(manager, /id="btn-ykn-one-click"|btn-ykn-one-click/);
    assert.match(manager, /ONE_CLICK_STAGE/);
    assert.match(manager, /EXTRACT_KABUL_CODE/);
    assert.match(manager, /TRANSFER_TO_YOKSIS/);
    assert.match(manager, /COPY_APPLY_DATA/);
    assert.match(manager, /FILL_YOKSIS_FORM/);
    assert.match(background, /WAIT_YOKSIS_FORM/);
    assert.match(content, /photoUploaded/);
    assert.match(content, /uploadPhotoToYoksis\(data\.croppedPhotoBase64/);
});

test('YKN one-click waits for crop confirmation before final YÖKSİS fill', { skip: !hasLocalExtensionCheckout }, async () => {
    const manager = await readFile(resolve(testDirectory, '../src/managers/yknManager.js'), 'utf8');
    const startIndex = manager.indexOf('function startOneClickPassportRead()');
    const cropperIndex = manager.indexOf('if (currentStudentData?.passportImageSrc)', startIndex);
    const nextFunctionIndex = manager.indexOf('\n    function ', cropperIndex + 1);
    const cropperBranch = manager.slice(cropperIndex, nextFunctionIndex === -1 ? manager.length : nextFunctionIndex);

    assert.ok(startIndex >= 0, 'one-click passport read should exist');
    assert.match(cropperBranch, /openOneClickCropper\(\)/);
    assert.doesNotMatch(cropperBranch, /postOneClickMessage\(['"]FILL_YOKSIS_FORM/);
    assert.match(manager, /isOneClickActive\(ONE_CLICK_STAGE\.CROPPER_WAITING\)/);
    assert.match(manager, /postOneClickMessage\(['"]FILL_YOKSIS_FORM['"], \{ data: currentStudentData \}\)/);
    assert.match(manager, /isOneClickActive\(ONE_CLICK_STAGE\.PASSPORT_READING\)/);
    assert.match(manager, /shouldOpenCropperWhenReady = true/);
});

test('portal accepts document discovery results without treating profile discovery as complete', async () => {
    const manager = await readFile(resolve(testDirectory, '../src/managers/yknManager.js'), 'utf8');

    assert.match(manager, /STUDENT_DOCUMENTS_FOUND/);
    assert.match(manager, /documentsReady: true/);
    assert.match(manager, /DOCUMENTS_NOT_FOUND/);
    assert.match(manager, /DOCUMENT_BYTES_READY/);
    assert.match(manager, /extractYoksisIdFromText/);
});
