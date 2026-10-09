import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { extractPdfPages } from '../src/public/printPdf.js';
import { getSelectedPageCount, parsePageSelection } from '../src/public/printPageSelection.js';
import { submitPrintEntries } from '../src/public/printQueue.js';

test('page selection accepts ranges, lists, and mixed ranges without reordering', () => {
    assert.deepEqual(parsePageSelection('1-5', 30), [0, 1, 2, 3, 4]);
    assert.deepEqual(parsePageSelection('3,7,10', 30), [2, 6, 9]);
    assert.deepEqual(parsePageSelection('1-5,8,12-15', 30), [0, 1, 2, 3, 4, 7, 11, 12, 13, 14]);
});

test('page selection rejects malformed, repeated, reversed, and out-of-range values', () => {
    for (const value of ['1,,2', '1-3,3', '5-2', '0', '31', '1-x']) {
        assert.throws(() => parsePageSelection(value, 30));
    }
});

test('a 30-page source becomes a five-page PDF containing only selected pages', async () => {
    const source = await PDFDocument.create();
    for (let index = 0; index < 30; index += 1) source.addPage([595, 842]);
    const file = new File([await source.save()], 'kaynak.pdf', { type: 'application/pdf' });

    const extracted = await extractPdfPages(file, parsePageSelection('1-5', 30));
    const result = await PDFDocument.load(await extracted.arrayBuffer());

    assert.equal(getSelectedPageCount(parsePageSelection('1-5', 30)), 5);
    assert.equal(result.getPageCount(), 5);
    assert.equal(extracted.type, 'application/pdf');
});

test('PDF extraction rejects more than 20 pages and invalid page indexes', async () => {
    const source = await PDFDocument.create();
    for (let index = 0; index < 21; index += 1) source.addPage();
    const file = new File([await source.save()], 'kaynak.pdf', { type: 'application/pdf' });

    await assert.rejects(extractPdfPages(file, Array.from({ length: 21 }, (_, index) => index)));
    await assert.rejects(extractPdfPages(file, [21]));
});

test('a failed file does not stop the next independent print job', async () => {
    const entries = [{ name: 'ilk.pdf' }, { name: 'bozuk.pdf' }, { name: 'son.pdf' }];
    const attempted = [];

    const outcomes = await submitPrintEntries(entries, async (entry) => {
        attempted.push(entry.name);
        if (entry.name === 'bozuk.pdf') throw new Error('upload');
    });

    assert.deepEqual(attempted, ['ilk.pdf', 'bozuk.pdf', 'son.pdf']);
    assert.deepEqual(outcomes.map(({ status }) => status), ['sent', 'failed', 'sent']);
});

test('a rate limit stops new uploads and leaves later files pending', async () => {
    const entries = [{ name: 'ilk.pdf' }, { name: 'ikinci.pdf' }, { name: 'son.pdf' }];
    const attempted = [];

    const outcomes = await submitPrintEntries(entries, async (entry) => {
        attempted.push(entry.name);
        if (entry.name === 'ikinci.pdf') throw new Error('rate_limit');
    });

    assert.deepEqual(attempted, ['ilk.pdf', 'ikinci.pdf']);
    assert.deepEqual(outcomes.map(({ status }) => status), ['sent', 'rate_limited']);
});
