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
// Online application match: 'matched' = student number or full name belongs to an application already forwarded to the Migration
// Administration; 'unmatched' = neither. Drafts and applications still in review do not count.
const MATCH_FILTERS = new Set(['all', 'matched', 'unmatched']);

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
    const causes = [error, error?.cause, error?.cause?.cause];
    const message = causes.map((cause) => cause?.message).filter((value) => typeof value === 'string').join(' ').toLowerCase();
    if (message.includes('foreign key constraint')) return 'foreign-key-constraint';
    if (message.includes('check constraint')) return 'check-constraint';
    if (message.includes('not null constraint')) return 'not-null-constraint';
    if (message.includes('unique constraint')) return 'unique-constraint';
    if (message.includes('daily row write limit')) return 'database-write-limit';
    if (message.includes('maximum db size') || message.includes('maximum account storage limit')) return 'database-storage-limit';
    if (message.includes('overloaded')) return 'database-overloaded';
    if (message.includes('storage operation exceeded timeout')) return 'database-timeout';
    if (message.includes('isolate exceeded its memory limit')) return 'database-memory-limit';
    if (message.includes('exceeded its cpu time limit')) return 'database-cpu-limit';
    if (message.includes('network connection lost')
        || message.includes('replica disconnected')
        || message.includes('reset because its code was updated')
        || message.includes('internal error') && message.includes('storage')
        || message.includes('cannot resolve d1 db due to transient issue')) return 'database-transient';
    if (message.includes('d1_type_error')) return 'database-type-error';
    if (message.includes('d1_column_notfound') || message.includes('no such column')) return 'database-column-error';
    if (message.includes('d1_exec_error') || message.includes('syntax error')) return 'database-sql-error';
    if (message.includes('locked') || message.includes('busy')) return 'database-busy';
    return 'database-write-failed';
}

function readWriteFailureCode(error) {
    const causes = [error, error?.cause, error?.cause?.cause];
    const codes = causes.map((cause) => cause?.code).filter((value) => typeof value === 'string');
    const message = causes.map((cause) => cause?.message).filter((value) => typeof value === 'string').join(' ');
    const code = [...codes, message.match(/\b(?:D1_[A-Z_]+|SQLITE_[A-Z_]+)\b/i)?.[0]]
        .find((value) => typeof value === 'string' && /^(?:D1_[A-Z_]+|SQLITE_[A-Z_]+)$/i.test(value));
    return code ? code.toUpperCase() : 'UNCLASSIFIED';
}

function readWriteFailureDetail(error) {
    const causes = [error, error?.cause, error?.cause?.cause];
    return causes.map((cause) => cause?.message).filter((value) => typeof value === 'string').join(' | ')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
        .replace(/\b\d{4}-\d{2}-\d{7}\b/g, '[redacted]')
        .replace(/\b(?=[A-Z0-9]{6,32}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, '[redacted]')
        .replace(/\b\d{6,}\b/g, '[redacted]')
        .slice(0, 400) || 'no-message';
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
            WHERE excluded.result_status = 'verified'
                OR yoksis_document_audit_records.result_status <> 'verified'
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
            failureCode: readWriteFailureCode(error),
            failureDetail: readWriteFailureDetail(error),
            recordCount: records.length
        });
        throw error;
    }
    return jsonResponse({ storedCount: records.length, scannedAt }, 200, requestId);
}

function readQuery(body) {
    if (!body || Object.keys(body).some((key) => !['q', 'status', 'match', 'page', 'pageSize'].includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edin.');
    }
    const query = body.q === undefined ? '' : readText(body.q, 'Arama metni', MAX_SEARCH_LENGTH, { optional: true });
    const status = body.status === undefined ? 'all' : body.status;
    const match = body.match === undefined ? 'all' : body.match;
    const page = body.page === undefined ? 1 : body.page;
    const pageSize = body.pageSize === undefined ? 50 : body.pageSize;
    if (typeof status !== 'string' || !STATUS_CATEGORIES.has(status)
        || typeof match !== 'string' || !MATCH_FILTERS.has(match)
        || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000
        || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edin.');
    }
    return { normalizedQuery: normalizeSearch(query), status, match, page, pageSize };
}

/**
 * Loads the student numbers and normalized full names of every online application.
 * Only applications forwarded to the Migration Administration (sent, approved or completed) count.
 */
async function loadOnlineApplicationKeys(environment) {
    const result = await environment.DB.prepare(`
        SELECT students.student_number AS student_number, applications.first_name, applications.last_name
        FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE applications.status IN ('sent_to_migration', 'migration_approved', 'completed')
          AND NOT EXISTS (SELECT 1 FROM application_deletions WHERE application_id = applications.id)
    `).all();
    const studentNumbers = new Set();
    const fullNames = new Set();
    for (const row of result.results || []) {
        const studentNumber = String(row.student_number || '').trim();
        if (studentNumber) studentNumbers.add(studentNumber);
        const fullName = normalizeSearch(`${row.first_name || ''} ${row.last_name || ''}`);
        if (fullName) fullNames.add(fullName);
    }
    return { studentNumbers, fullNames };
}

function matchesOnlineApplication(record, keys) {
    if (keys.studentNumbers.has(String(record.student_number || '').trim())) return true;
    return keys.fullNames.has(normalizeSearch(`${record.first_name || ''} ${record.last_name || ''}`));
}

async function readRecords(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { normalizedQuery, status, match, page, pageSize } = readQuery(await readJsonBody(request));
    const escapedQuery = normalizedQuery.replace(/[!%_]/g, '!$&');
    const pattern = `%${escapedQuery}%`;
    const statusClause = status === 'all' ? '' : 'AND status_category = ?';
    const searchClause = normalizedQuery ? "AND search_text LIKE ? ESCAPE '!'" : '';
    const bindings = [
        ...(status === 'all' ? [] : [status]),
        ...(normalizedQuery ? [pattern] : [])
    ];
    if (match !== 'all') {
        // Name and student-number matching is computed here, so filtered pages are counted after matching.
        const candidates = (await environment.DB.prepare(`
            SELECT application_number, student_number, first_name, last_name, passport_number,
                   phone, application_status, status_category, result_status, documents_json, scanned_at
            FROM yoksis_document_audit_records
            WHERE 1 = 1 ${statusClause} ${searchClause}
            ORDER BY scanned_at DESC, application_number
        `).bind(...bindings).all()).results || [];
        const keys = await loadOnlineApplicationKeys(environment);
        const matched = candidates.filter((record) => {
            const isMatched = matchesOnlineApplication(record, keys);
            return match === 'matched' ? isMatched : !isMatched;
        });
        const records = matched.slice((page - 1) * pageSize, page * pageSize).map(({ documents_json: documentsJson, ...record }) => ({
            ...record,
            documents: JSON.parse(documentsJson)
        }));
        return jsonResponse({ records, total: matched.length, page, pageSize }, 200, requestId);
    }
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
