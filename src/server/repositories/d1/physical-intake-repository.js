const INTAKE_COLUMNS = `id,student_number,first_name,last_name,passport_number,
    CASE WHEN application_route='transition' THEN 'transition' ELSE application_type END AS application_type,
    application_route,status,
    linked_application_id,current_pdf_id,submitted_at,updated_at,lock_version,deleted_at,rejection_reason,legacy_status,tracking_reference,application_date,metadata_version,registration_body_hash,
    processing_closed_at,processing_closed_by_staff_id,processing_closure_reason,
    (SELECT state FROM physical_intake_receipts WHERE intake_id=physical_intakes.id ORDER BY document_version DESC LIMIT 1) AS receipt_state,
    (SELECT metadata_version FROM physical_intake_receipts WHERE intake_id=physical_intakes.id ORDER BY document_version DESC LIMIT 1) AS receipt_metadata_version,
    (SELECT status FROM physical_receipt_print_attempts WHERE intake_id=physical_intakes.id ORDER BY created_at DESC,id DESC LIMIT 1) AS receipt_print_status`;

function buildWhere(query) {
    const clauses = [query.isDeleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const bindings = [];
    if (query.statuses) {
        clauses.push(`status IN (${query.statuses.map(() => '?').join(',')})`);
        bindings.push(...query.statuses);
    }
    if (query.q) {
        clauses.push(`(student_number LIKE ? ESCAPE '\\' OR first_name LIKE ? ESCAPE '\\'
            OR last_name LIKE ? ESCAPE '\\' OR tracking_reference LIKE ? ESCAPE '\\' OR passport_number LIKE ? ESCAPE '\\')`);
        const term = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
        bindings.push(term, term, term, term, term);
    }
    const deliveryDate = "coalesce(nullif(application_date, ''), substr(submitted_at, 1, 10))";
    if (query.fromDate) {
        clauses.push(`${deliveryDate} >= ?`);
        bindings.push(query.fromDate);
    }
    if (query.toDate) {
        clauses.push(`${deliveryDate} <= ?`);
        bindings.push(query.toDate);
    }
    return { sql: clauses.join(' AND '), bindings };
}

async function listIntakes(database, query) {
    const where = buildWhere(query);
    const results = await database.batch([
        database.prepare(`SELECT ${INTAKE_COLUMNS} FROM physical_intakes WHERE ${where.sql}
            ORDER BY updated_at DESC,submitted_at DESC,id DESC LIMIT ? OFFSET ?`)
            .bind(...where.bindings, query.pageSize, (query.page - 1) * query.pageSize),
        database.prepare(`SELECT count(*) AS total FROM physical_intakes WHERE ${where.sql}`).bind(...where.bindings)
    ]);
    return { items: results[0].results, pagination: { page: query.page, page_size: query.pageSize,
        total: results[1].results[0].total, total_pages: Math.ceil(results[1].results[0].total / query.pageSize) } };
}

async function updateIntake(database, input) {
    const assignment = input.action === 'status' ? 'status=?,rejection_reason=?,legacy_status=NULL' : 'deleted_at=?';
    const values = input.action === 'status' ? [input.value, input.reason || ''] : [input.value];
    const result = await database.batch([
        database.prepare(`UPDATE physical_intakes SET ${assignment},lock_version=lock_version+1,updated_at=?
            WHERE id=? AND lock_version=? ${input.action === 'status' ? "AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'" : ''} AND ${input.action === 'restore' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}`)
            .bind(...values, input.now, input.id, input.version),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            SELECT ?,?,'staff',?,?,?,? WHERE changes()=1`)
            .bind(crypto.randomUUID(), `physical_intake.${input.action}`, input.staffId,
                input.requestId, JSON.stringify({ physicalIntakeId: input.id, ...(input.action === 'status' ? { status: input.value } : {}) }), input.now)
    ]);
    return result[0].meta.changes === 1;
}

async function reserveFile(database, input) {
    return database.prepare(`INSERT INTO physical_intake_files
        (id,intake_id,revision_number,storage_key,original_filename,byte_size,sha256,upload_status,uploaded_at,created_by_staff_id)
        SELECT ?,id,(SELECT coalesce(max(revision_number),0)+1 FROM physical_intake_files WHERE intake_id=?),
            ?,?,?,?,'uploading',?,? FROM physical_intakes
        WHERE id=? AND lock_version=? AND deleted_at IS NULL AND status IN ('under_review','approved_for_processing') AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed' RETURNING *`)
        .bind(input.fileId, input.id, input.storageKey, input.filename, input.byteSize, input.sha256,
            input.now, input.staffId, input.id, input.version).first();
}

async function finalizeFile(database, input) {
    const result = await database.batch([
        database.prepare(`UPDATE physical_intakes SET current_pdf_id=?,lock_version=lock_version+1,updated_at=?
            WHERE id=? AND lock_version=? AND deleted_at IS NULL AND status IN ('under_review','approved_for_processing') AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
              AND EXISTS(SELECT 1 FROM physical_intake_files WHERE id=? AND intake_id=physical_intakes.id AND upload_status='uploading')`)
            .bind(input.fileId, input.now, input.id, input.version, input.fileId),
        database.prepare(`UPDATE physical_intake_files SET upload_status='finalized' WHERE id=? AND changes()=1`).bind(input.fileId),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'physical_intake.pdf_saved','staff',?,?,?,? WHERE changes()=1`)
            .bind(crypto.randomUUID(), input.staffId, input.requestId,
                JSON.stringify({ physicalIntakeId: input.id, fileId: input.fileId }), input.now)
    ]);
    return result[0].meta.changes === 1;
}

async function removeCurrentPdf(database, input) {
    const result = await database.batch([
        database.prepare(`UPDATE physical_intakes SET current_pdf_id=NULL,lock_version=lock_version+1,updated_at=?
            WHERE id=? AND lock_version=? AND current_pdf_id=? AND deleted_at IS NULL AND status IN ('under_review','approved_for_processing') AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'`)
            .bind(input.now, input.id, input.version, input.fileId),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'physical_intake.pdf_removed','staff',?,?,?,? WHERE changes()=1`)
            .bind(crypto.randomUUID(), input.staffId, input.requestId,
                JSON.stringify({ physicalIntakeId: input.id, fileId: input.fileId }), input.now)
    ]);
    return result[0].meta.changes === 1;
}

/** Creates staff-only physical receipt persistence. @param {D1Database} database D1 binding. @returns {object} Repository operations. */
export function createPhysicalIntakeRepository(database) {
    return Object.freeze({
        list: query => listIntakes(database, query),
        find: id => database.prepare(`SELECT ${INTAKE_COLUMNS} FROM physical_intakes WHERE id=?`).bind(id).first(),
        lookup: (studentNumber, applicationType) => database.prepare(`SELECT applications.id,applications.first_name,
            applications.last_name,applications.passport_number,
            CASE WHEN applications.application_route='transition' THEN 'transition' ELSE applications.application_type END AS application_type,
            applications.application_route,applications.status
            FROM applications JOIN students ON students.id=applications.student_id
            WHERE upper(trim(students.student_number))=?
              AND applications.application_type=? AND applications.application_route=?
              AND applications.status NOT IN ('draft','completed','cancelled','rejected')
              AND NOT EXISTS(SELECT 1 FROM application_deletions WHERE application_id=applications.id)
            ORDER BY applications.updated_at DESC LIMIT 1`).bind(studentNumber,
                applicationType === 'transition' ? 'renewal' : applicationType,
                applicationType === 'transition' ? 'transition' : 'standard').first(),
        findLinked: id => database.prepare(`SELECT applications.id,students.student_number,
            applications.application_type,applications.application_route
            FROM applications JOIN students ON students.id=applications.student_id WHERE applications.id=?`).bind(id).first(),
        update: input => updateIntake(database, input),
        receipts: id => database.prepare('SELECT * FROM physical_intake_receipts WHERE intake_id=? ORDER BY document_version DESC').bind(id).all(),
        files: id => database.prepare(`SELECT id,revision_number,original_filename,byte_size,scan_status,upload_status,uploaded_at
            FROM physical_intake_files WHERE intake_id=? AND upload_status='finalized' ORDER BY revision_number DESC`).bind(id).all(),
        file: id => database.prepare('SELECT * FROM physical_intake_files WHERE id=?').bind(id).first(),
        reserveFile: input => reserveFile(database, input),
        finalizeFile: input => finalizeFile(database, input),
        removeCurrentPdf: input => removeCurrentPdf(database, input),
        failFile: id => database.prepare("UPDATE physical_intake_files SET upload_status='failed' WHERE id=? AND upload_status='uploading'").bind(id).run()
    });
}
