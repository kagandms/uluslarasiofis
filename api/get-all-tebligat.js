export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Sadece GET isteklerine izin verilir' });
  }

  const appsScriptUrl = process.env.APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbwEHZ6-Iz-uohq4yeJRMvgNn5zXeHB6vqBRfBqvpBKai-elnKwJFSiX3EuprOPihnWHOQ/exec";
  const apiKey = process.env.APPS_SCRIPT_API_KEY || 'GIZLI_SIFRE_123';

  if (!appsScriptUrl) {
    return res.status(500).json({ error: 'Sunucu yapilandirma hatasi (URL eksik)' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); 

    const url = `${appsScriptUrl}?key=${encodeURIComponent(apiKey)}&action=getAll`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Kaynak servis zamaninda yanit vermedi (Timeout). Veritabaniniz cok buyuk olabilir.' });
    }
    return res.status(500).json({ error: 'Uzak sunucuya baglanilamadi: ' + error.message });
  }
}
