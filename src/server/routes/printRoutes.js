import { isPrintEnabled } from '../domain/print-gate.js';
import { readPrintUatPolicy, readPrintUatIdempotencyScope, readPrintUatDeadline, requirePrintUatUpload,
    requirePrintUatContent } from '../domain/print-uat-policy.js';
import { reservePrintUatSlot } from '../repositories/d1/print-uat-repository.js';
import { requirePrintUatJob } from '../services/print-uat-job.js';
import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import {
    MAX_PRINT_BYTES, PRINT_FAILURE_RETENTION_MS, PRINT_HEARTBEAT_MAX_AGE_MS, PRINT_ROW_RETENTION_MS,
    PRINT_UPLOAD_TTL_MS, readPrintLimits, readPrintOptionCapabilities, validatePrintMagicBytes, validatePrintUpload
} from '../domain/printPolicy.js';
import { createRateLimitRepository } from '../repositories/d1/rateLimitRepository.js';
import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { createPrintStorage } from '../storage/printStorage.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin, enforceRateLimit } from './shared.js';

function hashValue(value) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function requireToken(value) {
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value;
    throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
}

function createStorage(environment) {
    if (!environment.PRINT_FILES || !environment.R2_ACCOUNT_ID || !environment.PRINT_BUCKET_NAME
        || !environment.PRINT_R2_ACCESS_KEY_ID || !environment.PRINT_R2_SECRET_ACCESS_KEY) {
        throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    }
    return createPrintStorage(environment.PRINT_FILES, {
        accountId: environment.R2_ACCOUNT_ID,
        bucketName: environment.PRINT_BUCKET_NAME,
        accessKeyId: environment.PRINT_R2_ACCESS_KEY_ID,
        secretAccessKey: environment.PRINT_R2_SECRET_ACCESS_KEY
    });
}

export async function readPublicPrintStatus(request, environment) {
    requireMethod(request, 'GET');
    if (!isPrintEnabled(environment)) return { available: false, options: readPrintOptionCapabilities(environment) };
    const repository = createPrintRepository(environment.DB);
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: 'print-status', maxRequests: 60, windowSeconds: 60 });
    const limits = readPrintLimits(environment);
    const status = await repository.readPublicStatus(new Date().toISOString(), limits);
    const options = readPrintOptionCapabilities(environment, status.settingsProtocol);
    if (!limits.isValid || !environment.PRINT_FILES || !environment.R2_ACCOUNT_ID || !environment.PRINT_BUCKET_NAME
        || !environment.PRINT_R2_ACCESS_KEY_ID || !environment.PRINT_R2_SECRET_ACCESS_KEY) return { available: false, options };
    return { available: status.available, queue_paused: status.queuePaused, options, limits: status.limits };
}

async function readPrintUpload(request, environment, repository) {
    const body = await readJsonBody(request, 2048);
    const allowedKeys = ['byte_size', 'color_mode', 'copies', 'duplex', 'idempotency_key', 'media_type',
        'orientation', 'paper_size', 'tracking_token', 'upload_token'];
    if (Object.keys(body).length !== allowedKeys.length || Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
    }
    const now = new Date().toISOString();
    const limits = readPrintLimits(environment);
    if (!limits.isValid) throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    const status = await repository.readPublicStatus(now, limits);
    const upload = validatePrintUpload(body, readPrintOptionCapabilities(environment, status.settingsProtocol));
    requirePrintUatUpload(body, environment);
    return { now, upload, idempotencyKey: requireToken(body.idempotency_key),
        uploadToken: requireToken(body.upload_token), trackingToken: requireToken(body.tracking_token) };
}

async function requireUatReservation(environment, reservation) {
    if (!readPrintUatPolicy(environment)) return;
    if (await reservePrintUatSlot(environment.DB, reservation)) return;
    if (await createPrintRepository(environment.DB).findByIdempotencyHash(reservation.idempotencyHash)) return;
    throw new ApiError(503, 'PRINT_UAT_EXHAUSTED', 'Tek UAT işi hakkı kullanıldı.');
}

async function preparePrintIntent(request, environment, context, staffActor = null) {
    const { upload, now } = context;
    const id = crypto.randomUUID();
    const idempotencyHash = await hashValue(readPrintUatIdempotencyScope(environment) || context.idempotencyKey);
    if (readPrintUatPolicy(environment) && !staffActor) await requireStaff(request, environment, ['reviewer', 'admin']);
    await requireUatReservation(environment, { jobId: id, idempotencyHash, now });
    return {
        id, idempotencyHash, uploadTokenHash: await hashValue(context.uploadToken),
        trackingTokenHash: await hashValue(context.trackingToken), storageKey: `print/${id}`,
        mediaType: upload.mediaType, byteSize: upload.byteSize, copies: upload.copies, paperSize: upload.paperSize,
        colorMode: upload.colorMode, duplex: upload.duplex, orientation: upload.orientation,
        source: staffActor ? 'staff' : 'student', createdByStaffId: staffActor?.id || null,
        createdByStaffRole: staffActor?.role || null,
        requiredProtocol: upload.requiredProtocol, now,
        expiresAt: new Date(Date.parse(now) + PRINT_UPLOAD_TTL_MS).toISOString(),
        purgeAfter: new Date(Date.parse(now) + PRINT_ROW_RETENTION_MS).toISOString(),
        heartbeatCutoff: new Date(Date.parse(now) - PRINT_HEARTBEAT_MAX_AGE_MS).toISOString(),
        uatExpiresAt: readPrintUatDeadline(environment)
    };
}

function createUatUploadCapability(jobId, uploadToken) {
    return { url: `/api/public/print/jobs/${jobId}/upload`, method: 'PUT',
        requiredHeaders: { 'Content-Type': 'application/pdf', 'X-Print-Upload-Token': uploadToken } };
}

/**
 * Create an ordinary upload intent or the single authenticated UAT reservation.
 * @param {Request} request Same-origin browser POST.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Job state and its upload instructions.
 * @throws {ApiError} When input, availability or UAT authorization is invalid.
 */
async function createPrintUploadIntent(request, environment, staffActor = null) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const storage = createStorage(environment);
    const repository = createPrintRepository(environment.DB);
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: staffActor ? 'staff-print-upload' : 'print-upload', maxRequests: 5, windowSeconds: 300 });
    const context = await readPrintUpload(request, environment, repository);
    const intent = await preparePrintIntent(request, environment, context, staffActor);
    const job = await repository.createUploadIntent(intent);
    if (!job) {
        const currentStatus = await repository.readPublicStatus(new Date().toISOString(), readPrintLimits(environment));
        if (currentStatus.queuePaused) throw new ApiError(503, 'PRINT_QUEUE_PAUSED', 'Yazdırma kuyruğu duraklatıldı. Yeni iş alınmıyor.', true);
        throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    }
    readPrintUatDeadline(environment);
    if (job.status !== 'uploading') return { job_id: job.id, status: job.status, upload: null };
    const capability = intent.uatExpiresAt ? createUatUploadCapability(job.id, context.uploadToken)
        : await storage.createUploadCapability(job.storage_key, { contentType: job.media_type });
    return { job_id: job.id, status: job.status, upload: capability };
}

/** Creates a student print job or an authenticated staff print job using the shared upload contract. */
export async function createPublicPrintUploadIntent(request, environment) {
    return createPrintUploadIntent(request, environment);
}

/** Creates a print job attributed to the already-authorized staff session. */
export async function createStaffPrintUploadIntent(request, environment, staffActor) {
    return createPrintUploadIntent(request, environment, staffActor);
}

async function readVerifiedPrintBytes(storage, job) {
    const object = await storage.head(job.storage_key);
    if (!object || object.size !== job.byte_size || object.httpMetadata?.contentType !== job.media_type) {
        throw new ApiError(409, 'PRINT_UPLOAD_INVALID', 'Dosya doğrulanamadı. Dosyayı yeniden seçin.');
    }
    const content = await storage.get(job.storage_key);
    if (!content || typeof content.arrayBuffer !== 'function' || content.size !== job.byte_size) {
        throw new ApiError(409, 'PRINT_UPLOAD_INVALID', 'Dosyayı yeniden seçin.');
    }
    const bytes = new Uint8Array(await content.arrayBuffer());
    if (bytes.length > MAX_PRINT_BYTES || !validatePrintMagicBytes(job.media_type, bytes)) {
        throw new ApiError(415, 'PRINT_UPLOAD_INVALID', 'PDF, JPG veya PNG dosyası seçin.');
    }
    return bytes;
}

/**
 * Verify uploaded bytes before queueing; UAT rechecks the fixture and staff session.
 * @param {Request} request Same-origin browser POST with upload token.
 * @param {object} environment Worker bindings.
 * @param {string} jobId Opaque job ID.
 * @returns {Promise<object>} Queued job acknowledgement.
 * @throws {ApiError} When tokens, bytes, authorization or expiry checks fail.
 */
async function finalizePrintUpload(request, environment, jobId, staffActor = null) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    await requirePrintUatJob(jobId, environment);
    const storage = createStorage(environment);
    const repository = createPrintRepository(environment.DB);
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: 'print-finalize', maxRequests: 10, windowSeconds: 300 });
    const tokenHash = await hashValue(requireToken(request.headers.get('X-Print-Upload-Token')));
    const now = new Date().toISOString();
    const job = await repository.findUploadIntent({ id: jobId, tokenHash, now });
    if (!job) throw new ApiError(404, 'PRINT_JOB_NOT_FOUND', 'Yazdırma isteği bulunamadı.');
    await requirePrintUatContent(await readVerifiedPrintBytes(storage, job), environment);
    if (!staffActor && readPrintUatPolicy(environment)) await requireStaff(request, environment, ['reviewer', 'admin']);
    const queued = await repository.markQueued({ id: job.id, tokenHash, now,
        expiresAt: new Date(Date.parse(now) + PRINT_FAILURE_RETENTION_MS).toISOString(),
        uatExpiresAt: readPrintUatDeadline(environment) });
    if (!queued) throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    return { job_id: job.id, status: 'queued' };
}

/** Finalizes a student print upload while preserving the public idempotent flow. */
export async function finalizePublicPrintUpload(request, environment, jobId) {
    return finalizePrintUpload(request, environment, jobId);
}

/** Finalizes an upload after the caller has authorized the staff session. */
export async function finalizeStaffPrintUpload(request, environment, jobId, staffActor) {
    return finalizePrintUpload(request, environment, jobId, staffActor);
}

export async function readPublicPrintJobStatus(request, environment) {
    requireMethod(request, 'GET');
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: 'print-job-status', maxRequests: 120, windowSeconds: 60 });
    const tokenHash = await hashValue(requireToken(request.headers.get('X-Print-Tracking-Token')));
    const job = await createPrintRepository(environment.DB).findByTrackingHash(tokenHash);
    if (!job) throw new ApiError(404, 'PRINT_JOB_NOT_FOUND', 'Yazdırma isteği bulunamadı.');
    return { status: job.status };
}
