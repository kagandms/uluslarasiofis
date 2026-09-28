import { createExpiredSessionCookie, isSameOriginRequest } from './_auth.js';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Bu işlem için POST isteği gerekir.' });
    }

    if (!isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.' });
    }

    res.setHeader('Set-Cookie', createExpiredSessionCookie());
    return res.status(200).json({ success: true });
}
