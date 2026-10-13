import { isPrintEnabled } from '../domain/print-gate.js';
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
    return { available: status.available, options, limits: status.limits };
}

export async function createPublicPrintUploadIntent(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const storage = createStorage(environment);
    const repository = createPrintRepository(environment.DB);
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: 'print-upload', maxRequests: 5, windowSeconds: 300 });
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
    const idempotencyKey = requireToken(body.idempotency_key);
    const uploadToken = requireToken(body.upload_token);
    const trackingToken = requireToken(body.tracking_token);
    const id = crypto.randomUUID();
    const storageKey = `print/${id}`;
    const job = await repository.createUploadIntent({
        id, idempotencyHash: await hashValue(idempotencyKey), uploadTokenHash: await hashValue(uploadToken),
        trackingTokenHash: await hashValue(trackingToken), storageKey, mediaType: upload.mediaType,
        byteSize: upload.byteSize, copies: upload.copies, paperSize: upload.paperSize,
        colorMode: upload.colorMode, duplex: upload.duplex, orientation: upload.orientation,
        requiredProtocol: upload.requiredProtocol, now,
        expiresAt: new Date(Date.parse(now) + PRINT_UPLOAD_TTL_MS).toISOString(),
        purgeAfter: new Date(Date.parse(now) + PRINT_ROW_RETENTION_MS).toISOString(),
        heartbeatCutoff: new Date(Date.parse(now) - PRINT_HEARTBEAT_MAX_AGE_MS).toISOString()
    });
    if (!job) throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    if (job.status !== 'uploading') return { job_id: job.id, status: job.status, upload: null };
    const capability = await storage.createUploadCapability(job.storage_key, { contentType: job.media_type });
    return { job_id: job.id, status: job.status, upload: capability };
}

export async function finalizePublicPrintUpload(request, environment, jobId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const storage = createStorage(environment);
    const repository = createPrintRepository(environment.DB);
    await enforceRateLimit({ rateLimits: createRateLimitRepository(environment.DB) }, request,
        { endpoint: 'print-finalize', maxRequests: 10, windowSeconds: 300 });
    const tokenHash = await hashValue(requireToken(request.headers.get('X-Print-Upload-Token')));
    const now = new Date().toISOString();
    const job = await repository.findUploadIntent({ id: jobId, tokenHash, now });
    if (!job) throw new ApiError(404, 'PRINT_JOB_NOT_FOUND', 'Yazdırma isteği bulunamadı.');
    const object = await storage.head(job.storage_key);
    if (!object || object.size !== job.byte_size || object.httpMetadata?.contentType !== job.media_type) {
        throw new ApiError(409, 'PRINT_UPLOAD_INVALID', 'Dosya doğrulanamadı. Dosyayı yeniden seçin.');
    }
    const content = await storage.get(job.storage_key);
    if (!content || typeof content.arrayBuffer !== 'function' || content.size !== job.byte_size) {
        throw new ApiError(409, 'PRINT_UPLOAD_INVALID', 'Dosya doğrulanamadı. Dosyayı yeniden seçin.');
    }
    const bytes = new Uint8Array(await content.arrayBuffer());
    if (bytes.length > MAX_PRINT_BYTES || !validatePrintMagicBytes(job.media_type, bytes)) {
        throw new ApiError(415, 'PRINT_UPLOAD_INVALID', 'PDF, JPG veya PNG dosyası seçin.');
    }
    const queued = await repository.markQueued({ id: job.id, tokenHash, now,
        expiresAt: new Date(Date.parse(now) + PRINT_FAILURE_RETENTION_MS).toISOString() });
    if (!queued) throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
    return { job_id: job.id, status: 'queued' };
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
