import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import {
    createInquiryDto,
    validateInquiryId,
    validateInquiryListQuery,
    validateInquiryStatusUpdateBody
} from '../domain/officeInquiry.js';
import { readJsonBody } from '../http/requestBody.js';
import { createRepositories, requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);

/**
 * Yetkili personel için gelen soruları ve durum sayılarını listeler.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @returns {Promise<{items: Array<object>, counts: {new: number, answered: number}}>} Soru listesi ve sayımlar.
 * @throws {ApiError} Yöntem, oturum veya sorgu doğrulaması başarısızsa hata fırlatır.
 */
export async function listStaffInquiries(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const { searchParams } = new URL(request.url);
    const { status, limit } = validateInquiryListQuery(searchParams);
    const { officeInquiries } = createRepositories(environment);
    const [rows, counts] = await Promise.all([
        officeInquiries.list({ status, limit }),
        officeInquiries.countByStatus()
    ]);
    return {
        items: rows.map(createInquiryDto),
        counts
    };
}

/**
 * Yetkili personel için bir soru kaydının durumunu (`new` veya `answered`) günceller.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} inquiryId Soru kimliği.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<{item: object}>} Güncellenmiş soru DTO'su.
 * @throws {ApiError} Köken, yetki, doğrulama veya kayıt eksikliğinde hata fırlatır.
 */
export async function updateStaffInquiry(request, environment, inquiryId, requestId) {
    requireMethod(request, 'PATCH');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const validatedId = validateInquiryId(inquiryId);
    const status = validateInquiryStatusUpdateBody(await readJsonBody(request, 4096));
    const updated = await createRepositories(environment).officeInquiries.updateStatus({
        id: validatedId,
        status,
        staffId: staff.id,
        nowIso: new Date().toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    if (!updated) {
        throw new ApiError(404, 'INQUIRY_NOT_FOUND', 'Soru kaydı bulunamadı.');
    }
    return { item: createInquiryDto(updated) };
}

/**
 * Yetkili personel için bir soru kaydını kalıcı olarak siler ve kişisel veri içermeyen denetim kaydı yazar.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} inquiryId Soru kimliği.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<{deleted: true}>} Silme sonucu.
 * @throws {ApiError} Köken, yetki, doğrulama veya kayıt eksikliğinde hata fırlatır.
 */
export async function deleteStaffInquiry(request, environment, inquiryId, requestId) {
    requireMethod(request, 'DELETE');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const validatedId = validateInquiryId(inquiryId);
    const deleted = await createRepositories(environment).officeInquiries.deleteById({
        id: validatedId,
        staffId: staff.id,
        nowIso: new Date().toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    if (!deleted) {
        throw new ApiError(404, 'INQUIRY_NOT_FOUND', 'Soru kaydı bulunamadı.');
    }
    return { deleted: true };
}

/**
 * `/api/staff/inquiries` ve `/api/staff/inquiries/<id>` uçlarını yönlendirir.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<object>} JSON yanıt nesnesi.
 * @throws {ApiError} Eşleşmeyen yol veya geçersiz HTTP yöntemi durumunda hata fırlatır.
 */
export async function handleStaffInquiries(request, environment, requestId) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/inquiries') {
        return listStaffInquiries(request, environment);
    }
    const match = pathname.match(/^\/api\/staff\/inquiries\/([^/]+)$/);
    if (!match) {
        throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    }
    let inquiryId;
    try {
        inquiryId = decodeURIComponent(match[1]);
    } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Soru kimliği geçersiz.');
    }
    if (request.method === 'PATCH') {
        return updateStaffInquiry(request, environment, inquiryId, requestId);
    }
    if (request.method === 'DELETE') {
        return deleteStaffInquiry(request, environment, inquiryId, requestId);
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
}
