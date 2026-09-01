import jwt from 'jsonwebtoken';

export function verifyToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) return false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return !!decoded;
    } catch (err) {
        return false;
    }
}
