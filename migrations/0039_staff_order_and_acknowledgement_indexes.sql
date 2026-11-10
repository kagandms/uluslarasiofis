-- Record the staff list ordering index that production already carries (created by hand), so the schema
-- source matches production; IF NOT EXISTS makes this a no-op there.
CREATE INDEX IF NOT EXISTS idx_applications_staff_order
    ON applications(updated_at DESC, created_at DESC, id DESC);

-- Application lookups ask for the contact-responsibility acknowledgement of one application. Without this
-- index every lookup scans all of that application's audit events (hundreds for busy applications).
-- It is partial, so only the few acknowledgement rows are indexed and other audit writes stay unchanged.
CREATE INDEX IF NOT EXISTS idx_audit_events_contact_acknowledgement
    ON audit_events(application_id, created_at DESC)
    WHERE event_type = 'application.contact_responsibility_accepted';
