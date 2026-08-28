import sys

with open('app.js', 'r') as f:
    content = f.read()

mess = """                // Vercel Fallback
                if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && (!response || !response.ok)) {
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }
                    // STANDART YOL: Vercel üzerinden git (Aracı sunucu)
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }"""

clean = """                // Vercel Fallback
                if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && (!response || !response.ok)) {
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }"""

content = content.replace(mess, clean)
with open('app.js', 'w') as f:
    f.write(content)
