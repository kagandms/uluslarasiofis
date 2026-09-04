import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { password, rememberMe } = req.body;
    
    // Environment variables
    const SITE_PASSWORD = process.env.SITE_PASSWORD;
    const JWT_SECRET = process.env.JWT_SECRET;

    // Güvenlik: Ortam değişkenleri ayarlanmamışsa uyarı ver
    if (!SITE_PASSWORD || !JWT_SECRET) {
        console.error('CRITICAL: SITE_PASSWORD or JWT_SECRET is not set in environment variables!');
        return res.status(500).json({ error: 'Sunucu yapılandırma hatası. Lütfen sistem yöneticisine başvurun.' });
    }

    if (!password) {
        return res.status(400).json({ error: 'Şifre gereklidir.' });
    }

    if (password === SITE_PASSWORD) {
        // Şifre doğru, token üret
        const expiresIn = rememberMe ? '30d' : '12h';
        
        try {
            const token = jwt.sign(
                { role: 'admin', auth: true },
                JWT_SECRET,
                { expiresIn }
            );

            return res.status(200).json({ 
                success: true, 
                token: token 
            });
        } catch (error) {
            console.error('Token generation error:', error);
            return res.status(500).json({ error: 'Token oluşturulurken bir hata meydana geldi.' });
        }
    } else {
        // Yanlış şifre
        return res.status(401).json({ error: 'Hatalı şifre. Lütfen tekrar deneyin.' });
    }
}
