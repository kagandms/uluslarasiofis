import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { PDFDocument } from 'pdf-lib';
import { extractApplicationNumberCandidates, extractFromCoordinates } from '../utils/parser.js';
import { loadPdfJs } from '../services/pdfjs-loader.js';
import { mergeDocumentsToPdf } from '../services/pdfMergerService.js';
import { readApplicationDocumentFiles } from './application-document-files.js';

const MAX_PDF_BYTES = 9 * 1024 * 1024;
// Every office registration number is 2026-XX-XXXXXXX (fixed year, two-digit code, seven-digit serial).
const REGISTRATION_NUMBER_PATTERN = /^2026-\d{2}-\d{7}$/;

const BARCODE_CAPTION = /GCGM\s*\d{2}\s*-\s*\d?\s*(20\d{2})\s*(\d{2})\s*(\d{5,8})/gi;

/** Numbers printed under the form's barcode; an independent copy of the registration number. */
function readBarcodeCaptionNumbers(formText) {
    return new Set([...String(formText || '').matchAll(BARCODE_CAPTION)].map((match) => `${match[1]}-${match[2]}-${match[3]}`));
}

/** Picks the number without asking only when one candidate is unique or confirmed by the barcode caption. */
/** Preparation errors are our own staff-facing messages (no HTTP status); API failures keep the generic text. */
export function describeGocnetPreparationError(error) {
    const generic = 'GöçNet ön kontrolü yapılamadı. Belgeleri ve eklentiyi kontrol edip yeniden deneyin.';
    if (!(error instanceof Error) || error.name === 'AbortError' || error.status !== undefined) return generic;
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    return message && message.length <= 200 ? `GöçNet ön kontrolü yapılamadı: ${message}` : generic;
}

export function filterRegistrationCandidates(candidates) {
    return [...new Set(candidates)].filter((candidate) => REGISTRATION_NUMBER_PATTERN.test(candidate));
}

export function resolveRegistrationNumber(rawCandidates, correction = '', formText = '') {
    if (correction) return REGISTRATION_NUMBER_PATTERN.test(correction) ? correction : null;
    const candidates = filterRegistrationCandidates(rawCandidates);
    if (candidates.length === 1) return candidates[0];
    const barcodeNumbers = readBarcodeCaptionNumbers(formText);
    const confirmed = candidates.filter((candidate) => barcodeNumbers.has(candidate));
    return confirmed.length === 1 ? confirmed[0] : null;
}

export function normalizeTurkishMobilePhone(value) {
    if (typeof value !== 'string') return null;
    const phone = parsePhoneNumberFromString(value.trim(), 'TR', { extract: false });
    if (!phone?.isValid() || phone.country !== 'TR' || !/^5\d{9}$/.test(phone.nationalNumber)) return null;
    return phone.nationalNumber;
}

export function resolveTurkishMobilePhone(applicationPhone, correction = '') {
    return normalizeTurkishMobilePhone(correction.trim() ? correction : applicationPhone);
}

function readOcrText(payload) {
    return payload.responses?.[0]?.textAnnotations?.[0]?.description
        || payload.responses?.[0]?.fullTextAnnotation?.text
        || '';
}

async function recognizeRegistrationNumber(image, signal) {
    const response = await fetch('/api/ocr', {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { 'Content-Type': 'application/octet-stream' }, body: image
    });
    if (!response.ok) throw new Error('Başvuru kayıt numarası otomatik okunamadı.');
    const payload = await response.json();
    const annotations = payload.responses?.[0]?.textAnnotations || [];
    const words = annotations.slice(1).map((annotation) => {
        const vertices = annotation.boundingPoly?.vertices || [];
        if (vertices.length < 3) return null;
        const horizontal = vertices.map((vertex) => vertex.x || 0);
        const vertical = vertices.map((vertex) => vertex.y || 0);
        return { text: annotation.description || '', confidence: 1,
            bbox: { x0: Math.min(...horizontal), y0: Math.min(...vertical), x1: Math.max(...horizontal), y1: Math.max(...vertical) } };
    }).filter(Boolean);
    const extracted = {};
    if (words.length) extractFromCoordinates(words, extracted);
    const fullText = readOcrText(payload);
    const candidates = extractApplicationNumberCandidates(fullText);
    if (extracted.basvuruNo && !candidates.includes(extracted.basvuruNo)) candidates.unshift(extracted.basvuruNo);
    return { candidates, text: fullText };
}

async function renderFirstPage(file) {
    const canvas = document.createElement('canvas');
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
        try {
            const pdf = await task.promise;
            if (pdf.numPages < 1) throw new Error('Başvuru formu boş.');
            const page = await pdf.getPage(1);
            const text = (await page.getTextContent()).items.map((item) => item.str || '').join('\n');
            const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(page.getViewport({ scale: 1 }).width, page.getViewport({ scale: 1 }).height)) });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return { text, canvas };
        } finally {
            await task.destroy?.();
        }
    }
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    return { text: '', canvas };
}

async function recognizeFormNumber(file, signal) {
    const { text, canvas } = await renderFirstPage(file);
    const textCandidates = extractApplicationNumberCandidates(text);
    if (textCandidates.length) {
        canvas.width = 0;
        canvas.height = 0;
        return { candidates: textCandidates, text };
    }
    try {
        const image = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob
            ? resolve(blob) : reject(new Error('Başvuru formu görüntüsü oluşturulamadı.')), 'image/jpeg', .92));
        return await recognizeRegistrationNumber(image, signal);
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

/** Prepares all current documents before any external GöçNet action begins. */
export async function prepareGocnetTransfer({ applicationId, api, signal, registrationNumberCorrection = '', phoneCorrection = '' }) {
    const { application, manifest, manifestFingerprint, files } = await readApplicationDocumentFiles({ applicationId, api, signal });
    const formIndex = manifest.files.findIndex((file) => file.code === 'residence_application_form');
    if (formIndex < 0) throw new Error('Güncel ikamet başvuru formu bulunamadı.');
    // The merge is the slowest local step and does not depend on the number, so it starts alongside number recognition.
    const mergePromise = mergeDocumentsToPdf(files);
    mergePromise.catch(() => {});
    const { candidates: rawCandidates, text: formText } = await recognizeFormNumber(files[formIndex], signal);
    const candidates = filterRegistrationCandidates(rawCandidates);
    const applicationNumber = resolveRegistrationNumber(candidates, registrationNumberCorrection, formText);
    if (!applicationNumber) {
        const error = new Error(candidates.length ? 'Birden fazla kayıt numarası bulundu; önizlemeden doğru adayı seçin.' : 'Başvuru kayıt numarası güvenilir biçimde okunamadı.');
        error.code = 'REGISTRATION_NUMBER_CONFIRMATION_REQUIRED';
        error.candidates = candidates;
        error.formFile = files[formIndex];
        throw error;
    }
    const phoneNational = resolveTurkishMobilePhone(application.phone, phoneCorrection);
    if (!phoneNational) {
        const error = new Error('GöçNet yeni kayıt için geçerli bir Türkiye mobil telefonu gerekli.');
        error.code = 'TURKISH_MOBILE_REQUIRED';
        throw error;
    }
    const { bytes, metrics } = await mergePromise;
    if (bytes.byteLength > MAX_PDF_BYTES || !metrics.yoksisLimitReached) throw new Error('Birleştirilmiş PDF 9 MiB sınırını aşıyor.');
    const document = await PDFDocument.load(bytes);
    if (!document.getPageCount()) throw new Error('Birleştirilmiş PDF okunabilir bir sayfa içermiyor.');
    const pdfFile = new File([bytes], 'gocnet-basvuru.pdf', { type: 'application/pdf' });
    const pdfSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
        applicationId,
        applicationNumber,
        studentNumber: application.student_number,
        passportNumber: application.passport_number,
        firstName: application.first_name,
        lastName: application.last_name,
        phoneNational,
        manifestFingerprint,
        pdfFile,
        pdfSha256
    };
}
