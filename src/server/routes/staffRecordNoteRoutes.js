import { requireStaff } from '../auth/staffAuth.js';
import { ApiError } from '../domain/errors.js';
import {
    createStaffRecordNoteDto,
    createStaffRecordNoteItemDto,
    validateRecordId,
    validateRecordIdsQuery,
    validateRecordKind,
    validateRecordNoteBody
} from '../domain/staffRecordNote.js';
import { readJsonBody } from '../http/requestBody.js';
import { createRepositories, requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);

/**
 * Yetkili personel için verilen kayıt kimliklerine ait iç notları toplu olarak okur.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @returns {Promise<{notes: Record<string, object>}>} Yalnızca notu bulunan kimlikleri içeren harita.
 * @throws {ApiError} Oturum veya sorgu doğrulaması başarısızsa hata fırlatır.
 */
export async function readStaffRecordNotes(request, environment) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const { searchParams } = new URL(request.url);
    const kind = validateRecordKind(searchParams.get('kind'));
    const ids = validateRecordIdsQuery(searchParams.get('ids'));
    if (ids.length === 0) return { notes: {} };
    const rows = await createRepositories(environment).staffRecordNotes.listByIds({ kind, ids });
    const notes = {};
    for (const row of rows) {
        notes[row.record_id] = createStaffRecordNoteItemDto(row);
    }
    return { notes };
}

/**
 * Bir online başvuru veya aktif fiziksel teslim kaydı için personel iç notunu oluşturur ya da günceller.
 * @param {{request: Request, environment: object, kind: string, recordId: string, requestId: string}} input Rota bağlamı.
 * @returns {Promise<{note: object}>} Kaydedilen personel notu.
 * @throws {ApiError} Doğrulama, köken, yetki veya hedef kayıt eksikliğinde hata fırlatır.
 */
export async function upsertStaffRecordNote({ request, environment, kind, recordId, requestId }) {
    requireMethod(request, 'PUT');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const validatedKind = validateRecordKind(kind);
    const validatedId = validateRecordId(recordId);
    const body = validateRecordNoteBody(await readJsonBody(request));
    const saved = await createRepositories(environment).staffRecordNotes.upsert({
        kind: validatedKind,
        recordId: validatedId,
        body,
        staffId: staff.id,
        now: new Date().toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    if (!saved) {
        throw new ApiError(404, 'RECORD_NOT_FOUND', 'Kayıt bulunamadı.');
    }
    return { note: createStaffRecordNoteDto(saved) };
}

/**
 * Bir kayda ait personel iç notunu eşzamanlı olarak siler (yoksa da 200 döner).
 * @param {{request: Request, environment: object, kind: string, recordId: string, requestId: string}} input Rota bağlamı.
 * @returns {Promise<{deleted: true}>} Silme sonucu.
 * @throws {ApiError} Doğrulama, köken veya yetki hatasında hata fırlatır.
 */
export async function deleteStaffRecordNote({ request, environment, kind, recordId, requestId }) {
    requireMethod(request, 'DELETE');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const validatedKind = validateRecordKind(kind);
    const validatedId = validateRecordId(recordId);
    await createRepositories(environment).staffRecordNotes.remove({
        kind: validatedKind,
        recordId: validatedId,
        staffId: staff.id,
        now: new Date().toISOString(),
        requestId,
        auditId: crypto.randomUUID()
    });
    return { deleted: true };
}

/**
 * `/api/staff/record-notes` ve `/api/staff/record-notes/<kind>/<id>` uçlarını yönlendirir.
 * @param {Request} request Worker isteği.
 * @param {object} environment Worker bağlamları.
 * @param {string} requestId İstek izleme kimliği.
 * @returns {Promise<object>} JSON yanıt nesnesi.
 * @throws {ApiError} Eşleşmeyen yol veya geçersiz HTTP yöntemi durumunda hata fırlatır.
 */
export async function handleStaffRecordNotes(request, environment, requestId) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/record-notes') {
        return readStaffRecordNotes(request, environment);
    }
    const match = pathname.match(/^\/api\/staff\/record-notes\/([^/]+)\/([^/]+)$/);
    if (!match) {
        throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    }
    let kind;
    let recordId;
    try {
        kind = decodeURIComponent(match[1]);
        recordId = decodeURIComponent(match[2]);
    } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Kayıt bilgilerini kontrol edip tekrar deneyin.');
    }
    if (request.method === 'PUT') {
        return upsertStaffRecordNote({ request, environment, kind, recordId, requestId });
    }
    if (request.method === 'DELETE') {
        return deleteStaffRecordNote({ request, environment, kind, recordId, requestId });
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Bu istek yöntemi desteklenmiyor.');
}
