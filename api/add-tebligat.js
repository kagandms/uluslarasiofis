export default async function handler(req, res) {
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
        
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
            throw new Error(`Apps Script responded with status: ${response.status}`);
        }

        const data = await response.json();
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Tebligat update error:', error);
        return res.status(500).json({ error: 'E-Tablo güncellenirken hata oluştu' });
    }
}
