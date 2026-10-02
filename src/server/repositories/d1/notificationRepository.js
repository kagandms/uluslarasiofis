/** Signals reuse of an idempotency key for a different notification payload. */
export class NotificationIdempotencyConflictError extends Error {
    constructor() {
        super('The idempotency key is already bound to another notification payload.');
        this.name = 'NotificationIdempotencyConflictError';
        this.code = 'NOTIFICATION_IDEMPOTENCY_CONFLICT';
    }
}

function mapNotification(row) {
    if (!row) return null;
    return {
        id: row.id,
        application_id: row.application_id,
        channel: row.channel,
        template_key: row.template_key,
        language: row.language,
        recipient_masked: row.recipient_masked,
        status: row.status,
        provider_status: row.provider_status,
        attempt_count: row.attempt_count,
        last_error_code: row.last_error_code,
        created_at: row.created_at,
        sent_at: row.sent_at,
        delivered_at: row.delivered_at,
        read_at: row.read_at,
        can_retry: row.outbox_status === 'retry' && row.attempt_count < 5
            && ['provider_transient_failure', 'provider_rate_limited'].includes(row.outbox_error_code)
            && row.provider_status === 'not_sent'
    };
}

function readQueryRows(result) {
    return result?.results || [];
}

async function readIdempotentNotification(database, scope, key) {
    const row = await database.prepare(`
        SELECT n.*, i.request_fingerprint
        FROM idempotency_records i
        JOIN notifications n ON n.id = i.resource_id
        WHERE i.scope = ? AND i.idempotency_key = ?
    `).bind(scope, key).first();
    return row || null;
}

function makeAuditStatement(database, event) {
    return database.prepare(`
        INSERT INTO audit_events (
            id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
        ) VALUES (?, ?, 'staff', ?, ?, ?, ?)
    `).bind(event.id, event.eventType, event.staffUserId, event.applicationId,
        event.requestId, JSON.stringify(event.metadata));
}

async function enqueueOnce(database, input) {
    const expiresAt = new Date(Date.parse(input.createdAt) + 365 * 24 * 60 * 60 * 1000).toISOString();
    await database.batch([
        database.prepare(`
            INSERT INTO idempotency_records (
                scope, idempotency_key, request_fingerprint, resource_id, response_status, expires_at
            ) VALUES (?, ?, ?, ?, 202, ?)
        `).bind(input.idempotencyScope, input.idempotencyKey, input.fingerprint, input.notificationId, expiresAt),
        database.prepare(`
            INSERT INTO notifications (
                id, application_id, created_by_staff_id, channel, template_key, language,
                recipient_masked, is_manual, rendered_message, provider_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'not_sent')
        `).bind(input.notificationId, input.applicationId, input.staffUserId, input.channel,
            input.templateKey, input.language, input.recipientMasked, input.renderedMessage),
        database.prepare(`
            INSERT INTO notification_outbox (id, notification_id, idempotency_key, status, next_attempt_at)
            VALUES (?, ?, ?, 'pending', ?)
        `).bind(input.outboxId, input.notificationId, input.outboxId, input.createdAt),
        database.prepare(`
            UPDATE idempotency_records SET resource_id = ? WHERE scope = ? AND idempotency_key = ?
        `).bind(input.notificationId, input.idempotencyScope, input.idempotencyKey),
        makeAuditStatement(database, {
            id: input.auditEventId,
            eventType: 'staff.notification_enqueued',
            staffUserId: input.staffUserId,
            applicationId: input.applicationId,
            requestId: input.requestId,
            metadata: { channel: input.channel, templateKey: input.templateKey,
                language: input.language, result: 'queued' }
        })
    ]);
    return mapNotification(await database.prepare('SELECT * FROM notifications WHERE id = ?')
        .bind(input.notificationId).first());
}

async function enqueueManualNotification(database, input) {
    const existing = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
    if (existing) {
        if (existing.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
        return { notification: mapNotification(existing), isExisting: true };
    }
    try {
        return { notification: await enqueueOnce(database, input), isExisting: false };
    } catch (error) {
        const concurrent = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
        if (!concurrent) throw error;
        if (concurrent.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
        return { notification: mapNotification(concurrent), isExisting: true };
    }
}

/** Creates D1 persistence for consent, manual notifications, and durable outbox dispatch. */
export function createNotificationRepository(database) {
    return Object.freeze({
        async readApplicationContext(applicationId) {
            return database.prepare(`
                SELECT a.id, a.status, a.student_phone, a.student_email
                FROM applications a WHERE a.id = ?
            `).bind(applicationId).first();
        },
        async readPreferences(applicationId) {
            const row = await database.prepare(`
                SELECT whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_consent_version,
                    whatsapp_consent_language, whatsapp_phone_hash, whatsapp_opt_out_at
                FROM notification_preferences WHERE application_id = ?
            `).bind(applicationId).first();
            return row ? {
                whatsapp_opt_in: row.whatsapp_opt_in === 1,
                whatsapp_opt_in_at: row.whatsapp_opt_in_at,
                whatsapp_consent_version: row.whatsapp_consent_version,
                whatsapp_consent_language: row.whatsapp_consent_language,
                whatsapp_phone_hash: row.whatsapp_phone_hash,
                whatsapp_opt_out_at: row.whatsapp_opt_out_at
            } : {
                whatsapp_opt_in: false, whatsapp_opt_in_at: null, whatsapp_consent_version: null,
                whatsapp_consent_language: null, whatsapp_phone_hash: null, whatsapp_opt_out_at: null
            };
        },
        async updateApplicantPreferences(input) {
            await database.batch([
                database.prepare(`
                    INSERT INTO notification_preferences (
                        application_id, whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_consent_version,
                        whatsapp_consent_language, whatsapp_phone_hash, whatsapp_opt_out_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(application_id) DO UPDATE SET
                        whatsapp_opt_in = excluded.whatsapp_opt_in,
                        whatsapp_opt_in_at = excluded.whatsapp_opt_in_at,
                        whatsapp_consent_version = excluded.whatsapp_consent_version,
                        whatsapp_consent_language = excluded.whatsapp_consent_language,
                        whatsapp_phone_hash = excluded.whatsapp_phone_hash,
                        whatsapp_opt_out_at = excluded.whatsapp_opt_out_at,
                        updated_at = excluded.updated_at
                `).bind(input.applicationId, input.isOptedIn ? 1 : 0, input.optedInAt,
                    input.consentVersion, input.language, input.phoneHash, input.optedOutAt, input.updatedAt),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) VALUES (?, 'applicant.notification_preferences_updated', 'student', ?, ?, ?)
                `).bind(input.auditEventId, input.applicationId, input.requestId,
                    JSON.stringify({ channel: 'whatsapp', optedIn: input.isOptedIn,
                        consentVersion: input.consentVersion, language: input.language }))
            ]);
            return this.readPreferences(input.applicationId);
        },
        async writeStaffPreviewAudit(input) {
            await database.batch([makeAuditStatement(database, {
                id: input.auditEventId, eventType: 'staff.notification_previewed',
                staffUserId: input.staffUserId, applicationId: input.applicationId,
                requestId: input.requestId,
                metadata: { channel: input.channel, templateKey: input.templateKey,
                    language: input.language, result: input.result }
            })]);
        },
        async enqueueManualNotification(input) {
            return enqueueManualNotification(database, input);
        },
        async readIdempotentNotification(input) {
            const existing = await readIdempotentNotification(database, input.idempotencyScope, input.idempotencyKey);
            if (!existing) return null;
            if (existing.request_fingerprint !== input.fingerprint) throw new NotificationIdempotencyConflictError();
            return mapNotification(existing);
        },
        async listHistory(applicationId, limit = 50) {
            const rows = await database.prepare(`
                SELECT id, application_id, channel, template_key, language, recipient_masked,
                    status, provider_status, attempt_count, last_error_code, created_at,
                    sent_at, delivered_at, read_at,
                    (SELECT o.status FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_status,
                    (SELECT o.last_error_code FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_error_code
                FROM notifications WHERE application_id = ? ORDER BY created_at DESC LIMIT ?
            `).bind(applicationId, limit).all();
            return readQueryRows(rows).map(mapNotification);
        },
        async findHistoryItem(applicationId, notificationId) {
            return database.prepare(`
                SELECT id, application_id, channel, template_key, language, recipient_masked,
                    status, provider_status, attempt_count, last_error_code, created_at,
                    sent_at, delivered_at, read_at,
                    (SELECT o.status FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_status,
                    (SELECT o.last_error_code FROM notification_outbox o WHERE o.notification_id = notifications.id) AS outbox_error_code
                FROM notifications WHERE application_id = ? AND id = ?
            `).bind(applicationId, notificationId).first();
        },
        async expediteRetry(input) {
            const results = await database.batch([database.prepare(`
                UPDATE notification_outbox
                SET next_attempt_at = ?, updated_at = ?
                WHERE notification_id = ? AND status = 'retry' AND attempt_count < ?
                    AND last_error_code IN ('provider_transient_failure', 'provider_rate_limited')
                    AND EXISTS (
                        SELECT 1 FROM notifications n WHERE n.id = notification_outbox.notification_id
                            AND n.application_id = ? AND n.provider_status = 'not_sent'
                    )
            `).bind(input.now, input.now, input.notificationId, input.maxAttempts, input.applicationId), database.prepare(`
                INSERT INTO audit_events (
                    id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
                ) SELECT ?, 'staff.notification_retry_requested', 'staff', ?, ?, ?, ?
                WHERE changes() = 1
            `).bind(input.auditEventId, input.staffUserId, input.applicationId, input.requestId,
                JSON.stringify({ notificationId: input.notificationId, result: 'retry_scheduled' }))]);
            return results[0]?.meta?.changes === 1;
        },
        async claimNextOutbox(input) {
            const result = await database.prepare(`
                UPDATE notification_outbox
                SET status = 'processing', attempt_count = attempt_count + 1,
                    locked_at = ?, lease_token = ?, dispatch_started_at = NULL, updated_at = ?
                WHERE id = (
                    SELECT id FROM notification_outbox
                    WHERE (status IN ('pending', 'retry') AND next_attempt_at <= ?)
                        OR (status = 'processing' AND locked_at <= ? AND dispatch_started_at IS NULL)
                    ORDER BY next_attempt_at, created_at LIMIT 1
                )
                RETURNING id, notification_id, attempt_count, lease_token
            `).bind(input.now, input.leaseToken, input.now, input.now, input.staleBefore).all();
            return readQueryRows(result)[0] || null;
        },
        async markDispatchStarted(input) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE notification_outbox SET dispatch_started_at = ?, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                        AND dispatch_started_at IS NULL
                `).bind(input.now, input.now, input.notificationId, input.leaseToken),
                database.prepare(`
                    UPDATE notifications SET status = 'processing', provider_status = 'unknown'
                    WHERE id = ? AND EXISTS (SELECT 1 FROM notification_outbox o
                        WHERE o.notification_id = notifications.id AND o.status = 'processing'
                            AND o.lease_token = ? AND o.dispatch_started_at = ?)
                `).bind(input.notificationId, input.leaseToken, input.now)
            ]);
            return results[1]?.meta?.changes === 1;
        },
        async recoverAmbiguousDispatch(input) {
            const stale = await database.prepare(`
                SELECT id, notification_id FROM notification_outbox
                WHERE status = 'processing' AND dispatch_started_at IS NOT NULL AND locked_at <= ?
                ORDER BY locked_at LIMIT 1
            `).bind(input.staleBefore).first();
            if (!stale) return false;
            const results = await database.batch([
                database.prepare(`
                    UPDATE notifications SET status = 'failed', provider_status = 'unknown',
                        last_error_code = 'provider_outcome_unknown', failed_at = ?
                    WHERE id = ? AND EXISTS (SELECT 1 FROM notification_outbox o
                        WHERE o.id = ? AND o.status = 'processing' AND o.dispatch_started_at IS NOT NULL AND o.locked_at <= ?)
                `).bind(input.now, stale.notification_id, stale.id, input.staleBefore),
                database.prepare(`
                    UPDATE notification_outbox SET status = 'dead', last_error_code = 'provider_outcome_unknown',
                        locked_at = NULL, lease_token = NULL, updated_at = ?
                    WHERE id = ? AND status = 'processing' AND dispatch_started_at IS NOT NULL AND locked_at <= ?
                `).bind(input.now, stale.id, input.staleBefore),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', n.application_id, ?, ?
                    FROM notifications n JOIN notification_outbox o ON o.notification_id = n.id
                    WHERE n.id = ? AND n.last_error_code = 'provider_outcome_unknown'
                        AND o.id = ? AND o.status = 'dead' AND o.updated_at = ? AND changes() = 1
                `).bind(input.auditEventId, input.requestId,
                    JSON.stringify({ result: 'unknown', providerStatus: 'unknown', errorCode: 'provider_outcome_unknown' }),
                    stale.notification_id, stale.id, input.now)
            ]);
            return results[2]?.meta?.changes === 1;
        },
        async loadDispatchEnvelope(notificationId) {
            return database.prepare(`
                SELECT n.id, n.application_id, n.channel, n.template_key, n.language,
                    n.rendered_message, a.status AS application_status, a.student_phone, a.student_email,
                    COALESCE(p.whatsapp_opt_in, 0) AS whatsapp_opt_in,
                    p.whatsapp_phone_hash, o.id AS outbox_id, o.attempt_count, o.lease_token
                FROM notifications n
                JOIN applications a ON a.id = n.application_id
                JOIN notification_outbox o ON o.notification_id = n.id
                LEFT JOIN notification_preferences p ON p.application_id = n.application_id
                WHERE n.id = ?
            `).bind(notificationId).first();
        },
        async finishDispatch(input) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE notifications SET status = ?, provider_status = ?, provider_message_id = ?,
                        last_error_code = ?, failed_at = ?, sent_at = ?, attempt_count = ?
                    WHERE id = ? AND EXISTS (
                        SELECT 1 FROM notification_outbox o
                        WHERE o.notification_id = notifications.id AND o.status = 'processing' AND o.lease_token = ?
                    )
                `).bind(input.notificationStatus, input.providerStatus, input.providerMessageId,
                    input.errorCode, input.failedAt, input.sentAt, input.attemptCount, input.notificationId, input.leaseToken),
                database.prepare(`
                    UPDATE notification_outbox SET status = ?, last_error_code = ?, locked_at = NULL,
                        lease_token = NULL, dispatch_started_at = NULL, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                `).bind(input.outboxStatus, input.errorCode, input.now,
                    input.notificationId, input.leaseToken),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', ?, ?, ?
                    WHERE changes() = 1
                `).bind(input.auditEventId, input.applicationId, input.requestId,
                    JSON.stringify({ notificationId: input.notificationId, result: input.auditResult,
                        providerStatus: input.providerStatus, errorCode: input.errorCode }))
            ]);
            return results[1]?.meta?.changes === 1;
        },
        async scheduleRetry(input) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE notifications SET status = 'queued', provider_status = 'not_sent',
                        last_error_code = ?, attempt_count = ? WHERE id = ?
                        AND EXISTS (SELECT 1 FROM notification_outbox o WHERE o.notification_id = notifications.id
                            AND o.status = 'processing' AND o.lease_token = ?)
                `).bind(input.errorCode, input.attemptCount, input.notificationId, input.leaseToken),
                database.prepare(`
                    UPDATE notification_outbox SET status = 'retry', next_attempt_at = ?,
                        last_error_code = ?, locked_at = NULL, lease_token = NULL,
                        dispatch_started_at = NULL, updated_at = ?
                    WHERE notification_id = ? AND status = 'processing' AND lease_token = ?
                `).bind(input.nextAttemptAt, input.errorCode, input.now,
                    input.notificationId, input.leaseToken),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, application_id, request_id, safe_metadata_json
                    ) SELECT ?, 'system.notification_dispatch_result', 'system', ?, ?, ?
                    WHERE changes() = 1
                `).bind(input.auditEventId, input.applicationId, input.requestId,
                    JSON.stringify({ notificationId: input.notificationId, result: 'retry_scheduled',
                        providerStatus: 'not_sent', errorCode: input.errorCode }))
            ]);
            return results[1]?.meta?.changes === 1;
        }
    });
}
