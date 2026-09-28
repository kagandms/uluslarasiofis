import jwt from 'jsonwebtoken';

export const SESSION_COOKIE_NAME = 'staff_session';
export const AUTHENTICATION_ERROR = 'Yetkili oturumu gerekli.';
export const AUTH_CONFIGURATION_ERROR = 'Sunucu yapılandırma hatası.';
const MIN_JWT_SECRET_LENGTH = 32;

function readCookie(req, cookieName) {
    const cookieHeader = req.headers?.cookie;
    if (typeof cookieHeader !== 'string') return null;

    for (const cookiePart of cookieHeader.split(';')) {
        const separatorIndex = cookiePart.indexOf('=');
        if (separatorIndex < 0) continue;
        const name = cookiePart.slice(0, separatorIndex).trim();
        if (name !== cookieName) continue;

        try {
            return decodeURIComponent(cookiePart.slice(separatorIndex + 1).trim());
        } catch {
            return null;
        }
    }

    return null;
}

export function createSessionCookie(token, maxAgeSeconds) {
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function createExpiredSessionCookie() {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function verifyToken(req) {
    const jwtSecret = process.env.JWT_SECRET;
    if (typeof jwtSecret !== 'string' || jwtSecret.length < MIN_JWT_SECRET_LENGTH) return 'MISSING_CONFIG';

    const token = readCookie(req, SESSION_COOKIE_NAME);
    if (!token) return false;

    try {
        const claims = jwt.verify(token, jwtSecret);
        return claims?.auth === true && ['admin', 'reviewer', 'staff'].includes(claims.role);
    } catch {
        return false;
    }
}

export function requireAuth(req, res) {
    const authentication = verifyToken(req);
    if (authentication === 'MISSING_CONFIG') {
        res.setHeader('Cache-Control', 'no-store');
        res.status(500).json({ error: AUTH_CONFIGURATION_ERROR });
        return false;
    }

    if (!authentication) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(401).json({ error: AUTHENTICATION_ERROR });
        return false;
    }

    return true;
}

export function isSameOriginRequest(req) {
    const originHeader = req.headers?.origin;
    const requestHost = req.headers?.['x-forwarded-host'] || req.headers?.host;
    if (typeof originHeader !== 'string' || typeof requestHost !== 'string') return false;

    try {
        const origin = new URL(originHeader);
        const forwardedProtocol = req.headers?.['x-forwarded-proto'];
        const requestProtocol = typeof forwardedProtocol === 'string'
            ? `${forwardedProtocol.split(',')[0].trim()}:`
            : (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestHost) ? 'http:' : 'https:');
        return origin.host === requestHost && origin.protocol === requestProtocol;
    } catch {
        return false;
    }
}

export function requireSameOrigin(req, res) {
    if (isSameOriginRequest(req)) return true;
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: 'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.' });
    return false;
}
