import { showToast } from '../ui/toastManager.js';
import { extractPassportDatesFromText, extractYoksisIdFromText } from '../utils/ykn-document-parser.js';

async function extractPdfText(documentBytes) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil.');
    const pdf = await window.pdfjsLib.getDocument({ data: documentBytes }).promise;
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
    const pdf = await window.pdfjsLib.getDocument({ data: documentBytes }).promise;
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
        const passportDocumentUrl = studentData?.passportImageUrl || studentData?.passportDocumentUrl;
        if (btnCopyInfo) btnCopyInfo.disabled = !passportDocumentUrl;
        if (btnCopyLetter) btnCopyLetter.disabled = !studentData?.acceptanceLetterUrl;
        if (btnPasteYoksis) btnPasteYoksis.disabled = !studentData?.yoksisReady;
        if (btnTransferYoksis) {
            btnTransferYoksis.style.display = studentData?.yoksisId ? 'block' : 'none';
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

    async function handleDocumentBytesReady(documentData) {
        const documentKind = documentData?.documentKind;
        const documentBytes = documentData?.documentBase64
            ? decodeBase64ToBytes(documentData.documentBase64)
            : null;
        const contentType = documentData?.contentType || '';
        if (!documentKind || !documentBytes) return;

        try {
            const isImage = contentType.toLocaleLowerCase('en-US').startsWith('image/');
            let text = isImage ? '' : await extractPdfText(documentBytes);
            if (documentKind === 'acceptanceLetter') {
                let yoksisId = extractYoksisIdFromText(text);
                if (!yoksisId) {
                    text = isImage
                        ? await extractImageTextWithOcr(documentBytes, contentType)
                        : await extractPdfTextWithOcr(documentBytes);
                    yoksisId = extractYoksisIdFromText(text);
                }
                if (!yoksisId) throw new Error('PDF içinde okunabilir YÖKSİS ID bulunamadı.');
                currentStudentData = { ...currentStudentData, yoksisId };
                updateStudentActions(currentStudentData);
                addStatus(`Kabul mektubu YÖKSİS ID bulundu: ${yoksisId}`, 'success');
                return;
            }

            let passportDates = extractPassportDatesFromText(text);
            if (!passportDates.issueDate || !passportDates.expiryDate) {
                text = isImage
                    ? await extractImageTextWithOcr(documentBytes, contentType)
                    : await extractPdfTextWithOcr(documentBytes);
                passportDates = extractPassportDatesFromText(text);
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
            const passportDocumentUrl = currentStudentData?.passportImageUrl || currentStudentData?.passportDocumentUrl;
            if (!passportDocumentUrl) {
                addStatus('Pasaport belgesi henüz alınmadı.', 'error');
                return;
            }

            addStatus('Pasaport belgesi Apply oturumundan alınıyor...', 'info');
            requestApplyDocument('passport', passportDocumentUrl);
        });
    }

    if (btnCopyLetter) {
        btnCopyLetter.addEventListener('click', async () => {
            if (!currentStudentData || !currentStudentData.acceptanceLetterUrl) {
                addStatus('Kabul mektubu PDF bağlantısı bulunamadı!', 'error');
                return;
            }
            addStatus('Kabul mektubu Apply oturumundan alınıyor...', 'info');
            requestApplyDocument('acceptanceLetter', currentStudentData.acceptanceLetterUrl);
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
            currentStudentData = event.data.data;
            studentName.textContent = currentStudentData.fullName || "İsim Bulunamadı";
            updateStudentActions(currentStudentData);
            addStatus('Öğrenci bulundu. Profil belgeleri taranıyor...', 'success');
        }
        else if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_DOCUMENTS_FOUND') {
            clearSearchTimeout();
            currentStudentData = { ...currentStudentData, ...event.data.data, documentsReady: true };
            updateStudentActions(currentStudentData);
            addStatus('Pasaport ve kabul mektubu bağlantıları bulundu.', 'success');
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
