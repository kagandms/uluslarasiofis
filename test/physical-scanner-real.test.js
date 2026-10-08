import { PDFDocument } from 'pdf-lib';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:https';
import worker from '../src/server/worker.js';
import { createPortFixture, pairPortPhone, portRequest, registerPortPdf, uploadPhoto } from './physical-port-fixtures.js';

const runCommand = promisify(execFile);
const shouldRun = process.env.RUN_PHYSICAL_REAL_CLAMAV === '1';

async function startHarness(context, directory) {
    await runCommand('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'),
        '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
    const server = createServer({ key: await readFile(join(directory, 'key.pem')), cert: await readFile(join(directory, 'cert.pem')) }, async (request, response) => {
        try {
            const parts = [];
            for await (const chunk of request) parts.push(chunk);
            const result = await worker.fetch(new Request(`https://localhost${request.url}`, { method: request.method, headers: request.headers,
                ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(parts) }) }), context.environment);
            response.writeHead(result.status, Object.fromEntries(result.headers));
            response.end(Buffer.from(await result.arrayBuffer()));
        } catch (error) {
            process.stderr.write(`Synthetic HTTPS harness failed: ${error.name}\n`);
            response.writeHead(500);
            response.end('Synthetic test failed');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await writeFile(join(directory, 'secret'), context.environment.SCANNER_SECRET, { mode: 0o600 });
    return { server, origin: `https://127.0.0.1:${server.address().port}` };
}

async function runPhysicalScanner(harness, directory) {
    const installedState = process.env.PHYSICAL_SCANNER_STATE;
    assert.ok(installedState, 'Provide the existing signed ClamAV installation path.');
    const stateDirectory = join(directory, 'runner-state');
    await mkdir(stateDirectory, { mode: 0o700, recursive: true });
    const completed = await runCommand(join(installedState, 'venv/bin/python'), ['scripts/scanner/runner.py', '--once'], {
        timeout: 180000, env: { ...process.env, SCANNER_ORIGIN: harness.origin, SCANNER_RUNNER_ID: 'synthetic-physical',
            SCANNER_SECRET_FILE: join(directory, 'secret'), SCANNER_STATE_DIR: stateDirectory,
            SCANNER_DATABASE_DIR: process.env.PHYSICAL_SCANNER_SIGNATURES || join(installedState, 'signatures'), SCANNER_CERTS_DIR: '/opt/homebrew/etc/clamav/certs',
            SCANNER_CLAMSCAN: '/opt/homebrew/bin/clamscan', SCANNER_CA_FILE: join(directory, 'cert.pem') }
    });
    return completed.stderr;
}

async function verifyCleanDocuments(fixture, harness, directory) {
    const pdf = await registerPortPdf(fixture);
    assert.match(await runPhysicalScanner(harness, directory), /outcome=clean/);
    const document = await portRequest(fixture, `/api/staff/physical-intakes/${pdf.id}/files/${pdf.id}/download`, { cookie: fixture.staffCookie });
    assert.equal(document.status, 200);
    const transfer = await pairPortPhone(fixture);
    const fixturesDirectory = join(directory, 'fixtures');
    await runCommand(join(process.env.PHYSICAL_SCANNER_STATE, 'venv/bin/python'), ['scripts/scanner/create_fixtures.py', fixturesDirectory]);
    const jpeg = await readFile(join(fixturesDirectory, 'clean.jpg'));
    const cleanId = crypto.randomUUID();
    assert.equal((await uploadPhoto(fixture, transfer, { id: cleanId, bytes: jpeg })).status, 200);
    assert.match(await runPhysicalScanner(harness, directory), /outcome=clean/);
    assert.equal((await portRequest(fixture, `/api/staff/mobile-transfers/${transfer.id}/files/${cleanId}`, { cookie: fixture.staffCookie })).status, 200);
    return { transfer, jpeg };
}

async function verifyUnsafePhonePhoto(fixture, harness, options) {
    const { directory, transfer, jpeg } = options;
    const marker = Buffer.from('X5O!P%@AP[4' + '\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const archive = new ZipWriter(new Uint8ArrayWriter());
    await archive.add('synthetic-eicar.txt', new Uint8ArrayReader(marker));
    const archiveBytes = await archive.close();
    const unsafeJpeg = Buffer.concat([jpeg, archiveBytes, jpeg.subarray(-2)]);
    assert.equal((await uploadPhoto(fixture, transfer, { bytes: unsafeJpeg })).status, 415);
    const unsafePdf = await PDFDocument.create();
    unsafePdf.addPage();
    await unsafePdf.attach(marker, 'synthetic-eicar.txt', { mimeType: 'text/plain' });
    const registered = await registerPortPdf(fixture, crypto.randomUUID(), { bytes: await unsafePdf.save() });
    assert.match(await runPhysicalScanner(harness, directory), /outcome=unsafe/);
    assert.equal((await portRequest(fixture, `/api/staff/physical-intakes/${registered.id}/files/${registered.id}/download`, { cookie: fixture.staffCookie })).status, 409);
}

test('the unchanged runner and signed ClamAV scan physical PDFs and allow clean phone JPEGs while rejecting JPEG polyglots and blocking an EICAR PDF', { skip: !shouldRun, timeout: 240000 }, async context => {
    const fixture = await createPortFixture();
    const directory = await mkdtemp(join(tmpdir(), 'physical-real-clamav-'));
    const harness = await startHarness(fixture, directory);
    try {
        const { transfer, jpeg } = await verifyCleanDocuments(fixture, harness, directory);
        await verifyUnsafePhonePhoto(fixture, harness, { directory, transfer, jpeg });
        const results = fixture.database.prepare('SELECT engine_version,signature_version,signature_updated_at,outcome FROM staff_document_scan_jobs ORDER BY created_at').all().results;
        assert.deepEqual(results.map(result => result.outcome), ['clean', 'clean', 'unsafe']);
        assert.ok(results.every(result => result.engine_version !== 'synthetic' && result.signature_version !== 'synthetic'));
        context.diagnostic(JSON.stringify({ engine: results[0].engine_version, signatures: results[0].signature_version,
            signatureUpdatedAt: results[0].signature_updated_at, outcomes: results.map(result => result.outcome) }));
    } finally {
        await new Promise(resolve => harness.server.close(resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
