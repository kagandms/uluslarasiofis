import jwt from 'jsonwebtoken';

export function verifyToken(req) {
    const JWT_SECRET = process.env.JWT_SECRET_V2 || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_v2_tpk369147' : 'topkapi_jwt_secret_v2_tpk369147_rev987');
    const SITE_PASSWORD = process.env.SITE_PASSWORD || process.env.SITE_PASSWORD_V2 || 'tpkuluslararasi369147';

    if (!JWT_SECRET || !SITE_PASSWORD) {
        return "MISSING_CONFIG";
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return !!decoded;
    } catch (err) {
        return false;
    }
}
