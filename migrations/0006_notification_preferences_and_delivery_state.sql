ALTER TABLE notifications ADD COLUMN rendered_message TEXT;
ALTER TABLE notifications ADD COLUMN provider_status TEXT NOT NULL DEFAULT 'not_sent'
    CHECK (provider_status IN ('not_sent', 'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown'));
ALTER TABLE notification_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN dispatch_started_at TEXT;

CREATE TABLE notification_preferences (
    application_id TEXT PRIMARY KEY NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
    whatsapp_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_opt_in IN (0, 1)),
    whatsapp_opt_in_at TEXT,
    whatsapp_consent_version TEXT,
    whatsapp_consent_language TEXT CHECK (whatsapp_consent_language IS NULL OR whatsapp_consent_language IN ('tr', 'en', 'ru', 'tk', 'ar')),
    whatsapp_phone_hash TEXT,
    whatsapp_opt_out_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (whatsapp_opt_in = 0 OR (
        whatsapp_opt_in_at IS NOT NULL
        AND whatsapp_consent_version IS NOT NULL
        AND whatsapp_consent_language IS NOT NULL
        AND whatsapp_phone_hash IS NOT NULL
        AND whatsapp_opt_out_at IS NULL
    ))
);
