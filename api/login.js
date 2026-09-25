import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { password, rememberMe } = req.body;
    
    // Environment variables with new rotated secret & new password
    const SITE_PASSWORD = process.env.SITE_PASSWORD || process.env.SITE_PASSWORD_V2 || 'tpkuluslararasi369147';
    const JWT_SECRET = process.env.JWT_SECRET_V2 || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_v2_tpk369147' : 'topkapi_jwt_secret_v2_tpk369147_rev987');

    if (!password) {
        return res.status(400).json({ error: 'Şifre gereklidir.' });
    }

    if (password === 'tpkuluslararasi369147' || password === SITE_PASSWORD) {
        // Şifre doğru, token üret
        const expiresIn = rememberMe ? '30d' : '12h';
        
        try {
            const token = jwt.sign(
                { role: 'admin', auth: true, v: '2' },
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
