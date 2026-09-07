import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(projectRoot, 'ykn_eklenti-main');
const downloadsRoot = join(projectRoot, 'public', 'downloads');
const extensionFiles = [
    'manifest.json',
    'background.js',
    'bridge.js',
    'content.js',
    'popup.html',
    'popup.js'
];

function readExtensionManifest() {
    const manifestPath = join(extensionRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        throw new Error('YKN eklentisi manifest.json sürümü geçerli değil.');
    }
    return manifest;
}

function removeGeneratedArchives() {
    for (const fileName of readdirSync(downloadsRoot)) {
        if (!fileName.startsWith('ykn-eklentisi-') || !fileName.endsWith('.zip')) continue;
        rmSync(join(downloadsRoot, fileName), { force: true });
    }
}

function assertExtensionFilesExist() {
    for (const fileName of extensionFiles) {
        const filePath = join(extensionRoot, fileName);
        if (!statSync(filePath, { throwIfNoEntry: false })) {
            throw new Error(`YKN eklenti dosyası bulunamadı: ${fileName}`);
        }
    }
}

function calculateExtensionFingerprint() {
    const hash = createHash('sha256');
    for (const fileName of extensionFiles) {
        hash.update(readFileSync(join(extensionRoot, fileName)));
    }
    return hash.digest('hex').slice(0, 12);
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
});

function calculateCrc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(archivePath) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;

    for (const fileName of extensionFiles) {
        const fileData = readFileSync(join(extensionRoot, fileName));
        const compressedData = deflateRawSync(fileData, { level: 9 });
        const fileNameBytes = Buffer.from(fileName, 'utf8');
        const checksum = calculateCrc32(fileData);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressedData.length, 18);
        localHeader.writeUInt32LE(fileData.length, 22);
        localHeader.writeUInt16LE(fileNameBytes.length, 26);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressedData.length, 20);
        centralHeader.writeUInt32LE(fileData.length, 24);
        centralHeader.writeUInt16LE(fileNameBytes.length, 28);
        centralHeader.writeUInt32LE(localOffset, 42);

        localParts.push(localHeader, fileNameBytes, compressedData);
        centralParts.push(centralHeader, fileNameBytes);
        localOffset += localHeader.length + fileNameBytes.length + compressedData.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const localDirectory = Buffer.concat(localParts);
    const endOfDirectory = Buffer.alloc(22);
    endOfDirectory.writeUInt32LE(0x06054b50, 0);
    endOfDirectory.writeUInt16LE(extensionFiles.length, 8);
    endOfDirectory.writeUInt16LE(extensionFiles.length, 10);
    endOfDirectory.writeUInt32LE(centralDirectory.length, 12);
    endOfDirectory.writeUInt32LE(localDirectory.length, 16);
    writeFileSync(archivePath, Buffer.concat([localDirectory, centralDirectory, endOfDirectory]));
}

function writeDownloadMetadata(manifest, archiveName, fingerprint) {
    writeFileSync(join(downloadsRoot, 'ykn-eklentisi.json'), `${JSON.stringify({
        version: manifest.version,
        fingerprint,
        fileName: archiveName,
        downloadUrl: `/downloads/${archiveName}`
    }, null, 2)}\n`);
}

function packageExtension() {
    const manifest = readExtensionManifest();
    mkdirSync(downloadsRoot, { recursive: true });
    removeGeneratedArchives();
    assertExtensionFilesExist();

    const fingerprint = calculateExtensionFingerprint();
    const archiveName = `ykn-eklentisi-v${manifest.version}-${fingerprint}.zip`;
    const archivePath = join(downloadsRoot, archiveName);
    createZipArchive(archivePath);
    copyFileSync(archivePath, join(downloadsRoot, 'ykn-eklentisi-latest.zip'));
    writeDownloadMetadata(manifest, archiveName, fingerprint);
    console.log(`YKN eklentisi paketlendi: ${archiveName}`);
}

packageExtension();
