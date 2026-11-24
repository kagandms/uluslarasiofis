import {
    TEBLIGAT_PAGE_STYLES,
    buildTebligatFilename,
    createTebligatPage
} from '../shared/tebligatPage.js';
import { loadDocumentLogos, waitDocumentAssets } from './document-logo-loader.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const MOUNT_STYLES = `
.tebligat-pdf-mount{position:fixed;left:-10000px;top:0;pointer-events:none}
`;

/** Renders and downloads the one-page A4 Tebliğ / Tebligat PDF locally. */
export async function downloadTebligatPdf(details, document = globalThis.document) {
    if (!document?.body || !details || typeof details !== 'object') {
        throw new Error('Tebliğ / Tebligat belgesi oluşturulamadı.');
    }
    const logos = await loadDocumentLogos();
    const pageElement = createTebligatPage(document, details, logos);
    const { default: html2canvas } = await import('html2canvas');
    const { PDFDocument } = await import('pdf-lib');

    const mount = document.createElement('div');
    mount.className = 'tebligat-pdf-mount';
    const style = document.createElement('style');
    style.textContent = `${MOUNT_STYLES}\n${TEBLIGAT_PAGE_STYLES}`;
    mount.append(style, pageElement);
    document.body.append(mount);

    try {
        await waitDocumentAssets(mount);
        await document.fonts?.ready;
        if (pageElement.scrollHeight > pageElement.clientHeight + 1 || pageElement.scrollWidth > pageElement.clientWidth + 1) {
            throw new Error('Tebliğ / Tebligat bilgileri tek A4 sayfasına sığmadı; bilgi kesilmeden PDF oluşturulamadı.');
        }
        const canvas = await html2canvas(pageElement, {
            scale: 1.25,
            backgroundColor: '#ffffff',
            logging: false,
            scrollX: 0,
            scrollY: 0,
            onclone: (_clonedDocument, clonedPage) => {
                Object.assign(clonedPage.style, { position: 'fixed', left: '0', top: '0', margin: '0' });
            }
        });
        if (!canvas.width || !canvas.height) {
            throw new Error('Tebliğ / Tebligat sayfası PDF’e aktarılamadı.');
        }
        const pdf = await PDFDocument.create();
        pdf.setTitle('Tebliğ / Tebligat Sayfası');
        const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.94));
        const outputPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        outputPage.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });

        const bytes = await pdf.save();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = buildTebligatFilename(details.firstName, details.lastName);
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        document.defaultView?.setTimeout?.(() => URL.revokeObjectURL(url), 60_000);
    } finally {
        mount.remove();
    }
}
