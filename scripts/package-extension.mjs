import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(projectRoot, 'ykn_eklenti-main');
const downloadsRoot = join(projectRoot, 'public', 'downloads');
export const extensionFiles = [
    'manifest.json',
    'background.js',
    'bridge.js',
    'content.js',
    'zk-form-controls.js',
    'yoksis-field-targets.js',
    'yoksis-student-identity.js',
    'yoksis-document-audit.js',
    'yoksis-document-audit-controller.js',
    'gocnet-transfer-controller.js',
    'portal-security.js',
    'storage-lifecycle.js',
    'document-parser.js',
    'pdf.min.js',
    'pdf.worker.min.js',
    'cropper.js',
    'cropper.html',
    'cropper-selection.js',
    'popup.html',
    'popup.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png'
];

// Manifest içindeki göreli dosya yolunu paket listesiyle karşılaştırmak için normalize eder.
function normalizeManifestFilePath(filePath) {
    return filePath.trim().replace(/^\.?\//, '').replace(/\\/g, '/');
}

// Manifest V3 içinde tanımlanan tüm eklenti dosya referanslarını tekilleştirerek toplar.
export function collectManifestReferencedFiles(manifest) {
    const referencedFiles = new Set();
    const addFileReference = (value) => {
        if (typeof value !== 'string') return;
        const normalized = normalizeManifestFilePath(value);
        if (normalized) referencedFiles.add(normalized);
    };

    if (manifest?.icons && typeof manifest.icons === 'object') {
        for (const iconPath of Object.values(manifest.icons)) {
            addFileReference(iconPath);
        }
    }

    const defaultIcon = manifest?.action?.default_icon;
    if (typeof defaultIcon === 'string') {
        addFileReference(defaultIcon);
    } else if (defaultIcon && typeof defaultIcon === 'object') {
        for (const iconPath of Object.values(defaultIcon)) {
            addFileReference(iconPath);
        }
    }

    addFileReference(manifest?.action?.default_popup);
    addFileReference(manifest?.background?.service_worker);

    if (Array.isArray(manifest?.content_scripts)) {
        for (const contentScript of manifest.content_scripts) {
            if (Array.isArray(contentScript?.js)) {
                for (const scriptPath of contentScript.js) addFileReference(scriptPath);
            }
            if (Array.isArray(contentScript?.css)) {
                for (const stylePath of contentScript.css) addFileReference(stylePath);
            }
        }
    }

    if (Array.isArray(manifest?.web_accessible_resources)) {
        for (const resourceEntry of manifest.web_accessible_resources) {
            if (typeof resourceEntry === 'string') {
                addFileReference(resourceEntry);
                continue;
            }
            if (Array.isArray(resourceEntry?.resources)) {
                for (const resourcePath of resourceEntry.resources) {
                    addFileReference(resourcePath);
                }
            }
        }
    }

    return [...referencedFiles];
}

// Manifestte referans verilip paket listesinde olmayan dosyaları döndürür.
export function findMissingManifestReferences(manifest, packagedFiles = extensionFiles) {
    const packagedSet = new Set(packagedFiles.map((fileName) => normalizeManifestFilePath(fileName)));
    return collectManifestReferencedFiles(manifest).filter((filePath) => !packagedSet.has(filePath));
}

// Manifestte referans verilen her dosyanın paket listesinde bulunduğunu doğrular.
export function assertManifestReferencesPackaged(manifest, packagedFiles = extensionFiles) {
    const missingFiles = findMissingManifestReferences(manifest, packagedFiles);
    if (missingFiles.length > 0) {
        throw new Error(`Manifest içinde referans verilen dosya paket listesinde eksik: ${missingFiles.join(', ')}`);
    }
}

export function readExtensionManifest() {
    const manifestPath = join(extensionRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        throw new Error('YKN eklentisi manifest.json sürümü geçerli değil.');
    }
    return manifest;
}

function readPackagedFile(fileName, manifest) {
    if (fileName === 'manifest.json') return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    return readFileSync(join(extensionRoot, fileName));
}

function removeGeneratedArchives(version, outputDir = downloadsRoot) {
    for (const fileName of readdirSync(outputDir)) {
        if (!fileName.startsWith('ykn-eklentisi-') || !fileName.endsWith('.zip')) continue;
        if (!fileName.startsWith(`ykn-eklentisi-v${version}-`)) continue;
        rmSync(join(outputDir, fileName), { force: true });
    }
}

export function assertExtensionFilesExist(files = extensionFiles) {
    for (const fileName of files) {
        const filePath = join(extensionRoot, fileName);
        const stats = statSync(filePath, { throwIfNoEntry: false });
        if (!stats || !stats.isFile()) {
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

// ZIP içinde oluşturulacak kök ve alt dizin girişlerini benzersiz sırada toplar.
function collectArchiveDirectories(files, folderPrefix) {
    const directories = new Set([folderPrefix]);
    for (const fileName of files) {
        const parts = fileName.replace(/\\/g, '/').split('/');
        let current = folderPrefix;
        for (let index = 0; index < parts.length - 1; index += 1) {
            current += `${parts[index]}/`;
            directories.add(current);
        }
    }
    return [...directories];
}

// ZIP arşivi içine tek bir dizin girişi (local + central header) ekler.
function appendDirectoryEntry(directoryName, localParts, centralParts, localOffset) {
    const dirEntryBytes = Buffer.from(directoryName, 'utf8');
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
    return localOffset + dirLocalHeader.length + dirEntryBytes.length;
}

function createZipArchive(archivePath, manifest) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const folderPrefix = 'ykn_eklenti/';
    const archiveDirectories = collectArchiveDirectories(extensionFiles, folderPrefix);

    for (const directoryName of archiveDirectories) {
        localOffset = appendDirectoryEntry(directoryName, localParts, centralParts, localOffset);
    }

    for (const fileName of extensionFiles) {
        const fileData = readPackagedFile(fileName, manifest);
        const compressedData = deflateRawSync(fileData, { level: 9 });
        const entryName = `${folderPrefix}${fileName.replace(/\\/g, '/')}`;
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

    const totalEntries = archiveDirectories.length + extensionFiles.length;
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

function writeDownloadMetadata(manifest, archiveName, fingerprint, outputDir = downloadsRoot) {
    writeFileSync(join(outputDir, 'ykn-eklentisi.json'), `${JSON.stringify({
        version: manifest.version,
        fingerprint,
        fileName: archiveName,
        downloadUrl: `/downloads/${archiveName}`
    }, null, 2)}\n`);
}

export function packageExtension({ outputDir = downloadsRoot, silent = false } = {}) {
    const manifest = readExtensionManifest();
    assertManifestReferencesPackaged(manifest, extensionFiles);
    assertExtensionFilesExist(extensionFiles);
    mkdirSync(outputDir, { recursive: true });
    removeGeneratedArchives(manifest.version, outputDir);

    const fingerprint = calculateExtensionFingerprint(manifest);
    const archiveName = `ykn-eklentisi-v${manifest.version}-${fingerprint}.zip`;
    const archivePath = join(outputDir, archiveName);
    createZipArchive(archivePath, manifest);
    copyFileSync(archivePath, join(outputDir, 'ykn-eklentisi-latest.zip'));
    writeDownloadMetadata(manifest, archiveName, fingerprint, outputDir);
    if (!silent) {
        console.log(`YKN eklentisi paketlendi: ${archiveName}`);
    }
    return { archiveName, archivePath, fingerprint, version: manifest.version };
}

const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
    packageExtension();
}
