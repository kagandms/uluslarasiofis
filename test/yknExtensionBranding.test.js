import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const EXTENSION_ROOT_URL = new URL('../ykn_eklenti-main/', import.meta.url);
const MANIFEST_URL = new URL('manifest.json', EXTENSION_ROOT_URL);
const POPUP_URL = new URL('popup.html', EXTENSION_ROOT_URL);

const EXPECTED_ICON_SIZES = ['16', '32', '48', '128'];
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Verilen dosya yolunun geçerli bir PNG başlık imzasına sahip olup olmadığını kontrol eder.
 * @param {URL} fileUrl
 * @returns {boolean}
 */
function hasPngSignature(fileUrl) {
    const buffer = readFileSync(fileUrl);
    if (buffer.length < PNG_MAGIC_BYTES.length) {
        return false;
    }
    return PNG_MAGIC_BYTES.every((byte, index) => buffer[index] === byte);
}

test('manifest.json defines school logo icons and action.default_icon pointing to valid PNG files', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));

    assert.ok(manifest.icons, 'manifest.icons tanımlı olmalı');
    assert.ok(manifest.action?.default_icon, 'manifest.action.default_icon tanımlı olmalı');
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.equal(manifest.action.default_title, 'YÖKSİS Otomasyonu');

    for (const size of EXPECTED_ICON_SIZES) {
        const iconPath = manifest.icons[size];
        const defaultIconPath = manifest.action.default_icon[size];

        assert.equal(typeof iconPath, 'string', `icons[${size}] metin olmalı`);
        assert.equal(defaultIconPath, iconPath, `action.default_icon[${size}] icons[${size}] ile eşleşmeli`);

        const resolvedIconUrl = new URL(iconPath, EXTENSION_ROOT_URL);
        assert.equal(existsSync(resolvedIconUrl), true, `İkon dosyası diskte bulunmalı: ${iconPath}`);
        assert.equal(hasPngSignature(resolvedIconUrl), true, `İkon dosyası geçerli PNG olmalı: ${iconPath}`);
    }
});

test('popup.html uses school bordeaux and white branding without legacy blue button colours', () => {
    const popupHtml = readFileSync(POPUP_URL, 'utf8');

    assert.match(popupHtml, /#7e1830/i, 'Okul ana bordo rengi (#7e1830) popup.html içinde yer almalı');
    assert.match(popupHtml, /#5a0e27/i, 'Okul koyu bordo hover rengi (#5a0e27) popup.html içinde yer almalı');
    assert.match(popupHtml, /accent-color:\s*#7e1830/i, 'Onay kutusu vurgu rengi bordo olmalı');
    assert.match(popupHtml, /width:\s*320px/i, 'Popup genişliği 320px olarak korunmalı');

    assert.doesNotMatch(popupHtml, /#0056b3/i, 'Eski mavi buton rengi (#0056b3) kaldırılmış olmalı');
    assert.doesNotMatch(popupHtml, /#004494/i, 'Eski mavi hover rengi (#004494) kaldırılmış olmalı');
});

test('popup.html preserves required element ids and status colours', () => {
    const popupHtml = readFileSync(POPUP_URL, 'utf8');

    for (const elementId of [
        'btn-read-acceptance',
        'btn-copy',
        'chk-yoksis-side-by-side',
        'status-message'
    ]) {
        assert.ok(popupHtml.includes(`id="${elementId}"`), `Gerekli öğe kimliği korunmalı: ${elementId}`);
    }

    assert.match(popupHtml, /#176b3a/i, 'Varsayılan durum rengi (yeşil) korunmalı');
    assert.match(popupHtml, /#a82424/i, 'Hata durum rengi (kırmızı) korunmalı');
    assert.match(popupHtml, /#8a5a00/i, 'Uyarı durum rengi (amber) korunmalı');
});
