import { extractFromCoordinates, extractFields } from '../utils/parser.js';

async function encodeCanvas(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) { resolve(blob); return; }
        reject(new Error('Başvuru formu görüntüsü oluşturulamadı.'));
    }, 'image/jpeg', .92));
}

async function renderPdfForm(file) {
    if (!window.pdfjsLib) await import('./pdfjs-bootstrap.js');
    const task = window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    try {
        const images = [];
        for (let pageNumber = 1; pageNumber <= Math.min(2, pdf.numPages); pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            images.push(await encodeCanvas(canvas));
            canvas.width = canvas.height = 0;
        }
        return images;
    } finally { await pdf.destroy(); }
}

async function renderImageForm(file) {
    const image = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return [await encodeCanvas(canvas)];
    } finally { image.close(); }
}

function parseAnnotations(annotations) {
    const words = annotations.slice(1).map(annotation => {
        const vertices = annotation.boundingPoly?.vertices || [];
        if (vertices.length < 3) return null;
        const horizontal = vertices.map(vertex => vertex.x || 0);
        const vertical = vertices.map(vertex => vertex.y || 0);
        return { text: annotation.description || '', confidence: 1,
            bbox: { x0: Math.min(...horizontal), y0: Math.min(...vertical), x1: Math.max(...horizontal), y1: Math.max(...vertical) } };
    }).filter(Boolean);
    const extracted = {};
    if (words.length) extractFromCoordinates(words, extracted);
    const fallback = extractFields(annotations[0]?.description || '');
    return { first_name: extracted.adi || fallback.adi || '', last_name: extracted.soyadi || fallback.soyadi || '',
        passport_number: extracted.pasaportNo || fallback.pasaportNo || '' };
}

async function readImage(image) {
    const response = await fetch('/api/ocr', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' }, body: image, signal: AbortSignal.timeout(65000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Başvuru formu otomatik okunamadı.');
    if (payload.responses?.[0]?.error) throw new Error('Başvuru formu OCR hizmetinde okunamadı.');
    return parseAnnotations(payload.responses?.[0]?.textAnnotations || []);
}

/** Reads only the first two uploaded form pages using the existing OCR provider/parser.
 * @param {File[]} files Ordered application documents. @returns {Promise<object>} Editable identity candidates and warning.
 */
export async function recognizePhysicalApplicationForm(files) {
    const candidates = { first_name: '', last_name: '', passport_number: '', warning: '' };
    let count = 0;
    try {
        for (const file of files.slice(0, 2)) {
            const images = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
                ? await renderPdfForm(file) : await renderImageForm(file);
            for (const image of images.slice(0, 2 - count)) {
                const result = await readImage(image);
                for (const key of ['first_name', 'last_name', 'passport_number']) {
                    if (!candidates[key]) candidates[key] = result[key];
                    else if (result[key] && candidates[key] !== result[key]) candidates.warning = 'Form sayfalarında bilgiler farklı okundu. Alanları kontrol edin.';
                }
                count++;
            }
            if (count >= 2) break;
        }
    } catch (error) {
        console.error('Physical form OCR failed.', { errorName: error.name });
        candidates.warning = 'Otomatik okuma tamamlanamadı. PDF korunuyor; eksik bilgileri elle girin.';
    }
    return candidates;
}
