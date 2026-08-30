import { initTheme } from './ui/themeManager.js';
import { setActiveStep, STEP_IDS } from './ui/stepWizard.js';
import { renderStudentForms, getAllFormsData } from './ui/formManager.js';
import { saveDraft, restoreDraft, clearDraft, initDraftAutoSave } from './managers/draftManager.js';
import { historyManager, initHistoryPanel } from './managers/historyManager.js';
import { showCropperForFile, getCroppedImage, cleanupCropper, initCropperControls } from './ui/cropperModal.js';
import { prepareImageForOCR } from './services/imageProcessor.js';
import { runOCR, cancelOCR } from './services/ocrService.js';
import { generateAndDownloadPdf, printDocument } from './services/pdfGenerator.js';
import { showToast } from './ui/toastManager.js';

// --- Clear Old PWA Service Workers ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
            console.log('Eski Service Worker silindi');
        }
    });
}



// --- State ---
let pendingFiles = [];
let croppedImages = [];
let page1ImageObj = null;
let isProcessingPage2 = false;
let isSequentialCapture = false;
let useCameraForPage2 = false;
let studentsQueue = [];

document.addEventListener('DOMContentLoaded', () => {
    // --- Initializations ---
    initTheme();
    initHistoryPanel();
    
    initDraftAutoSave();
    
    // Set active step to Upload
    setActiveStep(STEP_IDS.UPLOAD);
    
    renderStudentForms([{}]);
    

    
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
            studentsQueue = [];

            setActiveStep(STEP_IDS.FORM_RESULT);
            restoreDraft();
        });
    }

    const btnClearForm = document.getElementById('btn-clear-form-global');
    if (btnClearForm) {
        btnClearForm.addEventListener('click', () => {
            if (confirm('Formdaki tüm veriler silinecek. Emin misiniz?')) {
                studentsQueue = [];
                renderStudentForms([{}]);
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
            
            if (croppedImages.length > 0) {
                for (let i = 0; i < croppedImages.length; i += 2) {
                    studentsQueue.push([croppedImages[i], croppedImages[i+1] || null]);
                }
            }
            processAllStudents(studentsQueue);

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
    
    function processNextStep(img, isAddingStudent = false) {
        croppedImages.push(img);
        if (isSequentialCapture && !isProcessingPage2) {
            page1ImageObj = img;
            cleanupCropper();
            setActiveStep(STEP_IDS.PAGE2_UPLOAD);
        } else {
            if (pendingFiles.length > 0) {
                handleFile(pendingFiles.shift());
            } else if (isAddingStudent) {
                // Add to queue and restart for new student
                studentsQueue.push([page1ImageObj, img]);
                cleanupCropper();
                croppedImages = [];
                page1ImageObj = null;
                isProcessingPage2 = false;
                isSequentialCapture = false;
                
                // Prompt user to select/scan first page for next student
                const fileInput = document.getElementById('file-input');
                if (fileInput) {
                    fileInput.removeAttribute('capture');
                    fileInput.click();
                }
            } else {
                // Final process
                if (page1ImageObj && img) {
                    studentsQueue.push([page1ImageObj, img]);
                } else if (croppedImages.length > 0) {
                    for (let i = 0; i < croppedImages.length; i += 2) {
                        studentsQueue.push([croppedImages[i], croppedImages[i+1] || null]);
                    }
                }
                processAllStudents(studentsQueue);
            }
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
            getCroppedImage((img) => processNextStep(img, false));
        },
        onCropAddStudent: () => {
            getCroppedImage((img) => processNextStep(img, true));
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
                processAllStudents([[page1ImageObj, null]]);
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

    
    async function processAllStudents(queue) {
        setActiveStep(STEP_IDS.OCR_PROGRESS);
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        if (progressText) progressText.textContent = `${queue.length} öğrencinin belgeleri analiz ediliyor...`;
        
        try {
            const ocrPromises = queue.map(studentImages => {
                const img1 = studentImages[0];
                const img2 = studentImages[1];
                const p1 = prepareImageForOCR(img1);
                const p2 = img2 ? prepareImageForOCR(img2) : null;
                
                if (p2) {
                    return Promise.all([
                        runOCR(p1.dataUrl, p1.canvas, true, false),
                        runOCR(p2.dataUrl, p2.canvas, true, true)
                    ]).then(results => {
                        // Merge results
                        return { ...results[0], ...results[1] };
                    });
                } else {
                    return runOCR(p1.dataUrl, p1.canvas, false, false);
                }
            });
            
            const results = await Promise.all(ocrPromises);
            
            if (progressBar) progressBar.style.width = '100%';
            
            renderStudentForms(results);
            setActiveStep(STEP_IDS.FORM_RESULT);
            showToast(`${queue.length} öğrenci başarıyla analiz edildi.`, 'success');
            saveDraft();
            
        } catch (error) {
            console.error('OCR İşlemi başarısız:', error);
            if (error.name !== 'AbortError' && error.message !== 'Aborted') {
                setActiveStep(STEP_IDS.UPLOAD);
            }
        } finally {
            croppedImages = [];
            page1ImageObj = null;
            isProcessingPage2 = false;
            isSequentialCapture = false;
            studentsQueue = [];
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

    const btnGoHome = document.getElementById('btn-go-home-global');
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

    
    document.addEventListener('click', (e) => {
        const btnDownload = e.target.closest('.btn-download-student');
        if (btnDownload) {
            const wrapper = btnDownload.closest('.student-form-wrapper');
            generateAndDownloadPdf(btnDownload, wrapper);
        }
    });

    
    document.addEventListener('click', (e) => {
        const btnPrint = e.target.closest('.btn-print-student');
        if (btnPrint) {
            const wrapper = btnPrint.closest('.student-form-wrapper');
            printDocument(btnPrint, wrapper);
        }
    });

    
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
