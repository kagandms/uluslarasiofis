import { requireStaff } from '../auth/staffAuth.js';
import { readDocumentPolicy } from '../domain/documentPolicy.js';
import { ApiError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { routeResult } from '../http/routeResult.js';
import { createPrivateAttachmentResponse, createSafeFilename, isSafeDocumentMediaType } from './documentRoutes.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { createDocumentStorage } from '../storage/documentStorage.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const PREVIEW_TTL_SECONDS = 120;
const ZIP_ENTRY_EXTENSIONS = Object.freeze({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

function unavailableDocument() {
    return new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya erişilemiyor.');
}

function unavailableApplication() {
    return new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
}

function requireSameOriginArchiveRead(request) {
    const requestOrigin = new URL(request.url).origin;
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');
    for (const candidate of [origin, referer]) {
        if (!candidate) continue;
        try {
            if (new URL(candidate).origin === requestOrigin) return;
        } catch { /* Try the browser's fetch metadata fallback. */ }
    }
    if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return;
    throw new ApiError(403, 'CROSS_ORIGIN_REQUEST', 'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.');
}

async function resolveCurrentDocument(environment, applicationId, code) {
    if (!environment?.DB || !environment?.DOCUMENTS) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Belge hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.', true);
    }
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || application.status === 'draft') throw unavailableApplication();
    const deletion = await environment.DB.prepare(`SELECT state FROM application_deletions WHERE application_id=?`)
        .bind(applicationId).first();
    if (deletion?.state === 'purge_pending') throw unavailableApplication();
    const policy = readDocumentPolicy(
        code,
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type ?? null
    );
    if (!policy) throw unavailableDocument();
    const file = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
    if (!file || !isSafeDocumentMediaType(file.media_type) || !policy.accepted_media_types.includes(file.media_type)) {
        throw unavailableDocument();
    }
    return { repositories, application, file };
}

async function writeAccessAudit({ repositories, staff, application, file, code, requestId, eventType, result }) {
    await repositories.audit.writeEvent({
        id: crypto.randomUUID(),
        eventType,
        actorType: 'staff',
        actorStaffId: staff.id,
        applicationId: application.id,
        documentRecordId: file.document_record_id,
        requestId,
        metadata: { documentCode: code, revisionNumber: file.revision_number, result }
    });
}

function archiveIdentity(applicationId, file, object) {
    const identitySource = [applicationId, file.id, file.revision_id, file.revision_number,
        object.etag, object.size].join('|');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(identitySource))
        .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

async function resolveArchiveFile(environment, applicationId, code) {
    const resolved = await resolveCurrentDocument(environment, applicationId, code);
    const { file } = resolved;
    if (file.revision_status !== 'submitted' && file.revision_status !== 'approved'
        && file.revision_status !== 'resubmission_required') throw unavailableDocument();
    if (file.upload_status !== 'finalized' || file.scan_status !== 'clean'
        || file.cleanup_status !== 'none' || file.upload_intent_status !== 'completed') throw unavailableDocument();
    const object = await createDocumentStorage(environment).head(file.storage_key);
    if (!object || !Number.isSafeInteger(object.size) || object.size !== file.byte_size
        || typeof object.etag !== 'string' || !object.etag) throw unavailableDocument();
    return { ...resolved, object, identity: await archiveIdentity(applicationId, file, object) };
}

function guardArchiveStream(body, environment, applicationId, code, expectedIdentity) {
    const reader = body.getReader();
    return new ReadableStream({
        async pull(controller) {
            try {
                const result = await reader.read();
                if (!result.done) {
                    controller.enqueue(result.value);
                    return;
                }
                const current = await resolveArchiveFile(environment, applicationId, code);
                if (current.identity !== expectedIdentity) throw new Error('Archive source changed.');
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel(reason) {
            await reader.cancel(reason);
        }
    });
}

/** Builds a safe manifest using only applicable current documents that pass every access gate. */
export async function createStaffApplicationArchiveManifest({ request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || application.status === 'draft') throw unavailableApplication();
    const requirements = await repositories.documents.listStudentRequirements(applicationId);
    const files = [];
    let totalSourceBytes = 0;
    for (const requirement of requirements) {
        const policy = readDocumentPolicy(requirement.code, application.application_type,
            application.is_under_18 === 1, application.address_evidence_type ?? null);
        if (!policy || requirement.revision_number === null || requirement.revision_number === undefined) continue;
        const resolved = await resolveArchiveFile(environment, applicationId, requirement.code);
        if (resolved.file.revision_number !== requirement.revision_number) {
            throw new ApiError(409, 'DOCUMENT_CHANGED', 'Belge listesi oluşturulurken değişti. ZIP işlemi iptal edildi.');
        }
        const extension = ZIP_ENTRY_EXTENSIONS[resolved.file.media_type];
        if (!extension || !policy.accepted_media_types.includes(resolved.file.media_type)
            || resolved.file.byte_size > policy.max_byte_size) throw unavailableDocument();
        totalSourceBytes += resolved.file.byte_size;
        files.push({
            code: requirement.code,
            expected_revision_number: resolved.file.revision_number,
            object_identity: resolved.identity,
            media_type: resolved.file.media_type,
            byte_size: resolved.file.byte_size,
            entry_name: `${String(files.length + 1).padStart(2, '0')}-${requirement.code}.${extension}`
        });
    }
    await repositories.audit.writeEvent({
        id: crypto.randomUUID(), eventType: 'staff.application_archive_requested', actorType: 'staff',
        actorStaffId: staff.id, applicationId, requestId,
        metadata: { result: 'manifest_prepared' }
    });
    return routeResult({ files, total_source_bytes: totalSourceBytes });
}

/** Streams one manifest-pinned private object after revalidating its revision and R2 ETag. */
export async function streamStaffApplicationArchiveFile({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'GET');
    requireSameOriginArchiveRead(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const parameters = new URL(request.url).searchParams;
    const expectedRevision = Number(parameters.get('revision'));
    const expectedIdentity = parameters.get('identity');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || !/^[a-f0-9]{64}$/.test(expectedIdentity || '')) throw unavailableDocument();
    const resolved = await resolveArchiveFile(environment, applicationId, code);
    if (resolved.file.revision_number !== expectedRevision || resolved.identity !== expectedIdentity) {
        throw new ApiError(409, 'DOCUMENT_CHANGED', 'Belge listesi değişti. ZIP işlemi iptal edildi.');
    }
    const object = await createDocumentStorage(environment).get(resolved.file.storage_key, {
        etagMatches: resolved.object.etag
    });
    if (!object?.body || object.size !== resolved.file.byte_size || object.etag !== resolved.object.etag) {
        throw new ApiError(409, 'DOCUMENT_CHANGED', 'Belge artık güvenli biçimde indirilemiyor. ZIP işlemi iptal edildi.');
    }
    await writeAccessAudit({ repositories: resolved.repositories, staff, application: resolved.application,
        file: resolved.file, code, requestId, eventType: 'staff.application_archive_document_stream_authorized',
        result: 'stream_authorized' });
    return new Response(guardArchiveStream(object.body, environment, applicationId, code, resolved.identity), { status: 200, headers: {
        'Content-Type': resolved.file.media_type,
        'Content-Length': String(resolved.file.byte_size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    } });
}

/**
 * Issues a short-lived capability for one authorized, clean current application document.
 * @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Validated route context.
 * @returns {Promise<object>} Safe capability DTO for the authenticated staff UI.
 */
export async function createStaffDocumentPreview({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const resolved = await resolveCurrentDocument(environment, applicationId, code);
    const storage = createDocumentStorage(environment);
    const object = await storage.head(resolved.file.storage_key);
    if (!object) throw unavailableDocument();

    let capability;
    try {
        capability = await storage.createReadCapability(resolved.file.storage_key, {
            expiresInSeconds: PREVIEW_TTL_SECONDS
        });
    } catch {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Belge önizlemesi şu anda açılamıyor. Daha sonra tekrar deneyin.', true);
    }
    await writeAccessAudit({
        repositories: resolved.repositories, staff, application: resolved.application,
        file: resolved.file, code, requestId, eventType: 'staff.document_preview_issued', result: 'capability_issued'
    });
    return routeResult({
        method: capability.method,
        url: capability.url,
        expires_at: capability.expiresAt,
        media_type: resolved.file.media_type,
        filename: createSafeFilename(resolved.file.original_filename)
    });
}

/**
 * Returns one authorized, clean current application document as a private attachment.
 * @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Validated route context.
 * @returns {Promise<Response>} Safe attachment response.
 */
export async function downloadStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'GET');
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const resolved = await resolveCurrentDocument(environment, applicationId, code);
    const object = await createDocumentStorage(environment).get(resolved.file.storage_key);
    if (!object?.body) throw unavailableDocument();
    await writeAccessAudit({
        repositories: resolved.repositories, staff, application: resolved.application,
        file: resolved.file, code, requestId, eventType: 'staff.document_downloaded', result: 'downloaded'
    });
    return createPrivateAttachmentResponse(resolved.file, object);
}
