import sys

with open('app.js', 'r') as f:
    content = f.read()

# 1. Replace the single key with an array
old_key_decl = """    const GOOGLE_VISION_API_KEY = 'AIzaSyDYxXNcg1XH9YR-I6fyVdsoZjxryFj27tU';"""
new_key_decl = """    // ============================================
    // Google Vision API Anahtarları (Birden fazla eklenebilir)
    // Kota (aylık 1000 limit) dolduğunda sistem otomatik olarak sıradakine geçer.
    const GOOGLE_VISION_API_KEYS = [
        'AIzaSyDYxXNcg1XH9YR-I6fyVdsoZjxryFj27tU', // 1. API
        '', // 2. API (buraya yapıştırın)
        ''  // 3. API (buraya yapıştırın)
    ];
    let currentApiKeyIndex = 0;"""
content = content.replace(old_key_decl, new_key_decl)

# 2. Update the fetch block
old_fetch_block = """                if (GOOGLE_VISION_API_KEY && GOOGLE_VISION_API_KEY.trim() !== '') {
                    if (progressText) progressText.innerText = 'Belge Yapay Zeka ile Analiz Ediliyor...';

                    // EU endpoint'i 8 saniye içinde dene; başarısız olursa global'a geç
                    const euUrl = `https://eu-vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;
                    const globalUrl = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

                    const tryFetch = async (url, signal) => fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: buildVisionBody(),
                        signal
                    });

                    try {
                        // EU endpoint — 20 sn zaman aşımı (görsel upload + API işleme süresi için)
                        const euController = new AbortController();
                        const euTimeout = setTimeout(() => euController.abort(), 20000);
                        const abortHandler = () => euController.abort();
                        controller.signal.addEventListener('abort', abortHandler);
                        
                        response = await tryFetch(euUrl, euController.signal);
                        
                        controller.signal.removeEventListener('abort', abortHandler);
                        clearTimeout(euTimeout);
                        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                    } catch (euErr) {
                        if (controller.signal.aborted) throw euErr;
                        // EU bloke veya timeout → global endpoint'e düş
                        if (progressText) progressText.innerText = 'Alternatif sunucuya bağlanılıyor...';
                        response = await tryFetch(globalUrl, controller.signal);
                    }
                } else {"""

new_fetch_block = """                // Geçerli bir API anahtarı bul (boş olanları atla)
                while (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length && (!GOOGLE_VISION_API_KEYS[currentApiKeyIndex] || GOOGLE_VISION_API_KEYS[currentApiKeyIndex].trim() === '')) {
                    currentApiKeyIndex++;
                }

                if (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length) {
                    let apiSuccess = false;

                    while (currentApiKeyIndex < GOOGLE_VISION_API_KEYS.length && !apiSuccess) {
                        const CURRENT_KEY = GOOGLE_VISION_API_KEYS[currentApiKeyIndex];
                        if (!CURRENT_KEY || CURRENT_KEY.trim() === '') {
                            currentApiKeyIndex++;
                            continue;
                        }

                        if (progressText) progressText.innerText = `Yapay Zeka ile Analiz Ediliyor (API ${currentApiKeyIndex + 1})...`;

                        const euUrl = `https://eu-vision.googleapis.com/v1/images:annotate?key=${CURRENT_KEY}`;
                        const globalUrl = `https://vision.googleapis.com/v1/images:annotate?key=${CURRENT_KEY}`;

                        const tryFetch = async (url, signal) => fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: buildVisionBody(),
                            signal
                        });

                        try {
                            const euController = new AbortController();
                            const euTimeout = setTimeout(() => euController.abort(), 20000);
                            const abortHandler = () => euController.abort();
                            controller.signal.addEventListener('abort', abortHandler);
                            
                            response = await tryFetch(euUrl, euController.signal);
                            
                            controller.signal.removeEventListener('abort', abortHandler);
                            clearTimeout(euTimeout);
                            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                        } catch (euErr) {
                            if (controller.signal.aborted) throw euErr;
                            if (progressText) progressText.innerText = 'Alternatif sunucuya bağlanılıyor...';
                            response = await tryFetch(globalUrl, controller.signal);
                        }

                        // Check for quota errors
                        if (!response.ok) {
                            const clone = response.clone();
                            try {
                                const errorData = await clone.json();
                                if (response.status === 403 || response.status === 429) {
                                    const errorMsg = errorData.error?.message?.toLowerCase() || '';
                                    if (errorMsg.includes('quota') || errorMsg.includes('billing') || errorMsg.includes('rate limit')) {
                                        console.warn(`API Key ${currentApiKeyIndex + 1} kota sınırına ulaştı, sonrakine geçiliyor...`);
                                        currentApiKeyIndex++;
                                        continue; // try next API key in the loop
                                    }
                                }
                            } catch (e) {
                                // ignore JSON parse errors on error response
                            }
                        }

                        apiSuccess = true;
                        break; // Successfully got a response (could be OK, or a non-quota error)
                    }

                    if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && !apiSuccess) {
                        // Eğer tüm keyler bittiyse Vercel fallback'e düşsün
                        // Ama wait, we already set response, we just break.
                        // Actually, if we hit the end of the loop and haven't succeeded, it will just use the last response.
                    }
                }
                
                // Vercel Fallback
                if (currentApiKeyIndex >= GOOGLE_VISION_API_KEYS.length && (!response || !response.ok)) {
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }"""

# Actually, the logic above needs to completely replace the if-else block. Let's see the old code's else block.
old_else = """                } else {
                    // STANDART YOL: Vercel üzerinden git (Aracı sunucu)
                    if (progressText) progressText.innerText = 'Sunucuya (Vercel) bağlanılıyor...';
                    response = await fetch('/api/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ imageContent: base64Data }),
                        signal: controller.signal
                    });
                }"""
content = content.replace(old_fetch_block, new_fetch_block)

with open('app.js', 'w') as f:
    f.write(content)
