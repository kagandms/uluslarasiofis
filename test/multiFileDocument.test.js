import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import test from 'node:test';
import { createMultiPageDocumentPdf } from '../src/public/multiFileDocument.js';

async function createPdf(pageCount) {
    const document = await PDFDocument.create();
    for (let index = 0; index < pageCount; index += 1) document.addPage([595, 842]);
    return new File([await document.save()], `source-${pageCount}.pdf`, { type: 'application/pdf' });
}

test('selected document PDFs combine into one ordered multi-page PDF for one requirement', async () => {
    const combined = await createMultiPageDocumentPdf([
        await createPdf(2),
        await createPdf(1)
    ], { maxByteSize: 1024 * 1024 });
    const output = await PDFDocument.load(await combined.arrayBuffer());

    assert.equal(combined.type, 'application/pdf');
    assert.equal(output.getPageCount(), 3);
});

test('multi-file PDF combination rejects unsupported files and output above the document limit', async () => {
    await assert.rejects(
        createMultiPageDocumentPdf([new File(['text'], 'notes.txt', { type: 'text/plain' }), await createPdf(1)], {
            maxByteSize: 1024 * 1024
        }),
        (error) => error.code === 'INVALID_FILE'
    );
    await assert.rejects(
        createMultiPageDocumentPdf([await createPdf(1), await createPdf(1)], { maxByteSize: 1 }),
        (error) => error.code === 'FILE_TOO_LARGE'
    );
});

test('wrong document slot does not satisfy a different required document', async () => {
    const { calculateDocumentReadiness } = await import('../src/public/applicationWizard.js');
    const readiness = calculateDocumentReadiness([
        { code: 'passport', required: true, upload_status: 'finalized', revision_number: 1, revision_status: 'submitted', scan_status: 'clean' },
        { code: 'residence_card', required: true, upload_status: null, revision_number: null, revision_status: null, scan_status: null }
    ]);

    assert.equal(readiness.canContinue, false);
    assert.deepEqual(readiness.pending.map((requirement) => requirement.code), ['residence_card']);
});
