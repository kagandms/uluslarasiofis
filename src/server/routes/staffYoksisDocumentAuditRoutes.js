import { ApiError } from '../domain/errors.js';
import { jsonResponse } from '../http/apiResponse.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireStaff } from '../auth/staffAuth.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const MAX_BATCH_RECORDS = 25;
const MAX_BATCH_BYTES = 128 * 1024;
const MAX_SEARCH_LENGTH = 120;
const MAX_PAGE_SIZE = 100;
const STATUS_CATEGORIES = new Set([
    'all', 'successful', 'pending', 'rejected', 'missing_documents', 'unreadable', 'other'
]);

function normalizeSearch(value) {
    return String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function readText(value, field, maxLength, { optional = false } = {}) {
    if (optional && (value === undefined || value === null)) return '';
    if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edin.`);
    const text = value.trim();
    if ((!optional && !text) || text.length > maxLength) {
        throw new ApiError(400, 'VALIDATION_ERROR', `${field} alanını kontrol edin.`);
    }
    return text;
}

function classifyStatus(applicationStatus, resultStatus) {
    if (resultStatus !== 'verified') return 'unreadable';
    const normalized = normalizeSearch(applicationStatus);
    if (['islem tamamlandi', 'tamamlandi'].includes(normalized)) return 'successful';
    if (normalized === 'islem bekliyor') return 'pending';
    if (normalized === 'eksik belge bekliyor') return 'missing_documents';
    if (['reddedildi', 'basvuru reddedildi', 'ret'].includes(normalized)) return 'rejected';
    return 'other';
}

function classifyWriteFailure(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('foreign key constraint')) return 'foreign-key-constraint';
    if (message.includes('check constraint')) return 'check-constraint';
    if (message.includes('not null constraint')) return 'not-null-constraint';
    if (message.includes('unique constraint')) return 'unique-constraint';
    if (message.includes('overloaded')) return 'database-overloaded';
    if (message.includes('locked') || message.includes('busy')) return 'database-busy';
    return 'database-write-failed';
}

function validateDocuments(value) {
    if (!Array.isArray(value) || value.length > 100) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Eksik evrak satırları okunamadı.');
    }
    return value.map((document) => {
        if (!document || typeof document !== 'object' || Array.isArray(document) || typeof document.required !== 'boolean') {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Eksik evrak satırları okunamadı.');
        }
        return {
            code: readText(document.code, 'Belge kodu', 80, { optional: true }),
            name: readText(document.name, 'Belge adı', 255),
            required: document.required,
            note: readText(document.note, 'Belge açıklaması', 255, { optional: true }),
            uploadStatus: readText(document.uploadStatus, 'Yükleme durumu', 80, { optional: true })
        };
    });
}

function validateRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !value.entry || typeof value.entry !== 'object' || Array.isArray(value.entry)
        || !value.result || typeof value.result !== 'object' || Array.isArray(value.result)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'YÖKSİS kayıt biçimi geçersiz.');
    }
    const applicationNumber = readText(value.entry.applicationNumber, 'Başvuru numarası', 15);
    const studentNumber = readText(value.entry.studentNumber, 'Öğrenci numarası', 14);
    if (!/^\d{4}-\d{2}-\d{7}$/.test(applicationNumber) || !/^\d{8,14}$/.test(studentNumber)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru veya öğrenci numarası geçersiz.');
    }
    const resultStatus = value.result.status;
    if (!['verified', 'unreadable', 'identity-mismatch'].includes(resultStatus)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'YÖKSİS okuma durumu geçersiz.');
    }

    if (resultStatus !== 'verified') {
        return {
            applicationNumber, studentNumber, firstName: '', lastName: '', passportNumber: '', phone: '',
            applicationStatus: '', statusCategory: 'unreadable', resultStatus, documents: []
        };
    }

    const identity = value.result.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
        || identity.applicationNumber !== applicationNumber || identity.studentNumber !== studentNumber) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'YÖKSİS kimlik doğrulaması başarısız.');
    }
    const firstName = readText(identity.firstName, 'Ad', 120);
    const lastName = readText(identity.lastName, 'Soyad', 120);
    const phone = readText(identity.phone, 'Telefon', 40);
    const passportNumber = readText(identity.passportNumber, 'Pasaport numarası', 64, { optional: true });
    const applicationStatus = readText(value.result.applicationStatus, 'YÖKSİS durumu', 300);
    const documents = validateDocuments(value.result.documents);
    return {
        applicationNumber, studentNumber, firstName, lastName, passportNumber, phone,
        applicationStatus,
        statusCategory: classifyStatus(applicationStatus, resultStatus),
        resultStatus,
        documents
    };
}

function validateBatch(body) {
    if (!body || Object.keys(body).some((key) => !['scanId', 'records'].includes(key))
        || typeof body.scanId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.scanId)
        || !Array.isArray(body.records) || body.records.length < 1 || body.records.length > MAX_BATCH_RECORDS) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Tarama paketinin biçimini kontrol edin.');
    }
    return body.records.map(validateRecord);
}

async function writeRecords(request, environment, requestId, staff) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const records = validateBatch(await readJsonBody(request, MAX_BATCH_BYTES));
    const scannedAt = new Date().toISOString();
    const statements = records.map((record) => {
        const searchText = normalizeSearch([
            record.firstName, record.lastName, record.studentNumber, record.passportNumber
        ].join(' ')).slice(0, 500);
        return environment.DB.prepare(`
            INSERT INTO yoksis_document_audit_records (
                application_number, student_number, first_name, last_name, passport_number, phone,
                application_status, status_category, result_status, documents_json, search_text,
                scanned_at, updated_by_staff_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(application_number) DO UPDATE SET
                student_number = excluded.student_number,
                first_name = excluded.first_name,
                last_name = excluded.last_name,
                passport_number = excluded.passport_number,
                phone = excluded.phone,
                application_status = excluded.application_status,
                status_category = excluded.status_category,
                result_status = excluded.result_status,
                documents_json = excluded.documents_json,
                search_text = excluded.search_text,
                scanned_at = excluded.scanned_at,
                updated_by_staff_id = excluded.updated_by_staff_id
        `).bind(
            record.applicationNumber, record.studentNumber, record.firstName, record.lastName,
            record.passportNumber, record.phone, record.applicationStatus, record.statusCategory,
            record.resultStatus, JSON.stringify(record.documents), searchText, scannedAt, staff.id
        );
    });
    try {
        await environment.DB.batch(statements);
    } catch (error) {
        console.error('YÖKSİS ortak kayıt yazımı başarısız.', {
            requestId,
            errorName: error?.name || 'UnknownError',
            failureKind: classifyWriteFailure(error),
            recordCount: records.length
        });
        throw error;
    }
    return jsonResponse({ storedCount: records.length, scannedAt }, 200, requestId);
}

function readQuery(body) {
    if (!body || Object.keys(body).some((key) => !['q', 'status', 'page', 'pageSize'].includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edin.');
    }
    const query = body.q === undefined ? '' : readText(body.q, 'Arama metni', MAX_SEARCH_LENGTH, { optional: true });
    const status = body.status === undefined ? 'all' : body.status;
    const page = body.page === undefined ? 1 : body.page;
    const pageSize = body.pageSize === undefined ? 50 : body.pageSize;
    if (typeof status !== 'string' || !STATUS_CATEGORIES.has(status)
        || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000
        || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edin.');
    }
    return { normalizedQuery: normalizeSearch(query), status, page, pageSize };
}

async function readRecords(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { normalizedQuery, status, page, pageSize } = readQuery(await readJsonBody(request));
    const escapedQuery = normalizedQuery.replace(/[!%_]/g, '!$&');
    const pattern = `%${escapedQuery}%`;
    const statusClause = status === 'all' ? '' : 'AND status_category = ?';
    const searchClause = normalizedQuery ? "AND search_text LIKE ? ESCAPE '!'" : '';
    const bindings = [
        ...(status === 'all' ? [] : [status]),
        ...(normalizedQuery ? [pattern] : [])
    ];
    const count = await environment.DB.prepare(`
        SELECT COUNT(*) AS total FROM yoksis_document_audit_records
        WHERE 1 = 1 ${statusClause} ${searchClause}
    `).bind(...bindings).first();
    const result = await environment.DB.prepare(`
        SELECT application_number, student_number, first_name, last_name, passport_number,
               phone, application_status, status_category, result_status, documents_json, scanned_at
        FROM yoksis_document_audit_records
        WHERE 1 = 1 ${statusClause} ${searchClause}
        ORDER BY scanned_at DESC, application_number
        LIMIT ? OFFSET ?
    `).bind(...bindings, pageSize, (page - 1) * pageSize).all();
    const records = (result.results || []).map(({ documents_json: documentsJson, ...record }) => ({
        ...record,
        documents: JSON.parse(documentsJson)
    }));
    return jsonResponse({ records, total: count?.total || 0, page, pageSize }, 200, requestId);
}

export async function handleStaffYoksisDocumentAudit(request, environment, requestId) {
    const staff = await requireStaff(request, environment);
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/yoksis-document-audit/records') return writeRecords(request, environment, requestId, staff);
    if (pathname === '/api/staff/yoksis-document-audit/query') return readRecords(request, environment, requestId);
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kayıt bulunamadı.');
}
