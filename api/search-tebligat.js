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
    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwEHZ6-Iz-uohq4yeJRMvgNn5zXeHB6vqBRfBqvpBKai-elnKwJFSiX3EuprOPihnWHOQ/exec";
    const apiKey = process.env.APPS_SCRIPT_API_KEY || 'GIZLI_SIFRE_123';

    if (!appsScriptUrl) {
        return res.status(500).json({ error: 'Server configuration error (Missing URL)' });
    }

    try {
        const fetchUrl = `${appsScriptUrl}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}`;
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
            throw new Error(`Apps Script responded with status: ${response.status}`);
        }

        const data = await response.json();
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Tebligat search error:', error);
        return res.status(500).json({ error: 'Failed to fetch data from source' });
    }
}
