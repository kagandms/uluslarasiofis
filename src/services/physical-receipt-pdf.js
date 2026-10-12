import html2canvas from 'html2canvas';
import { PDFDocument } from 'pdf-lib';
import { createPhysicalReceiptTemplate } from './physical-receipt-template.js';
import { loadDocumentLogos,waitDocumentAssets,buildDocumentAssetUrl } from './document-logo-loader.js';
import './physical-receipt.css';

const RECEIPT_FONT_LOADS = new WeakMap();
const RECEIPT_LOGO_LOADS = new WeakMap();

function loadReceiptLogos(document) {
    if (!RECEIPT_LOGO_LOADS.has(document)) {
        const loading = loadDocumentLogos();
        RECEIPT_LOGO_LOADS.set(document, loading);
        void loading.catch(() => RECEIPT_LOGO_LOADS.delete(document));
    }
    return RECEIPT_LOGO_LOADS.get(document);
}

async function loadReceiptFonts(document) {
    if (RECEIPT_FONT_LOADS.has(document)) return RECEIPT_FONT_LOADS.get(document);
    const loading = readReceiptFontStyles(document);
    RECEIPT_FONT_LOADS.set(document, loading);
    try { return await loading; }
    catch (error) {
        RECEIPT_FONT_LOADS.delete(document);
        console.error('Receipt fonts failed to load.', { errorName: error.name });
        throw error;
    }
}

async function readReceiptFontStyles(document) {
    const families = [['Receipt Sans', 'noto-sans.ttf'], ['Receipt Arabic', 'noto-sans-arabic.ttf']];
    const styles = await Promise.all(families.map(async ([family, file]) => {
        const response = await fetch(buildDocumentAssetUrl(`fonts/${file}`));
        if (!response.ok) throw new Error('A4 fontları yüklenemedi.');
        const bytes = await response.arrayBuffer();
        const font = new FontFace(family, bytes, { weight: '100 900' });
        await font.load();
        document.fonts.add(font);
        const fontUrl = await readFontDataUrl(new Blob([bytes], { type: 'font/ttf' }));
        return `@font-face{font-family:"${family}";src:url("${fontUrl}");font-weight:100 900;}`;
    }));
    await document.fonts.ready;
    return styles.join('\n');
}

/** Loads A4 fonts and logos while staff enter the student details. @returns {Promise<void>} Ready render assets. @throws {Error} Asset load failure. */
export async function preloadPhysicalReceiptAssets() {
    const document=window.document;
    await Promise.all([loadReceiptFonts(document), loadReceiptLogos(document)]);
}

function readFontDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('A4 fontları okunamadı.'));
        reader.readAsDataURL(blob);
    });
}

function requireVisibleCanvas(canvas) {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let visiblePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) visiblePixels++;
    }
    if (visiblePixels < canvas.width * canvas.height * 0.005) throw new Error('A4 görüntüsü boş veya eksik. Tekrar hazırlayın.');
}

/** Renders the persisted snapshot with local assets into a single portrait A4. @param {object} snapshot Server snapshot.
 * @returns {Promise<Uint8Array>} PDF bytes. @throws {Error} Missing assets, overflow or invalid size. */
export async function renderPhysicalReceiptPdf(snapshot) {
    const document=window.document;
    const [fontStyles, logos] = await Promise.all([loadReceiptFonts(document), loadReceiptLogos(document)]);
    const root=createPhysicalReceiptTemplate(document,snapshot,logos);
    const embeddedFonts=document.createElement('style');
    embeddedFonts.textContent=fontStyles; root.prepend(embeddedFonts);
    const mount=document.createElement('div'); mount.className='physical-receipt-render-mount'; mount.append(root); document.body.append(mount);
    try {
        await waitDocumentAssets(root);
        if (root.scrollHeight>root.clientHeight+1 || root.scrollWidth>root.clientWidth+1) throw new Error('Bilgiler tek A4’e sığmıyor; içerik kesilmedi. Ofisle kontrol edin.');
        // Foreign-object coordinates must not inherit the staff workspace scroll offset.
        const canvas=await html2canvas(root,{scale:1.25,backgroundColor:'#ffffff',logging:false,scrollX:0,scrollY:0,
            onclone: (_document, clonedRoot) => {
                Object.assign(clonedRoot.style,{position:'fixed',left:'0',top:'0',margin:'0'});
            }
        });
        requireVisibleCanvas(canvas);
        return buildReceiptPdf(canvas, snapshot.created_at);
    } finally { mount.remove(); }
}

async function buildReceiptPdf(canvas, createdAtValue) {
    const pdf=await PDFDocument.create();
    const createdAt=new Date(createdAtValue);
    if (!Number.isFinite(createdAt.valueOf())) throw new Error('A4 snapshot zamanı eksik.');
    pdf.setCreationDate(createdAt); pdf.setModificationDate(createdAt);
    const image=await pdf.embedPng(canvas.toDataURL('image/png'));
    pdf.addPage([595.28,841.89]).drawImage(image,{x:0,y:0,width:595.28,height:841.89});
    const bytes=await pdf.save();
    if (bytes.length>10485760) throw new Error('A4 PDF boyutu 10 MiB sınırını aşıyor.');
    return bytes;
}
