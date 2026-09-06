import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(testDirectory, '../../ykn_eklenti-main');
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
    assert.match(manager, /Pasaport belgesi henüz alınmadı/);
    assert.match(manager, /Kabul mektubu PDF bağlantısı bulunamadı/);
});

test('YKN bridge preserves request correlation IDs', { skip: !hasLocalExtensionCheckout }, async () => {
    const bridge = await readExtensionFile('bridge.js');

    assert.match(bridge, /requestId: payload\.requestId/);
    assert.match(bridge, /requestId: request\.requestId/);
});

test('portal accepts document discovery results without treating profile discovery as complete', async () => {
    const manager = await readFile(resolve(testDirectory, '../src/managers/yknManager.js'), 'utf8');

    assert.match(manager, /STUDENT_DOCUMENTS_FOUND/);
    assert.match(manager, /documentsReady: true/);
    assert.match(manager, /DOCUMENTS_NOT_FOUND/);
    assert.match(manager, /DOCUMENT_BYTES_READY/);
    assert.match(manager, /extractYoksisIdFromText/);
});
