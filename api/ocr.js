export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

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
            return res.status(400).json({ error: 'No image data provided.' });
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
                    body: imageBuffer
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
                console.error("Azure Vision API'ye ulaşılamadı (Network Hatası):", azureError);
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
            return res.status(500).json({ error: 'Azure Vision çöktü ve Google Vision yedeği yapılandırılmamış.' });
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
            body: JSON.stringify(googleRequestBody)
        });

        if (googleResponse.ok) {
            const data = await googleResponse.json();
            return res.status(200).json(data);
        } else {
            const errorText = await googleResponse.text();
            console.error("Google Vision API de başarısız oldu:", errorText);
            return res.status(500).json({ error: 'Tüm OCR servisleri (Azure ve Google) başarısız oldu.' });
        }

    } catch (error) {
        console.error('OCR Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
