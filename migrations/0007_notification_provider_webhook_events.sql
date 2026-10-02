CREATE TABLE notification_provider_webhook_events (
    id TEXT PRIMARY KEY NOT NULL,
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
    provider_message_id TEXT NOT NULL,
    provider_status TEXT NOT NULL CHECK (provider_status IN ('sent', 'delivered', 'read', 'failed')),
    provider_timestamp TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE (provider_message_id, provider_status, provider_timestamp)
);
CREATE INDEX idx_notification_webhook_events_notification
    ON notification_provider_webhook_events(notification_id, received_at DESC);
