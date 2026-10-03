import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { downloadApplicationArchive } from '../src/staff/applicationArchive.js';

const fixtures = [
    { entry_name: '01-passport.pdf', code: 'passport', expected_revision_number: 1,
        object_identity: 'a'.repeat(64), media_type: 'application/pdf', payload: Buffer.from('%PDF-1.7\nsynthetic passport\n%%EOF\n') },
    { entry_name: '02-photographs.jpg', code: 'photographs', expected_revision_number: 2,
        object_identity: 'b'.repeat(64), media_type: 'image/jpeg', payload: Buffer.from([0xff, 0xd8, 0x31, 0x32, 0xff, 0xd9]) }
];

function createManifest() {
    return { total_source_bytes: fixtures.reduce((total, file) => total + file.payload.length, 0),
        files: fixtures.map(({ payload, ...file }) => ({ ...file, byte_size: payload.length })) };
}

async function createBlobArchive() {
    const downloads = [];
    const window = { URL: { createObjectURL(blob) { downloads.push(blob); return 'blob:synthetic'; }, revokeObjectURL() {} },
        document: { createElement() { return { click() {}, remove() {} }; }, body: { append() {} } } };
    await downloadApplicationArchive({ applicationId: 'synthetic-only', window, manifest: createManifest(),
        fetchFile: async (_id, file) => new Response(fixtures.find((fixture) => fixture.entry_name === file.entry_name).payload) });
    return Buffer.from(await downloads[0].arrayBuffer());
}

async function createStreamArchive() {
    const chunks = [];
    let closed = false;
    const writable = new WritableStream({ write(chunk) { chunks.push(Buffer.from(chunk)); }, close() { closed = true; } });
    const window = { isSecureContext: true,
        showSaveFilePicker: async () => ({ createWritable: async () => writable }) };
    await downloadApplicationArchive({ applicationId: 'synthetic-only', window, manifest: createManifest(),
        fetchFile: async (_id, file) => new Response(fixtures.find((fixture) => fixture.entry_name === file.entry_name).payload) });
    assert.equal(closed, true);
    return Buffer.concat(chunks);
}

async function assertMacArchiveToolsAccept(archiveBytes, testName) {
    const directory = await mkdtemp(join(tmpdir(), 'application-archive-'));
    await chmod(directory, 0o700);
    const archivePath = join(directory, `${testName}.zip`);
    const extractionPath = join(directory, 'extracted');
    try {
        await writeFile(archivePath, archiveBytes, { mode: 0o600 });
        execFileSync('/usr/bin/unzip', ['-t', archivePath], { stdio: 'pipe' });
        execFileSync('/usr/bin/ditto', ['-x', '-k', archivePath, extractionPath], { stdio: 'pipe' });
        for (const fixture of fixtures) {
            assert.deepEqual(await readFile(join(extractionPath, fixture.entry_name)), fixture.payload);
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('Blob archive output passes macOS ZIP and CRC readers', { skip: process.platform !== 'darwin' }, async () => {
    await assertMacArchiveToolsAccept(await createBlobArchive(), 'blob-output');
});

test('streaming archive output passes macOS ZIP and CRC readers', { skip: process.platform !== 'darwin' }, async () => {
    await assertMacArchiveToolsAccept(await createStreamArchive(), 'stream-output');
});
