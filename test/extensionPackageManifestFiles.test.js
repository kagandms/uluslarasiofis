import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import {
    assertExtensionFilesExist,
    assertManifestReferencesPackaged,
    extensionFiles,
    findMissingManifestReferences,
    packageExtension,
    readExtensionManifest
} from '../scripts/package-extension.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(projectRoot, 'ykn_eklenti-main');
// Test için üretilen ZIP arşivinin merkez dizininden dosya adlarını ve açılmış baytlarını okur.
function readZipEntries(zipBuffer) {
    let eocdOffset = -1;
    const minOffset = Math.max(0, zipBuffer.length - 65557);
    for (let offset = zipBuffer.length - 22; offset >= minOffset; offset -= 1) {
        if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
            eocdOffset = offset;
            break;
        }
    }
    assert.ok(eocdOffset >= 0, 'ZIP EOCD imzası bulunamadı');

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    const entries = new Map();
    let cursor = centralDirOffset;

    for (let index = 0; index < totalEntries; index += 1) {
        assert.equal(zipBuffer.readUInt32LE(cursor), 0x02014b50, 'Geçersiz ZIP central header imzası');
        const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
        const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
        const fileNameLength = zipBuffer.readUInt16LE(cursor + 28);
        const extraLength = zipBuffer.readUInt16LE(cursor + 30);
        const commentLength = zipBuffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);
        const entryName = zipBuffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLength);
        cursor += 46 + fileNameLength + extraLength + commentLength;

        if (entryName.endsWith('/')) {
            entries.set(entryName, null);
            continue;
        }

        assert.equal(zipBuffer.readUInt32LE(localHeaderOffset), 0x04034b50, 'Geçersiz ZIP local header imzası');
        const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressedSlice = zipBuffer.subarray(dataStart, dataStart + compressedSize);
        const content = compressionMethod === 8 ? inflateRawSync(compressedSlice) : compressedSlice;
        assert.equal(content.length, uncompressedSize, `${entryName} açılmış boyutu eşleşmiyor`);
        entries.set(entryName, content);
    }

    return entries;
}

test('manifest.json içindeki tüm referanslar extensionFiles listesinde bulunur', () => {
    const manifest = readExtensionManifest();
    assert.deepEqual(findMissingManifestReferences(manifest, extensionFiles), []);
    assert.doesNotThrow(() => assertManifestReferencesPackaged(manifest, extensionFiles));
    assert.doesNotThrow(() => assertExtensionFilesExist(extensionFiles));
});

test('findMissingManifestReferences tüm manifest alanlarındaki eksik referansları yakalar', () => {
    const syntheticManifest = {
        icons: {
            16: 'icons/icon-16.png',
            256: 'icons/missing-icon.png'
        },
        action: {
            default_icon: {
                16: 'icons/icon-16.png',
                64: 'icons/missing-icon.png'
            },
            default_popup: 'missing-popup.html'
        },
        background: {
            service_worker: 'missing-worker.js'
        },
        content_scripts: [
            {
                js: ['content.js', 'missing-content.js'],
                css: ['missing-style.css']
            }
        ],
        web_accessible_resources: [
            {
                resources: ['pdf.worker.min.js', 'missing-resource.wasm']
            }
        ]
    };

    const missingFiles = findMissingManifestReferences(syntheticManifest, extensionFiles);
    assert.deepEqual(missingFiles, [
        'icons/icon-16.png',
        'icons/missing-icon.png',
        'missing-popup.html',
        'missing-worker.js',
        'missing-content.js',
        'missing-style.css',
        'missing-resource.wasm'
    ]);

    const stringDefaultIconManifest = {
        action: {
            default_icon: 'icons/string-missing.png'
        }
    };
    assert.deepEqual(
        findMissingManifestReferences(stringDefaultIconManifest, extensionFiles),
        ['icons/string-missing.png']
    );
});

test('assertManifestReferencesPackaged eksik dosya olduğunda dosya adını içeren Türkçe hata fırlatır', () => {
    const manifest = readExtensionManifest();
    const brokenManifest = {
        ...manifest,
        icons: {
            ...manifest.icons,
            512: 'icons/icon-512.png'
        }
    };

    assert.throws(
        () => assertManifestReferencesPackaged(brokenManifest, extensionFiles),
        (error) => error instanceof Error
            && error.message.includes('eksik')
            && error.message.includes('icons/icon-512.png')
    );
});

test('packageExtension geçici dizinde tüm paket dosyalarını ZIP arşivine yazar', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ykn-extension-package-'));
    try {
        const result = packageExtension({ outputDir: tempDir, silent: true });
        const archiveBuffer = readFileSync(result.archivePath);
        const latestBuffer = readFileSync(join(tempDir, 'ykn-eklentisi-latest.zip'));
        assert.equal(Buffer.compare(archiveBuffer, latestBuffer), 0);

        const entries = readZipEntries(archiveBuffer);
        assert.ok(entries.has('ykn_eklenti/'));

        for (const fileName of extensionFiles) {
            assert.ok(entries.has(`ykn_eklenti/${fileName}`), `ZIP içinde ykn_eklenti/${fileName} bulunmalı`);
        }
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});
