import { ApiError } from '../domain/errors.js';
import { requirePrintUatContent, readPrintUatPolicy, readPrintUatDeadline } from '../domain/print-uat-policy.js';
import { readPrintUatJobId } from '../repositories/d1/print-uat-repository.js';
import { requirePrintUatJob } from '../services/print-uat-job.js';
import { MAX_PRINT_BYTES, MAX_PRINT_PAGES, readPrintLimits, validatePrintResult } from '../domain/printPolicy.js';
import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { createPrintStorage } from '../storage/printStorage.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod } from './shared.js';
import { requireStaff } from '../auth/staffAuth.js';
import { sha256 } from '@noble/hashes/sha2.js';

async function hashValue(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashBytes(value) {
    const digest = await crypto.subtle.digest('SHA-256', value);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashStream(body) {
    if (!body || typeof body.getReader !== 'function') {
        throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
    }
    const reader = body.getReader();
    const hash = sha256.create();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            hash.update(value);
        }
    } finally {
        reader.releaseLock();
    }
    return [...hash.digest()].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function requirePrinter(request, environment) {
    const expected = environment.PRINTER_SECRET;
    if (typeof expected !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(expected)) {
        throw new ApiError(503, 'PRINTER_UNAVAILABLE', 'Yazdırma hizmeti kullanılamıyor.', true);
    }
    if (new URL(request.url).protocol !== 'https:') throw new ApiError(403, 'HTTPS_REQUIRED', 'Güvenli bağlantı gerekli.');
    const provided = request.headers.get('Authorization')?.startsWith('Bearer ')
        ? request.headers.get('Authorization').slice(7) : '';
    const [expectedHash, providedHash] = await Promise.all([hashValue(expected), hashValue(provided.slice(0, 256))]);
    let difference = 0;
    for (let index = 0; index < expectedHash.length; index += 1) difference |= expectedHash.charCodeAt(index) ^ providedHash.charCodeAt(index);
    if (difference !== 0 || provided.length > 256) throw new ApiError(401, 'UNAUTHORIZED', 'Yazdırma agent yetkisi gerekli.');
    if (!environment.DB || !environment.PRINT_FILES) throw new ApiError(503, 'PRINTER_UNAVAILABLE', 'Yazdırma hizmeti kullanılamıyor.', true);
}

function requireIdentifier(value) {
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
    throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
}

async function readLease(request, repository, jobId) {
    const tokenHash = await hashValue(request.headers.get('X-Print-Lease') || '');
    const job = await repository.findLease({ id: jobId, tokenHash, now: new Date().toISOString() });
    if (!job) throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma işi artık bu agent tarafından sahiplenilemiyor.');
    return { job, tokenHash };
}

async function heartbeat(request, repository) {
    requireMethod(request, 'POST');
    const body = await readJsonBody(request, 1024);
    const keys = Object.keys(body).sort().join(',');
    const legacyKeys = 'health,printer_id,printer_name,runner_id';
    const currentKeys = 'health,printer_id,printer_name,runner_id,settings_protocol';
    if (![legacyKeys, currentKeys, 'health,printer_id,printer_name,runner_id,settings_protocol'].includes(keys)
        || !['ready', 'unavailable'].includes(body.health)
        || (keys !== legacyKeys && ![1, 2, 3].includes(body.settings_protocol))
        || typeof body.printer_name !== 'string' || body.printer_name.trim().length < 1
        || body.printer_name.length > 128 || /[\u0000-\u001f\u007f]/.test(body.printer_name)) {
        throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma agent durumu doğrulanamadı.');
    }
    const printerId = requireIdentifier(body.printer_id);
    const runnerId = requireIdentifier(body.runner_id);
    await repository.heartbeat({ printerId, runnerId, health: body.health, printerName: body.printer_name,
        settingsProtocol: body.settings_protocol || 0, now: new Date().toISOString() });
    return { recorded: true };
}

async function claim(request, repository, environment) {
    requireMethod(request, 'POST');
    const body = await readJsonBody(request, 1024);
    if (Object.keys(body).length !== 1) throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
    const runnerId = requireIdentifier(body.runner_id);
    const uatPolicy = readPrintUatPolicy(environment);
    const uatJobId = uatPolicy ? await readPrintUatJobId(environment.DB) : null;
    if (uatPolicy && !uatJobId) return { job: null };
    const leaseToken = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const now = new Date().toISOString();
    if (environment.APP_ENV !== 'production') await repository.reconcile(now);
    const limits = readPrintLimits(environment);
    if (!limits.isValid) return { job: null };
    const job = await repository.claim({ now, runnerId, leaseTokenHash: await hashValue(leaseToken),
        limits: uatPolicy ? { ...limits, maxCopies: 1 } : limits, jobId: uatJobId,
        minimumProtocol: uatPolicy ? 3 : 0, uatExpiresAt: readPrintUatDeadline(environment) });
    if (!job) return { job: null };
    return { job: { id: job.id, media_type: job.media_type, byte_size: job.byte_size, copies: job.copies,
        paper_size: job.paper_size, color_mode: job.color_mode, duplex: job.duplex, orientation: job.orientation,
        limits: { max_copies: limits.maxCopies, max_page_copies: limits.maxPageCopies },
        lease_until: job.lease_until, lease_token: leaseToken } };
}

async function readContent(request, environment, repository, jobId) {
    requireMethod(request, 'GET');
    const { job, tokenHash } = await readLease(request, repository, jobId);
    if (job.byte_size > MAX_PRINT_BYTES) throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma işi doğrulanamadı.');
    const storage = createPrintStorage(environment.PRINT_FILES, {
        accountId: environment.R2_ACCOUNT_ID, bucketName: environment.PRINT_BUCKET_NAME,
        accessKeyId: environment.PRINT_R2_ACCESS_KEY_ID, secretAccessKey: environment.PRINT_R2_SECRET_ACCESS_KEY
    });
    const object = await storage.head(job.storage_key);
    if (!object || object.size !== job.byte_size || object.httpMetadata?.contentType !== job.media_type) {
        throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
    }
    const content = await storage.get(job.storage_key);
    if (!content || content.etag !== object.etag || content.size !== job.byte_size) {
        throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
    }
    const uatPolicy = readPrintUatPolicy(environment);
    let sha256Header;
    let responseBody;
    if (uatPolicy) {
        if (typeof content.arrayBuffer !== 'function') {
            throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
        }
        const bytes = new Uint8Array(await content.arrayBuffer());
        await requirePrintUatContent(bytes, environment);
        if (bytes.length !== job.byte_size) throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
        sha256Header = await hashBytes(bytes);
        responseBody = bytes;
    } else {
        sha256Header = await hashStream(content.body);
        const responseContent = await storage.get(job.storage_key);
        if (!responseContent || responseContent.etag !== object.etag || responseContent.size !== job.byte_size
            || !responseContent.body) {
            throw new ApiError(409, 'PRINT_CONTENT_INVALID', 'Yazdırma dosyası doğrulanamadı.');
        }
        responseBody = responseContent.body;
    }
    if (!await repository.touchLease({ id: job.id, tokenHash, now: new Date().toISOString() })) {
        throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma işi artık bu agent tarafından sahiplenilemiyor.');
    }
    return new Response(responseBody, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(job.byte_size),
        'X-Content-SHA256': sha256Header, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function handleJobRequest(request, environment, repository, jobId, action) {
    if (action !== 'result') await requirePrintUatJob(jobId, environment);
    if (action === 'content') requireMethod(request, 'GET');
    else requireMethod(request, 'POST');
    if (action === 'content') return readContent(request, environment, repository, jobId);
    const { job, tokenHash } = await readLease(request, repository, jobId);
    if (action === 'validation-result') {
        const body = await readJsonBody(request, 1024);
        if (body.status === 'failed' && Object.keys(body).length === 2
            && ['validation_failed', 'unsupported_content', 'invalid_print_options', 'page_copy_budget_exceeded'].includes(body.result_code)) {
            if (!await repository.markValidationFailed({ id: jobId, tokenHash, resultCode: body.result_code,
                now: new Date().toISOString() })) throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma işi artık bu agent tarafından sahiplenilemiyor.');
            return { ready: false };
        }
        if (body.status !== 'ready' || Object.keys(body).length !== 2 || !Number.isInteger(body.page_count)
            || body.page_count < 1 || body.page_count > MAX_PRINT_PAGES) throw new ApiError(400, 'PRINT_PAGE_LIMIT', 'Belge sayfa sınırını aşıyor.');
        if (readPrintUatPolicy(environment) && body.page_count !== 1) {
            throw new ApiError(400, 'PRINT_PAGE_LIMIT', 'UAT belgesi tek sayfa olmalıdır.');
        }
        const limits = readPrintLimits(environment);
        if (!limits.isValid) throw new ApiError(503, 'PRINT_UNAVAILABLE', 'Yazdırma şu anda kullanılamıyor.', true);
        if (body.page_count * job.copies > limits.maxPageCopies) {
            await repository.markValidationFailed({ id: jobId, tokenHash, resultCode: 'page_copy_budget_exceeded',
                now: new Date().toISOString() });
            return { ready: false, result_code: 'page_copy_budget_exceeded' };
        }
        if (!await repository.markReady({ id: jobId, tokenHash, pageCount: body.page_count,
            maxPageCopies: limits.maxPageCopies, now: new Date().toISOString(),
            uatExpiresAt: readPrintUatDeadline(environment) })) {
            throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma işi artık bu agent tarafından sahiplenilemiyor.');
        }
        return { ready: true };
    }
    if (action === 'submission-started') {
        if (Object.keys(await readJsonBody(request, 256)).length) throw new ApiError(400, 'INVALID_PRINT_INPUT', 'Yazdırma isteği doğrulanamadı.');
        if (!await repository.markSubmissionStarted({ id: jobId, tokenHash, now: new Date().toISOString(),
            uatExpiresAt: readPrintUatDeadline(environment) })) {
            throw new ApiError(409, 'PRINT_SUBMISSION_LOCKED', 'Yazdırma işi tekrar gönderilemez.');
        }
        return { submission_started: true };
    }
    const result = validatePrintResult(await readJsonBody(request, 1024));
    if (!await repository.recordResult({ id: jobId, tokenHash, result, now: new Date().toISOString() })) {
        throw new ApiError(409, 'PRINT_LEASE_INVALID', 'Yazdırma sonucu kabul edilmedi.');
    }
    return { recorded: true };
}

export async function handlePrinterRequest(request, environment) {
    await requirePrinter(request, environment);
    const repository = createPrintRepository(environment.DB);
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/printer/heartbeat') return heartbeat(request, repository);
    if (pathname === '/api/printer/claim') return claim(request, repository, environment);
    const match = pathname.match(/^\/api\/printer\/jobs\/([A-Za-z0-9_-]{1,64})\/(content|validation-result|submission-started|result)$/);
    if (match) return handleJobRequest(request, environment, repository, match[1], match[2]);
    if (pathname === '/api/printer/reconcile') {
        requireMethod(request, 'GET');
        const runnerId = requireIdentifier(request.headers.get('X-Printer-Runner'));
        return { jobs: await repository.listSubmissionStarted(runnerId) };
    }
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
}

export async function readStaffPrintStatus(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, ['reviewer', 'admin']);
    return createPrintRepository(environment.DB).readStaffStatus(new Date().toISOString());
}
