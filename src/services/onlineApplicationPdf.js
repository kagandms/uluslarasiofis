import { createApplicationDocumentPages } from '../shared/applicationDocumentPdf.js';
import { loadDocumentLogos, waitDocumentAssets } from './document-logo-loader.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const RENDER_WIDTH = 794;

const PAGE_STYLES = `
.online-application-pdf-mount{position:fixed;left:-10000px;top:0;pointer-events:none}
.online-application-pdf-page{box-sizing:border-box;width:${RENDER_WIDTH}px;height:1123px;padding:49px;color:#111;background:#fff;font-family:Arial,sans-serif;font-size:13px;line-height:1.4;overflow:visible}
.online-application-pdf-page header{display:flex;justify-content:space-between;height:72px;margin-bottom:19px}
.online-application-pdf-page header img{max-width:151px;height:72px;object-fit:contain}
.online-application-pdf-page h1{font-size:21px;line-height:1.2;margin:0 0 19px}
.online-application-pdf-page h2{font-size:15px;margin:0 0 7px}
.online-application-pdf-page .physical-receipt-code{font-size:34px;font-weight:700;letter-spacing:1px;margin:3px 0 14px}
.online-application-pdf-section{margin-top:10px;break-inside:avoid}
.online-application-pdf-fields{display:grid;grid-template-columns:1fr 1fr;column-gap:18px;row-gap:4px;margin:0}
.online-application-pdf-field{box-sizing:border-box;overflow-wrap:anywhere;break-inside:avoid}
.online-application-pdf-field dt{font-size:10px;font-weight:700;margin:0}
.online-application-pdf-field dd{font-size:12px;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.online-application-pdf-footer{font-size:10px;margin:12px 0 0;padding-top:8px;border-top:1px solid #777}
`;

function readPdfReference(application) {
    const source = application.reference_number || application.student_number || 'basvuru';
    return String(source).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'basvuru';
}

/** Renders and downloads a local A4 PDF from a student-safe application DTO. */
export async function downloadOnlineApplicationPdf(application, document = globalThis.document) {
    if (!document?.body || !application || typeof application !== 'object') throw new Error('Başvuru belgesi oluşturulamadı.');
    const logos = await loadDocumentLogos();
    const pages = createApplicationDocumentPages(document, application, logos);
    if (pages.length === 0) throw new Error('Başvuru belgesi için gösterilebilir bilgi bulunamadı.');
    const { default: html2canvas } = await import('html2canvas');
    const { PDFDocument } = await import('pdf-lib');
    const mount = document.createElement('div');
    mount.className = 'online-application-pdf-mount';
    const style = document.createElement('style');
    style.textContent = PAGE_STYLES;
    mount.append(style, ...pages);
    document.body.append(mount);
    try {
        await waitDocumentAssets(mount);
        await document.fonts?.ready;
        const pdf = await PDFDocument.create();
        pdf.setTitle('Çevrimiçi Başvuru Formu');
        for (const pageElement of pages) {
            if (pageElement.scrollHeight > pageElement.clientHeight + 1 || pageElement.scrollWidth > pageElement.clientWidth + 1) {
                throw new Error('Başvuru bilgileri tek A4 sayfasına sığmadı; bilgi kesilmeden PDF oluşturulamadı.');
            }
            const canvas = await html2canvas(pageElement, {
                scale: 1.25, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0,
                onclone: (_clonedDocument, clonedPage) => {
                    Object.assign(clonedPage.style, { position: 'fixed', left: '0', top: '0', margin: '0' });
                }
            });
            if (!canvas.width || !canvas.height) throw new Error('Başvuru sayfası PDF’e aktarılamadı.');
            const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.94));
            const outputPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
            outputPage.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
        }
        const bytes = await pdf.save();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `Basvuru_Formu_${readPdfReference(application)}.pdf`;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        document.defaultView.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
        mount.remove();
    }
}
