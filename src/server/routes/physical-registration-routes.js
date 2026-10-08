import { ApiError } from '../domain/errors.js';
import { validatePhysicalIntake, MAX_PHYSICAL_PDF_BYTES } from '../domain/physical-intake-policy.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { requireMethod } from './shared.js';
import { validatePhysicalPdf } from './physical-pdf-routes.js';
import { registerPhysicalIntake } from '../repositories/d1/physical-registration-repository.js';

async function readMultipart(request) {
    const reader = request.body?.getReader();
    if (!reader || !request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) throw new ApiError(400, 'PDF_REQUIRED', 'PDF dosyası gerekli.');
    const chunks = [];
    let byteLength = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            byteLength += chunk.value.byteLength;
            if (byteLength > MAX_PHYSICAL_PDF_BYTES + 16384) { await reader.cancel(); throw new ApiError(413, 'PDF_TOO_LARGE', 'PDF en fazla 10 MB olabilir.'); }
            chunks.push(chunk.value);
        }
    } finally { reader.releaseLock(); }
    return new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData();
}

async function readRegistration(request) {
    const id = request.headers.get('X-Registration-Id');
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw new ApiError(400, 'REGISTRATION_ID_REQUIRED', 'Kaydetme kimliği gerekli.');
    const form = await readMultipart(request);
    const metadata = form.get('metadata');
    const pdf = form.get('pdf');
    if (typeof metadata !== 'string' || metadata.length > 8192 || !(pdf instanceof Blob) || pdf.size > MAX_PHYSICAL_PDF_BYTES
        || [...form.keys()].length !== 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci bilgileri ve PDF gerekli.');
    let receipt;
    try { receipt = JSON.parse(metadata); }
    catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci bilgileri okunamadı.'); }
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new ApiError(400, 'VALIDATION_ERROR', 'Öğrenci bilgileri gerekli.');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    await validatePhysicalPdf(bytes);
    return { id, receipt: validatePhysicalIntake(receipt), bytes, sha256: await hashScannerValue(bytes) };
}

async function checkReplay(context, payload) {
    const intake = await context.repository.find(payload.id);
    if (!intake) return false;
    const file = await context.repository.file(payload.id);
    const keys = ['student_number', 'first_name', 'last_name', 'passport_number', 'application_type', 'linked_application_id'];
    if (intake.deleted_at || !file || file.sha256 !== payload.sha256 || file.upload_status !== 'finalized'
        || keys.some(key => intake[key] !== payload.receipt[key])) {
        throw new ApiError(409, 'REGISTRATION_CONFLICT', 'Önceki kaydetme denemesiyle bilgiler eşleşmiyor. Listeyi kontrol edin.');
    }
    return true;
}

async function writeRegistration(context, payload) {
    const storageDigest = await hashScannerValue(`${payload.id}:${payload.sha256}`);
    const storageKey = `quarantine/${storageDigest.slice(0,8)}-${storageDigest.slice(8,12)}-${storageDigest.slice(12,16)}-${storageDigest.slice(16,20)}-${storageDigest.slice(20,32)}`;
    try {
        await context.environment.DOCUMENTS.put(storageKey, payload.bytes, { httpMetadata: { contentType: 'application/pdf' } });
        const head = await context.environment.DOCUMENTS.head(storageKey);
        if (!head || head.size !== payload.bytes.length) throw new ApiError(502, 'PDF_STORAGE_FAILED', 'PDF saklanamadı. Tekrar deneyin.');
        await registerPhysicalIntake(context.environment.DB, { ...payload, storageKey, byteSize: payload.bytes.length,
            staffId: context.staff.id, requestId: context.requestId, now: context.now });
    } catch (error) {
        console.error('Physical registration failed.', { errorName: error.name });
        const existingFile = await context.repository.file(payload.id);
        if (existingFile?.storage_key !== storageKey) {
            try { await context.environment.DOCUMENTS.delete(storageKey); }
            catch (cleanupError) { console.error('Unregistered PDF cleanup failed.', { errorName: cleanupError.name }); }
        }
        if (await checkReplay(context, payload)) return payload.id;
        if (String(error.message).includes('UNIQUE constraint')) throw new ApiError(409, 'PHYSICAL_ALREADY_EXISTS', 'Bu öğrenci için aktif kayıt var. Mevcut kaydı açın.');
        throw error;
    }
    return payload.id;
}

/** Saves a file-first physical application under authenticated staff authority.
 * @param {Request} request Multipart registration. @param {object} context Staff, bindings and repository.
 * @returns {Promise<string>} Persisted intake ID. @throws {ApiError} Invalid PDF, metadata or conflict.
 */
export async function savePhysicalRegistration(request, context) {
    requireMethod(request, 'POST');
    const payload = await readRegistration(request);
    if (await checkReplay(context, payload)) return payload.id;
    if (payload.receipt.linked_application_id) {
        const linked = await context.repository.findLinked(payload.receipt.linked_application_id);
        if (!linked || linked.student_number.trim().toUpperCase() !== payload.receipt.student_number
            || linked.application_type !== payload.receipt.application_type) throw new ApiError(409, 'APPLICATION_LINK_INVALID', 'Online başvuru bu öğrenciyle eşleşmiyor.');
    }
    return writeRegistration(context, payload);
}
