import { initTheme } from './ui/themeManager.js';
import { setActiveStep, STEP_IDS } from './ui/stepWizard.js';
import { getFormElements, initFormEvents, clearFormExceptTeslimTarihi, clearAllFields, setDefaultDeliveryDate, populateForm } from './ui/formManager.js';
import { saveDraft, restoreDraft, clearDraft, initDraftAutoSave } from './managers/draftManager.js';
import { historyManager, initHistoryPanel } from './managers/historyManager.js';
import { showCropperForFile, getCroppedImage, cleanupCropper, initCropperControls } from './ui/cropperModal.js';
import { prepareImageForOCR } from './services/imageProcessor.js';
import { runOCR, cancelOCR } from './services/ocrService.js';
import { generateAndDownloadPdf, printDocument } from './services/pdfGenerator.js';
import { showToast } from './ui/toastManager.js';



// --- State ---
let pendingFiles = [];
let croppedImages = [];
let page1ImageObj = null;
let isProcessingPage2 = false;
let isSequentialCapture = false;
let useCameraForPage2 = false;

document.addEventListener('DOMContentLoaded', () => {
    // --- Initializations ---
    initTheme();
    initHistoryPanel();
    initFormEvents();
    initDraftAutoSave();
    
    // Set active step to Upload
    setActiveStep(STEP_IDS.UPLOAD);
    
    const fields = getFormElements();
    if (fields.teslimTarihi && !fields.teslimTarihi.value) {
        setDefaultDeliveryDate();
    }
    

    
    const dailyCounterWidget = document.getElementById('daily-counter-widget');
    if (dailyCounterWidget) {
        dailyCounterWidget.style.cursor = 'pointer';
        dailyCounterWidget.addEventListener('click', () => {
            const body = document.querySelector('.history-body');
            if (body && !body.classList.contains('open')) {
                const toggle = document.getElementById('history-toggle');
                if (toggle) toggle.click();
            }
            setTimeout(() => {
                const panel = document.getElementById('history-panel');
                if (panel) panel.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        });
    }
    
    // --- Manual Entry & Form Clear ---
    const btnManualEntry = document.getElementById('btn-manual-entry');
    if (btnManualEntry) {
        btnManualEntry.addEventListener('click', () => {
            croppedImages = [];
            page1ImageObj = null;
            
            // Manuel doldurmada "2. sayfayı ekle" resim yükleme butonunu gizle
            const btnAddPage2 = document.getElementById('btn-add-page2-step3');
            if (btnAddPage2) btnAddPage2.style.display = 'none';

            // Manuel doldurmada Tekrar Tara butonuna gerek yok
            const btnRescan = document.getElementById('btn-rescan');
            if (btnRescan) btnRescan.style.display = 'none';

            // Formun içini sıfırla ki eski OCR vs kırıntısı kalmasın, draft yüklenmezse boş gelsin
            clearFormExceptTeslimTarihi();

            setActiveStep(STEP_IDS.FORM_RESULT);
            restoreDraft();
        });
    }

    const btnClearForm = document.getElementById('btn-clear-form');
    if (btnClearForm) {
        btnClearForm.addEventListener('click', () => {
            if (confirm('Formdaki tüm veriler silinecek. Emin misiniz?')) {
                clearFormExceptTeslimTarihi();
                clearDraft();
            }
        });
    }

    // --- File Handling & Drag Drop ---
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const fileInputPage2 = document.getElementById('file-input-page2');
    
    function handleMultipleFilesSelection(fileList) {
        if (!fileList || fileList.length === 0) return;
        pendingFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
        if (pendingFiles.length === 0) {
            showToast('Lütfen sadece resim dosyaları seçin.', 'error');
            return;
        }
        croppedImages = [];
        page1ImageObj = null;
        isSequentialCapture = false;
        
        const btnAddPage2 = document.getElementById('btn-add-page2-step3');
        if (btnAddPage2) btnAddPage2.style.display = 'inline-flex';
        
        const btnRescan = document.getElementById('btn-rescan');
        if (btnRescan) btnRescan.style.display = 'inline-flex';
        
        handleFile(pendingFiles.shift());
    }
    
    function handleFile(file) {
        if (!file) {
            cleanupCropper();
            processMultipleImages(croppedImages[0], croppedImages[1]);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                showCropperForFile(img, {
                    isFirstImage: croppedImages.length === 0,
                    isPage2: isProcessingPage2,
                    hasMoreFiles: pendingFiles.length > 0
                });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            handleMultipleFilesSelection(e.target.files);
            e.target.value = '';
        });
    }
    
    if (fileInputPage2) {
        fileInputPage2.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                isSequentialCapture = true;
                isProcessingPage2 = true;
                useCameraForPage2 = !!e.target.getAttribute('capture');
                pendingFiles = []; 
                handleFile(e.target.files[0]);
                e.target.value = '';
            }
        });
    }
    
    if (uploadZone) {
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            handleMultipleFilesSelection(e.dataTransfer.files);
        });
    }
    
    document.addEventListener('paste', (e) => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        if (e.clipboardData && e.clipboardData.files) {
            handleMultipleFilesSelection(e.clipboardData.files);
        }
    });

    // --- Step 3 Page 2 Capture ---
    const fileInputPage2Step3 = document.getElementById('file-input-page2-step3');
    if (fileInputPage2Step3) {
        fileInputPage2Step3.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                isProcessingPage2 = true;
                setActiveStep(STEP_IDS.OCR_PROGRESS);
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = async () => {
                        try {
                            const prep = prepareImageForOCR(img);
                            await runOCR(prep.dataUrl, prep.canvas, true, true);
                            showToast('2. sayfa bilgileri eklendi.', 'success');
                            setActiveStep(STEP_IDS.FORM_RESULT);
                            saveDraft();
                        } catch (err) {
                            setActiveStep(STEP_IDS.FORM_RESULT);
                        }
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            }
        });
    }
    
    // --- Cropper UI Handlers ---
    function processNextStep(img) {
        croppedImages.push(img);
        if (isSequentialCapture && !isProcessingPage2) {
            page1ImageObj = img;
            cleanupCropper();
            setActiveStep(STEP_IDS.PAGE2_UPLOAD);
        } else {
            handleFile(pendingFiles.shift());
        }
    }
    
    initCropperControls({
        onCancel: () => {
            cleanupCropper();
            croppedImages = [];
            pendingFiles = [];
            page1ImageObj = null;
            isProcessingPage2 = false;
            isSequentialCapture = false;
            setActiveStep(STEP_IDS.UPLOAD);
        },
        onSkip: () => {
            const img = document.getElementById('cropper-image');
            const newImg = new Image();
            newImg.src = img.src;
            processNextStep(newImg);
        },
        onConfirm: () => {
            getCroppedImage((img) => processNextStep(img));
        },
        onNext: () => {
            getCroppedImage((img) => processNextStep(img));
        },
        onSkipCaptureNext: () => {
            isSequentialCapture = true;
            const imgEl = document.getElementById('cropper-image');
            const newImg = new Image();
            newImg.src = imgEl.src;
            processNextStep(newImg);
            if (fileInputPage2) {
                if(useCameraForPage2) fileInputPage2.setAttribute('capture', 'environment');
                else fileInputPage2.removeAttribute('capture');
                fileInputPage2.click();
            }
        },
        onCropCaptureNext: () => {
            isSequentialCapture = true;
            getCroppedImage((img) => {
                processNextStep(img);
                if (fileInputPage2) {
                    if(useCameraForPage2) fileInputPage2.setAttribute('capture', 'environment');
                    else fileInputPage2.removeAttribute('capture');
                    fileInputPage2.click();
                }
            });
        }
    });

    const btnUploadPage2 = document.getElementById('btn-upload-page2');
    const btnCancelPage2 = document.getElementById('btn-cancel-page2');
    if (btnUploadPage2) {
        btnUploadPage2.addEventListener('click', () => {
            useCameraForPage2 = false;
            if (fileInputPage2) {
                fileInputPage2.removeAttribute('capture');
                fileInputPage2.click();
            }
        });
    }
    if (btnCancelPage2) {
        btnCancelPage2.addEventListener('click', () => {
            isSequentialCapture = false;
            isProcessingPage2 = false;
            if (page1ImageObj) {
                processMultipleImages(page1ImageObj, null);
            }
        });
    }

    // --- OCR Orchestration ---
    async function processAndRunOCR(img) {
        if (!img) return;
        setActiveStep(STEP_IDS.OCR_PROGRESS);
        try {
            const prep = prepareImageForOCR(img);
            await runOCR(prep.dataUrl, prep.canvas, false, isProcessingPage2);
        } catch (error) {
            console.error(error);
        }
    }

    async function processMultipleImages(img1, img2) {
        setActiveStep(STEP_IDS.OCR_PROGRESS);
        try {
            const p1 = prepareImageForOCR(img1);
            let p2 = img2 ? prepareImageForOCR(img2) : null;
            
            if (p2) {
                const progressBar = document.getElementById('progress-bar');
                const progressText = document.getElementById('progress-text');
                if (progressText) progressText.textContent = '1. Sayfa analiz ediliyor...';
                
                await runOCR(p1.dataUrl, p1.canvas, true, false);
                
                if (progressText) progressText.textContent = '2. Sayfa analiz ediliyor...';
                if (progressBar) progressBar.style.width = '60%';
                
                await runOCR(p2.dataUrl, p2.canvas, true, true);
                
                setActiveStep(STEP_IDS.FORM_RESULT);
                showToast('İki sayfa da başarıyla analiz edildi.', 'success');
            } else {
                await runOCR(p1.dataUrl, p1.canvas, false, false);
            }
        } catch (error) {
            console.error('OCR İşlemi başarısız:', error);
            // Hata handling runOCR içinde yapılıyor, biz sadece state sıfırlayalım
            if (error.name !== 'AbortError' && error.message !== 'Aborted') {
                setActiveStep(STEP_IDS.UPLOAD);
            }
        } finally {
            croppedImages = [];
            page1ImageObj = null;
            isProcessingPage2 = false;
            isSequentialCapture = false;
        }
    }

    // --- Cancel OCR Wiring ---
    const btnCancelOcr = document.getElementById('btn-cancel-ocr');
    if (btnCancelOcr) {
        btnCancelOcr.addEventListener('click', () => {
            cancelOCR();
            setActiveStep(STEP_IDS.UPLOAD);
        });
    }

    // History restore event listener for cleaning cropper states
    window.addEventListener('historyRestore', () => {
        croppedImages = [];
        page1ImageObj = null;
        isSequentialCapture = false;
        isProcessingPage2 = false;
    });

    // --- Action Buttons (Step 3) ---
    const btnRescan = document.getElementById('btn-rescan');
    const btnCopyOcr = document.getElementById('btn-copy-ocr');
    const btnDownload = document.getElementById('btn-download');
    const btnPrint = document.getElementById('btn-print');

    if (btnRescan) {
        btnRescan.addEventListener('click', () => {
            const fileInput = document.getElementById('file-input');
            if (fileInput) fileInput.click();
        });
    }

    const btnGoHome = document.getElementById('btn-go-home');
    if (btnGoHome) {
        btnGoHome.addEventListener('click', () => {
            setActiveStep(STEP_IDS.UPLOAD);
        });
    }

    if (btnCopyOcr) {
        btnCopyOcr.addEventListener('click', () => {
            const rawText = document.getElementById('ocr-raw-text') ? document.getElementById('ocr-raw-text').value : '';
            navigator.clipboard.writeText(rawText).then(() => {
                showToast('Ham OCR metni kopyalandı.', 'success');
            });
        });
    }

    if (btnDownload) btnDownload.addEventListener('click', () => generateAndDownloadPdf(btnDownload));
    if (btnPrint) btnPrint.addEventListener('click', () => printDocument(btnPrint));
    
    // --- Online/Offline Listener ---
    const updateOnlineStatus = () => {
        const btnUpload = document.getElementById('btn-upload');
        if (navigator.onLine) {
            if(btnUpload) {
                btnUpload.disabled = false;
                btnUpload.style.opacity = '1';
                btnUpload.title = '';
            }
        } else {
            if(btnUpload) {
                btnUpload.disabled = true;
                btnUpload.style.opacity = '0.5';
                btnUpload.title = 'İnternet bağlantısı yok';
            }
            showToast('İnternet bağlantısı kesildi. Çevrimdışı moda geçildi.', 'warning');
        }
    };

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus(); // initial check

    // --- Shortcut Listener ---
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            const step3 = document.getElementById('step-3');
            if (step3 && step3.classList.contains('active')) {
                e.preventDefault();
                const btnPrint = document.getElementById('btn-print');
                if (btnPrint) btnPrint.click();
            }
        }
    });
});
