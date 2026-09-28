import { requireAuth } from './_auth.js';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Bu işlem için GET isteği gerekir.' });
    }

    if (!requireAuth(req, res)) return;
    return res.status(200).json({ authenticated: true });
}
