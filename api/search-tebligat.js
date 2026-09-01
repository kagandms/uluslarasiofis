export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const query = req.query.q;
    if (!query || query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters long' });
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwWOpoKZJPV_16Uz1ZHNynFB-32-awI5uWCDFsmjMLXE0B2lTkcbde8K9XFWShsCec-yQ/exec";
    const apiKey = process.env.APPS_SCRIPT_API_KEY || 'GIZLI_SIFRE_123';

    if (!appsScriptUrl) {
        return res.status(500).json({ error: 'Server configuration error (Missing URL)' });
    }

    try {
        const fetchUrl = \\?key=\&q=\\;
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
            throw new Error(\Apps Script responded with status: \\);
        }

        const data = await response.json();
        
        return res.status(200).json(data);
    } catch (error) {
        console.error('Tebligat search error:', error);
        return res.status(500).json({ error: 'Failed to fetch data from source' });
    }
}
