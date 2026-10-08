function createIntakeStatement(database, input) {
    const receipt = input.receipt;
    return database.prepare(`INSERT INTO physical_intakes
        (id,student_number,first_name,last_name,passport_number,application_type,linked_application_id,
        submitted_at,updated_at,created_by_staff_id,status) VALUES(?,?,?,?,?,?,?,?,?,?,'under_review')`)
        .bind(input.id, receipt.student_number, receipt.first_name, receipt.last_name, receipt.passport_number,
            receipt.application_type, receipt.linked_application_id, input.now, input.now, input.staffId);
}

/** Commits a receipt and its first finalized PDF in one D1 transaction.
 * @param {D1Database} database Binding. @param {object} input Validated receipt and stored PDF.
 * @returns {Promise<void>} Durable registration. @throws {Error} Database conflict; transaction rolls back.
 */
export async function registerPhysicalIntake(database, input) {
    await database.batch([
        createIntakeStatement(database, input),
        database.prepare(`INSERT INTO physical_intake_files
            (id,intake_id,revision_number,storage_key,original_filename,byte_size,sha256,upload_status,uploaded_at,created_by_staff_id)
            VALUES(?,?,1,?,?,?,?,'finalized',?,?)`).bind(input.id, input.id, input.storageKey,
                `ikamet_${input.receipt.passport_number}.pdf`, input.byteSize, input.sha256, input.now, input.staffId),
        database.prepare('UPDATE physical_intakes SET current_pdf_id=? WHERE id=?').bind(input.id, input.id),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            VALUES(?,'physical_intake.registered','staff',?,?,?,?)`).bind(crypto.randomUUID(), input.staffId,
                input.requestId, JSON.stringify({ physicalIntakeId: input.id, fileId: input.id }), input.now)
    ]);
}
