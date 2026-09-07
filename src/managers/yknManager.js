import { showToast } from '../ui/toastManager.js';
import { extractPassportDatesFromText, extractYoksisIdFromText, isValidYoksisId } from '../utils/ykn-document-parser.js';

function ensurePdfWorkerReady() {
    if (window.pdfjsLib) {
        if (!window.pdfjsLib.GlobalWorkerOptions) {
            window.pdfjsLib.GlobalWorkerOptions = {};
        }
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            try {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
            } catch (_) {
                try {
                    const workerBlob = new Blob([
                        "importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js');"
                    ], { type: 'application/javascript' });
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
                } catch (_) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
                }
            }
        }
    }
}

function copyTextToClipboard(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
            fallbackCopyText(text);
        });
    } else {
        fallbackCopyText(text);
    }
}

function fallbackCopyText(text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    } catch (_) {}
}

async function extractPdfText(documentBytes) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil.');
    ensurePdfWorkerReady();
    const pdf = await window.pdfjsLib.getDocument({
        data: documentBytes,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
        cMapPacked: true
    }).promise;
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        pageTexts.push(textContent.items.map((item) => item.str).join(' '));
    }
    return pageTexts.join('\n');
}

function decodeBase64ToBytes(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function extractPdfTextWithOcr(documentBytes) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil.');
    ensurePdfWorkerReady();
    const pdf = await window.pdfjsLib.getDocument({
        data: documentBytes,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
        cMapPacked: true
    }).promise;
    const { runOCR } = await import('../services/ocrService.js');
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const ocrData = await runOCR(canvas, true, false, true);
        if (ocrData._rawText) pageTexts.push(ocrData._rawText);
    }
    return pageTexts.join('\n');
}

async function extractImageTextWithOcr(documentBytes, contentType) {
    const { runOCR } = await import('../services/ocrService.js');
    const imageUrl = URL.createObjectURL(new Blob([documentBytes], { type: contentType || 'image/jpeg' }));
    try {
        const image = new Image();
        image.src = imageUrl;
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Pasaport görseli yüklenemedi.'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const ocrData = await runOCR(canvas, true, false, true);
        return ocrData._rawText || '';
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
}

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
    let activeSearchRequestId = null;
    let searchTimeoutTimer = null;
    let extensionBridgeActive = false;
    const pendingDocumentReads = new Set();

    function createRequestId() {
        return 'ykn-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }

    function clearSearchTimeout() {
        if (searchTimeoutTimer) {
            clearTimeout(searchTimeoutTimer);
            searchTimeoutTimer = null;
        }
    }

    function resetStudentActions() {
        if (btnCopyInfo) btnCopyInfo.disabled = true;
        if (btnCopyLetter) btnCopyLetter.disabled = true;
        if (btnPasteYoksis) btnPasteYoksis.disabled = true;
        if (btnTransferYoksis) btnTransferYoksis.style.display = 'none';
    }

    function updateStudentActions(studentData) {
        const hasStudent = Boolean(studentData && (studentData.fullName || studentData.passportNo));
        if (btnCopyInfo) btnCopyInfo.disabled = !hasStudent;
        if (btnCopyLetter) btnCopyLetter.disabled = !hasStudent;
        if (btnPasteYoksis) btnPasteYoksis.disabled = !hasStudent;
        if (btnTransferYoksis) {
            btnTransferYoksis.style.display = (studentData?.yoksisId && isValidYoksisId(studentData.yoksisId)) ? 'block' : 'none';
        }
    }

    function requestApplyDocument(documentKind, documentUrl) {
        if (pendingDocumentReads.has(documentKind)) return;
        pendingDocumentReads.add(documentKind);
        window.postMessage({
            source: 'WEB_APP',
            payload: {
                action: 'READ_APPLY_DOCUMENT',
                documentKind,
                documentUrl,
                requestId: activeSearchRequestId
            }
        }, '*');
    }

    function isPdfData(bytes) {
        if (!bytes || bytes.length < 5) return -1;
        const limit = Math.min(bytes.length, 1024);
        for (let i = 0; i <= limit - 5; i++) {
            if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 && bytes[i+3] === 0x46 && bytes[i+4] === 0x2D) {
                return i;
            }
        }
        return -1;
    }

    function isImageData(bytes, contentType) {
        if (contentType && contentType.toLowerCase().startsWith('image/')) return true;
        if (!bytes || bytes.length < 4) return false;
        if (bytes[0] === 0xFF && bytes[1] === 0xD8) return true;
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
        return false;
    }

    async function handleDocumentBytesReady(documentData) {
        const documentKind = documentData?.documentKind;
        const documentBytes = documentData?.documentBase64
            ? decodeBase64ToBytes(documentData.documentBase64)
            : null;
        const contentType = documentData?.contentType || '';
        if (!documentKind || !documentBytes) return;

        try {
            const pdfOffset = isPdfData(documentBytes);
            const isImage = isImageData(documentBytes, contentType);
            let text = '';

            if (pdfOffset >= 0) {
                const validPdfBytes = pdfOffset > 0 ? documentBytes.subarray(pdfOffset) : documentBytes;
                try {
                    text = await extractPdfText(validPdfBytes);
                } catch (pdfErr) {
                    text = await extractPdfTextWithOcr(validPdfBytes);
                }
            } else if (isImage) {
                text = await extractImageTextWithOcr(documentBytes, contentType || 'image/jpeg');
            } else {
                const textDecoder = new TextDecoder('utf-8');
                const decodedText = textDecoder.decode(documentBytes);
                
                if (decodedText.includes('<') && decodedText.includes('>')) {
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(decodedText, 'text/html');
                        const embedEl = doc.querySelector('iframe[src], embed[src], object[data], a[href*=".pdf"]');
                        let embedSrc = embedEl ? (embedEl.getAttribute('src') || embedEl.getAttribute('data') || embedEl.getAttribute('href')) : null;
                        if (!embedSrc) {
                            const match = decodedText.match(/(https?:\/\/[^"'\s<>]+\/uploads\/acceptance-letters\/[^"'\s<>]+\.pdf[^"'\s<>]*)/i)
                                || decodedText.match(/(https?:\/\/[^"'\s<>]+\.pdf[^"'\s<>]*)/i);
                            if (match) embedSrc = match[1];
                        }
                        if (embedSrc && !pendingDocumentReads.has(documentKind + '_retry')) {
                            pendingDocumentReads.add(documentKind + '_retry');
                            pendingDocumentReads.delete(documentKind);
                            addStatus('Kabul mektubu PDF bağlantısı HTML içinde bulundu, alınıyor...', 'info');
                            requestApplyDocument(documentKind, embedSrc.replace(/&amp;/g, '&'));
                            return;
                        }
                        text = doc.body ? doc.body.innerText : decodedText;
                    } catch (_) {
                        text = decodedText;
                    }
                } else {
                    text = decodedText;
                }
            }

            if (documentKind === 'acceptanceLetter') {
                let yoksisId = extractYoksisIdFromText(text);
                if (!yoksisId && pdfOffset >= 0) {
                    try {
                        const validPdfBytes = pdfOffset > 0 ? documentBytes.subarray(pdfOffset) : documentBytes;
                        const ocrText = await extractPdfTextWithOcr(validPdfBytes);
                        yoksisId = extractYoksisIdFromText(ocrText);
                    } catch (_) {}
                }

                if (!yoksisId) {
                    throw new Error('Kabul mektubu PDF belgesinde geçerli YÖKSİS ID bulunamadı.');
                }

                currentStudentData = { ...currentStudentData, yoksisId };
                copyTextToClipboard(yoksisId);
                updateStudentActions(currentStudentData);
                addStatus(`Kabul mektubu YÖKSİS ID bulundu ve kopyalandı: ${yoksisId}`, 'success');
                showToast(`Kabul Kodu kopyalandı: ${yoksisId}`, 'success');
                return;
            }

            let passportDates = extractPassportDatesFromText(text);
            if (!passportDates.issueDate || !passportDates.expiryDate) {
                if (pdfOffset >= 0) {
                    const validPdfBytes = pdfOffset > 0 ? documentBytes.subarray(pdfOffset) : documentBytes;
                    const ocrText = await extractPdfTextWithOcr(validPdfBytes);
                    passportDates = extractPassportDatesFromText(ocrText);
                } else if (isImage) {
                    const ocrText = await extractImageTextWithOcr(documentBytes, contentType || 'image/jpeg');
                    passportDates = extractPassportDatesFromText(ocrText);
                }
            }
            if (!passportDates.issueDate || !passportDates.expiryDate) {
                throw new Error('Pasaport PDF metninde geçerli düzenlenme/geçerlilik tarihleri bulunamadı.');
            }
            currentStudentData = { ...currentStudentData, ...passportDates };
            addStatus('Pasaport düzenlenme ve geçerlilik tarihleri okundu.', 'success');
        } catch (error) {
            addStatus(`${documentKind === 'passport' ? 'Pasaport' : 'Kabul mektubu'} okunamadı: ${error.message}`, 'error');
        } finally {
            pendingDocumentReads.delete(documentKind);
        }
    }

    resetStudentActions();

    if (btnSearch) {
        btnSearch.addEventListener('click', () => {
            const passportNo = inputPassport.value.trim();
            if (!passportNo) {
                showToast('Lütfen pasaport numarası girin.', 'warning');
                return;
            }
            
            clearStatus();
            clearSearchTimeout();
            currentStudentData = null;
            activeSearchRequestId = createRequestId();
            resetStudentActions();
            studentResult.style.display = 'block';
            studentName.textContent = "Aranıyor... (" + passportNo + ")";
            addStatus('Apply Topkapı eklentisi üzerinden arama başlatıldı...', 'info');
            
            // Eklenti varlık yoklaması
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'PING',
                    requestId: activeSearchRequestId
                }
            }, '*');

            // Asıl arama isteği
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'SEARCH_STUDENT',
                    passportNo: passportNo,
                    requestId: activeSearchRequestId
                }
            }, '*');

            // 2.5 saniye sonra eklenti köprüsü hala ses vermediyse erken uyarı ver
            setTimeout(() => {
                if (!extensionBridgeActive && studentName.textContent.startsWith('Aranıyor...')) {
                    addStatus('Eklenti köprüsü henüz yanıt vermedi. Lütfen chrome://extensions sekmesinden eklentiyi Yenileyip (↻) bu sayfayı F5 ile tazeleyin.', 'error');
                }
            }, 2500);

            // 14 saniyelik güvenlik zaman aşımı
            searchTimeoutTimer = setTimeout(() => {
                if (studentName.textContent.startsWith('Aranıyor...')) {
                    studentName.textContent = 'Bağlantı Zaman Aşımı';
                    addStatus('Eklentiden veya Apply sekmesinden zamanında yanıt alınamadı.', 'error');
                    addStatus('1. Apply Topkapı sekmesinin açık olduğunu kontrol edin.', 'error');
                    addStatus('2. Apply Topkapı ve bu portal sekmesini yenileyin (F5).', 'error');
                    addStatus('3. Chrome Eklentinizin (YÖKSİS Otomasyonu) açık olduğundan emin olun.', 'error');
                }
            }, 14000);
        });
    }

    if (btnCopyInfo) {
        btnCopyInfo.addEventListener('click', async () => {
            if (!currentStudentData) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }

            addStatus('Öğrenci bilgileri Apply oturumundan kopyalanıyor...', 'info');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'COPY_APPLY_DATA',
                    requestId: activeSearchRequestId
                }
            }, '*');

            const passportDocumentUrl = currentStudentData?.passportImageUrl || currentStudentData?.passportDocumentUrl;
            if (passportDocumentUrl) {
                requestApplyDocument('passport', passportDocumentUrl);
            } else {
                void 'Pasaport belgesi henüz alınmadı.';
            }
        });
    }

    if (btnCopyLetter) {
        btnCopyLetter.addEventListener('click', async () => {
            if (!currentStudentData) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }

            if (currentStudentData.yoksisId && isValidYoksisId(currentStudentData.yoksisId)) {
                copyTextToClipboard(currentStudentData.yoksisId);
                addStatus(`Kabul mektubu kodu panoya kopyalandı: ${currentStudentData.yoksisId}`, 'success');
                showToast(`Kabul Kodu kopyalandı: ${currentStudentData.yoksisId}`, 'success');
                if (btnTransferYoksis) btnTransferYoksis.style.display = 'block';
                return;
            }

            if (currentStudentData.acceptanceLetterUrl) {
                addStatus('Kabul mektubu PDF belgesi Apply oturumundan alınıyor...', 'info');
                requestApplyDocument('acceptanceLetter', currentStudentData.acceptanceLetterUrl);
                return;
            }

            addStatus('Kabul mektubu ve kod Apply sekmesinde taranıyor...', 'info');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'EXTRACT_KABUL_CODE',
                    requestId: activeSearchRequestId
                }
            }, '*');

            void 'Kabul mektubu PDF bağlantısı bulunamadı!';
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
                    data: currentStudentData,
                    requestId: activeSearchRequestId
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
                    data: currentStudentData,
                    requestId: activeSearchRequestId
                }
            }, '*');
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'EXTENSION') return;

        const requestId = event.data.requestId;
        if (requestId !== activeSearchRequestId) return;

        if (event.data.type === 'PONG') {
            extensionBridgeActive = true;
            addStatus('Eklenti köprüsü hazır.', 'info');
            return;
        }

        if (event.data.type === 'RESPONSE') {
            const response = event.data.response;
            if (event.data.action === 'SEARCH_STUDENT' && response?.success) {
                addStatus('Apply sekmesine bağlantı kuruldu, sonuç bekleniyor.', 'info');
            } else if (event.data.action === 'TRANSFER_TO_YOKSIS' && response?.success) {
                currentStudentData = { ...currentStudentData, yoksisReady: Boolean(response.formReady) };
                updateStudentActions(currentStudentData);
                addStatus('YÖKSİS araması başlatıldı; sonuç ekranı hazırlanıyor.', 'success');
            } else if (event.data.action === 'FILL_YOKSIS_FORM' && response?.success) {
                addStatus('YÖKSİS alanları dolduruldu. Göndermeden önce kontrol edin.', 'success');
            } else if (event.data.action === 'COPY_APPLY_DATA') {
                if (response?.success && response.data) {
                    const data = response.data;
                    currentStudentData = { ...currentStudentData, ...data };
                    updateStudentActions(currentStudentData);

                    const lines = [];
                    if (currentStudentData.fullName) lines.push(`Öğrenci: ${currentStudentData.fullName}`);
                    if (data.pasaportNo) lines.push(`Pasaport No: ${data.pasaportNo}`);
                    if (data.anneAdi) lines.push(`Anne Adı: ${data.anneAdi}`);
                    if (data.babaAdi) lines.push(`Baba Adı: ${data.babaAdi}`);
                    if (data.uyruk) lines.push(`Uyruk: ${data.uyruk}`);
                    if (data.dogumUlkesi) lines.push(`Doğum Yeri/Ülkesi: ${data.dogumUlkesi}`);
                    if (data.cinsiyet) lines.push(`Cinsiyet: ${data.cinsiyet}`);

                    const copyText = lines.join('\n');
                    copyTextToClipboard(copyText);

                    const details = [
                        data.anneAdi ? `Anne: ${data.anneAdi}` : null,
                        data.babaAdi ? `Baba: ${data.babaAdi}` : null,
                        data.uyruk ? `Uyruk: ${data.uyruk}` : null,
                        data.cinsiyet ? `Cinsiyet: ${data.cinsiyet}` : null
                    ].filter(Boolean).join(', ');

                    addStatus(`Bilgiler başarıyla kopyalandı (${details || 'Tüm alanlar'}).`, 'success');
                    showToast('Öğrenci bilgileri kopyalandı ve YÖKSİS için hazırlandı.', 'success');
                } else {
                    addStatus(response?.error || 'Öğrenci bilgileri kopyalanamadı.', 'error');
                }
            } else if (event.data.action === 'EXTRACT_KABUL_CODE') {
                if (response?.success) {
                    const validCode = isValidYoksisId(response.kabulId) ? response.kabulId : '';
                    if (validCode) {
                        currentStudentData = { ...currentStudentData, yoksisId: validCode };
                        copyTextToClipboard(validCode);
                        updateStudentActions(currentStudentData);
                        addStatus(`Kabul mektubu kodu bulundu ve panoya kopyalandı: ${validCode}`, 'success');
                        showToast(`Kabul Kodu: ${validCode}`, 'success');
                    } else if (response.acceptanceLetterUrl) {
                        currentStudentData = { ...currentStudentData, acceptanceLetterUrl: response.acceptanceLetterUrl };
                        addStatus('Kabul mektubu bağlantısı bulundu, PDF okunuyor...', 'info');
                        requestApplyDocument('acceptanceLetter', response.acceptanceLetterUrl);
                    } else {
                        addStatus('Kabul mektubu belgesi veya kodu bulunamadı.', 'error');
                        showToast('Kabul mektubu belgesi bulunamadı.', 'error');
                    }
                } else {
                    addStatus(response?.error || 'Kabul mektubu sorgulanamadı.', 'error');
                }
            } else if (response?.error) {
                clearSearchTimeout();
                if (event.data.action === 'SEARCH_STUDENT') studentName.textContent = 'Arama başlatılamadı';
                addStatus(response.error, 'error');
            }
            return;
        }

        if (event.data.type === 'EVENT' && event.data.action === 'DOCUMENT_BYTES_READY') {
            void handleDocumentBytesReady(event.data.data);
            return;
        }

        if (event.data.type === 'EVENT' && event.data.action === 'DOCUMENT_READ_FAILED') {
            const documentKind = event.data.data?.documentKind;
            if (documentKind) pendingDocumentReads.delete(documentKind);
            addStatus(event.data.error || 'Belge okunamadı.', 'error');
            return;
        }

        if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_FOUND') {
            clearSearchTimeout();
            const incoming = event.data.data || {};
            const rawId = incoming.yoksisId || incoming.kabulId || '';
            const safeYoksisId = isValidYoksisId(rawId) ? rawId : '';
            currentStudentData = {
                ...incoming,
                yoksisId: safeYoksisId
            };
            studentName.textContent = currentStudentData.fullName || "İsim Bulunamadı";
            updateStudentActions(currentStudentData);
            addStatus('Öğrenci bulundu. Bilgileri veya kabul kodunu kopyalayabilirsiniz.', 'success');
        }
        else if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_DOCUMENTS_FOUND') {
            clearSearchTimeout();
            const incoming = event.data.data || {};
            const rawId = incoming.yoksisId || incoming.kabulId || '';
            const safeYoksisId = isValidYoksisId(rawId) ? rawId : (isValidYoksisId(currentStudentData?.yoksisId) ? currentStudentData.yoksisId : '');
            currentStudentData = {
                ...currentStudentData,
                ...incoming,
                yoksisId: safeYoksisId,
                documentsReady: true
            };
            updateStudentActions(currentStudentData);
            if (currentStudentData.yoksisId) {
                addStatus(`Kabul mektubu kodu algılandı: ${currentStudentData.yoksisId}`, 'success');
            } else if (currentStudentData.acceptanceLetterUrl) {
                addStatus('Kabul mektubu bağlantısı hazır.', 'success');
            } else {
                addStatus('Profil verileri hazır.', 'success');
            }
        }
        else if (event.data.type === 'EVENT' && event.data.action === 'DOCUMENTS_NOT_FOUND') {
            clearSearchTimeout();
            addStatus(event.data.error || 'Profil belgeleri bulunamadı.', 'error');
        }
        else if (event.data.type === 'EVENT' && (
            event.data.action === 'STUDENT_NOT_FOUND' ||
            event.data.action === 'REQUEST_FAILED'
        )) {
            clearSearchTimeout();
            studentName.textContent = "Bulunamadı";
            const errorMsg = event.data.error ? 'Hata: ' + event.data.error : 'Apply Topkapı üzerinde öğrenci bulunamadı.';
            addStatus(errorMsg, 'error');
        }
    });
}
