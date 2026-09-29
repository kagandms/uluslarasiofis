const STAFF_COOKIE_NAME = 'staff_session';
const APPLICATION_COOKIE_NAME = 'application_session';
const encoder = new TextEncoder();

function encodeBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * Creates a cryptographically random opaque session token.
 * @returns {string} A 256-bit base64url token for an HttpOnly cookie.
 */
export function createOpaqueSessionToken() {
    return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Hashes an opaque session token before it is stored in D1.
 * @param {string} token Opaque browser session token.
 * @returns {Promise<string>} Lowercase SHA-256 hex digest.
 */
export async function hashSessionToken(token) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a named value from a Cookie header without exposing other cookie values.
 * @param {Request} request Fetch API request.
 * @param {string} cookieName Cookie name to retrieve.
 * @returns {string|null} Decoded cookie value, or null when missing or malformed.
 */
export function readCookie(request, cookieName) {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;
    for (const item of cookieHeader.split(';')) {
        const separator = item.indexOf('=');
        if (separator < 0 || item.slice(0, separator).trim() !== cookieName) continue;
        try {
            return decodeURIComponent(item.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Builds a same-site, HttpOnly cookie for a server-managed session.
 * @param {'staff'|'application'} sessionType Session cookie domain.
 * @param {string} token Opaque session token.
 * @param {number} maxAgeSeconds Cookie lifetime in seconds.
 * @returns {string} Set-Cookie header value.
 */
export function createSessionCookie(sessionType, token, maxAgeSeconds) {
    const cookieName = sessionType === 'staff' ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME;
    return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

/**
 * Builds an expired same-site session cookie.
 * @param {'staff'|'application'} sessionType Session cookie domain.
 * @returns {string} Expired Set-Cookie header value.
 */
export function createExpiredSessionCookie(sessionType) {
    const cookieName = sessionType === 'staff' ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME;
    return `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Returns the cookie name for a session domain.
 * @param {'staff'|'application'} sessionType Session cookie domain.
 * @returns {string} Cookie name.
 */
export function getSessionCookieName(sessionType) {
    return sessionType === 'staff' ? STAFF_COOKIE_NAME : APPLICATION_COOKIE_NAME;
}
