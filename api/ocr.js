import { requireAuth, requireSameOrigin } from './_auth.js';

const MAX_OCR_IMAGE_BYTES = 15_000_000;

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!requireAuth(req, res)) return;
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Bu işlem için POST isteği gerekir.' });
    }
    if (!requireSameOrigin(req, res)) return;

    const azureKey = process.env.AZURE_VISION_KEY;
    let azureEndpoint = process.env.AZURE_VISION_ENDPOINT;
    const googleApiKey = process.env.GOOGLE_VISION_API_KEY;

    try {
        let imageBuffer;
        
        // Vercel, application/octet-stream isteklerinde req.body'yi Buffer olarak verir.
        if (Buffer.isBuffer(req.body)) {
            imageBuffer = req.body;
        } else if (req.body && req.body.imageContent) {
            // Geriye dönük uyumluluk (Eski Base64 formatı gelirse)
            imageBuffer = Buffer.from(req.body.imageContent, 'base64');
        } else {
            return res.status(400).json({ error: 'Belge görüntüsü gerekli.' });
        }

        if (imageBuffer.length === 0) {
            return res.status(400).json({ error: 'Belge görüntüsü boş.' });
        }
        if (imageBuffer.length > MAX_OCR_IMAGE_BYTES) {
            return res.status(413).json({ error: 'Belge görüntüsü boyut sınırını aşıyor.' });
        }

        // ==========================================
        // 1. ÖNCE AZURE VISION'I DENE
        // ==========================================
        let azureSuccess = false;
        let mappedResponse = null;

        if (azureKey && azureEndpoint) {
            if (azureEndpoint.endsWith('/')) {
                azureEndpoint = azureEndpoint.slice(0, -1);
            }

            const azureUrl = `${azureEndpoint}/computervision/imageanalysis:analyze?features=read&api-version=2023-10-01`;

            try {
                const azureResponse = await fetch(azureUrl, {
                    method: 'POST',
                    headers: {
                        'Ocp-Apim-Subscription-Key': azureKey,
                        'Content-Type': 'application/octet-stream'
                    },
                    body: imageBuffer,
                    signal: AbortSignal.timeout(20_000)
                });

                if (azureResponse.ok) {
                    const azureData = await azureResponse.json();
                    let fullText = "";
                    let textAnnotations = [];

                    if (azureData.readResult && azureData.readResult.blocks) {
                        let allText = [];
                        
                        // Google Vision'un beklediği ilk eleman (tüm metin)
                        textAnnotations.push({ description: "" });
                        
                        azureData.readResult.blocks.forEach(block => {
                            if (block.lines) {
                                block.lines.forEach(line => {
                                    allText.push(line.text);
                                    if (line.words) {
                                        line.words.forEach(word => {
                                            textAnnotations.push({
                                                description: word.text,
                                                boundingPoly: {
                                                    vertices: word.boundingPolygon
                                                }
                                            });
                                        });
                                    }
                                });
                            }
                        });
                        
                        fullText = allText.join('\n');
                        textAnnotations[0].description = fullText;
                    }
                    
                    mappedResponse = {
                        responses: [
                            {
                                textAnnotations: textAnnotations
                            }
                        ]
                    };
                    azureSuccess = true;
                } else {
                    console.warn("⚠️ Azure Vision API başarısız oldu (Status:", azureResponse.status, "). Google Vision Yedeği (Fallback) devreye giriyor...");
                }
            } catch (azureError) {
                console.error("Azure OCR provider request failed.", { errorName: azureError?.name || 'UnknownError' });
            }
        } else {
            console.warn("⚠️ Azure anahtarları eksik. Doğrudan Google Vision Yedeği devreye giriyor...");
        }

        // Eğer Azure başarılıysa sonucu direkt dön
        if (azureSuccess && mappedResponse) {
            return res.status(200).json(mappedResponse);
        }

        // ==========================================
        // 2. AZURE ÇÖKERSE GOOGLE VISION'I DENE (YEDEK)
        // ==========================================
        if (!googleApiKey) {
            console.error('No OCR fallback provider is configured.');
            return res.status(503).json({ error: 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.' });
        }

        const googleRequestBody = {
            requests: [
                {
                    image: { content: imageBuffer.toString('base64') },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                    imageContext: { languageHints: ["tr", "en"] }
                }
            ]
        };

        const googleVisionUrl = `https://eu-vision.googleapis.com/v1/images:annotate?key=${googleApiKey}`;
        
        const googleResponse = await fetch(googleVisionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(googleRequestBody),
            signal: AbortSignal.timeout(20_000)
        });

        if (googleResponse.ok) {
            const data = await googleResponse.json();
            return res.status(200).json(data);
        } else {
            console.error('Google OCR provider returned a failed response.', { status: googleResponse.status });
            return res.status(502).json({ error: 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.' });
        }

    } catch (error) {
        console.error('OCR request failed.', { errorName: error?.name || 'UnknownError' });
        const isTimeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
        return res.status(isTimeout ? 504 : 502).json({ error: 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.' });
    }
}
