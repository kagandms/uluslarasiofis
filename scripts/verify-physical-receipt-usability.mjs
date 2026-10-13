import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.RECEIPT_QA_PLAYWRIGHT_MODULE || 'playwright');
const outputDirectory = resolve(process.env.RECEIPT_QA_OUTPUT || 'docs/physical-receipt-usability-evidence');
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 5198, strictPort: true },
    plugins: [{ name: 'receipt-qa', configureServer(server) { server.middlewares.use('/receipt-qa', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="tr"><head><link rel="stylesheet" href="/src/index.css"><link rel="stylesheet" href="/src/staff/physical-intake.css"></head><body><main></main></body></html>');
    }); } }] });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = { environment: 'Local Chrome, synthetic data, no server API or upload latency', layouts: [], mergerLayouts: [], timings: [] };
try {
    await mkdir(outputDirectory, { recursive: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5198/receipt-qa');
    await page.evaluate(async () => { await import('/src/index.css'); await import('/src/staff/physical-intake.css'); });
    for (const viewport of [{ width: 1470, height: 725 }, { width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const layout = await page.evaluate(async () => {
            const { renderPhysicalReceiptDialog } = await import('/src/staff/physical-receipt-dialog.js');
            renderPhysicalReceiptDialog(document.querySelector('main'), { message: 'Öğrenci bilgilerini girin, Başvuru No Ata ardından Oluştur ve Yazdır’a basın.', receiptConfig: { today: '2026-10-12' }, draft: { application_date: '2026-10-12', first_name: 'selin', last_name: 'ışık', passport_number: 'ab123', application_type: 'initial' }, reservation: { tracking_reference: 'ITU-26-ABCDEFG', application_date: '2026-10-12' } }, {});
            await document.fonts.ready;
            const dialog = document.querySelector('dialog');
            const submit = dialog.querySelector('[type=submit]').getBoundingClientRect();
            const bounds = dialog.getBoundingClientRect();
            return { scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight, hasOverflow: dialog.scrollHeight > dialog.clientHeight + 1, submitVisible: submit.bottom <= innerHeight && submit.bottom <= bounds.bottom, uppercase: dialog.querySelector('[name=first_name]').value, successColor: getComputedStyle(dialog.querySelector('.is-success')).color };
        });
        assert.equal(layout.hasOverflow, false, `Dialog fits ${viewport.width}x${viewport.height}`);
        assert.equal(layout.submitVisible, true);
        assert.equal(layout.uppercase, 'SELİN');
        assert.equal(layout.successColor, 'rgb(22, 101, 52)');
        results.layouts.push({ ...viewport, ...layout });
        await page.screenshot({ path: resolve(outputDirectory, `dialog-${viewport.width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/api/staff/mobile-transfers**', async route => {
        const method=route.request().method();
        await route.fulfill({json:method==='POST'?{id:'synthetic',claimToken:'SYNTHETIC-QR-CLAIM-TOKEN-123456789012345678901234567890',expiresAt:Date.now()/1000+3600}:method==='DELETE'?{closed:true}:{files:[]}});
    });
    for (const viewport of [{width:1470,height:725},{width:1024,height:600}]) {
        await page.setViewportSize(viewport);
        for (const fileCount of [0,30]) {
            await page.evaluate(async fileCount => {
                document.querySelector('dialog')?.remove();
                const {openPdfMergerModal}=await import('/src/ui/pdfMergerModal.js');
                openPdfMergerModal({maxFiles:300,contextLabel:'TEST STUDENT · Sayfaları sıralayın veya silin; QR ve dosya seçimiyle yeni belgeler ekleyin.',onSave:()=>{},initialFiles:Array.from({length:fileCount},(_,index)=>new File(['synthetic'],`Test-${index}.pdf`,{type:'application/pdf'}))});
                document.querySelector('.pdf-merger-transfer > button').click();
            },fileCount);
            await page.waitForSelector('.transfer-qr canvas');
            await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(animation=>animation.finished));});
            const layout=await page.evaluate(()=>{
                const body=document.querySelector('.pdf-merger-body');
                const card=document.querySelector('.pdf-merger-modal-card');
                const qr=card.querySelector('canvas').getBoundingClientRect();
                const footer=card.querySelector('.staff-modal-footer').getBoundingClientRect();
                const list=card.querySelector('.pdf-merger-file-list');
                return {bodyOverflow:body.scrollHeight>body.clientHeight+1,cardOverflow:card.scrollHeight>card.clientHeight+1,qrVisible:qr.bottom<=footer.top,footerVisible:footer.bottom<=innerHeight,listScrolls:list.scrollHeight>list.clientHeight};
            });
            assert.equal(layout.bodyOverflow,false);
            assert.equal(layout.cardOverflow,false);
            assert.equal(layout.qrVisible,true);
            assert.equal(layout.footerVisible,true);
            results.mergerLayouts.push({...viewport,fileCount,...layout});
            await page.screenshot({path:resolve(outputDirectory,`merger-${viewport.width}-${fileCount}.png`)});
            await page.evaluate(()=>document.querySelector('#pdf-merger-modal-overlay').remove());
        }
    }
    for (let run = 0; run < 6; run++) {
        const timing = await page.evaluate(async run => {
            const start = performance.now();
            const { renderPhysicalReceiptPdf } = await import('/src/services/physical-receipt-pdf.js');
            const snapshot = { first_name: 'SELİN', last_name: 'IŞIK', passport_number: 'SYNTHETIC123', application_date: '2026-10-12', created_at: '2026-10-12T00:00:00Z', tracking_reference: 'ITU-26-ABCDEFG', portal_origin: 'https://goc.topkapiuni.workers.dev' };
            const bytes = await renderPhysicalReceiptPdf(snapshot);
            const generated = performance.now();
            const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
            const loading = pdfjs.getDocument({ data: bytes.slice() });
            const pdf = await loading.promise;
            const firstPage = await pdf.getPage(1);
            const annotations=await firstPage.getAnnotations();
            if (pdf.numPages!==1 || !annotations.some(annotation=>annotation.url===snapshot.portal_origin+'/')) throw new Error('Single-page receipt must include the clickable portal URL.');
            const viewport = firstPage.getViewport({ scale: 1.25 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            await firstPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const visible = performance.now();
            await loading.destroy();
            return { run, generationMs: generated - start, firstPageRenderMs: visible - generated, totalLocalMs: visible - start, byteSize: bytes.length,hasPortalLink:true };
        }, run);
        results.timings.push(timing);
    }
    await writeFile(resolve(outputDirectory, 'results.json'), JSON.stringify(results, null, 2));
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
} finally {
    await browser.close();
    await server.close();
}
