import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readPrintUatPolicy, requirePrintUatContent } from '../domain/print-uat-policy.js';
import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { readPrintUatJobId } from '../repositories/d1/print-uat-repository.js';
import { readPublicPrintStatus } from './printRoutes.js';
import { requireMethod, requireSameOrigin } from './shared.js';

function requireActiveUat(environment) {
    const policy = readPrintUatPolicy(environment);
    if (!policy) throw new ApiError(503, 'PRINT_DISABLED', 'Yazdırma şu anda kapalı.', true);
    return policy;
}

async function readUatUpload(request, environment, jobId) {
    if (await readPrintUatJobId(environment.DB) !== jobId) throw invalidUpload();
    const token = request.headers.get('X-Print-Upload-Token');
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidUpload();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    const tokenHash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const job = await createPrintRepository(environment.DB).findUploadIntent({ id: jobId,
        tokenHash, now: new Date().toISOString() });
    if (!job) throw invalidUpload();
    return job;
}

async function readUploadBytes(request, expectedSize) {
    if (request.headers.get('Content-Type') !== 'application/pdf' || !request.body) throw invalidUpload();
    const reader = request.body.getReader();
    const bytes = new Uint8Array(expectedSize);
    let received = 0;
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (received + chunk.value.length > expectedSize) {
            await reader.cancel();
            throw invalidUpload();
        }
        bytes.set(chunk.value, received);
        received += chunk.value.length;
    }
    if (received !== expectedSize) throw invalidUpload();
    return bytes;
}

/**
 * Read staff-only UAT capabilities while normal public status remains disabled.
 * @param {Request} request Staff GET request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Private one-copy capabilities.
 * @throws {ApiError} When the staff session or UAT window is invalid.
 */
export async function readStaffPrintUatStatus(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, ['reviewer', 'admin']);
    requireActiveUat(environment);
    const status = await readPublicPrintStatus(request, {
        ...environment, PRINT_ENABLED: 'true', PRINT_MAX_COPIES_PER_JOB: '1'
    });
    return { ...status, available: status.available && !await readPrintUatJobId(environment.DB) };
}

/**
 * Upload only verified fixture bytes through the authenticated Worker, never a bearer R2 URL.
 * @param {Request} request Staff PUT with upload token and PDF body.
 * @param {object} environment Worker bindings.
 * @param {string} jobId Reserved UAT job ID.
 * @returns {Promise<{uploaded: boolean}>} Upload acknowledgement.
 * @throws {ApiError} When authorization, expiry, tokens, content or replay checks fail.
 */
export async function uploadPrintUatDocument(request, environment, jobId) {
    requireMethod(request, 'PUT');
    requireSameOrigin(request);
    await requireStaff(request, environment, ['reviewer', 'admin']);
    requireActiveUat(environment);
    const job = await readUatUpload(request, environment, jobId);
    const bytes = await readUploadBytes(request, job.byte_size);
    await requirePrintUatContent(bytes, environment);
    await requireStaff(request, environment, ['reviewer', 'admin']);
    requireActiveUat(environment);
    const current = await readUatUpload(request, environment, jobId);
    requireActiveUat(environment);
    const stored = await environment.PRINT_FILES.put(current.storage_key, bytes, {
        httpMetadata: { contentType: 'application/pdf' }, onlyIf: { etagDoesNotMatch: '*' }
    });
    if (!stored) throw new ApiError(409, 'PRINT_UAT_UPLOAD_EXISTS', 'UAT dosyası zaten yüklendi.');
    return { uploaded: true };
}

function invalidUpload() {
    return new ApiError(409, 'PRINT_UPLOAD_INVALID', 'UAT dosya yüklemesi doğrulanamadı.');
}
