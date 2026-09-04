import { showToast } from '../ui/toastManager.js';

export function initYknManager() {
    const btnSearch = document.getElementById('btn-ykn-search');
    const inputPassport = document.getElementById('ykn-passport-input');
    const studentResult = document.getElementById('ykn-student-result');
    const studentName = document.getElementById('ykn-student-name');
    const statusContainer = document.getElementById('ykn-status-container');
    
    const btnCopyInfo = document.getElementById('btn-ykn-copy-info');
    const btnCopyLetter = document.getElementById('btn-ykn-copy-letter');
    const btnTransferYoksis = document.getElementById('btn-ykn-transfer-yoksis');
    const btnPasteYoksis = document.getElementById('btn-ykn-paste-yoksis');

    // UI Status Helper
    function addStatus(message, type = 'info') {
        const color = type === 'error' ? 'var(--error, #e74c3c)' : (type === 'success' ? 'var(--success, #27ae60)' : 'var(--text-secondary)');
        const el = document.createElement('div');
        el.style.color = color;
        el.textContent = `• ${message}`;
        statusContainer.appendChild(el);
    }

    function clearStatus() {
        statusContainer.innerHTML = '';
    }

    let currentStudentData = null;

    if (btnSearch) {
        btnSearch.addEventListener('click', () => {
            const passportNo = inputPassport.value.trim();
            if (!passportNo) {
                showToast('Lütfen pasaport numarası girin.', 'warning');
                return;
            }
            
            clearStatus();
            studentResult.style.display = 'block';
            studentName.textContent = "Aranıyor... (" + passportNo + ")";
            addStatus('Apply Topkapı eklentisi üzerinden arama başlatıldı...', 'info');
            
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'SEARCH_STUDENT',
                    passportNo: passportNo
                }
            }, '*');
        });
    }

    if (btnCopyInfo) {
        btnCopyInfo.addEventListener('click', async () => {
            addStatus('Öğrenci bilgileri kopyalandı.', 'success');
            
            if (currentStudentData && currentStudentData.passportImageUrl) {
                addStatus('Pasaport görseli işleniyor (Azure OCR)...', 'info');
                try {
                    // Resmi çek
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.src = currentStudentData.passportImageUrl;
                    
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = () => reject(new Error("Görsel yüklenemedi"));
                    });
                    
                    // Canvas oluştur (runOCR canvas istiyor)
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/jpeg');
                    
                    // main.js veya global'den runOCR import edilmiş mi bakmalıyız
                    // Ama dosyanın başına runOCR'ı ekleyelim (import { runOCR } from '../services/ocrService.js';)
                    const { runOCR } = await import('../services/ocrService.js');
                    
                    // Azure OCR çağır (skipStep3 = true, isPage2 = false, isSilent = true)
                    const ocrData = await runOCR(dataUrl, canvas, true, false, true);
                    
                    // Düzenleme ve Bitiş tarihini currentStudentData'ya ekle
                    // Normalde ocrService.js içinde 'dogumTarihi', 'pasaportNo' falan var.
                    // Varsayılan parser'ın çıkardığı verileri currentStudentData ile birleştirelim
                    currentStudentData = { ...currentStudentData, ...ocrData };
                    
                    addStatus('Pasaport tarihleri başarıyla okundu.', 'success');
                } catch (err) {
                    console.error(err);
                    addStatus('Pasaport okunurken hata oluştu: ' + err.message, 'error');
                }
            }
        });
    }

    if (btnCopyLetter) {
        btnCopyLetter.addEventListener('click', async () => {
            if (!currentStudentData || !currentStudentData.acceptanceLetterUrl) {
                addStatus('Kabul mektubu PDF bağlantısı bulunamadı!', 'error');
                return;
            }
            addStatus('Kabul mektubu indiriliyor ve YÖKSİS ID aranıyor...', 'info');
            
            try {
                // PDF'i arraybuffer olarak indir
                const response = await fetch(currentStudentData.acceptanceLetterUrl);
                if (!response.ok) throw new Error('PDF indirilemedi');
                const arrayBuffer = await response.arrayBuffer();
                
                // PDF.js ile dökümanı yükle
                const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
                
                let foundYoksisId = null;
                
                // İki sayfayı da tara
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    
                    // Regex ile YÖKSİS ID: XXX-XXX-XX formatını bul
                    const match = pageText.match(/YÖKSİS ID:\s*([A-Za-z0-9\-]+)/i);
                    if (match && match[1]) {
                        foundYoksisId = match[1].trim();
                        break;
                    }
                }
                
                if (foundYoksisId) {
                    currentStudentData.yoksisId = foundYoksisId;
                    addStatus('Kabul mektubu YÖKSİS ID bulundu: ' + foundYoksisId, 'success');
                    btnTransferYoksis.style.display = 'block';
                } else {
                    addStatus('PDF içinde YÖKSİS ID bulunamadı. Lütfen manuel kontrol edin.', 'warning');
                }
            } catch (err) {
                console.error(err);
                addStatus('Kabul mektubu okunamadı: ' + err.message, 'error');
            }
        });
    }

    if (btnTransferYoksis) {
        btnTransferYoksis.addEventListener('click', () => {
            if (!currentStudentData || !currentStudentData.yoksisId) {
                showToast('Önce kabul mektubundan kodu kopyalamalısınız.', 'warning');
                return;
            }
            addStatus('YÖKSİS sekmesine geçiliyor...', 'info');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'TRANSFER_TO_YOKSIS',
                    data: currentStudentData
                }
            }, '*');
        });
    }

    if (btnPasteYoksis) {
        btnPasteYoksis.addEventListener('click', () => {
            if (!currentStudentData) return;
            addStatus('Bilgiler YÖKSİS formuna yapıştırılıyor...', 'info');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'FILL_YOKSIS_FORM',
                    data: currentStudentData
                }
            }, '*');
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'EXTENSION') return;
        
        if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_FOUND') {
            currentStudentData = event.data.data;
            studentName.textContent = currentStudentData.fullName || "İsim Bulunamadı";
            addStatus('Öğrenci bulundu.', 'success');
        }
        else if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_NOT_FOUND') {
            studentName.textContent = "Bulunamadı";
            const errorMsg = event.data.error ? 'Hata: ' + event.data.error : 'Apply Topkapı üzerinde öğrenci bulunamadı.';
            addStatus(errorMsg, 'error');
        }
    });
}
