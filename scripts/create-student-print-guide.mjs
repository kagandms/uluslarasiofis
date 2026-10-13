import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { unstable_readConfig } from 'wrangler';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { buildStudentPrintGuideHtml } from './lib/student-print-guide.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = resolve(process.env.PRINT_GUIDE_OUTPUT || 'output/pdf');
const { chromium } = await import(process.env.PRINT_GUIDE_PLAYWRIGHT_MODULE || 'playwright');

async function readAsset(relativePath, mediaType) {
    const bytes = await readFile(resolve(projectRoot, relativePath));
    return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

async function createGuideHtml() {
    const configuration = unstable_readConfig({ config: resolve(projectRoot, 'wrangler.jsonc'), env: 'production' });
    const origin = process.env.PRINT_GUIDE_ORIGIN || configuration.vars.PUBLIC_PORTAL_ORIGIN;
    const printUrl = new URL('/yazdir/', origin).href;
    const [template, logo, latinFont, arabicFont, qrSvg] = await Promise.all([
        readFile(resolve(projectRoot, 'scripts/templates/student-print-guide.html'), 'utf8'),
        readAsset('public/logo_tr_transparent.png', 'image/png'),
        readAsset('public/fonts/noto-sans.ttf', 'font/ttf'),
        readAsset('public/fonts/noto-sans-arabic.ttf', 'font/ttf'),
        QRCode.toString(printUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } })
    ]);
    return { printUrl, html: buildStudentPrintGuideHtml({ template, printUrl, logo, latinFont, arabicFont, qrSvg }) };
}

async function renderGuide(browser, guide) {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
    await page.setContent(guide.html);
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); });
    const layout = await page.evaluate(() => ({ height: document.querySelector('.sheet').getBoundingClientRect().height,
        languages: [...document.querySelectorAll('.language-section')].map((section) => section.lang),
        arabicDirection: document.querySelector('.language-section[lang=ar]').dir,
        logoLoaded: document.images[0].naturalWidth > 0, fontsLoaded: document.fonts.check('12px Guide') && document.fonts.check('12px GuideArabic') }));
    assert.ok(layout.height <= 1123, `Poster overflows A4: ${layout.height}px`);
    assert.deepEqual(layout.languages, ['tr', 'tk', 'ru', 'en', 'ar']);
    assert.equal(layout.arabicDirection, 'rtl');
    assert.equal(layout.logoLoaded && layout.fontsLoaded, true);
    const pdfPath = resolve(outputDirectory, 'student-print-guide-a4.pdf');
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
    const bytes = await readFile(pdfPath);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    const dimensions = pdf.getPage(0).getSize();
    assert.ok(Math.abs(dimensions.width - 595.28) < 1 && Math.abs(dimensions.height - 841.89) < 1);
    execFileSync('pdftoppm', ['-r', '150', '-png', '-singlefile', pdfPath, resolve(outputDirectory, 'student-print-guide-a4')]);
    await writeFile(resolve(outputDirectory, 'student-print-guide-validation.json'), JSON.stringify({ printUrl: guide.printUrl, pageCount: 1, dimensions, ...layout }, null, 2));
}

const guide = await createGuideHtml();
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, 'student-print-guide-a4.html'), guide.html);
const browser = await chromium.launch({ headless: true, channel: process.env.PRINT_GUIDE_BROWSER || 'chrome' });
try {
    await renderGuide(browser, guide);
} finally {
    await browser.close();
}
