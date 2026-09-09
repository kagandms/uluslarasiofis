import { showToast } from '../ui/toastManager.js';
import {
    extractPassportDatesFromText,
    extractYoksisIdFromText,
    isValidYoksisId,
    parseDateValue,
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority
} from '../utils/ykn-document-parser.js';
import {
    initPassportCropperModal,
    openPassportCropper,
    isPassportCropperOpen,
    appendPassportPages
} from '../ui/passportCropperModal.js';

function scorePassportPageText(text, studentName = '', passportNo = '') {
    if (!text || typeof text !== 'string') return 0;
    let score = 0;
    const upperText = text.toUpperCase();

    // 1. MRZ (Machine Readable Zone) indicators - massive signal for biodata page
    if (upperText.includes('P<') || /P[A-Z0-9<]{5,}/.test(upperText) || upperText.includes('<<<')) {
        score += 100;
    }

    // 2. Passport identification words
    if (upperText.includes('PASSPORT') || upperText.includes('PASSEPORT') || upperText.includes('PASAPORTE') || upperText.includes('PASAPORT')) {
        score += 30;
    }

    // 3. Student Passport Number Match
    if (passportNo) {
        const cleanNo = passportNo.replace(/\s+/g, '').toUpperCase();
        if (cleanNo.length >= 5 && upperText.replace(/\s+/g, '').includes(cleanNo)) {
            score += 50;
        }
    }

    // 4. Student Name Token Match
    if (studentName) {
        const nameTokens = studentName.toUpperCase().split(/\s+/).filter(t => t.length >= 3);
        let matchedTokens = 0;
        for (const token of nameTokens) {
            if (upperText.includes(token)) matchedTokens++;
        }
        if (matchedTokens > 0) {
            score += Math.min(40, matchedTokens * 15);
        }
    }

    // 5. Passport field labels (Dates, Birth, Authority)
    if (upperText.includes('DATE OF BIRTH') || upperText.includes('DATE DE NAISSANCE') || upperText.includes('DOĞUM TARİHİ')) {
        score += 25;
    }
    if (upperText.includes('DATE OF EXPIRY') || upperText.includes('EXPIRATION') || upperText.includes('VALID UNTIL') || upperText.includes('GEÇERLİLİK')) {
        score += 25;
    }
    if (upperText.includes('DATE OF ISSUE') || upperText.includes('DÜZENLEME TARİHİ') || upperText.includes('ISSUED')) {
        score += 20;
    }
    if (upperText.includes('PLACE OF BIRTH') || upperText.includes('LIEU DE NAISSANCE') || upperText.includes('DOĞUM YERİ')) {
        score += 20;
    }
    if (upperText.includes('AUTHORITY') || upperText.includes('AUTORITÉ') || upperText.includes('VEREN MAKAM')) {
        score += 20;
    }

    return score;
}

async function imageToCanvas(imgSrc) {
    if (!imgSrc) return null;
    const image = new Image();
    image.src = imgSrc;
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Görsel yüklenemedi'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
}

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
    const btnCropPhoto = document.getElementById('btn-ykn-crop-photo');
    const btnTransferYoksis = document.getElementById('btn-ykn-transfer-yoksis');
    const btnPasteYoksis = document.getElementById('btn-ykn-paste-yoksis');
    const extensionStatus = document.getElementById('ykn-extension-status');
    const extensionStatusTitle = document.getElementById('ykn-extension-status-title');
    const extensionStatusMessage = document.getElementById('ykn-extension-status-message');
    const btnExtensionDownload = document.getElementById('btn-ykn-extension-download');
    const btnExtensionRecheck = document.getElementById('btn-ykn-extension-recheck');
    const inputIssueDate = document.getElementById('ykn-issue-date');
    const inputExpiryDate = document.getElementById('ykn-expiry-date');
    const inputBirthPlace = document.getElementById('ykn-birth-place');
    const inputIssuingAuthority = document.getElementById('ykn-issuing-authority');

    try {
        initPassportCropperModal();
    } catch (err) {
        console.error('[YKN] initPassportCropperModal hatası:', err);
    }

    function formatDateForDisplay(isoDate) {
        if (!isoDate || typeof isoDate !== 'string') return '';
        const parts = isoDate.split('-');
        if (parts.length === 3) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        return isoDate;
    }

    function syncUserEnteredPassportDates() {
        if (!currentStudentData) return;
        if (inputIssueDate && inputIssueDate.value.trim()) {
            const parsed = parseDateValue(inputIssueDate.value.trim());
            currentStudentData.issueDate = parsed || inputIssueDate.value.trim();
        }
        if (inputExpiryDate && inputExpiryDate.value.trim()) {
            const parsed = parseDateValue(inputExpiryDate.value.trim());
            currentStudentData.expiryDate = parsed || inputExpiryDate.value.trim();
        }
        if (inputBirthPlace && inputBirthPlace.value.trim()) {
            const bp = inputBirthPlace.value.trim().toUpperCase();
            currentStudentData.birthPlace = bp;
            currentStudentData.dogumYeri = bp;
            currentStudentData.dogumYeriAciklamasi = bp;
        }
        if (inputIssuingAuthority && inputIssuingAuthority.value.trim()) {
            const auth = inputIssuingAuthority.value.trim().toUpperCase();
            currentStudentData.issuingAuthority = auth;
            currentStudentData.verenMakam = auth;
        }
    }

    function applyCountryDefaultsToStudent(student) {
        if (!student) return;
        const str = `${student.uyruk || ''} ${student.dogumUlkesi || ''}`.toUpperCase();
        const isTurkmen = str.includes('TÜRKMEN') || str.includes('TURKMEN') || str.includes('TKM');
        if (isTurkmen) {
            student.dogumYeriAciklamasi = 'TKM';
            student.birthPlace = 'TKM';
            student.dogumYeri = 'TKM';
            if (inputBirthPlace) inputBirthPlace.value = 'TKM';
            if (!student.verenMakam && !student.issuingAuthority) {
                student.verenMakam = 'SMST';
                student.issuingAuthority = 'SMST';
                if (inputIssuingAuthority && !inputIssuingAuthority.value) {
                    inputIssuingAuthority.value = 'SMST';
                }
            }
        }
    }

    function copyStudentInfoToClipboard(student) {
        const data = student || currentStudentData;
        if (!data) return false;

        applyCountryDefaultsToStudent(data);

        const lines = [];
        if (data.fullName) lines.push(`Öğrenci: ${data.fullName}`);
        const passVal = data.pasaportNo || data.passportNo;
        if (passVal) lines.push(`Pasaport No: ${passVal}`);
        if (data.anneAdi) lines.push(`Anne Adı: ${data.anneAdi}`);
        if (data.babaAdi) lines.push(`Baba Adı: ${data.babaAdi}`);
        if (data.uyruk) lines.push(`Uyruk: ${data.uyruk}`);
        const birthPlace = data.dogumYeriAciklamasi || data.birthPlace || data.dogumYeri || data.dogumUlkesi;
        if (birthPlace) lines.push(`Doğum Yeri/Açıklaması: ${birthPlace}`);
        const authority = data.verenMakam || data.issuingAuthority;
        if (authority) lines.push(`Veren Makam: ${authority}`);
        if (data.issueDate) lines.push(`Düzenleme Tarihi: ${formatDateForDisplay(data.issueDate)}`);
        if (data.expiryDate) lines.push(`Geçerlilik Tarihi: ${formatDateForDisplay(data.expiryDate)}`);
        if (data.birthDate) lines.push(`Doğum Tarihi: ${formatDateForDisplay(data.birthDate)}`);
        if (data.cinsiyet) lines.push(`Cinsiyet: ${data.cinsiyet}`);

        const copyText = lines.join('\n');
        copyTextToClipboard(copyText);

        const details = [
            data.anneAdi ? `Anne: ${data.anneAdi}` : null,
            data.babaAdi ? `Baba: ${data.babaAdi}` : null,
            data.uyruk ? `Uyruk: ${data.uyruk}` : null,
            birthPlace ? `D.Yeri: ${birthPlace}` : null,
            authority ? `Makam: ${authority}` : null,
            data.issueDate ? `Düz.T: ${formatDateForDisplay(data.issueDate)}` : null,
            data.expiryDate ? `Geç.T: ${formatDateForDisplay(data.expiryDate)}` : null
        ].filter(Boolean).join(', ');

        addStatus(`Bilgiler başarıyla panoya kopyalandı (${details || 'Tüm alanlar'}).`, 'success');
        showToast('Öğrenci bilgileri panoya kopyalandı ve YÖKSİS için hazırlandı.', 'success');
        return true;
    }

    // UI Status Helper
    function addStatus(message, type = 'info') {
        if (!statusContainer) return;
        const emptyEl = document.getElementById('ykn-status-empty');
        if (emptyEl) emptyEl.style.display = 'none';

        const item = document.createElement('div');
        item.className = `ykn-status-item is-${type}`;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const iconSvg = type === 'success'
            ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--success)" stroke-width="2.5" fill="none" style="flex-shrink:0;margin-top:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg>`
            : (type === 'error'
                ? `<svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--danger)" stroke-width="2.5" fill="none" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                : `<svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--accent)" stroke-width="2.5" fill="none" style="flex-shrink:0;margin-top:2px;"><circle cx="12" cy="12" r="3"></circle></svg>`);

        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 2px;';

        const textSpan = document.createElement('span');
        textSpan.className = 'ykn-status-text';
        textSpan.textContent = message;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'ykn-status-time';
        timeSpan.style.cssText = 'font-size: 0.7rem; opacity: 0.6;';
        timeSpan.textContent = timeStr;

        contentDiv.appendChild(textSpan);
        contentDiv.appendChild(timeSpan);

        item.innerHTML = iconSvg;
        item.appendChild(contentDiv);
        statusContainer.appendChild(item);
        statusContainer.scrollTop = statusContainer.scrollHeight;

        const countBadge = document.getElementById('ykn-status-count');
        if (countBadge) {
            const total = statusContainer.querySelectorAll('.ykn-status-item').length;
            countBadge.textContent = `${total} Adım`;
        }
    }

    function clearStatus() {
        if (!statusContainer) return;
        statusContainer.innerHTML = '';
        const countBadge = document.getElementById('ykn-status-count');
        if (countBadge) countBadge.textContent = 'İşlemde';
    }

    let currentStudentData = null;
    let activeSearchRequestId = null;
    let searchTimeoutTimer = null;
    let extensionBridgeActive = false;
    let extensionCheckRequestId = null;
    let extensionCheckTimeoutTimer = null;
    let shouldOpenCropperWhenReady = false;
    const pendingDocumentReads = new Set();

    function createRequestId() {
        return 'ykn-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }

    function clearExtensionCheckTimeout() {
        if (!extensionCheckTimeoutTimer) return;
        clearTimeout(extensionCheckTimeoutTimer);
        extensionCheckTimeoutTimer = null;
    }

    function showExtensionMissing() {
        if (!extensionStatus) return;
        extensionStatus.hidden = false;
        extensionStatus.classList.add('is-missing');
        extensionStatusTitle.textContent = 'YKN eklentisi kurulu değil';
        extensionStatusMessage.textContent = 'YÖKSİS ve Apply Topkapı aktarımını kullanmak için güncel YKN eklentisini indirip kurun.';
    }

    function markExtensionReady() {
        extensionBridgeActive = true;
        clearExtensionCheckTimeout();
        if (!extensionStatus) return;
        extensionStatus.hidden = true;
        extensionStatus.classList.remove('is-missing');
    }

    function requestExtensionCheck(requestId) {
        clearExtensionCheckTimeout();
        extensionBridgeActive = false;
        extensionCheckRequestId = requestId || createRequestId();
        window.postMessage({
            source: 'WEB_APP',
            payload: {
                action: 'PING',
                requestId: extensionCheckRequestId
            }
        }, '*');
        extensionCheckTimeoutTimer = setTimeout(() => {
            if (!extensionBridgeActive) showExtensionMissing();
        }, 1800);
    }

    function loadExtensionDownloadMetadata() {
        fetch('/downloads/ykn-eklentisi.json', { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) throw new Error('Eklenti sürüm bilgisi alınamadı.');
                return response.json();
            })
            .then((metadata) => {
                if (!metadata || typeof metadata.downloadUrl !== 'string' || !metadata.downloadUrl.startsWith('/downloads/')) {
                    throw new Error('Eklenti indirme bağlantısı geçersiz.');
                }
                const cacheValue = metadata.fingerprint || metadata.version;
                const cacheKey = typeof cacheValue === 'string' ? `?v=${encodeURIComponent(cacheValue)}` : '';
                btnExtensionDownload.href = `${metadata.downloadUrl}${cacheKey}`;
                btnExtensionDownload.download = metadata.fileName || 'ykn-eklentisi.zip';
            })
            .catch(() => {
                btnExtensionDownload.href = '/downloads/ykn-eklentisi-latest.zip';
                btnExtensionDownload.download = 'ykn-eklentisi-latest.zip';
            });
    }

    function setSearchButtonLoading(loading) {
        if (!btnSearch) return;
        btnSearch.disabled = loading;
        if (loading) {
            if (!btnSearch.hasAttribute('data-original-html')) {
                btnSearch.setAttribute('data-original-html', btnSearch.innerHTML);
            }
            btnSearch.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg> Ara`;
        } else {
            const original = btnSearch.getAttribute('data-original-html');
            if (original) {
                btnSearch.innerHTML = original;
                btnSearch.removeAttribute('data-original-html');
            }
        }
    }

    function clearSearchTimeout() {
        if (searchTimeoutTimer) {
            clearTimeout(searchTimeoutTimer);
            searchTimeoutTimer = null;
        }
        setSearchButtonLoading(false);
    }

    let currentWorkflowStep = 1;
    const completedWorkflowSteps = new Set();

    function updateWorkflowUI(targetStep) {
        if (targetStep !== undefined) {
            currentWorkflowStep = targetStep;
        }

        const stepButtons = [
            { el: btnCopyLetter, num: 1 },
            { el: btnTransferYoksis, num: 2 },
            { el: btnCopyInfo, num: 3 },
            { el: btnPasteYoksis, num: 4 }
        ];

        stepButtons.forEach(({ el, num }) => {
            if (!el) return;
            el.classList.remove('is-active', 'is-locked', 'is-completed');

            if (num === currentWorkflowStep) {
                el.classList.add('is-active');
                el.disabled = false;
            } else if (completedWorkflowSteps.has(num)) {
                el.classList.add('is-completed');
                el.disabled = false; // Tamamlanan butonlara tekrar basılabilir
            } else {
                el.classList.add('is-locked');
                el.disabled = false; // Kullanıcı istediği adımı doğrudan tetikleyebilsin
            }
        });

        const stepIndicator = document.getElementById('ykn-step-indicator');
        if (stepIndicator) {
            if (completedWorkflowSteps.size >= 4 || currentWorkflowStep > 4) {
                stepIndicator.textContent = 'Tamamlandı ✔';
                stepIndicator.style.background = 'rgba(40, 167, 69, 0.14)';
                stepIndicator.style.color = 'var(--success)';
            } else {
                stepIndicator.textContent = `Adım ${Math.min(currentWorkflowStep, 4)} / 4`;
                stepIndicator.style.background = 'rgba(139, 0, 0, 0.08)';
                stepIndicator.style.color = 'var(--accent)';
            }
        }
    }

    function resetStudentActions() {
        shouldOpenCropperWhenReady = false;
        pendingDocumentReads.clear();
        completedWorkflowSteps.clear();
        currentWorkflowStep = 1;
        updateWorkflowUI(1);
        if (btnCropPhoto) btnCropPhoto.style.display = 'none';
        if (inputIssueDate) inputIssueDate.value = '';
        if (inputExpiryDate) inputExpiryDate.value = '';
        if (inputBirthPlace) inputBirthPlace.value = '';
        if (inputIssuingAuthority) inputIssuingAuthority.value = '';
    }

    function updateStudentActions(studentData) {
        const hasStudent = Boolean(studentData && (studentData.fullName || studentData.passportNo));
        if (btnCropPhoto) {
            btnCropPhoto.style.display = hasStudent ? 'flex' : 'none';
        }

        // Kabul kodu önceden tespit edildiyse 1. adım tamamlandı kabul edilir ve 2. adıma geçilir
        if (studentData?.yoksisId && isValidYoksisId(studentData.yoksisId)) {
            completedWorkflowSteps.add(1);
            if (currentWorkflowStep <= 1) {
                currentWorkflowStep = 2;
            }
        }
        updateWorkflowUI();
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
        if (documentKind) pendingDocumentReads.delete(documentKind);

        try {
            const pdfOffset = isPdfData(documentBytes);
            const isImage = isImageData(documentBytes, contentType);

            if (documentKind === 'passport') {
                let renderedPages = [];
                let bestPageIndex = 0;

                try {
                    if (pdfOffset >= 0) {
                        const validPdfBytes = pdfOffset > 0 ? documentBytes.subarray(pdfOffset) : documentBytes;
                        ensurePdfWorkerReady();
                        const pdf = await window.pdfjsLib.getDocument({
                            data: validPdfBytes,
                            cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
                            cMapPacked: true
                        }).promise;

                        const totalPdfPages = Math.min(pdf.numPages, 5);
                        let highestScore = -1;

                        for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                            try {
                                const page = await pdf.getPage(pageNum);
                                const viewport = page.getViewport({ scale: 2 });
                                const canvas = document.createElement('canvas');
                                canvas.width = viewport.width;
                                canvas.height = viewport.height;
                                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

                                let pageText = '';
                                try {
                                    const textContent = await page.getTextContent();
                                    pageText = textContent.items.map((item) => item.str).join(' ');
                                } catch (_) {}

                                const score = scorePassportPageText(
                                    pageText,
                                    currentStudentData?.fullName,
                                    currentStudentData?.passportNo || inputPassport?.value.trim()
                                );

                                renderedPages.push({
                                    pageNumber: pageNum,
                                    dataUrl,
                                    text: pageText,
                                    canvas,
                                    score,
                                    label: totalPdfPages > 1 ? `Sayfa ${pageNum}` : ''
                                });

                                if (score > highestScore) {
                                    highestScore = score;
                                    bestPageIndex = renderedPages.length - 1;
                                }
                            } catch (pageErr) {
                                console.warn(`[YKN] PDF Sayfa ${pageNum} render hatası:`, pageErr);
                            }
                        }
                    } else if (isImage) {
                        const blob = new Blob([documentBytes], { type: contentType || 'image/jpeg' });
                        const dataUrl = URL.createObjectURL(blob);
                        renderedPages.push({
                            pageNumber: 1,
                            dataUrl,
                            text: '',
                            canvas: null,
                            score: 0,
                            label: 'Görsel'
                        });
                        bestPageIndex = 0;
                    }
                } catch (imgErr) {
                    console.warn('[YKN] Pasaport belgesi işlenemedi:', imgErr);
                }

                if (renderedPages.length > 0) {
                    const existingPages = currentStudentData?.passportPages || [];
                    const initialTotal = existingPages.length;
                    const adjustedPages = renderedPages.map((p, idx) => ({
                        ...p,
                        pageNumber: initialTotal + idx + 1,
                        label: p.label || (initialTotal > 0 ? `Belge ${initialTotal + idx + 1}` : `Sayfa ${idx + 1}`)
                    }));

                    const allPages = [...existingPages, ...adjustedPages];
                    const selectedPage = renderedPages[bestPageIndex] || renderedPages[0];

                    currentStudentData = {
                        ...currentStudentData,
                        passportPages: allPages,
                        passportImageSrc: selectedPage.dataUrl,
                        bestPassportPageIndex: initialTotal + bestPageIndex
                    };
                    updateStudentActions(currentStudentData);

                    if (isPassportCropperOpen()) {
                        appendPassportPages(adjustedPages);
                    } else if (shouldOpenCropperWhenReady) {
                        openPassportCropper({
                            imageSrc: selectedPage.dataUrl,
                            pages: allPages,
                            initialPageIndex: initialTotal + bestPageIndex,
                            studentName: currentStudentData?.fullName || '',
                            passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || ''
                        });
                        addStatus('Pasaport fotoğraf kırpıcı açıldı.', 'info');
                        shouldOpenCropperWhenReady = false;
                    }
                }

                // Pasaport dijital metin analizi (tüm sayfalardan)
                const fullDigitalText = renderedPages.map(p => p.text).filter(Boolean).join('\n');
                let passportDates = extractPassportDatesFromText(fullDigitalText, { birthDate: currentStudentData?.birthDate });

                if (passportDates.issueDate && !currentStudentData.issueDate) {
                    currentStudentData.issueDate = passportDates.issueDate;
                    if (inputIssueDate) inputIssueDate.value = formatDateForDisplay(passportDates.issueDate);
                }
                if (passportDates.expiryDate && !currentStudentData.expiryDate) {
                    currentStudentData.expiryDate = passportDates.expiryDate;
                    if (inputExpiryDate) inputExpiryDate.value = formatDateForDisplay(passportDates.expiryDate);
                }

                let detectedBirthPlace = extractPassportPlaceOfBirth(fullDigitalText, {
                    uyruk: currentStudentData?.uyruk,
                    dogumUlkesi: currentStudentData?.dogumUlkesi
                });
                let detectedAuthority = extractPassportIssuingAuthority(fullDigitalText);

                // Gerekirse sayfa sayfa hedefli OCR (4 zorunlu alan dolana kadar)
                const hasAllFields = Boolean(
                    currentStudentData.issueDate &&
                    currentStudentData.expiryDate &&
                    (detectedBirthPlace || currentStudentData.birthPlace) &&
                    (detectedAuthority || currentStudentData.issuingAuthority)
                );

                if (!hasAllFields && renderedPages.length > 0) {
                    try {
                        const { runOCR } = await import('../services/ocrService.js');
                        // En yüksek olasılıklı biyometrik sayfayı ilk önce tara, sonra diğer sayfaları
                        const pageIndicesToScan = [
                            bestPageIndex,
                            ...renderedPages.map((_, i) => i).filter(i => i !== bestPageIndex)
                        ];

                        for (const pIdx of pageIndicesToScan) {
                            if (currentStudentData.issueDate && currentStudentData.expiryDate &&
                                (detectedBirthPlace || currentStudentData.birthPlace) &&
                                (detectedAuthority || currentStudentData.issuingAuthority)) {
                                break;
                            }

                            const pageItem = renderedPages[pIdx];
                            let pageCanvas = pageItem.canvas;
                            let temporaryCanvas = false;
                            if (!pageCanvas && pageItem.dataUrl) {
                                try {
                                    pageCanvas = await imageToCanvas(pageItem.dataUrl);
                                    temporaryCanvas = true;
                                } catch (_) {}
                            }
                            if (!pageCanvas) continue;

                            try {
                                const ocrResult = await Promise.race([
                                    runOCR(pageCanvas, true, false, true),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error('Sayfa OCR zaman aşımı')), 8000))
                                ]);

                                const pageOcrText = ocrResult?._rawText || '';
                                if (pageOcrText) {
                                    if (!currentStudentData.issueDate || !currentStudentData.expiryDate) {
                                        const ocrDates = extractPassportDatesFromText(pageOcrText, { birthDate: currentStudentData?.birthDate });
                                        if (ocrDates.issueDate && !currentStudentData.issueDate) {
                                            currentStudentData.issueDate = ocrDates.issueDate;
                                            if (inputIssueDate) inputIssueDate.value = formatDateForDisplay(ocrDates.issueDate);
                                            passportDates.issueDate = ocrDates.issueDate;
                                        }
                                        if (ocrDates.expiryDate && !currentStudentData.expiryDate) {
                                            currentStudentData.expiryDate = ocrDates.expiryDate;
                                            if (inputExpiryDate) inputExpiryDate.value = formatDateForDisplay(ocrDates.expiryDate);
                                            passportDates.expiryDate = ocrDates.expiryDate;
                                        }
                                    }

                                    if (!detectedBirthPlace && !currentStudentData.birthPlace) {
                                        const bp = extractPassportPlaceOfBirth(pageOcrText, {
                                            uyruk: currentStudentData?.uyruk,
                                            dogumUlkesi: currentStudentData?.dogumUlkesi
                                        });
                                        if (bp) detectedBirthPlace = bp;
                                    }

                                    if (!detectedAuthority && !currentStudentData.issuingAuthority) {
                                        const auth = extractPassportIssuingAuthority(pageOcrText);
                                        if (auth) detectedAuthority = auth;
                                    }
                                }
                            } catch (pageOcrErr) {
                                console.warn(`[YKN] Sayfa ${pIdx + 1} OCR atlandı:`, pageOcrErr.message);
                            } finally {
                                if (temporaryCanvas && pageCanvas) {
                                    pageCanvas.width = 0;
                                    pageCanvas.height = 0;
                                }
                            }
                        }
                    } catch (ocrModuleErr) {
                        console.warn('[YKN] OCR servisi başlatılamadı:', ocrModuleErr);
                    } finally {
                        renderedPages.forEach(p => {
                            if (p.canvas) {
                                p.canvas.width = 0;
                                p.canvas.height = 0;
                                p.canvas = null;
                            }
                        });
                    }
                }

                // Pasaport doğum yeri ve veren makam analizi
                if (detectedBirthPlace) {
                    currentStudentData.birthPlace = detectedBirthPlace;
                    currentStudentData.dogumYeri = detectedBirthPlace;
                    currentStudentData.dogumYeriAciklamasi = detectedBirthPlace;
                    if (inputBirthPlace) inputBirthPlace.value = detectedBirthPlace;
                } else if (currentStudentData?.dogumUlkesi && inputBirthPlace && !inputBirthPlace.value) {
                    const fallbackCountry = currentStudentData.dogumUlkesi.toUpperCase();
                    currentStudentData.dogumYeriAciklamasi = fallbackCountry;
                    inputBirthPlace.value = fallbackCountry;
                }

                if (detectedAuthority) {
                    currentStudentData.issuingAuthority = detectedAuthority;
                    currentStudentData.verenMakam = detectedAuthority;
                    if (inputIssuingAuthority) inputIssuingAuthority.value = detectedAuthority;
                }

                // Ülke bazlı özel varsayılanları uygula (örn. Türkmenistan için sabit TKM / SMST)
                applyCountryDefaultsToStudent(currentStudentData);

                // Eksik alan varsa ve incelenebilecek ek pasaport aday belgeleri varsa diğer belgeyi iste
                const fieldsComplete = Boolean(
                    currentStudentData.issueDate &&
                    currentStudentData.expiryDate &&
                    (currentStudentData.birthPlace || inputBirthPlace?.value) &&
                    (currentStudentData.issuingAuthority || inputIssuingAuthority?.value)
                );

                const candidates = currentStudentData?.passportCandidates || [];
                const currentIdx = currentStudentData?.currentPassportCandidateIndex || 0;
                const nextIdx = currentIdx + 1;

                if (!fieldsComplete && nextIdx < candidates.length) {
                    currentStudentData.currentPassportCandidateIndex = nextIdx;
                    const nextUrl = candidates[nextIdx];
                    addStatus(`Pasaport belgesinde eksik alanlar var, ek pasaport dosyası taranıyor (${nextIdx + 1}/${candidates.length})...`, 'info');
                    requestApplyDocument('passport', nextUrl);
                    return;
                }

                const foundItems = [];
                if (currentStudentData.issueDate && currentStudentData.expiryDate) foundItems.push('tarihler');
                else if (currentStudentData.issueDate || currentStudentData.expiryDate) foundItems.push('kısmi tarihler');
                if (currentStudentData.birthPlace || inputBirthPlace?.value) foundItems.push('doğum yeri');
                if (currentStudentData.issuingAuthority || inputIssuingAuthority?.value) foundItems.push('veren makam');

                if (foundItems.length > 0) {
                    addStatus(`Pasaport bilgileri okundu (${foundItems.join(', ')}).`, 'success');
                } else {
                    addStatus('Pasaport bilgileri otomatik okunamadı. Gerekirse kutucuklara yazabilirsiniz.', 'info');
                }

                return;
            }

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
                    const looseCandidates = (text || '').match(/\b[A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4}\s*[-–—]\s*[A-Z0-9]{2,4}\b/gi) || [];
                    for (const candidate of looseCandidates) {
                        const cleaned = candidate.replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
                        if (isValidYoksisId(cleaned)) {
                            yoksisId = cleaned;
                            break;
                        }
                    }
                }

                if (!yoksisId) {
                    const candidates = currentStudentData?.acceptanceCandidates || [];
                    const currentIdx = currentStudentData?.currentCandidateIndex || 0;
                    const nextIdx = currentIdx + 1;
                    if (nextIdx < candidates.length) {
                        currentStudentData.currentCandidateIndex = nextIdx;
                        const nextUrl = candidates[nextIdx];
                        addStatus(`Mevcut belgede YÖKSİS ID bulunamadı, diğer kabul belgesi taranıyor (${nextIdx + 1}/${candidates.length})...`, 'info');
                        requestApplyDocument('acceptanceLetter', nextUrl);
                        return;
                    }

                    console.warn('[YKN] Kabul mektubu içeriğinde YÖKSİS ID bulunamadı. Metin örneği:', (text || '').slice(0, 300));
                    throw new Error('Kabul mektubu PDF belgesinde geçerli YÖKSİS ID bulunamadı.');
                }

                currentStudentData = { ...currentStudentData, yoksisId };
                copyTextToClipboard(yoksisId);
                updateStudentActions(currentStudentData);
                addStatus(`Kabul mektubu YÖKSİS ID bulundu ve kopyalandı: ${yoksisId}`, 'success');
                showToast(`Kabul Kodu kopyalandı: ${yoksisId}`, 'success');
                return;
            }
        } catch (error) {
            addStatus(`${documentKind === 'passport' ? 'Pasaport' : 'Kabul mektubu'} okunamadı: ${error.message}`, 'error');
        } finally {
            pendingDocumentReads.delete(documentKind);
        }
    }

    resetStudentActions();

    if (inputPassport && btnSearch) {
        inputPassport.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                btnSearch.click();
            }
        });
    }

    if (btnSearch) {
        btnSearch.addEventListener('click', () => {
            const passportNo = (inputPassport ? inputPassport.value : '').trim().toUpperCase();
            if (inputPassport) inputPassport.value = passportNo;
            if (!passportNo) {
                showToast('Lütfen pasaport numarası girin.', 'warning');
                if (inputPassport) inputPassport.focus();
                return;
            }
            
            clearStatus();
            clearSearchTimeout();
            setSearchButtonLoading(true);
            currentStudentData = null;
            activeSearchRequestId = createRequestId();
            resetStudentActions();
            studentResult.style.display = 'block';
            studentName.textContent = "Aranıyor... (" + passportNo + ")";
            addStatus('Apply Topkapı eklentisi üzerinden arama başlatıldı...', 'info');
            
            // Arama başlamadan önce eklenti köprüsünün kullanılabilirliğini kontrol et.
            requestExtensionCheck(activeSearchRequestId);

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
                    showExtensionMissing();
                    addStatus('Eklenti köprüsü henüz yanıt vermedi. Lütfen chrome://extensions sekmesinden eklentiyi Yenileyip (↻) bu sayfayı F5 ile tazeleyin.', 'error');
                }
            }, 2500);

            // 14 saniyelik güvenlik zaman aşımı
            searchTimeoutTimer = setTimeout(() => {
                if (studentName.textContent.startsWith('Aranıyor...')) {
                    setSearchButtonLoading(false);
                    studentName.textContent = 'Bağlantı Zaman Aşımı';
                    showExtensionMissing();
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
            if (!completedWorkflowSteps.has(2)) {
                showToast('Lütfen önce 2. Adımı (Kabul Kodunu YÖKSİS\'e Aktar) başarıyla tamamlayın.', 'warning');
                addStatus('3. Adıma geçmeden önce 2. Adımın başarıyla tamamlanması gerekmektedir.', 'warning');
                return;
            }

            // 1. Bilgileri hemen panoya kopyala (arka plan sekmelerini beklemeden!)
            copyStudentInfoToClipboard(currentStudentData);

            // 2. 3. Adımı tamamla ve 4. Adımı ("Bilgileri YÖKSİS'e Aktar") anında aktif et
            completedWorkflowSteps.add(3);
            updateWorkflowUI(4);

            // 3. Apply oturumu ile senkronize etmek için eklentiye istek gönder
            shouldOpenCropperWhenReady = true;
            addStatus('Öğrenci bilgileri panoya kopyalandı. YÖKSİS formuna aktarabilirsiniz.', 'success');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'COPY_APPLY_DATA',
                    requestId: activeSearchRequestId
                }
            }, '*');

            // 4. Pasaport görseli zaten hazırsa doğrudan kırpıcıyı aç
            if (currentStudentData?.passportImageSrc) {
                openPassportCropper({
                    imageSrc: currentStudentData.passportImageSrc,
                    pages: currentStudentData.passportPages || [],
                    initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
                    studentName: currentStudentData?.fullName || '',
                    passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || ''
                });
                shouldOpenCropperWhenReady = false;
            } else {
                const passportDocumentUrl = currentStudentData?.passportImageUrl || currentStudentData?.passportDocumentUrl;
                if (passportDocumentUrl) {
                    addStatus('Pasaport belgesi alınıyor ve fotoğraf kırpıcı hazırlanıyor...', 'info');
                    requestApplyDocument('passport', passportDocumentUrl);
                } else {
                    void 'Pasaport belgesi henüz alınmadı.';
                }
            }
        });
    }

    if (btnCropPhoto) {
        btnCropPhoto.addEventListener('click', () => {
            if (!currentStudentData) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }
            shouldOpenCropperWhenReady = true;
            if (currentStudentData.passportImageSrc) {
                openPassportCropper({
                    imageSrc: currentStudentData.passportImageSrc,
                    pages: currentStudentData.passportPages || [],
                    initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
                    studentName: currentStudentData?.fullName || '',
                    passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || ''
                });
                shouldOpenCropperWhenReady = false;
            } else {
                const passportDocumentUrl = currentStudentData?.passportImageUrl || currentStudentData?.passportDocumentUrl;
                if (passportDocumentUrl) {
                    addStatus('Pasaport belgesi indiriliyor...', 'info');
                    requestApplyDocument('passport', passportDocumentUrl);
                } else {
                    window.postMessage({
                        source: 'WEB_APP',
                        payload: {
                            action: 'COPY_APPLY_DATA',
                            requestId: activeSearchRequestId
                        }
                    }, '*');
                    addStatus('Pasaport belgesi taranıyor...', 'info');
                }
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
                completedWorkflowSteps.add(1);
                updateWorkflowUI(2);
                return;
            }

            const candidates = currentStudentData.acceptanceCandidates || (currentStudentData.acceptanceLetterUrl ? [currentStudentData.acceptanceLetterUrl] : []);
            if (candidates.length > 0) {
                currentStudentData.currentCandidateIndex = 0;
                addStatus('Kabul mektubu PDF belgesi Apply oturumundan alınıyor...', 'info');
                requestApplyDocument('acceptanceLetter', candidates[0]);
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

    if (inputIssueDate) {
        inputIssueDate.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputExpiryDate) {
        inputExpiryDate.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputBirthPlace) {
        inputBirthPlace.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputIssuingAuthority) {
        inputIssuingAuthority.addEventListener('input', syncUserEnteredPassportDates);
    }

    window.addEventListener('ykn:photo-cropped', (e) => {
        const { dataUrl, fileName, autoTransfer } = e.detail || {};
        if (!dataUrl) return;

        if (currentStudentData) {
            currentStudentData.croppedPhotoBase64 = dataUrl;
            currentStudentData.photoFileName = fileName;
        }

        window.postMessage({
            source: 'WEB_APP',
            payload: {
                action: 'SAVE_CROPPED_PHOTO',
                photoBase64: dataUrl,
                fileName: fileName,
                requestId: activeSearchRequestId
            }
        }, '*');

        addStatus(`Vesikalık fotoğraf hazırlandı (${fileName}). YÖKSİS'e otomatik yüklenecek.`, 'success');

        if (autoTransfer) {
            if (currentStudentData?.yoksisId && isValidYoksisId(currentStudentData.yoksisId)) {
                if (btnTransferYoksis) {
                    btnTransferYoksis.click();
                }
            } else {
                showToast('Kabul kodu henüz hazır değil. Lütfen önce Kabul Kodunu kopyalayın.', 'warning');
                addStatus('Fotoğraf hazırlandı ancak kabul mektubu kodu eksik. Lütfen önce Kabul Kodunu kopyalayın.', 'info');
            }
        }
    });

    if (btnTransferYoksis) {
        btnTransferYoksis.addEventListener('click', () => {
            if (!currentStudentData || !currentStudentData.yoksisId) {
                showToast('Önce 1. Adımdan Kabul Kodunu kopyalamalısınız.', 'warning');
                return;
            }
            syncUserEnteredPassportDates();
            // DİKKAT: 3. Adım burada AÇILMAZ! Sadece YÖKSİS'ten başarılı aktarım teyidi geldiğinde açılır.
            showToast('Kabul kodu YÖKSİS\'e aktarılıyor, lütfen bekleyin...', 'info');

            if (currentStudentData.croppedPhotoBase64) {
                addStatus('Arka planda YÖKSİS\'e aktarılıyor, form ve vesikalık fotoğraf otomatik yükleniyor...', 'info');
            } else {
                addStatus('Arka planda YÖKSİS\'e aktarılıyor ve arama yapılıyor...', 'info');
            }
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
            if (!completedWorkflowSteps.has(3)) {
                showToast('Lütfen önce 3. Adımı (Bilgileri Kopyala) tamamlayın.', 'warning');
                addStatus('4. Adıma geçmeden önce 3. Adımın (Bilgileri Kopyala) tamamlanması gerekmektedir.', 'warning');
                return;
            }
            syncUserEnteredPassportDates();
            completedWorkflowSteps.add(4);
            updateWorkflowUI(5);

            if (currentStudentData.croppedPhotoBase64) {
                addStatus('Bilgiler ve vesikalık fotoğraf YÖKSİS formuna yapıştırılıyor/yükleniyor...', 'info');
            } else {
                addStatus('Bilgiler YÖKSİS formuna yapıştırılıyor...', 'info');
            }
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

    if (btnExtensionRecheck) {
        btnExtensionRecheck.addEventListener('click', () => {
            extensionStatus.hidden = true;
            requestExtensionCheck(createRequestId());
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'EXTENSION') return;

        if (event.data.type === 'PONG') {
            const pongRequestId = event.data.requestId;
            if (pongRequestId && pongRequestId !== activeSearchRequestId && pongRequestId !== extensionCheckRequestId) return;
            markExtensionReady();
            if (activeSearchRequestId) addStatus('Eklenti köprüsü hazır.', 'info');
            return;
        }

        const requestId = event.data.requestId;
        if (requestId !== activeSearchRequestId) return;

        if (event.data.type === 'RESPONSE') {
            const response = event.data.response;
            if (event.data.action === 'SEARCH_STUDENT' && response?.success) {
                addStatus('Apply sekmesine bağlantı kuruldu, sonuç bekleniyor.', 'info');
            } else if (event.data.action === 'TRANSFER_TO_YOKSIS') {
                if (response?.success) {
                    currentStudentData = { ...currentStudentData, yoksisReady: Boolean(response.formReady) };
                    completedWorkflowSteps.add(2);
                    updateWorkflowUI(3);
                    updateStudentActions(currentStudentData);
                    const hasPhoto = Boolean(currentStudentData?.croppedPhotoBase64);
                    addStatus(`Kabul kodu YÖKSİS'e başarıyla aktarıldı ve arama başlatıldı${hasPhoto ? ' (fotoğraf yüklendi)' : ''}. 3. Adım ("Bilgileri Kopyala") açıldı.`, 'success');
                    showToast(`Kabul mektup kodu başarıyla aktarıldı! (3. Adım açıldı)`, 'success');
                } else {
                    const errMsg = response?.error || response?.message || 'Kabul kodu YÖKSİS\'e aktarılamadı. Lütfen YÖKSİS sekmesinde öğrenci başvuru/kayıt ekranının açık olduğunu kontrol edin.';
                    addStatus(errMsg, 'error');
                    showToast(errMsg, 'error');
                }
            } else if (event.data.action === 'FILL_YOKSIS_FORM' && response?.success) {
                completedWorkflowSteps.add(4);
                updateWorkflowUI(5);
                const hasPhoto = Boolean(currentStudentData?.croppedPhotoBase64);
                addStatus(`YÖKSİS alanları dolduruldu${hasPhoto ? ' ve fotoğraf yüklendi' : ''}. Göndermeden önce kontrol edin.`, 'success');
                showToast(`YÖKSİS alanları dolduruldu${hasPhoto ? ' ve fotoğraf yüklendi' : ''}.`, 'success');
            } else if (event.data.action === 'COPY_APPLY_DATA') {
                if (response?.success && response.data) {
                    const data = response.data;
                    currentStudentData = { ...currentStudentData, ...data };
                    applyCountryDefaultsToStudent(currentStudentData);
                    copyStudentInfoToClipboard(currentStudentData);
                    completedWorkflowSteps.add(3);
                    if (currentWorkflowStep <= 3) updateWorkflowUI(4);

                    // Pasaport kırpıcıyı aç veya belgeyi iste (kullanıcı Bilgileri Kopyala'ya bastığı için)
                    if (!isPassportCropperOpen()) {
                        if (currentStudentData.passportImageSrc) {
                            openPassportCropper({
                                imageSrc: currentStudentData.passportImageSrc,
                                pages: currentStudentData.passportPages || [],
                                initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
                                studentName: currentStudentData?.fullName || '',
                                passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || ''
                            });
                            shouldOpenCropperWhenReady = false;
                        } else {
                            const passUrl = currentStudentData.passportImageUrl || currentStudentData.passportDocumentUrl;
                            if (passUrl) {
                                addStatus('Pasaport belgesi alınıyor ve fotoğraf kırpıcı hazırlanıyor...', 'info');
                                requestApplyDocument('passport', passUrl);
                            }
                        }
                    }
                } else {
                    // Arka plan sekmesinden yanıt gelmese bile mevcut veriler kopyalanmış durumda ve 4. Adım hazır
                    completedWorkflowSteps.add(3);
                    if (currentWorkflowStep <= 3) updateWorkflowUI(4);
                    addStatus('Bilgiler profil verilerinden panoya kopyalandı. 4. Adım (YÖKSİS Aktarımı) hazır.', 'info');
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
                    } else if (response.acceptanceLetterUrl || (response.acceptanceCandidates && response.acceptanceCandidates.length > 0)) {
                        const candidates = response.acceptanceCandidates && response.acceptanceCandidates.length > 0
                            ? response.acceptanceCandidates
                            : [response.acceptanceLetterUrl];
                        currentStudentData = {
                            ...currentStudentData,
                            acceptanceLetterUrl: candidates[0],
                            acceptanceCandidates: candidates,
                            currentCandidateIndex: 0
                        };
                        addStatus('Kabul mektubu bağlantısı bulundu, PDF okunuyor...', 'info');
                        requestApplyDocument('acceptanceLetter', candidates[0]);
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
            const passCandidates = incoming.passportCandidates && incoming.passportCandidates.length > 0
                ? incoming.passportCandidates
                : (incoming.passportDocumentUrl || incoming.passportImageUrl ? [incoming.passportDocumentUrl || incoming.passportImageUrl] : []);
            currentStudentData = {
                ...incoming,
                passportCandidates: passCandidates,
                currentPassportCandidateIndex: 0,
                yoksisId: safeYoksisId
            };
            studentName.textContent = currentStudentData.fullName || "İsim Bulunamadı";
            updateStudentActions(currentStudentData);
            applyCountryDefaultsToStudent(currentStudentData);
            addStatus('Öğrenci bulundu. Bilgileri veya kabul kodunu kopyalayabilirsiniz.', 'success');

            const passUrl = passCandidates[0] || currentStudentData.passportImageUrl || currentStudentData.passportDocumentUrl;
            if (passUrl && !currentStudentData.passportImageSrc) {
                requestApplyDocument('passport', passUrl);
            }
        }
        else if (event.data.type === 'EVENT' && event.data.action === 'STUDENT_DOCUMENTS_FOUND') {
            clearSearchTimeout();
            const incoming = event.data.data || {};
            const rawId = incoming.yoksisId || incoming.kabulId || '';
            const safeYoksisId = isValidYoksisId(rawId) ? rawId : (isValidYoksisId(currentStudentData?.yoksisId) ? currentStudentData.yoksisId : '');
            const candidates = incoming.acceptanceCandidates && incoming.acceptanceCandidates.length > 0
                ? incoming.acceptanceCandidates
                : (incoming.acceptanceLetterUrl ? [incoming.acceptanceLetterUrl] : []);
            const passCandidates = incoming.passportCandidates && incoming.passportCandidates.length > 0
                ? incoming.passportCandidates
                : (incoming.passportDocumentUrl || incoming.passportImageUrl ? [incoming.passportDocumentUrl || incoming.passportImageUrl] : (currentStudentData?.passportCandidates || []));
            currentStudentData = {
                ...currentStudentData,
                ...incoming,
                acceptanceLetterUrl: candidates[0] || incoming.acceptanceLetterUrl || '',
                acceptanceCandidates: candidates,
                currentCandidateIndex: 0,
                passportDocumentUrl: passCandidates[0] || incoming.passportDocumentUrl || incoming.passportImageUrl || '',
                passportCandidates: passCandidates,
                currentPassportCandidateIndex: 0,
                yoksisId: safeYoksisId,
                documentsReady: true
            };
            updateStudentActions(currentStudentData);
            applyCountryDefaultsToStudent(currentStudentData);
            if (currentStudentData.yoksisId) {
                addStatus(`Kabul mektubu kodu algılandı: ${currentStudentData.yoksisId}`, 'success');
            } else if (currentStudentData.acceptanceLetterUrl) {
                addStatus('Kabul mektubu bağlantısı hazır.', 'success');
            } else {
                addStatus('Profil verileri hazır.', 'success');
            }

            const passUrl = passCandidates[0] || currentStudentData.passportImageUrl || currentStudentData.passportDocumentUrl;
            if (passUrl && !currentStudentData.passportImageSrc) {
                requestApplyDocument('passport', passUrl);
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

    try {
        loadExtensionDownloadMetadata();
    } catch (err) {
        console.warn('[YKN] loadExtensionDownloadMetadata hatası:', err);
    }
    try {
        requestExtensionCheck(createRequestId());
    } catch (err) {
        console.warn('[YKN] requestExtensionCheck hatası:', err);
    }
}
