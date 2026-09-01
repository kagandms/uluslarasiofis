import jwt from 'jsonwebtoken';

export function verifyToken(req) {
    const JWT_SECRET = process.env.JWT_SECRET;
    const SITE_PASSWORD = process.env.SITE_PASSWORD;

    // Eğer Vercel'de şifreler ayarlanmamışsa, şimdilik (geçici olarak) güvenlik duvarını pas geçsin 
    // ki kullanıcının işi aksamasın. Veya özel bir hata döndürsün.
    if (!JWT_SECRET || !SITE_PASSWORD) {
        // We will return a specific string to indicate missing config
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
