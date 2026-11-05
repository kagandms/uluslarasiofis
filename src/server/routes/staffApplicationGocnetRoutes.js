import { ApiError } from '../domain/errors.js';
import { listApplicationDocumentPolicies } from '../domain/documentPolicy.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { readJsonBody } from '../http/requestBody.js';
import { createStaffApplicationArchiveManifest } from './staffDocumentAccessRoutes.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const APPLICATION_NUMBER = /^20\d{2}-\d{2}-\d{5,8}$/;
const HASH = /^[a-f0-9]{64}$/;
const EVENT_STATES = new Set(['querying', 'saving', 'uploading', 'uploaded_for_review', 'existing_record', 'stopped', 'failed', 'outcome_unknown']);

function invalidRequest() {
    return new ApiError(400, 'VALIDATION_ERROR', 'GöçNet aktarım bilgilerini kontrol edip tekrar deneyin.');
}

function readAttemptBody(body) {
    if (Object.keys(body).some((key) => !['attemptId', 'applicationNumber', 'manifestFingerprint', 'pdfSha256'].includes(key))
        || typeof body.attemptId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.attemptId)
        || typeof body.applicationNumber !== 'string' || !APPLICATION_NUMBER.test(body.applicationNumber)
        || typeof body.manifestFingerprint !== 'string' || !HASH.test(body.manifestFingerprint)
        || typeof body.pdfSha256 !== 'string' || !HASH.test(body.pdfSha256)) throw invalidRequest();
    return body;
}

function readEventBody(body) {
    if (Object.keys(body).some((key) => !['eventId', 'sequence', 'state', 'remoteRecordId', 'expectedPdfSha256'].includes(key))
        || typeof body.eventId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.eventId)
        || !Number.isSafeInteger(body.sequence) || body.sequence < 1
        || typeof body.state !== 'string' || !EVENT_STATES.has(body.state)
        || (body.state === 'querying' ? (typeof body.expectedPdfSha256 !== 'string' || !HASH.test(body.expectedPdfSha256))
            : body.expectedPdfSha256 !== undefined)
        || (body.remoteRecordId !== undefined && (typeof body.remoteRecordId !== 'string'
            || !/^[A-Za-z0-9._-]{1,80}$/.test(body.remoteRecordId)))) throw invalidRequest();
    return body;
}

async function readApplicationAndManifest(request, environment, applicationId, requestId) {
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || !application.submitted_at || ['draft', 'completed', 'cancelled', 'rejected'].includes(application.status)) {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Gönderilmiş başvuru bulunamadı.');
    }
    const deletion = await environment.DB.prepare('SELECT state FROM application_deletions WHERE application_id=?').bind(applicationId).first();
    if (deletion) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Gönderilmiş başvuru bulunamadı.');
    const [requirements, manifestResult] = await Promise.all([
        repositories.documents.listStudentRequirements(applicationId),
        createStaffApplicationArchiveManifest({ request, environment, applicationId, requestId })
    ]);
    const manifest = manifestResult?.body;
    if (!Array.isArray(manifest?.files)) throw new ApiError(409, 'DOCUMENT_CHANGED', 'Güncel güvenli belge listesi doğrulanamadı.');
    const present = new Set(manifest.files.map((file) => file.code));
    const requirementsByCode = new Map(requirements.map((item) => [item.code, item]));
    const blockedDocument = requirements.find((item) => item.revision_number != null
        && ['pending', 'unsafe', 'failed'].includes(item.scan_status));
    if (blockedDocument) throw new ApiError(409, 'DOCUMENT_NOT_READY', 'Belge güvenlik taramasından geçmeden GöçNet aktarımı başlayamaz.');
    const missingRequired = listApplicationDocumentPolicies(application).find((policy) => {
        const requirement = requirementsByCode.get(policy.code);
        return policy.required && (!requirement || !present.has(policy.code));
    });
    if (missingRequired) throw new ApiError(409, 'DOCUMENT_NOT_READY', 'Gerekli belgeler güncel, güvenli ve eksiksiz olmalıdır.');
    const fingerprint = await hashText(manifest.files.map((file) => [file.code, file.expected_revision_number,
        file.object_identity, file.media_type, file.byte_size].join('|')).join('\n'));
    return { repositories, application, manifest, fingerprint };
}

async function hashText(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createStaffApplicationGocnetAttempt(request, environment, applicationId, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = readAttemptBody(await readJsonBody(request, 4096));
    const { repositories, fingerprint } = await readApplicationAndManifest(request, environment, applicationId, requestId);
    if (fingerprint !== body.manifestFingerprint) throw new ApiError(409, 'DOCUMENT_CHANGED', 'Başvuru belgeleri hazırlık sırasında değişti.');
    let attempt;
    try {
        attempt = await repositories.applicationGocnet.createAttempt({
            id: body.attemptId, applicationId, staffId: staff.id,
            applicationNumberHash: await hashText(body.applicationNumber),
            manifestFingerprint: fingerprint, pdfSha256: body.pdfSha256, createdAt: new Date().toISOString()
        });
    } catch (error) {
        if (error?.code === 'GOCNET_ATTEMPT_CONFLICT') throw new ApiError(409, error.code, 'Bu başvuru veya kayıt numarası için etkin bir aktarım bulunuyor.');
        throw error;
    }
    return { attemptId: attempt.id, state: attempt.state };
}

export async function recordStaffApplicationGocnetEvent(request, environment, applicationId, attemptId, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = readEventBody(await readJsonBody(request, 4096));
    const repository = createD1Repositories(environment.DB).applicationGocnet;
    const attempt = await repository.findAttempt(attemptId, applicationId);
    if (!attempt) throw new ApiError(404, 'GOCNET_ATTEMPT_NOT_FOUND', 'GöçNet aktarım denemesi bulunamadı.');
    const priorEvent = await repository.findEvent(attemptId, body.eventId);
    if (priorEvent) {
        if (priorEvent.sequence !== body.sequence || priorEvent.state !== body.state
            || (priorEvent.remote_record_id ?? null) !== (body.remoteRecordId ?? null)) {
            throw new ApiError(409, 'GOCNET_EVENT_CONFLICT', 'Aktarım aşaması doğrulanamadı.');
        }
        return { attemptId: attempt.id, state: attempt.state, sequence: attempt.last_event_sequence };
    }
    if (body.state === 'saving' || body.state === 'uploading') {
        const current = await readApplicationAndManifest(request, environment, applicationId, requestId);
        if (current.fingerprint !== attempt.manifest_fingerprint) throw new ApiError(409, 'DOCUMENT_CHANGED', 'Başvuru belgeleri aktarım sırasında değişti; GöçNet işlemi durduruldu.');
    }
    let updated;
    try {
        updated = await repository.appendEvent({
            attemptId, applicationId, eventId: body.eventId, actorStaffId: staff.id,
            sequence: body.sequence, state: body.state,
            remoteRecordId: body.remoteRecordId ?? null, expectedPdfSha256: body.expectedPdfSha256 ?? null,
            createdAt: new Date().toISOString()
        });
    } catch (error) {
        if (error?.code === 'GOCNET_EVENT_CONFLICT') throw new ApiError(409, error.code, 'Aktarım aşaması doğrulanamadı.');
        throw error;
    }
    return { attemptId: updated.id, state: updated.state, sequence: updated.last_event_sequence };
}
