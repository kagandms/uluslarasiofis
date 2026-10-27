import { createApplicationDocumentPages } from '../shared/applicationDocumentPdf.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const RENDER_WIDTH = 794;

const PAGE_STYLES = `
.online-application-pdf-mount{position:fixed;left:-10000px;top:0;pointer-events:none}
.online-application-pdf-page{box-sizing:border-box;width:${RENDER_WIDTH}px;height:1123px;padding:54px;color:#24232a;background:#fff;font-family:Arial,sans-serif;font-size:18px;line-height:1.45;display:flex;flex-direction:column;overflow:hidden}
.online-application-pdf-page header{border-bottom:3px solid #87162f;padding-bottom:24px;margin-bottom:30px}
.online-application-pdf-brand{color:#87162f;font-size:18px;font-weight:700;letter-spacing:1px;margin:0 0 14px}
.online-application-pdf-page h1{font-size:32px;line-height:1.15;margin:0 0 12px}
.online-application-pdf-reference{font-size:17px;font-weight:700;margin:0;color:#51515c}
.online-application-pdf-page h2{font-size:23px;margin:0 0 24px;color:#87162f}
.online-application-pdf-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:0}
.online-application-pdf-field{box-sizing:border-box;border:1px solid #d9d9df;border-radius:10px;padding:14px;min-height:92px;overflow-wrap:anywhere}
.online-application-pdf-field dt{font-size:14px;color:#656571;font-weight:700;margin:0 0 8px}
.online-application-pdf-field dd{font-size:18px;color:#24232a;font-weight:600;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.online-application-pdf-footer{color:#777782;font-size:13px;margin:auto 0 0;padding-top:26px;border-top:1px solid #e5e5e9}
`;

function readPdfReference(application) {
    const source = application.reference_number || application.student_number || 'basvuru';
    return String(source).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'basvuru';
}

/** Renders and downloads a local A4 PDF from a student-safe application DTO. */
export async function downloadOnlineApplicationPdf(application, document = globalThis.document) {
    if (!document?.body || !application || typeof application !== 'object') throw new Error('Başvuru belgesi oluşturulamadı.');
    const pages = createApplicationDocumentPages(document, application);
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
        await document.fonts?.ready;
        const pdf = await PDFDocument.create();
        pdf.setTitle('Çevrimiçi Başvuru Formu');
        for (const pageElement of pages) {
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
