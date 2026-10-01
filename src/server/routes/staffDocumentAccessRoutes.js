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

function unavailableDocument() {
    return new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya erişilemiyor.');
}

function unavailableApplication() {
    return new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
}

async function resolveCurrentDocument(environment, applicationId, code) {
    if (!environment?.DB || !environment?.DOCUMENTS) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Belge hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.', true);
    }
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || application.status === 'draft') throw unavailableApplication();
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
