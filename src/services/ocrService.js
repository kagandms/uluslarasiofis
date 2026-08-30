import { GOOGLE_VISION_API_KEYS } from '../config/constants.js';
import { extractFromCoordinates, extractPage2FromCoordinates, extractFields } from '../utils/parser.js';
import { prepareImageForOCR } from './imageProcessor.js';
import { showToast } from '../ui/toastManager.js';
import { setActiveStep, STEP_IDS } from '../ui/stepWizard.js';
import { populateForm } from '../ui/formManager.js';

let currentApiKeyIndex = 0;
const activeAbortControllers = new Set();

export function cancelOCR() {
    let aborted = false;
    for (const controller of activeAbortControllers) {
        controller.abort();
        aborted = true;
    }
    activeAbortControllers.clear();
    
    // Clear processing UI state handled by main.js via event
    if (aborted) {
        window.dispatchEvent(new CustomEvent('ocrCancelled'));
        showToast('İşlem iptal edildi.', 'info');
    }
}

// Global access for UI inline onclicks
window.cancelOCR = cancelOCR;

export async function runOCR(imageDataUrl, sourceCanvas, skipStep3 = false, isPage2 = false) {
    const controller = new AbortController();
    activeAbortControllers.add(controller);

    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    const updateProgress = (text, percent) => {
        if (progressText) progressText.textContent = text;
        if (progressBar) {
            progressBar.style.width = percent + '%';
            document.querySelectorAll('#progress-percentage').forEach(el => el.textContent = '%' + percent);
        }
    };

    try {
        updateProgress('Belge taranıyor...', 10);
        const base64Data = imageDataUrl.split(',')[1];
        
        let response = null;
        let data = null;

        const tryFetch = async (url, options) => {
            const apiController = new AbortController();
            const apiTimeout = setTimeout(() => apiController.abort(), 60000);
            
            const abortHandler = () => {
                clearTimeout(apiTimeout);
                apiController.abort();
            };
            controller.signal.addEventListener('abort', abortHandler);

            try {
                const res = await fetch(url, {
                    ...options,
                    signal: apiController.signal
                });
                clearTimeout(apiTimeout);
                controller.signal.removeEventListener('abort', abortHandler);
                return res;
            } catch (e) {
                clearTimeout(apiTimeout);
                controller.signal.removeEventListener('abort', abortHandler);
                throw e;
            }
        };

        updateProgress('Sunucuya bağlanılıyor...', 40);
        
        response = await tryFetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageContent: base64Data })
        });

        if (!response.ok) {
            throw new Error(response.status === 500 ? 'Sunucu ayarları eksik veya tüm servisler başarısız oldu.' : `Sunucu Hatası: ${response.status}`);
        }
        data = await response.json();

        updateProgress('Metinler okunuyor...', 90);

        if (!data || !data.responses || !data.responses[0].textAnnotations || data.responses[0].textAnnotations.length === 0) {
            throw new Error('Görselde okunabilir bir metin bulunamadı. Lütfen daha net bir fotoğraf çekin.');
        }

        const annotations = data.responses[0].textAnnotations;
        const serverText = annotations[0].description;
        
        if (!isPage2 && document.getElementById('ocr-raw-text')) {
            document.getElementById('ocr-raw-text').value = serverText;
        }
        
        const serverWords = annotations.slice(1).map(ann => ({
            text: ann.description,
            bbox: {
                x0: ann.boundingPoly.vertices[0].x,
                y0: ann.boundingPoly.vertices[0].y,
                x1: ann.boundingPoly.vertices[2].x,
                y1: ann.boundingPoly.vertices[2].y
            },
            confidence: 1.0
        }));

        if (isPage2) {
            extractPage2FromCoordinates(serverWords);
        } else {
            let serverExtracted = {};
            extractFromCoordinates(serverWords, serverExtracted);
            let fallbackExtracted = extractFields(serverText);

            ['basvuruNo', 'soyadi', 'adi', 'uyrugu', 'dogumTarihi', 'pasaportNo'].forEach(key => {
                if (!serverExtracted[key] && fallbackExtracted[key]) {
                    serverExtracted[key] = fallbackExtracted[key];
                }
            });
            populateForm(serverExtracted);
        }

        updateProgress('İşlem Tamamlandı', 100);
        activeAbortControllers.delete(controller);
        
        if (!skipStep3) {
            setTimeout(() => {
                setActiveStep(STEP_IDS.FORM_RESULT);
            }, 500);
        }

        return data;

    } catch (error) {
        activeAbortControllers.delete(controller);
        if (error.name === 'AbortError' || error.message === 'Aborted') {
            console.log('OCR İptal Edildi');
            return null;
        }

        console.error('OCR Hatası:', error);
        
        let msg = error.message || 'Okuma sırasında bir hata oluştu.';
        if (msg.includes('Failed to fetch') || msg.includes('Load failed')) {
            msg = 'İnternet bağlantınızı kontrol edip tekrar deneyin.';
        }
        
        msg = msg.length > 150 ? msg.substring(0, 147) + "..." : msg;
        showToast(msg, 'error');
        
        window.dispatchEvent(new CustomEvent('ocrError'));
        throw error;
    }
}
