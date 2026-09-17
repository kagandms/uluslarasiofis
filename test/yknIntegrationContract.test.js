import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

const [indexHtml, mainSource, navigationSource, manifestJson, metadataJson] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui/workspaceNavigation.js', import.meta.url), 'utf8'),
    readFile(new URL('../ykn_eklenti/manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../public/downloads/ykn-eklentisi.json', import.meta.url), 'utf8')
]);

test('İkamet portalında YKN çalışma alanı ve eklenti köprüsü tam kuruludur', () => {
    // 1. HTML kontrolleri
    assert.match(indexHtml, /id="view-ykn"/, 'index.html içinde view-ykn paneli bulunmalı');
    assert.match(indexHtml, /data-workspace-view="ykn"/, 'index.html içinde ykn navigasyon butonu bulunmalı');
    assert.match(indexHtml, /id="btn-read-acceptance"/, 'index.html içinde 1. Kabul Mektubu butonu bulunmalı');
    assert.match(indexHtml, /id="btn-copy"/, 'index.html içinde 2. Bilgileri Al ve Kırp butonu bulunmalı');
    assert.doesNotMatch(indexHtml, /btn-ykn-copy-letter|btn-ykn-transfer-yoksis|btn-ykn-one-click/, 'Eski 4 adımlı ve tek tık butonları kaldırılmış olmalı');
    assert.match(indexHtml, /id="passport-cropper-modal"/, 'index.html içinde pasaport vesikalık modalı bulunmalı');

    // 2. JavaScript ve Navigation kontrolleri
    assert.match(mainSource, /initYknManager/, 'main.js içinde initYknManager çağrılmalı');
    assert.match(navigationSource, /ykn:\s*['"]YKN/, 'workspaceNavigation.js içinde ykn tanımlı olmalı');

    // 3. Eklenti ve dağıtım kontrolleri
    const manifest = JSON.parse(manifestJson);
    const metadata = JSON.parse(metadataJson);

    assert.equal(manifest.version, '1.2.58', 'Eklenti sürümü 1.2.58 olmalı');
    assert.equal(metadata.version, '1.2.58', 'Dağıtım paketi sürümü 1.2.58 olmalı');
    assert.equal(metadata.fileName, 'ykn-eklentisi-v1.2.58.zip', 'Dağıtım paket dosya adı doğru olmalı');
});
