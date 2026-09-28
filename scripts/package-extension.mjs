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
    'portal-security.js',
    'storage-lifecycle.js',
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

function addProductionPortalOrigin(manifest) {
    const configuredOrigin = process.env.PORTAL_PRODUCTION_ORIGIN?.trim();
    if (!configuredOrigin) {
        if (process.env.VERCEL === '1') {
            throw new Error('PORTAL_PRODUCTION_ORIGIN is required to package the staff extension for production.');
        }
        return manifest;
    }

    let portalUrl;
    try {
        portalUrl = new URL(configuredOrigin);
    } catch {
        throw new Error('PORTAL_PRODUCTION_ORIGIN must be a valid HTTPS origin.');
    }
    if (portalUrl.protocol !== 'https:' || portalUrl.username || portalUrl.password || portalUrl.port
        || portalUrl.pathname !== '/' || portalUrl.search || portalUrl.hash) {
        throw new Error('PORTAL_PRODUCTION_ORIGIN must be a valid HTTPS origin without a path.');
    }

    const originPattern = `${portalUrl.origin}/*`;
    manifest.host_permissions = [...new Set([...manifest.host_permissions, originPattern])];
    const bridgeScript = manifest.content_scripts.find((script) => script.js.includes('bridge.js'));
    bridgeScript.matches = [...new Set([...bridgeScript.matches, originPattern])];
    return manifest;
}

function readPackagedFile(fileName, manifest) {
    if (fileName === 'manifest.json') return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    return readFileSync(join(extensionRoot, fileName));
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

function calculateExtensionFingerprint(manifest) {
    const hash = createHash('sha256');
    for (const fileName of extensionFiles) hash.update(readPackagedFile(fileName, manifest));
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

function createZipArchive(archivePath, manifest) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const folderPrefix = 'ykn_eklenti/';

    const dirEntryBytes = Buffer.from(folderPrefix, 'utf8');
    const dirLocalHeader = Buffer.alloc(30);
    dirLocalHeader.writeUInt32LE(0x04034b50, 0);
    dirLocalHeader.writeUInt16LE(20, 4);
    dirLocalHeader.writeUInt16LE(0, 6);
    dirLocalHeader.writeUInt16LE(0, 8);
    dirLocalHeader.writeUInt32LE(0, 14);
    dirLocalHeader.writeUInt32LE(0, 18);
    dirLocalHeader.writeUInt32LE(0, 22);
    dirLocalHeader.writeUInt16LE(dirEntryBytes.length, 26);
    dirLocalHeader.writeUInt16LE(0, 28);

    const dirCentralHeader = Buffer.alloc(46);
    dirCentralHeader.writeUInt32LE(0x02014b50, 0);
    dirCentralHeader.writeUInt16LE(20, 4);
    dirCentralHeader.writeUInt16LE(20, 6);
    dirCentralHeader.writeUInt16LE(0, 8);
    dirCentralHeader.writeUInt16LE(0, 10);
    dirCentralHeader.writeUInt32LE(0, 16);
    dirCentralHeader.writeUInt32LE(0, 20);
    dirCentralHeader.writeUInt32LE(0, 24);
    dirCentralHeader.writeUInt16LE(dirEntryBytes.length, 28);
    dirCentralHeader.writeUInt16LE(0, 30);
    dirCentralHeader.writeUInt16LE(0, 32);
    dirCentralHeader.writeUInt16LE(0, 34);
    dirCentralHeader.writeUInt16LE(0, 36);
    dirCentralHeader.writeUInt32LE(0x10, 38);
    dirCentralHeader.writeUInt32LE(localOffset, 42);

    localParts.push(dirLocalHeader, dirEntryBytes);
    centralParts.push(dirCentralHeader, dirEntryBytes);
    localOffset += dirLocalHeader.length + dirEntryBytes.length;

    for (const fileName of extensionFiles) {
        const fileData = readPackagedFile(fileName, manifest);
        const compressedData = deflateRawSync(fileData, { level: 9 });
        const entryName = `${folderPrefix}${fileName}`;
        const fileNameBytes = Buffer.from(entryName, 'utf8');
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

    const totalEntries = extensionFiles.length + 1;
    const centralDirectory = Buffer.concat(centralParts);
    const localDirectory = Buffer.concat(localParts);
    const endOfDirectory = Buffer.alloc(22);
    endOfDirectory.writeUInt32LE(0x06054b50, 0);
    endOfDirectory.writeUInt16LE(totalEntries, 8);
    endOfDirectory.writeUInt16LE(totalEntries, 10);
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
    const manifest = addProductionPortalOrigin(readExtensionManifest());
    mkdirSync(downloadsRoot, { recursive: true });
    removeGeneratedArchives();
    assertExtensionFilesExist();

    const fingerprint = calculateExtensionFingerprint(manifest);
    const archiveName = `ykn-eklentisi-v${manifest.version}-${fingerprint}.zip`;
    const archivePath = join(downloadsRoot, archiveName);
    createZipArchive(archivePath, manifest);
    copyFileSync(archivePath, join(downloadsRoot, 'ykn-eklentisi-latest.zip'));
    writeDownloadMetadata(manifest, archiveName, fingerprint);
    console.log(`YKN eklentisi paketlendi: ${archiveName}`);
}

packageExtension();
