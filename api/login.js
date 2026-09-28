import jwt from 'jsonwebtoken';
import { AUTH_CONFIGURATION_ERROR, createSessionCookie, isSameOriginRequest } from './_auth.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Bu işlem için POST isteği gerekir.' });
    }

    if (!isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.' });
    }

    const sitePassword = process.env.SITE_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET;
    if (!sitePassword || typeof jwtSecret !== 'string' || jwtSecret.length < 32) {
        console.error('Staff login is unavailable because server authentication configuration is incomplete.');
        return res.status(500).json({ error: AUTH_CONFIGURATION_ERROR });
    }

    const password = req.body?.password;
    if (typeof password !== 'string' || password.length === 0) {
        return res.status(400).json({ error: 'Şifre alanı zorunludur.' });
    }

    if (password !== sitePassword) {
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }

    const sessionTtl = req.body?.rememberMe === true
        ? REMEMBERED_SESSION_TTL_SECONDS
        : SESSION_TTL_SECONDS;

    try {
        const token = jwt.sign({ role: 'admin', auth: true }, jwtSecret, { expiresIn: sessionTtl });
        res.setHeader('Set-Cookie', createSessionCookie(token, sessionTtl));
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Staff login session generation failed.', { errorName: error?.name || 'UnknownError' });
        return res.status(500).json({ error: 'Giriş tamamlanamadı. Lütfen tekrar deneyin.' });
    }
}
