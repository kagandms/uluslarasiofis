/**
 * Keeps a draft writer authorized at commit after a concurrent staff reset/logout.
 * Bind the trusted owner session ID twice. Internal repository callers may omit it;
 * public draft routes always supply the authenticated server session ID.
 */
export const APPLICATION_OWNER_GUARD = `(? IS NULL OR EXISTS (
    SELECT 1 FROM application_sessions AS owner
    WHERE owner.id=? AND owner.application_id=applications.id AND owner.revoked_at IS NULL
      AND datetime(owner.expires_at)>datetime('now')
))`;
