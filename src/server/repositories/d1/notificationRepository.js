/**
 * Creates the notification and transactional outbox repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{enqueueManualNotification(input: object): Promise<void>}} Durable manual notification persistence.
 */
export function createNotificationRepository(database) {
    return Object.freeze({
        async enqueueManualNotification({ notificationId, outboxId, applicationId, staffUserId, channel, templateKey, language, recipientMasked, idempotencyKey }) {
            const statements = [
                database.prepare(`
                    INSERT INTO notifications (
                        id, application_id, created_by_staff_id, channel, template_key,
                        language, recipient_masked, is_manual
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                `).bind(notificationId, applicationId, staffUserId, channel, templateKey, language, recipientMasked),
                database.prepare(`
                    INSERT INTO notification_outbox (id, notification_id, idempotency_key)
                    VALUES (?, ?, ?)
                `).bind(outboxId, notificationId, idempotencyKey)
            ];
            await database.batch(statements);
        }
    });
}
