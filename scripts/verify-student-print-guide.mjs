import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';

const { chromium } = await import(process.env.PRINT_GUIDE_PLAYWRIGHT_MODULE || 'playwright');
const outputDirectory = resolve(process.env.PRINT_GUIDE_QA_OUTPUT || 'docs/student-print-guide-evidence');
const capabilities = { paper_sizes: ['A4'], color_modes: ['monochrome'], duplex_modes: ['simplex'],
    orientations: ['portrait', 'landscape'], limits: { max_copies: 50, max_page_copies: 200 } };
const staffDocument = new JSDOM(await readFile('yetkili/index.html', 'utf8')).window.document;
const staffPanel = staffDocument.querySelector('#view-print');
staffPanel.hidden = false;
function serveStaffPreview(_request, response) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="tr"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/staff/print-management.css">
        <body><main style="padding:24px;max-width:1280px;margin:auto">${staffPanel.outerHTML}</main>
        <script type="module">import { initializeStaffPrintStatus } from '/src/staff/print-status.js';
        initializeStaffPrintStatus(); document.dispatchEvent(new CustomEvent('workspace:view-changed',{detail:{viewName:'print'}}));</script></body></html>`);
}
const server = await createServer({ configFile: false,
    plugins: [{ name: 'student-print-guide-qa', configureServer(server) { server.middlewares.use('/print-staff-qa', serveStaffPreview); } }],
    server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.PRINT_GUIDE_BROWSER || 'chrome' });
const results = [];
const pageErrors = [];

async function mockStudentRoutes(page) {
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/api/**', async (route) => {
        assert.ok(route.request().url().endsWith('/api/public/print/status'), 'QA must not create a real print job');
        await route.fulfill({ json: { available: true, options: capabilities, limits: capabilities.limits } });
    });
}

async function addSyntheticPdf(page) {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 3; index += 1) pdf.addPage([595, 842]);
    await page.locator('#print-file-input').setInputFiles({ name: 'SYNTHETIC-Öğrenci-Русский-document.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await page.waitForFunction(() => !document.querySelector('#print-submit').disabled);
    await page.locator('[data-pages=custom]').check();
    await page.locator('.page-range-input').fill('1,3');
    await page.locator('[data-setting=copies]').fill('2');
    await page.locator('[data-setting=orientation]').selectOption('landscape');
}

async function verifyLanguage(page, locale) {
    await page.locator('#print-language').selectOption(locale);
    const state = await page.evaluate(() => ({ language: document.documentElement.lang, direction: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth > innerWidth, cards: document.querySelectorAll('.print-file-card').length,
        range: document.querySelector('.page-range-input').value, copies: document.querySelector('[data-setting=copies]').value,
        orientation: document.querySelector('[data-setting=orientation]').value, disabled: document.querySelector('#print-submit').disabled,
        savedLanguage: localStorage.getItem('print.locale.v2'), numericDirection: document.querySelector('.page-range-input').dir }));
    assert.equal(state.language, locale);
    assert.equal(state.direction, locale === 'ar' ? 'rtl' : 'ltr');
    assert.equal(state.overflow, false);
    assert.deepEqual([state.cards, state.range, state.copies, state.orientation, state.disabled, state.numericDirection], [1, '1,3', '2', 'landscape', false, 'ltr']);
    assert.equal(state.savedLanguage, locale);
    return state;
}

async function verifyStudentScreen() {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'tr-TR' });
    await mockStudentRoutes(page);
    await page.goto('http://127.0.0.1:5197/yazdir/');
    await addSyntheticPdf(page);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        for (const locale of ['tr', 'tk', 'ru', 'en', 'ar']) {
            results.push({ width, ...await verifyLanguage(page, locale) });
            if (width === 390) await page.screenshot({ path: resolve(outputDirectory, `student-${locale}-mobile.png`), fullPage: true });
        }
    }
    await page.reload();
    await page.waitForFunction(() => document.documentElement.lang === 'ar');
    assert.equal(await page.locator('#print-language').inputValue(), 'ar');
    await page.close();
}

async function verifyStaffScreen() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let isPaused = false;
    let isOnline = true;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const payload = pathname === '/api/staff/print/management' ? { printer: { online: isOnline, printer_name: 'Uluslararası Ofis',
            runner_id: 'SYNTHETIC-RUNNER', seen_at: '2026-10-13T05:28:01Z', health: 'ready' }, queue: { paused: isPaused },
            counts: { queued: 0, processing: 0, submitted: 1, pending: 0 }, jobs: [], canManage: true }
            : pathname === '/api/staff/print/history' ? { jobs: [], hasMore: false, nextCursor: null }
                : { available: isOnline && !isPaused, queue_paused: isPaused, options: capabilities, limits: capabilities.limits };
        await route.fulfill({ json: payload });
    });
    await page.goto('http://127.0.0.1:5197/print-staff-qa');
    await page.waitForFunction(() => document.querySelector('#print-staff-status').dataset.state === 'ready');
    assert.equal(await page.locator('#print-queue-pause').isVisible(), true);
    assert.equal(await page.locator('#print-queue-resume').isVisible(), false);
    await page.locator('.print-management-section').first().screenshot({ path: resolve(outputDirectory, 'staff-ready.png') });
    isPaused = true;
    await page.locator('#print-staff-refresh').click();
    await page.waitForFunction(() => document.querySelector('#print-staff-status').dataset.state === 'paused');
    assert.equal(await page.locator('#print-queue-pause').isVisible(), false);
    assert.equal(await page.locator('#print-queue-resume').isVisible(), true);
    await page.locator('.print-management-section').first().screenshot({ path: resolve(outputDirectory, 'staff-paused.png') });
    isPaused = false;
    isOnline = false;
    await page.locator('#print-staff-refresh').click();
    await page.waitForFunction(() => document.querySelector('#print-staff-status').dataset.state === 'unavailable');
    await page.close();
}

try {
    await mkdir(outputDirectory, { recursive: true });
    await verifyStudentScreen();
    await verifyStaffScreen();
    assert.deepEqual(pageErrors, []);
    await writeFile(resolve(outputDirectory, 'browser-results.json'), JSON.stringify({ syntheticApiOnly: true, pageErrors, results, savedPreferenceSurvivesReload: true }, null, 2));
} finally {
    await browser.close();
    await server.close();
    staffDocument.defaultView.close();
}
