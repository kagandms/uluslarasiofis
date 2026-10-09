import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';

const pageHtml = readFileSync(new URL('../yazdir/index.html', import.meta.url), 'utf8');

function createCapabilities({ allowColor = false } = {}) {
    return { paper_sizes: ['A4'], color_modes: allowColor ? ['monochrome', 'color'] : ['monochrome'], duplex_modes: ['simplex'],
        orientations: ['portrait', 'landscape'], limits: { max_copies: 50, max_page_copies: 200 } };
}

function installBrowserGlobals(dom, fetchHandler, languages = ['tr-TR'], language = 'en-US') {
    Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: languages });
    Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: language });
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.sessionStorage = dom.window.sessionStorage;
    globalThis.fetch = fetchHandler;
    dom.window.setInterval = () => 1;
    dom.window.setTimeout = () => new Promise(() => {});
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail('Browser UI did not reach the expected state.');
}

test('multi-file browser flow extracts selected pages and preserves each card settings', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    const intents = [];
    const uploadedFiles = [];
    installBrowserGlobals(dom, async (url, options = {}) => {
        if (String(url).endsWith('/api/public/print/status')) {
            const options = createCapabilities({ allowColor: true });
            return { ok: true, json: async () => ({ available: true, options, limits: options.limits }) };
        }
        if (String(url).endsWith('/api/public/print/upload-intents')) {
            intents.push(JSON.parse(options.body));
            const id = `job-${intents.length}`;
            return { ok: true, json: async () => ({ job_id: id, status: 'uploading', upload: {
                url: `/upload/${id}`, method: 'PUT', requiredHeaders: {}
            } }) };
        }
        if (String(url).startsWith('/upload/')) {
            uploadedFiles.push(options.body);
            return { ok: true };
        }
        if (String(url).endsWith('/finalize')) return { ok: true };
        if (String(url).endsWith('/jobs/status')) return { ok: true, json: async () => ({ status: 'queued' }) };
        throw new Error(`Unexpected request: ${url}`);
    });

    try {
        await import(`../src/public/print.js?flow=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'ready');
        const sourcePdf = await PDFDocument.create();
        for (let index = 0; index < 30; index += 1) sourcePdf.addPage([595, 842]);
        const pdfFile = new File([await sourcePdf.save()], 'otuz-sayfa.pdf', { type: 'application/pdf' });
        const imageFile = new File([new Uint8Array([1, 2, 3])], 'fotograf.png', { type: 'image/png' });
        const fileInput = dom.window.document.querySelector('#print-file-input');
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [pdfFile, imageFile] });
        fileInput.dispatchEvent(new dom.window.Event('change'));
        await waitFor(() => dom.window.document.querySelector('.page-selection-hint')?.textContent.includes('30 seçili'));

        const [pdfCard, imageCard] = dom.window.document.querySelectorAll('.print-file-card');
        const pageChoice = pdfCard.querySelector('[data-pages="custom"]');
        const pageRange = pdfCard.querySelector('.page-range-input');
        assert.equal(pageRange.hidden, true);
        assert.equal(pdfCard.querySelector('.page-selection-hint').hidden, true);
        pageChoice.checked = true;
        pageChoice.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(pageRange.hidden, false);
        assert.equal(pdfCard.querySelector('.page-selection-hint').hidden, false);
        pageRange.value = '1-5';
        pageRange.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        pdfCard.querySelector('[data-setting="orientation"]').value = 'landscape';
        pdfCard.querySelector('[data-setting="color_mode"]').value = 'color';
        pdfCard.querySelector('[data-setting="copies"]').value = '2';
        pdfCard.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        imageCard.querySelector('[data-setting="copies"]').value = '3';
        imageCard.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.equal(dom.window.document.querySelector('#print-page-total').textContent, '13 baskı sayfası');

        const submitButton = dom.window.document.querySelector('#print-submit');
        assert.equal(submitButton.disabled, false);
        submitButton.click();
        await waitFor(() => intents.length === 2 && uploadedFiles.length === 2);

        assert.equal(intents[0].copies, 2);
        assert.equal(intents[0].orientation, 'landscape');
        assert.equal(intents[0].color_mode, 'color');
        assert.equal(intents[0].media_type, 'application/pdf');
        assert.equal(intents[1].copies, 3);
        assert.equal(intents[1].orientation, 'portrait');
        assert.equal(intents[1].color_mode, 'monochrome');
        assert.equal(intents[1].media_type, 'image/png');
        const extractedPdf = await PDFDocument.load(await uploadedFiles[0].arrayBuffer());
        assert.equal(extractedPdf.getPageCount(), 5);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('the student page keeps color disabled while the Worker capability is monochrome-only', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    installBrowserGlobals(dom, async () => ({ ok: true, json: async () => ({
        available: true, options: createCapabilities()
    }) }));

    try {
        await import(`../src/public/print.js?color-disabled=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'ready');
        const fileInput = dom.window.document.querySelector('#print-file-input');
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [
            new File([new Uint8Array([1, 2, 3])], 'belge.png', { type: 'image/png' })
        ] });
        fileInput.dispatchEvent(new dom.window.Event('change'));
        const colorSelect = dom.window.document.querySelector('[data-setting="color_mode"]');
        assert.equal(colorSelect.querySelector('option[value="color"]').disabled, true);
        colorSelect.value = 'color';
        colorSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(dom.window.document.querySelector('#print-submit').disabled, true);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('refresh only checks an uncertain print job and never submits it again', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    let intentCount = 0;
    const refreshToken = 'a'.repeat(64);
    dom.window.sessionStorage.setItem('print.job-history.v2', JSON.stringify([
        { name: 'bekleyen.pdf', status: 'uploading', trackingToken: refreshToken }
    ]));
    installBrowserGlobals(dom, async (url) => {
        if (String(url).endsWith('/api/public/print/status')) {
            return { ok: true, json: async () => ({ available: true, options: createCapabilities() }) };
        }
        if (String(url).endsWith('/api/public/print/jobs/status')) {
            return { ok: true, json: async () => ({ status: 'unknown' }) };
        }
        if (String(url).endsWith('/api/public/print/upload-intents')) intentCount += 1;
        throw new Error(`Unexpected request: ${url}`);
    });

    try {
        await import(`../src/public/print.js?refresh=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('.print-history-item p:last-child')?.textContent.includes('henüz doğrulanamadı'));
        assert.equal(intentCount, 0);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('an offline printer disables submission and shows a Turkish availability message', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    installBrowserGlobals(dom, async () => ({ ok: true, json: async () => ({
        available: false, options: createCapabilities()
    }) }));

    try {
        await import(`../src/public/print.js?offline=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'unavailable');
        assert.equal(dom.window.document.querySelector('#print-availability').textContent,
            'Yazıcı şu anda çevrimdışı veya kullanılamıyor.');
        assert.equal(dom.window.document.querySelector('#print-submit').disabled, true);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('automatic Arabic selection sets page RTL while keeping page-number fields LTR', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    installBrowserGlobals(dom, async () => ({ ok: true, json: async () => ({
        available: true, options: createCapabilities()
    }) }), ['ar-SA', 'en-US']);

    try {
        await import(`../src/public/print.js?arabic=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'ready');
        assert.equal(dom.window.document.documentElement.lang, 'ar');
        assert.equal(dom.window.document.documentElement.dir, 'rtl');
        assert.equal(dom.window.document.querySelector('#print-title').textContent, 'طباعة مستند');
        assert.equal(dom.window.document.querySelector('#print-language'), null);
        assert.equal(dom.window.document.querySelector('#print-file-input').multiple, true);
        const sourcePdf = await PDFDocument.create();
        sourcePdf.addPage([595, 842]);
        const fileInput = dom.window.document.querySelector('#print-file-input');
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [
            new File([await sourcePdf.save()], 'arabic.pdf', { type: 'application/pdf' })
        ] });
        fileInput.dispatchEvent(new dom.window.Event('change'));
        await waitFor(() => dom.window.document.querySelector('.page-selection-hint')?.textContent.includes('1'));
        const card = dom.window.document.querySelector('.print-file-card');
        assert.equal(card.querySelector('[data-setting="copies"]').dir, 'ltr');
        assert.equal(card.querySelector('.page-range-input').dir, 'ltr');
        assert.equal(card.querySelector('.page-range-input').hidden, true);
        assert.match(card.querySelector('.print-settings-summary').textContent, /أبيض وأسود/);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('a legacy saved manual locale is ignored and browser preferences are sampled once', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    dom.window.localStorage.setItem('print.locale.v1', 'tk');
    installBrowserGlobals(dom, async () => ({ ok: true, json: async () => ({
        available: false, options: createCapabilities()
    }) }), ['ar-SA'], 'en-US');

    try {
        await import(`../src/public/print.js?stored-locale=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'unavailable');
        assert.equal(dom.window.document.documentElement.lang, 'ar');
        assert.equal(dom.window.document.documentElement.dir, 'rtl');
        assert.equal(dom.window.document.querySelector('#print-title').textContent, 'طباعة مستند');
        assert.equal(dom.window.document.querySelector('#print-language'), null);
        Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['ru-RU'] });
        assert.equal(dom.window.document.documentElement.lang, 'ar');
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('browser locale stays fixed during submission while files and print settings remain intact', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    dom.window.localStorage.setItem('print.locale.v1', 'tk');
    let releaseIntent;
    const intentPending = new Promise((resolve) => { releaseIntent = resolve; });
    const intents = [];
    installBrowserGlobals(dom, async (url, options = {}) => {
        if (String(url).endsWith('/api/public/print/status')) {
            return { ok: true, json: async () => ({ available: true, options: createCapabilities({ allowColor: true }) }) };
        }
        if (String(url).endsWith('/api/public/print/upload-intents')) {
            intents.push(JSON.parse(options.body));
            return intentPending;
        }
        if (String(url).startsWith('/upload/')) return { ok: true };
        if (String(url).endsWith('/finalize')) return { ok: true };
        if (String(url).endsWith('/jobs/status')) return { ok: true, json: async () => ({ status: 'queued' }) };
        throw new Error(`Unexpected request: ${url}`);
    }, ['ru-RU'], 'ar-SA');

    try {
        await import(`../src/public/print.js?locale-state=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'ready');
        const sourcePdf = await PDFDocument.create();
        sourcePdf.addPage([595, 842]);
        sourcePdf.addPage([595, 842]);
        const fileInput = dom.window.document.querySelector('#print-file-input');
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [
            new File([await sourcePdf.save()], 'preserve.pdf', { type: 'application/pdf' })
        ] });
        fileInput.dispatchEvent(new dom.window.Event('change'));
        await waitFor(() => dom.window.document.querySelector('.page-selection-hint')?.textContent.includes('2'));
        const originalCard = dom.window.document.querySelector('.print-file-card');
        originalCard.querySelector('[data-pages="custom"]').checked = true;
        originalCard.querySelector('[data-pages="custom"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        originalCard.querySelector('.page-range-input').value = '2';
        originalCard.querySelector('[data-setting="color_mode"]').value = 'color';
        originalCard.querySelector('[data-setting="copies"]').value = '4';
        originalCard.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        assert.equal(dom.window.document.documentElement.lang, 'ru');
        assert.equal(dom.window.document.documentElement.dir, 'ltr');
        assert.equal(dom.window.document.querySelector('#print-language'), null);
        assert.equal(dom.window.document.querySelector('.print-file-card'), originalCard);
        assert.equal(originalCard.querySelector('[data-pages="custom"]').checked, true);
        assert.equal(originalCard.querySelector('.page-range-input').value, '2');
        assert.equal(originalCard.querySelector('[data-setting="color_mode"]').value, 'color');
        assert.equal(originalCard.querySelector('[data-setting="copies"]').value, '4');
        assert.equal(dom.window.localStorage.getItem('print.locale.v1'), 'tk');

        dom.window.document.querySelector('#print-submit').click();
        await waitFor(() => intents.length === 1);
        Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['ar-SA'] });
        assert.equal(dom.window.document.documentElement.lang, 'ru');
        assert.equal(dom.window.document.documentElement.dir, 'ltr');
        assert.match(dom.window.document.querySelector('#print-message').textContent, /Загрузка файла/);
        assert.equal(dom.window.document.querySelector('#print-submit').textContent, 'Отправка файлов…');

        releaseIntent({ ok: true, json: async () => ({ job_id: 'job-locale', status: 'uploading', upload: {
            url: '/upload/job-locale', method: 'PUT', requiredHeaders: {}
        } }) });
        await waitFor(() => dom.window.document.querySelector('#print-message').textContent === 'Задания на печать добавлены в очередь.');
        assert.equal(intents[0].color_mode, 'color');
        assert.equal(intents[0].copies, 4);
        assert.equal(intents[0].media_type, 'application/pdf');
        assert.equal(dom.window.document.querySelectorAll('.print-file-card').length, 0);
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});

test('all-pages mode hides and ignores stale PDF range input while preserving file settings', async () => {
    const dom = new JSDOM(pageHtml, { url: 'https://portal.test/yazdir/' });
    const intents = [];
    const uploadedFiles = [];
    installBrowserGlobals(dom, async (url, options = {}) => {
        if (String(url).endsWith('/api/public/print/status')) {
            return { ok: true, json: async () => ({ available: true, options: createCapabilities() }) };
        }
        if (String(url).endsWith('/api/public/print/upload-intents')) {
            intents.push(JSON.parse(options.body));
            return { ok: true, json: async () => ({ job_id: 'all-pages', status: 'uploading', upload: {
                url: '/upload/all-pages', method: 'PUT', requiredHeaders: {}
            } }) };
        }
        if (String(url).startsWith('/upload/')) {
            uploadedFiles.push(options.body);
            return { ok: true };
        }
        if (String(url).endsWith('/finalize')) return { ok: true };
        if (String(url).endsWith('/jobs/status')) return { ok: true, json: async () => ({ status: 'queued' }) };
        throw new Error(`Unexpected request: ${url}`);
    });

    try {
        await import(`../src/public/print.js?all-pages=${crypto.randomUUID()}`);
        await waitFor(() => dom.window.document.querySelector('#print-availability').dataset.state === 'ready');
        const sourcePdf = await PDFDocument.create();
        for (let index = 0; index < 3; index += 1) sourcePdf.addPage([595, 842]);
        const sourceFile = new File([await sourcePdf.save()], 'all-pages.pdf', { type: 'application/pdf' });
        const fileInput = dom.window.document.querySelector('#print-file-input');
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [sourceFile] });
        fileInput.dispatchEvent(new dom.window.Event('change'));
        await waitFor(() => dom.window.document.querySelector('.page-selection-hint')?.textContent.includes('3'));

        const card = dom.window.document.querySelector('.print-file-card');
        const rangeInput = card.querySelector('.page-range-input');
        const hint = card.querySelector('.page-selection-hint');
        assert.equal(rangeInput.hidden, true);
        assert.equal(hint.hidden, true);
        rangeInput.value = 'invalid range';
        rangeInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.equal(card.querySelector('.file-error').textContent, '');
        assert.equal(dom.window.document.querySelector('#print-submit').disabled, false);

        const customPages = card.querySelector('[data-pages="custom"]');
        customPages.checked = true;
        customPages.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(rangeInput.hidden, false);
        assert.equal(hint.hidden, false);
        assert.equal(dom.window.document.querySelector('#print-submit').disabled, true);
        rangeInput.value = '1-2';
        rangeInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        card.querySelector('[data-setting="copies"]').value = '2';
        card.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const allPages = card.querySelector('[data-pages="all"]');
        allPages.checked = true;
        allPages.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(rangeInput.hidden, true);
        assert.equal(hint.hidden, true);
        assert.equal(rangeInput.value, '1-2');
        rangeInput.value = 'invalid range';
        rangeInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.equal(card.querySelector('.file-error').textContent, '');
        assert.equal(card.querySelector('[data-setting="copies"]').value, '2');
        assert.equal(dom.window.document.querySelectorAll('.print-file-card').length, 1);
        assert.equal(dom.window.document.querySelector('#print-submit').disabled, false);

        dom.window.document.querySelector('#print-submit').click();
        await waitFor(() => intents.length === 1 && uploadedFiles.length === 1);
        const uploadedPdf = await PDFDocument.load(await uploadedFiles[0].arrayBuffer());
        assert.equal(uploadedPdf.getPageCount(), 3);
        assert.equal(intents[0].copies, 2);
        assert.equal(intents[0].media_type, 'application/pdf');
    } finally {
        dom.window.close();
        delete globalThis.document;
        delete globalThis.window;
        delete globalThis.sessionStorage;
        delete globalThis.fetch;
    }
});
