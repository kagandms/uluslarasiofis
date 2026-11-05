const NEXT_STATES = Object.freeze({
    prepared: new Set(['querying', 'stopped', 'failed']),
    querying: new Set(['saving', 'existing_record', 'stopped', 'failed', 'outcome_unknown']),
    saving: new Set(['uploading', 'existing_record', 'failed', 'outcome_unknown']),
    uploading: new Set(['uploaded_for_review', 'failed', 'outcome_unknown'])
});

function conflict(code, message) {
    return Object.assign(new Error(message), { code });
}

/** Creates the D1 repository for technical GöçNet transfer attempts. */
export function createApplicationGocnetRepository(database) {
    return Object.freeze({
        async createAttempt({ id, applicationId, staffId, applicationNumberHash, manifestFingerprint, pdfSha256, createdAt }) {
            try {
                await database.prepare(`INSERT INTO application_gocnet_attempts (
                    id, application_id, actor_staff_id, application_number_hash, manifest_fingerprint, pdf_sha256,
                    state, last_event_sequence, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'prepared', 0, ?, ?)`)
                    .bind(id, applicationId, staffId, applicationNumberHash, manifestFingerprint, pdfSha256, createdAt, createdAt).run();
            } catch (error) {
                if (/unique constraint failed: application_gocnet_attempts\.(?:application_id|application_number_hash)/i.test(String(error?.message))) {
                    throw conflict('GOCNET_ATTEMPT_CONFLICT', 'Bu başvuru veya kayıt numarası için etkin bir aktarım bulunuyor.');
                }
                throw error;
            }
            return database.prepare('SELECT * FROM application_gocnet_attempts WHERE id = ?').bind(id).first();
        },
        async appendEvent({ attemptId, applicationId, eventId, actorStaffId, sequence, state, remoteRecordId = null, createdAt }) {
            const duplicate = await database.prepare(`SELECT sequence, state, remote_record_id FROM application_gocnet_attempt_events
                WHERE attempt_id = ? AND id = ?`).bind(attemptId, eventId).first();
            if (duplicate) {
                if (duplicate.sequence === sequence && duplicate.state === state && (duplicate.remote_record_id ?? null) === remoteRecordId) {
                    return database.prepare('SELECT * FROM application_gocnet_attempts WHERE id = ?').bind(attemptId).first();
                }
                throw conflict('GOCNET_EVENT_CONFLICT', 'Aktarım aşaması doğrulanamadı.');
            }
            const attempt = await database.prepare(`SELECT * FROM application_gocnet_attempts
                WHERE id = ? AND application_id = ?`).bind(attemptId, applicationId).first();
            if (!attempt || sequence !== attempt.last_event_sequence + 1 || !NEXT_STATES[attempt.state]?.has(state)) {
                throw conflict('GOCNET_EVENT_CONFLICT', 'Aktarım aşaması doğrulanamadı.');
            }
            const statements = [
                database.prepare(`UPDATE application_gocnet_attempts
                    SET state = ?, last_event_sequence = ?, updated_at = ?, remote_record_id = COALESCE(?, remote_record_id)
                    WHERE id = ? AND application_id = ? AND state = ? AND last_event_sequence = ?`)
                    .bind(state, sequence, createdAt, remoteRecordId, attemptId, applicationId, attempt.state, attempt.last_event_sequence),
                database.prepare(`INSERT INTO application_gocnet_attempt_events (id, attempt_id, actor_staff_id, sequence, state, remote_record_id, created_at)
                    SELECT ?, id, ?, ?, ?, ?, ? FROM application_gocnet_attempts
                    WHERE id = ? AND application_id = ? AND state = ? AND last_event_sequence = ?`)
                    .bind(eventId, actorStaffId, sequence, state, remoteRecordId, createdAt, attemptId, applicationId, state, sequence)
            ];
            const results = await database.batch(statements);
            if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
                throw conflict('GOCNET_EVENT_CONFLICT', 'Aktarım aşaması doğrulanamadı.');
            }
            return database.prepare('SELECT * FROM application_gocnet_attempts WHERE id = ?').bind(attemptId).first();
        },
        findAttempt(attemptId, applicationId) {
            return database.prepare('SELECT * FROM application_gocnet_attempts WHERE id = ? AND application_id = ?')
                .bind(attemptId, applicationId).first();
        },
        findEvent(attemptId, eventId) {
            return database.prepare(`SELECT sequence, state, remote_record_id FROM application_gocnet_attempt_events
                WHERE attempt_id = ? AND id = ?`).bind(attemptId, eventId).first();
        }
    });
}
