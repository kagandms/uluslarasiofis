export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const googleApiKey = process.env.GOOGLE_VISION_API_KEY;
    const azureKey = process.env.AZURE_VISION_KEY;
    let azureEndpoint = process.env.AZURE_VISION_ENDPOINT;

    if (!googleApiKey) {
        return res.status(500).json({ error: 'Google API Key is not configured.' });
    }

    try {
        const { imageContent } = req.body;

        if (!imageContent) {
            return res.status(400).json({ error: 'No image content provided.' });
        }

        // ==========================================
        // 1. ÖNCE GOOGLE VISION'I DENE
        // ==========================================
        const googleRequestBody = {
            requests: [
                {
                    image: { content: imageContent },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                    imageContext: { languageHints: ["tr", "en"] }
                }
            ]
        };

        const googleVisionUrl = `https://eu-vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`;
        
        let googleResponse;
        try {
            googleResponse = await fetch(googleVisionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(googleRequestBody)
            });
        } catch (fetchError) {
            console.error("Google Vision API'ye ulaşılamadı (Network Hatası):", fetchError);
            googleResponse = null; 
        }

        // Eğer Google başarılıysa sonucu direkt dön
        if (googleResponse && googleResponse.ok) {
            const data = await googleResponse.json();
            return res.status(200).json(data);
        }

        // ==========================================
        // 2. GOOGLE ÇÖKERSE AZURE VISION'I DENE (YEDEK)
        // ==========================================
        console.warn("⚠️ Google Vision API başarısız oldu. Azure Vision Yedeği (Fallback) devreye giriyor...");

        if (!azureKey || !azureEndpoint) {
            return res.status(500).json({ error: 'Google Vision çöktü ve Azure Vision yedeği yapılandırılmamış.' });
        }

        if (azureEndpoint.endsWith('/')) {
            azureEndpoint = azureEndpoint.slice(0, -1);
        }

        const azureUrl = `${azureEndpoint}/computervision/imageanalysis:analyze?features=read&api-version=2023-10-01`;
        const imageBuffer = Buffer.from(imageContent, 'base64');

        const azureResponse = await fetch(azureUrl, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': azureKey,
                'Content-Type': 'application/octet-stream'
            },
            body: imageBuffer
        });

        if (!azureResponse.ok) {
            const azureError = await azureResponse.text();
            console.error("Azure Vision API de başarısız oldu:", azureError);
            return res.status(500).json({ error: 'Tüm OCR servisleri (Google ve Azure) başarısız oldu.' });
        }

        const azureData = await azureResponse.json();

        // Frontend kodunuzu bozmamak için, Azure'un verdiği cevabı Google formatına dönüştürüyoruz
        const fullText = azureData.readResult ? azureData.readResult.content : "";
        
        const mappedResponse = {
            responses: [
                {
                    textAnnotations: [
                        { description: fullText }
                    ]
                }
            ]
        };

        return res.status(200).json(mappedResponse);

    } catch (error) {
        console.error('OCR Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
