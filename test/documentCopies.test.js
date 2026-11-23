import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildCopiesPdfBlob } from '../src/staff/documentCopies.js';

async function createSamplePdfBytes(pageCount) {
    const doc = await PDFDocument.create();
    for (let index = 0; index < pageCount; index += 1) {
        doc.addPage([300, 400]);
    }
    return doc.save();
}

test('buildCopiesPdfBlob duplicates a 2-page PDF 10 times into a 20-page PDF Blob', async () => {
    const sourceBytes = await createSamplePdfBytes(2);
    const requestedUrls = [];
    const fetcher = async (url) => {
        requestedUrls.push(url);
        return {
            ok: true,
            status: 200,
            async arrayBuffer() {
                return sourceBytes.buffer.slice(
                    sourceBytes.byteOffset,
                    sourceBytes.byteOffset + sourceBytes.byteLength
                );
            }
        };
    };

    const blob = await buildCopiesPdfBlob('/documents/ogrenim_ucreti_taksitlendirme_dilekcesi.pdf', 10, { fetcher });

    assert.equal(requestedUrls.length, 1);
    assert.equal(requestedUrls[0], '/documents/ogrenim_ucreti_taksitlendirme_dilekcesi.pdf');
    assert.equal(blob.type, 'application/pdf');

    const outputBytes = new Uint8Array(await blob.arrayBuffer());
    const loadedOutput = await PDFDocument.load(outputBytes);
    assert.equal(loadedOutput.getPageCount(), 20);
});

test('buildCopiesPdfBlob rejects invalid copy counts without calling fetcher', async () => {
    let fetchCalls = 0;
    const fetcher = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, async arrayBuffer() { return new ArrayBuffer(0); } };
    };

    for (const invalidCopies of [0, -3, 51, 10000, 1.5, NaN, '10', null, undefined]) {
        await assert.rejects(
            () => buildCopiesPdfBlob('/documents/sample.pdf', invalidCopies, { fetcher }),
            { message: 'invalid-copies' }
        );
    }

    assert.equal(fetchCalls, 0);
});

test('buildCopiesPdfBlob throws source-unavailable when fetch fails or returns non-OK', async () => {
    await assert.rejects(
        () => buildCopiesPdfBlob('/documents/missing.pdf', 2, {
            fetcher: async () => ({ ok: false, status: 404, async arrayBuffer() { return new ArrayBuffer(0); } })
        }),
        { message: 'source-unavailable' }
    );

    await assert.rejects(
        () => buildCopiesPdfBlob('/documents/offline.pdf', 2, {
            fetcher: async () => {
                throw new Error('network down');
            }
        }),
        { message: 'source-unavailable' }
    );

    await assert.rejects(
        () => buildCopiesPdfBlob('', 2, {
            fetcher: async () => ({ ok: true, status: 200, async arrayBuffer() { return new ArrayBuffer(8); } })
        }),
        { message: 'source-unavailable' }
    );
});

test('buildCopiesPdfBlob throws too-large when generated PDF exceeds 20 MB', async () => {
    const fakePdfDocument = {
        async load() {
            return {
                getPageIndices() {
                    return [0];
                }
            };
        },
        async create() {
            return {
                async copyPages(_src, indices) {
                    return indices.map((index) => ({ index }));
                },
                addPage() {},
                async save() {
                    return new Uint8Array(20 * 1024 * 1024 + 1);
                }
            };
        }
    };

    await assert.rejects(
        () => buildCopiesPdfBlob('/documents/huge.pdf', 1, {
            fetcher: async () => ({
                ok: true,
                status: 200,
                async arrayBuffer() {
                    return new Uint8Array([37, 80, 68, 70]).buffer;
                }
            }),
            PDFDocument: fakePdfDocument
        }),
        { message: 'too-large' }
    );
});
