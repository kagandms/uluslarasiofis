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
    await flushEvents();

    assert.equal(control.fileInput.getAttribute('aria-invalid'), 'true');
    assert.equal(control.status.getAttribute('role'), 'alert');
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
    await flushEvents();
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadConflict);
    assert.ok(control.retryButton);
    control.retryButton.click();
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
    assert.equal(card.querySelector('label.application-upload-sr').textContent, PUBLIC_MESSAGES.ar.uploadDocument);
    document.defaultView.close();
});

test('file input enables multi-selection and allows merger image types alongside PDF', () => {
    const { document, card } = createCard();
    const control = initializeResubmissionUpload(card, createRequirement(), {});
    assert.equal(control.fileInput.multiple, true);
    assert.deepEqual(control.fileInput.accept.split(','), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    assert.equal(card.querySelector('label.application-upload-sr').textContent, PUBLIC_MESSAGES.tr.uploadDocument);
    assert.equal(control.button.dataset.action, 'document-compose');

    const imageOnly = createCard();
    const imageControl = initializeResubmissionUpload(imageOnly.card, createRequirement({ accepted_media_types: ['image/jpeg'] }), {});
    assert.equal(imageControl.fileInput.multiple, true);
    assert.equal(imageControl.fileInput.accept, 'image/jpeg');
    assert.equal(imageControl.button.dataset.action, 'document-pick');

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
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    assert.deepEqual(receivedMergeFiles, [img1, img2]);
    assert.equal(receivedMergeOptions.maxByteSize, requirement.max_byte_size);
    assert.equal(receivedMergeOptions.document, document);
    assert.equal(intentFile, mergedPdf);
    assert.equal(directPutFile, mergedPdf);
    document.defaultView.close();
});

test('real multi-file PDF merge combines PDFs and uploads the merged PDF', async () => {
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

        assert.equal(control.fileInput.getAttribute('aria-invalid'), 'true');
        assert.equal(control.status.textContent, expectedMessage);
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

    // Çoklu seçimde desteklenmeyen dosya türü
    chooseFiles(document, control.fileInput, [
        new File(['img'], 'a.png', { type: 'image/png' }),
        new File(['txt'], 'notes.txt', { type: 'text/plain' })
    ]);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.invalidFileType);

    // Boyut sınırı aşımı
    chooseFiles(document, control.fileInput, [
        new File(['012345678901'], 'large1.jpg', { type: 'image/jpeg' }),
        new File(['012345678901'], 'large2.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => control.status.getAttribute('role') === 'alert');
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.fileTooLarge);
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
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);

    // Geciken ilk birleştirme sonradan çözülse de ikinci seçimi ezmemeli
    releaseFirstMerge();
    await flushEvents();
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
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
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.multiFileProcessingFailed);

    chooseFiles(document, control.fileInput, [
        new File(['ok1'], 'ok1.jpg', { type: 'image/jpeg' }),
        new File(['ok2'], 'ok2.jpg', { type: 'image/jpeg' })
    ]);
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(uploadedFile, recoveredPdf);
    document.defaultView.close();
});


test('composer opens with wizard options and uploads immediately on onSave with progress updates', async () => {
    const { document, card } = createCard();
    let composerOptions = null;
    let releasePut;
    let completedMeta = null;
    const api = {
        async createResubmissionUploadIntent(code, file) {
            assert.equal(code, 'passport');
            assert.equal(file.name, 'passport_sayfalar.pdf');
            assert.equal(file.type, 'application/pdf');
            return { upload: { intent_id: 'composer-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload(intentId) {
            assert.equal(intentId, 'composer-intent');
            return { document: { code: 'passport', scan_status: 'pending' } };
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 1024 }), api, {
        openPdfMergerModal: (opts) => { composerOptions = opts; },
        putStudentDocumentDirect: async (_upload, _file, { onProgress }) => {
            onProgress(45);
            await new Promise((resolve) => { releasePut = resolve; });
        },
        onComplete: async (code, meta) => { completedMeta = { code, meta }; }
    });

    control.button.click();
    await flushEvents();
    assert.ok(composerOptions);
    assert.equal(composerOptions.studentMode, true);
    assert.equal(composerOptions.hideStopCapture, true);
    assert.equal(composerOptions.maxFiles, 30);
    assert.equal(composerOptions.contextLabel, PUBLIC_MESSAGES.tr.documentPagesHelp);
    assert.equal(composerOptions.confirmLabel, PUBLIC_MESSAGES.tr.documentPagesConfirm);
    assert.equal(composerOptions.successMessage, PUBLIC_MESSAGES.tr.documentPagesUploaded);
    assert.ok(composerOptions.text.studentReady);
    assert.equal(composerOptions.text.confirmSave, 'Kontrol ettim, başvuruma ekle');

    const savePromise = composerOptions.onSave(new Uint8Array([1, 2, 3, 4]));
    await waitFor(() => Boolean(releasePut));
    const progress = card.querySelector('progress');
    assert.ok(progress);
    assert.equal(progress.value, 45);
    assert.ok(control.cancelButton);
    assert.equal(control.button.disabled, true);

    // Second click while uploading must not open composer again
    const prevOptions = composerOptions;
    composerOptions = null;
    control.button.click();
    await flushEvents();
    assert.equal(composerOptions, null);
    assert.ok(prevOptions);

    releasePut();
    await savePromise;
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.deepEqual(completedMeta, { code: 'passport', meta: { code: 'passport', scan_status: 'pending' } });
    document.defaultView.close();
});

test('onSave throws on upload failure and retry recovers without re-taking photos', async () => {
    const { document, card } = createCard();
    let composerOptions = null;
    let intentCalls = 0;
    let putCalls = 0;
    let finalizeCalls = 0;
    const api = {
        async createResubmissionUploadIntent(_code, file) {
            intentCalls += 1;
            if (intentCalls === 1) throw Object.assign(new Error('expired'), { code: 'UPLOAD_CAPABILITY_EXPIRED' });
            assert.equal(file.name, 'passport_sayfalar.pdf');
            return { upload: { intent_id: `intent-${intentCalls}`, method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload(intentId) {
            finalizeCalls += 1;
            if (finalizeCalls === 1) throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' });
            assert.equal(intentId, 'intent-3');
            return { document: { code: 'passport', scan_status: 'pending' } };
        }
    };
    const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 1024 }), api, {
        openPdfMergerModal: (opts) => { composerOptions = opts; },
        putStudentDocumentDirect: async () => {
            putCalls += 1;
            if (putCalls === 1) throw Object.assign(new Error('net'), { code: 'UPLOAD_NETWORK_ERROR' });
        }
    });

    control.button.click();
    await flushEvents();

    // 1. Failed intent
    await assert.rejects(
        () => composerOptions.onSave(new Uint8Array([1, 2, 3])),
        (err) => err.message === PUBLIC_MESSAGES.tr.resubmissionUploadCapabilityExpired
    );
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadCapabilityExpired);
    assert.ok(control.retryButton);

    // 2. Retry -> intent succeeds, PUT fails
    control.retryButton.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadNetworkError);
    assert.equal(intentCalls, 2);
    assert.equal(putCalls, 1);
    assert.ok(control.retryButton);

    // 3. Retry -> intent + PUT succeed, finalize fails with NETWORK_ERROR (keeps intent_id!)
    control.retryButton.click();
    await waitFor(() => finalizeCalls === 1);
    assert.equal(intentCalls, 3);
    assert.equal(putCalls, 2);
    assert.equal(control.status.textContent, PUBLIC_MESSAGES.tr.resubmissionUploadNetworkError);
    assert.ok(control.retryButton);

    // 4. Retry -> retries finalize with SAME intent_id ('intent-3') without new intent or PUT
    control.retryButton.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(intentCalls, 3);
    assert.equal(putCalls, 2);
    assert.equal(finalizeCalls, 2);
    document.defaultView.close();
});

test('cancel aborts active PUT and retry uploads the same file', async () => {
    const { document, card } = createCard();
    let composerOptions = null;
    let putAttempt = 0;
    const api = {
        async createResubmissionUploadIntent() {
            return { upload: { intent_id: `cancel-retry-${putAttempt + 1}`, method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { document: { code: 'passport', scan_status: 'pending' } }; }
    };
    const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 1024 }), api, {
        openPdfMergerModal: (opts) => { composerOptions = opts; },
        putStudentDocumentDirect: async (_upload, _file, { signal }) => {
            putAttempt += 1;
            if (putAttempt === 1) {
                await new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        reject(Object.assign(new Error('cancelled'), { code: 'UPLOAD_CANCELLED' }));
                    });
                });
            }
        }
    });

    control.button.click();
    await flushEvents();
    const savePromise = composerOptions.onSave(new Uint8Array([1, 2, 3, 4]));
    await waitFor(() => Boolean(control.cancelButton));
    control.cancelButton.click();
    await assert.rejects(() => savePromise);

    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.uploadState_cancelled);
    assert.ok(control.retryButton);

    control.retryButton.click();
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(putAttempt, 2);
    document.defaultView.close();
});

test('session failure inside composer onSave closes modal overlay and calls onSessionFailure', async () => {
    const { document, card } = createCard();
    const overlay = document.createElement('div');
    overlay.id = 'pdf-merger-modal-overlay';
    document.body.append(overlay);

    let composerOptions = null;
    let sessionFailures = 0;
    const control = initializeResubmissionUpload(card, createRequirement({ max_byte_size: 1024 }), {
        async createResubmissionUploadIntent() {
            throw Object.assign(new Error('expired'), { status: 401, code: 'APPLICATION_SESSION_REQUIRED' });
        }
    }, {
        openPdfMergerModal: (opts) => { composerOptions = opts; },
        onSessionFailure: () => { sessionFailures += 1; }
    });

    control.button.click();
    await flushEvents();
    await assert.rejects(() => composerOptions.onSave(new Uint8Array([1, 2, 3])));
    assert.equal(sessionFailures, 1);
    assert.equal(document.getElementById('pdf-merger-modal-overlay'), null);
    document.defaultView.close();
});

test('non-PDF requirement uses plain file chooser fallback and uploads immediately after selection', async () => {
    const { document, card } = createCard();
    let intentCalls = 0;
    let uploadedFile = null;
    const api = {
        async createResubmissionUploadIntent(_code, file) {
            intentCalls += 1;
            uploadedFile = file;
            return { upload: { intent_id: 'photo-intent', method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() { return { document: { code: 'biometric_photo', scan_status: 'pending' } }; }
    };
    const control = initializeResubmissionUpload(card, createRequirement({
        code: 'biometric_photo',
        accepted_media_types: ['image/jpeg', 'image/png'],
        max_byte_size: 100
    }), api, {
        putStudentDocumentDirect: async () => {}
    });

    assert.equal(control.button.dataset.action, 'document-pick');
    let inputClicked = false;
    control.fileInput.click = () => { inputClicked = true; };
    control.button.click();
    assert.equal(inputClicked, true);

    // Oversized file is rejected without intent
    chooseFile(document, control.fileInput, { name: 'big.jpg', type: 'image/jpeg', size: 200 });
    await flushEvents();
    assert.equal(intentCalls, 0);
    assert.equal(control.status.textContent, SESSION3_MESSAGES.tr.fileTooLarge);

    // Valid image uploads immediately
    chooseFile(document, control.fileInput, { name: 'photo.jpg', type: 'image/jpeg', size: 50 });
    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(intentCalls, 1);
    assert.equal(uploadedFile.name, 'photo.jpg');
    document.defaultView.close();
});


test('re-upload card with existing file uses pending tone while uploading/verifying/cancelled and success only after finalize', async () => {
    const { document, card } = createCard();
    let releasePut;
    let releaseFinalize;
    let putAttempt = 0;
    const control = initializeResubmissionUpload(card, createRequirement({
        filename: 'existing-passport.pdf',
        status: 'resubmission_required'
    }), {
        async createResubmissionUploadIntent() {
            return { upload: { intent_id: `tone-intent-${putAttempt + 1}`, method: 'PUT', url: 'https://capability.invalid', required_headers: {} } };
        },
        async finalizeResubmissionUpload() {
            await new Promise((resolve) => { releaseFinalize = resolve; });
            return { document: { code: 'passport', scan_status: 'pending' } };
        }
    }, {
        putStudentDocumentDirect: async (_upload, _file, { signal }) => {
            putAttempt += 1;
            if (putAttempt === 1) {
                await new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        reject(Object.assign(new Error('cancelled'), { code: 'UPLOAD_CANCELLED' }));
                    });
                });
                return;
            }
            await new Promise((resolve) => { releasePut = resolve; });
        }
    });

    // Preview link is present and initial status is error
    assert.ok(card.querySelector('.document-preview-link'));
    assert.equal(control.status.dataset.status, 'error');

    // First attempt: cancel during upload -> cancelled must be pending (not success)
    chooseFile(document, control.fileInput);
    await waitFor(() => Boolean(control.cancelButton));
    assert.equal(control.status.dataset.status, 'pending');
    assert.equal(control.status.classList.contains('is-success'), false);
    control.cancelButton.click();
    await waitFor(() => control.status.textContent === SESSION3_MESSAGES.tr.uploadState_cancelled);
    assert.equal(control.status.dataset.status, 'pending');
    assert.equal(control.status.classList.contains('is-success'), false);

    // Retry: uploading -> pending, verifying -> pending, complete -> success
    control.retryButton.click();
    await waitFor(() => Boolean(releasePut));
    assert.equal(control.status.dataset.status, 'pending');
    assert.equal(control.status.classList.contains('is-success'), false);
    releasePut();

    await waitFor(() => Boolean(releaseFinalize));
    assert.equal(control.status.dataset.status, 'pending');
    assert.equal(control.status.classList.contains('is-success'), false);
    releaseFinalize();

    await waitFor(() => control.status.textContent === PUBLIC_MESSAGES.tr.resubmissionUploadComplete);
    assert.equal(control.status.dataset.status, 'success');
    assert.ok(control.status.classList.contains('is-success'));
    assert.ok(card.querySelector('.document-preview-link'));
    document.defaultView.close();
});
