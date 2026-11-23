import { ApiError } from '../domain/errors.js';
import {
    MAX_BATCH_BYTES,
    MAX_BATCH_RECORDS,
    MAX_IMPORT_BATCH_ROWS,
    MAX_PAGE_SIZE,
    MAX_SEARCH_LENGTH,
    MATCH_FILTERS,
    STATUS_CATEGORIES,
    buildImportDocuments,
    classifyStatus,
    normalizeSearch,
    readAuditText,
    validateDocuments,
    validateExportedAt,
    validateImportRow
} from '../domain/yoksisAuditPolicy.js';
import { jsonResponse } from '../http/apiResponse.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireStaff } from '../auth/staffAuth.js';
import { requireMethod, requireSameOrigin } from './shared.js';

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

function validateRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !value.entry || typeof value.entry !== 'object' || Array.isArray(value.entry)
        || !value.result || typeof value.result !== 'object' || Array.isArray(value.result)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'YÖKSİS kayıt biçimi geçersiz.');
    }
    const applicationNumber = readAuditText(value.entry.applicationNumber, 'Başvuru numarası', 15);
    const studentNumber = readAuditText(value.entry.studentNumber, 'Öğrenci numarası', 14);
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
    const firstName = readAuditText(identity.firstName, 'Ad', 120);
    const lastName = readAuditText(identity.lastName, 'Soyad', 120);
    const phone = readAuditText(identity.phone, 'Telefon', 40);
    const passportNumber = readAuditText(identity.passportNumber, 'Pasaport numarası', 64, { optional: true });
    const applicationStatus = readAuditText(value.result.applicationStatus, 'YÖKSİS durumu', 300);
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

function validateImportEnvelope(body) {
    if (!body || Object.keys(body).some((key) => !['importId', 'exportedAt', 'final', 'rows'].includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Aktarım paketinin biçimini kontrol edin.');
    }
    if (typeof body.importId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.importId)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Aktarım kimliği geçersiz.');
    }
    if (typeof body.final !== 'boolean') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Aktarım bitiş bilgisi geçersiz.');
    }
    if (!Array.isArray(body.rows)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Aktarım satırları liste biçiminde olmalıdır.');
    }
    if (body.rows.length > MAX_IMPORT_BATCH_ROWS) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Bir pakette en fazla 50 satır gönderilebilir.');
    }
    if (!body.final && body.rows.length < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Aktarılacak en az bir satır gereklidir.');
    }
    const exportedAt = validateExportedAt(body.exportedAt);
    return { importId: body.importId, exportedAt, final: body.final, rows: body.rows };
}

function splitFullNameForStorage(fullName) {
    if (fullName.length <= 120) return { firstName: fullName, lastName: '' };
    const splitAt = fullName.lastIndexOf(' ', 120);
    if (splitAt > 0) {
        const rest = fullName.slice(splitAt + 1).trim();
        if (rest.length <= 120) {
            return { firstName: fullName.slice(0, splitAt).trim(), lastName: rest };
        }
    }
    return { firstName: fullName.slice(0, 120), lastName: fullName.slice(120, 240) };
}

async function importExcelRows(request, environment, requestId, staff) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { importId, exportedAt, final, rows } = validateImportEnvelope(
        await readJsonBody(request, MAX_BATCH_BYTES)
    );

    const validRows = [];
    const rejected = [];
    for (let index = 0; index < rows.length; index += 1) {
        try {
            validRows.push(validateImportRow(rows[index]));
        } catch (error) {
            rejected.push({
                index,
                reason: error instanceof ApiError ? error.message : 'Satır doğrulanamadı.'
            });
        }
    }

    if (validRows.length === 0 && !final) {
        return jsonResponse({ storedCount: 0, rejected }, 200, requestId);
    }

    const nowIso = new Date().toISOString();
    const statements = [
        environment.DB.prepare(`
            INSERT OR IGNORE INTO yoksis_audit_imports (
                id, uploaded_at, uploaded_by_staff_id, exported_at, row_count, finalized_at
            ) VALUES (?, ?, ?, ?, 0, NULL)
        `).bind(importId, nowIso, staff.id, exportedAt)
    ];

    for (const row of validRows) {
        const { firstName, lastName } = splitFullNameForStorage(row.fullName);
        const documents = buildImportDocuments(row.missingNote, row.missingDeadline);
        const searchText = normalizeSearch([row.fullName, row.studentNumber].join(' ')).slice(0, 500);
        statements.push(environment.DB.prepare(`
            INSERT INTO yoksis_document_audit_records (
                application_number, student_number, first_name, last_name, passport_number, phone,
                application_status, status_category, result_status, documents_json, search_text,
                scanned_at, updated_by_staff_id,
                source, last_seen_import_id, unit, program, missing_deadline, goc_last_query_at,
                last_transaction_type, transaction_count
            ) VALUES (?, ?, ?, ?, '', '', ?, ?, 'verified', ?, ?, ?, ?, 'excel', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(application_number) DO UPDATE SET
                student_number = excluded.student_number,
                first_name = CASE WHEN yoksis_document_audit_records.first_name <> '' THEN yoksis_document_audit_records.first_name ELSE excluded.first_name END,
                last_name = CASE WHEN yoksis_document_audit_records.last_name <> '' THEN yoksis_document_audit_records.last_name ELSE excluded.last_name END,
                passport_number = CASE WHEN yoksis_document_audit_records.passport_number <> '' THEN yoksis_document_audit_records.passport_number ELSE excluded.passport_number END,
                phone = CASE WHEN yoksis_document_audit_records.phone <> '' THEN yoksis_document_audit_records.phone ELSE excluded.phone END,
                application_status = excluded.application_status,
                status_category = excluded.status_category,
                result_status = excluded.result_status,
                documents_json = excluded.documents_json,
                search_text = CASE
                    WHEN yoksis_document_audit_records.first_name <> ''
                      OR yoksis_document_audit_records.last_name <> ''
                      OR yoksis_document_audit_records.passport_number <> ''
                    THEN yoksis_document_audit_records.search_text
                    ELSE excluded.search_text
                END,
                scanned_at = excluded.scanned_at,
                updated_by_staff_id = excluded.updated_by_staff_id,
                source = 'excel',
                last_seen_import_id = excluded.last_seen_import_id,
                unit = excluded.unit,
                program = excluded.program,
                missing_deadline = excluded.missing_deadline,
                goc_last_query_at = excluded.goc_last_query_at,
                last_transaction_type = excluded.last_transaction_type,
                transaction_count = excluded.transaction_count
        `).bind(
            row.applicationNumber, row.studentNumber, firstName, lastName,
            row.gocStatus, row.statusCategory, JSON.stringify(documents), searchText,
            nowIso, staff.id, importId, row.unit, row.program, row.missingDeadline,
            row.gocLastQueryAt, row.processType, row.transactionCount
        ));
    }

    if (final) {
        statements.push(environment.DB.prepare(`
            UPDATE yoksis_audit_imports
            SET finalized_at = COALESCE(finalized_at, ?),
                row_count = (
                    SELECT COUNT(*) FROM yoksis_document_audit_records
                    WHERE last_seen_import_id = ?
                )
            WHERE id = ?
        `).bind(nowIso, importId, importId));
    }

    try {
        await environment.DB.batch(statements);
    } catch (error) {
        console.error('YÖKSİS Excel aktarımı başarısız.', {
            requestId,
            errorName: error?.name || 'UnknownError',
            failureKind: classifyWriteFailure(error),
            failureCode: readWriteFailureCode(error),
            failureDetail: readWriteFailureDetail(error),
            recordCount: validRows.length
        });
        throw error;
    }

    return jsonResponse({ storedCount: validRows.length, rejected }, 200, requestId);
}

async function readLatestImport(request, environment, requestId) {
    requireMethod(request, 'GET');
    const latest = await environment.DB.prepare(`
        SELECT
            imports.id AS import_id,
            imports.uploaded_at,
            imports.exported_at,
            imports.row_count,
            staff.display_name AS uploaded_by
        FROM yoksis_audit_imports AS imports
        JOIN staff_users AS staff ON staff.id = imports.uploaded_by_staff_id
        WHERE imports.finalized_at IS NOT NULL
        ORDER BY imports.finalized_at DESC, imports.rowid DESC
        LIMIT 1
    `).first();
    if (!latest) {
        return new Response('null', {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Request-Id': requestId
            }
        });
    }
    return jsonResponse({
        importId: latest.import_id,
        uploadedAt: latest.uploaded_at,
        uploadedBy: latest.uploaded_by,
        rowCount: Number(latest.row_count || 0),
        exportedAt: latest.exported_at ?? null
    }, 200, requestId);
}

function readQuery(body) {
    if (!body || Object.keys(body).some((key) => !['q', 'status', 'match', 'page', 'pageSize'].includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edin.');
    }
    const query = body.q === undefined ? '' : readAuditText(body.q, 'Arama metni', MAX_SEARCH_LENGTH, { optional: true });
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

function formatAuditRecord(row, latestImportId) {
    const {
        documents_json: documentsJson,
        source,
        last_seen_import_id: lastSeenImportId,
        unit,
        program,
        missing_deadline: missingDeadline,
        goc_last_query_at: gocLastQueryAt,
        last_transaction_type: lastTransactionType,
        transaction_count: transactionCount,
        ...record
    } = row;
    const formatted = {
        ...record,
        documents: JSON.parse(documentsJson)
    };
    if (source === 'excel') {
        formatted.import = {
            unit: unit || '',
            program: program || '',
            missingDeadline: missingDeadline ?? null,
            lastTransactionType: lastTransactionType || '',
            transactionCount: Number(transactionCount || 1),
            gocLastQueryAt: gocLastQueryAt ?? null,
            isStale: latestImportId !== null && lastSeenImportId !== latestImportId
        };
    }
    return formatted;
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
    const latestImport = await environment.DB.prepare(`
        SELECT id FROM yoksis_audit_imports
        WHERE finalized_at IS NOT NULL
        ORDER BY finalized_at DESC, rowid DESC
        LIMIT 1
    `).first();
    const latestImportId = latestImport?.id || null;

    if (match !== 'all') {
        // Name and student-number matching is computed here, so filtered pages are counted after matching.
        const candidates = (await environment.DB.prepare(`
            SELECT application_number, student_number, first_name, last_name, passport_number,
                   phone, application_status, status_category, result_status, documents_json, scanned_at,
                   source, last_seen_import_id, unit, program, missing_deadline, goc_last_query_at,
                   last_transaction_type, transaction_count
            FROM yoksis_document_audit_records
            WHERE 1 = 1 ${statusClause} ${searchClause}
            ORDER BY scanned_at DESC, application_number
        `).bind(...bindings).all()).results || [];
        const keys = await loadOnlineApplicationKeys(environment);
        const matched = candidates.filter((record) => {
            const isMatched = matchesOnlineApplication(record, keys);
            return match === 'matched' ? isMatched : !isMatched;
        });
        const records = matched
            .slice((page - 1) * pageSize, page * pageSize)
            .map((row) => formatAuditRecord(row, latestImportId));
        return jsonResponse({ records, total: matched.length, page, pageSize }, 200, requestId);
    }
    const count = await environment.DB.prepare(`
        SELECT COUNT(*) AS total FROM yoksis_document_audit_records
        WHERE 1 = 1 ${statusClause} ${searchClause}
    `).bind(...bindings).first();
    const result = await environment.DB.prepare(`
        SELECT application_number, student_number, first_name, last_name, passport_number,
               phone, application_status, status_category, result_status, documents_json, scanned_at,
               source, last_seen_import_id, unit, program, missing_deadline, goc_last_query_at,
               last_transaction_type, transaction_count
        FROM yoksis_document_audit_records
        WHERE 1 = 1 ${statusClause} ${searchClause}
        ORDER BY scanned_at DESC, application_number
        LIMIT ? OFFSET ?
    `).bind(...bindings, pageSize, (page - 1) * pageSize).all();
    const records = (result.results || []).map((row) => formatAuditRecord(row, latestImportId));
    return jsonResponse({ records, total: count?.total || 0, page, pageSize }, 200, requestId);
}

/**
 * Routes authenticated staff YÖKSİS document audit requests (scan writes, Excel imports, latest import, and query).
 * @param {Request} request Incoming Worker request.
 * @param {object} environment Worker bindings containing D1 `DB`.
 * @param {string} requestId Correlation ID for response and diagnostics.
 * @returns {Promise<Response>} JSON response.
 */
export async function handleStaffYoksisDocumentAudit(request, environment, requestId) {
    const staff = await requireStaff(request, environment);
    const { pathname } = new URL(request.url);
    if (pathname === '/api/staff/yoksis-document-audit/records') return writeRecords(request, environment, requestId, staff);
    if (pathname === '/api/staff/yoksis-document-audit/query') return readRecords(request, environment, requestId);
    if (pathname === '/api/staff/yoksis-document-audit/import') return importExcelRows(request, environment, requestId, staff);
    if (pathname === '/api/staff/yoksis-document-audit/import/latest') return readLatestImport(request, environment, requestId);
    throw new ApiError(404, 'NOT_FOUND', 'İstenen kayıt bulunamadı.');
}
