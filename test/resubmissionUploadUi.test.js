import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { test } from 'node:test';
import { initializeResubmissionUpload } from '../src/public/resubmissionUpload.js';
import { PUBLIC_MESSAGES, SESSION3_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

function createCard() {
    const document = new JSDOM('<!doctype html><html lang="tr" dir="ltr"><body><ul><li></li></ul></body></html>').window.document;
    return { document, card: document.querySelector('li') };
}

function createRequirement(overrides = {}) {
    return {
        code: 'passport', accepted_media_types: ['application/pdf'], max_byte_size: 100,
        label_key: 'documentPassport',
        ...overrides
    };
}

function chooseFile(document, input, { name = 'passport.pdf', type = 'application/pdf', size = 10 } = {}) {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, type, size }] });
    input.dispatchEvent(new document.defaultView.Event('change'));
}

function chooseFiles(document, input, files) {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new document.defaultView.Event('change'));
}

async function createPdfFile(pageCount, name = `source-${pageCount}.pdf`) {
    const pdfDocument = await PDFDocument.create();
    for (let index = 0; index < pageCount; index += 1) pdfDocument.addPage([595, 842]);
    return new File([await pdfDocument.save()], name, { type: 'application/pdf' });
}

async function flushEvents() {
    await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, attempts = 200) {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) return;
        await flushEvents();
    }
    throw new Error('Timed out waiting for expected UI state.');
}

test('invalid file selection cannot request a replacement intent', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    const control = initializeResubmissionUpload(card, createRequirement(), {
        async createResubmissionUploadIntent() { intentCalls += 1; }
    }, { messages: PUBLIC_MESSAGES.tr });
    chooseFile(document, control.fileInput, { type: 'application/x-msdownload' });
    control.button.click();

    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadInvalidFile);
    assert.equal(intentCalls, 0);
    document.defaultView.close();
});

test('PUT success stays verifying until finalize succeeds, then refreshes owner tracking', async () => {
    const { document, card } = createCard();
    let releasePut;
    let releaseFinalize;
    let finalized = 0;
    let refreshed = 0;
    const api = {
        async createResubmissionUploadIntent(code, file) {
            assert.equal(code, 'passport');
            assert.equal(file.name, 'passport.pdf');
            return { upload: { intent_id: 'opaque-only', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload(intentId) {
            assert.equal(intentId, 'opaque-only');
            finalized += 1;
            await new Promise((resolve) => { releaseFinalize = resolve; });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr,
        putStudentDocumentDirect: async () => new Promise((resolve) => { releasePut = resolve; }),
        onComplete: async () => { refreshed += 1; }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();
    releasePut();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadVerifying);
    assert.notEqual(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(finalized, 1);
    assert.equal(refreshed, 0);
    releaseFinalize();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(refreshed, 1);
    document.defaultView.close();
});

test('session failure aborts the private flow and never reuses the issued capability', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    let putCalls = 0;
    let sessionFailures = 0;
    const api = {
        async createResubmissionUploadIntent() {
            intentCalls += 1;
            return { upload: { intent_id: 'one-time-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() {
            throw Object.assign(new Error('expired'), { status: 401, code: 'APPLICATION_SESSION_REQUIRED' });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr,
        putStudentDocumentDirect: async (_upload, _file, options) => {
            putCalls += 1;
            assert.equal(options.signal.aborted, false);
        },
        onSessionFailure: () => { sessionFailures += 1; }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();

    assert.equal(intentCalls, 1);
    assert.equal(putCalls, 1);
    assert.equal(sessionFailures, 1);
    assert.equal(control.fileInput.disabled, true);
    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadSessionExpired);
    document.defaultView.close();
});

test('safe network and conflict failures invite a new attempt without capability reuse', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    const api = {
        async createResubmissionUploadIntent() {
            intentCalls += 1;
            return { upload: { intent_id: `intent-${intentCalls}`, method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() {
            throw Object.assign(new Error('changed'), { status: 409, code: 'RESUBMISSION_UPLOAD_CONFLICT' });
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr, putStudentDocumentDirect: async () => {}
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadConflict);
    control.button.click();
    await flushEvents();
    assert.equal(intentCalls, 2);
    document.defaultView.close();
});

test('tracking refresh failure after successful finalize does not misreport the upload as failed', async () => {
    const { document, card } = createCard();
    const api = {
        async createResubmissionUploadIntent() {
            return { upload: { intent_id: 'completed-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        messages: PUBLIC_MESSAGES.tr, putStudentDocumentDirect: async () => {},
        onComplete: async () => { throw Object.assign(new Error('tracking offline'), { code: 'NETWORK_ERROR' }); }
    });
    chooseFile(document, control.fileInput);
    control.button.click();
    await flushEvents();

    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    document.defaultView.close();
});

test('replacement messages exist in all five locales and Arabic remains right-to-left', () => {
    const keys = Object.keys(PUBLIC_MESSAGES.tr).filter((key) => key.startsWith('resubmissionUpload'));
    for (const locale of SUPPORTED_LOCALES) {
        for (const key of keys) assert.ok(PUBLIC_MESSAGES[locale][key], `${locale} is missing ${key}`);
        assert.ok(PUBLIC_MESSAGES[locale].resubmissionFileLabel, `${locale} is missing resubmissionFileLabel`);
    }
    const { document, card } = createCard();
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    initializeResubmissionUpload(card, createRequirement(), {}, { messages: PUBLIC_MESSAGES.ar });
    assert.equal(document.documentElement.dir, 'rtl');
    assert.equal(card.querySelector('input[type="file"]').getAttribute('aria-label'), PUBLIC_MESSAGES.ar.resubmissionUploadChooseFile);
    document.defaultView.close();
});

test('file input enables multi-selection and allows merger image types alongside PDF', () => {
    const { document, card } = createCard();
    const control = initializeResubmissionUpload(card, createRequirement(), {});
    assert.equal(control.fileInput.multiple, true);
    assert.deepEqual(control.fileInput.accept.split(','), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    assert.equal(card.querySelector('label').textContent, PUBLIC_MESSAGES.tr.resubmissionFileLabel);
    assert.equal(control.fileInput.getAttribute('aria-label'), PUBLIC_MESSAGES.tr.resubmissionUploadChooseFile);

    const imageOnly = createCard();
    const imageControl = initializeResubmissionUpload(imageOnly.card, createRequirement({ accepted_media_types: ['image/jpeg'] }), {});
    assert.equal(imageControl.fileInput.multiple, true);
    assert.equal(imageControl.fileInput.accept, 'image/jpeg');

    document.defaultView.close();
    imageOnly.document.defaultView.close();
});

test('single accepted PDF uploads unchanged without calling the PDF merger', async () => {
    const { document, card } = createCard();
    let mergeCalls = 0;
    let uploadedFile = null;
    const api = {
        async createResubmissionUploadIntent(_code, file) {
            uploadedFile = file;
            return { upload: { intent_id: 'single-pdf-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    };
    const control = initializeResubmissionUpload(card, createRequirement(), api, {
        createMultiPageDocumentPdf: async () => { mergeCalls += 1; },
        putStudentDocumentDirect: async (_upload, file) => { assert.equal(file, uploadedFile); }
    });
    chooseFile(document, control.fileInput, { name: 'single.pdf', type: 'application/pdf', size: 25 });
    assert.equal(control.button.disabled, false);
    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    assert.equal(mergeCalls, 0);
    assert.equal(uploadedFile.name, 'single.pdf');
    document.defaultView.close();
});

test('two selected images are merged in order and the produced PDF is uploaded', async () => {
    const { document, card } = createCard();
    const requirement = createRequirement({ max_byte_size: 1024 * 1024 });
    const img1 = new File(['img-1'], 'page-1.jpg', { type: 'image/jpeg' });
    const img2 = new File(['img-2'], 'page-2.png', { type: 'image/png' });
    const mergedPdf = await createPdfFile(2, 'combined-document.pdf');
    let receivedMergeFiles = null;
    let receivedMergeOptions = null;
    let releaseMerge;
    let intentFile = null;
    let directPutFile = null;

    const api = {
        async createResubmissionUploadIntent(_code, file) {
            intentFile = file;
            return { upload: { intent_id: 'merged-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    };
    const control = initializeResubmissionUpload(card, requirement, api, {
        createMultiPageDocumentPdf: async (files, mergeOptions) => {
            receivedMergeFiles = files;
            receivedMergeOptions = mergeOptions;
            return new Promise((resolve) => { releaseMerge = () => resolve(mergedPdf); });
        },
        putStudentDocumentDirect: async (_upload, file) => { directPutFile = file; }
    });

    chooseFiles(document, control.fileInput, [img1, img2]);
    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.multiFilePreparing);

    releaseMerge();
    await waitFor(() => !control.button.disabled);

    assert.deepEqual(receivedMergeFiles, [img1, img2]);
    assert.equal(receivedMergeOptions.maxByteSize, requirement.max_byte_size);
    assert.equal(receivedMergeOptions.document, document);
    assert.equal(
        control.status.textContent,
        PUBLIC_MESSAGES.tr.resubmissionUploadMergedReady.replace('{files}', '2').replace('{pages}', '2')
    );

    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    assert.equal(intentFile, mergedPdf);
    assert.equal(directPutFile, mergedPdf);
    document.defaultView.close();
});

test('real multi-file PDF merge combines PDFs and reports file and page counts before upload', async () => {
    const { document, card } = createCard();
    const requirement = createRequirement({ max_byte_size: 1024 * 1024 });
    const pdfA = await createPdfFile(2, 'a.pdf');
    const pdfB = await createPdfFile(1, 'b.pdf');
    let uploadedFile = null;

    const api = {
        async createResubmissionUploadIntent(_code, file) {
            uploadedFile = file;
            return { upload: { intent_id: 'real-merge-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    };
    const control = initializeResubmissionUpload(card, requirement, api, {
        putStudentDocumentDirect: async () => {}
    });

    chooseFiles(document, control.fileInput, [pdfA, pdfB]);
    await waitFor(() => !control.button.disabled);

    assert.equal(
        control.status.textContent,
        PUBLIC_MESSAGES.tr.resubmissionUploadMergedReady.replace('{files}', '2').replace('{pages}', '3')
    );

    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    assert.equal(uploadedFile.type, 'application/pdf');
    const loaded = await PDFDocument.load(await uploadedFile.arrayBuffer());
    assert.equal(loaded.getPageCount(), 3);
    document.defaultView.close();
});

test('single image for a PDF-only requirement is converted to PDF via merger before upload', async () => {
    const { document, card } = createCard();
    const requirement = createRequirement({ max_byte_size: 1024 * 1024 });
    const photo = new File(['photo'], 'passport.jpg', { type: 'image/jpeg' });
    const mergedPdf = await createPdfFile(1, 'combined-document.pdf');
    let intentFile = null;

    const control = initializeResubmissionUpload(card, requirement, {
        async createResubmissionUploadIntent(_code, file) {
            intentFile = file;
            return { upload: { intent_id: 'single-img-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    }, {
        createMultiPageDocumentPdf: async (files) => {
            assert.deepEqual(files, [photo]);
            return mergedPdf;
        },
        putStudentDocumentDirect: async () => {}
    });

    chooseFiles(document, control.fileInput, [photo]);
    await waitFor(() => !control.button.disabled);
    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    assert.equal(intentFile, mergedPdf);
    document.defaultView.close();
});

test('merger error codes show localized messages and block upload', async () => {
    const cases = [
        ['TOO_MANY_FILES', SESSION3_MESSAGES.en.tooManyFiles],
        ['INVALID_FILE', SESSION3_MESSAGES.en.invalidFileType],
        ['FILE_TOO_LARGE', SESSION3_MESSAGES.en.fileTooLarge],
        ['MULTI_FILE_PROCESSING_FAILED', SESSION3_MESSAGES.en.multiFileProcessingFailed]
    ];

    for (const [errorCode, expectedMessage] of cases) {
        const { document, card } = createCard();
        document.documentElement.lang = 'en';
        let intentCalls = 0;
        const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 1024 * 1024 }), {
            async createResubmissionUploadIntent() { intentCalls += 1; }
        }, {
            createMultiPageDocumentPdf: async () => {
                throw Object.assign(new Error(errorCode), { code: errorCode });
            }
        });

        chooseFiles(document, control.fileInput, [
            new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
            new File(['b'], 'b.jpg', { type: 'image/jpeg' })
        ]);
        await waitFor(() => control.status.getAttribute('role') === 'alert');

        assert.equal(control.button.disabled, true);
        assert.equal(control.fileInput.getAttribute('aria-invalid'), 'true');
        assert.equal(control.status.textContent, expectedMessage);
        control.button.click();
        await flushEvents();
        assert.equal(intentCalls, 0);
        document.defaultView.close();
    }
});

test('real merger rejects too many files, unsupported files in multi-select, and oversized output', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 10 }), {
        async createResubmissionUploadIntent() { intentCalls += 1; }
    });

    // 21 dosya sınırı
    const twentyOneFiles = Array.from({ length: 21 }, (_, idx) => new File(['x'], `${idx}.jpg`, { type: 'image/jpeg' }));
    chooseFiles(document, control.fileInput, twentyOneFiles);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.tooManyFiles);
    assert.equal(control.button.disabled, true);

    // Çoklu seçimde desteklenmeyen dosya türü
    chooseFiles(document, control.fileInput, [
        new File(['img'], 'a.png', { type: 'image/png' }),
        new File(['txt'], 'notes.txt', { type: 'text/plain' })
    ]);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.invalidFileType);
    assert.equal(control.button.disabled, true);

    // Boyut sınırı aşımı
    chooseFiles(document, control.fileInput, [
        new File(['012345678901'], 'large1.jpg', { type: 'image/jpeg' }),
        new File(['012345678901'], 'large2.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.fileTooLarge);
    assert.equal(control.button.disabled, true);
    assert.equal(intentCalls, 0);
    document.defaultView.close();
});

test('second file selection replaces the first and ignores stale in-flight merge', async () => {
    const { document, card } = createCard();
    const requirement = createRequirement({ max_byte_size: 1024 * 1024 });
    const firstPdf = await createPdfFile(2, 'first.pdf');
    const secondPdf = await createPdfFile(1, 'second.pdf');
    let releaseFirstMerge;
    let mergeCount = 0;
    const uploadedFiles = [];

    const control = initializeResubmissionUpload(card, requirement, {
        async createResubmissionUploadIntent(_code, file) {
            uploadedFiles.push(file);
            return { upload: { intent_id: 'second-wins', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    }, {
        createMultiPageDocumentPdf: async () => {
            mergeCount += 1;
            if (mergeCount === 1) {
                return new Promise((resolve) => { releaseFirstMerge = () => resolve(firstPdf); });
            }
            return secondPdf;
        },
        putStudentDocumentDirect: async () => {}
    });

    chooseFiles(document, control.fileInput, [
        new File(['1'], '1.jpg', { type: 'image/jpeg' }),
        new File(['2'], '2.jpg', { type: 'image/jpeg' })
    ]);
    assert.equal(control.button.disabled, true);

    // İlk birleştirme bitmeden ikinci seçim yapılır
    chooseFiles(document, control.fileInput, [
        new File(['3'], '3.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => !control.button.disabled);
    assert.equal(
        control.status.textContent,
        PUBLIC_MESSAGES.tr.resubmissionUploadMergedReady.replace('{files}', '1').replace('{pages}', '1')
    );

    // Geciken ilk birleştirme sonradan çözülse de ikinci seçimi ezmemeli
    releaseFirstMerge();
    await flushEvents();
    assert.equal(
        control.status.textContent,
        PUBLIC_MESSAGES.tr.resubmissionUploadMergedReady.replace('{files}', '1').replace('{pages}', '1')
    );

    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.deepEqual(uploadedFiles, [secondPdf]);
    document.defaultView.close();
});

test('merger failure leaves the control usable for a subsequent valid selection', async () => {
    const { document, card } = createCard();
    const requirement = createRequirement({ max_byte_size: 1024 * 1024 });
    const recoveredPdf = await createPdfFile(2, 'recovered.pdf');
    let attempt = 0;
    let uploadedFile = null;

    const control = initializeResubmissionUpload(card, requirement, {
        async createResubmissionUploadIntent(_code, file) {
            uploadedFile = file;
            return { upload: { intent_id: 'recovered-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { upload_status: 'finalized' }; }
    }, {
        createMultiPageDocumentPdf: async () => {
            attempt += 1;
            if (attempt === 1) throw Object.assign(new Error('boom'), { code: 'MULTI_FILE_PROCESSING_FAILED' });
            return recoveredPdf;
        },
        putStudentDocumentDirect: async () => {}
    });

    chooseFiles(document, control.fileInput, [
        new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }),
        new File(['bad2'], 'bad2.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.fileInput.disabled, false);
    assert.equal(control.button.disabled, true);
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.multiFileProcessingFailed);

    chooseFiles(document, control.fileInput, [
        new File(['ok1'], 'ok1.jpg', { type: 'image/jpeg' }),
        new File(['ok2'], 'ok2.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => !control.button.disabled);
    assert.equal(control.fileInput.getAttribute('aria-invalid'), 'false');
    assert.equal(control.status.getAttribute('role'), 'status');

    control.button.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(uploadedFile, recoveredPdf);
    document.defaultView.close();
});
