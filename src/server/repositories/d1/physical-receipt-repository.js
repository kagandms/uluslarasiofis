import { RECEIPT_RETENTION_MS, RECEIPT_TEMPLATE_VERSION, buildReceiptSnapshot } from '../../domain/physical-tracking-policy.js';

function buildAudit(database, input) {
    return database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
        SELECT ?,?,'staff',?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), input.eventType, input.staffId,
            input.requestId, JSON.stringify({ physicalIntakeId: input.intakeId, receiptId: input.receiptId || null }), input.now);
}

function buildReceiptInsert(database, input) {
    return database.prepare(`INSERT INTO physical_intake_receipts
        (id,intake_id,document_version,creation_id,snapshot_json,template_version,metadata_version,created_at,expires_at)
        SELECT ?,id,(SELECT coalesce(max(document_version),0)+1 FROM physical_intake_receipts WHERE intake_id=?),
        ?,?,?,metadata_version,?,? FROM physical_intakes WHERE id=? AND deleted_at IS NULL
        AND metadata_version=? AND lock_version=? ON CONFLICT(creation_id) DO NOTHING`).bind(input.receiptId, input.intake.id,
            input.creationId, JSON.stringify(buildReceiptSnapshot(input.intake, input.portalOrigin, input.now)), RECEIPT_TEMPLATE_VERSION,
            input.now, new Date(Date.parse(input.now) + RECEIPT_RETENTION_MS).toISOString(), input.intake.id, input.intake.metadata_version, input.intake.lock_version);
}

async function registerReceipt(database, input) {
    const metadata = input.metadata;
    const intake = { ...metadata, id: input.id, tracking_reference: input.reservation.tracking_reference, metadata_version: 1, lock_version: 1 };
    const receiptInput = { ...input, intake, intakeId: input.id, eventType: 'physical_intake.registered' };
    await database.batch([
        database.prepare(`INSERT INTO physical_intakes
            (id,student_number,first_name,last_name,passport_number,application_type,application_route,submitted_at,updated_at,created_by_staff_id,
            status,tracking_reference,application_date,registration_body_hash)
            SELECT ?,?,?,?,?,?,?,?,?,?,'under_review',tracking_reference,?,? FROM physical_reference_reservations
            WHERE id=? AND staff_id=? AND session_hash=? AND consumed_intake_id IS NULL AND expires_at>?
            AND substr(application_date,1,4)=?`).bind(input.id, metadata.student_number, metadata.first_name, metadata.last_name,
                metadata.passport_number, metadata.application_type, metadata.application_route, input.now, input.now, input.staffId, metadata.application_date,
                input.bodyHash, input.reservation.id, input.staffId, input.sessionHash, input.now, metadata.application_date.slice(0,4)),
        buildReceiptInsert(database, receiptInput),
        database.prepare(`UPDATE physical_reference_reservations SET consumed_intake_id=? WHERE id=? AND consumed_intake_id IS NULL
            AND EXISTS(SELECT 1 FROM physical_intakes WHERE id=? AND registration_body_hash=?)`)
            .bind(input.id, input.reservation.id, input.id, input.bodyHash),
        buildAudit(database, receiptInput)
    ]);
    return database.prepare('SELECT * FROM physical_intakes WHERE id=?').bind(input.id).first();
}

async function mutateMetadata(database, input) {
    const metadata = input.metadata;
    const result = await database.batch([
        database.prepare(`UPDATE physical_intakes SET first_name=?,last_name=?,passport_number=?,student_number=?,application_type=?,application_route=?,
            application_date=?,metadata_version=metadata_version+CASE WHEN first_name<>? OR last_name<>? OR passport_number<>?
            OR application_type<>? OR application_route<>?
            OR application_date IS NOT ? THEN 1 ELSE 0 END,lock_version=lock_version+1,updated_at=?
            WHERE id=? AND lock_version=? AND deleted_at IS NULL AND status<>'completed' AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'`)
            .bind(metadata.first_name, metadata.last_name, metadata.passport_number, metadata.student_number, metadata.application_type,
                metadata.application_route, metadata.application_date, metadata.first_name, metadata.last_name, metadata.passport_number,
                metadata.application_type, metadata.application_route, metadata.application_date,
                input.now, input.intakeId, input.version),
        buildAudit(database, { ...input, eventType: 'physical_intake.metadata_updated' })
    ]);
    return result[0].meta.changes === 1;
}

async function closeProcessing(database, input) {
    const result = await database.batch([
        database.prepare(`UPDATE physical_intakes SET processing_closed_at=?,processing_closed_by_staff_id=?,processing_closure_reason=?,
            lock_version=lock_version+1,updated_at=?${input.isReopening ? ",legacy_status=CASE WHEN legacy_status='completed' THEN NULL ELSE legacy_status END" : ""} WHERE id=? AND lock_version=? AND deleted_at IS NULL
            AND ${input.isReopening ? "(processing_closed_at IS NOT NULL OR legacy_status='completed')" : "processing_closed_at IS NULL"}`)
            .bind(input.isReopening ? null : input.now, input.isReopening ? null : input.staffId,
                input.isReopening ? null : input.reason, input.now, input.intakeId, input.version),
        buildAudit(database, { ...input, eventType: input.isReopening ? 'physical_intake.reopened' : 'physical_intake.closed' })
    ]);
    return result[0].meta.changes === 1;
}

/** Staff receipt persistence. @param {D1Database} database Binding. @returns {object} Operations. @throws {Error} Invalid binding or database writes. */
export function createPhysicalReceiptRepository(database) {
    return Object.freeze({
        ...createReservationOperations(database),
        register: input => registerReceipt(database, input),
        receipt: id => database.prepare('SELECT * FROM physical_intake_receipts WHERE id=?').bind(id).first(),
        byCreation: id => database.prepare('SELECT * FROM physical_intake_receipts WHERE creation_id=?').bind(id).first(),
        receipts: id => database.prepare('SELECT * FROM physical_intake_receipts WHERE intake_id=? ORDER BY document_version DESC').bind(id).all(),
        async createReceipt(input) {
            await database.batch([buildReceiptInsert(database, input), buildAudit(database, { ...input, intakeId: input.intake.id, eventType: 'physical_receipt.created' })]);
            return database.prepare('SELECT * FROM physical_intake_receipts WHERE creation_id=?').bind(input.creationId).first();
        },
        bindContent: input => database.prepare(`UPDATE physical_intake_receipts SET state='ready',artefact_key=?,sha256=?,byte_size=?
            WHERE id=? AND state='awaiting_content' AND EXISTS(SELECT 1 FROM physical_intakes
            WHERE id=physical_intake_receipts.intake_id AND deleted_at IS NULL AND metadata_version=physical_intake_receipts.metadata_version)`)
            .bind(input.key, input.sha256, input.byteSize, input.id).run(),
        mutateMetadata: input => mutateMetadata(database, input),
        closeProcessing: input => closeProcessing(database, input),
        duplicates: input => database.prepare(`SELECT id,first_name,last_name,tracking_reference,application_date FROM physical_intakes
            WHERE deleted_at IS NULL AND status NOT IN ('rejected','completed') AND processing_closed_at IS NULL AND coalesce(legacy_status,'')<>'completed'
            AND upper(trim(passport_number))=? AND application_type=? AND application_route=? ORDER BY submitted_at DESC`)
            .bind(input.passport_number, input.application_type, input.application_route ?? 'standard').all(),
        attempts: id => database.prepare(`SELECT * FROM physical_receipt_print_attempts WHERE intake_id=? ORDER BY created_at DESC,id DESC`).bind(id).all(),
        attempt: id => database.prepare('SELECT * FROM physical_receipt_print_attempts WHERE id=?').bind(id).first()
    });
}

function createReservationOperations(database) {
    return {
        reservation: id => database.prepare('SELECT * FROM physical_reference_reservations WHERE id=?').bind(id).first(),
        draftReservation: input => database.prepare('SELECT * FROM physical_reference_reservations WHERE draft_id=? AND session_hash=?')
            .bind(input.draftId, input.sessionHash).first(),
        reserve: input => database.prepare(`INSERT INTO physical_reference_reservations
            (id,draft_id,tracking_reference,staff_id,session_hash,application_date,expires_at,created_at)
            SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM physical_reference_reservations
            WHERE session_hash=? AND consumed_intake_id IS NULL AND expires_at>?)<5
            ON CONFLICT(draft_id,session_hash) DO NOTHING RETURNING *`)
            .bind(input.id, input.draftId, input.reference, input.staffId, input.sessionHash, input.day, input.expiresAt,
                input.now, input.sessionHash, input.now).first(),
        retireDraft: input => database.prepare(`UPDATE physical_reference_reservations SET draft_id=id,expires_at=?
            WHERE draft_id=? AND session_hash=? AND id=? AND consumed_intake_id IS NULL`).bind(input.now, input.draftId, input.sessionHash, input.expectedId).run(),
    };
}
