import { requireAuth } from './_auth.js';
import { respondWithAppsScript } from './_tebligat.js';

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!requireAuth(req, res)) return;
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Bu işlem için GET isteği gerekir.' });
    }

    const query = req.query?.q;
    const year = req.query?.year || '2026';
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) {
        return res.status(400).json({ error: 'En az iki karakterli bir arama girin.' });
    }
    if (typeof year !== 'string' || !/^\d{4}$/.test(year)) {
        return res.status(400).json({ error: 'Geçerli bir yıl seçin.' });
    }

    return respondWithAppsScript(res, 'search', { q: query.trim(), year });
}
