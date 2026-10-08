import { savePhysicalRegistration } from './physical-registration-routes.js';
import { ApiError } from '../domain/errors.js';
import { requirePhysicalStaff } from './physical-access-routes.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { createPhysicalIntakeRepository } from '../repositories/d1/physical-intake-repository.js';
import { normalizePhysicalStudentNumber, listPhysicalTransitions,
    requirePhysicalVersion, requirePhysicalRejectionReason, PHYSICAL_STATUS_FILTERS } from '../domain/physical-intake-policy.js';
import { savePhysicalPdf, openPhysicalPdf, removePhysicalPdf } from './physical-pdf-routes.js';

function requireKeys(body, allowed) {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'İstek alanlarını kontrol edin.');
}

async function readDetail(repository, id) {
    const intake = await repository.find(id);
    if (!intake) throw new ApiError(404, 'PHYSICAL_NOT_FOUND', 'Fiziksel teslim kaydı bulunamadı.');
    const files = (await repository.files(id)).results;
    const currentPdf = files.find(file => file.id === intake.current_pdf_id) || null;
    return { intake, files, current_pdf: currentPdf, allowed_transitions: listPhysicalTransitions(intake, currentPdf) };
}

function readQuery(body) {
    requireKeys(body, ['q', 'status', 'page', 'page_size']);
    const q = body.q ?? '';
    const status = body.status ?? 'all';
    const page = body.page ?? 1;
    const pageSize = body.page_size ?? 25;
    if (typeof q !== 'string' || q.length > 120 || typeof status !== 'string' || !Object.hasOwn(PHYSICAL_STATUS_FILTERS, status)
        || !Number.isSafeInteger(page) || page < 1 || page > 100_000
        || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve sayfalama alanlarını kontrol edin.');
    }
    return { q: q.trim(), statuses: PHYSICAL_STATUS_FILTERS[status], isDeleted: status === 'deleted', page, pageSize };
}

function translateWriteError(error) {
    console.error('Physical intake write failed.', { errorName: error.name });
    if (String(error.message).includes('UNIQUE constraint')) return new ApiError(409, 'PHYSICAL_ALREADY_EXISTS', 'Bu öğrenci için aktif fiziksel teslim kaydı var. Mevcut kaydı açın.');
    return error;
}

async function lookupReceipt(request, context) {
    requireMethod(request, 'POST');
    const body = await readJsonBody(request);
    requireKeys(body, ['student_number', 'application_type']);
    if (!['initial', 'renewal'].includes(body.application_type)) throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru türünü seçin.');
    const studentNumber = normalizePhysicalStudentNumber(body.student_number);
    const application = await context.repository.lookup(studentNumber, body.application_type);
    return { student_number: studentNumber, application };
}

async function mutateReceipt(request, context, action) {
    requireMethod(request, action === 'delete' ? 'DELETE' : action === 'status' ? 'PATCH' : 'POST');
    const body = await readJsonBody(request);
    requireKeys(body, action === 'status' ? ['lock_version', 'status', 'rejection_reason'] : ['lock_version']);
    const version = requirePhysicalVersion(body.lock_version);
    if (action === 'status') {
        const currentPdf = context.intake.current_pdf_id ? await context.repository.file(context.intake.current_pdf_id) : null;
        if (!listPhysicalTransitions(context.intake, currentPdf).includes(body.status)) throw new ApiError(409, 'PHYSICAL_STATUS_INVALID', 'Durum değişikliği için kaydı ve PDF dosyasını kontrol edin.');
    }
    let changed;
    try { changed = await context.repository.update({ id: context.intake.id, version, action, now: context.now,
        reason: action === 'status' && body.status === 'rejected' ? requirePhysicalRejectionReason(body.rejection_reason) : '',
        value: action === 'status' ? body.status : action === 'delete' ? context.now : null,
        staffId: context.staff.id, requestId: context.requestId }); }
    catch (error) { throw translateWriteError(error); }
    if (!changed) throw new ApiError(409, 'PHYSICAL_UPDATE_CONFLICT', 'Kayıt değişti. Yenileyip tekrar deneyin.');
    return readDetail(context.repository, context.intake.id);
}

async function routeReceipt(request, context, pathname) {
    const match = pathname.match(/^\/api\/staff\/physical-intakes\/([0-9a-f-]{36})(?:\/(status|restore|pdf|files\/([0-9a-f-]{36})\/(preview|download)))?$/i);
    if (!match) throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    const detail = await readDetail(context.repository, match[1]);
    const scoped = { ...context, intake: detail.intake };
    if (!match[2]) {
        if (request.method === 'DELETE') return mutateReceipt(request, scoped, 'delete');
        requireMethod(request, 'GET');
        return detail;
    }
    if (match[2] === 'status' || match[2] === 'restore') return mutateReceipt(request, scoped, match[2]);
    if (match[2] === 'pdf') {
        if (request.method === 'DELETE') return removePhysicalPdf(request, scoped);
        requireMethod(request, 'POST');
        return savePhysicalPdf(request, scoped);
    }
    requireMethod(request, 'GET');
    return openPhysicalPdf(scoped, { fileId: match[3], action: match[4] });
}

/** Routes the staff physical-delivery workspace.
 * @param {Request} request Staff request. @param {object} environment Worker bindings. @param {string} requestId Correlation ID.
 * @returns {Promise<object|Response>} Authorized receipt, query or PDF. @throws {ApiError} Invalid authority or state.
 */
export async function handlePhysicalIntakes(request, environment, requestId) {
    if (!['staging', 'production'].includes(environment.APP_ENV)) throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    const staff = await requirePhysicalStaff(request, environment);
    if (!environment.DB || !environment.DOCUMENTS) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Fiziksel teslim hizmeti kullanılamıyor.');
    if (request.method !== 'GET') requireSameOrigin(request);
    const pathname = new URL(request.url).pathname;
    const context = { repository: createPhysicalIntakeRepository(environment.DB), environment, staff, requestId, now: new Date().toISOString() };
    if (pathname === '/api/staff/physical-intakes/register') return readDetail(context.repository, await savePhysicalRegistration(request, context));
    if (pathname === '/api/staff/physical-intakes') throw new ApiError(400, 'PDF_REQUIRED', 'Fiziksel Dosya Gir ile PDF ve öğrenci bilgilerini birlikte kaydedin.');
    if (pathname === '/api/staff/physical-intakes/lookup') return lookupReceipt(request, context);
    if (pathname === '/api/staff/physical-intakes/query') {
        requireMethod(request, 'POST');
        return context.repository.list(readQuery(await readJsonBody(request)));
    }
    return routeReceipt(request, context, pathname);
}
