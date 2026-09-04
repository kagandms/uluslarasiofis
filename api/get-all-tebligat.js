export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Sadece GET isteklerine izin verilir' });
  }

  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;

  if (!scriptUrl) {
    return res.status(500).json({ error: 'Sunucu yapilandirma hatasi (URL eksik)' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); 

    const url = scriptUrl + '?action=getAll';
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
