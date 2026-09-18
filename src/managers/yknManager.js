import { showToast } from '../ui/toastManager.js';
import {
    extractPassportDatesFromText,
    extractYoksisIdFromText,
    isValidYoksisId,
    parseDateValue,
    extractPassportPlaceOfBirth,
    extractPassportIssuingAuthority,
    extractPassportGender,
    getCountryIso3Code
} from '../utils/ykn-document-parser.js';
import { selectBestPassportOrientation } from '../utils/passport-orientation.js';
import {
    initPassportCropperModal,
    openPassportCropper,
    isPassportCropperOpen,
    appendPassportPages
} from '../ui/passportCropperModal.js';

const PASSPORT_MAX_PAGES = 5;
const PASSPORT_MAX_OCR_PAGES = 2;
const PASSPORT_ORIENTATION_ANGLES = [0, 90, 180, 270];
const PASSPORT_ORIENTATION_SCORE_THRESHOLD = 45;
const PASSPORT_ORIENTATION_OCR_TIMEOUT_MS = 5_000;
const DOCUMENT_CACHE_MAX_ENTRIES = 8;
const documentBytesCache = new Map();
const documentRequestKeys = new Map();

function getDocumentCacheKey(documentKind, documentUrl) {
    return `${documentKind}:${String(documentUrl || '').trim()}`;
}

function cacheDocumentBytes(key, value) {
    if (!key || !value) return;
    if (documentBytesCache.has(key)) documentBytesCache.delete(key);
    documentBytesCache.set(key, value);
    while (documentBytesCache.size > DOCUMENT_CACHE_MAX_ENTRIES) {
        const oldestKey = documentBytesCache.keys().next().value;
        documentBytesCache.delete(oldestKey);
    }
}

function scorePassportPageText(text, studentName = '', passportNo = '') {
    if (!text || typeof text !== 'string') return 0;
    let score = 0;
    const upperText = text.toUpperCase();

    // 1. MRZ (Machine Readable Zone) indicators - massive signal for biodata page
    if (upperText.includes('P<') || /P[A-Z0-9<]{5,}/.test(upperText) || upperText.includes('<<<')) {
        score += 100;
    }

    // 2. Passport identification words in multiple languages
    if (
        upperText.includes('PASSPORT') ||
        upperText.includes('PASSEPORT') ||
        upperText.includes('PASAPORTE') ||
        upperText.includes('PASAPORT') ||
        upperText.includes('ПАСПОРТ') ||
        upperText.includes('جواز') ||
        upperText.includes('REISEPASS') ||
        upperText.includes('PASSAPORTO')
    ) {
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

    // 5. Passport field labels (Dates, Birth, Authority, Gender) in multiple languages
    if (
        upperText.includes('DATE OF BIRTH') ||
        upperText.includes('DATE DE NAISSANCE') ||
        upperText.includes('DOĞUM TARİHİ') ||
        upperText.includes('ДАТА РОЖДЕНИЯ') ||
        upperText.includes('ДАТА РОЖД') ||
        upperText.includes('تاريخ الميلاد')
    ) {
        score += 25;
    }
    if (
        upperText.includes('DATE OF EXPIRY') ||
        upperText.includes('EXPIRATION') ||
        upperText.includes('VALID UNTIL') ||
        upperText.includes('GEÇERLİLİK') ||
        upperText.includes('СРОК ДЕЙСТВИЯ') ||
        upperText.includes('ДЕЙСТВИТЕЛЕН ДО') ||
        upperText.includes('تاريخ الانتهاء') ||
        upperText.includes('تاريخ الصلاحية') ||
        upperText.includes('MÖHLETI') ||
        upperText.includes('MUDDATI')
    ) {
        score += 25;
    }
    if (
        upperText.includes('DATE OF ISSUE') ||
        upperText.includes('DÜZENLEME TARİHİ') ||
        upperText.includes('ISSUED') ||
        upperText.includes('ДАТА ВЫДАЧИ') ||
        upperText.includes('تاريخ الإصدار') ||
        upperText.includes('تاريخ الاصدار') ||
        upperText.includes('BERILGAN')
    ) {
        score += 20;
    }
    if (
        upperText.includes('PLACE OF BIRTH') ||
        upperText.includes('LIEU DE NAISSANCE') ||
        upperText.includes('DOĞUM YERİ') ||
        upperText.includes('МЕСТО РОЖДЕНИЯ') ||
        upperText.includes('МЕСТО РОЖД') ||
        upperText.includes('ТУҒАН ЖЕРІ') ||
        upperText.includes('ТУҒАН ЖЕР') ||
        upperText.includes('مكان الميلاد') ||
        upperText.includes('محل الميلاد')
    ) {
        score += 20;
    }
    if (
        upperText.includes('AUTHORITY') ||
        upperText.includes('AUTORITÉ') ||
        upperText.includes('VEREN MAKAM') ||
        upperText.includes('ОРГАН ВЫДАЧИ') ||
        upperText.includes('КЕМ ВЫДАН') ||
        upperText.includes('جهة الإصدار') ||
        upperText.includes('جهة الاصدار')
    ) {
        score += 20;
    }
    if (
        upperText.includes('SEX') ||
        upperText.includes('SEXE') ||
        upperText.includes('CİNSİYET') ||
        upperText.includes('CINSIYET') ||
        upperText.includes('ПОЛ') ||
        upperText.includes('الجنس')
    ) {
        score += 15;
    }

    return score;
}

function rotatePassportCanvas(sourceCanvas, rotation) {
    const isQuarterTurn = rotation === 90 || rotation === 270;
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = isQuarterTurn ? sourceCanvas.height : sourceCanvas.width;
    rotatedCanvas.height = isQuarterTurn ? sourceCanvas.width : sourceCanvas.height;
    const context = rotatedCanvas.getContext('2d');
    context.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    return rotatedCanvas;
}

async function readPassportPageWithOrientation(sourceCanvas, options, runOCR) {
    const candidates = [];
    const canvases = new Map([[0, sourceCanvas]]);

    for (const rotation of PASSPORT_ORIENTATION_ANGLES) {
        const canvas = rotation === 0 ? sourceCanvas : rotatePassportCanvas(sourceCanvas, rotation);
        canvases.set(rotation, canvas);
        try {
            const ocrResult = await Promise.race([
                runOCR(canvas, true, false, true),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('Yön OCR zaman aşımı')),
                    PASSPORT_ORIENTATION_OCR_TIMEOUT_MS
                ))
            ]);
            const text = ocrResult?._rawText || '';
            candidates.push({
                rotation,
                score: scorePassportPageText(text, options.studentName, options.passportNo),
                text
            });
        } catch (error) {
            console.warn(`[YKN] Pasaport ${rotation}° OCR atlandı:`, error.message);
            candidates.push({ rotation, score: 0, text: '' });
        }

        const upright = candidates.find((candidate) => candidate.rotation === 0);
        if (rotation === 0 && upright?.score >= PASSPORT_ORIENTATION_SCORE_THRESHOLD) break;
    }

    const best = selectBestPassportOrientation(candidates);
    for (const [rotation, canvas] of canvases) {
        if (rotation !== 0 && rotation !== best.rotation) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
    return { ...best, canvas: canvases.get(best.rotation) || sourceCanvas };
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
    const raw = String(base64 || '').replace(/^data:[^,]+,/, '').trim();
    const binary = window.atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function extractPdfTextWithOcr(documentBytes, maxPages = Infinity) {
    if (!window.pdfjsLib) throw new Error('PDF okuyucu hazır değil.');
    ensurePdfWorkerReady();
    const pdf = await window.pdfjsLib.getDocument({
        data: documentBytes,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
        cMapPacked: true
    }).promise;
    const { runOCR } = await import('../services/ocrService.js');
    const pageTexts = [];

    const pageLimit = Math.min(pdf.numPages, Number.isFinite(maxPages) ? maxPages : pdf.numPages);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        try {
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const ocrData = await runOCR(canvas, true, false, true);
            if (ocrData._rawText) pageTexts.push(ocrData._rawText);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
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
    const studentBadge = document.getElementById('ykn-student-badge');
    const proActions = document.getElementById('ykn-pro-actions') || document.querySelector('.ykn-pro-actions');
    const statusContainer = document.getElementById('ykn-status-container');
    
    const btnReadAcceptance = document.getElementById('btn-read-acceptance');
    const btnCopy = document.getElementById('btn-copy');
    const btnCopyInfo = document.getElementById('btn-ykn-copy-info');
    const btnCopyLetter = document.getElementById('btn-ykn-copy-letter');
    const btnCropPhoto = document.getElementById('btn-ykn-crop-photo');
    const btnTransferYoksis = document.getElementById('btn-ykn-transfer-yoksis');
    const btnPasteYoksis = document.getElementById('btn-ykn-paste-yoksis');
    const btnOneClick = document.getElementById('btn-ykn-one-click');
    const extensionStatus = document.getElementById('ykn-extension-status');
    const extensionStatusTitle = document.getElementById('ykn-extension-status-title');
    const extensionStatusMessage = document.getElementById('ykn-extension-status-message');
    const btnExtensionDownload = document.getElementById('btn-ykn-extension-download');
    const btnExtensionRecheck = document.getElementById('btn-ykn-extension-recheck');
    const inputIssueDate = document.getElementById('ykn-issue-date');
    const inputExpiryDate = document.getElementById('ykn-expiry-date');
    const inputBirthPlace = document.getElementById('ykn-birth-place');
    const inputIssuingAuthority = document.getElementById('ykn-issuing-authority');
    const panelFields = document.getElementById('ykn-fields-panel');
    const badgeMissing = document.getElementById('ykn-missing-badge');
    const alertMissing = document.getElementById('ykn-missing-alert');
    const badgeIssueDate = document.getElementById('badge-issue-date');
    const badgeExpiryDate = document.getElementById('badge-expiry-date');
    const badgeBirthPlace = document.getElementById('badge-birth-place');
    const badgeAuthority = document.getElementById('badge-issuing-authority');
    const inputMotherName = document.getElementById('ykn-mother-name');
    const inputFatherName = document.getElementById('ykn-father-name');
    const inputBirthDate = document.getElementById('ykn-birth-date');
    const btnSyncYoksisFields = document.getElementById('btn-sync-yoksis-fields');

    const btnYknAutoCycle = document.getElementById('btn-ykn-auto-cycle');
    const btnYknDirectQuery = document.getElementById('btn-ykn-direct-query');
    const btnStopYknPolling = document.getElementById('btn-stop-ykn-polling');
    const btnPollNow = document.getElementById('btn-poll-now');
    const btnCopyYkn = document.getElementById('btn-copy-ykn');
    const btnFocusYoksis = document.getElementById('btn-focus-yoksis');
    const yknLiveCard = document.getElementById('ykn-live-card');
    const yknSuccessBox = document.getElementById('ykn-success-box');
    const yknDisplayValue = document.getElementById('ykn-display-value');
    const yknPendingBox = document.getElementById('ykn-pending-box');
    const yknGuidBadge = document.getElementById('ykn-guid-badge');
    const yknCountdown = document.getElementById('ykn-countdown');
    const yknAttemptNum = document.getElementById('ykn-attempt-num');

    try {
        initPassportCropperModal();
    } catch (err) {
        console.error('[YKN] initPassportCropperModal hatası:', err);
    }

    function formatDateForDisplay(isoDate) {
        if (!isoDate || typeof isoDate !== 'string') return '';
        const clean = isoDate.trim();
        const parts = clean.split(/[-/.]/);
        if (parts.length === 3 && parts[0].length === 4) {
            return `${parts[2]}.${parts[1]}.${parts[0]}`;
        }
        return clean;
    }

    function updateMissingFieldsUI() {
        if (!panelFields) return;
        if (!currentStudentData) {
            panelFields.style.display = 'none';
            return;
        }
        panelFields.style.display = 'block';

        const issueVal = (inputIssueDate?.value || currentStudentData.issueDate || '').trim();
        const expiryVal = (inputExpiryDate?.value || currentStudentData.expiryDate || '').trim();
        const bpVal = (inputBirthPlace?.value || currentStudentData.birthPlace || currentStudentData.dogumYeriAciklamasi || currentStudentData.dogumYeri || '').trim();
        const authVal = (inputIssuingAuthority?.value || currentStudentData.issuingAuthority || currentStudentData.verenMakam || '').trim();

        const missing = [];

        function markField(inputEl, badgeEl, val, name) {
            const hasVal = Boolean(val);
            if (inputEl) {
                inputEl.style.borderColor = hasVal ? 'var(--border-color)' : '#f39c12';
                inputEl.style.backgroundColor = hasVal ? 'transparent' : 'rgba(243, 156, 18, 0.05)';
            }
            if (badgeEl) {
                if (hasVal) {
                    badgeEl.textContent = '✓ Dolu';
                    badgeEl.style.color = '#27ae60';
                    badgeEl.style.fontWeight = '600';
                } else {
                    badgeEl.textContent = '⚠️ Eksik';
                    badgeEl.style.color = '#e67e22';
                    badgeEl.style.fontWeight = '700';
                }
            }
            if (!hasVal) missing.push(name);
        }

        markField(inputIssueDate, badgeIssueDate, issueVal, 'Düzenleme Tarihi');
        markField(inputExpiryDate, badgeExpiryDate, expiryVal, 'Geçerlilik Tarihi');
        markField(inputBirthPlace, badgeBirthPlace, bpVal, 'Doğum Yeri');
        markField(inputIssuingAuthority, badgeAuthority, authVal, 'Veren Makam');

        if (badgeMissing) {
            if (missing.length > 0) {
                badgeMissing.textContent = `⚠️ ${missing.length} Eksik Alan`;
                badgeMissing.style.background = 'rgba(231, 76, 60, 0.12)';
                badgeMissing.style.color = '#e74c3c';
            } else {
                badgeMissing.textContent = '✓ Tüm Alanlar Hazır';
                badgeMissing.style.background = 'rgba(39, 174, 96, 0.12)';
                badgeMissing.style.color = '#27ae60';
            }
        }

        if (alertMissing) {
            if (missing.length > 0) {
                alertMissing.style.display = 'block';
                alertMissing.innerHTML = `⚠️ Pasaporttan bazı alanlar okunamadı: <strong>${missing.join(', ')}</strong>. Lütfen kutucuklara yazarak doldurun.`;
            } else {
                alertMissing.style.display = 'none';
            }
        }
    }

    function populateStudentFieldsToInputs(student) {
        if (!student) return;
        if (inputIssueDate && !inputIssueDate.value && student.issueDate) {
            inputIssueDate.value = formatDateForDisplay(student.issueDate);
        }
        if (inputExpiryDate && !inputExpiryDate.value && student.expiryDate) {
            inputExpiryDate.value = formatDateForDisplay(student.expiryDate);
        }
        if (inputBirthPlace && !inputBirthPlace.value && (student.birthPlace || student.dogumYeriAciklamasi || student.dogumYeri)) {
            inputBirthPlace.value = (student.birthPlace || student.dogumYeriAciklamasi || student.dogumYeri).toUpperCase();
        }
        if (inputIssuingAuthority && !inputIssuingAuthority.value && (student.issuingAuthority || student.verenMakam)) {
            inputIssuingAuthority.value = (student.issuingAuthority || student.verenMakam).toUpperCase();
        }
        if (inputMotherName && !inputMotherName.value && student.anneAdi) {
            inputMotherName.value = student.anneAdi;
        }
        if (inputFatherName && !inputFatherName.value && student.babaAdi) {
            inputFatherName.value = student.babaAdi;
        }
        if (inputBirthDate && !inputBirthDate.value && (student.birthDate || student.dogumTarihi)) {
            inputBirthDate.value = formatDateForDisplay(student.birthDate || student.dogumTarihi);
        }
        const medeniStatus = student.medeniHali || student.medeniHal || 'Bekar';
        const medeniBekar = document.getElementById('ykn-medeni-bekar');
        const medeniEvli = document.getElementById('ykn-medeni-evli');
        if (medeniBekar && medeniEvli) {
            if (String(medeniStatus).trim().toLowerCase().startsWith('e')) {
                medeniEvli.checked = true;
            } else {
                medeniBekar.checked = true;
            }
        }
        updateMissingFieldsUI();
    }

    function attachDateInputMask(input) {
        if (!input) return;
        input.addEventListener('input', () => {
            let val = input.value.replace(/[^\d.]/g, '');
            const digits = val.replace(/\./g, '');
            if (digits.length >= 2 && !val.includes('.')) {
                val = digits.slice(0, 2) + '.' + digits.slice(2);
            }
            if (digits.length >= 4) {
                const parts = val.split('.');
                if (parts.length === 2 && parts[1].length >= 2) {
                    val = parts[0] + '.' + parts[1].slice(0, 2) + '.' + (parts[1].slice(2) || '');
                }
            }
            if (val !== input.value) {
                input.value = val.slice(0, 10);
            }
            syncUserEnteredPassportDates();
        });
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
        if (inputMotherName && inputMotherName.value.trim()) {
            currentStudentData.anneAdi = inputMotherName.value.trim().toUpperCase();
        }
        if (inputFatherName && inputFatherName.value.trim()) {
            currentStudentData.babaAdi = inputFatherName.value.trim().toUpperCase();
        }
        if (inputBirthDate && inputBirthDate.value.trim()) {
            const parsed = parseDateValue(inputBirthDate.value.trim());
            currentStudentData.birthDate = parsed || inputBirthDate.value.trim();
            currentStudentData.dogumTarihi = currentStudentData.birthDate;
        }
        const medeniBekar = document.getElementById('ykn-medeni-bekar');
        const medeniEvli = document.getElementById('ykn-medeni-evli');
        if (medeniBekar && medeniEvli) {
            const status = medeniEvli.checked ? 'Evli' : 'Bekar';
            currentStudentData.medeniHali = status;
            currentStudentData.medeniHal = status;
        } else {
            currentStudentData.medeniHali = currentStudentData.medeniHali || 'Bekar';
            currentStudentData.medeniHal = currentStudentData.medeniHali;
        }
        updateMissingFieldsUI();
    }

    function startManualYoksisFillAfterCrop() {
        if (currentStudentData?.yoksisReady !== true) {
            addStatus('Fotoğraf kaydedildi. Her şeyi YÖKSİS’e aktarmak için önce kabul kodunu YÖKSİS’te aratın.', 'warning');
            showToast('Önce kabul kodunu YÖKSİS’te aratın.', 'warning');
            return;
        }

        if (!beginButtonAction('paste-yoksis', btnPasteYoksis, 30_000, () => {
            setWorkflowStepStatus(4, 'error');
            addStatus('YÖKSİS formu doldurma yanıt vermedi. Tekrar deneyebilirsiniz.', 'error');
            showToast('YÖKSİS formu yanıt vermedi.', 'error');
        })) return;

        activeSearchRequestId = createRequestId();
        syncUserEnteredPassportDates();
        addStatus('Fotoğraf onaylandı. Öğrenci bilgileri ve fotoğraf YÖKSİS’e aktarılıyor...', 'info');
        showToast('Tüm bilgiler YÖKSİS’e aktarılıyor...', 'info');

        window.postMessage({
            source: 'WEB_APP',
            payload: {
                action: 'FILL_YOKSIS_FORM',
                data: getYoksisTransportData(currentStudentData),
                requestId: activeSearchRequestId
            }
        }, '*');
    }

    function isTurkmenStudent(student) {
        const nationalityText = `${student?.uyruk || ''} ${student?.dogumUlkesi || ''}`.toUpperCase();
        return nationalityText.includes('TÜRKMEN') || nationalityText.includes('TURKMEN') || nationalityText.includes('TKM');
    }

    function getCountryAuthorityFallback(student) {
        if (isTurkmenStudent(student)) return 'SMST';
        return getCountryIso3Code(student?.uyruk || student?.dogumUlkesi);
    }

    function hasCountryAuthorityFallback(student) {
        const countryCode = getCountryAuthorityFallback(student);
        return Boolean(
            countryCode &&
            student?.issuingAuthority === countryCode &&
            student?.verenMakam === countryCode
        );
    }

    function applyCountryDefaultsToStudent(student) {
        if (!student) return;
        const isTurkmen = isTurkmenStudent(student);
        if (isTurkmen) {
            student.dogumYeriAciklamasi = 'TKM';
            student.birthPlace = 'TKM';
            student.dogumYeri = 'TKM';
            if (inputBirthPlace) inputBirthPlace.value = 'TKM';

            // Türkmenistan pasaportlarında YÖKSİS için veren makam sabit olarak SMST'dir.
            student.verenMakam = 'SMST';
            student.issuingAuthority = 'SMST';
            if (inputIssuingAuthority) inputIssuingAuthority.value = 'SMST';
            return;
        }

        if (!student.verenMakam && !student.issuingAuthority) {
            const countryCode = getCountryIso3Code(student.uyruk || student.dogumUlkesi);
            if (!countryCode) return;
            student.verenMakam = countryCode;
            student.issuingAuthority = countryCode;
        }
        if (inputIssuingAuthority && !inputIssuingAuthority.value && student.issuingAuthority) {
            inputIssuingAuthority.value = student.issuingAuthority;
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
    let lastStatusMsg = '';
    let lastStatusTime = 0;
    function addStatus(message, type = 'info') {
        if (!statusContainer) return;
        const nowMs = Date.now();
        if (message === lastStatusMsg && (nowMs - lastStatusTime) < 1500) {
            return;
        }
        lastStatusMsg = message;
        lastStatusTime = nowMs;

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
    let transferTimeoutTimer = null;
    let pasteTimeoutTimer = null;
    let oneClickTimeoutTimer = null;
    let oneClickWorkflow = null;
    let shouldOpenCropperWhenReady = false;
    const pendingDocumentReads = new Set();
    const processingAcceptanceDocumentKeys = new Set();
    const processedAcceptanceDocumentKeys = new Set();
    const buttonActionTimers = new Map();

    // YKN Talep ve Arka Plan Durum Sorgulama (Polling) State
    let yknPollingActive = false;
    let yknPollingTimer = null;
    let yknCountdownInterval = null;
    let yknAttemptCount = 0;
    let lastFoundYkn = '';

    const ONE_CLICK_STAGE = Object.freeze({
        ACCEPTANCE_READING: 'ACCEPTANCE_READING',
        YOKSIS_SEARCHING: 'YOKSIS_SEARCHING',
        APPLY_DATA_READING: 'APPLY_DATA_READING',
        PASSPORT_READING: 'PASSPORT_READING',
        CROPPER_WAITING: 'CROPPER_WAITING',
        YOKSIS_FILLING: 'YOKSIS_FILLING',
        COMPLETED: 'COMPLETED',
        FAILED: 'FAILED'
    });

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

    function beginButtonAction(key, button, timeoutMs, onTimeout) {
        if (!button || buttonActionTimers.has(key)) return false;
        button.classList.add('is-loading');
        const timer = setTimeout(() => {
            buttonActionTimers.delete(key);
            button.classList.remove('is-loading');
            if (typeof onTimeout === 'function') onTimeout();
            updateWorkflowUI();
        }, timeoutMs);
        buttonActionTimers.set(key, timer);
        updateWorkflowUI();
        return true;
    }

    function finishButtonAction(key) {
        const timer = buttonActionTimers.get(key);
        if (timer) clearTimeout(timer);
        buttonActionTimers.delete(key);
        const buttonByKey = {
            'copy-letter': btnCopyLetter,
            'transfer-yoksis': btnTransferYoksis,
            'copy-info': btnCopyInfo,
            'paste-yoksis': btnPasteYoksis
        };
        const button = buttonByKey[key];
        if (button) button.classList.remove('is-loading');
        updateWorkflowUI();
    }

    function cancelButtonActions() {
        buttonActionTimers.forEach((timer) => clearTimeout(timer));
        buttonActionTimers.clear();
        [btnCopyLetter, btnTransferYoksis, btnCopyInfo, btnPasteYoksis]
            .filter(Boolean)
            .forEach((button) => button.classList.remove('is-loading'));
    }

    let currentWorkflowStep = 1;
    const completedWorkflowSteps = new Set();
    const workflowStepStatuses = new Map();

    function setWorkflowStepStatus(step, status) {
        workflowStepStatuses.set(step, status);
        if (status === 'success' || status === 'success_with_warnings') {
            completedWorkflowSteps.add(step);
        } else if (status === 'idle' || status === 'error' || status === 'partial') {
            completedWorkflowSteps.delete(step);
        }
        updateWorkflowUI();
    }

    function updateWorkflowUI(targetStep) {
        if (targetStep !== undefined) {
            currentWorkflowStep = targetStep;
        }

        // Adım tutarlılık güvencesi:
        // 3. adım (Bilgileri Kopyala) tamamlandıysa ve 4. adım henüz tamamlanmadıysa, aktif adım MUTLAKA 4 olmalıdır.
        // Bu sayede 4. buton asla kilitli (is-locked) görünmez.
        if (completedWorkflowSteps.has(3) && !completedWorkflowSteps.has(4)) {
            currentWorkflowStep = 4;
        } else if (completedWorkflowSteps.has(2) && !completedWorkflowSteps.has(3) && currentWorkflowStep < 3) {
            currentWorkflowStep = 3;
        } else if (completedWorkflowSteps.has(1) && !completedWorkflowSteps.has(2) && currentWorkflowStep < 2) {
            currentWorkflowStep = 2;
        }

        const stepButtons = [
            { el: btnCopyLetter, num: 1 },
            { el: btnTransferYoksis, num: 2 },
            { el: btnCopyInfo, num: 3 },
            { el: btnPasteYoksis, num: 4 }
        ];

        stepButtons.forEach(({ el, num }) => {
            if (!el) return;
            const isLoading = el.classList.contains('is-loading');
            const status = workflowStepStatuses.get(num);
            el.classList.remove('is-active', 'is-available', 'is-completed', 'is-partial', 'is-error');

            if (status === 'error') {
                el.classList.add('is-error');
            } else if (status === 'partial' || status === 'success_with_warnings') {
                el.classList.add('is-partial');
            } else if (completedWorkflowSteps.has(num)) {
                el.classList.add('is-completed');
            } else if (num === currentWorkflowStep) {
                el.classList.add('is-active');
            } else {
                el.classList.add('is-available');
            }

            // Sıra yalnızca görsel bir öneridir. Yalnızca aynı anda çalışan işlem kilitlenir.
            el.disabled = isLoading;
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
        clearOneClickTimeout();
        cancelButtonActions();
        oneClickWorkflow = null;
        if (pasteTimeoutTimer) {
            clearTimeout(pasteTimeoutTimer);
            pasteTimeoutTimer = null;
        }
        if (transferTimeoutTimer) {
            clearTimeout(transferTimeoutTimer);
            transferTimeoutTimer = null;
        }
        if (btnTransferYoksis) btnTransferYoksis.classList.remove('is-loading');
        if (btnPasteYoksis) btnPasteYoksis.classList.remove('is-loading');
        shouldOpenCropperWhenReady = false;
        pendingDocumentReads.clear();
        documentRequestKeys.clear();
        // Belge URL'leri öğrenciler arasında yeniden kullanılabildiği için
        // yeni öğrenci aramasında önceki öğrencinin PDF/HTML içeriğini taşıma.
        documentBytesCache.clear();
        processingAcceptanceDocumentKeys.clear();
        processedAcceptanceDocumentKeys.clear();
        workflowStepStatuses.clear();
        completedWorkflowSteps.clear();
        currentWorkflowStep = 1;
        updateWorkflowUI(1);
        if (proActions) proActions.style.display = 'none';
        if (studentBadge) {
            studentBadge.textContent = 'Profil Bekleniyor';
            studentBadge.style.display = 'none';
        }
        if (btnCropPhoto) btnCropPhoto.style.display = 'none';
        if (inputIssueDate) inputIssueDate.value = '';
        if (inputExpiryDate) inputExpiryDate.value = '';
        if (inputBirthPlace) inputBirthPlace.value = '';
        if (inputIssuingAuthority) inputIssuingAuthority.value = '';
        if (inputMotherName) inputMotherName.value = '';
        if (inputFatherName) inputFatherName.value = '';
        if (inputBirthDate) inputBirthDate.value = '';
        if (panelFields) panelFields.style.display = 'none';
        if (alertMissing) alertMissing.style.display = 'none';
        stopYknPolling();
        lastFoundYkn = '';
        if (yknLiveCard) yknLiveCard.style.display = 'none';
        if (yknSuccessBox) yknSuccessBox.style.display = 'none';
        if (yknPendingBox) yknPendingBox.style.display = 'none';
        if (yknDisplayValue) yknDisplayValue.textContent = '';
        setOneClickButtonMode('ready');
        if (btnOneClick) btnOneClick.style.display = 'none';
    }

    function updateStudentActions(studentData) {
        const hasStudent = Boolean(studentData && (studentData.fullName || studentData.passportNo));
        const documentsReady = Boolean(
            studentData?.documentsReady ||
            (studentData?.yoksisId && isValidYoksisId(studentData.yoksisId))
        );
        if (hasStudent) {
            populateStudentFieldsToInputs(studentData);
        } else if (panelFields) {
            panelFields.style.display = 'none';
        }
        if (proActions) {
            proActions.style.display = hasStudent ? 'flex' : 'none';
        }
        if (btnCropPhoto) {
            btnCropPhoto.style.display = hasStudent ? 'flex' : 'none';
        }
        if (btnOneClick && !oneClickWorkflow) {
            // Öğrenci satırı bulunduğu anda belge paneli henüz yüklenmemiş
            // olabiliyor. Tek Tıkı o aralıkta başlatmak kabul mektubu için
            // rastlantısal "bulunamadı" hatası üretiyordu.
            btnOneClick.style.display = hasStudent && documentsReady ? 'flex' : 'none';
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

    function clearOneClickTimeout() {
        if (!oneClickTimeoutTimer) return;
        clearTimeout(oneClickTimeoutTimer);
        oneClickTimeoutTimer = null;
    }

    function isOneClickActive(stage) {
        return Boolean(
            oneClickWorkflow
            && oneClickWorkflow.status === 'running'
            && (!stage || oneClickWorkflow.stage === stage)
        );
    }

    function setOneClickButtonMode(mode) {
        if (!btnOneClick) return;
        const isLoading = mode === 'loading';
        btnOneClick.disabled = isLoading;
        btnOneClick.classList.toggle('is-loading', isLoading);
        if (isLoading) {
            if (!btnOneClick.hasAttribute('data-original-html')) {
                btnOneClick.setAttribute('data-original-html', btnOneClick.innerHTML);
            }
            btnOneClick.textContent = 'Tek Tık çalışıyor...';
            return;
        }
        const original = btnOneClick.getAttribute('data-original-html');
        if (!original) return;
        btnOneClick.innerHTML = original;
        btnOneClick.removeAttribute('data-original-html');
    }

    function setOneClickStage(stage, message) {
        if (!oneClickWorkflow) return;
        oneClickWorkflow = { ...oneClickWorkflow, stage, status: 'running' };
        if (message) addStatus(message, 'info');
    }

    function armOneClickTimeout(stage, timeoutMs) {
        clearOneClickTimeout();
        oneClickTimeoutTimer = setTimeout(() => {
            if (!isOneClickActive(stage)) return;
            failOneClick('STAGE_TIMEOUT', `${stage} aşaması zamanında tamamlanmadı.`);
        }, timeoutMs);
    }

    // passportPages yalnızca portalın cropper önizlemesi içindir. İçindeki
    // canvas nesnesi structured-clone edilemez; bunu köprüye taşımak Tek Tık
    // akışını kabul kodu bulunduğu anda durduruyordu.
    function getYoksisTransportData(studentData) {
        if (!studentData) return studentData;
        const { passportPages, ...transportData } = studentData;
        return transportData;
    }

    function postOneClickMessage(action, data = {}) {
        const workflowId = oneClickWorkflow?.workflowId;
        if (!workflowId) return;
        const safeData = data.data
            ? { ...data, data: getYoksisTransportData(data.data) }
            : data;
        window.postMessage({
            source: 'WEB_APP',
            payload: { action, ...safeData, workflowId, requestId: workflowId }
        }, '*');
    }

    function failOneClick(errorCode, message) {
        if (!oneClickWorkflow) return;
        clearOneClickTimeout();
        oneClickWorkflow = { ...oneClickWorkflow, status: 'failed', errorCode };
        setOneClickButtonMode('ready');
        addStatus(`Tek Tık başarısız (${errorCode}): ${message}`, 'error');
        showToast(message, 'error');
    }

    function openOneClickCropper() {
        if (!isOneClickActive()) return;
        if (!currentStudentData?.passportImageSrc) {
            failOneClick('PASSPORT_IMAGE_UNAVAILABLE', 'Pasaport fotoğrafı cropper için hazırlanamadı.');
            return;
        }
        clearOneClickTimeout();
        setOneClickStage(ONE_CLICK_STAGE.CROPPER_WAITING, 'Pasaport fotoğrafı hazır. Lütfen fotoğrafı kırpıp aktarımı onaylayın.');
        shouldOpenCropperWhenReady = false;
        if (isPassportCropperOpen()) return;
        openPassportCropper({
            imageSrc: currentStudentData.passportImageSrc,
            pages: currentStudentData.passportPages || [],
            initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
            studentName: currentStudentData.fullName || '',
            passportNo: currentStudentData.passportNo || inputPassport?.value.trim() || '',
            studentData: currentStudentData
        });
    }

    function startOneClickPassportRead() {
        setOneClickStage(ONE_CLICK_STAGE.PASSPORT_READING, 'Öğrenci bilgileri alındı. Pasaport okunuyor...');
        armOneClickTimeout(ONE_CLICK_STAGE.PASSPORT_READING, 30_000);
        if (currentStudentData?.passportImageSrc) {
            openOneClickCropper();
            return;
        }
        const passportUrl = currentStudentData?.passportDocumentUrl
            || currentStudentData?.passportImageUrl
            || currentStudentData?.passportCandidates?.[0];
        if (!passportUrl) {
            failOneClick('PASSPORT_DOCUMENT_NOT_FOUND', 'Apply profilinde pasaport belgesi bulunamadı.');
            return;
        }
        shouldOpenCropperWhenReady = true;
        requestApplyDocument('passport', passportUrl, oneClickWorkflow.workflowId);
    }

    function startOneClickApplyData() {
        setOneClickStage(ONE_CLICK_STAGE.APPLY_DATA_READING, 'YÖKSİS formu aktif. Apply öğrenci bilgileri okunuyor...');
        armOneClickTimeout(ONE_CLICK_STAGE.APPLY_DATA_READING, 20_000);
        postOneClickMessage('COPY_APPLY_DATA');
    }

    function startOneClickYoksisSearch() {
        if (!currentStudentData?.yoksisId || !isValidYoksisId(currentStudentData.yoksisId)) {
            failOneClick('ACCEPTANCE_CODE_INVALID', 'Geçerli kabul mektubu kodu bulunamadı.');
            return;
        }
        setOneClickStage(ONE_CLICK_STAGE.YOKSIS_SEARCHING, 'Kabul kodu hazır. YÖKSİS’te öğrenci aranıyor...');
        // YÖKSİS sekmesi gerekirse Tek Tık tarafından açılır; ZK arama ekranı
        // ilk yüklemede geç geldiği için arka planın doğrulama süresinden önce
        // portalın akışı zaman aşımına uğramamalıdır.
        armOneClickTimeout(ONE_CLICK_STAGE.YOKSIS_SEARCHING, 45_000);
        postOneClickMessage('TRANSFER_TO_YOKSIS', { data: currentStudentData });
    }

    function requestOneClickAcceptanceCode() {
        setOneClickStage(ONE_CLICK_STAGE.ACCEPTANCE_READING, '1/5 Kabul mektubu okunuyor...');
        armOneClickTimeout(ONE_CLICK_STAGE.ACCEPTANCE_READING, 30_000);
        const storedCandidates = currentStudentData?.acceptanceCandidates;
        const candidates = Array.isArray(storedCandidates) && storedCandidates.length > 0
            ? storedCandidates
            : (currentStudentData?.acceptanceLetterUrl ? [currentStudentData.acceptanceLetterUrl] : []);
        if (candidates.length > 0) {
            currentStudentData.currentCandidateIndex = 0;
            requestApplyDocument('acceptanceLetter', candidates[0], oneClickWorkflow.workflowId);
            return;
        }
        if (isValidYoksisId(currentStudentData?.yoksisId)) {
            addStatus('Kabul kodu öğrenci belgeleri sırasında doğrulanmış olarak bulundu.', 'success');
            startOneClickYoksisSearch();
            return;
        }
        postOneClickMessage('EXTRACT_KABUL_CODE');
    }

    function startOneClickWorkflow() {
        if (!currentStudentData) {
            showToast('Lütfen önce bir öğrenci arayın.', 'warning');
            return;
        }
        if (!currentStudentData.documentsReady && !isValidYoksisId(currentStudentData.yoksisId)) {
            showToast('Apply belge paneli henüz hazırlanıyor. Kabul mektubu bağlantısı göründüğünde Tek Tık kullanılabilir.', 'info');
            addStatus('Tek Tık başlatılmadı: Apply belge paneli henüz hazır değil.', 'info');
            return;
        }
        if (isOneClickActive()) return;
        clearOneClickTimeout();
        oneClickWorkflow = {
            workflowId: createRequestId(),
            stage: ONE_CLICK_STAGE.ACCEPTANCE_READING,
            status: 'running',
            passportNo: currentStudentData.passportNo || inputPassport?.value.trim() || ''
        };
        setOneClickButtonMode('loading');
        addStatus('Tek Tık başlatıldı. İşlemler belirlenen sırayla yürütülecek.', 'info');
        requestOneClickAcceptanceCode();
    }

    function completeOneClickPassport() {
        if (!isOneClickActive(ONE_CLICK_STAGE.PASSPORT_READING)) return;
        if (!currentStudentData?.passportImageSrc) {
            failOneClick('PASSPORT_IMAGE_UNAVAILABLE', 'Pasaport görseli cropper için hazırlanamadı.');
            return;
        }
        openOneClickCropper();
    }

    function requestApplyDocument(documentKind, documentUrl, requestId = activeSearchRequestId) {
        const normalizedUrl = String(documentUrl || '').trim();
        if (!normalizedUrl) return;

        const cacheKey = getDocumentCacheKey(documentKind, normalizedUrl);
        const cachedDocument = documentBytesCache.get(cacheKey);
        if (cachedDocument) {
            // Aynı belge daha önce okunduysa eklentiye yeniden gidilmez.
            void handleDocumentBytesReady({ ...cachedDocument, requestId });
            return;
        }

        const pendingKey = documentRequestKeys.get(documentKind);
        if (pendingDocumentReads.has(documentKind)) {
            // Aynı belge zaten isteniyorsa ikinci istek açma; farklı aday için
            // mevcut akışın önceki isteği temizlemesi beklenir.
            if (pendingKey === cacheKey) return;
            return;
        }

        pendingDocumentReads.add(documentKind);
        documentRequestKeys.set(documentKind, cacheKey);
        window.postMessage({
            source: 'WEB_APP',
            payload: {
                action: 'READ_APPLY_DOCUMENT',
                documentKind,
                documentUrl: normalizedUrl,
                requestId
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
        const documentUrl = String(documentData?.documentUrl || '').trim();
        const documentCacheKey = getDocumentCacheKey(documentKind, documentUrl);
        const isAcceptanceDocument = documentKind === 'acceptanceLetter' && Boolean(documentUrl);
        if (isAcceptanceDocument) {
            // Aynı belge bildirimi; özellikle önbellekten dönen belge olayları,
            // kabul kodunu yeniden panoya yazıp Tek Tık aktarımını ikinci kez
            // başlatmamalıdır. İşlem sürerken gelen ikinci bildirimi de ayrıca
            // kilitleyelim; PDF/OCR akışı await içerdiği için bu mümkündür.
            if (
                processingAcceptanceDocumentKeys.has(documentCacheKey) ||
                processedAcceptanceDocumentKeys.has(documentCacheKey)
            ) {
                return;
            }
            processingAcceptanceDocumentKeys.add(documentCacheKey);
        }
        if (documentUrl) {
            cacheDocumentBytes(documentCacheKey, {
                documentKind,
                documentUrl,
                contentType,
                documentBase64: documentData.documentBase64
            });
        }
        if (documentKind) {
            pendingDocumentReads.delete(documentKind);
            if (documentRequestKeys.get(documentKind) === documentCacheKey) {
                documentRequestKeys.delete(documentKind);
            }
        }

        try {
            const pdfOffset = isPdfData(documentBytes);
            const isImage = isImageData(documentBytes, contentType);

            if (documentKind === 'passport') {
                let renderedPages = [];
                let bestPageIndex = 0;
                let pageTextRecords = [];

                try {
                    if (pdfOffset >= 0) {
                        const validPdfBytes = pdfOffset > 0 ? documentBytes.subarray(pdfOffset) : documentBytes;
                        ensurePdfWorkerReady();
                        const pdf = await window.pdfjsLib.getDocument({
                            data: validPdfBytes,
                            cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
                            cMapPacked: true
                        }).promise;

                        // Önce tüm sayfaların metin katmanını oku (hızlıdır, render gerektirmez)
                        const totalPdfPages = Math.min(pdf.numPages, PASSPORT_MAX_PAGES);
                        for (let pageNum = 1; pageNum <= totalPdfPages; pageNum++) {
                            try {
                                const page = await pdf.getPage(pageNum);
                                let pageText = '';
                                try {
                                    const textContent = await page.getTextContent();
                                    pageText = textContent.items.map((item) => item.str).join(' ');
                                } catch (_) {}
                                pageTextRecords.push({
                                    pageNumber: pageNum,
                                    text: pageText,
                                    score: scorePassportPageText(
                                        pageText,
                                        currentStudentData?.fullName,
                                        currentStudentData?.passportNo || inputPassport?.value.trim()
                                    )
                                });
                            } catch (pageErr) {
                                console.warn(`[YKN] PDF Sayfa ${pageNum} metin okuma hatası:`, pageErr);
                            }
                        }

                        const rankedPages = [...pageTextRecords].sort((a, b) => b.score - a.score);
                        const bestPageRecord = rankedPages[0] || pageTextRecords[0] || { pageNumber: 1, text: '', score: 0 };
                        const bestPageNumber = bestPageRecord.pageNumber || 1;

                        // EN ÖNEMLİ OPTİMİZASYON:
                        // Kırpma ekranının beklemeden anında (<0.5s) açılabilmesi için
                        // yalnızca en yüksek puanlı (biyometrik) sayfayı render ediyoruz.
                        try {
                            const bestPdfPage = await pdf.getPage(bestPageNumber);
                            const viewport = bestPdfPage.getViewport({ scale: 1.6 });
                            const canvas = document.createElement('canvas');
                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            await bestPdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

                            renderedPages.push({
                                pageNumber: bestPageNumber,
                                dataUrl,
                                text: bestPageRecord.text,
                                canvas,
                                score: bestPageRecord.score,
                                label: totalPdfPages > 1 ? `Sayfa ${bestPageNumber}` : ''
                            });
                        } catch (pageErr) {
                            console.warn(`[YKN] PDF En iyi sayfa (${bestPageNumber}) render hatası:`, pageErr);
                        }

                        bestPageIndex = 0;

                        // Diğer PDF sayfalarını arka planda render et (cropper modalını bloklamaz)
                        if (totalPdfPages > 1) {
                            (async () => {
                                const remainingRecords = pageTextRecords.filter(p => p.pageNumber !== bestPageNumber);
                                const otherPages = [];
                                for (const pageRecord of remainingRecords) {
                                    try {
                                        const page = await pdf.getPage(pageRecord.pageNumber);
                                        const viewport = page.getViewport({ scale: 1.0 });
                                        const canvas = document.createElement('canvas');
                                        canvas.width = viewport.width;
                                        canvas.height = viewport.height;
                                        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                                        canvas.width = 0;
                                        canvas.height = 0;
                                        otherPages.push({
                                            pageNumber: pageRecord.pageNumber,
                                            dataUrl,
                                            text: pageRecord.text,
                                            score: pageRecord.score,
                                            label: `Sayfa ${pageRecord.pageNumber}`
                                        });
                                    } catch (err) {
                                        console.warn(`[YKN] PDF Sayfa ${pageRecord.pageNumber} arka plan render hatası:`, err);
                                    }
                                }
                                if (otherPages.length > 0) {
                                    if (currentStudentData) {
                                        const currentPages = currentStudentData.passportPages || [];
                                        currentStudentData.passportPages = [...currentPages, ...otherPages];
                                    }
                                    if (isPassportCropperOpen()) {
                                        appendPassportPages(otherPages);
                                    }
                                }
                            })().catch(err => console.warn('[YKN] Arka plan sayfa tamamlama hatası:', err));
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
                        if (isOneClickActive(ONE_CLICK_STAGE.PASSPORT_READING)) {
                            // Belge arka planda okunurken gelen cropper da
                            // Tek Tık akışının bekleme aşamasına geçmeli.
                            // Aksi halde crop tamamlanınca yalnızca kaydedilip
                            // FILL_YOKSIS_FORM hiç gönderilmiyordu.
                            openOneClickCropper();
                        } else {
                            openPassportCropper({
                                imageSrc: selectedPage.dataUrl,
                                pages: allPages,
                                initialPageIndex: initialTotal + bestPageIndex,
                                studentName: currentStudentData?.fullName || '',
                                passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || '',
                                studentData: currentStudentData
                            });
                        }
                        addStatus('Pasaport fotoğraf kırpıcı açıldı.', 'info');
                        shouldOpenCropperWhenReady = false;
                    }
                }

                // Pasaport dijital metin analizi (tüm sayfalardan derhal okunur)
                const fullDigitalText = (pageTextRecords && pageTextRecords.length > 0)
                    ? pageTextRecords.map(p => p.text).filter(Boolean).join('\n')
                    : renderedPages.map(p => p.text).filter(Boolean).join('\n');
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
                let detectedAuthority = extractPassportIssuingAuthority(fullDigitalText, {
                    uyruk: currentStudentData?.uyruk,
                    nationality: currentStudentData?.nationality,
                    country: currentStudentData?.country,
                    dogumUlkesi: currentStudentData?.dogumUlkesi
                });
                let detectedGender = extractPassportGender(fullDigitalText);
                if (detectedGender && !currentStudentData.cinsiyet) {
                    currentStudentData.cinsiyet = detectedGender;
                }

                // Pasaport doğum yeri ve veren makam analizi (dijital metinden)
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

                // Pasaportta veren makam etiketi yoksa ülkenin ISO-3 kodunu kullan.
                applyCountryDefaultsToStudent(currentStudentData);

                // Gerekirse arka planda hedefli OCR (4 zorunlu alan dolana kadar, modalı bekletmez)
                const hasAllFields = Boolean(
                    currentStudentData.issueDate &&
                    currentStudentData.expiryDate &&
                    (detectedBirthPlace || currentStudentData.birthPlace) &&
                    (detectedAuthority || currentStudentData.issuingAuthority)
                );

                if (!hasAllFields && renderedPages.length > 0) {
                    const ocrPages = [...renderedPages];
                    (async () => {
                        try {
                            const { runOCR } = await import('../services/ocrService.js');
                            const pageItem = ocrPages[0];
                            let pageCanvas = pageItem?.canvas;
                            let temporaryCanvas = false;
                            if (!pageCanvas && pageItem?.dataUrl) {
                                try {
                                    pageCanvas = await imageToCanvas(pageItem.dataUrl);
                                    temporaryCanvas = true;
                                } catch (_) {}
                            }
                            if (!pageCanvas) return;

                            let orientedCanvas = null;
                            try {
                                const orientation = await readPassportPageWithOrientation(pageCanvas, {
                                    studentName: currentStudentData?.fullName,
                                    passportNo: currentStudentData?.passportNo || inputPassport?.value.trim()
                                }, runOCR);
                                const pageOcrText = orientation.text || '';
                                if (pageOcrText) {
                                    if (!currentStudentData.issueDate || !currentStudentData.expiryDate) {
                                        const ocrDates = extractPassportDatesFromText(pageOcrText, { birthDate: currentStudentData?.birthDate });
                                        if (ocrDates.issueDate && !currentStudentData.issueDate) {
                                            currentStudentData.issueDate = ocrDates.issueDate;
                                            if (inputIssueDate) inputIssueDate.value = formatDateForDisplay(ocrDates.issueDate);
                                        }
                                        if (ocrDates.expiryDate && !currentStudentData.expiryDate) {
                                            currentStudentData.expiryDate = ocrDates.expiryDate;
                                            if (inputExpiryDate) inputExpiryDate.value = formatDateForDisplay(ocrDates.expiryDate);
                                        }
                                    }

                                    if (!detectedBirthPlace && !currentStudentData.birthPlace) {
                                        const bp = extractPassportPlaceOfBirth(pageOcrText, {
                                            uyruk: currentStudentData?.uyruk,
                                            dogumUlkesi: currentStudentData?.dogumUlkesi
                                        });
                                        if (bp) {
                                            detectedBirthPlace = bp;
                                            currentStudentData.birthPlace = bp;
                                            currentStudentData.dogumYeri = bp;
                                            currentStudentData.dogumYeriAciklamasi = bp;
                                            if (inputBirthPlace) inputBirthPlace.value = bp;
                                        }
                                    }

                                    if (!detectedAuthority && (!currentStudentData.issuingAuthority || hasCountryAuthorityFallback(currentStudentData))) {
                                        const auth = extractPassportIssuingAuthority(pageOcrText, {
                                            uyruk: currentStudentData?.uyruk,
                                            nationality: currentStudentData?.nationality,
                                            country: currentStudentData?.country,
                                            dogumUlkesi: currentStudentData?.dogumUlkesi
                                        });
                                        if (auth) {
                                            detectedAuthority = auth;
                                            currentStudentData.issuingAuthority = auth;
                                            currentStudentData.verenMakam = auth;
                                            if (inputIssuingAuthority) inputIssuingAuthority.value = auth;
                                        }
                                    }

                                    if (!currentStudentData.cinsiyet) {
                                        const ocrGender = extractPassportGender(pageOcrText);
                                        if (ocrGender) {
                                            currentStudentData.cinsiyet = ocrGender;
                                        }
                                    }

                                    applyCountryDefaultsToStudent(currentStudentData);

                                    const foundItemsOcr = [];
                                    if (currentStudentData.issueDate && currentStudentData.expiryDate) foundItemsOcr.push('tarihler');
                                    if (currentStudentData.birthPlace || inputBirthPlace?.value) foundItemsOcr.push('doğum yeri');
                                    if (currentStudentData.issuingAuthority || inputIssuingAuthority?.value) foundItemsOcr.push('veren makam');
                                    if (currentStudentData.cinsiyet) foundItemsOcr.push('cinsiyet');
                                    if (foundItemsOcr.length > 0) {
                                        addStatus(`Pasaport ek bilgileri OCR ile okundu (${foundItemsOcr.join(', ')}).`, 'success');
                                    }
                                }
                            } catch (pageOcrErr) {
                                console.warn('[YKN] Arka plan OCR atlandı:', pageOcrErr.message);
                            } finally {
                                if (orientedCanvas && orientedCanvas !== pageCanvas) {
                                    orientedCanvas.width = 0;
                                    orientedCanvas.height = 0;
                                }
                                if (temporaryCanvas && pageCanvas) {
                                    pageCanvas.width = 0;
                                    pageCanvas.height = 0;
                                }
                            }
                        } catch (ocrModuleErr) {
                            console.warn('[YKN] OCR servisi başlatılamadı:', ocrModuleErr);
                        } finally {
                            ocrPages.forEach(p => {
                                if (p.canvas) {
                                    p.canvas.width = 0;
                                    p.canvas.height = 0;
                                    p.canvas = null;
                                }
                            });
                        }
                    })().catch(err => console.warn('[YKN] Arka plan OCR hatası:', err));
                } else {
                    renderedPages.forEach(p => {
                        if (p.canvas) {
                            p.canvas.width = 0;
                            p.canvas.height = 0;
                            p.canvas = null;
                        }
                    });
                }

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

                if (!fieldsComplete && nextIdx < candidates.length && !isPassportCropperOpen()) {
                    renderedPages.forEach((page) => {
                        if (page.canvas) {
                            page.canvas.width = 0;
                            page.canvas.height = 0;
                            page.canvas = null;
                        }
                    });
                    currentStudentData.currentPassportCandidateIndex = nextIdx;
                    const nextUrl = candidates[nextIdx];
                    addStatus(`Pasaport belgesinde eksik alanlar var, ek pasaport dosyası taranıyor (${nextIdx + 1}/${candidates.length})...`, 'info');
                    pendingDocumentReads.delete('passport');
                    documentRequestKeys.delete('passport');
                    requestApplyDocument(
                        'passport',
                        nextUrl,
                        isOneClickActive(ONE_CLICK_STAGE.PASSPORT_READING)
                            ? oneClickWorkflow.workflowId
                            : activeSearchRequestId
                    );
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

                renderedPages.forEach((page) => {
                    if (page.canvas) {
                        page.canvas.width = 0;
                        page.canvas.height = 0;
                        page.canvas = null;
                    }
                });

                completeOneClickPassport();
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
                            documentRequestKeys.delete(documentKind);
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
                        pendingDocumentReads.delete('acceptanceLetter');
                        documentRequestKeys.delete('acceptanceLetter');
                        requestApplyDocument(
                            'acceptanceLetter',
                            nextUrl,
                            isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)
                                ? oneClickWorkflow.workflowId
                                : activeSearchRequestId
                        );
                        return;
                    }

                    console.warn('[YKN] Kabul mektubu içeriğinde YÖKSİS ID bulunamadı. Metin örneği:', (text || '').slice(0, 300));
                    throw new Error('Kabul mektubu PDF belgesinde geçerli YÖKSİS ID bulunamadı.');
                }

                currentStudentData = { ...currentStudentData, yoksisId };
                if (isAcceptanceDocument) {
                    processedAcceptanceDocumentKeys.add(documentCacheKey);
                }
                copyTextToClipboard(yoksisId);
                updateStudentActions(currentStudentData);
                finishButtonAction('copy-letter');
                setWorkflowStepStatus(1, 'success');
                addStatus(`Kabul mektubu YÖKSİS ID bulundu ve kopyalandı: ${yoksisId}`, 'success');
                showToast(`Kabul Kodu kopyalandı: ${yoksisId}`, 'success');
                if (isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)) {
                    startOneClickYoksisSearch();
                }
                return;
            }
        } catch (error) {
            addStatus(`${documentKind === 'passport' ? 'Pasaport' : 'Kabul mektubu'} okunamadı: ${error.message}`, 'error');
            const stage = documentKind === 'passport'
                ? ONE_CLICK_STAGE.PASSPORT_READING
                : ONE_CLICK_STAGE.ACCEPTANCE_READING;
            if (documentKind === 'acceptanceLetter') finishButtonAction('copy-letter');
            if (isOneClickActive(stage)) failOneClick('DOCUMENT_READ_FAILED', error.message);
        } finally {
            if (isAcceptanceDocument) {
                processingAcceptanceDocumentKeys.delete(documentCacheKey);
            }
            pendingDocumentReads.delete(documentKind);
            documentRequestKeys.delete(documentKind);
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

    
    function postExtensionRequest(action, payload = {}, timeoutMs = 35000) {
        return new Promise((resolve) => {
            const requestId = payload.requestId || createRequestId();
            const timer = setTimeout(() => {
                window.removeEventListener('message', handleResponse);
                resolve({ success: false, error: 'Eklentiden yanıt zaman aşımına uğradı. Eklentinin açık ve yetkili sekmede olduğunu kontrol edin.' });
            }, timeoutMs);

            function handleResponse(event) {
                if (event.source !== window || !event.data) return;
                if (event.data.source === 'EXTENSION' && event.data.type === 'RESPONSE' && event.data.requestId === requestId) {
                    clearTimeout(timer);
                    window.removeEventListener('message', handleResponse);
                    resolve(event.data.response || { success: false });
                }
            }

            window.addEventListener('message', handleResponse);
            window.postMessage({
                source: 'WEB_APP',
                payload: { action, requestId, ...payload }
            }, '*');
        });
    }

    if (btnReadAcceptance) {
        btnReadAcceptance.addEventListener('click', async () => {
            btnReadAcceptance.disabled = true;
            btnReadAcceptance.classList.add('is-loading');
            addStatus('Kabul mektubu okunuyor ve YÖKSİS aranıyor...', 'info');

            const requestId = createRequestId('acceptance');
            try {
                const response = await postExtensionRequest('READ_ACCEPTANCE_AND_FILL_YOKSIS', { requestId });
                btnReadAcceptance.disabled = false;
                btnReadAcceptance.classList.remove('is-loading');

                if (!response || !response.success) {
                    const err = response?.error || response?.message || 'Kabul mektubu okunamadı.';
                    addStatus(`Hata: ${err}`, 'error');
                    showToast(`Hata: ${err}`, 'error');
                    return;
                }

                if (response.kabulId) {
                    try { await navigator.clipboard.writeText(response.kabulId); } catch (_) {}
                }
                const filled = response.autoFilled ? ' Bilgiler de YÖKSİS’e dolduruldu.' : '';
                addStatus(`Kabul kodu kopyalandı ve YÖKSİS’te aratıldı: ${response.kabulId || ''}.${filled}`, 'success');
                showToast(`Kabul kodu kopyalandı ve YÖKSİS’te aratıldı!`, 'success');
            } catch (err) {
                btnReadAcceptance.disabled = false;
                btnReadAcceptance.classList.remove('is-loading');
                addStatus(`Hata: ${err.message}`, 'error');
                showToast(`Hata: ${err.message}`, 'error');
            }
        });
    }

    if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
            btnCopy.disabled = true;
            btnCopy.classList.add('is-loading');
            addStatus('Apply bilgileri ve pasaport belgesi hazırlanıyor...', 'info');

            const requestId = createRequestId('student');
            try {
                const response = await postExtensionRequest('COPY_APPLY_DATA_AND_FILL_YOKSIS', { requestId, fromPortal: true });
                btnCopy.disabled = false;
                btnCopy.classList.remove('is-loading');

                if (!response || !response.success) {
                    const err = response?.error || response?.message || 'Bilgiler kopyalanamadı.';
                    addStatus(`Hata: ${err}`, 'error');
                    showToast(`Hata: ${err}`, 'error');
                    return;
                }

                if (!response.cropperOpened && response.manualPhotoRequired) {
                    const msg = response.autoFilled
                        ? 'Pasaport bulunamadı; diğer bilgiler YÖKSİS’e aktarıldı. Fotoğrafı YÖKSİS’te elle yükleyin.'
                        : (response.message || 'Pasaport bulunamadı. Bilgiler hazırlandı; fotoğrafı YÖKSİS’te elle yükleyin.');
                    addStatus(msg, response.autoFilled ? 'warning' : 'info');
                    showToast(msg, response.autoFilled ? 'warning' : 'info');
                    return;
                }

                // 1. Öğrenci bilgilerini ve arayüzü güncelle
                if (response.data) {
                    const passCandidates = response.data.passportCandidates && response.data.passportCandidates.length > 0
                        ? response.data.passportCandidates
                        : (response.data.passportDocumentUrl || response.data.passportImageUrl ? [response.data.passportDocumentUrl || response.data.passportImageUrl] : []);
                    currentStudentData = {
                        ...currentStudentData,
                        ...response.data,
                        passportCandidates: passCandidates.length > 0 ? passCandidates : (currentStudentData?.passportCandidates || []),
                        currentPassportCandidateIndex: 0
                    };
                    if (studentName) {
                        studentName.textContent = currentStudentData.fullName || "İsim Bulunamadı";
                    }
                    const studentResult = document.getElementById('ykn-student-result');
                    if (studentResult) studentResult.style.display = 'block';
                    if (studentBadge) {
                        studentBadge.textContent = "Profil Bulundu";
                        studentBadge.style.background = "rgba(39, 174, 96, 0.1)";
                        studentBadge.style.color = "#27ae60";
                        studentBadge.style.display = "inline-block";
                    }
                    if (proActions) proActions.style.display = 'flex';
                    updateStudentActions(currentStudentData);
                    applyCountryDefaultsToStudent(currentStudentData);
                    copyStudentInfoToClipboard(currentStudentData);
                }

                // 2. Pasaport metadata alanlarını forma yansıt
                if (response.passportMetadata) {
                    const meta = response.passportMetadata;
                    if (meta.issueDate && !currentStudentData.issueDate) {
                        currentStudentData.issueDate = meta.issueDate;
                        if (inputIssueDate) inputIssueDate.value = formatDateForDisplay(meta.issueDate);
                    }
                    if (meta.expiryDate && !currentStudentData.expiryDate) {
                        currentStudentData.expiryDate = meta.expiryDate;
                        if (inputExpiryDate) inputExpiryDate.value = formatDateForDisplay(meta.expiryDate);
                    }
                    if (meta.placeOfBirth && !currentStudentData.birthPlace) {
                        currentStudentData.birthPlace = meta.placeOfBirth;
                        if (inputBirthPlace) inputBirthPlace.value = meta.placeOfBirth;
                    }
                    if (meta.issuingAuthority && !currentStudentData.issuingAuthority) {
                        currentStudentData.issuingAuthority = meta.issuingAuthority;
                        if (inputIssuingAuthority) inputIssuingAuthority.value = meta.issuingAuthority;
                    }
                }

                // 3. Pasaport belgelerini sayfadaki modalda aç
                if (response.documents && response.documents.length > 0) {
                    shouldOpenCropperWhenReady = true;
                    addStatus('Pasaport belgesi işleniyor ve kırpma ekranı açılıyor...', 'info');
                    for (const doc of response.documents) {
                        await handleDocumentBytesReady({
                            documentKind: 'passport',
                            documentUrl: doc.url,
                            contentType: doc.contentType,
                            documentBase64: doc.documentBase64
                        });
                    }
                    const missing = response.passportMetadata?.missingFields || [];
                    const warning = missing.length > 0 ? ` Bazı pasaport alanları okunamadı: ${missing.join(', ')}.` : '';
                    addStatus(`Pasaport fotoğrafı kırpma ekranı açıldı.${warning}`, missing.length > 0 ? 'warning' : 'success');
                    showToast('Pasaport fotoğrafı kırpma ekranı açıldı.', 'success');
                } else if (currentStudentData?.passportImageSrc) {
                    openPassportCropper({
                        imageSrc: currentStudentData.passportImageSrc,
                        pages: currentStudentData.passportPages || [],
                        initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
                        studentName: currentStudentData.fullName || '',
                        passportNo: currentStudentData.passportNo || (inputPassport ? inputPassport.value.trim() : ''),
                        studentData: currentStudentData
                    });
                    addStatus('Pasaport fotoğrafı kırpma ekranı açıldı.', 'success');
                    showToast('Pasaport fotoğrafı kırpma ekranı açıldı.', 'success');
                } else {
                    const missing = response.passportMetadata?.missingFields || [];
                    const warning = missing.length > 0 ? ` Bazı pasaport alanları okunamadı: ${missing.join(', ')}.` : '';
                    addStatus(`Pasaport fotoğrafı kırpma ekranı açıldı.${warning}`, missing.length > 0 ? 'warning' : 'success');
                    showToast('Pasaport fotoğrafı kırpma ekranı açıldı.', 'success');
                }
            } catch (err) {
                btnCopy.disabled = false;
                btnCopy.classList.remove('is-loading');
                addStatus(`Hata: ${err.message}`, 'error');
                showToast(`Hata: ${err.message}`, 'error');
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
            if (studentBadge) {
                studentBadge.textContent = "Aranıyor...";
                studentBadge.style.background = "rgba(52, 152, 219, 0.15)";
                studentBadge.style.color = "#2980b9";
                studentBadge.style.display = "inline-block";
            }
            if (proActions) proActions.style.display = 'none';
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
                    if (studentBadge) {
                        studentBadge.textContent = 'Zaman Aşımı';
                        studentBadge.style.background = 'rgba(231, 76, 60, 0.1)';
                        studentBadge.style.color = '#e74c3c';
                        studentBadge.style.display = 'inline-block';
                    }
                    if (proActions) proActions.style.display = 'none';
                    showExtensionMissing();
                    addStatus('Eklentiden veya Apply sekmesinden zamanında yanıt alınamadı.', 'error');
                    addStatus('1. Apply Topkapı sekmesinin açık olduğunu kontrol edin.', 'error');
                    addStatus('2. Apply Topkapı ve bu portal sekmesini yenileyin (F5).', 'error');
                    addStatus('3. Chrome Eklentinizin (YÖKSİS Otomasyonu) açık olduğundan emin olun.', 'error');
                }
            }, 14000);
        });
    }

    if (btnOneClick) {
        btnOneClick.addEventListener('click', startOneClickWorkflow);
    }

    if (btnCopyInfo) {
        btnCopyInfo.addEventListener('click', () => {
            if (!currentStudentData) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }
            if (currentStudentData.yoksisReady !== true) {
                showToast('Önce kabul mektubu ID’sini YÖKSİS’te aratıp öğrenci formunu açın.', 'warning');
                addStatus('Apply bilgileri için önce kabul mektubu ID araması tamamlanmalı.', 'warning');
                return;
            }

            if (!beginButtonAction('copy-info', btnCopyInfo, 20_000, () => {
                setWorkflowStepStatus(3, 'error');
                addStatus('Apply öğrenci bilgileri yanıt vermedi. Tekrar deneyebilirsiniz.', 'error');
                showToast('Apply yanıt vermedi.', 'error');
            })) return;

            if (!activeSearchRequestId) activeSearchRequestId = createRequestId();

            addStatus('Apply profilinden öğrenci bilgileri alınıyor...', 'info');
            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'COPY_APPLY_DATA',
                    requestId: activeSearchRequestId
                }
            }, '*');
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
                    passportNo: currentStudentData?.passportNo || inputPassport?.value.trim() || '',
                    studentData: currentStudentData
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

            if (!currentStudentData.documentsReady && !isValidYoksisId(currentStudentData.yoksisId)) {
                showToast('Apply belge paneli henüz yükleniyor. Kabul mektubu bağlantısı hazır olduğunda tekrar deneyin.', 'info');
                addStatus('Kabul mektubu okunması bekletildi: belge paneli hazır değil.', 'info');
                return;
            }

            if (currentStudentData.yoksisId && isValidYoksisId(currentStudentData.yoksisId)) {
                copyTextToClipboard(currentStudentData.yoksisId);
                addStatus(`Kabul mektubu kodu panoya kopyalandı: ${currentStudentData.yoksisId}`, 'success');
                showToast(`Kabul Kodu kopyalandı: ${currentStudentData.yoksisId}`, 'success');
                setWorkflowStepStatus(1, 'success');
                updateWorkflowUI(2);
                return;
            }

            if (!beginButtonAction('copy-letter', btnCopyLetter, 30_000, () => {
                setWorkflowStepStatus(1, 'error');
                addStatus('Kabul mektubu okunamadı. Tekrar deneyebilirsiniz.', 'error');
                showToast('Kabul mektubu okunamadı.', 'error');
            })) return;

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
        attachDateInputMask(inputIssueDate);
    }
    if (inputExpiryDate) {
        attachDateInputMask(inputExpiryDate);
    }
    if (inputBirthPlace) {
        inputBirthPlace.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputIssuingAuthority) {
        inputIssuingAuthority.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputMotherName) {
        inputMotherName.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputFatherName) {
        inputFatherName.addEventListener('input', syncUserEnteredPassportDates);
    }
    if (inputBirthDate) {
        attachDateInputMask(inputBirthDate);
    }

    if (btnSyncYoksisFields) {
        btnSyncYoksisFields.addEventListener('click', async () => {
            if (!currentStudentData && !inputPassport?.value.trim()) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }
            syncUserEnteredPassportDates();
            btnSyncYoksisFields.disabled = true;
            btnSyncYoksisFields.classList.add('is-loading');
            addStatus('Pasaport ve öğrenci alanları YÖKSİS formuna aktarılıyor...', 'info');
            showToast('Alanlar YÖKSİS’e aktarılıyor...', 'info');

            try {
                const reqId = createRequestId('sync-fields');
                const response = await postExtensionRequest('FILL_YOKSIS_FORM', {
                    data: getYoksisTransportData(currentStudentData),
                    requestId: reqId
                }, 25000);

                btnSyncYoksisFields.disabled = false;
                btnSyncYoksisFields.classList.remove('is-loading');

                if (response?.success) {
                    addStatus('✓ Pasaport ve öğrenci alanları YÖKSİS formunda başarıyla güncellendi.', 'success');
                    showToast('YÖKSİS form alanları güncellendi!', 'success');
                } else {
                    const msg = response?.error || response?.message || 'YÖKSİS formuna aktarılamadı.';
                    addStatus(`YÖKSİS aktarım uyarısı: ${msg}`, 'warning');
                    showToast(msg, 'warning');
                }
            } catch (err) {
                btnSyncYoksisFields.disabled = false;
                btnSyncYoksisFields.classList.remove('is-loading');
                addStatus(`Hata: ${err.message}`, 'error');
                showToast(`Hata: ${err.message}`, 'error');
            }
        });
    }
    const radioMedeniBekar = document.getElementById('ykn-medeni-bekar');
    const radioMedeniEvli = document.getElementById('ykn-medeni-evli');
    if (radioMedeniBekar) {
        radioMedeniBekar.addEventListener('change', () => {
            syncUserEnteredPassportDates();
        });
    }
    if (radioMedeniEvli) {
        radioMedeniEvli.addEventListener('change', () => {
            syncUserEnteredPassportDates();
        });
    }

    window.addEventListener('ykn:photo-cropped', async (e) => {
        const { dataUrl, fileName, autoTransfer, userFields } = e.detail || {};
        if (!dataUrl) return;

        if (currentStudentData) {
            currentStudentData.croppedPhotoBase64 = dataUrl;
            currentStudentData.photoFileName = fileName;
            if (userFields) {
                if (userFields.issueDate) {
                    const parsed = parseDateValue(userFields.issueDate);
                    currentStudentData.issueDate = parsed || userFields.issueDate;
                }
                if (userFields.expiryDate) {
                    const parsed = parseDateValue(userFields.expiryDate);
                    currentStudentData.expiryDate = parsed || userFields.expiryDate;
                }
                if (userFields.issuingAuthority) {
                    currentStudentData.issuingAuthority = userFields.issuingAuthority;
                    currentStudentData.verenMakam = userFields.issuingAuthority;
                }
                if (userFields.medeniHali) {
                    currentStudentData.medeniHali = userFields.medeniHali;
                    currentStudentData.medeniHal = userFields.medeniHali;
                }
            }
        }
        syncUserEnteredPassportDates();
        populateStudentFieldsToInputs(currentStudentData);

        if (isOneClickActive(ONE_CLICK_STAGE.CROPPER_WAITING)) {
            syncUserEnteredPassportDates();
            setOneClickStage(ONE_CLICK_STAGE.YOKSIS_FILLING, 'Fotoğraf onaylandı. Tüm öğrenci bilgileri YÖKSİS’e aktarılıyor...');
            armOneClickTimeout(ONE_CLICK_STAGE.YOKSIS_FILLING, 30_000);
            postOneClickMessage('FILL_YOKSIS_FORM', { data: currentStudentData });
            return;
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

        if (autoTransfer) {
            addStatus('Fotoğraf ve öğrenci bilgileri YÖKSİS’e aktarılıyor...', 'info');
            showToast('Bilgiler ve fotoğraf YÖKSİS’e aktarılıyor...', 'info');
            syncUserEnteredPassportDates();

            const cropRequestId = createRequestId('crop-confirm');
            try {
                const response = await postExtensionRequest('CROPPED_PHOTO_CONFIRMED', {
                    photoBase64: dataUrl,
                    fileName: fileName || 'ogrenci_foto.jpg',
                    requestId: cropRequestId,
                    studentData: getYoksisTransportData(currentStudentData),
                    data: getYoksisTransportData(currentStudentData)
                }, 45000);

                if (response?.success) {
                    if (response.partial) {
                        const unavailable = Array.from(new Set([
                            ...(response.unavailableFields || []),
                            ...(response.missingFields || [])
                        ])).filter(Boolean);
                        const detail = unavailable.length > 0
                            ? ` Eksik kalan alanlar: ${unavailable.join(', ')}.`
                            : ' Bazı alanlar YÖKSİS formunda doğrulanamadı.';
                        addStatus(`Fotoğraf ve bilgiler aktarıldı.${detail} Lütfen YÖKSİS formunda kontrol edin.`, 'warning');
                        showToast(`Fotoğraf aktarıldı.${detail}`, 'warning');
                    } else {
                        addStatus('Fotoğraf ve öğrenci bilgileri başarıyla YÖKSİS’e aktarıldı.', 'success');
                        showToast('Fotoğraf ve bilgiler YÖKSİS’e aktarıldı!', 'success');
                    }
                } else {
                    const err = response?.error || response?.message || 'YÖKSİS aktarımı başarısız oldu.';
                    addStatus(`Hata: ${err}`, 'error');
                    showToast(`Hata: ${err}`, 'error');
                }
            } catch (err) {
                addStatus(`YÖKSİS aktarım hatası: ${err.message}`, 'error');
                showToast(`Hata: ${err.message}`, 'error');
            }
        } else {
            addStatus(`Vesikalık fotoğraf başarıyla kırpıldı ve indirildi (${fileName}).`, 'success');
            showToast(`Fotoğraf indirildi: ${fileName}`, 'success');
        }
    });

    window.addEventListener('ykn:cropper-closed', () => {
        if (isOneClickActive(ONE_CLICK_STAGE.CROPPER_WAITING)) {
            addStatus('Tek Tık beklemede: fotoğrafı kırpmak için mevcut pasaport cropper’ını yeniden açabilirsiniz.', 'warning');
            return;
        }
        // Cropper kapatılması, öğrenci bilgilerinin kopyalandığı anlamına gelmez.
    });

    if (btnTransferYoksis) {
        btnTransferYoksis.addEventListener('click', () => {
            if (!currentStudentData || !isValidYoksisId(currentStudentData.yoksisId)) {
                showToast('Önce 1. Adımdan Kabul Kodunu kopyalamalısınız.', 'warning');
                return;
            }
            if (!beginButtonAction('transfer-yoksis', btnTransferYoksis, 45_000, () => {
                setWorkflowStepStatus(2, 'error');
                addStatus('YÖKSİS araması yanıt vermedi. Tekrar deneyebilirsiniz.', 'error');
                showToast('YÖKSİS yanıt vermedi.', 'error');
            })) return;

            // Manuel her deneme kendi istek kimliğini alır. Böylece önceki
            // yanıt, yeni tıklamanın sonucu gibi işlenemez.
            activeSearchRequestId = createRequestId();
            syncUserEnteredPassportDates();

            showToast('Kabul kodu YÖKSİS\'e aktarılıyor, lütfen bekleyin...', 'info');
            addStatus('Kabul kodu YÖKSİS sekmesinde aranıyor...', 'info');

            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'TRANSFER_TO_YOKSIS',
                    data: getYoksisTransportData(currentStudentData),
                    requestId: activeSearchRequestId
                }
            }, '*');
        });
    }

    if (btnPasteYoksis) {
        btnPasteYoksis.addEventListener('click', () => {
            if (!currentStudentData) {
                showToast('Lütfen önce bir öğrenci arayın.', 'warning');
                return;
            }
            if (currentStudentData.yoksisReady !== true) {
                showToast('Önce kabul kodunu YÖKSİS’te aratıp yeni öğrenci formunun açılmasını bekleyin.', 'warning');
                addStatus('Bilgi aktarımı başlatılmadı: YÖKSİS için doğrulanmış yeni öğrenci formu yok.', 'warning');
                return;
            }
            if (!currentStudentData.croppedPhotoBase64) {
                showToast('Önce pasaport fotoğrafını kırpıp onaylayın.', 'warning');
                addStatus('YÖKSİS’e aktarım bekletildi: pasaport fotoğrafı henüz onaylanmadı.', 'warning');
                return;
            }
            if (!beginButtonAction('paste-yoksis', btnPasteYoksis, 30_000, () => {
                setWorkflowStepStatus(4, 'error');
                addStatus('YÖKSİS formu doldurma yanıt vermedi. Tekrar deneyebilirsiniz.', 'error');
                showToast('YÖKSİS formu yanıt vermedi.', 'error');
            })) return;

            activeSearchRequestId = createRequestId();
            syncUserEnteredPassportDates();

            const hasPhoto = Boolean(currentStudentData.croppedPhotoBase64);
            addStatus(`YÖKSİS sayfasına geçiliyor, bilgiler${hasPhoto ? ' ve vesikalık fotoğraf' : ''} form alanlarına aktarılıyor...`, 'info');
            showToast('YÖKSİS sayfasına geçiliyor...', 'info');

            window.postMessage({
                source: 'WEB_APP',
                payload: {
                    action: 'FILL_YOKSIS_FORM',
                    data: getYoksisTransportData(currentStudentData),
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

    // ==========================================
    // YKN Talep ve Arka Plan Durum Sorgulama (Polling)
    // ==========================================
    function stopYknPolling() {
        yknPollingActive = false;
        if (yknPollingTimer) clearTimeout(yknPollingTimer);
        if (yknCountdownInterval) clearInterval(yknCountdownInterval);
        yknPollingTimer = null;
        yknCountdownInterval = null;
        if (btnYknAutoCycle) {
            btnYknAutoCycle.disabled = false;
            btnYknAutoCycle.classList.remove('is-loading');
        }
        if (btnYknDirectQuery) {
            btnYknDirectQuery.disabled = false;
            btnYknDirectQuery.classList.remove('is-loading');
        }
        if (!lastFoundYkn && yknPendingBox) {
            yknPendingBox.style.display = 'none';
        }
    }

    function showYknSuccess(ykn) {
        stopYknPolling();
        lastFoundYkn = ykn;
        if (currentStudentData) currentStudentData.ykn = ykn;
        if (yknLiveCard) yknLiveCard.style.display = 'block';
        if (yknPendingBox) yknPendingBox.style.display = 'none';
        if (yknSuccessBox) yknSuccessBox.style.display = 'block';
        if (yknDisplayValue) yknDisplayValue.textContent = ykn;
        copyTextToClipboard(ykn);
        addStatus(`✓ YKN Başarıyla Alındı: ${ykn}`, 'success');
        showToast(`YKN Alındı: ${ykn}`, 'success');
    }

    function showYknPending(guid = '') {
        if (yknLiveCard) yknLiveCard.style.display = 'block';
        if (yknSuccessBox) yknSuccessBox.style.display = 'none';
        if (yknPendingBox) yknPendingBox.style.display = 'block';
        if (yknGuidBadge) {
            if (guid) {
                yknGuidBadge.style.display = 'inline-block';
                yknGuidBadge.textContent = `Takip GUID: ${guid}`;
            } else {
                yknGuidBadge.style.display = 'none';
            }
        }
        if (yknAttemptNum) yknAttemptNum.textContent = String(yknAttemptCount);
    }

    function scheduleNextYknPoll(seconds = 15) {
        let remaining = seconds;
        if (yknCountdown) yknCountdown.textContent = String(remaining);
        if (yknCountdownInterval) clearInterval(yknCountdownInterval);
        yknCountdownInterval = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(yknCountdownInterval);
                yknCountdownInterval = null;
            }
            if (yknCountdown) yknCountdown.textContent = String(Math.max(0, remaining));
        }, 1000);

        if (yknPollingTimer) clearTimeout(yknPollingTimer);
        yknPollingTimer = setTimeout(() => {
            if (yknPollingActive) {
                executeYknQueryStep();
            }
        }, seconds * 1000);
    }

    async function executeYknQueryStep() {
        if (!yknPollingActive) return;
        yknAttemptCount++;
        const studentNameVal = currentStudentData?.fullName || (studentName ? studentName.textContent : '') || '';
        const passportVal = currentStudentData?.passportNo || (inputPassport ? inputPassport.value.trim() : '') || '';

        addStatus(`Sorgu #${yknAttemptCount}: YÖKSİS tablosundan durum sorgulanıyor...`, 'info');
        showYknPending();

        try {
            const requestId = createRequestId('ykn-step');
            const response = await postExtensionRequest('YOKSIS_STEP_YKN', {
                studentName: studentNameVal,
                passportNo: passportVal,
                requestId
            }, 25000);

            if (!yknPollingActive) return;

            if (response?.status === 'YKN_READY' && response.ykn) {
                showYknSuccess(response.ykn);
                return;
            }

            if (response?.status === 'TALEP_SENT') {
                addStatus(`YKN Talebi Gönderildi: ${response.message || 'Göç İdaresi tarafından değerlendirilecek.'}`, 'success');
                showToast('YKN Talebi iletildi, durum takip ediliyor...', 'info');
                scheduleNextYknPoll(10);
                return;
            }

            if (response?.status === 'YKN_PENDING') {
                addStatus(`YKN Bekliyor (Deneme #${yknAttemptCount}) - 15 sn sonra tekrar sorgulanacak...`, 'warning');
                showYknPending(response.guid);
                scheduleNextYknPoll(15);
                return;
            }

            if (response?.status === 'STUDENT_ROW_NOT_FOUND') {
                addStatus(response.message || 'Öğrenci YÖKSİS listesinde bulunamadı.', 'error');
                showToast(response.message || 'Öğrenci YÖKSİS listesinde bulunamadı.', 'error');
                stopYknPolling();
                return;
            }

            const msg = response?.message || response?.error || 'Durum kontrol edildi, beklemeye devam ediliyor.';
            addStatus(`Sorgu #${yknAttemptCount}: ${msg}`, 'info');
            if (yknAttemptCount < 30) {
                scheduleNextYknPoll(15);
            } else {
                addStatus('YKN sorgulama deneme sınırına ulaşıldı (30 deneme). İsterseniz tekrar başlatabilirsiniz.', 'warning');
                stopYknPolling();
            }
        } catch (err) {
            if (!yknPollingActive) return;
            addStatus(`Sorgu #${yknAttemptCount} hatası: ${err.message}. 15 sn sonra tekrar denenecek...`, 'error');
            scheduleNextYknPoll(15);
        }
    }

    async function startYknCycleFlow(includeSave = true) {
        if (!currentStudentData && !inputPassport?.value.trim()) {
            showToast('Lütfen önce bir öğrenci arayın.', 'warning');
            return;
        }

        stopYknPolling();
        yknPollingActive = true;
        yknAttemptCount = 0;
        lastFoundYkn = '';

        if (includeSave && btnYknAutoCycle) {
            btnYknAutoCycle.disabled = true;
            btnYknAutoCycle.classList.add('is-loading');
        } else if (btnYknDirectQuery) {
            btnYknDirectQuery.disabled = true;
            btnYknDirectQuery.classList.add('is-loading');
        }

        showYknPending();

        if (includeSave) {
            syncUserEnteredPassportDates();
            if (currentStudentData) {
                try {
                    await postExtensionRequest('FILL_YOKSIS_FORM', {
                        data: getYoksisTransportData(currentStudentData),
                        requestId: createRequestId('presave-sync')
                    }, 8000);
                } catch (_) {}
            }
            addStatus('1/2: YÖKSİS arka planda kaydediliyor...', 'info');
            showToast('YÖKSİS arka planda kaydediliyor...', 'info');
            try {
                const saveReqId = createRequestId('ykn-save');
                const saveRes = await postExtensionRequest('YOKSIS_SAVE_FORM', { requestId: saveReqId }, 15000);
                if (saveRes?.success) {
                    addStatus('YÖKSİS formu kaydedildi. 2/2: Öğrenci seçiliyor ve YKN döngüsü başlatılıyor...', 'success');
                } else {
                    addStatus('Kaydet yanıtı: ' + (saveRes?.message || 'Devam ediliyor...'), 'info');
                }
            } catch (saveErr) {
                addStatus('YÖKSİS kaydet uyarısı: ' + saveErr.message + '. Tablodaki durum kontrol edilecek...', 'warning');
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        executeYknQueryStep();
    }

    if (btnYknAutoCycle) {
        btnYknAutoCycle.addEventListener('click', () => startYknCycleFlow(true));
    }
    if (btnYknDirectQuery) {
        btnYknDirectQuery.addEventListener('click', () => startYknCycleFlow(false));
    }
    if (btnStopYknPolling) {
        btnStopYknPolling.addEventListener('click', () => {
            stopYknPolling();
            addStatus('YKN durum sorgulama döngüsü durduruldu.', 'info');
            showToast('Sorgulama durduruldu.', 'info');
        });
    }
    if (btnPollNow) {
        btnPollNow.addEventListener('click', () => {
            if (yknPollingTimer) clearTimeout(yknPollingTimer);
            if (yknCountdownInterval) clearInterval(yknCountdownInterval);
            executeYknQueryStep();
        });
    }
    if (btnCopyYkn) {
        btnCopyYkn.addEventListener('click', () => {
            if (lastFoundYkn) {
                copyTextToClipboard(lastFoundYkn);
                showToast(`YKN Panoya Kopyalandı: ${lastFoundYkn}`, 'success');
            }
        });
    }
    if (btnFocusYoksis) {
        btnFocusYoksis.addEventListener('click', () => {
            postExtensionRequest('FOCUS_YOKSIS_TAB', { requestId: createRequestId('focus') }, 5000);
        });
    }

    if (window.__YKN_PORTAL_MSG_HANDLER__) {
        window.removeEventListener('message', window.__YKN_PORTAL_MSG_HANDLER__);
    }

    const messageHandler = (event) => {
        if (event.source !== window || !event.data || event.data.source !== 'EXTENSION') return;

        if (event.data.type === 'PONG') {
            const pongRequestId = event.data.requestId;
            if (pongRequestId && pongRequestId !== activeSearchRequestId && pongRequestId !== extensionCheckRequestId) return;
            markExtensionReady();
            if (activeSearchRequestId) addStatus('Eklenti köprüsü hazır.', 'info');
            return;
        }

        const requestId = event.data.requestId;
        const isCurrentWorkflowResponse = requestId
            && oneClickWorkflow
            && requestId === oneClickWorkflow.workflowId;
        if (requestId && activeSearchRequestId && requestId !== activeSearchRequestId && !isCurrentWorkflowResponse) return;

        if (event.data.type === 'RESPONSE') {
            const response = event.data.response;
            if (event.data.action === 'SEARCH_STUDENT' && response?.success) {
                addStatus('Apply sekmesine bağlantı kuruldu, sonuç bekleniyor.', 'info');
            } else if (event.data.action === 'TRANSFER_TO_YOKSIS'
                && isOneClickActive(ONE_CLICK_STAGE.YOKSIS_SEARCHING)) {
                clearOneClickTimeout();
                if (response?.success && response.searchTriggered === true) {
                    const formReady = response.formReady === true;
                    currentStudentData = {
                        ...currentStudentData,
                        // Arama komutu gerçekten gönderildiyse son doldurma
                        // adımı formu YÖKSİS sekmesini öne alarak bekleyebilir.
                        yoksisReady: true,
                        yoksisFormPending: !formReady
                    };
                    setWorkflowStepStatus(2, formReady ? 'success' : 'partial');
                    updateWorkflowUI(3);
                    updateStudentActions(currentStudentData);
                    if (!formReady) {
                        addStatus('Kabul kodu YÖKSİS’te aratıldı. Öğrenci formu yüklenmeye devam ediyor.', 'info');
                    }
                    startOneClickApplyData();
                } else if (response?.success) {
                    failOneClick('YOKSIS_FORM_NOT_READY', 'YÖKSİS araması çalıştı ancak öğrenci bilgi formu aktifleşmedi.');
                } else {
                    failOneClick('YOKSIS_SEARCH_FAILED', response?.error || response?.message || 'YÖKSİS araması başlatılamadı.');
                }
                return;
            } else if (event.data.action === 'COPY_APPLY_DATA'
                && isOneClickActive(ONE_CLICK_STAGE.APPLY_DATA_READING)) {
                clearOneClickTimeout();
                if (response?.success && response.data) {
                    currentStudentData = { ...currentStudentData, ...response.data };
                    applyCountryDefaultsToStudent(currentStudentData);
                    copyStudentInfoToClipboard(currentStudentData);
                    completedWorkflowSteps.add(3);
                    updateWorkflowUI(4);
                    startOneClickPassportRead();
                } else {
                    failOneClick('APPLY_DATA_READ_FAILED', response?.error || response?.message || 'Apply öğrenci bilgileri okunamadı.');
                }
                return;
            } else if (event.data.action === 'FILL_YOKSIS_FORM'
                && isOneClickActive(ONE_CLICK_STAGE.YOKSIS_FILLING)) {
                clearOneClickTimeout();
                const photoRequired = Boolean(currentStudentData?.croppedPhotoBase64);
                const missingFields = Array.isArray(response?.missingFields) ? response.missingFields : [];
                const photoUploadFailed = photoRequired && response?.photoUploaded !== true;
                const isPartial = response?.partial === true || missingFields.length > 0 || photoUploadFailed;
                if (response?.success && !isPartial) {
                    setWorkflowStepStatus(4, 'success');
                    updateWorkflowUI(5);
                    oneClickWorkflow = {
                        ...oneClickWorkflow,
                        stage: ONE_CLICK_STAGE.COMPLETED,
                        status: 'completed'
                    };
                    setOneClickButtonMode('ready');
                    const filledFields = response.filledFields?.length || 'alanlar';
                    addStatus(`Tek Tık tamamlandı: ${filledFields}${photoRequired ? ' ve fotoğraf' : ''} YÖKSİS’e aktarıldı. Son kontrol ve kaydetme size aittir.`, 'success');
                    showToast('Tek Tık tamamlandı. YÖKSİS formunu kontrol edin.', 'success');
                } else if (response?.success) {
                    const missingText = missingFields.length > 0 ? ` Eksik alanlar: ${missingFields.join(', ')}.` : '';
                    const photoText = photoUploadFailed ? ' Fotoğraf yüklenemedi.' : '';
                    // En az bir alan gerçekten yazıldıysa aktarım başarısız değildir.
                    // Eksikleri görünür uyarı olarak korurken akışı tamamla; önceki
                    // davranış form dolu olduğu halde kullanıcıyı 4. adımda bırakıyordu.
                    setWorkflowStepStatus(4, 'success_with_warnings');
                    updateWorkflowUI(5);
                    oneClickWorkflow = {
                        ...oneClickWorkflow,
                        stage: ONE_CLICK_STAGE.COMPLETED,
                        status: 'completed_with_warnings'
                    };
                    setOneClickButtonMode('ready');
                    addStatus(`Tek Tık tamamlandı, ancak kontrol gereken alanlar var.${missingText}${photoText}`, 'warning');
                    showToast('YÖKSİS aktarımı tamamlandı; uyarılı alanları kontrol edin.', 'warning');
                } else {
                    failOneClick('YOKSIS_FORM_FILL_FAILED', response?.error || response?.message || 'YÖKSİS formu doldurulamadı.');
                }
                return;
            } else if (event.data.action === 'TRANSFER_TO_YOKSIS') {
                finishButtonAction('transfer-yoksis');

                if (response?.success && response.searchTriggered === true) {
                    const formReady = response.formReady === true;
                    currentStudentData = {
                        ...currentStudentData,
                        yoksisReady: true,
                        yoksisFormPending: !formReady
                    };
                    setWorkflowStepStatus(2, formReady ? 'success' : 'partial');
                    updateWorkflowUI(3);
                    updateStudentActions(currentStudentData);
                    if (formReady) {
                        addStatus('Kabul kodu YÖKSİS sekmesinde aratıldı ve öğrenci formu hazır.', 'success');
                        showToast('YÖKSİS araması tamamlandı.', 'success');
                    } else {
                        addStatus('Kabul kodu YÖKSİS’te aratıldı. Öğrenci formu son aktarım sırasında beklenecek.', 'info');
                        showToast('YÖKSİS formu hazırlanıyor; 3. adım açıldı.', 'info');
                    }
                } else {
                    setWorkflowStepStatus(2, 'error');
                    const errMsg = response?.error || response?.message || 'Kabul kodu YÖKSİS\'e aktarılamadı. Lütfen YÖKSİS sekmesinde öğrenci başvuru/kayıt ekranının açık olduğunu kontrol edin.';
                    addStatus(errMsg, 'error');
                    showToast(errMsg, 'error');
                }
            } else if (event.data.action === 'FILL_YOKSIS_FORM') {
                finishButtonAction('paste-yoksis');

                if (response?.success) {
                    const hasPhoto = Boolean(currentStudentData?.croppedPhotoBase64);
                    const missingFields = Array.isArray(response.missingFields) ? response.missingFields : [];
                    const photoUploadFailed = hasPhoto && response.photoUploaded !== true;
                    const isPartial = response.partial === true || missingFields.length > 0 || photoUploadFailed;
                    if (isPartial) {
                        // Formda gerçek veri yazıldıysa akışı tamamla, ancak bu
                        // adımı sarı/uyarılı göster. Böylece "başarılı" yanıt
                        // geldiği halde kullanıcı 4. adımda takılı kalmaz.
                        setWorkflowStepStatus(4, 'success_with_warnings');
                        updateWorkflowUI(5);
                        const missingText = missingFields.length > 0 ? ` Eksik alanlar: ${missingFields.join(', ')}.` : '';
                        const photoText = photoUploadFailed ? ' Fotoğraf yüklenemedi.' : '';
                        addStatus(`YÖKSİS formu aktarıldı; kontrol gereken alanlar var.${missingText}${photoText}`, 'warning');
                        showToast('YÖKSİS aktarımı tamamlandı; uyarılı alanları kontrol edin.', 'warning');
                    } else {
                        setWorkflowStepStatus(4, 'success');
                        updateWorkflowUI(5);
                        addStatus('YÖKSİS sekmesine geçildi ve form alanları dolduruldu. Göndermeden önce kontrol edin.', 'success');
                        showToast('YÖKSİS formu dolduruldu.', 'success');
                    }
                } else {
                    setWorkflowStepStatus(4, 'error');
                    const errMsg = response?.error || response?.message || 'YÖKSİS formu doldurulamadı. Lütfen YÖKSİS sekmesinin açık olduğunu kontrol edin.';
                    addStatus(errMsg, 'error');
                    showToast(errMsg, 'error');
                }
            } else if (event.data.action === 'COPY_APPLY_DATA') {
                finishButtonAction('copy-info');
                if (response?.success && response.data) {
                    const data = response.data;
                    currentStudentData = { ...currentStudentData, ...data };
                    applyCountryDefaultsToStudent(currentStudentData);
                    copyStudentInfoToClipboard(currentStudentData);
                    setWorkflowStepStatus(3, 'success');
                    if (currentWorkflowStep <= 3) updateWorkflowUI(4);

                    const passUrl = currentStudentData.passportImageUrl
                        || currentStudentData.passportDocumentUrl
                        || (currentStudentData.passportCandidates && currentStudentData.passportCandidates[0]);
                    if (passUrl && !currentStudentData.passportImageSrc) {
                        shouldOpenCropperWhenReady = true;
                        addStatus('Öğrenci bilgileri kopyalandı. Pasaport hazırlanıyor; fotoğraf kırpma ekranı açılacak.', 'success');
                        requestApplyDocument('passport', passUrl);
                    } else if (currentStudentData.passportImageSrc) {
                        shouldOpenCropperWhenReady = false;
                        openPassportCropper({
                            imageSrc: currentStudentData.passportImageSrc,
                            pages: currentStudentData.passportPages || [],
                            initialPageIndex: currentStudentData.bestPassportPageIndex || 0,
                            studentName: currentStudentData.fullName || '',
                            passportNo: currentStudentData.passportNo || inputPassport?.value.trim() || '',
                            studentData: currentStudentData
                        });
                        addStatus('Öğrenci bilgileri kopyalandı. Fotoğraf kırpma ekranı açıldı.', 'success');
                    } else {
                        addStatus('Öğrenci bilgileri kopyalandı. Sonraki adımlar bağımsız olarak kullanılabilir.', 'success');
                    }
                    showToast('Öğrenci bilgileri kopyalandı.', 'success');
                } else {
                    setWorkflowStepStatus(3, 'error');
                    const errorMessage = response?.error || response?.message || 'Apply öğrenci bilgileri okunamadı.';
                    addStatus(errorMessage, 'error');
                    showToast(errorMessage, 'error');
                }
            } else if (event.data.action === 'EXTRACT_KABUL_CODE') {
                if (response?.success) {
                    const validCode = isValidYoksisId(response.kabulId) ? response.kabulId : '';
                    if (validCode) {
                        finishButtonAction('copy-letter');
                        currentStudentData = { ...currentStudentData, yoksisId: validCode };
                        copyTextToClipboard(validCode);
                        updateStudentActions(currentStudentData);
                        setWorkflowStepStatus(1, 'success');
                        addStatus(`Kabul mektubu kodu bulundu ve panoya kopyalandı: ${validCode}`, 'success');
                        showToast(`Kabul Kodu: ${validCode}`, 'success');
                        if (isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)) {
                            startOneClickYoksisSearch();
                        }
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
                        requestApplyDocument(
                            'acceptanceLetter',
                            candidates[0],
                            isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)
                                ? oneClickWorkflow.workflowId
                                : activeSearchRequestId
                        );
                    } else {
                        finishButtonAction('copy-letter');
                        if (isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)) {
                            failOneClick('ACCEPTANCE_CODE_NOT_FOUND', 'Kabul mektubu belgesi veya kodu bulunamadı.');
                        } else {
                            setWorkflowStepStatus(1, 'error');
                            addStatus('Kabul mektubu belgesi veya kodu bulunamadı.', 'error');
                            showToast('Kabul mektubu belgesi bulunamadı.', 'error');
                        }
                    }
                } else {
                    finishButtonAction('copy-letter');
                    if (isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)) {
                        failOneClick('ACCEPTANCE_READ_FAILED', response?.error || 'Kabul mektubu sorgulanamadı.');
                    } else {
                        setWorkflowStepStatus(1, 'error');
                        addStatus(response?.error || 'Kabul mektubu sorgulanamadı.', 'error');
                    }
                }
            } else if (response?.error) {
                clearSearchTimeout();
                if (event.data.action === 'SEARCH_STUDENT') {
                    studentName.textContent = 'Arama başlatılamadı';
                    if (studentBadge) {
                        studentBadge.textContent = 'Hata';
                        studentBadge.style.background = 'rgba(231, 76, 60, 0.1)';
                        studentBadge.style.color = '#e74c3c';
                        studentBadge.style.display = 'inline-block';
                    }
                    if (proActions) proActions.style.display = 'none';
                }
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
            if (documentKind === 'acceptanceLetter') {
                finishButtonAction('copy-letter');
                setWorkflowStepStatus(1, 'error');
            }
            const stage = documentKind === 'passport'
                ? ONE_CLICK_STAGE.PASSPORT_READING
                : ONE_CLICK_STAGE.ACCEPTANCE_READING;
            if (isOneClickActive(stage)) {
                failOneClick('DOCUMENT_READ_FAILED', event.data.error || 'Belge okunamadı.');
            } else {
                addStatus(event.data.error || 'Belge okunamadı.', 'error');
            }
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
            if (studentBadge) {
                studentBadge.textContent = "Profil Bulundu";
                studentBadge.style.background = "rgba(39, 174, 96, 0.1)";
                studentBadge.style.color = "#27ae60";
                studentBadge.style.display = "inline-block";
            }
            if (proActions) proActions.style.display = 'flex';
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
            if (proActions) proActions.style.display = 'flex';
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
            if (isOneClickActive(ONE_CLICK_STAGE.ACCEPTANCE_READING)) {
                failOneClick('ACCEPTANCE_DOCUMENT_NOT_FOUND', event.data.error || 'Profil belgeleri bulunamadı.');
            } else {
                addStatus(event.data.error || 'Profil belgeleri bulunamadı.', 'error');
            }
        }
        else if (event.data.type === 'EVENT' && (
            event.data.action === 'STUDENT_NOT_FOUND' ||
            event.data.action === 'REQUEST_FAILED'
        )) {
            clearSearchTimeout();
            if (transferTimeoutTimer) {
                clearTimeout(transferTimeoutTimer);
                transferTimeoutTimer = null;
            }
            if (btnTransferYoksis) btnTransferYoksis.classList.remove('is-loading');
            if (event.data.action === 'STUDENT_NOT_FOUND') {
                studentName.textContent = "Bulunamadı";
                if (studentBadge) {
                    studentBadge.textContent = "Bulunamadı";
                    studentBadge.style.background = "rgba(231, 76, 60, 0.1)";
                    studentBadge.style.color = "#e74c3c";
                    studentBadge.style.display = "inline-block";
                }
                if (proActions) proActions.style.display = 'none';
            }
            if (event.data.code === 'EXTENSION_CONTEXT_INVALIDATED') {
                showExtensionMissing();
                studentName.textContent = 'Eklenti bağlantısı yenilenmeli';
                if (studentBadge) {
                    studentBadge.textContent = "Eklenti Hatası";
                    studentBadge.style.background = "rgba(231, 76, 60, 0.1)";
                    studentBadge.style.color = "#e74c3c";
                    studentBadge.style.display = "inline-block";
                }
                if (proActions) proActions.style.display = 'none';
            }
            const errorMsg = event.data.error ? 'Hata: ' + event.data.error : 'İşlem başarısız oldu.';
            addStatus(errorMsg, 'error');
        }
    };
    window.__YKN_PORTAL_MSG_HANDLER__ = messageHandler;
    window.addEventListener('message', messageHandler);

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
