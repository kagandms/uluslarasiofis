import { verifyToken } from "./_auth.js";

export default async function handler(req, res) {
    const authStatus = verifyToken(req);
    if (authStatus === "MISSING_CONFIG") {
        return res.status(401).json({ error: "Sistemde SITE_PASSWORD ve JWT_SECRET ayarlanmamis!" });
    }
    if (!authStatus) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const query = req.query.q;
    const year = req.query.year || '2026';
    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }
    if (!/^\d{4}$/.test(year)) {
        return res.status(400).json({ error: 'Year must be a four-digit value' });
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwEHZ6-Iz-uohq4yeJRMvgNn5zXeHB6vqBRfBqvpBKai-elnKwJFSiX3EuprOPihnWHOQ/exec";
    const apiKey = process.env.APPS_SCRIPT_API_KEY || 'GIZLI_SIFRE_123';

    if (!appsScriptUrl) {
        return res.status(500).json({ error: 'Server configuration error (Missing URL)' });
    }

    try {
        const fetchUrl = `${appsScriptUrl}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&year=${encodeURIComponent(year)}`;
        const response = await fetch(fetchUrl, {
            redirect: 'follow',
            signal: AbortSignal.timeout(12000)
        });
        
        if (!response.ok) {
            throw new Error(`Apps Script responded with status: ${response.status}`);
        }

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Invalid JSON from Apps Script:', responseText);
            throw new Error('Apps Script did not return valid JSON. Response: ' + responseText.substring(0, 50));
        }
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Tebligat search error:', error);
        const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return res.status(504).json({
            error: isTimeout
                ? 'Kaynak servis zamanında yanıt vermedi. Daha kısa bir isimle tekrar deneyin.'
                : 'Tebliğ veri kaynağına ulaşılamadı. Lütfen daha sonra tekrar deneyin.'
        });
    }
}
