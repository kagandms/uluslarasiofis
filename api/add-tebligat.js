import { verifyToken } from "./_auth.js";

export default async function handler(req, res) {
    const authStatus = verifyToken(req);
    if (authStatus === "MISSING_CONFIG") {
        return res.status(401).json({ error: "Sistemde SITE_PASSWORD ve JWT_SECRET ayarlanmamis!" });
    }
    if (!authStatus) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { sayfa, isim } = req.body;
    
    if (!sayfa || !isim) {
        return res.status(400).json({ error: 'Eksik parametre (sayfa veya isim)' });
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwEHZ6-Iz-uohq4yeJRMvgNn5zXeHB6vqBRfBqvpBKai-elnKwJFSiX3EuprOPihnWHOQ/exec";
    const apiKey = process.env.APPS_SCRIPT_API_KEY || 'GIZLI_SIFRE_123';

    try {
        const fetchUrl = `${appsScriptUrl}?key=${encodeURIComponent(apiKey)}&action=add&sayfa=${encodeURIComponent(sayfa)}&isim=${encodeURIComponent(isim)}`;
        
        const response = await fetch(fetchUrl, { redirect: 'follow' });
        
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
        console.error('Tebligat update error:', error);
        return res.status(500).json({ error: 'E-Tablo güncellenirken hata oluştu' });
    }
}
