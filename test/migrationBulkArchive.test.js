import assert from 'node:assert/strict';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { test } from 'node:test';
import {
    createBulkArchiveFilename, listSentToMigrationApplications, runMigrationBulkExport
} from '../src/staff/migrationBulkArchive.js';

function concat(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

function createFakeDirectory(initial = {}) {
    const files = new Map(Object.entries(initial));
    const directory = {
        files,
        async getFileHandle(name, options = {}) {
            if (!files.has(name) && !options.create) {
                throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
            }
            return {
                name,
                async createWritable() {
                    const chunks = [];
                    return new WritableStream({
                        write(chunk) { chunks.push(chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk))); },
                        close() { files.set(name, concat(chunks)); }
                    });
                }
            };
        }
    };
    return directory;
}

function queryPage(items, page, totalPages) {
    return { items, pagination: { page, page_size: 100, total_items: items.length, total_pages: totalPages } };
}

function createOneDocumentManifest() {
    return { total_source_bytes: 3, files: [{ code: 'passport', expected_revision_number: 1,
        object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: 3, entry_name: '01-passport.pdf' }] };
}

test('listing collects only sent_to_migration rows across all pages of the migration filter', async () => {
    const calls = [];
    const api = {
        async queryApplications(query) {
            calls.push(query);
            if (query.page === 1) {
                return queryPage([{ id: 'a', status: 'sent_to_migration' }, { id: 'b', status: 'migration_approved' }], 1, 2);
            }
            return queryPage([{ id: 'c', status: 'sent_to_migration' }], 2, 2);
        }
    };
    const items = await listSentToMigrationApplications(api);
    assert.deepEqual(items.map((item) => item.id), ['a', 'c']);
    assert.deepEqual(calls.map((call) => [call.status, call.page]), [['migration', 1], ['migration', 2]]);
});

test('listing stops with an error on an unexpected response shape instead of exporting a partial set', async () => {
    const api = { async queryApplications() { return { items: [] }; } };
    await assert.rejects(listSentToMigrationApplications(api), /okunamadı/);
});

test('bulk filenames use the student number and never collide inside one export', () => {
    const used = new Set();
    const first = createBulkArchiveFilename({ student_number: 'S-100', first_name: 'Ayşe', last_name: 'Yılmaz' }, used);
    const second = createBulkArchiveFilename({ student_number: 'S-100', first_name: 'Ayşe', last_name: 'Yılmaz' }, used);
    assert.equal(first, 'S-100-ayse_yilmaz.zip');
    assert.equal(second, 'S-100-ayse_yilmaz-2.zip');
    assert.equal(createBulkArchiveFilename({ student_number: '../x' }, used), 'x-x.zip', 'path characters never reach the file name');
});

test('export saves one ZIP per application, reports gate failures, and writes a summary', async () => {
    const directory = createFakeDirectory();
    const api = {
        async createArchiveManifest(applicationId) {
            if (applicationId === 'blocked') throw new Error('Belge güvenli erişime uygun değil.');
            return { total_source_bytes: 3, files: [{ code: 'passport', expected_revision_number: 1,
                object_identity: 'a'.repeat(64), media_type: 'application/pdf', byte_size: 3, entry_name: '01-passport.pdf' }] };
        },
        async readArchiveFile() {
            return new Response(new Uint8Array([1, 2, 3]));
        }
    };
    const applications = [
        { id: 'ok', student_number: 'S-1', first_name: 'A', last_name: 'B' },
        { id: 'blocked', student_number: 'S-2', first_name: 'C', last_name: 'D' }
    ];
    const result = await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true }, applications, retryDelaysMs: [],
        now: new Date('2026-11-10T10:00:00.000Z')
    });

    assert.equal(result.saved, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.report.success_percent, 50);
    assert.deepEqual(result.failed_entries.map((entry) => [entry.student_number, entry.name]), [['S-2', 'C D']]);
    const zipBytes = directory.files.get('S-1-a_b.zip');
    assert.ok(zipBytes, 'ZIP for the saved application is written');
    const reader = new ZipReader(new BlobReader(new Blob([zipBytes])));
    const [entry] = await reader.getEntries();
    assert.equal(entry.filename, '01-passport.pdf');
    assert.deepEqual([...await entry.getData(new Uint8ArrayWriter())], [1, 2, 3]);
    await reader.close();
    assert.equal(directory.files.has('S-2-c_d.zip'), false, 'blocked application creates no partial ZIP');

    const summaryName = [...directory.files.keys()].find((name) => name.startsWith('goc-indirme-ozeti-'));
    const summary = JSON.parse(new TextDecoder().decode(directory.files.get(summaryName)));
    assert.equal(summary.requested, 2);
    assert.equal(summary.saved, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.entries[1].reason, 'Belge güvenli erişime uygun değil.');
});

test('export never overwrites an existing file with the same name', async () => {
    const existing = new Uint8Array([9, 9]);
    const directory = createFakeDirectory({ 'S-1-a_b.zip': existing });
    let manifestRequested = false;
    const api = {
        async createArchiveManifest() { manifestRequested = true; return { total_source_bytes: 0, files: [] }; },
        async readArchiveFile() { return new Response(); }
    };
    const result = await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true },
        applications: [{ id: 'x', student_number: 'S-1', first_name: 'A', last_name: 'B' }]
    });
    assert.equal(result.saved, 0);
    assert.equal(manifestRequested, false);
    assert.deepEqual([...directory.files.get('S-1-a_b.zip')], [9, 9]);
});

test('abort stops before the next application and records the cancellation', async () => {
    const directory = createFakeDirectory();
    const controller = new AbortController();
    const api = {
        async createArchiveManifest() {
            controller.abort();
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        },
        async readArchiveFile() { return new Response(); }
    };
    const result = await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true }, signal: controller.signal,
        applications: [
            { id: 'one', student_number: '1', first_name: 'A', last_name: 'B' },
            { id: 'two', student_number: '2', first_name: 'C', last_name: 'D' }
        ]
    });
    assert.equal(result.report.entries.length, 1);
    assert.equal(result.report.entries[0].reason, 'İndirme iptal edildi.');
    assert.equal(result.report.not_attempted, 1, 'the second application is reported as not attempted');
    assert.equal(result.saved, 0);
});

test('a transient network failure is retried and the application is saved on a later attempt', async () => {
    const directory = createFakeDirectory();
    let manifestCalls = 0;
    const api = {
        async createArchiveManifest() {
            manifestCalls += 1;
            if (manifestCalls === 1) throw Object.assign(new Error('Staff request failed.'), { status: 0 });
            return createOneDocumentManifest();
        },
        async readArchiveFile() { return new Response(new Uint8Array([1, 2, 3])); }
    };
    const result = await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true }, retryDelaysMs: [0, 0],
        applications: [{ id: 'retry', student_number: 'S-9', first_name: 'R', last_name: 'T' }]
    });
    assert.equal(manifestCalls, 2);
    assert.equal(result.saved, 1);
    assert.equal(result.report.entries[0].attempts, 2);
    assert.equal(result.report.entries[0].reason, null);
    assert.ok(directory.files.has('S-9-r_t.zip'));
});

test('a 404 answer is not retried and its reason keeps the HTTP status', async () => {
    const directory = createFakeDirectory();
    let manifestCalls = 0;
    const api = {
        async createArchiveManifest() {
            manifestCalls += 1;
            throw Object.assign(new Error('Belge mevcut değil veya erişilemiyor.'), { status: 404 });
        },
        async readArchiveFile() { return new Response(); }
    };
    const result = await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true }, retryDelaysMs: [0, 0],
        applications: [{ id: 'gone', student_number: 'S-8', first_name: 'G', last_name: 'O' }]
    });
    assert.equal(manifestCalls, 1);
    assert.equal(result.report.entries[0].attempts, 1);
    assert.equal(result.report.entries[0].reason, 'Belge mevcut değil veya erişilemiyor. (HTTP 404)');
});

test('progress reports document counts and finishes with done equal to the total', async () => {
    const directory = createFakeDirectory();
    const api = {
        async createArchiveManifest() { return createOneDocumentManifest(); },
        async readArchiveFile() { return new Response(new Uint8Array([1, 2, 3])); }
    };
    const events = [];
    await runMigrationBulkExport({
        api, directory, window: { isSecureContext: true }, retryDelaysMs: [],
        applications: [
            { id: 'a', student_number: '1', first_name: 'A', last_name: 'B' },
            { id: 'b', student_number: '2', first_name: 'C', last_name: 'D' }
        ],
        onProgress: (progress) => events.push(progress)
    });
    const filesEvents = events.filter((event) => event.phase === 'files');
    assert.deepEqual(filesEvents.map((event) => event.file_done), [0, 1, 0, 1]);
    assert.equal(events[0].done, 0, 'the application being started is not counted as done');
    const last = events.at(-1);
    assert.equal(last.phase, 'done');
    assert.equal(last.done, 2);
    assert.equal(last.saved, 2);
    assert.equal(last.documents_saved, 2);
});
