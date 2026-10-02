import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { hashScannerValue, MAX_SCAN_BYTES, requireScannerIdentifier, validateScannerResult } from '../domain/scanner-policy.js';
import { createScannerRepository } from '../repositories/d1/scanner-repository.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

/** @returns {ApiError} A safe lease conflict. */
function createLeaseConflict() {
    return new ApiError(409, 'SCAN_LEASE_INVALID', 'Tarama işi veya sahiplenme süresi değişti.');
}

/** @param {Request} request Machine request. @param {object} environment Bindings. @returns {Promise<void>} Validated authority. @throws {ApiError} Invalid authentication. */
async function requireScanner(request, environment) {
    const expectedSecret = environment.SCANNER_SECRET;
    if (typeof expectedSecret !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(expectedSecret)) {
        throw new ApiError(503,'SCANNER_UNAVAILABLE','Tarama hizmeti yapılandırılmamış.');
    }
    if (new URL(request.url).protocol !== 'https:') throw new ApiError(403,'HTTPS_REQUIRED','Güvenli bağlantı gerekli.');
    const providedSecret = request.headers.get('Authorization')?.replace(/^Bearer /,'') || '';
    const [expectedHash,providedHash] = await Promise.all([hashScannerValue(expectedSecret),hashScannerValue(providedSecret.slice(0,256))]);
    let difference = 0;
    for (let index=0;index<expectedHash.length;index+=1) difference |= expectedHash.charCodeAt(index)^providedHash.charCodeAt(index);
    if (difference !== 0 || providedSecret.length>256) throw new ApiError(401,'UNAUTHORIZED','Tarama yetkisi gerekli.');
    if (!environment.DB || !environment.DOCUMENTS) throw new ApiError(503,'SCANNER_UNAVAILABLE','Tarama hizmeti kullanılamıyor.');
}

/** @param {Request} request Claim request. @param {object} repository Scanner operations. @param {string} now UTC time. @returns {Promise<object>} One leased job or null. */
async function claim(request, repository, now) {
    requireMethod(request,'POST');
    const body = await readJsonBody(request,1024);
    if (Object.keys(body).length !== 1) throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    const runnerId = requireScannerIdentifier(body.runner_id);
    await repository.reconcile(now);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
    const job = await repository.claim({ now,runnerId,tokenHash:await hashScannerValue(token) });
    if (!job) return { job:null };
    return { job:{ id:job.id,file_id:job.file_id,revision_id:job.revision_id,storage_key:job.storage_key,
        byte_size:job.byte_size,media_type:job.media_type,lease_until:job.lease_until,lease_token:token } };
}

/** @param {object} input Job, request and repository context. @returns {Promise<object>} Current job and token digest. @throws {ApiError} Stale authority. */
async function readLease({ request, repository, jobId, now }) {
    const tokenHash = await hashScannerValue(request.headers.get('X-Scan-Lease') || '');
    const job = await repository.findLease({ jobId,tokenHash,now });
    if (!job) throw createLeaseConflict();
    return { job,tokenHash };
}

/** @param {object|null} object Private object metadata. @param {object} job Expected identity. @returns {boolean} Exact metadata match. */
function isExpectedObject(object, job) {
    return object && object.size === job.byte_size && typeof object.etag === 'string'
        && object.etag.length <= 128 && object.httpMetadata?.contentType === job.media_type;
}

/** @param {object} input Authenticated job context. @returns {Promise<Response>} One bounded object. @throws {ApiError} Invalid identity or authority. */
async function readContent({ request, environment, repository, jobId, now }) {
    requireMethod(request,'GET');
    const { job,tokenHash } = await readLease({ request,repository,jobId,now });
    if (Date.parse(now)>Date.parse(job.updated_at)+120_000 || job.byte_size>MAX_SCAN_BYTES) throw createLeaseConflict();
    const object = await environment.DOCUMENTS.head(job.storage_key);
    if (!isExpectedObject(object,job)) throw createLeaseConflict();
    const content = await environment.DOCUMENTS.get(job.storage_key,{ onlyIf:{ etagMatches:object.etag } });
    if (!isExpectedObject(content,job) || content.etag!==object.etag || typeof content.arrayBuffer!=='function') throw createLeaseConflict();
    const bytes = new Uint8Array(await content.arrayBuffer());
    if (bytes.length!==job.byte_size) throw createLeaseConflict();
    const sha256 = await hashScannerValue(bytes);
    if (!await repository.bindContent({ job,tokenHash,now:new Date().toISOString(),etag:object.etag,sha256 })) throw createLeaseConflict();
    return new Response(bytes,{ headers:{ 'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),
        'X-Content-SHA256':sha256,'X-Object-ETag':object.etag,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' } });
}

/** @param {object} input Authenticated result context. @returns {Promise<object>} Durable acknowledgement. @throws {ApiError} Invalid evidence or expired lease. */
async function recordResult({ request, environment, repository, jobId, now }) {
    requireMethod(request,'POST');
    const { job,tokenHash } = await readLease({ request,repository,jobId,now });
    const result = validateScannerResult({ result:await readJsonBody(request,4096),job,now });
    if (result.outcome!=='failed') {
        const object = await environment.DOCUMENTS.head(job.storage_key);
        if (!isExpectedObject(object,job) || object.etag!==job.object_etag) throw createLeaseConflict();
    }
    if (!await repository.persistResult({ job,result,tokenHash,now:new Date().toISOString() })) throw createLeaseConflict();
    return { recorded:true };
}

/** @param {Request} request Heartbeat. @param {object} repository Operations. @param {string} now UTC time. @returns {Promise<object>} Safe acknowledgement. */
async function heartbeat(request, repository, now) {
    requireMethod(request,'POST');
    const body = await readJsonBody(request,1024);
    if (Object.keys(body).sort().join(',')!=='engine_version,health,runner_id,signature_updated_at,signature_version') throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    requireScannerIdentifier(body.runner_id);
    if (!['ready','engine_unavailable','signature_stale','update_failed'].includes(body.health)) throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    for (const value of [body.engine_version,body.signature_version]) {
        if (value!==null && !(typeof value==='string' && /^[\w.+-]{1,64}$/.test(value))) throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    }
    const signatureTime = typeof body.signature_updated_at === 'string' && body.signature_updated_at.length <= 32
        && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(body.signature_updated_at) ? Date.parse(body.signature_updated_at) : NaN;
    if (body.signature_updated_at!==null && !Number.isFinite(signatureTime)) throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    if (body.health==='ready' && (!body.engine_version || !body.signature_version
        || !Number.isFinite(signatureTime) || signatureTime>Date.parse(now)+30_000 || signatureTime<Date.parse(now)-86_400_000)) {
        throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    }
    await repository.heartbeat({ ...body,now });
    await repository.reconcile(now);
    return { recorded:true };
}

/** Routes machine-only scanner calls. @param {Request} request HTTPS request. @param {object} environment Bindings. @returns {Promise<object|Response>} Safe result. @throws {ApiError} Invalid authority or evidence. */
export async function handleScannerRequest(request,environment) {
    await requireScanner(request,environment);
    const repository = createScannerRepository(environment.DB);
    const now = new Date().toISOString();
    const pathname = new URL(request.url).pathname;
    if (pathname==='/api/scanner/claim') return claim(request,repository,now);
    if (pathname==='/api/scanner/heartbeat') return heartbeat(request,repository,now);
    if (pathname==='/api/scanner/status') {
        requireMethod(request,'GET');
        await repository.reconcile(now);
        return repository.readStatus();
    }
    const match = pathname.match(/^\/api\/scanner\/jobs\/([a-zA-Z0-9_-]{1,64})\/(content|result)$/);
    if (!match) throw new ApiError(404,'NOT_FOUND','İstenen kaynak bulunamadı.');
    if (match[2]==='content') return readContent({ request,environment,repository,jobId:match[1],now });
    return recordResult({ request,environment,repository,jobId:match[1],now });
}

/** Reads scanner health or performs an audited retry. @param {Request} request Staff request. @param {object} environment Bindings. @param {string} requestId Correlation. @returns {Promise<object>} Safe status. @throws {ApiError} Invalid staff authority. */
export async function handleStaffScannerRequest(request,environment,requestId) {
    const pathname = new URL(request.url).pathname;
    requireMethod(request,pathname==='/api/staff/scanner/status'?'GET':'POST');
    if (request.method==='POST') requireSameOrigin(request);
    const staff = await requireStaff(request,environment,['reviewer','admin']);
    const repository = createScannerRepository(environment.DB);
    const now = new Date().toISOString();
    await repository.reconcile(now);
    if (request.method==='GET') return repository.readStatus();
    const body = await readJsonBody(request,1024);
    if (Object.keys(body).length!==1) throw new ApiError(400,'INVALID_SCANNER_INPUT','Tarama isteği doğrulanamadı.');
    const jobId = requireScannerIdentifier(body.job_id);
    if (!await repository.retry({ jobId,now,staffId:staff.id,requestId })) throw createLeaseConflict();
    return { requeued:true };
}
